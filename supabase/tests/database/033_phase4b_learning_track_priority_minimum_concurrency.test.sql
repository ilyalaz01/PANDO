begin;

create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set local search_path = public, extensions;

create temporary table priority_minimum_concurrency_fixture (
  auth_user_id uuid not null,
  claims text not null,
  workspace_id uuid,
  growth_plan_id uuid,
  track_key text,
  settings_preview jsonb,
  capacity_preview jsonb,
  lifecycle_preview jsonb
) on commit preserve rows;
create temporary table priority_minimum_concurrency_connection (
  connection_role text primary key,
  connection_password text not null
) on commit preserve rows;
create temporary table priority_minimum_concurrency_error (
  returned_state text,
  returned_message text
) on commit preserve rows;
create temporary table priority_minimum_concurrency_observation (
  waited_on_advisory_lock boolean not null
) on commit preserve rows;
grant select, update on priority_minimum_concurrency_fixture to authenticated;

insert into priority_minimum_concurrency_fixture (auth_user_id, claims) values (
  'e3000000-0000-4000-8000-000000000001',
  pg_catalog.jsonb_build_object(
    'sub', 'e3000000-0000-4000-8000-000000000001',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text
);
insert into priority_minimum_concurrency_connection values (
  'pando_pgtap_settings_' || left(replace(gen_random_uuid()::text, '-', ''), 16),
  gen_random_uuid()::text
);

do $create_dblink_role$
declare fixture record;
begin
  select * into strict fixture from priority_minimum_concurrency_connection;
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
) values (
  'e3000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'priority-minimum-concurrency@pando.test', '', clock_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  clock_timestamp(), clock_timestamp()
);

create temporary table priority_minimum_concurrency_setup (
  result_name text primary key,
  response jsonb not null
) on commit preserve rows;
grant select, insert on priority_minimum_concurrency_setup to authenticated;

select set_config(
  'request.jwt.claims',
  (select claims from priority_minimum_concurrency_fixture),
  true
);
set local role authenticated;
insert into priority_minimum_concurrency_setup values (
  'bootstrap', api.bootstrap_personal_workspace(
    'phase4b-priority-minimum-concurrency', 'Priority minimum concurrency'
  )
);
insert into priority_minimum_concurrency_setup
select 'goal', api.create_readiness_goal(
  (response->>'workspace_id')::uuid,
  'goal:priority-minimum-concurrency', 'Priority minimum concurrency',
  'target:nvidia-python-verification-base-v1',
  'phase4b-priority-minimum-concurrency-goal'
)
from priority_minimum_concurrency_setup where result_name = 'bootstrap';
insert into priority_minimum_concurrency_setup values (
  'plan', api.initialize_growth_plan_v1(
    'goal:priority-minimum-concurrency', 600, 25, 80, 120,
    'phase4b-priority-minimum-concurrency-plan'
  )
);
reset role;

update priority_minimum_concurrency_fixture as fixture
set workspace_id = (setup.response->>'workspaceId')::uuid,
  growth_plan_id = (setup.response->>'growthPlanId')::uuid,
  track_key = track.track_key
from priority_minimum_concurrency_setup as setup
join planning.learning_tracks as track
  on track.learning_track_id = (setup.response->>'learningTrackId')::uuid
where setup.result_name = 'plan';

set local role authenticated;
update priority_minimum_concurrency_fixture
set settings_preview = api.preview_learning_track_priority_minimum_v1(
    track_key, 70, 120, '1', '1',
    'Reprioritize before a stale capacity change.'
  ),
  capacity_preview = api.preview_growth_plan_capacity_v1(
    500, '1', 'Change capacity only if active Tracks are unchanged.'
  );
reset role;

commit;

begin;
set local search_path = public, extensions;
select no_plan();

do $assert_password_route$
declare v_server_addr inet := inet_server_addr();
begin
  if v_server_addr is null
     or v_server_addr << inet '127.0.0.0/8'
     or v_server_addr = inet '::1' then
    raise exception using errcode = '08001',
      message = 'D2b2 concurrency test requires a non-loopback password-authenticated connection';
  end if;
end
$assert_password_route$;

select is(
  extensions.dblink_connect(
    connection_name,
    pg_catalog.format(
      'hostaddr=%s port=%s dbname=%L user=%L password=%L application_name=pando_pgtap_settings_%s',
      host(inet_server_addr()), current_setting('port'), current_database(),
      (select connection_role from priority_minimum_concurrency_connection),
      (select connection_password from priority_minimum_concurrency_connection),
      connection_name
    )
  ),
  'OK', connection_name || ' connects'
)
from unnest(array['settings_c1', 'settings_c2']) as connection(connection_name);

select is(
  extensions.dblink_exec(
    connection_name,
    pg_catalog.format(
      'set request.jwt.claims = %L',
      (select claims from priority_minimum_concurrency_fixture)
    )
  ),
  'SET', connection_name || ' receives actor claims'
)
from unnest(array['settings_c1', 'settings_c2']) as connection(connection_name);
select is(
  extensions.dblink_exec(connection_name, 'set role authenticated'),
  'SET', connection_name || ' uses authenticated'
)
from unnest(array['settings_c1', 'settings_c2']) as connection(connection_name);
select is(
  extensions.dblink_exec(connection_name, 'begin'),
  'BEGIN', connection_name || ' begins transaction'
)
from unnest(array['settings_c1', 'settings_c2']) as connection(connection_name);

select ok(
  response.response#>>'{changedTrack,aggregateVersion}' = '2'
    and response.response#>>'{changedTrack,priority}' = '70',
  'D2b2 priority-only winner is staged while holding the Planning workspace lock'
)
from extensions.dblink(
  'settings_c1',
  pg_catalog.format(
    'select api.apply_learning_track_priority_minimum_v1(%L,%s,%s,%L,%L,%L,%L,%L)',
    (select track_key from priority_minimum_concurrency_fixture),
    70, 120, '1', '1',
    (select settings_preview->>'previewDigest'
     from priority_minimum_concurrency_fixture),
    'Reprioritize before a stale capacity change.',
    'phase4b-settings-priority-winner'
  )
) as response(response jsonb);

select is(
  extensions.dblink_send_query(
    'settings_c2',
    pg_catalog.format(
      'select api.apply_growth_plan_capacity_v1(%s,%L,%L,%L,%L)',
      500, '1',
      (select capacity_preview->>'previewDigest'
       from priority_minimum_concurrency_fixture),
      'Change capacity only if active Tracks are unchanged.',
      'phase4b-settings-capacity-loser'
    )
  ),
  1,
  'D2a capacity apply is dispatched before the D2b2 transaction commits'
);

do $wait_for_settings_lock$
declare observed boolean := false;
begin
  for attempt in 1..200 loop
    select exists (
      select 1
      from pg_catalog.pg_stat_activity
      where application_name = 'pando_pgtap_settings_settings_c2'
        and wait_event_type = 'Lock'
        and wait_event = 'advisory'
    ) into observed;
    exit when observed;
    perform pg_catalog.pg_sleep(0.01);
  end loop;
  insert into priority_minimum_concurrency_observation values (observed);
end
$wait_for_settings_lock$;

select ok(
  (select waited_on_advisory_lock from priority_minimum_concurrency_observation),
  'D2b2 and D2a serialize on the same Planning workspace lock'
);
select is(
  extensions.dblink_exec('settings_c1', 'commit'),
  'COMMIT',
  'D2b2 priority-only winner commits first'
);

do $collect_capacity_error$
declare v_state text;
declare v_message text;
begin
  begin
    perform response.response
    from extensions.dblink_get_result('settings_c2') as response(response jsonb);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
  end;
  perform count(*)
  from extensions.dblink_get_result('settings_c2') as response(response jsonb);
  insert into priority_minimum_concurrency_error values (v_state, v_message);
end
$collect_capacity_error$;
select is(
  extensions.dblink_exec('settings_c2', 'rollback'),
  'ROLLBACK',
  'fingerprint-stale capacity apply rolls back'
);
select is(
  (select returned_state from priority_minimum_concurrency_error),
  '40001',
  'delayed capacity apply receives the optimistic concurrency SQL state'
);
select is(
  (select returned_message from priority_minimum_concurrency_error),
  'Growth Plan preview is stale',
  'D2b2 version-only active fingerprint change invalidates the old D2a preview'
);
select is(
  (
    select count(*)::bigint from outbox.command_receipts
    where idempotency_key = 'phase4b-settings-capacity-loser'
  ),
  0::bigint,
  'losing D2a attempt leaves no receipt'
);

select set_config(
  'request.jwt.claims',
  (select claims from priority_minimum_concurrency_fixture),
  true
);
set local role authenticated;
update priority_minimum_concurrency_fixture
set capacity_preview = api.preview_growth_plan_capacity_v1(
    500, '1', 'Capacity wins before stale settings.'
  ),
  settings_preview = api.preview_learning_track_priority_minimum_v1(
    track_key, 60, 120, '1', '2', 'Settings lose after Plan version changes.'
  );
reset role;

truncate priority_minimum_concurrency_error;
truncate priority_minimum_concurrency_observation;
select is(
  extensions.dblink_exec(connection_name, 'begin'),
  'BEGIN', connection_name || ' begins reverse D2a transaction'
)
from unnest(array['settings_c1', 'settings_c2']) as connection(connection_name);

select ok(
  response.response#>>'{changedPlan,aggregateVersion}' = '2'
    and response.response#>>'{changedPlan,weeklyCapacityMinutes}' = '500',
  'D2a winner is staged while holding the Planning workspace lock'
)
from extensions.dblink(
  'settings_c1',
  $$select api.apply_growth_plan_capacity_v1(
    500, '1',
    (api.preview_growth_plan_capacity_v1(
      500, '1', 'Capacity wins before stale settings.'
    )->>'previewDigest'),
    'Capacity wins before stale settings.',
    'phase4b-settings-capacity-winner'
  )$$
) as response(response jsonb);

select is(
  extensions.dblink_send_query(
    'settings_c2',
    pg_catalog.format(
      'select api.apply_learning_track_priority_minimum_v1(%L,%s,%s,%L,%L,%L,%L,%L)',
      (select track_key from priority_minimum_concurrency_fixture),
      60, 120, '1', '2',
      (select settings_preview->>'previewDigest'
       from priority_minimum_concurrency_fixture),
      'Settings lose after Plan version changes.',
      'phase4b-settings-plan-stale-loser'
    )
  ),
  1,
  'D2b2 apply is dispatched before the D2a transaction commits'
);

do $wait_for_capacity_lock$
declare observed boolean := false;
begin
  for attempt in 1..200 loop
    select exists (
      select 1 from pg_catalog.pg_stat_activity
      where application_name = 'pando_pgtap_settings_settings_c2'
        and wait_event_type = 'Lock' and wait_event = 'advisory'
    ) into observed;
    exit when observed;
    perform pg_catalog.pg_sleep(0.01);
  end loop;
  insert into priority_minimum_concurrency_observation values (observed);
end
$wait_for_capacity_lock$;
select ok(
  (select waited_on_advisory_lock from priority_minimum_concurrency_observation),
  'reverse D2a and D2b2 race uses the same workspace lock'
);
select is(
  extensions.dblink_exec('settings_c1', 'commit'),
  'COMMIT',
  'D2a winner commits first'
);

do $collect_settings_plan_error$
declare v_state text;
declare v_message text;
begin
  begin
    perform response.response
    from extensions.dblink_get_result('settings_c2') as response(response jsonb);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
  end;
  perform count(*)
  from extensions.dblink_get_result('settings_c2') as response(response jsonb);
  insert into priority_minimum_concurrency_error values (v_state, v_message);
end
$collect_settings_plan_error$;
select is(
  extensions.dblink_exec('settings_c2', 'rollback'),
  'ROLLBACK',
  'Plan-stale D2b2 apply rolls back'
);
select is(
  (select returned_state from priority_minimum_concurrency_error),
  '40001',
  'delayed D2b2 apply receives the optimistic concurrency SQL state'
);
select is(
  (select returned_message from priority_minimum_concurrency_error),
  'Growth Plan version is stale',
  'committed D2a command invalidates the old D2b2 Plan fence'
);
select is(
  (
    select count(*)::bigint from outbox.command_receipts
    where idempotency_key = 'phase4b-settings-plan-stale-loser'
  ),
  0::bigint,
  'Plan-stale D2b2 loser leaves no receipt'
);

select set_config(
  'request.jwt.claims',
  (select claims from priority_minimum_concurrency_fixture),
  true
);
set local role authenticated;
update priority_minimum_concurrency_fixture
set settings_preview = api.preview_learning_track_priority_minimum_v1(
    track_key, 60, 100, '2', '2', 'Settings lose after lifecycle changes.'
  ),
  lifecycle_preview = api.preview_learning_track_lifecycle_v1(
    track_key, 'pause_track', '2', '2', 'Pause before stale settings.'
  );
reset role;

truncate priority_minimum_concurrency_error;
truncate priority_minimum_concurrency_observation;
select is(
  extensions.dblink_exec(connection_name, 'begin'),
  'BEGIN', connection_name || ' begins D2b1 transaction'
)
from unnest(array['settings_c1', 'settings_c2']) as connection(connection_name);

select ok(
  response.response#>>'{changedTrack,lifecycle}' = 'PAUSED'
    and response.response#>>'{changedTrack,aggregateVersion}' = '3',
  'D2b1 lifecycle winner is staged while holding the Planning workspace lock'
)
from extensions.dblink(
  'settings_c1',
  pg_catalog.format(
    'select api.apply_learning_track_lifecycle_v1(%L,%L,%L,%L,%L,%L,%L)',
    (select track_key from priority_minimum_concurrency_fixture),
    'pause_track', '2', '2',
    (select lifecycle_preview->>'previewDigest'
     from priority_minimum_concurrency_fixture),
    'Pause before stale settings.',
    'phase4b-settings-lifecycle-winner'
  )
) as response(response jsonb);

select is(
  extensions.dblink_send_query(
    'settings_c2',
    pg_catalog.format(
      'select api.apply_learning_track_priority_minimum_v1(%L,%s,%s,%L,%L,%L,%L,%L)',
      (select track_key from priority_minimum_concurrency_fixture),
      60, 100, '2', '2',
      (select settings_preview->>'previewDigest'
       from priority_minimum_concurrency_fixture),
      'Settings lose after lifecycle changes.',
      'phase4b-settings-track-stale-loser'
    )
  ),
  1,
  'D2b2 apply is dispatched before the D2b1 transaction commits'
);

do $wait_for_lifecycle_lock$
declare observed boolean := false;
begin
  for attempt in 1..200 loop
    select exists (
      select 1 from pg_catalog.pg_stat_activity
      where application_name = 'pando_pgtap_settings_settings_c2'
        and wait_event_type = 'Lock' and wait_event = 'advisory'
    ) into observed;
    exit when observed;
    perform pg_catalog.pg_sleep(0.01);
  end loop;
  insert into priority_minimum_concurrency_observation values (observed);
end
$wait_for_lifecycle_lock$;
select ok(
  (select waited_on_advisory_lock from priority_minimum_concurrency_observation),
  'D2b1 and D2b2 serialize on the same workspace lock'
);
select is(
  extensions.dblink_exec('settings_c1', 'commit'),
  'COMMIT',
  'D2b1 winner commits first'
);

do $collect_settings_track_error$
declare v_state text;
declare v_message text;
begin
  begin
    perform response.response
    from extensions.dblink_get_result('settings_c2') as response(response jsonb);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
  end;
  perform count(*)
  from extensions.dblink_get_result('settings_c2') as response(response jsonb);
  insert into priority_minimum_concurrency_error values (v_state, v_message);
end
$collect_settings_track_error$;
select is(
  extensions.dblink_exec('settings_c2', 'rollback'),
  'ROLLBACK',
  'Track-stale D2b2 apply rolls back'
);
select is(
  (select returned_state from priority_minimum_concurrency_error),
  '40001',
  'D2b1-delayed D2b2 apply receives the optimistic concurrency SQL state'
);
select is(
  (select returned_message from priority_minimum_concurrency_error),
  'Learning Track version is stale',
  'committed D2b1 command invalidates the old D2b2 Track fence'
);
select ok(
  (
    select track.lifecycle = 'paused'
      and track.priority = 70
      and track.protected_minimum_minutes = 120
      and track.aggregate_version = 3
    from planning.learning_tracks as track
    where track.workspace_id = (
      select workspace_id from priority_minimum_concurrency_fixture
    ) and track.track_key = (
      select track_key from priority_minimum_concurrency_fixture
    )
  )
  and not exists (
    select 1 from outbox.command_receipts
    where idempotency_key = 'phase4b-settings-track-stale-loser'
  ),
  'D2b1 winner persists while stale D2b2 creates no state or receipt'
);

select is(
  extensions.dblink_disconnect(connection_name),
  'OK', connection_name || ' disconnects cleanly'
)
from unnest(array['settings_c1', 'settings_c2']) as connection(connection_name);

select * from finish();
commit;

do $drop_dblink_role$
declare v_connection_role text;
begin
  select connection_role into strict v_connection_role
  from priority_minimum_concurrency_connection;
  execute pg_catalog.format('drop role %I', v_connection_role);
end
$drop_dblink_role$;
