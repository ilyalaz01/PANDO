-- Replace the provisional cross-context Overlay implementation with three owner-query DTOs. The
-- api wrapper is the read-only Explore application composer and reads no private table directly.

do $migration_role_membership$
begin
  if not pg_catalog.pg_has_role(current_user, 'pando_phase1_api', 'SET') then
    if exists (
      select 1
      from pg_catalog.pg_auth_members as membership
      where membership.roleid = 'pando_phase1_api'::pg_catalog.regrole
        and membership.member = current_user::pg_catalog.regrole
    ) then
      perform pg_catalog.set_config('pando.migration_phase1_api_restore', 'set_false', false);
    else
      perform pg_catalog.set_config('pando.migration_phase1_api_restore', 'revoke', false);
    end if;
    execute pg_catalog.format('grant pando_phase1_api to %I with set true', current_user);
  else
    perform pg_catalog.set_config('pando.migration_phase1_api_restore', 'none', false);
  end if;
end
$migration_role_membership$;

grant create on schema catalog, targets, overlay to pando_phase1_api;

create function targets.get_explore_selection_impl(
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
begin
  if identity.jwt_subject() is null then
    raise exception using errcode = '28000', message = 'an authenticated user is required';
  end if;
  if not identity.is_workspace_member(p_workspace_id) then
    raise exception using errcode = '42501', message = 'workspace is not accessible';
  end if;
  select goal.* into v_goal
  from targets.readiness_goals as goal
  where goal.workspace_id = p_workspace_id
    and goal.readiness_goal_key = p_readiness_goal_key;
  if not found then
    raise exception using errcode = '42501', message = 'readiness goal is not accessible';
  end if;
  select version.* into strict v_profile
  from targets.target_profile_versions as version
  where version.profile_version_id = v_goal.profile_version_id
    and version.lifecycle in ('published', 'retired');

  return pg_catalog.jsonb_build_object(
    'workspaceId', p_workspace_id,
    'readinessGoalKey', v_goal.readiness_goal_key,
    'readinessGoalId', v_goal.readiness_goal_id,
    'profileVersionId', v_profile.profile_version_id,
    'targetProfileVersionKey', v_profile.profile_version_key,
    'catalogVersionId', v_profile.catalog_version_id,
    'roadmapVersionId', v_profile.roadmap_version_id
  );
end
$function$;

alter function targets.get_explore_selection_impl(uuid, text) owner to pando_phase1_api;
revoke all on function targets.get_explore_selection_impl(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function targets.get_explore_selection_impl(uuid, text) to authenticated;

create function catalog.get_explore_catalog_source_impl(
  p_catalog_version_id uuid,
  p_roadmap_version_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_catalog_version_key text;
  v_roadmap_version_key text;
  v_nodes jsonb;
  v_edges jsonb;
begin
  if identity.jwt_subject() is null then
    raise exception using errcode = '28000', message = 'an authenticated user is required';
  end if;
  select version.catalog_version_key into strict v_catalog_version_key
  from catalog.catalog_versions as version
  where version.catalog_version_id = p_catalog_version_id
    and version.lifecycle in ('published', 'retired');
  if p_roadmap_version_id is not null then
    select version.roadmap_version_key into strict v_roadmap_version_key
    from catalog.roadmap_template_versions as version
    where version.roadmap_version_id = p_roadmap_version_id
      and version.catalog_version_id = p_catalog_version_id
      and version.lifecycle in ('published', 'retired');
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(node order by (node->>'nodeRef') collate "C"),
    '[]'::jsonb
  )
  into v_nodes
  from (
    select pg_catalog.jsonb_build_object(
      'nodeRef', item.item_key,
      'nodeType', item.item_type,
      'title', item.title,
      'domainRef', item.domain_item_key,
      'origin', 'CANONICAL',
      'sourceVersionKey', v_catalog_version_key
    ) as node
    from catalog.items as item
    where item.catalog_version_id = p_catalog_version_id
      and item.lifecycle = 'active'
  ) as nodes;

  select coalesce(
    pg_catalog.jsonb_agg(edge order by (edge->>'edgeKey') collate "C"),
    '[]'::jsonb
  )
  into v_edges
  from (
    select pg_catalog.jsonb_build_object(
      'edgeKey', 'edge:part-of:' || split_part(item.item_key, ':', 2),
      'edgeType', 'PART_OF',
      'sourceRef', item.item_key,
      'targetRef', item.domain_item_key,
      'blocking', false,
      'origin', 'CANONICAL'
    ) as edge
    from catalog.items as item
    where item.catalog_version_id = p_catalog_version_id
      and item.item_type = 'COMPETENCY'
      and item.lifecycle = 'active'
    union all
    select pg_catalog.jsonb_build_object(
      'edgeKey', edge.edge_key,
      'edgeType', edge.edge_type,
      'sourceRef', edge.from_competency_key,
      'targetRef', edge.to_competency_key,
      'blocking', edge.blocking,
      'origin', 'CANONICAL'
    )
    from catalog.competency_edges as edge
    where edge.catalog_version_id = p_catalog_version_id
  ) as edges;

  return pg_catalog.jsonb_build_object(
    'catalogVersionKey', v_catalog_version_key,
    'roadmapVersionKey', v_roadmap_version_key,
    'nodes', v_nodes,
    'edges', v_edges
  );
end
$function$;

alter function catalog.get_explore_catalog_source_impl(uuid, uuid) owner to pando_phase1_api;
revoke all on function catalog.get_explore_catalog_source_impl(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function catalog.get_explore_catalog_source_impl(uuid, uuid) to authenticated;

create function overlay.get_explore_overlay_source_impl(
  p_workspace_id uuid,
  p_profile_version_id uuid,
  p_readiness_goal_id uuid,
  p_selected_activity_key text,
  p_canonical_node_refs text[]
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_overlay_version bigint;
  v_nodes jsonb;
  v_edges jsonb;
  v_positions jsonb;
begin
  if identity.jwt_subject() is null then
    raise exception using errcode = '28000', message = 'an authenticated user is required';
  end if;
  if not identity.is_workspace_member(p_workspace_id) then
    raise exception using errcode = '42501', message = 'workspace is not accessible';
  end if;
  if p_selected_activity_key is not null and not exists (
    select 1 from overlay.custom_activities as activity
    where activity.workspace_id = p_workspace_id
      and activity.profile_version_id = p_profile_version_id
      and activity.activity_key = p_selected_activity_key
      and activity.lifecycle = 'active'
  ) then
    raise exception using errcode = '42501', message = 'activity is not accessible';
  end if;

  select coalesce(root.aggregate_version, 0) into v_overlay_version
  from (select 1) as singleton
  left join overlay.workspace_overlays as root on root.workspace_id = p_workspace_id;

  select coalesce(
    pg_catalog.jsonb_agg(node order by (node->>'nodeRef') collate "C"),
    '[]'::jsonb
  )
  into v_nodes
  from (
    select pg_catalog.jsonb_build_object(
      'nodeRef', competency.competency_key,
      'nodeType', 'COMPETENCY',
      'title', competency.title,
      'domainRef', competency.domain_item_key,
      'origin', 'WORKSPACE_OVERLAY',
      'workspaceId', competency.workspace_id
    ) as node
    from overlay.personal_competencies as competency
    where competency.workspace_id = p_workspace_id
      and competency.lifecycle = 'accepted'
    union all
    select pg_catalog.jsonb_build_object(
      'nodeRef', activity.activity_key,
      'nodeType', 'ACTIVITY',
      'title', activity.title,
      'domainRef', null,
      'origin', 'WORKSPACE_OVERLAY',
      'workspaceId', activity.workspace_id,
      'activityType', activity.activity_type,
      'targetCompetencyRef', activity.target_competency_ref
    )
    from overlay.custom_activities as activity
    where activity.workspace_id = p_workspace_id
      and activity.profile_version_id = p_profile_version_id
      and activity.activity_key = p_selected_activity_key
      and activity.lifecycle = 'active'
  ) as nodes;

  select coalesce(
    pg_catalog.jsonb_agg(edge order by (edge->>'edgeKey') collate "C"),
    '[]'::jsonb
  )
  into v_edges
  from (
    select pg_catalog.jsonb_build_object(
      'edgeKey', 'edge:part-of:' || split_part(competency.competency_key, ':', 2),
      'edgeType', 'PART_OF',
      'sourceRef', competency.competency_key,
      'targetRef', competency.domain_item_key,
      'blocking', false,
      'origin', 'WORKSPACE_OVERLAY',
      'workspaceId', competency.workspace_id
    ) as edge
    from overlay.personal_competencies as competency
    where competency.workspace_id = p_workspace_id
      and competency.lifecycle = 'accepted'
    union all
    select pg_catalog.jsonb_build_object(
      'edgeKey', edge.edge_key,
      'edgeType', edge.edge_type,
      'sourceRef', edge.source_node_ref,
      'targetRef', edge.target_node_ref,
      'blocking', false,
      'origin', 'WORKSPACE_OVERLAY',
      'workspaceId', edge.workspace_id
    )
    from overlay.personal_edges as edge
    where edge.workspace_id = p_workspace_id
      and edge.lifecycle = 'accepted'
      and (
        edge.source_node_ref = any(p_canonical_node_refs)
        or exists (
          select 1 from overlay.personal_competencies as competency
          where competency.workspace_id = p_workspace_id
            and competency.competency_key = edge.source_node_ref
            and competency.lifecycle = 'accepted'
        )
      )
      and (
        edge.target_node_ref = any(p_canonical_node_refs)
        or exists (
          select 1 from overlay.personal_competencies as competency
          where competency.workspace_id = p_workspace_id
            and competency.competency_key = edge.target_node_ref
            and competency.lifecycle = 'accepted'
        )
      )
    union all
    select pg_catalog.jsonb_build_object(
      'edgeKey', 'edge:activity-evidences:' || split_part(activity.activity_key, ':', 2)
        || ':' || split_part(activity.target_competency_ref, ':', 2),
      'edgeType', 'ACTIVITY_EVIDENCES',
      'sourceRef', activity.activity_key,
      'targetRef', activity.target_competency_ref,
      'blocking', false,
      'origin', 'WORKSPACE_OVERLAY',
      'workspaceId', activity.workspace_id
    )
    from overlay.custom_activities as activity
    where activity.workspace_id = p_workspace_id
      and activity.profile_version_id = p_profile_version_id
      and activity.activity_key = p_selected_activity_key
      and activity.lifecycle = 'active'
  ) as edges;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'nodeRef', position.node_ref,
        'x', position.x,
        'y', position.y,
        'workspaceId', position.workspace_id,
        'readinessGoalId', position.readiness_goal_id,
        'targetProfileVersionId', position.profile_version_id
      )
      order by position.node_ref collate "C"
    ),
    '[]'::jsonb
  ) into v_positions
  from overlay.positions as position
  where position.workspace_id = p_workspace_id
    and position.readiness_goal_id = p_readiness_goal_id
    and position.profile_version_id = p_profile_version_id;

  return pg_catalog.jsonb_build_object(
    'overlayVersion', v_overlay_version::text,
    'nodes', v_nodes,
    'edges', v_edges,
    'positions', v_positions
  );
end
$function$;

alter function overlay.get_explore_overlay_source_impl(uuid, uuid, uuid, text, text[])
  owner to pando_phase1_api;
revoke all on function overlay.get_explore_overlay_source_impl(uuid, uuid, uuid, text, text[])
  from public, anon, authenticated, service_role;
grant execute on function overlay.get_explore_overlay_source_impl(uuid, uuid, uuid, text, text[])
  to authenticated;

create or replace function api.get_explore_source_v1(
  p_workspace_id uuid,
  p_readiness_goal_key text,
  p_selected_activity_key text default null
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  with selection as (
    select targets.get_explore_selection_impl(
      p_workspace_id,
      p_readiness_goal_key
    ) as value
  ),
  catalog_source as (
    select catalog.get_explore_catalog_source_impl(
      (selection.value->>'catalogVersionId')::uuid,
      (selection.value->>'roadmapVersionId')::uuid
    ) as value
    from selection
  ),
  canonical_refs as (
    select coalesce(
      pg_catalog.array_agg(
        node.value->>'nodeRef' order by (node.value->>'nodeRef') collate "C"
      ),
      array[]::text[]
    ) as value
    from catalog_source
    cross join lateral pg_catalog.jsonb_array_elements(catalog_source.value->'nodes') as node(value)
  ),
  overlay_source as (
    select overlay.get_explore_overlay_source_impl(
      p_workspace_id,
      (selection.value->>'profileVersionId')::uuid,
      (selection.value->>'readinessGoalId')::uuid,
      p_selected_activity_key,
      canonical_refs.value
    ) as value
    from selection
    cross join canonical_refs
  ),
  nodes as (
    select coalesce(
      pg_catalog.jsonb_agg(item.value order by (item.value->>'nodeRef') collate "C"),
      '[]'::jsonb
    ) as value
    from (
      select node.value
      from catalog_source
      cross join lateral pg_catalog.jsonb_array_elements(catalog_source.value->'nodes') as node(value)
      union all
      select node.value
      from overlay_source
      cross join lateral pg_catalog.jsonb_array_elements(overlay_source.value->'nodes') as node(value)
    ) as item
  ),
  edges as (
    select coalesce(
      pg_catalog.jsonb_agg(item.value order by (item.value->>'edgeKey') collate "C"),
      '[]'::jsonb
    ) as value
    from (
      select edge.value
      from catalog_source
      cross join lateral pg_catalog.jsonb_array_elements(catalog_source.value->'edges') as edge(value)
      union all
      select edge.value
      from overlay_source
      cross join lateral pg_catalog.jsonb_array_elements(overlay_source.value->'edges') as edge(value)
    ) as item
  )
  select pg_catalog.jsonb_build_object(
    'contract', pg_catalog.jsonb_build_object('name', 'ExploreSourceV1', 'version', '1.0.0'),
    'workspaceId', selection.value->'workspaceId',
    'readinessGoalKey', selection.value->'readinessGoalKey',
    'readinessGoalId', selection.value->'readinessGoalId',
    'targetProfileVersionId', selection.value->'profileVersionId',
    'overlayVersion', overlay_source.value->'overlayVersion',
    'catalogVersionKey', catalog_source.value->'catalogVersionKey',
    'roadmapVersionKey', catalog_source.value->'roadmapVersionKey',
    'targetProfileVersionKey', selection.value->'targetProfileVersionKey',
    'nodes', nodes.value,
    'edges', edges.value,
    'positions', overlay_source.value->'positions',
    'nodeCount', pg_catalog.jsonb_array_length(nodes.value),
    'edgeCount', pg_catalog.jsonb_array_length(edges.value)
  )
  from selection
  cross join catalog_source
  cross join overlay_source
  cross join nodes
  cross join edges
$function$;

revoke all on function api.get_explore_source_v1(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function api.get_explore_source_v1(uuid, text, text) to authenticated;
grant usage on schema catalog, targets, overlay to authenticated;

-- The old Overlay shortcut is no longer an allowed read contract.
revoke all on function overlay.get_explore_source_impl(uuid, text, text)
  from public, anon, authenticated, service_role;
drop function overlay.get_explore_source_impl(uuid, text, text);

-- Keep every title that can enter Explore compatible with the strict safe-text DTO. This prevents
-- a successful user command from persisting a selected activity that makes later reads fail.
alter table catalog.items
  add constraint catalog_items_title_safe_text_check check (title !~ '[[:cntrl:]<>]');
alter table overlay.personal_competencies
  add constraint personal_competencies_title_safe_text_check check (title !~ '[[:cntrl:]<>]');
alter table overlay.custom_activities
  add constraint custom_activities_title_safe_text_check check (title !~ '[[:cntrl:]<>]');

revoke create on schema catalog, targets, overlay from pando_phase1_api;

do $migration_role_membership$
begin
  case pg_catalog.current_setting('pando.migration_phase1_api_restore', true)
    when 'revoke' then
      execute pg_catalog.format('revoke pando_phase1_api from %I', current_user);
    when 'set_false' then
      execute pg_catalog.format('grant pando_phase1_api to %I with set false', current_user);
    else
      null;
  end case;
end
$migration_role_membership$;
