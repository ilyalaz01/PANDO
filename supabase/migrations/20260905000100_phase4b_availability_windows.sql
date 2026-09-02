-- Phase 4B D3b1: dated availability windows for the current Growth Plan.
-- ADR-0010 section 6 makes a window a plan-scoped, whole-local-day, non-overlapping cap. This slice
-- persists and controls windows; it does not yet change weekly capacity, which is the separate D3b2
-- V3 calculation rollout.

create extension if not exists btree_gist with schema extensions;

do $migration_role_membership$
begin
  execute pg_catalog.format('grant pando_planning_api to %I with set true', current_user);
end
$migration_role_membership$;

grant create on schema planning, api to pando_planning_api;

create table planning.availability_windows (
  availability_window_id uuid primary key,
  workspace_id uuid not null references identity.workspaces (workspace_id) on delete restrict,
  growth_plan_id uuid not null,
  window_key text not null,
  starts_on date not null,
  ends_on date not null,
  time_zone text not null,
  available_minutes smallint not null,
  energy text,
  label text,
  lifecycle text not null default 'active',
  aggregate_version bigint not null default 1,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint availability_windows_plan_fk
    foreign key (workspace_id, growth_plan_id)
    references planning.growth_plans (workspace_id, growth_plan_id) on delete restrict,
  constraint availability_windows_key_check check (
    window_key ~ '^window:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint availability_windows_range_check check (
    starts_on <= ends_on and ends_on - starts_on <= 365
  ),
  constraint availability_windows_minutes_check check (
    available_minutes between 0 and 1440
  ),
  constraint availability_windows_energy_check check (
    energy is null or energy in ('LOW', 'MEDIUM', 'HIGH')
  ),
  constraint availability_windows_label_check check (
    label is null or (
      label = btrim(label) and char_length(label) between 1 and 120
      and label !~ '[[:cntrl:]]'
    )
  ),
  constraint availability_windows_lifecycle_check check (
    lifecycle in ('active', 'removed')
  ),
  constraint availability_windows_time_zone_check check (
    time_zone = btrim(time_zone)
    and char_length(time_zone) between 1 and 100
    and time_zone ~ '^[A-Za-z0-9_+.-]+(?:/[A-Za-z0-9_+.-]+)*$'
    and identity.is_known_time_zone(time_zone) is true
  ),
  constraint availability_windows_version_check check (aggregate_version > 0),
  unique (workspace_id, availability_window_id),
  unique (workspace_id, window_key),
  -- ADR-0010 section 6: active windows of one Plan are pairwise non-overlapping regardless of
  -- application code. Adjacent windows remain legal and separate.
  constraint availability_windows_no_overlap exclude using gist (
    workspace_id extensions.gist_uuid_ops with =,
    growth_plan_id extensions.gist_uuid_ops with =,
    daterange(starts_on, ends_on, '[]') with &&
  ) where (lifecycle = 'active')
);

create index availability_windows_current_plan_order
  on planning.availability_windows (workspace_id, growth_plan_id, lifecycle, starts_on, window_key);

alter table planning.availability_windows enable row level security;
alter table planning.availability_windows force row level security;
revoke all on table planning.availability_windows
  from public, anon, authenticated, service_role;
grant select, insert, update on planning.availability_windows to pando_planning_api;
create policy availability_windows_planning_api on planning.availability_windows
for all to pando_planning_api
using (identity.is_workspace_member(workspace_id))
with check (identity.is_workspace_member(workspace_id));

create function planning.derive_availability_window_identity_v1(
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
  if p_command_type <> 'planning.change_availability_window_v1'
     or p_idempotency_key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or p_label <> 'availability-window' then
    raise exception using errcode = '22023', message = 'availability identity input is invalid';
  end if;
  v_hash := pg_catalog.substring(
    extensions.digest(
      pg_catalog.convert_to(
        planning.frame_named_fields_v1(
          array['identityVersion','workspaceId','commandType','idempotencyKey','label'],
          array[
            'planning-create-identity/1.0.0', pg_catalog.lower(p_workspace_id::text),
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

create function planning.availability_window_constraint_v1(
  p_workspace_id uuid,
  p_growth_plan_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_active integer;
  v_removed integer;
  v_fingerprint_input text;
  v_fingerprint text;
begin
  if p_workspace_id is null or p_growth_plan_id is null then
    raise exception using errcode = '22023',
      message = 'availability window constraint input is invalid';
  end if;

  select
    pg_catalog.count(*) filter (where window_row.lifecycle = 'active')::integer,
    pg_catalog.count(*) filter (where window_row.lifecycle = 'removed')::integer
  into v_active, v_removed
  from planning.availability_windows as window_row
  where window_row.workspace_id = p_workspace_id
    and window_row.growth_plan_id = p_growth_plan_id;

  select pg_catalog.string_agg(
    fingerprint_part.part_name || ':'
      || pg_catalog.octet_length(
        pg_catalog.convert_to(fingerprint_part.part_value, 'UTF8')
      )::text
      || ':' || fingerprint_part.part_value || pg_catalog.chr(10),
    '' order by fingerprint_part.part_position
  ) into v_fingerprint_input
  from (
    select 1::bigint as part_position,
      'fingerprintVersion'::text as part_name,
      'availability-window-fingerprint/1.0.0'::text as part_value
    union all
    select 2, 'activeWindowCount', v_active::text
    union all
    select
      2 + ordered_window.window_position * 10 + field.field_position,
      field.field_name,
      field.field_value
    from (
      select
        window_row.window_key,
        window_row.aggregate_version,
        window_row.starts_on,
        window_row.ends_on,
        window_row.available_minutes,
        pg_catalog.row_number() over (order by window_row.window_key collate "C")::bigint
          as window_position
      from planning.availability_windows as window_row
      where window_row.workspace_id = p_workspace_id
        and window_row.growth_plan_id = p_growth_plan_id
        and window_row.lifecycle = 'active'
    ) as ordered_window
    cross join lateral (
      values
        (1::bigint, 'windowKey'::text, ordered_window.window_key),
        (2::bigint, 'aggregateVersion'::text, ordered_window.aggregate_version::text),
        (3::bigint, 'startsOn'::text, ordered_window.starts_on::text),
        (4::bigint, 'endsOn'::text, ordered_window.ends_on::text),
        (5::bigint, 'availableMinutes'::text, ordered_window.available_minutes::text)
    ) as field(field_position, field_name, field_value)
  ) as fingerprint_part;

  v_fingerprint := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(v_fingerprint_input, 'UTF8'), 'sha256'),
    'hex'
  );

  return pg_catalog.jsonb_build_object(
    'activeWindowCount', v_active,
    'removedWindowCount', v_removed,
    'activeWindowFingerprint', v_fingerprint
  );
end
$function$;

create function planning.availability_changed_event_payload_v1_is_valid(p_payload jsonb)
returns boolean
language sql
immutable
strict
set search_path = ''
as $function$
  select pg_catalog.jsonb_typeof(p_payload) = 'object'
    and (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(p_payload)) = 5
    and p_payload->>'change_kind' = 'AVAILABILITY_CHANGED'
    and p_payload->>'operation' in (
      'create_availability_window', 'change_availability_window', 'remove_availability_window'
    )
    and p_payload->>'growth_plan_id'
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and p_payload->>'availability_window_id'
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and case
      when p_payload->>'availability_window_version' ~ '^[1-9][0-9]{0,18}$'
        then (p_payload->>'availability_window_version')::numeric <= 9223372036854775807
      else false
    end
$function$;

create function planning.build_availability_window_preview_v1(
  p_workspace_id uuid,
  p_operation text,
  p_growth_plan_id uuid,
  p_growth_plan_lifecycle text,
  p_growth_plan_weekly_capacity_minutes integer,
  p_growth_plan_version bigint,
  p_expected_growth_plan_version bigint,
  p_constraint jsonb,
  p_current_window jsonb,
  p_proposed_window jsonb,
  p_blocking_reason text,
  p_reason text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $function$
declare
  v_can_apply boolean;
  v_warnings jsonb;
  v_warning_codes text[];
  v_names text[];
  v_values text[];
  v_digest_input text;
  v_digest text;
begin
  if p_operation not in (
       'create_availability_window', 'change_availability_window', 'remove_availability_window'
     )
     or p_workspace_id is null or p_growth_plan_id is null
     or p_growth_plan_lifecycle not in ('active', 'paused')
     or p_growth_plan_version is null or p_growth_plan_version < 1
     or p_expected_growth_plan_version is null or p_expected_growth_plan_version < 1
     or p_proposed_window is null then
    raise exception using errcode = '22023',
      message = 'availability window preview input is invalid';
  end if;
  if p_reason is null or p_reason <> pg_catalog.btrim(p_reason)
     or pg_catalog.char_length(p_reason) not between 1 and 500
     or p_reason ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'availability window reason is invalid';
  end if;
  if p_expected_growth_plan_version <> p_growth_plan_version then
    raise exception using errcode = '40001', message = 'Growth Plan version is stale';
  end if;

  v_can_apply := p_blocking_reason is null;
  v_warnings := pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object('code', 'AVAILABILITY_NOT_YET_APPLIED_TO_CAPACITY')
  );
  select pg_catalog.array_agg(warning.value->>'code' order by warning.ordinality)
  into v_warning_codes
  from pg_catalog.jsonb_array_elements(v_warnings) with ordinality as warning(value, ordinality);

  v_names := array[
    'digestVersion','contractVersion','identityVersion','workspaceId','operation','commandType',
    'idempotencyKey','reason','expectedGrowthPlanVersion','growthPlanId','growthPlanLifecycle',
    'growthPlanWeeklyCapacityMinutes','growthPlanVersion','activeWindowCountBefore',
    'activeWindowCountAfter','removedWindowCount','activeWindowFingerprint','beforeWindowKey',
    'beforeStartsOn','beforeEndsOn','beforeTimeZone','beforeAvailableMinutes','beforeEnergy',
    'beforeLabel','beforeLifecycle','beforeVersion','afterWindowKey','afterAvailabilityWindowId',
    'afterStartsOn','afterEndsOn','afterTimeZone','afterAvailableMinutes','afterEnergy',
    'afterLabel','afterLifecycle','afterVersion','canApply','blockingReasonCode','warningCount'
  ] || pg_catalog.array_fill('warningCode'::text, array[pg_catalog.cardinality(v_warning_codes)])
    || array[
    'retainedGrowthPlan','retainedLearningTracks','retainedActivitiesAndEvidence','retainedMastery',
    'retainedReviews','retainedPlanSnapshots','projectionStateAfterApply','eventChangeKind',
    'consumerName'
  ];
  v_values := array[
    'availability-window-preview-digest/1.0.0','1.0.0','planning-create-identity/1.0.0',
    pg_catalog.lower(p_workspace_id::text),p_operation,'planning.change_availability_window_v1',
    p_idempotency_key,p_reason,p_expected_growth_plan_version::text,
    pg_catalog.lower(p_growth_plan_id::text),pg_catalog.upper(p_growth_plan_lifecycle),
    p_growth_plan_weekly_capacity_minutes::text,p_growth_plan_version::text,
    (p_constraint->>'activeWindowCount'),
    case p_operation
      when 'create_availability_window' then ((p_constraint->>'activeWindowCount')::integer + 1)
      when 'remove_availability_window' then ((p_constraint->>'activeWindowCount')::integer - 1)
      else (p_constraint->>'activeWindowCount')::integer
    end::text,
    (p_constraint->>'removedWindowCount'),(p_constraint->>'activeWindowFingerprint'),
    coalesce(p_current_window->>'windowKey',''),coalesce(p_current_window->>'startsOn',''),
    coalesce(p_current_window->>'endsOn',''),coalesce(p_current_window->>'timeZone',''),
    coalesce(p_current_window->>'availableMinutes',''),coalesce(p_current_window->>'energy',''),
    coalesce(p_current_window->>'label',''),coalesce(p_current_window->>'lifecycle',''),
    coalesce(p_current_window->>'aggregateVersion',''),
    p_proposed_window->>'windowKey',p_proposed_window->>'availabilityWindowId',
    p_proposed_window->>'startsOn',p_proposed_window->>'endsOn',p_proposed_window->>'timeZone',
    p_proposed_window->>'availableMinutes',coalesce(p_proposed_window->>'energy',''),
    coalesce(p_proposed_window->>'label',''),p_proposed_window->>'lifecycle',
    p_proposed_window->>'aggregateVersion',pg_catalog.lower(v_can_apply::text),
    coalesce(p_blocking_reason,''),pg_catalog.cardinality(v_warning_codes)::text
  ] || v_warning_codes || array[
    'true','true','true','true','true','true','PENDING','AVAILABILITY_CHANGED',
    'planning.plan_snapshot_v1'
  ];
  v_digest_input := planning.frame_named_fields_v1(v_names, v_values);
  v_digest := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(v_digest_input, 'UTF8'), 'sha256'), 'hex'
  );

  return pg_catalog.jsonb_build_object(
    'contract', pg_catalog.jsonb_build_object(
      'name', 'AvailabilityWindowPreviewV1', 'version', '1.0.0'
    ),
    'digestVersion', 'availability-window-preview-digest/1.0.0',
    'identityVersion', 'planning-create-identity/1.0.0',
    'operation', p_operation,
    'commandType', 'planning.change_availability_window_v1',
    'idempotencyKey', p_idempotency_key,
    'reason', p_reason,
    'expectedGrowthPlanVersion', p_expected_growth_plan_version::text,
    'growthPlan', pg_catalog.jsonb_build_object(
      'growthPlanId', p_growth_plan_id,
      'lifecycle', pg_catalog.upper(p_growth_plan_lifecycle),
      'weeklyCapacityMinutes', p_growth_plan_weekly_capacity_minutes,
      'aggregateVersion', p_growth_plan_version::text
    ),
    'before', pg_catalog.jsonb_build_object(
      'activeWindowCount', (p_constraint->>'activeWindowCount')::integer,
      'removedWindowCount', (p_constraint->>'removedWindowCount')::integer,
      'activeWindowFingerprint', p_constraint->>'activeWindowFingerprint',
      'window', coalesce(p_current_window, 'null'::jsonb)
    ),
    'after', pg_catalog.jsonb_build_object(
      'activeWindowCount', case p_operation
        when 'create_availability_window' then (p_constraint->>'activeWindowCount')::integer + 1
        when 'remove_availability_window' then (p_constraint->>'activeWindowCount')::integer - 1
        else (p_constraint->>'activeWindowCount')::integer
      end,
      'window', p_proposed_window
    ),
    'canApply', v_can_apply,
    'blockingReasons', case when p_blocking_reason is null then '[]'::jsonb else
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('code', p_blocking_reason)) end,
    'warnings', v_warnings,
    'retained', pg_catalog.jsonb_build_object(
      'growthPlan', true, 'learningTracks', true, 'activitiesAndEvidence', true,
      'mastery', true, 'reviews', true, 'planSnapshots', true
    ),
    'recalculationAfterApply', pg_catalog.jsonb_build_object(
      'projectionState', 'PENDING', 'eventChangeKind', 'AVAILABILITY_CHANGED',
      'consumerName', 'planning.plan_snapshot_v1'
    ),
    'previewDigest', v_digest
  );
end
$function$;

do $migration_identity_membership$
begin
  execute pg_catalog.format(
    'grant pando_identity_planning_source to %I with set true', current_user
  );
end
$migration_identity_membership$;
set role pando_identity_planning_source;
grant execute on function identity.read_planning_calendar_source_v1(uuid, timestamptz)
  to pando_planning_api;
reset role;
do $migration_identity_membership_revoke$
begin
  execute pg_catalog.format(
    'revoke pando_identity_planning_source from %I', current_user
  );
end
$migration_identity_membership_revoke$;

create function planning.resolve_availability_window_preview_v1(
  p_workspace_id uuid,
  p_operation text,
  p_window_key text,
  p_starts_on date,
  p_ends_on date,
  p_available_minutes integer,
  p_energy text,
  p_label text,
  p_expected_growth_plan_version bigint,
  p_expected_window_version bigint,
  p_reason text,
  p_idempotency_key text,
  p_as_of timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_plan planning.growth_plans%rowtype;
  v_calendar jsonb;
  v_time_zone text;
  v_today date;
  v_constraint jsonb;
  v_current planning.availability_windows%rowtype;
  v_current_json jsonb := null;
  v_window_id uuid;
  v_window_key text;
  v_proposed jsonb;
  v_blocker text := null;
  v_overlaps boolean;
begin
  select plan.* into v_plan
  from planning.growth_plans as plan
  where plan.workspace_id = p_workspace_id
    and plan.lifecycle in ('active', 'paused');
  if not found then
    raise exception using errcode = '42501', message = 'Growth Plan is unavailable';
  end if;

  v_calendar := identity.read_planning_calendar_source_v1(p_workspace_id, p_as_of);
  v_time_zone := v_calendar->>'timeZone';
  v_today := (p_as_of at time zone v_time_zone)::date;
  v_constraint := planning.availability_window_constraint_v1(p_workspace_id, v_plan.growth_plan_id);

  if p_operation = 'create_availability_window' then
    v_window_id := planning.derive_availability_window_identity_v1(
      p_workspace_id, 'planning.change_availability_window_v1', p_idempotency_key,
      'availability-window'
    );
    v_window_key := 'window:' || pg_catalog.lower(v_window_id::text);
    if p_ends_on < v_today then
      raise exception using errcode = '22023',
        message = 'availability window ends in the past';
    end if;
    if exists (
      select 1 from planning.availability_windows as window_row
      where window_row.availability_window_id = v_window_id
         or window_row.window_key = v_window_key
    ) then
      v_blocker := 'PLANNING_CREATE_IDENTITY_COLLISION';
    elsif (v_constraint->>'activeWindowCount')::integer >= 60 then
      v_blocker := 'AVAILABILITY_WINDOW_LIMIT_REACHED';
    end if;
    v_proposed := pg_catalog.jsonb_build_object(
      'windowKey', v_window_key,
      'availabilityWindowId', pg_catalog.lower(v_window_id::text),
      'startsOn', p_starts_on::text,
      'endsOn', p_ends_on::text,
      'timeZone', v_time_zone,
      'availableMinutes', p_available_minutes,
      'energy', p_energy,
      'label', p_label,
      'lifecycle', 'ACTIVE',
      'aggregateVersion', '1'
    );
  else
    select window_row.* into v_current
    from planning.availability_windows as window_row
    where window_row.workspace_id = p_workspace_id
      and window_row.growth_plan_id = v_plan.growth_plan_id
      and window_row.window_key = p_window_key;
    if not found then
      raise exception using errcode = '42501', message = 'availability window is unavailable';
    end if;
    if p_expected_window_version is null
       or p_expected_window_version <> v_current.aggregate_version then
      raise exception using errcode = '40001', message = 'availability window version is stale';
    end if;
    if v_current.aggregate_version = 9223372036854775807 then
      raise exception using errcode = '22003', message = 'availability window version is exhausted';
    end if;
    v_window_id := v_current.availability_window_id;
    v_window_key := v_current.window_key;
    v_current_json := pg_catalog.jsonb_build_object(
      'windowKey', v_current.window_key,
      'availabilityWindowId', pg_catalog.lower(v_current.availability_window_id::text),
      'startsOn', v_current.starts_on::text,
      'endsOn', v_current.ends_on::text,
      'timeZone', v_current.time_zone,
      'availableMinutes', v_current.available_minutes,
      'energy', v_current.energy,
      'label', v_current.label,
      'lifecycle', pg_catalog.upper(v_current.lifecycle),
      'aggregateVersion', v_current.aggregate_version::text
    );
    if v_current.lifecycle = 'removed' then
      v_blocker := 'AVAILABILITY_WINDOW_ALREADY_REMOVED';
    end if;
    if p_operation = 'change_availability_window' then
      if p_ends_on < v_today then
        raise exception using errcode = '22023',
          message = 'availability window ends in the past';
      end if;
      select exists (
        select 1 from planning.availability_windows as window_row
        where window_row.workspace_id = p_workspace_id
          and window_row.growth_plan_id = v_plan.growth_plan_id
          and window_row.lifecycle = 'active'
          and window_row.availability_window_id <> v_window_id
          and daterange(window_row.starts_on, window_row.ends_on, '[]')
            && daterange(p_starts_on, p_ends_on, '[]')
      ) into v_overlaps;
      if v_blocker is null and v_overlaps then
        v_blocker := 'AVAILABILITY_WINDOW_OVERLAPS_EXISTING';
      end if;
      v_proposed := pg_catalog.jsonb_build_object(
        'windowKey', v_window_key,
        'availabilityWindowId', pg_catalog.lower(v_window_id::text),
        'startsOn', p_starts_on::text,
        'endsOn', p_ends_on::text,
        'timeZone', v_current.time_zone,
        'availableMinutes', p_available_minutes,
        'energy', p_energy,
        'label', p_label,
        'lifecycle', 'ACTIVE',
        'aggregateVersion', (v_current.aggregate_version + 1)::text
      );
    else
      v_proposed := pg_catalog.jsonb_build_object(
        'windowKey', v_window_key,
        'availabilityWindowId', pg_catalog.lower(v_window_id::text),
        'startsOn', v_current.starts_on::text,
        'endsOn', v_current.ends_on::text,
        'timeZone', v_current.time_zone,
        'availableMinutes', v_current.available_minutes,
        'energy', v_current.energy,
        'label', v_current.label,
        'lifecycle', 'REMOVED',
        'aggregateVersion', (v_current.aggregate_version + 1)::text
      );
    end if;
  end if;

  if p_operation = 'create_availability_window' and v_blocker is null then
    select exists (
      select 1 from planning.availability_windows as window_row
      where window_row.workspace_id = p_workspace_id
        and window_row.growth_plan_id = v_plan.growth_plan_id
        and window_row.lifecycle = 'active'
        and daterange(window_row.starts_on, window_row.ends_on, '[]')
          && daterange(p_starts_on, p_ends_on, '[]')
    ) into v_overlaps;
    if v_overlaps then
      v_blocker := 'AVAILABILITY_WINDOW_OVERLAPS_EXISTING';
    end if;
  end if;

  return planning.build_availability_window_preview_v1(
    p_workspace_id, p_operation, v_plan.growth_plan_id, v_plan.lifecycle,
    v_plan.weekly_capacity_minutes, v_plan.aggregate_version, p_expected_growth_plan_version,
    v_constraint, v_current_json, v_proposed, v_blocker, p_reason, p_idempotency_key
  );
end
$function$;

create function planning.validate_availability_window_request_v1(
  p_operation text,
  p_window_key text,
  p_starts_on date,
  p_ends_on date,
  p_available_minutes integer,
  p_energy text,
  p_label text,
  p_expected_growth_plan_version text,
  p_expected_window_version text,
  p_reason text,
  p_idempotency_key text
)
returns void
language plpgsql
immutable
set search_path = ''
as $function$
begin
  if p_operation not in (
       'create_availability_window', 'change_availability_window', 'remove_availability_window'
     ) then
    raise exception using errcode = '22023', message = 'availability window operation is invalid';
  end if;
  if p_expected_growth_plan_version is null
     or p_expected_growth_plan_version !~ '^[1-9][0-9]{0,18}$'
     or p_expected_growth_plan_version::numeric > 9223372036854775807 then
    raise exception using errcode = '22023', message = 'availability window request is invalid';
  end if;
  if p_reason is null or p_reason <> pg_catalog.btrim(p_reason)
     or pg_catalog.char_length(p_reason) not between 1 and 500
     or p_reason ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'availability window reason is invalid';
  end if;
  if p_idempotency_key is null
     or p_idempotency_key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     then
    raise exception using errcode = '22023', message = 'idempotency key must be a UUID';
  end if;
  if p_operation = 'create_availability_window' then
    if p_window_key is not null or p_expected_window_version is not null then
      raise exception using errcode = '22023', message = 'availability window request is invalid';
    end if;
  else
    if p_window_key is null
       or p_window_key !~ '^window:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or p_expected_window_version is null
       or p_expected_window_version !~ '^[1-9][0-9]{0,18}$'
       or p_expected_window_version::numeric > 9223372036854775807 then
      raise exception using errcode = '22023', message = 'availability window request is invalid';
    end if;
  end if;
  if p_operation = 'remove_availability_window' then
    if p_starts_on is not null or p_ends_on is not null or p_available_minutes is not null
       or p_energy is not null or p_label is not null then
      raise exception using errcode = '22023', message = 'availability window request is invalid';
    end if;
    return;
  end if;
  if p_starts_on is null or p_ends_on is null or p_starts_on > p_ends_on
     or p_ends_on - p_starts_on > 365
     or p_available_minutes is null or p_available_minutes not between 0 and 1440
     or (p_energy is not null and p_energy not in ('LOW', 'MEDIUM', 'HIGH'))
     or (p_label is not null and (
       p_label <> pg_catalog.btrim(p_label)
       or pg_catalog.char_length(p_label) not between 1 and 120
       or p_label ~ '[[:cntrl:]]'
     )) then
    raise exception using errcode = '22023', message = 'availability window request is invalid';
  end if;
end
$function$;

create function api.get_availability_window_source_v1()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_workspace_id uuid;
  v_plan planning.growth_plans%rowtype;
  v_current_count integer;
  v_constraint jsonb;
  v_windows jsonb := '[]'::jsonb;
begin
  if identity.jwt_subject() is null then
    raise exception using errcode = '28000', message = 'an authenticated user is required';
  end if;
  v_workspace_id := identity.personal_workspace_id_for_current_user();
  if v_workspace_id is null then
    raise exception using errcode = '28000', message = 'authenticated user is not provisioned';
  end if;

  select pg_catalog.count(*)::integer into v_current_count
  from planning.growth_plans as plan
  where plan.workspace_id = v_workspace_id
    and plan.lifecycle in ('active', 'paused');
  if v_current_count > 1 then
    raise exception using errcode = '55000',
      message = 'availability current Plan state is corrupt';
  end if;
  if v_current_count = 0 then
    return pg_catalog.jsonb_build_object(
      'contract', pg_catalog.jsonb_build_object(
        'name', 'AvailabilityWindowSourceV1', 'version', '1.0.0'
      ),
      'state', 'NO_CURRENT_PLAN',
      'capabilities', '[]'::jsonb,
      'growthPlan', 'null'::jsonb,
      'availabilityWindows', '[]'::jsonb
    );
  end if;

  select plan.* into strict v_plan
  from planning.growth_plans as plan
  where plan.workspace_id = v_workspace_id
    and plan.lifecycle in ('active', 'paused');
  v_constraint := planning.availability_window_constraint_v1(
    v_workspace_id, v_plan.growth_plan_id
  );
  select coalesce(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'windowKey', window_row.window_key,
      'startsOn', window_row.starts_on::text,
      'endsOn', window_row.ends_on::text,
      'timeZone', window_row.time_zone,
      'availableMinutes', window_row.available_minutes,
      'energy', window_row.energy,
      'label', window_row.label,
      'lifecycle', pg_catalog.upper(window_row.lifecycle),
      'aggregateVersion', window_row.aggregate_version::text
    ) order by window_row.starts_on, window_row.window_key collate "C"
  ), '[]'::jsonb) into v_windows
  from planning.availability_windows as window_row
  where window_row.workspace_id = v_workspace_id
    and window_row.growth_plan_id = v_plan.growth_plan_id
    and window_row.lifecycle = 'active';

  return pg_catalog.jsonb_build_object(
    'contract', pg_catalog.jsonb_build_object(
      'name', 'AvailabilityWindowSourceV1', 'version', '1.0.0'
    ),
    'state', case
      when (v_constraint->>'activeWindowCount')::integer >= 60 then 'WINDOW_LIMIT_REACHED'
      else 'AVAILABILITY_AVAILABLE'
    end,
    'capabilities', case
      when (v_constraint->>'activeWindowCount')::integer >= 60
        then pg_catalog.jsonb_build_array(
          'change_availability_window', 'remove_availability_window'
        )
      else pg_catalog.jsonb_build_array(
        'create_availability_window', 'change_availability_window', 'remove_availability_window'
      )
    end,
    'growthPlan', pg_catalog.jsonb_build_object(
      'lifecycle', pg_catalog.upper(v_plan.lifecycle),
      'weeklyCapacityMinutes', v_plan.weekly_capacity_minutes,
      'aggregateVersion', v_plan.aggregate_version::text,
      'activeWindowCount', (v_constraint->>'activeWindowCount')::integer,
      'removedWindowCount', (v_constraint->>'removedWindowCount')::integer,
      'capacityUsesAvailability', false
    ),
    'availabilityWindows', v_windows
  );
end
$function$;

create function api.preview_availability_window_v1(
  p_operation text,
  p_window_key text,
  p_starts_on date,
  p_ends_on date,
  p_available_minutes integer,
  p_energy text,
  p_label text,
  p_expected_growth_plan_version text,
  p_expected_window_version text,
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
begin
  if identity.jwt_subject() is null then
    raise exception using errcode = '28000', message = 'an authenticated user is required';
  end if;
  v_workspace_id := identity.personal_workspace_id_for_current_user();
  if v_workspace_id is null then
    raise exception using errcode = '28000', message = 'authenticated user is not provisioned';
  end if;
  perform planning.validate_availability_window_request_v1(
    p_operation, p_window_key, p_starts_on, p_ends_on, p_available_minutes, p_energy, p_label,
    p_expected_growth_plan_version, p_expected_window_version, p_reason, p_idempotency_key
  );
  return planning.resolve_availability_window_preview_v1(
    v_workspace_id, p_operation, p_window_key, p_starts_on, p_ends_on, p_available_minutes,
    p_energy, p_label, p_expected_growth_plan_version::bigint,
    p_expected_window_version::bigint, p_reason, p_idempotency_key, pg_catalog.clock_timestamp()
  );
end
$function$;

create function api.apply_availability_window_v1(
  p_operation text,
  p_window_key text,
  p_starts_on date,
  p_ends_on date,
  p_available_minutes integer,
  p_energy text,
  p_label text,
  p_expected_growth_plan_version text,
  p_expected_window_version text,
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
  v_plan planning.growth_plans%rowtype;
  v_preview jsonb;
  v_payload jsonb;
  v_window_id uuid;
  v_command_id uuid := gen_random_uuid();
  v_correlation_id uuid := gen_random_uuid();
  v_event_id uuid := gen_random_uuid();
  v_delivery_id uuid := gen_random_uuid();
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
  perform planning.validate_availability_window_request_v1(
    p_operation, p_window_key, p_starts_on, p_ends_on, p_available_minutes, p_energy, p_label,
    p_expected_growth_plan_version, p_expected_window_version, p_reason, p_idempotency_key
  );
  if p_preview_digest is null or p_preview_digest !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023',
      message = 'availability window confirmation is invalid';
  end if;

  v_request_hash := extensions.digest(
    pg_catalog.convert_to(
      planning.frame_named_fields_v1(
        array[
          'requestHashVersion','schemaVersion','workspaceId','commandType','operation',
          'idempotencyKey','windowKey','startsOn','endsOn','availableMinutes','energy','label',
          'expectedGrowthPlanVersion','expectedWindowVersion','reason','previewDigest'
        ],
        array[
          'availability-window-request-hash/1.0.0','1.0.0',
          pg_catalog.lower(v_workspace_id::text),'planning.change_availability_window_v1',
          p_operation,p_idempotency_key,coalesce(p_window_key,''),
          coalesce(p_starts_on::text,''),coalesce(p_ends_on::text,''),
          coalesce(p_available_minutes::text,''),coalesce(p_energy,''),coalesce(p_label,''),
          p_expected_growth_plan_version,coalesce(p_expected_window_version,''),
          p_reason,p_preview_digest
        ]
      ),
      'UTF8'
    ),
    'sha256'
  );

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    v_actor_user_id::text || ':planning.change_availability_window_v1:' || p_idempotency_key, 0
  ));
  select receipt.* into v_receipt
  from outbox.command_receipts as receipt
  where receipt.actor_user_id = v_actor_user_id
    and receipt.command_type = 'planning.change_availability_window_v1'
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
  select plan.* into v_plan
  from planning.growth_plans as plan
  where plan.workspace_id = v_workspace_id
    and plan.lifecycle in ('active', 'paused')
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'Growth Plan is unavailable';
  end if;
  perform window_row.availability_window_id
  from planning.availability_windows as window_row
  where window_row.workspace_id = v_workspace_id
    and window_row.growth_plan_id = v_plan.growth_plan_id
  order by window_row.availability_window_id
  for update;

  v_preview := planning.resolve_availability_window_preview_v1(
    v_workspace_id, p_operation, p_window_key, p_starts_on, p_ends_on, p_available_minutes,
    p_energy, p_label, p_expected_growth_plan_version::bigint, p_expected_window_version::bigint,
    p_reason, p_idempotency_key, pg_catalog.clock_timestamp()
  );
  if (v_preview->>'canApply')::boolean is not true
     or v_preview->>'previewDigest' is distinct from p_preview_digest then
    raise exception using errcode = '40001', message = 'availability window preview is stale';
  end if;
  v_window_id := (v_preview#>>'{after,window,availabilityWindowId}')::uuid;

  insert into outbox.command_receipts (
    command_id, command_type, command_schema_version, workspace_id, actor_user_id,
    idempotency_key, request_hash, correlation_id, expected_aggregate_version
  ) values (
    v_command_id, 'planning.change_availability_window_v1', 1, v_workspace_id,
    v_actor_user_id, p_idempotency_key, v_request_hash, v_correlation_id,
    coalesce(p_expected_window_version::bigint, 0)
  );
  get diagnostics v_affected_rows = row_count;
  if v_affected_rows <> 1 then
    raise exception using errcode = '55000',
      message = 'availability window receipt insert failed';
  end if;

  if p_operation = 'create_availability_window' then
    insert into planning.availability_windows (
      availability_window_id, workspace_id, growth_plan_id, window_key, starts_on, ends_on,
      time_zone, available_minutes, energy, label, lifecycle, aggregate_version
    ) values (
      v_window_id, v_workspace_id, v_plan.growth_plan_id,
      v_preview#>>'{after,window,windowKey}', p_starts_on, p_ends_on,
      v_preview#>>'{after,window,timeZone}', p_available_minutes, p_energy, p_label, 'active', 1
    );
  elsif p_operation = 'change_availability_window' then
    update planning.availability_windows
    set starts_on = p_starts_on,
      ends_on = p_ends_on,
      available_minutes = p_available_minutes,
      energy = p_energy,
      label = p_label,
      aggregate_version = aggregate_version + 1,
      updated_at = pg_catalog.clock_timestamp()
    where workspace_id = v_workspace_id
      and availability_window_id = v_window_id
      and lifecycle = 'active'
      and aggregate_version = p_expected_window_version::bigint;
  else
    update planning.availability_windows
    set lifecycle = 'removed',
      aggregate_version = aggregate_version + 1,
      updated_at = pg_catalog.clock_timestamp()
    where workspace_id = v_workspace_id
      and availability_window_id = v_window_id
      and lifecycle = 'active'
      and aggregate_version = p_expected_window_version::bigint;
  end if;
  get diagnostics v_affected_rows = row_count;
  if v_affected_rows <> 1 then
    raise exception using errcode = '40001',
      message = 'availability window write failed';
  end if;

  v_payload := pg_catalog.jsonb_build_object(
    'change_kind', 'AVAILABILITY_CHANGED',
    'operation', p_operation,
    'growth_plan_id', v_plan.growth_plan_id,
    'availability_window_id', v_window_id,
    'availability_window_version', v_preview#>>'{after,window,aggregateVersion}'
  );
  if planning.availability_changed_event_payload_v1_is_valid(v_payload) is not true then
    raise exception using errcode = '55000',
      message = 'availability window event payload is invalid';
  end if;

  insert into outbox.events (
    event_id, event_name, event_schema_version, workspace_id, aggregate_type,
    aggregate_id, aggregate_version, actor_type, actor_user_id, command_id,
    correlation_id, occurred_at, source, payload
  ) values (
    v_event_id, 'planning.input_changed', 1, v_workspace_id,
    'planning.growth_plan', v_plan.growth_plan_id, v_plan.aggregate_version,
    'user', v_actor_user_id, v_command_id, v_correlation_id,
    pg_catalog.clock_timestamp(), 'pando.database', v_payload
  );
  get diagnostics v_affected_rows = row_count;
  if v_affected_rows <> 1 then
    raise exception using errcode = '55000', message = 'availability window event insert failed';
  end if;

  insert into outbox.deliveries (
    delivery_id, event_id, workspace_id, consumer_name, handler_contract_version
  ) values (
    v_delivery_id, v_event_id, v_workspace_id, 'planning.plan_snapshot_v1', 1
  );
  get diagnostics v_affected_rows = row_count;
  if v_affected_rows <> 1 then
    raise exception using errcode = '55000', message = 'availability window delivery insert failed';
  end if;

  v_response := pg_catalog.jsonb_build_object(
    'contract', pg_catalog.jsonb_build_object(
      'name', 'AvailabilityWindowApplyResultV1', 'version', '1.0.0'
    ),
    'commandId', v_command_id,
    'operation', p_operation,
    'availabilityWindow', v_preview#>'{after,window}',
    'activeWindowCount', (v_preview#>>'{after,activeWindowCount}')::integer,
    'planningDeliveryId', v_delivery_id,
    'projectionState', 'PENDING',
    'emittedEventIds', pg_catalog.jsonb_build_array(v_event_id)
  );
  update outbox.command_receipts
  set command_status = 'completed', response = v_response,
    emitted_event_ids = array[v_event_id], completed_at = pg_catalog.clock_timestamp()
  where command_id = v_command_id;
  get diagnostics v_affected_rows = row_count;
  if v_affected_rows <> 1 then
    raise exception using errcode = '55000',
      message = 'availability window receipt completion failed';
  end if;
  return v_response;
end
$function$;

alter function planning.derive_availability_window_identity_v1(uuid, text, text, text)
  owner to pando_planning_api;
alter function planning.availability_window_constraint_v1(uuid, uuid)
  owner to pando_planning_api;
alter function planning.availability_changed_event_payload_v1_is_valid(jsonb)
  owner to pando_planning_api;
alter function planning.build_availability_window_preview_v1(
  uuid, text, uuid, text, integer, bigint, bigint, jsonb, jsonb, jsonb, text, text, text
) owner to pando_planning_api;
alter function planning.resolve_availability_window_preview_v1(
  uuid, text, text, date, date, integer, text, text, bigint, bigint, text, text, timestamptz
) owner to pando_planning_api;
alter function planning.validate_availability_window_request_v1(
  text, text, date, date, integer, text, text, text, text, text, text
) owner to pando_planning_api;
alter function api.get_availability_window_source_v1() owner to pando_planning_api;
alter function api.preview_availability_window_v1(
  text, text, date, date, integer, text, text, text, text, text, text
) owner to pando_planning_api;
alter function api.apply_availability_window_v1(
  text, text, date, date, integer, text, text, text, text, text, text, text
) owner to pando_planning_api;

revoke all on function
  planning.derive_availability_window_identity_v1(uuid, text, text, text),
  planning.availability_window_constraint_v1(uuid, uuid),
  planning.availability_changed_event_payload_v1_is_valid(jsonb),
  planning.build_availability_window_preview_v1(
    uuid, text, uuid, text, integer, bigint, bigint, jsonb, jsonb, jsonb, text, text, text
  ),
  planning.resolve_availability_window_preview_v1(
    uuid, text, text, date, date, integer, text, text, bigint, bigint, text, text, timestamptz
  ),
  planning.validate_availability_window_request_v1(
    text, text, date, date, integer, text, text, text, text, text, text
  ),
  api.get_availability_window_source_v1(),
  api.preview_availability_window_v1(
    text, text, date, date, integer, text, text, text, text, text, text
  ),
  api.apply_availability_window_v1(
    text, text, date, date, integer, text, text, text, text, text, text, text
  )
  from public, anon, authenticated, service_role;

grant execute on function
  api.get_availability_window_source_v1(),
  api.preview_availability_window_v1(
    text, text, date, date, integer, text, text, text, text, text, text
  ),
  api.apply_availability_window_v1(
    text, text, date, date, integer, text, text, text, text, text, text, text
  )
  to authenticated;

revoke create on schema planning, api from pando_planning_api;

do $migration_role_membership_revoke$
begin
  execute pg_catalog.format('revoke pando_planning_api from %I', current_user);
end
$migration_role_membership_revoke$;
