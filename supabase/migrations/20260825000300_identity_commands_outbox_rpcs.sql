-- RLS helpers, purpose-specific command/query RPCs, and the fixed Phase 0
-- outbox probe consumer. Public api functions are SECURITY INVOKER wrappers;
-- privileged implementations remain in non-exposed schemas.

do $migration_role_membership$
begin
  execute pg_catalog.format(
    'grant pando_rls_authorizer, pando_identity_api, pando_outbox_worker to %I',
    current_user
  );
end
$migration_role_membership$;

revoke all on all tables in schema identity from service_role;
revoke all on all sequences in schema identity from service_role;
revoke all on all functions in schema identity from service_role;
revoke all on all tables in schema outbox from service_role;
revoke all on all sequences in schema outbox from service_role;
revoke all on all functions in schema outbox from service_role;

grant usage, create on schema identity to pando_rls_authorizer, pando_identity_api;
grant usage, create on schema outbox to pando_outbox_worker;
grant usage on schema outbox to pando_identity_api;

grant select on identity.users, identity.workspaces, identity.workspace_memberships
  to pando_rls_authorizer;

create function identity.jwt_subject()
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select nullif(
    coalesce(
      nullif(pg_catalog.current_setting('request.jwt.claim.sub', true), ''),
      (
        nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb
        ->> 'sub'
      )
    ),
    ''
  )::uuid
$function$;

alter function identity.jwt_subject() owner to pando_rls_authorizer;
revoke all on function identity.jwt_subject()
  from public, anon, authenticated, service_role;
grant execute on function identity.jwt_subject() to pando_identity_api;

create function identity.current_user_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select u.user_id
  from identity.users as u
  where u.auth_user_id = identity.jwt_subject()
$function$;

alter function identity.current_user_id() owner to pando_rls_authorizer;
revoke all on function identity.current_user_id() from public, anon, authenticated, service_role;
grant execute on function identity.current_user_id() to pando_identity_api;

create function identity.is_workspace_member(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from identity.workspace_memberships as membership
    join identity.users as member_user
      on member_user.user_id = membership.user_id
    where membership.workspace_id = p_workspace_id
      and member_user.auth_user_id = identity.jwt_subject()
  )
$function$;

alter function identity.is_workspace_member(uuid) owner to pando_rls_authorizer;
revoke all on function identity.is_workspace_member(uuid) from public, anon, authenticated, service_role;
grant execute on function identity.is_workspace_member(uuid) to pando_identity_api;

create function identity.can_bootstrap_owner_membership(
  p_workspace_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from identity.workspaces as workspace
    join identity.users as owner_user
      on owner_user.user_id = workspace.created_by_user_id
    where workspace.workspace_id = p_workspace_id
      and workspace.created_by_user_id = p_user_id
      and owner_user.auth_user_id = identity.jwt_subject()
      and workspace.workspace_kind = 'personal'
  )
$function$;

alter function identity.can_bootstrap_owner_membership(uuid, uuid)
  owner to pando_rls_authorizer;
revoke all on function identity.can_bootstrap_owner_membership(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function identity.can_bootstrap_owner_membership(uuid, uuid)
  to pando_identity_api;

create function identity.personal_workspace_id_for_current_user()
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select workspace.workspace_id
  from identity.workspaces as workspace
  join identity.users as owner_user
    on owner_user.user_id = workspace.created_by_user_id
  where owner_user.auth_user_id = identity.jwt_subject()
    and workspace.workspace_kind = 'personal'
$function$;

alter function identity.personal_workspace_id_for_current_user()
  owner to pando_rls_authorizer;
revoke all on function identity.personal_workspace_id_for_current_user()
  from public, anon, authenticated, service_role;
grant execute on function identity.personal_workspace_id_for_current_user()
  to pando_identity_api;

create policy users_select_self
on identity.users
for select
to pando_identity_api
using (user_id = identity.current_user_id());

create policy users_insert_self
on identity.users
for insert
to pando_identity_api
with check (auth_user_id = identity.jwt_subject());

create policy workspaces_select_member
on identity.workspaces
for select
to pando_identity_api
using (identity.is_workspace_member(workspace_id));

create policy workspaces_insert_personal_owner
on identity.workspaces
for insert
to pando_identity_api
with check (
  workspace_kind = 'personal'
  and created_by_user_id = identity.current_user_id()
);

create policy workspace_memberships_select_member
on identity.workspace_memberships
for select
to pando_identity_api
using (identity.is_workspace_member(workspace_id));

create policy workspace_memberships_insert_initial_owner
on identity.workspace_memberships
for insert
to pando_identity_api
with check (
  membership_role = 'owner'
  and user_id = identity.current_user_id()
  and identity.can_bootstrap_owner_membership(workspace_id, user_id)
);

create policy command_receipts_select_member_or_bootstrap_actor
on outbox.command_receipts
for select
to pando_identity_api
using (
  actor_user_id = identity.current_user_id()
  and (
    workspace_id is null
    or identity.is_workspace_member(workspace_id)
  )
);

create policy command_receipts_insert_bootstrap_actor
on outbox.command_receipts
for insert
to pando_identity_api
with check (
  actor_user_id = identity.current_user_id()
  and (
    workspace_id is null
    or identity.is_workspace_member(workspace_id)
  )
);

create policy command_receipts_update_bootstrap_actor
on outbox.command_receipts
for update
to pando_identity_api
using (
  actor_user_id = identity.current_user_id()
  and (
    workspace_id is null
    or identity.is_workspace_member(workspace_id)
  )
)
with check (
  actor_user_id = identity.current_user_id()
  and workspace_id is not null
  and identity.is_workspace_member(workspace_id)
);

create policy events_insert_member
on outbox.events
for insert
to pando_identity_api
with check (identity.is_workspace_member(workspace_id));

create policy deliveries_insert_member
on outbox.deliveries
for insert
to pando_identity_api
with check (identity.is_workspace_member(workspace_id));

create policy worker_select_events
on outbox.events
for select
to pando_outbox_worker
using (true);

create policy worker_select_deliveries
on outbox.deliveries
for select
to pando_outbox_worker
using (true);

create policy worker_update_deliveries
on outbox.deliveries
for update
to pando_outbox_worker
using (true)
with check (true);

create policy worker_select_consumer_receipts
on outbox.consumer_receipts
for select
to pando_outbox_worker
using (true);

create policy worker_insert_consumer_receipts
on outbox.consumer_receipts
for insert
to pando_outbox_worker
with check (true);

grant select, insert on identity.users to pando_identity_api;
grant select, insert on identity.workspaces to pando_identity_api;
grant select, insert on identity.workspace_memberships to pando_identity_api;
grant select, insert, update on outbox.command_receipts to pando_identity_api;
grant insert on outbox.events, outbox.deliveries to pando_identity_api;
grant usage, select on sequence outbox.events_event_position_seq to pando_identity_api;

grant select on outbox.events to pando_outbox_worker;
grant select, update on outbox.deliveries to pando_outbox_worker;
grant select, insert on outbox.consumer_receipts to pando_outbox_worker;

create function identity.bootstrap_personal_workspace_impl(
  p_idempotency_key text,
  p_workspace_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_auth_user_id uuid := identity.jwt_subject();
  v_actor_user_id uuid;
  v_workspace_id uuid;
  v_existing_workspace_id uuid;
  v_existing_workspace_name text;
  v_command_id uuid := gen_random_uuid();
  v_correlation_id uuid := gen_random_uuid();
  v_event_id uuid;
  v_normalized_name text := btrim(p_workspace_name);
  v_request_hash bytea;
  v_response jsonb;
  v_receipt outbox.command_receipts%rowtype;
begin
  if v_auth_user_id is null then
    raise exception using
      errcode = '28000',
      message = 'an authenticated user is required';
  end if;

  if p_idempotency_key is null
     or p_idempotency_key <> btrim(p_idempotency_key)
     or char_length(p_idempotency_key) not between 1 and 128 then
    raise exception using
      errcode = '22023',
      message = 'idempotency key must contain 1 to 128 trimmed characters';
  end if;

  if p_workspace_name is null
     or p_workspace_name <> v_normalized_name
     or char_length(v_normalized_name) not between 1 and 120 then
    raise exception using
      errcode = '22023',
      message = 'workspace name must contain 1 to 120 trimmed characters';
  end if;

  v_request_hash := extensions.digest(
    pg_catalog.convert_to(
      pg_catalog.jsonb_build_object(
        'command_type', 'identity.bootstrap_personal_workspace',
        'command_schema_version', 1,
        'workspace_name', v_normalized_name
      )::text,
      'UTF8'
    ),
    'sha256'
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_auth_user_id::text, 0)
  );

  select identity.current_user_id()
  into v_actor_user_id;

  if v_actor_user_id is null then
    v_actor_user_id := gen_random_uuid();

    insert into identity.users (user_id, auth_user_id)
    values (v_actor_user_id, v_auth_user_id);
  end if;

  if v_actor_user_id is null then
    raise exception using
      errcode = '28000',
      message = 'authenticated user is not provisioned';
  end if;

  select identity.personal_workspace_id_for_current_user()
  into v_existing_workspace_id;

  if v_existing_workspace_id is not null
     and not identity.is_workspace_member(v_existing_workspace_id) then
    raise exception using
      errcode = '42501',
      message = 'workspace is not accessible';
  end if;

  select receipt.*
  into v_receipt
  from outbox.command_receipts as receipt
  where receipt.actor_user_id = v_actor_user_id
    and receipt.command_type = 'identity.bootstrap_personal_workspace'
    and receipt.idempotency_key = p_idempotency_key
  for update;

  if found then
    if v_receipt.request_hash <> v_request_hash then
      raise exception using
        errcode = '22023',
        message = 'idempotency key reused with a different request';
    end if;

    if v_receipt.command_status <> 'completed' then
      raise exception using
        errcode = '40001',
        message = 'command receipt is not complete';
    end if;

    return v_receipt.response;
  end if;

  if v_existing_workspace_id is not null then
    select workspace.display_name
    into v_existing_workspace_name
    from identity.workspaces as workspace
    where workspace.workspace_id = v_existing_workspace_id;

    if v_existing_workspace_name is distinct from v_normalized_name then
      raise exception using
        errcode = '22023',
        message = 'personal workspace already exists with a different name';
    end if;
  end if;

  insert into outbox.command_receipts (
    command_id,
    command_type,
    command_schema_version,
    actor_user_id,
    idempotency_key,
    request_hash,
    correlation_id
  )
  values (
    v_command_id,
    'identity.bootstrap_personal_workspace',
    1,
    v_actor_user_id,
    p_idempotency_key,
    v_request_hash,
    v_correlation_id
  );

  if v_existing_workspace_id is null then
    v_workspace_id := gen_random_uuid();

    insert into identity.workspaces (
      workspace_id,
      workspace_kind,
      display_name,
      created_by_user_id
    )
    values (
      v_workspace_id,
      'personal',
      v_normalized_name,
      v_actor_user_id
    );

    insert into identity.workspace_memberships (
      workspace_id,
      user_id,
      membership_role
    )
    values (
      v_workspace_id,
      v_actor_user_id,
      'owner'
    );
  else
    v_workspace_id := v_existing_workspace_id;
  end if;

  update outbox.command_receipts
  set workspace_id = v_workspace_id
  where command_id = v_command_id;

  if v_existing_workspace_id is null then
    v_event_id := gen_random_uuid();

    insert into outbox.events (
      event_id,
      event_name,
      event_schema_version,
      workspace_id,
      aggregate_type,
      aggregate_id,
      aggregate_version,
      actor_type,
      actor_user_id,
      command_id,
      correlation_id,
      occurred_at,
      source,
      payload
    )
    values (
      v_event_id,
      'identity.workspace_bootstrapped',
      1,
      v_workspace_id,
      'identity.workspace',
      v_workspace_id,
      1,
      'user',
      v_actor_user_id,
      v_command_id,
      v_correlation_id,
      clock_timestamp(),
      'pando.database',
      pg_catalog.jsonb_build_object(
        'workspace_id', v_workspace_id,
        'workspace_kind', 'personal'
      )
    );

    insert into outbox.deliveries (
      event_id,
      workspace_id,
      consumer_name,
      handler_contract_version
    )
    values (
      v_event_id,
      v_workspace_id,
      'phase0.identity_workspace_bootstrap_probe',
      1
    );
  end if;

  v_response := pg_catalog.jsonb_build_object(
    'command_id', v_command_id,
    'workspace_id', v_workspace_id,
    'workspace_name', (
      select workspace.display_name
      from identity.workspaces as workspace
      where workspace.workspace_id = v_workspace_id
    ),
    'membership_role', 'owner',
    'emitted_event_ids', case
      when v_event_id is null then '[]'::jsonb
      else pg_catalog.jsonb_build_array(v_event_id)
    end
  );

  update outbox.command_receipts
  set command_status = 'completed',
      response = v_response,
      emitted_event_ids = case
        when v_event_id is null then '{}'::uuid[]
        else array[v_event_id]
      end,
      completed_at = clock_timestamp()
  where command_id = v_command_id;

  return v_response;
end
$function$;

alter function identity.bootstrap_personal_workspace_impl(text, text)
  owner to pando_identity_api;
revoke all on function identity.bootstrap_personal_workspace_impl(text, text)
  from public, anon, authenticated, service_role;
grant execute on function identity.bootstrap_personal_workspace_impl(text, text)
  to authenticated;
grant usage on schema identity to authenticated;

create function identity.get_workspace_impl(p_workspace_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_workspace identity.workspaces%rowtype;
begin
  if identity.jwt_subject() is null then
    raise exception using
      errcode = '28000',
      message = 'an authenticated user is required';
  end if;

  select workspace.*
  into v_workspace
  from identity.workspaces as workspace
  where workspace.workspace_id = p_workspace_id;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'workspace is not accessible';
  end if;

  return pg_catalog.jsonb_build_object(
    'workspace_id', v_workspace.workspace_id,
    'workspace_kind', v_workspace.workspace_kind,
    'display_name', v_workspace.display_name
  );
end
$function$;

alter function identity.get_workspace_impl(uuid) owner to pando_identity_api;
revoke all on function identity.get_workspace_impl(uuid)
  from public, anon, authenticated, service_role;
grant execute on function identity.get_workspace_impl(uuid) to authenticated;

create function api.bootstrap_personal_workspace(
  p_idempotency_key text,
  p_workspace_name text default 'Personal workspace'
)
returns jsonb
language sql
security invoker
set search_path = ''
as $function$
  select identity.bootstrap_personal_workspace_impl(
    p_idempotency_key,
    p_workspace_name
  )
$function$;

create function api.get_workspace(p_workspace_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  select identity.get_workspace_impl(p_workspace_id)
$function$;

revoke all on function api.bootstrap_personal_workspace(text, text)
  from public, anon, authenticated, service_role;
revoke all on function api.get_workspace(uuid)
  from public, anon, authenticated, service_role;
grant execute on function api.bootstrap_personal_workspace(text, text) to authenticated;
grant execute on function api.get_workspace(uuid) to authenticated;

create function outbox.claim_phase0_probe_deliveries_impl()
returns table (
  delivery_id uuid,
  event_id uuid,
  event_position bigint,
  workspace_id uuid,
  lease_token uuid,
  lease_expires_at timestamptz,
  attempt_count smallint,
  event_name text,
  event_schema_version smallint,
  payload jsonb,
  metadata jsonb
)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  update outbox.deliveries as exhausted
  set delivery_state = 'dead_letter',
      lease_token = null,
      lease_expires_at = null,
      last_failure_class = 'exhausted',
      last_error_code = 'lease_expired_after_max_attempts',
      last_failed_at = clock_timestamp(),
      dead_lettered_at = clock_timestamp()
  where exhausted.consumer_name = 'phase0.identity_workspace_bootstrap_probe'
    and exhausted.handler_contract_version = 1
    and exhausted.delivery_state = 'leased'
    and exhausted.lease_expires_at <= clock_timestamp()
    and exhausted.attempt_count >= 8;

  return query
  with candidates as (
    select delivery.delivery_id
    from outbox.deliveries as delivery
    join outbox.events as event
      on event.event_id = delivery.event_id
     and event.workspace_id = delivery.workspace_id
    where delivery.consumer_name = 'phase0.identity_workspace_bootstrap_probe'
      and delivery.handler_contract_version = 1
      and delivery.attempt_count < 8
      and (
        (
          delivery.delivery_state in ('pending', 'retry')
          and delivery.available_at <= clock_timestamp()
        )
        or
        (
          delivery.delivery_state = 'leased'
          and delivery.lease_expires_at <= clock_timestamp()
        )
      )
    order by delivery.available_at, event.event_position, delivery.delivery_id
    for update of delivery skip locked
    limit 5
  ),
  claimed as (
    update outbox.deliveries as delivery
    set delivery_state = 'leased',
        attempt_count = delivery.attempt_count + 1,
        lease_token = gen_random_uuid(),
        lease_expires_at = clock_timestamp() + interval '120 seconds',
        completed_at = null,
        dead_lettered_at = null
    from candidates
    where delivery.delivery_id = candidates.delivery_id
    returning delivery.*
  )
  select
    claimed.delivery_id,
    claimed.event_id,
    event.event_position,
    claimed.workspace_id,
    claimed.lease_token,
    claimed.lease_expires_at,
    claimed.attempt_count,
    event.event_name,
    event.event_schema_version,
    event.payload,
    event.metadata
  from claimed
  join outbox.events as event
    on event.event_id = claimed.event_id
   and event.workspace_id = claimed.workspace_id
  order by event.event_position, claimed.delivery_id;
end
$function$;

alter function outbox.claim_phase0_probe_deliveries_impl()
  owner to pando_outbox_worker;
revoke all on function outbox.claim_phase0_probe_deliveries_impl()
  from public, anon, authenticated, service_role;
grant execute on function outbox.claim_phase0_probe_deliveries_impl() to service_role;
grant usage on schema outbox to service_role;

create function outbox.complete_phase0_probe_delivery_impl(
  p_delivery_id uuid,
  p_lease_token uuid,
  p_expected_event_position bigint
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_delivery outbox.deliveries%rowtype;
  v_event_position bigint;
  v_receipt outbox.consumer_receipts%rowtype;
begin
  if p_delivery_id is null
     or p_lease_token is null
     or p_expected_event_position is null then
    raise exception using
      errcode = '22023',
      message = 'delivery completion arguments are required';
  end if;

  select delivery.*
  into v_delivery
  from outbox.deliveries as delivery
  where delivery.delivery_id = p_delivery_id
    and delivery.consumer_name = 'phase0.identity_workspace_bootstrap_probe'
    and delivery.handler_contract_version = 1
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'delivery is not accessible';
  end if;

  select event.event_position
  into v_event_position
  from outbox.events as event
  where event.event_id = v_delivery.event_id
    and event.workspace_id = v_delivery.workspace_id;

  if v_delivery.delivery_state = 'succeeded' then
    select receipt.*
    into v_receipt
    from outbox.consumer_receipts as receipt
    where receipt.delivery_id = v_delivery.delivery_id;

    if found
       and v_receipt.lease_token = p_lease_token
       and v_receipt.input_event_position = p_expected_event_position then
      return false;
    end if;

    raise exception using
      errcode = '55000',
      message = 'delivery lease is stale';
  end if;

  if v_delivery.delivery_state <> 'leased'
     or v_delivery.lease_token is distinct from p_lease_token
     or v_delivery.lease_expires_at <= clock_timestamp() then
    raise exception using
      errcode = '55000',
      message = 'delivery lease is stale';
  end if;

  if v_event_position is distinct from p_expected_event_position then
    raise exception using
      errcode = '22023',
      message = 'delivery input watermark does not match';
  end if;

  insert into outbox.consumer_receipts (
    delivery_id,
    event_id,
    workspace_id,
    consumer_name,
    handler_contract_version,
    input_event_position,
    lease_token
  )
  values (
    v_delivery.delivery_id,
    v_delivery.event_id,
    v_delivery.workspace_id,
    v_delivery.consumer_name,
    v_delivery.handler_contract_version,
    v_event_position,
    p_lease_token
  );

  update outbox.deliveries
  set delivery_state = 'succeeded',
      lease_token = null,
      lease_expires_at = null,
      completed_at = clock_timestamp()
  where delivery_id = v_delivery.delivery_id;

  return true;
end
$function$;

alter function outbox.complete_phase0_probe_delivery_impl(uuid, uuid, bigint)
  owner to pando_outbox_worker;
revoke all on function outbox.complete_phase0_probe_delivery_impl(uuid, uuid, bigint)
  from public, anon, authenticated, service_role;
grant execute on function outbox.complete_phase0_probe_delivery_impl(uuid, uuid, bigint)
  to service_role;

create function outbox.fail_phase0_probe_delivery_impl(
  p_delivery_id uuid,
  p_lease_token uuid,
  p_failure_class text,
  p_error_code text
)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_delivery outbox.deliveries%rowtype;
  v_backoff_seconds double precision;
begin
  if p_delivery_id is null or p_lease_token is null then
    raise exception using
      errcode = '22023',
      message = 'delivery failure arguments are required';
  end if;

  if p_failure_class is null
     or p_failure_class not in ('transient', 'permanent') then
    raise exception using
      errcode = '22023',
      message = 'failure class must be transient or permanent';
  end if;

  if p_error_code is null
     or p_error_code !~ '^[a-z0-9_.-]{1,64}$' then
    raise exception using
      errcode = '22023',
      message = 'error code must be a safe machine-readable identifier';
  end if;

  select delivery.*
  into v_delivery
  from outbox.deliveries as delivery
  where delivery.delivery_id = p_delivery_id
    and delivery.consumer_name = 'phase0.identity_workspace_bootstrap_probe'
    and delivery.handler_contract_version = 1
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'delivery is not accessible';
  end if;

  if v_delivery.delivery_state <> 'leased'
     or v_delivery.lease_token is distinct from p_lease_token
     or v_delivery.lease_expires_at <= clock_timestamp() then
    raise exception using
      errcode = '55000',
      message = 'delivery lease is stale';
  end if;

  if p_failure_class = 'permanent' or v_delivery.attempt_count >= 8 then
    update outbox.deliveries
    set delivery_state = 'dead_letter',
        lease_token = null,
        lease_expires_at = null,
        last_failure_class = case
          when p_failure_class = 'permanent' then 'permanent'
          else 'exhausted'
        end,
        last_error_code = p_error_code,
        last_failed_at = clock_timestamp(),
        dead_lettered_at = clock_timestamp()
    where delivery_id = v_delivery.delivery_id;

    return 'dead_letter';
  end if;

  v_backoff_seconds := least(
    900.0,
    (5.0 * power(2.0, v_delivery.attempt_count - 1))
      * (1.0 + random() * 0.25)
  );

  update outbox.deliveries
  set delivery_state = 'retry',
      lease_token = null,
      lease_expires_at = null,
      available_at = clock_timestamp()
        + pg_catalog.make_interval(secs => v_backoff_seconds),
      last_failure_class = 'transient',
      last_error_code = p_error_code,
      last_failed_at = clock_timestamp()
  where delivery_id = v_delivery.delivery_id;

  return 'retry';
end
$function$;

alter function outbox.fail_phase0_probe_delivery_impl(uuid, uuid, text, text)
  owner to pando_outbox_worker;
revoke all on function outbox.fail_phase0_probe_delivery_impl(uuid, uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function outbox.fail_phase0_probe_delivery_impl(uuid, uuid, text, text)
  to service_role;

create function api.claim_phase0_probe_deliveries()
returns table (
  delivery_id uuid,
  event_id uuid,
  event_position bigint,
  workspace_id uuid,
  lease_token uuid,
  lease_expires_at timestamptz,
  attempt_count smallint,
  event_name text,
  event_schema_version smallint,
  payload jsonb,
  metadata jsonb
)
language sql
security invoker
set search_path = ''
as $function$
  select * from outbox.claim_phase0_probe_deliveries_impl()
$function$;

create function api.complete_phase0_probe_delivery(
  p_delivery_id uuid,
  p_lease_token uuid,
  p_expected_event_position bigint
)
returns boolean
language sql
security invoker
set search_path = ''
as $function$
  select outbox.complete_phase0_probe_delivery_impl(
    p_delivery_id,
    p_lease_token,
    p_expected_event_position
  )
$function$;

create function api.fail_phase0_probe_delivery(
  p_delivery_id uuid,
  p_lease_token uuid,
  p_failure_class text,
  p_error_code text
)
returns text
language sql
security invoker
set search_path = ''
as $function$
  select outbox.fail_phase0_probe_delivery_impl(
    p_delivery_id,
    p_lease_token,
    p_failure_class,
    p_error_code
  )
$function$;

revoke all on function api.claim_phase0_probe_deliveries()
  from public, anon, authenticated, service_role;
revoke all on function api.complete_phase0_probe_delivery(uuid, uuid, bigint)
  from public, anon, authenticated, service_role;
revoke all on function api.fail_phase0_probe_delivery(uuid, uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function api.claim_phase0_probe_deliveries() to service_role;
grant execute on function api.complete_phase0_probe_delivery(uuid, uuid, bigint)
  to service_role;
grant execute on function api.fail_phase0_probe_delivery(uuid, uuid, text, text)
  to service_role;

revoke all on function outbox.reject_event_mutation()
  from public, anon, authenticated, service_role;
revoke all on function outbox.protect_completed_command_receipt()
  from public, anon, authenticated, service_role;
revoke all on function outbox.reject_consumer_receipt_mutation()
  from public, anon, authenticated, service_role;

revoke create on schema identity from pando_rls_authorizer, pando_identity_api;
revoke create on schema outbox from pando_outbox_worker;

do $migration_role_membership$
begin
  execute pg_catalog.format(
    'revoke pando_rls_authorizer, pando_identity_api, pando_outbox_worker from %I',
    current_user
  );
end
$migration_role_membership$;
