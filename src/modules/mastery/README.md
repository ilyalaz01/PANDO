# Mastery

Owns derived competency states and estimate confidence, not raw attempts.

## Implemented Phase 0 domain core

domain/calculate-competency-state.ts is the pure mastery-engine/0.1.0 implementation governed by
[ADR-0006](../../../docs/adr/0006-calculation-and-review-engines.md) and
[Mastery and Readiness Policy v0.1](../../../docs/policies/MASTERY_READINESS_POLICY_V0.1.md).

The function receives normalized evidence, an input watermark, an explicit policy object, and an
explicit asOf clock. It reads no database, environment, network, filesystem, browser state, or
implicit current time. It:

- ignores invalidated and non-qualifying observations and deduplicates exact evidence replay;
- recalculates ordinal achievement from active evidence after corrections;
- keeps an evidence-free dimension Unknown, never numeric zero;
- calculates Weak/Stale/Strong condition and Low/Medium/High confidence;
- uses UTC dates, exact duration boundaries, and versioned freshness windows;
- returns safe evidence identifiers and explanation codes with engine/policy/watermark metadata.

A dimension reaches MASTERED only when its own qualifying history satisfies the repeated-event
rules and the competency has target-relevant Application or InterviewExecution evidence. The
competency-level achievement evaluates all objective dimensions together. SelfConfidence is not an
engine input.

Not implemented here: evidence normalization, database projection persistence, outbox consumers,
watermark-checked snapshot application, UI, or policy activation/migration. Those remain
application/infrastructure work and must not be added to this domain directory.
