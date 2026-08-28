-- Fixed, same-transaction Planning deliveries from the accepted owner-event producers.
-- The router is called explicitly by producer/coordinator functions; it is not an outbox trigger.

do $roles$
begin
  if not exists (
    select 1 from pg_catalog.pg_roles where rolname = 'pando_planning_router'
  ) then
    execute 'create role pando_planning_router nologin noinherit nobypassrls';
  end if;
  execute pg_catalog.format(
    'grant pando_planning_router, pando_planning_worker, pando_phase1_api, '
    || 'pando_phase2_api, pando_mastery_worker, pando_review_worker, '
    || 'pando_readiness_worker to %I with set true',
    current_user
  );
end
$roles$;

grant usage, create on schema outbox to pando_planning_router;
grant usage on schema planning, mastery, extensions to pando_planning_router;
grant create on schema planning to pando_planning_worker;
grant create on schema api to pando_phase1_api, pando_phase2_api,
  pando_mastery_worker, pando_review_worker, pando_readiness_worker;
grant create on schema mastery to pando_mastery_worker;
grant create on schema review to pando_review_worker;
grant create on schema targets to pando_readiness_worker;
grant select, insert on outbox.events to pando_planning_router;
grant select on planning.current_plan_snapshots to pando_planning_router;
grant select, insert on outbox.deliveries to pando_planning_router;
grant select, insert, update on outbox.command_receipts to pando_planning_router;
grant execute on function extensions.digest(bytea, text) to pando_planning_router;

-- An immutable operator audit record is required before rollout repair may pass a malformed
-- historical source event. The source event remains untouched and remains the canonical record.
create table planning.plan_snapshot_source_quarantines (
  event_id uuid primary key,
  event_position bigint not null unique check (event_position > 0),
  workspace_id uuid not null,
  command_id uuid not null unique,
  event_name text not null,
  event_schema_version integer not null check (event_schema_version = 1),
  reason text not null check (
    reason = pg_catalog.btrim(reason)
    and pg_catalog.length(reason) between 20 and 500
    and reason !~ '[[:cntrl:]]'
  ),
  review_reference text not null check (
    review_reference ~ '^[A-Za-z0-9][A-Za-z0-9._:/#-]{2,199}$'
  ),
  quarantined_by text not null,
  quarantined_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint plan_snapshot_source_quarantines_event_workspace_fk
    foreign key (event_id, workspace_id)
    references outbox.events (event_id, workspace_id)
    on delete restrict,
  constraint plan_snapshot_source_quarantines_command_workspace_fk
    foreign key (command_id, workspace_id)
    references outbox.command_receipts (command_id, workspace_id)
    on delete restrict
);
alter table planning.plan_snapshot_source_quarantines owner to pando_planning_worker;
alter table planning.plan_snapshot_source_quarantines enable row level security;
alter table planning.plan_snapshot_source_quarantines force row level security;
revoke all on table planning.plan_snapshot_source_quarantines
  from public, anon, authenticated, service_role;
grant select, insert on table planning.plan_snapshot_source_quarantines
  to pando_planning_router;

create policy planning_router_quarantine_read
on planning.plan_snapshot_source_quarantines
for select to pando_planning_router
using (true);

create policy planning_router_quarantine_insert
on planning.plan_snapshot_source_quarantines
for insert to pando_planning_router
with check (
  event_schema_version = 1
  and event_name in (
    'targets.readiness_projection_changed',
    'mastery.competency_state_changed',
    'review.item_changed',
    'overlay.custom_activity_added',
    'sessions.focus_started',
    'sessions.focus_completed',
    'sessions.focus_stopped',
    'evidence.observation_invalidated'
  )
);

create policy planning_router_source_command_receipt_read on outbox.command_receipts
for select to pando_planning_router
using (
  (
    command_type = 'planning.quarantine_invalid_source_event'
    and command_schema_version = 1
  )
  or exists (
    select 1
    from outbox.events as event
    where event.command_id = command_receipts.command_id
      and event.workspace_id = command_receipts.workspace_id
      and event.event_schema_version = 1
      and event.event_name in (
        'targets.readiness_projection_changed', 'mastery.competency_state_changed',
        'review.item_changed', 'overlay.custom_activity_added', 'sessions.focus_started',
        'sessions.focus_completed', 'sessions.focus_stopped',
        'evidence.observation_invalidated'
      )
  )
);

create policy planning_router_quarantine_command_insert on outbox.command_receipts
for insert to pando_planning_router
with check (
  command_type = 'planning.quarantine_invalid_source_event'
  and command_schema_version = 1
  and workspace_id is not null
  and causation_id is not null
  and expected_aggregate_version is null
  and command_status = 'started'
);

create policy planning_router_quarantine_command_update on outbox.command_receipts
for update to pando_planning_router
using (
  command_type = 'planning.quarantine_invalid_source_event'
  and command_schema_version = 1
)
with check (
  command_type = 'planning.quarantine_invalid_source_event'
  and command_schema_version = 1
  and workspace_id is not null
  and causation_id is not null
  and expected_aggregate_version is null
  and command_status = 'completed'
);

create policy planning_router_source_events on outbox.events
for select to pando_planning_router
using (
  event_schema_version = 1
  and event_name in (
    'targets.readiness_projection_changed',
    'mastery.competency_state_changed',
    'review.item_changed',
    'overlay.custom_activity_added',
    'sessions.focus_started',
    'sessions.focus_completed',
    'sessions.focus_stopped',
    'evidence.observation_invalidated'
  )
);

create policy planning_router_current_pointer on planning.current_plan_snapshots
for select to pando_planning_router
using (true);

create policy planning_router_fixed_delivery on outbox.deliveries
for insert to pando_planning_router
with check (
  consumer_name = 'planning.plan_snapshot_v1'
  and handler_contract_version = 1
);

create policy planning_router_fixed_delivery_read on outbox.deliveries
for select to pando_planning_router
using (
  consumer_name = 'planning.plan_snapshot_v1'
  and handler_contract_version = 1
);

-- Review's existing event read policy is input-delivery scoped. Allow its worker to recover only
-- its own output events caused by a fixed Review input delivery so the explicit coordinator can
-- route those IDs without broad event-table visibility.
create policy review_worker_planning_output_events on outbox.events
for select to pando_review_worker
using (
  event_name = 'review.item_changed'
  and event_schema_version = 1
  and actor_type = 'system'
  and actor_user_id is null
  and source = 'pando.review_worker'
  and causation_id is not null
  and exists (
    select 1
    from outbox.deliveries as delivery
    where delivery.workspace_id = events.workspace_id
      and delivery.event_id = events.causation_id
      and delivery.consumer_name = 'review.item_projection_v1'
      and delivery.handler_contract_version = 1
  )
);

create function planning.jsonb_has_exact_keys_v1(p_value jsonb, p_keys text[])
returns boolean
language sql
immutable
set search_path = ''
as $function$
  select case
    when pg_catalog.jsonb_typeof(p_value) <> 'object' then false
    else p_value ?& p_keys
      and not exists (
        select 1
        from pg_catalog.jsonb_object_keys(p_value) as actual(key)
        where not (actual.key = any (p_keys))
      )
  end
$function$;

create function planning.is_rfc3339_instant_v1(p_value text)
returns boolean
language plpgsql
stable
set search_path = ''
as $function$
begin
  if p_value is null or p_value !~
    '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$'
  then
    return false;
  end if;
  perform p_value::timestamptz;
  return true;
exception when others then
  return false;
end
$function$;

create function planning.jsonb_text_array_is_allowed_unique_v1(
  p_value jsonb,
  p_allowed text[],
  p_min_count integer,
  p_max_count integer
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $function$
declare
  v_count integer;
  v_unique_count integer;
begin
  if pg_catalog.jsonb_typeof(p_value) <> 'array' then
    return false;
  end if;
  select count(*)::integer, count(distinct item.value)::integer
  into v_count, v_unique_count
  from pg_catalog.jsonb_array_elements_text(p_value) as item(value)
  where item.value = any (p_allowed);
  return v_count = pg_catalog.jsonb_array_length(p_value)
    and v_count = v_unique_count
    and v_count between p_min_count and p_max_count;
exception when others then
  return false;
end
$function$;

create or replace function planning.plan_snapshot_event_is_valid_v1(p_event outbox.events)
returns boolean
language sql
stable
set search_path = ''
as $function$
  select coalesce(case (p_event).event_name
    when 'planning.input_changed' then
      (p_event).event_schema_version = 1 and (p_event).actor_type = 'user'
      and (p_event).actor_user_id is not null and (p_event).source = 'pando.database'
      and (p_event).aggregate_type in ('planning.growth_plan', 'planning.learning_track')
      and (p_event).aggregate_id is not null and (p_event).aggregate_version is not null
    when 'planning.snapshot_refresh_scheduled' then
      (p_event).event_schema_version = 1 and (p_event).actor_type = 'system'
      and (p_event).actor_user_id is null and (p_event).source = 'pando.planning_worker'
      and (p_event).aggregate_type = 'planning.plan_snapshot'
      and (p_event).aggregate_id is not null and (p_event).aggregate_version is not null
      and (p_event).payload->>'workspace_id' = (p_event).workspace_id::text
      and (p_event).payload->>'source_snapshot_id' = (p_event).aggregate_id::text
      and ((p_event).payload->>'input_fingerprint') ~ '^planning-input:[a-f0-9]{64}$'
      and case
        when planning.is_rfc3339_instant_v1((p_event).payload->>'valid_until')
          and planning.is_rfc3339_instant_v1((p_event).payload->>'scheduled_for')
        then ((p_event).payload->>'scheduled_for')::timestamptz =
          ((p_event).payload->>'valid_until')::timestamptz + interval '1 millisecond'
        else false
      end
      and planning.jsonb_has_exact_keys_v1(
        (p_event).payload,
        array['workspace_id', 'source_snapshot_id', 'input_fingerprint',
          'valid_until', 'scheduled_for']
      )
    when 'planning.source_event_quarantined' then
      (p_event).event_schema_version = 1 and (p_event).actor_type = 'system'
      and (p_event).actor_user_id is null and (p_event).source = 'pando.planning_router'
      and (p_event).aggregate_type = 'planning.source_event_quarantine'
      and (p_event).aggregate_id is not null and (p_event).aggregate_version = 1
      and (p_event).causation_id = (p_event).aggregate_id
      and (p_event).command_id is not null and (p_event).correlation_id is not null
      and planning.jsonb_has_exact_keys_v1(
        (p_event).payload,
        array['quarantined_event_id', 'quarantined_event_position',
          'quarantined_event_name', 'review_reference']
      )
      and (p_event).payload->>'quarantined_event_id' = (p_event).aggregate_id::text
      and ((p_event).payload->>'quarantined_event_position') ~ '^[1-9][0-9]{0,18}$'
      and (p_event).payload->>'quarantined_event_name' in (
        'targets.readiness_projection_changed', 'mastery.competency_state_changed',
        'review.item_changed', 'overlay.custom_activity_added', 'sessions.focus_started',
        'sessions.focus_completed', 'sessions.focus_stopped',
        'evidence.observation_invalidated'
      )
      and ((p_event).payload->>'review_reference') ~
        '^[A-Za-z0-9][A-Za-z0-9._:/#-]{2,199}$'
    when 'targets.readiness_projection_changed' then
      (p_event).event_schema_version = 1 and (p_event).actor_type = 'system'
      and (p_event).actor_user_id is null and (p_event).source = 'pando.readiness_worker'
      and (p_event).aggregate_type = 'targets.readiness_projection'
      and (p_event).aggregate_id is not null and (p_event).aggregate_version is not null
      and (p_event).command_id is not null and (p_event).correlation_id is not null
      and (p_event).causation_id is not null
      and planning.jsonb_has_exact_keys_v1(
        (p_event).payload,
        array['readiness_goal_id', 'profile_version_id', 'snapshot_id',
          'projection_version', 'input_fingerprint', 'source_evidence_watermark',
          'calculated_as_of', 'status', 'lower', 'upper', 'confidence',
          'engine_version', 'policy_version']
      )
      and (p_event).payload->>'readiness_goal_id' = (p_event).aggregate_id::text
      and (p_event).payload->>'projection_version' = (p_event).aggregate_version::text
      and ((p_event).payload->>'profile_version_id') ~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and ((p_event).payload->>'snapshot_id') ~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and ((p_event).payload->>'projection_version') ~ '^[1-9][0-9]{0,18}$'
      and ((p_event).payload->>'input_fingerprint') ~ '^readiness-input:[a-f0-9]{64}$'
      and ((p_event).payload->>'source_evidence_watermark') ~ '^(0|[1-9][0-9]{0,18})$'
      and planning.is_rfc3339_instant_v1((p_event).payload->>'calculated_as_of')
      and (p_event).payload->>'status' in (
        'NOT_READY', 'INSUFFICIENT_EVIDENCE', 'READY', 'DEVELOPING'
      )
      and (p_event).payload->>'confidence' in ('LOW', 'MEDIUM', 'HIGH')
      and (p_event).payload->>'engine_version' = 'readiness-engine/0.1.0'
      and (p_event).payload->>'policy_version' = 'mastery-readiness-policy/0.1'
      and pg_catalog.jsonb_typeof((p_event).payload->'lower') = 'number'
      and pg_catalog.jsonb_typeof((p_event).payload->'upper') = 'number'
      and ((p_event).payload->'lower')::numeric between 0 and 1
      and ((p_event).payload->'upper')::numeric between 0 and 1
      and ((p_event).payload->'lower')::numeric <= ((p_event).payload->'upper')::numeric
    when 'mastery.competency_state_changed' then
      (p_event).event_schema_version = 1 and (p_event).actor_type = 'system'
      and (p_event).actor_user_id is null and (p_event).source = 'pando.mastery_worker'
      and (p_event).aggregate_type is null and (p_event).aggregate_id is null
      and (p_event).aggregate_version is null
      and (p_event).command_id is not null and (p_event).correlation_id is not null
      and (p_event).causation_id is not null
      and planning.jsonb_has_exact_keys_v1(
        (p_event).payload,
        array['competency_ref', 'snapshot_id', 'projection_generation', 'input_watermark',
          'achievement_level', 'engine_version', 'policy_version', 'calculated_as_of']
      )
      and ((p_event).payload->>'competency_ref') ~
        '^competency:[a-z0-9][a-z0-9-]{1,100}$'
      and ((p_event).payload->>'snapshot_id') ~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and (p_event).payload->>'projection_generation' = 'live-v1'
      and ((p_event).payload->>'input_watermark') ~ '^[1-9][0-9]{0,18}$'
      and (p_event).payload->>'achievement_level' in (
        'NOT_STARTED', 'COMPLETED', 'VERIFIED', 'MASTERED'
      )
      and (p_event).payload->>'engine_version' = 'mastery-engine/0.1.0'
      and (p_event).payload->>'policy_version' = 'mastery-readiness-policy/0.1'
      and planning.is_rfc3339_instant_v1((p_event).payload->>'calculated_as_of')
    when 'review.item_changed' then
      (p_event).event_schema_version = 1 and (p_event).actor_type = 'system'
      and (p_event).actor_user_id is null and (p_event).source = 'pando.review_worker'
      and (p_event).aggregate_type = 'review.subject'
      and (p_event).aggregate_id is not null and (p_event).aggregate_version is not null
      and (p_event).command_id is not null and (p_event).correlation_id is not null
      and (p_event).causation_id is not null
      and planning.jsonb_has_exact_keys_v1(
        (p_event).payload,
        array['subject_id', 'subject_ref', 'subject_type', 'competency_ref', 'dimension',
          'subject_version', 'effective_due_at', 'active_reason_types', 'projection_status']
      )
      and (p_event).payload->>'subject_id' = (p_event).aggregate_id::text
      and (p_event).payload->>'subject_version' = (p_event).aggregate_version::text
      and ((p_event).payload->>'subject_ref') ~
        '^competency:[a-z0-9][a-z0-9-]{1,100}/(knowledge|recall|application|interview_execution)$'
      and ((p_event).payload->>'competency_ref') ~
        '^competency:[a-z0-9][a-z0-9-]{1,100}$'
      and (p_event).payload->>'subject_type' = 'COMPETENCY_DIMENSION'
      and (p_event).payload->>'dimension' in (
        'KNOWLEDGE', 'RECALL', 'APPLICATION', 'INTERVIEW_EXECUTION'
      )
      and (p_event).payload->>'subject_ref' = (p_event).payload->>'competency_ref'
        || '/' || pg_catalog.lower((p_event).payload->>'dimension')
      and (p_event).payload->>'projection_status' in ('CURRENT', 'INACTIVE', 'SUPPRESSED')
      and case (p_event).payload->>'projection_status'
        when 'CURRENT' then
          planning.is_rfc3339_instant_v1((p_event).payload->>'effective_due_at')
          and planning.jsonb_text_array_is_allowed_unique_v1(
            (p_event).payload->'active_reason_types',
            array['RETENTION_RISK', 'PERSONAL_REMINDER', 'GOAL_DEADLINE',
              'VERIFICATION_NEEDED'], 1, 4
          )
        when 'INACTIVE' then
          (p_event).payload->'effective_due_at' = 'null'::jsonb
          and planning.jsonb_text_array_is_allowed_unique_v1(
            (p_event).payload->'active_reason_types',
            array['RETENTION_RISK', 'PERSONAL_REMINDER', 'GOAL_DEADLINE',
              'VERIFICATION_NEEDED'], 0, 0
          )
        when 'SUPPRESSED' then
          (p_event).payload->'effective_due_at' = 'null'::jsonb
          and planning.jsonb_text_array_is_allowed_unique_v1(
            (p_event).payload->'active_reason_types',
            array['RETENTION_RISK', 'PERSONAL_REMINDER', 'GOAL_DEADLINE',
              'VERIFICATION_NEEDED'], 0, 0
          )
        else false
      end
    when 'overlay.custom_activity_added' then
      (p_event).event_schema_version = 1 and (p_event).actor_type = 'user'
      and (p_event).actor_user_id is not null and (p_event).source = 'pando.database'
      and (p_event).aggregate_type = 'overlay.workspace'
      and (p_event).aggregate_id = (p_event).workspace_id
      and (p_event).aggregate_version is not null
      and (p_event).command_id is not null and (p_event).correlation_id is not null
      and (p_event).causation_id is null
      and planning.jsonb_has_exact_keys_v1(
        (p_event).payload,
        array['custom_activity_id', 'activity_key', 'profile_version_key',
          'target_competency_ref']
      )
      and ((p_event).payload->>'custom_activity_id') ~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and ((p_event).payload->>'activity_key') ~ '^activity:[a-z0-9][a-z0-9-]{1,100}$'
      and ((p_event).payload->>'profile_version_key') ~
        '^target:[a-z0-9][a-z0-9-]{1,100}$'
      and ((p_event).payload->>'target_competency_ref') ~
        '^competency:[a-z0-9][a-z0-9-]{1,100}$'
    when 'sessions.focus_started' then
      (p_event).event_schema_version = 1 and (p_event).actor_type = 'user'
      and (p_event).actor_user_id is not null and (p_event).source = 'pando.database'
      and (p_event).aggregate_type = 'sessions.focus_session'
      and (p_event).aggregate_id is not null and (p_event).aggregate_version = 1
      and (p_event).command_id is not null and (p_event).correlation_id is not null
      and (p_event).causation_id is null
      and planning.jsonb_has_exact_keys_v1(
        (p_event).payload,
        array['focus_session_id', 'activity_attempt_id', 'activity_key', 'readiness_goal_key']
      )
      and (p_event).payload->>'focus_session_id' = (p_event).aggregate_id::text
      and ((p_event).payload->>'activity_attempt_id') ~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and ((p_event).payload->>'activity_key') ~ '^activity:[a-z0-9][a-z0-9-]{1,100}$'
      and ((p_event).payload->>'readiness_goal_key') ~ '^goal:[a-z0-9][a-z0-9-]{1,100}$'
    when 'sessions.focus_completed' then
      (p_event).event_schema_version = 1 and (p_event).actor_type = 'user'
      and (p_event).actor_user_id is not null and (p_event).source = 'pando.database'
      and (p_event).aggregate_type = 'sessions.focus_session'
      and (p_event).aggregate_id is not null and (p_event).aggregate_version = 2
      and (p_event).command_id is not null and (p_event).correlation_id is not null
      and (p_event).causation_id is null
      and planning.jsonb_has_exact_keys_v1(
        (p_event).payload,
        array['focus_session_id', 'activity_attempt_id', 'result_kind']
      )
      and (p_event).payload->>'focus_session_id' = (p_event).aggregate_id::text
      and ((p_event).payload->>'activity_attempt_id') ~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and (p_event).payload->>'result_kind' in (
        'OBSERVED_SUCCESS', 'OBSERVED_FAILURE', 'COMPLETION_ONLY'
      )
    when 'sessions.focus_stopped' then
      (p_event).event_schema_version = 1 and (p_event).actor_type = 'user'
      and (p_event).actor_user_id is not null and (p_event).source = 'pando.database'
      and (p_event).aggregate_type = 'sessions.focus_session'
      and (p_event).aggregate_id is not null and (p_event).aggregate_version = 2
      and (p_event).command_id is not null and (p_event).correlation_id is not null
      and (p_event).causation_id is null
      and planning.jsonb_has_exact_keys_v1(
        (p_event).payload,
        array['focus_session_id', 'activity_attempt_id', 'result_kind']
      )
      and (p_event).payload->>'focus_session_id' = (p_event).aggregate_id::text
      and ((p_event).payload->>'activity_attempt_id') ~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and (p_event).payload->'result_kind' = 'null'::jsonb
    when 'evidence.observation_invalidated' then
      (p_event).event_schema_version = 1 and (p_event).actor_type = 'user'
      and (p_event).actor_user_id is not null and (p_event).source = 'pando.database'
      and (p_event).command_id is not null and (p_event).correlation_id is not null
      and (p_event).causation_id is null
      and mastery.evidence_projection_event_v1_is_valid(p_event)
    else false
  end, false)
$function$;

alter function planning.jsonb_has_exact_keys_v1(jsonb, text[]) owner to pando_planning_worker;
alter function planning.is_rfc3339_instant_v1(text) owner to pando_planning_worker;
alter function planning.jsonb_text_array_is_allowed_unique_v1(
  jsonb, text[], integer, integer
) owner to pando_planning_worker;
alter function planning.plan_snapshot_event_is_valid_v1(outbox.events)
  owner to pando_planning_worker;
grant execute on function planning.plan_snapshot_event_is_valid_v1(outbox.events),
  planning.jsonb_has_exact_keys_v1(jsonb, text[]),
  planning.is_rfc3339_instant_v1(text),
  planning.jsonb_text_array_is_allowed_unique_v1(jsonb, text[], integer, integer),
  mastery.evidence_projection_event_v1_is_valid(outbox.events)
  to pando_planning_router;

create function planning.guard_plan_snapshot_source_quarantine_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_event outbox.events%rowtype;
  v_command outbox.command_receipts%rowtype;
begin
  if tg_op <> 'INSERT' then
    raise exception using errcode = '55000',
      message = 'Planning source quarantine audit rows are immutable';
  end if;
  select event.* into v_event
  from outbox.events as event
  join planning.current_plan_snapshots as pointer
    on pointer.workspace_id = event.workspace_id
  where event.event_id = new.event_id;
  select receipt.* into v_command
  from outbox.command_receipts as receipt
  where receipt.command_id = new.command_id
    and receipt.workspace_id = new.workspace_id
    and receipt.command_type = 'planning.quarantine_invalid_source_event'
    and receipt.command_schema_version = 1;
  if v_event.event_id is null
    or new.event_position <> v_event.event_position
    or new.workspace_id <> v_event.workspace_id
    or new.event_name <> v_event.event_name
    or new.event_schema_version <> v_event.event_schema_version
    or v_command.command_id is null
    or v_command.causation_id <> v_event.event_id
    or planning.plan_snapshot_event_is_valid_v1(v_event) is true
  then
    raise exception using errcode = '23514',
      message = 'Planning source quarantine audit row does not match an invalid accepted event';
  end if;
  return new;
end
$function$;
alter function planning.guard_plan_snapshot_source_quarantine_mutation()
  owner to pando_planning_worker;
revoke all on function planning.guard_plan_snapshot_source_quarantine_mutation()
  from public, anon, authenticated, service_role;

create trigger plan_snapshot_source_quarantines_immutable
before insert or update or delete on planning.plan_snapshot_source_quarantines
for each row execute function planning.guard_plan_snapshot_source_quarantine_mutation();

create policy planning_router_repair_event_read on outbox.events
for select to pando_planning_router
using (
  event_name = 'planning.source_event_quarantined'
  and event_schema_version = 1
  and source = 'pando.planning_router'
);

create policy planning_router_repair_event_insert on outbox.events
for insert to pando_planning_router
with check (
  event_name = 'planning.source_event_quarantined'
  and planning.plan_snapshot_event_is_valid_v1(events)
);
grant execute on function mastery.evidence_projection_event_v1_is_valid(outbox.events)
  to pando_planning_worker;

create function outbox.enqueue_plan_snapshot_source_delivery_v1(p_event_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_event outbox.events%rowtype;
begin
  select event.* into v_event
  from outbox.events as event
  where event.event_id = p_event_id;
  if not found then
    raise exception using errcode = '22023', message = 'Planning source event does not exist';
  end if;
  if v_event.event_schema_version <> 1 or v_event.event_name not in (
    'targets.readiness_projection_changed',
    'mastery.competency_state_changed',
    'review.item_changed',
    'overlay.custom_activity_added',
    'sessions.focus_started',
    'sessions.focus_completed',
    'sessions.focus_stopped',
    'evidence.observation_invalidated'
  ) then
    return false;
  end if;
  if not exists (
    select 1 from planning.current_plan_snapshots as pointer
    where pointer.workspace_id = v_event.workspace_id
  ) then
    return false;
  end if;
  if planning.plan_snapshot_event_is_valid_v1(v_event) is not true then
    raise exception using errcode = '22023', message = 'Planning source event contract is invalid';
  end if;
  insert into outbox.deliveries (
    event_id, workspace_id, consumer_name, handler_contract_version
  ) values (
    v_event.event_id, v_event.workspace_id, 'planning.plan_snapshot_v1', 1
  ) on conflict (event_id, consumer_name, handler_contract_version) do nothing;
  return true;
end
$function$;

alter function outbox.enqueue_plan_snapshot_source_delivery_v1(uuid)
  owner to pando_planning_router;
revoke all on function outbox.enqueue_plan_snapshot_source_delivery_v1(uuid)
  from public, anon, authenticated, service_role;
grant execute on function outbox.enqueue_plan_snapshot_source_delivery_v1(uuid)
  to pando_phase1_api, pando_phase2_api, pando_mastery_worker,
    pando_review_worker, pando_readiness_worker;

-- Current Overlay coordinator: move the previous implementation out of the API schema.
alter function api.add_current_custom_activity_v1(
  text, text, text, text, text, text, text
) rename to add_current_custom_activity_without_planning_v1;
alter function api.add_current_custom_activity_without_planning_v1(
  text, text, text, text, text, text, text
) owner to pando_phase1_api;
alter function api.add_current_custom_activity_without_planning_v1(
  text, text, text, text, text, text, text
) security invoker;
revoke all on function api.add_current_custom_activity_without_planning_v1(
  text, text, text, text, text, text, text
) from public, anon, authenticated, service_role;

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
  v_response jsonb;
  v_event_id uuid;
begin
  v_response := api.add_current_custom_activity_without_planning_v1(
    p_readiness_goal_key, p_activity_key, p_title, p_activity_type,
    p_target_competency_ref, p_expected_overlay_version, p_idempotency_key
  );
  v_event_id := (v_response->'emittedEventIds'->>0)::uuid;
  perform outbox.enqueue_plan_snapshot_source_delivery_v1(v_event_id);
  return v_response;
end
$function$;
alter function api.add_current_custom_activity_v1(text, text, text, text, text, text, text)
  owner to pando_phase1_api;
revoke all on function api.add_current_custom_activity_v1(text, text, text, text, text, text, text)
  from public, anon, service_role;
grant execute on function api.add_current_custom_activity_v1(
  text, text, text, text, text, text, text
) to authenticated;

-- Sessions/Evidence coordinators keep their public signatures and route returned source events.
alter function api.start_focus_activity_v1(text, text, smallint, text)
  rename to start_focus_activity_without_planning_v1;
alter function api.start_focus_activity_without_planning_v1(text, text, smallint, text)
  owner to pando_phase2_api;
alter function api.start_focus_activity_without_planning_v1(text, text, smallint, text)
  security invoker;
revoke all on function api.start_focus_activity_without_planning_v1(
  text, text, smallint, text
) from public, anon, authenticated, service_role;

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
  v_response jsonb;
  v_event_id uuid;
begin
  v_response := api.start_focus_activity_without_planning_v1(
    p_readiness_goal_key, p_activity_key, p_planned_minutes, p_idempotency_key
  );
  v_event_id := (v_response->'emittedEventIds'->>0)::uuid;
  perform outbox.enqueue_plan_snapshot_source_delivery_v1(v_event_id);
  return v_response;
end
$function$;
alter function api.start_focus_activity_v1(text, text, smallint, text)
  owner to pando_phase2_api;
revoke all on function api.start_focus_activity_v1(text, text, smallint, text)
  from public, anon, service_role;
grant execute on function api.start_focus_activity_v1(text, text, smallint, text)
  to authenticated;

alter function api.finish_focus_activity_v1(uuid, bigint, text, text, boolean, text)
  rename to finish_focus_activity_without_planning_v1;
alter function api.finish_focus_activity_without_planning_v1(
  uuid, bigint, text, text, boolean, text
) owner to pando_phase2_api;
alter function api.finish_focus_activity_without_planning_v1(
  uuid, bigint, text, text, boolean, text
) security invoker;
revoke all on function api.finish_focus_activity_without_planning_v1(
  uuid, bigint, text, text, boolean, text
) from public, anon, authenticated, service_role;

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
  v_response jsonb;
  v_event_id uuid;
begin
  v_response := api.finish_focus_activity_without_planning_v1(
    p_focus_session_id, p_expected_version, p_terminal_action, p_result_kind,
    p_used_hint, p_idempotency_key
  );
  v_event_id := (v_response->'emittedEventIds'->>0)::uuid;
  perform outbox.enqueue_plan_snapshot_source_delivery_v1(v_event_id);
  return v_response;
end
$function$;
alter function api.finish_focus_activity_v1(uuid, bigint, text, text, boolean, text)
  owner to pando_phase2_api;
revoke all on function api.finish_focus_activity_v1(uuid, bigint, text, text, boolean, text)
  from public, anon, service_role;
grant execute on function api.finish_focus_activity_v1(uuid, bigint, text, text, boolean, text)
  to authenticated;

alter function api.invalidate_evidence_v1(uuid, text, text)
  rename to invalidate_evidence_without_planning_v1;
alter function api.invalidate_evidence_without_planning_v1(uuid, text, text)
  owner to pando_phase2_api;
alter function api.invalidate_evidence_without_planning_v1(uuid, text, text)
  security invoker;
revoke all on function api.invalidate_evidence_without_planning_v1(uuid, text, text)
  from public, anon, authenticated, service_role;

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
  v_response jsonb;
  v_event_id uuid;
begin
  v_response := api.invalidate_evidence_without_planning_v1(
    p_evidence_id, p_reason, p_idempotency_key
  );
  v_event_id := (v_response->'emittedEventIds'->>0)::uuid;
  perform outbox.enqueue_plan_snapshot_source_delivery_v1(v_event_id);
  return v_response;
end
$function$;
alter function api.invalidate_evidence_v1(uuid, text, text)
  owner to pando_phase2_api;
revoke all on function api.invalidate_evidence_v1(uuid, text, text)
  from public, anon, service_role;
grant execute on function api.invalidate_evidence_v1(uuid, text, text)
  to authenticated;

-- Projection completions route only the exact current-owner events caused by their input event.
alter function mastery.complete_evidence_projection_impl(uuid, uuid, bigint, bigint, jsonb)
  rename to complete_evidence_projection_without_planning_v1;
revoke all on function mastery.complete_evidence_projection_without_planning_v1(
  uuid, uuid, bigint, bigint, jsonb
) from public, anon, authenticated, service_role;

create function mastery.complete_evidence_projection_impl(
  p_delivery_id uuid,
  p_lease_token uuid,
  p_expected_event_position bigint,
  p_expected_input_watermark bigint,
  p_state jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_completed boolean;
  v_event_id uuid;
  v_source_event_id uuid;
  v_workspace_id uuid;
begin
  v_completed := mastery.complete_evidence_projection_without_planning_v1(
    p_delivery_id, p_lease_token, p_expected_event_position,
    p_expected_input_watermark, p_state
  );
  if v_completed then
    select delivery.event_id, delivery.workspace_id
    into strict v_source_event_id, v_workspace_id
    from outbox.deliveries as delivery
    where delivery.delivery_id = p_delivery_id
      and delivery.consumer_name = 'mastery.evidence_projection_v1';
    for v_event_id in
      select event.event_id
      from outbox.events as event
      where event.workspace_id = v_workspace_id
        and event.event_name = 'mastery.competency_state_changed'
        and event.event_schema_version = 1
        and event.causation_id = v_source_event_id
    loop
      perform outbox.enqueue_plan_snapshot_source_delivery_v1(v_event_id);
    end loop;
  end if;
  return v_completed;
end
$function$;
alter function mastery.complete_evidence_projection_impl(uuid, uuid, bigint, bigint, jsonb)
  owner to pando_mastery_worker;
revoke all on function mastery.complete_evidence_projection_impl(
  uuid, uuid, bigint, bigint, jsonb
) from public, anon, authenticated, service_role;
grant execute on function mastery.complete_evidence_projection_impl(
  uuid, uuid, bigint, bigint, jsonb
) to service_role;
create or replace function api.complete_mastery_evidence_projection_v1(
  p_delivery_id uuid, p_lease_token uuid, p_expected_event_position bigint,
  p_expected_input_watermark bigint, p_state jsonb
)
returns boolean language sql security invoker set search_path = ''
as $function$
  select mastery.complete_evidence_projection_impl(
    p_delivery_id, p_lease_token, p_expected_event_position,
    p_expected_input_watermark, p_state
  )
$function$;

alter function review.complete_item_projection_impl(uuid, uuid, bigint, jsonb)
  rename to complete_item_projection_without_planning_v1;
revoke all on function review.complete_item_projection_without_planning_v1(
  uuid, uuid, bigint, jsonb
) from public, anon, authenticated, service_role;

create function review.complete_item_projection_impl(
  p_delivery_id uuid,
  p_lease_token uuid,
  p_expected_event_position bigint,
  p_subjects jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_completed boolean;
  v_event_id uuid;
  v_source_event_id uuid;
  v_workspace_id uuid;
begin
  v_completed := review.complete_item_projection_without_planning_v1(
    p_delivery_id, p_lease_token, p_expected_event_position, p_subjects
  );
  if v_completed then
    select delivery.event_id, delivery.workspace_id
    into strict v_source_event_id, v_workspace_id
    from outbox.deliveries as delivery
    where delivery.delivery_id = p_delivery_id
      and delivery.consumer_name = 'review.item_projection_v1';
    for v_event_id in
      select event.event_id
      from outbox.events as event
      where event.workspace_id = v_workspace_id
        and event.event_name = 'review.item_changed'
        and event.event_schema_version = 1
        and event.causation_id = v_source_event_id
    loop
      perform outbox.enqueue_plan_snapshot_source_delivery_v1(v_event_id);
    end loop;
  end if;
  return v_completed;
end
$function$;
alter function review.complete_item_projection_impl(uuid, uuid, bigint, jsonb)
  owner to pando_review_worker;
revoke all on function review.complete_item_projection_impl(uuid, uuid, bigint, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function review.complete_item_projection_impl(uuid, uuid, bigint, jsonb)
  to service_role;
create or replace function api.complete_review_item_projection_v1(
  p_delivery_id uuid, p_lease_token uuid, p_expected_event_position bigint,
  p_subjects jsonb
)
returns boolean language sql security invoker set search_path = ''
as $function$
  select review.complete_item_projection_impl(
    p_delivery_id, p_lease_token, p_expected_event_position, p_subjects
  )
$function$;

alter function targets.complete_readiness_projection_impl(uuid, uuid, bigint, jsonb)
  rename to complete_readiness_projection_without_planning_v1;
revoke all on function targets.complete_readiness_projection_without_planning_v1(
  uuid, uuid, bigint, jsonb
) from public, anon, authenticated, service_role;

create function targets.complete_readiness_projection_impl(
  p_delivery_id uuid,
  p_lease_token uuid,
  p_expected_event_position bigint,
  p_results jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_completed boolean;
  v_event_id uuid;
  v_source_event_id uuid;
  v_workspace_id uuid;
begin
  v_completed := targets.complete_readiness_projection_without_planning_v1(
    p_delivery_id, p_lease_token, p_expected_event_position, p_results
  );
  if v_completed then
    select delivery.event_id, delivery.workspace_id
    into strict v_source_event_id, v_workspace_id
    from outbox.deliveries as delivery
    where delivery.delivery_id = p_delivery_id
      and delivery.consumer_name = 'targets.readiness_projection_v1';
    for v_event_id in
      select event.event_id
      from outbox.events as event
      where event.workspace_id = v_workspace_id
        and event.event_name = 'targets.readiness_projection_changed'
        and event.event_schema_version = 1
        and event.causation_id = v_source_event_id
    loop
      perform outbox.enqueue_plan_snapshot_source_delivery_v1(v_event_id);
    end loop;
  end if;
  return v_completed;
end
$function$;
alter function targets.complete_readiness_projection_impl(uuid, uuid, bigint, jsonb)
  owner to pando_readiness_worker;
revoke all on function targets.complete_readiness_projection_impl(uuid, uuid, bigint, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function targets.complete_readiness_projection_impl(uuid, uuid, bigint, jsonb)
  to service_role;
create or replace function api.complete_target_readiness_projection_v1(
  p_delivery_id uuid, p_lease_token uuid,
  p_expected_event_position bigint, p_results jsonb
)
returns boolean language sql security invoker set search_path = ''
as $function$
  select targets.complete_readiness_projection_impl(
    p_delivery_id, p_lease_token, p_expected_event_position, p_results
  )
$function$;

-- A malformed immutable history row may be quarantined only through this reviewed, administrator-
-- only command. A valid event cannot be quarantined, and an idempotent replay must retain the exact
-- original reason and review reference.
create function outbox.quarantine_invalid_plan_snapshot_source_event_v1(
  p_event_id uuid,
  p_reason text,
  p_review_reference text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_event outbox.events%rowtype;
  v_source_receipt outbox.command_receipts%rowtype;
  v_receipt outbox.command_receipts%rowtype;
  v_quarantine planning.plan_snapshot_source_quarantines%rowtype;
  v_command_id uuid := gen_random_uuid();
  v_correlation_id uuid := gen_random_uuid();
  v_repair_event_id uuid := gen_random_uuid();
  v_repair_delivery_id uuid := gen_random_uuid();
  v_request_hash bytea;
  v_repair_payload jsonb;
  v_response jsonb;
begin
  if p_reason is null
    or p_reason <> pg_catalog.btrim(p_reason)
    or pg_catalog.length(p_reason) not between 20 and 500
    or p_reason ~ '[[:cntrl:]]'
  then
    raise exception using errcode = '22023',
      message = 'Planning source quarantine reason must be 20 to 500 trimmed printable characters';
  end if;
  if p_review_reference is null
    or p_review_reference !~ '^[A-Za-z0-9][A-Za-z0-9._:/#-]{2,199}$'
  then
    raise exception using errcode = '22023',
      message = 'Planning source quarantine review reference is invalid';
  end if;
  if p_idempotency_key is null
    or p_idempotency_key <> pg_catalog.btrim(p_idempotency_key)
    or pg_catalog.length(p_idempotency_key) not between 1 and 128
  then
    raise exception using errcode = '22023',
      message = 'Planning source quarantine idempotency key must contain 1 to 128 trimmed characters';
  end if;

  select event.* into v_event
  from outbox.events as event
  join planning.current_plan_snapshots as pointer
    on pointer.workspace_id = event.workspace_id
  where event.event_id = p_event_id;
  if not found then
    raise exception using errcode = '22023',
      message = 'Planning source quarantine event or workspace sentinel does not exist';
  end if;
  if v_event.event_schema_version <> 1 or v_event.event_name not in (
    'targets.readiness_projection_changed', 'mastery.competency_state_changed',
    'review.item_changed', 'overlay.custom_activity_added', 'sessions.focus_started',
    'sessions.focus_completed', 'sessions.focus_stopped',
    'evidence.observation_invalidated'
  ) then
    raise exception using errcode = '22023',
      message = 'Planning source quarantine event family is unsupported';
  end if;
  if planning.plan_snapshot_event_is_valid_v1(v_event) is true then
    raise exception using errcode = '22023',
      message = 'A valid Planning source event cannot be quarantined';
  end if;

  select receipt.* into strict v_source_receipt
  from outbox.command_receipts as receipt
  where receipt.command_id = v_event.command_id
    and receipt.workspace_id = v_event.workspace_id;
  v_request_hash := extensions.digest(
    pg_catalog.convert_to(
      pg_catalog.jsonb_build_object(
        'commandType', 'planning.quarantine_invalid_source_event',
        'schemaVersion', 1,
        'workspaceId', v_event.workspace_id,
        'eventId', v_event.event_id,
        'reason', p_reason,
        'reviewReference', p_review_reference
      )::text,
      'UTF8'
    ),
    'sha256'
  );

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    v_source_receipt.actor_user_id::text
      || ':planning.quarantine_invalid_source_event:' || p_idempotency_key,
    0
  ));
  select receipt.* into v_receipt
  from outbox.command_receipts as receipt
  where receipt.actor_user_id = v_source_receipt.actor_user_id
    and receipt.command_type = 'planning.quarantine_invalid_source_event'
    and receipt.idempotency_key = p_idempotency_key
  for update;
  if found then
    if v_receipt.request_hash <> v_request_hash then
      raise exception using errcode = '22023',
        message = 'idempotency key reused with a different request';
    end if;
    if v_receipt.command_status <> 'completed' then
      raise exception using errcode = '40001', message = 'command receipt is not complete';
    end if;
    return v_receipt.response;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'planning-source-quarantine:' || v_event.event_id::text,
    0
  ));
  if exists (
    select 1 from planning.plan_snapshot_source_quarantines as quarantine
    where quarantine.event_id = v_event.event_id
  ) then
    raise exception using errcode = '23505',
      message = 'Planning source event already has a quarantine command';
  end if;

  insert into outbox.command_receipts (
    command_id, command_type, command_schema_version, workspace_id, actor_user_id,
    idempotency_key, request_hash, correlation_id, causation_id
  ) values (
    v_command_id, 'planning.quarantine_invalid_source_event', 1, v_event.workspace_id,
    v_source_receipt.actor_user_id, p_idempotency_key, v_request_hash,
    v_correlation_id, v_event.event_id
  );

  insert into planning.plan_snapshot_source_quarantines (
    event_id, event_position, workspace_id, command_id, event_name, event_schema_version,
    reason, review_reference, quarantined_by
  ) values (
    v_event.event_id, v_event.event_position, v_event.workspace_id, v_command_id,
    v_event.event_name, v_event.event_schema_version, p_reason, p_review_reference,
    session_user::text
  );

  select quarantine.* into strict v_quarantine
  from planning.plan_snapshot_source_quarantines as quarantine
  where quarantine.event_id = v_event.event_id;
  if v_quarantine.event_position <> v_event.event_position
    or v_quarantine.workspace_id <> v_event.workspace_id
    or v_quarantine.command_id <> v_command_id
    or v_quarantine.event_name <> v_event.event_name
    or v_quarantine.event_schema_version <> v_event.event_schema_version
    or v_quarantine.reason <> p_reason
    or v_quarantine.review_reference <> p_review_reference
  then
    raise exception using errcode = '23505',
      message = 'Planning source event has a conflicting quarantine record';
  end if;

  v_repair_payload := pg_catalog.jsonb_build_object(
    'quarantined_event_id', v_event.event_id,
    'quarantined_event_position', v_event.event_position::text,
    'quarantined_event_name', v_event.event_name,
    'review_reference', p_review_reference
  );
  insert into outbox.events (
    event_id, event_name, event_schema_version, workspace_id, aggregate_type,
    aggregate_id, aggregate_version, actor_type, actor_user_id, command_id,
    correlation_id, causation_id, occurred_at, source, payload
  ) values (
    v_repair_event_id, 'planning.source_event_quarantined', 1, v_event.workspace_id,
    'planning.source_event_quarantine', v_event.event_id, 1, 'system', null,
    v_command_id, v_correlation_id, v_event.event_id, pg_catalog.clock_timestamp(),
    'pando.planning_router', v_repair_payload
  );

  insert into outbox.deliveries (
    delivery_id, event_id, workspace_id, consumer_name, handler_contract_version
  ) values (
    v_repair_delivery_id, v_repair_event_id, v_event.workspace_id,
    'planning.plan_snapshot_v1', 1
  );

  v_response := pg_catalog.jsonb_build_object(
    'commandId', v_command_id,
    'workspaceId', v_event.workspace_id,
    'eventId', v_quarantine.event_id,
    'eventPosition', v_quarantine.event_position::text,
    'eventName', v_quarantine.event_name,
    'reviewReference', v_quarantine.review_reference,
    'quarantinedAt', v_quarantine.quarantined_at,
    'repairEventId', v_repair_event_id,
    'repairDeliveryId', v_repair_delivery_id,
    'emittedEventIds', pg_catalog.jsonb_build_array(v_repair_event_id)
  );
  update outbox.command_receipts
  set command_status = 'completed', response = v_response,
    emitted_event_ids = array[v_repair_event_id], completed_at = pg_catalog.clock_timestamp()
  where command_id = v_command_id;
  return v_response;
end
$function$;
alter function outbox.quarantine_invalid_plan_snapshot_source_event_v1(uuid, text, text, text)
  owner to pando_planning_router;
revoke all on function outbox.quarantine_invalid_plan_snapshot_source_event_v1(uuid, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function outbox.quarantine_invalid_plan_snapshot_source_event_v1(uuid, text, text, text)
  to postgres;

-- Hosted rollout repair is deliberately explicit and bounded. Operators advance the returned
-- event-position cursor until complete=true; replaying any cursor is safe. A quarantined malformed
-- event advances the cursor but never receives a delivery, and is counted explicitly in the result.
create function outbox.backfill_plan_snapshot_source_deliveries_v1(
  p_after_event_position bigint,
  p_batch_size integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_event record;
  v_next_event_position bigint := p_after_event_position;
  v_processed_count integer := 0;
  v_quarantined_count integer := 0;
  v_has_more boolean;
begin
  if p_after_event_position is null or p_after_event_position < 0 then
    raise exception using errcode = '22023',
      message = 'Planning source backfill cursor must be non-negative';
  end if;
  if p_batch_size is null or p_batch_size < 1 or p_batch_size > 500 then
    raise exception using errcode = '22023',
      message = 'Planning source backfill batch size must be between 1 and 500';
  end if;

  for v_event in
    select source_event.event_id, source_event.event_position,
      quarantine.event_id is not null as is_quarantined
    from outbox.events as source_event
    join planning.current_plan_snapshots as pointer
      on pointer.workspace_id = source_event.workspace_id
    left join planning.plan_snapshot_source_quarantines as quarantine
      on quarantine.event_id = source_event.event_id
    where source_event.event_position > p_after_event_position
      and source_event.event_schema_version = 1
      and source_event.event_name in (
        'targets.readiness_projection_changed', 'mastery.competency_state_changed',
        'review.item_changed', 'overlay.custom_activity_added', 'sessions.focus_started',
        'sessions.focus_completed', 'sessions.focus_stopped',
        'evidence.observation_invalidated'
      )
    order by source_event.event_position
    limit p_batch_size
  loop
    if v_event.is_quarantined then
      v_quarantined_count := v_quarantined_count + 1;
    else
      begin
        perform outbox.enqueue_plan_snapshot_source_delivery_v1(v_event.event_id);
      exception when others then
        raise exception using errcode = sqlstate,
          message = pg_catalog.format(
            'Planning source backfill failed at event_position %s (event_id %s): %s',
            v_event.event_position, v_event.event_id, sqlerrm
          );
      end;
    end if;
    v_next_event_position := v_event.event_position;
    v_processed_count := v_processed_count + 1;
  end loop;

  select exists (
    select 1
    from outbox.events as source_event
    join planning.current_plan_snapshots as pointer
      on pointer.workspace_id = source_event.workspace_id
    where source_event.event_position > v_next_event_position
      and source_event.event_schema_version = 1
      and source_event.event_name in (
        'targets.readiness_projection_changed', 'mastery.competency_state_changed',
        'review.item_changed', 'overlay.custom_activity_added', 'sessions.focus_started',
        'sessions.focus_completed', 'sessions.focus_stopped',
        'evidence.observation_invalidated'
      )
  ) into v_has_more;

  return pg_catalog.jsonb_build_object(
    'processedCount', v_processed_count,
    'quarantinedCount', v_quarantined_count,
    'nextAfterEventPosition', v_next_event_position::text,
    'complete', not v_has_more
  );
end
$function$;
alter function outbox.backfill_plan_snapshot_source_deliveries_v1(bigint, integer)
  owner to pando_planning_router;
revoke all on function outbox.backfill_plan_snapshot_source_deliveries_v1(bigint, integer)
  from public, anon, authenticated, service_role;
grant execute on function outbox.backfill_plan_snapshot_source_deliveries_v1(bigint, integer)
  to postgres;

revoke create on schema outbox from pando_planning_router;
revoke create on schema planning from pando_planning_worker;
revoke create on schema api from pando_phase1_api, pando_phase2_api,
  pando_mastery_worker, pando_review_worker, pando_readiness_worker;
revoke create on schema mastery from pando_mastery_worker;
revoke create on schema review from pando_review_worker;
revoke create on schema targets from pando_readiness_worker;
revoke all on function planning.jsonb_has_exact_keys_v1(jsonb, text[]),
  planning.is_rfc3339_instant_v1(text),
  planning.jsonb_text_array_is_allowed_unique_v1(jsonb, text[], integer, integer),
  planning.plan_snapshot_event_is_valid_v1(outbox.events),
  planning.guard_plan_snapshot_source_quarantine_mutation()
  from public, anon, authenticated, service_role;

do $roles$
begin
  execute pg_catalog.format(
    'revoke pando_planning_router, pando_planning_worker, pando_phase1_api, '
    || 'pando_phase2_api, pando_mastery_worker, pando_review_worker, '
    || 'pando_readiness_worker from %I',
    current_user
  );
end
$roles$;
