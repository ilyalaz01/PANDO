-- Phase 4B D2c expand-only persistence and dual calculation-contract support.
-- New attempts remain on planning-calculation/1 until the later activation migration.

do $membership$
begin
  execute pg_catalog.format(
    'grant pando_planning_worker to %I with set true',
    current_user
  );
end
$membership$;

alter table planning.learning_tracks
  add column cadence_per_week smallint not null default 0,
  add constraint learning_tracks_cadence_per_week_check
    check (cadence_per_week between 0 and 100);

alter table planning.plan_snapshot_attempts
  add column calculation_contract_version text not null default 'planning-calculation/1',
  add constraint plan_snapshot_attempt_calculation_contract_check check (
    calculation_contract_version in ('planning-calculation/1', 'planning-calculation/2')
  );

alter table planning.plan_snapshots
  drop constraint plan_snapshots_engine_check,
  drop constraint plan_snapshots_policy_check,
  add constraint plan_snapshots_calculation_tuple_check check (
    (engine_version = 'planner-engine/0.1.0' and policy_version = 'planning-policy/0.1')
    or
    (engine_version = 'planner-engine/0.2.0' and policy_version = 'planning-policy/0.2')
  );

grant create on schema planning to pando_planning_worker;
set role pando_planning_worker;

create function planning.load_plan_snapshot_source_bundle_v2(
  p_workspace_id uuid,
  p_claim_as_of timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_bundle jsonb;
  v_tracks jsonb := '[]'::jsonb;
  v_expected_count integer;
  v_fence text;
begin
  if p_workspace_id is null or p_claim_as_of is null then
    raise exception using errcode = '22023', message = 'planning source bundle input is invalid';
  end if;

  v_bundle := planning.load_plan_snapshot_source_bundle_v1(
    p_workspace_id, p_claim_as_of
  );

  if v_bundle->'plan' is not null and pg_catalog.jsonb_typeof(v_bundle->'plan') <> 'null' then
    v_expected_count := pg_catalog.jsonb_array_length(v_bundle#>'{plan,tracks}');
    select coalesce(pg_catalog.jsonb_agg(
      source.value || pg_catalog.jsonb_build_object(
        'cadencePerWeek', track.cadence_per_week
      ) order by source.ordinality
    ), '[]'::jsonb)
    into v_tracks
    from pg_catalog.jsonb_array_elements(v_bundle#>'{plan,tracks}')
      with ordinality as source(value, ordinality)
    join planning.learning_tracks as track
      on track.workspace_id = p_workspace_id
     and track.learning_track_id = (source.value->>'trackId')::uuid
     and track.growth_plan_id = (v_bundle#>>'{plan,growthPlanId}')::uuid;

    if pg_catalog.jsonb_array_length(v_tracks) <> v_expected_count then
      raise exception using errcode = '55000', message = 'planning cadence source fence is inconsistent';
    end if;

    v_bundle := pg_catalog.jsonb_set(
      v_bundle - 'sourceFence', '{plan,tracks}', v_tracks, false
    );
  else
    v_bundle := v_bundle - 'sourceFence';
  end if;

  v_fence := pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to(v_bundle::text, 'UTF8'), 'sha256'
  ), 'hex');
  return v_bundle || pg_catalog.jsonb_build_object(
    'sourceFence', 'planning-source:' || v_fence
  );
end
$function$;

create or replace function planning.guard_plan_snapshot_attempt_mutation()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = 'plan snapshot attempts cannot be deleted';
  end if;
  if new.attempt_id <> old.attempt_id or new.workspace_id <> old.workspace_id
     or new.delivery_id <> old.delivery_id or new.event_id <> old.event_id
     or new.event_position <> old.event_position or new.generation <> old.generation
     or new.claim_as_of <> old.claim_as_of or new.base_pointer_version <> old.base_pointer_version
     or new.calculation_contract_version <> old.calculation_contract_version
     or new.scheduled_source_snapshot_id is distinct from old.scheduled_source_snapshot_id
     or (old.normalized_input is not null and (
       new.normalized_input is distinct from old.normalized_input
       or new.input_fingerprint is distinct from old.input_fingerprint
       or new.valid_until is distinct from old.valid_until
       or new.source_fence is distinct from old.source_fence
       or new.covered_delivery_ids is distinct from old.covered_delivery_ids
     )) then
    raise exception using errcode = '55000', message = 'plan snapshot attempt provenance is immutable';
  end if;
  return new;
end
$function$;

alter function planning.load_plan_snapshot_projection_impl(uuid, uuid, uuid)
  rename to load_plan_snapshot_projection_v1_impl;
alter function planning.record_plan_snapshot_input_impl(uuid, uuid, uuid, text, jsonb)
  rename to record_plan_snapshot_input_v1_impl;
alter function planning.complete_plan_snapshot_projection_impl(uuid, uuid, uuid, jsonb)
  rename to complete_plan_snapshot_projection_v1_impl;

create function planning.load_plan_snapshot_projection_v2_impl(
  p_delivery_id uuid, p_lease_token uuid, p_attempt_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_delivery outbox.deliveries%rowtype;
  v_event outbox.events%rowtype;
  v_attempt planning.plan_snapshot_attempts%rowtype;
  v_bundle jsonb;
  v_generation smallint;
  v_pointer_version bigint;
begin
  select delivery.* into v_delivery from outbox.deliveries as delivery
  where delivery.delivery_id = p_delivery_id
    and delivery.consumer_name = 'planning.plan_snapshot_v1'
    and delivery.handler_contract_version = 1 for update;
  if not found or v_delivery.delivery_state <> 'leased'
     or v_delivery.lease_token is distinct from p_lease_token
     or v_delivery.lease_expires_at <= clock_timestamp() then
    raise exception using errcode = '42501', message = 'planning delivery lease is not valid';
  end if;
  select event.* into strict v_event from outbox.events as event
  where event.event_id = v_delivery.event_id and event.workspace_id = v_delivery.workspace_id;
  if not planning.plan_snapshot_event_is_valid_v1(v_event) then
    raise exception using errcode = '22023', message = 'planning delivery event contract is invalid';
  end if;
  select attempt.* into strict v_attempt from planning.plan_snapshot_attempts as attempt
  where attempt.attempt_id = p_attempt_id and attempt.delivery_id = p_delivery_id
    and attempt.attempt_state in ('LOADING', 'READY')
    and attempt.calculation_contract_version = 'planning-calculation/2' for update;
  v_bundle := planning.load_plan_snapshot_source_bundle_v2(
    v_delivery.workspace_id, v_attempt.claim_as_of
  );
  if v_attempt.attempt_state = 'READY' and (
    v_attempt.source_fence is distinct from v_bundle->>'sourceFence'
    or clock_timestamp() > v_attempt.valid_until
  ) then
    update planning.plan_snapshot_attempts set attempt_state = 'SUPERSEDED',
      updated_at = clock_timestamp() where attempt_id = v_attempt.attempt_id;
    select max(attempt.generation) + 1 into v_generation
    from planning.plan_snapshot_attempts as attempt where attempt.delivery_id = p_delivery_id;
    select pointer.pointer_version into strict v_pointer_version
    from planning.current_plan_snapshots as pointer
    where pointer.workspace_id = v_delivery.workspace_id;
    insert into planning.plan_snapshot_attempts (
      workspace_id, delivery_id, event_id, event_position, generation, claim_as_of,
      base_pointer_version, scheduled_source_snapshot_id, calculation_contract_version
    ) values (
      v_delivery.workspace_id, v_delivery.delivery_id, v_delivery.event_id,
      v_event.event_position, v_generation, clock_timestamp(), v_pointer_version,
      case when v_event.event_name = 'planning.snapshot_refresh_scheduled'
        then (v_event.payload->>'source_snapshot_id')::uuid end,
      'planning-calculation/2'
    ) returning * into v_attempt;
    v_bundle := planning.load_plan_snapshot_source_bundle_v2(
      v_delivery.workspace_id, v_attempt.claim_as_of
    );
  end if;
  return pg_catalog.jsonb_build_object(
    'attemptId', v_attempt.attempt_id,
    'generation', v_attempt.generation,
    'claimAsOf', v_attempt.claim_as_of,
    'calculationContractVersion', v_attempt.calculation_contract_version,
    'sourceFence', v_bundle->>'sourceFence',
    'sourceBundle', v_bundle,
    'storedInput', case when v_attempt.attempt_state = 'READY'
      then v_attempt.normalized_input else null end
  );
end
$function$;

create function planning.load_plan_snapshot_projection_impl(
  p_delivery_id uuid, p_lease_token uuid, p_attempt_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_contract text;
  v_loaded jsonb;
begin
  select attempt.calculation_contract_version into strict v_contract
  from planning.plan_snapshot_attempts as attempt
  where attempt.attempt_id = p_attempt_id and attempt.delivery_id = p_delivery_id;

  if v_contract = 'planning-calculation/1' then
    v_loaded := planning.load_plan_snapshot_projection_v1_impl(
      p_delivery_id, p_lease_token, p_attempt_id
    );
    return v_loaded || pg_catalog.jsonb_build_object(
      'calculationContractVersion', 'planning-calculation/1'
    );
  elsif v_contract = 'planning-calculation/2' then
    return planning.load_plan_snapshot_projection_v2_impl(
      p_delivery_id, p_lease_token, p_attempt_id
    );
  end if;
  raise exception using errcode = '22023', message = 'planning calculation contract is invalid';
end
$function$;

create function planning.record_plan_snapshot_input_v2_impl(
  p_delivery_id uuid, p_lease_token uuid, p_attempt_id uuid,
  p_source_fence text, p_input jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_delivery outbox.deliveries%rowtype;
  v_attempt planning.plan_snapshot_attempts%rowtype;
  v_bundle jsonb;
  v_ids uuid[];
begin
  select delivery.* into v_delivery from outbox.deliveries as delivery
  where delivery.delivery_id = p_delivery_id for update;
  if not found or v_delivery.consumer_name <> 'planning.plan_snapshot_v1'
     or v_delivery.handler_contract_version <> 1
     or v_delivery.delivery_state <> 'leased'
     or v_delivery.lease_token is distinct from p_lease_token
     or v_delivery.lease_expires_at <= clock_timestamp() then
    raise exception using errcode = '42501', message = 'planning delivery lease is not valid';
  end if;
  select attempt.* into strict v_attempt from planning.plan_snapshot_attempts as attempt
  where attempt.attempt_id = p_attempt_id and attempt.delivery_id = p_delivery_id
    and attempt.attempt_state = 'LOADING'
    and attempt.calculation_contract_version = 'planning-calculation/2' for update;
  v_bundle := planning.load_plan_snapshot_source_bundle_v2(
    v_attempt.workspace_id, v_attempt.claim_as_of
  );
  if p_source_fence is null or p_source_fence <> v_bundle->>'sourceFence'
     or p_input->>'inputFingerprint' !~ '^planning-input:[a-f0-9]{64}$'
     or (p_input#>>'{evaluationHorizon,asOf}')::timestamptz <> v_attempt.claim_as_of
     or (p_input#>>'{evaluationHorizon,validUntil}')::timestamptz < v_attempt.claim_as_of then
    raise exception using errcode = '22023', message = 'planning normalized input provenance is invalid';
  end if;
  select coalesce(pg_catalog.array_agg(value::uuid order by value::text), array[]::uuid[])
  into v_ids from pg_catalog.jsonb_array_elements_text(v_bundle->'visibleDeliveryIds') as value;
  update planning.plan_snapshot_attempts set attempt_state = 'READY',
    source_fence = p_source_fence, normalized_input = p_input,
    input_fingerprint = p_input->>'inputFingerprint',
    valid_until = (p_input#>>'{evaluationHorizon,validUntil}')::timestamptz,
    covered_delivery_ids = v_ids, updated_at = clock_timestamp()
  where attempt_id = p_attempt_id;
  return true;
end
$function$;

create function planning.record_plan_snapshot_input_impl(
  p_delivery_id uuid, p_lease_token uuid, p_attempt_id uuid,
  p_source_fence text, p_input jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_contract text;
  v_tracks jsonb;
begin
  select attempt.calculation_contract_version into strict v_contract
  from planning.plan_snapshot_attempts as attempt
  where attempt.attempt_id = p_attempt_id and attempt.delivery_id = p_delivery_id;
  v_tracks := coalesce(p_input#>'{growthPlan,tracks}', '[]'::jsonb);

  if v_contract = 'planning-calculation/1' then
    if p_input->>'completedWorkPolicyVersion' <> 'planning-completed-work/0.1'
       or exists (
         select 1 from pg_catalog.jsonb_array_elements(v_tracks) as track(value)
         where track.value ? 'cadencePerWeek'
            or track.value ? 'completedCadenceSessionsThisWeek'
       ) then
      raise exception using errcode = '22023', message = 'planning V1 normalized input is invalid';
    end if;
    return planning.record_plan_snapshot_input_v1_impl(
      p_delivery_id, p_lease_token, p_attempt_id, p_source_fence, p_input
    );
  elsif v_contract = 'planning-calculation/2' then
    if p_input->>'completedWorkPolicyVersion' <> 'planning-completed-work/0.2'
       or exists (
         select 1 from pg_catalog.jsonb_array_elements(v_tracks) as track(value)
         where not (track.value ? 'cadencePerWeek')
            or not (track.value ? 'completedCadenceSessionsThisWeek')
            or pg_catalog.jsonb_typeof(track.value->'cadencePerWeek') <> 'number'
            or pg_catalog.jsonb_typeof(track.value->'completedCadenceSessionsThisWeek') <> 'number'
            or track.value->>'cadencePerWeek' !~ '^(0|[1-9][0-9]{0,2})$'
            or track.value->>'completedCadenceSessionsThisWeek' !~ '^(0|[1-9][0-9]{0,2})$'
            or (track.value->>'cadencePerWeek')::integer > 100
            or (track.value->>'completedCadenceSessionsThisWeek')::integer > 500
       ) then
      raise exception using errcode = '22023', message = 'planning V2 normalized input is invalid';
    end if;
    return planning.record_plan_snapshot_input_v2_impl(
      p_delivery_id, p_lease_token, p_attempt_id, p_source_fence, p_input
    );
  end if;
  raise exception using errcode = '22023', message = 'planning calculation contract is invalid';
end
$function$;

create function planning.complete_plan_snapshot_projection_v2_impl(
  p_delivery_id uuid, p_lease_token uuid, p_attempt_id uuid, p_result jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_delivery outbox.deliveries%rowtype;
  v_event outbox.events%rowtype;
  v_attempt planning.plan_snapshot_attempts%rowtype;
  v_pointer planning.current_plan_snapshots%rowtype;
  v_bundle jsonb;
  v_snapshot_id uuid;
  v_next_pointer bigint;
  v_action jsonb;
  v_selection_id uuid;
  v_action_count integer;
  v_visible_delivery_id uuid;
  v_schedule_event_id uuid;
  v_scheduled_for timestamptz;
  v_canonical_valid_until text;
begin
  select delivery.* into v_delivery from outbox.deliveries as delivery
  where delivery.delivery_id = p_delivery_id for update;
  if not found or v_delivery.consumer_name <> 'planning.plan_snapshot_v1'
     or v_delivery.handler_contract_version <> 1
     or v_delivery.delivery_state <> 'leased'
     or v_delivery.lease_token is distinct from p_lease_token
     or v_delivery.lease_expires_at <= clock_timestamp() then
    raise exception using errcode = '42501', message = 'planning delivery lease is not valid';
  end if;
  select event.* into strict v_event from outbox.events as event
  where event.event_id = v_delivery.event_id and event.workspace_id = v_delivery.workspace_id;
  select attempt.* into strict v_attempt from planning.plan_snapshot_attempts as attempt
  where attempt.attempt_id = p_attempt_id and attempt.delivery_id = p_delivery_id
    and attempt.attempt_state = 'READY'
    and attempt.calculation_contract_version = 'planning-calculation/2' for update;
  if v_attempt.normalized_input->>'completedWorkPolicyVersion'
       <> 'planning-completed-work/0.2'
     or p_result->>'inputFingerprint' is distinct from v_attempt.input_fingerprint
     or p_result->>'engineVersion' <> 'planner-engine/0.2.0'
     or p_result->>'policyVersion' <> 'planning-policy/0.2'
     or (p_result->>'calculatedAsOf')::timestamptz <> v_attempt.claim_as_of
     or (p_result->>'validUntil')::timestamptz <> v_attempt.valid_until
     or p_result->'actions' is null or pg_catalog.jsonb_typeof(p_result->'actions') <> 'array'
     or pg_catalog.jsonb_array_length(p_result->'actions') > 5 then
    raise exception using errcode = '22023', message = 'planning projection result is invalid';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('planning-workspace:' || v_attempt.workspace_id::text, 0)
  );
  select pointer.* into strict v_pointer from planning.current_plan_snapshots as pointer
  where pointer.workspace_id = v_attempt.workspace_id for update;
  v_bundle := planning.load_plan_snapshot_source_bundle_v2(
    v_attempt.workspace_id, v_attempt.claim_as_of
  );
  if v_attempt.scheduled_source_snapshot_id is not null
     and v_pointer.snapshot_id is distinct from v_attempt.scheduled_source_snapshot_id then
    update planning.plan_snapshot_attempts set attempt_state = 'SUPERSEDED',
      applied_pointer_version = v_pointer.pointer_version, updated_at = clock_timestamp()
    where attempt_id = v_attempt.attempt_id;
    update planning.plan_snapshot_delivery_ledger set coverage_state = 'SUPERSEDED',
      covered_by_pointer_version = v_pointer.pointer_version,
      covered_by_attempt_id = v_attempt.attempt_id, updated_at = clock_timestamp()
    where delivery_id = v_delivery.delivery_id;
    insert into outbox.consumer_receipts (
      delivery_id, event_id, workspace_id, consumer_name, handler_contract_version,
      input_event_position, lease_token
    ) values (
      v_delivery.delivery_id, v_delivery.event_id, v_delivery.workspace_id,
      'planning.plan_snapshot_v1', 1, v_event.event_position, p_lease_token
    ) on conflict (delivery_id) do nothing;
    update outbox.deliveries set delivery_state = 'succeeded', lease_token = null,
      lease_expires_at = null, completed_at = clock_timestamp()
    where delivery_id = v_delivery.delivery_id;
    return 'SUPERSEDED';
  end if;
  if v_attempt.source_fence is distinct from v_bundle->>'sourceFence'
     or v_attempt.base_pointer_version <> v_pointer.pointer_version
     or clock_timestamp() > v_attempt.valid_until then
    update planning.plan_snapshot_attempts set
      attempt_state = case when v_delivery.attempt_count >= 8 then 'FAILED' else 'SUPERSEDED' end,
      failure_class = case when v_delivery.attempt_count >= 8 then 'EXHAUSTED' end,
      error_code = case when v_delivery.attempt_count >= 8
        then 'STALE_PLANNING_INPUT_AFTER_MAX_ATTEMPTS' end,
      updated_at = clock_timestamp()
    where attempt_id = v_attempt.attempt_id;
    update outbox.deliveries set
      delivery_state = case when v_delivery.attempt_count >= 8 then 'dead_letter' else 'retry' end,
      available_at = case when v_delivery.attempt_count >= 8
        then available_at else clock_timestamp() end,
      lease_token = null, lease_expires_at = null,
      last_failure_class = case when v_delivery.attempt_count >= 8
        then 'EXHAUSTED' else 'STALE_INPUT' end,
      last_error_code = case when v_delivery.attempt_count >= 8
        then 'STALE_PLANNING_INPUT_AFTER_MAX_ATTEMPTS' else 'STALE_PLANNING_INPUT' end,
      last_failed_at = clock_timestamp(),
      dead_lettered_at = case when v_delivery.attempt_count >= 8
        then clock_timestamp() else null end
    where delivery_id = v_delivery.delivery_id;
    return case when v_delivery.attempt_count >= 8 then 'DEAD_LETTER' else 'RETRY' end;
  end if;

  if v_pointer.snapshot_id is not null and exists (
    select 1 from planning.plan_snapshots as snapshot
    where snapshot.workspace_id = v_attempt.workspace_id
      and snapshot.snapshot_id = v_pointer.snapshot_id
      and snapshot.engine_version = 'planner-engine/0.2.0'
      and snapshot.policy_version = 'planning-policy/0.2'
      and snapshot.input_fingerprint = v_attempt.input_fingerprint
  ) then
    v_snapshot_id := v_pointer.snapshot_id;
    v_next_pointer := v_pointer.pointer_version;
  else
    insert into planning.plan_snapshots (
      snapshot_id, workspace_id, growth_plan_id, input_fingerprint, engine_version,
      policy_version, calculated_as_of, valid_until, time_zone, week_start, week_end,
      recommendation_state, result
    ) values (
      gen_random_uuid(), v_attempt.workspace_id,
      nullif(v_attempt.normalized_input#>>'{growthPlan,growthPlanId}', '')::uuid,
      v_attempt.input_fingerprint, p_result->>'engineVersion', p_result->>'policyVersion',
      (p_result->>'calculatedAsOf')::timestamptz, (p_result->>'validUntil')::timestamptz,
      p_result->>'timeZone', (p_result->>'weekStart')::timestamptz,
      (p_result->>'weekEnd')::timestamptz, p_result->>'recommendationState', p_result
    ) on conflict (workspace_id, engine_version, policy_version, input_fingerprint) do nothing;
    select snapshot.snapshot_id into strict v_snapshot_id
    from planning.plan_snapshots as snapshot
    where snapshot.workspace_id = v_attempt.workspace_id
      and snapshot.engine_version = 'planner-engine/0.2.0'
      and snapshot.policy_version = 'planning-policy/0.2'
      and snapshot.input_fingerprint = v_attempt.input_fingerprint;
    v_action_count := pg_catalog.jsonb_array_length(p_result->'actions');
    if not exists (
      select 1 from planning.plan_action_selections as selection
      where selection.workspace_id = v_attempt.workspace_id
        and selection.snapshot_id = v_snapshot_id
    ) then
      for v_action in select value from pg_catalog.jsonb_array_elements(p_result->'actions') loop
        v_selection_id := gen_random_uuid();
        insert into planning.plan_action_selections (
          selection_id, selection_ref, workspace_id, snapshot_id, attempt_id, rank,
          candidate_key, action_kind, readiness_goal_key, activity_key,
          learning_track_id, focus_session_id, planned_minutes, expires_at
        ) values (
          v_selection_id, 'plan-action:' || v_selection_id::text,
          v_attempt.workspace_id, v_snapshot_id, v_attempt.attempt_id,
          (v_action->>'rank')::smallint, v_action->>'candidateKey', v_action->>'actionKind',
          v_action->>'readinessGoalKey', v_action->>'activityKey',
          nullif(v_action->>'trackId', '')::uuid, nullif(v_action->>'focusSessionId', '')::uuid,
          (v_action->>'durationMinutes')::smallint, v_attempt.valid_until
        );
      end loop;
    elsif (select count(*) from planning.plan_action_selections as selection
      where selection.workspace_id = v_attempt.workspace_id
        and selection.snapshot_id = v_snapshot_id) <> v_action_count then
      raise exception using errcode = '23514', message = 'planning action selections conflict';
    end if;
    v_next_pointer := v_pointer.pointer_version + 1;
    update planning.current_plan_snapshots set snapshot_id = v_snapshot_id,
      pointer_version = v_next_pointer, applied_attempt_id = v_attempt.attempt_id,
      updated_at = clock_timestamp()
    where workspace_id = v_attempt.workspace_id;

    v_scheduled_for := v_attempt.valid_until + interval '1 millisecond';
    v_canonical_valid_until := pg_catalog.to_char(v_attempt.valid_until at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
    v_schedule_event_id := planning.stable_plan_uuid_v1(
      v_attempt.workspace_id::text || '|planning.plan_snapshot_v1|' ||
      v_snapshot_id::text || '|' || v_canonical_valid_until
    );
    insert into outbox.events (
      event_id, event_name, event_schema_version, workspace_id, aggregate_type,
      aggregate_id, aggregate_version, actor_type, actor_user_id, command_id,
      correlation_id, causation_id, occurred_at, source, payload
    ) values (
      v_schedule_event_id, 'planning.snapshot_refresh_scheduled', 1,
      v_attempt.workspace_id, 'planning.plan_snapshot', v_snapshot_id, v_next_pointer,
      'system', null, v_event.command_id, v_event.correlation_id, v_event.event_id,
      clock_timestamp(), 'pando.planning_worker', pg_catalog.jsonb_build_object(
        'workspace_id', v_attempt.workspace_id,
        'source_snapshot_id', v_snapshot_id,
        'input_fingerprint', v_attempt.input_fingerprint,
        'valid_until', v_attempt.valid_until,
        'scheduled_for', v_scheduled_for
      )
    ) on conflict (event_id) do nothing;
    insert into outbox.deliveries (
      event_id, workspace_id, consumer_name, handler_contract_version, available_at
    ) values (
      v_schedule_event_id, v_attempt.workspace_id, 'planning.plan_snapshot_v1', 1,
      v_scheduled_for
    ) on conflict (event_id, consumer_name, handler_contract_version) do nothing;
  end if;

  foreach v_visible_delivery_id in array v_attempt.covered_delivery_ids loop
    update planning.plan_snapshot_delivery_ledger set coverage_state = 'COVERED',
      covered_by_pointer_version = v_next_pointer,
      covered_by_attempt_id = v_attempt.attempt_id, updated_at = clock_timestamp()
    where delivery_id = v_visible_delivery_id and coverage_state = 'UNCOVERED';
    insert into outbox.consumer_receipts (
      delivery_id, event_id, workspace_id, consumer_name, handler_contract_version,
      input_event_position, lease_token
    ) select delivery.delivery_id, delivery.event_id, delivery.workspace_id,
      delivery.consumer_name, delivery.handler_contract_version, event.event_position,
      p_lease_token
    from outbox.deliveries as delivery join outbox.events as event
      on event.event_id = delivery.event_id and event.workspace_id = delivery.workspace_id
    where delivery.delivery_id = v_visible_delivery_id
    on conflict (delivery_id) do nothing;
    update outbox.deliveries set delivery_state = 'succeeded', lease_token = null,
      lease_expires_at = null, completed_at = clock_timestamp()
    where delivery_id = v_visible_delivery_id and delivery_state <> 'succeeded';
  end loop;
  update planning.plan_snapshot_attempts set attempt_state = 'APPLIED',
    applied_pointer_version = v_next_pointer, updated_at = clock_timestamp()
  where attempt_id = v_attempt.attempt_id;
  update planning.plan_snapshot_attempts set attempt_state = 'SUPERSEDED',
    updated_at = clock_timestamp()
  where workspace_id = v_attempt.workspace_id and attempt_id <> v_attempt.attempt_id
    and attempt_state in ('LOADING', 'READY');
  return case when v_next_pointer = v_pointer.pointer_version then 'COVERED' else 'APPLIED' end;
end
$function$;

create function planning.complete_plan_snapshot_projection_impl(
  p_delivery_id uuid, p_lease_token uuid, p_attempt_id uuid, p_result jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_contract text;
  v_completed_work_policy text;
begin
  select attempt.calculation_contract_version,
    attempt.normalized_input->>'completedWorkPolicyVersion'
  into strict v_contract, v_completed_work_policy
  from planning.plan_snapshot_attempts as attempt
  where attempt.attempt_id = p_attempt_id and attempt.delivery_id = p_delivery_id;

  if v_contract = 'planning-calculation/1'
     and v_completed_work_policy = 'planning-completed-work/0.1' then
    return planning.complete_plan_snapshot_projection_v1_impl(
      p_delivery_id, p_lease_token, p_attempt_id, p_result
    );
  elsif v_contract = 'planning-calculation/2'
     and v_completed_work_policy = 'planning-completed-work/0.2' then
    return planning.complete_plan_snapshot_projection_v2_impl(
      p_delivery_id, p_lease_token, p_attempt_id, p_result
    );
  end if;
  raise exception using errcode = '22023', message = 'planning calculation tuple is invalid';
end
$function$;

alter function planning.load_plan_snapshot_source_bundle_v2(uuid, timestamptz)
  owner to pando_planning_worker;
alter function planning.guard_plan_snapshot_attempt_mutation()
  owner to pando_planning_worker;
alter function planning.load_plan_snapshot_projection_v2_impl(uuid, uuid, uuid)
  owner to pando_planning_worker;
alter function planning.load_plan_snapshot_projection_impl(uuid, uuid, uuid)
  owner to pando_planning_worker;
alter function planning.record_plan_snapshot_input_v2_impl(uuid, uuid, uuid, text, jsonb)
  owner to pando_planning_worker;
alter function planning.record_plan_snapshot_input_impl(uuid, uuid, uuid, text, jsonb)
  owner to pando_planning_worker;
alter function planning.complete_plan_snapshot_projection_v2_impl(uuid, uuid, uuid, jsonb)
  owner to pando_planning_worker;
alter function planning.complete_plan_snapshot_projection_impl(uuid, uuid, uuid, jsonb)
  owner to pando_planning_worker;

revoke all on function
  planning.load_plan_snapshot_source_bundle_v2(uuid, timestamptz),
  planning.load_plan_snapshot_projection_v1_impl(uuid, uuid, uuid),
  planning.load_plan_snapshot_projection_v2_impl(uuid, uuid, uuid),
  planning.load_plan_snapshot_projection_impl(uuid, uuid, uuid),
  planning.record_plan_snapshot_input_v1_impl(uuid, uuid, uuid, text, jsonb),
  planning.record_plan_snapshot_input_v2_impl(uuid, uuid, uuid, text, jsonb),
  planning.record_plan_snapshot_input_impl(uuid, uuid, uuid, text, jsonb),
  planning.complete_plan_snapshot_projection_v1_impl(uuid, uuid, uuid, jsonb),
  planning.complete_plan_snapshot_projection_v2_impl(uuid, uuid, uuid, jsonb),
  planning.complete_plan_snapshot_projection_impl(uuid, uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;

grant execute on function
  planning.load_plan_snapshot_projection_impl(uuid, uuid, uuid),
  planning.record_plan_snapshot_input_impl(uuid, uuid, uuid, text, jsonb),
  planning.complete_plan_snapshot_projection_impl(uuid, uuid, uuid, jsonb)
  to service_role;

reset role;
revoke create on schema planning from pando_planning_worker;

do $membership$
begin
  execute pg_catalog.format(
    'revoke pando_planning_worker from %I',
    current_user
  );
end
$membership$;
