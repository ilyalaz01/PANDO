-- Minimal Identity and transactional outbox storage. Domain feature tables are
-- deliberately deferred to their owning vertical slices.

create table identity.users (
  user_id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users (id) on delete restrict,
  created_at timestamptz not null default clock_timestamp()
);

create table identity.workspaces (
  workspace_id uuid primary key default gen_random_uuid(),
  workspace_kind text not null default 'personal',
  display_name text not null,
  created_by_user_id uuid not null references identity.users (user_id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  constraint workspaces_kind_check check (workspace_kind in ('personal')),
  constraint workspaces_display_name_check check (
    display_name = btrim(display_name)
    and char_length(display_name) between 1 and 120
  )
);

create unique index one_personal_workspace_per_creator
  on identity.workspaces (created_by_user_id)
  where workspace_kind = 'personal';

create table identity.workspace_memberships (
  workspace_id uuid not null references identity.workspaces (workspace_id) on delete restrict,
  user_id uuid not null references identity.users (user_id) on delete restrict,
  membership_role text not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (workspace_id, user_id),
  constraint workspace_memberships_role_check check (membership_role in ('owner', 'member'))
);

create table outbox.command_receipts (
  command_id uuid primary key,
  command_type text not null,
  command_schema_version smallint not null,
  workspace_id uuid references identity.workspaces (workspace_id) on delete restrict,
  actor_user_id uuid not null references identity.users (user_id) on delete restrict,
  idempotency_key text not null,
  request_hash bytea not null,
  correlation_id uuid not null,
  causation_id uuid,
  expected_aggregate_version bigint,
  command_status text not null default 'started',
  response jsonb,
  emitted_event_ids uuid[] not null default '{}'::uuid[],
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  constraint command_receipts_schema_version_check check (command_schema_version > 0),
  constraint command_receipts_idempotency_key_check check (
    idempotency_key = btrim(idempotency_key)
    and char_length(idempotency_key) between 1 and 128
  ),
  constraint command_receipts_request_hash_check check (octet_length(request_hash) = 32),
  constraint command_receipts_expected_version_check check (
    expected_aggregate_version is null or expected_aggregate_version >= 0
  ),
  constraint command_receipts_status_check check (command_status in ('started', 'completed')),
  constraint command_receipts_completion_check check (
    (
      command_status = 'started'
      and response is null
      and completed_at is null
      and cardinality(emitted_event_ids) = 0
    )
    or
    (
      command_status = 'completed'
      and workspace_id is not null
      and response is not null
      and completed_at is not null
    )
  ),
  unique (command_id, workspace_id)
);

create unique index command_receipts_actor_idempotency_key
  on outbox.command_receipts (actor_user_id, command_type, idempotency_key);

create table outbox.events (
  event_id uuid primary key default gen_random_uuid(),
  event_position bigint generated always as identity,
  event_name text not null,
  event_schema_version smallint not null,
  workspace_id uuid not null references identity.workspaces (workspace_id) on delete restrict,
  aggregate_type text,
  aggregate_id uuid,
  aggregate_version bigint,
  actor_type text not null,
  actor_user_id uuid references identity.users (user_id) on delete restrict,
  command_id uuid not null,
  correlation_id uuid not null,
  causation_id uuid,
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default clock_timestamp(),
  source text not null,
  payload jsonb not null,
  metadata jsonb not null default '{}'::jsonb,
  constraint events_command_workspace_fk
    foreign key (command_id, workspace_id)
    references outbox.command_receipts (command_id, workspace_id)
    on delete restrict,
  constraint events_schema_version_check check (event_schema_version > 0),
  constraint events_name_check check (
    event_name ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'
    and char_length(event_name) <= 160
  ),
  constraint events_aggregate_check check (
    (aggregate_type is null and aggregate_id is null and aggregate_version is null)
    or
    (
      aggregate_type is not null
      and aggregate_id is not null
      and aggregate_version is not null
      and aggregate_version > 0
    )
  ),
  constraint events_actor_check check (
    actor_type in ('user', 'system', 'integration')
    and (actor_type <> 'user' or actor_user_id is not null)
  ),
  constraint events_source_check check (
    source ~ '^[a-z][a-z0-9_.-]{0,79}$'
  ),
  constraint events_payload_object_check check (jsonb_typeof(payload) = 'object'),
  constraint events_metadata_object_check check (jsonb_typeof(metadata) = 'object'),
  unique (event_position),
  unique (event_id, workspace_id)
);

comment on column outbox.events.event_position is
  'Observation cursor only. Identity allocation does not imply global commit order.';

create table outbox.deliveries (
  delivery_id uuid primary key default gen_random_uuid(),
  event_id uuid not null,
  workspace_id uuid not null,
  consumer_name text not null,
  handler_contract_version smallint not null,
  delivery_state text not null default 'pending',
  attempt_count smallint not null default 0,
  available_at timestamptz not null default clock_timestamp(),
  lease_token uuid,
  lease_expires_at timestamptz,
  last_failure_class text,
  last_error_code text,
  last_failed_at timestamptz,
  completed_at timestamptz,
  dead_lettered_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  constraint deliveries_event_workspace_fk
    foreign key (event_id, workspace_id)
    references outbox.events (event_id, workspace_id)
    on delete restrict,
  constraint deliveries_contract_version_check check (handler_contract_version > 0),
  constraint deliveries_consumer_name_check check (
    consumer_name ~ '^[a-z][a-z0-9_.-]{0,119}$'
  ),
  constraint deliveries_state_check check (
    delivery_state in ('pending', 'leased', 'retry', 'succeeded', 'dead_letter')
  ),
  constraint deliveries_attempt_count_check check (attempt_count between 0 and 8),
  constraint deliveries_lease_check check (
    (delivery_state = 'leased' and lease_token is not null and lease_expires_at is not null)
    or
    (delivery_state <> 'leased' and lease_token is null and lease_expires_at is null)
  ),
  constraint deliveries_completion_check check (
    (delivery_state = 'succeeded' and completed_at is not null)
    or
    (delivery_state <> 'succeeded' and completed_at is null)
  ),
  constraint deliveries_dead_letter_check check (
    (delivery_state = 'dead_letter' and dead_lettered_at is not null)
    or
    (delivery_state <> 'dead_letter' and dead_lettered_at is null)
  ),
  constraint deliveries_event_consumer_contract_key
    unique (event_id, consumer_name, handler_contract_version),
  unique (
    delivery_id,
    event_id,
    workspace_id,
    consumer_name,
    handler_contract_version
  )
);

create index deliveries_claim_due
  on outbox.deliveries (available_at, delivery_id)
  where delivery_state in ('pending', 'retry', 'leased');

create table outbox.consumer_receipts (
  receipt_id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null,
  event_id uuid not null,
  workspace_id uuid not null,
  consumer_name text not null,
  handler_contract_version smallint not null,
  input_event_position bigint not null,
  lease_token uuid not null,
  processed_at timestamptz not null default clock_timestamp(),
  constraint consumer_receipts_delivery_contract_fk
    foreign key (
      delivery_id,
      event_id,
      workspace_id,
      consumer_name,
      handler_contract_version
    )
    references outbox.deliveries (
      delivery_id,
      event_id,
      workspace_id,
      consumer_name,
      handler_contract_version
    )
    on delete restrict,
  constraint consumer_receipts_contract_version_check check (handler_contract_version > 0),
  constraint consumer_receipts_event_consumer_contract_key
    unique (event_id, consumer_name, handler_contract_version),
  constraint consumer_receipts_delivery_key unique (delivery_id)
);

alter table identity.users enable row level security;
alter table identity.users force row level security;
alter table identity.workspaces enable row level security;
alter table identity.workspaces force row level security;
alter table identity.workspace_memberships enable row level security;
alter table identity.workspace_memberships force row level security;
alter table outbox.command_receipts enable row level security;
alter table outbox.command_receipts force row level security;
alter table outbox.events enable row level security;
alter table outbox.events force row level security;
alter table outbox.deliveries enable row level security;
alter table outbox.deliveries force row level security;
alter table outbox.consumer_receipts enable row level security;
alter table outbox.consumer_receipts force row level security;

create function outbox.reject_event_mutation()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  raise exception using
    errcode = '55000',
    message = 'outbox events are immutable';
end
$function$;

create trigger outbox_events_are_immutable
before update or delete on outbox.events
for each row execute function outbox.reject_event_mutation();

create function outbox.protect_completed_command_receipt()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if tg_op = 'DELETE' or old.command_status = 'completed' then
    raise exception using
      errcode = '55000',
      message = 'completed command receipts are immutable';
  end if;

  return new;
end
$function$;

create trigger completed_command_receipts_are_immutable
before update or delete on outbox.command_receipts
for each row execute function outbox.protect_completed_command_receipt();

create function outbox.reject_consumer_receipt_mutation()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  raise exception using
    errcode = '55000',
    message = 'consumer receipts are immutable';
end
$function$;

create trigger consumer_receipts_are_immutable
before update or delete on outbox.consumer_receipts
for each row execute function outbox.reject_consumer_receipt_mutation();

revoke all on all tables in schema identity from public, anon, authenticated;
revoke all on all sequences in schema identity from public, anon, authenticated;
revoke all on all functions in schema identity from public, anon, authenticated;
revoke all on all tables in schema outbox from public, anon, authenticated;
revoke all on all sequences in schema outbox from public, anon, authenticated;
revoke all on all functions in schema outbox from public, anon, authenticated;
