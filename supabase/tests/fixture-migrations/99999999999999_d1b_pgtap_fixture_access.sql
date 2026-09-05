-- Scratch-project-only fixture access. The database gate copies this file after
-- production migrations; it is never part of the deployable migration tree.
do $fixture_role_membership$
begin
  execute pg_catalog.format(
    'grant pando_planning_api to %I with set true', current_user
  );
end
$fixture_role_membership$;

set role pando_planning_api;
grant execute on function
  planning.initialize_growth_plan_impl_v1(
    text, integer, integer, integer, integer, text
  ),
  planning.frame_named_fields_v1(text[], text[]),
  planning.derive_first_growth_plan_identity_v1(uuid, text, text, text),
  planning.build_first_growth_plan_preview_v1(
    uuid, jsonb, bigint, integer, integer, integer, text, text
  ),
  planning.derive_growth_plan_replacement_identity_v1(uuid, text, text, text),
  planning.plan_replaced_event_payload_v1_is_valid(jsonb)
  to postgres;
reset role;

-- Historical Planning fixtures still need to construct attributed activities after the runtime
-- v1 mutation is retired. This scratch-only wrapper preserves their setup semantics without
-- reopening a production bypass around preview/confirmation.
create schema pando_test authorization pando_planning_api;
grant usage on schema pando_test to authenticated;
create function pando_test.add_learning_track_activity_fixture_v1(
  p_learning_track_key text,
  p_activity_key text,
  p_estimated_minutes integer,
  p_expected_learning_track_version text,
  p_idempotency_key text,
  p_energy text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if p_expected_learning_track_version is null
     or p_expected_learning_track_version !~ '^[1-9][0-9]{0,18}$'
     or p_expected_learning_track_version::numeric > 9223372036854775807 then
    raise exception using errcode = '22023', message = 'expected Learning Track version is invalid';
  end if;
  return planning.add_learning_track_activity_impl_v1(
    p_learning_track_key, p_activity_key, p_estimated_minutes, p_energy,
    p_expected_learning_track_version::bigint, p_idempotency_key
  );
end
$function$;
alter function pando_test.add_learning_track_activity_fixture_v1(
  text, text, integer, text, text, text
) owner to pando_planning_api;
revoke all on function pando_test.add_learning_track_activity_fixture_v1(
  text, text, integer, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function pando_test.add_learning_track_activity_fixture_v1(
  text, text, integer, text, text, text
) to authenticated;

-- The accepted D1b concurrency proof needs a scratch-only stand-in for the
-- future Targets lifecycle writer. Its table trigger is the production lock
-- boundary under test; no runtime role receives this UPDATE path in production.
grant update (lifecycle, aggregate_version)
  on table targets.readiness_goals to pando_phase1_api;
create policy d1b_fixture_readiness_goal_update
on targets.readiness_goals
for update to pando_phase1_api
using (identity.is_workspace_member(workspace_id))
with check (identity.is_workspace_member(workspace_id));

do $fixture_role_membership$
begin
  execute pg_catalog.format(
    'revoke pando_planning_api from %I', current_user
  );
end
$fixture_role_membership$;

-- D4 Interview Campaign pgTAP proofs call these private Targets helpers directly to verify
-- deterministic identity derivation and event-payload validation, exactly as the accepted D3a
-- fixture above does for Planning's replacement identity helper.
do $fixture_role_membership$
begin
  execute pg_catalog.format(
    'grant pando_phase1_api to %I with set true', current_user
  );
end
$fixture_role_membership$;

set role pando_phase1_api;
grant execute on function
  targets.frame_named_fields_v1(text[], text[]),
  targets.derive_campaign_identity_v1(uuid, text, text, text),
  targets.local_timestamp_to_instant_v1(timestamp, text),
  targets.campaign_created_event_payload_v1_is_valid(jsonb),
  targets.campaign_lifecycle_event_payload_v1_is_valid(jsonb),
  targets.campaign_deadline_changed_event_payload_v1_is_valid(jsonb),
  targets.campaign_retargeted_event_payload_v1_is_valid(jsonb)
  to postgres;
reset role;

do $fixture_role_membership$
begin
  execute pg_catalog.format(
    'revoke pando_phase1_api from %I', current_user
  );
end
$fixture_role_membership$;

-- D5 allocation-override pgTAP proofs call these private Planning helpers directly, exactly as
-- the accepted D3a/D4 fixtures above do for their own identity and event-payload helpers.
do $fixture_role_membership$
begin
  execute pg_catalog.format(
    'grant pando_planning_api to %I with set true', current_user
  );
end
$fixture_role_membership$;

set role pando_planning_api;
grant execute on function
  planning.derive_campaign_allocation_override_identity_v1(uuid, text, text, text),
  planning.campaign_allocation_override_changed_event_payload_v1_is_valid(jsonb)
  to postgres;
reset role;

do $fixture_role_membership$
begin
  execute pg_catalog.format(
    'revoke pando_planning_api from %I', current_user
  );
end
$fixture_role_membership$;
