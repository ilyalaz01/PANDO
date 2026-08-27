-- Authenticated Targets readiness detail and current-only Planning input queries.

do $migration_role_membership$
begin
  execute pg_catalog.format(
    'grant pando_phase1_api, pando_readiness_worker to %I with set true', current_user
  );
end
$migration_role_membership$;

grant create on schema targets to pando_phase1_api;
grant create on schema outbox to pando_readiness_worker;

create index deliveries_readiness_state_workspace
  on outbox.deliveries (workspace_id, delivery_state, available_at, event_id)
  where consumer_name = 'targets.readiness_projection_v1'
    and handler_contract_version = 1
    and delivery_state in ('pending', 'retry', 'leased', 'dead_letter');

create function outbox.get_readiness_goal_delivery_state_v1(
  p_workspace_id uuid,
  p_readiness_goal_id uuid,
  p_profile_version_id uuid,
  p_current_source_watermark bigint,
  p_current_snapshot_id uuid,
  p_as_of timestamptz
)
returns text
language sql
stable
security definer
set search_path = ''
as $function$
  with eligible_delivery as materialized (
    select delivery.event_id, delivery.workspace_id, delivery.delivery_state
    from outbox.deliveries as delivery
    where delivery.workspace_id = p_workspace_id
      and delivery.consumer_name = 'targets.readiness_projection_v1'
      and delivery.handler_contract_version = 1
      and delivery.delivery_state in ('pending', 'retry', 'leased', 'dead_letter')
      and (
        delivery.delivery_state in ('retry', 'leased', 'dead_letter')
        or delivery.available_at <= p_as_of
      )
  ), relevant as (
    select delivery.delivery_state
    from eligible_delivery as delivery
    join outbox.events as event
      on event.workspace_id = delivery.workspace_id
     and event.event_id = delivery.event_id
    where case event.event_name
        when 'targets.readiness_goal_created' then
          event.aggregate_id = p_readiness_goal_id
          and p_current_snapshot_id is null
        when 'mastery.competency_state_changed' then
          (event.payload->>'input_watermark') ~ '^[1-9][0-9]{0,18}$'
          and (
            p_current_source_watermark is null
            or (event.payload->>'input_watermark')::bigint > p_current_source_watermark
          )
          and exists (
            select 1
            from targets.target_requirement_members as member
            where member.profile_version_id = p_profile_version_id
              and member.member_type = 'NODE'
              and member.node_kind = 'COMPETENCY'
              and member.node_ref = event.payload->>'competency_ref'
          )
        when 'targets.readiness_refresh_scheduled' then
          event.aggregate_id = p_readiness_goal_id
          and p_current_snapshot_id is not null
          and event.payload->>'source_snapshot_id' = p_current_snapshot_id::text
        else false
      end
  )
  select case
    when exists (
      select 1 from relevant
      where delivery_state in ('pending', 'retry', 'leased')
    ) then 'REBUILDING'
    when exists (
      select 1 from relevant where delivery_state = 'dead_letter'
    ) then 'ERROR'
    else null
  end
$function$;

create function targets.get_target_readiness_impl(
  p_workspace_id uuid,
  p_readiness_goal_key text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_goal targets.readiness_goals%rowtype;
  v_profile targets.target_profile_versions%rowtype;
  v_pointer targets.current_readiness_snapshots%rowtype;
  v_snapshot targets.readiness_snapshots%rowtype;
  v_as_of timestamptz := pg_catalog.statement_timestamp();
  v_delivery_state text;
  v_projection_state text;
  v_inputs jsonb;
  v_gaps jsonb;
begin
  if identity.jwt_subject() is null then
    raise exception using errcode = '28000', message = 'an authenticated user is required';
  end if;
  if not identity.is_workspace_member(p_workspace_id) then
    raise exception using errcode = '42501', message = 'workspace is not accessible';
  end if;
  if p_readiness_goal_key is null
     or p_readiness_goal_key !~ '^goal:[a-z0-9][a-z0-9-]{1,100}$' then
    raise exception using errcode = '22023', message = 'readiness goal key is invalid';
  end if;

  select goal.* into v_goal
  from targets.readiness_goals as goal
  where goal.workspace_id = p_workspace_id
    and goal.readiness_goal_key = p_readiness_goal_key;
  if not found then
    raise exception using errcode = '42501', message = 'readiness goal is not accessible';
  end if;
  select profile.* into strict v_profile
  from targets.target_profile_versions as profile
  where profile.profile_version_id = v_goal.profile_version_id;
  select pointer.* into v_pointer
  from targets.current_readiness_snapshots as pointer
  where pointer.workspace_id = p_workspace_id
    and pointer.readiness_goal_id = v_goal.readiness_goal_id;
  if found then
    select snapshot.* into strict v_snapshot
    from targets.readiness_snapshots as snapshot
    where snapshot.workspace_id = p_workspace_id
      and snapshot.readiness_goal_id = v_goal.readiness_goal_id
      and snapshot.snapshot_id = v_pointer.snapshot_id;
  end if;

  v_delivery_state := outbox.get_readiness_goal_delivery_state_v1(
    p_workspace_id, v_goal.readiness_goal_id, v_goal.profile_version_id,
    case when v_pointer.snapshot_id is null then null else v_pointer.source_evidence_watermark end,
    v_pointer.snapshot_id, v_as_of
  );
  v_projection_state := case
    when v_delivery_state = 'REBUILDING' then 'REBUILDING'
    when v_delivery_state = 'ERROR' then 'ERROR'
    when v_pointer.snapshot_id is null then 'NOT_MATERIALIZED'
    when v_pointer.valid_until is not null and v_as_of > v_pointer.valid_until then 'STALE'
    else 'CURRENT'
  end;

  if v_pointer.snapshot_id is not null then
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'competencyRef', input.competency_ref,
      'dimension', input.dimension,
      'requiredLevel', input.required_level,
      'owningRuleKeys', input.owning_rule_keys,
      'value', input.value_state,
      'achievementLevel', input.achievement_level,
      'freshness', input.freshness,
      'confidence', input.estimate_confidence,
      'lastMeaningfulEvidenceAt', input.last_meaningful_evidence_at,
      'supportingEvidenceIds', input.supporting_evidence_ids,
      'contradictingEvidenceIds', input.contradicting_evidence_ids
    ) order by input.competency_ref collate "C", input.dimension, input.required_level), '[]'::jsonb)
    into v_inputs
    from targets.readiness_snapshot_inputs as input
    where input.workspace_id = p_workspace_id
      and input.readiness_goal_id = v_goal.readiness_goal_id
      and input.snapshot_id = v_pointer.snapshot_id;

    v_gaps := v_snapshot.gaps;

  else
    v_inputs := '[]'::jsonb;
    v_gaps := '[]'::jsonb;
  end if;

  return pg_catalog.jsonb_build_object(
    'contract', pg_catalog.jsonb_build_object('name', 'TargetReadinessV1', 'version', '1.0.0'),
    'asOf', v_as_of,
    'projectionState', v_projection_state,
    'stateReason', case v_projection_state
      when 'REBUILDING' then 'DELIVERY_PENDING'
      when 'ERROR' then 'DEAD_LETTER'
      when 'NOT_MATERIALIZED' then 'NO_SNAPSHOT'
      when 'STALE' then 'SNAPSHOT_EXPIRED'
      else null
    end,
    'readinessGoalId', v_goal.readiness_goal_id,
    'readinessGoalKey', v_goal.readiness_goal_key,
    'readinessGoalLifecycle', v_goal.lifecycle,
    'readinessGoalAggregateVersion', v_goal.aggregate_version::text,
    'profile', pg_catalog.jsonb_build_object(
      'profileVersionId', v_profile.profile_version_id,
      'profileVersionKey', v_profile.profile_version_key,
      'catalogVersionId', v_profile.catalog_version_id
    ),
    'projectionVersion', case when v_pointer.snapshot_id is null then null
      else v_pointer.projection_version::text end,
    'validUntil', v_pointer.valid_until,
    'snapshot', case when v_snapshot.snapshot_id is null then null else
      pg_catalog.jsonb_build_object(
        'snapshotId', v_snapshot.snapshot_id,
        'inputFingerprint', v_snapshot.input_fingerprint,
        'sourceEvidenceWatermark', v_snapshot.source_evidence_watermark::text,
        'calculatedAsOf', v_snapshot.calculated_as_of,
        'engineVersion', v_snapshot.readiness_engine_version,
        'policyVersion', v_snapshot.readiness_policy_version,
        'status', v_snapshot.readiness_status,
        'lower', v_snapshot.lower_bound,
        'upper', v_snapshot.upper_bound,
        'coverage', v_snapshot.coverage,
        'confidence', v_snapshot.estimate_confidence,
        'blockers', v_snapshot.blockers,
        'ruleEvaluations', v_snapshot.rule_evaluations,
        'explanationCodes', v_snapshot.explanation_codes
      ) end,
    'gaps', v_gaps,
    'inputs', v_inputs
  );
end
$function$;

create function api.get_target_readiness_v1(p_readiness_goal_key text)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  select targets.get_target_readiness_impl(
    (identity.get_current_personal_workspace_impl()->>'workspaceId')::uuid,
    p_readiness_goal_key
  )
$function$;

create function api.get_current_planning_readiness_input_v1(p_readiness_goal_key text)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_detail jsonb;
begin
  v_detail := targets.get_target_readiness_impl(
    (identity.get_current_personal_workspace_impl()->>'workspaceId')::uuid,
    p_readiness_goal_key
  );
  if v_detail->>'projectionState' <> 'CURRENT'
     or v_detail->>'readinessGoalLifecycle' <> 'active' then
    return pg_catalog.jsonb_build_object(
      'contract', pg_catalog.jsonb_build_object(
        'name', 'PlanningReadinessInputV1', 'version', '1.0.0'
      ),
      'availability', 'UNAVAILABLE',
      'reason', case
        when v_detail->>'readinessGoalLifecycle' <> 'active' then 'GOAL_INACTIVE'
        else v_detail->>'projectionState'
      end,
      'readinessGoalId', v_detail->>'readinessGoalId',
      'readinessGoalKey', v_detail->>'readinessGoalKey',
      'snapshot', null
    );
  end if;
  return pg_catalog.jsonb_build_object(
    'contract', pg_catalog.jsonb_build_object(
      'name', 'PlanningReadinessInputV1', 'version', '1.0.0'
    ),
    'availability', 'CURRENT',
    'reason', null,
    'readinessGoalId', v_detail->>'readinessGoalId',
    'readinessGoalKey', v_detail->>'readinessGoalKey',
    'snapshot', pg_catalog.jsonb_build_object(
      'snapshotId', v_detail->'snapshot'->>'snapshotId',
      'profileVersionId', v_detail->'profile'->>'profileVersionId',
      'profileVersionKey', v_detail->'profile'->>'profileVersionKey',
      'projectionVersion', v_detail->>'projectionVersion',
      'inputFingerprint', v_detail->'snapshot'->>'inputFingerprint',
      'sourceEvidenceWatermark', v_detail->'snapshot'->>'sourceEvidenceWatermark',
      'calculatedAsOf', v_detail->'snapshot'->'calculatedAsOf',
      'validUntil', v_detail->'validUntil',
      'engineVersion', v_detail->'snapshot'->>'engineVersion',
      'policyVersion', v_detail->'snapshot'->>'policyVersion',
      'status', v_detail->'snapshot'->>'status',
      'lower', v_detail->'snapshot'->'lower',
      'upper', v_detail->'snapshot'->'upper',
      'coverage', v_detail->'snapshot'->'coverage',
      'confidence', v_detail->'snapshot'->>'confidence',
      'blockers', v_detail->'snapshot'->'blockers',
      'gaps', v_detail->'gaps'
    )
  );
end
$function$;

alter function outbox.get_readiness_goal_delivery_state_v1(
  uuid, uuid, uuid, bigint, uuid, timestamptz
) owner to pando_readiness_worker;
alter function targets.get_target_readiness_impl(uuid, text) owner to pando_phase1_api;

revoke all on function outbox.get_readiness_goal_delivery_state_v1(
  uuid, uuid, uuid, bigint, uuid, timestamptz
), targets.get_target_readiness_impl(uuid, text),
  api.get_target_readiness_v1(text),
  api.get_current_planning_readiness_input_v1(text)
from public, anon, authenticated, service_role;
grant execute on function outbox.get_readiness_goal_delivery_state_v1(
  uuid, uuid, uuid, bigint, uuid, timestamptz
) to pando_phase1_api;
grant execute on function targets.get_target_readiness_impl(uuid, text)
  to authenticated;
grant execute on function api.get_target_readiness_v1(text),
  api.get_current_planning_readiness_input_v1(text) to authenticated;

revoke create on schema targets from pando_phase1_api;
revoke create on schema outbox from pando_readiness_worker;
do $migration_role_membership$
begin
  execute pg_catalog.format(
    'revoke pando_phase1_api, pando_readiness_worker from %I', current_user
  );
end
$migration_role_membership$;
