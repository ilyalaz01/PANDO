begin;

create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set local search_path = public, extensions;
select no_plan();

create function pg_temp.initialize_cadence_fixture_v1(
  p_goal_key text, p_idempotency_key text
) returns jsonb language sql security definer set search_path = '' as $function$
  select api.initialize_growth_plan_v1(p_goal_key, 600, 30, 80, 0, p_idempotency_key)
$function$;
revoke all on function pg_temp.initialize_cadence_fixture_v1(text,text)
  from public, anon, authenticated, service_role;
grant execute on function pg_temp.initialize_cadence_fixture_v1(text,text) to authenticated;

create temporary table cadence_concurrency_cases (
  case_name text primary key,
  user_id uuid not null,
  claims text not null,
  workspace_id uuid,
  track_key text,
  plan_version text,
  track_version text,
  cadence_preview jsonb,
  competing_cadence_preview jsonb,
  capacity_preview jsonb
);
create temporary table cadence_concurrency_connections (
  role_name text primary key,
  password text not null
);
create temporary table cadence_concurrency_errors (
  case_name text primary key,
  sqlstate text,
  message text
);
create temporary table cadence_concurrency_results (
  case_name text primary key,
  response jsonb not null
);
create temporary table cadence_concurrency_waits (
  case_name text primary key,
  waited boolean not null
);
grant select, update on cadence_concurrency_cases to authenticated;
grant select, insert on cadence_concurrency_errors, cadence_concurrency_results,
  cadence_concurrency_waits to authenticated;

insert into cadence_concurrency_cases(case_name, user_id, claims) values
  ('same-track', 'e6000000-0000-4000-8000-000000000001',
   pg_catalog.jsonb_build_object('sub','e6000000-0000-4000-8000-000000000001','role','authenticated','aud','authenticated','exp',extract(epoch from clock_timestamp()+interval '1 hour')::bigint)::text),
  ('capacity', 'e6000000-0000-4000-8000-000000000002',
   pg_catalog.jsonb_build_object('sub','e6000000-0000-4000-8000-000000000002','role','authenticated','aud','authenticated','exp',extract(epoch from clock_timestamp()+interval '1 hour')::bigint)::text);
insert into cadence_concurrency_connections values
  ('pando_pgtap_cadence_' || left(replace(gen_random_uuid()::text, '-', ''), 16), gen_random_uuid()::text);

do $create_role$
declare c record;
begin
  select * into strict c from cadence_concurrency_connections;
  execute format('create role %I login noinherit password %L', c.role_name, c.password);
  execute format('grant authenticated to %I', c.role_name);
end $create_role$;

insert into auth.users(
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select user_id, 'authenticated', 'authenticated', case_name || '@cadence-race.pando.test', '',
  clock_timestamp(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  clock_timestamp(), clock_timestamp()
from cadence_concurrency_cases;

do $setup$
declare c record; b jsonb; p jsonb; tracks jsonb;
begin
  for c in select * from cadence_concurrency_cases order by case_name loop
    perform set_config('request.jwt.claims', c.claims, true);
    set local role authenticated;
    b := api.bootstrap_personal_workspace('cadence-race-' || c.case_name, 'Cadence race');
    perform api.create_readiness_goal(
      (b->>'workspace_id')::uuid, 'goal:cadence-race-' || c.case_name,
      'Cadence race goal', 'target:nvidia-python-verification-base-v1',
      'cadence-race-goal-' || c.case_name
    );
    p := pg_temp.initialize_cadence_fixture_v1(
      'goal:cadence-race-' || c.case_name, 'cadence-race-plan-' || c.case_name
    );
    tracks := api.get_current_learning_tracks_v1();
    update cadence_concurrency_cases
    set workspace_id = (b->>'workspace_id')::uuid,
        track_key = tracks#>>'{learningTracks,0,trackKey}',
        plan_version = tracks#>>'{growthPlan,aggregateVersion}',
        track_version = tracks#>>'{learningTracks,0,aggregateVersion}',
        cadence_preview = api.preview_learning_track_cadence_v1(
          tracks#>>'{learningTracks,0,trackKey}', 3,
          tracks#>>'{growthPlan,aggregateVersion}', tracks#>>'{learningTracks,0,aggregateVersion}',
          'Set the initial cadence for this race.'
        ),
        competing_cadence_preview = api.preview_learning_track_cadence_v1(
          tracks#>>'{learningTracks,0,trackKey}', 2,
          tracks#>>'{growthPlan,aggregateVersion}', tracks#>>'{learningTracks,0,aggregateVersion}',
          'Competing cadence edit must become stale.'
        ),
        capacity_preview = api.preview_growth_plan_capacity_v1(
          660, tracks#>>'{growthPlan,aggregateVersion}',
          'Competing capacity edit must become stale.'
        )
    where case_name = c.case_name;
    reset role;
  end loop;
end $setup$;
commit;

begin;
set local search_path = public, extensions;
select is(
  extensions.dblink_connect(
    connection_name,
    format('hostaddr=%s port=%s dbname=%L user=%L password=%L application_name=pando_cadence_%s',
      host(inet_server_addr()), current_setting('port'), current_database(), role_name, password,
      connection_name)
  ),
  'OK', connection_name || ' connects'
)
from cadence_concurrency_connections
cross join unnest(array['cadence_c1', 'cadence_c2']) as connection_name;

select is(extensions.dblink_exec(connection_name, format(
  'set request.jwt.claims = %L', (select claims from cadence_concurrency_cases where case_name = 'same-track')
)), 'SET', connection_name || ' gets same-track claims')
from unnest(array['cadence_c1', 'cadence_c2']) as connection_name;
select is(extensions.dblink_exec(connection_name, 'set role authenticated'), 'SET', connection_name || ' uses authenticated')
from unnest(array['cadence_c1', 'cadence_c2']) as connection_name;
select is(extensions.dblink_exec(connection_name, 'begin'), 'BEGIN', connection_name || ' begins same-track transaction')
from unnest(array['cadence_c1', 'cadence_c2']) as connection_name;

insert into cadence_concurrency_results
select 'same-track', response
from cadence_concurrency_cases c
cross join lateral dblink('cadence_c1', format(
  'select api.apply_learning_track_cadence_v1(%L,%s,%L,%L,%L,%L,%L)',
  c.track_key, 3, c.plan_version, c.track_version, c.cadence_preview->>'previewDigest',
  'Set the initial cadence for this race.', 'e6000000-0000-4000-8000-000000000101'
)) as winner(response jsonb)
where c.case_name = 'same-track';
select is(extensions.dblink_send_query('cadence_c2', format(
  'select api.apply_learning_track_cadence_v1(%L,%s,%L,%L,%L,%L,%L)',
  track_key, 2, plan_version, track_version, competing_cadence_preview->>'previewDigest',
  'Competing cadence edit must become stale.', 'e6000000-0000-4000-8000-000000000102'
)), 1, 'same-Track loser is dispatched before the cadence winner commits')
from cadence_concurrency_cases where case_name = 'same-track';
do $wait_same$
declare waited boolean := false;
begin
  for i in 1..200 loop
    select exists(
      select 1 from pg_stat_activity
      where application_name = 'pando_cadence_cadence_c2' and wait_event_type = 'Lock'
    ) into waited;
    exit when waited;
    perform pg_sleep(.01);
  end loop;
  insert into cadence_concurrency_waits values ('same-track', waited);
end $wait_same$;
select ok(waited, 'same-Track loser waits on the Planning workspace lock')
from cadence_concurrency_waits where case_name = 'same-track';
select is(extensions.dblink_exec('cadence_c1', 'commit'), 'COMMIT', 'same-Track cadence winner commits');
do $collect_same$
declare s text; m text;
begin
  begin
    perform response from dblink_get_result('cadence_c2') as result(response jsonb);
  exception when others then
    get stacked diagnostics s = returned_sqlstate, m = message_text;
  end;
  perform count(*) from dblink_get_result('cadence_c2') as result(response jsonb);
  insert into cadence_concurrency_errors values ('same-track', s, m);
end $collect_same$;
select is(extensions.dblink_exec('cadence_c2', 'rollback'), 'ROLLBACK', 'stale same-Track loser rolls back');
select is((select sqlstate from cadence_concurrency_errors where case_name = 'same-track'), '40001', 'same-Track loser is stale');
select is((select message from cadence_concurrency_errors where case_name = 'same-track'), 'Learning Track version is stale', 'same-Track loser reports the exact stale Track-version error');
select ok(
  (select cadence_per_week = 3 and aggregate_version = 2
   from planning.learning_tracks where workspace_id = (select workspace_id from cadence_concurrency_cases where case_name = 'same-track'))
  and (select count(*) = 1 from outbox.command_receipts
       where workspace_id = (select workspace_id from cadence_concurrency_cases where case_name = 'same-track')
         and command_type = 'planning.change_learning_track_cadence_v1'),
  'same-Track race advances cadence once and leaves one completed command receipt'
);

select is(extensions.dblink_exec(connection_name, format(
  'set request.jwt.claims = %L', (select claims from cadence_concurrency_cases where case_name = 'capacity')
)), 'SET', connection_name || ' gets capacity-race claims')
from unnest(array['cadence_c1', 'cadence_c2']) as connection_name;
select is(extensions.dblink_exec(connection_name, 'begin'), 'BEGIN', connection_name || ' begins capacity-race transaction')
from unnest(array['cadence_c1', 'cadence_c2']) as connection_name;
insert into cadence_concurrency_results
select 'capacity', response
from cadence_concurrency_cases c
cross join lateral dblink('cadence_c1', format(
  'select api.apply_learning_track_cadence_v1(%L,%s,%L,%L,%L,%L,%L)',
  c.track_key, 3, c.plan_version, c.track_version, c.cadence_preview->>'previewDigest',
  'Set the initial cadence for this race.', 'e6000000-0000-4000-8000-000000000201'
)) as winner(response jsonb)
where c.case_name = 'capacity';
select is(extensions.dblink_send_query('cadence_c2', format(
  'select api.apply_growth_plan_capacity_v1(%s,%L,%L,%L,%L)',
  660, plan_version, capacity_preview->>'previewDigest',
  'Competing capacity edit must become stale.', 'e6000000-0000-4000-8000-000000000202'
)), 1, 'capacity loser is dispatched before the cadence winner commits')
from cadence_concurrency_cases where case_name = 'capacity';
do $wait_capacity$
declare waited boolean := false;
begin
  for i in 1..200 loop
    select exists(
      select 1 from pg_stat_activity
      where application_name = 'pando_cadence_cadence_c2' and wait_event_type = 'Lock'
    ) into waited;
    exit when waited;
    perform pg_sleep(.01);
  end loop;
  insert into cadence_concurrency_waits values ('capacity', waited);
end $wait_capacity$;
select ok(waited, 'capacity loser waits on the shared Planning workspace lock')
from cadence_concurrency_waits where case_name = 'capacity';
select is(extensions.dblink_exec('cadence_c1', 'commit'), 'COMMIT', 'capacity-race cadence winner commits');
do $collect_capacity$
declare s text; m text;
begin
  begin
    perform response from dblink_get_result('cadence_c2') as result(response jsonb);
  exception when others then
    get stacked diagnostics s = returned_sqlstate, m = message_text;
  end;
  perform count(*) from dblink_get_result('cadence_c2') as result(response jsonb);
  insert into cadence_concurrency_errors values ('capacity', s, m);
end $collect_capacity$;
select is(extensions.dblink_exec('cadence_c2', 'rollback'), 'ROLLBACK', 'stale capacity loser rolls back');
select is((select sqlstate from cadence_concurrency_errors where case_name = 'capacity'), '40001', 'capacity loser is stale after cadence changes a Track version');
select is((select message from cadence_concurrency_errors where case_name = 'capacity'), 'Growth Plan preview is stale', 'capacity loser reports the exact stale preview error');
select ok(
  (select weekly_capacity_minutes = 600 and aggregate_version = 1
   from planning.growth_plans where workspace_id = (select workspace_id from cadence_concurrency_cases where case_name = 'capacity'))
  and (select count(*) = 0 from outbox.command_receipts
       where workspace_id = (select workspace_id from cadence_concurrency_cases where case_name = 'capacity')
         and command_type = 'planning.set_growth_plan_default_capacity'),
  'stale capacity command leaves the Plan and outbox receipt unchanged'
);

select is(extensions.dblink_disconnect(connection_name), 'OK', connection_name || ' disconnects')
from unnest(array['cadence_c1', 'cadence_c2']) as connection_name;
select * from finish();
commit;

do $drop$
declare c record;
begin
  for c in select * from cadence_concurrency_connections loop
    execute format('drop role %I', c.role_name);
  end loop;
end $drop$;
