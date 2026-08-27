-- Identity-owned bounded query for Review calendar semantics.

do $migration_role_membership$
begin
  execute pg_catalog.format(
    'grant pando_identity_api, pando_review_api to %I with set true',
    current_user
  );
end
$migration_role_membership$;

grant create on schema identity to pando_identity_api;

create function identity.current_review_time_zone_v1()
returns text
language sql
stable
security definer
set search_path = ''
as $function$
  select workspace.time_zone
  from identity.workspaces as workspace
  where workspace.workspace_id = identity.personal_workspace_id_for_current_user()
$function$;

alter function identity.current_review_time_zone_v1() owner to pando_identity_api;
revoke all on function identity.current_review_time_zone_v1()
  from public, anon, authenticated, service_role;
grant execute on function identity.current_review_time_zone_v1() to pando_review_api;

revoke create on schema identity from pando_identity_api;
do $migration_role_membership$
begin
  execute pg_catalog.format(
    'revoke pando_identity_api, pando_review_api from %I',
    current_user
  );
end
$migration_role_membership$;
