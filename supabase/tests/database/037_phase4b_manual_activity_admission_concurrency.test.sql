begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set local search_path = public, extensions;

create function pg_temp.initialize_growth_plan_fixture_v1(
  p_readiness_goal_key text,
  p_idempotency_key text
)
returns jsonb
language sql
security definer
set search_path = ''
as $function$
  select api.initialize_growth_plan_v1(
    p_readiness_goal_key, 600, 45, 80, 120, p_idempotency_key
  )
$function$;
revoke all on function pg_temp.initialize_growth_plan_fixture_v1(text, text)
  from public, anon, authenticated, service_role;
grant execute on function pg_temp.initialize_growth_plan_fixture_v1(text, text)
  to authenticated;

create temporary table manual_admission_concurrency_users (
  case_name text primary key,
  auth_user_id uuid not null,
  workspace_id uuid,
  claims text not null
) on commit preserve rows;
create temporary table manual_admission_concurrency_connection (
  connection_role text primary key,
  connection_password text not null
) on commit preserve rows;
create temporary table manual_admission_concurrency_results (
  result_name text primary key,
  response jsonb not null
) on commit preserve rows;
grant select on manual_admission_concurrency_users, manual_admission_concurrency_results
  to authenticated;
grant insert on manual_admission_concurrency_results to authenticated;

insert into manual_admission_concurrency_users values
  (
    'same-key', '37000000-0000-4000-8000-000000000001', null,
    pg_catalog.jsonb_build_object(
      'sub', '37000000-0000-4000-8000-000000000001',
      'role', 'authenticated', 'aud', 'authenticated',
      'exp', extract(epoch from pg_catalog.clock_timestamp() + interval '1 hour')::bigint
    )::text
  ),
  (
    'distinct-previews', '37000000-0000-4000-8000-000000000002', null,
    pg_catalog.jsonb_build_object(
      'sub', '37000000-0000-4000-8000-000000000002',
      'role', 'authenticated', 'aud', 'authenticated',
      'exp', extract(epoch from pg_catalog.clock_timestamp() + interval '1 hour')::bigint
    )::text
  );
insert into manual_admission_concurrency_connection values (
  'pando_pgtap_manual_' || pg_catalog.left(pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', ''), 16),
  pg_catalog.gen_random_uuid()::text
);

do $create_dblink_role$
declare
  fixture record;
begin
  select * into strict fixture from manual_admission_concurrency_connection;
  execute pg_catalog.format(
    'create role %I login noinherit password %L',
    fixture.connection_role, fixture.connection_password
  );
  execute pg_catalog.format('grant authenticated to %I', fixture.connection_role);
end
$create_dblink_role$;

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select auth_user_id, 'authenticated', 'authenticated',
  case_name || '-manual-admission-concurrency@pando.test', '', pg_catalog.clock_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
from manual_admission_concurrency_users;

select set_config(
  'request.jwt.claims',
  (select claims from manual_admission_concurrency_users where case_name = 'same-key'),
  true
);
set local role authenticated;
insert into manual_admission_concurrency_results values (
  'same-bootstrap', api.bootstrap_personal_workspace(
    'manual-admission-concurrency-same', 'Manual admission same key'
  )
);
insert into manual_admission_concurrency_results
select 'same-goal', api.create_readiness_goal(
  (select (response->>'workspace_id')::uuid from manual_admission_concurrency_results
   where result_name = 'same-bootstrap'),
  'goal:manual-admission-same', 'Manual admission same key',
  'target:nvidia-python-verification-base-v1', 'manual-admission-same-goal'
);
insert into manual_admission_concurrency_results values (
  'same-plan', pg_temp.initialize_growth_plan_fixture_v1(
    'goal:manual-admission-same', 'manual-admission-same-plan'
  )
);
insert into manual_admission_concurrency_results values (
  'same-activity', api.add_current_custom_activity_v1(
    'goal:manual-admission-same', 'activity:manual-admission-same',
    'Same-key activity', 'PROJECT', 'competency:python-error-handling',
    '0', 'manual-admission-same-activity'
  )
);
insert into manual_admission_concurrency_results values (
  'same-source', api.get_learning_track_activity_admission_source_v1()
);
insert into manual_admission_concurrency_results
select 'same-preview', api.preview_learning_track_activity_admission_v1(
  'activity:manual-admission-same', 45, 'MEDIUM',
  (select response#>>'{growthPlan,aggregateVersion}'
   from manual_admission_concurrency_results where result_name = 'same-source'),
  (select response#>>'{learningTrack,aggregateVersion}'
   from manual_admission_concurrency_results where result_name = 'same-source'),
  'Apply the same preview concurrently.',
  '11000000-0000-4000-8000-000000000001'
);
reset role;

select set_config(
  'request.jwt.claims',
  (select claims from manual_admission_concurrency_users where case_name = 'distinct-previews'),
  true
);
set local role authenticated;
insert into manual_admission_concurrency_results values (
  'distinct-bootstrap', api.bootstrap_personal_workspace(
    'manual-admission-concurrency-distinct', 'Manual admission distinct previews'
  )
);
insert into manual_admission_concurrency_results
select 'distinct-goal', api.create_readiness_goal(
  (select (response->>'workspace_id')::uuid from manual_admission_concurrency_results
   where result_name = 'distinct-bootstrap'),
  'goal:manual-admission-distinct', 'Manual admission distinct previews',
  'target:nvidia-python-verification-base-v1', 'manual-admission-distinct-goal'
);
insert into manual_admission_concurrency_results values (
  'distinct-plan', pg_temp.initialize_growth_plan_fixture_v1(
    'goal:manual-admission-distinct', 'manual-admission-distinct-plan'
  )
);
insert into manual_admission_concurrency_results values
  (
    'distinct-activity-a', api.add_current_custom_activity_v1(
      'goal:manual-admission-distinct', 'activity:manual-admission-distinct-a',
      'Distinct activity A', 'PROJECT', 'competency:python-error-handling',
      '0', 'manual-admission-distinct-activity-a'
    )
  ),
  (
    'distinct-activity-b', api.add_current_custom_activity_v1(
      'goal:manual-admission-distinct', 'activity:manual-admission-distinct-b',
      'Distinct activity B', 'READING', 'competency:python-error-handling',
      '1', 'manual-admission-distinct-activity-b'
    )
  );
insert into manual_admission_concurrency_results values (
  'distinct-source', api.get_learning_track_activity_admission_source_v1()
);
insert into manual_admission_concurrency_results
select 'distinct-preview-a', api.preview_learning_track_activity_admission_v1(
  'activity:manual-admission-distinct-a', 45, 'MEDIUM',
  (select response#>>'{growthPlan,aggregateVersion}'
   from manual_admission_concurrency_results where result_name = 'distinct-source'),
  (select response#>>'{learningTrack,aggregateVersion}'
   from manual_admission_concurrency_results where result_name = 'distinct-source'),
  'Apply winner preview.', '12000000-0000-4000-8000-000000000001'
);
insert into manual_admission_concurrency_results
select 'distinct-preview-b', api.preview_learning_track_activity_admission_v1(
  'activity:manual-admission-distinct-b', 30, 'LOW',
  (select response#>>'{growthPlan,aggregateVersion}'
   from manual_admission_concurrency_results where result_name = 'distinct-source'),
  (select response#>>'{learningTrack,aggregateVersion}'
   from manual_admission_concurrency_results where result_name = 'distinct-source'),
  'Apply losing preview.', '12000000-0000-4000-8000-000000000002'
);
reset role;

update manual_admission_concurrency_users as fixture
set workspace_id = (result.response->>'workspace_id')::uuid
from manual_admission_concurrency_results as result
where result.result_name = case fixture.case_name
  when 'same-key' then 'same-bootstrap'
  else 'distinct-bootstrap'
end;
commit;

begin;
set local search_path = public, extensions;
select no_plan();

create temporary table manual_admission_concurrency_commands (
  case_name text not null,
  caller text not null,
  response jsonb not null,
  primary key (case_name, caller)
);
create temporary table manual_admission_concurrency_observations (
  case_name text primary key,
  waited_on_advisory_lock boolean not null
);
create temporary table manual_admission_concurrency_errors (
  case_name text primary key,
  returned_state text,
  returned_message text
);

do $assert_password_route$
begin
  if pg_catalog.inet_server_addr() is null
     or pg_catalog.inet_server_addr() << inet '127.0.0.0/8'
     or pg_catalog.inet_server_addr() = inet '::1' then
    raise exception using errcode = '08001',
      message = 'manual admission concurrency test requires a non-loopback password connection';
  end if;
end
$assert_password_route$;

select is(
  extensions.dblink_connect(
    'manual_admission_c1',
    pg_catalog.format(
      'hostaddr=%s port=%s dbname=%L user=%L password=%L application_name=pando_pgtap_manual_c1',
      pg_catalog.host(pg_catalog.inet_server_addr()), pg_catalog.current_setting('port'),
      pg_catalog.current_database(),
      (select connection_role from manual_admission_concurrency_connection),
      (select connection_password from manual_admission_concurrency_connection)
    )
  ),
  'OK', 'first independent manual-admission session connects'
);
select is(
  extensions.dblink_connect(
    'manual_admission_c2',
    pg_catalog.format(
      'hostaddr=%s port=%s dbname=%L user=%L password=%L application_name=pando_pgtap_manual_c2',
      pg_catalog.host(pg_catalog.inet_server_addr()), pg_catalog.current_setting('port'),
      pg_catalog.current_database(),
      (select connection_role from manual_admission_concurrency_connection),
      (select connection_password from manual_admission_concurrency_connection)
    )
  ),
  'OK', 'second independent manual-admission session connects'
);

select is(
  extensions.dblink_exec(
    connection_name,
    pg_catalog.format(
      'set request.jwt.claims = %L',
      (select claims from manual_admission_concurrency_users where case_name = 'same-key')
    )
  ),
  'SET', connection_name || ' receives same-key claims'
)
from unnest(array['manual_admission_c1', 'manual_admission_c2']) as connection(connection_name);
select is(
  extensions.dblink_exec(connection_name, 'set role authenticated'),
  'SET', connection_name || ' uses the authenticated role'
)
from unnest(array['manual_admission_c1', 'manual_admission_c2']) as connection(connection_name);
select is(
  extensions.dblink_exec(connection_name, 'begin'),
  'BEGIN', connection_name || ' begins the same-key transaction'
)
from unnest(array['manual_admission_c1', 'manual_admission_c2']) as connection(connection_name);

insert into manual_admission_concurrency_commands
select 'same-key', 'c1', command.response
from extensions.dblink(
  'manual_admission_c1',
  pg_catalog.format(
    'select api.apply_learning_track_activity_admission_v1(%L,45,%L,%L,%L,%L,%L,%L)',
    'activity:manual-admission-same', 'MEDIUM',
    (select response->>'expectedGrowthPlanVersion'
     from manual_admission_concurrency_results where result_name = 'same-preview'),
    (select response->>'expectedLearningTrackVersion'
     from manual_admission_concurrency_results where result_name = 'same-preview'),
    'Apply the same preview concurrently.',
    '11000000-0000-4000-8000-000000000001',
    (select response->>'previewDigest'
     from manual_admission_concurrency_results where result_name = 'same-preview')
  )
) as command(response jsonb);
select is(
  extensions.dblink_send_query(
    'manual_admission_c2',
    pg_catalog.format(
      'select api.apply_learning_track_activity_admission_v1(%L,45,%L,%L,%L,%L,%L,%L)',
      'activity:manual-admission-same', 'MEDIUM',
      (select response->>'expectedGrowthPlanVersion'
       from manual_admission_concurrency_results where result_name = 'same-preview'),
      (select response->>'expectedLearningTrackVersion'
       from manual_admission_concurrency_results where result_name = 'same-preview'),
      'Apply the same preview concurrently.',
      '11000000-0000-4000-8000-000000000001',
      (select response->>'previewDigest'
       from manual_admission_concurrency_results where result_name = 'same-preview')
    )
  ),
  1, 'identical exact confirmation is dispatched before the winner commits'
);
do $wait_same_key$
declare
  observed boolean := false;
begin
  for attempt in 1..200 loop
    select exists (
      select 1 from pg_catalog.pg_stat_activity
      where application_name = 'pando_pgtap_manual_c2'
        and wait_event_type = 'Lock' and wait_event = 'advisory'
    ) into observed;
    exit when observed;
    perform pg_catalog.pg_sleep(0.01);
  end loop;
  insert into manual_admission_concurrency_observations values ('same-key', observed);
end
$wait_same_key$;
select ok(
  (select waited_on_advisory_lock from manual_admission_concurrency_observations
   where case_name = 'same-key'),
  'identical confirmation waits on the idempotency advisory lock'
);
select is(
  extensions.dblink_exec('manual_admission_c1', 'commit'),
  'COMMIT', 'same-key winner commits'
);
insert into manual_admission_concurrency_commands
select 'same-key', 'c2', command.response
from extensions.dblink_get_result('manual_admission_c2') as command(response jsonb);
select is(
  (select count(*) from extensions.dblink_get_result('manual_admission_c2')
   as command(response jsonb)),
  0::bigint, 'same-key replay stream is drained'
);
select is(
  extensions.dblink_exec('manual_admission_c2', 'commit'),
  'COMMIT', 'same-key replay commits'
);
select is(
  (select response from manual_admission_concurrency_commands
   where case_name = 'same-key' and caller = 'c2'),
  (select response from manual_admission_concurrency_commands
   where case_name = 'same-key' and caller = 'c1'),
  'concurrent identical confirmations return the byte-identical stored response'
);

select is(
  extensions.dblink_exec(
    connection_name,
    pg_catalog.format(
      'set request.jwt.claims = %L',
      (select claims from manual_admission_concurrency_users
       where case_name = 'distinct-previews')
    )
  ),
  'SET', connection_name || ' receives distinct-preview claims'
)
from unnest(array['manual_admission_c1', 'manual_admission_c2']) as connection(connection_name);
select is(
  extensions.dblink_exec(connection_name, 'begin'),
  'BEGIN', connection_name || ' begins the distinct-preview transaction'
)
from unnest(array['manual_admission_c1', 'manual_admission_c2']) as connection(connection_name);

insert into manual_admission_concurrency_commands
select 'distinct-previews', 'c1', command.response
from extensions.dblink(
  'manual_admission_c1',
  pg_catalog.format(
    'select api.apply_learning_track_activity_admission_v1(%L,45,%L,%L,%L,%L,%L,%L)',
    'activity:manual-admission-distinct-a', 'MEDIUM',
    (select response->>'expectedGrowthPlanVersion'
     from manual_admission_concurrency_results where result_name = 'distinct-preview-a'),
    (select response->>'expectedLearningTrackVersion'
     from manual_admission_concurrency_results where result_name = 'distinct-preview-a'),
    'Apply winner preview.', '12000000-0000-4000-8000-000000000001',
    (select response->>'previewDigest'
     from manual_admission_concurrency_results where result_name = 'distinct-preview-a')
  )
) as command(response jsonb);
select is(
  extensions.dblink_send_query(
    'manual_admission_c2',
    pg_catalog.format(
      'select api.apply_learning_track_activity_admission_v1(%L,30,%L,%L,%L,%L,%L,%L)',
      'activity:manual-admission-distinct-b', 'LOW',
      (select response->>'expectedGrowthPlanVersion'
       from manual_admission_concurrency_results where result_name = 'distinct-preview-b'),
      (select response->>'expectedLearningTrackVersion'
       from manual_admission_concurrency_results where result_name = 'distinct-preview-b'),
      'Apply losing preview.', '12000000-0000-4000-8000-000000000002',
      (select response->>'previewDigest'
       from manual_admission_concurrency_results where result_name = 'distinct-preview-b')
    )
  ),
  1, 'second exact preview is dispatched before the winner commits'
);
do $wait_distinct_preview$
declare
  observed boolean := false;
begin
  for attempt in 1..200 loop
    select exists (
      select 1 from pg_catalog.pg_stat_activity
      where application_name = 'pando_pgtap_manual_c2'
        and wait_event_type = 'Lock' and wait_event = 'advisory'
    ) into observed;
    exit when observed;
    perform pg_catalog.pg_sleep(0.01);
  end loop;
  insert into manual_admission_concurrency_observations values ('distinct-previews', observed);
end
$wait_distinct_preview$;
select ok(
  (select waited_on_advisory_lock from manual_admission_concurrency_observations
   where case_name = 'distinct-previews'),
  'distinct confirmations serialize on the shared Planning workspace lock'
);
select is(
  extensions.dblink_exec('manual_admission_c1', 'commit'),
  'COMMIT', 'distinct-preview winner commits'
);
do $collect_stale_preview_error$
declare
  v_state text;
  v_message text;
begin
  begin
    perform command.response
    from extensions.dblink_get_result('manual_admission_c2') as command(response jsonb);
  exception
    when others then
      get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
  end;
  perform count(*)
  from extensions.dblink_get_result('manual_admission_c2') as command(response jsonb);
  insert into manual_admission_concurrency_errors
  values ('distinct-previews', v_state, v_message);
end
$collect_stale_preview_error$;
select is(
  extensions.dblink_exec('manual_admission_c2', 'rollback'),
  'ROLLBACK', 'stale exact-preview transaction rolls back'
);
select is(
  (select returned_state from manual_admission_concurrency_errors
   where case_name = 'distinct-previews'),
  '40001', 'losing exact preview receives optimistic-concurrency SQLSTATE'
);
select is(
  (select returned_message from manual_admission_concurrency_errors
   where case_name = 'distinct-previews'),
  'activity admission preview is stale', 'losing exact preview is explicitly stale'
);

select is(
  extensions.dblink_disconnect(connection_name),
  'OK', connection_name || ' disconnects cleanly'
)
from unnest(array['manual_admission_c1', 'manual_admission_c2']) as connection(connection_name);

select is(
  (select count(*) from planning.learning_track_activities
   where workspace_id = fixture.workspace_id),
  1::bigint, fixture.case_name || ' commits exactly one attribution'
)
from manual_admission_concurrency_users as fixture;
select is(
  (select aggregate_version from planning.learning_tracks
   where workspace_id = fixture.workspace_id),
  2::bigint, fixture.case_name || ' increments the Track once'
)
from manual_admission_concurrency_users as fixture;
select is(
  (select aggregate_version from planning.growth_plans
   where workspace_id = fixture.workspace_id),
  1::bigint, fixture.case_name || ' leaves the Growth Plan version unchanged'
)
from manual_admission_concurrency_users as fixture;
select is(
  (select count(*) from outbox.command_receipts
   where workspace_id = fixture.workspace_id
     and command_type = 'planning.add_learning_track_activity_v2'),
  1::bigint, fixture.case_name || ' commits exactly one v2 receipt'
)
from manual_admission_concurrency_users as fixture;
select is(
  (select count(*) from outbox.events
   where workspace_id = fixture.workspace_id
     and event_name = 'planning.input_changed'
     and payload->>'change_kind' = 'TRACK_ACTIVITY_ADMITTED'),
  1::bigint, fixture.case_name || ' emits exactly one admission event'
)
from manual_admission_concurrency_users as fixture;
select is(
  (select count(*) from outbox.deliveries as delivery
   join outbox.events as event on event.event_id = delivery.event_id
   where delivery.workspace_id = fixture.workspace_id
     and delivery.consumer_name = 'planning.plan_snapshot_v1'
     and event.payload->>'change_kind' = 'TRACK_ACTIVITY_ADMITTED'),
  1::bigint, fixture.case_name || ' creates exactly one fixed Planning delivery'
)
from manual_admission_concurrency_users as fixture;
select is(
  (select pointer_version from planning.current_plan_snapshots
   where workspace_id = fixture.workspace_id),
  0::bigint, fixture.case_name || ' leaves the current snapshot pointer unchanged'
)
from manual_admission_concurrency_users as fixture;
select is(
  (select count(*) from outbox.command_receipts
   where idempotency_key =
     'learning-track-activity-admission:v2:12000000-0000-4000-8000-000000000002'),
  0::bigint, 'the stale loser leaves no command receipt'
);
select is(
  (select candidate_key from planning.learning_track_activities
   where workspace_id = (
     select workspace_id from manual_admission_concurrency_users
     where case_name = 'distinct-previews'
   )),
  'candidate:12000000-0000-4000-8000-000000000001',
  'the deterministic winner candidate is the only distinct-preview survivor'
);

select set_config(
  'request.jwt.claims',
  (select claims from manual_admission_concurrency_users where case_name = 'distinct-previews'),
  true
);
set local role authenticated;
insert into manual_admission_concurrency_results values (
  'distinct-source-after', api.get_learning_track_activity_admission_source_v1()
);
reset role;
select ok(
  (select response->>'state' = 'READY'
    and pg_catalog.jsonb_array_length(response->'activities') = 1
    and response#>>'{activities,0,activityKey}' = 'activity:manual-admission-distinct-b'
   from manual_admission_concurrency_results where result_name = 'distinct-source-after'),
  'the source keeps only the losing activity eligible after the winner commits'
);

select * from finish();
commit;

do $drop_dblink_role$
declare
  v_connection_role text;
begin
  select connection_role into strict v_connection_role
  from manual_admission_concurrency_connection;
  execute pg_catalog.format('drop role %I', v_connection_role);
end
$drop_dblink_role$;
