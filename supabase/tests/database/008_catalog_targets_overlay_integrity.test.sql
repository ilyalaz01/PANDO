begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into auth.users (
  id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values
  ('10000000-0000-4000-8000-000000000011','authenticated','authenticated','phase1-integrity-alice@pando.test','',clock_timestamp(),'{"provider":"email","providers":["email"]}'::jsonb,'{}',clock_timestamp(),clock_timestamp()),
  ('10000000-0000-4000-8000-000000000012','authenticated','authenticated','phase1-integrity-bob@pando.test','',clock_timestamp(),'{"provider":"email","providers":["email"]}'::jsonb,'{}',clock_timestamp(),clock_timestamp());

create temporary table phase1_integrity_results(name text primary key,response jsonb not null);
grant select,insert on phase1_integrity_results to authenticated;

select set_config('request.jwt.claims',jsonb_build_object('sub','10000000-0000-4000-8000-000000000011','role','authenticated','aud','authenticated','exp',extract(epoch from clock_timestamp()+interval '1 hour')::bigint)::text,true);
set local role authenticated;
insert into phase1_integrity_results values (
  'alice-bootstrap',api.bootstrap_personal_workspace('phase1-integrity-alice','Integrity Alice')
);
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub','10000000-0000-4000-8000-000000000012','role','authenticated','aud','authenticated','exp',extract(epoch from clock_timestamp()+interval '1 hour')::bigint)::text,true);
set local role authenticated;
insert into phase1_integrity_results values (
  'bob-bootstrap',api.bootstrap_personal_workspace('phase1-integrity-bob','Integrity Bob')
);
reset role;

create temporary table phase1_integrity_workspaces as
select name,(response->>'workspace_id')::uuid workspace_id
from phase1_integrity_results;
grant select on phase1_integrity_workspaces to authenticated;

select throws_ok(
  format(
    'update targets.target_profile_series set profile_scope=%L,workspace_id=%L::uuid where profile_series_id=%L::uuid',
    'workspace',
    (select workspace_id from phase1_integrity_workspaces where name='alice-bootstrap'),
    'b1000000-0000-4000-8000-000000000001'
  ),
  '55000','target profile series identity and scope are immutable',
  'canonical target profile series cannot be converted into workspace-owned data'
);

insert into targets.target_profile_series(
  profile_series_id,profile_series_key,profile_scope,workspace_id
)
select 'c1000000-0000-4000-8000-000000000012','target-series:integrity-bob','workspace',workspace_id
from phase1_integrity_workspaces where name='bob-bootstrap';
insert into targets.target_profile_versions(
  profile_version_id,profile_version_key,profile_series_id,workspace_id,
  base_profile_version_id,catalog_version_id,roadmap_version_id,version_number,
  role_title,source_summary,freshness_status,reviewed_at,root_rule_key,readiness_threshold
)
select
  'c1010000-0000-4000-8000-000000000012','target:integrity-bob-v1',
  'c1000000-0000-4000-8000-000000000012',workspace_id,
  'b1010000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001',
  'a2010000-0000-4000-8000-000000000001',1,'Integrity Bob profile',
  'Cross-workspace integrity fixture.','initial_curated_assumption','2026-08-26',
  'rule:integrity-bob-root',0.8
from phase1_integrity_workspaces where name='bob-bootstrap';
insert into targets.target_requirement_rules(
  requirement_rule_id,profile_version_id,workspace_id,rule_key,rule_type,title,
  criticality,explanation,accessibility_label
)
select
  'c2000000-0000-4000-8000-000000000012','c1010000-0000-4000-8000-000000000012',
  workspace_id,'rule:integrity-bob-root','ALL','Integrity Bob root','MANDATORY',
  'One exact canonical requirement.','Integrity Bob canonical requirement.'
from phase1_integrity_workspaces where name='bob-bootstrap';
insert into targets.target_requirement_members(
  profile_version_id,workspace_id,requirement_rule_id,member_order,member_type,
  node_scope,node_kind,node_ref,objective_dimension,required_level
)
select
  'c1010000-0000-4000-8000-000000000012',workspace_id,
  'c2000000-0000-4000-8000-000000000012',1,'NODE','canonical','COMPETENCY',
  'competency:python-error-handling','APPLICATION','COMPLETED'
from phase1_integrity_workspaces where name='bob-bootstrap';
update targets.target_profile_versions
set lifecycle='published',published_at=clock_timestamp()
where profile_version_id='c1010000-0000-4000-8000-000000000012';

select throws_ok(
  format(
    'insert into targets.readiness_goals(workspace_id,readiness_goal_key,title,profile_version_id) values(%L::uuid,%L,%L,%L::uuid)',
    (select workspace_id from phase1_integrity_workspaces where name='alice-bootstrap'),
    'goal:foreign-profile','Foreign profile','c1010000-0000-4000-8000-000000000012'
  ),
  '23514','readiness goal workspace must match its target profile',
  'readiness goal cannot point at another workspace profile'
);

insert into targets.readiness_goals(
  readiness_goal_id,workspace_id,readiness_goal_key,title,profile_version_id
)
select
  'd1000000-0000-4000-8000-000000000011',workspace_id,
  'goal:integrity-alice','Integrity Alice goal','b1010000-0000-4000-8000-000000000001'
from phase1_integrity_workspaces where name='alice-bootstrap';
select throws_ok(
  $$update targets.readiness_goals
      set profile_version_id='c1010000-0000-4000-8000-000000000012'
    where readiness_goal_id='d1000000-0000-4000-8000-000000000011'$$,
  '55000','readiness goal workspace, key, and exact profile version are immutable',
  'readiness goal cannot be retargeted after creation'
);

insert into targets.target_profile_series(
  profile_series_id,profile_series_key,profile_scope,workspace_id
)
select 'c1000000-0000-4000-8000-000000000011','target-series:integrity-alice-draft','workspace',workspace_id
from phase1_integrity_workspaces where name='alice-bootstrap';
insert into targets.target_profile_versions(
  profile_version_id,profile_version_key,profile_series_id,workspace_id,
  base_profile_version_id,catalog_version_id,roadmap_version_id,version_number,
  role_title,source_summary,freshness_status,reviewed_at,root_rule_key,readiness_threshold
)
select
  'c1010000-0000-4000-8000-000000000011','target:integrity-alice-draft-v1',
  'c1000000-0000-4000-8000-000000000011',workspace_id,
  'b1010000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001',
  'a2010000-0000-4000-8000-000000000001',1,'Integrity Alice draft',
  'Requirement scope fixture.','initial_curated_assumption','2026-08-26',
  'rule:integrity-alice-root',0.8
from phase1_integrity_workspaces where name='alice-bootstrap';
insert into targets.target_requirement_rules(
  requirement_rule_id,profile_version_id,workspace_id,rule_key,rule_type,title,
  criticality,explanation,accessibility_label
)
select
  'c2000000-0000-4000-8000-000000000011','c1010000-0000-4000-8000-000000000011',
  workspace_id,'rule:integrity-alice-root','ALL','Integrity Alice root','MANDATORY',
  'Workspace ownership must remain exact.','Integrity Alice ownership requirement.'
from phase1_integrity_workspaces where name='alice-bootstrap';
insert into targets.target_requirement_members(
  profile_version_id,workspace_id,requirement_rule_id,member_order,member_type,
  node_scope,node_kind,node_ref,objective_dimension,required_level
)
select
  'c1010000-0000-4000-8000-000000000011',workspace_id,
  'c2000000-0000-4000-8000-000000000011',1,'NODE','canonical','COMPETENCY',
  'competency:python-error-handling','APPLICATION','COMPLETED'
from phase1_integrity_workspaces where name='alice-bootstrap';

select throws_ok(
  $$update targets.target_requirement_rules
      set workspace_id=null
    where requirement_rule_id='c2000000-0000-4000-8000-000000000011'$$,
  '23514','target requirement workspace must match its profile version',
  'workspace requirement rule cannot be converted into canonical-looking data'
);
select throws_ok(
  $$update targets.target_requirement_members
      set workspace_id=null
    where requirement_rule_id='c2000000-0000-4000-8000-000000000011'$$,
  '23514','target requirement workspace must match its profile version',
  'workspace requirement member cannot be converted into canonical-looking data'
);

select throws_ok(
  format(
    'insert into overlay.custom_activities(workspace_id,profile_version_id,activity_key,title,activity_type,target_competency_ref) values(%L::uuid,%L::uuid,%L,%L,%L,%L)',
    (select workspace_id from phase1_integrity_workspaces where name='alice-bootstrap'),
    'c1010000-0000-4000-8000-000000000012','activity:foreign-profile-test',
    'Foreign profile test','MANUAL_CODING','competency:python-error-handling'
  ),
  '23514','custom activity workspace must match its target profile',
  'custom activity cannot point at another workspace profile'
);
select throws_ok(
  format(
    'insert into overlay.custom_activities(workspace_id,profile_version_id,activity_key,title,activity_type,target_competency_ref) values(%L::uuid,%L::uuid,%L,%L,%L,%L)',
    (select workspace_id from phase1_integrity_workspaces where name='alice-bootstrap'),
    'c1010000-0000-4000-8000-000000000011','activity:draft-profile-test',
    'Draft profile test','MANUAL_CODING','competency:python-error-handling'
  ),
  '23514','custom activity requires an immutable target profile version',
  'custom activity cannot point at a mutable draft profile'
);

insert into catalog.roadmap_template_series(roadmap_series_id,roadmap_series_key)
values('a2000000-0000-4000-8000-000000000080','roadmap-series:invalid-item-test');
insert into catalog.roadmap_template_versions(
  roadmap_version_id,roadmap_version_key,roadmap_series_id,catalog_version_id,
  version_number,changelog
) values(
  'a2010000-0000-4000-8000-000000000080','roadmap:invalid-item-test-v1',
  'a2000000-0000-4000-8000-000000000080','a1000000-0000-4000-8000-000000000001',
  1,'Invalid exact-catalog item fixture.'
);
insert into catalog.roadmap_template_items(roadmap_version_id,catalog_item_key,sort_order)
values('a2010000-0000-4000-8000-000000000080','competency:not-in-seed-catalog',1);
select throws_ok(
  $$update catalog.roadmap_template_items
      set roadmap_version_id='a2010000-0000-4000-8000-000000000080'
    where roadmap_version_id='a2010000-0000-4000-8000-000000000001'
      and catalog_item_key='competency:python-error-handling'$$,
  '55000','published roadmap content is immutable',
  'published roadmap item cannot be moved into a draft roadmap to bypass immutability'
);
select throws_ok(
  $$update catalog.roadmap_template_versions
      set lifecycle='published',published_at=clock_timestamp()
    where roadmap_version_id='a2010000-0000-4000-8000-000000000080'$$,
  '23514','roadmap item must exist in its exact catalog version',
  'roadmap publication rejects an item missing from its exact Catalog version'
);

insert into catalog.catalog_versions(
  catalog_version_id,catalog_version_key,version_number,changelog
) values(
  'a1000000-0000-4000-8000-000000000090','catalog:profile-draft-test',90,
  'Draft Catalog publication dependency fixture.'
);
select throws_ok(
  $$update catalog.items
      set catalog_version_id='a1000000-0000-4000-8000-000000000090'
    where catalog_version_id='a1000000-0000-4000-8000-000000000001'
      and item_key='competency:python-error-handling'$$,
  '55000','published catalog content is immutable',
  'published catalog item cannot be moved into a draft Catalog to bypass immutability'
);
select throws_ok(
  $$update catalog.competency_edges
      set catalog_version_id='a1000000-0000-4000-8000-000000000090'
    where catalog_version_id='a1000000-0000-4000-8000-000000000001'
      and edge_key='edge:prerequisite:python-data-model:python-error-handling'$$,
  '55000','published catalog content is immutable',
  'published Catalog edge cannot be moved into a draft Catalog to bypass immutability'
);
insert into targets.target_profile_series(
  profile_series_id,profile_series_key,profile_scope
) values(
  'b1000000-0000-4000-8000-000000000090','target-series:draft-catalog-test','canonical'
);
insert into targets.target_profile_versions(
  profile_version_id,profile_version_key,profile_series_id,catalog_version_id,
  version_number,role_title,source_summary,freshness_status,reviewed_at,
  root_rule_key,readiness_threshold
) values(
  'b1010000-0000-4000-8000-000000000090','target:draft-catalog-test-v1',
  'b1000000-0000-4000-8000-000000000090','a1000000-0000-4000-8000-000000000090',
  1,'Draft Catalog test','Publication dependency fixture.',
  'initial_curated_assumption','2026-08-26','rule:draft-catalog-root',0.8
);
select throws_ok(
  $$update targets.target_profile_versions
      set lifecycle='published',published_at=clock_timestamp()
    where profile_version_id='b1010000-0000-4000-8000-000000000090'$$,
  '23514','target profile requires a published catalog version',
  'target profile publication rejects a mutable draft Catalog version'
);

insert into catalog.catalog_versions(
  catalog_version_id,catalog_version_key,version_number,changelog
) values(
  'a1000000-0000-4000-8000-000000000091','catalog:roadmap-mismatch-test',91,
  'Published alternate Catalog for roadmap mismatch fixture.'
);
insert into catalog.items(
  catalog_version_id,item_key,item_type,slug,title,description,domain_item_key
) values
  ('a1000000-0000-4000-8000-000000000091','domain:mismatch-test','DOMAIN','mismatch-test','Mismatch test','Mismatch-test domain.',null),
  ('a1000000-0000-4000-8000-000000000091','competency:mismatch-test','COMPETENCY','mismatch-test-competency','Mismatch competency','Mismatch-test competency.','domain:mismatch-test');
update catalog.catalog_versions
set lifecycle='published',published_at=clock_timestamp()
where catalog_version_id='a1000000-0000-4000-8000-000000000091';
insert into catalog.roadmap_template_series(roadmap_series_id,roadmap_series_key)
values('a2000000-0000-4000-8000-000000000091','roadmap-series:mismatch-test');
insert into catalog.roadmap_template_versions(
  roadmap_version_id,roadmap_version_key,roadmap_series_id,catalog_version_id,
  version_number,changelog
) values(
  'a2010000-0000-4000-8000-000000000091','roadmap:mismatch-test-v1',
  'a2000000-0000-4000-8000-000000000091','a1000000-0000-4000-8000-000000000091',
  1,'Published alternate roadmap fixture.'
);
insert into catalog.roadmap_template_items(roadmap_version_id,catalog_item_key,sort_order)
values('a2010000-0000-4000-8000-000000000091','competency:mismatch-test',1);
update catalog.roadmap_template_versions
set lifecycle='published',published_at=clock_timestamp()
where roadmap_version_id='a2010000-0000-4000-8000-000000000091';
insert into targets.target_profile_series(
  profile_series_id,profile_series_key,profile_scope
) values(
  'b1000000-0000-4000-8000-000000000091','target-series:roadmap-mismatch-test','canonical'
);
insert into targets.target_profile_versions(
  profile_version_id,profile_version_key,profile_series_id,catalog_version_id,
  roadmap_version_id,version_number,role_title,source_summary,freshness_status,
  reviewed_at,root_rule_key,readiness_threshold
) values(
  'b1010000-0000-4000-8000-000000000091','target:roadmap-mismatch-test-v1',
  'b1000000-0000-4000-8000-000000000091','a1000000-0000-4000-8000-000000000001',
  'a2010000-0000-4000-8000-000000000091',1,'Roadmap mismatch test',
  'Publication dependency fixture.','initial_curated_assumption','2026-08-26',
  'rule:roadmap-mismatch-root',0.8
);
select throws_ok(
  $$update targets.target_profile_versions
      set lifecycle='published',published_at=clock_timestamp()
    where profile_version_id='b1010000-0000-4000-8000-000000000091'$$,
  '23514','target profile roadmap must be published against the same catalog version',
  'target profile publication rejects a roadmap from another Catalog version'
);

update targets.target_profile_series
set lifecycle='retired'
where profile_series_id='b1000000-0000-4000-8000-000000000001';

select set_config('request.jwt.claims',jsonb_build_object('sub','10000000-0000-4000-8000-000000000011','role','authenticated','aud','authenticated','exp',extract(epoch from clock_timestamp()+interval '1 hour')::bigint)::text,true);
set local role authenticated;
insert into phase1_integrity_results values(
  'alice-available-after-series-retire',api.get_available_target_profiles(
    (select workspace_id from phase1_integrity_workspaces where name='alice-bootstrap')
  )
);
select throws_ok(
  format(
    'select api.create_readiness_goal(%L::uuid,%L,%L,%L,%L)',
    (select workspace_id from phase1_integrity_workspaces where name='alice-bootstrap'),
    'goal:retired-series-new','Retired series new goal',
    'target:nvidia-python-verification-base-v1','phase1-retired-series-new-goal'
  ),
  '42501','target profile is not accessible',
  'published profile in a retired series cannot be selected for a new readiness goal'
);
insert into phase1_integrity_results values(
  'alice-activity-after-series-retire',api.add_custom_activity(
    (select workspace_id from phase1_integrity_workspaces where name='alice-bootstrap'),
    'target:nvidia-python-verification-base-v1','activity:retired-series-practice',
    'Retired series practice','MANUAL_CODING','competency:python-error-handling',0,
    'phase1-retired-series-activity'
  )
);
reset role;

update targets.target_profile_versions
set lifecycle='retired'
where profile_version_id='b1010000-0000-4000-8000-000000000001';

select throws_ok(
  $$insert into targets.target_profile_versions(
      profile_version_id,profile_version_key,profile_series_id,catalog_version_id,
      version_number,role_title,source_summary,freshness_status,reviewed_at,
      root_rule_key,readiness_threshold
    ) values(
      'b1010000-0000-4000-8000-000000000099','target:retired-series-draft-test',
      'b1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001',
      99,'Retired series draft test','Retired-series fixture.',
      'initial_curated_assumption','2026-08-26','rule:retired-series-root',0.8
    )$$,
  '23514','target profile series must be active',
  'retired target profile series cannot receive a new draft version'
);

update targets.target_profile_series
set lifecycle='retired'
where profile_series_id='c1000000-0000-4000-8000-000000000012';
update targets.target_profile_versions
set lifecycle='retired'
where profile_version_id='c1010000-0000-4000-8000-000000000012';
select is(
  (select lifecycle from targets.target_profile_versions
    where profile_version_id='c1010000-0000-4000-8000-000000000012'),
  'retired',
  'workspace profile can retire after its exact canonical base and series retire'
);

set local role authenticated;
insert into phase1_integrity_results values(
  'alice-profile-after-retire',api.get_target_profile(
    (select workspace_id from phase1_integrity_workspaces where name='alice-bootstrap'),
    'target:nvidia-python-verification-base-v1'
  )
);
insert into phase1_integrity_results values(
  'alice-explore-after-retire',api.get_explore_source_v1(
    (select workspace_id from phase1_integrity_workspaces where name='alice-bootstrap'),
    'goal:integrity-alice',null
  )
);
insert into phase1_integrity_results values(
  'alice-position-after-retire',api.set_overlay_position(
    (select workspace_id from phase1_integrity_workspaces where name='alice-bootstrap'),
    'goal:integrity-alice','competency:python-error-handling',10,20,1,
    'phase1-retired-position-set'
  )
);
insert into phase1_integrity_results values(
  'alice-reset-after-retire',api.reset_overlay_position(
    (select workspace_id from phase1_integrity_workspaces where name='alice-bootstrap'),
    'goal:integrity-alice','competency:python-error-handling',2,
    'phase1-retired-position-reset'
  )
);
insert into phase1_integrity_results values(
  'alice-activity-after-retire',api.add_custom_activity(
    (select workspace_id from phase1_integrity_workspaces where name='alice-bootstrap'),
    'target:nvidia-python-verification-base-v1','activity:retired-profile-practice',
    'Retired profile practice','MANUAL_CODING','competency:python-error-handling',3,
    'phase1-retired-profile-activity'
  )
);
select throws_ok(
  format(
    'select api.create_readiness_goal(%L::uuid,%L,%L,%L,%L)',
    (select workspace_id from phase1_integrity_workspaces where name='alice-bootstrap'),
    'goal:retired-profile-new','Retired profile new goal',
    'target:nvidia-python-verification-base-v1','phase1-retired-new-goal'
  ),
  '42501','target profile is not accessible',
  'retired profile cannot be selected for a new readiness goal'
);
reset role;

select ok(
  not jsonb_path_exists(
    (select response from phase1_integrity_results where name='alice-available-after-series-retire'),
    '$.profiles[*] ? (@.profileVersionKey == "target:nvidia-python-verification-base-v1")'
  ),
  'published profile in a retired series is absent from new-selection results'
);
select is(
  (select response->>'profileVersionKey' from phase1_integrity_results where name='alice-profile-after-retire'),
  'target:nvidia-python-verification-base-v1',
  'retired exact profile remains readable for retained history'
);
select is(
  jsonb_array_length((select response->'nodes' from phase1_integrity_results where name='alice-explore-after-retire')),
  24,
  'existing readiness goal still resolves its retired exact profile graph'
);
select is(
  (select (response->>'overlayVersion')::bigint from phase1_integrity_results where name='alice-activity-after-series-retire'),
  1::bigint,
  'an active retained goal can still receive workspace activities after only its profile series retires'
);
select is(
  (select (response->>'overlayVersion')::bigint from phase1_integrity_results where name='alice-position-after-retire'),
  2::bigint,
  'position command remains available for an existing goal pinned to a retired profile'
);
select is(
  (select (response->>'overlayVersion')::bigint from phase1_integrity_results where name='alice-reset-after-retire'),
  3::bigint,
  'position reset remains available for an existing goal pinned to a retired profile'
);
select is(
  (select (response->>'overlayVersion')::bigint from phase1_integrity_results where name='alice-activity-after-retire'),
  4::bigint,
  'an active retained goal can still receive workspace activities on its retired exact profile'
);

select * from finish();
rollback;
