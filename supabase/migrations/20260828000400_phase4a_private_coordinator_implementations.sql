-- Roll forward the Planning coordinator implementations out of the exposed API schema.
-- Migration 20260828000375 is already shared and therefore remains immutable.

do $roles$
begin
  execute pg_catalog.format(
    'grant pando_phase1_api, pando_phase2_api to %I with set true',
    current_user
  );
end
$roles$;

grant create on schema api, overlay to pando_phase1_api;
grant create on schema api, sessions, evidence to pando_phase2_api;

set role pando_phase1_api;

alter function api.add_current_custom_activity_without_planning_v1(
  text, text, text, text, text, text, text
) set schema overlay;

create or replace function api.add_current_custom_activity_v1(
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
  v_response jsonb;
  v_event_id uuid;
begin
  v_response := overlay.add_current_custom_activity_without_planning_v1(
    p_readiness_goal_key, p_activity_key, p_title, p_activity_type,
    p_target_competency_ref, p_expected_overlay_version, p_idempotency_key
  );
  v_event_id := (v_response->'emittedEventIds'->>0)::uuid;
  perform outbox.enqueue_plan_snapshot_source_delivery_v1(v_event_id);
  return v_response;
end
$function$;

revoke all on function overlay.add_current_custom_activity_without_planning_v1(
  text, text, text, text, text, text, text
) from public, anon, authenticated, service_role;
revoke all on function api.add_current_custom_activity_v1(
  text, text, text, text, text, text, text
) from public, anon, service_role;
grant execute on function api.add_current_custom_activity_v1(
  text, text, text, text, text, text, text
) to authenticated;

reset role;
set role pando_phase2_api;

alter function api.start_focus_activity_without_planning_v1(text, text, smallint, text)
  set schema sessions;
alter function api.finish_focus_activity_without_planning_v1(
  uuid, bigint, text, text, boolean, text
) set schema sessions;
alter function api.invalidate_evidence_without_planning_v1(uuid, text, text)
  set schema evidence;

create or replace function api.start_focus_activity_v1(
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
  v_response jsonb;
  v_event_id uuid;
begin
  v_response := sessions.start_focus_activity_without_planning_v1(
    p_readiness_goal_key, p_activity_key, p_planned_minutes, p_idempotency_key
  );
  v_event_id := (v_response->'emittedEventIds'->>0)::uuid;
  perform outbox.enqueue_plan_snapshot_source_delivery_v1(v_event_id);
  return v_response;
end
$function$;

create or replace function api.finish_focus_activity_v1(
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
  v_response jsonb;
  v_event_id uuid;
begin
  v_response := sessions.finish_focus_activity_without_planning_v1(
    p_focus_session_id, p_expected_version, p_terminal_action, p_result_kind,
    p_used_hint, p_idempotency_key
  );
  v_event_id := (v_response->'emittedEventIds'->>0)::uuid;
  perform outbox.enqueue_plan_snapshot_source_delivery_v1(v_event_id);
  return v_response;
end
$function$;

create or replace function api.invalidate_evidence_v1(
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
  v_response jsonb;
  v_event_id uuid;
begin
  v_response := evidence.invalidate_evidence_without_planning_v1(
    p_evidence_id, p_reason, p_idempotency_key
  );
  v_event_id := (v_response->'emittedEventIds'->>0)::uuid;
  perform outbox.enqueue_plan_snapshot_source_delivery_v1(v_event_id);
  return v_response;
end
$function$;

revoke all on function sessions.start_focus_activity_without_planning_v1(
  text, text, smallint, text
) from public, anon, authenticated, service_role;
revoke all on function sessions.finish_focus_activity_without_planning_v1(
  uuid, bigint, text, text, boolean, text
) from public, anon, authenticated, service_role;
revoke all on function evidence.invalidate_evidence_without_planning_v1(uuid, text, text)
  from public, anon, authenticated, service_role;
revoke all on function api.start_focus_activity_v1(text, text, smallint, text)
  from public, anon, service_role;
revoke all on function api.finish_focus_activity_v1(uuid, bigint, text, text, boolean, text)
  from public, anon, service_role;
revoke all on function api.invalidate_evidence_v1(uuid, text, text)
  from public, anon, service_role;
grant execute on function api.start_focus_activity_v1(text, text, smallint, text)
  to authenticated;
grant execute on function api.finish_focus_activity_v1(uuid, bigint, text, text, boolean, text)
  to authenticated;
grant execute on function api.invalidate_evidence_v1(uuid, text, text)
  to authenticated;

reset role;

revoke create on schema api, overlay from pando_phase1_api;
revoke create on schema api, sessions, evidence from pando_phase2_api;

do $roles$
begin
  execute pg_catalog.format(
    'revoke pando_phase1_api, pando_phase2_api from %I',
    current_user
  );
end
$roles$;
