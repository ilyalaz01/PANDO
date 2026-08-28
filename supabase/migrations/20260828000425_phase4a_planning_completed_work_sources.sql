-- Phase 4A C4: bounded Sessions and Evidence owner sources for `planning-completed-work/0.1`.
--
-- Planning still reads no other bounded context's private tables. Sessions owns terminal Focus
-- duration facts, Evidence owns whether an attempt is terminal and whether it carries a normalized
-- observation that has not been invalidated. Evidence returns two booleans per session and no
-- observation body, outcome, engagement, competency reference, or correction reason.

do $roles$
begin
  if not exists (
    select 1 from pg_catalog.pg_roles where rolname = 'pando_evidence_planning_source'
  ) then
    execute 'create role pando_evidence_planning_source nologin noinherit nobypassrls';
  end if;
  execute pg_catalog.format(
    'grant pando_evidence_planning_source, pando_phase2_planning_source, pando_planning_worker to %I with set true',
    current_user
  );
end
$roles$;

grant usage on schema evidence to pando_planning_worker, pando_evidence_planning_source;
grant select on evidence.activity_attempts, evidence.observations, evidence.corrections,
  evidence.subject_ledgers to pando_evidence_planning_source;

create policy evidence_planning_source_attempts on evidence.activity_attempts
for select to pando_evidence_planning_source using (true);
create policy evidence_planning_source_observations on evidence.observations
for select to pando_evidence_planning_source using (true);
create policy evidence_planning_source_corrections on evidence.corrections
for select to pando_evidence_planning_source using (true);
create policy evidence_planning_source_subject_ledgers on evidence.subject_ledgers
for select to pando_evidence_planning_source using (true);

grant create on schema sessions to pando_phase2_planning_source;
grant create on schema evidence to pando_evidence_planning_source;
grant create on schema planning to pando_planning_worker;

-- Sessions: terminal Focus duration facts inside the completed-work window.
set role pando_phase2_planning_source;

create function sessions.read_planning_completed_work_source_v1(
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
    'focusSessionId', session.focus_session_id,
    'customActivityId', session.custom_activity_id,
    'activityKey', session.activity_key,
    'readinessGoalKey', session.readiness_goal_key,
    'state', pg_catalog.upper(session.state),
    'startedAt', session.started_at,
    'endedAt', session.ended_at,
    'plannedMinutes', session.planned_minutes
  ) order by session.ended_at, session.focus_session_id), '[]'::jsonb)
  into v_sessions
  from sessions.focus_sessions as session
  where session.workspace_id = p_workspace_id
    and session.state in ('completed', 'stopped')
    and session.ended_at >= p_window_start
    and session.ended_at <= p_as_of;
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

-- The active-Focus source no longer publishes a terminal count: the completed-work source above is
-- the authoritative terminal-session boundary and is bounded by the same persisted claim clock.
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
    'activeFocus', v_active
  );
end
$function$;

revoke all on function sessions.read_planning_completed_work_source_v1(
  uuid, timestamptz, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function sessions.read_planning_completed_work_source_v1(
  uuid, timestamptz, timestamptz
) to pando_planning_worker;

reset role;

-- Evidence: attempt terminality and non-invalidated observation existence only.
set role pando_evidence_planning_source;

create function evidence.read_planning_completed_work_source_v1(
  p_workspace_id uuid,
  p_focus_session_ids uuid[]
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
  v_ledger_version bigint;
begin
  if p_workspace_id is null or p_focus_session_ids is null
     or pg_catalog.cardinality(p_focus_session_ids) > 500
     or pg_catalog.cardinality(p_focus_session_ids) <>
       (select count(distinct value) from pg_catalog.unnest(p_focus_session_ids) as value) then
    raise exception using errcode = '22023', message = 'planning Evidence source input is invalid';
  end if;
  v_requested := pg_catalog.cardinality(p_focus_session_ids);
  select coalesce(ledger.ledger_version, 0) into v_ledger_version
  from (select null) as singleton
  left join evidence.subject_ledgers as ledger on ledger.workspace_id = p_workspace_id;
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
          and not exists (
            select 1 from evidence.corrections as correction
            where correction.workspace_id = observation.workspace_id
              and correction.evidence_id = observation.evidence_id
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
  return pg_catalog.jsonb_build_object(
    'revision', 'evidence-ledger:' || v_ledger_version::text,
    'items', v_items
  );
end
$function$;

revoke all on function evidence.read_planning_completed_work_source_v1(uuid, uuid[])
  from public, anon, authenticated, service_role;
grant execute on function evidence.read_planning_completed_work_source_v1(uuid, uuid[])
  to pando_planning_worker;

reset role;

-- Planning: one claim clock, one window, both new owner sources inside the same bundle fence.
set role pando_planning_worker;

create or replace function planning.load_plan_snapshot_source_bundle_v1(
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
  v_plan planning.growth_plans%rowtype;
  v_calendar jsonb;
  v_tracks jsonb := '[]'::jsonb;
  v_activities jsonb := '[]'::jsonb;
  v_goal_ids uuid[] := array[]::uuid[];
  v_profile_ids uuid[] := array[]::uuid[];
  v_activity_ids uuid[] := array[]::uuid[];
  v_targets jsonb := pg_catalog.jsonb_build_object('items', '[]'::jsonb);
  v_overlay jsonb;
  v_catalog_ids uuid[] := array[]::uuid[];
  v_competencies text[] := array[]::text[];
  v_catalog jsonb := pg_catalog.jsonb_build_object('versions', '[]'::jsonb, 'items', '[]'::jsonb);
  v_focus jsonb;
  v_completed_work jsonb;
  v_work_session_ids uuid[] := array[]::uuid[];
  v_evidence jsonb;
  v_window_start timestamptz;
  v_mastery jsonb;
  v_review jsonb;
  v_visible jsonb;
  v_bundle jsonb;
  v_fence text;
  v_activity jsonb;
  v_target jsonb;
  v_overlay_item jsonb;
begin
  if p_workspace_id is null or p_claim_as_of is null then
    raise exception using errcode = '22023', message = 'planning source bundle input is invalid';
  end if;
  v_calendar := identity.read_planning_calendar_source_v1(p_workspace_id, p_claim_as_of);
  select plan.* into v_plan from planning.growth_plans as plan
  where plan.workspace_id = p_workspace_id and plan.lifecycle in ('active', 'paused');
  if found then
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'trackId', track.learning_track_id,
      'trackKey', track.track_key,
      'title', track.title,
      'version', track.aggregate_version::text,
      'readinessGoalId', track.readiness_goal_id,
      'profileVersionId', track.profile_version_id,
      'lifecycle', pg_catalog.upper(track.lifecycle),
      'priority', track.priority,
      'protectedMinimumMinutes', track.protected_minimum_minutes,
      'defaultSessionMinutes', track.default_session_minutes
    ) order by track.track_key collate "C"), '[]'::jsonb),
      coalesce(pg_catalog.array_agg(track.readiness_goal_id order by track.track_key collate "C"), array[]::uuid[]),
      coalesce(pg_catalog.array_agg(track.profile_version_id order by track.track_key collate "C"), array[]::uuid[])
    into v_tracks, v_goal_ids, v_profile_ids
    from planning.learning_tracks as track
    where track.workspace_id = p_workspace_id and track.growth_plan_id = v_plan.growth_plan_id
      and track.lifecycle <> 'archived';
    if pg_catalog.jsonb_array_length(v_tracks) > 30 then
      raise exception using errcode = '54000', message = 'planning Track source exceeds 30 tracks';
    end if;
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'trackId', activity.learning_track_id,
      'customActivityId', activity.custom_activity_id,
      'candidateKey', activity.candidate_key,
      'estimatedMinutes', activity.estimated_minutes,
      'energy', activity.energy,
      'version', activity.aggregate_version::text
    ) order by activity.candidate_key collate "C"), '[]'::jsonb),
      coalesce(pg_catalog.array_agg(activity.custom_activity_id
        order by activity.candidate_key collate "C"), array[]::uuid[])
    into v_activities, v_activity_ids
    from planning.learning_track_activities as activity
    where activity.workspace_id = p_workspace_id and activity.growth_plan_id = v_plan.growth_plan_id
      and activity.lifecycle = 'active';
    if pg_catalog.jsonb_array_length(v_activities) > 200 then
      raise exception using errcode = '54000', message = 'planning candidate source exceeds 200 items';
    end if;
    v_targets := targets.read_planning_readiness_source_v1(
      p_workspace_id, v_goal_ids, v_profile_ids, p_claim_as_of
    );
  end if;
  v_overlay := overlay.read_planning_candidate_source_v1(p_workspace_id, v_activity_ids);

  for v_activity in select value from pg_catalog.jsonb_array_elements(v_activities) loop
    select value into strict v_overlay_item
    from pg_catalog.jsonb_array_elements(v_overlay->'items')
    where value->>'customActivityId' = v_activity->>'customActivityId';
    select target_item.value into strict v_target
    from pg_catalog.jsonb_array_elements(v_targets->'items') as target_item(value)
    join lateral (
      select track.value from pg_catalog.jsonb_array_elements(v_tracks) as track(value)
      where track.value->>'trackId' = v_activity->>'trackId'
    ) as matched_track
      on target_item.value->>'readinessGoalId' = matched_track.value->>'readinessGoalId';
    v_catalog_ids := pg_catalog.array_append(v_catalog_ids, (v_target->>'catalogVersionId')::uuid);
    v_competencies := pg_catalog.array_append(v_competencies,
      v_overlay_item->>'targetCompetencyRef');
  end loop;
  if pg_catalog.cardinality(v_catalog_ids) > 0 then
    v_catalog := catalog.read_planning_graph_source_v1(v_catalog_ids, v_competencies);
  end if;
  v_focus := sessions.read_planning_focus_source_v1(
    p_workspace_id, (v_calendar->>'weekStart')::timestamptz,
    (v_calendar->>'weekEnd')::timestamptz, p_claim_as_of
  );
  -- 168 elapsed hours, never seven calendar days: a local offset change must not resize the
  -- repetition window. The plan week still bounds every counted minute.
  v_window_start := least(
    (v_calendar->>'weekStart')::timestamptz, p_claim_as_of - interval '168 hours'
  );
  v_completed_work := sessions.read_planning_completed_work_source_v1(
    p_workspace_id, v_window_start, p_claim_as_of
  );
  select coalesce(pg_catalog.array_agg((element.value->>'focusSessionId')::uuid), array[]::uuid[])
  into v_work_session_ids
  from pg_catalog.jsonb_array_elements(v_completed_work->'sessions') as element(value);
  v_evidence := evidence.read_planning_completed_work_source_v1(
    p_workspace_id, v_work_session_ids
  );
  v_mastery := mastery.read_planning_mastery_source_v1(p_workspace_id, v_competencies);
  v_review := review.read_planning_review_source_v1(
    p_workspace_id, v_calendar->>'timeZone', p_claim_as_of
  );
  select coalesce(pg_catalog.jsonb_agg(delivery.delivery_id order by delivery.delivery_id), '[]'::jsonb)
  into v_visible
  from outbox.deliveries as delivery
  join planning.plan_snapshot_delivery_ledger as ledger
    on ledger.delivery_id = delivery.delivery_id and ledger.coverage_state = 'UNCOVERED'
  where delivery.workspace_id = p_workspace_id
    and delivery.consumer_name = 'planning.plan_snapshot_v1'
    and delivery.handler_contract_version = 1
    and delivery.available_at <= p_claim_as_of
    and delivery.delivery_state in ('pending', 'retry', 'leased');
  v_bundle := pg_catalog.jsonb_build_object(
    'claimAsOf', p_claim_as_of,
    'calendar', v_calendar,
    'plan', case when v_plan.growth_plan_id is null then null else pg_catalog.jsonb_build_object(
      'growthPlanId', v_plan.growth_plan_id,
      'title', v_plan.title,
      'lifecycle', pg_catalog.upper(v_plan.lifecycle),
      'weeklyCapacityMinutes', v_plan.weekly_capacity_minutes,
      'version', v_plan.aggregate_version::text,
      'tracks', v_tracks,
      'activities', v_activities
    ) end,
    'targets', v_targets,
    'overlay', v_overlay,
    'catalog', v_catalog,
    'focus', v_focus,
    'completedWork', v_completed_work || pg_catalog.jsonb_build_object(
      'windowStart', v_window_start
    ),
    'evidence', v_evidence,
    'mastery', v_mastery,
    'review', v_review,
    'visibleDeliveryIds', v_visible
  );
  v_fence := pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to(v_bundle::text, 'UTF8'), 'sha256'
  ), 'hex');
  return v_bundle || pg_catalog.jsonb_build_object('sourceFence', 'planning-source:' || v_fence);
end
$function$;

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
