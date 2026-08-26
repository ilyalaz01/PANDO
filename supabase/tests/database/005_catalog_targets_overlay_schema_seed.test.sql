begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select no_plan();

select is(
  (
    select pg_catalog.array_agg(namespace.nspname || '.' || class.relname order by namespace.nspname, class.relname)
    from pg_catalog.pg_class as class
    join pg_catalog.pg_namespace as namespace on namespace.oid = class.relnamespace
    where class.relkind = 'r'
      and namespace.nspname in ('catalog', 'targets', 'overlay')
  ),
  array[
    'catalog.catalog_versions',
    'catalog.competency_edges',
    'catalog.items',
    'catalog.roadmap_template_items',
    'catalog.roadmap_template_series',
    'catalog.roadmap_template_versions',
    'overlay.custom_activities',
    'overlay.notes',
    'overlay.personal_competencies',
    'overlay.personal_edges',
    'overlay.positions',
    'overlay.workspace_overlays',
    'targets.readiness_goals',
    'targets.target_profile_series',
    'targets.target_profile_versions',
    'targets.target_requirement_members',
    'targets.target_requirement_rules'
  ]::text[],
  'Catalog, Targets, and Overlay contain exactly the Phase 1 authoritative tables'
);

select ok(
  class.relrowsecurity and class.relforcerowsecurity,
  format('%s.%s has enabled and forced RLS', namespace.nspname, class.relname)
)
from pg_catalog.pg_class as class
join pg_catalog.pg_namespace as namespace on namespace.oid = class.relnamespace
where class.relkind = 'r'
  and namespace.nspname in ('catalog', 'targets', 'overlay')
order by namespace.nspname, class.relname;

select has_column('targets', 'target_profile_versions', 'workspace_id',
  'target profile versions carry workspace scope');
select has_column('targets', 'target_profile_versions', 'base_profile_version_id',
  'workspace target profiles retain their canonical base version');
select has_column('targets', 'readiness_goals', 'profile_version_id',
  'readiness goals select an exact immutable profile version');
select has_column('targets', 'readiness_goals', 'aggregate_version',
  'readiness goals expose optimistic concurrency state');
select has_column('overlay', 'custom_activities', 'profile_version_id',
  'custom activities are scoped to an exact profile graph');
select has_column('overlay', 'positions', 'readiness_goal_id',
  'positions are scoped to one readiness goal');
select has_column('overlay', 'positions', 'profile_version_id',
  'positions retain the exact immutable profile version');

select ok(
  not pg_catalog.has_table_privilege(
    runtime_role.role_name,
    pg_catalog.format('%I.%I', namespace.nspname, class.relname),
    privilege.privilege_name
  ),
  format('%s has no direct %s on %s.%s',
    runtime_role.role_name, privilege.privilege_name, namespace.nspname, class.relname)
)
from pg_catalog.pg_class as class
join pg_catalog.pg_namespace as namespace on namespace.oid = class.relnamespace
cross join (values ('anon'), ('authenticated'), ('service_role')) as runtime_role(role_name)
cross join (values
  ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')
) as privilege(privilege_name)
where class.relkind = 'r'
  and namespace.nspname in ('catalog', 'targets', 'overlay')
order by namespace.nspname, class.relname, runtime_role.role_name, privilege.privilege_name;

select ok(
  pg_catalog.has_function_privilege('authenticated', rpc.signature, 'EXECUTE'),
  format('authenticated can execute %s', rpc.signature)
)
from (values
  ('api.get_available_target_profiles(uuid)'),
  ('api.get_target_profile(uuid,text)'),
  ('api.get_overlay_note(uuid,text)'),
  ('api.get_explore_source_v1(uuid,text,text)'),
  ('api.save_overlay_note(uuid,text,text,bigint,text)'),
  ('api.add_custom_activity(uuid,text,text,text,text,text,bigint,text)'),
  ('api.set_overlay_position(uuid,text,text,numeric,numeric,bigint,text)'),
  ('api.create_readiness_goal(uuid,text,text,text,text)'),
  ('api.get_readiness_goal(uuid,text)'),
  ('api.reset_overlay_position(uuid,text,text,bigint,text)')
) as rpc(signature);

select ok(
  not pg_catalog.has_function_privilege(runtime_role.role_name, rpc.signature, 'EXECUTE'),
  format('%s cannot execute user RPC %s', runtime_role.role_name, rpc.signature)
)
from (values ('anon'), ('service_role')) as runtime_role(role_name)
cross join (values
  ('api.get_available_target_profiles(uuid)'),
  ('api.get_target_profile(uuid,text)'),
  ('api.get_overlay_note(uuid,text)'),
  ('api.get_explore_source_v1(uuid,text,text)'),
  ('api.save_overlay_note(uuid,text,text,bigint,text)'),
  ('api.add_custom_activity(uuid,text,text,text,text,text,bigint,text)'),
  ('api.set_overlay_position(uuid,text,text,numeric,numeric,bigint,text)'),
  ('api.create_readiness_goal(uuid,text,text,text,text)'),
  ('api.get_readiness_goal(uuid,text)'),
  ('api.reset_overlay_position(uuid,text,text,bigint,text)')
) as rpc(signature);

select ok(
  pg_catalog.has_function_privilege('authenticated', implementation.signature, 'EXECUTE'),
  format('authenticated has the exact private bridge %s', implementation.signature)
)
from (values
  ('targets.get_available_profiles_impl(uuid)'),
  ('targets.get_profile_impl(uuid,text)'),
  ('targets.create_readiness_goal_impl(uuid,text,text,text,text)'),
  ('targets.get_readiness_goal_impl(uuid,text)'),
  ('overlay.get_note_impl(uuid,text)'),
  ('overlay.get_explore_source_impl(uuid,text,text)'),
  ('overlay.save_note_impl(uuid,text,text,bigint,text)'),
  ('overlay.add_custom_activity_impl(uuid,text,text,text,text,text,bigint,text)'),
  ('overlay.set_position_impl(uuid,text,text,numeric,numeric,bigint,text)'),
  ('overlay.reset_position_impl(uuid,text,text,bigint,text)')
) as implementation(signature);

select ok(
  not pg_catalog.has_function_privilege(runtime_role.role_name, implementation.signature, 'EXECUTE'),
  format('%s cannot execute private implementation %s', runtime_role.role_name, implementation.signature)
)
from (values ('anon'), ('service_role')) as runtime_role(role_name)
cross join (values
  ('targets.get_available_profiles_impl(uuid)'),
  ('targets.get_profile_impl(uuid,text)'),
  ('targets.create_readiness_goal_impl(uuid,text,text,text,text)'),
  ('targets.get_readiness_goal_impl(uuid,text)'),
  ('overlay.get_note_impl(uuid,text)'),
  ('overlay.get_explore_source_impl(uuid,text,text)'),
  ('overlay.save_note_impl(uuid,text,text,bigint,text)'),
  ('overlay.add_custom_activity_impl(uuid,text,text,text,text,text,bigint,text)'),
  ('overlay.set_position_impl(uuid,text,text,numeric,numeric,bigint,text)'),
  ('overlay.reset_position_impl(uuid,text,text,bigint,text)')
) as implementation(signature);

select ok(
  not procedure.prosecdef
    and 'search_path=""' = any(coalesce(procedure.proconfig, '{}'::text[])),
  format('Phase 1 api function %s is a pinned SECURITY INVOKER wrapper', procedure.oid::regprocedure)
)
from pg_catalog.pg_proc as procedure
join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
where namespace.nspname = 'api'
  and procedure.proname in (
    'get_available_target_profiles', 'get_target_profile', 'get_overlay_note',
    'get_explore_source_v1', 'save_overlay_note', 'add_custom_activity',
    'set_overlay_position', 'create_readiness_goal', 'get_readiness_goal',
    'reset_overlay_position'
  )
order by procedure.proname;

select ok(
  procedure.prosecdef
    and 'search_path=""' = any(coalesce(procedure.proconfig, '{}'::text[]))
    and owner.rolname = 'pando_phase1_api'
    and not owner.rolcanlogin
    and not owner.rolinherit
    and not owner.rolbypassrls,
  format('private implementation %s is pinned and owned by the least-privilege Phase 1 role',
    procedure.oid::regprocedure)
)
from pg_catalog.pg_proc as procedure
join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
join pg_catalog.pg_roles as owner on owner.oid = procedure.proowner
where namespace.nspname in ('targets', 'overlay')
  and procedure.proname in (
    'get_available_profiles_impl', 'get_profile_impl', 'create_readiness_goal_impl',
    'get_readiness_goal_impl', 'get_note_impl', 'get_explore_source_impl',
    'save_note_impl', 'add_custom_activity_impl', 'set_position_impl',
    'reset_position_impl'
  )
order by namespace.nspname, procedure.proname;

select ok(
  not exists (
    select 1
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
    cross join lateral pg_catalog.aclexplode(
      coalesce(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
    ) as privilege
    where namespace.nspname in ('api', 'catalog', 'targets', 'overlay')
      and privilege.grantee = 0
      and privilege.privilege_type = 'EXECUTE'
  ),
  'PUBLIC has EXECUTE on no Catalog, Targets, Overlay, or api function'
);

select is(
  (select count(*) from catalog.items
    where catalog_version_id = 'a1000000-0000-4000-8000-000000000001'),
  24::bigint,
  'seed catalog has exactly five domains and nineteen competencies'
);
select is(
  (select count(*) from catalog.items
    where catalog_version_id = 'a1000000-0000-4000-8000-000000000001'
      and item_type = 'DOMAIN'),
  5::bigint,
  'seed catalog has exactly five domains'
);
select is(
  (select count(*) from catalog.items
    where catalog_version_id = 'a1000000-0000-4000-8000-000000000001'
      and item_type = 'COMPETENCY'),
  19::bigint,
  'seed catalog has exactly nineteen competencies'
);
select is(
  (select count(*) from catalog.competency_edges
    where catalog_version_id = 'a1000000-0000-4000-8000-000000000001'),
  14::bigint,
  'seed catalog has exactly fourteen prerequisite edges'
);
select is(
  (select count(*) from catalog.roadmap_template_items
    where roadmap_version_id = 'a2010000-0000-4000-8000-000000000001'),
  24::bigint,
  'seed roadmap references every exact catalog item once'
);
select is(
  (select lifecycle from targets.target_profile_versions
    where profile_version_key = 'target:nvidia-python-verification-base-v1'),
  'published',
  'canonical base target profile is published'
);
select ok(
  not exists (
    select 1
    from targets.target_requirement_members as member
    join targets.target_profile_versions as profile
      on profile.profile_version_id = member.profile_version_id
    where profile.profile_version_key = 'target:nvidia-python-verification-base-v1'
      and member.node_scope = 'workspace_overlay'
  ),
  'canonical base target profile contains no workspace references'
);

select throws_ok(
  $$update catalog.catalog_versions
      set changelog = 'tampered'
    where catalog_version_key = 'catalog:seed-v1'$$,
  '55000',
  'published catalog versions are immutable',
  'published canonical catalog metadata is immutable'
);
select throws_ok(
  $$update catalog.items
      set title = 'Tampered'
    where catalog_version_id = 'a1000000-0000-4000-8000-000000000001'
      and item_key = 'competency:python-error-handling'$$,
  '55000',
  'published catalog content is immutable',
  'published canonical catalog items are immutable'
);
select throws_ok(
  $$update targets.target_profile_versions
      set role_title = 'Tampered'
    where profile_version_key = 'target:nvidia-python-verification-base-v1'$$,
  '55000',
  'published target profile versions are immutable',
  'published target profile versions are immutable'
);
select throws_ok(
  $$update targets.target_requirement_rules
      set title = title
    where profile_version_id = 'b1010000-0000-4000-8000-000000000001'$$,
  '55000',
  'published target requirements are immutable',
  'published target requirements cannot be rewritten'
);

insert into catalog.catalog_versions (
  catalog_version_id, catalog_version_key, version_number, changelog
) values (
  'a1000000-0000-4000-8000-000000000002', 'catalog:cycle-test', 2,
  'pgTAP draft used to prove publication cycle rejection.'
);
insert into catalog.items (
  catalog_version_id, item_key, item_type, slug, title, description, domain_item_key
) values
  ('a1000000-0000-4000-8000-000000000002','domain:cycle-test','DOMAIN','cycle-test','Cycle test','Cycle-test domain.',null),
  ('a1000000-0000-4000-8000-000000000002','competency:cycle-a','COMPETENCY','cycle-a','Cycle A','Cycle test A.','domain:cycle-test'),
  ('a1000000-0000-4000-8000-000000000002','competency:cycle-b','COMPETENCY','cycle-b','Cycle B','Cycle test B.','domain:cycle-test');
insert into catalog.competency_edges (
  catalog_version_id, edge_key, from_competency_key, to_competency_key,
  edge_type, blocking, rationale
) values
  ('a1000000-0000-4000-8000-000000000002','edge:prerequisite:cycle-a:cycle-b','competency:cycle-a','competency:cycle-b','PREREQUISITE_OF',true,'Cycle test A to B.'),
  ('a1000000-0000-4000-8000-000000000002','edge:prerequisite:cycle-b:cycle-a','competency:cycle-b','competency:cycle-a','PREREQUISITE_OF',true,'Cycle test B to A.');

select throws_ok(
  $$update catalog.catalog_versions
      set lifecycle = 'published', published_at = clock_timestamp()
    where catalog_version_key = 'catalog:cycle-test'$$,
  '23514',
  'canonical prerequisite graph must be acyclic',
  'catalog publication rejects a prerequisite cycle atomically'
);
select is(
  (select lifecycle from catalog.catalog_versions where catalog_version_key = 'catalog:cycle-test'),
  'draft',
  'failed cycle publication leaves the catalog version in draft'
);

insert into targets.target_profile_versions (
  profile_version_id, profile_version_key, profile_series_id, catalog_version_id,
  roadmap_version_id, version_number, lifecycle, role_title, company_name,
  source_summary, freshness_status, reviewed_at, root_rule_key, readiness_threshold
) values (
  'b1010000-0000-4000-8000-000000000002', 'target:canonical-personal-ref-test',
  'b1000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001',
  'a2010000-0000-4000-8000-000000000001', 2, 'draft',
  'Canonical personal reference rejection', null,
  'pgTAP draft used only to prove canonical ownership.',
  'initial_curated_assumption', '2026-08-26', 'rule:canonical-ref-root', 0.8
);
insert into targets.target_requirement_rules (
  requirement_rule_id, profile_version_id, rule_key, rule_type, title,
  criticality, explanation, accessibility_label
) values (
  'b2000000-0000-4000-8000-000000000010',
  'b1010000-0000-4000-8000-000000000002',
  'rule:canonical-ref-root', 'ALL', 'Canonical reference root', 'MANDATORY',
  'Reject workspace content in a canonical profile.', 'Canonical reference rejection rule.'
);
select throws_ok(
  $$insert into targets.target_requirement_members (
      profile_version_id, requirement_rule_id, member_order, member_type,
      node_scope, node_kind, node_ref, objective_dimension, required_level
    ) values (
      'b1010000-0000-4000-8000-000000000002',
      'b2000000-0000-4000-8000-000000000010', 1, 'NODE',
      'workspace_overlay', 'COMPETENCY', 'competency:linux-log-triage',
      'APPLICATION', 'COMPLETED'
    )$$,
  '23514',
  'canonical target profiles cannot reference workspace overlay nodes',
  'canonical target profiles reject personal competency references'
);

select * from finish();
rollback;
