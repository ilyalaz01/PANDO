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
values
  (
    '20000000-0000-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    'worker-alice@pando.test',
    '',
    clock_timestamp(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    clock_timestamp(),
    clock_timestamp()
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    'authenticated',
    'authenticated',
    'worker-bob@pando.test',
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
    'sub', '20000000-0000-4000-8000-000000000001',
    'role', 'authenticated',
    'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text,
  true
);
set local role authenticated;
select lives_ok(
  $$select api.bootstrap_personal_workspace('worker-alice', 'Worker Alice')$$,
  'Alice bootstrap enqueues a probe delivery'
);
reset role;

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '20000000-0000-4000-8000-000000000002',
    'role', 'authenticated',
    'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text,
  true
);
set local role authenticated;
select lives_ok(
  $$select api.bootstrap_personal_workspace('worker-bob', 'Worker Bob')$$,
  'Bob bootstrap enqueues a probe delivery'
);
reset role;

with alice_command as (
  select
    receipt.command_id,
    receipt.workspace_id,
    receipt.correlation_id
  from outbox.command_receipts as receipt
  join identity.users as actor
    on actor.user_id = receipt.actor_user_id
  where actor.auth_user_id = '20000000-0000-4000-8000-000000000001'
),
fixture_events as (
  select
    fixture.event_id,
    fixture.ordinality,
    alice_command.command_id,
    alice_command.workspace_id,
    alice_command.correlation_id
  from alice_command
  cross join unnest(array[
    '21000000-0000-4000-8000-000000000001'::uuid,
    '21000000-0000-4000-8000-000000000002'::uuid,
    '21000000-0000-4000-8000-000000000003'::uuid,
    '21000000-0000-4000-8000-000000000004'::uuid
  ]) with ordinality as fixture(event_id, ordinality)
)
insert into outbox.events (
  event_id,
  event_name,
  event_schema_version,
  workspace_id,
  actor_type,
  command_id,
  correlation_id,
  occurred_at,
  source,
  payload
)
select
  fixture.event_id,
  'phase0.probe_fixture',
  1,
  fixture.workspace_id,
  'system',
  fixture.command_id,
  fixture.correlation_id,
  clock_timestamp(),
  'pando.test',
  pg_catalog.jsonb_build_object('fixture_number', fixture.ordinality)
from fixture_events as fixture;

insert into outbox.deliveries (
  event_id,
  workspace_id,
  consumer_name,
  handler_contract_version
)
select
  event.event_id,
  event.workspace_id,
  'phase0.identity_workspace_bootstrap_probe',
  1
from outbox.events as event
where event.event_name = 'phase0.probe_fixture';

select is(
  (select count(*) from outbox.deliveries),
  6::bigint,
  'fixture contains six due deliveries across two workspaces'
);

create temporary table claimed_deliveries (
  claim_batch integer not null,
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
grant insert, select on claimed_deliveries to service_role;

set local role service_role;
insert into claimed_deliveries
select 1, claimed.*
from api.claim_phase0_probe_deliveries() as claimed;
reset role;

select is(
  (select count(*) from claimed_deliveries where claim_batch = 1),
  5::bigint,
  'one dispatcher claim returns at most five due deliveries'
);
select is(
  (
    select count(distinct lease_token)
    from claimed_deliveries
    where claim_batch = 1
  ),
  5::bigint,
  'each claimed delivery receives a fresh random lease token'
);
select ok(
  not exists (
    select 1
    from claimed_deliveries
    where claim_batch = 1
      and lease_expires_at not between
        clock_timestamp() + interval '110 seconds'
        and clock_timestamp() + interval '125 seconds'
  ),
  'claim leases are approximately 120 seconds'
);
select ok(
  not exists (
    select 1
    from claimed_deliveries
    where claim_batch = 1
      and attempt_count <> 1
  ),
  'first claim increments every attempt count to one'
);

set local role service_role;
insert into claimed_deliveries
select 2, claimed.*
from api.claim_phase0_probe_deliveries() as claimed;
reset role;

select is(
  (select count(*) from claimed_deliveries where claim_batch = 2),
  1::bigint,
  'a second claim skips five active leases and claims only the sixth row'
);
select is(
  (
    select count(*)
    from claimed_deliveries as first_claim
    join claimed_deliveries as second_claim
      on second_claim.delivery_id = first_claim.delivery_id
     and second_claim.claim_batch = 2
    where first_claim.claim_batch = 1
  ),
  0::bigint,
  'the second claim is disjoint from all active first-batch leases'
);

update outbox.deliveries
set lease_expires_at = clock_timestamp() - interval '1 second'
where delivery_id = (
  select delivery_id
  from claimed_deliveries
  where claim_batch = 1
  order by event_position
  limit 1
);

set local role service_role;
insert into claimed_deliveries
select 3, claimed.*
from api.claim_phase0_probe_deliveries() as claimed;
reset role;

select is(
  (select count(*) from claimed_deliveries where claim_batch = 3),
  1::bigint,
  'an expired lease is reclaimed'
);
select is(
  (select delivery_id from claimed_deliveries where claim_batch = 3),
  (
    select delivery_id
    from claimed_deliveries
    where claim_batch = 1
    order by event_position
    limit 1
  ),
  'reclaim returns the same delivery'
);
select isnt(
  (select lease_token from claimed_deliveries where claim_batch = 3),
  (
    select lease_token
    from claimed_deliveries
    where claim_batch = 1
    order by event_position
    limit 1
  ),
  'reclaim fences the prior handler with a new token'
);
select is(
  (select attempt_count from claimed_deliveries where claim_batch = 3),
  2::smallint,
  'reclaim increments the attempt count'
);

set local role service_role;
select throws_ok(
  pg_catalog.format(
    'select api.complete_phase0_probe_delivery(%L::uuid, null::uuid, %s::bigint)',
    (select delivery_id from claimed_deliveries where claim_batch = 1 order by event_position offset 1 limit 1),
    (select event_position from claimed_deliveries where claim_batch = 1 order by event_position offset 1 limit 1)
  ),
  '22023',
  'delivery completion arguments are required',
  'completion rejects a null lease token'
);
select throws_ok(
  pg_catalog.format(
    'select api.complete_phase0_probe_delivery(%L::uuid, %L::uuid, null::bigint)',
    (select delivery_id from claimed_deliveries where claim_batch = 1 order by event_position offset 1 limit 1),
    (select lease_token from claimed_deliveries where claim_batch = 1 order by event_position offset 1 limit 1)
  ),
  '22023',
  'delivery completion arguments are required',
  'completion rejects a null input watermark'
);
select throws_ok(
  pg_catalog.format(
    'select api.fail_phase0_probe_delivery(%L::uuid, %L::uuid, null::text, %L::text)',
    (select delivery_id from claimed_deliveries where claim_batch = 1 order by event_position offset 1 limit 1),
    (select lease_token from claimed_deliveries where claim_batch = 1 order by event_position offset 1 limit 1),
    'missing_failure_class'
  ),
  '22023',
  'failure class must be transient or permanent',
  'failure transition rejects a null failure class'
);
select throws_ok(
  pg_catalog.format(
    'select api.complete_phase0_probe_delivery(%L::uuid, %L::uuid, %s::bigint)',
    (select delivery_id from claimed_deliveries where claim_batch = 3),
    (
      select lease_token
      from claimed_deliveries
      where claim_batch = 1
      order by event_position
      limit 1
    ),
    (select event_position from claimed_deliveries where claim_batch = 3)
  ),
  '55000',
  'delivery lease is stale',
  'the stale pre-reclaim token cannot complete the delivery'
);
select ok(
  api.complete_phase0_probe_delivery(
    (select delivery_id from claimed_deliveries where claim_batch = 3),
    (select lease_token from claimed_deliveries where claim_batch = 3),
    (select event_position from claimed_deliveries where claim_batch = 3)
  ),
  'the reclaimed lease completes successfully'
);
select ok(
  not api.complete_phase0_probe_delivery(
    (select delivery_id from claimed_deliveries where claim_batch = 3),
    (select lease_token from claimed_deliveries where claim_batch = 3),
    (select event_position from claimed_deliveries where claim_batch = 3)
  ),
  'duplicate completion with the same lease and watermark is idempotent'
);
reset role;

select is(
  (
    select count(*)
    from outbox.consumer_receipts
    where delivery_id = (
      select delivery_id from claimed_deliveries where claim_batch = 3
    )
  ),
  1::bigint,
  'duplicate completion creates exactly one consumer receipt'
);

set local role service_role;
select throws_ok(
  pg_catalog.format(
    'select api.complete_phase0_probe_delivery(%L::uuid, %L::uuid, %s::bigint)',
    (select delivery_id from claimed_deliveries where claim_batch = 1 order by event_position offset 1 limit 1),
    (select lease_token from claimed_deliveries where claim_batch = 1 order by event_position offset 1 limit 1),
    (select event_position + 1 from claimed_deliveries where claim_batch = 1 order by event_position offset 1 limit 1)
  ),
  '22023',
  'delivery input watermark does not match',
  'completion rejects an unexpected input watermark'
);
select is(
  api.fail_phase0_probe_delivery(
    (select delivery_id from claimed_deliveries where claim_batch = 1 order by event_position offset 1 limit 1),
    (select lease_token from claimed_deliveries where claim_batch = 1 order by event_position offset 1 limit 1),
    'permanent',
    'contract_invalid'
  ),
  'dead_letter',
  'permanent contract failure goes directly to dead letter'
);
select is(
  api.fail_phase0_probe_delivery(
    (select delivery_id from claimed_deliveries where claim_batch = 1 order by event_position offset 2 limit 1),
    (select lease_token from claimed_deliveries where claim_batch = 1 order by event_position offset 2 limit 1),
    'transient',
    'dependency_unavailable'
  ),
  'retry',
  'transient failure schedules a retry before the attempt limit'
);
reset role;

select is(
  (
    select delivery_state
    from outbox.deliveries
    where delivery_id = (
      select delivery_id from claimed_deliveries where claim_batch = 1 order by event_position offset 1 limit 1
    )
  ),
  'dead_letter',
  'permanent failure persists a terminal delivery state'
);
select ok(
  (
    select available_at between
      clock_timestamp() + interval '4 seconds'
      and clock_timestamp() + interval '10 seconds'
    from outbox.deliveries
    where delivery_id = (
      select delivery_id from claimed_deliveries where claim_batch = 1 order by event_position offset 2 limit 1
    )
  ),
  'first transient retry uses bounded backoff starting at five seconds'
);

update outbox.deliveries
set attempt_count = 8
where delivery_id = (
  select delivery_id
  from claimed_deliveries
  where claim_batch = 1
  order by event_position
  offset 3
  limit 1
);

set local role service_role;
select is(
  api.fail_phase0_probe_delivery(
    (select delivery_id from claimed_deliveries where claim_batch = 1 order by event_position offset 3 limit 1),
    (select lease_token from claimed_deliveries where claim_batch = 1 order by event_position offset 3 limit 1),
    'transient',
    'attempt_limit'
  ),
  'dead_letter',
  'eighth failed attempt is exhausted into dead letter'
);
reset role;

select is(
  (
    select last_failure_class
    from outbox.deliveries
    where delivery_id = (
      select delivery_id from claimed_deliveries where claim_batch = 1 order by event_position offset 3 limit 1
    )
  ),
  'exhausted',
  'attempt-limit dead letter records the exhausted classification'
);

update outbox.deliveries
set attempt_count = 8,
    lease_expires_at = clock_timestamp() - interval '1 second'
where delivery_id = (
  select delivery_id
  from claimed_deliveries
  where claim_batch = 1
  order by event_position
  offset 4
  limit 1
);

update outbox.deliveries
set available_at = clock_timestamp() + interval '1 hour'
where delivery_state = 'retry';

set local role service_role;
insert into claimed_deliveries
select 4, claimed.*
from api.claim_phase0_probe_deliveries() as claimed;
reset role;

select is(
  (select count(*) from claimed_deliveries where claim_batch = 4),
  0::bigint,
  'claim does not create a ninth attempt or return terminal deliveries'
);
select is(
  (
    select delivery_state
    from outbox.deliveries
    where delivery_id = (
      select delivery_id from claimed_deliveries where claim_batch = 1 order by event_position offset 4 limit 1
    )
  ),
  'dead_letter',
  'an expired eighth lease is dead-lettered by the claim path'
);
select is(
  (
    select last_failure_class
    from outbox.deliveries
    where delivery_id = (
      select delivery_id from claimed_deliveries where claim_batch = 1 order by event_position offset 4 limit 1
    )
  ),
  'exhausted',
  'claim-path dead letter records the exhausted classification'
);

set local role service_role;
insert into claimed_deliveries
select 5, claimed.*
from api.claim_phase0_probe_deliveries() as claimed;
reset role;

select is(
  (select count(*) from claimed_deliveries where claim_batch = 5),
  0::bigint,
  'permanent and exhausted dead letters remain unclaimable'
);

select throws_like(
  $$insert into outbox.deliveries (
      event_id,
      workspace_id,
      consumer_name,
      handler_contract_version
    )
    select event_id, workspace_id, consumer_name, handler_contract_version
    from outbox.deliveries
    limit 1$$,
  'duplicate key value violates unique constraint "deliveries_event_consumer_contract_key"',
  'duplicate event/consumer/contract delivery is rejected'
);

select throws_ok(
  $$update outbox.consumer_receipts set processed_at = clock_timestamp()$$,
  '55000',
  'consumer receipts are immutable',
  'consumer receipts reject privileged mutation attempts'
);

select * from finish();
rollback;
