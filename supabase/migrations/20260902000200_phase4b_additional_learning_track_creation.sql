-- Phase 4B D2b3: additional Learning Track creation with exact preview and atomic apply.

do $migration_role_membership$
begin
  execute pg_catalog.format('grant pando_planning_api to %I with set true', current_user);
end
$migration_role_membership$;

grant create on schema planning, api to pando_planning_api;

grant insert on planning.learning_tracks to pando_planning_api;

create function planning.current_track_order_fingerprint_v1(
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
  v_current_track_count integer;
  v_fingerprint_input text;
  v_fingerprint text;
begin
  if p_workspace_id is null or p_growth_plan_id is null then
    raise exception using errcode = '22023',
      message = 'Learning Track current order input is invalid';
  end if;

  select pg_catalog.count(*)::integer
  into v_current_track_count
  from planning.learning_tracks as track
  where track.workspace_id = p_workspace_id
    and track.growth_plan_id = p_growth_plan_id
    and track.lifecycle in ('active', 'paused');

  if v_current_track_count > 30 then
    raise exception using errcode = '55000',
      message = 'Learning Track portfolio limit is exceeded';
  end if;

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
      'current-track-order-fingerprint/1.0.0'::text as part_value
    union all
    select 2, 'currentTrackCount', v_current_track_count::text
    union all
    select
      2 + ordered_track.track_position * 10 + field.field_position,
      field.field_name,
      field.field_value
    from (
      select
        track.learning_track_id,
        track.track_key,
        track.lifecycle,
        track.priority,
        track.aggregate_version,
        pg_catalog.row_number() over (
          order by track.priority desc, track.track_key collate "C", track.learning_track_id
        )::bigint as track_position
      from planning.learning_tracks as track
      where track.workspace_id = p_workspace_id
        and track.growth_plan_id = p_growth_plan_id
        and track.lifecycle in ('active', 'paused')
    ) as ordered_track
    cross join lateral (
      values
        (1::bigint, 'learningTrackId'::text,
          pg_catalog.lower(ordered_track.learning_track_id::text)),
        (2::bigint, 'aggregateVersion'::text, ordered_track.aggregate_version::text),
        (3::bigint, 'lifecycle'::text, pg_catalog.upper(ordered_track.lifecycle)),
        (4::bigint, 'priority'::text, ordered_track.priority::text),
        (5::bigint, 'trackKey'::text, ordered_track.track_key)
    ) as field(field_position, field_name, field_value)
  ) as fingerprint_part;

  v_fingerprint := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(v_fingerprint_input, 'UTF8'), 'sha256'),
    'hex'
  );

  return pg_catalog.jsonb_build_object(
    'currentTrackCount', v_current_track_count,
    'currentTrackOrderFingerprint', v_fingerprint
  );
end
$function$;

create function planning.projected_learning_track_creation_order_v1(
  p_workspace_id uuid,
  p_growth_plan_id uuid,
  p_learning_track_id uuid,
  p_track_key text,
  p_priority integer,
  p_aggregate_version bigint
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_current_track_count integer;
  v_target_position integer;
  v_fingerprint_input text;
  v_fingerprint text;
begin
  if p_workspace_id is null or p_growth_plan_id is null or p_learning_track_id is null
     or p_track_key is null or p_track_key !~ '^track:[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or p_priority is null or p_priority not between 0 and 100
     or p_aggregate_version is null or p_aggregate_version < 1 then
    raise exception using errcode = '22023',
      message = 'Learning Track projected create-order input is invalid';
  end if;

  with projected_tracks as (
    select
      track.learning_track_id,
      track.track_key,
      track.lifecycle,
      track.priority,
      track.aggregate_version
    from planning.learning_tracks as track
    where track.workspace_id = p_workspace_id
      and track.growth_plan_id = p_growth_plan_id
      and track.lifecycle in ('active', 'paused')
    union all
    select
      p_learning_track_id,
      p_track_key,
      'active'::text,
      p_priority,
      p_aggregate_version
  ), ordered_tracks as (
    select track.*,
      pg_catalog.row_number() over (
        order by track.priority desc, track.track_key collate "C", track.learning_track_id
      )::integer as track_position
    from projected_tracks as track
  )
  select pg_catalog.count(*)::integer,
    pg_catalog.max(track.track_position) filter (
      where track.learning_track_id = p_learning_track_id
    )
  into v_current_track_count, v_target_position
  from ordered_tracks as track;

  if v_current_track_count not between 1 and 31 or v_target_position is null then
    raise exception using errcode = '55000',
      message = 'Learning Track projected create-order invariant is violated';
  end if;

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
      'current-track-order-fingerprint/1.0.0'::text as part_value
    union all
    select 2, 'currentTrackCount', v_current_track_count::text
    union all
    select
      2 + ordered_track.track_position * 10 + field.field_position,
      field.field_name,
      field.field_value
    from (
      with projected_tracks as (
        select
          track.learning_track_id,
          track.track_key,
          track.lifecycle,
          track.priority,
          track.aggregate_version
        from planning.learning_tracks as track
        where track.workspace_id = p_workspace_id
          and track.growth_plan_id = p_growth_plan_id
          and track.lifecycle in ('active', 'paused')
        union all
        select
          p_learning_track_id,
          p_track_key,
          'active'::text,
          p_priority,
          p_aggregate_version
      )
      select track.*,
        pg_catalog.row_number() over (
          order by track.priority desc, track.track_key collate "C", track.learning_track_id
        )::bigint as track_position
      from projected_tracks as track
    ) as ordered_track
    cross join lateral (
      values
        (1::bigint, 'learningTrackId'::text,
          pg_catalog.lower(ordered_track.learning_track_id::text)),
        (2::bigint, 'aggregateVersion'::text, ordered_track.aggregate_version::text),
        (3::bigint, 'lifecycle'::text, pg_catalog.upper(ordered_track.lifecycle)),
        (4::bigint, 'priority'::text, ordered_track.priority::text),
        (5::bigint, 'trackKey'::text, ordered_track.track_key)
    ) as field(field_position, field_name, field_value)
  ) as fingerprint_part;

  v_fingerprint := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(v_fingerprint_input, 'UTF8'), 'sha256'),
    'hex'
  );

  return pg_catalog.jsonb_build_object(
    'currentTrackCount', v_current_track_count,
    'targetPosition', v_target_position,
    'currentTrackOrderFingerprint', v_fingerprint
  );
end
$function$;

create function planning.derive_learning_track_creation_identity_v1(
  p_workspace_id uuid,
  p_request_id text
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
  if p_request_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception using errcode = '22023',
      message = 'Learning Track creation identity input is invalid';
  end if;

  v_hash := pg_catalog.substring(
    extensions.digest(
      pg_catalog.convert_to(
        planning.frame_named_fields_v1(
          array['identityVersion','workspaceId','commandType','idempotencyKey','label'],
          array[
            'planning-create-identity/1.0.0',
            pg_catalog.lower(p_workspace_id::text),
            'planning.create_learning_track_v1',
            p_request_id,
            'additional-learning-track'
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

create function planning.build_learning_track_creation_preview_v1(
  p_workspace_id uuid,
  p_growth_plan_id uuid,
  p_growth_plan_title text,
  p_growth_plan_lifecycle text,
  p_weekly_capacity_minutes integer,
  p_growth_plan_version bigint,
  p_source jsonb,
  p_expected_growth_plan_version bigint,
  p_expected_readiness_goal_version bigint,
  p_title text,
  p_priority integer,
  p_default_session_minutes integer,
  p_reason text,
  p_request_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_learning_track_id uuid;
  v_track_key text;
  v_before_constraint jsonb;
  v_before_order jsonb;
  v_after_order jsonb;
  v_before_count integer;
  v_before_minimum integer;
  v_blocking_reason_code text := '';
  v_can_apply boolean;
  v_warning_count integer;
  v_warnings jsonb := '[]'::jsonb;
  v_names text[];
  v_values text[];
  v_digest_input text;
  v_digest text;
begin
  if p_workspace_id is null or p_growth_plan_id is null
     or p_growth_plan_title is null or p_growth_plan_title <> pg_catalog.btrim(p_growth_plan_title)
     or pg_catalog.char_length(p_growth_plan_title) not between 1 and 200
     or p_growth_plan_lifecycle not in ('active', 'paused')
     or p_weekly_capacity_minutes is null or p_weekly_capacity_minutes not between 0 and 10080
     or p_growth_plan_version is null or p_growth_plan_version < 1
     or p_expected_growth_plan_version is null or p_expected_growth_plan_version < 1
     or p_expected_readiness_goal_version is null or p_expected_readiness_goal_version < 1
     or p_title is null or p_title <> pg_catalog.btrim(p_title)
     or pg_catalog.char_length(p_title) not between 1 and 160
     or p_priority is null or p_priority not between 0 and 100
     or p_default_session_minutes is null or p_default_session_minutes not between 1 and 480 then
    raise exception using errcode = '22023',
      message = 'Learning Track creation preview input is invalid';
  end if;
  if p_reason is null or p_reason <> pg_catalog.btrim(p_reason)
     or pg_catalog.char_length(p_reason) not between 1 and 500
     or p_reason ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023',
      message = 'Learning Track creation reason is invalid';
  end if;
  if p_source#>>'{contract,name}' <> 'FirstGrowthPlanSetupResolvedSourceV1'
     or p_source#>>'{contract,version}' <> '1.0.0'
     or p_source#>>'{readinessGoal,lifecycle}' <> 'ACTIVE'
     or p_source->>'sourceKind' not in (
       'ROADMAP_TEMPLATE_VERSION', 'TARGET_PROFILE_REQUIREMENT_COLLECTION'
     ) then
    raise exception using errcode = '55000',
      message = 'Targets Learning Track creation source contract is invalid';
  end if;
  if p_expected_growth_plan_version <> p_growth_plan_version then
    raise exception using errcode = '40001', message = 'Growth Plan version is stale';
  end if;
  if (p_source#>>'{readinessGoal,aggregateVersion}')::bigint <> p_expected_readiness_goal_version
     or p_source->>'ownerRevision'
        <> 'readiness-goal:' || p_expected_readiness_goal_version::text then
    raise exception using errcode = '40001', message = 'Learning Track creation source is stale';
  end if;

  v_learning_track_id := planning.derive_learning_track_creation_identity_v1(
    p_workspace_id, pg_catalog.lower(p_request_id::text)
  );
  v_track_key := 'track:' || pg_catalog.lower(v_learning_track_id::text);

  v_before_constraint := planning.active_track_capacity_constraint_v1(
    p_workspace_id, p_growth_plan_id
  );
  v_before_order := planning.current_track_order_fingerprint_v1(
    p_workspace_id, p_growth_plan_id
  );
  v_after_order := planning.projected_learning_track_creation_order_v1(
    p_workspace_id, p_growth_plan_id, v_learning_track_id, v_track_key, p_priority, 1
  );
  v_before_count := (v_before_order->>'currentTrackCount')::integer;
  v_before_minimum := (v_before_constraint->>'activeProtectedMinimumMinutes')::integer;

  if v_before_count > 30 or v_before_minimum > p_weekly_capacity_minutes then
    raise exception using errcode = '55000',
      message = 'Learning Track creation invariant is violated';
  end if;

  if v_before_count = 30 then
    v_blocking_reason_code := 'TRACK_PORTFOLIO_LIMIT_REACHED';
  elsif exists (
    select 1
    from planning.learning_tracks as track
    where track.learning_track_id = v_learning_track_id or track.track_key = v_track_key
  ) then
    v_blocking_reason_code := 'PLANNING_CREATE_IDENTITY_COLLISION';
  end if;
  v_can_apply := v_blocking_reason_code = '';

  if p_growth_plan_lifecycle = 'paused' then
    v_warnings := v_warnings || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('code', 'PARENT_GROWTH_PLAN_PAUSED')
    );
  end if;
  v_warnings := v_warnings || pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object('code', 'TRACK_STARTS_EMPTY')
  );
  v_warning_count := pg_catalog.jsonb_array_length(v_warnings);

  v_names := array[
    'digestVersion','contractVersion','identityVersion','workspaceId','operation',
    'commandType','requestId','reason','expectedGrowthPlanVersion',
    'expectedReadinessGoalVersion','growthPlanTitle','growthPlanLifecycle',
    'growthPlanWeeklyCapacityMinutes','growthPlanAggregateVersion',
    'readinessGoalId','readinessGoalKey','readinessGoalTitle','readinessGoalLifecycle',
    'readinessGoalVersion','profileVersionId','profileVersionKey','sourceKind','sourceRef',
    'roadmapVersionId','sourceOwnerRevision','currentTrackCountBefore',
    'currentTrackCountAfter','currentTrackLimit','activeProtectedMinimumMinutesBefore',
    'activeProtectedMinimumMinutesAfter','flexibleMinutesBefore','flexibleMinutesAfter',
    'currentTrackOrderFingerprintBefore','currentTrackOrderFingerprintAfter','newTrackPosition',
    'learningTrackId','trackKey','learningTrackTitle','learningTrackLifecycle',
    'learningTrackPriority','learningTrackProtectedMinimumMinutes',
    'learningTrackDefaultSessionMinutes','learningTrackAggregateVersion','canApply',
    'blockingReasonCode','warningCount'
  ];
  v_values := array[
    'learning-track-creation-preview-digest/1.0.0',
    '1.0.0',
    'planning-create-identity/1.0.0',
    pg_catalog.lower(p_workspace_id::text),
    'create_learning_track',
    'planning.create_learning_track_v1',
    pg_catalog.lower(p_request_id::text),
    p_reason,
    p_expected_growth_plan_version::text,
    p_expected_readiness_goal_version::text,
    p_growth_plan_title,
    pg_catalog.upper(p_growth_plan_lifecycle),
    p_weekly_capacity_minutes::text,
    p_growth_plan_version::text,
    pg_catalog.lower((p_source#>>'{readinessGoal,readinessGoalId}')::uuid::text),
    p_source#>>'{readinessGoal,readinessGoalKey}',
    p_source#>>'{readinessGoal,title}',
    p_source#>>'{readinessGoal,lifecycle}',
    p_source#>>'{readinessGoal,aggregateVersion}',
    pg_catalog.lower((p_source#>>'{targetProfile,profileVersionId}')::uuid::text),
    p_source#>>'{targetProfile,profileVersionKey}',
    p_source->>'sourceKind',
    pg_catalog.lower(p_source->>'sourceRef'),
    coalesce(pg_catalog.lower(p_source->>'roadmapVersionId'), ''),
    p_source->>'ownerRevision',
    v_before_count::text,
    (v_after_order->>'currentTrackCount'),
    '30',
    v_before_minimum::text,
    v_before_minimum::text,
    (p_weekly_capacity_minutes - v_before_minimum)::text,
    (p_weekly_capacity_minutes - v_before_minimum)::text,
    v_before_order->>'currentTrackOrderFingerprint',
    v_after_order->>'currentTrackOrderFingerprint',
    v_after_order->>'targetPosition',
    pg_catalog.lower(v_learning_track_id::text),
    v_track_key,
    p_title,
    'ACTIVE',
    p_priority::text,
    '0',
    p_default_session_minutes::text,
    '1',
    pg_catalog.lower(v_can_apply::text),
    v_blocking_reason_code,
    v_warning_count::text
  ];
  if v_warning_count > 0 then
    for i in 0..(v_warning_count - 1) loop
      v_names := pg_catalog.array_append(v_names, 'warningCode');
      v_values := pg_catalog.array_append(v_values, v_warnings->i->>'code');
    end loop;
  end if;
  v_names := v_names || array[
    'retainedPlanHistory','retainedTrackHistory','retainedActivitiesAndEvidence',
    'retainedMasteryAndReadiness','retainedReviewQueue','retainedPlanSnapshots',
    'projectionStateAfterApply','eventChangeKind','consumerName'
  ];
  v_values := v_values || array[
    'true','true','true','true','true','true','PENDING','TRACK_CREATED',
    'planning.plan_snapshot_v1'
  ];
  v_digest_input := planning.frame_named_fields_v1(v_names, v_values);
  v_digest := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(v_digest_input, 'UTF8'), 'sha256'),
    'hex'
  );

  return pg_catalog.jsonb_build_object(
    'contract', pg_catalog.jsonb_build_object(
      'name', 'LearningTrackCreationPreviewV1', 'version', '1.0.0'
    ),
    'digestVersion', 'learning-track-creation-preview-digest/1.0.0',
    'identityVersion', 'planning-create-identity/1.0.0',
    'operation', 'create_learning_track',
    'commandType', 'planning.create_learning_track_v1',
    'requestId', p_request_id,
    'reason', p_reason,
    'expectedGrowthPlanVersion', p_expected_growth_plan_version::text,
    'expectedReadinessGoalVersion', p_expected_readiness_goal_version::text,
    'growthPlan', pg_catalog.jsonb_build_object(
      'title', p_growth_plan_title,
      'lifecycle', pg_catalog.upper(p_growth_plan_lifecycle),
      'weeklyCapacityMinutes', p_weekly_capacity_minutes,
      'aggregateVersion', p_growth_plan_version::text
    ),
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
    'constraint', pg_catalog.jsonb_build_object(
      'currentTrackCountBefore', v_before_count,
      'currentTrackCountAfter', (v_after_order->>'currentTrackCount')::integer,
      'currentTrackLimit', 30,
      'activeProtectedMinimumMinutesBefore', v_before_minimum,
      'activeProtectedMinimumMinutesAfter', v_before_minimum,
      'flexibleMinutesBefore', p_weekly_capacity_minutes - v_before_minimum,
      'flexibleMinutesAfter', p_weekly_capacity_minutes - v_before_minimum,
      'currentTrackOrderFingerprintBefore', v_before_order->>'currentTrackOrderFingerprint',
      'currentTrackOrderFingerprintAfter', v_after_order->>'currentTrackOrderFingerprint',
      'newTrackPosition', (v_after_order->>'targetPosition')::integer
    ),
    'learningTrack', pg_catalog.jsonb_build_object(
      'learningTrackId', v_learning_track_id,
      'trackKey', v_track_key,
      'title', p_title,
      'lifecycle', 'ACTIVE',
      'priority', p_priority,
      'protectedMinimumMinutes', 0,
      'defaultSessionMinutes', p_default_session_minutes,
      'aggregateVersion', '1'
    ),
    'canApply', v_can_apply,
    'blockingReasons', case when v_blocking_reason_code = '' then '[]'::jsonb else
      pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('code', v_blocking_reason_code)
      ) end,
    'warnings', case
      when p_growth_plan_lifecycle = 'paused' then pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('code', 'PARENT_GROWTH_PLAN_PAUSED'),
        pg_catalog.jsonb_build_object('code', 'TRACK_STARTS_EMPTY')
      )
      else pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('code', 'TRACK_STARTS_EMPTY')
      )
    end,
    'retained', pg_catalog.jsonb_build_object(
      'planHistory', true,
      'trackHistory', true,
      'activitiesAndEvidence', true,
      'masteryAndReadiness', true,
      'reviewQueue', true,
      'planSnapshots', true
    ),
    'recalculationAfterApply', pg_catalog.jsonb_build_object(
      'projectionState', 'PENDING',
      'eventChangeKind', 'TRACK_CREATED',
      'consumerName', 'planning.plan_snapshot_v1'
    ),
    'previewDigest', v_digest
  );
end
$function$;

create function planning.track_created_event_payload_v1_is_valid(p_payload jsonb)
returns boolean
language sql
immutable
strict
set search_path = ''
as $function$
  select pg_catalog.jsonb_typeof(p_payload) = 'object'
    and (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(p_payload)) = 6
    and p_payload->>'change_kind' = 'TRACK_CREATED'
    and p_payload->>'growth_plan_id'
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and p_payload->>'learning_track_id'
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and case
      when p_payload->>'learning_track_version' ~ '^[1-9][0-9]{0,18}$'
        then (p_payload->>'learning_track_version')::numeric <= 9223372036854775807
      else false
    end
    and p_payload->>'readiness_goal_id'
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and p_payload->>'profile_version_id'
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
$function$;

create function api.get_learning_track_creation_source_v1()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_workspace_id uuid;
  v_current_plan_count integer;
  v_track_count integer;
  v_plan planning.growth_plans%rowtype;
  v_targets jsonb;
  v_state text;
  v_goals jsonb := '[]'::jsonb;
begin
  if identity.jwt_subject() is null then
    raise exception using errcode = '28000', message = 'an authenticated user is required';
  end if;
  v_workspace_id := identity.personal_workspace_id_for_current_user();
  if v_workspace_id is null then
    raise exception using errcode = '28000', message = 'authenticated user is not provisioned';
  end if;

  select pg_catalog.count(*)::integer into v_current_plan_count
  from planning.growth_plans as plan
  where plan.workspace_id = v_workspace_id
    and plan.lifecycle in ('active', 'paused');
  if v_current_plan_count > 1 then
    raise exception using errcode = '55000',
      message = 'Learning Track creation current Plan state is corrupt';
  end if;
  if v_current_plan_count = 0 then
    return pg_catalog.jsonb_build_object(
      'contract', pg_catalog.jsonb_build_object(
        'name', 'LearningTrackCreationSourceV1', 'version', '1.0.0'
      ),
      'state', 'NO_CURRENT_PLAN',
      'capabilities', '[]'::jsonb,
      'growthPlan', null,
      'trackPortfolio', null,
      'goals', '[]'::jsonb
    );
  end if;

  select plan.* into strict v_plan
  from planning.growth_plans as plan
  where plan.workspace_id = v_workspace_id
    and plan.lifecycle in ('active', 'paused');

  select pg_catalog.count(*)::integer into v_track_count
  from planning.learning_tracks as track
  where track.workspace_id = v_workspace_id
    and track.growth_plan_id = v_plan.growth_plan_id
    and track.lifecycle in ('active', 'paused');
  if v_track_count > 30 then
    raise exception using errcode = '55000',
      message = 'Learning Track portfolio limit is exceeded';
  end if;

  if v_track_count = 30 then
    v_state := 'TRACK_PORTFOLIO_LIMIT_REACHED';
  else
    v_targets := targets.get_first_growth_plan_setup_choices_v1(v_workspace_id);
    if v_targets#>>'{contract,name}' <> 'FirstGrowthPlanSetupChoicesV1'
       or v_targets#>>'{contract,version}' <> '1.0.0' then
      raise exception using errcode = '55000',
        message = 'Targets Learning Track creation choices contract is invalid';
    end if;
    if (v_targets->>'activeGoalCount')::integer > 20 then
      v_state := 'GOAL_PORTFOLIO_OVERFLOW';
    elsif (v_targets->>'activeGoalCount')::integer = 0 then
      v_state := 'NO_ACTIVE_GOALS';
    else
      v_state := 'READY';
      select coalesce(pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'readinessGoalKey', choice->>'readinessGoalKey',
          'title', choice->>'title',
          'profileLabel', choice->>'profileLabel',
          'profileVersionKey', choice->>'profileVersionKey',
          'roadmapPresent', choice->'roadmapVersionId' <> 'null'::jsonb,
          'aggregateVersion', choice->>'aggregateVersion'
        ) order by choice->>'readinessGoalKey' collate "C"
      ), '[]'::jsonb) into v_goals
      from pg_catalog.jsonb_array_elements(v_targets->'goals') as choice;
    end if;
  end if;

  return pg_catalog.jsonb_build_object(
    'contract', pg_catalog.jsonb_build_object(
      'name', 'LearningTrackCreationSourceV1', 'version', '1.0.0'
    ),
    'state', v_state,
    'capabilities', case when v_state = 'READY'
      then pg_catalog.jsonb_build_array('create_learning_track') else '[]'::jsonb end,
    'growthPlan', pg_catalog.jsonb_build_object(
      'title', v_plan.title,
      'lifecycle', pg_catalog.upper(v_plan.lifecycle),
      'weeklyCapacityMinutes', v_plan.weekly_capacity_minutes,
      'aggregateVersion', v_plan.aggregate_version::text
    ),
    'trackPortfolio', pg_catalog.jsonb_build_object(
      'currentTrackCount', v_track_count,
      'currentTrackLimit', 30
    ),
    'goals', case when v_state = 'READY' then v_goals else '[]'::jsonb end
  );
end
$function$;

create function api.preview_learning_track_creation_v1(
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
  v_workspace_id uuid;
  v_plan planning.growth_plans%rowtype;
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
     or p_readiness_goal_key !~ '^goal:[a-z0-9][a-z0-9-]{1,100}$'
     or p_expected_readiness_goal_version is null
     or p_expected_readiness_goal_version !~ '^[1-9][0-9]{0,18}$'
     or p_expected_growth_plan_version is null
     or p_expected_growth_plan_version !~ '^[1-9][0-9]{0,18}$'
     or p_expected_readiness_goal_version::numeric > 9223372036854775807
     or p_expected_growth_plan_version::numeric > 9223372036854775807
     or p_priority is null or p_priority not between 0 and 100
     or p_default_session_minutes is null or p_default_session_minutes not between 1 and 480
     or p_title is null or p_title <> pg_catalog.btrim(p_title)
     or pg_catalog.char_length(p_title) not between 1 and 160
     or p_title ~ '[[:cntrl:]]'
     or p_request_id is null
     or p_request_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception using errcode = '22023',
      message = 'Learning Track creation preview request is invalid';
  end if;
  if p_reason is null or p_reason <> pg_catalog.btrim(p_reason)
     or pg_catalog.char_length(p_reason) not between 1 and 500
     or p_reason ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023',
      message = 'Learning Track creation reason is invalid';
  end if;

  select plan.* into v_plan
  from planning.growth_plans as plan
  where plan.workspace_id = v_workspace_id
    and plan.lifecycle in ('active', 'paused');
  if not found then
    raise exception using errcode = '42501',
      message = 'Learning Track creation source is unavailable';
  end if;

  v_source := targets.resolve_first_growth_plan_setup_source_v1(
    v_workspace_id, p_readiness_goal_key
  );
  return planning.build_learning_track_creation_preview_v1(
    v_workspace_id,
    v_plan.growth_plan_id,
    v_plan.title,
    v_plan.lifecycle,
    v_plan.weekly_capacity_minutes,
    v_plan.aggregate_version,
    v_source,
    p_expected_growth_plan_version::bigint,
    p_expected_readiness_goal_version::bigint,
    p_title,
    p_priority,
    p_default_session_minutes,
    p_reason,
    p_request_id::uuid
  );
end
$function$;

create function api.apply_learning_track_creation_v1(
  p_readiness_goal_key text,
  p_expected_readiness_goal_version text,
  p_title text,
  p_priority integer,
  p_default_session_minutes integer,
  p_expected_growth_plan_version text,
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
  v_plan planning.growth_plans%rowtype;
  v_source jsonb;
  v_preview jsonb;
  v_learning_track_id uuid;
  v_track_key text;
  v_request_hash bytea;
  v_receipt outbox.command_receipts%rowtype;
  v_command_id uuid := gen_random_uuid();
  v_correlation_id uuid := gen_random_uuid();
  v_event_id uuid := gen_random_uuid();
  v_delivery_id uuid := gen_random_uuid();
  v_payload jsonb;
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
     or p_expected_growth_plan_version is null
     or p_expected_growth_plan_version !~ '^[1-9][0-9]{0,18}$'
     or p_expected_readiness_goal_version::numeric > 9223372036854775807
     or p_expected_growth_plan_version::numeric > 9223372036854775807
     or p_priority is null or p_priority not between 0 and 100
     or p_default_session_minutes is null or p_default_session_minutes not between 1 and 480
     or p_title is null or p_title <> pg_catalog.btrim(p_title)
     or pg_catalog.char_length(p_title) not between 1 and 160
     or p_title ~ '[[:cntrl:]]'
     or p_request_id is null
     or p_request_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or p_preview_digest is null or p_preview_digest !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023',
      message = 'Learning Track creation confirmation is invalid';
  end if;
  if p_reason is null or p_reason <> pg_catalog.btrim(p_reason)
     or pg_catalog.char_length(p_reason) not between 1 and 500
     or p_reason ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023',
      message = 'Learning Track creation reason is invalid';
  end if;

  v_learning_track_id := planning.derive_learning_track_creation_identity_v1(
    v_workspace_id, p_request_id
  );
  v_track_key := 'track:' || pg_catalog.lower(v_learning_track_id::text);
  v_request_hash := extensions.digest(
    pg_catalog.convert_to(
      planning.frame_named_fields_v1(
        array[
          'requestHashVersion','schemaVersion','identityVersion','workspaceId',
          'commandType','operation','requestId','readinessGoalKey',
          'expectedReadinessGoalVersion','title','priority','defaultSessionMinutes',
          'expectedGrowthPlanVersion','reason','previewDigest','learningTrackId','trackKey'
        ],
        array[
          'learning-track-creation-request-hash/1.0.0',
          '1.0.0',
          'planning-create-identity/1.0.0',
          pg_catalog.lower(v_workspace_id::text),
          'planning.create_learning_track_v1',
          'create_learning_track',
          p_request_id,
          p_readiness_goal_key,
          p_expected_readiness_goal_version,
          p_title,
          p_priority::text,
          p_default_session_minutes::text,
          p_expected_growth_plan_version,
          p_reason,
          p_preview_digest,
          pg_catalog.lower(v_learning_track_id::text),
          v_track_key
        ]
      ),
      'UTF8'
    ),
    'sha256'
  );

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    v_actor_user_id::text || ':planning.create_learning_track_v1:' || p_request_id, 0
  ));
  select receipt.* into v_receipt
  from outbox.command_receipts as receipt
  where receipt.actor_user_id = v_actor_user_id
    and receipt.command_type = 'planning.create_learning_track_v1'
    and receipt.idempotency_key = p_request_id
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
  select plan.* into v_plan
  from planning.growth_plans as plan
  where plan.workspace_id = v_workspace_id
    and plan.lifecycle in ('active', 'paused')
  for update;
  if not found then
    raise exception using errcode = '42501',
      message = 'Learning Track creation source is unavailable';
  end if;

  perform track.learning_track_id
  from planning.learning_tracks as track
  where track.workspace_id = v_workspace_id
    and track.growth_plan_id = v_plan.growth_plan_id
  order by track.learning_track_id
  for update;

  v_source := targets.resolve_first_growth_plan_setup_source_v1(
    v_workspace_id, p_readiness_goal_key
  );
  v_preview := planning.build_learning_track_creation_preview_v1(
    v_workspace_id,
    v_plan.growth_plan_id,
    v_plan.title,
    v_plan.lifecycle,
    v_plan.weekly_capacity_minutes,
    v_plan.aggregate_version,
    v_source,
    p_expected_growth_plan_version::bigint,
    p_expected_readiness_goal_version::bigint,
    p_title,
    p_priority,
    p_default_session_minutes,
    p_reason,
    p_request_id::uuid
  );
  if (v_preview->>'canApply')::boolean is not true
     or v_preview->>'previewDigest' is distinct from p_preview_digest
     or v_preview#>>'{learningTrack,learningTrackId}' is distinct from v_learning_track_id::text
     or v_preview#>>'{learningTrack,trackKey}' is distinct from v_track_key then
    raise exception using errcode = '40001',
      message = 'Learning Track creation preview is stale';
  end if;

  insert into outbox.command_receipts (
    command_id, command_type, command_schema_version, workspace_id, actor_user_id,
    idempotency_key, request_hash, correlation_id, expected_aggregate_version
  ) values (
    v_command_id, 'planning.create_learning_track_v1', 1, v_workspace_id, v_actor_user_id,
    p_request_id, v_request_hash, v_correlation_id, p_expected_growth_plan_version::bigint
  );
  get diagnostics v_affected_rows = row_count;
  if v_affected_rows <> 1 then
    raise exception using errcode = '55000',
      message = 'Learning Track creation receipt insert failed';
  end if;

  insert into planning.learning_tracks (
    learning_track_id, workspace_id, growth_plan_id, track_key, title,
    readiness_goal_id, profile_version_id, roadmap_version_id, lifecycle,
    priority, protected_minimum_minutes, default_session_minutes, aggregate_version
  ) values (
    v_learning_track_id,
    v_workspace_id,
    v_plan.growth_plan_id,
    v_track_key,
    p_title,
    (v_source#>>'{readinessGoal,readinessGoalId}')::uuid,
    (v_source#>>'{targetProfile,profileVersionId}')::uuid,
    (v_source->>'roadmapVersionId')::uuid,
    'active',
    p_priority,
    0,
    p_default_session_minutes,
    1
  );
  get diagnostics v_affected_rows = row_count;
  if v_affected_rows <> 1 then
    raise exception using errcode = '55000',
      message = 'Learning Track creation insert failed';
  end if;

  v_payload := pg_catalog.jsonb_build_object(
    'change_kind', 'TRACK_CREATED',
    'growth_plan_id', v_plan.growth_plan_id,
    'learning_track_id', v_learning_track_id,
    'learning_track_version', '1',
    'readiness_goal_id', (v_source#>>'{readinessGoal,readinessGoalId}')::uuid,
    'profile_version_id', (v_source#>>'{targetProfile,profileVersionId}')::uuid
  );
  if planning.track_created_event_payload_v1_is_valid(v_payload) is not true then
    raise exception using errcode = '55000',
      message = 'Learning Track creation event payload is invalid';
  end if;

  insert into outbox.events (
    event_id, event_name, event_schema_version, workspace_id, aggregate_type,
    aggregate_id, aggregate_version, actor_type, actor_user_id, command_id,
    correlation_id, occurred_at, source, payload
  ) values (
    v_event_id, 'planning.input_changed', 1, v_workspace_id,
    'planning.learning_track', v_learning_track_id, 1,
    'user', v_actor_user_id, v_command_id, v_correlation_id,
    pg_catalog.clock_timestamp(), 'pando.database', v_payload
  );
  get diagnostics v_affected_rows = row_count;
  if v_affected_rows <> 1 then
    raise exception using errcode = '55000',
      message = 'Learning Track creation event insert failed';
  end if;

  insert into outbox.deliveries (
    delivery_id, event_id, workspace_id, consumer_name, handler_contract_version
  ) values (
    v_delivery_id, v_event_id, v_workspace_id, 'planning.plan_snapshot_v1', 1
  );
  get diagnostics v_affected_rows = row_count;
  if v_affected_rows <> 1 then
    raise exception using errcode = '55000',
      message = 'Learning Track creation delivery insert failed';
  end if;

  v_response := pg_catalog.jsonb_build_object(
    'contract', pg_catalog.jsonb_build_object(
      'name', 'LearningTrackCreationApplyResultV1', 'version', '1.0.0'
    ),
    'commandId', v_command_id,
    'createdTrack', v_preview->'learningTrack',
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
    raise exception using errcode = '55000',
      message = 'Learning Track creation receipt completion failed';
  end if;

  return v_response;
end
$function$;

alter function planning.current_track_order_fingerprint_v1(uuid, uuid)
  owner to pando_planning_api;
alter function planning.projected_learning_track_creation_order_v1(
  uuid, uuid, uuid, text, integer, bigint
) owner to pando_planning_api;
alter function planning.derive_learning_track_creation_identity_v1(uuid, text)
  owner to pando_planning_api;
alter function planning.build_learning_track_creation_preview_v1(
  uuid, uuid, text, text, integer, bigint, jsonb, bigint, bigint, text, integer,
  integer, text, uuid
) owner to pando_planning_api;
alter function planning.track_created_event_payload_v1_is_valid(jsonb)
  owner to pando_planning_api;
alter function api.get_learning_track_creation_source_v1()
  owner to pando_planning_api;
alter function api.preview_learning_track_creation_v1(
  text, text, text, integer, integer, text, text, text
) owner to pando_planning_api;
alter function api.apply_learning_track_creation_v1(
  text, text, text, integer, integer, text, text, text, text
) owner to pando_planning_api;

revoke all on function
  planning.current_track_order_fingerprint_v1(uuid, uuid),
  planning.projected_learning_track_creation_order_v1(
    uuid, uuid, uuid, text, integer, bigint
  ),
  planning.derive_learning_track_creation_identity_v1(uuid, text),
  planning.build_learning_track_creation_preview_v1(
    uuid, uuid, text, text, integer, bigint, jsonb, bigint, bigint, text, integer,
    integer, text, uuid
  ),
  planning.track_created_event_payload_v1_is_valid(jsonb),
  api.get_learning_track_creation_source_v1(),
  api.preview_learning_track_creation_v1(
    text, text, text, integer, integer, text, text, text
  ),
  api.apply_learning_track_creation_v1(
    text, text, text, integer, integer, text, text, text, text
  )
  from public, anon, authenticated, service_role;

grant execute on function
  api.get_learning_track_creation_source_v1(),
  api.preview_learning_track_creation_v1(
    text, text, text, integer, integer, text, text, text
  ),
  api.apply_learning_track_creation_v1(
    text, text, text, integer, integer, text, text, text, text
  )
  to authenticated;

revoke create on schema planning, api from pando_planning_api;

do $migration_role_membership$
begin
  execute pg_catalog.format('revoke pando_planning_api from %I', current_user);
end
$migration_role_membership$;
