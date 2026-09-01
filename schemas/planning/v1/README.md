# Planning calculation contracts v1

`planning-input.schema.json` is the bounded, privacy-minimized input to
`planner-engine/0.1.0`. Owner-scoped application queries normalize only plan/track versions,
capacity aggregates, zero to 30 exact current-or-unavailable Targets readiness entries, Review
counts, owner-declared Review validity and Focus-compatible references, active Focus identity,
Mastery-backed prerequisite state, accepted candidate activity metadata, bounded owner revisions,
and an explicit validity/week horizon. Its canonical SHA-256 fingerprint normalizes set-like
collection order. It
excludes evidence bodies, notes, provider payloads, arbitrary table/file references, and workspace
identifiers supplied by a client.

Consumed capacity, per-track cadence credit, `repetitionsInLast7Days`, its
`oldestRepetitionEndedAt` proof instant, and its exclusive `repetitionWindowEndsAt` cutoff are
produced by the versioned input-normalization policy named in
`completedWorkPolicyVersion` and recorded in
[Planning Completed Work Policy v0.1](../../../docs/policies/PLANNING_COMPLETED_WORK_POLICY_V0.1.md).
Changing that policy therefore changes the canonical fingerprint and writes a new snapshot.

Direct blocking Catalog prerequisites are classified by the pure Mastery-owned engine and policy
named in `prerequisiteEngineVersion` and `prerequisitePolicyVersion`, recorded in
[Planning Prerequisite Satisfaction Policy v0.1](../../../docs/policies/PLANNING_PREREQUISITE_SATISFACTION_POLICY_V0.1.md).
Each candidate carries bounded satisfied, blocked, and unknown counts that must exactly sum to its
direct prerequisite total and imply its stated tri-state value. This lets the pure Planning engine
verify the normalized answer without receiving Mastery state JSON or Evidence identifiers. The
Planning application coordinator sees only the privacy-minimized Mastery source projection needed
to call that pure engine; the normalized calculation input persists only counts and versions.

`plan-snapshot.schema.json` is the immutable engine output persisted by Planning. It contains at
most five exact Focus actions with reproducible integer score factors, bounded causal references,
readiness provenance/freshness, and one explicit recommendation state. It cannot establish
evidence, Mastery, readiness, Review state, or user availability.

`today-workspace.schema.json` wraps a persisted snapshot identity in the Planning projection state,
current input fingerprint, calculation clock, explicit last-known-safe decision, nearest safe
deadline label, and at most five opaque server-issued action selectors. It prevents the UI from
confusing an expired or pending snapshot with a current recommendation; degraded last-known-safe
snapshots are display-only and carry no selectors.
Their current-input fingerprint may remain null until the worker has normalized a real attempt; the
query never fabricates it from an outbox wake-up.

`growth-plan-control.schema.json` contains the minimized current Growth Plan read, deterministic
pause/resume preview, and applied-command result used by the manual Plan UI and future Agent Control
coordination. Bigint versions are decimal strings. The preview contains exact before/after owner
state and retained-history facts but no Today actions, evidence, workspace selector, implicit clock,
or caller-supplied authority. Apply returns `PENDING` until the ordinary Planning projection catches
up.

All Draft 2020-12 schemas reject unknown fields and bound every collection. Semantic checks in the
verified application calculation entry point and pure engine additionally enforce the exact
fingerprint, current readiness, Review projection currency/validity, clock-transition cutoffs,
owner-reference coherence, one candidate per Focus pair, protected-minimum capacity, stable
ordering, unique/bounded ReviewItem correlation, compositional Today/PlanSnapshot semantics, and
source eligibility.
