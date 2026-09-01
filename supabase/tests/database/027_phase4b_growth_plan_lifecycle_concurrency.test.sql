begin;

create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set local search_path = public, extensions;

create temporary table lifecycle_concurrency_users (
  case_name text primary key,
  auth_user_id uuid not null,
  workspace_id uuid,
  claims text not null
) on commit preserve rows;
create temporary table lifecycle_concurrency_connection (
  connection_role text primary key,
  connection_password text not null
) on commit preserve rows;
create temporary table lifecycle_concurrency_results (
  case_name text not null,
  caller text not null,
  response jsonb not null,
  primary key (case_name, caller)
);
create temporary table lifecycle_concurrency_errors (
  case_name text primary key,
  returned_state text,
  returned_message text
);
create temporary table lifecycle_concurrency_observations (
  case_name text primary key,
  waited_on_advisory_lock boolean not null
);
grant select on lifecycle_concurrency_users to authenticated;
create temporary table lifecycle_concurrency_setup (
  case_name text primary key,
  response jsonb not null
) on commit preserve rows;
grant select, insert on lifecycle_concurrency_setup to authenticated;

insert into lifecycle_concurrency_users values
  (
    'same-key', 'd2000000-0000-4000-8000-000000000001', null,
    pg_catalog.jsonb_build_object(
      'sub', 'd2000000-0000-4000-8000-000000000001',
      'role', 'authenticated', 'aud', 'authenticated',
      'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
    )::text
  ),
  (
    'stale-version', 'd2000000-0000-4000-8000-000000000002', null,
    pg_catalog.jsonb_build_object(
      'sub', 'd2000000-0000-4000-8000-000000000002',
      'role', 'authenticated', 'aud', 'authenticated',
      'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
    )::text
  );
insert into lifecycle_concurrency_connection values (
  'pando_pgtap_lifecycle_' || left(replace(gen_random_uuid()::text, '-', ''), 16),
  gen_random_uuid()::text
);

do $create_dblink_role$
declare fixture record;
begin
  select * into strict fixture from lifecycle_concurrency_connection;
  execute pg_catalog.format(
    'create role %I login noinherit password %L', fixture.connection_role, fixture.connection_password
  );
  execute pg_catalog.format('grant authenticated to %I', fixture.connection_role);
end
$create_dblink_role$;

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select auth_user_id, 'authenticated', 'authenticated',
  case_name || '-lifecycle-concurrency@pando.test', '', clock_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  clock_timestamp(), clock_timestamp()
from lifecycle_concurrency_users;

-- Set up two independent personal Plans before opening real concurrent sessions.
select set_config('request.jwt.claims', (select claims from lifecycle_concurrency_users where case_name = 'same-key'), true);
set local role authenticated;
insert into lifecycle_concurrency_setup values (
  'same-bootstrap', api.bootstrap_personal_workspace(
    'phase4b-lifecycle-concurrency-same', 'Lifecycle concurrency same'
  )
);
insert into lifecycle_concurrency_setup
select 'same-goal', api.create_readiness_goal(
  (select (response->>'workspace_id')::uuid from lifecycle_concurrency_setup where case_name = 'same-bootstrap'),
  'goal:lifecycle-concurrency-same',
  'Lifecycle concurrency same', 'target:nvidia-python-verification-base-v1',
  'phase4b-lifecycle-concurrency-same-goal'
);
insert into lifecycle_concurrency_setup values ('same-plan', api.initialize_growth_plan_v1(
  'goal:lifecycle-concurrency-same', 300, 25, 80, 60, 'phase4b-lifecycle-concurrency-same-plan'
));
reset role;
select set_config('request.jwt.claims', (select claims from lifecycle_concurrency_users where case_name = 'stale-version'), true);
set local role authenticated;
insert into lifecycle_concurrency_setup values (
  'stale-bootstrap', api.bootstrap_personal_workspace(
    'phase4b-lifecycle-concurrency-stale', 'Lifecycle concurrency stale'
  )
);
insert into lifecycle_concurrency_setup
select 'stale-goal', api.create_readiness_goal(
  (select (response->>'workspace_id')::uuid from lifecycle_concurrency_setup where case_name = 'stale-bootstrap'),
  'goal:lifecycle-concurrency-stale',
  'Lifecycle concurrency stale', 'target:nvidia-python-verification-base-v1',
  'phase4b-lifecycle-concurrency-stale-goal'
);
insert into lifecycle_concurrency_setup values ('stale-plan', api.initialize_growth_plan_v1(
  'goal:lifecycle-concurrency-stale', 300, 25, 80, 60, 'phase4b-lifecycle-concurrency-stale-plan'
));
reset role;
update lifecycle_concurrency_users as fixture
set workspace_id = (setup.response->>'workspaceId')::uuid
from lifecycle_concurrency_setup as setup
where setup.case_name = case fixture.case_name
  when 'same-key' then 'same-plan'
  when 'stale-version' then 'stale-plan'
end;
commit;

begin;
set local search_path = public, extensions;
select no_plan();

do $assert_password_route$
declare v_server_addr inet := inet_server_addr();
begin
  if v_server_addr is null or v_server_addr << inet '127.0.0.0/8' or v_server_addr = inet '::1' then
    raise exception using errcode = '08001', message = 'Lifecycle concurrency test requires a non-loopback password-authenticated connection';
  end if;
end
$assert_password_route$;

select is(
  extensions.dblink_connect(
    connection_name,
    pg_catalog.format(
      'hostaddr=%s port=%s dbname=%L user=%L password=%L application_name=pando_pgtap_lifecycle_%s',
      host(inet_server_addr()), current_setting('port'), current_database(),
      (select connection_role from lifecycle_concurrency_connection),
      (select connection_password from lifecycle_concurrency_connection), connection_name
    )
  ), 'OK', connection_name || ' connects'
)
from unnest(array['lifecycle_c1', 'lifecycle_c2']) as connection(connection_name);

select is(
  extensions.dblink_exec(
    connection_name,
    pg_catalog.format('set request.jwt.claims = %L', (select claims from lifecycle_concurrency_users where case_name = 'same-key'))
  ), 'SET', connection_name || ' receives same-key actor claims'
)
from unnest(array['lifecycle_c1', 'lifecycle_c2']) as connection(connection_name);
select is(extensions.dblink_exec(connection_name, 'set role authenticated'), 'SET', connection_name || ' uses authenticated')
from unnest(array['lifecycle_c1', 'lifecycle_c2']) as connection(connection_name);
select is(extensions.dblink_exec(connection_name, 'begin'), 'BEGIN', connection_name || ' begins same-key transaction')
from unnest(array['lifecycle_c1', 'lifecycle_c2']) as connection(connection_name);

insert into lifecycle_concurrency_results
select 'same-key', 'c1', api_response.response
from extensions.dblink(
  'lifecycle_c1',
  $$select api.apply_growth_plan_lifecycle_v1(
    'pause_growth_plan', '1',
    (api.preview_growth_plan_lifecycle_v1('pause_growth_plan', '1', 'Pause concurrently.')->>'previewDigest'),
    'Pause concurrently.', 'phase4b-lifecycle-concurrent-same'
  )$$
) as api_response(response jsonb);
select is(
  extensions.dblink_send_query(
    'lifecycle_c2',
    $$select api.apply_growth_plan_lifecycle_v1(
      'pause_growth_plan', '1',
      (api.preview_growth_plan_lifecycle_v1('pause_growth_plan', '1', 'Pause concurrently.')->>'previewDigest'),
      'Pause concurrently.', 'phase4b-lifecycle-concurrent-same'
    )$$
  ), 1, 'same idempotency retry is dispatched before the first commit'
);

do $wait_same_key$
declare observed boolean := false;
begin
  for attempt in 1..200 loop
    select exists (
      select 1 from pg_catalog.pg_stat_activity
      where application_name = 'pando_pgtap_lifecycle_lifecycle_c2'
        and wait_event_type = 'Lock' and wait_event = 'advisory'
    ) into observed;
    exit when observed;
    perform pg_catalog.pg_sleep(0.01);
  end loop;
  insert into lifecycle_concurrency_observations values ('same-key', observed);
end
$wait_same_key$;
select ok((select waited_on_advisory_lock from lifecycle_concurrency_observations where case_name = 'same-key'),
  'same-key retry waits on the actor/idempotency lock');
select is(extensions.dblink_exec('lifecycle_c1', 'commit'), 'COMMIT', 'same-key winner commits');
insert into lifecycle_concurrency_results
select 'same-key', 'c2', api_response.response
from extensions.dblink_get_result('lifecycle_c2') as api_response(response jsonb);
select count(*)
from extensions.dblink_get_result('lifecycle_c2') as drained(response jsonb);
select is(extensions.dblink_exec('lifecycle_c2', 'commit'), 'COMMIT', 'same-key replay commits');
select is(
  (select response from lifecycle_concurrency_results where case_name = 'same-key' and caller = 'c2'),
  (select response from lifecycle_concurrency_results where case_name = 'same-key' and caller = 'c1'),
  'concurrent same-key callers receive the exact persisted response'
);

-- Different keys serialize on the workspace lock; the delayed old version must fail.
select is(
  extensions.dblink_exec(
    connection_name,
    pg_catalog.format('set request.jwt.claims = %L', (select claims from lifecycle_concurrency_users where case_name = 'stale-version'))
  ), 'SET', connection_name || ' receives stale-version actor claims'
)
from unnest(array['lifecycle_c1', 'lifecycle_c2']) as connection(connection_name);
select is(extensions.dblink_exec(connection_name, 'begin'), 'BEGIN', connection_name || ' begins stale-version transaction')
from unnest(array['lifecycle_c1', 'lifecycle_c2']) as connection(connection_name);
insert into lifecycle_concurrency_results
select 'stale-version', 'c1', api_response.response
from extensions.dblink(
  'lifecycle_c1',
  $$select api.apply_growth_plan_lifecycle_v1(
    'pause_growth_plan', '1',
    (api.preview_growth_plan_lifecycle_v1('pause_growth_plan', '1', 'Pause first.')->>'previewDigest'),
    'Pause first.', 'phase4b-lifecycle-concurrent-winner'
  )$$
) as api_response(response jsonb);
select is(
  extensions.dblink_send_query(
    'lifecycle_c2',
    $$select api.apply_growth_plan_lifecycle_v1(
      'pause_growth_plan', '1',
      (api.preview_growth_plan_lifecycle_v1('pause_growth_plan', '1', 'Pause second.')->>'previewDigest'),
      'Pause second.', 'phase4b-lifecycle-concurrent-loser'
    )$$
  ), 1, 'different-key stale caller is dispatched before the winner commits'
);
do $wait_stale_version$
declare observed boolean := false;
begin
  for attempt in 1..200 loop
    select exists (
      select 1 from pg_catalog.pg_stat_activity
      where application_name = 'pando_pgtap_lifecycle_lifecycle_c2'
        and wait_event_type = 'Lock' and wait_event = 'advisory'
    ) into observed;
    exit when observed;
    perform pg_catalog.pg_sleep(0.01);
  end loop;
  insert into lifecycle_concurrency_observations values ('stale-version', observed);
end
$wait_stale_version$;
select ok((select waited_on_advisory_lock from lifecycle_concurrency_observations where case_name = 'stale-version'),
  'different keys serialize on the shared Planning workspace lock');
select is(extensions.dblink_exec('lifecycle_c1', 'commit'), 'COMMIT', 'stale-version winner commits');
do $collect_stale_error$
declare v_state text; v_message text;
begin
  begin
    perform api_response.response from extensions.dblink_get_result('lifecycle_c2') as api_response(response jsonb);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
  end;
  perform count(*) from extensions.dblink_get_result('lifecycle_c2') as api_response(response jsonb);
  insert into lifecycle_concurrency_errors values ('stale-version', v_state, v_message);
end
$collect_stale_error$;
select is(extensions.dblink_exec('lifecycle_c2', 'rollback'), 'ROLLBACK', 'stale-version loser rolls back');
select is((select returned_state from lifecycle_concurrency_errors where case_name = 'stale-version'), '40001',
  'different-key delayed caller receives the optimistic concurrency state');
select is((select returned_message from lifecycle_concurrency_errors where case_name = 'stale-version'), 'Growth Plan version is stale',
  'different-key delayed caller gets the explicit stale version reason');

select is(extensions.dblink_disconnect(connection_name), 'OK', connection_name || ' disconnects cleanly')
from unnest(array['lifecycle_c1', 'lifecycle_c2']) as connection(connection_name);
select is(
  (select aggregate_version from planning.growth_plans where workspace_id = (
    select workspace_id from lifecycle_concurrency_users where case_name = 'same-key'
  )), 2::bigint, 'same-key concurrency increments the Plan version exactly once'
);
select is(
  (select count(*)::bigint from outbox.command_receipts
   where workspace_id = (select workspace_id from lifecycle_concurrency_users where case_name = 'same-key')
     and command_type = 'planning.change_growth_plan_lifecycle'),
  1::bigint, 'same-key concurrency persists one command receipt'
);
select is(
  (select aggregate_version from planning.growth_plans where workspace_id = (
    select workspace_id from lifecycle_concurrency_users where case_name = 'stale-version'
  )), 2::bigint, 'stale-version concurrency admits only the winner mutation'
);
select is(
  (select count(*)::bigint from outbox.command_receipts where idempotency_key = 'phase4b-lifecycle-concurrent-loser'),
  0::bigint, 'the stale losing command leaves no receipt'
);

select * from finish();
commit;

do $drop_dblink_role$
declare v_connection_role text;
begin
  select connection_role into strict v_connection_role from lifecycle_concurrency_connection;
  execute pg_catalog.format('drop role %I', v_connection_role);
end
$drop_dblink_role$;
