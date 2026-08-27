# Phase 0 gate 9 - deterministic engine status

Status: Executable domain core implemented; Phase 2/3 integration delivered
Policy versions: mastery-readiness-policy/0.1, review-policy/0.1
Engine versions: mastery-engine/0.1.0, readiness-engine/0.1.0, review-engine/0.1.0

This supporting record is evidence for quality gate 9 in
[the Phase 0 Technical Baseline](../PHASE_0_TECHNICAL_BASELINE.md). It does not claim that Phase 0
or the surrounding persistence/application flows are complete.

| Engine | Owning context | Executable rules | Golden fixture |
| --- | --- | --- | --- |
| Mastery | [Mastery](../../src/modules/mastery/README.md) | evidence qualification, ordinal levels, dimension condition/freshness/confidence, correction replay, Unknown | [mastery fixture](../../tests/fixtures/calculation-engines/v0.1/mastery.golden.json) |
| Target readiness | [Targets](../../src/modules/targets/README.md) | leaf strengths, raw rule intervals and local outcomes, child satisfaction intervals, deterministic witnesses, operator-specific coverage, mandatory floors, status/confidence/blockers | [readiness fixture](../../tests/fixtures/calculation-engines/v0.1/readiness.golden.json) |
| Review | [Review](../../src/modules/review/README.md) | four initial reasons, response interval table, effective due, order-independent event/revision validation, latest-revision fold and reopen | [review fixture](../../tests/fixtures/calculation-engines/v0.1/review.golden.json) |

The fixture tests run through the repository unit-test command and use an explicit clock. Boundary,
regression, permutation, and property tests cover event-order/replay determinism, valid and
conflicting revision permutations, correction examples, stale and Unknown states, ANY/K_OF_N
known-plus-unknown witness selection and ties, nested weighted failure/unresolved outcomes, root
threshold mismatch, mandatory floors, UTC offsets, DST transitions, leap day, representative
malformed inputs, interval bounds, and the review interval cap. Phase 2 Mastery, Phase 3A Review,
and Phase 3B Target Readiness now add their separate database/application/browser integration
gates; none constitutes calibrated-outcome coverage.

## Deliberate non-scope

This original gate record does not by itself claim completion of:

- planner/Today integration or Agent Control exposure;
- policy activation, shadow comparison, calibration, FSRS, AI, or external SDK behavior.

Delivered integrations call these pure engines through owning application boundaries and preserve
the engine, policy, profile, template, watermark, and explicit-clock metadata required by ADR-0006.
