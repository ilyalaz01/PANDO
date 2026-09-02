-- Phase 4B D3a: atomic Growth Plan replacement.
-- ADR-0010 section 1 requires exactly one current Growth Plan after initialization, so archiving is
-- reachable only as one effect of a replacement that creates the incoming current Plan in the same
-- transaction. Nothing is copied and no history is rewritten.

do $migration_role_membership$
begin
  execute pg_catalog.format('grant pando_planning_api to %I with set true', current_user);
end
$migration_role_membership$;

grant create on schema planning, api to pando_planning_api;

create function planning.growth_plan_replacement_constraint_v1(
  p_workspace_id uuid,
  p_growth_plan_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_total integer;
  v_active integer;
  v_paused integer;
  v_completed integer;
  v_archived integer;
  v_fingerprint_input text;
  v_fingerprint text;
begin
  if p_workspace_id is null or p_growth_plan_id is null then
    raise exception using errcode = '22023',
      message = 'Growth Plan replacement constraint input is invalid';
  end if;

  select
    pg_catalog.count(*)::integer,
    pg_catalog.count(*) filter (where track.lifecycle = 'active')::integer,
    pg_catalog.count(*) filter (where track.lifecycle = 'paused')::integer,
    pg_catalog.count(*) filter (where track.lifecycle = 'completed')::integer,
    pg_catalog.count(*) filter (where track.lifecycle = 'archived')::integer
  into v_total, v_active, v_paused, v_completed, v_archived
  from planning.learning_tracks as track
  where track.workspace_id = p_workspace_id
    and track.growth_plan_id = p_growth_plan_id;

  select pg_catalog.string_agg(
    fingerprint_part.part_name || ':'
      || pg_catalog.octet_length(
        pg_catalog.convert_to(fingerprint_part.part_value, 'UTF8')
      )::text
      || ':' || fingerprint_part.part_value || pg_catalog.chr(10),
    '' order by fingerprint_part.part_position
  ) into v_fingerprint_input
  from (
    select 1::bigint as part_position,
      'fingerprintVersion'::text as part_name,
      'growth-plan-child-track-fingerprint/1.0.0'::text as part_value
    union all
    select 2, 'childTrackCount', v_total::text
    union all
    select
      2 + ordered_track.track_position * 10 + field.field_position,
      field.field_name,
      field.field_value
    from (
      select
        track.learning_track_id,
        track.aggregate_version,
        track.lifecycle,
        pg_catalog.row_number() over (order by track.learning_track_id)::bigint as track_position
      from planning.learning_tracks as track
      where track.workspace_id = p_workspace_id
        and track.growth_plan_id = p_growth_plan_id
    ) as ordered_track
    cross join lateral (
      values
        (1::bigint, 'learningTrackId'::text,
          pg_catalog.lower(ordered_track.learning_track_id::text)),
        (2::bigint, 'aggregateVersion'::text, ordered_track.aggregate_version::text),
        (3::bigint, 'lifecycle'::text, pg_catalog.upper(ordered_track.lifecycle))
    ) as field(field_position, field_name, field_value)
  ) as fingerprint_part;

  v_fingerprint := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(v_fingerprint_input, 'UTF8'), 'sha256'),
    'hex'
  );

  return pg_catalog.jsonb_build_object(
    'childTrackCount', v_total,
    'activeTrackCount', v_active,
    'pausedTrackCount', v_paused,
    'completedTrackCount', v_completed,
    'archivedTrackCount', v_archived,
    'childTrackFingerprint', v_fingerprint
  );
end
$function$;

create function planning.derive_growth_plan_replacement_identity_v1(
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
  if p_command_type <> 'planning.replace_growth_plan_v1'
     or p_idempotency_key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or p_label not in ('growth-plan', 'initial-learning-track') then
    raise exception using errcode = '22023', message = 'replacement identity input is invalid';
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

create function planning.plan_replaced_event_payload_v1_is_valid(p_payload jsonb)
returns boolean
language sql
immutable
strict
set search_path = ''
as $function$
  select pg_catalog.jsonb_typeof(p_payload) = 'object'
    and (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(p_payload)) = 7
    and p_payload->>'change_kind' = 'PLAN_REPLACED'
    and p_payload->>'archived_growth_plan_id'
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and case
      when p_payload->>'archived_growth_plan_version' ~ '^[1-9][0-9]{0,18}$'
        then (p_payload->>'archived_growth_plan_version')::numeric <= 9223372036854775807
      else false
    end
    and p_payload->>'growth_plan_id'
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and p_payload->>'growth_plan_id' <> p_payload->>'archived_growth_plan_id'
    and p_payload->>'learning_track_id'
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and p_payload->>'readiness_goal_id'
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and p_payload->>'profile_version_id'
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
$function$;

create function planning.build_growth_plan_replacement_preview_v1(
  p_workspace_id uuid,
  p_source jsonb,
  p_expected_readiness_goal_version bigint,
  p_expected_growth_plan_version bigint,
  p_growth_plan_id uuid,
  p_growth_plan_title text,
  p_growth_plan_lifecycle text,
  p_growth_plan_weekly_capacity_minutes integer,
  p_growth_plan_version bigint,
  p_constraint jsonb,
  p_lifetime_plan_count integer,
  p_weekly_capacity_minutes integer,
  p_default_session_minutes integer,
  p_track_priority integer,
  p_reason text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_plan_id uuid;
  v_track_id uuid;
  v_track_key text;
  v_goal_version bigint;
  v_plan_title text;
  v_track_title text;
  v_roadmap text;
  v_child_track_count integer;
  v_active_track_count integer;
  v_paused_track_count integer;
  v_completed_track_count integer;
  v_archived_track_count integer;
  v_child_track_fingerprint text;
  v_current_track_count integer;
  v_blocker text;
  v_can_apply boolean;
  v_warnings jsonb;
  v_warning_codes text[];
  v_digest_input text;
  v_digest text;
begin
  if p_source#>>'{contract,name}' <> 'FirstGrowthPlanSetupResolvedSourceV1'
     or p_source#>>'{contract,version}' <> '1.0.0'
     or p_source#>>'{readinessGoal,lifecycle}' <> 'ACTIVE'
     or p_source->>'sourceKind' not in (
       'ROADMAP_TEMPLATE_VERSION', 'TARGET_PROFILE_REQUIREMENT_COLLECTION'
     ) then
    raise exception using errcode = '55000', message = 'Targets setup source contract is invalid';
  end if;
  if p_workspace_id is null or p_growth_plan_id is null
     or p_growth_plan_lifecycle not in ('active', 'paused')
     or p_growth_plan_weekly_capacity_minutes is null
     or p_growth_plan_weekly_capacity_minutes not between 0 and 10080
     or p_growth_plan_version is null or p_growth_plan_version < 1
     or p_expected_growth_plan_version is null or p_expected_growth_plan_version < 1
     or p_expected_readiness_goal_version is null or p_expected_readiness_goal_version < 1
     or p_lifetime_plan_count is null or p_lifetime_plan_count < 1
     or p_weekly_capacity_minutes is null or p_weekly_capacity_minutes not between 0 and 10080
     or p_default_session_minutes is null or p_default_session_minutes not between 1 and 480
     or p_track_priority is null or p_track_priority not between 0 and 100 then
    raise exception using errcode = '22023',
      message = 'Growth Plan replacement preview input is invalid';
  end if;
  if p_reason is null or p_reason <> pg_catalog.btrim(p_reason)
     or pg_catalog.char_length(p_reason) not between 1 and 500
     or p_reason ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023',
      message = 'Growth Plan replacement reason is invalid';
  end if;
  if p_expected_growth_plan_version <> p_growth_plan_version then
    raise exception using errcode = '40001', message = 'Growth Plan version is stale';
  end if;
  if p_growth_plan_version = 9223372036854775807 then
    raise exception using errcode = '22003', message = 'Growth Plan version is exhausted';
  end if;

  v_child_track_count := (p_constraint->>'childTrackCount')::integer;
  v_active_track_count := (p_constraint->>'activeTrackCount')::integer;
  v_paused_track_count := (p_constraint->>'pausedTrackCount')::integer;
  v_completed_track_count := (p_constraint->>'completedTrackCount')::integer;
  v_archived_track_count := (p_constraint->>'archivedTrackCount')::integer;
  v_child_track_fingerprint := p_constraint->>'childTrackFingerprint';
  if v_child_track_count is null or v_child_track_count < 0
     or v_active_track_count is null or v_paused_track_count is null
     or v_completed_track_count is null or v_archived_track_count is null
     or v_active_track_count + v_paused_track_count + v_completed_track_count
       + v_archived_track_count <> v_child_track_count
     or v_child_track_fingerprint is null
     or v_child_track_fingerprint !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023',
      message = 'Growth Plan replacement Track constraint is invalid';
  end if;

  v_goal_version := (p_source#>>'{readinessGoal,aggregateVersion}')::bigint;
  if v_goal_version <> p_expected_readiness_goal_version then
    raise exception using errcode = '40001', message = 'readiness goal source is stale';
  end if;
  v_plan_title := p_source#>>'{readinessGoal,title}';
  v_track_title := pg_catalog.btrim(pg_catalog.left(v_plan_title, 160));
  v_roadmap := coalesce(p_source->>'roadmapVersionId', '');
  v_plan_id := planning.derive_growth_plan_replacement_identity_v1(
    p_workspace_id, 'planning.replace_growth_plan_v1', p_idempotency_key, 'growth-plan'
  );
  v_track_id := planning.derive_growth_plan_replacement_identity_v1(
    p_workspace_id, 'planning.replace_growth_plan_v1', p_idempotency_key,
    'initial-learning-track'
  );
  v_track_key := 'track:' || pg_catalog.lower(v_track_id::text);

  select pg_catalog.count(*)::integer into v_current_track_count
  from planning.learning_tracks as track
  where track.workspace_id = p_workspace_id
    and track.growth_plan_id = p_growth_plan_id
    and track.lifecycle <> 'archived';

  v_blocker := case
    when exists (
      select 1 from planning.growth_plans where growth_plan_id = v_plan_id
    ) or exists (
      select 1 from planning.learning_tracks
      where learning_track_id = v_track_id or track_key = v_track_key
    ) then 'PLANNING_CREATE_IDENTITY_COLLISION'
    else null
  end;
  v_can_apply := v_blocker is null;

  v_warnings := pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object('code', 'ARCHIVED_PLAN_IS_READ_ONLY')
  );
  if v_current_track_count > 0 then
    v_warnings := v_warnings || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('code', 'CURRENT_TRACKS_NOT_COPIED')
    );
  end if;
  v_warnings := v_warnings || pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object('code', 'INITIAL_TRACK_HAS_NO_ACTIVITIES')
  );
  select pg_catalog.array_agg(warning.value->>'code' order by warning.ordinality)
  into v_warning_codes
  from pg_catalog.jsonb_array_elements(v_warnings) with ordinality as warning(value, ordinality);

  v_digest_input := planning.frame_named_fields_v1(
    array[
      'digestVersion','contractVersion','identityVersion','workspaceId','operation','commandType',
      'idempotencyKey','reason','expectedReadinessGoalVersion','expectedGrowthPlanVersion',
      'readinessGoalId','readinessGoalKey','readinessGoalTitle','readinessGoalLifecycle',
      'readinessGoalVersion','profileVersionId','profileVersionKey','sourceKind','sourceRef',
      'roadmapVersionId','sourceOwnerRevision','archivedGrowthPlanId','archivedGrowthPlanTitle',
      'archivedGrowthPlanLifecycleBefore','archivedGrowthPlanLifecycleAfter',
      'archivedGrowthPlanWeeklyCapacityMinutes','archivedGrowthPlanVersionBefore',
      'archivedGrowthPlanVersionAfter','childTrackCount','activeTrackCount','pausedTrackCount',
      'completedTrackCount','archivedTrackCount','childTrackFingerprint','lifetimePlanCountBefore',
      'lifetimePlanCountAfter','currentPlanCountBefore','currentPlanCountAfter','currentPlanLimit',
      'growthPlanId','growthPlanTitle','growthPlanLifecycle','growthPlanWeeklyCapacityMinutes',
      'growthPlanVersion','learningTrackId','trackKey','learningTrackTitle',
      'learningTrackLifecycle','learningTrackPriority','learningTrackProtectedMinimumMinutes',
      'learningTrackCadencePerWeek','learningTrackDefaultSessionMinutes','learningTrackVersion',
      'canApply','blockingReasonCode','warningCount'
    ] || pg_catalog.array_fill('warningCode'::text, array[pg_catalog.cardinality(v_warning_codes)])
      || array[
      'retainedReadinessGoal','retainedArchivedPlan','retainedLearningTrackHistory',
      'retainedActivitiesAndEvidence','retainedMastery','retainedReviews','retainedPlanSnapshots',
      'projectionStateAfterApply','eventChangeKind','consumerName'
    ],
    array[
      'growth-plan-replacement-preview-digest/1.0.0','1.0.0',
      'planning-create-identity/1.0.0',pg_catalog.lower(p_workspace_id::text),
      'replace_growth_plan','planning.replace_growth_plan_v1',p_idempotency_key,p_reason,
      p_expected_readiness_goal_version::text,p_expected_growth_plan_version::text,
      p_source#>>'{readinessGoal,readinessGoalId}',p_source#>>'{readinessGoal,readinessGoalKey}',
      v_plan_title,'ACTIVE',v_goal_version::text,p_source#>>'{targetProfile,profileVersionId}',
      p_source#>>'{targetProfile,profileVersionKey}',p_source->>'sourceKind',
      p_source->>'sourceRef',v_roadmap,p_source->>'ownerRevision',
      pg_catalog.lower(p_growth_plan_id::text),p_growth_plan_title,
      pg_catalog.upper(p_growth_plan_lifecycle),'ARCHIVED',
      p_growth_plan_weekly_capacity_minutes::text,p_growth_plan_version::text,
      (p_growth_plan_version + 1)::text,v_child_track_count::text,v_active_track_count::text,
      v_paused_track_count::text,v_completed_track_count::text,v_archived_track_count::text,
      v_child_track_fingerprint,p_lifetime_plan_count::text,(p_lifetime_plan_count + 1)::text,
      '1','1','1',pg_catalog.lower(v_plan_id::text),v_plan_title,'ACTIVE',
      p_weekly_capacity_minutes::text,'1',pg_catalog.lower(v_track_id::text),v_track_key,
      v_track_title,'ACTIVE',p_track_priority::text,'0','0',p_default_session_minutes::text,'1',
      pg_catalog.lower(v_can_apply::text),coalesce(v_blocker,''),
      pg_catalog.cardinality(v_warning_codes)::text
    ] || v_warning_codes || array[
      'true','true','true','true','true','true','true','PENDING','PLAN_REPLACED',
      'planning.plan_snapshot_v1'
    ]
  );
  v_digest := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(v_digest_input, 'UTF8'), 'sha256'), 'hex'
  );

  return pg_catalog.jsonb_build_object(
    'contract', pg_catalog.jsonb_build_object(
      'name', 'GrowthPlanReplacementPreviewV1', 'version', '1.0.0'
    ),
    'digestVersion', 'growth-plan-replacement-preview-digest/1.0.0',
    'identityVersion', 'planning-create-identity/1.0.0',
    'operation', 'replace_growth_plan',
    'commandType', 'planning.replace_growth_plan_v1',
    'idempotencyKey', p_idempotency_key,
    'reason', p_reason,
    'expectedReadinessGoalVersion', p_expected_readiness_goal_version::text,
    'expectedGrowthPlanVersion', p_expected_growth_plan_version::text,
    'source', pg_catalog.jsonb_build_object(
      'readinessGoalId', p_source#>>'{readinessGoal,readinessGoalId}',
      'readinessGoalKey', p_source#>>'{readinessGoal,readinessGoalKey}',
      'readinessGoalTitle', v_plan_title,
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
      'lifetimePlanCount', p_lifetime_plan_count,
      'currentPlanCount', 1,
      'growthPlan', pg_catalog.jsonb_build_object(
        'growthPlanId', p_growth_plan_id,
        'title', p_growth_plan_title,
        'lifecycle', pg_catalog.upper(p_growth_plan_lifecycle),
        'weeklyCapacityMinutes', p_growth_plan_weekly_capacity_minutes,
        'aggregateVersion', p_growth_plan_version::text
      ),
      'childTracks', pg_catalog.jsonb_build_object(
        'total', v_child_track_count,
        'active', v_active_track_count,
        'paused', v_paused_track_count,
        'completed', v_completed_track_count,
        'archived', v_archived_track_count,
        'fingerprint', v_child_track_fingerprint
      )
    ),
    'after', pg_catalog.jsonb_build_object(
      'lifetimePlanCount', p_lifetime_plan_count + 1,
      'currentPlanCount', 1,
      'currentPlanLimit', 1,
      'archivedPlan', pg_catalog.jsonb_build_object(
        'growthPlanId', p_growth_plan_id,
        'title', p_growth_plan_title,
        'lifecycle', 'ARCHIVED',
        'weeklyCapacityMinutes', p_growth_plan_weekly_capacity_minutes,
        'aggregateVersion', (p_growth_plan_version + 1)::text
      ),
      'growthPlan', pg_catalog.jsonb_build_object(
        'growthPlanId', v_plan_id, 'title', v_plan_title, 'lifecycle', 'ACTIVE',
        'weeklyCapacityMinutes', p_weekly_capacity_minutes, 'aggregateVersion', '1'
      ),
      'learningTrack', pg_catalog.jsonb_build_object(
        'learningTrackId', v_track_id, 'trackKey', v_track_key, 'title', v_track_title,
        'lifecycle', 'ACTIVE', 'priority', p_track_priority,
        'protectedMinimumMinutes', 0, 'cadencePerWeek', 0,
        'defaultSessionMinutes', p_default_session_minutes, 'aggregateVersion', '1'
      )
    ),
    'canApply', v_can_apply,
    'blockingReasons', case when v_blocker is null then '[]'::jsonb else
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('code', v_blocker)) end,
    'warnings', v_warnings,
    'retained', pg_catalog.jsonb_build_object(
      'readinessGoal', true, 'archivedPlan', true, 'learningTrackHistory', true,
      'activitiesAndEvidence', true, 'mastery', true, 'reviews', true, 'planSnapshots', true
    ),
    'recalculationAfterApply', pg_catalog.jsonb_build_object(
      'projectionState', 'PENDING', 'eventChangeKind', 'PLAN_REPLACED',
      'consumerName', 'planning.plan_snapshot_v1'
    ),
    'previewDigest', v_digest
  );
end
$function$;

create function api.get_growth_plan_replacement_source_v1()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_workspace_id uuid;
  v_current_count integer;
  v_plan planning.growth_plans%rowtype;
  v_constraint jsonb;
  v_targets jsonb;
  v_state text;
  v_goals jsonb := '[]'::jsonb;
  v_plan_json jsonb := 'null'::jsonb;
begin
  if identity.jwt_subject() is null then
    raise exception using errcode = '28000', message = 'an authenticated user is required';
  end if;
  v_workspace_id := identity.personal_workspace_id_for_current_user();
  if v_workspace_id is null then
    raise exception using errcode = '28000', message = 'authenticated user is not provisioned';
  end if;

  select pg_catalog.count(*)::integer into v_current_count
  from planning.growth_plans as plan
  where plan.workspace_id = v_workspace_id
    and plan.lifecycle in ('active', 'paused');
  if v_current_count > 1 then
    raise exception using errcode = '55000',
      message = 'Growth Plan replacement current Plan state is corrupt';
  end if;

  if v_current_count = 0 then
    v_state := 'NO_CURRENT_PLAN';
  else
    select plan.* into strict v_plan
    from planning.growth_plans as plan
    where plan.workspace_id = v_workspace_id
      and plan.lifecycle in ('active', 'paused');
    v_constraint := planning.growth_plan_replacement_constraint_v1(
      v_workspace_id, v_plan.growth_plan_id
    );
    v_targets := targets.get_first_growth_plan_setup_choices_v1(v_workspace_id);
    if (v_targets->>'activeGoalCount')::integer > 20 then
      v_state := 'GOAL_PORTFOLIO_OVERFLOW';
    elsif (v_targets->>'activeGoalCount')::integer = 0 then
      v_state := 'NO_ACTIVE_GOALS';
    else
      v_state := 'REPLACEMENT_AVAILABLE';
      select coalesce(pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'readinessGoalKey', choice->>'readinessGoalKey',
          'title', choice->>'title',
          'profileVersionKey', choice->>'profileVersionKey',
          'profileLabel', choice->>'profileLabel',
          'roadmapPresent', choice->'roadmapVersionId' <> 'null'::jsonb,
          'aggregateVersion', choice->>'aggregateVersion'
        ) order by choice->>'readinessGoalKey' collate "C"
      ), '[]'::jsonb) into v_goals
      from pg_catalog.jsonb_array_elements(v_targets->'goals') as choice;
      v_plan_json := pg_catalog.jsonb_build_object(
        'title', v_plan.title,
        'lifecycle', pg_catalog.upper(v_plan.lifecycle),
        'weeklyCapacityMinutes', v_plan.weekly_capacity_minutes,
        'aggregateVersion', v_plan.aggregate_version::text,
        'childTracks', pg_catalog.jsonb_build_object(
          'total', (v_constraint->>'childTrackCount')::integer,
          'active', (v_constraint->>'activeTrackCount')::integer,
          'paused', (v_constraint->>'pausedTrackCount')::integer,
          'completed', (v_constraint->>'completedTrackCount')::integer,
          'archived', (v_constraint->>'archivedTrackCount')::integer
        )
      );
    end if;
  end if;

  return pg_catalog.jsonb_build_object(
    'contract', pg_catalog.jsonb_build_object(
      'name', 'GrowthPlanReplacementSourceV1', 'version', '1.0.0'
    ),
    'state', v_state,
    'capabilities', case when v_state = 'REPLACEMENT_AVAILABLE'
      then pg_catalog.jsonb_build_array('replace_growth_plan') else '[]'::jsonb end,
    'currentPlan', case when v_state = 'REPLACEMENT_AVAILABLE' then v_plan_json
      else 'null'::jsonb end,
    'goals', case when v_state = 'REPLACEMENT_AVAILABLE' then v_goals else '[]'::jsonb end
  );
end
$function$;

create function planning.resolve_growth_plan_replacement_preview_v1(
  p_workspace_id uuid,
  p_readiness_goal_key text,
  p_expected_readiness_goal_version bigint,
  p_expected_growth_plan_version bigint,
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
  v_plan planning.growth_plans%rowtype;
  v_lifetime_count integer;
  v_current_count integer;
  v_source jsonb;
  v_constraint jsonb;
begin
  select pg_catalog.count(*)::integer,
    pg_catalog.count(*) filter (where plan.lifecycle in ('active', 'paused'))::integer
  into v_lifetime_count, v_current_count
  from planning.growth_plans as plan
  where plan.workspace_id = p_workspace_id;
  if v_current_count > 1 then
    raise exception using errcode = '55000',
      message = 'Growth Plan replacement current Plan state is corrupt';
  end if;
  if v_current_count = 0 then
    raise exception using errcode = '42501', message = 'Growth Plan is unavailable';
  end if;

  select plan.* into strict v_plan
  from planning.growth_plans as plan
  where plan.workspace_id = p_workspace_id
    and plan.lifecycle in ('active', 'paused');

  v_source := targets.resolve_first_growth_plan_setup_source_v1(
    p_workspace_id, p_readiness_goal_key
  );
  v_constraint := planning.growth_plan_replacement_constraint_v1(
    p_workspace_id, v_plan.growth_plan_id
  );
  return planning.build_growth_plan_replacement_preview_v1(
    p_workspace_id, v_source, p_expected_readiness_goal_version, p_expected_growth_plan_version,
    v_plan.growth_plan_id, v_plan.title, v_plan.lifecycle, v_plan.weekly_capacity_minutes,
    v_plan.aggregate_version, v_constraint, v_lifetime_count, p_weekly_capacity_minutes,
    p_default_session_minutes, p_track_priority, p_reason, p_idempotency_key
  );
end
$function$;

create function api.preview_growth_plan_replacement_v1(
  p_readiness_goal_key text,
  p_expected_readiness_goal_version text,
  p_expected_growth_plan_version text,
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
     or p_expected_growth_plan_version is null
     or p_expected_growth_plan_version !~ '^[1-9][0-9]{0,18}$'
     or p_expected_growth_plan_version::numeric > 9223372036854775807
     or p_weekly_capacity_minutes is null or p_weekly_capacity_minutes not between 0 and 10080
     or p_default_session_minutes is null or p_default_session_minutes not between 1 and 480
     or p_track_priority is null or p_track_priority not between 0 and 100 then
    raise exception using errcode = '22023',
      message = 'Growth Plan replacement request is invalid';
  end if;
  if p_reason is null or p_reason <> pg_catalog.btrim(p_reason)
     or pg_catalog.char_length(p_reason) not between 1 and 500
     or p_reason ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023',
      message = 'Growth Plan replacement reason is invalid';
  end if;
  if p_idempotency_key is null
     or p_idempotency_key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     then
    raise exception using errcode = '22023', message = 'idempotency key must be a UUID';
  end if;

  return planning.resolve_growth_plan_replacement_preview_v1(
    v_workspace_id, p_readiness_goal_key, p_expected_readiness_goal_version::bigint,
    p_expected_growth_plan_version::bigint, p_weekly_capacity_minutes, p_default_session_minutes,
    p_track_priority, p_reason, p_idempotency_key
  );
end
$function$;

create function api.apply_growth_plan_replacement_v1(
  p_readiness_goal_key text,
  p_expected_readiness_goal_version text,
  p_expected_growth_plan_version text,
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
  v_plan planning.growth_plans%rowtype;
  v_preview jsonb;
  v_payload jsonb;
  v_plan_id uuid;
  v_track_id uuid;
  v_track_key text;
  v_sentinel_count integer;
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
     or p_expected_growth_plan_version is null
     or p_expected_growth_plan_version !~ '^[1-9][0-9]{0,18}$'
     or p_expected_growth_plan_version::numeric > 9223372036854775807
     or p_weekly_capacity_minutes is null or p_weekly_capacity_minutes not between 0 and 10080
     or p_default_session_minutes is null or p_default_session_minutes not between 1 and 480
     or p_track_priority is null or p_track_priority not between 0 and 100 then
    raise exception using errcode = '22023',
      message = 'Growth Plan replacement request is invalid';
  end if;
  if p_reason is null or p_reason <> pg_catalog.btrim(p_reason)
     or pg_catalog.char_length(p_reason) not between 1 and 500
     or p_reason ~ '[[:cntrl:]]'
     or p_idempotency_key is null
     or p_idempotency_key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or p_preview_digest is null or p_preview_digest !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023',
      message = 'Growth Plan replacement confirmation is invalid';
  end if;

  v_plan_id := planning.derive_growth_plan_replacement_identity_v1(
    v_workspace_id, 'planning.replace_growth_plan_v1', p_idempotency_key, 'growth-plan'
  );
  v_track_id := planning.derive_growth_plan_replacement_identity_v1(
    v_workspace_id, 'planning.replace_growth_plan_v1', p_idempotency_key,
    'initial-learning-track'
  );
  v_track_key := 'track:' || pg_catalog.lower(v_track_id::text);
  v_request_hash := extensions.digest(
    pg_catalog.convert_to(
      planning.frame_named_fields_v1(
        array[
          'requestHashVersion','schemaVersion','identityVersion','workspaceId','commandType',
          'operation','idempotencyKey','readinessGoalKey','expectedReadinessGoalVersion',
          'expectedGrowthPlanVersion','weeklyCapacityMinutes','defaultSessionMinutes',
          'trackPriority','reason','previewDigest','growthPlanId','learningTrackId','trackKey'
        ],
        array[
          'growth-plan-replacement-request-hash/1.0.0','1.0.0',
          'planning-create-identity/1.0.0',pg_catalog.lower(v_workspace_id::text),
          'planning.replace_growth_plan_v1','replace_growth_plan',p_idempotency_key,
          p_readiness_goal_key,p_expected_readiness_goal_version,p_expected_growth_plan_version,
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
    v_actor_user_id::text || ':planning.replace_growth_plan_v1:' || p_idempotency_key, 0
  ));
  select receipt.* into v_receipt
  from outbox.command_receipts as receipt
  where receipt.actor_user_id = v_actor_user_id
    and receipt.command_type = 'planning.replace_growth_plan_v1'
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
  -- Lock every Plan of the workspace, then every child Track of the outgoing Plan, in one stable
  -- order shared with the released Plan and Track commands.
  perform plan.growth_plan_id
  from planning.growth_plans as plan
  where plan.workspace_id = v_workspace_id
  order by plan.growth_plan_id
  for update;
  select plan.* into v_plan
  from planning.growth_plans as plan
  where plan.workspace_id = v_workspace_id
    and plan.lifecycle in ('active', 'paused');
  if not found then
    raise exception using errcode = '42501', message = 'Growth Plan is unavailable';
  end if;
  perform track.learning_track_id
  from planning.learning_tracks as track
  where track.workspace_id = v_workspace_id
    and track.growth_plan_id = v_plan.growth_plan_id
  order by track.learning_track_id
  for update;

  select pg_catalog.count(*)::integer into v_sentinel_count
  from planning.current_plan_snapshots as pointer
  where pointer.workspace_id = v_workspace_id;
  if v_sentinel_count <> 1 then
    raise exception using errcode = '55000',
      message = 'Growth Plan replacement sentinel state is corrupt';
  end if;

  v_preview := planning.resolve_growth_plan_replacement_preview_v1(
    v_workspace_id, p_readiness_goal_key, p_expected_readiness_goal_version::bigint,
    p_expected_growth_plan_version::bigint, p_weekly_capacity_minutes, p_default_session_minutes,
    p_track_priority, p_reason, p_idempotency_key
  );
  if (v_preview->>'canApply')::boolean is not true
     or v_preview->>'previewDigest' is distinct from p_preview_digest
     or v_preview#>>'{before,growthPlan,growthPlanId}' is distinct from v_plan.growth_plan_id::text
     or v_preview#>>'{after,growthPlan,growthPlanId}' is distinct from v_plan_id::text
     or v_preview#>>'{after,learningTrack,learningTrackId}' is distinct from v_track_id::text
     or v_preview#>>'{after,learningTrack,trackKey}' is distinct from v_track_key then
    raise exception using errcode = '40001', message = 'Growth Plan replacement preview is stale';
  end if;

  insert into outbox.command_receipts (
    command_id, command_type, command_schema_version, workspace_id, actor_user_id,
    idempotency_key, request_hash, correlation_id, expected_aggregate_version
  ) values (
    v_command_id, 'planning.replace_growth_plan_v1', 1, v_workspace_id,
    v_actor_user_id, p_idempotency_key, v_request_hash, v_correlation_id,
    p_expected_growth_plan_version::bigint
  );
  get diagnostics v_affected_rows = row_count;
  if v_affected_rows <> 1 then
    raise exception using errcode = '55000',
      message = 'Growth Plan replacement receipt insert failed';
  end if;

  update planning.growth_plans
  set lifecycle = 'archived',
    aggregate_version = aggregate_version + 1,
    updated_at = pg_catalog.clock_timestamp()
  where workspace_id = v_workspace_id
    and growth_plan_id = v_plan.growth_plan_id
    and aggregate_version = p_expected_growth_plan_version::bigint
    and lifecycle in ('active', 'paused');
  get diagnostics v_affected_rows = row_count;
  if v_affected_rows <> 1 then
    raise exception using errcode = '40001',
      message = 'Growth Plan replacement archive failed';
  end if;

  insert into planning.growth_plans (
    growth_plan_id, workspace_id, title, lifecycle, weekly_capacity_minutes, aggregate_version
  ) values (
    v_plan_id, v_workspace_id, v_preview#>>'{after,growthPlan,title}', 'active',
    p_weekly_capacity_minutes, 1
  );
  get diagnostics v_affected_rows = row_count;
  if v_affected_rows <> 1 then
    raise exception using errcode = '55000',
      message = 'Growth Plan replacement Plan insert failed';
  end if;

  insert into planning.learning_tracks (
    learning_track_id, workspace_id, growth_plan_id, track_key, title,
    readiness_goal_id, profile_version_id, roadmap_version_id, lifecycle,
    priority, protected_minimum_minutes, cadence_per_week, default_session_minutes,
    aggregate_version
  ) values (
    v_track_id, v_workspace_id, v_plan_id, v_track_key,
    v_preview#>>'{after,learningTrack,title}',
    (v_preview#>>'{source,readinessGoalId}')::uuid,
    (v_preview#>>'{source,profileVersionId}')::uuid,
    (v_preview#>>'{source,roadmapVersionId}')::uuid, 'active', p_track_priority, 0, 0,
    p_default_session_minutes, 1
  );
  get diagnostics v_affected_rows = row_count;
  if v_affected_rows <> 1 then
    raise exception using errcode = '55000',
      message = 'Growth Plan replacement Track insert failed';
  end if;

  v_payload := pg_catalog.jsonb_build_object(
    'change_kind', 'PLAN_REPLACED',
    'archived_growth_plan_id', v_plan.growth_plan_id,
    'archived_growth_plan_version', (v_plan.aggregate_version + 1)::text,
    'growth_plan_id', v_plan_id,
    'learning_track_id', v_track_id,
    'readiness_goal_id', (v_preview#>>'{source,readinessGoalId}')::uuid,
    'profile_version_id', (v_preview#>>'{source,profileVersionId}')::uuid
  );
  if planning.plan_replaced_event_payload_v1_is_valid(v_payload) is not true then
    raise exception using errcode = '55000',
      message = 'Growth Plan replacement event payload is invalid';
  end if;

  insert into outbox.events (
    event_id, event_name, event_schema_version, workspace_id, aggregate_type,
    aggregate_id, aggregate_version, actor_type, actor_user_id, command_id,
    correlation_id, occurred_at, source, payload
  ) values (
    v_event_id, 'planning.input_changed', 1, v_workspace_id,
    'planning.growth_plan', v_plan_id, 1, 'user', v_actor_user_id,
    v_command_id, v_correlation_id, pg_catalog.clock_timestamp(), 'pando.database', v_payload
  );
  get diagnostics v_affected_rows = row_count;
  if v_affected_rows <> 1 then
    raise exception using errcode = '55000',
      message = 'Growth Plan replacement event insert failed';
  end if;

  insert into outbox.deliveries (
    delivery_id, event_id, workspace_id, consumer_name, handler_contract_version
  ) values (
    v_delivery_id, v_event_id, v_workspace_id, 'planning.plan_snapshot_v1', 1
  );
  get diagnostics v_affected_rows = row_count;
  if v_affected_rows <> 1 then
    raise exception using errcode = '55000',
      message = 'Growth Plan replacement delivery insert failed';
  end if;

  v_response := pg_catalog.jsonb_build_object(
    'contract', pg_catalog.jsonb_build_object(
      'name', 'GrowthPlanReplacementApplyResultV1', 'version', '1.0.0'
    ),
    'commandId', v_command_id,
    'archivedPlan', v_preview#>'{after,archivedPlan}',
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
    raise exception using errcode = '55000',
      message = 'Growth Plan replacement receipt completion failed';
  end if;
  return v_response;
end
$function$;

-- ADR-0010 section 1 makes more than one lifetime Growth Plan a legitimate replacement history.
-- Only more than one *current* Plan, or a snapshot sentinel without any Plan, remains corrupt.
create or replace function api.get_growth_plan_setup_source_v1()
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

  if v_current_count > 1 or (v_lifetime_count = 0 and v_sentinel_count <> 0) then
    raise exception using errcode = '55000', message = 'Growth Plan setup state is corrupt';
  end if;

  if v_current_count = 1 then
    v_state := 'CURRENT_PLAN_EXISTS';
  elsif v_lifetime_count >= 1 then
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

alter function planning.growth_plan_replacement_constraint_v1(uuid, uuid)
  owner to pando_planning_api;
alter function planning.derive_growth_plan_replacement_identity_v1(uuid, text, text, text)
  owner to pando_planning_api;
alter function planning.plan_replaced_event_payload_v1_is_valid(jsonb)
  owner to pando_planning_api;
alter function planning.build_growth_plan_replacement_preview_v1(
  uuid, jsonb, bigint, bigint, uuid, text, text, integer, bigint, jsonb, integer, integer,
  integer, integer, text, text
) owner to pando_planning_api;
alter function planning.resolve_growth_plan_replacement_preview_v1(
  uuid, text, bigint, bigint, integer, integer, integer, text, text
) owner to pando_planning_api;
alter function api.get_growth_plan_replacement_source_v1()
  owner to pando_planning_api;
alter function api.preview_growth_plan_replacement_v1(
  text, text, text, integer, integer, integer, text, text
) owner to pando_planning_api;
alter function api.apply_growth_plan_replacement_v1(
  text, text, text, integer, integer, integer, text, text, text
) owner to pando_planning_api;

revoke all on function
  planning.growth_plan_replacement_constraint_v1(uuid, uuid),
  planning.derive_growth_plan_replacement_identity_v1(uuid, text, text, text),
  planning.plan_replaced_event_payload_v1_is_valid(jsonb),
  planning.build_growth_plan_replacement_preview_v1(
    uuid, jsonb, bigint, bigint, uuid, text, text, integer, bigint, jsonb, integer, integer,
    integer, integer, text, text
  ),
  planning.resolve_growth_plan_replacement_preview_v1(
    uuid, text, bigint, bigint, integer, integer, integer, text, text
  ),
  api.get_growth_plan_replacement_source_v1(),
  api.preview_growth_plan_replacement_v1(
    text, text, text, integer, integer, integer, text, text
  ),
  api.apply_growth_plan_replacement_v1(
    text, text, text, integer, integer, integer, text, text, text
  )
  from public, anon, authenticated, service_role;

grant execute on function
  api.get_growth_plan_replacement_source_v1(),
  api.preview_growth_plan_replacement_v1(
    text, text, text, integer, integer, integer, text, text
  ),
  api.apply_growth_plan_replacement_v1(
    text, text, text, integer, integer, integer, text, text, text
  )
  to authenticated;

revoke create on schema planning, api from pando_planning_api;

do $migration_role_membership$
begin
  execute pg_catalog.format('revoke pando_planning_api from %I', current_user);
end
$migration_role_membership$;
