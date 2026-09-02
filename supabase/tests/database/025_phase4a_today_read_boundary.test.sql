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
    'authenticated', 'api.get_today_workspace_v1()', 'EXECUTE'
  )
  and pg_catalog.has_function_privilege(
    'authenticated', 'api.start_focus_from_plan_v1(text,text)', 'EXECUTE'
  )
  and pg_catalog.has_function_privilege(
    'authenticated', 'api.get_focus_from_plan_v1(text)', 'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'anon', 'api.get_today_workspace_v1()', 'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'service_role', 'api.start_focus_from_plan_v1(text,text)', 'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'anon', 'api.get_focus_from_plan_v1(text)', 'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'service_role', 'api.get_focus_from_plan_v1(text)', 'EXECUTE'
  ),
  'Today read, Focus entry, and start boundaries are authenticated-only'
);

select ok(
  not pg_catalog.has_function_privilege(
    'authenticated', 'planning.read_today_workspace_v1(uuid,timestamptz)', 'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated', 'planning.resolve_today_action_v1(text)', 'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'service_role', 'planning.resolve_today_action_v1(text)', 'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated', 'planning.read_plan_action_selection_for_focus_v1(text)', 'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'service_role', 'planning.read_plan_action_selection_for_focus_v1(text)', 'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated',
    'sessions.read_planning_focus_source_v1(uuid,timestamptz,timestamptz,timestamptz)',
    'EXECUTE'
  ),
  'the classifier, resolver, and owner-source query remain private'
);

select ok(
  not pg_catalog.has_table_privilege(
    'authenticated', 'planning.plan_action_selections', 'SELECT'
  )
  and not pg_catalog.has_table_privilege(
    'authenticated', 'planning.plan_snapshot_attempts', 'SELECT'
  )
  and not pg_catalog.has_table_privilege(
    'pando_today_reader', 'planning.plan_snapshots', 'UPDATE'
  )
  and not pg_catalog.has_table_privilege(
    'pando_today_reader', 'outbox.deliveries', 'UPDATE'
  ),
  'Today adds no browser table access and its dedicated reader is read-only'
);

select ok(
  not pg_catalog.has_schema_privilege('pando_today_reader', 'planning', 'CREATE')
  and not pg_catalog.has_schema_privilege('pando_phase2_api', 'planning', 'CREATE')
  and not pg_catalog.has_schema_privilege('pando_planning_api', 'sessions', 'CREATE'),
  'temporary migration privileges are revoked'
);

select ok(
  pg_catalog.has_function_privilege(
    'pando_today_reader',
    'identity.read_planning_calendar_source_v1(uuid,timestamptz)',
    'EXECUTE'
  )
  and pg_catalog.has_function_privilege(
    'pando_planning_api',
    'planning.read_today_workspace_v1(uuid,timestamptz)',
    'EXECUTE'
  ),
  'the Today read chain has only its two explicit execute grants'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'planning.resolve_today_action_v1(text)'::pg_catalog.regprocedure
    ),
    'v_as_of := clock_timestamp()'
  ) > pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'planning.resolve_today_action_v1(text)'::pg_catalog.regprocedure
    ),
    'for update'
  )
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'api.start_focus_from_plan_v1(text,text)'::pg_catalog.regprocedure
    ),
    'v_now := clock_timestamp()'
  ) > pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'api.start_focus_from_plan_v1(text,text)'::pg_catalog.regprocedure
    ),
    'pg_advisory_xact_lock(pg_catalog.hashtextextended(v_workspace_id::text, 2))'
  ),
  'resolver expiry and Focus mutation clocks are sampled only after their lock waits'
);

select ok(
  procedure.prosecdef
  and 'search_path=""' = any(coalesce(procedure.proconfig, '{}'::text[]))
  and owner.rolname = expected.owner_name
  and not owner.rolcanlogin and not owner.rolinherit and not owner.rolbypassrls,
  pg_catalog.format('%s.%s is pinned to its bounded NOLOGIN owner',
    expected.schema_name, expected.function_name)
)
from (values
  ('planning', 'read_today_workspace_v1', 'pando_today_reader'),
  ('planning', 'resolve_today_action_v1', 'pando_planning_api'),
  ('planning', 'read_plan_action_selection_for_focus_v1', 'pando_planning_api'),
  ('sessions', 'is_exact_active_focus_for_planning_v1', 'pando_phase2_planning_source'),
  ('sessions', 'start_focus_session_from_plan_impl', 'pando_phase2_api')
) as expected(schema_name, function_name, owner_name)
join pg_catalog.pg_namespace as namespace on namespace.nspname = expected.schema_name
join pg_catalog.pg_proc as procedure
  on procedure.pronamespace = namespace.oid and procedure.proname = expected.function_name
join pg_catalog.pg_roles as owner on owner.oid = procedure.proowner
order by expected.schema_name, expected.function_name;

-- Isolate this scenario from seed-owned Planning work.
update outbox.deliveries
set delivery_state = 'succeeded', completed_at = clock_timestamp(),
  lease_token = null, lease_expires_at = null
where consumer_name = 'planning.plan_snapshot_v1'
  and delivery_state <> 'succeeded';

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'c6000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'today-a@pando.test', '', clock_timestamp(),
  '{"provider":"email","providers":["email"]}', '{}', clock_timestamp(), clock_timestamp()
), (
  'c6000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
  'today-b@pando.test', '', clock_timestamp(),
  '{"provider":"email","providers":["email"]}', '{}', clock_timestamp(), clock_timestamp()
);

create temporary table today_results (
  result_name text primary key,
  response jsonb not null
);
grant select, insert, update on today_results
  to authenticated, service_role, pando_planning_api, pando_phase2_api, pando_planning_worker,
  pando_today_reader;

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', 'c6000000-0000-4000-8000-000000000001',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text,
  true
);
set local role authenticated;
insert into today_results values (
  'bootstrap-a', api.bootstrap_personal_workspace('today-a', 'Today A')
);
insert into today_results
select 'goal-a', api.create_readiness_goal(
  (select (response->>'workspace_id')::uuid from today_results where result_name = 'bootstrap-a'),
  'goal:today-a', 'Today A goal',
  'target:nvidia-python-verification-base-v1', 'today-a-goal'
);
insert into today_results values (
  'plan-a', pg_temp.initialize_growth_plan_fixture_v1('goal:today-a', 300, 25, 80, 60, 'today-a-plan')
);
insert into today_results values (
  'overlay-a', api.add_current_custom_activity_v1(
    'goal:today-a', 'activity:today-debug', 'Debug a Python failure',
    'MANUAL_CODING', 'competency:python-error-handling', '0', 'today-a-overlay'
  )
);
insert into today_results values (
  'admission-a', pando_test.add_learning_track_activity_fixture_v1(
    (select response->>'learningTrackKey' from today_results where result_name = 'plan-a'),
    'activity:today-debug', 25, '1', 'today-a-admission', 'MEDIUM'
  )
);
reset role;

set local role authenticated;
insert into today_results values ('today-before-first-snapshot', api.get_today_workspace_v1());
reset role;
select ok(
  (select response->>'projectionState' = 'PENDING'
     and response->>'reason' = 'INPUTS_CHANGED'
     and not (response->>'lastKnownSafe')::boolean
     and response->'currentInputFingerprint' = 'null'::jsonb
     and response->'snapshot' = 'null'::jsonb
     and response->'actionSelections' = '[]'::jsonb
   from today_results where result_name = 'today-before-first-snapshot'),
  'pending before the first calculation exposes no fabricated fingerprint or snapshot'
);

-- A second personal workspace has no Planning sentinel and proves tenancy plus NOT_STARTED.
select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', 'c6000000-0000-4000-8000-000000000002',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text,
  true
);
set local role authenticated;
insert into today_results values (
  'bootstrap-b', api.bootstrap_personal_workspace('today-b', 'Today B')
);
insert into today_results values ('today-b', api.get_today_workspace_v1());
reset role;

select is(
  (select response->>'projectionState' from today_results where result_name = 'today-b'),
  'NOT_STARTED',
  'a workspace without a Planning sentinel is NOT_STARTED'
);
select ok(
  (select response->>'reason' = 'INITIALIZING'
     and response->'snapshot' = 'null'::jsonb
     and response->'actionSelections' = '[]'::jsonb
   from today_results where result_name = 'today-b'),
  'NOT_STARTED returns the exact non-authoritative shape'
);

-- Apply a real one-action snapshot through the worker, not by hand-building selector rows.
select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', 'c6000000-0000-4000-8000-000000000001',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text,
  true
);
set local role service_role;
insert into today_results
select 'claim-one', pg_catalog.to_jsonb(claim)
from api.claim_plan_snapshot_projection_v1() as claim;
insert into today_results
select 'load-one', api.load_plan_snapshot_projection_v1(
  (select (response->>'delivery_id')::uuid from today_results where result_name = 'claim-one'),
  (select (response->>'lease_token')::uuid from today_results where result_name = 'claim-one'),
  (select (response->>'attempt_id')::uuid from today_results where result_name = 'claim-one')
);
insert into today_results
select 'record-one', pg_catalog.to_jsonb(api.record_plan_snapshot_input_v1(
  (select (response->>'delivery_id')::uuid from today_results where result_name = 'claim-one'),
  (select (response->>'lease_token')::uuid from today_results where result_name = 'claim-one'),
  (select (response->>'attemptId')::uuid from today_results where result_name = 'load-one'),
  (select response->>'sourceFence' from today_results where result_name = 'load-one'),
  pg_catalog.jsonb_build_object(
    'completedWorkPolicyVersion', 'planning-completed-work/0.2',
    'inputFingerprint',
      'planning-input:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    'evaluationHorizon', pg_catalog.jsonb_build_object(
      'asOf', (select response->'claimAsOf' from today_results where result_name = 'load-one'),
      'validUntil', (select response#>'{sourceBundle,calendar,validUntil}'
        from today_results where result_name = 'load-one'),
      'timeZone', (select response#>'{sourceBundle,calendar,timeZone}'
        from today_results where result_name = 'load-one'),
      'weekStart', (select response#>'{sourceBundle,calendar,weekStart}'
        from today_results where result_name = 'load-one'),
      'weekEnd', (select response#>'{sourceBundle,calendar,weekEnd}'
        from today_results where result_name = 'load-one')
    ),
    'growthPlan', pg_catalog.jsonb_build_object(
      'growthPlanId', (select response->>'growthPlanId'
        from today_results where result_name = 'plan-a'),
      'version', '1', 'lifecycle', 'ACTIVE', 'weeklyCapacityMinutes', 300,
      'consumedMinutesThisWeek', 0,
      'tracks', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'trackId', (select response->>'learningTrackId'
          from today_results where result_name = 'plan-a'),
        'version', '2', 'lifecycle', 'ACTIVE', 'priority', 80,
        'protectedMinimumMinutes', 60, 'cadencePerWeek', 0,
        'completedCadenceSessionsThisWeek', 0
      ))
    )
  )
));
insert into today_results
select 'complete-one', pg_catalog.to_jsonb(api.complete_plan_snapshot_projection_v1(
  (select (response->>'delivery_id')::uuid from today_results where result_name = 'claim-one'),
  (select (response->>'lease_token')::uuid from today_results where result_name = 'claim-one'),
  (select (response->>'attemptId')::uuid from today_results where result_name = 'load-one'),
  pg_catalog.jsonb_build_object(
    'engineVersion', 'planner-engine/0.2.0',
    'policyVersion', 'planning-policy/0.2',
    'inputFingerprint',
      'planning-input:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    'calculatedAsOf', (select response->'claimAsOf'
      from today_results where result_name = 'load-one'),
    'validUntil', (select response#>'{sourceBundle,calendar,validUntil}'
      from today_results where result_name = 'load-one'),
    'timeZone', (select response#>'{sourceBundle,calendar,timeZone}'
      from today_results where result_name = 'load-one'),
    'weekStart', (select response#>'{sourceBundle,calendar,weekStart}'
      from today_results where result_name = 'load-one'),
    'weekEnd', (select response#>'{sourceBundle,calendar,weekEnd}'
      from today_results where result_name = 'load-one'),
    'recommendationState', 'CURRENT',
    'warningCodes', '[]'::jsonb,
    'capacity', pg_catalog.jsonb_build_object(
      'weeklyCapacityMinutes', 300, 'consumedMinutesThisWeek', 0,
      'remainingMinutesThisWeek', 300, 'sessionLimitMinutes', null
    ),
    'reviewSummary', pg_catalog.jsonb_build_object(
      'projectionState', 'NOT_STARTED', 'overdueCount', 0,
      'dueTodayCount', 0, 'validUntil', null
    ),
    'nearestDeadline', null,
    'readiness', '[]'::jsonb,
    'actions', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'rank', 1, 'actionKind', 'START',
      'candidateKey', (select response->>'candidateKey'
        from today_results where result_name = 'admission-a'),
      'focusSessionId', null, 'readinessGoalKey', 'goal:today-a',
      'activityKey', 'activity:today-debug',
      'trackId', (select response->>'learningTrackId'
        from today_results where result_name = 'plan-a'),
      'planAttribution', null, 'title', 'Debug a Python failure',
      'durationMinutes', 25, 'durationSource', 'PLANNING_ACTIVITY',
      'energy', 'MEDIUM', 'sourceSignals', pg_catalog.jsonb_build_array('GROWTH_PLAN'),
      'score', 0, 'scoreFactors', '[]'::jsonb, 'reasonRefs', '[]'::jsonb,
      'expectedBenefit', 'ADVANCE_GROWTH_TRACK',
      'reason', 'Advances the active growth track.'
    ))
  )
));
reset role;

set local role authenticated;
insert into today_results values ('today-current', api.get_today_workspace_v1());
insert into today_results
select 'focus-entry-current', api.get_focus_from_plan_v1(
  (select response#>>'{actionSelections,0,selectionRef}'
   from today_results where result_name = 'today-current')
);
reset role;

select ok(
  (select response->>'projectionState' = 'CURRENT'
     and response->>'reason' is null
     and (response->>'lastKnownSafe')::boolean
     and pg_catalog.jsonb_array_length(response->'actionSelections') = 1
     and response#>>'{snapshot,plan,recommendationState}' = 'CURRENT'
   from today_results where result_name = 'today-current'),
  'Today exposes an exact current snapshot and its one opaque selector'
);
select is(
  (select response#>>'{actionSelections,0,candidateKey}'
   from today_results where result_name = 'today-current'),
  (select response->>'candidateKey' from today_results where result_name = 'admission-a'),
  'the safe candidate correlation matches the embedded action'
);
select ok(
  (select response#>>'{contract,name}' = 'FocusFromPlanWorkspaceV1'
     and response#>>'{contract,version}' = '1.0.0'
     and response->>'entryState' = 'READY_TO_START'
     and (response->>'plannedMinutes')::integer = 25
     and response#>>'{workspace,readinessGoalKey}' = 'goal:today-a'
     and response#>>'{workspace,activity,activityKey}' = 'activity:today-debug'
     and response#>'{workspace,activeSession}' = 'null'::jsonb
     and not (response ? 'planSnapshotId')
     and not (response ? 'candidateKey')
     and not (response ? 'learningTrackId')
   from today_results where result_name = 'focus-entry-current'),
  'the Focus entry exposes only a display-safe current START projection'
);

-- Internal query clocks prove the inclusive expiry boundary without exposing an asOf argument.
do $test_roles$
begin
  execute pg_catalog.format(
    'grant pando_planning_api, pando_planning_worker, pando_phase2_api, pando_today_reader to %I with set true',
    current_user
  );
end
$test_roles$;
set local role pando_today_reader;
insert into today_results
select 'reader-own-rls', pg_catalog.jsonb_build_object('count', count(*))
from planning.plan_snapshots
where workspace_id = (
  select (response->>'workspaceId')::uuid from today_results where result_name = 'plan-a'
);
reset role;
select ok(
  (select (response->>'count')::integer > 0
   from today_results where result_name = 'reader-own-rls'),
  'Today reader sees projection rows for the authenticated workspace'
);
select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', 'c6000000-0000-4000-8000-000000000002',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text,
  true
);
set local role pando_today_reader;
insert into today_results
select 'reader-foreign-rls', pg_catalog.jsonb_build_object('count', count(*))
from planning.plan_snapshots
where workspace_id = (
  select (response->>'workspaceId')::uuid from today_results where result_name = 'plan-a'
);
reset role;
select is(
  (select (response->>'count')::bigint
   from today_results where result_name = 'reader-foreign-rls'),
  0::bigint,
  'Today reader RLS hides another workspace projection rows'
);
select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', 'c6000000-0000-4000-8000-000000000001',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text,
  true
);
set local role pando_planning_api;
insert into today_results
select 'today-at-expiry', planning.read_today_workspace_v1(
  (select (response->>'workspaceId')::uuid from today_results where result_name = 'plan-a'),
  snapshot.valid_until
)
from planning.plan_snapshots as snapshot
join planning.current_plan_snapshots as pointer
  on pointer.workspace_id = snapshot.workspace_id and pointer.snapshot_id = snapshot.snapshot_id
where snapshot.workspace_id = (
  select (response->>'workspaceId')::uuid from today_results where result_name = 'plan-a'
);
insert into today_results
select 'today-after-expiry', planning.read_today_workspace_v1(
  (select (response->>'workspaceId')::uuid from today_results where result_name = 'plan-a'),
  snapshot.valid_until + interval '1 millisecond'
)
from planning.plan_snapshots as snapshot
join planning.current_plan_snapshots as pointer
  on pointer.workspace_id = snapshot.workspace_id and pointer.snapshot_id = snapshot.snapshot_id
where snapshot.workspace_id = (
  select (response->>'workspaceId')::uuid from today_results where result_name = 'plan-a'
);
reset role;

set local role pando_phase2_api;
insert into today_results
select 'resolved-start', planning.resolve_today_action_v1(
  (select response#>>'{actionSelections,0,selectionRef}'
   from today_results where result_name = 'today-current')
);
select throws_ok(
  $$select planning.resolve_today_action_v1(
    'plan-action:c6000000-0000-4000-8000-000000000099'
  )$$,
  '42501', 'plan action selection is unavailable',
  'the private resolver fails closed for a guessed selector'
);
reset role;

select ok(
  (select response->>'actionKind' = 'START'
     and response->>'readinessGoalKey' = 'goal:today-a'
     and response->>'activityKey' = 'activity:today-debug'
     and (response->>'plannedMinutes')::integer = 25
     and response->>'candidateKey' = (
       select response->>'candidateKey' from today_results where result_name = 'admission-a'
     )
   from today_results where result_name = 'resolved-start'),
  'the private resolver returns the exact authoritative START tuple'
);

select is(
  (select response->>'projectionState' from today_results where result_name = 'today-at-expiry'),
  'CURRENT',
  'the exact validUntil instant remains current'
);
select ok(
  (select response->>'projectionState' = 'PENDING'
     and response->>'reason' = 'INPUTS_CHANGED'
     and response->'snapshot' = 'null'::jsonb
     and response->'actionSelections' = '[]'::jsonb
   from today_results where result_name = 'today-after-expiry'),
  'a due refresh one millisecond after expiry takes precedence and returns no snapshot or selectors'
);

-- A foreign workspace cannot use or enumerate the selector.
select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', 'c6000000-0000-4000-8000-000000000002',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text,
  true
);
set local role authenticated;
select throws_ok(
  pg_catalog.format(
    'select api.start_focus_from_plan_v1(%L,%L)',
    (select response#>>'{actionSelections,0,selectionRef}'
     from today_results where result_name = 'today-current'),
    'today-foreign-start'
  ),
  '42501', 'plan action selection is unavailable',
  'a foreign workspace receives the same unavailable selector error'
);
select throws_ok(
  pg_catalog.format(
    'select api.get_focus_from_plan_v1(%L)',
    (select response#>>'{actionSelections,0,selectionRef}'
     from today_results where result_name = 'today-current')
  ),
  '42501', 'plan action selection is unavailable',
  'a foreign workspace cannot preview or enumerate the Focus selector'
);
reset role;

-- Owner START persists exact attribution and makes the previous Today snapshot display-only.
select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', 'c6000000-0000-4000-8000-000000000001',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text,
  true
);

insert into today_results values (
  'atomic-start-before',
  pg_catalog.jsonb_build_object(
    'receipts', (select count(*) from outbox.command_receipts),
    'sessions', (select count(*) from sessions.focus_sessions),
    'attempts', (select count(*) from evidence.activity_attempts),
    'events', (select count(*) from outbox.events),
    'deliveries', (select count(*) from outbox.deliveries)
  )
);
create function pg_temp.reject_today_planning_delivery()
returns trigger
language plpgsql
set search_path = ''
as $test_failure$
begin
  raise exception using errcode = 'P0001', message = 'injected planning delivery failure';
end
$test_failure$;
create trigger reject_today_planning_delivery
before insert on outbox.deliveries
for each row
when (
  new.consumer_name = 'planning.plan_snapshot_v1'
  and new.handler_contract_version = 1
)
execute function pg_temp.reject_today_planning_delivery();
set local role authenticated;
select throws_ok(
  pg_catalog.format(
    'select api.start_focus_from_plan_v1(%L,%L)',
    (select response#>>'{actionSelections,0,selectionRef}'
     from today_results where result_name = 'today-current'),
    'today-injected-rollback'
  ),
  'P0001', 'injected planning delivery failure',
  'a routed delivery failure aborts the entire plan-to-Focus command'
);
reset role;
drop trigger reject_today_planning_delivery on outbox.deliveries;
insert into today_results values (
  'atomic-start-after',
  pg_catalog.jsonb_build_object(
    'receipts', (select count(*) from outbox.command_receipts),
    'sessions', (select count(*) from sessions.focus_sessions),
    'attempts', (select count(*) from evidence.activity_attempts),
    'events', (select count(*) from outbox.events),
    'deliveries', (select count(*) from outbox.deliveries)
  )
);
select is(
  (select response from today_results where result_name = 'atomic-start-after'),
  (select response from today_results where result_name = 'atomic-start-before'),
  'failed plan-to-Focus start leaves no receipt, session, attempt, event, or delivery'
);
set local role authenticated;
insert into today_results
select 'start-one', api.start_focus_from_plan_v1(
  (select response#>>'{actionSelections,0,selectionRef}'
   from today_results where result_name = 'today-current'),
  'today-start-one'
);
insert into today_results values ('today-pending', api.get_today_workspace_v1());
insert into today_results
select 'focus-entry-after-start', api.get_focus_from_plan_v1(
  (select response#>>'{actionSelections,0,selectionRef}'
   from today_results where result_name = 'today-current')
);
insert into today_results
select 'start-replay', api.start_focus_from_plan_v1(
  (select response#>>'{actionSelections,0,selectionRef}'
   from today_results where result_name = 'today-current'),
  'today-start-one'
);
select throws_ok(
  pg_catalog.format(
    'select api.start_focus_from_plan_v1(%L,%L)',
    (select response#>>'{actionSelections,0,selectionRef}'
     from today_results where result_name = 'today-current'),
    'today-stale-new-key'
  ),
  '40001', 'plan action selection is not current',
  'a captured selector cannot bypass PENDING Today state'
);
select throws_ok(
  $$select api.start_focus_from_plan_v1(
    'plan-action:c6000000-0000-4000-8000-000000000099', 'today-start-one'
  )$$,
  '22023', 'idempotency key reused with a different request',
  'an idempotency key cannot be reused with another selector'
);
reset role;

select is(
  (select response from today_results where result_name = 'start-replay'),
  (select response from today_results where result_name = 'start-one'),
  'an exact completed replay succeeds after the selection becomes non-current'
);
select ok(
  (select response->>'projectionState' = 'PENDING'
     and response->>'reason' = 'INPUTS_CHANGED'
     and (response->>'lastKnownSafe')::boolean
     and response->'actionSelections' = '[]'::jsonb
   from today_results where result_name = 'today-pending'),
  'pending Today returns the prior snapshot for display only'
);
select ok(
  (select response->>'entryState' = 'ACTIVE'
     and response#>>'{workspace,activeSession,focusSessionId}' = (
       select response->>'focusSessionId' from today_results where result_name = 'start-one'
     )
     and (response#>>'{workspace,activeSession,plannedMinutes}')::integer = 25
   from today_results where result_name = 'focus-entry-after-start'),
  'the original START selector reloads only its exact attributed active Focus session'
);
select ok(
  exists (
    select 1
    from outbox.events as event
    join outbox.deliveries as delivery
      on delivery.workspace_id = event.workspace_id and delivery.event_id = event.event_id
    where event.aggregate_id = (
      select (response->>'focusSessionId')::uuid
      from today_results where result_name = 'start-one'
    )
      and event.event_name = 'sessions.focus_started'
      and delivery.consumer_name = 'planning.plan_snapshot_v1'
      and delivery.handler_contract_version = 1
      and delivery.delivery_state = 'pending'
  ),
  'Focus start and its fixed Planning delivery commit atomically'
);

-- Recalculate the Focus-start wake-up into a real RESUME recommendation.
set local role service_role;
insert into today_results
select 'claim-resume', pg_catalog.to_jsonb(claim)
from api.claim_plan_snapshot_projection_v1() as claim;
insert into today_results
select 'load-resume', api.load_plan_snapshot_projection_v1(
  (select (response->>'delivery_id')::uuid from today_results where result_name = 'claim-resume'),
  (select (response->>'lease_token')::uuid from today_results where result_name = 'claim-resume'),
  (select (response->>'attempt_id')::uuid from today_results where result_name = 'claim-resume')
);
insert into today_results
select 'record-resume', pg_catalog.to_jsonb(api.record_plan_snapshot_input_v1(
  (select (response->>'delivery_id')::uuid from today_results where result_name = 'claim-resume'),
  (select (response->>'lease_token')::uuid from today_results where result_name = 'claim-resume'),
  (select (response->>'attemptId')::uuid from today_results where result_name = 'load-resume'),
  (select response->>'sourceFence' from today_results where result_name = 'load-resume'),
  pg_catalog.jsonb_build_object(
    'completedWorkPolicyVersion', 'planning-completed-work/0.2',
    'inputFingerprint',
      'planning-input:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    'evaluationHorizon', pg_catalog.jsonb_build_object(
      'asOf', (select response->'claimAsOf' from today_results where result_name = 'load-resume'),
      'validUntil', (select response#>'{sourceBundle,calendar,validUntil}'
        from today_results where result_name = 'load-resume'),
      'timeZone', (select response#>'{sourceBundle,calendar,timeZone}'
        from today_results where result_name = 'load-resume'),
      'weekStart', (select response#>'{sourceBundle,calendar,weekStart}'
        from today_results where result_name = 'load-resume'),
      'weekEnd', (select response#>'{sourceBundle,calendar,weekEnd}'
        from today_results where result_name = 'load-resume')
    ),
    'growthPlan', pg_catalog.jsonb_build_object(
      'growthPlanId', (select response->>'growthPlanId'
        from today_results where result_name = 'plan-a'),
      'version', '1', 'lifecycle', 'ACTIVE', 'weeklyCapacityMinutes', 300,
      'consumedMinutesThisWeek', 0,
      'tracks', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'trackId', (select response->>'learningTrackId'
          from today_results where result_name = 'plan-a'),
        'version', '2', 'lifecycle', 'ACTIVE', 'priority', 80,
        'protectedMinimumMinutes', 60, 'cadencePerWeek', 0,
        'completedCadenceSessionsThisWeek', 0
      ))
    )
  )
));
insert into today_results
select 'complete-resume', pg_catalog.to_jsonb(api.complete_plan_snapshot_projection_v1(
  (select (response->>'delivery_id')::uuid from today_results where result_name = 'claim-resume'),
  (select (response->>'lease_token')::uuid from today_results where result_name = 'claim-resume'),
  (select (response->>'attemptId')::uuid from today_results where result_name = 'load-resume'),
  pg_catalog.jsonb_build_object(
    'engineVersion', 'planner-engine/0.2.0',
    'policyVersion', 'planning-policy/0.2',
    'inputFingerprint',
      'planning-input:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    'calculatedAsOf', (select response->'claimAsOf'
      from today_results where result_name = 'load-resume'),
    'validUntil', (select response#>'{sourceBundle,calendar,validUntil}'
      from today_results where result_name = 'load-resume'),
    'timeZone', (select response#>'{sourceBundle,calendar,timeZone}'
      from today_results where result_name = 'load-resume'),
    'weekStart', (select response#>'{sourceBundle,calendar,weekStart}'
      from today_results where result_name = 'load-resume'),
    'weekEnd', (select response#>'{sourceBundle,calendar,weekEnd}'
      from today_results where result_name = 'load-resume'),
    'recommendationState', 'CURRENT', 'warningCodes', '[]'::jsonb,
    'capacity', pg_catalog.jsonb_build_object(
      'weeklyCapacityMinutes', 300, 'consumedMinutesThisWeek', 0,
      'remainingMinutesThisWeek', 300, 'sessionLimitMinutes', null
    ),
    'reviewSummary', pg_catalog.jsonb_build_object(
      'projectionState', 'NOT_STARTED', 'overdueCount', 0,
      'dueTodayCount', 0, 'validUntil', null
    ),
    'nearestDeadline', null, 'readiness', '[]'::jsonb,
    'actions', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'rank', 1, 'actionKind', 'RESUME',
      'candidateKey', 'active-focus:' || (
        select response->>'focusSessionId' from today_results where result_name = 'start-one'
      ),
      'focusSessionId', (select response->>'focusSessionId'
        from today_results where result_name = 'start-one'),
      'readinessGoalKey', 'goal:today-a', 'activityKey', 'activity:today-debug',
      'trackId', (select response->>'learningTrackId'
        from today_results where result_name = 'plan-a'),
      'planAttribution', (select response->'planAttribution'
        from today_results where result_name = 'start-one'),
      'title', 'Debug a Python failure', 'durationMinutes', 25,
      'durationSource', 'ACTIVE_FOCUS', 'energy', null,
      'sourceSignals', pg_catalog.jsonb_build_array('ACTIVE_FOCUS'),
      'score', 0, 'scoreFactors', '[]'::jsonb, 'reasonRefs', '[]'::jsonb,
      'expectedBenefit', 'RESUME_ACTIVE_FOCUS',
      'reason', 'Resume the active Focus session.'
    ))
  )
));
reset role;

set local role authenticated;
insert into today_results values ('today-resume', api.get_today_workspace_v1());
insert into today_results
select 'focus-entry-resume', api.get_focus_from_plan_v1(
  (select response#>>'{actionSelections,0,selectionRef}'
   from today_results where result_name = 'today-resume')
);
reset role;
set local role pando_phase2_api;
insert into today_results
select 'resolved-resume', planning.resolve_today_action_v1(
  (select response#>>'{actionSelections,0,selectionRef}'
   from today_results where result_name = 'today-resume')
);
reset role;
select ok(
  (select response->>'actionKind' = 'RESUME'
     and response->>'focusSessionId' = (
       select response->>'focusSessionId' from today_results where result_name = 'start-one'
     )
   from today_results where result_name = 'resolved-resume'),
  'RESUME resolves only to the exact still-active Focus session'
);
select ok(
  (select response->>'entryState' = 'ACTIVE'
     and response#>>'{workspace,activeSession,focusSessionId}' = (
       select response->>'focusSessionId' from today_results where result_name = 'start-one'
     )
   from today_results where result_name = 'focus-entry-resume'),
  'RESUME opens the exact existing Focus session without a mutation'
);

-- A normalized terminal failure returns ERROR with the current fingerprint and display-only plan.
update outbox.deliveries as delivery
set available_at = clock_timestamp()
from outbox.events as event, planning.current_plan_snapshots as pointer
where delivery.event_id = event.event_id
  and delivery.workspace_id = pointer.workspace_id
  and delivery.consumer_name = 'planning.plan_snapshot_v1'
  and delivery.delivery_state = 'pending'
  and event.event_name = 'planning.snapshot_refresh_scheduled'
  and event.payload->>'source_snapshot_id' = pointer.snapshot_id::text;
set local role authenticated;
select throws_ok(
  pg_catalog.format(
    'select api.get_focus_from_plan_v1(%L)',
    (select response#>>'{actionSelections,0,selectionRef}'
     from today_results where result_name = 'today-resume')
  ),
  '40001', 'plan action selection is not current',
  'a RESUME selector is refused as soon as Today becomes non-current'
);
reset role;
set local role service_role;
insert into today_results
select 'claim-error', pg_catalog.to_jsonb(claim)
from api.claim_plan_snapshot_projection_v1() as claim;
insert into today_results
select 'load-error', api.load_plan_snapshot_projection_v1(
  (select (response->>'delivery_id')::uuid from today_results where result_name = 'claim-error'),
  (select (response->>'lease_token')::uuid from today_results where result_name = 'claim-error'),
  (select (response->>'attempt_id')::uuid from today_results where result_name = 'claim-error')
);
insert into today_results
select 'record-error', pg_catalog.to_jsonb(api.record_plan_snapshot_input_v1(
  (select (response->>'delivery_id')::uuid from today_results where result_name = 'claim-error'),
  (select (response->>'lease_token')::uuid from today_results where result_name = 'claim-error'),
  (select (response->>'attemptId')::uuid from today_results where result_name = 'load-error'),
  (select response->>'sourceFence' from today_results where result_name = 'load-error'),
  pg_catalog.jsonb_build_object(
    'completedWorkPolicyVersion', 'planning-completed-work/0.2',
    'inputFingerprint',
      'planning-input:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    'evaluationHorizon', pg_catalog.jsonb_build_object(
      'asOf', (select response->'claimAsOf' from today_results where result_name = 'load-error'),
      'validUntil', (select response#>'{sourceBundle,calendar,validUntil}'
        from today_results where result_name = 'load-error'),
      'timeZone', (select response#>'{sourceBundle,calendar,timeZone}'
        from today_results where result_name = 'load-error'),
      'weekStart', (select response#>'{sourceBundle,calendar,weekStart}'
        from today_results where result_name = 'load-error'),
      'weekEnd', (select response#>'{sourceBundle,calendar,weekEnd}'
        from today_results where result_name = 'load-error')
    ),
    'growthPlan', pg_catalog.jsonb_build_object(
      'growthPlanId', (select response->>'growthPlanId'
        from today_results where result_name = 'plan-a'),
      'version', '1', 'lifecycle', 'ACTIVE', 'weeklyCapacityMinutes', 300,
      'consumedMinutesThisWeek', 0,
      'tracks', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'trackId', (select response->>'learningTrackId'
          from today_results where result_name = 'plan-a'),
        'version', '2', 'lifecycle', 'ACTIVE', 'priority', 80,
        'protectedMinimumMinutes', 60, 'cadencePerWeek', 0,
        'completedCadenceSessionsThisWeek', 0
      ))
    )
  )
));
insert into today_results
select 'fail-error', pg_catalog.to_jsonb(api.fail_plan_snapshot_projection_v1(
  (select (response->>'delivery_id')::uuid from today_results where result_name = 'claim-error'),
  (select (response->>'lease_token')::uuid from today_results where result_name = 'claim-error'),
  (select (response->>'attemptId')::uuid from today_results where result_name = 'load-error'),
  'INVALID_CONTRACT', 'TODAY_TEST_FAILURE'
));
reset role;
set local role authenticated;
insert into today_results values ('today-error', api.get_today_workspace_v1());
reset role;
select ok(
  (select response->>'projectionState' = 'ERROR'
     and response->>'reason' = 'CALCULATION_FAILED'
     and (response->>'lastKnownSafe')::boolean
     and response->>'currentInputFingerprint' =
       'planning-input:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
     and response->'snapshot' is not null
     and response->'actionSelections' = '[]'::jsonb
   from today_results where result_name = 'today-error'),
  'failed normalized work returns an exact fingerprint and display-only last-known-safe plan'
);
select ok(
  exists (
    select 1
    from sessions.focus_sessions as session
    join planning.plan_snapshots as snapshot
      on snapshot.workspace_id = session.workspace_id
     and snapshot.snapshot_id = session.plan_snapshot_id
    where session.focus_session_id = (
      select (response->>'focusSessionId')::uuid
      from today_results where result_name = 'start-one'
    )
      and session.plan_candidate_key = (
        select response->>'candidateKey' from today_results where result_name = 'admission-a'
      )
      and session.plan_learning_track_id = (
        select (response->>'learningTrackId')::uuid
        from today_results where result_name = 'plan-a'
      )
  ),
  'Sessions persists exact snapshot, candidate, and single-track attribution'
);
select is(
  (select count(*)::integer
   from sessions.focus_sessions as session
   where session.workspace_id = (
     select (response->>'workspaceId')::uuid from today_results where result_name = 'plan-a'
   )),
  1,
  'replay and stale-selector refusal create no duplicate Focus session'
);
-- The Sessions-owned source exposes only bounded attribution, not a Planning table grant.
set local role pando_planning_worker;
insert into today_results
select 'focus-source', sessions.read_planning_focus_source_v1(
  (select (response->>'workspaceId')::uuid from today_results where result_name = 'plan-a'),
  (select (response#>>'{sourceBundle,calendar,weekStart}')::timestamptz
   from today_results where result_name = 'load-one'),
  (select (response#>>'{sourceBundle,calendar,weekEnd}')::timestamptz
   from today_results where result_name = 'load-one'),
  clock_timestamp()
);
reset role;
select ok(
  (select response#>>'{activeFocus,planAttribution,planSnapshotId}' =
      (select response#>>'{planAttribution,planSnapshotId}'
       from today_results where result_name = 'start-one')
     and response#>>'{activeFocus,planAttribution,candidateKey}' =
      (select response->>'candidateKey'
       from today_results where result_name = 'admission-a')
   from today_results where result_name = 'focus-source'),
  'the bounded Sessions source preserves active Focus plan attribution'
);

-- A newer owner event supersedes the old failure. Its normalized attempt must expose its exact
-- fingerprint even though the historical dead letter remains immutable, and successful completion
-- must advance back to CURRENT rather than leaving Today sticky in ERROR.
set local role authenticated;
insert into today_results
select 'finish-for-recovery', api.finish_focus_activity_v1(
  (select (response->>'focusSessionId')::uuid
   from today_results where result_name = 'start-one'),
  1, 'STOP', null, null, 'today-finish-for-recovery'
);
insert into today_results values ('today-recovery-pending', api.get_today_workspace_v1());
select throws_ok(
  pg_catalog.format(
    'select api.get_focus_from_plan_v1(%L)',
    (select response#>>'{actionSelections,0,selectionRef}'
     from today_results where result_name = 'today-current')
  ),
  '40001', 'plan action selection is not current',
  'an ended attributed session removes post-start selector continuity'
);
reset role;
select ok(
  (select response->>'projectionState' = 'PENDING'
     and response->>'reason' = 'INPUTS_CHANGED'
     and response->'currentInputFingerprint' = 'null'::jsonb
   from today_results where result_name = 'today-recovery-pending'),
  'a newer active owner event supersedes the historical failed attempt'
);

set local role service_role;
insert into today_results
select 'claim-recovery', pg_catalog.to_jsonb(claim)
from api.claim_plan_snapshot_projection_v1() as claim;
insert into today_results
select 'load-recovery', api.load_plan_snapshot_projection_v1(
  (select (response->>'delivery_id')::uuid
   from today_results where result_name = 'claim-recovery'),
  (select (response->>'lease_token')::uuid
   from today_results where result_name = 'claim-recovery'),
  (select (response->>'attempt_id')::uuid
   from today_results where result_name = 'claim-recovery')
);
insert into today_results
select 'record-recovery', pg_catalog.to_jsonb(api.record_plan_snapshot_input_v1(
  (select (response->>'delivery_id')::uuid
   from today_results where result_name = 'claim-recovery'),
  (select (response->>'lease_token')::uuid
   from today_results where result_name = 'claim-recovery'),
  (select (response->>'attemptId')::uuid
   from today_results where result_name = 'load-recovery'),
  (select response->>'sourceFence'
   from today_results where result_name = 'load-recovery'),
  pg_catalog.jsonb_build_object(
    'completedWorkPolicyVersion', 'planning-completed-work/0.2',
    'inputFingerprint',
      'planning-input:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    'evaluationHorizon', pg_catalog.jsonb_build_object(
      'asOf', (select response->'claimAsOf'
        from today_results where result_name = 'load-recovery'),
      'validUntil', (select response#>'{sourceBundle,calendar,validUntil}'
        from today_results where result_name = 'load-recovery'),
      'timeZone', (select response#>'{sourceBundle,calendar,timeZone}'
        from today_results where result_name = 'load-recovery'),
      'weekStart', (select response#>'{sourceBundle,calendar,weekStart}'
        from today_results where result_name = 'load-recovery'),
      'weekEnd', (select response#>'{sourceBundle,calendar,weekEnd}'
        from today_results where result_name = 'load-recovery')
    ),
    'growthPlan', pg_catalog.jsonb_build_object(
      'growthPlanId', (select response->>'growthPlanId'
        from today_results where result_name = 'plan-a'),
      'version', '1', 'lifecycle', 'ACTIVE', 'weeklyCapacityMinutes', 300,
      'consumedMinutesThisWeek', 0,
      'tracks', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'trackId', (select response->>'learningTrackId'
          from today_results where result_name = 'plan-a'),
        'version', '2', 'lifecycle', 'ACTIVE', 'priority', 80,
        'protectedMinimumMinutes', 60, 'cadencePerWeek', 0,
        'completedCadenceSessionsThisWeek', 0
      ))
    )
  )
));
reset role;
set local role authenticated;
insert into today_results values ('today-recovery-normalized', api.get_today_workspace_v1());
reset role;
select ok(
  (select response->>'projectionState' = 'PENDING'
     and response->>'reason' = 'INPUTS_CHANGED'
     and response->>'currentInputFingerprint' =
       'planning-input:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
   from today_results where result_name = 'today-recovery-normalized'),
  'a newer normalized attempt reports its fingerprint despite an old dead letter'
);

set local role service_role;
insert into today_results
select 'complete-recovery', pg_catalog.to_jsonb(api.complete_plan_snapshot_projection_v1(
  (select (response->>'delivery_id')::uuid
   from today_results where result_name = 'claim-recovery'),
  (select (response->>'lease_token')::uuid
   from today_results where result_name = 'claim-recovery'),
  (select (response->>'attemptId')::uuid
   from today_results where result_name = 'load-recovery'),
  pg_catalog.jsonb_set(
    pg_catalog.jsonb_set(
      (select response#>'{snapshot,plan}'
       from today_results where result_name = 'today-current'),
      '{inputFingerprint}',
      pg_catalog.to_jsonb(
        'planning-input:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'::text
      )
    ),
    '{calculatedAsOf}',
    (select response->'claimAsOf'
     from today_results where result_name = 'load-recovery')
  )
));
reset role;
set local role authenticated;
insert into today_results values ('today-recovered', api.get_today_workspace_v1());
reset role;
select ok(
  (select response->>'projectionState' = 'CURRENT'
     and response->>'reason' is null
     and response->>'currentInputFingerprint' =
       'planning-input:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
   from today_results where result_name = 'today-recovered'),
  'successful recalculation advances Today back to CURRENT after the old failure'
);

-- Legacy and ordinary Focus sessions have no plan attribution. Their pre-C6 revision tuple must
-- stay byte-for-byte stable so deploying this migration cannot silently stale an existing pointer.
set local role authenticated;
insert into today_results values (
  'legacy-null-attribution-focus', api.start_focus_activity_v1(
    'goal:today-a', 'activity:today-debug', 10::smallint, 'today-legacy-null-attribution'
  )
);
reset role;
set local role pando_planning_worker;
insert into today_results
select 'legacy-null-attribution-source', sessions.read_planning_focus_source_v1(
  (select (response->>'workspaceId')::uuid
   from today_results where result_name = 'plan-a'),
  (select (response#>>'{sourceBundle,calendar,weekStart}')::timestamptz
   from today_results where result_name = 'load-recovery'),
  (select (response#>>'{sourceBundle,calendar,weekEnd}')::timestamptz
   from today_results where result_name = 'load-recovery'),
  (select (response->>'claimAsOf')::timestamptz
   from today_results where result_name = 'load-recovery')
);
reset role;
select ok(
  (select response#>'{activeFocus,planAttribution}' = 'null'::jsonb
   from today_results where result_name = 'legacy-null-attribution-source'),
  'an ordinary Focus session remains explicitly unattributed'
);
select is(
  (select response->>'revision'
   from today_results where result_name = 'legacy-null-attribution-source'),
  (
    select 'focus-scope:' || pg_catalog.encode(extensions.digest(
      pg_catalog.convert_to(coalesce(pg_catalog.jsonb_agg(
        case when session.plan_snapshot_id is null then
          pg_catalog.jsonb_build_array(
            session.focus_session_id, session.aggregate_version, session.state,
            session.started_at, session.ended_at
          )
        else
          pg_catalog.jsonb_build_array(
            session.focus_session_id, session.aggregate_version, session.state,
            session.started_at, session.ended_at, session.plan_snapshot_id,
            session.plan_candidate_key, session.plan_learning_track_id
          )
        end order by session.focus_session_id
      )::text, '[]'), 'UTF8'), 'sha256'), 'hex')
    from sessions.focus_sessions as session
    where session.workspace_id = (
      select (response->>'workspaceId')::uuid
      from today_results where result_name = 'plan-a'
    )
      and (
        session.state = 'active'
        or (
          session.ended_at >= (
            select (response#>>'{sourceBundle,calendar,weekStart}')::timestamptz
            from today_results where result_name = 'load-recovery'
          )
          and session.ended_at < (
            select (response#>>'{sourceBundle,calendar,weekEnd}')::timestamptz
            from today_results where result_name = 'load-recovery'
          )
        )
      )
  ),
  'the Focus source uses the legacy five-field revision tuple for unattributed rows'
);

select * from finish();
rollback;
