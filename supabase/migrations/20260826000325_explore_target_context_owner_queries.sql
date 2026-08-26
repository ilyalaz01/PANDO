-- Complete the target/roadmap half of future Explore materialization without fabricating
-- Mastery or readiness. The public read accepts only a readiness-goal key; Identity derives the
-- current personal workspace and the api layer composes purpose-specific owner DTOs.

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

-- Every value copied into the strict target-context DTO must remain safe to consume as plain text.
-- Reject incompatible existing rows instead of rewriting curator-authored content.
do $safe_text_preflight$
begin
  if exists (
    select 1 from catalog.items
    where description ~ '[[:cntrl:]<>]'
  ) or exists (
    select 1 from catalog.competency_edges
    where rationale ~ '[[:cntrl:]<>]'
  ) or exists (
    select 1 from targets.target_requirement_rules
    where title ~ '[[:cntrl:]<>]'
      or explanation ~ '[[:cntrl:]<>]'
      or accessibility_label ~ '[[:cntrl:]<>]'
  ) then
    raise exception using
      errcode = '23514',
      message = 'Explore target-context safe-text preflight failed; review incompatible rows before migration';
  end if;
end
$safe_text_preflight$;

alter table catalog.items
  add constraint catalog_items_description_safe_text_check
  check (description !~ '[[:cntrl:]<>]');
alter table catalog.competency_edges
  add constraint catalog_edges_rationale_safe_text_check
  check (rationale !~ '[[:cntrl:]<>]');
alter table targets.target_requirement_rules
  add constraint target_rules_title_safe_text_check
  check (title !~ '[[:cntrl:]<>]'),
  add constraint target_rules_explanation_safe_text_check
  check (explanation !~ '[[:cntrl:]<>]'),
  add constraint target_rules_accessibility_safe_text_check
  check (accessibility_label !~ '[[:cntrl:]<>]');

-- The pure readiness engine requires this correlation. Enforce it before a Target Profile becomes
-- immutable so every later ExploreTargetContextV1 is materializable without a deterministic error.
create function targets.guard_root_weighted_threshold_on_publication()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_root_rule_type text;
  v_root_rule_threshold numeric;
begin
  if old.lifecycle = 'draft' and new.lifecycle = 'published' then
    select rule.rule_type, rule.threshold
    into v_root_rule_type, v_root_rule_threshold
    from targets.target_requirement_rules as rule
    where rule.profile_version_id = old.profile_version_id
      and rule.rule_key = old.root_rule_key;

    if v_root_rule_type = 'WEIGHTED_THRESHOLD'
      and v_root_rule_threshold is distinct from old.readiness_threshold
    then
      raise exception using
        errcode = '23514',
        message = 'root weighted threshold must equal the target profile readiness threshold';
    end if;
  end if;
  return new;
end
$function$;

alter function targets.guard_root_weighted_threshold_on_publication()
  owner to pando_phase1_api;
revoke all on function targets.guard_root_weighted_threshold_on_publication()
  from public, anon, authenticated, service_role;

create trigger target_profile_versions_root_threshold_on_publish
before update on targets.target_profile_versions
for each row execute function targets.guard_root_weighted_threshold_on_publication();

create function targets.get_explore_target_requirements_impl(
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
  v_rules jsonb;
  v_required_canonical_refs jsonb;
  v_required_overlay_refs jsonb;
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

  select profile.* into strict v_profile
  from targets.target_profile_versions as profile
  where profile.profile_version_id = v_goal.profile_version_id
    and profile.lifecycle in ('published', 'retired')
    and (profile.workspace_id is null or profile.workspace_id = p_workspace_id);

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'ruleKey', rule.rule_key,
        'ruleType', rule.rule_type,
        'title', rule.title,
        'criticality', rule.criticality,
        'explanation', rule.explanation,
        'accessibilityLabel', rule.accessibility_label,
        'requiredCount', rule.required_count,
        'threshold', rule.threshold,
        'members', coalesce(members.value, '[]'::jsonb)
      )
      order by rule.rule_key collate "C"
    ),
    '[]'::jsonb
  )
  into v_rules
  from targets.target_requirement_rules as rule
  left join lateral (
    select pg_catalog.jsonb_agg(
      case member.member_type
        when 'NODE' then pg_catalog.jsonb_build_object(
          'memberType', 'NODE',
          'nodeScope', member.node_scope,
          'nodeType', member.node_kind,
          'nodeRef', member.node_ref,
          'dimension', member.objective_dimension,
          'requiredLevel', member.required_level,
          'weight', member.member_weight
        )
        else pg_catalog.jsonb_build_object(
          'memberType', 'RULE',
          'ruleKey', referenced_rule.rule_key,
          'weight', member.member_weight
        )
      end
      order by
        case member.member_type
          when 'NODE' then 'NODE:' || member.node_ref || ':' || member.objective_dimension
          else 'RULE:' || referenced_rule.rule_key
        end collate "C"
    ) as value
    from targets.target_requirement_members as member
    left join targets.target_requirement_rules as referenced_rule
      on referenced_rule.requirement_rule_id = member.referenced_rule_id
     and referenced_rule.profile_version_id = member.profile_version_id
    where member.requirement_rule_id = rule.requirement_rule_id
  ) as members on true
  where rule.profile_version_id = v_profile.profile_version_id;

  select coalesce(
    pg_catalog.jsonb_agg(required.node_ref order by required.node_ref collate "C"),
    '[]'::jsonb
  )
  into v_required_canonical_refs
  from (
    select distinct member.node_ref
    from targets.target_requirement_members as member
    where member.profile_version_id = v_profile.profile_version_id
      and member.member_type = 'NODE'
      and member.node_scope = 'canonical'
  ) as required;

  select coalesce(
    pg_catalog.jsonb_agg(required.node_ref order by required.node_ref collate "C"),
    '[]'::jsonb
  )
  into v_required_overlay_refs
  from (
    select distinct member.node_ref
    from targets.target_requirement_members as member
    where member.profile_version_id = v_profile.profile_version_id
      and member.member_type = 'NODE'
      and member.node_scope = 'workspace_overlay'
  ) as required;

  return pg_catalog.jsonb_build_object(
    'workspaceId', p_workspace_id,
    'readinessGoal', pg_catalog.jsonb_build_object(
      'readinessGoalId', v_goal.readiness_goal_id,
      'readinessGoalKey', v_goal.readiness_goal_key,
      'lifecycle', v_goal.lifecycle,
      'aggregateVersion', v_goal.aggregate_version::text
    ),
    'targetProfile', pg_catalog.jsonb_build_object(
      'profileVersionId', v_profile.profile_version_id,
      'profileVersionKey', v_profile.profile_version_key,
      'catalogVersionId', v_profile.catalog_version_id,
      'roadmapVersionId', v_profile.roadmap_version_id,
      'rootRuleKey', v_profile.root_rule_key,
      'readinessThreshold', v_profile.readiness_threshold
    ),
    'requirementRules', v_rules,
    'requiredCanonicalNodeRefs', v_required_canonical_refs,
    'requiredOverlayNodeRefs', v_required_overlay_refs
  );
end
$function$;

alter function targets.get_explore_target_requirements_impl(uuid, text)
  owner to pando_phase1_api;
revoke all on function targets.get_explore_target_requirements_impl(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function targets.get_explore_target_requirements_impl(uuid, text)
  to authenticated;

create function catalog.get_explore_target_closure_impl(
  p_catalog_version_id uuid,
  p_roadmap_version_id uuid,
  p_seed_canonical_refs text[]
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
  v_roadmap_refs jsonb;
  v_prerequisite_refs jsonb;
  v_nodes jsonb;
  v_edges jsonb;
begin
  if identity.jwt_subject() is null then
    raise exception using errcode = '28000', message = 'an authenticated user is required';
  end if;
  if p_seed_canonical_refs is null
    or exists (select 1 from pg_catalog.unnest(p_seed_canonical_refs) as reference(value) where value is null)
    or pg_catalog.cardinality(p_seed_canonical_refs)
      <> (select count(distinct reference.value) from pg_catalog.unnest(p_seed_canonical_refs) as reference(value))
  then
    raise exception using errcode = '22023', message = 'canonical closure seeds must be unique and non-null';
  end if;

  select version.catalog_version_key into strict v_catalog_version_key
  from catalog.catalog_versions as version
  where version.catalog_version_id = p_catalog_version_id
    and version.lifecycle in ('published', 'retired');

  if p_roadmap_version_id is not null then
    select roadmap.roadmap_version_key into strict v_roadmap_version_key
    from catalog.roadmap_template_versions as roadmap
    where roadmap.roadmap_version_id = p_roadmap_version_id
      and roadmap.catalog_version_id = p_catalog_version_id
      and roadmap.lifecycle in ('published', 'retired');
  end if;

  if exists (
    select 1
    from pg_catalog.unnest(p_seed_canonical_refs) as reference(value)
    where not exists (
      select 1 from catalog.items as item
      where item.catalog_version_id = p_catalog_version_id
        and item.item_key = reference.value
        and item.lifecycle = 'active'
    )
  ) then
    raise exception using errcode = '23514', message = 'target requirement references an unavailable canonical node';
  end if;

  with recursive
  roadmap_refs(node_ref) as (
    select item.catalog_item_key
    from catalog.roadmap_template_items as item
    where item.roadmap_version_id = p_roadmap_version_id
  ),
  seed_refs(node_ref) as (
    select node_ref from roadmap_refs
    union
    select reference.value from pg_catalog.unnest(p_seed_canonical_refs) as reference(value)
  ),
  prerequisite_closure(node_ref) as (
    select node_ref from seed_refs
    union
    select edge.from_competency_key
    from prerequisite_closure as closure
    join catalog.competency_edges as edge
      on edge.catalog_version_id = p_catalog_version_id
     and edge.to_competency_key = closure.node_ref
  ),
  included_refs(node_ref) as (
    select node_ref from prerequisite_closure
    union
    select item.domain_item_key
    from catalog.items as item
    join prerequisite_closure as closure on closure.node_ref = item.item_key
    where item.catalog_version_id = p_catalog_version_id
      and item.item_type = 'COMPETENCY'
  )
  select
    coalesce(
      (select pg_catalog.jsonb_agg(node_ref order by node_ref collate "C") from roadmap_refs),
      '[]'::jsonb
    ),
    coalesce(
      (
        select pg_catalog.jsonb_agg(node_ref order by node_ref collate "C")
        from prerequisite_closure
        where node_ref not in (select node_ref from seed_refs)
      ),
      '[]'::jsonb
    ),
    coalesce(
      (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'nodeRef', item.item_key,
            'nodeType', item.item_type,
            'title', item.title,
            'description', item.description,
            'domainRef', item.domain_item_key
          )
          order by item.item_key collate "C"
        )
        from catalog.items as item
        join included_refs as included on included.node_ref = item.item_key
        where item.catalog_version_id = p_catalog_version_id
          and item.lifecycle = 'active'
      ),
      '[]'::jsonb
    ),
    coalesce(
      (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'edgeKey', edge.edge_key,
            'edgeType', edge.edge_type,
            'sourceRef', edge.from_competency_key,
            'targetRef', edge.to_competency_key,
            'blocking', edge.blocking,
            'rationale', edge.rationale
          )
          order by edge.edge_key collate "C"
        )
        from catalog.competency_edges as edge
        where edge.catalog_version_id = p_catalog_version_id
          and edge.from_competency_key in (select node_ref from included_refs)
          and edge.to_competency_key in (select node_ref from included_refs)
      ),
      '[]'::jsonb
    )
  into v_roadmap_refs, v_prerequisite_refs, v_nodes, v_edges;

  return pg_catalog.jsonb_build_object(
    'catalogVersionKey', v_catalog_version_key,
    'roadmapVersionKey', v_roadmap_version_key,
    'roadmapNodeRefs', v_roadmap_refs,
    'prerequisiteClosureNodeRefs', v_prerequisite_refs,
    'canonicalNodes', v_nodes,
    'canonicalEdges', v_edges
  );
end
$function$;

alter function catalog.get_explore_target_closure_impl(uuid, uuid, text[])
  owner to pando_phase1_api;
revoke all on function catalog.get_explore_target_closure_impl(uuid, uuid, text[])
  from public, anon, authenticated, service_role;
grant execute on function catalog.get_explore_target_closure_impl(uuid, uuid, text[])
  to authenticated;

create function overlay.get_explore_required_overlay_nodes_impl(
  p_workspace_id uuid,
  p_required_overlay_refs text[]
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
begin
  if identity.jwt_subject() is null then
    raise exception using errcode = '28000', message = 'an authenticated user is required';
  end if;
  if not identity.is_workspace_member(p_workspace_id) then
    raise exception using errcode = '42501', message = 'workspace is not accessible';
  end if;
  if p_required_overlay_refs is null
    or exists (select 1 from pg_catalog.unnest(p_required_overlay_refs) as reference(value) where value is null)
    or pg_catalog.cardinality(p_required_overlay_refs)
      <> (select count(distinct reference.value) from pg_catalog.unnest(p_required_overlay_refs) as reference(value))
  then
    raise exception using errcode = '22023', message = 'overlay requirement references must be unique and non-null';
  end if;
  if exists (
    select 1
    from pg_catalog.unnest(p_required_overlay_refs) as reference(value)
    where not exists (
      select 1 from overlay.personal_competencies as competency
      where competency.workspace_id = p_workspace_id
        and competency.competency_key = reference.value
        and competency.lifecycle = 'accepted'
    )
  ) then
    raise exception using errcode = '42501', message = 'required personal content is not accessible';
  end if;

  select coalesce(root.aggregate_version, 0) into v_overlay_version
  from (select 1) as singleton
  left join overlay.workspace_overlays as root on root.workspace_id = p_workspace_id;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'nodeRef', competency.competency_key,
        'nodeType', 'COMPETENCY',
        'title', competency.title,
        'domainRef', competency.domain_item_key,
        'workspaceId', competency.workspace_id
      )
      order by competency.competency_key collate "C"
    ),
    '[]'::jsonb
  )
  into v_nodes
  from overlay.personal_competencies as competency
  where competency.workspace_id = p_workspace_id
    and competency.competency_key = any(p_required_overlay_refs)
    and competency.lifecycle = 'accepted';

  return pg_catalog.jsonb_build_object(
    'overlayVersion', v_overlay_version::text,
    'requiredOverlayNodes', v_nodes
  );
end
$function$;

alter function overlay.get_explore_required_overlay_nodes_impl(uuid, text[])
  owner to pando_phase1_api;
revoke all on function overlay.get_explore_required_overlay_nodes_impl(uuid, text[])
  from public, anon, authenticated, service_role;
grant execute on function overlay.get_explore_required_overlay_nodes_impl(uuid, text[])
  to authenticated;

create function api.get_explore_target_context_v1(p_readiness_goal_key text)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  with workspace_source as (
    select identity.get_current_personal_workspace_impl() as value
  ),
  target_source as (
    select targets.get_explore_target_requirements_impl(
      (workspace_source.value->>'workspaceId')::uuid,
      p_readiness_goal_key
    ) as value
    from workspace_source
  ),
  overlay_requirement_refs as (
    select coalesce(
      pg_catalog.array_agg(reference.value order by reference.value collate "C"),
      array[]::text[]
    ) as value
    from target_source
    cross join lateral pg_catalog.jsonb_array_elements_text(
      target_source.value->'requiredOverlayNodeRefs'
    ) as reference(value)
  ),
  overlay_source as (
    select overlay.get_explore_required_overlay_nodes_impl(
      (target_source.value->>'workspaceId')::uuid,
      overlay_requirement_refs.value
    ) as value
    from target_source
    cross join overlay_requirement_refs
  ),
  canonical_closure_refs as (
    select coalesce(
      pg_catalog.array_agg(reference.value order by reference.value collate "C"),
      array[]::text[]
    ) as value
    from (
      select reference.value
      from target_source
      cross join lateral pg_catalog.jsonb_array_elements_text(
        target_source.value->'requiredCanonicalNodeRefs'
      ) as reference(value)
      union
      select node.value->>'domainRef'
      from overlay_source
      cross join lateral pg_catalog.jsonb_array_elements(
        overlay_source.value->'requiredOverlayNodes'
      ) as node(value)
    ) as reference
  ),
  catalog_source as (
    select catalog.get_explore_target_closure_impl(
      (target_source.value->'targetProfile'->>'catalogVersionId')::uuid,
      (target_source.value->'targetProfile'->>'roadmapVersionId')::uuid,
      canonical_closure_refs.value
    ) as value
    from target_source
    cross join canonical_closure_refs
  )
  select pg_catalog.jsonb_build_object(
    'contract', pg_catalog.jsonb_build_object(
      'name', 'ExploreTargetContextV1',
      'version', '1.0.0'
    ),
    'workspaceId', target_source.value->'workspaceId',
    'readinessGoal', target_source.value->'readinessGoal',
    'targetProfile',
      (
        (target_source.value->'targetProfile')
        - 'catalogVersionId'::text
        - 'roadmapVersionId'::text
      )
      || pg_catalog.jsonb_build_object(
        'catalogVersionKey', catalog_source.value->'catalogVersionKey',
        'roadmapVersionKey', catalog_source.value->'roadmapVersionKey'
      ),
    'overlayVersion', overlay_source.value->'overlayVersion',
    'requirementRules', target_source.value->'requirementRules',
    'scope', pg_catalog.jsonb_build_object(
      'requiredCanonicalNodeRefs', target_source.value->'requiredCanonicalNodeRefs',
      'requiredOverlayNodeRefs', target_source.value->'requiredOverlayNodeRefs',
      'roadmapNodeRefs', catalog_source.value->'roadmapNodeRefs',
      'prerequisiteClosureNodeRefs', catalog_source.value->'prerequisiteClosureNodeRefs',
      'canonicalNodes', catalog_source.value->'canonicalNodes',
      'canonicalEdges', catalog_source.value->'canonicalEdges',
      'requiredOverlayNodes', overlay_source.value->'requiredOverlayNodes'
    )
  )
  from target_source
  cross join catalog_source
  cross join overlay_source
$function$;

revoke all on function api.get_explore_target_context_v1(text)
  from public, anon, authenticated, service_role;
grant execute on function api.get_explore_target_context_v1(text)
  to authenticated;

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
