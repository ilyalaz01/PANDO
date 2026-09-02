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
    'authenticated',
    'api.get_learning_track_terminal_lifecycle_source_v1(text)', 'EXECUTE'
  )
  and pg_catalog.has_function_privilege(
    'authenticated',
    'api.preview_learning_track_terminal_lifecycle_v1(text,text,text,text,text)',
    'EXECUTE'
  )
  and pg_catalog.has_function_privilege(
    'authenticated',
    'api.apply_learning_track_terminal_lifecycle_v1(text,text,text,text,text,text,text)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'anon', 'api.get_learning_track_terminal_lifecycle_source_v1(text)', 'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'service_role',
    'api.apply_learning_track_terminal_lifecycle_v1(text,text,text,text,text,text,text)',
    'EXECUTE'
  ),
  'terminal Track lifecycle exposes only actor-scoped authenticated APIs'
);

select ok(
  not pg_catalog.has_function_privilege(
    runtime_role.role_name, private_helper.signature, 'EXECUTE'
  ),
  pg_catalog.format(
    '%s cannot execute private D2b4 helper %s',
    runtime_role.role_name, private_helper.signature
  )
)
from (values ('anon'), ('authenticated'), ('service_role')) as runtime_role(role_name)
cross join (values
  ('planning.projected_terminal_track_constraints_v1(uuid,uuid,uuid,text,bigint)'),
  ('planning.build_learning_track_terminal_lifecycle_preview_v1(uuid,uuid,text,integer,bigint,uuid,text,text,text,integer,integer,bigint,text,bigint,bigint,text)'),
  ('planning.track_terminal_lifecycle_event_payload_v1_is_valid(jsonb)')
) as private_helper(signature)
order by runtime_role.role_name, private_helper.signature;

select ok(
  count(*) = 3
    and bool_and(procedure.prosecdef)
    and bool_and('search_path=""' = any(coalesce(procedure.proconfig, '{}'::text[])))
    and bool_and(owner.rolname = 'pando_planning_api')
    and bool_and(not owner.rolcanlogin and not owner.rolinherit and not owner.rolbypassrls),
  'terminal public APIs are pinned definers owned by the Planning NOLOGIN role'
)
from pg_catalog.pg_proc as procedure
join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
join pg_catalog.pg_roles as owner on owner.oid = procedure.proowner
where namespace.nspname = 'api'
  and procedure.proname in (
    'get_learning_track_terminal_lifecycle_source_v1',
    'preview_learning_track_terminal_lifecycle_v1',
    'apply_learning_track_terminal_lifecycle_v1'
  );

select ok(
  count(*) = 3
    and bool_and(procedure.prosecdef =
      (procedure.proname <> 'track_terminal_lifecycle_event_payload_v1_is_valid'))
    and bool_and('search_path=""' = any(coalesce(procedure.proconfig, '{}'::text[])))
    and bool_and(owner.rolname = 'pando_planning_api'),
  'terminal private helpers have exact definer modes and bounded owner'
)
from pg_catalog.pg_proc as procedure
join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
join pg_catalog.pg_roles as owner on owner.oid = procedure.proowner
where namespace.nspname = 'planning'
  and procedure.proname in (
    'projected_terminal_track_constraints_v1',
    'build_learning_track_terminal_lifecycle_preview_v1',
    'track_terminal_lifecycle_event_payload_v1_is_valid'
  );

select ok(
  pg_catalog.strpos(
    definition,
    'v_actor_user_id::text || '':planning.change_learning_track_terminal_lifecycle_v1:'''
  ) < pg_catalog.strpos(definition, '''planning-workspace:'' || v_workspace_id::text')
  and pg_catalog.strpos(definition, '''planning-workspace:'' || v_workspace_id::text')
    < pg_catalog.strpos(definition, 'select plan.* into v_plan')
  and pg_catalog.strpos(definition, 'select plan.* into v_plan')
    < pg_catalog.strpos(definition, 'perform track.learning_track_id')
  and pg_catalog.strpos(definition, 'perform track.learning_track_id')
    < pg_catalog.strpos(definition, 'select track.* into v_track')
  and pg_catalog.strpos(definition, 'order by track.learning_track_id') > 0,
  'terminal apply locks actor/key, workspace, Plan, all children, then target'
)
from (
  select pg_catalog.lower(pg_catalog.pg_get_functiondef(procedure.oid)) as definition
  from pg_catalog.pg_proc as procedure
  join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'api'
    and procedure.proname = 'apply_learning_track_terminal_lifecycle_v1'
    and procedure.pronargs = 7
) as source;

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    'e5000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
    'terminal-alice@pando.test', '', clock_timestamp(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    clock_timestamp(), clock_timestamp()
  ),
  (
    'e5000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
    'terminal-bob@pando.test', '', clock_timestamp(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    clock_timestamp(), clock_timestamp()
  );

create temporary table terminal_results (
  result_name text primary key,
  response jsonb not null
);
grant select, insert on terminal_results to authenticated;
grant select, insert on terminal_results to pando_planning_api;

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', 'e5000000-0000-4000-8000-000000000002',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text,
  true
);
set local role authenticated;
insert into terminal_results values (
  'bob-bootstrap', api.bootstrap_personal_workspace('phase4b-terminal-bob', 'Terminal Bob')
);
insert into terminal_results values (
  'bob-empty', api.get_learning_track_terminal_lifecycle_source_v1(null)
);
reset role;

select ok(
  (select response#>>'{contract,name}' = 'LearningTrackTerminalLifecycleSourceV1'
     and response->>'state' = 'NO_CURRENT_PLAN'
     and response->'growthPlan' = 'null'::jsonb
     and response->'currentTracks' = '[]'::jsonb
     and response->'terminalHistory' = '[]'::jsonb
     and response->'historyPage' = '{"hasMore":false,"nextCursor":null}'::jsonb
   from terminal_results where result_name = 'bob-empty'),
  'an actor without a current Plan receives the honest empty source'
);

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', 'e5000000-0000-4000-8000-000000000001',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text,
  true
);
set local role authenticated;
insert into terminal_results values (
  'alice-bootstrap', api.bootstrap_personal_workspace('phase4b-terminal-alice', 'Terminal Alice')
);
insert into terminal_results
select 'alice-goal', api.create_readiness_goal(
  (select (response->>'workspace_id')::uuid
   from terminal_results where result_name = 'alice-bootstrap'),
  'goal:terminal-alice', 'Terminal Alice goal',
  'target:nvidia-python-verification-base-v1', 'phase4b-terminal-alice-goal'
);
insert into terminal_results values (
  'alice-plan', pg_temp.initialize_growth_plan_fixture_v1(
    'goal:terminal-alice', 600, 45, 80, 120, 'phase4b-terminal-alice-plan'
  )
);
reset role;

insert into planning.learning_tracks (
  learning_track_id, workspace_id, growth_plan_id, track_key, title,
  readiness_goal_id, profile_version_id, roadmap_version_id, lifecycle,
  priority, protected_minimum_minutes, default_session_minutes, aggregate_version,
  updated_at
)
select
  fixture.learning_track_id, source.workspace_id, source.growth_plan_id,
  fixture.track_key, fixture.title, source.readiness_goal_id,
  source.profile_version_id, source.roadmap_version_id, fixture.lifecycle,
  fixture.priority, fixture.protected_minimum_minutes,
  source.default_session_minutes, fixture.aggregate_version, fixture.updated_at
from planning.learning_tracks as source
cross join (
  values
    ('e5100000-0000-4000-8000-000000000001'::uuid,
      'track:terminal-paused', 'Paused terminal candidate', 'paused', 70, 80, 1,
      '2026-09-02 08:00:00+00'::timestamptz),
    ('e5100000-0000-4000-8000-000000000002'::uuid,
      'track:terminal-completed', 'Completed terminal candidate', 'completed', 60, 60, 4,
      '2026-09-02 12:00:00+00'::timestamptz),
    ('e5100000-0000-4000-8000-000000000003'::uuid,
      'track:terminal-archived', 'Archived terminal history', 'archived', 50, 40, 7,
      '2026-09-02 11:00:00+00'::timestamptz)
) as fixture(
  learning_track_id, track_key, title, lifecycle, priority,
  protected_minimum_minutes, aggregate_version, updated_at
)
where source.growth_plan_id = (
  select (response->>'growthPlanId')::uuid
  from terminal_results where result_name = 'alice-plan'
)
  and source.track_key = (
    select response->>'learningTrackKey'
    from terminal_results where result_name = 'alice-plan'
  );

insert into planning.learning_tracks (
  learning_track_id, workspace_id, growth_plan_id, track_key, title,
  readiness_goal_id, profile_version_id, roadmap_version_id, lifecycle,
  priority, protected_minimum_minutes, default_session_minutes, aggregate_version,
  updated_at
)
select
  ('e52' || pg_catalog.lpad(series.value::text, 29, '0'))::uuid,
  source.workspace_id, source.growth_plan_id,
  'track:terminal-history-' || pg_catalog.lpad(series.value::text, 2, '0'),
  'Terminal history ' || series.value::text,
  source.readiness_goal_id, source.profile_version_id, source.roadmap_version_id,
  case when series.value % 2 = 0 then 'completed' else 'archived' end,
  10, 0, source.default_session_minutes, 1,
  '2026-09-01 00:00:00+00'::timestamptz - series.value * interval '1 minute'
from planning.learning_tracks as source
cross join pg_catalog.generate_series(1, 20) as series(value)
where source.track_key = (
  select response->>'learningTrackKey'
  from terminal_results where result_name = 'alice-plan'
);

set local role authenticated;
insert into terminal_results values (
  'alice-source-page-1', api.get_learning_track_terminal_lifecycle_source_v1(null)
);
insert into terminal_results
select 'alice-source-page-2', api.get_learning_track_terminal_lifecycle_source_v1(
  response#>>'{historyPage,nextCursor}'
)
from terminal_results where result_name = 'alice-source-page-1';
reset role;

select ok(
  (select response->>'state' = 'READY'
     and pg_catalog.jsonb_array_length(response->'currentTracks') = 2
     and response#>>'{currentTracks,0,lifecycle}' = 'ACTIVE'
     and response#>'{currentTracks,0,capabilities}' =
       '["complete_track","archive_track"]'::jsonb
     and response#>>'{currentTracks,1,lifecycle}' = 'PAUSED'
     and pg_catalog.jsonb_array_length(response->'terminalHistory') = 20
     and response#>>'{terminalHistory,0,lifecycle}' = 'COMPLETED'
     and response#>'{terminalHistory,0,capabilities}' = '["archive_track"]'::jsonb
     and response#>>'{terminalHistory,1,lifecycle}' = 'ARCHIVED'
     and response#>'{terminalHistory,1,capabilities}' = '[]'::jsonb
     and response#>>'{historyPage,hasMore}' = 'true'
     and response#>>'{historyPage,nextCursor}' is not null
   from terminal_results where result_name = 'alice-source-page-1'),
  'source returns all current Tracks and one ordered bounded terminal page with exact capabilities'
);

select ok(
  (select pg_catalog.jsonb_array_length(response->'currentTracks') = 2
     and pg_catalog.jsonb_array_length(response->'terminalHistory') = 2
     and response#>>'{historyPage,hasMore}' = 'false'
     and response#>'{historyPage,nextCursor}' = 'null'::jsonb
   from terminal_results where result_name = 'alice-source-page-2'),
  'opaque keyset continuation retains current Tracks and returns only the remaining history'
);

set local role authenticated;
select throws_ok(
  $$select api.get_learning_track_terminal_lifecycle_source_v1('not-a-cursor')$$,
  '22023', 'Track history cursor is invalid',
  'malformed history cursor fails closed'
);
select throws_ok(
  $$select api.get_learning_track_terminal_lifecycle_source_v1(repeat('A', 513))$$,
  '22023', 'Track history cursor is invalid',
  'oversized history cursor fails closed'
);
select throws_ok(
  pg_catalog.format(
    'select api.get_learning_track_terminal_lifecycle_source_v1(%L)',
    pg_catalog.replace(pg_catalog.replace(pg_catalog.encode(
      pg_catalog.convert_to(pg_catalog.jsonb_build_object(
        'v', 1,
        'updatedAt', '2026-09-01T00:00:00.000000Z',
        'trackKey', 'track:terminal-history-99',
        'learningTrackId', 'e5299999-9999-4999-8999-999999999999'
      )::text, 'UTF8'),
      'base64'
    ), pg_catalog.chr(10), ''), pg_catalog.chr(13), '')
  ),
  '22023', 'Track history cursor is invalid',
  'well-formed cursor that does not identify an owned terminal row fails closed'
);
reset role;

set local role authenticated;
insert into terminal_results
select 'active-complete-preview', api.preview_learning_track_terminal_lifecycle_v1(
  response->>'learningTrackKey', 'complete_track', '1', '1',
  'Complete this active Track without asserting Mastery.'
)
from terminal_results where result_name = 'alice-plan';
insert into terminal_results values (
  'paused-complete-preview', api.preview_learning_track_terminal_lifecycle_v1(
    'track:terminal-paused', 'complete_track', '1', '1',
    'Complete this paused Track without asserting Mastery.'
  )
);
insert into terminal_results values (
  'active-archive-preview', api.preview_learning_track_terminal_lifecycle_v1(
    (select response->>'learningTrackKey'
     from terminal_results where result_name = 'alice-plan'),
    'archive_track', '1', '1', 'Archive this active Track without deletion.'
  )
);
insert into terminal_results values (
  'paused-archive-preview', api.preview_learning_track_terminal_lifecycle_v1(
    'track:terminal-paused', 'archive_track', '1', '1',
    'Archive this paused Track without deletion.'
  )
);
insert into terminal_results values (
  'completed-archive-preview', api.preview_learning_track_terminal_lifecycle_v1(
    'track:terminal-completed', 'archive_track', '1', '4',
    'Archive this completed Track without deletion.'
  )
);
reset role;

select ok(
  (select response#>>'{before,lifecycle}' = 'ACTIVE'
     and response#>>'{after,lifecycle}' = 'COMPLETED'
     and response#>>'{currentPortfolio,countBefore}' = '2'
     and response#>>'{currentPortfolio,countAfter}' = '1'
     and response#>>'{activeConstraint,activeTrackCountBefore}' = '1'
     and response#>>'{activeConstraint,activeTrackCountAfter}' = '0'
     and response#>>'{activeConstraint,activeProtectedMinimumMinutesBefore}' = '120'
     and response#>>'{activeConstraint,activeProtectedMinimumMinutesAfter}' = '0'
     and response#>'{warnings}' =
       '[{"code":"TRACK_COMPLETION_IS_TERMINAL_AND_NOT_MASTERY"}]'::jsonb
     and response#>'{doesNotAssert}' =
       '{"evidence":true,"mastery":true,"readiness":true,"goalCompletion":true}'::jsonb
   from terminal_results where result_name = 'active-complete-preview'),
  'active completion preview shows exact current/capacity removal and non-claims'
);

select ok(
  (select response#>>'{before,lifecycle}' = 'PAUSED'
     and response#>>'{after,lifecycle}' = 'COMPLETED'
     and response#>>'{currentPortfolio,countAfter}' = '1'
     and response#>>'{activeConstraint,activeTrackCountAfter}' = '1'
   from terminal_results where result_name = 'paused-complete-preview')
  and (select response#>>'{after,lifecycle}' = 'ARCHIVED'
       from terminal_results where result_name = 'active-archive-preview')
  and (select response#>>'{after,lifecycle}' = 'ARCHIVED'
       from terminal_results where result_name = 'paused-archive-preview')
  and (select response#>>'{before,lifecycle}' = 'COMPLETED'
       and response#>>'{after,lifecycle}' = 'ARCHIVED'
       and response#>>'{visibilityBefore}' = 'TERMINAL_HISTORY'
       and response#>>'{currentPortfolio,countBefore}' =
         response#>>'{currentPortfolio,countAfter}'
       and response#>>'{activeConstraint,activeTrackFingerprintBefore}' =
         response#>>'{activeConstraint,activeTrackFingerprintAfter}'
       from terminal_results where result_name = 'completed-archive-preview'),
  'all five accepted terminal transitions produce exact previews'
);

select is(
  (select count(*)::bigint from outbox.command_receipts
   where command_type = 'planning.change_learning_track_terminal_lifecycle_v1'),
  0::bigint,
  'terminal previews are side-effect free'
);

set local role authenticated;
select throws_ok(
  $$select api.preview_learning_track_terminal_lifecycle_v1(
    'track:terminal-completed', 'complete_track', '1', '4', 'No-op completion.'
  )$$,
  '42501', 'Learning Track terminal lifecycle is unavailable',
  'completed Track cannot be completed again'
);
select throws_ok(
  $$select api.preview_learning_track_terminal_lifecycle_v1(
    'track:terminal-archived', 'archive_track', '1', '7', 'No-op archive.'
  )$$,
  '42501', 'Learning Track terminal lifecycle is unavailable',
  'archived Track is read-only'
);
select throws_ok(
  $$select api.preview_learning_track_terminal_lifecycle_v1(
    'track:terminal-paused', 'archive_track', '2', '1', 'Stale Plan.'
  )$$,
  '40001', 'Growth Plan version is stale',
  'stale Plan version is refused'
);
select throws_ok(
  $$select api.preview_learning_track_terminal_lifecycle_v1(
    'track:terminal-paused', 'archive_track', '1', '2', 'Stale Track.'
  )$$,
  '40001', 'Learning Track version is stale',
  'stale Track version is refused'
);
select throws_ok(
  $$select api.apply_learning_track_terminal_lifecycle_v1(
    (select response->>'learningTrackKey' from terminal_results where result_name = 'alice-plan'),
    'complete_track', '1', '1', repeat('0', 64),
    'Complete this active Track without asserting Mastery.',
    'e5300000-0000-4000-8000-000000000099'
  )$$,
  '40001', 'Learning Track terminal preview is stale',
  'apply refuses a syntactically valid digest that does not match the exact preview'
);
reset role;
select is(
  (select count(*)::bigint from outbox.command_receipts
   where command_type = 'planning.change_learning_track_terminal_lifecycle_v1'),
  0::bigint,
  'digest mismatch leaves no terminal command receipt'
);
select ok(
  (select lifecycle = 'active' from planning.learning_tracks
   where track_key = (
     select response->>'learningTrackKey' from terminal_results where result_name = 'alice-plan'
   ))
  and not exists (
    select 1 from outbox.events
    where event_name = 'planning.input_changed'
      and payload->>'change_kind' = 'TRACK_TERMINAL_LIFECYCLE_CHANGED'
  )
  and not exists (
    select 1 from outbox.deliveries as delivery
    join outbox.events as event on event.event_id = delivery.event_id
    where event.event_name = 'planning.input_changed'
      and event.payload->>'change_kind' = 'TRACK_TERMINAL_LIFECYCLE_CHANGED'
  ),
  'digest mismatch leaves no Track, terminal event, or delivery side effect'
);

do $planning_test_role$
begin
  execute pg_catalog.format('grant pando_planning_api to %I with set true', current_user);
end
$planning_test_role$;
set local role pando_planning_api;
select is(
  planning.track_terminal_lifecycle_event_payload_v1_is_valid(
    pg_catalog.jsonb_build_object(
      'change_kind', 'TRACK_TERMINAL_LIFECYCLE_CHANGED',
      'growth_plan_id', 'e5000000-0000-4000-8000-000000000010',
      'learning_track_id', 'e5000000-0000-4000-8000-000000000011',
      'learning_track_version', '9223372036854775808',
      'lifecycle', 'COMPLETED'
    )
  ),
  false,
  'terminal event SQL validator rejects versions above bigint'
);
reset role;
do $planning_test_role$
begin
  execute pg_catalog.format('revoke pando_planning_api from %I', current_user);
end
$planning_test_role$;

create temporary table terminal_before_apply as
select
  plan.aggregate_version as plan_version,
  target.learning_track_id,
  target.aggregate_version as target_version,
  sibling.learning_track_id as sibling_id,
  sibling.aggregate_version as sibling_version,
  (select count(*)::bigint from planning.learning_track_activities
   where growth_plan_id = plan.growth_plan_id) as activity_count,
  (select count(*)::bigint from planning.plan_snapshots
   where workspace_id = plan.workspace_id) as snapshot_count
from planning.growth_plans as plan
join planning.learning_tracks as target
  on target.workspace_id = plan.workspace_id and target.growth_plan_id = plan.growth_plan_id
join planning.learning_tracks as sibling
  on sibling.workspace_id = plan.workspace_id and sibling.growth_plan_id = plan.growth_plan_id
where target.track_key = (
  select response->>'learningTrackKey'
  from terminal_results where result_name = 'alice-plan'
)
  and sibling.track_key = 'track:terminal-paused';

set local role authenticated;
insert into terminal_results
select 'active-complete-apply', api.apply_learning_track_terminal_lifecycle_v1(
  plan.response->>'learningTrackKey', 'complete_track', '1', '1',
  preview.response->>'previewDigest',
  'Complete this active Track without asserting Mastery.',
  'e5300000-0000-4000-8000-000000000001'
)
from terminal_results as plan
join terminal_results as preview on preview.result_name = 'active-complete-preview'
where plan.result_name = 'alice-plan';
insert into terminal_results
select 'active-complete-replay', api.apply_learning_track_terminal_lifecycle_v1(
  plan.response->>'learningTrackKey', 'complete_track', '1', '1',
  preview.response->>'previewDigest',
  'Complete this active Track without asserting Mastery.',
  'e5300000-0000-4000-8000-000000000001'
)
from terminal_results as plan
join terminal_results as preview on preview.result_name = 'active-complete-preview'
where plan.result_name = 'alice-plan';
reset role;

select is(
  (select response from terminal_results where result_name = 'active-complete-replay'),
  (select response from terminal_results where result_name = 'active-complete-apply'),
  'completed terminal command replays its byte-identical response'
);

select ok(
  (select target.lifecycle = 'completed'
     and target.aggregate_version = before_state.target_version + 1
     and plan.aggregate_version = before_state.plan_version
     and sibling.aggregate_version = before_state.sibling_version
     and (select count(*)::bigint from planning.learning_track_activities
          where growth_plan_id = plan.growth_plan_id) = before_state.activity_count
     and (select count(*)::bigint from planning.plan_snapshots
          where workspace_id = plan.workspace_id) = before_state.snapshot_count
   from terminal_before_apply as before_state
   join planning.learning_tracks as target
     on target.learning_track_id = before_state.learning_track_id
   join planning.learning_tracks as sibling
     on sibling.learning_track_id = before_state.sibling_id
   join planning.growth_plans as plan on plan.growth_plan_id = target.growth_plan_id),
  'completion changes only target lifecycle/version and preserves Plan, sibling, activities, and snapshots'
);

select ok(
  (select count(*) = 1
   from outbox.command_receipts as receipt
   join terminal_results as applied on applied.result_name = 'active-complete-apply'
     and receipt.command_id = (applied.response->>'commandId')::uuid
   where receipt.command_type = 'planning.change_learning_track_terminal_lifecycle_v1'
     and receipt.command_status = 'completed')
  and (select count(*) = 1
       from outbox.events as event
       join terminal_results as applied on applied.result_name = 'active-complete-apply'
         and event.event_id = (applied.response->'emittedEventIds'->>0)::uuid
       where event.event_name = 'planning.input_changed'
         and event.aggregate_type = 'planning.learning_track'
         and event.payload->>'change_kind' = 'TRACK_TERMINAL_LIFECYCLE_CHANGED'
         and event.payload->>'lifecycle' = 'COMPLETED')
  and (select count(*) = 1
       from outbox.deliveries as delivery
       join terminal_results as applied on applied.result_name = 'active-complete-apply'
         and delivery.delivery_id = (applied.response->>'planningDeliveryId')::uuid
       where delivery.consumer_name = 'planning.plan_snapshot_v1'
         and delivery.delivery_state = 'pending'),
  'completion atomically owns one receipt, minimal event, and fixed delivery'
);

set local role authenticated;
insert into terminal_results
select 'completed-after-preview', api.preview_learning_track_terminal_lifecycle_v1(
  response->>'learningTrackKey', 'archive_track', '1', '2',
  'Archive the completed Track without deletion.'
)
from terminal_results where result_name = 'alice-plan';
insert into terminal_results
select 'completed-after-archive', api.apply_learning_track_terminal_lifecycle_v1(
  plan.response->>'learningTrackKey', 'archive_track', '1', '2',
  preview.response->>'previewDigest', 'Archive the completed Track without deletion.',
  'e5300000-0000-4000-8000-000000000002'
)
from terminal_results as plan
join terminal_results as preview on preview.result_name = 'completed-after-preview'
where plan.result_name = 'alice-plan';
insert into terminal_results values (
  'source-after-archive', api.get_learning_track_terminal_lifecycle_source_v1(null)
);
reset role;

select ok(
  (select response#>>'{changedTrack,lifecycle}' = 'ARCHIVED'
     and response#>>'{changedTrack,aggregateVersion}' = '3'
   from terminal_results where result_name = 'completed-after-archive')
  and not exists (
    select 1 from planning.learning_tracks
    where learning_track_id = (
      select learning_track_id from terminal_before_apply
    ) and lifecycle <> 'archived'
  )
  and exists (
    select 1
    from terminal_results as source
    cross join terminal_results as plan
    cross join lateral pg_catalog.jsonb_array_elements(
      source.response->'terminalHistory'
    ) as history(track)
    where source.result_name = 'source-after-archive'
      and plan.result_name = 'alice-plan'
      and history.track->>'trackKey' = plan.response->>'learningTrackKey'
      and history.track->>'lifecycle' = 'ARCHIVED'
      and history.track->'capabilities' = '[]'::jsonb
  ),
  'completed Track can later be archived and remains read-only history'
);

set local role authenticated;
select throws_ok(
  $$select api.apply_learning_track_terminal_lifecycle_v1(
    'track:terminal-paused', 'archive_track', '1', '1',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'Changed request.', 'e5300000-0000-4000-8000-000000000001'
  )$$,
  '22023', 'idempotency key reused with a different request',
  'same key with changed request is rejected'
);
reset role;

savepoint terminal_delivery_rollback;
set local role authenticated;
insert into terminal_results values (
  'rollback-preview', api.preview_learning_track_terminal_lifecycle_v1(
    'track:terminal-paused', 'archive_track', '1', '1',
    'Prove terminal delivery rollback.'
  )
);
reset role;
create function pg_temp.reject_terminal_delivery()
returns trigger language plpgsql as $function$
begin
  if new.consumer_name = 'planning.plan_snapshot_v1' then
    raise exception 'injected terminal delivery failure';
  end if;
  return new;
end
$function$;
create trigger reject_terminal_delivery
before insert on outbox.deliveries
for each row execute function pg_temp.reject_terminal_delivery();
set local role authenticated;
select throws_ok(
  (select pg_catalog.format(
    'select api.apply_learning_track_terminal_lifecycle_v1(%L,%L,%L,%L,%L,%L,%L)',
    'track:terminal-paused', 'archive_track', '1', '1',
    response->>'previewDigest', 'Prove terminal delivery rollback.',
    'e5300000-0000-4000-8000-000000000003'
  ) from terminal_results where result_name = 'rollback-preview'),
  'P0001', 'injected terminal delivery failure',
  'injected delivery failure aborts terminal apply'
);
reset role;
select ok(
  exists (
    select 1 from planning.learning_tracks
    where track_key = 'track:terminal-paused' and lifecycle = 'paused' and aggregate_version = 1
  )
  and not exists (
    select 1 from outbox.command_receipts
    where command_type = 'planning.change_learning_track_terminal_lifecycle_v1'
      and idempotency_key = 'e5300000-0000-4000-8000-000000000003'
  ),
  'failed terminal delivery rolls back Track, receipt, event, and delivery'
);
rollback to savepoint terminal_delivery_rollback;

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', 'e5000000-0000-4000-8000-000000000002',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text,
  true
);
set local role authenticated;
select throws_ok(
  $$select api.preview_learning_track_terminal_lifecycle_v1(
    'track:terminal-paused', 'archive_track', '1', '1', 'Foreign Track.'
  )$$,
  '42501', 'Learning Track terminal lifecycle is unavailable',
  'foreign selector is non-enumerating'
);
reset role;

select * from finish();
rollback;
