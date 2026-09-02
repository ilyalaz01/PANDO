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

create function pg_temp.create_learning_track_fixture_v1(
  p_readiness_goal_key text,
  p_expected_readiness_goal_version text,
  p_title text,
  p_priority integer,
  p_default_session_minutes integer,
  p_expected_growth_plan_version text,
  p_reason text,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_preview jsonb;
begin
  v_preview := api.preview_learning_track_creation_v1(
    p_readiness_goal_key,
    p_expected_readiness_goal_version,
    p_title,
    p_priority,
    p_default_session_minutes,
    p_expected_growth_plan_version,
    p_reason,
    p_request_id
  );
  return api.apply_learning_track_creation_v1(
    p_readiness_goal_key,
    p_expected_readiness_goal_version,
    p_title,
    p_priority,
    p_default_session_minutes,
    p_expected_growth_plan_version,
    p_reason,
    p_request_id,
    v_preview->>'previewDigest'
  );
end
$function$;
revoke all on function pg_temp.create_learning_track_fixture_v1(
  text, text, text, integer, integer, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function pg_temp.create_learning_track_fixture_v1(
  text, text, text, integer, integer, text, text, text
) to authenticated;

create temporary table d2b3_concurrency_cases (
  case_name text primary key,
  auth_user_id uuid not null,
  claims text not null,
  workspace_id uuid,
  readiness_goal_key text not null,
  expected_goal_version text,
  plan_version text,
  preview jsonb,
  losing_preview jsonb
) on commit preserve rows;
create temporary table d2b3_concurrency_connection (
  connection_role text not null,
  connection_password text not null
) on commit preserve rows;
create temporary table d2b3_concurrency_results (
  case_name text not null,
  caller text not null,
  response jsonb not null,
  primary key (case_name, caller)
) on commit preserve rows;
grant select, update on d2b3_concurrency_cases to authenticated;
grant insert, select on d2b3_concurrency_results to authenticated;

insert into d2b3_concurrency_cases values
  (
    'same-key', '39000000-0000-4000-8000-000000000001',
    pg_catalog.jsonb_build_object(
      'sub','39000000-0000-4000-8000-000000000001','role','authenticated',
      'aud','authenticated','exp',
      extract(epoch from pg_catalog.clock_timestamp() + interval '1 hour')::bigint
    )::text,
    null, 'goal:same-key', null, null, null, null
  ),
  (
    'distinct-slot', '39000000-0000-4000-8000-000000000002',
    pg_catalog.jsonb_build_object(
      'sub','39000000-0000-4000-8000-000000000002','role','authenticated',
      'aud','authenticated','exp',
      extract(epoch from pg_catalog.clock_timestamp() + interval '1 hour')::bigint
    )::text,
    null, 'goal:distinct-slot', null, null, null, null
  );
insert into d2b3_concurrency_connection values (
  'pando_pgtap_d2b3_' || pg_catalog.left(pg_catalog.replace(gen_random_uuid()::text,'-',''),16),
  gen_random_uuid()::text
);

do $create_login$
declare v record;
begin
  select * into strict v from d2b3_concurrency_connection;
  execute pg_catalog.format('create role %I login noinherit password %L',
    v.connection_role, v.connection_password);
  execute pg_catalog.format(
    'grant authenticated to %I', v.connection_role
  );
end
$create_login$;

insert into auth.users (
  id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
)
select auth_user_id,'authenticated','authenticated',case_name || '@d2b3-race.test','',
  pg_catalog.clock_timestamp(),'{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,pg_catalog.clock_timestamp(),pg_catalog.clock_timestamp()
from d2b3_concurrency_cases;

do $setup_cases$
declare
  v_case record;
  v_bootstrap jsonb;
  v_source jsonb;
begin
  for v_case in select * from d2b3_concurrency_cases order by case_name loop
    perform set_config('request.jwt.claims', v_case.claims, true);
    set local role authenticated;
    v_bootstrap := api.bootstrap_personal_workspace(
      'd2b3-race-' || v_case.case_name,
      'D2b3 race ' || v_case.case_name
    );
    perform api.create_readiness_goal(
      (v_bootstrap->>'workspace_id')::uuid,
      v_case.readiness_goal_key,
      'D2b3 concurrency ' || v_case.case_name,
      'target:nvidia-python-verification-base-v1',
      'd2b3-race-goal-' || v_case.case_name
    );
    perform pg_temp.initialize_growth_plan_fixture_v1(
      v_case.readiness_goal_key, 'd2b3-race-plan-' || v_case.case_name
    );
    if v_case.case_name = 'distinct-slot' then
      for i in 1..28 loop
        perform pg_temp.create_learning_track_fixture_v1(
          v_case.readiness_goal_key,
          '1',
          pg_catalog.format('Preload %s', i),
          50,
          30,
          '1',
          pg_catalog.format('Preload Track %s.', i),
          '20000000-0000-4000-8000-' || pg_catalog.lpad(i::text, 12, '0')
        );
      end loop;
    end if;
    v_source := api.get_learning_track_creation_source_v1();
    update d2b3_concurrency_cases
    set workspace_id = (v_bootstrap->>'workspace_id')::uuid,
      expected_goal_version = (
        select goal->>'aggregateVersion'
        from pg_catalog.jsonb_array_elements(v_source->'goals') as goal
        where goal->>'readinessGoalKey' = v_case.readiness_goal_key
      ),
      plan_version = v_source#>>'{growthPlan,aggregateVersion}',
      preview = api.preview_learning_track_creation_v1(
        v_case.readiness_goal_key,
        (
          select goal->>'aggregateVersion'
          from pg_catalog.jsonb_array_elements(v_source->'goals') as goal
          where goal->>'readinessGoalKey' = v_case.readiness_goal_key
        ),
        'Race winner', 60, 30,
        v_source#>>'{growthPlan,aggregateVersion}',
        'Apply the same preview concurrently.',
        case when v_case.case_name = 'same-key'
          then '11000000-0000-4000-8000-000000000001'
          else '12000000-0000-4000-8000-000000000001'
        end
      ),
      losing_preview = case when v_case.case_name='distinct-slot' then
        api.preview_learning_track_creation_v1(
          v_case.readiness_goal_key,
          (
            select goal->>'aggregateVersion'
            from pg_catalog.jsonb_array_elements(v_source->'goals') as goal
            where goal->>'readinessGoalKey' = v_case.readiness_goal_key
          ),
          'Race loser', 40, 25,
          v_source#>>'{growthPlan,aggregateVersion}',
          'Apply the losing preview.',
          '12000000-0000-4000-8000-000000000002'
        ) else null end
    where case_name = v_case.case_name;
    reset role;
  end loop;
end
$setup_cases$;
commit;

begin;
set local search_path = public, extensions;
select no_plan();

create temporary table d2b3_concurrency_observations(
  case_name text primary key,
  waited boolean not null
);

do $password_route$
begin
  if inet_server_addr() is null
     or inet_server_addr() << inet '127.0.0.0/8'
     or inet_server_addr() = inet '::1' then
    raise exception using errcode='08001',
      message='D2b3 concurrency requires a non-loopback password route';
  end if;
end
$password_route$;

select is(extensions.dblink_connect(
  connection_name,
  pg_catalog.format(
    'hostaddr=%s port=%s dbname=%L user=%L password=%L application_name=%s',
    host(inet_server_addr()),current_setting('port'),current_database(),
    (select connection_role from d2b3_concurrency_connection),
    (select connection_password from d2b3_concurrency_connection),connection_name
  )
),'OK',connection_name || ' connects')
from unnest(array['d2b3_c1','d2b3_c2']) as connection(connection_name);

select is(extensions.dblink_exec(
  connection_name,
  pg_catalog.format('set request.jwt.claims = %L',
    (select claims from d2b3_concurrency_cases where case_name='same-key'))
),'SET',connection_name || ' receives same-key claims')
from unnest(array['d2b3_c1','d2b3_c2']) as connection(connection_name);
select is(extensions.dblink_exec(connection_name,'set role authenticated'),
  'SET',connection_name || ' uses authenticated')
from unnest(array['d2b3_c1','d2b3_c2']) as connection(connection_name);
select is(extensions.dblink_exec(connection_name,'begin'),'BEGIN',
  connection_name || ' begins same-key transaction')
from unnest(array['d2b3_c1','d2b3_c2']) as connection(connection_name);

insert into d2b3_concurrency_results
select 'same-key','c1',result.response
from extensions.dblink('d2b3_c1',(
  select pg_catalog.format(
    'select api.apply_learning_track_creation_v1(%L,%L,%L,%s,%s,%L,%L,%L,%L)',
    readiness_goal_key, expected_goal_version, 'Race winner', 60, 30, plan_version,
    'Apply the same preview concurrently.', '11000000-0000-4000-8000-000000000001',
    preview->>'previewDigest'
  ) from d2b3_concurrency_cases where case_name='same-key'
)) as result(response jsonb);
select is(extensions.dblink_send_query('d2b3_c2',(
  select pg_catalog.format(
    'select api.apply_learning_track_creation_v1(%L,%L,%L,%s,%s,%L,%L,%L,%L)',
    readiness_goal_key, expected_goal_version, 'Race winner', 60, 30, plan_version,
    'Apply the same preview concurrently.', '11000000-0000-4000-8000-000000000001',
    preview->>'previewDigest'
  ) from d2b3_concurrency_cases where case_name='same-key'
)),1,'same-key retry dispatches before winner commit');

do $wait_same_key$
declare v_waited boolean := false;
begin
  for attempt in 1..200 loop
    select exists(
      select 1 from pg_catalog.pg_stat_activity
      where application_name='d2b3_c2'
        and wait_event_type='Lock' and wait_event='advisory'
    ) into v_waited;
    exit when v_waited;
    perform pg_catalog.pg_sleep(0.01);
  end loop;
  insert into d2b3_concurrency_observations values ('same-key',v_waited);
end
$wait_same_key$;
select ok((select waited from d2b3_concurrency_observations where case_name='same-key'),
  'same-key retry waits on the actor/request advisory lock');
select is(extensions.dblink_exec('d2b3_c1','commit'),'COMMIT','same-key winner commits');
insert into d2b3_concurrency_results
select 'same-key','c2',result.response
from extensions.dblink_get_result('d2b3_c2') as result(response jsonb);
select is((select pg_catalog.count(*) from extensions.dblink_get_result('d2b3_c2')
  as drained(response jsonb)),0::bigint,'same-key stream drains');
select is(extensions.dblink_exec('d2b3_c2','commit'),'COMMIT','same-key replay commits');
select is(
  (select response from d2b3_concurrency_results where case_name='same-key' and caller='c2'),
  (select response from d2b3_concurrency_results where case_name='same-key' and caller='c1'),
  'same-key concurrent replay is byte-identical'
);
select is(
  (
    select pg_catalog.count(*)
    from planning.learning_tracks
    where workspace_id = (select workspace_id from d2b3_concurrency_cases where case_name='same-key')
      and title = 'Race winner'
  ),
  1::bigint,
  'same-key concurrency still inserts exactly one Track'
);

select is(extensions.dblink_exec('d2b3_c1','reset role'),'RESET','same-key c1 resets role');
select is(extensions.dblink_exec('d2b3_c2','reset role'),'RESET','same-key c2 resets role');

select is(extensions.dblink_exec(
  connection_name,
  pg_catalog.format('set request.jwt.claims = %L',
    (select claims from d2b3_concurrency_cases where case_name='distinct-slot'))
),'SET',connection_name || ' receives distinct-slot claims')
from unnest(array['d2b3_c1','d2b3_c2']) as connection(connection_name);
select is(extensions.dblink_exec(connection_name,'set role authenticated'),
  'SET',connection_name || ' uses authenticated for distinct-slot')
from unnest(array['d2b3_c1','d2b3_c2']) as connection(connection_name);
select is(extensions.dblink_exec(connection_name,'begin'),'BEGIN',
  connection_name || ' begins distinct-slot transaction')
from unnest(array['d2b3_c1','d2b3_c2']) as connection(connection_name);

insert into d2b3_concurrency_results
select 'distinct-slot','c1',result.response
from extensions.dblink('d2b3_c1',(
  select pg_catalog.format(
    'select api.apply_learning_track_creation_v1(%L,%L,%L,%s,%s,%L,%L,%L,%L)',
    readiness_goal_key, expected_goal_version, 'Race winner', 60, 30, plan_version,
    'Apply the same preview concurrently.', '12000000-0000-4000-8000-000000000001',
    preview->>'previewDigest'
  ) from d2b3_concurrency_cases where case_name='distinct-slot'
)) as result(response jsonb);
select is(extensions.dblink_send_query('d2b3_c2',(
  select pg_catalog.format(
    'select api.apply_learning_track_creation_v1(%L,%L,%L,%s,%s,%L,%L,%L,%L)',
    readiness_goal_key, expected_goal_version, 'Race loser', 40, 25, plan_version,
    'Apply the losing preview.', '12000000-0000-4000-8000-000000000002',
    losing_preview->>'previewDigest'
  ) from d2b3_concurrency_cases where case_name='distinct-slot'
)),1,'distinct-slot loser dispatches before winner commit');

do $wait_distinct_slot$
declare v_waited boolean := false;
begin
  for attempt in 1..200 loop
    select exists(
      select 1 from pg_catalog.pg_stat_activity
      where application_name='d2b3_c2'
        and wait_event_type='Lock' and wait_event='advisory'
    ) into v_waited;
    exit when v_waited;
    perform pg_catalog.pg_sleep(0.01);
  end loop;
  insert into d2b3_concurrency_observations values ('distinct-slot',v_waited);
end
$wait_distinct_slot$;
select ok((select waited from d2b3_concurrency_observations where case_name='distinct-slot'),
  'distinct-slot loser waits on the shared planning-workspace lock');
select is(extensions.dblink_exec('d2b3_c1','commit'),'COMMIT','distinct-slot winner commits');

select throws_ok(
  $$select * from extensions.dblink_get_result('d2b3_c2') as result(response jsonb)$$,
  '40001', 'Learning Track creation preview is stale',
  'distinct stale preview loses after the winner takes the thirtieth slot'
);
select is((select pg_catalog.count(*) from extensions.dblink_get_result('d2b3_c2')
  as drained(response jsonb)),0::bigint,'distinct loser stream drains');
select is(extensions.dblink_exec('d2b3_c2','rollback'),'ROLLBACK','distinct-slot loser rolls back');
select is(
  (
    select count(*)
    from planning.learning_tracks
    where workspace_id = (select workspace_id from d2b3_concurrency_cases where case_name='distinct-slot')
      and lifecycle in ('active','paused')
  ),
  30::bigint,
  'distinct race finishes with exactly 30 current Tracks'
);

select is(
  (
    select count(*)
    from outbox.command_receipts
    where command_type = 'planning.create_learning_track_v1'
      and workspace_id = (select workspace_id from d2b3_concurrency_cases where case_name='distinct-slot')
  ),
  29::bigint,
  'only the winner of the distinct race writes a new command receipt'
);

select is(extensions.dblink_disconnect('d2b3_c1'),'OK','first connection disconnects');
select is(extensions.dblink_disconnect('d2b3_c2'),'OK','second connection disconnects');

select * from finish();
rollback;
