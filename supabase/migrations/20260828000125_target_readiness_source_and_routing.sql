-- Mastery-owned synchronized calculation source and fixed readiness delivery routing.

do $migration_role_membership$
begin
  execute pg_catalog.format(
    'grant pando_mastery_worker, pando_readiness_worker to %I with set true',
    current_user
  );
end
$migration_role_membership$;

grant create on schema mastery to pando_mastery_worker;

create function mastery.get_readiness_calculation_source_v1(
  p_workspace_id uuid,
  p_competency_refs text[],
  p_source_evidence_watermark bigint
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_current_watermark bigint;
  v_source_watermark bigint;
  v_max_competency_evidence bigint;
  v_total_evidence bigint;
  v_competencies jsonb;
begin
  if p_workspace_id is null
     or p_competency_refs is null
     or cardinality(p_competency_refs) > 250
     or array_position(p_competency_refs, null) is not null
     or exists (
       select 1 from unnest(p_competency_refs) as competency(value)
       where competency.value !~ '^competency:[a-z0-9][a-z0-9-]{1,100}$'
     )
     or exists (
       select 1 from unnest(p_competency_refs) as competency(value)
       group by competency.value having count(*) > 1
     )
     or (p_source_evidence_watermark is not null
       and p_source_evidence_watermark < 0) then
    raise exception using errcode = '22023',
      message = 'Mastery readiness source identity is invalid';
  end if;

  select coalesce(ledger.ledger_version, 0)
  into v_current_watermark
  from (select 1) as singleton
  left join evidence.subject_ledgers as ledger
    on ledger.workspace_id = p_workspace_id;
  if p_source_evidence_watermark is not null
     and v_current_watermark <> p_source_evidence_watermark then
    raise exception using errcode = '40001',
      message = 'readiness Evidence watermark changed';
  end if;
  v_source_watermark := coalesce(p_source_evidence_watermark, v_current_watermark);

  -- Reject an unsupported ledger before constructing its JSON body. These limits mirror the
  -- application decoder and deliberately do not truncate deterministic calculation inputs.
  select coalesce(max(counts.evidence_count), 0),
    coalesce(sum(counts.evidence_count), 0)
  into v_max_competency_evidence, v_total_evidence
  from (
    select observation.competency_ref, count(*)::bigint as evidence_count
    from evidence.observations as observation
    where observation.workspace_id = p_workspace_id
      and observation.competency_ref = any(p_competency_refs)
      and observation.ledger_version <= v_source_watermark
    group by observation.competency_ref
  ) as counts;
  if v_max_competency_evidence > 10000 or v_total_evidence > 50000 then
    raise exception using errcode = '54000',
      message = 'Mastery readiness source exceeds the supported evidence envelope';
  end if;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'competencyRef', competency.value,
    'evidence', coalesce(evidence_rows.value, '[]'::jsonb)
  ) order by competency.value collate "C"), '[]'::jsonb)
  into v_competencies
  from unnest(p_competency_refs) as competency(value)
  left join lateral (
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'evidenceId', observation.evidence_id,
      'attemptId', observation.activity_attempt_id,
      'sourceId', observation.source_id,
      'occurredAt', pg_catalog.date_trunc('milliseconds', observation.occurred_at),
      'dimension', observation.dimension,
      'outcome', observation.outcome,
      'engagement', observation.engagement,
      'normalized', observation.normalized,
      'invalidated', correction.correction_id is not null,
      'observedResult', observation.observed_result,
      'mappingConfidence', observation.mapping_confidence,
      'sourceReliability', observation.source_reliability,
      'targetRelevant', observation.target_relevant
    ) order by observation.occurred_at, observation.evidence_id) as value
    from evidence.observations as observation
    left join evidence.corrections as correction
      on correction.workspace_id = observation.workspace_id
     and correction.evidence_id = observation.evidence_id
     and correction.ledger_version <= v_source_watermark
    where observation.workspace_id = p_workspace_id
      and observation.competency_ref = competency.value
      and observation.ledger_version <= v_source_watermark
  ) as evidence_rows on true;

  return pg_catalog.jsonb_build_object(
    'contract', pg_catalog.jsonb_build_object(
      'name', 'MasteryReadinessCalculationSourceV1', 'version', '1.0.0'
    ),
    'sourceEvidenceWatermark', v_source_watermark::text,
    'masteryEngineVersion', 'mastery-engine/0.1.0',
    'masteryPolicyVersion', 'mastery-readiness-policy/0.1',
    'competencies', v_competencies
  );
end
$function$;

-- Older releases did not enforce the worker's workspace-wide active-goal envelope. Refuse an
-- unsafe upgrade before creating any readiness delivery; never silently truncate or rewrite the
-- user's pre-existing goals during a projection migration.
do $active_readiness_upgrade_preflight$
begin
  if exists (
    select 1
    from targets.readiness_goals as goal
    cross join lateral (
      select count(*)::bigint as leaf_count
      from (
        select member.node_ref, member.objective_dimension, member.required_level
        from targets.target_requirement_members as member
        where member.profile_version_id = goal.profile_version_id
          and member.member_type = 'NODE'
          and member.node_kind = 'COMPETENCY'
        group by member.node_ref, member.objective_dimension, member.required_level
      ) as unique_leaf
    ) as per_goal
    where goal.lifecycle = 'active'
    group by goal.workspace_id
    having count(*) > 20 or coalesce(sum(per_goal.leaf_count), 0) > 250
  ) then
    raise exception using errcode = '54000',
      message = 'pre-existing active readiness workload exceeds the Phase 3B envelope';
  end if;
end
$active_readiness_upgrade_preflight$;

-- Backfill historical wake-ups. The delivery identity makes this repeatable.
insert into outbox.deliveries (
  event_id, workspace_id, consumer_name, handler_contract_version
)
select event.event_id, event.workspace_id, 'targets.readiness_projection_v1', 1
from outbox.events as event
where (
  event.event_name = 'targets.readiness_goal_created'
  or event.event_name = 'mastery.competency_state_changed'
)
and event.event_schema_version = 1
on conflict (event_id, consumer_name, handler_contract_version) do nothing;

alter function mastery.get_readiness_calculation_source_v1(uuid, text[], bigint)
  owner to pando_mastery_worker;

revoke all on function mastery.get_readiness_calculation_source_v1(uuid, text[], bigint)
  from public, anon, authenticated, service_role;
grant execute on function mastery.get_readiness_calculation_source_v1(uuid, text[], bigint)
  to pando_readiness_worker;

revoke create on schema mastery from pando_mastery_worker;
do $migration_role_membership$
begin
  execute pg_catalog.format(
    'revoke pando_mastery_worker, pando_readiness_worker from %I',
    current_user
  );
end
$migration_role_membership$;
