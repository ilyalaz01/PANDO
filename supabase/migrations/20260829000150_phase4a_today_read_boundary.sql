-- Phase 4A C6: live Today read boundary, opaque action resolution, and attributed Focus start.
--
-- Today is a read model over Planning-owned immutable snapshots. Browser callers receive only the
-- versioned TodayWorkspaceV1 envelope and an opaque selector; the authoritative action tuple stays
-- inside this transaction boundary.

do $roles$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'pando_today_reader') then
    execute 'create role pando_today_reader nologin noinherit nobypassrls';
  end if;
  execute pg_catalog.format(
    'grant pando_rls_authorizer, pando_identity_planning_source, pando_today_reader, pando_planning_api, pando_planning_worker, pando_phase2_api, pando_phase2_planning_source to %I with set true',
    current_user
  );
end
$roles$;

grant usage on schema identity, planning, outbox to pando_today_reader;
grant usage on schema planning to pando_phase2_api;
grant usage on schema sessions to pando_planning_api;
grant create on schema sessions to pando_phase2_planning_source;
grant create on schema planning to pando_today_reader, pando_planning_api,
  pando_planning_worker;
grant create on schema api to pando_planning_api, pando_phase2_api;
grant create on schema sessions to pando_phase2_api;

set role pando_rls_authorizer;
grant execute on function identity.is_workspace_member(uuid) to pando_today_reader;
reset role;

-- Forward repair: the original completion path inserted the correct selection_ref and then issued
-- a redundant UPDATE that the immutable-selector trigger correctly rejected. Replacing the
-- function without that no-op makes non-empty snapshots publishable while preserving immutability.
set role pando_planning_worker;
create or replace function planning.complete_plan_snapshot_projection_impl(
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
    and attempt.attempt_state = 'READY' for update;
  if p_result->>'inputFingerprint' is distinct from v_attempt.input_fingerprint
     or p_result->>'engineVersion' <> 'planner-engine/0.1.0'
     or p_result->>'policyVersion' <> 'planning-policy/0.1'
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
  v_bundle := planning.load_plan_snapshot_source_bundle_v1(
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
      and snapshot.engine_version = p_result->>'engineVersion'
      and snapshot.policy_version = p_result->>'policyVersion'
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
reset role;
set role pando_identity_planning_source;
grant execute on function identity.read_planning_calendar_source_v1(uuid, timestamptz)
  to pando_today_reader;
reset role;

grant select on planning.current_plan_snapshots, planning.plan_snapshots,
  planning.plan_action_selections, planning.plan_snapshot_attempts,
  planning.plan_snapshot_delivery_ledger to pando_today_reader;
grant select on outbox.deliveries, outbox.events to pando_today_reader;

create policy current_plan_snapshots_today_reader on planning.current_plan_snapshots
for select to pando_today_reader using (identity.is_workspace_member(workspace_id));
create policy plan_snapshots_today_reader on planning.plan_snapshots
for select to pando_today_reader using (identity.is_workspace_member(workspace_id));
create policy plan_action_selections_today_reader on planning.plan_action_selections
for select to pando_today_reader using (identity.is_workspace_member(workspace_id));
create policy plan_snapshot_attempts_today_reader on planning.plan_snapshot_attempts
for select to pando_today_reader using (identity.is_workspace_member(workspace_id));
create policy plan_snapshot_delivery_ledger_today_reader
on planning.plan_snapshot_delivery_ledger
for select to pando_today_reader using (identity.is_workspace_member(workspace_id));
create policy deliveries_today_reader on outbox.deliveries
for select to pando_today_reader using (
  identity.is_workspace_member(workspace_id)
  and consumer_name = 'planning.plan_snapshot_v1'
  and handler_contract_version = 1
);
create policy events_today_reader on outbox.events
for select to pando_today_reader using (
  identity.is_workspace_member(workspace_id)
  and exists (
    select 1
    from outbox.deliveries as delivery
    where delivery.event_id = events.event_id
      and delivery.workspace_id = events.workspace_id
      and delivery.consumer_name = 'planning.plan_snapshot_v1'
      and delivery.handler_contract_version = 1
  )
);

create index deliveries_today_state_workspace
  on outbox.deliveries (workspace_id, available_at, event_id, delivery_id)
  where consumer_name = 'planning.plan_snapshot_v1'
    and handler_contract_version = 1
    and delivery_state in ('pending', 'retry', 'leased', 'dead_letter');
create index plan_snapshot_attempts_today_state
  on planning.plan_snapshot_attempts (
    workspace_id, base_pointer_version, event_position desc, generation desc
  )
  where attempt_state in ('LOADING', 'READY', 'FAILED');
create index plan_snapshot_delivery_ledger_today_uncovered
  on planning.plan_snapshot_delivery_ledger (workspace_id, delivery_id)
  where coverage_state = 'UNCOVERED';

create function planning.read_today_workspace_v1(
  p_workspace_id uuid,
  p_query_as_of timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_pointer planning.current_plan_snapshots%rowtype;
  v_snapshot planning.plan_snapshots%rowtype;
  v_calendar jsonb;
  v_projection_state text;
  v_reason text;
  v_current_fingerprint text;
  v_latest_active_position bigint;
  v_latest_failure_position bigint;
  v_has_active boolean := false;
  v_has_failure boolean := false;
  v_return_snapshot boolean := false;
  v_action_selections jsonb := '[]'::jsonb;
begin
  if p_workspace_id is null or p_query_as_of is null then
    raise exception using errcode = '22023', message = 'Today query input is invalid';
  end if;
  if not identity.is_workspace_member(p_workspace_id) then
    raise exception using errcode = '42501', message = 'workspace is not accessible';
  end if;

  select pointer.* into v_pointer
  from planning.current_plan_snapshots as pointer
  where pointer.workspace_id = p_workspace_id;

  if not found then
    v_calendar := identity.read_planning_calendar_source_v1(p_workspace_id, p_query_as_of);
    return pg_catalog.jsonb_build_object(
      'contract', pg_catalog.jsonb_build_object('name', 'TodayWorkspaceV1', 'version', '1.0.0'),
      'projectionState', 'NOT_STARTED',
      'reason', 'INITIALIZING',
      'lastKnownSafe', false,
      'calculationClock', pg_catalog.jsonb_build_object(
        'asOf', p_query_as_of,
        'timeZone', v_calendar->>'timeZone',
        'weekStart', v_calendar->'weekStart',
        'weekEnd', v_calendar->'weekEnd'
      ),
      'currentInputFingerprint', null,
      'snapshot', null,
      'actionSelections', '[]'::jsonb,
      'context', pg_catalog.jsonb_build_object('nearestDeadline', null)
    );
  end if;

  if v_pointer.snapshot_id is not null then
    select snapshot.* into strict v_snapshot
    from planning.plan_snapshots as snapshot
    where snapshot.workspace_id = p_workspace_id
      and snapshot.snapshot_id = v_pointer.snapshot_id;
  end if;

  with relevant as materialized (
    select delivery.delivery_id, delivery.delivery_state, event.event_position
    from outbox.deliveries as delivery
    join outbox.events as event
      on event.event_id = delivery.event_id
     and event.workspace_id = delivery.workspace_id
    join planning.plan_snapshot_delivery_ledger as ledger
      on ledger.delivery_id = delivery.delivery_id
     and ledger.workspace_id = delivery.workspace_id
     and ledger.coverage_state = 'UNCOVERED'
    where delivery.workspace_id = p_workspace_id
      and delivery.consumer_name = 'planning.plan_snapshot_v1'
      and delivery.handler_contract_version = 1
      and delivery.delivery_state in ('pending', 'retry', 'leased', 'dead_letter')
      and delivery.available_at <= p_query_as_of
      and (
        event.event_name <> 'planning.snapshot_refresh_scheduled'
        or (
          v_pointer.snapshot_id is not null
          and event.payload->>'source_snapshot_id' = v_pointer.snapshot_id::text
        )
      )
  )
  select
    greatest(
      (select max(relevant.event_position) from relevant
       where relevant.delivery_state in ('pending', 'retry', 'leased')),
      (select max(attempt.event_position)
       from planning.plan_snapshot_attempts as attempt
       join relevant on relevant.delivery_id = attempt.delivery_id
       where attempt.workspace_id = p_workspace_id
         and attempt.base_pointer_version = v_pointer.pointer_version
         and attempt.attempt_state in ('LOADING', 'READY'))
    ),
    (select max(attempt.event_position)
     from planning.plan_snapshot_attempts as attempt
     join relevant on relevant.delivery_id = attempt.delivery_id
     where attempt.workspace_id = p_workspace_id
       and attempt.base_pointer_version = v_pointer.pointer_version
       and attempt.attempt_state = 'FAILED'),
    (
      select attempt.input_fingerprint
      from planning.plan_snapshot_attempts as attempt
      join relevant on relevant.delivery_id = attempt.delivery_id
      where attempt.workspace_id = p_workspace_id
        and attempt.base_pointer_version = v_pointer.pointer_version
        and attempt.attempt_state in ('LOADING', 'READY', 'FAILED')
        and attempt.input_fingerprint is not null
        -- A normalized attempt describes the currently runnable frontier. Historical dead letters
        -- are durable audit facts, but the source loader intentionally never includes them in a
        -- later attempt's coverage set. Requiring them here would erase the recovery fingerprint.
        and not exists (
          select 1 from relevant as uncovered
          where uncovered.delivery_state in ('pending', 'retry', 'leased')
            and not (uncovered.delivery_id = any(attempt.covered_delivery_ids))
        )
      order by attempt.event_position desc, attempt.generation desc
      limit 1
    )
  into v_latest_active_position, v_latest_failure_position, v_current_fingerprint;

  -- At the same event position a due retry is active work and wins. A terminal result wins only
  -- when it is strictly newer than every relevant active delivery/attempt.
  v_has_active := v_latest_active_position is not null
    and (
      v_latest_failure_position is null
      or v_latest_active_position >= v_latest_failure_position
    );
  v_has_failure := v_latest_failure_position is not null
    and (
      v_latest_active_position is null
      or v_latest_failure_position > v_latest_active_position
    );

  if v_has_active then
    v_projection_state := 'PENDING';
    v_reason := 'INPUTS_CHANGED';
  elsif v_has_failure then
    v_projection_state := 'ERROR';
    v_reason := 'CALCULATION_FAILED';
  elsif v_snapshot.snapshot_id is null then
    v_projection_state := 'PENDING';
    v_reason := 'INPUTS_CHANGED';
  elsif v_snapshot.valid_until < p_query_as_of then
    v_projection_state := 'PENDING';
    v_reason := 'SNAPSHOT_EXPIRED';
  else
    v_projection_state := 'CURRENT';
    v_reason := null;
    v_current_fingerprint := v_snapshot.input_fingerprint;
  end if;

  v_return_snapshot := v_snapshot.snapshot_id is not null
    and v_snapshot.valid_until >= p_query_as_of;
  if v_projection_state = 'CURRENT' then
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'selectionRef', selection.selection_ref,
      'rank', selection.rank,
      'candidateKey', selection.candidate_key
    ) order by selection.rank), '[]'::jsonb)
    into v_action_selections
    from planning.plan_action_selections as selection
    where selection.workspace_id = p_workspace_id
      and selection.snapshot_id = v_snapshot.snapshot_id
      and selection.expires_at >= p_query_as_of;
    if pg_catalog.jsonb_array_length(v_action_selections)
         <> pg_catalog.jsonb_array_length(v_snapshot.result->'actions')
       or exists (
         select 1
         from planning.plan_action_selections as selection
         where selection.workspace_id = p_workspace_id
           and selection.snapshot_id = v_snapshot.snapshot_id
           and (
             v_snapshot.result->'actions'->(selection.rank - 1)->>'rank'
               is distinct from selection.rank::text
             or v_snapshot.result->'actions'->(selection.rank - 1)->>'candidateKey'
               is distinct from selection.candidate_key
           )
       ) then
      v_projection_state := 'ERROR';
      v_reason := 'CALCULATION_FAILED';
      v_return_snapshot := false;
      v_action_selections := '[]'::jsonb;
    end if;
  end if;

  if v_return_snapshot then
    v_calendar := pg_catalog.jsonb_build_object(
      'asOf', p_query_as_of,
      'timeZone', v_snapshot.time_zone,
      'weekStart', v_snapshot.week_start,
      'weekEnd', v_snapshot.week_end
    );
  else
    v_calendar := identity.read_planning_calendar_source_v1(p_workspace_id, p_query_as_of)
      || pg_catalog.jsonb_build_object('asOf', p_query_as_of);
  end if;

  return pg_catalog.jsonb_build_object(
    'contract', pg_catalog.jsonb_build_object('name', 'TodayWorkspaceV1', 'version', '1.0.0'),
    'projectionState', v_projection_state,
    'reason', v_reason,
    'lastKnownSafe', v_return_snapshot,
    'calculationClock', pg_catalog.jsonb_build_object(
      'asOf', v_calendar->'asOf',
      'timeZone', v_calendar->>'timeZone',
      'weekStart', v_calendar->'weekStart',
      'weekEnd', v_calendar->'weekEnd'
    ),
    'currentInputFingerprint', v_current_fingerprint,
    'snapshot', case when v_return_snapshot then pg_catalog.jsonb_build_object(
      'snapshotId', v_snapshot.snapshot_id,
      'inputFingerprint', v_snapshot.input_fingerprint,
      'calculatedAsOf', v_snapshot.calculated_as_of,
      'validUntil', v_snapshot.valid_until,
      'plan', v_snapshot.result
    ) else null end,
    'actionSelections', v_action_selections,
    'context', pg_catalog.jsonb_build_object(
      'nearestDeadline', case when v_return_snapshot
        then v_snapshot.result->'nearestDeadline' else null end
    )
  );
end
$function$;

alter function planning.read_today_workspace_v1(uuid, timestamptz)
  owner to pando_today_reader;
revoke all on function planning.read_today_workspace_v1(uuid, timestamptz)
  from public, anon, authenticated, service_role;
set role pando_today_reader;
grant execute on function planning.read_today_workspace_v1(uuid, timestamptz)
  to pando_planning_api;
reset role;

create function api.get_today_workspace_v1()
returns jsonb
language plpgsql
stable
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
    raise exception using errcode = '42501', message = 'workspace is not accessible';
  end if;
  return planning.read_today_workspace_v1(
    v_workspace_id,
    pg_catalog.statement_timestamp()
  );
end
$function$;

alter function api.get_today_workspace_v1() owner to pando_planning_api;
revoke all on function api.get_today_workspace_v1()
  from public, anon, authenticated, service_role;
grant execute on function api.get_today_workspace_v1() to authenticated;

-- The Planning role needs UPDATE privilege only to acquire row locks. The immutable trigger still
-- rejects every attempted mutation, and the policy's WITH CHECK rejects every new row image.
grant update on planning.plan_action_selections to pando_planning_api;
create policy plan_action_selections_planning_lock on planning.plan_action_selections
for update to pando_planning_api
using (identity.is_workspace_member(workspace_id))
with check (false);

set role pando_phase2_planning_source;
create function sessions.is_exact_active_focus_for_planning_v1(
  p_workspace_id uuid,
  p_focus_session_id uuid,
  p_readiness_goal_key text,
  p_activity_key text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from sessions.focus_sessions as session
    where session.workspace_id = p_workspace_id
      and session.focus_session_id = p_focus_session_id
      and session.state = 'active'
      and session.readiness_goal_key = p_readiness_goal_key
      and session.activity_key = p_activity_key
  )
$function$;
reset role;
revoke all on function sessions.is_exact_active_focus_for_planning_v1(uuid, uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function sessions.is_exact_active_focus_for_planning_v1(uuid, uuid, text, text)
  to pando_planning_api;

create function planning.resolve_today_action_v1(p_selection_ref text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_workspace_id uuid;
  v_as_of timestamptz;
  v_pointer planning.current_plan_snapshots%rowtype;
  v_snapshot planning.plan_snapshots%rowtype;
  v_selection planning.plan_action_selections%rowtype;
  v_today jsonb;
  v_action jsonb;
begin
  if identity.jwt_subject() is null then
    raise exception using errcode = '28000', message = 'an authenticated user is required';
  end if;
  if p_selection_ref is null
     or p_selection_ref !~ '^plan-action:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception using errcode = '22023', message = 'plan action selection is unavailable';
  end if;
  v_workspace_id := identity.personal_workspace_id_for_current_user();
  if v_workspace_id is null then
    raise exception using errcode = '42501', message = 'plan action selection is unavailable';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('planning-workspace:' || v_workspace_id::text, 0)
  );
  select pointer.* into v_pointer
  from planning.current_plan_snapshots as pointer
  where pointer.workspace_id = v_workspace_id
  for update;
  if not found or v_pointer.snapshot_id is null then
    raise exception using errcode = '42501', message = 'plan action selection is unavailable';
  end if;
  select selection.* into v_selection
  from planning.plan_action_selections as selection
  where selection.workspace_id = v_workspace_id
    and selection.selection_ref = p_selection_ref
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'plan action selection is unavailable';
  end if;

  -- Locks can wait across a validity boundary. Sample only after both authoritative rows are
  -- locked so a queued request cannot authorize using its stale statement-start timestamp.
  v_as_of := clock_timestamp();
  v_today := planning.read_today_workspace_v1(v_workspace_id, v_as_of);
  if v_today->>'projectionState' <> 'CURRENT'
     or v_today#>>'{snapshot,snapshotId}' is distinct from v_pointer.snapshot_id::text
     or v_selection.snapshot_id is distinct from v_pointer.snapshot_id
     or v_selection.attempt_id is distinct from v_pointer.applied_attempt_id then
    raise exception using errcode = '40001', message = 'plan action selection is not current';
  end if;
  select snapshot.* into strict v_snapshot
  from planning.plan_snapshots as snapshot
  where snapshot.workspace_id = v_workspace_id
    and snapshot.snapshot_id = v_pointer.snapshot_id;
  if v_as_of > v_selection.expires_at or v_as_of > v_snapshot.valid_until then
    raise exception using errcode = '40001', message = 'plan action selection is not current';
  end if;

  v_action := v_snapshot.result->'actions'->(v_selection.rank - 1);
  if v_action is null
     or (v_action->>'rank')::smallint is distinct from v_selection.rank
     or v_action->>'candidateKey' is distinct from v_selection.candidate_key
     or v_action->>'actionKind' is distinct from v_selection.action_kind
     or v_action->>'readinessGoalKey' is distinct from v_selection.readiness_goal_key
     or v_action->>'activityKey' is distinct from v_selection.activity_key
     or nullif(v_action->>'trackId', '')::uuid is distinct from v_selection.learning_track_id
     or nullif(v_action->>'focusSessionId', '')::uuid is distinct from v_selection.focus_session_id
     or (v_action->>'durationMinutes')::smallint is distinct from v_selection.planned_minutes then
    raise exception using errcode = '40001', message = 'plan action selection is not current';
  end if;

  if v_selection.action_kind = 'RESUME' then
    if sessions.is_exact_active_focus_for_planning_v1(
      v_workspace_id,
      v_selection.focus_session_id,
      v_selection.readiness_goal_key,
      v_selection.activity_key
    ) is not true then
      raise exception using errcode = '40001', message = 'plan action selection is not current';
    end if;
  end if;

  return pg_catalog.jsonb_build_object(
    'selectionRef', v_selection.selection_ref,
    'actionKind', v_selection.action_kind,
    'readinessGoalKey', v_selection.readiness_goal_key,
    'activityKey', v_selection.activity_key,
    'plannedMinutes', v_selection.planned_minutes,
    'learningTrackId', v_selection.learning_track_id,
    'planSnapshotId', v_selection.snapshot_id,
    'candidateKey', v_selection.candidate_key,
    'focusSessionId', v_selection.focus_session_id
  );
end
$function$;

alter function planning.resolve_today_action_v1(text) owner to pando_planning_api;
revoke all on function planning.resolve_today_action_v1(text)
  from public, anon, authenticated, service_role;
grant execute on function planning.resolve_today_action_v1(text) to pando_phase2_api;

alter table sessions.focus_sessions
  add column plan_snapshot_id uuid,
  add column plan_candidate_key text,
  add column plan_learning_track_id uuid,
  add constraint focus_sessions_plan_snapshot_fk
    foreign key (workspace_id, plan_snapshot_id)
    references planning.plan_snapshots (workspace_id, snapshot_id) on delete restrict,
  add constraint focus_sessions_plan_track_fk
    foreign key (workspace_id, plan_learning_track_id)
    references planning.learning_tracks (workspace_id, learning_track_id) on delete restrict,
  add constraint focus_sessions_plan_candidate_check check (
    plan_candidate_key is null
    or plan_candidate_key ~ '^candidate:[a-z0-9][a-z0-9-]{1,100}$'
  ),
  add constraint focus_sessions_plan_attribution_shape check (
    (plan_snapshot_id is null and plan_candidate_key is null and plan_learning_track_id is null)
    or (plan_snapshot_id is not null and plan_candidate_key is not null)
  );

create function sessions.start_focus_session_from_plan_impl(
  p_focus_session_id uuid,
  p_workspace_id uuid,
  p_user_id uuid,
  p_readiness_goal_key text,
  p_activity "overlay".custom_activities,
  p_planned_minutes smallint,
  p_plan_snapshot_id uuid,
  p_plan_candidate_key text,
  p_plan_learning_track_id uuid,
  p_started_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if p_plan_snapshot_id is null or p_plan_candidate_key is null then
    raise exception using errcode = '22023', message = 'plan attribution is invalid';
  end if;
  perform sessions.start_focus_session_impl(
    p_focus_session_id, p_workspace_id, p_user_id, p_readiness_goal_key,
    p_activity, p_planned_minutes, p_started_at
  );
  update sessions.focus_sessions
  set plan_snapshot_id = p_plan_snapshot_id,
      plan_candidate_key = p_plan_candidate_key,
      plan_learning_track_id = p_plan_learning_track_id
  where workspace_id = p_workspace_id
    and focus_session_id = p_focus_session_id;
end
$function$;

alter function sessions.start_focus_session_from_plan_impl(
  uuid, uuid, uuid, text, "overlay".custom_activities, smallint, uuid, text, uuid, timestamptz
) owner to pando_phase2_api;
revoke all on function sessions.start_focus_session_from_plan_impl(
  uuid, uuid, uuid, text, "overlay".custom_activities, smallint, uuid, text, uuid, timestamptz
) from public, anon, authenticated, service_role;

create function api.start_focus_from_plan_v1(
  p_selection_ref text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_resolved jsonb;
  v_context jsonb;
  v_activity overlay.custom_activities%rowtype;
  v_workspace_id uuid;
  v_actor_user_id uuid;
  v_session_id uuid := gen_random_uuid();
  v_attempt_id uuid := gen_random_uuid();
  v_command_id uuid := gen_random_uuid();
  v_event_id uuid := gen_random_uuid();
  v_correlation_id uuid := gen_random_uuid();
  v_now timestamptz;
  v_request_hash bytea;
  v_receipt outbox.command_receipts%rowtype;
  v_response jsonb;
begin
  if identity.jwt_subject() is null then
    raise exception using errcode = '28000', message = 'an authenticated user is required';
  end if;
  if p_selection_ref is null
     or p_selection_ref !~ '^plan-action:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or p_idempotency_key is null
     or p_idempotency_key <> btrim(p_idempotency_key)
     or char_length(p_idempotency_key) not between 1 and 128 then
    raise exception using errcode = '22023', message = 'Focus from plan input is invalid';
  end if;
  v_workspace_id := identity.personal_workspace_id_for_current_user();
  v_actor_user_id := identity.current_user_id();
  if v_workspace_id is null or v_actor_user_id is null then
    raise exception using errcode = '42501', message = 'workspace is not accessible';
  end if;

  v_request_hash := extensions.digest(pg_catalog.convert_to(pg_catalog.jsonb_build_object(
    'commandType', 'focus.start_from_plan',
    'schemaVersion', 1,
    'workspaceId', v_workspace_id,
    'selectionRef', p_selection_ref
  )::text, 'UTF8'), 'sha256');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    v_actor_user_id::text || ':focus.start_from_plan:' || p_idempotency_key, 0
  ));
  select receipt.* into v_receipt
  from outbox.command_receipts as receipt
  where receipt.actor_user_id = v_actor_user_id
    and receipt.command_type = 'focus.start_from_plan'
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

  v_resolved := planning.resolve_today_action_v1(p_selection_ref);
  if v_resolved->>'actionKind' <> 'START' then
    raise exception using errcode = '22023', message = 'plan action cannot start a new Focus session';
  end if;
  v_context := targets.get_explore_target_requirements_impl(
    v_workspace_id, v_resolved->>'readinessGoalKey'
  );
  select activity.* into v_activity
  from overlay.custom_activities as activity
  where activity.workspace_id = v_workspace_id
    and activity.profile_version_id = (v_context->'targetProfile'->>'profileVersionId')::uuid
    and activity.activity_key = v_resolved->>'activityKey'
    and activity.lifecycle = 'active'
    and activity.mapping_status = 'accepted';
  if not found then
    raise exception using errcode = '40001', message = 'plan action selection is not current';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_workspace_id::text, 2));
  -- Use the mutation clock, not a timestamp captured before idempotency, Planning, or Sessions
  -- lock waits.
  v_now := clock_timestamp();
  insert into outbox.command_receipts (
    command_id, command_type, command_schema_version, workspace_id, actor_user_id,
    idempotency_key, request_hash, correlation_id, expected_aggregate_version
  ) values (
    v_command_id, 'focus.start_from_plan', 1, v_workspace_id, v_actor_user_id,
    p_idempotency_key, v_request_hash, v_correlation_id, 0
  );
  perform sessions.start_focus_session_from_plan_impl(
    v_session_id, v_workspace_id, v_actor_user_id,
    v_resolved->>'readinessGoalKey', v_activity,
    (v_resolved->>'plannedMinutes')::smallint,
    (v_resolved->>'planSnapshotId')::uuid,
    v_resolved->>'candidateKey',
    nullif(v_resolved->>'learningTrackId', '')::uuid,
    v_now
  );
  perform evidence.start_activity_attempt_impl(
    v_attempt_id, v_session_id, v_workspace_id, v_actor_user_id, v_activity, v_now
  );
  insert into outbox.events (
    event_id, event_name, event_schema_version, workspace_id, aggregate_type, aggregate_id,
    aggregate_version, actor_type, actor_user_id, command_id, correlation_id, occurred_at,
    source, payload
  ) values (
    v_event_id, 'sessions.focus_started', 1, v_workspace_id, 'sessions.focus_session',
    v_session_id, 1, 'user', v_actor_user_id, v_command_id, v_correlation_id, v_now,
    'pando.database', pg_catalog.jsonb_build_object(
      'focus_session_id', v_session_id,
      'activity_attempt_id', v_attempt_id,
      'activity_key', v_activity.activity_key,
      'readiness_goal_key', v_resolved->>'readinessGoalKey'
    )
  );
  perform outbox.enqueue_plan_snapshot_source_delivery_v1(v_event_id);
  v_response := pg_catalog.jsonb_build_object(
    'commandId', v_command_id,
    'focusSessionId', v_session_id,
    'activityAttemptId', v_attempt_id,
    'sessionVersion', '1',
    'state', 'active',
    'startedAt', v_now,
    'planAttribution', pg_catalog.jsonb_build_object(
      'planSnapshotId', v_resolved->>'planSnapshotId',
      'candidateKey', v_resolved->>'candidateKey',
      'trackId', v_resolved->'learningTrackId'
    ),
    'emittedEventIds', pg_catalog.jsonb_build_array(v_event_id)
  );
  update outbox.command_receipts
  set command_status = 'completed',
      response = v_response,
      emitted_event_ids = array[v_event_id],
      completed_at = clock_timestamp()
  where command_id = v_command_id;
  return v_response;
end
$function$;

alter function api.start_focus_from_plan_v1(text, text) owner to pando_phase2_api;
revoke all on function api.start_focus_from_plan_v1(text, text)
  from public, anon, authenticated, service_role;
grant execute on function api.start_focus_from_plan_v1(text, text) to authenticated;

-- Planning receives active Focus attribution through the existing Sessions-owned source only.
set role pando_phase2_planning_source;
create or replace function sessions.read_planning_focus_source_v1(
  p_workspace_id uuid,
  p_week_start timestamptz,
  p_week_end timestamptz,
  p_as_of timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_active jsonb;
  v_terminal_count integer;
  v_revision text;
begin
  if p_workspace_id is null or p_week_start is null or p_week_end is null or p_as_of is null
     or p_week_start >= p_week_end or p_as_of < p_week_start or p_as_of >= p_week_end then
    raise exception using errcode = '22023', message = 'planning Focus source input is invalid';
  end if;
  select case when session.focus_session_id is null then null else pg_catalog.jsonb_build_object(
    'focusSessionId', session.focus_session_id,
    'readinessGoalKey', session.readiness_goal_key,
    'activityKey', session.activity_key,
    'title', session.activity_title,
    'plannedMinutes', session.planned_minutes,
    'startedAt', session.started_at,
    'planAttribution', case when session.plan_snapshot_id is null then null
      else pg_catalog.jsonb_build_object(
        'planSnapshotId', session.plan_snapshot_id,
        'candidateKey', session.plan_candidate_key,
        'trackId', session.plan_learning_track_id
      ) end
  ) end into v_active
  from (select null) as singleton
  left join sessions.focus_sessions as session
    on session.workspace_id = p_workspace_id and session.state = 'active';
  select count(*) into v_terminal_count
  from sessions.focus_sessions as session
  where session.workspace_id = p_workspace_id
    and session.state in ('completed', 'stopped')
    and session.ended_at >= p_week_start
    and session.ended_at < p_week_end;
  select pg_catalog.encode(extensions.digest(pg_catalog.convert_to(coalesce(
    pg_catalog.jsonb_agg(
      case when session.plan_snapshot_id is null then
        -- Preserve the pre-C6 revision byte-for-byte for legacy/unattributed rows. Attributed
        -- sessions are new C6 writes and already emit an immediate Planning delivery.
        pg_catalog.jsonb_build_array(
          session.focus_session_id, session.aggregate_version, session.state,
          session.started_at, session.ended_at
        )
      else
        pg_catalog.jsonb_build_array(
          session.focus_session_id, session.aggregate_version, session.state,
          session.started_at, session.ended_at, session.plan_snapshot_id,
          session.plan_candidate_key, session.plan_learning_track_id
        )
      end
      order by session.focus_session_id
    )::text, '[]'), 'UTF8'), 'sha256'), 'hex')
  into v_revision
  from sessions.focus_sessions as session
  where session.workspace_id = p_workspace_id
    and (
      session.state = 'active'
      or (session.ended_at >= p_week_start and session.ended_at < p_week_end)
    );
  return pg_catalog.jsonb_build_object(
    'revision', 'focus-scope:' || v_revision,
    'terminalCount', v_terminal_count,
    'activeFocus', v_active
  );
end
$function$;
reset role;

revoke create on schema sessions from pando_phase2_planning_source;
revoke create on schema planning from pando_today_reader, pando_planning_api,
  pando_planning_worker;
revoke create on schema api from pando_planning_api, pando_phase2_api;
revoke create on schema sessions from pando_phase2_api;
do $roles$
begin
  execute pg_catalog.format(
    'revoke pando_rls_authorizer, pando_identity_planning_source, pando_today_reader, pando_planning_api, pando_planning_worker, pando_phase2_api, pando_phase2_planning_source from %I',
    current_user
  );
end
$roles$;
