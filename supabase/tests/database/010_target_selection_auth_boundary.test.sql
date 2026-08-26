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
    'target-selection-alice@pando.test', '', clock_timestamp(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    clock_timestamp(), clock_timestamp()
  ),
  (
    '10000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
    'target-selection-bob@pando.test', '', clock_timestamp(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    clock_timestamp(), clock_timestamp()
  ),
  (
    '10000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
    'target-selection-carol@pando.test', '', clock_timestamp(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    clock_timestamp(), clock_timestamp()
  );

create temporary table target_selection_results (
  result_name text primary key,
  response jsonb not null
);
grant select, insert on target_selection_results to authenticated;

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
insert into target_selection_results
select 'alice-bootstrap', api.bootstrap_personal_workspace(
  'target-selection-alice-bootstrap', 'Personal workspace'
);
insert into target_selection_results
select 'alice-initial', api.get_target_selection_source_v1();
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
insert into target_selection_results
select 'bob-bootstrap', api.bootstrap_personal_workspace(
  'target-selection-bob-bootstrap', 'Personal workspace'
);
insert into target_selection_results
select 'bob-initial', api.get_target_selection_source_v1();
reset role;

create temporary table target_selection_workspaces as
select
  result_name,
  (response->>'workspace_id')::uuid as workspace_id
from target_selection_results
where result_name in ('alice-bootstrap', 'bob-bootstrap');
grant select on target_selection_workspaces to authenticated;

insert into targets.target_profile_series (
  profile_series_key, profile_scope, workspace_id, lifecycle
)
values (
  'target-series:alice-private',
  'workspace',
  (select workspace_id from target_selection_workspaces where result_name = 'alice-bootstrap'),
  'active'
);
insert into targets.target_profile_versions (
  profile_version_key,
  profile_series_id,
  workspace_id,
  base_profile_version_id,
  catalog_version_id,
  roadmap_version_id,
  version_number,
  lifecycle,
  role_title,
  company_name,
  source_summary,
  freshness_status,
  reviewed_at,
  root_rule_key,
  readiness_threshold,
  published_at
)
select
  'target:alice-private-v1',
  (select profile_series_id from targets.target_profile_series
   where profile_series_key = 'target-series:alice-private'),
  (select workspace_id from target_selection_workspaces where result_name = 'alice-bootstrap'),
  base.profile_version_id,
  base.catalog_version_id,
  base.roadmap_version_id,
  1,
  'published',
  'Alice private interview target',
  null,
  'Private workspace profile for tenant-isolation proof.',
  'reviewed',
  current_date,
  base.root_rule_key,
  base.readiness_threshold,
  clock_timestamp()
from targets.target_profile_versions as base
where base.profile_version_key = 'target:nvidia-python-verification-base-v1';

select throws_ok(
  $$insert into targets.target_profile_versions (
      profile_version_key, profile_series_id, workspace_id, base_profile_version_id,
      catalog_version_id, roadmap_version_id, version_number, lifecycle, role_title,
      company_name, source_summary, freshness_status, reviewed_at, root_rule_key,
      readiness_threshold
    )
    select
      'target:alice-unsafe-text-v1', series.profile_series_id, series.workspace_id,
      base.profile_version_id, base.catalog_version_id, base.roadmap_version_id, 2, 'draft',
      E'Unsafe\nprofile title', null, 'Safe source', 'reviewed', current_date,
      base.root_rule_key, base.readiness_threshold
    from targets.target_profile_series as series
    cross join targets.target_profile_versions as base
    where series.profile_series_key = 'target-series:alice-private'
      and base.profile_version_key = 'target:nvidia-python-verification-base-v1'$$,
  '23514',
  'new row for relation "target_profile_versions" violates check constraint "profile_versions_role_safe_text_check"',
  'workspace target profiles cannot persist control characters rejected by TargetSelectionSourceV1'
);
select is(
  (select count(*) from targets.target_profile_versions
   where profile_version_key = 'target:alice-unsafe-text-v1'),
  0::bigint,
  'a rejected unsafe target profile leaves no state'
);

-- A user may be invited to another personal workspace in the future. The current workspace remains
-- the one created by the subject rather than an arbitrary membership row.
insert into identity.workspace_memberships (workspace_id, user_id, membership_role)
select
  (select workspace_id from target_selection_workspaces where result_name = 'bob-bootstrap'),
  user_record.user_id,
  'member'
from identity.users as user_record
where user_record.auth_user_id = '10000000-0000-4000-8000-000000000001';

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
insert into target_selection_results
select 'alice-multiple-memberships', api.get_target_selection_source_v1();
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
insert into target_selection_results
select 'bob-after-private-profile', api.get_target_selection_source_v1();
reset role;

select is(
  (select response->'contract'->>'name' from target_selection_results where result_name = 'alice-initial'),
  'TargetSelectionSourceV1',
  'target selection declares its exact contract name'
);
select is(
  (select response->'contract'->>'version' from target_selection_results where result_name = 'alice-initial'),
  '1.0.0',
  'target selection declares its exact contract version'
);
select is(
  (select response->'workspace'->>'workspaceId' from target_selection_results where result_name = 'alice-initial'),
  (select workspace_id::text from target_selection_workspaces where result_name = 'alice-bootstrap'),
  'the zero-argument query derives Alice current workspace from the subject and membership'
);
select is(
  (select response->'workspace'->>'workspaceId'
   from target_selection_results where result_name = 'alice-multiple-memberships'),
  (select workspace_id::text from target_selection_workspaces where result_name = 'alice-bootstrap'),
  'the current workspace remains the subject-created personal workspace across multiple memberships'
);
select ok(
  (select response->'profiles' from target_selection_results
   where result_name = 'alice-multiple-memberships')
  @> '[{"profileVersionKey":"target:alice-private-v1","scope":"workspace"}]'::jsonb,
  'Alice can select her workspace-scoped target profile'
);
select ok(
  not (
    (select response->'profiles' from target_selection_results
     where result_name = 'bob-after-private-profile')
    @> '[{"profileVersionKey":"target:alice-private-v1"}]'::jsonb
  ),
  'Bob cannot infer Alice workspace-scoped target profile'
);
select is(
  jsonb_array_length((select response->'profiles' from target_selection_results where result_name = 'alice-initial')),
  1,
  'Alice initially sees the one published canonical target profile'
);
select is(
  (select profile.value->>'freshnessStatus'
   from target_selection_results as result
   cross join lateral pg_catalog.jsonb_array_elements(result.response->'profiles') as profile(value)
   where result.result_name = 'alice-initial'),
  'initial_curated_assumption',
  'the seeded target remains visibly marked as an initial curated assumption'
);
select is(
  (select profile.value->>'sourceSummary'
   from target_selection_results as result
   cross join lateral pg_catalog.jsonb_array_elements(result.response->'profiles') as profile(value)
   where result.result_name = 'alice-initial'),
  'Initial product fixture assumptions; production weights require separate sourcing and curator review.',
  'target selection exposes the exact bounded provenance summary'
);
select is(
  (select profile.value->>'catalogVersionKey'
   from target_selection_results as result
   cross join lateral pg_catalog.jsonb_array_elements(result.response->'profiles') as profile(value)
   where result.result_name = 'alice-initial'),
  'catalog:seed-v1',
  'the selector pins the seeded profile to its exact catalog version'
);
select is(
  (select profile.value->>'roadmapVersionKey'
   from target_selection_results as result
   cross join lateral pg_catalog.jsonb_array_elements(result.response->'profiles') as profile(value)
   where result.result_name = 'alice-initial'),
  'roadmap:nvidia-python-verification-v1',
  'the selector pins the seeded profile to its exact roadmap version'
);
select is(
  jsonb_array_length((select response->'readinessGoals' from target_selection_results where result_name = 'alice-initial')),
  0,
  'a bootstrapped workspace begins without a fabricated readiness goal'
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
insert into target_selection_results
select 'alice-goal', api.create_readiness_goal(
  workspace_id,
  'goal:nvidia-python-verification-base-v1',
  'Python and Verification Interview Readiness',
  'target:nvidia-python-verification-base-v1',
  'target-select-v1:target:nvidia-python-verification-base-v1'
) from target_selection_workspaces where result_name = 'alice-bootstrap';
insert into target_selection_results
select 'alice-goal-replay', api.create_readiness_goal(
  workspace_id,
  'goal:nvidia-python-verification-base-v1',
  'Python and Verification Interview Readiness',
  'target:nvidia-python-verification-base-v1',
  'target-select-v1:target:nvidia-python-verification-base-v1'
) from target_selection_workspaces where result_name = 'alice-bootstrap';
insert into target_selection_results
select 'alice-goal-a', api.create_readiness_goal(
  workspace_id, 'goal:aaa-history', 'Historical A',
  'target:nvidia-python-verification-base-v1', 'target-selection-goal-a'
) from target_selection_workspaces where result_name = 'alice-bootstrap';
insert into target_selection_results
select 'alice-goal-z', api.create_readiness_goal(
  workspace_id, 'goal:zzz-history', 'Historical Z',
  'target:nvidia-python-verification-base-v1', 'target-selection-goal-z'
) from target_selection_workspaces where result_name = 'alice-bootstrap';
insert into target_selection_results
select 'alice-after-goals', api.get_target_selection_source_v1();
select throws_ok(
  pg_catalog.format(
    'select api.create_readiness_goal(%L::uuid,%L,%L,%L,%L)',
    (select workspace_id from target_selection_workspaces where result_name = 'alice-bootstrap'),
    'goal:unsafe-title', 'Unsafe <goal> title',
    'target:nvidia-python-verification-base-v1', 'target-selection-unsafe-goal-title'
  ),
  '23514',
  'new row for relation "readiness_goals" violates check constraint "readiness_goals_title_safe_text_check"',
  'readiness-goal commands cannot persist markup delimiters rejected by TargetSelectionSourceV1'
);
reset role;

select is(
  (select count(*) from targets.readiness_goals where readiness_goal_key = 'goal:unsafe-title'),
  0::bigint,
  'an unsafe readiness-goal title leaves no goal state'
);
select is(
  (select count(*) from outbox.command_receipts
   where idempotency_key = 'target-selection-unsafe-goal-title'),
  0::bigint,
  'an unsafe readiness-goal title rolls back its command receipt'
);
select is(
  (select count(*) from outbox.events
   where event_name = 'targets.readiness_goal_created'
     and payload->>'readiness_goal_key' = 'goal:unsafe-title'),
  0::bigint,
  'an unsafe readiness-goal title emits no outbox event'
);

select is(
  (select response from target_selection_results where result_name = 'alice-goal-replay'),
  (select response from target_selection_results where result_name = 'alice-goal'),
  'an identical target selection retry returns the stored response byte-for-byte'
);
select is(
  (select count(*) from targets.readiness_goals
   where workspace_id = (select workspace_id from target_selection_workspaces where result_name = 'alice-bootstrap')
     and readiness_goal_key = 'goal:nvidia-python-verification-base-v1'),
  1::bigint,
  'target selection persists exactly one readiness goal for an idempotent retry'
);
select is(
  (
    select profile.profile_version_key
    from targets.readiness_goals as goal
    join targets.target_profile_versions as profile
      on profile.profile_version_id = goal.profile_version_id
    where goal.workspace_id = (
      select workspace_id from target_selection_workspaces where result_name = 'alice-bootstrap'
    ) and goal.readiness_goal_key = 'goal:nvidia-python-verification-base-v1'
  ),
  'target:nvidia-python-verification-base-v1',
  'the readiness goal retains the exact immutable target profile version'
);
select is(
  (
    select pg_catalog.array_agg(goal.value->>'readinessGoalKey' order by goal.ordinality)
    from target_selection_results as result
    cross join lateral pg_catalog.jsonb_array_elements(result.response->'readinessGoals')
      with ordinality as goal(value, ordinality)
    where result.result_name = 'alice-after-goals'
  ),
  array[
    'goal:aaa-history',
    'goal:nvidia-python-verification-base-v1',
    'goal:zzz-history'
  ]::text[],
  'readiness goal discovery is stable by readiness goal key'
);

create function pg_temp.reject_target_selection_outbox_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.event_name = 'targets.readiness_goal_created' then
    raise exception using errcode = 'P0001', message = 'pgTAP injected readiness outbox failure';
  end if;
  return new;
end
$function$;
create trigger pgtap_reject_target_selection_outbox_event
before insert on outbox.events
for each row execute function pg_temp.reject_target_selection_outbox_event();

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
select throws_ok(
  pg_catalog.format(
    'select api.create_readiness_goal(%L::uuid,%L,%L,%L,%L)',
    (select workspace_id from target_selection_workspaces where result_name = 'bob-bootstrap'),
    'goal:bob-rollback', 'Bob rollback target',
    'target:nvidia-python-verification-base-v1', 'bob-rollback-command'
  ),
  'P0001',
  'pgTAP injected readiness outbox failure',
  'an outbox failure aborts the complete readiness-goal command'
);
reset role;

select is(
  (select count(*) from targets.readiness_goals
   where workspace_id = (select workspace_id from target_selection_workspaces where result_name = 'bob-bootstrap')),
  0::bigint,
  'outbox failure rolls back the readiness goal row'
);
select is(
  (select count(*) from outbox.command_receipts where idempotency_key = 'bob-rollback-command'),
  0::bigint,
  'outbox failure rolls back the readiness goal command receipt'
);
select is(
  (select count(*) from outbox.events
   where workspace_id = (select workspace_id from target_selection_workspaces where result_name = 'bob-bootstrap')
     and event_name = 'targets.readiness_goal_created'),
  0::bigint,
  'outbox failure leaves no readiness goal event'
);

drop trigger pgtap_reject_target_selection_outbox_event on outbox.events;

set local role authenticated;
insert into target_selection_results
select 'bob-goal', api.create_readiness_goal(
  workspace_id, 'goal:bob-main', 'Bob readiness',
  'target:nvidia-python-verification-base-v1', 'bob-main-command'
) from target_selection_workspaces where result_name = 'bob-bootstrap';
insert into target_selection_results
select 'bob-after-goal', api.get_target_selection_source_v1();
select throws_ok(
  pg_catalog.format(
    'select targets.get_target_selection_options_impl(%L::uuid)',
    (select workspace_id from target_selection_workspaces where result_name = 'alice-bootstrap')
  ),
  '42501', 'workspace is not accessible',
  'the Targets owner query repeats foreign-workspace authorization'
);
reset role;

select ok(
  not (
    (select response->'readinessGoals' from target_selection_results where result_name = 'bob-after-goal')
    @> '[{"readinessGoalKey":"goal:nvidia-python-verification-base-v1"}]'::jsonb
  ),
  'Bob target-selection source contains no Alice readiness goal'
);
select ok(
  not (
    (select response->'readinessGoals' from target_selection_results where result_name = 'alice-after-goals')
    @> '[{"readinessGoalKey":"goal:bob-main"}]'::jsonb
  ),
  'Alice target-selection source contains no Bob readiness goal'
);

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '10000000-0000-4000-8000-000000000003',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text,
  true
);
set local role authenticated;
select throws_ok(
  $$select api.bootstrap_personal_workspace(
      'target-selection-carol-unsafe-workspace', E'Unsafe\nworkspace'
    )$$,
  '23514',
  'new row for relation "workspaces" violates check constraint "workspaces_display_name_safe_text_check"',
  'workspace bootstrap cannot persist control characters rejected by TargetSelectionSourceV1'
);
insert into target_selection_results
select 'carol-unbootstrapped', api.get_target_selection_source_v1();
reset role;

select is(
  (select response->'workspace' from target_selection_results where result_name = 'carol-unbootstrapped'),
  'null'::jsonb,
  'a subject that never created a personal workspace receives the explicit unbootstrapped state'
);
select is(
  (select response->'profiles' from target_selection_results where result_name = 'carol-unbootstrapped'),
  '[]'::jsonb,
  'an unbootstrapped subject receives no target profiles'
);
select is(
  (select count(*) from outbox.command_receipts
   where idempotency_key = 'target-selection-carol-unsafe-workspace'),
  0::bigint,
  'an unsafe workspace name rolls back its command receipt'
);
select is(
  (select count(*) from identity.workspaces where display_name ~ '[[:cntrl:]<>]'),
  0::bigint,
  'an unsafe workspace name leaves no workspace state'
);

delete from identity.workspace_memberships
where workspace_id = (
  select workspace_id from target_selection_workspaces where result_name = 'alice-bootstrap'
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
  $$select api.get_target_selection_source_v1()$$,
  '42501', 'personal workspace membership is revoked',
  'membership revocation is rejected immediately rather than misrepresented as unbootstrapped'
);
reset role;

select set_config('request.jwt.claims', '{"role":"authenticated","aud":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select api.get_target_selection_source_v1()$$,
  '28000', 'an authenticated user is required',
  'the target-selection source requires a verified subject'
);
reset role;

set local role anon;
select throws_ok(
  $$select api.get_target_selection_source_v1()$$,
  '42501', 'permission denied for schema api',
  'anon cannot execute target selection even with forged request claims'
);
reset role;

set local role service_role;
select throws_ok(
  $$select api.get_target_selection_source_v1()$$,
  '42501', 'permission denied for function get_target_selection_source_v1',
  'ordinary target selection is unavailable to service role'
);
reset role;

select * from finish();
rollback;
