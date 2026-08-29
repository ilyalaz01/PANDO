begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

select ok(
  pg_catalog.has_function_privilege(
    'service_role', 'api.claim_plan_snapshot_projection_v1()', 'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated', 'api.claim_plan_snapshot_projection_v1()', 'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'anon', 'api.claim_plan_snapshot_projection_v1()', 'EXECUTE'
  ),
  'only the service boundary can claim Planning snapshot work'
);

select ok(
  bool_and(class.relrowsecurity and class.relforcerowsecurity)
  and count(*) = 3,
  'all Planning worker tables have enabled and forced RLS'
)
from pg_catalog.pg_class as class
join pg_catalog.pg_namespace as namespace on namespace.oid = class.relnamespace
where namespace.nspname = 'planning'
  and class.relname in (
    'plan_snapshot_attempts', 'plan_snapshot_delivery_ledger', 'plan_action_selections'
  );

select ok(
  not pg_catalog.has_table_privilege(
    'service_role', 'planning.plan_snapshot_attempts', 'SELECT'
  )
  and not pg_catalog.has_table_privilege(
    'authenticated', 'planning.plan_snapshot_delivery_ledger', 'SELECT'
  )
  and not pg_catalog.has_table_privilege(
    'service_role', 'planning.plan_action_selections', 'INSERT'
  ),
  'runtime roles cannot bypass the Planning worker RPC boundary'
);

select ok(
  pg_catalog.has_function_privilege(
    'pando_planning_worker',
    'targets.read_planning_readiness_source_v1(uuid,uuid[],uuid[],timestamptz)',
    'EXECUTE'
  )
  and pg_catalog.has_function_privilege(
    'pando_planning_worker',
    'overlay.read_planning_candidate_source_v1(uuid,uuid[])',
    'EXECUTE'
  )
  and not pg_catalog.has_table_privilege(
    'pando_planning_worker', 'targets.readiness_goals', 'SELECT'
  )
  and not pg_catalog.has_table_privilege(
    'pando_planning_worker', 'overlay.custom_activities', 'SELECT'
  ),
  'Planning uses owner queries and has no cross-context table reads'
);

-- Isolate this worker scenario from any seed-owned Planning wake-ups.
update outbox.deliveries
set delivery_state = 'succeeded', completed_at = clock_timestamp(),
  lease_token = null, lease_expires_at = null
where consumer_name = 'planning.plan_snapshot_v1'
  and delivery_state <> 'succeeded';

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '2a000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'planning-worker@pando.test', '', clock_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  clock_timestamp(), clock_timestamp()
);

create temporary table worker_results (
  result_name text primary key,
  response jsonb not null
);
grant select, insert, update on worker_results to authenticated, service_role;
grant select on worker_results to pando_planning_api, pando_planning_worker;

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '2a000000-0000-4000-8000-000000000001',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text,
  true
);
set local role authenticated;
insert into worker_results values (
  'bootstrap', api.bootstrap_personal_workspace('phase4a-worker', 'Planning Worker')
);
insert into worker_results
select 'goal', api.create_readiness_goal(
  (select (response->>'workspace_id')::uuid from worker_results
   where result_name = 'bootstrap'),
  'goal:planning-worker', 'Planning worker goal',
  'target:nvidia-python-verification-base-v1', 'phase4a-worker-goal'
);
insert into worker_results values (
  'plan', api.initialize_growth_plan_v1(
    'goal:planning-worker', 300, 25, 80, 60, 'phase4a-worker-plan'
  )
);
insert into worker_results values (
  'overlay', api.add_current_custom_activity_v1(
    'goal:planning-worker', 'activity:planning-worker-debug',
    'Debug a Python failure', 'MANUAL_CODING', 'competency:python-error-handling',
    '0', 'phase4a-worker-overlay'
  )
);
insert into worker_results values (
  'admission', api.add_learning_track_activity_v1(
    (select response->>'learningTrackKey' from worker_results where result_name = 'plan'),
    'activity:planning-worker-debug', 25, '1', 'phase4a-worker-admission', 'MEDIUM'
  )
);
reset role;

set local role service_role;
insert into worker_results
select 'claim', pg_catalog.to_jsonb(claim)
from api.claim_plan_snapshot_projection_v1() as claim;

select is(
  (select count(*)::integer from worker_results where result_name = 'claim'),
  1,
  'the worker claims at most one due delivery for the workspace'
);

select is(
  (select count(*)::integer from api.claim_plan_snapshot_projection_v1()),
  0,
  'a second wake-up cannot lease later work while the workspace already has an active lease'
);

insert into worker_results
select 'load', api.load_plan_snapshot_projection_v1(
  (select (response->>'delivery_id')::uuid from worker_results where result_name = 'claim'),
  (select (response->>'lease_token')::uuid from worker_results where result_name = 'claim'),
  (select (response->>'attempt_id')::uuid from worker_results where result_name = 'claim')
);

select is(
  (select response#>>'{sourceBundle,plan,activities,0,candidateKey}'
   from worker_results where result_name = 'load'),
  (select response->>'candidateKey' from worker_results where result_name = 'admission'),
  'the bounded owner bundle contains the admitted active candidate'
);
select is(
  (select pg_catalog.jsonb_array_length(response#>'{sourceBundle,visibleDeliveryIds}')
   from worker_results where result_name = 'load'),
  3,
  'the attempt captures plan initialization, Overlay change, and admission deliveries'
);

select throws_ok(
  pg_catalog.format(
    'select api.fail_plan_snapshot_projection_v1(%L::uuid,%L::uuid,%L::uuid,%L,%L)',
    (select response->>'delivery_id' from worker_results where result_name = 'claim'),
    (select response->>'lease_token' from worker_results where result_name = 'claim'),
    '2a000000-0000-4000-8000-000000000099',
    'TRANSIENT',
    'WRONG_ATTEMPT_TEST'
  ),
  '42501',
  'planning attempt is not active',
  'failure handling cannot terminalize a delivery for a different attempt'
);

reset role;
select is(
  (select delivery.delivery_state from outbox.deliveries as delivery
   where delivery.delivery_id = (
     select (response->>'delivery_id')::uuid from worker_results where result_name = 'claim'
   )),
  'leased',
  'a rejected failure keeps the valid lease and attempt available to its worker'
);
set local role service_role;

insert into worker_results
select 'record', pg_catalog.to_jsonb(api.record_plan_snapshot_input_v1(
  (select (response->>'delivery_id')::uuid from worker_results where result_name = 'claim'),
  (select (response->>'lease_token')::uuid from worker_results where result_name = 'claim'),
  (select (response->>'attemptId')::uuid from worker_results where result_name = 'load'),
  (select response->>'sourceFence' from worker_results where result_name = 'load'),
  pg_catalog.jsonb_build_object(
    'inputFingerprint',
      'planning-input:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'evaluationHorizon', pg_catalog.jsonb_build_object(
      'asOf', (select response->'claimAsOf' from worker_results where result_name = 'load'),
      'validUntil', (select response#>'{sourceBundle,calendar,validUntil}'
        from worker_results where result_name = 'load'),
      'timeZone', (select response#>'{sourceBundle,calendar,timeZone}'
        from worker_results where result_name = 'load'),
      'weekStart', (select response#>'{sourceBundle,calendar,weekStart}'
        from worker_results where result_name = 'load'),
      'weekEnd', (select response#>'{sourceBundle,calendar,weekEnd}'
        from worker_results where result_name = 'load')
    ),
    'growthPlan', pg_catalog.jsonb_build_object(
      'growthPlanId', (select response->>'growthPlanId' from worker_results where result_name = 'plan')
    )
  )
));

insert into worker_results
select 'complete', pg_catalog.to_jsonb(api.complete_plan_snapshot_projection_v1(
  (select (response->>'delivery_id')::uuid from worker_results where result_name = 'claim'),
  (select (response->>'lease_token')::uuid from worker_results where result_name = 'claim'),
  (select (response->>'attemptId')::uuid from worker_results where result_name = 'load'),
  pg_catalog.jsonb_build_object(
    'engineVersion', 'planner-engine/0.1.0',
    'policyVersion', 'planning-policy/0.1',
    'inputFingerprint',
      'planning-input:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'calculatedAsOf', (select response->'claimAsOf' from worker_results where result_name = 'load'),
    'validUntil', (select response#>'{sourceBundle,calendar,validUntil}'
      from worker_results where result_name = 'load'),
    'timeZone', (select response#>'{sourceBundle,calendar,timeZone}'
      from worker_results where result_name = 'load'),
    'weekStart', (select response#>'{sourceBundle,calendar,weekStart}'
      from worker_results where result_name = 'load'),
    'weekEnd', (select response#>'{sourceBundle,calendar,weekEnd}'
      from worker_results where result_name = 'load'),
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
      'rank', 1,
      'actionKind', 'START',
      'candidateKey', (select response->>'candidateKey'
        from worker_results where result_name = 'admission'),
      'focusSessionId', null,
      'readinessGoalKey', 'goal:planning-worker',
      'activityKey', 'activity:planning-worker-debug',
      'trackId', (select response->>'learningTrackId'
        from worker_results where result_name = 'plan'),
      'planAttribution', null,
      'title', 'Debug a Python failure',
      'durationMinutes', 25,
      'durationSource', 'PLANNING_ACTIVITY',
      'energy', 'MEDIUM',
      'sourceSignals', pg_catalog.jsonb_build_array('GROWTH_PLAN'),
      'score', 0,
      'scoreFactors', '[]'::jsonb,
      'reasonRefs', '[]'::jsonb,
      'expectedBenefit', 'ADVANCE_GROWTH_TRACK',
      'reason', 'Advances the active growth track.'
    ))
  )
));
reset role;

select is(
  (select response#>>'{}' from worker_results where result_name = 'complete'),
  'APPLIED',
  'verified completion applies one immutable snapshot'
);
select is(
  (select pointer.pointer_version::integer
   from planning.current_plan_snapshots as pointer
   where pointer.workspace_id = (
     select (response->>'workspaceId')::uuid from worker_results where result_name = 'plan'
   )),
  1,
  'successful completion advances the sentinel pointer exactly once'
);
select is(
  (select count(*)::integer from planning.plan_snapshot_delivery_ledger as ledger
   where ledger.workspace_id = (
      select (response->>'workspaceId')::uuid from worker_results where result_name = 'plan'
    ) and ledger.coverage_state = 'COVERED'),
  3,
  'completion covers the exact captured input deliveries'
);
select is(
  (select count(*)::integer from outbox.deliveries as delivery
   where delivery.workspace_id = (
     select (response->>'workspaceId')::uuid from worker_results where result_name = 'plan'
    ) and delivery.consumer_name = 'planning.plan_snapshot_v1'
      and delivery.delivery_state = 'succeeded'),
  3,
  'covered deliveries are terminal and have durable receipts'
);
select ok(
  exists (
    select 1 from outbox.deliveries as delivery
    join outbox.events as event on event.event_id = delivery.event_id
    join planning.plan_snapshot_delivery_ledger as ledger
      on ledger.delivery_id = delivery.delivery_id
    where delivery.workspace_id = (
      select (response->>'workspaceId')::uuid from worker_results where result_name = 'plan'
    ) and event.event_name = 'planning.snapshot_refresh_scheduled'
      and delivery.available_at =
        (event.payload->>'valid_until')::timestamptz + interval '1 millisecond'
      and ledger.coverage_state = 'UNCOVERED'
  ),
  'completion creates one exact future refresh delivery and ledger row'
);
select is(
  (select count(*)::integer from planning.plan_action_selections),
  1,
  'a real non-zero-action snapshot creates its immutable opaque selector'
);

do $test_role_membership$
begin
  execute pg_catalog.format('grant pando_planning_api to %I with set true', current_user);
end
$test_role_membership$;

set local role pando_planning_api;
select is(
  (select count(*)::integer from planning.plan_action_selections),
  1,
  'the workspace member can read its opaque action selector through the Planning role'
);
reset role;

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '2a000000-0000-4000-8000-000000000094',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text,
  true
);
set local role pando_planning_api;
select is(
  (select count(*)::integer from planning.plan_action_selections),
  0,
  'a non-member cannot read another workspace action selector'
);
reset role;

insert into planning.plan_snapshot_attempts (
  workspace_id, delivery_id, event_id, event_position, generation, claim_as_of,
  base_pointer_version, scheduled_source_snapshot_id
)
select delivery.workspace_id, delivery.delivery_id, delivery.event_id, event.event_position,
  8, clock_timestamp() - interval '3 minutes', pointer.pointer_version,
  (event.payload->>'source_snapshot_id')::uuid
from outbox.deliveries as delivery
join outbox.events as event on event.event_id = delivery.event_id
join planning.current_plan_snapshots as pointer on pointer.workspace_id = delivery.workspace_id
join planning.plan_snapshot_delivery_ledger as ledger
  on ledger.delivery_id = delivery.delivery_id and ledger.coverage_state = 'UNCOVERED'
where event.event_name = 'planning.snapshot_refresh_scheduled'
order by delivery.delivery_id
limit 1;

update outbox.deliveries as delivery
set delivery_state = 'leased', attempt_count = 8,
  lease_token = '2a000000-0000-4000-8000-000000000098',
  lease_expires_at = clock_timestamp() - interval '1 second',
  available_at = clock_timestamp() - interval '3 minutes'
where exists (
  select 1 from planning.plan_snapshot_attempts as attempt
  where attempt.delivery_id = delivery.delivery_id and attempt.generation = 8
);

set local role service_role;
select is(
  (select count(*)::integer from api.claim_plan_snapshot_projection_v1()),
  0,
  'an expired eighth lease is terminalized and never reclaimed'
);
reset role;

select ok(
  exists (
    select 1 from outbox.deliveries as delivery
    join planning.plan_snapshot_attempts as attempt
      on attempt.delivery_id = delivery.delivery_id and attempt.generation = 8
    where delivery.delivery_state = 'dead_letter'
      and delivery.last_failure_class = 'EXHAUSTED'
      and delivery.last_error_code = 'LEASE_EXPIRED_AFTER_MAX_ATTEMPTS'
      and attempt.attempt_state = 'FAILED'
      and attempt.failure_class = 'EXHAUSTED'
      and attempt.error_code = 'LEASE_EXPIRED_AFTER_MAX_ATTEMPTS'
  ),
  'lease exhaustion atomically terminalizes both the delivery and its active attempt'
);

insert into outbox.events (
  event_id, event_name, event_schema_version, workspace_id, aggregate_type,
  aggregate_id, aggregate_version, actor_type, actor_user_id, command_id,
  correlation_id, causation_id, occurred_at, source, payload, metadata
)
select '2a000000-0000-4000-8000-000000000097', event.event_name,
  event.event_schema_version, event.workspace_id, event.aggregate_type,
  event.aggregate_id, event.aggregate_version, event.actor_type, event.actor_user_id,
  event.command_id, event.correlation_id, event.causation_id, clock_timestamp(),
  event.source, event.payload, event.metadata
from outbox.events as event
where event.event_name = 'planning.snapshot_refresh_scheduled'
order by event.event_position
limit 1;

insert into outbox.deliveries (
  delivery_id, event_id, workspace_id, consumer_name, handler_contract_version,
  attempt_count, available_at
)
select '2a000000-0000-4000-8000-000000000096', event.event_id, event.workspace_id,
  'planning.plan_snapshot_v1', 1, 7, clock_timestamp()
from outbox.events as event
where event.event_id = '2a000000-0000-4000-8000-000000000097';

set local role service_role;
insert into worker_results
select 'stale_claim', pg_catalog.to_jsonb(claim)
from api.claim_plan_snapshot_projection_v1() as claim;
insert into worker_results
select 'stale_load', api.load_plan_snapshot_projection_v1(
  (select (response->>'delivery_id')::uuid from worker_results where result_name = 'stale_claim'),
  (select (response->>'lease_token')::uuid from worker_results where result_name = 'stale_claim'),
  (select (response->>'attempt_id')::uuid from worker_results where result_name = 'stale_claim')
);
insert into worker_results
select 'stale_record', pg_catalog.to_jsonb(api.record_plan_snapshot_input_v1(
  (select (response->>'delivery_id')::uuid from worker_results where result_name = 'stale_claim'),
  (select (response->>'lease_token')::uuid from worker_results where result_name = 'stale_claim'),
  (select (response->>'attemptId')::uuid from worker_results where result_name = 'stale_load'),
  (select response->>'sourceFence' from worker_results where result_name = 'stale_load'),
  pg_catalog.jsonb_build_object(
    'inputFingerprint',
      'planning-input:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    'evaluationHorizon', pg_catalog.jsonb_build_object(
      'asOf', (select response->'claimAsOf' from worker_results where result_name = 'stale_load'),
      'validUntil', (select response#>'{sourceBundle,calendar,validUntil}'
        from worker_results where result_name = 'stale_load'),
      'timeZone', (select response#>'{sourceBundle,calendar,timeZone}'
        from worker_results where result_name = 'stale_load'),
      'weekStart', (select response#>'{sourceBundle,calendar,weekStart}'
        from worker_results where result_name = 'stale_load'),
      'weekEnd', (select response#>'{sourceBundle,calendar,weekEnd}'
        from worker_results where result_name = 'stale_load')
    ),
    'growthPlan', pg_catalog.jsonb_build_object(
      'growthPlanId', (select response->>'growthPlanId' from worker_results where result_name = 'plan')
    )
  )
));
reset role;

update planning.current_plan_snapshots
set pointer_version = pointer_version + 1, updated_at = clock_timestamp()
where workspace_id = (
  select (response->>'workspaceId')::uuid from worker_results where result_name = 'plan'
);

insert into worker_results
select 'stale_result', snapshot.result || pg_catalog.jsonb_build_object(
  'inputFingerprint',
    'planning-input:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
  'calculatedAsOf',
    (select response->'claimAsOf' from worker_results where result_name = 'stale_load'),
  'validUntil',
    (select response#>'{sourceBundle,calendar,validUntil}'
     from worker_results where result_name = 'stale_load')
)
from planning.current_plan_snapshots as pointer
join planning.plan_snapshots as snapshot
  on snapshot.workspace_id = pointer.workspace_id and snapshot.snapshot_id = pointer.snapshot_id
where pointer.workspace_id = (
  select (response->>'workspaceId')::uuid from worker_results where result_name = 'plan'
);

set local role service_role;
insert into worker_results
select 'stale_complete', pg_catalog.to_jsonb(api.complete_plan_snapshot_projection_v1(
  (select (response->>'delivery_id')::uuid from worker_results where result_name = 'stale_claim'),
  (select (response->>'lease_token')::uuid from worker_results where result_name = 'stale_claim'),
  (select (response->>'attemptId')::uuid from worker_results where result_name = 'stale_load'),
  (select response from worker_results where result_name = 'stale_result')
));
reset role;

select is(
  (select response#>>'{}' from worker_results where result_name = 'stale_complete'),
  'DEAD_LETTER',
  'a stale eighth completion is terminal instead of becoming an unclaimable retry'
);
select ok(
  exists (
    select 1 from outbox.deliveries as delivery
    join planning.plan_snapshot_attempts as attempt
      on attempt.delivery_id = delivery.delivery_id
    where delivery.delivery_id = '2a000000-0000-4000-8000-000000000096'
      and delivery.delivery_state = 'dead_letter'
      and delivery.last_error_code = 'STALE_PLANNING_INPUT_AFTER_MAX_ATTEMPTS'
      and attempt.attempt_state = 'FAILED'
      and attempt.failure_class = 'EXHAUSTED'
      and attempt.error_code = 'STALE_PLANNING_INPUT_AFTER_MAX_ATTEMPTS'
  ),
  'stale exhaustion atomically terminalizes the delivery and attempt'
);

select * from finish();
rollback;
