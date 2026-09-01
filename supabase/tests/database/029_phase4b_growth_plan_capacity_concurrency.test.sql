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

create temporary table capacity_concurrency_users (
  case_name text primary key,
  auth_user_id uuid not null,
  workspace_id uuid,
  growth_plan_id uuid,
  learning_track_id uuid,
  claims text not null
) on commit preserve rows;
create temporary table capacity_concurrency_connection (
  connection_role text primary key,
  connection_password text not null
) on commit preserve rows;
create temporary table capacity_concurrency_results (
  case_name text not null,
  caller text not null,
  response jsonb not null,
  primary key (case_name, caller)
);
create temporary table capacity_concurrency_errors (
  case_name text primary key,
  returned_state text,
  returned_message text
);
create temporary table capacity_concurrency_observations (
  case_name text primary key,
  waited_on_advisory_lock boolean not null
);
create temporary table capacity_concurrency_setup (
  case_name text primary key,
  response jsonb not null
) on commit preserve rows;
grant select on capacity_concurrency_users to authenticated;
grant select, insert on capacity_concurrency_setup to authenticated;

insert into capacity_concurrency_users values
  (
    'same-key', 'd4000000-0000-4000-8000-000000000001', null, null, null,
    pg_catalog.jsonb_build_object(
      'sub', 'd4000000-0000-4000-8000-000000000001',
      'role', 'authenticated', 'aud', 'authenticated',
      'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
    )::text
  ),
  (
    'stale-version', 'd4000000-0000-4000-8000-000000000002', null, null, null,
    pg_catalog.jsonb_build_object(
      'sub', 'd4000000-0000-4000-8000-000000000002',
      'role', 'authenticated', 'aud', 'authenticated',
      'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
    )::text
  ),
  (
    'fingerprint-race', 'd4000000-0000-4000-8000-000000000003', null, null, null,
    pg_catalog.jsonb_build_object(
      'sub', 'd4000000-0000-4000-8000-000000000003',
      'role', 'authenticated', 'aud', 'authenticated',
      'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
    )::text
  );
insert into capacity_concurrency_connection values (
  'pando_pgtap_capacity_' || left(replace(gen_random_uuid()::text, '-', ''), 16),
  gen_random_uuid()::text
);

do $create_dblink_role$
declare fixture record;
begin
  select * into strict fixture from capacity_concurrency_connection;
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
  case_name || '-capacity-concurrency@pando.test', '', clock_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  clock_timestamp(), clock_timestamp()
from capacity_concurrency_users;

-- Set up three independent personal Plans before opening real concurrent sessions.
do $setup_capacity_plans$
declare fixture record;
declare v_bootstrap jsonb;
declare v_goal jsonb;
declare v_plan jsonb;
begin
  for fixture in select * from capacity_concurrency_users order by case_name loop
    perform set_config('request.jwt.claims', fixture.claims, true);
    execute 'set local role authenticated';
    v_bootstrap := api.bootstrap_personal_workspace(
      'phase4b-capacity-concurrency-' || fixture.case_name,
      'Capacity concurrency ' || fixture.case_name
    );
    v_goal := api.create_readiness_goal(
      (v_bootstrap->>'workspace_id')::uuid,
      'goal:capacity-concurrency-' || fixture.case_name,
      'Capacity concurrency ' || fixture.case_name,
      'target:nvidia-python-verification-base-v1',
      'phase4b-capacity-concurrency-' || fixture.case_name || '-goal'
    );
    v_plan := pg_temp.initialize_growth_plan_fixture_v1(
      'goal:capacity-concurrency-' || fixture.case_name,
      300, 25, 80, 60,
      'phase4b-capacity-concurrency-' || fixture.case_name || '-plan'
    );
    execute 'reset role';
    insert into capacity_concurrency_setup values (fixture.case_name || '-plan', v_plan);
  end loop;
end
$setup_capacity_plans$;

update capacity_concurrency_users as fixture
set workspace_id = (setup.response->>'workspaceId')::uuid,
  growth_plan_id = (setup.response->>'growthPlanId')::uuid,
  learning_track_id = (
    select track.learning_track_id
    from planning.learning_tracks as track
    where track.workspace_id = (setup.response->>'workspaceId')::uuid
      and track.growth_plan_id = (setup.response->>'growthPlanId')::uuid
  )
from capacity_concurrency_setup as setup
where setup.case_name = fixture.case_name || '-plan';

-- Test-only privileged mutation takes the same Planning workspace lock as every owner command.
-- It lets this test move one Track constraint after preview without creating a production bypass.
create function public.capacity_track_constraint_race_for_test(
  p_workspace_id uuid,
  p_learning_track_id uuid,
  p_protected_minimum_minutes integer
)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('planning-workspace:' || p_workspace_id::text, 0)
  );
  update planning.learning_tracks
  set protected_minimum_minutes = p_protected_minimum_minutes,
    aggregate_version = aggregate_version + 1,
    updated_at = pg_catalog.clock_timestamp()
  where workspace_id = p_workspace_id
    and learning_track_id = p_learning_track_id;
  return 'constraint-changed';
end
$function$;
revoke all on function public.capacity_track_constraint_race_for_test(uuid, uuid, integer)
  from public, anon, service_role;
grant execute on function public.capacity_track_constraint_race_for_test(uuid, uuid, integer)
  to authenticated;

commit;

begin;
set local search_path = public, extensions;
select no_plan();

do $assert_password_route$
declare v_server_addr inet := inet_server_addr();
begin
  if v_server_addr is null or v_server_addr << inet '127.0.0.0/8' or v_server_addr = inet '::1' then
    raise exception using errcode = '08001', message = 'Capacity concurrency test requires a non-loopback password-authenticated connection';
  end if;
end
$assert_password_route$;

select is(
  extensions.dblink_connect(
    connection_name,
    pg_catalog.format(
      'hostaddr=%s port=%s dbname=%L user=%L password=%L application_name=pando_pgtap_capacity_%s',
      host(inet_server_addr()), current_setting('port'), current_database(),
      (select connection_role from capacity_concurrency_connection),
      (select connection_password from capacity_concurrency_connection), connection_name
    )
  ), 'OK', connection_name || ' connects'
)
from unnest(array['capacity_c1', 'capacity_c2']) as connection(connection_name);

-- Same-key retries serialize on the actor/idempotency lock and replay the committed response.
select is(
  extensions.dblink_exec(
    connection_name,
    pg_catalog.format(
      'set request.jwt.claims = %L',
      (select claims from capacity_concurrency_users where case_name = 'same-key')
    )
  ), 'SET', connection_name || ' receives same-key actor claims'
)
from unnest(array['capacity_c1', 'capacity_c2']) as connection(connection_name);
select is(extensions.dblink_exec(connection_name, 'set role authenticated'), 'SET', connection_name || ' uses authenticated')
from unnest(array['capacity_c1', 'capacity_c2']) as connection(connection_name);
select is(extensions.dblink_exec(connection_name, 'begin'), 'BEGIN', connection_name || ' begins same-key transaction')
from unnest(array['capacity_c1', 'capacity_c2']) as connection(connection_name);

insert into capacity_concurrency_results
select 'same-key', 'c1', api_response.response
from extensions.dblink(
  'capacity_c1',
  $$select api.apply_growth_plan_capacity_v1(
    200, '1',
    (api.preview_growth_plan_capacity_v1(200, '1', 'Change capacity concurrently.')->>'previewDigest'),
    'Change capacity concurrently.', 'phase4b-capacity-concurrent-same'
  )$$
) as api_response(response jsonb);
select is(
  extensions.dblink_send_query(
    'capacity_c2',
    $$select api.apply_growth_plan_capacity_v1(
      200, '1',
      (api.preview_growth_plan_capacity_v1(200, '1', 'Change capacity concurrently.')->>'previewDigest'),
      'Change capacity concurrently.', 'phase4b-capacity-concurrent-same'
    )$$
  ), 1, 'same idempotency retry is dispatched before the first commit'
);
do $wait_same_key$
declare observed boolean := false;
begin
  for attempt in 1..200 loop
    select exists (
      select 1 from pg_catalog.pg_stat_activity
      where application_name = 'pando_pgtap_capacity_capacity_c2'
        and wait_event_type = 'Lock' and wait_event = 'advisory'
    ) into observed;
    exit when observed;
    perform pg_catalog.pg_sleep(0.01);
  end loop;
  insert into capacity_concurrency_observations values ('same-key', observed);
end
$wait_same_key$;
select ok(
  (select waited_on_advisory_lock from capacity_concurrency_observations where case_name = 'same-key'),
  'same-key retry waits on the actor/idempotency advisory lock'
);
select is(extensions.dblink_exec('capacity_c1', 'commit'), 'COMMIT', 'same-key winner commits');
insert into capacity_concurrency_results
select 'same-key', 'c2', api_response.response
from extensions.dblink_get_result('capacity_c2') as api_response(response jsonb);
select count(*) from extensions.dblink_get_result('capacity_c2') as drained(response jsonb);
select is(extensions.dblink_exec('capacity_c2', 'commit'), 'COMMIT', 'same-key replay commits');
select is(
  (select response from capacity_concurrency_results where case_name = 'same-key' and caller = 'c2'),
  (select response from capacity_concurrency_results where case_name = 'same-key' and caller = 'c1'),
  'concurrent same-key callers receive the exact persisted response'
);

-- Different keys serialize on the workspace lock; only the first version can commit.
select is(
  extensions.dblink_exec(
    connection_name,
    pg_catalog.format(
      'set request.jwt.claims = %L',
      (select claims from capacity_concurrency_users where case_name = 'stale-version')
    )
  ), 'SET', connection_name || ' receives stale-version actor claims'
)
from unnest(array['capacity_c1', 'capacity_c2']) as connection(connection_name);
select is(extensions.dblink_exec(connection_name, 'begin'), 'BEGIN', connection_name || ' begins stale-version transaction')
from unnest(array['capacity_c1', 'capacity_c2']) as connection(connection_name);
insert into capacity_concurrency_results
select 'stale-version', 'c1', api_response.response
from extensions.dblink(
  'capacity_c1',
  $$select api.apply_growth_plan_capacity_v1(
    200, '1',
    (api.preview_growth_plan_capacity_v1(200, '1', 'First capacity change.')->>'previewDigest'),
    'First capacity change.', 'phase4b-capacity-concurrent-winner'
  )$$
) as api_response(response jsonb);
select is(
  extensions.dblink_send_query(
    'capacity_c2',
    $$select api.apply_growth_plan_capacity_v1(
      240, '1',
      (api.preview_growth_plan_capacity_v1(240, '1', 'Second capacity change.')->>'previewDigest'),
      'Second capacity change.', 'phase4b-capacity-concurrent-loser'
    )$$
  ), 1, 'different-key stale caller is dispatched before the winner commits'
);
do $wait_stale_version$
declare observed boolean := false;
begin
  for attempt in 1..200 loop
    select exists (
      select 1 from pg_catalog.pg_stat_activity
      where application_name = 'pando_pgtap_capacity_capacity_c2'
        and wait_event_type = 'Lock' and wait_event = 'advisory'
    ) into observed;
    exit when observed;
    perform pg_catalog.pg_sleep(0.01);
  end loop;
  insert into capacity_concurrency_observations values ('stale-version', observed);
end
$wait_stale_version$;
select ok(
  (select waited_on_advisory_lock from capacity_concurrency_observations where case_name = 'stale-version'),
  'different capacity keys serialize on the shared Planning workspace lock'
);
select is(extensions.dblink_exec('capacity_c1', 'commit'), 'COMMIT', 'stale-version winner commits');
do $collect_stale_error$
declare v_state text; v_message text;
begin
  begin
    perform api_response.response
    from extensions.dblink_get_result('capacity_c2') as api_response(response jsonb);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
  end;
  perform count(*) from extensions.dblink_get_result('capacity_c2') as api_response(response jsonb);
  insert into capacity_concurrency_errors values ('stale-version', v_state, v_message);
end
$collect_stale_error$;
select is(extensions.dblink_exec('capacity_c2', 'rollback'), 'ROLLBACK', 'stale-version loser rolls back');
select is(
  (select returned_state from capacity_concurrency_errors where case_name = 'stale-version'),
  '40001', 'different-key delayed caller receives the optimistic concurrency state'
);
select is(
  (select returned_message from capacity_concurrency_errors where case_name = 'stale-version'),
  'Growth Plan version is stale', 'different-key delayed caller receives the explicit stale reason'
);

-- A Track constraint committed while apply waits makes the exact old fingerprint/digest stale.
select set_config(
  'request.jwt.claims',
  (select claims from capacity_concurrency_users where case_name = 'fingerprint-race'),
  true
);
set local role authenticated;
insert into capacity_concurrency_setup values (
  'fingerprint-preview', api.preview_growth_plan_capacity_v1(
    200, '1', 'Apply after a possible Track change.'
  )
);
reset role;
select is(
  extensions.dblink_exec(
    connection_name,
    pg_catalog.format(
      'set request.jwt.claims = %L',
      (select claims from capacity_concurrency_users where case_name = 'fingerprint-race')
    )
  ), 'SET', connection_name || ' receives fingerprint-race actor claims'
)
from unnest(array['capacity_c1', 'capacity_c2']) as connection(connection_name);
select is(extensions.dblink_exec(connection_name, 'begin'), 'BEGIN', connection_name || ' begins fingerprint-race transaction')
from unnest(array['capacity_c1', 'capacity_c2']) as connection(connection_name);
select is(
  changed.result,
  'constraint-changed',
  'Track constraint change is staged while holding the Planning workspace lock'
)
from extensions.dblink(
  'capacity_c1',
  pg_catalog.format(
    'select public.capacity_track_constraint_race_for_test(%L::uuid,%L::uuid,80)',
    (select workspace_id from capacity_concurrency_users where case_name = 'fingerprint-race'),
    (select learning_track_id from capacity_concurrency_users where case_name = 'fingerprint-race')
  )
) as changed(result text);
select is(
  extensions.dblink_send_query(
    'capacity_c2',
    pg_catalog.format(
      'select api.apply_growth_plan_capacity_v1(200,%L,%L,%L,%L)',
      '1',
      (select response->>'previewDigest' from capacity_concurrency_setup where case_name = 'fingerprint-preview'),
      'Apply after a possible Track change.', 'phase4b-capacity-fingerprint-race'
    )
  ), 1, 'apply with the old fingerprint is dispatched before the Track change commits'
);
do $wait_fingerprint_race$
declare observed boolean := false;
begin
  for attempt in 1..200 loop
    select exists (
      select 1 from pg_catalog.pg_stat_activity
      where application_name = 'pando_pgtap_capacity_capacity_c2'
        and wait_event_type = 'Lock' and wait_event = 'advisory'
    ) into observed;
    exit when observed;
    perform pg_catalog.pg_sleep(0.01);
  end loop;
  insert into capacity_concurrency_observations values ('fingerprint-race', observed);
end
$wait_fingerprint_race$;
select ok(
  (select waited_on_advisory_lock from capacity_concurrency_observations where case_name = 'fingerprint-race'),
  'capacity apply waits behind the Track constraint workspace transaction'
);
select is(extensions.dblink_exec('capacity_c1', 'commit'), 'COMMIT', 'Track constraint change commits first');
do $collect_fingerprint_error$
declare v_state text; v_message text;
begin
  begin
    perform api_response.response
    from extensions.dblink_get_result('capacity_c2') as api_response(response jsonb);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
  end;
  perform count(*) from extensions.dblink_get_result('capacity_c2') as api_response(response jsonb);
  insert into capacity_concurrency_errors values ('fingerprint-race', v_state, v_message);
end
$collect_fingerprint_error$;
select is(extensions.dblink_exec('capacity_c2', 'rollback'), 'ROLLBACK', 'fingerprint-stale apply rolls back');
select is(
  (select returned_state from capacity_concurrency_errors where case_name = 'fingerprint-race'),
  '40001', 'changed Track constraint returns the stale preview SQL state'
);
select is(
  (select returned_message from capacity_concurrency_errors where case_name = 'fingerprint-race'),
  'Growth Plan preview is stale', 'changed Track constraint invalidates the exact preview digest'
);

select is(extensions.dblink_disconnect(connection_name), 'OK', connection_name || ' disconnects cleanly')
from unnest(array['capacity_c1', 'capacity_c2']) as connection(connection_name);
select is(
  (select aggregate_version from planning.growth_plans where workspace_id =
    (select workspace_id from capacity_concurrency_users where case_name = 'same-key')),
  2::bigint, 'same-key concurrency advances the Plan version exactly once'
);
select is(
  (select count(*)::bigint from outbox.command_receipts where workspace_id =
    (select workspace_id from capacity_concurrency_users where case_name = 'same-key')
    and command_type = 'planning.set_growth_plan_default_capacity'),
  1::bigint, 'same-key concurrency persists one capacity receipt'
);
select is(
  (select aggregate_version from planning.growth_plans where workspace_id =
    (select workspace_id from capacity_concurrency_users where case_name = 'stale-version')),
  2::bigint, 'different-key concurrency admits only the winner mutation'
);
select is(
  (select aggregate_version from planning.growth_plans where workspace_id =
    (select workspace_id from capacity_concurrency_users where case_name = 'fingerprint-race')),
  1::bigint, 'a changed Track fingerprint leaves the Growth Plan untouched'
);
select is(
  (select count(*)::bigint from outbox.command_receipts
   where idempotency_key in (
     'phase4b-capacity-concurrent-loser', 'phase4b-capacity-fingerprint-race'
   )),
  0::bigint, 'both losing concurrent attempts leave no command receipt'
);

select * from finish();
commit;

drop function public.capacity_track_constraint_race_for_test(uuid, uuid, integer);

do $drop_dblink_role$
declare v_connection_role text;
begin
  select connection_role into strict v_connection_role from capacity_concurrency_connection;
  execute pg_catalog.format('drop role %I', v_connection_role);
end
$drop_dblink_role$;
