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

create function pg_temp.create_learning_track_fixture_v1(
  p_readiness_goal_key text,
  p_expected_readiness_goal_version text,
  p_title text,
  p_priority integer,
  p_default_session_minutes integer,
  p_expected_growth_plan_version text,
  p_reason text,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_preview jsonb;
begin
  v_preview := api.preview_learning_track_creation_v1(
    p_readiness_goal_key,
    p_expected_readiness_goal_version,
    p_title,
    p_priority,
    p_default_session_minutes,
    p_expected_growth_plan_version,
    p_reason,
    p_request_id
  );
  return api.apply_learning_track_creation_v1(
    p_readiness_goal_key,
    p_expected_readiness_goal_version,
    p_title,
    p_priority,
    p_default_session_minutes,
    p_expected_growth_plan_version,
    p_reason,
    p_request_id,
    v_preview->>'previewDigest'
  );
end
$function$;
revoke all on function pg_temp.create_learning_track_fixture_v1(
  text, text, text, integer, integer, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function pg_temp.create_learning_track_fixture_v1(
  text, text, text, integer, integer, text, text, text
) to authenticated;

select no_plan();

select is(
  pg_catalog.has_function_privilege(runtime.role_name, boundary.signature, 'EXECUTE'),
  boundary.public_for_authenticated and runtime.role_name = 'authenticated',
  pg_catalog.format('%s has the exact destination-aware admission privilege for %s',
    runtime.role_name, boundary.signature)
)
from (values ('anon'), ('authenticated'), ('service_role')) as runtime(role_name)
cross join (values
  ('api.get_learning_track_activity_admission_source_v2(text)', true),
  ('api.preview_learning_track_activity_admission_v2(text,text,integer,text,text,text,text,text)', true),
  ('api.apply_learning_track_activity_admission_v2(text,text,integer,text,text,text,text,text,text)', true),
  ('planning.build_learning_track_activity_admission_preview_v2(uuid,text,text,integer,text,bigint,bigint,text,uuid)', false)
) as boundary(signature, public_for_authenticated)
order by runtime.role_name, boundary.signature;

select ok(
  count(*) = 4
    and bool_and(procedure.prosecdef)
    and bool_and('search_path=""' = any(coalesce(procedure.proconfig, '{}'::text[])))
    and bool_and(owner.rolname = 'pando_planning_api'),
  'all destination-aware admission functions are pinned SECURITY DEFINER Planning boundaries'
)
from pg_catalog.pg_proc as procedure
join pg_catalog.pg_roles as owner on owner.oid = procedure.proowner
where procedure.oid in (
  pg_catalog.to_regprocedure('api.get_learning_track_activity_admission_source_v2(text)'),
  pg_catalog.to_regprocedure('api.preview_learning_track_activity_admission_v2(text,text,integer,text,text,text,text,text)'),
  pg_catalog.to_regprocedure('api.apply_learning_track_activity_admission_v2(text,text,integer,text,text,text,text,text,text)'),
  pg_catalog.to_regprocedure('planning.build_learning_track_activity_admission_preview_v2(uuid,text,text,integer,text,bigint,bigint,text,uuid)')
);

select ok(
  pg_catalog.has_function_privilege(
    'pando_planning_api',
    'overlay.get_planning_activity_admission_choices_v1(uuid,uuid,uuid[])',
    'EXECUTE'
  )
  and pg_catalog.has_function_privilege(
    'pando_planning_api',
    'overlay.get_planning_activity_admission_source_v2(uuid,uuid,text)',
    'EXECUTE'
  )
  and pg_catalog.has_function_privilege(
    'pando_planning_api',
    'targets.get_planning_track_goal_admission_source_v1(uuid,uuid,uuid)',
    'EXECUTE'
  )
  and pg_catalog.has_function_privilege(
    'pando_planning_api',
    'planning.projected_current_track_order_v1(uuid,uuid,uuid,integer,bigint)',
    'EXECUTE'
  )
  and not pg_catalog.has_table_privilege('pando_planning_api', 'overlay.custom_activities', 'SELECT')
  and not pg_catalog.has_table_privilege('pando_planning_api', 'targets.readiness_goals', 'SELECT'),
  'Planning reuses owner helpers for overlay, targets, and track-order binding without direct table reads'
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
        'planActivityLimit','currentTrackOrderFingerprint','canApply','blockingReasonCode',
        'warningCount','warningCode','retainedActivitiesAndEvidence','retainedPlanSnapshots',
        'retainedFocusSessions','retainedMasteryAndReadiness','projectionStateAfterApply',
        'eventChangeKind','consumerName'
      ],
      array[
        'learning-track-activity-admission-preview-digest/2.0.0','2.0.0',
        'a0000000-0000-4000-8000-000000000001','admit_activity_to_learning_track',
        'planning.add_learning_track_activity_v3','10000000-0000-4000-8000-000000000001',
        'Add SQL — 学習','4','7','20000000-0000-4000-8000-000000000001',
        'Backend readiness','ACTIVE','600','4','30000000-0000-4000-8000-000000000001',
        'track:backend-core','Backend readiness','PAUSED','50','0','30','7','8',
        '40000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001',
        'readiness-goal:9','60000000-0000-4000-8000-000000000001','activity:sql-practice',
        'SQL practice','MANUAL_CODING','competency:sql','ACTIVE','ACCEPTED',
        'workspace-overlay:12','candidate:10000000-0000-4000-8000-000000000001',
        '45','MEDIUM','2','3','200',repeat('f', 64),'true','','1',
        'LEARNING_TRACK_PAUSED','true','true','true','true',
        'PENDING','TRACK_ACTIVITY_ADMITTED','planning.plan_snapshot_v1'
      ]
    ), 'UTF8'), 'sha256'), 'hex'),
  '0e41ed55aac898d61e806526918d3c43e304b5beb92d00f4a723911bac024af6',
  'PostgreSQL and TypeScript agree on the complete destination-aware preview digest oracle'
);

select is(
  pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    planning.frame_named_fields_v1(
      array[
        'requestHashVersion','commandType','workspaceId','requestId','trackKey','activityKey',
        'estimatedMinutes','energy','expectedGrowthPlanVersion','expectedLearningTrackVersion',
        'reason','previewDigest'
      ],
      array[
        'learning-track-activity-admission-request-hash/2.0.0',
        'planning.add_learning_track_activity_v3',
        'a0000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000001',
        'track:backend-core','activity:sql-practice','45','','4','7',
        'Add SQL — 学習',repeat('a', 64)
      ]
    ), 'UTF8'), 'sha256'), 'hex'),
  '57cdbd7abe2288551318ab39cd6b117693cf44636dd67dab271d05b6e6c891bc',
  'PostgreSQL and TypeScript agree on the complete destination-aware request-hash oracle'
);

select ok(
  pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    planning.frame_named_fields_v1(
      array[
        'requestHashVersion','commandType','workspaceId','requestId','trackKey','activityKey',
        'estimatedMinutes','energy','expectedGrowthPlanVersion','expectedLearningTrackVersion',
        'reason','previewDigest'
      ],
      array[
        'learning-track-activity-admission-request-hash/2.0.0',
        'planning.add_learning_track_activity_v3',
        'a0000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000001',
        'track:backend-core','activity:sql-practice','45','','4','7',
        'Add SQL — 学習',repeat('a', 64)
      ]
    ), 'UTF8'), 'sha256'), 'hex'
  ) <>
  pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    planning.frame_named_fields_v1(
      array[
        'requestHashVersion','commandType','workspaceId','requestId','trackKey','activityKey',
        'estimatedMinutes','energy','expectedGrowthPlanVersion','expectedLearningTrackVersion',
        'reason','previewDigest'
      ],
      array[
        'learning-track-activity-admission-request-hash/2.0.0',
        'planning.add_learning_track_activity_v3',
        'a0000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000001',
        'track:backend-advanced','activity:sql-practice','45','','4','7',
        'Add SQL — 学習',repeat('a', 64)
      ]
    ), 'UTF8'), 'sha256'), 'hex'
  ),
  'the selected track key materially participates in the v2 request hash'
);

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    '46000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
    'destination-admission-main@pando.test', '', pg_catalog.clock_timestamp(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
  ),
  (
    '46000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
    'destination-admission-empty@pando.test', '', pg_catalog.clock_timestamp(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
  ),
  (
    '46000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
    'destination-admission-overflow@pando.test', '', pg_catalog.clock_timestamp(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
  ),
  (
    '46000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated',
    'destination-admission-cap@pando.test', '', pg_catalog.clock_timestamp(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
  ),
  (
    '46000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated',
    'destination-admission-foreign@pando.test', '', pg_catalog.clock_timestamp(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
  );

create temporary table destination_admission_results(
  name text primary key,
  response jsonb not null
);
grant select, insert, update on destination_admission_results to authenticated;
grant select on destination_admission_results to pando_planning_api;

select set_config('request.jwt.claims', pg_catalog.jsonb_build_object(
  'sub', '46000000-0000-4000-8000-000000000001', 'role', 'authenticated',
  'aud', 'authenticated', 'exp', extract(epoch from pg_catalog.clock_timestamp() + interval '1 hour')::bigint
)::text, true);
insert into destination_admission_results values (
  'main-bootstrap', api.bootstrap_personal_workspace('destination-admission-main', 'Destination Admission Main')
);
insert into destination_admission_results values (
  'main-no-plan-source',
  api.get_learning_track_activity_admission_source_v2('track:anything')
);
select is(
  (select response->>'state' from destination_admission_results where name = 'main-no-plan-source'),
  'NO_CURRENT_PLAN',
  'destination-aware source reports NO_CURRENT_PLAN before any Growth Plan exists'
);
insert into destination_admission_results
select 'main-goal', api.create_readiness_goal(
  (select (response->>'workspace_id')::uuid from destination_admission_results where name = 'main-bootstrap'),
  'goal:destination-main', 'Destination main goal',
  'target:nvidia-python-verification-base-v1', 'destination-main-goal'
);
insert into destination_admission_results values (
  'main-plan', pg_temp.initialize_growth_plan_fixture_v1(
    'goal:destination-main', 600, 30, 80, 0, 'destination-main-plan'
  )
);
insert into destination_admission_results values (
  'main-track-create-source', api.get_learning_track_creation_source_v1()
);
insert into destination_admission_results values (
  'main-track-b', pg_temp.create_learning_track_fixture_v1(
    'goal:destination-main',
    (
      select goal->>'aggregateVersion'
      from destination_admission_results,
        lateral pg_catalog.jsonb_array_elements(response->'goals') as goal
      where name = 'main-track-create-source'
        and goal->>'readinessGoalKey' = 'goal:destination-main'
    ),
    'Destination sibling', 60, 25,
    (select response#>>'{growthPlan,aggregateVersion}'
     from destination_admission_results where name = 'main-track-create-source'),
    'Create a sibling Track for selection.', '10000000-0000-4000-8000-000000000010'
  )
);
select set_config('request.jwt.claims', pg_catalog.jsonb_build_object(
  'sub', '46000000-0000-4000-8000-000000000005', 'role', 'authenticated',
  'aud', 'authenticated', 'exp', extract(epoch from pg_catalog.clock_timestamp() + interval '1 hour')::bigint
)::text, true);
insert into destination_admission_results values (
  'foreign-bootstrap', api.bootstrap_personal_workspace('destination-admission-foreign', 'Destination Admission Foreign')
);
insert into destination_admission_results
select 'foreign-goal', api.create_readiness_goal(
  (select (response->>'workspace_id')::uuid from destination_admission_results where name = 'foreign-bootstrap'),
  'goal:destination-foreign', 'Foreign destination goal',
  'target:nvidia-python-verification-base-v1', 'destination-foreign-goal'
);
insert into destination_admission_results values (
  'foreign-plan', pg_temp.initialize_growth_plan_fixture_v1(
    'goal:destination-foreign', 600, 30, 80, 0, 'destination-foreign-plan'
  )
);
insert into destination_admission_results
select 'foreign-track-source', api.get_learning_track_creation_source_v1();
insert into destination_admission_results
select 'foreign-track', pg_temp.create_learning_track_fixture_v1(
  'goal:destination-foreign',
  (select response#>>'{goals,0,aggregateVersion}' from destination_admission_results where name = 'foreign-track-source'),
  'Foreign Track', 50, 30,
  (select response#>>'{growthPlan,aggregateVersion}' from destination_admission_results where name = 'foreign-track-source'),
  'Foreign workspace track.', '10000000-0000-4000-8000-000000000099'
);
select set_config('request.jwt.claims', pg_catalog.jsonb_build_object(
  'sub', '46000000-0000-4000-8000-000000000001', 'role', 'authenticated',
  'aud', 'authenticated', 'exp', extract(epoch from pg_catalog.clock_timestamp() + interval '1 hour')::bigint
)::text, true);
insert into destination_admission_results values (
  'main-foreign-track-source',
  api.get_learning_track_activity_admission_source_v2(
    (select response#>>'{createdTrack,trackKey}' from destination_admission_results where name = 'foreign-track')
  )
);
select ok(
  (select response->>'state' from destination_admission_results where name = 'main-foreign-track-source')
    = 'SELECTED_TRACK_UNAVAILABLE'
  and (select response->'selectedTrack' from destination_admission_results where name = 'main-foreign-track-source')
    = 'null'::jsonb
  and (select pg_catalog.jsonb_array_length(response->'activities') from destination_admission_results where name = 'main-foreign-track-source') = 0,
  'an existing foreign-workspace Track is indistinguishable from a missing selector and is not enumerable'
);

insert into destination_admission_results values
  (
    'main-activity-a', api.add_current_custom_activity_v1(
      'goal:destination-main', 'activity:destination-a', 'Destination A', 'MANUAL_CODING',
      'competency:python-error-handling', '0', 'destination-activity-a'
    )
  ),
  (
    'main-activity-b', api.add_current_custom_activity_v1(
      'goal:destination-main', 'activity:destination-b', 'Destination B', 'READING',
      'competency:python-error-handling', '1', 'destination-activity-b'
    )
  );

insert into overlay.custom_activities (
  custom_activity_id, workspace_id, profile_version_id, activity_key, title,
  activity_type, target_competency_ref
)
select
  pg_catalog.gen_random_uuid(),
  (select (response->>'workspaceId')::uuid from destination_admission_results where name = 'main-plan'),
  profile.profile_version_id,
  'activity:destination-foreign',
  'Destination foreign profile',
  'PROJECT',
  'competency:python-error-handling'
from targets.target_profile_versions as profile
where profile.profile_version_id <> (
  select (response->>'profileVersionId')::uuid
  from destination_admission_results where name = 'main-plan'
)
  and profile.workspace_id is null
  and profile.lifecycle in ('published', 'retired')
order by profile.profile_version_key collate "C"
limit 1;

insert into destination_admission_results values (
  'main-source-a',
  api.get_learning_track_activity_admission_source_v2(
    (select response->>'learningTrackKey' from destination_admission_results where name = 'main-plan')
  )
);
insert into destination_admission_results values (
  'main-source-b',
  api.get_learning_track_activity_admission_source_v2(
    (select response#>>'{createdTrack,trackKey}' from destination_admission_results where name = 'main-track-b')
  )
);

select ok(
  (select response#>>'{contract,name}' from destination_admission_results where name = 'main-source-a')
    = 'LearningTrackActivityAdmissionSourceV2'
  and (select response->>'state' from destination_admission_results where name = 'main-source-a') = 'READY'
  and (select response#>>'{selectedTrack,trackKey}' from destination_admission_results where name = 'main-source-a')
    = (select response->>'learningTrackKey' from destination_admission_results where name = 'main-plan')
  and (select pg_catalog.jsonb_array_length(response->'activities') from destination_admission_results where name = 'main-source-a') = 2
  and (select response#>>'{activities,0,activityKey}' from destination_admission_results where name = 'main-source-a') = 'activity:destination-a',
  'selected-track source is READY, binds the requested Track, and exposes only exact-profile eligible activities in stable order'
);
select ok(
  not exists (
    select 1
    from destination_admission_results,
      lateral pg_catalog.jsonb_array_elements(response->'activities') as activity
    where name = 'main-source-a'
      and activity->>'activityKey' = 'activity:destination-foreign'
  )
  and not exists (
    select 1
    from destination_admission_results,
      lateral pg_catalog.jsonb_object_keys(response) as key
    where name = 'main-source-a' and key in ('workspaceId', 'growthPlanId', 'learningTrackId')
  ),
  'public source still hides authority UUIDs and does not enumerate foreign-profile activities'
);

insert into destination_admission_results values (
  'main-missing-track-source',
  api.get_learning_track_activity_admission_source_v2('track:not-visible')
);
select ok(
  (select response->>'state' from destination_admission_results where name = 'main-missing-track-source')
    = 'SELECTED_TRACK_UNAVAILABLE'
  and (select response->'selectedTrack' from destination_admission_results where name = 'main-missing-track-source')
    = 'null'::jsonb
  and (select pg_catalog.jsonb_array_length(response->'activities') from destination_admission_results where name = 'main-missing-track-source') = 0,
  'missing or foreign-looking selected track fails closed without enumerating current Tracks'
);

select throws_ok(
  pg_catalog.format(
    'select api.preview_learning_track_activity_admission_v2(%L,%L,30,null,%L,%L,%L,%L)',
    'track:not-visible',
    'activity:destination-a',
    (select response#>>'{growthPlan,aggregateVersion}' from destination_admission_results where name = 'main-source-a'),
    '1',
    'Do not enumerate.', '10000000-0000-4000-8000-000000000011'
  ),
  '42501', 'activity admission target is unavailable',
  'preview fails closed for an unavailable selected track'
);
select throws_ok(
  pg_catalog.format(
    'select api.preview_learning_track_activity_admission_v2(%L,%L,30,null,%L,%L,%L,%L)',
    (select response->>'learningTrackKey' from destination_admission_results where name = 'main-plan'),
    'activity:not-visible',
    (select response#>>'{growthPlan,aggregateVersion}' from destination_admission_results where name = 'main-source-a'),
    (select response#>>'{selectedTrack,aggregateVersion}' from destination_admission_results where name = 'main-source-a'),
    'Do not enumerate.', '10000000-0000-4000-8000-000000000012'
  ),
  '42501', 'activity admission source is unavailable',
  'preview fails closed for an unavailable activity within the selected Track route'
);

insert into destination_admission_results
select 'main-preview-b', api.preview_learning_track_activity_admission_v2(
  (select response#>>'{selectedTrack,trackKey}' from destination_admission_results where name = 'main-source-b'),
  'activity:destination-a',
  45,
  'MEDIUM',
  (select response#>>'{growthPlan,aggregateVersion}' from destination_admission_results where name = 'main-source-b'),
  (select response#>>'{selectedTrack,aggregateVersion}' from destination_admission_results where name = 'main-source-b'),
  'Admit onto the sibling Track.',
  '10000000-0000-4000-8000-000000000001'
);
select ok(
  (select response#>>'{contract,name}' from destination_admission_results where name = 'main-preview-b')
    = 'LearningTrackActivityAdmissionPreviewV2'
  and (select response->>'commandType' from destination_admission_results where name = 'main-preview-b')
    = 'planning.add_learning_track_activity_v3'
  and (select response#>>'{constraint,currentTrackOrderFingerprint}' from destination_admission_results where name = 'main-preview-b')
    ~ '^[a-f0-9]{64}$'
  and (select response#>>'{learningTrack,trackKey}' from destination_admission_results where name = 'main-preview-b')
    = (select response#>>'{selectedTrack,trackKey}' from destination_admission_results where name = 'main-source-b')
  and not (select response ? 'internal' from destination_admission_results where name = 'main-preview-b'),
  'preview uses the v2 contract, binds the selected Track, includes the full order fingerprint, and strips internal ids'
);
reset role;
select is(
  (select count(*) from planning.learning_track_activities
   where workspace_id = (select (response->>'workspaceId')::uuid from destination_admission_results where name = 'main-plan')),
  0::bigint,
  'preview remains side-effect free'
);

set local role authenticated;
insert into destination_admission_results
select 'main-apply-b', api.apply_learning_track_activity_admission_v2(
  (select response#>>'{learningTrack,trackKey}' from destination_admission_results where name = 'main-preview-b'),
  'activity:destination-a',
  45,
  'MEDIUM',
  (select response->>'expectedGrowthPlanVersion' from destination_admission_results where name = 'main-preview-b'),
  (select response->>'expectedLearningTrackVersion' from destination_admission_results where name = 'main-preview-b'),
  'Admit onto the sibling Track.',
  '10000000-0000-4000-8000-000000000001',
  (select response->>'previewDigest' from destination_admission_results where name = 'main-preview-b')
);
select is(
  (select response#>>'{contract,name}' from destination_admission_results where name = 'main-apply-b'),
  'LearningTrackActivityAdmissionApplyResultV2',
  'apply uses the v2 result contract'
);
reset role;
select ok(
  (select aggregate_version from planning.learning_tracks
   where learning_track_id =
     (select (response->>'learningTrackId')::uuid from destination_admission_results where name = 'main-plan')) = 1
  and
  (select aggregate_version from planning.learning_tracks
   where track_key =
     (select response#>>'{createdTrack,trackKey}' from destination_admission_results where name = 'main-track-b')) = 2
  and
  (select aggregate_version from planning.growth_plans
   where growth_plan_id =
     (select (response->>'growthPlanId')::uuid from destination_admission_results where name = 'main-plan')) = 1,
  'apply increments only the selected Track and leaves the sibling Track and Growth Plan semantics untouched'
);
select is(
  (select count(*) from outbox.command_receipts
   where command_type = 'planning.add_learning_track_activity_v3'
     and idempotency_key = 'learning-track-activity-admission:v3:10000000-0000-4000-8000-000000000001'),
  1::bigint,
  'apply writes exactly one v3 command receipt'
);
select is(
  (select count(*) from outbox.events
   where event_name = 'planning.input_changed'
     and payload->>'change_kind' = 'TRACK_ACTIVITY_ADMITTED'
     and aggregate_id = (
       select learning_track_id from planning.learning_tracks
       where track_key =
         (select response#>>'{createdTrack,trackKey}' from destination_admission_results where name = 'main-track-b')
     )),
  1::bigint,
  'apply emits one admission event for the selected Track'
);
select is(
  (select count(*) from outbox.deliveries as delivery
   join outbox.events as event on event.event_id = delivery.event_id
   where delivery.consumer_name = 'planning.plan_snapshot_v1'
     and event.payload->>'change_kind' = 'TRACK_ACTIVITY_ADMITTED'
     and event.aggregate_id = (
       select learning_track_id from planning.learning_tracks
       where track_key =
         (select response#>>'{createdTrack,trackKey}' from destination_admission_results where name = 'main-track-b')
     )),
  1::bigint,
  'apply creates one fixed Planning delivery'
);

do $grant_planning_test_role$
begin
  execute pg_catalog.format('grant pando_planning_api to %I with set true', current_user);
end
$grant_planning_test_role$;
select pg_catalog.set_config('request.jwt.claims', pg_catalog.jsonb_build_object(
  'sub', '46000000-0000-4000-8000-000000000001', 'role', 'authenticated',
  'aud', 'authenticated', 'exp', extract(epoch from pg_catalog.clock_timestamp() + interval '1 hour')::bigint
)::text, true);
set local role pando_planning_api;
select ok(
  exists (select 1 from planning.learning_tracks
          where track_key = (select response#>>'{createdTrack,trackKey}' from destination_admission_results where name = 'main-track-b'))
  and exists (select 1 from planning.learning_track_activities
              where workspace_id = (select (response->>'workspaceId')::uuid from destination_admission_results where name = 'main-plan')),
  'forced RLS permits Planning owner access to the selected Track and attribution in its workspace'
);
select pg_catalog.set_config('request.jwt.claims', pg_catalog.jsonb_build_object(
  'sub', '46000000-0000-4000-8000-000000000005', 'role', 'authenticated',
  'aud', 'authenticated', 'exp', extract(epoch from pg_catalog.clock_timestamp() + interval '1 hour')::bigint
)::text, true);
select is(
  (select count(*) from planning.learning_track_activities
   where workspace_id = (select (response->>'workspaceId')::uuid from destination_admission_results where name = 'main-plan')),
  0::bigint,
  'forced RLS hides selected Track attributions from a foreign actor workspace'
);
reset role;

select pg_catalog.set_config('request.jwt.claims', pg_catalog.jsonb_build_object(
  'sub', '46000000-0000-4000-8000-000000000001', 'role', 'authenticated',
  'aud', 'authenticated', 'exp', extract(epoch from pg_catalog.clock_timestamp() + interval '1 hour')::bigint
)::text, true);
set local role authenticated;
select is(
  api.apply_learning_track_activity_admission_v2(
    (select response#>>'{learningTrack,trackKey}' from destination_admission_results where name = 'main-preview-b'),
    'activity:destination-a',
    45,
    'MEDIUM',
    (select response->>'expectedGrowthPlanVersion' from destination_admission_results where name = 'main-preview-b'),
    (select response->>'expectedLearningTrackVersion' from destination_admission_results where name = 'main-preview-b'),
    'Admit onto the sibling Track.',
    '10000000-0000-4000-8000-000000000001',
    (select response->>'previewDigest' from destination_admission_results where name = 'main-preview-b')
  ),
  (select response from destination_admission_results where name = 'main-apply-b'),
  'identical confirmed retry returns the byte-identical stored v3 response'
);
select throws_ok(
  pg_catalog.format(
    'select api.apply_learning_track_activity_admission_v2(%L,%L,46,%L,%L,%L,%L,%L,%L)',
    (select response#>>'{learningTrack,trackKey}' from destination_admission_results where name = 'main-preview-b'),
    'activity:destination-a', 'MEDIUM',
    (select response->>'expectedGrowthPlanVersion' from destination_admission_results where name = 'main-preview-b'),
    (select response->>'expectedLearningTrackVersion' from destination_admission_results where name = 'main-preview-b'),
    'Admit onto the sibling Track.',
    '10000000-0000-4000-8000-000000000001',
    (select response->>'previewDigest' from destination_admission_results where name = 'main-preview-b')
  ),
  '22023', 'idempotency key reused with a different request',
  'same request UUID cannot be reused with changed v2 admission inputs'
);

insert into destination_admission_results values (
  'main-source-b-after',
  api.get_learning_track_activity_admission_source_v2(
    (select response#>>'{createdTrack,trackKey}' from destination_admission_results where name = 'main-track-b')
  )
);
select ok(
  not exists (
    select 1
    from destination_admission_results,
      lateral pg_catalog.jsonb_array_elements(response->'activities') as activity
    where name = 'main-source-b-after'
      and activity->>'activityKey' = 'activity:destination-a'
  ),
  'source excludes an activity already attributed anywhere in the current Plan even when selecting a different Track'
);

insert into destination_admission_results
select 'main-stale-preview-a', api.preview_learning_track_activity_admission_v2(
    (select response#>>'{selectedTrack,trackKey}' from destination_admission_results where name = 'main-source-a'),
  'activity:destination-b',
  30,
  null,
  (select response#>>'{growthPlan,aggregateVersion}' from destination_admission_results where name = 'main-source-a'),
  (select response#>>'{selectedTrack,aggregateVersion}' from destination_admission_results where name = 'main-source-a'),
  'Prepare a stale sibling-order preview.',
  '10000000-0000-4000-8000-000000000002'
);
reset role;
update planning.learning_tracks
set priority = priority + 1,
    aggregate_version = aggregate_version + 1,
    updated_at = pg_catalog.clock_timestamp()
where track_key =
  (select response#>>'{createdTrack,trackKey}' from destination_admission_results where name = 'main-track-b');
set local role authenticated;
select throws_ok(
  pg_catalog.format(
    'select api.apply_learning_track_activity_admission_v2(%L,%L,30,null,%L,%L,%L,%L,%L)',
    (select response#>>'{learningTrack,trackKey}' from destination_admission_results where name = 'main-stale-preview-a'),
    'activity:destination-b',
    (select response->>'expectedGrowthPlanVersion' from destination_admission_results where name = 'main-stale-preview-a'),
    (select response->>'expectedLearningTrackVersion' from destination_admission_results where name = 'main-stale-preview-a'),
    'Prepare a stale sibling-order preview.',
    '10000000-0000-4000-8000-000000000002',
    (select response->>'previewDigest' from destination_admission_results where name = 'main-stale-preview-a')
  ),
  '40001', 'activity admission preview is stale',
  'a sibling current-track order change invalidates the previously shown destination-aware preview'
);
reset role;
select is(
  (select count(*) from planning.learning_track_activities
   where workspace_id = (select (response->>'workspaceId')::uuid from destination_admission_results where name = 'main-plan')),
  1::bigint,
  'stale sibling-order confirmation leaves no second attribution behind'
);

reset role;
update planning.learning_tracks
set aggregate_version = 9223372036854775807,
    updated_at = pg_catalog.clock_timestamp()
where track_key = (select response->>'learningTrackKey'
                   from destination_admission_results where name = 'main-plan');
set local role authenticated;
select throws_ok(
  pg_catalog.format(
    'select api.preview_learning_track_activity_admission_v2(%L,%L,30,null,%L,%L,%L,%L)',
    (select response->>'learningTrackKey' from destination_admission_results where name = 'main-plan'),
    'activity:destination-b', '1', '9223372036854775807',
    'Version boundary.', '10000000-0000-4000-8000-000000000098'
  ),
  '22003', 'Learning Track version is exhausted',
  'destination-aware preview rejects a Track at the bigint aggregate-version boundary'
);

select set_config('request.jwt.claims', pg_catalog.jsonb_build_object(
  'sub', '46000000-0000-4000-8000-000000000002', 'role', 'authenticated',
  'aud', 'authenticated', 'exp', extract(epoch from pg_catalog.clock_timestamp() + interval '1 hour')::bigint
)::text, true);
set local role authenticated;
insert into destination_admission_results values (
  'empty-bootstrap', api.bootstrap_personal_workspace('destination-admission-empty-v2', 'Destination Admission Empty V2')
);
insert into destination_admission_results
select 'empty-goal', api.create_readiness_goal(
  (select (response->>'workspace_id')::uuid from destination_admission_results where name = 'empty-bootstrap'),
  'goal:destination-empty', 'Destination empty goal',
  'target:nvidia-python-verification-base-v1', 'destination-empty-goal'
);
insert into destination_admission_results values (
  'empty-plan', pg_temp.initialize_growth_plan_fixture_v1(
    'goal:destination-empty', 600, 30, 80, 0, 'destination-empty-plan'
  )
);
reset role;
update planning.learning_tracks
set lifecycle = 'archived',
    aggregate_version = aggregate_version + 1,
    updated_at = pg_catalog.clock_timestamp()
where workspace_id = (select (response->>'workspaceId')::uuid from destination_admission_results where name = 'empty-plan');
set local role authenticated;
insert into destination_admission_results values (
  'empty-source',
  api.get_learning_track_activity_admission_source_v2(
    (select response->>'learningTrackKey' from destination_admission_results where name = 'empty-plan')
  )
);
select is(
  (select response->>'state' from destination_admission_results where name = 'empty-source'),
  'NO_CURRENT_TRACKS',
  'archiving every current Track produces the explicit NO_CURRENT_TRACKS source state'
);

select set_config('request.jwt.claims', pg_catalog.jsonb_build_object(
  'sub', '46000000-0000-4000-8000-000000000003', 'role', 'authenticated',
  'aud', 'authenticated', 'exp', extract(epoch from pg_catalog.clock_timestamp() + interval '1 hour')::bigint
)::text, true);
set local role authenticated;
insert into destination_admission_results values (
  'overflow-bootstrap', api.bootstrap_personal_workspace('destination-admission-overflow-v2', 'Destination Admission Overflow V2')
);
insert into destination_admission_results
select 'overflow-goal', api.create_readiness_goal(
  (select (response->>'workspace_id')::uuid from destination_admission_results where name = 'overflow-bootstrap'),
  'goal:destination-overflow', 'Destination overflow goal',
  'target:nvidia-python-verification-base-v1', 'destination-overflow-goal'
);
insert into destination_admission_results values (
  'overflow-plan', pg_temp.initialize_growth_plan_fixture_v1(
    'goal:destination-overflow', 600, 30, 80, 0, 'destination-overflow-plan'
  )
);
reset role;
insert into planning.learning_tracks (
  learning_track_id, workspace_id, growth_plan_id, track_key, title, readiness_goal_id,
  profile_version_id, roadmap_version_id, lifecycle, priority,
  protected_minimum_minutes, default_session_minutes, aggregate_version
)
select
  pg_catalog.gen_random_uuid(),
  seed.workspace_id,
  seed.growth_plan_id,
  pg_catalog.format('track:overflow-%s', pg_catalog.lpad(series.i::text, 2, '0')),
  pg_catalog.format('Overflow %s', series.i),
  seed.readiness_goal_id,
  seed.profile_version_id,
  null,
  'active',
  50,
  0,
  30,
  1
from (
  select
    (response->>'workspaceId')::uuid as workspace_id,
    (response->>'growthPlanId')::uuid as growth_plan_id,
    (response->>'readinessGoalId')::uuid as readiness_goal_id,
    (response->>'profileVersionId')::uuid as profile_version_id
  from destination_admission_results where name = 'overflow-plan'
) as seed
cross join pg_catalog.generate_series(1, 30) as series(i);
set local role authenticated;
insert into destination_admission_results values (
  'overflow-source',
  api.get_learning_track_activity_admission_source_v2(
    (select response->>'learningTrackKey' from destination_admission_results where name = 'overflow-plan')
  )
);
select is(
  (select response->>'state' from destination_admission_results where name = 'overflow-source'),
  'CURRENT_TRACK_PORTFOLIO_UNAVAILABLE',
  '31 current Tracks produce the explicit portfolio-unavailable source state'
);

select set_config('request.jwt.claims', pg_catalog.jsonb_build_object(
  'sub', '46000000-0000-4000-8000-000000000004', 'role', 'authenticated',
  'aud', 'authenticated', 'exp', extract(epoch from pg_catalog.clock_timestamp() + interval '1 hour')::bigint
)::text, true);
set local role authenticated;
insert into destination_admission_results values (
  'cap-bootstrap', api.bootstrap_personal_workspace('destination-admission-cap-v2', 'Destination Admission Cap V2')
);
insert into destination_admission_results
select 'cap-goal', api.create_readiness_goal(
  (select (response->>'workspace_id')::uuid from destination_admission_results where name = 'cap-bootstrap'),
  'goal:destination-cap', 'Destination cap goal',
  'target:nvidia-python-verification-base-v1', 'destination-cap-goal'
);
insert into destination_admission_results values (
  'cap-plan', pg_temp.initialize_growth_plan_fixture_v1(
    'goal:destination-cap', 600, 30, 80, 0, 'destination-cap-plan'
  )
);
reset role;
create temporary table cap_bulk_activities as
select series.i,
  pg_catalog.gen_random_uuid() as custom_activity_id
from pg_catalog.generate_series(1, 201) as series(i);
insert into overlay.workspace_overlays (workspace_id, aggregate_version)
values (
  (select (response->>'workspaceId')::uuid
   from destination_admission_results where name = 'cap-plan'),
  0
)
on conflict (workspace_id) do nothing;
insert into overlay.custom_activities (
  custom_activity_id, workspace_id, profile_version_id, activity_key, title,
  activity_type, target_competency_ref
)
select bulk.custom_activity_id,
  seed.workspace_id,
  seed.profile_version_id,
  pg_catalog.format('activity:cap-%s', bulk.i),
  pg_catalog.format('Cap %s', bulk.i),
  'READING',
  'competency:python-error-handling'
from cap_bulk_activities as bulk
cross join (
  select
    (response->>'workspaceId')::uuid as workspace_id,
    (response->>'profileVersionId')::uuid as profile_version_id
  from destination_admission_results where name = 'cap-plan'
) as seed;
insert into planning.learning_track_activities (
  workspace_id, growth_plan_id, learning_track_id, custom_activity_id,
  candidate_key, estimated_minutes
)
select
  seed.workspace_id,
  seed.growth_plan_id,
  seed.learning_track_id,
  bulk.custom_activity_id,
  pg_catalog.format('candidate:cap-%s', bulk.i),
  30
from cap_bulk_activities as bulk
cross join (
  select
    (response->>'workspaceId')::uuid as workspace_id,
    (response->>'growthPlanId')::uuid as growth_plan_id,
    (response->>'learningTrackId')::uuid as learning_track_id
  from destination_admission_results where name = 'cap-plan'
) as seed
where bulk.i <= 200;
set local role authenticated;
insert into destination_admission_results values (
  'cap-source',
  api.get_learning_track_activity_admission_source_v2(
    (select response->>'learningTrackKey' from destination_admission_results where name = 'cap-plan')
  )
);
select ok(
  (select response->>'state' from destination_admission_results where name = 'cap-source')
    = 'PLAN_ACTIVITY_LIMIT_REACHED'
  and (select response->'selectedTrack' from destination_admission_results where name = 'cap-source')
    <> 'null'::jsonb,
  'the exact current-plan cap of 200 blocks new admissions while preserving the selected Track context'
);

reset role;
delete from planning.learning_track_activities
where workspace_id = (select (response->>'workspaceId')::uuid from destination_admission_results where name = 'cap-plan');
set local role authenticated;
insert into destination_admission_results values (
  'cap-overflow-source',
  api.get_learning_track_activity_admission_source_v2(
    (select response->>'learningTrackKey' from destination_admission_results where name = 'cap-plan')
  )
);
select is(
  (select response->>'state' from destination_admission_results where name = 'cap-overflow-source'),
  'ELIGIBLE_ACTIVITY_PORTFOLIO_OVERFLOW',
  '201 exact-profile eligible activities block the source before enumeration'
);

reset role;
update overlay.custom_activities
set lifecycle = 'archived'
where workspace_id = (select (response->>'workspaceId')::uuid
                      from destination_admission_results where name = 'cap-plan');
set local role authenticated;
insert into destination_admission_results values (
  'cap-empty-source',
  api.get_learning_track_activity_admission_source_v2(
    (select response->>'learningTrackKey' from destination_admission_results where name = 'cap-plan')
  )
);
select is(
  (select response->>'state' from destination_admission_results where name = 'cap-empty-source'),
  'NO_ELIGIBLE_ACTIVITIES',
  'a valid selected Track with no eligible activities reports the explicit empty state'
);

reset role;
update overlay.custom_activities
set lifecycle = 'active'
where workspace_id = (select (response->>'workspaceId')::uuid
                      from destination_admission_results where name = 'cap-plan')
  and activity_key = 'activity:cap-201';
set local role authenticated;
insert into destination_admission_results values (
  'cap-preview',
  api.preview_learning_track_activity_admission_v2(
    (select response->>'learningTrackKey' from destination_admission_results where name = 'cap-plan'),
    'activity:cap-201',
    30,
    null,
    (select response#>>'{growthPlan,aggregateVersion}' from destination_admission_results where name = 'cap-overflow-source'),
    (select response#>>'{selectedTrack,aggregateVersion}' from destination_admission_results where name = 'cap-overflow-source'),
    'Prepare rollback proof.',
    '10000000-0000-4000-8000-000000000004'
  )
);
reset role;
set local role postgres;

create temporary table admission_rollback_baseline as
select
  (select aggregate_version from planning.learning_tracks
   where learning_track_id =
     (select (response->>'learningTrackId')::uuid from destination_admission_results where name = 'cap-plan'))
    as track_version,
  (select count(*) from outbox.events
   where aggregate_id =
     (select (response->>'learningTrackId')::uuid from destination_admission_results where name = 'cap-plan')
     and event_name = 'planning.input_changed') as event_count,
  (select count(*) from outbox.deliveries as delivery
   join outbox.events as event on event.event_id = delivery.event_id
   where event.aggregate_id =
     (select (response->>'learningTrackId')::uuid from destination_admission_results where name = 'cap-plan')
     and delivery.consumer_name = 'planning.plan_snapshot_v1') as delivery_count;

create function public.fail_destination_admission_event_for_test()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.event_name = 'planning.input_changed'
     and new.workspace_id::text = pg_catalog.current_setting(
       'pando.test.fail_destination_admission_workspace', true
     ) then
    raise exception using errcode = 'P0001', message = 'injected destination admission outbox failure';
  end if;
  return new;
end
$function$;
create trigger fail_destination_admission_event_for_test
before insert on outbox.events
for each row execute function public.fail_destination_admission_event_for_test();
select set_config(
  'pando.test.fail_destination_admission_workspace',
  (select response->>'workspaceId' from destination_admission_results where name = 'cap-plan'),
  true
);
set local role authenticated;
select throws_ok(
  pg_catalog.format(
    'select api.apply_learning_track_activity_admission_v2(%L,%L,30,null,%L,%L,%L,%L,%L)',
    (select response#>>'{learningTrack,trackKey}' from destination_admission_results where name = 'cap-preview'),
    'activity:cap-201',
    (select response->>'expectedGrowthPlanVersion' from destination_admission_results where name = 'cap-preview'),
    (select response->>'expectedLearningTrackVersion' from destination_admission_results where name = 'cap-preview'),
    'Prepare rollback proof.',
    '10000000-0000-4000-8000-000000000004',
    (select response->>'previewDigest' from destination_admission_results where name = 'cap-preview')
  ),
  'P0001', 'injected destination admission outbox failure',
  'an injected outbox failure aborts the entire destination-aware admission'
);
reset role;
set local role postgres;
drop trigger fail_destination_admission_event_for_test on outbox.events;
drop function public.fail_destination_admission_event_for_test();
select ok(
  (select aggregate_version from planning.learning_tracks
   where learning_track_id =
     (select (response->>'learningTrackId')::uuid from destination_admission_results where name = 'cap-plan')) =
    (select track_version from admission_rollback_baseline)
  and not exists (
    select 1 from planning.learning_track_activities
    where candidate_key = 'candidate:10000000-0000-4000-8000-000000000004'
  )
  and not exists (
    select 1 from outbox.command_receipts
    where idempotency_key =
      'learning-track-activity-admission:v3:10000000-0000-4000-8000-000000000004'
  ),
  'outbox failure rolls back the selected Track, attribution, and v3 receipt together'
);
select ok(
  (select count(*) from outbox.events
   where aggregate_id =
     (select (response->>'learningTrackId')::uuid from destination_admission_results where name = 'cap-plan')
     and event_name = 'planning.input_changed') =
    (select event_count from admission_rollback_baseline)
  and (select count(*) from outbox.deliveries as delivery
   join outbox.events as event on event.event_id = delivery.event_id
   where event.aggregate_id =
     (select (response->>'learningTrackId')::uuid from destination_admission_results where name = 'cap-plan')
     and delivery.consumer_name = 'planning.plan_snapshot_v1') =
    (select delivery_count from admission_rollback_baseline),
  'outbox failure leaves no event or fixed Planning delivery behind'
);

select * from finish();
rollback;
