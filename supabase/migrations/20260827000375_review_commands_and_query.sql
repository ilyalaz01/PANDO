-- Authenticated Review commands and bounded ReviewWorkspaceV1 query.

do $migration_role_membership$
begin
  execute pg_catalog.format('grant pando_review_api to %I with set true', current_user);
end
$migration_role_membership$;

grant create on schema api, review to pando_review_api;

create function review.local_timestamp_to_instant_v1(
  p_local_timestamp timestamp,
  p_time_zone text
)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $function$
declare
  v_instant timestamptz;
  v_matching_instants integer;
begin
  if p_local_timestamp is null or p_time_zone is null then
    raise exception using errcode = '22023', message = 'review local due time is invalid';
  end if;
  v_instant := p_local_timestamp at time zone p_time_zone;
  if (v_instant at time zone p_time_zone) is distinct from p_local_timestamp then
    raise exception using errcode = '22023',
      message = 'review local due time does not exist in the workspace time zone';
  end if;
  select count(*) into v_matching_instants
  from pg_catalog.generate_series(
    v_instant - interval '3 hours',
    v_instant + interval '3 hours',
    interval '15 minutes'
  ) as candidate(value)
  where candidate.value at time zone p_time_zone = p_local_timestamp;
  if v_matching_instants <> 1 then
    raise exception using errcode = '22023',
      message = 'review local due time is ambiguous in the workspace time zone';
  end if;
  return v_instant;
end
$function$;

-- User-entered local timestamps must be unambiguous, but SKIP_ONCE is a calendar operation. For a
-- system-derived next local day PostgreSQL's time-zone resolver is the deterministic policy: a
-- spring gap is normalized forward and an autumn fold chooses the standard-time (later) instant.
create function review.calendar_day_to_instant_v1(
  p_local_timestamp timestamp,
  p_time_zone text
)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $function$
begin
  if p_local_timestamp is null or p_time_zone is null then
    raise exception using errcode = '22023', message = 'review calendar time is invalid';
  end if;
  return p_local_timestamp at time zone p_time_zone;
end
$function$;

create function review.apply_reason_action_impl(
  p_command_type text,
  p_action_type text,
  p_subject_id uuid,
  p_reason_id uuid,
  p_expected_projection_version bigint,
  p_expected_source_revision bigint,
  p_local_due_at text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
set search_path = ''
as $function$
declare
  v_workspace_id uuid;
  v_actor_user_id uuid;
  v_subject review.subject_ledgers%rowtype;
  v_item review.items%rowtype;
  v_reason review.item_reasons%rowtype;
  v_time_zone text;
  v_new_due_at timestamptz;
  v_action_id uuid := gen_random_uuid();
  v_command_id uuid := gen_random_uuid();
  v_event_id uuid := gen_random_uuid();
  v_correlation_id uuid := gen_random_uuid();
  v_now timestamptz := pg_catalog.date_trunc('milliseconds', clock_timestamp());
  v_request_hash bytea;
  v_receipt outbox.command_receipts%rowtype;
  v_next_watermark bigint;
  v_response jsonb;
begin
  if identity.jwt_subject() is null then
    raise exception using errcode = '28000', message = 'an authenticated user is required';
  end if;
  if (p_command_type, p_action_type) not in (
    ('review.reschedule_reason', 'RESCHEDULE'),
    ('review.skip_reason_once', 'SKIP_ONCE'),
    ('review.suppress_reason', 'SUPPRESS'),
    ('review.restore_reason', 'RESTORE')
  ) or p_expected_projection_version is null or p_expected_projection_version < 1
    or p_expected_source_revision is null or p_expected_source_revision < 1
    or p_idempotency_key is null or p_idempotency_key <> btrim(p_idempotency_key)
    or char_length(p_idempotency_key) not between 1 and 128 then
    raise exception using errcode = '22023', message = 'review action input is invalid';
  end if;
  if (p_action_type = 'RESCHEDULE' and (
      p_local_due_at is null
      or p_local_due_at !~
        '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2})?$'
    )) or (p_action_type <> 'RESCHEDULE' and p_local_due_at is not null) then
    raise exception using errcode = '22023', message = 'review local due time is invalid';
  end if;

  v_workspace_id := identity.personal_workspace_id_for_current_user();
  v_actor_user_id := identity.current_user_id();
  v_time_zone := identity.current_review_time_zone_v1();
  if v_workspace_id is null or v_actor_user_id is null or v_time_zone is null then
    raise exception using errcode = '42501', message = 'workspace is not accessible';
  end if;
  v_request_hash := extensions.digest(pg_catalog.convert_to(pg_catalog.jsonb_build_object(
    'commandType', p_command_type,
    'schemaVersion', 1,
    'workspaceId', v_workspace_id,
    'subjectId', p_subject_id,
    'reasonId', p_reason_id,
    'expectedProjectionVersion', p_expected_projection_version,
    'expectedSourceRevision', p_expected_source_revision,
    'localDueAt', p_local_due_at
  )::text, 'UTF8'), 'sha256');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    v_actor_user_id::text || ':' || p_command_type || ':' || p_idempotency_key, 0
  ));
  select receipt.* into v_receipt
  from outbox.command_receipts as receipt
  where receipt.actor_user_id = v_actor_user_id
    and receipt.command_type = p_command_type
    and receipt.idempotency_key = p_idempotency_key
  for update;
  if found then
    if v_receipt.request_hash <> v_request_hash then
      raise exception using errcode = '22023',
        message = 'idempotency key reused with a different request';
    end if;
    if v_receipt.command_status <> 'completed' then
      raise exception using errcode = '40001', message = 'command receipt is not complete';
    end if;
    return v_receipt.response;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    v_workspace_id::text || ':review:' || p_subject_id::text, 5
  ));
  select subject.* into v_subject
  from review.subject_ledgers as subject
  where subject.workspace_id = v_workspace_id and subject.subject_id = p_subject_id
  for update;
  select item.* into v_item
  from review.items as item
  where item.workspace_id = v_workspace_id and item.subject_id = p_subject_id;
  select reason.* into v_reason
  from review.item_reasons as reason
  where reason.workspace_id = v_workspace_id
    and reason.subject_id = p_subject_id
    and reason.reason_id = p_reason_id;
  if v_subject.subject_id is null or v_item.subject_id is null or v_reason.reason_id is null
     or v_subject.input_watermark <> p_expected_projection_version
     or v_item.input_watermark <> v_subject.input_watermark
     or v_reason.source_revision <> p_expected_source_revision then
    raise exception using errcode = '40001', message = 'review projection changed';
  end if;
  if (p_action_type in ('RESCHEDULE', 'SKIP_ONCE') and not v_reason.active)
     or (p_action_type = 'SUPPRESS' and (v_reason.suppressed or not v_reason.source_active))
     or (p_action_type = 'RESTORE' and not v_reason.suppressed) then
    raise exception using errcode = '22023', message = 'review action is not valid for this reason';
  end if;

  if p_action_type = 'RESCHEDULE' then
    v_new_due_at := review.local_timestamp_to_instant_v1(
      p_local_due_at::timestamp, v_time_zone
    );
  elsif p_action_type = 'SKIP_ONCE' then
    v_new_due_at := review.calendar_day_to_instant_v1(
      (greatest(v_reason.due_at, v_now) at time zone v_time_zone) + interval '1 day',
      v_time_zone
    );
  end if;
  v_next_watermark := v_subject.input_watermark + 1;

  insert into outbox.command_receipts (
    command_id, command_type, command_schema_version, workspace_id, actor_user_id,
    idempotency_key, request_hash, correlation_id, expected_aggregate_version
  ) values (
    v_command_id, p_command_type, 1, v_workspace_id, v_actor_user_id,
    p_idempotency_key, v_request_hash, v_correlation_id, p_expected_projection_version
  );
  insert into review.action_events (
    action_id, workspace_id, subject_id, reason_id, source_key, action_revision,
    occurrence_id, action_type, old_due_at, new_due_at, actor_user_id, command_id, occurred_at
  ) values (
    v_action_id, v_workspace_id, p_subject_id, p_reason_id, v_reason.source_key,
    v_next_watermark, v_reason.occurrence_id, p_action_type,
    case when p_action_type in ('RESCHEDULE', 'SKIP_ONCE') then v_reason.due_at end,
    case when p_action_type in ('RESCHEDULE', 'SKIP_ONCE') then v_new_due_at end,
    v_actor_user_id, v_command_id, v_now
  );
  update review.subject_ledgers
  set input_watermark = v_next_watermark, updated_at = v_now
  where workspace_id = v_workspace_id and subject_id = p_subject_id;
  insert into outbox.events (
    event_id, event_name, event_schema_version, workspace_id,
    aggregate_type, aggregate_id, aggregate_version,
    actor_type, actor_user_id, command_id, correlation_id, occurred_at, source, payload
  ) values (
    v_event_id, 'review.input_changed', 1, v_workspace_id,
    'review.subject', p_subject_id, v_next_watermark,
    'user', v_actor_user_id, v_command_id, v_correlation_id, v_now, 'pando.database',
    pg_catalog.jsonb_build_object(
      'subject_id', p_subject_id,
      'subject_ref', v_subject.subject_ref,
      'input_watermark', v_next_watermark::text
    )
  );
  insert into outbox.deliveries (
    event_id, workspace_id, consumer_name, handler_contract_version
  ) values (
    v_event_id, v_workspace_id, 'review.item_projection_v1', 1
  );
  v_response := pg_catalog.jsonb_build_object(
    'commandId', v_command_id,
    'actionId', v_action_id,
    'subjectId', p_subject_id,
    'subjectVersion', v_next_watermark::text,
    'projectionState', 'pending',
    'emittedEventIds', pg_catalog.jsonb_build_array(v_event_id)
  );
  update outbox.command_receipts
  set command_status = 'completed', response = v_response,
      emitted_event_ids = array[v_event_id], completed_at = clock_timestamp()
  where command_id = v_command_id;
  return v_response;
end
$function$;

create function api.create_personal_review_reminder_v1(
  p_competency_ref text,
  p_dimension text,
  p_local_due_at text,
  p_expected_subject_version bigint,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_workspace_id uuid;
  v_actor_user_id uuid;
  v_time_zone text;
  v_subject_ref text;
  v_subject_id uuid;
  v_reason_id uuid;
  v_source_key text;
  v_due_at timestamptz;
  v_current_watermark bigint;
  v_command_id uuid := gen_random_uuid();
  v_event_id uuid := gen_random_uuid();
  v_source_event_id uuid := gen_random_uuid();
  v_occurrence_id uuid := gen_random_uuid();
  v_correlation_id uuid := gen_random_uuid();
  v_now timestamptz := pg_catalog.date_trunc('milliseconds', clock_timestamp());
  v_request_hash bytea;
  v_receipt outbox.command_receipts%rowtype;
  v_response jsonb;
begin
  if identity.jwt_subject() is null then
    raise exception using errcode = '28000', message = 'an authenticated user is required';
  end if;
  if p_competency_ref is null
     or p_competency_ref !~ '^competency:[a-z0-9][a-z0-9-]{1,100}$'
     or p_dimension not in ('KNOWLEDGE', 'RECALL', 'APPLICATION', 'INTERVIEW_EXECUTION')
     or p_local_due_at is null
     or p_local_due_at !~
       '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2})?$'
     or p_expected_subject_version is null or p_expected_subject_version < 0
     or p_idempotency_key is null or p_idempotency_key <> btrim(p_idempotency_key)
     or char_length(p_idempotency_key) not between 1 and 128 then
    raise exception using errcode = '22023', message = 'personal reminder input is invalid';
  end if;
  v_workspace_id := identity.personal_workspace_id_for_current_user();
  v_actor_user_id := identity.current_user_id();
  v_time_zone := identity.current_review_time_zone_v1();
  if v_workspace_id is null or v_actor_user_id is null or v_time_zone is null then
    raise exception using errcode = '42501', message = 'workspace is not accessible';
  end if;
  v_subject_ref := p_competency_ref || '/' || pg_catalog.lower(p_dimension);
  v_subject_id := review.stable_uuid(v_workspace_id::text || ':' || v_subject_ref);
  v_reason_id := review.stable_uuid(v_workspace_id::text || ':' || v_subject_ref || ':PERSONAL_REMINDER');
  v_source_key := 'personal:' || v_subject_ref || ':reminder';
  v_request_hash := extensions.digest(pg_catalog.convert_to(pg_catalog.jsonb_build_object(
    'commandType', 'review.create_personal_reminder',
    'schemaVersion', 1,
    'workspaceId', v_workspace_id,
    'competencyRef', p_competency_ref,
    'dimension', p_dimension,
    'localDueAt', p_local_due_at,
    'expectedSubjectVersion', p_expected_subject_version
  )::text, 'UTF8'), 'sha256');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    v_actor_user_id::text || ':review.create_personal_reminder:' || p_idempotency_key, 0
  ));
  select receipt.* into v_receipt
  from outbox.command_receipts as receipt
  where receipt.actor_user_id = v_actor_user_id
    and receipt.command_type = 'review.create_personal_reminder'
    and receipt.idempotency_key = p_idempotency_key
  for update;
  if found then
    if v_receipt.request_hash <> v_request_hash then
      raise exception using errcode = '22023',
        message = 'idempotency key reused with a different request';
    end if;
    if v_receipt.command_status <> 'completed' then
      raise exception using errcode = '40001', message = 'command receipt is not complete';
    end if;
    return v_receipt.response;
  end if;

  if not catalog.review_competency_exists_v1(p_competency_ref)
     and not overlay.review_personal_competency_exists_v1(
       v_workspace_id, p_competency_ref
     ) then
    raise exception using errcode = '22023', message = 'review competency is not available';
  end if;
  v_due_at := review.local_timestamp_to_instant_v1(
    p_local_due_at::timestamp, v_time_zone
  );

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    v_workspace_id::text || ':review:' || v_subject_id::text, 5
  ));
  select coalesce(subject.input_watermark, 0) into v_current_watermark
  from (select 1) as singleton
  left join review.subject_ledgers as subject
    on subject.workspace_id = v_workspace_id and subject.subject_id = v_subject_id;
  if v_current_watermark <> p_expected_subject_version
     or exists (
       select 1 from review.reason_sources as source
       where source.workspace_id = v_workspace_id
         and source.subject_id = v_subject_id
         and source.reason_type = 'PERSONAL_REMINDER'
     ) then
    raise exception using errcode = '40001', message = 'review subject changed';
  end if;
  v_current_watermark := v_current_watermark + 1;

  insert into outbox.command_receipts (
    command_id, command_type, command_schema_version, workspace_id, actor_user_id,
    idempotency_key, request_hash, correlation_id, expected_aggregate_version
  ) values (
    v_command_id, 'review.create_personal_reminder', 1, v_workspace_id, v_actor_user_id,
    p_idempotency_key, v_request_hash, v_correlation_id, p_expected_subject_version
  );
  insert into review.subject_ledgers (
    subject_id, workspace_id, competency_ref, dimension, input_watermark, updated_at
  ) values (
    v_subject_id, v_workspace_id, p_competency_ref, p_dimension, v_current_watermark, v_now
  )
  on conflict (workspace_id, subject_ref) do update
  set input_watermark = excluded.input_watermark, updated_at = excluded.updated_at
  where review.subject_ledgers.input_watermark = p_expected_subject_version;
  insert into review.reason_sources (
    reason_id, workspace_id, subject_id, source_key, source_kind, reason_type
  ) values (
    v_reason_id, v_workspace_id, v_subject_id, v_source_key,
    'PERSONAL_REMINDER', 'PERSONAL_REMINDER'
  );
  insert into review.reason_source_events (
    source_event_id, workspace_id, subject_id, reason_id, source_key,
    source_revision, source_kind, reason_type, occurrence_id, base_due_at,
    source_active, command_id, actor_user_id, recorded_at
  ) values (
    v_source_event_id, v_workspace_id, v_subject_id, v_reason_id, v_source_key,
    1, 'PERSONAL_REMINDER', 'PERSONAL_REMINDER', v_occurrence_id, v_due_at,
    true, v_command_id, v_actor_user_id, v_now
  );
  insert into outbox.events (
    event_id, event_name, event_schema_version, workspace_id,
    aggregate_type, aggregate_id, aggregate_version,
    actor_type, actor_user_id, command_id, correlation_id, occurred_at, source, payload
  ) values (
    v_event_id, 'review.input_changed', 1, v_workspace_id,
    'review.subject', v_subject_id, v_current_watermark,
    'user', v_actor_user_id, v_command_id, v_correlation_id, v_now, 'pando.database',
    pg_catalog.jsonb_build_object(
      'subject_id', v_subject_id,
      'subject_ref', v_subject_ref,
      'input_watermark', v_current_watermark::text
    )
  );
  insert into outbox.deliveries (
    event_id, workspace_id, consumer_name, handler_contract_version
  ) values (
    v_event_id, v_workspace_id, 'review.item_projection_v1', 1
  );
  v_response := pg_catalog.jsonb_build_object(
    'commandId', v_command_id,
    'subjectId', v_subject_id,
    'reasonId', v_reason_id,
    'subjectVersion', v_current_watermark::text,
    'projectionState', 'pending',
    'emittedEventIds', pg_catalog.jsonb_build_array(v_event_id)
  );
  update outbox.command_receipts
  set command_status = 'completed', response = v_response,
      emitted_event_ids = array[v_event_id], completed_at = clock_timestamp()
  where command_id = v_command_id;
  return v_response;
end
$function$;

create function api.reschedule_review_reason_v1(
  p_subject_id uuid, p_reason_id uuid,
  p_expected_projection_version bigint, p_expected_source_revision bigint,
  p_local_due_at text, p_idempotency_key text
)
returns jsonb language sql security definer set search_path = ''
as $function$
  select review.apply_reason_action_impl(
    'review.reschedule_reason', 'RESCHEDULE', p_subject_id, p_reason_id,
    p_expected_projection_version, p_expected_source_revision,
    p_local_due_at, p_idempotency_key
  )
$function$;

create function api.skip_review_reason_once_v1(
  p_subject_id uuid, p_reason_id uuid,
  p_expected_projection_version bigint, p_expected_source_revision bigint,
  p_idempotency_key text
)
returns jsonb language sql security definer set search_path = ''
as $function$
  select review.apply_reason_action_impl(
    'review.skip_reason_once', 'SKIP_ONCE', p_subject_id, p_reason_id,
    p_expected_projection_version, p_expected_source_revision,
    null, p_idempotency_key
  )
$function$;

create function api.suppress_review_reason_v1(
  p_subject_id uuid, p_reason_id uuid,
  p_expected_projection_version bigint, p_expected_source_revision bigint,
  p_idempotency_key text
)
returns jsonb language sql security definer set search_path = ''
as $function$
  select review.apply_reason_action_impl(
    'review.suppress_reason', 'SUPPRESS', p_subject_id, p_reason_id,
    p_expected_projection_version, p_expected_source_revision,
    null, p_idempotency_key
  )
$function$;

create function api.restore_review_reason_v1(
  p_subject_id uuid, p_reason_id uuid,
  p_expected_projection_version bigint, p_expected_source_revision bigint,
  p_idempotency_key text
)
returns jsonb language sql security definer set search_path = ''
as $function$
  select review.apply_reason_action_impl(
    'review.restore_reason', 'RESTORE', p_subject_id, p_reason_id,
    p_expected_projection_version, p_expected_source_revision,
    null, p_idempotency_key
  )
$function$;

create function api.get_review_workspace_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_workspace_id uuid;
  v_time_zone text;
  v_as_of timestamptz := pg_catalog.statement_timestamp();
  v_next_midnight timestamptz;
  v_items jsonb;
  v_projection_state text;
begin
  v_workspace_id := identity.personal_workspace_id_for_current_user();
  v_time_zone := identity.current_review_time_zone_v1();
  if v_workspace_id is null or v_time_zone is null then
    raise exception using errcode = '42501', message = 'workspace is not accessible';
  end if;
  v_next_midnight := (
    pg_catalog.date_trunc('day', v_as_of at time zone v_time_zone) + interval '1 day'
  ) at time zone v_time_zone;

  select coalesce(pg_catalog.jsonb_agg(item.value order by
    item.bucket_order, item.effective_due_at nulls last, item.subject_ref, item.subject_id
  ), '[]'::jsonb)
  into v_items
  from (
    select current_item.subject_id,
      current_item.subject_ref,
      current_item.effective_due_at,
      case bucket.value
        when 'SUPPRESSED' then 5
        when 'OVERDUE' then 1
        when 'DUE_TODAY' then 2
        when 'PERSONAL_REMINDER' then 4
        else 3
      end as bucket_order,
      pg_catalog.jsonb_build_object(
        'subjectId', current_item.subject_id,
        'subjectRef', current_item.subject_ref,
        'competencyRef', current_item.competency_ref,
        'dimension', current_item.dimension,
        'title', coalesce(
          current_item.activity_title,
          current_item.competency_ref || ' · ' ||
            pg_catalog.initcap(pg_catalog.replace(pg_catalog.lower(current_item.dimension), '_', ' '))
        ),
        'effectiveDueAt', current_item.effective_due_at,
        'bucket', bucket.value,
        'projectionVersion', subject.input_watermark::text,
        'reasons', reasons.value,
        'focus', case when current_item.activity_key is null then null else
          pg_catalog.jsonb_build_object(
            'readinessGoalKey', current_item.readiness_goal_key,
            'activityKey', current_item.activity_key
          )
        end
      ) as value
    from review.items as current_item
    join review.subject_ledgers as subject
      on subject.workspace_id = current_item.workspace_id
     and subject.subject_id = current_item.subject_id
    cross join lateral (
      select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'reasonId', reason.reason_id,
        'reasonType', reason.reason_type,
        'dueAt', reason.due_at,
        'status', case when reason.suppressed then 'suppressed' else 'active' end,
        'sourceRevision', reason.source_revision::text
      ) order by reason.due_at, reason.reason_type, reason.reason_id), '[]'::jsonb) as value,
      count(*) filter (where reason.active) as active_count,
      count(*) filter (where reason.active and reason.reason_type = 'PERSONAL_REMINDER')
        as active_reminder_count,
      count(*) filter (where reason.suppressed) as suppressed_count
      from review.item_reasons as reason
      where reason.workspace_id = current_item.workspace_id
        and reason.subject_id = current_item.subject_id
        and (reason.active or reason.suppressed)
    ) as reasons
    cross join lateral (
      select case
        when reasons.active_count = 0 and reasons.suppressed_count > 0 then 'SUPPRESSED'
        when current_item.effective_due_at < v_as_of then 'OVERDUE'
        when current_item.effective_due_at < v_next_midnight then 'DUE_TODAY'
        when reasons.active_count = reasons.active_reminder_count then 'PERSONAL_REMINDER'
        else 'UPCOMING'
      end as value
    ) as bucket
    where current_item.workspace_id = v_workspace_id
      and (reasons.active_count > 0 or reasons.suppressed_count > 0)
    order by bucket_order, current_item.effective_due_at nulls last,
      current_item.subject_ref, current_item.subject_id
    limit 100
  ) as item;

  select case
    when exists (
      select 1
      from review.subject_ledgers as subject
      left join review.items as item
        on item.workspace_id = subject.workspace_id and item.subject_id = subject.subject_id
      where subject.workspace_id = v_workspace_id
        and (item.subject_id is null or item.input_watermark < subject.input_watermark)
    ) then 'pending'
    when exists (
      select 1 from review.items as item where item.workspace_id = v_workspace_id
    ) then 'current'
    else 'not_started'
  end into v_projection_state;

  return pg_catalog.jsonb_build_object(
    'contract', pg_catalog.jsonb_build_object('name', 'ReviewWorkspaceV1', 'version', '1.0.0'),
    'asOf', v_as_of,
    'timeZone', v_time_zone,
    'projectionState', v_projection_state,
    'items', v_items
  );
end
$function$;

alter function review.local_timestamp_to_instant_v1(timestamp, text)
  owner to pando_review_api;
alter function review.calendar_day_to_instant_v1(timestamp, text)
  owner to pando_review_api;
alter function review.apply_reason_action_impl(text, text, uuid, uuid, bigint, bigint, text, text)
  owner to pando_review_api;
alter function api.create_personal_review_reminder_v1(text, text, text, bigint, text)
  owner to pando_review_api;
alter function api.reschedule_review_reason_v1(uuid, uuid, bigint, bigint, text, text)
  owner to pando_review_api;
alter function api.skip_review_reason_once_v1(uuid, uuid, bigint, bigint, text)
  owner to pando_review_api;
alter function api.suppress_review_reason_v1(uuid, uuid, bigint, bigint, text)
  owner to pando_review_api;
alter function api.restore_review_reason_v1(uuid, uuid, bigint, bigint, text)
  owner to pando_review_api;
alter function api.get_review_workspace_v1() owner to pando_review_api;

revoke all on function
  review.local_timestamp_to_instant_v1(timestamp, text),
  review.calendar_day_to_instant_v1(timestamp, text),
  review.apply_reason_action_impl(text, text, uuid, uuid, bigint, bigint, text, text),
  api.create_personal_review_reminder_v1(text, text, text, bigint, text),
  api.reschedule_review_reason_v1(uuid, uuid, bigint, bigint, text, text),
  api.skip_review_reason_once_v1(uuid, uuid, bigint, bigint, text),
  api.suppress_review_reason_v1(uuid, uuid, bigint, bigint, text),
  api.restore_review_reason_v1(uuid, uuid, bigint, bigint, text),
  api.get_review_workspace_v1()
  from public, anon, authenticated, service_role;
grant execute on function review.local_timestamp_to_instant_v1(timestamp, text)
  to service_role;
grant execute on function review.calendar_day_to_instant_v1(timestamp, text)
  to service_role;
grant execute on function
  api.create_personal_review_reminder_v1(text, text, text, bigint, text),
  api.reschedule_review_reason_v1(uuid, uuid, bigint, bigint, text, text),
  api.skip_review_reason_once_v1(uuid, uuid, bigint, bigint, text),
  api.suppress_review_reason_v1(uuid, uuid, bigint, bigint, text),
  api.restore_review_reason_v1(uuid, uuid, bigint, bigint, text),
  api.get_review_workspace_v1()
  to authenticated;

revoke create on schema api, review from pando_review_api;
do $migration_role_membership$
begin
  execute pg_catalog.format('revoke pando_review_api from %I', current_user);
end
$migration_role_membership$;
