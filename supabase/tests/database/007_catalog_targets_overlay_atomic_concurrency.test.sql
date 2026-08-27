begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set local search_path = public, extensions;

create temporary table phase1_concurrency_fixture(
  auth_user_id uuid primary key,
  workspace_id uuid,
  claims text not null,
  connection_role text not null,
  connection_password text not null
) on commit preserve rows;
create temporary table phase1_concurrency_bootstrap(response jsonb not null) on commit preserve rows;
create temporary table phase1_concurrency_goal(response jsonb not null) on commit preserve rows;
grant select,insert,update on phase1_concurrency_fixture to authenticated;
grant select,insert on phase1_concurrency_bootstrap to authenticated;
grant select,insert on phase1_concurrency_goal to authenticated;

insert into phase1_concurrency_fixture(
  auth_user_id,
  claims,
  connection_role,
  connection_password
)
select fixture.user_id,
  jsonb_build_object(
    'sub',fixture.user_id,'role','authenticated','aud','authenticated',
    'exp',extract(epoch from clock_timestamp()+interval '1 hour')::bigint
  )::text,
  'pando_pgtap_'||left(replace(fixture.user_id::text,'-',''),20),
  gen_random_uuid()::text
from (select gen_random_uuid() user_id) fixture;

do $create_dblink_role$
declare
  fixture record;
begin
  select connection_role,connection_password
  into strict fixture
  from phase1_concurrency_fixture;
  execute format(
    'create role %I login noinherit password %L',
    fixture.connection_role,
    fixture.connection_password
  );
  execute format('grant authenticated to %I',fixture.connection_role);
end
$create_dblink_role$;
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select auth_user_id,'authenticated','authenticated',
  'phase1-concurrency-'||replace(auth_user_id::text,'-','')||'@pando.test','',clock_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,clock_timestamp(),clock_timestamp()
from phase1_concurrency_fixture;
select set_config('request.jwt.claims',(select claims from phase1_concurrency_fixture),true);
set local role authenticated;
insert into phase1_concurrency_bootstrap
select api.bootstrap_personal_workspace('phase1-concurrency-bootstrap','Phase 1 concurrency');
insert into phase1_concurrency_goal
select api.create_readiness_goal(
  (select (response->>'workspace_id')::uuid from phase1_concurrency_bootstrap),
  'goal:phase1-concurrency',
  'Phase 1 concurrency readiness',
  'target:nvidia-python-verification-base-v1',
  'phase1-concurrency-goal'
);
reset role;
update phase1_concurrency_fixture
set workspace_id=(select (response->>'workspace_id')::uuid from phase1_concurrency_bootstrap);
commit;

begin;
set local search_path = public, extensions;
select no_plan();
create temporary table phase1_concurrency_results(
  caller text primary key,
  response jsonb not null
);
create temporary table phase1_concurrency_observation(
  waited_on_advisory_lock boolean not null
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
      message = 'pgTAP concurrency test requires a non-loopback database connection so dblink uses password authentication';
  end if;
end
$assert_password_route$;

select is(
  extensions.dblink_connect(
    'phase1_c1',
    format(
      'hostaddr=%s port=%s dbname=%L user=%L password=%L application_name=pando_pgtap_phase1_c1',
      host(inet_server_addr()),
      current_setting('port'),
      current_database(),
      (select connection_role from phase1_concurrency_fixture),
      (select connection_password from phase1_concurrency_fixture)
    )
  ),
  'OK',
  'first independent database session connects'
);
select is(
  extensions.dblink_connect(
    'phase1_c2',
    format(
      'hostaddr=%s port=%s dbname=%L user=%L password=%L application_name=pando_pgtap_phase1_c2',
      host(inet_server_addr()),
      current_setting('port'),
      current_database(),
      (select connection_role from phase1_concurrency_fixture),
      (select connection_password from phase1_concurrency_fixture)
    )
  ),
  'OK',
  'second independent database session connects'
);
select is(
  extensions.dblink_exec(
    'phase1_c1',
    format('set request.jwt.claims = %L',(select claims from phase1_concurrency_fixture))
  ),
  'SET',
  'first session receives the authenticated subject'
);
select is(
  extensions.dblink_exec(
    'phase1_c2',
    format('set request.jwt.claims = %L',(select claims from phase1_concurrency_fixture))
  ),
  'SET',
  'second session receives the same authenticated subject'
);
select is(extensions.dblink_exec('phase1_c1','set role authenticated'),'SET','first session uses the ordinary authenticated role');
select is(extensions.dblink_exec('phase1_c2','set role authenticated'),'SET','second session uses the ordinary authenticated role');
select is(extensions.dblink_exec('phase1_c1','begin'),'BEGIN','first retry transaction begins');
select is(extensions.dblink_exec('phase1_c2','begin'),'BEGIN','second retry transaction begins');

insert into phase1_concurrency_results(caller,response)
select 'c1',command.response
from extensions.dblink(
  'phase1_c1',
  format(
    'select api.save_current_overlay_note_v1(%L,%L,%L,%L,%L)',
    'goal:phase1-concurrency',
    'competency:python-error-handling',
    'Concurrent note body stays private',
    '0',
    'phase1-concurrent-note'
  )
) as command(response jsonb);

select is(
  extensions.dblink_send_query(
    'phase1_c2',
    format(
      'select api.save_current_overlay_note_v1(%L,%L,%L,%L,%L)',
      'goal:phase1-concurrency',
      'competency:python-error-handling',
      'Concurrent note body stays private',
      '0',
      'phase1-concurrent-note'
    )
  ),
  1,
  'identical retry is dispatched concurrently before the first transaction commits'
);

do $wait_for_advisory_lock$
declare
  observed boolean := false;
begin
  for attempt in 1..200 loop
    select exists(
      select 1
      from pg_catalog.pg_stat_activity activity
      where activity.application_name='pando_pgtap_phase1_c2'
        and activity.wait_event_type='Lock'
        and activity.wait_event='advisory'
    ) into observed;
    exit when observed;
    perform pg_catalog.pg_sleep(0.01);
  end loop;
  insert into phase1_concurrency_observation values(observed);
end
$wait_for_advisory_lock$;

select ok(
  (select waited_on_advisory_lock from phase1_concurrency_observation),
  'second identical retry waits on the per-idempotency-key advisory lock'
);
select is(extensions.dblink_is_busy('phase1_c2'),1,'second retry remains blocked while first transaction is uncommitted');
select is(extensions.dblink_exec('phase1_c1','commit'),'COMMIT','first retry transaction commits');
insert into phase1_concurrency_results(caller,response)
select 'c2',command.response
from extensions.dblink_get_result('phase1_c2') as command(response jsonb);
select is(
  (select count(*) from extensions.dblink_get_result('phase1_c2') as command(response jsonb)),
  0::bigint,
  'second retry async result stream is fully drained before the next command'
);
select is(extensions.dblink_exec('phase1_c2','commit'),'COMMIT','second retry transaction commits its stored-response replay');
select is(extensions.dblink_disconnect('phase1_c1'),'OK','first independent session disconnects');
select is(extensions.dblink_disconnect('phase1_c2'),'OK','second independent session disconnects');

select is(
  (select response from phase1_concurrency_results where caller='c2'),
  (select response from phase1_concurrency_results where caller='c1'),
  'concurrent identical callers receive the exact same stored response'
);
select is(
  (select count(*) from outbox.command_receipts
    where actor_user_id=(select user_id from identity.users where auth_user_id=(select auth_user_id from phase1_concurrency_fixture))
      and command_type='overlay.save_note' and idempotency_key='phase1-concurrent-note'),
  1::bigint,
  'concurrent identical retry creates exactly one command receipt'
);
select is(
  (select count(*) from overlay.notes
    where workspace_id=(select workspace_id from phase1_concurrency_fixture)
      and subject_ref='competency:python-error-handling'),
  1::bigint,
  'concurrent identical retry creates exactly one authoritative note'
);
select is(
  (select count(*) from outbox.events
    where workspace_id=(select workspace_id from phase1_concurrency_fixture)
      and event_name='overlay.note_saved'),
  1::bigint,
  'concurrent identical retry emits exactly one event'
);
select is(
  (select aggregate_version from overlay.workspace_overlays
    where workspace_id=(select workspace_id from phase1_concurrency_fixture)),
  1::bigint,
  'concurrent identical retry increments the overlay exactly once'
);
select ok(
  not exists(
    select 1 from outbox.deliveries delivery
    join outbox.events event on event.event_id=delivery.event_id
    where event.workspace_id=(select workspace_id from phase1_concurrency_fixture)
      and event.event_name='overlay.note_saved'
  ),
  'concurrent Overlay event has zero deliveries without a real consumer'
);

create function pg_temp.reject_phase1_atomic_event()
returns trigger
language plpgsql
security definer
set search_path=''
as $function$
begin
  if new.workspace_id=(select workspace_id from pg_temp.phase1_concurrency_fixture)
     and new.event_name='overlay.note_saved'
     and new.payload->>'subject_ref'='competency:python-typing' then
    raise exception using errcode='P0001',message='pgTAP injected Phase 1 outbox failure';
  end if;
  return new;
end
$function$;
create trigger pgtap_reject_phase1_atomic_event
before insert on outbox.events
for each row execute function pg_temp.reject_phase1_atomic_event();

select set_config('request.jwt.claims',(select claims from phase1_concurrency_fixture),true);
set local role authenticated;
select throws_ok(
  format(
    'select api.save_current_overlay_note_v1(%L,%L,%L,%L,%L)',
    'goal:phase1-concurrency',
    'competency:python-typing',
    'This mutation must roll back with its event',
    '1',
    'phase1-atomic-failure'
  ),
  'P0001',
  'pgTAP injected Phase 1 outbox failure',
  'failure after state mutation but before outbox append aborts the command'
);
reset role;

drop trigger pgtap_reject_phase1_atomic_event on outbox.events;
drop function pg_temp.reject_phase1_atomic_event();

select is(
  (select aggregate_version from overlay.workspace_overlays
    where workspace_id=(select workspace_id from phase1_concurrency_fixture)),
  1::bigint,
  'outbox failure rolls back the overlay aggregate-version increment'
);
select is(
  (select count(*) from overlay.notes
    where workspace_id=(select workspace_id from phase1_concurrency_fixture)
      and subject_ref='competency:python-typing'),
  0::bigint,
  'outbox failure rolls back the authoritative note mutation'
);
select is(
  (select count(*) from outbox.command_receipts
    where workspace_id=(select workspace_id from phase1_concurrency_fixture)
      and idempotency_key='phase1-atomic-failure'),
  0::bigint,
  'outbox failure leaves no command receipt'
);
select is(
  (select count(*) from outbox.events
    where workspace_id=(select workspace_id from phase1_concurrency_fixture)
      and payload->>'subject_ref'='competency:python-typing'),
  0::bigint,
  'outbox failure leaves no event'
);
select is(
  (select count(*) from outbox.deliveries delivery
    join outbox.events event on event.event_id=delivery.event_id
    where event.workspace_id=(select workspace_id from phase1_concurrency_fixture)
      and event.payload->>'subject_ref'='competency:python-typing'),
  0::bigint,
  'outbox failure leaves no delivery'
);

select * from finish();
commit;

do $drop_dblink_role$
declare
  connection_role text;
begin
  select fixture.connection_role
  into strict connection_role
  from phase1_concurrency_fixture as fixture;
  execute format('drop role %I',connection_role);
end
$drop_dblink_role$;
