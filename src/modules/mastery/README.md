# Mastery

Owns derived competency states and estimate confidence, not raw attempts.

## Implemented domain core

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

The domain directory still contains no database, transport, or worker dependencies.

## Implemented prerequisite satisfaction engine

`domain/calculate-prerequisite-satisfaction.ts` is the pure
`mastery-prerequisite-engine/0.1.0` implementation of
[`mastery-prerequisite-satisfaction/0.1`](../../../docs/policies/PLANNING_PREREQUISITE_SATISFACTION_POLICY_V0.1.md).
It validates a privacy-minimized current Mastery projection against the original projection clock,
then evaluates freshness at an explicit Planning claim clock. Contradictory, malformed,
post-claim, unsupported, missing, and stale-only input remains Unknown. The Planning application
uses the narrow public Mastery application facade; Planning domain code receives only bounded
classification counts and never imports Mastery.

## Implemented Phase 2 projection boundary

Evidence events enqueue only the fixed `mastery.evidence_projection_v1` consumer. The server-only
dispatcher claims bounded leased deliveries, reloads the authoritative effective ledger together
with a database-issued calculation clock, calls the pure engine with that explicit clock and the
accepted policy, and applies the result through a service-only RPC. Keeping Evidence timestamps and
the calculation clock on one database timeline prevents host/container clock skew from
dead-lettering newly committed Evidence as future input. Application checks the current ledger
watermark and lease before atomically inserting an immutable snapshot, advancing the current
pointer, writing the consumer receipt, and completing the delivery.

Snapshot identity includes engine, policy, projection generation (`live-v1` for this worker), and
input watermark. This keeps live retries idempotent without preventing later side-by-side policy,
replay, or time-freshness generations.

The browser cannot submit a calculated state or call worker RPCs. A missing worker configuration or
temporary dispatch failure leaves durable evidence and an explicit pending projection for later
retry.

The fixed internal route is recovered once per minute by Supabase Cron after the deployment-only
Vault activation documented in
[the Phase 2 worker runbook](../../../docs/runbooks/database/phase-2-mastery-projection.md).
