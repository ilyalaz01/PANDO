begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select no_plan();

insert into auth.users (
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values (
  '30000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'atomic-probe@pando.test',
  '',
  clock_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  clock_timestamp(),
  clock_timestamp()
);

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '30000000-0000-4000-8000-000000000001',
    'role', 'authenticated',
    'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text,
  true
);

set local role authenticated;
select lives_ok(
  $$select api.bootstrap_personal_workspace('atomic-probe', 'Atomic Probe')$$,
  'bootstrap atomically enqueues the fixed probe delivery'
);
reset role;

create temporary table probe_claims (
  claim_number integer not null,
  delivery_id uuid not null,
  event_id uuid not null,
  event_position bigint not null,
  workspace_id uuid not null,
  lease_token uuid not null,
  lease_expires_at timestamptz not null,
  attempt_count smallint not null,
  event_name text not null,
  event_schema_version smallint not null,
  payload jsonb not null,
  metadata jsonb not null
);
grant insert, select on probe_claims to service_role;

set local role service_role;
insert into probe_claims
select 1, claimed.*
from api.claim_phase0_probe_deliveries() as claimed;
reset role;

select is(
  (select count(*) from probe_claims where claim_number = 1),
  1::bigint,
  'the initial probe delivery is claimed once'
);
select is(
  (select count(*) from outbox.phase0_probe_effects),
  0::bigint,
  'claiming alone creates no consumer effect'
);

create function pg_temp.reject_probe_consumer_receipt()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  raise exception using
    errcode = 'P0001',
    message = 'pgTAP injected failure after probe effect insert';
end
$function$;

create trigger pgtap_reject_probe_consumer_receipt
before insert on outbox.consumer_receipts
for each row execute function pg_temp.reject_probe_consumer_receipt();

set local role service_role;
select throws_ok(
  pg_catalog.format(
    'select api.complete_phase0_probe_delivery(%L::uuid, %L::uuid, %s::bigint)',
    (select delivery_id from probe_claims where claim_number = 1),
    (select lease_token from probe_claims where claim_number = 1),
    (select event_position from probe_claims where claim_number = 1)
  ),
  'P0001',
  'pgTAP injected failure after probe effect insert',
  'a failure after effect insertion aborts completion'
);
reset role;

drop trigger pgtap_reject_probe_consumer_receipt on outbox.consumer_receipts;

select is(
  (select count(*) from outbox.phase0_probe_effects),
  0::bigint,
  'the failed completion rolls back the durable consumer effect'
);
select is(
  (select count(*) from outbox.consumer_receipts),
  0::bigint,
  'the failed completion leaves no consumer receipt'
);
select is(
  (
    select delivery_state
    from outbox.deliveries
    where delivery_id = (
      select delivery_id from probe_claims where claim_number = 1
    )
  ),
  'leased',
  'the failed completion leaves the original lease for timeout recovery'
);

update outbox.deliveries
set lease_expires_at = clock_timestamp() - interval '1 second'
where delivery_id = (
  select delivery_id from probe_claims where claim_number = 1
);

set local role service_role;
insert into probe_claims
select 2, claimed.*
from api.claim_phase0_probe_deliveries() as claimed;
reset role;

select is(
  (select count(*) from probe_claims where claim_number = 2),
  1::bigint,
  'the failed delivery is reclaimed after lease expiry'
);
select is(
  (select delivery_id from probe_claims where claim_number = 2),
  (select delivery_id from probe_claims where claim_number = 1),
  'reclaim retries the same delivery'
);
select isnt(
  (select lease_token from probe_claims where claim_number = 2),
  (select lease_token from probe_claims where claim_number = 1),
  'reclaim fences the failed attempt with a new lease token'
);
select is(
  (select attempt_count from probe_claims where claim_number = 2),
  2::smallint,
  'reclaim records the second processing attempt'
);

set local role service_role;
select ok(
  api.complete_phase0_probe_delivery(
    (select delivery_id from probe_claims where claim_number = 2),
    (select lease_token from probe_claims where claim_number = 2),
    (select event_position from probe_claims where claim_number = 2)
  ),
  'the reclaimed attempt applies and completes atomically'
);
select ok(
  not api.complete_phase0_probe_delivery(
    (select delivery_id from probe_claims where claim_number = 2),
    (select lease_token from probe_claims where claim_number = 2),
    (select event_position from probe_claims where claim_number = 2)
  ),
  'repeating the successful completion is idempotent'
);
reset role;

select is(
  (
    select count(*)
    from outbox.phase0_probe_effects as effect
    where effect.event_id = (
      select event_id from probe_claims where claim_number = 2
    )
      and effect.consumer_name = 'phase0.identity_workspace_bootstrap_probe'
      and effect.handler_contract_version = 1
  ),
  1::bigint,
  'failure, reclaim, success, and duplicate completion produce exactly one effect'
);
select is(
  (
    select count(*)
    from outbox.consumer_receipts
    where delivery_id = (
      select delivery_id from probe_claims where claim_number = 2
    )
  ),
  1::bigint,
  'the successful effect has exactly one matching consumer receipt'
);
select is(
  (
    select delivery_state
    from outbox.deliveries
    where delivery_id = (
      select delivery_id from probe_claims where claim_number = 2
    )
  ),
  'succeeded',
  'the successful effect and receipt have one terminal delivery'
);

select throws_ok(
  $$update outbox.phase0_probe_effects set applied_at = clock_timestamp()$$,
  '55000',
  'phase 0 probe effects are immutable',
  'probe effects reject privileged mutation attempts'
);

select * from finish();
rollback;
