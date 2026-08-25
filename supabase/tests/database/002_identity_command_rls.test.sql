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
    '10000000-0000-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    'alice@pando.test',
    '',
    clock_timestamp(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    clock_timestamp(),
    clock_timestamp()
  ),
  (
    '10000000-0000-4000-8000-000000000002',
    'authenticated',
    'authenticated',
    'bob@pando.test',
    '',
    clock_timestamp(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    clock_timestamp(),
    clock_timestamp()
  );

create temporary table command_results (
  result_name text primary key,
  response jsonb not null
);
grant insert, select on command_results to authenticated;

set local role anon;
select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '10000000-0000-4000-8000-000000000001',
    'role', 'anon',
    'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text,
  true
);
select throws_ok(
  $$select api.bootstrap_personal_workspace('anon-bootstrap', 'Anon')$$,
  '42501',
  'permission denied for schema api',
  'anon cannot bootstrap even when a subject claim is forged'
);
reset role;

select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","aud":"authenticated"}',
  true
);
set local role authenticated;
select throws_ok(
  $$select api.bootstrap_personal_workspace('missing-sub', 'Missing subject')$$,
  '28000',
  'an authenticated user is required',
  'authenticated role without a subject is denied'
);
reset role;

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '10000000-0000-4000-8000-000000000001',
    'role', 'authenticated',
    'aud', 'authenticated',
    'aal', 'aal1',
    'session_id', '11000000-0000-4000-8000-000000000001',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint,
    'app_metadata', pg_catalog.jsonb_build_object(
      'provider', 'email',
      'providers', pg_catalog.jsonb_build_array('email'),
      'workspace_id', 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      'membership_role', 'owner'
    ),
    'user_metadata', '{}'::jsonb,
    'is_anonymous', false
  )::text,
  true
);
set local role authenticated;
select is(
  auth.uid(),
  '10000000-0000-4000-8000-000000000001'::uuid,
  'Alice JWT fixture resolves through auth.uid()'
);
insert into command_results (result_name, response)
select 'alice-first', api.bootstrap_personal_workspace('bootstrap-shared', 'Alice workspace');
insert into command_results (result_name, response)
select 'alice-replay', api.bootstrap_personal_workspace('bootstrap-shared', 'Alice workspace');
reset role;

select is(
  (select response from command_results where result_name = 'alice-replay'),
  (select response from command_results where result_name = 'alice-first'),
  'same idempotency key and request returns the stored response byte-for-byte'
);

select is(
  (select count(*) from identity.users),
  1::bigint,
  'Alice bootstrap creates one internal user'
);
select is(
  (select count(*) from identity.workspaces),
  1::bigint,
  'Alice bootstrap creates one workspace'
);
select is(
  (select count(*) from identity.workspace_memberships),
  1::bigint,
  'Alice bootstrap creates one owner membership'
);
select is(
  (select count(*) from outbox.command_receipts),
  1::bigint,
  'Alice replay creates no duplicate command receipt'
);
select is(
  (select count(*) from outbox.events),
  1::bigint,
  'Alice replay creates no duplicate event'
);
select is(
  (select count(*) from outbox.deliveries),
  1::bigint,
  'Alice replay creates no duplicate delivery'
);

set local role authenticated;
select throws_ok(
  $$select api.bootstrap_personal_workspace('bootstrap-shared', 'Changed workspace')$$,
  '22023',
  'idempotency key reused with a different request',
  'same idempotency key with a changed canonical request conflicts'
);
reset role;

select is(
  (select count(*) from outbox.command_receipts),
  1::bigint,
  'idempotency conflict leaves the original receipt unchanged'
);
select is(
  octet_length((select request_hash from outbox.command_receipts)),
  32,
  'command receipt stores a database-computed SHA-256 request hash'
);

set local role authenticated;
insert into command_results (result_name, response)
select 'alice-new-key', api.bootstrap_personal_workspace('bootstrap-alice-new-key', 'Alice workspace');
select throws_ok(
  $$select api.bootstrap_personal_workspace('bootstrap-alice-renamed', 'Renamed workspace')$$,
  '22023',
  'personal workspace already exists with a different name',
  'a new bootstrap key cannot silently rename an existing workspace'
);
reset role;

select is(
  (select response->>'workspace_id' from command_results where result_name = 'alice-new-key'),
  (select response->>'workspace_id' from command_results where result_name = 'alice-first'),
  'a new key with the same bootstrap input returns the existing workspace'
);
select is(
  (select count(*) from outbox.command_receipts),
  2::bigint,
  'same-name bootstrap with a new key records one completed no-op receipt'
);
select is(
  (select count(*) from outbox.events),
  1::bigint,
  'same-name no-op bootstrap emits no duplicate event'
);
select is(
  (select count(*) from outbox.deliveries),
  1::bigint,
  'same-name no-op bootstrap enqueues no duplicate delivery'
);
select is(
  (select response->'emitted_event_ids' from command_results where result_name = 'alice-new-key'),
  '[]'::jsonb,
  'same-name no-op response explicitly reports no emitted events'
);
select is(
  (
    select cardinality(receipt.emitted_event_ids)
    from outbox.command_receipts as receipt
    where receipt.idempotency_key = 'bootstrap-alice-new-key'
  ),
  0,
  'same-name no-op receipt stores an empty event identifier list'
);

create function pg_temp.reject_outbox_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  raise exception using
    errcode = 'P0001',
    message = 'pgTAP injected outbox failure';
end
$function$;

create trigger pgtap_reject_outbox_event
before insert on outbox.events
for each row execute function pg_temp.reject_outbox_event();

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '10000000-0000-4000-8000-000000000002',
    'role', 'authenticated',
    'aud', 'authenticated',
    'aal', 'aal1',
    'session_id', '11000000-0000-4000-8000-000000000002',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint,
    'app_metadata', pg_catalog.jsonb_build_object(
      'provider', 'email',
      'providers', pg_catalog.jsonb_build_array('email')
    ),
    'user_metadata', '{}'::jsonb,
    'is_anonymous', false
  )::text,
  true
);
set local role authenticated;
select is(
  auth.uid(),
  '10000000-0000-4000-8000-000000000002'::uuid,
  'Bob JWT fixture resolves through auth.uid()'
);
select throws_ok(
  $$select api.bootstrap_personal_workspace('bootstrap-shared', 'Bob workspace')$$,
  'P0001',
  'pgTAP injected outbox failure',
  'an outbox failure aborts the ordinary bootstrap command'
);
reset role;

drop trigger pgtap_reject_outbox_event on outbox.events;

select is(
  (
    select count(*)
    from identity.users
    where auth_user_id = '10000000-0000-4000-8000-000000000002'
  ),
  0::bigint,
  'failed command rolls back its identity user mutation'
);
select is(
  (select count(*) from identity.workspaces),
  1::bigint,
  'failed command rolls back its workspace mutation'
);
select is(
  (select count(*) from outbox.command_receipts),
  2::bigint,
  'failed command leaves no command receipt'
);
select is(
  (select count(*) from outbox.events),
  1::bigint,
  'failed command leaves no outbox event'
);
select is(
  (select count(*) from outbox.deliveries),
  1::bigint,
  'failed command leaves no delivery'
);

set local role authenticated;
insert into command_results (result_name, response)
select 'bob-first', api.bootstrap_personal_workspace('bootstrap-shared', 'Bob workspace');
reset role;

select is(
  (select count(*) from identity.users),
  2::bigint,
  'successful recovery creates the second internal user'
);
select is(
  (select count(*) from identity.workspaces),
  2::bigint,
  'two users have two isolated personal workspaces'
);
select is(
  (select count(*) from identity.workspace_memberships),
  2::bigint,
  'two workspaces have two owner memberships'
);
select is(
  (
    select count(*)
    from identity.workspace_memberships as membership
    join identity.workspaces as workspace
      on workspace.workspace_id = membership.workspace_id
     and workspace.created_by_user_id = membership.user_id
    where membership.membership_role = 'owner'
  ),
  2::bigint,
  'each personal workspace membership is owner-linked to its creator'
);
select is(
  (select count(*) from outbox.command_receipts),
  3::bigint,
  'the same idempotency key is valid for different actors/workspaces'
);
select is(
  (select count(*) from outbox.events),
  2::bigint,
  'each successful bootstrap has one versioned event'
);
select is(
  (select count(*) from outbox.deliveries),
  2::bigint,
  'each successful bootstrap has one consumer delivery'
);

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '10000000-0000-4000-8000-000000000001',
    'role', 'authenticated',
    'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text,
  true
);
set local role authenticated;
select is(
  api.get_workspace(
    ((select response from command_results where result_name = 'alice-first')->>'workspace_id')::uuid
  )->>'display_name',
  'Alice workspace',
  'Alice can read her own workspace through the purpose-specific query'
);
select throws_ok(
  pg_catalog.format(
    'select api.get_workspace(%L::uuid)',
    (select response->>'workspace_id' from command_results where result_name = 'bob-first')
  ),
  '42501',
  'workspace is not accessible',
  'Alice cannot read Bob workspace'
);
select throws_ok(
  $$select api.get_workspace('ffffffff-ffff-4fff-8fff-ffffffffffff'::uuid)$$,
  '42501',
  'workspace is not accessible',
  'foreign and nonexistent workspaces use the same non-oracle error'
);
select throws_ok(
  $$insert into identity.workspace_memberships (workspace_id, user_id, membership_role)
    values (
      'ffffffff-ffff-4fff-8fff-ffffffffffff',
      'ffffffff-ffff-4fff-8fff-ffffffffffff',
      'owner'
    )$$,
  '42501',
  'permission denied for table workspace_memberships',
  'authenticated cannot mutate membership tables directly'
);
reset role;

delete from identity.workspace_memberships
where workspace_id = (
  (select response from command_results where result_name = 'alice-first')->>'workspace_id'
)::uuid;

set local role authenticated;
select throws_ok(
  pg_catalog.format(
    'select api.get_workspace(%L::uuid)',
    (select response->>'workspace_id' from command_results where result_name = 'alice-first')
  ),
  '42501',
  'workspace is not accessible',
  'membership revocation takes effect without waiting for a JWT refresh'
);
reset role;

insert into identity.workspace_memberships (workspace_id, user_id, membership_role)
select
  workspace.workspace_id,
  workspace.created_by_user_id,
  'owner'
from identity.workspaces as workspace
where workspace.workspace_id = (
  (select response from command_results where result_name = 'alice-first')->>'workspace_id'
)::uuid;

select throws_ok(
  $$update outbox.events set metadata = '{"tampered":true}'::jsonb$$,
  '55000',
  'outbox events are immutable',
  'outbox event rows reject even privileged mutation attempts'
);

select throws_ok(
  $$update outbox.command_receipts set response = response
    where command_status = 'completed'$$,
  '55000',
  'completed command receipts are immutable',
  'completed command receipts reject privileged mutation attempts'
);

select * from finish();
rollback;
