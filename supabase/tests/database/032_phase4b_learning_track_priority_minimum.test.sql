begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

select is(
  pg_catalog.has_function_privilege(
    runtime_role.role_name,
    public_api.signature,
    'EXECUTE'
  ),
  runtime_role.role_name = 'authenticated',
  pg_catalog.format('%s has the exact D2b2 API privilege for %s',
    runtime_role.role_name, public_api.signature)
)
from (values ('anon'), ('authenticated'), ('service_role')) as runtime_role(role_name)
cross join (values
  ('api.preview_learning_track_priority_minimum_v1(text,integer,integer,text,text,text)'),
  ('api.apply_learning_track_priority_minimum_v1(text,integer,integer,text,text,text,text,text)')
) as public_api(signature)
order by runtime_role.role_name, public_api.signature;

select ok(
  not pg_catalog.has_function_privilege(
    runtime_role.role_name,
    private_helper.signature,
    'EXECUTE'
  ),
  pg_catalog.format('%s cannot execute private D2b2 helper %s',
    runtime_role.role_name, private_helper.signature)
)
from (values ('anon'), ('authenticated'), ('service_role')) as runtime_role(role_name)
cross join (values
  ('planning.projected_active_track_priority_minimum_constraint_v1(uuid,uuid,uuid,text,integer,bigint)'),
  ('planning.projected_current_track_order_v1(uuid,uuid,uuid,integer,bigint)'),
  ('planning.build_learning_track_priority_minimum_preview_v1(uuid,uuid,text,integer,bigint,uuid,text,text,text,integer,integer,bigint,integer,integer,bigint,bigint,text)'),
  ('planning.track_priority_minimum_event_payload_v1_is_valid(jsonb)')
) as private_helper(signature)
order by runtime_role.role_name, private_helper.signature;

select ok(
  count(*) = 6
    and bool_and(
      procedure.prosecdef =
        (procedure.proname <> 'track_priority_minimum_event_payload_v1_is_valid')
    )
    and bool_and('search_path=""' = any(coalesce(procedure.proconfig, '{}'::text[])))
    and bool_and(owner.rolname = 'pando_planning_api'),
  'D2b2 APIs and helpers have exact definer modes, search path, and Planning owner'
)
from pg_catalog.pg_proc as procedure
join pg_catalog.pg_roles as owner on owner.oid = procedure.proowner
where procedure.oid in (
  pg_catalog.to_regprocedure(
    'planning.projected_active_track_priority_minimum_constraint_v1(uuid,uuid,uuid,text,integer,bigint)'
  ),
  pg_catalog.to_regprocedure(
    'planning.projected_current_track_order_v1(uuid,uuid,uuid,integer,bigint)'
  ),
  pg_catalog.to_regprocedure(
    'planning.build_learning_track_priority_minimum_preview_v1(uuid,uuid,text,integer,bigint,uuid,text,text,text,integer,integer,bigint,integer,integer,bigint,bigint,text)'
  ),
  pg_catalog.to_regprocedure(
    'planning.track_priority_minimum_event_payload_v1_is_valid(jsonb)'
  ),
  pg_catalog.to_regprocedure(
    'api.preview_learning_track_priority_minimum_v1(text,integer,integer,text,text,text)'
  ),
  pg_catalog.to_regprocedure(
    'api.apply_learning_track_priority_minimum_v1(text,integer,integer,text,text,text,text,text)'
  )
);

select ok(
  not pg_catalog.has_table_privilege(
    'pando_planning_api', 'planning.learning_tracks', 'UPDATE'
  )
    and (
      select pg_catalog.array_agg(privilege.column_name order by privilege.column_name)
      from information_schema.column_privileges as privilege
      where privilege.grantee = 'pando_planning_api'
        and privilege.table_schema = 'planning'
        and privilege.table_name = 'learning_tracks'
        and privilege.privilege_type = 'UPDATE'
    ) = array[
      'aggregate_version', 'lifecycle', 'priority',
      'protected_minimum_minutes', 'updated_at'
    ]::information_schema.sql_identifier[],
  'Planning owner retains only the cumulative exact Track command update columns'
);

set local role authenticated;
select throws_ok(
  $$select planning.projected_current_track_order_v1(
    gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 80, 2
  )$$,
  '42501',
  'permission denied for function projected_current_track_order_v1',
  'authenticated cannot call the private current-order helper'
);
select throws_ok(
  $$select planning.track_priority_minimum_event_payload_v1_is_valid('{}'::jsonb)$$,
  '42501',
  'permission denied for function track_priority_minimum_event_payload_v1_is_valid',
  'authenticated cannot call the private D2b2 event validator'
);
reset role;

select is(
  (
    with ordered_tracks as (
      select track.*,
        pg_catalog.row_number() over (
          order by track.priority desc, track.track_key collate "C", track.learning_track_id
        )::bigint as track_position
      from (values
        ('30000000-0000-4000-8000-000000000033'::uuid, '3', 'PAUSED', 80, 'track:a0'),
        ('30000000-0000-4000-8000-000000000032'::uuid, '2', 'ACTIVE', 90, 'track:a0'),
        ('30000000-0000-4000-8000-000000000031'::uuid, '1', 'ACTIVE', 90, 'track:a-2')
      ) as track(learning_track_id, aggregate_version, lifecycle, priority, track_key)
    ), fingerprint_input as (
      select pg_catalog.string_agg(
        part_name || ':'
          || pg_catalog.octet_length(pg_catalog.convert_to(part_value, 'UTF8'))::text
          || ':' || part_value || pg_catalog.chr(10),
        '' order by part_position
      ) as value
      from (
        select 1::bigint as part_position, 'fingerprintVersion'::text as part_name,
          'current-track-order-fingerprint/1.0.0'::text as part_value
        union all
        select 2, 'currentTrackCount', '3'
        union all
        select 2 + track.track_position * 10 + field.field_position,
          field.field_name, field.field_value
        from ordered_tracks as track
        cross join lateral (values
          (1::bigint, 'learningTrackId'::text, pg_catalog.lower(track.learning_track_id::text)),
          (2::bigint, 'aggregateVersion'::text, track.aggregate_version),
          (3::bigint, 'lifecycle'::text, track.lifecycle),
          (4::bigint, 'priority'::text, track.priority::text),
          (5::bigint, 'trackKey'::text, track.track_key)
        ) as field(field_position, field_name, field_value)
      ) as parts
    )
    select pg_catalog.encode(
      extensions.digest(pg_catalog.convert_to(value, 'UTF8'), 'sha256'), 'hex'
    ) from fingerprint_input
  ),
  'd127505e230822d63daafdd90f974a155a1754e293616e88e6af46fa4aa99ac7',
  'PostgreSQL matches the fixed TypeScript punctuation-tie current-order oracle'
);

select is(
  (
    select pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(
          pg_catalog.string_agg(
            field_name || ':'
              || pg_catalog.octet_length(pg_catalog.convert_to(field_value, 'UTF8'))::text
              || ':' || field_value || pg_catalog.chr(10),
            '' order by field_position
          ),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    )
    from (values
      (1, 'digestVersion', 'learning-track-priority-minimum-preview-digest/1.0.0'),
      (2, 'contractVersion', '1.0.0'),
      (3, 'activeCapacityFingerprintVersion', 'active-track-constraint-fingerprint/1.0.0'),
      (4, 'currentOrderFingerprintVersion', 'current-track-order-fingerprint/1.0.0'),
      (5, 'workspaceId', '30000000-0000-4000-8000-000000000001'),
      (6, 'operation', 'set_track_priority_minimum'),
      (7, 'reason', 'Перенести café — сейчас.'),
      (8, 'expectedGrowthPlanVersion', '4'),
      (9, 'expectedLearningTrackVersion', '7'),
      (10, 'growthPlanId', '30000000-0000-4000-8000-000000000020'),
      (11, 'growthPlanLifecycle', 'ACTIVE'),
      (12, 'growthPlanWeeklyCapacityMinutes', '600'),
      (13, 'growthPlanAggregateVersion', '4'),
      (14, 'beforeLearningTrackId', '30000000-0000-4000-8000-000000000021'),
      (15, 'beforeTrackKey', 'track:algorithms'),
      (16, 'beforeTitle', 'Алгоритмы — café'),
      (17, 'beforeLifecycle', 'ACTIVE'),
      (18, 'beforePriority', '90'),
      (19, 'beforeProtectedMinimumMinutes', '120'),
      (20, 'beforeAggregateVersion', '7'),
      (21, 'afterLearningTrackId', '30000000-0000-4000-8000-000000000021'),
      (22, 'afterTrackKey', 'track:algorithms'),
      (23, 'afterTitle', 'Алгоритмы — café'),
      (24, 'afterLifecycle', 'ACTIVE'),
      (25, 'afterPriority', '80'),
      (26, 'afterProtectedMinimumMinutes', '120'),
      (27, 'afterAggregateVersion', '8'),
      (28, 'activeTrackCountBefore', '2'),
      (29, 'activeTrackCountAfter', '2'),
      (30, 'activeProtectedMinimumMinutesBefore', '180'),
      (31, 'activeProtectedMinimumMinutesAfter', '180'),
      (32, 'flexibleMinutesBefore', '420'),
      (33, 'flexibleMinutesAfter', '420'),
      (34, 'activeTrackFingerprintBefore', repeat('a', 64)),
      (35, 'activeTrackFingerprintAfter', repeat('b', 64)),
      (36, 'activeTrackCountIfTargetActiveAfter', '2'),
      (37, 'minimumCapacityIfTargetActiveAfter', '180'),
      (38, 'targetActiveStateFitsCapacity', 'true'),
      (39, 'currentTrackPositionBefore', '1'),
      (40, 'currentTrackPositionAfter', '1'),
      (41, 'currentTrackOrderFingerprintBefore', repeat('c', 64)),
      (42, 'currentTrackOrderFingerprintAfter', repeat('d', 64)),
      (43, 'canApply', 'true'),
      (44, 'blockingReasonCode', ''),
      (45, 'blockingMinimumCapacityMinutes', ''),
      (46, 'warningCount', '0'),
      (47, 'retainedLearningTrackActivities', 'true'),
      (48, 'retainedPlanSnapshots', 'true'),
      (49, 'retainedFocusSessions', 'true'),
      (50, 'retainedEvidence', 'true'),
      (51, 'projectionStateAfterApply', 'PENDING'),
      (52, 'consumerName', 'planning.plan_snapshot_v1')
    ) as fixed_oracle(field_position, field_name, field_value)
  ),
  'fb817a72df56635e4c98adb158242a78eeedbd665a4da55c775f8638687337c5',
  'PostgreSQL matches the fixed TypeScript Unicode D2b2 digest oracle'
);

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    'e2000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
    'd2b2-alice@pando.test', '', pg_catalog.clock_timestamp(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
  ),
  (
    'e2000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
    'd2b2-bob@pando.test', '', pg_catalog.clock_timestamp(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
  );

create temporary table priority_results (
  result_name text primary key,
  response jsonb not null
);
grant select, insert on priority_results to authenticated;

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', 'e2000000-0000-4000-8000-000000000001',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from pg_catalog.clock_timestamp() + interval '1 hour')::bigint
  )::text,
  true
);
set local role authenticated;
insert into priority_results values (
  'alice-bootstrap', api.bootstrap_personal_workspace('d2b2-alice', 'D2b2 Alice')
);
insert into priority_results
select 'alice-goal', api.create_readiness_goal(
  (response->>'workspace_id')::uuid,
  'goal:d2b2-alice', 'D2b2 Alice goal',
  'target:nvidia-python-verification-base-v1', 'd2b2-alice-goal'
)
from priority_results where result_name = 'alice-bootstrap';
insert into priority_results values (
  'alice-plan', api.initialize_growth_plan_v1(
    'goal:d2b2-alice', 600, 45, 90, 120, 'd2b2-alice-plan'
  )
);
reset role;

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', 'e2000000-0000-4000-8000-000000000002',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from pg_catalog.clock_timestamp() + interval '1 hour')::bigint
  )::text,
  true
);
set local role authenticated;
insert into priority_results values (
  'bob-bootstrap', api.bootstrap_personal_workspace('d2b2-bob', 'D2b2 Bob')
);
reset role;

update planning.learning_tracks
set track_key = 'track:a-2',
  title = 'Алгоритмы — café',
  priority = 90,
  protected_minimum_minutes = 120
where learning_track_id = (
  select (response->>'learningTrackId')::uuid
  from priority_results where result_name = 'alice-plan'
);

insert into planning.learning_tracks (
  learning_track_id, workspace_id, growth_plan_id, track_key, title,
  readiness_goal_id, profile_version_id, roadmap_version_id, lifecycle,
  priority, protected_minimum_minutes, default_session_minutes, aggregate_version
)
select
  fixture.learning_track_id, source.workspace_id, source.growth_plan_id,
  fixture.track_key, fixture.title,
  source.readiness_goal_id, source.profile_version_id, source.roadmap_version_id,
  fixture.lifecycle, fixture.priority, fixture.protected_minimum_minutes,
  source.default_session_minutes, 1
from planning.learning_tracks as source
cross join (values
  ('e2000000-0000-4000-8000-000000000010'::uuid,
    'track:a0', 'Active punctuation sibling', 'active', 90, 60),
  ('e2000000-0000-4000-8000-000000000011'::uuid,
    'track:paused', 'Paused sibling', 'paused', 70, 400)
) as fixture(
  learning_track_id, track_key, title, lifecycle, priority,
  protected_minimum_minutes
)
where source.learning_track_id = (
  select (response->>'learningTrackId')::uuid
  from priority_results where result_name = 'alice-plan'
);

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', 'e2000000-0000-4000-8000-000000000001',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from pg_catalog.clock_timestamp() + interval '1 hour')::bigint
  )::text,
  true
);
set local role authenticated;
insert into priority_results values (
  'active-preview', api.preview_learning_track_priority_minimum_v1(
    'track:a-2', 70, 180, '1', '1', 'Перенести café — сейчас.'
  )
);
insert into priority_results values (
  'blocked-preview', api.preview_learning_track_priority_minimum_v1(
    'track:a-2', 90, 600, '1', '1', 'Require too much active capacity.'
  )
);
insert into priority_results values (
  'paused-preview', api.preview_learning_track_priority_minimum_v1(
    'track:paused', 100, 10080, '1', '1', 'Store a paused Track boundary.'
  )
);
reset role;

select ok(
  (select response#>>'{before,title}' = 'Алгоритмы — café'
     and response#>>'{after,priority}' = '70'
     and response#>>'{after,protectedMinimumMinutes}' = '180'
     and response#>>'{after,aggregateVersion}' = '2'
     and response#>>'{constraint,activeProtectedMinimumMinutesBefore}' = '180'
     and response#>>'{constraint,activeProtectedMinimumMinutesAfter}' = '240'
     and response#>>'{constraint,activeTrackCountBefore}' = '2'
     and response#>>'{constraint,activeTrackCountAfter}' = '2'
     and response#>>'{constraint,currentTrackPositionBefore}' = '1'
     and (response#>>'{constraint,currentTrackPositionAfter}')::integer > 1
     and response#>>'{canApply}' = 'true'
     and response->'warnings' = '[]'::jsonb
   from priority_results where result_name = 'active-preview'),
  'active preview binds Unicode, ordering, version, and projected capacity'
);

select ok(
  (select response#>>'{canApply}' = 'false'
     and response#>>'{blockingReasons,0,code}'
       = 'ACTIVE_TRACK_MINIMUM_EXCEEDS_CAPACITY'
     and response#>>'{blockingReasons,0,minimumCapacityMinutes}' = '660'
   from priority_results where result_name = 'blocked-preview'),
  'active proposed minimum above capacity returns the exact blocker'
);

select ok(
  (select response#>>'{canApply}' = 'true'
     and response#>>'{constraint,activeProtectedMinimumMinutesBefore}' = '180'
     and response#>>'{constraint,activeProtectedMinimumMinutesAfter}' = '180'
     and response#>>'{constraint,minimumCapacityIfTargetActiveAfter}' = '10260'
     and response#>>'{constraint,targetActiveStateFitsCapacity}' = 'false'
     and response#>>'{warnings,0,code}' = 'LEARNING_TRACK_PAUSED'
     and response#>>'{warnings,1,code}'
       = 'PAUSED_TRACK_RESUME_WOULD_EXCEED_CAPACITY'
     and response#>>'{warnings,1,minimumCapacityMinutes}' = '10260'
   from priority_results where result_name = 'paused-preview'),
  'paused Track edit is nonblocking and reports its hypothetical resume minimum'
);

select ok(
  not exists (
    select 1 from outbox.command_receipts
    where command_type = 'planning.set_learning_track_priority_minimum'
  )
  and not exists (
    select 1 from outbox.events
    where payload->>'change_kind' = 'TRACK_PRIORITY_MINIMUM_CHANGED'
  ),
  'D2b2 previews have no receipt or outbox effects'
);

savepoint parent_paused_preview;
update planning.growth_plans
set lifecycle = 'paused'
where growth_plan_id = (
  select (response->>'growthPlanId')::uuid
  from priority_results where result_name = 'alice-plan'
);
set local role authenticated;
insert into priority_results values (
  'paused-parent-preview', api.preview_learning_track_priority_minimum_v1(
    'track:paused', 100, 10080, '1', '1', 'Show all ordered warnings.'
  )
);
reset role;
select ok(
  (select response#>>'{warnings,0,code}' = 'PARENT_GROWTH_PLAN_PAUSED'
     and response#>>'{warnings,1,code}' = 'LEARNING_TRACK_PAUSED'
     and response#>>'{warnings,2,code}'
       = 'PAUSED_TRACK_RESUME_WOULD_EXCEED_CAPACITY'
   from priority_results where result_name = 'paused-parent-preview'),
  'parent-paused and Track-paused warnings retain their exact order'
);
rollback to savepoint parent_paused_preview;

set local role authenticated;
select throws_ok(
  $$select api.preview_learning_track_priority_minimum_v1(
    'track:a-2', 90, 120, '1', '1', 'Reject a no-op.'
  )$$,
  '22023',
  'Learning Track priority and minimum proposal is unchanged',
  'the exact current setting pair is rejected as a no-op'
);
select throws_ok(
  $$select api.apply_learning_track_priority_minimum_v1(
    'track:a-2', 90, 600, '1', '1',
    (select response->>'previewDigest' from priority_results
     where result_name = 'blocked-preview'),
    'Require too much active capacity.', 'd2b2-blocked'
  )$$,
  '40001',
  'Learning Track priority and minimum preview is stale',
  'a blocked active preview cannot be applied'
);
insert into priority_results
select 'active-apply', api.apply_learning_track_priority_minimum_v1(
  'track:a-2', 70, 180, '1', '1', response->>'previewDigest',
  'Перенести café — сейчас.', 'd2b2-active-apply'
)
from priority_results where result_name = 'active-preview';
insert into priority_results
select 'active-replay', api.apply_learning_track_priority_minimum_v1(
  'track:a-2', 70, 180, '1', '1', response->>'previewDigest',
  'Перенести café — сейчас.', 'd2b2-active-apply'
)
from priority_results where result_name = 'active-preview';
reset role;

select is(
  (select response from priority_results where result_name = 'active-replay'),
  (select response from priority_results where result_name = 'active-apply'),
  'same-key D2b2 replay returns the byte-identical response'
);

select ok(
  (
    select track.priority = 70
      and track.protected_minimum_minutes = 180
      and track.aggregate_version = 2
      and plan.aggregate_version = 1
      and plan.weekly_capacity_minutes = 600
    from planning.learning_tracks as track
    join planning.growth_plans as plan
      on plan.workspace_id = track.workspace_id
      and plan.growth_plan_id = track.growth_plan_id
    where track.learning_track_id = (
      select (response#>>'{changedTrack,learningTrackId}')::uuid
      from priority_results where result_name = 'active-apply'
    )
  )
  and (
    select bool_and(track.aggregate_version = 1)
    from planning.learning_tracks as track
    where track.learning_track_id in (
      'e2000000-0000-4000-8000-000000000010',
      'e2000000-0000-4000-8000-000000000011'
    )
  ),
  'apply advances only the target Track settings and version'
);

select ok(
  (
    select receipt.command_status = 'completed'
      and receipt.expected_aggregate_version = 1
      and event.event_name = 'planning.input_changed'
      and event.aggregate_type = 'planning.learning_track'
      and event.aggregate_id = (result.response#>>'{changedTrack,learningTrackId}')::uuid
      and event.aggregate_version = 2
      and event.payload = pg_catalog.jsonb_build_object(
        'change_kind', 'TRACK_PRIORITY_MINIMUM_CHANGED',
        'growth_plan_id', (
          select track.growth_plan_id
          from planning.learning_tracks as track
          where track.learning_track_id =
            (result.response#>>'{changedTrack,learningTrackId}')::uuid
        ),
        'learning_track_id', (result.response#>>'{changedTrack,learningTrackId}')::uuid,
        'learning_track_version', '2',
        'priority', 70,
        'protected_minimum_minutes', 180
      )
      and delivery.delivery_id = (result.response->>'planningDeliveryId')::uuid
      and delivery.consumer_name = 'planning.plan_snapshot_v1'
      and delivery.handler_contract_version = 1
    from priority_results as result
    join outbox.command_receipts as receipt
      on receipt.command_id = (result.response->>'commandId')::uuid
    join outbox.events as event
      on event.event_id = (result.response#>>'{emittedEventIds,0}')::uuid
    join outbox.deliveries as delivery on delivery.event_id = event.event_id
    where result.result_name = 'active-apply'
  ),
  'D2b2 commits one exact receipt, event payload, and fixed Planning delivery'
);

set local role authenticated;
insert into priority_results values (
  'order-stale-preview', api.preview_learning_track_priority_minimum_v1(
    'track:a-2', 65, 180, '1', '2', 'Bind every current Track order input.'
  )
);
reset role;
update planning.learning_tracks
set priority = priority + 1,
  aggregate_version = aggregate_version + 1
where learning_track_id = 'e2000000-0000-4000-8000-000000000011';
set local role authenticated;
select throws_ok(
  $$select api.apply_learning_track_priority_minimum_v1(
    'track:a-2', 65, 180, '1', '2',
    (select response->>'previewDigest' from priority_results
     where result_name = 'order-stale-preview'),
    'Bind every current Track order input.', 'd2b2-order-stale'
  )$$,
  '40001',
  'Learning Track priority and minimum preview is stale',
  'paused sibling order-only version change invalidates the exact preview'
);
reset role;

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', 'e2000000-0000-4000-8000-000000000002',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from pg_catalog.clock_timestamp() + interval '1 hour')::bigint
  )::text,
  true
);
set local role authenticated;
select throws_ok(
  $$select api.preview_learning_track_priority_minimum_v1(
    'track:a-2', 50, 100, '1', '2', 'Foreign selector.'
  )$$,
  '42501',
  'Learning Track is unavailable',
  'foreign Track key is non-enumerating through the actor-scoped boundary'
);
reset role;

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', 'e2000000-0000-4000-8000-000000000001',
    'role', 'authenticated', 'aud', 'authenticated',
    'exp', extract(epoch from pg_catalog.clock_timestamp() + interval '1 hour')::bigint
  )::text,
  true
);
set local role authenticated;
insert into priority_results values (
  'rollback-preview', api.preview_learning_track_priority_minimum_v1(
    'track:a-2', 60, 200, '1', '2', 'Prove D2b2 delivery rollback.'
  )
);
reset role;

create function pg_temp.reject_d2b2_delivery()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.consumer_name = 'planning.plan_snapshot_v1'
     and new.workspace_id::text = pg_catalog.current_setting(
       'pando.test.fail_d2b2_delivery_workspace', true
     ) then
    raise exception 'injected D2b2 delivery failure';
  end if;
  return new;
end
$function$;
create trigger reject_d2b2_delivery
before insert on outbox.deliveries
for each row execute function pg_temp.reject_d2b2_delivery();
select set_config(
  'pando.test.fail_d2b2_delivery_workspace',
  (select response->>'workspaceId' from priority_results where result_name = 'alice-plan'),
  true
);

set local role authenticated;
select throws_ok(
  $$select api.apply_learning_track_priority_minimum_v1(
    'track:a-2', 60, 200, '1', '2',
    (select response->>'previewDigest' from priority_results
     where result_name = 'rollback-preview'),
    'Prove D2b2 delivery rollback.', 'd2b2-rollback'
  )$$,
  'P0001',
  'injected D2b2 delivery failure',
  'delivery failure aborts the D2b2 command transaction'
);
reset role;
drop trigger reject_d2b2_delivery on outbox.deliveries;

select ok(
  (
    select priority = 70 and protected_minimum_minutes = 180 and aggregate_version = 2
    from planning.learning_tracks
    where track_key = 'track:a-2'
  )
  and not exists (
    select 1 from outbox.command_receipts where idempotency_key = 'd2b2-rollback'
  )
  and not exists (
    select 1 from outbox.events
    where payload->>'change_kind' = 'TRACK_PRIORITY_MINIMUM_CHANGED'
      and payload->>'priority' = '60'
  ),
  'failed delivery rolls back target, receipt, event, and delivery effects'
);

select ok(
  bool_and(
    case when portfolio.lifecycle = 'active'
      then portfolio.before_total - portfolio.old_minimum + portfolio.new_minimum
        = portfolio.expected_after_total
      else portfolio.before_total = portfolio.expected_after_total
    end
  )
  and bool_and(
    (portfolio.lifecycle = 'active'
      and portfolio.expected_after_total > portfolio.capacity)
      = portfolio.expected_blocked
  ),
  'bounded portfolio property: only projected active minima can block'
)
from (values
  ('active', 180, 120, 540, 600, 600, false),
  ('active', 180, 120, 541, 600, 601, true),
  ('active', 600, 600, 0, 600, 0, false),
  ('paused', 180, 400, 10080, 600, 180, false)
) as portfolio(
  lifecycle, before_total, old_minimum, new_minimum, capacity,
  expected_after_total, expected_blocked
);

select * from finish();
rollback;
