begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

select ok(
  pg_catalog.has_function_privilege(
    'authenticated', 'api.get_growth_plan_setup_source_v1()', 'EXECUTE'
  ) and pg_catalog.has_function_privilege(
    'authenticated',
    'api.preview_growth_plan_initialization_v1(text,text,integer,integer,integer,text,text)',
    'EXECUTE'
  ) and pg_catalog.has_function_privilege(
    'authenticated',
    'api.apply_growth_plan_initialization_v1(text,text,integer,integer,integer,text,text,text)',
    'EXECUTE'
  ),
  'authenticated has exactly the three D1b public entry points'
);

select ok(
  not pg_catalog.has_function_privilege(
    runtime.role_name, expected.signature, 'EXECUTE'
  ),
  format('%s cannot execute %s', runtime.role_name, expected.signature)
)
from (values ('anon'), ('service_role')) as runtime(role_name)
cross join (values
  ('api.get_growth_plan_setup_source_v1()'),
  ('api.preview_growth_plan_initialization_v1(text,text,integer,integer,integer,text,text)'),
  ('api.apply_growth_plan_initialization_v1(text,text,integer,integer,integer,text,text,text)')
) as expected(signature);

select ok(
  not pg_catalog.has_function_privilege(
    runtime.role_name, expected.signature, 'EXECUTE'
  ),
  format('%s cannot execute private D1b helper %s', runtime.role_name, expected.signature)
)
from (values ('anon'), ('authenticated'), ('service_role')) as runtime(role_name)
cross join (values
  ('targets.get_first_growth_plan_setup_choices_v1(uuid)'),
  ('targets.resolve_first_growth_plan_setup_source_v1(uuid,text)'),
  ('planning.frame_named_fields_v1(text[],text[])'),
  ('planning.derive_first_growth_plan_identity_v1(uuid,text,text,text)'),
  ('planning.build_first_growth_plan_preview_v1(uuid,jsonb,bigint,integer,integer,integer,text,text)')
) as expected(signature);

select ok(
  not pg_catalog.has_function_privilege(
    'authenticated',
    'api.initialize_growth_plan_v1(text,integer,integer,integer,integer,text)',
    'EXECUTE'
  ) and not pg_catalog.has_function_privilege(
    'authenticated',
    'planning.initialize_growth_plan_impl_v1(text,integer,integer,integer,integer,text)',
    'EXECUTE'
  ),
  'authenticated cannot use either legacy initialization boundary'
);

select ok(
  procedure.prosecdef
    and 'search_path=""' = any(coalesce(procedure.proconfig, '{}'::text[]))
    and owner.rolname = 'pando_planning_api',
  format('api.%s is a pinned Planning owner definer', procedure.proname)
)
from pg_catalog.pg_proc as procedure
join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
join pg_catalog.pg_roles as owner on owner.oid = procedure.proowner
where namespace.nspname = 'api'
  and procedure.proname in (
    'get_growth_plan_setup_source_v1',
    'preview_growth_plan_initialization_v1',
    'apply_growth_plan_initialization_v1'
  )
order by procedure.proname;

select ok(
  procedure.prosecdef
    and 'search_path=""' = any(coalesce(procedure.proconfig, '{}'::text[]))
    and owner.rolname = 'pando_phase1_api'
    and pg_catalog.has_function_privilege(
      'pando_planning_api', procedure.oid, 'EXECUTE'
    )
    and pg_catalog.pg_get_functiondef(procedure.oid)
      like '%:targets.active-readiness-goals%',
  format('Targets helper %s is fenced and owner scoped', procedure.proname)
)
from pg_catalog.pg_proc as procedure
join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
join pg_catalog.pg_roles as owner on owner.oid = procedure.proowner
where namespace.nspname = 'targets'
  and procedure.proname in (
    'get_first_growth_plan_setup_choices_v1',
    'resolve_first_growth_plan_setup_source_v1'
  )
order by procedure.proname;

select ok(
  not pg_catalog.has_table_privilege(
    'pando_planning_api', 'targets.readiness_goals', 'SELECT'
  ) and not pg_catalog.has_table_privilege(
    'pando_planning_api', 'targets.target_profile_versions', 'SELECT'
  ),
  'Planning receives no Targets table privilege'
);

with oracle(names, values) as (values (
  array[
    'digestVersion','contractVersion','identityVersion','workspaceId','operation',
    'commandType','idempotencyKey','reason','expectedReadinessGoalVersion',
    'readinessGoalId','readinessGoalKey','readinessGoalTitle','readinessGoalLifecycle',
    'readinessGoalVersion','profileVersionId','profileVersionKey','sourceKind','sourceRef',
    'roadmapVersionId','sourceOwnerRevision','lifetimePlanCountBefore',
    'lifetimePlanCountAfter','currentPlanCountBefore','currentPlanCountAfter',
    'currentPlanLimit','snapshotSentinelCountBefore','snapshotSentinelCountAfter',
    'growthPlanId','growthPlanTitle','growthPlanLifecycle','growthPlanWeeklyCapacityMinutes',
    'growthPlanVersion','learningTrackId','trackKey','learningTrackTitle',
    'learningTrackLifecycle','learningTrackPriority','learningTrackProtectedMinimumMinutes',
    'learningTrackDefaultSessionMinutes','learningTrackVersion','canApply','blockingReasonCode',
    'warningCount','warningCode','retainedReadinessGoal','retainedCompetencyOverlay',
    'retainedActivitiesAndEvidence','retainedMastery','retainedReviews','retainedHistory',
    'projectionStateAfterApply','eventChangeKind','consumerName'
  ]::text[],
  array[
    'growth-plan-initialization-preview-digest/1.0.0','1.0.0',
    'planning-create-identity/1.0.0','a0000000-0000-4000-8000-000000000001',
    'initialize_growth_plan','planning.initialize_growth_plan_v2',
    'b0000000-0000-4000-8000-000000000001','Start — 学習','7',
    'c0000000-0000-4000-8000-000000000001','goal:backend-readiness',
    'Backend readiness — 学習','ACTIVE','7',
    'd0000000-0000-4000-8000-000000000001','target:backend-engineer-v1',
    'ROADMAP_TEMPLATE_VERSION','e0000000-0000-4000-8000-000000000001',
    'e0000000-0000-4000-8000-000000000001','readiness-goal:7',
    '0','1','0','1','1','0','1',
    'f0000000-0000-8000-8000-000000000001','Backend readiness — 学習','ACTIVE','600','1',
    '10000000-0000-8000-8000-000000000001',
    'track:10000000-0000-8000-8000-000000000001','Backend readiness — 学習',
    'ACTIVE','50','0','30','1','true','','1','INITIAL_TRACK_HAS_NO_ACTIVITIES',
    'true','true','true','true','true','true','PENDING','INITIALIZED',
    'planning.plan_snapshot_v1'
  ]::text[]
)), framed(value) as (
  select pg_catalog.string_agg(
    names[position] || ':' || pg_catalog.octet_length(
      pg_catalog.convert_to(values[position], 'UTF8')
    )::text || ':' || values[position] || pg_catalog.chr(10),
    '' order by position
  )
  from oracle
  cross join lateral pg_catalog.generate_subscripts(names, 1) as position
)
select is(
  pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(value, 'UTF8'), 'sha256'), 'hex'
  ),
  'f5e6e9626fd9fdc5b93c25b66178bef8c38e3f644da23502514c08344045ffa4',
  'SQL matches the fixed TypeScript Unicode preview digest oracle'
)
from framed;

select is(
  planning.derive_first_growth_plan_identity_v1(
    'a0000000-0000-4000-8000-000000000001',
    'planning.initialize_growth_plan_v2',
    'b0000000-0000-4000-8000-000000000001',
    'growth-plan'
  )::text,
  '8be6ee4e-a2c2-8966-9bfb-62b79981922d',
  'SQL matches the fixed TypeScript lowercase Growth Plan UUIDv8 oracle'
);
select is(
  planning.derive_first_growth_plan_identity_v1(
    'a0000000-0000-4000-8000-000000000001',
    'planning.initialize_growth_plan_v2',
    'b0000000-0000-4000-8000-000000000001',
    'initial-learning-track'
  )::text,
  '5fa43cf7-45b5-81e8-8023-8d5415997089',
  'SQL matches the distinct lowercase initial Track UUIDv8 oracle'
);

with built(preview) as (
  select planning.build_first_growth_plan_preview_v1(
    'a0000000-0000-4000-8000-000000000001',
    pg_catalog.jsonb_build_object(
      'contract',pg_catalog.jsonb_build_object(
        'name','FirstGrowthPlanSetupResolvedSourceV1','version','1.0.0'
      ),
      'readinessGoal',pg_catalog.jsonb_build_object(
        'readinessGoalId','c0000000-0000-4000-8000-000000000001',
        'readinessGoalKey','goal:backend-readiness',
        'title','Backend readiness — 学習','lifecycle','ACTIVE','aggregateVersion','7'
      ),
      'targetProfile',pg_catalog.jsonb_build_object(
        'profileVersionId','d0000000-0000-4000-8000-000000000001',
        'profileVersionKey','target:backend-engineer-v1','profileLabel','Backend Engineer'
      ),
      'sourceKind','ROADMAP_TEMPLATE_VERSION',
      'sourceRef','e0000000-0000-4000-8000-000000000001',
      'roadmapVersionId','e0000000-0000-4000-8000-000000000001',
      'ownerRevision','readiness-goal:7'
    ),
    7,600,30,50,'Start — 学習','b0000000-0000-4000-8000-000000000001'
  )
), fields as (
  select preview, array[
    'digestVersion','contractVersion','identityVersion','workspaceId','operation',
    'commandType','idempotencyKey','reason','expectedReadinessGoalVersion',
    'readinessGoalId','readinessGoalKey','readinessGoalTitle','readinessGoalLifecycle',
    'readinessGoalVersion','profileVersionId','profileVersionKey','sourceKind','sourceRef',
    'roadmapVersionId','sourceOwnerRevision','lifetimePlanCountBefore',
    'lifetimePlanCountAfter','currentPlanCountBefore','currentPlanCountAfter',
    'currentPlanLimit','snapshotSentinelCountBefore','snapshotSentinelCountAfter',
    'growthPlanId','growthPlanTitle','growthPlanLifecycle','growthPlanWeeklyCapacityMinutes',
    'growthPlanVersion','learningTrackId','trackKey','learningTrackTitle',
    'learningTrackLifecycle','learningTrackPriority','learningTrackProtectedMinimumMinutes',
    'learningTrackDefaultSessionMinutes','learningTrackVersion','canApply','blockingReasonCode',
    'warningCount','warningCode','retainedReadinessGoal','retainedCompetencyOverlay',
    'retainedActivitiesAndEvidence','retainedMastery','retainedReviews','retainedHistory',
    'projectionStateAfterApply','eventChangeKind','consumerName'
  ]::text[] as names, array[
    preview->>'digestVersion',preview#>>'{contract,version}',preview->>'identityVersion',
    'a0000000-0000-4000-8000-000000000001',preview->>'operation',preview->>'commandType',
    preview->>'idempotencyKey',preview->>'reason',preview->>'expectedReadinessGoalVersion',
    preview#>>'{source,readinessGoalId}',preview#>>'{source,readinessGoalKey}',
    preview#>>'{source,readinessGoalTitle}',preview#>>'{source,readinessGoalLifecycle}',
    preview#>>'{source,readinessGoalVersion}',preview#>>'{source,profileVersionId}',
    preview#>>'{source,profileVersionKey}',preview#>>'{source,sourceKind}',
    preview#>>'{source,sourceRef}',preview#>>'{source,roadmapVersionId}',
    preview#>>'{source,sourceOwnerRevision}',preview#>>'{before,lifetimePlanCount}',
    preview#>>'{after,lifetimePlanCount}',preview#>>'{before,currentPlanCount}',
    preview#>>'{after,currentPlanCount}',preview#>>'{after,currentPlanLimit}',
    preview#>>'{before,snapshotSentinelCount}',preview#>>'{after,snapshotSentinelCount}',
    preview#>>'{after,growthPlan,growthPlanId}',preview#>>'{after,growthPlan,title}',
    preview#>>'{after,growthPlan,lifecycle}',preview#>>'{after,growthPlan,weeklyCapacityMinutes}',
    preview#>>'{after,growthPlan,aggregateVersion}',preview#>>'{after,learningTrack,learningTrackId}',
    preview#>>'{after,learningTrack,trackKey}',preview#>>'{after,learningTrack,title}',
    preview#>>'{after,learningTrack,lifecycle}',preview#>>'{after,learningTrack,priority}',
    preview#>>'{after,learningTrack,protectedMinimumMinutes}',
    preview#>>'{after,learningTrack,defaultSessionMinutes}',
    preview#>>'{after,learningTrack,aggregateVersion}',preview->>'canApply',
    coalesce(preview#>>'{blockingReasons,0,code}',''),
    pg_catalog.jsonb_array_length(preview->'warnings')::text,
    preview#>>'{warnings,0,code}',preview#>>'{retained,readinessGoal}',
    preview#>>'{retained,competencyOverlay}',preview#>>'{retained,activitiesAndEvidence}',
    preview#>>'{retained,mastery}',preview#>>'{retained,reviews}',preview#>>'{retained,history}',
    preview#>>'{recalculationAfterApply,projectionState}',
    preview#>>'{recalculationAfterApply,eventChangeKind}',
    preview#>>'{recalculationAfterApply,consumerName}'
  ]::text[] as values
  from built
), independently_framed as (
  select preview, pg_catalog.string_agg(
    names[position] || ':' || pg_catalog.octet_length(
      pg_catalog.convert_to(coalesce(values[position],''),'UTF8')
    )::text || ':' || coalesce(values[position],'') || pg_catalog.chr(10),
    '' order by position
  ) as value
  from fields
  cross join lateral pg_catalog.generate_subscripts(names,1) as position
  group by preview
)
select is(
  preview->>'previewDigest',
  pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(value,'UTF8'),'sha256'),'hex'
  ),
  'production builder matches the independently framed exact digest field stream'
)
from independently_framed;

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '34000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'd1b-alice@pando.test', '', pg_catalog.clock_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
);

create temporary table d1b_results (
  result_name text primary key,
  response jsonb
);
grant select, insert, update on d1b_results to authenticated;
grant select on d1b_results to pando_planning_api;

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '34000000-0000-4000-8000-000000000001',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from pg_catalog.clock_timestamp()
      + interval '1 hour')::bigint
  )::text,
  true
);
set local role authenticated;

insert into d1b_results values (
  'bootstrap', api.bootstrap_personal_workspace('d1b-alice', 'D1b Alice')
);
insert into d1b_results values (
  'empty-source', api.get_growth_plan_setup_source_v1()
);
select is(
  (select response->>'state' from d1b_results where result_name = 'empty-source'),
  'NO_ACTIVE_GOALS',
  'a fresh workspace with no active goals returns the explicit empty state'
);

insert into d1b_results
select 'goal', api.create_readiness_goal(
  (select (response->>'workspace_id')::uuid from d1b_results where result_name = 'bootstrap'),
  'goal:d1b-unicode',
  repeat('界', 159) || ' X',
  'target:nvidia-python-verification-base-v1',
  'd1b-goal-create'
);
insert into d1b_results values (
  'source', api.get_growth_plan_setup_source_v1()
);

select is(
  (select response->>'state' from d1b_results where result_name = 'source'),
  'SETUP_AVAILABLE',
  'one active Goal exposes the setup capability'
);
select is(
  (select response->'capabilities' from d1b_results where result_name = 'source'),
  '["initialize_growth_plan"]'::jsonb,
  'setup capability is exact and array-shaped'
);
select is(
  (select pg_catalog.jsonb_array_length(response->'goals')
   from d1b_results where result_name = 'source'),
  1,
  'setup source returns the bounded Goal choice'
);
select ok(
  not ((select response->'goals'->0 from d1b_results where result_name = 'source')
    ?| array['readinessGoalId','profileVersionId','roadmapVersionId','workspaceId']),
  'setup source exposes no owner UUIDs or workspace authority'
);

insert into d1b_results
select 'preview', api.preview_growth_plan_initialization_v1(
  'goal:d1b-unicode',
  (select response#>>'{goals,0,aggregateVersion}' from d1b_results where result_name = 'source'),
  10080, 480, 100, 'Create the first plan — punctuation: :|,\.',
  '34000000-0000-4000-8000-000000000101'
);

select ok(
  (select (response->>'canApply')::boolean from d1b_results where result_name = 'preview')
  and (select response->'blockingReasons' from d1b_results where result_name = 'preview')
    = '[]'::jsonb,
  'boundary preview is applicable and unblocked'
);
select is(
  (
    select pg_catalog.jsonb_build_array(
      pg_catalog.char_length(response#>>'{after,growthPlan,title}'),
      pg_catalog.substring(response#>>'{after,growthPlan,title}', 160, 1),
      pg_catalog.char_length(response#>>'{after,learningTrack,title}')
    )
    from d1b_results where result_name = 'preview'
  ),
  '[161," ",159]'::jsonb,
  '161-character Unicode title trims the whitespace at the Track 160-character cut'
);
select ok(
  (select response#>>'{after,growthPlan,growthPlanId}'
   from d1b_results where result_name = 'preview')
    ~ '^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$',
  'derived Growth Plan identity is UUIDv8'
);
select is(
  (select response->'warnings' from d1b_results where result_name = 'preview'),
  '[{"code":"INITIAL_TRACK_HAS_NO_ACTIVITIES"}]'::jsonb,
  'preview returns the exact empty-Track warning'
);
select is(
  (select response->'retained' from d1b_results where result_name = 'preview'),
  '{"readinessGoal":true,"competencyOverlay":true,"activitiesAndEvidence":true,"mastery":true,"reviews":true,"history":true}'::jsonb,
  'preview returns the exact retained-state facts'
);

reset role;
select is((select pg_catalog.count(*) from planning.growth_plans
  where workspace_id = (select (response->>'workspace_id')::uuid
    from d1b_results where result_name = 'bootstrap')), 0::bigint,
  'preview creates no Growth Plan');
select is((select pg_catalog.count(*) from planning.learning_tracks
  where workspace_id = (select (response->>'workspace_id')::uuid
    from d1b_results where result_name = 'bootstrap')), 0::bigint,
  'preview creates no Learning Track');
select is((select pg_catalog.count(*) from outbox.command_receipts
  where command_type = 'planning.initialize_growth_plan_v2'
    and workspace_id = (select (response->>'workspace_id')::uuid
      from d1b_results where result_name = 'bootstrap')), 0::bigint,
  'preview creates no receipt');
select is((select pg_catalog.count(*) from outbox.events
  where payload->>'change_kind' = 'INITIALIZED'
    and workspace_id = (select (response->>'workspace_id')::uuid
      from d1b_results where result_name = 'bootstrap')), 0::bigint,
  'preview creates no event');

set local role authenticated;
insert into d1b_results
select 'apply', api.apply_growth_plan_initialization_v1(
  'goal:d1b-unicode',
  (select response#>>'{goals,0,aggregateVersion}' from d1b_results where result_name = 'source'),
  10080, 480, 100, 'Create the first plan — punctuation: :|,\.',
  '34000000-0000-4000-8000-000000000101',
  (select response->>'previewDigest' from d1b_results where result_name = 'preview')
);
insert into d1b_results
select 'replay', api.apply_growth_plan_initialization_v1(
  'goal:d1b-unicode',
  (select response#>>'{goals,0,aggregateVersion}' from d1b_results where result_name = 'source'),
  10080, 480, 100, 'Create the first plan — punctuation: :|,\.',
  '34000000-0000-4000-8000-000000000101',
  (select response->>'previewDigest' from d1b_results where result_name = 'preview')
);

select is(
  (select response from d1b_results where result_name = 'replay'),
  (select response from d1b_results where result_name = 'apply'),
  'completed replay returns the stored response byte-for-byte'
);
select throws_ok(
  $$select api.apply_growth_plan_initialization_v1(
    'goal:d1b-unicode','1',10079,480,100,
    'Create the first plan — punctuation: :|,.',
    '34000000-0000-4000-8000-000000000101',
    (select response->>'previewDigest' from d1b_results where result_name = 'preview')
  )$$,
  '22023', 'idempotency key reused with a different request',
  'same key with a changed request conflicts'
);
select throws_ok(
  $$select api.initialize_growth_plan_v1(
    'goal:d1b-unicode',600,30,50,0,'legacy-denied'
  )$$,
  '42501', null,
  'the legacy public initializer is denied at runtime'
);
select throws_ok(
  $$select planning.initialize_growth_plan_impl_v1(
    'goal:d1b-unicode',600,30,50,0,'legacy-private-denied'
  )$$,
  '42501', null,
  'the legacy private initializer is denied at runtime'
);
reset role;

select is((select pg_catalog.count(*) from planning.growth_plans
  where workspace_id = (select (response->>'workspace_id')::uuid
    from d1b_results where result_name = 'bootstrap')), 1::bigint,
  'apply inserts exactly one Growth Plan');
select is((select pg_catalog.count(*) from planning.learning_tracks
  where workspace_id = (select (response->>'workspace_id')::uuid
    from d1b_results where result_name = 'bootstrap')), 1::bigint,
  'apply inserts exactly one initial Learning Track');
select is((select pg_catalog.count(*) from planning.current_plan_snapshots
  where workspace_id = (select (response->>'workspace_id')::uuid
    from d1b_results where result_name = 'bootstrap')), 1::bigint,
  'apply inserts exactly one pending snapshot sentinel');
select is((select pg_catalog.count(*) from outbox.command_receipts
  where command_type = 'planning.initialize_growth_plan_v2'
    and workspace_id = (select (response->>'workspace_id')::uuid
      from d1b_results where result_name = 'bootstrap')), 1::bigint,
  'apply completes exactly one v2 receipt');
select is((select pg_catalog.count(*) from outbox.events
  where payload->>'change_kind' = 'INITIALIZED'
    and workspace_id = (select (response->>'workspace_id')::uuid
      from d1b_results where result_name = 'bootstrap')), 1::bigint,
  'apply emits exactly one preserved INITIALIZED event');
select is((select pg_catalog.count(*) from outbox.deliveries
  where consumer_name = 'planning.plan_snapshot_v1'
    and workspace_id = (select (response->>'workspace_id')::uuid
      from d1b_results where result_name = 'bootstrap')), 1::bigint,
  'apply emits exactly one fixed Planning delivery');
select is(
  (select pg_catalog.jsonb_typeof(payload->'growth_plan_version')
   from outbox.events where payload->>'change_kind' = 'INITIALIZED'
     and workspace_id = (select (response->>'workspace_id')::uuid
       from d1b_results where result_name = 'bootstrap')),
  'number',
  'preserved event payload keeps numeric version values'
);
select is(
  (select expected_aggregate_version from outbox.command_receipts
   where command_type = 'planning.initialize_growth_plan_v2'
     and workspace_id = (select (response->>'workspace_id')::uuid
       from d1b_results where result_name = 'bootstrap')),
  0::bigint,
  'create receipt records expected aggregate version zero'
);

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '34000000-0000-4000-8000-000000000001',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from pg_catalog.clock_timestamp()
      + interval '1 hour')::bigint
  )::text,
  true
);
set local role authenticated;
insert into d1b_results values ('after-source', api.get_growth_plan_setup_source_v1());
select is(
  (select response->>'state' from d1b_results where result_name = 'after-source'),
  'CURRENT_PLAN_EXISTS',
  'setup source switches to the exact current-Plan state after apply'
);
select is(
  (select response->'goals' from d1b_results where result_name = 'after-source'),
  '[]'::jsonb,
  'unavailable source never leaks stale Goal choices'
);
reset role;

select is(
  (
    select pg_catalog.jsonb_build_object(
      'eventName', event_name,
      'eventSchemaVersion', event_schema_version,
      'workspaceId', workspace_id,
      'aggregateType', aggregate_type,
      'aggregateId', aggregate_id,
      'aggregateVersion', aggregate_version,
      'actorType', actor_type,
      'actorUserId', actor_user_id,
      'commandId', command_id,
      'correlationId', correlation_id,
      'source', source,
      'payload', payload,
      'metadata', metadata
    )
    from outbox.events
    where payload->>'change_kind' = 'INITIALIZED'
      and workspace_id = (select (response->>'workspace_id')::uuid
        from d1b_results where result_name = 'bootstrap')
  ),
  (
    select pg_catalog.jsonb_build_object(
      'eventName', 'planning.input_changed',
      'eventSchemaVersion', 1,
      'workspaceId', receipt.workspace_id,
      'aggregateType', 'planning.growth_plan',
      'aggregateId', plan.growth_plan_id,
      'aggregateVersion', 1,
      'actorType', 'user',
      'actorUserId', receipt.actor_user_id,
      'commandId', receipt.command_id,
      'correlationId', receipt.correlation_id,
      'source', 'pando.database',
      'payload', pg_catalog.jsonb_build_object(
        'change_kind', 'INITIALIZED',
        'growth_plan_id', plan.growth_plan_id,
        'growth_plan_version', 1,
        'learning_track_id', track.learning_track_id,
        'learning_track_version', 1,
        'readiness_goal_id', track.readiness_goal_id,
        'profile_version_id', track.profile_version_id
      ),
      'metadata', '{}'::jsonb
    )
    from outbox.command_receipts as receipt
    join planning.growth_plans as plan
      on plan.workspace_id = receipt.workspace_id
    join planning.learning_tracks as track
      on track.growth_plan_id = plan.growth_plan_id
    where receipt.command_type = 'planning.initialize_growth_plan_v2'
      and receipt.workspace_id = (select (response->>'workspace_id')::uuid
        from d1b_results where result_name = 'bootstrap')
  ),
  'initialization emits the exact preserved event envelope and payload'
);
select ok(
  (
    select delivery.delivery_state = 'pending'
      and delivery.attempt_count = 0
      and delivery.consumer_name = 'planning.plan_snapshot_v1'
      and delivery.handler_contract_version = 1
    from outbox.deliveries as delivery
    join outbox.events as event on event.event_id = delivery.event_id
    where event.payload->>'change_kind' = 'INITIALIZED'
      and event.workspace_id = (select (response->>'workspace_id')::uuid
        from d1b_results where result_name = 'bootstrap')
  )
  and (
    select pointer.snapshot_id is null
      and pointer.pointer_version = 0
      and pointer.applied_attempt_id is null
    from planning.current_plan_snapshots as pointer
    where pointer.workspace_id = (select (response->>'workspace_id')::uuid
      from d1b_results where result_name = 'bootstrap')
  )
  and not exists (
    select 1 from planning.plan_snapshots
    where workspace_id = (select (response->>'workspace_id')::uuid
      from d1b_results where result_name = 'bootstrap')
  ),
  'delivery and pending pointer are exact and prior snapshot history stays unchanged'
);

create function pg_temp.provision_d1b_actor(
  p_user_id uuid,
  p_slug text,
  p_goal_key text,
  p_goal_title text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_bootstrap jsonb;
begin
  insert into auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    p_user_id, 'authenticated', 'authenticated', p_slug || '@d1b.test', '',
    pg_catalog.clock_timestamp(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
  );
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object(
      'sub', p_user_id, 'role', 'authenticated', 'aud', 'authenticated',
      'exp', extract(epoch from pg_catalog.clock_timestamp()
        + interval '1 hour')::bigint
    )::text,
    true
  );
  v_bootstrap := api.bootstrap_personal_workspace(p_slug, 'D1b ' || p_slug);
  if p_goal_key is not null then
    perform api.create_readiness_goal(
      (v_bootstrap->>'workspace_id')::uuid,
      p_goal_key,
      p_goal_title,
      'target:nvidia-python-verification-base-v1',
      'd1b-fixture-' || p_slug
    );
  end if;
  return (v_bootstrap->>'workspace_id')::uuid;
end
$function$;

create temporary table d1b_scenarios (
  scenario text primary key,
  auth_user_id uuid not null,
  workspace_id uuid not null,
  goal_key text
);
insert into d1b_scenarios values
  (
    'refusal', '34100000-0000-4000-8000-000000000001',
    pg_temp.provision_d1b_actor(
      '34100000-0000-4000-8000-000000000001', 'refusal',
      'goal:refusal', 'Refusal Goal'
    ), 'goal:refusal'
  ),
  (
    'foreign', '34100000-0000-4000-8000-000000000002',
    pg_temp.provision_d1b_actor(
      '34100000-0000-4000-8000-000000000002', 'foreign',
      'goal:foreign-only', 'Foreign Goal'
    ), 'goal:foreign-only'
  ),
  (
    'cap', '34100000-0000-4000-8000-000000000003',
    pg_temp.provision_d1b_actor(
      '34100000-0000-4000-8000-000000000003', 'cap',
      'goal:cap-01', 'Capacity Goal 01'
    ), 'goal:cap-01'
  ),
  (
    'orphan', '34100000-0000-4000-8000-000000000004',
    pg_temp.provision_d1b_actor(
      '34100000-0000-4000-8000-000000000004', 'orphan', null, null
    ), null
  ),
  (
    'collision', '34100000-0000-4000-8000-000000000005',
    pg_temp.provision_d1b_actor(
      '34100000-0000-4000-8000-000000000005', 'collision',
      'goal:collision', 'Collision Goal'
    ), 'goal:collision'
  ),
  (
    'rollback', '34100000-0000-4000-8000-000000000006',
    pg_temp.provision_d1b_actor(
      '34100000-0000-4000-8000-000000000006', 'rollback',
      'goal:rollback', 'Rollback Goal'
    ), 'goal:rollback'
  );

select pg_catalog.set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '34100000-0000-4000-8000-000000000001',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from pg_catalog.clock_timestamp()
      + interval '1 hour')::bigint
  )::text,
  true
);
set local role authenticated;
select throws_ok(
  $$select api.preview_growth_plan_initialization_v1(
    'goal:UPPER','1',600,30,50,'Malformed selector.',
    '34100000-0000-4000-8000-000000000101'
  )$$,
  '22023', 'readiness goal key is invalid',
  'malformed Goal selector is rejected before lookup'
);
select throws_ok(
  $$select api.preview_growth_plan_initialization_v1(
    'goal:missing','1',600,30,50,'Missing selector.',
    '34100000-0000-4000-8000-000000000102'
  )$$,
  '42501', 'setup source is unavailable',
  'missing Goal selector is unavailable without enumeration'
);
select throws_ok(
  $$select api.preview_growth_plan_initialization_v1(
    'goal:foreign-only','1',600,30,50,'Foreign selector.',
    '34100000-0000-4000-8000-000000000103'
  )$$,
  '42501', 'setup source is unavailable',
  'foreign same-shaped Goal selector is indistinguishable from missing'
);
reset role;

update targets.readiness_goals
set lifecycle = 'paused', aggregate_version = 2
where workspace_id = (select workspace_id from d1b_scenarios where scenario = 'refusal');
set local role authenticated;
select throws_ok(
  $$select api.preview_growth_plan_initialization_v1(
    'goal:refusal','2',600,30,50,'Paused selector.',
    '34100000-0000-4000-8000-000000000104'
  )$$,
  '42501', 'setup source is unavailable',
  'inactive Goal selector is unavailable without enumeration'
);
reset role;
update targets.readiness_goals
set lifecycle = 'completed', aggregate_version = 3
where workspace_id = (select workspace_id from d1b_scenarios where scenario = 'refusal');
set local role authenticated;
select throws_ok(
  $$select api.preview_growth_plan_initialization_v1(
    'goal:refusal','3',600,30,50,'Completed selector.',
    '34100000-0000-4000-8000-000000000105'
  )$$,
  '42501', 'setup source is unavailable',
  'completed terminal Goal selector is unavailable without enumeration'
);
reset role;
update targets.readiness_goals
set lifecycle = 'archived', aggregate_version = 4
where workspace_id = (select workspace_id from d1b_scenarios where scenario = 'refusal');
set local role authenticated;
select throws_ok(
  $$select api.preview_growth_plan_initialization_v1(
    'goal:refusal','4',600,30,50,'Archived selector.',
    '34100000-0000-4000-8000-000000000106'
  )$$,
  '42501', 'setup source is unavailable',
  'archived terminal Goal selector is unavailable without enumeration'
);
reset role;
update targets.readiness_goals
set lifecycle = 'active', aggregate_version = 5, title = repeat('界', 160)
where workspace_id = (select workspace_id from d1b_scenarios where scenario = 'refusal');
set local role authenticated;
select throws_ok(
  $$select api.preview_growth_plan_initialization_v1(
    'goal:refusal','4',600,30,50,'Stale selector.',
    '34100000-0000-4000-8000-000000000107'
  )$$,
  '40001', 'readiness goal source is stale',
  'active Goal with a stale version fails the exact source fence'
);
select ok(
  (
    select pg_catalog.char_length(preview#>>'{after,growthPlan,title}') = 160
      and pg_catalog.char_length(preview#>>'{after,learningTrack,title}') = 160
      and (preview->>'canApply')::boolean
    from (
      select api.preview_growth_plan_initialization_v1(
        'goal:refusal','5',0,1,0,'Lower numeric boundaries.',
        '34100000-0000-4000-8000-000000000108'
      ) as preview
    ) as bounded
  ),
  '160-character titles and all lower numeric boundaries are accepted exactly'
);
select throws_ok(
  $$select api.preview_growth_plan_initialization_v1(
    'goal:refusal','5',10081,30,50,'Capacity overflow.',
    '34100000-0000-4000-8000-000000000109'
  )$$,
  '22023', 'Growth Plan setup request is invalid',
  'capacity above 10080 is rejected'
);
select throws_ok(
  $$select api.preview_growth_plan_initialization_v1(
    'goal:refusal','5',600,0,50,'Session underflow.',
    '34100000-0000-4000-8000-000000000110'
  )$$,
  '22023', 'Growth Plan setup request is invalid',
  'session below 1 is rejected'
);
select throws_ok(
  $$select api.preview_growth_plan_initialization_v1(
    'goal:refusal','5',600,30,101,'Priority overflow.',
    '34100000-0000-4000-8000-000000000111'
  )$$,
  '22023', 'Growth Plan setup request is invalid',
  'priority above 100 is rejected'
);
reset role;
update targets.readiness_goals
set aggregate_version = 6, title = repeat('界', 200)
where workspace_id = (select workspace_id from d1b_scenarios where scenario = 'refusal');
set local role authenticated;
select ok(
  (
    select pg_catalog.char_length(preview#>>'{after,growthPlan,title}') = 200
      and pg_catalog.char_length(preview#>>'{after,learningTrack,title}') = 160
    from (
      select api.preview_growth_plan_initialization_v1(
        'goal:refusal','6',600,30,50,'Two title bounds.',
        '34100000-0000-4000-8000-000000000112'
      ) as preview
    ) as bounded
  ),
  '200-character Goal title is retained by Plan and truncated to 160 for Track'
);
reset role;

alter table targets.readiness_goals disable trigger readiness_goal_active_envelope;
insert into targets.readiness_goals (
  readiness_goal_id, workspace_id, readiness_goal_key, title,
  profile_version_id, lifecycle, aggregate_version
)
select gen_random_uuid(), seed.workspace_id,
  'goal:cap-' || pg_catalog.lpad(number::text, 2, '0'),
  'Capacity Goal ' || pg_catalog.lpad(number::text, 2, '0'),
  seed.profile_version_id, 'active', 1
from targets.readiness_goals as seed
cross join pg_catalog.generate_series(2, 20) as number
where seed.workspace_id = (select workspace_id from d1b_scenarios where scenario = 'cap')
  and seed.readiness_goal_key = 'goal:cap-01';
alter table targets.readiness_goals enable trigger readiness_goal_active_envelope;
select pg_catalog.set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '34100000-0000-4000-8000-000000000003',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from pg_catalog.clock_timestamp()
      + interval '1 hour')::bigint
  )::text,
  true
);
set local role authenticated;
select ok(
  (
    select source->>'state' = 'SETUP_AVAILABLE'
      and pg_catalog.jsonb_array_length(source->'goals') = 20
    from (select api.get_growth_plan_setup_source_v1() as source) as bounded
  ),
  'exactly 20 active Goals are returned without truncation'
);
reset role;
alter table targets.readiness_goals disable trigger readiness_goal_active_envelope;
insert into targets.readiness_goals (
  readiness_goal_id, workspace_id, readiness_goal_key, title,
  profile_version_id, lifecycle, aggregate_version
)
select gen_random_uuid(), workspace_id, 'goal:cap-21', 'Capacity Goal 21',
  profile_version_id, 'active', 1
from targets.readiness_goals
where workspace_id = (select workspace_id from d1b_scenarios where scenario = 'cap')
  and readiness_goal_key = 'goal:cap-01';
alter table targets.readiness_goals enable trigger readiness_goal_active_envelope;
set local role authenticated;
select is(
  (select api.get_growth_plan_setup_source_v1()),
  '{"contract":{"name":"GrowthPlanSetupSourceV1","version":"1.0.0"},"state":"GOAL_PORTFOLIO_OVERFLOW","capabilities":[],"goals":[]}'::jsonb,
  '21 active Goals fail closed with no truncated choices or capability'
);
reset role;

insert into planning.current_plan_snapshots (
  workspace_id, snapshot_id, pointer_version, applied_attempt_id
) values (
  (select workspace_id from d1b_scenarios where scenario = 'orphan'), null, 0, null
);
select pg_catalog.set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '34100000-0000-4000-8000-000000000004',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from pg_catalog.clock_timestamp()
      + interval '1 hour')::bigint
  )::text,
  true
);
set local role authenticated;
select throws_ok(
  $$select api.get_growth_plan_setup_source_v1()$$,
  '55000', 'Growth Plan setup state is corrupt',
  'orphan snapshot sentinel is an unavailable corruption failure'
);
reset role;

update planning.growth_plans set lifecycle = 'archived'
where workspace_id = (select (response->>'workspace_id')::uuid
  from d1b_results where result_name = 'bootstrap');
select pg_catalog.set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '34000000-0000-4000-8000-000000000001',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from pg_catalog.clock_timestamp()
      + interval '1 hour')::bigint
  )::text,
  true
);
set local role authenticated;
select is(
  (select api.get_growth_plan_setup_source_v1()->>'state'),
  'HISTORY_REQUIRES_REPLACEMENT',
  'archived-only Plan history blocks separately from a current Plan'
);
reset role;

insert into planning.growth_plans (
  growth_plan_id, workspace_id, title, lifecycle,
  weekly_capacity_minutes, aggregate_version
) values (
  planning.derive_first_growth_plan_identity_v1(
    (select workspace_id from d1b_scenarios where scenario = 'collision'),
    'planning.initialize_growth_plan_v2',
    '34100000-0000-4000-8000-000000000501', 'growth-plan'
  ),
  (select workspace_id from d1b_scenarios where scenario = 'collision'),
  'Injected collision', 'archived', 600, 1
);
select pg_catalog.set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '34100000-0000-4000-8000-000000000005',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from pg_catalog.clock_timestamp()
      + interval '1 hour')::bigint
  )::text,
  true
);
set local role authenticated;
select is(
  (select api.preview_growth_plan_initialization_v1(
    'goal:collision','1',600,30,50,'Collision proof.',
    '34100000-0000-4000-8000-000000000501'
  )#>>'{blockingReasons,0,code}'),
  'PLANNING_CREATE_IDENTITY_COLLISION',
  'pre-existing derived identity collision is a typed blocker'
);
reset role;

insert into planning.growth_plans (
  growth_plan_id, workspace_id, title, lifecycle,
  weekly_capacity_minutes, aggregate_version
) values (
  '34100000-0000-8000-8000-000000000999',
  (select (response->>'workspace_id')::uuid
   from d1b_results where result_name = 'bootstrap'),
  'Injected lifetime corruption', 'archived', 600, 1
);
select pg_catalog.set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '34000000-0000-4000-8000-000000000001',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from pg_catalog.clock_timestamp()
      + interval '1 hour')::bigint
  )::text,
  true
);
set local role authenticated;
select throws_ok(
  $$select api.get_growth_plan_setup_source_v1()$$,
  '55000', 'Growth Plan setup state is corrupt',
  'more than one lifetime Plan fails closed as persisted-cardinality corruption'
);
reset role;

do $grant_planning_test_role$
begin
  execute pg_catalog.format('grant pando_planning_api to %I with set true', current_user);
end
$grant_planning_test_role$;
select pg_catalog.set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '34100000-0000-4000-8000-000000000002',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from pg_catalog.clock_timestamp()
      + interval '1 hour')::bigint
  )::text,
  true
);
set local role pando_planning_api;
select is(
  (select pg_catalog.count(*) from planning.growth_plans
   where workspace_id = (select (response->>'workspace_id')::uuid
     from d1b_results where result_name = 'bootstrap')),
  0::bigint,
  'forced RLS hides a foreign workspace from the Planning owner role'
);
select throws_ok(
  $$insert into planning.growth_plans (
    growth_plan_id, workspace_id, title, lifecycle,
    weekly_capacity_minutes, aggregate_version
  ) values (
    '34100000-0000-8000-8000-000000000998',
    (select (response->>'workspace_id')::uuid
     from d1b_results where result_name = 'bootstrap'),
    'Cross-workspace insert must fail', 'archived', 600, 1
  )$$,
  '42501', null,
  'forced INSERT RLS rejects cross-workspace mutation by the Planning owner role'
);
reset role;
do $revoke_planning_test_role$
begin
  execute pg_catalog.format('revoke pando_planning_api from %I', current_user);
end
$revoke_planning_test_role$;

alter table targets.target_profile_versions
  disable trigger target_profile_versions_immutable_after_publish;
update targets.target_profile_versions
set roadmap_version_id = null
where profile_version_key = 'target:nvidia-python-verification-base-v1';
alter table targets.target_profile_versions
  enable trigger target_profile_versions_immutable_after_publish;
insert into d1b_scenarios values (
  'source-less', '34100000-0000-4000-8000-000000000007',
  pg_temp.provision_d1b_actor(
    '34100000-0000-4000-8000-000000000007', 'source-less',
    'goal:source-less', 'Source-less Profile Goal'
  ), 'goal:source-less'
);
select pg_catalog.set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '34100000-0000-4000-8000-000000000007',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from pg_catalog.clock_timestamp()
      + interval '1 hour')::bigint
  )::text,
  true
);
set local role authenticated;
with source as materialized (
  select api.get_growth_plan_setup_source_v1() as value
), preview as (
  select api.preview_growth_plan_initialization_v1(
    'goal:source-less', source.value#>>'{goals,0,aggregateVersion}',
    600,30,50,'Source-less representation.',
    '34100000-0000-4000-8000-000000000701'
  ) as value
  from source
)
select ok(
  (select (value#>>'{goals,0,roadmapPresent}')::boolean is false from source)
  and (select value#>>'{source,sourceKind}'
       from preview) = 'TARGET_PROFILE_REQUIREMENT_COLLECTION'
  and (select value#>>'{source,roadmapVersionId}' from preview) is null
  and (select value#>>'{source,sourceRef}' = value#>>'{source,profileVersionId}'
       from preview),
  'null-roadmap source uses the profile UUID representation without omission'
);
reset role;

create temporary table d1b_rollback_cases (
  stage text primary key,
  idempotency_key text not null,
  reason text not null,
  preview jsonb not null
);
grant select, insert on d1b_rollback_cases to authenticated;
select pg_catalog.set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '34100000-0000-4000-8000-000000000006',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from pg_catalog.clock_timestamp()
      + interval '1 hour')::bigint
  )::text,
  true
);
set local role authenticated;
insert into d1b_rollback_cases
select stage, idempotency_key, reason,
  api.preview_growth_plan_initialization_v1(
    'goal:rollback','1',600,30,50,reason,idempotency_key
  )
from (values
  ('outbox.command_receipts','34100000-0000-4000-8000-000000000601','Fail receipt insert.'),
  ('planning.growth_plans','34100000-0000-4000-8000-000000000602','Fail Plan insert.'),
  ('planning.learning_tracks','34100000-0000-4000-8000-000000000603','Fail Track insert.'),
  ('outbox.events','34100000-0000-4000-8000-000000000604','Fail event insert.'),
  ('outbox.deliveries','34100000-0000-4000-8000-000000000605','Fail delivery insert.')
) as candidate(stage,idempotency_key,reason);
reset role;

create function pg_temp.reject_d1b_stage()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_stage text := tg_table_schema || '.' || tg_table_name;
begin
  if new.workspace_id::text = pg_catalog.current_setting(
       'pando.test.d1b_fail_workspace', true
     )
     and v_stage = pg_catalog.current_setting('pando.test.d1b_fail_stage', true) then
    raise exception using errcode = 'P0001',
      message = 'injected D1b failure at ' || v_stage;
  end if;
  return new;
end
$function$;
create trigger reject_d1b_receipt
before insert on outbox.command_receipts
for each row execute function pg_temp.reject_d1b_stage();
create trigger reject_d1b_plan
before insert on planning.growth_plans
for each row execute function pg_temp.reject_d1b_stage();
create trigger reject_d1b_track
before insert on planning.learning_tracks
for each row execute function pg_temp.reject_d1b_stage();
create trigger reject_d1b_event
before insert on outbox.events
for each row execute function pg_temp.reject_d1b_stage();
create trigger reject_d1b_delivery
before insert on outbox.deliveries
for each row execute function pg_temp.reject_d1b_stage();
select pg_catalog.set_config(
  'pando.test.d1b_fail_workspace',
  (select workspace_id::text from d1b_scenarios where scenario = 'rollback'),
  true
);
set local role authenticated;
select throws_ok(
  pg_catalog.format(
    $query$
      with configured as (
        select pg_catalog.set_config('pando.test.d1b_fail_stage', %L, true) as stage
      )
      select api.apply_growth_plan_initialization_v1(
        'goal:rollback','1',600,30,50,%L,%L,%L
      )
      from configured where stage is not null
    $query$,
    stage, reason, idempotency_key, preview->>'previewDigest'
  ),
  'P0001', 'injected D1b failure at ' || stage,
  stage || ' failure rolls back the entire initialization command'
)
from d1b_rollback_cases
order by stage;
reset role;
drop trigger reject_d1b_receipt on outbox.command_receipts;
drop trigger reject_d1b_plan on planning.growth_plans;
drop trigger reject_d1b_track on planning.learning_tracks;
drop trigger reject_d1b_event on outbox.events;
drop trigger reject_d1b_delivery on outbox.deliveries;

select ok(
  not exists (
    select 1 from planning.growth_plans
    where workspace_id = (select workspace_id from d1b_scenarios where scenario = 'rollback')
  )
  and not exists (
    select 1 from planning.learning_tracks
    where workspace_id = (select workspace_id from d1b_scenarios where scenario = 'rollback')
  )
  and not exists (
    select 1 from planning.current_plan_snapshots
    where workspace_id = (select workspace_id from d1b_scenarios where scenario = 'rollback')
  )
  and not exists (
    select 1 from outbox.command_receipts
    where command_type = 'planning.initialize_growth_plan_v2'
      and workspace_id = (select workspace_id from d1b_scenarios where scenario = 'rollback')
  )
  and not exists (
    select 1 from outbox.events
    where payload->>'change_kind' = 'INITIALIZED'
      and workspace_id = (select workspace_id from d1b_scenarios where scenario = 'rollback')
  )
  and not exists (
    select 1 from outbox.deliveries
    where workspace_id = (select workspace_id from d1b_scenarios where scenario = 'rollback')
      and consumer_name = 'planning.plan_snapshot_v1'
  ),
  'all injected stages leave no Plan, Track, sentinel, receipt, event, or delivery'
);

select * from finish();
rollback;
