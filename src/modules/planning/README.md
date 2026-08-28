# Planning

Owns Growth Plans, Learning Tracks, capacity, ranking, explanations, and plan snapshots.

## Phase 4A implementation route

The accepted [Phase 4A design](../../../docs/design/PHASE_4A_PLANNING_TODAY.md) starts with a pure
`planner-engine/0.1.0` and transparent
[Planning Policy v0.1](../../../docs/policies/PLANNING_POLICY_V0.1.md). Cross-context owner queries
normalize Targets readiness, Review urgency, Overlay activities, Catalog prerequisites, and Mastery
state plus meaningful-work aggregates into a Planning-owned calculation input. The input uses exact
goal/profile identities, bounded owner revisions, a canonical fingerprint, and an explicit
validity/week horizon. The domain engine performs no I/O and imports no other bounded context. Raw
worker input enters only through the application calculation entry point, which first validates the
structural contract and exact canonical fingerprint before branding it for the domain engine.

Planning now has a forced-RLS storage boundary for Growth Plans, Learning Tracks, track/activity
attribution, immutable PlanSnapshot history, and a validated current-snapshot sentinel. The
idempotent initializer currently persists the first plan, track, and sentinel from a bounded
Targets-owned query, with a minimal `planning.input_changed` event routed only to
`planning.plan_snapshot_v1`.

`api.add_learning_track_activity_v1` admits one exact active/accepted personal activity through
Targets- and Overlay-owned fenced queries. It requires explicit Planning duration, nullable energy,
the expected Track version, and an idempotency key; all authority-bearing IDs and the candidate key
are server-derived. The atomic command writes attribution, increments only the Track aggregate,
emits the strict Track input event, and creates one fixed delivery. It keeps the current calculation
pointer intact so a prior unexpired snapshot can remain display-only while the new delivery makes
Today pending. Active and paused plans/tracks are editable; terminal lifecycle and inactive goal or
activity state fail closed. A Growth Plan cannot exceed 200 non-archived candidate activities.

Live Today remains unavailable until the remaining owner-scoped input queries and the leased worker
can calculate and apply the first current snapshot. A UI-only recommendation
assembled from fixtures or direct cross-module table reads is not a Planning implementation.
