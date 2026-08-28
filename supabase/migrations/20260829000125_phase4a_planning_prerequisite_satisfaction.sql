-- Phase 4A C5: exact direct Catalog prerequisites plus a Mastery-owned, claim-scoped tri-state
-- classification. Planning composes the bounded answers and never reads either owner's tables.

do $roles$
begin
  if not exists (
    select 1 from pg_catalog.pg_roles where rolname = 'pando_mastery_planning_source'
  ) then
    execute 'create role pando_mastery_planning_source nologin noinherit nobypassrls';
  end if;
  execute pg_catalog.format(
    'grant pando_phase1_planning_source, pando_mastery_planning_source, pando_planning_worker to %I with set true',
    current_user
  );
end
$roles$;

grant usage on schema catalog, overlay, targets, extensions to pando_phase1_planning_source;
grant usage on schema mastery, extensions to pando_mastery_planning_source;
grant create on schema catalog, overlay to pando_phase1_planning_source;
grant create on schema mastery to pando_mastery_planning_source;
grant create on schema planning to pando_planning_worker;
grant execute on function extensions.digest(bytea, text)
  to pando_phase1_planning_source, pando_mastery_planning_source;

-- The older source role was granted whole Catalog tables in C2. Preserve both v1 and v2 while
-- minimizing that access to the exact columns they read.
revoke select on catalog.competency_edges, catalog.catalog_versions
  from pando_phase1_planning_source;
grant select (catalog_version_id, from_competency_key, to_competency_key, edge_type, blocking)
  on catalog.competency_edges to pando_phase1_planning_source;
grant select (catalog_version_id, catalog_version_key, version_number, lifecycle)
  on catalog.catalog_versions to pando_phase1_planning_source;
grant select (catalog_version_id, item_key, item_type, lifecycle)
  on catalog.items to pando_phase1_planning_source;
grant select (workspace_id, competency_key, lifecycle)
  on overlay.personal_competencies to pando_phase1_planning_source;

create policy catalog_items_planning_origin_read on catalog.items
for select to pando_phase1_planning_source using (true);
create policy personal_competencies_planning_origin_read on overlay.personal_competencies
for select to pando_phase1_planning_source using (true);

grant select (
  workspace_id, competency_ref, snapshot_id, input_watermark, projection_version, updated_at
) on mastery.current_competency_states to pando_mastery_planning_source;
grant select (
  snapshot_id, workspace_id, competency_ref, projection_generation, input_watermark,
  engine_version, policy_version, calculated_as_of, achievement_level, state, created_at
) on mastery.competency_state_snapshots to pando_mastery_planning_source;

create policy mastery_current_planning_source_read on mastery.current_competency_states
for select to pando_mastery_planning_source using (true);
create policy mastery_snapshots_planning_source_read on mastery.competency_state_snapshots
for select to pando_mastery_planning_source using (true);

create index competency_edges_planning_prerequisite_lookup
  on catalog.competency_edges (
    catalog_version_id, to_competency_key, from_competency_key
  )
  where edge_type = 'PREREQUISITE_OF' and blocking;

create index competency_edges_planning_unlock_lookup
  on catalog.competency_edges (
    catalog_version_id, from_competency_key, to_competency_key
  )
  where edge_type = 'PREREQUISITE_OF' and blocking;

set role pando_phase1_planning_source;

-- A text competency reference is not enough to choose between a canonical item and a distinct
-- workspace-owned personal competency. Existing/imported collision rows therefore fail closed
-- before Planning can apply canonical edges to an ambiguous custom activity.
create function overlay.assert_planning_candidate_origins_v1(
  p_workspace_id uuid,
  p_custom_activity_ids uuid[]
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_requested integer;
begin
  if p_workspace_id is null or p_custom_activity_ids is null
     or pg_catalog.cardinality(p_custom_activity_ids) > 200
     or pg_catalog.cardinality(p_custom_activity_ids) <>
       (select count(distinct value) from pg_catalog.unnest(p_custom_activity_ids) as value)
     or exists (
       select 1 from pg_catalog.unnest(p_custom_activity_ids) as value where value is null
     ) then
    raise exception using errcode = '22023',
      message = 'planning candidate origin input is invalid';
  end if;
  v_requested := pg_catalog.cardinality(p_custom_activity_ids);
  if (
    select count(*) from overlay.custom_activities as activity
    where activity.workspace_id = p_workspace_id
      and activity.custom_activity_id = any(p_custom_activity_ids)
      and activity.lifecycle = 'active' and activity.mapping_status = 'accepted'
  ) <> v_requested then
    raise exception using errcode = '22023',
      message = 'planning candidate origin source is not authoritative';
  end if;
  if exists (
    select 1
    from overlay.custom_activities as activity
    join targets.target_profile_versions as profile
      on profile.profile_version_id = activity.profile_version_id
    join catalog.items as canonical
      on canonical.catalog_version_id = profile.catalog_version_id
      and canonical.item_key = activity.target_competency_ref
      and canonical.item_type = 'COMPETENCY'
    join overlay.personal_competencies as personal
      on personal.workspace_id = activity.workspace_id
      and personal.competency_key = activity.target_competency_ref
      and personal.lifecycle = 'accepted'
    where activity.workspace_id = p_workspace_id
      and activity.custom_activity_id = any(p_custom_activity_ids)
      and activity.lifecycle = 'active' and activity.mapping_status = 'accepted'
  ) then
    raise exception using errcode = '22023',
      message = 'planning candidate competency origin is ambiguous';
  end if;
  if exists (
    select 1
    from overlay.custom_activities as activity
    join targets.target_profile_versions as profile
      on profile.profile_version_id = activity.profile_version_id
    left join catalog.items as canonical
      on canonical.catalog_version_id = profile.catalog_version_id
      and canonical.item_key = activity.target_competency_ref
      and canonical.item_type = 'COMPETENCY'
    left join overlay.personal_competencies as personal
      on personal.workspace_id = activity.workspace_id
      and personal.competency_key = activity.target_competency_ref
      and personal.lifecycle = 'accepted'
    where activity.workspace_id = p_workspace_id
      and activity.custom_activity_id = any(p_custom_activity_ids)
      and activity.lifecycle = 'active' and activity.mapping_status = 'accepted'
      and canonical.item_key is null and personal.competency_key is null
  ) then
    raise exception using errcode = '22023',
      message = 'planning candidate competency origin is unavailable';
  end if;
end
$function$;

revoke all on function overlay.assert_planning_candidate_origins_v1(uuid, uuid[])
  from public, anon, authenticated, service_role;
grant execute on function overlay.assert_planning_candidate_origins_v1(uuid, uuid[])
  to pando_planning_worker;

create function catalog.read_planning_graph_source_v2(
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
  v_item record;
  v_prerequisites text[];
  v_all_prerequisites text[] := array[]::text[];
  v_items jsonb := '[]'::jsonb;
  v_versions jsonb;
begin
  if p_catalog_version_ids is null or p_competency_refs is null
     or pg_catalog.cardinality(p_catalog_version_ids) <> pg_catalog.cardinality(p_competency_refs)
     or pg_catalog.cardinality(p_catalog_version_ids) > 200
     or exists (
       select 1 from rows from (
         pg_catalog.unnest(p_catalog_version_ids), pg_catalog.unnest(p_competency_refs)
       ) as input(version_id, competency_ref)
       where input.version_id is null or input.competency_ref is null
         or input.competency_ref !~ '^competency:[a-z0-9][a-z0-9-]{1,100}$'
     ) then
    raise exception using errcode = '22023', message = 'planning Catalog source input is invalid';
  end if;

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

  for v_item in
    select requested.version_id, requested.competency_ref
    from (
      select distinct input.version_id, input.competency_ref
      from rows from (
        pg_catalog.unnest(p_catalog_version_ids), pg_catalog.unnest(p_competency_refs)
      ) as input(version_id, competency_ref)
    ) as requested
    order by requested.version_id, requested.competency_ref collate "C"
  loop
    select coalesce(pg_catalog.array_agg(edge.from_competency_key
      order by edge.from_competency_key collate "C"), array[]::text[])
    into v_prerequisites
    from (
      select candidate.from_competency_key
      from catalog.competency_edges as candidate
      where candidate.catalog_version_id = v_item.version_id
        and candidate.to_competency_key = v_item.competency_ref
        and candidate.edge_type = 'PREREQUISITE_OF' and candidate.blocking
      limit 21
    ) as edge;
    if pg_catalog.cardinality(v_prerequisites) > 20 then
      raise exception using errcode = '54000',
        message = 'planning candidate exceeds 20 direct prerequisites';
    end if;
    v_all_prerequisites := v_all_prerequisites || v_prerequisites;
    v_items := v_items || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'catalogVersionId', v_item.version_id,
      'competencyRef', v_item.competency_ref,
      'prerequisiteCount', pg_catalog.cardinality(v_prerequisites),
      'prerequisiteRefs', pg_catalog.to_jsonb(v_prerequisites),
      'unlockCount', (
        select count(*) from (
          select 1 from catalog.competency_edges as candidate
          where candidate.catalog_version_id = v_item.version_id
            and candidate.from_competency_key = v_item.competency_ref
            and candidate.edge_type = 'PREREQUISITE_OF' and candidate.blocking
          limit 20
        ) as bounded_unlocks
      )
    ));
  end loop;
  if (
    select count(distinct value) from pg_catalog.unnest(v_all_prerequisites) as value
  ) > 500 then
    raise exception using errcode = '54000',
      message = 'planning source exceeds 500 distinct prerequisites';
  end if;
  return pg_catalog.jsonb_build_object('versions', v_versions, 'items', v_items);
end
$function$;

revoke all on function catalog.read_planning_graph_source_v2(uuid[], text[])
  from public, anon, authenticated, service_role;
grant execute on function catalog.read_planning_graph_source_v2(uuid[], text[])
  to pando_planning_worker;

reset role;
set role pando_mastery_planning_source;

-- Bounded, privacy-minimized source for the pure TypeScript prerequisite classifier. Evidence
-- identifiers, explanations, and unneeded Mastery payload fields never cross this boundary.
create function mastery.read_planning_prerequisite_source_v1(
  p_workspace_id uuid,
  p_competency_refs text[],
  p_as_of timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_items jsonb;
  v_revision text;
begin
  if p_workspace_id is null or p_competency_refs is null or p_as_of is null
     or pg_catalog.cardinality(p_competency_refs) > 500
     or pg_catalog.cardinality(p_competency_refs) <>
       (select count(distinct value) from pg_catalog.unnest(p_competency_refs) as value)
     or exists (
       select 1 from pg_catalog.unnest(p_competency_refs) as value
       where value is null or value !~ '^competency:[a-z0-9][a-z0-9-]{1,100}$'
     ) then
    raise exception using errcode = '22023', message = 'planning Mastery source input is invalid';
  end if;

  with requested as (
    select value as competency_ref from pg_catalog.unnest(p_competency_refs) as value
  ), source as (
    select requested.competency_ref, current.snapshot_id, current.input_watermark,
      current.projection_version, current.updated_at, snapshot.projection_generation,
      snapshot.engine_version, snapshot.policy_version, snapshot.calculated_as_of,
      snapshot.created_at, snapshot.state
    from requested
    left join mastery.current_competency_states as current
      on current.workspace_id = p_workspace_id
      and current.competency_ref = requested.competency_ref
    left join mastery.competency_state_snapshots as snapshot
      on snapshot.workspace_id = current.workspace_id
      and snapshot.competency_ref = current.competency_ref
      and snapshot.snapshot_id = current.snapshot_id
  )
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'competencyRef', source.competency_ref,
    'projectionFence', case when source.snapshot_id is null then 'not-materialized' else
      source.snapshot_id::text || ':' || source.input_watermark::text || ':' ||
      source.projection_version::text end,
    'projection', case when source.snapshot_id is null then null else pg_catalog.jsonb_build_object(
      'snapshotId', source.snapshot_id,
      'pointerInputWatermark', source.input_watermark::text,
      'pointerProjectionVersion', source.projection_version::text,
      'pointerUpdatedAt', source.updated_at,
      'projectionGeneration', source.projection_generation,
      'engineVersion', source.engine_version,
      'policyVersion', source.policy_version,
      'calculatedAsOf', source.calculated_as_of,
      'achievementLevel', source.state->'achievementLevel',
      'createdAt', source.created_at,
      'state', pg_catalog.jsonb_build_object(
        'engineVersion', source.state->'engineVersion',
        'policyVersion', source.state->'policyVersion',
        'inputWatermark', source.state->'inputWatermark',
        'competencyId', source.state->'competencyId',
        'calculatedAsOf', source.state->'calculatedAsOf',
        'achievementLevel', source.state->'achievementLevel',
        'dimensions', pg_catalog.jsonb_build_object(
          'KNOWLEDGE', pg_catalog.jsonb_build_object(
            'dimension', source.state#>'{dimensions,KNOWLEDGE,dimension}',
            'value', source.state#>'{dimensions,KNOWLEDGE,value}',
            'achievementLevel', source.state#>'{dimensions,KNOWLEDGE,achievementLevel}',
            'condition', source.state#>'{dimensions,KNOWLEDGE,condition}',
            'confidence', source.state#>'{dimensions,KNOWLEDGE,confidence}',
            'freshness', source.state#>'{dimensions,KNOWLEDGE,freshness}',
            'lastMeaningfulEvidenceAt',
              source.state#>'{dimensions,KNOWLEDGE,lastMeaningfulEvidenceAt}'
          ),
          'RECALL', pg_catalog.jsonb_build_object(
            'dimension', source.state#>'{dimensions,RECALL,dimension}',
            'value', source.state#>'{dimensions,RECALL,value}',
            'achievementLevel', source.state#>'{dimensions,RECALL,achievementLevel}',
            'condition', source.state#>'{dimensions,RECALL,condition}',
            'confidence', source.state#>'{dimensions,RECALL,confidence}',
            'freshness', source.state#>'{dimensions,RECALL,freshness}',
            'lastMeaningfulEvidenceAt',
              source.state#>'{dimensions,RECALL,lastMeaningfulEvidenceAt}'
          ),
          'APPLICATION', pg_catalog.jsonb_build_object(
            'dimension', source.state#>'{dimensions,APPLICATION,dimension}',
            'value', source.state#>'{dimensions,APPLICATION,value}',
            'achievementLevel', source.state#>'{dimensions,APPLICATION,achievementLevel}',
            'condition', source.state#>'{dimensions,APPLICATION,condition}',
            'confidence', source.state#>'{dimensions,APPLICATION,confidence}',
            'freshness', source.state#>'{dimensions,APPLICATION,freshness}',
            'lastMeaningfulEvidenceAt',
              source.state#>'{dimensions,APPLICATION,lastMeaningfulEvidenceAt}'
          ),
          'INTERVIEW_EXECUTION', pg_catalog.jsonb_build_object(
            'dimension', source.state#>'{dimensions,INTERVIEW_EXECUTION,dimension}',
            'value', source.state#>'{dimensions,INTERVIEW_EXECUTION,value}',
            'achievementLevel',
              source.state#>'{dimensions,INTERVIEW_EXECUTION,achievementLevel}',
            'condition', source.state#>'{dimensions,INTERVIEW_EXECUTION,condition}',
            'confidence', source.state#>'{dimensions,INTERVIEW_EXECUTION,confidence}',
            'freshness', source.state#>'{dimensions,INTERVIEW_EXECUTION,freshness}',
            'lastMeaningfulEvidenceAt',
              source.state#>'{dimensions,INTERVIEW_EXECUTION,lastMeaningfulEvidenceAt}'
          )
        )
      )
    ) end
  ) order by source.competency_ref collate "C"), '[]'::jsonb)
  into v_items
  from source;
  v_revision := pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to(v_items::text, 'UTF8'), 'sha256'
  ), 'hex');
  return pg_catalog.jsonb_build_object(
    'policyVersion', 'mastery-prerequisite-satisfaction/0.1',
    'revision', 'mastery-prerequisite:' || v_revision,
    'items', v_items
  );
end
$function$;

revoke all on function mastery.read_planning_prerequisite_source_v1(uuid, text[], timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function mastery.read_planning_prerequisite_source_v1(uuid, text[], timestamptz)
  to pando_planning_worker;

reset role;
set role pando_planning_worker;

-- Expand/contract wrapper: the previous C4 implementation remains immutable and private. The
-- public v1 signature now replaces only Catalog/Mastery answers and recomputes the covering fence.
alter function planning.load_plan_snapshot_source_bundle_v1(uuid, timestamptz)
  rename to load_plan_snapshot_source_bundle_pre_prerequisite_v1;

revoke all on function planning.load_plan_snapshot_source_bundle_pre_prerequisite_v1(
  uuid, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function planning.load_plan_snapshot_source_bundle_pre_prerequisite_v1(
  uuid, timestamptz
) to pando_planning_worker;

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
  v_catalog_ids uuid[];
  v_candidate_refs text[];
  v_custom_activity_ids uuid[];
  v_prerequisite_refs text[];
  v_catalog jsonb;
  v_mastery jsonb;
  v_fence text;
begin
  if p_workspace_id is null or p_claim_as_of is null then
    raise exception using errcode = '22023', message = 'planning source bundle input is invalid';
  end if;
  v_bundle := planning.load_plan_snapshot_source_bundle_pre_prerequisite_v1(
    p_workspace_id, p_claim_as_of
  );
  select coalesce(pg_catalog.array_agg((item.value->>'customActivityId')::uuid
    order by item.value->>'customActivityId'), array[]::uuid[])
  into v_custom_activity_ids
  from pg_catalog.jsonb_array_elements(v_bundle#>'{overlay,items}') as item(value);
  perform overlay.assert_planning_candidate_origins_v1(
    p_workspace_id, v_custom_activity_ids
  );
  select coalesce(pg_catalog.array_agg(requested.catalog_version_id
      order by requested.catalog_version_id, requested.competency_ref collate "C"), array[]::uuid[]),
    coalesce(pg_catalog.array_agg(requested.competency_ref
      order by requested.catalog_version_id, requested.competency_ref collate "C"), array[]::text[])
  into v_catalog_ids, v_candidate_refs
  from (
    select distinct (item.value->>'catalogVersionId')::uuid as catalog_version_id,
      item.value->>'competencyRef' as competency_ref
    from pg_catalog.jsonb_array_elements(v_bundle#>'{catalog,items}') as item(value)
  ) as requested;
  v_catalog := catalog.read_planning_graph_source_v2(v_catalog_ids, v_candidate_refs);
  select coalesce(pg_catalog.array_agg(source.competency_ref
    order by source.competency_ref collate "C"), array[]::text[])
  into v_prerequisite_refs
  from (
    select distinct prerequisite.value as competency_ref
    from pg_catalog.jsonb_array_elements(v_catalog->'items') as item(value)
    cross join lateral pg_catalog.jsonb_array_elements_text(
      item.value->'prerequisiteRefs'
    ) as prerequisite(value)
  ) as source;
  v_mastery := mastery.read_planning_prerequisite_source_v1(
    p_workspace_id, v_prerequisite_refs, p_claim_as_of
  );
  v_bundle := (v_bundle - 'sourceFence' - 'catalog' - 'mastery') ||
    pg_catalog.jsonb_build_object('catalog', v_catalog, 'mastery', v_mastery);
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

revoke create on schema catalog, overlay from pando_phase1_planning_source;
revoke create on schema mastery from pando_mastery_planning_source;
revoke create on schema planning from pando_planning_worker;

do $roles$
begin
  execute pg_catalog.format(
    'revoke pando_phase1_planning_source, pando_mastery_planning_source, pando_planning_worker from %I',
    current_user
  );
end
$roles$;
