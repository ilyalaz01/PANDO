-- Phase 4B D2b4: bounded terminal Track history plus deterministic complete/archive commands.

do $migration_role_membership$
begin
  execute pg_catalog.format('grant pando_planning_api to %I with set true', current_user);
end
$migration_role_membership$;

grant create on schema planning, api to pando_planning_api;

create function planning.projected_terminal_track_constraints_v1(
  p_workspace_id uuid,
  p_growth_plan_id uuid,
  p_learning_track_id uuid,
  p_projected_lifecycle text,
  p_projected_aggregate_version bigint
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_current_track_count integer;
  v_active_track_count integer;
  v_active_protected_minimum_minutes integer;
  v_current_fingerprint_input text;
  v_current_fingerprint text;
  v_active_fingerprint_input text;
  v_active_fingerprint text;
begin
  if p_workspace_id is null or p_growth_plan_id is null or p_learning_track_id is null
     or p_projected_lifecycle not in ('active', 'paused', 'completed', 'archived')
     or p_projected_aggregate_version is null or p_projected_aggregate_version < 1 then
    raise exception using errcode = '22023',
      message = 'Learning Track terminal projection input is invalid';
  end if;

  with projected_tracks as (
    select
      track.learning_track_id,
      track.track_key,
      case when track.learning_track_id = p_learning_track_id
        then p_projected_lifecycle else track.lifecycle end as lifecycle,
      track.priority,
      track.protected_minimum_minutes,
      case when track.learning_track_id = p_learning_track_id
        then p_projected_aggregate_version else track.aggregate_version end as aggregate_version
    from planning.learning_tracks as track
    where track.workspace_id = p_workspace_id
      and track.growth_plan_id = p_growth_plan_id
  )
  select pg_catalog.count(*) filter (
      where track.lifecycle in ('active', 'paused')
    )::integer,
    pg_catalog.count(*) filter (where track.lifecycle = 'active')::integer,
    coalesce(pg_catalog.sum(track.protected_minimum_minutes) filter (
      where track.lifecycle = 'active'
    ), 0)::integer
  into v_current_track_count, v_active_track_count, v_active_protected_minimum_minutes
  from projected_tracks as track;

  with projected_tracks as (
    select
      track.learning_track_id,
      track.track_key,
      case when track.learning_track_id = p_learning_track_id
        then p_projected_lifecycle else track.lifecycle end as lifecycle,
      track.priority,
      case when track.learning_track_id = p_learning_track_id
        then p_projected_aggregate_version else track.aggregate_version end as aggregate_version
    from planning.learning_tracks as track
    where track.workspace_id = p_workspace_id
      and track.growth_plan_id = p_growth_plan_id
  ), ordered_tracks as (
    select track.*,
      pg_catalog.row_number() over (
        order by track.priority desc, track.track_key collate "C", track.learning_track_id
      )::bigint as track_position
    from projected_tracks as track
    where track.lifecycle in ('active', 'paused')
  )
  select pg_catalog.string_agg(
    fingerprint_part.part_name || ':'
      || pg_catalog.octet_length(
        pg_catalog.convert_to(fingerprint_part.part_value, 'UTF8')
      )::text
      || ':' || fingerprint_part.part_value || pg_catalog.chr(10),
    '' order by fingerprint_part.part_position
  ) into v_current_fingerprint_input
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
    from ordered_tracks as ordered_track
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

  with projected_tracks as (
    select
      track.learning_track_id,
      case when track.learning_track_id = p_learning_track_id
        then p_projected_lifecycle else track.lifecycle end as lifecycle,
      track.protected_minimum_minutes,
      case when track.learning_track_id = p_learning_track_id
        then p_projected_aggregate_version else track.aggregate_version end as aggregate_version
    from planning.learning_tracks as track
    where track.workspace_id = p_workspace_id
      and track.growth_plan_id = p_growth_plan_id
  )
  select pg_catalog.string_agg(
    fingerprint_part.part_name || ':'
      || pg_catalog.octet_length(
        pg_catalog.convert_to(fingerprint_part.part_value, 'UTF8')
      )::text
      || ':' || fingerprint_part.part_value || pg_catalog.chr(10),
    '' order by fingerprint_part.part_position
  ) into v_active_fingerprint_input
  from (
    select 1::bigint as part_position,
      'fingerprintVersion'::text as part_name,
      'active-track-constraint-fingerprint/1.0.0'::text as part_value
    union all
    select 2, 'activeTrackCount', v_active_track_count::text
    union all
    select
      2 + ordered_track.track_position * 10 + field.field_position,
      field.field_name,
      field.field_value
    from (
      select track.*,
        pg_catalog.row_number() over (order by track.learning_track_id)::bigint as track_position
      from projected_tracks as track
      where track.lifecycle = 'active'
    ) as ordered_track
    cross join lateral (
      values
        (1::bigint, 'learningTrackId'::text,
          pg_catalog.lower(ordered_track.learning_track_id::text)),
        (2::bigint, 'aggregateVersion'::text, ordered_track.aggregate_version::text),
        (3::bigint, 'lifecycle'::text, pg_catalog.upper(ordered_track.lifecycle)),
        (4::bigint, 'protectedMinimumMinutes'::text,
          ordered_track.protected_minimum_minutes::text)
    ) as field(field_position, field_name, field_value)
  ) as fingerprint_part;

  v_current_fingerprint := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(v_current_fingerprint_input, 'UTF8'), 'sha256'),
    'hex'
  );
  v_active_fingerprint := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(v_active_fingerprint_input, 'UTF8'), 'sha256'),
    'hex'
  );

  return pg_catalog.jsonb_build_object(
    'currentTrackCount', v_current_track_count,
    'currentTrackOrderFingerprint', v_current_fingerprint,
    'activeTrackCount', v_active_track_count,
    'activeProtectedMinimumMinutes', v_active_protected_minimum_minutes,
    'activeTrackFingerprint', v_active_fingerprint
  );
end
$function$;

create function planning.build_learning_track_terminal_lifecycle_preview_v1(
  p_workspace_id uuid,
  p_growth_plan_id uuid,
  p_growth_plan_lifecycle text,
  p_weekly_capacity_minutes integer,
  p_growth_plan_version bigint,
  p_learning_track_id uuid,
  p_track_key text,
  p_title text,
  p_learning_track_lifecycle text,
  p_priority integer,
  p_protected_minimum_minutes integer,
  p_learning_track_version bigint,
  p_operation text,
  p_expected_growth_plan_version bigint,
  p_expected_learning_track_version bigint,
  p_reason text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_after_lifecycle text;
  v_after_version bigint;
  v_before_constraint jsonb;
  v_after_constraint jsonb;
  v_warning_code text;
  v_visibility_before text;
  v_digest_input text;
  v_digest text;
begin
  if p_workspace_id is null or p_growth_plan_id is null or p_learning_track_id is null
     or p_growth_plan_lifecycle not in ('active', 'paused')
     or p_weekly_capacity_minutes is null or p_weekly_capacity_minutes not between 0 and 10080
     or p_growth_plan_version is null or p_growth_plan_version < 1
     or p_learning_track_lifecycle not in ('active', 'paused', 'completed')
     or p_priority is null or p_priority not between 0 and 100
     or p_protected_minimum_minutes is null
     or p_protected_minimum_minutes not between 0 and 10080
     or p_learning_track_version is null or p_learning_track_version < 1
     or p_expected_growth_plan_version is null or p_expected_growth_plan_version < 1
     or p_expected_learning_track_version is null or p_expected_learning_track_version < 1 then
    raise exception using errcode = '22023',
      message = 'Learning Track terminal preview input is invalid';
  end if;
  if p_track_key is null or p_track_key !~ '^track:[a-z0-9][a-z0-9-]{1,100}$'
     or p_title is null or p_title <> pg_catalog.btrim(p_title)
     or pg_catalog.char_length(p_title) not between 1 and 160 then
    raise exception using errcode = '22023',
      message = 'Learning Track terminal preview input is invalid';
  end if;
  if p_operation not in ('complete_track', 'archive_track') then
    raise exception using errcode = '22023',
      message = 'Learning Track terminal lifecycle operation is invalid';
  end if;
  if p_reason is null or p_reason <> pg_catalog.btrim(p_reason)
     or pg_catalog.char_length(p_reason) not between 1 and 500
     or p_reason ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023',
      message = 'Learning Track terminal lifecycle reason is invalid';
  end if;
  if p_expected_growth_plan_version <> p_growth_plan_version then
    raise exception using errcode = '40001', message = 'Growth Plan version is stale';
  end if;
  if p_expected_learning_track_version <> p_learning_track_version then
    raise exception using errcode = '40001', message = 'Learning Track version is stale';
  end if;
  if p_learning_track_version = 9223372036854775807 then
    raise exception using errcode = '22003', message = 'Learning Track version is exhausted';
  end if;

  if p_operation = 'complete_track'
     and p_learning_track_lifecycle in ('active', 'paused') then
    v_after_lifecycle := 'completed';
    v_warning_code := 'TRACK_COMPLETION_IS_TERMINAL_AND_NOT_MASTERY';
  elsif p_operation = 'archive_track'
        and p_learning_track_lifecycle in ('active', 'paused', 'completed') then
    v_after_lifecycle := 'archived';
    v_warning_code := 'TRACK_ARCHIVE_IS_TERMINAL_NOT_DELETION';
  else
    raise exception using errcode = '22023',
      message = 'Learning Track terminal lifecycle transition is invalid';
  end if;
  v_after_version := p_learning_track_version + 1;
  v_visibility_before := case when p_learning_track_lifecycle = 'completed'
    then 'TERMINAL_HISTORY' else 'CURRENT_PLAN' end;

  v_before_constraint := planning.projected_terminal_track_constraints_v1(
    p_workspace_id, p_growth_plan_id, p_learning_track_id,
    p_learning_track_lifecycle, p_learning_track_version
  );
  v_after_constraint := planning.projected_terminal_track_constraints_v1(
    p_workspace_id, p_growth_plan_id, p_learning_track_id,
    v_after_lifecycle, v_after_version
  );
  if (v_before_constraint->>'currentTrackCount')::integer > 30
     or (v_before_constraint->>'activeTrackCount')::integer > 30
     or (v_before_constraint->>'activeProtectedMinimumMinutes')::integer
       > p_weekly_capacity_minutes then
    raise exception using errcode = '55000',
      message = 'Growth Plan Track invariant is violated';
  end if;

  select pg_catalog.string_agg(
    digest_field.field_name || ':'
      || pg_catalog.octet_length(
        pg_catalog.convert_to(digest_field.field_value, 'UTF8')
      )::text
      || ':' || digest_field.field_value || pg_catalog.chr(10),
    '' order by digest_field.field_position
  ) into v_digest_input
  from (
    values
      (1, 'digestVersion', 'learning-track-terminal-lifecycle-preview-digest/1.0.0'),
      (2, 'contractVersion', '1.0.0'),
      (3, 'commandType', 'planning.change_learning_track_terminal_lifecycle_v1'),
      (4, 'activeCapacityFingerprintVersion',
        'active-track-constraint-fingerprint/1.0.0'),
      (5, 'currentOrderFingerprintVersion', 'current-track-order-fingerprint/1.0.0'),
      (6, 'workspaceId', pg_catalog.lower(p_workspace_id::text)),
      (7, 'operation', p_operation),
      (8, 'reason', p_reason),
      (9, 'expectedGrowthPlanVersion', p_expected_growth_plan_version::text),
      (10, 'expectedLearningTrackVersion', p_expected_learning_track_version::text),
      (11, 'growthPlanId', pg_catalog.lower(p_growth_plan_id::text)),
      (12, 'growthPlanLifecycle', pg_catalog.upper(p_growth_plan_lifecycle)),
      (13, 'growthPlanWeeklyCapacityMinutes', p_weekly_capacity_minutes::text),
      (14, 'growthPlanAggregateVersion', p_growth_plan_version::text),
      (15, 'beforeLearningTrackId', pg_catalog.lower(p_learning_track_id::text)),
      (16, 'beforeTrackKey', p_track_key),
      (17, 'beforeTitle', p_title),
      (18, 'beforeLifecycle', pg_catalog.upper(p_learning_track_lifecycle)),
      (19, 'beforePriority', p_priority::text),
      (20, 'beforeProtectedMinimumMinutes', p_protected_minimum_minutes::text),
      (21, 'beforeAggregateVersion', p_learning_track_version::text),
      (22, 'afterLearningTrackId', pg_catalog.lower(p_learning_track_id::text)),
      (23, 'afterTrackKey', p_track_key),
      (24, 'afterTitle', p_title),
      (25, 'afterLifecycle', pg_catalog.upper(v_after_lifecycle)),
      (26, 'afterPriority', p_priority::text),
      (27, 'afterProtectedMinimumMinutes', p_protected_minimum_minutes::text),
      (28, 'afterAggregateVersion', v_after_version::text),
      (29, 'currentTrackCountBefore', v_before_constraint->>'currentTrackCount'),
      (30, 'currentTrackCountAfter', v_after_constraint->>'currentTrackCount'),
      (31, 'currentTrackOrderFingerprintBefore',
        v_before_constraint->>'currentTrackOrderFingerprint'),
      (32, 'currentTrackOrderFingerprintAfter',
        v_after_constraint->>'currentTrackOrderFingerprint'),
      (33, 'activeTrackCountBefore', v_before_constraint->>'activeTrackCount'),
      (34, 'activeTrackCountAfter', v_after_constraint->>'activeTrackCount'),
      (35, 'activeProtectedMinimumMinutesBefore',
        v_before_constraint->>'activeProtectedMinimumMinutes'),
      (36, 'activeProtectedMinimumMinutesAfter',
        v_after_constraint->>'activeProtectedMinimumMinutes'),
      (37, 'flexibleMinutesBefore',
        (p_weekly_capacity_minutes
          - (v_before_constraint->>'activeProtectedMinimumMinutes')::integer)::text),
      (38, 'flexibleMinutesAfter',
        (p_weekly_capacity_minutes
          - (v_after_constraint->>'activeProtectedMinimumMinutes')::integer)::text),
      (39, 'activeTrackFingerprintBefore', v_before_constraint->>'activeTrackFingerprint'),
      (40, 'activeTrackFingerprintAfter', v_after_constraint->>'activeTrackFingerprint'),
      (41, 'visibilityBefore', v_visibility_before),
      (42, 'visibilityAfter', 'TERMINAL_HISTORY'),
      (43, 'canApply', 'true'),
      (44, 'blockingReasonCount', '0'),
      (45, 'warningCode', v_warning_code),
      (46, 'retainedLearningTrackActivities', 'true'),
      (47, 'retainedFocusSessions', 'true'),
      (48, 'retainedEvidence', 'true'),
      (49, 'retainedMasteryAndReadiness', 'true'),
      (50, 'retainedReviewItems', 'true'),
      (51, 'retainedPlanSnapshots', 'true'),
      (52, 'retainedTrackHistory', 'true'),
      (53, 'doesNotAssertEvidence', 'true'),
      (54, 'doesNotAssertMastery', 'true'),
      (55, 'doesNotAssertReadiness', 'true'),
      (56, 'doesNotAssertGoalCompletion', 'true'),
      (57, 'projectionStateAfterApply', 'PENDING'),
      (58, 'eventChangeKind', 'TRACK_TERMINAL_LIFECYCLE_CHANGED'),
      (59, 'consumerName', 'planning.plan_snapshot_v1')
  ) as digest_field(field_position, field_name, field_value);
  v_digest := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(v_digest_input, 'UTF8'), 'sha256'),
    'hex'
  );

  return pg_catalog.jsonb_build_object(
    'contract', pg_catalog.jsonb_build_object(
      'name', 'LearningTrackTerminalLifecyclePreviewV1', 'version', '1.0.0'
    ),
    'operation', p_operation,
    'reason', p_reason,
    'expectedGrowthPlanVersion', p_expected_growth_plan_version::text,
    'expectedLearningTrackVersion', p_expected_learning_track_version::text,
    'growthPlan', pg_catalog.jsonb_build_object(
      'growthPlanId', p_growth_plan_id,
      'lifecycle', pg_catalog.upper(p_growth_plan_lifecycle),
      'weeklyCapacityMinutes', p_weekly_capacity_minutes,
      'aggregateVersion', p_growth_plan_version::text
    ),
    'before', pg_catalog.jsonb_build_object(
      'learningTrackId', p_learning_track_id,
      'trackKey', p_track_key,
      'title', p_title,
      'lifecycle', pg_catalog.upper(p_learning_track_lifecycle),
      'priority', p_priority,
      'protectedMinimumMinutes', p_protected_minimum_minutes,
      'aggregateVersion', p_learning_track_version::text
    ),
    'after', pg_catalog.jsonb_build_object(
      'learningTrackId', p_learning_track_id,
      'trackKey', p_track_key,
      'title', p_title,
      'lifecycle', pg_catalog.upper(v_after_lifecycle),
      'priority', p_priority,
      'protectedMinimumMinutes', p_protected_minimum_minutes,
      'aggregateVersion', v_after_version::text
    ),
    'currentPortfolio', pg_catalog.jsonb_build_object(
      'countBefore', (v_before_constraint->>'currentTrackCount')::integer,
      'countAfter', (v_after_constraint->>'currentTrackCount')::integer,
      'orderFingerprintBefore', v_before_constraint->>'currentTrackOrderFingerprint',
      'orderFingerprintAfter', v_after_constraint->>'currentTrackOrderFingerprint'
    ),
    'activeConstraint', pg_catalog.jsonb_build_object(
      'activeTrackCountBefore', (v_before_constraint->>'activeTrackCount')::integer,
      'activeTrackCountAfter', (v_after_constraint->>'activeTrackCount')::integer,
      'activeProtectedMinimumMinutesBefore',
        (v_before_constraint->>'activeProtectedMinimumMinutes')::integer,
      'activeProtectedMinimumMinutesAfter',
        (v_after_constraint->>'activeProtectedMinimumMinutes')::integer,
      'flexibleMinutesBefore', p_weekly_capacity_minutes
        - (v_before_constraint->>'activeProtectedMinimumMinutes')::integer,
      'flexibleMinutesAfter', p_weekly_capacity_minutes
        - (v_after_constraint->>'activeProtectedMinimumMinutes')::integer,
      'activeTrackFingerprintBefore', v_before_constraint->>'activeTrackFingerprint',
      'activeTrackFingerprintAfter', v_after_constraint->>'activeTrackFingerprint'
    ),
    'visibilityBefore', v_visibility_before,
    'visibilityAfter', 'TERMINAL_HISTORY',
    'canApply', true,
    'blockingReasons', '[]'::jsonb,
    'warnings', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('code', v_warning_code)
    ),
    'retained', pg_catalog.jsonb_build_object(
      'learningTrackActivities', true,
      'focusSessions', true,
      'evidence', true,
      'masteryAndReadiness', true,
      'reviewItems', true,
      'planSnapshots', true,
      'trackHistory', true
    ),
    'doesNotAssert', pg_catalog.jsonb_build_object(
      'evidence', true,
      'mastery', true,
      'readiness', true,
      'goalCompletion', true
    ),
    'recalculationAfterApply', pg_catalog.jsonb_build_object(
      'projectionState', 'PENDING',
      'consumerName', 'planning.plan_snapshot_v1'
    ),
    'previewDigest', v_digest
  );
end
$function$;

create function planning.track_terminal_lifecycle_event_payload_v1_is_valid(p_payload jsonb)
returns boolean
language sql
immutable
strict
set search_path = ''
as $function$
  select pg_catalog.jsonb_typeof(p_payload) = 'object'
    and (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(p_payload)) = 5
    and p_payload->>'change_kind' = 'TRACK_TERMINAL_LIFECYCLE_CHANGED'
    and p_payload->>'growth_plan_id'
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and p_payload->>'learning_track_id'
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and case
      when p_payload->>'learning_track_version' ~ '^[1-9][0-9]{0,18}$'
        then (p_payload->>'learning_track_version')::numeric <= 9223372036854775807
      else false
    end
    and p_payload->>'lifecycle' in ('COMPLETED', 'ARCHIVED')
$function$;

create function api.get_learning_track_terminal_lifecycle_source_v1(
  p_history_cursor text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_workspace_id uuid;
  v_plan planning.growth_plans%rowtype;
  v_current_count integer;
  v_current_tracks jsonb;
  v_terminal_history jsonb;
  v_has_more boolean;
  v_cursor jsonb;
  v_cursor_updated_at timestamptz;
  v_cursor_track_key text;
  v_cursor_track_id uuid;
  v_next_updated_at timestamptz;
  v_next_track_key text;
  v_next_track_id uuid;
  v_next_cursor text;
begin
  if identity.jwt_subject() is null then
    raise exception using errcode = '28000', message = 'an authenticated user is required';
  end if;
  v_workspace_id := identity.personal_workspace_id_for_current_user();
  if v_workspace_id is null then
    raise exception using errcode = '42501',
      message = 'Learning Track terminal lifecycle is unavailable';
  end if;

  if p_history_cursor is not null then
    if pg_catalog.char_length(p_history_cursor) not between 1 and 512
       or p_history_cursor !~ '^[A-Za-z0-9+/=]+$' then
      raise exception using errcode = '22023', message = 'Track history cursor is invalid';
    end if;
    begin
      v_cursor := pg_catalog.convert_from(
        pg_catalog.decode(p_history_cursor, 'base64'), 'UTF8'
      )::jsonb;
      if pg_catalog.jsonb_typeof(v_cursor) <> 'object'
         or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(v_cursor)) <> 4
         or v_cursor->>'v' <> '1'
         or v_cursor->>'updatedAt'
           !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$'
         or v_cursor->>'trackKey' !~ '^track:[a-z0-9][a-z0-9-]{1,100}$'
         or v_cursor->>'learningTrackId'
           !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception using errcode = '22023', message = 'Track history cursor is invalid';
      end if;
      v_cursor_updated_at := (v_cursor->>'updatedAt')::timestamptz;
      v_cursor_track_key := v_cursor->>'trackKey';
      v_cursor_track_id := (v_cursor->>'learningTrackId')::uuid;
    exception when others then
      raise exception using errcode = '22023', message = 'Track history cursor is invalid';
    end;
  end if;

  select plan.* into v_plan
  from planning.growth_plans as plan
  where plan.workspace_id = v_workspace_id
    and plan.lifecycle in ('active', 'paused');

  if not found then
    if p_history_cursor is not null then
      raise exception using errcode = '22023',
        message = 'Track history cursor is invalid';
    end if;
    return pg_catalog.jsonb_build_object(
      'contract', pg_catalog.jsonb_build_object(
        'name', 'LearningTrackTerminalLifecycleSourceV1', 'version', '1.0.0'
      ),
      'state', 'NO_CURRENT_PLAN',
      'growthPlan', null,
      'currentTracks', '[]'::jsonb,
      'terminalHistory', '[]'::jsonb,
      'historyPage', pg_catalog.jsonb_build_object('hasMore', false, 'nextCursor', null)
    );
  end if;

  if p_history_cursor is not null and not exists (
    select 1
    from planning.learning_tracks as cursor_track
    where cursor_track.workspace_id = v_workspace_id
      and cursor_track.growth_plan_id = v_plan.growth_plan_id
      and cursor_track.lifecycle in ('completed', 'archived')
      and cursor_track.updated_at = v_cursor_updated_at
      and cursor_track.track_key = v_cursor_track_key
      and cursor_track.learning_track_id = v_cursor_track_id
  ) then
    raise exception using errcode = '22023',
      message = 'Track history cursor is invalid';
  end if;

  select pg_catalog.count(*)::integer into v_current_count
  from planning.learning_tracks as track
  where track.workspace_id = v_workspace_id
    and track.growth_plan_id = v_plan.growth_plan_id
    and track.lifecycle in ('active', 'paused');
  if v_current_count > 30 then
    raise exception using errcode = '55000',
      message = 'Learning Track portfolio limit is exceeded';
  end if;

  select coalesce(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'learningTrackId', track.learning_track_id,
      'trackKey', track.track_key,
      'title', track.title,
      'lifecycle', pg_catalog.upper(track.lifecycle),
      'priority', track.priority,
      'protectedMinimumMinutes', track.protected_minimum_minutes,
      'aggregateVersion', track.aggregate_version::text,
      'capabilities', pg_catalog.jsonb_build_array('complete_track', 'archive_track')
    ) order by track.priority desc, track.track_key collate "C", track.learning_track_id
  ), '[]'::jsonb) into v_current_tracks
  from planning.learning_tracks as track
  where track.workspace_id = v_workspace_id
    and track.growth_plan_id = v_plan.growth_plan_id
    and track.lifecycle in ('active', 'paused');

  with page_rows as (
    select track.*
    from planning.learning_tracks as track
    where track.workspace_id = v_workspace_id
      and track.growth_plan_id = v_plan.growth_plan_id
      and track.lifecycle in ('completed', 'archived')
      and (
        v_cursor_updated_at is null
        or track.updated_at < v_cursor_updated_at
        or (track.updated_at = v_cursor_updated_at
          and track.track_key collate "C" > v_cursor_track_key collate "C")
        or (track.updated_at = v_cursor_updated_at
          and track.track_key = v_cursor_track_key
          and track.learning_track_id > v_cursor_track_id)
      )
    order by track.updated_at desc, track.track_key collate "C", track.learning_track_id
    limit 21
  ), numbered as (
    select page.*,
      pg_catalog.row_number() over (
        order by page.updated_at desc, page.track_key collate "C", page.learning_track_id
      )::integer as row_number
    from page_rows as page
  )
  select coalesce(pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'learningTrackId', track.learning_track_id,
        'trackKey', track.track_key,
        'title', track.title,
        'lifecycle', pg_catalog.upper(track.lifecycle),
        'priority', track.priority,
        'protectedMinimumMinutes', track.protected_minimum_minutes,
        'aggregateVersion', track.aggregate_version::text,
        'updatedAt', track.updated_at,
        'capabilities', case when track.lifecycle = 'completed'
          then pg_catalog.jsonb_build_array('archive_track') else '[]'::jsonb end
      ) order by track.row_number
    ) filter (where track.row_number <= 20), '[]'::jsonb),
    pg_catalog.count(*) > 20,
    pg_catalog.max(track.updated_at) filter (where track.row_number = 20),
    pg_catalog.max(track.track_key) filter (where track.row_number = 20),
    (pg_catalog.max(track.learning_track_id::text)
      filter (where track.row_number = 20))::uuid
  into v_terminal_history, v_has_more,
    v_next_updated_at, v_next_track_key, v_next_track_id
  from numbered as track;

  if v_has_more then
    v_next_cursor := pg_catalog.replace(pg_catalog.replace(pg_catalog.encode(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          'v', 1,
          'updatedAt', pg_catalog.to_char(
            v_next_updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
          ),
          'trackKey', v_next_track_key,
          'learningTrackId', v_next_track_id
        )::text,
        'UTF8'
      ),
      'base64'
    ), pg_catalog.chr(10), ''), pg_catalog.chr(13), '');
  end if;

  return pg_catalog.jsonb_build_object(
    'contract', pg_catalog.jsonb_build_object(
      'name', 'LearningTrackTerminalLifecycleSourceV1', 'version', '1.0.0'
    ),
    'state', 'READY',
    'growthPlan', pg_catalog.jsonb_build_object(
      'growthPlanId', v_plan.growth_plan_id,
      'lifecycle', pg_catalog.upper(v_plan.lifecycle),
      'weeklyCapacityMinutes', v_plan.weekly_capacity_minutes,
      'aggregateVersion', v_plan.aggregate_version::text
    ),
    'currentTracks', v_current_tracks,
    'terminalHistory', v_terminal_history,
    'historyPage', pg_catalog.jsonb_build_object(
      'hasMore', v_has_more,
      'nextCursor', v_next_cursor
    )
  );
end
$function$;

create function api.preview_learning_track_terminal_lifecycle_v1(
  p_track_key text,
  p_operation text,
  p_expected_growth_plan_version text,
  p_expected_learning_track_version text,
  p_reason text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_workspace_id uuid;
  v_plan planning.growth_plans%rowtype;
  v_track planning.learning_tracks%rowtype;
begin
  if identity.jwt_subject() is null then
    raise exception using errcode = '28000', message = 'an authenticated user is required';
  end if;
  v_workspace_id := identity.personal_workspace_id_for_current_user();
  if v_workspace_id is null then
    raise exception using errcode = '42501',
      message = 'Learning Track terminal lifecycle is unavailable';
  end if;
  if p_track_key is null or p_track_key !~ '^track:[a-z0-9][a-z0-9-]{1,100}$' then
    raise exception using errcode = '42501',
      message = 'Learning Track terminal lifecycle is unavailable';
  end if;
  if p_operation not in ('complete_track', 'archive_track')
     or p_expected_growth_plan_version is null
     or p_expected_growth_plan_version !~ '^[1-9][0-9]{0,18}$'
     or p_expected_learning_track_version is null
     or p_expected_learning_track_version !~ '^[1-9][0-9]{0,18}$'
     or p_expected_growth_plan_version::numeric > 9223372036854775807
     or p_expected_learning_track_version::numeric > 9223372036854775807 then
    raise exception using errcode = '22023',
      message = 'Learning Track terminal lifecycle request is invalid';
  end if;

  select plan.* into v_plan
  from planning.growth_plans as plan
  where plan.workspace_id = v_workspace_id
    and plan.lifecycle in ('active', 'paused');
  if not found then
    raise exception using errcode = '42501',
      message = 'Learning Track terminal lifecycle is unavailable';
  end if;

  select track.* into v_track
  from planning.learning_tracks as track
  where track.workspace_id = v_workspace_id
    and track.growth_plan_id = v_plan.growth_plan_id
    and track.track_key = p_track_key
    and (
      (p_operation = 'complete_track' and track.lifecycle in ('active', 'paused'))
      or (p_operation = 'archive_track'
        and track.lifecycle in ('active', 'paused', 'completed'))
    );
  if not found then
    raise exception using errcode = '42501',
      message = 'Learning Track terminal lifecycle is unavailable';
  end if;

  return planning.build_learning_track_terminal_lifecycle_preview_v1(
    v_workspace_id, v_plan.growth_plan_id, v_plan.lifecycle,
    v_plan.weekly_capacity_minutes, v_plan.aggregate_version,
    v_track.learning_track_id, v_track.track_key, v_track.title,
    v_track.lifecycle, v_track.priority, v_track.protected_minimum_minutes,
    v_track.aggregate_version, p_operation,
    p_expected_growth_plan_version::bigint,
    p_expected_learning_track_version::bigint, p_reason
  );
end
$function$;

create function api.apply_learning_track_terminal_lifecycle_v1(
  p_track_key text,
  p_operation text,
  p_expected_growth_plan_version text,
  p_expected_learning_track_version text,
  p_preview_digest text,
  p_reason text,
  p_idempotency_key text
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
  v_track planning.learning_tracks%rowtype;
  v_preview jsonb;
  v_payload jsonb;
  v_command_id uuid := gen_random_uuid();
  v_correlation_id uuid := gen_random_uuid();
  v_event_id uuid := gen_random_uuid();
  v_delivery_id uuid := gen_random_uuid();
  v_request_hash bytea;
  v_response jsonb;
  v_receipt outbox.command_receipts%rowtype;
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
  if p_track_key is null or p_track_key !~ '^track:[a-z0-9][a-z0-9-]{1,100}$' then
    raise exception using errcode = '42501',
      message = 'Learning Track terminal lifecycle is unavailable';
  end if;
  if p_operation not in ('complete_track', 'archive_track')
     or p_expected_growth_plan_version is null
     or p_expected_growth_plan_version !~ '^[1-9][0-9]{0,18}$'
     or p_expected_learning_track_version is null
     or p_expected_learning_track_version !~ '^[1-9][0-9]{0,18}$'
     or p_expected_growth_plan_version::numeric > 9223372036854775807
     or p_expected_learning_track_version::numeric > 9223372036854775807 then
    raise exception using errcode = '22023',
      message = 'Learning Track terminal lifecycle request is invalid';
  end if;
  if p_preview_digest is null or p_preview_digest !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023',
      message = 'Learning Track terminal preview digest is invalid';
  end if;
  if p_reason is null or p_reason <> pg_catalog.btrim(p_reason)
     or pg_catalog.char_length(p_reason) not between 1 and 500
     or p_reason ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023',
      message = 'Learning Track terminal lifecycle reason is invalid';
  end if;
  if p_idempotency_key is null or p_idempotency_key
       !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception using errcode = '22023', message = 'idempotency key is invalid';
  end if;

  v_request_hash := extensions.digest(
    pg_catalog.convert_to(
      pg_catalog.jsonb_build_object(
        'commandType', 'planning.change_learning_track_terminal_lifecycle_v1',
        'schemaVersion', 1,
        'workspaceId', v_workspace_id,
        'trackKey', p_track_key,
        'operation', p_operation,
        'expectedGrowthPlanVersion', p_expected_growth_plan_version,
        'expectedLearningTrackVersion', p_expected_learning_track_version,
        'previewDigest', p_preview_digest,
        'reason', p_reason
      )::text,
      'UTF8'
    ),
    'sha256'
  );

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    v_actor_user_id::text || ':planning.change_learning_track_terminal_lifecycle_v1:'
      || p_idempotency_key,
    0
  ));
  select receipt.* into v_receipt
  from outbox.command_receipts as receipt
  where receipt.actor_user_id = v_actor_user_id
    and receipt.command_type = 'planning.change_learning_track_terminal_lifecycle_v1'
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
  select plan.* into v_plan
  from planning.growth_plans as plan
  where plan.workspace_id = v_workspace_id
    and plan.lifecycle in ('active', 'paused')
  for update;
  if not found then
    raise exception using errcode = '42501',
      message = 'Learning Track terminal lifecycle is unavailable';
  end if;

  perform track.learning_track_id
  from planning.learning_tracks as track
  where track.workspace_id = v_workspace_id
    and track.growth_plan_id = v_plan.growth_plan_id
  order by track.learning_track_id
  for update;

  select track.* into v_track
  from planning.learning_tracks as track
  where track.workspace_id = v_workspace_id
    and track.growth_plan_id = v_plan.growth_plan_id
    and track.track_key = p_track_key
    and (
      (p_operation = 'complete_track' and track.lifecycle in ('active', 'paused'))
      or (p_operation = 'archive_track'
        and track.lifecycle in ('active', 'paused', 'completed'))
    );
  if not found then
    raise exception using errcode = '42501',
      message = 'Learning Track terminal lifecycle is unavailable';
  end if;

  v_preview := planning.build_learning_track_terminal_lifecycle_preview_v1(
    v_workspace_id, v_plan.growth_plan_id, v_plan.lifecycle,
    v_plan.weekly_capacity_minutes, v_plan.aggregate_version,
    v_track.learning_track_id, v_track.track_key, v_track.title,
    v_track.lifecycle, v_track.priority, v_track.protected_minimum_minutes,
    v_track.aggregate_version, p_operation,
    p_expected_growth_plan_version::bigint,
    p_expected_learning_track_version::bigint, p_reason
  );
  if v_preview->>'previewDigest' is distinct from p_preview_digest then
    raise exception using errcode = '40001',
      message = 'Learning Track terminal preview is stale';
  end if;

  insert into outbox.command_receipts (
    command_id, command_type, command_schema_version, workspace_id, actor_user_id,
    idempotency_key, request_hash, correlation_id, expected_aggregate_version
  ) values (
    v_command_id, 'planning.change_learning_track_terminal_lifecycle_v1', 1,
    v_workspace_id, v_actor_user_id, p_idempotency_key, v_request_hash,
    v_correlation_id, p_expected_learning_track_version::bigint
  );

  update planning.learning_tracks
  set lifecycle = pg_catalog.lower(v_preview#>>'{after,lifecycle}'),
    aggregate_version = aggregate_version + 1,
    updated_at = pg_catalog.clock_timestamp()
  where workspace_id = v_workspace_id
    and growth_plan_id = v_plan.growth_plan_id
    and learning_track_id = v_track.learning_track_id
    and lifecycle = v_track.lifecycle
    and aggregate_version = v_track.aggregate_version;
  get diagnostics v_affected_rows = row_count;
  if v_affected_rows <> 1 then
    raise exception using errcode = '55000',
      message = 'Learning Track terminal lifecycle update failed';
  end if;

  v_payload := pg_catalog.jsonb_build_object(
    'change_kind', 'TRACK_TERMINAL_LIFECYCLE_CHANGED',
    'growth_plan_id', v_plan.growth_plan_id,
    'learning_track_id', v_track.learning_track_id,
    'learning_track_version', v_preview#>>'{after,aggregateVersion}',
    'lifecycle', v_preview#>>'{after,lifecycle}'
  );
  if planning.track_terminal_lifecycle_event_payload_v1_is_valid(v_payload) is not true then
    raise exception using errcode = '55000',
      message = 'Planning terminal Track event payload is invalid';
  end if;

  insert into outbox.events (
    event_id, event_name, event_schema_version, workspace_id, aggregate_type,
    aggregate_id, aggregate_version, actor_type, actor_user_id, command_id,
    correlation_id, occurred_at, source, payload
  ) values (
    v_event_id, 'planning.input_changed', 1, v_workspace_id,
    'planning.learning_track', v_track.learning_track_id,
    (v_preview#>>'{after,aggregateVersion}')::bigint,
    'user', v_actor_user_id, v_command_id, v_correlation_id,
    pg_catalog.clock_timestamp(), 'pando.database', v_payload
  );

  insert into outbox.deliveries (
    delivery_id, event_id, workspace_id, consumer_name, handler_contract_version
  ) values (
    v_delivery_id, v_event_id, v_workspace_id, 'planning.plan_snapshot_v1', 1
  );

  v_response := pg_catalog.jsonb_build_object(
    'contract', pg_catalog.jsonb_build_object(
      'name', 'LearningTrackTerminalLifecycleApplyResultV1', 'version', '1.0.0'
    ),
    'commandId', v_command_id,
    'changedTrack', v_preview->'after',
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
      message = 'Learning Track terminal command receipt completion failed';
  end if;

  return v_response;
end
$function$;

alter function planning.projected_terminal_track_constraints_v1(
  uuid, uuid, uuid, text, bigint
) owner to pando_planning_api;
alter function planning.build_learning_track_terminal_lifecycle_preview_v1(
  uuid, uuid, text, integer, bigint, uuid, text, text, text, integer,
  integer, bigint, text, bigint, bigint, text
) owner to pando_planning_api;
alter function planning.track_terminal_lifecycle_event_payload_v1_is_valid(jsonb)
  owner to pando_planning_api;
alter function api.get_learning_track_terminal_lifecycle_source_v1(text)
  owner to pando_planning_api;
alter function api.preview_learning_track_terminal_lifecycle_v1(
  text, text, text, text, text
) owner to pando_planning_api;
alter function api.apply_learning_track_terminal_lifecycle_v1(
  text, text, text, text, text, text, text
) owner to pando_planning_api;

revoke all on function
  planning.projected_terminal_track_constraints_v1(uuid, uuid, uuid, text, bigint),
  planning.build_learning_track_terminal_lifecycle_preview_v1(
    uuid, uuid, text, integer, bigint, uuid, text, text, text, integer,
    integer, bigint, text, bigint, bigint, text
  ),
  planning.track_terminal_lifecycle_event_payload_v1_is_valid(jsonb),
  api.get_learning_track_terminal_lifecycle_source_v1(text),
  api.preview_learning_track_terminal_lifecycle_v1(text, text, text, text, text),
  api.apply_learning_track_terminal_lifecycle_v1(
    text, text, text, text, text, text, text
  ) from public, anon, authenticated, service_role;

grant execute on function
  api.get_learning_track_terminal_lifecycle_source_v1(text),
  api.preview_learning_track_terminal_lifecycle_v1(text, text, text, text, text),
  api.apply_learning_track_terminal_lifecycle_v1(
    text, text, text, text, text, text, text
  ) to authenticated;

revoke create on schema planning, api from pando_planning_api;

do $migration_role_membership$
begin
  execute pg_catalog.format('revoke pando_planning_api from %I', current_user);
end
$migration_role_membership$;
