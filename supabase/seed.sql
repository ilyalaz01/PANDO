-- Initial product fixture, not an authoritative hiring claim. Seed data lives
-- outside migrations so a clean restore can replace it with the archived rows.
insert into catalog.catalog_versions (
  catalog_version_id, catalog_version_key, version_number, lifecycle, changelog
) values (
  'a1000000-0000-4000-8000-000000000001', 'catalog:seed-v1', 1, 'draft',
  'Representative Python, Algorithms, Linux, Networking, and Testing fixture.'
);

insert into catalog.items (
  catalog_version_id, item_key, item_type, slug, title, description, domain_item_key
)
select
  'a1000000-0000-4000-8000-000000000001'::uuid, item_key, item_type,
  split_part(item_key, ':', 2), title,
  case when item_type = 'DOMAIN' then title || ' navigation domain.'
       else 'Representative competency: ' || title || '.' end,
  domain_item_key
from pg_catalog.jsonb_to_recordset($items$
[
 {"item_key":"domain:algorithms","item_type":"DOMAIN","title":"Algorithms"},
 {"item_key":"domain:linux","item_type":"DOMAIN","title":"Linux"},
 {"item_key":"domain:networking","item_type":"DOMAIN","title":"Networking"},
 {"item_key":"domain:python","item_type":"DOMAIN","title":"Python"},
 {"item_key":"domain:testing","item_type":"DOMAIN","title":"Testing"},
 {"item_key":"competency:algorithms-complexity-analysis","item_type":"COMPETENCY","title":"Complexity analysis","domain_item_key":"domain:algorithms"},
 {"item_key":"competency:algorithms-graph-traversal","item_type":"COMPETENCY","title":"Graph traversal","domain_item_key":"domain:algorithms"},
 {"item_key":"competency:algorithms-hash-tables","item_type":"COMPETENCY","title":"Hash tables","domain_item_key":"domain:algorithms"},
 {"item_key":"competency:algorithms-problem-decomposition","item_type":"COMPETENCY","title":"Problem decomposition","domain_item_key":"domain:algorithms"},
 {"item_key":"competency:linux-cli-pipelines","item_type":"COMPETENCY","title":"CLI pipelines","domain_item_key":"domain:linux"},
 {"item_key":"competency:linux-file-permissions","item_type":"COMPETENCY","title":"File permissions","domain_item_key":"domain:linux"},
 {"item_key":"competency:linux-process-debugging","item_type":"COMPETENCY","title":"Process debugging","domain_item_key":"domain:linux"},
 {"item_key":"competency:networking-http-basics","item_type":"COMPETENCY","title":"HTTP basics","domain_item_key":"domain:networking"},
 {"item_key":"competency:networking-socket-debugging","item_type":"COMPETENCY","title":"Socket debugging","domain_item_key":"domain:networking"},
 {"item_key":"competency:networking-tcp-ip","item_type":"COMPETENCY","title":"TCP and IP","domain_item_key":"domain:networking"},
 {"item_key":"competency:python-data-model","item_type":"COMPETENCY","title":"Python data model","domain_item_key":"domain:python"},
 {"item_key":"competency:python-error-handling","item_type":"COMPETENCY","title":"Error handling","domain_item_key":"domain:python"},
 {"item_key":"competency:python-iterators-generators","item_type":"COMPETENCY","title":"Iterators and generators","domain_item_key":"domain:python"},
 {"item_key":"competency:python-standard-library","item_type":"COMPETENCY","title":"Standard library","domain_item_key":"domain:python"},
 {"item_key":"competency:python-typing","item_type":"COMPETENCY","title":"Python typing","domain_item_key":"domain:python"},
 {"item_key":"competency:testing-debugging-strategy","item_type":"COMPETENCY","title":"Debugging strategy","domain_item_key":"domain:testing"},
 {"item_key":"competency:testing-integration-testing","item_type":"COMPETENCY","title":"Integration testing","domain_item_key":"domain:testing"},
 {"item_key":"competency:testing-test-design","item_type":"COMPETENCY","title":"Test design","domain_item_key":"domain:testing"},
 {"item_key":"competency:testing-unit-testing","item_type":"COMPETENCY","title":"Unit testing","domain_item_key":"domain:testing"}
]
$items$::jsonb) as item(item_key text, item_type text, title text, domain_item_key text);

insert into catalog.competency_edges (
  catalog_version_id, edge_key, from_competency_key, to_competency_key,
  edge_type, blocking, rationale
)
select
  'a1000000-0000-4000-8000-000000000001'::uuid,
  'edge:prerequisite:' || split_part(source_ref, ':', 2) || ':' || split_part(target_ref, ':', 2),
  source_ref, target_ref, 'PREREQUISITE_OF', true,
  split_part(source_ref, ':', 2) || ' supports ' || split_part(target_ref, ':', 2) || '.'
from pg_catalog.jsonb_to_recordset($edges$
[
 {"source_ref":"competency:algorithms-complexity-analysis","target_ref":"competency:algorithms-graph-traversal"},
 {"source_ref":"competency:algorithms-hash-tables","target_ref":"competency:algorithms-graph-traversal"},
 {"source_ref":"competency:algorithms-problem-decomposition","target_ref":"competency:algorithms-complexity-analysis"},
 {"source_ref":"competency:linux-cli-pipelines","target_ref":"competency:linux-file-permissions"},
 {"source_ref":"competency:linux-cli-pipelines","target_ref":"competency:linux-process-debugging"},
 {"source_ref":"competency:linux-cli-pipelines","target_ref":"competency:networking-socket-debugging"},
 {"source_ref":"competency:networking-tcp-ip","target_ref":"competency:networking-http-basics"},
 {"source_ref":"competency:networking-tcp-ip","target_ref":"competency:networking-socket-debugging"},
 {"source_ref":"competency:python-data-model","target_ref":"competency:python-error-handling"},
 {"source_ref":"competency:python-standard-library","target_ref":"competency:python-iterators-generators"},
 {"source_ref":"competency:python-typing","target_ref":"competency:python-data-model"},
 {"source_ref":"competency:testing-debugging-strategy","target_ref":"competency:testing-integration-testing"},
 {"source_ref":"competency:testing-test-design","target_ref":"competency:testing-unit-testing"},
 {"source_ref":"competency:testing-unit-testing","target_ref":"competency:testing-integration-testing"}
]
$edges$::jsonb) as edge(source_ref text, target_ref text);

update catalog.catalog_versions
set lifecycle = 'published', published_at = '2026-08-26T00:00:00Z'
where catalog_version_id = 'a1000000-0000-4000-8000-000000000001';


insert into catalog.roadmap_template_series (
  roadmap_series_id, roadmap_series_key
) values (
  'a2000000-0000-4000-8000-000000000001',
  'roadmap-series:nvidia-python-verification'
);
insert into catalog.roadmap_template_versions (
  roadmap_version_id, roadmap_version_key, roadmap_series_id,
  catalog_version_id, version_number, lifecycle, changelog
) values (
  'a2010000-0000-4000-8000-000000000001',
  'roadmap:nvidia-python-verification-v1',
  'a2000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001',
  1, 'draft', 'Representative roadmap aligned with catalog seed v1.'
);
insert into catalog.roadmap_template_items (roadmap_version_id, catalog_item_key, sort_order)
select 'a2010000-0000-4000-8000-000000000001', item.item_key,
  row_number() over (order by item.item_type, item.item_key)
from catalog.items as item
where item.catalog_version_id = 'a1000000-0000-4000-8000-000000000001';
update catalog.roadmap_template_versions
set lifecycle = 'published', published_at = '2026-08-26T00:00:00Z'
where roadmap_version_id = 'a2010000-0000-4000-8000-000000000001';

insert into targets.target_profile_series (
  profile_series_id, profile_series_key, profile_scope
) values (
  'b1000000-0000-4000-8000-000000000001',
  'target-series:nvidia-python-verification-base', 'canonical'
);
insert into targets.target_profile_versions (
  profile_version_id, profile_version_key, profile_series_id,
  catalog_version_id, roadmap_version_id, version_number, lifecycle,
  role_title, company_name, source_summary, freshness_status, reviewed_at,
  root_rule_key, readiness_threshold
) values (
  'b1010000-0000-4000-8000-000000000001',
  'target:nvidia-python-verification-base-v1',
  'b1000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001',
  'a2010000-0000-4000-8000-000000000001', 1, 'draft',
  'Python and Verification Interview Readiness', 'NVIDIA',
  'Initial product fixture assumptions; production weights require separate sourcing and curator review.',
  'initial_curated_assumption', '2026-08-26', 'rule:target-root', 0.8
);

insert into targets.target_requirement_rules (
  requirement_rule_id, profile_version_id, rule_key, rule_type, title,
  criticality, explanation, accessibility_label, required_count, threshold
)
values
  ('b2000000-0000-4000-8000-000000000001','b1010000-0000-4000-8000-000000000001','rule:any-practical-proof','ANY','Practical Python proof','MANDATORY','Demonstrated Python error handling qualifies in the canonical base.','Any qualifying practical Python proof.',null,null),
  ('b2000000-0000-4000-8000-000000000002','b1010000-0000-4000-8000-000000000001','rule:core-breadth','K_OF_N','Cross-domain core breadth','MANDATORY','At least three of four core competencies must qualify.','Three of four core breadth requirements.',3,null),
  ('b2000000-0000-4000-8000-000000000003','b1010000-0000-4000-8000-000000000001','rule:linux-networking-floor','MANDATORY_FLOOR','Networking verification floor','MANDATORY','TCP and IP cannot be compensated by a high average.','Mandatory TCP and IP verified floor.',null,null),
  ('b2000000-0000-4000-8000-000000000004','b1010000-0000-4000-8000-000000000001','rule:overall-readiness','WEIGHTED_THRESHOLD','Weighted target readiness','MANDATORY','Unknown remains an interval rather than a fabricated zero.','Weighted readiness threshold of eighty percent.',null,0.8),
  ('b2000000-0000-4000-8000-000000000005','b1010000-0000-4000-8000-000000000001','rule:target-root','ALL','Target profile root','MANDATORY','Every root rule must qualify. Visual grouping creates no requirement.','All four target requirement groups.',null,null);

insert into targets.target_requirement_members (
  profile_version_id, requirement_rule_id, member_order, member_type,
  node_scope, node_kind, node_ref, referenced_rule_id,
  objective_dimension, required_level, member_weight
)
values
  ('b1010000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001',1,'NODE','canonical','COMPETENCY','competency:python-error-handling',null,'APPLICATION','VERIFIED',null),
  ('b1010000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000002',1,'NODE','canonical','COMPETENCY','competency:algorithms-complexity-analysis',null,'APPLICATION','VERIFIED',null),
  ('b1010000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000002',2,'NODE','canonical','COMPETENCY','competency:linux-process-debugging',null,'APPLICATION','COMPLETED',null),
  ('b1010000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000002',3,'NODE','canonical','COMPETENCY','competency:python-standard-library',null,'APPLICATION','VERIFIED',null),
  ('b1010000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000002',4,'NODE','canonical','COMPETENCY','competency:testing-test-design',null,'APPLICATION','VERIFIED',null),
  ('b1010000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000003',1,'NODE','canonical','COMPETENCY','competency:networking-tcp-ip',null,'APPLICATION','VERIFIED',null),
  ('b1010000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000004',1,'NODE','canonical','COMPETENCY','competency:algorithms-hash-tables',null,'APPLICATION','VERIFIED',0.2),
  ('b1010000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000004',2,'NODE','canonical','COMPETENCY','competency:linux-cli-pipelines',null,'APPLICATION','VERIFIED',0.15),
  ('b1010000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000004',3,'NODE','canonical','COMPETENCY','competency:networking-http-basics',null,'KNOWLEDGE','COMPLETED',0.1),
  ('b1010000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000004',4,'NODE','canonical','COMPETENCY','competency:networking-tcp-ip',null,'APPLICATION','VERIFIED',0.2),
  ('b1010000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000004',5,'NODE','canonical','COMPETENCY','competency:python-typing',null,'APPLICATION','VERIFIED',0.2),
  ('b1010000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000004',6,'NODE','canonical','COMPETENCY','competency:testing-integration-testing',null,'APPLICATION','VERIFIED',0.15),
  ('b1010000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000005',1,'RULE',null,null,null,'b2000000-0000-4000-8000-000000000001',null,null,null),
  ('b1010000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000005',2,'RULE',null,null,null,'b2000000-0000-4000-8000-000000000002',null,null,null),
  ('b1010000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000005',3,'RULE',null,null,null,'b2000000-0000-4000-8000-000000000003',null,null,null),
  ('b1010000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000005',4,'RULE',null,null,null,'b2000000-0000-4000-8000-000000000004',null,null,null);

update targets.target_profile_versions
set lifecycle = 'published', published_at = '2026-08-26T00:00:00Z'
where profile_version_id = 'b1010000-0000-4000-8000-000000000001';
