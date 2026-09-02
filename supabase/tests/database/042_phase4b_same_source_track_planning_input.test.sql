begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
create temporary table d1b_legacy_initializer_fixture_marker(marker boolean);
create function pg_temp.initialize_growth_plan_fixture_v1(
  p_readiness_goal_key text,
  p_weekly_capacity_minutes integer,
  p_default_session_minutes integer,
  p_track_priority integer,
  p_protected_minimum_minutes integer,
  p_idempotency_key text
)
returns jsonb
language sql
security definer
set search_path = ''
as $function$
  select api.initialize_growth_plan_v1(
    p_readiness_goal_key, p_weekly_capacity_minutes, p_default_session_minutes,
    p_track_priority, p_protected_minimum_minutes, p_idempotency_key
  )
$function$;
revoke all on function pg_temp.initialize_growth_plan_fixture_v1(
  text, integer, integer, integer, integer, text
) from public, anon, authenticated, service_role;
grant execute on function pg_temp.initialize_growth_plan_fixture_v1(
  text, integer, integer, integer, integer, text
) to authenticated;
select no_plan();

select ok(
  procedure.prosecdef
    and 'search_path=""' = any(coalesce(procedure.proconfig, '{}'::text[]))
    and owner.rolname = 'pando_phase1_planning_source',
  'the deduplicating readiness owner query keeps its pinned definer boundary'
)
from pg_catalog.pg_proc as procedure
join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
join pg_catalog.pg_roles as owner on owner.oid = procedure.proowner
where namespace.nspname = 'targets'
  and procedure.proname = 'read_planning_readiness_source_v1';

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '42000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'same-source-planning@pando.test', '', pg_catalog.clock_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
);

create temporary table same_source_results(name text primary key, response jsonb not null);
create temporary table same_source_ids(
  workspace_id uuid primary key,
  readiness_goal_id uuid not null,
  profile_version_id uuid not null
);
grant select, insert on same_source_results to authenticated, pando_planning_worker;
grant select on same_source_ids to pando_planning_worker;

select set_config('request.jwt.claims', pg_catalog.jsonb_build_object(
  'sub', '42000000-0000-4000-8000-000000000001',
  'role', 'authenticated', 'aud', 'authenticated',
  'exp', extract(epoch from pg_catalog.clock_timestamp() + interval '1 hour')::bigint
)::text, true);
set local role authenticated;

insert into same_source_results values (
  'bootstrap', api.bootstrap_personal_workspace('same-source-planning', 'Same Source Planning')
);
insert into same_source_results
select 'goal', api.create_readiness_goal(
  (select (response->>'workspace_id')::uuid from same_source_results where name = 'bootstrap'),
  'goal:same-source-planning', 'Same source Planning goal',
  'target:nvidia-python-verification-base-v1', 'same-source-planning-goal'
);
insert into same_source_results values (
  'plan', pg_temp.initialize_growth_plan_fixture_v1(
    'goal:same-source-planning', 300, 25, 80, 60, 'same-source-planning-plan'
  )
);
insert into same_source_results values (
  'overlay', api.add_current_custom_activity_v1(
    'goal:same-source-planning', 'activity:same-source-practice',
    'Practice the shared source', 'MANUAL_CODING', 'competency:python-error-handling',
    '0', 'same-source-planning-overlay'
  )
);
insert into same_source_results values (
  'admission', pando_test.add_learning_track_activity_fixture_v1(
    (select response->>'learningTrackKey' from same_source_results where name = 'plan'),
    'activity:same-source-practice', 25, '1',
    'same-source-planning-admission', 'MEDIUM'
  )
);
reset role;

insert into same_source_ids
select
  (bootstrap.response->>'workspace_id')::uuid,
  (goal.response->>'readinessGoalId')::uuid,
  readiness_goal.profile_version_id
from same_source_results as bootstrap
cross join same_source_results as goal
join targets.readiness_goals as readiness_goal
  on readiness_goal.readiness_goal_id = (goal.response->>'readinessGoalId')::uuid
where bootstrap.name = 'bootstrap' and goal.name = 'goal';

insert into planning.learning_tracks (
  learning_track_id, workspace_id, growth_plan_id, track_key, title,
  readiness_goal_id, profile_version_id, roadmap_version_id, lifecycle,
  priority, protected_minimum_minutes, default_session_minutes, aggregate_version
)
select
  extensions.gen_random_uuid(), track.workspace_id, track.growth_plan_id,
  'track:same-source-second', 'Same source second Track',
  track.readiness_goal_id, track.profile_version_id, track.roadmap_version_id,
  'active', 70, 0, track.default_session_minutes, 1
from planning.learning_tracks as track
where track.learning_track_id = (
  select (response->>'learningTrackId')::uuid
  from same_source_results
  where name = 'plan'
);

do $planning_role$
begin
  execute pg_catalog.format('grant pando_planning_worker to %I with set true', current_user);
end
$planning_role$;

set local role pando_planning_worker;
insert into same_source_results
select 'duplicate-pair', targets.read_planning_readiness_source_v1(
  ids.workspace_id,
  array[ids.readiness_goal_id, ids.readiness_goal_id],
  array[ids.profile_version_id, ids.profile_version_id],
  pg_catalog.clock_timestamp()
)
from same_source_ids as ids;
insert into same_source_results
select 'source-bundle', planning.load_plan_snapshot_source_bundle_v1(
  ids.workspace_id,
  pg_catalog.clock_timestamp()
)
from same_source_ids as ids;
reset role;

select is(
  (select pg_catalog.jsonb_array_length(response#>'{plan,tracks}')
   from same_source_results where name = 'source-bundle'),
  2,
  'the real Planning source bundle keeps both same-source Tracks'
);

select is(
  (select pg_catalog.jsonb_array_length(response#>'{targets,items}')
   from same_source_results where name = 'source-bundle'),
  1,
  'the real Planning source bundle collapses their shared readiness input once'
);

select is(
  (select pg_catalog.jsonb_array_length(response->'items')
   from same_source_results where name = 'duplicate-pair'),
  1,
  'two Tracks sharing one Goal/Profile produce one Planning readiness input'
);

select is(
  (select response#>>'{items,0,readinessGoalKey}'
   from same_source_results where name = 'duplicate-pair'),
  'goal:same-source-planning',
  'the collapsed owner source preserves the exact authoritative Goal identity'
);

select is(
  (select response#>>'{items,0,profileVersionKey}'
   from same_source_results where name = 'duplicate-pair'),
  'target:nvidia-python-verification-base-v1',
  'the collapsed owner source preserves the exact immutable profile identity'
);

select throws_ok(
  pg_catalog.format(
    'select targets.read_planning_readiness_source_v1(%L::uuid,array[null::uuid],array[%L::uuid],pg_catalog.clock_timestamp())',
    (select workspace_id from same_source_ids),
    (select profile_version_id from same_source_ids)
  ),
  '22023',
  'planning Targets source input is invalid',
  'the owner query rejects a NULL positional Goal/Profile element explicitly'
);

select * from finish();
rollback;
