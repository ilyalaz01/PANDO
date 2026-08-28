begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

select ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'api.add_learning_track_activity_v1(text,text,integer,text,text,text)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'anon',
    'api.add_learning_track_activity_v1(text,text,integer,text,text,text)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'service_role',
    'api.add_learning_track_activity_v1(text,text,integer,text,text,text)',
    'EXECUTE'
  ),
  'only authenticated callers can invoke Learning Track activity admission'
);

select ok(
  not procedure.prosecdef
    and 'search_path=""' = any(coalesce(procedure.proconfig, '{}'::text[]))
    and owner.rolname = 'pando_planning_api'
    and pg_catalog.has_function_privilege(
      'authenticated',
      'planning.add_learning_track_activity_impl_v1(text,text,integer,text,bigint,text)',
      'EXECUTE'
    ),
  'the exposed API is a pinned SECURITY INVOKER wrapper over the Planning implementation'
)
from pg_catalog.pg_proc as procedure
join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
join pg_catalog.pg_roles as owner on owner.oid = procedure.proowner
where namespace.nspname = 'api'
  and procedure.proname = 'add_learning_track_activity_v1';

select ok(
  count(*) = 2
    and bool_and(procedure.prosecdef)
    and bool_and('search_path=""' = any(coalesce(procedure.proconfig, '{}'::text[])))
    and bool_and(owner.rolname = 'pando_phase1_api'),
  'Targets and Overlay admission sources are pinned owner-owned boundaries'
)
from pg_catalog.pg_proc as procedure
join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
join pg_catalog.pg_roles as owner on owner.oid = procedure.proowner
where (namespace.nspname, procedure.proname) in (
  ('targets', 'get_planning_track_goal_admission_source_v1'),
  ('overlay', 'get_planning_activity_admission_source_v1')
);

select ok(
  pg_catalog.has_function_privilege(
    'pando_planning_api',
    'targets.get_planning_track_goal_admission_source_v1(uuid,uuid,uuid)',
    'EXECUTE'
  )
  and pg_catalog.has_function_privilege(
    'pando_planning_api',
    'overlay.get_planning_activity_admission_source_v1(uuid,uuid,text)',
    'EXECUTE'
  )
  and not pg_catalog.has_table_privilege(
    'pando_planning_api', 'targets.readiness_goals', 'SELECT'
  )
  and not pg_catalog.has_table_privilege(
    'pando_planning_api', 'overlay.custom_activities', 'SELECT'
  ),
  'Planning can execute bounded owner queries but cannot read owner tables'
);

select ok(
  pg_catalog.has_table_privilege(
    'pando_planning_api', 'planning.learning_track_activities', 'INSERT'
  )
  and not pg_catalog.has_table_privilege(
    'pando_planning_api', 'planning.learning_tracks', 'UPDATE'
  )
  and pg_catalog.has_column_privilege(
    'pando_planning_api', 'planning.learning_tracks', 'aggregate_version', 'UPDATE'
  )
  and pg_catalog.has_column_privilege(
    'pando_planning_api', 'planning.learning_tracks', 'updated_at', 'UPDATE'
  )
  and not pg_catalog.has_column_privilege(
    'pando_planning_api', 'planning.learning_tracks', 'title', 'UPDATE'
  )
  and exists (
    select 1
    from pg_catalog.pg_policies as policy
    where policy.schemaname = 'planning'
      and policy.tablename = 'learning_track_activities'
      and policy.policyname = 'learning_track_activities_planning_api_insert'
      and policy.cmd = 'INSERT'
      and policy.with_check is not null
  ),
  'activity admission has explicit least-privilege grants and an INSERT RLS policy'
);

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    '28000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
    'admission-alice@pando.test', '', clock_timestamp(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    clock_timestamp(), clock_timestamp()
  ),
  (
    '28000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
    'admission-bob@pando.test', '', clock_timestamp(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    clock_timestamp(), clock_timestamp()
  );

create temporary table admission_results (
  result_name text primary key,
  response jsonb not null
);
grant select, insert on admission_results to authenticated;
grant select on admission_results to pando_planning_api;

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '28000000-0000-4000-8000-000000000001',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text,
  true
);
set local role authenticated;
insert into admission_results values (
  'alice-bootstrap',
  api.bootstrap_personal_workspace('phase4a-admission-alice', 'Admission Alice')
);
insert into admission_results
select 'alice-goal', api.create_readiness_goal(
  (select (response->>'workspace_id')::uuid from admission_results
   where result_name = 'alice-bootstrap'),
  'goal:admission-alice', 'Alice activity admission',
  'target:nvidia-python-verification-base-v1', 'phase4a-admission-alice-goal'
);
insert into admission_results values (
  'alice-plan',
  api.initialize_growth_plan_v1(
    'goal:admission-alice', 600, 45, 80, 120, 'phase4a-admission-alice-plan'
  )
);
insert into admission_results values (
  'alice-overlay-first',
  api.add_current_custom_activity_v1(
    'goal:admission-alice', 'activity:admission-alice-first',
    'Alice first activity', 'PROJECT', 'competency:python-error-handling',
    '0', 'phase4a-admission-alice-overlay-first'
  )
);
insert into admission_results values (
  'alice-admit-first',
  api.add_learning_track_activity_v1(
    (select response->>'learningTrackKey' from admission_results
     where result_name = 'alice-plan'),
    'activity:admission-alice-first', 45, '1',
    'phase4a-admission-alice-first', null
  )
);
insert into admission_results values (
  'alice-admit-first-replay',
  api.add_learning_track_activity_v1(
    (select response->>'learningTrackKey' from admission_results
     where result_name = 'alice-plan'),
    'activity:admission-alice-first', 45, '1',
    'phase4a-admission-alice-first', null
  )
);
insert into admission_results values (
  'alice-overlay-second',
  api.add_current_custom_activity_v1(
    'goal:admission-alice', 'activity:admission-alice-second',
    'Alice second activity', 'MANUAL_CODING', 'competency:python-error-handling',
    '1', 'phase4a-admission-alice-overlay-second'
  )
);
insert into admission_results values (
  'alice-overlay-third',
  api.add_current_custom_activity_v1(
    'goal:admission-alice', 'activity:admission-alice-third',
    'Alice third activity', 'EXPLANATION', 'competency:python-error-handling',
    '2', 'phase4a-admission-alice-overlay-third'
  )
);
reset role;

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '28000000-0000-4000-8000-000000000002',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text,
  true
);
set local role authenticated;
insert into admission_results values (
  'bob-bootstrap',
  api.bootstrap_personal_workspace('phase4a-admission-bob', 'Admission Bob')
);
insert into admission_results
select 'bob-goal', api.create_readiness_goal(
  (select (response->>'workspace_id')::uuid from admission_results
   where result_name = 'bob-bootstrap'),
  'goal:admission-bob', 'Bob activity admission',
  'target:nvidia-python-verification-base-v1', 'phase4a-admission-bob-goal'
);
insert into admission_results values (
  'bob-plan',
  api.initialize_growth_plan_v1(
    'goal:admission-bob', 480, 30, 70, 90, 'phase4a-admission-bob-plan'
  )
);
insert into admission_results values (
  'bob-overlay-first',
  api.add_current_custom_activity_v1(
    'goal:admission-bob', 'activity:admission-bob-first',
    'Bob first activity', 'PROJECT', 'competency:python-error-handling',
    '0', 'phase4a-admission-bob-overlay-first'
  )
);
insert into admission_results values (
  'bob-admit-first',
  api.add_learning_track_activity_v1(
    (select response->>'learningTrackKey' from admission_results
     where result_name = 'bob-plan'),
    'activity:admission-bob-first', 480, '1',
    'phase4a-admission-bob-first', 'HIGH'
  )
);
reset role;

select is(
  (select response from admission_results where result_name = 'alice-admit-first-replay'),
  (select response from admission_results where result_name = 'alice-admit-first'),
  'an exact replay returns the byte-identical stored response'
);

select is(
  (select response->>'projectionState' from admission_results
   where result_name = 'alice-admit-first'),
  'PENDING',
  'admission truthfully reports pending recalculation'
);

select is(
  (select response->>'learningTrackAggregateVersion' from admission_results
   where result_name = 'alice-admit-first'),
  '2',
  'the response exposes the next Track version as a bigint string'
);

select is(
  (
    select count(*)::bigint
    from planning.learning_track_activities as activity
    join admission_results as result on result.result_name = 'alice-admit-first'
    where activity.workspace_id = (result.response->>'workspaceId')::uuid
      and activity.growth_plan_id = (result.response->>'growthPlanId')::uuid
      and activity.learning_track_id = (result.response->>'learningTrackId')::uuid
      and activity.custom_activity_id = (result.response->>'customActivityId')::uuid
      and activity.candidate_key = result.response->>'candidateKey'
      and activity.estimated_minutes = 45
      and activity.energy is null
      and activity.lifecycle = 'active'
      and activity.aggregate_version = 1
  ),
  1::bigint,
  'admission persists exact Planning-owned duration, Unknown energy, and attribution'
);

select is(
  (
    select track.aggregate_version
    from planning.learning_tracks as track
    join admission_results as result on result.result_name = 'alice-plan'
      and track.learning_track_id = (result.response->>'learningTrackId')::uuid
  ),
  2::bigint,
  'the first activity admission increments only the Track aggregate version'
);

select is(
  (
    select plan.aggregate_version
    from planning.growth_plans as plan
    join admission_results as result on result.result_name = 'alice-plan'
      and plan.growth_plan_id = (result.response->>'growthPlanId')::uuid
  ),
  1::bigint,
  'a Track-owned change does not fabricate a Growth Plan aggregate version'
);

select is(
  (
    select count(*)::bigint
    from planning.current_plan_snapshots as pointer
    join admission_results as result on result.result_name = 'alice-plan'
      and pointer.workspace_id = (result.response->>'workspaceId')::uuid
    where pointer.pointer_version = 0
      and pointer.snapshot_id is null
      and pointer.applied_attempt_id is null
  ),
  1::bigint,
  'input admission leaves the snapshot pointer byte-for-byte unchanged'
);

select is(
  (
    select count(*)::bigint
    from outbox.events as event
    join admission_results as result on result.result_name = 'alice-admit-first'
      and event.event_id = (result.response->'emittedEventIds'->>0)::uuid
    where event.event_name = 'planning.input_changed'
      and event.event_schema_version = 1
      and event.aggregate_type = 'planning.learning_track'
      and event.aggregate_id = (result.response->>'learningTrackId')::uuid
      and event.aggregate_version = 2
      and event.payload->>'change_kind' = 'TRACK_ACTIVITY_ADMITTED'
      and pg_catalog.jsonb_typeof(event.payload->'learning_track_version') = 'string'
      and event.payload ?& array[
        'change_kind', 'growth_plan_id', 'learning_track_id',
        'learning_track_version', 'custom_activity_id', 'candidate_key'
      ]
      and event.payload - array[
        'change_kind', 'growth_plan_id', 'learning_track_id',
        'learning_track_version', 'custom_activity_id', 'candidate_key'
      ] = '{}'::jsonb
  ),
  1::bigint,
  'admission emits one minimal Track-versioned Planning input event'
);

select is(
  (
    select count(*)::bigint
    from outbox.deliveries as delivery
    join admission_results as result on result.result_name = 'alice-admit-first'
      and delivery.delivery_id = (result.response->>'planningDeliveryId')::uuid
    where delivery.event_id = (result.response->'emittedEventIds'->>0)::uuid
      and delivery.consumer_name = 'planning.plan_snapshot_v1'
      and delivery.handler_contract_version = 1
      and delivery.delivery_state = 'pending'
  ),
  1::bigint,
  'admission creates one fixed durable Planning delivery'
);

-- Pausing the Plan and Track stops ranking sources but does not prohibit safe editing.
update planning.growth_plans
set lifecycle = 'paused'
where growth_plan_id = (
  select (response->>'growthPlanId')::uuid from admission_results where result_name = 'alice-plan'
);
update planning.learning_tracks
set lifecycle = 'paused'
where learning_track_id = (
  select (response->>'learningTrackId')::uuid from admission_results where result_name = 'alice-plan'
);

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '28000000-0000-4000-8000-000000000001',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text,
  true
);
set local role authenticated;
insert into admission_results values (
  'alice-admit-paused',
  api.add_learning_track_activity_v1(
    (select response->>'learningTrackKey' from admission_results
     where result_name = 'alice-plan'),
    'activity:admission-alice-second', 1, '2',
    'phase4a-admission-alice-paused', 'LOW'
  )
);
reset role;

select is(
  (
    select plan.lifecycle || ':' || track.lifecycle || ':' || track.aggregate_version::text
    from planning.growth_plans as plan
    join planning.learning_tracks as track
      on track.workspace_id = plan.workspace_id
     and track.growth_plan_id = plan.growth_plan_id
    where track.learning_track_id = (
      select (response->>'learningTrackId')::uuid
      from admission_results where result_name = 'alice-plan'
    )
  ),
  'paused:paused:3',
  'a paused Plan and Track accept editing without hidden resume'
);

update planning.growth_plans
set lifecycle = 'active'
where growth_plan_id = (
  select (response->>'growthPlanId')::uuid from admission_results where result_name = 'alice-plan'
);
update planning.learning_tracks
set lifecycle = 'active'
where learning_track_id = (
  select (response->>'learningTrackId')::uuid from admission_results where result_name = 'alice-plan'
);
update overlay.custom_activities
set lifecycle = 'paused'
where activity_key = 'activity:admission-alice-third';

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '28000000-0000-4000-8000-000000000001',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text,
  true
);
set local role authenticated;
select throws_ok(
  pg_catalog.format(
    'select api.add_learning_track_activity_v1(%L,%L,46,%L,%L,null)',
    (select response->>'learningTrackKey' from admission_results where result_name = 'alice-plan'),
    'activity:admission-alice-first', '1', 'phase4a-admission-alice-first'
  ),
  '22023',
  'idempotency key reused with a different request',
  'changed input cannot reuse an admission idempotency key'
);
select throws_ok(
  pg_catalog.format(
    'select api.add_learning_track_activity_v1(%L,%L,45,%L,%L,null)',
    (select response->>'learningTrackKey' from admission_results where result_name = 'alice-plan'),
    'activity:admission-alice-third', '2', 'phase4a-admission-stale'
  ),
  '40001',
  'Learning Track aggregate version conflict',
  'a stale expected Track version is rejected before admission'
);
select throws_ok(
  pg_catalog.format(
    'select api.add_learning_track_activity_v1(%L,%L,45,%L,%L,null)',
    (select response->>'learningTrackKey' from admission_results where result_name = 'alice-plan'),
    'activity:admission-alice-first', '3', 'phase4a-admission-duplicate'
  ),
  '23505',
  'activity already belongs to the current Growth Plan',
  'a different command key cannot duplicate plan attribution'
);
select throws_ok(
  pg_catalog.format(
    'select api.add_learning_track_activity_v1(%L,%L,45,%L,%L,null)',
    (select response->>'learningTrackKey' from admission_results where result_name = 'alice-plan'),
    'activity:admission-bob-first', '3', 'phase4a-admission-foreign'
  ),
  '42501',
  'active custom activity is not accessible',
  'a foreign activity fails closed without workspace disclosure'
);
select throws_ok(
  pg_catalog.format(
    'select api.add_learning_track_activity_v1(%L,%L,45,%L,%L,null)',
    (select response->>'learningTrackKey' from admission_results where result_name = 'alice-plan'),
    'activity:admission-alice-third', '3', 'phase4a-admission-inactive-activity'
  ),
  '42501',
  'active custom activity is not accessible',
  'a paused Overlay activity is not admissible'
);
select throws_ok(
  pg_catalog.format(
    'select api.add_learning_track_activity_v1(%L,%L,0,%L,%L,null)',
    (select response->>'learningTrackKey' from admission_results where result_name = 'alice-plan'),
    'activity:admission-alice-third', '3', 'phase4a-admission-zero-minutes'
  ),
  '22023',
  'estimated minutes must be between 1 and 480',
  'zero duration is rejected'
);
select throws_ok(
  pg_catalog.format(
    'select api.add_learning_track_activity_v1(%L,%L,481,%L,%L,null)',
    (select response->>'learningTrackKey' from admission_results where result_name = 'alice-plan'),
    'activity:admission-alice-third', '3', 'phase4a-admission-long'
  ),
  '22023',
  'estimated minutes must be between 1 and 480',
  'duration above the policy bound is rejected'
);
select throws_ok(
  pg_catalog.format(
    'select api.add_learning_track_activity_v1(%L,%L,45,%L,%L,%L)',
    (select response->>'learningTrackKey' from admission_results where result_name = 'alice-plan'),
    'activity:admission-alice-third', '3', 'phase4a-admission-energy', 'IMPOSSIBLE'
  ),
  '22023',
  'energy must be LOW, MEDIUM, HIGH, or null',
  'an unknown energy enum is rejected'
);
select throws_ok(
  pg_catalog.format(
    'select api.add_learning_track_activity_v1(%L,%L,45,%L,%L,null)',
    (select response->>'learningTrackKey' from admission_results where result_name = 'alice-plan'),
    'activity:admission-alice-third', '9223372036854775808', 'phase4a-admission-overflow'
  ),
  '22023',
  'expected Learning Track version is invalid',
  'an out-of-range bigint version fails with the public validation error'
);
reset role;

-- Terminal owner lifecycle checks are re-evaluated after the idempotency fence.
update targets.readiness_goals
set lifecycle = 'paused', aggregate_version = aggregate_version + 1,
    updated_at = clock_timestamp()
where readiness_goal_id = (
  select (response->>'readinessGoalId')::uuid from admission_results where result_name = 'alice-plan'
);
set local role authenticated;
select throws_ok(
  pg_catalog.format(
    'select api.add_learning_track_activity_v1(%L,%L,45,%L,%L,null)',
    (select response->>'learningTrackKey' from admission_results where result_name = 'alice-plan'),
    'activity:admission-alice-second', '3', 'phase4a-admission-inactive-goal'
  ),
  '42501',
  'active readiness goal is not accessible',
  'an inactive readiness goal blocks new Track input'
);
reset role;
update targets.readiness_goals
set lifecycle = 'active', aggregate_version = aggregate_version + 1,
    updated_at = clock_timestamp()
where readiness_goal_id = (
  select (response->>'readinessGoalId')::uuid from admission_results where result_name = 'alice-plan'
);

update planning.learning_tracks
set lifecycle = 'completed'
where learning_track_id = (
  select (response->>'learningTrackId')::uuid from admission_results where result_name = 'alice-plan'
);
set local role authenticated;
select throws_ok(
  pg_catalog.format(
    'select api.add_learning_track_activity_v1(%L,%L,45,%L,%L,null)',
    (select response->>'learningTrackKey' from admission_results where result_name = 'alice-plan'),
    'activity:admission-alice-second', '3', 'phase4a-admission-completed-track'
  ),
  '42501',
  'current Learning Track is not accessible',
  'a completed Track cannot acquire new input'
);
reset role;
update planning.learning_tracks
set lifecycle = 'active'
where learning_track_id = (
  select (response->>'learningTrackId')::uuid from admission_results where result_name = 'alice-plan'
);

update planning.growth_plans
set lifecycle = 'archived'
where growth_plan_id = (
  select (response->>'growthPlanId')::uuid from admission_results where result_name = 'alice-plan'
);
set local role authenticated;
select throws_ok(
  pg_catalog.format(
    'select api.add_learning_track_activity_v1(%L,%L,45,%L,%L,null)',
    (select response->>'learningTrackKey' from admission_results where result_name = 'alice-plan'),
    'activity:admission-alice-second', '3', 'phase4a-admission-archived-plan'
  ),
  '42501',
  'current Learning Track is not accessible',
  'an archived Growth Plan cannot acquire new Track input'
);
reset role;
update planning.growth_plans
set lifecycle = 'active'
where growth_plan_id = (
  select (response->>'growthPlanId')::uuid from admission_results where result_name = 'alice-plan'
);

-- A same-workspace activity from a different exact Target profile still fails closed.
insert into targets.target_profile_series (
  profile_series_id, profile_series_key, profile_scope, workspace_id, lifecycle
) values (
  '28000000-0000-4000-8000-000000000300',
  'target-series:admission-wrong-profile', 'workspace',
  (select (response->>'workspaceId')::uuid from admission_results where result_name = 'alice-plan'),
  'active'
);

insert into targets.target_profile_versions (
  profile_version_id, profile_version_key, profile_series_id, workspace_id,
  base_profile_version_id, catalog_version_id, roadmap_version_id, version_number,
  lifecycle, role_title, company_name, source_summary, freshness_status,
  reviewed_at, root_rule_key, readiness_threshold, published_at
)
select
  '28000000-0000-4000-8000-000000000301',
  'target:admission-wrong-profile-v9002',
  '28000000-0000-4000-8000-000000000300',
  (select (response->>'workspaceId')::uuid from admission_results where result_name = 'alice-plan'),
  profile_version_id, catalog_version_id, roadmap_version_id, 9002,
  'published', role_title, company_name, 'Wrong-profile admission test fixture.',
  freshness_status, reviewed_at, root_rule_key, readiness_threshold, clock_timestamp()
from targets.target_profile_versions
where profile_version_key = 'target:nvidia-python-verification-base-v1';

insert into overlay.custom_activities (
  custom_activity_id, workspace_id, profile_version_id, activity_key, title,
  activity_type, target_competency_ref
) values (
  '28000000-0000-4000-8000-000000000302',
  (select (response->>'workspaceId')::uuid from admission_results where result_name = 'alice-plan'),
  '28000000-0000-4000-8000-000000000301',
  'activity:admission-wrong-profile', 'Wrong profile activity',
  'PROJECT', 'competency:python-error-handling'
);

set local role authenticated;
select throws_ok(
  pg_catalog.format(
    'select api.add_learning_track_activity_v1(%L,%L,45,%L,%L,null)',
    (select response->>'learningTrackKey' from admission_results where result_name = 'alice-plan'),
    'activity:admission-wrong-profile', '3', 'phase4a-admission-wrong-profile'
  ),
  '42501',
  'active custom activity is not accessible',
  'same-workspace activity from another exact Target profile is rejected'
);
reset role;
select is(
  (
    select count(*)::bigint
    from outbox.command_receipts
    where idempotency_key = 'phase4a-admission-wrong-profile'
  ),
  0::bigint,
  'wrong-profile rejection leaves no command receipt'
);
select is(
  (
    select count(*)::bigint
    from planning.learning_track_activities
    where custom_activity_id = '28000000-0000-4000-8000-000000000302'
  ),
  0::bigint,
  'wrong-profile rejection leaves no Track attribution'
);
select is(
  (
    select aggregate_version
    from planning.learning_tracks
    where learning_track_id = (
      select (response->>'learningTrackId')::uuid
      from admission_results
      where result_name = 'alice-plan'
    )
  ),
  3::bigint,
  'wrong-profile rejection leaves the Track version unchanged'
);

-- A direct cross-workspace write is still rejected after granting INSERT to Planning.
insert into overlay.custom_activities (
  custom_activity_id, workspace_id, profile_version_id, activity_key, title,
  activity_type, target_competency_ref
) values (
  '28000000-0000-4000-8000-000000000201',
  (select (response->>'workspaceId')::uuid from admission_results where result_name = 'bob-plan'),
  (select (response->>'profileVersionId')::uuid from admission_results where result_name = 'bob-plan'),
  'activity:admission-bob-spare', 'Bob spare activity',
  'PROJECT', 'competency:python-error-handling'
);

do $planning_test_role$
begin
  execute pg_catalog.format('grant pando_planning_api to %I with set true', current_user);
end
$planning_test_role$;
set local role pando_planning_api;
select is(
  (select count(*)::bigint from planning.learning_track_activities),
  2::bigint,
  'Planning RLS exposes Alice attributions and hides Bob attribution'
);
select throws_like(
  pg_catalog.format(
    'insert into planning.learning_track_activities (
       workspace_id, growth_plan_id, learning_track_id, custom_activity_id,
       candidate_key, estimated_minutes
     ) values (%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L,30)',
    (select response->>'workspaceId' from admission_results where result_name = 'bob-plan'),
    (select response->>'growthPlanId' from admission_results where result_name = 'bob-plan'),
    (select response->>'learningTrackId' from admission_results where result_name = 'bob-plan'),
    '28000000-0000-4000-8000-000000000201',
    'candidate:admission-forbidden-bob'
  ),
  '%row-level security policy for table "learning_track_activities"%',
  'Planning INSERT RLS rejects an Alice write into Bob workspace'
);
with changed as (
  update planning.learning_tracks
  set aggregate_version = 999,
      updated_at = clock_timestamp()
  where learning_track_id = (
    select (response->>'learningTrackId')::uuid
    from admission_results
    where result_name = 'bob-plan'
  )
  returning 1
)
select is(
  (select count(*)::bigint from changed),
  0::bigint,
  'Planning UPDATE RLS hides Bob Track from an Alice-scoped Planning command role'
);
reset role;
do $planning_test_role$
begin
  execute pg_catalog.format('revoke pando_planning_api from %I', current_user);
end
$planning_test_role$;
select is(
  (
    select aggregate_version
    from planning.learning_tracks
    where learning_track_id = (
      select (response->>'learningTrackId')::uuid
      from admission_results
      where result_name = 'bob-plan'
    )
  ),
  2::bigint,
  'a rejected cross-workspace UPDATE leaves Bob Track version unchanged'
);

-- Injected outbox failure must roll back receipt, attribution, and Track version together.
insert into overlay.custom_activities (
  custom_activity_id, workspace_id, profile_version_id, activity_key, title,
  activity_type, target_competency_ref
) values (
  '28000000-0000-4000-8000-000000000202',
  (select (response->>'workspaceId')::uuid from admission_results where result_name = 'alice-plan'),
  (select (response->>'profileVersionId')::uuid from admission_results where result_name = 'alice-plan'),
  'activity:admission-rollback', 'Rollback activity',
  'PROJECT', 'competency:python-error-handling'
);

create temporary table admission_rollback_counts as
select
  (
    select count(*)::bigint
    from outbox.events
    where aggregate_type = 'planning.learning_track'
      and aggregate_id = (
        select (response->>'learningTrackId')::uuid
        from admission_results
        where result_name = 'alice-plan'
      )
  ) as event_count,
  (
    select count(*)::bigint
    from outbox.deliveries as delivery
    join outbox.events as event on event.event_id = delivery.event_id
    where event.aggregate_type = 'planning.learning_track'
      and event.aggregate_id = (
        select (response->>'learningTrackId')::uuid
        from admission_results
        where result_name = 'alice-plan'
      )
      and delivery.consumer_name = 'planning.plan_snapshot_v1'
  ) as delivery_count;

create function public.fail_admission_event_for_test()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.event_name = 'planning.input_changed'
     and new.aggregate_type = 'planning.learning_track'
     and new.workspace_id::text = pg_catalog.current_setting(
       'pando.test.fail_admission_workspace', true
     ) then
    raise exception using errcode = 'P0001', message = 'injected admission outbox failure';
  end if;
  return new;
end
$function$;
create trigger fail_admission_event_for_test
before insert on outbox.events
for each row execute function public.fail_admission_event_for_test();
select set_config(
  'pando.test.fail_admission_workspace',
  (select response->>'workspaceId' from admission_results where result_name = 'alice-plan'),
  true
);
set local role authenticated;
select throws_ok(
  pg_catalog.format(
    'select api.add_learning_track_activity_v1(%L,%L,45,%L,%L,%L)',
    (select response->>'learningTrackKey' from admission_results where result_name = 'alice-plan'),
    'activity:admission-rollback', '3', 'phase4a-admission-rollback', 'MEDIUM'
  ),
  'P0001',
  'injected admission outbox failure',
  'an outbox failure aborts the entire admission command'
);
reset role;
drop trigger fail_admission_event_for_test on outbox.events;
drop function public.fail_admission_event_for_test();

select is(
  (
    select count(*)::bigint
    from outbox.events
    where aggregate_type = 'planning.learning_track'
      and aggregate_id = (
        select (response->>'learningTrackId')::uuid
        from admission_results
        where result_name = 'alice-plan'
      )
  ),
  (select event_count from admission_rollback_counts),
  'outbox rollback leaves no Planning input event for the failed command'
);
select is(
  (
    select count(*)::bigint
    from outbox.deliveries as delivery
    join outbox.events as event on event.event_id = delivery.event_id
    where event.aggregate_type = 'planning.learning_track'
      and event.aggregate_id = (
        select (response->>'learningTrackId')::uuid
        from admission_results
        where result_name = 'alice-plan'
      )
      and delivery.consumer_name = 'planning.plan_snapshot_v1'
  ),
  (select delivery_count from admission_rollback_counts),
  'outbox rollback leaves no fixed Planning delivery for the failed command'
);

select is(
  (
    select aggregate_version from planning.learning_tracks
    where learning_track_id = (
      select (response->>'learningTrackId')::uuid
      from admission_results where result_name = 'alice-plan'
    )
  ),
  3::bigint,
  'outbox rollback restores the prior Track version'
);
select is(
  (
    select count(*)::bigint from planning.learning_track_activities
    where custom_activity_id = '28000000-0000-4000-8000-000000000202'
  ),
  0::bigint,
  'outbox rollback leaves no activity attribution'
);
select is(
  (
    select count(*)::bigint from outbox.command_receipts
    where idempotency_key = 'phase4a-admission-rollback'
  ),
  0::bigint,
  'outbox rollback leaves no command receipt'
);
select is(
  (
    select pointer_version from planning.current_plan_snapshots
    where workspace_id = (
      select (response->>'workspaceId')::uuid
      from admission_results where result_name = 'alice-plan'
    )
  ),
  0::bigint,
  'failed admission also leaves the snapshot pointer unchanged'
);

select is(
  (
    select count(*)::bigint
    from outbox.command_receipts
    where idempotency_key in (
      'phase4a-admission-stale', 'phase4a-admission-duplicate',
      'phase4a-admission-foreign', 'phase4a-admission-inactive-activity',
      'phase4a-admission-zero-minutes', 'phase4a-admission-long',
      'phase4a-admission-energy', 'phase4a-admission-overflow',
      'phase4a-admission-inactive-goal', 'phase4a-admission-completed-track',
      'phase4a-admission-archived-plan', 'phase4a-admission-rollback'
    )
  ),
  0::bigint,
  'all rejected first attempts leave no command receipts'
);

-- The command enforces the worker's hard 200-candidate input bound without truncation.
create temporary table admission_limit_rows as
select sequence_number,
  gen_random_uuid() as custom_activity_id
from generate_series(1, 198) as sequence_number;

insert into overlay.custom_activities (
  custom_activity_id, workspace_id, profile_version_id, activity_key, title,
  activity_type, target_competency_ref
)
select fixture.custom_activity_id,
  (select (response->>'workspaceId')::uuid from admission_results where result_name = 'alice-plan'),
  (select (response->>'profileVersionId')::uuid from admission_results where result_name = 'alice-plan'),
  'activity:admission-limit-' || fixture.sequence_number::text,
  'Admission limit ' || fixture.sequence_number::text,
  'PROJECT', 'competency:python-error-handling'
from admission_limit_rows as fixture;

insert into planning.learning_track_activities (
  workspace_id, growth_plan_id, learning_track_id, custom_activity_id,
  candidate_key, estimated_minutes
)
select
  (select (response->>'workspaceId')::uuid from admission_results where result_name = 'alice-plan'),
  (select (response->>'growthPlanId')::uuid from admission_results where result_name = 'alice-plan'),
  (select (response->>'learningTrackId')::uuid from admission_results where result_name = 'alice-plan'),
  fixture.custom_activity_id,
  'candidate:admission-limit-' || fixture.sequence_number::text,
  30
from admission_limit_rows as fixture;

insert into overlay.custom_activities (
  custom_activity_id, workspace_id, profile_version_id, activity_key, title,
  activity_type, target_competency_ref
) values (
  '28000000-0000-4000-8000-000000000203',
  (select (response->>'workspaceId')::uuid from admission_results where result_name = 'alice-plan'),
  (select (response->>'profileVersionId')::uuid from admission_results where result_name = 'alice-plan'),
  'activity:admission-over-limit', 'Admission over limit',
  'PROJECT', 'competency:python-error-handling'
);

set local role authenticated;
select throws_ok(
  pg_catalog.format(
    'select api.add_learning_track_activity_v1(%L,%L,45,%L,%L,null)',
    (select response->>'learningTrackKey' from admission_results where result_name = 'alice-plan'),
    'activity:admission-over-limit', '3', 'phase4a-admission-over-limit'
  ),
  '22023',
  'current Growth Plan activity limit is 200',
  'the 201st non-archived candidate is rejected rather than truncated'
);
reset role;

select is(
  (
    select count(*)::bigint from planning.learning_track_activities
    where workspace_id = (
      select (response->>'workspaceId')::uuid
      from admission_results where result_name = 'alice-plan'
    )
      and lifecycle <> 'archived'
  ),
  200::bigint,
  'the rejected boundary command leaves the exact 200-candidate maximum intact'
);
select is(
  (
    select count(*)::bigint from outbox.command_receipts
    where idempotency_key = 'phase4a-admission-over-limit'
  ),
  0::bigint,
  'the over-limit rejection leaves no receipt'
);

select * from finish();
rollback;
