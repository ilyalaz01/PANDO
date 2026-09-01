-- Phase 4B D2a: deterministic Growth Plan weekly-capacity preview and atomic apply.

do $migration_role_membership$
begin
  execute pg_catalog.format('grant pando_planning_api to %I with set true', current_user);
end
$migration_role_membership$;

grant create on schema planning, api to pando_planning_api;

grant update (weekly_capacity_minutes, aggregate_version, updated_at)
  on planning.growth_plans to pando_planning_api;

create function planning.active_track_capacity_constraint_v1(
  p_workspace_id uuid,
  p_growth_plan_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_active_track_count integer;
  v_active_protected_minimum_minutes integer;
  v_fingerprint_input text;
  v_fingerprint text;
begin
  if p_workspace_id is null or p_growth_plan_id is null then
    raise exception using errcode = '22023', message = 'Growth Plan Track constraint input is invalid';
  end if;

  select
    pg_catalog.count(*)::integer,
    coalesce(pg_catalog.sum(track.protected_minimum_minutes), 0)::integer
  into v_active_track_count, v_active_protected_minimum_minutes
  from planning.learning_tracks as track
  where track.workspace_id = p_workspace_id
    and track.growth_plan_id = p_growth_plan_id
    and track.lifecycle = 'active';

  select pg_catalog.string_agg(
    fingerprint_part.part_name || ':'
      || pg_catalog.octet_length(
        pg_catalog.convert_to(fingerprint_part.part_value, 'UTF8')
      )::text
      || ':' || fingerprint_part.part_value || pg_catalog.chr(10),
    '' order by fingerprint_part.part_position
  ) into v_fingerprint_input
  from (
    select 1::bigint as part_position,
      'fingerprintVersion'::text as part_name,
      'active-track-constraint-fingerprint/1.0.0'::text as part_value
    union all
    select 2, 'activeTrackCount', v_active_track_count::text
    union all
    select
      2 + ordered_track.track_position * 10 + field.field_position,
      field.field_name,
      field.field_value
    from (
      select
        track.learning_track_id,
        track.aggregate_version,
        track.lifecycle,
        track.protected_minimum_minutes,
        pg_catalog.row_number() over (order by track.learning_track_id)::bigint as track_position
      from planning.learning_tracks as track
      where track.workspace_id = p_workspace_id
        and track.growth_plan_id = p_growth_plan_id
        and track.lifecycle = 'active'
    ) as ordered_track
    cross join lateral (
      values
        (1::bigint, 'learningTrackId'::text, pg_catalog.lower(ordered_track.learning_track_id::text)),
        (2::bigint, 'aggregateVersion'::text, ordered_track.aggregate_version::text),
        (3::bigint, 'lifecycle'::text, pg_catalog.upper(ordered_track.lifecycle)),
        (4::bigint, 'protectedMinimumMinutes'::text, ordered_track.protected_minimum_minutes::text)
    ) as field(field_position, field_name, field_value)
  ) as fingerprint_part;

  v_fingerprint := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(v_fingerprint_input, 'UTF8'), 'sha256'),
    'hex'
  );

  return pg_catalog.jsonb_build_object(
    'activeTrackCount', v_active_track_count,
    'activeProtectedMinimumMinutes', v_active_protected_minimum_minutes,
    'activeTrackFingerprint', v_fingerprint
  );
end
$function$;

create function planning.build_growth_plan_capacity_preview_v1(
  p_workspace_id uuid,
  p_growth_plan_id uuid,
  p_title text,
  p_lifecycle text,
  p_weekly_capacity_minutes integer,
  p_aggregate_version bigint,
  p_proposed_weekly_capacity_minutes integer,
  p_expected_growth_plan_version bigint,
  p_reason text,
  p_active_track_count integer,
  p_active_protected_minimum_minutes integer,
  p_active_track_fingerprint text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_after_version bigint;
  v_flexible_minutes_before integer;
  v_flexible_minutes_after integer;
  v_can_apply boolean;
  v_blocking_reason_code text := '';
  v_blocking_minimum_capacity_minutes text := '';
  v_blocking_reasons jsonb := '[]'::jsonb;
  v_digest_input text;
  v_digest text;
begin
  if p_workspace_id is null or p_growth_plan_id is null or p_title is null
     or p_lifecycle not in ('active', 'paused')
     or p_weekly_capacity_minutes is null
     or p_weekly_capacity_minutes not between 0 and 10080
     or p_aggregate_version is null or p_aggregate_version < 1
     or p_proposed_weekly_capacity_minutes is null
     or p_proposed_weekly_capacity_minutes not between 0 and 10080
     or p_expected_growth_plan_version is null or p_expected_growth_plan_version < 1
     or p_active_track_count is null or p_active_track_count not between 0 and 30
     or p_active_protected_minimum_minutes is null
     or p_active_protected_minimum_minutes not between 0 and 10080
     or p_active_protected_minimum_minutes > p_weekly_capacity_minutes
     or p_active_track_fingerprint is null
     or p_active_track_fingerprint !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'Growth Plan capacity preview input is invalid';
  end if;
  if p_reason is null or p_reason <> pg_catalog.btrim(p_reason)
     or pg_catalog.char_length(p_reason) not between 1 and 500
     or p_reason ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'Growth Plan capacity reason is invalid';
  end if;
  if p_expected_growth_plan_version <> p_aggregate_version then
    raise exception using errcode = '40001', message = 'Growth Plan version is stale';
  end if;
  if p_aggregate_version = 9223372036854775807 then
    raise exception using errcode = '22003', message = 'Growth Plan version is exhausted';
  end if;
  if p_proposed_weekly_capacity_minutes = p_weekly_capacity_minutes then
    raise exception using errcode = '22023', message = 'Growth Plan capacity proposal is unchanged';
  end if;

  v_after_version := p_aggregate_version + 1;
  v_flexible_minutes_before := p_weekly_capacity_minutes - p_active_protected_minimum_minutes;
  v_flexible_minutes_after := p_proposed_weekly_capacity_minutes - p_active_protected_minimum_minutes;
  v_can_apply := p_proposed_weekly_capacity_minutes >= p_active_protected_minimum_minutes;
  if not v_can_apply then
    v_blocking_reason_code := 'ACTIVE_TRACK_MINIMUM_EXCEEDS_CAPACITY';
    v_blocking_minimum_capacity_minutes := p_active_protected_minimum_minutes::text;
    v_blocking_reasons := pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'code', v_blocking_reason_code,
        'minimumCapacityMinutes', p_active_protected_minimum_minutes
      )
    );
  end if;

  select pg_catalog.string_agg(
    digest_field.field_name || ':'
      || pg_catalog.octet_length(
        pg_catalog.convert_to(digest_field.field_value, 'UTF8')
      )::text
      || ':' || digest_field.field_value || pg_catalog.chr(10),
    '' order by digest_field.field_position
  ) into v_digest_input
  from (
    values
      (1, 'digestVersion', 'growth-plan-capacity-preview-digest/1.0.0'),
      (2, 'contractVersion', '1.0.0'),
      (3, 'workspaceId', pg_catalog.lower(p_workspace_id::text)),
      (4, 'operation', 'set_default_capacity'),
      (5, 'reason', p_reason),
      (6, 'growthPlanId', pg_catalog.lower(p_growth_plan_id::text)),
      (7, 'beforeAggregateVersion', p_aggregate_version::text),
      (8, 'afterAggregateVersion', v_after_version::text),
      (9, 'beforeLifecycle', pg_catalog.upper(p_lifecycle)),
      (10, 'afterLifecycle', pg_catalog.upper(p_lifecycle)),
      (11, 'title', p_title),
      (12, 'beforeWeeklyCapacityMinutes', p_weekly_capacity_minutes::text),
      (13, 'afterWeeklyCapacityMinutes', p_proposed_weekly_capacity_minutes::text),
      (14, 'activeTrackCount', p_active_track_count::text),
      (15, 'activeProtectedMinimumMinutes', p_active_protected_minimum_minutes::text),
      (16, 'flexibleMinutesBefore', v_flexible_minutes_before::text),
      (17, 'flexibleMinutesAfter', v_flexible_minutes_after::text),
      (18, 'activeTrackFingerprint', p_active_track_fingerprint),
      (19, 'canApply', case when v_can_apply then 'true' else 'false' end),
      (20, 'blockingReasonCode', v_blocking_reason_code),
      (21, 'blockingMinimumCapacityMinutes', v_blocking_minimum_capacity_minutes),
      (22, 'projectionStateAfterApply', 'PENDING'),
      (23, 'consumerName', 'planning.plan_snapshot_v1')
  ) as digest_field(field_position, field_name, field_value);
  v_digest := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(v_digest_input, 'UTF8'), 'sha256'),
    'hex'
  );

  return pg_catalog.jsonb_build_object(
    'contract', pg_catalog.jsonb_build_object(
      'name', 'GrowthPlanCapacityPreviewV1', 'version', '1.0.0'
    ),
    'operation', 'set_default_capacity',
    'reason', p_reason,
    'expectedGrowthPlanVersion', p_expected_growth_plan_version::text,
    'before', pg_catalog.jsonb_build_object(
      'growthPlanId', p_growth_plan_id,
      'title', p_title,
      'lifecycle', pg_catalog.upper(p_lifecycle),
      'weeklyCapacityMinutes', p_weekly_capacity_minutes,
      'aggregateVersion', p_aggregate_version::text
    ),
    'after', pg_catalog.jsonb_build_object(
      'growthPlanId', p_growth_plan_id,
      'title', p_title,
      'lifecycle', pg_catalog.upper(p_lifecycle),
      'weeklyCapacityMinutes', p_proposed_weekly_capacity_minutes,
      'aggregateVersion', v_after_version::text
    ),
    'constraint', pg_catalog.jsonb_build_object(
      'activeTrackCount', p_active_track_count,
      'activeProtectedMinimumMinutes', p_active_protected_minimum_minutes,
      'flexibleMinutesBefore', v_flexible_minutes_before,
      'flexibleMinutesAfter', v_flexible_minutes_after,
      'activeTrackFingerprint', p_active_track_fingerprint
    ),
    'canApply', v_can_apply,
    'blockingReasons', v_blocking_reasons,
    'retained', pg_catalog.jsonb_build_object(
      'learningTracks', true,
      'planSnapshots', true,
      'focusSessions', true,
      'evidence', true
    ),
    'recalculationAfterApply', pg_catalog.jsonb_build_object(
      'projectionState', 'PENDING',
      'consumerName', 'planning.plan_snapshot_v1'
    ),
    'previewDigest', v_digest
  );
end
$function$;

create function planning.plan_capacity_event_payload_v1_is_valid(p_payload jsonb)
returns boolean
language sql
immutable
strict
set search_path = ''
as $function$
  select pg_catalog.jsonb_typeof(p_payload) = 'object'
    and (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(p_payload)) = 4
    and p_payload->>'change_kind' = 'PLAN_CAPACITY_CHANGED'
    and p_payload->>'growth_plan_id'
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and case
      when p_payload->>'growth_plan_version' ~ '^[1-9][0-9]{0,18}$'
        then (p_payload->>'growth_plan_version')::numeric <= 9223372036854775807
      else false
    end
    and case
      when (p_payload->>'weekly_capacity_minutes') ~ '^(0|[1-9][0-9]{0,4})$'
        then (p_payload->>'weekly_capacity_minutes')::integer between 0 and 10080
      else false
    end
$function$;

-- D1 predates the bigint-safe JSON Schema bound. Keep its private SQL event invariant exact too;
-- this is an additive hardening replacement and does not change the public lifecycle contract.
create or replace function planning.plan_lifecycle_event_payload_v1_is_valid(p_payload jsonb)
returns boolean
language sql
immutable
strict
set search_path = ''
as $function$
  select pg_catalog.jsonb_typeof(p_payload) = 'object'
    and (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(p_payload)) = 4
    and p_payload->>'change_kind' = 'PLAN_LIFECYCLE_CHANGED'
    and p_payload->>'growth_plan_id'
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and case
      when p_payload->>'growth_plan_version' ~ '^[1-9][0-9]{0,18}$'
        then (p_payload->>'growth_plan_version')::numeric <= 9223372036854775807
      else false
    end
    and p_payload->>'lifecycle' in ('ACTIVE', 'PAUSED')
$function$;

create function api.preview_growth_plan_capacity_v1(
  p_proposed_weekly_capacity_minutes integer,
  p_expected_growth_plan_version text,
  p_reason text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_workspace_id uuid;
  v_plan planning.growth_plans%rowtype;
  v_constraint jsonb;
begin
  if identity.jwt_subject() is null then
    raise exception using errcode = '28000', message = 'an authenticated user is required';
  end if;
  v_workspace_id := identity.personal_workspace_id_for_current_user();
  if v_workspace_id is null then
    raise exception using errcode = '42501', message = 'Growth Plan is unavailable';
  end if;
  if p_proposed_weekly_capacity_minutes is null
     or p_proposed_weekly_capacity_minutes not between 0 and 10080
     or p_expected_growth_plan_version is null
     or p_expected_growth_plan_version !~ '^[1-9][0-9]{0,18}$' then
    raise exception using errcode = '22023', message = 'Growth Plan capacity request is invalid';
  end if;
  if p_expected_growth_plan_version::numeric > 9223372036854775807 then
    raise exception using errcode = '22023', message = 'Growth Plan capacity request is invalid';
  end if;

  select plan.* into v_plan
  from planning.growth_plans as plan
  where plan.workspace_id = v_workspace_id
    and plan.lifecycle in ('active', 'paused');
  if not found then
    raise exception using errcode = '42501', message = 'Growth Plan is unavailable';
  end if;

  v_constraint := planning.active_track_capacity_constraint_v1(
    v_workspace_id, v_plan.growth_plan_id
  );
  if (v_constraint->>'activeTrackCount')::integer > 30
     or (v_constraint->>'activeProtectedMinimumMinutes')::integer
       > v_plan.weekly_capacity_minutes then
    raise exception using errcode = '55000',
      message = 'Growth Plan capacity invariant is violated';
  end if;
  return planning.build_growth_plan_capacity_preview_v1(
    v_workspace_id,
    v_plan.growth_plan_id,
    v_plan.title,
    v_plan.lifecycle,
    v_plan.weekly_capacity_minutes,
    v_plan.aggregate_version,
    p_proposed_weekly_capacity_minutes,
    p_expected_growth_plan_version::bigint,
    p_reason,
    (v_constraint->>'activeTrackCount')::integer,
    (v_constraint->>'activeProtectedMinimumMinutes')::integer,
    v_constraint->>'activeTrackFingerprint'
  );
end
$function$;

create function api.apply_growth_plan_capacity_v1(
  p_proposed_weekly_capacity_minutes integer,
  p_expected_growth_plan_version text,
  p_preview_digest text,
  p_reason text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_user_id uuid;
  v_workspace_id uuid;
  v_plan planning.growth_plans%rowtype;
  v_constraint jsonb;
  v_preview jsonb;
  v_payload jsonb;
  v_command_id uuid := gen_random_uuid();
  v_correlation_id uuid := gen_random_uuid();
  v_event_id uuid := gen_random_uuid();
  v_delivery_id uuid := gen_random_uuid();
  v_request_hash bytea;
  v_response jsonb;
  v_receipt outbox.command_receipts%rowtype;
  v_affected_rows integer;
begin
  if identity.jwt_subject() is null then
    raise exception using errcode = '28000', message = 'an authenticated user is required';
  end if;
  v_actor_user_id := identity.current_user_id();
  v_workspace_id := identity.personal_workspace_id_for_current_user();
  if v_actor_user_id is null or v_workspace_id is null then
    raise exception using errcode = '28000', message = 'authenticated user is not provisioned';
  end if;
  if p_proposed_weekly_capacity_minutes is null
     or p_proposed_weekly_capacity_minutes not between 0 and 10080
     or p_expected_growth_plan_version is null
     or p_expected_growth_plan_version !~ '^[1-9][0-9]{0,18}$' then
    raise exception using errcode = '22023', message = 'Growth Plan capacity request is invalid';
  end if;
  if p_expected_growth_plan_version::numeric > 9223372036854775807 then
    raise exception using errcode = '22023', message = 'Growth Plan capacity request is invalid';
  end if;
  if p_preview_digest is null or p_preview_digest !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'Growth Plan preview digest is invalid';
  end if;
  if p_reason is null or p_reason <> pg_catalog.btrim(p_reason)
     or pg_catalog.char_length(p_reason) not between 1 and 500
     or p_reason ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'Growth Plan capacity reason is invalid';
  end if;
  if p_idempotency_key is null or p_idempotency_key <> pg_catalog.btrim(p_idempotency_key)
     or pg_catalog.char_length(p_idempotency_key) not between 1 and 128
     or p_idempotency_key ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'idempotency key is invalid';
  end if;

  v_request_hash := extensions.digest(
    pg_catalog.convert_to(
      pg_catalog.jsonb_build_object(
        'commandType', 'planning.set_growth_plan_default_capacity',
        'schemaVersion', 1,
        'workspaceId', v_workspace_id,
        'operation', 'set_default_capacity',
        'weeklyCapacityMinutes', p_proposed_weekly_capacity_minutes,
        'expectedGrowthPlanVersion', p_expected_growth_plan_version,
        'previewDigest', p_preview_digest,
        'reason', p_reason
      )::text,
      'UTF8'
    ),
    'sha256'
  );

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    v_actor_user_id::text || ':planning.set_growth_plan_default_capacity:' || p_idempotency_key,
    0
  ));
  select receipt.* into v_receipt
  from outbox.command_receipts as receipt
  where receipt.actor_user_id = v_actor_user_id
    and receipt.command_type = 'planning.set_growth_plan_default_capacity'
    and receipt.idempotency_key = p_idempotency_key
  for update;
  if found then
    if v_receipt.request_hash <> v_request_hash then
      raise exception using errcode = '22023', message = 'idempotency key reused with a different request';
    end if;
    if v_receipt.command_status <> 'completed' then
      raise exception using errcode = '40001', message = 'command receipt is not complete';
    end if;
    return v_receipt.response;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('planning-workspace:' || v_workspace_id::text, 0)
  );
  select plan.* into v_plan
  from planning.growth_plans as plan
  where plan.workspace_id = v_workspace_id
    and plan.lifecycle in ('active', 'paused')
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'Growth Plan is unavailable';
  end if;

  -- Lock every child, including terminal rows, in one stable order before rebuilding the
  -- active-only constraint. A lifecycle or minimum command must use the same workspace lock.
  perform track.learning_track_id
  from planning.learning_tracks as track
  where track.workspace_id = v_workspace_id
    and track.growth_plan_id = v_plan.growth_plan_id
  order by track.learning_track_id
  for update;

  v_constraint := planning.active_track_capacity_constraint_v1(
    v_workspace_id, v_plan.growth_plan_id
  );
  if (v_constraint->>'activeTrackCount')::integer > 30
     or (v_constraint->>'activeProtectedMinimumMinutes')::integer
       > v_plan.weekly_capacity_minutes then
    raise exception using errcode = '55000',
      message = 'Growth Plan capacity invariant is violated';
  end if;
  v_preview := planning.build_growth_plan_capacity_preview_v1(
    v_workspace_id,
    v_plan.growth_plan_id,
    v_plan.title,
    v_plan.lifecycle,
    v_plan.weekly_capacity_minutes,
    v_plan.aggregate_version,
    p_proposed_weekly_capacity_minutes,
    p_expected_growth_plan_version::bigint,
    p_reason,
    (v_constraint->>'activeTrackCount')::integer,
    (v_constraint->>'activeProtectedMinimumMinutes')::integer,
    v_constraint->>'activeTrackFingerprint'
  );
  if (v_preview->>'canApply')::boolean is not true then
    raise exception using errcode = '40001',
      message = 'Growth Plan preview is stale';
  end if;
  if v_preview->>'previewDigest' is distinct from p_preview_digest then
    raise exception using errcode = '40001', message = 'Growth Plan preview is stale';
  end if;

  insert into outbox.command_receipts (
    command_id, command_type, command_schema_version, workspace_id, actor_user_id,
    idempotency_key, request_hash, correlation_id, expected_aggregate_version
  ) values (
    v_command_id, 'planning.set_growth_plan_default_capacity', 1, v_workspace_id,
    v_actor_user_id, p_idempotency_key, v_request_hash, v_correlation_id,
    p_expected_growth_plan_version::bigint
  );

  update planning.growth_plans
  set weekly_capacity_minutes = p_proposed_weekly_capacity_minutes,
    aggregate_version = aggregate_version + 1,
    updated_at = pg_catalog.clock_timestamp()
  where workspace_id = v_workspace_id
    and growth_plan_id = v_plan.growth_plan_id;
  -- Never continue to outbox effects if the authoritative row became unavailable.
  get diagnostics v_affected_rows = row_count;
  if v_affected_rows <> 1 then
    raise exception using errcode = '55000',
      message = 'Growth Plan capacity update failed';
  end if;

  v_payload := pg_catalog.jsonb_build_object(
    'change_kind', 'PLAN_CAPACITY_CHANGED',
    'growth_plan_id', v_plan.growth_plan_id,
    'growth_plan_version', v_preview#>>'{after,aggregateVersion}',
    'weekly_capacity_minutes', p_proposed_weekly_capacity_minutes
  );
  if planning.plan_capacity_event_payload_v1_is_valid(v_payload) is not true then
    raise exception using errcode = '55000', message = 'Planning capacity event payload is invalid';
  end if;

  insert into outbox.events (
    event_id, event_name, event_schema_version, workspace_id, aggregate_type,
    aggregate_id, aggregate_version, actor_type, actor_user_id, command_id,
    correlation_id, occurred_at, source, payload
  ) values (
    v_event_id, 'planning.input_changed', 1, v_workspace_id,
    'planning.growth_plan', v_plan.growth_plan_id,
    (v_preview#>>'{after,aggregateVersion}')::bigint,
    'user', v_actor_user_id, v_command_id, v_correlation_id,
    pg_catalog.clock_timestamp(), 'pando.database', v_payload
  );

  insert into outbox.deliveries (
    delivery_id, event_id, workspace_id, consumer_name, handler_contract_version
  ) values (
    v_delivery_id, v_event_id, v_workspace_id, 'planning.plan_snapshot_v1', 1
  );

  v_response := pg_catalog.jsonb_build_object(
    'contract', pg_catalog.jsonb_build_object(
      'name', 'GrowthPlanCapacityApplyResultV1', 'version', '1.0.0'
    ),
    'commandId', v_command_id,
    'changedPlan', v_preview->'after',
    'projectionState', 'PENDING',
    'planningDeliveryId', v_delivery_id,
    'emittedEventIds', pg_catalog.jsonb_build_array(v_event_id)
  );
  update outbox.command_receipts
  set command_status = 'completed',
    response = v_response,
    emitted_event_ids = array[v_event_id],
    completed_at = pg_catalog.clock_timestamp()
  where command_id = v_command_id;
  -- Returning success with a started receipt would break exact replay and recovery semantics.
  get diagnostics v_affected_rows = row_count;
  if v_affected_rows <> 1 then
    raise exception using errcode = '55000',
      message = 'Growth Plan command receipt completion failed';
  end if;

  return v_response;
end
$function$;

alter function planning.active_track_capacity_constraint_v1(uuid, uuid)
  owner to pando_planning_api;
alter function planning.build_growth_plan_capacity_preview_v1(
  uuid, uuid, text, text, integer, bigint, integer, bigint, text, integer, integer, text
) owner to pando_planning_api;
alter function planning.plan_capacity_event_payload_v1_is_valid(jsonb)
  owner to pando_planning_api;
alter function api.preview_growth_plan_capacity_v1(integer, text, text)
  owner to pando_planning_api;
alter function api.apply_growth_plan_capacity_v1(integer, text, text, text, text)
  owner to pando_planning_api;

revoke all on function
  planning.active_track_capacity_constraint_v1(uuid, uuid),
  planning.build_growth_plan_capacity_preview_v1(
    uuid, uuid, text, text, integer, bigint, integer, bigint, text, integer, integer, text
  ),
  planning.plan_capacity_event_payload_v1_is_valid(jsonb),
  api.preview_growth_plan_capacity_v1(integer, text, text),
  api.apply_growth_plan_capacity_v1(integer, text, text, text, text)
  from public, anon, authenticated, service_role;

grant execute on function
  api.preview_growth_plan_capacity_v1(integer, text, text),
  api.apply_growth_plan_capacity_v1(integer, text, text, text, text)
  to authenticated;

revoke create on schema planning, api from pando_planning_api;

do $migration_role_membership$
begin
  execute pg_catalog.format('revoke pando_planning_api from %I', current_user);
end
$migration_role_membership$;
