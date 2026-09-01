begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set local search_path = public, extensions;

create temporary table d1b_concurrency_cases (
  case_name text primary key,
  auth_user_id uuid not null,
  claims text not null,
  workspace_id uuid,
  readiness_goal_key text not null,
  expected_goal_version text,
  idempotency_key text not null,
  reason text not null,
  preview jsonb,
  losing_preview jsonb
) on commit preserve rows;
create temporary table d1b_concurrency_connection (
  connection_role text not null,
  connection_password text not null
) on commit preserve rows;
create temporary table d1b_concurrency_results (
  case_name text not null,
  caller text not null,
  response jsonb not null,
  primary key (case_name, caller)
) on commit preserve rows;
grant select, update on d1b_concurrency_cases to authenticated;
grant insert, select on d1b_concurrency_results to authenticated;

insert into d1b_concurrency_cases values
  (
    'same-key', '35000000-0000-4000-8000-000000000001',
    pg_catalog.jsonb_build_object(
      'sub','35000000-0000-4000-8000-000000000001','role','authenticated',
      'aud','authenticated','exp',extract(epoch from pg_catalog.clock_timestamp()
        + interval '1 hour')::bigint
    )::text,
    null, 'goal:d1b-race-same', null,
    '35000000-0000-4000-8000-000000000101', 'Initialize concurrently.', null, null
  ),
  (
    'distinct-keys', '35000000-0000-4000-8000-000000000002',
    pg_catalog.jsonb_build_object(
      'sub','35000000-0000-4000-8000-000000000002','role','authenticated',
      'aud','authenticated','exp',extract(epoch from pg_catalog.clock_timestamp()
        + interval '1 hour')::bigint
    )::text,
    null, 'goal:d1b-race-distinct', null,
    '35000000-0000-4000-8000-000000000201', 'First distinct request.', null, null
  ),
  (
    'goal-writer', '35000000-0000-4000-8000-000000000003',
    pg_catalog.jsonb_build_object(
      'sub','35000000-0000-4000-8000-000000000003','role','authenticated',
      'aud','authenticated','exp',extract(epoch from pg_catalog.clock_timestamp()
        + interval '1 hour')::bigint
    )::text,
    null, 'goal:d1b-race-writer', null,
    '35000000-0000-4000-8000-000000000301', 'Race the Goal writer.', null, null
  );
insert into d1b_concurrency_connection values (
  'pando_pgtap_d1b_' || pg_catalog.left(pg_catalog.replace(gen_random_uuid()::text,'-',''),16),
  gen_random_uuid()::text
);

do $create_login$
declare v record;
begin
  select * into strict v from d1b_concurrency_connection;
  execute pg_catalog.format('create role %I login noinherit password %L',
    v.connection_role, v.connection_password);
  execute pg_catalog.format(
    'grant authenticated, pando_phase1_api to %I', v.connection_role
  );
end
$create_login$;

insert into auth.users (
  id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
)
select auth_user_id,'authenticated','authenticated',case_name || '@d1b-race.test','',
  pg_catalog.clock_timestamp(),'{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,pg_catalog.clock_timestamp(),pg_catalog.clock_timestamp()
from d1b_concurrency_cases;

do $setup_cases$
declare
  v_case record;
  v_bootstrap jsonb;
  v_source jsonb;
begin
  for v_case in select * from d1b_concurrency_cases order by case_name loop
    perform set_config('request.jwt.claims', v_case.claims, true);
    set local role authenticated;
    v_bootstrap := api.bootstrap_personal_workspace(
      'd1b-race-' || v_case.case_name,
      'D1b race ' || v_case.case_name
    );
    perform api.create_readiness_goal(
      (v_bootstrap->>'workspace_id')::uuid,
      v_case.readiness_goal_key,
      'D1b concurrency ' || v_case.case_name,
      'target:nvidia-python-verification-base-v1',
      'd1b-race-goal-' || v_case.case_name
    );
    v_source := api.get_growth_plan_setup_source_v1();
    update d1b_concurrency_cases
    set workspace_id = (v_bootstrap->>'workspace_id')::uuid,
      expected_goal_version = v_source#>>'{goals,0,aggregateVersion}',
      preview = api.preview_growth_plan_initialization_v1(
        v_case.readiness_goal_key,
        v_source#>>'{goals,0,aggregateVersion}',
        600,30,50,v_case.reason,v_case.idempotency_key
      ),
      losing_preview = case when v_case.case_name='distinct-keys' then
        api.preview_growth_plan_initialization_v1(
          v_case.readiness_goal_key,
          v_source#>>'{goals,0,aggregateVersion}',
          600,30,50,'Second distinct request.',
          '35000000-0000-4000-8000-000000000202'
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
create temporary table d1b_concurrency_observations(
  case_name text primary key,
  waited boolean not null
);

do $password_route$
begin
  if inet_server_addr() is null
     or inet_server_addr() << inet '127.0.0.0/8'
     or inet_server_addr() = inet '::1' then
    raise exception using errcode='08001',
      message='D1b concurrency requires a non-loopback password route';
  end if;
end
$password_route$;

select is(extensions.dblink_connect(
  connection_name,
  pg_catalog.format(
    'hostaddr=%s port=%s dbname=%L user=%L password=%L application_name=%s',
    host(inet_server_addr()),current_setting('port'),current_database(),
    (select connection_role from d1b_concurrency_connection),
    (select connection_password from d1b_concurrency_connection),connection_name
  )
),'OK',connection_name || ' connects')
from unnest(array['d1b_c1','d1b_c2']) as connection(connection_name);

select is(extensions.dblink_exec(
  connection_name,
  pg_catalog.format('set request.jwt.claims = %L',
    (select claims from d1b_concurrency_cases where case_name='same-key'))
),'SET',connection_name || ' receives same-key claims')
from unnest(array['d1b_c1','d1b_c2']) as connection(connection_name);
select is(extensions.dblink_exec(connection_name,'set role authenticated'),
  'SET',connection_name || ' uses authenticated')
from unnest(array['d1b_c1','d1b_c2']) as connection(connection_name);
select is(extensions.dblink_exec(connection_name,'begin'),'BEGIN',
  connection_name || ' begins same-key transaction')
from unnest(array['d1b_c1','d1b_c2']) as connection(connection_name);

insert into d1b_concurrency_results
select 'same-key','c1',result.response
from extensions.dblink('d1b_c1',(
  select pg_catalog.format(
    'select api.apply_growth_plan_initialization_v1(%L,%L,600,30,50,%L,%L,%L)',
    readiness_goal_key,expected_goal_version,reason,idempotency_key,
    preview->>'previewDigest'
  ) from d1b_concurrency_cases where case_name='same-key'
)) as result(response jsonb);
select is(extensions.dblink_send_query('d1b_c2',(
  select pg_catalog.format(
    'select api.apply_growth_plan_initialization_v1(%L,%L,600,30,50,%L,%L,%L)',
    readiness_goal_key,expected_goal_version,reason,idempotency_key,
    preview->>'previewDigest'
  ) from d1b_concurrency_cases where case_name='same-key'
)),1,'same-key retry dispatches before winner commit');

do $wait_same_key$
declare v_waited boolean := false;
begin
  for attempt in 1..200 loop
    select exists(
      select 1 from pg_catalog.pg_stat_activity
      where application_name='d1b_c2'
        and wait_event_type='Lock' and wait_event='advisory'
    ) into v_waited;
    exit when v_waited;
    perform pg_catalog.pg_sleep(0.01);
  end loop;
  insert into d1b_concurrency_observations values ('same-key',v_waited);
end
$wait_same_key$;
select ok((select waited from d1b_concurrency_observations where case_name='same-key'),
  'same-key retry waits on the actor/key advisory lock');
select is(extensions.dblink_exec('d1b_c1','commit'),'COMMIT','same-key winner commits');
insert into d1b_concurrency_results
select 'same-key','c2',result.response
from extensions.dblink_get_result('d1b_c2') as result(response jsonb);
select is((select pg_catalog.count(*) from extensions.dblink_get_result('d1b_c2')
  as drained(response jsonb)),0::bigint,'same-key stream drains');
select is(extensions.dblink_exec('d1b_c2','commit'),'COMMIT','same-key replay commits');
select is(
  (select response from d1b_concurrency_results where case_name='same-key' and caller='c2'),
  (select response from d1b_concurrency_results where case_name='same-key' and caller='c1'),
  'same-key concurrent replay is byte-identical'
);

select is(extensions.dblink_exec(
  connection_name,
  pg_catalog.format('set request.jwt.claims = %L',
    (select claims from d1b_concurrency_cases where case_name='distinct-keys'))
),'SET',connection_name || ' receives distinct-key claims')
from unnest(array['d1b_c1','d1b_c2']) as connection(connection_name);
select is(extensions.dblink_exec(connection_name,'begin'),'BEGIN',
  connection_name || ' begins distinct-key transaction')
from unnest(array['d1b_c1','d1b_c2']) as connection(connection_name);

insert into d1b_concurrency_results
select 'distinct-keys','c1',result.response
from extensions.dblink('d1b_c1',(
  select pg_catalog.format(
    'select api.apply_growth_plan_initialization_v1(%L,%L,600,30,50,%L,%L,%L)',
    readiness_goal_key,expected_goal_version,reason,idempotency_key,
    preview->>'previewDigest'
  ) from d1b_concurrency_cases where case_name='distinct-keys'
)) as result(response jsonb);
select is(extensions.dblink_send_query('d1b_c2',(
  select pg_catalog.format(
    'select api.apply_growth_plan_initialization_v1(%L,%L,600,30,50,%L,%L,%L)',
    readiness_goal_key,expected_goal_version,'Second distinct request.',
    '35000000-0000-4000-8000-000000000202',
    losing_preview->>'previewDigest'
  ) from d1b_concurrency_cases where case_name='distinct-keys'
)),1,'distinct request dispatches before winner commit');
select is(extensions.dblink_exec('d1b_c1','commit'),'COMMIT','distinct-key winner commits');

select throws_ok(
  $$select * from extensions.dblink_get_result('d1b_c2') as result(response jsonb)$$,
  '40001', 'Growth Plan setup preview is stale',
  'distinct-key loser fails the exact cardinality/digest fence'
);
select is((select pg_catalog.count(*) from extensions.dblink_get_result('d1b_c2')
  as drained(response jsonb)),0::bigint,'distinct loser stream drains');
select is(extensions.dblink_exec('d1b_c2','rollback'),'ROLLBACK','distinct loser rolls back');

select is(extensions.dblink_exec(
  connection_name,
  pg_catalog.format('set request.jwt.claims = %L',
    (select claims from d1b_concurrency_cases where case_name='goal-writer'))
),'SET',connection_name || ' receives Goal-writer claims')
from unnest(array['d1b_c1','d1b_c2']) as connection(connection_name);
select is(extensions.dblink_exec('d1b_c1','set role pando_phase1_api'),
  'SET','Goal writer uses the Targets owner role');
select is(extensions.dblink_exec('d1b_c2','set role authenticated'),
  'SET','setup contender uses authenticated');
select is(extensions.dblink_exec('d1b_c1','begin'),
  'BEGIN','Goal writer begins first');
select is(extensions.dblink_exec(
  'd1b_c1',
  (
    select pg_catalog.format(
      'update targets.readiness_goals set lifecycle=%L, aggregate_version=2 where workspace_id=%L and readiness_goal_key=%L',
      'paused', workspace_id, readiness_goal_key
    )
    from d1b_concurrency_cases where case_name='goal-writer'
  )
), 'UPDATE 1', 'Goal writer changes lifecycle while holding the shared Targets lock');
select is(extensions.dblink_exec('d1b_c2','begin'),
  'BEGIN','setup contender begins behind the Goal writer');
select is(extensions.dblink_send_query('d1b_c2',(
  select pg_catalog.format(
    'select api.apply_growth_plan_initialization_v1(%L,%L,600,30,50,%L,%L,%L)',
    readiness_goal_key,expected_goal_version,reason,idempotency_key,
    preview->>'previewDigest'
  ) from d1b_concurrency_cases where case_name='goal-writer'
)),1,'setup dispatches while the Goal writer is uncommitted');
do $wait_setup_behind_goal_writer$
declare v_waited boolean := false;
begin
  for attempt in 1..200 loop
    select exists(
      select 1 from pg_catalog.pg_stat_activity
      where application_name='d1b_c2'
        and wait_event_type='Lock' and wait_event='advisory'
    ) into v_waited;
    exit when v_waited;
    perform pg_catalog.pg_sleep(0.01);
  end loop;
  insert into d1b_concurrency_observations values ('writer-first',v_waited);
end
$wait_setup_behind_goal_writer$;
select ok((select waited from d1b_concurrency_observations where case_name='writer-first'),
  'setup waits on the Targets lock when the Goal writer commits first');
select is(extensions.dblink_exec('d1b_c1','commit'),
  'COMMIT','Goal writer commits first');
select throws_ok(
  $$select * from extensions.dblink_get_result('d1b_c2') as result(response jsonb)$$,
  '42501', 'setup source is unavailable',
  'setup re-resolves and refuses the now-inactive Goal without enumeration'
);
select is((select pg_catalog.count(*) from extensions.dblink_get_result('d1b_c2')
  as drained(response jsonb)),0::bigint,'writer-first setup stream drains');
select is(extensions.dblink_exec('d1b_c2','rollback'),
  'ROLLBACK','writer-first setup contender rolls back');

select is(extensions.dblink_exec('d1b_c1','begin'),
  'BEGIN','Goal reset begins');
select is(extensions.dblink_exec(
  'd1b_c1',
  (
    select pg_catalog.format(
      'update targets.readiness_goals set lifecycle=%L, aggregate_version=3 where workspace_id=%L and readiness_goal_key=%L',
      'active', workspace_id, readiness_goal_key
    )
    from d1b_concurrency_cases where case_name='goal-writer'
  )
), 'UPDATE 1', 'Goal is reset active at a new exact version');
select is(extensions.dblink_exec('d1b_c1','commit'),
  'COMMIT','Goal reset commits');
select is(extensions.dblink_exec('d1b_c1','set role authenticated'),
  'SET','setup winner restores authenticated role');
insert into d1b_concurrency_results
select 'goal-writer','refreshed-preview',result.response
from extensions.dblink('d1b_c1',(
  select pg_catalog.format(
    'select api.preview_growth_plan_initialization_v1(%L,%L,600,30,50,%L,%L)',
    readiness_goal_key,'3',reason,idempotency_key
  ) from d1b_concurrency_cases where case_name='goal-writer'
)) as result(response jsonb);

select is(extensions.dblink_exec('d1b_c1','begin'),
  'BEGIN','setup winner begins first');
insert into d1b_concurrency_results
select 'goal-writer','setup-first',result.response
from extensions.dblink('d1b_c1',(
  select pg_catalog.format(
    'select api.apply_growth_plan_initialization_v1(%L,%L,600,30,50,%L,%L,%L)',
    candidate.readiness_goal_key,'3',candidate.reason,candidate.idempotency_key,
    preview.response->>'previewDigest'
  )
  from d1b_concurrency_cases as candidate
  join d1b_concurrency_results as preview
    on preview.case_name='goal-writer' and preview.caller='refreshed-preview'
  where candidate.case_name='goal-writer'
)) as result(response jsonb);
select is(extensions.dblink_exec('d1b_c2','set role pando_phase1_api'),
  'SET','second Goal writer uses the Targets owner role');
select is(extensions.dblink_exec('d1b_c2','begin'),
  'BEGIN','Goal writer begins behind setup');
select is(extensions.dblink_send_query('d1b_c2',(
  select pg_catalog.format(
    'update targets.readiness_goals set lifecycle=%L, aggregate_version=4 where workspace_id=%L and readiness_goal_key=%L returning aggregate_version',
    'paused', workspace_id, readiness_goal_key
  ) from d1b_concurrency_cases where case_name='goal-writer'
)),1,'Goal writer dispatches while setup is uncommitted');
do $wait_goal_writer_behind_setup$
declare v_waited boolean := false;
begin
  for attempt in 1..200 loop
    select exists(
      select 1 from pg_catalog.pg_stat_activity
      where application_name='d1b_c2'
        and wait_event_type='Lock' and wait_event='advisory'
    ) into v_waited;
    exit when v_waited;
    perform pg_catalog.pg_sleep(0.01);
  end loop;
  insert into d1b_concurrency_observations values ('setup-first',v_waited);
end
$wait_goal_writer_behind_setup$;
select ok((select waited from d1b_concurrency_observations where case_name='setup-first'),
  'Goal writer waits on the same Targets lock when setup commits first');
select is(extensions.dblink_exec('d1b_c1','commit'),
  'COMMIT','setup commits before the Goal writer');
select is(
  (select aggregate_version from extensions.dblink_get_result('d1b_c2')
   as result(aggregate_version bigint)),
  4::bigint,
  'serialized Goal writer updates only after setup commits'
);
select is((select pg_catalog.count(*) from extensions.dblink_get_result('d1b_c2')
  as drained(aggregate_version bigint)),0::bigint,'setup-first writer stream drains');
select is(extensions.dblink_exec('d1b_c2','commit'),
  'COMMIT','serialized Goal writer commits second');

select is((select pg_catalog.count(*) from planning.growth_plans
  where workspace_id=(select workspace_id from d1b_concurrency_cases
    where case_name='same-key')),1::bigint,'same-key race leaves one Plan');
select is((select pg_catalog.count(*) from planning.growth_plans
  where workspace_id=(select workspace_id from d1b_concurrency_cases
    where case_name='distinct-keys')),1::bigint,'distinct-key race leaves one Plan');
select ok(
  (select pg_catalog.count(*) = 1 from planning.growth_plans
   where workspace_id=(select workspace_id from d1b_concurrency_cases
     where case_name='goal-writer'))
  and (select pg_catalog.count(*) = 1 from planning.learning_tracks
   where workspace_id=(select workspace_id from d1b_concurrency_cases
     where case_name='goal-writer'))
  and (select pg_catalog.count(*) = 1 from planning.current_plan_snapshots
   where workspace_id=(select workspace_id from d1b_concurrency_cases
     where case_name='goal-writer'))
  and (select lifecycle='paused' and aggregate_version=4
   from targets.readiness_goals
   where workspace_id=(select workspace_id from d1b_concurrency_cases
     where case_name='goal-writer')),
  'both Goal-writer commit orders leave one setup and the serialized later Goal state'
);
select ok(
  (select pg_catalog.count(*) = 1 from planning.learning_tracks
   where workspace_id=(select workspace_id from d1b_concurrency_cases
     where case_name='same-key'))
  and (select pg_catalog.count(*) = 1 from planning.current_plan_snapshots
   where workspace_id=(select workspace_id from d1b_concurrency_cases
     where case_name='same-key')),
  'same-key replay race leaves exactly one Track and sentinel too'
);
select is((select pg_catalog.count(*) from outbox.command_receipts
  where command_type='planning.initialize_growth_plan_v2'
    and workspace_id in (select workspace_id from d1b_concurrency_cases)),
  3::bigint,'three race workspaces leave exactly three completed receipts');
select is((select pg_catalog.count(*) from outbox.events
  where payload->>'change_kind'='INITIALIZED'
    and workspace_id in (select workspace_id from d1b_concurrency_cases)),
  3::bigint,'three race workspaces emit exactly three events');
select is((select pg_catalog.count(*) from outbox.deliveries
  where consumer_name='planning.plan_snapshot_v1'
    and workspace_id in (select workspace_id from d1b_concurrency_cases)),
  3::bigint,'three race workspaces emit exactly three deliveries');

select is(extensions.dblink_disconnect(connection_name),'OK',connection_name || ' disconnects')
from unnest(array['d1b_c1','d1b_c2']) as connection(connection_name);
select * from finish();
commit;

do $drop_login$
declare v_role text;
begin
  select connection_role into strict v_role from d1b_concurrency_connection;
  execute pg_catalog.format('drop role %I',v_role);
end
$drop_login$;
