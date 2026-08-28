begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_proc as proc
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = proc.pronamespace
    where namespace.nspname = 'api'
      and proc.proname like '%\_without\_planning\_v1' escape '\'
  ),
  0,
  'private coordinator implementations are absent from the generated API surface'
);

select ok(
  pg_catalog.to_regprocedure(
    'overlay.add_current_custom_activity_without_planning_v1(text,text,text,text,text,text,text)'
  ) is not null
  and pg_catalog.to_regprocedure(
    'sessions.start_focus_activity_without_planning_v1(text,text,smallint,text)'
  ) is not null
  and pg_catalog.to_regprocedure(
    'sessions.finish_focus_activity_without_planning_v1(uuid,bigint,text,text,boolean,text)'
  ) is not null
  and pg_catalog.to_regprocedure(
    'evidence.invalidate_evidence_without_planning_v1(uuid,text,text)'
  ) is not null,
  'each coordinator implementation resides in its authoritative owner schema'
);

select ok(
  not pg_catalog.has_function_privilege(
    'authenticated',
    'overlay.add_current_custom_activity_without_planning_v1(text,text,text,text,text,text,text)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated',
    'sessions.start_focus_activity_without_planning_v1(text,text,smallint,text)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated',
    'sessions.finish_focus_activity_without_planning_v1(uuid,bigint,text,text,boolean,text)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated',
    'evidence.invalidate_evidence_without_planning_v1(uuid,text,text)',
    'EXECUTE'
  ),
  'authenticated cannot execute private coordinator implementations'
);

select ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'api.add_current_custom_activity_v1(text,text,text,text,text,text,text)',
    'EXECUTE'
  )
  and pg_catalog.has_function_privilege(
    'authenticated',
    'api.start_focus_activity_v1(text,text,smallint,text)',
    'EXECUTE'
  )
  and pg_catalog.has_function_privilege(
    'authenticated',
    'api.finish_focus_activity_v1(uuid,bigint,text,text,boolean,text)',
    'EXECUTE'
  )
  and pg_catalog.has_function_privilege(
    'authenticated',
    'api.invalidate_evidence_v1(uuid,text,text)',
    'EXECUTE'
  ),
  'authenticated retains only the public coordinator wrappers'
);

select ok(
  not pg_catalog.has_schema_privilege('pando_phase1_api', 'overlay', 'CREATE')
  and not pg_catalog.has_schema_privilege('pando_phase1_api', 'api', 'CREATE')
  and not pg_catalog.has_schema_privilege('pando_phase2_api', 'sessions', 'CREATE')
  and not pg_catalog.has_schema_privilege('pando_phase2_api', 'evidence', 'CREATE')
  and not pg_catalog.has_schema_privilege('pando_phase2_api', 'api', 'CREATE'),
  'temporary schema creation privileges are revoked after the roll-forward migration'
);

select * from finish();
rollback;
