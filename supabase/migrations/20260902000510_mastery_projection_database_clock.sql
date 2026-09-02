-- Keep the Mastery evaluation clock on the same authoritative database timeline as Evidence.
-- A host/container clock skew must never make newly committed Evidence appear to be from the future.

create or replace function api.load_mastery_evidence_projection_v1(
  p_delivery_id uuid,
  p_lease_token uuid
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_input jsonb;
  v_calculation_as_of timestamptz := pg_catalog.statement_timestamp();
begin
  v_input := mastery.load_evidence_projection_input_impl(p_delivery_id, p_lease_token);
  if v_input is null then
    return null;
  end if;
  return v_input || pg_catalog.jsonb_build_object(
    'calculationAsOf',
    pg_catalog.to_char(
      v_calculation_as_of at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
    )
  );
end
$function$;

revoke all on function api.load_mastery_evidence_projection_v1(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function api.load_mastery_evidence_projection_v1(uuid, uuid)
  to service_role;

comment on function api.load_mastery_evidence_projection_v1(uuid, uuid) is
  'Loads authoritative Mastery input plus a database-issued explicit calculation clock.';
