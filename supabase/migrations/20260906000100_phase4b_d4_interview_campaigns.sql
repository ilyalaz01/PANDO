-- Phase 4B D4: Targets-owned Interview Campaign foundation.
-- ADR-0010 section 3 defines the deadline representation, section 4 defines retargeting, and
-- section 9 scopes D4 to draft/start/deadline/target/end/cancel owner commands and events with no
-- Planning input and no coordinator. Campaign rows exist and are readable but do not reach the
-- planner in this slice.

-- Cross-context bounded query: Identity exposes workspace time zone and current local date to
-- Targets, mirroring the released Planning calendar source. Targets never reads identity.workspaces
-- directly.
do $roles$
begin
  if not exists (
    select 1 from pg_catalog.pg_roles where rolname = 'pando_identity_phase1_source'
  ) then
    execute 'create role pando_identity_phase1_source nologin noinherit nobypassrls';
  end if;
  execute pg_catalog.format(
    'grant pando_identity_phase1_source to %I with set true', current_user
  );
end
$roles$;

grant usage, create on schema identity to pando_identity_phase1_source;
grant select on identity.workspaces to pando_identity_phase1_source;
create policy identity_phase1_source_workspaces on identity.workspaces
for select to pando_identity_phase1_source using (true);

create function identity.read_target_calendar_source_v1(
  p_workspace_id uuid,
  p_as_of timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_time_zone text;
begin
  if p_workspace_id is null or p_as_of is null then
    raise exception using errcode = '22023', message = 'target calendar source input is invalid';
  end if;
  select workspace.time_zone into strict v_time_zone
  from identity.workspaces as workspace
  where workspace.workspace_id = p_workspace_id;
  return pg_catalog.jsonb_build_object(
    'timeZone', v_time_zone,
    'localDate', (p_as_of at time zone v_time_zone)::date,
    'fence', 'identity-calendar:' || v_time_zone
  );
end
$function$;

alter function identity.read_target_calendar_source_v1(uuid, timestamptz)
  owner to pando_identity_phase1_source;
revoke all on function identity.read_target_calendar_source_v1(uuid, timestamptz)
  from public, anon, authenticated, service_role;
revoke create on schema identity from pando_identity_phase1_source;

set role pando_identity_phase1_source;
grant execute on function identity.read_target_calendar_source_v1(uuid, timestamptz)
  to pando_phase1_api;
reset role;

do $roles_revoke$
begin
  execute pg_catalog.format('revoke pando_identity_phase1_source from %I', current_user);
end
$roles_revoke$;

-- The recorded deadline time zone is validated by the Identity-owned predicate the workspace column
-- already uses, so the Targets owner role must be able to evaluate it while writing a campaign.
do $migration_identity_api_membership$
begin
  execute pg_catalog.format('grant pando_identity_api to %I with set true', current_user);
end
$migration_identity_api_membership$;
set role pando_identity_api;
grant execute on function identity.is_known_time_zone(text) to pando_phase1_api;
reset role;
do $migration_identity_api_membership_revoke$
begin
  execute pg_catalog.format('revoke pando_identity_api from %I', current_user);
end
$migration_identity_api_membership_revoke$;

-- Every api.* entrypoint below resolves the actor's personal workspace the same way every other
-- released owner command does; Targets did not previously need this specific bounded predicate.
do $migration_rls_authorizer_membership$
begin
  execute pg_catalog.format('grant pando_rls_authorizer to %I with set true', current_user);
end
$migration_rls_authorizer_membership$;
set role pando_rls_authorizer;
grant execute on function identity.personal_workspace_id_for_current_user() to pando_phase1_api;
reset role;
do $migration_rls_authorizer_membership_revoke$
begin
  execute pg_catalog.format('revoke pando_rls_authorizer from %I', current_user);
end
$migration_rls_authorizer_membership_revoke$;

do $migration_role_membership$
begin
  execute pg_catalog.format('grant pando_phase1_api to %I with set true', current_user);
end
$migration_role_membership$;

grant create on schema targets, api to pando_phase1_api;

-- Campaign aggregate: Targets owns Interview Campaigns and references exactly one Readiness Goal.
create table targets.interview_campaigns (
  campaign_id uuid primary key,
  workspace_id uuid not null references identity.workspaces (workspace_id) on delete restrict,
  campaign_key text not null,
  title text not null,
  readiness_goal_id uuid not null
    references targets.readiness_goals (readiness_goal_id) on delete restrict,
  deadline_local_date date not null,
  deadline_time_zone text not null,
  deadline_at timestamptz not null,
  lifecycle text not null default 'draft',
  aggregate_version bigint not null default 1,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint interview_campaigns_key_check check (
    campaign_key ~ '^campaign:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint interview_campaigns_title_check check (
    title = pg_catalog.btrim(title)
    and pg_catalog.char_length(title) between 1 and 200
    and title !~ '[[:cntrl:]]'
  ),
  constraint interview_campaigns_lifecycle_check check (
    lifecycle in ('draft', 'active', 'ended', 'cancelled')
  ),
  constraint interview_campaigns_time_zone_check check (
    deadline_time_zone = pg_catalog.btrim(deadline_time_zone)
    and pg_catalog.char_length(deadline_time_zone) between 1 and 100
    and deadline_time_zone ~ '^[A-Za-z0-9_+.-]+(?:/[A-Za-z0-9_+.-]+)*$'
    and identity.is_known_time_zone(deadline_time_zone) is true
  ),
  constraint interview_campaigns_version_check check (aggregate_version > 0),
  unique (workspace_id, campaign_id),
  unique (workspace_id, campaign_key)
);

create index interview_campaigns_workspace_order
  on targets.interview_campaigns (workspace_id, lifecycle, deadline_local_date, campaign_key);

-- Append-only retarget history. ADR-0010 section 4: retargeting records the previous goal identity
-- and leaves both goals intact; nothing here is ever updated or deleted.
create table targets.interview_campaign_target_revisions (
  revision_id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references identity.workspaces (workspace_id) on delete restrict,
  campaign_id uuid not null,
  revision_number integer not null,
  previous_readiness_goal_id uuid not null
    references targets.readiness_goals (readiness_goal_id) on delete restrict,
  new_readiness_goal_id uuid not null
    references targets.readiness_goals (readiness_goal_id) on delete restrict,
  campaign_version_after bigint not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint interview_campaign_target_revisions_campaign_fk
    foreign key (workspace_id, campaign_id)
    references targets.interview_campaigns (workspace_id, campaign_id) on delete restrict,
  constraint interview_campaign_target_revisions_number_check check (revision_number > 0),
  constraint interview_campaign_target_revisions_version_check check (campaign_version_after > 1),
  constraint interview_campaign_target_revisions_distinct_check check (
    previous_readiness_goal_id <> new_readiness_goal_id
  ),
  unique (workspace_id, campaign_id, revision_number)
);

create function targets.guard_interview_campaign_goal_scope()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_goal_workspace_id uuid;
  v_goal_lifecycle text;
begin
  if tg_op = 'UPDATE'
     and (
       new.workspace_id is distinct from old.workspace_id
       or new.campaign_key is distinct from old.campaign_key
     ) then
    raise exception using errcode = '55000',
      message = 'interview campaign workspace and key are immutable';
  end if;

  if tg_op = 'INSERT' or new.readiness_goal_id is distinct from old.readiness_goal_id then
    select goal.workspace_id, goal.lifecycle
    into strict v_goal_workspace_id, v_goal_lifecycle
    from targets.readiness_goals as goal
    where goal.readiness_goal_id = new.readiness_goal_id;

    if v_goal_workspace_id is distinct from new.workspace_id then
      raise exception using errcode = '23514',
        message = 'interview campaign workspace must match its readiness goal';
    end if;
    if v_goal_lifecycle <> 'active' then
      raise exception using errcode = '23514',
        message = 'interview campaign target must reference an active readiness goal';
    end if;
  end if;
  return new;
end
$function$;

create trigger interview_campaign_goal_scope
before insert or update on targets.interview_campaigns
for each row execute function targets.guard_interview_campaign_goal_scope();

alter table targets.interview_campaigns enable row level security;
alter table targets.interview_campaigns force row level security;
revoke all on table targets.interview_campaigns from public, anon, authenticated, service_role;
grant select, insert, update on targets.interview_campaigns to pando_phase1_api;
create policy interview_campaigns_phase1_api on targets.interview_campaigns
for all to pando_phase1_api
using (identity.is_workspace_member(workspace_id))
with check (identity.is_workspace_member(workspace_id));

alter table targets.interview_campaign_target_revisions enable row level security;
alter table targets.interview_campaign_target_revisions force row level security;
revoke all on table targets.interview_campaign_target_revisions
  from public, anon, authenticated, service_role;
grant select, insert on targets.interview_campaign_target_revisions to pando_phase1_api;
create policy interview_campaign_target_revisions_phase1_select
on targets.interview_campaign_target_revisions
for select to pando_phase1_api using (identity.is_workspace_member(workspace_id));
create policy interview_campaign_target_revisions_phase1_insert
on targets.interview_campaign_target_revisions
for insert to pando_phase1_api with check (identity.is_workspace_member(workspace_id));

revoke all on function targets.guard_interview_campaign_goal_scope()
  from public, anon, authenticated, service_role;

-- Shared digest-framing helper, mirroring planning.frame_named_fields_v1. Bounded contexts do not
-- call across schemas for pure utility code.
create function targets.frame_named_fields_v1(p_names text[], p_values text[])
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

create function targets.derive_campaign_identity_v1(
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
  if p_command_type <> 'targets.create_interview_campaign_v1'
     or p_idempotency_key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or p_label <> 'interview-campaign' then
    raise exception using errcode = '22023', message = 'campaign identity input is invalid';
  end if;
  v_hash := pg_catalog.substring(
    extensions.digest(
      pg_catalog.convert_to(
        targets.frame_named_fields_v1(
          array['identityVersion','workspaceId','commandType','idempotencyKey','label'],
          array[
            'targets-create-identity/1.0.0', pg_catalog.lower(p_workspace_id::text),
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

-- Same defensive local round-trip pattern as the released review.local_timestamp_to_instant_v1.
create function targets.local_timestamp_to_instant_v1(
  p_local_timestamp timestamp,
  p_time_zone text
)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $function$
declare
  v_instant timestamptz;
  v_matching_instants integer;
begin
  if p_local_timestamp is null or p_time_zone is null then
    raise exception using errcode = '22023', message = 'campaign local deadline time is invalid';
  end if;
  v_instant := p_local_timestamp at time zone p_time_zone;
  if (v_instant at time zone p_time_zone) is distinct from p_local_timestamp then
    raise exception using errcode = '22023',
      message = 'campaign local deadline time does not exist in the workspace time zone';
  end if;
  select pg_catalog.count(*) into v_matching_instants
  from pg_catalog.generate_series(
    v_instant - interval '3 hours',
    v_instant + interval '3 hours',
    interval '15 minutes'
  ) as candidate(value)
  where candidate.value at time zone p_time_zone = p_local_timestamp;
  if v_matching_instants <> 1 then
    raise exception using errcode = '22023',
      message = 'campaign local deadline time is ambiguous in the workspace time zone';
  end if;
  return v_instant;
end
$function$;

-- Event payload validators: identifiers, versions, and a change kind only. No title, deadline
-- label, or reason body ever enters the outbox.
create function targets.campaign_created_event_payload_v1_is_valid(p_payload jsonb)
returns boolean
language sql
immutable
strict
set search_path = ''
as $function$
  select pg_catalog.jsonb_typeof(p_payload) = 'object'
    and (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(p_payload)) = 4
    and p_payload->>'change_kind' = 'CAMPAIGN_CREATED'
    and p_payload->>'campaign_id'
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and p_payload->>'campaign_version' ~ '^[1-9][0-9]{0,18}$'
    and p_payload->>'readiness_goal_id'
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
$function$;

create function targets.campaign_lifecycle_event_payload_v1_is_valid(p_payload jsonb)
returns boolean
language sql
immutable
strict
set search_path = ''
as $function$
  select pg_catalog.jsonb_typeof(p_payload) = 'object'
    and (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(p_payload)) = 4
    and p_payload->>'change_kind' = 'CAMPAIGN_LIFECYCLE_CHANGED'
    and p_payload->>'campaign_id'
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and p_payload->>'campaign_version' ~ '^[1-9][0-9]{0,18}$'
    and p_payload->>'lifecycle' in ('ACTIVE', 'ENDED', 'CANCELLED')
$function$;

create function targets.campaign_deadline_changed_event_payload_v1_is_valid(p_payload jsonb)
returns boolean
language sql
immutable
strict
set search_path = ''
as $function$
  select pg_catalog.jsonb_typeof(p_payload) = 'object'
    and (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(p_payload)) = 3
    and p_payload->>'change_kind' = 'CAMPAIGN_DEADLINE_CHANGED'
    and p_payload->>'campaign_id'
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and p_payload->>'campaign_version' ~ '^[1-9][0-9]{0,18}$'
$function$;

create function targets.campaign_retargeted_event_payload_v1_is_valid(p_payload jsonb)
returns boolean
language sql
immutable
strict
set search_path = ''
as $function$
  select pg_catalog.jsonb_typeof(p_payload) = 'object'
    and (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(p_payload)) = 5
    and p_payload->>'change_kind' = 'CAMPAIGN_RETARGETED'
    and p_payload->>'campaign_id'
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and p_payload->>'campaign_version' ~ '^[1-9][0-9]{0,18}$'
    and p_payload->>'previous_readiness_goal_id'
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and p_payload->>'new_readiness_goal_id'
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and p_payload->>'previous_readiness_goal_id' <> p_payload->>'new_readiness_goal_id'
$function$;

-- ---------------------------------------------------------------------------------------------
-- 1) draft_campaign: create_interview_campaign
-- ---------------------------------------------------------------------------------------------

create function targets.build_interview_campaign_creation_preview_v1(
  p_workspace_id uuid,
  p_readiness_goal_id uuid,
  p_readiness_goal_key text,
  p_readiness_goal_title text,
  p_readiness_goal_lifecycle text,
  p_readiness_goal_version bigint,
  p_expected_readiness_goal_version bigint,
  p_title text,
  p_deadline_local_date date,
  p_time_zone text,
  p_today_local_date date,
  p_reason text,
  p_idempotency_key text
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
  v_deadline_at timestamptz;
  v_blocker text;
  v_can_apply boolean;
  v_digest_input text;
  v_digest text;
begin
  if p_workspace_id is null or p_readiness_goal_id is null or p_readiness_goal_key is null
     or p_readiness_goal_title is null or p_readiness_goal_lifecycle is null
     or p_readiness_goal_version is null or p_readiness_goal_version < 1
     or p_expected_readiness_goal_version is null or p_expected_readiness_goal_version < 1
     or p_title is null or p_deadline_local_date is null or p_time_zone is null
     or p_today_local_date is null then
    raise exception using errcode = '22023',
      message = 'Interview Campaign creation preview input is invalid';
  end if;
  if p_title <> pg_catalog.btrim(p_title)
     or pg_catalog.char_length(p_title) not between 1 and 200
     or p_title ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'Interview Campaign title is invalid';
  end if;
  if p_reason is null or p_reason <> pg_catalog.btrim(p_reason)
     or pg_catalog.char_length(p_reason) not between 1 and 500
     or p_reason ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'Interview Campaign reason is invalid';
  end if;
  if p_readiness_goal_lifecycle <> 'active' then
    raise exception using errcode = '42501', message = 'readiness goal is not accessible';
  end if;
  if p_expected_readiness_goal_version <> p_readiness_goal_version then
    raise exception using errcode = '40001', message = 'readiness goal version is stale';
  end if;
  if p_deadline_local_date < p_today_local_date then
    raise exception using errcode = '22023',
      message = 'Interview Campaign deadline must not be in the past';
  end if;
  if p_deadline_local_date > p_today_local_date + 36500 then
    raise exception using errcode = '22023',
      message = 'Interview Campaign deadline is too far in the future';
  end if;

  v_campaign_id := targets.derive_campaign_identity_v1(
    p_workspace_id, 'targets.create_interview_campaign_v1', p_idempotency_key,
    'interview-campaign'
  );
  v_campaign_key := 'campaign:' || pg_catalog.lower(v_campaign_id::text);
  v_deadline_at := targets.local_timestamp_to_instant_v1(
    (p_deadline_local_date + 1)::timestamp, p_time_zone
  );

  v_blocker := case
    when exists (
      select 1 from targets.interview_campaigns where campaign_id = v_campaign_id
    ) then 'TARGETS_CREATE_IDENTITY_COLLISION'
    else null
  end;
  v_can_apply := v_blocker is null;

  v_digest_input := targets.frame_named_fields_v1(
    array[
      'digestVersion','contractVersion','identityVersion','workspaceId','operation','commandType',
      'idempotencyKey','reason','readinessGoalId','readinessGoalKey','readinessGoalTitle',
      'readinessGoalLifecycle','readinessGoalVersion','expectedReadinessGoalVersion','title',
      'deadlineLocalDate','deadlineTimeZone','deadlineAt','campaignId','campaignKey',
      'campaignLifecycle','campaignVersion','canApply','blockingReasonCode'
    ],
    array[
      'interview-campaign-creation-preview-digest/1.0.0','1.0.0','targets-create-identity/1.0.0',
      pg_catalog.lower(p_workspace_id::text),'create_interview_campaign',
      'targets.create_interview_campaign_v1',p_idempotency_key,p_reason,
      pg_catalog.lower(p_readiness_goal_id::text),p_readiness_goal_key,p_readiness_goal_title,
      pg_catalog.upper(p_readiness_goal_lifecycle),p_readiness_goal_version::text,
      p_expected_readiness_goal_version::text,p_title,p_deadline_local_date::text,p_time_zone,
      v_deadline_at::text,pg_catalog.lower(v_campaign_id::text),v_campaign_key,'DRAFT','1',
      pg_catalog.lower(v_can_apply::text),coalesce(v_blocker,'')
    ]
  );
  v_digest := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(v_digest_input, 'UTF8'), 'sha256'), 'hex'
  );

  return pg_catalog.jsonb_build_object(
    'contract', pg_catalog.jsonb_build_object(
      'name', 'InterviewCampaignCreationPreviewV1', 'version', '1.0.0'
    ),
    'operation', 'create_interview_campaign',
    'commandType', 'targets.create_interview_campaign_v1',
    'idempotencyKey', p_idempotency_key,
    'reason', p_reason,
    'readinessGoal', pg_catalog.jsonb_build_object(
      'readinessGoalId', p_readiness_goal_id, 'readinessGoalKey', p_readiness_goal_key,
      'title', p_readiness_goal_title, 'lifecycle', pg_catalog.upper(p_readiness_goal_lifecycle),
      'aggregateVersion', p_readiness_goal_version::text
    ),
    'after', pg_catalog.jsonb_build_object(
      'campaignId', v_campaign_id, 'campaignKey', v_campaign_key, 'title', p_title,
      'lifecycle', 'DRAFT', 'aggregateVersion', '1',
      'deadline', pg_catalog.jsonb_build_object(
        'localDate', p_deadline_local_date, 'timeZone', p_time_zone, 'at', v_deadline_at
      )
    ),
    'canApply', v_can_apply,
    'blockingReasons', case when v_blocker is null then '[]'::jsonb else
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('code', v_blocker)) end,
    'warnings', '[]'::jsonb,
    'previewDigest', v_digest
  );
end
$function$;

create function api.preview_interview_campaign_creation_v1(
  p_readiness_goal_key text,
  p_expected_readiness_goal_version text,
  p_title text,
  p_deadline_local_date date,
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
  v_goal targets.readiness_goals%rowtype;
  v_calendar jsonb;
begin
  if identity.jwt_subject() is null then
    raise exception using errcode = '28000', message = 'an authenticated user is required';
  end if;
  v_workspace_id := identity.personal_workspace_id_for_current_user();
  if v_workspace_id is null then
    raise exception using errcode = '28000', message = 'authenticated user is not provisioned';
  end if;
  if p_readiness_goal_key is null or p_readiness_goal_key !~ '^goal:[a-z0-9][a-z0-9-]{1,100}$'
     or p_expected_readiness_goal_version is null
     or p_expected_readiness_goal_version !~ '^[1-9][0-9]{0,18}$'
     or p_expected_readiness_goal_version::numeric > 9223372036854775807
     or p_title is null or p_deadline_local_date is null then
    raise exception using errcode = '22023',
      message = 'Interview Campaign creation request is invalid';
  end if;
  if p_idempotency_key is null
     or p_idempotency_key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     then
    raise exception using errcode = '22023', message = 'idempotency key must be a UUID';
  end if;

  select goal.* into v_goal
  from targets.readiness_goals as goal
  where goal.workspace_id = v_workspace_id and goal.readiness_goal_key = p_readiness_goal_key;
  if not found then
    raise exception using errcode = '42501', message = 'readiness goal is not accessible';
  end if;

  v_calendar := identity.read_target_calendar_source_v1(
    v_workspace_id, pg_catalog.clock_timestamp()
  );

  return targets.build_interview_campaign_creation_preview_v1(
    v_workspace_id, v_goal.readiness_goal_id, v_goal.readiness_goal_key, v_goal.title,
    v_goal.lifecycle, v_goal.aggregate_version, p_expected_readiness_goal_version::bigint,
    p_title, p_deadline_local_date, v_calendar->>'timeZone', (v_calendar->>'localDate')::date,
    p_reason, p_idempotency_key
  );
end
$function$;

create function api.apply_interview_campaign_creation_v1(
  p_readiness_goal_key text,
  p_expected_readiness_goal_version text,
  p_title text,
  p_deadline_local_date date,
  p_reason text,
  p_idempotency_key text,
  p_preview_digest text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_user_id uuid;
  v_workspace_id uuid;
  v_goal targets.readiness_goals%rowtype;
  v_calendar jsonb;
  v_preview jsonb;
  v_payload jsonb;
  v_campaign_id uuid;
  v_campaign_key text;
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
  if p_readiness_goal_key is null or p_readiness_goal_key !~ '^goal:[a-z0-9][a-z0-9-]{1,100}$'
     or p_expected_readiness_goal_version is null
     or p_expected_readiness_goal_version !~ '^[1-9][0-9]{0,18}$'
     or p_expected_readiness_goal_version::numeric > 9223372036854775807
     or p_title is null or p_deadline_local_date is null then
    raise exception using errcode = '22023',
      message = 'Interview Campaign creation request is invalid';
  end if;
  if p_reason is null or p_reason <> pg_catalog.btrim(p_reason)
     or pg_catalog.char_length(p_reason) not between 1 and 500
     or p_reason ~ '[[:cntrl:]]'
     or p_idempotency_key is null
     or p_idempotency_key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or p_preview_digest is null or p_preview_digest !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023',
      message = 'Interview Campaign creation confirmation is invalid';
  end if;

  v_campaign_id := targets.derive_campaign_identity_v1(
    v_workspace_id, 'targets.create_interview_campaign_v1', p_idempotency_key,
    'interview-campaign'
  );
  v_campaign_key := 'campaign:' || pg_catalog.lower(v_campaign_id::text);

  v_request_hash := extensions.digest(
    pg_catalog.convert_to(
      targets.frame_named_fields_v1(
        array[
          'requestHashVersion','schemaVersion','identityVersion','workspaceId','commandType',
          'operation','idempotencyKey','readinessGoalKey','expectedReadinessGoalVersion','title',
          'deadlineLocalDate','reason','previewDigest','campaignId'
        ],
        array[
          'interview-campaign-creation-request-hash/1.0.0','1.0.0','targets-create-identity/1.0.0',
          pg_catalog.lower(v_workspace_id::text),'targets.create_interview_campaign_v1',
          'create_interview_campaign',p_idempotency_key,p_readiness_goal_key,
          p_expected_readiness_goal_version,p_title,p_deadline_local_date::text,p_reason,
          p_preview_digest,pg_catalog.lower(v_campaign_id::text)
        ]
      ),
      'UTF8'
    ),
    'sha256'
  );

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    v_actor_user_id::text || ':targets.create_interview_campaign_v1:' || p_idempotency_key, 0
  ));
  select receipt.* into v_receipt
  from outbox.command_receipts as receipt
  where receipt.actor_user_id = v_actor_user_id
    and receipt.command_type = 'targets.create_interview_campaign_v1'
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
    pg_catalog.hashtextextended('targets-workspace:' || v_workspace_id::text, 0)
  );

  select goal.* into v_goal
  from targets.readiness_goals as goal
  where goal.workspace_id = v_workspace_id and goal.readiness_goal_key = p_readiness_goal_key;
  if not found then
    raise exception using errcode = '42501', message = 'readiness goal is not accessible';
  end if;

  v_calendar := identity.read_target_calendar_source_v1(
    v_workspace_id, pg_catalog.clock_timestamp()
  );

  v_preview := targets.build_interview_campaign_creation_preview_v1(
    v_workspace_id, v_goal.readiness_goal_id, v_goal.readiness_goal_key, v_goal.title,
    v_goal.lifecycle, v_goal.aggregate_version, p_expected_readiness_goal_version::bigint,
    p_title, p_deadline_local_date, v_calendar->>'timeZone', (v_calendar->>'localDate')::date,
    p_reason, p_idempotency_key
  );
  if (v_preview->>'canApply')::boolean is not true
     or v_preview->>'previewDigest' is distinct from p_preview_digest
     or v_preview#>>'{after,campaignId}' is distinct from v_campaign_id::text then
    raise exception using errcode = '40001',
      message = 'Interview Campaign creation preview is stale';
  end if;

  insert into outbox.command_receipts (
    command_id, command_type, command_schema_version, workspace_id, actor_user_id,
    idempotency_key, request_hash, correlation_id, expected_aggregate_version
  ) values (
    v_command_id, 'targets.create_interview_campaign_v1', 1, v_workspace_id, v_actor_user_id,
    p_idempotency_key, v_request_hash, v_correlation_id, 0
  );
  get diagnostics v_affected_rows = row_count;
  if v_affected_rows <> 1 then
    raise exception using errcode = '55000',
      message = 'Interview Campaign receipt insert failed';
  end if;

  insert into targets.interview_campaigns (
    campaign_id, workspace_id, campaign_key, title, readiness_goal_id,
    deadline_local_date, deadline_time_zone, deadline_at, lifecycle, aggregate_version
  ) values (
    v_campaign_id, v_workspace_id, v_campaign_key, p_title, v_goal.readiness_goal_id,
    p_deadline_local_date, v_calendar->>'timeZone',
    (v_preview#>>'{after,deadline,at}')::timestamptz, 'draft', 1
  );
  get diagnostics v_affected_rows = row_count;
  if v_affected_rows <> 1 then
    raise exception using errcode = '55000', message = 'Interview Campaign insert failed';
  end if;

  v_payload := pg_catalog.jsonb_build_object(
    'change_kind', 'CAMPAIGN_CREATED',
    'campaign_id', v_campaign_id,
    'campaign_version', '1',
    'readiness_goal_id', v_goal.readiness_goal_id
  );
  if targets.campaign_created_event_payload_v1_is_valid(v_payload) is not true then
    raise exception using errcode = '55000',
      message = 'Interview Campaign event payload is invalid';
  end if;
  insert into outbox.events (
    event_id, event_name, event_schema_version, workspace_id, aggregate_type,
    aggregate_id, aggregate_version, actor_type, actor_user_id, command_id,
    correlation_id, occurred_at, source, payload
  ) values (
    v_event_id, 'targets.interview_campaign_changed', 1, v_workspace_id,
    'targets.interview_campaign', v_campaign_id, 1, 'user', v_actor_user_id,
    v_command_id, v_correlation_id, pg_catalog.clock_timestamp(), 'pando.database', v_payload
  );
  get diagnostics v_affected_rows = row_count;
  if v_affected_rows <> 1 then
    raise exception using errcode = '55000', message = 'Interview Campaign event insert failed';
  end if;

  v_response := pg_catalog.jsonb_build_object(
    'contract', pg_catalog.jsonb_build_object(
      'name', 'InterviewCampaignCreationApplyResultV1', 'version', '1.0.0'
    ),
    'commandId', v_command_id,
    'campaign', v_preview->'after',
    'emittedEventIds', pg_catalog.jsonb_build_array(v_event_id)
  );
  update outbox.command_receipts
  set command_status = 'completed', response = v_response,
    emitted_event_ids = array[v_event_id], completed_at = pg_catalog.clock_timestamp()
  where command_id = v_command_id;
  get diagnostics v_affected_rows = row_count;
  if v_affected_rows <> 1 then
    raise exception using errcode = '55000',
      message = 'Interview Campaign receipt completion failed';
  end if;
  return v_response;
end
$function$;

-- ---------------------------------------------------------------------------------------------
-- 2) change_campaign_deadline
-- ---------------------------------------------------------------------------------------------

create function targets.build_interview_campaign_deadline_preview_v1(
  p_workspace_id uuid,
  p_campaign_id uuid,
  p_campaign_key text,
  p_title text,
  p_lifecycle text,
  p_current_deadline_local_date date,
  p_current_deadline_time_zone text,
  p_aggregate_version bigint,
  p_expected_campaign_version bigint,
  p_deadline_local_date date,
  p_time_zone text,
  p_today_local_date date,
  p_reason text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_deadline_at timestamptz;
  v_after_version bigint;
  v_digest_input text;
  v_digest text;
begin
  if p_workspace_id is null or p_campaign_id is null or p_campaign_key is null
     or p_title is null or p_lifecycle is null or p_current_deadline_local_date is null
     or p_current_deadline_time_zone is null or p_aggregate_version is null
     or p_aggregate_version < 1 or p_expected_campaign_version is null
     or p_expected_campaign_version < 1 or p_deadline_local_date is null or p_time_zone is null
     or p_today_local_date is null then
    raise exception using errcode = '22023',
      message = 'Interview Campaign deadline preview input is invalid';
  end if;
  if p_reason is null or p_reason <> pg_catalog.btrim(p_reason)
     or pg_catalog.char_length(p_reason) not between 1 and 500
     or p_reason ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'Interview Campaign reason is invalid';
  end if;
  if p_lifecycle not in ('draft', 'active') then
    raise exception using errcode = '22023',
      message = 'Interview Campaign deadline can only change while draft or active';
  end if;
  if p_expected_campaign_version <> p_aggregate_version then
    raise exception using errcode = '40001', message = 'Interview Campaign version is stale';
  end if;
  if p_aggregate_version = 9223372036854775807 then
    raise exception using errcode = '22003', message = 'Interview Campaign version is exhausted';
  end if;
  if p_deadline_local_date < p_today_local_date then
    raise exception using errcode = '22023',
      message = 'Interview Campaign deadline must not be in the past';
  end if;
  if p_deadline_local_date > p_today_local_date + 36500 then
    raise exception using errcode = '22023',
      message = 'Interview Campaign deadline is too far in the future';
  end if;

  v_after_version := p_aggregate_version + 1;
  v_deadline_at := targets.local_timestamp_to_instant_v1(
    (p_deadline_local_date + 1)::timestamp, p_time_zone
  );

  v_digest_input := targets.frame_named_fields_v1(
    array[
      'digestVersion','contractVersion','workspaceId','operation','commandType',
      'reason','campaignId','campaignKey','title','beforeAggregateVersion','afterAggregateVersion',
      'beforeDeadlineLocalDate','beforeDeadlineTimeZone','deadlineLocalDate','deadlineTimeZone',
      'deadlineAt'
    ],
    array[
      'interview-campaign-deadline-preview-digest/1.0.0','1.0.0',
      pg_catalog.lower(p_workspace_id::text),'change_campaign_deadline',
      'targets.change_interview_campaign_deadline_v1',p_reason,
      pg_catalog.lower(p_campaign_id::text),p_campaign_key,p_title,p_aggregate_version::text,
      v_after_version::text,p_current_deadline_local_date::text,p_current_deadline_time_zone,
      p_deadline_local_date::text,p_time_zone,v_deadline_at::text
    ]
  );
  v_digest := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(v_digest_input, 'UTF8'), 'sha256'), 'hex'
  );

  return pg_catalog.jsonb_build_object(
    'contract', pg_catalog.jsonb_build_object(
      'name', 'InterviewCampaignDeadlineChangePreviewV1', 'version', '1.0.0'
    ),
    'operation', 'change_campaign_deadline',
    'commandType', 'targets.change_interview_campaign_deadline_v1',
    'reason', p_reason,
    'before', pg_catalog.jsonb_build_object(
      'campaignId', p_campaign_id, 'campaignKey', p_campaign_key, 'title', p_title,
      'lifecycle', pg_catalog.upper(p_lifecycle), 'aggregateVersion', p_aggregate_version::text,
      'deadline', pg_catalog.jsonb_build_object(
        'localDate', p_current_deadline_local_date, 'timeZone', p_current_deadline_time_zone
      )
    ),
    'after', pg_catalog.jsonb_build_object(
      'campaignId', p_campaign_id, 'campaignKey', p_campaign_key, 'title', p_title,
      'lifecycle', pg_catalog.upper(p_lifecycle), 'aggregateVersion', v_after_version::text,
      'deadline', pg_catalog.jsonb_build_object(
        'localDate', p_deadline_local_date, 'timeZone', p_time_zone, 'at', v_deadline_at
      )
    ),
    'canApply', true,
    'blockingReasons', '[]'::jsonb,
    'warnings', '[]'::jsonb,
    'previewDigest', v_digest
  );
end
$function$;

create function api.preview_interview_campaign_deadline_change_v1(
  p_campaign_key text,
  p_expected_campaign_version text,
  p_deadline_local_date date,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_workspace_id uuid;
  v_campaign targets.interview_campaigns%rowtype;
  v_calendar jsonb;
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
     or p_expected_campaign_version is null
     or p_expected_campaign_version !~ '^[1-9][0-9]{0,18}$'
     or p_expected_campaign_version::numeric > 9223372036854775807
     or p_deadline_local_date is null then
    raise exception using errcode = '22023',
      message = 'Interview Campaign deadline change request is invalid';
  end if;

  select campaign.* into v_campaign
  from targets.interview_campaigns as campaign
  where campaign.workspace_id = v_workspace_id and campaign.campaign_key = p_campaign_key;
  if not found then
    raise exception using errcode = '42501', message = 'Interview Campaign is not accessible';
  end if;

  v_calendar := identity.read_target_calendar_source_v1(
    v_workspace_id, pg_catalog.clock_timestamp()
  );

  return targets.build_interview_campaign_deadline_preview_v1(
    v_workspace_id, v_campaign.campaign_id, v_campaign.campaign_key, v_campaign.title,
    v_campaign.lifecycle, v_campaign.deadline_local_date, v_campaign.deadline_time_zone,
    v_campaign.aggregate_version, p_expected_campaign_version::bigint, p_deadline_local_date,
    v_calendar->>'timeZone', (v_calendar->>'localDate')::date, p_reason
  );
end
$function$;

create function api.apply_interview_campaign_deadline_change_v1(
  p_campaign_key text,
  p_expected_campaign_version text,
  p_deadline_local_date date,
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
  v_campaign targets.interview_campaigns%rowtype;
  v_calendar jsonb;
  v_preview jsonb;
  v_payload jsonb;
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
  if p_campaign_key is null
     or p_campaign_key !~ '^campaign:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or p_expected_campaign_version is null
     or p_expected_campaign_version !~ '^[1-9][0-9]{0,18}$'
     or p_expected_campaign_version::numeric > 9223372036854775807
     or p_deadline_local_date is null then
    raise exception using errcode = '22023',
      message = 'Interview Campaign deadline change request is invalid';
  end if;
  if p_reason is null or p_reason <> pg_catalog.btrim(p_reason)
     or pg_catalog.char_length(p_reason) not between 1 and 500
     or p_reason ~ '[[:cntrl:]]'
     or p_idempotency_key is null
     or p_idempotency_key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or p_preview_digest is null or p_preview_digest !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023',
      message = 'Interview Campaign deadline change confirmation is invalid';
  end if;

  v_request_hash := extensions.digest(
    pg_catalog.convert_to(
      targets.frame_named_fields_v1(
        array[
          'requestHashVersion','schemaVersion','workspaceId','commandType','operation',
          'idempotencyKey','campaignKey','expectedCampaignVersion','deadlineLocalDate','reason',
          'previewDigest'
        ],
        array[
          'interview-campaign-deadline-request-hash/1.0.0','1.0.0',
          pg_catalog.lower(v_workspace_id::text),
          'targets.change_interview_campaign_deadline_v1','change_campaign_deadline',
          p_idempotency_key,p_campaign_key,p_expected_campaign_version,
          p_deadline_local_date::text,p_reason,p_preview_digest
        ]
      ),
      'UTF8'
    ),
    'sha256'
  );

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    v_actor_user_id::text || ':targets.change_interview_campaign_deadline_v1:'
      || p_idempotency_key, 0
  ));
  select receipt.* into v_receipt
  from outbox.command_receipts as receipt
  where receipt.actor_user_id = v_actor_user_id
    and receipt.command_type = 'targets.change_interview_campaign_deadline_v1'
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
    pg_catalog.hashtextextended('targets-workspace:' || v_workspace_id::text, 0)
  );

  select campaign.* into v_campaign
  from targets.interview_campaigns as campaign
  where campaign.workspace_id = v_workspace_id and campaign.campaign_key = p_campaign_key
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'Interview Campaign is not accessible';
  end if;

  v_calendar := identity.read_target_calendar_source_v1(
    v_workspace_id, pg_catalog.clock_timestamp()
  );

  v_preview := targets.build_interview_campaign_deadline_preview_v1(
    v_workspace_id, v_campaign.campaign_id, v_campaign.campaign_key, v_campaign.title,
    v_campaign.lifecycle, v_campaign.deadline_local_date, v_campaign.deadline_time_zone,
    v_campaign.aggregate_version, p_expected_campaign_version::bigint, p_deadline_local_date,
    v_calendar->>'timeZone', (v_calendar->>'localDate')::date, p_reason
  );
  if v_preview->>'previewDigest' is distinct from p_preview_digest then
    raise exception using errcode = '40001',
      message = 'Interview Campaign deadline change preview is stale';
  end if;

  insert into outbox.command_receipts (
    command_id, command_type, command_schema_version, workspace_id, actor_user_id,
    idempotency_key, request_hash, correlation_id, expected_aggregate_version
  ) values (
    v_command_id, 'targets.change_interview_campaign_deadline_v1', 1, v_workspace_id,
    v_actor_user_id, p_idempotency_key, v_request_hash, v_correlation_id,
    p_expected_campaign_version::bigint
  );
  get diagnostics v_affected_rows = row_count;
  if v_affected_rows <> 1 then
    raise exception using errcode = '55000',
      message = 'Interview Campaign deadline receipt insert failed';
  end if;

  update targets.interview_campaigns
  set deadline_local_date = p_deadline_local_date,
    deadline_time_zone = v_calendar->>'timeZone',
    deadline_at = (v_preview#>>'{after,deadline,at}')::timestamptz,
    aggregate_version = aggregate_version + 1,
    updated_at = pg_catalog.clock_timestamp()
  where workspace_id = v_workspace_id
    and campaign_id = v_campaign.campaign_id
    and aggregate_version = p_expected_campaign_version::bigint
    and lifecycle in ('draft', 'active');
  get diagnostics v_affected_rows = row_count;
  if v_affected_rows <> 1 then
    raise exception using errcode = '40001',
      message = 'Interview Campaign deadline change failed';
  end if;

  v_payload := pg_catalog.jsonb_build_object(
    'change_kind', 'CAMPAIGN_DEADLINE_CHANGED',
    'campaign_id', v_campaign.campaign_id,
    'campaign_version', (v_campaign.aggregate_version + 1)::text
  );
  if targets.campaign_deadline_changed_event_payload_v1_is_valid(v_payload) is not true then
    raise exception using errcode = '55000',
      message = 'Interview Campaign deadline event payload is invalid';
  end if;
  insert into outbox.events (
    event_id, event_name, event_schema_version, workspace_id, aggregate_type,
    aggregate_id, aggregate_version, actor_type, actor_user_id, command_id,
    correlation_id, occurred_at, source, payload
  ) values (
    v_event_id, 'targets.interview_campaign_changed', 1, v_workspace_id,
    'targets.interview_campaign', v_campaign.campaign_id, v_campaign.aggregate_version + 1,
    'user', v_actor_user_id, v_command_id, v_correlation_id, pg_catalog.clock_timestamp(),
    'pando.database', v_payload
  );
  get diagnostics v_affected_rows = row_count;
  if v_affected_rows <> 1 then
    raise exception using errcode = '55000',
      message = 'Interview Campaign deadline event insert failed';
  end if;

  v_response := pg_catalog.jsonb_build_object(
    'contract', pg_catalog.jsonb_build_object(
      'name', 'InterviewCampaignDeadlineChangeApplyResultV1', 'version', '1.0.0'
    ),
    'commandId', v_command_id,
    'campaign', v_preview->'after',
    'emittedEventIds', pg_catalog.jsonb_build_array(v_event_id)
  );
  update outbox.command_receipts
  set command_status = 'completed', response = v_response,
    emitted_event_ids = array[v_event_id], completed_at = pg_catalog.clock_timestamp()
  where command_id = v_command_id;
  get diagnostics v_affected_rows = row_count;
  if v_affected_rows <> 1 then
    raise exception using errcode = '55000',
      message = 'Interview Campaign deadline receipt completion failed';
  end if;
  return v_response;
end
$function$;

-- ---------------------------------------------------------------------------------------------
-- 3) change_campaign_target (retarget)
-- ---------------------------------------------------------------------------------------------

create function targets.build_interview_campaign_retarget_preview_v1(
  p_workspace_id uuid,
  p_campaign_id uuid,
  p_campaign_key text,
  p_title text,
  p_lifecycle text,
  p_aggregate_version bigint,
  p_expected_campaign_version bigint,
  p_current_readiness_goal_id uuid,
  p_current_readiness_goal_key text,
  p_current_readiness_goal_title text,
  p_new_readiness_goal_id uuid,
  p_new_readiness_goal_key text,
  p_new_readiness_goal_title text,
  p_new_readiness_goal_lifecycle text,
  p_new_readiness_goal_version bigint,
  p_expected_new_readiness_goal_version bigint,
  p_next_revision_number integer,
  p_reason text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_after_version bigint;
  v_digest_input text;
  v_digest text;
begin
  if p_workspace_id is null or p_campaign_id is null or p_campaign_key is null
     or p_title is null or p_lifecycle is null or p_aggregate_version is null
     or p_aggregate_version < 1 or p_expected_campaign_version is null
     or p_expected_campaign_version < 1 or p_current_readiness_goal_id is null
     or p_current_readiness_goal_key is null or p_current_readiness_goal_title is null
     or p_new_readiness_goal_id is null or p_new_readiness_goal_key is null
     or p_new_readiness_goal_title is null or p_new_readiness_goal_lifecycle is null
     or p_new_readiness_goal_version is null or p_new_readiness_goal_version < 1
     or p_expected_new_readiness_goal_version is null
     or p_expected_new_readiness_goal_version < 1 or p_next_revision_number is null
     or p_next_revision_number < 1 then
    raise exception using errcode = '22023',
      message = 'Interview Campaign retarget preview input is invalid';
  end if;
  if p_reason is null or p_reason <> pg_catalog.btrim(p_reason)
     or pg_catalog.char_length(p_reason) not between 1 and 500
     or p_reason ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'Interview Campaign reason is invalid';
  end if;
  if p_lifecycle not in ('draft', 'active') then
    raise exception using errcode = '22023',
      message = 'Interview Campaign target can only change while draft or active';
  end if;
  if p_expected_campaign_version <> p_aggregate_version then
    raise exception using errcode = '40001', message = 'Interview Campaign version is stale';
  end if;
  if p_aggregate_version = 9223372036854775807 then
    raise exception using errcode = '22003', message = 'Interview Campaign version is exhausted';
  end if;
  if p_new_readiness_goal_lifecycle <> 'active' then
    raise exception using errcode = '42501', message = 'readiness goal is not accessible';
  end if;
  if p_expected_new_readiness_goal_version <> p_new_readiness_goal_version then
    raise exception using errcode = '40001', message = 'readiness goal version is stale';
  end if;
  if p_new_readiness_goal_id = p_current_readiness_goal_id then
    raise exception using errcode = '22023',
      message = 'Interview Campaign retarget must select a different Readiness Goal';
  end if;

  v_after_version := p_aggregate_version + 1;

  v_digest_input := targets.frame_named_fields_v1(
    array[
      'digestVersion','contractVersion','workspaceId','operation','commandType',
      'reason','campaignId','campaignKey','title','beforeAggregateVersion','afterAggregateVersion',
      'previousReadinessGoalId','previousReadinessGoalKey','previousReadinessGoalTitle',
      'newReadinessGoalId','newReadinessGoalKey','newReadinessGoalTitle',
      'newReadinessGoalLifecycle','newReadinessGoalVersion','expectedNewReadinessGoalVersion',
      'nextRevisionNumber'
    ],
    array[
      'interview-campaign-retarget-preview-digest/1.0.0','1.0.0',
      pg_catalog.lower(p_workspace_id::text),'change_campaign_target',
      'targets.retarget_interview_campaign_v1',p_reason,
      pg_catalog.lower(p_campaign_id::text),p_campaign_key,p_title,p_aggregate_version::text,
      v_after_version::text,pg_catalog.lower(p_current_readiness_goal_id::text),
      p_current_readiness_goal_key,p_current_readiness_goal_title,
      pg_catalog.lower(p_new_readiness_goal_id::text),p_new_readiness_goal_key,
      p_new_readiness_goal_title,pg_catalog.upper(p_new_readiness_goal_lifecycle),
      p_new_readiness_goal_version::text,p_expected_new_readiness_goal_version::text,
      p_next_revision_number::text
    ]
  );
  v_digest := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(v_digest_input, 'UTF8'), 'sha256'), 'hex'
  );

  return pg_catalog.jsonb_build_object(
    'contract', pg_catalog.jsonb_build_object(
      'name', 'InterviewCampaignRetargetPreviewV1', 'version', '1.0.0'
    ),
    'operation', 'change_campaign_target',
    'commandType', 'targets.retarget_interview_campaign_v1',
    'reason', p_reason,
    'before', pg_catalog.jsonb_build_object(
      'campaignId', p_campaign_id, 'campaignKey', p_campaign_key, 'title', p_title,
      'lifecycle', pg_catalog.upper(p_lifecycle), 'aggregateVersion', p_aggregate_version::text,
      'readinessGoal', pg_catalog.jsonb_build_object(
        'readinessGoalId', p_current_readiness_goal_id,
        'readinessGoalKey', p_current_readiness_goal_key,
        'title', p_current_readiness_goal_title
      )
    ),
    'after', pg_catalog.jsonb_build_object(
      'campaignId', p_campaign_id, 'campaignKey', p_campaign_key, 'title', p_title,
      'lifecycle', pg_catalog.upper(p_lifecycle), 'aggregateVersion', v_after_version::text,
      'readinessGoal', pg_catalog.jsonb_build_object(
        'readinessGoalId', p_new_readiness_goal_id, 'readinessGoalKey', p_new_readiness_goal_key,
        'title', p_new_readiness_goal_title,
        'lifecycle', pg_catalog.upper(p_new_readiness_goal_lifecycle),
        'aggregateVersion', p_new_readiness_goal_version::text
      ),
      'revisionNumber', p_next_revision_number
    ),
    'retained', pg_catalog.jsonb_build_object(
      'previousReadinessGoal', true, 'newReadinessGoal', true
    ),
    'canApply', true,
    'blockingReasons', '[]'::jsonb,
    'warnings', '[]'::jsonb,
    'previewDigest', v_digest
  );
end
$function$;

create function api.preview_interview_campaign_retarget_v1(
  p_campaign_key text,
  p_expected_campaign_version text,
  p_readiness_goal_key text,
  p_expected_readiness_goal_version text,
  p_reason text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_workspace_id uuid;
  v_campaign targets.interview_campaigns%rowtype;
  v_current_goal targets.readiness_goals%rowtype;
  v_new_goal targets.readiness_goals%rowtype;
  v_next_revision integer;
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
     or p_expected_campaign_version is null
     or p_expected_campaign_version !~ '^[1-9][0-9]{0,18}$'
     or p_expected_campaign_version::numeric > 9223372036854775807
     or p_readiness_goal_key is null or p_readiness_goal_key !~ '^goal:[a-z0-9][a-z0-9-]{1,100}$'
     or p_expected_readiness_goal_version is null
     or p_expected_readiness_goal_version !~ '^[1-9][0-9]{0,18}$'
     or p_expected_readiness_goal_version::numeric > 9223372036854775807 then
    raise exception using errcode = '22023',
      message = 'Interview Campaign retarget request is invalid';
  end if;

  select campaign.* into v_campaign
  from targets.interview_campaigns as campaign
  where campaign.workspace_id = v_workspace_id and campaign.campaign_key = p_campaign_key;
  if not found then
    raise exception using errcode = '42501', message = 'Interview Campaign is not accessible';
  end if;
  select goal.* into v_current_goal
  from targets.readiness_goals as goal
  where goal.readiness_goal_id = v_campaign.readiness_goal_id;
  select goal.* into v_new_goal
  from targets.readiness_goals as goal
  where goal.workspace_id = v_workspace_id and goal.readiness_goal_key = p_readiness_goal_key;
  if not found then
    raise exception using errcode = '42501', message = 'readiness goal is not accessible';
  end if;

  select coalesce(pg_catalog.max(revision.revision_number), 0) + 1 into v_next_revision
  from targets.interview_campaign_target_revisions as revision
  where revision.workspace_id = v_workspace_id and revision.campaign_id = v_campaign.campaign_id;

  return targets.build_interview_campaign_retarget_preview_v1(
    v_workspace_id, v_campaign.campaign_id, v_campaign.campaign_key, v_campaign.title,
    v_campaign.lifecycle, v_campaign.aggregate_version, p_expected_campaign_version::bigint,
    v_current_goal.readiness_goal_id, v_current_goal.readiness_goal_key, v_current_goal.title,
    v_new_goal.readiness_goal_id, v_new_goal.readiness_goal_key, v_new_goal.title,
    v_new_goal.lifecycle, v_new_goal.aggregate_version,
    p_expected_readiness_goal_version::bigint, v_next_revision, p_reason
  );
end
$function$;

create function api.apply_interview_campaign_retarget_v1(
  p_campaign_key text,
  p_expected_campaign_version text,
  p_readiness_goal_key text,
  p_expected_readiness_goal_version text,
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
  v_campaign targets.interview_campaigns%rowtype;
  v_current_goal targets.readiness_goals%rowtype;
  v_new_goal targets.readiness_goals%rowtype;
  v_next_revision integer;
  v_preview jsonb;
  v_payload jsonb;
  v_command_id uuid := gen_random_uuid();
  v_correlation_id uuid := gen_random_uuid();
  v_event_id uuid := gen_random_uuid();
  v_revision_id uuid := gen_random_uuid();
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
  if p_campaign_key is null
     or p_campaign_key !~ '^campaign:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or p_expected_campaign_version is null
     or p_expected_campaign_version !~ '^[1-9][0-9]{0,18}$'
     or p_expected_campaign_version::numeric > 9223372036854775807
     or p_readiness_goal_key is null or p_readiness_goal_key !~ '^goal:[a-z0-9][a-z0-9-]{1,100}$'
     or p_expected_readiness_goal_version is null
     or p_expected_readiness_goal_version !~ '^[1-9][0-9]{0,18}$'
     or p_expected_readiness_goal_version::numeric > 9223372036854775807 then
    raise exception using errcode = '22023',
      message = 'Interview Campaign retarget request is invalid';
  end if;
  if p_reason is null or p_reason <> pg_catalog.btrim(p_reason)
     or pg_catalog.char_length(p_reason) not between 1 and 500
     or p_reason ~ '[[:cntrl:]]'
     or p_idempotency_key is null
     or p_idempotency_key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or p_preview_digest is null or p_preview_digest !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023',
      message = 'Interview Campaign retarget confirmation is invalid';
  end if;

  v_request_hash := extensions.digest(
    pg_catalog.convert_to(
      targets.frame_named_fields_v1(
        array[
          'requestHashVersion','schemaVersion','workspaceId','commandType','operation',
          'idempotencyKey','campaignKey','expectedCampaignVersion','readinessGoalKey',
          'expectedReadinessGoalVersion','reason','previewDigest'
        ],
        array[
          'interview-campaign-retarget-request-hash/1.0.0','1.0.0',
          pg_catalog.lower(v_workspace_id::text),'targets.retarget_interview_campaign_v1',
          'change_campaign_target',p_idempotency_key,p_campaign_key,p_expected_campaign_version,
          p_readiness_goal_key,p_expected_readiness_goal_version,p_reason,p_preview_digest
        ]
      ),
      'UTF8'
    ),
    'sha256'
  );

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    v_actor_user_id::text || ':targets.retarget_interview_campaign_v1:' || p_idempotency_key, 0
  ));
  select receipt.* into v_receipt
  from outbox.command_receipts as receipt
  where receipt.actor_user_id = v_actor_user_id
    and receipt.command_type = 'targets.retarget_interview_campaign_v1'
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
    pg_catalog.hashtextextended('targets-workspace:' || v_workspace_id::text, 0)
  );

  select campaign.* into v_campaign
  from targets.interview_campaigns as campaign
  where campaign.workspace_id = v_workspace_id and campaign.campaign_key = p_campaign_key
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'Interview Campaign is not accessible';
  end if;
  select goal.* into v_current_goal
  from targets.readiness_goals as goal
  where goal.readiness_goal_id = v_campaign.readiness_goal_id;
  select goal.* into v_new_goal
  from targets.readiness_goals as goal
  where goal.workspace_id = v_workspace_id and goal.readiness_goal_key = p_readiness_goal_key;
  if not found then
    raise exception using errcode = '42501', message = 'readiness goal is not accessible';
  end if;

  select coalesce(pg_catalog.max(revision.revision_number), 0) + 1 into v_next_revision
  from targets.interview_campaign_target_revisions as revision
  where revision.workspace_id = v_workspace_id and revision.campaign_id = v_campaign.campaign_id;

  v_preview := targets.build_interview_campaign_retarget_preview_v1(
    v_workspace_id, v_campaign.campaign_id, v_campaign.campaign_key, v_campaign.title,
    v_campaign.lifecycle, v_campaign.aggregate_version, p_expected_campaign_version::bigint,
    v_current_goal.readiness_goal_id, v_current_goal.readiness_goal_key, v_current_goal.title,
    v_new_goal.readiness_goal_id, v_new_goal.readiness_goal_key, v_new_goal.title,
    v_new_goal.lifecycle, v_new_goal.aggregate_version,
    p_expected_readiness_goal_version::bigint, v_next_revision, p_reason
  );
  if v_preview->>'previewDigest' is distinct from p_preview_digest then
    raise exception using errcode = '40001',
      message = 'Interview Campaign retarget preview is stale';
  end if;

  insert into outbox.command_receipts (
    command_id, command_type, command_schema_version, workspace_id, actor_user_id,
    idempotency_key, request_hash, correlation_id, expected_aggregate_version
  ) values (
    v_command_id, 'targets.retarget_interview_campaign_v1', 1, v_workspace_id, v_actor_user_id,
    p_idempotency_key, v_request_hash, v_correlation_id, p_expected_campaign_version::bigint
  );
  get diagnostics v_affected_rows = row_count;
  if v_affected_rows <> 1 then
    raise exception using errcode = '55000',
      message = 'Interview Campaign retarget receipt insert failed';
  end if;

  update targets.interview_campaigns
  set readiness_goal_id = v_new_goal.readiness_goal_id,
    aggregate_version = aggregate_version + 1,
    updated_at = pg_catalog.clock_timestamp()
  where workspace_id = v_workspace_id
    and campaign_id = v_campaign.campaign_id
    and aggregate_version = p_expected_campaign_version::bigint
    and lifecycle in ('draft', 'active');
  get diagnostics v_affected_rows = row_count;
  if v_affected_rows <> 1 then
    raise exception using errcode = '40001', message = 'Interview Campaign retarget failed';
  end if;

  insert into targets.interview_campaign_target_revisions (
    revision_id, workspace_id, campaign_id, revision_number,
    previous_readiness_goal_id, new_readiness_goal_id, campaign_version_after
  ) values (
    v_revision_id, v_workspace_id, v_campaign.campaign_id, v_next_revision,
    v_current_goal.readiness_goal_id, v_new_goal.readiness_goal_id,
    v_campaign.aggregate_version + 1
  );
  get diagnostics v_affected_rows = row_count;
  if v_affected_rows <> 1 then
    raise exception using errcode = '55000',
      message = 'Interview Campaign retarget revision insert failed';
  end if;

  v_payload := pg_catalog.jsonb_build_object(
    'change_kind', 'CAMPAIGN_RETARGETED',
    'campaign_id', v_campaign.campaign_id,
    'campaign_version', (v_campaign.aggregate_version + 1)::text,
    'previous_readiness_goal_id', v_current_goal.readiness_goal_id,
    'new_readiness_goal_id', v_new_goal.readiness_goal_id
  );
  if targets.campaign_retargeted_event_payload_v1_is_valid(v_payload) is not true then
    raise exception using errcode = '55000',
      message = 'Interview Campaign retarget event payload is invalid';
  end if;
  insert into outbox.events (
    event_id, event_name, event_schema_version, workspace_id, aggregate_type,
    aggregate_id, aggregate_version, actor_type, actor_user_id, command_id,
    correlation_id, occurred_at, source, payload
  ) values (
    v_event_id, 'targets.interview_campaign_changed', 1, v_workspace_id,
    'targets.interview_campaign', v_campaign.campaign_id, v_campaign.aggregate_version + 1,
    'user', v_actor_user_id, v_command_id, v_correlation_id, pg_catalog.clock_timestamp(),
    'pando.database', v_payload
  );
  get diagnostics v_affected_rows = row_count;
  if v_affected_rows <> 1 then
    raise exception using errcode = '55000',
      message = 'Interview Campaign retarget event insert failed';
  end if;

  v_response := pg_catalog.jsonb_build_object(
    'contract', pg_catalog.jsonb_build_object(
      'name', 'InterviewCampaignRetargetApplyResultV1', 'version', '1.0.0'
    ),
    'commandId', v_command_id,
    'campaign', v_preview->'after',
    'emittedEventIds', pg_catalog.jsonb_build_array(v_event_id)
  );
  update outbox.command_receipts
  set command_status = 'completed', response = v_response,
    emitted_event_ids = array[v_event_id], completed_at = pg_catalog.clock_timestamp()
  where command_id = v_command_id;
  get diagnostics v_affected_rows = row_count;
  if v_affected_rows <> 1 then
    raise exception using errcode = '55000',
      message = 'Interview Campaign retarget receipt completion failed';
  end if;
  return v_response;
end
$function$;

-- ---------------------------------------------------------------------------------------------
-- 4) start_campaign / end_campaign / cancel_campaign lifecycle operations
-- ---------------------------------------------------------------------------------------------

create function targets.build_interview_campaign_lifecycle_preview_v1(
  p_workspace_id uuid,
  p_campaign_id uuid,
  p_campaign_key text,
  p_title text,
  p_lifecycle text,
  p_aggregate_version bigint,
  p_operation text,
  p_expected_campaign_version bigint,
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
  v_after_version bigint;
  v_digest_input text;
  v_digest text;
begin
  if p_workspace_id is null or p_campaign_id is null or p_campaign_key is null
     or p_title is null or p_lifecycle is null or p_aggregate_version is null
     or p_aggregate_version < 1 or p_expected_campaign_version is null
     or p_expected_campaign_version < 1 then
    raise exception using errcode = '22023',
      message = 'Interview Campaign lifecycle preview input is invalid';
  end if;
  if p_operation not in ('start_campaign', 'end_campaign', 'cancel_campaign') then
    raise exception using errcode = '22023',
      message = 'Interview Campaign lifecycle operation is invalid';
  end if;
  if p_reason is null or p_reason <> pg_catalog.btrim(p_reason)
     or pg_catalog.char_length(p_reason) not between 1 and 500
     or p_reason ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'Interview Campaign reason is invalid';
  end if;
  if p_expected_campaign_version <> p_aggregate_version then
    raise exception using errcode = '40001', message = 'Interview Campaign version is stale';
  end if;
  if p_aggregate_version = 9223372036854775807 then
    raise exception using errcode = '22003', message = 'Interview Campaign version is exhausted';
  end if;

  if p_operation = 'start_campaign' and p_lifecycle = 'draft' then
    v_after_lifecycle := 'active';
  elsif p_operation = 'end_campaign' and p_lifecycle = 'active' then
    v_after_lifecycle := 'ended';
  elsif p_operation = 'cancel_campaign' and p_lifecycle in ('draft', 'active') then
    v_after_lifecycle := 'cancelled';
  else
    raise exception using errcode = '22023',
      message = 'Interview Campaign lifecycle transition is invalid';
  end if;
  v_after_version := p_aggregate_version + 1;

  v_digest_input := targets.frame_named_fields_v1(
    array[
      'digestVersion','contractVersion','workspaceId','operation','commandType',
      'reason','campaignId','campaignKey','title','beforeAggregateVersion','afterAggregateVersion',
      'beforeLifecycle','afterLifecycle'
    ],
    array[
      'interview-campaign-lifecycle-preview-digest/1.0.0','1.0.0',
      pg_catalog.lower(p_workspace_id::text),p_operation,
      'targets.change_interview_campaign_lifecycle_v1',p_reason,
      pg_catalog.lower(p_campaign_id::text),p_campaign_key,p_title,p_aggregate_version::text,
      v_after_version::text,pg_catalog.upper(p_lifecycle),pg_catalog.upper(v_after_lifecycle)
    ]
  );
  v_digest := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(v_digest_input, 'UTF8'), 'sha256'), 'hex'
  );

  return pg_catalog.jsonb_build_object(
    'contract', pg_catalog.jsonb_build_object(
      'name', 'InterviewCampaignLifecyclePreviewV1', 'version', '1.0.0'
    ),
    'operation', p_operation,
    'commandType', 'targets.change_interview_campaign_lifecycle_v1',
    'reason', p_reason,
    'before', pg_catalog.jsonb_build_object(
      'campaignId', p_campaign_id, 'campaignKey', p_campaign_key, 'title', p_title,
      'lifecycle', pg_catalog.upper(p_lifecycle), 'aggregateVersion', p_aggregate_version::text
    ),
    'after', pg_catalog.jsonb_build_object(
      'campaignId', p_campaign_id, 'campaignKey', p_campaign_key, 'title', p_title,
      'lifecycle', pg_catalog.upper(v_after_lifecycle), 'aggregateVersion', v_after_version::text
    ),
    'canApply', true,
    'blockingReasons', '[]'::jsonb,
    'warnings', '[]'::jsonb,
    'previewDigest', v_digest
  );
end
$function$;

create function api.preview_interview_campaign_lifecycle_v1(
  p_campaign_key text,
  p_operation text,
  p_expected_campaign_version text,
  p_reason text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_workspace_id uuid;
  v_campaign targets.interview_campaigns%rowtype;
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
     or p_expected_campaign_version::numeric > 9223372036854775807 then
    raise exception using errcode = '22023',
      message = 'Interview Campaign lifecycle request is invalid';
  end if;

  select campaign.* into v_campaign
  from targets.interview_campaigns as campaign
  where campaign.workspace_id = v_workspace_id and campaign.campaign_key = p_campaign_key;
  if not found then
    raise exception using errcode = '42501', message = 'Interview Campaign is not accessible';
  end if;

  return targets.build_interview_campaign_lifecycle_preview_v1(
    v_workspace_id, v_campaign.campaign_id, v_campaign.campaign_key, v_campaign.title,
    v_campaign.lifecycle, v_campaign.aggregate_version, p_operation,
    p_expected_campaign_version::bigint, p_reason
  );
end
$function$;

create function api.apply_interview_campaign_lifecycle_v1(
  p_campaign_key text,
  p_operation text,
  p_expected_campaign_version text,
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
  v_campaign targets.interview_campaigns%rowtype;
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
  if p_campaign_key is null
     or p_campaign_key !~ '^campaign:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or p_operation not in ('start_campaign', 'end_campaign', 'cancel_campaign')
     or p_expected_campaign_version is null
     or p_expected_campaign_version !~ '^[1-9][0-9]{0,18}$'
     or p_expected_campaign_version::numeric > 9223372036854775807 then
    raise exception using errcode = '22023',
      message = 'Interview Campaign lifecycle request is invalid';
  end if;
  if p_preview_digest is null or p_preview_digest !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'Interview Campaign preview digest is invalid';
  end if;
  if p_reason is null or p_reason <> pg_catalog.btrim(p_reason)
     or pg_catalog.char_length(p_reason) not between 1 and 500
     or p_reason ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'Interview Campaign reason is invalid';
  end if;
  if p_idempotency_key is null
     or p_idempotency_key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     then
    raise exception using errcode = '22023', message = 'idempotency key must be a UUID';
  end if;

  v_request_hash := extensions.digest(
    pg_catalog.convert_to(
      targets.frame_named_fields_v1(
        array[
          'requestHashVersion','schemaVersion','workspaceId','commandType','operation',
          'idempotencyKey','campaignKey','expectedCampaignVersion','previewDigest','reason'
        ],
        array[
          'interview-campaign-lifecycle-request-hash/1.0.0','1.0.0',
          pg_catalog.lower(v_workspace_id::text),
          'targets.change_interview_campaign_lifecycle_v1',p_operation,p_idempotency_key,
          p_campaign_key,p_expected_campaign_version,p_preview_digest,p_reason
        ]
      ),
      'UTF8'
    ),
    'sha256'
  );

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    v_actor_user_id::text || ':targets.change_interview_campaign_lifecycle_v1:'
      || p_idempotency_key, 0
  ));
  select receipt.* into v_receipt
  from outbox.command_receipts as receipt
  where receipt.actor_user_id = v_actor_user_id
    and receipt.command_type = 'targets.change_interview_campaign_lifecycle_v1'
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
    pg_catalog.hashtextextended('targets-workspace:' || v_workspace_id::text, 0)
  );

  select campaign.* into v_campaign
  from targets.interview_campaigns as campaign
  where campaign.workspace_id = v_workspace_id and campaign.campaign_key = p_campaign_key
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'Interview Campaign is not accessible';
  end if;

  v_preview := targets.build_interview_campaign_lifecycle_preview_v1(
    v_workspace_id, v_campaign.campaign_id, v_campaign.campaign_key, v_campaign.title,
    v_campaign.lifecycle, v_campaign.aggregate_version, p_operation,
    p_expected_campaign_version::bigint, p_reason
  );
  if v_preview->>'previewDigest' is distinct from p_preview_digest then
    raise exception using errcode = '40001', message = 'Interview Campaign preview is stale';
  end if;
  v_after_lifecycle := pg_catalog.lower(v_preview#>>'{after,lifecycle}');

  insert into outbox.command_receipts (
    command_id, command_type, command_schema_version, workspace_id, actor_user_id,
    idempotency_key, request_hash, correlation_id, expected_aggregate_version
  ) values (
    v_command_id, 'targets.change_interview_campaign_lifecycle_v1', 1, v_workspace_id,
    v_actor_user_id, p_idempotency_key, v_request_hash, v_correlation_id,
    p_expected_campaign_version::bigint
  );
  get diagnostics v_affected_rows = row_count;
  if v_affected_rows <> 1 then
    raise exception using errcode = '55000',
      message = 'Interview Campaign lifecycle receipt insert failed';
  end if;

  update targets.interview_campaigns
  set lifecycle = v_after_lifecycle,
    aggregate_version = aggregate_version + 1,
    updated_at = pg_catalog.clock_timestamp()
  where workspace_id = v_workspace_id
    and campaign_id = v_campaign.campaign_id
    and aggregate_version = p_expected_campaign_version::bigint
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
    v_event_id, 'targets.interview_campaign_changed', 1, v_workspace_id,
    'targets.interview_campaign', v_campaign.campaign_id, v_campaign.aggregate_version + 1,
    'user', v_actor_user_id, v_command_id, v_correlation_id, pg_catalog.clock_timestamp(),
    'pando.database', v_payload
  );
  get diagnostics v_affected_rows = row_count;
  if v_affected_rows <> 1 then
    raise exception using errcode = '55000',
      message = 'Interview Campaign lifecycle event insert failed';
  end if;

  v_response := pg_catalog.jsonb_build_object(
    'contract', pg_catalog.jsonb_build_object(
      'name', 'InterviewCampaignLifecycleApplyResultV1', 'version', '1.0.0'
    ),
    'commandId', v_command_id,
    'campaign', v_preview->'after',
    'emittedEventIds', pg_catalog.jsonb_build_array(v_event_id)
  );
  update outbox.command_receipts
  set command_status = 'completed', response = v_response,
    emitted_event_ids = array[v_event_id], completed_at = pg_catalog.clock_timestamp()
  where command_id = v_command_id;
  get diagnostics v_affected_rows = row_count;
  if v_affected_rows <> 1 then
    raise exception using errcode = '55000',
      message = 'Interview Campaign lifecycle receipt completion failed';
  end if;
  return v_response;
end
$function$;

-- ---------------------------------------------------------------------------------------------
-- Read boundary
-- ---------------------------------------------------------------------------------------------

create function api.get_interview_campaigns_v1()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_workspace_id uuid;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_campaigns jsonb;
begin
  if identity.jwt_subject() is null then
    raise exception using errcode = '28000', message = 'an authenticated user is required';
  end if;
  v_workspace_id := identity.personal_workspace_id_for_current_user();
  if v_workspace_id is null then
    raise exception using errcode = '28000', message = 'authenticated user is not provisioned';
  end if;

  select coalesce(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'campaignKey', campaign.campaign_key,
      'title', campaign.title,
      'lifecycle', pg_catalog.upper(campaign.lifecycle),
      'readinessGoal', pg_catalog.jsonb_build_object(
        'readinessGoalKey', goal.readiness_goal_key, 'title', goal.title
      ),
      'deadline', pg_catalog.jsonb_build_object(
        'localDate', campaign.deadline_local_date,
        'timeZone', campaign.deadline_time_zone,
        'at', campaign.deadline_at,
        'passed', campaign.deadline_at <= v_now,
        'daysUntil', greatest(
          0,
          campaign.deadline_local_date - (v_now at time zone campaign.deadline_time_zone)::date
        )
      ),
      'aggregateVersion', campaign.aggregate_version::text,
      'capabilities', case campaign.lifecycle
        when 'draft' then pg_catalog.jsonb_build_array(
          'start_campaign', 'change_campaign_deadline', 'change_campaign_target',
          'cancel_campaign'
        )
        when 'active' then pg_catalog.jsonb_build_array(
          'end_campaign', 'change_campaign_deadline', 'change_campaign_target',
          'cancel_campaign'
        )
        else '[]'::jsonb
      end
    ) order by campaign.created_at desc, campaign.campaign_key collate "C"
  ), '[]'::jsonb)
  into v_campaigns
  from targets.interview_campaigns as campaign
  join targets.readiness_goals as goal on goal.readiness_goal_id = campaign.readiness_goal_id
  where campaign.workspace_id = v_workspace_id;

  return pg_catalog.jsonb_build_object(
    'contract', pg_catalog.jsonb_build_object('name', 'InterviewCampaignsV1', 'version', '1.0.0'),
    'campaigns', v_campaigns
  );
end
$function$;

-- ---------------------------------------------------------------------------------------------
-- Ownership, grants, and cleanup
-- ---------------------------------------------------------------------------------------------

alter function targets.frame_named_fields_v1(text[], text[]) owner to pando_phase1_api;
alter function targets.derive_campaign_identity_v1(uuid, text, text, text)
  owner to pando_phase1_api;
alter function targets.local_timestamp_to_instant_v1(timestamp, text) owner to pando_phase1_api;
alter function targets.campaign_created_event_payload_v1_is_valid(jsonb)
  owner to pando_phase1_api;
alter function targets.campaign_lifecycle_event_payload_v1_is_valid(jsonb)
  owner to pando_phase1_api;
alter function targets.campaign_deadline_changed_event_payload_v1_is_valid(jsonb)
  owner to pando_phase1_api;
alter function targets.campaign_retargeted_event_payload_v1_is_valid(jsonb)
  owner to pando_phase1_api;
alter function targets.build_interview_campaign_creation_preview_v1(
  uuid, uuid, text, text, text, bigint, bigint, text, date, text, date, text, text
) owner to pando_phase1_api;
alter function targets.build_interview_campaign_deadline_preview_v1(
  uuid, uuid, text, text, text, date, text, bigint, bigint, date, text, date, text
) owner to pando_phase1_api;
alter function targets.build_interview_campaign_retarget_preview_v1(
  uuid, uuid, text, text, text, bigint, bigint, uuid, text, text, uuid, text, text, text, bigint,
  bigint, integer, text
) owner to pando_phase1_api;
alter function targets.build_interview_campaign_lifecycle_preview_v1(
  uuid, uuid, text, text, text, bigint, text, bigint, text
) owner to pando_phase1_api;
alter function api.preview_interview_campaign_creation_v1(text, text, text, date, text, text)
  owner to pando_phase1_api;
alter function api.apply_interview_campaign_creation_v1(text, text, text, date, text, text, text)
  owner to pando_phase1_api;
alter function api.preview_interview_campaign_deadline_change_v1(text, text, date, text)
  owner to pando_phase1_api;
alter function api.apply_interview_campaign_deadline_change_v1(
  text, text, date, text, text, text
) owner to pando_phase1_api;
alter function api.preview_interview_campaign_retarget_v1(text, text, text, text, text)
  owner to pando_phase1_api;
alter function api.apply_interview_campaign_retarget_v1(text, text, text, text, text, text, text)
  owner to pando_phase1_api;
alter function api.preview_interview_campaign_lifecycle_v1(text, text, text, text)
  owner to pando_phase1_api;
alter function api.apply_interview_campaign_lifecycle_v1(text, text, text, text, text, text)
  owner to pando_phase1_api;
alter function api.get_interview_campaigns_v1() owner to pando_phase1_api;

revoke all on function
  targets.frame_named_fields_v1(text[], text[]),
  targets.derive_campaign_identity_v1(uuid, text, text, text),
  targets.local_timestamp_to_instant_v1(timestamp, text),
  targets.campaign_created_event_payload_v1_is_valid(jsonb),
  targets.campaign_lifecycle_event_payload_v1_is_valid(jsonb),
  targets.campaign_deadline_changed_event_payload_v1_is_valid(jsonb),
  targets.campaign_retargeted_event_payload_v1_is_valid(jsonb),
  targets.build_interview_campaign_creation_preview_v1(
    uuid, uuid, text, text, text, bigint, bigint, text, date, text, date, text, text
  ),
  targets.build_interview_campaign_deadline_preview_v1(
    uuid, uuid, text, text, text, date, text, bigint, bigint, date, text, date, text
  ),
  targets.build_interview_campaign_retarget_preview_v1(
    uuid, uuid, text, text, text, bigint, bigint, uuid, text, text, uuid, text, text, text, bigint,
    bigint, integer, text
  ),
  targets.build_interview_campaign_lifecycle_preview_v1(
    uuid, uuid, text, text, text, bigint, text, bigint, text
  ),
  api.preview_interview_campaign_creation_v1(text, text, text, date, text, text),
  api.apply_interview_campaign_creation_v1(text, text, text, date, text, text, text),
  api.preview_interview_campaign_deadline_change_v1(text, text, date, text),
  api.apply_interview_campaign_deadline_change_v1(text, text, date, text, text, text),
  api.preview_interview_campaign_retarget_v1(text, text, text, text, text),
  api.apply_interview_campaign_retarget_v1(text, text, text, text, text, text, text),
  api.preview_interview_campaign_lifecycle_v1(text, text, text, text),
  api.apply_interview_campaign_lifecycle_v1(text, text, text, text, text, text),
  api.get_interview_campaigns_v1()
  from public, anon, authenticated, service_role;

grant execute on function
  api.preview_interview_campaign_creation_v1(text, text, text, date, text, text),
  api.apply_interview_campaign_creation_v1(text, text, text, date, text, text, text),
  api.preview_interview_campaign_deadline_change_v1(text, text, date, text),
  api.apply_interview_campaign_deadline_change_v1(text, text, date, text, text, text),
  api.preview_interview_campaign_retarget_v1(text, text, text, text, text),
  api.apply_interview_campaign_retarget_v1(text, text, text, text, text, text, text),
  api.preview_interview_campaign_lifecycle_v1(text, text, text, text),
  api.apply_interview_campaign_lifecycle_v1(text, text, text, text, text, text),
  api.get_interview_campaigns_v1()
  to authenticated;

revoke create on schema targets, api from pando_phase1_api;

do $migration_role_membership_revoke$
begin
  execute pg_catalog.format('revoke pando_phase1_api from %I', current_user);
end
$migration_role_membership_revoke$;
