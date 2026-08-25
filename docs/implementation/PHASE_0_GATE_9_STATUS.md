# Phase 0 gate 9 - deterministic engine status

Status: Executable domain core implemented; integration work remains
Policy versions: mastery-readiness-policy/0.1, review-policy/0.1
Engine versions: mastery-engine/0.1.0, readiness-engine/0.1.0, review-engine/0.1.0

This supporting record is evidence for quality gate 9 in
[the Phase 0 Technical Baseline](../PHASE_0_TECHNICAL_BASELINE.md). It does not claim that Phase 0
or the surrounding persistence/application flows are complete.

| Engine | Owning context | Executable rules | Golden fixture |
| --- | --- | --- | --- |
| Mastery | [Mastery](../../src/modules/mastery/README.md) | evidence qualification, ordinal levels, dimension condition/freshness/confidence, correction replay, Unknown | [mastery fixture](../../tests/fixtures/calculation-engines/v0.1/mastery.golden.json) |
| Target readiness | [Targets](../../src/modules/targets/README.md) | leaf strengths, interval operators, weighted coverage, mandatory floors, status/confidence/blockers | [readiness fixture](../../tests/fixtures/calculation-engines/v0.1/readiness.golden.json) |
| Review | [Review](../../src/modules/review/README.md) | four initial reasons, response interval table, effective due, event/revision dedup and reopen | [review fixture](../../tests/fixtures/calculation-engines/v0.1/review.golden.json) |

The fixture tests run through the repository unit-test command and use an explicit clock. Boundary
and property tests cover order/replay determinism, invalidation/correction, stale and Unknown
states, ALL/ANY/K_OF_N/WEIGHTED_THRESHOLD/MANDATORY_FLOOR, UTC offsets, DST transitions, leap day,
invalid inputs, interval bounds, and the review interval cap.

## Deliberate non-scope

This change does not implement or claim completion of:

- database tables, stored projection snapshots, migrations, RLS, or transactional application;
- event/outbox consumers and watermark recheck at snapshot application time;
- Review action persistence/folding or Focus/evidence workflows;
- planner/Today integration, UI, or Agent Control exposure;
- policy activation, shadow comparison, calibration, FSRS, AI, or external SDK behavior.

Those pieces must call these pure engines through their owning application boundaries and preserve
the engine, policy, profile, template, watermark, and explicit-clock metadata required by ADR-0006.
