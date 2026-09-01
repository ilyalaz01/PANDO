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
  )
  to postgres;
reset role;

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
