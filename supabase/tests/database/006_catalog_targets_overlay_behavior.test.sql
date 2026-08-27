begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into auth.users (id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
('10000000-0000-4000-8000-000000000001','authenticated','authenticated','phase1-alice@pando.test','',clock_timestamp(),'{"provider":"email","providers":["email"]}'::jsonb,'{}',clock_timestamp(),clock_timestamp()),
('10000000-0000-4000-8000-000000000002','authenticated','authenticated','phase1-bob@pando.test','',clock_timestamp(),'{"provider":"email","providers":["email"]}'::jsonb,'{}',clock_timestamp(),clock_timestamp());
create temporary table phase1_results(name text primary key,response jsonb not null);
grant select,insert on phase1_results to authenticated;

select set_config('request.jwt.claims',jsonb_build_object('sub','10000000-0000-4000-8000-000000000001','role','authenticated','aud','authenticated','exp',extract(epoch from clock_timestamp()+interval '1 hour')::bigint)::text,true);
set local role authenticated;
insert into phase1_results select 'alice-bootstrap',api.bootstrap_personal_workspace('phase1-alice-bootstrap','Alice Phase 1');
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub','10000000-0000-4000-8000-000000000002','role','authenticated','aud','authenticated','exp',extract(epoch from clock_timestamp()+interval '1 hour')::bigint)::text,true);
set local role authenticated;
insert into phase1_results select 'bob-bootstrap',api.bootstrap_personal_workspace('phase1-bob-bootstrap','Bob Phase 1');
reset role;

create temporary table phase1_workspaces as
select name, (response->>'workspace_id')::uuid workspace_id from phase1_results where name like '%-bootstrap';
grant select on phase1_workspaces to authenticated;

insert into overlay.personal_competencies(workspace_id,competency_key,domain_item_key,title,provenance)
select workspace_id,'competency:linux-log-triage','domain:linux','Linux log triage','Accepted Alice-only pgTAP fixture.' from phase1_workspaces where name='alice-bootstrap';
insert into overlay.personal_edges(workspace_id,edge_key,source_node_ref,target_node_ref,edge_type,rationale)
select workspace_id,'edge:user-added:linux-log-triage:linux-process-debugging','competency:linux-log-triage','competency:linux-process-debugging','USER_ADDED','Log triage supports process debugging.' from phase1_workspaces where name='alice-bootstrap';

insert into targets.target_profile_series(profile_series_id,profile_series_key,profile_scope,workspace_id)
select 'c1000000-0000-4000-8000-000000000001','target-series:nvidia-python-verification-alice','workspace',workspace_id from phase1_workspaces where name='alice-bootstrap';
insert into targets.target_profile_versions(profile_version_id,profile_version_key,profile_series_id,workspace_id,base_profile_version_id,catalog_version_id,roadmap_version_id,version_number,lifecycle,role_title,company_name,source_summary,freshness_status,reviewed_at,root_rule_key,readiness_threshold)
select 'c1010000-0000-4000-8000-000000000001','target:nvidia-python-verification-v1','c1000000-0000-4000-8000-000000000001',workspace_id,'b1010000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','a2010000-0000-4000-8000-000000000001',1,'draft','Alice NVIDIA Python and Verification readiness','NVIDIA','Workspace fixture based on canonical profile plus accepted personal Linux proof.','initial_curated_assumption','2026-08-26','rule:target-root',0.8 from phase1_workspaces where name='alice-bootstrap';
create temporary table phase1_rule_map as
select requirement_rule_id old_id,gen_random_uuid() new_id,rule_key from targets.target_requirement_rules where profile_version_id='b1010000-0000-4000-8000-000000000001';
insert into targets.target_requirement_rules(requirement_rule_id,profile_version_id,workspace_id,rule_key,rule_type,title,criticality,explanation,accessibility_label,required_count,threshold)
select map.new_id,'c1010000-0000-4000-8000-000000000001',workspace.workspace_id,rule.rule_key,rule.rule_type,rule.title,rule.criticality,rule.explanation,rule.accessibility_label,rule.required_count,rule.threshold
from targets.target_requirement_rules rule join phase1_rule_map map on map.old_id=rule.requirement_rule_id cross join (select workspace_id from phase1_workspaces where name='alice-bootstrap') workspace
where rule.profile_version_id='b1010000-0000-4000-8000-000000000001';
insert into targets.target_requirement_members(profile_version_id,workspace_id,requirement_rule_id,member_order,member_type,node_scope,node_kind,node_ref,referenced_rule_id,objective_dimension,required_level,member_weight)
select 'c1010000-0000-4000-8000-000000000001',workspace.workspace_id,owner_map.new_id,member.member_order,member.member_type,member.node_scope,member.node_kind,member.node_ref,referenced_map.new_id,member.objective_dimension,member.required_level,member.member_weight
from targets.target_requirement_members member join phase1_rule_map owner_map on owner_map.old_id=member.requirement_rule_id left join phase1_rule_map referenced_map on referenced_map.old_id=member.referenced_rule_id cross join (select workspace_id from phase1_workspaces where name='alice-bootstrap') workspace
where member.profile_version_id='b1010000-0000-4000-8000-000000000001';
insert into targets.target_requirement_members(profile_version_id,workspace_id,requirement_rule_id,member_order,member_type,node_scope,node_kind,node_ref,objective_dimension,required_level)
select 'c1010000-0000-4000-8000-000000000001',workspace.workspace_id,map.new_id,2,'NODE','workspace_overlay','COMPETENCY','competency:linux-log-triage','APPLICATION','VERIFIED'
from phase1_rule_map map cross join (select workspace_id from phase1_workspaces where name='alice-bootstrap') workspace where map.rule_key='rule:any-practical-proof';
update targets.target_profile_versions set lifecycle='published',published_at='2026-08-26T01:00:00Z' where profile_version_id='c1010000-0000-4000-8000-000000000001';

select set_config('request.jwt.claims',jsonb_build_object('sub','10000000-0000-4000-8000-000000000001','role','authenticated','aud','authenticated','exp',extract(epoch from clock_timestamp()+interval '1 hour')::bigint)::text,true);
set local role authenticated;
insert into phase1_results select 'alice-goal-main',api.create_readiness_goal(workspace_id,'goal:alice-main','Alice main readiness','target:nvidia-python-verification-v1','alice-goal-main') from phase1_workspaces where name='alice-bootstrap';
insert into phase1_results select 'alice-goal-alt',api.create_readiness_goal(workspace_id,'goal:alice-alt','Alice alternate view','target:nvidia-python-verification-v1','alice-goal-alt') from phase1_workspaces where name='alice-bootstrap';
insert into phase1_results select 'alice-goal-main-replay',api.create_readiness_goal(workspace_id,'goal:alice-main','Alice main readiness','target:nvidia-python-verification-v1','alice-goal-main') from phase1_workspaces where name='alice-bootstrap';
select throws_ok(
  format('select api.create_readiness_goal(%L::uuid,%L,%L,%L,%L)',(select workspace_id from phase1_workspaces where name='alice-bootstrap'),'goal:alice-main','Changed title must conflict','target:nvidia-python-verification-v1','alice-goal-main'),
  '22023','idempotency key reused with a different request',
  'readiness-goal idempotency key rejects a changed request'
);
insert into phase1_results select 'alice-profiles',api.get_available_target_profiles(workspace_id) from phase1_workspaces where name='alice-bootstrap';
insert into phase1_results select 'alice-explore-initial',api.get_current_explore_source_v1('goal:alice-main',null) from phase1_workspaces where name='alice-bootstrap';
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub','10000000-0000-4000-8000-000000000002','role','authenticated','aud','authenticated','exp',extract(epoch from clock_timestamp()+interval '1 hour')::bigint)::text,true);
set local role authenticated;
insert into phase1_results select 'bob-goal',api.create_readiness_goal(workspace_id,'goal:bob-main','Bob canonical readiness','target:nvidia-python-verification-base-v1','bob-goal') from phase1_workspaces where name='bob-bootstrap';
insert into phase1_results select 'bob-profiles',api.get_available_target_profiles(workspace_id) from phase1_workspaces where name='bob-bootstrap';
insert into phase1_results select 'bob-explore',api.get_current_explore_source_v1('goal:bob-main',null) from phase1_workspaces where name='bob-bootstrap';
select throws_ok($$select api.get_current_explore_source_v1('goal:alice-main')$$,'42501','readiness goal is not accessible','Bob cannot read Alice Explore source through the current-personal query');
select throws_ok(format('select targets.get_explore_selection_impl(%L::uuid,%L)',(select workspace_id from phase1_workspaces where name='alice-bootstrap'),'goal:alice-main'),'42501','workspace is not accessible','Targets Explore owner query repeats foreign-workspace authorization');
select throws_ok(format('select overlay.get_explore_overlay_source_impl(%L::uuid,%L::uuid,%L::uuid,null,array[]::text[])',(select workspace_id from phase1_workspaces where name='alice-bootstrap'),'c1010000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000003'),'42501','workspace is not accessible','Overlay Explore owner query repeats foreign-workspace authorization');
select throws_ok(format('select targets.get_profile_impl(%L::uuid,%L)',(select workspace_id from phase1_workspaces where name='alice-bootstrap'),'target:nvidia-python-verification-v1'),'42501','workspace is not accessible','direct private implementation repeats foreign-workspace authorization');
select throws_ok(format('select api.get_target_profile(%L::uuid,%L)',(select workspace_id from phase1_workspaces where name='bob-bootstrap'),'target:nvidia-python-verification-v1'),'42501','target profile is not accessible','Bob cannot infer Alice workspace profile through his workspace');
reset role;

select is(jsonb_array_length((select response->'profiles' from phase1_results where name='alice-profiles')),2,'Alice sees canonical base plus her workspace profile');
select is((select response from phase1_results where name='alice-goal-main-replay'),(select response from phase1_results where name='alice-goal-main'),'readiness-goal retry returns its stored response byte-for-byte');
select is(jsonb_array_length((select response->'profiles' from phase1_results where name='bob-profiles')),1,'Bob sees canonical base only');
select ok(not ((select response->'profiles' from phase1_results where name='bob-profiles') @> '[{"profileVersionKey":"target:nvidia-python-verification-v1"}]'::jsonb),'Bob profile list contains no Alice workspace profile');
select is(((select response from phase1_results where name='alice-explore-initial')->>'nodeCount')::int,25,'Alice default Explore has exactly 25 nodes');
select is(((select response from phase1_results where name='alice-explore-initial')->>'edgeCount')::int,35,'Alice default Explore has exactly 35 edges');
select is((select response->'contract'->>'name' from phase1_results where name='alice-explore-initial'),'ExploreSourceV1','Explore source declares its versioned contract name');
select is((select response->'contract'->>'version' from phase1_results where name='alice-explore-initial'),'1.0.0','Explore source declares its exact contract version');
select is((select response->>'readinessGoalId' from phase1_results where name='alice-explore-initial'),(select readiness_goal_id::text from targets.readiness_goals where readiness_goal_key='goal:alice-main'),'Explore source carries the exact selected readiness-goal identity');
select is((select response->>'targetProfileVersionId' from phase1_results where name='alice-explore-initial'),'c1010000-0000-4000-8000-000000000001','Explore source carries the exact immutable target-profile identity');
select is(((select response from phase1_results where name='bob-explore')->>'nodeCount')::int,24,'Bob canonical Explore has exactly 24 nodes');
select is(((select response from phase1_results where name='bob-explore')->>'edgeCount')::int,33,'Bob canonical Explore has exactly 33 edges');
select ok((select response->'nodes' from phase1_results where name='alice-explore-initial') @> '[{"nodeRef":"competency:linux-log-triage","origin":"WORKSPACE_OVERLAY"}]'::jsonb,'Alice Explore contains accepted personal Linux competency');
select ok(not ((select response->'nodes' from phase1_results where name='bob-explore') @> '[{"nodeRef":"competency:linux-log-triage"}]'::jsonb),'Bob Explore contains no Alice personal competency');

select set_config('request.jwt.claims',jsonb_build_object('sub','10000000-0000-4000-8000-000000000001','role','authenticated','aud','authenticated','exp',extract(epoch from clock_timestamp()+interval '1 hour')::bigint)::text,true);
set local role authenticated;
insert into phase1_results values ('note-first',api.save_current_overlay_note_v1('goal:alice-main','competency:linux-log-triage','Private note sentinel: rain-forest-42','0','alice-note-1'));
insert into phase1_results values ('note-replay',api.save_current_overlay_note_v1('goal:alice-main','competency:linux-log-triage','Private note sentinel: rain-forest-42','0','alice-note-1'));
insert into phase1_results values ('note-read',api.get_current_competency_overlay_v1('goal:alice-main','competency:linux-log-triage'));
select throws_ok($$select api.save_current_overlay_note_v1('goal:alice-main','competency:python-typing','Stale write must roll back','0','alice-note-stale')$$,'40001','overlay aggregate version conflict','stale expected overlay version rejects the entire note command');
reset role;
select is((select response from phase1_results where name='note-replay'),(select response from phase1_results where name='note-first'),'same note retry returns stored response byte-for-byte');
select is((select response->'note'->>'body' from phase1_results where name='note-read'),'Private note sentinel: rain-forest-42','purpose-specific note read returns persisted body after command reload');
select is((select aggregate_version from overlay.workspace_overlays where workspace_id=(select workspace_id from phase1_workspaces where name='alice-bootstrap')),1::bigint,'note replay and stale write leave one overlay version increment');
select is((select count(*) from outbox.command_receipts where idempotency_key='alice-note-1'),1::bigint,'note replay creates one receipt');
select is((select count(*) from outbox.command_receipts where idempotency_key='alice-note-stale'),0::bigint,'stale note creates no receipt');
select is((select count(*) from outbox.events where event_name='overlay.note_saved' and workspace_id=(select workspace_id from phase1_workspaces where name='alice-bootstrap')),1::bigint,'note replay and stale attempt create only one note event');
select ok(not exists(select 1 from outbox.events where event_name='overlay.note_saved' and payload::text like '%rain-forest-42%'),'note bodies are redacted from event payloads');
select ok(not exists(select 1 from outbox.command_receipts where command_type='overlay.save_note' and response::text like '%rain-forest-42%'),'note bodies are redacted from receipt responses');

select set_config('request.jwt.claims',jsonb_build_object('sub','10000000-0000-4000-8000-000000000001','role','authenticated','aud','authenticated','exp',extract(epoch from clock_timestamp()+interval '1 hour')::bigint)::text,true);
set local role authenticated;
select throws_ok(
  $$select api.add_current_custom_activity_v1('goal:alice-main','activity:unsafe-control-title',E'Unsafe\nactivity title','MANUAL_CODING','competency:linux-log-triage','1','alice-activity-unsafe-title')$$,
  '23514','new row for relation "custom_activities" violates check constraint "custom_activities_title_safe_text_check"',
  'custom activity title cannot persist control characters that violate ExploreSourceV1'
);
select throws_ok(
  $$select api.add_current_custom_activity_v1('goal:alice-main','activity:unsafe-markup-title','Unsafe <activity> title','MANUAL_CODING','competency:linux-log-triage','1','alice-activity-unsafe-markup')$$,
  '23514','new row for relation "custom_activities" violates check constraint "custom_activities_title_safe_text_check"',
  'custom activity title cannot persist markup delimiters forbidden by GraphProjectionV1'
);
insert into phase1_results values ('activity-add',api.add_current_custom_activity_v1('goal:alice-main','activity:linux-log-triage-lab','Linux log triage lab','MANUAL_CODING','competency:linux-log-triage','1','alice-activity-1'));
insert into phase1_results values ('activity-add-replay',api.add_current_custom_activity_v1('goal:alice-main','activity:linux-log-triage-lab','Linux log triage lab','MANUAL_CODING','competency:linux-log-triage','1','alice-activity-1'));
insert into phase1_results values ('activity-detail-after-add',api.get_current_competency_overlay_v1('goal:alice-main','competency:linux-log-triage'));
select throws_ok(
  $$select api.add_current_custom_activity_v1('goal:alice-main','activity:linux-log-triage-lab','Changed activity title','MANUAL_CODING','competency:linux-log-triage','1','alice-activity-1')$$,
  '22023','idempotency key reused with a different request',
  'custom-activity idempotency key rejects a changed request'
);
reset role;
update overlay.custom_activities
set lifecycle='paused'
where activity_key='activity:linux-log-triage-lab';
set local role authenticated;
insert into phase1_results values ('activity-detail-while-paused',api.get_current_competency_overlay_v1('goal:alice-main','competency:linux-log-triage'));
reset role;
update overlay.custom_activities
set lifecycle='active'
where activity_key='activity:linux-log-triage-lab';
set local role authenticated;
insert into phase1_results select 'alice-explore-default-after-activity',api.get_current_explore_source_v1('goal:alice-main',null) from phase1_workspaces where name='alice-bootstrap';
insert into phase1_results select 'alice-explore-selected',api.get_current_explore_source_v1('goal:alice-main','activity:linux-log-triage-lab') from phase1_workspaces where name='alice-bootstrap';
reset role;
select is((select count(*) from overlay.custom_activities where activity_key='activity:unsafe-control-title'),0::bigint,'unsafe activity title leaves no domain row');
select is((select count(*) from overlay.custom_activities where activity_key='activity:unsafe-markup-title'),0::bigint,'unsafe markup title leaves no domain row');
select is((select count(*) from outbox.command_receipts where idempotency_key='alice-activity-unsafe-title'),0::bigint,'unsafe activity title leaves no command receipt');
select is((select count(*) from outbox.command_receipts where idempotency_key='alice-activity-unsafe-markup'),0::bigint,'unsafe markup title leaves no command receipt');
select is(((select response from phase1_results where name='alice-explore-default-after-activity')->>'nodeCount')::int,25,'unselected custom activity is absent from default Explore nodes');
select is((select response from phase1_results where name='activity-add-replay'),(select response from phase1_results where name='activity-add'),'custom-activity retry returns its stored response byte-for-byte');
select is((select response->>'overlayVersion' from phase1_results where name='activity-detail-after-add'),'2','competency detail carries the current string overlay version after the command');
select ok((select response->'customActivities' from phase1_results where name='activity-detail-after-add') @> '[{"activityKey":"activity:linux-log-triage-lab","title":"Linux log triage lab","activityType":"MANUAL_CODING","lifecycle":"active"}]'::jsonb,'competency detail reload discovers the persisted custom activity');
select is((select response->'customActivities' from phase1_results where name='activity-detail-while-paused'),'[]'::jsonb,'competency detail excludes a legal paused activity instead of breaking its active-only contract');
select is(((select response from phase1_results where name='alice-explore-default-after-activity')->>'edgeCount')::int,35,'unselected custom activity edge is absent from default Explore');
select is(((select response from phase1_results where name='alice-explore-selected')->>'nodeCount')::int,26,'selected custom activity adds exactly one node');
select is(((select response from phase1_results where name='alice-explore-selected')->>'edgeCount')::int,36,'selected custom activity adds exactly one ACTIVITY_EVIDENCES edge');
select ok((select response->'nodes' from phase1_results where name='alice-explore-selected') @> '[{"nodeRef":"activity:linux-log-triage-lab","targetCompetencyRef":"competency:linux-log-triage"}]'::jsonb,'selected activity points to the accepted personal competency');
select ok((select response->'edges' from phase1_results where name='alice-explore-selected') @> '[{"edgeType":"ACTIVITY_EVIDENCES","sourceRef":"activity:linux-log-triage-lab","targetRef":"competency:linux-log-triage"}]'::jsonb,'selected activity projection has one explicit evidence mapping');
select ok((select response->'edges' from phase1_results where name='alice-explore-selected') @> jsonb_build_array(jsonb_build_object('edgeType','ACTIVITY_EVIDENCES','workspaceId',(select workspace_id from phase1_workspaces where name='alice-bootstrap'))),'selected activity edge proves its workspace provenance');
select ok(position('rain-forest-42' in (select response::text from phase1_results where name='alice-explore-selected'))=0,'Explore source never contains free-form note bodies');

select set_config('request.jwt.claims',jsonb_build_object('sub','10000000-0000-4000-8000-000000000002','role','authenticated','aud','authenticated','exp',extract(epoch from clock_timestamp()+interval '1 hour')::bigint)::text,true);
set local role authenticated;
select throws_ok($$select api.get_current_competency_overlay_v1('goal:alice-main','competency:linux-log-triage')$$,'42501','readiness goal is not accessible','Bob cannot read Alice note through the current-personal query');
select throws_ok($$select api.get_current_explore_source_v1('goal:bob-main','activity:linux-log-triage-lab')$$,'42501','activity is not accessible','Bob cannot select Alice custom activity in his canonical graph');
select throws_ok(format('select api.create_readiness_goal(%L::uuid,%L,%L,%L,%L)',(select workspace_id from phase1_workspaces where name='alice-bootstrap'),'goal:bob-foreign','Foreign goal','target:nvidia-python-verification-v1','bob-foreign-goal'),'42501','workspace is not accessible','Bob cannot create a readiness goal in Alice workspace');
select throws_ok($$select api.save_current_overlay_note_v1('goal:alice-main','competency:linux-log-triage','Foreign note','2','bob-foreign-note')$$,'42501','readiness goal is not accessible','Bob cannot save a note in Alice workspace');
select throws_ok($$select api.add_current_custom_activity_v1('goal:alice-main','activity:bob-foreign','Foreign activity','MANUAL_CODING','competency:linux-log-triage','2','bob-foreign-activity')$$,'42501','readiness goal is not accessible','Bob cannot add an activity in Alice workspace');
select throws_ok(format('select api.set_overlay_position(%L::uuid,%L,%L,1,2,2,%L)',(select workspace_id from phase1_workspaces where name='alice-bootstrap'),'goal:alice-main','competency:linux-log-triage','bob-foreign-position'),'42501','workspace is not accessible','Bob cannot set a position in Alice workspace');
select throws_ok(format('select api.reset_overlay_position(%L::uuid,%L,%L,2,%L)',(select workspace_id from phase1_workspaces where name='alice-bootstrap'),'goal:alice-main','competency:linux-log-triage','bob-foreign-reset'),'42501','workspace is not accessible','Bob cannot reset a position in Alice workspace');
reset role;
select is((select count(*) from outbox.command_receipts where idempotency_key like 'bob-foreign-%'),0::bigint,'foreign-workspace write attempts create no command receipts');
select is((select count(*) from targets.readiness_goals where readiness_goal_key='goal:bob-foreign'),0::bigint,'foreign-workspace goal attempt creates no authoritative row');
select is((select count(*) from overlay.custom_activities where activity_key='activity:bob-foreign'),0::bigint,'foreign-workspace activity attempt creates no authoritative row');
select is((select note_body from overlay.notes where workspace_id=(select workspace_id from phase1_workspaces where name='alice-bootstrap') and subject_ref='competency:linux-log-triage'),'Private note sentinel: rain-forest-42','foreign-workspace note attempt leaves Alice note unchanged');
select is((select count(*) from overlay.positions where workspace_id=(select workspace_id from phase1_workspaces where name='alice-bootstrap')),0::bigint,'foreign-workspace position attempts create no authoritative rows');

select set_config('request.jwt.claims',jsonb_build_object('sub','10000000-0000-4000-8000-000000000001','role','authenticated','aud','authenticated','exp',extract(epoch from clock_timestamp()+interval '1 hour')::bigint)::text,true);
set local role authenticated;
insert into phase1_results select 'position-main',api.set_overlay_position(workspace_id,'goal:alice-main','competency:linux-log-triage',10,20,2,'alice-position-main') from phase1_workspaces where name='alice-bootstrap';
insert into phase1_results select 'position-alt',api.set_overlay_position(workspace_id,'goal:alice-alt','competency:linux-log-triage',30,40,3,'alice-position-alt') from phase1_workspaces where name='alice-bootstrap';
insert into phase1_results select 'position-main-replay',api.set_overlay_position(workspace_id,'goal:alice-main','competency:linux-log-triage',10,20,2,'alice-position-main') from phase1_workspaces where name='alice-bootstrap';
select throws_ok(
  format('select api.set_overlay_position(%L::uuid,%L,%L,11,20,2,%L)',(select workspace_id from phase1_workspaces where name='alice-bootstrap'),'goal:alice-main','competency:linux-log-triage','alice-position-main'),
  '22023','idempotency key reused with a different request',
  'set-position idempotency key rejects changed coordinates'
);
insert into phase1_results select 'explore-main-positioned',api.get_current_explore_source_v1('goal:alice-main',null) from phase1_workspaces where name='alice-bootstrap';
insert into phase1_results select 'explore-alt-positioned',api.get_current_explore_source_v1('goal:alice-alt',null) from phase1_workspaces where name='alice-bootstrap';
insert into phase1_results select 'position-main-reset',api.reset_overlay_position(workspace_id,'goal:alice-main','competency:linux-log-triage',4,'alice-position-main-reset') from phase1_workspaces where name='alice-bootstrap';
insert into phase1_results select 'position-main-reset-replay',api.reset_overlay_position(workspace_id,'goal:alice-main','competency:linux-log-triage',4,'alice-position-main-reset') from phase1_workspaces where name='alice-bootstrap';
select throws_ok(
  format('select api.reset_overlay_position(%L::uuid,%L,%L,4,%L)',(select workspace_id from phase1_workspaces where name='alice-bootstrap'),'goal:alice-main','competency:python-error-handling','alice-position-main-reset'),
  '22023','idempotency key reused with a different request',
  'reset-position idempotency key rejects a changed node'
);
insert into phase1_results select 'explore-main-reset',api.get_current_explore_source_v1('goal:alice-main',null) from phase1_workspaces where name='alice-bootstrap';
insert into phase1_results select 'explore-alt-after-main-reset',api.get_current_explore_source_v1('goal:alice-alt',null) from phase1_workspaces where name='alice-bootstrap';
insert into phase1_results values ('note-replay-late',api.save_current_overlay_note_v1('goal:alice-main','competency:linux-log-triage','Private note sentinel: rain-forest-42','0','alice-note-1'));
insert into phase1_results select 'persisted-read-a',api.get_current_explore_source_v1('goal:alice-main','activity:linux-log-triage-lab') from phase1_workspaces where name='alice-bootstrap';
insert into phase1_results select 'persisted-read-b',api.get_current_explore_source_v1('goal:alice-main','activity:linux-log-triage-lab') from phase1_workspaces where name='alice-bootstrap';
reset role;

select is(jsonb_array_length((select response->'positions' from phase1_results where name='explore-main-positioned')),1,'main readiness goal exposes exactly its own position');
select is((select response from phase1_results where name='position-main-replay'),(select response from phase1_results where name='position-main'),'set-position retry returns its stored response byte-for-byte');
select is(jsonb_array_length((select response->'positions' from phase1_results where name='explore-alt-positioned')),1,'alternate readiness goal exposes exactly its own position');
select is((((select response->'positions'->0 from phase1_results where name='explore-main-positioned')->>'x')::numeric),10::numeric,'main goal keeps its own x coordinate');
select is((select response->'positions'->0->>'workspaceId' from phase1_results where name='explore-main-positioned'),(select workspace_id::text from phase1_workspaces where name='alice-bootstrap'),'position proves its workspace scope');
select is((select response->'positions'->0->>'readinessGoalId' from phase1_results where name='explore-main-positioned'),(select readiness_goal_id::text from targets.readiness_goals where readiness_goal_key='goal:alice-main'),'position proves its exact readiness-goal scope');
select is((select response->'positions'->0->>'targetProfileVersionId' from phase1_results where name='explore-main-positioned'),'c1010000-0000-4000-8000-000000000001','position proves its exact target-profile scope');
select is((((select response->'positions'->0 from phase1_results where name='explore-alt-positioned')->>'x')::numeric),30::numeric,'alternate goal keeps an independent x coordinate for the same profile/node');
select is(jsonb_array_length((select response->'positions' from phase1_results where name='explore-main-reset')),0,'reset returns the selected main-goal node to canonical layout');
select is(jsonb_array_length((select response->'positions' from phase1_results where name='explore-alt-after-main-reset')),1,'resetting main goal preserves alternate-goal position');
select is((((select response->'positions'->0 from phase1_results where name='explore-alt-after-main-reset')->>'x')::numeric),30::numeric,'alternate-goal coordinate survives main-goal reset');
select is((select response->>'operation' from phase1_results where name='position-main-reset'),'reset','position reset reports an actual reset');
select is((select response from phase1_results where name='position-main-reset-replay'),(select response from phase1_results where name='position-main-reset'),'reset-position retry returns its stored response byte-for-byte');
select is((select aggregate_version from overlay.workspace_overlays where workspace_id=(select workspace_id from phase1_workspaces where name='alice-bootstrap')),5::bigint,'note, activity, two positions, and one reset produce exactly five overlay revisions');
select is((select response from phase1_results where name='note-replay-late'),(select response from phase1_results where name='note-first'),'idempotent note replay remains byte-identical after unrelated mutable overlay changes');
select is((select response from phase1_results where name='persisted-read-a'),(select response from phase1_results where name='persisted-read-b'),'Explore reload is deterministic from persisted Catalog/Targets/Overlay state');
select is(((select response from phase1_results where name='persisted-read-a')->>'nodeCount')::int,26,'persisted selected-activity reload retains exact node count');
select is(((select response from phase1_results where name='persisted-read-a')->>'edgeCount')::int,36,'persisted selected-activity reload retains exact edge count');
select is(jsonb_array_length((select response->'positions' from phase1_results where name='persisted-read-a')),0,'persisted main-goal reload observes canonical layout after reset');

select is((select count(*) from targets.readiness_goals),3::bigint,'two Alice goals and one Bob goal persist as separate Targets aggregates');
select is((select count(*) from overlay.positions where workspace_id=(select workspace_id from phase1_workspaces where name='alice-bootstrap')),1::bigint,'only alternate-goal position remains after main reset');
select is((
  select count(*) from outbox.deliveries delivery join outbox.events event on event.event_id=delivery.event_id
  where event.event_name='targets.readiness_goal_created'
    and delivery.consumer_name='targets.readiness_projection_v1'
    and delivery.handler_contract_version=1
),3::bigint,'each Phase 1 Target event now enqueues one fixed readiness projection delivery');
select ok(not exists(
  select 1 from outbox.deliveries delivery join outbox.events event on event.event_id=delivery.event_id
  where event.event_name in ('overlay.note_saved','overlay.custom_activity_added','overlay.position_set','overlay.position_reset')
),'Phase 1 Overlay events still enqueue zero deliveries without a real consumer');
select is((select count(*) from outbox.events where event_name='targets.readiness_goal_created'),3::bigint,'each readiness goal creates one immutable Target event');
select is((select count(*) from outbox.events where event_name='overlay.position_set'),2::bigint,'two goal-scoped position commands create two events');
select is((select count(*) from outbox.events where event_name='overlay.position_reset'),1::bigint,'one actual reset creates one event');
select is((select count(*) from outbox.command_receipts where command_type='targets.create_readiness_goal' and idempotency_key='alice-goal-main'),1::bigint,'readiness-goal replay and conflict retain one receipt');
select is((select count(*) from outbox.command_receipts where command_type='overlay.add_custom_activity' and idempotency_key='alice-activity-1'),1::bigint,'custom-activity replay and conflict retain one receipt');
select is((select count(*) from outbox.command_receipts where command_type='overlay.set_position' and idempotency_key='alice-position-main'),1::bigint,'set-position replay and conflict retain one receipt');
select is((select count(*) from outbox.command_receipts where command_type='overlay.reset_position' and idempotency_key='alice-position-main-reset'),1::bigint,'reset-position replay and conflict retain one receipt');
select ok(not exists(select 1 from outbox.events where workspace_id=(select workspace_id from phase1_workspaces where name='bob-bootstrap') and payload::text like '%linux-log-triage%'),'Bob event stream contains no Alice personal identifiers');

select * from finish();
rollback;
