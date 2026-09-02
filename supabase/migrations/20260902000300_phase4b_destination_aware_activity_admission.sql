-- Phase 4B: destination-aware exact-preview admission of one accepted personal activity.

do $migration_role_membership$
begin
  execute pg_catalog.format('grant pando_planning_api to %I with set true', current_user);
end
$migration_role_membership$;

grant create on schema planning, api to pando_planning_api;

create function api.get_learning_track_activity_admission_source_v2(
  p_track_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_workspace_id uuid;
  v_plan planning.growth_plans%rowtype;
  v_track planning.learning_tracks%rowtype;
  v_current_track_count integer;
  v_non_archived_count integer;
  v_excluded_ids uuid[] := array[]::uuid[];
  v_choices jsonb;
  v_eligible_count integer;
  v_state text;
  v_public_activities jsonb := '[]'::jsonb;
begin
  if identity.jwt_subject() is null then
    raise exception using errcode = '28000', message = 'an authenticated user is required';
  end if;
  v_workspace_id := identity.personal_workspace_id_for_current_user();
  if v_workspace_id is null then
    raise exception using errcode = '28000', message = 'authenticated user is not provisioned';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('planning-workspace:' || v_workspace_id::text, 0)
  );

  select plan.* into v_plan
  from planning.growth_plans as plan
  where plan.workspace_id = v_workspace_id
    and plan.lifecycle in ('active', 'paused')
  for update;
  if not found then
    return pg_catalog.jsonb_build_object(
      'contract', pg_catalog.jsonb_build_object(
        'name', 'LearningTrackActivityAdmissionSourceV2', 'version', '2.0.0'
      ),
      'state', 'NO_CURRENT_PLAN',
      'capabilities', '[]'::jsonb,
      'growthPlan', null,
      'selectedTrack', null,
      'activities', '[]'::jsonb
    );
  end if;

  perform track.learning_track_id
  from planning.learning_tracks as track
  where track.workspace_id = v_workspace_id
    and track.growth_plan_id = v_plan.growth_plan_id
  order by track.learning_track_id
  for update;

  select pg_catalog.count(*)::integer into v_current_track_count
  from planning.learning_tracks as track
  where track.workspace_id = v_workspace_id
    and track.growth_plan_id = v_plan.growth_plan_id
    and track.lifecycle in ('active', 'paused');

  if v_current_track_count = 0 then
    v_state := 'NO_CURRENT_TRACKS';
  elsif v_current_track_count > 30 then
    v_state := 'CURRENT_TRACK_PORTFOLIO_UNAVAILABLE';
  else
    select track.* into v_track
    from planning.learning_tracks as track
    where track.workspace_id = v_workspace_id
      and track.growth_plan_id = v_plan.growth_plan_id
      and track.lifecycle in ('active', 'paused')
      and track.track_key = p_track_key;

    if not found then
      v_state := 'SELECTED_TRACK_UNAVAILABLE';
    else
      select pg_catalog.count(*)::integer into v_non_archived_count
      from planning.learning_track_activities as attribution
      where attribution.workspace_id = v_workspace_id
        and attribution.growth_plan_id = v_plan.growth_plan_id
        and attribution.lifecycle <> 'archived';

      select coalesce(pg_catalog.array_agg(attribution.custom_activity_id), array[]::uuid[])
      into v_excluded_ids
      from planning.learning_track_activities as attribution
      where attribution.workspace_id = v_workspace_id
        and attribution.growth_plan_id = v_plan.growth_plan_id;

      if v_non_archived_count >= 200 then
        v_state := 'PLAN_ACTIVITY_LIMIT_REACHED';
      else
        v_choices := overlay.get_planning_activity_admission_choices_v1(
          v_workspace_id,
          v_track.profile_version_id,
          v_excluded_ids
        );
        if v_choices#>>'{contract,name}' <> 'PlanningActivityAdmissionChoicesV1'
           or v_choices#>>'{contract,version}' <> '1.0.0' then
          raise exception using errcode = '55000',
            message = 'Overlay admission choices contract is invalid';
        end if;

        v_eligible_count := (v_choices->>'eligibleActivityCount')::integer;
        if v_eligible_count > 200 then
          v_state := 'ELIGIBLE_ACTIVITY_PORTFOLIO_OVERFLOW';
        elsif v_eligible_count = 0 then
          v_state := 'NO_ELIGIBLE_ACTIVITIES';
        else
          v_state := 'READY';
          select coalesce(
            pg_catalog.jsonb_agg(
              pg_catalog.jsonb_build_object(
                'activityKey', choice->>'activityKey',
                'title', choice->>'title',
                'activityType', choice->>'activityType',
                'targetCompetencyRef', choice->>'targetCompetencyRef'
              )
              order by choice->>'activityKey' collate "C"
            ),
            '[]'::jsonb
          ) into v_public_activities
          from pg_catalog.jsonb_array_elements(v_choices->'activities') as choice;
        end if;
      end if;
    end if;
  end if;

  return pg_catalog.jsonb_build_object(
    'contract', pg_catalog.jsonb_build_object(
      'name', 'LearningTrackActivityAdmissionSourceV2', 'version', '2.0.0'
    ),
    'state', v_state,
    'capabilities', case
      when v_state = 'READY'
        then pg_catalog.jsonb_build_array('admit_activity_to_learning_track')
      else '[]'::jsonb
    end,
    'growthPlan', pg_catalog.jsonb_build_object(
      'title', v_plan.title,
      'lifecycle', pg_catalog.upper(v_plan.lifecycle),
      'weeklyCapacityMinutes', v_plan.weekly_capacity_minutes,
      'aggregateVersion', v_plan.aggregate_version::text
    ),
    'selectedTrack', case
      when v_state in (
        'READY',
        'NO_ELIGIBLE_ACTIVITIES',
        'PLAN_ACTIVITY_LIMIT_REACHED',
        'ELIGIBLE_ACTIVITY_PORTFOLIO_OVERFLOW'
      ) then pg_catalog.jsonb_build_object(
        'trackKey', v_track.track_key,
        'title', v_track.title,
        'lifecycle', pg_catalog.upper(v_track.lifecycle),
        'priority', v_track.priority,
        'protectedMinimumMinutes', v_track.protected_minimum_minutes,
        'defaultSessionMinutes', v_track.default_session_minutes,
        'aggregateVersion', v_track.aggregate_version::text
      )
      else null
    end,
    'activities', case when v_state = 'READY' then v_public_activities else '[]'::jsonb end
  );
end
$function$;

create function planning.build_learning_track_activity_admission_preview_v2(
  p_workspace_id uuid,
  p_track_key text,
  p_activity_key text,
  p_estimated_minutes integer,
  p_energy text,
  p_expected_growth_plan_version bigint,
  p_expected_learning_track_version bigint,
  p_reason text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_plan planning.growth_plans%rowtype;
  v_track planning.learning_tracks%rowtype;
  v_goal_source jsonb;
  v_activity_source jsonb;
  v_custom_activity_id uuid;
  v_count integer;
  v_can_apply boolean;
  v_blocker text;
  v_warning_codes text[] := array[]::text[];
  v_warnings jsonb := '[]'::jsonb;
  v_candidate_key text := 'candidate:' || pg_catalog.lower(p_request_id::text);
  v_current_order jsonb;
  v_names text[];
  v_values text[];
  v_digest_input text;
  v_digest text;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('planning-workspace:' || p_workspace_id::text, 0)
  );

  select plan.* into v_plan
  from planning.growth_plans as plan
  where plan.workspace_id = p_workspace_id
    and plan.lifecycle in ('active', 'paused')
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'activity admission target is unavailable';
  end if;

  perform track.learning_track_id
  from planning.learning_tracks as track
  where track.workspace_id = p_workspace_id
    and track.growth_plan_id = v_plan.growth_plan_id
  order by track.learning_track_id
  for update;

  select track.* into v_track
  from planning.learning_tracks as track
  where track.workspace_id = p_workspace_id
    and track.growth_plan_id = v_plan.growth_plan_id
    and track.lifecycle in ('active', 'paused')
    and track.track_key = p_track_key;
  if not found then
    raise exception using errcode = '42501', message = 'activity admission target is unavailable';
  end if;

  v_current_order := planning.projected_current_track_order_v1(
    p_workspace_id,
    v_plan.growth_plan_id,
    v_track.learning_track_id,
    v_track.priority,
    v_track.aggregate_version
  );
  if (v_current_order->>'currentTrackCount')::integer not between 1 and 30
     or (v_current_order->>'targetPosition') is null then
    raise exception using errcode = '55000',
      message = 'Learning Track portfolio invariant is violated';
  end if;

  if v_plan.aggregate_version <> p_expected_growth_plan_version
     or v_track.aggregate_version <> p_expected_learning_track_version then
    raise exception using errcode = '40001', message = 'activity admission preview is stale';
  end if;
  if v_track.aggregate_version = 9223372036854775807 then
    raise exception using errcode = '22003', message = 'Learning Track version is exhausted';
  end if;

  v_goal_source := targets.get_planning_track_goal_admission_source_v1(
    p_workspace_id, v_track.readiness_goal_id, v_track.profile_version_id
  );
  if v_goal_source#>>'{contract,name}' <> 'PlanningTrackGoalAdmissionSourceV1'
     or v_goal_source#>>'{contract,version}' <> '1.0.0'
     or (v_goal_source#>>'{readinessGoal,readinessGoalId}')::uuid <> v_track.readiness_goal_id
     or (v_goal_source#>>'{readinessGoal,profileVersionId}')::uuid <> v_track.profile_version_id
     or v_goal_source#>>'{readinessGoal,lifecycle}' <> 'ACTIVE' then
    raise exception using errcode = '55000', message = 'Targets admission source contract is invalid';
  end if;

  v_activity_source := overlay.get_planning_activity_admission_source_v2(
    p_workspace_id, v_track.profile_version_id, p_activity_key
  );
  if v_activity_source#>>'{contract,name}' <> 'PlanningActivityAdmissionSourceV2'
     or v_activity_source#>>'{contract,version}' <> '2.0.0'
     or v_activity_source#>>'{customActivity,activityKey}' <> p_activity_key
     or (v_activity_source#>>'{customActivity,profileVersionId}')::uuid
       <> v_track.profile_version_id
     or v_activity_source#>>'{customActivity,lifecycle}' <> 'ACTIVE'
     or v_activity_source#>>'{customActivity,mappingStatus}' <> 'ACCEPTED' then
    raise exception using errcode = '55000', message = 'Overlay admission source contract is invalid';
  end if;

  v_custom_activity_id := (v_activity_source#>>'{customActivity,customActivityId}')::uuid;
  if exists (
    select 1
    from planning.learning_track_activities as attribution
    where attribution.workspace_id = p_workspace_id
      and attribution.growth_plan_id = v_plan.growth_plan_id
      and attribution.custom_activity_id = v_custom_activity_id
  ) then
    raise exception using errcode = '42501', message = 'activity admission source is unavailable';
  end if;

  select pg_catalog.count(*)::integer into v_count
  from planning.learning_track_activities as attribution
  where attribution.workspace_id = p_workspace_id
    and attribution.growth_plan_id = v_plan.growth_plan_id
    and attribution.lifecycle <> 'archived';
  if v_count > 200 then
    raise exception using errcode = '55000', message = 'Growth Plan activity count is invalid';
  end if;

  v_can_apply := v_count < 200;
  v_blocker := case when v_can_apply then null else 'PLAN_ACTIVITY_LIMIT_REACHED' end;

  if v_plan.lifecycle = 'paused' then
    v_warning_codes := pg_catalog.array_append(v_warning_codes, 'PARENT_GROWTH_PLAN_PAUSED');
  end if;
  if v_track.lifecycle = 'paused' then
    v_warning_codes := pg_catalog.array_append(v_warning_codes, 'LEARNING_TRACK_PAUSED');
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object('code', warning)
      order by item.position
    ),
    '[]'::jsonb
  ) into v_warnings
  from pg_catalog.unnest(v_warning_codes) with ordinality as item(warning, position);

  v_names := array[
    'digestVersion','contractVersion','workspaceId','operation','commandType','requestId','reason',
    'expectedGrowthPlanVersion','expectedLearningTrackVersion','growthPlanId','growthPlanTitle',
    'growthPlanLifecycle','growthPlanWeeklyCapacityMinutes','growthPlanAggregateVersion',
    'learningTrackId','trackKey','learningTrackTitle','learningTrackLifecycle',
    'learningTrackPriority','learningTrackProtectedMinimumMinutes',
    'learningTrackDefaultSessionMinutes','learningTrackVersionBefore',
    'learningTrackVersionAfter','readinessGoalId','profileVersionId','targetsOwnerRevision',
    'customActivityId','activityKey','activityTitle','activityType','targetCompetencyRef',
    'activityLifecycle','activityMappingStatus','overlayOwnerRevision','candidateKey',
    'estimatedMinutes','energy','planActivityCountBefore','planActivityCountAfter',
    'planActivityLimit','currentTrackOrderFingerprint','canApply','blockingReasonCode',
    'warningCount'
  ];
  v_values := array[
    'learning-track-activity-admission-preview-digest/2.0.0',
    '2.0.0',
    pg_catalog.lower(p_workspace_id::text),
    'admit_activity_to_learning_track',
    'planning.add_learning_track_activity_v3',
    pg_catalog.lower(p_request_id::text),
    p_reason,
    p_expected_growth_plan_version::text,
    p_expected_learning_track_version::text,
    pg_catalog.lower(v_plan.growth_plan_id::text),
    v_plan.title,
    pg_catalog.upper(v_plan.lifecycle),
    v_plan.weekly_capacity_minutes::text,
    v_plan.aggregate_version::text,
    pg_catalog.lower(v_track.learning_track_id::text),
    v_track.track_key,
    v_track.title,
    pg_catalog.upper(v_track.lifecycle),
    v_track.priority::text,
    v_track.protected_minimum_minutes::text,
    v_track.default_session_minutes::text,
    v_track.aggregate_version::text,
    (v_track.aggregate_version + 1)::text,
    pg_catalog.lower(v_track.readiness_goal_id::text),
    pg_catalog.lower(v_track.profile_version_id::text),
    v_goal_source->>'ownerRevision',
    pg_catalog.lower(v_custom_activity_id::text),
    p_activity_key,
    v_activity_source#>>'{customActivity,title}',
    v_activity_source#>>'{customActivity,activityType}',
    v_activity_source#>>'{customActivity,targetCompetencyRef}',
    'ACTIVE',
    'ACCEPTED',
    v_activity_source->>'ownerRevision',
    v_candidate_key,
    p_estimated_minutes::text,
    coalesce(p_energy, ''),
    v_count::text,
    (v_count + 1)::text,
    '200',
    pg_catalog.lower(v_current_order->>'currentTrackOrderFingerprint'),
    pg_catalog.lower(v_can_apply::text),
    coalesce(v_blocker, ''),
    pg_catalog.cardinality(v_warning_codes)::text
  ];

  if pg_catalog.cardinality(v_warning_codes) > 0 then
    for i in 1..pg_catalog.cardinality(v_warning_codes) loop
      v_names := pg_catalog.array_append(v_names, 'warningCode');
      v_values := pg_catalog.array_append(v_values, v_warning_codes[i]);
    end loop;
  end if;

  v_names := v_names || array[
    'retainedActivitiesAndEvidence','retainedPlanSnapshots','retainedFocusSessions',
    'retainedMasteryAndReadiness','projectionStateAfterApply','eventChangeKind','consumerName'
  ];
  v_values := v_values || array[
    'true','true','true','true','PENDING','TRACK_ACTIVITY_ADMITTED','planning.plan_snapshot_v1'
  ];

  v_digest_input := planning.frame_named_fields_v1(v_names, v_values);
  v_digest := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(v_digest_input, 'UTF8'), 'sha256'),
    'hex'
  );

  return pg_catalog.jsonb_build_object(
    'contract', pg_catalog.jsonb_build_object(
      'name', 'LearningTrackActivityAdmissionPreviewV2', 'version', '2.0.0'
    ),
    'digestVersion', 'learning-track-activity-admission-preview-digest/2.0.0',
    'operation', 'admit_activity_to_learning_track',
    'commandType', 'planning.add_learning_track_activity_v3',
    'requestId', p_request_id,
    'reason', p_reason,
    'expectedGrowthPlanVersion', p_expected_growth_plan_version::text,
    'expectedLearningTrackVersion', p_expected_learning_track_version::text,
    'growthPlan', pg_catalog.jsonb_build_object(
      'title', v_plan.title,
      'lifecycle', pg_catalog.upper(v_plan.lifecycle),
      'weeklyCapacityMinutes', v_plan.weekly_capacity_minutes,
      'aggregateVersion', v_plan.aggregate_version::text
    ),
    'learningTrack', pg_catalog.jsonb_build_object(
      'trackKey', v_track.track_key,
      'title', v_track.title,
      'lifecycle', pg_catalog.upper(v_track.lifecycle),
      'priority', v_track.priority,
      'protectedMinimumMinutes', v_track.protected_minimum_minutes,
      'defaultSessionMinutes', v_track.default_session_minutes,
      'aggregateVersionBefore', v_track.aggregate_version::text,
      'aggregateVersionAfter', (v_track.aggregate_version + 1)::text
    ),
    'activity', pg_catalog.jsonb_build_object(
      'activityKey', p_activity_key,
      'title', v_activity_source#>>'{customActivity,title}',
      'activityType', v_activity_source#>>'{customActivity,activityType}',
      'targetCompetencyRef', v_activity_source#>>'{customActivity,targetCompetencyRef}',
      'candidateKey', v_candidate_key,
      'estimatedMinutes', p_estimated_minutes,
      'energy', p_energy
    ),
    'constraint', pg_catalog.jsonb_build_object(
      'planActivityCountBefore', v_count,
      'planActivityCountAfter', v_count + 1,
      'planActivityLimit', 200,
      'currentTrackOrderFingerprint', v_current_order->>'currentTrackOrderFingerprint'
    ),
    'canApply', v_can_apply,
    'blockingReasons', case
      when v_blocker is null then '[]'::jsonb
      else pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('code', v_blocker))
    end,
    'warnings', v_warnings,
    'retained', pg_catalog.jsonb_build_object(
      'activitiesAndEvidence', true,
      'planSnapshots', true,
      'focusSessions', true,
      'masteryAndReadiness', true
    ),
    'recalculationAfterApply', pg_catalog.jsonb_build_object(
      'projectionState', 'PENDING',
      'eventChangeKind', 'TRACK_ACTIVITY_ADMITTED',
      'consumerName', 'planning.plan_snapshot_v1'
    ),
    'previewDigest', v_digest,
    'internal', pg_catalog.jsonb_build_object(
      'growthPlanId', v_plan.growth_plan_id,
      'learningTrackId', v_track.learning_track_id,
      'readinessGoalId', v_track.readiness_goal_id,
      'profileVersionId', v_track.profile_version_id,
      'customActivityId', v_custom_activity_id
    )
  );
end
$function$;

create function api.preview_learning_track_activity_admission_v2(
  p_track_key text,
  p_activity_key text,
  p_estimated_minutes integer,
  p_energy text,
  p_expected_growth_plan_version text,
  p_expected_learning_track_version text,
  p_reason text,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_workspace_id uuid;
  v_preview jsonb;
begin
  if identity.jwt_subject() is null then
    raise exception using errcode = '28000', message = 'an authenticated user is required';
  end if;
  v_workspace_id := identity.personal_workspace_id_for_current_user();
  if v_workspace_id is null then
    raise exception using errcode = '28000', message = 'authenticated user is not provisioned';
  end if;
  if p_track_key is null or p_track_key !~ '^track:[a-z0-9][a-z0-9-]{1,100}$'
     or p_activity_key is null or p_activity_key !~ '^activity:[a-z0-9][a-z0-9-]{1,100}$'
     or p_estimated_minutes is null or p_estimated_minutes not between 1 and 480
     or (p_energy is not null and p_energy not in ('LOW', 'MEDIUM', 'HIGH'))
     or p_expected_growth_plan_version is null
     or p_expected_growth_plan_version !~ '^[1-9][0-9]{0,18}$'
     or p_expected_growth_plan_version::numeric > 9223372036854775807
     or p_expected_learning_track_version is null
     or p_expected_learning_track_version !~ '^[1-9][0-9]{0,18}$'
     or p_expected_learning_track_version::numeric > 9223372036854775807
     or p_reason is null or p_reason <> pg_catalog.btrim(p_reason)
     or pg_catalog.char_length(p_reason) not between 1 and 500
     or p_reason ~ '[[:cntrl:]]'
     or p_request_id is null
     or p_request_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception using errcode = '22023', message = 'activity admission preview request is invalid';
  end if;

  v_preview := planning.build_learning_track_activity_admission_preview_v2(
    v_workspace_id,
    p_track_key,
    p_activity_key,
    p_estimated_minutes,
    p_energy,
    p_expected_growth_plan_version::bigint,
    p_expected_learning_track_version::bigint,
    p_reason,
    p_request_id::uuid
  );

  return v_preview - 'internal';
end
$function$;

create function api.apply_learning_track_activity_admission_v2(
  p_track_key text,
  p_activity_key text,
  p_estimated_minutes integer,
  p_energy text,
  p_expected_growth_plan_version text,
  p_expected_learning_track_version text,
  p_reason text,
  p_request_id text,
  p_preview_digest text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_user_id uuid;
  v_workspace_id uuid;
  v_idempotency_key text;
  v_request_hash bytea;
  v_receipt outbox.command_receipts%rowtype;
  v_preview jsonb;
  v_plan_id uuid;
  v_track_id uuid;
  v_custom_activity_id uuid;
  v_candidate_key text;
  v_command_id uuid := gen_random_uuid();
  v_correlation_id uuid := gen_random_uuid();
  v_event_id uuid := gen_random_uuid();
  v_delivery_id uuid := gen_random_uuid();
  v_response jsonb;
  v_affected_rows integer;
begin
  if identity.jwt_subject() is null then
    raise exception using errcode = '28000', message = 'an authenticated user is required';
  end if;
  v_actor_user_id := identity.current_user_id();
  v_workspace_id := identity.personal_workspace_id_for_current_user();
  if v_actor_user_id is null or v_workspace_id is null then
    raise exception using errcode = '28000', message = 'authenticated user is not provisioned';
  end if;
  if p_track_key is null or p_track_key !~ '^track:[a-z0-9][a-z0-9-]{1,100}$'
     or p_activity_key is null or p_activity_key !~ '^activity:[a-z0-9][a-z0-9-]{1,100}$'
     or p_estimated_minutes is null or p_estimated_minutes not between 1 and 480
     or (p_energy is not null and p_energy not in ('LOW', 'MEDIUM', 'HIGH'))
     or p_expected_growth_plan_version is null
     or p_expected_growth_plan_version !~ '^[1-9][0-9]{0,18}$'
     or p_expected_growth_plan_version::numeric > 9223372036854775807
     or p_expected_learning_track_version is null
     or p_expected_learning_track_version !~ '^[1-9][0-9]{0,18}$'
     or p_expected_learning_track_version::numeric > 9223372036854775807
     or p_reason is null or p_reason <> pg_catalog.btrim(p_reason)
     or pg_catalog.char_length(p_reason) not between 1 and 500
     or p_reason ~ '[[:cntrl:]]'
     or p_request_id is null
     or p_request_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or p_preview_digest is null or p_preview_digest !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'activity admission confirmation is invalid';
  end if;

  v_idempotency_key := 'learning-track-activity-admission:v3:' || p_request_id;
  v_request_hash := extensions.digest(
    pg_catalog.convert_to(
      planning.frame_named_fields_v1(
        array[
          'requestHashVersion','commandType','workspaceId','requestId','trackKey','activityKey',
          'estimatedMinutes','energy','expectedGrowthPlanVersion',
          'expectedLearningTrackVersion','reason','previewDigest'
        ],
        array[
          'learning-track-activity-admission-request-hash/2.0.0',
          'planning.add_learning_track_activity_v3',
          pg_catalog.lower(v_workspace_id::text),
          p_request_id,
          p_track_key,
          p_activity_key,
          p_estimated_minutes::text,
          coalesce(p_energy, ''),
          p_expected_growth_plan_version,
          p_expected_learning_track_version,
          p_reason,
          p_preview_digest
        ]
      ),
      'UTF8'
    ),
    'sha256'
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_actor_user_id::text || ':planning.add_learning_track_activity_v3:' || v_idempotency_key,
      0
    )
  );

  select receipt.* into v_receipt
  from outbox.command_receipts as receipt
  where receipt.actor_user_id = v_actor_user_id
    and receipt.command_type = 'planning.add_learning_track_activity_v3'
    and receipt.idempotency_key = v_idempotency_key
  for update;
  if found then
    if v_receipt.request_hash <> v_request_hash then
      raise exception using errcode = '22023', message = 'idempotency key reused with a different request';
    end if;
    if v_receipt.command_status <> 'completed' then
      raise exception using errcode = '40001', message = 'command receipt is not complete';
    end if;
    return v_receipt.response;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('planning-workspace:' || v_workspace_id::text, 0)
  );

  v_preview := planning.build_learning_track_activity_admission_preview_v2(
    v_workspace_id,
    p_track_key,
    p_activity_key,
    p_estimated_minutes,
    p_energy,
    p_expected_growth_plan_version::bigint,
    p_expected_learning_track_version::bigint,
    p_reason,
    p_request_id::uuid
  );
  if (v_preview->>'canApply')::boolean is not true
     or v_preview->>'previewDigest' is distinct from p_preview_digest then
    raise exception using errcode = '40001', message = 'activity admission preview is stale';
  end if;

  v_plan_id := (v_preview#>>'{internal,growthPlanId}')::uuid;
  v_track_id := (v_preview#>>'{internal,learningTrackId}')::uuid;
  v_custom_activity_id := (v_preview#>>'{internal,customActivityId}')::uuid;
  v_candidate_key := v_preview#>>'{activity,candidateKey}';

  insert into outbox.command_receipts (
    command_id, command_type, command_schema_version, workspace_id, actor_user_id,
    idempotency_key, request_hash, correlation_id, expected_aggregate_version
  ) values (
    v_command_id,
    'planning.add_learning_track_activity_v3',
    2,
    v_workspace_id,
    v_actor_user_id,
    v_idempotency_key,
    v_request_hash,
    v_correlation_id,
    p_expected_learning_track_version::bigint
  );
  get diagnostics v_affected_rows = row_count;
  if v_affected_rows <> 1 then
    raise exception using errcode = '55000', message = 'activity admission receipt insert failed';
  end if;

  insert into planning.learning_track_activities (
    workspace_id, growth_plan_id, learning_track_id, custom_activity_id,
    candidate_key, estimated_minutes, energy
  ) values (
    v_workspace_id, v_plan_id, v_track_id, v_custom_activity_id,
    v_candidate_key, p_estimated_minutes, p_energy
  );
  get diagnostics v_affected_rows = row_count;
  if v_affected_rows <> 1 then
    raise exception using errcode = '55000', message = 'activity admission attribution insert failed';
  end if;

  update planning.learning_tracks
  set aggregate_version = aggregate_version + 1,
      updated_at = pg_catalog.clock_timestamp()
  where workspace_id = v_workspace_id
    and growth_plan_id = v_plan_id
    and learning_track_id = v_track_id
    and aggregate_version = p_expected_learning_track_version::bigint;
  get diagnostics v_affected_rows = row_count;
  if v_affected_rows <> 1 then
    raise exception using errcode = '40001', message = 'Learning Track aggregate version conflict';
  end if;

  insert into outbox.events (
    event_id, event_name, event_schema_version, workspace_id, aggregate_type,
    aggregate_id, aggregate_version, actor_type, actor_user_id, command_id,
    correlation_id, occurred_at, source, payload
  ) values (
    v_event_id,
    'planning.input_changed',
    1,
    v_workspace_id,
    'planning.learning_track',
    v_track_id,
    p_expected_learning_track_version::bigint + 1,
    'user',
    v_actor_user_id,
    v_command_id,
    v_correlation_id,
    pg_catalog.clock_timestamp(),
    'pando.database',
    pg_catalog.jsonb_build_object(
      'change_kind', 'TRACK_ACTIVITY_ADMITTED',
      'growth_plan_id', v_plan_id,
      'learning_track_id', v_track_id,
      'learning_track_version', (p_expected_learning_track_version::bigint + 1)::text,
      'custom_activity_id', v_custom_activity_id,
      'candidate_key', v_candidate_key
    )
  );
  get diagnostics v_affected_rows = row_count;
  if v_affected_rows <> 1 then
    raise exception using errcode = '55000', message = 'activity admission event insert failed';
  end if;

  insert into outbox.deliveries (
    delivery_id, event_id, workspace_id, consumer_name, handler_contract_version
  ) values (
    v_delivery_id, v_event_id, v_workspace_id, 'planning.plan_snapshot_v1', 1
  );
  get diagnostics v_affected_rows = row_count;
  if v_affected_rows <> 1 then
    raise exception using errcode = '55000', message = 'activity admission delivery insert failed';
  end if;

  v_response := pg_catalog.jsonb_build_object(
    'contract', pg_catalog.jsonb_build_object(
      'name', 'LearningTrackActivityAdmissionApplyResultV2', 'version', '2.0.0'
    ),
    'commandId', v_command_id,
    'changedTrack', pg_catalog.jsonb_build_object(
      'trackKey', v_preview#>>'{learningTrack,trackKey}',
      'aggregateVersion', (p_expected_learning_track_version::bigint + 1)::text
    ),
    'admittedActivity', pg_catalog.jsonb_build_object(
      'activityKey', p_activity_key,
      'candidateKey', v_candidate_key,
      'estimatedMinutes', p_estimated_minutes,
      'energy', p_energy
    ),
    'projectionState', 'PENDING',
    'planningDeliveryId', v_delivery_id,
    'emittedEventIds', pg_catalog.jsonb_build_array(v_event_id)
  );

  update outbox.command_receipts
  set command_status = 'completed',
      response = v_response,
      emitted_event_ids = array[v_event_id],
      completed_at = pg_catalog.clock_timestamp()
  where command_id = v_command_id;
  get diagnostics v_affected_rows = row_count;
  if v_affected_rows <> 1 then
    raise exception using errcode = '55000', message = 'activity admission receipt completion failed';
  end if;

  return v_response;
end
$function$;

alter function api.get_learning_track_activity_admission_source_v2(text)
  owner to pando_planning_api;
alter function planning.build_learning_track_activity_admission_preview_v2(
  uuid, text, text, integer, text, bigint, bigint, text, uuid
) owner to pando_planning_api;
alter function api.preview_learning_track_activity_admission_v2(
  text, text, integer, text, text, text, text, text
) owner to pando_planning_api;
alter function api.apply_learning_track_activity_admission_v2(
  text, text, integer, text, text, text, text, text, text
) owner to pando_planning_api;

revoke all on function
  api.get_learning_track_activity_admission_source_v2(text),
  planning.build_learning_track_activity_admission_preview_v2(
    uuid, text, text, integer, text, bigint, bigint, text, uuid
  ),
  api.preview_learning_track_activity_admission_v2(
    text, text, integer, text, text, text, text, text
  ),
  api.apply_learning_track_activity_admission_v2(
    text, text, integer, text, text, text, text, text, text
  )
from public, anon, authenticated, service_role;

grant execute on function
  api.get_learning_track_activity_admission_source_v2(text),
  api.preview_learning_track_activity_admission_v2(
    text, text, integer, text, text, text, text, text
  ),
  api.apply_learning_track_activity_admission_v2(
    text, text, integer, text, text, text, text, text, text
  )
to authenticated;

revoke create on schema planning, api from pando_planning_api;

do $migration_role_membership$
begin
  execute pg_catalog.format('revoke pando_planning_api from %I', current_user);
end
$migration_role_membership$;
