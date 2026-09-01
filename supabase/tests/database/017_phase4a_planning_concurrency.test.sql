begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set local search_path = public, extensions;

create function public.pgtap_initialize_growth_plan_fixture_v1(
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
revoke all on function public.pgtap_initialize_growth_plan_fixture_v1(
  text, integer, integer, integer, integer, text
) from public, anon, authenticated, service_role;
grant execute on function public.pgtap_initialize_growth_plan_fixture_v1(
  text, integer, integer, integer, integer, text
) to authenticated;

create temporary table planning_concurrency_users (
  case_name text primary key,
  auth_user_id uuid not null,
  workspace_id uuid,
  claims text not null
) on commit preserve rows;
create temporary table planning_concurrency_connection (
  connection_role text primary key,
  connection_password text not null
) on commit preserve rows;
create temporary table planning_concurrency_bootstrap (
  case_name text primary key,
  response jsonb not null
) on commit preserve rows;
create temporary table planning_concurrency_goal (
  case_name text primary key,
  response jsonb not null
) on commit preserve rows;
grant select on planning_concurrency_users to authenticated;
grant select, insert on planning_concurrency_bootstrap, planning_concurrency_goal
  to authenticated;

insert into planning_concurrency_users values
  (
    'same-key',
    '27000000-0000-4000-8000-000000000001',
    null,
    pg_catalog.jsonb_build_object(
      'sub', '27000000-0000-4000-8000-000000000001',
      'role', 'authenticated', 'aud', 'authenticated',
      'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
    )::text
  ),
  (
    'different-keys',
    '27000000-0000-4000-8000-000000000002',
    null,
    pg_catalog.jsonb_build_object(
      'sub', '27000000-0000-4000-8000-000000000002',
      'role', 'authenticated', 'aud', 'authenticated',
      'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
    )::text
  );
insert into planning_concurrency_connection
values (
  'pando_pgtap_plan_' || left(replace(gen_random_uuid()::text, '-', ''), 16),
  gen_random_uuid()::text
);

do $create_dblink_role$
declare
  fixture record;
begin
  select * into strict fixture from planning_concurrency_connection;
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
  case_name || '-planning-concurrency@pando.test', '', clock_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  clock_timestamp(), clock_timestamp()
from planning_concurrency_users;

select set_config(
  'request.jwt.claims',
  (select claims from planning_concurrency_users where case_name = 'same-key'),
  true
);
set local role authenticated;
insert into planning_concurrency_bootstrap
select 'same-key', api.bootstrap_personal_workspace(
  'phase4a-planning-concurrency-same', 'Planning concurrency same key'
);
insert into planning_concurrency_goal
select 'same-key', api.create_readiness_goal(
  (select (response->>'workspace_id')::uuid from planning_concurrency_bootstrap
   where case_name = 'same-key'),
  'goal:planning-concurrency-same', 'Planning concurrency same key',
  'target:nvidia-python-verification-base-v1',
  'phase4a-planning-concurrency-same-goal'
);
reset role;

select set_config(
  'request.jwt.claims',
  (select claims from planning_concurrency_users where case_name = 'different-keys'),
  true
);
set local role authenticated;
insert into planning_concurrency_bootstrap
select 'different-keys', api.bootstrap_personal_workspace(
  'phase4a-planning-concurrency-different', 'Planning concurrency different keys'
);
insert into planning_concurrency_goal
select 'different-keys', api.create_readiness_goal(
  (select (response->>'workspace_id')::uuid from planning_concurrency_bootstrap
   where case_name = 'different-keys'),
  'goal:planning-concurrency-different', 'Planning concurrency different keys',
  'target:nvidia-python-verification-base-v1',
  'phase4a-planning-concurrency-different-goal'
);
reset role;

update planning_concurrency_users as fixture
set workspace_id = (bootstrap.response->>'workspace_id')::uuid
from planning_concurrency_bootstrap as bootstrap
where bootstrap.case_name = fixture.case_name;
commit;

begin;
set local search_path = public, extensions;
select no_plan();

create temporary table planning_concurrency_results (
  case_name text not null,
  caller text not null,
  response jsonb not null,
  primary key (case_name, caller)
);
create temporary table planning_concurrency_observations (
  case_name text primary key,
  waited_on_advisory_lock boolean not null
);
create temporary table planning_concurrency_errors (
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
      message = 'Planning concurrency test requires a non-loopback password-authenticated connection';
  end if;
end
$assert_password_route$;

select is(
  extensions.dblink_connect(
    'planning_c1',
    pg_catalog.format(
      'hostaddr=%s port=%s dbname=%L user=%L password=%L application_name=pando_pgtap_planning_c1',
      host(inet_server_addr()), current_setting('port'), current_database(),
      (select connection_role from planning_concurrency_connection),
      (select connection_password from planning_concurrency_connection)
    )
  ),
  'OK',
  'first independent Planning session connects'
);
select is(
  extensions.dblink_connect(
    'planning_c2',
    pg_catalog.format(
      'hostaddr=%s port=%s dbname=%L user=%L password=%L application_name=pando_pgtap_planning_c2',
      host(inet_server_addr()), current_setting('port'), current_database(),
      (select connection_role from planning_concurrency_connection),
      (select connection_password from planning_concurrency_connection)
    )
  ),
  'OK',
  'second independent Planning session connects'
);

select is(
  extensions.dblink_exec(
    connection_name,
    pg_catalog.format(
      'set request.jwt.claims = %L',
      (select claims from planning_concurrency_users where case_name = 'same-key')
    )
  ),
  'SET',
  connection_name || ' receives the same-key authenticated subject'
)
from unnest(array['planning_c1', 'planning_c2']) as connection(connection_name);
select is(
  extensions.dblink_exec(connection_name, 'set role authenticated'),
  'SET',
  connection_name || ' uses the authenticated role'
)
from unnest(array['planning_c1', 'planning_c2']) as connection(connection_name);
select is(
  extensions.dblink_exec(connection_name, 'begin'),
  'BEGIN',
  connection_name || ' begins the same-key transaction'
)
from unnest(array['planning_c1', 'planning_c2']) as connection(connection_name);

insert into planning_concurrency_results
select 'same-key', 'c1', command.response
from extensions.dblink(
  'planning_c1',
  $$select public.pgtap_initialize_growth_plan_fixture_v1(
    'goal:planning-concurrency-same', 600, 45, 80, 120,
    'phase4a-planning-concurrency-same-init'
  )$$
) as command(response jsonb);

select is(
  extensions.dblink_send_query(
    'planning_c2',
    $$select public.pgtap_initialize_growth_plan_fixture_v1(
      'goal:planning-concurrency-same', 600, 45, 80, 120,
      'phase4a-planning-concurrency-same-init'
    )$$
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
      where application_name = 'pando_pgtap_planning_c2'
        and wait_event_type = 'Lock' and wait_event = 'advisory'
    ) into observed;
    exit when observed;
    perform pg_catalog.pg_sleep(0.01);
  end loop;
  insert into planning_concurrency_observations values ('same-key', observed);
end
$wait_same_key$;

select ok(
  (select waited_on_advisory_lock from planning_concurrency_observations
   where case_name = 'same-key'),
  'the identical retry waits on the idempotency advisory lock'
);
select is(
  extensions.dblink_exec('planning_c1', 'commit'),
  'COMMIT',
  'the first identical caller commits'
);
insert into planning_concurrency_results
select 'same-key', 'c2', command.response
from extensions.dblink_get_result('planning_c2') as command(response jsonb);
select is(
  (select count(*) from extensions.dblink_get_result('planning_c2') as command(response jsonb)),
  0::bigint,
  'the identical retry result stream is drained'
);
select is(
  extensions.dblink_exec('planning_c2', 'commit'),
  'COMMIT',
  'the replay transaction commits'
);
select is(
  (select response from planning_concurrency_results
   where case_name = 'same-key' and caller = 'c2'),
  (select response from planning_concurrency_results
   where case_name = 'same-key' and caller = 'c1'),
  'concurrent identical callers receive the exact stored response'
);

select is(
  extensions.dblink_exec(
    connection_name,
    pg_catalog.format(
      'set request.jwt.claims = %L',
      (select claims from planning_concurrency_users where case_name = 'different-keys')
    )
  ),
  'SET',
  connection_name || ' receives the different-key authenticated subject'
)
from unnest(array['planning_c1', 'planning_c2']) as connection(connection_name);
select is(
  extensions.dblink_exec(connection_name, 'begin'),
  'BEGIN',
  connection_name || ' begins the different-key transaction'
)
from unnest(array['planning_c1', 'planning_c2']) as connection(connection_name);

insert into planning_concurrency_results
select 'different-keys', 'c1', command.response
from extensions.dblink(
  'planning_c1',
  $$select public.pgtap_initialize_growth_plan_fixture_v1(
    'goal:planning-concurrency-different', 480, 30, 70, 90,
    'phase4a-planning-concurrency-winner'
  )$$
) as command(response jsonb);

select is(
  extensions.dblink_send_query(
    'planning_c2',
    $$select public.pgtap_initialize_growth_plan_fixture_v1(
      'goal:planning-concurrency-different', 480, 30, 70, 90,
      'phase4a-planning-concurrency-loser'
    )$$
  ),
  1,
  'a different idempotency key is dispatched before the winner commits'
);

do $wait_different_keys$
declare
  observed boolean := false;
begin
  for attempt in 1..200 loop
    select exists (
      select 1 from pg_catalog.pg_stat_activity
      where application_name = 'pando_pgtap_planning_c2'
        and wait_event_type = 'Lock' and wait_event = 'advisory'
    ) into observed;
    exit when observed;
    perform pg_catalog.pg_sleep(0.01);
  end loop;
  insert into planning_concurrency_observations values ('different-keys', observed);
end
$wait_different_keys$;

select ok(
  (select waited_on_advisory_lock from planning_concurrency_observations
   where case_name = 'different-keys'),
  'different keys serialize on the shared Planning workspace lock'
);
select is(
  extensions.dblink_exec('planning_c1', 'commit'),
  'COMMIT',
  'the different-key winner commits'
);

do $collect_loser_error$
declare
  v_state text;
  v_message text;
begin
  begin
    perform command.response
    from extensions.dblink_get_result('planning_c2') as command(response jsonb);
  exception
    when others then
      get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
  end;
  perform count(*)
  from extensions.dblink_get_result('planning_c2') as command(response jsonb);
  insert into planning_concurrency_errors
  values ('different-keys', v_state, v_message);
end
$collect_loser_error$;

select is(
  extensions.dblink_exec('planning_c2', 'rollback'),
  'ROLLBACK',
  'the losing different-key transaction is rolled back'
);
select is(
  (select returned_state from planning_concurrency_errors where case_name = 'different-keys'),
  '23505',
  'the losing different-key caller receives the defined current-plan conflict'
);
select ok(
  (select returned_message like '%a current Growth Plan already exists%'
   from planning_concurrency_errors where case_name = 'different-keys'),
  'the losing different-key conflict is explicit'
);

select is(
  extensions.dblink_disconnect(connection_name),
  'OK',
  connection_name || ' disconnects cleanly'
)
from unnest(array['planning_c1', 'planning_c2']) as connection(connection_name);

select is(
  (select count(*)::bigint from planning.growth_plans
   where workspace_id = (select workspace_id from planning_concurrency_users
                         where case_name = expected.case_name)),
  1::bigint,
  expected.case_name || ' concurrency creates exactly one Growth Plan'
)
from (values ('same-key'), ('different-keys')) as expected(case_name);
select is(
  (select count(*)::bigint from planning.learning_tracks
   where workspace_id = (select workspace_id from planning_concurrency_users
                         where case_name = expected.case_name)),
  1::bigint,
  expected.case_name || ' concurrency creates exactly one Learning Track'
)
from (values ('same-key'), ('different-keys')) as expected(case_name);
select is(
  (select count(*)::bigint from planning.current_plan_snapshots
   where workspace_id = (select workspace_id from planning_concurrency_users
                         where case_name = expected.case_name)),
  1::bigint,
  expected.case_name || ' concurrency creates exactly one pointer sentinel'
)
from (values ('same-key'), ('different-keys')) as expected(case_name);
select is(
  (select count(*)::bigint from outbox.command_receipts
   where workspace_id = (select workspace_id from planning_concurrency_users
                         where case_name = expected.case_name)
     and command_type = 'planning.initialize_growth_plan'),
  1::bigint,
  expected.case_name || ' concurrency creates exactly one command receipt'
)
from (values ('same-key'), ('different-keys')) as expected(case_name);
select is(
  (select count(*)::bigint from outbox.events
   where workspace_id = (select workspace_id from planning_concurrency_users
                         where case_name = expected.case_name)
     and event_name = 'planning.input_changed'),
  1::bigint,
  expected.case_name || ' concurrency emits exactly one Planning event'
)
from (values ('same-key'), ('different-keys')) as expected(case_name);
select is(
  (select count(*)::bigint from outbox.deliveries
   where workspace_id = (select workspace_id from planning_concurrency_users
                         where case_name = expected.case_name)
     and consumer_name = 'planning.plan_snapshot_v1'),
  1::bigint,
  expected.case_name || ' concurrency creates exactly one Planning delivery'
)
from (values ('same-key'), ('different-keys')) as expected(case_name);
select is(
  (select count(*)::bigint from outbox.command_receipts
   where idempotency_key = 'phase4a-' || 'planning-concurrency-loser'),
  0::bigint,
  'the losing different-key caller leaves no receipt'
);

select * from finish();
commit;

drop function public.pgtap_initialize_growth_plan_fixture_v1(
  text, integer, integer, integer, integer, text
);

do $drop_dblink_role$
declare
  v_connection_role text;
begin
  select connection_role into strict v_connection_role
  from planning_concurrency_connection;
  execute pg_catalog.format('drop role %I', v_connection_role);
end
$drop_dblink_role$;
