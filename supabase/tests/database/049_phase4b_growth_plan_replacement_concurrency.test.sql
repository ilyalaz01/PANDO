begin;

create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set local search_path = public, extensions;
select no_plan();

create function pg_temp.initialize_replacement_fixture_v1(
  p_goal_key text, p_idempotency_key text
) returns jsonb language sql security definer set search_path = '' as $function$
  select api.initialize_growth_plan_v1(p_goal_key, 600, 30, 80, 0, p_idempotency_key)
$function$;
revoke all on function pg_temp.initialize_replacement_fixture_v1(text,text)
  from public, anon, authenticated, service_role;
grant execute on function pg_temp.initialize_replacement_fixture_v1(text,text) to authenticated;

create temporary table replacement_race_cases (
  case_name text primary key,
  user_id uuid not null,
  claims text not null,
  workspace_id uuid,
  plan_id uuid,
  track_key text,
  plan_version text,
  track_version text,
  goal_version text,
  replacement_preview jsonb,
  competing_replacement_preview jsonb,
  capacity_preview jsonb,
  lifecycle_preview jsonb
);
create temporary table replacement_race_connections (
  role_name text primary key,
  password text not null
);
create temporary table replacement_race_errors (
  case_name text primary key,
  sqlstate text,
  message text
);
create temporary table replacement_race_results (
  case_name text primary key,
  response jsonb not null
);
create temporary table replacement_race_waits (
  case_name text primary key,
  waited boolean not null
);
create temporary table replacement_race_transactions (
  case_name text primary key,
  winner_committed boolean not null,
  loser_rolled_back boolean not null
);
grant select, update on replacement_race_cases to authenticated;
grant select, insert on replacement_race_errors, replacement_race_results,
  replacement_race_waits to authenticated;

insert into replacement_race_cases(case_name, user_id, claims) values
  ('replacement', '49000000-0000-4000-8000-000000000001',
   pg_catalog.jsonb_build_object('sub','49000000-0000-4000-8000-000000000001','role','authenticated','aud','authenticated','exp',extract(epoch from clock_timestamp()+interval '1 hour')::bigint)::text),
  ('capacity', '49000000-0000-4000-8000-000000000002',
   pg_catalog.jsonb_build_object('sub','49000000-0000-4000-8000-000000000002','role','authenticated','aud','authenticated','exp',extract(epoch from clock_timestamp()+interval '1 hour')::bigint)::text),
  ('lifecycle', '49000000-0000-4000-8000-000000000003',
   pg_catalog.jsonb_build_object('sub','49000000-0000-4000-8000-000000000003','role','authenticated','aud','authenticated','exp',extract(epoch from clock_timestamp()+interval '1 hour')::bigint)::text);
insert into replacement_race_connections values
  ('pando_pgtap_replace_' || left(replace(gen_random_uuid()::text, '-', ''), 16),
   gen_random_uuid()::text);

do $create_role$
declare c record;
begin
  select * into strict c from replacement_race_connections;
  execute format('create role %I login noinherit password %L', c.role_name, c.password);
  execute format('grant authenticated to %I', c.role_name);
end $create_role$;

insert into auth.users(
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select user_id, 'authenticated', 'authenticated', case_name || '@replacement-race.pando.test', '',
  clock_timestamp(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  clock_timestamp(), clock_timestamp()
from replacement_race_cases;

do $setup$
declare c record; b jsonb; tracks jsonb; source jsonb; v_goal_version text;
begin
  for c in select * from replacement_race_cases order by case_name loop
    perform set_config('request.jwt.claims', c.claims, true);
    set local role authenticated;
    b := api.bootstrap_personal_workspace('replace-race-' || c.case_name, 'Replacement race');
    perform api.create_readiness_goal(
      (b->>'workspace_id')::uuid, 'goal:replace-race-' || c.case_name,
      'Replacement race goal', 'target:nvidia-python-verification-base-v1',
      'replace-race-goal-' || c.case_name
    );
    perform pg_temp.initialize_replacement_fixture_v1(
      'goal:replace-race-' || c.case_name, 'replace-race-plan-' || c.case_name
    );
    tracks := api.get_current_learning_tracks_v1();
    source := api.get_growth_plan_replacement_source_v1();
    select goal->>'aggregateVersion' into strict v_goal_version
    from pg_catalog.jsonb_array_elements(source->'goals') as goal
    where goal->>'readinessGoalKey' = 'goal:replace-race-' || c.case_name;
    update replacement_race_cases
    set workspace_id = (b->>'workspace_id')::uuid,
        plan_id = (tracks#>>'{growthPlan,growthPlanId}')::uuid,
        track_key = tracks#>>'{learningTracks,0,trackKey}',
        plan_version = tracks#>>'{growthPlan,aggregateVersion}',
        track_version = tracks#>>'{learningTracks,0,aggregateVersion}',
        goal_version = v_goal_version,
        replacement_preview = api.preview_growth_plan_replacement_v1(
          'goal:replace-race-' || c.case_name, v_goal_version,
          tracks#>>'{growthPlan,aggregateVersion}', 420, 45, 60,
          'Winning replacement for this race.',
          '49000000-0000-4000-8000-00000000010' || right(c.user_id::text, 1)
        ),
        competing_replacement_preview = case when c.case_name = 'replacement' then
          api.preview_growth_plan_replacement_v1(
            'goal:replace-race-replacement', v_goal_version,
            tracks#>>'{growthPlan,aggregateVersion}', 300, 30, 40,
            'Competing replacement must become stale.',
            '49000000-0000-4000-8000-000000000201'
          )
        end,
        capacity_preview = case when c.case_name = 'capacity' then
          api.preview_growth_plan_capacity_v1(
            660, tracks#>>'{growthPlan,aggregateVersion}',
            'Competing capacity edit must become stale.'
          )
        end,
        lifecycle_preview = case when c.case_name = 'lifecycle' then
          api.preview_learning_track_lifecycle_v1(
            tracks#>>'{learningTracks,0,trackKey}', 'pause_track',
            tracks#>>'{growthPlan,aggregateVersion}',
            tracks#>>'{learningTracks,0,aggregateVersion}',
            'Competing Track lifecycle edit must become stale.'
          )
        end
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
    format('hostaddr=%s port=%s dbname=%L user=%L password=%L application_name=pando_replace_%s',
      host(inet_server_addr()), current_setting('port'), current_database(), role_name, password,
      connection_name)
  ),
  'OK', connection_name || ' connects'
)
from replacement_race_connections
cross join unnest(array['replace_c1', 'replace_c2']) as connection_name;

do $races$
declare
  c record;
  v_winner jsonb;
  v_loser_sql text;
  v_waited boolean;
  v_state text;
  v_message text;
  v_winner_committed boolean;
  v_loser_rolled_back boolean;
begin
  for c in
    select * from replacement_race_cases
    order by case case_name when 'replacement' then 1 when 'capacity' then 2 else 3 end
  loop
    if extensions.dblink_exec(
      'replace_c1', pg_catalog.format('set request.jwt.claims = %L', c.claims)
    ) <> 'SET' or extensions.dblink_exec(
      'replace_c2', pg_catalog.format('set request.jwt.claims = %L', c.claims)
    ) <> 'SET' then
      raise exception 'race claims setup failed for %', c.case_name;
    end if;
    if extensions.dblink_exec('replace_c1', 'set role authenticated') <> 'SET'
       or extensions.dblink_exec('replace_c2', 'set role authenticated') <> 'SET' then
      raise exception 'race role setup failed for %', c.case_name;
    end if;
    if extensions.dblink_exec('replace_c1', 'begin') <> 'BEGIN'
       or extensions.dblink_exec('replace_c2', 'begin') <> 'BEGIN' then
      raise exception 'race transaction setup failed for %', c.case_name;
    end if;

    select response into strict v_winner
    from extensions.dblink('replace_c1', pg_catalog.format(
      'select api.apply_growth_plan_replacement_v1(%L,%L,%L,%s,%s,%s,%L,%L,%L)',
      'goal:replace-race-' || c.case_name, c.goal_version, c.plan_version, 420, 45, 60,
      'Winning replacement for this race.',
      c.replacement_preview->>'idempotencyKey',
      c.replacement_preview->>'previewDigest'
    )) as winner(response jsonb);
    insert into replacement_race_results values (c.case_name, v_winner);

    v_loser_sql := case c.case_name
      when 'replacement' then pg_catalog.format(
        'select api.apply_growth_plan_replacement_v1(%L,%L,%L,%s,%s,%s,%L,%L,%L)',
        'goal:replace-race-replacement', c.goal_version, c.plan_version, 300, 30, 40,
        'Competing replacement must become stale.',
        c.competing_replacement_preview->>'idempotencyKey',
        c.competing_replacement_preview->>'previewDigest'
      )
      when 'capacity' then pg_catalog.format(
        'select api.apply_growth_plan_capacity_v1(%s,%L,%L,%L,%L)',
        660, c.plan_version, c.capacity_preview->>'previewDigest',
        'Competing capacity edit must become stale.',
        '49000000-0000-4000-8000-000000000302'
      )
      else pg_catalog.format(
        'select api.apply_learning_track_lifecycle_v1(%L,%L,%L,%L,%L,%L,%L)',
        c.track_key, 'pause_track', c.plan_version, c.track_version,
        c.lifecycle_preview->>'previewDigest',
        'Competing Track lifecycle edit must become stale.',
        '49000000-0000-4000-8000-000000000402'
      )
    end;
    if extensions.dblink_send_query('replace_c2', v_loser_sql) <> 1 then
      raise exception 'race loser dispatch failed for %', c.case_name;
    end if;

    v_waited := false;
    for attempt in 1..200 loop
      select exists(
        select 1 from pg_catalog.pg_stat_activity
        where application_name = 'pando_replace_replace_c2'
          and wait_event_type = 'Lock' and wait_event = 'advisory'
      ) into v_waited;
      exit when v_waited;
      perform pg_catalog.pg_sleep(.01);
    end loop;
    insert into replacement_race_waits values (c.case_name, v_waited);

    v_winner_committed := extensions.dblink_exec('replace_c1', 'commit') = 'COMMIT';
    v_state := null;
    v_message := null;
    begin
      perform response
      from extensions.dblink_get_result('replace_c2') as result(response jsonb);
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
    end;
    perform count(*)
    from extensions.dblink_get_result('replace_c2') as result(response jsonb);
    v_loser_rolled_back := extensions.dblink_exec('replace_c2', 'rollback') = 'ROLLBACK';

    insert into replacement_race_errors values (c.case_name, v_state, v_message);
    insert into replacement_race_transactions values (
      c.case_name, v_winner_committed, v_loser_rolled_back
    );
  end loop;
end
$races$;

select ok(waited, case_name || ' loser waits on the shared Planning workspace advisory lock')
from replacement_race_waits;
select ok(
  winner_committed and loser_rolled_back,
  case_name || ' race commits exactly one replacement and rolls the loser back'
)
from replacement_race_transactions;
select is(
  sqlstate,
  case case_name when 'lifecycle' then '42501' else '40001' end,
  case_name || ' loser is refused with its exact fail-closed error class'
)
from replacement_race_errors;
select is(
  (select message from replacement_race_errors where case_name = 'replacement'),
  'Growth Plan replacement preview is stale',
  'a competing replacement is refused because its digest binds the archived Plan identity'
);
select is(
  (select message from replacement_race_errors where case_name = 'capacity'),
  'Growth Plan preview is stale',
  'a competing capacity edit is refused after the Plan it previewed became history'
);
select is(
  (select message from replacement_race_errors where case_name = 'lifecycle'),
  'Learning Track is unavailable',
  'a competing Track lifecycle edit cannot reach the archived Plan Track'
);

select ok(
  (select count(*) = 2 from planning.growth_plans as plan
   where plan.workspace_id = c.workspace_id)
  and (select count(*) = 1 from planning.growth_plans as plan
       where plan.workspace_id = c.workspace_id and plan.lifecycle = 'archived'
         and plan.aggregate_version = 2)
  and (select count(*) = 1 from planning.growth_plans as plan
       where plan.workspace_id = c.workspace_id and plan.lifecycle = 'active'
         and plan.weekly_capacity_minutes = 420)
  and (select count(*) = 1 from outbox.command_receipts as receipt
       where receipt.workspace_id = c.workspace_id
         and receipt.command_type = 'planning.replace_growth_plan_v1'
         and receipt.command_status = 'completed')
  and (select count(*) = 1 from outbox.events as event
       where event.workspace_id = c.workspace_id
         and event.payload->>'change_kind' = 'PLAN_REPLACED'),
  c.case_name || ' race leaves exactly one archived Plan, one current Plan, and one wake-up'
)
from replacement_race_cases as c;

select ok(
  (select count(*) = 0 from outbox.command_receipts as receipt
   where receipt.workspace_id = c.workspace_id
     and receipt.command_type in (
       'planning.set_growth_plan_default_capacity', 'planning.change_learning_track_lifecycle_v1'
     )),
  c.case_name || ' race leaves no losing command receipt'
)
from replacement_race_cases as c
where c.case_name in ('capacity', 'lifecycle');

-- An injected outbox failure rolls the entire replacement back.
create temporary table replacement_rollback_before as
select
  (select count(*)::bigint from planning.growth_plans) as plan_count,
  (select count(*)::bigint from planning.learning_tracks) as track_count,
  (select count(*)::bigint from outbox.events) as event_count,
  (select count(*)::bigint from outbox.deliveries) as delivery_count,
  (select count(*)::bigint from outbox.command_receipts) as receipt_count;

create function public.fail_growth_plan_replacement_event_for_test()
returns trigger language plpgsql set search_path = '' as $function$
begin
  if new.event_name = 'planning.input_changed'
     and new.payload->>'change_kind' = 'PLAN_REPLACED' then
    raise exception using errcode = 'P0001', message = 'injected Growth Plan replacement failure';
  end if;
  return new;
end
$function$;
create trigger fail_growth_plan_replacement_event_for_test
before insert on outbox.events
for each row execute function public.fail_growth_plan_replacement_event_for_test();

do $rollback_case$
declare
  c record;
  v_source jsonb;
  v_preview jsonb;
  v_goal_version text;
  v_plan_version text;
begin
  select * into strict c from replacement_race_cases where case_name = 'replacement';
  perform set_config('request.jwt.claims', c.claims, true);
  set local role authenticated;
  v_source := api.get_growth_plan_replacement_source_v1();
  v_plan_version := v_source#>>'{currentPlan,aggregateVersion}';
  select goal->>'aggregateVersion' into strict v_goal_version
  from pg_catalog.jsonb_array_elements(v_source->'goals') as goal
  where goal->>'readinessGoalKey' = 'goal:replace-race-replacement';
  v_preview := api.preview_growth_plan_replacement_v1(
    'goal:replace-race-replacement', v_goal_version, v_plan_version, 500, 30, 50,
    'Replacement that must roll back.', '49000000-0000-4000-8000-000000000901'
  );
  insert into replacement_race_results values ('rollback-preview', v_preview);
  reset role;
end
$rollback_case$;

select set_config(
  'request.jwt.claims',
  (select claims from replacement_race_cases where case_name = 'replacement'),
  true
);
set local role authenticated;
select throws_ok(
  pg_catalog.format(
    'select api.apply_growth_plan_replacement_v1(%L,%L,%L,%s,%s,%s,%L,%L,%L)',
    'goal:replace-race-replacement',
    (select response->>'expectedReadinessGoalVersion' from replacement_race_results
     where case_name = 'rollback-preview'),
    (select response->>'expectedGrowthPlanVersion' from replacement_race_results
     where case_name = 'rollback-preview'),
    500, 30, 50, 'Replacement that must roll back.',
    '49000000-0000-4000-8000-000000000901',
    (select response->>'previewDigest' from replacement_race_results
     where case_name = 'rollback-preview')
  ),
  'P0001', 'injected Growth Plan replacement failure',
  'an outbox failure rolls back the whole replacement command'
);
reset role;

drop trigger fail_growth_plan_replacement_event_for_test on outbox.events;
drop function public.fail_growth_plan_replacement_event_for_test();

select ok(
  (select count(*)::bigint from planning.growth_plans) = (select plan_count from replacement_rollback_before)
  and (select count(*)::bigint from planning.learning_tracks) = (select track_count from replacement_rollback_before)
  and (select count(*)::bigint from outbox.events) = (select event_count from replacement_rollback_before)
  and (select count(*)::bigint from outbox.deliveries) = (select delivery_count from replacement_rollback_before)
  and (select count(*)::bigint from outbox.command_receipts) = (select receipt_count from replacement_rollback_before),
  'the injected failure leaves no Plan, Track, event, delivery, or receipt behind'
);

select is(extensions.dblink_disconnect(connection_name), 'OK', connection_name || ' disconnects')
from unnest(array['replace_c1', 'replace_c2']) as connection_name;

select finish();
rollback;
