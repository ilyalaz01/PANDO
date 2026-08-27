-- Keep the existing authenticated personal-workspace contract and ownership unchanged while
-- making its current-user dependency explicit before the RLS-protected membership query. This
-- avoids evaluating a SECURITY DEFINER helper call inside that query's forced-RLS planning path.

create or replace function identity.get_current_personal_workspace_impl()
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
  v_current_user_id uuid;
begin
  if identity.jwt_subject() is null then
    raise exception using
      errcode = '28000',
      message = 'an authenticated user is required';
  end if;

  v_current_user_id := identity.current_user_id();
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
    and membership.user_id = v_current_user_id;

  return pg_catalog.jsonb_build_object(
    'workspaceId', v_workspace_id,
    'workspaceKind', v_workspace_kind,
    'displayName', v_display_name,
    'membershipRole', v_membership_role
  );
end
$function$;
