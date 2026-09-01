begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- The public surface is intentionally actor-scoped: it accepts neither a workspace nor a Plan id.
select ok(
  pg_catalog.has_function_privilege('authenticated', 'api.get_current_growth_plan_v1()', 'EXECUTE')
  and pg_catalog.has_function_privilege(
    'authenticated', 'api.preview_growth_plan_lifecycle_v1(text,text,text)', 'EXECUTE'
  )
  and pg_catalog.has_function_privilege(
    'authenticated', 'api.apply_growth_plan_lifecycle_v1(text,text,text,text,text)', 'EXECUTE'
  )
  and not pg_catalog.has_function_privilege('anon', 'api.get_current_growth_plan_v1()', 'EXECUTE')
  and not pg_catalog.has_function_privilege(
    'service_role', 'api.apply_growth_plan_lifecycle_v1(text,text,text,text,text)', 'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated',
    'planning.build_growth_plan_lifecycle_preview_v1(uuid,uuid,text,text,integer,bigint,text,bigint,text)',
    'EXECUTE'
  ),
  'Growth Plan lifecycle has authenticated actor-scoped APIs and no exposed private preview helper'
);

select ok(
  count(*) = 3
    and bool_and(procedure.prosecdef)
    and bool_and('search_path=""' = any(coalesce(procedure.proconfig, '{}'::text[])))
    and bool_and(owner.rolname = 'pando_planning_api')
    and bool_and(not owner.rolcanlogin and not owner.rolinherit and not owner.rolbypassrls),
  'Growth Plan lifecycle APIs are bounded SECURITY DEFINER functions owned by pando_planning_api'
)
from pg_catalog.pg_proc as procedure
join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
join pg_catalog.pg_roles as owner on owner.oid = procedure.proowner
where namespace.nspname = 'api'
  and procedure.proname in (
    'get_current_growth_plan_v1',
    'preview_growth_plan_lifecycle_v1',
    'apply_growth_plan_lifecycle_v1'
  );

select ok(
  pg_catalog.has_column_privilege(
    'pando_planning_api', 'planning.growth_plans', 'lifecycle', 'UPDATE'
  )
  and pg_catalog.has_column_privilege(
    'pando_planning_api', 'planning.growth_plans', 'aggregate_version', 'UPDATE'
  )
  and pg_catalog.has_column_privilege(
    'pando_planning_api', 'planning.growth_plans', 'updated_at', 'UPDATE'
  )
  and not pg_catalog.has_column_privilege(
    'pando_planning_api', 'planning.growth_plans', 'title', 'UPDATE'
  )
  and pg_catalog.has_column_privilege(
    'pando_planning_api', 'planning.growth_plans', 'weekly_capacity_minutes', 'UPDATE'
  ),
  'the shared Planning owner can update lifecycle/capacity command columns but not Plan title'
);

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    'd1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
    'lifecycle-alice@pando.test', '', clock_timestamp(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    clock_timestamp(), clock_timestamp()
  ),
  (
    'd1000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
    'lifecycle-bob@pando.test', '', clock_timestamp(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    clock_timestamp(), clock_timestamp()
  );

create temporary table lifecycle_results (
  result_name text primary key,
  response jsonb not null
);
grant select, insert on lifecycle_results to authenticated;
grant select, insert on lifecycle_results to pando_planning_api;

-- Alice gets a current Plan. Bob initially gets only a personal workspace, proving that reads
-- never accept a foreign workspace selector and that no-current is not represented as pause.
select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', 'd1000000-0000-4000-8000-000000000001',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text,
  true
);
set local role authenticated;
insert into lifecycle_results values (
  'alice-bootstrap', api.bootstrap_personal_workspace('phase4b-lifecycle-alice', 'Lifecycle Alice')
);
insert into lifecycle_results
select 'alice-goal', api.create_readiness_goal(
  (select (response->>'workspace_id')::uuid from lifecycle_results where result_name = 'alice-bootstrap'),
  'goal:lifecycle-alice', 'Lifecycle Alice goal',
  'target:nvidia-python-verification-base-v1', 'phase4b-lifecycle-alice-goal'
);
insert into lifecycle_results values (
  'alice-plan', api.initialize_growth_plan_v1(
    'goal:lifecycle-alice', 600, 45, 80, 120, 'phase4b-lifecycle-alice-plan'
  )
);
reset role;

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', 'd1000000-0000-4000-8000-000000000002',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text,
  true
);
set local role authenticated;
insert into lifecycle_results values (
  'bob-bootstrap', api.bootstrap_personal_workspace('phase4b-lifecycle-bob', 'Lifecycle Bob')
);
insert into lifecycle_results values ('bob-not-started', api.get_current_growth_plan_v1());

select is(
  (select response#>>'{recalculation,projectionState}' from lifecycle_results where result_name = 'bob-not-started'),
  'NOT_STARTED',
  'a second workspace without a Plan receives only the explicit NOT_STARTED state'
);
select ok(
  (select response->'currentPlan' = 'null'::jsonb
     and response->'capabilities' = '[]'::jsonb
     and response#>>'{recalculation,reason}' = 'INITIALIZING'
   from lifecycle_results where result_name = 'bob-not-started'),
  'no-current Plan response has no foreign Plan data or lifecycle capability'
);

-- Bob then receives an independent Plan. The actor-scoped APIs have no parameter through which
-- he could substitute Alice's workspace or Growth Plan identity.
set local role authenticated;
insert into lifecycle_results
select 'bob-goal', api.create_readiness_goal(
  (select (response->>'workspace_id')::uuid from lifecycle_results where result_name = 'bob-bootstrap'),
  'goal:lifecycle-bob', 'Lifecycle Bob goal',
  'target:nvidia-python-verification-base-v1', 'phase4b-lifecycle-bob-goal'
);
insert into lifecycle_results values (
  'bob-plan', api.initialize_growth_plan_v1(
    'goal:lifecycle-bob', 180, 30, 70, 60, 'phase4b-lifecycle-bob-plan'
  )
);
insert into lifecycle_results values ('bob-current-active', api.get_current_growth_plan_v1());
insert into lifecycle_results values (
  'bob-pause-preview', api.preview_growth_plan_lifecycle_v1(
    'pause_growth_plan', '1', 'Pause Bob plan independently.'
  )
);
reset role;
select ok(
  (select current_plan.response#>>'{currentPlan,weeklyCapacityMinutes}' = '180'
     and preview.response#>>'{before,growthPlanId}' = (
       select response->>'growthPlanId' from lifecycle_results where result_name = 'bob-plan'
     )
     and preview.response#>>'{before,growthPlanId}' <> (
       select response->>'growthPlanId' from lifecycle_results where result_name = 'alice-plan'
     )
   from lifecycle_results as current_plan
   join lifecycle_results as preview on preview.result_name = 'bob-pause-preview'
   where current_plan.result_name = 'bob-current-active'),
  'Bob can read and preview only his independent Growth Plan'
);

-- The private builder has a fixed cross-runtime SHA-256 oracle, including UTF-8 byte lengths.
do $planning_test_role$
begin
  execute pg_catalog.format('grant pando_planning_api to %I with set true', current_user);
end
$planning_test_role$;
set local role pando_planning_api;
select is(
  planning.build_growth_plan_lifecycle_preview_v1(
    '30000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000020',
    'Backend readiness', 'active', 600, 4,
    'pause_growth_plan', 4, 'Pause — confirmed'
  )->>'previewDigest',
  '0d897f054cad2c84b2edc4935999f6a05b5bd8d104290d11592d8f47eeb73b6f',
  'Postgres uses the exact versioned lifecycle preview digest protocol'
);
reset role;

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', 'd1000000-0000-4000-8000-000000000001',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from clock_timestamp() + interval '1 hour')::bigint
  )::text,
  true
);
set local role authenticated;
insert into lifecycle_results values ('alice-current-active', api.get_current_growth_plan_v1());
insert into lifecycle_results values (
  'alice-pause-preview', api.preview_growth_plan_lifecycle_v1(
    'pause_growth_plan', '1', 'Pause while my priorities change.'
  )
);
reset role;

select ok(
  (select response#>>'{currentPlan,lifecycle}' = 'ACTIVE'
     and response#>>'{currentPlan,weeklyCapacityMinutes}' = '600'
     and response#>>'{currentPlan,aggregateVersion}' = '1'
     and response->'capabilities' = '["pause_growth_plan"]'::jsonb
   from lifecycle_results where result_name = 'alice-current-active'),
  'Alice sees only her current active Plan and its one legal operation'
);
select ok(
  (select response#>>'{contract,name}' = 'GrowthPlanLifecyclePreviewV1'
     and response#>>'{before,lifecycle}' = 'ACTIVE'
     and response#>>'{after,lifecycle}' = 'PAUSED'
     and response#>>'{before,aggregateVersion}' = '1'
     and response#>>'{after,aggregateVersion}' = '2'
     and response#>>'{recalculationAfterApply,projectionState}' = 'PENDING'
     and response->'retained' =
       '{"learningTracks":true,"planSnapshots":true,"focusSessions":true,"evidence":true}'::jsonb
   from lifecycle_results where result_name = 'alice-pause-preview'),
  'pause preview gives an exact before/after transition and honest retained-history effects'
);

create temporary table lifecycle_before as
select
  plan.title,
  plan.weekly_capacity_minutes,
  plan.aggregate_version,
  (select count(*)::bigint from planning.learning_tracks as track
   where track.workspace_id = plan.workspace_id and track.growth_plan_id = plan.growth_plan_id) as track_count,
  (select pointer.pointer_version from planning.current_plan_snapshots as pointer
   where pointer.workspace_id = plan.workspace_id) as pointer_version,
  (select count(*)::bigint from outbox.events as event
   where event.workspace_id = plan.workspace_id and event.aggregate_type = 'planning.growth_plan') as event_count,
  (select count(*)::bigint from outbox.deliveries as delivery
   where delivery.workspace_id = plan.workspace_id and delivery.consumer_name = 'planning.plan_snapshot_v1') as delivery_count
from planning.growth_plans as plan
where plan.growth_plan_id = (
  select (response->>'growthPlanId')::uuid from lifecycle_results where result_name = 'alice-plan'
);

select is(
  (select plan.aggregate_version from planning.growth_plans as plan
   where plan.growth_plan_id = (select (response->>'growthPlanId')::uuid from lifecycle_results where result_name = 'alice-plan')),
  (select aggregate_version from lifecycle_before),
  'a read-only preview changes no Growth Plan row'
);
select is(
  (select count(*)::bigint from outbox.events as event
   where event.aggregate_type = 'planning.growth_plan'
     and event.aggregate_id = (select (response->>'growthPlanId')::uuid from lifecycle_results where result_name = 'alice-plan')),
  (select event_count from lifecycle_before),
  'a read-only preview creates no event'
);

set local role authenticated;
insert into lifecycle_results
select 'alice-pause-apply', api.apply_growth_plan_lifecycle_v1(
  'pause_growth_plan', '1', response->>'previewDigest',
  'Pause while my priorities change.', 'phase4b-lifecycle-alice-pause'
)
from lifecycle_results where result_name = 'alice-pause-preview';
insert into lifecycle_results
select 'alice-pause-replay', api.apply_growth_plan_lifecycle_v1(
  'pause_growth_plan', '1', response->>'previewDigest',
  'Pause while my priorities change.', 'phase4b-lifecycle-alice-pause'
)
from lifecycle_results where result_name = 'alice-pause-preview';
reset role;

select is(
  (select response from lifecycle_results where result_name = 'alice-pause-replay'),
  (select response from lifecycle_results where result_name = 'alice-pause-apply'),
  'the completed lifecycle command replays its byte-identical stored result'
);
select ok(
  (select response#>>'{changedPlan,lifecycle}' = 'PAUSED'
     and response#>>'{changedPlan,aggregateVersion}' = '2'
     and response->>'projectionState' = 'PENDING'
     and pg_catalog.jsonb_array_length(response->'emittedEventIds') = 1
   from lifecycle_results where result_name = 'alice-pause-apply'),
  'pause changes only the Plan lifecycle/version and reports pending projection work'
);
select ok(
  (select plan.lifecycle = 'paused'
     and plan.aggregate_version = 2
     and plan.title = before_state.title
     and plan.weekly_capacity_minutes = before_state.weekly_capacity_minutes
     and (select count(*)::bigint from planning.learning_tracks as track
          where track.workspace_id = plan.workspace_id and track.growth_plan_id = plan.growth_plan_id) = before_state.track_count
     and (select pointer.pointer_version from planning.current_plan_snapshots as pointer
          where pointer.workspace_id = plan.workspace_id) = before_state.pointer_version
   from planning.growth_plans as plan cross join lifecycle_before as before_state
   where plan.growth_plan_id = (select (response->>'growthPlanId')::uuid from lifecycle_results where result_name = 'alice-plan')),
  'pause preserves title, capacity, Tracks, and the existing projection pointer'
);
select is(
  (
    select count(*)::bigint
    from outbox.events as event
    join lifecycle_results as applied on applied.result_name = 'alice-pause-apply'
      and event.event_id = (applied.response->'emittedEventIds'->>0)::uuid
    where event.event_name = 'planning.input_changed'
      and event.event_schema_version = 1
      and event.aggregate_type = 'planning.growth_plan'
      and event.aggregate_version = 2
      and event.payload ?& array['change_kind', 'growth_plan_id', 'growth_plan_version', 'lifecycle']
      and event.payload - array['change_kind', 'growth_plan_id', 'growth_plan_version', 'lifecycle'] = '{}'::jsonb
      and event.payload->>'change_kind' = 'PLAN_LIFECYCLE_CHANGED'
      and event.payload->>'lifecycle' = 'PAUSED'
      and event.payload->>'growth_plan_version' = '2'
  ),
  1::bigint,
  'pause emits precisely one privacy-minimized lifecycle input event'
);
select is(
  (
    select count(*)::bigint
    from outbox.deliveries as delivery
    join lifecycle_results as applied on applied.result_name = 'alice-pause-apply'
      and delivery.delivery_id = (applied.response->>'planningDeliveryId')::uuid
    where delivery.event_id = (applied.response->'emittedEventIds'->>0)::uuid
      and delivery.consumer_name = 'planning.plan_snapshot_v1'
      and delivery.handler_contract_version = 1
      and delivery.delivery_state = 'pending'
  ),
  1::bigint,
  'pause appends exactly one fixed pending Planning delivery'
);

-- First-attempt failures must leave no partial command receipt, owner mutation, event, or delivery.
set local role authenticated;
insert into lifecycle_results values (
  'alice-resume-preview', api.preview_growth_plan_lifecycle_v1(
    'resume_growth_plan', '2', 'Resume after priorities are settled.'
  )
);
reset role;
create temporary table lifecycle_rollback_before as
select
  (select aggregate_version from planning.growth_plans
   where growth_plan_id = (select (response->>'growthPlanId')::uuid from lifecycle_results where result_name = 'alice-plan')) as plan_version,
  (select count(*)::bigint from outbox.events
   where aggregate_id = (select (response->>'growthPlanId')::uuid from lifecycle_results where result_name = 'alice-plan')) as event_count,
  (select count(*)::bigint from outbox.deliveries as delivery
   join outbox.events as event on event.event_id = delivery.event_id
   where event.aggregate_id = (select (response->>'growthPlanId')::uuid from lifecycle_results where result_name = 'alice-plan')) as delivery_count;

create function public.fail_growth_plan_lifecycle_event_for_test()
returns trigger language plpgsql set search_path = '' as $function$
begin
  if new.event_name = 'planning.input_changed'
     and new.aggregate_type = 'planning.growth_plan'
     and new.workspace_id::text = pg_catalog.current_setting('pando.test.fail_lifecycle_workspace', true) then
    raise exception using errcode = 'P0001', message = 'injected Growth Plan lifecycle outbox failure';
  end if;
  return new;
end
$function$;
create trigger fail_growth_plan_lifecycle_event_for_test
before insert on outbox.events
for each row execute function public.fail_growth_plan_lifecycle_event_for_test();
select set_config(
  'pando.test.fail_lifecycle_workspace',
  (select response->>'workspaceId' from lifecycle_results where result_name = 'alice-plan'),
  true
);
set local role authenticated;
select throws_ok(
  pg_catalog.format(
    'select api.apply_growth_plan_lifecycle_v1(%L,%L,%L,%L,%L)',
    'resume_growth_plan',
    '2',
    (select response->>'previewDigest' from lifecycle_results where result_name = 'alice-resume-preview'),
    'Resume after priorities are settled.', 'phase4b-lifecycle-rollback'
  ),
  'P0001', 'injected Growth Plan lifecycle outbox failure',
  'an outbox failure rolls back the whole lifecycle command'
);
reset role;
drop trigger fail_growth_plan_lifecycle_event_for_test on outbox.events;
drop function public.fail_growth_plan_lifecycle_event_for_test();

select ok(
  (select plan.lifecycle = 'paused' and plan.aggregate_version = rollback_state.plan_version
   from planning.growth_plans as plan cross join lifecycle_rollback_before as rollback_state
   where plan.growth_plan_id = (select (response->>'growthPlanId')::uuid from lifecycle_results where result_name = 'alice-plan'))
  and (select count(*)::bigint from outbox.events
       where aggregate_id = (select (response->>'growthPlanId')::uuid from lifecycle_results where result_name = 'alice-plan')) =
      (select event_count from lifecycle_rollback_before)
  and (select count(*)::bigint from outbox.deliveries as delivery join outbox.events as event on event.event_id = delivery.event_id
       where event.aggregate_id = (select (response->>'growthPlanId')::uuid from lifecycle_results where result_name = 'alice-plan')) =
      (select delivery_count from lifecycle_rollback_before)
  and (select count(*)::bigint from outbox.command_receipts where idempotency_key = 'phase4b-lifecycle-rollback') = 0,
  'injected failure leaves no partial state, outbox record, delivery, or receipt'
);

-- Stale, altered, and already-current first attempts fail before a receipt is committed.
set local role authenticated;
select throws_ok(
  $$select api.apply_growth_plan_lifecycle_v1(
    'pause_growth_plan', '1',
    '0000000000000000000000000000000000000000000000000000000000000000',
    'Pause while my priorities change.', 'phase4b-lifecycle-stale'
  )$$,
  '40001', 'Growth Plan version is stale',
  'a stale expected Plan version is refused'
);
select throws_ok(
  $$select api.apply_growth_plan_lifecycle_v1(
    'resume_growth_plan', '2',
    '0000000000000000000000000000000000000000000000000000000000000000',
    'Resume after priorities are settled.', 'phase4b-lifecycle-digest'
  )$$,
  '40001', 'Growth Plan preview is stale',
  'a changed preview digest is refused after locked recomputation'
);
select throws_ok(
  $$select api.apply_growth_plan_lifecycle_v1(
    'pause_growth_plan', '2',
    '0000000000000000000000000000000000000000000000000000000000000000',
    'Pause while my priorities change.', 'phase4b-lifecycle-noop'
  )$$,
  '22023', 'Growth Plan lifecycle transition is invalid',
  'a new key cannot request the already-current lifecycle'
);
reset role;
select is(
  (select count(*)::bigint from outbox.command_receipts
   where idempotency_key in ('phase4b-lifecycle-stale', 'phase4b-lifecycle-digest', 'phase4b-lifecycle-noop')),
  0::bigint,
  'all rejected first attempts leave no lifecycle command receipt'
);

set local role authenticated;
insert into lifecycle_results
select 'alice-resume-apply', api.apply_growth_plan_lifecycle_v1(
  'resume_growth_plan', '2', response->>'previewDigest',
  'Resume after priorities are settled.', 'phase4b-lifecycle-alice-resume'
)
from lifecycle_results where result_name = 'alice-resume-preview';
select throws_ok(
  $$select api.apply_growth_plan_lifecycle_v1(
    'resume_growth_plan', '2',
    '0000000000000000000000000000000000000000000000000000000000000000',
    'Changed request body.', 'phase4b-lifecycle-alice-resume'
  )$$,
  '22023', 'idempotency key reused with a different request',
  'a completed idempotency key cannot be reused with another request hash'
);
insert into lifecycle_results values ('alice-current-resumed', api.get_current_growth_plan_v1());
reset role;

select ok(
  (select response#>>'{changedPlan,lifecycle}' = 'ACTIVE'
     and response#>>'{changedPlan,aggregateVersion}' = '3'
   from lifecycle_results where result_name = 'alice-resume-apply')
  and (select response#>>'{currentPlan,lifecycle}' = 'ACTIVE'
       and response#>>'{currentPlan,aggregateVersion}' = '3'
       and response->'capabilities' = '["pause_growth_plan"]'::jsonb
       and response#>>'{recalculation,projectionState}' = 'PENDING'
      from lifecycle_results where result_name = 'alice-current-resumed'),
  'resume returns the same owner state through the current Plan read'
);

select * from finish();
rollback;
