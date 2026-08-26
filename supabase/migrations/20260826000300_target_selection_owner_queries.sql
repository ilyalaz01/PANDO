-- Authenticated onboarding reads are composed from owner queries. The public RPC accepts no
-- workspace identifier: the current personal workspace is derived from the verified JWT subject
-- and a current database membership on every request.

do $migration_role_membership$
begin
  if not pg_catalog.pg_has_role(current_user, 'pando_identity_api', 'SET') then
    if exists (
      select 1
      from pg_catalog.pg_auth_members as membership
      where membership.roleid = 'pando_identity_api'::pg_catalog.regrole
        and membership.member = current_user::pg_catalog.regrole
    ) then
      perform pg_catalog.set_config('pando.migration_identity_api_restore', 'set_false', false);
    else
      perform pg_catalog.set_config('pando.migration_identity_api_restore', 'revoke', false);
    end if;
    execute pg_catalog.format('grant pando_identity_api to %I with set true', current_user);
  else
    perform pg_catalog.set_config('pando.migration_identity_api_restore', 'none', false);
  end if;

  if not pg_catalog.pg_has_role(current_user, 'pando_phase1_api', 'SET') then
    if exists (
      select 1
      from pg_catalog.pg_auth_members as membership
      where membership.roleid = 'pando_phase1_api'::pg_catalog.regrole
        and membership.member = current_user::pg_catalog.regrole
    ) then
      perform pg_catalog.set_config('pando.migration_phase1_api_restore', 'set_false', false);
    else
      perform pg_catalog.set_config('pando.migration_phase1_api_restore', 'revoke', false);
    end if;
    execute pg_catalog.format('grant pando_phase1_api to %I with set true', current_user);
  else
    perform pg_catalog.set_config('pando.migration_phase1_api_restore', 'none', false);
  end if;
end
$migration_role_membership$;

grant create on schema identity to pando_identity_api;
grant create on schema catalog, targets to pando_phase1_api;

-- The target-selection DTO uses one safe-text invariant. Reject an upgrade with incompatible
-- pre-existing rows instead of silently rewriting user or curator-authored data.
do $safe_text_preflight$
begin
  if exists (
    select 1 from identity.workspaces
    where display_name ~ '[[:cntrl:]<>]'
  ) or exists (
    select 1 from targets.target_profile_versions
    where role_title ~ '[[:cntrl:]<>]'
      or company_name ~ '[[:cntrl:]<>]'
      or source_summary ~ '[[:cntrl:]<>]'
  ) or exists (
    select 1 from targets.readiness_goals
    where title ~ '[[:cntrl:]<>]'
  ) then
    raise exception using
      errcode = '23514',
      message = 'target-selection safe-text preflight failed; review incompatible rows before migration';
  end if;
end
$safe_text_preflight$;

alter table identity.workspaces
  add constraint workspaces_display_name_safe_text_check
  check (display_name !~ '[[:cntrl:]<>]');
alter table targets.target_profile_versions
  add constraint profile_versions_role_safe_text_check
  check (role_title !~ '[[:cntrl:]<>]'),
  add constraint profile_versions_company_safe_text_check
  check (company_name is null or company_name !~ '[[:cntrl:]<>]'),
  add constraint profile_versions_source_safe_text_check
  check (source_summary !~ '[[:cntrl:]<>]');
alter table targets.readiness_goals
  add constraint readiness_goals_title_safe_text_check
  check (title !~ '[[:cntrl:]<>]');

create function identity.get_current_personal_workspace_impl()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_workspace_id uuid;
  v_workspace_kind text;
  v_display_name text;
  v_membership_role text;
begin
  if identity.jwt_subject() is null then
    raise exception using
      errcode = '28000',
      message = 'an authenticated user is required';
  end if;

  v_workspace_id := identity.personal_workspace_id_for_current_user();
  if v_workspace_id is null then
    return null;
  end if;
  if not identity.is_workspace_member(v_workspace_id) then
    raise exception using
      errcode = '42501',
      message = 'personal workspace membership is revoked';
  end if;

  select
    workspace.workspace_kind,
    workspace.display_name,
    membership.membership_role
  into strict
    v_workspace_kind,
    v_display_name,
    v_membership_role
  from identity.workspaces as workspace
  join identity.workspace_memberships as membership
    on membership.workspace_id = workspace.workspace_id
  where workspace.workspace_id = v_workspace_id
    and membership.user_id = identity.current_user_id();

  return pg_catalog.jsonb_build_object(
    'workspaceId', v_workspace_id,
    'workspaceKind', v_workspace_kind,
    'displayName', v_display_name,
    'membershipRole', v_membership_role
  );
end
$function$;

alter function identity.get_current_personal_workspace_impl()
  owner to pando_identity_api;
revoke all on function identity.get_current_personal_workspace_impl()
  from public, anon, authenticated, service_role;
grant execute on function identity.get_current_personal_workspace_impl()
  to authenticated;

create function catalog.get_target_selection_version_keys_impl(
  p_catalog_version_ids uuid[],
  p_roadmap_version_ids uuid[]
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_versions jsonb;
begin
  if identity.jwt_subject() is null then
    raise exception using
      errcode = '28000',
      message = 'an authenticated user is required';
  end if;
  if p_catalog_version_ids is null
    or p_roadmap_version_ids is null
    or pg_catalog.cardinality(p_catalog_version_ids)
      <> pg_catalog.cardinality(p_roadmap_version_ids)
  then
    raise exception using
      errcode = '22023',
      message = 'catalog and roadmap reference arrays must have equal cardinality';
  end if;
  if exists (
    select 1
    from pg_catalog.generate_subscripts(p_catalog_version_ids, 1) as reference(position)
    left join catalog.catalog_versions as catalog_version
      on catalog_version.catalog_version_id = p_catalog_version_ids[reference.position]
      and catalog_version.lifecycle in ('published', 'retired')
    left join catalog.roadmap_template_versions as roadmap
      on roadmap.roadmap_version_id = p_roadmap_version_ids[reference.position]
      and roadmap.catalog_version_id = p_catalog_version_ids[reference.position]
      and roadmap.lifecycle in ('published', 'retired')
    where catalog_version.catalog_version_id is null
      or (
        p_roadmap_version_ids[reference.position] is not null
        and roadmap.roadmap_version_id is null
      )
  ) then
    raise exception using
      errcode = '22023',
      message = 'catalog or roadmap version reference is invalid';
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'catalogVersionId', p_catalog_version_ids[reference.position],
        'catalogVersionKey', catalog_version.catalog_version_key,
        'roadmapVersionId', p_roadmap_version_ids[reference.position],
        'roadmapVersionKey', roadmap.roadmap_version_key
      )
      order by reference.position
    ),
    '[]'::jsonb
  )
  into v_versions
  from pg_catalog.generate_subscripts(p_catalog_version_ids, 1) as reference(position)
  join catalog.catalog_versions as catalog_version
    on catalog_version.catalog_version_id = p_catalog_version_ids[reference.position]
    and catalog_version.lifecycle in ('published', 'retired')
  left join catalog.roadmap_template_versions as roadmap
    on roadmap.roadmap_version_id = p_roadmap_version_ids[reference.position]
    and roadmap.catalog_version_id = p_catalog_version_ids[reference.position]
    and roadmap.lifecycle in ('published', 'retired');

  return v_versions;
end
$function$;

alter function catalog.get_target_selection_version_keys_impl(uuid[], uuid[])
  owner to pando_phase1_api;
revoke all on function catalog.get_target_selection_version_keys_impl(uuid[], uuid[])
  from public, anon, authenticated, service_role;
grant execute on function catalog.get_target_selection_version_keys_impl(uuid[], uuid[])
  to authenticated;

create function targets.get_target_selection_options_impl(p_workspace_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_profiles jsonb;
  v_readiness_goals jsonb;
begin
  if identity.jwt_subject() is null then
    raise exception using
      errcode = '28000',
      message = 'an authenticated user is required';
  end if;
  if not identity.is_workspace_member(p_workspace_id) then
    raise exception using
      errcode = '42501',
      message = 'workspace is not accessible';
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'profileVersionKey', profile.profile_version_key,
        'profileSeriesKey', series.profile_series_key,
        'scope', series.profile_scope,
        'roleTitle', profile.role_title,
        'companyName', profile.company_name,
        'versionNumber', profile.version_number,
        'baseProfileVersionKey', base.profile_version_key,
        'catalogVersionId', profile.catalog_version_id,
        'roadmapVersionId', profile.roadmap_version_id,
        'sourceSummary', profile.source_summary,
        'freshnessStatus', profile.freshness_status,
        'reviewedAt', profile.reviewed_at
      )
      order by profile.profile_version_key collate "C"
    ),
    '[]'::jsonb
  )
  into v_profiles
  from targets.target_profile_versions as profile
  join targets.target_profile_series as series
    on series.profile_series_id = profile.profile_series_id
  left join targets.target_profile_versions as base
    on base.profile_version_id = profile.base_profile_version_id
  where profile.lifecycle = 'published'
    and series.lifecycle = 'active'
    and (profile.workspace_id is null or profile.workspace_id = p_workspace_id);

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'readinessGoalKey', goal.readiness_goal_key,
        'title', goal.title,
        'profileVersionKey', profile.profile_version_key,
        'profileRoleTitle', profile.role_title,
        'lifecycle', goal.lifecycle,
        'aggregateVersion', goal.aggregate_version::text
      )
      order by goal.readiness_goal_key collate "C"
    ),
    '[]'::jsonb
  )
  into v_readiness_goals
  from targets.readiness_goals as goal
  join targets.target_profile_versions as profile
    on profile.profile_version_id = goal.profile_version_id
  where goal.workspace_id = p_workspace_id;

  return pg_catalog.jsonb_build_object(
    'profiles', v_profiles,
    'readinessGoals', v_readiness_goals
  );
end
$function$;

alter function targets.get_target_selection_options_impl(uuid)
  owner to pando_phase1_api;
revoke all on function targets.get_target_selection_options_impl(uuid)
  from public, anon, authenticated, service_role;
grant execute on function targets.get_target_selection_options_impl(uuid)
  to authenticated;

create function api.get_target_selection_source_v1()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  with workspace_source as (
    select identity.get_current_personal_workspace_impl() as value
  ),
  target_source as (
    select targets.get_target_selection_options_impl(
      (workspace_source.value->>'workspaceId')::uuid
    ) as value
    from workspace_source
    where workspace_source.value is not null
  ),
  target_profiles as (
    select profile.value, profile.position
    from target_source
    cross join lateral pg_catalog.jsonb_array_elements(target_source.value->'profiles')
      with ordinality as profile(value, position)
  ),
  target_profile_refs as (
    select
      coalesce(
        pg_catalog.array_agg(
          (target_profiles.value->>'catalogVersionId')::uuid
          order by target_profiles.position
        ),
        array[]::uuid[]
      ) as catalog_version_ids,
      coalesce(
        pg_catalog.array_agg(
          (target_profiles.value->>'roadmapVersionId')::uuid
          order by target_profiles.position
        ),
        array[]::uuid[]
      ) as roadmap_version_ids
    from target_profiles
  ),
  catalog_source as (
    select catalog.get_target_selection_version_keys_impl(
      target_profile_refs.catalog_version_ids,
      target_profile_refs.roadmap_version_ids
    ) as value
    from target_profile_refs
  ),
  catalog_versions as (
    select version.value, version.position
    from catalog_source
    cross join lateral pg_catalog.jsonb_array_elements(catalog_source.value)
      with ordinality as version(value, position)
  ),
  profiles as (
    select coalesce(
      pg_catalog.jsonb_agg(
        (
          target_profiles.value
          - 'catalogVersionId'
          - 'roadmapVersionId'
        ) || pg_catalog.jsonb_build_object(
          'catalogVersionKey', catalog_versions.value->'catalogVersionKey',
          'roadmapVersionKey', catalog_versions.value->'roadmapVersionKey'
        )
        order by target_profiles.position
      ),
      '[]'::jsonb
    ) as value
    from target_profiles
    join catalog_versions using (position)
  )
  select pg_catalog.jsonb_build_object(
    'contract', pg_catalog.jsonb_build_object(
      'name', 'TargetSelectionSourceV1',
      'version', '1.0.0'
    ),
    'workspace', workspace_source.value,
    'profiles', profiles.value,
    'readinessGoals', coalesce(target_source.value->'readinessGoals', '[]'::jsonb)
  )
  from workspace_source
  left join target_source on true
  cross join profiles
$function$;

revoke all on function api.get_target_selection_source_v1()
  from public, anon, authenticated, service_role;
grant execute on function api.get_target_selection_source_v1()
  to authenticated;

revoke create on schema identity from pando_identity_api;
revoke create on schema catalog, targets from pando_phase1_api;

do $migration_role_membership$
begin
  case pg_catalog.current_setting('pando.migration_identity_api_restore', true)
    when 'revoke' then
      execute pg_catalog.format('revoke pando_identity_api from %I', current_user);
    when 'set_false' then
      execute pg_catalog.format('grant pando_identity_api to %I with set false', current_user);
    else
      null;
  end case;

  case pg_catalog.current_setting('pando.migration_phase1_api_restore', true)
    when 'revoke' then
      execute pg_catalog.format('revoke pando_phase1_api from %I', current_user);
    when 'set_false' then
      execute pg_catalog.format('grant pando_phase1_api to %I with set false', current_user);
    else
      null;
  end case;
end
$migration_role_membership$;
