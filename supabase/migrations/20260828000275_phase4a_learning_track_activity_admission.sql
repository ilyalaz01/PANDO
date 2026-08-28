-- Admit an existing active User Overlay activity into one current Learning Track.
-- Planning owns duration, optional energy, attribution, optimistic versioning, and recalculation.

do $migration_role_membership$
begin
  execute pg_catalog.format(
    'grant pando_phase1_api, pando_planning_api to %I with set true',
    current_user
  );
end
$migration_role_membership$;

grant create on schema overlay, targets to pando_phase1_api;
grant create on schema api, planning to pando_planning_api;

-- Targets revalidates the Track's immutable goal/profile pair at command time. A paused plan or
-- Track remains editable, but an inactive goal cannot acquire new target-backed activity input.
create function targets.get_planning_track_goal_admission_source_v1(
  p_workspace_id uuid,
  p_readiness_goal_id uuid,
  p_profile_version_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_source jsonb;
begin
  if identity.jwt_subject() is null then
    raise exception using errcode = '28000', message = 'an authenticated user is required';
  end if;
  if not identity.is_workspace_member(p_workspace_id) then
    raise exception using errcode = '42501', message = 'workspace is not accessible';
  end if;
  if p_readiness_goal_id is null or p_profile_version_id is null then
    raise exception using errcode = '22023', message = 'readiness goal identity is invalid';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_workspace_id::text || ':targets.active-readiness-goals',
      2
    )
  );

  select pg_catalog.jsonb_build_object(
    'contract', pg_catalog.jsonb_build_object(
      'name', 'PlanningTrackGoalAdmissionSourceV1',
      'version', '1.0.0'
    ),
    'readinessGoal', pg_catalog.jsonb_build_object(
      'readinessGoalId', goal.readiness_goal_id,
      'profileVersionId', goal.profile_version_id,
      'lifecycle', upper(goal.lifecycle)
    ),
    'ownerRevision', 'readiness-goal:' || goal.aggregate_version::text
  )
  into v_source
  from targets.readiness_goals as goal
  join targets.target_profile_versions as profile
    on profile.profile_version_id = goal.profile_version_id
  where goal.workspace_id = p_workspace_id
    and goal.readiness_goal_id = p_readiness_goal_id
    and goal.profile_version_id = p_profile_version_id
    and goal.lifecycle = 'active'
    and profile.lifecycle in ('published', 'retired');

  if v_source is null then
    raise exception using errcode = '42501', message = 'active readiness goal is not accessible';
  end if;

  return v_source;
end
$function$;

alter function targets.get_planning_track_goal_admission_source_v1(uuid, uuid, uuid)
  owner to pando_phase1_api;
revoke all on function targets.get_planning_track_goal_admission_source_v1(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function targets.get_planning_track_goal_admission_source_v1(uuid, uuid, uuid)
  to pando_planning_api;

-- User Overlay owns the activity and exposes only the exact admission facts Planning needs.
-- The shared Overlay advisory fence keeps this read atomic with current/future Overlay commands.
create function overlay.get_planning_activity_admission_source_v1(
  p_workspace_id uuid,
  p_profile_version_id uuid,
  p_activity_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_source jsonb;
  v_overlay_version bigint;
begin
  if identity.jwt_subject() is null then
    raise exception using errcode = '28000', message = 'an authenticated user is required';
  end if;
  if not identity.is_workspace_member(p_workspace_id) then
    raise exception using errcode = '42501', message = 'workspace is not accessible';
  end if;
  if p_profile_version_id is null then
    raise exception using errcode = '22023', message = 'target profile identity is invalid';
  end if;
  if p_activity_key is null
     or p_activity_key !~ '^activity:[a-z0-9][a-z0-9-]{1,100}$' then
    raise exception using errcode = '22023', message = 'activity key is invalid';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_workspace_id::text, 1)
  );

  select coalesce(root.aggregate_version, 0)
  into v_overlay_version
  from (select 1) as singleton
  left join overlay.workspace_overlays as root
    on root.workspace_id = p_workspace_id;

  select pg_catalog.jsonb_build_object(
    'contract', pg_catalog.jsonb_build_object(
      'name', 'PlanningActivityAdmissionSourceV1',
      'version', '1.0.0'
    ),
    'customActivity', pg_catalog.jsonb_build_object(
      'customActivityId', activity.custom_activity_id,
      'activityKey', activity.activity_key,
      'profileVersionId', activity.profile_version_id,
      'targetCompetencyRef', activity.target_competency_ref,
      'lifecycle', upper(activity.lifecycle),
      'mappingStatus', upper(activity.mapping_status)
    ),
    'ownerRevision', 'workspace-overlay:' || v_overlay_version::text
  )
  into v_source
  from overlay.custom_activities as activity
  where activity.workspace_id = p_workspace_id
    and activity.profile_version_id = p_profile_version_id
    and activity.activity_key = p_activity_key
    and activity.lifecycle = 'active'
    and activity.mapping_status = 'accepted';

  if v_source is null then
    raise exception using errcode = '42501', message = 'active custom activity is not accessible';
  end if;

  return v_source;
end
$function$;

alter function overlay.get_planning_activity_admission_source_v1(uuid, uuid, text)
  owner to pando_phase1_api;
revoke all on function overlay.get_planning_activity_admission_source_v1(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function overlay.get_planning_activity_admission_source_v1(uuid, uuid, text)
  to pando_planning_api;

do $preflight$
begin
  if exists (
    select 1
    from planning.learning_track_activities as attribution
    join planning.learning_tracks as track
      on track.workspace_id = attribution.workspace_id
     and track.growth_plan_id = attribution.growth_plan_id
     and track.learning_track_id = attribution.learning_track_id
    join overlay.custom_activities as activity
      on activity.workspace_id = attribution.workspace_id
     and activity.custom_activity_id = attribution.custom_activity_id
    where activity.profile_version_id <> track.profile_version_id
  ) then
    raise exception using errcode = '23514', message = 'existing Planning activity attribution crosses target profiles';
  end if;
  if exists (
    select 1
    from planning.learning_track_activities as attribution
    where attribution.lifecycle <> 'archived'
    group by attribution.workspace_id, attribution.growth_plan_id
    having count(*) > 200
  ) then
    raise exception using errcode = '23514', message = 'existing Growth Plan exceeds the 200 activity limit';
  end if;
end
$preflight$;

grant insert on planning.learning_track_activities to pando_planning_api;
grant update (aggregate_version, updated_at)
  on planning.learning_tracks to pando_planning_api;

create policy learning_track_activities_planning_api_insert
on planning.learning_track_activities
for insert to pando_planning_api
with check (identity.is_workspace_member(workspace_id));

-- Input changes may belong to either the Growth Plan root or a versioned Track aggregate.
drop policy events_planning_insert on outbox.events;
create policy events_planning_insert on outbox.events
for insert to pando_planning_api
with check (
  identity.is_workspace_member(workspace_id)
  and event_name = 'planning.input_changed'
  and event_schema_version = 1
  and aggregate_type in ('planning.growth_plan', 'planning.learning_track')
  and aggregate_id is not null
  and aggregate_version is not null
  and actor_type = 'user'
  and actor_user_id = identity.current_user_id()
  and source = 'pando.database'
);

create function planning.add_learning_track_activity_impl_v1(
  p_learning_track_key text,
  p_activity_key text,
  p_estimated_minutes integer,
  p_energy text,
  p_expected_learning_track_version bigint,
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
  v_track planning.learning_tracks%rowtype;
  v_goal_source jsonb;
  v_activity_source jsonb;
  v_custom_activity_id uuid;
  v_candidate_key text := 'candidate:' || gen_random_uuid()::text;
  v_resolved_minutes integer;
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

  if p_learning_track_key is null
     or p_learning_track_key !~ '^track:[a-z0-9][a-z0-9-]{1,100}$' then
    raise exception using errcode = '22023', message = 'learning track key is invalid';
  end if;
  if p_activity_key is null
     or p_activity_key !~ '^activity:[a-z0-9][a-z0-9-]{1,100}$' then
    raise exception using errcode = '22023', message = 'activity key is invalid';
  end if;
  if p_expected_learning_track_version is null
     or p_expected_learning_track_version < 1 then
    raise exception using errcode = '22023', message = 'expected Learning Track version must be positive';
  end if;
  if p_idempotency_key is null
     or p_idempotency_key <> btrim(p_idempotency_key)
     or char_length(p_idempotency_key) not between 1 and 128 then
    raise exception using errcode = '22023', message = 'idempotency key must contain 1 to 128 trimmed characters';
  end if;
  if p_estimated_minutes is null
     or p_estimated_minutes not between 1 and 480 then
    raise exception using errcode = '22023', message = 'estimated minutes must be between 1 and 480';
  end if;
  if p_energy is not null and p_energy not in ('LOW', 'MEDIUM', 'HIGH') then
    raise exception using errcode = '22023', message = 'energy must be LOW, MEDIUM, HIGH, or null';
  end if;

  v_request_hash := extensions.digest(
    pg_catalog.convert_to(
      pg_catalog.jsonb_build_object(
        'commandType', 'planning.add_learning_track_activity',
        'schemaVersion', 1,
        'workspaceId', v_workspace_id,
        'learningTrackKey', p_learning_track_key,
        'activityKey', p_activity_key,
        'expectedLearningTrackVersion', p_expected_learning_track_version,
        'estimatedMinutes', p_estimated_minutes,
        'energy', p_energy
      )::text,
      'UTF8'
    ),
    'sha256'
  );

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    v_actor_user_id::text || ':planning.add_learning_track_activity:' || p_idempotency_key,
    0
  ));
  select receipt.*
  into v_receipt
  from outbox.command_receipts as receipt
  where receipt.actor_user_id = v_actor_user_id
    and receipt.command_type = 'planning.add_learning_track_activity'
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

  select track.*
  into v_track
  from planning.learning_tracks as track
  join planning.growth_plans as plan
    on plan.workspace_id = track.workspace_id
   and plan.growth_plan_id = track.growth_plan_id
  where track.workspace_id = v_workspace_id
    and track.track_key = p_learning_track_key
    and track.lifecycle in ('active', 'paused')
    and plan.lifecycle in ('active', 'paused')
  for update of track;
  if not found then
    raise exception using errcode = '42501', message = 'current Learning Track is not accessible';
  end if;
  if v_track.aggregate_version <> p_expected_learning_track_version then
    raise exception using errcode = '40001', message = 'Learning Track aggregate version conflict';
  end if;

  v_goal_source := targets.get_planning_track_goal_admission_source_v1(
    v_workspace_id,
    v_track.readiness_goal_id,
    v_track.profile_version_id
  );
  if v_goal_source#>>'{contract,name}' <> 'PlanningTrackGoalAdmissionSourceV1'
     or v_goal_source#>>'{contract,version}' <> '1.0.0'
     or (v_goal_source#>>'{readinessGoal,readinessGoalId}')::uuid
        <> v_track.readiness_goal_id
     or (v_goal_source#>>'{readinessGoal,profileVersionId}')::uuid
        <> v_track.profile_version_id
     or v_goal_source#>>'{readinessGoal,lifecycle}' <> 'ACTIVE' then
    raise exception using errcode = '55000', message = 'Targets goal admission source contract is invalid';
  end if;

  v_activity_source := overlay.get_planning_activity_admission_source_v1(
    v_workspace_id,
    v_track.profile_version_id,
    p_activity_key
  );
  if v_activity_source#>>'{contract,name}' <> 'PlanningActivityAdmissionSourceV1'
     or v_activity_source#>>'{contract,version}' <> '1.0.0'
     or v_activity_source#>>'{customActivity,activityKey}' <> p_activity_key
     or (v_activity_source#>>'{customActivity,profileVersionId}')::uuid
        <> v_track.profile_version_id
     or v_activity_source#>>'{customActivity,lifecycle}' <> 'ACTIVE'
     or v_activity_source#>>'{customActivity,mappingStatus}' <> 'ACCEPTED' then
    raise exception using errcode = '55000', message = 'Overlay activity admission source contract is invalid';
  end if;
  v_custom_activity_id :=
    (v_activity_source#>>'{customActivity,customActivityId}')::uuid;

  if exists (
    select 1
    from planning.learning_track_activities as activity
    where activity.workspace_id = v_workspace_id
      and activity.growth_plan_id = v_track.growth_plan_id
      and activity.custom_activity_id = v_custom_activity_id
  ) then
    raise exception using errcode = '23505', message = 'activity already belongs to the current Growth Plan';
  end if;
  if (
    select count(*)
    from planning.learning_track_activities as activity
    where activity.workspace_id = v_workspace_id
      and activity.growth_plan_id = v_track.growth_plan_id
      and activity.lifecycle <> 'archived'
  ) >= 200 then
    raise exception using errcode = '22023', message = 'current Growth Plan activity limit is 200';
  end if;

  v_resolved_minutes := p_estimated_minutes;

  insert into outbox.command_receipts (
    command_id, command_type, command_schema_version, workspace_id, actor_user_id,
    idempotency_key, request_hash, correlation_id, expected_aggregate_version
  ) values (
    v_command_id, 'planning.add_learning_track_activity', 1, v_workspace_id,
    v_actor_user_id, p_idempotency_key, v_request_hash, v_correlation_id,
    p_expected_learning_track_version
  );

  insert into planning.learning_track_activities (
    workspace_id, growth_plan_id, learning_track_id, custom_activity_id,
    candidate_key, estimated_minutes, energy
  ) values (
    v_workspace_id, v_track.growth_plan_id, v_track.learning_track_id,
    v_custom_activity_id, v_candidate_key, v_resolved_minutes, p_energy
  );

  update planning.learning_tracks
  set aggregate_version = aggregate_version + 1,
      updated_at = clock_timestamp()
  where workspace_id = v_workspace_id
    and learning_track_id = v_track.learning_track_id;

  insert into outbox.events (
    event_id, event_name, event_schema_version, workspace_id, aggregate_type,
    aggregate_id, aggregate_version, actor_type, actor_user_id, command_id,
    correlation_id, occurred_at, source, payload
  ) values (
    v_event_id, 'planning.input_changed', 1, v_workspace_id,
    'planning.learning_track', v_track.learning_track_id,
    p_expected_learning_track_version + 1, 'user', v_actor_user_id,
    v_command_id, v_correlation_id, clock_timestamp(), 'pando.database',
    pg_catalog.jsonb_build_object(
      'change_kind', 'TRACK_ACTIVITY_ADMITTED',
      'growth_plan_id', v_track.growth_plan_id,
      'learning_track_id', v_track.learning_track_id,
      'learning_track_version', (p_expected_learning_track_version + 1)::text,
      'custom_activity_id', v_custom_activity_id,
      'candidate_key', v_candidate_key
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
    'growthPlanId', v_track.growth_plan_id,
    'learningTrackId', v_track.learning_track_id,
    'learningTrackKey', v_track.track_key,
    'learningTrackAggregateVersion',
      (p_expected_learning_track_version + 1)::text,
    'customActivityId', v_custom_activity_id,
    'activityKey', p_activity_key,
    'candidateKey', v_candidate_key,
    'candidateAggregateVersion', '1',
    'estimatedMinutes', v_resolved_minutes,
    'energy', p_energy,
    'planningDeliveryId', v_delivery_id,
    'projectionState', 'PENDING',
    'emittedEventIds', pg_catalog.jsonb_build_array(v_event_id)
  );

  update outbox.command_receipts
  set command_status = 'completed',
      response = v_response,
      emitted_event_ids = array[v_event_id],
      completed_at = clock_timestamp()
  where command_id = v_command_id;

  return v_response;
end
$function$;

alter function planning.add_learning_track_activity_impl_v1(
  text, text, integer, text, bigint, text
) owner to pando_planning_api;
revoke all on function planning.add_learning_track_activity_impl_v1(
  text, text, integer, text, bigint, text
) from public, anon, authenticated, service_role;
grant execute on function planning.add_learning_track_activity_impl_v1(
  text, text, integer, text, bigint, text
) to authenticated;

create function api.add_learning_track_activity_v1(
  p_learning_track_key text,
  p_activity_key text,
  p_estimated_minutes integer,
  p_expected_learning_track_version text,
  p_idempotency_key text,
  p_energy text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if p_expected_learning_track_version is null
     or p_expected_learning_track_version !~ '^[1-9][0-9]{0,18}$'
     or (
       char_length(p_expected_learning_track_version) = 19
       and p_expected_learning_track_version > '9223372036854775807'
     ) then
    raise exception using errcode = '22023', message = 'expected Learning Track version is invalid';
  end if;

  return planning.add_learning_track_activity_impl_v1(
    p_learning_track_key,
    p_activity_key,
    p_estimated_minutes,
    p_energy,
    p_expected_learning_track_version::bigint,
    p_idempotency_key
  );
end
$function$;

alter function api.add_learning_track_activity_v1(
  text, text, integer, text, text, text
) owner to pando_planning_api;
revoke all on function api.add_learning_track_activity_v1(
  text, text, integer, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function api.add_learning_track_activity_v1(
  text, text, integer, text, text, text
) to authenticated;

revoke create on schema overlay, targets from pando_phase1_api;
revoke create on schema api, planning from pando_planning_api;

do $migration_role_membership$
begin
  execute pg_catalog.format(
    'revoke pando_phase1_api, pando_planning_api from %I',
    current_user
  );
end
$migration_role_membership$;
