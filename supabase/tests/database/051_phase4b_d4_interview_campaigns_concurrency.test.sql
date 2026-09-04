begin;

create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set local search_path = public, extensions;
select no_plan();

create temporary table campaign_race_connections (
  role_name text primary key,
  password text not null
);
create temporary table campaign_race_fixture (
  workspace_id uuid,
  campaign_key text,
  campaign_version text,
  claims text
);
create temporary table campaign_race_errors (
  case_name text primary key,
  sqlstate text,
  message text
);
create temporary table campaign_race_results (
  case_name text primary key,
  response jsonb not null
);
create temporary table campaign_race_waits (
  case_name text primary key,
  waited boolean not null
);
create temporary table campaign_race_transactions (
  case_name text primary key,
  winner_committed boolean not null,
  loser_rolled_back boolean not null
);
grant select, insert on campaign_race_errors, campaign_race_results, campaign_race_waits
  to authenticated;
grant select, insert on campaign_race_fixture to authenticated;

insert into campaign_race_connections values
  ('pando_pgtap_campaign_' || pg_catalog.left(pg_catalog.replace(gen_random_uuid()::text, '-', ''), 16),
   gen_random_uuid()::text);

do $create_role$
declare c record;
begin
  select * into strict c from campaign_race_connections;
  execute pg_catalog.format('create role %I login noinherit password %L', c.role_name, c.password);
  execute pg_catalog.format('grant authenticated to %I', c.role_name);
end $create_role$;

insert into auth.users(
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '51000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'd4-race@pando.test', '', pg_catalog.clock_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
);

do $setup$
declare
  v_claims text;
  v_bootstrap jsonb;
  v_workspace_id uuid;
  v_goal jsonb;
  v_create_preview jsonb;
  v_create_apply jsonb;
begin
  v_claims := pg_catalog.jsonb_build_object(
    'sub', '51000000-0000-4000-8000-000000000001', 'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from pg_catalog.clock_timestamp() + interval '1 hour')::bigint
  )::text;
  perform set_config('request.jwt.claims', v_claims, true);
  set local role authenticated;
  v_bootstrap := api.bootstrap_personal_workspace('d4-race', 'D4 race');
  v_workspace_id := (v_bootstrap->>'workspace_id')::uuid;
  v_goal := api.create_readiness_goal(
    v_workspace_id, 'goal:d4-race', 'D4 race target',
    'target:nvidia-python-verification-base-v1', 'd4-race-goal'
  );
  v_create_preview := api.preview_interview_campaign_creation_v1(
    'goal:d4-race', v_goal->>'aggregateVersion', 'Race campaign',
    (current_date + 30)::date, 'Setting up the race.', '51000000-0000-4000-8000-0000000000f1'
  );
  v_create_apply := api.apply_interview_campaign_creation_v1(
    'goal:d4-race', v_goal->>'aggregateVersion', 'Race campaign',
    (current_date + 30)::date, 'Setting up the race.', '51000000-0000-4000-8000-0000000000f1',
    v_create_preview->>'previewDigest'
  );
  insert into campaign_race_fixture (workspace_id, campaign_key, campaign_version, claims)
  values (
    v_workspace_id, v_create_apply#>>'{campaign,campaignKey}',
    v_create_apply#>>'{campaign,aggregateVersion}', v_claims
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
      'hostaddr=%s port=%s dbname=%L user=%L password=%L application_name=pando_campaign_%s',
      host(inet_server_addr()), current_setting('port'), current_database(), role_name, password,
      connection_name
    )
  ),
  'OK', connection_name || ' connects'
)
from campaign_race_connections
cross join unnest(array['campaign_c1', 'campaign_c2']) as connection_name;

do $race$
declare
  f record;
  v_winner jsonb;
  v_loser_sql text;
  v_waited boolean;
  v_state text;
  v_message text;
  v_winner_committed boolean;
  v_loser_rolled_back boolean;
  attempt integer;
begin
  select * into strict f from campaign_race_fixture;

  if extensions.dblink_exec(
    'campaign_c1', pg_catalog.format('set request.jwt.claims = %L', f.claims)
  ) <> 'SET' or extensions.dblink_exec(
    'campaign_c2', pg_catalog.format('set request.jwt.claims = %L', f.claims)
  ) <> 'SET' then
    raise exception 'race claims setup failed';
  end if;
  if extensions.dblink_exec('campaign_c1', 'set role authenticated') <> 'SET'
     or extensions.dblink_exec('campaign_c2', 'set role authenticated') <> 'SET' then
    raise exception 'race role setup failed';
  end if;
  if extensions.dblink_exec('campaign_c1', 'begin') <> 'BEGIN'
     or extensions.dblink_exec('campaign_c2', 'begin') <> 'BEGIN' then
    raise exception 'race transaction setup failed';
  end if;

  -- Both connections preview the exact same start_campaign transition before either applies.
  select response into strict v_winner
  from extensions.dblink('campaign_c1', pg_catalog.format(
    'select api.preview_interview_campaign_lifecycle_v1(%L, %L, %L, %L)',
    f.campaign_key, 'start_campaign', f.campaign_version, 'Connection one starts the campaign.'
  )) as result(response jsonb);
  insert into campaign_race_results values ('c1-preview', v_winner);

  select response into strict v_winner
  from extensions.dblink('campaign_c2', pg_catalog.format(
    'select api.preview_interview_campaign_lifecycle_v1(%L, %L, %L, %L)',
    f.campaign_key, 'start_campaign', f.campaign_version, 'Connection two starts the campaign.'
  )) as result(response jsonb);
  insert into campaign_race_results values ('c2-preview', v_winner);

  select response into strict v_winner
  from extensions.dblink('campaign_c1', pg_catalog.format(
    'select api.apply_interview_campaign_lifecycle_v1(%L, %L, %L, %L, %L, %L)',
    f.campaign_key, 'start_campaign', f.campaign_version,
    (select response->>'previewDigest' from campaign_race_results where case_name = 'c1-preview'),
    'Connection one starts the campaign.', '51000000-0000-4000-8000-0000000000f2'
  )) as winner(response jsonb);
  insert into campaign_race_results values ('winner', v_winner);

  v_loser_sql := pg_catalog.format(
    'select api.apply_interview_campaign_lifecycle_v1(%L, %L, %L, %L, %L, %L)',
    f.campaign_key, 'start_campaign', f.campaign_version,
    (select response->>'previewDigest' from campaign_race_results where case_name = 'c2-preview'),
    'Connection two starts the campaign.', '51000000-0000-4000-8000-0000000000f3'
  );
  if extensions.dblink_send_query('campaign_c2', v_loser_sql) <> 1 then
    raise exception 'race loser dispatch failed';
  end if;

  v_waited := false;
  for attempt in 1..200 loop
    select exists(
      select 1 from pg_catalog.pg_stat_activity
      where application_name = 'pando_campaign_campaign_c2'
        and wait_event_type = 'Lock' and wait_event = 'advisory'
    ) into v_waited;
    exit when v_waited;
    perform pg_catalog.pg_sleep(.01);
  end loop;
  insert into campaign_race_waits values ('start_campaign', v_waited);

  v_winner_committed := extensions.dblink_exec('campaign_c1', 'commit') = 'COMMIT';
  v_state := null;
  v_message := null;
  begin
    perform response
    from extensions.dblink_get_result('campaign_c2') as result(response jsonb);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
  end;
  perform pg_catalog.count(*)
  from extensions.dblink_get_result('campaign_c2') as result(response jsonb);
  v_loser_rolled_back := extensions.dblink_exec('campaign_c2', 'rollback') = 'ROLLBACK';

  insert into campaign_race_errors values ('start_campaign', v_state, v_message);
  insert into campaign_race_transactions values (
    'start_campaign', v_winner_committed, v_loser_rolled_back
  );
end
$race$;

select ok(
  waited, case_name || ' loser waits on the shared Targets workspace advisory lock'
)
from campaign_race_waits;
select ok(
  winner_committed and loser_rolled_back,
  case_name || ' race commits exactly one lifecycle change and rolls the loser back'
)
from campaign_race_transactions;
select is(
  sqlstate, '40001', 'the loser is refused with the exact stale-version error class'
)
from campaign_race_errors;
select is(
  message, 'Interview Campaign version is stale',
  'the loser is refused because the winner already advanced the campaign version'
)
from campaign_race_errors;

select ok(
  (select count(*) = 1 from targets.interview_campaigns as campaign
   join campaign_race_fixture as f on f.workspace_id = campaign.workspace_id
   where campaign.campaign_key = f.campaign_key
     and campaign.lifecycle = 'active' and campaign.aggregate_version = 2),
  'the race leaves exactly one active campaign at the next version, not two lifecycle changes'
);
select ok(
  (select count(*) = 1 from outbox.command_receipts as receipt
   join campaign_race_fixture as f on true
   where receipt.workspace_id = f.workspace_id
     and receipt.command_type = 'targets.change_interview_campaign_lifecycle_v1'
     and receipt.command_status = 'completed'),
  'the race leaves exactly one completed lifecycle command receipt'
);
select ok(
  (select count(*) = 1 from outbox.events as event
   join campaign_race_fixture as f on true
   where event.workspace_id = f.workspace_id
     and event.payload->>'change_kind' = 'CAMPAIGN_LIFECYCLE_CHANGED'),
  'the race emits exactly one validated lifecycle-changed event'
);

-- An injected outbox failure rolls the whole creation command back atomically.
create temporary table campaign_rollback_before as
select
  (select pg_catalog.count(*)::bigint from targets.interview_campaigns) as campaign_count,
  (select pg_catalog.count(*)::bigint from outbox.events) as event_count,
  (select pg_catalog.count(*)::bigint from outbox.command_receipts) as receipt_count;

create function public.fail_interview_campaign_creation_event_for_test()
returns trigger language plpgsql set search_path = '' as $function$
begin
  if new.event_name = 'targets.interview_campaign_changed'
     and new.payload->>'change_kind' = 'CAMPAIGN_CREATED' then
    raise exception using errcode = 'P0001', message = 'injected Interview Campaign creation failure';
  end if;
  return new;
end
$function$;
create trigger fail_interview_campaign_creation_event_for_test
before insert on outbox.events
for each row execute function public.fail_interview_campaign_creation_event_for_test();

do $rollback_setup$
declare
  f record;
  v_goal jsonb;
  v_preview jsonb;
begin
  select * into strict f from campaign_race_fixture;
  perform set_config('request.jwt.claims', f.claims, true);
  set local role authenticated;
  v_goal := api.get_readiness_goal(f.workspace_id, 'goal:d4-race');
  v_preview := api.preview_interview_campaign_creation_v1(
    'goal:d4-race', v_goal->>'aggregateVersion', 'Campaign that must roll back',
    (current_date + 10)::date, 'This must not survive.', '51000000-0000-4000-8000-0000000000f4'
  );
  insert into campaign_race_results values ('rollback-preview', v_preview);
  reset role;
end
$rollback_setup$;

select set_config('request.jwt.claims', (select claims from campaign_race_fixture), true);
set local role authenticated;
select throws_ok(
  pg_catalog.format(
    'select api.apply_interview_campaign_creation_v1(%L,%L,%L,%L,%L,%L,%L)',
    'goal:d4-race',
    (select response#>>'{readinessGoal,aggregateVersion}' from campaign_race_results
     where case_name = 'rollback-preview'),
    'Campaign that must roll back', (current_date + 10)::date, 'This must not survive.',
    '51000000-0000-4000-8000-0000000000f4',
    (select response->>'previewDigest' from campaign_race_results where case_name = 'rollback-preview')
  ),
  'P0001', 'injected Interview Campaign creation failure',
  'an outbox failure rolls back the whole creation command'
);
reset role;

drop trigger fail_interview_campaign_creation_event_for_test on outbox.events;
drop function public.fail_interview_campaign_creation_event_for_test();

select ok(
  (select pg_catalog.count(*)::bigint from targets.interview_campaigns) = (select campaign_count from campaign_rollback_before)
  and (select pg_catalog.count(*)::bigint from outbox.events) = (select event_count from campaign_rollback_before)
  and (select pg_catalog.count(*)::bigint from outbox.command_receipts) = (select receipt_count from campaign_rollback_before),
  'the injected failure leaves no campaign, event, or receipt behind'
);

select is(extensions.dblink_disconnect(connection_name), 'OK', connection_name || ' disconnects')
from unnest(array['campaign_c1', 'campaign_c2']) as connection_name;

select finish();
rollback;
