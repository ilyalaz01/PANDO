-- Targets owns the selected target through a workspace-owned Readiness Goal
-- that points to one exact immutable profile version.
create table targets.readiness_goals (
  readiness_goal_id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references identity.workspaces (workspace_id) on delete restrict,
  readiness_goal_key text not null,
  title text not null,
  profile_version_id uuid not null
    references targets.target_profile_versions (profile_version_id) on delete restrict,
  lifecycle text not null default 'active',
  aggregate_version bigint not null default 1,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint readiness_goals_key_check check (
    readiness_goal_key ~ '^goal:[a-z0-9][a-z0-9-]{1,100}$'
  ),
  constraint readiness_goals_title_check check (
    title = btrim(title) and char_length(title) between 1 and 200
  ),
  constraint readiness_goals_lifecycle_check check (
    lifecycle in ('active', 'paused', 'completed', 'archived')
  ),
  constraint readiness_goals_version_check check (aggregate_version > 0),
  unique (workspace_id, readiness_goal_key),
  unique (readiness_goal_id, workspace_id, profile_version_id)
);

create function targets.guard_readiness_goal_profile_scope()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_profile_workspace_id uuid;
  v_profile_lifecycle text;
begin
  if tg_op = 'UPDATE'
     and (
       new.workspace_id is distinct from old.workspace_id
       or new.readiness_goal_key is distinct from old.readiness_goal_key
       or new.profile_version_id is distinct from old.profile_version_id
     ) then
    raise exception using errcode = '55000', message = 'readiness goal workspace, key, and exact profile version are immutable';
  end if;

  select profile.workspace_id, profile.lifecycle
  into strict v_profile_workspace_id, v_profile_lifecycle
  from targets.target_profile_versions as profile
  where profile.profile_version_id = new.profile_version_id;

  if v_profile_workspace_id is not null
     and new.workspace_id is distinct from v_profile_workspace_id then
    raise exception using errcode = '23514', message = 'readiness goal workspace must match its target profile';
  end if;
  if (tg_op = 'INSERT' and v_profile_lifecycle <> 'published')
     or v_profile_lifecycle not in ('published', 'retired') then
    raise exception using errcode = '23514', message = 'readiness goal requires an immutable target profile version';
  end if;
  return new;
end
$function$;

create trigger readiness_goal_profile_scope
before insert or update on targets.readiness_goals
for each row execute function targets.guard_readiness_goal_profile_scope();

alter table targets.readiness_goals enable row level security;
alter table targets.readiness_goals force row level security;

alter table overlay.positions
  add column readiness_goal_id uuid not null
    references targets.readiness_goals (readiness_goal_id) on delete restrict;
alter table overlay.positions drop constraint positions_workspace_profile_node_key;
alter table overlay.positions
  add constraint positions_workspace_goal_profile_node_key
  unique (workspace_id, readiness_goal_id, profile_version_id, node_ref);

create function overlay.guard_position_goal_scope()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if not exists (
    select 1 from targets.readiness_goals as goal
    where goal.readiness_goal_id = new.readiness_goal_id
      and goal.workspace_id = new.workspace_id
      and goal.profile_version_id = new.profile_version_id
  ) then
    raise exception using errcode = '23514', message = 'position goal, workspace, and profile must match';
  end if;
  return new;
end
$function$;

create trigger overlay_position_goal_scope
before insert or update on overlay.positions
for each row execute function overlay.guard_position_goal_scope();

revoke all on table targets.readiness_goals from public, anon, authenticated, service_role;
revoke all on function targets.guard_readiness_goal_profile_scope()
  from public, anon, authenticated, service_role;
revoke all on function overlay.guard_position_goal_scope()
  from public, anon, authenticated, service_role;
