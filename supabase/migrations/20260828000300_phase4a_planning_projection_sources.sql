-- Bounded owner-query boundary for the Phase 4A Planning snapshot projection.
-- Every query receives the attempt's persisted claim clock. Planning never reads another
-- bounded context's private tables directly.

do $roles$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'pando_planning_worker') then
    execute 'create role pando_planning_worker nologin noinherit nobypassrls';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_roles where rolname = 'pando_identity_planning_source'
  ) then
    execute 'create role pando_identity_planning_source nologin noinherit nobypassrls';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_roles where rolname = 'pando_phase1_planning_source'
  ) then
    execute 'create role pando_phase1_planning_source nologin noinherit nobypassrls';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_roles where rolname = 'pando_phase2_planning_source'
  ) then
    execute 'create role pando_phase2_planning_source nologin noinherit nobypassrls';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_roles where rolname = 'pando_review_planning_source'
  ) then
    execute 'create role pando_review_planning_source nologin noinherit nobypassrls';
  end if;
  execute pg_catalog.format(
    'grant pando_identity_planning_source, pando_phase1_planning_source, pando_phase2_planning_source, pando_mastery_worker, pando_readiness_worker, pando_review_planning_source, pando_planning_worker to %I with set true',
    current_user
  );
end
$roles$;

grant usage on schema identity, targets, overlay, catalog, sessions, mastery, review, planning,
  outbox, extensions to pando_planning_worker;
grant usage on schema identity to pando_identity_planning_source;
grant usage on schema targets, overlay, catalog, outbox to pando_phase1_planning_source;
grant usage on schema sessions, extensions to pando_phase2_planning_source;
grant usage on schema review, extensions to pando_review_planning_source;
grant usage on schema extensions to pando_mastery_worker;
grant create on schema identity to pando_identity_planning_source;
grant create on schema targets, overlay, catalog to pando_phase1_planning_source;
grant create on schema sessions to pando_phase2_planning_source;
grant create on schema mastery to pando_mastery_worker;
grant create on schema review to pando_review_planning_source;
grant create on schema planning to pando_planning_worker;
grant execute on function extensions.digest(bytea, text) to pando_planning_worker,
  pando_phase2_planning_source, pando_mastery_worker, pando_review_planning_source;
set role pando_readiness_worker;
grant execute on function outbox.get_readiness_goal_delivery_state_v1(
  uuid, uuid, uuid, bigint, uuid, timestamptz
) to pando_phase1_planning_source;
reset role;

grant select on identity.workspaces to pando_identity_planning_source;
grant select on overlay.workspace_overlays, overlay.custom_activities,
  targets.readiness_goals, targets.target_profile_versions,
  targets.current_readiness_snapshots, targets.readiness_snapshots,
  catalog.competency_edges, catalog.catalog_versions
  to pando_phase1_planning_source;
grant select on sessions.focus_sessions to pando_phase2_planning_source;
grant select on review.subject_ledgers, review.items to pando_review_planning_source;

create policy identity_planning_source_workspaces on identity.workspaces
for select to pando_identity_planning_source using (true);
create policy phase1_planning_source_workspace_overlays on overlay.workspace_overlays
for select to pando_phase1_planning_source using (true);
create policy phase1_planning_source_custom_activities on overlay.custom_activities
for select to pando_phase1_planning_source using (true);
create policy phase1_planning_source_readiness_goals on targets.readiness_goals
for select to pando_phase1_planning_source using (true);
create policy phase1_planning_source_profile_versions on targets.target_profile_versions
for select to pando_phase1_planning_source using (true);
create policy phase1_planning_source_current_readiness on targets.current_readiness_snapshots
for select to pando_phase1_planning_source using (true);
create policy phase1_planning_source_readiness_snapshots on targets.readiness_snapshots
for select to pando_phase1_planning_source using (true);
create policy phase1_planning_source_competency_edges on catalog.competency_edges
for select to pando_phase1_planning_source using (true);
create policy phase1_planning_source_catalog_versions on catalog.catalog_versions
for select to pando_phase1_planning_source using (true);
create policy phase2_planning_source_focus_sessions on sessions.focus_sessions
for select to pando_phase2_planning_source using (true);
create policy review_planning_source_subject_ledgers on review.subject_ledgers
for select to pando_review_planning_source using (true);
create policy review_planning_source_items on review.items
for select to pando_review_planning_source using (true);

create function identity.read_planning_calendar_source_v1(
  p_workspace_id uuid,
  p_as_of timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_time_zone text;
  v_week_start timestamptz;
  v_week_end timestamptz;
begin
  if p_workspace_id is null or p_as_of is null then
    raise exception using errcode = '22023', message = 'planning calendar source input is invalid';
  end if;
  select workspace.time_zone into strict v_time_zone
  from identity.workspaces as workspace
  where workspace.workspace_id = p_workspace_id;
  v_week_start := pg_catalog.date_trunc('week', p_as_of at time zone v_time_zone)
    at time zone v_time_zone;
  v_week_end := (
    pg_catalog.date_trunc('week', p_as_of at time zone v_time_zone) + interval '7 days'
  ) at time zone v_time_zone;
  return pg_catalog.jsonb_build_object(
    'timeZone', v_time_zone,
    'weekStart', v_week_start,
    'weekEnd', v_week_end,
    'validUntil', v_week_end - interval '1 millisecond',
    'fence', 'identity-calendar:' || v_time_zone
  );
end
$function$;

create function overlay.read_planning_candidate_source_v1(
  p_workspace_id uuid,
  p_custom_activity_ids uuid[]
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_requested integer;
  v_revision bigint;
  v_items jsonb;
begin
  if p_workspace_id is null or p_custom_activity_ids is null
     or pg_catalog.cardinality(p_custom_activity_ids) > 200
     or pg_catalog.cardinality(p_custom_activity_ids) < 0
     or pg_catalog.cardinality(p_custom_activity_ids) <>
       (select count(distinct value) from pg_catalog.unnest(p_custom_activity_ids) as value) then
    raise exception using errcode = '22023', message = 'planning Overlay source input is invalid';
  end if;
  v_requested := pg_catalog.cardinality(p_custom_activity_ids);
  select source.aggregate_version into strict v_revision
  from overlay.workspace_overlays as source where source.workspace_id = p_workspace_id;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'customActivityId', activity.custom_activity_id,
    'activityKey', activity.activity_key,
    'title', activity.title,
    'targetCompetencyRef', activity.target_competency_ref,
    'dimension', activity.evidence_dimension
  ) order by activity.activity_key collate "C"), '[]'::jsonb)
  into v_items
  from overlay.custom_activities as activity
  where activity.workspace_id = p_workspace_id
    and activity.custom_activity_id = any(p_custom_activity_ids)
    and activity.lifecycle = 'active'
    and activity.mapping_status = 'accepted';
  if pg_catalog.jsonb_array_length(v_items) <> v_requested then
    raise exception using errcode = '22023',
      message = 'planning Overlay source is not authoritative';
  end if;
  return pg_catalog.jsonb_build_object(
    'revision', 'workspace-overlay:' || v_revision::text,
    'items', v_items
  );
end
$function$;

create function targets.read_planning_readiness_source_v1(
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
     or pg_catalog.cardinality(p_readiness_goal_ids) < 1 then
    raise exception using errcode = '22023', message = 'planning Targets source input is invalid';
  end if;
  v_count := pg_catalog.cardinality(p_readiness_goal_ids);

  with requested as (
    select goal_id, profile_id, ordinal
    from rows from (
      pg_catalog.unnest(p_readiness_goal_ids),
      pg_catalog.unnest(p_profile_version_ids)
    ) with ordinality as value(goal_id, profile_id, ordinal)
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
    'blockers', case when normalized.unavailable_reason is null
      then normalized.blockers else '[]'::jsonb end,
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

create function catalog.read_planning_graph_source_v1(
  p_catalog_version_ids uuid[],
  p_competency_refs text[]
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_items jsonb;
  v_versions jsonb;
begin
  if p_catalog_version_ids is null or p_competency_refs is null
     or pg_catalog.cardinality(p_catalog_version_ids) <> pg_catalog.cardinality(p_competency_refs)
     or pg_catalog.cardinality(p_catalog_version_ids) > 200 then
    raise exception using errcode = '22023', message = 'planning Catalog source input is invalid';
  end if;
  with requested as (
    select version_id, competency_ref, ordinal
    from rows from (
      pg_catalog.unnest(p_catalog_version_ids),
      pg_catalog.unnest(p_competency_refs)
    ) with ordinality as value(version_id, competency_ref, ordinal)
  )
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'catalogVersionId', requested.version_id,
    'competencyRef', requested.competency_ref,
    'prerequisiteCount', (
      select count(*) from catalog.competency_edges as edge
      where edge.catalog_version_id = requested.version_id
        and edge.to_competency_key = requested.competency_ref and edge.blocking
    ),
    'unlockCount', least(20, (
      select count(*) from catalog.competency_edges as edge
      where edge.catalog_version_id = requested.version_id
        and edge.from_competency_key = requested.competency_ref and edge.blocking
    ))
  ) order by requested.version_id, requested.competency_ref collate "C"), '[]'::jsonb)
  into v_items from requested;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'catalogVersionId', version.catalog_version_id,
    'catalogVersionKey', version.catalog_version_key,
    'versionNumber', version.version_number
  ) order by version.catalog_version_key collate "C"), '[]'::jsonb)
  into v_versions
  from catalog.catalog_versions as version
  where version.catalog_version_id = any(p_catalog_version_ids)
    and version.lifecycle in ('published', 'retired');
  if (select count(distinct value) from pg_catalog.unnest(p_catalog_version_ids) as value)
     <> pg_catalog.jsonb_array_length(v_versions) then
    raise exception using errcode = '22023', message = 'planning Catalog source is not authoritative';
  end if;
  return pg_catalog.jsonb_build_object('versions', v_versions, 'items', v_items);
end
$function$;

create function sessions.read_planning_focus_source_v1(
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

create function mastery.read_planning_mastery_source_v1(
  p_workspace_id uuid,
  p_competency_refs text[]
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_revision text;
begin
  if p_workspace_id is null or p_competency_refs is null
     or pg_catalog.cardinality(p_competency_refs) > 200 then
    raise exception using errcode = '22023', message = 'planning Mastery source input is invalid';
  end if;
  select pg_catalog.encode(extensions.digest(pg_catalog.convert_to(coalesce(
    pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
      source.competency_ref, source.snapshot_id, source.input_watermark,
      source.projection_version
    ) order by source.competency_ref collate "C")::text, '[]'), 'UTF8'), 'sha256'), 'hex')
  into v_revision
  from mastery.current_competency_states as source
  where source.workspace_id = p_workspace_id
    and source.competency_ref = any(p_competency_refs);
  return pg_catalog.jsonb_build_object('revision', 'mastery-scope:' || v_revision);
end
$function$;

create function review.read_planning_review_source_v1(
  p_workspace_id uuid,
  p_time_zone text,
  p_as_of timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_next_midnight timestamptz;
  v_projection_state text;
  v_due_count integer;
  v_items jsonb;
  v_valid_until timestamptz;
  v_revision text;
begin
  if p_workspace_id is null or p_time_zone is null or p_as_of is null then
    raise exception using errcode = '22023', message = 'planning Review source input is invalid';
  end if;
  v_next_midnight := (
    pg_catalog.date_trunc('day', p_as_of at time zone p_time_zone) + interval '1 day'
  ) at time zone p_time_zone;
  select case
    when exists (
      select 1 from review.subject_ledgers as subject
      left join review.items as item on item.workspace_id = subject.workspace_id
        and item.subject_id = subject.subject_id
      where subject.workspace_id = p_workspace_id
        and (item.subject_id is null or item.input_watermark < subject.input_watermark)
    ) then 'PENDING'
    when exists (select 1 from review.items where workspace_id = p_workspace_id) then 'CURRENT'
    else 'NOT_STARTED'
  end into v_projection_state;
  select count(*) into v_due_count
  from review.items as item
  where item.workspace_id = p_workspace_id and item.has_active_reasons
    and item.effective_due_at < v_next_midnight;
  if v_due_count > 100 then
    raise exception using errcode = '54000', message = 'planning Review source exceeds 100 items';
  end if;
  if v_projection_state = 'CURRENT' then
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'reviewItemId', item.subject_id,
      'readinessGoalKey', item.readiness_goal_key,
      'activityKey', item.activity_key,
      'bucket', case when item.effective_due_at < p_as_of then 'OVERDUE' else 'DUE_TODAY' end,
      'dueAt', item.effective_due_at
    ) order by item.effective_due_at, item.subject_ref collate "C", item.subject_id), '[]'::jsonb)
    into v_items
    from review.items as item
    where item.workspace_id = p_workspace_id and item.has_active_reasons
      and item.effective_due_at < v_next_midnight
      and item.activity_key is not null and item.readiness_goal_key is not null;
    select least(
      v_next_midnight - interval '1 millisecond',
      coalesce(min(item.effective_due_at) filter (where item.effective_due_at >= p_as_of),
        v_next_midnight - interval '1 millisecond')
    ) into v_valid_until
    from review.items as item
    where item.workspace_id = p_workspace_id and item.has_active_reasons
      and item.effective_due_at < v_next_midnight;
  else
    v_items := '[]'::jsonb;
    v_valid_until := null;
  end if;
  select pg_catalog.encode(extensions.digest(pg_catalog.convert_to(coalesce(
    pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
      subject.subject_id, subject.input_watermark, item.snapshot_id,
      item.projection_version, item.effective_due_at, item.has_active_reasons
    ) order by subject.subject_id)::text, '[]'), 'UTF8'), 'sha256'), 'hex')
  into v_revision
  from review.subject_ledgers as subject
  left join review.items as item on item.workspace_id = subject.workspace_id
    and item.subject_id = subject.subject_id
  where subject.workspace_id = p_workspace_id;
  return pg_catalog.jsonb_build_object(
    'revision', 'review-scope:' || v_revision,
    'projectionState', v_projection_state,
    'overdueCount', case when v_projection_state = 'CURRENT' then (
      select count(*) from review.items as item where item.workspace_id = p_workspace_id
        and item.has_active_reasons and item.effective_due_at < p_as_of
    ) else 0 end,
    'dueTodayCount', case when v_projection_state = 'CURRENT' then (
      select count(*) from review.items as item where item.workspace_id = p_workspace_id
        and item.has_active_reasons and item.effective_due_at >= p_as_of
        and item.effective_due_at < v_next_midnight
    ) else 0 end,
    'validUntil', v_valid_until,
    'items', v_items
  );
end
$function$;

alter function identity.read_planning_calendar_source_v1(uuid, timestamptz)
  owner to pando_identity_planning_source;
alter function overlay.read_planning_candidate_source_v1(uuid, uuid[])
  owner to pando_phase1_planning_source;
alter function targets.read_planning_readiness_source_v1(uuid, uuid[], uuid[], timestamptz)
  owner to pando_phase1_planning_source;
alter function catalog.read_planning_graph_source_v1(uuid[], text[])
  owner to pando_phase1_planning_source;
alter function sessions.read_planning_focus_source_v1(uuid, timestamptz, timestamptz, timestamptz)
  owner to pando_phase2_planning_source;
alter function mastery.read_planning_mastery_source_v1(uuid, text[])
  owner to pando_mastery_worker;
alter function review.read_planning_review_source_v1(uuid, text, timestamptz)
  owner to pando_review_planning_source;

revoke create on schema identity from pando_identity_planning_source;
revoke create on schema targets, overlay, catalog from pando_phase1_planning_source;
revoke create on schema sessions from pando_phase2_planning_source;
revoke create on schema mastery from pando_mastery_worker;
revoke create on schema review from pando_review_planning_source;
revoke create on schema planning from pando_planning_worker;
revoke all on function identity.read_planning_calendar_source_v1(uuid, timestamptz),
  overlay.read_planning_candidate_source_v1(uuid, uuid[]),
  targets.read_planning_readiness_source_v1(uuid, uuid[], uuid[], timestamptz),
  catalog.read_planning_graph_source_v1(uuid[], text[]),
  sessions.read_planning_focus_source_v1(uuid, timestamptz, timestamptz, timestamptz),
  mastery.read_planning_mastery_source_v1(uuid, text[]),
  review.read_planning_review_source_v1(uuid, text, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function identity.read_planning_calendar_source_v1(uuid, timestamptz),
  overlay.read_planning_candidate_source_v1(uuid, uuid[]),
  targets.read_planning_readiness_source_v1(uuid, uuid[], uuid[], timestamptz),
  catalog.read_planning_graph_source_v1(uuid[], text[]),
  sessions.read_planning_focus_source_v1(uuid, timestamptz, timestamptz, timestamptz),
  mastery.read_planning_mastery_source_v1(uuid, text[]),
  review.read_planning_review_source_v1(uuid, text, timestamptz)
  to pando_planning_worker;

do $roles$
begin
  execute pg_catalog.format(
    'revoke pando_identity_planning_source, pando_phase1_planning_source, pando_phase2_planning_source, pando_mastery_worker, pando_readiness_worker, pando_review_planning_source, pando_planning_worker from %I',
    current_user
  );
end
$roles$;
