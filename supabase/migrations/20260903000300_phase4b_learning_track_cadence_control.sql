-- Phase 4B D2c: actor-scoped cadence source and exact preview/apply owner command.

do $migration_role_membership$
begin
  execute pg_catalog.format('grant pando_planning_api to %I with set true', current_user);
  execute pg_catalog.format('grant pando_planning_worker to %I with set true', current_user);
end
$migration_role_membership$;

grant create on schema planning, api to pando_planning_api;
grant create on schema planning to pando_planning_worker;
grant update (cadence_per_week, aggregate_version, updated_at)
  on planning.learning_tracks to pando_planning_api;

create function planning.read_learning_track_cadence_progress_v1(
  p_workspace_id uuid,
  p_growth_plan_id uuid,
  p_query_as_of timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_plan planning.growth_plans%rowtype;
  v_pointer planning.current_plan_snapshots%rowtype;
  v_snapshot planning.plan_snapshots%rowtype;
  v_attempt planning.plan_snapshot_attempts%rowtype;
  v_tracks jsonb;
  v_counts jsonb := '{}'::jsonb;
  v_has_uncovered boolean := false;
  v_has_active_v2 boolean := false;
  v_valid boolean := false;
begin
  if p_workspace_id is null or p_growth_plan_id is null or p_query_as_of is null then
    raise exception using errcode = '22023', message = 'cadence progress input is invalid';
  end if;
  select plan.* into v_plan
  from planning.growth_plans as plan
  where plan.workspace_id = p_workspace_id
    and plan.growth_plan_id = p_growth_plan_id
    and plan.lifecycle in ('active', 'paused');
  if not found then
    return pg_catalog.jsonb_build_object(
      'state', 'UNAVAILABLE', 'snapshotId', null, 'appliedAttemptId', null,
      'inputFingerprint', null, 'calculatedAsOf', null, 'countsByTrackId', v_counts
    );
  end if;

  select pointer.* into v_pointer
  from planning.current_plan_snapshots as pointer
  where pointer.workspace_id = p_workspace_id;

  select exists (
    select 1
    from outbox.deliveries as delivery
    join planning.plan_snapshot_delivery_ledger as ledger
      on ledger.delivery_id = delivery.delivery_id
     and ledger.workspace_id = delivery.workspace_id
     and ledger.coverage_state = 'UNCOVERED'
    where delivery.workspace_id = p_workspace_id
      and delivery.consumer_name = 'planning.plan_snapshot_v1'
      and delivery.handler_contract_version = 1
      and delivery.delivery_state in ('pending', 'retry', 'leased', 'dead_letter')
      and delivery.available_at <= p_query_as_of
  ) into v_has_uncovered;

  select exists (
    select 1
    from planning.plan_snapshot_attempts as attempt
    join outbox.deliveries as delivery
      on delivery.delivery_id = attempt.delivery_id
     and delivery.workspace_id = attempt.workspace_id
    join planning.plan_snapshot_delivery_ledger as ledger
      on ledger.delivery_id = attempt.delivery_id
     and ledger.workspace_id = attempt.workspace_id
     and ledger.coverage_state = 'UNCOVERED'
    where attempt.workspace_id = p_workspace_id
      and attempt.calculation_contract_version = 'planning-calculation/2'
      and attempt.attempt_state in ('LOADING', 'READY')
      and attempt.base_pointer_version >= coalesce(v_pointer.pointer_version, 0)
      and delivery.delivery_state in ('pending', 'retry', 'leased')
      and delivery.available_at <= p_query_as_of
  ) into v_has_active_v2;

  if v_pointer.snapshot_id is not null and v_pointer.applied_attempt_id is not null
     and not v_has_uncovered then
    select attempt.* into v_attempt
    from planning.plan_snapshot_attempts as attempt
    join planning.plan_snapshots as snapshot
      on snapshot.workspace_id = attempt.workspace_id
     and snapshot.snapshot_id = v_pointer.snapshot_id
    where attempt.workspace_id = p_workspace_id
      and attempt.attempt_id = v_pointer.applied_attempt_id
      and attempt.attempt_state = 'APPLIED'
      and attempt.applied_pointer_version = v_pointer.pointer_version
      and attempt.calculation_contract_version = 'planning-calculation/2'
      and attempt.normalized_input->>'completedWorkPolicyVersion'
        = 'planning-completed-work/0.2'
      and snapshot.growth_plan_id = p_growth_plan_id
      and snapshot.engine_version = 'planner-engine/0.2.0'
      and snapshot.policy_version = 'planning-policy/0.2'
      and snapshot.input_fingerprint = attempt.input_fingerprint
      and snapshot.result->>'inputFingerprint' = attempt.input_fingerprint
      and snapshot.valid_until >= p_query_as_of;

    if found then
      select snapshot.* into strict v_snapshot
      from planning.plan_snapshots as snapshot
      where snapshot.workspace_id = p_workspace_id
        and snapshot.snapshot_id = v_pointer.snapshot_id;
      v_tracks := v_attempt.normalized_input#>'{growthPlan,tracks}';
      v_valid := v_attempt.normalized_input#>>'{growthPlan,growthPlanId}'
          = p_growth_plan_id::text
        and v_attempt.normalized_input#>>'{growthPlan,version}' = v_plan.aggregate_version::text
        and v_attempt.normalized_input#>>'{growthPlan,lifecycle}'
          = pg_catalog.upper(v_plan.lifecycle)
        and v_attempt.normalized_input#>>'{growthPlan,weeklyCapacityMinutes}'
          = v_plan.weekly_capacity_minutes::text
        and pg_catalog.jsonb_typeof(v_tracks) = 'array';

      if v_valid then
        v_valid := not exists (
          select 1
          from pg_catalog.jsonb_array_elements(v_tracks) as input_track(value)
          where pg_catalog.jsonb_typeof(input_track.value) <> 'object'
             or input_track.value->>'trackId' is null
             or input_track.value->>'trackId'
                !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
             or pg_catalog.jsonb_typeof(input_track.value->'cadencePerWeek') <> 'number'
             or input_track.value->>'cadencePerWeek' !~ '^(0|[1-9][0-9]{0,2})$'
             or (input_track.value->>'cadencePerWeek')::integer > 100
             or pg_catalog.jsonb_typeof(
                  input_track.value->'completedCadenceSessionsThisWeek'
                ) <> 'number'
             or input_track.value->>'completedCadenceSessionsThisWeek'
                !~ '^(0|[1-9][0-9]{0,2})$'
             or (input_track.value->>'completedCadenceSessionsThisWeek')::integer > 500
        ) and (
          select pg_catalog.count(*) = pg_catalog.count(distinct input_track.value->>'trackId')
          from pg_catalog.jsonb_array_elements(v_tracks) as input_track(value)
        ) and not exists (
          select 1
          from planning.learning_tracks as track
          where track.workspace_id = p_workspace_id
            and track.growth_plan_id = p_growth_plan_id
            and track.lifecycle in ('active', 'paused')
            and not exists (
              select 1
              from pg_catalog.jsonb_array_elements(v_tracks) as input_track(value)
              where input_track.value->>'trackId' = track.learning_track_id::text
                and input_track.value->>'version' = track.aggregate_version::text
                and input_track.value->>'lifecycle' = pg_catalog.upper(track.lifecycle)
                and input_track.value->>'priority' = track.priority::text
                and input_track.value->>'protectedMinimumMinutes'
                  = track.protected_minimum_minutes::text
                and input_track.value->>'cadencePerWeek' = track.cadence_per_week::text
            )
        );
      end if;

      if v_valid then
        select coalesce(pg_catalog.jsonb_object_agg(
          input_track.value->>'trackId',
          (input_track.value->>'completedCadenceSessionsThisWeek')::integer
        ), '{}'::jsonb)
        into v_counts
        from pg_catalog.jsonb_array_elements(v_tracks) as input_track(value);
        return pg_catalog.jsonb_build_object(
          'state', 'CURRENT',
          'snapshotId', v_snapshot.snapshot_id,
          'appliedAttemptId', v_attempt.attempt_id,
          'inputFingerprint', v_attempt.input_fingerprint,
          'calculatedAsOf', v_snapshot.calculated_as_of,
          'countsByTrackId', v_counts
        );
      end if;
    end if;
  end if;

  return pg_catalog.jsonb_build_object(
    'state', case when v_has_active_v2 then 'PENDING' else 'UNAVAILABLE' end,
    'snapshotId', null,
    'appliedAttemptId', null,
    'inputFingerprint', null,
    'calculatedAsOf', null,
    'countsByTrackId', v_counts
  );
end
$function$;

create function planning.build_learning_track_cadence_preview_v1(
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
  p_cadence_per_week integer,
  p_learning_track_version bigint,
  p_proposed_cadence_per_week integer,
  p_expected_growth_plan_version bigint,
  p_expected_learning_track_version bigint,
  p_reason text,
  p_query_as_of timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_after_version bigint;
  v_progress jsonb;
  v_progress_state text;
  v_completed integer;
  v_before_deficit integer;
  v_after_deficit integer;
  v_warnings jsonb := '[]'::jsonb;
  v_warning_count integer;
  v_digest_input text;
  v_digest text;
begin
  if p_workspace_id is null or p_growth_plan_id is null or p_learning_track_id is null
     or p_growth_plan_lifecycle not in ('active', 'paused')
     or p_weekly_capacity_minutes is null or p_weekly_capacity_minutes not between 0 and 10080
     or p_growth_plan_version is null or p_growth_plan_version < 1
     or p_track_key is null or p_track_key !~ '^track:[a-z0-9][a-z0-9-]{1,100}$'
     or p_title is null or p_title <> pg_catalog.btrim(p_title)
     or pg_catalog.char_length(p_title) not between 1 and 160
     or p_learning_track_lifecycle not in ('active', 'paused')
     or p_priority is null or p_priority not between 0 and 100
     or p_protected_minimum_minutes is null
     or p_protected_minimum_minutes not between 0 and 10080
     or p_cadence_per_week is null or p_cadence_per_week not between 0 and 100
     or p_learning_track_version is null or p_learning_track_version < 1
     or p_proposed_cadence_per_week is null
     or p_proposed_cadence_per_week not between 0 and 100
     or p_expected_growth_plan_version is null or p_expected_growth_plan_version < 1
     or p_expected_learning_track_version is null or p_expected_learning_track_version < 1
     or p_query_as_of is null then
    raise exception using errcode = '22023', message = 'Learning Track cadence preview input is invalid';
  end if;
  if p_reason is null or p_reason <> pg_catalog.btrim(p_reason)
     or pg_catalog.char_length(p_reason) not between 1 and 500
     or p_reason ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'Learning Track cadence reason is invalid';
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
  if p_cadence_per_week = p_proposed_cadence_per_week then
    raise exception using errcode = '22023', message = 'Learning Track cadence proposal is unchanged';
  end if;

  v_after_version := p_learning_track_version + 1;
  v_progress := planning.read_learning_track_cadence_progress_v1(
    p_workspace_id, p_growth_plan_id, p_query_as_of
  );
  v_progress_state := v_progress->>'state';
  if v_progress_state = 'CURRENT' then
    v_completed := (
      v_progress#>>array['countsByTrackId', p_learning_track_id::text]
    )::integer;
    if v_completed is null then
      v_progress_state := 'UNAVAILABLE';
    else
      v_before_deficit := greatest(p_cadence_per_week - v_completed, 0);
      v_after_deficit := greatest(p_proposed_cadence_per_week - v_completed, 0);
    end if;
  end if;

  if p_growth_plan_lifecycle = 'paused' then
    v_warnings := v_warnings || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('code', 'PARENT_GROWTH_PLAN_PAUSED')
    );
  end if;
  if p_learning_track_lifecycle = 'paused' then
    v_warnings := v_warnings || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('code', 'LEARNING_TRACK_PAUSED')
    );
  end if;
  if v_progress_state <> 'CURRENT' then
    v_warnings := v_warnings || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('code', 'CADENCE_PROGRESS_PENDING')
    );
  end if;
  v_warning_count := pg_catalog.jsonb_array_length(v_warnings);

  select pg_catalog.string_agg(
    field.field_name || ':'
      || pg_catalog.octet_length(pg_catalog.convert_to(field.field_value, 'UTF8'))::text
      || ':' || field.field_value || pg_catalog.chr(10),
    '' order by field.field_position
  ) into v_digest_input
  from (
    select fixed.field_position::bigint, fixed.field_name, fixed.field_value
    from (values
      (1, 'digestVersion', 'learning-track-cadence-preview-digest/1.0.0'),
      (2, 'contractVersion', '1.0.0'),
      (3, 'workspaceId', pg_catalog.lower(p_workspace_id::text)),
      (4, 'operation', 'set_track_cadence'),
      (5, 'reason', p_reason),
      (6, 'expectedGrowthPlanVersion', p_expected_growth_plan_version::text),
      (7, 'expectedLearningTrackVersion', p_expected_learning_track_version::text),
      (8, 'growthPlanId', pg_catalog.lower(p_growth_plan_id::text)),
      (9, 'growthPlanLifecycle', pg_catalog.upper(p_growth_plan_lifecycle)),
      (10, 'growthPlanWeeklyCapacityMinutes', p_weekly_capacity_minutes::text),
      (11, 'growthPlanAggregateVersion', p_growth_plan_version::text),
      (12, 'learningTrackId', pg_catalog.lower(p_learning_track_id::text)),
      (13, 'trackKey', p_track_key),
      (14, 'title', p_title),
      (15, 'lifecycle', pg_catalog.upper(p_learning_track_lifecycle)),
      (16, 'priority', p_priority::text),
      (17, 'protectedMinimumMinutes', p_protected_minimum_minutes::text),
      (18, 'beforeCadencePerWeek', p_cadence_per_week::text),
      (19, 'beforeAggregateVersion', p_learning_track_version::text),
      (20, 'afterCadencePerWeek', p_proposed_cadence_per_week::text),
      (21, 'afterAggregateVersion', v_after_version::text),
      (22, 'progressState', v_progress_state),
      (23, 'snapshotId', case when v_progress_state = 'CURRENT'
        then v_progress->>'snapshotId' else '' end),
      (24, 'appliedAttemptId', case when v_progress_state = 'CURRENT'
        then v_progress->>'appliedAttemptId' else '' end),
      (25, 'inputFingerprint', case when v_progress_state = 'CURRENT'
        then v_progress->>'inputFingerprint' else '' end),
      (26, 'calculatedAsOf', case when v_progress_state = 'CURRENT'
        then v_progress->>'calculatedAsOf' else '' end),
      (27, 'completedCadenceSessionsThisWeek', coalesce(v_completed::text, '')),
      (28, 'beforeCadenceDeficit', coalesce(v_before_deficit::text, '')),
      (29, 'afterCadenceDeficit', coalesce(v_after_deficit::text, '')),
      (30, 'canApply', 'true'),
      (31, 'blockingReasonCount', '0'),
      (32, 'warningCount', v_warning_count::text)
    ) as fixed(field_position, field_name, field_value)
    union all
    select 32 + warning.ordinality, 'warningCode', warning.value->>'code'
    from pg_catalog.jsonb_array_elements(v_warnings)
      with ordinality as warning(value, ordinality)
    union all
    select 36 + v_warning_count, 'unchangedPriority', 'true'
    union all select 37 + v_warning_count, 'unchangedProtectedMinimumMinutes', 'true'
    union all select 38 + v_warning_count, 'unchangedLearningTrackActivities', 'true'
    union all select 39 + v_warning_count, 'unchangedPlanSnapshots', 'true'
    union all select 40 + v_warning_count, 'unchangedFocusSessions', 'true'
    union all select 41 + v_warning_count, 'unchangedEvidence', 'true'
    union all select 42 + v_warning_count, 'unchangedMasteryAndReadiness', 'true'
    union all select 43 + v_warning_count, 'unchangedReview', 'true'
    union all select 44 + v_warning_count, 'projectionStateAfterApply', 'PENDING'
    union all select 45 + v_warning_count, 'consumerName', 'planning.plan_snapshot_v1'
  ) as field;

  v_digest := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(v_digest_input, 'UTF8'), 'sha256'), 'hex'
  );

  return pg_catalog.jsonb_build_object(
    'contract', pg_catalog.jsonb_build_object(
      'name', 'LearningTrackCadencePreviewV1', 'version', '1.0.0'
    ),
    'operation', 'set_track_cadence',
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
      'learningTrackId', p_learning_track_id, 'trackKey', p_track_key,
      'title', p_title, 'lifecycle', pg_catalog.upper(p_learning_track_lifecycle),
      'priority', p_priority, 'protectedMinimumMinutes', p_protected_minimum_minutes,
      'cadencePerWeek', p_cadence_per_week,
      'aggregateVersion', p_learning_track_version::text
    ),
    'after', pg_catalog.jsonb_build_object(
      'learningTrackId', p_learning_track_id, 'trackKey', p_track_key,
      'title', p_title, 'lifecycle', pg_catalog.upper(p_learning_track_lifecycle),
      'priority', p_priority, 'protectedMinimumMinutes', p_protected_minimum_minutes,
      'cadencePerWeek', p_proposed_cadence_per_week,
      'aggregateVersion', v_after_version::text
    ),
    'progress', pg_catalog.jsonb_build_object(
      'state', v_progress_state,
      'snapshotId', case when v_progress_state = 'CURRENT' then v_progress->'snapshotId' else null end,
      'appliedAttemptId', case when v_progress_state = 'CURRENT'
        then v_progress->'appliedAttemptId' else null end,
      'inputFingerprint', case when v_progress_state = 'CURRENT'
        then v_progress->'inputFingerprint' else null end,
      'calculatedAsOf', case when v_progress_state = 'CURRENT'
        then v_progress->'calculatedAsOf' else null end,
      'completedCadenceSessionsThisWeek', v_completed,
      'beforeCadenceDeficit', v_before_deficit,
      'afterCadenceDeficit', v_after_deficit
    ),
    'canApply', true,
    'blockingReasons', '[]'::jsonb,
    'warnings', v_warnings,
    'unchanged', pg_catalog.jsonb_build_object(
      'priority', true, 'protectedMinimumMinutes', true,
      'learningTrackActivities', true, 'planSnapshots', true,
      'focusSessions', true, 'evidence', true,
      'masteryAndReadiness', true, 'review', true
    ),
    'recalculationAfterApply', pg_catalog.jsonb_build_object(
      'projectionState', 'PENDING', 'consumerName', 'planning.plan_snapshot_v1'
    ),
    'previewDigest', v_digest
  );
end
$function$;

create function planning.track_cadence_event_payload_v1_is_valid(p_payload jsonb)
returns boolean
language sql
immutable
strict
set search_path = ''
as $function$
  select pg_catalog.jsonb_typeof(p_payload) = 'object'
    and (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(p_payload)) = 5
    and p_payload->>'change_kind' = 'TRACK_CADENCE_CHANGED'
    and pg_catalog.jsonb_typeof(p_payload->'growth_plan_id') = 'string'
    and p_payload->>'growth_plan_id'
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and pg_catalog.jsonb_typeof(p_payload->'learning_track_id') = 'string'
    and p_payload->>'learning_track_id'
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and pg_catalog.jsonb_typeof(p_payload->'learning_track_version') = 'string'
    and case when p_payload->>'learning_track_version' ~ '^[1-9][0-9]{0,18}$'
      then (p_payload->>'learning_track_version')::numeric <= 9223372036854775807
      else false end
    and pg_catalog.jsonb_typeof(p_payload->'cadence_per_week') = 'number'
    and case when p_payload->>'cadence_per_week' ~ '^(0|[1-9][0-9]{0,2})$'
      then (p_payload->>'cadence_per_week')::integer between 0 and 100
      else false end
$function$;

create function api.get_learning_track_cadence_source_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_workspace_id uuid;
  v_plan planning.growth_plans%rowtype;
  v_progress jsonb;
  v_tracks jsonb := '[]'::jsonb;
  v_track_count integer;
begin
  if identity.jwt_subject() is null then
    raise exception using errcode = '28000', message = 'an authenticated user is required';
  end if;
  v_workspace_id := identity.personal_workspace_id_for_current_user();
  if v_workspace_id is null then
    raise exception using errcode = '42501', message = 'Learning Track cadence is unavailable';
  end if;
  select plan.* into v_plan from planning.growth_plans as plan
  where plan.workspace_id = v_workspace_id and plan.lifecycle in ('active', 'paused');
  if not found then
    return pg_catalog.jsonb_build_object(
      'contract', pg_catalog.jsonb_build_object(
        'name', 'LearningTrackCadenceSourceV1', 'version', '1.0.0'
      ),
      'growthPlan', null,
      'progress', pg_catalog.jsonb_build_object(
        'state', 'UNAVAILABLE', 'snapshotId', null, 'appliedAttemptId', null,
        'inputFingerprint', null, 'calculatedAsOf', null
      ),
      'learningTracks', v_tracks
    );
  end if;

  select pg_catalog.count(*)::integer into v_track_count
  from planning.learning_tracks as track
  where track.workspace_id = v_workspace_id
    and track.growth_plan_id = v_plan.growth_plan_id
    and track.lifecycle in ('active', 'paused');
  if v_track_count > 30 then
    raise exception using errcode = '54000', message = 'Learning Track portfolio exceeds 30 tracks';
  end if;

  v_progress := planning.read_learning_track_cadence_progress_v1(
    v_workspace_id, v_plan.growth_plan_id, pg_catalog.statement_timestamp()
  );
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'learningTrackId', track.learning_track_id,
    'trackKey', track.track_key,
    'title', track.title,
    'lifecycle', pg_catalog.upper(track.lifecycle),
    'priority', track.priority,
    'protectedMinimumMinutes', track.protected_minimum_minutes,
    'cadencePerWeek', track.cadence_per_week,
    'aggregateVersion', track.aggregate_version::text,
    'completedCadenceSessionsThisWeek', case when v_progress->>'state' = 'CURRENT'
      then (v_progress#>>array['countsByTrackId', track.learning_track_id::text])::integer
      else null end,
    'capabilities', pg_catalog.jsonb_build_array('set_track_cadence')
  ) order by track.priority desc, track.track_key collate "C", track.learning_track_id), '[]'::jsonb)
  into v_tracks
  from planning.learning_tracks as track
  where track.workspace_id = v_workspace_id
    and track.growth_plan_id = v_plan.growth_plan_id
    and track.lifecycle in ('active', 'paused');

  return pg_catalog.jsonb_build_object(
    'contract', pg_catalog.jsonb_build_object(
      'name', 'LearningTrackCadenceSourceV1', 'version', '1.0.0'
    ),
    'growthPlan', pg_catalog.jsonb_build_object(
      'growthPlanId', v_plan.growth_plan_id,
      'lifecycle', pg_catalog.upper(v_plan.lifecycle),
      'weeklyCapacityMinutes', v_plan.weekly_capacity_minutes,
      'aggregateVersion', v_plan.aggregate_version::text
    ),
    'progress', v_progress - 'countsByTrackId',
    'learningTracks', v_tracks
  );
end
$function$;

create function api.preview_learning_track_cadence_v1(
  p_track_key text,
  p_cadence_per_week integer,
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
  if p_cadence_per_week is null or p_cadence_per_week not between 0 and 100
     or p_expected_growth_plan_version is null
     or p_expected_growth_plan_version !~ '^[1-9][0-9]{0,18}$'
     or p_expected_learning_track_version is null
     or p_expected_learning_track_version !~ '^[1-9][0-9]{0,18}$'
     or p_expected_growth_plan_version::numeric > 9223372036854775807
     or p_expected_learning_track_version::numeric > 9223372036854775807 then
    raise exception using errcode = '22023', message = 'Learning Track cadence request is invalid';
  end if;
  select plan.* into v_plan from planning.growth_plans as plan
  where plan.workspace_id = v_workspace_id and plan.lifecycle in ('active', 'paused');
  if not found then
    raise exception using errcode = '42501', message = 'Learning Track is unavailable';
  end if;
  select track.* into v_track from planning.learning_tracks as track
  where track.workspace_id = v_workspace_id
    and track.growth_plan_id = v_plan.growth_plan_id
    and track.track_key = p_track_key
    and track.lifecycle in ('active', 'paused');
  if not found then
    raise exception using errcode = '42501', message = 'Learning Track is unavailable';
  end if;
  return planning.build_learning_track_cadence_preview_v1(
    v_workspace_id, v_plan.growth_plan_id, v_plan.lifecycle,
    v_plan.weekly_capacity_minutes, v_plan.aggregate_version,
    v_track.learning_track_id, v_track.track_key, v_track.title, v_track.lifecycle,
    v_track.priority, v_track.protected_minimum_minutes, v_track.cadence_per_week,
    v_track.aggregate_version, p_cadence_per_week,
    p_expected_growth_plan_version::bigint, p_expected_learning_track_version::bigint,
    p_reason, pg_catalog.statement_timestamp()
  );
end
$function$;

create function api.apply_learning_track_cadence_v1(
  p_track_key text,
  p_cadence_per_week integer,
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
  if p_cadence_per_week is null or p_cadence_per_week not between 0 and 100
     or p_expected_growth_plan_version is null
     or p_expected_growth_plan_version !~ '^[1-9][0-9]{0,18}$'
     or p_expected_learning_track_version is null
     or p_expected_learning_track_version !~ '^[1-9][0-9]{0,18}$'
     or p_expected_growth_plan_version::numeric > 9223372036854775807
     or p_expected_learning_track_version::numeric > 9223372036854775807 then
    raise exception using errcode = '22023', message = 'Learning Track cadence request is invalid';
  end if;
  if p_preview_digest is null or p_preview_digest !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'Learning Track cadence preview digest is invalid';
  end if;
  if p_reason is null or p_reason <> pg_catalog.btrim(p_reason)
     or pg_catalog.char_length(p_reason) not between 1 and 500
     or p_reason ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'Learning Track cadence reason is invalid';
  end if;
  if p_idempotency_key is null or p_idempotency_key <> pg_catalog.btrim(p_idempotency_key)
     or pg_catalog.char_length(p_idempotency_key) not between 1 and 128
     or p_idempotency_key ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'idempotency key is invalid';
  end if;

  v_request_hash := extensions.digest(pg_catalog.convert_to(
    pg_catalog.jsonb_build_object(
      'commandType', 'planning.change_learning_track_cadence_v1',
      'schemaVersion', 1, 'workspaceId', v_workspace_id,
      'operation', 'set_track_cadence', 'trackKey', p_track_key,
      'cadencePerWeek', p_cadence_per_week,
      'expectedGrowthPlanVersion', p_expected_growth_plan_version,
      'expectedLearningTrackVersion', p_expected_learning_track_version,
      'previewDigest', p_preview_digest, 'reason', p_reason
    )::text, 'UTF8'
  ), 'sha256');

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    v_actor_user_id::text || ':planning.change_learning_track_cadence_v1:'
      || p_idempotency_key, 0
  ));
  select receipt.* into v_receipt from outbox.command_receipts as receipt
  where receipt.actor_user_id = v_actor_user_id
    and receipt.command_type = 'planning.change_learning_track_cadence_v1'
    and receipt.idempotency_key = p_idempotency_key
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
  select plan.* into v_plan from planning.growth_plans as plan
  where plan.workspace_id = v_workspace_id and plan.lifecycle in ('active', 'paused')
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'Learning Track is unavailable';
  end if;
  perform track.learning_track_id from planning.learning_tracks as track
  where track.workspace_id = v_workspace_id and track.growth_plan_id = v_plan.growth_plan_id
  order by track.learning_track_id for update;
  perform pointer.workspace_id from planning.current_plan_snapshots as pointer
  where pointer.workspace_id = v_workspace_id for update;

  select track.* into v_track from planning.learning_tracks as track
  where track.workspace_id = v_workspace_id
    and track.growth_plan_id = v_plan.growth_plan_id
    and track.track_key = p_track_key
    and track.lifecycle in ('active', 'paused');
  if not found then
    raise exception using errcode = '42501', message = 'Learning Track is unavailable';
  end if;

  v_preview := planning.build_learning_track_cadence_preview_v1(
    v_workspace_id, v_plan.growth_plan_id, v_plan.lifecycle,
    v_plan.weekly_capacity_minutes, v_plan.aggregate_version,
    v_track.learning_track_id, v_track.track_key, v_track.title, v_track.lifecycle,
    v_track.priority, v_track.protected_minimum_minutes, v_track.cadence_per_week,
    v_track.aggregate_version, p_cadence_per_week,
    p_expected_growth_plan_version::bigint, p_expected_learning_track_version::bigint,
    p_reason, pg_catalog.statement_timestamp()
  );
  if v_preview->>'previewDigest' is distinct from p_preview_digest then
    raise exception using errcode = '40001', message = 'Learning Track cadence preview is stale';
  end if;

  insert into outbox.command_receipts (
    command_id, command_type, command_schema_version, workspace_id, actor_user_id,
    idempotency_key, request_hash, correlation_id, expected_aggregate_version
  ) values (
    v_command_id, 'planning.change_learning_track_cadence_v1', 1,
    v_workspace_id, v_actor_user_id, p_idempotency_key, v_request_hash,
    v_correlation_id, p_expected_learning_track_version::bigint
  );

  update planning.learning_tracks
  set cadence_per_week = p_cadence_per_week,
    aggregate_version = aggregate_version + 1,
    updated_at = pg_catalog.clock_timestamp()
  where workspace_id = v_workspace_id
    and growth_plan_id = v_plan.growth_plan_id
    and learning_track_id = v_track.learning_track_id
    and lifecycle = v_track.lifecycle
    and cadence_per_week = v_track.cadence_per_week
    and aggregate_version = v_track.aggregate_version;
  get diagnostics v_affected_rows = row_count;
  if v_affected_rows <> 1 then
    raise exception using errcode = '55000', message = 'Learning Track cadence update failed';
  end if;

  v_payload := pg_catalog.jsonb_build_object(
    'change_kind', 'TRACK_CADENCE_CHANGED',
    'growth_plan_id', v_plan.growth_plan_id,
    'learning_track_id', v_track.learning_track_id,
    'learning_track_version', v_preview#>>'{after,aggregateVersion}',
    'cadence_per_week', p_cadence_per_week
  );
  if planning.track_cadence_event_payload_v1_is_valid(v_payload) is not true then
    raise exception using errcode = '55000', message = 'Planning Track cadence event payload is invalid';
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
      'name', 'LearningTrackCadenceApplyResultV1', 'version', '1.0.0'
    ),
    'commandId', v_command_id,
    'changedTrack', v_preview->'after',
    'projectionState', 'PENDING',
    'planningDeliveryId', v_delivery_id,
    'emittedEventIds', pg_catalog.jsonb_build_array(v_event_id)
  );
  update outbox.command_receipts
  set command_status = 'completed', response = v_response,
    emitted_event_ids = array[v_event_id], completed_at = pg_catalog.clock_timestamp()
  where command_id = v_command_id;
  get diagnostics v_affected_rows = row_count;
  if v_affected_rows <> 1 then
    raise exception using errcode = '55000', message = 'Learning Track cadence receipt completion failed';
  end if;
  return v_response;
end
$function$;

alter function planning.read_learning_track_cadence_progress_v1(uuid, uuid, timestamptz)
  owner to pando_planning_worker;
alter function planning.build_learning_track_cadence_preview_v1(
  uuid, uuid, text, integer, bigint, uuid, text, text, text, integer, integer,
  integer, bigint, integer, bigint, bigint, text, timestamptz
) owner to pando_planning_api;
alter function planning.track_cadence_event_payload_v1_is_valid(jsonb)
  owner to pando_planning_api;
alter function api.get_learning_track_cadence_source_v1() owner to pando_planning_api;
alter function api.preview_learning_track_cadence_v1(text, integer, text, text, text)
  owner to pando_planning_api;
alter function api.apply_learning_track_cadence_v1(text, integer, text, text, text, text, text)
  owner to pando_planning_api;

revoke all on function
  planning.read_learning_track_cadence_progress_v1(uuid, uuid, timestamptz),
  planning.build_learning_track_cadence_preview_v1(
    uuid, uuid, text, integer, bigint, uuid, text, text, text, integer, integer,
    integer, bigint, integer, bigint, bigint, text, timestamptz
  ),
  planning.track_cadence_event_payload_v1_is_valid(jsonb),
  api.get_learning_track_cadence_source_v1(),
  api.preview_learning_track_cadence_v1(text, integer, text, text, text),
  api.apply_learning_track_cadence_v1(text, integer, text, text, text, text, text)
  from public, anon, authenticated, service_role;

grant execute on function
  planning.read_learning_track_cadence_progress_v1(uuid, uuid, timestamptz)
  to pando_planning_api;
grant execute on function
  api.get_learning_track_cadence_source_v1(),
  api.preview_learning_track_cadence_v1(text, integer, text, text, text),
  api.apply_learning_track_cadence_v1(text, integer, text, text, text, text, text)
  to authenticated;

revoke create on schema planning, api from pando_planning_api;
revoke create on schema planning from pando_planning_worker;

do $migration_role_membership$
begin
  execute pg_catalog.format('revoke pando_planning_api from %I', current_user);
  execute pg_catalog.format('revoke pando_planning_worker from %I', current_user);
end
$migration_role_membership$;
