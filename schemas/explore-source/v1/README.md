# ExploreSourceV1 server query contract

`ExploreSourceV1` is the strict, versioned DTO returned by the authenticated
`api.get_explore_source_v1` read RPC and consumed only by PANDO's server-side Explore data-access
layer. It contains the authorized Catalog, Targets selection, accepted User Overlay structure, and
goal-scoped absolute position overrides required as one input to the Explore composer.

It is **not** `GraphProjectionV1` and is not a source of Mastery or readiness truth. A production
materializer must also receive purpose-specific target requirements, versioned Mastery projections,
a Targets-owned readiness snapshot, semantic watermarks, and an explicit clock before it can emit a
complete `GraphProjectionV1`. Until those inputs exist, `/explore` keeps its explicitly labelled
representative fixture and must not silently substitute it after an authentication, authorization,
RPC, or contract failure.

## Boundary and security invariants

- The browser never calls this domain read directly. A `server-only` DAL passes an authenticated
  user-scoped Supabase client; service-role credentials are forbidden for ordinary reads.
- The public API is a pinned security-invoker composer. It calls separate least-privilege Targets,
  Catalog, and Overlay owner queries; Targets and Overlay repeat authenticated-subject and
  workspace-membership checks. The server decoder then binds every returned overlay edge and
  position to the selected root scope and fails closed on any correlation mismatch.
- The response is a minimal structural DTO. Notes, evidence bodies, hidden proposals, foreign
  workspace nodes, client viewport state, and calculation guesses are forbidden.
- Root, node, edge, and position objects reject unknown fields. The TypeScript decoder reconstructs
  a plain DTO after structural and semantic validation rather than returning an untrusted object.
- Counts, stable ordering, uniqueness, references, origin/workspace coherence, endpoint types,
  selected-activity evidence cardinality, position goal/profile scope, and the prerequisite DAG are
  validated before a future materializer can observe the source. Overlay edges carry their own
  workspace provenance; positions carry workspace, readiness-goal, and profile identities.
- Authorization and missing-resource errors collapse into the same safe application error. An
  invalid successful response fails closed; there is no catch-all demo fallback.
- Workspace data is request-scoped and must not enter a shared Next.js cache.

## Compatibility

The SQL response carries `{ "name": "ExploreSourceV1", "version": "1.0.0" }`. Additive optional
fields still require an intentional schema and decoder update because this security boundary uses
`additionalProperties: false`. Required-field, ownership, or semantic changes require a new
contract version plus compatible RPC and consumer migration.

`overlayVersion` is a decimal string because its database source is a PostgreSQL `bigint`; keeping
it textual prevents JavaScript precision loss. `roadmapVersionKey` is nullable because a published
Target Profile may intentionally omit a roadmap template.

The v1 Catalog owner query intentionally returns the complete active exact-version catalog as a
wide structural input. The future `GraphProjectionV1` materializer must also consume a bounded
roadmap-membership/target-requirement closure query before deciding which nodes are target-visible;
the presence of `roadmapVersionKey` alone does not claim that filtering has already happened.
