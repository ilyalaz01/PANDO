-- Phase 2 storage for the first Focus -> Evidence -> Mastery vertical slice.
--
-- Sessions owns FocusSession only. Evidence owns ActivityAttempt and the immutable evidence
-- ledger. Mastery owns immutable calculation snapshots and the current-state pointer.

do $roles$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'pando_phase2_api') then
    execute 'create role pando_phase2_api nologin noinherit nobypassrls';
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'pando_mastery_worker') then
    execute 'create role pando_mastery_worker nologin noinherit nobypassrls';
  end if;
end
$roles$;

do $migration_role_membership$
begin
  execute pg_catalog.format(
    'grant pando_rls_authorizer, pando_identity_api, pando_phase2_api, pando_mastery_worker to %I with set true',
    current_user
  );
end
$migration_role_membership$;

-- A personal activity is its own accepted mapping authority in this slice. The existing rows can
-- be backfilled deterministically because their activity type is already constrained.
alter table overlay.custom_activities
  add column evidence_dimension text,
  add column mapping_confidence numeric(4,3),
  add column mapping_status text,
  add column expected_evidence text,
  add column resource_url text;

update overlay.custom_activities
set evidence_dimension = case activity_type
      when 'READING' then 'KNOWLEDGE'
      when 'EXPLANATION' then 'KNOWLEDGE'
      when 'MANUAL_CODING' then 'APPLICATION'
      when 'PROJECT' then 'APPLICATION'
      when 'MOCK' then 'INTERVIEW_EXECUTION'
    end,
    mapping_confidence = 1.000,
    mapping_status = 'accepted',
    expected_evidence = case activity_type
      when 'READING' then 'Finish the reading and state what you learned.'
      when 'EXPLANATION' then 'Explain the idea accurately in your own words.'
      when 'MANUAL_CODING' then 'Produce a working result without copying the solution.'
      when 'PROJECT' then 'Complete a concrete project step and verify its result.'
      when 'MOCK' then 'Complete the rehearsal and record whether the target behavior succeeded.'
    end;

alter table overlay.custom_activities
  alter column evidence_dimension set not null,
  alter column mapping_confidence set not null,
  alter column mapping_status set not null,
  alter column expected_evidence set not null,
  add constraint custom_activities_evidence_dimension_check check (
    evidence_dimension in ('KNOWLEDGE', 'RECALL', 'APPLICATION', 'INTERVIEW_EXECUTION')
  ),
  add constraint custom_activities_mapping_confidence_check check (mapping_confidence = 1.000),
  add constraint custom_activities_mapping_status_check check (mapping_status = 'accepted'),
  add constraint custom_activities_expected_evidence_check check (
    expected_evidence = btrim(expected_evidence)
    and char_length(expected_evidence) between 1 and 500
  ),
  add constraint custom_activities_resource_url_check check (
    resource_url is null
    or (
      resource_url = btrim(resource_url)
      and char_length(resource_url) between 9 and 2048
      and resource_url ~ '^https://[^[:space:]]+$'
    )
  ),
  add constraint custom_activities_workspace_identity_key
    unique (workspace_id, custom_activity_id);

create function overlay.derive_custom_activity_evidence_mapping()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  new.evidence_dimension := case new.activity_type
    when 'READING' then 'KNOWLEDGE'
    when 'EXPLANATION' then 'KNOWLEDGE'
    when 'MANUAL_CODING' then 'APPLICATION'
    when 'PROJECT' then 'APPLICATION'
    when 'MOCK' then 'INTERVIEW_EXECUTION'
  end;
  new.mapping_confidence := 1.000;
  new.mapping_status := 'accepted';
  if new.expected_evidence is null then
    new.expected_evidence := case new.activity_type
      when 'READING' then 'Finish the reading and state what you learned.'
      when 'EXPLANATION' then 'Explain the idea accurately in your own words.'
      when 'MANUAL_CODING' then 'Produce a working result without copying the solution.'
      when 'PROJECT' then 'Complete a concrete project step and verify its result.'
      when 'MOCK' then 'Complete the rehearsal and record whether the target behavior succeeded.'
    end;
  end if;
  return new;
end
$function$;

create trigger derive_custom_activity_evidence_mapping
before insert or update of activity_type, evidence_dimension, mapping_confidence, mapping_status,
  expected_evidence
on overlay.custom_activities
for each row execute function overlay.derive_custom_activity_evidence_mapping();

create table sessions.focus_sessions (
  focus_session_id uuid primary key,
  workspace_id uuid not null references identity.workspaces (workspace_id) on delete restrict,
  user_id uuid not null references identity.users (user_id) on delete restrict,
  readiness_goal_key text not null,
  custom_activity_id uuid not null,
  activity_key text not null,
  activity_title text not null,
  activity_type text not null,
  target_competency_ref text not null,
  state text not null default 'active',
  planned_minutes smallint not null,
  aggregate_version bigint not null default 1,
  started_at timestamptz not null default clock_timestamp(),
  ended_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  constraint focus_sessions_activity_fk
    foreign key (workspace_id, custom_activity_id)
    references overlay.custom_activities (workspace_id, custom_activity_id)
    on delete restrict,
  constraint focus_sessions_goal_key_check check (
    readiness_goal_key ~ '^goal:[a-z0-9][a-z0-9-]{1,100}$'
  ),
  constraint focus_sessions_activity_key_check check (
    activity_key ~ '^activity:[a-z0-9][a-z0-9-]{1,100}$'
  ),
  constraint focus_sessions_activity_title_check check (
    activity_title = btrim(activity_title) and char_length(activity_title) between 1 and 200
  ),
  constraint focus_sessions_activity_type_check check (
    activity_type in ('MANUAL_CODING', 'READING', 'EXPLANATION', 'MOCK', 'PROJECT')
  ),
  constraint focus_sessions_competency_ref_check check (
    target_competency_ref ~ '^competency:[a-z0-9][a-z0-9-]{1,100}$'
  ),
  constraint focus_sessions_state_check check (state in ('active', 'completed', 'stopped')),
  constraint focus_sessions_planned_minutes_check check (planned_minutes between 1 and 480),
  constraint focus_sessions_version_check check (aggregate_version in (1, 2)),
  constraint focus_sessions_terminal_check check (
    (state = 'active' and aggregate_version = 1 and ended_at is null)
    or (state in ('completed', 'stopped') and aggregate_version = 2 and ended_at is not null)
  ),
  constraint focus_sessions_time_check check (ended_at is null or ended_at >= started_at),
  unique (workspace_id, focus_session_id)
);

create unique index one_active_focus_session_per_workspace
  on sessions.focus_sessions (workspace_id)
  where state = 'active';
create index focus_sessions_workspace_history
  on sessions.focus_sessions (workspace_id, started_at desc, focus_session_id desc);

create table evidence.activity_attempts (
  activity_attempt_id uuid primary key,
  workspace_id uuid not null references identity.workspaces (workspace_id) on delete restrict,
  user_id uuid not null references identity.users (user_id) on delete restrict,
  focus_session_id uuid not null,
  custom_activity_id uuid not null,
  activity_key text not null,
  activity_title text not null,
  activity_type text not null,
  target_competency_ref text not null,
  evidence_dimension text not null,
  mapping_confidence numeric(4,3) not null,
  mapping_status text not null,
  source_reliability numeric(4,3) not null,
  normalization_policy text not null,
  state text not null default 'in_progress',
  result_kind text,
  used_hint boolean,
  aggregate_version bigint not null default 1,
  started_at timestamptz not null,
  ended_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  constraint activity_attempts_session_fk
    foreign key (workspace_id, focus_session_id)
    references sessions.focus_sessions (workspace_id, focus_session_id)
    on delete restrict,
  constraint activity_attempts_activity_fk
    foreign key (workspace_id, custom_activity_id)
    references overlay.custom_activities (workspace_id, custom_activity_id)
    on delete restrict,
  constraint activity_attempts_activity_key_check check (
    activity_key ~ '^activity:[a-z0-9][a-z0-9-]{1,100}$'
  ),
  constraint activity_attempts_activity_title_check check (
    activity_title = btrim(activity_title) and char_length(activity_title) between 1 and 200
  ),
  constraint activity_attempts_activity_type_check check (
    activity_type in ('MANUAL_CODING', 'READING', 'EXPLANATION', 'MOCK', 'PROJECT')
  ),
  constraint activity_attempts_competency_ref_check check (
    target_competency_ref ~ '^competency:[a-z0-9][a-z0-9-]{1,100}$'
  ),
  constraint activity_attempts_dimension_check check (
    evidence_dimension in ('KNOWLEDGE', 'RECALL', 'APPLICATION', 'INTERVIEW_EXECUTION')
  ),
  constraint activity_attempts_mapping_check check (
    mapping_confidence = 1.000 and mapping_status = 'accepted'
  ),
  constraint activity_attempts_reliability_check check (source_reliability = 0.600),
  constraint activity_attempts_policy_check check (
    normalization_policy = 'manual-activity-outcome/0.1'
  ),
  constraint activity_attempts_state_check check (
    state in ('in_progress', 'completed', 'stopped')
  ),
  constraint activity_attempts_result_check check (
    (state = 'in_progress' and result_kind is null and used_hint is null)
    or (
      state = 'completed'
      and result_kind in ('OBSERVED_SUCCESS', 'OBSERVED_FAILURE', 'COMPLETION_ONLY')
      and used_hint is not null
    )
    or (state = 'stopped' and result_kind is null and used_hint is null)
  ),
  constraint activity_attempts_version_check check (aggregate_version in (1, 2)),
  constraint activity_attempts_terminal_check check (
    (state = 'in_progress' and aggregate_version = 1 and ended_at is null)
    or (state in ('completed', 'stopped') and aggregate_version = 2 and ended_at is not null)
  ),
  constraint activity_attempts_time_check check (ended_at is null or ended_at >= started_at),
  unique (workspace_id, activity_attempt_id),
  unique (workspace_id, focus_session_id)
);

create table evidence.subject_ledgers (
  workspace_id uuid primary key references identity.workspaces (workspace_id) on delete restrict,
  ledger_version bigint not null default 0,
  updated_at timestamptz not null default clock_timestamp(),
  constraint subject_ledgers_version_check check (ledger_version >= 0)
);

create table evidence.observations (
  evidence_id uuid primary key,
  workspace_id uuid not null references identity.workspaces (workspace_id) on delete restrict,
  user_id uuid not null references identity.users (user_id) on delete restrict,
  activity_attempt_id uuid not null,
  competency_ref text not null,
  dimension text not null,
  outcome text not null,
  engagement text not null,
  normalized boolean not null default true,
  observed_result boolean not null default true,
  mapping_confidence numeric(4,3) not null,
  source_reliability numeric(4,3) not null,
  target_relevant boolean not null,
  source_id text not null,
  normalization_policy text not null,
  ledger_version bigint not null,
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default clock_timestamp(),
  constraint observations_attempt_fk
    foreign key (workspace_id, activity_attempt_id)
    references evidence.activity_attempts (workspace_id, activity_attempt_id)
    on delete restrict,
  constraint observations_competency_ref_check check (
    competency_ref ~ '^competency:[a-z0-9][a-z0-9-]{1,100}$'
  ),
  constraint observations_dimension_check check (
    dimension in ('KNOWLEDGE', 'RECALL', 'APPLICATION', 'INTERVIEW_EXECUTION')
  ),
  constraint observations_outcome_check check (outcome in ('SUCCESS', 'FAILURE')),
  constraint observations_engagement_check check (
    engagement in ('INDEPENDENT', 'GUIDED', 'PASSIVE')
  ),
  constraint observations_normalized_check check (normalized and observed_result),
  constraint observations_mapping_check check (mapping_confidence = 1.000),
  constraint observations_reliability_check check (source_reliability = 0.600),
  constraint observations_source_check check (source_id = 'manual.focus'),
  constraint observations_policy_check check (
    normalization_policy = 'manual-activity-outcome/0.1'
  ),
  constraint observations_ledger_version_check check (ledger_version > 0),
  constraint observations_time_check check (occurred_at <= recorded_at),
  unique (workspace_id, evidence_id),
  unique (workspace_id, activity_attempt_id),
  unique (workspace_id, ledger_version)
);

create index observations_workspace_competency
  on evidence.observations (workspace_id, competency_ref, occurred_at, evidence_id);

create table evidence.corrections (
  correction_id uuid primary key,
  workspace_id uuid not null references identity.workspaces (workspace_id) on delete restrict,
  evidence_id uuid not null,
  actor_user_id uuid not null references identity.users (user_id) on delete restrict,
  correction_type text not null,
  correction_revision smallint not null,
  reason text not null,
  ledger_version bigint not null,
  recorded_at timestamptz not null default clock_timestamp(),
  constraint corrections_evidence_fk
    foreign key (workspace_id, evidence_id)
    references evidence.observations (workspace_id, evidence_id)
    on delete restrict,
  constraint corrections_type_check check (correction_type = 'INVALIDATE'),
  constraint corrections_revision_check check (correction_revision = 1),
  constraint corrections_reason_check check (
    reason = btrim(reason) and char_length(reason) between 1 and 500
  ),
  constraint corrections_ledger_version_check check (ledger_version > 0),
  unique (workspace_id, evidence_id, correction_revision),
  unique (workspace_id, ledger_version)
);

create table mastery.competency_state_snapshots (
  snapshot_id uuid primary key,
  workspace_id uuid not null references identity.workspaces (workspace_id) on delete restrict,
  competency_ref text not null,
  projection_generation text not null,
  input_watermark bigint not null,
  engine_version text not null,
  policy_version text not null,
  calculated_as_of timestamptz not null,
  achievement_level text not null,
  state jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint competency_state_snapshots_competency_check check (
    competency_ref ~ '^competency:[a-z0-9][a-z0-9-]{1,100}$'
  ),
  constraint competency_state_snapshots_watermark_check check (input_watermark > 0),
  constraint competency_state_snapshots_generation_check check (
    projection_generation ~ '^[a-z][a-z0-9_.-]{1,79}$'
  ),
  constraint competency_state_snapshots_engine_check check (
    engine_version = 'mastery-engine/0.1.0'
  ),
  constraint competency_state_snapshots_policy_check check (
    policy_version = 'mastery-readiness-policy/0.1'
  ),
  constraint competency_state_snapshots_level_check check (
    achievement_level in ('NOT_STARTED', 'COMPLETED', 'VERIFIED', 'MASTERED')
  ),
  constraint competency_state_snapshots_state_check check (
    jsonb_typeof(state) = 'object'
    and state->>'engineVersion' = engine_version
    and state->>'policyVersion' = policy_version
    and state->>'inputWatermark' = input_watermark::text
    and state->>'competencyId' = competency_ref
    and state->>'achievementLevel' = achievement_level
  ),
  unique (workspace_id, snapshot_id),
  unique (workspace_id, competency_ref, snapshot_id),
  unique (
    workspace_id, competency_ref, engine_version, policy_version,
    projection_generation, input_watermark
  )
);

create table mastery.current_competency_states (
  workspace_id uuid not null references identity.workspaces (workspace_id) on delete restrict,
  competency_ref text not null,
  snapshot_id uuid not null,
  input_watermark bigint not null,
  projection_version bigint not null default 1,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (workspace_id, competency_ref),
  constraint current_competency_states_snapshot_fk
    foreign key (workspace_id, competency_ref, snapshot_id)
    references mastery.competency_state_snapshots (workspace_id, competency_ref, snapshot_id)
    on delete restrict,
  constraint current_competency_states_competency_check check (
    competency_ref ~ '^competency:[a-z0-9][a-z0-9-]{1,100}$'
  ),
  constraint current_competency_states_watermark_check check (input_watermark > 0),
  constraint current_competency_states_version_check check (projection_version > 0)
);

do $rls$
declare
  qualified_table text;
begin
  foreach qualified_table in array array[
    'sessions.focus_sessions',
    'evidence.activity_attempts',
    'evidence.subject_ledgers',
    'evidence.observations',
    'evidence.corrections',
    'mastery.competency_state_snapshots',
    'mastery.current_competency_states'
  ]
  loop
    execute 'alter table ' || qualified_table || ' enable row level security';
    execute 'alter table ' || qualified_table || ' force row level security';
    execute 'revoke all on table ' || qualified_table || ' from public, anon, authenticated, service_role';
  end loop;
end
$rls$;

create function evidence.reject_immutable_evidence_mutation()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  raise exception using errcode = '55000', message = 'evidence ledger rows are immutable';
end
$function$;

create trigger observations_are_immutable
before update or delete on evidence.observations
for each row execute function evidence.reject_immutable_evidence_mutation();
create trigger corrections_are_immutable
before update or delete on evidence.corrections
for each row execute function evidence.reject_immutable_evidence_mutation();

create function mastery.reject_snapshot_mutation()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  raise exception using errcode = '55000', message = 'mastery snapshots are immutable';
end
$function$;

create trigger competency_state_snapshots_are_immutable
before update or delete on mastery.competency_state_snapshots
for each row execute function mastery.reject_snapshot_mutation();

set role pando_rls_authorizer;
grant execute on function identity.jwt_subject(), identity.current_user_id(),
  identity.is_workspace_member(uuid), identity.personal_workspace_id_for_current_user()
  to pando_phase2_api;
reset role;

grant usage on schema api, identity, targets, overlay, sessions, evidence, mastery, outbox, extensions
  to pando_phase2_api;
grant usage on schema evidence, mastery, outbox to pando_mastery_worker;
grant execute on function extensions.digest(bytea, text) to pando_phase2_api;
grant select on targets.readiness_goals, overlay.custom_activities to pando_phase2_api;
grant select, insert, update on sessions.focus_sessions, evidence.activity_attempts,
  evidence.subject_ledgers to pando_phase2_api;
grant select, insert on evidence.observations, evidence.corrections to pando_phase2_api;
grant select on mastery.competency_state_snapshots, mastery.current_competency_states
  to pando_phase2_api;
grant select, insert, update on outbox.command_receipts to pando_phase2_api;
grant select, insert on outbox.events, outbox.deliveries to pando_phase2_api;
grant usage, select on sequence outbox.events_event_position_seq to pando_phase2_api;

grant select on evidence.subject_ledgers, evidence.observations, evidence.corrections
  to pando_mastery_worker;
grant select, insert on mastery.competency_state_snapshots to pando_mastery_worker;
grant select, insert, update on mastery.current_competency_states to pando_mastery_worker;
grant select, update on outbox.deliveries to pando_mastery_worker;
grant select, insert on outbox.events to pando_mastery_worker;
grant usage, select on sequence outbox.events_event_position_seq to pando_mastery_worker;
grant select, insert on outbox.consumer_receipts to pando_mastery_worker;

create policy focus_sessions_phase2_all on sessions.focus_sessions
for all to pando_phase2_api
using (identity.is_workspace_member(workspace_id))
with check (identity.is_workspace_member(workspace_id));
create policy custom_activities_phase2_read on overlay.custom_activities
for select to pando_phase2_api using (identity.is_workspace_member(workspace_id));
create policy activity_attempts_phase2_all on evidence.activity_attempts
for all to pando_phase2_api
using (identity.is_workspace_member(workspace_id))
with check (identity.is_workspace_member(workspace_id));
create policy subject_ledgers_phase2_all on evidence.subject_ledgers
for all to pando_phase2_api
using (identity.is_workspace_member(workspace_id))
with check (identity.is_workspace_member(workspace_id));
create policy observations_phase2_read on evidence.observations
for select to pando_phase2_api using (identity.is_workspace_member(workspace_id));
create policy observations_phase2_insert on evidence.observations
for insert to pando_phase2_api with check (identity.is_workspace_member(workspace_id));
create policy corrections_phase2_read on evidence.corrections
for select to pando_phase2_api using (identity.is_workspace_member(workspace_id));
create policy corrections_phase2_insert on evidence.corrections
for insert to pando_phase2_api with check (identity.is_workspace_member(workspace_id));
create policy mastery_snapshots_phase2_read on mastery.competency_state_snapshots
for select to pando_phase2_api using (identity.is_workspace_member(workspace_id));
create policy mastery_current_phase2_read on mastery.current_competency_states
for select to pando_phase2_api using (identity.is_workspace_member(workspace_id));

create policy mastery_ledgers_worker_read on evidence.subject_ledgers
for select to pando_mastery_worker using (true);
create policy mastery_observations_worker_read on evidence.observations
for select to pando_mastery_worker using (true);
create policy mastery_corrections_worker_read on evidence.corrections
for select to pando_mastery_worker using (true);
create policy mastery_snapshots_worker_all on mastery.competency_state_snapshots
for all to pando_mastery_worker using (true) with check (true);
create policy mastery_current_worker_all on mastery.current_competency_states
for all to pando_mastery_worker using (true) with check (true);
create policy mastery_deliveries_worker_all on outbox.deliveries
for all to pando_mastery_worker
using (consumer_name = 'mastery.evidence_projection_v1')
with check (consumer_name = 'mastery.evidence_projection_v1');
create policy mastery_events_worker_read on outbox.events
for select to pando_mastery_worker using (true);
create policy mastery_events_worker_insert on outbox.events
for insert to pando_mastery_worker
with check (
  event_name = 'mastery.competency_state_changed'
  and event_schema_version = 1
  and actor_type = 'system'
  and actor_user_id is null
  and source = 'pando.mastery_worker'
  and aggregate_type is null
  and aggregate_id is null
  and aggregate_version is null
);
create policy mastery_receipts_worker_read on outbox.consumer_receipts
for select to pando_mastery_worker
using (consumer_name = 'mastery.evidence_projection_v1');
create policy mastery_receipts_worker_insert on outbox.consumer_receipts
for insert to pando_mastery_worker
with check (consumer_name = 'mastery.evidence_projection_v1');

create policy command_receipts_phase2_select on outbox.command_receipts
for select to pando_phase2_api
using (
  actor_user_id = identity.current_user_id()
  and workspace_id is not null
  and identity.is_workspace_member(workspace_id)
);
create policy command_receipts_phase2_insert on outbox.command_receipts
for insert to pando_phase2_api
with check (
  actor_user_id = identity.current_user_id()
  and workspace_id is not null
  and identity.is_workspace_member(workspace_id)
);
create policy command_receipts_phase2_update on outbox.command_receipts
for update to pando_phase2_api
using (
  actor_user_id = identity.current_user_id()
  and workspace_id is not null
  and identity.is_workspace_member(workspace_id)
)
with check (
  actor_user_id = identity.current_user_id()
  and workspace_id is not null
  and identity.is_workspace_member(workspace_id)
);
create policy events_phase2_insert on outbox.events
for insert to pando_phase2_api with check (identity.is_workspace_member(workspace_id));
create policy events_phase2_select on outbox.events
for select to pando_phase2_api using (identity.is_workspace_member(workspace_id));
create policy deliveries_phase2_insert on outbox.deliveries
for insert to pando_phase2_api
with check (
  identity.is_workspace_member(workspace_id)
  and consumer_name = 'mastery.evidence_projection_v1'
  and handler_contract_version = 1
);
create policy deliveries_phase2_select on outbox.deliveries
for select to pando_phase2_api
using (
  identity.is_workspace_member(workspace_id)
  and consumer_name = 'mastery.evidence_projection_v1'
  and handler_contract_version = 1
);

revoke all on function overlay.derive_custom_activity_evidence_mapping(),
  evidence.reject_immutable_evidence_mutation(),
  mastery.reject_snapshot_mutation()
  from public, anon, authenticated, service_role;

do $migration_role_membership$
begin
  execute pg_catalog.format(
    'revoke pando_rls_authorizer, pando_identity_api, pando_phase2_api, pando_mastery_worker from %I',
    current_user
  );
end
$migration_role_membership$;
