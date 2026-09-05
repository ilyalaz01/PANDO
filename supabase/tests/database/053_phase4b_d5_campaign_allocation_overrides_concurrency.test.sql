begin;

create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set local search_path = public, extensions;
select no_plan();

create temporary table override_race_connections (
  role_name text primary key,
  password text not null
);
create temporary table override_race_fixture (
  workspace_id uuid,
  campaign_key_1 text,
  campaign_key_2 text,
  track_key text,
  track_version text,
  rollback_track_key text,
  rollback_track_version text,
  claims text
);
create temporary table override_race_results (
  case_name text primary key,
  response jsonb not null
);
create temporary table override_race_waits (
  case_name text primary key,
  waited boolean not null
);
create temporary table override_race_transactions (
  case_name text primary key,
  winner_committed boolean not null,
  loser_rolled_back boolean not null
);
create temporary table override_race_errors (
  case_name text primary key,
  sqlstate text,
  message text
);
grant select, insert on override_race_errors, override_race_results, override_race_waits
  to authenticated;
grant select, insert on override_race_fixture to authenticated;

insert into override_race_connections values
  ('pando_pgtap_override_' || pg_catalog.left(pg_catalog.replace(gen_random_uuid()::text, '-', ''), 16),
   gen_random_uuid()::text);

do $create_role$
declare c record;
begin
  select * into strict c from override_race_connections;
  execute pg_catalog.format('create role %I login noinherit password %L', c.role_name, c.password);
  execute pg_catalog.format('grant authenticated to %I', c.role_name);
end $create_role$;

insert into auth.users(
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '53000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'd5-race@pando.test', '', pg_catalog.clock_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
);

do $setup$
declare
  v_claims text;
  v_bootstrap jsonb;
  v_workspace_id uuid;
  v_goal jsonb;
  v_plan_preview jsonb;
  v_plan_apply jsonb;
  v_campaign1_preview jsonb;
  v_campaign1_apply jsonb;
  v_campaign2_preview jsonb;
  v_campaign2_apply jsonb;
  v_track2_preview jsonb;
  v_track2_apply jsonb;
begin
  v_claims := pg_catalog.jsonb_build_object(
    'sub', '53000000-0000-4000-8000-000000000001', 'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from pg_catalog.clock_timestamp() + interval '1 hour')::bigint
  )::text;
  perform set_config('request.jwt.claims', v_claims, true);
  set local role authenticated;

  v_bootstrap := api.bootstrap_personal_workspace('d5-race', 'D5 race');
  v_workspace_id := (v_bootstrap->>'workspace_id')::uuid;
  v_goal := api.create_readiness_goal(
    v_workspace_id, 'goal:d5-race', 'D5 race target',
    'target:nvidia-python-verification-base-v1', 'd5-race-goal'
  );
  v_plan_preview := api.preview_growth_plan_initialization_v1(
    'goal:d5-race', v_goal->>'aggregateVersion', 600, 60, 50, 'Race plan.',
    '53000000-0000-4000-8000-0000000000e1'
  );
  v_plan_apply := api.apply_growth_plan_initialization_v1(
    'goal:d5-race', v_goal->>'aggregateVersion', 600, 60, 50, 'Race plan.',
    '53000000-0000-4000-8000-0000000000e1', v_plan_preview->>'previewDigest'
  );

  v_campaign1_preview := api.preview_interview_campaign_creation_v1(
    'goal:d5-race', v_goal->>'aggregateVersion', 'Race campaign one',
    (current_date + 30)::date, 'Setting up the race.', '53000000-0000-4000-8000-0000000000f1'
  );
  v_campaign1_apply := api.apply_interview_campaign_creation_v1(
    'goal:d5-race', v_goal->>'aggregateVersion', 'Race campaign one',
    (current_date + 30)::date, 'Setting up the race.', '53000000-0000-4000-8000-0000000000f1',
    v_campaign1_preview->>'previewDigest'
  );
  v_campaign2_preview := api.preview_interview_campaign_creation_v1(
    'goal:d5-race', v_goal->>'aggregateVersion', 'Race campaign two',
    (current_date + 30)::date, 'Setting up the race.', '53000000-0000-4000-8000-0000000000f2'
  );
  v_campaign2_apply := api.apply_interview_campaign_creation_v1(
    'goal:d5-race', v_goal->>'aggregateVersion', 'Race campaign two',
    (current_date + 30)::date, 'Setting up the race.', '53000000-0000-4000-8000-0000000000f2',
    v_campaign2_preview->>'previewDigest'
  );

  -- A second Track, dedicated to the atomicity proof below, so it is never contended by the race.
  v_track2_preview := api.preview_learning_track_creation_v1(
    'goal:d5-race', v_goal->>'aggregateVersion', 'Race rollback track', 20, 30,
    v_plan_apply#>>'{createdPlan,aggregateVersion}', 'A second Track for the rollback proof.',
    '53000000-0000-4000-8000-0000000000e2'
  );
  v_track2_apply := api.apply_learning_track_creation_v1(
    'goal:d5-race', v_goal->>'aggregateVersion', 'Race rollback track', 20, 30,
    v_plan_apply#>>'{createdPlan,aggregateVersion}', 'A second Track for the rollback proof.',
    '53000000-0000-4000-8000-0000000000e2', v_track2_preview->>'previewDigest'
  );

  insert into override_race_fixture (
    workspace_id, campaign_key_1, campaign_key_2, track_key, track_version,
    rollback_track_key, rollback_track_version, claims
  ) values (
    v_workspace_id, v_campaign1_apply#>>'{campaign,campaignKey}',
    v_campaign2_apply#>>'{campaign,campaignKey}',
    v_plan_apply#>>'{createdTrack,trackKey}',
    v_plan_apply#>>'{createdTrack,aggregateVersion}',
    v_track2_apply#>>'{createdTrack,trackKey}', v_track2_apply#>>'{createdTrack,aggregateVersion}',
    v_claims
  );
  reset role;
end
$setup$;
commit;

begin;
set local search_path = public, extensions;

select is(
  extensions.dblink_connect(
    connection_name,
    pg_catalog.format(
      'hostaddr=%s port=%s dbname=%L user=%L password=%L application_name=pando_override_%s',
      host(inet_server_addr()), current_setting('port'), current_database(), role_name, password,
      connection_name
    )
  ),
  'OK', connection_name || ' connects'
)
from override_race_connections
cross join unnest(array['override_c1', 'override_c2']) as connection_name;

do $race$
declare
  f record;
  v_winner jsonb;
  v_loser_sql text;
  v_overrides_1 text;
  v_overrides_2 text;
  v_waited boolean;
  v_state text;
  v_message text;
  v_winner_committed boolean;
  v_loser_rolled_back boolean;
  attempt integer;
begin
  select * into strict f from override_race_fixture;

  v_overrides_1 := pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'trackKey', f.track_key, 'expectedTrackVersion', f.track_version,
    'priorityOverride', 90, 'protectedMinimumMinutesOverride', null::integer,
    'cadencePerWeekOverride', null::integer
  ))::text;
  v_overrides_2 := pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'trackKey', f.track_key, 'expectedTrackVersion', f.track_version,
    'priorityOverride', 40, 'protectedMinimumMinutesOverride', null::integer,
    'cadencePerWeekOverride', null::integer
  ))::text;

  if extensions.dblink_exec(
    'override_c1', pg_catalog.format('set request.jwt.claims = %L', f.claims)
  ) <> 'SET' or extensions.dblink_exec(
    'override_c2', pg_catalog.format('set request.jwt.claims = %L', f.claims)
  ) <> 'SET' then
    raise exception 'race claims setup failed';
  end if;
  if extensions.dblink_exec('override_c1', 'set role authenticated') <> 'SET'
     or extensions.dblink_exec('override_c2', 'set role authenticated') <> 'SET' then
    raise exception 'race role setup failed';
  end if;
  if extensions.dblink_exec('override_c1', 'begin') <> 'BEGIN'
     or extensions.dblink_exec('override_c2', 'begin') <> 'BEGIN' then
    raise exception 'race transaction setup failed';
  end if;

  -- Both connections preview installing an override on the same Track through two different
  -- campaigns before either applies; both see the Track free.
  select response into strict v_winner
  from extensions.dblink('override_c1', pg_catalog.format(
    'select api.preview_campaign_lifecycle_coordination_v1(%L, %L, %L, %L, %L::jsonb, %L)',
    f.campaign_key_1, 'start_campaign', '1', 'Connection one starts campaign one.',
    v_overrides_1, '53000000-0000-4000-8000-0000000000f3'
  )) as result(response jsonb);
  insert into override_race_results values ('c1-preview', v_winner);

  select response into strict v_winner
  from extensions.dblink('override_c2', pg_catalog.format(
    'select api.preview_campaign_lifecycle_coordination_v1(%L, %L, %L, %L, %L::jsonb, %L)',
    f.campaign_key_2, 'start_campaign', '1', 'Connection two starts campaign two.',
    v_overrides_2, '53000000-0000-4000-8000-0000000000f4'
  )) as result(response jsonb);
  insert into override_race_results values ('c2-preview', v_winner);

  select response into strict v_winner
  from extensions.dblink('override_c1', pg_catalog.format(
    'select api.apply_campaign_lifecycle_coordination_v1(%L, %L, %L, %L, %L::jsonb, %L, %L)',
    f.campaign_key_1, 'start_campaign', '1', 'Connection one starts campaign one.',
    v_overrides_1,
    (select response->>'previewDigest' from override_race_results where case_name = 'c1-preview'),
    '53000000-0000-4000-8000-0000000000f3'
  )) as winner(response jsonb);
  insert into override_race_results values ('winner', v_winner);

  v_loser_sql := pg_catalog.format(
    'select api.apply_campaign_lifecycle_coordination_v1(%L, %L, %L, %L, %L::jsonb, %L, %L)',
    f.campaign_key_2, 'start_campaign', '1', 'Connection two starts campaign two.',
    v_overrides_2,
    (select response->>'previewDigest' from override_race_results where case_name = 'c2-preview'),
    '53000000-0000-4000-8000-0000000000f4'
  );
  if extensions.dblink_send_query('override_c2', v_loser_sql) <> 1 then
    raise exception 'race loser dispatch failed';
  end if;

  v_waited := false;
  for attempt in 1..200 loop
    select exists(
      select 1 from pg_catalog.pg_stat_activity
      where application_name = 'pando_override_override_c2'
        and wait_event_type = 'Lock' and wait_event = 'advisory'
    ) into v_waited;
    exit when v_waited;
    perform pg_catalog.pg_sleep(.01);
  end loop;
  insert into override_race_waits values ('start_campaign', v_waited);

  v_winner_committed := extensions.dblink_exec('override_c1', 'commit') = 'COMMIT';
  v_state := null;
  v_message := null;
  begin
    perform response
    from extensions.dblink_get_result('override_c2') as result(response jsonb);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
  end;
  perform pg_catalog.count(*)
  from extensions.dblink_get_result('override_c2') as result(response jsonb);
  v_loser_rolled_back := extensions.dblink_exec('override_c2', 'rollback') = 'ROLLBACK';

  insert into override_race_errors values ('start_campaign', v_state, v_message);
  insert into override_race_transactions values (
    'start_campaign', v_winner_committed, v_loser_rolled_back
  );
end
$race$;

select ok(
  waited, case_name || ' loser waits on the shared Planning workspace advisory lock'
)
from override_race_waits;
select ok(
  winner_committed and loser_rolled_back,
  case_name || ' race commits exactly one override installation and rolls the loser back'
)
from override_race_transactions;
select is(
  sqlstate, '40001', 'the loser is refused with the exact stale-preview error class'
)
from override_race_errors;
select is(
  message, 'campaign lifecycle coordination preview is stale',
  'the loser is refused because the winner already governs the Track with its own override'
)
from override_race_errors;

select is(
  (select pg_catalog.count(*) from planning.campaign_allocation_overrides as override
   join override_race_fixture as f on f.workspace_id = override.workspace_id
   where override.lifecycle = 'active'),
  1::bigint,
  'the race leaves exactly one active override on the contested Track'
);
select is(
  (select pg_catalog.count(*) from targets.interview_campaigns as campaign
   join override_race_fixture as f on f.workspace_id = campaign.workspace_id
   where campaign.lifecycle = 'active'),
  1::bigint,
  'the race leaves exactly one campaign activated'
);
select is(
  (select pg_catalog.count(*) from outbox.command_receipts as receipt
   join override_race_fixture as f on true
   where receipt.workspace_id = f.workspace_id
     and receipt.command_type = 'agent_control.coordinate_campaign_lifecycle_v1'
     and receipt.command_status = 'completed'),
  1::bigint,
  'the race leaves exactly one completed coordination receipt'
);

-- ---------------------------------------------------------------------------------------------
-- Atomicity: an injected outbox failure while installing an override rolls back both owners'
-- state in the same transaction (the campaign lifecycle flip and the override insert together).
-- ---------------------------------------------------------------------------------------------

do $rollback_setup$
declare
  f record;
  v_goal jsonb;
  v_preview jsonb;
  v_apply jsonb;
begin
  select * into strict f from override_race_fixture;
  perform set_config('request.jwt.claims', f.claims, true);
  set local role authenticated;
  v_goal := api.get_readiness_goal(f.workspace_id, 'goal:d5-race');
  v_preview := api.preview_interview_campaign_creation_v1(
    'goal:d5-race', v_goal->>'aggregateVersion', 'Race campaign three',
    (current_date + 30)::date, 'Third campaign for rollback proof.',
    '53000000-0000-4000-8000-0000000000f5'
  );
  v_apply := api.apply_interview_campaign_creation_v1(
    'goal:d5-race', v_goal->>'aggregateVersion', 'Race campaign three',
    (current_date + 30)::date, 'Third campaign for rollback proof.',
    '53000000-0000-4000-8000-0000000000f5', v_preview->>'previewDigest'
  );
  insert into override_race_results values ('rollback-campaign-apply', v_apply);
  reset role;
end
$rollback_setup$;

-- The snapshot is taken after campaign three's own creation settles, so it captures exactly the
-- state the injected failure below must leave untouched.
create temporary table override_rollback_before as
select
  (select pg_catalog.count(*)::bigint from targets.interview_campaigns) as campaign_count,
  (select pg_catalog.count(*)::bigint from planning.campaign_allocation_overrides) as override_count,
  (select pg_catalog.count(*)::bigint from outbox.events) as event_count,
  (select pg_catalog.count(*)::bigint from outbox.command_receipts) as receipt_count;

create function public.fail_override_install_event_for_test()
returns trigger language plpgsql set search_path = '' as $function$
begin
  if new.event_name = 'planning.campaign_allocation_override_changed'
     and new.payload->>'change_kind' = 'OVERRIDE_INSTALLED' then
    raise exception using errcode = 'P0001', message = 'injected override installation failure';
  end if;
  return new;
end
$function$;
create trigger fail_override_install_event_for_test
before insert on outbox.events
for each row execute function public.fail_override_install_event_for_test();

select set_config('request.jwt.claims', (select claims from override_race_fixture), true);
set local role authenticated;

insert into override_race_results
select 'rollback-coordination-preview', api.preview_campaign_lifecycle_coordination_v1(
  (select response#>>'{campaign,campaignKey}' from override_race_results where case_name = 'rollback-campaign-apply'),
  'start_campaign', '1', 'This must roll back.',
  pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'trackKey', (select rollback_track_key from override_race_fixture),
    'expectedTrackVersion', (select rollback_track_version from override_race_fixture),
    'priorityOverride', 15, 'protectedMinimumMinutesOverride', null::integer,
    'cadencePerWeekOverride', null::integer
  )),
  '53000000-0000-4000-8000-0000000000f6'
);

select throws_ok(
  pg_catalog.format(
    $$select api.apply_campaign_lifecycle_coordination_v1(
      %L, 'start_campaign', '1', 'This must roll back.', %L::jsonb, %L, %L
    )$$,
    (select response#>>'{campaign,campaignKey}' from override_race_results where case_name = 'rollback-campaign-apply'),
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'trackKey', (select rollback_track_key from override_race_fixture),
      'expectedTrackVersion', (select rollback_track_version from override_race_fixture),
      'priorityOverride', 15, 'protectedMinimumMinutesOverride', null::integer,
      'cadencePerWeekOverride', null::integer
    ))::text,
    (select response->>'previewDigest' from override_race_results
     where case_name = 'rollback-coordination-preview'),
    '53000000-0000-4000-8000-0000000000f6'
  ),
  'P0001', 'injected override installation failure',
  'an outbox failure while installing an override rolls back the whole coordination command'
);
reset role;

drop trigger fail_override_install_event_for_test on outbox.events;
drop function public.fail_override_install_event_for_test();

select ok(
  (select pg_catalog.count(*)::bigint from targets.interview_campaigns) = (select campaign_count from override_rollback_before)
  and (select pg_catalog.count(*)::bigint from planning.campaign_allocation_overrides) = (select override_count from override_rollback_before)
  and (select pg_catalog.count(*)::bigint from outbox.events) = (select event_count from override_rollback_before)
  and (select pg_catalog.count(*)::bigint from outbox.command_receipts) = (select receipt_count from override_rollback_before),
  'the injected failure leaves no campaign lifecycle change, override, event, or receipt behind'
);

select is(extensions.dblink_disconnect(connection_name), 'OK', connection_name || ' disconnects')
from unnest(array['override_c1', 'override_c2']) as connection_name;

select finish();
rollback;
