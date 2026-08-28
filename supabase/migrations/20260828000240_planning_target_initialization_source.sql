-- Targets-owned bounded query for the Planning Growth Plan initializer.

do $migration_role_membership$
begin
  execute pg_catalog.format(
    'grant pando_phase1_api, pando_planning_api to %I with set true',
    current_user
  );
end
$migration_role_membership$;

grant create on schema targets to pando_phase1_api;

create function targets.get_growth_plan_initialization_source_v1(
  p_workspace_id uuid,
  p_readiness_goal_key text
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
  if p_readiness_goal_key is null
     or p_readiness_goal_key !~ '^goal:[a-z0-9][a-z0-9-]{1,100}$' then
    raise exception using errcode = '22023', message = 'readiness goal key is invalid';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_workspace_id::text || ':targets.active-readiness-goals',
      2
    )
  );

  select pg_catalog.jsonb_build_object(
    'contract', pg_catalog.jsonb_build_object(
      'name', 'GrowthPlanInitializationSourceV1',
      'version', '1.0.0'
    ),
    'readinessGoal', pg_catalog.jsonb_build_object(
      'readinessGoalId', goal.readiness_goal_id,
      'readinessGoalKey', goal.readiness_goal_key,
      'title', goal.title,
      'lifecycle', upper(goal.lifecycle),
      'aggregateVersion', goal.aggregate_version::text
    ),
    'targetProfile', pg_catalog.jsonb_build_object(
      'profileVersionId', profile.profile_version_id,
      'profileVersionKey', profile.profile_version_key,
      'roadmapVersionId', profile.roadmap_version_id
    ),
    'ownerRevision', 'readiness-goal:' || goal.aggregate_version::text
  )
  into v_source
  from targets.readiness_goals as goal
  join targets.target_profile_versions as profile
    on profile.profile_version_id = goal.profile_version_id
  where goal.workspace_id = p_workspace_id
    and goal.readiness_goal_key = p_readiness_goal_key
    and goal.lifecycle = 'active'
    and profile.lifecycle in ('published', 'retired');

  if v_source is null then
    raise exception using errcode = '42501', message = 'active readiness goal is not accessible';
  end if;

  return v_source;
end
$function$;

alter function targets.get_growth_plan_initialization_source_v1(uuid, text)
  owner to pando_phase1_api;
revoke all on function targets.get_growth_plan_initialization_source_v1(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function targets.get_growth_plan_initialization_source_v1(uuid, text)
  to pando_planning_api;

revoke create on schema targets from pando_phase1_api;

do $migration_role_membership$
begin
  execute pg_catalog.format(
    'revoke pando_phase1_api, pando_planning_api from %I',
    current_user
  );
end
$migration_role_membership$;
