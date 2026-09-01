begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
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

create temporary table admission_concurrency_users (
  case_name text primary key,
  auth_user_id uuid not null,
  workspace_id uuid,
  claims text not null
) on commit preserve rows;
create temporary table admission_concurrency_connection (
  connection_role text primary key,
  connection_password text not null
) on commit preserve rows;
create temporary table admission_concurrency_results (
  result_name text primary key,
  response jsonb not null
) on commit preserve rows;
grant select on admission_concurrency_users, admission_concurrency_results to authenticated;
grant insert on admission_concurrency_results to authenticated;

insert into admission_concurrency_users values
  (
    'same-key',
    '29000000-0000-4000-8000-000000000001',
    null,
    pg_catalog.jsonb_build_object(
      'sub', '29000000-0000-4000-8000-000000000001',
      'role', 'authenticated', 'aud', 'authenticated',
      'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
    )::text
  ),
  (
    'stale-version',
    '29000000-0000-4000-8000-000000000002',
    null,
    pg_catalog.jsonb_build_object(
      'sub', '29000000-0000-4000-8000-000000000002',
      'role', 'authenticated', 'aud', 'authenticated',
      'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
    )::text
  );
insert into admission_concurrency_connection
values (
  'pando_pgtap_admit_' || left(replace(gen_random_uuid()::text, '-', ''), 16),
  gen_random_uuid()::text
);

do $create_dblink_role$
declare
  fixture record;
begin
  select * into strict fixture from admission_concurrency_connection;
  execute pg_catalog.format(
    'create role %I login noinherit password %L',
    fixture.connection_role,
    fixture.connection_password
  );
  execute pg_catalog.format('grant authenticated to %I', fixture.connection_role);
end
$create_dblink_role$;

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select auth_user_id, 'authenticated', 'authenticated',
  case_name || '-admission-concurrency@pando.test', '', clock_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  clock_timestamp(), clock_timestamp()
from admission_concurrency_users;

select set_config(
  'request.jwt.claims',
  (select claims from admission_concurrency_users where case_name = 'same-key'),
  true
);
set local role authenticated;
insert into admission_concurrency_results values (
  'same-bootstrap',
  api.bootstrap_personal_workspace(
    'phase4a-admission-concurrency-same', 'Admission concurrency same key'
  )
);
insert into admission_concurrency_results
select 'same-goal', api.create_readiness_goal(
  (select (response->>'workspace_id')::uuid from admission_concurrency_results
   where result_name = 'same-bootstrap'),
  'goal:admission-concurrency-same', 'Admission concurrency same key',
  'target:nvidia-python-verification-base-v1',
  'phase4a-admission-concurrency-same-goal'
);
insert into admission_concurrency_results values (
  'same-plan',
  pg_temp.initialize_growth_plan_fixture_v1(
    'goal:admission-concurrency-same', 600, 45, 80, 120,
    'phase4a-admission-concurrency-same-plan'
  )
);
insert into admission_concurrency_results values (
  'same-overlay',
  api.add_current_custom_activity_v1(
    'goal:admission-concurrency-same', 'activity:admission-concurrency-same',
    'Same-key concurrent activity', 'PROJECT', 'competency:python-error-handling',
    '0', 'phase4a-admission-concurrency-same-overlay'
  )
);
reset role;

select set_config(
  'request.jwt.claims',
  (select claims from admission_concurrency_users where case_name = 'stale-version'),
  true
);
set local role authenticated;
insert into admission_concurrency_results values (
  'stale-bootstrap',
  api.bootstrap_personal_workspace(
    'phase4a-admission-concurrency-stale', 'Admission concurrency stale version'
  )
);
insert into admission_concurrency_results
select 'stale-goal', api.create_readiness_goal(
  (select (response->>'workspace_id')::uuid from admission_concurrency_results
   where result_name = 'stale-bootstrap'),
  'goal:admission-concurrency-stale', 'Admission concurrency stale version',
  'target:nvidia-python-verification-base-v1',
  'phase4a-admission-concurrency-stale-goal'
);
insert into admission_concurrency_results values (
  'stale-plan',
  pg_temp.initialize_growth_plan_fixture_v1(
    'goal:admission-concurrency-stale', 600, 45, 80, 120,
    'phase4a-admission-concurrency-stale-plan'
  )
);
insert into admission_concurrency_results values (
  'stale-overlay-first',
  api.add_current_custom_activity_v1(
    'goal:admission-concurrency-stale', 'activity:admission-concurrency-stale-first',
    'First stale-version activity', 'PROJECT', 'competency:python-error-handling',
    '0', 'phase4a-admission-concurrency-stale-overlay-first'
  )
);
insert into admission_concurrency_results values (
  'stale-overlay-second',
  api.add_current_custom_activity_v1(
    'goal:admission-concurrency-stale', 'activity:admission-concurrency-stale-second',
    'Second stale-version activity', 'PROJECT', 'competency:python-error-handling',
    '1', 'phase4a-admission-concurrency-stale-overlay-second'
  )
);
reset role;

update admission_concurrency_users as fixture
set workspace_id = (result.response->>'workspace_id')::uuid
from admission_concurrency_results as result
where result.result_name = case fixture.case_name
  when 'same-key' then 'same-bootstrap'
  else 'stale-bootstrap'
end;
commit;

begin;
set local search_path = public, extensions;
select no_plan();

create temporary table admission_concurrency_commands (
  case_name text not null,
  caller text not null,
  response jsonb not null,
  primary key (case_name, caller)
);
create temporary table admission_concurrency_observations (
  case_name text primary key,
  waited_on_advisory_lock boolean not null
);
create temporary table admission_concurrency_errors (
  case_name text primary key,
  returned_state text,
  returned_message text
);

do $assert_password_route$
declare
  v_server_addr inet := inet_server_addr();
begin
  if v_server_addr is null
     or v_server_addr << inet '127.0.0.0/8'
     or v_server_addr = inet '::1' then
    raise exception using
      errcode = '08001',
      message = 'admission concurrency test requires a non-loopback password connection';
  end if;
end
$assert_password_route$;

select is(
  extensions.dblink_connect(
    'admission_c1',
    pg_catalog.format(
      'hostaddr=%s port=%s dbname=%L user=%L password=%L application_name=pando_pgtap_admission_c1',
      host(inet_server_addr()), current_setting('port'), current_database(),
      (select connection_role from admission_concurrency_connection),
      (select connection_password from admission_concurrency_connection)
    )
  ),
  'OK',
  'first independent admission session connects'
);
select is(
  extensions.dblink_connect(
    'admission_c2',
    pg_catalog.format(
      'hostaddr=%s port=%s dbname=%L user=%L password=%L application_name=pando_pgtap_admission_c2',
      host(inet_server_addr()), current_setting('port'), current_database(),
      (select connection_role from admission_concurrency_connection),
      (select connection_password from admission_concurrency_connection)
    )
  ),
  'OK',
  'second independent admission session connects'
);

select is(
  extensions.dblink_exec(
    connection_name,
    pg_catalog.format(
      'set request.jwt.claims = %L',
      (select claims from admission_concurrency_users where case_name = 'same-key')
    )
  ),
  'SET',
  connection_name || ' receives same-key claims'
)
from unnest(array['admission_c1', 'admission_c2']) as connection(connection_name);
select is(
  extensions.dblink_exec(connection_name, 'set role authenticated'),
  'SET',
  connection_name || ' uses the authenticated role'
)
from unnest(array['admission_c1', 'admission_c2']) as connection(connection_name);
select is(
  extensions.dblink_exec(connection_name, 'begin'),
  'BEGIN',
  connection_name || ' begins the same-key transaction'
)
from unnest(array['admission_c1', 'admission_c2']) as connection(connection_name);

insert into admission_concurrency_commands
select 'same-key', 'c1', command.response
from extensions.dblink(
  'admission_c1',
  pg_catalog.format(
    'select pando_test.add_learning_track_activity_fixture_v1(%L,%L,45,%L,%L,null)',
    (select response->>'learningTrackKey' from admission_concurrency_results
     where result_name = 'same-plan'),
    'activity:admission-concurrency-same', '1',
    'phase4a-admission-concurrency-same-command'
  )
) as command(response jsonb);

select is(
  extensions.dblink_send_query(
    'admission_c2',
    pg_catalog.format(
      'select pando_test.add_learning_track_activity_fixture_v1(%L,%L,45,%L,%L,null)',
      (select response->>'learningTrackKey' from admission_concurrency_results
       where result_name = 'same-plan'),
      'activity:admission-concurrency-same', '1',
      'phase4a-admission-concurrency-same-command'
    )
  ),
  1,
  'the identical retry is dispatched before the first transaction commits'
);

do $wait_same_key$
declare
  observed boolean := false;
begin
  for attempt in 1..200 loop
    select exists (
      select 1 from pg_catalog.pg_stat_activity
      where application_name = 'pando_pgtap_admission_c2'
        and wait_event_type = 'Lock' and wait_event = 'advisory'
    ) into observed;
    exit when observed;
    perform pg_catalog.pg_sleep(0.01);
  end loop;
  insert into admission_concurrency_observations values ('same-key', observed);
end
$wait_same_key$;

select ok(
  (select waited_on_advisory_lock from admission_concurrency_observations
   where case_name = 'same-key'),
  'the identical retry waits on the idempotency advisory lock'
);
select is(
  extensions.dblink_exec('admission_c1', 'commit'),
  'COMMIT',
  'the first identical caller commits'
);
insert into admission_concurrency_commands
select 'same-key', 'c2', command.response
from extensions.dblink_get_result('admission_c2') as command(response jsonb);
select is(
  (select count(*) from extensions.dblink_get_result('admission_c2') as command(response jsonb)),
  0::bigint,
  'the identical retry result stream is drained'
);
select is(
  extensions.dblink_exec('admission_c2', 'commit'),
  'COMMIT',
  'the replay transaction commits'
);
select is(
  (select response from admission_concurrency_commands
   where case_name = 'same-key' and caller = 'c2'),
  (select response from admission_concurrency_commands
   where case_name = 'same-key' and caller = 'c1'),
  'concurrent identical callers receive the exact stored response'
);

select is(
  extensions.dblink_exec(
    connection_name,
    pg_catalog.format(
      'set request.jwt.claims = %L',
      (select claims from admission_concurrency_users where case_name = 'stale-version')
    )
  ),
  'SET',
  connection_name || ' receives stale-version claims'
)
from unnest(array['admission_c1', 'admission_c2']) as connection(connection_name);
select is(
  extensions.dblink_exec(connection_name, 'begin'),
  'BEGIN',
  connection_name || ' begins the stale-version transaction'
)
from unnest(array['admission_c1', 'admission_c2']) as connection(connection_name);

insert into admission_concurrency_commands
select 'stale-version', 'c1', command.response
from extensions.dblink(
  'admission_c1',
  pg_catalog.format(
    'select pando_test.add_learning_track_activity_fixture_v1(%L,%L,45,%L,%L,%L)',
    (select response->>'learningTrackKey' from admission_concurrency_results
     where result_name = 'stale-plan'),
    'activity:admission-concurrency-stale-first', '1',
    'phase4a-admission-concurrency-stale-winner', 'MEDIUM'
  )
) as command(response jsonb);

select is(
  extensions.dblink_send_query(
    'admission_c2',
    pg_catalog.format(
      'select pando_test.add_learning_track_activity_fixture_v1(%L,%L,30,%L,%L,%L)',
      (select response->>'learningTrackKey' from admission_concurrency_results
       where result_name = 'stale-plan'),
      'activity:admission-concurrency-stale-second', '1',
      'test-test-test-test', 'LOW'
    )
  ),
  1,
  'a different activity with the same expected version is dispatched concurrently'
);

do $wait_stale_version$
declare
  observed boolean := false;
begin
  for attempt in 1..200 loop
    select exists (
      select 1 from pg_catalog.pg_stat_activity
      where application_name = 'pando_pgtap_admission_c2'
        and wait_event_type = 'Lock' and wait_event = 'advisory'
    ) into observed;
    exit when observed;
    perform pg_catalog.pg_sleep(0.01);
  end loop;
  insert into admission_concurrency_observations values ('stale-version', observed);
end
$wait_stale_version$;

select ok(
  (select waited_on_advisory_lock from admission_concurrency_observations
   where case_name = 'stale-version'),
  'different keys serialize on the shared Planning workspace lock'
);
select is(
  extensions.dblink_exec('admission_c1', 'commit'),
  'COMMIT',
  'the fresh-version winner commits'
);

do $collect_stale_error$
declare
  v_state text;
  v_message text;
begin
  begin
    perform command.response
    from extensions.dblink_get_result('admission_c2') as command(response jsonb);
  exception
    when others then
      get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
  end;
  perform count(*)
  from extensions.dblink_get_result('admission_c2') as command(response jsonb);
  insert into admission_concurrency_errors
  values ('stale-version', v_state, v_message);
end
$collect_stale_error$;

select is(
  extensions.dblink_exec('admission_c2', 'rollback'),
  'ROLLBACK',
  'the stale-version transaction rolls back'
);
select is(
  (select returned_state from admission_concurrency_errors where case_name = 'stale-version'),
  '40001',
  'the concurrent stale caller receives the optimistic concurrency state'
);
select is(
  (select returned_message from admission_concurrency_errors where case_name = 'stale-version'),
  'Learning Track aggregate version conflict',
  'the concurrent stale conflict is explicit'
);

select is(
  extensions.dblink_disconnect(connection_name),
  'OK',
  connection_name || ' disconnects cleanly'
)
from unnest(array['admission_c1', 'admission_c2']) as connection(connection_name);

select is(
  (
    select count(*)::bigint
    from planning.learning_track_activities
    where workspace_id = (
      select workspace_id from admission_concurrency_users
      where case_name = expected.case_name
    )
  ),
  1::bigint,
  expected.case_name || ' concurrency admits exactly one activity'
)
from (values ('same-key'), ('stale-version')) as expected(case_name);

select is(
  (
    select track.aggregate_version
    from planning.learning_tracks as track
    where track.workspace_id = (
      select workspace_id from admission_concurrency_users
      where case_name = expected.case_name
    )
  ),
  2::bigint,
  expected.case_name || ' concurrency increments the Track version exactly once'
)
from (values ('same-key'), ('stale-version')) as expected(case_name);

select is(
  (
    select count(*)::bigint
    from outbox.command_receipts
    where workspace_id = (
      select workspace_id from admission_concurrency_users
      where case_name = expected.case_name
    )
      and command_type = 'planning.add_learning_track_activity'
  ),
  1::bigint,
  expected.case_name || ' concurrency commits exactly one admission receipt'
)
from (values ('same-key'), ('stale-version')) as expected(case_name);

select is(
  (
    select count(*)::bigint
    from outbox.events
    where workspace_id = (
      select workspace_id from admission_concurrency_users
      where case_name = expected.case_name
    )
      and event_name = 'planning.input_changed'
      and aggregate_type = 'planning.learning_track'
  ),
  1::bigint,
  expected.case_name || ' concurrency emits exactly one Track input event'
)
from (values ('same-key'), ('stale-version')) as expected(case_name);

select is(
  (
    select count(*)::bigint
    from outbox.deliveries as delivery
    join outbox.events as event on event.event_id = delivery.event_id
    where delivery.workspace_id = (
      select workspace_id from admission_concurrency_users
      where case_name = expected.case_name
    )
      and delivery.consumer_name = 'planning.plan_snapshot_v1'
      and event.aggregate_type = 'planning.learning_track'
  ),
  1::bigint,
  expected.case_name || ' concurrency creates exactly one Track-triggered delivery'
)
from (values ('same-key'), ('stale-version')) as expected(case_name);

select is(
  (
    select pointer.pointer_version
    from planning.current_plan_snapshots as pointer
    where pointer.workspace_id = (
      select workspace_id from admission_concurrency_users
      where case_name = expected.case_name
    )
  ),
  0::bigint,
  expected.case_name || ' concurrency leaves the calculation pointer unchanged'
)
from (values ('same-key'), ('stale-version')) as expected(case_name);

select is(
  (
    select count(*)::bigint from outbox.command_receipts
    where idempotency_key = 'test-test-test-test'
  ),
  0::bigint,
  'the losing stale-version caller leaves no receipt'
);

select * from finish();
commit;

do $drop_dblink_role$
declare
  v_connection_role text;
begin
  select connection_role into strict v_connection_role
  from admission_concurrency_connection;
  execute pg_catalog.format('drop role %I', v_connection_role);
end
$drop_dblink_role$;
