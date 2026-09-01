begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
create temporary table d1b_legacy_initializer_fixture_marker(marker boolean);
create function pg_temp.initialize_growth_plan_fixture_v1(
  p_readiness_goal_key text,
  p_weekly_capacity_minutes integer,
  p_default_session_minutes integer,
  p_track_priority integer,
  p_protected_minimum_minutes integer,
  p_idempotency_key text
)
returns jsonb
language sql
security definer
set search_path = ''
as $function$
  select api.initialize_growth_plan_v1(
    p_readiness_goal_key, p_weekly_capacity_minutes, p_default_session_minutes,
    p_track_priority, p_protected_minimum_minutes, p_idempotency_key
  )
$function$;
revoke all on function pg_temp.initialize_growth_plan_fixture_v1(
  text, integer, integer, integer, integer, text
) from public, anon, authenticated, service_role;
grant execute on function pg_temp.initialize_growth_plan_fixture_v1(
  text, integer, integer, integer, integer, text
) to authenticated;
select no_plan();

-- Schema, ownership, grants, and FORCE RLS are release invariants rather than implementation detail.
select has_table('review', expected.table_name, format('review.%s exists', expected.table_name))
from unnest(array[
  'subject_ledgers',
  'reason_sources',
  'reason_source_events',
  'action_events',
  'item_snapshots',
  'items',
  'item_reasons'
]) as expected(table_name);

select ok(
  class.relrowsecurity and class.relforcerowsecurity,
  format('review.%s has enabled and forced RLS', class.relname)
)
from pg_catalog.pg_class as class
join pg_catalog.pg_namespace as namespace on namespace.oid = class.relnamespace
where namespace.nspname = 'review'
  and class.relname in (
    'subject_ledgers', 'reason_sources', 'reason_source_events', 'action_events',
    'item_snapshots', 'items', 'item_reasons'
  )
order by class.relname;

select ok(
  not pg_catalog.has_table_privilege(
    caller.role_name, pg_catalog.format('review.%I', expected.table_name), privilege.name
  ),
  format('%s has no direct %s on review.%s', caller.role_name, privilege.name, expected.table_name)
)
from unnest(array['authenticated', 'anon', 'service_role']) as caller(role_name)
cross join unnest(array[
  'subject_ledgers', 'reason_sources', 'reason_source_events', 'action_events',
  'item_snapshots', 'items', 'item_reasons'
]) as expected(table_name)
cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as privilege(name)
order by caller.role_name, expected.table_name, privilege.name;

select ok(
  role.rolname is not null and not role.rolcanlogin and not role.rolinherit
    and not role.rolbypassrls,
  format('%s is NOLOGIN/NOINHERIT/NOBYPASSRLS', expected.role_name)
)
from unnest(array['pando_review_api', 'pando_review_worker']) as expected(role_name)
left join pg_catalog.pg_roles as role on role.rolname = expected.role_name;

select ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'api.create_personal_review_reminder_v1(text,text,text,bigint,text)',
    'EXECUTE'
  ),
  'authenticated can execute the purpose-specific personal reminder command'
);
select ok(
  pg_catalog.has_function_privilege(
    'service_role', 'api.claim_review_item_projection_v1()', 'EXECUTE'
  ) and not pg_catalog.has_function_privilege(
    'authenticated', 'api.claim_review_item_projection_v1()', 'EXECUTE'
  ),
  'only the service worker can execute the fixed Review claim RPC'
);
select ok(
  pg_catalog.has_function_privilege(
    'postgres', 'identity.is_known_time_zone(text)', 'EXECUTE'
  )
    and not pg_catalog.has_function_privilege(
      'authenticated', 'identity.is_known_time_zone(text)', 'EXECUTE'
    )
    and not pg_catalog.has_function_privilege(
      'service_role', 'identity.is_known_time_zone(text)', 'EXECUTE'
    ),
  'only the logical-restore role can evaluate the private time-zone CHECK helper'
);

-- Two real authenticated identities prove that every public query and command derives tenancy.
insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    '24000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
    'review-alice@pando.test', '', clock_timestamp(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    clock_timestamp(), clock_timestamp()
  ),
  (
    '24000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
    'review-bob@pando.test', '', clock_timestamp(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    clock_timestamp(), clock_timestamp()
  );

create temporary table review_results (
  result_name text primary key,
  response jsonb not null
);
grant select, insert, update on review_results to authenticated, service_role;

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '24000000-0000-4000-8000-000000000001',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text, true
);
set local role authenticated;
insert into review_results values (
  'alice-bootstrap', api.bootstrap_personal_workspace('phase3a-review-alice', 'Review Alice')
);
insert into review_results
select 'alice-goal', api.create_readiness_goal(
  (response->>'workspace_id')::uuid,
  'goal:review-alice', 'Review Alice goal',
  'target:nvidia-python-verification-base-v1', 'phase3a-review-alice-goal'
) from review_results where result_name = 'alice-bootstrap';
insert into review_results values (
  'alice-plan', pg_temp.initialize_growth_plan_fixture_v1(
    'goal:review-alice', 300, 25, 80, 60, 'phase3a-review-alice-plan'
  )
);
reset role;

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '24000000-0000-4000-8000-000000000002',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text, true
);
set local role authenticated;
insert into review_results values (
  'bob-bootstrap', api.bootstrap_personal_workspace('phase3a-review-bob', 'Review Bob')
);
reset role;

create temporary table review_workspaces as
select result_name, (response->>'workspace_id')::uuid as workspace_id
from review_results where result_name in ('alice-bootstrap', 'bob-bootstrap');
grant select on review_workspaces to authenticated, service_role;

create temporary table review_due_inputs as
with local_clock as (
  select clock_timestamp() at time zone 'UTC' as local_now
)
select
  pg_catalog.to_char(
    local_now + (
      pg_catalog.date_trunc('day', local_now) + interval '1 day' - local_now
    ) / 2.0,
    'YYYY-MM-DD"T"HH24:MI:SS'
  ) as alice_due_today,
  pg_catalog.to_char(
    pg_catalog.date_trunc('day', local_now) + interval '2 days 12 hours',
    'YYYY-MM-DD"T"HH24:MI:SS'
  ) as alice_future_reminder,
  pg_catalog.to_char(
    pg_catalog.date_trunc('day', local_now) + interval '3 days 12 hours',
    'YYYY-MM-DD"T"HH24:MI:SS'
  ) as alice_reschedule,
  pg_catalog.to_char(
    pg_catalog.date_trunc('day', local_now) + interval '4 days 12 hours',
    'YYYY-MM-DD"T"HH24:MI:SS'
  ) as alice_changed_reschedule,
  '2024-03-10T01:30:00'::text as bob_dst_boundary
from local_clock;

set local role service_role;
select throws_ok(
  $$select review.local_timestamp_to_instant_v1(
    '2026-03-08 02:30:00'::timestamp, 'America/New_York'
  )$$,
  '22023', 'review local due time does not exist in the workspace time zone',
  'the Review time boundary rejects a spring-forward gap'
);
select throws_ok(
  $$select review.local_timestamp_to_instant_v1(
    '2026-11-01 01:30:00'::timestamp, 'America/New_York'
  )$$,
  '22023', 'review local due time is ambiguous in the workspace time zone',
  'the Review time boundary rejects an unqualified fall-back fold'
);
select is(
  review.calendar_day_to_instant_v1(
    '2026-03-08 02:30:00'::timestamp, 'America/New_York'
  ),
  '2026-03-08 07:30:00+00'::timestamptz,
  'the system calendar-day resolver deterministically normalizes a spring gap forward'
);
select is(
  review.calendar_day_to_instant_v1(
    '2026-11-01 01:30:00'::timestamp, 'America/New_York'
  ),
  '2026-11-01 06:30:00+00'::timestamptz,
  'the system calendar-day resolver deterministically chooses the later standard-time fold'
);
select is(
  review.calendar_day_to_instant_v1(
    '2026-03-08 09:30:00'::timestamp, 'America/New_York'
  ) - review.calendar_day_to_instant_v1(
    '2026-03-07 09:30:00'::timestamp, 'America/New_York'
  ),
  interval '23 hours',
  'one local calendar day across spring DST is exactly 23 UTC hours'
);
select is(
  review.calendar_day_to_instant_v1(
    '2026-11-01 09:30:00'::timestamp, 'America/New_York'
  ) - review.calendar_day_to_instant_v1(
    '2026-10-31 09:30:00'::timestamp, 'America/New_York'
  ),
  interval '25 hours',
  'one local calendar day across autumn DST is exactly 25 UTC hours'
);
select is(
  review.local_timestamp_to_instant_v1(
    '2026-07-15 09:30:00'::timestamp, 'America/New_York'
  ),
  '2026-07-15 13:30:00+00'::timestamptz,
  'the Review time boundary converts one unambiguous local instant exactly once'
);
reset role;
grant select on review_due_inputs to authenticated;

-- The same command returns the stored response; a changed hash and stale version both fail.
select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '24000000-0000-4000-8000-000000000001',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text, true
);
set local role authenticated;
insert into review_results
select 'alice-application', api.create_personal_review_reminder_v1(
  'competency:python-typing', 'APPLICATION', alice_due_today, 0,
  'phase3a-alice-application'
) from review_due_inputs;
insert into review_results
select 'alice-application-replay', api.create_personal_review_reminder_v1(
  'competency:python-typing', 'APPLICATION', alice_due_today, 0,
  'phase3a-alice-application'
) from review_due_inputs;
select throws_ok(
  pg_catalog.format(
    'select api.create_personal_review_reminder_v1(%L,%L,%L,0,%L)',
    'competency:invented-by-caller', 'APPLICATION',
    (select alice_future_reminder from review_due_inputs),
    'phase3a-invented-competency'
  ),
  '22023', 'review competency is not available',
  'a reminder subject must resolve through a Catalog or Overlay owner query'
);
select throws_ok(
  pg_catalog.format(
    'select api.create_personal_review_reminder_v1(%L,%L,%L,0,%L)',
    'competency:python-typing', 'APPLICATION',
    (select alice_changed_reschedule from review_due_inputs),
    'phase3a-alice-application'
  ),
  '22023', 'idempotency key reused with a different request',
  'a reused reminder key rejects a changed request hash'
);
select throws_ok(
  pg_catalog.format(
    'select api.create_personal_review_reminder_v1(%L,%L,%L,0,%L)',
    'competency:python-typing', 'APPLICATION',
    (select alice_due_today from review_due_inputs),
    'phase3a-alice-application-stale'
  ),
  '40001', 'review subject changed',
  'a new command with a stale expected subject version is rejected'
);
insert into review_results
select 'alice-recall', api.create_personal_review_reminder_v1(
  'competency:python-typing', 'RECALL', alice_future_reminder, 0,
  'phase3a-alice-recall'
) from review_due_inputs;
reset role;

select is(
  (select response from review_results where result_name = 'alice-application-replay'),
  (select response from review_results where result_name = 'alice-application'),
  'exact reminder replay returns the exact stored response'
);

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '24000000-0000-4000-8000-000000000002',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text, true
);
set local role authenticated;
insert into review_results
select 'bob-knowledge', api.create_personal_review_reminder_v1(
  'competency:python-typing', 'KNOWLEDGE', bob_dst_boundary, 0,
  'phase3a-bob-knowledge'
) from review_due_inputs;
reset role;

select is(
  (
    select bool_and(workspace.time_zone = 'UTC')
    from identity.workspaces as workspace
    join review_workspaces using (workspace_id)
  ),
  true,
  'new workspaces begin with the Identity-owned UTC time zone'
);

select is(
  (
    select source.base_due_at
    from review.reason_source_events as source
    join review_workspaces as workspace on workspace.workspace_id = source.workspace_id
    where workspace.result_name = 'bob-bootstrap'
  ),
  '2024-03-10 01:30:00+00'::timestamptz,
  'the Identity-owned local reminder time is converted exactly once to UTC'
);

select is(
  (select response->>'reasonId' from review_results where result_name = 'alice-application'),
  (
    select source.reason_id::text
    from review.reason_sources as source
    where source.workspace_id = (
      select workspace_id from review_workspaces where result_name = 'alice-bootstrap'
    ) and source.subject_id = (
      select (response->>'subjectId')::uuid from review_results
      where result_name = 'alice-application'
    ) and source.reason_type = 'PERSONAL_REMINDER'
  ),
  'the command response exposes the one persisted stable reason identity'
);

select throws_like(
  pg_catalog.format(
    'insert into review.reason_sources (
       reason_id, workspace_id, subject_id, source_key, source_kind, reason_type
     ) values (%L::uuid,%L::uuid,%L::uuid,%L,%L,%L)',
    '25000000-0000-4000-8000-000000000099',
    (select workspace_id from review_workspaces where result_name = 'alice-bootstrap'),
    (select response->>'subjectId' from review_results where result_name = 'alice-application'),
    'personal:duplicate:reminder', 'PERSONAL_REMINDER', 'PERSONAL_REMINDER'
  ),
  '%duplicate key value violates unique constraint%',
  'one stable reason identity exists per workspace, subject, and reason type'
);

-- A privacy-minimized Mastery event automatically acquires exactly one fixed Review delivery.
insert into outbox.events (
  event_id, event_name, event_schema_version, workspace_id,
  actor_type, actor_user_id, command_id, correlation_id, occurred_at, source, payload
)
select
  '25000000-0000-4000-8000-000000000001',
  'mastery.competency_state_changed', 1, receipt.workspace_id,
  'system', null, receipt.command_id, receipt.correlation_id, clock_timestamp(),
  'pando.mastery_worker',
  pg_catalog.jsonb_build_object(
    'competency_ref', 'competency:python-typing',
    'snapshot_id', '25000000-0000-4000-8000-000000000002',
    'projection_generation', 'live-v1',
    'input_watermark', '1',
    'achievement_level', 'COMPLETED',
    'engine_version', 'mastery-engine/0.1.0',
    'policy_version', 'mastery-readiness-policy/0.1',
    'calculated_as_of', clock_timestamp()
  )
from outbox.command_receipts as receipt
where receipt.idempotency_key = 'phase3a-review-alice';

select is(
  (
    select count(*) from outbox.deliveries
    where event_id = '25000000-0000-4000-8000-000000000001'
      and consumer_name = 'review.item_projection_v1'
      and handler_contract_version = 1
  ),
  1::bigint,
  'Mastery pointer-change event atomically creates one fixed Review delivery'
);

-- Materialize only the pure worker results for the three real reminder inputs.
create temporary table review_projection_inputs as
select subject.workspace_id, subject.subject_id, subject.subject_ref,
  pg_catalog.jsonb_build_object(
    'subjectId', subject.subject_id,
    'subjectRef', subject.subject_ref,
    'competencyRef', subject.competency_ref,
    'dimension', subject.dimension,
    'expectedInputWatermark', subject.input_watermark::text,
    'nextInputWatermark', subject.input_watermark::text,
    'masterySnapshotId', null,
    'masteryInputWatermark', null,
    'masteryProjectionVersion', null,
    'focus', null,
    'newSourceEvents', '[]'::jsonb,
    'state', pg_catalog.jsonb_build_object(
      'calculation', pg_catalog.jsonb_build_object(
        'engineVersion', 'review-engine/0.1.0',
        'policyVersion', 'review-policy/0.1',
        'inputWatermark', subject.input_watermark::text,
        'calculatedAsOf', pg_catalog.date_trunc('milliseconds', wake.recorded_at),
        'replayedEventIds', pg_catalog.jsonb_build_array(
          'effective:' || source.source_key || ':' ||
            source.source_revision::text || ':' || source.occurrence_id::text
        ),
        'item', pg_catalog.jsonb_build_object(
          'workspaceId', subject.workspace_id,
          'subjectId', subject.subject_id,
          'effectiveDueAt', source.base_due_at,
          'timing', case
            when source.base_due_at < wake.recorded_at then 'OVERDUE'
            when source.base_due_at = wake.recorded_at then 'DUE'
            else 'UPCOMING'
          end,
          'reasons', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
            'sourceKey', source.source_key,
            'sourceRevision', source.source_revision,
            'sourceEventId', 'effective:' || source.source_key || ':' ||
              source.source_revision::text || ':' || source.occurrence_id::text,
            'reason', source.reason_type,
            'dueAt', source.base_due_at
          ))
        ),
        'explanationCodes', pg_catalog.jsonb_build_array(
          'ONE_ITEM_PER_SUBJECT',
          'EARLIEST_ACTIVE_REASON_WINS',
          'SOURCE_REVISIONS_DEDUPLICATED'
        )
      ),
      'replayedSourceEventIds', pg_catalog.jsonb_build_array(source.source_event_id),
      'replayedActionIds', '[]'::jsonb,
      'reasons', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'reasonId', source.reason_id,
        'sourceKey', source.source_key,
        'sourceRevision', source.source_revision,
        'sourceKind', source.source_kind,
        'reason', source.reason_type,
        'occurrenceId', source.occurrence_id,
        'baseDueAt', source.base_due_at,
        'dueAt', source.base_due_at,
        'sourceActive', true,
        'suppressed', false,
        'active', true
      ))
    )
  ) as projection
from review.subject_ledgers as subject
join outbox.events as wake
  on wake.workspace_id = subject.workspace_id
 and wake.event_name = 'review.input_changed'
 and wake.payload->>'subject_id' = subject.subject_id::text
 and (wake.payload->>'input_watermark')::bigint = subject.input_watermark
join lateral (
  select event.*
  from review.reason_source_events as event
  where event.workspace_id = subject.workspace_id and event.subject_id = subject.subject_id
  order by event.source_revision desc, event.source_event_id
  limit 1
) as source on true;
grant select on review_projection_inputs to service_role;

create temporary table review_claims as
select * from api.claim_review_item_projection_v1() with no data;
grant select, insert on review_claims to service_role;
set local role service_role;
insert into review_claims select * from api.claim_review_item_projection_v1();
reset role;

select is((select count(*) from review_claims), 2::bigint,
  'the fixed worker claims only the earliest due delivery in each workspace');
select is((select count(distinct workspace_id) from review_claims), 2::bigint,
  'one dispatch claim contains at most one delivery per workspace');
select is(
  (select count(*) from review_claims where event_name = 'mastery.competency_state_changed'),
  0::bigint,
  'the later Alice Mastery delivery remains ordered behind both earlier Alice reminders'
);
select ok(
  not exists (
    select 1 from review_claims
    where lease_expires_at not between clock_timestamp() + interval '110 seconds'
      and clock_timestamp() + interval '125 seconds'
      or lease_token is null or attempt_count <> 1
  ),
  'Review claims use random 120-second first-attempt leases'
);

set local role service_role;
select throws_ok(
  pg_catalog.format(
    'select api.load_review_item_projection_v1(%L::uuid,%L::uuid)',
    (select delivery_id from review_claims where event_name = 'review.input_changed' limit 1),
    '25000000-0000-4000-8000-000000000099'
  ),
  '42501', 'review delivery lease is not valid',
  'a foreign lease token cannot load authoritative Review input'
);
reset role;

create temporary table review_worker_results (
  subject_ref text primary key,
  applied boolean not null
);
grant select, insert on review_worker_results to service_role;
set local role service_role;

select throws_like(
  pg_catalog.format(
    'select api.complete_review_item_projection_v1(%L::uuid,%L::uuid,%L::bigint,%L::jsonb)',
    claim.delivery_id, claim.lease_token, claim.event_position, '[]'
  ),
  '%omitted or added an authoritative subject%',
  'the worker cannot omit an authoritative Review subject'
)
from review_claims as claim
where claim.event_name = 'review.input_changed'
  and claim.workspace_id = (
    select workspace_id from review_workspaces where result_name = 'alice-bootstrap'
  )
limit 1;

select throws_like(
  pg_catalog.format(
    'select api.complete_review_item_projection_v1(%L::uuid,%L::uuid,%L::bigint,%L::jsonb)',
    claim.delivery_id, claim.lease_token, claim.event_position,
    pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_set(input.projection, '{state,fabricated}', 'true'::jsonb)
    )
  ),
  '%review projection result is invalid%',
  'the worker cannot persist extra state keys'
)
from review_claims as claim
join review_projection_inputs as input
  on input.workspace_id = claim.workspace_id
 and input.subject_id = (claim.payload->>'subject_id')::uuid
where claim.event_name = 'review.input_changed'
  and claim.workspace_id = (
    select workspace_id from review_workspaces where result_name = 'alice-bootstrap'
  )
limit 1;

select throws_like(
  pg_catalog.format(
    'select api.complete_review_item_projection_v1(%L::uuid,%L::uuid,%L::bigint,%L::jsonb)',
    claim.delivery_id, claim.lease_token, claim.event_position,
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_set(
      input.projection,
      '{state,calculation,item,effectiveDueAt}',
      pg_catalog.to_jsonb('2099-01-01T00:00:00.000Z'::text)
    ))
  ),
  '%active calculation is not authoritative%',
  'the worker cannot fabricate the effective due time'
)
from review_claims as claim
join review_projection_inputs as input
  on input.workspace_id = claim.workspace_id
 and input.subject_id = (claim.payload->>'subject_id')::uuid
where claim.event_name = 'review.input_changed'
  and claim.workspace_id = (
    select workspace_id from review_workspaces where result_name = 'alice-bootstrap'
  )
limit 1;

select throws_like(
  pg_catalog.format(
    'select api.complete_review_item_projection_v1(%L::uuid,%L::uuid,%L::bigint,%L::jsonb)',
    claim.delivery_id, claim.lease_token, claim.event_position,
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_set(
      input.projection,
      '{state,replayedSourceEventIds}',
      '[]'::jsonb
    ))
  ),
  '%replay identity sets are not authoritative%',
  'the worker cannot omit replayed source identities'
)
from review_claims as claim
join review_projection_inputs as input
  on input.workspace_id = claim.workspace_id
 and input.subject_id = (claim.payload->>'subject_id')::uuid
where claim.event_name = 'review.input_changed'
  and claim.workspace_id = (
    select workspace_id from review_workspaces where result_name = 'alice-bootstrap'
  )
limit 1;

insert into review_worker_results
select input.subject_ref,
  api.complete_review_item_projection_v1(
    claim.delivery_id, claim.lease_token, claim.event_position,
    pg_catalog.jsonb_build_array(input.projection)
  )
from review_claims as claim
join review_projection_inputs as input
  on input.workspace_id = claim.workspace_id
 and input.subject_id = (claim.payload->>'subject_id')::uuid
where claim.event_name = 'review.input_changed'
  and claim.workspace_id = (
    select workspace_id from review_workspaces where result_name = 'alice-bootstrap'
  );

select ok(
  api.complete_review_item_projection_v1(
    claim.delivery_id, claim.lease_token, claim.event_position,
    pg_catalog.jsonb_build_array(input.projection)
  ),
  'duplicate Review completion returns the stored successful outcome'
)
from review_claims as claim
join review_projection_inputs as input
  on input.workspace_id = claim.workspace_id
 and input.subject_id = (claim.payload->>'subject_id')::uuid
where claim.event_name = 'review.input_changed'
  and input.subject_ref = 'competency:python-typing/application';

select is(
  api.fail_review_item_projection_v1(
    claim.delivery_id, claim.lease_token, 'TRANSIENT', 'DEPENDENCY_UNAVAILABLE'
  ),
  'retry',
  'a transient Review failure remains retryable'
)
from review_claims as claim
where claim.event_name = 'review.input_changed'
  and claim.workspace_id = (
    select workspace_id from review_workspaces where result_name = 'bob-bootstrap'
  );

reset role;

create temporary table review_second_claims as
select * from api.claim_review_item_projection_v1() with no data;
grant select, insert on review_second_claims to service_role;
set local role service_role;
insert into review_second_claims select * from api.claim_review_item_projection_v1();
reset role;

select is((select count(*) from review_second_claims), 1::bigint,
  'after Alice completes round one, round two claims her second ordered reminder only');
select is(
  (select payload->>'subject_id' from review_second_claims),
  (select subject_id::text from review_projection_inputs
    where subject_ref = 'competency:python-typing/recall'),
  'the second Alice claim is the next Review input in event order'
);

set local role service_role;
insert into review_worker_results
select input.subject_ref,
  api.complete_review_item_projection_v1(
    claim.delivery_id, claim.lease_token, claim.event_position,
    pg_catalog.jsonb_build_array(input.projection)
  )
from review_second_claims as claim
join review_projection_inputs as input
  on input.workspace_id = claim.workspace_id
 and input.subject_id = (claim.payload->>'subject_id')::uuid;
reset role;

select is(
  (
    select count(delivery.delivery_id)
    from outbox.events as event
    left join outbox.deliveries as delivery
      on delivery.event_id = event.event_id
     and delivery.consumer_name = 'planning.plan_snapshot_v1'
     and delivery.handler_contract_version = 1
    where event.workspace_id = (
      select workspace_id from review_workspaces where result_name = 'alice-bootstrap'
    )
      and event.event_name = 'review.item_changed'
  ),
  (
    select count(*)
    from outbox.events as event
    where event.workspace_id = (
      select workspace_id from review_workspaces where result_name = 'alice-bootstrap'
    )
      and event.event_name = 'review.item_changed'
  ),
  'real Review completions atomically route every item change to an existing plan'
);
select ok(
  exists (
    select 1 from outbox.events as event
    where event.workspace_id = (
      select workspace_id from review_workspaces where result_name = 'alice-bootstrap'
    )
      and event.event_name = 'review.item_changed'
  ),
  'the plan-enabled real Review completions emit at least one item change'
);

create temporary table review_third_claims as
select * from api.claim_review_item_projection_v1() with no data;
grant select, insert on review_third_claims to service_role;
set local role service_role;
insert into review_third_claims select * from api.claim_review_item_projection_v1();
reset role;

select is((select count(*) from review_third_claims), 1::bigint,
  'after both Alice reminders complete, round three claims her pending Mastery wake-up');
select is(
  (select event_name from review_third_claims),
  'mastery.competency_state_changed',
  'the pending Mastery delivery is no longer hidden by Alice reminder backlog'
);

set local role service_role;
select is(
  api.fail_review_item_projection_v1(
    claim.delivery_id, claim.lease_token, 'INVALID_CONTRACT', 'MISSING_MASTERY_SNAPSHOT'
  ),
  'dead_letter',
  'a permanent Review contract failure goes directly to dead letter'
)
from review_third_claims as claim;
reset role;

select ok((select bool_and(applied) from review_worker_results),
  'both Alice Review projections apply successfully');
select is(
  (
    select count(*) from outbox.consumer_receipts
    where consumer_name = 'review.item_projection_v1'
      and workspace_id = (
        select workspace_id from review_workspaces where result_name = 'alice-bootstrap'
      )
  ),
  2::bigint,
  'duplicate completion still leaves exactly one receipt per successful delivery'
);
select ok(
  (
    select available_at between clock_timestamp() + interval '4 seconds'
      and clock_timestamp() + interval '11 seconds'
    from outbox.deliveries
    where workspace_id = (
      select workspace_id from review_workspaces where result_name = 'bob-bootstrap'
    ) and consumer_name = 'review.item_projection_v1'
  ),
  'first Review retry uses five-second base backoff with bounded jitter'
);
update outbox.deliveries
set available_at = clock_timestamp() + interval '1 hour'
where delivery_state = 'retry' and consumer_name = 'review.item_projection_v1';

-- Alice sees two stable, non-duplicated buckets; Bob cannot observe Alice's rows.
select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '24000000-0000-4000-8000-000000000001',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text, true
);
set local role authenticated;
insert into review_results values ('alice-queue', api.get_review_workspace_v1());
reset role;

select is(
  pg_catalog.jsonb_array_length(
    (select response->'items' from review_results where result_name = 'alice-queue')
  ),
  2,
  'Alice queue contains exactly two projected subjects'
);
select is(
  (
    select count(distinct item.value->>'subjectId')
    from review_results as result
    cross join lateral pg_catalog.jsonb_array_elements(result.response->'items') as item(value)
    where result.result_name = 'alice-queue'
  ),
  2::bigint,
  'each Review subject appears in exactly one queue bucket'
);
select is(
  (
    select item.value->>'bucket'
    from review_results as result
    cross join lateral pg_catalog.jsonb_array_elements(result.response->'items') as item(value)
    where result.result_name = 'alice-queue'
      and item.value->>'subjectRef' = 'competency:python-typing/application'
  ),
  'DUE_TODAY',
  'a future instant before the next workspace-local midnight is Due today'
);
select is(
  (
    select item.value->>'bucket'
    from review_results as result
    cross join lateral pg_catalog.jsonb_array_elements(result.response->'items') as item(value)
    where result.result_name = 'alice-queue'
      and item.value->>'subjectRef' = 'competency:python-typing/recall'
  ),
  'PERSONAL_REMINDER',
  'a future reminder-only item has the personal-reminder bucket'
);

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '24000000-0000-4000-8000-000000000002',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text, true
);
set local role authenticated;
insert into review_results values ('bob-queue', api.get_review_workspace_v1());
select throws_ok(
  pg_catalog.format(
    'select api.reschedule_review_reason_v1(%L::uuid,%L::uuid,1,1,%L,%L)',
    (select response->>'subjectId' from review_results where result_name = 'alice-application'),
    (select response->>'reasonId' from review_results where result_name = 'alice-application'),
    (select alice_reschedule from review_due_inputs),
    'phase3a-bob-foreign-action'
  ),
  '40001', 'review projection changed',
  'Bob cannot act on an opaque Alice subject and reason identifier'
);
reset role;
select is(
  pg_catalog.jsonb_array_length(
    (select response->'items' from review_results where result_name = 'bob-queue')
  ),
  0,
  'Bob queue cannot observe Alice Review items'
);

-- Action command replay, changed hash, and stale optimistic version all use the normal boundary.
select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '24000000-0000-4000-8000-000000000001',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text, true
);
set local role authenticated;
insert into review_results
select 'alice-reschedule', api.reschedule_review_reason_v1(
  (select (response->>'subjectId')::uuid from review_results
    where result_name = 'alice-application'),
  (select (response->>'reasonId')::uuid from review_results
    where result_name = 'alice-application'),
  1, 1, alice_reschedule, 'phase3a-alice-reschedule'
) from review_due_inputs;
insert into review_results
select 'alice-reschedule-replay', api.reschedule_review_reason_v1(
  (select (response->>'subjectId')::uuid from review_results
    where result_name = 'alice-application'),
  (select (response->>'reasonId')::uuid from review_results
    where result_name = 'alice-application'),
  1, 1, alice_reschedule, 'phase3a-alice-reschedule'
) from review_due_inputs;
select throws_ok(
  pg_catalog.format(
    'select api.reschedule_review_reason_v1(%L::uuid,%L::uuid,1,1,%L,%L)',
    (select response->>'subjectId' from review_results where result_name = 'alice-application'),
    (select response->>'reasonId' from review_results where result_name = 'alice-application'),
    (select alice_changed_reschedule from review_due_inputs),
    'phase3a-alice-reschedule'
  ),
  '22023', 'idempotency key reused with a different request',
  'a reused action key rejects a changed request hash'
);
select throws_ok(
  pg_catalog.format(
    'select api.reschedule_review_reason_v1(%L::uuid,%L::uuid,1,1,%L,%L)',
    (select response->>'subjectId' from review_results where result_name = 'alice-application'),
    (select response->>'reasonId' from review_results where result_name = 'alice-application'),
    (select alice_changed_reschedule from review_due_inputs),
    'phase3a-alice-reschedule-stale'
  ),
  '40001', 'review projection changed',
  'a new action with a stale subject version is rejected'
);
reset role;

select is(
  (select response from review_results where result_name = 'alice-reschedule-replay'),
  (select response from review_results where result_name = 'alice-reschedule'),
  'exact Review action replay returns the exact stored response'
);
select is(
  (
    select count(*) from review.action_events
    where workspace_id = (
      select workspace_id from review_workspaces where result_name = 'alice-bootstrap'
    )
  ),
  1::bigint,
  'action replay appends exactly one immutable action event'
);

select throws_ok(
  $$update review.reason_sources set source_key = source_key || ':changed'$$,
  '55000', 'review history rows are immutable',
  'reason identity history rejects updates'
);
select throws_ok(
  $$delete from review.reason_source_events$$,
  '55000', 'review history rows are immutable',
  'reason source history rejects deletion'
);
select throws_ok(
  $$update review.action_events set occurred_at = clock_timestamp()$$,
  '55000', 'review history rows are immutable',
  'Review action history rejects updates'
);
select throws_ok(
  $$delete from review.item_snapshots$$,
  '55000', 'review history rows are immutable',
  'Review calculation snapshots reject deletion'
);

-- Permanently fail the pending reschedule, then prove per-workspace ordering and exhausted-lease
-- cleanup with six valid private Review wake-ups.
create temporary table review_action_claims as
select * from api.claim_review_item_projection_v1() with no data;
grant select, insert on review_action_claims to service_role;
set local role service_role;
insert into review_action_claims select * from api.claim_review_item_projection_v1();
select is(
  api.fail_review_item_projection_v1(
    delivery_id, lease_token, 'INVALID_CONTRACT', 'TEST_TERMINAL_ACTION'
  ),
  'dead_letter',
  'the fixed failure RPC terminally records the pending action delivery'
)
from review_action_claims
where event_name = 'review.input_changed';
reset role;

insert into outbox.events (
  event_id, event_name, event_schema_version, workspace_id,
  aggregate_type, aggregate_id, aggregate_version,
  actor_type, actor_user_id, command_id, correlation_id, occurred_at, source, payload
)
select '25000000-0000-4000-8000-000000000070', 'review.input_changed', 1,
  receipt.workspace_id, 'review.subject', subject.subject_id, 1,
  'user', receipt.actor_user_id, receipt.command_id, receipt.correlation_id,
  clock_timestamp(), 'pando.database', pg_catalog.jsonb_build_object(
    'subject_id', subject.subject_id,
    'subject_ref', subject.subject_ref,
    'input_watermark', '1'
  )
from outbox.command_receipts as receipt
join review.subject_ledgers as subject on subject.workspace_id = receipt.workspace_id
where receipt.idempotency_key = 'phase3a-alice-reschedule'
  and subject.subject_ref = 'competency:python-typing/application';
insert into outbox.deliveries (
  event_id, workspace_id, consumer_name, handler_contract_version
)
select event_id, workspace_id, 'review.item_projection_v1', 1
from outbox.events where event_id = '25000000-0000-4000-8000-000000000070';

create temporary table review_superseded_claim as
select * from api.claim_review_item_projection_v1() with no data;
grant select, insert on review_superseded_claim to service_role;
set local role service_role;
insert into review_superseded_claim select * from api.claim_review_item_projection_v1();
select is(
  api.load_review_item_projection_v1(delivery_id, lease_token)
    ->'subjects'->0->>'currentInputWatermark',
  '2',
  'a superseded user wake-up folds the current authoritative subject watermark'
)
from review_superseded_claim;
select is(
  api.fail_review_item_projection_v1(
    delivery_id, lease_token, 'INVALID_CONTRACT', 'TEST_SUPERSEDED_INPUT'
  ),
  'dead_letter',
  'the synthetic superseded probe can be retired after proving the load boundary'
)
from review_superseded_claim;
reset role;

insert into outbox.events (
  event_id, event_name, event_schema_version, workspace_id,
  aggregate_type, aggregate_id, aggregate_version,
  actor_type, actor_user_id, command_id, correlation_id, occurred_at, source, payload
)
select '25000000-0000-4000-8000-000000000071', 'review.input_changed', 1,
  receipt.workspace_id, 'review.subject', subject.subject_id, subject.input_watermark,
  'user', receipt.actor_user_id, receipt.command_id, receipt.correlation_id,
  clock_timestamp(), 'pando.database', pg_catalog.jsonb_build_object(
    'subject_id', subject.subject_id,
    'input_watermark', subject.input_watermark::text
  )
from outbox.command_receipts as receipt
join review.subject_ledgers as subject on subject.workspace_id = receipt.workspace_id
where receipt.idempotency_key = 'phase3a-alice-reschedule'
  and subject.subject_ref = 'competency:python-typing/application';
insert into outbox.deliveries (
  event_id, workspace_id, consumer_name, handler_contract_version
)
select event_id, workspace_id, 'review.item_projection_v1', 1
from outbox.events where event_id = '25000000-0000-4000-8000-000000000071';

create temporary table review_invalid_event_claim as
select * from api.claim_review_item_projection_v1() with no data;
grant select, insert on review_invalid_event_claim to service_role;
set local role service_role;
insert into review_invalid_event_claim select * from api.claim_review_item_projection_v1();
select throws_ok(
  pg_catalog.format(
    'select api.load_review_item_projection_v1(%L::uuid,%L::uuid)',
    delivery_id, lease_token
  ),
  '22023', 'review delivery event contract is invalid',
  'a missing required event property cannot pass through SQL NULL semantics'
)
from review_invalid_event_claim;
select is(
  api.fail_review_item_projection_v1(
    delivery_id, lease_token, 'INVALID_CONTRACT', 'TEST_MISSING_EVENT_PROPERTY'
  ),
  'dead_letter',
  'the invalid event probe is terminally retired'
)
from review_invalid_event_claim;
reset role;

create temporary table review_batch_events as
select gen_random_uuid() as event_id
from pg_catalog.generate_series(1, 6);

insert into outbox.events (
  event_id, event_name, event_schema_version, workspace_id,
  aggregate_type, aggregate_id, aggregate_version,
  actor_type, actor_user_id, command_id, correlation_id, occurred_at, source, payload
)
select batch.event_id, 'review.input_changed', 1, receipt.workspace_id,
  'review.subject', subject.subject_id, subject.input_watermark,
  'user', receipt.actor_user_id, receipt.command_id, receipt.correlation_id,
  clock_timestamp(), 'pando.database', pg_catalog.jsonb_build_object(
    'subject_id', subject.subject_id,
    'subject_ref', subject.subject_ref,
    'input_watermark', subject.input_watermark::text
  )
from review_batch_events as batch
cross join lateral (
  select command.workspace_id, command.actor_user_id, command.command_id,
    command.correlation_id
  from outbox.command_receipts as command
  where command.idempotency_key = 'phase3a-alice-reschedule'
) as receipt
cross join lateral (
  select ledger.subject_id, ledger.subject_ref, ledger.input_watermark
  from review.subject_ledgers as ledger
  where ledger.workspace_id = receipt.workspace_id
    and ledger.subject_ref = 'competency:python-typing/application'
) as subject;
insert into outbox.deliveries (
  event_id, workspace_id, consumer_name, handler_contract_version
)
select event.event_id, event.workspace_id, 'review.item_projection_v1', 1
from outbox.events as event
join review_batch_events as batch using (event_id);

create temporary table review_batch_claims as
select 0::integer as claim_batch, claimed.*
from api.claim_review_item_projection_v1() as claimed with no data;
grant select, insert on review_batch_claims to service_role;
set local role service_role;
insert into review_batch_claims
select 1, claimed.* from api.claim_review_item_projection_v1() as claimed;
reset role;
select is((select count(*) from review_batch_claims where claim_batch = 1), 1::bigint,
  'one Review worker claim leases only the earliest due delivery in a workspace');

update outbox.deliveries
set attempt_count = 8, lease_expires_at = clock_timestamp() - interval '1 second'
where delivery_id = (
  select delivery_id from review_batch_claims where claim_batch = 1
  order by event_position limit 1
);
set local role service_role;
insert into review_batch_claims
select 2, claimed.* from api.claim_review_item_projection_v1() as claimed;
reset role;
select is((select count(*) from review_batch_claims where claim_batch = 2), 1::bigint,
  'after terminal cleanup the next claim advances to the next workspace-ordered delivery');
select is(
  (
    select delivery_state from outbox.deliveries
    where last_error_code = 'LEASE_EXPIRED_AFTER_MAX_ATTEMPTS'
      and consumer_name = 'review.item_projection_v1'
    order by dead_lettered_at desc limit 1
  ),
  'dead_letter',
  'an expired eighth Review lease is dead-lettered before another claim'
);

-- Exact receipt replay must remain independent of later owner-query results. A transactional
-- workspace-owned competency can be archived without violating immutable Catalog publication.
insert into overlay.personal_competencies (
  personal_competency_id, workspace_id, competency_key, domain_item_key,
  title, provenance, lifecycle
)
select
  '25000000-0000-4000-8000-000000000090', workspace_id,
  'competency:temporary-replay', 'domain:python', 'Temporary replay competency',
  'Transactional pgTAP fixture for exact command receipt replay.', 'accepted'
from review_workspaces where result_name = 'alice-bootstrap';

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '24000000-0000-4000-8000-000000000001',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text, true
);
set local role authenticated;
insert into review_results
select 'alice-overlay-reminder', api.create_personal_review_reminder_v1(
  'competency:temporary-replay', 'KNOWLEDGE', alice_future_reminder, 0,
  'phase3a-alice-overlay-replay'
) from review_due_inputs;
reset role;

update overlay.personal_competencies
set lifecycle = 'archived'
where personal_competency_id = '25000000-0000-4000-8000-000000000090';
select is(
  (
    select count(*) from overlay.personal_competencies
    where workspace_id = (
      select workspace_id from review_workspaces where result_name = 'alice-bootstrap'
    ) and competency_key = 'competency:temporary-replay' and lifecycle = 'accepted'
  ),
  0::bigint,
  'the Overlay owner query no longer resolves the archived fixture competency'
);

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '24000000-0000-4000-8000-000000000001',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text, true
);
set local role authenticated;
insert into review_results
select 'alice-overlay-reminder-replay', api.create_personal_review_reminder_v1(
  'competency:temporary-replay', 'KNOWLEDGE', alice_future_reminder, 0,
  'phase3a-alice-overlay-replay'
) from review_due_inputs;
reset role;
select is(
  (select response from review_results where result_name = 'alice-overlay-reminder-replay'),
  (select response from review_results where result_name = 'alice-overlay-reminder'),
  'an exact reminder replay returns its stored receipt before re-running the owner query'
);

select * from finish();
rollback;
