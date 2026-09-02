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

select is(
  pg_catalog.has_function_privilege(runtime_role.role_name, public_api.signature, 'EXECUTE'),
  runtime_role.role_name = 'authenticated',
  pg_catalog.format('%s has the exact D2c API privilege for %s',
    runtime_role.role_name, public_api.signature)
)
from (values ('anon'), ('authenticated'), ('service_role')) as runtime_role(role_name)
cross join (values
  ('api.get_learning_track_cadence_source_v1()'),
  ('api.preview_learning_track_cadence_v1(text,integer,text,text,text)'),
  ('api.apply_learning_track_cadence_v1(text,integer,text,text,text,text,text)')
) as public_api(signature)
order by runtime_role.role_name, public_api.signature;

select ok(
  not pg_catalog.has_function_privilege(
    runtime_role.role_name, private_helper.signature, 'EXECUTE'
  ),
  pg_catalog.format('%s cannot execute private D2c helper %s',
    runtime_role.role_name, private_helper.signature)
)
from (values ('anon'), ('authenticated'), ('service_role')) as runtime_role(role_name)
cross join (values
  ('planning.read_learning_track_cadence_progress_v1(uuid,uuid,timestamptz)'),
  ('planning.build_learning_track_cadence_preview_v1(uuid,uuid,text,integer,bigint,uuid,text,text,text,integer,integer,integer,bigint,integer,bigint,bigint,text,timestamptz)'),
  ('planning.track_cadence_event_payload_v1_is_valid(jsonb)')
) as private_helper(signature)
order by runtime_role.role_name, private_helper.signature;

select ok(
  procedure.prosecdef
    and 'search_path=""' = any(coalesce(procedure.proconfig, '{}'::text[]))
    and owner.rolname = 'pando_planning_worker'
    and not owner.rolcanlogin and not owner.rolinherit and not owner.rolbypassrls,
  'cadence progress is a pinned private worker-owned projection read'
)
from pg_catalog.pg_proc as procedure
join pg_catalog.pg_roles as owner on owner.oid = procedure.proowner
where procedure.oid = pg_catalog.to_regprocedure(
  'planning.read_learning_track_cadence_progress_v1(uuid,uuid,timestamptz)'
);

select ok(
  count(*) = 5
    and bool_and(
      procedure.prosecdef = (procedure.proname <> 'track_cadence_event_payload_v1_is_valid')
    )
    and bool_and('search_path=""' = any(coalesce(procedure.proconfig, '{}'::text[])))
    and bool_and(owner.rolname = 'pando_planning_api'),
  'cadence APIs and command helpers have exact definer modes and Planning owner'
)
from pg_catalog.pg_proc as procedure
join pg_catalog.pg_roles as owner on owner.oid = procedure.proowner
where procedure.oid in (
  pg_catalog.to_regprocedure(
    'planning.build_learning_track_cadence_preview_v1(uuid,uuid,text,integer,bigint,uuid,text,text,text,integer,integer,integer,bigint,integer,bigint,bigint,text,timestamptz)'
  ),
  pg_catalog.to_regprocedure('planning.track_cadence_event_payload_v1_is_valid(jsonb)'),
  pg_catalog.to_regprocedure('api.get_learning_track_cadence_source_v1()'),
  pg_catalog.to_regprocedure('api.preview_learning_track_cadence_v1(text,integer,text,text,text)'),
  pg_catalog.to_regprocedure(
    'api.apply_learning_track_cadence_v1(text,integer,text,text,text,text,text)'
  )
);

select ok(
  not pg_catalog.has_table_privilege('pando_planning_api', 'sessions.focus_sessions', 'SELECT')
    and not pg_catalog.has_table_privilege('pando_planning_api', 'evidence.observations', 'SELECT')
    and not pg_catalog.has_table_privilege(
      'authenticated', 'planning.plan_snapshot_attempts', 'SELECT'
    ),
  'actor-facing cadence control gains no raw Sessions, Evidence, or attempt-table access'
);

set local role authenticated;
select throws_ok(
  $$select planning.read_learning_track_cadence_progress_v1(
    gen_random_uuid(), gen_random_uuid(), clock_timestamp()
  )$$,
  '42501', 'permission denied for function read_learning_track_cadence_progress_v1',
  'authenticated cannot call the private cadence progress reader'
);
reset role;

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'e5000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'd2c-alice@pando.test', '', pg_catalog.clock_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
);

create temporary table cadence_results (
  result_name text primary key,
  response jsonb not null
);
grant select, insert on cadence_results to authenticated, service_role;
grant select on cadence_results to pando_planning_api, pando_planning_worker;

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', 'e5000000-0000-4000-8000-000000000001',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from pg_catalog.clock_timestamp() + interval '1 hour')::bigint
  )::text,
  true
);
set local role authenticated;
insert into cadence_results values (
  'bootstrap', api.bootstrap_personal_workspace('d2c-alice', 'D2c Alice')
);
insert into cadence_results
select 'goal', api.create_readiness_goal(
  (response->>'workspace_id')::uuid,
  'goal:d2c-alice', 'D2c Alice goal',
  'target:nvidia-python-verification-base-v1', 'd2c-alice-goal'
)
from cadence_results where result_name = 'bootstrap';
insert into cadence_results values (
  'plan', pg_temp.initialize_growth_plan_fixture_v1(
    'goal:d2c-alice', 600, 45, 80, 120, 'd2c-alice-plan'
  )
);
insert into cadence_results values (
  'source-before', api.get_learning_track_cadence_source_v1()
);
reset role;

update planning.learning_tracks
set track_key = 'track:algorithms', title = 'Algorithms'
where learning_track_id = (
  select (response->>'learningTrackId')::uuid
  from cadence_results where result_name = 'plan'
);

-- The D1b initializer intentionally does not materialize an Overlay root. The Planning source
-- contract nevertheless fences the empty Overlay slice, so make that owner source explicit in
-- this worker fixture before exercising the real V2 loader.
insert into overlay.workspace_overlays (workspace_id)
select (response->>'workspace_id')::uuid
from cadence_results where result_name = 'bootstrap'
on conflict (workspace_id) do nothing;

select ok(
  (select response#>>'{progress,state}' = 'UNAVAILABLE'
     and response#>>'{learningTracks,0,cadencePerWeek}' = '0'
     and response#>'{learningTracks,0,completedCadenceSessionsThisWeek}' = 'null'::jsonb
   from cadence_results where result_name = 'source-before'),
  'V1-only current state exposes cadence but never substitutes zero progress'
);

set local role authenticated;
select throws_ok(
  $$select api.preview_learning_track_cadence_v1(
    'track:algorithms', 101, '1', '1', 'Reject an invalid cadence.'
  )$$,
  '22023', 'Learning Track cadence request is invalid',
  'cadence above one hundred is rejected before preview'
);
select throws_ok(
  $$select api.preview_learning_track_cadence_v1(
    'track:algorithms', 0, '1', '1', 'Reject a no-op cadence.'
  )$$,
  '22023', 'Learning Track cadence proposal is unchanged',
  'an unchanged cadence cannot create a confirmation'
);
insert into cadence_results values (
  'preview', api.preview_learning_track_cadence_v1(
    'track:algorithms', 3, '1', '1', 'Practice algorithms three times each week.'
  )
);
reset role;

select ok(
  (select response->>'operation' = 'set_track_cadence'
     and response#>>'{before,cadencePerWeek}' = '0'
     and response#>>'{after,cadencePerWeek}' = '3'
     and response#>>'{after,aggregateVersion}' = '2'
     and response#>>'{progress,state}' = 'UNAVAILABLE'
     and response#>'{progress,completedCadenceSessionsThisWeek}' = 'null'::jsonb
     and response->'warnings' @> '[{"code":"CADENCE_PROGRESS_PENDING"}]'::jsonb
     and response->>'canApply' = 'true'
     and pg_catalog.jsonb_array_length(response->'blockingReasons') = 0
   from cadence_results where result_name = 'preview'),
  'preview is applicable while progress remains explicitly unknown and soft'
);

set local role authenticated;
insert into cadence_results
select 'apply', api.apply_learning_track_cadence_v1(
  'track:algorithms', 3, '1', '1', response->>'previewDigest',
  'Practice algorithms three times each week.', 'd2c-cadence-apply'
)
from cadence_results where result_name = 'preview';
insert into cadence_results
select 'replay', api.apply_learning_track_cadence_v1(
  'track:algorithms', 3, '1', '1', response->>'previewDigest',
  'Practice algorithms three times each week.', 'd2c-cadence-apply'
)
from cadence_results where result_name = 'preview';
select throws_ok(
  (select pg_catalog.format(
    $$select api.apply_learning_track_cadence_v1(
      'track:algorithms', 4, '1', '1', %L, %L, 'd2c-cadence-apply'
    )$$,
    response->>'previewDigest', 'Practice algorithms three times each week.'
  ) from cadence_results where result_name = 'preview'),
  '22023', 'idempotency key reused with a different request',
  'same cadence idempotency key rejects a changed request'
);
reset role;

select is(
  (select response from cadence_results where result_name = 'replay'),
  (select response from cadence_results where result_name = 'apply'),
  'same-key cadence replay returns the stored response'
);

select ok(
  (select cadence_per_week = 3 and aggregate_version = 2
   from planning.learning_tracks where track_key = 'track:algorithms')
  and exists (
    select 1
    from cadence_results as result
    join outbox.command_receipts as receipt
      on receipt.command_id = (result.response->>'commandId')::uuid
    join outbox.events as event
      on event.event_id = (result.response#>>'{emittedEventIds,0}')::uuid
    join outbox.deliveries as delivery
      on delivery.delivery_id = (result.response->>'planningDeliveryId')::uuid
    where result.result_name = 'apply'
      and receipt.command_type = 'planning.change_learning_track_cadence_v1'
      and event.aggregate_type = 'planning.learning_track'
      and event.payload = pg_catalog.jsonb_build_object(
        'change_kind', 'TRACK_CADENCE_CHANGED',
        'growth_plan_id', (
          select growth_plan_id from planning.learning_tracks
          where track_key = 'track:algorithms'
        ),
        'learning_track_id', (
          select learning_track_id from planning.learning_tracks
          where track_key = 'track:algorithms'
        ),
        'learning_track_version', '2',
        'cadence_per_week', 3
      )
      and delivery.consumer_name = 'planning.plan_snapshot_v1'
      and delivery.handler_contract_version = 1
  ),
  'apply changes only cadence/version and appends one minimal event and delivery'
);

update outbox.deliveries
set delivery_state = 'leased', attempt_count = 1,
  lease_token = 'e5000000-0000-4000-8000-000000000083',
  lease_expires_at = pg_catalog.clock_timestamp() + interval '2 minutes',
  available_at = pg_catalog.clock_timestamp()
where delivery_id = (
  select (response->>'planningDeliveryId')::uuid
  from cadence_results where result_name = 'apply'
);

insert into planning.plan_snapshot_attempts (
  attempt_id, workspace_id, delivery_id, event_id, event_position, generation,
  claim_as_of, base_pointer_version, calculation_contract_version
)
select 'e5000000-0000-4000-8000-000000000082', event.workspace_id,
  delivery.delivery_id, event.event_id, event.event_position, 1,
  pg_catalog.clock_timestamp(), pointer.pointer_version, 'planning-calculation/2'
from cadence_results as result
join outbox.deliveries as delivery
  on delivery.delivery_id = (result.response->>'planningDeliveryId')::uuid
join outbox.events as event on event.event_id = delivery.event_id
join planning.current_plan_snapshots as pointer on pointer.workspace_id = event.workspace_id
where result.result_name = 'apply';

set local role authenticated;
insert into cadence_results values (
  'v2-pending', api.get_learning_track_cadence_source_v1()
);
reset role;
select is(
  (select response#>>'{progress,state}' from cadence_results where result_name = 'v2-pending'),
  'PENDING',
  'a leased V2 attempt without an applied pointer exposes pending, never an invented count'
);
select is(
  (select response#>'{learningTracks,0,completedCadenceSessionsThisWeek}'
   from cadence_results where result_name = 'v2-pending'),
  'null'::jsonb,
  'pending V2 progress does not substitute zero completed cadence sessions'
);

set local role service_role;
insert into cadence_results values (
  'v2-load', api.load_plan_snapshot_projection_v1(
    (select (response->>'planningDeliveryId')::uuid
      from cadence_results where result_name = 'apply'),
    'e5000000-0000-4000-8000-000000000083'::uuid,
    'e5000000-0000-4000-8000-000000000082'::uuid
  )
);
insert into cadence_results values (
  'v2-record', pg_catalog.to_jsonb(api.record_plan_snapshot_input_v1(
    (select (response->>'planningDeliveryId')::uuid
      from cadence_results where result_name = 'apply'),
    'e5000000-0000-4000-8000-000000000083'::uuid,
    'e5000000-0000-4000-8000-000000000082'::uuid,
    (select response->>'sourceFence' from cadence_results where result_name = 'v2-load'),
    pg_catalog.jsonb_build_object(
      'completedWorkPolicyVersion', 'planning-completed-work/0.2',
      'inputFingerprint',
        'planning-input:5555555555555555555555555555555555555555555555555555555555555555',
      'evaluationHorizon', pg_catalog.jsonb_build_object(
        'asOf', (select response->'claimAsOf' from cadence_results where result_name = 'v2-load'),
        'validUntil', (select response#>'{sourceBundle,calendar,validUntil}'
          from cadence_results where result_name = 'v2-load'),
        'timeZone', (select response#>'{sourceBundle,calendar,timeZone}'
          from cadence_results where result_name = 'v2-load'),
        'weekStart', (select response#>'{sourceBundle,calendar,weekStart}'
          from cadence_results where result_name = 'v2-load'),
        'weekEnd', (select response#>'{sourceBundle,calendar,weekEnd}'
          from cadence_results where result_name = 'v2-load')
      ),
      'growthPlan', pg_catalog.jsonb_build_object(
        'growthPlanId', (select response->>'growthPlanId'
          from cadence_results where result_name = 'plan'),
        'version', '1', 'lifecycle', 'ACTIVE', 'weeklyCapacityMinutes', 600,
        'tracks', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'trackId', (select response#>>'{changedTrack,learningTrackId}'
            from cadence_results where result_name = 'apply'),
          'version', '2', 'lifecycle', 'ACTIVE', 'priority', 80,
          'protectedMinimumMinutes', 120, 'cadencePerWeek', 3,
          'completedCadenceSessionsThisWeek', 2
        ))
      )
    )
  ))
);
insert into cadence_results values (
  'v2-complete', pg_catalog.to_jsonb(api.complete_plan_snapshot_projection_v1(
    (select (response->>'planningDeliveryId')::uuid
      from cadence_results where result_name = 'apply'),
    'e5000000-0000-4000-8000-000000000083'::uuid,
    'e5000000-0000-4000-8000-000000000082'::uuid,
    pg_catalog.jsonb_build_object(
      'engineVersion', 'planner-engine/0.2.0',
      'policyVersion', 'planning-policy/0.2',
      'inputFingerprint',
        'planning-input:5555555555555555555555555555555555555555555555555555555555555555',
      'calculatedAsOf', (select response->'claimAsOf'
        from cadence_results where result_name = 'v2-load'),
      'validUntil', (select response#>'{sourceBundle,calendar,validUntil}'
        from cadence_results where result_name = 'v2-load'),
      'timeZone', (select response#>'{sourceBundle,calendar,timeZone}'
        from cadence_results where result_name = 'v2-load'),
      'weekStart', (select response#>'{sourceBundle,calendar,weekStart}'
        from cadence_results where result_name = 'v2-load'),
      'weekEnd', (select response#>'{sourceBundle,calendar,weekEnd}'
        from cadence_results where result_name = 'v2-load'),
      'recommendationState', 'NO_CANDIDATES', 'actions', '[]'::jsonb
    )
  ))
);
reset role;

set local role authenticated;
insert into cadence_results values (
  'source-current', api.get_learning_track_cadence_source_v1()
);
insert into cadence_results values (
  'preview-zero', api.preview_learning_track_cadence_v1(
    'track:algorithms', 0, '1', '2', 'Pause the weekly cadence target for now.'
  )
);
reset role;

select ok(
  (select response#>>'{progress,state}' = 'CURRENT'
     and response#>>'{learningTracks,0,completedCadenceSessionsThisWeek}' = '2'
     and response#>>'{progress,appliedAttemptId}'
       = 'e5000000-0000-4000-8000-000000000082'
   from cadence_results where result_name = 'source-current')
  and (select response#>>'{progress,state}' = 'CURRENT'
     and response#>>'{progress,completedCadenceSessionsThisWeek}' = '2'
     and response#>>'{progress,beforeCadenceDeficit}' = '1'
     and response#>>'{progress,afterCadenceDeficit}' = '0'
     and not (response->'warnings' @> '[{"code":"CADENCE_PROGRESS_PENDING"}]'::jsonb)
   from cadence_results where result_name = 'preview-zero'),
  'exact joined V2 tuple supplies one current count and exact before/after deficits'
);

savepoint v1_tuple_is_unavailable;
set local session_replication_role = replica;
update planning.plan_snapshot_attempts
set calculation_contract_version = 'planning-calculation/1'
where attempt_id = 'e5000000-0000-4000-8000-000000000082';
set local role authenticated;
select is(
  api.get_learning_track_cadence_source_v1()#>>'{progress,state}',
  'UNAVAILABLE',
  'a V1 attempt behind the pointer fails closed for cadence progress'
);
reset role;
rollback to savepoint v1_tuple_is_unavailable;

savepoint mixed_tuple_is_unavailable;
alter table planning.plan_snapshots
  drop constraint plan_snapshots_calculation_tuple_check,
  drop constraint plan_snapshots_result_check;
set local session_replication_role = replica;
update planning.plan_snapshots
set engine_version = 'planner-engine/0.1.0'
where snapshot_id = (
  select snapshot_id from planning.current_plan_snapshots
  where workspace_id = (select response->>'workspace_id' from cadence_results where result_name = 'bootstrap')::uuid
);
set local role authenticated;
select is(
  api.get_learning_track_cadence_source_v1()#>>'{progress,state}',
  'UNAVAILABLE',
  'a mixed engine/policy tuple fails closed for cadence progress'
);
reset role;
rollback to savepoint mixed_tuple_is_unavailable;

savepoint fingerprint_disagreement_is_unavailable;
alter table planning.plan_snapshots
  drop constraint plan_snapshots_result_check;
set local session_replication_role = replica;
update planning.plan_snapshots
set result = pg_catalog.jsonb_set(
  result, '{inputFingerprint}',
  '"planning-input:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"'::jsonb,
  false
)
where snapshot_id = (
  select snapshot_id from planning.current_plan_snapshots
  where workspace_id = (select response->>'workspace_id' from cadence_results where result_name = 'bootstrap')::uuid
);
set local role authenticated;
select is(
  api.get_learning_track_cadence_source_v1()#>>'{progress,state}',
  'UNAVAILABLE',
  'a snapshot result fingerprint disagreement fails closed for cadence progress'
);
reset role;
rollback to savepoint fingerprint_disagreement_is_unavailable;

savepoint expired_snapshot_is_unavailable;
alter table planning.plan_snapshots
  drop constraint plan_snapshots_validity_check,
  drop constraint plan_snapshots_result_check;
set local session_replication_role = replica;
update planning.plan_snapshots
set valid_until = pg_catalog.clock_timestamp() - interval '1 second'
where snapshot_id = (
  select snapshot_id from planning.current_plan_snapshots
  where workspace_id = (select response->>'workspace_id' from cadence_results where result_name = 'bootstrap')::uuid
);
set local role authenticated;
select is(
  api.get_learning_track_cadence_source_v1()#>>'{progress,state}',
  'UNAVAILABLE',
  'an expired current V2 snapshot fails closed for cadence progress'
);
reset role;
rollback to savepoint expired_snapshot_is_unavailable;

savepoint broken_pointer_is_unavailable;
set local session_replication_role = replica;
update planning.current_plan_snapshots
set applied_attempt_id = 'e5000000-0000-4000-8000-000000000084'
where workspace_id = (select response->>'workspace_id' from cadence_results where result_name = 'bootstrap')::uuid;
set local role authenticated;
select is(
  api.get_learning_track_cadence_source_v1()#>>'{progress,state}',
  'UNAVAILABLE',
  'a broken current pointer-to-attempt join fails closed for cadence progress'
);
reset role;
rollback to savepoint broken_pointer_is_unavailable;

savepoint failed_delivery_is_unavailable;
set local role authenticated;
insert into cadence_results values (
  'failed-delivery-preview', api.preview_learning_track_cadence_v1(
    'track:algorithms', 4, '1', '2', 'Prove a failed recalculation is not progress.'
  )
);
insert into cadence_results
select 'failed-delivery-apply', api.apply_learning_track_cadence_v1(
  'track:algorithms', 4, '1', '2', response->>'previewDigest',
  'Prove a failed recalculation is not progress.', 'd2c-failed-delivery'
)
from cadence_results where result_name = 'failed-delivery-preview';
reset role;
update outbox.deliveries
set delivery_state = 'dead_letter', completed_at = null,
    dead_lettered_at = pg_catalog.clock_timestamp(),
    last_failure_class = 'PERMANENT', last_error_code = 'D2C_TEST_FAILURE',
    last_failed_at = pg_catalog.clock_timestamp()
where delivery_id = (
  select (response->>'planningDeliveryId')::uuid
  from cadence_results where result_name = 'failed-delivery-apply'
);
set local role authenticated;
select is(
  api.get_learning_track_cadence_source_v1()#>>'{progress,state}',
  'UNAVAILABLE',
  'a dead-letter Planning delivery makes cadence progress unavailable'
);
select is(
  api.get_learning_track_cadence_source_v1()#>'{learningTracks,0,completedCadenceSessionsThisWeek}',
  'null'::jsonb,
  'a dead-letter Planning delivery never substitutes a cadence progress count'
);
reset role;
rollback to savepoint failed_delivery_is_unavailable;

savepoint terminal_refusal;
update planning.learning_tracks set lifecycle = 'completed'
where track_key = 'track:algorithms';
set local role authenticated;
select throws_ok(
  $$select api.preview_learning_track_cadence_v1(
    'track:algorithms', 0, '1', '2', 'Terminal tracks cannot change cadence.'
  )$$,
  '42501', 'Learning Track is unavailable',
  'completed Track cadence selector is non-enumerating'
);
reset role;
rollback to savepoint terminal_refusal;

savepoint archived_parent_refusal;
update planning.growth_plans set lifecycle = 'archived'
where growth_plan_id = (
  select growth_plan_id from planning.learning_tracks where track_key = 'track:algorithms'
);
set local role authenticated;
select throws_ok(
  $$select api.preview_learning_track_cadence_v1(
    'track:algorithms', 0, '1', '2', 'Archived plans cannot change cadence.'
  )$$,
  '42501', 'Learning Track is unavailable',
  'archived parent cadence selector is non-enumerating'
);
reset role;
rollback to savepoint archived_parent_refusal;

savepoint paused_edit;
update planning.learning_tracks set lifecycle = 'paused'
where track_key = 'track:algorithms';
set local role authenticated;
insert into cadence_results values (
  'paused-preview', api.preview_learning_track_cadence_v1(
    'track:algorithms', 0, '1', '2', 'Keep the paused Track without a cadence target.'
  )
);
insert into cadence_results
select 'paused-apply', api.apply_learning_track_cadence_v1(
  'track:algorithms', 0, '1', '2', response->>'previewDigest',
  'Keep the paused Track without a cadence target.', 'd2c-paused-apply'
)
from cadence_results where result_name = 'paused-preview';
reset role;
select ok(
  (select response->'warnings' @> '[{"code":"LEARNING_TRACK_PAUSED"}]'::jsonb
   from cadence_results where result_name = 'paused-preview')
  and (select cadence_per_week = 0 and aggregate_version = 3
       from planning.learning_tracks where track_key = 'track:algorithms'),
  'paused Track cadence edit succeeds with an explicit warning and no capacity blocker'
);
rollback to savepoint paused_edit;

create function pg_temp.reject_d2c_cadence_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.workspace_id::text = pg_catalog.current_setting(
       'pando.test.fail_d2c_cadence_workspace', true
     ) and new.payload->>'change_kind' = 'TRACK_CADENCE_CHANGED' then
    raise exception 'injected D2c cadence event failure';
  end if;
  return new;
end
$function$;
create trigger reject_d2c_cadence_event
before insert on outbox.events
for each row execute function pg_temp.reject_d2c_cadence_event();
select set_config(
  'pando.test.fail_d2c_cadence_workspace',
  (select response->>'workspace_id' from cadence_results where result_name = 'bootstrap'),
  true
);
set local role authenticated;
insert into cadence_results values (
  'event-rollback-preview', api.preview_learning_track_cadence_v1(
    'track:algorithms', 4, '1', '2', 'Prove cadence event rollback.'
  )
);
select throws_ok(
  (select pg_catalog.format(
    $$select api.apply_learning_track_cadence_v1('track:algorithms',4,'1','2',%L,%L,'d2c-event-rollback')$$,
    response->>'previewDigest', 'Prove cadence event rollback.'
  ) from cadence_results where result_name = 'event-rollback-preview'),
  'P0001', 'injected D2c cadence event failure',
  'event failure aborts the cadence command transaction'
);
reset role;
drop trigger reject_d2c_cadence_event on outbox.events;
select ok(
  (select cadence_per_week = 3 and aggregate_version = 2
   from planning.learning_tracks where track_key = 'track:algorithms')
  and not exists (
    select 1 from outbox.command_receipts where idempotency_key = 'd2c-event-rollback'
  )
  and not exists (
    select 1 from outbox.events
    where payload->>'change_kind' = 'TRACK_CADENCE_CHANGED'
      and payload->>'cadence_per_week' = '4'
  ),
  'event failure rolls back cadence, receipt, event, and delivery effects'
);

select * from finish();
rollback;
