begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

select ok(
  pg_catalog.has_function_privilege(
    'authenticated', 'api.get_current_learning_tracks_v1()', 'EXECUTE'
  )
  and pg_catalog.has_function_privilege(
    'authenticated',
    'api.preview_learning_track_lifecycle_v1(text,text,text,text,text)', 'EXECUTE'
  )
  and pg_catalog.has_function_privilege(
    'authenticated',
    'api.apply_learning_track_lifecycle_v1(text,text,text,text,text,text,text)', 'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'anon', 'api.get_current_learning_tracks_v1()', 'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'anon', 'api.preview_learning_track_lifecycle_v1(text,text,text,text,text)', 'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'anon', 'api.apply_learning_track_lifecycle_v1(text,text,text,text,text,text,text)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'service_role', 'api.get_current_learning_tracks_v1()', 'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'service_role',
    'api.preview_learning_track_lifecycle_v1(text,text,text,text,text)', 'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'service_role',
    'api.apply_learning_track_lifecycle_v1(text,text,text,text,text,text,text)', 'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated',
    'planning.projected_active_track_capacity_constraint_v1(uuid,uuid,uuid,text,bigint)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated',
    'planning.build_learning_track_lifecycle_preview_v1(uuid,uuid,text,integer,bigint,uuid,text,text,text,integer,integer,bigint,text,bigint,bigint,text)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated',
    'planning.track_lifecycle_event_payload_v1_is_valid(jsonb)', 'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'service_role',
    'planning.build_learning_track_lifecycle_preview_v1(uuid,uuid,text,integer,bigint,uuid,text,text,text,integer,integer,bigint,text,bigint,bigint,text)',
    'EXECUTE'
  ),
  'Track lifecycle exposes only the three actor-scoped authenticated APIs'
);

select ok(
  count(*) = 3
    and bool_and(
      procedure.prosecdef =
        (procedure.proname <> 'track_lifecycle_event_payload_v1_is_valid')
    )
    and bool_and('search_path=""' = any(coalesce(procedure.proconfig, '{}'::text[])))
    and bool_and(owner.rolname = 'pando_planning_api')
    and bool_and(not owner.rolcanlogin and not owner.rolinherit and not owner.rolbypassrls),
  'Track lifecycle APIs are pinned definers owned by the bounded Planning role'
)
from pg_catalog.pg_proc as procedure
join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
join pg_catalog.pg_roles as owner on owner.oid = procedure.proowner
where namespace.nspname = 'api'
  and procedure.proname in (
    'get_current_learning_tracks_v1',
    'preview_learning_track_lifecycle_v1',
    'apply_learning_track_lifecycle_v1'
  );

select ok(
  count(*) = 3
    and bool_and(procedure.prosecdef)
    and bool_and('search_path=""' = any(coalesce(procedure.proconfig, '{}'::text[])))
    and bool_and(owner.rolname = 'pando_planning_api'),
  'Track lifecycle private helpers have exact definer modes and the bounded Planning owner'
)
from pg_catalog.pg_proc as procedure
join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
join pg_catalog.pg_roles as owner on owner.oid = procedure.proowner
where namespace.nspname = 'planning'
  and procedure.proname in (
    'projected_active_track_capacity_constraint_v1',
    'build_learning_track_lifecycle_preview_v1',
    'track_lifecycle_event_payload_v1_is_valid'
  );

select is(
  (
    select (
      (
        pg_catalog.length(pg_catalog.lower(pg_catalog.pg_get_functiondef(procedure.oid)))
        - pg_catalog.length(pg_catalog.replace(
          pg_catalog.lower(pg_catalog.pg_get_functiondef(procedure.oid)),
          'get diagnostics v_affected_rows = row_count', ''
        ))
      ) / pg_catalog.length('get diagnostics v_affected_rows = row_count')
    )::bigint
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'api'
      and procedure.proname = 'apply_learning_track_lifecycle_v1'
      and procedure.pronargs = 7
  ),
  2::bigint,
  'Track apply requires exactly one Track update and one receipt completion'
);

select ok(
  pg_catalog.strpos(
    definition,
    'v_actor_user_id::text || '':planning.change_learning_track_lifecycle:'''
  )
    < pg_catalog.strpos(definition, '''planning-workspace:'' || v_workspace_id::text')
  and pg_catalog.strpos(definition, '''planning-workspace:'' || v_workspace_id::text')
    < pg_catalog.strpos(definition, 'select plan.* into v_plan')
  and pg_catalog.strpos(definition, 'select plan.* into v_plan')
    < pg_catalog.strpos(definition, 'perform track.learning_track_id')
  and pg_catalog.strpos(definition, 'perform track.learning_track_id')
    < pg_catalog.strpos(definition, 'select track.* into v_track')
  and pg_catalog.strpos(definition, 'order by track.learning_track_id') > 0,
  'Track apply pins actor/key, workspace, Plan, all UUID-ordered children, then target'
)
from (
  select pg_catalog.lower(pg_catalog.pg_get_functiondef(procedure.oid)) as definition
  from pg_catalog.pg_proc as procedure
  join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'api'
    and procedure.proname = 'apply_learning_track_lifecycle_v1'
    and procedure.pronargs = 7
) as source;

select ok(
  pg_catalog.has_column_privilege(
    'pando_planning_api', 'planning.learning_tracks', 'lifecycle', 'UPDATE'
  )
  and pg_catalog.has_column_privilege(
    'pando_planning_api', 'planning.learning_tracks', 'aggregate_version', 'UPDATE'
  )
  and pg_catalog.has_column_privilege(
    'pando_planning_api', 'planning.learning_tracks', 'updated_at', 'UPDATE'
  )
  and not pg_catalog.has_column_privilege(
    'pando_planning_api', 'planning.learning_tracks', 'protected_minimum_minutes', 'UPDATE'
  )
  and not pg_catalog.has_column_privilege(
    'pando_planning_api', 'planning.learning_tracks', 'priority', 'UPDATE'
  )
  and not pg_catalog.has_table_privilege(
    'authenticated', 'planning.learning_tracks', 'SELECT'
  ),
  'Planning has only lifecycle/version/timestamp Track updates and browser roles have no table read'
);

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    'd5000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
    'track-alice@pando.test', '', clock_timestamp(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    clock_timestamp(), clock_timestamp()
  ),
  (
    'd5000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
    'track-bob@pando.test', '', clock_timestamp(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    clock_timestamp(), clock_timestamp()
  );

create temporary table track_results (
  result_name text primary key,
  response jsonb not null
);
grant select, insert on track_results to authenticated;
grant select, insert on track_results to pando_planning_api;

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', 'd5000000-0000-4000-8000-000000000002',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text,
  true
);
set local role authenticated;
insert into track_results values (
  'bob-bootstrap', api.bootstrap_personal_workspace('phase4b-track-bob', 'Track Bob')
);
insert into track_results values ('bob-empty', api.get_current_learning_tracks_v1());
reset role;

select ok(
  (select response#>>'{contract,name}' = 'CurrentLearningTracksV1'
     and response->'growthPlan' = 'null'::jsonb
     and response->'learningTracks' = '[]'::jsonb
   from track_results where result_name = 'bob-empty'),
  'a provisioned actor without a current Plan receives the explicit empty onboarding shape'
);

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', 'd5000000-0000-4000-8000-000000000001',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text,
  true
);
set local role authenticated;
insert into track_results values (
  'alice-bootstrap', api.bootstrap_personal_workspace('phase4b-track-alice', 'Track Alice')
);
insert into track_results
select 'alice-goal', api.create_readiness_goal(
  (select (response->>'workspace_id')::uuid from track_results where result_name = 'alice-bootstrap'),
  'goal:track-alice', 'Track Alice goal',
  'target:nvidia-python-verification-base-v1', 'phase4b-track-alice-goal'
);
insert into track_results values (
  'alice-plan', api.initialize_growth_plan_v1(
    'goal:track-alice', 600, 45, 80, 120, 'phase4b-track-alice-plan'
  )
);
reset role;

insert into planning.learning_tracks (
  learning_track_id, workspace_id, growth_plan_id, track_key, title,
  readiness_goal_id, profile_version_id, roadmap_version_id, lifecycle,
  priority, protected_minimum_minutes, default_session_minutes, aggregate_version
)
select
  fixture.learning_track_id, source.workspace_id, source.growth_plan_id,
  fixture.track_key, fixture.title, source.readiness_goal_id,
  source.profile_version_id, source.roadmap_version_id, fixture.lifecycle,
  fixture.priority, fixture.protected_minimum_minutes,
  source.default_session_minutes, 1
from planning.learning_tracks as source
cross join (
  values
    ('d5100000-0000-4000-8000-000000000001'::uuid,
      'track:track-active-second', 'Active second', 'active', 90, 80),
    ('d5100000-0000-4000-8000-000000000002'::uuid,
      'track:track-paused-exact', 'Paused exact', 'paused', 70, 400),
    ('d5100000-0000-4000-8000-000000000003'::uuid,
      'track:track-paused-blocked', 'Paused blocked', 'paused', 60, 401),
    ('d5100000-0000-4000-8000-000000000004'::uuid,
      'track:track-completed', 'Completed', 'completed', 100, 500),
    ('d5100000-0000-4000-8000-000000000005'::uuid,
      'track:track-archived', 'Archived', 'archived', 100, 600)
) as fixture(
  learning_track_id, track_key, title, lifecycle, priority, protected_minimum_minutes
)
where source.growth_plan_id = (
  select (response->>'growthPlanId')::uuid from track_results where result_name = 'alice-plan'
)
  and source.track_key = (
    select response->>'learningTrackKey' from track_results where result_name = 'alice-plan'
  );

set local role authenticated;
insert into track_results values ('alice-current', api.get_current_learning_tracks_v1());
insert into track_results
select 'alice-pause-preview', api.preview_learning_track_lifecycle_v1(
  response->>'learningTrackKey', 'pause_track', '1', '1', 'Pause — exact preview.'
)
from track_results where result_name = 'alice-plan';
insert into track_results values (
  'alice-exact-preview', api.preview_learning_track_lifecycle_v1(
    'track:track-paused-exact', 'resume_track', '1', '1', 'Resume at exact capacity.'
  )
);
insert into track_results values (
  'alice-blocked-preview', api.preview_learning_track_lifecycle_v1(
    'track:track-paused-blocked', 'resume_track', '1', '1', 'Resume above capacity.'
  )
);
reset role;

select ok(
  (select response#>>'{growthPlan,weeklyCapacityMinutes}' = '600'
     and pg_catalog.jsonb_array_length(response->'learningTracks') = 4
     and response#>>'{learningTracks,0,title}' = 'Active second'
     and response#>>'{learningTracks,1,title}' = 'Backend readiness'
     and response#>>'{learningTracks,2,title}' = 'Paused exact'
     and response#>>'{learningTracks,3,title}' = 'Paused blocked'
   from track_results where result_name = 'alice-current'),
  'current read is actor-scoped, terminal-free, and ordered by priority then key and UUID'
);

select ok(
  (select response#>>'{before,lifecycle}' = 'ACTIVE'
     and response#>>'{after,lifecycle}' = 'PAUSED'
     and response#>>'{before,aggregateVersion}' = '1'
     and response#>>'{after,aggregateVersion}' = '2'
     and response#>>'{constraint,activeTrackCountBefore}' = '2'
     and response#>>'{constraint,activeTrackCountAfter}' = '1'
     and response#>>'{constraint,activeProtectedMinimumMinutesBefore}' = '200'
     and response#>>'{constraint,activeProtectedMinimumMinutesAfter}' = '80'
     and response->>'canApply' = 'true'
     and response->'blockingReasons' = '[]'::jsonb
     and response->'warnings' = '[]'::jsonb
     and response->'retained' = pg_catalog.jsonb_build_object(
       'learningTrackActivities', true,
       'planSnapshots', true,
       'focusSessions', true,
       'evidence', true
     )
     and response->'recalculationAfterApply' = pg_catalog.jsonb_build_object(
       'projectionState', 'PENDING',
       'consumerName', 'planning.plan_snapshot_v1'
     )
     and response#>>'{constraint,activeTrackFingerprintBefore}'
       <> response#>>'{constraint,activeTrackFingerprintAfter}'
   from track_results where result_name = 'alice-pause-preview'),
  'pause preview binds exact Track versions, retained facts, and D2a-format constraint states'
);

select is(
  (
    with digest_source as (
      select preview.response as preview, plan.response as plan
      from track_results as preview
      cross join track_results as plan
      where preview.result_name = 'alice-pause-preview'
        and plan.result_name = 'alice-plan'
    ), digest_input as (
      select pg_catalog.string_agg(
        field_name || ':'
          || pg_catalog.octet_length(pg_catalog.convert_to(field_value, 'UTF8'))::text
          || ':' || field_value || pg_catalog.chr(10),
        '' order by field_position
      ) as value
      from digest_source
      cross join lateral (
        values
          (1, 'digestVersion', 'learning-track-lifecycle-preview-digest/1.0.0'),
          (2, 'contractVersion', '1.0.0'),
          (3, 'fingerprintVersion', 'active-track-constraint-fingerprint/1.0.0'),
          (4, 'workspaceId', pg_catalog.lower(plan->>'workspaceId')),
          (5, 'operation', preview->>'operation'),
          (6, 'reason', preview->>'reason'),
          (7, 'expectedGrowthPlanVersion', preview->>'expectedGrowthPlanVersion'),
          (8, 'expectedLearningTrackVersion', preview->>'expectedLearningTrackVersion'),
          (9, 'growthPlanId', pg_catalog.lower(preview#>>'{growthPlan,growthPlanId}')),
          (10, 'growthPlanLifecycle', preview#>>'{growthPlan,lifecycle}'),
          (11, 'growthPlanWeeklyCapacityMinutes',
            preview#>>'{growthPlan,weeklyCapacityMinutes}'),
          (12, 'growthPlanAggregateVersion', preview#>>'{growthPlan,aggregateVersion}'),
          (13, 'beforeLearningTrackId', pg_catalog.lower(preview#>>'{before,learningTrackId}')),
          (14, 'beforeTrackKey', preview#>>'{before,trackKey}'),
          (15, 'beforeTitle', preview#>>'{before,title}'),
          (16, 'beforeLifecycle', preview#>>'{before,lifecycle}'),
          (17, 'beforePriority', preview#>>'{before,priority}'),
          (18, 'beforeProtectedMinimumMinutes', preview#>>'{before,protectedMinimumMinutes}'),
          (19, 'beforeAggregateVersion', preview#>>'{before,aggregateVersion}'),
          (20, 'afterLearningTrackId', pg_catalog.lower(preview#>>'{after,learningTrackId}')),
          (21, 'afterTrackKey', preview#>>'{after,trackKey}'),
          (22, 'afterTitle', preview#>>'{after,title}'),
          (23, 'afterLifecycle', preview#>>'{after,lifecycle}'),
          (24, 'afterPriority', preview#>>'{after,priority}'),
          (25, 'afterProtectedMinimumMinutes', preview#>>'{after,protectedMinimumMinutes}'),
          (26, 'afterAggregateVersion', preview#>>'{after,aggregateVersion}'),
          (27, 'activeTrackCountBefore', preview#>>'{constraint,activeTrackCountBefore}'),
          (28, 'activeTrackCountAfter', preview#>>'{constraint,activeTrackCountAfter}'),
          (29, 'activeProtectedMinimumMinutesBefore',
            preview#>>'{constraint,activeProtectedMinimumMinutesBefore}'),
          (30, 'activeProtectedMinimumMinutesAfter',
            preview#>>'{constraint,activeProtectedMinimumMinutesAfter}'),
          (31, 'flexibleMinutesBefore', preview#>>'{constraint,flexibleMinutesBefore}'),
          (32, 'flexibleMinutesAfter', preview#>>'{constraint,flexibleMinutesAfter}'),
          (33, 'activeTrackFingerprintBefore',
            preview#>>'{constraint,activeTrackFingerprintBefore}'),
          (34, 'activeTrackFingerprintAfter',
            preview#>>'{constraint,activeTrackFingerprintAfter}'),
          (35, 'canApply', preview->>'canApply'),
          (36, 'blockingReasonCode', ''),
          (37, 'blockingMinimumCapacityMinutes', ''),
          (38, 'warningCode', ''),
          (39, 'retainedLearningTrackActivities', 'true'),
          (40, 'retainedPlanSnapshots', 'true'),
          (41, 'retainedFocusSessions', 'true'),
          (42, 'retainedEvidence', 'true'),
          (43, 'projectionStateAfterApply', 'PENDING'),
          (44, 'consumerName', 'planning.plan_snapshot_v1')
      ) as field(field_position, field_name, field_value)
    )
    select pg_catalog.encode(
      extensions.digest(pg_catalog.convert_to(value, 'UTF8'), 'sha256'), 'hex'
    )
    from digest_input
  ),
  (select response->>'previewDigest'
   from track_results where result_name = 'alice-pause-preview'),
  'preview digest agrees with the independent length-prefixed UTF-8 oracle'
);

select ok(
  (select response#>>'{constraint,activeProtectedMinimumMinutesAfter}' = '600'
     and response#>>'{constraint,flexibleMinutesAfter}' = '0'
     and response->>'canApply' = 'true'
   from track_results where result_name = 'alice-exact-preview'),
  'resume at the exact protected-capacity boundary is applicable'
);

select ok(
  (select response->>'canApply' = 'false'
     and response->'blockingReasons' =
       '[{"code":"ACTIVE_TRACK_MINIMUM_EXCEEDS_CAPACITY","minimumCapacityMinutes":601}]'::jsonb
   from track_results where result_name = 'alice-blocked-preview'),
  'resume above capacity returns the exact typed blocker'
);

select is(
  (select count(*)::bigint from outbox.command_receipts
   where command_type = 'planning.change_learning_track_lifecycle'),
  0::bigint,
  'all Track previews are side-effect free'
);

savepoint paused_parent_apply;
update planning.growth_plans
set lifecycle = 'paused'
where growth_plan_id = (
  select (response->>'growthPlanId')::uuid from track_results where result_name = 'alice-plan'
);
set local role authenticated;
insert into track_results values (
  'alice-parent-paused', api.preview_learning_track_lifecycle_v1(
    'track:track-paused-exact', 'resume_track', '1', '1',
    'Resume under paused parent.'
  )
);
insert into track_results
select 'alice-parent-paused-apply', api.apply_learning_track_lifecycle_v1(
  'track:track-paused-exact', 'resume_track', '1', '1',
  response->>'previewDigest', 'Resume under paused parent.',
  'phase4b-track-parent-paused-resume'
)
from track_results where result_name = 'alice-parent-paused';
reset role;
select is(
  (select response->'warnings' from track_results where result_name = 'alice-parent-paused'),
  '[{"code":"PARENT_GROWTH_PLAN_PAUSED"}]'::jsonb,
  'a paused parent produces exactly the accepted deterministic warning'
);
select ok(
  (select response#>>'{changedTrack,lifecycle}' = 'ACTIVE'
     and response#>>'{changedTrack,aggregateVersion}' = '2'
   from track_results where result_name = 'alice-parent-paused-apply')
  and (select lifecycle = 'paused'
       from planning.growth_plans
       where growth_plan_id = (
         select (response->>'growthPlanId')::uuid
         from track_results where result_name = 'alice-plan'
       )),
  'resume persists under a paused parent without changing the parent lifecycle'
);
rollback to savepoint paused_parent_apply;

savepoint active_limit_fixture;
insert into planning.learning_tracks (
  learning_track_id, workspace_id, growth_plan_id, track_key, title,
  readiness_goal_id, profile_version_id, roadmap_version_id, lifecycle,
  priority, protected_minimum_minutes, default_session_minutes, aggregate_version
)
select
  ('d52' || pg_catalog.lpad(series.value::text, 29, '0'))::uuid,
  source.workspace_id, source.growth_plan_id,
  'track:active-limit-' || pg_catalog.lpad(series.value::text, 2, '0'),
  'Active limit ' || series.value::text,
  source.readiness_goal_id, source.profile_version_id, source.roadmap_version_id,
  'active', 1, 0, source.default_session_minutes, 1
from planning.learning_tracks as source
cross join pg_catalog.generate_series(1, 28) as series(value)
where source.track_key = (
  select response->>'learningTrackKey' from track_results where result_name = 'alice-plan'
);
set local role authenticated;
select throws_ok(
  $$select api.preview_learning_track_lifecycle_v1(
    'track:track-paused-exact', 'resume_track', '1', '1', 'Do not create active Track 31.'
  )$$,
  '55000', 'Learning Track portfolio limit is exceeded',
  'preview fails closed when persisted active-or-paused Track state exceeds the compact boundary'
);
select throws_ok(
  $$select api.get_current_learning_tracks_v1()$$,
  '55000', 'Learning Track portfolio limit is exceeded',
  'the compact current read fails closed rather than truncating excess non-terminal Tracks'
);
reset role;
rollback to savepoint active_limit_fixture;

savepoint maximum_resume_minimum;
update planning.growth_plans
set weekly_capacity_minutes = 10080
where growth_plan_id = (
  select (response->>'growthPlanId')::uuid
  from track_results where result_name = 'alice-plan'
);
update planning.learning_tracks
set protected_minimum_minutes = case
  when track_key = (
    select response->>'learningTrackKey'
    from track_results where result_name = 'alice-plan'
  ) then 10080
  when track_key = 'track:track-active-second' then 0
  when track_key = 'track:track-paused-blocked' then 10080
  else protected_minimum_minutes
end
where growth_plan_id = (
  select (response->>'growthPlanId')::uuid
  from track_results where result_name = 'alice-plan'
);
set local role authenticated;
insert into track_results values (
  'alice-maximum-minimum-blocked', api.preview_learning_track_lifecycle_v1(
    'track:track-paused-blocked', 'resume_track', '1', '1',
    'Prove the maximum projected minimum.'
  )
);
reset role;
select ok(
  (select response#>>'{constraint,activeProtectedMinimumMinutesBefore}' = '10080'
     and response#>>'{constraint,activeProtectedMinimumMinutesAfter}' = '20160'
     and response#>>'{constraint,flexibleMinutesAfter}' = '-10080'
     and response->'blockingReasons' =
       '[{"code":"ACTIVE_TRACK_MINIMUM_EXCEEDS_CAPACITY","minimumCapacityMinutes":20160}]'::jsonb
   from track_results where result_name = 'alice-maximum-minimum-blocked'),
  'resume blocker preserves the full 20160-minute projected boundary without clamping'
);
rollback to savepoint maximum_resume_minimum;

select is(
  planning.track_lifecycle_event_payload_v1_is_valid(
    pg_catalog.jsonb_build_object(
      'change_kind', 'TRACK_LIFECYCLE_CHANGED',
      'growth_plan_id', 'd5000000-0000-4000-8000-000000000010',
      'learning_track_id', 'd5000000-0000-4000-8000-000000000011',
      'learning_track_version', '9223372036854775808',
      'lifecycle', 'ACTIVE'
    )
  ),
  false,
  'Track lifecycle event SQL validation rejects versions above bigint'
);

create temporary table track_before_apply as
select
  plan.aggregate_version as plan_version,
  target.learning_track_id,
  target.aggregate_version as target_version,
  sibling.learning_track_id as sibling_id,
  sibling.aggregate_version as sibling_version,
  (select count(*)::bigint from planning.plan_snapshots where workspace_id = plan.workspace_id)
    as snapshot_count
from planning.growth_plans as plan
join planning.learning_tracks as target
  on target.workspace_id = plan.workspace_id and target.growth_plan_id = plan.growth_plan_id
join planning.learning_tracks as sibling
  on sibling.workspace_id = plan.workspace_id and sibling.growth_plan_id = plan.growth_plan_id
where plan.growth_plan_id = (
  select (response->>'growthPlanId')::uuid from track_results where result_name = 'alice-plan'
)
  and target.track_key = (
    select response->>'learningTrackKey' from track_results where result_name = 'alice-plan'
  )
  and sibling.track_key = 'track:track-active-second';

set local role authenticated;
insert into track_results
select 'alice-pause-apply', api.apply_learning_track_lifecycle_v1(
  plan.response->>'learningTrackKey', 'pause_track', '1', '1',
  preview.response->>'previewDigest', 'Pause — exact preview.', 'phase4b-track-pause'
)
from track_results as plan
join track_results as preview on preview.result_name = 'alice-pause-preview'
where plan.result_name = 'alice-plan';
insert into track_results
select 'alice-pause-replay', api.apply_learning_track_lifecycle_v1(
  plan.response->>'learningTrackKey', 'pause_track', '1', '1',
  preview.response->>'previewDigest', 'Pause — exact preview.', 'phase4b-track-pause'
)
from track_results as plan
join track_results as preview on preview.result_name = 'alice-pause-preview'
where plan.result_name = 'alice-plan';
reset role;

select is(
  (select response from track_results where result_name = 'alice-pause-replay'),
  (select response from track_results where result_name = 'alice-pause-apply'),
  'completed Track lifecycle command replays its byte-identical response'
);

select ok(
  (select target.lifecycle = 'paused'
     and target.aggregate_version = before_state.target_version + 1
     and plan.aggregate_version = before_state.plan_version
     and sibling.aggregate_version = before_state.sibling_version
     and (select count(*)::bigint from planning.plan_snapshots
          where workspace_id = plan.workspace_id) = before_state.snapshot_count
   from track_before_apply as before_state
   join planning.learning_tracks as target
     on target.learning_track_id = before_state.learning_track_id
   join planning.learning_tracks as sibling
     on sibling.learning_track_id = before_state.sibling_id
   join planning.growth_plans as plan on plan.growth_plan_id = target.growth_plan_id),
  'apply changes only the target Track lifecycle/version and preserves Plan, sibling, and history'
);

select is(
  (
    select count(*)::bigint
    from outbox.events as event
    join track_results as applied on applied.result_name = 'alice-pause-apply'
      and event.event_id = (applied.response->'emittedEventIds'->>0)::uuid
    where event.event_name = 'planning.input_changed'
      and event.event_schema_version = 1
      and event.aggregate_type = 'planning.learning_track'
      and event.aggregate_version = 2
      and event.payload = pg_catalog.jsonb_build_object(
        'change_kind', 'TRACK_LIFECYCLE_CHANGED',
        'growth_plan_id', (select (response->>'growthPlanId')::uuid
          from track_results where result_name = 'alice-plan'),
        'learning_track_id', event.aggregate_id,
        'learning_track_version', '2',
        'lifecycle', 'PAUSED'
      )
  ),
  1::bigint,
  'apply emits one exact privacy-minimized Track lifecycle event'
);

select is(
  (
    select count(*)::bigint
    from outbox.deliveries as delivery
    join track_results as applied on applied.result_name = 'alice-pause-apply'
      and delivery.delivery_id = (applied.response->>'planningDeliveryId')::uuid
    where delivery.event_id = (applied.response->'emittedEventIds'->>0)::uuid
      and delivery.consumer_name = 'planning.plan_snapshot_v1'
      and delivery.handler_contract_version = 1
      and delivery.delivery_state = 'pending'
  ),
  1::bigint,
  'apply creates exactly one fixed pending Planning delivery'
);

select ok(
  (
    select count(*) = 1
    from outbox.command_receipts as receipt
    join track_results as applied on applied.result_name = 'alice-pause-apply'
      and receipt.command_id = (applied.response->>'commandId')::uuid
    where receipt.command_type = 'planning.change_learning_track_lifecycle'
      and receipt.command_status = 'completed'
      and receipt.emitted_event_ids = array[
        (applied.response->'emittedEventIds'->>0)::uuid
      ]
  )
  and (
    select count(*) = 1
    from outbox.events as event
    join track_results as applied on applied.result_name = 'alice-pause-apply'
      and event.command_id = (applied.response->>'commandId')::uuid
  )
  and (
    select count(*) = 1
    from outbox.deliveries as delivery
    join outbox.events as event on event.event_id = delivery.event_id
    join track_results as applied on applied.result_name = 'alice-pause-apply'
      and event.command_id = (applied.response->>'commandId')::uuid
  ),
  'one completed receipt atomically owns exactly one event and exactly one delivery'
);

set local role authenticated;
select throws_ok(
  $$select api.preview_learning_track_lifecycle_v1(
    'track:missing', 'pause_track', '1', '1', 'Missing Track.'
  )$$,
  '42501', 'Learning Track is unavailable',
  'missing Track selector is non-enumerating'
);
select throws_ok(
  $$select api.preview_learning_track_lifecycle_v1(
    'bad-key', 'pause_track', '1', '1', 'Malformed Track.'
  )$$,
  '42501', 'Learning Track is unavailable',
  'malformed Track selector uses the same unavailable shape'
);
select throws_ok(
  $$select api.preview_learning_track_lifecycle_v1(
    'track:track-completed', 'resume_track', '1', '1', 'Terminal Track.'
  )$$,
  '42501', 'Learning Track is unavailable',
  'terminal Track selector is non-enumerating'
);
select throws_ok(
  $$select api.preview_learning_track_lifecycle_v1(
    'track:track-paused-exact', 'pause_track', '1', '1', 'No-op Track.'
  )$$,
  '22023', 'Learning Track lifecycle transition is invalid',
  'a new-key no-op transition is invalid'
);
select throws_ok(
  $$select api.preview_learning_track_lifecycle_v1(
    'track:track-paused-exact', 'resume_track', '9223372036854775808', '1',
    'Overflow Plan version.'
  )$$,
  '22023', 'Learning Track lifecycle request is invalid',
  'expected versions above PostgreSQL bigint are rejected without an unsafe cast'
);
select throws_ok(
  $$select api.preview_learning_track_lifecycle_v1(
    'track:track-paused-exact', 'resume_track', '9223372036854775807', '1',
    'Maximum bigint Plan version.'
  )$$,
  '40001', 'Growth Plan version is stale',
  'the maximum positive bigint is accepted syntactically and compared exactly'
);
select throws_ok(
  $$select api.apply_learning_track_lifecycle_v1(
    'track:track-paused-exact', 'resume_track', '0', '1',
    '0000000000000000000000000000000000000000000000000000000000000000',
    'Stale Plan.', 'phase4b-track-stale-plan'
  )$$,
  '22023', 'Learning Track lifecycle request is invalid',
  'malformed expected Plan version is invalid'
);
select throws_ok(
  $$select api.apply_learning_track_lifecycle_v1(
    'track:track-paused-exact', 'resume_track', '2', '1',
    '0000000000000000000000000000000000000000000000000000000000000000',
    'Stale Plan.', 'phase4b-track-stale-plan-positive'
  )$$,
  '40001', 'Growth Plan version is stale',
  'a well-formed stale expected Plan version is refused before digest comparison'
);
select throws_ok(
  $$select api.apply_learning_track_lifecycle_v1(
    'track:track-paused-exact', 'resume_track', '1', '2',
    '0000000000000000000000000000000000000000000000000000000000000000',
    'Stale Track.', 'phase4b-track-stale-target'
  )$$,
  '40001', 'Learning Track version is stale',
  'a well-formed stale expected target Track version is refused before digest comparison'
);
select throws_ok(
  $$select api.apply_learning_track_lifecycle_v1(
    'track:track-paused-exact', 'resume_track', '1', '1',
    '0000000000000000000000000000000000000000000000000000000000000000',
    'Changed digest.', 'phase4b-track-digest'
  )$$,
  '40001', 'Learning Track preview is stale',
  'changed digest is refused after locked recomputation'
);
select throws_ok(
  $$select api.apply_learning_track_lifecycle_v1(
    (select response->>'learningTrackKey' from track_results where result_name = 'alice-plan'),
    'pause_track', '1', '1',
    (select response->>'previewDigest' from track_results where result_name = 'alice-pause-preview'),
    'Changed replay.', 'phase4b-track-pause'
  )$$,
  '22023', 'idempotency key reused with a different request',
  'completed idempotency key conflicts with a changed request'
);
reset role;

savepoint active_sibling_stale;
set local role authenticated;
insert into track_results values (
  'alice-sibling-stale-preview', api.preview_learning_track_lifecycle_v1(
    'track:track-paused-exact', 'resume_track', '1', '1',
    'Resume only if every active sibling is unchanged.'
  )
);
reset role;
update planning.learning_tracks
set aggregate_version = aggregate_version + 1,
  updated_at = pg_catalog.clock_timestamp()
where growth_plan_id = (
    select (response->>'growthPlanId')::uuid
    from track_results where result_name = 'alice-plan'
  )
  and track_key = 'track:track-active-second';
set local role authenticated;
select throws_ok(
  $$select api.apply_learning_track_lifecycle_v1(
    'track:track-paused-exact', 'resume_track', '1', '1',
    (select response->>'previewDigest'
     from track_results where result_name = 'alice-sibling-stale-preview'),
    'Resume only if every active sibling is unchanged.',
    'phase4b-track-stale-active-sibling'
  )$$,
  '40001', 'Learning Track preview is stale',
  'an active sibling version change invalidates the locked before/after fingerprints'
);
reset role;
rollback to savepoint active_sibling_stale;

savepoint archived_parent_unavailable;
update planning.growth_plans
set lifecycle = 'archived'
where growth_plan_id = (
  select (response->>'growthPlanId')::uuid
  from track_results where result_name = 'alice-plan'
);
set local role authenticated;
select throws_ok(
  $$select api.preview_learning_track_lifecycle_v1(
    'track:track-paused-exact', 'resume_track', '1', '1', 'Archived parent.'
  )$$,
  '42501', 'Learning Track is unavailable',
  'a Track under an archived parent is unavailable rather than resumable'
);
reset role;
rollback to savepoint archived_parent_unavailable;

-- Bob cannot use an Alice-issued key; the same unavailable message prevents enumeration.
select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', 'd5000000-0000-4000-8000-000000000002',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text,
  true
);
set local role authenticated;
select throws_ok(
  pg_catalog.format(
    'select api.preview_learning_track_lifecycle_v1(%L,%L,%L,%L,%L)',
    (select response->>'learningTrackKey' from track_results where result_name = 'alice-plan'),
    'pause_track', '1', '1', 'Foreign Track.'
  ),
  '42501', 'Learning Track is unavailable',
  'foreign Track key is indistinguishable from a missing Track'
);
select throws_ok(
  pg_catalog.format(
    'select api.apply_learning_track_lifecycle_v1(%L,%L,%L,%L,%L,%L,%L)',
    (select response->>'learningTrackKey' from track_results where result_name = 'alice-plan'),
    'pause_track', '1', '1',
    '0000000000000000000000000000000000000000000000000000000000000000',
    'Foreign Track apply.', 'phase4b-track-bob-foreign-apply'
  ),
  '42501', 'Learning Track is unavailable',
  'apply also collapses a foreign Track key to the unavailable result'
);
reset role;

-- Inject failure after event insertion, at delivery insertion, and prove full rollback.
select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', 'd5000000-0000-4000-8000-000000000001',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text,
  true
);
set local role authenticated;
insert into track_results
select 'alice-rollback-preview', api.preview_learning_track_lifecycle_v1(
  response->>'learningTrackKey', 'resume_track', '1', '2', 'Prove delivery rollback.'
)
from track_results where result_name = 'alice-plan';
reset role;

create temporary table track_rollback_before as
select track.lifecycle, track.aggregate_version,
  (select count(*)::bigint from outbox.command_receipts
   where command_type = 'planning.change_learning_track_lifecycle') as receipt_count,
  (select count(*)::bigint from outbox.events
   where aggregate_id = track.learning_track_id) as event_count,
  (select count(*)::bigint from outbox.deliveries as delivery
   join outbox.events as event on event.event_id = delivery.event_id
   where event.aggregate_id = track.learning_track_id) as delivery_count
from planning.learning_tracks as track
where track.learning_track_id = (
  select (response->>'learningTrackId')::uuid from track_results where result_name = 'alice-plan'
);

create function public.fail_track_lifecycle_delivery_for_test()
returns trigger language plpgsql set search_path = '' as $function$
begin
  if new.consumer_name = 'planning.plan_snapshot_v1'
     and new.workspace_id::text = pg_catalog.current_setting(
       'pando.test.fail_track_delivery_workspace', true
     ) then
    raise exception using errcode = 'P0001',
      message = 'injected Learning Track delivery failure';
  end if;
  return new;
end
$function$;
create trigger fail_track_lifecycle_delivery_for_test
before insert on outbox.deliveries
for each row execute function public.fail_track_lifecycle_delivery_for_test();
select set_config(
  'pando.test.fail_track_delivery_workspace',
  (select response->>'workspaceId' from track_results where result_name = 'alice-plan'),
  true
);
set local role authenticated;
select throws_ok(
  pg_catalog.format(
    'select api.apply_learning_track_lifecycle_v1(%L,%L,%L,%L,%L,%L,%L)',
    (select response->>'learningTrackKey' from track_results where result_name = 'alice-plan'),
    'resume_track', '1', '2',
    (select response->>'previewDigest' from track_results where result_name = 'alice-rollback-preview'),
    'Prove delivery rollback.', 'phase4b-track-rollback'
  ),
  'P0001', 'injected Learning Track delivery failure',
  'delivery failure rolls back the entire Track lifecycle command'
);
reset role;
drop trigger fail_track_lifecycle_delivery_for_test on outbox.deliveries;
drop function public.fail_track_lifecycle_delivery_for_test();

select ok(
  (select track.lifecycle = before_state.lifecycle
     and track.aggregate_version = before_state.aggregate_version
   from planning.learning_tracks as track
   cross join track_rollback_before as before_state
   where track.learning_track_id = (
     select (response->>'learningTrackId')::uuid from track_results where result_name = 'alice-plan'
   ))
  and (select count(*)::bigint from outbox.command_receipts
       where command_type = 'planning.change_learning_track_lifecycle') =
      (select receipt_count from track_rollback_before)
  and (select count(*)::bigint from outbox.events where aggregate_id =
       (select (response->>'learningTrackId')::uuid from track_results where result_name = 'alice-plan')) =
      (select event_count from track_rollback_before)
  and (select count(*)::bigint from outbox.deliveries as delivery
       join outbox.events as event on event.event_id = delivery.event_id
       where event.aggregate_id =
         (select (response->>'learningTrackId')::uuid from track_results where result_name = 'alice-plan')) =
      (select delivery_count from track_rollback_before),
  'delivery failure leaves no partial Track, receipt, event, or delivery'
);

select * from finish();
rollback;
