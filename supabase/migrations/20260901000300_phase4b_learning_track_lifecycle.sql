-- Phase 4B D2b1: bounded Learning Track read plus deterministic pause/resume preview and apply.

do $migration_role_membership$
begin
  execute pg_catalog.format('grant pando_planning_api to %I with set true', current_user);
end
$migration_role_membership$;

grant create on schema planning, api to pando_planning_api;

grant update (lifecycle, aggregate_version, updated_at)
  on planning.learning_tracks to pando_planning_api;

create function planning.projected_active_track_capacity_constraint_v1(
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
  v_active_track_count integer;
  v_active_protected_minimum_minutes integer;
  v_fingerprint_input text;
  v_fingerprint text;
begin
  if p_workspace_id is null or p_growth_plan_id is null or p_learning_track_id is null
     or p_projected_lifecycle not in ('active', 'paused')
     or p_projected_aggregate_version is null or p_projected_aggregate_version < 1 then
    raise exception using errcode = '22023',
      message = 'Learning Track projected constraint input is invalid';
  end if;

  with projected_tracks as (
    select
      track.learning_track_id,
      case when track.learning_track_id = p_learning_track_id
        then p_projected_aggregate_version else track.aggregate_version end as aggregate_version,
      case when track.learning_track_id = p_learning_track_id
        then p_projected_lifecycle else track.lifecycle end as lifecycle,
      track.protected_minimum_minutes
    from planning.learning_tracks as track
    where track.workspace_id = p_workspace_id
      and track.growth_plan_id = p_growth_plan_id
  )
  select pg_catalog.count(*)::integer,
    coalesce(pg_catalog.sum(track.protected_minimum_minutes), 0)::integer
  into v_active_track_count, v_active_protected_minimum_minutes
  from projected_tracks as track
  where track.lifecycle = 'active';

  with projected_tracks as (
    select
      track.learning_track_id,
      case when track.learning_track_id = p_learning_track_id
        then p_projected_aggregate_version else track.aggregate_version end as aggregate_version,
      case when track.learning_track_id = p_learning_track_id
        then p_projected_lifecycle else track.lifecycle end as lifecycle,
      track.protected_minimum_minutes
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
  ) into v_fingerprint_input
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
      select
        track.learning_track_id,
        track.aggregate_version,
        track.lifecycle,
        track.protected_minimum_minutes,
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

  v_fingerprint := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(v_fingerprint_input, 'UTF8'), 'sha256'),
    'hex'
  );

  return pg_catalog.jsonb_build_object(
    'activeTrackCount', v_active_track_count,
    'activeProtectedMinimumMinutes', v_active_protected_minimum_minutes,
    'activeTrackFingerprint', v_fingerprint
  );
end
$function$;

create function planning.build_learning_track_lifecycle_preview_v1(
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
  v_current_track_count integer;
  v_before_count integer;
  v_after_count integer;
  v_before_minimum integer;
  v_after_minimum integer;
  v_can_apply boolean;
  v_blocking_reasons jsonb := '[]'::jsonb;
  v_blocking_reason_code text := '';
  v_blocking_reason_value text := '';
  v_warnings jsonb := '[]'::jsonb;
  v_warning_code text := '';
  v_digest_input text;
  v_digest text;
begin
  if p_workspace_id is null or p_growth_plan_id is null or p_learning_track_id is null
     or p_growth_plan_lifecycle not in ('active', 'paused')
     or p_weekly_capacity_minutes is null or p_weekly_capacity_minutes not between 0 and 10080
     or p_growth_plan_version is null or p_growth_plan_version < 1
     or p_learning_track_lifecycle not in ('active', 'paused')
     or p_priority is null or p_priority not between 0 and 100
     or p_protected_minimum_minutes is null
     or p_protected_minimum_minutes not between 0 and 10080
     or p_learning_track_version is null or p_learning_track_version < 1
     or p_expected_growth_plan_version is null or p_expected_growth_plan_version < 1
     or p_expected_learning_track_version is null or p_expected_learning_track_version < 1 then
    raise exception using errcode = '22023', message = 'Learning Track preview input is invalid';
  end if;
  if p_track_key is null or p_track_key !~ '^track:[a-z0-9][a-z0-9-]{1,100}$'
     or p_title is null or p_title <> pg_catalog.btrim(p_title)
     or pg_catalog.char_length(p_title) not between 1 and 160 then
    raise exception using errcode = '22023', message = 'Learning Track preview input is invalid';
  end if;
  if p_operation not in ('pause_track', 'resume_track') then
    raise exception using errcode = '22023', message = 'Learning Track lifecycle operation is invalid';
  end if;
  if p_reason is null or p_reason <> pg_catalog.btrim(p_reason)
     or pg_catalog.char_length(p_reason) not between 1 and 500
     or p_reason ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'Learning Track lifecycle reason is invalid';
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

  if p_operation = 'pause_track' and p_learning_track_lifecycle = 'active' then
    v_after_lifecycle := 'paused';
  elsif p_operation = 'resume_track' and p_learning_track_lifecycle = 'paused' then
    v_after_lifecycle := 'active';
  else
    raise exception using errcode = '22023', message = 'Learning Track lifecycle transition is invalid';
  end if;
  v_after_version := p_learning_track_version + 1;

  select pg_catalog.count(*)::integer into v_current_track_count
  from planning.learning_tracks as track
  where track.workspace_id = p_workspace_id
    and track.growth_plan_id = p_growth_plan_id
    and track.lifecycle in ('active', 'paused');
  if v_current_track_count > 30 then
    raise exception using errcode = '55000',
      message = 'Learning Track portfolio limit is exceeded';
  end if;

  v_before_constraint := planning.active_track_capacity_constraint_v1(
    p_workspace_id, p_growth_plan_id
  );
  v_after_constraint := planning.projected_active_track_capacity_constraint_v1(
    p_workspace_id, p_growth_plan_id, p_learning_track_id,
    v_after_lifecycle, v_after_version
  );
  v_before_count := (v_before_constraint->>'activeTrackCount')::integer;
  v_after_count := (v_after_constraint->>'activeTrackCount')::integer;
  v_before_minimum := (v_before_constraint->>'activeProtectedMinimumMinutes')::integer;
  v_after_minimum := (v_after_constraint->>'activeProtectedMinimumMinutes')::integer;

  if v_before_count > 30 or v_before_minimum > p_weekly_capacity_minutes then
    raise exception using errcode = '55000',
      message = 'Growth Plan capacity invariant is violated';
  end if;

  if p_operation = 'resume_track' and v_after_minimum > p_weekly_capacity_minutes then
    v_blocking_reason_code := 'ACTIVE_TRACK_MINIMUM_EXCEEDS_CAPACITY';
    v_blocking_reason_value := v_after_minimum::text;
    v_blocking_reasons := pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'code', v_blocking_reason_code,
        'minimumCapacityMinutes', v_after_minimum
      )
    );
  end if;
  v_can_apply := pg_catalog.jsonb_array_length(v_blocking_reasons) = 0;

  if p_growth_plan_lifecycle = 'paused' then
    v_warning_code := 'PARENT_GROWTH_PLAN_PAUSED';
    v_warnings := pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('code', v_warning_code)
    );
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
      (1, 'digestVersion', 'learning-track-lifecycle-preview-digest/1.0.0'),
      (2, 'contractVersion', '1.0.0'),
      (3, 'fingerprintVersion', 'active-track-constraint-fingerprint/1.0.0'),
      (4, 'workspaceId', pg_catalog.lower(p_workspace_id::text)),
      (5, 'operation', p_operation),
      (6, 'reason', p_reason),
      (7, 'expectedGrowthPlanVersion', p_expected_growth_plan_version::text),
      (8, 'expectedLearningTrackVersion', p_expected_learning_track_version::text),
      (9, 'growthPlanId', pg_catalog.lower(p_growth_plan_id::text)),
      (10, 'growthPlanLifecycle', pg_catalog.upper(p_growth_plan_lifecycle)),
      (11, 'growthPlanWeeklyCapacityMinutes', p_weekly_capacity_minutes::text),
      (12, 'growthPlanAggregateVersion', p_growth_plan_version::text),
      (13, 'beforeLearningTrackId', pg_catalog.lower(p_learning_track_id::text)),
      (14, 'beforeTrackKey', p_track_key),
      (15, 'beforeTitle', p_title),
      (16, 'beforeLifecycle', pg_catalog.upper(p_learning_track_lifecycle)),
      (17, 'beforePriority', p_priority::text),
      (18, 'beforeProtectedMinimumMinutes', p_protected_minimum_minutes::text),
      (19, 'beforeAggregateVersion', p_learning_track_version::text),
      (20, 'afterLearningTrackId', pg_catalog.lower(p_learning_track_id::text)),
      (21, 'afterTrackKey', p_track_key),
      (22, 'afterTitle', p_title),
      (23, 'afterLifecycle', pg_catalog.upper(v_after_lifecycle)),
      (24, 'afterPriority', p_priority::text),
      (25, 'afterProtectedMinimumMinutes', p_protected_minimum_minutes::text),
      (26, 'afterAggregateVersion', v_after_version::text),
      (27, 'activeTrackCountBefore', v_before_count::text),
      (28, 'activeTrackCountAfter', v_after_count::text),
      (29, 'activeProtectedMinimumMinutesBefore', v_before_minimum::text),
      (30, 'activeProtectedMinimumMinutesAfter', v_after_minimum::text),
      (31, 'flexibleMinutesBefore', (p_weekly_capacity_minutes - v_before_minimum)::text),
      (32, 'flexibleMinutesAfter', (p_weekly_capacity_minutes - v_after_minimum)::text),
      (33, 'activeTrackFingerprintBefore', v_before_constraint->>'activeTrackFingerprint'),
      (34, 'activeTrackFingerprintAfter', v_after_constraint->>'activeTrackFingerprint'),
      (35, 'canApply', case when v_can_apply then 'true' else 'false' end),
      (36, 'blockingReasonCode', v_blocking_reason_code),
      (37, 'blockingMinimumCapacityMinutes',
        case when v_blocking_reason_code = 'ACTIVE_TRACK_MINIMUM_EXCEEDS_CAPACITY'
          then v_blocking_reason_value else '' end),
      (38, 'warningCode', v_warning_code),
      (39, 'retainedLearningTrackActivities', 'true'),
      (40, 'retainedPlanSnapshots', 'true'),
      (41, 'retainedFocusSessions', 'true'),
      (42, 'retainedEvidence', 'true'),
      (43, 'projectionStateAfterApply', 'PENDING'),
      (44, 'consumerName', 'planning.plan_snapshot_v1')
  ) as digest_field(field_position, field_name, field_value);
  v_digest := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(v_digest_input, 'UTF8'), 'sha256'),
    'hex'
  );

  return pg_catalog.jsonb_build_object(
    'contract', pg_catalog.jsonb_build_object(
      'name', 'LearningTrackLifecyclePreviewV1', 'version', '1.0.0'
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
    'constraint', pg_catalog.jsonb_build_object(
      'activeTrackCountBefore', v_before_count,
      'activeTrackCountAfter', v_after_count,
      'activeProtectedMinimumMinutesBefore', v_before_minimum,
      'activeProtectedMinimumMinutesAfter', v_after_minimum,
      'flexibleMinutesBefore', p_weekly_capacity_minutes - v_before_minimum,
      'flexibleMinutesAfter', p_weekly_capacity_minutes - v_after_minimum,
      'activeTrackFingerprintBefore', v_before_constraint->>'activeTrackFingerprint',
      'activeTrackFingerprintAfter', v_after_constraint->>'activeTrackFingerprint'
    ),
    'canApply', v_can_apply,
    'blockingReasons', v_blocking_reasons,
    'warnings', v_warnings,
    'retained', pg_catalog.jsonb_build_object(
      'learningTrackActivities', true,
      'planSnapshots', true,
      'focusSessions', true,
      'evidence', true
    ),
    'recalculationAfterApply', pg_catalog.jsonb_build_object(
      'projectionState', 'PENDING',
      'consumerName', 'planning.plan_snapshot_v1'
    ),
    'previewDigest', v_digest
  );
end
$function$;

create function planning.track_lifecycle_event_payload_v1_is_valid(p_payload jsonb)
returns boolean
language sql
immutable
strict
set search_path = ''
as $function$
  select pg_catalog.jsonb_typeof(p_payload) = 'object'
    and (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(p_payload)) = 5
    and p_payload->>'change_kind' = 'TRACK_LIFECYCLE_CHANGED'
    and p_payload->>'growth_plan_id'
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and p_payload->>'learning_track_id'
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and case
      when p_payload->>'learning_track_version' ~ '^[1-9][0-9]{0,18}$'
        then (p_payload->>'learning_track_version')::numeric <= 9223372036854775807
      else false
    end
    and p_payload->>'lifecycle' in ('ACTIVE', 'PAUSED')
$function$;

create function api.get_current_learning_tracks_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_workspace_id uuid;
  v_plan planning.growth_plans%rowtype;
  v_track_count integer;
  v_tracks jsonb;
begin
  if identity.jwt_subject() is null then
    raise exception using errcode = '28000', message = 'an authenticated user is required';
  end if;
  v_workspace_id := identity.personal_workspace_id_for_current_user();
  if v_workspace_id is null then
    raise exception using errcode = '42501', message = 'Learning Tracks are unavailable';
  end if;

  select plan.* into v_plan
  from planning.growth_plans as plan
  where plan.workspace_id = v_workspace_id
    and plan.lifecycle in ('active', 'paused');

  if not found then
    return pg_catalog.jsonb_build_object(
      'contract', pg_catalog.jsonb_build_object(
        'name', 'CurrentLearningTracksV1', 'version', '1.0.0'
      ),
      'growthPlan', null,
      'learningTracks', '[]'::jsonb
    );
  end if;

  select pg_catalog.count(*)::integer into v_track_count
  from planning.learning_tracks as track
  where track.workspace_id = v_workspace_id
    and track.growth_plan_id = v_plan.growth_plan_id
    and track.lifecycle in ('active', 'paused');
  if v_track_count > 30 then
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
      'capabilities', pg_catalog.jsonb_build_array(
        case when track.lifecycle = 'active' then 'pause_track' else 'resume_track' end
      )
    ) order by track.priority desc, track.track_key collate "C", track.learning_track_id
  ), '[]'::jsonb) into v_tracks
  from planning.learning_tracks as track
  where track.workspace_id = v_workspace_id
    and track.growth_plan_id = v_plan.growth_plan_id
    and track.lifecycle in ('active', 'paused');

  return pg_catalog.jsonb_build_object(
    'contract', pg_catalog.jsonb_build_object(
      'name', 'CurrentLearningTracksV1', 'version', '1.0.0'
    ),
    'growthPlan', pg_catalog.jsonb_build_object(
      'growthPlanId', v_plan.growth_plan_id,
      'lifecycle', pg_catalog.upper(v_plan.lifecycle),
      'weeklyCapacityMinutes', v_plan.weekly_capacity_minutes,
      'aggregateVersion', v_plan.aggregate_version::text
    ),
    'learningTracks', v_tracks
  );
end
$function$;

create function api.preview_learning_track_lifecycle_v1(
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
    raise exception using errcode = '42501', message = 'Learning Track is unavailable';
  end if;
  if p_track_key is null or p_track_key !~ '^track:[a-z0-9][a-z0-9-]{1,100}$' then
    raise exception using errcode = '42501', message = 'Learning Track is unavailable';
  end if;
  if p_expected_growth_plan_version is null
     or p_expected_growth_plan_version !~ '^[1-9][0-9]{0,18}$'
     or p_expected_learning_track_version is null
     or p_expected_learning_track_version !~ '^[1-9][0-9]{0,18}$'
     or p_expected_growth_plan_version::numeric > 9223372036854775807
     or p_expected_learning_track_version::numeric > 9223372036854775807 then
    raise exception using errcode = '22023', message = 'Learning Track lifecycle request is invalid';
  end if;

  select plan.* into v_plan
  from planning.growth_plans as plan
  where plan.workspace_id = v_workspace_id
    and plan.lifecycle in ('active', 'paused');
  if not found then
    raise exception using errcode = '42501', message = 'Learning Track is unavailable';
  end if;

  select track.* into v_track
  from planning.learning_tracks as track
  where track.workspace_id = v_workspace_id
    and track.growth_plan_id = v_plan.growth_plan_id
    and track.track_key = p_track_key
    and track.lifecycle in ('active', 'paused');
  if not found then
    raise exception using errcode = '42501', message = 'Learning Track is unavailable';
  end if;

  return planning.build_learning_track_lifecycle_preview_v1(
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

create function api.apply_learning_track_lifecycle_v1(
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
    raise exception using errcode = '42501', message = 'Learning Track is unavailable';
  end if;
  if p_operation not in ('pause_track', 'resume_track')
     or p_expected_growth_plan_version is null
     or p_expected_growth_plan_version !~ '^[1-9][0-9]{0,18}$'
     or p_expected_learning_track_version is null
     or p_expected_learning_track_version !~ '^[1-9][0-9]{0,18}$'
     or p_expected_growth_plan_version::numeric > 9223372036854775807
     or p_expected_learning_track_version::numeric > 9223372036854775807 then
    raise exception using errcode = '22023', message = 'Learning Track lifecycle request is invalid';
  end if;
  if p_preview_digest is null or p_preview_digest !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'Learning Track preview digest is invalid';
  end if;
  if p_reason is null or p_reason <> pg_catalog.btrim(p_reason)
     or pg_catalog.char_length(p_reason) not between 1 and 500
     or p_reason ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'Learning Track lifecycle reason is invalid';
  end if;
  if p_idempotency_key is null or p_idempotency_key <> pg_catalog.btrim(p_idempotency_key)
     or pg_catalog.char_length(p_idempotency_key) not between 1 and 128
     or p_idempotency_key ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'idempotency key is invalid';
  end if;

  v_request_hash := extensions.digest(
    pg_catalog.convert_to(
      pg_catalog.jsonb_build_object(
        'commandType', 'planning.change_learning_track_lifecycle',
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
    v_actor_user_id::text || ':planning.change_learning_track_lifecycle:'
      || p_idempotency_key,
    0
  ));
  select receipt.* into v_receipt
  from outbox.command_receipts as receipt
  where receipt.actor_user_id = v_actor_user_id
    and receipt.command_type = 'planning.change_learning_track_lifecycle'
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
    raise exception using errcode = '42501', message = 'Learning Track is unavailable';
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
    and track.lifecycle in ('active', 'paused');
  if not found then
    raise exception using errcode = '42501', message = 'Learning Track is unavailable';
  end if;

  v_preview := planning.build_learning_track_lifecycle_preview_v1(
    v_workspace_id, v_plan.growth_plan_id, v_plan.lifecycle,
    v_plan.weekly_capacity_minutes, v_plan.aggregate_version,
    v_track.learning_track_id, v_track.track_key, v_track.title,
    v_track.lifecycle, v_track.priority, v_track.protected_minimum_minutes,
    v_track.aggregate_version, p_operation,
    p_expected_growth_plan_version::bigint,
    p_expected_learning_track_version::bigint, p_reason
  );
  if (v_preview->>'canApply')::boolean is not true
     or v_preview->>'previewDigest' is distinct from p_preview_digest then
    raise exception using errcode = '40001', message = 'Learning Track preview is stale';
  end if;

  insert into outbox.command_receipts (
    command_id, command_type, command_schema_version, workspace_id, actor_user_id,
    idempotency_key, request_hash, correlation_id, expected_aggregate_version
  ) values (
    v_command_id, 'planning.change_learning_track_lifecycle', 1,
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
    raise exception using errcode = '55000', message = 'Learning Track lifecycle update failed';
  end if;

  v_payload := pg_catalog.jsonb_build_object(
    'change_kind', 'TRACK_LIFECYCLE_CHANGED',
    'growth_plan_id', v_plan.growth_plan_id,
    'learning_track_id', v_track.learning_track_id,
    'learning_track_version', v_preview#>>'{after,aggregateVersion}',
    'lifecycle', v_preview#>>'{after,lifecycle}'
  );
  if planning.track_lifecycle_event_payload_v1_is_valid(v_payload) is not true then
    raise exception using errcode = '55000',
      message = 'Planning Track lifecycle event payload is invalid';
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
      'name', 'LearningTrackLifecycleApplyResultV1', 'version', '1.0.0'
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
      message = 'Learning Track command receipt completion failed';
  end if;

  return v_response;
end
$function$;

alter function planning.projected_active_track_capacity_constraint_v1(
  uuid, uuid, uuid, text, bigint
) owner to pando_planning_api;
alter function planning.build_learning_track_lifecycle_preview_v1(
  uuid, uuid, text, integer, bigint, uuid, text, text, text, integer,
  integer, bigint, text, bigint, bigint, text
) owner to pando_planning_api;
alter function planning.track_lifecycle_event_payload_v1_is_valid(jsonb)
  owner to pando_planning_api;
alter function api.get_current_learning_tracks_v1() owner to pando_planning_api;
alter function api.preview_learning_track_lifecycle_v1(text, text, text, text, text)
  owner to pando_planning_api;
alter function api.apply_learning_track_lifecycle_v1(
  text, text, text, text, text, text, text
) owner to pando_planning_api;

revoke all on function
  planning.projected_active_track_capacity_constraint_v1(uuid, uuid, uuid, text, bigint),
  planning.build_learning_track_lifecycle_preview_v1(
    uuid, uuid, text, integer, bigint, uuid, text, text, text, integer,
    integer, bigint, text, bigint, bigint, text
  ),
  planning.track_lifecycle_event_payload_v1_is_valid(jsonb),
  api.get_current_learning_tracks_v1(),
  api.preview_learning_track_lifecycle_v1(text, text, text, text, text),
  api.apply_learning_track_lifecycle_v1(text, text, text, text, text, text, text)
  from public, anon, authenticated, service_role;

grant execute on function
  api.get_current_learning_tracks_v1(),
  api.preview_learning_track_lifecycle_v1(text, text, text, text, text),
  api.apply_learning_track_lifecycle_v1(text, text, text, text, text, text, text)
  to authenticated;

revoke create on schema planning, api from pando_planning_api;

do $migration_role_membership$
begin
  execute pg_catalog.format('revoke pando_planning_api from %I', current_user);
end
$migration_role_membership$;
