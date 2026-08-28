begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    '20000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
    'phase2-alice@pando.test', '', clock_timestamp(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    clock_timestamp(), clock_timestamp()
  ),
  (
    '20000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
    'phase2-bob@pando.test', '', clock_timestamp(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    clock_timestamp(), clock_timestamp()
  );

create temporary table phase2_results (
  result_name text primary key,
  response jsonb not null
);
grant select, insert, update on phase2_results to authenticated, service_role;

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '20000000-0000-4000-8000-000000000001',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text, true
);
set local role authenticated;
insert into phase2_results values (
  'alice-bootstrap', api.bootstrap_personal_workspace('phase2-alice-bootstrap', 'Alice Focus')
);
reset role;

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '20000000-0000-4000-8000-000000000002',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text, true
);
set local role authenticated;
insert into phase2_results values (
  'bob-bootstrap', api.bootstrap_personal_workspace('phase2-bob-bootstrap', 'Bob Focus')
);
reset role;

create temporary table phase2_workspaces as
select result_name, (response->>'workspace_id')::uuid as workspace_id
from phase2_results where result_name in ('alice-bootstrap', 'bob-bootstrap');
grant select on phase2_workspaces to authenticated, service_role;

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '20000000-0000-4000-8000-000000000001',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text, true
);
set local role authenticated;
insert into phase2_results
select 'alice-goal', api.create_readiness_goal(
  workspace_id, 'goal:alice-focus', 'Alice Focus readiness',
  'target:nvidia-python-verification-base-v1', 'phase2-alice-goal'
) from phase2_workspaces where result_name = 'alice-bootstrap';
insert into phase2_results values (
  'alice-plan', api.initialize_growth_plan_v1(
    'goal:alice-focus', 300, 25, 80, 60, 'phase2-alice-plan'
  )
);
insert into phase2_results values (
  'alice-activity', api.add_current_custom_activity_v1(
    'goal:alice-focus', 'activity:typing-practice', 'Typing practice', 'MANUAL_CODING',
    'competency:python-typing', '0', 'phase2-alice-activity'
  )
);
reset role;

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '20000000-0000-4000-8000-000000000002',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text, true
);
set local role authenticated;
insert into phase2_results
select 'bob-goal', api.create_readiness_goal(
  workspace_id, 'goal:bob-focus', 'Bob Focus readiness',
  'target:nvidia-python-verification-base-v1', 'phase2-bob-goal'
) from phase2_workspaces where result_name = 'bob-bootstrap';
reset role;

select is(
  (select evidence_dimension from overlay.custom_activities
   where activity_key = 'activity:typing-practice'),
  'APPLICATION',
  'User Overlay derives the evidence dimension from the activity type'
);
select is(
  (select mapping_confidence from overlay.custom_activities
   where activity_key = 'activity:typing-practice'),
  1.000::numeric,
  'the accepted personal mapping confidence is owner-derived rather than caller supplied'
);

create function phase2_reject_injected_outbox_event()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if pg_catalog.current_setting('pando.test.reject_outbox_event', true) = new.event_name then
    raise exception 'injected Phase 2 outbox failure';
  end if;
  return new;
end
$function$;
create trigger phase2_injected_outbox_failure
before insert on outbox.events
for each row execute function phase2_reject_injected_outbox_event();

create function phase2_reject_injected_planning_delivery()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.consumer_name = 'planning.plan_snapshot_v1'
    and pg_catalog.current_setting('pando.test.reject_planning_delivery', true) = 'on'
  then
    raise exception 'injected Mastery Planning delivery failure';
  end if;
  return new;
end
$function$;
create trigger phase2_injected_planning_delivery_failure
before insert on outbox.deliveries
for each row execute function phase2_reject_injected_planning_delivery();

select set_config('pando.test.reject_outbox_event', 'sessions.focus_started', true);
select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '20000000-0000-4000-8000-000000000001',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text, true
);
set local role authenticated;
select throws_ok(
  $$select api.start_focus_activity_v1(
    'goal:alice-focus', 'activity:typing-practice', 25::smallint, 'phase2-rollback-start'
  )$$,
  'P0001', 'injected Phase 2 outbox failure',
  'a failure before outbox append rolls back the complete owning command'
);
reset role;
select set_config('pando.test.reject_outbox_event', '', true);
select is((select count(*) from sessions.focus_sessions), 0::bigint,
  'the injected outbox failure rolls back the Sessions state change');
select is((select count(*) from evidence.activity_attempts), 0::bigint,
  'the injected outbox failure rolls back the Evidence attempt state change');
select is((select count(*) from outbox.command_receipts
  where idempotency_key = 'phase2-rollback-start'), 0::bigint,
  'the injected outbox failure rolls back its command receipt');

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '20000000-0000-4000-8000-000000000001',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text, true
);
set local role authenticated;
insert into phase2_results values (
  'start-success', api.start_focus_activity_v1(
    'goal:alice-focus', 'activity:typing-practice', 25::smallint, 'phase2-start-success'
  )
);
insert into phase2_results values (
  'start-success-replay', api.start_focus_activity_v1(
    'goal:alice-focus', 'activity:typing-practice', 25::smallint, 'phase2-start-success'
  )
);
insert into phase2_results values (
  'workspace-active', api.get_focus_workspace_v1(
    'goal:alice-focus', 'activity:typing-practice'
  )
);
select throws_ok(
  $$select api.start_focus_activity_v1(
    'goal:alice-focus', 'activity:typing-practice', 30::smallint, 'phase2-start-success'
  )$$,
  '22023', 'idempotency key reused with a different request',
  'a start idempotency key rejects a changed request hash'
);
select throws_ok(
  $$select api.start_focus_activity_v1(
    'goal:alice-focus', 'activity:typing-practice', 30::smallint, 'phase2-start-conflict'
  )$$,
  '40001', 'an active focus session already exists',
  'only one active FocusSession can exist in a workspace'
);
reset role;

select is(
  (select response from phase2_results where result_name = 'start-success-replay'),
  (select response from phase2_results where result_name = 'start-success'),
  'same start idempotency key and request replay the exact stored response'
);
select is(
  (select count(*) from sessions.focus_sessions
   where workspace_id = (select workspace_id from phase2_workspaces
     where result_name = 'alice-bootstrap')),
  1::bigint,
  'start creates exactly one Sessions-owned FocusSession'
);
select is(
  (select count(*) from evidence.activity_attempts
   where workspace_id = (select workspace_id from phase2_workspaces
     where result_name = 'alice-bootstrap')),
  1::bigint,
  'start atomically creates exactly one Evidence-owned ActivityAttempt'
);
select is(
  (select count(*) from evidence.observations),
  0::bigint,
  'ActivityStarted is operational and does not enter the evidence ledger'
);
select is(
  (select response->'activeSession'->>'state' from phase2_results
   where result_name = 'workspace-active'),
  'active',
  'Focus can reload the active session immediately after start'
);
select is(
  (select pg_catalog.jsonb_array_length(response->'history') from phase2_results
   where result_name = 'workspace-active'),
  0,
  'the active attempt is excluded from terminal Focus history'
);

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '20000000-0000-4000-8000-000000000002',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text, true
);
set local role authenticated;
select throws_ok(
  format(
    'select api.finish_focus_activity_v1(%L::uuid,1,%L,%L,false,%L)',
    (select response->>'focusSessionId' from phase2_results where result_name = 'start-success'),
    'COMPLETE', 'OBSERVED_SUCCESS', 'phase2-bob-foreign-finish'
  ),
  '42501', 'focus session is not accessible',
  'a foreign focus-session identifier is indistinguishable from an inaccessible session'
);
reset role;

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '20000000-0000-4000-8000-000000000001',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text, true
);
set local role authenticated;
insert into phase2_results
select 'finish-success', api.finish_focus_activity_v1(
  (response->>'focusSessionId')::uuid, 1, 'COMPLETE', 'OBSERVED_SUCCESS', false,
  'phase2-finish-success'
) from phase2_results where result_name = 'start-success';
insert into phase2_results
select 'finish-success-replay', api.finish_focus_activity_v1(
  (response->>'focusSessionId')::uuid, 1, 'COMPLETE', 'OBSERVED_SUCCESS', false,
  'phase2-finish-success'
) from phase2_results where result_name = 'start-success';
select throws_ok(
  format(
    'select api.finish_focus_activity_v1(%L::uuid,1,%L,%L,false,%L)',
    (select response->>'focusSessionId' from phase2_results where result_name = 'start-success'),
    'COMPLETE', 'OBSERVED_FAILURE', 'phase2-finish-success'
  ),
  '22023', 'idempotency key reused with a different request',
  'a finish idempotency key rejects a changed request hash'
);
reset role;

select is(
  (select response from phase2_results where result_name = 'finish-success-replay'),
  (select response from phase2_results where result_name = 'finish-success'),
  'same finish idempotency key and request replay the exact response'
);
select is((select count(*) from evidence.observations), 1::bigint,
  'an explicit observed result appends exactly one normalized evidence event');
select is((select count(*) from outbox.deliveries
  where consumer_name = 'mastery.evidence_projection_v1'), 1::bigint,
  'evidence append atomically creates one fixed Mastery delivery');
select is((select engagement from evidence.observations), 'INDEPENDENT',
  'manual coding without a hint becomes independent engagement');
select is((select source_reliability from evidence.observations), 0.600::numeric,
  'manual observation reliability is server-derived at the accepted policy floor');
select ok((select target_relevant from evidence.observations),
  'applied performance attached to the selected target records immutable target relevance');

-- Bare completion remains in operational history but adds no evidence or Mastery delivery.
select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '20000000-0000-4000-8000-000000000001',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text, true
);
set local role authenticated;
insert into phase2_results values (
  'start-completion-only', api.start_focus_activity_v1(
    'goal:alice-focus', 'activity:typing-practice', 15::smallint, 'phase2-start-completion-only'
  )
);
insert into phase2_results
select 'finish-completion-only', api.finish_focus_activity_v1(
  (response->>'focusSessionId')::uuid, 1, 'COMPLETE', 'COMPLETION_ONLY', false,
  'phase2-finish-completion-only'
) from phase2_results where result_name = 'start-completion-only';
reset role;
select is((select count(*) from evidence.observations), 1::bigint,
  'bare completion appends no evidence');
select is((select count(*) from outbox.deliveries
  where consumer_name = 'mastery.evidence_projection_v1'), 1::bigint,
  'bare completion creates no Mastery delivery');

-- Stop preserves history and likewise creates no evidence.
select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '20000000-0000-4000-8000-000000000001',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text, true
);
set local role authenticated;
insert into phase2_results values (
  'start-stop', api.start_focus_activity_v1(
    'goal:alice-focus', 'activity:typing-practice', 10::smallint, 'phase2-start-stop'
  )
);
insert into phase2_results
select 'finish-stop', api.finish_focus_activity_v1(
  (response->>'focusSessionId')::uuid, 1, 'STOP', null, null, 'phase2-finish-stop'
) from phase2_results where result_name = 'start-stop';
reset role;
select is((select count(*) from evidence.observations), 1::bigint,
  'stopping Focus creates no evidence');
select is((select count(*) from sessions.focus_sessions where state = 'stopped'), 1::bigint,
  'stopping Focus preserves a terminal operational history row');

-- Invalidation is an immutable revision and enqueues recalculation.
select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '20000000-0000-4000-8000-000000000001',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text, true
);
set local role authenticated;
insert into phase2_results
select 'invalidate', api.invalidate_evidence_v1(
  (response->>'evidenceId')::uuid, 'The recorded outcome was incorrect.',
  'phase2-invalidate-success'
) from phase2_results where result_name = 'finish-success';
insert into phase2_results
select 'invalidate-replay', api.invalidate_evidence_v1(
  (response->>'evidenceId')::uuid, 'The recorded outcome was incorrect.',
  'phase2-invalidate-success'
) from phase2_results where result_name = 'finish-success';
select throws_ok(
  format(
    'select api.invalidate_evidence_v1(%L::uuid,%L,%L)',
    (select response->>'evidenceId' from phase2_results where result_name = 'finish-success'),
    'A different correction reason.', 'phase2-invalidate-success'
  ),
  '22023', 'idempotency key reused with a different request',
  'an invalidation idempotency key rejects a changed request hash'
);
insert into phase2_results values (
  'workspace-pending', api.get_focus_workspace_v1(
    'goal:alice-focus', 'activity:typing-practice'
  )
);
reset role;

select is(
  (select response from phase2_results where result_name = 'invalidate-replay'),
  (select response from phase2_results where result_name = 'invalidate'),
  'same invalidation key and request replay the exact stored response'
);

select is((select count(*) from evidence.observations), 1::bigint,
  'invalidation never rewrites or removes the original observation');
select is((select count(*) from evidence.corrections), 1::bigint,
  'invalidation appends exactly one immutable correction');
select is((select ledger_version from evidence.subject_ledgers), 2::bigint,
  'append and invalidation advance the authoritative evidence watermark');
select is((select count(*) from outbox.deliveries
  where consumer_name = 'mastery.evidence_projection_v1'), 2::bigint,
  'invalidation atomically enqueues a second recalculation delivery');
select is((select response->>'projectionState' from phase2_results
  where result_name = 'workspace-pending'), 'pending',
  'Focus reports pending rather than claiming a projection update early');
select is((select pg_catalog.jsonb_array_length(response->'history') from phase2_results
  where result_name = 'workspace-pending'), 3,
  'Focus history composes completed, completion-only, and stopped sessions');
select throws_ok(
  $$update evidence.observations set outcome = 'FAILURE'$$,
  '55000', 'evidence ledger rows are immutable',
  'the original evidence row rejects mutation even by the migration owner'
);
select throws_ok(
  $$delete from evidence.corrections$$,
  '55000', 'evidence ledger rows are immutable',
  'correction history rejects deletion'
);

-- The service-only worker reloads the active ledger and applies a watermark-fenced snapshot.
create temporary table phase2_claims as
select * from api.claim_mastery_evidence_projection_v1() with no data;
grant select, insert on phase2_claims to service_role;
create temporary table phase2_worker_inputs (
  delivery_id uuid primary key,
  response jsonb not null
);
grant select, insert on phase2_worker_inputs to service_role;

set local role service_role;
insert into phase2_claims select * from api.claim_mastery_evidence_projection_v1();
insert into phase2_worker_inputs
select claim.delivery_id,
  api.load_mastery_evidence_projection_v1(claim.delivery_id, claim.lease_token)
from phase2_claims as claim;
reset role;

select is((select count(*) from phase2_claims), 2::bigint,
  'the fixed worker claims both due Mastery deliveries without caller-selected scope');
select is((select response->>'inputWatermark' from phase2_worker_inputs limit 1), '2',
  'worker input reloads the current authoritative ledger watermark');
select ok((select bool_and((response->'evidence'->0->>'invalidated')::boolean)
  from phase2_worker_inputs),
  'worker input folds the immutable correction over the original evidence');

set local role service_role;
insert into phase2_results
select 'worker-complete-' || claim.delivery_id::text,
  pg_catalog.to_jsonb(api.complete_mastery_evidence_projection_v1(
    claim.delivery_id, claim.lease_token, claim.event_position,
    (input.response->>'inputWatermark')::bigint,
    pg_catalog.jsonb_build_object(
      'engineVersion', 'mastery-engine/0.1.0',
      'policyVersion', 'mastery-readiness-policy/0.1',
      'inputWatermark', input.response->>'inputWatermark',
      'competencyId', input.response->>'competencyId',
      'calculatedAsOf', clock_timestamp(),
      'achievementLevel', 'NOT_STARTED',
      'dimensions', '{}'::jsonb,
      'supportingEvidenceIds', '[]'::jsonb,
      'contradictingEvidenceIds', '[]'::jsonb,
      'explanationCodes', '["NO_RELEVANT_EVIDENCE"]'::jsonb
    )
  ))
from phase2_claims as claim
join phase2_worker_inputs as input using (delivery_id);
reset role;

select is((select count(*) from mastery.competency_state_snapshots), 1::bigint,
  'duplicate deliveries at one ledger watermark reuse one immutable Mastery snapshot');
select is((select count(*) from outbox.events
  where event_name = 'mastery.competency_state_changed'), 1::bigint,
  'only the delivery that advances the current pointer emits a Mastery state-change event');
select is((select payload->>'input_watermark' from outbox.events
  where event_name = 'mastery.competency_state_changed'), '2',
  'the privacy-minimized Mastery event identifies its applied evidence watermark');
select ok((select not payload ? 'supportingEvidenceIds' from outbox.events
  where event_name = 'mastery.competency_state_changed'),
  'the Mastery change event does not expose supporting evidence identifiers');
select is((select count(*) from outbox.deliveries as delivery
  join outbox.events as event on event.event_id = delivery.event_id
  where event.event_name = 'mastery.competency_state_changed'
    and delivery.consumer_name = 'planning.plan_snapshot_v1'
    and delivery.handler_contract_version = 1), 1::bigint,
  'real Mastery completion atomically routes its state change to an existing plan');
select is((select count(*) from outbox.consumer_receipts
  where consumer_name = 'mastery.evidence_projection_v1'), 2::bigint,
  'each delivery receives one durable consumer receipt');
select is((select count(*) from outbox.deliveries
  where consumer_name = 'mastery.evidence_projection_v1' and delivery_state = 'succeeded'),
  2::bigint,
  'both fixed deliveries finish successfully');

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '20000000-0000-4000-8000-000000000001',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text, true
);
set local role authenticated;
insert into phase2_results values (
  'workspace-current', api.get_focus_workspace_v1('goal:alice-focus', 'activity:typing-practice')
);
select throws_ok(
  $$select * from evidence.observations$$,
  '42501', 'permission denied for schema evidence',
  'authenticated browser role cannot read the private evidence table directly'
);
reset role;
select is((select response->>'projectionState' from phase2_results
  where result_name = 'workspace-current'), 'current',
  'Focus exposes the current projection only after the watermark is applied');
select is((select response->'masteryState'->>'achievementLevel' from phase2_results
  where result_name = 'workspace-current'), 'NOT_STARTED',
  'the invalidated observation is reflected by the latest explainable state');

-- Worker completion keeps snapshot, pointer, state-change event, receipt, and delivery atomic.
update evidence.subject_ledgers set ledger_version = 3;
insert into outbox.events (
  event_id, event_name, event_schema_version, workspace_id, aggregate_type, aggregate_id,
  aggregate_version, actor_type, actor_user_id, command_id, correlation_id, occurred_at,
  source, payload
)
select '70000000-0000-4000-8000-000000000001', 'evidence.observation_appended', 1,
  event.workspace_id, 'evidence.subject_ledger', event.workspace_id, 3,
  'system', null, event.command_id, event.correlation_id, clock_timestamp(), 'pando.database',
  pg_catalog.jsonb_build_object(
    'evidence_id', (select evidence_id from evidence.observations limit 1),
    'competency_ref', 'competency:python-typing', 'ledger_watermark', '3'
  )
from outbox.events as event
where event.event_name = 'evidence.observation_invalidated'
limit 1;
insert into outbox.deliveries (event_id, workspace_id, consumer_name, handler_contract_version)
select event_id, workspace_id, 'mastery.evidence_projection_v1', 1
from outbox.events where event_id = '70000000-0000-4000-8000-000000000001';
create temporary table phase2_edge_claims as
select * from api.claim_mastery_evidence_projection_v1() with no data;
grant select, insert, truncate on phase2_edge_claims to service_role;
set local role service_role;
insert into phase2_edge_claims select * from api.claim_mastery_evidence_projection_v1();
reset role;
select set_config('pando.test.reject_planning_delivery', 'on', true);
set local role service_role;
select throws_ok(
  format(
    'select api.complete_mastery_evidence_projection_v1(%L::uuid,%L::uuid,%s,3,%L::jsonb)',
    (select delivery_id from phase2_edge_claims limit 1),
    (select lease_token from phase2_edge_claims limit 1),
    (select event_position from phase2_edge_claims limit 1),
    pg_catalog.jsonb_build_object(
      'engineVersion', 'mastery-engine/0.1.0',
      'policyVersion', 'mastery-readiness-policy/0.1',
      'inputWatermark', '3', 'competencyId', 'competency:python-typing',
      'calculatedAsOf', clock_timestamp(), 'achievementLevel', 'NOT_STARTED',
      'dimensions', '{}'::jsonb, 'supportingEvidenceIds', '[]'::jsonb,
      'contradictingEvidenceIds', '[]'::jsonb,
      'explanationCodes', '["NO_RELEVANT_EVIDENCE"]'::jsonb
    )::text
  ),
  'P0001', 'injected Mastery Planning delivery failure',
  'an injected Mastery Planning route failure rolls back the entire worker completion'
);
reset role;
select set_config('pando.test.reject_planning_delivery', '', true);
select is((select count(*) from mastery.competency_state_snapshots), 1::bigint,
  'failed worker completion leaves no partial snapshot');
select is((select input_watermark from mastery.current_competency_states), 2::bigint,
  'failed worker completion leaves the prior current pointer unchanged');
select is((select count(*) from outbox.consumer_receipts
  where delivery_id = (select delivery_id from phase2_edge_claims limit 1)), 0::bigint,
  'failed worker completion leaves no consumer receipt');
select is((select delivery_state from outbox.deliveries
  where delivery_id = (select delivery_id from phase2_edge_claims limit 1)), 'leased',
  'failed worker completion leaves the durable lease recoverable');
set local role service_role;
select api.fail_mastery_evidence_projection_v1(
  (select delivery_id from phase2_edge_claims limit 1),
  (select lease_token from phase2_edge_claims limit 1),
  'TRANSIENT', 'INJECTED_OUTBOX_FAILURE'
);
reset role;
update outbox.deliveries set delivery_state = 'dead_letter', dead_lettered_at = clock_timestamp()
where delivery_id = (select delivery_id from phase2_edge_claims limit 1);
update evidence.subject_ledgers set ledger_version = 2;

-- The apply boundary fences a stale ledger watermark without writing projection state.
insert into outbox.events (
  event_id, event_name, event_schema_version, workspace_id, aggregate_type, aggregate_id,
  aggregate_version, actor_type, actor_user_id, command_id, correlation_id, occurred_at,
  source, payload
)
select '70000000-0000-4000-8000-000000000002', 'evidence.observation_appended', 1,
  event.workspace_id, 'evidence.subject_ledger', event.workspace_id, 2,
  'system', null, event.command_id, event.correlation_id, clock_timestamp(), 'pando.database',
  pg_catalog.jsonb_build_object(
    'evidence_id', (select evidence_id from evidence.observations limit 1),
    'competency_ref', 'competency:python-typing', 'ledger_watermark', '2'
  )
from outbox.events as event
where event.event_name = 'evidence.observation_invalidated'
limit 1;
insert into outbox.deliveries (event_id, workspace_id, consumer_name, handler_contract_version)
select event_id, workspace_id, 'mastery.evidence_projection_v1', 1
from outbox.events where event_id = '70000000-0000-4000-8000-000000000002';
truncate phase2_edge_claims;
set local role service_role;
insert into phase2_edge_claims select * from api.claim_mastery_evidence_projection_v1();
reset role;
update evidence.subject_ledgers set ledger_version = 3;
set local role service_role;
select is(
  api.complete_mastery_evidence_projection_v1(
    (select delivery_id from phase2_edge_claims limit 1),
    (select lease_token from phase2_edge_claims limit 1),
    (select event_position from phase2_edge_claims limit 1), 2,
    pg_catalog.jsonb_build_object(
      'engineVersion', 'mastery-engine/0.1.0',
      'policyVersion', 'mastery-readiness-policy/0.1',
      'inputWatermark', '2', 'competencyId', 'competency:python-typing',
      'calculatedAsOf', clock_timestamp(), 'achievementLevel', 'NOT_STARTED',
      'dimensions', '{}'::jsonb, 'supportingEvidenceIds', '[]'::jsonb,
      'contradictingEvidenceIds', '[]'::jsonb,
      'explanationCodes', '["NO_RELEVANT_EVIDENCE"]'::jsonb
    )
  ),
  false,
  'a changed authoritative ledger watermark rejects stale projection state'
);
select is(
  api.fail_mastery_evidence_projection_v1(
    (select delivery_id from phase2_edge_claims limit 1),
    (select lease_token from phase2_edge_claims limit 1),
    'STALE_INPUT', 'STALE_LEDGER_WATERMARK'
  ),
  'retry',
  'a stale projection remains retryable from authoritative inputs'
);
reset role;
select is((select count(*) from mastery.competency_state_snapshots), 1::bigint,
  'stale completion writes no snapshot');
update outbox.deliveries set delivery_state = 'dead_letter', dead_lettered_at = clock_timestamp()
where delivery_id = (select delivery_id from phase2_edge_claims limit 1);
update evidence.subject_ledgers set ledger_version = 2;

-- Real worker input rejects a malicious producer envelope, not merely a hand-built TS object.
insert into outbox.events (
  event_id, event_name, event_schema_version, workspace_id, aggregate_type, aggregate_id,
  aggregate_version, actor_type, actor_user_id, command_id, correlation_id, occurred_at,
  source, payload
)
select '70000000-0000-4000-8000-000000000003', 'evidence.observation_appended', 1,
  event.workspace_id, 'evidence.subject_ledger', event.workspace_id, 2,
  'system', null, event.command_id, event.correlation_id, clock_timestamp(), 'pando.database',
  '{"competency_ref":"competency:python-typing","ledger_watermark":"2","note":"private"}'::jsonb
from outbox.events as event
where event.event_name = 'evidence.observation_invalidated'
limit 1;
insert into outbox.deliveries (event_id, workspace_id, consumer_name, handler_contract_version)
select event_id, workspace_id, 'mastery.evidence_projection_v1', 1
from outbox.events where event_id = '70000000-0000-4000-8000-000000000003';
truncate phase2_edge_claims;
set local role service_role;
insert into phase2_edge_claims select * from api.claim_mastery_evidence_projection_v1();
select throws_ok(
  format(
    'select api.load_mastery_evidence_projection_v1(%L::uuid,%L::uuid)',
    (select delivery_id from phase2_edge_claims limit 1),
    (select lease_token from phase2_edge_claims limit 1)
  ),
  '22023', 'mastery delivery event contract is invalid',
  'the database worker rejects a malicious Evidence event payload'
);
select is(
  api.fail_mastery_evidence_projection_v1(
    (select delivery_id from phase2_edge_claims limit 1),
    (select lease_token from phase2_edge_claims limit 1),
    'INVALID_CONTRACT', 'PROJECTION_CONTRACT_REJECTED'
  ),
  'dead_letter',
  'the malformed producer event is permanently dead-lettered'
);
reset role;

-- Lease-token fencing rejects a stale worker even when it knows the delivery identifier.
insert into outbox.events (
  event_id, event_name, event_schema_version, workspace_id, aggregate_type, aggregate_id,
  aggregate_version, actor_type, actor_user_id, command_id, correlation_id, occurred_at,
  source, payload
)
select '70000000-0000-4000-8000-000000000004', 'evidence.observation_appended', 1,
  event.workspace_id, 'evidence.subject_ledger', event.workspace_id, 2,
  'system', null, event.command_id, event.correlation_id, clock_timestamp(), 'pando.database',
  pg_catalog.jsonb_build_object(
    'evidence_id', (select evidence_id from evidence.observations limit 1),
    'competency_ref', 'competency:python-typing', 'ledger_watermark', '2'
  )
from outbox.events as event
where event.event_name = 'evidence.observation_invalidated'
limit 1;
insert into outbox.deliveries (event_id, workspace_id, consumer_name, handler_contract_version)
select event_id, workspace_id, 'mastery.evidence_projection_v1', 1
from outbox.events where event_id = '70000000-0000-4000-8000-000000000004';
truncate phase2_edge_claims;
set local role service_role;
insert into phase2_edge_claims select * from api.claim_mastery_evidence_projection_v1();
reset role;
update outbox.deliveries set lease_token = '70000000-0000-4000-8000-000000000099'
where delivery_id = (select delivery_id from phase2_edge_claims limit 1);
set local role service_role;
select throws_ok(
  format(
    'select api.load_mastery_evidence_projection_v1(%L::uuid,%L::uuid)',
    (select delivery_id from phase2_edge_claims limit 1),
    (select lease_token from phase2_edge_claims limit 1)
  ),
  '42501', 'mastery delivery lease is not valid',
  'a stale lease token cannot load authoritative Mastery input'
);
reset role;
update outbox.deliveries
set delivery_state = 'dead_letter', lease_token = null, lease_expires_at = null,
    dead_lettered_at = clock_timestamp()
where delivery_id = (select delivery_id from phase2_edge_claims limit 1);

-- The fixed worker permanently rejects invalid contracts, uses the accepted transient backoff,
-- and dead-letters an expired eighth lease even when its handler crashed before reporting failure.
update outbox.deliveries
set delivery_state = 'pending', attempt_count = 0, available_at = clock_timestamp(),
    lease_token = null, lease_expires_at = null, completed_at = null,
    last_failure_class = null, last_error_code = null, last_failed_at = null,
    dead_lettered_at = null
where delivery_id = (select delivery_id from phase2_claims order by event_position limit 1);
create temporary table phase2_failure_claims as
select * from api.claim_mastery_evidence_projection_v1() with no data;
grant select, insert on phase2_failure_claims to service_role;
set local role service_role;
insert into phase2_failure_claims select * from api.claim_mastery_evidence_projection_v1();
select is(
  api.fail_mastery_evidence_projection_v1(
    (select delivery_id from phase2_failure_claims limit 1),
    (select lease_token from phase2_failure_claims limit 1),
    'INVALID_CONTRACT', 'INVALID_MASTERY_INPUT'
  ),
  'dead_letter',
  'a permanent Mastery contract failure goes directly to dead letter'
);
reset role;

update outbox.deliveries
set delivery_state = 'pending', attempt_count = 0, available_at = clock_timestamp(),
    lease_token = null, lease_expires_at = null, completed_at = null,
    last_failure_class = null, last_error_code = null, last_failed_at = null,
    dead_lettered_at = null
where delivery_id = (select delivery_id from phase2_claims order by event_position desc limit 1);
truncate phase2_failure_claims;
set local role service_role;
insert into phase2_failure_claims select * from api.claim_mastery_evidence_projection_v1();
select is(
  api.fail_mastery_evidence_projection_v1(
    (select delivery_id from phase2_failure_claims limit 1),
    (select lease_token from phase2_failure_claims limit 1),
    'TRANSIENT', 'DISPATCH_FAILED'
  ),
  'retry',
  'a transient Mastery failure remains retryable before attempt exhaustion'
);
reset role;
select ok(
  (select available_at between clock_timestamp() + interval '4 seconds'
     and clock_timestamp() + interval '11 seconds'
   from outbox.deliveries
   where delivery_id = (select delivery_id from phase2_failure_claims limit 1)),
  'the first Mastery retry uses a five-second exponential base with bounded jitter'
);

update outbox.deliveries
set delivery_state = 'leased', attempt_count = 8,
    lease_token = '50000000-0000-4000-8000-000000000008',
    lease_expires_at = clock_timestamp() - interval '1 second',
    available_at = clock_timestamp() - interval '1 minute',
    last_failure_class = null, last_error_code = null, last_failed_at = null
where delivery_id = (select delivery_id from phase2_failure_claims limit 1);
truncate phase2_failure_claims;
set local role service_role;
insert into phase2_failure_claims select * from api.claim_mastery_evidence_projection_v1();
reset role;
select is(
  (select delivery_state from outbox.deliveries
   where lease_token is null and last_error_code = 'LEASE_EXPIRED_AFTER_MAX_ATTEMPTS'
   limit 1),
  'dead_letter',
  'an expired eighth Mastery lease is dead-lettered by the claim path'
);
select is((select count(*) from phase2_failure_claims), 0::bigint,
  'the exhausted Mastery delivery is never returned for a ninth attempt');

set local role service_role;
select throws_ok(
  $$select * from mastery.competency_state_snapshots$$,
  '42501', 'permission denied for table competency_state_snapshots',
  'service role cannot bypass the fixed worker RPC with direct table access'
);
reset role;
set local role anon;
select throws_ok(
  $$select api.start_focus_activity_v1(
    'goal:alice-focus', 'activity:typing-practice', 10::smallint, 'forged-anon-focus'
  )$$,
  '42501', 'permission denied for schema api',
  'anonymous callers cannot start Focus even with forged identifiers'
);
reset role;

select * from finish();
rollback;
