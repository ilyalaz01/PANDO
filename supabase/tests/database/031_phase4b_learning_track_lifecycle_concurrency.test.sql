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

create temporary table track_lifecycle_concurrency_fixture (
  auth_user_id uuid not null,
  claims text not null,
  workspace_id uuid,
  growth_plan_id uuid,
  track_key text,
  preview jsonb,
  capacity_preview jsonb
) on commit preserve rows;
create temporary table track_lifecycle_concurrency_connection (
  connection_role text primary key,
  connection_password text not null
) on commit preserve rows;
create temporary table track_lifecycle_concurrency_error (
  returned_state text,
  returned_message text
) on commit preserve rows;
create temporary table track_lifecycle_concurrency_observation (
  waited_on_advisory_lock boolean not null
) on commit preserve rows;
grant select, update on track_lifecycle_concurrency_fixture to authenticated;

insert into track_lifecycle_concurrency_fixture (auth_user_id, claims) values (
  'd6000000-0000-4000-8000-000000000001',
  pg_catalog.jsonb_build_object(
    'sub', 'd6000000-0000-4000-8000-000000000001',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text
);
insert into track_lifecycle_concurrency_connection values (
  'pando_pgtap_track_' || left(replace(gen_random_uuid()::text, '-', ''), 16),
  gen_random_uuid()::text
);

do $create_dblink_role$
declare fixture record;
begin
  select * into strict fixture from track_lifecycle_concurrency_connection;
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
  'd6000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'track-lifecycle-concurrency@pando.test', '', clock_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  clock_timestamp(), clock_timestamp()
);

create temporary table track_lifecycle_concurrency_setup (
  result_name text primary key,
  response jsonb not null
) on commit preserve rows;
grant select, insert on track_lifecycle_concurrency_setup to authenticated;

select set_config(
  'request.jwt.claims',
  (select claims from track_lifecycle_concurrency_fixture),
  true
);
set local role authenticated;
insert into track_lifecycle_concurrency_setup values (
  'bootstrap', api.bootstrap_personal_workspace(
    'phase4b-track-lifecycle-concurrency', 'Track lifecycle concurrency'
  )
);
insert into track_lifecycle_concurrency_setup
select 'goal', api.create_readiness_goal(
  (response->>'workspace_id')::uuid,
  'goal:track-lifecycle-concurrency', 'Track lifecycle concurrency',
  'target:nvidia-python-verification-base-v1',
  'phase4b-track-lifecycle-concurrency-goal'
)
from track_lifecycle_concurrency_setup where result_name = 'bootstrap';
insert into track_lifecycle_concurrency_setup values (
  'plan', pg_temp.initialize_growth_plan_fixture_v1(
    'goal:track-lifecycle-concurrency', 600, 25, 80, 120,
    'phase4b-track-lifecycle-concurrency-plan'
  )
);
reset role;

insert into planning.learning_tracks (
  learning_track_id, workspace_id, growth_plan_id, track_key, title,
  readiness_goal_id, profile_version_id, roadmap_version_id, lifecycle,
  priority, protected_minimum_minutes, default_session_minutes, aggregate_version
)
select
  'd6000000-0000-4000-8000-000000000010', source.workspace_id,
  source.growth_plan_id, 'track:concurrent-resume', 'Concurrent resume',
  source.readiness_goal_id, source.profile_version_id, source.roadmap_version_id,
  'paused', 70, 400, source.default_session_minutes, 1
from planning.learning_tracks as source
where source.growth_plan_id = (
  select (response->>'growthPlanId')::uuid
  from track_lifecycle_concurrency_setup where result_name = 'plan'
);

update track_lifecycle_concurrency_fixture as fixture
set workspace_id = (setup.response->>'workspaceId')::uuid,
  growth_plan_id = (setup.response->>'growthPlanId')::uuid,
  track_key = 'track:concurrent-resume'
from track_lifecycle_concurrency_setup as setup
where setup.result_name = 'plan';

set local role authenticated;
update track_lifecycle_concurrency_fixture
set preview = api.preview_learning_track_lifecycle_v1(
  'track:concurrent-resume', 'resume_track', '1', '1',
  'Resume while capacity may change.'
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
      message = 'Track lifecycle concurrency test requires a non-loopback password-authenticated connection';
  end if;
end
$assert_password_route$;

select is(
  extensions.dblink_connect(
    connection_name,
    pg_catalog.format(
      'hostaddr=%s port=%s dbname=%L user=%L password=%L application_name=pando_pgtap_track_%s',
      host(inet_server_addr()), current_setting('port'), current_database(),
      (select connection_role from track_lifecycle_concurrency_connection),
      (select connection_password from track_lifecycle_concurrency_connection),
      connection_name
    )
  ),
  'OK', connection_name || ' connects'
)
from unnest(array['track_c1', 'track_c2']) as connection(connection_name);

select is(
  extensions.dblink_exec(
    connection_name,
    pg_catalog.format(
      'set request.jwt.claims = %L',
      (select claims from track_lifecycle_concurrency_fixture)
    )
  ),
  'SET', connection_name || ' receives actor claims'
)
from unnest(array['track_c1', 'track_c2']) as connection(connection_name);
select is(
  extensions.dblink_exec(connection_name, 'set role authenticated'),
  'SET', connection_name || ' uses authenticated'
)
from unnest(array['track_c1', 'track_c2']) as connection(connection_name);
select is(
  extensions.dblink_exec(connection_name, 'begin'),
  'BEGIN', connection_name || ' begins transaction'
)
from unnest(array['track_c1', 'track_c2']) as connection(connection_name);

select ok(
  response.response#>>'{changedPlan,aggregateVersion}' = '2'
    and response.response#>>'{changedPlan,weeklyCapacityMinutes}' = '300',
  'D2a capacity winner is staged while holding the shared Planning workspace lock'
)
from extensions.dblink(
  'track_c1',
  $$select api.apply_growth_plan_capacity_v1(
    300, '1',
    (api.preview_growth_plan_capacity_v1(
      300, '1', 'Reduce capacity before Track resume.'
    )->>'previewDigest'),
    'Reduce capacity before Track resume.',
    'phase4b-track-concurrency-capacity-winner'
  )$$
) as response(response jsonb);

select is(
  extensions.dblink_send_query(
    'track_c2',
    pg_catalog.format(
      'select api.apply_learning_track_lifecycle_v1(%L,%L,%L,%L,%L,%L,%L)',
      (select track_key from track_lifecycle_concurrency_fixture),
      'resume_track', '1', '1',
      (select preview->>'previewDigest' from track_lifecycle_concurrency_fixture),
      'Resume while capacity may change.',
      'phase4b-track-concurrency-resume-loser'
    )
  ),
  1,
  'Track resume is dispatched before the D2a capacity transaction commits'
);

do $wait_for_workspace_lock$
declare observed boolean := false;
begin
  for attempt in 1..200 loop
    select exists (
      select 1
      from pg_catalog.pg_stat_activity
      where application_name = 'pando_pgtap_track_track_c2'
        and wait_event_type = 'Lock'
        and wait_event = 'advisory'
    ) into observed;
    exit when observed;
    perform pg_catalog.pg_sleep(0.01);
  end loop;
  insert into track_lifecycle_concurrency_observation values (observed);
end
$wait_for_workspace_lock$;

select ok(
  (select waited_on_advisory_lock from track_lifecycle_concurrency_observation),
  'D2a capacity and D2b1 resume serialize on the same Planning workspace lock'
);
select is(
  extensions.dblink_exec('track_c1', 'commit'),
  'COMMIT',
  'D2a capacity winner commits first'
);

do $collect_resume_error$
declare v_state text;
declare v_message text;
begin
  begin
    perform response.response
    from extensions.dblink_get_result('track_c2') as response(response jsonb);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
  end;
  perform count(*)
  from extensions.dblink_get_result('track_c2') as response(response jsonb);
  insert into track_lifecycle_concurrency_error values (v_state, v_message);
end
$collect_resume_error$;
select is(
  extensions.dblink_exec('track_c2', 'rollback'),
  'ROLLBACK',
  'stale Track resume rolls back'
);

select is(
  (select returned_state from track_lifecycle_concurrency_error),
  '40001',
  'delayed Track resume receives the optimistic concurrency SQL state'
);
select is(
  (select returned_message from track_lifecycle_concurrency_error),
  'Growth Plan version is stale',
  'D2a version change wins before any recomputed resume-capacity decision'
);
select is(
  (
    select lifecycle
    from planning.learning_tracks
    where workspace_id = (select workspace_id from track_lifecycle_concurrency_fixture)
      and track_key = 'track:concurrent-resume'
  ),
  'paused',
  'losing concurrent resume leaves the Track paused'
);
select is(
  (
    select count(*)::bigint
    from outbox.command_receipts
    where idempotency_key = 'phase4b-track-concurrency-resume-loser'
  ),
  0::bigint,
  'losing concurrent resume leaves no receipt'
);

-- Reverse the interleaving: a committed resume must stale a capacity preview through the
-- active-Track fingerprint even though the Track command does not advance the Plan version.
select ok(
  response.response#>>'{changedPlan,aggregateVersion}' = '3'
    and response.response#>>'{changedPlan,weeklyCapacityMinutes}' = '600',
  'capacity is restored before the reverse interleaving'
)
from extensions.dblink(
  'track_c1',
  $$select api.apply_growth_plan_capacity_v1(
    600, '2',
    (api.preview_growth_plan_capacity_v1(
      600, '2', 'Restore capacity before reverse race.'
    )->>'previewDigest'),
    'Restore capacity before reverse race.',
    'phase4b-track-concurrency-capacity-restore'
  )$$
) as response(response jsonb);

select set_config(
  'request.jwt.claims',
  (select claims from track_lifecycle_concurrency_fixture),
  true
);
set local role authenticated;
update track_lifecycle_concurrency_fixture
set preview = api.preview_learning_track_lifecycle_v1(
    'track:concurrent-resume', 'resume_track', '3', '1',
    'Resume before a stale capacity change.'
  ),
  capacity_preview = api.preview_growth_plan_capacity_v1(
    300, '3', 'Lower capacity only if active Tracks are unchanged.'
  );
reset role;

truncate track_lifecycle_concurrency_error;
truncate track_lifecycle_concurrency_observation;
select is(
  extensions.dblink_exec(connection_name, 'begin'),
  'BEGIN', connection_name || ' begins reverse transaction'
)
from unnest(array['track_c1', 'track_c2']) as connection(connection_name);

select ok(
  response.response#>>'{changedTrack,lifecycle}' = 'ACTIVE'
    and response.response#>>'{changedTrack,aggregateVersion}' = '2',
  'Track resume winner is staged while holding the shared Planning workspace lock'
)
from extensions.dblink(
  'track_c1',
  pg_catalog.format(
    'select api.apply_learning_track_lifecycle_v1(%L,%L,%L,%L,%L,%L,%L)',
    (select track_key from track_lifecycle_concurrency_fixture),
    'resume_track', '3', '1',
    (select preview->>'previewDigest' from track_lifecycle_concurrency_fixture),
    'Resume before a stale capacity change.',
    'phase4b-track-concurrency-resume-winner'
  )
) as response(response jsonb);

select is(
  extensions.dblink_send_query(
    'track_c2',
    pg_catalog.format(
      'select api.apply_growth_plan_capacity_v1(%s,%L,%L,%L,%L)',
      300, '3',
      (select capacity_preview->>'previewDigest'
       from track_lifecycle_concurrency_fixture),
      'Lower capacity only if active Tracks are unchanged.',
      'phase4b-track-concurrency-capacity-loser'
    )
  ),
  1,
  'capacity apply is dispatched before the Track resume transaction commits'
);

do $wait_for_reverse_workspace_lock$
declare observed boolean := false;
begin
  for attempt in 1..200 loop
    select exists (
      select 1
      from pg_catalog.pg_stat_activity
      where application_name = 'pando_pgtap_track_track_c2'
        and wait_event_type = 'Lock'
        and wait_event = 'advisory'
    ) into observed;
    exit when observed;
    perform pg_catalog.pg_sleep(0.01);
  end loop;
  insert into track_lifecycle_concurrency_observation values (observed);
end
$wait_for_reverse_workspace_lock$;

select ok(
  (select waited_on_advisory_lock from track_lifecycle_concurrency_observation),
  'reverse D2b1 resume and D2a capacity race uses the same Planning workspace lock'
);
select is(
  extensions.dblink_exec('track_c1', 'commit'),
  'COMMIT',
  'Track resume winner commits first'
);

do $collect_capacity_error$
declare v_state text;
declare v_message text;
begin
  begin
    perform response.response
    from extensions.dblink_get_result('track_c2') as response(response jsonb);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
  end;
  perform count(*)
  from extensions.dblink_get_result('track_c2') as response(response jsonb);
  insert into track_lifecycle_concurrency_error values (v_state, v_message);
end
$collect_capacity_error$;
select is(
  extensions.dblink_exec('track_c2', 'rollback'),
  'ROLLBACK',
  'fingerprint-stale capacity apply rolls back'
);

select is(
  (select returned_state from track_lifecycle_concurrency_error),
  '40001',
  'delayed capacity apply receives the optimistic concurrency SQL state'
);
select is(
  (select returned_message from track_lifecycle_concurrency_error),
  'Growth Plan preview is stale',
  'committed resume invalidates the old D2a active-Track fingerprint'
);
select ok(
  (
    select track.lifecycle = 'active'
      and track.aggregate_version = 2
      and plan.weekly_capacity_minutes = 600
      and plan.aggregate_version = 3
    from planning.learning_tracks as track
    join planning.growth_plans as plan
      on plan.workspace_id = track.workspace_id
      and plan.growth_plan_id = track.growth_plan_id
    where track.workspace_id = (select workspace_id from track_lifecycle_concurrency_fixture)
      and track.track_key = 'track:concurrent-resume'
  ),
  'resume winner persists while the stale capacity proposal changes no Plan state'
);
select is(
  (
    select count(*)::bigint
    from outbox.command_receipts
    where idempotency_key = 'phase4b-track-concurrency-capacity-loser'
  ),
  0::bigint,
  'losing reverse capacity attempt leaves no receipt'
);

select is(
  extensions.dblink_disconnect(connection_name),
  'OK', connection_name || ' disconnects cleanly'
)
from unnest(array['track_c1', 'track_c2']) as connection(connection_name);

select * from finish();
commit;

do $drop_dblink_role$
declare v_connection_role text;
begin
  select connection_role into strict v_connection_role
  from track_lifecycle_concurrency_connection;
  execute pg_catalog.format('drop role %I', v_connection_role);
end
$drop_dblink_role$;
