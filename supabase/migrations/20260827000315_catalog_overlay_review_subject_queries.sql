-- Purpose-specific owner queries used by Review to resolve a reminder subject.

do $migration_role_membership$
begin
  execute pg_catalog.format('grant pando_phase1_api to %I with set true', current_user);
end
$migration_role_membership$;

grant create on schema catalog, overlay to pando_phase1_api;
grant usage on schema catalog, overlay to pando_review_api;

create function catalog.review_competency_exists_v1(p_competency_ref text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from catalog.items as item
    join catalog.catalog_versions as version
      on version.catalog_version_id = item.catalog_version_id
    where item.item_key = p_competency_ref
      and item.item_type = 'COMPETENCY'
      and item.lifecycle = 'active'
      and version.lifecycle in ('published', 'retired')
  )
$function$;

create function overlay.review_personal_competency_exists_v1(
  p_workspace_id uuid,
  p_competency_ref text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from overlay.personal_competencies as competency
    where competency.workspace_id = p_workspace_id
      and competency.competency_key = p_competency_ref
      and competency.lifecycle = 'accepted'
  )
$function$;

alter function catalog.review_competency_exists_v1(text) owner to pando_phase1_api;
alter function overlay.review_personal_competency_exists_v1(uuid, text)
  owner to pando_phase1_api;
revoke all on function catalog.review_competency_exists_v1(text),
  overlay.review_personal_competency_exists_v1(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function catalog.review_competency_exists_v1(text),
  overlay.review_personal_competency_exists_v1(uuid, text)
  to pando_review_api;

revoke create on schema catalog, overlay from pando_phase1_api;
do $migration_role_membership$
begin
  execute pg_catalog.format('revoke pando_phase1_api from %I', current_user);
end
$migration_role_membership$;
