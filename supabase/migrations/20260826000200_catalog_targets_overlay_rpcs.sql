-- Least-privilege Phase 1 reads and commands. Exposed api functions are
-- SECURITY INVOKER. Their narrowly privileged implementations are owned by a
-- NOLOGIN/NOBYPASSRLS role and remain subject to membership policies.

do $migration_role_membership$
begin
  execute pg_catalog.format('grant pando_rls_authorizer, pando_phase1_api to %I', current_user);
end
$migration_role_membership$;
grant usage on schema catalog, targets, overlay, outbox, identity, extensions to pando_phase1_api;
grant create on schema targets, overlay to pando_phase1_api;
set role pando_rls_authorizer;
grant execute on function identity.jwt_subject(), identity.current_user_id(), identity.is_workspace_member(uuid)
  to pando_phase1_api;
reset role;
grant execute on function extensions.digest(bytea, text) to pando_phase1_api;

grant select on all tables in schema catalog to pando_phase1_api;
grant select on targets.target_profile_series, targets.target_profile_versions,
  targets.target_requirement_rules, targets.target_requirement_members to pando_phase1_api;
grant select, insert, update on overlay.workspace_overlays, overlay.notes,
  overlay.custom_activities, overlay.positions to pando_phase1_api;
grant select on overlay.personal_competencies, overlay.personal_edges to pando_phase1_api;
grant select, insert, update on outbox.command_receipts to pando_phase1_api;
grant insert on outbox.events to pando_phase1_api;
grant usage, select on sequence outbox.events_event_position_seq to pando_phase1_api;

create policy catalog_versions_phase1_read on catalog.catalog_versions
for select to pando_phase1_api using (true);
create policy catalog_items_phase1_read on catalog.items
for select to pando_phase1_api using (true);
create policy catalog_edges_phase1_read on catalog.competency_edges
for select to pando_phase1_api using (true);
create policy roadmap_series_phase1_read on catalog.roadmap_template_series
for select to pando_phase1_api using (true);
create policy roadmap_versions_phase1_read on catalog.roadmap_template_versions
for select to pando_phase1_api using (true);
create policy roadmap_items_phase1_read on catalog.roadmap_template_items
for select to pando_phase1_api using (true);

create policy target_series_phase1_read on targets.target_profile_series
for select to pando_phase1_api
using (workspace_id is null or identity.is_workspace_member(workspace_id));
create policy target_versions_phase1_read on targets.target_profile_versions
for select to pando_phase1_api
using (workspace_id is null or identity.is_workspace_member(workspace_id));
create policy target_rules_phase1_read on targets.target_requirement_rules
for select to pando_phase1_api
using (workspace_id is null or identity.is_workspace_member(workspace_id));
create policy target_members_phase1_read on targets.target_requirement_members
for select to pando_phase1_api
using (workspace_id is null or identity.is_workspace_member(workspace_id));

create policy workspace_overlays_phase1_all on overlay.workspace_overlays
for all to pando_phase1_api
using (identity.is_workspace_member(workspace_id))
with check (identity.is_workspace_member(workspace_id));
create policy personal_competencies_phase1_read on overlay.personal_competencies
for select to pando_phase1_api
using (identity.is_workspace_member(workspace_id));
create policy personal_edges_phase1_read on overlay.personal_edges
for select to pando_phase1_api
using (identity.is_workspace_member(workspace_id));
create policy notes_phase1_all on overlay.notes
for all to pando_phase1_api
using (identity.is_workspace_member(workspace_id))
with check (identity.is_workspace_member(workspace_id));
create policy custom_activities_phase1_all on overlay.custom_activities
for all to pando_phase1_api
using (identity.is_workspace_member(workspace_id))
with check (identity.is_workspace_member(workspace_id));
create policy positions_phase1_all on overlay.positions
for all to pando_phase1_api
using (identity.is_workspace_member(workspace_id))
with check (identity.is_workspace_member(workspace_id));

create policy command_receipts_phase1_select on outbox.command_receipts
for select to pando_phase1_api
using (
  actor_user_id = identity.current_user_id()
  and workspace_id is not null
  and identity.is_workspace_member(workspace_id)
);
create policy command_receipts_phase1_insert on outbox.command_receipts
for insert to pando_phase1_api
with check (
  actor_user_id = identity.current_user_id()
  and workspace_id is not null
  and identity.is_workspace_member(workspace_id)
);
create policy command_receipts_phase1_update on outbox.command_receipts
for update to pando_phase1_api
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
create policy events_phase1_insert on outbox.events
for insert to pando_phase1_api
with check (identity.is_workspace_member(workspace_id));

create function targets.get_available_profiles_impl(p_workspace_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_profiles jsonb;
begin
  if identity.jwt_subject() is null then
    raise exception using errcode = '28000', message = 'an authenticated user is required';
  end if;
  if not identity.is_workspace_member(p_workspace_id) then
    raise exception using errcode = '42501', message = 'workspace is not accessible';
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'profileVersionKey', version.profile_version_key,
        'profileSeriesKey', series.profile_series_key,
        'scope', series.profile_scope,
        'roleTitle', version.role_title,
        'companyName', version.company_name,
        'versionNumber', version.version_number,
        'baseProfileVersionKey', base.profile_version_key,
        'catalogVersionKey', catalog_version.catalog_version_key,
        'roadmapVersionKey', roadmap.roadmap_version_key,
        'freshnessStatus', version.freshness_status,
        'reviewedAt', version.reviewed_at
      ) order by series.profile_scope, version.profile_version_key
    ),
    '[]'::jsonb
  ) into v_profiles
  from targets.target_profile_versions as version
  join targets.target_profile_series as series
    on series.profile_series_id = version.profile_series_id
  join catalog.catalog_versions as catalog_version
    on catalog_version.catalog_version_id = version.catalog_version_id
  left join catalog.roadmap_template_versions as roadmap
    on roadmap.roadmap_version_id = version.roadmap_version_id
  left join targets.target_profile_versions as base
    on base.profile_version_id = version.base_profile_version_id
  where version.lifecycle = 'published'
    and series.lifecycle = 'active'
    and (version.workspace_id is null or version.workspace_id = p_workspace_id);

  return pg_catalog.jsonb_build_object(
    'workspaceId', p_workspace_id,
    'profiles', v_profiles
  );
end
$function$;

alter function targets.get_available_profiles_impl(uuid) owner to pando_phase1_api;
revoke all on function targets.get_available_profiles_impl(uuid)
  from public, anon, authenticated, service_role;
grant execute on function targets.get_available_profiles_impl(uuid) to authenticated;

create function targets.get_profile_impl(p_workspace_id uuid, p_profile_version_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_profile targets.target_profile_versions%rowtype;
  v_series targets.target_profile_series%rowtype;
  v_rules jsonb;
begin
  if identity.jwt_subject() is null then
    raise exception using errcode = '28000', message = 'an authenticated user is required';
  end if;
  if not identity.is_workspace_member(p_workspace_id) then
    raise exception using errcode = '42501', message = 'workspace is not accessible';
  end if;

  select version.* into v_profile
  from targets.target_profile_versions as version
  where version.profile_version_key = p_profile_version_key
    and version.lifecycle in ('published', 'retired')
    and (version.workspace_id is null or version.workspace_id = p_workspace_id);
  if not found then
    raise exception using errcode = '42501', message = 'target profile is not accessible';
  end if;

  select series.* into strict v_series
  from targets.target_profile_series as series
  where series.profile_series_id = v_profile.profile_series_id;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'ruleKey', rule.rule_key,
        'ruleType', rule.rule_type,
        'title', rule.title,
        'criticality', rule.criticality,
        'explanation', rule.explanation,
        'accessibilityLabel', rule.accessibility_label,
        'requiredCount', rule.required_count,
        'threshold', rule.threshold,
        'members', (
          select coalesce(
            pg_catalog.jsonb_agg(
              pg_catalog.jsonb_strip_nulls(
                pg_catalog.jsonb_build_object(
                  'memberType', member.member_type,
                  'nodeScope', member.node_scope,
                  'nodeKind', member.node_kind,
                  'nodeRef', member.node_ref,
                  'ruleRef', referenced.rule_key,
                  'dimension', member.objective_dimension,
                  'requiredLevel', member.required_level,
                  'weight', member.member_weight
                )
              ) order by member.member_order
            ),
            '[]'::jsonb
          )
          from targets.target_requirement_members as member
          left join targets.target_requirement_rules as referenced
            on referenced.requirement_rule_id = member.referenced_rule_id
          where member.requirement_rule_id = rule.requirement_rule_id
        )
      ) order by rule.rule_key
    ),
    '[]'::jsonb
  ) into v_rules
  from targets.target_requirement_rules as rule
  where rule.profile_version_id = v_profile.profile_version_id;

  return pg_catalog.jsonb_build_object(
    'profileVersionKey', v_profile.profile_version_key,
    'profileSeriesKey', v_series.profile_series_key,
    'scope', v_series.profile_scope,
    'workspaceId', v_profile.workspace_id,
    'baseProfileVersionKey', (
      select base.profile_version_key
      from targets.target_profile_versions as base
      where base.profile_version_id = v_profile.base_profile_version_id
    ),
    'catalogVersionKey', (
      select version.catalog_version_key from catalog.catalog_versions as version
      where version.catalog_version_id = v_profile.catalog_version_id
    ),
    'roadmapVersionKey', (
      select version.roadmap_version_key from catalog.roadmap_template_versions as version
      where version.roadmap_version_id = v_profile.roadmap_version_id
    ),
    'versionNumber', v_profile.version_number,
    'roleTitle', v_profile.role_title,
    'companyName', v_profile.company_name,
    'sourceSummary', v_profile.source_summary,
    'freshnessStatus', v_profile.freshness_status,
    'reviewedAt', v_profile.reviewed_at,
    'rootRuleKey', v_profile.root_rule_key,
    'readinessThreshold', v_profile.readiness_threshold,
    'rules', v_rules
  );
end
$function$;

alter function targets.get_profile_impl(uuid, text) owner to pando_phase1_api;
revoke all on function targets.get_profile_impl(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function targets.get_profile_impl(uuid, text) to authenticated;

create function overlay.get_note_impl(p_workspace_id uuid, p_subject_ref text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_note overlay.notes%rowtype;
begin
  if identity.jwt_subject() is null then
    raise exception using errcode = '28000', message = 'an authenticated user is required';
  end if;
  if not identity.is_workspace_member(p_workspace_id) then
    raise exception using errcode = '42501', message = 'workspace is not accessible';
  end if;
  select note.* into v_note from overlay.notes as note
  where note.workspace_id = p_workspace_id and note.subject_ref = p_subject_ref;
  if not found then
    return null;
  end if;
  return pg_catalog.jsonb_build_object(
    'noteId', v_note.note_id,
    'workspaceId', v_note.workspace_id,
    'subjectRef', v_note.subject_ref,
    'body', v_note.note_body,
    'updatedAt', v_note.updated_at
  );
end
$function$;

alter function overlay.get_note_impl(uuid, text) owner to pando_phase1_api;
revoke all on function overlay.get_note_impl(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function overlay.get_note_impl(uuid, text) to authenticated;

create function overlay.get_explore_source_impl(
  p_workspace_id uuid,
  p_readiness_goal_key text,
  p_selected_activity_key text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_goal targets.readiness_goals%rowtype;
  v_profile targets.target_profile_versions%rowtype;
  v_overlay_version bigint;
  v_nodes jsonb;
  v_edges jsonb;
  v_positions jsonb;
begin
  if identity.jwt_subject() is null then
    raise exception using errcode = '28000', message = 'an authenticated user is required';
  end if;
  if not identity.is_workspace_member(p_workspace_id) then
    raise exception using errcode = '42501', message = 'workspace is not accessible';
  end if;
  select goal.* into v_goal
  from targets.readiness_goals as goal
  where goal.workspace_id = p_workspace_id
    and goal.readiness_goal_key = p_readiness_goal_key;
  if not found then
    raise exception using errcode = '42501', message = 'readiness goal is not accessible';
  end if;
  select version.* into strict v_profile
  from targets.target_profile_versions as version
  where version.profile_version_id = v_goal.profile_version_id
    and version.lifecycle in ('published', 'retired');
  if p_selected_activity_key is not null and not exists (
    select 1 from overlay.custom_activities as activity
    where activity.workspace_id = p_workspace_id
      and activity.profile_version_id = v_profile.profile_version_id
      and activity.activity_key = p_selected_activity_key
      and activity.lifecycle = 'active'
  ) then
    raise exception using errcode = '42501', message = 'activity is not accessible';
  end if;

  select coalesce(root.aggregate_version, 0) into v_overlay_version
  from (select 1) as singleton
  left join overlay.workspace_overlays as root on root.workspace_id = p_workspace_id;

  select coalesce(pg_catalog.jsonb_agg(node order by node->>'nodeRef'), '[]'::jsonb)
  into v_nodes
  from (
    select pg_catalog.jsonb_build_object(
      'nodeRef', item.item_key,
      'nodeType', item.item_type,
      'title', item.title,
      'domainRef', item.domain_item_key,
      'origin', 'CANONICAL',
      'sourceVersionKey', version.catalog_version_key
    ) as node
    from catalog.items as item
    join catalog.catalog_versions as version
      on version.catalog_version_id = item.catalog_version_id
    where item.catalog_version_id = v_profile.catalog_version_id
      and item.lifecycle = 'active'
    union all
    select pg_catalog.jsonb_build_object(
      'nodeRef', competency.competency_key,
      'nodeType', 'COMPETENCY',
      'title', competency.title,
      'domainRef', competency.domain_item_key,
      'origin', 'WORKSPACE_OVERLAY',
      'workspaceId', competency.workspace_id
    )
    from overlay.personal_competencies as competency
    where competency.workspace_id = p_workspace_id and competency.lifecycle = 'accepted'
    union all
    select pg_catalog.jsonb_build_object(
      'nodeRef', activity.activity_key,
      'nodeType', 'ACTIVITY',
      'title', activity.title,
      'domainRef', null,
      'origin', 'WORKSPACE_OVERLAY',
      'workspaceId', activity.workspace_id,
      'activityType', activity.activity_type,
      'targetCompetencyRef', activity.target_competency_ref
    )
    from overlay.custom_activities as activity
    where activity.workspace_id = p_workspace_id
      and activity.profile_version_id = v_profile.profile_version_id
      and activity.activity_key = p_selected_activity_key
      and activity.lifecycle = 'active'
  ) as nodes;

  select coalesce(pg_catalog.jsonb_agg(edge order by edge->>'edgeKey'), '[]'::jsonb)
  into v_edges
  from (
    select pg_catalog.jsonb_build_object(
      'edgeKey', 'edge:part-of:' || split_part(item.item_key, ':', 2),
      'edgeType', 'PART_OF',
      'sourceRef', item.item_key,
      'targetRef', item.domain_item_key,
      'blocking', false,
      'origin', 'CANONICAL'
    ) as edge
    from catalog.items as item
    where item.catalog_version_id = v_profile.catalog_version_id
      and item.item_type = 'COMPETENCY' and item.lifecycle = 'active'
    union all
    select pg_catalog.jsonb_build_object(
      'edgeKey', edge.edge_key,
      'edgeType', edge.edge_type,
      'sourceRef', edge.from_competency_key,
      'targetRef', edge.to_competency_key,
      'blocking', edge.blocking,
      'origin', 'CANONICAL'
    )
    from catalog.competency_edges as edge
    where edge.catalog_version_id = v_profile.catalog_version_id
    union all
    select pg_catalog.jsonb_build_object(
      'edgeKey', 'edge:part-of:' || split_part(competency.competency_key, ':', 2),
      'edgeType', 'PART_OF',
      'sourceRef', competency.competency_key,
      'targetRef', competency.domain_item_key,
      'blocking', false,
      'origin', 'WORKSPACE_OVERLAY'
    )
    from overlay.personal_competencies as competency
    where competency.workspace_id = p_workspace_id and competency.lifecycle = 'accepted'
    union all
    select pg_catalog.jsonb_build_object(
      'edgeKey', edge.edge_key,
      'edgeType', edge.edge_type,
      'sourceRef', edge.source_node_ref,
      'targetRef', edge.target_node_ref,
      'blocking', false,
      'origin', 'WORKSPACE_OVERLAY'
    )
    from overlay.personal_edges as edge
    where edge.workspace_id = p_workspace_id and edge.lifecycle = 'accepted'
      and (
        exists (
          select 1 from catalog.items as item
          where item.catalog_version_id = v_profile.catalog_version_id
            and item.item_key = edge.source_node_ref and item.lifecycle = 'active'
        )
        or exists (
          select 1 from overlay.personal_competencies as competency
          where competency.workspace_id = p_workspace_id
            and competency.competency_key = edge.source_node_ref
            and competency.lifecycle = 'accepted'
        )
      )
      and (
        exists (
          select 1 from catalog.items as item
          where item.catalog_version_id = v_profile.catalog_version_id
            and item.item_key = edge.target_node_ref and item.lifecycle = 'active'
        )
        or exists (
          select 1 from overlay.personal_competencies as competency
          where competency.workspace_id = p_workspace_id
            and competency.competency_key = edge.target_node_ref
            and competency.lifecycle = 'accepted'
        )
      )
    union all
    select pg_catalog.jsonb_build_object(
      'edgeKey', 'edge:activity-evidences:' || split_part(activity.activity_key, ':', 2)
        || ':' || split_part(activity.target_competency_ref, ':', 2),
      'edgeType', 'ACTIVITY_EVIDENCES',
      'sourceRef', activity.activity_key,
      'targetRef', activity.target_competency_ref,
      'blocking', false,
      'origin', 'WORKSPACE_OVERLAY'
    )
    from overlay.custom_activities as activity
    where activity.workspace_id = p_workspace_id
      and activity.profile_version_id = v_profile.profile_version_id
      and activity.activity_key = p_selected_activity_key
      and activity.lifecycle = 'active'
  ) as edges;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object('nodeRef', position.node_ref, 'x', position.x, 'y', position.y)
      order by position.node_ref
    ),
    '[]'::jsonb
  ) into v_positions
  from overlay.positions as position
  where position.workspace_id = p_workspace_id
    and position.readiness_goal_id = v_goal.readiness_goal_id
    and position.profile_version_id = v_profile.profile_version_id;

  return pg_catalog.jsonb_build_object(
    'workspaceId', p_workspace_id,
    'readinessGoalKey', v_goal.readiness_goal_key,
    'overlayVersion', v_overlay_version,
    'catalogVersionKey', (
      select version.catalog_version_key from catalog.catalog_versions as version
      where version.catalog_version_id = v_profile.catalog_version_id
    ),
    'roadmapVersionKey', (
      select version.roadmap_version_key from catalog.roadmap_template_versions as version
      where version.roadmap_version_id = v_profile.roadmap_version_id
    ),
    'targetProfileVersionKey', v_profile.profile_version_key,
    'nodes', v_nodes,
    'edges', v_edges,
    'positions', v_positions,
    'nodeCount', pg_catalog.jsonb_array_length(v_nodes),
    'edgeCount', pg_catalog.jsonb_array_length(v_edges)
  );
end
$function$;

alter function overlay.get_explore_source_impl(uuid, text, text) owner to pando_phase1_api;
revoke all on function overlay.get_explore_source_impl(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function overlay.get_explore_source_impl(uuid, text, text) to authenticated;

create function overlay.save_note_impl(
  p_workspace_id uuid,
  p_subject_ref text,
  p_note_body text,
  p_expected_overlay_version bigint,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_user_id uuid;
  v_command_id uuid := gen_random_uuid();
  v_correlation_id uuid := gen_random_uuid();
  v_event_id uuid := gen_random_uuid();
  v_note_id uuid;
  v_operation text;
  v_request_hash bytea;
  v_response jsonb;
  v_receipt outbox.command_receipts%rowtype;
  v_current_version bigint;
  v_note_body text := btrim(p_note_body);
begin
  if identity.jwt_subject() is null then
    raise exception using errcode = '28000', message = 'an authenticated user is required';
  end if;
  if not identity.is_workspace_member(p_workspace_id) then
    raise exception using errcode = '42501', message = 'workspace is not accessible';
  end if;
  v_actor_user_id := identity.current_user_id();
  if v_actor_user_id is null then
    raise exception using errcode = '28000', message = 'authenticated user is not provisioned';
  end if;
  if p_idempotency_key is null or p_idempotency_key <> btrim(p_idempotency_key)
     or char_length(p_idempotency_key) not between 1 and 128 then
    raise exception using errcode = '22023', message = 'idempotency key must contain 1 to 128 trimmed characters';
  end if;
  if p_expected_overlay_version is null or p_expected_overlay_version < 0 then
    raise exception using errcode = '22023', message = 'expected overlay version must be nonnegative';
  end if;
  if p_subject_ref is null or p_subject_ref !~ '^(domain|competency|target):[a-z0-9][a-z0-9-]{1,100}$' then
    raise exception using errcode = '22023', message = 'note subject reference is invalid';
  end if;
  if p_note_body is null or p_note_body <> v_note_body or char_length(v_note_body) not between 1 and 10000 then
    raise exception using errcode = '22023', message = 'note body must contain 1 to 10000 trimmed characters';
  end if;

  v_request_hash := extensions.digest(pg_catalog.convert_to(pg_catalog.jsonb_build_object(
    'commandType', 'overlay.save_note', 'schemaVersion', 1, 'workspaceId', p_workspace_id,
    'subjectRef', p_subject_ref, 'noteBody', v_note_body,
    'expectedOverlayVersion', p_expected_overlay_version
  )::text, 'UTF8'), 'sha256');

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    v_actor_user_id::text || ':overlay.save_note:' || p_idempotency_key, 0
  ));
  select receipt.* into v_receipt from outbox.command_receipts as receipt
  where receipt.actor_user_id = v_actor_user_id
    and receipt.command_type = 'overlay.save_note'
    and receipt.idempotency_key = p_idempotency_key
  for update;
  if found then
    if v_receipt.request_hash <> v_request_hash then
      raise exception using errcode = '22023', message = 'idempotency key reused with a different request';
    end if;
    if v_receipt.command_status <> 'completed' then
      raise exception using errcode = '40001', message = 'command receipt is not complete';
    end if;
    return v_receipt.response;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_workspace_id::text, 1));
  insert into overlay.workspace_overlays (workspace_id) values (p_workspace_id) on conflict do nothing;
  select root.aggregate_version into strict v_current_version
  from overlay.workspace_overlays as root where root.workspace_id = p_workspace_id for update;
  if v_current_version <> p_expected_overlay_version then
    raise exception using errcode = '40001', message = 'overlay aggregate version conflict';
  end if;

  insert into outbox.command_receipts (
    command_id, command_type, command_schema_version, workspace_id, actor_user_id,
    idempotency_key, request_hash, correlation_id, expected_aggregate_version
  ) values (
    v_command_id, 'overlay.save_note', 1, p_workspace_id, v_actor_user_id,
    p_idempotency_key, v_request_hash, v_correlation_id, p_expected_overlay_version
  );

  select note.note_id into v_note_id from overlay.notes as note
  where note.workspace_id = p_workspace_id and note.subject_ref = p_subject_ref;
  v_operation := case when v_note_id is null then 'created' else 'updated' end;
  if v_note_id is null then
    v_note_id := gen_random_uuid();
    insert into overlay.notes (note_id, workspace_id, subject_ref, note_body)
    values (v_note_id, p_workspace_id, p_subject_ref, v_note_body);
  else
    update overlay.notes set note_body = v_note_body, updated_at = clock_timestamp()
    where note_id = v_note_id;
  end if;
  update overlay.workspace_overlays
  set aggregate_version = aggregate_version + 1, updated_at = clock_timestamp()
  where workspace_id = p_workspace_id;

  insert into outbox.events (
    event_id, event_name, event_schema_version, workspace_id, aggregate_type,
    aggregate_id, aggregate_version, actor_type, actor_user_id, command_id,
    correlation_id, occurred_at, source, payload
  ) values (
    v_event_id, 'overlay.note_saved', 1, p_workspace_id, 'overlay.workspace',
    p_workspace_id, p_expected_overlay_version + 1, 'user', v_actor_user_id,
    v_command_id, v_correlation_id, clock_timestamp(), 'pando.database',
    pg_catalog.jsonb_build_object('note_id', v_note_id, 'subject_ref', p_subject_ref, 'operation', v_operation)
  );

  v_response := pg_catalog.jsonb_build_object(
    'commandId', v_command_id, 'workspaceId', p_workspace_id, 'noteId', v_note_id,
    'subjectRef', p_subject_ref, 'operation', v_operation,
    'overlayVersion', p_expected_overlay_version + 1,
    'emittedEventIds', pg_catalog.jsonb_build_array(v_event_id)
  );
  update outbox.command_receipts set command_status = 'completed', response = v_response,
    emitted_event_ids = array[v_event_id], completed_at = clock_timestamp()
  where command_id = v_command_id;
  return v_response;
end
$function$;

alter function overlay.save_note_impl(uuid, text, text, bigint, text) owner to pando_phase1_api;
revoke all on function overlay.save_note_impl(uuid, text, text, bigint, text)
  from public, anon, authenticated, service_role;
grant execute on function overlay.save_note_impl(uuid, text, text, bigint, text) to authenticated;

create function overlay.add_custom_activity_impl(
  p_workspace_id uuid,
  p_profile_version_key text,
  p_activity_key text,
  p_title text,
  p_activity_type text,
  p_target_competency_ref text,
  p_expected_overlay_version bigint,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_user_id uuid;
  v_command_id uuid := gen_random_uuid();
  v_correlation_id uuid := gen_random_uuid();
  v_event_id uuid := gen_random_uuid();
  v_activity_id uuid := gen_random_uuid();
  v_request_hash bytea;
  v_response jsonb;
  v_receipt outbox.command_receipts%rowtype;
  v_current_version bigint;
  v_profile_version_id uuid;
begin
  if identity.jwt_subject() is null then raise exception using errcode = '28000', message = 'an authenticated user is required'; end if;
  if not identity.is_workspace_member(p_workspace_id) then raise exception using errcode = '42501', message = 'workspace is not accessible'; end if;
  v_actor_user_id := identity.current_user_id();
  if v_actor_user_id is null then raise exception using errcode = '28000', message = 'authenticated user is not provisioned'; end if;
  if p_idempotency_key is null or p_idempotency_key <> btrim(p_idempotency_key) or char_length(p_idempotency_key) not between 1 and 128 then
    raise exception using errcode = '22023', message = 'idempotency key must contain 1 to 128 trimmed characters';
  end if;
  if p_expected_overlay_version is null or p_expected_overlay_version < 0 then raise exception using errcode = '22023', message = 'expected overlay version must be nonnegative'; end if;
  if p_activity_key is null or p_activity_key !~ '^activity:[a-z0-9][a-z0-9-]{1,100}$' then raise exception using errcode = '22023', message = 'activity key is invalid'; end if;
  if p_title is null or p_title <> btrim(p_title) or char_length(p_title) not between 1 and 200 then raise exception using errcode = '22023', message = 'activity title is invalid'; end if;
  if p_activity_type is null or p_activity_type not in ('MANUAL_CODING', 'READING', 'EXPLANATION', 'MOCK', 'PROJECT') then raise exception using errcode = '22023', message = 'activity type is invalid'; end if;
  if p_target_competency_ref is null or p_target_competency_ref !~ '^competency:[a-z0-9][a-z0-9-]{1,100}$' then raise exception using errcode = '22023', message = 'target competency reference is invalid'; end if;
  v_request_hash := extensions.digest(pg_catalog.convert_to(pg_catalog.jsonb_build_object(
    'commandType', 'overlay.add_custom_activity', 'schemaVersion', 1, 'workspaceId', p_workspace_id,
    'profileVersionKey', p_profile_version_key, 'activityKey', p_activity_key, 'title', p_title, 'activityType', p_activity_type,
    'targetCompetencyRef', p_target_competency_ref, 'expectedOverlayVersion', p_expected_overlay_version
  )::text, 'UTF8'), 'sha256');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    v_actor_user_id::text || ':overlay.add_custom_activity:' || p_idempotency_key, 0
  ));
  select receipt.* into v_receipt from outbox.command_receipts as receipt
  where receipt.actor_user_id = v_actor_user_id and receipt.command_type = 'overlay.add_custom_activity'
    and receipt.idempotency_key = p_idempotency_key for update;
  if found then
    if v_receipt.request_hash <> v_request_hash then raise exception using errcode = '22023', message = 'idempotency key reused with a different request'; end if;
    if v_receipt.command_status <> 'completed' then raise exception using errcode = '40001', message = 'command receipt is not complete'; end if;
    return v_receipt.response;
  end if;
  select version.profile_version_id into v_profile_version_id
  from targets.target_profile_versions as version
  join targets.target_profile_series as series
    on series.profile_series_id = version.profile_series_id
  where version.profile_version_key = p_profile_version_key
    and (
      (version.lifecycle = 'published' and series.lifecycle = 'active')
      or (
        version.lifecycle in ('published', 'retired')
        and exists (
          select 1 from targets.readiness_goals as goal
          where goal.workspace_id = p_workspace_id
            and goal.profile_version_id = version.profile_version_id
            and goal.lifecycle in ('active', 'paused')
        )
      )
    )
    and (version.workspace_id is null or version.workspace_id = p_workspace_id);
  if v_profile_version_id is null then raise exception using errcode = '42501', message = 'target profile is not accessible'; end if;
  if not exists (
    select 1 from catalog.items as item
    join targets.target_profile_versions as profile on profile.catalog_version_id = item.catalog_version_id
    where profile.profile_version_id = v_profile_version_id
      and item.item_key = p_target_competency_ref and item.item_type = 'COMPETENCY'
      and item.lifecycle = 'active'
    union all
    select 1 from overlay.personal_competencies as competency
    where competency.workspace_id = p_workspace_id and competency.competency_key = p_target_competency_ref
      and competency.lifecycle = 'accepted'
  ) then raise exception using errcode = '22023', message = 'target competency is unavailable in the selected profile graph'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_workspace_id::text, 1));
  insert into overlay.workspace_overlays (workspace_id) values (p_workspace_id) on conflict do nothing;
  select root.aggregate_version into strict v_current_version from overlay.workspace_overlays as root
  where root.workspace_id = p_workspace_id for update;
  if v_current_version <> p_expected_overlay_version then raise exception using errcode = '40001', message = 'overlay aggregate version conflict'; end if;
  if exists (select 1 from overlay.custom_activities as activity where activity.workspace_id = p_workspace_id and activity.activity_key = p_activity_key) then
    raise exception using errcode = '23505', message = 'custom activity already exists';
  end if;
  insert into outbox.command_receipts (
    command_id, command_type, command_schema_version, workspace_id, actor_user_id,
    idempotency_key, request_hash, correlation_id, expected_aggregate_version
  ) values (
    v_command_id, 'overlay.add_custom_activity', 1, p_workspace_id, v_actor_user_id,
    p_idempotency_key, v_request_hash, v_correlation_id, p_expected_overlay_version
  );
  insert into overlay.custom_activities (
    custom_activity_id, workspace_id, profile_version_id, activity_key, title, activity_type, target_competency_ref
  ) values (
    v_activity_id, p_workspace_id, v_profile_version_id, p_activity_key, p_title, p_activity_type, p_target_competency_ref
  );
  update overlay.workspace_overlays set aggregate_version = aggregate_version + 1, updated_at = clock_timestamp()
  where workspace_id = p_workspace_id;
  insert into outbox.events (
    event_id, event_name, event_schema_version, workspace_id, aggregate_type, aggregate_id,
    aggregate_version, actor_type, actor_user_id, command_id, correlation_id, occurred_at, source, payload
  ) values (
    v_event_id, 'overlay.custom_activity_added', 1, p_workspace_id, 'overlay.workspace', p_workspace_id,
    p_expected_overlay_version + 1, 'user', v_actor_user_id, v_command_id, v_correlation_id,
    clock_timestamp(), 'pando.database', pg_catalog.jsonb_build_object(
      'custom_activity_id', v_activity_id, 'activity_key', p_activity_key,
      'profile_version_key', p_profile_version_key, 'target_competency_ref', p_target_competency_ref
    )
  );
  v_response := pg_catalog.jsonb_build_object(
    'commandId', v_command_id, 'workspaceId', p_workspace_id, 'customActivityId', v_activity_id,
    'activityKey', p_activity_key, 'profileVersionKey', p_profile_version_key, 'overlayVersion', p_expected_overlay_version + 1,
    'emittedEventIds', pg_catalog.jsonb_build_array(v_event_id)
  );
  update outbox.command_receipts set command_status = 'completed', response = v_response,
    emitted_event_ids = array[v_event_id], completed_at = clock_timestamp() where command_id = v_command_id;
  return v_response;
end
$function$;

alter function overlay.add_custom_activity_impl(uuid, text, text, text, text, text, bigint, text) owner to pando_phase1_api;
revoke all on function overlay.add_custom_activity_impl(uuid, text, text, text, text, text, bigint, text)
  from public, anon, authenticated, service_role;
grant execute on function overlay.add_custom_activity_impl(uuid, text, text, text, text, text, bigint, text) to authenticated;

create function overlay.set_position_impl(
  p_workspace_id uuid,
  p_readiness_goal_key text,
  p_node_ref text,
  p_x numeric,
  p_y numeric,
  p_expected_overlay_version bigint,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_user_id uuid;
  v_command_id uuid := gen_random_uuid();
  v_correlation_id uuid := gen_random_uuid();
  v_event_id uuid := gen_random_uuid();
  v_position_id uuid;
  v_request_hash bytea;
  v_response jsonb;
  v_receipt outbox.command_receipts%rowtype;
  v_current_version bigint;
  v_readiness_goal_id uuid;
  v_profile_version_id uuid;
  v_profile_version_key text;
begin
  if identity.jwt_subject() is null then raise exception using errcode = '28000', message = 'an authenticated user is required'; end if;
  if not identity.is_workspace_member(p_workspace_id) then raise exception using errcode = '42501', message = 'workspace is not accessible'; end if;
  v_actor_user_id := identity.current_user_id();
  if v_actor_user_id is null then raise exception using errcode = '28000', message = 'authenticated user is not provisioned'; end if;
  if p_idempotency_key is null or p_idempotency_key <> btrim(p_idempotency_key) or char_length(p_idempotency_key) not between 1 and 128 then raise exception using errcode = '22023', message = 'idempotency key must contain 1 to 128 trimmed characters'; end if;
  if p_expected_overlay_version is null or p_expected_overlay_version < 0 then raise exception using errcode = '22023', message = 'expected overlay version must be nonnegative'; end if;
  if p_node_ref is null or p_node_ref !~ '^(domain|competency):[a-z0-9][a-z0-9-]{1,100}$' then raise exception using errcode = '22023', message = 'position node reference is invalid'; end if;
  if p_x is null or p_y is null or p_x not between -1000000 and 1000000 or p_y not between -1000000 and 1000000 then raise exception using errcode = '22023', message = 'position coordinates are outside the supported range'; end if;
  v_request_hash := extensions.digest(pg_catalog.convert_to(pg_catalog.jsonb_build_object(
    'commandType', 'overlay.set_position', 'schemaVersion', 1, 'workspaceId', p_workspace_id,
    'readinessGoalKey', p_readiness_goal_key, 'nodeRef', p_node_ref, 'x', p_x, 'y', p_y, 'expectedOverlayVersion', p_expected_overlay_version
  )::text, 'UTF8'), 'sha256');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    v_actor_user_id::text || ':overlay.set_position:' || p_idempotency_key, 0
  ));
  select receipt.* into v_receipt from outbox.command_receipts as receipt
  where receipt.actor_user_id = v_actor_user_id and receipt.command_type = 'overlay.set_position'
    and receipt.idempotency_key = p_idempotency_key for update;
  if found then
    if v_receipt.request_hash <> v_request_hash then raise exception using errcode = '22023', message = 'idempotency key reused with a different request'; end if;
    if v_receipt.command_status <> 'completed' then raise exception using errcode = '40001', message = 'command receipt is not complete'; end if;
    return v_receipt.response;
  end if;
  select goal.readiness_goal_id, version.profile_version_id, version.profile_version_key
  into v_readiness_goal_id, v_profile_version_id, v_profile_version_key
  from targets.readiness_goals as goal
  join targets.target_profile_versions as version
    on version.profile_version_id = goal.profile_version_id
  where goal.workspace_id = p_workspace_id
    and goal.readiness_goal_key = p_readiness_goal_key
    and version.lifecycle in ('published', 'retired');
  if v_readiness_goal_id is null then raise exception using errcode = '42501', message = 'readiness goal is not accessible'; end if;
  if not exists (
    select 1 from catalog.items as item
    join targets.target_profile_versions as profile on profile.catalog_version_id = item.catalog_version_id
    where profile.profile_version_id = v_profile_version_id
      and item.item_key = p_node_ref and item.lifecycle = 'active'
    union all
    select 1 from overlay.personal_competencies as competency
    where competency.workspace_id = p_workspace_id and competency.competency_key = p_node_ref
      and competency.lifecycle = 'accepted'
  ) then raise exception using errcode = '22023', message = 'position node is unavailable in the selected profile graph'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_workspace_id::text, 1));
  insert into overlay.workspace_overlays (workspace_id) values (p_workspace_id) on conflict do nothing;
  select root.aggregate_version into strict v_current_version from overlay.workspace_overlays as root
  where root.workspace_id = p_workspace_id for update;
  if v_current_version <> p_expected_overlay_version then raise exception using errcode = '40001', message = 'overlay aggregate version conflict'; end if;
  insert into outbox.command_receipts (
    command_id, command_type, command_schema_version, workspace_id, actor_user_id,
    idempotency_key, request_hash, correlation_id, expected_aggregate_version
  ) values (
    v_command_id, 'overlay.set_position', 1, p_workspace_id, v_actor_user_id,
    p_idempotency_key, v_request_hash, v_correlation_id, p_expected_overlay_version
  );
  select position.position_id into v_position_id from overlay.positions as position
  where position.workspace_id = p_workspace_id
    and position.readiness_goal_id = v_readiness_goal_id
    and position.profile_version_id = v_profile_version_id
    and position.node_ref = p_node_ref;
  if v_position_id is null then
    v_position_id := gen_random_uuid();
    insert into overlay.positions (
      position_id, workspace_id, readiness_goal_id, profile_version_id, node_ref, x, y
    ) values (
      v_position_id, p_workspace_id, v_readiness_goal_id, v_profile_version_id, p_node_ref, p_x, p_y
    );
  else
    update overlay.positions set x = p_x, y = p_y, updated_at = clock_timestamp()
    where position_id = v_position_id;
  end if;
  update overlay.workspace_overlays set aggregate_version = aggregate_version + 1, updated_at = clock_timestamp()
  where workspace_id = p_workspace_id;
  insert into outbox.events (
    event_id, event_name, event_schema_version, workspace_id, aggregate_type, aggregate_id,
    aggregate_version, actor_type, actor_user_id, command_id, correlation_id, occurred_at, source, payload
  ) values (
    v_event_id, 'overlay.position_set', 1, p_workspace_id, 'overlay.workspace', p_workspace_id,
    p_expected_overlay_version + 1, 'user', v_actor_user_id, v_command_id, v_correlation_id,
    clock_timestamp(), 'pando.database', pg_catalog.jsonb_build_object(
      'position_id', v_position_id, 'readiness_goal_key', p_readiness_goal_key,
      'profile_version_key', v_profile_version_key, 'node_ref', p_node_ref
    )
  );
  v_response := pg_catalog.jsonb_build_object(
    'commandId', v_command_id, 'workspaceId', p_workspace_id, 'positionId', v_position_id,
    'nodeRef', p_node_ref, 'readinessGoalKey', p_readiness_goal_key,
    'profileVersionKey', v_profile_version_key, 'overlayVersion', p_expected_overlay_version + 1,
    'emittedEventIds', pg_catalog.jsonb_build_array(v_event_id)
  );
  update outbox.command_receipts set command_status = 'completed', response = v_response,
    emitted_event_ids = array[v_event_id], completed_at = clock_timestamp() where command_id = v_command_id;
  return v_response;
end
$function$;

alter function overlay.set_position_impl(uuid, text, text, numeric, numeric, bigint, text) owner to pando_phase1_api;
revoke all on function overlay.set_position_impl(uuid, text, text, numeric, numeric, bigint, text)
  from public, anon, authenticated, service_role;
grant execute on function overlay.set_position_impl(uuid, text, text, numeric, numeric, bigint, text) to authenticated;

create function api.get_available_target_profiles(p_workspace_id uuid)
returns jsonb language sql stable security invoker set search_path = ''
as $function$ select targets.get_available_profiles_impl(p_workspace_id) $function$;
create function api.get_target_profile(p_workspace_id uuid, p_profile_version_key text)
returns jsonb language sql stable security invoker set search_path = ''
as $function$ select targets.get_profile_impl(p_workspace_id, p_profile_version_key) $function$;
create function api.get_overlay_note(p_workspace_id uuid, p_subject_ref text)
returns jsonb language sql stable security invoker set search_path = ''
as $function$ select overlay.get_note_impl(p_workspace_id, p_subject_ref) $function$;
create function api.get_explore_source_v1(p_workspace_id uuid, p_readiness_goal_key text, p_selected_activity_key text default null)
returns jsonb language sql stable security invoker set search_path = ''
as $function$ select overlay.get_explore_source_impl(p_workspace_id, p_readiness_goal_key, p_selected_activity_key) $function$;
create function api.save_overlay_note(p_workspace_id uuid, p_subject_ref text, p_note_body text, p_expected_overlay_version bigint, p_idempotency_key text)
returns jsonb language sql security invoker set search_path = ''
as $function$ select overlay.save_note_impl(p_workspace_id, p_subject_ref, p_note_body, p_expected_overlay_version, p_idempotency_key) $function$;
create function api.add_custom_activity(p_workspace_id uuid, p_profile_version_key text, p_activity_key text, p_title text, p_activity_type text, p_target_competency_ref text, p_expected_overlay_version bigint, p_idempotency_key text)
returns jsonb language sql security invoker set search_path = ''
as $function$ select overlay.add_custom_activity_impl(p_workspace_id, p_profile_version_key, p_activity_key, p_title, p_activity_type, p_target_competency_ref, p_expected_overlay_version, p_idempotency_key) $function$;
create function api.set_overlay_position(p_workspace_id uuid, p_readiness_goal_key text, p_node_ref text, p_x numeric, p_y numeric, p_expected_overlay_version bigint, p_idempotency_key text)
returns jsonb language sql security invoker set search_path = ''
as $function$ select overlay.set_position_impl(p_workspace_id, p_readiness_goal_key, p_node_ref, p_x, p_y, p_expected_overlay_version, p_idempotency_key) $function$;

revoke all on function api.get_available_target_profiles(uuid) from public, anon, authenticated, service_role;
revoke all on function api.get_target_profile(uuid, text) from public, anon, authenticated, service_role;
revoke all on function api.get_overlay_note(uuid, text) from public, anon, authenticated, service_role;
revoke all on function api.get_explore_source_v1(uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function api.save_overlay_note(uuid, text, text, bigint, text) from public, anon, authenticated, service_role;
revoke all on function api.add_custom_activity(uuid, text, text, text, text, text, bigint, text) from public, anon, authenticated, service_role;
revoke all on function api.set_overlay_position(uuid, text, text, numeric, numeric, bigint, text) from public, anon, authenticated, service_role;
grant execute on function api.get_available_target_profiles(uuid) to authenticated;
grant execute on function api.get_target_profile(uuid, text) to authenticated;
grant execute on function api.get_overlay_note(uuid, text) to authenticated;
grant execute on function api.get_explore_source_v1(uuid, text, text) to authenticated;
grant execute on function api.save_overlay_note(uuid, text, text, bigint, text) to authenticated;
grant execute on function api.add_custom_activity(uuid, text, text, text, text, text, bigint, text) to authenticated;
grant execute on function api.set_overlay_position(uuid, text, text, numeric, numeric, bigint, text) to authenticated;

grant usage on schema targets, overlay to authenticated;

revoke all on function catalog.guard_version_mutation(), catalog.guard_version_child_mutation(),
  catalog.guard_roadmap_version_mutation(), catalog.guard_roadmap_item_mutation(),
  targets.guard_profile_scope(), targets.guard_requirement_scope(),
  targets.validate_profile_for_publication(uuid), targets.guard_profile_version_mutation()
  from public, anon, authenticated, service_role;

revoke create on schema targets, overlay from pando_phase1_api;

do $migration_role_membership$
begin
  execute pg_catalog.format('revoke pando_rls_authorizer, pando_phase1_api from %I', current_user);
end
$migration_role_membership$;
