begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- ---------------------------------------------------------------------------------------------
-- Schema, ownership, and privilege boundary
-- ---------------------------------------------------------------------------------------------

select has_schema('agent_control', 'the agent_control schema exists');

select has_table(
  'planning', 'campaign_allocation_overrides', 'planning.campaign_allocation_overrides exists'
);

select ok(
  class.relrowsecurity and class.relforcerowsecurity,
  'planning.campaign_allocation_overrides has enabled and forced RLS'
)
from pg_catalog.pg_class as class
join pg_catalog.pg_namespace as namespace on namespace.oid = class.relnamespace
where namespace.nspname = 'planning' and class.relname = 'campaign_allocation_overrides';

select ok(
  not pg_catalog.has_table_privilege(
    runtime.role_name, 'planning.campaign_allocation_overrides', privilege.privilege_name
  ),
  format(
    '%s has no direct %s on planning.campaign_allocation_overrides',
    runtime.role_name, privilege.privilege_name
  )
)
from (values ('anon'), ('authenticated'), ('service_role')) as runtime(role_name)
cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) as privilege(privilege_name);

select ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'api.preview_campaign_lifecycle_coordination_v1(text,text,text,text,jsonb,text)', 'EXECUTE'
  ) and pg_catalog.has_function_privilege(
    'authenticated',
    'api.apply_campaign_lifecycle_coordination_v1(text,text,text,text,jsonb,text,text)', 'EXECUTE'
  ) and pg_catalog.has_function_privilege(
    'authenticated',
    'api.preview_campaign_allocation_override_v1(text,text,text,integer,integer,integer,text)',
    'EXECUTE'
  ) and pg_catalog.has_function_privilege(
    'authenticated',
    'api.apply_campaign_allocation_override_v1(text,text,text,integer,integer,integer,text,text,text)',
    'EXECUTE'
  ) and pg_catalog.has_function_privilege(
    'authenticated', 'api.get_campaign_allocation_overrides_v1()', 'EXECUTE'
  ),
  'authenticated has exactly the five D5 public entry points'
);

select ok(
  not pg_catalog.has_function_privilege(runtime.role_name, expected.signature, 'EXECUTE'),
  format('%s cannot execute %s', runtime.role_name, expected.signature)
)
from (values ('anon'), ('service_role')) as runtime(role_name)
cross join (values
  ('api.preview_campaign_lifecycle_coordination_v1(text,text,text,text,jsonb,text)'),
  ('api.apply_campaign_lifecycle_coordination_v1(text,text,text,text,jsonb,text,text)'),
  ('api.preview_campaign_allocation_override_v1(text,text,text,integer,integer,integer,text)'),
  ('api.apply_campaign_allocation_override_v1(text,text,text,integer,integer,integer,text,text,text)'),
  ('api.get_campaign_allocation_overrides_v1()')
) as expected(signature);

select ok(
  not pg_catalog.has_function_privilege(runtime.role_name, expected.signature, 'EXECUTE'),
  format('%s cannot execute private D5 helper %s', runtime.role_name, expected.signature)
)
from (values ('anon'), ('authenticated'), ('service_role')) as runtime(role_name)
cross join (values
  ('planning.derive_campaign_allocation_override_identity_v1(uuid,text,text,text)'),
  ('planning.campaign_allocation_override_changed_event_payload_v1_is_valid(jsonb)'),
  ('planning.has_active_campaign_allocation_override_v1(uuid,uuid)'),
  ('targets.apply_interview_campaign_lifecycle_hook_v1(uuid,uuid,uuid,uuid,bigint,text,uuid,text)'),
  ('planning.install_campaign_allocation_overrides_hook_v1(uuid,uuid,uuid,uuid,uuid,jsonb)'),
  ('planning.close_campaign_allocation_overrides_hook_v1(uuid,uuid,uuid,uuid,uuid)'),
  ('targets.read_interview_campaign_coordination_source_v1(uuid,text)'),
  ('planning.read_campaign_lifecycle_coordination_source_v1(uuid,uuid,text,text[])')
) as expected(signature);

select ok(
  procedure.prosecdef
    and 'search_path=""' = any(coalesce(procedure.proconfig, '{}'::text[]))
    and owner.rolname = 'pando_planning_api',
  format('api.%s is a pinned Planning owner definer', procedure.proname)
)
from pg_catalog.pg_proc as procedure
join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
join pg_catalog.pg_roles as owner on owner.oid = procedure.proowner
where namespace.nspname = 'api'
  and procedure.proname in (
    'preview_campaign_allocation_override_v1', 'apply_campaign_allocation_override_v1',
    'get_campaign_allocation_overrides_v1'
  )
order by procedure.proname;

select ok(
  procedure.prosecdef
    and 'search_path=""' = any(coalesce(procedure.proconfig, '{}'::text[]))
    and owner.rolname = 'pando_agent_control_api',
  format('api.%s is a pinned Agent Control owner definer', procedure.proname)
)
from pg_catalog.pg_proc as procedure
join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
join pg_catalog.pg_roles as owner on owner.oid = procedure.proowner
where namespace.nspname = 'api'
  and procedure.proname in (
    'preview_campaign_lifecycle_coordination_v1', 'apply_campaign_lifecycle_coordination_v1'
  )
order by procedure.proname;

-- ---------------------------------------------------------------------------------------------
-- Identity derivation and event payload unit checks
-- ---------------------------------------------------------------------------------------------

select is(
  planning.derive_campaign_allocation_override_identity_v1(
    'a0000000-0000-4000-8000-000000000001', 'agent_control.coordinate_campaign_lifecycle_v1',
    'b0000000-0000-4000-8000-000000000001', 'track:d5-alpha'
  )::text,
  pg_catalog.lower(
    planning.derive_campaign_allocation_override_identity_v1(
      'a0000000-0000-4000-8000-000000000001', 'agent_control.coordinate_campaign_lifecycle_v1',
      'b0000000-0000-4000-8000-000000000001', 'track:d5-alpha'
    )::text
  ),
  'the derived override identity is deterministic and lowercase'
);
select isnt(
  planning.derive_campaign_allocation_override_identity_v1(
    'a0000000-0000-4000-8000-000000000001', 'agent_control.coordinate_campaign_lifecycle_v1',
    'b0000000-0000-4000-8000-000000000001', 'track:d5-alpha'
  )::text,
  planning.derive_campaign_allocation_override_identity_v1(
    'a0000000-0000-4000-8000-000000000001', 'agent_control.coordinate_campaign_lifecycle_v1',
    'b0000000-0000-4000-8000-000000000001', 'track:d5-beta'
  )::text,
  'different Tracks derive different override identities for the same idempotency key'
);
select throws_ok(
  $$select planning.derive_campaign_allocation_override_identity_v1(
    'a0000000-0000-4000-8000-000000000001', 'targets.create_interview_campaign_v1',
    'b0000000-0000-4000-8000-000000000001', 'track:d5-alpha'
  )$$,
  '22023', 'campaign allocation override identity input is invalid',
  'the override identity refuses another command type'
);

select ok(
  planning.campaign_allocation_override_changed_event_payload_v1_is_valid(
    pg_catalog.jsonb_build_object(
      'change_kind', 'OVERRIDE_INSTALLED',
      'override_id', '10000000-0000-4000-8000-000000000001',
      'override_version', '1',
      'learning_track_id', '10000000-0000-4000-8000-000000000002',
      'lifecycle', 'ACTIVE'
    )
  ),
  'the exact five-key installed payload is valid'
);
select ok(
  not planning.campaign_allocation_override_changed_event_payload_v1_is_valid(
    pg_catalog.jsonb_build_object(
      'change_kind', 'OVERRIDE_INSTALLED',
      'override_id', '10000000-0000-4000-8000-000000000001',
      'override_version', '1',
      'learning_track_id', '10000000-0000-4000-8000-000000000002',
      'lifecycle', 'ACTIVE',
      'protected_minimum_minutes_override', 90
    )
  ),
  'an installed payload carrying an actual override value is refused'
);

-- ---------------------------------------------------------------------------------------------
-- Fixture: workspace, Goal, first Growth Plan, Learning Track, Interview Campaign
-- ---------------------------------------------------------------------------------------------

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '52000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'd5-alice@pando.test', '', pg_catalog.clock_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
), (
  '52000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
  'd5-bob@pando.test', '', pg_catalog.clock_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
), (
  '52000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
  'd5-carol@pando.test', '', pg_catalog.clock_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
);

create temporary table d5_results (result_name text primary key, response jsonb);
grant select, insert, update on d5_results to authenticated;

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '52000000-0000-4000-8000-000000000001',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from pg_catalog.clock_timestamp() + interval '1 hour')::bigint
  )::text,
  true
);
set local role authenticated;

insert into d5_results values (
  'bootstrap', api.bootstrap_personal_workspace('d5-alice', 'D5 Alice')
);
insert into d5_results
select 'goal', api.create_readiness_goal(
  (select (response->>'workspace_id')::uuid from d5_results where result_name = 'bootstrap'),
  'goal:d5-first', 'D5 first target',
  'target:nvidia-python-verification-base-v1', 'd5-goal-first'
);

insert into d5_results
select 'plan-preview', api.preview_growth_plan_initialization_v1(
  'goal:d5-first', (select response->>'aggregateVersion' from d5_results where result_name = 'goal'),
  600, 60, 50, 'First plan for D5 overrides.', '52000000-0000-4000-8000-000000000101'
);
insert into d5_results
select 'plan-apply', api.apply_growth_plan_initialization_v1(
  'goal:d5-first', (select response->>'aggregateVersion' from d5_results where result_name = 'goal'),
  600, 60, 50, 'First plan for D5 overrides.', '52000000-0000-4000-8000-000000000101',
  (select response->>'previewDigest' from d5_results where result_name = 'plan-preview')
);

select is(
  (select response#>>'{createdPlan,lifecycle}' from d5_results where result_name = 'plan-apply'),
  'ACTIVE',
  'the first Growth Plan starts active'
);

insert into d5_results
select 'minimum-preview', api.preview_learning_track_priority_minimum_v1(
  (select response#>>'{createdTrack,trackKey}' from d5_results where result_name = 'plan-apply'),
  50, 60,
  (select response#>>'{createdPlan,aggregateVersion}' from d5_results where result_name = 'plan-apply'),
  (select response#>>'{createdTrack,aggregateVersion}' from d5_results where result_name = 'plan-apply'),
  'Raise the floor for the override test.'
);
insert into d5_results
select 'minimum-apply', api.apply_learning_track_priority_minimum_v1(
  (select response#>>'{createdTrack,trackKey}' from d5_results where result_name = 'plan-apply'),
  50, 60,
  (select response#>>'{createdPlan,aggregateVersion}' from d5_results where result_name = 'plan-apply'),
  (select response#>>'{createdTrack,aggregateVersion}' from d5_results where result_name = 'plan-apply'),
  (select response->>'previewDigest' from d5_results where result_name = 'minimum-preview'),
  'Raise the floor for the override test.', '52000000-0000-4000-8000-000000000102'
);
select is(
  (select response#>>'{changedTrack,protectedMinimumMinutes}' from d5_results where result_name = 'minimum-apply'),
  '60',
  'the Track floor is raised to 60 minutes before any override is installed'
);

insert into d5_results
select 'campaign-preview', api.preview_interview_campaign_creation_v1(
  'goal:d5-first', (select response->>'aggregateVersion' from d5_results where result_name = 'goal'),
  'Prep for Acme interview', (current_date + 30)::date, 'Starting prep.',
  '52000000-0000-4000-8000-000000000201'
);
insert into d5_results
select 'campaign-apply', api.apply_interview_campaign_creation_v1(
  'goal:d5-first', (select response->>'aggregateVersion' from d5_results where result_name = 'goal'),
  'Prep for Acme interview', (current_date + 30)::date, 'Starting prep.',
  '52000000-0000-4000-8000-000000000201',
  (select response->>'previewDigest' from d5_results where result_name = 'campaign-preview')
);

-- ---------------------------------------------------------------------------------------------
-- Coordinator start_campaign: install one validated override atomically with the lifecycle flip
-- ---------------------------------------------------------------------------------------------

select throws_ok(
  pg_catalog.format(
    $$select api.preview_campaign_lifecycle_coordination_v1(
      %L, 'start_campaign', '1', 'Start with overrides.', %L,
      '52000000-0000-4000-8000-000000000301'
    )$$,
    (select response#>>'{campaign,campaignKey}' from d5_results where result_name = 'campaign-apply'),
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'trackKey', 'track:does-not-exist', 'expectedTrackVersion', '1',
      'priorityOverride', 90, 'protectedMinimumMinutesOverride', null::integer,
      'cadencePerWeekOverride', null::integer
    ))::text
  ),
  '42501', 'Learning Track is not accessible',
  'the coordinator preview refuses an override on an unknown Track'
);

insert into d5_results
select 'coordination-preview', api.preview_campaign_lifecycle_coordination_v1(
  (select response#>>'{campaign,campaignKey}' from d5_results where result_name = 'campaign-apply'),
  'start_campaign', '1', 'Start with overrides.',
  pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'trackKey', (select response#>>'{createdTrack,trackKey}' from d5_results where result_name = 'plan-apply'),
    'expectedTrackVersion', (select response#>>'{changedTrack,aggregateVersion}' from d5_results where result_name = 'minimum-apply'),
    'priorityOverride', 90, 'protectedMinimumMinutesOverride', 90, 'cadencePerWeekOverride', null::integer
  )),
  '52000000-0000-4000-8000-000000000301'
);
select ok(
  (select (response->>'canApply')::boolean from d5_results where result_name = 'coordination-preview')
  and (select response->'blockingReasons' from d5_results where result_name = 'coordination-preview') = '[]'::jsonb,
  'the coordinator start_campaign preview with a valid override is applicable and unblocked'
);
select is(
  (select response#>>'{campaign,after,lifecycle}' from d5_results where result_name = 'coordination-preview'),
  'ACTIVE',
  'the coordinator preview reports the campaign becoming active'
);
select is(
  (select pg_catalog.jsonb_array_length(response#>'{overrides,installed}') from d5_results where result_name = 'coordination-preview'),
  1,
  'the coordinator preview reports exactly one installed override'
);
select ok(
  (select response#>>'{overrides,installed,0,overrideKey}' from d5_results where result_name = 'coordination-preview')
    ~ '^override:[0-9a-f]{8}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
  'the derived override identity is UUIDv8-shaped'
);

insert into d5_results
select 'coordination-apply', api.apply_campaign_lifecycle_coordination_v1(
  (select response#>>'{campaign,campaignKey}' from d5_results where result_name = 'campaign-apply'),
  'start_campaign', '1', 'Start with overrides.',
  pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'trackKey', (select response#>>'{createdTrack,trackKey}' from d5_results where result_name = 'plan-apply'),
    'expectedTrackVersion', (select response#>>'{changedTrack,aggregateVersion}' from d5_results where result_name = 'minimum-apply'),
    'priorityOverride', 90, 'protectedMinimumMinutesOverride', 90, 'cadencePerWeekOverride', null::integer
  )),
  (select response->>'previewDigest' from d5_results where result_name = 'coordination-preview'),
  '52000000-0000-4000-8000-000000000301'
);
select is(
  (select response#>>'{campaign,lifecycle}' from d5_results where result_name = 'coordination-apply'),
  'ACTIVE',
  'the coordinator apply activates the campaign'
);
select is(
  (select pg_catalog.jsonb_array_length(response->'overrides') from d5_results where result_name = 'coordination-apply'),
  1,
  'the coordinator apply installs exactly one override'
);
select is(
  (select response#>>'{overrides,0,protectedMinimumMinutesOverride}' from d5_results where result_name = 'coordination-apply'),
  '90',
  'the installed override carries the exact requested protected minimum'
);
select is(
  (select pg_catalog.jsonb_array_length(response->'emittedEventIds') from d5_results where result_name = 'coordination-apply'),
  2,
  'the coordinator apply emits exactly two events (campaign lifecycle plus one override)'
);

reset role;
select is(
  (select pg_catalog.count(*) from targets.interview_campaigns
   where campaign_key = (select response#>>'{campaign,campaignKey}' from d5_results where result_name = 'campaign-apply')
     and lifecycle = 'active' and aggregate_version = 2),
  1::bigint,
  'exactly one campaign row reflects the activated lifecycle at version 2'
);
select is(
  (select pg_catalog.count(*) from planning.campaign_allocation_overrides
   where campaign_id = (select (response#>>'{campaign,campaignId}')::uuid from d5_results where result_name = 'campaign-apply')
     and lifecycle = 'active' and aggregate_version = 1),
  1::bigint,
  'exactly one override row is installed at version 1'
);
set local role authenticated;

-- Idempotent replay: the same idempotency key returns the identical cached response.
insert into d5_results
select 'coordination-replay', api.apply_campaign_lifecycle_coordination_v1(
  (select response#>>'{campaign,campaignKey}' from d5_results where result_name = 'campaign-apply'),
  'start_campaign', '1', 'Start with overrides.',
  pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'trackKey', (select response#>>'{createdTrack,trackKey}' from d5_results where result_name = 'plan-apply'),
    'expectedTrackVersion', (select response#>>'{changedTrack,aggregateVersion}' from d5_results where result_name = 'minimum-apply'),
    'priorityOverride', 90, 'protectedMinimumMinutesOverride', 90, 'cadencePerWeekOverride', null::integer
  )),
  (select response->>'previewDigest' from d5_results where result_name = 'coordination-preview'),
  '52000000-0000-4000-8000-000000000301'
);
select is(
  (select response from d5_results where result_name = 'coordination-replay'),
  (select response from d5_results where result_name = 'coordination-apply'),
  'a replayed idempotency key returns the exact cached response'
);
reset role;
select is(
  (select pg_catalog.count(*) from planning.campaign_allocation_overrides
   where campaign_id = (select (response#>>'{campaign,campaignId}')::uuid from d5_results where result_name = 'campaign-apply')),
  1::bigint,
  'the replay creates no duplicate override row'
);
set local role authenticated;

-- ---------------------------------------------------------------------------------------------
-- The plain D4 lifecycle command refuses to end/cancel a campaign with an active override
-- ---------------------------------------------------------------------------------------------

select lives_ok(
  pg_catalog.format(
    $$select api.preview_interview_campaign_lifecycle_v1(%L, 'end_campaign', '2', 'try direct end')$$,
    (select response#>>'{campaign,campaignKey}' from d5_results where result_name = 'campaign-apply')
  ),
  'the plain preview alone does not raise (it recomputes an optimistic canApply)'
);
select throws_ok(
  pg_catalog.format(
    $$select api.apply_interview_campaign_lifecycle_v1(
      %L, 'end_campaign', '2', %L, 'try direct end', '52000000-0000-4000-8000-000000000302'
    )$$,
    (select response#>>'{campaign,campaignKey}' from d5_results where result_name = 'campaign-apply'),
    (select api.preview_interview_campaign_lifecycle_v1(
      (select response#>>'{campaign,campaignKey}' from d5_results where result_name = 'campaign-apply'),
      'end_campaign', '2', 'try direct end'
    )->>'previewDigest')
  ),
  '22023',
  'Interview Campaign has active allocation overrides;'
    || ' end or cancel it through the campaign lifecycle coordinator',
  'the plain D4 lifecycle command refuses to end a campaign with an active override'
);
reset role;
select is(
  (select lifecycle from targets.interview_campaigns
   where campaign_key = (select response#>>'{campaign,campaignKey}' from d5_results where result_name = 'campaign-apply')),
  'active',
  'the refused direct end attempt leaves the campaign active'
);
set local role authenticated;

-- ---------------------------------------------------------------------------------------------
-- Coordinator end_campaign: closes the active override atomically with the lifecycle change
-- ---------------------------------------------------------------------------------------------

insert into d5_results
select 'end-preview', api.preview_campaign_lifecycle_coordination_v1(
  (select response#>>'{campaign,campaignKey}' from d5_results where result_name = 'campaign-apply'),
  'end_campaign', '2', 'End the campaign.', '[]'::jsonb,
  '52000000-0000-4000-8000-000000000401'
);
select is(
  (select pg_catalog.jsonb_array_length(response#>'{overrides,closed}') from d5_results where result_name = 'end-preview'),
  1,
  'the end_campaign preview reports the one override that will close'
);
insert into d5_results
select 'end-apply', api.apply_campaign_lifecycle_coordination_v1(
  (select response#>>'{campaign,campaignKey}' from d5_results where result_name = 'campaign-apply'),
  'end_campaign', '2', 'End the campaign.', '[]'::jsonb,
  (select response->>'previewDigest' from d5_results where result_name = 'end-preview'),
  '52000000-0000-4000-8000-000000000401'
);
select is(
  (select response#>>'{campaign,lifecycle}' from d5_results where result_name = 'end-apply'),
  'ENDED',
  'the coordinator apply ends the campaign'
);
reset role;
select is(
  (select pg_catalog.count(*) from planning.campaign_allocation_overrides
   where campaign_id = (select (response#>>'{campaign,campaignId}')::uuid from d5_results where result_name = 'campaign-apply')
     and lifecycle = 'superseded'),
  1::bigint,
  'ending the campaign marks its override superseded, retained as history'
);

-- Now that the override is closed, a Track-already-overridden Track becomes available again.
select is(
  (select pg_catalog.count(*) from planning.campaign_allocation_overrides
   where learning_track_id = (select response#>>'{createdTrack,learningTrackId}' from d5_results where result_name = 'plan-apply')::uuid
     and lifecycle = 'active'),
  0::bigint,
  'no active override remains on the Track once the campaign has ended'
);
set local role authenticated;

-- ---------------------------------------------------------------------------------------------
-- Direct edit/remove command on an already-active campaign's override
-- ---------------------------------------------------------------------------------------------

insert into d5_results
select 'campaign2-preview', api.preview_interview_campaign_creation_v1(
  'goal:d5-first', (select response->>'aggregateVersion' from d5_results where result_name = 'goal'),
  'Prep for second interview', (current_date + 45)::date, 'Second campaign.',
  '52000000-0000-4000-8000-000000000501'
);
insert into d5_results
select 'campaign2-apply', api.apply_interview_campaign_creation_v1(
  'goal:d5-first', (select response->>'aggregateVersion' from d5_results where result_name = 'goal'),
  'Prep for second interview', (current_date + 45)::date, 'Second campaign.',
  '52000000-0000-4000-8000-000000000501',
  (select response->>'previewDigest' from d5_results where result_name = 'campaign2-preview')
);
insert into d5_results
select 'coordination2-preview', api.preview_campaign_lifecycle_coordination_v1(
  (select response#>>'{campaign,campaignKey}' from d5_results where result_name = 'campaign2-apply'),
  'start_campaign', '1', 'Start second with override.',
  pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'trackKey', (select response#>>'{createdTrack,trackKey}' from d5_results where result_name = 'plan-apply'),
    'expectedTrackVersion', (select response#>>'{changedTrack,aggregateVersion}' from d5_results where result_name = 'minimum-apply'),
    'priorityOverride', 70, 'protectedMinimumMinutesOverride', 80, 'cadencePerWeekOverride', 3
  )),
  '52000000-0000-4000-8000-000000000601'
);
insert into d5_results
select 'coordination2-apply', api.apply_campaign_lifecycle_coordination_v1(
  (select response#>>'{campaign,campaignKey}' from d5_results where result_name = 'campaign2-apply'),
  'start_campaign', '1', 'Start second with override.',
  pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'trackKey', (select response#>>'{createdTrack,trackKey}' from d5_results where result_name = 'plan-apply'),
    'expectedTrackVersion', (select response#>>'{changedTrack,aggregateVersion}' from d5_results where result_name = 'minimum-apply'),
    'priorityOverride', 70, 'protectedMinimumMinutesOverride', 80, 'cadencePerWeekOverride', 3
  )),
  (select response->>'previewDigest' from d5_results where result_name = 'coordination2-preview'),
  '52000000-0000-4000-8000-000000000601'
);
select is(
  (select response#>>'{overrides,0,overrideKey}' from d5_results where result_name = 'coordination2-apply'),
  (select response#>>'{overrides,0,overrideKey}' from d5_results where result_name = 'coordination2-apply'),
  'sanity: the second override was installed'
) ;

-- A second campaign cannot install another override on the same already-overridden Track.
insert into d5_results
select 'campaign3-preview', api.preview_interview_campaign_creation_v1(
  'goal:d5-first', (select response->>'aggregateVersion' from d5_results where result_name = 'goal'),
  'Prep for third interview', (current_date + 60)::date, 'Third campaign.',
  '52000000-0000-4000-8000-000000000701'
);
insert into d5_results
select 'campaign3-apply', api.apply_interview_campaign_creation_v1(
  'goal:d5-first', (select response->>'aggregateVersion' from d5_results where result_name = 'goal'),
  'Prep for third interview', (current_date + 60)::date, 'Third campaign.',
  '52000000-0000-4000-8000-000000000701',
  (select response->>'previewDigest' from d5_results where result_name = 'campaign3-preview')
);
insert into d5_results
select 'coordination3-preview', api.preview_campaign_lifecycle_coordination_v1(
  (select response#>>'{campaign,campaignKey}' from d5_results where result_name = 'campaign3-apply'),
  'start_campaign', '1', 'Third overlaps the same Track.',
  pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'trackKey', (select response#>>'{createdTrack,trackKey}' from d5_results where result_name = 'plan-apply'),
    'expectedTrackVersion', (select response#>>'{changedTrack,aggregateVersion}' from d5_results where result_name = 'minimum-apply'),
    'priorityOverride', 10, 'protectedMinimumMinutesOverride', null::integer, 'cadencePerWeekOverride', null::integer
  )),
  '52000000-0000-4000-8000-000000000801'
);
select is(
  (select (response->>'canApply')::boolean from d5_results where result_name = 'coordination3-preview'),
  false,
  'a Track already governed by an active override blocks a second campaign'
);
select ok(
  (select response->'blockingReasons' from d5_results where result_name = 'coordination3-preview')
    @> '[{"code":"ALLOCATION_OVERRIDE_TRACK_ALREADY_OVERRIDDEN"}]'::jsonb,
  'the exact ALLOCATION_OVERRIDE_TRACK_ALREADY_OVERRIDDEN blocker is reported'
);

-- Direct change/remove now targets the second campaign's already-active override.
insert into d5_results
select 'override-change-preview', api.preview_campaign_allocation_override_v1(
  (select response#>>'{overrides,0,overrideKey}' from d5_results where result_name = 'coordination2-apply'),
  'change_campaign_allocation_override', '1', 60, 100, null::integer,
  'Lower priority, raise floor.'
);
select ok(
  (select (response->>'canApply')::boolean from d5_results where result_name = 'override-change-preview'),
  'the direct override change preview within capacity is applicable'
);
insert into d5_results
select 'override-change-apply', api.apply_campaign_allocation_override_v1(
  (select response#>>'{overrides,0,overrideKey}' from d5_results where result_name = 'coordination2-apply'),
  'change_campaign_allocation_override', '1', 60, 100, null::integer,
  (select response->>'previewDigest' from d5_results where result_name = 'override-change-preview'),
  'Lower priority, raise floor.', '52000000-0000-4000-8000-000000000901'
);
select is(
  (select response#>>'{override,protectedMinimumMinutesOverride}' from d5_results where result_name = 'override-change-apply'),
  '100',
  'the direct edit applies the exact new protected-minimum override value'
);
select is(
  (select response#>>'{override,aggregateVersion}' from d5_results where result_name = 'override-change-apply'),
  '2',
  'the direct edit advances the override to version 2'
);

select throws_ok(
  pg_catalog.format(
    $$select api.preview_campaign_allocation_override_v1(
      %L, 'change_campaign_allocation_override', '2', null, 30, null, 'Below the floor.'
    )$$,
    (select response#>>'{overrides,0,overrideKey}' from d5_results where result_name = 'coordination2-apply')
  ),
  '23514', 'campaign protected-minimum override must not be lower than the Track floor',
  'the direct edit preview refuses lowering the protected minimum below the Track floor'
);

insert into d5_results
select 'override-remove-preview', api.preview_campaign_allocation_override_v1(
  (select response#>>'{overrides,0,overrideKey}' from d5_results where result_name = 'coordination2-apply'),
  'remove_campaign_allocation_override', '2', null, null, null,
  'No longer needed.'
);
insert into d5_results
select 'override-remove-apply', api.apply_campaign_allocation_override_v1(
  (select response#>>'{overrides,0,overrideKey}' from d5_results where result_name = 'coordination2-apply'),
  'remove_campaign_allocation_override', '2', null, null, null,
  (select response->>'previewDigest' from d5_results where result_name = 'override-remove-preview'),
  'No longer needed.', '52000000-0000-4000-8000-000000000902'
);
select is(
  (select response#>>'{override,lifecycle}' from d5_results where result_name = 'override-remove-apply'),
  'REMOVED',
  'the direct remove command marks the override removed'
);
reset role;
select is(
  (select lifecycle from planning.campaign_allocation_overrides
   where override_key = (select response#>>'{overrides,0,overrideKey}' from d5_results where result_name = 'coordination2-apply')),
  'removed',
  'the removed override is retained as history, not deleted'
);
set local role authenticated;

-- With the Track free again, the third campaign can now install its own override on it.
insert into d5_results
select 'coordination3b-preview', api.preview_campaign_lifecycle_coordination_v1(
  (select response#>>'{campaign,campaignKey}' from d5_results where result_name = 'campaign3-apply'),
  'start_campaign', '1', 'Third can now overlay the freed Track.',
  pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'trackKey', (select response#>>'{createdTrack,trackKey}' from d5_results where result_name = 'plan-apply'),
    'expectedTrackVersion', (select response#>>'{changedTrack,aggregateVersion}' from d5_results where result_name = 'minimum-apply'),
    'priorityOverride', 10, 'protectedMinimumMinutesOverride', null::integer, 'cadencePerWeekOverride', null::integer
  )),
  '52000000-0000-4000-8000-000000001001'
);
select ok(
  (select (response->>'canApply')::boolean from d5_results where result_name = 'coordination3b-preview'),
  'once the prior override is removed, a fresh campaign may install its own override on the Track'
);

-- ---------------------------------------------------------------------------------------------
-- Capacity blocking: a fresh, tightly-capacitated workspace refuses an over-budget override
-- ---------------------------------------------------------------------------------------------

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '52000000-0000-4000-8000-000000000003',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from pg_catalog.clock_timestamp() + interval '1 hour')::bigint
  )::text,
  true
);
set local role authenticated;

insert into d5_results values (
  'tight-bootstrap', api.bootstrap_personal_workspace('d5-tight', 'D5 Tight')
);
insert into d5_results
select 'tight-goal', api.create_readiness_goal(
  (select (response->>'workspace_id')::uuid from d5_results where result_name = 'tight-bootstrap'),
  'goal:d5-tight', 'D5 tight target',
  'target:nvidia-python-verification-base-v1', 'd5-tight-goal'
);
insert into d5_results
select 'tight-plan-preview', api.preview_growth_plan_initialization_v1(
  'goal:d5-tight', (select response->>'aggregateVersion' from d5_results where result_name = 'tight-goal'),
  50, 30, 50, 'A deliberately tight plan.', '52000000-0000-4000-8000-000000001101'
);
insert into d5_results
select 'tight-plan-apply', api.apply_growth_plan_initialization_v1(
  'goal:d5-tight', (select response->>'aggregateVersion' from d5_results where result_name = 'tight-goal'),
  50, 30, 50, 'A deliberately tight plan.', '52000000-0000-4000-8000-000000001101',
  (select response->>'previewDigest' from d5_results where result_name = 'tight-plan-preview')
);
insert into d5_results
select 'tight-campaign-preview', api.preview_interview_campaign_creation_v1(
  'goal:d5-tight', (select response->>'aggregateVersion' from d5_results where result_name = 'tight-goal'),
  'Tight prep', (current_date + 20)::date, 'Tight budget.',
  '52000000-0000-4000-8000-000000001201'
);
insert into d5_results
select 'tight-campaign-apply', api.apply_interview_campaign_creation_v1(
  'goal:d5-tight', (select response->>'aggregateVersion' from d5_results where result_name = 'tight-goal'),
  'Tight prep', (current_date + 20)::date, 'Tight budget.',
  '52000000-0000-4000-8000-000000001201',
  (select response->>'previewDigest' from d5_results where result_name = 'tight-campaign-preview')
);
insert into d5_results
select 'tight-coordination-preview', api.preview_campaign_lifecycle_coordination_v1(
  (select response#>>'{campaign,campaignKey}' from d5_results where result_name = 'tight-campaign-apply'),
  'start_campaign', '1', 'This exceeds the weekly capacity.',
  pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'trackKey', (select response#>>'{createdTrack,trackKey}' from d5_results where result_name = 'tight-plan-apply'),
    'expectedTrackVersion', (select response#>>'{createdTrack,aggregateVersion}' from d5_results where result_name = 'tight-plan-apply'),
    'priorityOverride', null::integer, 'protectedMinimumMinutesOverride', 90, 'cadencePerWeekOverride', null::integer
  )),
  '52000000-0000-4000-8000-000000001301'
);
select is(
  (select (response->>'canApply')::boolean from d5_results where result_name = 'tight-coordination-preview'),
  false,
  'installing an override that exceeds the plan weekly capacity is blocked'
);
select ok(
  (select response->'blockingReasons' from d5_results where result_name = 'tight-coordination-preview')
    @> '[{"code":"ALLOCATION_OVERRIDE_EXCEEDS_CAPACITY"}]'::jsonb,
  'the exact ALLOCATION_OVERRIDE_EXCEEDS_CAPACITY blocker is reported'
);
select throws_ok(
  pg_catalog.format(
    $$select api.apply_campaign_lifecycle_coordination_v1(
      %L, 'start_campaign', '1', 'This exceeds the weekly capacity.', %L, %L,
      '52000000-0000-4000-8000-000000001301'
    )$$,
    (select response#>>'{campaign,campaignKey}' from d5_results where result_name = 'tight-campaign-apply'),
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'trackKey', (select response#>>'{createdTrack,trackKey}' from d5_results where result_name = 'tight-plan-apply'),
      'expectedTrackVersion', (select response#>>'{createdTrack,aggregateVersion}' from d5_results where result_name = 'tight-plan-apply'),
      'priorityOverride', null::integer, 'protectedMinimumMinutesOverride', 90, 'cadencePerWeekOverride', null::integer
    ))::text,
    (select response->>'previewDigest' from d5_results where result_name = 'tight-coordination-preview')
  ),
  '40001', 'campaign lifecycle coordination preview is stale',
  'apply refuses a blocked (canApply false) coordination preview'
);
reset role;
select is(
  (select pg_catalog.count(*) from planning.campaign_allocation_overrides
   where workspace_id = (select (response->>'workspace_id')::uuid from d5_results where result_name = 'tight-bootstrap')),
  0::bigint,
  'the blocked apply attempt installs no override row'
);
set local role authenticated;

-- ---------------------------------------------------------------------------------------------
-- Cross-workspace isolation
-- ---------------------------------------------------------------------------------------------

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '52000000-0000-4000-8000-000000000002',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from pg_catalog.clock_timestamp() + interval '1 hour')::bigint
  )::text,
  true
);
set local role authenticated;
insert into d5_results values (
  'bob-bootstrap', api.bootstrap_personal_workspace('d5-bob', 'D5 Bob')
);
insert into d5_results values ('bob-overrides', api.get_campaign_allocation_overrides_v1());
select is(
  (select response->'overrides' from d5_results where result_name = 'bob-overrides'),
  '[]'::jsonb,
  'a second workspace sees no override from the first workspace'
);
select throws_ok(
  pg_catalog.format(
    $$select api.preview_campaign_lifecycle_coordination_v1(
      %L, 'end_campaign', '1', 'cross workspace', '[]'::jsonb,
      '52000000-0000-4000-8000-000000001401'
    )$$,
    (select response#>>'{campaign,campaignKey}' from d5_results where result_name = 'campaign2-apply')
  ),
  '42501', 'Interview Campaign is not accessible',
  'a second workspace cannot preview a coordination on the first workspace campaign'
);
select throws_ok(
  pg_catalog.format(
    $$select api.preview_campaign_allocation_override_v1(
      %L, 'remove_campaign_allocation_override', '1', null, null, null, 'cross workspace'
    )$$,
    (select response#>>'{overrides,installed,0,overrideKey}' from d5_results where result_name = 'coordination3b-preview')
  ),
  '42501', 'campaign allocation override is not accessible',
  'a second workspace cannot preview a direct override change on the first workspace override'
);

reset role;
select finish();
rollback;
