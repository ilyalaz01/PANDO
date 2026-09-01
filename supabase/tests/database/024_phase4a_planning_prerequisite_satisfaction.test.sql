begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
create temporary table d1b_legacy_initializer_fixture_marker(marker boolean);
create function pg_temp.initialize_growth_plan_fixture_v1(
  p_readiness_goal_key text,
  p_weekly_capacity_minutes integer,
  p_default_session_minutes integer,
  p_track_priority integer,
  p_protected_minimum_minutes integer,
  p_idempotency_key text
)
returns jsonb
language sql
security definer
set search_path = ''
as $function$
  select api.initialize_growth_plan_v1(
    p_readiness_goal_key, p_weekly_capacity_minutes, p_default_session_minutes,
    p_track_priority, p_protected_minimum_minutes, p_idempotency_key
  )
$function$;
revoke all on function pg_temp.initialize_growth_plan_fixture_v1(
  text, integer, integer, integer, integer, text
) from public, anon, authenticated, service_role;
grant execute on function pg_temp.initialize_growth_plan_fixture_v1(
  text, integer, integer, integer, integer, text
) to authenticated;
select no_plan();

select ok(
  pg_catalog.has_function_privilege(
    'pando_planning_worker', 'catalog.read_planning_graph_source_v2(uuid[],text[])', 'EXECUTE'
  )
  and pg_catalog.has_function_privilege(
    'pando_planning_worker',
    'overlay.assert_planning_candidate_origins_v1(uuid,uuid[])', 'EXECUTE'
  )
  and pg_catalog.has_function_privilege(
    'pando_planning_worker',
    'mastery.read_planning_prerequisite_source_v1(uuid,text[],timestamptz)', 'EXECUTE'
  )
  and not pg_catalog.has_table_privilege(
    'pando_planning_worker', 'mastery.current_competency_states', 'SELECT'
  )
  and not pg_catalog.has_table_privilege(
    'pando_planning_worker', 'catalog.competency_edges', 'SELECT'
  ),
  'Planning receives prerequisites only through bounded Catalog and Mastery owner queries'
);

select ok(
  not pg_catalog.has_function_privilege(
    'authenticated', 'catalog.read_planning_graph_source_v2(uuid[],text[])', 'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'anon', 'mastery.read_planning_prerequisite_source_v1(uuid,text[],timestamptz)', 'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'service_role', 'mastery.read_planning_prerequisite_source_v1(uuid,text[],timestamptz)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated',
    'planning.load_plan_snapshot_source_bundle_pre_prerequisite_v1(uuid,timestamptz)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated', 'overlay.assert_planning_candidate_origins_v1(uuid,uuid[])', 'EXECUTE'
  ),
  'runtime roles cannot call the prerequisite sources or the private rollout wrapper'
);

select ok(
  not pg_catalog.has_table_privilege(
    'pando_mastery_planning_source', 'mastery.current_competency_states', 'SELECT'
  )
  and pg_catalog.has_column_privilege(
    'pando_mastery_planning_source', 'mastery.current_competency_states',
    'competency_ref', 'SELECT'
  )
  and not pg_catalog.has_table_privilege(
    'pando_mastery_planning_source', 'mastery.current_competency_states', 'UPDATE'
  )
  and not pg_catalog.has_schema_privilege('pando_mastery_planning_source', 'mastery', 'CREATE'),
  'the Mastery Planning source is column-minimal, read-only, and cannot create objects'
);

select ok(
  pg_catalog.to_regclass('catalog.competency_edges_planning_prerequisite_lookup') is not null,
  'the direct-prerequisite lookup has a dedicated bounded access path'
);

select ok(
  pg_catalog.to_regclass('catalog.competency_edges_planning_unlock_lookup') is not null
  and not pg_catalog.has_table_privilege(
    'pando_phase1_planning_source', 'catalog.competency_edges', 'SELECT'
  )
  and pg_catalog.has_column_privilege(
    'pando_phase1_planning_source', 'catalog.competency_edges',
    'from_competency_key', 'SELECT'
  )
  and not pg_catalog.has_table_privilege(
    'pando_phase1_planning_source', 'overlay.personal_competencies', 'SELECT'
  )
  and pg_catalog.has_column_privilege(
    'pando_phase1_planning_source', 'overlay.personal_competencies',
    'competency_key', 'SELECT'
  ),
  'Catalog reads are bounded and candidate-origin validation has column-minimal grants'
);

do $roles$
begin
  execute pg_catalog.format(
    'grant pando_planning_worker to %I with set true', current_user
  );
end
$roles$;

create temporary table c5_results (
  result_name text primary key,
  response jsonb not null
);
grant select, insert, update on c5_results to pando_planning_worker, authenticated;

set local role pando_planning_worker;
insert into c5_results values (
  'catalog-one', catalog.read_planning_graph_source_v2(
    array['a1000000-0000-4000-8000-000000000001'::uuid],
    array['competency:python-data-model']
  )
), (
  'catalog-duplicate', catalog.read_planning_graph_source_v2(
    array[
      'a1000000-0000-4000-8000-000000000001'::uuid,
      'a1000000-0000-4000-8000-000000000001'::uuid
    ],
    array['competency:python-data-model', 'competency:python-data-model']
  )
), (
  'catalog-personal', catalog.read_planning_graph_source_v2(
    array['a1000000-0000-4000-8000-000000000001'::uuid],
    array['competency:workspace-only']
  )
);
reset role;

select is(
  (select response#>>'{items,0,prerequisiteRefs,0}' from c5_results
   where result_name = 'catalog-one'),
  'competency:python-typing',
  'Catalog returns the exact direct incoming blocking prerequisite'
);
select is(
  (select pg_catalog.jsonb_array_length(response->'items') from c5_results
   where result_name = 'catalog-duplicate'),
  1,
  'duplicate candidate/version pairs are canonicalized to one graph answer'
);
select is(
  (select (response#>>'{items,0,prerequisiteCount}')::integer from c5_results
   where result_name = 'catalog-personal'),
  0,
  'a personal competency absent from Catalog has no invented canonical prerequisite'
);

set local role pando_planning_worker;
select throws_ok(
  $$select catalog.read_planning_graph_source_v2(array[null::uuid], array['competency:x'])$$,
  '22023', 'planning Catalog source input is invalid',
  'Catalog refuses null version identifiers'
);
select throws_ok(
  $$select catalog.read_planning_graph_source_v2(array[]::uuid[], array['bad'])$$,
  '22023', 'planning Catalog source input is invalid',
  'Catalog refuses mismatched and malformed inputs'
);
reset role;

-- A dedicated published fixture proves the 20-edge boundary without truncation.
insert into catalog.catalog_versions (
  catalog_version_id, catalog_version_key, version_number, lifecycle, changelog
) values (
  'c5000000-0000-4000-8000-000000000001', 'catalog:c5-prerequisite-bound', 9001,
  'draft', 'C5 direct prerequisite boundary fixture.'
);
insert into catalog.items (
  catalog_version_id, item_key, item_type, slug, title, description, domain_item_key
) values (
  'c5000000-0000-4000-8000-000000000001', 'domain:c5', 'DOMAIN', 'c5', 'C5',
  'C5 test domain.', null
), (
  'c5000000-0000-4000-8000-000000000001', 'competency:c5-target-20', 'COMPETENCY',
  'c5-target-20', 'Target 20', 'Twenty prerequisite target.', 'domain:c5'
), (
  'c5000000-0000-4000-8000-000000000001', 'competency:c5-target-21', 'COMPETENCY',
  'c5-target-21', 'Target 21', 'Twenty-one prerequisite target.', 'domain:c5'
);
insert into catalog.items (
  catalog_version_id, item_key, item_type, slug, title, description, domain_item_key, lifecycle
) values (
  'c5000000-0000-4000-8000-000000000001', 'competency:c5-retired', 'COMPETENCY',
  'c5-retired', 'Retired competency', 'Retired origin-collision fixture.', 'domain:c5',
  'retired'
);
insert into catalog.items (
  catalog_version_id, item_key, item_type, slug, title, description, domain_item_key
)
select 'c5000000-0000-4000-8000-000000000001'::uuid,
  'competency:c5-pre-' || pg_catalog.lpad(value::text, 2, '0'), 'COMPETENCY',
  'c5-pre-' || pg_catalog.lpad(value::text, 2, '0'), 'Prerequisite ' || value,
  'Generated direct prerequisite.', 'domain:c5'
from pg_catalog.generate_series(1, 21) as value;
insert into catalog.competency_edges (
  catalog_version_id, edge_key, from_competency_key, to_competency_key,
  edge_type, blocking, rationale
)
select 'c5000000-0000-4000-8000-000000000001'::uuid,
  'edge:prerequisite:c5-pre-' || pg_catalog.lpad(value::text, 2, '0') || ':target-20',
  'competency:c5-pre-' || pg_catalog.lpad(value::text, 2, '0'),
  'competency:c5-target-20', 'PREREQUISITE_OF', true, 'C5 twenty-edge fixture.'
from pg_catalog.generate_series(1, 20) as value
union all
select 'c5000000-0000-4000-8000-000000000001'::uuid,
  'edge:prerequisite:c5-pre-' || pg_catalog.lpad(value::text, 2, '0') || ':target-21',
  'competency:c5-pre-' || pg_catalog.lpad(value::text, 2, '0'),
  'competency:c5-target-21', 'PREREQUISITE_OF', true, 'C5 twenty-one-edge fixture.'
from pg_catalog.generate_series(1, 21) as value;
update catalog.catalog_versions
set lifecycle = 'published', published_at = '2026-08-01T00:00:00Z'
where catalog_version_id = 'c5000000-0000-4000-8000-000000000001';

set local role pando_planning_worker;
insert into c5_results values (
  'catalog-20', catalog.read_planning_graph_source_v2(
    array['c5000000-0000-4000-8000-000000000001'::uuid],
    array['competency:c5-target-20']
  )
);
select throws_ok(
  $$select catalog.read_planning_graph_source_v2(
    array['c5000000-0000-4000-8000-000000000001'::uuid],
    array['competency:c5-target-21']
  )$$,
  '54000', 'planning candidate exceeds 20 direct prerequisites',
  'Catalog refuses the twenty-first direct prerequisite instead of truncating it'
);
reset role;
select is(
  (select (response#>>'{items,0,prerequisiteCount}')::integer from c5_results
   where result_name = 'catalog-20'),
  20,
  'the exact twenty-prerequisite boundary remains supported'
);

-- Minimal tenancy plus immutable Mastery projections for claim-time classification.
insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'c5100000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'c5-a@pando.test', '', clock_timestamp(),
  '{"provider":"email","providers":["email"]}', '{}', clock_timestamp(), clock_timestamp()
), (
  'c5100000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
  'c5-b@pando.test', '', clock_timestamp(),
  '{"provider":"email","providers":["email"]}', '{}', clock_timestamp(), clock_timestamp()
);
insert into identity.users (user_id, auth_user_id) values
  ('c5110000-0000-4000-8000-000000000001', 'c5100000-0000-4000-8000-000000000001'),
  ('c5110000-0000-4000-8000-000000000002', 'c5100000-0000-4000-8000-000000000002');
insert into identity.workspaces (workspace_id, display_name, created_by_user_id) values
  ('c5120000-0000-4000-8000-000000000001', 'C5 workspace A',
   'c5110000-0000-4000-8000-000000000001'),
  ('c5120000-0000-4000-8000-000000000002', 'C5 workspace B',
   'c5110000-0000-4000-8000-000000000002');
insert into overlay.workspace_overlays (workspace_id) values
  ('c5120000-0000-4000-8000-000000000001'),
  ('c5120000-0000-4000-8000-000000000002');

insert into targets.target_profile_series (
  profile_series_id, profile_series_key, profile_scope, lifecycle
) values (
  'c5500000-0000-4000-8000-000000000001', 'target-series:c5-origin-fixture',
  'canonical', 'active'
);
insert into targets.target_profile_versions (
  profile_version_id, profile_version_key, profile_series_id, catalog_version_id,
  version_number, lifecycle, role_title, source_summary, freshness_status, reviewed_at,
  root_rule_key, readiness_threshold, published_at
) values (
  'c5510000-0000-4000-8000-000000000001', 'target:c5-origin-fixture-v1',
  'c5500000-0000-4000-8000-000000000001',
  'c5000000-0000-4000-8000-000000000001', 1, 'published', 'C5 origin fixture',
  'C5 owner-boundary origin fixture.', 'reviewed', '2026-08-29',
  'rule:c5-origin-root', 0.75000, '2026-08-29T00:00:00Z'
);
insert into overlay.personal_competencies (
  workspace_id, competency_key, domain_item_key, title, provenance, lifecycle
) values (
  'c5120000-0000-4000-8000-000000000001', 'competency:c5-retired', 'domain:c5',
  'Personal collision with retired Catalog item', 'C5 collision fixture.', 'accepted'
);
insert into overlay.custom_activities (
  custom_activity_id, workspace_id, profile_version_id, activity_key, title, activity_type,
  target_competency_ref
) values (
  'c5520000-0000-4000-8000-000000000001',
  'c5120000-0000-4000-8000-000000000001',
  'c5510000-0000-4000-8000-000000000001', 'activity:c5-retired-collision',
  'Retired collision activity', 'READING', 'competency:c5-retired'
), (
  'c5520000-0000-4000-8000-000000000002',
  'c5120000-0000-4000-8000-000000000001',
  'c5510000-0000-4000-8000-000000000001', 'activity:c5-missing-origin',
  'Missing origin activity', 'READING', 'competency:c5-missing-origin'
);

set local role pando_planning_worker;
select throws_ok(
  $$select overlay.assert_planning_candidate_origins_v1(
    'c5120000-0000-4000-8000-000000000001',
    array['c5520000-0000-4000-8000-000000000001'::uuid]
  )$$,
  '22023', 'planning candidate competency origin is ambiguous',
  'a retired exact-version Catalog item still collides with an accepted personal competency'
);
select throws_ok(
  $$select overlay.assert_planning_candidate_origins_v1(
    'c5120000-0000-4000-8000-000000000001',
    array['c5520000-0000-4000-8000-000000000002'::uuid]
  )$$,
  '22023', 'planning candidate competency origin is unavailable',
  'an active candidate with neither canonical nor accepted personal origin fails closed'
);
reset role;

create function pg_temp.c5_mastery_state(
  p_competency_ref text,
  p_condition text,
  p_level text,
  p_last timestamptz,
  p_calculated_as_of timestamptz
)
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'engineVersion', 'mastery-engine/0.1.0',
    'policyVersion', 'mastery-readiness-policy/0.1',
    'inputWatermark', '1',
    'competencyId', p_competency_ref,
    'calculatedAsOf', p_calculated_as_of,
    'achievementLevel', p_level,
    'dimensions', pg_catalog.jsonb_build_object(
      'KNOWLEDGE', pg_catalog.jsonb_build_object(
        'dimension', 'KNOWLEDGE', 'value', 'UNKNOWN', 'achievementLevel', 'NOT_STARTED',
        'condition', null, 'confidence', null, 'freshness', 'UNKNOWN',
        'lastMeaningfulEvidenceAt', null
      ),
      'RECALL', pg_catalog.jsonb_build_object(
        'dimension', 'RECALL', 'value', 'UNKNOWN', 'achievementLevel', 'NOT_STARTED',
        'condition', null, 'confidence', null, 'freshness', 'UNKNOWN',
        'lastMeaningfulEvidenceAt', null
      ),
      'APPLICATION', pg_catalog.jsonb_build_object(
        'dimension', 'APPLICATION', 'value', 'KNOWN', 'achievementLevel', p_level,
        'condition', p_condition, 'confidence', 'LOW',
        'freshness', case when p_condition = 'STALE' then 'STALE' else 'FRESH' end,
        'lastMeaningfulEvidenceAt', p_last
      ),
      'INTERVIEW_EXECUTION', pg_catalog.jsonb_build_object(
        'dimension', 'INTERVIEW_EXECUTION', 'value', 'UNKNOWN',
        'achievementLevel', 'NOT_STARTED', 'condition', null, 'confidence', null,
        'freshness', 'UNKNOWN', 'lastMeaningfulEvidenceAt', null
      )
    ),
    'supportingEvidenceIds', '[]'::jsonb,
    'contradictingEvidenceIds', '[]'::jsonb,
    'explanationCodes', '[]'::jsonb
  )
$function$;

insert into mastery.competency_state_snapshots (
  snapshot_id, workspace_id, competency_ref, projection_generation, input_watermark,
  engine_version, policy_version, calculated_as_of, achievement_level, state, created_at
)
select snapshot_id, workspace_id, competency_ref, 'live-v1', 1,
  'mastery-engine/0.1.0', 'mastery-readiness-policy/0.1', calculated_as_of,
  achievement_level,
  case when malformed then pg_catalog.jsonb_build_object(
    'engineVersion', 'mastery-engine/0.1.0',
    'policyVersion', 'mastery-readiness-policy/0.1', 'inputWatermark', '1',
    'competencyId', competency_ref, 'calculatedAsOf', calculated_as_of,
    'achievementLevel', achievement_level, 'dimensions', '{}'::jsonb
  ) else pg_temp.c5_mastery_state(
    competency_ref, condition, achievement_level, last_meaningful, calculated_as_of
  ) end,
  created_at
from (values
  ('c5200000-0000-4000-8000-000000000001'::uuid,
   'c5120000-0000-4000-8000-000000000001'::uuid, 'competency:c5-strong',
   'STRONG', 'COMPLETED', '2026-08-01T12:00:00Z'::timestamptz,
   '2026-08-02T12:00:00Z'::timestamptz, '2026-08-02T12:00:00Z'::timestamptz, false),
  ('c5200000-0000-4000-8000-000000000002',
   'c5120000-0000-4000-8000-000000000001', 'competency:c5-weak',
   'WEAK', 'NOT_STARTED', '2026-08-01T12:00:00Z',
   '2026-08-02T12:00:00Z', '2026-08-02T12:00:00Z', false),
  ('c5200000-0000-4000-8000-000000000003',
   'c5120000-0000-4000-8000-000000000001', 'competency:c5-stale',
   'STALE', 'COMPLETED', '2026-05-01T12:00:00Z',
   '2026-08-02T12:00:00Z', '2026-08-02T12:00:00Z', false),
  ('c5200000-0000-4000-8000-000000000004',
   'c5120000-0000-4000-8000-000000000001', 'competency:c5-malformed',
   'STRONG', 'COMPLETED', '2026-08-01T12:00:00Z',
   '2026-08-02T12:00:00Z', '2026-08-02T12:00:00Z', true),
  ('c5200000-0000-4000-8000-000000000005',
   'c5120000-0000-4000-8000-000000000002', 'competency:c5-other-workspace',
   'STRONG', 'COMPLETED', '2026-08-01T12:00:00Z',
   '2026-08-02T12:00:00Z', '2026-08-02T12:00:00Z', false)
) as fixture(
  snapshot_id, workspace_id, competency_ref, condition, achievement_level,
  last_meaningful, calculated_as_of, created_at, malformed
);
insert into mastery.current_competency_states (
  workspace_id, competency_ref, snapshot_id, input_watermark, projection_version, updated_at
)
select workspace_id, competency_ref, snapshot_id, 1, 1, '2026-08-02T12:00:00Z'
from mastery.competency_state_snapshots
where snapshot_id::text like 'c5200000-%';

set local role pando_planning_worker;
insert into c5_results values (
  'mastery', mastery.read_planning_prerequisite_source_v1(
    'c5120000-0000-4000-8000-000000000001',
    array[
      'competency:c5-malformed', 'competency:c5-missing', 'competency:c5-other-workspace',
      'competency:c5-stale', 'competency:c5-strong', 'competency:c5-weak'
    ],
    '2026-08-29T12:00:00Z'
  )
);
reset role;

select is(
  (select item.value#>>'{projection,state,dimensions,APPLICATION,condition}' from c5_results,
    lateral pg_catalog.jsonb_array_elements(response->'items') as item(value)
   where result_name = 'mastery' and item.value->>'competencyRef' = 'competency:c5-strong'),
  'STRONG',
  'the owner query returns the minimized Strong source state for the pure TypeScript engine'
);
select is(
  (select item.value#>>'{projection,state,dimensions,APPLICATION,condition}' from c5_results,
    lateral pg_catalog.jsonb_array_elements(response->'items') as item(value)
   where result_name = 'mastery' and item.value->>'competencyRef' = 'competency:c5-weak'),
  'WEAK',
  'the owner query returns the minimized Weak source state for the pure TypeScript engine'
);
select is(
  (select count(*) from c5_results,
    lateral pg_catalog.jsonb_array_elements(response->'items') as item(value)
   where result_name = 'mastery' and item.value->'projection' = 'null'::jsonb),
  2::bigint,
  'missing and other-workspace current states remain explicitly not materialized'
);
select is(
  (select response->>'policyVersion' from c5_results where result_name = 'mastery'),
  'mastery-prerequisite-satisfaction/0.1',
  'the Mastery answer carries the exact satisfaction policy version'
);

select ok(
  not ((select response from c5_results where result_name = 'mastery')::text ~
    'supportingEvidenceIds|contradictingEvidenceIds|explanationCodes'),
  'the Mastery source strips evidence identifiers and explanation payloads'
);

set local role pando_planning_worker;
select throws_ok(
  $$select mastery.read_planning_prerequisite_source_v1(
    'c5120000-0000-4000-8000-000000000001',
    array['competency:duplicate', 'competency:duplicate'], clock_timestamp()
  )$$,
  '22023', 'planning Mastery source input is invalid',
  'Mastery refuses duplicate requested references'
);
select throws_ok(
  $$select mastery.read_planning_prerequisite_source_v1(
    'c5120000-0000-4000-8000-000000000001',
    array(select 'competency:bounded-' || value from pg_catalog.generate_series(1, 501) as value),
    clock_timestamp()
  )$$,
  '22023', 'planning Mastery source input is invalid',
  'Mastery refuses the 501st requested reference before reading projection rows'
);
insert into c5_results values (
  'bundle', planning.load_plan_snapshot_source_bundle_v1(
    'c5120000-0000-4000-8000-000000000001', '2026-08-29T12:00:00Z'
  )
);
reset role;

select ok(
  (select response#>>'{mastery,policyVersion}' from c5_results where result_name = 'bundle') =
    'mastery-prerequisite-satisfaction/0.1'
  and (select response#>'{catalog,items}' from c5_results where result_name = 'bundle') =
    '[]'::jsonb
  and (select response->>'sourceFence' from c5_results where result_name = 'bundle') like
    'planning-source:%',
  'the public bundle replaces Catalog/Mastery, retains no-plan semantics, and recomputes its fence'
);

-- A real Growth Plan candidate proves the non-empty wrapper path and its covering fence.
insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'c5300000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'c5-bundle@pando.test', '', clock_timestamp(),
  '{"provider":"email","providers":["email"]}', '{}', clock_timestamp(), clock_timestamp()
);
select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', 'c5300000-0000-4000-8000-000000000001',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text,
  true
);
set local role authenticated;
insert into c5_results values (
  'bundle-bootstrap', api.bootstrap_personal_workspace('c5-bundle', 'C5 Bundle')
);
insert into c5_results
select 'bundle-goal', api.create_readiness_goal(
  (select (response->>'workspace_id')::uuid from c5_results
   where result_name = 'bundle-bootstrap'),
  'goal:c5-bundle', 'C5 bundle goal',
  'target:nvidia-python-verification-base-v1', 'c5-bundle-goal'
);
insert into c5_results values (
  'bundle-plan', pg_temp.initialize_growth_plan_fixture_v1(
    'goal:c5-bundle', 300, 25, 80, 60, 'c5-bundle-plan'
  )
);
insert into c5_results values (
  'bundle-overlay', api.add_current_custom_activity_v1(
    'goal:c5-bundle', 'activity:c5-data-model', 'Practice Python data model',
    'MANUAL_CODING', 'competency:python-data-model', '0', 'c5-bundle-overlay'
  )
);
insert into c5_results values (
  'bundle-admission', pando_test.add_learning_track_activity_fixture_v1(
    (select response->>'learningTrackKey' from c5_results where result_name = 'bundle-plan'),
    'activity:c5-data-model', 25, '1', 'c5-bundle-admission', 'MEDIUM'
  )
);
reset role;

insert into mastery.competency_state_snapshots (
  snapshot_id, workspace_id, competency_ref, projection_generation, input_watermark,
  engine_version, policy_version, calculated_as_of, achievement_level, state, created_at
)
select 'c5400000-0000-4000-8000-000000000001',
  (select (response->>'workspace_id')::uuid from c5_results
   where result_name = 'bundle-bootstrap'),
  'competency:python-typing', 'live-v1', 1,
  'mastery-engine/0.1.0', 'mastery-readiness-policy/0.1', '2026-08-29T11:00:00Z',
  'COMPLETED', pg_temp.c5_mastery_state(
    'competency:python-typing', 'STRONG', 'COMPLETED',
    '2026-08-01T12:00:00Z', '2026-08-29T11:00:00Z'
  ), '2026-08-29T11:00:00Z';
insert into mastery.current_competency_states (
  workspace_id, competency_ref, snapshot_id, input_watermark, projection_version, updated_at
)
select (response->>'workspace_id')::uuid, 'competency:python-typing',
  'c5400000-0000-4000-8000-000000000001', 1, 1, '2026-08-29T11:00:00Z'
from c5_results where result_name = 'bundle-bootstrap';

set local role pando_planning_worker;
insert into c5_results
select 'bundle-live', planning.load_plan_snapshot_source_bundle_v1(
  (select (response->>'workspace_id')::uuid from c5_results
   where result_name = 'bundle-bootstrap'),
  '2026-08-29T12:00:00Z'
);
reset role;

select ok(
  (select response#>>'{catalog,items,0,prerequisiteRefs,0}' from c5_results
   where result_name = 'bundle-live') = 'competency:python-typing'
  and (select response#>>'{mastery,items,0,competencyRef}' from c5_results
   where result_name = 'bundle-live') = 'competency:python-typing'
  and (select response#>>'{mastery,items,0,projection,state,competencyId}' from c5_results
   where result_name = 'bundle-live') = 'competency:python-typing',
  'the public bundle composes a real candidate, exact direct prerequisite, and minimized Mastery state'
);
select is(
  (select response->>'sourceFence' from c5_results where result_name = 'bundle-live'),
  (select 'planning-source:' || pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to((response - 'sourceFence')::text, 'UTF8'), 'sha256'
  ), 'hex') from c5_results where result_name = 'bundle-live'),
  'the non-empty public bundle source fence covers the exact replaced Catalog and Mastery answers'
);

insert into overlay.personal_competencies (
  workspace_id, competency_key, domain_item_key, title, provenance, lifecycle
)
select (response->>'workspace_id')::uuid, 'competency:python-data-model', 'domain:python',
  'Ambiguous Python data model', 'Legacy/import collision fixture.', 'accepted'
from c5_results where result_name = 'bundle-bootstrap';

set local role pando_planning_worker;
select throws_ok(
  pg_catalog.format(
    'select planning.load_plan_snapshot_source_bundle_v1(%L, %L)',
    (select response->>'workspace_id' from c5_results where result_name = 'bundle-bootstrap'),
    '2026-08-29T12:00:00Z'
  ),
  '22023', 'planning candidate competency origin is ambiguous',
  'a personal/canonical reference collision fails before canonical prerequisites are applied'
);
select throws_ok(
  pg_catalog.format(
    'select overlay.assert_planning_candidate_origins_v1(%L, array[%L::uuid])',
    'c5120000-0000-4000-8000-000000000002',
    (select response#>>'{overlay,items,0,customActivityId}' from c5_results
     where result_name = 'bundle-live')
  ),
  '22023', 'planning candidate origin source is not authoritative',
  'candidate-origin validation refuses an activity from another workspace'
);
select throws_ok(
  $$select overlay.assert_planning_candidate_origins_v1(
    'c5120000-0000-4000-8000-000000000001', array[null::uuid]
  )$$,
  '22023', 'planning candidate origin input is invalid',
  'candidate-origin validation refuses null identifiers before reading owner rows'
);
reset role;

select * from finish();
rollback;
