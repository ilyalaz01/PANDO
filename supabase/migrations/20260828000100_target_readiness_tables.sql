-- Phase 3B Targets-owned immutable readiness history and rebuildable current pointer.

do $roles$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'pando_readiness_worker') then
    execute 'create role pando_readiness_worker nologin noinherit nobypassrls';
  end if;
end
$roles$;

do $migration_role_membership$
begin
  execute pg_catalog.format(
    'grant pando_rls_authorizer, pando_phase1_api, pando_mastery_worker, pando_readiness_worker to %I with set true',
    current_user
  );
end
$migration_role_membership$;

create table targets.readiness_snapshots (
  snapshot_id uuid primary key,
  workspace_id uuid not null references identity.workspaces (workspace_id) on delete restrict,
  readiness_goal_id uuid not null,
  profile_version_id uuid not null,
  projection_generation text not null,
  input_fingerprint text not null,
  source_evidence_watermark bigint not null,
  mastery_engine_version text not null,
  mastery_policy_version text not null,
  readiness_engine_version text not null,
  readiness_policy_version text not null,
  calculated_as_of timestamptz not null,
  valid_until timestamptz,
  lower_bound numeric(16,15) not null,
  upper_bound numeric(16,15) not null,
  coverage numeric(16,15) not null,
  readiness_status text not null,
  estimate_confidence text not null,
  blockers jsonb not null,
  gaps jsonb not null,
  rule_evaluations jsonb not null,
  explanation_codes jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint readiness_snapshot_goal_fk
    foreign key (readiness_goal_id, workspace_id, profile_version_id)
    references targets.readiness_goals (readiness_goal_id, workspace_id, profile_version_id)
    on delete restrict,
  constraint readiness_snapshot_generation_check check (
    projection_generation ~ '^[a-z][a-z0-9_.-]{1,79}$'
  ),
  constraint readiness_snapshot_fingerprint_check check (
    input_fingerprint ~ '^readiness-input:[a-f0-9]{64}$'
  ),
  constraint readiness_snapshot_watermark_check check (source_evidence_watermark >= 0),
  constraint readiness_snapshot_mastery_engine_check check (
    mastery_engine_version = 'mastery-engine/0.1.0'
  ),
  constraint readiness_snapshot_mastery_policy_check check (
    mastery_policy_version = 'mastery-readiness-policy/0.1'
  ),
  constraint readiness_snapshot_engine_check check (
    readiness_engine_version = 'readiness-engine/0.1.0'
  ),
  constraint readiness_snapshot_policy_check check (
    readiness_policy_version = 'mastery-readiness-policy/0.1'
  ),
  constraint readiness_snapshot_validity_check check (
    valid_until is null or valid_until >= calculated_as_of
  ),
  constraint readiness_snapshot_interval_check check (
    lower_bound between 0 and 1
    and upper_bound between 0 and 1
    and lower_bound <= upper_bound
    and coverage between 0 and 1
  ),
  constraint readiness_snapshot_status_check check (
    readiness_status in ('NOT_READY', 'INSUFFICIENT_EVIDENCE', 'READY', 'DEVELOPING')
  ),
  constraint readiness_snapshot_confidence_check check (
    estimate_confidence in ('LOW', 'MEDIUM', 'HIGH')
  ),
  constraint readiness_snapshot_json_check check (
    jsonb_typeof(blockers) = 'array'
    and jsonb_typeof(gaps) = 'array'
    and jsonb_typeof(rule_evaluations) = 'array'
    and jsonb_typeof(explanation_codes) = 'array'
    and jsonb_typeof(result) = 'object'
    and result->>'engineVersion' = readiness_engine_version
    and result->>'policyVersion' = readiness_policy_version
    and result->>'targetProfileVersionId' = profile_version_id::text
    and result->>'inputWatermark' = input_fingerprint
    and (result->>'calculatedAsOf')::timestamptz = calculated_as_of
    and (result->>'lower')::numeric = lower_bound
    and (result->>'upper')::numeric = upper_bound
    and (result->>'coverage')::numeric = coverage
    and result->>'status' = readiness_status
    and result->>'confidence' = estimate_confidence
    and result->'blockers' = blockers
    and result->'ruleEvaluations' = rule_evaluations
    and result->'explanationCodes' = explanation_codes
  ),
  unique (workspace_id, snapshot_id),
  unique (workspace_id, readiness_goal_id, snapshot_id),
  unique (workspace_id, readiness_goal_id, profile_version_id, snapshot_id),
  unique (
    workspace_id, readiness_goal_id, projection_generation,
    readiness_engine_version, readiness_policy_version, input_fingerprint
  )
);

create table targets.readiness_snapshot_inputs (
  workspace_id uuid not null references identity.workspaces (workspace_id) on delete restrict,
  readiness_goal_id uuid not null,
  snapshot_id uuid not null,
  competency_ref text not null,
  dimension text not null,
  required_level text not null,
  owning_rule_keys text[] not null,
  source_evidence_watermark bigint not null,
  calculated_as_of timestamptz not null,
  value_state text not null,
  achievement_level text not null,
  freshness text not null,
  estimate_confidence text,
  last_meaningful_evidence_at timestamptz,
  supporting_evidence_ids uuid[] not null default '{}'::uuid[],
  contradicting_evidence_ids uuid[] not null default '{}'::uuid[],
  created_at timestamptz not null default clock_timestamp(),
  primary key (
    workspace_id, snapshot_id, competency_ref, dimension, required_level
  ),
  constraint readiness_input_snapshot_fk
    foreign key (workspace_id, readiness_goal_id, snapshot_id)
    references targets.readiness_snapshots (workspace_id, readiness_goal_id, snapshot_id)
    on delete restrict,
  constraint readiness_input_competency_check check (
    competency_ref ~ '^competency:[a-z0-9][a-z0-9-]{1,100}$'
  ),
  constraint readiness_input_dimension_check check (
    dimension in ('KNOWLEDGE', 'RECALL', 'APPLICATION', 'INTERVIEW_EXECUTION')
  ),
  constraint readiness_input_level_check check (
    required_level in ('COMPLETED', 'VERIFIED', 'MASTERED')
  ),
  constraint readiness_input_rules_check check (
    cardinality(owning_rule_keys) > 0
    and array_position(owning_rule_keys, null) is null
  ),
  constraint readiness_input_watermark_check check (source_evidence_watermark >= 0),
  constraint readiness_input_value_check check (value_state in ('KNOWN', 'UNKNOWN')),
  constraint readiness_input_achievement_check check (
    achievement_level in ('NOT_STARTED', 'COMPLETED', 'VERIFIED', 'MASTERED')
  ),
  constraint readiness_input_freshness_check check (
    freshness in ('FRESH', 'STALE', 'UNKNOWN')
  ),
  constraint readiness_input_confidence_check check (
    estimate_confidence is null or estimate_confidence in ('LOW', 'MEDIUM', 'HIGH')
  ),
  constraint readiness_input_unknown_shape_check check (
    (
      value_state = 'UNKNOWN'
      and achievement_level = 'NOT_STARTED'
      and freshness = 'UNKNOWN'
      and estimate_confidence is null
      and last_meaningful_evidence_at is null
      and cardinality(supporting_evidence_ids) = 0
      and cardinality(contradicting_evidence_ids) = 0
    )
    or (
      value_state = 'KNOWN'
      and freshness in ('FRESH', 'STALE')
      and estimate_confidence is not null
      and last_meaningful_evidence_at is not null
    )
  ),
  constraint readiness_input_evidence_array_check check (
    array_position(supporting_evidence_ids, null) is null
    and array_position(contradicting_evidence_ids, null) is null
    and cardinality(supporting_evidence_ids) <= 8
    and cardinality(contradicting_evidence_ids) <= 8
  )
);

create table targets.current_readiness_snapshots (
  workspace_id uuid not null references identity.workspaces (workspace_id) on delete restrict,
  readiness_goal_id uuid not null,
  profile_version_id uuid not null,
  snapshot_id uuid not null,
  projection_version bigint not null default 1,
  source_evidence_watermark bigint not null,
  calculated_as_of timestamptz not null,
  valid_until timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (workspace_id, readiness_goal_id),
  constraint current_readiness_goal_fk
    foreign key (readiness_goal_id, workspace_id, profile_version_id)
    references targets.readiness_goals (readiness_goal_id, workspace_id, profile_version_id)
    on delete restrict,
  constraint current_readiness_snapshot_fk
    foreign key (workspace_id, readiness_goal_id, profile_version_id, snapshot_id)
    references targets.readiness_snapshots (
      workspace_id, readiness_goal_id, profile_version_id, snapshot_id
    ) on delete restrict,
  constraint current_readiness_version_check check (projection_version > 0),
  constraint current_readiness_watermark_check check (source_evidence_watermark >= 0),
  constraint current_readiness_validity_check check (
    valid_until is null or valid_until >= calculated_as_of
  )
);

create index readiness_snapshots_goal_history
  on targets.readiness_snapshots (
    workspace_id, readiness_goal_id, calculated_as_of desc, snapshot_id
  );
create index readiness_inputs_gap_order
  on targets.readiness_snapshot_inputs (
    workspace_id, readiness_goal_id, snapshot_id, competency_ref, dimension, required_level
  );

do $rls$
declare
  qualified_table text;
begin
  foreach qualified_table in array array[
    'targets.readiness_snapshots',
    'targets.readiness_snapshot_inputs',
    'targets.current_readiness_snapshots'
  ]
  loop
    execute 'alter table ' || qualified_table || ' enable row level security';
    execute 'alter table ' || qualified_table || ' force row level security';
    execute 'revoke all on table ' || qualified_table || ' from public, anon, authenticated, service_role';
  end loop;
end
$rls$;

create function targets.reject_readiness_history_mutation()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  raise exception using errcode = '55000', message = 'readiness history rows are immutable';
end
$function$;

create trigger readiness_snapshots_are_immutable
before update or delete on targets.readiness_snapshots
for each row execute function targets.reject_readiness_history_mutation();
create trigger readiness_inputs_are_immutable
before update or delete on targets.readiness_snapshot_inputs
for each row execute function targets.reject_readiness_history_mutation();

grant usage on schema targets, mastery, evidence, outbox to pando_readiness_worker;
grant select on targets.readiness_goals, targets.target_profile_series,
  targets.target_profile_versions, targets.target_requirement_rules,
  targets.target_requirement_members to pando_readiness_worker;
grant select, insert on targets.readiness_snapshots,
  targets.readiness_snapshot_inputs to pando_readiness_worker;
grant select, insert, update on targets.current_readiness_snapshots to pando_readiness_worker;
grant select, insert, update on outbox.deliveries to pando_readiness_worker;
grant select, insert on outbox.events to pando_readiness_worker;
grant usage, select on sequence outbox.events_event_position_seq to pando_readiness_worker;
grant select, insert on outbox.consumer_receipts to pando_readiness_worker;

grant select on targets.readiness_snapshots, targets.readiness_snapshot_inputs,
  targets.current_readiness_snapshots to pando_phase1_api;
grant insert on outbox.deliveries to pando_phase1_api;
grant insert on outbox.deliveries to pando_mastery_worker;

create policy readiness_snapshots_api_read on targets.readiness_snapshots
for select to pando_phase1_api using (identity.is_workspace_member(workspace_id));
create policy readiness_inputs_api_read on targets.readiness_snapshot_inputs
for select to pando_phase1_api using (identity.is_workspace_member(workspace_id));
create policy current_readiness_api_read on targets.current_readiness_snapshots
for select to pando_phase1_api using (identity.is_workspace_member(workspace_id));

create policy readiness_snapshots_worker_all on targets.readiness_snapshots
for all to pando_readiness_worker using (true) with check (true);
create policy readiness_inputs_worker_all on targets.readiness_snapshot_inputs
for all to pando_readiness_worker using (true) with check (true);
create policy current_readiness_worker_all on targets.current_readiness_snapshots
for all to pando_readiness_worker using (true) with check (true);
create policy readiness_goals_worker_read on targets.readiness_goals
for select to pando_readiness_worker using (true);
create policy target_series_readiness_worker_read on targets.target_profile_series
for select to pando_readiness_worker using (true);
create policy target_versions_readiness_worker_read on targets.target_profile_versions
for select to pando_readiness_worker using (true);
create policy target_rules_readiness_worker_read on targets.target_requirement_rules
for select to pando_readiness_worker using (true);
create policy target_members_readiness_worker_read on targets.target_requirement_members
for select to pando_readiness_worker using (true);
create policy readiness_deliveries_worker_all on outbox.deliveries
for all to pando_readiness_worker
using (consumer_name = 'targets.readiness_projection_v1')
with check (consumer_name = 'targets.readiness_projection_v1');
create policy readiness_events_worker_read on outbox.events
for select to pando_readiness_worker using (true);
create policy readiness_events_worker_insert on outbox.events
for insert to pando_readiness_worker
with check (
  event_name in (
    'targets.readiness_projection_changed',
    'targets.readiness_refresh_scheduled'
  )
  and event_schema_version = 1
  and actor_type = 'system'
  and actor_user_id is null
  and source = 'pando.readiness_worker'
  and aggregate_type = 'targets.readiness_projection'
  and aggregate_id is not null
  and aggregate_version is not null
);
create policy readiness_receipts_worker_read on outbox.consumer_receipts
for select to pando_readiness_worker
using (consumer_name = 'targets.readiness_projection_v1');
create policy readiness_receipts_worker_insert on outbox.consumer_receipts
for insert to pando_readiness_worker
with check (consumer_name = 'targets.readiness_projection_v1');
create policy readiness_delivery_from_targets_insert on outbox.deliveries
for insert to pando_phase1_api
with check (
  identity.is_workspace_member(workspace_id)
  and consumer_name = 'targets.readiness_projection_v1'
  and handler_contract_version = 1
);
create policy readiness_delivery_from_mastery_insert on outbox.deliveries
for insert to pando_mastery_worker
with check (
  consumer_name = 'targets.readiness_projection_v1'
  and handler_contract_version = 1
);

revoke all on function targets.reject_readiness_history_mutation()
  from public, anon, authenticated, service_role;

do $migration_role_membership$
begin
  execute pg_catalog.format(
    'revoke pando_rls_authorizer, pando_phase1_api, pando_mastery_worker, pando_readiness_worker from %I',
    current_user
  );
end
$migration_role_membership$;
