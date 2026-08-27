-- Phase 2 authenticated command/query boundary. The public api schema never accepts a caller
-- selected workspace, user, evidence mapping, confidence, reliability, outbox consumer, or event.

do $migration_role_membership$
begin
  execute pg_catalog.format(
    'grant pando_phase1_api, pando_phase2_api to %I with set true',
    current_user
  );
end
$migration_role_membership$;

grant create on schema api, sessions, evidence to pando_phase2_api;
set role pando_phase1_api;
grant execute on function targets.get_explore_target_requirements_impl(uuid, text)
  to pando_phase2_api;
reset role;

create function sessions.start_focus_session_impl(
  p_focus_session_id uuid,
  p_workspace_id uuid,
  p_user_id uuid,
  p_readiness_goal_key text,
  p_activity "overlay".custom_activities,
  p_planned_minutes smallint,
  p_started_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not identity.is_workspace_member(p_workspace_id)
     or p_user_id is distinct from identity.current_user_id() then
    raise exception using errcode = '42501', message = 'workspace is not accessible';
  end if;
  if p_planned_minutes is null or p_planned_minutes not between 1 and 480 then
    raise exception using errcode = '22023', message = 'planned minutes must be between 1 and 480';
  end if;
  if exists (
    select 1 from sessions.focus_sessions as session
    where session.workspace_id = p_workspace_id and session.state = 'active'
  ) then
    raise exception using errcode = '40001', message = 'an active focus session already exists';
  end if;

  insert into sessions.focus_sessions (
    focus_session_id, workspace_id, user_id, readiness_goal_key, custom_activity_id,
    activity_key, activity_title, activity_type, target_competency_ref, planned_minutes, started_at
  ) values (
    p_focus_session_id, p_workspace_id, p_user_id, p_readiness_goal_key,
    p_activity.custom_activity_id, p_activity.activity_key, p_activity.title,
    p_activity.activity_type, p_activity.target_competency_ref, p_planned_minutes, p_started_at
  );
end
$function$;

create function evidence.start_activity_attempt_impl(
  p_activity_attempt_id uuid,
  p_focus_session_id uuid,
  p_workspace_id uuid,
  p_user_id uuid,
  p_activity "overlay".custom_activities,
  p_started_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not identity.is_workspace_member(p_workspace_id)
     or p_user_id is distinct from identity.current_user_id() then
    raise exception using errcode = '42501', message = 'workspace is not accessible';
  end if;
  insert into evidence.activity_attempts (
    activity_attempt_id, workspace_id, user_id, focus_session_id, custom_activity_id,
    activity_key, activity_title, activity_type, target_competency_ref, evidence_dimension,
    mapping_confidence, mapping_status, source_reliability, normalization_policy, started_at
  ) values (
    p_activity_attempt_id, p_workspace_id, p_user_id, p_focus_session_id,
    p_activity.custom_activity_id, p_activity.activity_key, p_activity.title,
    p_activity.activity_type, p_activity.target_competency_ref, p_activity.evidence_dimension,
    p_activity.mapping_confidence, p_activity.mapping_status, 0.600,
    'manual-activity-outcome/0.1', p_started_at
  );
end
$function$;

create function sessions.end_focus_session_impl(
  p_workspace_id uuid,
  p_user_id uuid,
  p_focus_session_id uuid,
  p_expected_version bigint,
  p_terminal_state text,
  p_ended_at timestamptz
)
returns sessions.focus_sessions
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_session sessions.focus_sessions%rowtype;
begin
  if not identity.is_workspace_member(p_workspace_id)
     or p_user_id is distinct from identity.current_user_id() then
    raise exception using errcode = '42501', message = 'workspace is not accessible';
  end if;
  if p_terminal_state not in ('completed', 'stopped') then
    raise exception using errcode = '22023', message = 'terminal session state is invalid';
  end if;
  select session.* into v_session
  from sessions.focus_sessions as session
  where session.workspace_id = p_workspace_id
    and session.focus_session_id = p_focus_session_id
    and session.user_id = p_user_id
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'focus session is not accessible';
  end if;
  if v_session.state <> 'active' or v_session.aggregate_version <> p_expected_version then
    raise exception using errcode = '40001', message = 'focus session version conflict';
  end if;

  update sessions.focus_sessions
  set state = p_terminal_state, aggregate_version = aggregate_version + 1, ended_at = p_ended_at
  where workspace_id = p_workspace_id and focus_session_id = p_focus_session_id
  returning * into v_session;
  return v_session;
end
$function$;

create function evidence.end_activity_attempt_impl(
  p_workspace_id uuid,
  p_user_id uuid,
  p_focus_session_id uuid,
  p_terminal_state text,
  p_result_kind text,
  p_used_hint boolean,
  p_ended_at timestamptz,
  p_evidence_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_attempt evidence.activity_attempts%rowtype;
  v_ledger_version bigint;
  v_outcome text;
  v_engagement text;
  v_target_relevant boolean;
begin
  if not identity.is_workspace_member(p_workspace_id)
     or p_user_id is distinct from identity.current_user_id() then
    raise exception using errcode = '42501', message = 'workspace is not accessible';
  end if;
  if p_terminal_state not in ('completed', 'stopped') then
    raise exception using errcode = '22023', message = 'terminal attempt state is invalid';
  end if;
  if (p_terminal_state = 'stopped' and (p_result_kind is not null or p_used_hint is not null))
     or (p_terminal_state = 'completed' and (
       p_result_kind not in ('OBSERVED_SUCCESS', 'OBSERVED_FAILURE', 'COMPLETION_ONLY')
       or p_used_hint is null
     )) then
    raise exception using errcode = '22023', message = 'attempt result is invalid';
  end if;

  select attempt.* into v_attempt
  from evidence.activity_attempts as attempt
  where attempt.workspace_id = p_workspace_id
    and attempt.focus_session_id = p_focus_session_id
    and attempt.user_id = p_user_id
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'activity attempt is not accessible';
  end if;
  if v_attempt.state <> 'in_progress' or v_attempt.aggregate_version <> 1 then
    raise exception using errcode = '40001', message = 'activity attempt version conflict';
  end if;

  update evidence.activity_attempts
  set state = p_terminal_state,
      result_kind = p_result_kind,
      used_hint = p_used_hint,
      aggregate_version = 2,
      ended_at = p_ended_at
  where workspace_id = p_workspace_id
    and activity_attempt_id = v_attempt.activity_attempt_id;

  if p_terminal_state = 'stopped' or p_result_kind = 'COMPLETION_ONLY' then
    return pg_catalog.jsonb_build_object(
      'attemptId', v_attempt.activity_attempt_id,
      'evidenceId', null,
      'competencyRef', v_attempt.target_competency_ref,
      'ledgerWatermark', null
    );
  end if;
  if p_evidence_id is null then
    raise exception using errcode = '22023', message = 'evidence identity is required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_workspace_id::text || ':evidence-ledger', 4
  ));
  insert into evidence.subject_ledgers (workspace_id) values (p_workspace_id)
  on conflict do nothing;
  select ledger.ledger_version into strict v_ledger_version
  from evidence.subject_ledgers as ledger
  where ledger.workspace_id = p_workspace_id;
  v_ledger_version := v_ledger_version + 1;
  update evidence.subject_ledgers
  set ledger_version = v_ledger_version, updated_at = p_ended_at
  where workspace_id = p_workspace_id;

  v_outcome := case p_result_kind
    when 'OBSERVED_SUCCESS' then 'SUCCESS'
    when 'OBSERVED_FAILURE' then 'FAILURE'
  end;
  v_engagement := case
    when v_attempt.activity_type = 'READING' then 'PASSIVE'
    when p_used_hint then 'GUIDED'
    else 'INDEPENDENT'
  end;
  v_target_relevant := v_attempt.activity_type in ('MANUAL_CODING', 'PROJECT', 'MOCK');

  insert into evidence.observations (
    evidence_id, workspace_id, user_id, activity_attempt_id, competency_ref, dimension,
    outcome, engagement, mapping_confidence, source_reliability, target_relevant, source_id,
    normalization_policy, ledger_version, occurred_at, recorded_at
  ) values (
    p_evidence_id, p_workspace_id, p_user_id, v_attempt.activity_attempt_id,
    v_attempt.target_competency_ref, v_attempt.evidence_dimension, v_outcome, v_engagement,
    v_attempt.mapping_confidence, v_attempt.source_reliability, v_target_relevant, 'manual.focus',
    v_attempt.normalization_policy, v_ledger_version, p_ended_at, p_ended_at
  );

  return pg_catalog.jsonb_build_object(
    'attemptId', v_attempt.activity_attempt_id,
    'evidenceId', p_evidence_id,
    'competencyRef', v_attempt.target_competency_ref,
    'dimension', v_attempt.evidence_dimension,
    'outcome', v_outcome,
    'engagement', v_engagement,
    'ledgerWatermark', v_ledger_version::text
  );
end
$function$;

create function evidence.invalidate_observation_impl(
  p_workspace_id uuid,
  p_actor_user_id uuid,
  p_evidence_id uuid,
  p_reason text,
  p_correction_id uuid,
  p_recorded_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_observation evidence.observations%rowtype;
  v_ledger_version bigint;
begin
  if not identity.is_workspace_member(p_workspace_id)
     or p_actor_user_id is distinct from identity.current_user_id() then
    raise exception using errcode = '42501', message = 'workspace is not accessible';
  end if;
  if p_reason is null or p_reason <> btrim(p_reason)
     or char_length(p_reason) not between 1 and 500 then
    raise exception using errcode = '22023', message = 'correction reason is invalid';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_workspace_id::text || ':evidence:' || p_evidence_id::text, 3
  ));
  select observation.* into v_observation
  from evidence.observations as observation
  where observation.workspace_id = p_workspace_id
    and observation.evidence_id = p_evidence_id;
  if not found then
    raise exception using errcode = '42501', message = 'evidence is not accessible';
  end if;
  if exists (
    select 1 from evidence.corrections as correction
    where correction.workspace_id = p_workspace_id
      and correction.evidence_id = p_evidence_id
  ) then
    raise exception using errcode = '40001', message = 'evidence is already invalidated';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_workspace_id::text || ':evidence-ledger', 4
  ));
  select ledger.ledger_version into strict v_ledger_version
  from evidence.subject_ledgers as ledger
  where ledger.workspace_id = p_workspace_id;
  v_ledger_version := v_ledger_version + 1;
  update evidence.subject_ledgers
  set ledger_version = v_ledger_version, updated_at = p_recorded_at
  where workspace_id = p_workspace_id;
  insert into evidence.corrections (
    correction_id, workspace_id, evidence_id, actor_user_id, correction_type,
    correction_revision, reason, ledger_version, recorded_at
  ) values (
    p_correction_id, p_workspace_id, p_evidence_id, p_actor_user_id, 'INVALIDATE',
    1, p_reason, v_ledger_version, p_recorded_at
  );
  return pg_catalog.jsonb_build_object(
    'correctionId', p_correction_id,
    'evidenceId', p_evidence_id,
    'competencyRef', v_observation.competency_ref,
    'ledgerWatermark', v_ledger_version::text
  );
end
$function$;

create function api.start_focus_activity_v1(
  p_readiness_goal_key text,
  p_activity_key text,
  p_planned_minutes smallint,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context jsonb;
  v_activity overlay.custom_activities%rowtype;
  v_workspace_id uuid;
  v_actor_user_id uuid;
  v_session_id uuid := gen_random_uuid();
  v_attempt_id uuid := gen_random_uuid();
  v_command_id uuid := gen_random_uuid();
  v_event_id uuid := gen_random_uuid();
  v_correlation_id uuid := gen_random_uuid();
  v_now timestamptz := clock_timestamp();
  v_request_hash bytea;
  v_receipt outbox.command_receipts%rowtype;
  v_response jsonb;
begin
  if identity.jwt_subject() is null then
    raise exception using errcode = '28000', message = 'an authenticated user is required';
  end if;
  if p_idempotency_key is null or p_idempotency_key <> btrim(p_idempotency_key)
     or char_length(p_idempotency_key) not between 1 and 128 then
    raise exception using errcode = '22023', message = 'idempotency key is invalid';
  end if;
  if p_activity_key is null or p_activity_key !~ '^activity:[a-z0-9][a-z0-9-]{1,100}$'
     or p_planned_minutes is null or p_planned_minutes not between 1 and 480 then
    raise exception using errcode = '22023', message = 'focus input is invalid';
  end if;

  v_workspace_id := identity.personal_workspace_id_for_current_user();
  if v_workspace_id is null then
    raise exception using errcode = '42501', message = 'workspace is not accessible';
  end if;
  v_context := targets.get_explore_target_requirements_impl(
    v_workspace_id, p_readiness_goal_key
  );
  v_actor_user_id := identity.current_user_id();
  if v_actor_user_id is null then
    raise exception using errcode = '28000', message = 'authenticated user is not provisioned';
  end if;
  select activity.* into v_activity
  from overlay.custom_activities as activity
  where activity.workspace_id = v_workspace_id
    and activity.profile_version_id = (v_context->'targetProfile'->>'profileVersionId')::uuid
    and activity.activity_key = p_activity_key
    and activity.lifecycle = 'active'
    and activity.mapping_status = 'accepted';
  if not found then
    raise exception using errcode = '42501', message = 'activity is not accessible';
  end if;

  v_request_hash := extensions.digest(pg_catalog.convert_to(pg_catalog.jsonb_build_object(
    'commandType', 'focus.start_activity', 'schemaVersion', 1,
    'workspaceId', v_workspace_id, 'readinessGoalKey', p_readiness_goal_key,
    'activityKey', p_activity_key, 'plannedMinutes', p_planned_minutes
  )::text, 'UTF8'), 'sha256');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    v_actor_user_id::text || ':focus.start_activity:' || p_idempotency_key, 0
  ));
  select receipt.* into v_receipt from outbox.command_receipts as receipt
  where receipt.actor_user_id = v_actor_user_id
    and receipt.command_type = 'focus.start_activity'
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

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_workspace_id::text, 2));
  insert into outbox.command_receipts (
    command_id, command_type, command_schema_version, workspace_id, actor_user_id,
    idempotency_key, request_hash, correlation_id, expected_aggregate_version
  ) values (
    v_command_id, 'focus.start_activity', 1, v_workspace_id, v_actor_user_id,
    p_idempotency_key, v_request_hash, v_correlation_id, 0
  );
  perform sessions.start_focus_session_impl(
    v_session_id, v_workspace_id, v_actor_user_id, p_readiness_goal_key,
    v_activity, p_planned_minutes, v_now
  );
  perform evidence.start_activity_attempt_impl(
    v_attempt_id, v_session_id, v_workspace_id, v_actor_user_id, v_activity, v_now
  );
  insert into outbox.events (
    event_id, event_name, event_schema_version, workspace_id, aggregate_type, aggregate_id,
    aggregate_version, actor_type, actor_user_id, command_id, correlation_id, occurred_at,
    source, payload
  ) values (
    v_event_id, 'sessions.focus_started', 1, v_workspace_id, 'sessions.focus_session',
    v_session_id, 1, 'user', v_actor_user_id, v_command_id, v_correlation_id, v_now,
    'pando.database', pg_catalog.jsonb_build_object(
      'focus_session_id', v_session_id, 'activity_attempt_id', v_attempt_id,
      'activity_key', v_activity.activity_key, 'readiness_goal_key', p_readiness_goal_key
    )
  );
  v_response := pg_catalog.jsonb_build_object(
    'commandId', v_command_id, 'focusSessionId', v_session_id,
    'activityAttemptId', v_attempt_id, 'sessionVersion', '1', 'state', 'active',
    'startedAt', v_now, 'emittedEventIds', pg_catalog.jsonb_build_array(v_event_id)
  );
  update outbox.command_receipts
  set command_status = 'completed', response = v_response, emitted_event_ids = array[v_event_id],
      completed_at = clock_timestamp()
  where command_id = v_command_id;
  return v_response;
end
$function$;

create function api.finish_focus_activity_v1(
  p_focus_session_id uuid,
  p_expected_version bigint,
  p_terminal_action text,
  p_result_kind text,
  p_used_hint boolean,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_workspace_id uuid;
  v_actor_user_id uuid;
  v_command_id uuid := gen_random_uuid();
  v_session_event_id uuid := gen_random_uuid();
  v_evidence_event_id uuid := gen_random_uuid();
  v_evidence_id uuid := gen_random_uuid();
  v_correlation_id uuid := gen_random_uuid();
  v_now timestamptz := clock_timestamp();
  v_request_hash bytea;
  v_receipt outbox.command_receipts%rowtype;
  v_session sessions.focus_sessions%rowtype;
  v_evidence_result jsonb;
  v_response jsonb;
  v_event_ids uuid[];
begin
  if identity.jwt_subject() is null then
    raise exception using errcode = '28000', message = 'an authenticated user is required';
  end if;
  v_workspace_id := identity.personal_workspace_id_for_current_user();
  v_actor_user_id := identity.current_user_id();
  if v_workspace_id is null or v_actor_user_id is null
     or not identity.is_workspace_member(v_workspace_id) then
    raise exception using errcode = '42501', message = 'workspace is not accessible';
  end if;
  if p_expected_version <> 1 or p_terminal_action not in ('COMPLETE', 'STOP')
     or (p_terminal_action = 'STOP' and (p_result_kind is not null or p_used_hint is not null))
     or (p_terminal_action = 'COMPLETE' and (
       p_result_kind not in ('OBSERVED_SUCCESS', 'OBSERVED_FAILURE', 'COMPLETION_ONLY')
       or p_used_hint is null
     )) then
    raise exception using errcode = '22023', message = 'focus completion input is invalid';
  end if;
  if p_idempotency_key is null or p_idempotency_key <> btrim(p_idempotency_key)
     or char_length(p_idempotency_key) not between 1 and 128 then
    raise exception using errcode = '22023', message = 'idempotency key is invalid';
  end if;

  v_request_hash := extensions.digest(pg_catalog.convert_to(pg_catalog.jsonb_build_object(
    'commandType', 'focus.finish_activity', 'schemaVersion', 1,
    'workspaceId', v_workspace_id, 'focusSessionId', p_focus_session_id,
    'expectedVersion', p_expected_version, 'terminalAction', p_terminal_action,
    'resultKind', p_result_kind, 'usedHint', p_used_hint
  )::text, 'UTF8'), 'sha256');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    v_actor_user_id::text || ':focus.finish_activity:' || p_idempotency_key, 0
  ));
  select receipt.* into v_receipt from outbox.command_receipts as receipt
  where receipt.actor_user_id = v_actor_user_id
    and receipt.command_type = 'focus.finish_activity'
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

  insert into outbox.command_receipts (
    command_id, command_type, command_schema_version, workspace_id, actor_user_id,
    idempotency_key, request_hash, correlation_id, expected_aggregate_version
  ) values (
    v_command_id, 'focus.finish_activity', 1, v_workspace_id, v_actor_user_id,
    p_idempotency_key, v_request_hash, v_correlation_id, p_expected_version
  );
  v_session := sessions.end_focus_session_impl(
    v_workspace_id, v_actor_user_id, p_focus_session_id, p_expected_version,
    case p_terminal_action when 'COMPLETE' then 'completed' else 'stopped' end, v_now
  );
  v_evidence_result := evidence.end_activity_attempt_impl(
    v_workspace_id, v_actor_user_id, p_focus_session_id,
    case p_terminal_action when 'COMPLETE' then 'completed' else 'stopped' end,
    p_result_kind, p_used_hint, v_now,
    case when p_result_kind in ('OBSERVED_SUCCESS', 'OBSERVED_FAILURE') then v_evidence_id end
  );

  insert into outbox.events (
    event_id, event_name, event_schema_version, workspace_id, aggregate_type, aggregate_id,
    aggregate_version, actor_type, actor_user_id, command_id, correlation_id, occurred_at,
    source, payload
  ) values (
    v_session_event_id,
    case p_terminal_action when 'COMPLETE' then 'sessions.focus_completed' else 'sessions.focus_stopped' end,
    1, v_workspace_id, 'sessions.focus_session', p_focus_session_id, 2, 'user',
    v_actor_user_id, v_command_id, v_correlation_id, v_now, 'pando.database',
    pg_catalog.jsonb_build_object(
      'focus_session_id', p_focus_session_id,
      'activity_attempt_id', v_evidence_result->'attemptId',
      'result_kind', p_result_kind
    )
  );
  v_event_ids := array[v_session_event_id];
  if v_evidence_result->>'evidenceId' is not null then
    insert into outbox.events (
      event_id, event_name, event_schema_version, workspace_id, aggregate_type, aggregate_id,
      aggregate_version, actor_type, actor_user_id, command_id, correlation_id, causation_id,
      occurred_at, source, payload
    ) values (
      v_evidence_event_id, 'evidence.observation_appended', 1, v_workspace_id,
      'evidence.subject_ledger', v_workspace_id,
      (v_evidence_result->>'ledgerWatermark')::bigint, 'user', v_actor_user_id,
      v_command_id, v_correlation_id, v_session_event_id, v_now, 'pando.database',
      pg_catalog.jsonb_build_object(
        'evidence_id', v_evidence_id,
        'competency_ref', v_evidence_result->>'competencyRef',
        'ledger_watermark', v_evidence_result->>'ledgerWatermark'
      )
    );
    insert into outbox.deliveries (
      event_id, workspace_id, consumer_name, handler_contract_version
    ) values (
      v_evidence_event_id, v_workspace_id, 'mastery.evidence_projection_v1', 1
    );
    v_event_ids := array[v_session_event_id, v_evidence_event_id];
  end if;

  v_response := pg_catalog.jsonb_build_object(
    'commandId', v_command_id, 'focusSessionId', p_focus_session_id,
    'sessionVersion', '2', 'state', v_session.state, 'endedAt', v_now,
    'activityAttemptId', v_evidence_result->'attemptId',
    'evidenceId', v_evidence_result->'evidenceId',
    'ledgerWatermark', v_evidence_result->'ledgerWatermark',
    'projectionState', case when v_evidence_result->>'evidenceId' is null then 'not_applicable' else 'pending' end,
    'emittedEventIds', pg_catalog.to_jsonb(v_event_ids)
  );
  update outbox.command_receipts
  set command_status = 'completed', response = v_response, emitted_event_ids = v_event_ids,
      completed_at = clock_timestamp()
  where command_id = v_command_id;
  return v_response;
end
$function$;

create function api.invalidate_evidence_v1(
  p_evidence_id uuid,
  p_reason text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_workspace_id uuid;
  v_actor_user_id uuid;
  v_command_id uuid := gen_random_uuid();
  v_event_id uuid := gen_random_uuid();
  v_correction_id uuid := gen_random_uuid();
  v_correlation_id uuid := gen_random_uuid();
  v_now timestamptz := clock_timestamp();
  v_request_hash bytea;
  v_receipt outbox.command_receipts%rowtype;
  v_result jsonb;
  v_response jsonb;
begin
  if identity.jwt_subject() is null then
    raise exception using errcode = '28000', message = 'an authenticated user is required';
  end if;
  v_workspace_id := identity.personal_workspace_id_for_current_user();
  v_actor_user_id := identity.current_user_id();
  if v_workspace_id is null or v_actor_user_id is null
     or not identity.is_workspace_member(v_workspace_id) then
    raise exception using errcode = '42501', message = 'workspace is not accessible';
  end if;
  if p_reason is null or p_reason <> btrim(p_reason)
     or char_length(p_reason) not between 1 and 500
     or p_idempotency_key is null or p_idempotency_key <> btrim(p_idempotency_key)
     or char_length(p_idempotency_key) not between 1 and 128 then
    raise exception using errcode = '22023', message = 'evidence correction input is invalid';
  end if;

  v_request_hash := extensions.digest(pg_catalog.convert_to(pg_catalog.jsonb_build_object(
    'commandType', 'evidence.invalidate', 'schemaVersion', 1,
    'workspaceId', v_workspace_id, 'evidenceId', p_evidence_id, 'reason', p_reason
  )::text, 'UTF8'), 'sha256');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    v_actor_user_id::text || ':evidence.invalidate:' || p_idempotency_key, 0
  ));
  select receipt.* into v_receipt from outbox.command_receipts as receipt
  where receipt.actor_user_id = v_actor_user_id
    and receipt.command_type = 'evidence.invalidate'
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

  insert into outbox.command_receipts (
    command_id, command_type, command_schema_version, workspace_id, actor_user_id,
    idempotency_key, request_hash, correlation_id
  ) values (
    v_command_id, 'evidence.invalidate', 1, v_workspace_id, v_actor_user_id,
    p_idempotency_key, v_request_hash, v_correlation_id
  );
  v_result := evidence.invalidate_observation_impl(
    v_workspace_id, v_actor_user_id, p_evidence_id, p_reason, v_correction_id, v_now
  );
  insert into outbox.events (
    event_id, event_name, event_schema_version, workspace_id, aggregate_type, aggregate_id,
    aggregate_version, actor_type, actor_user_id, command_id, correlation_id, occurred_at,
    source, payload
  ) values (
    v_event_id, 'evidence.observation_invalidated', 1, v_workspace_id,
    'evidence.subject_ledger', v_workspace_id, (v_result->>'ledgerWatermark')::bigint,
    'user', v_actor_user_id, v_command_id, v_correlation_id, v_now, 'pando.database',
    pg_catalog.jsonb_build_object(
      'correction_id', v_correction_id, 'evidence_id', p_evidence_id,
      'competency_ref', v_result->>'competencyRef',
      'ledger_watermark', v_result->>'ledgerWatermark'
    )
  );
  insert into outbox.deliveries (
    event_id, workspace_id, consumer_name, handler_contract_version
  ) values (v_event_id, v_workspace_id, 'mastery.evidence_projection_v1', 1);
  v_response := pg_catalog.jsonb_build_object(
    'commandId', v_command_id, 'correctionId', v_correction_id,
    'evidenceId', p_evidence_id, 'ledgerWatermark', v_result->>'ledgerWatermark',
    'projectionState', 'pending', 'emittedEventIds', pg_catalog.jsonb_build_array(v_event_id)
  );
  update outbox.command_receipts
  set command_status = 'completed', response = v_response, emitted_event_ids = array[v_event_id],
      completed_at = clock_timestamp()
  where command_id = v_command_id;
  return v_response;
end
$function$;

create function api.get_focus_workspace_v1(
  p_readiness_goal_key text,
  p_activity_key text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_context jsonb;
  v_workspace_id uuid;
  v_profile_version_id uuid;
  v_activity overlay.custom_activities%rowtype;
  v_active sessions.focus_sessions%rowtype;
  v_activity_json jsonb;
  v_active_json jsonb;
  v_history jsonb;
  v_mastery jsonb;
  v_pending_count bigint;
begin
  v_workspace_id := identity.personal_workspace_id_for_current_user();
  if v_workspace_id is null then
    raise exception using errcode = '42501', message = 'workspace is not accessible';
  end if;
  select session.* into v_active
  from sessions.focus_sessions as session
  where session.workspace_id = v_workspace_id and session.state = 'active'
  order by session.started_at desc limit 1;
  if found then
    p_readiness_goal_key := v_active.readiness_goal_key;
    p_activity_key := v_active.activity_key;
  end if;
  v_context := targets.get_explore_target_requirements_impl(
    v_workspace_id, p_readiness_goal_key
  );
  v_profile_version_id := (v_context->'targetProfile'->>'profileVersionId')::uuid;
  if p_activity_key is not null then
    select activity.* into v_activity
    from overlay.custom_activities as activity
    where activity.workspace_id = v_workspace_id
      and activity.profile_version_id = v_profile_version_id
      and activity.activity_key = p_activity_key
      and activity.lifecycle = 'active';
    if not found then
      raise exception using errcode = '42501', message = 'activity is not accessible';
    end if;
    v_activity_json := pg_catalog.jsonb_build_object(
      'activityKey', v_activity.activity_key, 'title', v_activity.title,
      'activityType', v_activity.activity_type,
      'competencyRef', v_activity.target_competency_ref,
      'evidenceDimension', v_activity.evidence_dimension,
      'expectedEvidence', v_activity.expected_evidence,
      'resourceUrl', v_activity.resource_url
    );
  end if;

  if v_active.focus_session_id is not null then
    v_active_json := pg_catalog.jsonb_build_object(
      'focusSessionId', v_active.focus_session_id, 'activityKey', v_active.activity_key,
      'title', v_active.activity_title, 'state', v_active.state,
      'plannedMinutes', v_active.planned_minutes, 'sessionVersion', v_active.aggregate_version::text,
      'startedAt', v_active.started_at
    );
  end if;

  select coalesce(pg_catalog.jsonb_agg(item.value order by item.started_at desc), '[]'::jsonb)
  into v_history
  from (
    select session.started_at,
      pg_catalog.jsonb_build_object(
        'focusSessionId', session.focus_session_id, 'activityKey', session.activity_key,
        'title', session.activity_title, 'state', session.state,
        'startedAt', session.started_at, 'endedAt', session.ended_at,
        'resultKind', attempt.result_kind, 'evidenceId', observation.evidence_id,
        'evidenceValid', case when observation.evidence_id is null then null
          else correction.correction_id is null end,
        'dimension', observation.dimension, 'outcome', observation.outcome,
        'ledgerWatermark', observation.ledger_version::text
      ) as value
    from sessions.focus_sessions as session
    join evidence.activity_attempts as attempt
      on attempt.workspace_id = session.workspace_id
     and attempt.focus_session_id = session.focus_session_id
    left join evidence.observations as observation
      on observation.workspace_id = attempt.workspace_id
     and observation.activity_attempt_id = attempt.activity_attempt_id
    left join evidence.corrections as correction
      on correction.workspace_id = observation.workspace_id
     and correction.evidence_id = observation.evidence_id
    where session.workspace_id = v_workspace_id
      and session.state in ('completed', 'stopped')
    order by session.started_at desc, session.focus_session_id desc
    limit 20
  ) as item;

  if v_activity.custom_activity_id is not null then
    select snapshot.state into v_mastery
    from mastery.current_competency_states as current_state
    join mastery.competency_state_snapshots as snapshot
      on snapshot.workspace_id = current_state.workspace_id
     and snapshot.snapshot_id = current_state.snapshot_id
    where current_state.workspace_id = v_workspace_id
      and current_state.competency_ref = v_activity.target_competency_ref;
    select count(*) into v_pending_count
    from outbox.deliveries as delivery
    join outbox.events as event
      on event.workspace_id = delivery.workspace_id and event.event_id = delivery.event_id
    where delivery.workspace_id = v_workspace_id
      and delivery.consumer_name = 'mastery.evidence_projection_v1'
      and delivery.delivery_state in ('pending', 'retry', 'leased', 'dead_letter')
      and event.payload->>'competency_ref' = v_activity.target_competency_ref;
  else
    v_pending_count := 0;
  end if;

  return pg_catalog.jsonb_build_object(
    'contract', pg_catalog.jsonb_build_object('name', 'FocusWorkspaceV1', 'version', '1.0.0'),
    'readinessGoalKey', p_readiness_goal_key, 'activity', v_activity_json,
    'activeSession', v_active_json, 'history', v_history, 'masteryState', v_mastery,
    'projectionState', case when v_pending_count > 0 then 'pending'
      when v_mastery is not null then 'current' else 'not_started' end
  );
end
$function$;

alter function sessions.start_focus_session_impl(uuid, uuid, uuid, text, "overlay".custom_activities, smallint, timestamptz)
  owner to pando_phase2_api;
alter function evidence.start_activity_attempt_impl(uuid, uuid, uuid, uuid, "overlay".custom_activities, timestamptz)
  owner to pando_phase2_api;
alter function sessions.end_focus_session_impl(uuid, uuid, uuid, bigint, text, timestamptz)
  owner to pando_phase2_api;
alter function evidence.end_activity_attempt_impl(uuid, uuid, uuid, text, text, boolean, timestamptz, uuid)
  owner to pando_phase2_api;
alter function evidence.invalidate_observation_impl(uuid, uuid, uuid, text, uuid, timestamptz)
  owner to pando_phase2_api;
alter function api.start_focus_activity_v1(text, text, smallint, text) owner to pando_phase2_api;
alter function api.finish_focus_activity_v1(uuid, bigint, text, text, boolean, text)
  owner to pando_phase2_api;
alter function api.invalidate_evidence_v1(uuid, text, text) owner to pando_phase2_api;
alter function api.get_focus_workspace_v1(text, text) owner to pando_phase2_api;

revoke all on function sessions.start_focus_session_impl(uuid, uuid, uuid, text, "overlay".custom_activities, smallint, timestamptz),
  evidence.start_activity_attempt_impl(uuid, uuid, uuid, uuid, "overlay".custom_activities, timestamptz),
  sessions.end_focus_session_impl(uuid, uuid, uuid, bigint, text, timestamptz),
  evidence.end_activity_attempt_impl(uuid, uuid, uuid, text, text, boolean, timestamptz, uuid),
  evidence.invalidate_observation_impl(uuid, uuid, uuid, text, uuid, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function api.start_focus_activity_v1(text, text, smallint, text),
  api.finish_focus_activity_v1(uuid, bigint, text, text, boolean, text),
  api.invalidate_evidence_v1(uuid, text, text), api.get_focus_workspace_v1(text, text)
  from public, anon, authenticated, service_role;
grant execute on function api.start_focus_activity_v1(text, text, smallint, text),
  api.finish_focus_activity_v1(uuid, bigint, text, text, boolean, text),
  api.invalidate_evidence_v1(uuid, text, text), api.get_focus_workspace_v1(text, text)
  to authenticated;

revoke create on schema api, sessions, evidence from pando_phase2_api;
do $migration_role_membership$
begin
  execute pg_catalog.format(
    'revoke pando_phase1_api, pando_phase2_api from %I',
    current_user
  );
end
$migration_role_membership$;
