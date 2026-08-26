-- Provide the ordinary Explore source transport without exposing a workspace selector to callers.
-- Identity resolves the authenticated subject's creator-owned personal workspace before this
-- read-only composer crosses into the existing purpose-specific owner queries.

create function api.get_current_explore_source_v1(
  p_readiness_goal_key text,
  p_selected_activity_key text default null
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  with workspace_source as (
    select identity.get_current_personal_workspace_impl() as value
  ),
  selection as (
    select targets.get_explore_selection_impl(
      (workspace_source.value->>'workspaceId')::uuid,
      p_readiness_goal_key
    ) as value
    from workspace_source
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
      (selection.value->>'workspaceId')::uuid,
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
drop function api.get_explore_source_v1(uuid, text, text);
revoke all on function api.get_current_explore_source_v1(text, text)
  from public, anon, authenticated, service_role;
grant execute on function api.get_current_explore_source_v1(text, text) to authenticated;
