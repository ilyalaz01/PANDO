-- Keep the released activity-admission contract while removing direct access to its implementation.

do $migration_role_membership$
begin
  execute pg_catalog.format('grant pando_planning_api to %I with set true', current_user);
end
$migration_role_membership$;

grant usage on schema api to pando_planning_api;

set role pando_planning_api;

alter function api.add_learning_track_activity_v1(
  text, text, integer, text, text, text
) security definer;
alter function api.add_learning_track_activity_v1(
  text, text, integer, text, text, text
) set search_path = '';

revoke all on function planning.add_learning_track_activity_impl_v1(
  text, text, integer, text, bigint, text
) from public, anon, authenticated, service_role;
revoke all on function api.add_learning_track_activity_v1(
  text, text, integer, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function api.add_learning_track_activity_v1(
  text, text, integer, text, text, text
) to authenticated;

reset role;

revoke usage on schema api from pando_planning_api;

do $migration_role_membership$
begin
  execute pg_catalog.format('revoke pando_planning_api from %I', current_user);
end
$migration_role_membership$;
