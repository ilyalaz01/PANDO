begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

create function pg_temp.initialize_growth_plan_fixture_v1(
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
  v_preview jsonb;
begin
  v_preview := api.preview_growth_plan_initialization_v1(
    p_readiness_goal_key,
    '1',
    p_weekly_capacity_minutes,
    p_default_session_minutes,
    p_track_priority,
    'Initialize fixture growth plan.',
    p_idempotency_key
  );
  return api.apply_growth_plan_initialization_v1(
    p_readiness_goal_key,
    v_preview->>'expectedReadinessGoalVersion',
    p_weekly_capacity_minutes,
    p_default_session_minutes,
    p_track_priority,
    'Initialize fixture growth plan.',
    p_idempotency_key,
    v_preview->>'previewDigest'
  );
end
$function$;
revoke all on function pg_temp.initialize_growth_plan_fixture_v1(
  text, integer, integer, integer, integer, text
) from public, anon, authenticated, service_role;
grant execute on function pg_temp.initialize_growth_plan_fixture_v1(
  text, integer, integer, integer, integer, text
) to authenticated;

create function pg_temp.create_learning_track_fixture_v1(
  p_readiness_goal_key text,
  p_expected_readiness_goal_version text,
  p_title text,
  p_priority integer,
  p_default_session_minutes integer,
  p_expected_growth_plan_version text,
  p_reason text,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_preview jsonb;
begin
  v_preview := api.preview_learning_track_creation_v1(
    p_readiness_goal_key,
    p_expected_readiness_goal_version,
    p_title,
    p_priority,
    p_default_session_minutes,
    p_expected_growth_plan_version,
    p_reason,
    p_request_id
  );
  return api.apply_learning_track_creation_v1(
    p_readiness_goal_key,
    p_expected_readiness_goal_version,
    p_title,
    p_priority,
    p_default_session_minutes,
    p_expected_growth_plan_version,
    p_reason,
    p_request_id,
    v_preview->>'previewDigest'
  );
end
$function$;
revoke all on function pg_temp.create_learning_track_fixture_v1(
  text, text, text, integer, integer, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function pg_temp.create_learning_track_fixture_v1(
  text, text, text, integer, integer, text, text, text
) to authenticated;

select no_plan();

select ok(
  pg_catalog.has_function_privilege(
    'authenticated', 'api.get_learning_track_creation_source_v1()', 'EXECUTE'
  ) and pg_catalog.has_function_privilege(
    'authenticated',
    'api.preview_learning_track_creation_v1(text,text,text,integer,integer,text,text,text)',
    'EXECUTE'
  ) and pg_catalog.has_function_privilege(
    'authenticated',
    'api.apply_learning_track_creation_v1(text,text,text,integer,integer,text,text,text,text)',
    'EXECUTE'
  ),
  'authenticated has exactly the three public Learning Track creation entry points'
);

select ok(
  not pg_catalog.has_function_privilege(runtime.role_name, expected.signature, 'EXECUTE'),
  format('%s cannot execute %s', runtime.role_name, expected.signature)
)
from (values ('anon'), ('service_role')) as runtime(role_name)
cross join (values
  ('api.get_learning_track_creation_source_v1()'),
  ('api.preview_learning_track_creation_v1(text,text,text,integer,integer,text,text,text)'),
  ('api.apply_learning_track_creation_v1(text,text,text,integer,integer,text,text,text,text)')
) as expected(signature);

select ok(
  not pg_catalog.has_function_privilege(runtime.role_name, expected.signature, 'EXECUTE'),
  format('%s cannot execute private D2b3 helper %s', runtime.role_name, expected.signature)
)
from (values ('anon'), ('authenticated'), ('service_role')) as runtime(role_name)
cross join (values
  ('planning.current_track_order_fingerprint_v1(uuid,uuid)'),
  ('planning.projected_learning_track_creation_order_v1(uuid,uuid,uuid,text,integer,bigint)'),
  ('planning.derive_learning_track_creation_identity_v1(uuid,text)'),
  ('planning.build_learning_track_creation_preview_v1(uuid,uuid,text,text,integer,bigint,jsonb,bigint,bigint,text,integer,integer,text,uuid)'),
  ('planning.track_created_event_payload_v1_is_valid(jsonb)')
) as expected(signature);

select ok(
  procedure.prosecdef
    and 'search_path=""' = any(coalesce(procedure.proconfig, '{}'::text[]))
    and owner.rolname = 'pando_planning_api',
  format('%s is a pinned Planning owner definer', procedure.proname)
)
from pg_catalog.pg_proc as procedure
join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
join pg_catalog.pg_roles as owner on owner.oid = procedure.proowner
where namespace.nspname in ('planning', 'api')
  and procedure.proname in (
    'current_track_order_fingerprint_v1',
    'projected_learning_track_creation_order_v1',
    'build_learning_track_creation_preview_v1',
    'get_learning_track_creation_source_v1',
    'preview_learning_track_creation_v1',
    'apply_learning_track_creation_v1'
  )
order by procedure.proname;

select ok(
  not procedure.prosecdef
    and 'search_path=""' = any(coalesce(procedure.proconfig, '{}'::text[]))
    and owner.rolname = 'pando_planning_api',
  format('%s is a pinned pure Planning helper', procedure.proname)
)
from pg_catalog.pg_proc as procedure
join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
join pg_catalog.pg_roles as owner on owner.oid = procedure.proowner
where namespace.nspname = 'planning'
  and procedure.proname in (
    'derive_learning_track_creation_identity_v1',
    'track_created_event_payload_v1_is_valid'
  )
order by procedure.proname;

select ok(
  pg_catalog.has_function_privilege(
    'pando_planning_api', 'targets.get_first_growth_plan_setup_choices_v1(uuid)', 'EXECUTE'
  ) and pg_catalog.has_function_privilege(
    'pando_planning_api',
    'targets.resolve_first_growth_plan_setup_source_v1(uuid,text)',
    'EXECUTE'
  ) and not pg_catalog.has_table_privilege(
    'pando_planning_api', 'targets.readiness_goals', 'SELECT'
  ) and not pg_catalog.has_table_privilege(
    'pando_planning_api', 'targets.target_profile_versions', 'SELECT'
  ),
  'Planning reuses the D1b Targets owner boundary without direct Targets table grants'
);

with oracle(names, values) as (values (
  array[
    'digestVersion','contractVersion','identityVersion','workspaceId','operation',
    'commandType','requestId','reason','expectedGrowthPlanVersion',
    'expectedReadinessGoalVersion','growthPlanTitle','growthPlanLifecycle',
    'growthPlanWeeklyCapacityMinutes','growthPlanAggregateVersion',
    'readinessGoalId','readinessGoalKey','readinessGoalTitle','readinessGoalLifecycle',
    'readinessGoalVersion','profileVersionId','profileVersionKey','sourceKind','sourceRef',
    'roadmapVersionId','sourceOwnerRevision','currentTrackCountBefore',
    'currentTrackCountAfter','currentTrackLimit','activeProtectedMinimumMinutesBefore',
    'activeProtectedMinimumMinutesAfter','flexibleMinutesBefore','flexibleMinutesAfter',
    'currentTrackOrderFingerprintBefore','currentTrackOrderFingerprintAfter','newTrackPosition',
    'learningTrackId','trackKey','learningTrackTitle','learningTrackLifecycle',
    'learningTrackPriority','learningTrackProtectedMinimumMinutes',
    'learningTrackDefaultSessionMinutes','learningTrackAggregateVersion','canApply',
    'blockingReasonCode','warningCount','warningCode','warningCode',
    'retainedPlanHistory','retainedTrackHistory','retainedActivitiesAndEvidence',
    'retainedMasteryAndReadiness','retainedReviewQueue','retainedPlanSnapshots',
    'projectionStateAfterApply','eventChangeKind','consumerName'
  ]::text[],
  array[
    'learning-track-creation-preview-digest/1.0.0','1.0.0','planning-create-identity/1.0.0',
    'a0000000-0000-4000-8000-000000000001','create_learning_track',
    'planning.create_learning_track_v1','b0000000-0000-4000-8000-000000000001',
    'Split algorithms — 学習','4','7','Backend readiness','PAUSED','600','4',
    'c0000000-0000-4000-8000-000000000001','goal:backend-readiness','Backend readiness',
    'ACTIVE','7','d0000000-0000-4000-8000-000000000001','target:backend-engineer-v1',
    'ROADMAP_TEMPLATE_VERSION','e0000000-0000-4000-8000-000000000001',
    'e0000000-0000-4000-8000-000000000001','readiness-goal:7',
    '2','3','30','180','180','420','420',
    repeat('a',64),repeat('b',64),'2',
    '10000000-0000-8000-8000-000000000001',
    'track:10000000-0000-8000-8000-000000000001',
    'Algorithms sprint','ACTIVE','80','0','45','1','true','','2',
    'PARENT_GROWTH_PLAN_PAUSED','TRACK_STARTS_EMPTY',
    'true','true','true','true','true','true',
    'PENDING','TRACK_CREATED','planning.plan_snapshot_v1'
  ]::text[]
)), framed(value) as (
  select coalesce(pg_catalog.string_agg(
    names[position] || ':'
      || pg_catalog.octet_length(
        pg_catalog.convert_to(coalesce(values[position], ''), 'UTF8')
      )::text
      || ':' || coalesce(values[position], '') || pg_catalog.chr(10),
    '' order by position
  ), '')
  from oracle,
    lateral pg_catalog.generate_subscripts(names, 1) as position
)
select is(
  pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(value, 'UTF8'), 'sha256'), 'hex'
  ),
  '238fb7ac4672c149f6242471ba182eda7d54cda12a83b466c45532911ca05e32',
  'SQL matches the fixed TypeScript Unicode preview digest oracle'
)
from framed;

with oracle(names, values) as (values (
  array[
    'requestHashVersion','schemaVersion','identityVersion','workspaceId','commandType',
    'operation','requestId','readinessGoalKey','expectedReadinessGoalVersion',
    'title','priority','defaultSessionMinutes','expectedGrowthPlanVersion',
    'reason','previewDigest','learningTrackId','trackKey'
  ]::text[],
  array[
    'learning-track-creation-request-hash/1.0.0','1.0.0','planning-create-identity/1.0.0',
    'a0000000-0000-4000-8000-000000000001','planning.create_learning_track_v1',
    'create_learning_track','b0000000-0000-4000-8000-000000000001',
    'goal:backend-readiness','7','Algorithms sprint','80','45','4',
    'Split algorithms — 学習',repeat('a',64),
    '10000000-0000-8000-8000-000000000001',
    'track:10000000-0000-8000-8000-000000000001'
  ]::text[]
)), framed(value) as (
  select coalesce(pg_catalog.string_agg(
    names[position] || ':'
      || pg_catalog.octet_length(
        pg_catalog.convert_to(coalesce(values[position], ''), 'UTF8')
      )::text
      || ':' || coalesce(values[position], '') || pg_catalog.chr(10),
    '' order by position
  ), '')
  from oracle,
    lateral pg_catalog.generate_subscripts(names, 1) as position
)
select is(
  pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(value, 'UTF8'), 'sha256'), 'hex'
  ),
  'feadc93cae331158808fd6c017ade4aa56073431c7e552fbec9009167e9a8ae2',
  'SQL matches the fixed TypeScript Unicode request-hash oracle'
)
from framed;

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '38000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'track-creation@pando.test', '', pg_catalog.clock_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
);

create temporary table track_creation_results(name text primary key, response jsonb not null);
grant select, insert, update on track_creation_results to authenticated;
grant select on track_creation_results to pando_planning_api;

select set_config('request.jwt.claims', pg_catalog.jsonb_build_object(
  'sub', '38000000-0000-4000-8000-000000000001', 'role', 'authenticated',
  'aud', 'authenticated', 'exp', extract(epoch from pg_catalog.clock_timestamp() + interval '1 hour')::bigint
)::text, true);
set local role authenticated;

insert into track_creation_results values (
  'bootstrap', api.bootstrap_personal_workspace('track-creation', 'Track Creation')
);

insert into track_creation_results values (
  'no-plan-source', api.get_learning_track_creation_source_v1()
);
select is(
  (select response->>'state' from track_creation_results where name = 'no-plan-source'),
  'NO_CURRENT_PLAN',
  'source reports NO_CURRENT_PLAN before setup'
);
select ok(
  (select response->'growthPlan' from track_creation_results where name = 'no-plan-source') = 'null'::jsonb
  and (select response->'trackPortfolio' from track_creation_results where name = 'no-plan-source') = 'null'::jsonb,
  'no-plan source omits Plan and Track portfolio details'
);

insert into track_creation_results
select 'goal-main', api.create_readiness_goal(
  (select (response->>'workspace_id')::uuid from track_creation_results where name = 'bootstrap'),
  'goal:track-main', 'Track main goal',
  'target:nvidia-python-verification-base-v1', 'track-main-goal'
);
insert into track_creation_results values (
  'plan', pg_temp.initialize_growth_plan_fixture_v1(
    'goal:track-main', 600, 45, 80, 120, '13000000-0000-4000-8000-000000000001'
  )
);

insert into track_creation_results values (
  'ready-source', api.get_learning_track_creation_source_v1()
);
select is(
  (select response#>>'{contract,name}' from track_creation_results where name = 'ready-source'),
  'LearningTrackCreationSourceV1',
  'source uses the strict versioned contract'
);
select is(
  (select response->>'state' from track_creation_results where name = 'ready-source'),
  'READY',
  'one current Plan with one active Goal below the Track limit is ready'
);
select ok(
  not exists (
    select 1
    from track_creation_results,
      lateral pg_catalog.jsonb_array_elements(response->'goals') as goal,
      lateral pg_catalog.jsonb_object_keys(goal) as key
    where name = 'ready-source'
      and key in ('readinessGoalId','profileVersionId','roadmapVersionId','sourceRef')
  ),
  'public source goal choices expose no authority UUIDs'
);

insert into track_creation_results values (
  'same-goal-preview',
  api.preview_learning_track_creation_v1(
    'goal:track-main',
    (select response#>>'{goals,0,aggregateVersion}' from track_creation_results where name = 'ready-source'),
    'Algorithms sprint',
    80,
    45,
    (select response#>>'{growthPlan,aggregateVersion}' from track_creation_results where name = 'ready-source'),
    'Split algorithms — 学習',
    '10000000-0000-4000-8000-000000000001'
  )
);
select is(
  (select response#>>'{contract,name}' from track_creation_results where name = 'same-goal-preview'),
  'LearningTrackCreationPreviewV1',
  'preview uses the strict versioned contract'
);
select ok(
  (select response#>>'{source,readinessGoalKey}' from track_creation_results where name = 'same-goal-preview') = 'goal:track-main'
  and (select response#>>'{learningTrack,title}' from track_creation_results where name = 'same-goal-preview') = 'Algorithms sprint'
  and (select response#>>'{constraint,currentTrackCountBefore}' from track_creation_results where name = 'same-goal-preview') = '1'
  and (select response#>>'{constraint,currentTrackCountAfter}' from track_creation_results where name = 'same-goal-preview') = '2'
  and (select response#>>'{constraint,activeProtectedMinimumMinutesBefore}' from track_creation_results where name = 'same-goal-preview')
    = (select response#>>'{constraint,activeProtectedMinimumMinutesAfter}' from track_creation_results where name = 'same-goal-preview')
  and (select response#>>'{constraint,currentTrackOrderFingerprintBefore}' from track_creation_results where name = 'same-goal-preview')
    <> (select response#>>'{constraint,currentTrackOrderFingerprintAfter}' from track_creation_results where name = 'same-goal-preview'),
  'preview binds exact source, count delta, unchanged capacity totals, and changed order fingerprint'
);

insert into track_creation_results values (
  'same-goal-title-variant',
  api.preview_learning_track_creation_v1(
    'goal:track-main',
    (select response#>>'{expectedReadinessGoalVersion}' from track_creation_results where name = 'same-goal-preview'),
    'Algorithms sprint changed', 80, 45,
    (select response#>>'{expectedGrowthPlanVersion}' from track_creation_results where name = 'same-goal-preview'),
    'Split algorithms — 学習', '10000000-0000-4000-8000-000000000003'
  )
);
select ok(
  (select response->>'previewDigest' from track_creation_results where name = 'same-goal-title-variant')
    <> (select response->>'previewDigest' from track_creation_results where name = 'same-goal-preview'),
  'creation preview digest is sensitive to the user-supplied Track title'
);

insert into track_creation_results values (
  'same-goal-apply',
  api.apply_learning_track_creation_v1(
    'goal:track-main',
    (select response#>>'{expectedReadinessGoalVersion}' from track_creation_results where name = 'same-goal-preview'),
    'Algorithms sprint',
    80,
    45,
    (select response#>>'{expectedGrowthPlanVersion}' from track_creation_results where name = 'same-goal-preview'),
    'Split algorithms — 学習',
    '10000000-0000-4000-8000-000000000001',
    (select response->>'previewDigest' from track_creation_results where name = 'same-goal-preview')
  )
);
reset role;
select ok(
  (select response#>>'{createdTrack,title}' from track_creation_results where name = 'same-goal-apply') = 'Algorithms sprint'
  and exists (
    select 1
    from planning.learning_tracks as track
    where track.workspace_id = (select (response->>'workspace_id')::uuid from track_creation_results where name = 'bootstrap')
      and track.title = 'Algorithms sprint'
      and track.lifecycle = 'active'
      and track.protected_minimum_minutes = 0
      and track.aggregate_version = 1
      and track.readiness_goal_id = (
        select readiness_goal_id
        from targets.readiness_goals
        where workspace_id = (select (response->>'workspace_id')::uuid from track_creation_results where name = 'bootstrap')
          and readiness_goal_key = 'goal:track-main'
      )
  ),
  'apply creates one active zero-minimum version-1 Track against the selected Goal'
);
select ok(
  (select aggregate_version::text
   from planning.growth_plans
   where workspace_id = (select (response->>'workspace_id')::uuid from track_creation_results where name = 'bootstrap'))
    = (select response#>>'{growthPlan,aggregateVersion}' from track_creation_results where name = 'same-goal-preview')
  and 1 = (
    select count(*)
    from outbox.command_receipts
    where command_type = 'planning.create_learning_track_v1'
      and workspace_id = (select (response->>'workspace_id')::uuid from track_creation_results where name = 'bootstrap')
      and idempotency_key = '10000000-0000-4000-8000-000000000001'
  )
  and 1 = (
    select count(*)
    from outbox.events
    where workspace_id = (select (response->>'workspace_id')::uuid from track_creation_results where name = 'bootstrap')
      and payload->>'change_kind' = 'TRACK_CREATED'
  )
  and 1 = (
    select count(*)
    from outbox.deliveries as delivery
    join outbox.events as event on event.event_id = delivery.event_id
    where event.workspace_id = (select (response->>'workspace_id')::uuid from track_creation_results where name = 'bootstrap')
      and event.payload->>'change_kind' = 'TRACK_CREATED'
      and delivery.consumer_name = 'planning.plan_snapshot_v1'
  ),
  'apply leaves the Plan unchanged and writes one receipt, event, and fixed delivery'
);
select ok(
  (
    select pg_catalog.jsonb_typeof(event.payload) = 'object'
      and (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(event.payload)) = 6
      and event.payload->>'change_kind' = 'TRACK_CREATED'
      and event.payload->>'growth_plan_id' is not null
      and event.payload->>'learning_track_id'
        = (select response#>>'{createdTrack,learningTrackId}' from track_creation_results where name = 'same-goal-apply')
      and event.payload->>'learning_track_version' = '1'
      and event.payload->>'readiness_goal_id' is not null
      and event.payload->>'profile_version_id' is not null
    from outbox.events as event
    where event.workspace_id = (select (response->>'workspace_id')::uuid from track_creation_results where name = 'bootstrap')
      and event.payload->>'change_kind' = 'TRACK_CREATED'
      and event.payload->>'learning_track_id'
        = (select response#>>'{createdTrack,learningTrackId}' from track_creation_results where name = 'same-goal-apply')
  ),
  'apply emits the exact minimal TRACK_CREATED payload shape'
);
set local role authenticated;

insert into track_creation_results
select 'same-goal-replay', api.apply_learning_track_creation_v1(
  'goal:track-main',
  (select response#>>'{expectedReadinessGoalVersion}' from track_creation_results where name = 'same-goal-preview'),
  'Algorithms sprint',
  80,
  45,
  (select response#>>'{expectedGrowthPlanVersion}' from track_creation_results where name = 'same-goal-preview'),
  'Split algorithms — 学習',
  '10000000-0000-4000-8000-000000000001',
  (select response->>'previewDigest' from track_creation_results where name = 'same-goal-preview')
);
select is(
  (select response from track_creation_results where name = 'same-goal-replay'),
  (select response from track_creation_results where name = 'same-goal-apply'),
  'same request UUID replays the stored completion byte-for-byte'
);

select throws_ok(
  $query$
    select api.apply_learning_track_creation_v1(
      'goal:track-main','1','Algorithms changed',80,45,'1',
      'Changed request','10000000-0000-4000-8000-000000000001',
      repeat('a', 64)
    )
  $query$,
  '22023', 'idempotency key reused with a different request',
  'same request UUID with a changed request conflicts'
);

reset role;
insert into targets.target_profile_series (
  profile_series_key, profile_scope, workspace_id, lifecycle
)
values (
  'target-series:track-second-private', 'workspace',
  (select (response->>'workspace_id')::uuid from track_creation_results where name = 'bootstrap'),
  'active'
);
insert into targets.target_profile_versions (
  profile_version_key, profile_series_id, workspace_id, base_profile_version_id,
  catalog_version_id, roadmap_version_id, version_number, lifecycle, role_title,
  company_name, source_summary, freshness_status, reviewed_at, root_rule_key,
  readiness_threshold, published_at
)
select
  'target:track-second-private-v1', series.profile_series_id, series.workspace_id,
  base.profile_version_id, base.catalog_version_id, base.roadmap_version_id, 1,
  'published', 'Private second Track profile', null,
  'Workspace-scoped profile for D2b3 mixed-profile proof.', 'reviewed', current_date,
  base.root_rule_key, base.readiness_threshold, pg_catalog.clock_timestamp()
from targets.target_profile_series as series
cross join targets.target_profile_versions as base
where series.profile_series_key = 'target-series:track-second-private'
  and base.profile_version_key = 'target:nvidia-python-verification-base-v1';
set local role authenticated;
insert into track_creation_results
select 'goal-second', api.create_readiness_goal(
  (select (response->>'workspace_id')::uuid from track_creation_results where name = 'bootstrap'),
  'goal:track-second', 'Track second goal',
  'target:track-second-private-v1', 'track-second-goal'
);
insert into track_creation_results values (
  'second-source', api.get_learning_track_creation_source_v1()
);
insert into track_creation_results values (
  'different-goal-apply',
  pg_temp.create_learning_track_fixture_v1(
    'goal:track-second',
    (
      select goal->>'aggregateVersion'
      from track_creation_results,
      lateral pg_catalog.jsonb_array_elements(response->'goals') as goal
      where name = 'second-source' and goal->>'readinessGoalKey' = 'goal:track-second'
    ),
    'Different goal lane',
    60,
    30,
    (select response#>>'{growthPlan,aggregateVersion}' from track_creation_results where name = 'second-source'),
    'Prove different active Goal sources are allowed.',
    '10000000-0000-4000-8000-000000000002'
  )
);
reset role;
select ok(
  exists (
    select 1
    from planning.learning_tracks as track
    join targets.readiness_goals as goal
      on goal.readiness_goal_id = track.readiness_goal_id
    where track.workspace_id = (select (response->>'workspace_id')::uuid from track_creation_results where name = 'bootstrap')
      and track.title = 'Different goal lane'
      and goal.readiness_goal_key = 'goal:track-second'
  ),
  'a current Plan may contain Tracks backed by different active Goals'
);
select ok(
  (select track.profile_version_id from planning.learning_tracks as track
   where track.workspace_id = (select (response->>'workspace_id')::uuid from track_creation_results where name = 'bootstrap')
     and track.title = 'Different goal lane')
  <> (select track.profile_version_id from planning.learning_tracks as track
      where track.workspace_id = (select (response->>'workspace_id')::uuid from track_creation_results where name = 'bootstrap')
        and track.title = 'Algorithms sprint'),
  'mixed Goal/profile Tracks retain distinct exact profile bindings'
);

insert into track_creation_results values (
  'stale-goal-preview', api.preview_learning_track_creation_v1(
    'goal:track-second',
    (select goal->>'aggregateVersion'
     from jsonb_array_elements((select response->'goals' from track_creation_results where name = 'second-source')) as goal
     where goal->>'readinessGoalKey' = 'goal:track-second'),
    'Stale goal lane', 20, 30,
    (select response#>>'{growthPlan,aggregateVersion}' from track_creation_results where name = 'second-source'),
    'Stale Goal proof.', '10000000-0000-4000-8000-000000000004'
  )
);
reset role;
update targets.readiness_goals
set aggregate_version = aggregate_version + 1,
    updated_at = pg_catalog.clock_timestamp()
where workspace_id = (select (response->>'workspace_id')::uuid from track_creation_results where name = 'bootstrap')
  and readiness_goal_key = 'goal:track-second';
set local role authenticated;
select throws_ok(
  pg_catalog.format(
    'select api.apply_learning_track_creation_v1(%L,%L,%L,%s,%s,%L,%L,%L,%L)',
    'goal:track-second',
    (select response->>'expectedReadinessGoalVersion' from track_creation_results where name = 'stale-goal-preview'),
    'Stale goal lane', 20, 30,
    (select response->>'expectedGrowthPlanVersion' from track_creation_results where name = 'stale-goal-preview'),
    'Stale Goal proof.', '10000000-0000-4000-8000-000000000004',
    (select response->>'previewDigest' from track_creation_results where name = 'stale-goal-preview')
  ),
  '40001', 'Learning Track creation source is stale',
  'changed Targets Goal version rejects the previously shown creation preview'
);
insert into track_creation_results values (
  'stale-plan-preview', api.preview_learning_track_creation_v1(
    'goal:track-main', '1', 'Stale Plan lane', 25, 30,
    (select response#>>'{growthPlan,aggregateVersion}'
     from track_creation_results where name = 'second-source'),
    'Stale Plan proof.', '10000000-0000-4000-8000-000000000005'
  )
);
reset role;
update planning.growth_plans
set aggregate_version = aggregate_version + 1,
    updated_at = pg_catalog.clock_timestamp()
where workspace_id = (select (response->>'workspace_id')::uuid from track_creation_results where name = 'bootstrap');
set local role authenticated;
select throws_ok(
  pg_catalog.format(
    'select api.apply_learning_track_creation_v1(%L,%L,%L,%s,%s,%L,%L,%L,%L)',
    'goal:track-main', '1', 'Stale Plan lane', 25, 30,
    (select response#>>'{expectedGrowthPlanVersion}' from track_creation_results where name = 'stale-plan-preview'),
    'Stale Plan proof.', '10000000-0000-4000-8000-000000000005',
    (select response->>'previewDigest' from track_creation_results where name = 'stale-plan-preview')
  ),
  '40001', 'Growth Plan version is stale',
  'changed Growth Plan version rejects the previously shown creation preview'
);
insert into track_creation_results values (
  'post-plan-change-source', api.get_learning_track_creation_source_v1()
);
insert into track_creation_results values (
  'stale-order-preview', api.preview_learning_track_creation_v1(
    'goal:track-main', '1', 'Stale order lane', 25, 30,
    (select response#>>'{growthPlan,aggregateVersion}'
     from track_creation_results where name = 'post-plan-change-source'),
    'Stale order proof.', '10000000-0000-4000-8000-000000000006'
  )
);
reset role;
update planning.learning_tracks
set priority = priority + 1,
    aggregate_version = aggregate_version + 1,
    updated_at = pg_catalog.clock_timestamp()
where workspace_id = (select (response->>'workspace_id')::uuid from track_creation_results where name = 'bootstrap')
  and title = 'Algorithms sprint';
set local role authenticated;
select throws_ok(
  pg_catalog.format(
    'select api.apply_learning_track_creation_v1(%L,%L,%L,%s,%s,%L,%L,%L,%L)',
    'goal:track-main', '1', 'Stale order lane', 25, 30,
    (select response->>'expectedGrowthPlanVersion' from track_creation_results where name = 'stale-order-preview'),
    'Stale order proof.', '10000000-0000-4000-8000-000000000006',
    (select response->>'previewDigest' from track_creation_results where name = 'stale-order-preview')
  ),
  '40001', 'Learning Track creation preview is stale',
  'changed sibling order rejects the previously shown creation preview'
);
reset role;
select ok(
  not exists (select 1 from planning.learning_tracks
              where workspace_id = (select (response->>'workspace_id')::uuid from track_creation_results where name = 'bootstrap')
                and title in ('Stale Plan lane', 'Stale order lane')),
  'stale Plan and sibling-order previews create no Track'
);
set local role authenticated;

do $bulk_goals$
declare
  v_workspace_id uuid := (select (response->>'workspace_id')::uuid from track_creation_results where name = 'bootstrap');
begin
  for i in 1..18 loop
    perform api.create_readiness_goal(
      v_workspace_id,
      pg_catalog.format('goal:bulk-%s', pg_catalog.lpad(i::text, 2, '0')),
      pg_catalog.format('Bulk %s', i),
      'target:nvidia-python-verification-base-v1',
      pg_catalog.format('bulk-goal-%s', i)
    );
  end loop;
end
$bulk_goals$;
insert into track_creation_results values (
  'twenty-goals-source', api.get_learning_track_creation_source_v1()
);
select is(
  (select pg_catalog.jsonb_array_length(response->'goals') from track_creation_results where name = 'twenty-goals-source'),
  20,
  'READY source exposes the full 20-goal portfolio without truncation'
);

reset role;
alter table targets.readiness_goals disable trigger readiness_goal_active_envelope;
insert into targets.readiness_goals (
  readiness_goal_id, workspace_id, readiness_goal_key, title,
  profile_version_id, lifecycle, aggregate_version
)
select gen_random_uuid(),
  (select (response->>'workspace_id')::uuid from track_creation_results where name = 'bootstrap'),
  'goal:bulk-21',
  'Bulk 21',
  goal.profile_version_id,
  'active',
  1
from targets.readiness_goals as goal
where goal.workspace_id = (select (response->>'workspace_id')::uuid from track_creation_results where name = 'bootstrap')
  and goal.readiness_goal_key = 'goal:track-main';
alter table targets.readiness_goals enable trigger readiness_goal_active_envelope;
set local role authenticated;
insert into track_creation_results values (
  'goal-overflow-source', api.get_learning_track_creation_source_v1()
);
select ok(
  (select response->>'state' from track_creation_results where name = 'goal-overflow-source') = 'GOAL_PORTFOLIO_OVERFLOW'
  and (select pg_catalog.jsonb_array_length(response->'goals') from track_creation_results where name = 'goal-overflow-source') = 0,
  'goal 21 blocks create source without truncating the portfolio'
);

reset role;
update targets.readiness_goals
set lifecycle = 'archived',
  aggregate_version = aggregate_version + 1,
  updated_at = pg_catalog.clock_timestamp()
where workspace_id = (select (response->>'workspace_id')::uuid from track_creation_results where name = 'bootstrap')
  and readiness_goal_key like 'goal:bulk-%';
set local role authenticated;
insert into track_creation_results values (
  'track-source-before-bulk', api.get_learning_track_creation_source_v1()
);

do $bulk_tracks$
declare
  v_goal_version text := (
    select goal->>'aggregateVersion'
    from track_creation_results,
      lateral pg_catalog.jsonb_array_elements(response->'goals') as goal
    where name = 'track-source-before-bulk' and goal->>'readinessGoalKey' = 'goal:track-main'
  );
  v_plan_version text := (
    select response#>>'{growthPlan,aggregateVersion}' from track_creation_results where name = 'track-source-before-bulk'
  );
begin
  for i in 1..26 loop
    perform pg_temp.create_learning_track_fixture_v1(
      'goal:track-main',
      v_goal_version,
      pg_catalog.format('Bulk Track %s', i),
      50,
      30,
      v_plan_version,
      pg_catalog.format('Create bulk Track %s.', i),
      '10000000-0000-4000-8000-' || pg_catalog.lpad((i + 100)::text, 12, '0')
    );
  end loop;
end
$bulk_tracks$;

insert into track_creation_results values (
  'track-29-source', api.get_learning_track_creation_source_v1()
);
select ok(
  (select response->>'state' from track_creation_results where name = 'track-29-source') = 'READY'
  and (select response#>>'{trackPortfolio,currentTrackCount}' from track_creation_results where name = 'track-29-source') = '29',
  '29 current Tracks still permit one more Track'
);

insert into track_creation_results values (
  'track-30-preview',
  api.preview_learning_track_creation_v1(
    'goal:track-main',
    (
      select goal->>'aggregateVersion'
      from track_creation_results,
      lateral pg_catalog.jsonb_array_elements(response->'goals') as goal
      where name = 'track-29-source' and goal->>'readinessGoalKey' = 'goal:track-main'
    ),
    'Track Thirty',
    55,
    25,
    (select response#>>'{growthPlan,aggregateVersion}' from track_creation_results where name = 'track-29-source'),
    'Reach thirty Tracks.',
    '10000000-0000-4000-8000-000000000030'
  )
);
insert into track_creation_results values (
  'track-30-apply',
  api.apply_learning_track_creation_v1(
    'goal:track-main',
    (select response#>>'{expectedReadinessGoalVersion}' from track_creation_results where name = 'track-30-preview'),
    'Track Thirty',
    55,
    25,
    (select response#>>'{expectedGrowthPlanVersion}' from track_creation_results where name = 'track-30-preview'),
    'Reach thirty Tracks.',
    '10000000-0000-4000-8000-000000000030',
    (select response->>'previewDigest' from track_creation_results where name = 'track-30-preview')
  )
);
insert into track_creation_results values (
  'track-30-source', api.get_learning_track_creation_source_v1()
);
select ok(
  (select response->>'state' from track_creation_results where name = 'track-30-source') = 'TRACK_PORTFOLIO_LIMIT_REACHED'
  and (select response#>>'{trackPortfolio,currentTrackCount}' from track_creation_results where name = 'track-30-source') = '30'
  and (select pg_catalog.jsonb_array_length(response->'goals') from track_creation_results where name = 'track-30-source') = 0,
  'the exact 30-Track cap blocks the source without exposing stale choices'
);

insert into track_creation_results values (
  'track-31-preview',
  api.preview_learning_track_creation_v1(
    'goal:track-main',
    '1',
    'Track Thirty One',
    40,
    30,
    (select response#>>'{growthPlan,aggregateVersion}' from track_creation_results where name = 'track-30-source'),
    'Attempt 31.',
    '10000000-0000-4000-8000-000000000031'
  )
);
select ok(
  (select response->>'canApply' from track_creation_results where name = 'track-31-preview') = 'false'
  and (select response#>>'{blockingReasons,0,code}' from track_creation_results where name = 'track-31-preview') = 'TRACK_PORTFOLIO_LIMIT_REACHED'
  and (select response#>>'{constraint,currentTrackCountBefore}' from track_creation_results where name = 'track-31-preview') = '30'
  and (select response#>>'{constraint,currentTrackCountAfter}' from track_creation_results where name = 'track-31-preview') = '31',
  'preview reports the 30->31 blocked state explicitly'
);
select throws_ok(
  pg_catalog.format(
    'select api.apply_learning_track_creation_v1(%L,%L,%L,%s,%s,%L,%L,%L,%L)',
    'goal:track-main','1','Track Thirty One',40,30,
    (select response#>>'{growthPlan,aggregateVersion}' from track_creation_results where name = 'track-30-source'),
    'Attempt 31.','10000000-0000-4000-8000-000000000031',
    (select response->>'previewDigest' from track_creation_results where name = 'track-31-preview')
  ),
  '40001', 'Learning Track creation preview is stale',
  'blocked preview never applies'
);

select throws_ok(
  pg_catalog.format(
    'select api.preview_learning_track_creation_v1(%L,%L,%L,%s,%s,%L,%L,%L)',
    'goal:not-visible','1','Hidden lane',50,30,
    (select response#>>'{growthPlan,aggregateVersion}' from track_creation_results where name = 'ready-source'),
    'Do not enumerate.','10000000-0000-4000-8000-000000000050'
  ),
  '42501', 'setup source is unavailable',
  'preview fails closed without enumerating a missing or foreign Goal'
);

select throws_ok(
  pg_catalog.format(
    'select api.preview_learning_track_creation_v1(%L,%L,%L,%s,%s,%L,%L,%L)',
    'goal:track-main','9223372036854775808','Overflow lane',50,30,
    (select response#>>'{growthPlan,aggregateVersion}' from track_creation_results where name = 'ready-source'),
    'Reject overflow.','10000000-0000-4000-8000-000000000051'
  ),
  '22023', 'Learning Track creation preview request is invalid',
  'preview rejects an expected Goal version above signed bigint range'
);

reset role;
update planning.learning_tracks
set lifecycle = 'archived',
  aggregate_version = aggregate_version + 1,
  updated_at = pg_catalog.clock_timestamp()
where workspace_id = (select (response->>'workspace_id')::uuid from track_creation_results where name = 'bootstrap')
  and title = 'Bulk Track 1';
set local role authenticated;

create temporary table track_creation_rollback_cases (
  stage text primary key,
  request_id text not null,
  reason text not null,
  preview jsonb not null
);
grant select, insert on track_creation_rollback_cases to authenticated;
insert into track_creation_results
select 'rollback-goal', api.create_readiness_goal(
  (select (response->>'workspace_id')::uuid from track_creation_results where name = 'bootstrap'),
  'goal:rollback-track', 'Rollback track goal',
  'target:nvidia-python-verification-base-v1', 'rollback-track-goal'
);
insert into track_creation_results values (
  'rollback-source', api.get_learning_track_creation_source_v1()
);
insert into track_creation_rollback_cases
select stage, request_id, reason,
  api.preview_learning_track_creation_v1(
    'goal:rollback-track',
    (
      select goal->>'aggregateVersion'
      from track_creation_results,
      lateral pg_catalog.jsonb_array_elements(response->'goals') as goal
      where name = 'rollback-source' and goal->>'readinessGoalKey' = 'goal:rollback-track'
    ),
    'Rollback lane',
    44,
    30,
    (select response#>>'{growthPlan,aggregateVersion}' from track_creation_results where name = 'rollback-source'),
    reason,
    request_id
  )
from (values
  ('outbox.command_receipts','10000000-0000-4000-8000-000000000701','Fail receipt insert.'),
  ('planning.learning_tracks','10000000-0000-4000-8000-000000000702','Fail Track insert.'),
  ('outbox.events','10000000-0000-4000-8000-000000000703','Fail event insert.'),
  ('outbox.deliveries','10000000-0000-4000-8000-000000000704','Fail delivery insert.')
) as candidate(stage, request_id, reason);

reset role;
set local role postgres;
create function pg_temp.reject_d2b3_stage()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_stage text := tg_table_schema || '.' || tg_table_name;
begin
  if new.workspace_id::text = pg_catalog.current_setting('pando.test.d2b3_fail_workspace', true)
     and v_stage = pg_catalog.current_setting('pando.test.d2b3_fail_stage', true) then
    raise exception using errcode = 'P0001',
      message = 'injected D2b3 failure at ' || v_stage;
  end if;
  return new;
end
$function$;
create trigger reject_d2b3_receipt
before insert on outbox.command_receipts
for each row execute function pg_temp.reject_d2b3_stage();
create trigger reject_d2b3_track
before insert on planning.learning_tracks
for each row execute function pg_temp.reject_d2b3_stage();
create trigger reject_d2b3_event
before insert on outbox.events
for each row execute function pg_temp.reject_d2b3_stage();
create trigger reject_d2b3_delivery
before insert on outbox.deliveries
for each row execute function pg_temp.reject_d2b3_stage();
select pg_catalog.set_config(
  'pando.test.d2b3_fail_workspace',
  (select (response->>'workspace_id')::uuid::text from track_creation_results where name = 'bootstrap'),
  true
);
set local role authenticated;
select throws_ok(
  pg_catalog.format(
    $query$
      with configured as (
        select pg_catalog.set_config('pando.test.d2b3_fail_stage', %L, true) as stage
      )
      select api.apply_learning_track_creation_v1(
        %L,%L,%L,%s,%s,%L,%L,%L,%L
      )
      from configured where stage is not null
    $query$,
    stage,
    'goal:rollback-track',
    (
      select goal->>'aggregateVersion'
      from track_creation_results,
      lateral pg_catalog.jsonb_array_elements(response->'goals') as goal
      where name = 'rollback-source' and goal->>'readinessGoalKey' = 'goal:rollback-track'
    ),
    'Rollback lane',
    44,
    30,
    (select response#>>'{growthPlan,aggregateVersion}' from track_creation_results where name = 'rollback-source'),
    reason,
    request_id,
    preview->>'previewDigest'
  ),
  'P0001', 'injected D2b3 failure at ' || stage,
  stage || ' failure rolls back the entire Track creation command'
)
from track_creation_rollback_cases
order by stage;
set local role postgres;
drop trigger reject_d2b3_receipt on outbox.command_receipts;
drop trigger reject_d2b3_track on planning.learning_tracks;
drop trigger reject_d2b3_event on outbox.events;
drop trigger reject_d2b3_delivery on outbox.deliveries;

select ok(
  not exists (
    select 1 from planning.learning_tracks
    where workspace_id = (select (response->>'workspace_id')::uuid from track_creation_results where name = 'bootstrap')
      and title = 'Rollback lane'
  )
  and not exists (
    select 1 from outbox.command_receipts
    where command_type = 'planning.create_learning_track_v1'
      and idempotency_key like '10000000-0000-4000-8000-00000000070%'
  )
  and not exists (
    select 1 from outbox.events
    where workspace_id = (select (response->>'workspace_id')::uuid from track_creation_results where name = 'bootstrap')
      and payload->>'change_kind' = 'TRACK_CREATED'
      and payload->>'learning_track_id' in (
        select preview#>>'{learningTrack,learningTrackId}'
        from track_creation_rollback_cases
      )
  ),
  'injected failures leave no Track, receipt, or TRACK_CREATED event behind'
);

do $grant_planning_test_role$
begin
  execute pg_catalog.format('grant pando_planning_api to %I with set true', current_user);
end
$grant_planning_test_role$;
select pg_catalog.set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '38000000-0000-4000-8000-000000000001', 'role', 'authenticated',
    'aud', 'authenticated', 'exp', extract(epoch from pg_catalog.clock_timestamp() + interval '1 hour')::bigint
  )::text, true
);
set local role pando_planning_api;
select ok(
  exists (
    select 1 from planning.learning_tracks
    where workspace_id = (select (response->>'workspace_id')::uuid from track_creation_results where name = 'bootstrap')
      and title = 'Algorithms sprint'
  ),
  'forced RLS permits the Planning owner to query created Tracks in the actor workspace'
);
select pg_catalog.set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '38000000-0000-4000-8000-000000000099', 'role', 'authenticated',
    'aud', 'authenticated', 'exp', extract(epoch from pg_catalog.clock_timestamp() + interval '1 hour')::bigint
  )::text, true
);
select is(
  (select count(*) from planning.learning_tracks
   where workspace_id = (select (response->>'workspace_id')::uuid from track_creation_results where name = 'bootstrap')),
  0::bigint,
  'forced RLS hides created Tracks from a foreign actor workspace'
);
select throws_ok(
  $$insert into planning.learning_tracks (
    learning_track_id, workspace_id, growth_plan_id, track_key, title,
    readiness_goal_id, profile_version_id, roadmap_version_id, lifecycle,
    priority, protected_minimum_minutes, default_session_minutes, aggregate_version
  ) values (
    '38000000-0000-8000-8000-000000000099',
    (select (response->>'workspace_id')::uuid from track_creation_results where name = 'bootstrap'),
    (select (response#>>'{growthPlan,growthPlanId}')::uuid from track_creation_results where name = 'same-goal-preview'),
    'track:foreign-write', 'Foreign write',
    (select (response#>>'{source,readinessGoalId}')::uuid from track_creation_results where name = 'same-goal-preview'),
    (select (response#>>'{source,profileVersionId}')::uuid from track_creation_results where name = 'same-goal-preview'),
    null, 'active', 1, 0, 30, 1)$$,
  '42501', null,
  'forced INSERT RLS rejects a foreign actor mutation of Track rows'
);
reset role;

select * from finish();
rollback;
