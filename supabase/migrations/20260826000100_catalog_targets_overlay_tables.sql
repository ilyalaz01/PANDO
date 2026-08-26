-- Phase 1 relational ownership for the canonical Catalog, immutable Target
-- Profile versions, and workspace-owned Overlay. Browser/authenticated roles
-- receive no table grants; purpose-specific RPCs are added by the next migration.

do $roles$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'pando_phase1_api') then
    execute 'create role pando_phase1_api nologin noinherit nobypassrls';
  end if;
end
$roles$;

create table catalog.catalog_versions (
  catalog_version_id uuid primary key default gen_random_uuid(),
  catalog_version_key text not null unique,
  version_number integer not null,
  lifecycle text not null default 'draft',
  changelog text not null,
  published_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  constraint catalog_versions_key_check check (
    catalog_version_key ~ '^catalog:[a-z0-9][a-z0-9-]{1,79}$'
  ),
  constraint catalog_versions_number_check check (version_number > 0),
  constraint catalog_versions_lifecycle_check check (lifecycle in ('draft', 'published', 'retired')),
  constraint catalog_versions_publication_check check (
    (lifecycle = 'draft' and published_at is null)
    or (lifecycle in ('published', 'retired') and published_at is not null)
  ),
  unique (version_number)
);

create table catalog.items (
  catalog_version_id uuid not null references catalog.catalog_versions (catalog_version_id) on delete restrict,
  item_key text not null,
  item_type text not null,
  slug text not null,
  title text not null,
  description text not null,
  domain_item_key text,
  lifecycle text not null default 'active',
  created_at timestamptz not null default clock_timestamp(),
  primary key (catalog_version_id, item_key),
  constraint catalog_items_key_check check (
    item_key ~ '^(domain|competency):[a-z0-9][a-z0-9-]{1,100}$'
  ),
  constraint catalog_items_type_check check (item_type in ('DOMAIN', 'COMPETENCY')),
  constraint catalog_items_slug_check check (slug ~ '^[a-z0-9][a-z0-9-]{1,100}$'),
  constraint catalog_items_title_check check (
    title = btrim(title) and char_length(title) between 1 and 160
  ),
  constraint catalog_items_description_check check (
    description = btrim(description) and char_length(description) between 1 and 500
  ),
  constraint catalog_items_domain_shape_check check (
    (item_type = 'DOMAIN' and item_key like 'domain:%' and domain_item_key is null)
    or
    (item_type = 'COMPETENCY' and item_key like 'competency:%'
      and domain_item_key like 'domain:%')
  ),
  constraint catalog_items_lifecycle_check check (lifecycle in ('active', 'retired')),
  unique (catalog_version_id, slug)
);

alter table catalog.items
  add constraint catalog_items_domain_fk
  foreign key (catalog_version_id, domain_item_key)
  references catalog.items (catalog_version_id, item_key)
  on delete restrict
  deferrable initially deferred;

create table catalog.competency_edges (
  catalog_version_id uuid not null references catalog.catalog_versions (catalog_version_id) on delete restrict,
  edge_key text not null,
  from_competency_key text not null,
  to_competency_key text not null,
  edge_type text not null,
  blocking boolean not null,
  rationale text not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (catalog_version_id, edge_key),
  constraint catalog_edges_key_check check (
    edge_key ~ '^edge:prerequisite:[a-z0-9][a-z0-9:-]{3,150}$'
  ),
  constraint catalog_edges_type_check check (edge_type = 'PREREQUISITE_OF'),
  constraint catalog_edges_blocking_check check (blocking),
  constraint catalog_edges_no_self_loop_check check (
    from_competency_key <> to_competency_key
  ),
  constraint catalog_edges_rationale_check check (
    rationale = btrim(rationale) and char_length(rationale) between 1 and 500
  ),
  foreign key (catalog_version_id, from_competency_key)
    references catalog.items (catalog_version_id, item_key) on delete restrict,
  foreign key (catalog_version_id, to_competency_key)
    references catalog.items (catalog_version_id, item_key) on delete restrict
);

create table catalog.roadmap_template_series (
  roadmap_series_id uuid primary key default gen_random_uuid(),
  roadmap_series_key text not null unique,
  lifecycle text not null default 'active',
  created_at timestamptz not null default clock_timestamp(),
  constraint roadmap_series_key_check check (
    roadmap_series_key ~ '^roadmap-series:[a-z0-9][a-z0-9-]{1,100}$'
  ),
  constraint roadmap_series_lifecycle_check check (lifecycle in ('active', 'retired'))
);

create table catalog.roadmap_template_versions (
  roadmap_version_id uuid primary key default gen_random_uuid(),
  roadmap_version_key text not null unique,
  roadmap_series_id uuid not null references catalog.roadmap_template_series (roadmap_series_id) on delete restrict,
  catalog_version_id uuid not null references catalog.catalog_versions (catalog_version_id) on delete restrict,
  version_number integer not null,
  lifecycle text not null default 'draft',
  changelog text not null,
  published_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  constraint roadmap_versions_key_check check (
    roadmap_version_key ~ '^roadmap:[a-z0-9][a-z0-9-]{1,100}$'
  ),
  constraint roadmap_versions_number_check check (version_number > 0),
  constraint roadmap_versions_lifecycle_check check (lifecycle in ('draft', 'published', 'retired')),
  constraint roadmap_versions_publication_check check (
    (lifecycle = 'draft' and published_at is null)
    or (lifecycle in ('published', 'retired') and published_at is not null)
  ),
  unique (roadmap_series_id, version_number)
);

create table catalog.roadmap_template_items (
  roadmap_version_id uuid not null references catalog.roadmap_template_versions (roadmap_version_id) on delete restrict,
  catalog_item_key text not null,
  sort_order integer not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (roadmap_version_id, catalog_item_key),
  constraint roadmap_items_sort_check check (sort_order > 0),
  unique (roadmap_version_id, sort_order)
);

create table targets.target_profile_series (
  profile_series_id uuid primary key default gen_random_uuid(),
  profile_series_key text not null unique,
  profile_scope text not null,
  workspace_id uuid references identity.workspaces (workspace_id) on delete restrict,
  lifecycle text not null default 'active',
  created_at timestamptz not null default clock_timestamp(),
  constraint profile_series_key_check check (
    profile_series_key ~ '^target-series:[a-z0-9][a-z0-9-]{1,100}$'
  ),
  constraint profile_series_scope_check check (profile_scope in ('canonical', 'workspace')),
  constraint profile_series_workspace_check check (
    (profile_scope = 'canonical' and workspace_id is null)
    or (profile_scope = 'workspace' and workspace_id is not null)
  ),
  constraint profile_series_lifecycle_check check (lifecycle in ('active', 'retired'))
);

create table targets.target_profile_versions (
  profile_version_id uuid primary key default gen_random_uuid(),
  profile_version_key text not null unique,
  profile_series_id uuid not null references targets.target_profile_series (profile_series_id) on delete restrict,
  workspace_id uuid references identity.workspaces (workspace_id) on delete restrict,
  base_profile_version_id uuid references targets.target_profile_versions (profile_version_id) on delete restrict,
  catalog_version_id uuid not null references catalog.catalog_versions (catalog_version_id) on delete restrict,
  roadmap_version_id uuid references catalog.roadmap_template_versions (roadmap_version_id) on delete restrict,
  version_number integer not null,
  lifecycle text not null default 'draft',
  role_title text not null,
  company_name text,
  source_summary text not null,
  freshness_status text not null,
  reviewed_at date not null,
  root_rule_key text not null,
  readiness_threshold numeric(6,5) not null,
  published_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  constraint profile_versions_key_check check (
    profile_version_key ~ '^target:[a-z0-9][a-z0-9-]{1,100}$'
  ),
  constraint profile_versions_number_check check (version_number > 0),
  constraint profile_versions_lifecycle_check check (lifecycle in ('draft', 'published', 'retired')),
  constraint profile_versions_role_check check (
    role_title = btrim(role_title) and char_length(role_title) between 1 and 160
  ),
  constraint profile_versions_company_check check (
    company_name is null
    or (company_name = btrim(company_name) and char_length(company_name) between 1 and 160)
  ),
  constraint profile_versions_source_check check (
    source_summary = btrim(source_summary) and char_length(source_summary) between 1 and 500
  ),
  constraint profile_versions_freshness_check check (
    freshness_status in ('initial_curated_assumption', 'reviewed', 'stale')
  ),
  constraint profile_versions_root_rule_check check (
    root_rule_key ~ '^rule:[a-z0-9][a-z0-9-]{1,100}$'
  ),
  constraint profile_versions_threshold_check check (
    readiness_threshold > 0 and readiness_threshold <= 1
  ),
  constraint profile_versions_publication_check check (
    (lifecycle = 'draft' and published_at is null)
    or (lifecycle in ('published', 'retired') and published_at is not null)
  ),
  unique (profile_series_id, version_number)
);

create table targets.target_requirement_rules (
  requirement_rule_id uuid primary key default gen_random_uuid(),
  profile_version_id uuid not null references targets.target_profile_versions (profile_version_id) on delete restrict,
  workspace_id uuid references identity.workspaces (workspace_id) on delete restrict,
  rule_key text not null,
  rule_type text not null,
  title text not null,
  criticality text not null,
  explanation text not null,
  accessibility_label text not null,
  required_count integer,
  threshold numeric(6,5),
  created_at timestamptz not null default clock_timestamp(),
  constraint target_rules_key_check check (rule_key ~ '^rule:[a-z0-9][a-z0-9-]{1,100}$'),
  constraint target_rules_type_check check (
    rule_type in ('ALL', 'ANY', 'K_OF_N', 'WEIGHTED_THRESHOLD', 'MANDATORY_FLOOR')
  ),
  constraint target_rules_criticality_check check (
    criticality in ('MANDATORY', 'PREFERRED', 'DIFFERENTIATING')
  ),
  constraint target_rules_title_check check (
    title = btrim(title) and char_length(title) between 1 and 160
  ),
  constraint target_rules_explanation_check check (
    explanation = btrim(explanation) and char_length(explanation) between 1 and 500
  ),
  constraint target_rules_accessibility_check check (
    accessibility_label = btrim(accessibility_label)
    and char_length(accessibility_label) between 1 and 500
  ),
  constraint target_rules_parameter_shape_check check (
    (rule_type = 'K_OF_N' and required_count is not null and required_count > 0 and threshold is null)
    or (rule_type = 'WEIGHTED_THRESHOLD' and threshold > 0 and threshold <= 1 and required_count is null)
    or (rule_type in ('ALL', 'ANY', 'MANDATORY_FLOOR') and required_count is null and threshold is null)
  ),
  constraint target_rules_floor_criticality_check check (
    rule_type <> 'MANDATORY_FLOOR' or criticality = 'MANDATORY'
  ),
  unique (profile_version_id, rule_key),
  unique (requirement_rule_id, profile_version_id)
);

create table targets.target_requirement_members (
  requirement_member_id uuid primary key default gen_random_uuid(),
  profile_version_id uuid not null references targets.target_profile_versions (profile_version_id) on delete restrict,
  workspace_id uuid references identity.workspaces (workspace_id) on delete restrict,
  requirement_rule_id uuid not null,
  member_order integer not null,
  member_type text not null,
  node_scope text,
  node_kind text,
  node_ref text,
  referenced_rule_id uuid,
  objective_dimension text,
  required_level text,
  member_weight numeric(10,8),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (requirement_rule_id, profile_version_id)
    references targets.target_requirement_rules (requirement_rule_id, profile_version_id)
    on delete restrict,
  foreign key (referenced_rule_id, profile_version_id)
    references targets.target_requirement_rules (requirement_rule_id, profile_version_id)
    on delete restrict,
  constraint target_members_order_check check (member_order > 0),
  constraint target_members_type_check check (member_type in ('NODE', 'RULE')),
  constraint target_members_node_scope_check check (
    node_scope is null or node_scope in ('canonical', 'workspace_overlay')
  ),
  constraint target_members_node_kind_check check (
    node_kind is null or node_kind in ('DOMAIN', 'COMPETENCY')
  ),
  constraint target_members_dimension_check check (
    objective_dimension is null
    or objective_dimension in ('KNOWLEDGE', 'RECALL', 'APPLICATION', 'INTERVIEW_EXECUTION')
  ),
  constraint target_members_level_check check (
    required_level is null or required_level in ('COMPLETED', 'VERIFIED', 'MASTERED')
  ),
  constraint target_members_weight_check check (member_weight is null or member_weight > 0),
  constraint target_members_shape_check check (
    (
      member_type = 'NODE'
      and node_scope is not null
      and node_kind is not null
      and node_ref is not null
      and referenced_rule_id is null
      and objective_dimension is not null
      and required_level is not null
    )
    or
    (
      member_type = 'RULE'
      and node_scope is null
      and node_kind is null
      and node_ref is null
      and referenced_rule_id is not null
      and objective_dimension is null
      and required_level is null
    )
  ),
  unique (requirement_rule_id, member_order)
);

create table overlay.workspace_overlays (
  workspace_id uuid primary key references identity.workspaces (workspace_id) on delete restrict,
  aggregate_version bigint not null default 0,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint workspace_overlays_version_check check (aggregate_version >= 0)
);

create table overlay.personal_competencies (
  personal_competency_id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references identity.workspaces (workspace_id) on delete restrict,
  competency_key text not null,
  domain_item_key text not null,
  title text not null,
  provenance text not null,
  lifecycle text not null default 'accepted',
  created_at timestamptz not null default clock_timestamp(),
  constraint personal_competencies_key_check check (
    competency_key ~ '^competency:[a-z0-9][a-z0-9-]{1,100}$'
  ),
  constraint personal_competencies_domain_check check (
    domain_item_key ~ '^domain:[a-z0-9][a-z0-9-]{1,100}$'
  ),
  constraint personal_competencies_title_check check (
    title = btrim(title) and char_length(title) between 1 and 160
  ),
  constraint personal_competencies_provenance_check check (
    provenance = btrim(provenance) and char_length(provenance) between 1 and 500
  ),
  constraint personal_competencies_lifecycle_check check (
    lifecycle in ('draft', 'accepted', 'archived')
  ),
  unique (workspace_id, competency_key)
);

create table overlay.personal_edges (
  personal_edge_id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references identity.workspaces (workspace_id) on delete restrict,
  edge_key text not null,
  source_node_ref text not null,
  target_node_ref text not null,
  edge_type text not null,
  rationale text not null,
  lifecycle text not null default 'accepted',
  created_at timestamptz not null default clock_timestamp(),
  constraint personal_edges_key_check check (
    edge_key ~ '^edge:user-added:[a-z0-9][a-z0-9:-]{3,150}$'
  ),
  constraint personal_edges_type_check check (edge_type = 'USER_ADDED'),
  constraint personal_edges_no_self_loop_check check (source_node_ref <> target_node_ref),
  constraint personal_edges_rationale_check check (
    rationale = btrim(rationale) and char_length(rationale) between 1 and 500
  ),
  constraint personal_edges_lifecycle_check check (lifecycle in ('accepted', 'archived')),
  unique (workspace_id, edge_key)
);

create table overlay.notes (
  note_id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references identity.workspaces (workspace_id) on delete restrict,
  subject_ref text not null,
  note_body text not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint overlay_notes_subject_check check (
    subject_ref ~ '^(domain|competency|target):[a-z0-9][a-z0-9-]{1,100}$'
  ),
  constraint overlay_notes_body_check check (
    note_body = btrim(note_body) and char_length(note_body) between 1 and 10000
  ),
  unique (workspace_id, subject_ref)
);

create table overlay.custom_activities (
  custom_activity_id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references identity.workspaces (workspace_id) on delete restrict,
  activity_key text not null,
  title text not null,
  activity_type text not null,
  target_competency_ref text not null,
  lifecycle text not null default 'active',
  created_at timestamptz not null default clock_timestamp(),
  constraint custom_activities_key_check check (
    activity_key ~ '^activity:[a-z0-9][a-z0-9-]{1,100}$'
  ),
  constraint custom_activities_title_check check (
    title = btrim(title) and char_length(title) between 1 and 200
  ),
  constraint custom_activities_type_check check (
    activity_type in ('MANUAL_CODING', 'READING', 'EXPLANATION', 'MOCK', 'PROJECT')
  ),
  constraint custom_activities_target_check check (
    target_competency_ref ~ '^competency:[a-z0-9][a-z0-9-]{1,100}$'
  ),
  constraint custom_activities_lifecycle_check check (
    lifecycle in ('active', 'paused', 'archived')
  ),
  unique (workspace_id, activity_key)
);

create table overlay.positions (
  position_id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references identity.workspaces (workspace_id) on delete restrict,
  node_ref text not null,
  x numeric(12,3) not null,
  y numeric(12,3) not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint overlay_positions_node_check check (
    node_ref ~ '^(domain|competency):[a-z0-9][a-z0-9-]{1,100}$'
  ),
  constraint overlay_positions_x_check check (x between -1000000 and 1000000),
  constraint overlay_positions_y_check check (y between -1000000 and 1000000),
  unique (workspace_id, node_ref)
);

-- Every exposed or workspace-bearing table is RLS-protected even though the
-- authenticated role has no direct table grants.
do $rls$
declare
  qualified_table text;
begin
  foreach qualified_table in array array[
    'catalog.catalog_versions',
    'catalog.items',
    'catalog.competency_edges',
    'catalog.roadmap_template_series',
    'catalog.roadmap_template_versions',
    'catalog.roadmap_template_items',
    'targets.target_profile_series',
    'targets.target_profile_versions',
    'targets.target_requirement_rules',
    'targets.target_requirement_members',
    'overlay.workspace_overlays',
    'overlay.personal_competencies',
    'overlay.personal_edges',
    'overlay.notes',
    'overlay.custom_activities',
    'overlay.positions'
  ]
  loop
    execute 'alter table ' || qualified_table || ' enable row level security';
    execute 'alter table ' || qualified_table || ' force row level security';
  end loop;
end
$rls$;

create function catalog.guard_version_mutation()
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

create trigger catalog_versions_immutable_after_publish
before update or delete on catalog.catalog_versions
for each row execute function catalog.guard_version_mutation();

create function catalog.guard_version_child_mutation()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_parent_id uuid;
begin
  for v_parent_id in
    select parent_id
    from unnest(array[
      case when tg_op in ('UPDATE', 'DELETE') then old.catalog_version_id end,
      case when tg_op in ('INSERT', 'UPDATE') then new.catalog_version_id end
    ]) as candidate(parent_id)
    where parent_id is not null
    group by parent_id
    order by parent_id
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('catalog-version:' || v_parent_id::text, 0)
    );
  end loop;
  if tg_op in ('UPDATE', 'DELETE') then
    if exists (
      select 1 from catalog.catalog_versions as version
      where version.catalog_version_id = old.catalog_version_id
        and version.lifecycle <> 'draft'
    ) then
      raise exception using errcode = '55000', message = 'published catalog content is immutable';
    end if;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    if exists (
      select 1 from catalog.catalog_versions as version
      where version.catalog_version_id = new.catalog_version_id
        and version.lifecycle <> 'draft'
    ) then
      raise exception using errcode = '55000', message = 'published catalog content is immutable';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$function$;

create trigger catalog_items_follow_version_immutability
before insert or update or delete on catalog.items
for each row execute function catalog.guard_version_child_mutation();
create trigger catalog_edges_follow_version_immutability
before insert or update or delete on catalog.competency_edges
for each row execute function catalog.guard_version_child_mutation();

create function catalog.guard_roadmap_version_mutation()
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

create trigger roadmap_versions_immutable_after_publish
before update or delete on catalog.roadmap_template_versions
for each row execute function catalog.guard_roadmap_version_mutation();

create function catalog.guard_roadmap_item_mutation()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_parent_id uuid;
begin
  for v_parent_id in
    select parent_id
    from unnest(array[
      case when tg_op in ('UPDATE', 'DELETE') then old.roadmap_version_id end,
      case when tg_op in ('INSERT', 'UPDATE') then new.roadmap_version_id end
    ]) as candidate(parent_id)
    where parent_id is not null
    group by parent_id
    order by parent_id
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('roadmap-version:' || v_parent_id::text, 0)
    );
  end loop;
  if tg_op in ('UPDATE', 'DELETE') then
    if exists (
      select 1 from catalog.roadmap_template_versions as version
      where version.roadmap_version_id = old.roadmap_version_id
        and version.lifecycle <> 'draft'
    ) then
      raise exception using errcode = '55000', message = 'published roadmap content is immutable';
    end if;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    if exists (
      select 1 from catalog.roadmap_template_versions as version
      where version.roadmap_version_id = new.roadmap_version_id
        and version.lifecycle <> 'draft'
    ) then
      raise exception using errcode = '55000', message = 'published roadmap content is immutable';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$function$;

create trigger roadmap_items_follow_version_immutability
before insert or update or delete on catalog.roadmap_template_items
for each row execute function catalog.guard_roadmap_item_mutation();

create function targets.guard_profile_series_mutation()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('target-profile-series:' || old.profile_series_id::text, 0)
  );
  if tg_op = 'DELETE' or old.lifecycle = 'retired' then
    raise exception using errcode = '55000', message = 'target profile series identity and scope are immutable';
  end if;
  if new.lifecycle <> 'retired'
     or (to_jsonb(new) - 'lifecycle') <> (to_jsonb(old) - 'lifecycle') then
    raise exception using errcode = '55000', message = 'target profile series identity and scope are immutable';
  end if;
  return new;
end
$function$;

create trigger target_profile_series_immutable
before update or delete on targets.target_profile_series
for each row execute function targets.guard_profile_series_mutation();

create function targets.guard_profile_scope()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_series targets.target_profile_series%rowtype;
  v_base targets.target_profile_versions%rowtype;
  v_parent_id uuid;
  v_is_retirement boolean := false;
begin
  if tg_op = 'UPDATE' then
    v_is_retirement := old.lifecycle = 'published' and new.lifecycle = 'retired';
  end if;
  for v_parent_id in
    select parent_id
    from unnest(array[
      case when tg_op = 'UPDATE' then old.profile_series_id end,
      new.profile_series_id
    ]) as candidate(parent_id)
    where parent_id is not null
    group by parent_id
    order by parent_id
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('target-profile-series:' || v_parent_id::text, 0)
    );
  end loop;
  select series.* into strict v_series
  from targets.target_profile_series as series
  where series.profile_series_id = new.profile_series_id;

  if new.workspace_id is distinct from v_series.workspace_id then
    raise exception using errcode = '23514', message = 'profile version workspace must match its series';
  end if;

  if not v_is_retirement and v_series.lifecycle <> 'active' then
    raise exception using errcode = '23514', message = 'target profile series must be active';
  end if;

  if new.base_profile_version_id is not null and not v_is_retirement then
    select version.* into strict v_base
    from targets.target_profile_versions as version
    where version.profile_version_id = new.base_profile_version_id;
    if v_series.profile_scope <> 'workspace'
       or v_base.workspace_id is not null
       or v_base.lifecycle <> 'published' then
      raise exception using errcode = '23514', message = 'workspace profile base must be a published canonical version';
    end if;
  end if;
  return new;
end
$function$;

create trigger target_profile_scope_consistency
before insert or update on targets.target_profile_versions
for each row execute function targets.guard_profile_scope();

create function targets.guard_requirement_scope()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_workspace_id uuid;
  v_lifecycle text;
  v_parent_id uuid;
begin
  for v_parent_id in
    select parent_id
    from unnest(array[
      case when tg_op in ('UPDATE', 'DELETE') then old.profile_version_id end,
      case when tg_op in ('INSERT', 'UPDATE') then new.profile_version_id end
    ]) as candidate(parent_id)
    where parent_id is not null
    group by parent_id
    order by parent_id
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('target-profile-version:' || v_parent_id::text, 0)
    );
  end loop;
  if tg_op in ('UPDATE', 'DELETE') then
    select version.lifecycle
    into strict v_lifecycle
    from targets.target_profile_versions as version
    where version.profile_version_id = old.profile_version_id;
    if v_lifecycle <> 'draft' then
      raise exception using errcode = '55000', message = 'published target requirements are immutable';
    end if;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    select version.workspace_id, version.lifecycle
    into strict v_workspace_id, v_lifecycle
    from targets.target_profile_versions as version
    where version.profile_version_id = new.profile_version_id;
    if new.workspace_id is distinct from v_workspace_id then
      raise exception using errcode = '23514', message = 'target requirement workspace must match its profile version';
    end if;
    if v_lifecycle <> 'draft' then
      raise exception using errcode = '55000', message = 'published target requirements are immutable';
    end if;
    if tg_table_name = 'target_requirement_members' then
      if new.node_scope = 'workspace_overlay' and v_workspace_id is null then
        raise exception using errcode = '23514', message = 'canonical target profiles cannot reference workspace overlay nodes';
      end if;
    end if;
    return new;
  end if;
  return old;
end
$function$;

create trigger target_rules_follow_profile_immutability
before insert or update or delete on targets.target_requirement_rules
for each row execute function targets.guard_requirement_scope();
create trigger target_members_follow_profile_immutability
before insert or update or delete on targets.target_requirement_members
for each row execute function targets.guard_requirement_scope();

create function targets.validate_profile_for_publication(p_profile_version_id uuid)
returns void
language plpgsql
set search_path = ''
as $function$
declare
  v_profile targets.target_profile_versions%rowtype;
  v_root_rule_id uuid;
begin
  select version.* into strict v_profile
  from targets.target_profile_versions as version
  where version.profile_version_id = p_profile_version_id;

  if not exists (
    select 1 from catalog.catalog_versions as version
    where version.catalog_version_id = v_profile.catalog_version_id
      and version.lifecycle = 'published'
  ) then
    raise exception using errcode = '23514', message = 'target profile requires a published catalog version';
  end if;

  if v_profile.roadmap_version_id is not null
     and not exists (
       select 1 from catalog.roadmap_template_versions as roadmap
       where roadmap.roadmap_version_id = v_profile.roadmap_version_id
         and roadmap.catalog_version_id = v_profile.catalog_version_id
         and roadmap.lifecycle = 'published'
     ) then
    raise exception using errcode = '23514', message = 'target profile roadmap must be published against the same catalog version';
  end if;

  select rule.requirement_rule_id into v_root_rule_id
  from targets.target_requirement_rules as rule
  where rule.profile_version_id = p_profile_version_id
    and rule.rule_key = v_profile.root_rule_key;
  if v_root_rule_id is null then
    raise exception using errcode = '23514', message = 'target profile root requirement rule is missing';
  end if;

  if exists (
    select 1
    from targets.target_requirement_rules as rule
    left join lateral (
      select count(*)::integer as member_count,
             count(*) filter (where member.member_type = 'NODE')::integer as node_count,
             count(*) filter (where member.member_type = 'RULE')::integer as rule_count,
             count(*) filter (where member.member_weight is not null)::integer as weighted_count
      from targets.target_requirement_members as member
      where member.requirement_rule_id = rule.requirement_rule_id
    ) as counts on true
    where rule.profile_version_id = p_profile_version_id
      and (
        counts.member_count = 0
        or (rule.rule_type = 'K_OF_N' and rule.required_count > counts.member_count)
        or (rule.rule_type = 'WEIGHTED_THRESHOLD' and counts.weighted_count <> counts.member_count)
        or (rule.rule_type <> 'WEIGHTED_THRESHOLD' and counts.weighted_count <> 0)
        or (rule.rule_type = 'MANDATORY_FLOOR' and (counts.member_count <> 1 or counts.node_count <> 1))
      )
  ) then
    raise exception using errcode = '23514', message = 'target requirement rule membership is invalid';
  end if;

  if exists (
    with recursive walk(rule_id, path, cycle) as (
      select v_root_rule_id, array[v_root_rule_id], false
      union all
      select member.referenced_rule_id,
             walk.path || member.referenced_rule_id,
             member.referenced_rule_id = any(walk.path)
      from walk
      join targets.target_requirement_members as member
        on member.requirement_rule_id = walk.rule_id
       and member.member_type = 'RULE'
      where not walk.cycle
    )
    select 1 from walk where cycle
  ) then
    raise exception using errcode = '23514', message = 'target requirement rules must be acyclic';
  end if;

  if exists (
    select 1 from targets.target_requirement_rules as rule
    where rule.profile_version_id = p_profile_version_id
      and not exists (
        with recursive reachable(rule_id) as (
          select v_root_rule_id
          union
          select member.referenced_rule_id
          from reachable
          join targets.target_requirement_members as member
            on member.requirement_rule_id = reachable.rule_id
           and member.member_type = 'RULE'
        )
        select 1 from reachable where reachable.rule_id = rule.requirement_rule_id
      )
  ) then
    raise exception using errcode = '23514', message = 'all target requirement rules must be reachable from the root';
  end if;

  if exists (
    select 1
    from targets.target_requirement_members as member
    where member.profile_version_id = p_profile_version_id
      and member.member_type = 'NODE'
      and (
        (member.node_scope = 'canonical' and not exists (
          select 1 from catalog.items as item
          where item.catalog_version_id = v_profile.catalog_version_id
            and item.item_key = member.node_ref
            and item.item_type = member.node_kind
            and item.lifecycle = 'active'
        ))
        or (member.node_scope = 'workspace_overlay' and not exists (
          select 1 from overlay.personal_competencies as competency
          where competency.workspace_id = v_profile.workspace_id
            and competency.competency_key = member.node_ref
            and member.node_kind = 'COMPETENCY'
            and competency.lifecycle = 'accepted'
        ))
      )
  ) then
    raise exception using errcode = '23514', message = 'target requirement references an unavailable node';
  end if;
end
$function$;

create function targets.guard_profile_version_mutation()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if tg_op = 'DELETE' or old.lifecycle = 'retired' then
    raise exception using errcode = '55000', message = 'published target profile versions are immutable';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('target-profile-version:' || old.profile_version_id::text, 0)
  );
  if old.lifecycle = 'draft'
     and new.lifecycle = 'published'
     and new.published_at is not null
     and (to_jsonb(new) - 'lifecycle' - 'published_at')
       = (to_jsonb(old) - 'lifecycle' - 'published_at') then
    perform targets.validate_profile_for_publication(old.profile_version_id);
    return new;
  end if;
  if old.lifecycle = 'published'
     and new.lifecycle = 'retired'
     and (to_jsonb(new) - 'lifecycle') = (to_jsonb(old) - 'lifecycle') then
    return new;
  end if;
  if old.lifecycle = 'draft' then
    raise exception using errcode = '55000', message = 'target profile publication is the only allowed mutation';
  end if;
  raise exception using errcode = '55000', message = 'published target profile versions are immutable';
end
$function$;

create trigger target_profile_versions_immutable_after_publish
before update or delete on targets.target_profile_versions
for each row execute function targets.guard_profile_version_mutation();

revoke all on all tables in schema catalog from public, anon, authenticated, service_role;
revoke all on all sequences in schema catalog from public, anon, authenticated, service_role;
revoke all on all functions in schema catalog from public, anon, authenticated, service_role;
revoke all on all tables in schema targets from public, anon, authenticated, service_role;
revoke all on all sequences in schema targets from public, anon, authenticated, service_role;
revoke all on all functions in schema targets from public, anon, authenticated, service_role;
revoke all on all tables in schema overlay from public, anon, authenticated, service_role;
revoke all on all sequences in schema overlay from public, anon, authenticated, service_role;
revoke all on all functions in schema overlay from public, anon, authenticated, service_role;
