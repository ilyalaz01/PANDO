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

create temporary table destination_admission_concurrency_users (
  case_name text primary key,
  auth_user_id uuid not null,
  workspace_id uuid,
  claims text not null
) on commit preserve rows;
create temporary table destination_admission_concurrency_connection (
  connection_role text primary key,
  connection_password text not null
) on commit preserve rows;
create temporary table destination_admission_concurrency_results (
  result_name text primary key,
  response jsonb not null
) on commit preserve rows;
grant select on destination_admission_concurrency_users, destination_admission_concurrency_results
  to authenticated;
grant insert on destination_admission_concurrency_results to authenticated;

insert into destination_admission_concurrency_users values
  (
    'same-key', '47000000-0000-4000-8000-000000000001', null,
    pg_catalog.jsonb_build_object(
      'sub', '47000000-0000-4000-8000-000000000001',
      'role', 'authenticated', 'aud', 'authenticated',
      'exp', extract(epoch from pg_catalog.clock_timestamp() + interval '1 hour')::bigint
    )::text
  ),
  (
    'settings-race', '47000000-0000-4000-8000-000000000002', null,
    pg_catalog.jsonb_build_object(
      'sub', '47000000-0000-4000-8000-000000000002',
      'role', 'authenticated', 'aud', 'authenticated',
      'exp', extract(epoch from pg_catalog.clock_timestamp() + interval '1 hour')::bigint
    )::text
  );
insert into destination_admission_concurrency_connection values (
  'pando_pgtap_destination_' || pg_catalog.left(pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', ''), 16),
  pg_catalog.gen_random_uuid()::text
);

do $create_dblink_role$
declare
  fixture record;
begin
  select * into strict fixture from destination_admission_concurrency_connection;
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
)
select auth_user_id, 'authenticated', 'authenticated',
  case_name || '-destination-admission-concurrency@pando.test', '',
  pg_catalog.clock_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
from destination_admission_concurrency_users;

select set_config(
  'request.jwt.claims',
  (select claims from destination_admission_concurrency_users where case_name = 'same-key'),
  true
);
set local role authenticated;
insert into destination_admission_concurrency_results values (
  'same-bootstrap', api.bootstrap_personal_workspace(
    'destination-admission-concurrency-same', 'Destination admission same key'
  )
);
insert into destination_admission_concurrency_results
select 'same-goal', api.create_readiness_goal(
  (select (response->>'workspace_id')::uuid from destination_admission_concurrency_results
   where result_name = 'same-bootstrap'),
  'goal:destination-admission-same', 'Destination admission same key',
  'target:nvidia-python-verification-base-v1', 'destination-admission-same-goal'
);
insert into destination_admission_concurrency_results values (
  'same-plan', pg_temp.initialize_growth_plan_fixture_v1(
    'goal:destination-admission-same', 'destination-admission-same-plan'
  )
);
insert into destination_admission_concurrency_results values (
  'same-track-create-source', api.get_learning_track_creation_source_v1()
);
insert into destination_admission_concurrency_results values (
  'same-track-b', pg_temp.create_learning_track_fixture_v1(
    'goal:destination-admission-same',
    (
      select goal->>'aggregateVersion'
      from destination_admission_concurrency_results,
        lateral pg_catalog.jsonb_array_elements(response->'goals') as goal
      where result_name = 'same-track-create-source'
        and goal->>'readinessGoalKey' = 'goal:destination-admission-same'
    ),
    'Same key sibling', 60, 25,
    (select response#>>'{growthPlan,aggregateVersion}'
     from destination_admission_concurrency_results where result_name = 'same-track-create-source'),
    'Create a second Track.', '10000000-0000-4000-8000-000000000101'
  )
);
insert into destination_admission_concurrency_results values (
  'same-activity', api.add_current_custom_activity_v1(
    'goal:destination-admission-same', 'activity:destination-concurrency-same',
    'Same-key activity', 'PROJECT', 'competency:python-error-handling',
    '0', 'destination-concurrency-same-activity'
  )
);
insert into destination_admission_concurrency_results values (
  'same-source', api.get_learning_track_activity_admission_source_v2(
    (select response#>>'{createdTrack,trackKey}'
     from destination_admission_concurrency_results where result_name = 'same-track-b')
  )
);
insert into destination_admission_concurrency_results
select 'same-preview', api.preview_learning_track_activity_admission_v2(
  (select response#>>'{selectedTrack,trackKey}'
   from destination_admission_concurrency_results where result_name = 'same-source'),
  'activity:destination-concurrency-same', 45, 'MEDIUM',
  (select response#>>'{growthPlan,aggregateVersion}'
   from destination_admission_concurrency_results where result_name = 'same-source'),
  (select response#>>'{selectedTrack,aggregateVersion}'
   from destination_admission_concurrency_results where result_name = 'same-source'),
  'Apply the same destination-aware preview concurrently.',
  '11000000-0000-4000-8000-000000000001'
);
reset role;

select set_config(
  'request.jwt.claims',
  (select claims from destination_admission_concurrency_users where case_name = 'settings-race'),
  true
);
set local role authenticated;
insert into destination_admission_concurrency_results values (
  'race-bootstrap', api.bootstrap_personal_workspace(
    'destination-admission-concurrency-race', 'Destination admission settings race'
  )
);
insert into destination_admission_concurrency_results
select 'race-goal', api.create_readiness_goal(
  (select (response->>'workspace_id')::uuid from destination_admission_concurrency_results
   where result_name = 'race-bootstrap'),
  'goal:destination-admission-race', 'Destination admission settings race',
  'target:nvidia-python-verification-base-v1', 'destination-admission-race-goal'
);
insert into destination_admission_concurrency_results values (
  'race-plan', pg_temp.initialize_growth_plan_fixture_v1(
    'goal:destination-admission-race', 'destination-admission-race-plan'
  )
);
insert into destination_admission_concurrency_results values (
  'race-track-create-source', api.get_learning_track_creation_source_v1()
);
insert into destination_admission_concurrency_results values (
  'race-track-b', pg_temp.create_learning_track_fixture_v1(
    'goal:destination-admission-race',
    (
      select goal->>'aggregateVersion'
      from destination_admission_concurrency_results,
        lateral pg_catalog.jsonb_array_elements(response->'goals') as goal
      where result_name = 'race-track-create-source'
        and goal->>'readinessGoalKey' = 'goal:destination-admission-race'
    ),
    'Race sibling', 60, 25,
    (select response#>>'{growthPlan,aggregateVersion}'
     from destination_admission_concurrency_results where result_name = 'race-track-create-source'),
    'Create the sibling Track.', '10000000-0000-4000-8000-000000000201'
  )
);
insert into destination_admission_concurrency_results values (
  'race-activity', api.add_current_custom_activity_v1(
    'goal:destination-admission-race', 'activity:destination-concurrency-race',
    'Race activity', 'PROJECT', 'competency:python-error-handling',
    '0', 'destination-concurrency-race-activity'
  )
);
insert into destination_admission_concurrency_results values (
  'race-source-a', api.get_learning_track_activity_admission_source_v2(
    (select response->>'learningTrackKey'
     from destination_admission_concurrency_results where result_name = 'race-plan')
  )
);
insert into destination_admission_concurrency_results values (
  'race-preview-a', api.preview_learning_track_activity_admission_v2(
    (select response#>>'{selectedTrack,trackKey}'
     from destination_admission_concurrency_results where result_name = 'race-source-a'),
    'activity:destination-concurrency-race', 45, 'MEDIUM',
    (select response#>>'{growthPlan,aggregateVersion}'
     from destination_admission_concurrency_results where result_name = 'race-source-a'),
    (select response#>>'{selectedTrack,aggregateVersion}'
     from destination_admission_concurrency_results where result_name = 'race-source-a'),
    'Lose to a sibling settings change.',
    '12000000-0000-4000-8000-000000000001'
  )
);
insert into destination_admission_concurrency_results values (
  'race-settings-preview-b', api.preview_learning_track_priority_minimum_v1(
    (select response#>>'{createdTrack,trackKey}'
     from destination_admission_concurrency_results where result_name = 'race-track-b'),
    61,
    25,
    (select response#>>'{growthPlan,aggregateVersion}'
     from destination_admission_concurrency_results where result_name = 'race-source-a'),
    '1',
    'Win with a sibling order change.'
  )
);
reset role;

update destination_admission_concurrency_users as fixture
set workspace_id = (result.response->>'workspace_id')::uuid
from destination_admission_concurrency_results as result
where result.result_name = case fixture.case_name
  when 'same-key' then 'same-bootstrap'
  else 'race-bootstrap'
end;
commit;

begin;
set local search_path = public, extensions;
select no_plan();

create temporary table destination_admission_concurrency_commands (
  case_name text not null,
  caller text not null,
  response jsonb not null,
  primary key (case_name, caller)
);
create temporary table destination_admission_concurrency_observations (
  case_name text primary key,
  waited_on_advisory_lock boolean not null
);
create temporary table destination_admission_concurrency_errors (
  case_name text primary key,
  returned_state text,
  returned_message text
);

do $assert_password_route$
begin
  if pg_catalog.inet_server_addr() is null
     or pg_catalog.inet_server_addr() << inet '127.0.0.0/8'
     or pg_catalog.inet_server_addr() = inet '::1' then
    raise exception using errcode = '08001',
      message = 'destination-aware admission concurrency test requires a non-loopback password connection';
  end if;
end
$assert_password_route$;

select is(
  extensions.dblink_connect(
    'destination_admission_c1',
    pg_catalog.format(
      'hostaddr=%s port=%s dbname=%L user=%L password=%L application_name=pando_pgtap_destination_c1',
      pg_catalog.host(pg_catalog.inet_server_addr()), pg_catalog.current_setting('port'),
      pg_catalog.current_database(),
      (select connection_role from destination_admission_concurrency_connection),
      (select connection_password from destination_admission_concurrency_connection)
    )
  ),
  'OK', 'first independent destination-aware admission session connects'
);
select is(
  extensions.dblink_connect(
    'destination_admission_c2',
    pg_catalog.format(
      'hostaddr=%s port=%s dbname=%L user=%L password=%L application_name=pando_pgtap_destination_c2',
      pg_catalog.host(pg_catalog.inet_server_addr()), pg_catalog.current_setting('port'),
      pg_catalog.current_database(),
      (select connection_role from destination_admission_concurrency_connection),
      (select connection_password from destination_admission_concurrency_connection)
    )
  ),
  'OK', 'second independent destination-aware admission session connects'
);

select is(
  extensions.dblink_exec(
    connection_name,
    pg_catalog.format(
      'set request.jwt.claims = %L',
      (select claims from destination_admission_concurrency_users where case_name = 'same-key')
    )
  ),
  'SET', connection_name || ' receives same-key claims'
)
from unnest(array['destination_admission_c1', 'destination_admission_c2']) as connection(connection_name);
select is(
  extensions.dblink_exec(connection_name, 'set role authenticated'),
  'SET', connection_name || ' uses the authenticated role'
)
from unnest(array['destination_admission_c1', 'destination_admission_c2']) as connection(connection_name);
select is(
  extensions.dblink_exec(connection_name, 'begin'),
  'BEGIN', connection_name || ' begins the same-key transaction'
)
from unnest(array['destination_admission_c1', 'destination_admission_c2']) as connection(connection_name);

insert into destination_admission_concurrency_commands
select 'same-key', 'c1', command.response
from extensions.dblink(
  'destination_admission_c1',
  pg_catalog.format(
    'select api.apply_learning_track_activity_admission_v2(%L,%L,45,%L,%L,%L,%L,%L,%L)',
    (select response#>>'{learningTrack,trackKey}'
     from destination_admission_concurrency_results where result_name = 'same-preview'),
    'activity:destination-concurrency-same', 'MEDIUM',
    (select response->>'expectedGrowthPlanVersion'
     from destination_admission_concurrency_results where result_name = 'same-preview'),
    (select response->>'expectedLearningTrackVersion'
     from destination_admission_concurrency_results where result_name = 'same-preview'),
    'Apply the same destination-aware preview concurrently.',
    '11000000-0000-4000-8000-000000000001',
    (select response->>'previewDigest'
     from destination_admission_concurrency_results where result_name = 'same-preview')
  )
) as command(response jsonb);
select is(
  extensions.dblink_send_query(
    'destination_admission_c2',
    pg_catalog.format(
      'select api.apply_learning_track_activity_admission_v2(%L,%L,45,%L,%L,%L,%L,%L,%L)',
      (select response#>>'{learningTrack,trackKey}'
       from destination_admission_concurrency_results where result_name = 'same-preview'),
      'activity:destination-concurrency-same', 'MEDIUM',
      (select response->>'expectedGrowthPlanVersion'
       from destination_admission_concurrency_results where result_name = 'same-preview'),
      (select response->>'expectedLearningTrackVersion'
       from destination_admission_concurrency_results where result_name = 'same-preview'),
      'Apply the same destination-aware preview concurrently.',
      '11000000-0000-4000-8000-000000000001',
      (select response->>'previewDigest'
       from destination_admission_concurrency_results where result_name = 'same-preview')
    )
  ),
  1, 'identical destination-aware confirmation is dispatched before the winner commits'
);
do $wait_same_key$
declare
  observed boolean := false;
begin
  for attempt in 1..200 loop
    select exists (
      select 1 from pg_catalog.pg_stat_activity
      where application_name = 'pando_pgtap_destination_c2'
        and wait_event_type = 'Lock' and wait_event = 'advisory'
    ) into observed;
    exit when observed;
    perform pg_catalog.pg_sleep(0.01);
  end loop;
  insert into destination_admission_concurrency_observations values ('same-key', observed);
end
$wait_same_key$;
select ok(
  (select waited_on_advisory_lock from destination_admission_concurrency_observations
   where case_name = 'same-key'),
  'identical destination-aware confirmation waits on the idempotency advisory lock'
);
select is(
  extensions.dblink_exec('destination_admission_c1', 'commit'),
  'COMMIT', 'same-key winner commits'
);
insert into destination_admission_concurrency_commands
select 'same-key', 'c2', command.response
from extensions.dblink_get_result('destination_admission_c2') as command(response jsonb);
select is(
  (select count(*) from extensions.dblink_get_result('destination_admission_c2')
   as command(response jsonb)),
  0::bigint, 'same-key destination-aware replay stream is drained'
);
select is(
  extensions.dblink_exec('destination_admission_c2', 'commit'),
  'COMMIT', 'same-key replay commits'
);
select is(
  (select response from destination_admission_concurrency_commands
   where case_name = 'same-key' and caller = 'c2'),
  (select response from destination_admission_concurrency_commands
   where case_name = 'same-key' and caller = 'c1'),
  'concurrent identical destination-aware confirmations return the byte-identical stored response'
);

select is(
  extensions.dblink_exec(
    connection_name,
    pg_catalog.format(
      'set request.jwt.claims = %L',
      (select claims from destination_admission_concurrency_users where case_name = 'settings-race')
    )
  ),
  'SET', connection_name || ' receives settings-race claims'
)
from unnest(array['destination_admission_c1', 'destination_admission_c2']) as connection(connection_name);
select is(
  extensions.dblink_exec(connection_name, 'begin'),
  'BEGIN', connection_name || ' begins the settings-race transaction'
)
from unnest(array['destination_admission_c1', 'destination_admission_c2']) as connection(connection_name);

insert into destination_admission_concurrency_commands
select 'settings-race', 'c1', command.response
from extensions.dblink(
  'destination_admission_c1',
  pg_catalog.format(
    'select api.apply_learning_track_priority_minimum_v1(%L,%s,%s,%L,%L,%L,%L,%L)',
    (select response#>>'{createdTrack,trackKey}'
     from destination_admission_concurrency_results where result_name = 'race-track-b'),
    (select (response#>>'{after,priority}')::integer
     from destination_admission_concurrency_results where result_name = 'race-settings-preview-b'),
    (select (response#>>'{after,protectedMinimumMinutes}')::integer
     from destination_admission_concurrency_results where result_name = 'race-settings-preview-b'),
    (select response->>'expectedGrowthPlanVersion'
     from destination_admission_concurrency_results where result_name = 'race-settings-preview-b'),
    (select response->>'expectedLearningTrackVersion'
     from destination_admission_concurrency_results where result_name = 'race-settings-preview-b'),
    (select response->>'previewDigest'
     from destination_admission_concurrency_results where result_name = 'race-settings-preview-b'),
    (select response->>'reason'
     from destination_admission_concurrency_results where result_name = 'race-settings-preview-b'),
    '20000000-0000-4000-8000-000000000001'
  )
) as command(response jsonb);
select is(
  extensions.dblink_send_query(
    'destination_admission_c2',
    pg_catalog.format(
      'select api.apply_learning_track_activity_admission_v2(%L,%L,45,%L,%L,%L,%L,%L,%L)',
      (select response#>>'{learningTrack,trackKey}'
       from destination_admission_concurrency_results where result_name = 'race-preview-a'),
      'activity:destination-concurrency-race', 'MEDIUM',
      (select response->>'expectedGrowthPlanVersion'
       from destination_admission_concurrency_results where result_name = 'race-preview-a'),
      (select response->>'expectedLearningTrackVersion'
       from destination_admission_concurrency_results where result_name = 'race-preview-a'),
      'Lose to a sibling settings change.',
      '12000000-0000-4000-8000-000000000001',
      (select response->>'previewDigest'
       from destination_admission_concurrency_results where result_name = 'race-preview-a')
    )
  ),
  1, 'destination-aware loser is dispatched before the settings winner commits'
);
do $wait_settings_race$
declare
  observed boolean := false;
begin
  for attempt in 1..200 loop
    select exists (
      select 1 from pg_catalog.pg_stat_activity
      where application_name = 'pando_pgtap_destination_c2'
        and wait_event_type = 'Lock' and wait_event = 'advisory'
    ) into observed;
    exit when observed;
    perform pg_catalog.pg_sleep(0.01);
  end loop;
  insert into destination_admission_concurrency_observations values ('settings-race', observed);
end
$wait_settings_race$;
select ok(
  (select waited_on_advisory_lock from destination_admission_concurrency_observations
   where case_name = 'settings-race'),
  'destination-aware confirmation serializes on the shared Planning workspace lock against sibling settings'
);
select is(
  extensions.dblink_exec('destination_admission_c1', 'commit'),
  'COMMIT', 'settings winner commits'
);
do $collect_settings_race_error$
declare
  v_state text;
  v_message text;
begin
  begin
    perform command.response
    from extensions.dblink_get_result('destination_admission_c2') as command(response jsonb);
  exception
    when others then
      get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
  end;
  perform count(*)
  from extensions.dblink_get_result('destination_admission_c2') as command(response jsonb);
  insert into destination_admission_concurrency_errors
  values ('settings-race', v_state, v_message);
end
$collect_settings_race_error$;
select is(
  extensions.dblink_exec('destination_admission_c2', 'rollback'),
  'ROLLBACK', 'stale destination-aware transaction rolls back'
);
select is(
  (select returned_state from destination_admission_concurrency_errors
   where case_name = 'settings-race'),
  '40001', 'losing destination-aware confirmation receives optimistic-concurrency SQLSTATE'
);
select is(
  (select returned_message from destination_admission_concurrency_errors
   where case_name = 'settings-race'),
  'activity admission preview is stale',
  'losing destination-aware confirmation is explicitly stale after the sibling order change'
);

select is(
  extensions.dblink_disconnect(connection_name),
  'OK', connection_name || ' disconnects cleanly'
)
from unnest(array['destination_admission_c1', 'destination_admission_c2']) as connection(connection_name);

select is(
  (select count(*) from planning.learning_track_activities
   where workspace_id = fixture.workspace_id),
  1::bigint, fixture.case_name || ' commits exactly one attribution or settings change side effect set'
)
from destination_admission_concurrency_users as fixture
where fixture.case_name = 'same-key';
select is(
  (select count(*) from planning.learning_track_activities
   where workspace_id = fixture.workspace_id),
  0::bigint, fixture.case_name || ' leaves no attribution when sibling settings win first'
)
from destination_admission_concurrency_users as fixture
where fixture.case_name = 'settings-race';
select is(
  (select count(*) from outbox.command_receipts
   where workspace_id = (
     select workspace_id from destination_admission_concurrency_users where case_name = 'same-key'
   )
     and command_type = 'planning.add_learning_track_activity_v3'),
  1::bigint, 'same-key case commits exactly one v3 receipt'
);
select is(
  (select count(*) from outbox.command_receipts
   where idempotency_key =
     'learning-track-activity-admission:v3:12000000-0000-4000-8000-000000000001'),
  0::bigint, 'the stale destination-aware loser leaves no v3 receipt'
);
select is(
  (select aggregate_version from planning.learning_tracks
   where track_key = (
     select response#>>'{createdTrack,trackKey}'
     from destination_admission_concurrency_results where result_name = 'race-track-b'
   )),
  2::bigint, 'the sibling settings winner increments only its selected Track once'
);

select * from finish();
commit;

do $drop_dblink_role$
declare
  v_connection_role text;
begin
  select connection_role into strict v_connection_role
  from destination_admission_concurrency_connection;
  execute pg_catalog.format('drop role %I', v_connection_role);
end
$drop_dblink_role$;
