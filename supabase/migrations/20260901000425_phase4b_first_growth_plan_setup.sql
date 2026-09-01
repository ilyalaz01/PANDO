-- Phase 4B D1b: preview-confirmed first Growth Plan setup.

do $migration_role_membership$
begin
  execute pg_catalog.format(
    'grant pando_phase1_api, pando_planning_api to %I with set true',
    current_user
  );
end
$migration_role_membership$;

grant create on schema targets to pando_phase1_api;
grant create on schema planning, api to pando_planning_api;

create function targets.get_first_growth_plan_setup_choices_v1(p_workspace_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_count integer;
  v_choices jsonb;
begin
  if identity.jwt_subject() is null then
    raise exception using errcode = '28000', message = 'an authenticated user is required';
  end if;
  if p_workspace_id is null or not identity.is_workspace_member(p_workspace_id) then
    raise exception using errcode = '42501', message = 'setup source is unavailable';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_workspace_id::text || ':targets.active-readiness-goals', 2
    )
  );

  select pg_catalog.count(*)::integer
  into v_count
  from targets.readiness_goals as goal
  join targets.target_profile_versions as profile
    on profile.profile_version_id = goal.profile_version_id
  where goal.workspace_id = p_workspace_id
    and goal.lifecycle = 'active'
    and profile.lifecycle in ('published', 'retired');

  if v_count > 20 then
    return pg_catalog.jsonb_build_object(
      'contract', pg_catalog.jsonb_build_object(
        'name', 'FirstGrowthPlanSetupChoicesV1', 'version', '1.0.0'
      ),
      'activeGoalCount', v_count,
      'goals', '[]'::jsonb
    );
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'readinessGoalId', goal.readiness_goal_id,
        'readinessGoalKey', goal.readiness_goal_key,
        'title', goal.title,
        'lifecycle', pg_catalog.upper(goal.lifecycle),
        'aggregateVersion', goal.aggregate_version::text,
        'profileVersionId', profile.profile_version_id,
        'profileVersionKey', profile.profile_version_key,
        'profileLabel', pg_catalog.btrim(pg_catalog.left(case
          when profile.company_name is null then profile.role_title
          else profile.role_title || ' at ' || profile.company_name
        end, 200)),
        'roadmapVersionId', profile.roadmap_version_id,
        'sourceKind', case
          when profile.roadmap_version_id is null
            then 'TARGET_PROFILE_REQUIREMENT_COLLECTION'
          else 'ROADMAP_TEMPLATE_VERSION'
        end,
        'sourceRef', pg_catalog.lower(coalesce(
          profile.roadmap_version_id, profile.profile_version_id
        )::text),
        'ownerRevision', 'readiness-goal:' || goal.aggregate_version::text
      ) order by goal.readiness_goal_key collate "C"
    ),
    '[]'::jsonb
  ) into v_choices
  from targets.readiness_goals as goal
  join targets.target_profile_versions as profile
    on profile.profile_version_id = goal.profile_version_id
  where goal.workspace_id = p_workspace_id
    and goal.lifecycle = 'active'
    and profile.lifecycle in ('published', 'retired');

  return pg_catalog.jsonb_build_object(
    'contract', pg_catalog.jsonb_build_object(
      'name', 'FirstGrowthPlanSetupChoicesV1', 'version', '1.0.0'
    ),
    'activeGoalCount', v_count,
    'goals', v_choices
  );
end
$function$;

create function targets.resolve_first_growth_plan_setup_source_v1(
  p_workspace_id uuid,
  p_readiness_goal_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_source jsonb;
begin
  if identity.jwt_subject() is null then
    raise exception using errcode = '28000', message = 'an authenticated user is required';
  end if;
  if p_workspace_id is null or not identity.is_workspace_member(p_workspace_id) then
    raise exception using errcode = '42501', message = 'setup source is unavailable';
  end if;
  if p_readiness_goal_key is null
     or p_readiness_goal_key !~ '^goal:[a-z0-9][a-z0-9-]{1,100}$' then
    raise exception using errcode = '22023', message = 'readiness goal key is invalid';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_workspace_id::text || ':targets.active-readiness-goals', 2
    )
  );

  select pg_catalog.jsonb_build_object(
    'contract', pg_catalog.jsonb_build_object(
      'name', 'FirstGrowthPlanSetupResolvedSourceV1', 'version', '1.0.0'
    ),
    'readinessGoal', pg_catalog.jsonb_build_object(
      'readinessGoalId', goal.readiness_goal_id,
      'readinessGoalKey', goal.readiness_goal_key,
      'title', goal.title,
      'lifecycle', pg_catalog.upper(goal.lifecycle),
      'aggregateVersion', goal.aggregate_version::text
    ),
    'targetProfile', pg_catalog.jsonb_build_object(
      'profileVersionId', profile.profile_version_id,
      'profileVersionKey', profile.profile_version_key,
      'profileLabel', pg_catalog.btrim(pg_catalog.left(case
        when profile.company_name is null then profile.role_title
        else profile.role_title || ' at ' || profile.company_name
      end, 200))
    ),
    'sourceKind', case
      when profile.roadmap_version_id is null
        then 'TARGET_PROFILE_REQUIREMENT_COLLECTION'
      else 'ROADMAP_TEMPLATE_VERSION'
    end,
    'sourceRef', pg_catalog.lower(coalesce(
      profile.roadmap_version_id, profile.profile_version_id
    )::text),
    'roadmapVersionId', profile.roadmap_version_id,
    'ownerRevision', 'readiness-goal:' || goal.aggregate_version::text
  ) into v_source
  from targets.readiness_goals as goal
  join targets.target_profile_versions as profile
    on profile.profile_version_id = goal.profile_version_id
  where goal.workspace_id = p_workspace_id
    and goal.readiness_goal_key = p_readiness_goal_key
    and goal.lifecycle = 'active'
    and profile.lifecycle in ('published', 'retired');

  if v_source is null then
    raise exception using errcode = '42501', message = 'setup source is unavailable';
  end if;
  return v_source;
end
$function$;

create function planning.frame_named_fields_v1(p_names text[], p_values text[])
returns text
language sql
immutable
strict
set search_path = ''
as $function$
  select case
    when pg_catalog.cardinality(p_names) <> pg_catalog.cardinality(p_values)
      then null
    else coalesce(pg_catalog.string_agg(
      p_names[position] || ':'
        || pg_catalog.octet_length(
          pg_catalog.convert_to(coalesce(p_values[position], ''), 'UTF8')
        )::text
        || ':' || coalesce(p_values[position], '') || pg_catalog.chr(10),
      '' order by position
    ), '')
  end
  from pg_catalog.generate_subscripts(p_names, 1) as position
$function$;

create function planning.derive_first_growth_plan_identity_v1(
  p_workspace_id uuid,
  p_command_type text,
  p_idempotency_key text,
  p_label text
)
returns uuid
language plpgsql
stable
strict
set search_path = ''
as $function$
declare
  v_hash bytea;
  v_hex text;
begin
  if p_command_type <> 'planning.initialize_growth_plan_v2'
     or p_idempotency_key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or p_label not in ('growth-plan', 'initial-learning-track') then
    raise exception using errcode = '22023', message = 'create identity input is invalid';
  end if;
  v_hash := pg_catalog.substring(
    extensions.digest(
      pg_catalog.convert_to(
        planning.frame_named_fields_v1(
          array['identityVersion','workspaceId','commandType','idempotencyKey','label'],
          array[
            'planning-create-identity/1.0.0', pg_catalog.lower(p_workspace_id::text),
            p_command_type, p_idempotency_key, p_label
          ]
        ),
        'UTF8'
      ),
      'sha256'
    ),
    1,
    16
  );
  v_hash := pg_catalog.set_byte(v_hash, 6, (pg_catalog.get_byte(v_hash, 6) & 15) | 128);
  v_hash := pg_catalog.set_byte(v_hash, 8, (pg_catalog.get_byte(v_hash, 8) & 63) | 128);
  v_hex := pg_catalog.encode(v_hash, 'hex');
  return (
    pg_catalog.substring(v_hex, 1, 8) || '-' ||
    pg_catalog.substring(v_hex, 9, 4) || '-' ||
    pg_catalog.substring(v_hex, 13, 4) || '-' ||
    pg_catalog.substring(v_hex, 17, 4) || '-' ||
    pg_catalog.substring(v_hex, 21, 12)
  )::uuid;
end
$function$;

create function planning.build_first_growth_plan_preview_v1(
  p_workspace_id uuid,
  p_source jsonb,
  p_expected_readiness_goal_version bigint,
  p_weekly_capacity_minutes integer,
  p_default_session_minutes integer,
  p_track_priority integer,
  p_reason text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_lifetime_count integer;
  v_current_count integer;
  v_sentinel_count integer;
  v_plan_id uuid;
  v_track_id uuid;
  v_track_key text;
  v_goal_version bigint;
  v_blocker text;
  v_can_apply boolean;
  v_digest_input text;
  v_digest text;
  v_plan_title text;
  v_track_title text;
  v_roadmap text;
begin
  if p_source#>>'{contract,name}' <> 'FirstGrowthPlanSetupResolvedSourceV1'
     or p_source#>>'{contract,version}' <> '1.0.0'
     or p_source#>>'{readinessGoal,lifecycle}' <> 'ACTIVE'
     or p_source->>'sourceKind' not in (
       'ROADMAP_TEMPLATE_VERSION', 'TARGET_PROFILE_REQUIREMENT_COLLECTION'
     ) then
    raise exception using errcode = '55000', message = 'Targets setup source contract is invalid';
  end if;

  v_goal_version := (p_source#>>'{readinessGoal,aggregateVersion}')::bigint;
  v_plan_title := p_source#>>'{readinessGoal,title}';
  v_track_title := pg_catalog.btrim(pg_catalog.left(v_plan_title, 160));
  v_roadmap := coalesce(p_source->>'roadmapVersionId', '');
  v_plan_id := planning.derive_first_growth_plan_identity_v1(
    p_workspace_id, 'planning.initialize_growth_plan_v2', p_idempotency_key, 'growth-plan'
  );
  v_track_id := planning.derive_first_growth_plan_identity_v1(
    p_workspace_id, 'planning.initialize_growth_plan_v2', p_idempotency_key,
    'initial-learning-track'
  );
  v_track_key := 'track:' || pg_catalog.lower(v_track_id::text);

  select pg_catalog.count(*)::integer,
    pg_catalog.count(*) filter (where plan.lifecycle in ('active', 'paused'))::integer
  into v_lifetime_count, v_current_count
  from planning.growth_plans as plan
  where plan.workspace_id = p_workspace_id;
  select pg_catalog.count(*)::integer into v_sentinel_count
  from planning.current_plan_snapshots as pointer
  where pointer.workspace_id = p_workspace_id;

  if v_lifetime_count > 1 or v_current_count > 1
     or (v_lifetime_count = 0 and v_sentinel_count <> 0) then
    raise exception using errcode = '55000', message = 'Growth Plan setup state is corrupt';
  end if;

  v_blocker := case
    when v_current_count = 1 then 'CURRENT_GROWTH_PLAN_EXISTS'
    when exists (
      select 1 from planning.growth_plans where growth_plan_id = v_plan_id
    ) or exists (
      select 1 from planning.learning_tracks
      where learning_track_id = v_track_id or track_key = v_track_key
    ) then 'PLANNING_CREATE_IDENTITY_COLLISION'
    when v_lifetime_count = 1 then 'GROWTH_PLAN_HISTORY_REQUIRES_REPLACEMENT'
    else null
  end;
  v_can_apply := v_blocker is null;

  v_digest_input := planning.frame_named_fields_v1(
    array[
      'digestVersion','contractVersion','identityVersion','workspaceId','operation',
      'commandType','idempotencyKey','reason','expectedReadinessGoalVersion',
      'readinessGoalId','readinessGoalKey','readinessGoalTitle','readinessGoalLifecycle',
      'readinessGoalVersion','profileVersionId','profileVersionKey','sourceKind','sourceRef',
      'roadmapVersionId','sourceOwnerRevision','lifetimePlanCountBefore',
      'lifetimePlanCountAfter','currentPlanCountBefore','currentPlanCountAfter',
      'currentPlanLimit','snapshotSentinelCountBefore','snapshotSentinelCountAfter',
      'growthPlanId','growthPlanTitle','growthPlanLifecycle','growthPlanWeeklyCapacityMinutes',
      'growthPlanVersion','learningTrackId','trackKey','learningTrackTitle',
      'learningTrackLifecycle','learningTrackPriority','learningTrackProtectedMinimumMinutes',
      'learningTrackDefaultSessionMinutes','learningTrackVersion','canApply','blockingReasonCode',
      'warningCount','warningCode','retainedReadinessGoal','retainedCompetencyOverlay',
      'retainedActivitiesAndEvidence','retainedMastery','retainedReviews','retainedHistory',
      'projectionStateAfterApply','eventChangeKind','consumerName'
    ],
    array[
      'growth-plan-initialization-preview-digest/1.0.0','1.0.0',
      'planning-create-identity/1.0.0',pg_catalog.lower(p_workspace_id::text),
      'initialize_growth_plan','planning.initialize_growth_plan_v2',p_idempotency_key,p_reason,
      p_expected_readiness_goal_version::text,
      p_source#>>'{readinessGoal,readinessGoalId}',p_source#>>'{readinessGoal,readinessGoalKey}',
      v_plan_title,'ACTIVE',v_goal_version::text,p_source#>>'{targetProfile,profileVersionId}',
      p_source#>>'{targetProfile,profileVersionKey}',p_source->>'sourceKind',p_source->>'sourceRef',
      v_roadmap,p_source->>'ownerRevision',v_lifetime_count::text,'1',v_current_count::text,'1',
      '1',v_sentinel_count::text,'1',pg_catalog.lower(v_plan_id::text),v_plan_title,'ACTIVE',
      p_weekly_capacity_minutes::text,'1',pg_catalog.lower(v_track_id::text),v_track_key,
      v_track_title,'ACTIVE',p_track_priority::text,'0',p_default_session_minutes::text,'1',
      pg_catalog.lower(v_can_apply::text),coalesce(v_blocker,''),'1',
      'INITIAL_TRACK_HAS_NO_ACTIVITIES','true','true','true','true','true','true',
      'PENDING','INITIALIZED','planning.plan_snapshot_v1'
    ]
  );
  v_digest := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(v_digest_input, 'UTF8'), 'sha256'), 'hex'
  );

  return pg_catalog.jsonb_build_object(
    'contract', pg_catalog.jsonb_build_object(
      'name', 'GrowthPlanInitializationPreviewV1', 'version', '1.0.0'
    ),
    'digestVersion', 'growth-plan-initialization-preview-digest/1.0.0',
    'identityVersion', 'planning-create-identity/1.0.0',
    'operation', 'initialize_growth_plan',
    'commandType', 'planning.initialize_growth_plan_v2',
    'idempotencyKey', p_idempotency_key,
    'reason', p_reason,
    'expectedReadinessGoalVersion', p_expected_readiness_goal_version::text,
    'source', pg_catalog.jsonb_build_object(
      'readinessGoalId', p_source#>>'{readinessGoal,readinessGoalId}',
      'readinessGoalKey', p_source#>>'{readinessGoal,readinessGoalKey}',
      'readinessGoalTitle', p_source#>>'{readinessGoal,title}',
      'readinessGoalLifecycle', p_source#>>'{readinessGoal,lifecycle}',
      'readinessGoalVersion', p_source#>>'{readinessGoal,aggregateVersion}',
      'profileVersionId', p_source#>>'{targetProfile,profileVersionId}',
      'profileVersionKey', p_source#>>'{targetProfile,profileVersionKey}',
      'sourceKind', p_source->>'sourceKind',
      'sourceRef', p_source->>'sourceRef',
      'roadmapVersionId', p_source->'roadmapVersionId',
      'sourceOwnerRevision', p_source->>'ownerRevision'
    ),
    'before', pg_catalog.jsonb_build_object(
      'lifetimePlanCount', v_lifetime_count,
      'currentPlanCount', v_current_count,
      'snapshotSentinelCount', v_sentinel_count
    ),
    'after', pg_catalog.jsonb_build_object(
      'lifetimePlanCount', 1,
      'currentPlanCount', 1,
      'currentPlanLimit', 1,
      'snapshotSentinelCount', 1,
      'growthPlan', pg_catalog.jsonb_build_object(
        'growthPlanId', v_plan_id, 'title', v_plan_title, 'lifecycle', 'ACTIVE',
        'weeklyCapacityMinutes', p_weekly_capacity_minutes, 'aggregateVersion', '1'
      ),
      'learningTrack', pg_catalog.jsonb_build_object(
        'learningTrackId', v_track_id, 'trackKey', v_track_key, 'title', v_track_title,
        'lifecycle', 'ACTIVE', 'priority', p_track_priority,
        'protectedMinimumMinutes', 0, 'defaultSessionMinutes', p_default_session_minutes,
        'aggregateVersion', '1'
      )
    ),
    'canApply', v_can_apply,
    'blockingReasons', case when v_blocker is null then '[]'::jsonb else
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('code', v_blocker)) end,
    'warnings', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('code', 'INITIAL_TRACK_HAS_NO_ACTIVITIES')
    ),
    'retained', pg_catalog.jsonb_build_object(
      'readinessGoal', true, 'competencyOverlay', true,
      'activitiesAndEvidence', true, 'mastery', true, 'reviews', true, 'history', true
    ),
    'recalculationAfterApply', pg_catalog.jsonb_build_object(
      'projectionState', 'PENDING', 'eventChangeKind', 'INITIALIZED',
      'consumerName', 'planning.plan_snapshot_v1'
    ),
    'previewDigest', v_digest
  );
end
$function$;

create function api.get_growth_plan_setup_source_v1()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_workspace_id uuid;
  v_lifetime_count integer;
  v_current_count integer;
  v_sentinel_count integer;
  v_targets jsonb;
  v_state text;
  v_public_goals jsonb := '[]'::jsonb;
begin
  if identity.jwt_subject() is null then
    raise exception using errcode = '28000', message = 'an authenticated user is required';
  end if;
  v_workspace_id := identity.personal_workspace_id_for_current_user();
  if v_workspace_id is null then
    raise exception using errcode = '28000', message = 'authenticated user is not provisioned';
  end if;

  select pg_catalog.count(*)::integer,
    pg_catalog.count(*) filter (where plan.lifecycle in ('active', 'paused'))::integer
  into v_lifetime_count, v_current_count
  from planning.growth_plans as plan where plan.workspace_id = v_workspace_id;
  select pg_catalog.count(*)::integer into v_sentinel_count
  from planning.current_plan_snapshots as pointer where pointer.workspace_id = v_workspace_id;

  if v_lifetime_count > 1 or v_current_count > 1
     or (v_lifetime_count = 0 and v_sentinel_count <> 0) then
    raise exception using errcode = '55000', message = 'Growth Plan setup state is corrupt';
  end if;

  if v_current_count = 1 then
    v_state := 'CURRENT_PLAN_EXISTS';
  elsif v_lifetime_count = 1 then
    v_state := 'HISTORY_REQUIRES_REPLACEMENT';
  else
    v_targets := targets.get_first_growth_plan_setup_choices_v1(v_workspace_id);
    if (v_targets->>'activeGoalCount')::integer > 20 then
      v_state := 'GOAL_PORTFOLIO_OVERFLOW';
    elsif (v_targets->>'activeGoalCount')::integer = 0 then
      v_state := 'NO_ACTIVE_GOALS';
    else
      v_state := 'SETUP_AVAILABLE';
      select coalesce(pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'readinessGoalKey', choice->>'readinessGoalKey',
          'title', choice->>'title',
          'profileVersionKey', choice->>'profileVersionKey',
          'profileLabel', choice->>'profileLabel',
          'roadmapPresent', choice->'roadmapVersionId' <> 'null'::jsonb,
          'aggregateVersion', choice->>'aggregateVersion'
        ) order by choice->>'readinessGoalKey' collate "C"
      ), '[]'::jsonb) into v_public_goals
      from pg_catalog.jsonb_array_elements(v_targets->'goals') as choice;
    end if;
  end if;

  return pg_catalog.jsonb_build_object(
    'contract', pg_catalog.jsonb_build_object(
      'name', 'GrowthPlanSetupSourceV1', 'version', '1.0.0'
    ),
    'state', v_state,
    'capabilities', case when v_state = 'SETUP_AVAILABLE'
      then pg_catalog.jsonb_build_array('initialize_growth_plan') else '[]'::jsonb end,
    'goals', v_public_goals
  );
end
$function$;

create function api.preview_growth_plan_initialization_v1(
  p_readiness_goal_key text,
  p_expected_readiness_goal_version text,
  p_weekly_capacity_minutes integer,
  p_default_session_minutes integer,
  p_track_priority integer,
  p_reason text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_workspace_id uuid;
  v_source jsonb;
begin
  if identity.jwt_subject() is null then
    raise exception using errcode = '28000', message = 'an authenticated user is required';
  end if;
  v_workspace_id := identity.personal_workspace_id_for_current_user();
  if v_workspace_id is null then
    raise exception using errcode = '28000', message = 'authenticated user is not provisioned';
  end if;
  if p_readiness_goal_key is null
     or p_readiness_goal_key !~ '^goal:[a-z0-9][a-z0-9-]{1,100}$' then
    raise exception using errcode = '22023', message = 'readiness goal key is invalid';
  end if;
  if p_expected_readiness_goal_version is null
     or p_expected_readiness_goal_version !~ '^[1-9][0-9]{0,18}$'
     or p_expected_readiness_goal_version::numeric > 9223372036854775807
     or p_weekly_capacity_minutes is null or p_weekly_capacity_minutes not between 0 and 10080
     or p_default_session_minutes is null or p_default_session_minutes not between 1 and 480
     or p_track_priority is null or p_track_priority not between 0 and 100 then
    raise exception using errcode = '22023', message = 'Growth Plan setup request is invalid';
  end if;
  if p_reason is null or p_reason <> pg_catalog.btrim(p_reason)
     or pg_catalog.char_length(p_reason) not between 1 and 500
     or p_reason ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'Growth Plan setup reason is invalid';
  end if;
  if p_idempotency_key is null
     or p_idempotency_key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception using errcode = '22023', message = 'idempotency key must be a UUID';
  end if;

  v_source := targets.resolve_first_growth_plan_setup_source_v1(
    v_workspace_id, p_readiness_goal_key
  );
  if v_source#>>'{readinessGoal,aggregateVersion}'
     is distinct from p_expected_readiness_goal_version then
    raise exception using errcode = '40001', message = 'readiness goal source is stale';
  end if;
  return planning.build_first_growth_plan_preview_v1(
    v_workspace_id, v_source, p_expected_readiness_goal_version::bigint,
    p_weekly_capacity_minutes, p_default_session_minutes, p_track_priority,
    p_reason, p_idempotency_key
  );
end
$function$;

create function api.apply_growth_plan_initialization_v1(
  p_readiness_goal_key text,
  p_expected_readiness_goal_version text,
  p_weekly_capacity_minutes integer,
  p_default_session_minutes integer,
  p_track_priority integer,
  p_reason text,
  p_idempotency_key text,
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
  v_source jsonb;
  v_preview jsonb;
  v_plan_id uuid;
  v_track_id uuid;
  v_track_key text;
  v_command_id uuid := gen_random_uuid();
  v_correlation_id uuid := gen_random_uuid();
  v_event_id uuid := gen_random_uuid();
  v_delivery_id uuid := gen_random_uuid();
  v_request_hash bytea;
  v_receipt outbox.command_receipts%rowtype;
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
  if p_readiness_goal_key is null
     or p_readiness_goal_key !~ '^goal:[a-z0-9][a-z0-9-]{1,100}$'
     or p_expected_readiness_goal_version is null
     or p_expected_readiness_goal_version !~ '^[1-9][0-9]{0,18}$'
     or p_expected_readiness_goal_version::numeric > 9223372036854775807
     or p_weekly_capacity_minutes is null or p_weekly_capacity_minutes not between 0 and 10080
     or p_default_session_minutes is null or p_default_session_minutes not between 1 and 480
     or p_track_priority is null or p_track_priority not between 0 and 100 then
    raise exception using errcode = '22023', message = 'Growth Plan setup request is invalid';
  end if;
  if p_reason is null or p_reason <> pg_catalog.btrim(p_reason)
     or pg_catalog.char_length(p_reason) not between 1 and 500
     or p_reason ~ '[[:cntrl:]]'
     or p_idempotency_key is null
     or p_idempotency_key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or p_preview_digest is null or p_preview_digest !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'Growth Plan setup confirmation is invalid';
  end if;

  v_plan_id := planning.derive_first_growth_plan_identity_v1(
    v_workspace_id, 'planning.initialize_growth_plan_v2', p_idempotency_key, 'growth-plan'
  );
  v_track_id := planning.derive_first_growth_plan_identity_v1(
    v_workspace_id, 'planning.initialize_growth_plan_v2', p_idempotency_key,
    'initial-learning-track'
  );
  v_track_key := 'track:' || pg_catalog.lower(v_track_id::text);
  v_request_hash := extensions.digest(
    pg_catalog.convert_to(
      planning.frame_named_fields_v1(
        array[
          'requestHashVersion','schemaVersion','identityVersion','workspaceId','commandType',
          'operation','idempotencyKey','readinessGoalKey','expectedReadinessGoalVersion',
          'weeklyCapacityMinutes','defaultSessionMinutes','trackPriority','reason',
          'previewDigest','growthPlanId','learningTrackId','trackKey'
        ],
        array[
          'growth-plan-initialization-request-hash/1.0.0','1.0.0',
          'planning-create-identity/1.0.0',pg_catalog.lower(v_workspace_id::text),
          'planning.initialize_growth_plan_v2','initialize_growth_plan',p_idempotency_key,
          p_readiness_goal_key,p_expected_readiness_goal_version,
          p_weekly_capacity_minutes::text,p_default_session_minutes::text,
          p_track_priority::text,p_reason,p_preview_digest,pg_catalog.lower(v_plan_id::text),
          pg_catalog.lower(v_track_id::text),v_track_key
        ]
      ),
      'UTF8'
    ),
    'sha256'
  );

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    v_actor_user_id::text || ':planning.initialize_growth_plan_v2:' || p_idempotency_key, 0
  ));
  select receipt.* into v_receipt
  from outbox.command_receipts as receipt
  where receipt.actor_user_id = v_actor_user_id
    and receipt.command_type = 'planning.initialize_growth_plan_v2'
    and receipt.idempotency_key = p_idempotency_key
  for update;
  if found then
    if v_receipt.request_hash <> v_request_hash then
      raise exception using errcode = '22023',
        message = 'idempotency key reused with a different request';
    end if;
    if v_receipt.command_status <> 'completed' then
      raise exception using errcode = '40001', message = 'command receipt is not complete';
    end if;
    return v_receipt.response;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('planning-workspace:' || v_workspace_id::text, 0)
  );
  perform plan.growth_plan_id
  from planning.growth_plans as plan
  where plan.workspace_id = v_workspace_id
  order by plan.growth_plan_id
  for update;

  v_source := targets.resolve_first_growth_plan_setup_source_v1(
    v_workspace_id, p_readiness_goal_key
  );
  if v_source#>>'{readinessGoal,aggregateVersion}'
     is distinct from p_expected_readiness_goal_version then
    raise exception using errcode = '40001', message = 'readiness goal source is stale';
  end if;
  v_preview := planning.build_first_growth_plan_preview_v1(
    v_workspace_id, v_source, p_expected_readiness_goal_version::bigint,
    p_weekly_capacity_minutes, p_default_session_minutes, p_track_priority,
    p_reason, p_idempotency_key
  );
  if (v_preview->>'canApply')::boolean is not true
     or v_preview->>'previewDigest' is distinct from p_preview_digest
     or v_preview#>>'{after,growthPlan,growthPlanId}' is distinct from v_plan_id::text
     or v_preview#>>'{after,learningTrack,learningTrackId}' is distinct from v_track_id::text
     or v_preview#>>'{after,learningTrack,trackKey}' is distinct from v_track_key then
    raise exception using errcode = '40001', message = 'Growth Plan setup preview is stale';
  end if;

  insert into outbox.command_receipts (
    command_id, command_type, command_schema_version, workspace_id, actor_user_id,
    idempotency_key, request_hash, correlation_id, expected_aggregate_version
  ) values (
    v_command_id, 'planning.initialize_growth_plan_v2', 1, v_workspace_id,
    v_actor_user_id, p_idempotency_key, v_request_hash, v_correlation_id, 0
  );
  get diagnostics v_affected_rows = row_count;
  if v_affected_rows <> 1 then
    raise exception using errcode = '55000', message = 'Growth Plan setup receipt insert failed';
  end if;

  insert into planning.growth_plans (
    growth_plan_id, workspace_id, title, lifecycle, weekly_capacity_minutes,
    aggregate_version
  ) values (
    v_plan_id, v_workspace_id, v_source#>>'{readinessGoal,title}', 'active',
    p_weekly_capacity_minutes, 1
  );
  get diagnostics v_affected_rows = row_count;
  if v_affected_rows <> 1 then
    raise exception using errcode = '55000', message = 'Growth Plan setup Plan insert failed';
  end if;

  insert into planning.learning_tracks (
    learning_track_id, workspace_id, growth_plan_id, track_key, title,
    readiness_goal_id, profile_version_id, roadmap_version_id, lifecycle,
    priority, protected_minimum_minutes, default_session_minutes, aggregate_version
  ) values (
    v_track_id, v_workspace_id, v_plan_id, v_track_key,
    pg_catalog.btrim(pg_catalog.left(v_source#>>'{readinessGoal,title}', 160)),
    (v_source#>>'{readinessGoal,readinessGoalId}')::uuid,
    (v_source#>>'{targetProfile,profileVersionId}')::uuid,
    (v_source->>'roadmapVersionId')::uuid, 'active', p_track_priority, 0,
    p_default_session_minutes, 1
  );
  get diagnostics v_affected_rows = row_count;
  if v_affected_rows <> 1 then
    raise exception using errcode = '55000', message = 'Growth Plan setup Track insert failed';
  end if;

  insert into planning.current_plan_snapshots (
    workspace_id, snapshot_id, pointer_version, applied_attempt_id
  ) values (v_workspace_id, null, 0, null);
  get diagnostics v_affected_rows = row_count;
  if v_affected_rows <> 1 then
    raise exception using errcode = '55000', message = 'Growth Plan setup sentinel insert failed';
  end if;

  insert into outbox.events (
    event_id, event_name, event_schema_version, workspace_id, aggregate_type,
    aggregate_id, aggregate_version, actor_type, actor_user_id, command_id,
    correlation_id, occurred_at, source, payload
  ) values (
    v_event_id, 'planning.input_changed', 1, v_workspace_id,
    'planning.growth_plan', v_plan_id, 1, 'user', v_actor_user_id,
    v_command_id, v_correlation_id, pg_catalog.clock_timestamp(), 'pando.database',
    pg_catalog.jsonb_build_object(
      'change_kind', 'INITIALIZED',
      'growth_plan_id', v_plan_id,
      'growth_plan_version', 1,
      'learning_track_id', v_track_id,
      'learning_track_version', 1,
      'readiness_goal_id', (v_source#>>'{readinessGoal,readinessGoalId}')::uuid,
      'profile_version_id', (v_source#>>'{targetProfile,profileVersionId}')::uuid
    )
  );
  get diagnostics v_affected_rows = row_count;
  if v_affected_rows <> 1 then
    raise exception using errcode = '55000', message = 'Growth Plan setup event insert failed';
  end if;

  insert into outbox.deliveries (
    delivery_id, event_id, workspace_id, consumer_name, handler_contract_version
  ) values (
    v_delivery_id, v_event_id, v_workspace_id, 'planning.plan_snapshot_v1', 1
  );
  get diagnostics v_affected_rows = row_count;
  if v_affected_rows <> 1 then
    raise exception using errcode = '55000', message = 'Growth Plan setup delivery insert failed';
  end if;

  v_response := pg_catalog.jsonb_build_object(
    'contract', pg_catalog.jsonb_build_object(
      'name', 'GrowthPlanInitializationApplyResultV1', 'version', '1.0.0'
    ),
    'commandId', v_command_id,
    'createdPlan', v_preview#>'{after,growthPlan}',
    'createdTrack', v_preview#>'{after,learningTrack}',
    'planningDeliveryId', v_delivery_id,
    'projectionState', 'PENDING',
    'emittedEventIds', pg_catalog.jsonb_build_array(v_event_id)
  );
  update outbox.command_receipts
  set command_status = 'completed', response = v_response,
    emitted_event_ids = array[v_event_id], completed_at = pg_catalog.clock_timestamp()
  where command_id = v_command_id;
  get diagnostics v_affected_rows = row_count;
  if v_affected_rows <> 1 then
    raise exception using errcode = '55000', message = 'Growth Plan setup receipt completion failed';
  end if;
  return v_response;
end
$function$;

alter function targets.get_first_growth_plan_setup_choices_v1(uuid)
  owner to pando_phase1_api;
alter function targets.resolve_first_growth_plan_setup_source_v1(uuid, text)
  owner to pando_phase1_api;
alter function planning.frame_named_fields_v1(text[], text[])
  owner to pando_planning_api;
alter function planning.derive_first_growth_plan_identity_v1(uuid, text, text, text)
  owner to pando_planning_api;
alter function planning.build_first_growth_plan_preview_v1(
  uuid, jsonb, bigint, integer, integer, integer, text, text
) owner to pando_planning_api;
alter function api.get_growth_plan_setup_source_v1()
  owner to pando_planning_api;
alter function api.preview_growth_plan_initialization_v1(
  text, text, integer, integer, integer, text, text
) owner to pando_planning_api;
alter function api.apply_growth_plan_initialization_v1(
  text, text, integer, integer, integer, text, text, text
) owner to pando_planning_api;

revoke all on function
  targets.get_first_growth_plan_setup_choices_v1(uuid),
  targets.resolve_first_growth_plan_setup_source_v1(uuid, text),
  planning.frame_named_fields_v1(text[], text[]),
  planning.derive_first_growth_plan_identity_v1(uuid, text, text, text),
  planning.build_first_growth_plan_preview_v1(
    uuid, jsonb, bigint, integer, integer, integer, text, text
  ),
  api.get_growth_plan_setup_source_v1(),
  api.preview_growth_plan_initialization_v1(
    text, text, integer, integer, integer, text, text
  ),
  api.apply_growth_plan_initialization_v1(
    text, text, integer, integer, integer, text, text, text
  )
  from public, anon, authenticated, service_role;

grant execute on function
  targets.get_first_growth_plan_setup_choices_v1(uuid),
  targets.resolve_first_growth_plan_setup_source_v1(uuid, text)
  to pando_planning_api;
grant execute on function
  api.get_growth_plan_setup_source_v1(),
  api.preview_growth_plan_initialization_v1(
    text, text, integer, integer, integer, text, text
  ),
  api.apply_growth_plan_initialization_v1(
    text, text, integer, integer, integer, text, text, text
  )
  to authenticated;

revoke execute on function api.initialize_growth_plan_v1(
  text, integer, integer, integer, integer, text
) from authenticated;
revoke execute on function planning.initialize_growth_plan_impl_v1(
  text, integer, integer, integer, integer, text
) from authenticated;

revoke create on schema targets from pando_phase1_api;
revoke create on schema planning, api from pando_planning_api;

do $migration_role_membership$
begin
  execute pg_catalog.format(
    'revoke pando_phase1_api, pando_planning_api from %I', current_user
  );
end
$migration_role_membership$;
