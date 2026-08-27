-- ADR-0003 direct fixed-consumer routing from the owning producer transactions.

begin;

do $migration_role_membership$
begin
  execute pg_catalog.format(
    'grant pando_phase1_api, pando_mastery_worker to %I with set true', current_user
  );
end
$migration_role_membership$;

-- Serialize the old uncapped producer with this replacement. The lock waits for an already-running
-- old transaction and blocks new inserts until the capped function, repeated preflight, and
-- rollout-closing backfill commit together.
lock table targets.readiness_goals in share row exclusive mode;

create function targets.guard_readiness_goal_active_envelope()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_active_goal_count bigint;
  v_active_leaf_count bigint;
  v_new_profile_leaf_count bigint;
begin
  -- This table-side invariant also protects callers that entered the previous producer body before
  -- this migration committed. All goal writers serialize on the same workspace key.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.workspace_id::text || ':targets.active-readiness-goals', 2)
  );
  if new.lifecycle <> 'active' then
    return new;
  end if;

  select count(*)::bigint into v_active_goal_count
  from targets.readiness_goals as goal
  where goal.workspace_id = new.workspace_id
    and goal.lifecycle = 'active'
    and goal.readiness_goal_id <> new.readiness_goal_id;
  if v_active_goal_count >= 20 then
    raise exception using errcode = '54000',
      message = 'active readiness goal limit exceeded';
  end if;

  select count(*)::bigint into v_new_profile_leaf_count
  from (
    select member.node_ref, member.objective_dimension, member.required_level
    from targets.target_requirement_members as member
    where member.profile_version_id = new.profile_version_id
      and member.member_type = 'NODE'
      and member.node_kind = 'COMPETENCY'
    group by member.node_ref, member.objective_dimension, member.required_level
  ) as unique_leaf;
  select coalesce(sum(per_goal.leaf_count), 0)::bigint into v_active_leaf_count
  from targets.readiness_goals as goal
  cross join lateral (
    select count(*)::bigint as leaf_count
    from (
      select member.node_ref, member.objective_dimension, member.required_level
      from targets.target_requirement_members as member
      where member.profile_version_id = goal.profile_version_id
        and member.member_type = 'NODE'
        and member.node_kind = 'COMPETENCY'
      group by member.node_ref, member.objective_dimension, member.required_level
    ) as unique_leaf
  ) as per_goal
  where goal.workspace_id = new.workspace_id
    and goal.lifecycle = 'active'
    and goal.readiness_goal_id <> new.readiness_goal_id;
  if v_new_profile_leaf_count > 250
     or v_active_leaf_count + v_new_profile_leaf_count > 250 then
    raise exception using errcode = '54000',
      message = 'active readiness leaf limit exceeded';
  end if;
  return new;
end
$function$;

create trigger readiness_goal_active_envelope
before insert or update of workspace_id, profile_version_id, lifecycle
on targets.readiness_goals
for each row execute function targets.guard_readiness_goal_active_envelope();

create or replace function targets.create_readiness_goal_impl(
  p_workspace_id uuid,
  p_readiness_goal_key text,
  p_title text,
  p_profile_version_key text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_user_id uuid;
  v_profile_version_id uuid;
  v_goal_id uuid := gen_random_uuid();
  v_command_id uuid := gen_random_uuid();
  v_correlation_id uuid := gen_random_uuid();
  v_event_id uuid := gen_random_uuid();
  v_request_hash bytea;
  v_response jsonb;
  v_receipt outbox.command_receipts%rowtype;
  v_active_goal_count bigint;
  v_active_leaf_count bigint;
  v_new_profile_leaf_count bigint;
begin
  if identity.jwt_subject() is null then
    raise exception using errcode = '28000', message = 'an authenticated user is required';
  end if;
  if not identity.is_workspace_member(p_workspace_id) then
    raise exception using errcode = '42501', message = 'workspace is not accessible';
  end if;
  v_actor_user_id := identity.current_user_id();
  if v_actor_user_id is null then
    raise exception using errcode = '28000', message = 'authenticated user is not provisioned';
  end if;
  if p_idempotency_key is null or p_idempotency_key <> btrim(p_idempotency_key)
     or char_length(p_idempotency_key) not between 1 and 128 then
    raise exception using errcode = '22023',
      message = 'idempotency key must contain 1 to 128 trimmed characters';
  end if;
  if p_readiness_goal_key is null
     or p_readiness_goal_key !~ '^goal:[a-z0-9][a-z0-9-]{1,100}$' then
    raise exception using errcode = '22023', message = 'readiness goal key is invalid';
  end if;
  if p_title is null or p_title <> btrim(p_title)
     or char_length(p_title) not between 1 and 200 then
    raise exception using errcode = '22023', message = 'readiness goal title is invalid';
  end if;
  if p_profile_version_key is null
     or p_profile_version_key !~ '^target:[a-z0-9][a-z0-9-]{1,100}$' then
    raise exception using errcode = '22023', message = 'target profile key is invalid';
  end if;

  v_request_hash := extensions.digest(pg_catalog.convert_to(
    pg_catalog.jsonb_build_object(
      'commandType', 'targets.create_readiness_goal',
      'schemaVersion', 1,
      'workspaceId', p_workspace_id,
      'readinessGoalKey', p_readiness_goal_key,
      'title', p_title,
      'profileVersionKey', p_profile_version_key
    )::text, 'UTF8'
  ), 'sha256');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    v_actor_user_id::text || ':targets.create_readiness_goal:' || p_idempotency_key, 0
  ));
  select receipt.* into v_receipt
  from outbox.command_receipts as receipt
  where receipt.actor_user_id = v_actor_user_id
    and receipt.command_type = 'targets.create_readiness_goal'
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

  select version.profile_version_id into v_profile_version_id
  from targets.target_profile_versions as version
  join targets.target_profile_series as series
    on series.profile_series_id = version.profile_series_id
  where version.profile_version_key = p_profile_version_key
    and version.lifecycle = 'published'
    and series.lifecycle = 'active'
    and (version.workspace_id is null or version.workspace_id = p_workspace_id);
  if v_profile_version_id is null then
    raise exception using errcode = '42501', message = 'target profile is not accessible';
  end if;
  -- Admission and insertion share one workspace lock. Completed idempotent requests have already
  -- returned above, so a replay remains safe even after the workspace reaches either limit.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_workspace_id::text || ':targets.active-readiness-goals', 2)
  );
  if exists (
    select 1 from targets.readiness_goals as goal
    where goal.workspace_id = p_workspace_id
      and goal.readiness_goal_key = p_readiness_goal_key
  ) then
    raise exception using errcode = '23505', message = 'readiness goal already exists';
  end if;
  select count(*)::bigint into v_active_goal_count
  from targets.readiness_goals as goal
  where goal.workspace_id = p_workspace_id and goal.lifecycle = 'active';
  if v_active_goal_count >= 20 then
    raise exception using errcode = '54000',
      message = 'active readiness goal limit exceeded';
  end if;

  select count(*)::bigint into v_new_profile_leaf_count
  from (
    select member.node_ref, member.objective_dimension, member.required_level
    from targets.target_requirement_members as member
    where member.profile_version_id = v_profile_version_id
      and member.member_type = 'NODE'
      and member.node_kind = 'COMPETENCY'
    group by member.node_ref, member.objective_dimension, member.required_level
  ) as unique_leaf;
  select coalesce(sum(per_goal.leaf_count), 0)::bigint into v_active_leaf_count
  from targets.readiness_goals as goal
  cross join lateral (
    select count(*)::bigint as leaf_count
    from (
      select member.node_ref, member.objective_dimension, member.required_level
      from targets.target_requirement_members as member
      where member.profile_version_id = goal.profile_version_id
        and member.member_type = 'NODE'
        and member.node_kind = 'COMPETENCY'
      group by member.node_ref, member.objective_dimension, member.required_level
    ) as unique_leaf
  ) as per_goal
  where goal.workspace_id = p_workspace_id and goal.lifecycle = 'active';
  if v_new_profile_leaf_count > 250
     or v_active_leaf_count + v_new_profile_leaf_count > 250 then
    raise exception using errcode = '54000',
      message = 'active readiness leaf limit exceeded';
  end if;

  insert into outbox.command_receipts (
    command_id, command_type, command_schema_version, workspace_id, actor_user_id,
    idempotency_key, request_hash, correlation_id, expected_aggregate_version
  ) values (
    v_command_id, 'targets.create_readiness_goal', 1, p_workspace_id,
    v_actor_user_id, p_idempotency_key, v_request_hash, v_correlation_id, 0
  );
  insert into targets.readiness_goals (
    readiness_goal_id, workspace_id, readiness_goal_key, title, profile_version_id
  ) values (
    v_goal_id, p_workspace_id, p_readiness_goal_key, p_title, v_profile_version_id
  );
  insert into outbox.events (
    event_id, event_name, event_schema_version, workspace_id, aggregate_type,
    aggregate_id, aggregate_version, actor_type, actor_user_id, command_id,
    correlation_id, occurred_at, source, payload
  ) values (
    v_event_id, 'targets.readiness_goal_created', 1, p_workspace_id,
    'targets.readiness_goal', v_goal_id, 1, 'user', v_actor_user_id,
    v_command_id, v_correlation_id, clock_timestamp(), 'pando.database',
    pg_catalog.jsonb_build_object(
      'readiness_goal_id', v_goal_id,
      'readiness_goal_key', p_readiness_goal_key,
      'profile_version_id', v_profile_version_id,
      'profile_version_key', p_profile_version_key
    )
  );
  insert into outbox.deliveries (
    event_id, workspace_id, consumer_name, handler_contract_version
  ) values (
    v_event_id, p_workspace_id, 'targets.readiness_projection_v1', 1
  );
  v_response := pg_catalog.jsonb_build_object(
    'commandId', v_command_id,
    'workspaceId', p_workspace_id,
    'readinessGoalId', v_goal_id,
    'readinessGoalKey', p_readiness_goal_key,
    'profileVersionKey', p_profile_version_key,
    'aggregateVersion', 1,
    'emittedEventIds', pg_catalog.jsonb_build_array(v_event_id)
  );
  update outbox.command_receipts
  set command_status = 'completed', response = v_response,
      emitted_event_ids = array[v_event_id], completed_at = clock_timestamp()
  where command_id = v_command_id;
  return v_response;
end
$function$;

create or replace function mastery.complete_evidence_projection_impl(
  p_delivery_id uuid,
  p_lease_token uuid,
  p_expected_event_position bigint,
  p_expected_input_watermark bigint,
  p_state jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_delivery outbox.deliveries%rowtype;
  v_event outbox.events%rowtype;
  v_current_watermark bigint;
  v_competency_ref text;
  v_snapshot_id uuid := gen_random_uuid();
  v_pointer_rows integer := 0;
  v_mastery_event_id uuid;
begin
  perform 1 from outbox.consumer_receipts as receipt
  where receipt.delivery_id = p_delivery_id
    and receipt.consumer_name = 'mastery.evidence_projection_v1';
  if found then return true; end if;

  select delivery.* into v_delivery
  from outbox.deliveries as delivery
  where delivery.delivery_id = p_delivery_id
    and delivery.consumer_name = 'mastery.evidence_projection_v1'
    and delivery.handler_contract_version = 1
  for update;
  if not found or v_delivery.delivery_state <> 'leased'
     or v_delivery.lease_token is distinct from p_lease_token
     or v_delivery.lease_expires_at <= clock_timestamp() then
    raise exception using errcode = '42501', message = 'mastery delivery lease is not valid';
  end if;
  select event.* into strict v_event
  from outbox.events as event
  where event.workspace_id = v_delivery.workspace_id and event.event_id = v_delivery.event_id;
  if v_event.event_position <> p_expected_event_position
     or not mastery.evidence_projection_event_v1_is_valid(v_event) then
    raise exception using errcode = '22023', message = 'mastery event contract is invalid';
  end if;
  v_competency_ref := v_event.payload->>'competency_ref';
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    v_delivery.workspace_id::text || ':evidence-ledger', 4
  ));
  select ledger.ledger_version into strict v_current_watermark
  from evidence.subject_ledgers as ledger
  where ledger.workspace_id = v_delivery.workspace_id;
  if v_current_watermark <> p_expected_input_watermark then return false; end if;
  if p_state is null or pg_catalog.jsonb_typeof(p_state) <> 'object'
     or p_state->>'engineVersion' <> 'mastery-engine/0.1.0'
     or p_state->>'policyVersion' <> 'mastery-readiness-policy/0.1'
     or p_state->>'inputWatermark' <> p_expected_input_watermark::text
     or p_state->>'competencyId' <> v_competency_ref
     or p_state->>'achievementLevel' not in (
       'NOT_STARTED', 'COMPLETED', 'VERIFIED', 'MASTERED'
     )
     or pg_catalog.jsonb_typeof(p_state->'dimensions') <> 'object'
     or pg_catalog.jsonb_typeof(p_state->'supportingEvidenceIds') <> 'array'
     or pg_catalog.jsonb_typeof(p_state->'contradictingEvidenceIds') <> 'array'
     or pg_catalog.jsonb_typeof(p_state->'explanationCodes') <> 'array' then
    raise exception using errcode = '22023', message = 'mastery result contract is invalid';
  end if;

  insert into mastery.competency_state_snapshots (
    snapshot_id, workspace_id, competency_ref, projection_generation,
    input_watermark, engine_version, policy_version, calculated_as_of,
    achievement_level, state
  ) values (
    v_snapshot_id, v_delivery.workspace_id, v_competency_ref, 'live-v1',
    p_expected_input_watermark, p_state->>'engineVersion', p_state->>'policyVersion',
    (p_state->>'calculatedAsOf')::timestamptz, p_state->>'achievementLevel', p_state
  ) on conflict (
    workspace_id, competency_ref, engine_version, policy_version,
    projection_generation, input_watermark
  ) do nothing;
  select snapshot.snapshot_id into strict v_snapshot_id
  from mastery.competency_state_snapshots as snapshot
  where snapshot.workspace_id = v_delivery.workspace_id
    and snapshot.competency_ref = v_competency_ref
    and snapshot.engine_version = p_state->>'engineVersion'
    and snapshot.policy_version = p_state->>'policyVersion'
    and snapshot.projection_generation = 'live-v1'
    and snapshot.input_watermark = p_expected_input_watermark;

  insert into mastery.current_competency_states (
    workspace_id, competency_ref, snapshot_id, input_watermark
  ) values (
    v_delivery.workspace_id, v_competency_ref, v_snapshot_id, p_expected_input_watermark
  ) on conflict (workspace_id, competency_ref) do update
  set snapshot_id = excluded.snapshot_id,
      input_watermark = excluded.input_watermark,
      projection_version = mastery.current_competency_states.projection_version + 1,
      updated_at = clock_timestamp()
  where mastery.current_competency_states.input_watermark < excluded.input_watermark;
  get diagnostics v_pointer_rows = row_count;

  if v_pointer_rows > 0 then
    v_mastery_event_id := gen_random_uuid();
    insert into outbox.events (
      event_id, event_name, event_schema_version, workspace_id,
      actor_type, actor_user_id, command_id, correlation_id, causation_id,
      occurred_at, source, payload
    ) values (
      v_mastery_event_id, 'mastery.competency_state_changed', 1,
      v_delivery.workspace_id, 'system', null, v_event.command_id,
      v_event.correlation_id, v_event.event_id, clock_timestamp(),
      'pando.mastery_worker', pg_catalog.jsonb_build_object(
        'competency_ref', v_competency_ref,
        'snapshot_id', v_snapshot_id,
        'projection_generation', 'live-v1',
        'input_watermark', p_expected_input_watermark::text,
        'achievement_level', p_state->>'achievementLevel',
        'engine_version', p_state->>'engineVersion',
        'policy_version', p_state->>'policyVersion',
        'calculated_as_of', p_state->>'calculatedAsOf'
      )
    );
    insert into outbox.deliveries (
      event_id, workspace_id, consumer_name, handler_contract_version
    ) values (
      v_mastery_event_id, v_delivery.workspace_id, 'targets.readiness_projection_v1', 1
    );
  end if;

  insert into outbox.consumer_receipts (
    delivery_id, event_id, workspace_id, consumer_name, handler_contract_version,
    input_event_position, lease_token
  ) values (
    v_delivery.delivery_id, v_delivery.event_id, v_delivery.workspace_id,
    'mastery.evidence_projection_v1', 1, v_event.event_position, p_lease_token
  );
  update outbox.deliveries
  set delivery_state = 'succeeded', lease_token = null, lease_expires_at = null,
      completed_at = clock_timestamp()
  where delivery_id = v_delivery.delivery_id;
  return true;
end
$function$;

revoke all on function targets.create_readiness_goal_impl(uuid, text, text, text, text),
  mastery.complete_evidence_projection_impl(uuid, uuid, bigint, bigint, jsonb),
  targets.guard_readiness_goal_active_envelope()
  from public, anon, authenticated, service_role;
grant execute on function targets.create_readiness_goal_impl(uuid, text, text, text, text)
  to authenticated;
grant execute on function mastery.complete_evidence_projection_impl(
  uuid, uuid, bigint, bigint, jsonb
) to service_role;

-- A goal could have committed after the preceding migration's preflight but before this file took
-- its table lock. Recheck under that lock before routing any between-migration event.
do $active_readiness_rollout_preflight$
begin
  if exists (
    select 1
    from targets.readiness_goals as goal
    cross join lateral (
      select count(*)::bigint as leaf_count
      from (
        select member.node_ref, member.objective_dimension, member.required_level
        from targets.target_requirement_members as member
        where member.profile_version_id = goal.profile_version_id
          and member.member_type = 'NODE'
          and member.node_kind = 'COMPETENCY'
        group by member.node_ref, member.objective_dimension, member.required_level
      ) as unique_leaf
    ) as per_goal
    where goal.lifecycle = 'active'
    group by goal.workspace_id
    having count(*) > 20 or coalesce(sum(per_goal.leaf_count), 0) > 250
  ) then
    raise exception using errcode = '54000',
      message = 'pre-existing active readiness workload exceeds the Phase 3B envelope';
  end if;
end
$active_readiness_rollout_preflight$;

-- Close the rollout window after both direct producers are installed. This repeatable pass
-- catches any transaction that committed while the preceding migration was being applied.
insert into outbox.deliveries (
  event_id, workspace_id, consumer_name, handler_contract_version
)
select event.event_id, event.workspace_id, 'targets.readiness_projection_v1', 1
from outbox.events as event
where event.event_schema_version = 1
  and event.event_name in (
    'targets.readiness_goal_created', 'mastery.competency_state_changed'
  )
on conflict (event_id, consumer_name, handler_contract_version) do nothing;

do $migration_role_membership$
begin
  execute pg_catalog.format(
    'revoke pando_phase1_api, pando_mastery_worker from %I', current_user
  );
end
$migration_role_membership$;

commit;
