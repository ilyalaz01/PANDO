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
