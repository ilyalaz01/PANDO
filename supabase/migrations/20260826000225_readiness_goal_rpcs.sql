do $migration_role_membership$
begin
  execute pg_catalog.format('grant pando_phase1_api to %I', current_user);
end
$migration_role_membership$;

grant select, insert on targets.readiness_goals to pando_phase1_api;
grant create on schema targets to pando_phase1_api;
create policy readiness_goals_phase1_select on targets.readiness_goals
for select to pando_phase1_api
using (identity.is_workspace_member(workspace_id));
create policy readiness_goals_phase1_insert on targets.readiness_goals
for insert to pando_phase1_api
with check (identity.is_workspace_member(workspace_id));

create function targets.create_readiness_goal_impl(
  p_workspace_id uuid,
  p_readiness_goal_key text,
  p_title text,
  p_profile_version_key text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_user_id uuid;
  v_profile_version_id uuid;
  v_goal_id uuid := gen_random_uuid();
  v_command_id uuid := gen_random_uuid();
  v_correlation_id uuid := gen_random_uuid();
  v_event_id uuid := gen_random_uuid();
  v_request_hash bytea;
  v_response jsonb;
  v_receipt outbox.command_receipts%rowtype;
begin
  if identity.jwt_subject() is null then
    raise exception using errcode = '28000', message = 'an authenticated user is required';
  end if;
  if not identity.is_workspace_member(p_workspace_id) then
    raise exception using errcode = '42501', message = 'workspace is not accessible';
  end if;
  v_actor_user_id := identity.current_user_id();
  if v_actor_user_id is null then
    raise exception using errcode = '28000', message = 'authenticated user is not provisioned';
  end if;
  if p_idempotency_key is null or p_idempotency_key <> btrim(p_idempotency_key)
     or char_length(p_idempotency_key) not between 1 and 128 then
    raise exception using errcode = '22023', message = 'idempotency key must contain 1 to 128 trimmed characters';
  end if;
  if p_readiness_goal_key is null
     or p_readiness_goal_key !~ '^goal:[a-z0-9][a-z0-9-]{1,100}$' then
    raise exception using errcode = '22023', message = 'readiness goal key is invalid';
  end if;
  if p_title is null or p_title <> btrim(p_title)
     or char_length(p_title) not between 1 and 200 then
    raise exception using errcode = '22023', message = 'readiness goal title is invalid';
  end if;
  if p_profile_version_key is null
     or p_profile_version_key !~ '^target:[a-z0-9][a-z0-9-]{1,100}$' then
    raise exception using errcode = '22023', message = 'target profile key is invalid';
  end if;

  v_request_hash := extensions.digest(
    pg_catalog.convert_to(
      pg_catalog.jsonb_build_object(
        'commandType', 'targets.create_readiness_goal',
        'schemaVersion', 1,
        'workspaceId', p_workspace_id,
        'readinessGoalKey', p_readiness_goal_key,
        'title', p_title,
        'profileVersionKey', p_profile_version_key
      )::text,
      'UTF8'
    ),
    'sha256'
  );
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    v_actor_user_id::text || ':targets.create_readiness_goal:' || p_idempotency_key, 0
  ));
  select receipt.* into v_receipt
  from outbox.command_receipts as receipt
  where receipt.actor_user_id = v_actor_user_id
    and receipt.command_type = 'targets.create_readiness_goal'
    and receipt.idempotency_key = p_idempotency_key
  for update;
  if found then
    if v_receipt.request_hash <> v_request_hash then
      raise exception using errcode = '22023', message = 'idempotency key reused with a different request';
    end if;
    if v_receipt.command_status <> 'completed' then
      raise exception using errcode = '40001', message = 'command receipt is not complete';
    end if;
    return v_receipt.response;
  end if;

  select version.profile_version_id into v_profile_version_id
  from targets.target_profile_versions as version
  join targets.target_profile_series as series
    on series.profile_series_id = version.profile_series_id
  where version.profile_version_key = p_profile_version_key
    and version.lifecycle = 'published'
    and series.lifecycle = 'active'
    and (version.workspace_id is null or version.workspace_id = p_workspace_id);
  if v_profile_version_id is null then
    raise exception using errcode = '42501', message = 'target profile is not accessible';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_workspace_id::text || ':' || p_readiness_goal_key, 2)
  );
  if exists (
    select 1 from targets.readiness_goals as goal
    where goal.workspace_id = p_workspace_id
      and goal.readiness_goal_key = p_readiness_goal_key
  ) then
    raise exception using errcode = '23505', message = 'readiness goal already exists';
  end if;

  insert into outbox.command_receipts (
    command_id, command_type, command_schema_version, workspace_id, actor_user_id,
    idempotency_key, request_hash, correlation_id, expected_aggregate_version
  ) values (
    v_command_id, 'targets.create_readiness_goal', 1, p_workspace_id,
    v_actor_user_id, p_idempotency_key, v_request_hash, v_correlation_id, 0
  );
  insert into targets.readiness_goals (
    readiness_goal_id, workspace_id, readiness_goal_key, title, profile_version_id
  ) values (
    v_goal_id, p_workspace_id, p_readiness_goal_key, p_title, v_profile_version_id
  );
  insert into outbox.events (
    event_id, event_name, event_schema_version, workspace_id, aggregate_type,
    aggregate_id, aggregate_version, actor_type, actor_user_id, command_id,
    correlation_id, occurred_at, source, payload
  ) values (
    v_event_id, 'targets.readiness_goal_created', 1, p_workspace_id,
    'targets.readiness_goal', v_goal_id, 1, 'user', v_actor_user_id,
    v_command_id, v_correlation_id, clock_timestamp(), 'pando.database',
    pg_catalog.jsonb_build_object(
      'readiness_goal_id', v_goal_id,
      'readiness_goal_key', p_readiness_goal_key,
      'profile_version_id', v_profile_version_id,
      'profile_version_key', p_profile_version_key
    )
  );
  v_response := pg_catalog.jsonb_build_object(
    'commandId', v_command_id,
    'workspaceId', p_workspace_id,
    'readinessGoalId', v_goal_id,
    'readinessGoalKey', p_readiness_goal_key,
    'profileVersionKey', p_profile_version_key,
    'aggregateVersion', 1,
    'emittedEventIds', pg_catalog.jsonb_build_array(v_event_id)
  );
  update outbox.command_receipts
  set command_status = 'completed', response = v_response,
      emitted_event_ids = array[v_event_id], completed_at = clock_timestamp()
  where command_id = v_command_id;
  return v_response;
end
$function$;

alter function targets.create_readiness_goal_impl(uuid, text, text, text, text)
  owner to pando_phase1_api;
revoke all on function targets.create_readiness_goal_impl(uuid, text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function targets.create_readiness_goal_impl(uuid, text, text, text, text)
  to authenticated;

create function targets.get_readiness_goal_impl(p_workspace_id uuid, p_readiness_goal_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_goal targets.readiness_goals%rowtype;
begin
  if identity.jwt_subject() is null then
    raise exception using errcode = '28000', message = 'an authenticated user is required';
  end if;
  if not identity.is_workspace_member(p_workspace_id) then
    raise exception using errcode = '42501', message = 'workspace is not accessible';
  end if;
  select goal.* into v_goal from targets.readiness_goals as goal
  where goal.workspace_id = p_workspace_id
    and goal.readiness_goal_key = p_readiness_goal_key;
  if not found then
    raise exception using errcode = '42501', message = 'readiness goal is not accessible';
  end if;
  return pg_catalog.jsonb_build_object(
    'readinessGoalId', v_goal.readiness_goal_id,
    'workspaceId', v_goal.workspace_id,
    'readinessGoalKey', v_goal.readiness_goal_key,
    'title', v_goal.title,
    'profileVersionKey', (
      select profile.profile_version_key
      from targets.target_profile_versions as profile
      where profile.profile_version_id = v_goal.profile_version_id
    ),
    'lifecycle', v_goal.lifecycle,
    'aggregateVersion', v_goal.aggregate_version
  );
end
$function$;

alter function targets.get_readiness_goal_impl(uuid, text) owner to pando_phase1_api;
revoke all on function targets.get_readiness_goal_impl(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function targets.get_readiness_goal_impl(uuid, text) to authenticated;

create function api.create_readiness_goal(
  p_workspace_id uuid,
  p_readiness_goal_key text,
  p_title text,
  p_profile_version_key text,
  p_idempotency_key text
)
returns jsonb language sql security invoker set search_path = ''
as $function$
  select targets.create_readiness_goal_impl(
    p_workspace_id, p_readiness_goal_key, p_title,
    p_profile_version_key, p_idempotency_key
  )
$function$;
create function api.get_readiness_goal(p_workspace_id uuid, p_readiness_goal_key text)
returns jsonb language sql stable security invoker set search_path = ''
as $function$
  select targets.get_readiness_goal_impl(p_workspace_id, p_readiness_goal_key)
$function$;

revoke all on function api.create_readiness_goal(uuid, text, text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function api.get_readiness_goal(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function api.create_readiness_goal(uuid, text, text, text, text)
  to authenticated;
grant execute on function api.get_readiness_goal(uuid, text) to authenticated;

revoke create on schema targets from pando_phase1_api;

do $migration_role_membership$
begin
  execute pg_catalog.format('revoke pando_phase1_api from %I', current_user);
end
$migration_role_membership$;
