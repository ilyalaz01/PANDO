-- One Planning-owned command initializes the first Growth Plan, initial Track,
-- pointer sentinel, event, and fixed Planning delivery atomically.

do $migration_role_membership$
begin
  execute pg_catalog.format('grant pando_planning_api to %I with set true', current_user);
end
$migration_role_membership$;

grant create on schema planning to pando_planning_api;

create function planning.initialize_growth_plan_impl_v1(
  p_readiness_goal_key text,
  p_weekly_capacity_minutes integer,
  p_default_session_minutes integer,
  p_track_priority integer,
  p_protected_minimum_minutes integer,
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
  v_readiness_goal_id uuid;
  v_profile_version_id uuid;
  v_profile_version_key text;
  v_roadmap_version_id uuid;
  v_growth_plan_title text;
  v_track_key text;
  v_track_title text;
  v_initialization_source jsonb;
  v_growth_plan_id uuid := gen_random_uuid();
  v_learning_track_id uuid := gen_random_uuid();
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

  if p_readiness_goal_key is null
     or p_readiness_goal_key !~ '^goal:[a-z0-9][a-z0-9-]{1,100}$' then
    raise exception using errcode = '22023', message = 'readiness goal key is invalid';
  end if;
  if p_weekly_capacity_minutes is null
     or p_weekly_capacity_minutes not between 0 and 10080 then
    raise exception using errcode = '22023', message = 'weekly capacity must be between 0 and 10080 minutes';
  end if;
  if p_default_session_minutes is null
     or p_default_session_minutes not between 1 and 480 then
    raise exception using errcode = '22023', message = 'default session must be between 1 and 480 minutes';
  end if;
  if p_track_priority is null or p_track_priority not between 0 and 100 then
    raise exception using errcode = '22023', message = 'track priority must be between 0 and 100';
  end if;
  if p_protected_minimum_minutes is null
     or p_protected_minimum_minutes not between 0 and 10080
     or p_protected_minimum_minutes > p_weekly_capacity_minutes then
    raise exception using errcode = '22023', message = 'protected minimum must fit weekly capacity';
  end if;
  if p_idempotency_key is null or p_idempotency_key <> btrim(p_idempotency_key)
     or char_length(p_idempotency_key) not between 1 and 128 then
    raise exception using errcode = '22023', message = 'idempotency key must contain 1 to 128 trimmed characters';
  end if;

  v_request_hash := extensions.digest(
    pg_catalog.convert_to(
      pg_catalog.jsonb_build_object(
        'commandType', 'planning.initialize_growth_plan',
        'schemaVersion', 1,
        'workspaceId', v_workspace_id,
        'readinessGoalKey', p_readiness_goal_key,
        'weeklyCapacityMinutes', p_weekly_capacity_minutes,
        'defaultSessionMinutes', p_default_session_minutes,
        'trackPriority', p_track_priority,
        'protectedMinimumMinutes', p_protected_minimum_minutes
      )::text,
      'UTF8'
    ),
    'sha256'
  );

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    v_actor_user_id::text || ':planning.initialize_growth_plan:' || p_idempotency_key,
    0
  ));
  select receipt.* into v_receipt
  from outbox.command_receipts as receipt
  where receipt.actor_user_id = v_actor_user_id
    and receipt.command_type = 'planning.initialize_growth_plan'
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

  v_initialization_source := targets.get_growth_plan_initialization_source_v1(
    v_workspace_id,
    p_readiness_goal_key
  );
  if v_initialization_source#>>'{contract,name}' <> 'GrowthPlanInitializationSourceV1'
     or v_initialization_source#>>'{contract,version}' <> '1.0.0'
     or v_initialization_source#>>'{readinessGoal,lifecycle}' <> 'ACTIVE' then
    raise exception using errcode = '55000', message = 'Targets initialization source contract is invalid';
  end if;
  v_readiness_goal_id := (v_initialization_source#>>'{readinessGoal,readinessGoalId}')::uuid;
  v_profile_version_id := (v_initialization_source#>>'{targetProfile,profileVersionId}')::uuid;
  v_profile_version_key := v_initialization_source#>>'{targetProfile,profileVersionKey}';
  v_roadmap_version_id := (v_initialization_source#>>'{targetProfile,roadmapVersionId}')::uuid;
  v_growth_plan_title := v_initialization_source#>>'{readinessGoal,title}';
  v_track_title := btrim(left(v_growth_plan_title, 160));
  v_track_key := 'track:' || v_learning_track_id::text;

  if exists (
    select 1 from planning.growth_plans as plan
    where plan.workspace_id = v_workspace_id
      and plan.lifecycle in ('active', 'paused')
  ) then
    raise exception using errcode = '23505', message = 'a current Growth Plan already exists';
  end if;

  insert into outbox.command_receipts (
    command_id, command_type, command_schema_version, workspace_id, actor_user_id,
    idempotency_key, request_hash, correlation_id, expected_aggregate_version
  ) values (
    v_command_id, 'planning.initialize_growth_plan', 1, v_workspace_id,
    v_actor_user_id, p_idempotency_key, v_request_hash, v_correlation_id, 0
  );

  insert into planning.growth_plans (
    growth_plan_id, workspace_id, title, weekly_capacity_minutes
  ) values (
    v_growth_plan_id, v_workspace_id, v_growth_plan_title, p_weekly_capacity_minutes
  );

  insert into planning.learning_tracks (
    learning_track_id, workspace_id, growth_plan_id, track_key, title,
    readiness_goal_id, profile_version_id, roadmap_version_id,
    priority, protected_minimum_minutes, default_session_minutes
  ) values (
    v_learning_track_id, v_workspace_id, v_growth_plan_id, v_track_key, v_track_title,
    v_readiness_goal_id, v_profile_version_id, v_roadmap_version_id,
    p_track_priority, p_protected_minimum_minutes, p_default_session_minutes
  );

  insert into planning.current_plan_snapshots as current_pointer (workspace_id)
  values (v_workspace_id)
  on conflict (workspace_id) do update
  set snapshot_id = null,
    pointer_version = current_pointer.pointer_version + 1,
    applied_attempt_id = null,
    updated_at = clock_timestamp();

  insert into outbox.events (
    event_id, event_name, event_schema_version, workspace_id, aggregate_type,
    aggregate_id, aggregate_version, actor_type, actor_user_id, command_id,
    correlation_id, occurred_at, source, payload
  ) values (
    v_event_id, 'planning.input_changed', 1, v_workspace_id,
    'planning.growth_plan', v_growth_plan_id, 1, 'user', v_actor_user_id,
    v_command_id, v_correlation_id, clock_timestamp(), 'pando.database',
    pg_catalog.jsonb_build_object(
      'change_kind', 'INITIALIZED',
      'growth_plan_id', v_growth_plan_id,
      'growth_plan_version', 1,
      'learning_track_id', v_learning_track_id,
      'learning_track_version', 1,
      'readiness_goal_id', v_readiness_goal_id,
      'profile_version_id', v_profile_version_id
    )
  );

  insert into outbox.deliveries (
    delivery_id, event_id, workspace_id, consumer_name, handler_contract_version
  ) values (
    v_delivery_id, v_event_id, v_workspace_id, 'planning.plan_snapshot_v1', 1
  );

  v_response := pg_catalog.jsonb_build_object(
    'commandId', v_command_id,
    'workspaceId', v_workspace_id,
    'growthPlanId', v_growth_plan_id,
    'learningTrackId', v_learning_track_id,
    'learningTrackKey', v_track_key,
    'readinessGoalId', v_readiness_goal_id,
    'profileVersionId', v_profile_version_id,
    'profileVersionKey', v_profile_version_key,
    'growthPlanAggregateVersion', 1,
    'learningTrackAggregateVersion', 1,
    'planningDeliveryId', v_delivery_id,
    'projectionState', 'PENDING',
    'emittedEventIds', pg_catalog.jsonb_build_array(v_event_id)
  );

  update outbox.command_receipts
  set command_status = 'completed', response = v_response,
    emitted_event_ids = array[v_event_id], completed_at = clock_timestamp()
  where command_id = v_command_id;

  return v_response;
end
$function$;

alter function planning.initialize_growth_plan_impl_v1(
  text, integer, integer, integer, integer, text
) owner to pando_planning_api;
revoke all on function planning.initialize_growth_plan_impl_v1(
  text, integer, integer, integer, integer, text
) from public, anon, authenticated, service_role;
grant execute on function planning.initialize_growth_plan_impl_v1(
  text, integer, integer, integer, integer, text
) to authenticated;
grant usage on schema planning to authenticated;

create function api.initialize_growth_plan_v1(
  p_readiness_goal_key text,
  p_weekly_capacity_minutes integer,
  p_default_session_minutes integer,
  p_track_priority integer,
  p_protected_minimum_minutes integer,
  p_idempotency_key text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $function$
  select planning.initialize_growth_plan_impl_v1(
    p_readiness_goal_key,
    p_weekly_capacity_minutes,
    p_default_session_minutes,
    p_track_priority,
    p_protected_minimum_minutes,
    p_idempotency_key
  )
$function$;

revoke all on function api.initialize_growth_plan_v1(
  text, integer, integer, integer, integer, text
) from public, anon, authenticated, service_role;
grant execute on function api.initialize_growth_plan_v1(
  text, integer, integer, integer, integer, text
) to authenticated;

revoke create on schema planning from pando_planning_api;

do $migration_role_membership$
begin
  execute pg_catalog.format('revoke pando_planning_api from %I', current_user);
end
$migration_role_membership$;
