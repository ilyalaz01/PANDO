-- Phase 4B D5: Planning-owned Campaign allocation overrides plus the first cross-owner
-- coordinator, campaign_lifecycle_v1, in the Agent Control module boundary.
-- ADR-0010 section 5 defines allocation overrides as bounded temporary replacements of a Learning
-- Track's own priority/protected-minimum/cadence parameters; section 7 defines the coordinator's
-- scope (install overrides on start_campaign, close them on end_campaign/cancel_campaign), its
-- fixed lock order (agent-control-workspace, then targets-workspace, then planning-workspace), and
-- that it owns nothing itself. This slice is additive persistence and RPC only: it adds no
-- Planning calculation input, no engine/policy version, and no outbox delivery, exactly as D4 did
-- for Interview Campaigns. planner-engine/0.4.0, PlanningCalculationInputV4, and the client/UI
-- layer are explicitly out of scope for this session (D5-app).

-- ---------------------------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------------------------

do $roles$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'pando_agent_control_api') then
    execute 'create role pando_agent_control_api nologin noinherit nobypassrls';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_roles where rolname = 'pando_phase1_agent_control_source'
  ) then
    execute 'create role pando_phase1_agent_control_source nologin noinherit nobypassrls';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_roles where rolname = 'pando_planning_agent_control_source'
  ) then
    execute 'create role pando_planning_agent_control_source nologin noinherit nobypassrls';
  end if;
end
$roles$;

create schema if not exists agent_control;

do $migration_role_membership$
begin
  execute pg_catalog.format(
    'grant pando_rls_authorizer, pando_agent_control_api, pando_planning_api, pando_phase1_api,
     pando_phase1_agent_control_source, pando_planning_agent_control_source,
     pando_phase1_planning_source to %I with set true',
    current_user
  );
end
$migration_role_membership$;

set role pando_rls_authorizer;
grant execute on function identity.jwt_subject(), identity.current_user_id(),
  identity.is_workspace_member(uuid), identity.personal_workspace_id_for_current_user()
  to pando_agent_control_api;
reset role;

grant usage, create on schema agent_control, planning, api to pando_agent_control_api;
grant usage on schema targets, outbox, identity, extensions to pando_agent_control_api;
grant execute on function extensions.digest(bytea, text) to pando_agent_control_api;
grant select, insert, update on outbox.command_receipts to pando_agent_control_api;
grant usage, select on sequence outbox.events_event_position_seq to pando_agent_control_api;

create policy command_receipts_agent_control_select on outbox.command_receipts
for select to pando_agent_control_api
using (
  actor_user_id = identity.current_user_id()
  and workspace_id is not null
  and identity.is_workspace_member(workspace_id)
);
create policy command_receipts_agent_control_insert on outbox.command_receipts
for insert to pando_agent_control_api
with check (
  actor_user_id = identity.current_user_id()
  and workspace_id is not null
  and identity.is_workspace_member(workspace_id)
);
create policy command_receipts_agent_control_update on outbox.command_receipts
for update to pando_agent_control_api
using (
  actor_user_id = identity.current_user_id()
  and workspace_id is not null
  and identity.is_workspace_member(workspace_id)
)
with check (
  actor_user_id = identity.current_user_id()
  and workspace_id is not null
  and identity.is_workspace_member(workspace_id)
);

grant usage, create on schema targets to pando_phase1_agent_control_source;
grant usage on schema identity, extensions to pando_phase1_agent_control_source;
grant usage, create on schema planning to pando_planning_agent_control_source;
grant usage on schema targets, identity, extensions to pando_planning_agent_control_source;

-- The coordination sources are bounded reads gated by the workspace_id parameter the coordinator
-- already resolved from the authenticated session, mirroring identity.read_target_calendar_
-- source_v1's permissive-policy-plus-parameter-scoping pattern exactly.
grant select on targets.interview_campaigns to pando_phase1_agent_control_source;
create policy interview_campaigns_agent_control_source on targets.interview_campaigns
for select to pando_phase1_agent_control_source using (true);

-- The direct campaign-allocation-override edit/remove command (Planning-owned, no coordinator)
-- needs the same bounded campaign read, reused through the existing Targets-to-Planning source
-- role that already carries planning's other Phase-1 bounded reads (targets.read_planning_
-- readiness_source_v1 and friends), rather than inventing a further narrow role for one lookup.
grant select on targets.interview_campaigns to pando_phase1_planning_source;
create policy interview_campaigns_phase1_planning_source on targets.interview_campaigns
for select to pando_phase1_planning_source using (true);

grant select on planning.growth_plans, planning.learning_tracks
  to pando_planning_agent_control_source;
create policy growth_plans_agent_control_source on planning.growth_plans
for select to pando_planning_agent_control_source using (true);
create policy learning_tracks_agent_control_source on planning.learning_tracks
for select to pando_planning_agent_control_source using (true);

grant create on schema planning, api to pando_planning_api;
grant create on schema targets, api to pando_phase1_api;

-- The lifecycle-overrides guard trigger (targets.guard_interview_campaign_lifecycle_overrides)
-- runs as pando_phase1_api and calls the narrow Planning read planning.has_active_campaign_
-- allocation_override_v1 below; it needs schema USAGE to resolve that qualified reference.
grant usage on schema planning to pando_phase1_api;

-- The released events_planning_insert policy only admits planning.input_changed for the Growth
-- Plan and Learning Track aggregates (20260828000275). A separate, additively scoped policy
-- admits this slice's own event without widening or re-touching that existing predicate.
create policy events_planning_allocation_override_insert on outbox.events
for insert to pando_planning_api
with check (
  identity.is_workspace_member(workspace_id)
  and event_name = 'planning.campaign_allocation_override_changed'
  and event_schema_version = 1
  and aggregate_type = 'planning.campaign_allocation_override'
  and aggregate_id is not null
  and aggregate_version is not null
  and actor_type = 'user'
  and actor_user_id = identity.current_user_id()
  and source = 'pando.database'
);

-- ---------------------------------------------------------------------------------------------
-- 0) Planning-owned CampaignAllocationOverride persistence (ADR-0010 section 5)
-- ---------------------------------------------------------------------------------------------

create table planning.campaign_allocation_overrides (
  override_id uuid primary key,
  workspace_id uuid not null references identity.workspaces (workspace_id) on delete restrict,
  growth_plan_id uuid not null,
  learning_track_id uuid not null,
  campaign_id uuid not null,
  override_key text not null,
  priority_override smallint,
  protected_minimum_minutes_override smallint,
  cadence_per_week_override smallint,
  lifecycle text not null default 'active',
  aggregate_version bigint not null default 1,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint campaign_allocation_overrides_track_fk
    foreign key (workspace_id, growth_plan_id, learning_track_id)
    references planning.learning_tracks (workspace_id, growth_plan_id, learning_track_id)
    on delete restrict,
  constraint campaign_allocation_overrides_campaign_fk
    foreign key (workspace_id, campaign_id)
    references targets.interview_campaigns (workspace_id, campaign_id) on delete restrict,
  constraint campaign_allocation_overrides_key_check check (
    override_key
      ~ '^override:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint campaign_allocation_overrides_lifecycle_check check (
    lifecycle in ('active', 'superseded', 'removed')
  ),
  constraint campaign_allocation_overrides_priority_check check (
    priority_override is null or priority_override between 0 and 100
  ),
  constraint campaign_allocation_overrides_protected_minimum_check check (
    protected_minimum_minutes_override is null
    or protected_minimum_minutes_override between 0 and 10080
  ),
  constraint campaign_allocation_overrides_cadence_check check (
    cadence_per_week_override is null or cadence_per_week_override between 0 and 100
  ),
  constraint campaign_allocation_overrides_has_value_check check (
    priority_override is not null or protected_minimum_minutes_override is not null
    or cadence_per_week_override is not null
  ),
  constraint campaign_allocation_overrides_version_check check (aggregate_version > 0),
  unique (workspace_id, override_id),
  unique (workspace_id, override_key)
);

-- ADR-0010 section 5 does not resolve what happens when two simultaneously active campaigns try
-- to overlay the same Track (D4-db left campaign cardinality open). This session closes that gap
-- conservatively for overrides specifically: at most one active override may govern a given
-- Track's effective parameters at a time, so "which campaign's override wins" is never ambiguous.
-- See docs/implementation/PHASE_4B_D5_ALLOCATIONS_STATUS.md.
create unique index campaign_allocation_overrides_active_per_track
  on planning.campaign_allocation_overrides (workspace_id, learning_track_id)
  where lifecycle = 'active';

create index campaign_allocation_overrides_campaign_order
  on planning.campaign_allocation_overrides (workspace_id, campaign_id, lifecycle, override_key);

-- The protected-minimum floor is a mutable cross-row invariant (ADR-0010 section 5: "MUST NOT be
-- lower than the Track's own protected minimum"), so it is guarded by trigger rather than a check
-- constraint, exactly as interview_campaigns guards its cross-row Readiness Goal invariant.
create function planning.guard_campaign_allocation_override_floor()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_track_protected_minimum_minutes smallint;
begin
  if tg_op = 'UPDATE'
     and (
       new.workspace_id is distinct from old.workspace_id
       or new.override_key is distinct from old.override_key
       or new.growth_plan_id is distinct from old.growth_plan_id
       or new.learning_track_id is distinct from old.learning_track_id
       or new.campaign_id is distinct from old.campaign_id
     ) then
    raise exception using errcode = '55000',
      message = 'campaign allocation override identity fields are immutable';
  end if;

  if new.protected_minimum_minutes_override is not null then
    select track.protected_minimum_minutes into strict v_track_protected_minimum_minutes
    from planning.learning_tracks as track
    where track.workspace_id = new.workspace_id
      and track.learning_track_id = new.learning_track_id;
    if new.protected_minimum_minutes_override < v_track_protected_minimum_minutes then
      raise exception using errcode = '23514',
        message = 'campaign protected-minimum override must not be lower than the Track floor';
    end if;
  end if;
  return new;
end
$function$;

create trigger campaign_allocation_overrides_guard_floor
before insert or update on planning.campaign_allocation_overrides
for each row execute function planning.guard_campaign_allocation_override_floor();

alter table planning.campaign_allocation_overrides enable row level security;
alter table planning.campaign_allocation_overrides force row level security;
revoke all on table planning.campaign_allocation_overrides
  from public, anon, authenticated, service_role;
grant select, insert, update on planning.campaign_allocation_overrides to pando_planning_api;
create policy campaign_allocation_overrides_planning_api
on planning.campaign_allocation_overrides
for all to pando_planning_api
using (identity.is_workspace_member(workspace_id))
with check (identity.is_workspace_member(workspace_id));

grant select on planning.campaign_allocation_overrides to pando_planning_agent_control_source;
create policy campaign_allocation_overrides_agent_control_source
on planning.campaign_allocation_overrides
for select to pando_planning_agent_control_source using (true);

revoke all on function planning.guard_campaign_allocation_override_floor()
  from public, anon, authenticated, service_role;

create function planning.derive_campaign_allocation_override_identity_v1(
  p_workspace_id uuid,
  p_command_type text,
  p_idempotency_key text,
  p_label text
)
returns uuid
language plpgsql
stable
strict
set search_path = ''
as $function$
declare
  v_hash bytea;
  v_hex text;
begin
  if p_command_type <> 'agent_control.coordinate_campaign_lifecycle_v1'
     or p_idempotency_key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or p_label !~ '^track:[a-z0-9][a-z0-9-]{1,100}$' then
    raise exception using errcode = '22023',
      message = 'campaign allocation override identity input is invalid';
  end if;
  v_hash := pg_catalog.substring(
    extensions.digest(
      pg_catalog.convert_to(
        planning.frame_named_fields_v1(
          array['identityVersion','workspaceId','commandType','idempotencyKey','label'],
          array[
            'planning-override-identity/1.0.0', pg_catalog.lower(p_workspace_id::text),
            p_command_type, p_idempotency_key, p_label
          ]
        ),
        'UTF8'
      ),
      'sha256'
    ),
    1,
    16
  );
  v_hash := pg_catalog.set_byte(v_hash, 6, (pg_catalog.get_byte(v_hash, 6) & 15) | 128);
  v_hash := pg_catalog.set_byte(v_hash, 8, (pg_catalog.get_byte(v_hash, 8) & 63) | 128);
  v_hex := pg_catalog.encode(v_hash, 'hex');
  return (
    pg_catalog.substring(v_hex, 1, 8) || '-' ||
    pg_catalog.substring(v_hex, 9, 4) || '-' ||
    pg_catalog.substring(v_hex, 13, 4) || '-' ||
    pg_catalog.substring(v_hex, 17, 4) || '-' ||
    pg_catalog.substring(v_hex, 21, 12)
  )::uuid;
end
$function$;

create function planning.campaign_allocation_override_changed_event_payload_v1_is_valid(
  p_payload jsonb
)
returns boolean
language sql
immutable
strict
set search_path = ''
as $function$
  select pg_catalog.jsonb_typeof(p_payload) = 'object'
    and (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(p_payload)) = 5
    and p_payload->>'change_kind' in ('OVERRIDE_INSTALLED', 'OVERRIDE_CHANGED', 'OVERRIDE_CLOSED')
    and p_payload->>'override_id'
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and p_payload->>'override_version' ~ '^[1-9][0-9]{0,18}$'
    and p_payload->>'learning_track_id'
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and p_payload->>'lifecycle' in ('ACTIVE', 'SUPERSEDED', 'REMOVED')
$function$;

revoke all on function
  planning.derive_campaign_allocation_override_identity_v1(uuid, text, text, text),
  planning.campaign_allocation_override_changed_event_payload_v1_is_valid(jsonb)
  from public, anon, authenticated, service_role;

grant create on schema targets to pando_phase1_planning_source;

create function targets.read_interview_campaign_for_override_source_v1(
  p_workspace_id uuid,
  p_campaign_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_campaign targets.interview_campaigns%rowtype;
begin
  if p_workspace_id is null or p_campaign_id is null then
    raise exception using errcode = '22023',
      message = 'campaign override source input is invalid';
  end if;
  select campaign.* into v_campaign
  from targets.interview_campaigns as campaign
  where campaign.workspace_id = p_workspace_id and campaign.campaign_id = p_campaign_id;
  if not found then
    raise exception using errcode = '42501', message = 'Interview Campaign is not accessible';
  end if;
  return pg_catalog.jsonb_build_object(
    'campaignKey', v_campaign.campaign_key, 'lifecycle', v_campaign.lifecycle,
    'fence', 'targets-campaign-override:' || v_campaign.campaign_id::text
  );
end
$function$;

alter function targets.read_interview_campaign_for_override_source_v1(uuid, uuid)
  owner to pando_phase1_planning_source;
revoke all on function targets.read_interview_campaign_for_override_source_v1(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke create on schema targets from pando_phase1_planning_source;
set role pando_phase1_planning_source;
grant execute on function targets.read_interview_campaign_for_override_source_v1(uuid, uuid)
  to pando_planning_api;
reset role;

-- ---------------------------------------------------------------------------------------------
-- 1) change_campaign_allocation_override / remove_campaign_allocation_override
-- ADR-0010 section 5: "editing one override while a campaign is already active ... remains a
-- direct owner command with no coordinator." Installing a new override happens only through
-- start_campaign (see the coordinator below); this command only edits or removes one that exists.
-- ---------------------------------------------------------------------------------------------

create function planning.build_campaign_allocation_override_change_preview_v1(
  p_workspace_id uuid,
  p_override_id uuid,
  p_override_key text,
  p_campaign_key text,
  p_campaign_lifecycle text,
  p_track_key text,
  p_track_title text,
  p_track_protected_minimum_minutes integer,
  p_weekly_capacity_minutes integer,
  p_active_protected_minimum_minutes_excluding_this integer,
  p_lifecycle text,
  p_priority_override integer,
  p_protected_minimum_minutes_override integer,
  p_cadence_per_week_override integer,
  p_aggregate_version bigint,
  p_operation text,
  p_expected_override_version bigint,
  p_new_priority_override integer,
  p_new_protected_minimum_minutes_override integer,
  p_new_cadence_per_week_override integer,
  p_reason text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_after_lifecycle text;
  v_after_priority integer;
  v_after_protected_minimum integer;
  v_after_cadence integer;
  v_after_version bigint;
  v_effective_protected_minimum_after integer;
  v_blocker text;
  v_can_apply boolean;
  v_digest_input text;
  v_digest text;
begin
  if p_workspace_id is null or p_override_id is null or p_override_key is null
     or p_campaign_key is null or p_campaign_lifecycle is null or p_track_key is null
     or p_track_title is null or p_track_protected_minimum_minutes is null
     or p_weekly_capacity_minutes is null
     or p_active_protected_minimum_minutes_excluding_this is null or p_lifecycle is null
     or p_aggregate_version is null or p_aggregate_version < 1
     or p_expected_override_version is null or p_expected_override_version < 1 then
    raise exception using errcode = '22023',
      message = 'campaign allocation override preview input is invalid';
  end if;
  if p_operation not in ('change_campaign_allocation_override', 'remove_campaign_allocation_override')
     then
    raise exception using errcode = '22023',
      message = 'campaign allocation override operation is invalid';
  end if;
  if p_reason is null or p_reason <> pg_catalog.btrim(p_reason)
     or pg_catalog.char_length(p_reason) not between 1 and 500
     or p_reason ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'campaign allocation override reason is invalid';
  end if;
  if p_lifecycle <> 'active' then
    raise exception using errcode = '22023',
      message = 'campaign allocation override can only change while active';
  end if;
  if p_campaign_lifecycle <> 'active' then
    raise exception using errcode = '22023',
      message = 'campaign allocation override can only change while its campaign is active';
  end if;
  if p_expected_override_version <> p_aggregate_version then
    raise exception using errcode = '40001',
      message = 'campaign allocation override version is stale';
  end if;
  if p_aggregate_version = 9223372036854775807 then
    raise exception using errcode = '22003',
      message = 'campaign allocation override version is exhausted';
  end if;

  v_after_version := p_aggregate_version + 1;
  if p_operation = 'remove_campaign_allocation_override' then
    -- Removal is a lifecycle transition only; the override's recorded values are retained as
    -- history unchanged, exactly as the coordinator's own close hook leaves a superseded row.
    v_after_lifecycle := 'removed';
    v_after_priority := p_priority_override;
    v_after_protected_minimum := p_protected_minimum_minutes_override;
    v_after_cadence := p_cadence_per_week_override;
  else
    if p_new_priority_override is null and p_new_protected_minimum_minutes_override is null
       and p_new_cadence_per_week_override is null then
      raise exception using errcode = '22023',
        message = 'campaign allocation override must set at least one field';
    end if;
    if p_new_priority_override is not null and p_new_priority_override not between 0 and 100 then
      raise exception using errcode = '22023',
        message = 'campaign allocation priority override is out of range';
    end if;
    if p_new_protected_minimum_minutes_override is not null
       and p_new_protected_minimum_minutes_override not between 0 and 10080 then
      raise exception using errcode = '22023',
        message = 'campaign allocation protected-minimum override is out of range';
    end if;
    if p_new_cadence_per_week_override is not null
       and p_new_cadence_per_week_override not between 0 and 100 then
      raise exception using errcode = '22023',
        message = 'campaign allocation cadence override is out of range';
    end if;
    if p_new_protected_minimum_minutes_override is not null
       and p_new_protected_minimum_minutes_override < p_track_protected_minimum_minutes then
      raise exception using errcode = '23514',
        message = 'campaign protected-minimum override must not be lower than the Track floor';
    end if;
    v_after_lifecycle := 'active';
    v_after_priority := p_new_priority_override;
    v_after_protected_minimum := p_new_protected_minimum_minutes_override;
    v_after_cadence := p_new_cadence_per_week_override;
  end if;

  v_effective_protected_minimum_after :=
    coalesce(v_after_protected_minimum, p_track_protected_minimum_minutes);
  v_blocker := case
    when p_active_protected_minimum_minutes_excluding_this + v_effective_protected_minimum_after
      > p_weekly_capacity_minutes
    then 'ALLOCATION_OVERRIDE_EXCEEDS_CAPACITY'
    else null
  end;
  v_can_apply := v_blocker is null;

  v_digest_input := planning.frame_named_fields_v1(
    array[
      'digestVersion','contractVersion','workspaceId','operation','commandType','reason',
      'overrideId','overrideKey','campaignKey','trackKey','beforeLifecycle','afterLifecycle',
      'beforeAggregateVersion','afterAggregateVersion','beforePriorityOverride',
      'afterPriorityOverride','beforeProtectedMinimumMinutesOverride',
      'afterProtectedMinimumMinutesOverride','beforeCadencePerWeekOverride',
      'afterCadencePerWeekOverride','canApply','blockingReasonCode'
    ],
    array[
      'campaign-allocation-override-change-preview-digest/1.0.0','1.0.0',
      pg_catalog.lower(p_workspace_id::text),p_operation,
      'planning.change_campaign_allocation_override_v1',p_reason,
      pg_catalog.lower(p_override_id::text),p_override_key,p_campaign_key,p_track_key,
      pg_catalog.upper(p_lifecycle),pg_catalog.upper(v_after_lifecycle),
      p_aggregate_version::text,v_after_version::text,
      coalesce(p_priority_override::text,''),coalesce(v_after_priority::text,''),
      coalesce(p_protected_minimum_minutes_override::text,''),
      coalesce(v_after_protected_minimum::text,''),
      coalesce(p_cadence_per_week_override::text,''),coalesce(v_after_cadence::text,''),
      pg_catalog.lower(v_can_apply::text),coalesce(v_blocker,'')
    ]
  );
  v_digest := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(v_digest_input, 'UTF8'), 'sha256'), 'hex'
  );

  return pg_catalog.jsonb_build_object(
    'contract', pg_catalog.jsonb_build_object(
      'name', 'CampaignAllocationOverrideChangePreviewV1', 'version', '1.0.0'
    ),
    'operation', p_operation,
    'commandType', 'planning.change_campaign_allocation_override_v1',
    'reason', p_reason,
    'campaignKey', p_campaign_key,
    'learningTrack', pg_catalog.jsonb_build_object('trackKey', p_track_key, 'title', p_track_title),
    'before', pg_catalog.jsonb_build_object(
      'overrideId', p_override_id, 'overrideKey', p_override_key,
      'lifecycle', pg_catalog.upper(p_lifecycle), 'aggregateVersion', p_aggregate_version::text,
      'priorityOverride', p_priority_override,
      'protectedMinimumMinutesOverride', p_protected_minimum_minutes_override,
      'cadencePerWeekOverride', p_cadence_per_week_override
    ),
    'after', pg_catalog.jsonb_build_object(
      'overrideId', p_override_id, 'overrideKey', p_override_key,
      'lifecycle', pg_catalog.upper(v_after_lifecycle), 'aggregateVersion', v_after_version::text,
      'priorityOverride', v_after_priority,
      'protectedMinimumMinutesOverride', v_after_protected_minimum,
      'cadencePerWeekOverride', v_after_cadence
    ),
    'canApply', v_can_apply,
    'blockingReasons', case when v_blocker is null then '[]'::jsonb else
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('code', v_blocker)) end,
    'warnings', '[]'::jsonb,
    'previewDigest', v_digest
  );
end
$function$;

create function api.preview_campaign_allocation_override_v1(
  p_override_key text,
  p_operation text,
  p_expected_override_version text,
  p_priority_override integer,
  p_protected_minimum_minutes_override integer,
  p_cadence_per_week_override integer,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_workspace_id uuid;
  v_override planning.campaign_allocation_overrides%rowtype;
  v_track planning.learning_tracks%rowtype;
  v_plan planning.growth_plans%rowtype;
  v_campaign jsonb;
  v_active_excluding integer;
begin
  if identity.jwt_subject() is null then
    raise exception using errcode = '28000', message = 'an authenticated user is required';
  end if;
  v_workspace_id := identity.personal_workspace_id_for_current_user();
  if v_workspace_id is null then
    raise exception using errcode = '28000', message = 'authenticated user is not provisioned';
  end if;
  if p_override_key is null
     or p_override_key
       !~ '^override:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or p_operation not in (
       'change_campaign_allocation_override', 'remove_campaign_allocation_override'
     )
     or p_expected_override_version is null
     or p_expected_override_version !~ '^[1-9][0-9]{0,18}$'
     or p_expected_override_version::numeric > 9223372036854775807 then
    raise exception using errcode = '22023',
      message = 'campaign allocation override request is invalid';
  end if;

  select override.* into v_override
  from planning.campaign_allocation_overrides as override
  where override.workspace_id = v_workspace_id and override.override_key = p_override_key;
  if not found then
    raise exception using errcode = '42501',
      message = 'campaign allocation override is not accessible';
  end if;

  select track.* into strict v_track
  from planning.learning_tracks as track
  where track.workspace_id = v_workspace_id and track.learning_track_id = v_override.learning_track_id;
  select plan.* into strict v_plan
  from planning.growth_plans as plan
  where plan.workspace_id = v_workspace_id and plan.growth_plan_id = v_override.growth_plan_id;
  v_campaign := targets.read_interview_campaign_for_override_source_v1(
    v_workspace_id, v_override.campaign_id
  );

  select coalesce(pg_catalog.sum(
    coalesce(other_override.protected_minimum_minutes_override, other_track.protected_minimum_minutes)
  ), 0)::integer
  into v_active_excluding
  from planning.learning_tracks as other_track
  left join planning.campaign_allocation_overrides as other_override
    on other_override.workspace_id = other_track.workspace_id
    and other_override.learning_track_id = other_track.learning_track_id
    and other_override.lifecycle = 'active'
  where other_track.workspace_id = v_workspace_id
    and other_track.growth_plan_id = v_track.growth_plan_id
    and other_track.lifecycle = 'active'
    and other_track.learning_track_id <> v_track.learning_track_id;

  return planning.build_campaign_allocation_override_change_preview_v1(
    v_workspace_id, v_override.override_id, v_override.override_key, v_campaign->>'campaignKey',
    v_campaign->>'lifecycle', v_track.track_key, v_track.title, v_track.protected_minimum_minutes,
    v_plan.weekly_capacity_minutes, v_active_excluding, v_override.lifecycle,
    v_override.priority_override, v_override.protected_minimum_minutes_override,
    v_override.cadence_per_week_override, v_override.aggregate_version, p_operation,
    p_expected_override_version::bigint, p_priority_override, p_protected_minimum_minutes_override,
    p_cadence_per_week_override, p_reason
  );
end
$function$;

create function api.apply_campaign_allocation_override_v1(
  p_override_key text,
  p_operation text,
  p_expected_override_version text,
  p_priority_override integer,
  p_protected_minimum_minutes_override integer,
  p_cadence_per_week_override integer,
  p_preview_digest text,
  p_reason text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_user_id uuid;
  v_workspace_id uuid;
  v_override planning.campaign_allocation_overrides%rowtype;
  v_track planning.learning_tracks%rowtype;
  v_plan planning.growth_plans%rowtype;
  v_campaign jsonb;
  v_active_excluding integer;
  v_preview jsonb;
  v_payload jsonb;
  v_after_lifecycle text;
  v_command_id uuid := gen_random_uuid();
  v_correlation_id uuid := gen_random_uuid();
  v_event_id uuid := gen_random_uuid();
  v_request_hash bytea;
  v_receipt outbox.command_receipts%rowtype;
  v_response jsonb;
  v_affected_rows integer;
begin
  if identity.jwt_subject() is null then
    raise exception using errcode = '28000', message = 'an authenticated user is required';
  end if;
  v_actor_user_id := identity.current_user_id();
  v_workspace_id := identity.personal_workspace_id_for_current_user();
  if v_actor_user_id is null or v_workspace_id is null then
    raise exception using errcode = '28000', message = 'authenticated user is not provisioned';
  end if;
  if p_override_key is null
     or p_override_key
       !~ '^override:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or p_operation not in (
       'change_campaign_allocation_override', 'remove_campaign_allocation_override'
     )
     or p_expected_override_version is null
     or p_expected_override_version !~ '^[1-9][0-9]{0,18}$'
     or p_expected_override_version::numeric > 9223372036854775807 then
    raise exception using errcode = '22023',
      message = 'campaign allocation override request is invalid';
  end if;
  if p_reason is null or p_reason <> pg_catalog.btrim(p_reason)
     or pg_catalog.char_length(p_reason) not between 1 and 500
     or p_reason ~ '[[:cntrl:]]'
     or p_idempotency_key is null
     or p_idempotency_key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or p_preview_digest is null or p_preview_digest !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023',
      message = 'campaign allocation override confirmation is invalid';
  end if;

  v_request_hash := extensions.digest(
    pg_catalog.convert_to(
      planning.frame_named_fields_v1(
        array[
          'requestHashVersion','schemaVersion','workspaceId','commandType','operation',
          'idempotencyKey','overrideKey','expectedOverrideVersion','priorityOverride',
          'protectedMinimumMinutesOverride','cadencePerWeekOverride','reason','previewDigest'
        ],
        array[
          'campaign-allocation-override-request-hash/1.0.0','1.0.0',
          pg_catalog.lower(v_workspace_id::text),
          'planning.change_campaign_allocation_override_v1',p_operation,p_idempotency_key,
          p_override_key,p_expected_override_version,coalesce(p_priority_override::text,''),
          coalesce(p_protected_minimum_minutes_override::text,''),
          coalesce(p_cadence_per_week_override::text,''),p_reason,p_preview_digest
        ]
      ),
      'UTF8'
    ),
    'sha256'
  );

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    v_actor_user_id::text || ':planning.change_campaign_allocation_override_v1:'
      || p_idempotency_key, 0
  ));
  select receipt.* into v_receipt
  from outbox.command_receipts as receipt
  where receipt.actor_user_id = v_actor_user_id
    and receipt.command_type = 'planning.change_campaign_allocation_override_v1'
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

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('planning-workspace:' || v_workspace_id::text, 0)
  );

  select override.* into v_override
  from planning.campaign_allocation_overrides as override
  where override.workspace_id = v_workspace_id and override.override_key = p_override_key
  for update;
  if not found then
    raise exception using errcode = '42501',
      message = 'campaign allocation override is not accessible';
  end if;

  select track.* into strict v_track
  from planning.learning_tracks as track
  where track.workspace_id = v_workspace_id and track.learning_track_id = v_override.learning_track_id;
  select plan.* into strict v_plan
  from planning.growth_plans as plan
  where plan.workspace_id = v_workspace_id and plan.growth_plan_id = v_override.growth_plan_id;
  v_campaign := targets.read_interview_campaign_for_override_source_v1(
    v_workspace_id, v_override.campaign_id
  );

  select coalesce(pg_catalog.sum(
    coalesce(other_override.protected_minimum_minutes_override, other_track.protected_minimum_minutes)
  ), 0)::integer
  into v_active_excluding
  from planning.learning_tracks as other_track
  left join planning.campaign_allocation_overrides as other_override
    on other_override.workspace_id = other_track.workspace_id
    and other_override.learning_track_id = other_track.learning_track_id
    and other_override.lifecycle = 'active'
  where other_track.workspace_id = v_workspace_id
    and other_track.growth_plan_id = v_track.growth_plan_id
    and other_track.lifecycle = 'active'
    and other_track.learning_track_id <> v_track.learning_track_id;

  v_preview := planning.build_campaign_allocation_override_change_preview_v1(
    v_workspace_id, v_override.override_id, v_override.override_key, v_campaign->>'campaignKey',
    v_campaign->>'lifecycle', v_track.track_key, v_track.title, v_track.protected_minimum_minutes,
    v_plan.weekly_capacity_minutes, v_active_excluding, v_override.lifecycle,
    v_override.priority_override, v_override.protected_minimum_minutes_override,
    v_override.cadence_per_week_override, v_override.aggregate_version, p_operation,
    p_expected_override_version::bigint, p_priority_override, p_protected_minimum_minutes_override,
    p_cadence_per_week_override, p_reason
  );
  if (v_preview->>'canApply')::boolean is not true
     or v_preview->>'previewDigest' is distinct from p_preview_digest then
    raise exception using errcode = '40001',
      message = 'campaign allocation override preview is stale';
  end if;
  v_after_lifecycle := pg_catalog.lower(v_preview#>>'{after,lifecycle}');

  insert into outbox.command_receipts (
    command_id, command_type, command_schema_version, workspace_id, actor_user_id,
    idempotency_key, request_hash, correlation_id, expected_aggregate_version
  ) values (
    v_command_id, 'planning.change_campaign_allocation_override_v1', 1, v_workspace_id,
    v_actor_user_id, p_idempotency_key, v_request_hash, v_correlation_id,
    p_expected_override_version::bigint
  );
  get diagnostics v_affected_rows = row_count;
  if v_affected_rows <> 1 then
    raise exception using errcode = '55000',
      message = 'campaign allocation override receipt insert failed';
  end if;

  update planning.campaign_allocation_overrides
  set lifecycle = v_after_lifecycle,
    priority_override = (v_preview#>>'{after,priorityOverride}')::smallint,
    protected_minimum_minutes_override =
      (v_preview#>>'{after,protectedMinimumMinutesOverride}')::smallint,
    cadence_per_week_override = (v_preview#>>'{after,cadencePerWeekOverride}')::smallint,
    aggregate_version = aggregate_version + 1,
    updated_at = pg_catalog.clock_timestamp()
  where workspace_id = v_workspace_id
    and override_id = v_override.override_id
    and aggregate_version = p_expected_override_version::bigint
    and lifecycle = 'active';
  get diagnostics v_affected_rows = row_count;
  if v_affected_rows <> 1 then
    raise exception using errcode = '40001',
      message = 'campaign allocation override change failed';
  end if;

  v_payload := pg_catalog.jsonb_build_object(
    'change_kind', case when p_operation = 'remove_campaign_allocation_override'
      then 'OVERRIDE_CLOSED' else 'OVERRIDE_CHANGED' end,
    'override_id', v_override.override_id,
    'override_version', (v_override.aggregate_version + 1)::text,
    'learning_track_id', v_override.learning_track_id,
    'lifecycle', pg_catalog.upper(v_after_lifecycle)
  );
  if planning.campaign_allocation_override_changed_event_payload_v1_is_valid(v_payload)
    is not true then
    raise exception using errcode = '55000',
      message = 'campaign allocation override event payload is invalid';
  end if;
  insert into outbox.events (
    event_id, event_name, event_schema_version, workspace_id, aggregate_type,
    aggregate_id, aggregate_version, actor_type, actor_user_id, command_id,
    correlation_id, occurred_at, source, payload
  ) values (
    v_event_id, 'planning.campaign_allocation_override_changed', 1, v_workspace_id,
    'planning.campaign_allocation_override', v_override.override_id,
    v_override.aggregate_version + 1, 'user', v_actor_user_id, v_command_id, v_correlation_id,
    pg_catalog.clock_timestamp(), 'pando.database', v_payload
  );
  get diagnostics v_affected_rows = row_count;
  if v_affected_rows <> 1 then
    raise exception using errcode = '55000',
      message = 'campaign allocation override event insert failed';
  end if;

  v_response := pg_catalog.jsonb_build_object(
    'contract', pg_catalog.jsonb_build_object(
      'name', 'CampaignAllocationOverrideChangeApplyResultV1', 'version', '1.0.0'
    ),
    'commandId', v_command_id,
    'override', v_preview->'after',
    'emittedEventIds', pg_catalog.jsonb_build_array(v_event_id)
  );
  update outbox.command_receipts
  set command_status = 'completed', response = v_response,
    emitted_event_ids = array[v_event_id], completed_at = pg_catalog.clock_timestamp()
  where command_id = v_command_id;
  get diagnostics v_affected_rows = row_count;
  if v_affected_rows <> 1 then
    raise exception using errcode = '55000',
      message = 'campaign allocation override receipt completion failed';
  end if;
  return v_response;
end
$function$;

-- ---------------------------------------------------------------------------------------------
-- Read boundary
-- ---------------------------------------------------------------------------------------------

create function api.get_campaign_allocation_overrides_v1()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_workspace_id uuid;
  v_row record;
  v_campaign jsonb;
  v_overrides jsonb := '[]'::jsonb;
begin
  if identity.jwt_subject() is null then
    raise exception using errcode = '28000', message = 'an authenticated user is required';
  end if;
  v_workspace_id := identity.personal_workspace_id_for_current_user();
  if v_workspace_id is null then
    raise exception using errcode = '28000', message = 'authenticated user is not provisioned';
  end if;

  -- Planning does not own targets.interview_campaigns, so each campaign's key is resolved through
  -- the same granted bounded read the direct override-change command uses, rather than a raw SQL
  -- join across the ownership boundary.
  for v_row in
    select override.override_key, override.lifecycle, override.priority_override,
      override.protected_minimum_minutes_override, override.cadence_per_week_override,
      override.aggregate_version, override.campaign_id, track.track_key, track.title
    from planning.campaign_allocation_overrides as override
    join planning.learning_tracks as track on track.learning_track_id = override.learning_track_id
    where override.workspace_id = v_workspace_id
    order by override.created_at desc, override.override_key collate "C"
  loop
    v_campaign := targets.read_interview_campaign_for_override_source_v1(
      v_workspace_id, v_row.campaign_id
    );
    v_overrides := v_overrides || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'overrideKey', v_row.override_key,
      'campaignKey', v_campaign->>'campaignKey',
      'learningTrack', pg_catalog.jsonb_build_object(
        'trackKey', v_row.track_key, 'title', v_row.title
      ),
      'lifecycle', pg_catalog.upper(v_row.lifecycle),
      'priorityOverride', v_row.priority_override,
      'protectedMinimumMinutesOverride', v_row.protected_minimum_minutes_override,
      'cadencePerWeekOverride', v_row.cadence_per_week_override,
      'aggregateVersion', v_row.aggregate_version::text,
      'capabilities', case v_row.lifecycle
        when 'active' then pg_catalog.jsonb_build_array(
          'change_campaign_allocation_override', 'remove_campaign_allocation_override'
        )
        else '[]'::jsonb
      end
    ));
  end loop;

  return pg_catalog.jsonb_build_object(
    'contract', pg_catalog.jsonb_build_object(
      'name', 'CampaignAllocationOverridesV1', 'version', '1.0.0'
    ),
    'overrides', v_overrides
  );
end
$function$;

-- ---------------------------------------------------------------------------------------------
-- 2) Guard: a campaign with active overrides cannot be ended or cancelled through the plain D4
-- lifecycle command any more. ADR-0010 section 7 makes end_campaign/cancel_campaign coordinator
-- operations precisely because closing installed overrides must be atomic with the lifecycle
-- change; bypassing the coordinator would strand them "active" forever. This is a narrow,
-- additive guard on the existing D4 apply function (evolved via create or replace, its migration
-- file untouched); the released 050/051 pgTAP suite installs no override, so its assertions are
-- unaffected. See docs/implementation/PHASE_4B_D5_ALLOCATIONS_STATUS.md.
-- ---------------------------------------------------------------------------------------------

create function planning.has_active_campaign_allocation_override_v1(
  p_workspace_id uuid,
  p_campaign_id uuid
)
returns boolean
language sql
stable
strict
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from planning.campaign_allocation_overrides as override
    where override.workspace_id = p_workspace_id
      and override.campaign_id = p_campaign_id
      and override.lifecycle = 'active'
  )
$function$;

revoke all on function planning.has_active_campaign_allocation_override_v1(uuid, uuid)
  from public, anon, authenticated, service_role;
alter function planning.has_active_campaign_allocation_override_v1(uuid, uuid)
  owner to pando_planning_api;
set role pando_planning_api;
grant execute on function planning.has_active_campaign_allocation_override_v1(uuid, uuid)
  to pando_phase1_api;
reset role;

-- A table-level guard (rather than replacing the released D4 apply function) enforces the
-- invariant regardless of call path: it fires for every lifecycle-changing UPDATE on
-- targets.interview_campaigns, including the plain D4 command and any future caller, and it is
-- satisfied by construction on the coordinator's own path because the coordinator always closes a
-- campaign's overrides before flipping its lifecycle (see the hooks below).
create function targets.guard_interview_campaign_lifecycle_overrides()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.lifecycle in ('ended', 'cancelled')
     and old.lifecycle is distinct from new.lifecycle
     and planning.has_active_campaign_allocation_override_v1(new.workspace_id, new.campaign_id)
       is true then
    raise exception using errcode = '22023',
      message = 'Interview Campaign has active allocation overrides;'
        || ' end or cancel it through the campaign lifecycle coordinator';
  end if;
  return new;
end
$function$;

create trigger interview_campaigns_guard_lifecycle_overrides
before update on targets.interview_campaigns
for each row execute function targets.guard_interview_campaign_lifecycle_overrides();

revoke all on function targets.guard_interview_campaign_lifecycle_overrides()
  from public, anon, authenticated, service_role;
alter function targets.guard_interview_campaign_lifecycle_overrides()
  owner to pando_phase1_api;

-- ---------------------------------------------------------------------------------------------
-- 3) Cross-context bounded read sources for the coordinator (ADR-0009: purpose-specific
-- cross-module command coordination; ADR-0010 section 7). Each is owned by its own single-purpose
-- NOLOGIN role, mirroring every other "_source_v1" boundary crossing already released, and is
-- granted execute only to the coordinator's own role.
-- ---------------------------------------------------------------------------------------------

create function targets.read_interview_campaign_coordination_source_v1(
  p_workspace_id uuid,
  p_campaign_key text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_campaign targets.interview_campaigns%rowtype;
begin
  if p_workspace_id is null or p_campaign_key is null then
    raise exception using errcode = '22023',
      message = 'campaign coordination source input is invalid';
  end if;
  select campaign.* into v_campaign
  from targets.interview_campaigns as campaign
  where campaign.workspace_id = p_workspace_id and campaign.campaign_key = p_campaign_key;
  if not found then
    raise exception using errcode = '42501', message = 'Interview Campaign is not accessible';
  end if;
  return pg_catalog.jsonb_build_object(
    'campaignId', v_campaign.campaign_id,
    'campaignKey', v_campaign.campaign_key,
    'title', v_campaign.title,
    'lifecycle', v_campaign.lifecycle,
    'aggregateVersion', v_campaign.aggregate_version::text,
    'fence', 'targets-campaign-coordination:' || v_campaign.campaign_id::text
  );
end
$function$;

alter function targets.read_interview_campaign_coordination_source_v1(uuid, text)
  owner to pando_phase1_agent_control_source;
revoke all on function targets.read_interview_campaign_coordination_source_v1(uuid, text)
  from public, anon, authenticated, service_role;
revoke create on schema targets from pando_phase1_agent_control_source;
set role pando_phase1_agent_control_source;
grant execute on function targets.read_interview_campaign_coordination_source_v1(uuid, text)
  to pando_agent_control_api;
reset role;

create function planning.read_campaign_lifecycle_coordination_source_v1(
  p_workspace_id uuid,
  p_campaign_id uuid,
  p_operation text,
  p_track_keys text[]
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_plan planning.growth_plans%rowtype;
  v_tracks jsonb;
  v_active_tracks jsonb;
  v_existing_overrides jsonb;
begin
  if p_workspace_id is null or p_operation is null or p_track_keys is null then
    raise exception using errcode = '22023',
      message = 'campaign lifecycle coordination source input is invalid';
  end if;

  select plan.* into v_plan
  from planning.growth_plans as plan
  where plan.workspace_id = p_workspace_id and plan.lifecycle in ('active', 'paused');

  if p_operation = 'start_campaign' then
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'trackKey', track.track_key,
      'learningTrackId', track.learning_track_id,
      'growthPlanId', track.growth_plan_id,
      'title', track.title,
      'lifecycle', track.lifecycle,
      'aggregateVersion', track.aggregate_version::text,
      'protectedMinimumMinutes', track.protected_minimum_minutes,
      'hasActiveOverride', exists (
        select 1 from planning.campaign_allocation_overrides as existing
        where existing.workspace_id = track.workspace_id
          and existing.learning_track_id = track.learning_track_id
          and existing.lifecycle = 'active'
      )
    )), '[]'::jsonb)
    into v_tracks
    from planning.learning_tracks as track
    where track.workspace_id = p_workspace_id
      and track.track_key = any(p_track_keys);

    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'learningTrackId', track.learning_track_id,
      'protectedMinimumMinutes', track.protected_minimum_minutes,
      'activeOverrideProtectedMinimumMinutesOverride', override.protected_minimum_minutes_override
    )), '[]'::jsonb)
    into v_active_tracks
    from planning.learning_tracks as track
    left join planning.campaign_allocation_overrides as override
      on override.workspace_id = track.workspace_id
      and override.learning_track_id = track.learning_track_id
      and override.lifecycle = 'active'
    where track.workspace_id = p_workspace_id
      and track.growth_plan_id = v_plan.growth_plan_id
      and track.lifecycle = 'active';
    v_existing_overrides := '[]'::jsonb;
  else
    v_tracks := '[]'::jsonb;
    v_active_tracks := '[]'::jsonb;
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'overrideId', override.override_id,
      'overrideKey', override.override_key,
      'learningTrackId', override.learning_track_id,
      'aggregateVersion', override.aggregate_version::text
    ) order by override.override_key collate "C"), '[]'::jsonb)
    into v_existing_overrides
    from planning.campaign_allocation_overrides as override
    where override.workspace_id = p_workspace_id
      and override.campaign_id = p_campaign_id
      and override.lifecycle = 'active';
  end if;

  return pg_catalog.jsonb_build_object(
    'hasCurrentPlan', v_plan.growth_plan_id is not null,
    'currentPlan', case when v_plan.growth_plan_id is null then null else pg_catalog.jsonb_build_object(
      'growthPlanId', v_plan.growth_plan_id, 'lifecycle', v_plan.lifecycle,
      'aggregateVersion', v_plan.aggregate_version::text,
      'weeklyCapacityMinutes', v_plan.weekly_capacity_minutes
    ) end,
    'tracks', v_tracks,
    'activeTracks', v_active_tracks,
    'existingActiveOverrides', v_existing_overrides,
    'fence', 'planning-campaign-coordination:' || p_workspace_id::text
  );
end
$function$;

alter function planning.read_campaign_lifecycle_coordination_source_v1(uuid, uuid, text, text[])
  owner to pando_planning_agent_control_source;
revoke all on function
  planning.read_campaign_lifecycle_coordination_source_v1(uuid, uuid, text, text[])
  from public, anon, authenticated, service_role;
revoke create on schema planning from pando_planning_agent_control_source;
set role pando_planning_agent_control_source;
grant execute on function
  planning.read_campaign_lifecycle_coordination_source_v1(uuid, uuid, text, text[])
  to pando_agent_control_api;
reset role;

-- ---------------------------------------------------------------------------------------------
-- 4) The coordinator's own digest helper and preview builder. Bounded contexts do not call across
-- schemas for pure utility code (see targets.frame_named_fields_v1), so Agent Control keeps its
-- own copy exactly as Targets and Planning each already do.
-- ---------------------------------------------------------------------------------------------

create function agent_control.frame_named_fields_v1(p_names text[], p_values text[])
returns text
language sql
immutable
strict
set search_path = ''
as $function$
  select case
    when pg_catalog.cardinality(p_names) <> pg_catalog.cardinality(p_values)
      then null
    else coalesce(pg_catalog.string_agg(
      p_names[position] || ':'
        || pg_catalog.octet_length(
          pg_catalog.convert_to(coalesce(p_values[position], ''), 'UTF8')
        )::text
        || ':' || coalesce(p_values[position], '') || pg_catalog.chr(10),
      '' order by position
    ), '')
  end
  from pg_catalog.generate_subscripts(p_names, 1) as position
$function$;

-- Pure computation over bounded source data already fetched under the caller's read; it performs
-- no table access itself, matching every other released preview builder.
create function agent_control.build_campaign_lifecycle_coordination_preview_v1(
  p_workspace_id uuid,
  p_operation text,
  p_expected_campaign_version bigint,
  p_reason text,
  p_idempotency_key text,
  p_campaign_source jsonb,
  p_plan_source jsonb,
  p_override_intents jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_campaign_id uuid;
  v_campaign_key text;
  v_title text;
  v_lifecycle text;
  v_aggregate_version bigint;
  v_after_lifecycle text;
  v_after_version bigint;
  v_has_current_plan boolean;
  v_blockers jsonb := '[]'::jsonb;
  v_can_apply boolean;
  v_installed jsonb := '[]'::jsonb;
  v_closed jsonb := '[]'::jsonb;
  v_intent jsonb;
  v_track jsonb;
  v_override_count integer;
  v_seen_track_keys text[] := '{}'::text[];
  v_track_key text;
  v_expected_track_version text;
  v_priority integer;
  v_protected_minimum integer;
  v_cadence integer;
  v_capacity_total integer;
  v_weekly_capacity integer;
  v_override_id uuid;
  v_override_key text;
  v_installed_track_ids uuid[] := '{}'::uuid[];
  v_installed_protected_minutes integer[] := '{}'::integer[];
  v_digest_input text;
  v_digest text;
begin
  if p_workspace_id is null or p_operation is null or p_expected_campaign_version is null
     or p_expected_campaign_version < 1 or p_idempotency_key is null
     or p_campaign_source is null or p_plan_source is null or p_override_intents is null then
    raise exception using errcode = '22023',
      message = 'campaign lifecycle coordination preview input is invalid';
  end if;
  if p_operation not in ('start_campaign', 'end_campaign', 'cancel_campaign') then
    raise exception using errcode = '22023',
      message = 'campaign lifecycle coordination operation is invalid';
  end if;
  if p_reason is null or p_reason <> pg_catalog.btrim(p_reason)
     or pg_catalog.char_length(p_reason) not between 1 and 500
     or p_reason ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023',
      message = 'campaign lifecycle coordination reason is invalid';
  end if;
  v_override_count := pg_catalog.jsonb_array_length(p_override_intents);
  if p_operation <> 'start_campaign' and v_override_count <> 0 then
    raise exception using errcode = '22023',
      message = 'campaign lifecycle coordination overrides are only accepted for start_campaign';
  end if;
  if v_override_count > 20 then
    raise exception using errcode = '22023',
      message = 'campaign lifecycle coordination accepts at most 20 overrides';
  end if;

  v_campaign_id := (p_campaign_source->>'campaignId')::uuid;
  v_campaign_key := p_campaign_source->>'campaignKey';
  v_title := p_campaign_source->>'title';
  v_lifecycle := p_campaign_source->>'lifecycle';
  v_aggregate_version := (p_campaign_source->>'aggregateVersion')::bigint;
  v_has_current_plan := (p_plan_source->>'hasCurrentPlan')::boolean;

  if p_expected_campaign_version <> v_aggregate_version then
    raise exception using errcode = '40001', message = 'Interview Campaign version is stale';
  end if;
  if v_aggregate_version = 9223372036854775807 then
    raise exception using errcode = '22003', message = 'Interview Campaign version is exhausted';
  end if;

  if p_operation = 'start_campaign' and v_lifecycle = 'draft' then
    v_after_lifecycle := 'active';
  elsif p_operation = 'end_campaign' and v_lifecycle = 'active' then
    v_after_lifecycle := 'ended';
  elsif p_operation = 'cancel_campaign' and v_lifecycle in ('draft', 'active') then
    v_after_lifecycle := 'cancelled';
  else
    raise exception using errcode = '22023',
      message = 'Interview Campaign lifecycle transition is invalid';
  end if;
  v_after_version := v_aggregate_version + 1;

  if p_operation = 'start_campaign' and v_override_count > 0 then
    if not v_has_current_plan then
      v_blockers := v_blockers || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('code', 'ALLOCATION_OVERRIDE_NO_CURRENT_PLAN')
      );
    end if;

    for v_intent in select * from pg_catalog.jsonb_array_elements(p_override_intents)
    loop
      v_track_key := v_intent->>'trackKey';
      v_expected_track_version := v_intent->>'expectedTrackVersion';
      v_priority := (v_intent->>'priorityOverride')::integer;
      v_protected_minimum := (v_intent->>'protectedMinimumMinutesOverride')::integer;
      v_cadence := (v_intent->>'cadencePerWeekOverride')::integer;

      if v_track_key is null or v_track_key !~ '^track:[a-z0-9][a-z0-9-]{1,100}$'
         or v_expected_track_version is null
         or v_expected_track_version !~ '^[1-9][0-9]{0,18}$' then
        raise exception using errcode = '22023',
          message = 'campaign lifecycle coordination override intent is invalid';
      end if;
      if v_track_key = any(v_seen_track_keys) then
        raise exception using errcode = '22023',
          message = 'campaign lifecycle coordination overrides must reference distinct Tracks';
      end if;
      v_seen_track_keys := v_seen_track_keys || v_track_key;
      if v_priority is null and v_protected_minimum is null and v_cadence is null then
        raise exception using errcode = '22023',
          message = 'campaign lifecycle coordination override must set at least one field';
      end if;
      if v_priority is not null and v_priority not between 0 and 100 then
        raise exception using errcode = '22023',
          message = 'campaign allocation priority override is out of range';
      end if;
      if v_protected_minimum is not null and v_protected_minimum not between 0 and 10080 then
        raise exception using errcode = '22023',
          message = 'campaign allocation protected-minimum override is out of range';
      end if;
      if v_cadence is not null and v_cadence not between 0 and 100 then
        raise exception using errcode = '22023',
          message = 'campaign allocation cadence override is out of range';
      end if;

      select track into v_track
      from pg_catalog.jsonb_array_elements(p_plan_source->'tracks') as track
      where track->>'trackKey' = v_track_key;

      if v_track is null then
        raise exception using errcode = '42501', message = 'Learning Track is not accessible';
      end if;
      if (v_track->>'aggregateVersion') <> v_expected_track_version then
        v_blockers := v_blockers || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'code', 'ALLOCATION_OVERRIDE_TRACK_VERSION_STALE', 'trackKey', v_track_key
        ));
      end if;
      if v_track->>'lifecycle' <> 'active' then
        v_blockers := v_blockers || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'code', 'ALLOCATION_OVERRIDE_TRACK_NOT_ACTIVE', 'trackKey', v_track_key
        ));
      end if;
      if (v_track->>'hasActiveOverride')::boolean is true then
        v_blockers := v_blockers || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'code', 'ALLOCATION_OVERRIDE_TRACK_ALREADY_OVERRIDDEN', 'trackKey', v_track_key
        ));
      end if;
      -- The floor invariant (ADR-0010 section 5) is a structural input error, not a
      -- state-dependent condition, so it is raised the same way as an out-of-range value rather
      -- than enumerated as a soft blocker (matching planning.build_campaign_allocation_override_
      -- change_preview_v1's identical check for the direct edit/remove command).
      if v_protected_minimum is not null
         and v_protected_minimum < (v_track->>'protectedMinimumMinutes')::integer then
        raise exception using errcode = '23514',
          message = 'campaign protected-minimum override must not be lower than the Track floor';
      end if;

      v_override_id := planning.derive_campaign_allocation_override_identity_v1(
        p_workspace_id, 'agent_control.coordinate_campaign_lifecycle_v1', p_idempotency_key,
        v_track_key
      );
      v_override_key := 'override:' || pg_catalog.lower(v_override_id::text);

      v_installed := v_installed || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'overrideKey', v_override_key,
        'learningTrack', pg_catalog.jsonb_build_object(
          'trackKey', v_track_key, 'expectedVersion', v_expected_track_version
        ),
        'lifecycle', 'ACTIVE',
        'priorityOverride', v_priority,
        'protectedMinimumMinutesOverride', v_protected_minimum,
        'cadencePerWeekOverride', v_cadence,
        'aggregateVersion', '1'
      ));
      v_installed_track_ids := v_installed_track_ids || (v_track->>'learningTrackId')::uuid;
      v_installed_protected_minutes := v_installed_protected_minutes ||
        coalesce(v_protected_minimum, (v_track->>'protectedMinimumMinutes')::integer);
    end loop;

    if v_has_current_plan then
      v_weekly_capacity := (p_plan_source#>>'{currentPlan,weeklyCapacityMinutes}')::integer;
      select coalesce(pg_catalog.sum(
        case
          when (active_track->>'learningTrackId')::uuid = any(v_installed_track_ids) then 0
          else coalesce(
            (active_track->>'activeOverrideProtectedMinimumMinutesOverride')::integer,
            (active_track->>'protectedMinimumMinutes')::integer
          )
        end
      ), 0)
      into v_capacity_total
      from pg_catalog.jsonb_array_elements(p_plan_source->'activeTracks') as active_track;

      v_capacity_total := v_capacity_total
        + coalesce((
          select pg_catalog.sum(value)
          from pg_catalog.unnest(v_installed_protected_minutes) as value
        ), 0);

      if v_capacity_total > v_weekly_capacity then
        v_blockers := v_blockers || pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object('code', 'ALLOCATION_OVERRIDE_EXCEEDS_CAPACITY')
        );
      end if;
    end if;
  elsif p_operation <> 'start_campaign' then
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'overrideKey', closing->>'overrideKey',
      'lifecycle', 'SUPERSEDED'
    ) order by closing->>'overrideKey'), '[]'::jsonb)
    into v_closed
    from pg_catalog.jsonb_array_elements(p_plan_source->'existingActiveOverrides') as closing;
  end if;

  v_can_apply := pg_catalog.jsonb_array_length(v_blockers) = 0;

  v_digest_input := agent_control.frame_named_fields_v1(
    array[
      'digestVersion','contractVersion','workspaceId','operation','commandType','idempotencyKey',
      'reason','campaignId','campaignKey','title','beforeLifecycle','afterLifecycle',
      'beforeAggregateVersion','afterAggregateVersion','installedOverrides','closedOverrides',
      'canApply'
    ],
    array[
      'campaign-lifecycle-coordination-preview-digest/1.0.0','1.0.0',
      pg_catalog.lower(p_workspace_id::text),p_operation,
      'agent_control.coordinate_campaign_lifecycle_v1',p_idempotency_key,p_reason,
      pg_catalog.lower(v_campaign_id::text),v_campaign_key,v_title,
      pg_catalog.upper(v_lifecycle),pg_catalog.upper(v_after_lifecycle),
      v_aggregate_version::text,v_after_version::text,v_installed::text,v_closed::text,
      pg_catalog.lower(v_can_apply::text)
    ]
  );
  v_digest := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(v_digest_input, 'UTF8'), 'sha256'), 'hex'
  );

  return pg_catalog.jsonb_build_object(
    'contract', pg_catalog.jsonb_build_object(
      'name', 'CampaignLifecycleCoordinationPreviewV1', 'version', '1.0.0'
    ),
    'operation', p_operation,
    'commandType', 'agent_control.coordinate_campaign_lifecycle_v1',
    'reason', p_reason,
    'idempotencyKey', p_idempotency_key,
    'campaign', pg_catalog.jsonb_build_object(
      'before', pg_catalog.jsonb_build_object(
        'campaignId', v_campaign_id, 'campaignKey', v_campaign_key, 'title', v_title,
        'lifecycle', pg_catalog.upper(v_lifecycle), 'aggregateVersion', v_aggregate_version::text
      ),
      'after', pg_catalog.jsonb_build_object(
        'campaignId', v_campaign_id, 'campaignKey', v_campaign_key, 'title', v_title,
        'lifecycle', pg_catalog.upper(v_after_lifecycle), 'aggregateVersion', v_after_version::text
      )
    ),
    'overrides', pg_catalog.jsonb_build_object('installed', v_installed, 'closed', v_closed),
    'canApply', v_can_apply,
    'blockingReasons', v_blockers,
    'warnings', '[]'::jsonb,
    'previewDigest', v_digest
  );
end
$function$;

revoke all on function agent_control.frame_named_fields_v1(text[], text[])
  from public, anon, authenticated, service_role;
revoke all on function agent_control.build_campaign_lifecycle_coordination_preview_v1(
  uuid, text, bigint, text, text, jsonb, jsonb, jsonb
) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 5) Private owner hooks. ADR-0010 section 7: the coordinator "calls private owner hooks that
-- repeat their own lifecycle, cardinality, and version validation" -- each hook independently
-- re-derives and re-checks its own preconditions rather than trusting the coordinator's preview,
-- and each hook owns and mutates only its own schema's rows.
-- ---------------------------------------------------------------------------------------------

create function targets.apply_interview_campaign_lifecycle_hook_v1(
  p_command_id uuid,
  p_correlation_id uuid,
  p_workspace_id uuid,
  p_campaign_id uuid,
  p_expected_campaign_version bigint,
  p_operation text,
  p_actor_user_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_campaign targets.interview_campaigns%rowtype;
  v_preview jsonb;
  v_after_lifecycle text;
  v_payload jsonb;
  v_event_id uuid := gen_random_uuid();
  v_affected_rows integer;
begin
  if p_command_id is null or p_correlation_id is null or p_workspace_id is null
     or p_campaign_id is null or p_expected_campaign_version is null
     or p_expected_campaign_version < 1 or p_operation is null or p_actor_user_id is null then
    raise exception using errcode = '22023',
      message = 'Interview Campaign lifecycle hook input is invalid';
  end if;
  if p_operation not in ('start_campaign', 'end_campaign', 'cancel_campaign') then
    raise exception using errcode = '22023',
      message = 'Interview Campaign lifecycle operation is invalid';
  end if;

  select campaign.* into v_campaign
  from targets.interview_campaigns as campaign
  where campaign.workspace_id = p_workspace_id and campaign.campaign_id = p_campaign_id
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'Interview Campaign is not accessible';
  end if;

  v_preview := targets.build_interview_campaign_lifecycle_preview_v1(
    p_workspace_id, v_campaign.campaign_id, v_campaign.campaign_key, v_campaign.title,
    v_campaign.lifecycle, v_campaign.aggregate_version, p_operation,
    p_expected_campaign_version, p_reason
  );
  v_after_lifecycle := pg_catalog.lower(v_preview#>>'{after,lifecycle}');

  update targets.interview_campaigns
  set lifecycle = v_after_lifecycle,
    aggregate_version = aggregate_version + 1,
    updated_at = pg_catalog.clock_timestamp()
  where workspace_id = p_workspace_id
    and campaign_id = v_campaign.campaign_id
    and aggregate_version = p_expected_campaign_version
    and lifecycle = v_campaign.lifecycle;
  get diagnostics v_affected_rows = row_count;
  if v_affected_rows <> 1 then
    raise exception using errcode = '40001',
      message = 'Interview Campaign lifecycle change failed';
  end if;

  v_payload := pg_catalog.jsonb_build_object(
    'change_kind', 'CAMPAIGN_LIFECYCLE_CHANGED',
    'campaign_id', v_campaign.campaign_id,
    'campaign_version', (v_campaign.aggregate_version + 1)::text,
    'lifecycle', pg_catalog.upper(v_after_lifecycle)
  );
  if targets.campaign_lifecycle_event_payload_v1_is_valid(v_payload) is not true then
    raise exception using errcode = '55000',
      message = 'Interview Campaign lifecycle event payload is invalid';
  end if;
  insert into outbox.events (
    event_id, event_name, event_schema_version, workspace_id, aggregate_type,
    aggregate_id, aggregate_version, actor_type, actor_user_id, command_id,
    correlation_id, occurred_at, source, payload
  ) values (
    v_event_id, 'targets.interview_campaign_changed', 1, p_workspace_id,
    'targets.interview_campaign', v_campaign.campaign_id, v_campaign.aggregate_version + 1,
    'user', p_actor_user_id, p_command_id, p_correlation_id, pg_catalog.clock_timestamp(),
    'pando.database', v_payload
  );
  get diagnostics v_affected_rows = row_count;
  if v_affected_rows <> 1 then
    raise exception using errcode = '55000',
      message = 'Interview Campaign lifecycle event insert failed';
  end if;

  return pg_catalog.jsonb_build_object('campaign', v_preview->'after', 'eventId', v_event_id);
end
$function$;

revoke all on function targets.apply_interview_campaign_lifecycle_hook_v1(
  uuid, uuid, uuid, uuid, bigint, text, uuid, text
) from public, anon, authenticated, service_role;

create function planning.install_campaign_allocation_overrides_hook_v1(
  p_command_id uuid,
  p_correlation_id uuid,
  p_workspace_id uuid,
  p_campaign_id uuid,
  p_actor_user_id uuid,
  p_installed jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_item jsonb;
  v_override_key text;
  v_track_key text;
  v_expected_track_version bigint;
  v_track planning.learning_tracks%rowtype;
  v_override_id uuid;
  v_priority integer;
  v_protected_minimum integer;
  v_cadence integer;
  v_event_id uuid;
  v_results jsonb := '[]'::jsonb;
  v_event_ids uuid[] := '{}'::uuid[];
  v_affected_rows integer;
  v_payload jsonb;
begin
  if p_command_id is null or p_correlation_id is null or p_workspace_id is null
     or p_campaign_id is null or p_actor_user_id is null or p_installed is null then
    raise exception using errcode = '22023',
      message = 'campaign allocation override installation hook input is invalid';
  end if;

  for v_item in select * from pg_catalog.jsonb_array_elements(p_installed)
  loop
    v_override_key := v_item->>'overrideKey';
    v_track_key := v_item#>>'{learningTrack,trackKey}';
    v_expected_track_version := (v_item#>>'{learningTrack,expectedVersion}')::bigint;
    v_priority := (v_item->>'priorityOverride')::integer;
    v_protected_minimum := (v_item->>'protectedMinimumMinutesOverride')::integer;
    v_cadence := (v_item->>'cadencePerWeekOverride')::integer;

    if v_override_key is null or v_track_key is null or v_expected_track_version is null then
      raise exception using errcode = '22023',
        message = 'campaign allocation override installation item is invalid';
    end if;

    select track.* into v_track
    from planning.learning_tracks as track
    where track.workspace_id = p_workspace_id and track.track_key = v_track_key
    for update;
    if not found then
      raise exception using errcode = '42501', message = 'Learning Track is not accessible';
    end if;
    if v_track.lifecycle <> 'active' then
      raise exception using errcode = '22023', message = 'Learning Track is not active';
    end if;
    if v_track.aggregate_version <> v_expected_track_version then
      raise exception using errcode = '40001', message = 'Learning Track version is stale';
    end if;
    if not exists (
      select 1 from planning.growth_plans as plan
      where plan.workspace_id = p_workspace_id and plan.growth_plan_id = v_track.growth_plan_id
        and plan.lifecycle in ('active', 'paused')
    ) then
      raise exception using errcode = '22023',
        message = 'Learning Track does not belong to the current Growth Plan';
    end if;
    if v_protected_minimum is not null and v_protected_minimum < v_track.protected_minimum_minutes
    then
      raise exception using errcode = '23514',
        message = 'campaign protected-minimum override must not be lower than the Track floor';
    end if;

    v_override_id := (pg_catalog.regexp_replace(v_override_key, '^override:', ''))::uuid;

    insert into planning.campaign_allocation_overrides (
      override_id, workspace_id, growth_plan_id, learning_track_id, campaign_id, override_key,
      priority_override, protected_minimum_minutes_override, cadence_per_week_override,
      lifecycle, aggregate_version
    ) values (
      v_override_id, p_workspace_id, v_track.growth_plan_id, v_track.learning_track_id,
      p_campaign_id, v_override_key, v_priority, v_protected_minimum, v_cadence, 'active', 1
    );
    get diagnostics v_affected_rows = row_count;
    if v_affected_rows <> 1 then
      raise exception using errcode = '55000',
        message = 'campaign allocation override insert failed';
    end if;

    v_event_id := gen_random_uuid();
    v_payload := pg_catalog.jsonb_build_object(
      'change_kind', 'OVERRIDE_INSTALLED',
      'override_id', v_override_id,
      'override_version', '1',
      'learning_track_id', v_track.learning_track_id,
      'lifecycle', 'ACTIVE'
    );
    if planning.campaign_allocation_override_changed_event_payload_v1_is_valid(v_payload)
      is not true then
      raise exception using errcode = '55000',
        message = 'campaign allocation override event payload is invalid';
    end if;
    insert into outbox.events (
      event_id, event_name, event_schema_version, workspace_id, aggregate_type,
      aggregate_id, aggregate_version, actor_type, actor_user_id, command_id,
      correlation_id, occurred_at, source, payload
    ) values (
      v_event_id, 'planning.campaign_allocation_override_changed', 1, p_workspace_id,
      'planning.campaign_allocation_override', v_override_id, 1, 'user', p_actor_user_id,
      p_command_id, p_correlation_id, pg_catalog.clock_timestamp(), 'pando.database', v_payload
    );
    get diagnostics v_affected_rows = row_count;
    if v_affected_rows <> 1 then
      raise exception using errcode = '55000',
        message = 'campaign allocation override event insert failed';
    end if;

    v_event_ids := v_event_ids || v_event_id;
    v_results := v_results || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'overrideKey', v_override_key,
      'learningTrack', pg_catalog.jsonb_build_object(
        'trackKey', v_track_key, 'title', v_track.title
      ),
      'lifecycle', 'ACTIVE',
      'priorityOverride', v_priority,
      'protectedMinimumMinutesOverride', v_protected_minimum,
      'cadencePerWeekOverride', v_cadence,
      'aggregateVersion', '1'
    ));
  end loop;

  return pg_catalog.jsonb_build_object(
    'overrides', v_results, 'eventIds', pg_catalog.to_jsonb(v_event_ids)
  );
end
$function$;

revoke all on function planning.install_campaign_allocation_overrides_hook_v1(
  uuid, uuid, uuid, uuid, uuid, jsonb
) from public, anon, authenticated, service_role;

create function planning.close_campaign_allocation_overrides_hook_v1(
  p_command_id uuid,
  p_correlation_id uuid,
  p_workspace_id uuid,
  p_campaign_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_override planning.campaign_allocation_overrides%rowtype;
  v_event_id uuid;
  v_results jsonb := '[]'::jsonb;
  v_event_ids uuid[] := '{}'::uuid[];
  v_affected_rows integer;
  v_payload jsonb;
begin
  if p_command_id is null or p_correlation_id is null or p_workspace_id is null
     or p_campaign_id is null or p_actor_user_id is null then
    raise exception using errcode = '22023',
      message = 'campaign allocation override closing hook input is invalid';
  end if;

  for v_override in
    select override.* from planning.campaign_allocation_overrides as override
    where override.workspace_id = p_workspace_id and override.campaign_id = p_campaign_id
      and override.lifecycle = 'active'
    order by override.override_key collate "C"
    for update
  loop
    update planning.campaign_allocation_overrides
    set lifecycle = 'superseded',
      aggregate_version = aggregate_version + 1,
      updated_at = pg_catalog.clock_timestamp()
    where workspace_id = p_workspace_id
      and override_id = v_override.override_id
      and aggregate_version = v_override.aggregate_version
      and lifecycle = 'active';
    get diagnostics v_affected_rows = row_count;
    if v_affected_rows <> 1 then
      raise exception using errcode = '40001',
        message = 'campaign allocation override close failed';
    end if;

    v_event_id := gen_random_uuid();
    v_payload := pg_catalog.jsonb_build_object(
      'change_kind', 'OVERRIDE_CLOSED',
      'override_id', v_override.override_id,
      'override_version', (v_override.aggregate_version + 1)::text,
      'learning_track_id', v_override.learning_track_id,
      'lifecycle', 'SUPERSEDED'
    );
    if planning.campaign_allocation_override_changed_event_payload_v1_is_valid(v_payload)
      is not true then
      raise exception using errcode = '55000',
        message = 'campaign allocation override event payload is invalid';
    end if;
    insert into outbox.events (
      event_id, event_name, event_schema_version, workspace_id, aggregate_type,
      aggregate_id, aggregate_version, actor_type, actor_user_id, command_id,
      correlation_id, occurred_at, source, payload
    ) values (
      v_event_id, 'planning.campaign_allocation_override_changed', 1, p_workspace_id,
      'planning.campaign_allocation_override', v_override.override_id,
      v_override.aggregate_version + 1, 'user', p_actor_user_id, p_command_id, p_correlation_id,
      pg_catalog.clock_timestamp(), 'pando.database', v_payload
    );
    get diagnostics v_affected_rows = row_count;
    if v_affected_rows <> 1 then
      raise exception using errcode = '55000',
        message = 'campaign allocation override event insert failed';
    end if;

    v_event_ids := v_event_ids || v_event_id;
    v_results := v_results || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'overrideKey', v_override.override_key,
      'lifecycle', 'SUPERSEDED',
      'aggregateVersion', (v_override.aggregate_version + 1)::text
    ));
  end loop;

  return pg_catalog.jsonb_build_object(
    'overrides', v_results, 'eventIds', pg_catalog.to_jsonb(v_event_ids)
  );
end
$function$;

revoke all on function planning.close_campaign_allocation_overrides_hook_v1(
  uuid, uuid, uuid, uuid, uuid
) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 6) The coordinator's api entry points.
-- ---------------------------------------------------------------------------------------------

create function api.preview_campaign_lifecycle_coordination_v1(
  p_campaign_key text,
  p_operation text,
  p_expected_campaign_version text,
  p_reason text,
  p_overrides jsonb,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_workspace_id uuid;
  v_campaign_source jsonb;
  v_campaign_id uuid;
  v_track_keys text[];
  v_plan_source jsonb;
begin
  if identity.jwt_subject() is null then
    raise exception using errcode = '28000', message = 'an authenticated user is required';
  end if;
  v_workspace_id := identity.personal_workspace_id_for_current_user();
  if v_workspace_id is null then
    raise exception using errcode = '28000', message = 'authenticated user is not provisioned';
  end if;
  if p_campaign_key is null
     or p_campaign_key !~ '^campaign:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or p_operation not in ('start_campaign', 'end_campaign', 'cancel_campaign')
     or p_expected_campaign_version is null
     or p_expected_campaign_version !~ '^[1-9][0-9]{0,18}$'
     or p_expected_campaign_version::numeric > 9223372036854775807
     or p_overrides is null or pg_catalog.jsonb_typeof(p_overrides) <> 'array'
     or p_idempotency_key is null
     or p_idempotency_key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     then
    raise exception using errcode = '22023',
      message = 'campaign lifecycle coordination request is invalid';
  end if;

  v_campaign_source := targets.read_interview_campaign_coordination_source_v1(
    v_workspace_id, p_campaign_key
  );
  v_campaign_id := (v_campaign_source->>'campaignId')::uuid;

  select coalesce(pg_catalog.array_agg(elem->>'trackKey'), '{}'::text[])
  into v_track_keys
  from pg_catalog.jsonb_array_elements(p_overrides) as elem;

  v_plan_source := planning.read_campaign_lifecycle_coordination_source_v1(
    v_workspace_id, v_campaign_id, p_operation, v_track_keys
  );

  return agent_control.build_campaign_lifecycle_coordination_preview_v1(
    v_workspace_id, p_operation, p_expected_campaign_version::bigint, p_reason,
    p_idempotency_key, v_campaign_source, v_plan_source, p_overrides
  );
end
$function$;

create function api.apply_campaign_lifecycle_coordination_v1(
  p_campaign_key text,
  p_operation text,
  p_expected_campaign_version text,
  p_reason text,
  p_overrides jsonb,
  p_preview_digest text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_user_id uuid;
  v_workspace_id uuid;
  v_campaign_source jsonb;
  v_campaign_id uuid;
  v_track_keys text[];
  v_plan_source jsonb;
  v_preview jsonb;
  v_command_id uuid := gen_random_uuid();
  v_correlation_id uuid := gen_random_uuid();
  v_request_hash bytea;
  v_receipt outbox.command_receipts%rowtype;
  v_campaign_result jsonb;
  v_override_result jsonb;
  v_response jsonb;
  v_affected_rows integer;
  v_event_ids uuid[];
begin
  if identity.jwt_subject() is null then
    raise exception using errcode = '28000', message = 'an authenticated user is required';
  end if;
  v_actor_user_id := identity.current_user_id();
  v_workspace_id := identity.personal_workspace_id_for_current_user();
  if v_actor_user_id is null or v_workspace_id is null then
    raise exception using errcode = '28000', message = 'authenticated user is not provisioned';
  end if;
  if p_campaign_key is null
     or p_campaign_key !~ '^campaign:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or p_operation not in ('start_campaign', 'end_campaign', 'cancel_campaign')
     or p_expected_campaign_version is null
     or p_expected_campaign_version !~ '^[1-9][0-9]{0,18}$'
     or p_expected_campaign_version::numeric > 9223372036854775807
     or p_overrides is null or pg_catalog.jsonb_typeof(p_overrides) <> 'array' then
    raise exception using errcode = '22023',
      message = 'campaign lifecycle coordination request is invalid';
  end if;
  if p_reason is null or p_reason <> pg_catalog.btrim(p_reason)
     or pg_catalog.char_length(p_reason) not between 1 and 500
     or p_reason ~ '[[:cntrl:]]'
     or p_idempotency_key is null
     or p_idempotency_key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or p_preview_digest is null or p_preview_digest !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023',
      message = 'campaign lifecycle coordination confirmation is invalid';
  end if;

  v_request_hash := extensions.digest(
    pg_catalog.convert_to(
      agent_control.frame_named_fields_v1(
        array[
          'requestHashVersion','schemaVersion','workspaceId','commandType','operation',
          'idempotencyKey','campaignKey','expectedCampaignVersion','reason','overrides',
          'previewDigest'
        ],
        array[
          'campaign-lifecycle-coordination-request-hash/1.0.0','1.0.0',
          pg_catalog.lower(v_workspace_id::text),
          'agent_control.coordinate_campaign_lifecycle_v1',p_operation,p_idempotency_key,
          p_campaign_key,p_expected_campaign_version,p_reason,p_overrides::text,p_preview_digest
        ]
      ),
      'UTF8'
    ),
    'sha256'
  );

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    v_actor_user_id::text || ':agent_control.coordinate_campaign_lifecycle_v1:'
      || p_idempotency_key, 0
  ));
  select receipt.* into v_receipt
  from outbox.command_receipts as receipt
  where receipt.actor_user_id = v_actor_user_id
    and receipt.command_type = 'agent_control.coordinate_campaign_lifecycle_v1'
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

  -- ADR-0010 section 7: the fixed, total lock order is agent-control-workspace, then
  -- targets-workspace, then planning-workspace. No other order is permitted anywhere.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('agent-control-workspace:' || v_workspace_id::text, 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('targets-workspace:' || v_workspace_id::text, 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('planning-workspace:' || v_workspace_id::text, 0)
  );

  v_campaign_source := targets.read_interview_campaign_coordination_source_v1(
    v_workspace_id, p_campaign_key
  );
  v_campaign_id := (v_campaign_source->>'campaignId')::uuid;

  select coalesce(pg_catalog.array_agg(elem->>'trackKey'), '{}'::text[])
  into v_track_keys
  from pg_catalog.jsonb_array_elements(p_overrides) as elem;

  v_plan_source := planning.read_campaign_lifecycle_coordination_source_v1(
    v_workspace_id, v_campaign_id, p_operation, v_track_keys
  );

  v_preview := agent_control.build_campaign_lifecycle_coordination_preview_v1(
    v_workspace_id, p_operation, p_expected_campaign_version::bigint, p_reason,
    p_idempotency_key, v_campaign_source, v_plan_source, p_overrides
  );
  if (v_preview->>'canApply')::boolean is not true
     or v_preview->>'previewDigest' is distinct from p_preview_digest then
    raise exception using errcode = '40001',
      message = 'campaign lifecycle coordination preview is stale';
  end if;

  insert into outbox.command_receipts (
    command_id, command_type, command_schema_version, workspace_id, actor_user_id,
    idempotency_key, request_hash, correlation_id, expected_aggregate_version
  ) values (
    v_command_id, 'agent_control.coordinate_campaign_lifecycle_v1', 1, v_workspace_id,
    v_actor_user_id, p_idempotency_key, v_request_hash, v_correlation_id,
    p_expected_campaign_version::bigint
  );
  get diagnostics v_affected_rows = row_count;
  if v_affected_rows <> 1 then
    raise exception using errcode = '55000',
      message = 'campaign lifecycle coordination receipt insert failed';
  end if;

  -- Overrides close before the campaign lifecycle flips for end/cancel: the Targets guard
  -- trigger refuses ending or cancelling a campaign that still has an active override, so closing
  -- first is what makes the coordinator's own path satisfy its own invariant.
  if p_operation <> 'start_campaign' then
    v_override_result := planning.close_campaign_allocation_overrides_hook_v1(
      v_command_id, v_correlation_id, v_workspace_id, v_campaign_id, v_actor_user_id
    );
  end if;

  v_campaign_result := targets.apply_interview_campaign_lifecycle_hook_v1(
    v_command_id, v_correlation_id, v_workspace_id, v_campaign_id,
    p_expected_campaign_version::bigint, p_operation, v_actor_user_id, p_reason
  );

  if p_operation = 'start_campaign' then
    v_override_result := planning.install_campaign_allocation_overrides_hook_v1(
      v_command_id, v_correlation_id, v_workspace_id, v_campaign_id, v_actor_user_id,
      v_preview#>'{overrides,installed}'
    );
  end if;

  select coalesce(pg_catalog.array_agg(id), '{}'::uuid[]) into v_event_ids
  from (
    select (v_campaign_result->>'eventId')::uuid as id
    union all
    select (elem)::uuid
    from pg_catalog.jsonb_array_elements_text(v_override_result->'eventIds') as elem
  ) as ids;

  v_response := pg_catalog.jsonb_build_object(
    'contract', pg_catalog.jsonb_build_object(
      'name', 'CampaignLifecycleCoordinationApplyResultV1', 'version', '1.0.0'
    ),
    'commandId', v_command_id,
    'campaign', v_campaign_result->'campaign',
    'overrides', coalesce(v_override_result->'overrides', '[]'::jsonb),
    'emittedEventIds', pg_catalog.to_jsonb(v_event_ids)
  );

  update outbox.command_receipts
  set command_status = 'completed', response = v_response,
    emitted_event_ids = v_event_ids, completed_at = pg_catalog.clock_timestamp()
  where command_id = v_command_id;
  get diagnostics v_affected_rows = row_count;
  if v_affected_rows <> 1 then
    raise exception using errcode = '55000',
      message = 'campaign lifecycle coordination receipt completion failed';
  end if;
  return v_response;
end
$function$;

-- ---------------------------------------------------------------------------------------------
-- Ownership, grants, and cleanup
-- ---------------------------------------------------------------------------------------------

alter function planning.guard_campaign_allocation_override_floor() owner to pando_planning_api;
alter function planning.derive_campaign_allocation_override_identity_v1(uuid, text, text, text)
  owner to pando_planning_api;
alter function planning.campaign_allocation_override_changed_event_payload_v1_is_valid(jsonb)
  owner to pando_planning_api;
alter function planning.build_campaign_allocation_override_change_preview_v1(
  uuid, uuid, text, text, text, text, text, integer, integer, integer, text, integer, integer,
  integer, bigint, text, bigint, integer, integer, integer, text
) owner to pando_planning_api;
alter function planning.install_campaign_allocation_overrides_hook_v1(
  uuid, uuid, uuid, uuid, uuid, jsonb
) owner to pando_planning_api;
alter function planning.close_campaign_allocation_overrides_hook_v1(
  uuid, uuid, uuid, uuid, uuid
) owner to pando_planning_api;
alter function api.preview_campaign_allocation_override_v1(
  text, text, text, integer, integer, integer, text
) owner to pando_planning_api;
alter function api.apply_campaign_allocation_override_v1(
  text, text, text, integer, integer, integer, text, text, text
) owner to pando_planning_api;
alter function api.get_campaign_allocation_overrides_v1() owner to pando_planning_api;

set role pando_planning_api;
grant execute on function
  planning.install_campaign_allocation_overrides_hook_v1(uuid, uuid, uuid, uuid, uuid, jsonb),
  planning.close_campaign_allocation_overrides_hook_v1(uuid, uuid, uuid, uuid, uuid),
  planning.derive_campaign_allocation_override_identity_v1(uuid, text, text, text),
  planning.frame_named_fields_v1(text[], text[])
  to pando_agent_control_api;
reset role;

alter function targets.apply_interview_campaign_lifecycle_hook_v1(
  uuid, uuid, uuid, uuid, bigint, text, uuid, text
) owner to pando_phase1_api;

set role pando_phase1_api;
grant execute on function targets.apply_interview_campaign_lifecycle_hook_v1(
  uuid, uuid, uuid, uuid, bigint, text, uuid, text
) to pando_agent_control_api;
reset role;

alter function agent_control.frame_named_fields_v1(text[], text[])
  owner to pando_agent_control_api;
alter function agent_control.build_campaign_lifecycle_coordination_preview_v1(
  uuid, text, bigint, text, text, jsonb, jsonb, jsonb
) owner to pando_agent_control_api;
alter function api.preview_campaign_lifecycle_coordination_v1(text, text, text, text, jsonb, text)
  owner to pando_agent_control_api;
alter function api.apply_campaign_lifecycle_coordination_v1(
  text, text, text, text, jsonb, text, text
) owner to pando_agent_control_api;

revoke all on function
  api.preview_campaign_allocation_override_v1(text, text, text, integer, integer, integer, text),
  api.apply_campaign_allocation_override_v1(
    text, text, text, integer, integer, integer, text, text, text
  ),
  api.get_campaign_allocation_overrides_v1(),
  api.preview_campaign_lifecycle_coordination_v1(text, text, text, text, jsonb, text),
  api.apply_campaign_lifecycle_coordination_v1(text, text, text, text, jsonb, text, text)
  from public, anon, authenticated, service_role;

grant execute on function
  api.preview_campaign_allocation_override_v1(text, text, text, integer, integer, integer, text),
  api.apply_campaign_allocation_override_v1(
    text, text, text, integer, integer, integer, text, text, text
  ),
  api.get_campaign_allocation_overrides_v1(),
  api.preview_campaign_lifecycle_coordination_v1(text, text, text, text, jsonb, text),
  api.apply_campaign_lifecycle_coordination_v1(text, text, text, text, jsonb, text, text)
  to authenticated;

revoke create on schema agent_control, planning, api from pando_agent_control_api;
revoke create on schema planning, api from pando_planning_api;
revoke create on schema targets, api from pando_phase1_api;

do $migration_role_membership_revoke$
begin
  execute pg_catalog.format(
    'revoke pando_rls_authorizer, pando_agent_control_api, pando_planning_api, pando_phase1_api,
     pando_phase1_agent_control_source, pando_planning_agent_control_source from %I',
    current_user
  );
end
$migration_role_membership_revoke$;
