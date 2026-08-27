-- Fixed service-only Review projection worker. The caller can select only a leased delivery and
-- return a pure Review calculation for the authoritative inputs loaded here.

do $migration_role_membership$
begin
  execute pg_catalog.format('grant pando_review_worker to %I with set true', current_user);
end
$migration_role_membership$;

grant create on schema outbox, review to pando_review_worker;
grant usage on schema outbox, review to service_role;

create function review.stable_uuid(p_scope text)
returns uuid
language sql
stable
strict
set search_path = ''
as $function$
  with hash as (select pg_catalog.md5(p_scope) as value)
  select (
    pg_catalog.substr(value, 1, 8) || '-' ||
    pg_catalog.substr(value, 9, 4) || '-5' ||
    pg_catalog.substr(value, 14, 3) || '-a' ||
    pg_catalog.substr(value, 18, 3) || '-' ||
    pg_catalog.substr(value, 21, 12)
  )::uuid
  from hash
$function$;

create function outbox.claim_review_item_projection_impl()
returns table (
  delivery_id uuid,
  event_id uuid,
  event_position bigint,
  workspace_id uuid,
  lease_token uuid,
  lease_expires_at timestamptz,
  attempt_count smallint,
  event_name text,
  event_schema_version smallint,
  payload jsonb
)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  update outbox.deliveries as exhausted
  set delivery_state = 'dead_letter',
      lease_token = null,
      lease_expires_at = null,
      last_failure_class = 'EXHAUSTED',
      last_error_code = 'LEASE_EXPIRED_AFTER_MAX_ATTEMPTS',
      last_failed_at = clock_timestamp(),
      dead_lettered_at = clock_timestamp()
  where exhausted.consumer_name = 'review.item_projection_v1'
    and exhausted.handler_contract_version = 1
    and exhausted.delivery_state = 'leased'
    and exhausted.lease_expires_at <= clock_timestamp()
    and exhausted.attempt_count >= 8;

  return query
  with candidates as (
    select delivery.delivery_id
    from outbox.deliveries as delivery
    join outbox.events as candidate_event
      on candidate_event.workspace_id = delivery.workspace_id
     and candidate_event.event_id = delivery.event_id
    where delivery.consumer_name = 'review.item_projection_v1'
      and delivery.handler_contract_version = 1
      and delivery.attempt_count < 8
      and delivery.available_at <= clock_timestamp()
      and (
        delivery.delivery_state in ('pending', 'retry')
        or (
          delivery.delivery_state = 'leased'
          and delivery.lease_expires_at <= clock_timestamp()
        )
      )
      and not exists (
        select 1
        from outbox.deliveries as earlier
        join outbox.events as earlier_event
          on earlier_event.workspace_id = earlier.workspace_id
         and earlier_event.event_id = earlier.event_id
        where earlier.workspace_id = delivery.workspace_id
          and earlier.consumer_name = 'review.item_projection_v1'
          and earlier.handler_contract_version = 1
          and earlier.delivery_state in ('pending', 'retry', 'leased')
          and earlier_event.event_position < candidate_event.event_position
      )
    order by candidate_event.event_position, delivery.delivery_id
    for update of delivery skip locked
    limit 5
  ), claimed as (
    update outbox.deliveries as delivery
    set delivery_state = 'leased',
        attempt_count = delivery.attempt_count + 1,
        lease_token = gen_random_uuid(),
        lease_expires_at = clock_timestamp() + interval '2 minutes',
        last_failure_class = null,
        last_error_code = null,
        last_failed_at = null
    from candidates
    where delivery.delivery_id = candidates.delivery_id
    returning delivery.*
  )
  select claimed.delivery_id, claimed.event_id, event.event_position, claimed.workspace_id,
    claimed.lease_token, claimed.lease_expires_at, claimed.attempt_count,
    event.event_name, event.event_schema_version, event.payload
  from claimed
  join outbox.events as event
    on event.workspace_id = claimed.workspace_id and event.event_id = claimed.event_id
  order by event.event_position, claimed.delivery_id;
end
$function$;

create function review.projection_event_v1_is_valid(p_event outbox.events)
returns boolean
language sql
immutable
set search_path = ''
as $function$
  select case (p_event).event_name
    when 'mastery.competency_state_changed' then
      (p_event).event_schema_version = 1
      and (p_event).aggregate_type is null
      and (p_event).aggregate_id is null
      and (p_event).aggregate_version is null
      and (p_event).actor_type = 'system'
      and (p_event).actor_user_id is null
      and (p_event).source = 'pando.mastery_worker'
      and ((p_event).payload->>'competency_ref') ~
        '^competency:[a-z0-9][a-z0-9-]{1,100}$'
      and ((p_event).payload->>'snapshot_id') ~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and ((p_event).payload->>'input_watermark') ~ '^[1-9][0-9]{0,18}$'
      and ((p_event).payload->>'achievement_level') in (
        'NOT_STARTED', 'COMPLETED', 'VERIFIED', 'MASTERED'
      )
      and (p_event).payload->>'projection_generation' = 'live-v1'
      and (p_event).payload->>'engine_version' = 'mastery-engine/0.1.0'
      and (p_event).payload->>'policy_version' = 'mastery-readiness-policy/0.1'
      and ((p_event).payload->>'calculated_as_of')::timestamptz is not null
      and not exists (
        select 1 from pg_catalog.jsonb_object_keys((p_event).payload) as payload_key(key)
        where payload_key.key not in (
          'competency_ref', 'snapshot_id', 'projection_generation', 'input_watermark',
          'achievement_level', 'engine_version', 'policy_version', 'calculated_as_of'
        )
      )
    when 'review.input_changed' then
      (p_event).event_schema_version = 1
      and (p_event).aggregate_type = 'review.subject'
      and (p_event).aggregate_id is not null
      and (p_event).aggregate_version is not null
      and (p_event).actor_type = 'user'
      and (p_event).actor_user_id is not null
      and (p_event).source = 'pando.database'
      and ((p_event).payload->>'subject_id')::uuid = (p_event).aggregate_id
      and (p_event).payload->>'subject_ref' ~
        '^competency:[a-z0-9][a-z0-9-]{1,100}/(knowledge|recall|application|interview_execution)$'
      and ((p_event).payload->>'input_watermark') ~ '^[1-9][0-9]{0,18}$'
      and ((p_event).payload->>'input_watermark')::bigint = (p_event).aggregate_version
      and not exists (
        select 1 from pg_catalog.jsonb_object_keys((p_event).payload) as payload_key(key)
        where payload_key.key not in ('subject_id', 'subject_ref', 'input_watermark')
      )
    else false
  end
$function$;

create function review.load_subject_projection_input_v1(
  p_workspace_id uuid,
  p_subject_id uuid,
  p_subject_ref text,
  p_competency_ref text,
  p_dimension text,
  p_mastery_signal jsonb
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'subjectId', p_subject_id,
    'subjectRef', p_subject_ref,
    'competencyRef', p_competency_ref,
    'dimension', p_dimension,
    'currentInputWatermark', coalesce(subject.input_watermark, 0)::text,
    'currentMasterySnapshotId', subject.mastery_snapshot_id,
    'currentMasteryInputWatermark', subject.mastery_input_watermark::text,
    'currentMasteryProjectionVersion', subject.mastery_projection_version::text,
    'focus', case when subject.activity_key is null then null else
      pg_catalog.jsonb_build_object(
        'readinessGoalKey', subject.readiness_goal_key,
        'activityKey', subject.activity_key,
        'activityTitle', subject.activity_title
      )
    end,
    'masterySignal', p_mastery_signal,
    'reasonIdentities', case when p_mastery_signal is null then '[]'::jsonb else
      pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'reasonId', review.stable_uuid(
            p_workspace_id::text || ':' || p_subject_ref || ':RETENTION_RISK'
          ),
          'sourceKey', 'mastery:' || p_subject_ref || ':retention',
          'reason', 'RETENTION_RISK'
        ),
        pg_catalog.jsonb_build_object(
          'reasonId', review.stable_uuid(
            p_workspace_id::text || ':' || p_subject_ref || ':VERIFICATION_NEEDED'
          ),
          'sourceKey', 'mastery:' || p_subject_ref || ':verification',
          'reason', 'VERIFICATION_NEEDED'
        )
      )
    end,
    'sourceEvents', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'eventId', source.source_event_id,
        'reasonId', source.reason_id,
        'sourceKey', source.source_key,
        'sourceRevision', source.source_revision,
        'sourceKind', source.source_kind,
        'subjectId', source.subject_id,
        'reason', source.reason_type,
        'occurrenceId', source.occurrence_id,
        'baseDueAt', source.base_due_at,
        'sourceActive', source.source_active
      ) order by source.source_key, source.source_revision, source.source_event_id)
      from review.reason_source_events as source
      where source.workspace_id = p_workspace_id and source.subject_id = p_subject_id
    ), '[]'::jsonb),
    'actionEvents', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'actionId', action.action_id,
        'actionRevision', action.action_revision,
        'sourceKey', action.source_key,
        'occurrenceId', action.occurrence_id,
        'action', action.action_type,
        'occurredAt', action.occurred_at,
        'targetDueAt', case when action.action_type in ('RESCHEDULE', 'SKIP_ONCE')
          then action.new_due_at else null end
      ) order by action.action_revision, action.action_id)
      from review.action_events as action
      where action.workspace_id = p_workspace_id and action.subject_id = p_subject_id
    ), '[]'::jsonb)
  )
  from (select 1) as singleton
  left join review.subject_ledgers as subject
    on subject.workspace_id = p_workspace_id and subject.subject_id = p_subject_id
$function$;

create function review.load_item_projection_input_impl(
  p_delivery_id uuid,
  p_lease_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_delivery outbox.deliveries%rowtype;
  v_event outbox.events%rowtype;
  v_mastery jsonb;
  v_dimension jsonb;
  v_subject review.subject_ledgers%rowtype;
  v_subject_id uuid;
  v_subject_ref text;
  v_subjects jsonb := '[]'::jsonb;
  v_calculated_as_of timestamptz;
begin
  select delivery.* into v_delivery
  from outbox.deliveries as delivery
  where delivery.delivery_id = p_delivery_id
    and delivery.consumer_name = 'review.item_projection_v1'
    and delivery.handler_contract_version = 1;
  if not found or v_delivery.delivery_state <> 'leased'
     or v_delivery.lease_token is distinct from p_lease_token
     or v_delivery.lease_expires_at <= clock_timestamp() then
    raise exception using errcode = '42501', message = 'review delivery lease is not valid';
  end if;
  select event.* into strict v_event
  from outbox.events as event
  where event.workspace_id = v_delivery.workspace_id and event.event_id = v_delivery.event_id;
  if review.projection_event_v1_is_valid(v_event) is not true then
    raise exception using errcode = '22023', message = 'review delivery event contract is invalid';
  end if;

  if v_event.event_name = 'mastery.competency_state_changed' then
    v_calculated_as_of := pg_catalog.date_trunc('milliseconds', v_event.recorded_at);
    v_mastery := mastery.get_review_signals_v1(
      v_delivery.workspace_id, v_event.payload->>'competency_ref'
    );
    if v_mastery is null then
      raise exception using errcode = '22023', message = 'mastery review signal is unavailable';
    end if;
    for v_dimension in
      select value from pg_catalog.jsonb_array_elements(v_mastery->'dimensions') as item(value)
    loop
      v_subject_ref := (v_mastery->>'competencyRef') || '/' ||
        pg_catalog.lower(v_dimension->>'dimension');
      select subject.* into v_subject
      from review.subject_ledgers as subject
      where subject.workspace_id = v_delivery.workspace_id
        and subject.subject_ref = v_subject_ref;
      if not found and v_dimension->>'latestSupportingEvidenceId' is null then
        continue;
      end if;
      v_subject_id := coalesce(
        v_subject.subject_id,
        review.stable_uuid(v_delivery.workspace_id::text || ':' || v_subject_ref)
      );
      v_subjects := v_subjects || pg_catalog.jsonb_build_array(
        review.load_subject_projection_input_v1(
          v_delivery.workspace_id,
          v_subject_id,
          v_subject_ref,
          v_mastery->>'competencyRef',
          v_dimension->>'dimension',
          v_dimension || pg_catalog.jsonb_build_object(
            'snapshotId', v_mastery->>'snapshotId',
            'inputWatermark', v_mastery->>'inputWatermark',
            'projectionVersion', v_mastery->>'projectionVersion'
          )
        )
      );
    end loop;
  else
    select subject.* into strict v_subject
    from review.subject_ledgers as subject
    where subject.workspace_id = v_delivery.workspace_id
      and subject.subject_id = (v_event.payload->>'subject_id')::uuid
      and subject.subject_ref = v_event.payload->>'subject_ref'
      and subject.input_watermark >= (v_event.payload->>'input_watermark')::bigint;
    select pg_catalog.date_trunc('milliseconds', current_event.recorded_at)
    into strict v_calculated_as_of
    from outbox.events as current_event
    where current_event.workspace_id = v_delivery.workspace_id
      and current_event.event_name = 'review.input_changed'
      and current_event.aggregate_type = 'review.subject'
      and current_event.aggregate_id = v_subject.subject_id
      and current_event.aggregate_version = v_subject.input_watermark
    order by current_event.event_position desc
    limit 1;
    v_subjects := pg_catalog.jsonb_build_array(
      review.load_subject_projection_input_v1(
        v_delivery.workspace_id,
        v_subject.subject_id,
        v_subject.subject_ref,
        v_subject.competency_ref,
        v_subject.dimension,
        null
      )
    );
  end if;

  return pg_catalog.jsonb_build_object(
    'deliveryId', v_delivery.delivery_id,
    'eventId', v_delivery.event_id,
    'eventPosition', v_event.event_position::text,
    'eventName', v_event.event_name,
    'workspaceId', v_delivery.workspace_id,
    'calculatedAsOf', v_calculated_as_of,
    'subjects', v_subjects
  );
end
$function$;

create function outbox.fail_review_item_projection_impl(
  p_delivery_id uuid,
  p_lease_token uuid,
  p_failure_class text,
  p_error_code text
)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_delivery outbox.deliveries%rowtype;
  v_next_state text;
  v_base_delay_seconds integer;
  v_retry_delay_seconds integer;
begin
  if p_failure_class not in ('TRANSIENT', 'STALE_INPUT', 'INVALID_CONTRACT')
     or p_error_code is null or p_error_code !~ '^[A-Z][A-Z0-9_]{1,63}$' then
    raise exception using errcode = '22023', message = 'worker failure input is invalid';
  end if;
  select delivery.* into v_delivery
  from outbox.deliveries as delivery
  where delivery.delivery_id = p_delivery_id
    and delivery.consumer_name = 'review.item_projection_v1'
    and delivery.handler_contract_version = 1
  for update;
  if not found or v_delivery.delivery_state <> 'leased'
     or v_delivery.lease_token is distinct from p_lease_token then
    raise exception using errcode = '42501', message = 'review delivery lease is not valid';
  end if;
  v_next_state := case
    when p_failure_class = 'INVALID_CONTRACT' or v_delivery.attempt_count >= 8
      then 'dead_letter'
    else 'retry'
  end;
  v_base_delay_seconds := least(
    900,
    (5 * pg_catalog.power(2, greatest(v_delivery.attempt_count - 1, 0)))::integer
  );
  v_retry_delay_seconds := least(
    900,
    v_base_delay_seconds
      + pg_catalog.floor(pg_catalog.random() * greatest(1, v_base_delay_seconds / 5.0))::integer
  );
  update outbox.deliveries
  set delivery_state = v_next_state,
      available_at = case when v_next_state = 'retry'
        then clock_timestamp() + pg_catalog.make_interval(secs => v_retry_delay_seconds)
        else available_at end,
      lease_token = null,
      lease_expires_at = null,
      last_failure_class = p_failure_class,
      last_error_code = p_error_code,
      last_failed_at = clock_timestamp(),
      dead_lettered_at = case when v_next_state = 'dead_letter' then clock_timestamp() end
  where delivery_id = v_delivery.delivery_id;
  return v_next_state;
end
$function$;

create function outbox.get_review_projection_health_impl()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'states', coalesce((
      select pg_catalog.jsonb_object_agg(state.delivery_state, state.delivery_count)
      from (
        select delivery.delivery_state, count(*) as delivery_count
        from outbox.deliveries as delivery
        where delivery.consumer_name = 'review.item_projection_v1'
        group by delivery.delivery_state
        order by delivery.delivery_state
      ) as state
    ), '{}'::jsonb),
    'failures', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'failureClass', failure.last_failure_class,
        'errorCode', failure.last_error_code,
        'deliveryState', failure.delivery_state,
        'count', failure.delivery_count
      ) order by failure.last_failure_class, failure.last_error_code, failure.delivery_state)
      from (
        select delivery.last_failure_class, delivery.last_error_code,
          delivery.delivery_state, count(*) as delivery_count
        from outbox.deliveries as delivery
        where delivery.consumer_name = 'review.item_projection_v1'
          and delivery.last_error_code is not null
        group by delivery.last_failure_class, delivery.last_error_code, delivery.delivery_state
      ) as failure
    ), '[]'::jsonb)
  )
$function$;

create function review.expected_mastery_source_changes_v1(
  p_workspace_id uuid,
  p_subject_id uuid,
  p_subject_ref text,
  p_mastery_signal jsonb
)
returns table (
  reason_id uuid,
  source_key text,
  source_revision bigint,
  source_kind text,
  subject_id uuid,
  reason_type text,
  occurrence_id uuid,
  base_due_at timestamptz,
  source_active boolean
)
language sql
stable
security definer
set search_path = ''
as $function$
  with identities(reason_type, source_suffix, source_active) as (
    values
      (
        'RETENTION_RISK'::text,
        'retention'::text,
        (p_mastery_signal->>'achievementLevel') <> 'NOT_STARTED'
      ),
      (
        'VERIFICATION_NEEDED'::text,
        'verification'::text,
        (p_mastery_signal->>'achievementLevel') = 'COMPLETED'
      )
  ), authoritative as (
    select
      identity.reason_type,
      'mastery:' || p_subject_ref || ':' || identity.source_suffix as source_key,
      identity.source_active,
      nullif(p_mastery_signal->>'latestQualifyingSuccessAt', '')::timestamptz as anchor_at,
      nullif(p_mastery_signal->>'latestSupportingEvidenceId', '')::uuid as occurrence_id
    from identities as identity
  ), with_previous as (
    select authoritative.*, previous.source_event_id,
      previous.reason_id as previous_reason_id,
      previous.source_revision as previous_revision,
      previous.occurrence_id as previous_occurrence_id,
      previous.base_due_at as previous_base_due_at,
      previous.source_active as previous_source_active
    from authoritative
    left join lateral (
      select source.source_event_id, source.reason_id, source.source_revision,
        source.occurrence_id, source.base_due_at, source.source_active
      from review.reason_source_events as source
      where source.workspace_id = p_workspace_id
        and source.subject_id = p_subject_id
        and source.source_key = authoritative.source_key
      order by source.source_revision desc, source.source_event_id
      limit 1
    ) as previous on true
  ), expected as (
    select
      coalesce(
        previous_reason_id,
        review.stable_uuid(
          p_workspace_id::text || ':' || p_subject_ref || ':' || reason_type
        )
      ) as reason_id,
      source_key,
      coalesce(previous_revision + 1, 1) as source_revision,
      'MASTERY'::text as source_kind,
      p_subject_id as subject_id,
      reason_type,
      case when anchor_at is null or occurrence_id is null
        then previous_occurrence_id else occurrence_id end as occurrence_id,
      case when anchor_at is null or occurrence_id is null
        then previous_base_due_at else anchor_at + interval '3 days' end as base_due_at,
      case when anchor_at is null or occurrence_id is null
        then false else source_active end as source_active
    from with_previous
    where (
      (anchor_at is null or occurrence_id is null)
      and source_event_id is not null
      and previous_source_active
    ) or (
      anchor_at is not null
      and occurrence_id is not null
      and (
        source_event_id is null
        or previous_occurrence_id is distinct from occurrence_id
        or previous_base_due_at is distinct from anchor_at + interval '3 days'
        or previous_source_active is distinct from source_active
      )
    )
  )
  select expected.reason_id, expected.source_key, expected.source_revision,
    expected.source_kind, expected.subject_id, expected.reason_type,
    expected.occurrence_id, expected.base_due_at, expected.source_active
  from expected
  order by expected.source_key
$function$;

create function review.expected_effective_reasons_v1(
  p_workspace_id uuid,
  p_subject_id uuid,
  p_new_source_events jsonb
)
returns table (
  reason_id uuid,
  source_key text,
  source_revision bigint,
  source_kind text,
  reason_type text,
  occurrence_id uuid,
  base_due_at timestamptz,
  due_at timestamptz,
  source_active boolean,
  suppressed boolean,
  active boolean
)
language sql
stable
security definer
set search_path = ''
as $function$
  with all_sources as (
    select source.source_event_id, source.reason_id, source.source_key,
      source.source_revision, source.source_kind, source.reason_type,
      source.occurrence_id, source.base_due_at, source.source_active
    from review.reason_source_events as source
    where source.workspace_id = p_workspace_id and source.subject_id = p_subject_id
    union all
    select (value->>'eventId')::uuid, (value->>'reasonId')::uuid,
      value->>'sourceKey', (value->>'sourceRevision')::bigint,
      value->>'sourceKind', value->>'reason', (value->>'occurrenceId')::uuid,
      (value->>'baseDueAt')::timestamptz, (value->>'sourceActive')::boolean
    from pg_catalog.jsonb_array_elements(p_new_source_events) as event(value)
  ), latest_sources as (
    select distinct on (source.source_key) source.*
    from all_sources as source
    order by source.source_key, source.source_revision desc, source.source_event_id
  )
  select source.reason_id, source.source_key, source.source_revision,
    source.source_kind, source.reason_type, source.occurrence_id,
    source.base_due_at, coalesce(due_action.new_due_at, source.base_due_at) as due_at,
    source.source_active,
    coalesce(suppression.action_type = 'SUPPRESS', false) as suppressed,
    source.source_active and not coalesce(suppression.action_type = 'SUPPRESS', false) as active
  from latest_sources as source
  left join lateral (
    select action.new_due_at
    from review.action_events as action
    where action.workspace_id = p_workspace_id
      and action.subject_id = p_subject_id
      and action.source_key = source.source_key
      and action.occurrence_id = source.occurrence_id
      and action.action_type in ('RESCHEDULE', 'SKIP_ONCE')
    order by action.action_revision desc, action.action_id
    limit 1
  ) as due_action on true
  left join lateral (
    select action.action_type
    from review.action_events as action
    where action.workspace_id = p_workspace_id
      and action.subject_id = p_subject_id
      and action.source_key = source.source_key
      and action.action_type in ('SUPPRESS', 'RESTORE')
    order by action.action_revision desc, action.action_id
    limit 1
  ) as suppression on true
  order by coalesce(due_action.new_due_at, source.base_due_at),
    source.reason_type, source.source_key
$function$;

create function review.complete_item_projection_impl(
  p_delivery_id uuid,
  p_lease_token uuid,
  p_expected_event_position bigint,
  p_subjects jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_delivery outbox.deliveries%rowtype;
  v_event outbox.events%rowtype;
  v_subject jsonb;
  v_source jsonb;
  v_reason jsonb;
  v_current review.subject_ledgers%rowtype;
  v_mastery jsonb;
  v_expected_watermark bigint;
  v_next_watermark bigint;
  v_subject_id uuid;
  v_subject_ref text;
  v_competency_ref text;
  v_dimension text;
  v_new_source_count integer;
  v_snapshot_id uuid;
  v_effective_due_at timestamptz;
  v_projection_rows integer;
  v_active_reason_types jsonb;
  v_projection_status text;
  v_focus jsonb;
  v_authoritative_input jsonb;
  v_authoritative_subject jsonb;
  v_expected_source_count integer;
  v_expected_reason_count integer;
  v_expected_active_count integer;
  v_expected_due_at timestamptz;
  v_expected_timing text;
  v_expected_replayed_source_ids jsonb;
  v_expected_replayed_action_ids jsonb;
  v_expected_replayed_effective_ids jsonb;
begin
  perform 1 from outbox.consumer_receipts as receipt
  where receipt.delivery_id = p_delivery_id
    and receipt.consumer_name = 'review.item_projection_v1';
  if found then
    return true;
  end if;

  select delivery.* into v_delivery
  from outbox.deliveries as delivery
  where delivery.delivery_id = p_delivery_id
    and delivery.consumer_name = 'review.item_projection_v1'
    and delivery.handler_contract_version = 1
  for update;
  if not found or v_delivery.delivery_state <> 'leased'
     or v_delivery.lease_token is distinct from p_lease_token
     or v_delivery.lease_expires_at <= clock_timestamp() then
    raise exception using errcode = '42501', message = 'review delivery lease is not valid';
  end if;
  select event.* into strict v_event
  from outbox.events as event
  where event.workspace_id = v_delivery.workspace_id and event.event_id = v_delivery.event_id;
  if v_event.event_position <> p_expected_event_position
     or review.projection_event_v1_is_valid(v_event) is not true then
    raise exception using errcode = '22023', message = 'review event contract is invalid';
  end if;
  if p_subjects is null or pg_catalog.jsonb_typeof(p_subjects) <> 'array'
     or pg_catalog.jsonb_array_length(p_subjects) > 4
     or pg_catalog.pg_column_size(p_subjects) > 262144
     or exists (
       select 1
       from pg_catalog.jsonb_array_elements(p_subjects) as subject(value)
       group by subject.value->>'subjectId'
       having count(*) > 1
     ) then
    raise exception using errcode = '22023', message = 'review projection subjects are invalid';
  end if;

  v_authoritative_input := review.load_item_projection_input_impl(
    p_delivery_id, p_lease_token
  );
  if pg_catalog.jsonb_array_length(p_subjects) <>
     pg_catalog.jsonb_array_length(v_authoritative_input->'subjects') then
    raise exception using errcode = '22023',
      message = 'review projection omitted or added an authoritative subject';
  end if;

  -- Lock every Review subject in stable order and fence the complete batch before any write.
  for v_subject in
    select value
    from pg_catalog.jsonb_array_elements(p_subjects) as subject(value)
    order by value->>'subjectId'
  loop
    if pg_catalog.jsonb_typeof(v_subject) <> 'object'
       or (v_subject->>'subjectId') !~
         '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or (v_subject->>'subjectRef') !~
         '^competency:[a-z0-9][a-z0-9-]{1,100}/(knowledge|recall|application|interview_execution)$'
       or (v_subject->>'competencyRef') !~ '^competency:[a-z0-9][a-z0-9-]{1,100}$'
       or (v_subject->>'dimension') not in (
         'KNOWLEDGE', 'RECALL', 'APPLICATION', 'INTERVIEW_EXECUTION'
       )
       or v_subject->>'subjectRef' <>
         (v_subject->>'competencyRef') || '/' || pg_catalog.lower(v_subject->>'dimension')
       or (v_subject->>'expectedInputWatermark') !~ '^[0-9]{1,19}$'
       or (v_subject->>'nextInputWatermark') !~ '^[1-9][0-9]{0,18}$'
       or pg_catalog.jsonb_typeof(v_subject->'newSourceEvents') <> 'array'
       or pg_catalog.jsonb_typeof(v_subject->'state') <> 'object'
       or exists (
         select 1 from pg_catalog.jsonb_object_keys(v_subject) as subject_key(key)
         where subject_key.key not in (
           'subjectId', 'subjectRef', 'competencyRef', 'dimension',
           'expectedInputWatermark', 'nextInputWatermark', 'masterySnapshotId',
           'masteryInputWatermark', 'masteryProjectionVersion', 'focus',
           'newSourceEvents', 'state'
         )
       ) then
      raise exception using errcode = '22023', message = 'review projection subject is invalid';
    end if;
    v_subject_id := (v_subject->>'subjectId')::uuid;
    v_expected_watermark := (v_subject->>'expectedInputWatermark')::bigint;
    v_next_watermark := (v_subject->>'nextInputWatermark')::bigint;
    select authoritative.value into v_authoritative_subject
    from pg_catalog.jsonb_array_elements(
      v_authoritative_input->'subjects'
    ) as authoritative(value)
    where authoritative.value->>'subjectId' = v_subject_id::text;
    if not found
       or v_subject->>'subjectRef' is distinct from v_authoritative_subject->>'subjectRef'
       or v_subject->>'competencyRef' is distinct from v_authoritative_subject->>'competencyRef'
       or v_subject->>'dimension' is distinct from v_authoritative_subject->>'dimension'
       or v_subject->>'expectedInputWatermark' is distinct from
         v_authoritative_subject->>'currentInputWatermark'
       or v_subject->'focus' is distinct from coalesce(
         v_authoritative_subject->'masterySignal'->'focus',
         v_authoritative_subject->'focus'
       ) then
      raise exception using errcode = '22023',
        message = 'review projection subject does not match authoritative input';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      v_delivery.workspace_id::text || ':review:' || v_subject_id::text, 5
    ));
    select subject.* into v_current
    from review.subject_ledgers as subject
    where subject.workspace_id = v_delivery.workspace_id and subject.subject_id = v_subject_id
    for update;
    if found then
      if v_current.input_watermark <> v_expected_watermark
         or v_current.subject_ref <> v_subject->>'subjectRef' then
        return false;
      end if;
    elsif v_event.event_name <> 'mastery.competency_state_changed'
          or v_expected_watermark <> 0 then
      return false;
    end if;

    v_new_source_count := pg_catalog.jsonb_array_length(v_subject->'newSourceEvents');
    if (
      (v_event.event_name = 'mastery.competency_state_changed'
       and v_next_watermark <> v_expected_watermark +
         case when v_new_source_count > 0 then 1 else 0 end)
      or
      (v_event.event_name = 'review.input_changed'
       and (v_new_source_count <> 0 or v_next_watermark <> v_expected_watermark))
    ) then
      raise exception using errcode = '22023', message = 'review input watermark transition is invalid';
    end if;

    if v_event.event_name = 'mastery.competency_state_changed' then
      v_mastery := v_authoritative_subject->'masterySignal';
      if v_mastery is null
         or v_mastery = 'null'::jsonb
         or v_mastery->>'snapshotId' is distinct from v_subject->>'masterySnapshotId'
         or v_mastery->>'inputWatermark' is distinct from v_subject->>'masteryInputWatermark'
         or v_mastery->>'projectionVersion' is distinct from
           v_subject->>'masteryProjectionVersion' then
        raise exception using errcode = '22023',
          message = 'review projection Mastery pointer is not authoritative';
      end if;

      select count(*) into v_expected_source_count
      from review.expected_mastery_source_changes_v1(
        v_delivery.workspace_id,
        v_subject_id,
        v_subject->>'subjectRef',
        v_mastery
      );
      if v_new_source_count <> v_expected_source_count
         or exists (
           select 1
           from pg_catalog.jsonb_array_elements(
             v_subject->'newSourceEvents'
           ) as supplied(value)
           left join review.expected_mastery_source_changes_v1(
             v_delivery.workspace_id,
             v_subject_id,
             v_subject->>'subjectRef',
             v_mastery
           ) as expected
             on expected.source_key = supplied.value->>'sourceKey'
           where expected.source_key is null
              or expected.reason_id is distinct from (supplied.value->>'reasonId')::uuid
              or expected.source_revision is distinct from
                (supplied.value->>'sourceRevision')::bigint
              or expected.source_kind is distinct from supplied.value->>'sourceKind'
              or expected.subject_id is distinct from (supplied.value->>'subjectId')::uuid
              or expected.reason_type is distinct from supplied.value->>'reason'
              or expected.occurrence_id is distinct from
                (supplied.value->>'occurrenceId')::uuid
              or expected.base_due_at is distinct from
                (supplied.value->>'baseDueAt')::timestamptz
              or expected.source_active is distinct from
                (supplied.value->>'sourceActive')::boolean
         )
         or exists (
           select 1
           from pg_catalog.jsonb_array_elements(
             v_subject->'newSourceEvents'
           ) as supplied(value)
           group by supplied.value->>'sourceKey'
           having count(*) > 1
         ) then
        raise exception using errcode = '22023',
          message = 'review projection Mastery source changes are not authoritative';
      end if;
    elsif v_subject->>'subjectId' <> v_event.payload->>'subject_id'
          or v_subject->>'subjectRef' <> v_event.payload->>'subject_ref'
          or (v_subject->>'nextInputWatermark')::bigint <>
            (v_authoritative_subject->>'currentInputWatermark')::bigint
          or (v_event.payload->>'input_watermark')::bigint >
            (v_subject->>'nextInputWatermark')::bigint
          or v_subject->>'masterySnapshotId' is not null
          or v_subject->>'masteryInputWatermark' is not null
          or v_subject->>'masteryProjectionVersion' is not null then
      raise exception using errcode = '22023', message = 'review input event does not match subject';
    end if;
  end loop;

  for v_subject in
    select value
    from pg_catalog.jsonb_array_elements(p_subjects) as subject(value)
    order by value->>'subjectId'
  loop
    v_subject_id := (v_subject->>'subjectId')::uuid;
    v_subject_ref := v_subject->>'subjectRef';
    v_competency_ref := v_subject->>'competencyRef';
    v_dimension := v_subject->>'dimension';
    v_expected_watermark := (v_subject->>'expectedInputWatermark')::bigint;
    v_next_watermark := (v_subject->>'nextInputWatermark')::bigint;
    v_focus := v_subject->'focus';

    if v_event.event_name = 'mastery.competency_state_changed' then
      insert into review.subject_ledgers (
        subject_id, workspace_id, competency_ref, dimension, input_watermark,
        mastery_snapshot_id, mastery_input_watermark, mastery_projection_version,
        readiness_goal_key, activity_key, activity_title, updated_at
      ) values (
        v_subject_id, v_delivery.workspace_id, v_competency_ref, v_dimension, v_next_watermark,
        (v_subject->>'masterySnapshotId')::uuid,
        (v_subject->>'masteryInputWatermark')::bigint,
        (v_subject->>'masteryProjectionVersion')::bigint,
        nullif(v_focus->>'readinessGoalKey', ''),
        nullif(v_focus->>'activityKey', ''),
        nullif(v_focus->>'activityTitle', ''),
        clock_timestamp()
      )
      on conflict (workspace_id, subject_ref) do update
      set input_watermark = excluded.input_watermark,
          mastery_snapshot_id = excluded.mastery_snapshot_id,
          mastery_input_watermark = excluded.mastery_input_watermark,
          mastery_projection_version = excluded.mastery_projection_version,
          readiness_goal_key = excluded.readiness_goal_key,
          activity_key = excluded.activity_key,
          activity_title = excluded.activity_title,
          updated_at = clock_timestamp()
      where review.subject_ledgers.input_watermark = v_expected_watermark;
    end if;

    for v_source in
      select value from pg_catalog.jsonb_array_elements(v_subject->'newSourceEvents') as source(value)
      order by value->>'sourceKey'
    loop
      if pg_catalog.jsonb_typeof(v_source) <> 'object'
         or v_source->>'sourceKind' <> 'MASTERY'
         or v_source->>'reason' not in ('RETENTION_RISK', 'VERIFICATION_NEEDED')
         or v_source->>'subjectId' <> v_subject_id::text
         or (v_source->>'eventId')::uuid <> review.stable_uuid(
           v_event.event_id::text || ':' || v_subject_id::text || ':' ||
             (v_source->>'sourceKey') || ':' || (v_source->>'sourceRevision')
         )
         or (v_source->>'reasonId')::uuid <> review.stable_uuid(
           v_delivery.workspace_id::text || ':' || v_subject_ref || ':' ||
             (v_source->>'reason')
         )
         or (v_source->>'sourceKey') <> (
           'mastery:' || v_subject_ref || ':' ||
           (case when v_source->>'reason' = 'RETENTION_RISK'
             then 'retention' else 'verification' end)
         )
         or (v_source->>'sourceRevision') !~ '^[1-9][0-9]{0,18}$'
         or (v_source->>'baseDueAt')::timestamptz is null
         or pg_catalog.jsonb_typeof(v_source->'sourceActive') <> 'boolean'
         or exists (
           select 1 from pg_catalog.jsonb_object_keys(v_source) as source_key(key)
           where source_key.key not in (
             'eventId', 'reasonId', 'sourceKey', 'sourceRevision', 'sourceKind',
             'subjectId', 'reason', 'occurrenceId', 'baseDueAt', 'sourceActive'
           )
         ) then
        raise exception using errcode = '22023', message = 'review Mastery source event is invalid';
      end if;
      if (v_source->>'sourceRevision')::bigint <> coalesce((
        select max(source.source_revision) + 1
        from review.reason_source_events as source
        where source.workspace_id = v_delivery.workspace_id
          and source.subject_id = v_subject_id
          and source.source_key = v_source->>'sourceKey'
      ), 1) then
        return false;
      end if;

      insert into review.reason_sources (
        reason_id, workspace_id, subject_id, source_key, source_kind, reason_type
      ) values (
        (v_source->>'reasonId')::uuid, v_delivery.workspace_id, v_subject_id,
        v_source->>'sourceKey', 'MASTERY', v_source->>'reason'
      ) on conflict (workspace_id, subject_id, source_key) do nothing;

      insert into review.reason_source_events (
        source_event_id, workspace_id, subject_id, reason_id, source_key,
        source_revision, source_kind, reason_type, occurrence_id, base_due_at,
        source_active, upstream_event_id
      ) values (
        (v_source->>'eventId')::uuid, v_delivery.workspace_id, v_subject_id,
        (v_source->>'reasonId')::uuid, v_source->>'sourceKey',
        (v_source->>'sourceRevision')::bigint, 'MASTERY', v_source->>'reason',
        (v_source->>'occurrenceId')::uuid, (v_source->>'baseDueAt')::timestamptz,
        (v_source->>'sourceActive')::boolean, v_event.event_id
      );
    end loop;

    if v_subject->'state'->'calculation'->>'engineVersion' <> 'review-engine/0.1.0'
       or v_subject->'state'->'calculation'->>'policyVersion' <> 'review-policy/0.1'
       or v_subject->'state'->'calculation'->>'inputWatermark' <> v_next_watermark::text
       or (v_subject->'state'->'calculation'->>'calculatedAsOf')::timestamptz
         is distinct from (v_authoritative_input->>'calculatedAsOf')::timestamptz
       or pg_catalog.jsonb_typeof(v_subject->'state'->'reasons') <> 'array'
       or pg_catalog.jsonb_typeof(v_subject->'state'->'replayedSourceEventIds') <> 'array'
       or pg_catalog.jsonb_typeof(v_subject->'state'->'replayedActionIds') <> 'array'
       or pg_catalog.jsonb_typeof(
         v_subject->'state'->'calculation'->'replayedEventIds'
       ) <> 'array'
       or pg_catalog.jsonb_typeof(
         v_subject->'state'->'calculation'->'explanationCodes'
       ) <> 'array'
       or exists (
         select 1
         from pg_catalog.jsonb_object_keys(v_subject->'state') as state_key(key)
         where state_key.key not in (
           'calculation', 'reasons', 'replayedSourceEventIds', 'replayedActionIds'
         )
       )
       or exists (
         select 1
         from pg_catalog.jsonb_object_keys(
           v_subject->'state'->'calculation'
         ) as calculation_key(key)
         where calculation_key.key not in (
           'engineVersion', 'policyVersion', 'inputWatermark', 'calculatedAsOf',
           'item', 'replayedEventIds', 'explanationCodes'
         )
       ) then
      raise exception using errcode = '22023', message = 'review projection result is invalid';
    end if;

    select coalesce(
      pg_catalog.jsonb_agg(pg_catalog.to_jsonb(source.source_event_id::text)
        order by source.source_event_id::text),
      '[]'::jsonb
    ) into v_expected_replayed_source_ids
    from review.reason_source_events as source
    where source.workspace_id = v_delivery.workspace_id and source.subject_id = v_subject_id;
    select coalesce(
      pg_catalog.jsonb_agg(pg_catalog.to_jsonb(action.action_id::text)
        order by action.action_id::text),
      '[]'::jsonb
    ) into v_expected_replayed_action_ids
    from review.action_events as action
    where action.workspace_id = v_delivery.workspace_id and action.subject_id = v_subject_id;
    select coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.to_jsonb(
          'effective:' || expected.source_key || ':' ||
            expected.source_revision::text || ':' || expected.occurrence_id::text
        ) order by (
          'effective:' || expected.source_key || ':' ||
            expected.source_revision::text || ':' || expected.occurrence_id::text
        )
      ),
      '[]'::jsonb
    ) into v_expected_replayed_effective_ids
    from review.expected_effective_reasons_v1(
      v_delivery.workspace_id, v_subject_id, '[]'::jsonb
    ) as expected;
    if v_subject->'state'->'replayedSourceEventIds' is distinct from
         v_expected_replayed_source_ids
       or v_subject->'state'->'replayedActionIds' is distinct from
         v_expected_replayed_action_ids
       or v_subject->'state'->'calculation'->'replayedEventIds' is distinct from
         v_expected_replayed_effective_ids then
      raise exception using errcode = '22023',
        message = 'review projection replay identity sets are not authoritative';
    end if;

    select count(*), count(*) filter (where expected.active),
      min(expected.due_at) filter (where expected.active)
    into v_expected_reason_count, v_expected_active_count, v_expected_due_at
    from review.expected_effective_reasons_v1(
      v_delivery.workspace_id, v_subject_id, '[]'::jsonb
    ) as expected;
    if pg_catalog.jsonb_array_length(v_subject->'state'->'reasons') <>
         v_expected_reason_count
       or exists (
         select 1
         from pg_catalog.jsonb_array_elements(
           v_subject->'state'->'reasons'
         ) as supplied(value)
         left join review.expected_effective_reasons_v1(
           v_delivery.workspace_id, v_subject_id, '[]'::jsonb
         ) as expected
           on expected.source_key = supplied.value->>'sourceKey'
         where expected.source_key is null
            or expected.reason_id is distinct from (supplied.value->>'reasonId')::uuid
            or expected.source_revision is distinct from
              (supplied.value->>'sourceRevision')::bigint
            or expected.source_kind is distinct from supplied.value->>'sourceKind'
            or expected.reason_type is distinct from supplied.value->>'reason'
            or expected.occurrence_id is distinct from
              (supplied.value->>'occurrenceId')::uuid
            or expected.base_due_at is distinct from
              (supplied.value->>'baseDueAt')::timestamptz
            or expected.due_at is distinct from (supplied.value->>'dueAt')::timestamptz
            or expected.source_active is distinct from
              (supplied.value->>'sourceActive')::boolean
            or expected.suppressed is distinct from
              (supplied.value->>'suppressed')::boolean
            or expected.active is distinct from (supplied.value->>'active')::boolean
            or exists (
              select 1 from pg_catalog.jsonb_object_keys(supplied.value) as reason_key(key)
              where reason_key.key not in (
                'reasonId', 'sourceKey', 'sourceRevision', 'sourceKind', 'reason',
                'occurrenceId', 'baseDueAt', 'dueAt', 'sourceActive', 'suppressed', 'active'
              )
            )
       )
       or exists (
         select 1
         from pg_catalog.jsonb_array_elements(
           v_subject->'state'->'reasons'
         ) as supplied(value)
         group by supplied.value->>'sourceKey'
         having count(*) > 1
       ) then
      raise exception using errcode = '22023',
        message = 'review projection reasons are not authoritative';
    end if;

    v_expected_timing := case
      when v_expected_due_at < (v_authoritative_input->>'calculatedAsOf')::timestamptz
        then 'OVERDUE'
      when v_expected_due_at = (v_authoritative_input->>'calculatedAsOf')::timestamptz
        then 'DUE'
      else 'UPCOMING'
    end;
    if v_expected_active_count = 0 then
      if v_subject->'state'->'calculation'->'item' is distinct from 'null'::jsonb
         or v_subject->'state'->'calculation'->'explanationCodes' is distinct from
           '["NO_ACTIVE_REASONS"]'::jsonb then
        raise exception using errcode = '22023',
          message = 'review projection inactive calculation is not authoritative';
      end if;
    elsif pg_catalog.jsonb_typeof(
            v_subject->'state'->'calculation'->'item'
          ) <> 'object'
          or v_subject->'state'->'calculation'->'item'->>'workspaceId'
            is distinct from v_delivery.workspace_id::text
          or v_subject->'state'->'calculation'->'item'->>'subjectId'
            is distinct from v_subject_id::text
          or (v_subject->'state'->'calculation'->'item'->>'effectiveDueAt')::timestamptz
            is distinct from v_expected_due_at
          or v_subject->'state'->'calculation'->'item'->>'timing'
            is distinct from v_expected_timing
          or pg_catalog.jsonb_typeof(
            v_subject->'state'->'calculation'->'item'->'reasons'
          ) <> 'array'
          or pg_catalog.jsonb_array_length(
            v_subject->'state'->'calculation'->'item'->'reasons'
          ) <> v_expected_active_count
          or exists (
            select 1
            from pg_catalog.jsonb_object_keys(
              v_subject->'state'->'calculation'->'item'
            ) as item_key(key)
            where item_key.key not in (
              'workspaceId', 'subjectId', 'effectiveDueAt', 'timing', 'reasons'
            )
          )
          or exists (
            select 1
            from pg_catalog.jsonb_array_elements(
              v_subject->'state'->'calculation'->'item'->'reasons'
            ) as supplied(value)
            left join review.expected_effective_reasons_v1(
              v_delivery.workspace_id, v_subject_id, '[]'::jsonb
            ) as expected
              on expected.source_key = supplied.value->>'sourceKey' and expected.active
            where expected.source_key is null
               or expected.source_revision is distinct from
                 (supplied.value->>'sourceRevision')::bigint
               or supplied.value->>'sourceEventId' is distinct from
                 'effective:' || expected.source_key || ':' ||
                   expected.source_revision::text || ':' || expected.occurrence_id::text
               or expected.reason_type is distinct from supplied.value->>'reason'
               or expected.due_at is distinct from (supplied.value->>'dueAt')::timestamptz
               or exists (
                 select 1
                 from pg_catalog.jsonb_object_keys(supplied.value) as reason_key(key)
                 where reason_key.key not in (
                   'sourceKey', 'sourceRevision', 'sourceEventId', 'reason', 'dueAt'
                 )
               )
          )
          or exists (
            select 1
            from pg_catalog.jsonb_array_elements(
              v_subject->'state'->'calculation'->'item'->'reasons'
            ) as supplied(value)
            group by supplied.value->>'sourceKey'
            having count(*) > 1
          )
          or v_subject->'state'->'calculation'->'explanationCodes' is distinct from
            '["ONE_ITEM_PER_SUBJECT","EARLIEST_ACTIVE_REASON_WINS","SOURCE_REVISIONS_DEDUPLICATED"]'::jsonb then
      raise exception using errcode = '22023',
        message = 'review projection active calculation is not authoritative';
    end if;
    v_effective_due_at := v_expected_due_at;
    v_snapshot_id := gen_random_uuid();
    insert into review.item_snapshots (
      snapshot_id, workspace_id, subject_id, projection_generation,
      input_watermark, engine_version, policy_version, calculated_as_of,
      effective_due_at, state
    ) values (
      v_snapshot_id, v_delivery.workspace_id, v_subject_id, 'live-v1',
      v_next_watermark, 'review-engine/0.1.0', 'review-policy/0.1',
      (v_subject->'state'->'calculation'->>'calculatedAsOf')::timestamptz,
      v_effective_due_at, v_subject->'state'
    ) on conflict (
      workspace_id, subject_id, engine_version, policy_version,
      projection_generation, input_watermark
    ) do nothing;
    select snapshot.snapshot_id into strict v_snapshot_id
    from review.item_snapshots as snapshot
    where snapshot.workspace_id = v_delivery.workspace_id
      and snapshot.subject_id = v_subject_id
      and snapshot.engine_version = 'review-engine/0.1.0'
      and snapshot.policy_version = 'review-policy/0.1'
      and snapshot.projection_generation = 'live-v1'
      and snapshot.input_watermark = v_next_watermark;

    select case when item.input_watermark < v_next_watermark then 1 else 0 end
    into v_projection_rows
    from review.items as item
    where item.workspace_id = v_delivery.workspace_id and item.subject_id = v_subject_id;
    if not found then v_projection_rows := 1; end if;

    if v_projection_rows = 1 then
      delete from review.item_reasons
      where workspace_id = v_delivery.workspace_id and subject_id = v_subject_id;
      insert into review.items (
        workspace_id, subject_id, snapshot_id, subject_ref, competency_ref, dimension,
        activity_key, activity_title, readiness_goal_key, input_watermark,
        effective_due_at, has_active_reasons, updated_at
      ) values (
        v_delivery.workspace_id, v_subject_id, v_snapshot_id, v_subject_ref,
        v_competency_ref, v_dimension, nullif(v_focus->>'activityKey', ''),
        nullif(v_focus->>'activityTitle', ''), nullif(v_focus->>'readinessGoalKey', ''),
        v_next_watermark, v_effective_due_at, v_effective_due_at is not null,
        clock_timestamp()
      )
      on conflict (workspace_id, subject_id) do update
      set snapshot_id = excluded.snapshot_id,
          subject_ref = excluded.subject_ref,
          competency_ref = excluded.competency_ref,
          dimension = excluded.dimension,
          activity_key = excluded.activity_key,
          activity_title = excluded.activity_title,
          readiness_goal_key = excluded.readiness_goal_key,
          input_watermark = excluded.input_watermark,
          projection_version = review.items.projection_version + 1,
          effective_due_at = excluded.effective_due_at,
          has_active_reasons = excluded.has_active_reasons,
          updated_at = clock_timestamp()
      where review.items.input_watermark < excluded.input_watermark;

      for v_reason in
        select value from pg_catalog.jsonb_array_elements(v_subject->'state'->'reasons') as reason(value)
      loop
        if (v_reason->>'reasonId')::uuid is null
           or (v_reason->>'sourceRevision') !~ '^[1-9][0-9]{0,18}$'
           or v_reason->>'sourceKind' not in ('MASTERY', 'PERSONAL_REMINDER')
           or v_reason->>'reason' not in (
             'RETENTION_RISK', 'PERSONAL_REMINDER', 'VERIFICATION_NEEDED'
           )
           or (v_reason->>'baseDueAt')::timestamptz is null
           or (v_reason->>'dueAt')::timestamptz is null
           or pg_catalog.jsonb_typeof(v_reason->'sourceActive') <> 'boolean'
           or pg_catalog.jsonb_typeof(v_reason->'suppressed') <> 'boolean'
           or pg_catalog.jsonb_typeof(v_reason->'active') <> 'boolean' then
          raise exception using errcode = '22023', message = 'review projection reason is invalid';
        end if;
        insert into review.item_reasons (
          workspace_id, subject_id, snapshot_id, reason_id, source_key, source_revision,
          source_kind, reason_type, occurrence_id, base_due_at, due_at,
          source_active, suppressed, active
        ) values (
          v_delivery.workspace_id, v_subject_id, v_snapshot_id,
          (v_reason->>'reasonId')::uuid, v_reason->>'sourceKey',
          (v_reason->>'sourceRevision')::bigint, v_reason->>'sourceKind',
          v_reason->>'reason', (v_reason->>'occurrenceId')::uuid,
          (v_reason->>'baseDueAt')::timestamptz, (v_reason->>'dueAt')::timestamptz,
          (v_reason->>'sourceActive')::boolean, (v_reason->>'suppressed')::boolean,
          (v_reason->>'active')::boolean
        );
      end loop;

      select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(reason.reason_type)
        order by reason.reason_type), '[]'::jsonb)
      into v_active_reason_types
      from (
        select distinct item_reason.reason_type
        from review.item_reasons as item_reason
        where item_reason.workspace_id = v_delivery.workspace_id
          and item_reason.subject_id = v_subject_id
          and item_reason.active
      ) as reason;
      v_projection_status := case
        when v_effective_due_at is not null then 'CURRENT'
        when exists (
          select 1 from review.item_reasons as item_reason
          where item_reason.workspace_id = v_delivery.workspace_id
            and item_reason.subject_id = v_subject_id and item_reason.suppressed
        ) then 'SUPPRESSED'
        else 'INACTIVE'
      end;
      insert into outbox.events (
        event_name, event_schema_version, workspace_id,
        aggregate_type, aggregate_id, aggregate_version,
        actor_type, actor_user_id, command_id, correlation_id, causation_id,
        occurred_at, source, payload
      ) values (
        'review.item_changed', 1, v_delivery.workspace_id,
        'review.subject', v_subject_id, v_next_watermark,
        'system', null, v_event.command_id, v_event.correlation_id, v_event.event_id,
        clock_timestamp(), 'pando.review_worker', pg_catalog.jsonb_build_object(
          'subject_id', v_subject_id,
          'subject_ref', v_subject_ref,
          'subject_type', 'COMPETENCY_DIMENSION',
          'competency_ref', v_competency_ref,
          'dimension', v_dimension,
          'subject_version', v_next_watermark::text,
          'effective_due_at', v_effective_due_at,
          'active_reason_types', v_active_reason_types,
          'projection_status', v_projection_status
        )
      );
    end if;
  end loop;

  insert into outbox.consumer_receipts (
    delivery_id, event_id, workspace_id, consumer_name, handler_contract_version,
    input_event_position, lease_token
  ) values (
    v_delivery.delivery_id, v_delivery.event_id, v_delivery.workspace_id,
    'review.item_projection_v1', 1, v_event.event_position, p_lease_token
  );
  update outbox.deliveries
  set delivery_state = 'succeeded', lease_token = null, lease_expires_at = null,
      completed_at = clock_timestamp()
  where delivery_id = v_delivery.delivery_id;
  return true;
end
$function$;

alter function review.stable_uuid(text) owner to pando_review_worker;
alter function outbox.claim_review_item_projection_impl() owner to pando_review_worker;
alter function review.projection_event_v1_is_valid(outbox.events) owner to pando_review_worker;
alter function review.load_subject_projection_input_v1(uuid, uuid, text, text, text, jsonb)
  owner to pando_review_worker;
alter function review.load_item_projection_input_impl(uuid, uuid) owner to pando_review_worker;
alter function review.expected_mastery_source_changes_v1(uuid, uuid, text, jsonb)
  owner to pando_review_worker;
alter function review.expected_effective_reasons_v1(uuid, uuid, jsonb)
  owner to pando_review_worker;
alter function review.complete_item_projection_impl(uuid, uuid, bigint, jsonb)
  owner to pando_review_worker;
alter function outbox.fail_review_item_projection_impl(uuid, uuid, text, text)
  owner to pando_review_worker;
alter function outbox.get_review_projection_health_impl() owner to pando_review_worker;

revoke all on function review.stable_uuid(text),
  outbox.claim_review_item_projection_impl(),
  review.projection_event_v1_is_valid(outbox.events),
  review.load_subject_projection_input_v1(uuid, uuid, text, text, text, jsonb),
  review.load_item_projection_input_impl(uuid, uuid),
  review.expected_mastery_source_changes_v1(uuid, uuid, text, jsonb),
  review.expected_effective_reasons_v1(uuid, uuid, jsonb),
  review.complete_item_projection_impl(uuid, uuid, bigint, jsonb),
  outbox.fail_review_item_projection_impl(uuid, uuid, text, text),
  outbox.get_review_projection_health_impl()
  from public, anon, authenticated, service_role;
grant execute on function outbox.claim_review_item_projection_impl(),
  review.load_item_projection_input_impl(uuid, uuid),
  review.complete_item_projection_impl(uuid, uuid, bigint, jsonb),
  outbox.fail_review_item_projection_impl(uuid, uuid, text, text),
  outbox.get_review_projection_health_impl()
  to service_role;
grant execute on function review.stable_uuid(text) to pando_review_api;

create function api.claim_review_item_projection_v1()
returns table (
  delivery_id uuid, event_id uuid, event_position bigint, workspace_id uuid,
  lease_token uuid, lease_expires_at timestamptz, attempt_count smallint,
  event_name text, event_schema_version smallint, payload jsonb
)
language sql security invoker set search_path = ''
as $function$
  select * from outbox.claim_review_item_projection_impl()
$function$;

create function api.load_review_item_projection_v1(p_delivery_id uuid, p_lease_token uuid)
returns jsonb language sql stable security invoker set search_path = ''
as $function$
  select review.load_item_projection_input_impl(p_delivery_id, p_lease_token)
$function$;

create function api.complete_review_item_projection_v1(
  p_delivery_id uuid, p_lease_token uuid, p_expected_event_position bigint,
  p_subjects jsonb
)
returns boolean language sql security invoker set search_path = ''
as $function$
  select review.complete_item_projection_impl(
    p_delivery_id, p_lease_token, p_expected_event_position, p_subjects
  )
$function$;

create function api.fail_review_item_projection_v1(
  p_delivery_id uuid, p_lease_token uuid, p_failure_class text, p_error_code text
)
returns text language sql security invoker set search_path = ''
as $function$
  select outbox.fail_review_item_projection_impl(
    p_delivery_id, p_lease_token, p_failure_class, p_error_code
  )
$function$;

create function api.get_review_projection_health_v1()
returns jsonb language sql stable security invoker set search_path = ''
as $function$
  select outbox.get_review_projection_health_impl()
$function$;

revoke all on function api.claim_review_item_projection_v1(),
  api.load_review_item_projection_v1(uuid, uuid),
  api.complete_review_item_projection_v1(uuid, uuid, bigint, jsonb),
  api.fail_review_item_projection_v1(uuid, uuid, text, text),
  api.get_review_projection_health_v1()
  from public, anon, authenticated, service_role;
grant execute on function api.claim_review_item_projection_v1(),
  api.load_review_item_projection_v1(uuid, uuid),
  api.complete_review_item_projection_v1(uuid, uuid, bigint, jsonb),
  api.fail_review_item_projection_v1(uuid, uuid, text, text),
  api.get_review_projection_health_v1()
  to service_role;

revoke create on schema outbox, review from pando_review_worker;
do $migration_role_membership$
begin
  execute pg_catalog.format('revoke pando_review_worker from %I', current_user);
end
$migration_role_membership$;
