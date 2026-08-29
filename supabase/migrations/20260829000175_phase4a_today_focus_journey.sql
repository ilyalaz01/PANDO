-- Phase 4A C7: safe Today selection preview, Resume, and post-start Focus continuity.
--
-- The browser keeps only the opaque Planning selector. Planning resolves the immutable action for
-- the Sessions owner, and the public boundary returns a display-safe Focus projection rather than
-- the authority-bearing action tuple.

do $roles$
begin
  execute pg_catalog.format(
    'grant pando_planning_api, pando_phase2_api to %I with set true',
    current_user
  );
end
$roles$;

grant create on schema planning to pando_planning_api;
grant create on schema api to pando_phase2_api;

set role pando_planning_api;
create function planning.read_plan_action_selection_for_focus_v1(p_selection_ref text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_workspace_id uuid;
  v_selection planning.plan_action_selections%rowtype;
  v_snapshot planning.plan_snapshots%rowtype;
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

  select selection.* into v_selection
  from planning.plan_action_selections as selection
  where selection.workspace_id = v_workspace_id
    and selection.selection_ref = p_selection_ref;
  if not found then
    raise exception using errcode = '42501', message = 'plan action selection is unavailable';
  end if;
  select snapshot.* into strict v_snapshot
  from planning.plan_snapshots as snapshot
  where snapshot.workspace_id = v_workspace_id
    and snapshot.snapshot_id = v_selection.snapshot_id;

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
    raise exception using errcode = '40001', message = 'plan action selection is unavailable';
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
reset role;

revoke all on function planning.read_plan_action_selection_for_focus_v1(text)
  from public, anon, authenticated, service_role;
grant execute on function planning.read_plan_action_selection_for_focus_v1(text)
  to pando_phase2_api;

set role pando_phase2_api;
create function api.get_focus_from_plan_v1(p_selection_ref text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_workspace_id uuid;
  v_resolved jsonb;
  v_is_current boolean := true;
  v_active sessions.focus_sessions%rowtype;
  v_focus jsonb;
  v_entry_state text;
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

  begin
    v_resolved := planning.resolve_today_action_v1(p_selection_ref);
  exception
    when sqlstate '40001' or sqlstate '42501' then
      v_is_current := false;
      v_resolved := planning.read_plan_action_selection_for_focus_v1(p_selection_ref);
  end;

  select session.* into v_active
  from sessions.focus_sessions as session
  where session.workspace_id = v_workspace_id
    and session.state = 'active'
  order by session.started_at desc, session.focus_session_id desc
  limit 1;

  if v_is_current and v_resolved->>'actionKind' = 'START' then
    if v_active.focus_session_id is not null then
      raise exception using errcode = '40001', message = 'plan action selection is not current';
    end if;
    v_entry_state := 'READY_TO_START';
  elsif v_is_current and v_resolved->>'actionKind' = 'RESUME' then
    if v_active.focus_session_id is null
       or v_active.focus_session_id is distinct from
          nullif(v_resolved->>'focusSessionId', '')::uuid
       or v_active.readiness_goal_key is distinct from v_resolved->>'readinessGoalKey'
       or v_active.activity_key is distinct from v_resolved->>'activityKey' then
      raise exception using errcode = '40001', message = 'plan action selection is not current';
    end if;
    v_entry_state := 'ACTIVE';
  elsif not v_is_current and v_resolved->>'actionKind' = 'START' then
    if v_active.focus_session_id is null
       or v_active.readiness_goal_key is distinct from v_resolved->>'readinessGoalKey'
       or v_active.activity_key is distinct from v_resolved->>'activityKey'
       or v_active.plan_snapshot_id is distinct from
          (v_resolved->>'planSnapshotId')::uuid
       or v_active.plan_candidate_key is distinct from v_resolved->>'candidateKey'
       or v_active.plan_learning_track_id is distinct from
          nullif(v_resolved->>'learningTrackId', '')::uuid then
      raise exception using errcode = '40001', message = 'plan action selection is not current';
    end if;
    v_entry_state := 'ACTIVE';
  else
    raise exception using errcode = '40001', message = 'plan action selection is not current';
  end if;

  v_focus := api.get_focus_workspace_v1(
    v_resolved->>'readinessGoalKey',
    v_resolved->>'activityKey'
  );
  if v_focus->>'readinessGoalKey' is distinct from v_resolved->>'readinessGoalKey'
     or v_focus#>>'{activity,activityKey}' is distinct from v_resolved->>'activityKey'
     or (
       v_entry_state = 'READY_TO_START'
       and v_focus->'activeSession' <> 'null'::jsonb
     )
     or (
       v_entry_state = 'ACTIVE'
       and (
         v_focus#>>'{activeSession,focusSessionId}' is distinct from v_active.focus_session_id::text
         or (v_focus#>>'{activeSession,plannedMinutes}')::smallint
              is distinct from (v_resolved->>'plannedMinutes')::smallint
       )
     ) then
    raise exception using errcode = '40001', message = 'plan action selection is not current';
  end if;

  return pg_catalog.jsonb_build_object(
    'contract', pg_catalog.jsonb_build_object(
      'name', 'FocusFromPlanWorkspaceV1', 'version', '1.0.0'
    ),
    'selectionRef', p_selection_ref,
    'entryState', v_entry_state,
    'plannedMinutes', (v_resolved->>'plannedMinutes')::smallint,
    'workspace', v_focus
  );
end
$function$;
reset role;

revoke all on function api.get_focus_from_plan_v1(text)
  from public, anon, authenticated, service_role;
grant execute on function api.get_focus_from_plan_v1(text) to authenticated;

revoke create on schema planning from pando_planning_api;
revoke create on schema api from pando_phase2_api;
do $roles$
begin
  execute pg_catalog.format(
    'revoke pando_planning_api, pando_phase2_api from %I',
    current_user
  );
end
$roles$;
