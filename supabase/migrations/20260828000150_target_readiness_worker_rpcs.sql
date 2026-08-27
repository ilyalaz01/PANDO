-- Fixed service-only Targets readiness projection worker.

do $migration_role_membership$
begin
  execute pg_catalog.format('grant pando_readiness_worker to %I with set true', current_user);
end
$migration_role_membership$;

grant create on schema targets, outbox to pando_readiness_worker;
grant usage on schema targets, outbox to service_role;

create function targets.stable_readiness_uuid_v1(p_scope text)
returns uuid
language sql
immutable
strict
set search_path = ''
as $function$
  with hash as (select pg_catalog.md5(p_scope) as value)
  select (
    pg_catalog.substr(value, 1, 8) || '-' ||
    pg_catalog.substr(value, 9, 4) || '-5' ||
    pg_catalog.substr(value, 14, 3) || '-a' ||
    pg_catalog.substr(value, 18, 3) || '-' ||
    pg_catalog.substr(value, 21, 12)
  )::uuid
  from hash
$function$;

create function outbox.claim_target_readiness_projection_impl()
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
  where exhausted.consumer_name = 'targets.readiness_projection_v1'
    and exhausted.handler_contract_version = 1
    and exhausted.delivery_state = 'leased'
    and exhausted.lease_expires_at <= clock_timestamp()
    and exhausted.attempt_count >= 8;

  return query
  with candidates as (
    select delivery.delivery_id
    from outbox.deliveries as delivery
    join outbox.events as candidate_event
      on candidate_event.workspace_id = delivery.workspace_id
     and candidate_event.event_id = delivery.event_id
    where delivery.consumer_name = 'targets.readiness_projection_v1'
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
      and not exists (
        select 1
        from outbox.deliveries as earlier
        join outbox.events as earlier_event
          on earlier_event.workspace_id = earlier.workspace_id
         and earlier_event.event_id = earlier.event_id
        where earlier.workspace_id = delivery.workspace_id
          and earlier.consumer_name = 'targets.readiness_projection_v1'
          and earlier.handler_contract_version = 1
          and (
            earlier.delivery_state = 'leased'
            or (
              earlier.delivery_state in ('pending', 'retry')
              and earlier.available_at <= clock_timestamp()
            )
          )
          and earlier_event.event_position < candidate_event.event_position
      )
    order by candidate_event.event_position, delivery.delivery_id
    for update of delivery skip locked
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

create function targets.readiness_projection_event_v1_is_valid(p_event outbox.events)
returns boolean
language sql
immutable
set search_path = ''
as $function$
  select case (p_event).event_name
    when 'targets.readiness_goal_created' then
      (p_event).event_schema_version = 1
      and (p_event).aggregate_type = 'targets.readiness_goal'
      and (p_event).aggregate_id is not null
      and (p_event).aggregate_version = 1
      and (p_event).actor_type = 'user'
      and (p_event).actor_user_id is not null
      and (p_event).source = 'pando.database'
      and (p_event).payload->>'readiness_goal_id' = (p_event).aggregate_id::text
      and ((p_event).payload->>'readiness_goal_key') ~ '^goal:[a-z0-9][a-z0-9-]{1,100}$'
      and ((p_event).payload->>'profile_version_id') ~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and ((p_event).payload->>'profile_version_key') ~ '^target:[a-z0-9][a-z0-9-]{1,100}$'
      and not exists (
        select 1 from pg_catalog.jsonb_object_keys((p_event).payload) as payload_key(key)
        where payload_key.key not in (
          'readiness_goal_id', 'readiness_goal_key',
          'profile_version_id', 'profile_version_key'
        )
      )
    when 'mastery.competency_state_changed' then
      (p_event).event_schema_version = 1
      and (p_event).aggregate_type is null
      and (p_event).aggregate_id is null
      and (p_event).aggregate_version is null
      and (p_event).actor_type = 'system'
      and (p_event).actor_user_id is null
      and (p_event).source = 'pando.mastery_worker'
      and ((p_event).payload->>'competency_ref') ~
        '^competency:[a-z0-9][a-z0-9-]{1,100}$'
      and ((p_event).payload->>'snapshot_id') ~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and ((p_event).payload->>'input_watermark') ~ '^[1-9][0-9]{0,18}$'
      and (p_event).payload->>'achievement_level' in (
        'NOT_STARTED', 'COMPLETED', 'VERIFIED', 'MASTERED'
      )
      and (p_event).payload->>'projection_generation' = 'live-v1'
      and (p_event).payload->>'engine_version' = 'mastery-engine/0.1.0'
      and (p_event).payload->>'policy_version' = 'mastery-readiness-policy/0.1'
      and ((p_event).payload->>'calculated_as_of')::timestamptz is not null
      and not exists (
        select 1 from pg_catalog.jsonb_object_keys((p_event).payload) as payload_key(key)
        where payload_key.key not in (
          'competency_ref', 'snapshot_id', 'projection_generation', 'input_watermark',
          'achievement_level', 'engine_version', 'policy_version', 'calculated_as_of'
        )
      )
    when 'targets.readiness_refresh_scheduled' then
      (p_event).event_schema_version = 1
      and (p_event).aggregate_type = 'targets.readiness_projection'
      and (p_event).aggregate_id is not null
      and (p_event).aggregate_version is not null
      and (p_event).actor_type = 'system'
      and (p_event).actor_user_id is null
      and (p_event).source = 'pando.readiness_worker'
      and (p_event).payload->>'readiness_goal_id' = (p_event).aggregate_id::text
      and ((p_event).payload->>'source_snapshot_id') ~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and ((p_event).payload->>'scheduled_for')::timestamptz is not null
      and ((p_event).payload->>'input_fingerprint') ~ '^readiness-input:[a-f0-9]{64}$'
      and not exists (
        select 1 from pg_catalog.jsonb_object_keys((p_event).payload) as payload_key(key)
        where payload_key.key not in (
          'readiness_goal_id', 'source_snapshot_id', 'scheduled_for', 'input_fingerprint'
        )
      )
    else false
  end
$function$;

create function targets.load_readiness_projection_input_impl(
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
  v_calculated_as_of timestamptz;
  v_source_watermark bigint;
  v_goal_filter uuid;
  v_competency_ref text;
  v_goals jsonb;
  v_required_competencies text[];
  v_mastery_source jsonb;
  v_projection_error text;
begin
  select delivery.* into v_delivery
  from outbox.deliveries as delivery
  where delivery.delivery_id = p_delivery_id
    and delivery.consumer_name = 'targets.readiness_projection_v1'
    and delivery.handler_contract_version = 1;
  if not found or v_delivery.delivery_state <> 'leased'
     or v_delivery.lease_token is distinct from p_lease_token
     or v_delivery.lease_expires_at <= clock_timestamp() then
    raise exception using errcode = '42501', message = 'readiness delivery lease is not valid';
  end if;
  select event.* into strict v_event
  from outbox.events as event
  where event.workspace_id = v_delivery.workspace_id
    and event.event_id = v_delivery.event_id;
  if targets.readiness_projection_event_v1_is_valid(v_event) is not true then
    raise exception using errcode = '22023', message = 'readiness delivery event contract is invalid';
  end if;

  -- The lease start is one stable, current calculation clock for both load and completion.
  -- Event time cannot be reused because this loader intentionally reads the current Evidence ledger.
  v_calculated_as_of := pg_catalog.date_trunc(
    'milliseconds', v_delivery.lease_expires_at - interval '2 minutes'
  );
  if v_event.event_name = 'targets.readiness_goal_created' then
    v_goal_filter := v_event.aggregate_id;
  elsif v_event.event_name = 'mastery.competency_state_changed' then
    v_competency_ref := v_event.payload->>'competency_ref';
  else
    v_goal_filter := v_event.aggregate_id;
  end if;

  select coalesce(pg_catalog.jsonb_agg(goal.value order by goal.goal_key collate "C"), '[]'::jsonb),
    coalesce(array_agg(distinct required_ref order by required_ref)
      filter (where required_ref is not null), '{}'::text[]),
    max(goal.projection_error)
  into v_goals, v_required_competencies, v_projection_error
  from (
    select readiness_goal.readiness_goal_key as goal_key,
      case when exists (
        select 1
        from targets.target_requirement_members as unsupported
        where unsupported.profile_version_id = readiness_goal.profile_version_id
          and unsupported.member_type = 'NODE'
          and unsupported.node_kind = 'DOMAIN'
      ) then 'UNSUPPORTED_DOMAIN_REQUIREMENT' end as projection_error,
      pg_catalog.jsonb_build_object(
        'readinessGoalId', readiness_goal.readiness_goal_id,
        'readinessGoalKey', readiness_goal.readiness_goal_key,
        'goalAggregateVersion', readiness_goal.aggregate_version::text,
        'profileVersionId', profile.profile_version_id,
        'profileVersionKey', profile.profile_version_key,
        'rootRuleKey', profile.root_rule_key,
        'targetThreshold', profile.readiness_threshold,
        'currentPointer', case when current_pointer.snapshot_id is null then null else
          pg_catalog.jsonb_build_object(
            'snapshotId', current_pointer.snapshot_id,
            'projectionVersion', current_pointer.projection_version::text,
            'sourceEvidenceWatermark', current_pointer.source_evidence_watermark::text,
            'calculatedAsOf', pg_catalog.date_trunc('milliseconds', current_pointer.calculated_as_of),
            'validUntil', pg_catalog.date_trunc('milliseconds', current_pointer.valid_until)
          )
        end,
        'rules', rules.value,
        'requiredLeaves', leaves.value
      ) as value,
      leaf_ref.value as required_ref
    from targets.readiness_goals as readiness_goal
    join targets.target_profile_versions as profile
      on profile.profile_version_id = readiness_goal.profile_version_id
    left join targets.current_readiness_snapshots as current_pointer
      on current_pointer.workspace_id = readiness_goal.workspace_id
     and current_pointer.readiness_goal_id = readiness_goal.readiness_goal_id
    cross join lateral (
      select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'ruleKey', rule.rule_key,
        'ruleType', rule.rule_type,
        'criticality', rule.criticality,
        'requiredCount', rule.required_count,
        'threshold', rule.threshold,
        'members', coalesce(members.value, '[]'::jsonb)
      ) order by rule.rule_key collate "C"), '[]'::jsonb) as value
      from targets.target_requirement_rules as rule
      left join lateral (
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_strip_nulls(
          pg_catalog.jsonb_build_object(
            'memberOrder', member.member_order,
            'memberType', member.member_type,
            'nodeScope', member.node_scope,
            'nodeKind', member.node_kind,
            'nodeRef', member.node_ref,
            'referencedRuleKey', referenced.rule_key,
            'dimension', member.objective_dimension,
            'requiredLevel', member.required_level,
            'weight', member.member_weight
          )
        ) order by member.member_order) as value
        from targets.target_requirement_members as member
        left join targets.target_requirement_rules as referenced
          on referenced.profile_version_id = member.profile_version_id
         and referenced.requirement_rule_id = member.referenced_rule_id
        where member.requirement_rule_id = rule.requirement_rule_id
      ) as members on true
      where rule.profile_version_id = profile.profile_version_id
    ) as rules
    cross join lateral (
      select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'competencyRef', leaf.competency_ref,
        'dimension', leaf.dimension,
        'requiredLevel', leaf.required_level,
        'owningRuleKeys', leaf.owning_rule_keys
      ) order by leaf.competency_ref collate "C", leaf.dimension, leaf.required_level), '[]'::jsonb)
        as value
      from (
        select member.node_ref as competency_ref,
          member.objective_dimension as dimension,
          member.required_level,
          array_agg(distinct owner.rule_key order by owner.rule_key) as owning_rule_keys
        from targets.target_requirement_members as member
        join targets.target_requirement_rules as owner
          on owner.profile_version_id = member.profile_version_id
         and owner.requirement_rule_id = member.requirement_rule_id
        where member.profile_version_id = profile.profile_version_id
          and member.member_type = 'NODE'
          and member.node_kind = 'COMPETENCY'
        group by member.node_ref, member.objective_dimension, member.required_level
      ) as leaf
    ) as leaves
    left join lateral (
      select member.node_ref as value
      from targets.target_requirement_members as member
      where member.profile_version_id = profile.profile_version_id
        and member.member_type = 'NODE'
        and member.node_kind = 'COMPETENCY'
      group by member.node_ref
    ) as leaf_ref on true
    where readiness_goal.workspace_id = v_delivery.workspace_id
      and readiness_goal.lifecycle = 'active'
      and (
        (v_event.event_name = 'targets.readiness_goal_created'
          and readiness_goal.readiness_goal_id = v_goal_filter)
        or
        (v_event.event_name = 'mastery.competency_state_changed' and exists (
          select 1 from targets.target_requirement_members as affected
          where affected.profile_version_id = readiness_goal.profile_version_id
            and affected.member_type = 'NODE'
            and affected.node_kind = 'COMPETENCY'
            and affected.node_ref = v_competency_ref
        ))
        or
        (v_event.event_name = 'targets.readiness_refresh_scheduled'
          and readiness_goal.readiness_goal_id = v_goal_filter
          and current_pointer.snapshot_id::text = v_event.payload->>'source_snapshot_id'
          and current_pointer.projection_version = v_event.aggregate_version)
      )
  ) as goal;

  -- The outer lateral row multiplication above is used only to collect distinct competency refs.
  -- Collapse duplicate goal JSON values caused by that collection.
  select coalesce(pg_catalog.jsonb_agg(value order by value->>'readinessGoalKey'), '[]'::jsonb)
  into v_goals
  from (select distinct value from pg_catalog.jsonb_array_elements(v_goals) as entry(value)) deduped;

  v_mastery_source := mastery.get_readiness_calculation_source_v1(
    v_delivery.workspace_id, v_required_competencies, null
  );
  v_source_watermark := (v_mastery_source->>'sourceEvidenceWatermark')::bigint;

  return pg_catalog.jsonb_build_object(
    'contract', pg_catalog.jsonb_build_object(
      'name', 'TargetReadinessProjectionInputV1', 'version', '1.0.0'
    ),
    'deliveryId', v_delivery.delivery_id,
    'eventId', v_event.event_id,
    'eventPosition', v_event.event_position::text,
    'workspaceId', v_delivery.workspace_id,
    'eventName', v_event.event_name,
    'calculatedAsOf', v_calculated_as_of,
    'sourceEvidenceWatermark', v_source_watermark::text,
    'projectionGeneration', 'live-v1',
    'projectionError', v_projection_error,
    'goals', v_goals,
    'masterySource', v_mastery_source
  );
end
$function$;

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
  v_delivery outbox.deliveries%rowtype;
  v_event outbox.events%rowtype;
  v_authoritative jsonb;
  v_goal jsonb;
  v_result jsonb;
  v_input jsonb;
  v_current targets.current_readiness_snapshots%rowtype;
  v_snapshot_id uuid;
  v_stored_snapshot targets.readiness_snapshots%rowtype;
  v_changed integer;
  v_next_projection_version bigint;
  v_projection_event_id uuid;
  v_schedule_event_id uuid;
  v_valid_until timestamptz;
  v_scheduled_for timestamptz;
  v_expected_leaf_count integer;
begin
  perform 1 from outbox.consumer_receipts as receipt
  where receipt.delivery_id = p_delivery_id
    and receipt.consumer_name = 'targets.readiness_projection_v1';
  if found then return true; end if;

  select delivery.* into v_delivery
  from outbox.deliveries as delivery
  where delivery.delivery_id = p_delivery_id
    and delivery.consumer_name = 'targets.readiness_projection_v1'
    and delivery.handler_contract_version = 1
  for update;
  if not found or v_delivery.delivery_state <> 'leased'
     or v_delivery.lease_token is distinct from p_lease_token
     or v_delivery.lease_expires_at <= clock_timestamp() then
    raise exception using errcode = '42501', message = 'readiness delivery lease is not valid';
  end if;
  select event.* into strict v_event
  from outbox.events as event
  where event.workspace_id = v_delivery.workspace_id and event.event_id = v_delivery.event_id;
  if v_event.event_position <> p_expected_event_position
     or targets.readiness_projection_event_v1_is_valid(v_event) is not true then
    raise exception using errcode = '22023', message = 'readiness event contract is invalid';
  end if;
  if p_results is null or pg_catalog.jsonb_typeof(p_results) <> 'array'
     or pg_catalog.jsonb_array_length(p_results) > 20
     or pg_catalog.pg_column_size(p_results) > 1048576 then
    raise exception using errcode = '22023', message = 'readiness projection results are invalid';
  end if;

  -- Evidence append/correction uses the same key. Hold it through the authoritative reload,
  -- snapshot/pointer publication, and outbox writes so the claimed watermark cannot advance.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    v_delivery.workspace_id::text || ':evidence-ledger', 4
  ));
  v_authoritative := targets.load_readiness_projection_input_impl(
    p_delivery_id, p_lease_token
  );
  if v_authoritative->>'projectionError' is not null then
    raise exception using errcode = '22023',
      message = 'readiness projection has an unsupported requirement';
  end if;
  if pg_catalog.jsonb_array_length(p_results) <>
     pg_catalog.jsonb_array_length(v_authoritative->'goals')
     or exists (
       select 1
       from pg_catalog.jsonb_array_elements(p_results) as supplied(value)
       group by supplied.value->>'readinessGoalId'
       having count(*) > 1
     ) then
    raise exception using errcode = '22023',
      message = 'readiness projection omitted or added an authoritative goal';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_results) as supplied(value)
    where supplied.value->>'sourceEvidenceWatermark' is distinct from
      v_authoritative->>'sourceEvidenceWatermark'
  ) then
    return false;
  end if;

  -- Lock and fence every affected goal before writing any result.
  for v_goal in
    select value from pg_catalog.jsonb_array_elements(v_authoritative->'goals') as goal(value)
    order by value->>'readinessGoalId'
  loop
    select supplied.value into v_result
    from pg_catalog.jsonb_array_elements(p_results) as supplied(value)
    where supplied.value->>'readinessGoalId' = v_goal->>'readinessGoalId';
    if not found
       or pg_catalog.jsonb_typeof(v_result) <> 'object'
       or v_result->>'profileVersionId' is distinct from v_goal->>'profileVersionId'
       or v_result->>'projectionGeneration' <> 'live-v1'
       or v_result->>'masteryEngineVersion' is distinct from
         v_authoritative->'masterySource'->>'masteryEngineVersion'
       or v_result->>'masteryPolicyVersion' is distinct from
         v_authoritative->'masterySource'->>'masteryPolicyVersion'
       or v_result->>'sourceEvidenceWatermark' is distinct from
         v_authoritative->>'sourceEvidenceWatermark'
       or (v_result->>'calculatedAsOf')::timestamptz is distinct from
         (v_authoritative->>'calculatedAsOf')::timestamptz
       or (v_result->>'inputFingerprint') !~ '^readiness-input:[a-f0-9]{64}$'
       or pg_catalog.jsonb_typeof(v_result->'readiness') <> 'object'
       or pg_catalog.jsonb_typeof(v_result->'gaps') <> 'array'
       or pg_catalog.jsonb_typeof(v_result->'inputs') <> 'array'
       or exists (
         select 1 from pg_catalog.jsonb_object_keys(v_result) as result_key(key)
         where result_key.key not in (
           'readinessGoalId', 'profileVersionId', 'projectionGeneration',
           'inputFingerprint', 'sourceEvidenceWatermark', 'calculatedAsOf',
           'validUntil', 'masteryEngineVersion', 'masteryPolicyVersion',
           'readiness', 'gaps', 'inputs'
         )
       ) then
      raise exception using errcode = '22023', message = 'readiness goal result is invalid';
    end if;
    v_expected_leaf_count := pg_catalog.jsonb_array_length(v_goal->'requiredLeaves');
    if pg_catalog.jsonb_array_length(v_result->'inputs') <> v_expected_leaf_count
       or exists (
         select 1
         from pg_catalog.jsonb_array_elements(v_result->'inputs') as supplied(value)
         left join pg_catalog.jsonb_array_elements(v_goal->'requiredLeaves') as expected(value)
           on expected.value->>'competencyRef' = supplied.value->>'competencyRef'
          and expected.value->>'dimension' = supplied.value->>'dimension'
          and expected.value->>'requiredLevel' = supplied.value->>'requiredLevel'
         where expected.value is null
            or expected.value->'owningRuleKeys' is distinct from supplied.value->'owningRuleKeys'
       )
       or exists (
         select 1
         from pg_catalog.jsonb_array_elements(v_result->'inputs') as supplied(value)
         group by supplied.value->>'competencyRef', supplied.value->>'dimension',
           supplied.value->>'requiredLevel'
         having count(*) > 1
       ) then
      raise exception using errcode = '22023',
        message = 'readiness projection input manifest is not authoritative';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      v_delivery.workspace_id::text || ':readiness:' || (v_goal->>'readinessGoalId'), 6
    ));
    select current_pointer.* into v_current
    from targets.current_readiness_snapshots as current_pointer
    where current_pointer.workspace_id = v_delivery.workspace_id
      and current_pointer.readiness_goal_id = (v_goal->>'readinessGoalId')::uuid
    for update;
    if found and (
      v_current.source_evidence_watermark >
        (v_result->>'sourceEvidenceWatermark')::bigint
      or (
        v_current.source_evidence_watermark =
          (v_result->>'sourceEvidenceWatermark')::bigint
        and v_current.calculated_as_of >= (v_result->>'calculatedAsOf')::timestamptz
      )
    ) then
      continue;
    end if;
  end loop;

  for v_goal in
    select value from pg_catalog.jsonb_array_elements(v_authoritative->'goals') as goal(value)
    order by value->>'readinessGoalId'
  loop
    select supplied.value into strict v_result
    from pg_catalog.jsonb_array_elements(p_results) as supplied(value)
    where supplied.value->>'readinessGoalId' = v_goal->>'readinessGoalId';

    select current_pointer.* into v_current
    from targets.current_readiness_snapshots as current_pointer
    where current_pointer.workspace_id = v_delivery.workspace_id
      and current_pointer.readiness_goal_id = (v_goal->>'readinessGoalId')::uuid
    for update;
    if found and (
      v_current.source_evidence_watermark > (v_result->>'sourceEvidenceWatermark')::bigint
      or (
        v_current.source_evidence_watermark = (v_result->>'sourceEvidenceWatermark')::bigint
        and v_current.calculated_as_of >= (v_result->>'calculatedAsOf')::timestamptz
      )
    ) then
      continue;
    end if;

    if v_result->>'validUntil' is null then
      v_valid_until := null;
    else
      v_valid_until := (v_result->>'validUntil')::timestamptz;
    end if;
    if v_valid_until is not null
       and v_valid_until < (v_result->>'calculatedAsOf')::timestamptz then
      raise exception using errcode = '22023', message = 'readiness validity is invalid';
    end if;
    if v_result->'readiness'->>'engineVersion' <> 'readiness-engine/0.1.0'
       or v_result->'readiness'->>'policyVersion' <> 'mastery-readiness-policy/0.1'
       or v_result->'readiness'->>'targetProfileVersionId' <> v_goal->>'profileVersionId'
       or v_result->'readiness'->>'inputWatermark' <> v_result->>'inputFingerprint'
       or (v_result->'readiness'->>'calculatedAsOf')::timestamptz <>
          (v_result->>'calculatedAsOf')::timestamptz
       or (v_result->'readiness'->>'status') not in (
         'NOT_READY', 'INSUFFICIENT_EVIDENCE', 'READY', 'DEVELOPING'
       )
       or (v_result->'readiness'->>'confidence') not in ('LOW', 'MEDIUM', 'HIGH')
       or pg_catalog.jsonb_typeof(v_result->'readiness'->'blockers') <> 'array'
       or pg_catalog.jsonb_typeof(v_result->'readiness'->'ruleEvaluations') <> 'array'
       or pg_catalog.jsonb_typeof(v_result->'readiness'->'explanationCodes') <> 'array'
       or (v_result->'readiness'->>'lower')::numeric not between 0 and 1
       or (v_result->'readiness'->>'upper')::numeric not between 0 and 1
       or (v_result->'readiness'->>'lower')::numeric >
          (v_result->'readiness'->>'upper')::numeric
       or (v_result->'readiness'->>'coverage')::numeric not between 0 and 1 then
      raise exception using errcode = '22023', message = 'readiness engine result is invalid';
    end if;
    if (v_result->'readiness'->>'targetThreshold')::numeric <>
         coalesce((v_goal->>'targetThreshold')::numeric, 0.8)
       or exists (
         select 1
         from pg_catalog.jsonb_object_keys(v_result->'readiness') as result_key(key)
         where result_key.key not in (
           'engineVersion', 'policyVersion', 'targetProfileVersionId',
           'inputWatermark', 'calculatedAsOf', 'targetThreshold', 'lower', 'upper',
           'coverage', 'status', 'confidence', 'blockers', 'ruleEvaluations',
           'explanationCodes'
         )
       )
       or pg_catalog.jsonb_array_length(v_result->'readiness'->'ruleEvaluations') <>
         pg_catalog.jsonb_array_length(v_goal->'rules')
       or exists (
         select 1
         from pg_catalog.jsonb_array_elements(
           v_result->'readiness'->'ruleEvaluations'
         ) as supplied(value)
         left join pg_catalog.jsonb_array_elements(v_goal->'rules') as expected(value)
           on expected.value->>'ruleKey' = supplied.value->>'ruleId'
         where expected.value is null
           or expected.value->>'ruleType' is distinct from supplied.value->>'kind'
       )
       or exists (
         select 1
         from pg_catalog.jsonb_array_elements(
           v_result->'readiness'->'ruleEvaluations'
         ) as supplied(value)
         group by supplied.value->>'ruleId'
         having count(*) > 1
       )
       or exists (
         select 1
         from pg_catalog.jsonb_array_elements(
           v_result->'readiness'->'blockers'
         ) as blocker(value)
         left join pg_catalog.jsonb_array_elements(v_goal->'rules') as expected(value)
           on expected.value->>'ruleKey' = blocker.value->>'ruleId'
         where blocker.value->>'code' not in (
           'MANDATORY_FLOOR_FAILED', 'MANDATORY_FLOOR_UNKNOWN',
           'AGGREGATE_BELOW_THRESHOLD'
         )
           or expected.value is null
           or (
             blocker.value->>'code' in (
               'MANDATORY_FLOOR_FAILED', 'MANDATORY_FLOOR_UNKNOWN'
             )
             and expected.value->>'ruleType' <> 'MANDATORY_FLOOR'
           )
       ) then
      raise exception using errcode = '22023',
        message = 'readiness result contradicts authoritative profile rules';
    end if;

    v_snapshot_id := gen_random_uuid();
    insert into targets.readiness_snapshots (
      snapshot_id, workspace_id, readiness_goal_id, profile_version_id,
      projection_generation, input_fingerprint, source_evidence_watermark,
      mastery_engine_version, mastery_policy_version,
      readiness_engine_version, readiness_policy_version,
      calculated_as_of, valid_until, lower_bound, upper_bound, coverage,
      readiness_status, estimate_confidence, blockers, gaps, rule_evaluations,
      explanation_codes, result
    ) values (
      v_snapshot_id, v_delivery.workspace_id, (v_goal->>'readinessGoalId')::uuid,
      (v_goal->>'profileVersionId')::uuid, 'live-v1', v_result->>'inputFingerprint',
      (v_result->>'sourceEvidenceWatermark')::bigint,
      v_result->>'masteryEngineVersion', v_result->>'masteryPolicyVersion',
      v_result->'readiness'->>'engineVersion', v_result->'readiness'->>'policyVersion',
      (v_result->>'calculatedAsOf')::timestamptz, v_valid_until,
      (v_result->'readiness'->>'lower')::numeric,
      (v_result->'readiness'->>'upper')::numeric,
      (v_result->'readiness'->>'coverage')::numeric,
      v_result->'readiness'->>'status', v_result->'readiness'->>'confidence',
      v_result->'readiness'->'blockers', v_result->'gaps',
      v_result->'readiness'->'ruleEvaluations',
      v_result->'readiness'->'explanationCodes', v_result->'readiness'
    ) on conflict (
      workspace_id, readiness_goal_id, projection_generation,
      readiness_engine_version, readiness_policy_version, input_fingerprint
    ) do nothing;
    select snapshot.* into strict v_stored_snapshot
    from targets.readiness_snapshots as snapshot
    where snapshot.workspace_id = v_delivery.workspace_id
      and snapshot.readiness_goal_id = (v_goal->>'readinessGoalId')::uuid
      and snapshot.projection_generation = 'live-v1'
      and snapshot.readiness_engine_version = 'readiness-engine/0.1.0'
      and snapshot.readiness_policy_version = 'mastery-readiness-policy/0.1'
      and snapshot.input_fingerprint = v_result->>'inputFingerprint';
    v_snapshot_id := v_stored_snapshot.snapshot_id;
    if v_stored_snapshot.profile_version_id <>
         (v_goal->>'profileVersionId')::uuid
       or v_stored_snapshot.source_evidence_watermark <>
         (v_result->>'sourceEvidenceWatermark')::bigint
       or v_stored_snapshot.calculated_as_of <>
         (v_result->>'calculatedAsOf')::timestamptz
       or v_stored_snapshot.valid_until is distinct from v_valid_until
       or v_stored_snapshot.mastery_engine_version <> 'mastery-engine/0.1.0'
       or v_stored_snapshot.mastery_policy_version <> 'mastery-readiness-policy/0.1'
       or v_stored_snapshot.gaps is distinct from v_result->'gaps'
       or v_stored_snapshot.result is distinct from v_result->'readiness' then
      raise exception using errcode = '22023',
        message = 'readiness fingerprint conflicts with stored snapshot provenance';
    end if;

    for v_input in
      select value from pg_catalog.jsonb_array_elements(v_result->'inputs') as input(value)
      order by value->>'competencyRef', value->>'dimension', value->>'requiredLevel'
    loop
      if v_input->>'value' not in ('KNOWN', 'UNKNOWN')
         or v_input->>'achievementLevel' not in (
           'NOT_STARTED', 'COMPLETED', 'VERIFIED', 'MASTERED'
         )
         or v_input->>'freshness' not in ('FRESH', 'STALE', 'UNKNOWN')
         or pg_catalog.jsonb_typeof(v_input->'supportingEvidenceIds') <> 'array'
         or pg_catalog.jsonb_typeof(v_input->'contradictingEvidenceIds') <> 'array'
         or pg_catalog.jsonb_array_length(v_input->'supportingEvidenceIds') > 8
         or pg_catalog.jsonb_array_length(v_input->'contradictingEvidenceIds') > 8
         or (v_input->>'calculatedAsOf')::timestamptz <>
            (v_result->>'calculatedAsOf')::timestamptz then
        raise exception using errcode = '22023', message = 'readiness leaf input is invalid';
      end if;
      if exists (
        select 1
        from (
          select value as evidence_id
          from pg_catalog.jsonb_array_elements_text(
            v_input->'supportingEvidenceIds'
          ) as supporting(value)
          union all
          select value as evidence_id
          from pg_catalog.jsonb_array_elements_text(
            v_input->'contradictingEvidenceIds'
          ) as contradicting(value)
        ) as supplied_evidence
        group by supplied_evidence.evidence_id
        having count(*) > 1
      ) or exists (
        select 1
        from (
          select value as evidence_id
          from pg_catalog.jsonb_array_elements_text(
            v_input->'supportingEvidenceIds'
          ) as supporting(value)
          union all
          select value as evidence_id
          from pg_catalog.jsonb_array_elements_text(
            v_input->'contradictingEvidenceIds'
          ) as contradicting(value)
        ) as supplied_evidence
        where supplied_evidence.evidence_id !~
          '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          or not exists (
            select 1
            from pg_catalog.jsonb_array_elements(
              v_authoritative->'masterySource'->'competencies'
            ) as competency(value)
            cross join lateral pg_catalog.jsonb_array_elements(
              competency.value->'evidence'
            ) as source_evidence(value)
            where competency.value->>'competencyRef' = v_input->>'competencyRef'
              and source_evidence.value->>'evidenceId' = supplied_evidence.evidence_id
              and source_evidence.value->>'dimension' = v_input->>'dimension'
          )
      ) then
        raise exception using errcode = '22023',
          message = 'readiness evidence references are not authoritative';
      end if;
      insert into targets.readiness_snapshot_inputs (
        workspace_id, readiness_goal_id, snapshot_id, competency_ref, dimension,
        required_level, owning_rule_keys, source_evidence_watermark,
        calculated_as_of, value_state, achievement_level, freshness,
        estimate_confidence, last_meaningful_evidence_at,
        supporting_evidence_ids, contradicting_evidence_ids
      ) values (
        v_delivery.workspace_id, (v_goal->>'readinessGoalId')::uuid, v_snapshot_id,
        v_input->>'competencyRef', v_input->>'dimension', v_input->>'requiredLevel',
        array(select jsonb_array_elements_text(v_input->'owningRuleKeys') order by 1),
        (v_result->>'sourceEvidenceWatermark')::bigint,
        (v_result->>'calculatedAsOf')::timestamptz,
        v_input->>'value', v_input->>'achievementLevel', v_input->>'freshness',
        nullif(v_input->>'confidence', ''),
        nullif(v_input->>'lastMeaningfulEvidenceAt', '')::timestamptz,
        array(select value::uuid from jsonb_array_elements_text(
          v_input->'supportingEvidenceIds'
        ) as evidence(value) order by value),
        array(select value::uuid from jsonb_array_elements_text(
          v_input->'contradictingEvidenceIds'
        ) as evidence(value) order by value)
      ) on conflict do nothing;
      if not exists (
        select 1
        from targets.readiness_snapshot_inputs as stored_input
        where stored_input.workspace_id = v_delivery.workspace_id
          and stored_input.readiness_goal_id = (v_goal->>'readinessGoalId')::uuid
          and stored_input.snapshot_id = v_snapshot_id
          and stored_input.competency_ref = v_input->>'competencyRef'
          and stored_input.dimension = v_input->>'dimension'
          and stored_input.required_level = v_input->>'requiredLevel'
          and stored_input.owning_rule_keys = array(
            select jsonb_array_elements_text(v_input->'owningRuleKeys') order by 1
          )
          and stored_input.source_evidence_watermark =
            (v_result->>'sourceEvidenceWatermark')::bigint
          and stored_input.calculated_as_of = (v_result->>'calculatedAsOf')::timestamptz
          and stored_input.value_state = v_input->>'value'
          and stored_input.achievement_level = v_input->>'achievementLevel'
          and stored_input.freshness = v_input->>'freshness'
          and stored_input.estimate_confidence is not distinct from
            nullif(v_input->>'confidence', '')
          and stored_input.last_meaningful_evidence_at is not distinct from
            nullif(v_input->>'lastMeaningfulEvidenceAt', '')::timestamptz
          and stored_input.supporting_evidence_ids = array(
            select value::uuid from jsonb_array_elements_text(
              v_input->'supportingEvidenceIds'
            ) as evidence(value) order by value
          )
          and stored_input.contradicting_evidence_ids = array(
            select value::uuid from jsonb_array_elements_text(
              v_input->'contradictingEvidenceIds'
            ) as evidence(value) order by value
          )
      ) then
        raise exception using errcode = '22023',
          message = 'readiness fingerprint conflicts with stored input provenance';
      end if;
    end loop;

    v_next_projection_version := coalesce(v_current.projection_version, 0) + 1;
    insert into targets.current_readiness_snapshots (
      workspace_id, readiness_goal_id, profile_version_id, snapshot_id,
      projection_version, source_evidence_watermark, calculated_as_of, valid_until
    ) values (
      v_delivery.workspace_id, (v_goal->>'readinessGoalId')::uuid,
      (v_goal->>'profileVersionId')::uuid, v_snapshot_id,
      v_next_projection_version, v_stored_snapshot.source_evidence_watermark,
      v_stored_snapshot.calculated_as_of, v_stored_snapshot.valid_until
    )
    on conflict (workspace_id, readiness_goal_id) do update
    set snapshot_id = excluded.snapshot_id,
        projection_version = excluded.projection_version,
        source_evidence_watermark = excluded.source_evidence_watermark,
        calculated_as_of = excluded.calculated_as_of,
        valid_until = excluded.valid_until,
        updated_at = clock_timestamp()
    where targets.current_readiness_snapshots.source_evidence_watermark <
            excluded.source_evidence_watermark
       or (
         targets.current_readiness_snapshots.source_evidence_watermark =
           excluded.source_evidence_watermark
         and targets.current_readiness_snapshots.calculated_as_of < excluded.calculated_as_of
       );
    get diagnostics v_changed = row_count;

    if v_changed > 0 then
      v_projection_event_id := gen_random_uuid();
      insert into outbox.events (
        event_id, event_name, event_schema_version, workspace_id,
        aggregate_type, aggregate_id, aggregate_version,
        actor_type, actor_user_id, command_id, correlation_id, causation_id,
        occurred_at, source, payload
      ) values (
        v_projection_event_id, 'targets.readiness_projection_changed', 1,
        v_delivery.workspace_id, 'targets.readiness_projection',
        (v_goal->>'readinessGoalId')::uuid, v_next_projection_version,
        'system', null, v_event.command_id, v_event.correlation_id, v_event.event_id,
        (v_result->>'calculatedAsOf')::timestamptz, 'pando.readiness_worker',
        pg_catalog.jsonb_build_object(
          'readiness_goal_id', v_goal->>'readinessGoalId',
          'profile_version_id', v_goal->>'profileVersionId',
          'snapshot_id', v_snapshot_id,
          'projection_version', v_next_projection_version::text,
          'input_fingerprint', v_result->>'inputFingerprint',
          'source_evidence_watermark', v_result->>'sourceEvidenceWatermark',
          'calculated_as_of', v_result->>'calculatedAsOf',
          'status', v_result->'readiness'->>'status',
          'lower', v_result->'readiness'->'lower',
          'upper', v_result->'readiness'->'upper',
          'confidence', v_result->'readiness'->>'confidence',
          'engine_version', v_result->'readiness'->>'engineVersion',
          'policy_version', v_result->'readiness'->>'policyVersion'
        )
      );

      if v_valid_until is not null then
        v_scheduled_for := v_valid_until + interval '1 millisecond';
        v_schedule_event_id := targets.stable_readiness_uuid_v1(
          'targets.readiness_projection_v1:' || v_snapshot_id::text || ':' ||
          pg_catalog.to_char(v_valid_until at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        );
        insert into outbox.events (
          event_id, event_name, event_schema_version, workspace_id,
          aggregate_type, aggregate_id, aggregate_version,
          actor_type, actor_user_id, command_id, correlation_id, causation_id,
          occurred_at, source, payload
        ) values (
          v_schedule_event_id, 'targets.readiness_refresh_scheduled', 1,
          v_delivery.workspace_id, 'targets.readiness_projection',
          (v_goal->>'readinessGoalId')::uuid, v_next_projection_version,
          'system', null, v_event.command_id, v_event.correlation_id,
          v_projection_event_id, clock_timestamp(), 'pando.readiness_worker',
          pg_catalog.jsonb_build_object(
            'readiness_goal_id', v_goal->>'readinessGoalId',
            'source_snapshot_id', v_snapshot_id,
            'scheduled_for', v_scheduled_for,
            'input_fingerprint', v_result->>'inputFingerprint'
          )
        ) on conflict (event_id) do nothing;
        insert into outbox.deliveries (
          event_id, workspace_id, consumer_name, handler_contract_version, available_at
        ) values (
          v_schedule_event_id, v_delivery.workspace_id,
          'targets.readiness_projection_v1', 1, v_scheduled_for
        ) on conflict (event_id, consumer_name, handler_contract_version) do nothing;
      end if;
    end if;
  end loop;

  insert into outbox.consumer_receipts (
    delivery_id, event_id, workspace_id, consumer_name, handler_contract_version,
    input_event_position, lease_token
  ) values (
    v_delivery.delivery_id, v_delivery.event_id, v_delivery.workspace_id,
    'targets.readiness_projection_v1', 1, v_event.event_position, p_lease_token
  );
  update outbox.deliveries
  set delivery_state = 'succeeded', lease_token = null, lease_expires_at = null,
      completed_at = clock_timestamp()
  where delivery_id = v_delivery.delivery_id;
  return true;
end
$function$;

create function outbox.fail_target_readiness_projection_impl(
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
    and delivery.consumer_name = 'targets.readiness_projection_v1'
    and delivery.handler_contract_version = 1
  for update;
  if not found or v_delivery.delivery_state <> 'leased'
     or v_delivery.lease_token is distinct from p_lease_token then
    raise exception using errcode = '42501', message = 'readiness delivery lease is not valid';
  end if;
  v_next_state := case
    when p_failure_class = 'INVALID_CONTRACT' or v_delivery.attempt_count >= 8
      then 'dead_letter'
    else 'retry'
  end;
  v_base_delay_seconds := least(
    900, (5 * pg_catalog.power(2, greatest(v_delivery.attempt_count - 1, 0)))::integer
  );
  v_retry_delay_seconds := least(
    900, v_base_delay_seconds
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

create function outbox.get_target_readiness_projection_health_impl()
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
        where delivery.consumer_name = 'targets.readiness_projection_v1'
        group by delivery.delivery_state order by delivery.delivery_state
      ) state
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
        where delivery.consumer_name = 'targets.readiness_projection_v1'
          and delivery.last_error_code is not null
        group by delivery.last_failure_class, delivery.last_error_code, delivery.delivery_state
      ) failure
    ), '[]'::jsonb)
  )
$function$;

alter function outbox.claim_target_readiness_projection_impl() owner to pando_readiness_worker;
alter function targets.stable_readiness_uuid_v1(text) owner to pando_readiness_worker;
alter function targets.readiness_projection_event_v1_is_valid(outbox.events)
  owner to pando_readiness_worker;
alter function targets.load_readiness_projection_input_impl(uuid, uuid)
  owner to pando_readiness_worker;
alter function targets.complete_readiness_projection_impl(uuid, uuid, bigint, jsonb)
  owner to pando_readiness_worker;
alter function outbox.fail_target_readiness_projection_impl(uuid, uuid, text, text)
  owner to pando_readiness_worker;
alter function outbox.get_target_readiness_projection_health_impl()
  owner to pando_readiness_worker;

revoke all on function outbox.claim_target_readiness_projection_impl(),
  targets.stable_readiness_uuid_v1(text),
  targets.readiness_projection_event_v1_is_valid(outbox.events),
  targets.load_readiness_projection_input_impl(uuid, uuid),
  targets.complete_readiness_projection_impl(uuid, uuid, bigint, jsonb),
  outbox.fail_target_readiness_projection_impl(uuid, uuid, text, text),
  outbox.get_target_readiness_projection_health_impl()
  from public, anon, authenticated, service_role;
grant execute on function outbox.claim_target_readiness_projection_impl(),
  targets.load_readiness_projection_input_impl(uuid, uuid),
  targets.complete_readiness_projection_impl(uuid, uuid, bigint, jsonb),
  outbox.fail_target_readiness_projection_impl(uuid, uuid, text, text),
  outbox.get_target_readiness_projection_health_impl()
  to service_role;

create function api.claim_target_readiness_projection_v1()
returns table (
  delivery_id uuid, event_id uuid, event_position bigint, workspace_id uuid,
  lease_token uuid, lease_expires_at timestamptz, attempt_count smallint,
  event_name text, event_schema_version smallint, payload jsonb
)
language sql security invoker set search_path = ''
as $function$
  select * from outbox.claim_target_readiness_projection_impl()
$function$;

create function api.load_target_readiness_projection_v1(
  p_delivery_id uuid, p_lease_token uuid
)
returns jsonb language sql stable security invoker set search_path = ''
as $function$
  select targets.load_readiness_projection_input_impl(p_delivery_id, p_lease_token)
$function$;

create function api.complete_target_readiness_projection_v1(
  p_delivery_id uuid, p_lease_token uuid,
  p_expected_event_position bigint, p_results jsonb
)
returns boolean language sql security invoker set search_path = ''
as $function$
  select targets.complete_readiness_projection_impl(
    p_delivery_id, p_lease_token, p_expected_event_position, p_results
  )
$function$;

create function api.fail_target_readiness_projection_v1(
  p_delivery_id uuid, p_lease_token uuid, p_failure_class text, p_error_code text
)
returns text language sql security invoker set search_path = ''
as $function$
  select outbox.fail_target_readiness_projection_impl(
    p_delivery_id, p_lease_token, p_failure_class, p_error_code
  )
$function$;

create function api.get_target_readiness_projection_health_v1()
returns jsonb language sql stable security invoker set search_path = ''
as $function$
  select outbox.get_target_readiness_projection_health_impl()
$function$;

revoke all on function api.claim_target_readiness_projection_v1(),
  api.load_target_readiness_projection_v1(uuid, uuid),
  api.complete_target_readiness_projection_v1(uuid, uuid, bigint, jsonb),
  api.fail_target_readiness_projection_v1(uuid, uuid, text, text),
  api.get_target_readiness_projection_health_v1()
  from public, anon, authenticated, service_role;
grant execute on function api.claim_target_readiness_projection_v1(),
  api.load_target_readiness_projection_v1(uuid, uuid),
  api.complete_target_readiness_projection_v1(uuid, uuid, bigint, jsonb),
  api.fail_target_readiness_projection_v1(uuid, uuid, text, text),
  api.get_target_readiness_projection_health_v1()
  to service_role;

revoke create on schema targets, outbox from pando_readiness_worker;
do $migration_role_membership$
begin
  execute pg_catalog.format('revoke pando_readiness_worker from %I', current_user);
end
$migration_role_membership$;
