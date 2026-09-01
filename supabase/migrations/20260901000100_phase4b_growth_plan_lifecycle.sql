-- Phase 4B D1: bounded Growth Plan read plus deterministic pause/resume preview and apply.

do $migration_role_membership$
begin
  execute pg_catalog.format('grant pando_planning_api to %I with set true', current_user);
end
$migration_role_membership$;

grant create on schema planning, api to pando_planning_api;

grant update (lifecycle, aggregate_version, updated_at)
  on planning.growth_plans to pando_planning_api;

create function planning.build_growth_plan_lifecycle_preview_v1(
  p_workspace_id uuid,
  p_growth_plan_id uuid,
  p_title text,
  p_lifecycle text,
  p_weekly_capacity_minutes integer,
  p_aggregate_version bigint,
  p_operation text,
  p_expected_growth_plan_version bigint,
  p_reason text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_after_lifecycle text;
  v_after_version bigint;
  v_digest_input text;
  v_digest text;
begin
  if p_workspace_id is null or p_growth_plan_id is null
     or p_title is null or p_weekly_capacity_minutes is null
     or p_aggregate_version is null or p_aggregate_version < 1
     or p_expected_growth_plan_version is null or p_expected_growth_plan_version < 1 then
    raise exception using errcode = '22023', message = 'Growth Plan preview input is invalid';
  end if;
  if p_operation not in ('pause_growth_plan', 'resume_growth_plan') then
    raise exception using errcode = '22023', message = 'Growth Plan lifecycle operation is invalid';
  end if;
  if p_reason is null or p_reason <> pg_catalog.btrim(p_reason)
     or pg_catalog.char_length(p_reason) not between 1 and 500
     or p_reason ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'Growth Plan lifecycle reason is invalid';
  end if;
  if p_expected_growth_plan_version <> p_aggregate_version then
    raise exception using errcode = '40001', message = 'Growth Plan version is stale';
  end if;
  if p_aggregate_version = 9223372036854775807 then
    raise exception using errcode = '22003', message = 'Growth Plan version is exhausted';
  end if;

  if p_operation = 'pause_growth_plan' and p_lifecycle = 'active' then
    v_after_lifecycle := 'paused';
  elsif p_operation = 'resume_growth_plan' and p_lifecycle = 'paused' then
    v_after_lifecycle := 'active';
  else
    raise exception using errcode = '22023', message = 'Growth Plan lifecycle transition is invalid';
  end if;
  v_after_version := p_aggregate_version + 1;

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
      (1, 'digestVersion', 'growth-plan-lifecycle-preview-digest/1.0.0'),
      (2, 'contractVersion', '1.0.0'),
      (3, 'workspaceId', pg_catalog.lower(p_workspace_id::text)),
      (4, 'operation', p_operation),
      (5, 'reason', p_reason),
      (6, 'growthPlanId', pg_catalog.lower(p_growth_plan_id::text)),
      (7, 'beforeAggregateVersion', p_aggregate_version::text),
      (8, 'afterAggregateVersion', v_after_version::text),
      (9, 'beforeLifecycle', pg_catalog.upper(p_lifecycle)),
      (10, 'afterLifecycle', pg_catalog.upper(v_after_lifecycle)),
      (11, 'title', p_title),
      (12, 'weeklyCapacityMinutes', p_weekly_capacity_minutes::text),
      (13, 'projectionStateAfterApply', 'PENDING'),
      (14, 'consumerName', 'planning.plan_snapshot_v1')
  ) as digest_field(field_position, field_name, field_value);
  v_digest := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(v_digest_input, 'UTF8'), 'sha256'),
    'hex'
  );

  return pg_catalog.jsonb_build_object(
    'contract', pg_catalog.jsonb_build_object(
      'name', 'GrowthPlanLifecyclePreviewV1', 'version', '1.0.0'
    ),
    'operation', p_operation,
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
      'lifecycle', pg_catalog.upper(v_after_lifecycle),
      'weeklyCapacityMinutes', p_weekly_capacity_minutes,
      'aggregateVersion', v_after_version::text
    ),
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

create function planning.plan_lifecycle_event_payload_v1_is_valid(p_payload jsonb)
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
    and p_payload->>'growth_plan_version' ~ '^[1-9][0-9]{0,18}$'
    and p_payload->>'lifecycle' in ('ACTIVE', 'PAUSED')
$function$;

create function api.get_current_growth_plan_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_workspace_id uuid;
  v_plan planning.growth_plans%rowtype;
  v_today jsonb;
  v_projection_state text;
  v_reason text;
  v_last_known_safe boolean;
begin
  if identity.jwt_subject() is null then
    raise exception using errcode = '28000', message = 'an authenticated user is required';
  end if;
  v_workspace_id := identity.personal_workspace_id_for_current_user();
  if v_workspace_id is null then
    raise exception using errcode = '42501', message = 'workspace is not accessible';
  end if;

  select plan.* into v_plan
  from planning.growth_plans as plan
  where plan.workspace_id = v_workspace_id
    and plan.lifecycle in ('active', 'paused');

  if not found then
    return pg_catalog.jsonb_build_object(
      'contract', pg_catalog.jsonb_build_object(
        'name', 'CurrentGrowthPlanV1', 'version', '1.0.0'
      ),
      'currentPlan', null,
      'recalculation', pg_catalog.jsonb_build_object(
        'projectionState', 'NOT_STARTED',
        'reason', 'INITIALIZING',
        'lastKnownSafe', false
      ),
      'capabilities', '[]'::jsonb
    );
  end if;

  v_today := planning.read_today_workspace_v1(v_workspace_id, pg_catalog.statement_timestamp());
  v_projection_state := v_today->>'projectionState';
  v_reason := v_today->>'reason';
  v_last_known_safe := coalesce((v_today->>'lastKnownSafe')::boolean, false);
  if v_projection_state = 'NOT_STARTED' then
    v_projection_state := 'PENDING';
    v_reason := 'INPUTS_CHANGED';
    v_last_known_safe := false;
  end if;

  return pg_catalog.jsonb_build_object(
    'contract', pg_catalog.jsonb_build_object(
      'name', 'CurrentGrowthPlanV1', 'version', '1.0.0'
    ),
    'currentPlan', pg_catalog.jsonb_build_object(
      'growthPlanId', v_plan.growth_plan_id,
      'title', v_plan.title,
      'lifecycle', pg_catalog.upper(v_plan.lifecycle),
      'weeklyCapacityMinutes', v_plan.weekly_capacity_minutes,
      'aggregateVersion', v_plan.aggregate_version::text
    ),
    'recalculation', pg_catalog.jsonb_build_object(
      'projectionState', v_projection_state,
      'reason', v_reason,
      'lastKnownSafe', v_last_known_safe
    ),
    'capabilities', pg_catalog.jsonb_build_array(
      case when v_plan.lifecycle = 'active'
        then 'pause_growth_plan' else 'resume_growth_plan' end
    )
  );
end
$function$;

create function api.preview_growth_plan_lifecycle_v1(
  p_operation text,
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
begin
  if identity.jwt_subject() is null then
    raise exception using errcode = '28000', message = 'an authenticated user is required';
  end if;
  v_workspace_id := identity.personal_workspace_id_for_current_user();
  if v_workspace_id is null then
    raise exception using errcode = '42501', message = 'Growth Plan is unavailable';
  end if;
  if p_expected_growth_plan_version is null
     or p_expected_growth_plan_version !~ '^[1-9][0-9]{0,18}$' then
    raise exception using errcode = '22023', message = 'Growth Plan version is invalid';
  end if;
  if p_expected_growth_plan_version::numeric > 9223372036854775807 then
    raise exception using errcode = '22023', message = 'Growth Plan version is invalid';
  end if;
  select plan.* into v_plan
  from planning.growth_plans as plan
  where plan.workspace_id = v_workspace_id
    and plan.lifecycle in ('active', 'paused');
  if not found then
    raise exception using errcode = '42501', message = 'Growth Plan is unavailable';
  end if;
  return planning.build_growth_plan_lifecycle_preview_v1(
    v_workspace_id,
    v_plan.growth_plan_id,
    v_plan.title,
    v_plan.lifecycle,
    v_plan.weekly_capacity_minutes,
    v_plan.aggregate_version,
    p_operation,
    p_expected_growth_plan_version::bigint,
    p_reason
  );
end
$function$;

create function api.apply_growth_plan_lifecycle_v1(
  p_operation text,
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
  v_preview jsonb;
  v_payload jsonb;
  v_command_id uuid := gen_random_uuid();
  v_correlation_id uuid := gen_random_uuid();
  v_event_id uuid := gen_random_uuid();
  v_delivery_id uuid := gen_random_uuid();
  v_request_hash bytea;
  v_response jsonb;
  v_receipt outbox.command_receipts%rowtype;
begin
  if identity.jwt_subject() is null then
    raise exception using errcode = '28000', message = 'an authenticated user is required';
  end if;
  v_actor_user_id := identity.current_user_id();
  v_workspace_id := identity.personal_workspace_id_for_current_user();
  if v_actor_user_id is null or v_workspace_id is null then
    raise exception using errcode = '28000', message = 'authenticated user is not provisioned';
  end if;
  if p_operation not in ('pause_growth_plan', 'resume_growth_plan')
     or p_expected_growth_plan_version is null
     or p_expected_growth_plan_version !~ '^[1-9][0-9]{0,18}$' then
    raise exception using errcode = '22023', message = 'Growth Plan lifecycle request is invalid';
  end if;
  if p_expected_growth_plan_version::numeric > 9223372036854775807 then
    raise exception using errcode = '22023', message = 'Growth Plan lifecycle request is invalid';
  end if;
  if p_preview_digest is null or p_preview_digest !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'Growth Plan preview digest is invalid';
  end if;
  if p_reason is null or p_reason <> pg_catalog.btrim(p_reason)
     or pg_catalog.char_length(p_reason) not between 1 and 500
     or p_reason ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'Growth Plan lifecycle reason is invalid';
  end if;
  if p_idempotency_key is null or p_idempotency_key <> pg_catalog.btrim(p_idempotency_key)
     or pg_catalog.char_length(p_idempotency_key) not between 1 and 128
     or p_idempotency_key ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'idempotency key is invalid';
  end if;

  v_request_hash := extensions.digest(
    pg_catalog.convert_to(
      pg_catalog.jsonb_build_object(
        'commandType', 'planning.change_growth_plan_lifecycle',
        'schemaVersion', 1,
        'workspaceId', v_workspace_id,
        'operation', p_operation,
        'expectedGrowthPlanVersion', p_expected_growth_plan_version,
        'previewDigest', p_preview_digest,
        'reason', p_reason
      )::text,
      'UTF8'
    ),
    'sha256'
  );

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    v_actor_user_id::text || ':planning.change_growth_plan_lifecycle:' || p_idempotency_key,
    0
  ));
  select receipt.* into v_receipt
  from outbox.command_receipts as receipt
  where receipt.actor_user_id = v_actor_user_id
    and receipt.command_type = 'planning.change_growth_plan_lifecycle'
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

  v_preview := planning.build_growth_plan_lifecycle_preview_v1(
    v_workspace_id,
    v_plan.growth_plan_id,
    v_plan.title,
    v_plan.lifecycle,
    v_plan.weekly_capacity_minutes,
    v_plan.aggregate_version,
    p_operation,
    p_expected_growth_plan_version::bigint,
    p_reason
  );
  if v_preview->>'previewDigest' is distinct from p_preview_digest then
    raise exception using errcode = '40001', message = 'Growth Plan preview is stale';
  end if;

  insert into outbox.command_receipts (
    command_id, command_type, command_schema_version, workspace_id, actor_user_id,
    idempotency_key, request_hash, correlation_id, expected_aggregate_version
  ) values (
    v_command_id, 'planning.change_growth_plan_lifecycle', 1, v_workspace_id,
    v_actor_user_id, p_idempotency_key, v_request_hash, v_correlation_id,
    p_expected_growth_plan_version::bigint
  );

  update planning.growth_plans
  set lifecycle = pg_catalog.lower(v_preview#>>'{after,lifecycle}'),
    aggregate_version = aggregate_version + 1,
    updated_at = pg_catalog.clock_timestamp()
  where workspace_id = v_workspace_id
    and growth_plan_id = v_plan.growth_plan_id;

  v_payload := pg_catalog.jsonb_build_object(
    'change_kind', 'PLAN_LIFECYCLE_CHANGED',
    'growth_plan_id', v_plan.growth_plan_id,
    'growth_plan_version', v_preview#>>'{after,aggregateVersion}',
    'lifecycle', v_preview#>>'{after,lifecycle}'
  );
  if planning.plan_lifecycle_event_payload_v1_is_valid(v_payload) is not true then
    raise exception using errcode = '55000', message = 'Planning lifecycle event payload is invalid';
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
      'name', 'GrowthPlanLifecycleApplyResultV1', 'version', '1.0.0'
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

  return v_response;
end
$function$;

alter function planning.build_growth_plan_lifecycle_preview_v1(
  uuid, uuid, text, text, integer, bigint, text, bigint, text
) owner to pando_planning_api;
alter function planning.plan_lifecycle_event_payload_v1_is_valid(jsonb)
  owner to pando_planning_api;
alter function api.get_current_growth_plan_v1() owner to pando_planning_api;
alter function api.preview_growth_plan_lifecycle_v1(text, text, text)
  owner to pando_planning_api;
alter function api.apply_growth_plan_lifecycle_v1(text, text, text, text, text)
  owner to pando_planning_api;

revoke all on function
  planning.build_growth_plan_lifecycle_preview_v1(
    uuid, uuid, text, text, integer, bigint, text, bigint, text
  ),
  planning.plan_lifecycle_event_payload_v1_is_valid(jsonb),
  api.get_current_growth_plan_v1(),
  api.preview_growth_plan_lifecycle_v1(text, text, text),
  api.apply_growth_plan_lifecycle_v1(text, text, text, text, text)
  from public, anon, authenticated, service_role;

grant execute on function
  api.get_current_growth_plan_v1(),
  api.preview_growth_plan_lifecycle_v1(text, text, text),
  api.apply_growth_plan_lifecycle_v1(text, text, text, text, text)
  to authenticated;

revoke create on schema planning, api from pando_planning_api;

do $migration_role_membership$
begin
  execute pg_catalog.format('revoke pando_planning_api from %I', current_user);
end
$migration_role_membership$;
