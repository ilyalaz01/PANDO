-- Initial product fixture, not an authoritative hiring claim.
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
