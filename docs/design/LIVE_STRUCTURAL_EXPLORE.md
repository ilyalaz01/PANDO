# Live structural Explore before Mastery

Status: Accepted implementation clarification
Date: 2026-08-27
Owner: server-side Explore read-projection composer

## Outcome

Phase 1 must show the selected persisted target as a live, stable Map and Outline before Phase 2
creates evidence and Mastery projections. The existing `GraphProjectionV1` cannot represent that
state honestly: it requires a versioned competency state and a complete Targets-owned readiness
result. Filling those fields from an empty array or a fixture would turn missing calculation into a
false claim about the user's evidence.

PANDO therefore uses `ExploreStructuralProjectionV1` as a narrow server-internal transition
contract. It contains authorized structure, immutable target requirements, layout, Outline, and
the explicit availability value `NOT_MATERIALIZED`. It contains no achievement level, estimate,
confidence, attainment, blocker result, score, or readiness status.

## Ownership and data flow

```text
authenticated request
  -> Identity resolves the current personal workspace
  -> Targets returns the exact goal/profile/requirement tree
  -> Catalog returns the bounded roadmap/requirement/prerequisite closure
  -> Overlay returns accepted personal structure, selected activity, and positions
  -> Explore composer correlates the owner DTOs and emits structural UI data
```

The public SQL read accepts a goal key and optional selected activity key only. Workspace identity
is derived from the authenticated session; it is never accepted from URL, browser state, or an
agent claim. The composer fails closed when workspace, goal, profile, catalog, roadmap, or overlay
versions disagree. It never falls back to the representative fixture after a live read failure.

## Compatibility boundary

`ExploreStructuralProjectionV1` does not supersede ADR-0004 or `GraphProjectionV1`. It is not an
external API and is not a calculation snapshot. Once Mastery supplies versioned states and Targets
supplies readiness at a correlated input watermark, the live route materializes
`GraphProjectionV1`; the structural contract may then remain only as the explicit degraded response
for a projection that has never been calculated.

The UI must branch on calculation availability:

- `NOT_MATERIALIZED`: show structure and a plain explanation; hide readiness metrics and do not use
  the word `Unknown` for competency state.
- materialized state: render the complete `GraphProjectionV1` supplied by authoritative calculation
  boundaries.

## Security and privacy invariants

- Ordinary requests use a request-scoped authenticated Supabase client, never service role.
- A user-controlled workspace identifier is absent from the public RPC and TypeScript loader.
- Only the target closure and explicitly selected activity reach the structural response.
- Notes, evidence bodies, provider payloads, provenance bodies, hidden drafts, and unrelated overlay
  content are excluded.
- Workspace overlay origins and position overrides must match the correlated workspace and overlay
  revision.
- Missing, foreign, revoked, malformed, and version-raced inputs produce one safe unavailable state
  without an existence oracle.
- No read creates command receipts, outbox events, snapshots, or other authoritative state.

## Replacement trigger

Replace the structural response on the live route only after all of the following exist:

1. an authorized Mastery query returning versioned competency states;
2. a Targets-owned readiness snapshot/query derived from those exact states;
3. matching profile, policy, engine, and input-watermark validation;
4. tests proving that absent evidence is `Unknown`, stale evidence stays historical, and a mandatory
   floor cannot be hidden by an aggregate;
5. no fixture or read-time fallback calculation in the page.
