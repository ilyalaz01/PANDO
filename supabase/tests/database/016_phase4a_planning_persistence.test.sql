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

select has_table('planning', expected.table_name, format('planning.%s exists', expected.table_name))
from unnest(array[
  'growth_plans',
  'learning_tracks',
  'learning_track_activities',
  'plan_snapshots',
  'current_plan_snapshots'
]) as expected(table_name);

select ok(
  class.relrowsecurity and class.relforcerowsecurity,
  format('planning.%s has enabled and forced RLS', class.relname)
)
from pg_catalog.pg_class as class
join pg_catalog.pg_namespace as namespace on namespace.oid = class.relnamespace
where namespace.nspname = 'planning'
  and class.relname in (
    'growth_plans', 'learning_tracks', 'learning_track_activities',
    'plan_snapshots', 'current_plan_snapshots'
  )
order by class.relname;

select ok(
  role.rolname is not null and not role.rolcanlogin and not role.rolinherit
    and not role.rolbypassrls,
  'pando_planning_api is NOLOGIN/NOINHERIT/NOBYPASSRLS'
)
from pg_catalog.pg_roles as role
where role.rolname = 'pando_planning_api';

select ok(
  not exists (
    select 1
    from information_schema.role_table_grants as privilege
    where privilege.table_schema = 'planning'
      and privilege.grantee in ('anon', 'authenticated', 'service_role')
  ),
  'browser and service roles have no direct Planning table grants'
);

select ok(
  not pg_catalog.has_function_privilege(
    'authenticated',
    'api.initialize_growth_plan_v1(text,integer,integer,integer,integer,text)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'anon',
    'api.initialize_growth_plan_v1(text,integer,integer,integer,integer,text)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'service_role',
    'api.initialize_growth_plan_v1(text,integer,integer,integer,integer,text)',
    'EXECUTE'
  ),
  'legacy Growth Plan initializer is unavailable to every runtime role'
);

select ok(
  procedure.prosecdef
    and 'search_path=""' = any(coalesce(procedure.proconfig, '{}'::text[]))
    and owner.rolname = 'pando_phase1_api'
    and pg_catalog.has_function_privilege(
      'pando_planning_api',
      'targets.get_growth_plan_initialization_source_v1(uuid,text)',
      'EXECUTE'
    )
    and not pg_catalog.has_table_privilege(
      'pando_planning_api', 'targets.readiness_goals', 'SELECT'
    )
    and not pg_catalog.has_table_privilege(
      'pando_planning_api', 'targets.target_profile_versions', 'SELECT'
    )
    and pg_catalog.pg_get_functiondef(procedure.oid)
      like '%:targets.active-readiness-goals%',
  'Planning consumes a fenced owner-scoped Targets query without private table reads'
)
from pg_catalog.pg_proc as procedure
join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
join pg_catalog.pg_roles as owner on owner.oid = procedure.proowner
where namespace.nspname = 'targets'
  and procedure.proname = 'get_growth_plan_initialization_source_v1';

select ok(
  exists (
    select 1
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'targets'
      and procedure.proname = 'guard_readiness_goal_active_envelope'
      and pg_catalog.pg_get_functiondef(procedure.oid)
        like '%:targets.active-readiness-goals%'
  ),
  'Targets writes and the Planning initialization read share one lifecycle fence'
);

select is(
  (
    select count(*)::bigint
    from pg_catalog.pg_trigger as trigger
    join pg_catalog.pg_class as class on class.oid = trigger.tgrelid
    join pg_catalog.pg_namespace as namespace on namespace.oid = class.relnamespace
    where namespace.nspname = 'outbox'
      and class.relname = 'events'
      and not trigger.tgisinternal
      and pg_catalog.pg_get_triggerdef(trigger.oid) ilike '%planning%'
  ),
  0::bigint,
  'Planning routing adds no generic outbox event trigger'
);

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    '26000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
    'planning-alice@pando.test', '', clock_timestamp(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    clock_timestamp(), clock_timestamp()
  ),
  (
    '26000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
    'planning-bob@pando.test', '', clock_timestamp(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    clock_timestamp(), clock_timestamp()
  );

create temporary table planning_results (
  result_name text primary key,
  response jsonb
);
grant select, insert, update on planning_results to authenticated;
grant select on planning_results to pando_planning_api;

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '26000000-0000-4000-8000-000000000001',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text,
  true
);
set local role authenticated;
insert into planning_results values (
  'alice-bootstrap',
  api.bootstrap_personal_workspace('phase4a-planning-alice', 'Planning Alice')
);
insert into planning_results
select 'alice-goal', api.create_readiness_goal(
  (select (response->>'workspace_id')::uuid from planning_results
   where result_name = 'alice-bootstrap'),
  'goal:planning-alice', 'Alice durable Growth Plan',
  'target:nvidia-python-verification-base-v1', 'phase4a-planning-alice-goal'
);
insert into planning_results values (
  'alice-init',
  pg_temp.initialize_growth_plan_fixture_v1(
    'goal:planning-alice', 600, 45, 80, 120, 'phase4a-planning-alice-init'
  )
);
insert into planning_results values (
  'alice-replay',
  pg_temp.initialize_growth_plan_fixture_v1(
    'goal:planning-alice', 600, 45, 80, 120, 'phase4a-planning-alice-init'
  )
);
reset role;

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '26000000-0000-4000-8000-000000000002',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text,
  true
);
set local role authenticated;
insert into planning_results values (
  'bob-bootstrap',
  api.bootstrap_personal_workspace('phase4a-planning-bob', 'Planning Bob')
);
insert into planning_results
select 'bob-goal', api.create_readiness_goal(
  (select (response->>'workspace_id')::uuid from planning_results
   where result_name = 'bob-bootstrap'),
  'goal:planning-bob', 'Bob durable Growth Plan',
  'target:nvidia-python-verification-base-v1', 'phase4a-planning-bob-goal'
);
reset role;

select is(
  (select response->>'projectionState' from planning_results where result_name = 'alice-init'),
  'PENDING',
  'initialization truthfully reports a pending Planning projection'
);
select is(
  (select response from planning_results where result_name = 'alice-replay'),
  (select response from planning_results where result_name = 'alice-init'),
  'an exact idempotent replay returns the stored response'
);

select is(
  (
    select count(*)::bigint
    from planning.growth_plans as plan
    where plan.workspace_id = (
      select (response->>'workspace_id')::uuid from planning_results
      where result_name = 'alice-bootstrap'
    )
      and plan.lifecycle = 'active'
      and plan.title = 'Alice durable Growth Plan'
      and plan.weekly_capacity_minutes = 600
      and plan.aggregate_version = 1
  ),
  1::bigint,
  'initialization persists one authoritative current Growth Plan'
);

select is(
  (
    select count(*)::bigint
    from planning.learning_tracks as track
    join planning_results as result on result.result_name = 'alice-init'
    where track.workspace_id = (result.response->>'workspaceId')::uuid
      and track.growth_plan_id = (result.response->>'growthPlanId')::uuid
      and track.learning_track_id = (result.response->>'learningTrackId')::uuid
      and track.track_key = result.response->>'learningTrackKey'
      and track.readiness_goal_id = (result.response->>'readinessGoalId')::uuid
      and track.profile_version_id = (result.response->>'profileVersionId')::uuid
      and track.priority = 80
      and track.protected_minimum_minutes = 120
      and track.default_session_minutes = 45
      and track.aggregate_version = 1
  ),
  1::bigint,
  'the first Track maps directly to the exact goal/profile and planner fields'
);

select is(
  (
    select count(*)::bigint
    from planning.current_plan_snapshots as pointer
    where pointer.workspace_id = (
      select (response->>'workspaceId')::uuid from planning_results
      where result_name = 'alice-init'
    )
      and pointer.snapshot_id is null
      and pointer.pointer_version = 0
      and pointer.applied_attempt_id is null
  ),
  1::bigint,
  'initialization creates one coherent nullable snapshot sentinel'
);

select is(
  (
    select count(*)::bigint
    from outbox.command_receipts as receipt
    where receipt.command_id = (
      select (response->>'commandId')::uuid from planning_results
      where result_name = 'alice-init'
    )
      and receipt.command_type = 'planning.initialize_growth_plan'
      and receipt.command_status = 'completed'
  ),
  1::bigint,
  'initialization completes exactly one durable command receipt'
);

select is(
  (
    select count(*)::bigint
    from outbox.events as event
    join planning_results as result on result.result_name = 'alice-init'
    where event.event_id = (result.response->'emittedEventIds'->>0)::uuid
      and event.workspace_id = (result.response->>'workspaceId')::uuid
      and event.event_name = 'planning.input_changed'
      and event.event_schema_version = 1
      and event.aggregate_type = 'planning.growth_plan'
      and event.payload ?& array[
        'change_kind', 'growth_plan_id', 'growth_plan_version',
        'learning_track_id', 'learning_track_version',
        'readiness_goal_id', 'profile_version_id'
      ]
      and event.payload - array[
        'change_kind', 'growth_plan_id', 'growth_plan_version',
        'learning_track_id', 'learning_track_version',
        'readiness_goal_id', 'profile_version_id'
      ] = '{}'::jsonb
  ),
  1::bigint,
  'the minimal versioned event contains identifiers and no private plan body'
);

select is(
  (
    select count(*)::bigint
    from outbox.deliveries as delivery
    join planning_results as result on result.result_name = 'alice-init'
    where delivery.delivery_id = (result.response->>'planningDeliveryId')::uuid
      and delivery.event_id = (result.response->'emittedEventIds'->>0)::uuid
      and delivery.workspace_id = (result.response->>'workspaceId')::uuid
      and delivery.consumer_name = 'planning.plan_snapshot_v1'
      and delivery.handler_contract_version = 1
      and delivery.delivery_state = 'pending'
  ),
  1::bigint,
  'initialization creates one fixed durable Planning delivery'
);

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '26000000-0000-4000-8000-000000000001',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text,
  true
);
set local role authenticated;
select throws_ok(
  $$select pg_temp.initialize_growth_plan_fixture_v1(
    'goal:planning-alice', 601, 45, 80, 120, 'phase4a-planning-alice-init'
  )$$,
  '22023',
  'idempotency key reused with a different request',
  'reusing an idempotency key with changed semantic input is rejected'
);
select throws_ok(
  $$select pg_temp.initialize_growth_plan_fixture_v1(
    'goal:planning-alice', 600, 45, 80, 120, 'phase4a-planning-second-current'
  )$$,
  '23505',
  'a current Growth Plan already exists',
  'a second idempotency key cannot create another current Growth Plan'
);
select throws_ok(
  $$select pg_temp.initialize_growth_plan_fixture_v1(
    'goal:planning-alice', 120, 45, 80, 121, 'phase4a-planning-invalid-minimum'
  )$$,
  '22023',
  'protected minimum must fit weekly capacity',
  'protected Track capacity cannot exceed total weekly capacity'
);
reset role;

select is(
  (
    select count(*)::bigint from outbox.command_receipts
    where idempotency_key in (
      'phase4a-planning-second-current', 'phase4a-planning-invalid-minimum'
    )
  ),
  0::bigint,
  'rejected Planning commands leave no receipt'
);
select is(
  (
    select count(*)::bigint from outbox.events as event
    where event.workspace_id = (
      select (response->>'workspaceId')::uuid from planning_results where result_name = 'alice-init'
    ) and event.event_name = 'planning.input_changed'
  ),
  1::bigint,
  'replay and rejected commands leave exactly one Planning input event'
);
select is(
  (
    select count(*)::bigint from outbox.deliveries as delivery
    where delivery.workspace_id = (
      select (response->>'workspaceId')::uuid from planning_results where result_name = 'alice-init'
    ) and delivery.consumer_name = 'planning.plan_snapshot_v1'
  ),
  1::bigint,
  'replay and rejected commands leave exactly one Planning delivery'
);

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '26000000-0000-4000-8000-000000000002',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text,
  true
);
set local role authenticated;
select throws_ok(
  $$select pg_temp.initialize_growth_plan_fixture_v1(
    'goal:planning-alice', 600, 45, 80, 120, 'phase4a-planning-foreign-goal'
  )$$,
  '42501',
  'active readiness goal is not accessible',
  'a same-shaped goal key in another workspace is not observable'
);
reset role;

update targets.readiness_goals
set lifecycle = 'paused', aggregate_version = aggregate_version + 1,
  updated_at = clock_timestamp()
where readiness_goal_key = 'goal:planning-bob';

set local role authenticated;
select throws_ok(
  $$select pg_temp.initialize_growth_plan_fixture_v1(
    'goal:planning-bob', 600, 45, 80, 120, 'phase4a-planning-inactive-goal'
  )$$,
  '42501',
  'active readiness goal is not accessible',
  'an inactive owner goal cannot initialize Planning state'
);
reset role;

update targets.readiness_goals
set lifecycle = 'active', aggregate_version = aggregate_version + 1,
  updated_at = clock_timestamp()
where readiness_goal_key = 'goal:planning-bob';

create function public.fail_planning_event_for_test()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.event_name = 'planning.input_changed'
     and new.workspace_id::text = pg_catalog.current_setting('pando.test.fail_workspace', true) then
    raise exception using errcode = 'P0001', message = 'injected Planning outbox failure';
  end if;
  return new;
end
$function$;
create trigger fail_planning_event_for_test
before insert on outbox.events
for each row execute function public.fail_planning_event_for_test();

select set_config(
  'pando.test.fail_workspace',
  (select response->>'workspace_id' from planning_results where result_name = 'bob-bootstrap'),
  true
);
set local role authenticated;
select throws_ok(
  $$select pg_temp.initialize_growth_plan_fixture_v1(
    'goal:planning-bob', 600, 45, 80, 120, 'phase4a-planning-bob-fail'
  )$$,
  'P0001',
  'injected Planning outbox failure',
  'an outbox failure aborts the whole Planning command'
);
reset role;
drop trigger fail_planning_event_for_test on outbox.events;
drop function public.fail_planning_event_for_test();

select is(
  (
    select count(*)::bigint from planning.growth_plans as plan
    where plan.workspace_id = (
      select (response->>'workspace_id')::uuid from planning_results
      where result_name = 'bob-bootstrap'
    )
  ),
  0::bigint,
  'the injected failure leaves no Growth Plan'
);
select is(
  (
    select count(*)::bigint from planning.learning_tracks as track
    where track.workspace_id = (
      select (response->>'workspace_id')::uuid from planning_results
      where result_name = 'bob-bootstrap'
    )
  ),
  0::bigint,
  'the injected failure leaves no Learning Track'
);
select is(
  (
    select count(*)::bigint from planning.current_plan_snapshots as pointer
    where pointer.workspace_id = (
      select (response->>'workspace_id')::uuid from planning_results
      where result_name = 'bob-bootstrap'
    )
  ),
  0::bigint,
  'the injected failure leaves no pointer sentinel'
);
select is(
  (
    select count(*)::bigint from outbox.command_receipts as receipt
    where receipt.idempotency_key = 'phase4a-' || 'planning-bob-fail'
  ),
  0::bigint,
  'the injected failure leaves no command receipt'
);
select is(
  (
    select count(*)::bigint from outbox.events as event
    where event.workspace_id = (
      select (response->>'workspace_id')::uuid from planning_results
      where result_name = 'bob-bootstrap'
    )
      and event.event_name = 'planning.input_changed'
  ),
  0::bigint,
  'the injected failure leaves no Planning event'
);

-- Every new workspace table receives a positive and negative RLS isolation proof.
select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '26000000-0000-4000-8000-000000000002',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text,
  true
);
set local role authenticated;
insert into planning_results values (
  'bob-init',
  pg_temp.initialize_growth_plan_fixture_v1(
    'goal:planning-bob', 480, 30, 70, 90, 'phase4a-planning-bob-init'
  )
);
reset role;

insert into overlay.custom_activities (
  custom_activity_id, workspace_id, profile_version_id, activity_key, title,
  activity_type, target_competency_ref
) values
  (
    '26000000-0000-4000-8000-000000000201',
    (select (response->>'workspaceId')::uuid from planning_results where result_name = 'alice-init'),
    (select (response->>'profileVersionId')::uuid from planning_results where result_name = 'alice-init'),
    'activity:planning-alice', 'Alice Planning activity',
    'PROJECT', 'competency:python-error-handling'
  ),
  (
    '26000000-0000-4000-8000-000000000202',
    (select (response->>'workspaceId')::uuid from planning_results where result_name = 'bob-init'),
    (select (response->>'profileVersionId')::uuid from planning_results where result_name = 'bob-init'),
    'activity:planning-bob', 'Bob Planning activity',
    'PROJECT', 'competency:python-error-handling'
  );

insert into planning.learning_track_activities (
  workspace_id, growth_plan_id, learning_track_id, custom_activity_id,
  candidate_key, estimated_minutes, energy
) values
  (
    (select (response->>'workspaceId')::uuid from planning_results where result_name = 'alice-init'),
    (select (response->>'growthPlanId')::uuid from planning_results where result_name = 'alice-init'),
    (select (response->>'learningTrackId')::uuid from planning_results where result_name = 'alice-init'),
    '26000000-0000-4000-8000-000000000201',
    'candidate:planning-alice', 45, 'MEDIUM'
  ),
  (
    (select (response->>'workspaceId')::uuid from planning_results where result_name = 'bob-init'),
    (select (response->>'growthPlanId')::uuid from planning_results where result_name = 'bob-init'),
    (select (response->>'learningTrackId')::uuid from planning_results where result_name = 'bob-init'),
    '26000000-0000-4000-8000-000000000202',
    'candidate:planning-bob', 30, null
  );

insert into planning.plan_snapshots (
  snapshot_id, workspace_id, growth_plan_id, input_fingerprint,
  engine_version, policy_version, calculated_as_of, valid_until,
  time_zone, week_start, week_end, recommendation_state, result
) values
  (
    '26000000-0000-4000-8000-000000000301',
    (select (response->>'workspaceId')::uuid from planning_results where result_name = 'alice-init'),
    (select (response->>'growthPlanId')::uuid from planning_results where result_name = 'alice-init'),
    'planning-input:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'planner-engine/0.1.0', 'planning-policy/0.1',
    '2026-08-28T00:00:00Z', '2026-08-28T01:00:00Z', 'UTC',
    '2026-08-24T00:00:00Z', '2026-08-31T00:00:00Z', 'NO_CANDIDATES',
    '{
      "engineVersion":"planner-engine/0.1.0",
      "policyVersion":"planning-policy/0.1",
      "inputFingerprint":"planning-input:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "calculatedAsOf":"2026-08-28T00:00:00Z",
      "validUntil":"2026-08-28T01:00:00Z",
      "timeZone":"UTC",
      "weekStart":"2026-08-24T00:00:00Z",
      "weekEnd":"2026-08-31T00:00:00Z",
      "recommendationState":"NO_CANDIDATES"
    }'::jsonb
  ),
  (
    '26000000-0000-4000-8000-000000000302',
    (select (response->>'workspaceId')::uuid from planning_results where result_name = 'bob-init'),
    (select (response->>'growthPlanId')::uuid from planning_results where result_name = 'bob-init'),
    'planning-input:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    'planner-engine/0.1.0', 'planning-policy/0.1',
    '2026-08-28T00:00:00Z', '2026-08-28T01:00:00Z', 'UTC',
    '2026-08-24T00:00:00Z', '2026-08-31T00:00:00Z', 'NO_CANDIDATES',
    '{
      "engineVersion":"planner-engine/0.1.0",
      "policyVersion":"planning-policy/0.1",
      "inputFingerprint":"planning-input:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "calculatedAsOf":"2026-08-28T00:00:00Z",
      "validUntil":"2026-08-28T01:00:00Z",
      "timeZone":"UTC",
      "weekStart":"2026-08-24T00:00:00Z",
      "weekEnd":"2026-08-31T00:00:00Z",
      "recommendationState":"NO_CANDIDATES"
    }'::jsonb
  );

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '26000000-0000-4000-8000-000000000001',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text,
  true
);
do $planning_test_role$
begin
  execute pg_catalog.format(
    'grant pando_planning_api to %I with set true',
    current_user
  );
end
$planning_test_role$;
set local role pando_planning_api;
select is(
  (select count(*)::bigint from planning.growth_plans),
  1::bigint,
  'Growth Plan RLS exposes Alice state and hides Bob state'
);
select is(
  (select count(*)::bigint from planning.learning_tracks),
  1::bigint,
  'Learning Track RLS exposes Alice state and hides Bob state'
);
select is(
  (select count(*)::bigint from planning.learning_track_activities),
  1::bigint,
  'track activity RLS exposes Alice state and hides Bob state'
);
select is(
  (select count(*)::bigint from planning.plan_snapshots),
  1::bigint,
  'PlanSnapshot RLS exposes Alice state and hides Bob state'
);
select is(
  (select count(*)::bigint from planning.current_plan_snapshots),
  1::bigint,
  'current snapshot RLS exposes Alice state and hides Bob state'
);
select throws_like(
  pg_catalog.format(
    'insert into planning.growth_plans (
       growth_plan_id, workspace_id, title, lifecycle, weekly_capacity_minutes
     ) values (%L::uuid, %L::uuid, %L, %L, 1)',
    '26000000-0000-4000-8000-000000000401',
    (select response->>'workspaceId' from planning_results where result_name = 'bob-init'),
    'Forbidden foreign plan',
    'archived'
  ),
  '%row-level security policy for table "growth_plans"%',
  'Planning RLS WITH CHECK rejects an Alice write into Bob workspace'
);
select throws_like(
  pg_catalog.format(
    'insert into planning.learning_tracks (
       learning_track_id, workspace_id, growth_plan_id, track_key, title,
       readiness_goal_id, profile_version_id, priority,
       protected_minimum_minutes, default_session_minutes
     ) values (
       %L::uuid, %L::uuid, %L::uuid, %L, %L,
       %L::uuid, %L::uuid, 1, 0, 30
     )',
    '26000000-0000-4000-8000-000000000402',
    (select response->>'workspaceId' from planning_results where result_name = 'bob-init'),
    (select response->>'growthPlanId' from planning_results where result_name = 'bob-init'),
    'track:forbidden-bob',
    'Forbidden foreign track',
    (select response->>'readinessGoalId' from planning_results where result_name = 'bob-init'),
    (select response->>'profileVersionId' from planning_results where result_name = 'bob-init')
  ),
  '%row-level security policy for table "learning_tracks"%',
  'Planning RLS WITH CHECK rejects an Alice Track write into Bob workspace'
);
select throws_like(
  pg_catalog.format(
    'insert into planning.current_plan_snapshots (workspace_id) values (%L::uuid)',
    (select response->>'workspaceId' from planning_results where result_name = 'bob-init')
  ),
  '%row-level security policy for table "current_plan_snapshots"%',
  'Planning RLS WITH CHECK rejects an Alice pointer write into Bob workspace'
);
reset role;
do $planning_test_role$
begin
  execute pg_catalog.format('revoke pando_planning_api from %I', current_user);
end
$planning_test_role$;

select throws_like(
  pg_catalog.format(
    'insert into planning.growth_plans (
       growth_plan_id, workspace_id, title, weekly_capacity_minutes
     ) values (%L::uuid, %L::uuid, %L, 600)',
    '26000000-0000-4000-8000-000000000101',
    (select response->>'workspaceId' from planning_results where result_name = 'alice-init'),
    'Second current plan'
  ),
  '%one_current_growth_plan_per_workspace%',
  'the database rejects a second current Growth Plan'
);

select throws_ok(
  pg_catalog.format(
    'update planning.current_plan_snapshots set pointer_version = 2 where workspace_id = %L::uuid',
    (select response->>'workspaceId' from planning_results where result_name = 'alice-init')
  ),
  '40001',
  'current plan snapshot pointer must advance by one',
  'the current pointer cannot skip a version'
);

select throws_like(
  pg_catalog.format(
    'update planning.current_plan_snapshots
     set snapshot_id = %L::uuid, pointer_version = 1,
       applied_attempt_id = %L::uuid
     where workspace_id = %L::uuid',
    '26000000-0000-4000-8000-000000000302',
    '26000000-0000-4000-8000-000000000501',
    (select response->>'workspaceId' from planning_results where result_name = 'alice-init')
  ),
  '%current_plan_snapshot_fk%',
  'the current pointer cannot reference another workspace snapshot'
);

insert into planning.plan_snapshot_attempts (
  attempt_id, workspace_id, delivery_id, event_id, event_position, generation,
  attempt_state, claim_as_of, base_pointer_version, source_fence, normalized_input,
  input_fingerprint, valid_until, covered_delivery_ids, applied_pointer_version
)
select '26000000-0000-4000-8000-000000000502',
  (result.response->>'workspaceId')::uuid,
  (result.response->>'planningDeliveryId')::uuid,
  event.event_id, event.event_position, 1, 'APPLIED',
  '2026-08-31T12:00:00.000Z'::timestamptz, 0,
  'planning-source:test', '{}'::jsonb,
  'planning-input:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  '2026-08-31T13:00:00.000Z'::timestamptz,
  array[(result.response->>'planningDeliveryId')::uuid], 1
from planning_results as result
join outbox.deliveries as delivery
  on delivery.delivery_id = (result.response->>'planningDeliveryId')::uuid
join outbox.events as event on event.event_id = delivery.event_id
where result.result_name = 'alice-init';

update planning.current_plan_snapshots
set snapshot_id = '26000000-0000-4000-8000-000000000301',
  pointer_version = 1,
  applied_attempt_id = '26000000-0000-4000-8000-000000000502'
where workspace_id = (
  select (response->>'workspaceId')::uuid from planning_results where result_name = 'alice-init'
);

select throws_ok(
  $$update planning.plan_snapshots
    set recommendation_state = 'NO_CAPACITY'
    where snapshot_id = '26000000-0000-4000-8000-000000000301'$$,
  '55000',
  'plan snapshots are immutable',
  'an existing PlanSnapshot cannot be updated'
);
select throws_ok(
  $$delete from planning.plan_snapshots
    where snapshot_id = '26000000-0000-4000-8000-000000000301'$$,
  '55000',
  'plan snapshots are immutable',
  'an existing PlanSnapshot cannot be deleted'
);
select throws_ok(
  pg_catalog.format(
    'delete from planning.current_plan_snapshots where workspace_id = %L::uuid',
    (select response->>'workspaceId' from planning_results where result_name = 'alice-init')
  ),
  '55000',
  'current plan snapshot pointers cannot be deleted',
  'the current pointer sentinel cannot be deleted'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_trigger as trigger
    join pg_catalog.pg_class as class on class.oid = trigger.tgrelid
    join pg_catalog.pg_namespace as namespace on namespace.oid = class.relnamespace
    where namespace.nspname = 'planning'
      and class.relname = 'plan_snapshots'
      and trigger.tgname = 'plan_snapshots_are_immutable'
      and not trigger.tgisinternal
  ),
  'PlanSnapshot history has an explicit immutable-row guard'
);

update planning.growth_plans
set lifecycle = 'archived', aggregate_version = aggregate_version + 1,
  updated_at = clock_timestamp()
where growth_plan_id = (
  select (response->>'growthPlanId')::uuid from planning_results where result_name = 'alice-init'
);

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '26000000-0000-4000-8000-000000000001',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text,
  true
);
set local role authenticated;
insert into planning_results values (
  'alice-reinit',
  pg_temp.initialize_growth_plan_fixture_v1(
    'goal:planning-alice', 720, 60, 90, 180, 'phase4a-planning-alice-reinit'
  )
);
reset role;

select is(
  (
    select pointer_version from planning.current_plan_snapshots
    where workspace_id = (
      select (response->>'workspaceId')::uuid from planning_results where result_name = 'alice-reinit'
    )
      and snapshot_id is null
      and applied_attempt_id is null
  ),
  2::bigint,
  'reinitialization invalidates the archived plan snapshot with a monotonic nullable sentinel'
);
select is(
  (
    select count(*)::bigint from planning.growth_plans
    where workspace_id = (
      select (response->>'workspaceId')::uuid from planning_results where result_name = 'alice-reinit'
    )
      and lifecycle in ('active', 'paused')
      and growth_plan_id = (
        select (response->>'growthPlanId')::uuid from planning_results where result_name = 'alice-reinit'
      )
  ),
  1::bigint,
  'reinitialization leaves exactly one new current Growth Plan'
);

select * from finish();
rollback;
