-- Evidence-owned immutable activity provenance needed by Mastery's bounded Review signal.

do $migration_role_membership$
begin
  execute pg_catalog.format(
    'grant pando_phase2_api, pando_mastery_worker to %I with set true',
    current_user
  );
end
$migration_role_membership$;

grant create on schema evidence to pando_phase2_api;

alter table evidence.activity_attempts add column readiness_goal_key text;
update evidence.activity_attempts as attempt
set readiness_goal_key = session.readiness_goal_key
from sessions.focus_sessions as session
where session.workspace_id = attempt.workspace_id
  and session.focus_session_id = attempt.focus_session_id;
alter table evidence.activity_attempts
  alter column readiness_goal_key set not null,
  add constraint activity_attempts_readiness_goal_key_check check (
    readiness_goal_key ~ '^goal:[a-z0-9][a-z0-9-]{1,100}$'
  );

create function evidence.derive_attempt_readiness_goal_key()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  select session.readiness_goal_key into strict new.readiness_goal_key
  from sessions.focus_sessions as session
  where session.workspace_id = new.workspace_id
    and session.focus_session_id = new.focus_session_id;
  return new;
end
$function$;

create trigger derive_attempt_readiness_goal_key
before insert or update of workspace_id, focus_session_id, readiness_goal_key
on evidence.activity_attempts
for each row execute function evidence.derive_attempt_readiness_goal_key();

grant select on evidence.activity_attempts to pando_mastery_worker;
create policy review_signal_attempts_mastery_read on evidence.activity_attempts
for select to pando_mastery_worker using (true);

alter function evidence.derive_attempt_readiness_goal_key() owner to pando_phase2_api;
revoke all on function evidence.derive_attempt_readiness_goal_key()
  from public, anon, authenticated, service_role;
revoke create on schema evidence from pando_phase2_api;

do $migration_role_membership$
begin
  execute pg_catalog.format(
    'revoke pando_phase2_api, pando_mastery_worker from %I',
    current_user
  );
end
$migration_role_membership$;
