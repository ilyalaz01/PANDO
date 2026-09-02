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

do $planning_role$
begin
  execute pg_catalog.format(
    'grant pando_planning_worker to %I with set true', current_user
  );
end
$planning_role$;

select ok(
  not pg_catalog.has_function_privilege(
    runtime_role.role_name, private_function.signature, 'EXECUTE'
  ),
  pg_catalog.format('%s cannot execute private activation function %s',
    runtime_role.role_name, private_function.signature)
)
from (values ('anon'), ('authenticated'), ('service_role')) as runtime_role(role_name)
cross join (values
  ('planning.enqueue_plan_snapshot_v2_activation_v1(uuid)'),
  ('planning.plan_snapshot_v2_activation_event_is_valid_v1(outbox.events)')
) as private_function(signature)
order by runtime_role.role_name, private_function.signature;

update outbox.deliveries
set delivery_state = 'succeeded', completed_at = clock_timestamp(),
  lease_token = null, lease_expires_at = null
where consumer_name = 'planning.plan_snapshot_v1'
  and delivery_state <> 'succeeded';

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'f7000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'd2c-activation@pando.test', '', clock_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  clock_timestamp(), clock_timestamp()
);

create temporary table activation_results (
  result_name text primary key,
  response jsonb not null
);
grant select, insert, update on activation_results to authenticated, service_role;
grant select, insert, update on activation_results to pando_planning_worker;
grant select on activation_results to pando_planning_api;

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', 'f7000000-0000-4000-8000-000000000001',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text,
  true
);
set local role authenticated;
insert into activation_results values (
  'bootstrap', api.bootstrap_personal_workspace('d2c-activation', 'D2c Activation')
);
insert into activation_results
select 'goal', api.create_readiness_goal(
  (response->>'workspace_id')::uuid,
  'goal:d2c-activation', 'D2c activation goal',
  'target:nvidia-python-verification-base-v1', 'd2c-activation-goal'
)
from activation_results where result_name = 'bootstrap';
insert into activation_results values (
  'plan', pg_temp.initialize_growth_plan_fixture_v1(
    'goal:d2c-activation', 600, 45, 80, 120, 'd2c-activation-plan'
  )
);
reset role;

update planning.learning_tracks
set track_key = 'track:activation', title = 'Activation Track'
where learning_track_id = (
  select (response->>'learningTrackId')::uuid
  from activation_results where result_name = 'plan'
);
insert into overlay.workspace_overlays (workspace_id)
select (response->>'workspace_id')::uuid
from activation_results where result_name = 'bootstrap'
on conflict (workspace_id) do nothing;

-- Simulate a V1 generation that was leased before the activation migration committed.
update outbox.deliveries as delivery
set delivery_state = 'leased', attempt_count = 1,
  lease_token = 'f7000000-0000-4000-8000-000000000010',
  lease_expires_at = clock_timestamp() + interval '2 minutes',
  available_at = clock_timestamp()
where delivery.delivery_id = (
  select candidate.delivery_id
  from outbox.deliveries as candidate
  where candidate.workspace_id = (
    select (response->>'workspace_id')::uuid
    from activation_results where result_name = 'bootstrap'
  )
    and candidate.consumer_name = 'planning.plan_snapshot_v1'
    and candidate.delivery_state = 'pending'
  order by candidate.available_at, candidate.delivery_id
  limit 1
);

insert into planning.plan_snapshot_attempts (
  attempt_id, workspace_id, delivery_id, event_id, event_position, generation,
  claim_as_of, base_pointer_version, calculation_contract_version
)
select 'f7000000-0000-4000-8000-000000000011', delivery.workspace_id,
  delivery.delivery_id, delivery.event_id, event.event_position, 1,
  clock_timestamp(), pointer.pointer_version, 'planning-calculation/1'
from outbox.deliveries as delivery
join outbox.events as event on event.event_id = delivery.event_id
join planning.current_plan_snapshots as pointer on pointer.workspace_id = delivery.workspace_id
where delivery.lease_token = 'f7000000-0000-4000-8000-000000000010';
insert into activation_results
select 'v1-attempt', pg_catalog.jsonb_build_object('deliveryId', attempt.delivery_id)
from planning.plan_snapshot_attempts as attempt
where attempt.attempt_id = 'f7000000-0000-4000-8000-000000000011';

set local role service_role;
insert into activation_results values (
  'v1-load', api.load_plan_snapshot_projection_v1(
    (select (response->>'deliveryId')::uuid from activation_results
      where result_name = 'v1-attempt'),
    'f7000000-0000-4000-8000-000000000010',
    'f7000000-0000-4000-8000-000000000011'
  )
);
reset role;

select is(
  (select response->>'calculationContractVersion'
   from activation_results where result_name = 'v1-load'),
  'planning-calculation/1',
  'an already-active V1 attempt remains on its immutable V1 path after activation'
);

set local role service_role;
insert into activation_results values (
  'v1-record', pg_catalog.to_jsonb(api.record_plan_snapshot_input_v1(
    (select (response->>'deliveryId')::uuid from activation_results
      where result_name = 'v1-attempt'),
    'f7000000-0000-4000-8000-000000000010',
    'f7000000-0000-4000-8000-000000000011',
    (select response->>'sourceFence' from activation_results where result_name = 'v1-load'),
    pg_catalog.jsonb_build_object(
      'completedWorkPolicyVersion', 'planning-completed-work/0.1',
      'inputFingerprint', 'planning-input:' || repeat('1', 64),
      'evaluationHorizon', pg_catalog.jsonb_build_object(
        'asOf', (select response->'claimAsOf'
          from activation_results where result_name = 'v1-load'),
        'validUntil', (select response#>'{sourceBundle,calendar,validUntil}'
          from activation_results where result_name = 'v1-load'),
        'timeZone', (select response#>'{sourceBundle,calendar,timeZone}'
          from activation_results where result_name = 'v1-load'),
        'weekStart', (select response#>'{sourceBundle,calendar,weekStart}'
          from activation_results where result_name = 'v1-load'),
        'weekEnd', (select response#>'{sourceBundle,calendar,weekEnd}'
          from activation_results where result_name = 'v1-load')
      ),
      'growthPlan', pg_catalog.jsonb_build_object(
        'growthPlanId', (select response->>'growthPlanId'
          from activation_results where result_name = 'plan')
      )
    )
  ))
);
insert into activation_results values (
  'v1-complete', pg_catalog.to_jsonb(api.complete_plan_snapshot_projection_v1(
    (select (response->>'deliveryId')::uuid from activation_results
      where result_name = 'v1-attempt'),
    'f7000000-0000-4000-8000-000000000010',
    'f7000000-0000-4000-8000-000000000011',
    pg_catalog.jsonb_build_object(
      'engineVersion', 'planner-engine/0.1.0',
      'policyVersion', 'planning-policy/0.1',
      'inputFingerprint', 'planning-input:' || repeat('1', 64),
      'calculatedAsOf', (select response->'claimAsOf'
        from activation_results where result_name = 'v1-load'),
      'validUntil', (select response#>'{sourceBundle,calendar,validUntil}'
        from activation_results where result_name = 'v1-load'),
      'timeZone', (select response#>'{sourceBundle,calendar,timeZone}'
        from activation_results where result_name = 'v1-load'),
      'weekStart', (select response#>'{sourceBundle,calendar,weekStart}'
        from activation_results where result_name = 'v1-load'),
      'weekEnd', (select response#>'{sourceBundle,calendar,weekEnd}'
        from activation_results where result_name = 'v1-load'),
      'recommendationState', 'NO_CANDIDATES',
      'actions', '[]'::jsonb
    )
  ))
);
reset role;

select is(
  (select response#>>'{}' from activation_results where result_name = 'v1-complete'),
  'APPLIED',
  'the in-flight V1 attempt can finish normally'
);
select ok(
  exists (
    select 1
    from planning.current_plan_snapshots as pointer
    join planning.plan_snapshot_attempts as attempt
      on attempt.workspace_id = pointer.workspace_id
     and attempt.attempt_id = pointer.applied_attempt_id
    join planning.plan_snapshots as snapshot
      on snapshot.workspace_id = pointer.workspace_id
     and snapshot.snapshot_id = pointer.snapshot_id
    where pointer.workspace_id = (
      select (response->>'workspace_id')::uuid
      from activation_results where result_name = 'bootstrap'
    )
      and attempt.calculation_contract_version = 'planning-calculation/1'
      and snapshot.engine_version = 'planner-engine/0.1.0'
      and snapshot.policy_version = 'planning-policy/0.1'
  ),
  'V1 completion leaves an exact historical V1 pointer until V2 applies'
);

set local role pando_planning_worker;
insert into activation_results values (
  'activation-event', pg_catalog.to_jsonb(planning.enqueue_plan_snapshot_v2_activation_v1(
    (select (response->>'workspace_id')::uuid
     from activation_results where result_name = 'bootstrap')
  ))
);
select planning.enqueue_plan_snapshot_v2_activation_v1(
  (select (response->>'workspace_id')::uuid
   from activation_results where result_name = 'bootstrap')
);

select ok(
  (select count(*) = 1
   from outbox.events as event
   join outbox.deliveries as delivery on delivery.event_id = event.event_id
   where event.event_id = (
     select (response#>>'{}')::uuid
     from activation_results where result_name = 'activation-event'
   )
     and event.event_name = 'planning.snapshot_calculation_v2_activation_requested'
     and delivery.consumer_name = 'planning.plan_snapshot_v1'
     and delivery.handler_contract_version = 1)
  and (
    select planning.plan_snapshot_v2_activation_event_is_valid_v1(event)
    from outbox.events as event
    where event.event_id = (
      select (response#>>'{}')::uuid
      from activation_results where result_name = 'activation-event'
    )
  ),
  'activation replay produces exactly one deterministic valid event and delivery'
);
reset role;

-- Hosted activation becomes due just after the V1 snapshot boundary. Bring that deterministic
-- delivery forward in this fixture so the stale-successor path is exercised without wall time.
update outbox.deliveries
set available_at = clock_timestamp()
where event_id = (
  select (response#>>'{}')::uuid
  from activation_results where result_name = 'activation-event'
);

insert into outbox.events (
  event_id, event_name, event_schema_version, workspace_id, aggregate_type,
  aggregate_id, aggregate_version, actor_type, actor_user_id, command_id,
  correlation_id, causation_id, occurred_at, source, payload
)
select 'f7000000-0000-4000-8000-000000000012', event.event_name,
  event.event_schema_version, event.workspace_id, event.aggregate_type,
  event.aggregate_id, event.aggregate_version, event.actor_type, event.actor_user_id,
  event.command_id, event.correlation_id, event.causation_id, clock_timestamp(),
  event.source, event.payload || pg_catalog.jsonb_build_object('unexpected', true)
from outbox.events as event
where event.event_id = (
  select (response#>>'{}')::uuid
  from activation_results where result_name = 'activation-event'
);
set local role pando_planning_worker;
select is(
  (select planning.plan_snapshot_v2_activation_event_is_valid_v1(event)
   from outbox.events as event
   where event.event_id = 'f7000000-0000-4000-8000-000000000012'),
  false,
  'activation event validation rejects an extra payload key'
);
reset role;

insert into outbox.events (
  event_id, event_name, event_schema_version, workspace_id, aggregate_type,
  aggregate_id, aggregate_version, actor_type, actor_user_id, command_id,
  correlation_id, causation_id, occurred_at, source, payload
)
select 'f7000000-0000-4000-8000-000000000013', event.event_name,
  event.event_schema_version, event.workspace_id, event.aggregate_type,
  event.aggregate_id, event.aggregate_version, event.actor_type, event.actor_user_id,
  event.command_id, event.correlation_id, event.causation_id, clock_timestamp(),
  event.source, pg_catalog.jsonb_set(
    event.payload,
    '{source_attempt_id}',
    '"f7000000-0000-4000-8000-000000000099"'::jsonb
  )
from outbox.events as event
where event.event_id = (
  select (response#>>'{}')::uuid
  from activation_results where result_name = 'activation-event'
);
set local role pando_planning_worker;
select is(
  (select planning.plan_snapshot_v2_activation_event_is_valid_v1(event)
   from outbox.events as event
   where event.event_id = 'f7000000-0000-4000-8000-000000000013'),
  false,
  'activation event validation rejects a well-formed but unrelated source attempt'
);
reset role;

-- Apply cadence while the activation delivery is queued; progress must be explicitly pending.
set local role authenticated;
insert into activation_results values (
  'cadence-preview', api.preview_learning_track_cadence_v1(
    'track:activation', 3, '1', '1', 'Activate cadence three times each week.'
  )
);
insert into activation_results
select 'cadence-apply', api.apply_learning_track_cadence_v1(
  'track:activation', 3, '1', '1', response->>'previewDigest',
  'Activate cadence three times each week.', 'd2c-activation-cadence'
)
from activation_results where result_name = 'cadence-preview';
insert into activation_results values (
  'source-after-cadence', api.get_learning_track_cadence_source_v1()
);
reset role;

select is(
  (select response#>>'{progress,state}'
   from activation_results where result_name = 'source-after-cadence'),
  'PENDING',
  'a direct cadence apply reports PENDING before any V2 attempt exists'
);
select ok(
  not exists (
    select 1
    from planning.plan_snapshot_attempts as attempt
    where attempt.workspace_id = (
      select (response->>'workspace_id')::uuid
      from activation_results where result_name = 'bootstrap'
    )
      and attempt.calculation_contract_version = 'planning-calculation/2'
  ),
  'queued post-activation work is pending without fabricating an attempt'
);

set local role service_role;
insert into activation_results
select 'stale-activation-claim', pg_catalog.to_jsonb(claim)
from api.claim_plan_snapshot_projection_v1() as claim;
insert into activation_results values (
  'stale-activation-load', api.load_plan_snapshot_projection_v1(
    (select (response->>'delivery_id')::uuid from activation_results
      where result_name = 'stale-activation-claim'),
    (select (response->>'lease_token')::uuid from activation_results
      where result_name = 'stale-activation-claim'),
    (select (response->>'attempt_id')::uuid from activation_results
      where result_name = 'stale-activation-claim')
  )
);
reset role;

select is(
  (select response->>'calculationContractVersion'
   from activation_results where result_name = 'stale-activation-load'),
  'planning-calculation/2',
  'the first newly created activation attempt is stamped V2'
);
select is(
  (select response#>>'{sourceBundle,plan,tracks,0,cadencePerWeek}'
   from activation_results where result_name = 'stale-activation-load'),
  '3',
  'the V2 activation source observes the directly applied cadence'
);

set local role service_role;
insert into activation_results values (
  'stale-activation-record', pg_catalog.to_jsonb(api.record_plan_snapshot_input_v1(
    (select (response->>'delivery_id')::uuid from activation_results
      where result_name = 'stale-activation-claim'),
    (select (response->>'lease_token')::uuid from activation_results
      where result_name = 'stale-activation-claim'),
    (select (response->>'attemptId')::uuid from activation_results
      where result_name = 'stale-activation-load'),
    (select response->>'sourceFence' from activation_results
      where result_name = 'stale-activation-load'),
    pg_catalog.jsonb_build_object(
      'completedWorkPolicyVersion', 'planning-completed-work/0.2',
      'inputFingerprint', 'planning-input:' || repeat('2', 64),
      'evaluationHorizon', pg_catalog.jsonb_build_object(
        'asOf', (select response->'claimAsOf' from activation_results
          where result_name = 'stale-activation-load'),
        'validUntil', (select response#>'{sourceBundle,calendar,validUntil}'
          from activation_results where result_name = 'stale-activation-load')
      ),
      'growthPlan', pg_catalog.jsonb_build_object(
        'growthPlanId', (select response->>'growthPlanId'
          from activation_results where result_name = 'plan'),
        'tracks', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'cadencePerWeek', 3,
          'completedCadenceSessionsThisWeek', 0
        ))
      )
    )
  ))
);
reset role;

-- Install a later exact V1 pointer before the first activation result returns.
insert into planning.plan_snapshots (
  snapshot_id, workspace_id, growth_plan_id, input_fingerprint, engine_version,
  policy_version, calculated_as_of, valid_until, time_zone, week_start, week_end,
  recommendation_state, result
)
select 'f7000000-0000-4000-8000-000000000020', pointer.workspace_id,
  (select (response->>'growthPlanId')::uuid from activation_results where result_name = 'plan'),
  'planning-input:' || repeat('3', 64), 'planner-engine/0.1.0', 'planning-policy/0.1',
  fixture.calculated_as_of, fixture.valid_until, 'UTC',
  fixture.week_start, fixture.week_end,
  'NO_CANDIDATES', pg_catalog.jsonb_build_object(
    'engineVersion', 'planner-engine/0.1.0',
    'policyVersion', 'planning-policy/0.1',
    'inputFingerprint', 'planning-input:' || repeat('3', 64),
    'calculatedAsOf', fixture.calculated_as_of,
    'validUntil', fixture.valid_until,
    'timeZone', 'UTC',
    'weekStart', fixture.week_start,
    'weekEnd', fixture.week_end,
    'recommendationState', 'NO_CANDIDATES',
    'actions', '[]'::jsonb
  )
from planning.current_plan_snapshots as pointer
cross join lateral (
  select instant.calculated_as_of,
    instant.calculated_as_of + interval '1 hour' as valid_until,
    date_trunc('week', instant.calculated_as_of) as week_start,
    date_trunc('week', instant.calculated_as_of) + interval '7 days' as week_end
  from (select clock_timestamp() as calculated_as_of) as instant
) as fixture
where pointer.workspace_id = (
  select (response->>'workspace_id')::uuid
  from activation_results where result_name = 'bootstrap'
);

update outbox.deliveries
set delivery_state = 'succeeded', completed_at = clock_timestamp(),
  lease_token = null, lease_expires_at = null
where delivery_id = (
  select (response->>'planningDeliveryId')::uuid
  from activation_results where result_name = 'cadence-apply'
);
insert into planning.plan_snapshot_attempts (
  attempt_id, workspace_id, delivery_id, event_id, event_position, generation,
  attempt_state, claim_as_of, base_pointer_version, calculation_contract_version,
  source_fence, normalized_input, input_fingerprint, valid_until,
  covered_delivery_ids, applied_pointer_version
)
select 'f7000000-0000-4000-8000-000000000021', delivery.workspace_id,
  delivery.delivery_id, delivery.event_id, event.event_position, 1, 'APPLIED',
  clock_timestamp(), pointer.pointer_version, 'planning-calculation/1',
  'planning-source:' || repeat('3', 64),
  pg_catalog.jsonb_build_object(
    'completedWorkPolicyVersion', 'planning-completed-work/0.1',
    'inputFingerprint', 'planning-input:' || repeat('3', 64)
  ),
  'planning-input:' || repeat('3', 64), clock_timestamp() + interval '1 hour',
  array[delivery.delivery_id], pointer.pointer_version + 1
from outbox.deliveries as delivery
join outbox.events as event on event.event_id = delivery.event_id
join planning.current_plan_snapshots as pointer on pointer.workspace_id = delivery.workspace_id
where delivery.delivery_id = (
  select (response->>'planningDeliveryId')::uuid
  from activation_results where result_name = 'cadence-apply'
);
update planning.plan_snapshot_delivery_ledger
set coverage_state = 'COVERED', covered_by_pointer_version = 2,
  covered_by_attempt_id = 'f7000000-0000-4000-8000-000000000021',
  updated_at = clock_timestamp()
where delivery_id = (
  select (response->>'planningDeliveryId')::uuid
  from activation_results where result_name = 'cadence-apply'
);
update planning.current_plan_snapshots
set snapshot_id = 'f7000000-0000-4000-8000-000000000020',
  applied_attempt_id = 'f7000000-0000-4000-8000-000000000021',
  pointer_version = 2, updated_at = clock_timestamp()
where workspace_id = (
  select (response->>'workspace_id')::uuid
  from activation_results where result_name = 'bootstrap'
);
set local role pando_planning_worker;
insert into activation_results values (
  'successor-activation-event', pg_catalog.to_jsonb(
    planning.enqueue_plan_snapshot_v2_activation_v1(
      (select (response->>'workspace_id')::uuid
       from activation_results where result_name = 'bootstrap')
    )
  )
);
reset role;

update outbox.deliveries
set available_at = clock_timestamp()
where event_id = (
  select (response#>>'{}')::uuid
  from activation_results
  where result_name = 'successor-activation-event'
);

set local role service_role;
insert into activation_results values (
  'stale-activation-complete', pg_catalog.to_jsonb(api.complete_plan_snapshot_projection_v1(
    (select (response->>'delivery_id')::uuid from activation_results
      where result_name = 'stale-activation-claim'),
    (select (response->>'lease_token')::uuid from activation_results
      where result_name = 'stale-activation-claim'),
    (select (response->>'attemptId')::uuid from activation_results
      where result_name = 'stale-activation-load'),
    pg_catalog.jsonb_build_object(
      'engineVersion', 'planner-engine/0.2.0',
      'policyVersion', 'planning-policy/0.2',
      'inputFingerprint', 'planning-input:' || repeat('2', 64),
      'calculatedAsOf', (select response->'claimAsOf'
        from activation_results where result_name = 'stale-activation-load'),
      'validUntil', (select response#>'{sourceBundle,calendar,validUntil}'
        from activation_results where result_name = 'stale-activation-load'),
      'timeZone', (select response#>'{sourceBundle,calendar,timeZone}'
        from activation_results where result_name = 'stale-activation-load'),
      'weekStart', (select response#>'{sourceBundle,calendar,weekStart}'
        from activation_results where result_name = 'stale-activation-load'),
      'weekEnd', (select response#>'{sourceBundle,calendar,weekEnd}'
        from activation_results where result_name = 'stale-activation-load'),
      'recommendationState', 'NO_CANDIDATES',
      'actions', '[]'::jsonb
    )
  ))
);
reset role;

select ok(
  (select response#>>'{}' = 'SUPERSEDED'
   from activation_results where result_name = 'stale-activation-complete')
  and exists (
    select 1 from planning.current_plan_snapshots
    where workspace_id = (
      select (response->>'workspace_id')::uuid
      from activation_results where result_name = 'bootstrap'
    )
      and snapshot_id = 'f7000000-0000-4000-8000-000000000020'
      and applied_attempt_id = 'f7000000-0000-4000-8000-000000000021'
      and pointer_version = 2
  ),
  'activation source-snapshot drift supersedes the stale result without moving the pointer'
);

set local role service_role;
insert into activation_results
select 'v2-claim', pg_catalog.to_jsonb(claim)
from api.claim_plan_snapshot_projection_v1() as claim;
insert into activation_results values (
  'v2-load', api.load_plan_snapshot_projection_v1(
    (select (response->>'delivery_id')::uuid from activation_results where result_name = 'v2-claim'),
    (select (response->>'lease_token')::uuid from activation_results where result_name = 'v2-claim'),
    (select (response->>'attempt_id')::uuid from activation_results where result_name = 'v2-claim')
  )
);
insert into activation_results values (
  'v2-record', pg_catalog.to_jsonb(api.record_plan_snapshot_input_v1(
    (select (response->>'delivery_id')::uuid from activation_results where result_name = 'v2-claim'),
    (select (response->>'lease_token')::uuid from activation_results where result_name = 'v2-claim'),
    (select (response->>'attemptId')::uuid from activation_results where result_name = 'v2-load'),
    (select response->>'sourceFence' from activation_results where result_name = 'v2-load'),
    pg_catalog.jsonb_build_object(
      'completedWorkPolicyVersion', 'planning-completed-work/0.2',
      'inputFingerprint', 'planning-input:' || repeat('4', 64),
      'evaluationHorizon', pg_catalog.jsonb_build_object(
        'asOf', (select response->'claimAsOf' from activation_results where result_name = 'v2-load'),
        'validUntil', (select response#>'{sourceBundle,calendar,validUntil}'
          from activation_results where result_name = 'v2-load')
      ),
      'growthPlan', pg_catalog.jsonb_build_object(
        'growthPlanId', (select response->>'growthPlanId'
          from activation_results where result_name = 'plan'),
        'version', '1', 'lifecycle', 'ACTIVE', 'weeklyCapacityMinutes', 600,
        'tracks', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'trackId', (select response->>'learningTrackId'
            from activation_results where result_name = 'plan'),
          'version', '2', 'lifecycle', 'ACTIVE', 'priority', 80,
          'protectedMinimumMinutes', 120, 'cadencePerWeek', 3,
          'completedCadenceSessionsThisWeek', 0
        ))
      )
    )
  ))
);
insert into activation_results values (
  'v2-complete', pg_catalog.to_jsonb(api.complete_plan_snapshot_projection_v1(
    (select (response->>'delivery_id')::uuid from activation_results where result_name = 'v2-claim'),
    (select (response->>'lease_token')::uuid from activation_results where result_name = 'v2-claim'),
    (select (response->>'attemptId')::uuid from activation_results where result_name = 'v2-load'),
    pg_catalog.jsonb_build_object(
      'engineVersion', 'planner-engine/0.2.0',
      'policyVersion', 'planning-policy/0.2',
      'inputFingerprint', 'planning-input:' || repeat('4', 64),
      'calculatedAsOf', (select response->'claimAsOf'
        from activation_results where result_name = 'v2-load'),
      'validUntil', (select response#>'{sourceBundle,calendar,validUntil}'
        from activation_results where result_name = 'v2-load'),
      'timeZone', (select response#>'{sourceBundle,calendar,timeZone}'
        from activation_results where result_name = 'v2-load'),
      'weekStart', (select response#>'{sourceBundle,calendar,weekStart}'
        from activation_results where result_name = 'v2-load'),
      'weekEnd', (select response#>'{sourceBundle,calendar,weekEnd}'
        from activation_results where result_name = 'v2-load'),
      'recommendationState', 'NO_CANDIDATES',
      'actions', '[]'::jsonb
    )
  ))
);
reset role;

select ok(
  (select response#>>'{}' = 'APPLIED'
   from activation_results where result_name = 'v2-complete')
  and exists (
    select 1
    from planning.current_plan_snapshots as pointer
    join planning.plan_snapshot_attempts as attempt
      on attempt.workspace_id = pointer.workspace_id
     and attempt.attempt_id = pointer.applied_attempt_id
    join planning.plan_snapshots as snapshot
      on snapshot.workspace_id = pointer.workspace_id
     and snapshot.snapshot_id = pointer.snapshot_id
    where pointer.workspace_id = (
      select (response->>'workspace_id')::uuid
      from activation_results where result_name = 'bootstrap'
    )
      and pointer.pointer_version = 3
      and attempt.calculation_contract_version = 'planning-calculation/2'
      and attempt.normalized_input->>'completedWorkPolicyVersion'
        = 'planning-completed-work/0.2'
      and snapshot.engine_version = 'planner-engine/0.2.0'
      and snapshot.policy_version = 'planning-policy/0.2'
  ),
  'a fresh V2 activation moves the pointer only as one exact joined tuple'
);

-- A permanent post-activation failure leaves the applied V2 pointer untouched and blocks the
-- cadence progress at that exact pointer frontier.
set local role authenticated;
insert into activation_results values (
  'failure-preview', api.preview_learning_track_cadence_v1(
    'track:activation', 4, '1', '2', 'Raise cadence for failure proof.'
  )
);
insert into activation_results
select 'failure-apply', api.apply_learning_track_cadence_v1(
  'track:activation', 4, '1', '2', response->>'previewDigest',
  'Raise cadence for failure proof.', 'd2c-activation-failure'
)
from activation_results where result_name = 'failure-preview';
reset role;
insert into activation_results
select 'pointer-before-failure', pg_catalog.to_jsonb(pointer)
from planning.current_plan_snapshots as pointer
where pointer.workspace_id = (
  select (response->>'workspace_id')::uuid
  from activation_results where result_name = 'bootstrap'
);
set local role service_role;
insert into activation_results
select 'failure-claim', pg_catalog.to_jsonb(claim)
from api.claim_plan_snapshot_projection_v1() as claim;
insert into activation_results values (
  'failure-result', pg_catalog.to_jsonb(api.fail_plan_snapshot_projection_v1(
    (select (response->>'delivery_id')::uuid from activation_results where result_name = 'failure-claim'),
    (select (response->>'lease_token')::uuid from activation_results where result_name = 'failure-claim'),
    (select (response->>'attempt_id')::uuid from activation_results where result_name = 'failure-claim'),
    'INVALID_CONTRACT', 'ACTIVATION_PERMANENT_TEST'
  ))
);
reset role;

select ok(
  (select response#>>'{}' = 'dead_letter'
   from activation_results where result_name = 'failure-result')
  and (
    select pg_catalog.to_jsonb(pointer) - array['updated_at']::text[]
    from planning.current_plan_snapshots as pointer
    where pointer.workspace_id = (
      select (response->>'workspace_id')::uuid
      from activation_results where result_name = 'bootstrap'
    )
  ) = (
    select response - array['updated_at']::text[]
    from activation_results where result_name = 'pointer-before-failure'
  ),
  'a permanent V2 calculation failure dead-letters without moving or relabeling the current pointer'
);

set local role authenticated;
insert into activation_results values (
  'source-after-failure', api.get_learning_track_cadence_source_v1()
);
reset role;
select ok(
  (select response#>>'{progress,state}' = 'UNAVAILABLE'
   from activation_results where result_name = 'source-after-failure')
  and (select response#>'{learningTracks,0,completedCadenceSessionsThisWeek}' = 'null'::jsonb
       from activation_results where result_name = 'source-after-failure'),
  'a dead letter at the current pointer frontier exposes no cadence progress'
);

-- A later successful V2 calculation advances the pointer. The historical dead letter remains an
-- uncovered audit fact, but it must not poison the recovered current cadence projection forever.
set local role authenticated;
insert into activation_results values (
  'recovery-preview', api.preview_learning_track_cadence_v1(
    'track:activation', 5, '1', '3', 'Recover cadence after the failed calculation.'
  )
);
insert into activation_results
select 'recovery-apply', api.apply_learning_track_cadence_v1(
  'track:activation', 5, '1', '3', response->>'previewDigest',
  'Recover cadence after the failed calculation.', 'd2c-activation-recovery'
)
from activation_results where result_name = 'recovery-preview';
reset role;

set local role service_role;
insert into activation_results
select 'recovery-claim', pg_catalog.to_jsonb(claim)
from api.claim_plan_snapshot_projection_v1() as claim;
insert into activation_results values (
  'recovery-load', api.load_plan_snapshot_projection_v1(
    (select (response->>'delivery_id')::uuid from activation_results
      where result_name = 'recovery-claim'),
    (select (response->>'lease_token')::uuid from activation_results
      where result_name = 'recovery-claim'),
    (select (response->>'attempt_id')::uuid from activation_results
      where result_name = 'recovery-claim')
  )
);
insert into activation_results values (
  'recovery-record', pg_catalog.to_jsonb(api.record_plan_snapshot_input_v1(
    (select (response->>'delivery_id')::uuid from activation_results
      where result_name = 'recovery-claim'),
    (select (response->>'lease_token')::uuid from activation_results
      where result_name = 'recovery-claim'),
    (select (response->>'attemptId')::uuid from activation_results
      where result_name = 'recovery-load'),
    (select response->>'sourceFence' from activation_results
      where result_name = 'recovery-load'),
    pg_catalog.jsonb_build_object(
      'completedWorkPolicyVersion', 'planning-completed-work/0.2',
      'inputFingerprint', 'planning-input:' || repeat('5', 64),
      'evaluationHorizon', pg_catalog.jsonb_build_object(
        'asOf', (select response->'claimAsOf' from activation_results
          where result_name = 'recovery-load'),
        'validUntil', (select response#>'{sourceBundle,calendar,validUntil}'
          from activation_results where result_name = 'recovery-load')
      ),
      'growthPlan', pg_catalog.jsonb_build_object(
        'growthPlanId', (select response->>'growthPlanId'
          from activation_results where result_name = 'plan'),
        'version', '1', 'lifecycle', 'ACTIVE', 'weeklyCapacityMinutes', 600,
        'tracks', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'trackId', (select response->>'learningTrackId'
            from activation_results where result_name = 'plan'),
          'version', '4', 'lifecycle', 'ACTIVE', 'priority', 80,
          'protectedMinimumMinutes', 120, 'cadencePerWeek', 5,
          'completedCadenceSessionsThisWeek', 0
        ))
      )
    )
  ))
);
insert into activation_results values (
  'recovery-complete', pg_catalog.to_jsonb(api.complete_plan_snapshot_projection_v1(
    (select (response->>'delivery_id')::uuid from activation_results
      where result_name = 'recovery-claim'),
    (select (response->>'lease_token')::uuid from activation_results
      where result_name = 'recovery-claim'),
    (select (response->>'attemptId')::uuid from activation_results
      where result_name = 'recovery-load'),
    pg_catalog.jsonb_build_object(
      'engineVersion', 'planner-engine/0.2.0',
      'policyVersion', 'planning-policy/0.2',
      'inputFingerprint', 'planning-input:' || repeat('5', 64),
      'calculatedAsOf', (select response->'claimAsOf'
        from activation_results where result_name = 'recovery-load'),
      'validUntil', (select response#>'{sourceBundle,calendar,validUntil}'
        from activation_results where result_name = 'recovery-load'),
      'timeZone', (select response#>'{sourceBundle,calendar,timeZone}'
        from activation_results where result_name = 'recovery-load'),
      'weekStart', (select response#>'{sourceBundle,calendar,weekStart}'
        from activation_results where result_name = 'recovery-load'),
      'weekEnd', (select response#>'{sourceBundle,calendar,weekEnd}'
        from activation_results where result_name = 'recovery-load'),
      'recommendationState', 'NO_CANDIDATES',
      'actions', '[]'::jsonb
    )
  ))
);
reset role;

set local role authenticated;
insert into activation_results values (
  'source-after-recovery', api.get_learning_track_cadence_source_v1()
);
reset role;
select ok(
  (select response#>>'{}' = 'APPLIED'
   from activation_results where result_name = 'recovery-complete')
  and exists (
    select 1
    from outbox.deliveries as delivery
    join planning.plan_snapshot_delivery_ledger as ledger
      on ledger.delivery_id = delivery.delivery_id
     and ledger.workspace_id = delivery.workspace_id
    where delivery.delivery_id = (
      select (response->>'delivery_id')::uuid
      from activation_results where result_name = 'failure-claim'
    )
      and delivery.delivery_state = 'dead_letter'
      and ledger.coverage_state = 'UNCOVERED'
  )
  and (select response#>>'{progress,state}' = 'CURRENT'
       from activation_results where result_name = 'source-after-recovery')
  and (select response#>>'{learningTracks,0,cadencePerWeek}' = '5'
       from activation_results where result_name = 'source-after-recovery')
  and (select response#>>'{learningTracks,0,completedCadenceSessionsThisWeek}' = '0'
       from activation_results where result_name = 'source-after-recovery'),
  'a newer successful V2 pointer restores current cadence progress without erasing the historical dead letter'
);

select * from finish();
rollback;
