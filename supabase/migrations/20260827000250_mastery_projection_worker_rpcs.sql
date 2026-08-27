-- Fixed service-only Evidence -> Mastery worker boundary. It never accepts a caller-selected
-- workspace, event, consumer name, input ledger, or arbitrary database operation.

do $migration_role_membership$
begin
  execute pg_catalog.format('grant pando_mastery_worker to %I with set true', current_user);
end
$migration_role_membership$;

grant create on schema outbox, mastery to pando_mastery_worker;
grant usage on schema outbox, evidence, mastery to service_role;

create function outbox.claim_mastery_evidence_projection_impl()
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
  payload jsonb
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
      last_failure_class = 'EXHAUSTED',
      last_error_code = 'LEASE_EXPIRED_AFTER_MAX_ATTEMPTS',
      last_failed_at = clock_timestamp(),
      dead_lettered_at = clock_timestamp()
  where exhausted.consumer_name = 'mastery.evidence_projection_v1'
    and exhausted.handler_contract_version = 1
    and exhausted.delivery_state = 'leased'
    and exhausted.lease_expires_at <= clock_timestamp()
    and exhausted.attempt_count >= 8;

  return query
  with candidates as (
    select delivery.delivery_id
    from outbox.deliveries as delivery
    where delivery.consumer_name = 'mastery.evidence_projection_v1'
      and delivery.handler_contract_version = 1
      and delivery.attempt_count < 8
      and delivery.available_at <= clock_timestamp()
      and (
        delivery.delivery_state in ('pending', 'retry')
        or (
          delivery.delivery_state = 'leased'
          and delivery.lease_expires_at <= clock_timestamp()
        )
      )
    order by delivery.available_at, delivery.delivery_id
    for update skip locked
    limit 5
  ), claimed as (
    update outbox.deliveries as delivery
    set delivery_state = 'leased',
        attempt_count = delivery.attempt_count + 1,
        lease_token = gen_random_uuid(),
        lease_expires_at = clock_timestamp() + interval '2 minutes',
        last_failure_class = null,
        last_error_code = null,
        last_failed_at = null
    from candidates
    where delivery.delivery_id = candidates.delivery_id
    returning delivery.*
  )
  select claimed.delivery_id, claimed.event_id, event.event_position, claimed.workspace_id,
    claimed.lease_token, claimed.lease_expires_at, claimed.attempt_count,
    event.event_name, event.event_schema_version, event.payload
  from claimed
  join outbox.events as event
    on event.workspace_id = claimed.workspace_id and event.event_id = claimed.event_id
  order by event.event_position, claimed.delivery_id;
end
$function$;

create function mastery.evidence_projection_event_v1_is_valid(
  p_event outbox.events
)
returns boolean
language sql
immutable
set search_path = ''
as $function$
  select (p_event).event_name in (
      'evidence.observation_appended', 'evidence.observation_invalidated'
    )
    and (p_event).event_schema_version = 1
    and (p_event).aggregate_type = 'evidence.subject_ledger'
    and (p_event).aggregate_id = (p_event).workspace_id
    and (p_event).aggregate_version is not null
    and (p_event).payload ? 'competency_ref'
    and (p_event).payload ? 'evidence_id'
    and (p_event).payload ? 'ledger_watermark'
    and ((p_event).payload->>'evidence_id') ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and ((p_event).payload->>'competency_ref') ~
      '^competency:[a-z0-9][a-z0-9-]{1,100}$'
    and ((p_event).payload->>'ledger_watermark') ~ '^[1-9][0-9]{0,18}$'
    and (p_event).aggregate_version::text = (p_event).payload->>'ledger_watermark'
    and (
      ((p_event).event_name = 'evidence.observation_appended'
       and not (p_event).payload ? 'correction_id')
      or
      ((p_event).event_name = 'evidence.observation_invalidated'
       and (p_event).payload ? 'correction_id'
       and ((p_event).payload->>'correction_id') ~
         '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
    )
    and not exists (
      select 1 from pg_catalog.jsonb_object_keys((p_event).payload) as payload_key(key)
      where payload_key.key not in (
        'correction_id', 'evidence_id', 'competency_ref', 'ledger_watermark'
      )
    )
$function$;

create function mastery.load_evidence_projection_input_impl(
  p_delivery_id uuid,
  p_lease_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_delivery outbox.deliveries%rowtype;
  v_event outbox.events%rowtype;
  v_watermark bigint;
  v_evidence jsonb;
begin
  select delivery.* into v_delivery
  from outbox.deliveries as delivery
  where delivery.delivery_id = p_delivery_id
    and delivery.consumer_name = 'mastery.evidence_projection_v1'
    and delivery.handler_contract_version = 1;
  if not found or v_delivery.delivery_state <> 'leased'
     or v_delivery.lease_token is distinct from p_lease_token
     or v_delivery.lease_expires_at <= clock_timestamp() then
    raise exception using errcode = '42501', message = 'mastery delivery lease is not valid';
  end if;
  select event.* into strict v_event
  from outbox.events as event
  where event.workspace_id = v_delivery.workspace_id and event.event_id = v_delivery.event_id;
  if not mastery.evidence_projection_event_v1_is_valid(v_event) then
    raise exception using errcode = '22023', message = 'mastery delivery event contract is invalid';
  end if;
  select ledger.ledger_version into strict v_watermark
  from evidence.subject_ledgers as ledger
  where ledger.workspace_id = v_delivery.workspace_id;

  select coalesce(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'evidenceId', observation.evidence_id,
      'attemptId', observation.activity_attempt_id,
      'sourceId', observation.source_id,
      'occurredAt', observation.occurred_at,
      'dimension', observation.dimension,
      'outcome', observation.outcome,
      'engagement', observation.engagement,
      'normalized', observation.normalized,
      'invalidated', correction.correction_id is not null,
      'observedResult', observation.observed_result,
      'mappingConfidence', observation.mapping_confidence,
      'sourceReliability', observation.source_reliability,
      'targetRelevant', observation.target_relevant
    ) order by observation.occurred_at, observation.evidence_id
  ), '[]'::jsonb)
  into v_evidence
  from evidence.observations as observation
  left join evidence.corrections as correction
    on correction.workspace_id = observation.workspace_id
   and correction.evidence_id = observation.evidence_id
  where observation.workspace_id = v_delivery.workspace_id
    and observation.competency_ref = v_event.payload->>'competency_ref';

  return pg_catalog.jsonb_build_object(
    'deliveryId', v_delivery.delivery_id,
    'eventId', v_delivery.event_id,
    'eventPosition', v_event.event_position::text,
    'workspaceId', v_delivery.workspace_id,
    'competencyId', v_event.payload->>'competency_ref',
    'inputWatermark', v_watermark::text,
    'evidence', v_evidence
  );
end
$function$;

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
  v_delivery outbox.deliveries%rowtype;
  v_event outbox.events%rowtype;
  v_current_watermark bigint;
  v_competency_ref text;
  v_snapshot_id uuid := gen_random_uuid();
  v_pointer_rows integer := 0;
begin
  perform 1 from outbox.consumer_receipts as receipt
  where receipt.delivery_id = p_delivery_id
    and receipt.consumer_name = 'mastery.evidence_projection_v1';
  if found then
    return true;
  end if;

  select delivery.* into v_delivery
  from outbox.deliveries as delivery
  where delivery.delivery_id = p_delivery_id
    and delivery.consumer_name = 'mastery.evidence_projection_v1'
    and delivery.handler_contract_version = 1
  for update;
  if not found or v_delivery.delivery_state <> 'leased'
     or v_delivery.lease_token is distinct from p_lease_token
     or v_delivery.lease_expires_at <= clock_timestamp() then
    raise exception using errcode = '42501', message = 'mastery delivery lease is not valid';
  end if;
  select event.* into strict v_event
  from outbox.events as event
  where event.workspace_id = v_delivery.workspace_id and event.event_id = v_delivery.event_id;
  if v_event.event_position <> p_expected_event_position
     or not mastery.evidence_projection_event_v1_is_valid(v_event) then
    raise exception using errcode = '22023', message = 'mastery event contract is invalid';
  end if;
  v_competency_ref := v_event.payload->>'competency_ref';
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    v_delivery.workspace_id::text || ':evidence-ledger', 4
  ));
  select ledger.ledger_version into strict v_current_watermark
  from evidence.subject_ledgers as ledger
  where ledger.workspace_id = v_delivery.workspace_id;
  if v_current_watermark <> p_expected_input_watermark then
    return false;
  end if;
  if p_state is null or pg_catalog.jsonb_typeof(p_state) <> 'object'
     or p_state->>'engineVersion' <> 'mastery-engine/0.1.0'
     or p_state->>'policyVersion' <> 'mastery-readiness-policy/0.1'
     or p_state->>'inputWatermark' <> p_expected_input_watermark::text
     or p_state->>'competencyId' <> v_competency_ref
     or p_state->>'achievementLevel' not in (
       'NOT_STARTED', 'COMPLETED', 'VERIFIED', 'MASTERED'
     )
     or pg_catalog.jsonb_typeof(p_state->'dimensions') <> 'object'
     or pg_catalog.jsonb_typeof(p_state->'supportingEvidenceIds') <> 'array'
     or pg_catalog.jsonb_typeof(p_state->'contradictingEvidenceIds') <> 'array'
     or pg_catalog.jsonb_typeof(p_state->'explanationCodes') <> 'array' then
    raise exception using errcode = '22023', message = 'mastery result contract is invalid';
  end if;

  insert into mastery.competency_state_snapshots (
    snapshot_id, workspace_id, competency_ref, projection_generation,
    input_watermark, engine_version,
    policy_version, calculated_as_of, achievement_level, state
  ) values (
    v_snapshot_id, v_delivery.workspace_id, v_competency_ref, 'live-v1',
    p_expected_input_watermark,
    p_state->>'engineVersion', p_state->>'policyVersion',
    (p_state->>'calculatedAsOf')::timestamptz, p_state->>'achievementLevel', p_state
  )
  on conflict (
    workspace_id, competency_ref, engine_version, policy_version,
    projection_generation, input_watermark
  ) do nothing;
  select snapshot.snapshot_id into strict v_snapshot_id
  from mastery.competency_state_snapshots as snapshot
  where snapshot.workspace_id = v_delivery.workspace_id
    and snapshot.competency_ref = v_competency_ref
    and snapshot.engine_version = p_state->>'engineVersion'
    and snapshot.policy_version = p_state->>'policyVersion'
    and snapshot.projection_generation = 'live-v1'
    and snapshot.input_watermark = p_expected_input_watermark;

  insert into mastery.current_competency_states (
    workspace_id, competency_ref, snapshot_id, input_watermark
  ) values (
    v_delivery.workspace_id, v_competency_ref, v_snapshot_id, p_expected_input_watermark
  )
  on conflict (workspace_id, competency_ref) do update
  set snapshot_id = excluded.snapshot_id,
      input_watermark = excluded.input_watermark,
      projection_version = mastery.current_competency_states.projection_version + 1,
      updated_at = clock_timestamp()
  where mastery.current_competency_states.input_watermark < excluded.input_watermark;
  get diagnostics v_pointer_rows = row_count;

  if v_pointer_rows > 0 then
    insert into outbox.events (
      event_name, event_schema_version, workspace_id, actor_type, actor_user_id,
      command_id, correlation_id, causation_id, occurred_at, source, payload
    ) values (
      'mastery.competency_state_changed', 1, v_delivery.workspace_id, 'system', null,
      v_event.command_id, v_event.correlation_id, v_event.event_id, clock_timestamp(),
      'pando.mastery_worker', pg_catalog.jsonb_build_object(
        'competency_ref', v_competency_ref,
        'snapshot_id', v_snapshot_id,
        'projection_generation', 'live-v1',
        'input_watermark', p_expected_input_watermark::text,
        'achievement_level', p_state->>'achievementLevel',
        'engine_version', p_state->>'engineVersion',
        'policy_version', p_state->>'policyVersion',
        'calculated_as_of', p_state->>'calculatedAsOf'
      )
    );
  end if;

  insert into outbox.consumer_receipts (
    delivery_id, event_id, workspace_id, consumer_name, handler_contract_version,
    input_event_position, lease_token
  ) values (
    v_delivery.delivery_id, v_delivery.event_id, v_delivery.workspace_id,
    'mastery.evidence_projection_v1', 1, v_event.event_position, p_lease_token
  );
  update outbox.deliveries
  set delivery_state = 'succeeded', lease_token = null, lease_expires_at = null,
      completed_at = clock_timestamp()
  where delivery_id = v_delivery.delivery_id;
  return true;
end
$function$;

create function outbox.fail_mastery_evidence_projection_impl(
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
  v_next_state text;
  v_base_delay_seconds integer;
  v_retry_delay_seconds integer;
begin
  if p_failure_class not in ('TRANSIENT', 'STALE_INPUT', 'INVALID_CONTRACT')
     or p_error_code is null or p_error_code !~ '^[A-Z][A-Z0-9_]{1,63}$' then
    raise exception using errcode = '22023', message = 'worker failure input is invalid';
  end if;
  select delivery.* into v_delivery
  from outbox.deliveries as delivery
  where delivery.delivery_id = p_delivery_id
    and delivery.consumer_name = 'mastery.evidence_projection_v1'
    and delivery.handler_contract_version = 1
  for update;
  if not found or v_delivery.delivery_state <> 'leased'
     or v_delivery.lease_token is distinct from p_lease_token then
    raise exception using errcode = '42501', message = 'mastery delivery lease is not valid';
  end if;
  v_next_state := case
    when p_failure_class = 'INVALID_CONTRACT' or v_delivery.attempt_count >= 8
      then 'dead_letter'
    else 'retry'
  end;
  v_base_delay_seconds := least(
    900,
    (5 * pg_catalog.power(2, greatest(v_delivery.attempt_count - 1, 0)))::integer
  );
  v_retry_delay_seconds := least(
    900,
    v_base_delay_seconds
      + pg_catalog.floor(pg_catalog.random() * greatest(1, v_base_delay_seconds / 5.0))::integer
  );
  update outbox.deliveries
  set delivery_state = v_next_state,
      available_at = case when v_next_state = 'retry'
        then clock_timestamp() + pg_catalog.make_interval(secs => v_retry_delay_seconds)
        else available_at end,
      lease_token = null,
      lease_expires_at = null,
      last_failure_class = p_failure_class,
      last_error_code = p_error_code,
      last_failed_at = clock_timestamp(),
      dead_lettered_at = case when v_next_state = 'dead_letter' then clock_timestamp() end
  where delivery_id = v_delivery.delivery_id;
  return v_next_state;
end
$function$;

create function outbox.get_mastery_projection_health_impl()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'states', coalesce((
      select pg_catalog.jsonb_object_agg(state.delivery_state, state.delivery_count)
      from (
        select delivery.delivery_state, count(*) as delivery_count
        from outbox.deliveries as delivery
        where delivery.consumer_name = 'mastery.evidence_projection_v1'
        group by delivery.delivery_state
        order by delivery.delivery_state
      ) as state
    ), '{}'::jsonb),
    'failures', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'failureClass', failure.last_failure_class,
        'errorCode', failure.last_error_code,
        'deliveryState', failure.delivery_state,
        'count', failure.delivery_count
      ) order by failure.last_failure_class, failure.last_error_code, failure.delivery_state)
      from (
        select delivery.last_failure_class, delivery.last_error_code,
          delivery.delivery_state, count(*) as delivery_count
        from outbox.deliveries as delivery
        where delivery.consumer_name = 'mastery.evidence_projection_v1'
          and delivery.last_error_code is not null
        group by delivery.last_failure_class, delivery.last_error_code, delivery.delivery_state
      ) as failure
    ), '[]'::jsonb)
  )
$function$;

alter function outbox.claim_mastery_evidence_projection_impl() owner to pando_mastery_worker;
alter function mastery.evidence_projection_event_v1_is_valid(outbox.events)
  owner to pando_mastery_worker;
alter function mastery.load_evidence_projection_input_impl(uuid, uuid)
  owner to pando_mastery_worker;
alter function mastery.complete_evidence_projection_impl(uuid, uuid, bigint, bigint, jsonb)
  owner to pando_mastery_worker;
alter function outbox.fail_mastery_evidence_projection_impl(uuid, uuid, text, text)
  owner to pando_mastery_worker;
alter function outbox.get_mastery_projection_health_impl() owner to pando_mastery_worker;

revoke all on function outbox.claim_mastery_evidence_projection_impl(),
  mastery.evidence_projection_event_v1_is_valid(outbox.events),
  mastery.load_evidence_projection_input_impl(uuid, uuid),
  mastery.complete_evidence_projection_impl(uuid, uuid, bigint, bigint, jsonb),
  outbox.fail_mastery_evidence_projection_impl(uuid, uuid, text, text),
  outbox.get_mastery_projection_health_impl()
  from public, anon, authenticated, service_role;
grant execute on function outbox.claim_mastery_evidence_projection_impl(),
  mastery.load_evidence_projection_input_impl(uuid, uuid),
  mastery.complete_evidence_projection_impl(uuid, uuid, bigint, bigint, jsonb),
  outbox.fail_mastery_evidence_projection_impl(uuid, uuid, text, text),
  outbox.get_mastery_projection_health_impl()
  to service_role;

create function api.claim_mastery_evidence_projection_v1()
returns table (
  delivery_id uuid, event_id uuid, event_position bigint, workspace_id uuid,
  lease_token uuid, lease_expires_at timestamptz, attempt_count smallint,
  event_name text, event_schema_version smallint, payload jsonb
)
language sql security invoker set search_path = ''
as $function$
  select * from outbox.claim_mastery_evidence_projection_impl()
$function$;

create function api.load_mastery_evidence_projection_v1(p_delivery_id uuid, p_lease_token uuid)
returns jsonb language sql stable security invoker set search_path = ''
as $function$
  select mastery.load_evidence_projection_input_impl(p_delivery_id, p_lease_token)
$function$;

create function api.complete_mastery_evidence_projection_v1(
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

create function api.fail_mastery_evidence_projection_v1(
  p_delivery_id uuid, p_lease_token uuid, p_failure_class text, p_error_code text
)
returns text language sql security invoker set search_path = ''
as $function$
  select outbox.fail_mastery_evidence_projection_impl(
    p_delivery_id, p_lease_token, p_failure_class, p_error_code
  )
$function$;

create function api.get_mastery_projection_health_v1()
returns jsonb language sql stable security invoker set search_path = ''
as $function$
  select outbox.get_mastery_projection_health_impl()
$function$;

revoke all on function api.claim_mastery_evidence_projection_v1(),
  api.load_mastery_evidence_projection_v1(uuid, uuid),
  api.complete_mastery_evidence_projection_v1(uuid, uuid, bigint, bigint, jsonb),
  api.fail_mastery_evidence_projection_v1(uuid, uuid, text, text),
  api.get_mastery_projection_health_v1()
  from public, anon, authenticated, service_role;
grant execute on function api.claim_mastery_evidence_projection_v1(),
  api.load_mastery_evidence_projection_v1(uuid, uuid),
  api.complete_mastery_evidence_projection_v1(uuid, uuid, bigint, bigint, jsonb),
  api.fail_mastery_evidence_projection_v1(uuid, uuid, text, text),
  api.get_mastery_projection_health_v1()
  to service_role;

revoke create on schema outbox, mastery from pando_mastery_worker;
do $migration_role_membership$
begin
  execute pg_catalog.format('revoke pando_mastery_worker from %I', current_user);
end
$migration_role_membership$;
