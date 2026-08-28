-- Durable Phase 4A Planning snapshot projection worker.

do $membership$
begin
  execute pg_catalog.format('grant pando_planning_worker to %I with set true', current_user);
end
$membership$;

grant create on schema planning, outbox, api to pando_planning_worker;
grant usage on schema planning, outbox, api, identity, extensions to pando_planning_worker;
grant usage on schema planning to service_role;

create table planning.plan_snapshot_attempts (
  attempt_id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references identity.workspaces (workspace_id) on delete restrict,
  delivery_id uuid not null,
  event_id uuid not null,
  event_position bigint not null,
  consumer_name text not null default 'planning.plan_snapshot_v1',
  handler_contract_version smallint not null default 1,
  generation smallint not null,
  attempt_state text not null default 'LOADING',
  claim_as_of timestamptz not null,
  base_pointer_version bigint not null,
  scheduled_source_snapshot_id uuid,
  source_fence text,
  normalized_input jsonb,
  input_fingerprint text,
  valid_until timestamptz,
  covered_delivery_ids uuid[],
  applied_pointer_version bigint,
  failure_class text,
  error_code text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint plan_snapshot_attempt_delivery_fk foreign key (
    delivery_id, event_id, workspace_id, consumer_name, handler_contract_version
  ) references outbox.deliveries (
    delivery_id, event_id, workspace_id, consumer_name, handler_contract_version
  ) on delete restrict,
  constraint plan_snapshot_attempt_consumer_check check (
    consumer_name = 'planning.plan_snapshot_v1' and handler_contract_version = 1
  ),
  constraint plan_snapshot_attempt_generation_check check (generation between 1 and 8),
  constraint plan_snapshot_attempt_position_check check (event_position > 0),
  constraint plan_snapshot_attempt_pointer_check check (base_pointer_version >= 0),
  constraint plan_snapshot_attempt_state_check check (
    attempt_state in ('LOADING', 'READY', 'APPLIED', 'FAILED', 'SUPERSEDED')
  ),
  constraint plan_snapshot_attempt_fingerprint_check check (
    input_fingerprint is null or input_fingerprint ~ '^planning-input:[a-f0-9]{64}$'
  ),
  constraint plan_snapshot_attempt_ready_shape_check check (
    (attempt_state in ('LOADING', 'FAILED', 'SUPERSEDED') and (
      (source_fence is null and normalized_input is null and input_fingerprint is null
        and valid_until is null and covered_delivery_ids is null)
      or
      (source_fence is not null and normalized_input is not null and input_fingerprint is not null
        and valid_until is not null and covered_delivery_ids is not null)
    ))
    or
    (attempt_state in ('READY', 'APPLIED') and source_fence is not null and normalized_input is not null
      and input_fingerprint is not null and valid_until is not null
      and covered_delivery_ids is not null)
  ),
  constraint plan_snapshot_attempt_failure_check check (
    (attempt_state = 'FAILED' and failure_class is not null and error_code is not null)
    or (attempt_state <> 'FAILED')
  ),
  unique (workspace_id, attempt_id),
  unique (delivery_id, generation)
);

create unique index one_active_plan_snapshot_attempt_per_delivery
  on planning.plan_snapshot_attempts (delivery_id)
  where attempt_state in ('LOADING', 'READY');

create table planning.plan_snapshot_delivery_ledger (
  delivery_id uuid primary key,
  event_id uuid not null,
  workspace_id uuid not null,
  consumer_name text not null default 'planning.plan_snapshot_v1',
  handler_contract_version smallint not null default 1,
  coverage_state text not null default 'UNCOVERED',
  covered_by_pointer_version bigint,
  covered_by_attempt_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint plan_snapshot_delivery_ledger_fk foreign key (
    delivery_id, event_id, workspace_id, consumer_name, handler_contract_version
  ) references outbox.deliveries (
    delivery_id, event_id, workspace_id, consumer_name, handler_contract_version
  ) on delete restrict,
  constraint plan_snapshot_delivery_ledger_consumer_check check (
    consumer_name = 'planning.plan_snapshot_v1' and handler_contract_version = 1
  ),
  constraint plan_snapshot_delivery_ledger_state_check check (
    coverage_state in ('UNCOVERED', 'COVERED', 'SUPERSEDED')
  ),
  constraint plan_snapshot_delivery_ledger_shape_check check (
    (coverage_state = 'UNCOVERED' and covered_by_pointer_version is null
      and covered_by_attempt_id is null)
    or
    (coverage_state in ('COVERED', 'SUPERSEDED') and covered_by_pointer_version is not null
      and covered_by_attempt_id is not null)
  ),
  constraint plan_snapshot_delivery_ledger_attempt_fk foreign key (
    workspace_id, covered_by_attempt_id
  ) references planning.plan_snapshot_attempts (workspace_id, attempt_id) on delete restrict
);

create table planning.plan_action_selections (
  selection_id uuid primary key default gen_random_uuid(),
  selection_ref text not null unique,
  workspace_id uuid not null references identity.workspaces (workspace_id) on delete restrict,
  snapshot_id uuid not null,
  attempt_id uuid not null,
  rank smallint not null,
  candidate_key text not null,
  action_kind text not null,
  readiness_goal_key text not null,
  activity_key text not null,
  learning_track_id uuid,
  focus_session_id uuid,
  planned_minutes smallint not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint plan_action_selection_snapshot_fk foreign key (workspace_id, snapshot_id)
    references planning.plan_snapshots (workspace_id, snapshot_id) on delete restrict,
  constraint plan_action_selection_attempt_fk foreign key (workspace_id, attempt_id)
    references planning.plan_snapshot_attempts (workspace_id, attempt_id) on delete restrict,
  constraint plan_action_selection_track_fk foreign key (workspace_id, learning_track_id)
    references planning.learning_tracks (workspace_id, learning_track_id) on delete restrict,
  constraint plan_action_selection_ref_check check (
    selection_ref = 'plan-action:' || selection_id::text
  ),
  constraint plan_action_selection_rank_check check (rank between 1 and 5),
  constraint plan_action_selection_candidate_check check (
    candidate_key ~ '^(candidate|active-focus):[a-z0-9][a-z0-9:-]{1,150}$'
  ),
  constraint plan_action_selection_kind_check check (action_kind in ('START', 'RESUME')),
  constraint plan_action_selection_goal_check check (
    readiness_goal_key ~ '^goal:[a-z0-9][a-z0-9-]{1,100}$'
  ),
  constraint plan_action_selection_activity_check check (
    activity_key ~ '^activity:[a-z0-9][a-z0-9-]{1,100}$'
  ),
  constraint plan_action_selection_minutes_check check (planned_minutes between 1 and 480),
  constraint plan_action_selection_action_shape_check check (
    (action_kind = 'START' and focus_session_id is null)
    or (action_kind = 'RESUME' and focus_session_id is not null)
  ),
  unique (workspace_id, snapshot_id, rank),
  unique (workspace_id, snapshot_id, candidate_key)
);

alter table planning.current_plan_snapshots
  add constraint current_plan_snapshot_attempt_fk
  foreign key (workspace_id, applied_attempt_id)
  references planning.plan_snapshot_attempts (workspace_id, attempt_id)
  on delete restrict;

do $rls$
declare
  table_name text;
begin
  foreach table_name in array array[
    'planning.plan_snapshot_attempts',
    'planning.plan_snapshot_delivery_ledger',
    'planning.plan_action_selections'
  ] loop
    execute 'alter table ' || table_name || ' enable row level security';
    execute 'alter table ' || table_name || ' force row level security';
    execute 'revoke all on table ' || table_name ||
      ' from public, anon, authenticated, service_role';
  end loop;
end
$rls$;

grant select, insert, update on planning.plan_snapshot_attempts,
  planning.plan_snapshot_delivery_ledger to pando_planning_worker;
grant select, insert on planning.plan_action_selections, planning.plan_snapshots
  to pando_planning_worker;
grant select, update on planning.current_plan_snapshots to pando_planning_worker;
grant select on planning.growth_plans, planning.learning_tracks,
  planning.learning_track_activities to pando_planning_worker;
grant select, insert, update on outbox.deliveries to pando_planning_worker;
grant select, insert on outbox.events, outbox.consumer_receipts to pando_planning_worker;
grant usage, select on sequence outbox.events_event_position_seq to pando_planning_worker;
grant select on planning.plan_action_selections to pando_planning_api;

create policy plan_snapshot_attempts_worker on planning.plan_snapshot_attempts
for all to pando_planning_worker using (true) with check (true);
create policy plan_snapshot_delivery_ledger_worker on planning.plan_snapshot_delivery_ledger
for all to pando_planning_worker using (true) with check (true);
create policy plan_action_selections_worker on planning.plan_action_selections
for all to pando_planning_worker using (true) with check (true);
create policy plan_action_selections_planning_api on planning.plan_action_selections
for select to pando_planning_api using (identity.is_workspace_member(workspace_id));
create policy planning_worker_growth_plans on planning.growth_plans
for select to pando_planning_worker using (true);
create policy planning_worker_learning_tracks on planning.learning_tracks
for select to pando_planning_worker using (true);
create policy planning_worker_track_activities on planning.learning_track_activities
for select to pando_planning_worker using (true);
create policy planning_worker_plan_snapshots on planning.plan_snapshots
for all to pando_planning_worker using (true) with check (true);
create policy planning_worker_current_plan_snapshots on planning.current_plan_snapshots
for all to pando_planning_worker using (true) with check (true);
create policy planning_worker_events on outbox.events
for all to pando_planning_worker using (true) with check (
  workspace_id is not null and source in ('pando.database', 'pando.planning_worker')
);
create policy planning_worker_deliveries on outbox.deliveries
for all to pando_planning_worker using (
  consumer_name = 'planning.plan_snapshot_v1'
) with check (consumer_name = 'planning.plan_snapshot_v1');
create policy planning_worker_receipts on outbox.consumer_receipts
for all to pando_planning_worker using (
  consumer_name = 'planning.plan_snapshot_v1'
) with check (consumer_name = 'planning.plan_snapshot_v1');

create function planning.guard_plan_snapshot_attempt_mutation()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = 'plan snapshot attempts cannot be deleted';
  end if;
  if new.attempt_id <> old.attempt_id or new.workspace_id <> old.workspace_id
     or new.delivery_id <> old.delivery_id or new.event_id <> old.event_id
     or new.event_position <> old.event_position or new.generation <> old.generation
     or new.claim_as_of <> old.claim_as_of or new.base_pointer_version <> old.base_pointer_version
     or new.scheduled_source_snapshot_id is distinct from old.scheduled_source_snapshot_id
     or (old.normalized_input is not null and (
       new.normalized_input is distinct from old.normalized_input
       or new.input_fingerprint is distinct from old.input_fingerprint
       or new.valid_until is distinct from old.valid_until
       or new.source_fence is distinct from old.source_fence
       or new.covered_delivery_ids is distinct from old.covered_delivery_ids
     )) then
    raise exception using errcode = '55000', message = 'plan snapshot attempt provenance is immutable';
  end if;
  return new;
end
$function$;

create trigger guard_plan_snapshot_attempt_mutation
before update or delete on planning.plan_snapshot_attempts
for each row execute function planning.guard_plan_snapshot_attempt_mutation();

create trigger plan_action_selections_are_immutable
before update or delete on planning.plan_action_selections
for each row execute function planning.reject_plan_snapshot_mutation();

create function planning.record_plan_snapshot_delivery_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.consumer_name = 'planning.plan_snapshot_v1' and new.handler_contract_version = 1 then
    insert into planning.plan_snapshot_delivery_ledger (
      delivery_id, event_id, workspace_id, consumer_name, handler_contract_version
    ) values (
      new.delivery_id, new.event_id, new.workspace_id, new.consumer_name,
      new.handler_contract_version
    ) on conflict (delivery_id) do nothing;
  end if;
  return new;
end
$function$;

alter function planning.record_plan_snapshot_delivery_v1() owner to pando_planning_worker;

insert into planning.plan_snapshot_delivery_ledger (
  delivery_id, event_id, workspace_id, consumer_name, handler_contract_version
)
select delivery.delivery_id, delivery.event_id, delivery.workspace_id,
  delivery.consumer_name, delivery.handler_contract_version
from outbox.deliveries as delivery
where delivery.consumer_name = 'planning.plan_snapshot_v1'
  and delivery.handler_contract_version = 1
on conflict (delivery_id) do nothing;

create trigger record_plan_snapshot_delivery
after insert on outbox.deliveries
for each row execute function planning.record_plan_snapshot_delivery_v1();

create function planning.stable_plan_uuid_v1(p_scope text)
returns uuid
language sql
immutable
strict
set search_path = ''
as $function$
  with hash as (select pg_catalog.md5(p_scope) as value)
  select (
    pg_catalog.substr(value, 1, 8) || '-' || pg_catalog.substr(value, 9, 4) || '-5' ||
    pg_catalog.substr(value, 14, 3) || '-a' || pg_catalog.substr(value, 18, 3) || '-' ||
    pg_catalog.substr(value, 21, 12)
  )::uuid from hash
$function$;

create function planning.load_plan_snapshot_source_bundle_v1(
  p_workspace_id uuid,
  p_claim_as_of timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_plan planning.growth_plans%rowtype;
  v_calendar jsonb;
  v_tracks jsonb := '[]'::jsonb;
  v_activities jsonb := '[]'::jsonb;
  v_goal_ids uuid[] := array[]::uuid[];
  v_profile_ids uuid[] := array[]::uuid[];
  v_activity_ids uuid[] := array[]::uuid[];
  v_targets jsonb := pg_catalog.jsonb_build_object('items', '[]'::jsonb);
  v_overlay jsonb;
  v_catalog_ids uuid[] := array[]::uuid[];
  v_competencies text[] := array[]::text[];
  v_catalog jsonb := pg_catalog.jsonb_build_object('versions', '[]'::jsonb, 'items', '[]'::jsonb);
  v_focus jsonb;
  v_mastery jsonb;
  v_review jsonb;
  v_visible jsonb;
  v_bundle jsonb;
  v_fence text;
  v_activity jsonb;
  v_target jsonb;
  v_overlay_item jsonb;
begin
  if p_workspace_id is null or p_claim_as_of is null then
    raise exception using errcode = '22023', message = 'planning source bundle input is invalid';
  end if;
  v_calendar := identity.read_planning_calendar_source_v1(p_workspace_id, p_claim_as_of);
  select plan.* into v_plan from planning.growth_plans as plan
  where plan.workspace_id = p_workspace_id and plan.lifecycle in ('active', 'paused');
  if found then
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'trackId', track.learning_track_id,
      'trackKey', track.track_key,
      'title', track.title,
      'version', track.aggregate_version::text,
      'readinessGoalId', track.readiness_goal_id,
      'profileVersionId', track.profile_version_id,
      'lifecycle', pg_catalog.upper(track.lifecycle),
      'priority', track.priority,
      'protectedMinimumMinutes', track.protected_minimum_minutes,
      'defaultSessionMinutes', track.default_session_minutes
    ) order by track.track_key collate "C"), '[]'::jsonb),
      coalesce(pg_catalog.array_agg(track.readiness_goal_id order by track.track_key collate "C"), array[]::uuid[]),
      coalesce(pg_catalog.array_agg(track.profile_version_id order by track.track_key collate "C"), array[]::uuid[])
    into v_tracks, v_goal_ids, v_profile_ids
    from planning.learning_tracks as track
    where track.workspace_id = p_workspace_id and track.growth_plan_id = v_plan.growth_plan_id
      and track.lifecycle <> 'archived';
    if pg_catalog.jsonb_array_length(v_tracks) > 30 then
      raise exception using errcode = '54000', message = 'planning Track source exceeds 30 tracks';
    end if;
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'trackId', activity.learning_track_id,
      'customActivityId', activity.custom_activity_id,
      'candidateKey', activity.candidate_key,
      'estimatedMinutes', activity.estimated_minutes,
      'energy', activity.energy,
      'version', activity.aggregate_version::text
    ) order by activity.candidate_key collate "C"), '[]'::jsonb),
      coalesce(pg_catalog.array_agg(activity.custom_activity_id
        order by activity.candidate_key collate "C"), array[]::uuid[])
    into v_activities, v_activity_ids
    from planning.learning_track_activities as activity
    where activity.workspace_id = p_workspace_id and activity.growth_plan_id = v_plan.growth_plan_id
      and activity.lifecycle = 'active';
    if pg_catalog.jsonb_array_length(v_activities) > 200 then
      raise exception using errcode = '54000', message = 'planning candidate source exceeds 200 items';
    end if;
    v_targets := targets.read_planning_readiness_source_v1(
      p_workspace_id, v_goal_ids, v_profile_ids, p_claim_as_of
    );
  end if;
  v_overlay := overlay.read_planning_candidate_source_v1(p_workspace_id, v_activity_ids);

  for v_activity in select value from pg_catalog.jsonb_array_elements(v_activities) loop
    select value into strict v_overlay_item
    from pg_catalog.jsonb_array_elements(v_overlay->'items')
    where value->>'customActivityId' = v_activity->>'customActivityId';
    select target_item.value into strict v_target
    from pg_catalog.jsonb_array_elements(v_targets->'items') as target_item(value)
    join lateral (
      select track.value from pg_catalog.jsonb_array_elements(v_tracks) as track(value)
      where track.value->>'trackId' = v_activity->>'trackId'
    ) as matched_track
      on target_item.value->>'readinessGoalId' = matched_track.value->>'readinessGoalId';
    v_catalog_ids := pg_catalog.array_append(v_catalog_ids, (v_target->>'catalogVersionId')::uuid);
    v_competencies := pg_catalog.array_append(v_competencies,
      v_overlay_item->>'targetCompetencyRef');
  end loop;
  if pg_catalog.cardinality(v_catalog_ids) > 0 then
    v_catalog := catalog.read_planning_graph_source_v1(v_catalog_ids, v_competencies);
  end if;
  v_focus := sessions.read_planning_focus_source_v1(
    p_workspace_id, (v_calendar->>'weekStart')::timestamptz,
    (v_calendar->>'weekEnd')::timestamptz, p_claim_as_of
  );
  v_mastery := mastery.read_planning_mastery_source_v1(p_workspace_id, v_competencies);
  v_review := review.read_planning_review_source_v1(
    p_workspace_id, v_calendar->>'timeZone', p_claim_as_of
  );
  select coalesce(pg_catalog.jsonb_agg(delivery.delivery_id order by delivery.delivery_id), '[]'::jsonb)
  into v_visible
  from outbox.deliveries as delivery
  join planning.plan_snapshot_delivery_ledger as ledger
    on ledger.delivery_id = delivery.delivery_id and ledger.coverage_state = 'UNCOVERED'
  where delivery.workspace_id = p_workspace_id
    and delivery.consumer_name = 'planning.plan_snapshot_v1'
    and delivery.handler_contract_version = 1
    and delivery.available_at <= p_claim_as_of
    and delivery.delivery_state in ('pending', 'retry', 'leased');
  v_bundle := pg_catalog.jsonb_build_object(
    'claimAsOf', p_claim_as_of,
    'calendar', v_calendar,
    'plan', case when v_plan.growth_plan_id is null then null else pg_catalog.jsonb_build_object(
      'growthPlanId', v_plan.growth_plan_id,
      'title', v_plan.title,
      'lifecycle', pg_catalog.upper(v_plan.lifecycle),
      'weeklyCapacityMinutes', v_plan.weekly_capacity_minutes,
      'version', v_plan.aggregate_version::text,
      'tracks', v_tracks,
      'activities', v_activities
    ) end,
    'targets', v_targets,
    'overlay', v_overlay,
    'catalog', v_catalog,
    'focus', v_focus,
    'mastery', v_mastery,
    'review', v_review,
    'visibleDeliveryIds', v_visible
  );
  v_fence := pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to(v_bundle::text, 'UTF8'), 'sha256'
  ), 'hex');
  return v_bundle || pg_catalog.jsonb_build_object('sourceFence', 'planning-source:' || v_fence);
end
$function$;

create function outbox.claim_plan_snapshot_projection_impl()
returns table (
  delivery_id uuid, event_id uuid, event_position bigint, workspace_id uuid,
  lease_token uuid, lease_expires_at timestamptz, attempt_count smallint,
  attempt_id uuid, generation smallint, claim_as_of timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_claim outbox.deliveries%rowtype;
  v_event outbox.events%rowtype;
  v_attempt planning.plan_snapshot_attempts%rowtype;
  v_generation smallint;
  v_pointer_version bigint;
  v_claim_clock timestamptz;
begin
  with exhausted as (
    update outbox.deliveries as delivery
    set delivery_state = 'dead_letter', lease_token = null, lease_expires_at = null,
        last_failure_class = 'EXHAUSTED', last_error_code = 'LEASE_EXPIRED_AFTER_MAX_ATTEMPTS',
        last_failed_at = clock_timestamp(), dead_lettered_at = clock_timestamp()
    where delivery.consumer_name = 'planning.plan_snapshot_v1'
      and delivery.handler_contract_version = 1 and delivery.delivery_state = 'leased'
      and delivery.lease_expires_at <= clock_timestamp() and delivery.attempt_count >= 8
    returning delivery.delivery_id
  )
  update planning.plan_snapshot_attempts as attempt
  set attempt_state = 'FAILED', failure_class = 'EXHAUSTED',
      error_code = 'LEASE_EXPIRED_AFTER_MAX_ATTEMPTS', updated_at = clock_timestamp()
  from exhausted
  where attempt.delivery_id = exhausted.delivery_id
    and attempt.attempt_state in ('LOADING', 'READY');

  for v_claim in
    with due as (
      select delivery.delivery_id,
        pg_catalog.row_number() over (partition by delivery.workspace_id order by
          delivery.available_at, event.event_position, delivery.delivery_id) as workspace_rank
      from outbox.deliveries as delivery
      join outbox.events as event on event.event_id = delivery.event_id
        and event.workspace_id = delivery.workspace_id
      join planning.plan_snapshot_delivery_ledger as ledger
        on ledger.delivery_id = delivery.delivery_id and ledger.coverage_state = 'UNCOVERED'
      where delivery.consumer_name = 'planning.plan_snapshot_v1'
        and delivery.handler_contract_version = 1 and delivery.attempt_count < 8
        and delivery.available_at <= clock_timestamp()
        and (delivery.delivery_state in ('pending', 'retry') or
          (delivery.delivery_state = 'leased' and delivery.lease_expires_at <= clock_timestamp()))
        and not exists (
          select 1 from outbox.deliveries as active_delivery
          where active_delivery.workspace_id = delivery.workspace_id
            and active_delivery.consumer_name = 'planning.plan_snapshot_v1'
            and active_delivery.handler_contract_version = 1
            and active_delivery.delivery_state = 'leased'
            and active_delivery.lease_expires_at > clock_timestamp()
        )
    ), candidates as (
      select delivery.delivery_id from outbox.deliveries as delivery
      join due on due.delivery_id = delivery.delivery_id and due.workspace_rank = 1
      join outbox.events as event on event.event_id = delivery.event_id
      order by delivery.available_at, event.event_position, delivery.delivery_id
      for update of delivery skip locked limit 5
    )
    update outbox.deliveries as delivery
    set delivery_state = 'leased', attempt_count = delivery.attempt_count + 1,
      lease_token = gen_random_uuid(), lease_expires_at = clock_timestamp() + interval '2 minutes',
      last_failure_class = null, last_error_code = null, last_failed_at = null
    from candidates where delivery.delivery_id = candidates.delivery_id
    returning delivery.*
  loop
    v_claim_clock := clock_timestamp();
    select event.* into strict v_event from outbox.events as event
    where event.event_id = v_claim.event_id and event.workspace_id = v_claim.workspace_id;
    select attempt.* into v_attempt from planning.plan_snapshot_attempts as attempt
    where attempt.delivery_id = v_claim.delivery_id
      and attempt.attempt_state in ('LOADING', 'READY')
    order by attempt.generation desc limit 1 for update;
    if found and (v_attempt.attempt_state = 'LOADING' or v_attempt.valid_until < v_claim_clock) then
      update planning.plan_snapshot_attempts as superseded set attempt_state = 'SUPERSEDED',
        updated_at = clock_timestamp() where superseded.attempt_id = v_attempt.attempt_id;
      v_attempt.attempt_id := null;
    end if;
    if v_attempt.attempt_id is null then
      select coalesce(max(attempt.generation), 0) + 1 into v_generation
      from planning.plan_snapshot_attempts as attempt where attempt.delivery_id = v_claim.delivery_id;
      select pointer.pointer_version into strict v_pointer_version
      from planning.current_plan_snapshots as pointer
      where pointer.workspace_id = v_claim.workspace_id;
      insert into planning.plan_snapshot_attempts (
        workspace_id, delivery_id, event_id, event_position, generation, claim_as_of,
        base_pointer_version, scheduled_source_snapshot_id
      ) values (
        v_claim.workspace_id, v_claim.delivery_id, v_claim.event_id, v_event.event_position,
        v_generation, v_claim_clock, v_pointer_version,
        case when v_event.event_name = 'planning.snapshot_refresh_scheduled'
          then (v_event.payload->>'source_snapshot_id')::uuid end
      ) returning * into v_attempt;
    end if;
    delivery_id := v_claim.delivery_id; event_id := v_claim.event_id;
    event_position := v_event.event_position; workspace_id := v_claim.workspace_id;
    lease_token := v_claim.lease_token; lease_expires_at := v_claim.lease_expires_at;
    attempt_count := v_claim.attempt_count; attempt_id := v_attempt.attempt_id;
    generation := v_attempt.generation; claim_as_of := v_attempt.claim_as_of;
    return next;
  end loop;
end
$function$;

create function planning.plan_snapshot_event_is_valid_v1(p_event outbox.events)
returns boolean
language sql
immutable
set search_path = ''
as $function$
  select case (p_event).event_name
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
      and ((p_event).payload->>'valid_until')::timestamptz is not null
      and ((p_event).payload->>'scheduled_for')::timestamptz =
        ((p_event).payload->>'valid_until')::timestamptz + interval '1 millisecond'
      and not exists (
        select 1 from pg_catalog.jsonb_object_keys((p_event).payload) as key(value)
        where key.value not in ('workspace_id', 'source_snapshot_id', 'input_fingerprint',
          'valid_until', 'scheduled_for')
      )
    else false
  end
$function$;

create function planning.load_plan_snapshot_projection_impl(
  p_delivery_id uuid, p_lease_token uuid, p_attempt_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_delivery outbox.deliveries%rowtype;
  v_event outbox.events%rowtype;
  v_attempt planning.plan_snapshot_attempts%rowtype;
  v_bundle jsonb;
  v_generation smallint;
  v_pointer_version bigint;
begin
  select delivery.* into v_delivery from outbox.deliveries as delivery
  where delivery.delivery_id = p_delivery_id
    and delivery.consumer_name = 'planning.plan_snapshot_v1'
    and delivery.handler_contract_version = 1 for update;
  if not found or v_delivery.delivery_state <> 'leased'
     or v_delivery.lease_token is distinct from p_lease_token
     or v_delivery.lease_expires_at <= clock_timestamp() then
    raise exception using errcode = '42501', message = 'planning delivery lease is not valid';
  end if;
  select event.* into strict v_event from outbox.events as event
  where event.event_id = v_delivery.event_id and event.workspace_id = v_delivery.workspace_id;
  if not planning.plan_snapshot_event_is_valid_v1(v_event) then
    raise exception using errcode = '22023', message = 'planning delivery event contract is invalid';
  end if;
  select attempt.* into strict v_attempt from planning.plan_snapshot_attempts as attempt
  where attempt.attempt_id = p_attempt_id and attempt.delivery_id = p_delivery_id
    and attempt.attempt_state in ('LOADING', 'READY') for update;
  v_bundle := planning.load_plan_snapshot_source_bundle_v1(
    v_delivery.workspace_id, v_attempt.claim_as_of
  );
  if v_attempt.attempt_state = 'READY' and (
    v_attempt.source_fence is distinct from v_bundle->>'sourceFence'
    or clock_timestamp() > v_attempt.valid_until
  ) then
    update planning.plan_snapshot_attempts set attempt_state = 'SUPERSEDED',
      updated_at = clock_timestamp() where attempt_id = v_attempt.attempt_id;
    select max(attempt.generation) + 1 into v_generation
    from planning.plan_snapshot_attempts as attempt where attempt.delivery_id = p_delivery_id;
    select pointer.pointer_version into strict v_pointer_version
    from planning.current_plan_snapshots as pointer
    where pointer.workspace_id = v_delivery.workspace_id;
    insert into planning.plan_snapshot_attempts (
      workspace_id, delivery_id, event_id, event_position, generation, claim_as_of,
      base_pointer_version, scheduled_source_snapshot_id
    ) values (
      v_delivery.workspace_id, v_delivery.delivery_id, v_delivery.event_id,
      v_event.event_position, v_generation, clock_timestamp(), v_pointer_version,
      case when v_event.event_name = 'planning.snapshot_refresh_scheduled'
        then (v_event.payload->>'source_snapshot_id')::uuid end
    ) returning * into v_attempt;
    v_bundle := planning.load_plan_snapshot_source_bundle_v1(
      v_delivery.workspace_id, v_attempt.claim_as_of
    );
  end if;
  return pg_catalog.jsonb_build_object(
    'attemptId', v_attempt.attempt_id,
    'generation', v_attempt.generation,
    'claimAsOf', v_attempt.claim_as_of,
    'sourceFence', v_bundle->>'sourceFence',
    'sourceBundle', v_bundle,
    'storedInput', case when v_attempt.attempt_state = 'READY'
      then v_attempt.normalized_input else null end
  );
end
$function$;

create function planning.record_plan_snapshot_input_impl(
  p_delivery_id uuid, p_lease_token uuid, p_attempt_id uuid,
  p_source_fence text, p_input jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_delivery outbox.deliveries%rowtype;
  v_attempt planning.plan_snapshot_attempts%rowtype;
  v_bundle jsonb;
  v_ids uuid[];
begin
  select delivery.* into v_delivery from outbox.deliveries as delivery
  where delivery.delivery_id = p_delivery_id for update;
  if not found or v_delivery.consumer_name <> 'planning.plan_snapshot_v1'
     or v_delivery.delivery_state <> 'leased'
     or v_delivery.lease_token is distinct from p_lease_token
     or v_delivery.lease_expires_at <= clock_timestamp() then
    raise exception using errcode = '42501', message = 'planning delivery lease is not valid';
  end if;
  select attempt.* into strict v_attempt from planning.plan_snapshot_attempts as attempt
  where attempt.attempt_id = p_attempt_id and attempt.delivery_id = p_delivery_id
    and attempt.attempt_state = 'LOADING' for update;
  v_bundle := planning.load_plan_snapshot_source_bundle_v1(
    v_attempt.workspace_id, v_attempt.claim_as_of
  );
  if p_source_fence is null or p_source_fence <> v_bundle->>'sourceFence'
     or p_input->>'inputFingerprint' !~ '^planning-input:[a-f0-9]{64}$'
     or (p_input#>>'{evaluationHorizon,asOf}')::timestamptz <> v_attempt.claim_as_of
     or (p_input#>>'{evaluationHorizon,validUntil}')::timestamptz < v_attempt.claim_as_of then
    raise exception using errcode = '22023', message = 'planning normalized input provenance is invalid';
  end if;
  select coalesce(pg_catalog.array_agg(value::uuid order by value::text), array[]::uuid[])
  into v_ids from pg_catalog.jsonb_array_elements_text(v_bundle->'visibleDeliveryIds') as value;
  update planning.plan_snapshot_attempts set attempt_state = 'READY',
    source_fence = p_source_fence, normalized_input = p_input,
    input_fingerprint = p_input->>'inputFingerprint',
    valid_until = (p_input#>>'{evaluationHorizon,validUntil}')::timestamptz,
    covered_delivery_ids = v_ids, updated_at = clock_timestamp()
  where attempt_id = p_attempt_id;
  return true;
end
$function$;

create function planning.complete_plan_snapshot_projection_impl(
  p_delivery_id uuid, p_lease_token uuid, p_attempt_id uuid, p_result jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_delivery outbox.deliveries%rowtype;
  v_event outbox.events%rowtype;
  v_attempt planning.plan_snapshot_attempts%rowtype;
  v_pointer planning.current_plan_snapshots%rowtype;
  v_bundle jsonb;
  v_snapshot_id uuid;
  v_next_pointer bigint;
  v_action jsonb;
  v_selection_id uuid;
  v_action_count integer;
  v_visible_delivery_id uuid;
  v_schedule_event_id uuid;
  v_scheduled_for timestamptz;
  v_canonical_valid_until text;
begin
  select delivery.* into v_delivery from outbox.deliveries as delivery
  where delivery.delivery_id = p_delivery_id for update;
  if not found or v_delivery.consumer_name <> 'planning.plan_snapshot_v1'
     or v_delivery.handler_contract_version <> 1
     or v_delivery.delivery_state <> 'leased'
     or v_delivery.lease_token is distinct from p_lease_token
     or v_delivery.lease_expires_at <= clock_timestamp() then
    raise exception using errcode = '42501', message = 'planning delivery lease is not valid';
  end if;
  select event.* into strict v_event from outbox.events as event
  where event.event_id = v_delivery.event_id and event.workspace_id = v_delivery.workspace_id;
  select attempt.* into strict v_attempt from planning.plan_snapshot_attempts as attempt
  where attempt.attempt_id = p_attempt_id and attempt.delivery_id = p_delivery_id
    and attempt.attempt_state = 'READY' for update;
  if p_result->>'inputFingerprint' is distinct from v_attempt.input_fingerprint
     or p_result->>'engineVersion' <> 'planner-engine/0.1.0'
     or p_result->>'policyVersion' <> 'planning-policy/0.1'
     or (p_result->>'calculatedAsOf')::timestamptz <> v_attempt.claim_as_of
     or (p_result->>'validUntil')::timestamptz <> v_attempt.valid_until
     or p_result->'actions' is null or pg_catalog.jsonb_typeof(p_result->'actions') <> 'array'
     or pg_catalog.jsonb_array_length(p_result->'actions') > 5 then
    raise exception using errcode = '22023', message = 'planning projection result is invalid';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('planning-workspace:' || v_attempt.workspace_id::text, 0)
  );
  select pointer.* into strict v_pointer from planning.current_plan_snapshots as pointer
  where pointer.workspace_id = v_attempt.workspace_id for update;
  v_bundle := planning.load_plan_snapshot_source_bundle_v1(
    v_attempt.workspace_id, v_attempt.claim_as_of
  );
  if v_attempt.scheduled_source_snapshot_id is not null
     and v_pointer.snapshot_id is distinct from v_attempt.scheduled_source_snapshot_id then
    update planning.plan_snapshot_attempts set attempt_state = 'SUPERSEDED',
      applied_pointer_version = v_pointer.pointer_version, updated_at = clock_timestamp()
    where attempt_id = v_attempt.attempt_id;
    update planning.plan_snapshot_delivery_ledger set coverage_state = 'SUPERSEDED',
      covered_by_pointer_version = v_pointer.pointer_version,
      covered_by_attempt_id = v_attempt.attempt_id, updated_at = clock_timestamp()
    where delivery_id = v_delivery.delivery_id;
    insert into outbox.consumer_receipts (
      delivery_id, event_id, workspace_id, consumer_name, handler_contract_version,
      input_event_position, lease_token
    ) values (
      v_delivery.delivery_id, v_delivery.event_id, v_delivery.workspace_id,
      'planning.plan_snapshot_v1', 1, v_event.event_position, p_lease_token
    ) on conflict (delivery_id) do nothing;
    update outbox.deliveries set delivery_state = 'succeeded', lease_token = null,
      lease_expires_at = null, completed_at = clock_timestamp()
    where delivery_id = v_delivery.delivery_id;
    return 'SUPERSEDED';
  end if;
  if v_attempt.source_fence is distinct from v_bundle->>'sourceFence'
     or v_attempt.base_pointer_version <> v_pointer.pointer_version
     or clock_timestamp() > v_attempt.valid_until then
    update planning.plan_snapshot_attempts set
      attempt_state = case when v_delivery.attempt_count >= 8 then 'FAILED' else 'SUPERSEDED' end,
      failure_class = case when v_delivery.attempt_count >= 8 then 'EXHAUSTED' end,
      error_code = case when v_delivery.attempt_count >= 8
        then 'STALE_PLANNING_INPUT_AFTER_MAX_ATTEMPTS' end,
      updated_at = clock_timestamp()
    where attempt_id = v_attempt.attempt_id;
    update outbox.deliveries set
      delivery_state = case when v_delivery.attempt_count >= 8 then 'dead_letter' else 'retry' end,
      available_at = case when v_delivery.attempt_count >= 8
        then available_at else clock_timestamp() end,
      lease_token = null, lease_expires_at = null,
      last_failure_class = case when v_delivery.attempt_count >= 8
        then 'EXHAUSTED' else 'STALE_INPUT' end,
      last_error_code = case when v_delivery.attempt_count >= 8
        then 'STALE_PLANNING_INPUT_AFTER_MAX_ATTEMPTS' else 'STALE_PLANNING_INPUT' end,
      last_failed_at = clock_timestamp(),
      dead_lettered_at = case when v_delivery.attempt_count >= 8
        then clock_timestamp() else null end
    where delivery_id = v_delivery.delivery_id;
    return case when v_delivery.attempt_count >= 8 then 'DEAD_LETTER' else 'RETRY' end;
  end if;

  if v_pointer.snapshot_id is not null and exists (
    select 1 from planning.plan_snapshots as snapshot
    where snapshot.workspace_id = v_attempt.workspace_id
      and snapshot.snapshot_id = v_pointer.snapshot_id
      and snapshot.input_fingerprint = v_attempt.input_fingerprint
  ) then
    v_snapshot_id := v_pointer.snapshot_id;
    v_next_pointer := v_pointer.pointer_version;
  else
    insert into planning.plan_snapshots (
      snapshot_id, workspace_id, growth_plan_id, input_fingerprint, engine_version,
      policy_version, calculated_as_of, valid_until, time_zone, week_start, week_end,
      recommendation_state, result
    ) values (
      gen_random_uuid(), v_attempt.workspace_id,
      nullif(v_attempt.normalized_input#>>'{growthPlan,growthPlanId}', '')::uuid,
      v_attempt.input_fingerprint, p_result->>'engineVersion', p_result->>'policyVersion',
      (p_result->>'calculatedAsOf')::timestamptz, (p_result->>'validUntil')::timestamptz,
      p_result->>'timeZone', (p_result->>'weekStart')::timestamptz,
      (p_result->>'weekEnd')::timestamptz, p_result->>'recommendationState', p_result
    ) on conflict (workspace_id, engine_version, policy_version, input_fingerprint) do nothing;
    select snapshot.snapshot_id into strict v_snapshot_id
    from planning.plan_snapshots as snapshot
    where snapshot.workspace_id = v_attempt.workspace_id
      and snapshot.engine_version = p_result->>'engineVersion'
      and snapshot.policy_version = p_result->>'policyVersion'
      and snapshot.input_fingerprint = v_attempt.input_fingerprint;
    v_action_count := pg_catalog.jsonb_array_length(p_result->'actions');
    if not exists (
      select 1 from planning.plan_action_selections as selection
      where selection.workspace_id = v_attempt.workspace_id
        and selection.snapshot_id = v_snapshot_id
    ) then
      for v_action in select value from pg_catalog.jsonb_array_elements(p_result->'actions') loop
        v_selection_id := gen_random_uuid();
        insert into planning.plan_action_selections (
          selection_id, selection_ref, workspace_id, snapshot_id, attempt_id, rank,
          candidate_key, action_kind, readiness_goal_key, activity_key,
          learning_track_id, focus_session_id, planned_minutes, expires_at
        ) values (
          v_selection_id, 'plan-action:' || v_selection_id::text,
          v_attempt.workspace_id, v_snapshot_id, v_attempt.attempt_id,
          (v_action->>'rank')::smallint, v_action->>'candidateKey', v_action->>'actionKind',
          v_action->>'readinessGoalKey', v_action->>'activityKey',
          nullif(v_action->>'trackId', '')::uuid, nullif(v_action->>'focusSessionId', '')::uuid,
          (v_action->>'durationMinutes')::smallint, v_attempt.valid_until
        );
        update planning.plan_action_selections set selection_ref = 'plan-action:' || selection_id::text
        where workspace_id = v_attempt.workspace_id and snapshot_id = v_snapshot_id
          and rank = (v_action->>'rank')::smallint;
      end loop;
    elsif (select count(*) from planning.plan_action_selections as selection
      where selection.workspace_id = v_attempt.workspace_id
        and selection.snapshot_id = v_snapshot_id) <> v_action_count then
      raise exception using errcode = '23514', message = 'planning action selections conflict';
    end if;
    v_next_pointer := v_pointer.pointer_version + 1;
    update planning.current_plan_snapshots set snapshot_id = v_snapshot_id,
      pointer_version = v_next_pointer, applied_attempt_id = v_attempt.attempt_id,
      updated_at = clock_timestamp()
    where workspace_id = v_attempt.workspace_id;

    v_scheduled_for := v_attempt.valid_until + interval '1 millisecond';
    v_canonical_valid_until := pg_catalog.to_char(v_attempt.valid_until at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
    v_schedule_event_id := planning.stable_plan_uuid_v1(
      v_attempt.workspace_id::text || '|planning.plan_snapshot_v1|' ||
      v_snapshot_id::text || '|' || v_canonical_valid_until
    );
    insert into outbox.events (
      event_id, event_name, event_schema_version, workspace_id, aggregate_type,
      aggregate_id, aggregate_version, actor_type, actor_user_id, command_id,
      correlation_id, causation_id, occurred_at, source, payload
    ) values (
      v_schedule_event_id, 'planning.snapshot_refresh_scheduled', 1,
      v_attempt.workspace_id, 'planning.plan_snapshot', v_snapshot_id, v_next_pointer,
      'system', null, v_event.command_id, v_event.correlation_id, v_event.event_id,
      clock_timestamp(), 'pando.planning_worker', pg_catalog.jsonb_build_object(
        'workspace_id', v_attempt.workspace_id,
        'source_snapshot_id', v_snapshot_id,
        'input_fingerprint', v_attempt.input_fingerprint,
        'valid_until', v_attempt.valid_until,
        'scheduled_for', v_scheduled_for
      )
    ) on conflict (event_id) do nothing;
    insert into outbox.deliveries (
      event_id, workspace_id, consumer_name, handler_contract_version, available_at
    ) values (
      v_schedule_event_id, v_attempt.workspace_id, 'planning.plan_snapshot_v1', 1,
      v_scheduled_for
    ) on conflict (event_id, consumer_name, handler_contract_version) do nothing;
  end if;

  foreach v_visible_delivery_id in array v_attempt.covered_delivery_ids loop
    update planning.plan_snapshot_delivery_ledger set coverage_state = 'COVERED',
      covered_by_pointer_version = v_next_pointer,
      covered_by_attempt_id = v_attempt.attempt_id, updated_at = clock_timestamp()
    where delivery_id = v_visible_delivery_id and coverage_state = 'UNCOVERED';
    insert into outbox.consumer_receipts (
      delivery_id, event_id, workspace_id, consumer_name, handler_contract_version,
      input_event_position, lease_token
    ) select delivery.delivery_id, delivery.event_id, delivery.workspace_id,
      delivery.consumer_name, delivery.handler_contract_version, event.event_position,
      p_lease_token
    from outbox.deliveries as delivery join outbox.events as event
      on event.event_id = delivery.event_id and event.workspace_id = delivery.workspace_id
    where delivery.delivery_id = v_visible_delivery_id
    on conflict (delivery_id) do nothing;
    update outbox.deliveries set delivery_state = 'succeeded', lease_token = null,
      lease_expires_at = null, completed_at = clock_timestamp()
    where delivery_id = v_visible_delivery_id and delivery_state <> 'succeeded';
  end loop;
  update planning.plan_snapshot_attempts set attempt_state = 'APPLIED',
    applied_pointer_version = v_next_pointer, updated_at = clock_timestamp()
  where attempt_id = v_attempt.attempt_id;
  update planning.plan_snapshot_attempts set attempt_state = 'SUPERSEDED',
    updated_at = clock_timestamp()
  where workspace_id = v_attempt.workspace_id and attempt_id <> v_attempt.attempt_id
    and attempt_state in ('LOADING', 'READY');
  return case when v_next_pointer = v_pointer.pointer_version then 'COVERED' else 'APPLIED' end;
end
$function$;

create function outbox.fail_plan_snapshot_projection_impl(
  p_delivery_id uuid, p_lease_token uuid, p_attempt_id uuid,
  p_failure_class text, p_error_code text
)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_delivery outbox.deliveries%rowtype;
  v_state text;
  v_delay integer;
begin
  if p_failure_class not in ('TRANSIENT', 'INVALID_CONTRACT')
     or p_error_code !~ '^[A-Z][A-Z0-9_]{1,63}$' then
    raise exception using errcode = '22023', message = 'planning worker failure input is invalid';
  end if;
  select delivery.* into v_delivery from outbox.deliveries as delivery
  where delivery.delivery_id = p_delivery_id for update;
  if not found or v_delivery.consumer_name <> 'planning.plan_snapshot_v1'
     or v_delivery.delivery_state <> 'leased'
     or v_delivery.lease_token is distinct from p_lease_token then
    raise exception using errcode = '42501', message = 'planning delivery lease is not valid';
  end if;
  perform 1 from planning.plan_snapshot_attempts as attempt
  where attempt.attempt_id = p_attempt_id and attempt.delivery_id = p_delivery_id
    and attempt.attempt_state in ('LOADING', 'READY') for update;
  if not found then
    raise exception using errcode = '42501', message = 'planning attempt is not active';
  end if;
  v_state := case when p_failure_class = 'INVALID_CONTRACT' or v_delivery.attempt_count >= 8
    then 'dead_letter' else 'retry' end;
  v_delay := least(900, (5 * pg_catalog.power(2,
    greatest(v_delivery.attempt_count - 1, 0)))::integer);
  update planning.plan_snapshot_attempts set attempt_state = 'FAILED',
    failure_class = p_failure_class, error_code = p_error_code,
    updated_at = clock_timestamp()
  where attempt_id = p_attempt_id and delivery_id = p_delivery_id
    and attempt_state in ('LOADING', 'READY');
  update outbox.deliveries set delivery_state = v_state,
    available_at = case when v_state = 'retry' then clock_timestamp() +
      pg_catalog.make_interval(secs => least(900, v_delay +
        pg_catalog.floor(pg_catalog.random() * greatest(1, v_delay / 5.0))::integer))
      else available_at end,
    lease_token = null, lease_expires_at = null,
    last_failure_class = p_failure_class, last_error_code = p_error_code,
    last_failed_at = clock_timestamp(),
    dead_lettered_at = case when v_state = 'dead_letter' then clock_timestamp() end
  where delivery_id = p_delivery_id;
  return v_state;
end
$function$;

create function outbox.get_plan_snapshot_projection_health_impl()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'states', coalesce((select pg_catalog.jsonb_object_agg(value.delivery_state, value.count)
      from (select delivery.delivery_state, count(*) from outbox.deliveries as delivery
        where delivery.consumer_name = 'planning.plan_snapshot_v1'
        group by delivery.delivery_state order by delivery.delivery_state) as value), '{}'::jsonb),
    'attempts', coalesce((select pg_catalog.jsonb_object_agg(value.attempt_state, value.count)
      from (select attempt.attempt_state, count(*) from planning.plan_snapshot_attempts as attempt
        group by attempt.attempt_state order by attempt.attempt_state) as value), '{}'::jsonb)
  )
$function$;

alter function planning.guard_plan_snapshot_attempt_mutation() owner to pando_planning_worker;
alter function planning.stable_plan_uuid_v1(text) owner to pando_planning_worker;
alter function planning.load_plan_snapshot_source_bundle_v1(uuid, timestamptz)
  owner to pando_planning_worker;
alter function outbox.claim_plan_snapshot_projection_impl() owner to pando_planning_worker;
alter function planning.plan_snapshot_event_is_valid_v1(outbox.events)
  owner to pando_planning_worker;
alter function planning.load_plan_snapshot_projection_impl(uuid, uuid, uuid)
  owner to pando_planning_worker;
alter function planning.record_plan_snapshot_input_impl(uuid, uuid, uuid, text, jsonb)
  owner to pando_planning_worker;
alter function planning.complete_plan_snapshot_projection_impl(uuid, uuid, uuid, jsonb)
  owner to pando_planning_worker;
alter function outbox.fail_plan_snapshot_projection_impl(uuid, uuid, uuid, text, text)
  owner to pando_planning_worker;
alter function outbox.get_plan_snapshot_projection_health_impl()
  owner to pando_planning_worker;

create function api.claim_plan_snapshot_projection_v1()
returns table (
  delivery_id uuid, event_id uuid, event_position bigint, workspace_id uuid,
  lease_token uuid, lease_expires_at timestamptz, attempt_count smallint,
  attempt_id uuid, generation smallint, claim_as_of timestamptz
)
language sql security invoker set search_path = ''
as $function$ select * from outbox.claim_plan_snapshot_projection_impl() $function$;
create function api.load_plan_snapshot_projection_v1(
  p_delivery_id uuid, p_lease_token uuid, p_attempt_id uuid
) returns jsonb language sql security invoker set search_path = ''
as $function$ select planning.load_plan_snapshot_projection_impl(
  p_delivery_id, p_lease_token, p_attempt_id
) $function$;
create function api.record_plan_snapshot_input_v1(
  p_delivery_id uuid, p_lease_token uuid, p_attempt_id uuid,
  p_source_fence text, p_input jsonb
) returns boolean language sql security invoker set search_path = ''
as $function$ select planning.record_plan_snapshot_input_impl(
  p_delivery_id, p_lease_token, p_attempt_id, p_source_fence, p_input
) $function$;
create function api.complete_plan_snapshot_projection_v1(
  p_delivery_id uuid, p_lease_token uuid, p_attempt_id uuid, p_result jsonb
) returns text language sql security invoker set search_path = ''
as $function$ select planning.complete_plan_snapshot_projection_impl(
  p_delivery_id, p_lease_token, p_attempt_id, p_result
) $function$;
create function api.fail_plan_snapshot_projection_v1(
  p_delivery_id uuid, p_lease_token uuid, p_attempt_id uuid,
  p_failure_class text, p_error_code text
) returns text language sql security invoker set search_path = ''
as $function$ select outbox.fail_plan_snapshot_projection_impl(
  p_delivery_id, p_lease_token, p_attempt_id, p_failure_class, p_error_code
) $function$;
create function api.get_plan_snapshot_projection_health_v1()
returns jsonb language sql security invoker set search_path = ''
as $function$ select outbox.get_plan_snapshot_projection_health_impl() $function$;

alter function api.claim_plan_snapshot_projection_v1() owner to pando_planning_worker;
alter function api.load_plan_snapshot_projection_v1(uuid, uuid, uuid)
  owner to pando_planning_worker;
alter function api.record_plan_snapshot_input_v1(uuid, uuid, uuid, text, jsonb)
  owner to pando_planning_worker;
alter function api.complete_plan_snapshot_projection_v1(uuid, uuid, uuid, jsonb)
  owner to pando_planning_worker;
alter function api.fail_plan_snapshot_projection_v1(uuid, uuid, uuid, text, text)
  owner to pando_planning_worker;
alter function api.get_plan_snapshot_projection_health_v1() owner to pando_planning_worker;

revoke all on function api.claim_plan_snapshot_projection_v1(),
  api.load_plan_snapshot_projection_v1(uuid, uuid, uuid),
  api.record_plan_snapshot_input_v1(uuid, uuid, uuid, text, jsonb),
  api.complete_plan_snapshot_projection_v1(uuid, uuid, uuid, jsonb),
  api.fail_plan_snapshot_projection_v1(uuid, uuid, uuid, text, text),
  api.get_plan_snapshot_projection_health_v1()
  from public, anon, authenticated, service_role;
revoke all on function planning.guard_plan_snapshot_attempt_mutation(),
  planning.record_plan_snapshot_delivery_v1(),
  planning.stable_plan_uuid_v1(text),
  planning.load_plan_snapshot_source_bundle_v1(uuid, timestamptz),
  planning.plan_snapshot_event_is_valid_v1(outbox.events),
  planning.load_plan_snapshot_projection_impl(uuid, uuid, uuid),
  planning.record_plan_snapshot_input_impl(uuid, uuid, uuid, text, jsonb),
  planning.complete_plan_snapshot_projection_impl(uuid, uuid, uuid, jsonb),
  outbox.claim_plan_snapshot_projection_impl(),
  outbox.fail_plan_snapshot_projection_impl(uuid, uuid, uuid, text, text),
  outbox.get_plan_snapshot_projection_health_impl()
  from public, anon, authenticated, service_role;
grant execute on function planning.load_plan_snapshot_projection_impl(uuid, uuid, uuid),
  planning.record_plan_snapshot_input_impl(uuid, uuid, uuid, text, jsonb),
  planning.complete_plan_snapshot_projection_impl(uuid, uuid, uuid, jsonb),
  outbox.claim_plan_snapshot_projection_impl(),
  outbox.fail_plan_snapshot_projection_impl(uuid, uuid, uuid, text, text),
  outbox.get_plan_snapshot_projection_health_impl()
  to service_role;
grant execute on function api.claim_plan_snapshot_projection_v1(),
  api.load_plan_snapshot_projection_v1(uuid, uuid, uuid),
  api.record_plan_snapshot_input_v1(uuid, uuid, uuid, text, jsonb),
  api.complete_plan_snapshot_projection_v1(uuid, uuid, uuid, jsonb),
  api.fail_plan_snapshot_projection_v1(uuid, uuid, uuid, text, text),
  api.get_plan_snapshot_projection_health_v1()
  to service_role;

revoke create on schema planning, outbox, api from pando_planning_worker;
do $membership$
begin
  execute pg_catalog.format('revoke pando_planning_worker from %I', current_user);
end
$membership$;
