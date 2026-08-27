begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

select has_table('targets', expected.table_name, format('targets.%s exists', expected.table_name))
from unnest(array[
  'readiness_snapshots',
  'readiness_snapshot_inputs',
  'current_readiness_snapshots'
]) as expected(table_name);

select ok(
  class.relrowsecurity and class.relforcerowsecurity,
  format('targets.%s has enabled and forced RLS', class.relname)
)
from pg_catalog.pg_class as class
join pg_catalog.pg_namespace as namespace on namespace.oid = class.relnamespace
where namespace.nspname = 'targets'
  and class.relname in (
    'readiness_snapshots', 'readiness_snapshot_inputs', 'current_readiness_snapshots'
  )
order by class.relname;

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint as con
    join pg_catalog.pg_class as class on class.oid = con.conrelid
    join pg_catalog.pg_namespace as namespace on namespace.oid = class.relnamespace
    where namespace.nspname = 'targets'
      and class.relname = 'readiness_snapshot_inputs'
      and con.conname = 'readiness_input_evidence_array_check'
      and pg_catalog.pg_get_constraintdef(con.oid) like
        '%cardinality(supporting_evidence_ids) <= 8%'
      and pg_catalog.pg_get_constraintdef(con.oid) like
        '%cardinality(contradicting_evidence_ids) <= 8%'
  ),
  'readiness input history enforces the public eight-reference bounds'
);

select ok(
  role.rolname is not null and not role.rolcanlogin and not role.rolinherit
    and not role.rolbypassrls,
  'pando_readiness_worker is NOLOGIN/NOINHERIT/NOBYPASSRLS'
)
from pg_catalog.pg_roles as role where role.rolname = 'pando_readiness_worker';

select ok(
  role.rolname is not null and not role.rolcanlogin and not role.rolinherit
    and not role.rolbypassrls,
  'pando_readiness_scheduler is NOLOGIN/NOINHERIT/NOBYPASSRLS'
)
from pg_catalog.pg_roles as role where role.rolname = 'pando_readiness_scheduler';

select ok(
  exists (
    select 1
    from pg_catalog.pg_index as index
    join pg_catalog.pg_class as class on class.oid = index.indexrelid
    join pg_catalog.pg_namespace as namespace on namespace.oid = class.relnamespace
    where namespace.nspname = 'outbox'
      and class.relname = 'deliveries_readiness_state_workspace'
      and pg_catalog.pg_get_indexdef(index.indexrelid) like
        '%(workspace_id, delivery_state, available_at, event_id)%'
      and pg_catalog.pg_get_expr(index.indpred, index.indrelid) like
        '%targets.readiness_projection_v1%'
      and pg_catalog.pg_get_expr(index.indpred, index.indrelid) like '%dead_letter%'
  ),
  'readiness state lookup has a workspace-leading partial active/dead-letter index'
);

select ok(
  (
    select pg_catalog.strpos(definition.value, 'v_max_competency_evidence > 10000') > 0
      and pg_catalog.strpos(definition.value, 'v_total_evidence > 50000') > 0
      and pg_catalog.strpos(definition.value, 'v_max_competency_evidence > 10000') <
        pg_catalog.strpos(definition.value, 'jsonb_agg')
    from (
      select pg_catalog.pg_get_functiondef(procedure.oid) as value
      from pg_catalog.pg_proc as procedure
      join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'mastery'
        and procedure.proname = 'get_readiness_calculation_source_v1'
    ) as definition
  ),
  'Mastery source enforces per-competency and batch evidence caps before JSON aggregation'
);

select ok(
  procedure.prosecdef
    and 'search_path=""' = any(coalesce(procedure.proconfig, '{}'::text[]))
    and owner.rolname = 'pando_readiness_scheduler'
    and not pg_catalog.has_function_privilege(
      'service_role', 'outbox.invoke_target_readiness_projection_recovery_impl()', 'EXECUTE'
    ),
  'the fixed recovery invoker is pinned to its NOLOGIN scheduler and is not a service RPC'
)
from pg_catalog.pg_proc as procedure
join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
join pg_catalog.pg_roles as owner on owner.oid = procedure.proowner
where namespace.nspname = 'outbox'
  and procedure.proname = 'invoke_target_readiness_projection_recovery_impl';

select ok(
  not procedure.prosecdef
    and 'search_path=""' = any(coalesce(procedure.proconfig, '{}'::text[]))
    and not pg_catalog.has_function_privilege(
      'service_role', 'outbox.configure_target_readiness_projection_recovery_impl()', 'EXECUTE'
    ),
  'recovery activation stays a pinned deployment-only invoker function'
)
from pg_catalog.pg_proc as procedure
join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
where namespace.nspname = 'outbox'
  and procedure.proname = 'configure_target_readiness_projection_recovery_impl';

select ok(
  pg_catalog.has_function_privilege(
    'service_role', 'api.claim_target_readiness_projection_v1()', 'EXECUTE'
  ) and not pg_catalog.has_function_privilege(
    'authenticated', 'api.claim_target_readiness_projection_v1()', 'EXECUTE'
  ),
  'only the service worker can claim Target readiness deliveries'
);
select ok(
  pg_catalog.has_function_privilege(
    'authenticated', 'api.get_target_readiness_v1(text)', 'EXECUTE'
  ) and not pg_catalog.has_function_privilege(
    'service_role', 'api.get_target_readiness_v1(text)', 'EXECUTE'
  ),
  'only authenticated callers can use the public Target readiness query'
);
select is(
  (
    select count(*)::bigint from pg_catalog.pg_trigger as trigger
    join pg_catalog.pg_class as class on class.oid = trigger.tgrelid
    join pg_catalog.pg_namespace as namespace on namespace.oid = class.relnamespace
    where namespace.nspname = 'outbox' and class.relname = 'events'
      and not trigger.tgisinternal
      and pg_catalog.pg_get_triggerdef(trigger.oid) ilike '%readiness%'
  ), 0::bigint,
  'Target readiness routing adds no outbox insert trigger'
);

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    '25000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
    'readiness-alice@pando.test', '', clock_timestamp(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    clock_timestamp(), clock_timestamp()
  ),
  (
    '25000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
    'readiness-bob@pando.test', '', clock_timestamp(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    clock_timestamp(), clock_timestamp()
  );

create temporary table readiness_results (
  result_name text primary key,
  response jsonb
);
grant select, insert, update on readiness_results to authenticated, service_role;

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '25000000-0000-4000-8000-000000000001',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text, true
);
set local role authenticated;
insert into readiness_results values (
  'alice-bootstrap', api.bootstrap_personal_workspace(
    'phase3b-readiness-alice', 'Readiness Alice'
  )
);
insert into readiness_results
select 'alice-goal', api.create_readiness_goal(
  (select (response->>'workspace_id')::uuid from readiness_results
   where result_name = 'alice-bootstrap'),
  'goal:readiness-alice', 'Alice deterministic readiness',
  'target:nvidia-python-verification-base-v1', 'phase3b-alice-goal'
);
insert into readiness_results values (
  'alice-before', api.get_target_readiness_v1('goal:readiness-alice')
);
reset role;

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '25000000-0000-4000-8000-000000000002',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text, true
);
set local role authenticated;
insert into readiness_results values (
  'bob-bootstrap', api.bootstrap_personal_workspace(
    'phase3b-readiness-bob', 'Readiness Bob'
  )
);
insert into readiness_results
select 'bob-goal', api.create_readiness_goal(
  (select (response->>'workspace_id')::uuid from readiness_results
   where result_name = 'bob-bootstrap'),
  'goal:readiness-bob', 'Bob failed readiness',
  'target:nvidia-python-verification-base-v1', 'phase3b-bob-goal'
);
reset role;

select is(
  (select response->>'projectionState' from readiness_results where result_name = 'alice-before'),
  'REBUILDING',
  'a due fixed delivery takes precedence over the missing snapshot state'
);
select is(
  (
    select count(*)::bigint
    from outbox.deliveries as delivery
    join readiness_results as goal on goal.result_name = 'alice-goal'
    where delivery.workspace_id = (goal.response->>'workspaceId')::uuid
      and delivery.event_id = (goal.response->'emittedEventIds'->>0)::uuid
      and delivery.consumer_name = 'targets.readiness_projection_v1'
      and delivery.handler_contract_version = 1
  ), 1::bigint,
  'goal creation atomically inserts exactly one fixed readiness delivery'
);

set local role service_role;
create temporary table readiness_claims as
select * from api.claim_target_readiness_projection_v1();
grant select on readiness_claims to service_role;
select is((
  select count(*)::integer from readiness_claims
  where workspace_id in (
    select (response->>'workspace_id')::uuid from readiness_results
    where result_name in ('alice-bootstrap', 'bob-bootstrap')
  )
), 2,
  'the strict claim selects one due delivery per workspace');

create temporary table readiness_loads as
select claim.workspace_id, claim.delivery_id, claim.lease_token,
  claim.event_position,
  api.load_target_readiness_projection_v1(
    claim.delivery_id, claim.lease_token
  ) as response
from readiness_claims as claim
where claim.workspace_id in (
  select (response->>'workspace_id')::uuid from readiness_results
  where result_name in ('alice-bootstrap', 'bob-bootstrap')
);
grant select on readiness_loads to service_role;

select is(
  (select response->'contract'->>'name' from readiness_loads
   where workspace_id = (select (response->>'workspace_id')::uuid
     from readiness_results where result_name = 'alice-bootstrap')),
  'TargetReadinessProjectionInputV1',
  'the worker load returns the fixed projection contract'
);
select ok(
  (select response ?& array[
    'deliveryId', 'eventId', 'eventPosition', 'workspaceId', 'eventName',
    'calculatedAsOf', 'sourceEvidenceWatermark', 'projectionGeneration',
    'projectionError', 'goals', 'masterySource'
  ] from readiness_loads limit 1),
  'the load exposes the complete fixed projection input envelope'
);
select ok(
  not exists (
    select 1 from readiness_loads
    where pg_catalog.jsonb_array_length(response->'goals') <> 1
      or pg_catalog.jsonb_array_length(response->'goals'->0->'requiredLeaves') = 0
  ),
  'the worker RLS policies expose exactly the owned goal and its requirement leaves'
);

create temporary table readiness_completions as
select load.workspace_id, load.delivery_id, load.lease_token, load.event_position,
  pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'readinessGoalId', goal.value->>'readinessGoalId',
    'profileVersionId', goal.value->>'profileVersionId',
    'projectionGeneration', 'live-v1',
    'inputFingerprint', 'readiness-input:' || repeat('a', 64),
    'sourceEvidenceWatermark', load.response->>'sourceEvidenceWatermark',
    'calculatedAsOf', load.response->>'calculatedAsOf',
    'validUntil', pg_catalog.date_trunc(
      'milliseconds', (load.response->>'calculatedAsOf')::timestamptz + interval '30 days'
    ),
    'masteryEngineVersion', load.response->'masterySource'->>'masteryEngineVersion',
    'masteryPolicyVersion', load.response->'masterySource'->>'masteryPolicyVersion',
    'readiness', pg_catalog.jsonb_build_object(
      'engineVersion', 'readiness-engine/0.1.0',
      'policyVersion', 'mastery-readiness-policy/0.1',
      'targetProfileVersionId', goal.value->>'profileVersionId',
      'inputWatermark', 'readiness-input:' || repeat('a', 64),
      'calculatedAsOf', load.response->>'calculatedAsOf',
      'targetThreshold', goal.value->'targetThreshold',
      'lower', 0, 'upper', 1, 'coverage', 0,
      'status', 'INSUFFICIENT_EVIDENCE', 'confidence', 'LOW',
      'blockers', '[]'::jsonb,
      'ruleEvaluations', (
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'ruleId', rule.value->>'ruleKey',
          'kind', rule.value->>'ruleType',
          'coverage', 0,
          'threshold', coalesce(rule.value->'threshold', goal.value->'targetThreshold'),
          'outcome', 'UNRESOLVED',
          'witnessMemberKeys', '[]'::jsonb,
          'lower', 0,
          'upper', 1
        ) order by rule.value->>'ruleKey')
        from pg_catalog.jsonb_array_elements(goal.value->'rules') as rule(value)
      ),
      'explanationCodes', '["UNKNOWN_EVIDENCE"]'::jsonb
    ),
    'gaps', '[]'::jsonb,
    'inputs', (
      select coalesce(pg_catalog.jsonb_agg(
        leaf.value || pg_catalog.jsonb_build_object(
          'calculatedAsOf', load.response->>'calculatedAsOf',
          'value', 'UNKNOWN', 'achievementLevel', 'NOT_STARTED',
          'freshness', 'UNKNOWN', 'confidence', null,
          'lastMeaningfulEvidenceAt', null,
          'supportingEvidenceIds', '[]'::jsonb,
          'contradictingEvidenceIds', '[]'::jsonb
        ) order by leaf.value->>'competencyRef', leaf.value->>'dimension',
          leaf.value->>'requiredLevel'
      ), '[]'::jsonb)
      from pg_catalog.jsonb_array_elements(goal.value->'requiredLeaves') as leaf(value)
    )
  )) as response
from readiness_loads as load
cross join lateral pg_catalog.jsonb_array_elements(load.response->'goals') as goal(value)
where goal.value->>'readinessGoalKey' = 'goal:readiness-alice';
grant select on readiness_completions to service_role;

create temporary table readiness_malicious_completion as
select completion.*, pg_catalog.jsonb_set(
  completion.response,
  '{0,inputs,0,supportingEvidenceIds}',
  pg_catalog.jsonb_build_array(gen_random_uuid())
) as malicious_response
from readiness_completions as completion;
grant select on readiness_malicious_completion to service_role;
create temporary table readiness_oversized_references as
select completion.*, pg_catalog.jsonb_set(
  completion.response,
  '{0,inputs,0,supportingEvidenceIds}',
  (
    select pg_catalog.jsonb_agg(gen_random_uuid() order by ordinal)
    from generate_series(1, 9) as reference(ordinal)
  )
) as malicious_response
from readiness_completions as completion;
grant select on readiness_oversized_references to service_role;
select throws_ok(
  pg_catalog.format(
    'select api.complete_target_readiness_projection_v1(%L::uuid,%L::uuid,%s,%L::jsonb)',
    malicious.delivery_id, malicious.lease_token, malicious.event_position,
    malicious.malicious_response
  ),
  '22023', 'readiness leaf input is invalid',
  'the service completion boundary rejects a ninth evidence reference'
)
from readiness_oversized_references as malicious;
select throws_ok(
  pg_catalog.format(
    'select api.complete_target_readiness_projection_v1(%L::uuid,%L::uuid,%s,%L::jsonb)',
    malicious.delivery_id, malicious.lease_token, malicious.event_position,
    malicious.malicious_response
  ),
  '22023', 'readiness evidence references are not authoritative',
  'a foreign or invented evidence reference is rejected before publication'
)
from readiness_malicious_completion as malicious;
reset role;
select is(
  (select count(*)::bigint from targets.readiness_snapshots), 0::bigint,
  'a rejected completion rolls back snapshot state atomically'
);
set local role service_role;

select ok(api.complete_target_readiness_projection_v1(
  completion.delivery_id, completion.lease_token, completion.event_position,
  completion.response
), 'an authoritative readiness result completes atomically')
from readiness_completions as completion;
select ok(api.complete_target_readiness_projection_v1(
  completion.delivery_id, completion.lease_token, completion.event_position,
  completion.response
), 'completion replay returns the stored receipt result')
from readiness_completions as completion;
reset role;

select is(
  (select count(*)::bigint from targets.readiness_snapshots), 1::bigint,
  'completion replay does not duplicate the immutable snapshot'
);
select is(
  (select count(*)::bigint from targets.current_readiness_snapshots), 1::bigint,
  'completion publishes exactly one current pointer'
);
select is(
  (
    select count(*)::bigint from outbox.events
    where event_name = 'targets.readiness_projection_changed'
      and event_schema_version = 1
  ), 1::bigint,
  'completion emits one canonical projection-changed event'
);
select ok(
  (
    select pg_catalog.jsonb_typeof(payload->'lower') = 'number'
      and pg_catalog.jsonb_typeof(payload->'upper') = 'number'
    from outbox.events
    where event_name = 'targets.readiness_projection_changed'
      and event_schema_version = 1
  ),
  'projection-changed interval bounds remain JSON numbers'
);
select is(
  (
    select count(*)::bigint
    from outbox.events as event
    join outbox.deliveries as delivery on delivery.event_id = event.event_id
    join targets.readiness_snapshots as snapshot
      on snapshot.workspace_id = event.workspace_id
     and snapshot.snapshot_id = (event.payload->>'source_snapshot_id')::uuid
    where event.event_name = 'targets.readiness_refresh_scheduled'
      and delivery.consumer_name = 'targets.readiness_projection_v1'
      and delivery.available_at = snapshot.valid_until + interval '1 millisecond'
      and delivery.delivery_state = 'pending'
  ),
  1::bigint,
  'completion schedules one deterministic refresh exactly one millisecond after validity'
);
select throws_ok(
  $$update targets.readiness_snapshots set lower_bound = 0.1$$,
  '55000', 'readiness history rows are immutable',
  'stored readiness facts reject mutation'
);
select throws_ok(
  $$update targets.readiness_snapshot_inputs set freshness = 'FRESH'$$,
  '55000', 'readiness history rows are immutable',
  'stored readiness inputs reject update'
);
select throws_ok(
  $$delete from targets.readiness_snapshot_inputs$$,
  '55000', 'readiness history rows are immutable',
  'stored readiness inputs reject delete'
);

set local role service_role;
select is(api.fail_target_readiness_projection_v1(
  load.delivery_id, load.lease_token, 'INVALID_CONTRACT', 'INJECTED_PERMANENT_FAILURE'
), 'dead_letter', 'a permanent worker failure dead-letters the Bob delivery')
from readiness_loads as load
where load.workspace_id = (select (response->>'workspace_id')::uuid
  from readiness_results where result_name = 'bob-bootstrap');
reset role;

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '25000000-0000-4000-8000-000000000001',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text, true
);
set local role authenticated;
insert into readiness_results values (
  'alice-after', api.get_target_readiness_v1('goal:readiness-alice')
);
insert into readiness_results values (
  'alice-planning', api.get_current_planning_readiness_input_v1('goal:readiness-alice')
);
select throws_ok(
  $$select api.get_target_readiness_v1('goal:readiness-bob')$$,
  '42501', 'readiness goal is not accessible',
  'the authenticated query does not reveal another tenant goal'
);
select throws_ok(
  $$select count(*) from targets.readiness_snapshots$$,
  '42501', null,
  'authenticated callers have no direct snapshot-table access'
);
reset role;

select is(
  (select response->>'projectionState' from readiness_results where result_name = 'alice-after'),
  'CURRENT',
  'an unexpired current pointer is CURRENT'
);
select is(
  (select response->'contract'->>'name' from readiness_results
   where result_name = 'alice-after'),
  'TargetReadinessV1',
  'the authenticated query returns TargetReadinessV1'
);
select ok(
  (select response->'profile' ?& array['profileVersionId', 'profileVersionKey', 'catalogVersionId']
   from readiness_results where result_name = 'alice-after'),
  'Targets returns exact profile identity for separate Explore domain composition'
);
select is(
  (select response->'contract'->>'name' from readiness_results
   where result_name = 'alice-planning'),
  'PlanningReadinessInputV1',
  'Planning receives a current-only minimized input'
);
select is(
  (select response->>'availability' from readiness_results
   where result_name = 'alice-planning'),
  'CURRENT',
  'Planning receives values only for current readiness'
);

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '25000000-0000-4000-8000-000000000002',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text, true
);
set local role authenticated;
insert into readiness_results values (
  'bob-after', api.get_target_readiness_v1('goal:readiness-bob')
);
insert into readiness_results values (
  'bob-planning', api.get_current_planning_readiness_input_v1('goal:readiness-bob')
);
reset role;
select is(
  (select response->>'projectionState' from readiness_results where result_name = 'bob-after'),
  'ERROR',
  'a newer dead letter takes precedence over the missing snapshot state'
);
select is(
  (select response->>'availability' from readiness_results where result_name = 'bob-planning'),
  'UNAVAILABLE',
  'Planning fails closed without returning non-current readiness values'
);
select is(
  (select response->>'reason' from readiness_results where result_name = 'bob-planning'),
  'ERROR',
  'Planning preserves a safe reason for unavailable readiness'
);

update outbox.deliveries as delivery
set available_at = clock_timestamp()
from outbox.events as event, readiness_results as bootstrap
where event.event_id = delivery.event_id
  and event.event_name = 'targets.readiness_refresh_scheduled'
  and bootstrap.result_name = 'alice-bootstrap'
  and delivery.workspace_id = (bootstrap.response->>'workspace_id')::uuid;
set local role service_role;
create temporary table readiness_fingerprint_claim as
select * from api.claim_target_readiness_projection_v1();
grant select on readiness_fingerprint_claim to service_role;
create temporary table readiness_fingerprint_load as
select claim.*, api.load_target_readiness_projection_v1(
  claim.delivery_id, claim.lease_token
) as response
from readiness_fingerprint_claim as claim;
grant select on readiness_fingerprint_load to service_role;
create temporary table readiness_fingerprint_conflict as
select load.delivery_id, load.lease_token, load.event_position,
  pg_catalog.jsonb_build_array(
    original.value || pg_catalog.jsonb_build_object(
      'calculatedAsOf', load.response->>'calculatedAsOf',
      'readiness', original.value->'readiness' || pg_catalog.jsonb_build_object(
        'calculatedAsOf', load.response->>'calculatedAsOf'
      ),
      'inputs', (
        select pg_catalog.jsonb_agg(
          input.value || pg_catalog.jsonb_build_object(
            'calculatedAsOf', load.response->>'calculatedAsOf'
          ) order by input.value->>'competencyRef', input.value->>'dimension',
            input.value->>'requiredLevel'
        )
        from pg_catalog.jsonb_array_elements(original.value->'inputs') as input(value)
      )
    )
  ) as response
from readiness_fingerprint_load as load
cross join readiness_completions as completion
cross join lateral pg_catalog.jsonb_array_elements(completion.response) as original(value);
grant select on readiness_fingerprint_conflict to service_role;
select throws_ok(
  pg_catalog.format(
    'select api.complete_target_readiness_projection_v1(%L::uuid,%L::uuid,%s,%L::jsonb)',
    conflict.delivery_id, conflict.lease_token, conflict.event_position, conflict.response
  ),
  '22023', 'readiness fingerprint conflicts with stored snapshot provenance',
  'the same fingerprint cannot be reused for different clock or snapshot provenance'
)
from readiness_fingerprint_conflict as conflict;
select is(api.fail_target_readiness_projection_v1(
  conflict.delivery_id, conflict.lease_token,
  'INVALID_CONTRACT', 'FINGERPRINT_PROVENANCE_CONFLICT'
), 'dead_letter', 'the rejected conflicting delivery is retained as a dead letter')
from readiness_fingerprint_conflict as conflict;
reset role;

create temporary table readiness_queue_probe (event_id uuid primary key);
insert into readiness_queue_probe values (gen_random_uuid());
grant select on readiness_queue_probe to service_role;
insert into outbox.events (
  event_id, event_name, event_schema_version, workspace_id,
  actor_type, actor_user_id, command_id, correlation_id, causation_id,
  occurred_at, source, payload
)
select probe.event_id, 'mastery.competency_state_changed', 1,
  (bootstrap.response->>'workspace_id')::uuid,
  'system', null, source_event.command_id, source_event.correlation_id,
  source_event.event_id, clock_timestamp(), 'pando.mastery_worker',
  pg_catalog.jsonb_build_object(
    'competency_ref', input.competency_ref,
    'snapshot_id', gen_random_uuid(),
    'projection_generation', 'live-v1',
    'input_watermark', '1',
    'achievement_level', 'NOT_STARTED',
    'engine_version', 'mastery-engine/0.1.0',
    'policy_version', 'mastery-readiness-policy/0.1',
    'calculated_as_of', pg_catalog.date_trunc('milliseconds', clock_timestamp())
  )
from readiness_queue_probe as probe
join readiness_results as bootstrap on bootstrap.result_name = 'alice-bootstrap'
join outbox.events as source_event
  on source_event.event_id = (select (response->'emittedEventIds'->>0)::uuid
    from readiness_results where result_name = 'alice-goal')
cross join lateral (
  select stored_input.competency_ref
  from targets.readiness_snapshot_inputs as stored_input
  where stored_input.workspace_id = (bootstrap.response->>'workspace_id')::uuid
  order by stored_input.competency_ref
  limit 1
) as input;
insert into outbox.deliveries (
  event_id, workspace_id, consumer_name, handler_contract_version
)
select probe.event_id, (bootstrap.response->>'workspace_id')::uuid,
  'targets.readiness_projection_v1', 1
from readiness_queue_probe as probe
join readiness_results as bootstrap on bootstrap.result_name = 'alice-bootstrap';

set local role service_role;
create temporary table readiness_queue_claim as
select * from api.claim_target_readiness_projection_v1();
grant select on readiness_queue_claim to service_role;
select is(
  (select claim.event_id from readiness_queue_claim as claim
   join readiness_queue_probe as probe on probe.event_id = claim.event_id),
  (select event_id from readiness_queue_probe),
  'a future lower-position refresh does not block later due Mastery work'
);
select is(api.fail_target_readiness_projection_v1(
  claim.delivery_id, claim.lease_token, 'TRANSIENT', 'QUEUE_PROBE_TRANSIENT'
), 'retry', 'a transient failure enters durable retry backoff')
from readiness_queue_claim as claim
join readiness_queue_probe as probe on probe.event_id = claim.event_id;
reset role;

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '25000000-0000-4000-8000-000000000001',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text, true
);
set local role authenticated;
insert into readiness_results values (
  'alice-retry', api.get_target_readiness_v1('goal:readiness-alice')
);
reset role;
select is(
  (select response->>'projectionState' from readiness_results
   where result_name = 'alice-retry'),
  'REBUILDING',
  'retry backoff remains visibly REBUILDING instead of exposing an older current value'
);

-- Succeeded history is irrelevant to projection state. An intentionally out-of-range historical
-- watermark would make the read fail if the state predicate evaluated succeeded deliveries.
insert into outbox.events (
  event_id, event_name, event_schema_version, workspace_id,
  actor_type, actor_user_id, command_id, correlation_id, causation_id,
  occurred_at, source, payload
)
select '25000000-0000-4000-8000-0000000000f0',
  'mastery.competency_state_changed', 1, (bootstrap.response->>'workspace_id')::uuid,
  'system', null, source_event.command_id, source_event.correlation_id, source_event.event_id,
  clock_timestamp(), 'pando.mastery_worker', pg_catalog.jsonb_build_object(
    'competency_ref', input.competency_ref,
    'input_watermark', '9999999999999999999'
  )
from readiness_results as bootstrap
join outbox.events as source_event
  on source_event.event_id = (select (response->'emittedEventIds'->>0)::uuid
    from readiness_results where result_name = 'alice-goal')
cross join lateral (
  select stored_input.competency_ref
  from targets.readiness_snapshot_inputs as stored_input
  where stored_input.workspace_id = (bootstrap.response->>'workspace_id')::uuid
  order by stored_input.competency_ref
  limit 1
) as input
where bootstrap.result_name = 'alice-bootstrap';
insert into outbox.deliveries (
  event_id, workspace_id, consumer_name, handler_contract_version,
  delivery_state, attempt_count, available_at, completed_at
)
select '25000000-0000-4000-8000-0000000000f0',
  (response->>'workspace_id')::uuid, 'targets.readiness_projection_v1', 1,
  'succeeded', 1, clock_timestamp() - interval '1 minute', clock_timestamp()
from readiness_results where result_name = 'alice-bootstrap';
set local role authenticated;
insert into readiness_results values (
  'alice-after-succeeded-history', api.get_target_readiness_v1('goal:readiness-alice')
);
reset role;
select is(
  (select response->>'projectionState' from readiness_results
   where result_name = 'alice-after-succeeded-history'),
  'REBUILDING',
  'succeeded historical deliveries are excluded before readiness state evaluation'
);

-- The seeded profile has eleven unique readiness leaves, so twenty active goals exercise both
-- bounded fan-out invariants while staying below the conservative 250-leaf batch ceiling.
set local role authenticated;
insert into readiness_results (result_name, response)
select pg_catalog.format('alice-capacity-%s', ordinal), api.create_readiness_goal(
  (select (response->>'workspace_id')::uuid from readiness_results
   where result_name = 'alice-bootstrap'),
  pg_catalog.format('goal:readiness-capacity-%s', ordinal),
  pg_catalog.format('Readiness capacity %s', ordinal),
  'target:nvidia-python-verification-base-v1',
  pg_catalog.format('phase3b-alice-capacity-%s', ordinal)
)
from generate_series(2, 20) as capacity(ordinal);
select is(
  (api.create_readiness_goal(
    (select (response->>'workspace_id')::uuid from readiness_results
     where result_name = 'alice-bootstrap'),
    'goal:readiness-alice', 'Alice deterministic readiness',
    'target:nvidia-python-verification-base-v1', 'phase3b-alice-goal'
  )->>'readinessGoalId'),
  (select response->>'readinessGoalId' from readiness_results where result_name = 'alice-goal'),
  'a completed idempotent command replays after the workspace reaches capacity'
);
select throws_ok(
  $$select api.create_readiness_goal(
    (select (response->>'workspace_id')::uuid from readiness_results
     where result_name = 'alice-bootstrap'),
    'goal:readiness-capacity-21', 'Readiness capacity 21',
    'target:nvidia-python-verification-base-v1', 'phase3b-alice-capacity-21'
  )$$,
  '54000', 'active readiness goal limit exceeded',
  'the twenty-first active readiness goal is rejected before authoritative writes'
);
reset role;
select is(
  (select count(*)::bigint
   from targets.readiness_goals as goal, readiness_results as bootstrap
   where bootstrap.result_name = 'alice-bootstrap'
     and goal.workspace_id = (bootstrap.response->>'workspace_id')::uuid
     and goal.lifecycle = 'active'),
  20::bigint,
  'goal admission leaves exactly twenty active goals after rejection'
);
select throws_ok(
  $$insert into targets.readiness_goals (
    readiness_goal_id, workspace_id, readiness_goal_key, title, profile_version_id
  )
  select gen_random_uuid(), goal.workspace_id, 'goal:readiness-direct-capacity-21',
    'Direct capacity bypass', goal.profile_version_id
  from targets.readiness_goals as goal
  where goal.readiness_goal_key = 'goal:readiness-alice'$$,
  '54000', 'active readiness goal limit exceeded',
  'the table-side invariant rejects a direct twenty-first active goal'
);
select ok(
  (
    select coalesce(sum(per_goal.leaf_count), 0) <= 250
    from targets.readiness_goals as goal
    cross join lateral (
      select count(*)::bigint as leaf_count
      from (
        select member.node_ref, member.objective_dimension, member.required_level
        from targets.target_requirement_members as member
        where member.profile_version_id = goal.profile_version_id
          and member.member_type = 'NODE' and member.node_kind = 'COMPETENCY'
        group by member.node_ref, member.objective_dimension, member.required_level
      ) as unique_leaf
    ) as per_goal
    where goal.workspace_id = (select (response->>'workspace_id')::uuid
      from readiness_results where result_name = 'alice-bootstrap')
      and goal.lifecycle = 'active'
  ),
  'active goal admission preserves the 250-leaf workspace batch ceiling'
);
select is(
  (select count(*)::bigint from outbox.command_receipts
   where idempotency_key = 'phase3b-alice-capacity-21'),
  0::bigint,
  'rejected goal admission leaves no command receipt'
);

select * from finish();
rollback;
