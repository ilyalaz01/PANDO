begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select no_plan();

select has_schema(schema_name, format('%s schema exists', schema_name))
from unnest(array[
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
]) as schemas(schema_name);

select has_table(
  expected.schema_name,
  expected.table_name,
  format('%s.%s table exists', expected.schema_name, expected.table_name)
)
from (values
  ('identity', 'users'),
  ('identity', 'workspaces'),
  ('identity', 'workspace_memberships'),
  ('outbox', 'command_receipts'),
  ('outbox', 'events'),
  ('outbox', 'deliveries'),
  ('outbox', 'consumer_receipts'),
  ('outbox', 'phase0_probe_effects')
) as expected(schema_name, table_name);

select ok(
  class.relrowsecurity and class.relforcerowsecurity,
  format('%s.%s has enabled and forced RLS', namespace.nspname, class.relname)
)
from pg_catalog.pg_class as class
join pg_catalog.pg_namespace as namespace
  on namespace.oid = class.relnamespace
where (namespace.nspname, class.relname) in (
  ('identity', 'users'),
  ('identity', 'workspaces'),
  ('identity', 'workspace_memberships'),
  ('outbox', 'command_receipts'),
  ('outbox', 'events'),
  ('outbox', 'deliveries'),
  ('outbox', 'consumer_receipts'),
  ('outbox', 'phase0_probe_effects')
)
order by namespace.nspname, class.relname;

select ok(
  not pg_catalog.has_table_privilege(
    'authenticated',
    pg_catalog.format('%I.%I', namespace.nspname, class.relname),
    privilege.privilege_name
  ),
  format(
    'authenticated has no direct %s on %s.%s',
    privilege.privilege_name,
    namespace.nspname,
    class.relname
  )
)
from pg_catalog.pg_class as class
join pg_catalog.pg_namespace as namespace
  on namespace.oid = class.relnamespace
cross join (values
  ('SELECT'),
  ('INSERT'),
  ('UPDATE'),
  ('DELETE'),
  ('TRUNCATE'),
  ('REFERENCES'),
  ('TRIGGER')
)
  as privilege(privilege_name)
where (namespace.nspname, class.relname) in (
  ('identity', 'users'),
  ('identity', 'workspaces'),
  ('identity', 'workspace_memberships'),
  ('outbox', 'command_receipts'),
  ('outbox', 'events'),
  ('outbox', 'deliveries'),
  ('outbox', 'consumer_receipts'),
  ('outbox', 'phase0_probe_effects')
)
order by namespace.nspname, class.relname;

select ok(
  not pg_catalog.has_table_privilege(
    'anon',
    pg_catalog.format('%I.%I', namespace.nspname, class.relname),
    privilege.privilege_name
  ),
  format(
    'anon has no direct %s on %s.%s',
    privilege.privilege_name,
    namespace.nspname,
    class.relname
  )
)
from pg_catalog.pg_class as class
join pg_catalog.pg_namespace as namespace
  on namespace.oid = class.relnamespace
cross join (values
  ('SELECT'),
  ('INSERT'),
  ('UPDATE'),
  ('DELETE'),
  ('TRUNCATE'),
  ('REFERENCES'),
  ('TRIGGER')
)
  as privilege(privilege_name)
where (namespace.nspname, class.relname) in (
  ('identity', 'users'),
  ('identity', 'workspaces'),
  ('identity', 'workspace_memberships'),
  ('outbox', 'command_receipts'),
  ('outbox', 'events'),
  ('outbox', 'deliveries'),
  ('outbox', 'consumer_receipts'),
  ('outbox', 'phase0_probe_effects')
)
order by namespace.nspname, class.relname;

select ok(
  not pg_catalog.has_table_privilege(
    'service_role',
    pg_catalog.format('%I.%I', namespace.nspname, class.relname),
    privilege.privilege_name
  ),
  format(
    'service_role has no direct %s on %s.%s',
    privilege.privilege_name,
    namespace.nspname,
    class.relname
  )
)
from pg_catalog.pg_class as class
join pg_catalog.pg_namespace as namespace
  on namespace.oid = class.relnamespace
cross join (values
  ('SELECT'),
  ('INSERT'),
  ('UPDATE'),
  ('DELETE'),
  ('TRUNCATE'),
  ('REFERENCES'),
  ('TRIGGER')
)
  as privilege(privilege_name)
where (namespace.nspname, class.relname) in (
  ('identity', 'users'),
  ('identity', 'workspaces'),
  ('identity', 'workspace_memberships'),
  ('outbox', 'command_receipts'),
  ('outbox', 'events'),
  ('outbox', 'deliveries'),
  ('outbox', 'consumer_receipts'),
  ('outbox', 'phase0_probe_effects')
)
order by namespace.nspname, class.relname;

select ok(
  pg_catalog.has_schema_privilege('authenticated', 'api', 'USAGE'),
  'authenticated can use the api schema'
);

select ok(
  not pg_catalog.has_schema_privilege('authenticated', 'api', 'CREATE'),
  'authenticated cannot create api objects'
);

select ok(
  not pg_catalog.has_schema_privilege('anon', 'api', 'USAGE'),
  'anon cannot use the api schema'
);

select ok(
  not pg_catalog.has_schema_privilege('authenticated', 'outbox', 'USAGE'),
  'authenticated cannot use the outbox schema'
);

select ok(
  not pg_catalog.has_sequence_privilege(
    runtime_role.role_name,
    'outbox.events_event_position_seq',
    sequence_privilege.privilege_name
  ),
  format(
    '%s has no direct %s on the event-position sequence',
    runtime_role.role_name,
    sequence_privilege.privilege_name
  )
)
from (values ('anon'), ('authenticated'), ('service_role'))
  as runtime_role(role_name)
cross join (values ('USAGE'), ('SELECT'), ('UPDATE'))
  as sequence_privilege(privilege_name);

select ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'api.bootstrap_personal_workspace(text,text)',
    'EXECUTE'
  ),
  'authenticated can execute only the user bootstrap RPC'
);

select ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'api.get_workspace(uuid)',
    'EXECUTE'
  ),
  'authenticated can execute the scoped workspace query RPC'
);

select ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'api.get_target_selection_source_v1()',
    'EXECUTE'
  ),
  'authenticated can execute the zero-argument target-selection query'
);

select ok(
  not pg_catalog.has_function_privilege(
    'authenticated',
    'api.claim_phase0_probe_deliveries()',
    'EXECUTE'
  ),
  'authenticated cannot claim worker deliveries'
);

select ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'api.claim_phase0_probe_deliveries()',
    'EXECUTE'
  ),
  'service_role can execute the fixed claim RPC'
);

select ok(
  not pg_catalog.has_function_privilege(
    'anon',
    'api.bootstrap_personal_workspace(text,text)',
    'EXECUTE'
  ),
  'anon cannot execute bootstrap'
);

select ok(
  not procedure.prosecdef,
  format('exposed api function %s is SECURITY INVOKER', procedure.proname)
)
from pg_catalog.pg_proc as procedure
join pg_catalog.pg_namespace as namespace
  on namespace.oid = procedure.pronamespace
where namespace.nspname = 'api'
  and procedure.proname not in (
    'get_current_competency_overlay_v1',
    'save_current_overlay_note_v1',
    'add_current_custom_activity_v1',
    'start_focus_activity_v1',
    'finish_focus_activity_v1',
    'invalidate_evidence_v1',
    'get_focus_workspace_v1',
    'get_focus_from_plan_v1',
    'get_today_workspace_v1',
    'add_learning_track_activity_v1',
    'get_current_growth_plan_v1',
    'preview_growth_plan_lifecycle_v1',
    'apply_growth_plan_lifecycle_v1',
    'preview_growth_plan_capacity_v1',
    'apply_growth_plan_capacity_v1',
    'get_current_learning_tracks_v1',
    'preview_learning_track_lifecycle_v1',
    'apply_learning_track_lifecycle_v1',
    'get_learning_track_terminal_lifecycle_source_v1',
    'preview_learning_track_terminal_lifecycle_v1',
    'apply_learning_track_terminal_lifecycle_v1',
    'preview_learning_track_priority_minimum_v1',
    'apply_learning_track_priority_minimum_v1',
    'get_growth_plan_setup_source_v1',
    'preview_growth_plan_initialization_v1',
    'apply_growth_plan_initialization_v1',
    'get_learning_track_creation_source_v1',
    'preview_learning_track_creation_v1',
    'apply_learning_track_creation_v1',
    'get_learning_track_activity_admission_source_v1',
    'preview_learning_track_activity_admission_v1',
    'apply_learning_track_activity_admission_v1',
    'get_learning_track_activity_admission_source_v2',
    'preview_learning_track_activity_admission_v2',
    'apply_learning_track_activity_admission_v2',
    'start_focus_from_plan_v1',
    'create_personal_review_reminder_v1',
    'reschedule_review_reason_v1',
    'skip_review_reason_once_v1',
    'suppress_review_reason_v1',
    'restore_review_reason_v1',
    'get_review_workspace_v1'
  )
order by procedure.proname;

select ok(
  procedure.prosecdef
  and 'search_path=""' = any(coalesce(procedure.proconfig, '{}'::text[]))
  and owner.rolname = 'pando_review_api'
  and not owner.rolcanlogin
  and not owner.rolinherit
  and not owner.rolbypassrls,
  format('scoped api definer %s is pinned and owned by the Review NOLOGIN role', procedure.proname)
)
from pg_catalog.pg_proc as procedure
join pg_catalog.pg_namespace as namespace
  on namespace.oid = procedure.pronamespace
join pg_catalog.pg_roles as owner
  on owner.oid = procedure.proowner
where namespace.nspname = 'api'
  and procedure.proname in (
    'create_personal_review_reminder_v1',
    'reschedule_review_reason_v1',
    'skip_review_reason_once_v1',
    'suppress_review_reason_v1',
    'restore_review_reason_v1',
    'get_review_workspace_v1'
  )
order by procedure.proname;

select ok(
  procedure.prosecdef
  and 'search_path=""' = any(coalesce(procedure.proconfig, '{}'::text[]))
  and owner.rolname = 'pando_phase1_api'
  and not owner.rolcanlogin
  and not owner.rolinherit
  and not owner.rolbypassrls,
  format('scoped api definer %s is pinned and owned by the Phase 1 NOLOGIN role', procedure.proname)
)
from pg_catalog.pg_proc as procedure
join pg_catalog.pg_namespace as namespace
  on namespace.oid = procedure.pronamespace
join pg_catalog.pg_roles as owner
  on owner.oid = procedure.proowner
where namespace.nspname = 'api'
  and procedure.proname in (
    'get_current_competency_overlay_v1',
    'save_current_overlay_note_v1',
    'add_current_custom_activity_v1'
  )
order by procedure.proname;

select ok(
  procedure.prosecdef
  and 'search_path=""' = any(coalesce(procedure.proconfig, '{}'::text[]))
  and owner.rolname = 'pando_phase2_api'
  and not owner.rolcanlogin
  and not owner.rolinherit
  and not owner.rolbypassrls,
  format('scoped api definer %s is pinned and owned by the Phase 2 NOLOGIN role', procedure.proname)
)
from pg_catalog.pg_proc as procedure
join pg_catalog.pg_namespace as namespace
  on namespace.oid = procedure.pronamespace
join pg_catalog.pg_roles as owner
  on owner.oid = procedure.proowner
where namespace.nspname = 'api'
  and procedure.proname in (
    'start_focus_activity_v1',
    'finish_focus_activity_v1',
    'invalidate_evidence_v1',
    'get_focus_workspace_v1',
    'get_focus_from_plan_v1',
    'start_focus_from_plan_v1'
  )
order by procedure.proname;

select ok(
  procedure.prosecdef
  and 'search_path=""' = any(coalesce(procedure.proconfig, '{}'::text[]))
  and owner.rolname = 'pando_planning_api'
  and not owner.rolcanlogin
  and not owner.rolinherit
  and not owner.rolbypassrls,
  format('scoped api definer %s is pinned and owned by the Planning NOLOGIN role', procedure.proname)
)
from pg_catalog.pg_proc as procedure
join pg_catalog.pg_namespace as namespace
  on namespace.oid = procedure.pronamespace
join pg_catalog.pg_roles as owner
  on owner.oid = procedure.proowner
where namespace.nspname = 'api'
  and procedure.proname in (
    'get_today_workspace_v1',
    'add_learning_track_activity_v1',
    'get_current_growth_plan_v1',
    'preview_growth_plan_lifecycle_v1',
    'apply_growth_plan_lifecycle_v1',
    'preview_growth_plan_capacity_v1',
    'apply_growth_plan_capacity_v1',
    'get_current_learning_tracks_v1',
    'preview_learning_track_lifecycle_v1',
    'apply_learning_track_lifecycle_v1',
    'get_learning_track_terminal_lifecycle_source_v1',
    'preview_learning_track_terminal_lifecycle_v1',
    'apply_learning_track_terminal_lifecycle_v1',
    'preview_learning_track_priority_minimum_v1',
    'apply_learning_track_priority_minimum_v1',
    'get_growth_plan_setup_source_v1',
    'preview_growth_plan_initialization_v1',
    'apply_growth_plan_initialization_v1',
    'get_learning_track_creation_source_v1',
    'preview_learning_track_creation_v1',
    'apply_learning_track_creation_v1',
    'get_learning_track_activity_admission_source_v1',
    'preview_learning_track_activity_admission_v1',
    'apply_learning_track_activity_admission_v1',
    'get_learning_track_activity_admission_source_v2',
    'preview_learning_track_activity_admission_v2',
    'apply_learning_track_activity_admission_v2'
  );

select ok(
  procedure.prosecdef
  and 'search_path=""' = any(coalesce(procedure.proconfig, '{}'::text[]))
  and owner.rolname in (
    'pando_rls_authorizer', 'pando_identity_api', 'pando_outbox_worker',
    'pando_mastery_worker', 'pando_mastery_scheduler', 'pando_review_worker',
    'pando_review_scheduler', 'pando_readiness_worker', 'pando_readiness_scheduler',
    'pando_planning_worker', 'pando_planning_scheduler', 'pando_planning_router',
    'pando_identity_planning_source', 'pando_phase1_planning_source',
    'pando_phase2_planning_source', 'pando_evidence_planning_source',
    'pando_review_planning_source', 'pando_mastery_planning_source'
  )
  and not owner.rolcanlogin,
  format('private definer %s is pinned and owned by a NOLOGIN role', procedure.proname)
)
from pg_catalog.pg_proc as procedure
join pg_catalog.pg_namespace as namespace
  on namespace.oid = procedure.pronamespace
join pg_catalog.pg_roles as owner
  on owner.oid = procedure.proowner
where namespace.nspname in ('identity', 'outbox')
  and procedure.prosecdef
order by namespace.nspname, procedure.proname;

select ok(
  authorizer.rolbypassrls
  and not authorizer.rolcanlogin
  and not authorizer.rolinherit,
  'RLS authorizer is the single NOLOGIN/NOINHERIT BYPASSRLS exception'
)
from pg_catalog.pg_roles as authorizer
where authorizer.rolname = 'pando_rls_authorizer';

select ok(
  not role.rolbypassrls and not role.rolcanlogin and not role.rolinherit,
  format('%s is NOLOGIN/NOINHERIT/NOBYPASSRLS', role.rolname)
)
from pg_catalog.pg_roles as role
where role.rolname in (
  'pando_identity_api', 'pando_outbox_worker', 'pando_mastery_worker',
  'pando_mastery_scheduler', 'pando_review_worker', 'pando_review_scheduler',
  'pando_readiness_worker', 'pando_readiness_scheduler',
  'pando_planning_worker', 'pando_planning_scheduler', 'pando_planning_router',
  'pando_identity_planning_source', 'pando_phase1_planning_source',
  'pando_phase2_planning_source', 'pando_evidence_planning_source',
  'pando_review_planning_source', 'pando_mastery_planning_source',
  'pando_today_reader'
)
order by role.rolname;

select ok(
  not pg_catalog.pg_has_role(runtime_role.role_name, source_role.role_name, 'MEMBER'),
  format('%s cannot SET ROLE to %s', runtime_role.role_name, source_role.role_name)
)
from (values ('anon'), ('authenticated'), ('service_role')) as runtime_role(role_name)
cross join (values
  ('pando_identity_planning_source'),
  ('pando_phase1_planning_source'),
  ('pando_phase2_planning_source'),
  ('pando_evidence_planning_source'),
  ('pando_mastery_planning_source'),
  ('pando_review_planning_source'),
  ('pando_planning_router'),
  ('pando_today_reader')
) as source_role(role_name)
order by runtime_role.role_name, source_role.role_name;

select ok(
  procedure.prosecdef
  and 'search_path=""' = any(coalesce(procedure.proconfig, '{}'::text[]))
  and owner.rolname = expected.owner_name
  and not owner.rolcanlogin and not owner.rolinherit and not owner.rolbypassrls,
  format('%s.%s is pinned to its bounded NOLOGIN owner', expected.schema_name, expected.function_name)
)
from (values
  ('identity', 'read_planning_calendar_source_v1', 'pando_identity_planning_source'),
  ('overlay', 'assert_planning_candidate_origins_v1', 'pando_phase1_planning_source'),
  ('overlay', 'read_planning_candidate_source_v1', 'pando_phase1_planning_source'),
  ('targets', 'read_planning_readiness_source_v1', 'pando_phase1_planning_source'),
  ('catalog', 'read_planning_graph_source_v1', 'pando_phase1_planning_source'),
  ('catalog', 'read_planning_graph_source_v2', 'pando_phase1_planning_source'),
  ('sessions', 'read_planning_focus_source_v1', 'pando_phase2_planning_source'),
  ('sessions', 'read_planning_completed_work_source_v1', 'pando_phase2_planning_source'),
  ('evidence', 'read_planning_completed_work_source_v1', 'pando_evidence_planning_source'),
  ('evidence', 'read_planning_completed_work_source_v2', 'pando_evidence_planning_source'),
  ('mastery', 'read_planning_mastery_source_v1', 'pando_mastery_worker'),
  ('mastery', 'read_planning_prerequisite_source_v1', 'pando_mastery_planning_source'),
  ('review', 'read_planning_review_source_v1', 'pando_review_planning_source')
) as expected(schema_name, function_name, owner_name)
join pg_catalog.pg_namespace as namespace on namespace.nspname = expected.schema_name
join pg_catalog.pg_proc as procedure
  on procedure.pronamespace = namespace.oid and procedure.proname = expected.function_name
join pg_catalog.pg_roles as owner on owner.oid = procedure.proowner
order by expected.schema_name, expected.function_name;

select ok(
  not exists (
    select 1
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    cross join lateral pg_catalog.aclexplode(
      coalesce(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
    ) as privilege
    where namespace.nspname in ('api', 'identity', 'outbox')
      and privilege.grantee = 0
      and privilege.privilege_type = 'EXECUTE'
  ),
  'PUBLIC has EXECUTE on no Phase 0 function'
);

select * from finish();
rollback;
