begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- Public boundary: exactly the nine D4 authenticated entry points and no private alternative.
select ok(
  pg_catalog.has_function_privilege(
    'authenticated', 'api.preview_interview_campaign_creation_v1(text,text,text,date,text,text)',
    'EXECUTE'
  ) and pg_catalog.has_function_privilege(
    'authenticated',
    'api.apply_interview_campaign_creation_v1(text,text,text,date,text,text,text)', 'EXECUTE'
  ) and pg_catalog.has_function_privilege(
    'authenticated',
    'api.preview_interview_campaign_deadline_change_v1(text,text,date,text)', 'EXECUTE'
  ) and pg_catalog.has_function_privilege(
    'authenticated',
    'api.apply_interview_campaign_deadline_change_v1(text,text,date,text,text,text)', 'EXECUTE'
  ) and pg_catalog.has_function_privilege(
    'authenticated',
    'api.preview_interview_campaign_retarget_v1(text,text,text,text,text)', 'EXECUTE'
  ) and pg_catalog.has_function_privilege(
    'authenticated',
    'api.apply_interview_campaign_retarget_v1(text,text,text,text,text,text,text)', 'EXECUTE'
  ) and pg_catalog.has_function_privilege(
    'authenticated', 'api.preview_interview_campaign_lifecycle_v1(text,text,text,text)', 'EXECUTE'
  ) and pg_catalog.has_function_privilege(
    'authenticated',
    'api.apply_interview_campaign_lifecycle_v1(text,text,text,text,text,text)', 'EXECUTE'
  ) and pg_catalog.has_function_privilege(
    'authenticated', 'api.get_interview_campaigns_v1()', 'EXECUTE'
  ),
  'authenticated has exactly the nine D4 public entry points'
);

select ok(
  not pg_catalog.has_function_privilege(runtime.role_name, expected.signature, 'EXECUTE'),
  format('%s cannot execute %s', runtime.role_name, expected.signature)
)
from (values ('anon'), ('service_role')) as runtime(role_name)
cross join (values
  ('api.preview_interview_campaign_creation_v1(text,text,text,date,text,text)'),
  ('api.apply_interview_campaign_creation_v1(text,text,text,date,text,text,text)'),
  ('api.preview_interview_campaign_deadline_change_v1(text,text,date,text)'),
  ('api.apply_interview_campaign_deadline_change_v1(text,text,date,text,text,text)'),
  ('api.preview_interview_campaign_retarget_v1(text,text,text,text,text)'),
  ('api.apply_interview_campaign_retarget_v1(text,text,text,text,text,text,text)'),
  ('api.preview_interview_campaign_lifecycle_v1(text,text,text,text)'),
  ('api.apply_interview_campaign_lifecycle_v1(text,text,text,text,text,text)'),
  ('api.get_interview_campaigns_v1()')
) as expected(signature);

select ok(
  not pg_catalog.has_function_privilege(runtime.role_name, expected.signature, 'EXECUTE'),
  format('%s cannot execute private D4 helper %s', runtime.role_name, expected.signature)
)
from (values ('anon'), ('authenticated'), ('service_role')) as runtime(role_name)
cross join (values
  ('targets.derive_campaign_identity_v1(uuid,text,text,text)'),
  ('targets.local_timestamp_to_instant_v1(timestamp,text)'),
  ('targets.campaign_created_event_payload_v1_is_valid(jsonb)'),
  ('targets.campaign_lifecycle_event_payload_v1_is_valid(jsonb)'),
  ('targets.campaign_deadline_changed_event_payload_v1_is_valid(jsonb)'),
  ('targets.campaign_retargeted_event_payload_v1_is_valid(jsonb)'),
  ('targets.build_interview_campaign_creation_preview_v1(uuid,uuid,text,text,text,bigint,bigint,text,date,text,date,text,text)'),
  ('targets.build_interview_campaign_deadline_preview_v1(uuid,uuid,text,text,text,date,text,bigint,bigint,date,text,date,text)'),
  ('targets.build_interview_campaign_retarget_preview_v1(uuid,uuid,text,text,text,bigint,bigint,uuid,text,text,uuid,text,text,text,bigint,bigint,integer,text)'),
  ('targets.build_interview_campaign_lifecycle_preview_v1(uuid,uuid,text,text,text,bigint,text,bigint,text)')
) as expected(signature);

select ok(
  not pg_catalog.has_table_privilege(runtime.role_name, expected.table_name, 'SELECT'),
  format('%s cannot read %s directly', runtime.role_name, expected.table_name)
)
from (values ('anon'), ('authenticated'), ('service_role')) as runtime(role_name)
cross join (values
  ('targets.interview_campaigns'), ('targets.interview_campaign_target_revisions')
) as expected(table_name);

select ok(
  procedure.prosecdef
    and 'search_path=""' = any(coalesce(procedure.proconfig, '{}'::text[]))
    and owner.rolname = 'pando_phase1_api',
  format('api.%s is a pinned Targets owner definer', procedure.proname)
)
from pg_catalog.pg_proc as procedure
join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
join pg_catalog.pg_roles as owner on owner.oid = procedure.proowner
where namespace.nspname = 'api'
  and procedure.proname in (
    'preview_interview_campaign_creation_v1', 'apply_interview_campaign_creation_v1',
    'preview_interview_campaign_deadline_change_v1', 'apply_interview_campaign_deadline_change_v1',
    'preview_interview_campaign_retarget_v1', 'apply_interview_campaign_retarget_v1',
    'preview_interview_campaign_lifecycle_v1', 'apply_interview_campaign_lifecycle_v1',
    'get_interview_campaigns_v1'
  )
order by procedure.proname;

select ok(
  relation.relrowsecurity and relation.relforcerowsecurity,
  format('%s has forced row level security', expected.table_name)
)
from (values ('interview_campaigns'), ('interview_campaign_target_revisions')) as expected(table_name)
join pg_catalog.pg_class as relation on relation.relname = expected.table_name
join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
  and namespace.nspname = 'targets';

-- Identity derivation is deterministic, lowercase, and command-type pinned.
select is(
  targets.derive_campaign_identity_v1(
    'a0000000-0000-4000-8000-000000000001', 'targets.create_interview_campaign_v1',
    'b0000000-0000-4000-8000-000000000001', 'interview-campaign'
  )::text,
  pg_catalog.lower(
    targets.derive_campaign_identity_v1(
      'a0000000-0000-4000-8000-000000000001', 'targets.create_interview_campaign_v1',
      'b0000000-0000-4000-8000-000000000001', 'interview-campaign'
    )::text
  ),
  'the derived campaign identity is deterministic and lowercase'
);
select isnt(
  targets.derive_campaign_identity_v1(
    'a0000000-0000-4000-8000-000000000001', 'targets.create_interview_campaign_v1',
    'b0000000-0000-4000-8000-000000000001', 'interview-campaign'
  )::text,
  targets.derive_campaign_identity_v1(
    'a0000000-0000-4000-8000-000000000002', 'targets.create_interview_campaign_v1',
    'b0000000-0000-4000-8000-000000000001', 'interview-campaign'
  )::text,
  'different workspaces derive different campaign identities for the same idempotency key'
);
select throws_ok(
  $$select targets.derive_campaign_identity_v1(
    'a0000000-0000-4000-8000-000000000001', 'planning.replace_growth_plan_v1',
    'b0000000-0000-4000-8000-000000000001', 'interview-campaign'
  )$$,
  '22023', 'campaign identity input is invalid',
  'the campaign identity refuses another command type'
);

-- The local round-trip helper mirrors the released Review pattern.
select is(
  targets.local_timestamp_to_instant_v1('2026-10-05 00:00:00'::timestamp, 'UTC')::text,
  '2026-10-05 00:00:00+00',
  'the local deadline instant helper resolves an ordinary UTC midnight'
);
select throws_ok(
  $$select targets.local_timestamp_to_instant_v1(null, 'UTC')$$,
  '22023', 'campaign local deadline time is invalid',
  'the local deadline instant helper refuses a null local timestamp'
);

-- Event payload validators admit only the exact minimal wake-up per change kind.
select ok(
  targets.campaign_created_event_payload_v1_is_valid(pg_catalog.jsonb_build_object(
    'change_kind', 'CAMPAIGN_CREATED',
    'campaign_id', '10000000-0000-4000-8000-000000000001',
    'campaign_version', '1',
    'readiness_goal_id', '10000000-0000-4000-8000-000000000002'
  )),
  'the exact four-key created payload is valid'
);
select ok(
  not targets.campaign_created_event_payload_v1_is_valid(pg_catalog.jsonb_build_object(
    'change_kind', 'CAMPAIGN_CREATED',
    'campaign_id', '10000000-0000-4000-8000-000000000001',
    'campaign_version', '1',
    'readiness_goal_id', '10000000-0000-4000-8000-000000000002',
    'title', 'leaked title'
  )),
  'a created payload carrying a title is refused'
);
select ok(
  targets.campaign_lifecycle_event_payload_v1_is_valid(pg_catalog.jsonb_build_object(
    'change_kind', 'CAMPAIGN_LIFECYCLE_CHANGED',
    'campaign_id', '10000000-0000-4000-8000-000000000001',
    'campaign_version', '2',
    'lifecycle', 'ACTIVE'
  )),
  'the exact four-key lifecycle payload is valid'
);
select ok(
  not targets.campaign_lifecycle_event_payload_v1_is_valid(pg_catalog.jsonb_build_object(
    'change_kind', 'CAMPAIGN_LIFECYCLE_CHANGED',
    'campaign_id', '10000000-0000-4000-8000-000000000001',
    'campaign_version', '2',
    'lifecycle', 'DRAFT'
  )),
  'a lifecycle payload naming an unreachable-by-transition lifecycle is refused'
);
select ok(
  targets.campaign_deadline_changed_event_payload_v1_is_valid(pg_catalog.jsonb_build_object(
    'change_kind', 'CAMPAIGN_DEADLINE_CHANGED',
    'campaign_id', '10000000-0000-4000-8000-000000000001',
    'campaign_version', '2'
  )),
  'the exact three-key deadline-changed payload is valid'
);
select ok(
  not targets.campaign_deadline_changed_event_payload_v1_is_valid(pg_catalog.jsonb_build_object(
    'change_kind', 'CAMPAIGN_DEADLINE_CHANGED',
    'campaign_id', '10000000-0000-4000-8000-000000000001',
    'campaign_version', '2',
    'deadline_local_date', '2026-10-05'
  )),
  'a deadline-changed payload carrying the actual date is refused'
);
select ok(
  targets.campaign_retargeted_event_payload_v1_is_valid(pg_catalog.jsonb_build_object(
    'change_kind', 'CAMPAIGN_RETARGETED',
    'campaign_id', '10000000-0000-4000-8000-000000000001',
    'campaign_version', '2',
    'previous_readiness_goal_id', '10000000-0000-4000-8000-000000000002',
    'new_readiness_goal_id', '10000000-0000-4000-8000-000000000003'
  )),
  'the exact five-key retargeted payload is valid'
);
select ok(
  not targets.campaign_retargeted_event_payload_v1_is_valid(pg_catalog.jsonb_build_object(
    'change_kind', 'CAMPAIGN_RETARGETED',
    'campaign_id', '10000000-0000-4000-8000-000000000001',
    'campaign_version', '2',
    'previous_readiness_goal_id', '10000000-0000-4000-8000-000000000002',
    'new_readiness_goal_id', '10000000-0000-4000-8000-000000000002'
  )),
  'a retargeted payload naming the same goal twice is refused'
);

-- ---------------------------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------------------------

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '50000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'd4-alice@pando.test', '', pg_catalog.clock_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
), (
  '50000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
  'd4-bob@pando.test', '', pg_catalog.clock_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
);

create temporary table d4_results (result_name text primary key, response jsonb);
grant select, insert, update on d4_results to authenticated;

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '50000000-0000-4000-8000-000000000001',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from pg_catalog.clock_timestamp() + interval '1 hour')::bigint
  )::text,
  true
);
set local role authenticated;

insert into d4_results values (
  'bootstrap', api.bootstrap_personal_workspace('d4-alice', 'D4 Alice')
);
insert into d4_results
select 'goal-first', api.create_readiness_goal(
  (select (response->>'workspace_id')::uuid from d4_results where result_name = 'bootstrap'),
  'goal:d4-first', 'D4 first target',
  'target:nvidia-python-verification-base-v1', 'd4-goal-first'
);
insert into d4_results
select 'goal-second', api.create_readiness_goal(
  (select (response->>'workspace_id')::uuid from d4_results where result_name = 'bootstrap'),
  'goal:d4-second', 'D4 second target',
  'target:nvidia-python-verification-base-v1', 'd4-goal-second'
);

-- ---------------------------------------------------------------------------------------------
-- Creation
-- ---------------------------------------------------------------------------------------------

select throws_ok(
  $$select api.preview_interview_campaign_creation_v1(
    'goal:d4-missing', '1', 'Prep', (current_date + 30)::date, 'reason',
    '50000000-0000-4000-8000-0000000000a1'
  )$$,
  '42501', 'readiness goal is not accessible',
  'creation preview refuses an unknown readiness goal'
);
select throws_ok(
  pg_catalog.format(
    $$select api.preview_interview_campaign_creation_v1(
      'goal:d4-first', %L, 'Prep', %L, 'reason', '50000000-0000-4000-8000-0000000000a2'
    )$$,
    (select response#>>'{aggregateVersion}' from d4_results where result_name = 'goal-first'),
    (current_date - 1)::date
  ),
  '22023', 'Interview Campaign deadline must not be in the past',
  'creation preview refuses a deadline already in the past'
);
select throws_ok(
  pg_catalog.format(
    $$select api.preview_interview_campaign_creation_v1(
      'goal:d4-first', %L, 'Prep', %L, 'reason', '50000000-0000-4000-8000-0000000000a3'
    )$$,
    (select response#>>'{aggregateVersion}' from d4_results where result_name = 'goal-first'),
    (current_date + 36501)::date
  ),
  '22023', 'Interview Campaign deadline is too far in the future',
  'creation preview refuses a deadline more than 36500 days ahead'
);
select throws_ok(
  pg_catalog.format(
    $$select api.preview_interview_campaign_creation_v1(
      'goal:d4-first', '9', 'Prep', %L, 'reason', '50000000-0000-4000-8000-0000000000a4'
    )$$,
    (current_date + 30)::date
  ),
  '40001', 'readiness goal version is stale',
  'creation preview refuses a stale expected Goal version'
);

insert into d4_results
select 'create-preview', api.preview_interview_campaign_creation_v1(
  'goal:d4-first',
  (select response#>>'{aggregateVersion}' from d4_results where result_name = 'goal-first'),
  'Prep for Acme interview', (current_date + 30)::date, 'Starting prep.',
  '50000000-0000-4000-8000-000000000101'
);
select is(
  (select response#>>'{after,lifecycle}' from d4_results where result_name = 'create-preview'),
  'DRAFT',
  'the creation preview reports the new campaign starting in draft'
);
select is(
  (select response#>>'{after,deadline,localDate}' from d4_results where result_name = 'create-preview'),
  (current_date + 30)::text,
  'the creation preview reports the exact requested local deadline date'
);
select is(
  (select pg_catalog.jsonb_array_length(response->'warnings') from d4_results where result_name = 'create-preview'),
  0,
  'a fresh creation preview carries no warnings'
);

select throws_ok(
  pg_catalog.format(
    $$select api.apply_interview_campaign_creation_v1(
      'goal:d4-first', %L, 'Prep for Acme interview', %L, 'Starting prep.',
      '50000000-0000-4000-8000-000000000101', %L
    )$$,
    (select response#>>'{aggregateVersion}' from d4_results where result_name = 'goal-first'),
    (current_date + 30)::date, pg_catalog.repeat('0', 64)
  ),
  '40001', 'Interview Campaign creation preview is stale',
  'a changed preview digest is refused before any row is created'
);

insert into d4_results
select 'create-apply', api.apply_interview_campaign_creation_v1(
  'goal:d4-first',
  (select response#>>'{aggregateVersion}' from d4_results where result_name = 'goal-first'),
  'Prep for Acme interview', (current_date + 30)::date, 'Starting prep.',
  '50000000-0000-4000-8000-000000000101',
  (select response->>'previewDigest' from d4_results where result_name = 'create-preview')
);
select is(
  (select response#>>'{campaign,lifecycle}' from d4_results where result_name = 'create-apply'),
  'DRAFT',
  'the applied campaign starts in draft'
);
select is(
  (select response#>>'{campaign,aggregateVersion}' from d4_results where result_name = 'create-apply'),
  '1',
  'the applied campaign starts at aggregate version one'
);

-- Replay and conflicting reuse of the same key.
insert into d4_results
select 'create-replay', api.apply_interview_campaign_creation_v1(
  'goal:d4-first',
  (select response#>>'{aggregateVersion}' from d4_results where result_name = 'goal-first'),
  'Prep for Acme interview', (current_date + 30)::date, 'Starting prep.',
  '50000000-0000-4000-8000-000000000101',
  (select response->>'previewDigest' from d4_results where result_name = 'create-preview')
);
select is(
  (select response from d4_results where result_name = 'create-replay'),
  (select response from d4_results where result_name = 'create-apply'),
  'an identical replay returns the stored response'
);
select throws_ok(
  pg_catalog.format(
    $$select api.apply_interview_campaign_creation_v1(
      'goal:d4-first', %L, 'Different title', %L, 'Starting prep.',
      '50000000-0000-4000-8000-000000000101', %L
    )$$,
    (select response#>>'{aggregateVersion}' from d4_results where result_name = 'goal-first'),
    (current_date + 30)::date,
    (select response->>'previewDigest' from d4_results where result_name = 'create-preview')
  ),
  '22023', 'idempotency key reused with a different request',
  'the same idempotency key with a different request is refused'
);

reset role;
select ok(
  (select count(*) = 1 from targets.interview_campaigns
   where campaign_key = (select response#>>'{campaign,campaignKey}' from d4_results where result_name = 'create-apply')
     and lifecycle = 'draft' and aggregate_version = 1),
  'exactly one draft campaign row was created'
);
select ok(
  (select count(*) = 1 from outbox.events
   where payload->>'change_kind' = 'CAMPAIGN_CREATED'
     and aggregate_type = 'targets.interview_campaign'),
  'creation emits exactly one validated CAMPAIGN_CREATED event'
);
select ok(
  (select count(*) = 0 from outbox.deliveries as delivery
   join outbox.events as event on event.event_id = delivery.event_id
   where event.payload->>'change_kind' = 'CAMPAIGN_CREATED'),
  'D4 adds no Planning input: creation schedules no delivery'
);
set local role authenticated;

-- ---------------------------------------------------------------------------------------------
-- Deadline change
-- ---------------------------------------------------------------------------------------------

select throws_ok(
  pg_catalog.format(
    $$select api.preview_interview_campaign_deadline_change_v1(
      %L, '9', %L, 'Pushed back.'
    )$$,
    (select response#>>'{campaign,campaignKey}' from d4_results where result_name = 'create-apply'),
    (current_date + 45)::date
  ),
  '40001', 'Interview Campaign version is stale',
  'deadline preview refuses a stale expected campaign version'
);
select throws_ok(
  pg_catalog.format(
    $$select api.preview_interview_campaign_deadline_change_v1(
      %L, %L, %L, 'Pushed back.'
    )$$,
    (select response#>>'{campaign,campaignKey}' from d4_results where result_name = 'create-apply'),
    (select response#>>'{campaign,aggregateVersion}' from d4_results where result_name = 'create-apply'),
    (current_date - 1)::date
  ),
  '22023', 'Interview Campaign deadline must not be in the past',
  'deadline preview refuses a past date on change too'
);

insert into d4_results
select 'deadline-preview', api.preview_interview_campaign_deadline_change_v1(
  (select response#>>'{campaign,campaignKey}' from d4_results where result_name = 'create-apply'),
  (select response#>>'{campaign,aggregateVersion}' from d4_results where result_name = 'create-apply'),
  (current_date + 45)::date, 'Pushed back a bit.'
);
select is(
  (select response#>>'{after,deadline,localDate}' from d4_results where result_name = 'deadline-preview'),
  (current_date + 45)::text,
  'the deadline preview reports the exact new local date'
);
select is(
  (select response#>>'{after,aggregateVersion}' from d4_results where result_name = 'deadline-preview'),
  '2',
  'the deadline preview advances the version fence by exactly one'
);

insert into d4_results
select 'deadline-apply', api.apply_interview_campaign_deadline_change_v1(
  (select response#>>'{campaign,campaignKey}' from d4_results where result_name = 'create-apply'),
  (select response#>>'{campaign,aggregateVersion}' from d4_results where result_name = 'create-apply'),
  (current_date + 45)::date,
  (select response->>'previewDigest' from d4_results where result_name = 'deadline-preview'),
  'Pushed back a bit.', '50000000-0000-4000-8000-000000000102'
);
select is(
  (select response#>>'{campaign,deadline,localDate}' from d4_results where result_name = 'deadline-apply'),
  (current_date + 45)::text,
  'the applied deadline change is stored'
);

reset role;
select ok(
  (select count(*) = 1 from targets.interview_campaigns
   where campaign_key = (select response#>>'{campaign,campaignKey}' from d4_results where result_name = 'create-apply')
     and deadline_local_date = (current_date + 45) and aggregate_version = 2),
  'the deadline change is persisted at the fenced version'
);
select ok(
  (select count(*) = 1 from outbox.events where payload->>'change_kind' = 'CAMPAIGN_DEADLINE_CHANGED'),
  'deadline change emits exactly one validated event'
);
set local role authenticated;

-- ---------------------------------------------------------------------------------------------
-- Retarget
-- ---------------------------------------------------------------------------------------------

select throws_ok(
  pg_catalog.format(
    $$select api.preview_interview_campaign_retarget_v1(
      %L, %L, 'goal:d4-first', %L, 'no-op'
    )$$,
    (select response#>>'{campaign,campaignKey}' from d4_results where result_name = 'deadline-apply'),
    (select response#>>'{campaign,aggregateVersion}' from d4_results where result_name = 'deadline-apply'),
    (select response#>>'{aggregateVersion}' from d4_results where result_name = 'goal-first')
  ),
  '22023', 'Interview Campaign retarget must select a different Readiness Goal',
  'retarget preview refuses repointing to the exact same Readiness Goal'
);

insert into d4_results
select 'retarget-preview', api.preview_interview_campaign_retarget_v1(
  (select response#>>'{campaign,campaignKey}' from d4_results where result_name = 'deadline-apply'),
  (select response#>>'{campaign,aggregateVersion}' from d4_results where result_name = 'deadline-apply'),
  'goal:d4-second',
  (select response#>>'{aggregateVersion}' from d4_results where result_name = 'goal-second'),
  'Switching companies.'
);
select is(
  (select response#>>'{after,readinessGoal,readinessGoalKey}' from d4_results where result_name = 'retarget-preview'),
  'goal:d4-second',
  'the retarget preview reports the new target goal'
);
select is(
  (select response#>>'{before,readinessGoal,readinessGoalKey}' from d4_results where result_name = 'retarget-preview'),
  'goal:d4-first',
  'the retarget preview reports the exact previous target goal'
);
select is(
  (select response#>>'{after,revisionNumber}' from d4_results where result_name = 'retarget-preview'),
  '1',
  'the first retarget is revision number one'
);

insert into d4_results
select 'retarget-apply', api.apply_interview_campaign_retarget_v1(
  (select response#>>'{campaign,campaignKey}' from d4_results where result_name = 'deadline-apply'),
  (select response#>>'{campaign,aggregateVersion}' from d4_results where result_name = 'deadline-apply'),
  'goal:d4-second',
  (select response#>>'{aggregateVersion}' from d4_results where result_name = 'goal-second'),
  (select response->>'previewDigest' from d4_results where result_name = 'retarget-preview'),
  'Switching companies.', '50000000-0000-4000-8000-000000000103'
);
select is(
  (select response#>>'{campaign,readinessGoal,readinessGoalKey}' from d4_results where result_name = 'retarget-apply'),
  'goal:d4-second',
  'the applied retarget repoints the campaign'
);

reset role;
select ok(
  (select count(*) = 1 from targets.interview_campaigns as campaign
   join targets.readiness_goals as goal on goal.readiness_goal_id = campaign.readiness_goal_id
   where campaign.campaign_key = (select response#>>'{campaign,campaignKey}' from d4_results where result_name = 'create-apply')
     and goal.readiness_goal_key = 'goal:d4-second' and campaign.aggregate_version = 3),
  'the retarget is persisted and both goals remain intact'
);
select ok(
  (select count(*) = 1 from targets.interview_campaign_target_revisions as revision
   join targets.readiness_goals as previous on previous.readiness_goal_id = revision.previous_readiness_goal_id
   join targets.readiness_goals as new_goal on new_goal.readiness_goal_id = revision.new_readiness_goal_id
   where revision.revision_number = 1 and previous.readiness_goal_key = 'goal:d4-first'
     and new_goal.readiness_goal_key = 'goal:d4-second' and revision.campaign_version_after = 3),
  'the append-only revision history records the previous and new goal identity'
);
select ok(
  (select count(*) = 1 from targets.readiness_goals where readiness_goal_key = 'goal:d4-first'),
  'the previous readiness goal is retained, not mutated or deleted'
);
select ok(
  (select count(*) = 1 from outbox.events where payload->>'change_kind' = 'CAMPAIGN_RETARGETED'),
  'retarget emits exactly one validated event'
);
set local role authenticated;

-- ---------------------------------------------------------------------------------------------
-- Lifecycle: start / end
-- ---------------------------------------------------------------------------------------------

select throws_ok(
  pg_catalog.format(
    $$select api.preview_interview_campaign_lifecycle_v1(%L, 'end_campaign', %L, 'too soon')$$,
    (select response#>>'{campaign,campaignKey}' from d4_results where result_name = 'retarget-apply'),
    (select response#>>'{campaign,aggregateVersion}' from d4_results where result_name = 'retarget-apply')
  ),
  '22023', 'Interview Campaign lifecycle transition is invalid',
  'ending a draft campaign before it starts is refused'
);

insert into d4_results
select 'start-preview', api.preview_interview_campaign_lifecycle_v1(
  (select response#>>'{campaign,campaignKey}' from d4_results where result_name = 'retarget-apply'),
  'start_campaign',
  (select response#>>'{campaign,aggregateVersion}' from d4_results where result_name = 'retarget-apply'),
  'Beginning active prep.'
);
select is(
  (select response#>>'{after,lifecycle}' from d4_results where result_name = 'start-preview'),
  'ACTIVE',
  'starting a draft campaign previews an active result'
);

insert into d4_results
select 'start-apply', api.apply_interview_campaign_lifecycle_v1(
  (select response#>>'{campaign,campaignKey}' from d4_results where result_name = 'retarget-apply'),
  'start_campaign',
  (select response#>>'{campaign,aggregateVersion}' from d4_results where result_name = 'retarget-apply'),
  (select response->>'previewDigest' from d4_results where result_name = 'start-preview'),
  'Beginning active prep.', '50000000-0000-4000-8000-000000000104'
);
select is(
  (select response#>>'{campaign,lifecycle}' from d4_results where result_name = 'start-apply'),
  'ACTIVE',
  'the applied start transitions the campaign to active'
);

select throws_ok(
  pg_catalog.format(
    $$select api.preview_interview_campaign_lifecycle_v1(%L, 'start_campaign', %L, 'already active')$$,
    (select response#>>'{campaign,campaignKey}' from d4_results where result_name = 'start-apply'),
    (select response#>>'{campaign,aggregateVersion}' from d4_results where result_name = 'start-apply')
  ),
  '22023', 'Interview Campaign lifecycle transition is invalid',
  'starting an already-active campaign is refused'
);

insert into d4_results
select 'end-preview', api.preview_interview_campaign_lifecycle_v1(
  (select response#>>'{campaign,campaignKey}' from d4_results where result_name = 'start-apply'),
  'end_campaign',
  (select response#>>'{campaign,aggregateVersion}' from d4_results where result_name = 'start-apply'),
  'Interview complete.'
);
insert into d4_results
select 'end-apply', api.apply_interview_campaign_lifecycle_v1(
  (select response#>>'{campaign,campaignKey}' from d4_results where result_name = 'start-apply'),
  'end_campaign',
  (select response#>>'{campaign,aggregateVersion}' from d4_results where result_name = 'start-apply'),
  (select response->>'previewDigest' from d4_results where result_name = 'end-preview'),
  'Interview complete.', '50000000-0000-4000-8000-000000000105'
);
select is(
  (select response#>>'{campaign,lifecycle}' from d4_results where result_name = 'end-apply'),
  'ENDED',
  'the applied end transitions the campaign to ended'
);

select throws_ok(
  pg_catalog.format(
    $$select api.preview_interview_campaign_deadline_change_v1(%L, %L, %L, 'too late')$$,
    (select response#>>'{campaign,campaignKey}' from d4_results where result_name = 'end-apply'),
    (select response#>>'{campaign,aggregateVersion}' from d4_results where result_name = 'end-apply'),
    (current_date + 60)::date
  ),
  '22023', 'Interview Campaign deadline can only change while draft or active',
  'an ended campaign refuses a deadline change'
);
select throws_ok(
  pg_catalog.format(
    $$select api.preview_interview_campaign_lifecycle_v1(%L, 'cancel_campaign', %L, 'too late')$$,
    (select response#>>'{campaign,campaignKey}' from d4_results where result_name = 'end-apply'),
    (select response#>>'{campaign,aggregateVersion}' from d4_results where result_name = 'end-apply')
  ),
  '22023', 'Interview Campaign lifecycle transition is invalid',
  'an ended campaign cannot be cancelled'
);

reset role;
select is(
  (select count(*) from targets.interview_campaigns
   where campaign_key = (select response#>>'{campaign,campaignKey}' from d4_results where result_name = 'end-apply')
     and lifecycle = 'ended'),
  1::bigint,
  'exactly one campaign row exists in the terminal ended lifecycle'
);
set local role authenticated;

-- ---------------------------------------------------------------------------------------------
-- Cancel path on a second, independent campaign
-- ---------------------------------------------------------------------------------------------

insert into d4_results
select 'cancel-create-preview', api.preview_interview_campaign_creation_v1(
  'goal:d4-second',
  (select response#>>'{aggregateVersion}' from d4_results where result_name = 'goal-second'),
  'Prep for Beta interview', (current_date + 20)::date, 'Second campaign.',
  '50000000-0000-4000-8000-000000000201'
);
insert into d4_results
select 'cancel-create-apply', api.apply_interview_campaign_creation_v1(
  'goal:d4-second',
  (select response#>>'{aggregateVersion}' from d4_results where result_name = 'goal-second'),
  'Prep for Beta interview', (current_date + 20)::date, 'Second campaign.',
  '50000000-0000-4000-8000-000000000201',
  (select response->>'previewDigest' from d4_results where result_name = 'cancel-create-preview')
);
insert into d4_results
select 'cancel-preview', api.preview_interview_campaign_lifecycle_v1(
  (select response#>>'{campaign,campaignKey}' from d4_results where result_name = 'cancel-create-apply'),
  'cancel_campaign',
  (select response#>>'{campaign,aggregateVersion}' from d4_results where result_name = 'cancel-create-apply'),
  'Changed my mind.'
);
select is(
  (select response#>>'{after,lifecycle}' from d4_results where result_name = 'cancel-preview'),
  'CANCELLED',
  'cancelling a draft campaign previews a cancelled result'
);
insert into d4_results
select 'cancel-apply', api.apply_interview_campaign_lifecycle_v1(
  (select response#>>'{campaign,campaignKey}' from d4_results where result_name = 'cancel-create-apply'),
  'cancel_campaign',
  (select response#>>'{campaign,aggregateVersion}' from d4_results where result_name = 'cancel-create-apply'),
  (select response->>'previewDigest' from d4_results where result_name = 'cancel-preview'),
  'Changed my mind.', '50000000-0000-4000-8000-000000000202'
);
select is(
  (select response#>>'{campaign,lifecycle}' from d4_results where result_name = 'cancel-apply'),
  'CANCELLED',
  'a draft campaign can be cancelled directly'
);

-- ---------------------------------------------------------------------------------------------
-- Read boundary: capabilities and computed deadline fields
-- ---------------------------------------------------------------------------------------------

insert into d4_results values ('list-final', api.get_interview_campaigns_v1());
select is(
  (select pg_catalog.jsonb_array_length(response->'campaigns') from d4_results where result_name = 'list-final'),
  2,
  'the workspace lists exactly its two lifetime campaigns'
);
select is(
  (
    select campaign->>'capabilities'
    from d4_results, pg_catalog.jsonb_array_elements(response->'campaigns') as campaign
    where result_name = 'list-final' and campaign->>'lifecycle' = 'ENDED'
  ),
  '[]',
  'an ended campaign exposes no further capability'
);
select is(
  (
    select campaign#>>'{capabilities,0}'
    from d4_results, pg_catalog.jsonb_array_elements(response->'campaigns') as campaign
    where result_name = 'list-final' and campaign->>'lifecycle' = 'CANCELLED'
  ),
  null,
  'a cancelled campaign exposes no further capability'
);
select is(
  (
    select campaign#>>'{deadline,daysUntil}'
    from d4_results, pg_catalog.jsonb_array_elements(response->'campaigns') as campaign
    where result_name = 'list-final' and campaign->>'lifecycle' = 'CANCELLED'
  )::int,
  20,
  'the days-until-deadline field is computed against the current instant'
);
select is(
  (
    select campaign#>>'{deadline,passed}'
    from d4_results, pg_catalog.jsonb_array_elements(response->'campaigns') as campaign
    where result_name = 'list-final' and campaign->>'lifecycle' = 'CANCELLED'
  ),
  'false',
  'a future deadline is reported as not yet passed'
);

-- ---------------------------------------------------------------------------------------------
-- Trigger immutability guard
-- ---------------------------------------------------------------------------------------------

reset role;
select throws_ok(
  pg_catalog.format(
    'update targets.interview_campaigns set workspace_id = %L where campaign_key = %L',
    'a0000000-0000-4000-8000-000000000099',
    (select response#>>'{campaign,campaignKey}' from d4_results where result_name = 'create-apply')
  ),
  '55000', 'interview campaign workspace and key are immutable',
  'the campaign workspace cannot be changed by direct update'
);
select throws_ok(
  pg_catalog.format(
    'update targets.interview_campaigns set campaign_key = %L where campaign_key = %L',
    'campaign:a0000000-0000-4000-8000-000000000099',
    (select response#>>'{campaign,campaignKey}' from d4_results where result_name = 'create-apply')
  ),
  '55000', 'interview campaign workspace and key are immutable',
  'the campaign key cannot be changed by direct update'
);
set local role authenticated;

-- ---------------------------------------------------------------------------------------------
-- Cross-workspace isolation
-- ---------------------------------------------------------------------------------------------

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '50000000-0000-4000-8000-000000000002',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from pg_catalog.clock_timestamp() + interval '1 hour')::bigint
  )::text,
  true
);
set local role authenticated;
insert into d4_results values (
  'bob-bootstrap', api.bootstrap_personal_workspace('d4-bob', 'D4 Bob')
);
insert into d4_results values ('bob-list', api.get_interview_campaigns_v1());
select is(
  (select response->'campaigns' from d4_results where result_name = 'bob-list'),
  '[]'::jsonb,
  'a second workspace sees no campaign from the first workspace'
);
select throws_ok(
  pg_catalog.format(
    $$select api.preview_interview_campaign_lifecycle_v1(%L, 'start_campaign', %L, 'cross workspace')$$,
    (select response#>>'{campaign,campaignKey}' from d4_results where result_name = 'cancel-create-apply'),
    '1'
  ),
  '42501', 'Interview Campaign is not accessible',
  'a second workspace cannot preview a lifecycle change on the first workspace campaign'
);
select throws_ok(
  pg_catalog.format(
    $$select api.apply_interview_campaign_lifecycle_v1(
      %L, 'start_campaign', '1', %L, 'cross workspace', '50000000-0000-4000-8000-000000000301'
    )$$,
    (select response#>>'{campaign,campaignKey}' from d4_results where result_name = 'cancel-create-apply'),
    pg_catalog.repeat('0', 64)
  ),
  '42501', 'Interview Campaign is not accessible',
  'a second workspace cannot apply a lifecycle change on the first workspace campaign'
);

reset role;
select ok(
  (select count(*) = 2 from targets.interview_campaigns
   where workspace_id = (select (r.response->>'workspace_id')::uuid from d4_results as r where r.result_name = 'bootstrap'))
  and (select count(*) = 0 from targets.interview_campaigns
       where workspace_id = (select (r.response->>'workspace_id')::uuid from d4_results as r where r.result_name = 'bob-bootstrap')),
  'the cross-workspace attempts changed nothing and created no campaign in either workspace'
);
set local role authenticated;

select finish();
rollback;
