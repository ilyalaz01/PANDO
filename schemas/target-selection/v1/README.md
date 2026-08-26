# TargetSelectionSourceV1 server query contract

`TargetSelectionSourceV1` is the strict response from the zero-argument authenticated
`api.get_target_selection_source_v1` read projection. It lets the server render the current
personal workspace, available published Target Profile versions, and persisted Readiness Goals
without accepting a workspace identifier from the browser, URL, cookie, or JWT metadata.

The read projection owns no domain facts. Identity derives the personal workspace from the
verified authentication subject and a current database membership. Targets returns the available
profile and readiness-goal facts for that workspace, while Catalog resolves their exact catalog and
roadmap version keys. The `api` function only composes those owner queries; no owner reads another
bounded context's private tables.

## Security and compatibility

- The browser never calls this RPC. A `server-only` DAL first verifies the Supabase session with
  `getClaims()` and then uses the same request-scoped publishable-key client fixed to the `api`
  schema. Service-role or secret-key clients are forbidden.
- A user who has never created a personal workspace is represented by `workspace: null` with empty
  profile and goal arrays. A revoked membership fails closed instead of looking like first use.
  Workspace bootstrap is a separate idempotent Identity command and never runs as a render side
  effect.
- Workspace identifiers are present only so the server can bind subsequent owning commands. UI
  actions do not accept them from the client.
- Profile provenance includes `sourceSummary`, `freshnessStatus`, and `reviewedAt`; the seeded
  target therefore remains visibly an initial curated assumption rather than employer truth.
- Unknown fields, unsafe text, invalid identifiers, unstable ordering, duplicate identifiers, and
  impossible missing-workspace payloads fail closed before rendering.
- `aggregateVersion` is a decimal string so PostgreSQL `bigint` values cannot lose precision in
  JavaScript.

The exact contract marker is `{ "name": "TargetSelectionSourceV1", "version": "1.0.0" }`.
Any field change requires an intentional schema, SQL, decoder, fixture, and consumer update.
The committed generated Supabase type surface is also compared with the migrated temporary
database by `pnpm verify:auth`.
