do $migration_role_membership$
begin
  execute pg_catalog.format('grant pando_phase1_api to %I', current_user);
end
$migration_role_membership$;

grant delete on overlay.positions to pando_phase1_api;
grant create on schema overlay to pando_phase1_api;

create function overlay.reset_position_impl(
  p_workspace_id uuid,
  p_readiness_goal_key text,
  p_node_ref text,
  p_expected_overlay_version bigint,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_user_id uuid;
  v_readiness_goal_id uuid;
  v_profile_version_id uuid;
  v_profile_version_key text;
  v_position_id uuid;
  v_command_id uuid := gen_random_uuid();
  v_correlation_id uuid := gen_random_uuid();
  v_event_id uuid;
  v_request_hash bytea;
  v_response jsonb;
  v_receipt outbox.command_receipts%rowtype;
  v_current_version bigint;
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
  if p_expected_overlay_version is null or p_expected_overlay_version < 0 then
    raise exception using errcode = '22023', message = 'expected overlay version must be nonnegative';
  end if;
  if p_node_ref is null
     or p_node_ref !~ '^(domain|competency):[a-z0-9][a-z0-9-]{1,100}$' then
    raise exception using errcode = '22023', message = 'position node reference is invalid';
  end if;

  v_request_hash := extensions.digest(
    pg_catalog.convert_to(
      pg_catalog.jsonb_build_object(
        'commandType', 'overlay.reset_position',
        'schemaVersion', 1,
        'workspaceId', p_workspace_id,
        'readinessGoalKey', p_readiness_goal_key,
        'nodeRef', p_node_ref,
        'expectedOverlayVersion', p_expected_overlay_version
      )::text,
      'UTF8'
    ),
    'sha256'
  );

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    v_actor_user_id::text || ':overlay.reset_position:' || p_idempotency_key, 0
  ));
  select receipt.* into v_receipt
  from outbox.command_receipts as receipt
  where receipt.actor_user_id = v_actor_user_id
    and receipt.command_type = 'overlay.reset_position'
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

  select goal.readiness_goal_id, version.profile_version_id, version.profile_version_key
  into v_readiness_goal_id, v_profile_version_id, v_profile_version_key
  from targets.readiness_goals as goal
  join targets.target_profile_versions as version
    on version.profile_version_id = goal.profile_version_id
  where goal.workspace_id = p_workspace_id
    and goal.readiness_goal_key = p_readiness_goal_key
    and version.lifecycle in ('published', 'retired');
  if v_readiness_goal_id is null then
    raise exception using errcode = '42501', message = 'readiness goal is not accessible';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_workspace_id::text, 1));
  insert into overlay.workspace_overlays (workspace_id)
  values (p_workspace_id)
  on conflict do nothing;
  select root.aggregate_version into strict v_current_version
  from overlay.workspace_overlays as root
  where root.workspace_id = p_workspace_id
  for update;
  if v_current_version <> p_expected_overlay_version then
    raise exception using errcode = '40001', message = 'overlay aggregate version conflict';
  end if;

  insert into outbox.command_receipts (
    command_id, command_type, command_schema_version, workspace_id, actor_user_id,
    idempotency_key, request_hash, correlation_id, expected_aggregate_version
  ) values (
    v_command_id, 'overlay.reset_position', 1, p_workspace_id, v_actor_user_id,
    p_idempotency_key, v_request_hash, v_correlation_id, p_expected_overlay_version
  );

  select position.position_id into v_position_id
  from overlay.positions as position
  where position.workspace_id = p_workspace_id
    and position.readiness_goal_id = v_readiness_goal_id
    and position.profile_version_id = v_profile_version_id
    and position.node_ref = p_node_ref
  for update;

  if v_position_id is not null then
    delete from overlay.positions where position_id = v_position_id;
    update overlay.workspace_overlays
    set aggregate_version = aggregate_version + 1, updated_at = clock_timestamp()
    where workspace_id = p_workspace_id;
    v_event_id := gen_random_uuid();
    insert into outbox.events (
      event_id, event_name, event_schema_version, workspace_id, aggregate_type,
      aggregate_id, aggregate_version, actor_type, actor_user_id, command_id,
      correlation_id, occurred_at, source, payload
    ) values (
      v_event_id, 'overlay.position_reset', 1, p_workspace_id, 'overlay.workspace',
      p_workspace_id, p_expected_overlay_version + 1, 'user', v_actor_user_id,
      v_command_id, v_correlation_id, clock_timestamp(), 'pando.database',
      pg_catalog.jsonb_build_object(
        'position_id', v_position_id,
        'readiness_goal_key', p_readiness_goal_key,
        'profile_version_key', v_profile_version_key,
        'node_ref', p_node_ref
      )
    );
  end if;

  v_response := pg_catalog.jsonb_build_object(
    'commandId', v_command_id,
    'workspaceId', p_workspace_id,
    'readinessGoalKey', p_readiness_goal_key,
    'profileVersionKey', v_profile_version_key,
    'nodeRef', p_node_ref,
    'operation', case when v_event_id is null then 'already_canonical' else 'reset' end,
    'overlayVersion', p_expected_overlay_version + case when v_event_id is null then 0 else 1 end,
    'emittedEventIds', case when v_event_id is null then '[]'::jsonb
      else pg_catalog.jsonb_build_array(v_event_id) end
  );
  update outbox.command_receipts
  set command_status = 'completed', response = v_response,
      emitted_event_ids = case when v_event_id is null then '{}'::uuid[] else array[v_event_id] end,
      completed_at = clock_timestamp()
  where command_id = v_command_id;
  return v_response;
end
$function$;

alter function overlay.reset_position_impl(uuid, text, text, bigint, text)
  owner to pando_phase1_api;
revoke all on function overlay.reset_position_impl(uuid, text, text, bigint, text)
  from public, anon, authenticated, service_role;
grant execute on function overlay.reset_position_impl(uuid, text, text, bigint, text)
  to authenticated;

create function api.reset_overlay_position(
  p_workspace_id uuid,
  p_readiness_goal_key text,
  p_node_ref text,
  p_expected_overlay_version bigint,
  p_idempotency_key text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $function$
  select overlay.reset_position_impl(
    p_workspace_id,
    p_readiness_goal_key,
    p_node_ref,
    p_expected_overlay_version,
    p_idempotency_key
  )
$function$;

revoke all on function api.reset_overlay_position(uuid, text, text, bigint, text)
  from public, anon, authenticated, service_role;
grant execute on function api.reset_overlay_position(uuid, text, text, bigint, text)
  to authenticated;

revoke create on schema overlay from pando_phase1_api;

do $migration_role_membership$
begin
  execute pg_catalog.format('revoke pando_phase1_api from %I', current_user);
end
$migration_role_membership$;
