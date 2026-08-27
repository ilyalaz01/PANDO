-- Mastery-owned bounded signal for Review and atomic Mastery -> Review delivery wiring.

do $migration_role_membership$
begin
  execute pg_catalog.format(
    'grant pando_mastery_worker, pando_review_worker to %I with set true',
    current_user
  );
end
$migration_role_membership$;

grant create on schema mastery to pando_mastery_worker;
grant create on schema outbox to pando_review_worker;

create function mastery.get_review_signals_v1(
  p_workspace_id uuid,
  p_competency_ref text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  if p_workspace_id is null
     or p_competency_ref is null
     or p_competency_ref !~ '^competency:[a-z0-9][a-z0-9-]{1,100}$' then
    raise exception using errcode = '22023', message = 'mastery review signal identity is invalid';
  end if;

  select pg_catalog.jsonb_build_object(
    'snapshotId', current_state.snapshot_id,
    'inputWatermark', current_state.input_watermark::text,
    'projectionVersion', current_state.projection_version::text,
    'competencyRef', current_state.competency_ref,
    'dimensions', coalesce(dimension_rows.value, '[]'::jsonb)
  )
  into v_result
  from mastery.current_competency_states as current_state
  join mastery.competency_state_snapshots as snapshot
    on snapshot.workspace_id = current_state.workspace_id
   and snapshot.competency_ref = current_state.competency_ref
   and snapshot.snapshot_id = current_state.snapshot_id
  cross join lateral (
    select pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'dimension', dimension.key,
        'achievementLevel', dimension.value->>'achievementLevel',
        'firstQualifyingSuccessAt', pg_catalog.date_trunc('milliseconds', anchors.first_success_at),
        'latestQualifyingSuccessAt', pg_catalog.date_trunc(
          'milliseconds', anchors.latest_success_at
        ),
        'latestSupportingEvidenceId', latest.evidence_id,
        'focus', case when latest.evidence_id is null then null else
          pg_catalog.jsonb_build_object(
            'readinessGoalKey', latest.readiness_goal_key,
            'activityKey', latest.activity_key,
            'activityTitle', latest.activity_title
          )
        end
      ) order by case dimension.key
        when 'KNOWLEDGE' then 1
        when 'RECALL' then 2
        when 'APPLICATION' then 3
        when 'INTERVIEW_EXECUTION' then 4
        else 5
      end
    ) as value
    from pg_catalog.jsonb_each(snapshot.state->'dimensions') as dimension(key, value)
    left join lateral (
      select min(observation.occurred_at) as first_success_at,
        max(observation.occurred_at) as latest_success_at
      from evidence.observations as observation
       where observation.workspace_id = current_state.workspace_id
         and observation.competency_ref = current_state.competency_ref
         and observation.dimension = dimension.key
         and observation.outcome = 'SUCCESS'
         and (
           observation.engagement <> 'PASSIVE'
           or observation.dimension = 'KNOWLEDGE'
         )
         and exists (
          select 1
          from pg_catalog.jsonb_array_elements_text(
            dimension.value->'supportingEvidenceIds'
          ) as supporting(evidence_id)
          where supporting.evidence_id = observation.evidence_id::text
        )
    ) as anchors on true
    left join lateral (
      select observation.evidence_id,
        attempt.readiness_goal_key,
        attempt.activity_key,
        attempt.activity_title
      from evidence.observations as observation
      join evidence.activity_attempts as attempt
        on attempt.workspace_id = observation.workspace_id
       and attempt.activity_attempt_id = observation.activity_attempt_id
       where observation.workspace_id = current_state.workspace_id
         and observation.competency_ref = current_state.competency_ref
         and observation.dimension = dimension.key
         and observation.outcome = 'SUCCESS'
         and (
           observation.engagement <> 'PASSIVE'
           or observation.dimension = 'KNOWLEDGE'
         )
         and exists (
          select 1
          from pg_catalog.jsonb_array_elements_text(
            dimension.value->'supportingEvidenceIds'
          ) as supporting(evidence_id)
          where supporting.evidence_id = observation.evidence_id::text
        )
      order by observation.occurred_at desc, observation.evidence_id desc
      limit 1
    ) as latest on true
  ) as dimension_rows
  where current_state.workspace_id = p_workspace_id
    and current_state.competency_ref = p_competency_ref;

  return v_result;
end
$function$;

create function outbox.enqueue_review_mastery_delivery()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  insert into outbox.deliveries (
    event_id, workspace_id, consumer_name, handler_contract_version
  ) values (
    new.event_id, new.workspace_id, 'review.item_projection_v1', 1
  ) on conflict (event_id, consumer_name, handler_contract_version) do nothing;
  return new;
end
$function$;

create trigger enqueue_review_after_mastery_change
after insert on outbox.events
for each row
when (
  new.event_name = 'mastery.competency_state_changed'
  and new.event_schema_version = 1
)
execute function outbox.enqueue_review_mastery_delivery();

-- The Phase 2 producer predates Review. Its historical events are safe to replay because the
-- delivery key and Review source revisions are idempotent.
insert into outbox.deliveries (
  event_id, workspace_id, consumer_name, handler_contract_version
)
select event.event_id, event.workspace_id, 'review.item_projection_v1', 1
from outbox.events as event
where event.event_name = 'mastery.competency_state_changed'
  and event.event_schema_version = 1
on conflict (event_id, consumer_name, handler_contract_version) do nothing;

alter function mastery.get_review_signals_v1(uuid, text) owner to pando_mastery_worker;
alter function outbox.enqueue_review_mastery_delivery() owner to pando_review_worker;

revoke all on function mastery.get_review_signals_v1(uuid, text),
  outbox.enqueue_review_mastery_delivery()
  from public, anon, authenticated, service_role;
grant execute on function mastery.get_review_signals_v1(uuid, text) to pando_review_worker;

revoke create on schema mastery from pando_mastery_worker;
revoke create on schema outbox from pando_review_worker;
do $migration_role_membership$
begin
  execute pg_catalog.format(
    'revoke pando_mastery_worker, pando_review_worker from %I',
    current_user
  );
end
$migration_role_membership$;
