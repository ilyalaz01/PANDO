# Planning

Owns Growth Plans, Learning Tracks, capacity, ranking, explanations, and plan snapshots.

## Phase 4A implementation route

The accepted [Phase 4A design](../../../docs/design/PHASE_4A_PLANNING_TODAY.md) starts with a pure
`planner-engine/0.1.0` and transparent
[Planning Policy v0.1](../../../docs/policies/PLANNING_POLICY_V0.1.md). Cross-context owner queries
will normalize Targets readiness, Review urgency, Overlay activities, Catalog prerequisites, and
Mastery state plus meaningful-work aggregates into a Planning-owned calculation input. The input
uses exact goal/profile identities, bounded owner revisions, a canonical fingerprint, and an
explicit validity/week horizon. The domain engine performs no I/O and imports no other bounded
context. Raw worker input enters only through the application calculation entry point, which first
validates the structural contract and exact canonical fingerprint before branding it for the domain
engine.

Live Today remains unavailable until Planning-owned Growth Plan/capacity persistence, immutable
PlanSnapshot history, current-pointer validation, and the owner-scoped worker path are present. A
UI-only recommendation assembled from fixtures or direct cross-module table reads is not a Planning
implementation.
