-- Phase 4A C4 forward hardening.
--
-- Migration 20260828000425 was already committed and exercised before independent review. Keep it
-- immutable and apply every correction forward so upgraded and clean databases converge.

do $roles$
begin
  execute pg_catalog.format(
    'grant pando_evidence_planning_source, pando_phase2_planning_source, pando_planning_worker to %I with set true',
    current_user
  );
end
$roles$;

grant create on schema sessions to pando_phase2_planning_source;
grant create on schema evidence to pando_evidence_planning_source;
grant create on schema planning to pando_planning_worker;
grant usage on schema extensions to pando_evidence_planning_source;

create index focus_sessions_workspace_terminal_ended
  on sessions.focus_sessions (workspace_id, ended_at, focus_session_id)
  where state in ('completed', 'stopped');

-- Replace table-wide Evidence reads with the exact columns required for terminal/evidence-bearing
-- classification. The existing forced-RLS policies continue to apply.
revoke select on evidence.activity_attempts, evidence.observations, evidence.corrections,
  evidence.subject_ledgers from pando_evidence_planning_source;
grant select (workspace_id, focus_session_id, activity_attempt_id, state)
  on evidence.activity_attempts to pando_evidence_planning_source;
grant select (workspace_id, activity_attempt_id, evidence_id, recorded_at)
  on evidence.observations to pando_evidence_planning_source;
grant select (workspace_id, evidence_id, recorded_at)
  on evidence.corrections to pando_evidence_planning_source;
grant select (workspace_id, ledger_version)
  on evidence.subject_ledgers to pando_evidence_planning_source;

set role pando_phase2_planning_source;

-- Bound database work before aggregation by reading at most the refusal sentinel of 501 rows.
create or replace function sessions.read_planning_completed_work_source_v1(
  p_workspace_id uuid,
  p_window_start timestamptz,
  p_as_of timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_sessions jsonb;
  v_revision text;
begin
  if p_workspace_id is null or p_window_start is null or p_as_of is null
     or p_window_start > p_as_of then
    raise exception using errcode = '22023',
      message = 'planning completed-work source input is invalid';
  end if;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'focusSessionId', bounded.focus_session_id,
    'customActivityId', bounded.custom_activity_id,
    'activityKey', bounded.activity_key,
    'readinessGoalKey', bounded.readiness_goal_key,
    'state', pg_catalog.upper(bounded.state),
    'startedAt', bounded.started_at,
    'endedAt', bounded.ended_at,
    'plannedMinutes', bounded.planned_minutes
  ) order by bounded.ended_at, bounded.focus_session_id), '[]'::jsonb)
  into v_sessions
  from (
    select session.focus_session_id, session.custom_activity_id, session.activity_key,
      session.readiness_goal_key, session.state, session.started_at, session.ended_at,
      session.planned_minutes
    from sessions.focus_sessions as session
    where session.workspace_id = p_workspace_id
      and session.state in ('completed', 'stopped')
      and session.ended_at >= p_window_start
      and session.ended_at <= p_as_of
    order by session.ended_at, session.focus_session_id
    limit 501
  ) as bounded;
  if pg_catalog.jsonb_array_length(v_sessions) > 500 then
    raise exception using errcode = '54000',
      message = 'planning completed-work source exceeds 500 sessions';
  end if;
  v_revision := pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to(v_sessions::text, 'UTF8'), 'sha256'
  ), 'hex');
  return pg_catalog.jsonb_build_object(
    'revision', 'completed-work:' || v_revision,
    'sessions', v_sessions
  );
end
$function$;

-- Preserve the v1 result field required by an older worker during expand/contract rollout. New
-- workers ignore terminalCount and use the bounded completed-work source.
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
    'planAttribution', null
  ) end into v_active
  from (select null) as singleton
  left join sessions.focus_sessions as session
    on session.workspace_id = p_workspace_id and session.state = 'active';
  select count(*) into v_terminal_count
  from sessions.focus_sessions as session
  where session.workspace_id = p_workspace_id and session.state in ('completed', 'stopped')
    and session.ended_at >= p_week_start and session.ended_at < p_week_end;
  select pg_catalog.encode(extensions.digest(pg_catalog.convert_to(coalesce(
    pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
      session.focus_session_id, session.aggregate_version, session.state,
      session.started_at, session.ended_at
    ) order by session.focus_session_id)::text, '[]'), 'UTF8'), 'sha256'), 'hex')
  into v_revision
  from sessions.focus_sessions as session
  where session.workspace_id = p_workspace_id
    and (session.state = 'active' or (session.ended_at >= p_week_start and session.ended_at < p_week_end));
  return pg_catalog.jsonb_build_object(
    'revision', 'focus-scope:' || v_revision,
    'terminalCount', v_terminal_count,
    'activeFocus', v_active
  );
end
$function$;

reset role;
set role pando_evidence_planning_source;

-- v2 makes the claim clock explicit; retaining v1 lets the pre-hardening bundle remain callable
-- only as an implementation detail of the forward-compatible wrapper below.
create function evidence.read_planning_completed_work_source_v2(
  p_workspace_id uuid,
  p_focus_session_ids uuid[],
  p_as_of timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_requested integer;
  v_items jsonb;
  v_revision text;
begin
  if p_workspace_id is null or p_focus_session_ids is null or p_as_of is null
     or pg_catalog.cardinality(p_focus_session_ids) > 500
     or pg_catalog.cardinality(p_focus_session_ids) <>
       (select count(distinct value) from pg_catalog.unnest(p_focus_session_ids) as value) then
    raise exception using errcode = '22023', message = 'planning Evidence source input is invalid';
  end if;
  v_requested := pg_catalog.cardinality(p_focus_session_ids);
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'focusSessionId', source.focus_session_id,
    'attemptTerminal', source.attempt_terminal,
    'evidenceBearing', source.evidence_bearing
  ) order by source.focus_session_id), '[]'::jsonb)
  into v_items
  from (
    select attempt.focus_session_id,
      attempt.state in ('completed', 'stopped') as attempt_terminal,
      exists (
        select 1 from evidence.observations as observation
        where observation.workspace_id = attempt.workspace_id
          and observation.activity_attempt_id = attempt.activity_attempt_id
          and observation.recorded_at <= p_as_of
          and not exists (
            select 1 from evidence.corrections as correction
            where correction.workspace_id = observation.workspace_id
              and correction.evidence_id = observation.evidence_id
              and correction.recorded_at <= p_as_of
          )
      ) as evidence_bearing
    from evidence.activity_attempts as attempt
    where attempt.workspace_id = p_workspace_id
      and attempt.focus_session_id = any(p_focus_session_ids)
  ) as source;
  if pg_catalog.jsonb_array_length(v_items) <> v_requested then
    raise exception using errcode = '22023',
      message = 'planning Evidence source is not authoritative';
  end if;
  v_revision := pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to(v_items::text, 'UTF8'), 'sha256'
  ), 'hex');
  return pg_catalog.jsonb_build_object(
    'revision', 'evidence-completed-work:' || v_revision,
    'items', v_items
  );
end
$function$;

revoke all on function evidence.read_planning_completed_work_source_v2(uuid, uuid[], timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function evidence.read_planning_completed_work_source_v2(uuid, uuid[], timestamptz)
  to pando_planning_worker;

reset role;
set role pando_planning_worker;

-- Keep the original bundle implementation intact under a private compatibility name, then wrap it
-- to replace only the Evidence answer and recompute the covering source fence.
alter function planning.load_plan_snapshot_source_bundle_v1(uuid, timestamptz)
  rename to load_plan_snapshot_source_bundle_pre_evidence_claim_v1;

create function planning.load_plan_snapshot_source_bundle_v1(
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
  v_work_session_ids uuid[];
  v_evidence jsonb;
  v_fence text;
begin
  if p_workspace_id is null or p_claim_as_of is null then
    raise exception using errcode = '22023', message = 'planning source bundle input is invalid';
  end if;
  v_bundle := planning.load_plan_snapshot_source_bundle_pre_evidence_claim_v1(
    p_workspace_id, p_claim_as_of
  );
  select coalesce(pg_catalog.array_agg((element.value->>'focusSessionId')::uuid), array[]::uuid[])
  into v_work_session_ids
  from pg_catalog.jsonb_array_elements(v_bundle#>'{completedWork,sessions}') as element(value);
  v_evidence := evidence.read_planning_completed_work_source_v2(
    p_workspace_id, v_work_session_ids, p_claim_as_of
  );
  v_bundle := (v_bundle - 'sourceFence') || pg_catalog.jsonb_build_object(
    'evidence', v_evidence
  );
  v_fence := pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to(v_bundle::text, 'UTF8'), 'sha256'
  ), 'hex');
  return v_bundle || pg_catalog.jsonb_build_object('sourceFence', 'planning-source:' || v_fence);
end
$function$;

revoke all on function planning.load_plan_snapshot_source_bundle_v1(uuid, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function planning.load_plan_snapshot_source_bundle_v1(uuid, timestamptz)
  to pando_planning_worker;

reset role;

revoke create on schema sessions from pando_phase2_planning_source;
revoke create on schema evidence from pando_evidence_planning_source;
revoke create on schema planning from pando_planning_worker;

do $roles$
begin
  execute pg_catalog.format(
    'revoke pando_evidence_planning_source, pando_phase2_planning_source, pando_planning_worker from %I',
    current_user
  );
end
$roles$;
