-- Phase 0 database boundary: private bounded-context schemas and narrow
-- SECURITY DEFINER owner roles. The api schema is the only PANDO schema
-- configured for PostgREST exposure.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

do $roles$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'pando_rls_authorizer') then
    execute 'create role pando_rls_authorizer nologin noinherit bypassrls';
  end if;

  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'pando_identity_api') then
    execute 'create role pando_identity_api nologin noinherit nobypassrls';
  end if;

  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'pando_outbox_worker') then
    execute 'create role pando_outbox_worker nologin noinherit nobypassrls';
  end if;
end
$roles$;

create schema if not exists api;
create schema if not exists identity;
create schema if not exists catalog;
create schema if not exists targets;
create schema if not exists overlay;
create schema if not exists sessions;
create schema if not exists evidence;
create schema if not exists mastery;
create schema if not exists review;
create schema if not exists planning;
create schema if not exists integrations;
create schema if not exists outbox;

revoke all on schema api from public, anon, authenticated;
revoke all on schema identity from public, anon, authenticated;
revoke all on schema catalog from public, anon, authenticated;
revoke all on schema targets from public, anon, authenticated;
revoke all on schema overlay from public, anon, authenticated;
revoke all on schema sessions from public, anon, authenticated;
revoke all on schema evidence from public, anon, authenticated;
revoke all on schema mastery from public, anon, authenticated;
revoke all on schema review from public, anon, authenticated;
revoke all on schema planning from public, anon, authenticated;
revoke all on schema integrations from public, anon, authenticated;
revoke all on schema outbox from public, anon, authenticated;

revoke create on schema public from public;

do $default_privileges$
declare
  private_schema text;
begin
  foreach private_schema in array array[
    'api',
    'identity',
    'catalog',
    'targets',
    'overlay',
    'sessions',
    'evidence',
    'mastery',
    'review',
    'planning',
    'integrations',
    'outbox'
  ]
  loop
    execute pg_catalog.format(
      'alter default privileges in schema %I revoke all on tables from public, anon, authenticated, service_role',
      private_schema
    );
    execute pg_catalog.format(
      'alter default privileges in schema %I revoke all on sequences from public, anon, authenticated, service_role',
      private_schema
    );
    execute pg_catalog.format(
      'alter default privileges in schema %I revoke all on functions from public, anon, authenticated, service_role',
      private_schema
    );
  end loop;
end
$default_privileges$;

grant usage on schema api to authenticated, service_role;
grant usage on schema extensions to pando_identity_api;
grant execute on function extensions.digest(bytea, text) to pando_identity_api;
