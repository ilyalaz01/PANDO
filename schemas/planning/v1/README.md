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

All Draft 2020-12 schemas reject unknown fields and bound every collection. Semantic checks in the
verified application calculation entry point and pure engine additionally enforce the exact
fingerprint, current readiness, Review projection currency/validity, clock-transition cutoffs,
owner-reference coherence, one candidate per Focus pair, protected-minimum capacity, stable
ordering, unique/bounded ReviewItem correlation, compositional Today/PlanSnapshot semantics, and
source eligibility.
