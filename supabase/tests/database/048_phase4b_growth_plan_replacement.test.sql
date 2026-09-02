begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- Public boundary: exactly three authenticated entry points and no private alternative.
select ok(
  pg_catalog.has_function_privilege(
    'authenticated', 'api.get_growth_plan_replacement_source_v1()', 'EXECUTE'
  ) and pg_catalog.has_function_privilege(
    'authenticated',
    'api.preview_growth_plan_replacement_v1(text,text,text,integer,integer,integer,text,text)',
    'EXECUTE'
  ) and pg_catalog.has_function_privilege(
    'authenticated',
    'api.apply_growth_plan_replacement_v1(text,text,text,integer,integer,integer,text,text,text)',
    'EXECUTE'
  ),
  'authenticated has exactly the three D3a public entry points'
);

select ok(
  not pg_catalog.has_function_privilege(runtime.role_name, expected.signature, 'EXECUTE'),
  format('%s cannot execute %s', runtime.role_name, expected.signature)
)
from (values ('anon'), ('service_role')) as runtime(role_name)
cross join (values
  ('api.get_growth_plan_replacement_source_v1()'),
  ('api.preview_growth_plan_replacement_v1(text,text,text,integer,integer,integer,text,text)'),
  ('api.apply_growth_plan_replacement_v1(text,text,text,integer,integer,integer,text,text,text)')
) as expected(signature);

select ok(
  not pg_catalog.has_function_privilege(runtime.role_name, expected.signature, 'EXECUTE'),
  format('%s cannot execute private D3a helper %s', runtime.role_name, expected.signature)
)
from (values ('anon'), ('authenticated'), ('service_role')) as runtime(role_name)
cross join (values
  ('planning.growth_plan_replacement_constraint_v1(uuid,uuid)'),
  ('planning.derive_growth_plan_replacement_identity_v1(uuid,text,text,text)'),
  ('planning.plan_replaced_event_payload_v1_is_valid(jsonb)'),
  ('planning.resolve_growth_plan_replacement_preview_v1(uuid,text,bigint,bigint,integer,integer,integer,text,text)')
) as expected(signature);

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
    'get_growth_plan_replacement_source_v1',
    'preview_growth_plan_replacement_v1',
    'apply_growth_plan_replacement_v1'
  )
order by procedure.proname;

select ok(
  not pg_catalog.has_table_privilege('pando_planning_api', 'targets.readiness_goals', 'SELECT'),
  'D3a adds no Targets table privilege to Planning'
);

-- The derived identities are fixed, distinct, lowercase UUIDv8 oracles.
select is(
  planning.derive_growth_plan_replacement_identity_v1(
    'a0000000-0000-4000-8000-000000000001',
    'planning.replace_growth_plan_v1',
    'b0000000-0000-4000-8000-000000000001',
    'growth-plan'
  )::text,
  pg_catalog.lower(
    planning.derive_growth_plan_replacement_identity_v1(
      'a0000000-0000-4000-8000-000000000001',
      'planning.replace_growth_plan_v1',
      'b0000000-0000-4000-8000-000000000001',
      'growth-plan'
    )::text
  ),
  'the derived replacement Plan identity is deterministic and lowercase'
);
select isnt(
  planning.derive_growth_plan_replacement_identity_v1(
    'a0000000-0000-4000-8000-000000000001', 'planning.replace_growth_plan_v1',
    'b0000000-0000-4000-8000-000000000001', 'growth-plan'
  )::text,
  planning.derive_growth_plan_replacement_identity_v1(
    'a0000000-0000-4000-8000-000000000001', 'planning.replace_growth_plan_v1',
    'b0000000-0000-4000-8000-000000000001', 'initial-learning-track'
  )::text,
  'Plan and Track identities are distinct for the same replacement request'
);
select isnt(
  planning.derive_growth_plan_replacement_identity_v1(
    'a0000000-0000-4000-8000-000000000001', 'planning.replace_growth_plan_v1',
    'b0000000-0000-4000-8000-000000000001', 'growth-plan'
  )::text,
  planning.derive_first_growth_plan_identity_v1(
    'a0000000-0000-4000-8000-000000000001', 'planning.initialize_growth_plan_v2',
    'b0000000-0000-4000-8000-000000000001', 'growth-plan'
  )::text,
  'replacement identities never collide with first-setup identities for the same key'
);
select throws_ok(
  $$select planning.derive_growth_plan_replacement_identity_v1(
    'a0000000-0000-4000-8000-000000000001', 'planning.initialize_growth_plan_v2',
    'b0000000-0000-4000-8000-000000000001', 'growth-plan'
  )$$,
  '22023', 'replacement identity input is invalid',
  'the replacement identity refuses another command type'
);

-- The event payload validator admits only the exact minimal replacement wake-up.
select ok(
  planning.plan_replaced_event_payload_v1_is_valid(pg_catalog.jsonb_build_object(
    'change_kind', 'PLAN_REPLACED',
    'archived_growth_plan_id', '10000000-0000-4000-8000-000000000001',
    'archived_growth_plan_version', '2',
    'growth_plan_id', '10000000-0000-8000-8000-000000000002',
    'learning_track_id', '10000000-0000-8000-8000-000000000003',
    'readiness_goal_id', '10000000-0000-4000-8000-000000000004',
    'profile_version_id', '10000000-0000-4000-8000-000000000005'
  )),
  'the exact seven-key replacement payload is valid'
);
select ok(
  not planning.plan_replaced_event_payload_v1_is_valid(pg_catalog.jsonb_build_object(
    'change_kind', 'PLAN_REPLACED',
    'archived_growth_plan_id', '10000000-0000-4000-8000-000000000001',
    'archived_growth_plan_version', '2',
    'growth_plan_id', '10000000-0000-4000-8000-000000000001',
    'learning_track_id', '10000000-0000-8000-8000-000000000003',
    'readiness_goal_id', '10000000-0000-4000-8000-000000000004',
    'profile_version_id', '10000000-0000-4000-8000-000000000005'
  )),
  'a payload that archives and creates the same aggregate is refused'
);
select ok(
  not planning.plan_replaced_event_payload_v1_is_valid(pg_catalog.jsonb_build_object(
    'change_kind', 'PLAN_REPLACED',
    'archived_growth_plan_id', '10000000-0000-4000-8000-000000000001',
    'archived_growth_plan_version', '2',
    'growth_plan_id', '10000000-0000-8000-8000-000000000002',
    'learning_track_id', '10000000-0000-8000-8000-000000000003',
    'readiness_goal_id', '10000000-0000-4000-8000-000000000004',
    'profile_version_id', '10000000-0000-4000-8000-000000000005',
    'reason', 'private body'
  )),
  'a payload carrying a private reason body is refused'
);

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '48000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'd3a-alice@pando.test', '', pg_catalog.clock_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
), (
  '48000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
  'd3a-bob@pando.test', '', pg_catalog.clock_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
);

create temporary table d3a_results (result_name text primary key, response jsonb);
grant select, insert, update on d3a_results to authenticated;

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '48000000-0000-4000-8000-000000000001',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from pg_catalog.clock_timestamp() + interval '1 hour')::bigint
  )::text,
  true
);
set local role authenticated;

insert into d3a_results values (
  'bootstrap', api.bootstrap_personal_workspace('d3a-alice', 'D3a Alice')
);
insert into d3a_results values (
  'no-plan-source', api.get_growth_plan_replacement_source_v1()
);
select is(
  (select response->>'state' from d3a_results where result_name = 'no-plan-source'),
  'NO_CURRENT_PLAN',
  'an uninitialized workspace reports the explicit no-current-plan replacement state'
);
select is(
  (select response->'currentPlan' from d3a_results where result_name = 'no-plan-source'),
  'null'::jsonb,
  'the unavailable replacement source exposes no Plan detail'
);
select throws_ok(
  $$select api.preview_growth_plan_replacement_v1(
    'goal:d3a-first', '1', '1', 600, 30, 50, 'No Plan yet.',
    '48000000-0000-4000-8000-0000000000a1'
  )$$,
  '42501', 'Growth Plan is unavailable',
  'replacement fails closed when the workspace has no current Plan'
);

insert into d3a_results
select 'goal-first', api.create_readiness_goal(
  (select (response->>'workspace_id')::uuid from d3a_results where result_name = 'bootstrap'),
  'goal:d3a-first', 'D3a first target',
  'target:nvidia-python-verification-base-v1', 'd3a-goal-first'
);
insert into d3a_results
select 'goal-second', api.create_readiness_goal(
  (select (response->>'workspace_id')::uuid from d3a_results where result_name = 'bootstrap'),
  'goal:d3a-second', 'D3a second target',
  'target:nvidia-python-verification-base-v1', 'd3a-goal-second'
);
insert into d3a_results values ('setup-source', api.get_growth_plan_setup_source_v1());
insert into d3a_results
select 'setup-preview', api.preview_growth_plan_initialization_v1(
  'goal:d3a-first',
  (select response#>>'{goals,0,aggregateVersion}' from d3a_results where result_name = 'setup-source'),
  600, 30, 50, 'Start with the first target.', '48000000-0000-4000-8000-0000000000b1'
);
insert into d3a_results
select 'setup', api.apply_growth_plan_initialization_v1(
  'goal:d3a-first',
  (select response#>>'{goals,0,aggregateVersion}' from d3a_results where result_name = 'setup-source'),
  600, 30, 50, 'Start with the first target.', '48000000-0000-4000-8000-0000000000b1',
  (select response->>'previewDigest' from d3a_results where result_name = 'setup-preview')
);

insert into d3a_results values ('source', api.get_growth_plan_replacement_source_v1());
select is(
  (select response->>'state' from d3a_results where result_name = 'source'),
  'REPLACEMENT_AVAILABLE',
  'a workspace with one current Plan can replace it'
);
select is(
  (select response#>>'{capabilities,0}' from d3a_results where result_name = 'source'),
  'replace_growth_plan',
  'the replacement source exposes exactly the replacement capability'
);
select is(
  (select response#>>'{currentPlan,childTracks,total}' from d3a_results where result_name = 'source'),
  '1',
  'the replacement source counts the current Plan child Tracks'
);
select is(
  (select response#>>'{currentPlan,aggregateVersion}' from d3a_results where result_name = 'source'),
  '1',
  'the replacement source reports the exact current Plan version fence'
);

insert into d3a_results
select 'preview', api.preview_growth_plan_replacement_v1(
  'goal:d3a-second',
  (
    select goal->>'aggregateVersion'
    from d3a_results, pg_catalog.jsonb_array_elements(response->'goals') as goal
    where result_name = 'source' and goal->>'readinessGoalKey' = 'goal:d3a-second'
  ),
  (select response#>>'{currentPlan,aggregateVersion}' from d3a_results where result_name = 'source'),
  420, 45, 60, 'Switch my long-term direction.', '48000000-0000-4000-8000-0000000000c1'
);
select is(
  (select response->>'canApply' from d3a_results where result_name = 'preview'),
  'true',
  'a coherent replacement preview is applicable'
);
select is(
  (select response#>>'{before,growthPlan,lifecycle}' from d3a_results where result_name = 'preview'),
  'ACTIVE',
  'the preview reports the exact outgoing Plan lifecycle'
);
select is(
  (select response#>>'{after,archivedPlan,aggregateVersion}' from d3a_results where result_name = 'preview'),
  '2',
  'archiving advances the outgoing Plan version by exactly one'
);
select is(
  (select response#>>'{after,growthPlan,title}' from d3a_results where result_name = 'preview'),
  'D3a second target',
  'the incoming Plan takes the authoritative Goal title'
);
select is(
  (select response#>>'{after,learningTrack,cadencePerWeek}' from d3a_results where result_name = 'preview'),
  '0',
  'the incoming Track starts with no cadence target'
);
select is(
  (select response#>>'{after,lifetimePlanCount}' from d3a_results where result_name = 'preview'),
  '2',
  'replacement adds exactly one Plan to lifetime history'
);
select is(
  (select pg_catalog.jsonb_array_length(response->'warnings') from d3a_results where result_name = 'preview'),
  3,
  'a Plan with a current Track warns about archiving, retained Tracks, and the empty new Track'
);
select is(
  (select response#>>'{recalculationAfterApply,eventChangeKind}' from d3a_results where result_name = 'preview'),
  'PLAN_REPLACED',
  'the preview states the exact recalculation wake-up kind'
);

-- The production builder matches an independently framed digest field stream.
with fields as (
  select response as preview, array[
    'digestVersion','contractVersion','identityVersion','workspaceId','operation','commandType',
    'idempotencyKey','reason','expectedReadinessGoalVersion','expectedGrowthPlanVersion',
    'readinessGoalId','readinessGoalKey','readinessGoalTitle','readinessGoalLifecycle',
    'readinessGoalVersion','profileVersionId','profileVersionKey','sourceKind','sourceRef',
    'roadmapVersionId','sourceOwnerRevision','archivedGrowthPlanId','archivedGrowthPlanTitle',
    'archivedGrowthPlanLifecycleBefore','archivedGrowthPlanLifecycleAfter',
    'archivedGrowthPlanWeeklyCapacityMinutes','archivedGrowthPlanVersionBefore',
    'archivedGrowthPlanVersionAfter','childTrackCount','activeTrackCount','pausedTrackCount',
    'completedTrackCount','archivedTrackCount','childTrackFingerprint','lifetimePlanCountBefore',
    'lifetimePlanCountAfter','currentPlanCountBefore','currentPlanCountAfter','currentPlanLimit',
    'growthPlanId','growthPlanTitle','growthPlanLifecycle','growthPlanWeeklyCapacityMinutes',
    'growthPlanVersion','learningTrackId','trackKey','learningTrackTitle','learningTrackLifecycle',
    'learningTrackPriority','learningTrackProtectedMinimumMinutes','learningTrackCadencePerWeek',
    'learningTrackDefaultSessionMinutes','learningTrackVersion','canApply','blockingReasonCode',
    'warningCount','warningCode','warningCode','warningCode','retainedReadinessGoal',
    'retainedArchivedPlan','retainedLearningTrackHistory','retainedActivitiesAndEvidence',
    'retainedMastery','retainedReviews','retainedPlanSnapshots','projectionStateAfterApply',
    'eventChangeKind','consumerName'
  ]::text[] as names, array[
    response->>'digestVersion', response#>>'{contract,version}', response->>'identityVersion',
    (select pg_catalog.lower((r.response->>'workspace_id')) from d3a_results as r
     where r.result_name = 'bootstrap'),
    response->>'operation', response->>'commandType', response->>'idempotencyKey',
    response->>'reason', response->>'expectedReadinessGoalVersion',
    response->>'expectedGrowthPlanVersion', response#>>'{source,readinessGoalId}',
    response#>>'{source,readinessGoalKey}', response#>>'{source,readinessGoalTitle}',
    response#>>'{source,readinessGoalLifecycle}', response#>>'{source,readinessGoalVersion}',
    response#>>'{source,profileVersionId}', response#>>'{source,profileVersionKey}',
    response#>>'{source,sourceKind}', response#>>'{source,sourceRef}',
    coalesce(response#>>'{source,roadmapVersionId}', ''),
    response#>>'{source,sourceOwnerRevision}', response#>>'{before,growthPlan,growthPlanId}',
    response#>>'{before,growthPlan,title}', response#>>'{before,growthPlan,lifecycle}',
    'ARCHIVED', response#>>'{before,growthPlan,weeklyCapacityMinutes}',
    response#>>'{before,growthPlan,aggregateVersion}',
    response#>>'{after,archivedPlan,aggregateVersion}', response#>>'{before,childTracks,total}',
    response#>>'{before,childTracks,active}', response#>>'{before,childTracks,paused}',
    response#>>'{before,childTracks,completed}', response#>>'{before,childTracks,archived}',
    response#>>'{before,childTracks,fingerprint}', response#>>'{before,lifetimePlanCount}',
    response#>>'{after,lifetimePlanCount}', response#>>'{before,currentPlanCount}',
    response#>>'{after,currentPlanCount}', response#>>'{after,currentPlanLimit}',
    response#>>'{after,growthPlan,growthPlanId}', response#>>'{after,growthPlan,title}',
    response#>>'{after,growthPlan,lifecycle}',
    response#>>'{after,growthPlan,weeklyCapacityMinutes}',
    response#>>'{after,growthPlan,aggregateVersion}',
    response#>>'{after,learningTrack,learningTrackId}', response#>>'{after,learningTrack,trackKey}',
    response#>>'{after,learningTrack,title}', response#>>'{after,learningTrack,lifecycle}',
    response#>>'{after,learningTrack,priority}',
    response#>>'{after,learningTrack,protectedMinimumMinutes}',
    response#>>'{after,learningTrack,cadencePerWeek}',
    response#>>'{after,learningTrack,defaultSessionMinutes}',
    response#>>'{after,learningTrack,aggregateVersion}', response->>'canApply',
    coalesce(response#>>'{blockingReasons,0,code}', ''),
    pg_catalog.jsonb_array_length(response->'warnings')::text,
    response#>>'{warnings,0,code}', response#>>'{warnings,1,code}', response#>>'{warnings,2,code}',
    'true','true','true','true','true','true','true','PENDING','PLAN_REPLACED',
    'planning.plan_snapshot_v1'
  ]::text[] as values
  from d3a_results where result_name = 'preview'
), framed as (
  select preview, pg_catalog.string_agg(
    names[position] || ':' || pg_catalog.octet_length(
      pg_catalog.convert_to(coalesce(values[position], ''), 'UTF8')
    )::text || ':' || coalesce(values[position], '') || pg_catalog.chr(10),
    '' order by position
  ) as value
  from fields
  cross join lateral pg_catalog.generate_subscripts(names, 1) as position
  group by preview
)
select is(
  preview->>'previewDigest',
  pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(value, 'UTF8'), 'sha256'), 'hex'
  ),
  'the production replacement builder matches the independently framed digest stream'
)
from framed;

-- Stale, altered, and malformed confirmations fail closed before any state changes.
select throws_ok(
  pg_catalog.format(
    'select api.apply_growth_plan_replacement_v1(%L,%L,%L,%s,%s,%s,%L,%L,%L)',
    'goal:d3a-second',
    (select response->>'expectedReadinessGoalVersion' from d3a_results where result_name = 'preview'),
    '2', 420, 45, 60, 'Switch my long-term direction.',
    '48000000-0000-4000-8000-0000000000c2',
    (select response->>'previewDigest' from d3a_results where result_name = 'preview')
  ),
  '40001', 'Growth Plan version is stale',
  'a stale expected Plan version is refused'
);
select throws_ok(
  pg_catalog.format(
    'select api.apply_growth_plan_replacement_v1(%L,%L,%L,%s,%s,%s,%L,%L,%L)',
    'goal:d3a-second',
    '9', '1', 420, 45, 60, 'Switch my long-term direction.',
    '48000000-0000-4000-8000-0000000000c3',
    (select response->>'previewDigest' from d3a_results where result_name = 'preview')
  ),
  '40001', 'readiness goal source is stale',
  'a stale expected Goal version is refused'
);
select throws_ok(
  pg_catalog.format(
    'select api.apply_growth_plan_replacement_v1(%L,%L,%L,%s,%s,%s,%L,%L,%L)',
    'goal:d3a-second',
    (select response->>'expectedReadinessGoalVersion' from d3a_results where result_name = 'preview'),
    '1', 420, 45, 60, 'Switch my long-term direction.',
    '48000000-0000-4000-8000-0000000000c4', pg_catalog.repeat('0', 64)
  ),
  '40001', 'Growth Plan replacement preview is stale',
  'a changed preview digest is refused'
);
select throws_ok(
  pg_catalog.format(
    'select api.apply_growth_plan_replacement_v1(%L,%L,%L,%s,%s,%s,%L,%L,%L)',
    'goal:d3a-missing',
    (select response->>'expectedReadinessGoalVersion' from d3a_results where result_name = 'preview'),
    '1', 420, 45, 60, 'Switch my long-term direction.',
    '48000000-0000-4000-8000-0000000000c5',
    (select response->>'previewDigest' from d3a_results where result_name = 'preview')
  ),
  '42501', 'setup source is unavailable',
  'an unknown readiness goal is refused'
);
select throws_ok(
  pg_catalog.format(
    'select api.apply_growth_plan_replacement_v1(%L,%L,%L,%s,%s,%s,%L,%L,%L)',
    'goal:d3a-second',
    (select response->>'expectedReadinessGoalVersion' from d3a_results where result_name = 'preview'),
    '1', 10081, 45, 60, 'Switch my long-term direction.',
    '48000000-0000-4000-8000-0000000000c6',
    (select response->>'previewDigest' from d3a_results where result_name = 'preview')
  ),
  '22023', 'Growth Plan replacement request is invalid',
  'an out-of-range weekly capacity is refused'
);
select throws_ok(
  pg_catalog.format(
    'select api.apply_growth_plan_replacement_v1(%L,%L,%L,%s,%s,%s,%L,%L,%L)',
    'goal:d3a-second',
    (select response->>'expectedReadinessGoalVersion' from d3a_results where result_name = 'preview'),
    '1', 420, 45, 60, 'Switch my long-term direction.', 'not-a-uuid',
    (select response->>'previewDigest' from d3a_results where result_name = 'preview')
  ),
  '22023', 'Growth Plan replacement confirmation is invalid',
  'a non-UUID idempotency key is refused'
);

reset role;
create temporary table d3a_before as
select
  (select count(*)::bigint from planning.growth_plans where workspace_id = (select (r.response->>'workspace_id')::uuid from d3a_results as r where r.result_name = 'bootstrap')) as plan_count,
  (select count(*)::bigint from planning.learning_tracks where workspace_id = (select (r.response->>'workspace_id')::uuid from d3a_results as r where r.result_name = 'bootstrap')) as track_count,
  (select count(*)::bigint from outbox.events where workspace_id = (select (r.response->>'workspace_id')::uuid from d3a_results as r where r.result_name = 'bootstrap')) as event_count,
  (select count(*)::bigint from outbox.command_receipts
   where workspace_id = (select (r.response->>'workspace_id')::uuid from d3a_results as r where r.result_name = 'bootstrap')
     and command_type = 'planning.replace_growth_plan_v1') as receipt_count;
select ok(
  (select plan_count = 1 and track_count = 1 and receipt_count = 0 from d3a_before),
  'no refused replacement created a Plan, Track, or command receipt'
);
set local role authenticated;

insert into d3a_results
select 'apply', api.apply_growth_plan_replacement_v1(
  'goal:d3a-second',
  (select response->>'expectedReadinessGoalVersion' from d3a_results where result_name = 'preview'),
  '1', 420, 45, 60, 'Switch my long-term direction.',
  '48000000-0000-4000-8000-0000000000c1',
  (select response->>'previewDigest' from d3a_results where result_name = 'preview')
);
select is(
  (select response#>>'{archivedPlan,lifecycle}' from d3a_results where result_name = 'apply'),
  'ARCHIVED',
  'the applied result reports the archived Plan'
);
select is(
  (select response->>'projectionState' from d3a_results where result_name = 'apply'),
  'PENDING',
  'the applied result reports honest pending recalculation'
);

reset role;
select ok(
  (select count(*) = 1 from planning.growth_plans as plan
   where plan.workspace_id = (select (r.response->>'workspace_id')::uuid from d3a_results as r where r.result_name = 'bootstrap')
     and plan.lifecycle = 'archived' and plan.aggregate_version = 2)
  and (select count(*) = 1 from planning.growth_plans as plan
       where plan.workspace_id = (select (r.response->>'workspace_id')::uuid from d3a_results as r where r.result_name = 'bootstrap')
         and plan.lifecycle = 'active' and plan.aggregate_version = 1
         and plan.weekly_capacity_minutes = 420),
  'the outgoing Plan is archived at version two and exactly one current Plan remains'
);
select ok(
  (select count(*) = 2 from planning.learning_tracks where workspace_id = (select (r.response->>'workspace_id')::uuid from d3a_results as r where r.result_name = 'bootstrap'))
  and (select count(*) = 1 from planning.learning_tracks as track
       join planning.growth_plans as plan on plan.growth_plan_id = track.growth_plan_id
       where track.workspace_id = (select (r.response->>'workspace_id')::uuid from d3a_results as r where r.result_name = 'bootstrap')
         and plan.lifecycle = 'archived' and track.lifecycle = 'active'
         and track.aggregate_version = 1),
  'the archived Plan keeps its Track exactly as the person left it'
);
select ok(
  (select count(*) = 1 from planning.learning_tracks as track
   join planning.growth_plans as plan on plan.growth_plan_id = track.growth_plan_id
   where track.workspace_id = (select (r.response->>'workspace_id')::uuid from d3a_results as r where r.result_name = 'bootstrap')
     and plan.lifecycle = 'active' and track.priority = 60 and track.cadence_per_week = 0
     and track.protected_minimum_minutes = 0 and track.default_session_minutes = 45),
  'the incoming Plan owns exactly one new Track with the requested settings'
);
select ok(
  (select count(*) = 1 from planning.current_plan_snapshots
   where workspace_id = (select (r.response->>'workspace_id')::uuid from d3a_results as r where r.result_name = 'bootstrap') and pointer_version = 0 and snapshot_id is null),
  'replacement leaves the current-snapshot pointer untouched'
);
select ok(
  (select count(*) = 1 from outbox.events as event
   where event.workspace_id = (select (r.response->>'workspace_id')::uuid from d3a_results as r where r.result_name = 'bootstrap')
     and event.payload->>'change_kind' = 'PLAN_REPLACED'
     and event.aggregate_type = 'planning.growth_plan'
     and event.aggregate_version = 1
     and planning.plan_replaced_event_payload_v1_is_valid(event.payload))
  and (select count(*) = 1 from outbox.deliveries as delivery
       join outbox.events as event on event.event_id = delivery.event_id
       where event.workspace_id = (select (r.response->>'workspace_id')::uuid from d3a_results as r where r.result_name = 'bootstrap')
         and event.payload->>'change_kind' = 'PLAN_REPLACED'
         and delivery.consumer_name = 'planning.plan_snapshot_v1'),
  'replacement emits exactly one validated event and one fixed Planning delivery'
);
select ok(
  (select count(*) = 1 from outbox.command_receipts
   where workspace_id = (select (r.response->>'workspace_id')::uuid from d3a_results as r where r.result_name = 'bootstrap')
     and command_type = 'planning.replace_growth_plan_v1' and command_status = 'completed'
     and expected_aggregate_version = 1),
  'replacement records exactly one completed command receipt with its version fence'
);
set local role authenticated;

-- Replay and conflicting reuse of the same key.
insert into d3a_results
select 'replay', api.apply_growth_plan_replacement_v1(
  'goal:d3a-second',
  (select response->>'expectedReadinessGoalVersion' from d3a_results where result_name = 'preview'),
  '1', 420, 45, 60, 'Switch my long-term direction.',
  '48000000-0000-4000-8000-0000000000c1',
  (select response->>'previewDigest' from d3a_results where result_name = 'preview')
);
select is(
  (select response from d3a_results where result_name = 'replay'),
  (select response from d3a_results where result_name = 'apply'),
  'an identical replay returns the stored response'
);
select throws_ok(
  pg_catalog.format(
    'select api.apply_growth_plan_replacement_v1(%L,%L,%L,%s,%s,%s,%L,%L,%L)',
    'goal:d3a-second',
    (select response->>'expectedReadinessGoalVersion' from d3a_results where result_name = 'preview'),
    '1', 300, 45, 60, 'Switch my long-term direction.',
    '48000000-0000-4000-8000-0000000000c1',
    (select response->>'previewDigest' from d3a_results where result_name = 'preview')
  ),
  '22023', 'idempotency key reused with a different request',
  'the same key with a different request is refused'
);

reset role;
select ok(
  (select count(*) = 2 from planning.growth_plans where workspace_id = (select (r.response->>'workspace_id')::uuid from d3a_results as r where r.result_name = 'bootstrap'))
  and (select count(*) = 2 from planning.learning_tracks where workspace_id = (select (r.response->>'workspace_id')::uuid from d3a_results as r where r.result_name = 'bootstrap'))
  and (select count(*) = 1 from outbox.events
       where workspace_id = (select (r.response->>'workspace_id')::uuid from d3a_results as r where r.result_name = 'bootstrap') and payload->>'change_kind' = 'PLAN_REPLACED'),
  'replay and conflict leave exactly one replacement effect'
);
set local role authenticated;

-- After replacement the released setup source is legitimate history, not corruption.
insert into d3a_results values ('setup-after', api.get_growth_plan_setup_source_v1());
select is(
  (select response->>'state' from d3a_results where result_name = 'setup-after'),
  'CURRENT_PLAN_EXISTS',
  'the first-setup source treats replacement history as a current Plan, not corruption'
);
insert into d3a_results values ('source-after', api.get_growth_plan_replacement_source_v1());
select is(
  (select response#>>'{currentPlan,aggregateVersion}' from d3a_results where result_name = 'source-after'),
  '1',
  'the replacement source now fences the incoming Plan version'
);
select is(
  (select response#>>'{currentPlan,childTracks,total}' from d3a_results where result_name = 'source-after'),
  '1',
  'the replacement source counts only the incoming Plan Tracks'
);

-- A paused current Plan can be replaced.
insert into d3a_results
select 'pause-preview', api.preview_growth_plan_lifecycle_v1(
  'pause_growth_plan', '1', 'Pause before replacing again.'
);
insert into d3a_results
select 'pause', api.apply_growth_plan_lifecycle_v1(
  'pause_growth_plan', '1',
  (select response->>'previewDigest' from d3a_results where result_name = 'pause-preview'),
  'Pause before replacing again.', '48000000-0000-4000-8000-0000000000d1'
);
insert into d3a_results values ('paused-source', api.get_growth_plan_replacement_source_v1());
select is(
  (select response#>>'{currentPlan,lifecycle}' from d3a_results where result_name = 'paused-source'),
  'PAUSED',
  'a paused current Plan remains replaceable'
);
insert into d3a_results
select 'paused-preview', api.preview_growth_plan_replacement_v1(
  'goal:d3a-first',
  (
    select goal->>'aggregateVersion'
    from d3a_results, pg_catalog.jsonb_array_elements(response->'goals') as goal
    where result_name = 'paused-source' and goal->>'readinessGoalKey' = 'goal:d3a-first'
  ),
  '2', 300, 30, 40, 'Return to the first target.', '48000000-0000-4000-8000-0000000000d2'
);
select is(
  (select response#>>'{before,growthPlan,lifecycle}' from d3a_results where result_name = 'paused-preview'),
  'PAUSED',
  'the paused replacement preview reports the exact paused lifecycle'
);
insert into d3a_results
select 'paused-apply', api.apply_growth_plan_replacement_v1(
  'goal:d3a-first',
  (select response->>'expectedReadinessGoalVersion' from d3a_results where result_name = 'paused-preview'),
  '2', 300, 30, 40, 'Return to the first target.', '48000000-0000-4000-8000-0000000000d2',
  (select response->>'previewDigest' from d3a_results where result_name = 'paused-preview')
);
select is(
  (select response#>>'{createdPlan,lifecycle}' from d3a_results where result_name = 'paused-apply'),
  'ACTIVE',
  'replacing a paused Plan produces an active incoming Plan'
);

reset role;
select ok(
  (select count(*) = 3 from planning.growth_plans where workspace_id = (select (r.response->>'workspace_id')::uuid from d3a_results as r where r.result_name = 'bootstrap'))
  and (select count(*) = 2 from planning.growth_plans
       where workspace_id = (select (r.response->>'workspace_id')::uuid from d3a_results as r where r.result_name = 'bootstrap') and lifecycle = 'archived')
  and (select count(*) = 1 from planning.growth_plans
       where workspace_id = (select (r.response->>'workspace_id')::uuid from d3a_results as r where r.result_name = 'bootstrap') and lifecycle in ('active', 'paused')),
  'every replacement keeps exactly one current Plan and retains all archived history'
);
set local role authenticated;

-- Cross-workspace isolation.
select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '48000000-0000-4000-8000-000000000002',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from pg_catalog.clock_timestamp() + interval '1 hour')::bigint
  )::text,
  true
);
set local role authenticated;
insert into d3a_results values (
  'bob-bootstrap', api.bootstrap_personal_workspace('d3a-bob', 'D3a Bob')
);
insert into d3a_results values ('bob-source', api.get_growth_plan_replacement_source_v1());
select is(
  (select response->>'state' from d3a_results where result_name = 'bob-source'),
  'NO_CURRENT_PLAN',
  'a second workspace sees no Plan from the first workspace'
);
select throws_ok(
  pg_catalog.format(
    'select api.apply_growth_plan_replacement_v1(%L,%L,%L,%s,%s,%s,%L,%L,%L)',
    'goal:d3a-second',
    (select response->>'expectedReadinessGoalVersion' from d3a_results where result_name = 'preview'),
    '1', 420, 45, 60, 'Cross-workspace attempt.',
    '48000000-0000-4000-8000-0000000000e1',
    (select response->>'previewDigest' from d3a_results where result_name = 'preview')
  ),
  '42501', 'Growth Plan is unavailable',
  'another workspace cannot replace the first workspace Plan with its exact preview'
);

reset role;
select ok(
  (select count(*) = 3 from planning.growth_plans where workspace_id = (select (r.response->>'workspace_id')::uuid from d3a_results as r where r.result_name = 'bootstrap'))
  and (select count(*) = 1 from outbox.command_receipts
       where workspace_id = (select (r.response->>'workspace_id')::uuid from d3a_results as r where r.result_name = 'bootstrap')
         and command_type = 'planning.replace_growth_plan_v1' and command_status = 'completed'
         and idempotency_key = '48000000-0000-4000-8000-0000000000c1'),
  'the cross-workspace attempt changed no Plan and created no receipt'
);

select finish();
rollback;
