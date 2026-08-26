begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    '10000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
    'current-explore-alice@pando.test', '', clock_timestamp(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    clock_timestamp(), clock_timestamp()
  ),
  (
    '10000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
    'current-explore-bob@pando.test', '', clock_timestamp(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    clock_timestamp(), clock_timestamp()
  );

create temporary table current_explore_results (
  result_name text primary key,
  response jsonb not null
);
grant select, insert on current_explore_results to authenticated;

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '10000000-0000-4000-8000-000000000001',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text,
  true
);
set local role authenticated;
insert into current_explore_results
select 'alice-bootstrap', api.bootstrap_personal_workspace(
  'current-explore-alice-bootstrap', 'Alice current Explore'
);
reset role;

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '10000000-0000-4000-8000-000000000002',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text,
  true
);
set local role authenticated;
insert into current_explore_results
select 'bob-bootstrap', api.bootstrap_personal_workspace(
  'current-explore-bob-bootstrap', 'Bob current Explore'
);
reset role;

create temporary table current_explore_workspaces as
select result_name, (response->>'workspace_id')::uuid as workspace_id
from current_explore_results
where result_name in ('alice-bootstrap', 'bob-bootstrap');
grant select on current_explore_workspaces to authenticated;

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '10000000-0000-4000-8000-000000000001',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text,
  true
);
set local role authenticated;
insert into current_explore_results
select 'alice-goal', api.create_readiness_goal(
  workspace_id,
  'goal:alice-main',
  'Alice current Explore readiness',
  'target:nvidia-python-verification-base-v1',
  'current-explore-alice-goal'
) from current_explore_workspaces where result_name = 'alice-bootstrap';
reset role;

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '10000000-0000-4000-8000-000000000002',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text,
  true
);
set local role authenticated;
insert into current_explore_results
select 'bob-goal', api.create_readiness_goal(
  workspace_id,
  'goal:bob-main',
  'Bob current Explore readiness',
  'target:nvidia-python-verification-base-v1',
  'current-explore-bob-goal'
) from current_explore_workspaces where result_name = 'bob-bootstrap';
reset role;

-- Alice may have another workspace membership, but this transport remains pinned to the workspace
-- she created rather than accepting an arbitrary caller-selected workspace.
insert into identity.workspace_memberships (workspace_id, user_id, membership_role)
select workspace.workspace_id, user_record.user_id, 'member'
from current_explore_workspaces as workspace
cross join identity.users as user_record
where workspace.result_name = 'bob-bootstrap'
  and user_record.auth_user_id = '10000000-0000-4000-8000-000000000001';

create temporary table current_explore_read_baseline as
select
  (select count(*) from outbox.command_receipts) as command_receipts,
  (select count(*) from outbox.events) as outbox_events;
grant select on current_explore_read_baseline to authenticated;

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '10000000-0000-4000-8000-000000000001',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text,
  true
);
set local role authenticated;
insert into current_explore_results
values ('alice-source', api.get_current_explore_source_v1('goal:alice-main'));
insert into current_explore_results
values ('alice-source-repeat', api.get_current_explore_source_v1('goal:alice-main', null));
reset role;

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '10000000-0000-4000-8000-000000000002',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text,
  true
);
set local role authenticated;
insert into current_explore_results
values ('bob-source', api.get_current_explore_source_v1('goal:bob-main'));
select throws_ok(
  $$select api.get_current_explore_source_v1('goal:alice-main')$$,
  '42501', 'readiness goal is not accessible',
  'a foreign readiness goal cannot cross the current personal workspace boundary'
);
select throws_ok(
  $$select api.get_current_explore_source_v1('goal:missing-main')$$,
  '42501', 'readiness goal is not accessible',
  'a missing readiness goal fails closed without exposing selection details'
);
reset role;

select is(
  (select response->'contract'->>'name' from current_explore_results where result_name = 'alice-source'),
  'ExploreSourceV1',
  'current-personal transport preserves the exact Explore source contract'
);
select is(
  (select response->>'workspaceId' from current_explore_results where result_name = 'alice-source'),
  (select workspace_id::text from current_explore_workspaces where result_name = 'alice-bootstrap'),
  'the source is pinned to Alice creator-owned personal workspace across multiple memberships'
);
select is(
  (select response->>'readinessGoalKey' from current_explore_results where result_name = 'alice-source'),
  'goal:alice-main',
  'the caller-selected readiness goal remains exact'
);
select is(
  (select response from current_explore_results where result_name = 'alice-source-repeat'),
  (select response from current_explore_results where result_name = 'alice-source'),
  'repeated current-personal reads are byte-equivalent'
);
select ok(
  position(
    'goal:alice-main' in (select response::text from current_explore_results where result_name = 'bob-source')
  ) = 0,
  'Bob cannot infer Alice goal data through the current-personal transport'
);
select is(
  (select count(*) from outbox.command_receipts),
  (select command_receipts from current_explore_read_baseline),
  'current-personal Explore reads create no command receipts'
);
select is(
  (select count(*) from outbox.events),
  (select outbox_events from current_explore_read_baseline),
  'current-personal Explore reads emit no outbox events'
);

select ok(
  has_function_privilege('authenticated', 'api.get_current_explore_source_v1(text,text)', 'EXECUTE'),
  'authenticated may execute the current-personal Explore source query'
);
select ok(
  not coalesce(
    has_function_privilege(
      'authenticated',
      pg_catalog.to_regprocedure('api.get_explore_source_v1(uuid,text,text)'),
      'EXECUTE'
    ),
    false
  ),
  'authenticated cannot execute the removed caller-selected Explore source query'
);
select ok(
  not has_function_privilege('anon', 'api.get_current_explore_source_v1(text,text)', 'EXECUTE'),
  'anon cannot execute the current-personal Explore source query'
);
select ok(
  not has_function_privilege('service_role', 'api.get_current_explore_source_v1(text,text)', 'EXECUTE'),
  'service role is not an ordinary current-personal Explore caller'
);
select ok(
  not (
    select routine.prosecdef
    from pg_catalog.pg_proc as routine
    where routine.oid = 'api.get_current_explore_source_v1(text,text)'::pg_catalog.regprocedure
  ),
  'the current-personal Explore wrapper remains security invoker'
);

select set_config('request.jwt.claims', '{"role":"authenticated","aud":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select api.get_current_explore_source_v1('goal:alice-main')$$,
  '28000', 'an authenticated user is required',
  'current-personal Explore source requires a verified JWT subject'
);
reset role;

set local role anon;
select throws_ok(
  $$select api.get_current_explore_source_v1('goal:alice-main')$$,
  '42501', 'permission denied for schema api',
  'anon cannot call current-personal Explore source even with forged claims'
);
reset role;

set local role service_role;
select throws_ok(
  $$select api.get_current_explore_source_v1('goal:alice-main')$$,
  '42501', 'permission denied for function get_current_explore_source_v1',
  'service role cannot call the ordinary current-personal Explore source query'
);
reset role;

delete from identity.workspace_memberships
where workspace_id = (
  select workspace_id from current_explore_workspaces where result_name = 'alice-bootstrap'
);

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '10000000-0000-4000-8000-000000000001',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text,
  true
);
set local role authenticated;
select throws_ok(
  $$select api.get_current_explore_source_v1('goal:alice-main')$$,
  '42501', 'personal workspace membership is revoked',
  'revoked membership invalidates the next current-personal Explore read immediately'
);
reset role;

select * from finish();
rollback;
