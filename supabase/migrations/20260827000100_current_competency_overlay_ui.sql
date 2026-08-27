-- Phase 1 competency inspector overlay boundary.
--
-- Public callers choose only an authorized readiness goal and competency. Identity and Targets
-- derive the current personal workspace and immutable profile before User Overlay reads or writes.

do $migration_role_membership$
begin
  if not pg_catalog.pg_has_role(current_user, 'pando_phase1_api', 'SET') then
    if exists (
      select 1
      from pg_catalog.pg_auth_members as membership
      where membership.roleid = 'pando_phase1_api'::pg_catalog.regrole
        and membership.member = current_user::pg_catalog.regrole
    ) then
      perform pg_catalog.set_config('pando.migration_overlay_api_restore', 'set_false', false);
    else
      perform pg_catalog.set_config('pando.migration_overlay_api_restore', 'revoke', false);
    end if;
    execute pg_catalog.format('grant pando_phase1_api to %I with set true', current_user);
  else
    perform pg_catalog.set_config('pando.migration_overlay_api_restore', 'none', false);
  end if;
end
$migration_role_membership$;

grant usage, create on schema api to pando_phase1_api;
grant create on schema overlay to pando_phase1_api;
grant execute on function api.get_explore_target_context_v1(text),
  identity.get_current_personal_workspace_impl()
  to pando_phase1_api;

create function overlay.get_competency_overlay_detail_impl(
  p_workspace_id uuid,
  p_profile_version_id uuid,
  p_competency_ref text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_overlay_version bigint;
  v_note jsonb;
  v_activities jsonb;
begin
  if identity.jwt_subject() is null then
    raise exception using errcode = '28000', message = 'an authenticated user is required';
  end if;
  if not identity.is_workspace_member(p_workspace_id) then
    raise exception using errcode = '42501', message = 'workspace is not accessible';
  end if;
  if p_competency_ref is null
     or p_competency_ref !~ '^competency:[a-z0-9][a-z0-9-]{1,100}$' then
    raise exception using errcode = '22023', message = 'competency reference is invalid';
  end if;

  select coalesce(root.aggregate_version, 0)
  into v_overlay_version
  from (select 1) as singleton
  left join overlay.workspace_overlays as root
    on root.workspace_id = p_workspace_id;

  select pg_catalog.jsonb_build_object(
    'body', note.note_body,
    'updatedAt', note.updated_at
  )
  into v_note
  from overlay.notes as note
  where note.workspace_id = p_workspace_id
    and note.subject_ref = p_competency_ref;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'activityKey', activity.activity_key,
        'title', activity.title,
        'activityType', activity.activity_type,
        'lifecycle', activity.lifecycle,
        'createdAt', activity.created_at
      )
      order by activity.activity_key collate "C"
    ),
    '[]'::jsonb
  )
  into v_activities
  from overlay.custom_activities as activity
  where activity.workspace_id = p_workspace_id
    and activity.profile_version_id = p_profile_version_id
    and activity.target_competency_ref = p_competency_ref
    and activity.lifecycle = 'active';

  return pg_catalog.jsonb_build_object(
    'contract', pg_catalog.jsonb_build_object(
      'name', 'CompetencyOverlayDetailV1',
      'version', '1.0.0'
    ),
    'competencyRef', p_competency_ref,
    'overlayVersion', v_overlay_version::text,
    'note', v_note,
    'customActivities', v_activities
  );
end
$function$;

alter function overlay.get_competency_overlay_detail_impl(uuid, uuid, text)
  owner to pando_phase1_api;
revoke all on function overlay.get_competency_overlay_detail_impl(uuid, uuid, text)
  from public, anon, authenticated, service_role;

-- The current-session API resolves Targets-owned identity before entering this Overlay-owned
-- command. This implementation therefore touches only Overlay and shared outbox tables.
create function overlay.add_current_custom_activity_impl(
  p_workspace_id uuid,
  p_profile_version_id uuid,
  p_profile_version_key text,
  p_activity_key text,
  p_title text,
  p_activity_type text,
  p_target_competency_ref text,
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
  v_command_id uuid := gen_random_uuid();
  v_correlation_id uuid := gen_random_uuid();
  v_event_id uuid := gen_random_uuid();
  v_activity_id uuid := gen_random_uuid();
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
  if p_profile_version_id is null
     or p_profile_version_key is null
     or p_profile_version_key !~ '^target:[a-z0-9][a-z0-9-]{1,100}$' then
    raise exception using errcode = '22023', message = 'target profile identity is invalid';
  end if;
  if p_idempotency_key is null
     or p_idempotency_key <> btrim(p_idempotency_key)
     or char_length(p_idempotency_key) not between 1 and 128 then
    raise exception using errcode = '22023', message = 'idempotency key must contain 1 to 128 trimmed characters';
  end if;
  if p_expected_overlay_version is null or p_expected_overlay_version < 0 then
    raise exception using errcode = '22023', message = 'expected overlay version must be nonnegative';
  end if;
  if p_activity_key is null or p_activity_key !~ '^activity:[a-z0-9][a-z0-9-]{1,100}$' then
    raise exception using errcode = '22023', message = 'activity key is invalid';
  end if;
  if p_title is null or p_title <> btrim(p_title) or char_length(p_title) not between 1 and 200 then
    raise exception using errcode = '22023', message = 'activity title is invalid';
  end if;
  if p_activity_type is null
     or p_activity_type not in ('MANUAL_CODING', 'READING', 'EXPLANATION', 'MOCK', 'PROJECT') then
    raise exception using errcode = '22023', message = 'activity type is invalid';
  end if;
  if p_target_competency_ref is null
     or p_target_competency_ref !~ '^competency:[a-z0-9][a-z0-9-]{1,100}$' then
    raise exception using errcode = '22023', message = 'target competency reference is invalid';
  end if;

  v_request_hash := extensions.digest(pg_catalog.convert_to(pg_catalog.jsonb_build_object(
    'commandType', 'overlay.add_custom_activity',
    'schemaVersion', 1,
    'workspaceId', p_workspace_id,
    'profileVersionKey', p_profile_version_key,
    'activityKey', p_activity_key,
    'title', p_title,
    'activityType', p_activity_type,
    'targetCompetencyRef', p_target_competency_ref,
    'expectedOverlayVersion', p_expected_overlay_version
  )::text, 'UTF8'), 'sha256');

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    v_actor_user_id::text || ':overlay.add_custom_activity:' || p_idempotency_key, 0
  ));
  select receipt.*
  into v_receipt
  from outbox.command_receipts as receipt
  where receipt.actor_user_id = v_actor_user_id
    and receipt.command_type = 'overlay.add_custom_activity'
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

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_workspace_id::text, 1));
  insert into overlay.workspace_overlays (workspace_id)
  values (p_workspace_id)
  on conflict do nothing;
  select root.aggregate_version
  into strict v_current_version
  from overlay.workspace_overlays as root
  where root.workspace_id = p_workspace_id
  for update;
  if v_current_version <> p_expected_overlay_version then
    raise exception using errcode = '40001', message = 'overlay aggregate version conflict';
  end if;
  if exists (
    select 1
    from overlay.custom_activities as activity
    where activity.workspace_id = p_workspace_id
      and activity.activity_key = p_activity_key
  ) then
    raise exception using errcode = '23505', message = 'custom activity already exists';
  end if;

  insert into outbox.command_receipts (
    command_id, command_type, command_schema_version, workspace_id, actor_user_id,
    idempotency_key, request_hash, correlation_id, expected_aggregate_version
  ) values (
    v_command_id, 'overlay.add_custom_activity', 1, p_workspace_id, v_actor_user_id,
    p_idempotency_key, v_request_hash, v_correlation_id, p_expected_overlay_version
  );
  insert into overlay.custom_activities (
    custom_activity_id, workspace_id, profile_version_id, activity_key, title,
    activity_type, target_competency_ref
  ) values (
    v_activity_id, p_workspace_id, p_profile_version_id, p_activity_key, p_title,
    p_activity_type, p_target_competency_ref
  );
  update overlay.workspace_overlays
  set aggregate_version = aggregate_version + 1,
      updated_at = clock_timestamp()
  where workspace_id = p_workspace_id;
  insert into outbox.events (
    event_id, event_name, event_schema_version, workspace_id, aggregate_type, aggregate_id,
    aggregate_version, actor_type, actor_user_id, command_id, correlation_id, occurred_at,
    source, payload
  ) values (
    v_event_id, 'overlay.custom_activity_added', 1, p_workspace_id, 'overlay.workspace',
    p_workspace_id, p_expected_overlay_version + 1, 'user', v_actor_user_id, v_command_id,
    v_correlation_id, clock_timestamp(), 'pando.database', pg_catalog.jsonb_build_object(
      'custom_activity_id', v_activity_id,
      'activity_key', p_activity_key,
      'profile_version_key', p_profile_version_key,
      'target_competency_ref', p_target_competency_ref
    )
  );
  v_response := pg_catalog.jsonb_build_object(
    'commandId', v_command_id,
    'workspaceId', p_workspace_id,
    'customActivityId', v_activity_id,
    'activityKey', p_activity_key,
    'profileVersionKey', p_profile_version_key,
    'overlayVersion', p_expected_overlay_version + 1,
    'emittedEventIds', pg_catalog.jsonb_build_array(v_event_id)
  );
  update outbox.command_receipts
  set command_status = 'completed',
      response = v_response,
      emitted_event_ids = array[v_event_id],
      completed_at = clock_timestamp()
  where command_id = v_command_id;
  return v_response;
end
$function$;

alter function overlay.add_current_custom_activity_impl(uuid, uuid, text, text, text, text, text, bigint, text)
  owner to pando_phase1_api;
revoke all on function overlay.add_current_custom_activity_impl(uuid, uuid, text, text, text, text, text, bigint, text)
  from public, anon, authenticated, service_role;

create function api.get_current_competency_overlay_v1(
  p_readiness_goal_key text,
  p_competency_ref text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_context jsonb;
  v_detail jsonb;
begin
  v_context := api.get_explore_target_context_v1(p_readiness_goal_key);
  if not exists (
    select 1
    from (
      select node.value
      from pg_catalog.jsonb_array_elements(
        v_context->'scope'->'canonicalNodes'
      ) as node(value)
      union all
      select node.value
      from pg_catalog.jsonb_array_elements(
        v_context->'scope'->'requiredOverlayNodes'
      ) as node(value)
    ) as allowed
    where allowed.value->>'nodeRef' = p_competency_ref
      and allowed.value->>'nodeType' = 'COMPETENCY'
  ) then
    raise exception using errcode = '42501', message = 'competency is not accessible';
  end if;

  v_detail := overlay.get_competency_overlay_detail_impl(
    (v_context->>'workspaceId')::uuid,
    (v_context->'targetProfile'->>'profileVersionId')::uuid,
    p_competency_ref
  );
  return v_detail || pg_catalog.jsonb_build_object(
    'readinessGoalKey', v_context->'readinessGoal'->'readinessGoalKey'
  );
end
$function$;

create function api.save_current_overlay_note_v1(
  p_readiness_goal_key text,
  p_competency_ref text,
  p_note_body text,
  p_expected_overlay_version text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context jsonb;
  v_response jsonb;
begin
  if p_expected_overlay_version is null
     or p_expected_overlay_version !~ '^(0|[1-9][0-9]{0,18})$' then
    raise exception using errcode = '22023', message = 'expected overlay version is invalid';
  end if;

  v_context := api.get_explore_target_context_v1(p_readiness_goal_key);
  if not exists (
    select 1
    from (
      select node.value
      from pg_catalog.jsonb_array_elements(v_context->'scope'->'canonicalNodes') as node(value)
      union all
      select node.value
      from pg_catalog.jsonb_array_elements(v_context->'scope'->'requiredOverlayNodes') as node(value)
    ) as allowed
    where allowed.value->>'nodeRef' = p_competency_ref
      and allowed.value->>'nodeType' = 'COMPETENCY'
  ) then
    raise exception using errcode = '42501', message = 'competency is not accessible';
  end if;
  v_response := overlay.save_note_impl(
    (v_context->>'workspaceId')::uuid,
    p_competency_ref,
    p_note_body,
    p_expected_overlay_version::bigint,
    p_idempotency_key
  );

  return pg_catalog.jsonb_build_object(
    'commandId', v_response->'commandId',
    'competencyRef', v_response->'subjectRef',
    'operation', v_response->'operation',
    'overlayVersion', v_response->>'overlayVersion',
    'emittedEventIds', v_response->'emittedEventIds'
  );
end
$function$;

create function api.add_current_custom_activity_v1(
  p_readiness_goal_key text,
  p_activity_key text,
  p_title text,
  p_activity_type text,
  p_target_competency_ref text,
  p_expected_overlay_version text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context jsonb;
  v_response jsonb;
begin
  if p_expected_overlay_version is null
     or p_expected_overlay_version !~ '^(0|[1-9][0-9]{0,18})$' then
    raise exception using errcode = '22023', message = 'expected overlay version is invalid';
  end if;

  v_context := api.get_explore_target_context_v1(p_readiness_goal_key);
  if not exists (
    select 1
    from (
      select node.value
      from pg_catalog.jsonb_array_elements(v_context->'scope'->'canonicalNodes') as node(value)
      union all
      select node.value
      from pg_catalog.jsonb_array_elements(v_context->'scope'->'requiredOverlayNodes') as node(value)
    ) as allowed
    where allowed.value->>'nodeRef' = p_target_competency_ref
      and allowed.value->>'nodeType' = 'COMPETENCY'
  ) then
    raise exception using errcode = '42501', message = 'competency is not accessible';
  end if;
  v_response := overlay.add_current_custom_activity_impl(
    (v_context->>'workspaceId')::uuid,
    (v_context->'targetProfile'->>'profileVersionId')::uuid,
    v_context->'targetProfile'->>'profileVersionKey',
    p_activity_key,
    p_title,
    p_activity_type,
    p_target_competency_ref,
    p_expected_overlay_version::bigint,
    p_idempotency_key
  );

  return pg_catalog.jsonb_build_object(
    'commandId', v_response->'commandId',
    'activityKey', v_response->'activityKey',
    'targetCompetencyRef', p_target_competency_ref,
    'overlayVersion', v_response->>'overlayVersion',
    'emittedEventIds', v_response->'emittedEventIds'
  );
end
$function$;

alter function api.get_current_competency_overlay_v1(text, text)
  owner to pando_phase1_api;
alter function api.save_current_overlay_note_v1(text, text, text, text, text)
  owner to pando_phase1_api;
alter function api.add_current_custom_activity_v1(text, text, text, text, text, text, text)
  owner to pando_phase1_api;

revoke all on function api.get_current_competency_overlay_v1(text, text),
  api.save_current_overlay_note_v1(text, text, text, text, text),
  api.add_current_custom_activity_v1(text, text, text, text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function api.get_current_competency_overlay_v1(text, text),
  api.save_current_overlay_note_v1(text, text, text, text, text),
  api.add_current_custom_activity_v1(text, text, text, text, text, text, text)
  to authenticated;

-- The scoped SECURITY DEFINER wrappers are the only authenticated path into these bridges.
-- Their NOLOGIN/NOBYPASSRLS owner still evaluates JWT-backed membership under FORCE RLS.
revoke execute on function overlay.get_competency_overlay_detail_impl(uuid, uuid, text),
  overlay.save_note_impl(uuid, text, text, bigint, text),
  overlay.add_current_custom_activity_impl(uuid, uuid, text, text, text, text, text, bigint, text)
  from authenticated;

-- Retire caller-selected workspace/profile transports now that the ordinary UI has a scoped path.
revoke all on function api.get_overlay_note(uuid, text),
  api.save_overlay_note(uuid, text, text, bigint, text),
  api.add_custom_activity(uuid, text, text, text, text, text, bigint, text)
  from public, anon, authenticated, service_role;
drop function api.get_overlay_note(uuid, text);
drop function api.save_overlay_note(uuid, text, text, bigint, text);
drop function api.add_custom_activity(uuid, text, text, text, text, text, bigint, text);

-- The old internal implementation resolved Targets and Catalog through private tables. It has no
-- public caller after the scoped API replacement and is removed to restore module topology.
revoke all on function overlay.add_custom_activity_impl(uuid, text, text, text, text, text, bigint, text)
  from public, anon, authenticated, service_role;
drop function overlay.add_custom_activity_impl(uuid, text, text, text, text, text, bigint, text);

revoke create on schema api, overlay from pando_phase1_api;

do $migration_role_membership$
begin
  case pg_catalog.current_setting('pando.migration_overlay_api_restore', true)
    when 'revoke' then
      execute pg_catalog.format('revoke pando_phase1_api from %I', current_user);
    when 'set_false' then
      execute pg_catalog.format('grant pando_phase1_api to %I with set false', current_user);
    else
      null;
  end case;
end
$migration_role_membership$;
