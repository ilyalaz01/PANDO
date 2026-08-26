-- A personal position belongs to one exact immutable target-profile graph.
-- A selected custom activity is likewise validated against that profile.
alter table overlay.custom_activities
  add column profile_version_id uuid not null
    references targets.target_profile_versions (profile_version_id) on delete restrict;
alter table overlay.positions
  add column profile_version_id uuid not null
    references targets.target_profile_versions (profile_version_id) on delete restrict;
alter table overlay.positions drop constraint positions_workspace_id_node_ref_key;
alter table overlay.positions
  add constraint positions_workspace_profile_node_key
  unique (workspace_id, profile_version_id, node_ref);

create function overlay.guard_custom_activity_profile_scope()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_profile_workspace_id uuid;
  v_profile_lifecycle text;
begin
  select profile.workspace_id, profile.lifecycle
  into strict v_profile_workspace_id, v_profile_lifecycle
  from targets.target_profile_versions as profile
  where profile.profile_version_id = new.profile_version_id;

  if v_profile_workspace_id is not null
     and new.workspace_id is distinct from v_profile_workspace_id then
    raise exception using errcode = '23514', message = 'custom activity workspace must match its target profile';
  end if;
  if v_profile_lifecycle not in ('published', 'retired') then
    raise exception using errcode = '23514', message = 'custom activity requires an immutable target profile version';
  end if;
  return new;
end
$function$;

create trigger custom_activity_profile_scope
before insert or update on overlay.custom_activities
for each row execute function overlay.guard_custom_activity_profile_scope();

create function catalog.validate_version_for_publication(p_catalog_version_id uuid)
returns void
language plpgsql
set search_path = ''
as $function$
begin
  if exists (
    select 1
    from catalog.competency_edges as edge
    join catalog.items as source_item
      on source_item.catalog_version_id = edge.catalog_version_id
     and source_item.item_key = edge.from_competency_key
    join catalog.items as target_item
      on target_item.catalog_version_id = edge.catalog_version_id
     and target_item.item_key = edge.to_competency_key
    where edge.catalog_version_id = p_catalog_version_id
      and (source_item.item_type <> 'COMPETENCY' or target_item.item_type <> 'COMPETENCY')
  ) then
    raise exception using errcode = '23514', message = 'prerequisite endpoints must be competencies';
  end if;

  if exists (
    with recursive paths(origin_key, current_key, path, cycle) as (
      select edge.from_competency_key, edge.to_competency_key,
        array[edge.from_competency_key, edge.to_competency_key], false
      from catalog.competency_edges as edge
      where edge.catalog_version_id = p_catalog_version_id
      union all
      select paths.origin_key, edge.to_competency_key,
        paths.path || edge.to_competency_key,
        edge.to_competency_key = any(paths.path)
      from paths
      join catalog.competency_edges as edge
        on edge.catalog_version_id = p_catalog_version_id
       and edge.from_competency_key = paths.current_key
      where not paths.cycle
    )
    select 1 from paths where cycle
  ) then
    raise exception using errcode = '23514', message = 'canonical prerequisite graph must be acyclic';
  end if;
end
$function$;

create function catalog.validate_roadmap_for_publication(p_roadmap_version_id uuid)
returns void
language plpgsql
set search_path = ''
as $function$
declare
  v_catalog_version_id uuid;
begin
  select roadmap.catalog_version_id
  into strict v_catalog_version_id
  from catalog.roadmap_template_versions as roadmap
  where roadmap.roadmap_version_id = p_roadmap_version_id;

  if not exists (
    select 1 from catalog.catalog_versions as version
    where version.catalog_version_id = v_catalog_version_id
      and version.lifecycle = 'published'
  ) then
    raise exception using errcode = '23514', message = 'roadmap requires a published catalog version';
  end if;

  if exists (
    select 1
    from catalog.roadmap_template_items as roadmap_item
    where roadmap_item.roadmap_version_id = p_roadmap_version_id
      and not exists (
        select 1 from catalog.items as item
        where item.catalog_version_id = v_catalog_version_id
          and item.item_key = roadmap_item.catalog_item_key
          and item.lifecycle = 'active'
      )
  ) then
    raise exception using errcode = '23514', message = 'roadmap item must exist in its exact catalog version';
  end if;
end
$function$;

create or replace function catalog.guard_version_mutation()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if tg_op = 'DELETE' or old.lifecycle = 'retired' then
    raise exception using errcode = '55000', message = 'published catalog versions are immutable';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('catalog-version:' || old.catalog_version_id::text, 0)
  );
  if old.lifecycle = 'draft'
     and new.lifecycle = 'published'
     and new.published_at is not null
     and (to_jsonb(new) - 'lifecycle' - 'published_at')
       = (to_jsonb(old) - 'lifecycle' - 'published_at') then
    perform catalog.validate_version_for_publication(old.catalog_version_id);
    return new;
  end if;
  if old.lifecycle = 'published'
     and new.lifecycle = 'retired'
     and (to_jsonb(new) - 'lifecycle') = (to_jsonb(old) - 'lifecycle') then
    return new;
  end if;
  if old.lifecycle = 'draft' then
    raise exception using errcode = '55000', message = 'catalog version publication is the only allowed mutation';
  end if;
  raise exception using errcode = '55000', message = 'published catalog versions are immutable';
end
$function$;

create or replace function catalog.guard_roadmap_version_mutation()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if tg_op = 'DELETE' or old.lifecycle = 'retired' then
    raise exception using errcode = '55000', message = 'published roadmap versions are immutable';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('roadmap-version:' || old.roadmap_version_id::text, 0)
  );
  if old.lifecycle = 'draft'
     and new.lifecycle = 'published'
     and new.published_at is not null
     and (to_jsonb(new) - 'lifecycle' - 'published_at')
       = (to_jsonb(old) - 'lifecycle' - 'published_at') then
    perform catalog.validate_roadmap_for_publication(old.roadmap_version_id);
    return new;
  end if;
  if old.lifecycle = 'published'
     and new.lifecycle = 'retired'
     and (to_jsonb(new) - 'lifecycle') = (to_jsonb(old) - 'lifecycle') then
    return new;
  end if;
  if old.lifecycle = 'draft' then
    raise exception using errcode = '55000', message = 'roadmap version publication is the only allowed mutation';
  end if;
  raise exception using errcode = '55000', message = 'published roadmap versions are immutable';
end
$function$;

revoke all on function catalog.validate_version_for_publication(uuid)
  from public, anon, authenticated, service_role;
revoke all on function catalog.validate_roadmap_for_publication(uuid)
  from public, anon, authenticated, service_role;
revoke all on function overlay.guard_custom_activity_profile_scope()
  from public, anon, authenticated, service_role;
