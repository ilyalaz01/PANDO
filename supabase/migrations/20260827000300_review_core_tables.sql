-- Phase 3A Review-owned append-only scheduling inputs and rebuildable current projection.

do $roles$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'pando_review_api') then
    execute 'create role pando_review_api nologin noinherit nobypassrls';
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'pando_review_worker') then
    execute 'create role pando_review_worker nologin noinherit nobypassrls';
  end if;
end
$roles$;

do $migration_role_membership$
begin
  execute pg_catalog.format(
    'grant pando_rls_authorizer, pando_identity_api, pando_review_api, pando_review_worker, pando_mastery_worker to %I with set true',
    current_user
  );
end
$migration_role_membership$;

grant create on schema identity to pando_identity_api;

create function identity.is_known_time_zone(p_time_zone text)
returns boolean
language sql
stable
set search_path = ''
as $function$
  select exists (
    select 1 from pg_catalog.pg_timezone_names as zone where zone.name = p_time_zone
  )
$function$;

alter table identity.workspaces
  add column time_zone text not null default 'UTC',
  add constraint workspaces_time_zone_shape_check check (
    time_zone = btrim(time_zone)
    and char_length(time_zone) between 1 and 100
    and time_zone ~ '^[A-Za-z0-9_+.-]+(?:/[A-Za-z0-9_+.-]+)*$'
    and identity.is_known_time_zone(time_zone) is true
  );

create table review.subject_ledgers (
  subject_id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references identity.workspaces (workspace_id) on delete restrict,
  subject_type text not null default 'COMPETENCY_DIMENSION',
  competency_ref text not null,
  dimension text not null,
  subject_ref text generated always as (competency_ref || '/' || lower(dimension)) stored,
  input_watermark bigint not null default 0,
  mastery_snapshot_id uuid,
  mastery_input_watermark bigint,
  mastery_projection_version bigint,
  readiness_goal_key text,
  activity_key text,
  activity_title text,
  updated_at timestamptz not null default clock_timestamp(),
  constraint review_subject_type_check check (subject_type = 'COMPETENCY_DIMENSION'),
  constraint review_subject_competency_check check (
    competency_ref ~ '^competency:[a-z0-9][a-z0-9-]{1,100}$'
  ),
  constraint review_subject_dimension_check check (
    dimension in ('KNOWLEDGE', 'RECALL', 'APPLICATION', 'INTERVIEW_EXECUTION')
  ),
  constraint review_subject_input_watermark_check check (input_watermark >= 0),
  constraint review_subject_mastery_watermarks_check check (
    (mastery_snapshot_id is null and mastery_input_watermark is null and mastery_projection_version is null)
    or (
      mastery_snapshot_id is not null
      and mastery_input_watermark > 0
      and mastery_projection_version > 0
    )
  ),
  constraint review_subject_focus_refs_check check (
    (readiness_goal_key is null and activity_key is null and activity_title is null)
    or (
      readiness_goal_key ~ '^goal:[a-z0-9][a-z0-9-]{1,100}$'
      and activity_key ~ '^activity:[a-z0-9][a-z0-9-]{1,100}$'
      and activity_title = btrim(activity_title)
      and char_length(activity_title) between 1 and 200
    )
  ),
  unique (workspace_id, subject_id),
  unique (workspace_id, subject_ref)
);

create table review.reason_sources (
  reason_id uuid primary key,
  workspace_id uuid not null references identity.workspaces (workspace_id) on delete restrict,
  subject_id uuid not null,
  source_key text not null,
  source_kind text not null,
  reason_type text not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint review_reason_source_subject_fk
    foreign key (workspace_id, subject_id)
    references review.subject_ledgers (workspace_id, subject_id)
    on delete restrict,
  constraint review_reason_source_key_check check (
    source_key = btrim(source_key) and char_length(source_key) between 1 and 240
  ),
  constraint review_reason_source_kind_check check (
    source_kind in ('MASTERY', 'PERSONAL_REMINDER')
  ),
  constraint review_reason_source_type_check check (
    (source_kind = 'PERSONAL_REMINDER' and reason_type = 'PERSONAL_REMINDER')
    or (source_kind = 'MASTERY' and reason_type in ('RETENTION_RISK', 'VERIFICATION_NEEDED'))
  ),
  unique (workspace_id, reason_id),
  unique (workspace_id, subject_id, reason_id, source_key),
  unique (workspace_id, subject_id, source_key),
  unique (workspace_id, subject_id, reason_type),
  unique (
    workspace_id, subject_id, reason_id, source_key, source_kind, reason_type
  )
);

create table review.reason_source_events (
  source_event_id uuid primary key,
  workspace_id uuid not null references identity.workspaces (workspace_id) on delete restrict,
  subject_id uuid not null,
  reason_id uuid not null,
  source_key text not null,
  source_revision bigint not null,
  source_kind text not null,
  reason_type text not null,
  occurrence_id uuid not null,
  base_due_at timestamptz not null,
  source_active boolean not null,
  upstream_event_id uuid,
  command_id uuid,
  actor_user_id uuid references identity.users (user_id) on delete restrict,
  recorded_at timestamptz not null default clock_timestamp(),
  constraint review_reason_subject_fk
    foreign key (workspace_id, subject_id)
    references review.subject_ledgers (workspace_id, subject_id)
    on delete restrict,
  constraint review_reason_identity_fk
    foreign key (
      workspace_id, subject_id, reason_id, source_key, source_kind, reason_type
    )
    references review.reason_sources (
      workspace_id, subject_id, reason_id, source_key, source_kind, reason_type
    )
    on delete restrict,
  constraint review_reason_source_key_check check (
    source_key = btrim(source_key) and char_length(source_key) between 1 and 240
  ),
  constraint review_reason_revision_check check (source_revision > 0),
  constraint review_reason_source_kind_check check (
    source_kind in ('MASTERY', 'PERSONAL_REMINDER')
  ),
  constraint review_reason_type_check check (
    reason_type in (
      'RETENTION_RISK', 'PERSONAL_REMINDER', 'GOAL_DEADLINE', 'VERIFICATION_NEEDED'
    )
  ),
  constraint review_reason_source_type_check check (
    (source_kind = 'PERSONAL_REMINDER' and reason_type = 'PERSONAL_REMINDER')
    or (source_kind = 'MASTERY' and reason_type in ('RETENTION_RISK', 'VERIFICATION_NEEDED'))
  ),
  constraint review_reason_provenance_check check (
    (
      source_kind = 'MASTERY'
      and upstream_event_id is not null
      and command_id is null
      and actor_user_id is null
    )
    or (
      source_kind = 'PERSONAL_REMINDER'
      and upstream_event_id is null
      and command_id is not null
      and actor_user_id is not null
    )
  ),
  unique (workspace_id, source_event_id),
  unique (workspace_id, subject_id, source_key, source_revision),
  unique (workspace_id, upstream_event_id, subject_id, reason_type)
);

create index review_reason_sources_by_subject
  on review.reason_source_events (workspace_id, subject_id, source_key, source_revision desc);

create table review.action_events (
  action_id uuid primary key,
  workspace_id uuid not null references identity.workspaces (workspace_id) on delete restrict,
  subject_id uuid not null,
  reason_id uuid not null,
  source_key text not null,
  action_revision bigint not null,
  occurrence_id uuid not null,
  action_type text not null,
  old_due_at timestamptz,
  new_due_at timestamptz,
  actor_user_id uuid not null references identity.users (user_id) on delete restrict,
  command_id uuid not null,
  occurred_at timestamptz not null default clock_timestamp(),
  constraint review_action_subject_fk
    foreign key (workspace_id, subject_id)
    references review.subject_ledgers (workspace_id, subject_id)
    on delete restrict,
  constraint review_action_reason_fk
    foreign key (workspace_id, subject_id, reason_id, source_key)
    references review.reason_sources (workspace_id, subject_id, reason_id, source_key)
    on delete restrict,
  constraint review_action_source_key_check check (
    source_key = btrim(source_key) and char_length(source_key) between 1 and 240
  ),
  constraint review_action_revision_check check (action_revision > 0),
  constraint review_action_type_check check (
    action_type in ('RESCHEDULE', 'SKIP_ONCE', 'SUPPRESS', 'RESTORE')
  ),
  constraint review_action_due_check check (
    (action_type in ('RESCHEDULE', 'SKIP_ONCE') and old_due_at is not null and new_due_at is not null)
    or (action_type in ('SUPPRESS', 'RESTORE') and old_due_at is null and new_due_at is null)
  ),
  constraint review_action_skip_moves_forward_check check (
    action_type <> 'SKIP_ONCE' or new_due_at > old_due_at
  ),
  unique (workspace_id, action_id),
  unique (workspace_id, subject_id, action_revision),
  unique (workspace_id, command_id)
);

create unique index review_one_skip_per_occurrence
  on review.action_events (workspace_id, source_key, occurrence_id)
  where action_type = 'SKIP_ONCE';
create index review_actions_by_subject
  on review.action_events (workspace_id, subject_id, action_revision, action_id);

create table review.item_snapshots (
  snapshot_id uuid primary key,
  workspace_id uuid not null references identity.workspaces (workspace_id) on delete restrict,
  subject_id uuid not null,
  projection_generation text not null,
  input_watermark bigint not null,
  engine_version text not null,
  policy_version text not null,
  calculated_as_of timestamptz not null,
  effective_due_at timestamptz,
  state jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint review_snapshot_subject_fk
    foreign key (workspace_id, subject_id)
    references review.subject_ledgers (workspace_id, subject_id)
    on delete restrict,
  constraint review_snapshot_generation_check check (
    projection_generation ~ '^[a-z][a-z0-9_.-]{1,79}$'
  ),
  constraint review_snapshot_watermark_check check (input_watermark > 0),
  constraint review_snapshot_engine_check check (engine_version = 'review-engine/0.1.0'),
  constraint review_snapshot_policy_check check (policy_version = 'review-policy/0.1'),
  constraint review_snapshot_state_check check (
    (
    jsonb_typeof(state) = 'object'
    and state ? 'calculation'
    and jsonb_typeof(state->'calculation') = 'object'
    and state->'calculation'->>'engineVersion' = engine_version
    and state->'calculation'->>'policyVersion' = policy_version
    and state->'calculation'->>'inputWatermark' = input_watermark::text
    and state ? 'reasons'
    and jsonb_typeof(state->'reasons') = 'array'
    ) is true
  ),
  unique (workspace_id, snapshot_id),
  unique (workspace_id, subject_id, snapshot_id),
  unique (
    workspace_id, subject_id, engine_version, policy_version,
    projection_generation, input_watermark
  )
);

create table review.items (
  workspace_id uuid not null references identity.workspaces (workspace_id) on delete restrict,
  subject_id uuid not null,
  snapshot_id uuid not null,
  subject_ref text not null,
  competency_ref text not null,
  dimension text not null,
  activity_key text,
  activity_title text,
  readiness_goal_key text,
  input_watermark bigint not null,
  projection_version bigint not null default 1,
  effective_due_at timestamptz,
  has_active_reasons boolean not null,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (workspace_id, subject_id),
  unique (workspace_id, subject_id, snapshot_id),
  constraint review_item_subject_fk
    foreign key (workspace_id, subject_id)
    references review.subject_ledgers (workspace_id, subject_id)
    on delete restrict,
  constraint review_item_snapshot_fk
    foreign key (workspace_id, subject_id, snapshot_id)
    references review.item_snapshots (workspace_id, subject_id, snapshot_id)
    on delete restrict,
  constraint review_item_watermark_check check (input_watermark > 0),
  constraint review_item_projection_version_check check (projection_version > 0),
  constraint review_item_active_due_check check (
    has_active_reasons = (effective_due_at is not null)
  )
);

create table review.item_reasons (
  workspace_id uuid not null references identity.workspaces (workspace_id) on delete restrict,
  subject_id uuid not null,
  snapshot_id uuid not null,
  reason_id uuid not null,
  source_key text not null,
  source_revision bigint not null,
  source_kind text not null,
  reason_type text not null,
  occurrence_id uuid not null,
  base_due_at timestamptz not null,
  due_at timestamptz not null,
  source_active boolean not null,
  suppressed boolean not null,
  active boolean not null,
  primary key (workspace_id, subject_id, reason_id),
  constraint review_item_reason_item_fk
    foreign key (workspace_id, subject_id, snapshot_id)
    references review.items (workspace_id, subject_id, snapshot_id)
    on delete restrict,
  constraint review_item_reason_snapshot_fk
    foreign key (workspace_id, subject_id, snapshot_id)
    references review.item_snapshots (workspace_id, subject_id, snapshot_id)
    on delete restrict,
  constraint review_item_reason_source_kind_check check (
    source_kind in ('MASTERY', 'PERSONAL_REMINDER')
  ),
  constraint review_item_reason_type_check check (
    reason_type in (
      'RETENTION_RISK', 'PERSONAL_REMINDER', 'GOAL_DEADLINE', 'VERIFICATION_NEEDED'
    )
  ),
  constraint review_item_reason_source_key_check check (
    source_key = btrim(source_key) and char_length(source_key) between 1 and 240
  ),
  constraint review_item_reason_source_revision_check check (source_revision > 0),
  constraint review_item_reason_source_type_check check (
    (source_kind = 'PERSONAL_REMINDER' and reason_type = 'PERSONAL_REMINDER')
    or (source_kind = 'MASTERY' and reason_type in ('RETENTION_RISK', 'VERIFICATION_NEEDED'))
  ),
  constraint review_item_reason_identity_fk
    foreign key (
      workspace_id, subject_id, reason_id, source_key, source_kind, reason_type
    )
    references review.reason_sources (
      workspace_id, subject_id, reason_id, source_key, source_kind, reason_type
    )
    on delete restrict,
  constraint review_item_reason_state_check check (
    active = (source_active and not suppressed)
  )
);

do $rls$
declare
  qualified_table text;
begin
  foreach qualified_table in array array[
    'review.subject_ledgers',
    'review.reason_sources',
    'review.reason_source_events',
    'review.action_events',
    'review.item_snapshots',
    'review.items',
    'review.item_reasons'
  ]
  loop
    execute 'alter table ' || qualified_table || ' enable row level security';
    execute 'alter table ' || qualified_table || ' force row level security';
    execute 'revoke all on table ' || qualified_table || ' from public, anon, authenticated, service_role';
  end loop;
end
$rls$;

create function review.reject_immutable_history_mutation()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  raise exception using errcode = '55000', message = 'review history rows are immutable';
end
$function$;

create trigger review_sources_are_immutable
before update or delete on review.reason_source_events
for each row execute function review.reject_immutable_history_mutation();
create trigger review_reason_identities_are_immutable
before update or delete on review.reason_sources
for each row execute function review.reject_immutable_history_mutation();
create trigger review_actions_are_immutable
before update or delete on review.action_events
for each row execute function review.reject_immutable_history_mutation();
create trigger review_snapshots_are_immutable
before update or delete on review.item_snapshots
for each row execute function review.reject_immutable_history_mutation();

set role pando_rls_authorizer;
grant execute on function identity.jwt_subject(), identity.current_user_id(),
  identity.is_workspace_member(uuid), identity.personal_workspace_id_for_current_user()
  to pando_review_api;
reset role;

grant usage on schema api, identity, review, outbox, extensions to pando_review_api;
grant usage on schema review, mastery, outbox to pando_review_worker;
grant execute on function extensions.digest(bytea, text) to pando_review_api;
grant select on review.subject_ledgers to pando_review_api;
grant insert (
  subject_id, workspace_id, subject_type, competency_ref, dimension,
  input_watermark, updated_at
) on review.subject_ledgers to pando_review_api;
grant update (input_watermark, updated_at) on review.subject_ledgers to pando_review_api;
grant select, insert on review.reason_sources to pando_review_api;
grant select, insert on review.reason_source_events, review.action_events to pando_review_api;
grant select on review.item_snapshots, review.items, review.item_reasons to pando_review_api;
grant select, insert, update on outbox.command_receipts to pando_review_api;
grant insert on outbox.events, outbox.deliveries to pando_review_api;
grant usage, select on sequence outbox.events_event_position_seq to pando_review_api;

grant select, insert, update on review.subject_ledgers to pando_review_worker;
grant select, insert on review.reason_sources to pando_review_worker;
grant select, insert on review.reason_source_events, review.item_snapshots to pando_review_worker;
grant select on review.action_events to pando_review_worker;
grant select, insert, update, delete on review.items, review.item_reasons to pando_review_worker;
grant select, insert, update on outbox.deliveries to pando_review_worker;
grant select, insert on outbox.events to pando_review_worker;
grant usage, select on sequence outbox.events_event_position_seq to pando_review_worker;
grant select, insert on outbox.consumer_receipts to pando_review_worker;

create policy review_subjects_api_all on review.subject_ledgers
for all to pando_review_api
using (identity.is_workspace_member(workspace_id))
with check (identity.is_workspace_member(workspace_id));
create policy review_reason_identities_api_read on review.reason_sources
for select to pando_review_api using (identity.is_workspace_member(workspace_id));
create policy review_reason_identities_api_insert on review.reason_sources
for insert to pando_review_api with check (
  identity.is_workspace_member(workspace_id)
  and source_kind = 'PERSONAL_REMINDER'
  and reason_type = 'PERSONAL_REMINDER'
);
create policy review_sources_api_read on review.reason_source_events
for select to pando_review_api using (identity.is_workspace_member(workspace_id));
create policy review_sources_api_insert on review.reason_source_events
for insert to pando_review_api with check (
  identity.is_workspace_member(workspace_id)
  and source_kind = 'PERSONAL_REMINDER'
  and reason_type = 'PERSONAL_REMINDER'
  and upstream_event_id is null
  and actor_user_id = identity.current_user_id()
);
create policy review_actions_api_read on review.action_events
for select to pando_review_api using (identity.is_workspace_member(workspace_id));
create policy review_actions_api_insert on review.action_events
for insert to pando_review_api with check (
  identity.is_workspace_member(workspace_id)
  and actor_user_id = identity.current_user_id()
);
create policy review_snapshots_api_read on review.item_snapshots
for select to pando_review_api using (identity.is_workspace_member(workspace_id));
create policy review_items_api_read on review.items
for select to pando_review_api using (identity.is_workspace_member(workspace_id));
create policy review_item_reasons_api_read on review.item_reasons
for select to pando_review_api using (identity.is_workspace_member(workspace_id));

create policy review_subjects_worker_all on review.subject_ledgers
for all to pando_review_worker using (true) with check (true);
create policy review_reason_identities_worker_read on review.reason_sources
for select to pando_review_worker using (true);
create policy review_reason_identities_worker_insert on review.reason_sources
for insert to pando_review_worker with check (
  source_kind = 'MASTERY'
  and reason_type in ('RETENTION_RISK', 'VERIFICATION_NEEDED')
);
create policy review_sources_worker_read on review.reason_source_events
for select to pando_review_worker using (true);
create policy review_sources_worker_insert on review.reason_source_events
for insert to pando_review_worker with check (
  source_kind = 'MASTERY'
  and reason_type in ('RETENTION_RISK', 'VERIFICATION_NEEDED')
  and upstream_event_id is not null
  and command_id is null
  and actor_user_id is null
);
create policy review_actions_worker_read on review.action_events
for select to pando_review_worker using (true);
create policy review_snapshots_worker_all on review.item_snapshots
for all to pando_review_worker using (true) with check (true);
create policy review_items_worker_all on review.items
for all to pando_review_worker using (true) with check (true);
create policy review_item_reasons_worker_all on review.item_reasons
for all to pando_review_worker using (true) with check (true);
create policy review_deliveries_worker_all on outbox.deliveries
for all to pando_review_worker
using (consumer_name = 'review.item_projection_v1')
with check (consumer_name = 'review.item_projection_v1');
create policy review_events_worker_read on outbox.events
for select to pando_review_worker using (
  exists (
    select 1
    from outbox.deliveries as delivery
    where delivery.workspace_id = events.workspace_id
      and delivery.event_id = events.event_id
      and delivery.consumer_name = 'review.item_projection_v1'
      and delivery.handler_contract_version = 1
  )
);
create policy review_events_worker_insert on outbox.events
for insert to pando_review_worker
with check (
  event_name = 'review.item_changed'
  and event_schema_version = 1
  and actor_type = 'system'
  and actor_user_id is null
  and aggregate_type = 'review.subject'
  and aggregate_id is not null
  and aggregate_version is not null
  and source = 'pando.review_worker'
);
create policy review_receipts_worker_read on outbox.consumer_receipts
for select to pando_review_worker using (consumer_name = 'review.item_projection_v1');
create policy review_receipts_worker_insert on outbox.consumer_receipts
for insert to pando_review_worker
with check (consumer_name = 'review.item_projection_v1');

create policy review_command_receipts_select on outbox.command_receipts
for select to pando_review_api
using (
  actor_user_id = identity.current_user_id()
  and workspace_id is not null
  and identity.is_workspace_member(workspace_id)
);
create policy review_command_receipts_insert on outbox.command_receipts
for insert to pando_review_api
with check (
  actor_user_id = identity.current_user_id()
  and workspace_id is not null
  and identity.is_workspace_member(workspace_id)
);
create policy review_command_receipts_update on outbox.command_receipts
for update to pando_review_api
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
create policy review_outbox_events_api_insert on outbox.events
for insert to pando_review_api
with check (
  identity.is_workspace_member(workspace_id)
  and event_name = 'review.input_changed'
  and event_schema_version = 1
  and actor_type = 'user'
  and actor_user_id = identity.current_user_id()
  and source = 'pando.database'
);
create policy review_outbox_deliveries_api_insert on outbox.deliveries
for insert to pando_review_api
with check (
  identity.is_workspace_member(workspace_id)
  and consumer_name = 'review.item_projection_v1'
  and handler_contract_version = 1
);

alter function identity.is_known_time_zone(text) owner to pando_identity_api;
revoke all on function identity.is_known_time_zone(text),
  review.reject_immutable_history_mutation()
  from public, anon, authenticated, service_role;
-- Supabase's logical restore runner inserts table data as postgres, so it must be able to
-- evaluate the Identity-owned CHECK constraint without broadening the application surface.
grant execute on function identity.is_known_time_zone(text) to postgres;
revoke create on schema identity from pando_identity_api;

do $migration_role_membership$
begin
  execute pg_catalog.format(
    'revoke pando_rls_authorizer, pando_identity_api, pando_review_api, pando_review_worker, pando_mastery_worker from %I',
    current_user
  );
end
$migration_role_membership$;
