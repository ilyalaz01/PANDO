-- Phase 4B D2c activate-only rollout for planning-calculation/2.
-- Historical V1 attempts and snapshots remain immutable and executable.

do $migration_role_membership$
begin
  execute pg_catalog.format(
    'grant pando_planning_worker, pando_planning_api to %I with set true',
    current_user
  );
end
$migration_role_membership$;

grant create on schema planning, outbox to pando_planning_worker;
set role pando_planning_worker;

create function planning.plan_snapshot_v2_activation_event_is_valid_v1(
  p_event outbox.events
)
returns boolean
language sql
stable
set search_path = ''
as $function$
  select coalesce(
    (p_event).event_name = 'planning.snapshot_calculation_v2_activation_requested'
    and (p_event).event_schema_version = 1
    and (p_event).actor_type = 'system'
    and (p_event).actor_user_id is null
    and (p_event).source = 'pando.planning_worker'
    and (p_event).aggregate_type = 'planning.plan_snapshot'
    and (p_event).aggregate_id is not null
    and (p_event).aggregate_version is not null
    and (p_event).command_id is not null
    and (p_event).correlation_id is not null
    and (p_event).causation_id is not null
    and planning.jsonb_has_exact_keys_v1(
      (p_event).payload,
      array[
        'workspace_id', 'source_snapshot_id', 'source_attempt_id',
        'source_pointer_version', 'target_calculation_contract_version'
      ]
    )
    and (p_event).payload->>'workspace_id' = (p_event).workspace_id::text
    and (p_event).payload->>'source_snapshot_id' = (p_event).aggregate_id::text
    and (p_event).payload->>'source_pointer_version' = (p_event).aggregate_version::text
    and ((p_event).payload->>'source_attempt_id') ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and ((p_event).payload->>'source_pointer_version') ~ '^[1-9][0-9]{0,18}$'
    and (p_event).payload->>'target_calculation_contract_version'
      = 'planning-calculation/2'
    and exists (
      select 1
      from planning.plan_snapshot_attempts as source_attempt
      join planning.plan_snapshots as source_snapshot
        on source_snapshot.workspace_id = source_attempt.workspace_id
       and source_snapshot.snapshot_id = (p_event).aggregate_id
      where source_attempt.workspace_id = (p_event).workspace_id
        and source_attempt.attempt_id::text = (p_event).payload->>'source_attempt_id'
        and source_attempt.attempt_state = 'APPLIED'
        and source_attempt.applied_pointer_version::text
          = (p_event).payload->>'source_pointer_version'
        and source_attempt.event_id = (p_event).causation_id
        and source_attempt.calculation_contract_version = 'planning-calculation/1'
        and source_attempt.normalized_input->>'completedWorkPolicyVersion'
          = 'planning-completed-work/0.1'
        and source_snapshot.engine_version = 'planner-engine/0.1.0'
        and source_snapshot.policy_version = 'planning-policy/0.1'
        and source_snapshot.input_fingerprint = source_attempt.input_fingerprint
        and source_snapshot.result->>'inputFingerprint' = source_attempt.input_fingerprint
    ),
    false
  )
$function$;

create function planning.enqueue_plan_snapshot_v2_activation_v1(
  p_workspace_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_pointer planning.current_plan_snapshots%rowtype;
  v_attempt planning.plan_snapshot_attempts%rowtype;
  v_snapshot planning.plan_snapshots%rowtype;
  v_source_event outbox.events%rowtype;
  v_event_id uuid;
  v_delivery_id uuid;
  v_available_at timestamptz;
begin
  if p_workspace_id is null then
    raise exception using errcode = '22023', message = 'Planning V2 activation workspace is required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('planning-workspace:' || p_workspace_id::text, 0)
  );
  select pointer.* into v_pointer
  from planning.current_plan_snapshots as pointer
  where pointer.workspace_id = p_workspace_id
  for update;
  if not found or v_pointer.snapshot_id is null or v_pointer.applied_attempt_id is null then
    return null;
  end if;

  select attempt.* into v_attempt
  from planning.plan_snapshot_attempts as attempt
  join planning.plan_snapshots as snapshot
    on snapshot.workspace_id = attempt.workspace_id
   and snapshot.snapshot_id = v_pointer.snapshot_id
  where attempt.workspace_id = p_workspace_id
    and attempt.attempt_id = v_pointer.applied_attempt_id
    and attempt.attempt_state = 'APPLIED'
    and attempt.applied_pointer_version = v_pointer.pointer_version
    and attempt.calculation_contract_version = 'planning-calculation/1'
    and attempt.normalized_input->>'completedWorkPolicyVersion'
      = 'planning-completed-work/0.1'
    and snapshot.engine_version = 'planner-engine/0.1.0'
    and snapshot.policy_version = 'planning-policy/0.1'
    and snapshot.input_fingerprint = attempt.input_fingerprint
    and snapshot.result->>'inputFingerprint' = attempt.input_fingerprint;
  if not found then
    return null;
  end if;

  select snapshot.* into strict v_snapshot
  from planning.plan_snapshots as snapshot
  where snapshot.workspace_id = p_workspace_id
    and snapshot.snapshot_id = v_pointer.snapshot_id;

  select event.* into strict v_source_event
  from outbox.events as event
  where event.event_id = v_attempt.event_id
    and event.workspace_id = p_workspace_id;

  v_event_id := planning.stable_plan_uuid_v1(
    p_workspace_id::text || '|planning.snapshot_calculation_v2_activation_requested|' ||
    v_pointer.snapshot_id::text || '|' || v_pointer.applied_attempt_id::text || '|' ||
    v_pointer.pointer_version::text || '|planning-calculation/2'
  );
  v_delivery_id := planning.stable_plan_uuid_v1(
    v_event_id::text || '|planning.plan_snapshot_v1|1'
  );

  select greatest(
    clock_timestamp(),
    v_snapshot.valid_until + interval '0.5 milliseconds',
    coalesce(max(case
      when delivery.delivery_state = 'leased' then greatest(
        delivery.available_at, coalesce(delivery.lease_expires_at, delivery.available_at)
      )
      else delivery.available_at
    end), clock_timestamp())
  )
  into v_available_at
  from planning.plan_snapshot_attempts as active_attempt
  join outbox.deliveries as delivery
    on delivery.delivery_id = active_attempt.delivery_id
   and delivery.workspace_id = active_attempt.workspace_id
  where active_attempt.workspace_id = p_workspace_id
    and active_attempt.calculation_contract_version = 'planning-calculation/1'
    and active_attempt.attempt_state in ('LOADING', 'READY')
    and delivery.delivery_state in ('pending', 'retry', 'leased');

  insert into outbox.events (
    event_id, event_name, event_schema_version, workspace_id, aggregate_type,
    aggregate_id, aggregate_version, actor_type, actor_user_id, command_id,
    correlation_id, causation_id, occurred_at, source, payload
  ) values (
    v_event_id, 'planning.snapshot_calculation_v2_activation_requested', 1,
    p_workspace_id, 'planning.plan_snapshot', v_pointer.snapshot_id,
    v_pointer.pointer_version, 'system', null, v_source_event.command_id,
    v_source_event.correlation_id, v_source_event.event_id, clock_timestamp(),
    'pando.planning_worker', pg_catalog.jsonb_build_object(
      'workspace_id', p_workspace_id,
      'source_snapshot_id', v_pointer.snapshot_id,
      'source_attempt_id', v_pointer.applied_attempt_id,
      'source_pointer_version', v_pointer.pointer_version::text,
      'target_calculation_contract_version', 'planning-calculation/2'
    )
  ) on conflict (event_id) do nothing;

  insert into outbox.deliveries (
    delivery_id, event_id, workspace_id, consumer_name,
    handler_contract_version, available_at
  ) values (
    v_delivery_id, v_event_id, p_workspace_id,
    'planning.plan_snapshot_v1', 1, v_available_at
  ) on conflict (event_id, consumer_name, handler_contract_version) do nothing;

  return v_event_id;
end
$function$;

create or replace function outbox.claim_plan_snapshot_projection_impl()
returns table (
  delivery_id uuid, event_id uuid, event_position bigint, workspace_id uuid,
  lease_token uuid, lease_expires_at timestamptz, attempt_count smallint,
  attempt_id uuid, generation smallint, claim_as_of timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_claim outbox.deliveries%rowtype;
  v_event outbox.events%rowtype;
  v_attempt planning.plan_snapshot_attempts%rowtype;
  v_generation smallint;
  v_pointer_version bigint;
  v_claim_clock timestamptz;
begin
  with exhausted as (
    update outbox.deliveries as delivery
    set delivery_state = 'dead_letter', lease_token = null, lease_expires_at = null,
        last_failure_class = 'EXHAUSTED', last_error_code = 'LEASE_EXPIRED_AFTER_MAX_ATTEMPTS',
        last_failed_at = clock_timestamp(), dead_lettered_at = clock_timestamp()
    where delivery.consumer_name = 'planning.plan_snapshot_v1'
      and delivery.handler_contract_version = 1 and delivery.delivery_state = 'leased'
      and delivery.lease_expires_at <= clock_timestamp() and delivery.attempt_count >= 8
    returning delivery.delivery_id
  )
  update planning.plan_snapshot_attempts as attempt
  set attempt_state = 'FAILED', failure_class = 'EXHAUSTED',
      error_code = 'LEASE_EXPIRED_AFTER_MAX_ATTEMPTS', updated_at = clock_timestamp()
  from exhausted
  where attempt.delivery_id = exhausted.delivery_id
    and attempt.attempt_state in ('LOADING', 'READY');

  for v_claim in
    with due as (
      select delivery.delivery_id,
        pg_catalog.row_number() over (partition by delivery.workspace_id order by
          delivery.available_at, event.event_position, delivery.delivery_id) as workspace_rank
      from outbox.deliveries as delivery
      join outbox.events as event on event.event_id = delivery.event_id
        and event.workspace_id = delivery.workspace_id
      join planning.plan_snapshot_delivery_ledger as ledger
        on ledger.delivery_id = delivery.delivery_id and ledger.coverage_state = 'UNCOVERED'
      where delivery.consumer_name = 'planning.plan_snapshot_v1'
        and delivery.handler_contract_version = 1 and delivery.attempt_count < 8
        and delivery.available_at <= clock_timestamp()
        and (delivery.delivery_state in ('pending', 'retry') or
          (delivery.delivery_state = 'leased' and delivery.lease_expires_at <= clock_timestamp()))
        and not exists (
          select 1 from outbox.deliveries as active_delivery
          where active_delivery.workspace_id = delivery.workspace_id
            and active_delivery.consumer_name = 'planning.plan_snapshot_v1'
            and active_delivery.handler_contract_version = 1
            and active_delivery.delivery_state = 'leased'
            and active_delivery.lease_expires_at > clock_timestamp()
        )
    ), candidates as (
      select delivery.delivery_id from outbox.deliveries as delivery
      join due on due.delivery_id = delivery.delivery_id and due.workspace_rank = 1
      join outbox.events as event on event.event_id = delivery.event_id
      order by delivery.available_at, event.event_position, delivery.delivery_id
      for update of delivery skip locked limit 5
    )
    update outbox.deliveries as delivery
    set delivery_state = 'leased', attempt_count = delivery.attempt_count + 1,
      lease_token = gen_random_uuid(), lease_expires_at = clock_timestamp() + interval '2 minutes',
      last_failure_class = null, last_error_code = null, last_failed_at = null
    from candidates where delivery.delivery_id = candidates.delivery_id
    returning delivery.*
  loop
    v_claim_clock := clock_timestamp();
    select event.* into strict v_event from outbox.events as event
    where event.event_id = v_claim.event_id and event.workspace_id = v_claim.workspace_id;
    select attempt.* into v_attempt from planning.plan_snapshot_attempts as attempt
    where attempt.delivery_id = v_claim.delivery_id
      and attempt.attempt_state in ('LOADING', 'READY')
    order by attempt.generation desc limit 1 for update;
    if found and (v_attempt.attempt_state = 'LOADING' or v_attempt.valid_until < v_claim_clock) then
      update planning.plan_snapshot_attempts as superseded set attempt_state = 'SUPERSEDED',
        updated_at = clock_timestamp() where superseded.attempt_id = v_attempt.attempt_id;
      v_attempt.attempt_id := null;
    end if;
    if v_attempt.attempt_id is null then
      select coalesce(max(attempt.generation), 0) + 1 into v_generation
      from planning.plan_snapshot_attempts as attempt where attempt.delivery_id = v_claim.delivery_id;
      select pointer.pointer_version into strict v_pointer_version
      from planning.current_plan_snapshots as pointer
      where pointer.workspace_id = v_claim.workspace_id;
      insert into planning.plan_snapshot_attempts (
        workspace_id, delivery_id, event_id, event_position, generation, claim_as_of,
        base_pointer_version, scheduled_source_snapshot_id, calculation_contract_version
      ) values (
        v_claim.workspace_id, v_claim.delivery_id, v_claim.event_id, v_event.event_position,
        v_generation, v_claim_clock, v_pointer_version,
        case when v_event.event_name in (
          'planning.snapshot_refresh_scheduled',
          'planning.snapshot_calculation_v2_activation_requested'
        ) then (v_event.payload->>'source_snapshot_id')::uuid end,
        -- This migration is the durable activation marker. Every attempt created after it uses V2;
        -- an already-active V1 attempt above is reused and completes through its immutable V1 path.
        'planning-calculation/2'
      ) returning * into v_attempt;
    end if;
    delivery_id := v_claim.delivery_id; event_id := v_claim.event_id;
    event_position := v_event.event_position; workspace_id := v_claim.workspace_id;
    lease_token := v_claim.lease_token; lease_expires_at := v_claim.lease_expires_at;
    attempt_count := v_claim.attempt_count; attempt_id := v_attempt.attempt_id;
    generation := v_attempt.generation; claim_as_of := v_attempt.claim_as_of;
    return next;
  end loop;
end
$function$;

create or replace function planning.load_plan_snapshot_projection_v2_impl(
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
  if planning.plan_snapshot_event_is_valid_v1(v_event) is not true
     and planning.plan_snapshot_v2_activation_event_is_valid_v1(v_event) is not true then
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
      case when v_event.event_name in (
        'planning.snapshot_refresh_scheduled',
        'planning.snapshot_calculation_v2_activation_requested'
      ) then (v_event.payload->>'source_snapshot_id')::uuid end,
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

create or replace function planning.complete_plan_snapshot_projection_impl(
  p_delivery_id uuid, p_lease_token uuid, p_attempt_id uuid, p_result jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_workspace_id uuid;
  v_contract text;
  v_completed_work_policy text;
  v_result text;
begin
  select attempt.workspace_id, attempt.calculation_contract_version,
    attempt.normalized_input->>'completedWorkPolicyVersion'
  into strict v_workspace_id, v_contract, v_completed_work_policy
  from planning.plan_snapshot_attempts as attempt
  where attempt.attempt_id = p_attempt_id and attempt.delivery_id = p_delivery_id;

  if v_contract = 'planning-calculation/1'
     and v_completed_work_policy = 'planning-completed-work/0.1' then
    v_result := planning.complete_plan_snapshot_projection_v1_impl(
      p_delivery_id, p_lease_token, p_attempt_id, p_result
    );
    if v_result in ('APPLIED', 'COVERED', 'SUPERSEDED') then
      perform planning.enqueue_plan_snapshot_v2_activation_v1(v_workspace_id);
    end if;
    return v_result;
  elsif v_contract = 'planning-calculation/2'
     and v_completed_work_policy = 'planning-completed-work/0.2' then
    return planning.complete_plan_snapshot_projection_v2_impl(
      p_delivery_id, p_lease_token, p_attempt_id, p_result
    );
  end if;
  raise exception using errcode = '22023', message = 'planning calculation tuple is invalid';
end
$function$;

-- Fail the migration atomically instead of activating around a malformed current pointer.
do $preflight$
begin
  if exists (
    select 1
    from planning.current_plan_snapshots as pointer
    left join planning.plan_snapshot_attempts as attempt
      on attempt.workspace_id = pointer.workspace_id
     and attempt.attempt_id = pointer.applied_attempt_id
    left join planning.plan_snapshots as snapshot
      on snapshot.workspace_id = pointer.workspace_id
     and snapshot.snapshot_id = pointer.snapshot_id
    where (pointer.snapshot_id is null) <> (pointer.applied_attempt_id is null)
       or (
         pointer.snapshot_id is not null
         and not coalesce(
           attempt.attempt_state = 'APPLIED'
           and attempt.applied_pointer_version = pointer.pointer_version
           and snapshot.input_fingerprint = attempt.input_fingerprint
           and snapshot.result->>'inputFingerprint' = attempt.input_fingerprint
           and (
             (
               attempt.calculation_contract_version = 'planning-calculation/1'
               and attempt.normalized_input->>'completedWorkPolicyVersion'
                 = 'planning-completed-work/0.1'
               and snapshot.engine_version = 'planner-engine/0.1.0'
               and snapshot.policy_version = 'planning-policy/0.1'
             )
             or
             (
               attempt.calculation_contract_version = 'planning-calculation/2'
               and attempt.normalized_input->>'completedWorkPolicyVersion'
                 = 'planning-completed-work/0.2'
               and snapshot.engine_version = 'planner-engine/0.2.0'
               and snapshot.policy_version = 'planning-policy/0.2'
             )
           ),
           false
         )
       )
  ) then
    raise exception using errcode = '55000',
      message = 'Planning V2 activation preflight found an invalid current pointer tuple';
  end if;
end
$preflight$;

-- Calling the helper holds each exact V1 workspace lock until this migration commits.
select planning.enqueue_plan_snapshot_v2_activation_v1(pointer.workspace_id)
from planning.current_plan_snapshots as pointer
where pointer.snapshot_id is not null
order by pointer.workspace_id;

do $postflight$
begin
  if exists (
    select 1
    from planning.current_plan_snapshots as pointer
    join planning.plan_snapshot_attempts as attempt
      on attempt.workspace_id = pointer.workspace_id
     and attempt.attempt_id = pointer.applied_attempt_id
    join planning.plan_snapshots as snapshot
      on snapshot.workspace_id = pointer.workspace_id
     and snapshot.snapshot_id = pointer.snapshot_id
    where attempt.attempt_state = 'APPLIED'
      and attempt.applied_pointer_version = pointer.pointer_version
      and attempt.calculation_contract_version = 'planning-calculation/1'
      and attempt.normalized_input->>'completedWorkPolicyVersion'
        = 'planning-completed-work/0.1'
      and snapshot.engine_version = 'planner-engine/0.1.0'
      and snapshot.policy_version = 'planning-policy/0.1'
      and snapshot.input_fingerprint = attempt.input_fingerprint
      and snapshot.result->>'inputFingerprint' = attempt.input_fingerprint
      and not exists (
        select 1
        from outbox.events as event
        join outbox.deliveries as delivery
          on delivery.event_id = event.event_id
         and delivery.workspace_id = event.workspace_id
         and delivery.consumer_name = 'planning.plan_snapshot_v1'
         and delivery.handler_contract_version = 1
        where event.event_id = planning.stable_plan_uuid_v1(
          pointer.workspace_id::text ||
          '|planning.snapshot_calculation_v2_activation_requested|' ||
          pointer.snapshot_id::text || '|' || pointer.applied_attempt_id::text || '|' ||
          pointer.pointer_version::text || '|planning-calculation/2'
        )
      )
  ) then
    raise exception using errcode = '55000',
      message = 'Planning V2 activation did not enqueue every exact V1 pointer';
  end if;
end
$postflight$;

alter function planning.plan_snapshot_v2_activation_event_is_valid_v1(outbox.events)
  owner to pando_planning_worker;
alter function planning.enqueue_plan_snapshot_v2_activation_v1(uuid)
  owner to pando_planning_worker;
alter function outbox.claim_plan_snapshot_projection_impl()
  owner to pando_planning_worker;
alter function planning.load_plan_snapshot_projection_v2_impl(uuid, uuid, uuid)
  owner to pando_planning_worker;
alter function planning.complete_plan_snapshot_projection_impl(uuid, uuid, uuid, jsonb)
  owner to pando_planning_worker;

revoke all on function
  planning.plan_snapshot_v2_activation_event_is_valid_v1(outbox.events),
  planning.enqueue_plan_snapshot_v2_activation_v1(uuid)
  from public, anon, authenticated, service_role;
grant execute on function
  planning.plan_snapshot_v2_activation_event_is_valid_v1(outbox.events),
  planning.enqueue_plan_snapshot_v2_activation_v1(uuid)
  to pando_planning_worker;

create or replace function planning.read_learning_track_cadence_progress_v1(
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
  v_has_current_failure boolean := false;
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
      and delivery.delivery_state in ('pending', 'retry', 'leased')
      and delivery.available_at <= p_query_as_of
  ) into v_has_uncovered;

  select exists (
    select 1
    from planning.plan_snapshot_attempts as attempt
    join outbox.deliveries as delivery
      on delivery.delivery_id = attempt.delivery_id
     and delivery.workspace_id = attempt.workspace_id
    join planning.plan_snapshot_delivery_ledger as ledger
      on ledger.delivery_id = delivery.delivery_id
     and ledger.workspace_id = delivery.workspace_id
     and ledger.coverage_state = 'UNCOVERED'
    where attempt.workspace_id = p_workspace_id
      and attempt.base_pointer_version = v_pointer.pointer_version
      and attempt.attempt_state = 'FAILED'
      and delivery.consumer_name = 'planning.plan_snapshot_v1'
      and delivery.handler_contract_version = 1
      and delivery.delivery_state = 'dead_letter'
      and delivery.available_at <= p_query_as_of
  ) into v_has_current_failure;

  select exists (
    select 1
    from outbox.deliveries as delivery
    join outbox.events as event
      on event.event_id = delivery.event_id
    join planning.plan_snapshot_delivery_ledger as ledger
      on ledger.delivery_id = delivery.delivery_id
     and ledger.workspace_id = delivery.workspace_id
     and ledger.coverage_state = 'UNCOVERED'
    where delivery.workspace_id = p_workspace_id
      and delivery.consumer_name = 'planning.plan_snapshot_v1'
      and delivery.handler_contract_version = 1
      and delivery.delivery_state in ('pending', 'retry', 'leased')
      and delivery.available_at <= p_query_as_of
      and (
        event.event_name = 'planning.snapshot_calculation_v2_activation_requested'
        or (
          event.event_name = 'planning.input_changed'
          and event.payload->>'change_kind' = 'TRACK_CADENCE_CHANGED'
        )
        or exists (
          select 1
          from planning.plan_snapshot_attempts as active_attempt
          where active_attempt.delivery_id = delivery.delivery_id
            and active_attempt.attempt_state in ('LOADING', 'READY')
            and active_attempt.calculation_contract_version = 'planning-calculation/2'
        )
        or (
          not exists (
            select 1
            from planning.plan_snapshot_attempts as active_attempt
            where active_attempt.delivery_id = delivery.delivery_id
              and active_attempt.attempt_state in ('LOADING', 'READY')
          )
          and exists (
            select 1
            from planning.current_plan_snapshots as current_pointer
            join planning.plan_snapshot_attempts as applied_attempt
              on applied_attempt.workspace_id = current_pointer.workspace_id
             and applied_attempt.attempt_id = current_pointer.applied_attempt_id
            join planning.plan_snapshots as current_snapshot
              on current_snapshot.workspace_id = current_pointer.workspace_id
             and current_snapshot.snapshot_id = current_pointer.snapshot_id
            where current_pointer.workspace_id = p_workspace_id
              and applied_attempt.attempt_state = 'APPLIED'
              and applied_attempt.applied_pointer_version = current_pointer.pointer_version
              and applied_attempt.calculation_contract_version = 'planning-calculation/2'
              and applied_attempt.normalized_input->>'completedWorkPolicyVersion'
                = 'planning-completed-work/0.2'
              and current_snapshot.engine_version = 'planner-engine/0.2.0'
              and current_snapshot.policy_version = 'planning-policy/0.2'
              and current_snapshot.input_fingerprint = applied_attempt.input_fingerprint
              and current_snapshot.result->>'inputFingerprint'
                = applied_attempt.input_fingerprint
          )
        )
      )
  ) into v_has_active_v2;

  if v_pointer.snapshot_id is not null and v_pointer.applied_attempt_id is not null
     and not v_has_uncovered and not v_has_current_failure then
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

alter function planning.read_learning_track_cadence_progress_v1(uuid, uuid, timestamptz)
  owner to pando_planning_worker;
revoke all on function planning.read_learning_track_cadence_progress_v1(uuid, uuid, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function planning.read_learning_track_cadence_progress_v1(uuid, uuid, timestamptz)
  to pando_planning_api;

reset role;
revoke create on schema planning, outbox from pando_planning_worker;

do $migration_role_membership$
begin
  execute pg_catalog.format(
    'revoke pando_planning_worker, pando_planning_api from %I',
    current_user
  );
end
$migration_role_membership$;
