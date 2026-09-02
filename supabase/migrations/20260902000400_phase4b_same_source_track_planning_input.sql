-- Multiple Learning Tracks may intentionally share one Goal/Profile owner source. Planning must
-- read that immutable readiness input once, rather than treating one source per Track as distinct.

do $roles$
begin
  execute pg_catalog.format(
    'grant pando_phase1_planning_source to %I with set true',
    current_user
  );
end
$roles$;

grant create on schema targets to pando_phase1_planning_source;
set role pando_phase1_planning_source;

create or replace function targets.read_planning_readiness_source_v1(
  p_workspace_id uuid,
  p_readiness_goal_ids uuid[],
  p_profile_version_ids uuid[],
  p_as_of timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_count integer;
  v_items jsonb;
begin
  if p_workspace_id is null or p_as_of is null or p_readiness_goal_ids is null
     or p_profile_version_ids is null
     or pg_catalog.cardinality(p_readiness_goal_ids) <> pg_catalog.cardinality(p_profile_version_ids)
     or pg_catalog.cardinality(p_readiness_goal_ids) > 30
     or pg_catalog.cardinality(p_readiness_goal_ids) < 1
     or pg_catalog.array_position(p_readiness_goal_ids, null) is not null
     or pg_catalog.array_position(p_profile_version_ids, null) is not null then
    raise exception using errcode = '22023', message = 'planning Targets source input is invalid';
  end if;

  select count(*)::integer
  into v_count
  from (
    select distinct goal_id, profile_id
    from rows from (
      pg_catalog.unnest(p_readiness_goal_ids),
      pg_catalog.unnest(p_profile_version_ids)
    ) as value(goal_id, profile_id)
  ) as requested_pairs;

  with requested as (
    select distinct goal_id, profile_id
    from rows from (
      pg_catalog.unnest(p_readiness_goal_ids),
      pg_catalog.unnest(p_profile_version_ids)
    ) as value(goal_id, profile_id)
  ), source as (
    select goal.readiness_goal_id, goal.readiness_goal_key, goal.lifecycle,
      goal.aggregate_version as goal_version, profile.profile_version_id,
      profile.profile_version_key, profile.catalog_version_id,
      pointer.snapshot_id, pointer.projection_version, pointer.valid_until,
      snapshot.input_fingerprint, snapshot.calculated_as_of, snapshot.readiness_status,
      snapshot.coverage, snapshot.estimate_confidence, snapshot.blockers, snapshot.gaps,
      outbox.get_readiness_goal_delivery_state_v1(
        p_workspace_id, goal.readiness_goal_id, goal.profile_version_id,
        pointer.source_evidence_watermark, pointer.snapshot_id, p_as_of
      ) as delivery_state
    from requested
    join targets.readiness_goals as goal
      on goal.workspace_id = p_workspace_id
     and goal.readiness_goal_id = requested.goal_id
     and goal.profile_version_id = requested.profile_id
    join targets.target_profile_versions as profile
      on profile.profile_version_id = goal.profile_version_id
    left join targets.current_readiness_snapshots as pointer
      on pointer.workspace_id = goal.workspace_id
     and pointer.readiness_goal_id = goal.readiness_goal_id
    left join targets.readiness_snapshots as snapshot
      on snapshot.workspace_id = pointer.workspace_id
     and snapshot.readiness_goal_id = pointer.readiness_goal_id
     and snapshot.snapshot_id = pointer.snapshot_id
  ), normalized as (
    select source.*,
      case
        when source.lifecycle <> 'active' then 'GOAL_INACTIVE'
        when source.delivery_state = 'REBUILDING' then 'REBUILDING'
        when source.delivery_state = 'ERROR' then 'ERROR'
        when source.snapshot_id is null then 'NOT_MATERIALIZED'
        when source.valid_until is not null and p_as_of > source.valid_until then 'STALE'
        else null
      end as unavailable_reason
    from source
  )
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'readinessGoalId', normalized.readiness_goal_id,
    'readinessGoalKey', normalized.readiness_goal_key,
    'profileVersionId', normalized.profile_version_id,
    'profileVersionKey', normalized.profile_version_key,
    'catalogVersionId', normalized.catalog_version_id,
    'revision', 'readiness:' || normalized.goal_version::text || ':' ||
      coalesce(normalized.projection_version::text, '0') || ':' ||
      coalesce(normalized.input_fingerprint, normalized.unavailable_reason, 'NOT_MATERIALIZED'),
    'availability', case when normalized.unavailable_reason is null then 'CURRENT'
      else 'UNAVAILABLE' end,
    'reason', normalized.unavailable_reason,
    'snapshotId', case when normalized.unavailable_reason is null then normalized.snapshot_id end,
    'inputFingerprint', case when normalized.unavailable_reason is null
      then normalized.input_fingerprint end,
    'calculatedAsOf', case when normalized.unavailable_reason is null
      then normalized.calculated_as_of end,
    'validUntil', case when normalized.unavailable_reason is null then normalized.valid_until end,
    'status', case when normalized.unavailable_reason is null then normalized.readiness_status end,
    'coverage', case when normalized.unavailable_reason is null then normalized.coverage end,
    'confidence', case when normalized.unavailable_reason is null
      then normalized.estimate_confidence end,
    'blockers', case when normalized.unavailable_reason is null then (
      select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'code', blocker.value->>'code',
        'ruleKey', blocker.value->>'ruleId'
      ) order by blocker.value->>'code' collate "C", blocker.value->>'ruleId' collate "C"), '[]'::jsonb)
      from pg_catalog.jsonb_array_elements(normalized.blockers) as blocker(value)
    ) else '[]'::jsonb end,
    'gaps', case when normalized.unavailable_reason is null
      then normalized.gaps else '[]'::jsonb end
  ) order by normalized.readiness_goal_key collate "C"), '[]'::jsonb)
  into v_items
  from normalized;
  if pg_catalog.jsonb_array_length(v_items) <> v_count then
    raise exception using errcode = '22023',
      message = 'planning Targets source is not authoritative';
  end if;
  return pg_catalog.jsonb_build_object('items', v_items);
end
$function$;

comment on function targets.read_planning_readiness_source_v1(uuid, uuid[], uuid[], timestamptz)
is 'Returns one minimized readiness input per distinct authoritative Goal/Profile pair, even when multiple Planning Tracks share it.';

reset role;
revoke create on schema targets from pando_phase1_planning_source;

do $roles$
begin
  execute pg_catalog.format(
    'revoke pando_phase1_planning_source from %I',
    current_user
  );
end
$roles$;
