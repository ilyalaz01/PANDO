-- Once-per-minute recovery wake-up for the fixed Planning snapshot worker. Deployment activates
-- the Cron job only after the app URL and internal dispatch secret exist in Vault.

do $roles$
begin
  if not exists (
    select 1 from pg_catalog.pg_roles where rolname = 'pando_planning_scheduler'
  ) then
    execute 'create role pando_planning_scheduler nologin noinherit nobypassrls';
  end if;
  execute pg_catalog.format('grant pando_planning_scheduler to %I with set true', current_user);
end
$roles$;

grant usage on schema vault, net to pando_planning_scheduler;
grant usage, create on schema outbox to pando_planning_scheduler;
grant select on vault.decrypted_secrets to pando_planning_scheduler;
grant execute on all functions in schema net to pando_planning_scheduler;

create function outbox.invoke_plan_snapshot_projection_recovery_impl()
returns bigint
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_app_base_url text;
  v_dispatch_secret text;
  v_request_id bigint;
begin
  select secret.decrypted_secret into strict v_app_base_url
  from vault.decrypted_secrets as secret where secret.name = 'pando_app_base_url';
  select secret.decrypted_secret into strict v_dispatch_secret
  from vault.decrypted_secrets as secret where secret.name = 'pando_internal_dispatch_secret';
  if v_app_base_url !~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?$'
     or right(v_app_base_url, 1) = '/'
     or char_length(v_dispatch_secret) < 32
     or v_dispatch_secret <> btrim(v_dispatch_secret) then
    raise exception using errcode = '22023',
      message = 'Planning snapshot recovery Vault configuration is invalid';
  end if;
  select net.http_post(
    url := v_app_base_url || '/api/internal/planning-snapshot',
    headers := pg_catalog.jsonb_build_object(
      'Authorization', 'Bearer ' || v_dispatch_secret,
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  ) into v_request_id;
  return v_request_id;
exception
  when no_data_found then
    raise exception using errcode = '22023',
      message = 'Planning snapshot recovery Vault secrets are missing';
  when too_many_rows then
    raise exception using errcode = '22023',
      message = 'Planning snapshot recovery Vault secrets are ambiguous';
end
$function$;

create function outbox.configure_plan_snapshot_projection_recovery_impl()
returns bigint
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_app_base_url text;
  v_dispatch_secret text;
  v_job_id bigint;
begin
  select secret.decrypted_secret into strict v_app_base_url
  from vault.decrypted_secrets as secret where secret.name = 'pando_app_base_url';
  select secret.decrypted_secret into strict v_dispatch_secret
  from vault.decrypted_secrets as secret where secret.name = 'pando_internal_dispatch_secret';
  if v_app_base_url !~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?$'
     or right(v_app_base_url, 1) = '/'
     or char_length(v_dispatch_secret) < 32
     or v_dispatch_secret <> btrim(v_dispatch_secret) then
    raise exception using errcode = '22023',
      message = 'Planning snapshot recovery Vault configuration is invalid';
  end if;
  select cron.schedule(
    'pando-plan-snapshot-projection-recovery-v1',
    '* * * * *',
    'select outbox.invoke_plan_snapshot_projection_recovery_impl();'
  ) into v_job_id;
  return v_job_id;
exception
  when no_data_found then
    raise exception using errcode = '22023',
      message = 'Planning snapshot recovery Vault secrets are missing';
  when too_many_rows then
    raise exception using errcode = '22023',
      message = 'Planning snapshot recovery Vault secrets are ambiguous';
end
$function$;

alter function outbox.invoke_plan_snapshot_projection_recovery_impl()
  owner to pando_planning_scheduler;
revoke create on schema outbox from pando_planning_scheduler;
revoke all on function outbox.invoke_plan_snapshot_projection_recovery_impl(),
  outbox.configure_plan_snapshot_projection_recovery_impl()
  from public, anon, authenticated, service_role;
comment on function outbox.configure_plan_snapshot_projection_recovery_impl() is
  'Deployment-only activation after pando_app_base_url and pando_internal_dispatch_secret exist in Supabase Vault.';

do $roles$
begin
  execute pg_catalog.format('revoke pando_planning_scheduler from %I', current_user);
end
$roles$;
