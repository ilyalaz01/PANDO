begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    '10000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
    'target-context-alice@pando.test', '', clock_timestamp(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    clock_timestamp(), clock_timestamp()
  ),
  (
    '10000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
    'target-context-bob@pando.test', '', clock_timestamp(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    clock_timestamp(), clock_timestamp()
  );

create temporary table target_context_results (
  result_name text primary key,
  response jsonb not null
);
grant select, insert on target_context_results to authenticated;

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '10000000-0000-4000-8000-000000000001',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text,
  true
);
set local role authenticated;
insert into target_context_results
select 'alice-bootstrap', api.bootstrap_personal_workspace(
  'target-context-alice-bootstrap', 'Alice target context'
);
reset role;

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '10000000-0000-4000-8000-000000000002',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text,
  true
);
set local role authenticated;
insert into target_context_results
select 'bob-bootstrap', api.bootstrap_personal_workspace(
  'target-context-bob-bootstrap', 'Bob target context'
);
reset role;

create temporary table target_context_workspaces as
select result_name, (response->>'workspace_id')::uuid as workspace_id
from target_context_results
where result_name in ('alice-bootstrap', 'bob-bootstrap');
grant select on target_context_workspaces to authenticated;

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '10000000-0000-4000-8000-000000000001',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text,
  true
);
set local role authenticated;
insert into target_context_results
select 'alice-goal', api.create_readiness_goal(
  workspace_id,
  'goal:alice-main',
  'Alice canonical readiness',
  'target:nvidia-python-verification-base-v1',
  'target-context-alice-goal'
) from target_context_workspaces where result_name = 'alice-bootstrap';
reset role;

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '10000000-0000-4000-8000-000000000002',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text,
  true
);
set local role authenticated;
insert into target_context_results
select 'bob-goal', api.create_readiness_goal(
  workspace_id,
  'goal:bob-main',
  'Bob canonical readiness',
  'target:nvidia-python-verification-base-v1',
  'target-context-bob-goal'
) from target_context_workspaces where result_name = 'bob-bootstrap';
reset role;

create temporary table target_context_mutation_baseline as
select
  (select count(*) from outbox.command_receipts) as command_receipts,
  (select count(*) from outbox.events) as outbox_events;

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '10000000-0000-4000-8000-000000000001',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text,
  true
);
set local role authenticated;
insert into target_context_results
values ('alice-context', api.get_explore_target_context_v1('goal:alice-main'));
insert into target_context_results
values ('alice-context-repeat', api.get_explore_target_context_v1('goal:alice-main'));
reset role;

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '10000000-0000-4000-8000-000000000002',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text,
  true
);
set local role authenticated;
insert into target_context_results
values ('bob-context', api.get_explore_target_context_v1('goal:bob-main'));
select throws_ok(
  $$select api.get_explore_target_context_v1('goal:alice-main')$$,
  '42501', 'readiness goal is not accessible',
  'Bob cannot infer Alice target context through a foreign goal key'
);
select throws_ok(
  $$select api.get_explore_target_context_v1('goal:missing-main')$$,
  '42501', 'readiness goal is not accessible',
  'a missing goal is externally indistinguishable from a foreign goal'
);
select throws_ok(
  pg_catalog.format(
    'select targets.get_explore_target_requirements_impl(%L::uuid,%L)',
    (select workspace_id from target_context_workspaces where result_name = 'alice-bootstrap'),
    'goal:alice-main'
  ),
  '42501', 'workspace is not accessible',
  'the Targets owner query repeats cross-workspace authorization'
);
select throws_ok(
  pg_catalog.format(
    'select overlay.get_explore_required_overlay_nodes_impl(%L::uuid,array[]::text[])',
    (select workspace_id from target_context_workspaces where result_name = 'alice-bootstrap')
  ),
  '42501', 'workspace is not accessible',
  'the Overlay owner query repeats cross-workspace authorization'
);
reset role;

select is(
  (select response->'contract'->>'name' from target_context_results where result_name = 'alice-context'),
  'ExploreTargetContextV1',
  'target context declares its exact contract name'
);
select is(
  (select response->'contract'->>'version' from target_context_results where result_name = 'alice-context'),
  '1.0.0',
  'target context declares its exact contract version'
);
select is(
  (select response->>'workspaceId' from target_context_results where result_name = 'alice-context'),
  (select workspace_id::text from target_context_workspaces where result_name = 'alice-bootstrap'),
  'the zero-workspace API derives Alice workspace from the current subject'
);
select is(
  (select response->'readinessGoal'->>'readinessGoalKey' from target_context_results where result_name = 'alice-context'),
  'goal:alice-main',
  'the target context remains pinned to the exact readiness goal'
);
select is(
  (select response->'targetProfile'->>'profileVersionKey' from target_context_results where result_name = 'alice-context'),
  'target:nvidia-python-verification-base-v1',
  'the target context remains pinned to the exact immutable profile version'
);
select is(
  jsonb_array_length((select response->'requirementRules' from target_context_results where result_name = 'alice-context')),
  5,
  'the complete seeded requirement tree is returned by Targets'
);
select is(
  jsonb_array_length((select response->'scope'->'canonicalNodes' from target_context_results where result_name = 'alice-context')),
  24,
  'the seeded roadmap closure contains the exact 24 canonical domain and competency nodes'
);
select is(
  jsonb_array_length((select response->'scope'->'canonicalEdges' from target_context_results where result_name = 'alice-context')),
  14,
  'the seeded roadmap closure contains the exact relevant prerequisite edges'
);
select is(
  (select response from target_context_results where result_name = 'alice-context-repeat'),
  (select response from target_context_results where result_name = 'alice-context'),
  'identical target-context reads are byte-equivalent and deterministic'
);
select ok(
  position('Alice canonical readiness' in (select response::text from target_context_results where result_name = 'bob-context')) = 0,
  'Bob context contains no Alice goal title or workspace state'
);
select ok(
  not ((select response from target_context_results where result_name = 'alice-context') ? 'mastery'),
  'the target context does not fabricate a Mastery input'
);
select ok(
  not ((select response from target_context_results where result_name = 'alice-context') ? 'readiness'),
  'the target context does not fabricate a readiness snapshot'
);
select is(
  (select count(*) from outbox.command_receipts),
  (select command_receipts from target_context_mutation_baseline),
  'repeated target-context reads create no command receipt'
);
select is(
  (select count(*) from outbox.events),
  (select outbox_events from target_context_mutation_baseline),
  'repeated target-context reads append no outbox event'
);

-- A sparse roadmap and A -> B -> C -> D graph prove that closure walks only incoming ancestors of
-- a required node that the roadmap itself omits. D is a descendant and E is unrelated.
insert into catalog.catalog_versions (
  catalog_version_id, catalog_version_key, version_number, lifecycle, changelog
) values (
  'd1000000-0000-4000-8000-000000000001',
  'catalog:closure-test-v1',
  2,
  'draft',
  'Sparse recursive Explore target closure fixture.'
);
insert into catalog.items (
  catalog_version_id, item_key, item_type, slug, title, description, domain_item_key
) values
  (
    'd1000000-0000-4000-8000-000000000001', 'domain:closure-test', 'DOMAIN',
    'closure-test', 'Closure test', 'Sparse recursive closure test domain.', null
  ),
  (
    'd1000000-0000-4000-8000-000000000001', 'competency:closure-a', 'COMPETENCY',
    'closure-a', 'Closure A', 'Two-hop prerequisite ancestor.', 'domain:closure-test'
  ),
  (
    'd1000000-0000-4000-8000-000000000001', 'competency:closure-b', 'COMPETENCY',
    'closure-b', 'Closure B', 'One-hop prerequisite ancestor.', 'domain:closure-test'
  ),
  (
    'd1000000-0000-4000-8000-000000000001', 'competency:closure-c', 'COMPETENCY',
    'closure-c', 'Closure C', 'Required competency omitted by the roadmap.', 'domain:closure-test'
  ),
  (
    'd1000000-0000-4000-8000-000000000001', 'competency:closure-d', 'COMPETENCY',
    'closure-d', 'Closure D', 'Descendant that must remain outside the closure.', 'domain:closure-test'
  ),
  (
    'd1000000-0000-4000-8000-000000000001', 'competency:closure-e', 'COMPETENCY',
    'closure-e', 'Closure E', 'Unrelated competency that must remain outside the closure.', 'domain:closure-test'
  );
insert into catalog.competency_edges (
  catalog_version_id, edge_key, from_competency_key, to_competency_key,
  edge_type, blocking, rationale
) values
  (
    'd1000000-0000-4000-8000-000000000001', 'edge:prerequisite:closure-a:closure-b',
    'competency:closure-a', 'competency:closure-b', 'PREREQUISITE_OF', true,
    'Closure A supports Closure B.'
  ),
  (
    'd1000000-0000-4000-8000-000000000001', 'edge:prerequisite:closure-b:closure-c',
    'competency:closure-b', 'competency:closure-c', 'PREREQUISITE_OF', true,
    'Closure B supports Closure C.'
  ),
  (
    'd1000000-0000-4000-8000-000000000001', 'edge:prerequisite:closure-c:closure-d',
    'competency:closure-c', 'competency:closure-d', 'PREREQUISITE_OF', true,
    'Closure C supports Closure D.'
  );
update catalog.catalog_versions
set lifecycle = 'published', published_at = clock_timestamp()
where catalog_version_id = 'd1000000-0000-4000-8000-000000000001';

insert into catalog.roadmap_template_series (roadmap_series_id, roadmap_series_key)
values (
  'd2000000-0000-4000-8000-000000000001',
  'roadmap-series:closure-test'
);
insert into catalog.roadmap_template_versions (
  roadmap_version_id, roadmap_version_key, roadmap_series_id,
  catalog_version_id, version_number, lifecycle, changelog
) values (
  'd2010000-0000-4000-8000-000000000001',
  'roadmap:closure-test-v1',
  'd2000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000001',
  1,
  'draft',
  'Roadmap deliberately contains only the closure domain.'
);
insert into catalog.roadmap_template_items (roadmap_version_id, catalog_item_key, sort_order)
values ('d2010000-0000-4000-8000-000000000001', 'domain:closure-test', 1);
update catalog.roadmap_template_versions
set lifecycle = 'published', published_at = clock_timestamp()
where roadmap_version_id = 'd2010000-0000-4000-8000-000000000001';

insert into targets.target_profile_series (
  profile_series_id, profile_series_key, profile_scope
) values (
  'd3000000-0000-4000-8000-000000000001',
  'target-series:closure-test',
  'canonical'
);
insert into targets.target_profile_versions (
  profile_version_id, profile_version_key, profile_series_id,
  catalog_version_id, roadmap_version_id, version_number, lifecycle,
  role_title, company_name, source_summary, freshness_status, reviewed_at,
  root_rule_key, readiness_threshold
) values (
  'd3010000-0000-4000-8000-000000000001',
  'target:closure-test-v1',
  'd3000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000001',
  'd2010000-0000-4000-8000-000000000001',
  1,
  'draft',
  'Sparse closure verification',
  null,
  'Synthetic recursive closure fixture.',
  'reviewed',
  current_date,
  'rule:closure-root',
  0.8
);
insert into targets.target_requirement_rules (
  requirement_rule_id, profile_version_id, rule_key, rule_type,
  title, criticality, explanation, accessibility_label, threshold
) values (
  'd3020000-0000-4000-8000-000000000001',
  'd3010000-0000-4000-8000-000000000001',
  'rule:closure-root',
  'WEIGHTED_THRESHOLD',
  'Sparse closure root',
  'MANDATORY',
  'Closure C carries the complete target weight.',
  'Weighted sparse closure target at eighty percent.',
  0.8
);
insert into targets.target_requirement_members (
  profile_version_id, requirement_rule_id, member_order, member_type,
  node_scope, node_kind, node_ref, objective_dimension, required_level, member_weight
) values (
  'd3010000-0000-4000-8000-000000000001',
  'd3020000-0000-4000-8000-000000000001',
  1,
  'NODE',
  'canonical',
  'COMPETENCY',
  'competency:closure-c',
  'APPLICATION',
  'VERIFIED',
  1
);
update targets.target_profile_versions
set lifecycle = 'published', published_at = clock_timestamp()
where profile_version_id = 'd3010000-0000-4000-8000-000000000001';

-- The same publication boundary rejects a root threshold that the readiness engine cannot consume.
insert into targets.target_profile_versions (
  profile_version_id, profile_version_key, profile_series_id,
  catalog_version_id, roadmap_version_id, version_number, lifecycle,
  role_title, source_summary, freshness_status, reviewed_at,
  root_rule_key, readiness_threshold
) values (
  'd3010000-0000-4000-8000-000000000002',
  'target:closure-test-bad-v2',
  'd3000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000001',
  'd2010000-0000-4000-8000-000000000001',
  2,
  'draft',
  'Invalid threshold verification',
  'Synthetic invalid threshold fixture.',
  'reviewed',
  current_date,
  'rule:closure-bad-root',
  0.8
);
insert into targets.target_requirement_rules (
  requirement_rule_id, profile_version_id, rule_key, rule_type,
  title, criticality, explanation, accessibility_label, threshold
) values (
  'd3020000-0000-4000-8000-000000000002',
  'd3010000-0000-4000-8000-000000000002',
  'rule:closure-bad-root',
  'WEIGHTED_THRESHOLD',
  'Invalid threshold root',
  'MANDATORY',
  'This root deliberately disagrees with its profile threshold.',
  'Invalid weighted threshold fixture.',
  0.9
);
insert into targets.target_requirement_members (
  profile_version_id, requirement_rule_id, member_order, member_type,
  node_scope, node_kind, node_ref, objective_dimension, required_level, member_weight
) values (
  'd3010000-0000-4000-8000-000000000002',
  'd3020000-0000-4000-8000-000000000002',
  1,
  'NODE',
  'canonical',
  'COMPETENCY',
  'competency:closure-c',
  'APPLICATION',
  'VERIFIED',
  1
);
select throws_ok(
  $$
    update targets.target_profile_versions
    set lifecycle = 'published', published_at = clock_timestamp()
    where profile_version_id = 'd3010000-0000-4000-8000-000000000002'
  $$,
  '23514',
  'root weighted threshold must equal the target profile readiness threshold',
  'publication rejects a root weighted threshold inconsistent with the profile'
);

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '10000000-0000-4000-8000-000000000001',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text,
  true
);
set local role authenticated;
insert into target_context_results
select 'alice-closure-goal', api.create_readiness_goal(
  workspace_id,
  'goal:closure-main',
  'Alice sparse closure readiness',
  'target:closure-test-v1',
  'target-context-alice-closure-goal'
) from target_context_workspaces where result_name = 'alice-bootstrap';
insert into target_context_results
values ('alice-closure-context', api.get_explore_target_context_v1('goal:closure-main'));
insert into target_context_results
values ('alice-closure-context-repeat', api.get_explore_target_context_v1('goal:closure-main'));
reset role;

select is(
  (select response->'scope'->'requiredCanonicalNodeRefs' from target_context_results where result_name = 'alice-closure-context'),
  '["competency:closure-c"]'::jsonb,
  'a required canonical competency is included even when its roadmap omits it'
);
select is(
  (select response->'scope'->'roadmapNodeRefs' from target_context_results where result_name = 'alice-closure-context'),
  '["domain:closure-test"]'::jsonb,
  'sparse roadmap membership remains exact'
);
select is(
  (select response->'scope'->'prerequisiteClosureNodeRefs' from target_context_results where result_name = 'alice-closure-context'),
  '["competency:closure-a", "competency:closure-b"]'::jsonb,
  'recursive closure contains exactly the two incoming prerequisite ancestors'
);
select is(
  pg_catalog.jsonb_path_query_array(
    (select response from target_context_results where result_name = 'alice-closure-context'),
    '$.scope.canonicalNodes[*].nodeRef'
  ),
  '["competency:closure-a", "competency:closure-b", "competency:closure-c", "domain:closure-test"]'::jsonb,
  'bounded closure excludes the descendant and unrelated canonical node'
);
select is(
  pg_catalog.jsonb_path_query_array(
    (select response from target_context_results where result_name = 'alice-closure-context'),
    '$.scope.canonicalEdges[*].edgeKey'
  ),
  '["edge:prerequisite:closure-a:closure-b", "edge:prerequisite:closure-b:closure-c"]'::jsonb,
  'bounded closure includes exactly the relevant incoming prerequisite edges'
);
select is(
  (select response from target_context_results where result_name = 'alice-closure-context-repeat'),
  (select response from target_context_results where result_name = 'alice-closure-context'),
  'recursive target closure is byte-equivalent across repeated reads'
);

-- A null-roadmap workspace target proves that accepted personal requirements pull in their exact
-- canonical domain parent without exposing notes or unrelated overlay content.
insert into overlay.personal_competencies (
  workspace_id, competency_key, domain_item_key, title, provenance
)
select
  workspace_id,
  'competency:alice-personal-linux',
  'domain:linux',
  'Alice personal Linux triage',
  'Synthetic accepted personal competency for target-context isolation.'
from target_context_workspaces
where result_name = 'alice-bootstrap';
insert into overlay.notes (workspace_id, subject_ref, note_body)
select workspace_id, 'competency:alice-personal-linux', 'Private note sentinel: rain-forest-42'
from target_context_workspaces
where result_name = 'alice-bootstrap';

insert into targets.target_profile_series (
  profile_series_id, profile_series_key, profile_scope, workspace_id
)
select
  'c3000000-0000-4000-8000-000000000001',
  'target-series:alice-personal-linux',
  'workspace',
  workspace_id
from target_context_workspaces
where result_name = 'alice-bootstrap';
insert into targets.target_profile_versions (
  profile_version_id, profile_version_key, profile_series_id, workspace_id,
  catalog_version_id, roadmap_version_id, version_number, lifecycle,
  role_title, company_name, source_summary, freshness_status, reviewed_at,
  root_rule_key, readiness_threshold
) values (
  'c3010000-0000-4000-8000-000000000001',
  'target:alice-personal-linux-v1',
  'c3000000-0000-4000-8000-000000000001',
  (select workspace_id from target_context_workspaces where result_name = 'alice-bootstrap'),
  'a1000000-0000-4000-8000-000000000001',
  null,
  1,
  'draft',
  'Alice personal Linux target',
  null,
  'Synthetic workspace-scoped target context fixture.',
  'reviewed',
  current_date,
  'rule:alice-personal-floor',
  0.8
);
insert into targets.target_requirement_rules (
  requirement_rule_id, profile_version_id, workspace_id, rule_key, rule_type,
  title, criticality, explanation, accessibility_label
) values (
  'c3020000-0000-4000-8000-000000000001',
  'c3010000-0000-4000-8000-000000000001',
  (select workspace_id from target_context_workspaces where result_name = 'alice-bootstrap'),
  'rule:alice-personal-floor',
  'MANDATORY_FLOOR',
  'Alice personal Linux floor',
  'MANDATORY',
  'The accepted personal competency must be completed.',
  'Mandatory accepted personal Linux competency floor.'
);
insert into targets.target_requirement_members (
  profile_version_id, workspace_id, requirement_rule_id, member_order, member_type,
  node_scope, node_kind, node_ref, objective_dimension, required_level
) values (
  'c3010000-0000-4000-8000-000000000001',
  (select workspace_id from target_context_workspaces where result_name = 'alice-bootstrap'),
  'c3020000-0000-4000-8000-000000000001',
  1,
  'NODE',
  'workspace_overlay',
  'COMPETENCY',
  'competency:alice-personal-linux',
  'APPLICATION',
  'COMPLETED'
);
update targets.target_profile_versions
set lifecycle = 'published', published_at = clock_timestamp()
where profile_version_id = 'c3010000-0000-4000-8000-000000000001';

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '10000000-0000-4000-8000-000000000001',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text,
  true
);
set local role authenticated;
insert into target_context_results
select 'alice-personal-goal', api.create_readiness_goal(
  workspace_id,
  'goal:alice-personal-linux',
  'Alice personal Linux readiness',
  'target:alice-personal-linux-v1',
  'target-context-alice-personal-goal'
) from target_context_workspaces where result_name = 'alice-bootstrap';
insert into target_context_results
values ('alice-personal-context', api.get_explore_target_context_v1('goal:alice-personal-linux'));
reset role;

select is(
  (select response->'targetProfile'->'roadmapVersionKey' from target_context_results where result_name = 'alice-personal-context'),
  'null'::jsonb,
  'a target without a roadmap retains an explicit null roadmap version'
);
select is(
  (select response->'scope'->'roadmapNodeRefs' from target_context_results where result_name = 'alice-personal-context'),
  '[]'::jsonb,
  'a null-roadmap target has no fabricated roadmap membership'
);
select is(
  (select response->'scope'->'requiredOverlayNodeRefs' from target_context_results where result_name = 'alice-personal-context'),
  '["competency:alice-personal-linux"]'::jsonb,
  'the rule tree declares the exact accepted personal competency requirement'
);
select is(
  (select response->'scope'->'canonicalNodes'->0->>'nodeRef' from target_context_results where result_name = 'alice-personal-context'),
  'domain:linux',
  'the target closure includes the personal competency canonical domain parent'
);
select is(
  jsonb_array_length((select response->'scope'->'canonicalNodes' from target_context_results where result_name = 'alice-personal-context')),
  1,
  'the null-roadmap target contains no unrelated canonical node'
);
select ok(
  position('rain-forest-42' in (select response::text from target_context_results where result_name = 'alice-personal-context')) = 0,
  'target context never exposes private note bodies'
);

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '10000000-0000-4000-8000-000000000002',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text,
  true
);
set local role authenticated;
insert into target_context_results
values ('bob-context-after-alice-private', api.get_explore_target_context_v1('goal:bob-main'));
reset role;

select ok(
  position(
    'competency:alice-personal-linux'
    in (select response::text from target_context_results where result_name = 'bob-context-after-alice-private')
  ) = 0
  and position(
    'rain-forest-42'
    in (select response::text from target_context_results where result_name = 'bob-context-after-alice-private')
  ) = 0,
  'Bob remains isolated after Alice adds private Overlay content'
);

update overlay.personal_competencies
set lifecycle = 'archived'
where workspace_id = (select workspace_id from target_context_workspaces where result_name = 'alice-bootstrap')
  and competency_key = 'competency:alice-personal-linux';

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '10000000-0000-4000-8000-000000000001',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text,
  true
);
set local role authenticated;
select throws_ok(
  $$select api.get_explore_target_context_v1('goal:alice-personal-linux')$$,
  '42501', 'required personal content is not accessible',
  'an archived required personal competency fails closed instead of disappearing from the target'
);
reset role;

select ok(
  has_function_privilege('authenticated', 'api.get_explore_target_context_v1(text)', 'EXECUTE'),
  'authenticated may execute the public target-context query'
);
select ok(
  not has_function_privilege('anon', 'api.get_explore_target_context_v1(text)', 'EXECUTE'),
  'anon cannot execute the public target-context query'
);
select ok(
  not has_function_privilege('service_role', 'api.get_explore_target_context_v1(text)', 'EXECUTE'),
  'service role is not an ordinary target-context caller'
);
select ok(
  not (
    select routine.prosecdef
    from pg_catalog.pg_proc as routine
    where routine.oid = 'api.get_explore_target_context_v1(text)'::pg_catalog.regprocedure
  ),
  'the public target-context composer remains security invoker'
);
select ok(
  pg_catalog.pg_get_functiondef(
    'targets.get_explore_target_requirements_impl(uuid,text)'::pg_catalog.regprocedure
  ) like '%SET search_path TO %''%''%',
  'the Targets owner query fixes an empty search path'
);
select ok(
  pg_catalog.pg_get_functiondef(
    'catalog.get_explore_target_closure_impl(uuid,uuid,text[])'::pg_catalog.regprocedure
  ) like '%SET search_path TO %''%''%',
  'the Catalog owner query fixes an empty search path'
);
select ok(
  pg_catalog.pg_get_functiondef(
    'overlay.get_explore_required_overlay_nodes_impl(uuid,text[])'::pg_catalog.regprocedure
  ) like '%SET search_path TO %''%''%',
  'the Overlay owner query fixes an empty search path'
);

select set_config('request.jwt.claims', '{"role":"authenticated","aud":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select api.get_explore_target_context_v1('goal:alice-main')$$,
  '28000', 'an authenticated user is required',
  'the target-context query requires a verified JWT subject'
);
reset role;

set local role anon;
select throws_ok(
  $$select api.get_explore_target_context_v1('goal:alice-main')$$,
  '42501', 'permission denied for schema api',
  'anon cannot call target context even with forged request claims'
);
reset role;

set local role service_role;
select throws_ok(
  $$select api.get_explore_target_context_v1('goal:alice-main')$$,
  '42501', 'permission denied for function get_explore_target_context_v1',
  'service role cannot call the ordinary user target-context query'
);
reset role;

delete from identity.workspace_memberships
where workspace_id = (
  select workspace_id from target_context_workspaces where result_name = 'bob-bootstrap'
);
select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '10000000-0000-4000-8000-000000000002',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text,
  true
);
set local role authenticated;
select throws_ok(
  $$select api.get_explore_target_context_v1('goal:bob-main')$$,
  '42501', 'personal workspace membership is revoked',
  'membership revocation invalidates the next target-context read immediately'
);
reset role;

select * from finish();
rollback;
