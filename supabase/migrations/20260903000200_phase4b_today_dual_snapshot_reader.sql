-- Phase 4B D2c fail-closed Today reader for exact V1/V2 calculation tuples.

do $membership$
begin
  execute pg_catalog.format(
    'grant pando_today_reader to %I with set true',
    current_user
  );
end
$membership$;

grant create on schema planning to pando_today_reader;
set role pando_today_reader;

alter function planning.read_today_workspace_v1(uuid, timestamptz)
  rename to read_today_workspace_pre_dual_snapshot_v1;

revoke all on function planning.read_today_workspace_pre_dual_snapshot_v1(uuid, timestamptz)
  from public, anon, authenticated, service_role, pando_planning_api;

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
  v_result jsonb;
  v_snapshot_id uuid;
  v_tuple_valid boolean := false;
begin
  v_result := planning.read_today_workspace_pre_dual_snapshot_v1(
    p_workspace_id, p_query_as_of
  );

  if v_result->'snapshot' is null or pg_catalog.jsonb_typeof(v_result->'snapshot') = 'null' then
    return v_result;
  end if;

  v_snapshot_id := (v_result#>>'{snapshot,snapshotId}')::uuid;
  select (
    pointer.snapshot_id = v_snapshot_id
    and attempt.attempt_state = 'APPLIED'
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
    )
  )
  into v_tuple_valid
  from planning.current_plan_snapshots as pointer
  join planning.plan_snapshots as snapshot
    on snapshot.workspace_id = pointer.workspace_id
   and snapshot.snapshot_id = pointer.snapshot_id
  join planning.plan_snapshot_attempts as attempt
    on attempt.workspace_id = pointer.workspace_id
   and attempt.attempt_id = pointer.applied_attempt_id
  where pointer.workspace_id = p_workspace_id;

  if coalesce(v_tuple_valid, false) then
    return v_result;
  end if;

  return pg_catalog.jsonb_set(
    pg_catalog.jsonb_set(
      pg_catalog.jsonb_set(
        pg_catalog.jsonb_set(
          pg_catalog.jsonb_set(
            pg_catalog.jsonb_set(
              v_result,
              '{projectionState}',
              pg_catalog.to_jsonb('ERROR'::text),
              false
            ),
            '{reason}',
            pg_catalog.to_jsonb('CALCULATION_FAILED'::text),
            false
          ),
          '{lastKnownSafe}',
          'false'::jsonb,
          false
        ),
        '{currentInputFingerprint}',
        'null'::jsonb,
        false
      ),
      '{snapshot}',
      'null'::jsonb,
      false
    ),
    '{actionSelections}',
    '[]'::jsonb,
    false
  ) || pg_catalog.jsonb_build_object(
    'context', pg_catalog.jsonb_build_object('nearestDeadline', null)
  );
end
$function$;

revoke all on function planning.read_today_workspace_v1(uuid, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function planning.read_today_workspace_v1(uuid, timestamptz)
  to pando_planning_api;

reset role;
revoke create on schema planning from pando_today_reader;

do $membership$
begin
  execute pg_catalog.format(
    'revoke pando_today_reader from %I',
    current_user
  );
end
$membership$;
