begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
create function pg_temp.initialize_growth_plan_fixture_v1(
  p_readiness_goal_key text,
  p_weekly_capacity_minutes integer,
  p_default_session_minutes integer,
  p_track_priority integer,
  p_protected_minimum_minutes integer,
  p_idempotency_key text
)
returns jsonb
language sql
security definer
set search_path = ''
as $function$
  select api.initialize_growth_plan_v1(
    p_readiness_goal_key, p_weekly_capacity_minutes, p_default_session_minutes,
    p_track_priority, p_protected_minimum_minutes, p_idempotency_key
  )
$function$;
revoke all on function pg_temp.initialize_growth_plan_fixture_v1(
  text, integer, integer, integer, integer, text
) from public, anon, authenticated, service_role;
grant execute on function pg_temp.initialize_growth_plan_fixture_v1(
  text, integer, integer, integer, integer, text
) to authenticated;
select no_plan();

select is(
  pg_catalog.has_function_privilege(runtime.role_name, boundary.signature, 'EXECUTE'),
  boundary.public_for_authenticated and runtime.role_name = 'authenticated',
  pg_catalog.format('%s has the exact activity-admission privilege for %s',
    runtime.role_name, boundary.signature)
)
from (values ('anon'), ('authenticated'), ('service_role')) as runtime(role_name)
cross join (values
  ('api.get_learning_track_activity_admission_source_v1()', true),
  ('api.preview_learning_track_activity_admission_v1(text,integer,text,text,text,text,text)', true),
  ('api.apply_learning_track_activity_admission_v1(text,integer,text,text,text,text,text,text)', true),
  ('api.add_learning_track_activity_v1(text,text,integer,text,text,text)', false),
  ('planning.build_learning_track_activity_admission_preview_v1(uuid,text,integer,text,bigint,bigint,text,uuid)', false),
  ('overlay.get_planning_activity_admission_choices_v1(uuid,uuid,uuid[])', false),
  ('overlay.get_planning_activity_admission_source_v2(uuid,uuid,text)', false)
) as boundary(signature, public_for_authenticated)
order by runtime.role_name, boundary.signature;

select ok(
  count(*) = 6
    and bool_and(procedure.prosecdef)
    and bool_and('search_path=""' = any(coalesce(procedure.proconfig, '{}'::text[])))
    and bool_and(owner.rolname in ('pando_planning_api', 'pando_phase1_api')),
  'all v2 admission functions are pinned SECURITY DEFINER owner boundaries'
)
from pg_catalog.pg_proc as procedure
join pg_catalog.pg_roles as owner on owner.oid = procedure.proowner
where procedure.oid in (
  pg_catalog.to_regprocedure('api.get_learning_track_activity_admission_source_v1()'),
  pg_catalog.to_regprocedure('api.preview_learning_track_activity_admission_v1(text,integer,text,text,text,text,text)'),
  pg_catalog.to_regprocedure('api.apply_learning_track_activity_admission_v1(text,integer,text,text,text,text,text,text)'),
  pg_catalog.to_regprocedure('planning.build_learning_track_activity_admission_preview_v1(uuid,text,integer,text,bigint,bigint,text,uuid)'),
  pg_catalog.to_regprocedure('overlay.get_planning_activity_admission_choices_v1(uuid,uuid,uuid[])'),
  pg_catalog.to_regprocedure('overlay.get_planning_activity_admission_source_v2(uuid,uuid,text)')
);

select is(
  pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    planning.frame_named_fields_v1(
      array[
        'digestVersion','contractVersion','workspaceId','operation','commandType','requestId','reason',
        'expectedGrowthPlanVersion','expectedLearningTrackVersion','growthPlanId','growthPlanTitle',
        'growthPlanLifecycle','growthPlanWeeklyCapacityMinutes','growthPlanAggregateVersion',
        'learningTrackId','trackKey','learningTrackTitle','learningTrackLifecycle',
        'learningTrackPriority','learningTrackProtectedMinimumMinutes','learningTrackDefaultSessionMinutes',
        'learningTrackVersionBefore','learningTrackVersionAfter','readinessGoalId','profileVersionId',
        'targetsOwnerRevision','customActivityId','activityKey','activityTitle','activityType',
        'targetCompetencyRef','activityLifecycle','activityMappingStatus','overlayOwnerRevision',
        'candidateKey','estimatedMinutes','energy','planActivityCountBefore','planActivityCountAfter',
        'planActivityLimit','canApply','blockingReasonCode','warningCount','warningCode',
        'retainedActivitiesAndEvidence','retainedPlanSnapshots','retainedFocusSessions',
        'retainedMasteryAndReadiness','projectionStateAfterApply','eventChangeKind','consumerName'
      ],
      array[
        'learning-track-activity-admission-preview-digest/1.0.0','1.0.0',
        'a0000000-0000-4000-8000-000000000001','admit_activity_to_learning_track',
        'planning.add_learning_track_activity_v2','10000000-0000-4000-8000-000000000001',
        'Add SQL — 学習','4','7','20000000-0000-4000-8000-000000000001',
        'Backend readiness','ACTIVE','600','4','30000000-0000-4000-8000-000000000001',
        'track:backend-core','Backend readiness','PAUSED','50','0','30','7','8',
        '40000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001',
        'readiness-goal:9','60000000-0000-4000-8000-000000000001','activity:sql-practice',
        'SQL practice','MANUAL_CODING','competency:sql','ACTIVE','ACCEPTED',
        'workspace-overlay:12','candidate:10000000-0000-4000-8000-000000000001','45',
        'MEDIUM','2','3','200','true','','1','LEARNING_TRACK_PAUSED',
        'true','true','true','true','PENDING','TRACK_ACTIVITY_ADMITTED','planning.plan_snapshot_v1'
      ]
    ), 'UTF8'), 'sha256'), 'hex'),
  '7a05cc4b76cdb3883cfa4b269cff78c01670b183c72bc12f5d1eb440faa6ecdb',
  'PostgreSQL and TypeScript agree on the complete Unicode preview digest oracle'
);
select is(
  pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    planning.frame_named_fields_v1(
      array[
        'requestHashVersion','commandType','workspaceId','requestId','activityKey',
        'estimatedMinutes','energy','expectedGrowthPlanVersion','expectedLearningTrackVersion',
        'reason','previewDigest'
      ],
      array[
        'learning-track-activity-admission-request-hash/1.0.0',
        'planning.add_learning_track_activity_v2',
        'a0000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000001','activity:sql-practice','45','',
        '4','7','Add SQL — 学習',pg_catalog.repeat('a', 64)
      ]
    ), 'UTF8'), 'sha256'), 'hex'),
  '0df0303b6dfb1e8820d19bd4acdd43f2f5bd541a952d684faee877296cce0bea',
  'PostgreSQL and TypeScript agree on the complete Unicode apply request-hash oracle'
);

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '36000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'manual-admission@pando.test', '', pg_catalog.clock_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
);
create temporary table admission_results(name text primary key, response jsonb not null);
grant select, insert, update on admission_results to authenticated;

select set_config('request.jwt.claims', pg_catalog.jsonb_build_object(
  'sub', '36000000-0000-4000-8000-000000000001', 'role', 'authenticated',
  'aud', 'authenticated', 'exp', extract(epoch from pg_catalog.clock_timestamp() + interval '1 hour')::bigint
)::text, true);
set local role authenticated;
insert into admission_results values (
  'bootstrap', api.bootstrap_personal_workspace('manual-admission', 'Manual Admission')
);
insert into admission_results
select 'goal', api.create_readiness_goal(
  (select (response->>'workspace_id')::uuid from admission_results where name = 'bootstrap'),
  'goal:manual-admission', 'Manual admission goal',
  'target:nvidia-python-verification-base-v1', 'manual-admission-goal'
);
insert into admission_results values (
  'plan', pg_temp.initialize_growth_plan_fixture_v1(
    'goal:manual-admission', 600, 30, 50, 0, 'manual-admission-plan'
  )
);
insert into admission_results values (
  'activity-a', api.add_current_custom_activity_v1(
    'goal:manual-admission', 'activity:admission-a', 'Admission A', 'MANUAL_CODING',
    'competency:python-error-handling', '0', 'manual-admission-activity-a'
  )
);
insert into admission_results values (
  'activity-b', api.add_current_custom_activity_v1(
    'goal:manual-admission', 'activity:admission-b', 'Admission B', 'READING',
    'competency:python-error-handling', '1', 'manual-admission-activity-b'
  )
);
insert into admission_results values (
  'source', api.get_learning_track_activity_admission_source_v1()
);

select is(
  (select response#>>'{contract,name}' from admission_results where name = 'source'),
  'LearningTrackActivityAdmissionSourceV1',
  'source uses the strict versioned contract'
);
select is(
  (select response->>'state' from admission_results where name = 'source'),
  'READY',
  'one current initial Track with eligible personal work is ready'
);
select is(
  (select response->'capabilities' from admission_results where name = 'source'),
  '["admit_activity_to_learning_track"]'::jsonb,
  'only a ready source exposes admission capability'
);
select is(
  (select response#>>'{activities,0,activityKey}' from admission_results where name = 'source'),
  'activity:admission-a',
  'eligible activities use stable activity-key order'
);
select is(
  (select pg_catalog.jsonb_array_length(response->'activities') from admission_results where name = 'source'),
  2,
  'source includes both exact-profile accepted personal activities'
);
select ok(
  not exists (
    select 1
    from admission_results,
      lateral pg_catalog.jsonb_object_keys(response) as key
    where name = 'source' and key in ('workspaceId', 'growthPlanId', 'learningTrackId')
  )
  and not exists (
    select 1
    from admission_results,
      lateral pg_catalog.jsonb_array_elements(response->'activities') as activity,
      lateral pg_catalog.jsonb_object_keys(activity) as key
    where name = 'source' and key in ('customActivityId', 'profileVersionId', 'evidence')
  ),
  'public source exposes no authority UUIDs or private activity bodies'
);

select throws_ok(
  $$select api.add_learning_track_activity_v1(
    'track:denied', 'activity:denied', 30, '1', 'denied', null
  )$$,
  '42501',
  'permission denied for function add_learning_track_activity_v1',
  'the retired direct v1 mutation is denied to authenticated'
);
select throws_ok(
  $$select planning.build_learning_track_activity_admission_preview_v1(
    '36000000-0000-4000-8000-000000000099', 'activity:denied', 30, null, 1, 1,
    'Denied', '10000000-0000-4000-8000-000000000099'
  )$$,
  '42501',
  'permission denied for function build_learning_track_activity_admission_preview_v1',
  'the private preview builder is denied to authenticated'
);
select throws_ok(
  pg_catalog.format(
    'select api.preview_learning_track_activity_admission_v1(%L,30,null,%L,%L,%L,%L)',
    'activity:admission-a', '9223372036854775808',
    (select response#>>'{learningTrack,aggregateVersion}' from admission_results where name = 'source'),
    'Reject overflow.', '10000000-0000-4000-8000-000000000099'
  ),
  '22023', 'activity admission preview request is invalid',
  'preview rejects an expected Plan version above signed bigint range'
);
select throws_ok(
  pg_catalog.format(
    'select api.preview_learning_track_activity_admission_v1(%L,30,null,%L,%L,%L,%L)',
    'activity:not-visible',
    (select response#>>'{growthPlan,aggregateVersion}' from admission_results where name = 'source'),
    (select response#>>'{learningTrack,aggregateVersion}' from admission_results where name = 'source'),
    'Do not enumerate.', '10000000-0000-4000-8000-000000000098'
  ),
  '42501', 'activity admission source is unavailable',
  'preview fails closed without enumerating a missing or foreign activity'
);

insert into admission_results
select 'preview', api.preview_learning_track_activity_admission_v1(
  'activity:admission-a', 45, 'MEDIUM',
  (select response#>>'{growthPlan,aggregateVersion}' from admission_results where name = 'source'),
  (select response#>>'{learningTrack,aggregateVersion}' from admission_results where name = 'source'),
  'Add this focused practice.', '10000000-0000-4000-8000-000000000001'
);
select is(
  (select response#>>'{contract,name}' from admission_results where name = 'preview'),
  'LearningTrackActivityAdmissionPreviewV1',
  'preview uses the strict versioned contract'
);
select is(
  (select response#>>'{activity,candidateKey}' from admission_results where name = 'preview'),
  'candidate:10000000-0000-4000-8000-000000000001',
  'preview deterministically binds candidate identity to request UUID'
);
select is(
  (select response#>>'{constraint,planActivityCountBefore}' from admission_results where name = 'preview'),
  '0',
  'preview reports exact current Plan activity count'
);
select is(
  (select response#>>'{learningTrack,aggregateVersionAfter}' from admission_results where name = 'preview'),
  '2',
  'preview reports one exact Track version increment'
);
select ok(
  (select (response->>'canApply')::boolean from admission_results where name = 'preview')
    and (select response->'warnings' = '[]'::jsonb from admission_results where name = 'preview'),
  'active Plan and Track produce an applicable warning-free preview'
);
select ok(
  not (select response ? 'internal' from admission_results where name = 'preview')
  and not (select response::text ~ '(growthPlanId|learningTrackId|readinessGoalId|profileVersionId|customActivityId)'
    from admission_results where name = 'preview'),
  'public preview strips its internal identity envelope and authority-bearing UUID fields'
);
reset role;
select is(
  (select count(*)
   from planning.learning_track_activities as attribution
   join planning.learning_tracks as track
     on track.learning_track_id = attribution.learning_track_id
   where track.track_key =
     (select response#>>'{learningTrack,trackKey}' from admission_results where name = 'preview')),
  0::bigint,
  'preview is side-effect free for Planning attribution'
);
select is(
  (select count(*) from outbox.command_receipts where command_type = 'planning.add_learning_track_activity_v2'),
  0::bigint,
  'preview creates no command receipt'
);

set local role authenticated;
insert into admission_results
select 'apply', api.apply_learning_track_activity_admission_v1(
  'activity:admission-a', 45, 'MEDIUM',
  (select response->>'expectedGrowthPlanVersion' from admission_results where name = 'preview'),
  (select response->>'expectedLearningTrackVersion' from admission_results where name = 'preview'),
  'Add this focused practice.', '10000000-0000-4000-8000-000000000001',
  (select response->>'previewDigest' from admission_results where name = 'preview')
);
select is(
  (select response#>>'{contract,name}' from admission_results where name = 'apply'),
  'LearningTrackActivityAdmissionApplyResultV1',
  'apply uses the strict versioned result contract'
);
select is(
  (select response#>>'{changedTrack,aggregateVersion}' from admission_results where name = 'apply'),
  '2',
  'apply reports the resulting Track version'
);
select ok(
  not (select response ? 'internal' from admission_results where name = 'apply')
  and not (select response::text ~ '(growthPlanId|learningTrackId|readinessGoalId|profileVersionId|customActivityId)'
    from admission_results where name = 'apply'),
  'apply result exposes no internal identity envelope or authority-bearing UUID fields'
);
reset role;
select is(
  (select count(*) from planning.learning_track_activities where candidate_key =
    'candidate:10000000-0000-4000-8000-000000000001'),
  1::bigint,
  'apply inserts exactly one deterministic attribution'
);
select is(
  (select aggregate_version from planning.learning_tracks where track_key =
    (select response#>>'{learningTrack,trackKey}' from admission_results where name = 'preview')),
  2::bigint,
  'apply increments only the selected Track exactly once'
);
select is(
  (select aggregate_version
   from planning.growth_plans
   where workspace_id =
     (select (response->>'workspace_id')::uuid from admission_results where name = 'bootstrap')),
  1::bigint,
  'apply preserves the Growth Plan aggregate version'
);
select is(
  (select count(*) from outbox.events where event_name = 'planning.input_changed'
    and payload->>'change_kind' = 'TRACK_ACTIVITY_ADMITTED'
    and event_id = (select (response#>>'{emittedEventIds,0}')::uuid
      from admission_results where name = 'apply')),
  1::bigint,
  'apply emits exactly one existing activity-admission event'
);
select is(
  (select count(*) from outbox.deliveries where consumer_name = 'planning.plan_snapshot_v1'
    and event_id = (select (response#>>'{emittedEventIds,0}')::uuid
      from admission_results where name = 'apply')),
  1::bigint,
  'apply creates exactly one fixed Planning delivery'
);
set local role authenticated;
select is(
  api.apply_learning_track_activity_admission_v1(
    'activity:admission-a', 45, 'MEDIUM',
    (select response->>'expectedGrowthPlanVersion' from admission_results where name = 'preview'),
    (select response->>'expectedLearningTrackVersion' from admission_results where name = 'preview'),
    'Add this focused practice.', '10000000-0000-4000-8000-000000000001',
    (select response->>'previewDigest' from admission_results where name = 'preview')
  ),
  (select response from admission_results where name = 'apply'),
  'identical confirmed retry returns the byte-identical stored response'
);
select throws_ok(
  pg_catalog.format(
    'select api.apply_learning_track_activity_admission_v1(%L,46,%L,%L,%L,%L,%L,%L)',
    'activity:admission-a', 'MEDIUM',
    (select response->>'expectedGrowthPlanVersion' from admission_results where name = 'preview'),
    (select response->>'expectedLearningTrackVersion' from admission_results where name = 'preview'),
    'Add this focused practice.', '10000000-0000-4000-8000-000000000001',
    (select response->>'previewDigest' from admission_results where name = 'preview')
  ),
  '22023', 'idempotency key reused with a different request',
  'same request UUID cannot be reused with changed admission inputs'
);

insert into admission_results values (
  'source-after', api.get_learning_track_activity_admission_source_v1()
);
select is(
  (select pg_catalog.jsonb_array_length(response->'activities') from admission_results where name = 'source-after'),
  1,
  'source excludes an activity already attributed anywhere in the current Plan'
);
select is(
  (select response#>>'{activities,0,activityKey}' from admission_results where name = 'source-after'),
  'activity:admission-b',
  'source retains the next exact eligible personal activity'
);
select throws_ok(
  pg_catalog.format(
    'select api.preview_learning_track_activity_admission_v1(%L,45,%L,%L,%L,%L,%L)',
    'activity:admission-a', 'MEDIUM',
    (select response#>>'{growthPlan,aggregateVersion}' from admission_results where name = 'source-after'),
    (select response#>>'{learningTrack,aggregateVersion}' from admission_results where name = 'source-after'),
    'Try duplicate.', '10000000-0000-4000-8000-000000000003'
  ),
  '42501', 'activity admission source is unavailable',
  'already-attributed activity fails closed at preview without enumeration'
);

insert into admission_results
select 'stale-preview', api.preview_learning_track_activity_admission_v1(
  'activity:admission-b', 30, null,
  (select response#>>'{growthPlan,aggregateVersion}' from admission_results where name = 'source-after'),
  (select response#>>'{learningTrack,aggregateVersion}' from admission_results where name = 'source-after'),
  'Prepare another activity.', '10000000-0000-4000-8000-000000000002'
);
reset role;
update planning.learning_tracks set aggregate_version = aggregate_version + 1;
set local role authenticated;
select throws_ok(
  pg_catalog.format(
    'select api.apply_learning_track_activity_admission_v1(%L,30,null,%L,%L,%L,%L,%L)',
    'activity:admission-b',
    (select response->>'expectedGrowthPlanVersion' from admission_results where name = 'stale-preview'),
    (select response->>'expectedLearningTrackVersion' from admission_results where name = 'stale-preview'),
    'Prepare another activity.', '10000000-0000-4000-8000-000000000002',
    (select response->>'previewDigest' from admission_results where name = 'stale-preview')
  ),
  '40001', 'activity admission preview is stale',
  'a changed Track version rejects the previously shown preview'
);
reset role;
select is(
  (select count(*)
   from planning.learning_track_activities as attribution
   join planning.learning_tracks as track
     on track.learning_track_id = attribution.learning_track_id
   where track.track_key =
     (select response#>>'{learningTrack,trackKey}' from admission_results where name = 'preview')),
  1::bigint,
  'stale confirmation writes no second attribution'
);

-- Archived history is retained for duplicate exclusion but must not consume the 200 current-item
-- capacity or turn the actor-scoped source into an internal error.
create temporary table admission_archived_history as
select sequence_number, pg_catalog.gen_random_uuid() as custom_activity_id
from pg_catalog.generate_series(1, 201) as sequence_number;
insert into overlay.custom_activities (
  custom_activity_id, workspace_id, profile_version_id, activity_key, title,
  activity_type, target_competency_ref
)
select history.custom_activity_id,
  (select (response->>'workspaceId')::uuid from admission_results where name = 'plan'),
  (select (response->>'profileVersionId')::uuid from admission_results where name = 'plan'),
  'activity:archived-history-' || history.sequence_number::text,
  'Archived history ' || history.sequence_number::text,
  'READING', 'competency:python-error-handling'
from admission_archived_history as history;
insert into planning.learning_track_activities (
  workspace_id, growth_plan_id, learning_track_id, custom_activity_id,
  candidate_key, estimated_minutes, lifecycle
)
select
  (select (response->>'workspaceId')::uuid from admission_results where name = 'plan'),
  (select (response->>'growthPlanId')::uuid from admission_results where name = 'plan'),
  (select (response->>'learningTrackId')::uuid from admission_results where name = 'plan'),
  history.custom_activity_id,
  'candidate:archived-history-' || history.sequence_number::text,
  30, 'archived'
from admission_archived_history as history;
set local role authenticated;
insert into admission_results values (
  'source-after-archived-history', api.get_learning_track_activity_admission_source_v1()
);
select ok(
  (select response->>'state' = 'READY'
    and pg_catalog.jsonb_array_length(response->'activities') = 1
    and response#>>'{activities,0,activityKey}' = 'activity:admission-b'
   from admission_results where name = 'source-after-archived-history'),
  'more than 200 archived attributions stay excluded without consuming current capacity'
);
insert into admission_results
select 'rollback-preview', api.preview_learning_track_activity_admission_v1(
  'activity:admission-b', 30, null,
  (select response#>>'{growthPlan,aggregateVersion}'
    from admission_results where name = 'source-after-archived-history'),
  (select response#>>'{learningTrack,aggregateVersion}'
    from admission_results where name = 'source-after-archived-history'),
  'Prove atomic rollback.', '10000000-0000-4000-8000-000000000004'
);
reset role;

create temporary table admission_rollback_baseline as
select
  (select aggregate_version from planning.learning_tracks
   where learning_track_id =
     (select (response->>'learningTrackId')::uuid from admission_results where name = 'plan'))
    as track_version,
  (select count(*) from outbox.events
   where aggregate_id =
     (select (response->>'learningTrackId')::uuid from admission_results where name = 'plan')
     and event_name = 'planning.input_changed') as event_count,
  (select count(*) from outbox.deliveries as delivery
   join outbox.events as event on event.event_id = delivery.event_id
   where event.aggregate_id =
     (select (response->>'learningTrackId')::uuid from admission_results where name = 'plan')
     and delivery.consumer_name = 'planning.plan_snapshot_v1') as delivery_count;
create function public.fail_manual_admission_event_for_test()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.event_name = 'planning.input_changed'
     and new.workspace_id::text = pg_catalog.current_setting(
       'pando.test.fail_manual_admission_workspace', true
     ) then
    raise exception using errcode = 'P0001', message = 'injected manual admission outbox failure';
  end if;
  return new;
end
$function$;
create trigger fail_manual_admission_event_for_test
before insert on outbox.events
for each row execute function public.fail_manual_admission_event_for_test();
select set_config(
  'pando.test.fail_manual_admission_workspace',
  (select response->>'workspaceId' from admission_results where name = 'plan'),
  true
);
set local role authenticated;
select throws_ok(
  pg_catalog.format(
    'select api.apply_learning_track_activity_admission_v1(%L,30,null,%L,%L,%L,%L,%L)',
    'activity:admission-b',
    (select response->>'expectedGrowthPlanVersion' from admission_results where name = 'rollback-preview'),
    (select response->>'expectedLearningTrackVersion' from admission_results where name = 'rollback-preview'),
    'Prove atomic rollback.', '10000000-0000-4000-8000-000000000004',
    (select response->>'previewDigest' from admission_results where name = 'rollback-preview')
  ),
  'P0001', 'injected manual admission outbox failure',
  'an injected outbox failure aborts the entire exact-confirm admission'
);
reset role;
drop trigger fail_manual_admission_event_for_test on outbox.events;
drop function public.fail_manual_admission_event_for_test();
select ok(
  (select aggregate_version from planning.learning_tracks
   where learning_track_id =
     (select (response->>'learningTrackId')::uuid from admission_results where name = 'plan')) =
    (select track_version from admission_rollback_baseline)
  and not exists (
    select 1 from planning.learning_track_activities
    where candidate_key = 'candidate:10000000-0000-4000-8000-000000000004'
  )
  and not exists (
    select 1 from outbox.command_receipts
    where idempotency_key =
      'learning-track-activity-admission:v2:10000000-0000-4000-8000-000000000004'
  ),
  'outbox failure rolls back the Track, attribution, and command receipt together'
);
select ok(
  (select count(*) from outbox.events
   where aggregate_id =
     (select (response->>'learningTrackId')::uuid from admission_results where name = 'plan')
     and event_name = 'planning.input_changed') =
    (select event_count from admission_rollback_baseline)
  and (select count(*) from outbox.deliveries as delivery
   join outbox.events as event on event.event_id = delivery.event_id
   where event.aggregate_id =
     (select (response->>'learningTrackId')::uuid from admission_results where name = 'plan')
     and delivery.consumer_name = 'planning.plan_snapshot_v1') =
    (select delivery_count from admission_rollback_baseline),
  'outbox failure leaves no event or fixed Planning delivery'
);

select * from finish();
rollback;
