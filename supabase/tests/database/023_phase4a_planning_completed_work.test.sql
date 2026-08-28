begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- Privilege boundary: Planning executes two bounded owner functions and still reads no Sessions or
-- Evidence table directly. The Evidence source role is read-only and unreachable from runtime roles.
select ok(
  pg_catalog.has_function_privilege(
    'pando_planning_worker',
    'sessions.read_planning_completed_work_source_v1(uuid,timestamptz,timestamptz)',
    'EXECUTE'
  )
  and pg_catalog.has_function_privilege(
    'pando_planning_worker',
    'evidence.read_planning_completed_work_source_v2(uuid,uuid[],timestamptz)',
    'EXECUTE'
  )
  and pg_catalog.has_function_privilege(
    'pando_planning_worker',
    'planning.load_plan_snapshot_source_bundle_v1(uuid,timestamptz)',
    'EXECUTE'
  )
  and not pg_catalog.has_table_privilege(
    'pando_planning_worker', 'sessions.focus_sessions', 'SELECT'
  )
  and not pg_catalog.has_table_privilege(
    'pando_planning_worker', 'evidence.observations', 'SELECT'
  )
  and not pg_catalog.has_table_privilege(
    'pando_planning_worker', 'evidence.activity_attempts', 'SELECT'
  ),
  'Planning reads completed work through owner queries and never through Evidence tables'
);

select ok(
  not pg_catalog.has_function_privilege(
    'authenticated',
    'evidence.read_planning_completed_work_source_v2(uuid,uuid[],timestamptz)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'anon',
    'evidence.read_planning_completed_work_source_v2(uuid,uuid[],timestamptz)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'service_role',
    'sessions.read_planning_completed_work_source_v1(uuid,timestamptz,timestamptz)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated',
    'planning.load_plan_snapshot_source_bundle_pre_evidence_claim_v1(uuid,timestamptz)',
    'EXECUTE'
  ),
  'no runtime role can call the completed-work owner queries'
);

select ok(
  not pg_catalog.has_table_privilege(
    'pando_evidence_planning_source', 'evidence.observations', 'INSERT'
  )
  and not pg_catalog.has_table_privilege(
    'pando_evidence_planning_source', 'evidence.corrections', 'UPDATE'
  )
  and not pg_catalog.has_table_privilege(
    'pando_evidence_planning_source', 'evidence.subject_ledgers', 'UPDATE'
  )
  and not pg_catalog.has_table_privilege(
    'pando_evidence_planning_source', 'evidence.observations', 'SELECT'
  )
  and pg_catalog.has_column_privilege(
    'pando_evidence_planning_source', 'evidence.observations', 'evidence_id', 'SELECT'
  )
  and not pg_catalog.has_column_privilege(
    'pando_evidence_planning_source', 'evidence.observations', 'outcome', 'SELECT'
  )
  and not pg_catalog.has_column_privilege(
    'pando_evidence_planning_source', 'evidence.corrections', 'reason', 'SELECT'
  ),
  'the Evidence planning source role is read-only and limited to classification columns'
);

select ok(
  not pg_catalog.has_schema_privilege('pando_evidence_planning_source', 'evidence', 'CREATE')
  and not pg_catalog.has_schema_privilege('pando_planning_worker', 'planning', 'CREATE'),
  'the migration leaves no CREATE privilege behind on the touched schemas'
);

select ok(
  pg_catalog.to_regclass('sessions.focus_sessions_workspace_terminal_ended') is not null
  and exists (
    select 1 from pg_catalog.pg_indexes
    where schemaname = 'sessions'
      and indexname = 'focus_sessions_workspace_terminal_ended'
      and indexdef like '%WHERE (state = ANY (%completed%stopped%'
  ),
  'the forward migration installs the bounded terminal-session access path'
);

select ok(
  pg_catalog.to_regprocedure(
    'planning.load_plan_snapshot_source_bundle_pre_evidence_claim_v1(uuid,timestamptz)'
  ) is not null
  and pg_catalog.to_regprocedure(
    'planning.load_plan_snapshot_source_bundle_v1(uuid,timestamptz)'
  ) is not null
  and pg_catalog.to_regprocedure(
    'evidence.read_planning_completed_work_source_v2(uuid,uuid[],timestamptz)'
  ) is not null,
  'the forward upgrade retains the private legacy implementation behind the hardened v1 wrapper'
);

-- Isolate this scenario from seed-owned Planning wake-ups.
update outbox.deliveries
set delivery_state = 'succeeded', completed_at = clock_timestamp(),
  lease_token = null, lease_expires_at = null
where consumer_name = 'planning.plan_snapshot_v1'
  and delivery_state <> 'succeeded';

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '2c000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'planning-work@pando.test', '', clock_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  clock_timestamp(), clock_timestamp()
), (
  '2c000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
  'planning-work-other@pando.test', '', clock_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  clock_timestamp(), clock_timestamp()
);

create temporary table work_results (
  result_name text primary key,
  response jsonb not null
);
grant select, insert, update on work_results to authenticated, service_role;
grant select, insert on work_results to pando_planning_api, pando_planning_worker;

-- The worker role is revoked at the end of its migration, so this transaction grants itself the
-- SET membership it needs to exercise the owner-query boundary. The grant is rolled back with the
-- rest of the test.
do $roles$
begin
  execute pg_catalog.format(
    'grant pando_planning_worker to %I with set true', current_user
  );
end
$roles$;

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '2c000000-0000-4000-8000-000000000001',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text,
  true
);
set local role authenticated;
insert into work_results values (
  'bootstrap', api.bootstrap_personal_workspace('phase4a-work', 'Planning Work')
);
insert into work_results
select 'goal', api.create_readiness_goal(
  (select (response->>'workspace_id')::uuid from work_results where result_name = 'bootstrap'),
  'goal:planning-work', 'Planning completed-work goal',
  'target:nvidia-python-verification-base-v1', 'phase4a-work-goal'
);
insert into work_results values (
  'plan', api.initialize_growth_plan_v1(
    'goal:planning-work', 300, 25, 80, 60, 'phase4a-work-plan'
  )
);
insert into work_results values (
  'overlay', api.add_current_custom_activity_v1(
    'goal:planning-work', 'activity:planning-work-debug',
    'Debug a Python failure', 'MANUAL_CODING', 'competency:python-error-handling',
    '0', 'phase4a-work-overlay'
  )
);
insert into work_results values (
  'admission', api.add_learning_track_activity_v1(
    (select response->>'learningTrackKey' from work_results where result_name = 'plan'),
    'activity:planning-work-debug', 25, '1', 'phase4a-work-admission', 'MEDIUM'
  )
);
insert into work_results values (
  'focus-start', api.start_focus_activity_v1(
    'goal:planning-work', 'activity:planning-work-debug', 25::smallint, 'phase4a-work-focus'
  )
);
insert into work_results
select 'focus-finish', api.finish_focus_activity_v1(
  (select (response->>'focusSessionId')::uuid from work_results where result_name = 'focus-start'),
  1, 'COMPLETE', 'OBSERVED_SUCCESS', false, 'phase4a-work-finish'
);
reset role;

-- A second workspace proves the owner queries never cross a tenant boundary.
select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '2c000000-0000-4000-8000-000000000002',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text,
  true
);
set local role authenticated;
insert into work_results values (
  'other-bootstrap', api.bootstrap_personal_workspace('phase4a-work-other', 'Other Work')
);
insert into work_results
select 'other-goal', api.create_readiness_goal(
  (select (response->>'workspace_id')::uuid from work_results
   where result_name = 'other-bootstrap'),
  'goal:planning-work-other', 'Other completed-work goal',
  'target:nvidia-python-verification-base-v1', 'phase4a-work-other-goal'
);
insert into work_results values (
  'other-overlay', api.add_current_custom_activity_v1(
    'goal:planning-work-other', 'activity:planning-work-other',
    'Read about sockets', 'READING', 'competency:python-error-handling',
    '0', 'phase4a-work-other-overlay'
  )
);
insert into work_results values (
  'other-focus-start', api.start_focus_activity_v1(
    'goal:planning-work-other', 'activity:planning-work-other', 30::smallint,
    'phase4a-work-other-focus'
  )
);
insert into work_results
select 'other-focus-finish', api.finish_focus_activity_v1(
  (select (response->>'focusSessionId')::uuid from work_results
   where result_name = 'other-focus-start'),
  1, 'STOP', null, null, 'phase4a-work-other-finish'
);
reset role;

select set_config('request.jwt.claims', null, true);

-- The Sessions owner query returns exactly one terminal session for the first workspace.
set local role pando_planning_worker;
insert into work_results
select 'calendar', identity.read_planning_calendar_source_v1(
  (select (response->>'workspaceId')::uuid from work_results where result_name = 'plan'),
  clock_timestamp()
);
insert into work_results
select 'work-source', sessions.read_planning_completed_work_source_v1(
  (select (response->>'workspaceId')::uuid from work_results where result_name = 'plan'),
  least(
    (select (response->>'weekStart')::timestamptz from work_results where result_name = 'calendar'),
    clock_timestamp() - interval '168 hours'
  ),
  clock_timestamp()
);
reset role;

select is(
  (select pg_catalog.jsonb_array_length(response->'sessions')
   from work_results where result_name = 'work-source'),
  1,
  'the Sessions completed-work source returns only this workspace terminal session'
);
select is(
  (select response#>>'{sessions,0,focusSessionId}' from work_results where result_name = 'work-source'),
  (select response->>'focusSessionId' from work_results where result_name = 'focus-start'),
  'the returned terminal session is the completed Focus Session'
);
select is(
  (select response#>>'{sessions,0,state}' from work_results where result_name = 'work-source'),
  'COMPLETED',
  'a completed Focus Session is reported as completed work'
);
select is(
  (select (response#>>'{sessions,0,plannedMinutes}')::integer
   from work_results where result_name = 'work-source'),
  25,
  'the planned bound of the counted duration comes from the Sessions owner'
);
select ok(
  (select response->>'revision' from work_results where result_name = 'work-source')
    like 'completed-work:%',
  'the completed-work source publishes its own fence'
);

-- Evidence answers only attempt terminality and non-invalidated observation existence.
insert into work_results values (
  'evidence-claim', pg_catalog.jsonb_build_object('asOf', clock_timestamp())
);
set local role pando_planning_worker;
insert into work_results
select 'evidence-source', evidence.read_planning_completed_work_source_v2(
  (select (response->>'workspaceId')::uuid from work_results where result_name = 'plan'),
  array[(select (response->>'focusSessionId')::uuid from work_results
         where result_name = 'focus-start')],
  (select (response->>'asOf')::timestamptz from work_results where result_name = 'evidence-claim')
);
reset role;

select is(
  (select response#>>'{items,0,attemptTerminal}' from work_results where result_name = 'evidence-source'),
  'true',
  'Evidence confirms the attempt reached a terminal state'
);
select is(
  (select response#>>'{items,0,evidenceBearing}' from work_results where result_name = 'evidence-source'),
  'true',
  'an observed success makes the session evidence bearing'
);
select ok(
  (select response::text from work_results where result_name = 'evidence-source')
    not like '%competency%'
  and (select response::text from work_results where result_name = 'evidence-source')
    not like '%INDEPENDENT%'
  and (select response::text from work_results where result_name = 'evidence-source')
    not like '%outcome%',
  'Evidence returns no observation body, competency reference, outcome, or engagement'
);

-- A stopped session is terminal history that never becomes evidence-bearing work.
set local role pando_planning_worker;
insert into work_results
select 'other-evidence-source', evidence.read_planning_completed_work_source_v2(
  (select (response->>'workspace_id')::uuid from work_results where result_name = 'other-bootstrap'),
  array[(select (response->>'focusSessionId')::uuid from work_results
         where result_name = 'other-focus-start')],
  clock_timestamp()
);
reset role;

select is(
  (select response#>>'{items,0,evidenceBearing}'
   from work_results where result_name = 'other-evidence-source'),
  'false',
  'a stopped Focus Session never carries normalized evidence'
);

-- Invalidating the observation withdraws cadence credit through the same fence.
select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '2c000000-0000-4000-8000-000000000001',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text,
  true
);
set local role authenticated;
insert into work_results
select 'invalidate', api.invalidate_evidence_v1(
  (select (response->>'evidenceId')::uuid from work_results where result_name = 'focus-finish'),
  'Recorded the wrong activity result.', 'phase4a-work-invalidate'
);
reset role;
select set_config('request.jwt.claims', null, true);

set local role pando_planning_worker;
insert into work_results
select 'evidence-after', evidence.read_planning_completed_work_source_v2(
  (select (response->>'workspaceId')::uuid from work_results where result_name = 'plan'),
  array[(select (response->>'focusSessionId')::uuid from work_results
         where result_name = 'focus-start')],
  clock_timestamp()
);
insert into work_results
select 'evidence-at-old-claim', evidence.read_planning_completed_work_source_v2(
  (select (response->>'workspaceId')::uuid from work_results where result_name = 'plan'),
  array[(select (response->>'focusSessionId')::uuid from work_results
         where result_name = 'focus-start')],
  (select (response->>'asOf')::timestamptz from work_results where result_name = 'evidence-claim')
);
reset role;

select is(
  (select response#>>'{items,0,evidenceBearing}' from work_results where result_name = 'evidence-after'),
  'false',
  'an invalidated observation removes the evidence-bearing classification'
);
select is(
  (select response#>>'{items,0,evidenceBearing}'
   from work_results where result_name = 'evidence-at-old-claim'),
  'true',
  'Evidence classification is bounded by the persisted claim clock'
);
select is(
  (select response->>'revision' from work_results where result_name = 'evidence-at-old-claim'),
  (select response->>'revision' from work_results where result_name = 'evidence-source'),
  'post-claim invalidation cannot alter the old-claim classification fence'
);
select isnt(
  (select response->>'revision' from work_results where result_name = 'evidence-after'),
  (select response->>'revision' from work_results where result_name = 'evidence-source'),
  'the Evidence ledger fence advances when a correction lands'
);

-- Unknown or duplicate identifiers are refused rather than silently dropped.
set local role pando_planning_worker;
select throws_ok(
  pg_catalog.format(
    'select evidence.read_planning_completed_work_source_v2(%L::uuid, array[%L::uuid], %L::timestamptz)',
    (select response->>'workspaceId' from work_results where result_name = 'plan'),
    '2c000000-0000-4000-8000-000000000099',
    clock_timestamp()
  ),
  '22023',
  'planning Evidence source is not authoritative',
  'Evidence refuses to answer about a Focus session it does not own'
);
reset role;

set local role pando_planning_worker;
select throws_ok(
  pg_catalog.format(
    'select evidence.read_planning_completed_work_source_v2(%L::uuid, array[%L::uuid], %L::timestamptz)',
    (select response->>'workspaceId' from work_results where result_name = 'plan'),
    (select response->>'focusSessionId' from work_results where result_name = 'other-focus-start'),
    clock_timestamp()
  ),
  '22023',
  'planning Evidence source is not authoritative',
  'Evidence never answers across a workspace boundary'
);
reset role;

set local role pando_planning_worker;
select throws_ok(
  pg_catalog.format(
    'select evidence.read_planning_completed_work_source_v2(%L::uuid, array[%L::uuid, %L::uuid], %L::timestamptz)',
    (select response->>'workspaceId' from work_results where result_name = 'plan'),
    (select response->>'focusSessionId' from work_results where result_name = 'focus-start'),
    (select response->>'focusSessionId' from work_results where result_name = 'focus-start'),
    clock_timestamp()
  ),
  '22023',
  'planning Evidence source input is invalid',
  'Evidence refuses a duplicated Focus session request'
);
reset role;

-- The source bundle carries both new sources, one claim clock, and a covering window.
set local role pando_planning_worker;
insert into work_results
select 'bundle', planning.load_plan_snapshot_source_bundle_v1(
  (select (response->>'workspaceId')::uuid from work_results where result_name = 'plan'),
  clock_timestamp()
);
reset role;

select ok(
  (select response#>'{completedWork,sessions}' from work_results where result_name = 'bundle')
    is not null
  and (select response#>'{evidence,items}' from work_results where result_name = 'bundle')
    is not null
  and (select response#>'{focus,terminalCount}' from work_results where result_name = 'bundle')
    is not null,
  'the bundle exposes both completed-work sources and preserves the rollout compatibility field'
);
select ok(
  (select (response#>>'{completedWork,windowStart}')::timestamptz
   from work_results where result_name = 'bundle')
  <= least(
    (select (response#>>'{calendar,weekStart}')::timestamptz
     from work_results where result_name = 'bundle'),
    (select (response->>'claimAsOf')::timestamptz from work_results where result_name = 'bundle')
      - interval '168 hours'
  ),
  'the completed-work window covers both the plan week and the 168-hour repetition horizon'
);
select is(
  (select pg_catalog.jsonb_array_length(response#>'{completedWork,sessions}')
   from work_results where result_name = 'bundle'),
  (select pg_catalog.jsonb_array_length(response#>'{evidence,items}')
   from work_results where result_name = 'bundle'),
  'every terminal session in the bundle has exactly one Evidence answer'
);

-- A session that ends after the persisted claim clock belongs to the next calculation.
set local role pando_planning_worker;
insert into work_results
select 'work-source-before', sessions.read_planning_completed_work_source_v1(
  (select (response->>'workspaceId')::uuid from work_results where result_name = 'plan'),
  least(
    (select (response->>'weekStart')::timestamptz from work_results where result_name = 'calendar'),
    clock_timestamp() - interval '168 hours'
  ),
  (select (response->>'weekStart')::timestamptz from work_results where result_name = 'calendar')
);
reset role;

select is(
  (select pg_catalog.jsonb_array_length(response->'sessions')
   from work_results where result_name = 'work-source-before'),
  0,
  'the Sessions source never reports work that ended after its claim clock'
);

-- The source refuses to truncate an oversized window instead of under-reporting consumed capacity.
insert into sessions.focus_sessions (
  focus_session_id, workspace_id, user_id, readiness_goal_key, custom_activity_id,
  activity_key, activity_title, activity_type, target_competency_ref, state, planned_minutes,
  aggregate_version, started_at, ended_at
)
select
  pg_catalog.gen_random_uuid(), template.workspace_id, template.user_id,
  template.readiness_goal_key, template.custom_activity_id, template.activity_key,
  template.activity_title, template.activity_type, template.target_competency_ref,
  'completed', 5, 2,
  clock_timestamp() - interval '20 minutes', clock_timestamp() - interval '15 minutes'
from sessions.focus_sessions as template, pg_catalog.generate_series(1, 500)
where template.focus_session_id = (
  select (response->>'focusSessionId')::uuid from work_results where result_name = 'focus-start'
);

set local role pando_planning_worker;
select throws_ok(
  pg_catalog.format(
    'select sessions.read_planning_completed_work_source_v1(%L::uuid, %L::timestamptz, %L::timestamptz)',
    (select response->>'workspaceId' from work_results where result_name = 'plan'),
    (select response->>'weekStart' from work_results where result_name = 'calendar'),
    clock_timestamp()
  ),
  '54000',
  'planning completed-work source exceeds 500 sessions',
  'an oversized completed-work window is refused rather than truncated'
);
reset role;

select finish();
rollback;
