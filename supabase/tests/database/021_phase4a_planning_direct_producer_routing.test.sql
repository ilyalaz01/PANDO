begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

select ok(
  not pg_catalog.has_function_privilege(
    'anon', 'outbox.enqueue_plan_snapshot_source_delivery_v1(uuid)', 'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated', 'outbox.enqueue_plan_snapshot_source_delivery_v1(uuid)', 'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'service_role', 'outbox.enqueue_plan_snapshot_source_delivery_v1(uuid)', 'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'anon', 'outbox.backfill_plan_snapshot_source_deliveries_v1(bigint,integer)', 'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated',
    'outbox.backfill_plan_snapshot_source_deliveries_v1(bigint,integer)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'service_role',
    'outbox.backfill_plan_snapshot_source_deliveries_v1(bigint,integer)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'anon',
    'outbox.quarantine_invalid_plan_snapshot_source_event_v1(uuid,text,text,text)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated',
    'outbox.quarantine_invalid_plan_snapshot_source_event_v1(uuid,text,text,text)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'service_role',
    'outbox.quarantine_invalid_plan_snapshot_source_event_v1(uuid,text,text,text)',
    'EXECUTE'
  ),
  'runtime roles cannot invoke the private Planning router, rollout backfill, or quarantine'
);

select ok(
  pg_catalog.has_table_privilege(
    'pando_planning_router', 'planning.plan_snapshot_source_quarantines', 'SELECT,INSERT'
  )
  and not pg_catalog.has_table_privilege(
    'pando_planning_router', 'planning.plan_snapshot_source_quarantines', 'UPDATE,DELETE'
  )
  and not pg_catalog.has_table_privilege(
    'authenticated', 'planning.plan_snapshot_source_quarantines', 'SELECT,INSERT,UPDATE,DELETE'
  ),
  'the router can only append/read quarantine audit rows and runtime has no table access'
);

select ok(
  not pg_catalog.has_function_privilege(
    'authenticated',
    'overlay.add_current_custom_activity_without_planning_v1(text,text,text,text,text,text,text)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated',
    'sessions.start_focus_activity_without_planning_v1(text,text,smallint,text)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated',
    'sessions.finish_focus_activity_without_planning_v1(uuid,bigint,text,text,boolean,text)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated',
    'evidence.invalidate_evidence_without_planning_v1(uuid,text,text)',
    'EXECUTE'
  ),
  'application coordinator implementations remain private in their owner schemas'
);

select ok(
  bool_and(pg_catalog.has_function_privilege(
    producer.role_name,
    'outbox.enqueue_plan_snapshot_source_delivery_v1(uuid)',
    'EXECUTE'
  )),
  'only the five bounded producer owners can invoke the fixed Planning router'
)
from (values
  ('pando_phase1_api'),
  ('pando_phase2_api'),
  ('pando_mastery_worker'),
  ('pando_review_worker'),
  ('pando_readiness_worker')
) as producer(role_name);

do $test_role_membership$
begin
  execute pg_catalog.format(
    'grant pando_planning_router to %I with set true',
    current_user
  );
end
$test_role_membership$;

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_policies
    where schemaname || '.' || tablename in (
      'outbox.events', 'outbox.deliveries', 'planning.current_plan_snapshots',
      'planning.plan_snapshot_source_quarantines', 'outbox.command_receipts'
    )
      and policyname like 'planning_router_%'
      and roles = array['pando_planning_router']::name[]
  ),
  11,
  'the router has only its eleven purpose-specific forced-RLS policies'
);

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    '2b000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
    'planning-routing@pando.test', '', clock_timestamp(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    clock_timestamp(), clock_timestamp()
  ),
  (
    '2b000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
    'planning-routing-no-plan@pando.test', '', clock_timestamp(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    clock_timestamp(), clock_timestamp()
  );

create temporary table routing_results (
  result_name text primary key,
  response jsonb not null
);
grant select, insert, update on routing_results to authenticated, service_role;
grant select on routing_results to pando_planning_router;
grant usage on schema extensions to pando_planning_router;

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '2b000000-0000-4000-8000-000000000002',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text,
  true
);
set local role authenticated;
insert into routing_results values (
  'no-plan-bootstrap',
  api.bootstrap_personal_workspace('phase4a-routing-no-plan', 'Routing without plan')
);
insert into routing_results
select 'no-plan-goal', api.create_readiness_goal(
  (select (response->>'workspace_id')::uuid from routing_results
   where result_name = 'no-plan-bootstrap'),
  'goal:routing-no-plan', 'Routing without plan goal',
  'target:nvidia-python-verification-base-v1', 'phase4a-routing-no-plan-goal'
);
insert into routing_results values (
  'no-plan-overlay',
  api.add_current_custom_activity_v1(
    'goal:routing-no-plan', 'activity:routing-no-plan', 'No-plan activity',
    'MANUAL_CODING', 'competency:python-typing', '0',
    'phase4a-routing-no-plan-overlay'
  )
);
reset role;

select is(
  (
    select count(*)::integer
    from outbox.deliveries as delivery
    where delivery.event_id = (
      select (response->'emittedEventIds'->>0)::uuid
      from routing_results where result_name = 'no-plan-overlay'
    )
      and delivery.consumer_name = 'planning.plan_snapshot_v1'
  ),
  0,
  'a source event created before the Planning sentinel gets no poison delivery'
);

set local role authenticated;
insert into routing_results values (
  'no-plan-now-plan', api.initialize_growth_plan_v1(
    'goal:routing-no-plan', 300, 25, 80, 60, 'phase4a-routing-no-plan-initialize'
  )
);
reset role;

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '2b000000-0000-4000-8000-000000000001',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text,
  true
);
set local role authenticated;
insert into routing_results values (
  'bootstrap', api.bootstrap_personal_workspace('phase4a-routing', 'Planning routing')
);
insert into routing_results
select 'goal', api.create_readiness_goal(
  (select (response->>'workspace_id')::uuid from routing_results
   where result_name = 'bootstrap'),
  'goal:planning-routing', 'Planning routing goal',
  'target:nvidia-python-verification-base-v1', 'phase4a-routing-goal'
);
insert into routing_results values (
  'plan', api.initialize_growth_plan_v1(
    'goal:planning-routing', 300, 25, 80, 60, 'phase4a-routing-plan'
  )
);
insert into routing_results values (
  'overlay', api.add_current_custom_activity_v1(
    'goal:planning-routing', 'activity:planning-routing', 'Planning routing activity',
    'MANUAL_CODING', 'competency:python-typing', '0', 'phase4a-routing-overlay'
  )
);
insert into routing_results values (
  'overlay-replay', api.add_current_custom_activity_v1(
    'goal:planning-routing', 'activity:planning-routing', 'Planning routing activity',
    'MANUAL_CODING', 'competency:python-typing', '0', 'phase4a-routing-overlay'
  )
);
insert into routing_results values (
  'focus-start', api.start_focus_activity_v1(
    'goal:planning-routing', 'activity:planning-routing', 25::smallint,
    'phase4a-routing-focus-start'
  )
);
insert into routing_results
select 'focus-complete', api.finish_focus_activity_v1(
  (response->>'focusSessionId')::uuid, 1, 'COMPLETE', 'OBSERVED_SUCCESS', false,
  'phase4a-routing-focus-complete'
) from routing_results where result_name = 'focus-start';
insert into routing_results values (
  'focus-stop-start', api.start_focus_activity_v1(
    'goal:planning-routing', 'activity:planning-routing', 10::smallint,
    'phase4a-routing-focus-stop-start'
  )
);
insert into routing_results
select 'focus-stop', api.finish_focus_activity_v1(
  (response->>'focusSessionId')::uuid, 1, 'STOP', null, null,
  'phase4a-routing-focus-stop'
) from routing_results where result_name = 'focus-stop-start';
insert into routing_results
select 'invalidation', api.invalidate_evidence_v1(
  (response->>'evidenceId')::uuid, 'The observed result was entered incorrectly.',
  'phase4a-routing-invalidation'
) from routing_results where result_name = 'focus-complete';
reset role;

select is(
  (select response from routing_results where result_name = 'overlay-replay'),
  (select response from routing_results where result_name = 'overlay'),
  'a replay returns the exact stored owner response'
);

select is(
  (
    select count(*)::integer
    from outbox.deliveries as delivery
    where delivery.event_id = (
      select (response->'emittedEventIds'->>0)::uuid
      from routing_results where result_name = 'overlay'
    )
      and delivery.consumer_name = 'planning.plan_snapshot_v1'
      and delivery.handler_contract_version = 1
  ),
  1,
  'replaying an owner command cannot duplicate its fixed Planning delivery'
);

select is(
  (
    select count(*)::integer
    from outbox.events as event
    join outbox.deliveries as delivery on delivery.event_id = event.event_id
    where event.workspace_id = (
      select (response->>'workspaceId')::uuid from routing_results where result_name = 'plan'
    )
      and event.event_name in (
        'overlay.custom_activity_added', 'sessions.focus_started',
        'sessions.focus_completed', 'sessions.focus_stopped',
        'evidence.observation_invalidated'
      )
      and delivery.consumer_name = 'planning.plan_snapshot_v1'
      and delivery.handler_contract_version = 1
  ),
  6,
  'all six real user-owner source events route exactly once after plan creation'
);

set local role pando_planning_router;
select ok(
  bool_and(planning.plan_snapshot_event_is_valid_v1(event)),
  'all routed real user-owner events satisfy the strict Planning input validator'
)
from outbox.events as event
where event.workspace_id = (
  select (response->>'workspaceId')::uuid from routing_results where result_name = 'plan'
)
  and event.event_name in (
    'overlay.custom_activity_added', 'sessions.focus_started',
    'sessions.focus_completed', 'sessions.focus_stopped',
    'evidence.observation_invalidated'
  );
reset role;

select is(
  (
    select count(*)::integer
    from outbox.events as event
    join outbox.deliveries as delivery on delivery.event_id = event.event_id
    where event.workspace_id = (
      select (response->>'workspaceId')::uuid from routing_results where result_name = 'plan'
    )
      and event.event_name = 'evidence.observation_appended'
      and delivery.consumer_name = 'planning.plan_snapshot_v1'
  ),
  0,
  'raw evidence append remains outside the Planning ledger'
);

create function reject_planning_delivery_for_test()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.consumer_name = 'planning.plan_snapshot_v1'
    and pg_catalog.current_setting('pando.test.reject_planning_delivery', true) = 'on'
  then
    raise exception 'injected Planning route failure';
  end if;
  return new;
end
$function$;
create trigger reject_planning_delivery_for_test
before insert on outbox.deliveries
for each row execute function reject_planning_delivery_for_test();

select set_config('pando.test.reject_planning_delivery', 'on', true);
select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '2b000000-0000-4000-8000-000000000001',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text,
  true
);
set local role authenticated;
select throws_ok(
  $$select api.add_current_custom_activity_v1(
    'goal:planning-routing', 'activity:planning-routing-rollback',
    'Rolled-back routing activity', 'MANUAL_CODING', 'competency:python-error-handling',
    '1', 'phase4a-routing-rollback'
  )$$,
  'P0001', 'injected Planning route failure',
  'a Planning routing failure aborts the complete owner command transaction'
);
reset role;
select set_config('pando.test.reject_planning_delivery', '', true);

select ok(
  not exists (
    select 1 from overlay.custom_activities
    where activity_key = 'activity:planning-routing-rollback'
  )
  and not exists (
    select 1 from outbox.events
    where payload->>'activity_key' = 'activity:planning-routing-rollback'
  )
  and not exists (
    select 1 from outbox.command_receipts
    where idempotency_key = 'phase4a-routing-rollback'
  ),
  'routing failure rolls back owner state, source event, and command receipt together'
);

create temporary table routing_context as
select
  (result.response->>'workspaceId')::uuid as workspace_id,
  event.command_id,
  event.correlation_id,
  event.event_id as causation_id
from routing_results as result
join outbox.events as event
  on event.event_id = (result.response->'emittedEventIds'->>0)::uuid
where result.result_name = 'plan';

insert into outbox.events (
  event_id, event_name, event_schema_version, workspace_id, aggregate_type,
  aggregate_id, aggregate_version, actor_type, actor_user_id, command_id,
  correlation_id, causation_id, occurred_at, source, payload
)
select
  '2b000000-0000-4000-8000-000000000010',
  'targets.readiness_projection_changed', 1, context.workspace_id,
  'targets.readiness_projection', '2b000000-0000-4000-8000-000000000011', 1,
  'system', null, context.command_id, context.correlation_id, context.causation_id,
  clock_timestamp(), 'pando.readiness_worker',
  pg_catalog.jsonb_build_object(
    'readiness_goal_id', '2b000000-0000-4000-8000-000000000011',
    'profile_version_id', '2b000000-0000-4000-8000-000000000012',
    'snapshot_id', '2b000000-0000-4000-8000-000000000013',
    'projection_version', '1',
    'input_fingerprint',
      'readiness-input:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'source_evidence_watermark', '0', 'calculated_as_of', clock_timestamp(),
    'status', 'DEVELOPING', 'lower', 0, 'upper', 1, 'confidence', 'MEDIUM',
    'engine_version', 'readiness-engine/0.1.0',
    'policy_version', 'mastery-readiness-policy/0.1'
  )
from routing_context as context;

insert into outbox.events (
  event_id, event_name, event_schema_version, workspace_id, aggregate_type,
  aggregate_id, aggregate_version, actor_type, actor_user_id, command_id,
  correlation_id, causation_id, occurred_at, source, payload
)
select
  '2b000000-0000-4000-8000-000000000020',
  'mastery.competency_state_changed', 1, context.workspace_id,
  null, null, null, 'system', null, context.command_id, context.correlation_id,
  context.causation_id, clock_timestamp(), 'pando.mastery_worker',
  pg_catalog.jsonb_build_object(
    'competency_ref', 'competency:python-typing',
    'snapshot_id', '2b000000-0000-4000-8000-000000000021',
    'projection_generation', 'live-v1', 'input_watermark', '1',
    'achievement_level', 'VERIFIED', 'engine_version', 'mastery-engine/0.1.0',
    'policy_version', 'mastery-readiness-policy/0.1',
    'calculated_as_of', clock_timestamp()
  )
from routing_context as context;

insert into outbox.events (
  event_id, event_name, event_schema_version, workspace_id, aggregate_type,
  aggregate_id, aggregate_version, actor_type, actor_user_id, command_id,
  correlation_id, causation_id, occurred_at, source, payload
)
select
  '2b000000-0000-4000-8000-000000000030',
  'review.item_changed', 1, context.workspace_id, 'review.subject',
  '2b000000-0000-4000-8000-000000000031', 1, 'system', null,
  context.command_id, context.correlation_id, context.causation_id,
  clock_timestamp(), 'pando.review_worker',
  pg_catalog.jsonb_build_object(
    'subject_id', '2b000000-0000-4000-8000-000000000031',
    'subject_ref', 'competency:python-typing/application',
    'subject_type', 'COMPETENCY_DIMENSION',
    'competency_ref', 'competency:python-typing', 'dimension', 'APPLICATION',
    'subject_version', '1', 'effective_due_at', clock_timestamp() + interval '1 day',
    'active_reason_types', pg_catalog.jsonb_build_array('GOAL_DEADLINE'),
    'projection_status', 'CURRENT'
  )
from routing_context as context;

set local role pando_planning_router;
select is(
  (
    select count(*)::integer
    from outbox.events as event
    where event.event_id in (
      '2b000000-0000-4000-8000-000000000010',
      '2b000000-0000-4000-8000-000000000020',
      '2b000000-0000-4000-8000-000000000030'
    )
      and planning.plan_snapshot_event_is_valid_v1(event)
  ),
  3,
  'all three projection-owner envelopes satisfy the strict valid and boundary cases'
);

do $route_projection_events$
declare
  v_event_id uuid;
begin
  for v_event_id in
    select event_id from outbox.events
    where event_id in (
      '2b000000-0000-4000-8000-000000000010',
      '2b000000-0000-4000-8000-000000000020'
    )
  loop
    perform outbox.enqueue_plan_snapshot_source_delivery_v1(v_event_id);
    perform outbox.enqueue_plan_snapshot_source_delivery_v1(v_event_id);
  end loop;
end
$route_projection_events$;
reset role;

create temporary table routing_backfill_results (
  run_number integer primary key,
  response jsonb not null
);
grant select, insert on routing_backfill_results to pando_planning_router;

set local role pando_planning_router;
insert into routing_backfill_results values (
  1, outbox.backfill_plan_snapshot_source_deliveries_v1(0, 500)
);
insert into routing_backfill_results values (
  2, outbox.backfill_plan_snapshot_source_deliveries_v1(0, 500)
);

select ok(
  (select (response->>'processedCount')::integer between 1 and 500
   from routing_backfill_results where run_number = 1)
  and (select (response->>'complete')::boolean
       from routing_backfill_results where run_number = 1),
  'the rollout repair is observable, bounded, and reaches an explicit terminal cursor'
);
select is(
  (select response->>'nextAfterEventPosition'
   from routing_backfill_results where run_number = 2),
  (select response->>'nextAfterEventPosition'
   from routing_backfill_results where run_number = 1),
  'replaying the rollout repair cursor range is idempotent'
);
select throws_ok(
  $$select outbox.backfill_plan_snapshot_source_deliveries_v1(0, 501)$$,
  '22023', 'Planning source backfill batch size must be between 1 and 500',
  'the rollout repair rejects an unbounded batch'
);

select is(
  (
    select count(*)::integer from outbox.deliveries
    where event_id in (
      '2b000000-0000-4000-8000-000000000010',
      '2b000000-0000-4000-8000-000000000020',
      '2b000000-0000-4000-8000-000000000030'
    )
      and consumer_name = 'planning.plan_snapshot_v1'
      and handler_contract_version = 1
  ),
  3,
  'projection-owner events route once across direct replay and bounded backfill'
);
select is(
  (
    select count(*)::integer
    from outbox.deliveries
    where event_id = (
      select (response->'emittedEventIds'->>0)::uuid
      from routing_results where result_name = 'no-plan-overlay'
    )
      and consumer_name = 'planning.plan_snapshot_v1'
  ),
  1,
  'the explicit rollout repair may route accepted history after a sentinel is later created'
);
reset role;

create temporary table malicious_source_events (
  event_id uuid primary key,
  event_name text not null unique
);
grant select on malicious_source_events to pando_planning_router;

with representatives as (
  select distinct on (event.event_name) event.*
  from outbox.events as event
  where event.workspace_id = (
    select (response->>'workspaceId')::uuid
    from routing_results where result_name = 'plan'
  )
    and event.event_name in (
      'targets.readiness_projection_changed', 'mastery.competency_state_changed',
      'review.item_changed', 'overlay.custom_activity_added', 'sessions.focus_started',
      'sessions.focus_completed', 'sessions.focus_stopped',
      'evidence.observation_invalidated'
    )
  order by event.event_name, event.event_position
), inserted as (
  insert into outbox.events (
    event_id, event_name, event_schema_version, workspace_id, aggregate_type,
    aggregate_id, aggregate_version, actor_type, actor_user_id, command_id,
    correlation_id, causation_id, occurred_at, source, payload, metadata
  )
  select
    gen_random_uuid(), event_name, event_schema_version, workspace_id, aggregate_type,
    aggregate_id, aggregate_version, actor_type, actor_user_id, command_id,
    correlation_id, causation_id, clock_timestamp(), source,
    payload || '{"__proto__":{"polluted":true}}'::jsonb, metadata
  from representatives
  returning event_id, event_name
)
insert into malicious_source_events select event_id, event_name from inserted;

set local role pando_planning_router;
select is(
  (
    select count(*)::integer
    from outbox.events as event
    join malicious_source_events as malicious using (event_id)
    where planning.plan_snapshot_event_is_valid_v1(event)
  ),
  0,
  'all eight owner-event branches reject an unexpected malicious payload key'
);
select throws_ok(
  pg_catalog.format(
    'select outbox.enqueue_plan_snapshot_source_delivery_v1(%L::uuid)',
    (select event_id from malicious_source_events
     where event_name = 'mastery.competency_state_changed')
  ),
  '22023', 'Planning source event contract is invalid',
  'the router refuses a malicious source envelope before delivery insertion'
);
reset role;

create function complete_due_planning_batches_for_test(
  p_fingerprint_character text
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_claim record;
  v_load jsonb;
  v_fingerprint text;
  v_completion text;
  v_count integer := 0;
begin
  v_fingerprint := 'planning-input:' || pg_catalog.repeat(p_fingerprint_character, 64);
  for v_claim in select * from api.claim_plan_snapshot_projection_v1() loop
    v_load := api.load_plan_snapshot_projection_v1(
      v_claim.delivery_id, v_claim.lease_token, v_claim.attempt_id
    );
    perform api.record_plan_snapshot_input_v1(
      v_claim.delivery_id,
      v_claim.lease_token,
      (v_load->>'attemptId')::uuid,
      v_load->>'sourceFence',
      pg_catalog.jsonb_build_object(
        'inputFingerprint', v_fingerprint,
        'evaluationHorizon', pg_catalog.jsonb_build_object(
          'asOf', v_load->'claimAsOf',
          'validUntil', v_load#>'{sourceBundle,calendar,validUntil}',
          'timeZone', v_load#>'{sourceBundle,calendar,timeZone}',
          'weekStart', v_load#>'{sourceBundle,calendar,weekStart}',
          'weekEnd', v_load#>'{sourceBundle,calendar,weekEnd}'
        ),
        'growthPlan', pg_catalog.jsonb_build_object(
          'growthPlanId', v_load#>'{sourceBundle,plan,growthPlanId}'
        )
      )
    );
    v_completion := api.complete_plan_snapshot_projection_v1(
      v_claim.delivery_id,
      v_claim.lease_token,
      (v_load->>'attemptId')::uuid,
      pg_catalog.jsonb_build_object(
        'engineVersion', 'planner-engine/0.1.0',
        'policyVersion', 'planning-policy/0.1',
        'inputFingerprint', v_fingerprint,
        'calculatedAsOf', v_load->'claimAsOf',
        'validUntil', v_load#>'{sourceBundle,calendar,validUntil}',
        'timeZone', v_load#>'{sourceBundle,calendar,timeZone}',
        'weekStart', v_load#>'{sourceBundle,calendar,weekStart}',
        'weekEnd', v_load#>'{sourceBundle,calendar,weekEnd}',
        'recommendationState', 'NO_CANDIDATES',
        'warningCodes', '[]'::jsonb,
        'capacity', pg_catalog.jsonb_build_object(
          'weeklyCapacityMinutes', 300,
          'consumedMinutesThisWeek', 0,
          'remainingMinutesThisWeek', 300,
          'sessionLimitMinutes', null
        ),
        'reviewSummary', pg_catalog.jsonb_build_object(
          'projectionState', 'NOT_STARTED',
          'overdueCount', 0,
          'dueTodayCount', 0,
          'validUntil', null
        ),
        'nearestDeadline', null,
        'readiness', '[]'::jsonb,
        'actions', '[]'::jsonb
      )
    );
    if v_completion <> 'APPLIED' then
      raise exception 'unexpected Planning completion result %', v_completion;
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end
$function$;

update outbox.deliveries
set available_at = pg_catalog.clock_timestamp() + interval '1 day'
where consumer_name = 'planning.plan_snapshot_v1'
  and workspace_id <> (
    select (response->>'workspaceId')::uuid from routing_results where result_name = 'plan'
  )
  and delivery_state in ('pending', 'retry');

set local role service_role;
select is(
  complete_due_planning_batches_for_test('c'),
  1,
  'the real Planning persistence worker drains the affected workspace before repair'
);
reset role;

insert into outbox.events (
  event_id, event_name, event_schema_version, workspace_id, aggregate_type,
  aggregate_id, aggregate_version, actor_type, actor_user_id, command_id,
  correlation_id, causation_id, occurred_at, source, payload
)
select
  '2b000000-0000-4000-8000-000000000041', event_name, event_schema_version,
  workspace_id, aggregate_type, aggregate_id, aggregate_version, actor_type,
  actor_user_id, command_id, correlation_id, causation_id, clock_timestamp(),
  source, pg_catalog.jsonb_set(payload, '{calculated_as_of}', '"not-an-instant"'::jsonb)
from outbox.events
where event_id = '2b000000-0000-4000-8000-000000000020';

insert into outbox.events (
  event_id, event_name, event_schema_version, workspace_id, aggregate_type,
  aggregate_id, aggregate_version, actor_type, actor_user_id, command_id,
  correlation_id, causation_id, occurred_at, source, payload
)
select
  '2b000000-0000-4000-8000-000000000042', event_name, event_schema_version,
  workspace_id, aggregate_type, aggregate_id, aggregate_version, actor_type,
  actor_user_id, command_id, correlation_id, causation_id, clock_timestamp(),
  source, pg_catalog.jsonb_set(payload, '{calculated_as_of}', 'null'::jsonb)
from outbox.events
where event_id = '2b000000-0000-4000-8000-000000000020';

set local role pando_planning_router;
select is(
  (
    select planning.plan_snapshot_event_is_valid_v1(event)
    from outbox.events as event
    where event.event_id = '2b000000-0000-4000-8000-000000000041'
  ),
  false,
  'a malformed instant returns false instead of escaping a cast error'
);
select is(
  (
    select planning.plan_snapshot_event_is_valid_v1(event)
    from outbox.events as event
    where event.event_id = '2b000000-0000-4000-8000-000000000042'
  ),
  false,
  'a required JSON null is rejected as false rather than becoming SQL null'
);
select throws_ok(
  $$select outbox.enqueue_plan_snapshot_source_delivery_v1(
    '2b000000-0000-4000-8000-000000000042'
  )$$,
  '22023', 'Planning source event contract is invalid',
  'the router rejects a required JSON null before delivery insertion'
);
reset role;

select throws_like(
  pg_catalog.format(
    'select outbox.backfill_plan_snapshot_source_deliveries_v1(%s, 500)',
    (
      select pg_catalog.min(event_position) - 1
      from outbox.events
      where event_id in (
        '2b000000-0000-4000-8000-000000000041',
        '2b000000-0000-4000-8000-000000000042'
      )
    )
  ),
  '%Planning source backfill failed at event_position%event_id%Planning source event contract is invalid%',
  'rollout repair stops visibly at an unreviewed malformed immutable event'
);

select throws_ok(
  $$select outbox.quarantine_invalid_plan_snapshot_source_event_v1(
    '2b000000-0000-4000-8000-000000000020',
    'The reviewed event is intentionally retained as malformed.',
    'PANDO-ROUTING-VALID-CONTROL',
    'phase4a-quarantine-valid-control'
  )$$,
  '22023', 'A valid Planning source event cannot be quarantined',
  'the administrator repair command refuses to quarantine a valid event'
);

select set_config('pando.test.reject_planning_delivery', 'on', true);
select throws_ok(
  $$select outbox.quarantine_invalid_plan_snapshot_source_event_v1(
    '2b000000-0000-4000-8000-000000000041',
    'Historical calculated_as_of was not an RFC3339 instant.',
    'PANDO-ROUTING-REVIEW-41',
    'phase4a-quarantine-rollback'
  )$$,
  'P0001', 'injected Planning route failure',
  'repair-delivery failure aborts the complete administrator command transaction'
);
select set_config('pando.test.reject_planning_delivery', '', true);

select ok(
  not exists (
    select 1 from planning.plan_snapshot_source_quarantines
    where event_id = '2b000000-0000-4000-8000-000000000041'
  )
  and not exists (
    select 1 from outbox.events
    where event_name = 'planning.source_event_quarantined'
      and causation_id = '2b000000-0000-4000-8000-000000000041'
  )
  and not exists (
    select 1 from outbox.command_receipts
    where command_type = 'planning.quarantine_invalid_source_event'
      and idempotency_key = 'phase4a-quarantine-rollback'
  ),
  'delivery failure rolls back the quarantine audit, repair event, and command receipt'
);

create temporary table routing_quarantine_results (
  event_id uuid primary key,
  response jsonb not null
);

insert into routing_quarantine_results values
  (
    '2b000000-0000-4000-8000-000000000041',
    outbox.quarantine_invalid_plan_snapshot_source_event_v1(
      '2b000000-0000-4000-8000-000000000041',
      'Historical calculated_as_of was not an RFC3339 instant.',
      'PANDO-ROUTING-REVIEW-41',
      'phase4a-quarantine-41'
    )
  ),
  (
    '2b000000-0000-4000-8000-000000000042',
    outbox.quarantine_invalid_plan_snapshot_source_event_v1(
      '2b000000-0000-4000-8000-000000000042',
      'Historical calculated_as_of was stored as JSON null.',
      'PANDO-ROUTING-REVIEW-42',
      'phase4a-quarantine-42'
    )
  );

select is(
  outbox.quarantine_invalid_plan_snapshot_source_event_v1(
    '2b000000-0000-4000-8000-000000000041',
    'Historical calculated_as_of was not an RFC3339 instant.',
    'PANDO-ROUTING-REVIEW-41',
    'phase4a-quarantine-41'
  )->>'eventId',
  '2b000000-0000-4000-8000-000000000041',
  'an exact quarantine replay is idempotent'
);

select throws_ok(
  $$select outbox.quarantine_invalid_plan_snapshot_source_event_v1(
    '2b000000-0000-4000-8000-000000000041',
    'A changed request must conflict with the same idempotency key.',
    'PANDO-ROUTING-REVIEW-41',
    'phase4a-quarantine-41'
  )$$,
  '22023', 'idempotency key reused with a different request',
  'the administrator command rejects changed payload under the same idempotency key'
);

select ok(
  (
    select bool_and(
      response ? 'repairEventId'
      and response ? 'repairDeliveryId'
      and response->>'reviewReference' in (
        'PANDO-ROUTING-REVIEW-41', 'PANDO-ROUTING-REVIEW-42'
      )
    )
    from routing_quarantine_results
  ),
  'every reviewed quarantine returns its explicit current-state repair wake-up'
);

select throws_ok(
  $$select outbox.quarantine_invalid_plan_snapshot_source_event_v1(
    '2b000000-0000-4000-8000-000000000041',
    'A conflicting rationale must not rewrite immutable audit history.',
    'PANDO-ROUTING-REVIEW-41',
    'phase4a-quarantine-41-conflict'
  )$$,
  '23505', 'Planning source event already has a quarantine command',
  'a second administrator command cannot rewrite the reviewed quarantine'
);

select is(
  (
    select count(*)::integer
    from outbox.command_receipts as receipt
    join outbox.events as event on event.command_id = receipt.command_id
    where receipt.command_type = 'planning.quarantine_invalid_source_event'
      and receipt.command_status = 'completed'
      and receipt.causation_id = event.causation_id
      and receipt.correlation_id = event.correlation_id
      and event.event_name = 'planning.source_event_quarantined'
  ),
  2,
  'each repair event has its own completed administrator command provenance'
);

set local role pando_planning_router;
select is(
  (
    select count(*)::integer
    from planning.plan_snapshot_source_quarantines
    where event_id in (
      '2b000000-0000-4000-8000-000000000041',
      '2b000000-0000-4000-8000-000000000042'
    )
  ),
  2,
  'the router RLS policy exposes the two purpose-specific immutable audit rows'
);

select is(
  (
    select count(*)::integer
    from outbox.events as event
    join outbox.deliveries as delivery on delivery.event_id = event.event_id
    where event.event_name = 'planning.source_event_quarantined'
      and event.causation_id in (
        '2b000000-0000-4000-8000-000000000041',
        '2b000000-0000-4000-8000-000000000042'
      )
      and planning.plan_snapshot_event_is_valid_v1(event)
      and delivery.consumer_name = 'planning.plan_snapshot_v1'
      and delivery.handler_contract_version = 1
  ),
  2,
  'each quarantine atomically creates one valid Planning-owned repair delivery'
);
reset role;

create temporary table routing_quarantine_backfill_result (response jsonb not null);
insert into routing_quarantine_backfill_result
select outbox.backfill_plan_snapshot_source_deliveries_v1(
  (
    select pg_catalog.min(event_position) - 1
    from outbox.events
    where event_id in (
      '2b000000-0000-4000-8000-000000000041',
      '2b000000-0000-4000-8000-000000000042'
    )
  ),
  500
);

select ok(
  (select (response->>'complete')::boolean from routing_quarantine_backfill_result)
  and (select (response->>'processedCount')::integer = 2
       from routing_quarantine_backfill_result)
  and (select (response->>'quarantinedCount')::integer = 2
       from routing_quarantine_backfill_result),
  'reviewed quarantine advances the retained cursor and reports every skipped event explicitly'
);

select is(
  (
    select count(*)::integer
    from outbox.deliveries
    where event_id in (
      '2b000000-0000-4000-8000-000000000041',
      '2b000000-0000-4000-8000-000000000042'
    )
      and consumer_name = 'planning.plan_snapshot_v1'
  ),
  0,
  'quarantined malformed history never creates a Planning delivery'
);

set local role service_role;
select is(
  complete_due_planning_batches_for_test('d'),
  1,
  'the real Planning worker claims, loads, records, and completes the repair-event batch'
);
reset role;

select is(
  (
    select count(*)::integer
    from routing_quarantine_results as quarantine_result
    join outbox.deliveries as delivery
      on delivery.delivery_id = (quarantine_result.response->>'repairDeliveryId')::uuid
    join outbox.consumer_receipts as receipt on receipt.delivery_id = delivery.delivery_id
    where delivery.delivery_state = 'succeeded'
      and receipt.consumer_name = 'planning.plan_snapshot_v1'
      and receipt.handler_contract_version = 1
  ),
  2,
  'repair wake-ups are durably covered after current authoritative state is reloaded'
);

set local role pando_planning_router;
select is(
  (
    select count(*)::integer
    from outbox.events as event
    join planning.current_plan_snapshots as pointer
      on pointer.workspace_id = event.workspace_id
    left join outbox.deliveries as delivery
      on delivery.event_id = event.event_id
      and delivery.consumer_name = 'planning.plan_snapshot_v1'
      and delivery.handler_contract_version = 1
    where event.event_schema_version = 1
      and event.event_name in (
        'targets.readiness_projection_changed', 'mastery.competency_state_changed',
        'review.item_changed', 'overlay.custom_activity_added', 'sessions.focus_started',
        'sessions.focus_completed', 'sessions.focus_stopped',
        'evidence.observation_invalidated'
      )
      and planning.plan_snapshot_event_is_valid_v1(event)
      and delivery.delivery_id is null
  ),
  0,
  'every valid accepted source event with a Planning sentinel has its fixed delivery'
);
reset role;

select * from finish();
rollback;
