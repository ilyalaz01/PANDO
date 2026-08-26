begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set local search_path = public, extensions;

create temporary table phase1_publication_role(
  connection_role text primary key,
  connection_password text not null
) on commit preserve rows;
insert into phase1_publication_role
values(
  'pando_pgtap_publish_' || left(replace(gen_random_uuid()::text,'-',''),16),
  gen_random_uuid()::text
);

do $create_publication_role$
declare
  fixture phase1_publication_role%rowtype;
  qualified_table text;
begin
  select * into strict fixture from phase1_publication_role;
  execute format(
    'create role %I login noinherit password %L',
    fixture.connection_role,
    fixture.connection_password
  );
  execute format('grant usage on schema catalog, targets, overlay to %I',fixture.connection_role);
  execute format(
    'grant select on all tables in schema catalog, targets, overlay to %I',
    fixture.connection_role
  );
  execute format(
    'grant insert on catalog.competency_edges, catalog.roadmap_template_items, targets.target_requirement_members to %I',
    fixture.connection_role
  );
  execute format(
    'grant update on catalog.catalog_versions, catalog.roadmap_template_versions, targets.target_profile_versions to %I',
    fixture.connection_role
  );
  execute format(
    'grant execute on function catalog.validate_version_for_publication(uuid), catalog.validate_roadmap_for_publication(uuid), targets.validate_profile_for_publication(uuid) to %I',
    fixture.connection_role
  );
  foreach qualified_table in array array[
    'catalog.catalog_versions',
    'catalog.items',
    'catalog.competency_edges',
    'catalog.roadmap_template_series',
    'catalog.roadmap_template_versions',
    'catalog.roadmap_template_items',
    'targets.target_profile_series',
    'targets.target_profile_versions',
    'targets.target_requirement_rules',
    'targets.target_requirement_members',
    'overlay.personal_competencies'
  ]
  loop
    execute format(
      'create policy pgtap_publication_race_access on %s for all to %I using (true) with check (true)',
      qualified_table,
      fixture.connection_role
    );
  end loop;
end
$create_publication_role$;

insert into catalog.catalog_versions(
  catalog_version_id,catalog_version_key,version_number,changelog
) values(
  'e1000000-0000-4000-8000-000000000001','catalog:publication-race-v1',101,
  'Publication concurrency fixture.'
);
insert into catalog.items(
  catalog_version_id,item_key,item_type,slug,title,description,domain_item_key
) values
  ('e1000000-0000-4000-8000-000000000001','domain:publication-race','DOMAIN','publication-race','Publication race','Publication race domain.',null),
  ('e1000000-0000-4000-8000-000000000001','competency:publication-race','COMPETENCY','publication-race-competency','Publication race competency','Publication race competency.','domain:publication-race');

insert into catalog.roadmap_template_series(roadmap_series_id,roadmap_series_key)
values('e2000000-0000-4000-8000-000000000001','roadmap-series:publication-race');
insert into catalog.roadmap_template_versions(
  roadmap_version_id,roadmap_version_key,roadmap_series_id,catalog_version_id,
  version_number,changelog
) values(
  'e2010000-0000-4000-8000-000000000001','roadmap:publication-race-v1',
  'e2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001',
  101,'Publication concurrency fixture.'
);
insert into catalog.roadmap_template_items(roadmap_version_id,catalog_item_key,sort_order)
values('e2010000-0000-4000-8000-000000000001','competency:python-error-handling',1);

insert into targets.target_profile_series(
  profile_series_id,profile_series_key,profile_scope
) values(
  'e3000000-0000-4000-8000-000000000001','target-series:publication-race','canonical'
);
insert into targets.target_profile_versions(
  profile_version_id,profile_version_key,profile_series_id,catalog_version_id,
  roadmap_version_id,version_number,role_title,source_summary,freshness_status,
  reviewed_at,root_rule_key,readiness_threshold
) values(
  'e3010000-0000-4000-8000-000000000001','target:publication-race-v1',
  'e3000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001',
  'a2010000-0000-4000-8000-000000000001',101,'Publication race target',
  'Publication concurrency fixture.','initial_curated_assumption','2026-08-26',
  'rule:publication-race-root',0.8
);
insert into targets.target_requirement_rules(
  requirement_rule_id,profile_version_id,rule_key,rule_type,title,criticality,
  explanation,accessibility_label
) values(
  'e3020000-0000-4000-8000-000000000001','e3010000-0000-4000-8000-000000000001',
  'rule:publication-race-root','ALL','Publication race root','MANDATORY',
  'Valid before the concurrent invalid child arrives.','Publication race root requirement.'
);
insert into targets.target_requirement_members(
  profile_version_id,requirement_rule_id,member_order,member_type,node_scope,
  node_kind,node_ref,objective_dimension,required_level
) values(
  'e3010000-0000-4000-8000-000000000001','e3020000-0000-4000-8000-000000000001',
  1,'NODE','canonical','COMPETENCY','competency:python-error-handling','APPLICATION','VERIFIED'
);
commit;

begin;
set local search_path = public, extensions;
select no_plan();

create temporary table phase1_publication_results(
  case_name text primary key,
  waited_on_lock boolean not null,
  publication_error_state text,
  publication_error_message text,
  publication_result text
);

do $assert_password_route$
declare
  v_server_addr inet := inet_server_addr();
begin
  if v_server_addr is null
     or v_server_addr << inet '127.0.0.0/8'
     or v_server_addr = inet '::1' then
    raise exception using
      errcode = '08001',
      message = 'publication concurrency test requires a non-loopback password-authenticated connection';
  end if;
end
$assert_password_route$;

select is(
  extensions.dblink_connect(
    'phase1_publish_child',
    format(
      'hostaddr=%s port=%s dbname=%L user=%L password=%L application_name=pando_pgtap_publish_child',
      host(inet_server_addr()),current_setting('port'),current_database(),
      (select connection_role from phase1_publication_role),
      (select connection_password from phase1_publication_role)
    )
  ),
  'OK','publication-race child session connects with its ephemeral password'
);
select is(
  extensions.dblink_connect(
    'phase1_publish_catalog',
    format(
      'hostaddr=%s port=%s dbname=%L user=%L password=%L application_name=pando_pgtap_publish_catalog',
      host(inet_server_addr()),current_setting('port'),current_database(),
      (select connection_role from phase1_publication_role),
      (select connection_password from phase1_publication_role)
    )
  ),
  'OK','Catalog publisher session connects with its ephemeral password'
);
select is(
  extensions.dblink_connect(
    'phase1_publish_roadmap',
    format(
      'hostaddr=%s port=%s dbname=%L user=%L password=%L application_name=pando_pgtap_publish_roadmap',
      host(inet_server_addr()),current_setting('port'),current_database(),
      (select connection_role from phase1_publication_role),
      (select connection_password from phase1_publication_role)
    )
  ),
  'OK','Roadmap publisher session connects with its ephemeral password'
);
select is(
  extensions.dblink_connect(
    'phase1_publish_target',
    format(
      'hostaddr=%s port=%s dbname=%L user=%L password=%L application_name=pando_pgtap_publish_target',
      host(inet_server_addr()),current_setting('port'),current_database(),
      (select connection_role from phase1_publication_role),
      (select connection_password from phase1_publication_role)
    )
  ),
  'OK','Target Profile publisher session connects with its ephemeral password'
);

create temporary table phase1_publication_sessions(case_name text primary key,pid integer not null);
insert into phase1_publication_sessions
select 'catalog',session.pid
from extensions.dblink('phase1_publish_catalog','select pg_backend_pid()') as session(pid integer)
union all
select 'roadmap',session.pid
from extensions.dblink('phase1_publish_roadmap','select pg_backend_pid()') as session(pid integer)
union all
select 'target',session.pid
from extensions.dblink('phase1_publish_target','select pg_backend_pid()') as session(pid integer);

create function pg_temp.run_publication_race(
  p_case_name text,
  p_child_sql text,
  p_publication_sql text
)
returns void
language plpgsql
set search_path = ''
as $function$
declare
  v_waited boolean := false;
  v_error_state text;
  v_error_message text;
  v_result text;
  v_parent_connection text := 'phase1_publish_' || p_case_name;
begin
  perform extensions.dblink_exec('phase1_publish_child','begin');
  perform extensions.dblink_exec('phase1_publish_child',p_child_sql);
  if extensions.dblink_send_query(
    v_parent_connection,
    p_publication_sql || ' returning ''published''::text'
  ) <> 1 then
    raise exception 'could not dispatch publication race %',p_case_name;
  end if;

  for attempt in 1..200 loop
    perform extensions.dblink_is_busy(v_parent_connection);
    select exists(
      select 1
      from pg_catalog.pg_locks as held_lock
      where held_lock.pid=(
        select session.pid
        from pg_temp.phase1_publication_sessions as session
        where session.case_name=p_case_name
      )
        and held_lock.locktype='advisory'
        and not held_lock.granted
    ) into v_waited;
    exit when v_waited;
    perform pg_catalog.pg_sleep(0.01);
  end loop;

  perform extensions.dblink_exec('phase1_publish_child','commit');
  begin
    select remote.result into v_result
    from extensions.dblink_get_result(v_parent_connection) as remote(result text);
  exception
    when others then
      get stacked diagnostics
        v_error_state=returned_sqlstate,
        v_error_message=message_text;
  end;
  perform count(*)
  from extensions.dblink_get_result(v_parent_connection) as remote(result text);
  insert into pg_temp.phase1_publication_results(
    case_name,waited_on_lock,publication_error_state,
    publication_error_message,publication_result
  ) values(
    p_case_name,v_waited,v_error_state,v_error_message,v_result
  );
exception
  when others then
    begin
      perform extensions.dblink_exec('phase1_publish_child','rollback');
    exception when others then
      null;
    end;
    raise;
end
$function$;

select pg_temp.run_publication_race(
  'catalog',
  $sql$/*pando-publication-race:catalog-child*/
    insert into catalog.competency_edges(
      catalog_version_id,edge_key,from_competency_key,to_competency_key,
      edge_type,blocking,rationale
    ) values(
      'e1000000-0000-4000-8000-000000000001',
      'edge:prerequisite:publication-race-domain:publication-race-competency',
      'domain:publication-race','competency:publication-race',
      'PREREQUISITE_OF',true,'Invalid domain endpoint inserted during publication.'
    )$sql$,
  $sql$/*pando-publication-race:catalog*/
    update catalog.catalog_versions
    set lifecycle='published',published_at=clock_timestamp()
    where catalog_version_id='e1000000-0000-4000-8000-000000000001'$sql$
);
select pg_temp.run_publication_race(
  'roadmap',
  $sql$/*pando-publication-race:roadmap-child*/
    insert into catalog.roadmap_template_items(
      roadmap_version_id,catalog_item_key,sort_order
    ) values(
      'e2010000-0000-4000-8000-000000000001','competency:not-in-seed-catalog',2
    )$sql$,
  $sql$/*pando-publication-race:roadmap*/
    update catalog.roadmap_template_versions
    set lifecycle='published',published_at=clock_timestamp()
    where roadmap_version_id='e2010000-0000-4000-8000-000000000001'$sql$
);
select pg_temp.run_publication_race(
  'target',
  $sql$/*pando-publication-race:target-child*/
    insert into targets.target_requirement_members(
      profile_version_id,requirement_rule_id,member_order,member_type,node_scope,
      node_kind,node_ref,objective_dimension,required_level
    ) values(
      'e3010000-0000-4000-8000-000000000001','e3020000-0000-4000-8000-000000000001',
      2,'NODE','canonical','COMPETENCY','competency:not-in-seed-catalog','APPLICATION','VERIFIED'
    )$sql$,
  $sql$/*pando-publication-race:target*/
    update targets.target_profile_versions
    set lifecycle='published',published_at=clock_timestamp()
    where profile_version_id='e3010000-0000-4000-8000-000000000001'$sql$
);

select ok(
  (select waited_on_lock from phase1_publication_results where case_name='catalog'),
  'Catalog publication waits for the concurrent child transaction'
);
select is(
  (select publication_error_state from phase1_publication_results where case_name='catalog'),
  '23514','Catalog publication rejects the committed invalid concurrent edge'
);
select is(
  (select publication_error_message from phase1_publication_results where case_name='catalog'),
  'prerequisite endpoints must be competencies',
  'Catalog concurrency failure preserves the exact invariant error'
);
select is(
  (select lifecycle from catalog.catalog_versions
    where catalog_version_id='e1000000-0000-4000-8000-000000000001'),
  'draft','invalid concurrently changed Catalog remains draft'
);

select ok(
  (select waited_on_lock from phase1_publication_results where case_name='roadmap'),
  'Roadmap publication waits for the concurrent child transaction'
);
select is(
  (select publication_error_state from phase1_publication_results where case_name='roadmap'),
  '23514','Roadmap publication rejects the committed invalid concurrent item'
);
select is(
  (select publication_error_message from phase1_publication_results where case_name='roadmap'),
  'roadmap item must exist in its exact catalog version',
  'Roadmap concurrency failure preserves the exact invariant error'
);
select is(
  (select lifecycle from catalog.roadmap_template_versions
    where roadmap_version_id='e2010000-0000-4000-8000-000000000001'),
  'draft','invalid concurrently changed Roadmap remains draft'
);

select ok(
  (select waited_on_lock from phase1_publication_results where case_name='target'),
  'Target Profile publication waits for the concurrent requirement transaction'
);
select is(
  (select publication_error_state from phase1_publication_results where case_name='target'),
  '23514','Target Profile publication rejects the committed invalid concurrent requirement'
);
select is(
  (select publication_error_message from phase1_publication_results where case_name='target'),
  'target requirement references an unavailable node',
  'Target Profile concurrency failure preserves the exact invariant error'
);
select is(
  (select lifecycle from targets.target_profile_versions
    where profile_version_id='e3010000-0000-4000-8000-000000000001'),
  'draft','invalid concurrently changed Target Profile remains draft'
);

select is(extensions.dblink_disconnect('phase1_publish_child'),'OK','publication child session disconnects');
select is(extensions.dblink_disconnect('phase1_publish_catalog'),'OK','Catalog publisher session disconnects');
select is(extensions.dblink_disconnect('phase1_publish_roadmap'),'OK','Roadmap publisher session disconnects');
select is(extensions.dblink_disconnect('phase1_publish_target'),'OK','Target Profile publisher session disconnects');
select * from finish();
commit;

do $cleanup_publication_role$
declare
  fixture phase1_publication_role%rowtype;
  qualified_table text;
begin
  select * into strict fixture from phase1_publication_role;
  foreach qualified_table in array array[
    'catalog.catalog_versions',
    'catalog.items',
    'catalog.competency_edges',
    'catalog.roadmap_template_series',
    'catalog.roadmap_template_versions',
    'catalog.roadmap_template_items',
    'targets.target_profile_series',
    'targets.target_profile_versions',
    'targets.target_requirement_rules',
    'targets.target_requirement_members',
    'overlay.personal_competencies'
  ]
  loop
    execute format('drop policy pgtap_publication_race_access on %s',qualified_table);
  end loop;
  execute format(
    'revoke all privileges on all tables in schema catalog, targets, overlay from %I',
    fixture.connection_role
  );
  execute format(
    'revoke execute on function catalog.validate_version_for_publication(uuid), catalog.validate_roadmap_for_publication(uuid), targets.validate_profile_for_publication(uuid) from %I',
    fixture.connection_role
  );
  execute format('revoke usage on schema catalog, targets, overlay from %I',fixture.connection_role);
  execute format('drop role %I',fixture.connection_role);
end
$cleanup_publication_role$;
