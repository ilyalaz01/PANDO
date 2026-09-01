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
  pg_catalog.has_function_privilege(
    'authenticated', 'api.preview_growth_plan_capacity_v1(integer,text,text)', 'EXECUTE'
  )
  and pg_catalog.has_function_privilege(
    'authenticated', 'api.apply_growth_plan_capacity_v1(integer,text,text,text,text)', 'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'anon', 'api.preview_growth_plan_capacity_v1(integer,text,text)', 'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'service_role', 'api.apply_growth_plan_capacity_v1(integer,text,text,text,text)', 'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated', 'planning.active_track_capacity_constraint_v1(uuid,uuid)', 'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated',
    'planning.build_growth_plan_capacity_preview_v1(uuid,uuid,text,text,integer,bigint,integer,bigint,text,integer,integer,text)',
    'EXECUTE'
  ),
  'capacity control exposes only actor-scoped authenticated preview/apply APIs'
);

select ok(
  count(*) = 2
    and bool_and(procedure.prosecdef)
    and bool_and('search_path=""' = any(coalesce(procedure.proconfig, '{}'::text[])))
    and bool_and(owner.rolname = 'pando_planning_api')
    and bool_and(not owner.rolcanlogin and not owner.rolinherit and not owner.rolbypassrls),
  'capacity APIs are bounded SECURITY DEFINER functions owned by pando_planning_api'
)
from pg_catalog.pg_proc as procedure
join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
join pg_catalog.pg_roles as owner on owner.oid = procedure.proowner
where namespace.nspname = 'api'
  and procedure.proname in (
    'preview_growth_plan_capacity_v1', 'apply_growth_plan_capacity_v1'
  );

select is(
  (
    select (
      (
        pg_catalog.length(pg_catalog.lower(pg_catalog.pg_get_functiondef(procedure.oid)))
        - pg_catalog.length(pg_catalog.replace(
          pg_catalog.lower(pg_catalog.pg_get_functiondef(procedure.oid)),
          'get diagnostics v_affected_rows = row_count', ''
        ))
      ) / pg_catalog.length('get diagnostics v_affected_rows = row_count')
    )::bigint
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'api'
      and procedure.proname = 'apply_growth_plan_capacity_v1'
      and procedure.pronargs = 5
  ),
  2::bigint,
  'capacity apply fails closed unless the Plan and completed receipt each update exactly once'
);

select ok(
  pg_catalog.has_column_privilege(
    'pando_planning_api', 'planning.growth_plans', 'weekly_capacity_minutes', 'UPDATE'
  )
  and pg_catalog.has_column_privilege(
    'pando_planning_api', 'planning.growth_plans', 'aggregate_version', 'UPDATE'
  )
  and pg_catalog.has_column_privilege(
    'pando_planning_api', 'planning.growth_plans', 'updated_at', 'UPDATE'
  )
  and not pg_catalog.has_column_privilege(
    'pando_planning_api', 'planning.growth_plans', 'title', 'UPDATE'
  )
  and not pg_catalog.has_table_privilege(
    'authenticated', 'planning.growth_plans', 'SELECT'
  )
  and not pg_catalog.has_table_privilege(
    'authenticated', 'planning.learning_tracks', 'SELECT'
  ),
  'capacity owner has the narrow update columns while browser roles retain no table access'
);

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    'd3000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
    'capacity-alice@pando.test', '', clock_timestamp(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    clock_timestamp(), clock_timestamp()
  ),
  (
    'd3000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
    'capacity-bob@pando.test', '', clock_timestamp(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    clock_timestamp(), clock_timestamp()
  );

create temporary table capacity_results (
  result_name text primary key,
  response jsonb not null
);
grant select, insert on capacity_results to authenticated;
grant select, insert on capacity_results to pando_planning_api;

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', 'd3000000-0000-4000-8000-000000000001',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text,
  true
);
set local role authenticated;
insert into capacity_results values (
  'alice-bootstrap', api.bootstrap_personal_workspace('phase4b-capacity-alice', 'Capacity Alice')
);
insert into capacity_results
select 'alice-goal', api.create_readiness_goal(
  (select (response->>'workspace_id')::uuid from capacity_results where result_name = 'alice-bootstrap'),
  'goal:capacity-alice', 'Capacity Alice goal',
  'target:nvidia-python-verification-base-v1', 'phase4b-capacity-alice-goal'
);
insert into capacity_results values (
  'alice-plan', pg_temp.initialize_growth_plan_fixture_v1(
    'goal:capacity-alice', 600, 45, 80, 120, 'phase4b-capacity-alice-plan'
  )
);
reset role;

-- Duplicate the initialized Track only as fixture setup. The public API still receives no Track IDs.
insert into planning.learning_tracks (
  learning_track_id, workspace_id, growth_plan_id, track_key, title,
  readiness_goal_id, profile_version_id, roadmap_version_id, lifecycle,
  priority, protected_minimum_minutes, default_session_minutes, aggregate_version
)
select
  fixture.learning_track_id,
  source.workspace_id,
  source.growth_plan_id,
  fixture.track_key,
  fixture.title,
  source.readiness_goal_id,
  source.profile_version_id,
  source.roadmap_version_id,
  fixture.lifecycle,
  source.priority,
  fixture.protected_minimum_minutes,
  source.default_session_minutes,
  1
from planning.learning_tracks as source
cross join (
  values
    ('d3100000-0000-4000-8000-000000000001'::uuid, 'track:capacity-active-two', 'Active two', 'active', 80),
    ('d3100000-0000-4000-8000-000000000002'::uuid, 'track:capacity-paused', 'Paused', 'paused', 400),
    ('d3100000-0000-4000-8000-000000000003'::uuid, 'track:capacity-completed', 'Completed', 'completed', 500),
    ('d3100000-0000-4000-8000-000000000004'::uuid, 'track:capacity-archived', 'Archived', 'archived', 600)
) as fixture(
  learning_track_id, track_key, title, lifecycle, protected_minimum_minutes
)
where source.growth_plan_id = (
  select (response->>'growthPlanId')::uuid from capacity_results where result_name = 'alice-plan'
)
  and source.lifecycle = 'active'
limit 4;

set local role authenticated;
insert into capacity_results values (
  'alice-blocked', api.preview_growth_plan_capacity_v1(
    199, '1', 'Reduce capacity below the protected total.'
  )
);
insert into capacity_results values (
  'alice-exact', api.preview_growth_plan_capacity_v1(
    200, '1', 'Use exactly the protected total.'
  )
);
insert into capacity_results values (
  'alice-upper-bound', api.preview_growth_plan_capacity_v1(
    10080, '1', 'Use the inclusive weekly upper bound.'
  )
);
reset role;

select ok(
  (select response#>>'{contract,name}' = 'GrowthPlanCapacityPreviewV1'
     and response->>'operation' = 'set_default_capacity'
     and response#>>'{constraint,activeTrackCount}' = '2'
     and response#>>'{constraint,activeProtectedMinimumMinutes}' = '200'
     and response#>>'{constraint,flexibleMinutesBefore}' = '400'
     and response#>>'{constraint,flexibleMinutesAfter}' = '-1'
     and response->>'canApply' = 'false'
     and response->'blockingReasons' =
       '[{"code":"ACTIVE_TRACK_MINIMUM_EXCEEDS_CAPACITY","minimumCapacityMinutes":200}]'::jsonb
   from capacity_results where result_name = 'alice-blocked'),
  'aggregate active minima block an in-range proposal while non-active Tracks contribute zero'
);

select ok(
  (select response#>>'{constraint,activeProtectedMinimumMinutes}' = '200'
     and response#>>'{constraint,flexibleMinutesAfter}' = '0'
     and response->>'canApply' = 'true'
     and response->'blockingReasons' = '[]'::jsonb
     and response#>>'{before,aggregateVersion}' = '1'
     and response#>>'{after,aggregateVersion}' = '2'
     and response#>>'{recalculationAfterApply,projectionState}' = 'PENDING'
     and response->'retained' =
       '{"learningTracks":true,"planSnapshots":true,"focusSessions":true,"evidence":true}'::jsonb
   from capacity_results where result_name = 'alice-exact'),
  'capacity exactly equal to the active protected total is applicable and preserves history'
);

select ok(
  (select response#>>'{after,weeklyCapacityMinutes}' = '10080'
     and response#>>'{constraint,flexibleMinutesAfter}' = '9880'
     and response->>'canApply' = 'true'
   from capacity_results where result_name = 'alice-upper-bound'),
  '10080 is an inclusive applicable capacity boundary'
);

-- Preview is side-effect-free.
select is(
  (select aggregate_version from planning.growth_plans where growth_plan_id =
    (select (response->>'growthPlanId')::uuid from capacity_results where result_name = 'alice-plan')),
  1::bigint,
  'capacity previews do not advance the Plan version'
);
select is(
  (select count(*)::bigint from outbox.command_receipts where command_type =
    'planning.set_growth_plan_default_capacity'),
  0::bigint,
  'capacity previews create no receipt or mutation side effect'
);

-- Track aggregate version is digest material even when the numeric minimum is unchanged.
update planning.learning_tracks
set aggregate_version = 2
where learning_track_id = 'd3100000-0000-4000-8000-000000000001';
set local role authenticated;
insert into capacity_results values (
  'alice-fingerprint-changed', api.preview_growth_plan_capacity_v1(
    200, '1', 'Use exactly the protected total.'
  )
);
reset role;
select isnt(
  (select response#>>'{constraint,activeTrackFingerprint}' from capacity_results where result_name = 'alice-fingerprint-changed'),
  (select response#>>'{constraint,activeTrackFingerprint}' from capacity_results where result_name = 'alice-exact'),
  'an active Track aggregate revision changes the constraint fingerprint'
);
select isnt(
  (select response->>'previewDigest' from capacity_results where result_name = 'alice-fingerprint-changed'),
  (select response->>'previewDigest' from capacity_results where result_name = 'alice-exact'),
  'the changed active Track fingerprint changes the exact preview digest'
);
update planning.learning_tracks
set aggregate_version = 1
where learning_track_id = 'd3100000-0000-4000-8000-000000000001';

-- Pausing the parent does not relax active child minima.
update planning.growth_plans
set lifecycle = 'paused'
where growth_plan_id = (
  select (response->>'growthPlanId')::uuid from capacity_results where result_name = 'alice-plan'
);
set local role authenticated;
insert into capacity_results values (
  'alice-parent-paused', api.preview_growth_plan_capacity_v1(
    199, '1', 'Parent pause does not relax minima.'
  )
);
reset role;
select ok(
  (select response#>>'{before,lifecycle}' = 'PAUSED'
     and response#>>'{after,lifecycle}' = 'PAUSED'
     and response#>>'{constraint,activeProtectedMinimumMinutes}' = '200'
     and response->>'canApply' = 'false'
   from capacity_results where result_name = 'alice-parent-paused'),
  'a paused parent still enforces the active child minimum sum'
);
update planning.growth_plans
set lifecycle = 'active'
where growth_plan_id = (
  select (response->>'growthPlanId')::uuid from capacity_results where result_name = 'alice-plan'
);

-- A second workspace proves actor resolution and the inclusive zero boundary with no active Track.
select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', 'd3000000-0000-4000-8000-000000000002',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text,
  true
);
set local role authenticated;
insert into capacity_results values (
  'bob-bootstrap', api.bootstrap_personal_workspace('phase4b-capacity-bob', 'Capacity Bob')
);
insert into capacity_results
select 'bob-goal', api.create_readiness_goal(
  (select (response->>'workspace_id')::uuid from capacity_results where result_name = 'bob-bootstrap'),
  'goal:capacity-bob', 'Capacity Bob goal',
  'target:nvidia-python-verification-base-v1', 'phase4b-capacity-bob-goal'
);
insert into capacity_results values (
  'bob-plan', pg_temp.initialize_growth_plan_fixture_v1(
    'goal:capacity-bob', 180, 30, 70, 60, 'phase4b-capacity-bob-plan'
  )
);
reset role;
update planning.learning_tracks
set lifecycle = 'paused'
where growth_plan_id = (
  select (response->>'growthPlanId')::uuid from capacity_results where result_name = 'bob-plan'
);

insert into planning.learning_tracks (
  learning_track_id, workspace_id, growth_plan_id, track_key, title,
  readiness_goal_id, profile_version_id, roadmap_version_id, lifecycle,
  priority, protected_minimum_minutes, default_session_minutes, aggregate_version
)
select
  fixture.learning_track_id,
  source.workspace_id,
  source.growth_plan_id,
  fixture.track_key,
  fixture.title,
  source.readiness_goal_id,
  source.profile_version_id,
  source.roadmap_version_id,
  'active',
  source.priority,
  fixture.protected_minimum_minutes,
  source.default_session_minutes,
  fixture.aggregate_version
from planning.learning_tracks as source
cross join (
  values
    ('30000000-0000-4000-8000-000000000032'::uuid, 'track:capacity-oracle-two', 'Oracle two', 60, 7::bigint),
    ('30000000-0000-4000-8000-000000000031'::uuid, 'track:capacity-oracle-one', 'Oracle one', 90, 5::bigint)
) as fixture(
  learning_track_id, track_key, title, protected_minimum_minutes, aggregate_version
)
where source.growth_plan_id = (
  select (response->>'growthPlanId')::uuid from capacity_results where result_name = 'bob-plan'
)
limit 2;

set local role authenticated;
insert into capacity_results values (
  'bob-fingerprint-oracle', api.preview_growth_plan_capacity_v1(
    160, '1', 'Verify canonical active Track ordering.'
  )
);
reset role;
select is(
  (select response#>>'{constraint,activeTrackFingerprint}'
   from capacity_results where result_name = 'bob-fingerprint-oracle'),
  '5a0ef16ebb323cbb8b452ad620476487560b46b51fe23659ca9ceb3264387849',
  'Postgres reproduces the TypeScript active Track fingerprint oracle in UUID order'
);

do $planning_test_role$
begin
  execute pg_catalog.format('grant pando_planning_api to %I with set true', current_user);
end
$planning_test_role$;
set local role pando_planning_api;
select is(
  planning.plan_capacity_event_payload_v1_is_valid(
    pg_catalog.jsonb_build_object(
      'change_kind', 'PLAN_CAPACITY_CHANGED',
      'growth_plan_id', 'd3000000-0000-4000-8000-000000000001',
      'growth_plan_version', '9223372036854775808',
      'weekly_capacity_minutes', 300
    )
  ),
  false,
  'the capacity event SQL invariant rejects a version above PostgreSQL bigint'
);
select is(
  planning.plan_lifecycle_event_payload_v1_is_valid(
    pg_catalog.jsonb_build_object(
      'change_kind', 'PLAN_LIFECYCLE_CHANGED',
      'growth_plan_id', 'd3000000-0000-4000-8000-000000000001',
      'growth_plan_version', '9223372036854775808',
      'lifecycle', 'PAUSED'
    )
  ),
  false,
  'the lifecycle event SQL invariant shares the bigint-safe contract bound'
);
select is(
  planning.build_growth_plan_capacity_preview_v1(
    '30000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000020',
    'Backend readiness', 'active', 600, 4, 480, 4,
    'Reserve — confirmed', 2, 150,
    '5a0ef16ebb323cbb8b452ad620476487560b46b51fe23659ca9ceb3264387849'
  )->>'previewDigest',
  '221555ef5b5c99d6517005ebb6bba36690adaea7f27580b9c1661f24cc7e7dc3',
  'Postgres reproduces the exact TypeScript UTF-8 capacity preview digest oracle'
);
reset role;

update planning.learning_tracks
set lifecycle = 'paused'
where growth_plan_id = (
  select (response->>'growthPlanId')::uuid from capacity_results where result_name = 'bob-plan'
);
set local role authenticated;
insert into capacity_results values (
  'bob-zero', api.preview_growth_plan_capacity_v1(0, '1', 'Set capacity to zero temporarily.')
);
reset role;
select ok(
  (select response#>>'{after,weeklyCapacityMinutes}' = '0'
     and response#>>'{constraint,activeTrackCount}' = '0'
     and response#>>'{constraint,activeProtectedMinimumMinutes}' = '0'
     and response->>'canApply' = 'true'
     and response#>>'{before,growthPlanId}' = (
       select response->>'growthPlanId' from capacity_results where result_name = 'bob-plan'
     )
     and response#>>'{before,growthPlanId}' <> (
       select response->>'growthPlanId' from capacity_results where result_name = 'alice-plan'
     )
   from capacity_results where result_name = 'bob-zero'),
  'zero is valid without active minima and Bob can preview only his resolved Plan'
);

-- Apply Alice's exact-minimum preview, then prove exact replay and minimal outbox effects.
select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', 'd3000000-0000-4000-8000-000000000001',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text,
  true
);
set local role authenticated;
insert into capacity_results
select 'alice-apply', api.apply_growth_plan_capacity_v1(
  200, '1', response->>'previewDigest', 'Use exactly the protected total.',
  'phase4b-capacity-alice-exact'
)
from capacity_results where result_name = 'alice-exact';
insert into capacity_results
select 'alice-replay', api.apply_growth_plan_capacity_v1(
  200, '1', response->>'previewDigest', 'Use exactly the protected total.',
  'phase4b-capacity-alice-exact'
)
from capacity_results where result_name = 'alice-exact';
reset role;

select is(
  (select response from capacity_results where result_name = 'alice-replay'),
  (select response from capacity_results where result_name = 'alice-apply'),
  'a completed capacity command returns its byte-identical stored response'
);
select ok(
  (select plan.weekly_capacity_minutes = 200 and plan.aggregate_version = 2
   from planning.growth_plans as plan
   where plan.growth_plan_id = (
     select (response->>'growthPlanId')::uuid from capacity_results where result_name = 'alice-plan'
   ))
  and (select response#>>'{changedPlan,weeklyCapacityMinutes}' = '200'
       and response#>>'{changedPlan,aggregateVersion}' = '2'
       and response->>'projectionState' = 'PENDING'
       and pg_catalog.jsonb_array_length(response->'emittedEventIds') = 1
       from capacity_results where result_name = 'alice-apply'),
  'apply changes capacity and Plan version exactly once and returns pending recalculation'
);
select is(
  (
    select count(*)::bigint
    from outbox.events as event
    join capacity_results as applied on applied.result_name = 'alice-apply'
      and event.event_id = (applied.response->'emittedEventIds'->>0)::uuid
    where event.event_name = 'planning.input_changed'
      and event.event_schema_version = 1
      and event.aggregate_type = 'planning.growth_plan'
      and event.aggregate_version = 2
      and event.payload = pg_catalog.jsonb_build_object(
        'change_kind', 'PLAN_CAPACITY_CHANGED',
        'growth_plan_id', event.aggregate_id,
        'growth_plan_version', '2',
        'weekly_capacity_minutes', 200
      )
  ),
  1::bigint,
  'apply emits precisely one privacy-minimized capacity input event'
);
select is(
  (
    select count(*)::bigint
    from outbox.deliveries as delivery
    join capacity_results as applied on applied.result_name = 'alice-apply'
      and delivery.delivery_id = (applied.response->>'planningDeliveryId')::uuid
    where delivery.event_id = (applied.response->'emittedEventIds'->>0)::uuid
      and delivery.consumer_name = 'planning.plan_snapshot_v1'
      and delivery.handler_contract_version = 1
      and delivery.delivery_state = 'pending'
  ),
  1::bigint,
  'apply appends exactly one fixed pending Planning delivery'
);

-- Rejected first attempts never persist receipts or partial state.
set local role authenticated;
select throws_ok(
  $$select api.preview_growth_plan_capacity_v1(200, '2', 'No-op.')$$,
  '22023', 'Growth Plan capacity proposal is unchanged',
  'a no-op capacity proposal is invalid'
);
select throws_ok(
  $$select api.preview_growth_plan_capacity_v1(-1, '2', 'Below range.')$$,
  '22023', 'Growth Plan capacity request is invalid',
  'capacity below zero is invalid'
);
select throws_ok(
  $$select api.preview_growth_plan_capacity_v1(10081, '2', 'Above range.')$$,
  '22023', 'Growth Plan capacity request is invalid',
  'capacity above 10080 is invalid'
);
select throws_ok(
  $$select api.preview_growth_plan_capacity_v1(300, 'not-a-version', 'Malformed version.')$$,
  '22023', 'Growth Plan capacity request is invalid',
  'malformed expected version is invalid'
);
select throws_ok(
  $$select api.apply_growth_plan_capacity_v1(
    200, '1', '0000000000000000000000000000000000000000000000000000000000000000',
    'Use exactly the protected total.', 'phase4b-capacity-stale'
  )$$,
  '40001', 'Growth Plan version is stale',
  'a stale expected Plan version is refused'
);
select throws_ok(
  $$select api.apply_growth_plan_capacity_v1(
    300, '2', '0000000000000000000000000000000000000000000000000000000000000000',
    'Increase capacity after exact minimum.', 'phase4b-capacity-digest'
  )$$,
  '40001', 'Growth Plan preview is stale',
  'an altered digest is refused after locked recomputation'
);
select throws_ok(
  $$select api.apply_growth_plan_capacity_v1(
    199, '2',
    (api.preview_growth_plan_capacity_v1(199, '2', 'Try below the minimum again.')->>'previewDigest'),
    'Try below the minimum again.', 'phase4b-capacity-blocked'
  )$$,
  '40001', 'Growth Plan preview is stale',
  'a blocked preview cannot be applied and requires a fresh decision'
);
select throws_ok(
  $$select api.apply_growth_plan_capacity_v1(
    300, '2', '0000000000000000000000000000000000000000000000000000000000000000',
    'Changed request body.', 'phase4b-capacity-alice-exact'
  )$$,
  '22023', 'idempotency key reused with a different request',
  'a completed idempotency key cannot be reused for a changed request'
);
reset role;
select is(
  (select count(*)::bigint from outbox.command_receipts
   where idempotency_key in (
     'phase4b-capacity-stale', 'phase4b-capacity-digest', 'phase4b-capacity-blocked'
   )),
  0::bigint,
  'stale, altered, and blocked first attempts leave no command receipt'
);

-- An outbox failure rolls back capacity, version, receipt, event, and delivery together.
set local role authenticated;
insert into capacity_results values (
  'alice-rollback-preview', api.preview_growth_plan_capacity_v1(
    300, '2', 'Prove atomic rollback.'
  )
);
reset role;
create temporary table capacity_rollback_before as
select
  plan.weekly_capacity_minutes,
  plan.aggregate_version,
  (select count(*)::bigint from outbox.events as event
   where event.aggregate_id = plan.growth_plan_id) as event_count,
  (select count(*)::bigint from outbox.deliveries as delivery
   join outbox.events as event on event.event_id = delivery.event_id
   where event.aggregate_id = plan.growth_plan_id) as delivery_count
from planning.growth_plans as plan
where plan.growth_plan_id = (
  select (response->>'growthPlanId')::uuid from capacity_results where result_name = 'alice-plan'
);

create function public.fail_growth_plan_capacity_event_for_test()
returns trigger language plpgsql set search_path = '' as $function$
begin
  if new.event_name = 'planning.input_changed'
     and new.aggregate_type = 'planning.growth_plan'
     and new.workspace_id::text = pg_catalog.current_setting('pando.test.fail_capacity_workspace', true) then
    raise exception using errcode = 'P0001', message = 'injected Growth Plan capacity outbox failure';
  end if;
  return new;
end
$function$;
create trigger fail_growth_plan_capacity_event_for_test
before insert on outbox.events
for each row execute function public.fail_growth_plan_capacity_event_for_test();
select set_config(
  'pando.test.fail_capacity_workspace',
  (select response->>'workspaceId' from capacity_results where result_name = 'alice-plan'),
  true
);
set local role authenticated;
select throws_ok(
  pg_catalog.format(
    'select api.apply_growth_plan_capacity_v1(%s,%L,%L,%L,%L)',
    300, '2',
    (select response->>'previewDigest' from capacity_results where result_name = 'alice-rollback-preview'),
    'Prove atomic rollback.', 'phase4b-capacity-rollback'
  ),
  'P0001', 'injected Growth Plan capacity outbox failure',
  'an outbox failure rolls back the whole capacity command'
);
reset role;
drop trigger fail_growth_plan_capacity_event_for_test on outbox.events;
drop function public.fail_growth_plan_capacity_event_for_test();

select ok(
  (select plan.weekly_capacity_minutes = before_state.weekly_capacity_minutes
     and plan.aggregate_version = before_state.aggregate_version
   from planning.growth_plans as plan cross join capacity_rollback_before as before_state
   where plan.growth_plan_id = (
     select (response->>'growthPlanId')::uuid from capacity_results where result_name = 'alice-plan'
   ))
  and (select count(*)::bigint from outbox.events where aggregate_id =
       (select (response->>'growthPlanId')::uuid from capacity_results where result_name = 'alice-plan')) =
      (select event_count from capacity_rollback_before)
  and (select count(*)::bigint from outbox.deliveries as delivery
       join outbox.events as event on event.event_id = delivery.event_id where event.aggregate_id =
       (select (response->>'growthPlanId')::uuid from capacity_results where result_name = 'alice-plan')) =
      (select delivery_count from capacity_rollback_before)
  and (select count(*)::bigint from outbox.command_receipts
       where idempotency_key = 'phase4b-capacity-rollback') = 0,
  'injected failure leaves no partial Plan, receipt, event, or delivery'
);

-- Existing corrupted persisted state fails closed instead of producing an invalid preview.
update planning.learning_tracks
set protected_minimum_minutes = 201
where learning_track_id = 'd3100000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok(
  $$select api.preview_growth_plan_capacity_v1(300, '2', 'Corrupt state must fail closed.')$$,
  '55000', 'Growth Plan capacity invariant is violated',
  'an existing protected-minimum sum above capacity fails closed'
);
reset role;

select * from finish();
rollback;
