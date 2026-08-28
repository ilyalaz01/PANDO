-- Phase 4A Planning-owned authoritative plan state and immutable snapshot boundary.

do $roles$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'pando_planning_api') then
    execute 'create role pando_planning_api nologin noinherit nobypassrls';
  end if;
end
$roles$;

do $migration_role_membership$
begin
  execute pg_catalog.format(
    'grant pando_rls_authorizer, pando_planning_api to %I with set true',
    current_user
  );
end
$migration_role_membership$;

set role pando_rls_authorizer;
grant execute on function identity.jwt_subject(), identity.current_user_id(),
  identity.is_workspace_member(uuid), identity.personal_workspace_id_for_current_user()
  to pando_planning_api;
reset role;

grant usage on schema planning, targets, overlay, outbox, identity, extensions
  to pando_planning_api;
grant execute on function extensions.digest(bytea, text) to pando_planning_api;

create table planning.growth_plans (
  growth_plan_id uuid primary key,
  workspace_id uuid not null references identity.workspaces (workspace_id) on delete restrict,
  title text not null,
  lifecycle text not null default 'active',
  weekly_capacity_minutes smallint not null,
  aggregate_version bigint not null default 1,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint growth_plans_title_check check (
    title = btrim(title) and char_length(title) between 1 and 200
  ),
  constraint growth_plans_lifecycle_check check (
    lifecycle in ('active', 'paused', 'archived')
  ),
  constraint growth_plans_capacity_check check (
    weekly_capacity_minutes between 0 and 10080
  ),
  constraint growth_plans_version_check check (aggregate_version > 0),
  unique (workspace_id, growth_plan_id)
);

create unique index one_current_growth_plan_per_workspace
  on planning.growth_plans (workspace_id)
  where lifecycle in ('active', 'paused');

create table planning.learning_tracks (
  learning_track_id uuid primary key,
  workspace_id uuid not null references identity.workspaces (workspace_id) on delete restrict,
  growth_plan_id uuid not null,
  track_key text not null,
  title text not null,
  readiness_goal_id uuid not null,
  profile_version_id uuid not null,
  roadmap_version_id uuid references catalog.roadmap_template_versions (roadmap_version_id)
    on delete restrict,
  lifecycle text not null default 'active',
  priority smallint not null,
  protected_minimum_minutes smallint not null,
  default_session_minutes smallint not null,
  aggregate_version bigint not null default 1,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint learning_tracks_plan_fk
    foreign key (workspace_id, growth_plan_id)
    references planning.growth_plans (workspace_id, growth_plan_id) on delete restrict,
  constraint learning_tracks_goal_fk
    foreign key (readiness_goal_id, workspace_id, profile_version_id)
    references targets.readiness_goals (readiness_goal_id, workspace_id, profile_version_id)
    on delete restrict,
  constraint learning_tracks_key_check check (
    track_key ~ '^track:[a-z0-9][a-z0-9-]{1,100}$'
  ),
  constraint learning_tracks_title_check check (
    title = btrim(title) and char_length(title) between 1 and 160
  ),
  constraint learning_tracks_lifecycle_check check (
    lifecycle in ('active', 'paused', 'completed', 'archived')
  ),
  constraint learning_tracks_priority_check check (priority between 0 and 100),
  constraint learning_tracks_protected_minimum_check check (
    protected_minimum_minutes between 0 and 10080
  ),
  constraint learning_tracks_default_session_check check (
    default_session_minutes between 1 and 480
  ),
  constraint learning_tracks_version_check check (aggregate_version > 0),
  unique (workspace_id, learning_track_id),
  unique (workspace_id, growth_plan_id, learning_track_id),
  unique (workspace_id, track_key)
);

create index learning_tracks_current_plan_order
  on planning.learning_tracks (
    workspace_id, growth_plan_id, lifecycle, priority desc, track_key
  );

create table planning.learning_track_activities (
  workspace_id uuid not null references identity.workspaces (workspace_id) on delete restrict,
  growth_plan_id uuid not null,
  learning_track_id uuid not null,
  custom_activity_id uuid not null,
  candidate_key text not null,
  estimated_minutes smallint not null,
  energy text,
  lifecycle text not null default 'active',
  aggregate_version bigint not null default 1,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (workspace_id, growth_plan_id, learning_track_id, custom_activity_id),
  constraint learning_track_activities_track_fk
    foreign key (workspace_id, growth_plan_id, learning_track_id)
    references planning.learning_tracks (
      workspace_id, growth_plan_id, learning_track_id
    ) on delete restrict,
  constraint learning_track_activities_overlay_fk
    foreign key (workspace_id, custom_activity_id)
    references overlay.custom_activities (workspace_id, custom_activity_id)
    on delete restrict,
  constraint learning_track_activities_candidate_check check (
    candidate_key ~ '^candidate:[a-z0-9][a-z0-9-]{1,100}$'
  ),
  constraint learning_track_activities_duration_check check (
    estimated_minutes between 1 and 480
  ),
  constraint learning_track_activities_energy_check check (
    energy is null or energy in ('LOW', 'MEDIUM', 'HIGH')
  ),
  constraint learning_track_activities_lifecycle_check check (
    lifecycle in ('active', 'paused', 'archived')
  ),
  constraint learning_track_activities_version_check check (aggregate_version > 0),
  constraint learning_track_activities_single_track_attribution
    unique (workspace_id, growth_plan_id, custom_activity_id),
  constraint learning_track_activities_candidate_key
    unique (workspace_id, candidate_key)
);

create table planning.plan_snapshots (
  snapshot_id uuid primary key,
  workspace_id uuid not null references identity.workspaces (workspace_id) on delete restrict,
  growth_plan_id uuid,
  input_fingerprint text not null,
  engine_version text not null,
  policy_version text not null,
  calculated_as_of timestamptz not null,
  valid_until timestamptz not null,
  time_zone text not null,
  week_start timestamptz not null,
  week_end timestamptz not null,
  recommendation_state text not null,
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint plan_snapshots_growth_plan_fk
    foreign key (workspace_id, growth_plan_id)
    references planning.growth_plans (workspace_id, growth_plan_id) on delete restrict,
  constraint plan_snapshots_fingerprint_check check (
    input_fingerprint ~ '^planning-input:[a-f0-9]{64}$'
  ),
  constraint plan_snapshots_engine_check check (engine_version = 'planner-engine/0.1.0'),
  constraint plan_snapshots_policy_check check (policy_version = 'planning-policy/0.1'),
  constraint plan_snapshots_validity_check check (valid_until >= calculated_as_of),
  constraint plan_snapshots_time_zone_check check (
    time_zone = btrim(time_zone)
    and char_length(time_zone) between 1 and 100
    and time_zone ~ '^[A-Za-z0-9_+.-]+(?:/[A-Za-z0-9_+.-]+)*$'
  ),
  constraint plan_snapshots_week_check check (week_start < week_end),
  constraint plan_snapshots_state_check check (
    recommendation_state in (
      'CURRENT', 'NO_PLAN', 'PLAN_PAUSED', 'NO_CAPACITY', 'NO_CANDIDATES'
    )
  ),
  constraint plan_snapshots_result_check check (
    jsonb_typeof(result) = 'object'
    and result->>'engineVersion' = engine_version
    and result->>'policyVersion' = policy_version
    and result->>'inputFingerprint' = input_fingerprint
    and (result->>'calculatedAsOf')::timestamptz = calculated_as_of
    and (result->>'validUntil')::timestamptz = valid_until
    and result->>'timeZone' = time_zone
    and (result->>'weekStart')::timestamptz = week_start
    and (result->>'weekEnd')::timestamptz = week_end
    and result->>'recommendationState' = recommendation_state
  ),
  unique (workspace_id, snapshot_id),
  unique (workspace_id, engine_version, policy_version, input_fingerprint)
);

create index plan_snapshots_workspace_history
  on planning.plan_snapshots (workspace_id, calculated_as_of desc, snapshot_id);

create table planning.current_plan_snapshots (
  workspace_id uuid primary key references identity.workspaces (workspace_id) on delete restrict,
  snapshot_id uuid,
  pointer_version bigint not null default 0,
  applied_attempt_id uuid,
  updated_at timestamptz not null default clock_timestamp(),
  constraint current_plan_snapshot_fk
    foreign key (workspace_id, snapshot_id)
    references planning.plan_snapshots (workspace_id, snapshot_id) on delete restrict,
  constraint current_plan_pointer_shape_check check (
    (
      pointer_version >= 0
      and snapshot_id is null
      and applied_attempt_id is null
    )
    or (
      pointer_version > 0
      and snapshot_id is not null
      and applied_attempt_id is not null
    )
  )
);

do $rls$
declare
  qualified_table text;
begin
  foreach qualified_table in array array[
    'planning.growth_plans',
    'planning.learning_tracks',
    'planning.learning_track_activities',
    'planning.plan_snapshots',
    'planning.current_plan_snapshots'
  ]
  loop
    execute 'alter table ' || qualified_table || ' enable row level security';
    execute 'alter table ' || qualified_table || ' force row level security';
    execute 'revoke all on table ' || qualified_table ||
      ' from public, anon, authenticated, service_role';
  end loop;
end
$rls$;

create function planning.reject_plan_snapshot_mutation()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  raise exception using errcode = '55000', message = 'plan snapshots are immutable';
end
$function$;

create trigger plan_snapshots_are_immutable
before update or delete on planning.plan_snapshots
for each row execute function planning.reject_plan_snapshot_mutation();

create function planning.guard_current_plan_snapshot_pointer()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = 'current plan snapshot pointers cannot be deleted';
  end if;
  if new.pointer_version <> old.pointer_version + 1 then
    raise exception using errcode = '40001', message = 'current plan snapshot pointer must advance by one';
  end if;
  return new;
end
$function$;

create trigger current_plan_snapshot_pointer_is_monotonic
before update or delete on planning.current_plan_snapshots
for each row execute function planning.guard_current_plan_snapshot_pointer();

grant select, insert on planning.growth_plans, planning.learning_tracks to pando_planning_api;
grant select, insert, update on planning.current_plan_snapshots to pando_planning_api;
grant select on planning.learning_track_activities, planning.plan_snapshots
  to pando_planning_api;
grant select, insert, update on outbox.command_receipts to pando_planning_api;
grant insert on outbox.events, outbox.deliveries to pando_planning_api;
grant usage, select on sequence outbox.events_event_position_seq to pando_planning_api;

create policy growth_plans_planning_api on planning.growth_plans
for all to pando_planning_api
using (identity.is_workspace_member(workspace_id))
with check (identity.is_workspace_member(workspace_id));
create policy learning_tracks_planning_api on planning.learning_tracks
for all to pando_planning_api
using (identity.is_workspace_member(workspace_id))
with check (identity.is_workspace_member(workspace_id));
create policy learning_track_activities_planning_api on planning.learning_track_activities
for select to pando_planning_api
using (identity.is_workspace_member(workspace_id));
create policy plan_snapshots_planning_api on planning.plan_snapshots
for select to pando_planning_api
using (identity.is_workspace_member(workspace_id));
create policy current_plan_snapshots_planning_api on planning.current_plan_snapshots
for all to pando_planning_api
using (identity.is_workspace_member(workspace_id))
with check (identity.is_workspace_member(workspace_id));

create policy command_receipts_planning_select on outbox.command_receipts
for select to pando_planning_api
using (
  actor_user_id = identity.current_user_id()
  and workspace_id is not null
  and identity.is_workspace_member(workspace_id)
);
create policy command_receipts_planning_insert on outbox.command_receipts
for insert to pando_planning_api
with check (
  actor_user_id = identity.current_user_id()
  and workspace_id is not null
  and identity.is_workspace_member(workspace_id)
);
create policy command_receipts_planning_update on outbox.command_receipts
for update to pando_planning_api
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
create policy events_planning_insert on outbox.events
for insert to pando_planning_api
with check (
  identity.is_workspace_member(workspace_id)
  and event_name = 'planning.input_changed'
  and event_schema_version = 1
  and aggregate_type = 'planning.growth_plan'
  and aggregate_id is not null
  and aggregate_version is not null
  and actor_type = 'user'
  and actor_user_id = identity.current_user_id()
  and source = 'pando.database'
);
create policy deliveries_planning_insert on outbox.deliveries
for insert to pando_planning_api
with check (
  identity.is_workspace_member(workspace_id)
  and consumer_name = 'planning.plan_snapshot_v1'
  and handler_contract_version = 1
  and delivery_state = 'pending'
  and attempt_count = 0
);

revoke all on function planning.reject_plan_snapshot_mutation()
  from public, anon, authenticated, service_role;
revoke all on function planning.guard_current_plan_snapshot_pointer()
  from public, anon, authenticated, service_role;

do $migration_role_membership$
begin
  execute pg_catalog.format(
    'revoke pando_rls_authorizer, pando_planning_api from %I',
    current_user
  );
end
$migration_role_membership$;
