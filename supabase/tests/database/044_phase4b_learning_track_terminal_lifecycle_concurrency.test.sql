begin;

create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set local search_path = public, extensions;
select no_plan();

create function pg_temp.initialize_terminal_fixture_v1(
  p_goal_key text, p_idempotency_key text
) returns jsonb language sql security definer set search_path = '' as $function$
  select api.initialize_growth_plan_v1(p_goal_key, 600, 30, 80, 0, p_idempotency_key)
$function$;
revoke all on function pg_temp.initialize_terminal_fixture_v1(text,text)
  from public, anon, authenticated, service_role;
grant execute on function pg_temp.initialize_terminal_fixture_v1(text,text) to authenticated;

create temporary table terminal_cases(
  case_name text primary key, auth_user_id uuid not null, claims text not null,
  workspace_id uuid, track_key text, plan_version text, track_version text,
  archive_preview jsonb, complete_preview jsonb, sibling_key text, settings_preview jsonb
);
create temporary table terminal_connections(connection_role text primary key, connection_password text not null);
create temporary table terminal_results(case_name text, caller text, response jsonb, primary key(case_name,caller));
create temporary table terminal_errors(case_name text primary key, sqlstate text, message text);
create temporary table terminal_waits(case_name text primary key, waited boolean not null);
grant select, update on terminal_cases to authenticated;
grant select, insert on terminal_results to authenticated;
grant select, insert on terminal_errors, terminal_waits to authenticated;

insert into terminal_cases(case_name, auth_user_id, claims) values
 ('same-key','44000000-0000-4000-8000-000000000001',
  pg_catalog.jsonb_build_object('sub','44000000-0000-4000-8000-000000000001','role','authenticated','aud','authenticated','exp',extract(epoch from clock_timestamp()+interval '1 hour')::bigint)::text),
 ('distinct','44000000-0000-4000-8000-000000000002',
  pg_catalog.jsonb_build_object('sub','44000000-0000-4000-8000-000000000002','role','authenticated','aud','authenticated','exp',extract(epoch from clock_timestamp()+interval '1 hour')::bigint)::text),
 ('settings','44000000-0000-4000-8000-000000000003',
  pg_catalog.jsonb_build_object('sub','44000000-0000-4000-8000-000000000003','role','authenticated','aud','authenticated','exp',extract(epoch from clock_timestamp()+interval '1 hour')::bigint)::text);
insert into terminal_connections values ('pando_pgtap_terminal_'||left(replace(gen_random_uuid()::text,'-',''),16), gen_random_uuid()::text);

do $create_role$
declare c record;
begin
  select * into strict c from terminal_connections;
  execute format('create role %I login noinherit password %L',c.connection_role,c.connection_password);
  execute format('grant authenticated to %I',c.connection_role);
end $create_role$;

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select auth_user_id,'authenticated','authenticated',case_name||'@terminal.pando.test','',clock_timestamp(),'{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,clock_timestamp(),clock_timestamp()
from terminal_cases;

do $setup$
declare c record; b jsonb; g jsonb; p jsonb; s jsonb;
begin
  for c in select * from terminal_cases order by case_name loop
    perform set_config('request.jwt.claims',c.claims,true); set local role authenticated;
    b := api.bootstrap_personal_workspace('terminal-'||c.case_name,'Terminal '||c.case_name);
    g := api.create_readiness_goal((b->>'workspace_id')::uuid,'goal:terminal-'||c.case_name,'Terminal goal','target:nvidia-python-verification-base-v1','terminal-goal-'||c.case_name);
    p := pg_temp.initialize_terminal_fixture_v1('goal:terminal-'||c.case_name,'terminal-plan-'||c.case_name);
    s := api.get_current_learning_tracks_v1();
    update terminal_cases set workspace_id=(b->>'workspace_id')::uuid,
      track_key=s#>>'{learningTracks,0,trackKey}', plan_version=s#>>'{growthPlan,aggregateVersion}',
      track_version=s#>>'{learningTracks,0,aggregateVersion}',
      archive_preview=api.preview_learning_track_terminal_lifecycle_v1(s#>>'{learningTracks,0,trackKey}','archive_track',s#>>'{growthPlan,aggregateVersion}',s#>>'{learningTracks,0,aggregateVersion}','Archive race.'),
      complete_preview=api.preview_learning_track_terminal_lifecycle_v1(s#>>'{learningTracks,0,trackKey}','complete_track',s#>>'{growthPlan,aggregateVersion}',s#>>'{learningTracks,0,aggregateVersion}','Complete race.')
    where case_name=c.case_name;
    reset role;
  end loop;
end $setup$;
reset role;
insert into planning.learning_tracks (
  learning_track_id, workspace_id, growth_plan_id, track_key, title,
  readiness_goal_id, profile_version_id, roadmap_version_id, lifecycle,
  priority, protected_minimum_minutes, default_session_minutes, aggregate_version
)
select case fixture.case_name when 'same-key' then '44000000-0000-4000-8000-000000000011'::uuid else '44000000-0000-4000-8000-000000000012'::uuid end, track.workspace_id,
  track.growth_plan_id, case fixture.case_name when 'same-key' then 'track:terminal-settings-sibling' else 'track:terminal-settings-sibling-2' end, 'Terminal settings sibling',
  track.readiness_goal_id, track.profile_version_id, track.roadmap_version_id,
  'active', 40, 0, track.default_session_minutes, 1
from planning.learning_tracks as track
join terminal_cases as fixture
  on fixture.case_name in ('same-key','settings')
 and fixture.track_key = track.track_key
where track.workspace_id = fixture.workspace_id;
do $preview_cases$
declare c record; v_sibling_key text;
begin
  for c in select * from terminal_cases where case_name in ('same-key','settings') order by case_name loop
    perform set_config('request.jwt.claims',c.claims,true);
    set local role authenticated;
    v_sibling_key := case when c.case_name='same-key' then 'track:terminal-settings-sibling' else 'track:terminal-settings-sibling-2' end;
    update terminal_cases
    set sibling_key = v_sibling_key,
        archive_preview = api.preview_learning_track_terminal_lifecycle_v1(
          track_key, 'archive_track', plan_version, track_version, 'Archive race.'
        ),
        settings_preview = api.preview_learning_track_priority_minimum_v1(
          v_sibling_key, 45, 0, plan_version, '1', 'Sibling settings race.'
        )
    where case_name=c.case_name;
    reset role;
  end loop;
end
$preview_cases$;
commit;

begin;
set local search_path = public, extensions;

select is(extensions.dblink_connect(n,format('hostaddr=%s port=%s dbname=%L user=%L password=%L application_name=pando_terminal_%s',host(inet_server_addr()),current_setting('port'),current_database(),c.connection_role,c.connection_password,n)),'OK',n||' connects')
from terminal_connections c cross join unnest(array['terminal_c1','terminal_c2']) n;
select is(extensions.dblink_exec(n,format('set request.jwt.claims = %L',(select claims from terminal_cases where case_name='same-key'))),'SET',n||' gets claims') from unnest(array['terminal_c1','terminal_c2']) n;
select is(extensions.dblink_exec(n,'set role authenticated'),'SET',n||' uses authenticated') from unnest(array['terminal_c1','terminal_c2']) n;
select is(extensions.dblink_exec(n,'begin'),'BEGIN',n||' begins same-key transaction') from unnest(array['terminal_c1','terminal_c2']) n;

insert into terminal_results
select 'same-key','c1',r.response
from terminal_cases c
cross join lateral dblink('terminal_c1',format('select api.apply_learning_track_terminal_lifecycle_v1(%L,%L,%L,%L,%L,%L,%L)',c.track_key,'archive_track',c.plan_version,c.track_version,c.archive_preview->>'previewDigest','Archive race.','44000000-0000-4000-8000-000000000101')) r(response jsonb)
where c.case_name='same-key';
select is(extensions.dblink_send_query('terminal_c2',format('select api.apply_learning_track_terminal_lifecycle_v1(%L,%L,%L,%L,%L,%L,%L)',track_key,'archive_track',plan_version,track_version,archive_preview->>'previewDigest','Archive race.','44000000-0000-4000-8000-000000000101')),1,'identical archive is dispatched before winner commit') from terminal_cases where case_name='same-key';
do $wait$
declare waited boolean:=false; begin for i in 1..200 loop select exists(select 1 from pg_stat_activity where application_name='pando_terminal_terminal_c2' and wait_event_type='Lock' and wait_event='advisory') into waited; exit when waited; perform pg_sleep(.01); end loop; insert into terminal_waits values('same-key',waited); end $wait$;
select ok(waited,'same-key replay waits on idempotency lock') from terminal_waits where case_name='same-key';
select is(extensions.dblink_exec('terminal_c1','commit'),'COMMIT','same-key winner commits');
insert into terminal_results select 'same-key','c2',r.response from dblink_get_result('terminal_c2') r(response jsonb);
do $drain_same$
begin
  perform count(*) from dblink_get_result('terminal_c2') r(response jsonb);
end
$drain_same$;
select is(extensions.dblink_exec('terminal_c2','commit'),'COMMIT','same-key replay commits');
select is((select response from terminal_results where case_name='same-key' and caller='c2'),(select response from terminal_results where case_name='same-key' and caller='c1'),'same-key replay is byte-identical');
select is((select lifecycle from planning.learning_tracks where track_key=(select track_key from terminal_cases where case_name='same-key')),'archived','terminal winner leaves one archived Track');
select is((select aggregate_version from planning.learning_tracks where track_key=(select track_key from terminal_cases where case_name='same-key')),2::bigint,'same-key increments Track exactly once');
select is((select count(*) from outbox.command_receipts where workspace_id=(select workspace_id from terminal_cases where case_name='same-key') and command_type='planning.change_learning_track_terminal_lifecycle_v1'),1::bigint,'same-key writes one terminal receipt');
select is((select count(*) from outbox.command_receipts where workspace_id=(select workspace_id from terminal_cases where case_name='same-key') and idempotency_key='44000000-0000-4000-8000-000000000101'),1::bigint,'same-key leaves one terminal receipt');

select is(extensions.dblink_exec(n,format('set request.jwt.claims = %L',(select claims from terminal_cases where case_name='settings'))),'SET',n||' gets settings claims') from unnest(array['terminal_c1','terminal_c2']) n;
select is(extensions.dblink_exec(n,'begin'),'BEGIN',n||' begins terminal versus settings transaction') from unnest(array['terminal_c1','terminal_c2']) n;
insert into terminal_results
select 'settings','c1',r.response
from terminal_cases c
cross join lateral dblink('terminal_c1',format('select api.apply_learning_track_terminal_lifecycle_v1(%L,%L,%L,%L,%L,%L,%L)',c.track_key,'archive_track',c.plan_version,c.track_version,c.archive_preview->>'previewDigest','Archive race.','44000000-0000-4000-8000-000000000201')) r(response jsonb)
where c.case_name='settings';
select is(extensions.dblink_send_query('terminal_c2',format('select api.apply_learning_track_priority_minimum_v1(%L,%s,%s,%L,%L,%L,%L,%L)',sibling_key,45,0,plan_version,'1',settings_preview->>'previewDigest','Sibling settings race.','44000000-0000-4000-8000-000000000202')),1,'settings loser is dispatched before terminal commit') from terminal_cases where case_name='settings';
do $wait_settings$
declare waited boolean:=false; begin for i in 1..200 loop select exists(select 1 from pg_stat_activity where application_name='pando_terminal_terminal_c2' and wait_event_type='Lock' and wait_event='advisory') into waited; exit when waited; perform pg_sleep(.01); end loop; insert into terminal_waits values('settings',waited); end $wait_settings$;
select ok(waited,'settings loser waits on shared workspace lock') from terminal_waits where case_name='settings';
select is(extensions.dblink_exec('terminal_c1','commit'),'COMMIT','settings terminal winner commits');
do $collect_settings$
declare s text; m text; begin begin perform x.response from dblink_get_result('terminal_c2') x(response jsonb); exception when others then get stacked diagnostics s=returned_sqlstate,m=message_text; end; perform count(*) from dblink_get_result('terminal_c2') x(response jsonb); insert into terminal_errors values('settings',s,m); end $collect_settings$;
select is(extensions.dblink_exec('terminal_c2','rollback'),'ROLLBACK','stale settings loser rolls back');
select is((select sqlstate from terminal_errors where case_name='settings'),'40001','settings loser is optimistic-concurrency stale');
select is((select message from terminal_errors where case_name='settings'),'Learning Track priority and minimum preview is stale','settings loser reports exact stale error');
select is((select lifecycle from planning.learning_tracks where track_key=(select track_key from terminal_cases where case_name='settings')),'archived','settings race terminal winner persists');
select is((select aggregate_version from planning.learning_tracks where track_key=(select track_key from terminal_cases where case_name='settings')),2::bigint,'settings race terminal Track increments once');
select is((select priority from planning.learning_tracks where track_key=(select sibling_key from terminal_cases where case_name='settings')),40::smallint,'settings loser leaves sibling unchanged');
select is((select aggregate_version from planning.learning_tracks where track_key=(select sibling_key from terminal_cases where case_name='settings')),1::bigint,'settings loser leaves sibling version unchanged');
select is((select count(*) from outbox.command_receipts where workspace_id=(select workspace_id from terminal_cases where case_name='settings') and command_type='planning.set_learning_track_priority_minimum'),0::bigint,'settings loser writes no receipt');
select is((select count(*) from outbox.events where workspace_id=(select workspace_id from terminal_cases where case_name='settings') and aggregate_id=(select learning_track_id from planning.learning_tracks where track_key=(select sibling_key from terminal_cases where case_name='settings')) and event_name='planning.input_changed'),0::bigint,'settings loser writes no event');
select is((select count(*) from outbox.deliveries d join outbox.events e on e.event_id=d.event_id and e.workspace_id=d.workspace_id where d.workspace_id=(select workspace_id from terminal_cases where case_name='settings') and e.aggregate_id=(select learning_track_id from planning.learning_tracks where track_key=(select sibling_key from terminal_cases where case_name='settings')) and e.event_name='planning.input_changed'),0::bigint,'settings loser writes no delivery');

select is(extensions.dblink_exec(n,format('set request.jwt.claims = %L',(select claims from terminal_cases where case_name='distinct'))),'SET',n||' gets distinct claims') from unnest(array['terminal_c1','terminal_c2']) n;
select is(extensions.dblink_exec(n,'begin'),'BEGIN',n||' begins distinct transaction') from unnest(array['terminal_c1','terminal_c2']) n;
insert into terminal_results
select 'distinct','c1',r.response
from terminal_cases c
cross join lateral dblink('terminal_c1',format('select api.apply_learning_track_terminal_lifecycle_v1(%L,%L,%L,%L,%L,%L,%L)',c.track_key,'complete_track',c.plan_version,c.track_version,c.complete_preview->>'previewDigest','Complete race.','44000000-0000-4000-8000-000000000301')) r(response jsonb)
where c.case_name='distinct';
select is(extensions.dblink_send_query('terminal_c2',format('select api.apply_learning_track_terminal_lifecycle_v1(%L,%L,%L,%L,%L,%L,%L)',track_key,'archive_track',plan_version,track_version,archive_preview->>'previewDigest','Archive race.','44000000-0000-4000-8000-000000000302')),1,'distinct archive is dispatched before complete commit') from terminal_cases where case_name='distinct';
do $wait2$
declare waited boolean:=false; begin for i in 1..200 loop select exists(select 1 from pg_stat_activity where application_name='pando_terminal_terminal_c2' and wait_event_type='Lock' and wait_event='advisory') into waited; exit when waited; perform pg_sleep(.01); end loop; insert into terminal_waits values('distinct',waited); end $wait2$;
select ok(waited,'distinct terminal commands wait on shared workspace lock') from terminal_waits where case_name='distinct';
select is(extensions.dblink_exec('terminal_c1','commit'),'COMMIT','complete winner commits');
do $collect$
declare s text; m text; begin begin perform x.response from dblink_get_result('terminal_c2') x(response jsonb); exception when others then get stacked diagnostics s=returned_sqlstate,m=message_text; end; perform count(*) from dblink_get_result('terminal_c2') x(response jsonb); insert into terminal_errors values('distinct',s,m); end $collect$;
select is(extensions.dblink_exec('terminal_c2','rollback'),'ROLLBACK','stale archive rolls back');
select is((select sqlstate from terminal_errors where case_name='distinct'),'40001','distinct loser is optimistic-concurrency stale');
select is((select lifecycle from planning.learning_tracks where workspace_id=(select workspace_id from terminal_cases where case_name='distinct')),'completed','complete winner persists');
select is((select count(*) from outbox.command_receipts where workspace_id=(select workspace_id from terminal_cases where case_name='distinct') and command_type='planning.change_learning_track_terminal_lifecycle_v1'),1::bigint,'distinct race writes one receipt');

select is(extensions.dblink_disconnect(n),'OK',n||' disconnects') from unnest(array['terminal_c1','terminal_c2']) n;
select * from finish(); commit;
do $drop$
declare r text; begin select connection_role into strict r from terminal_connections; execute format('drop role %I',r); end $drop$;
