# Targets

Owns goals, campaigns, target-profile series, versions, drafts, requirements, and target-specific
readiness projection contracts and snapshots. Readiness evaluates immutable target requirements
against versioned Mastery state inputs; Targets does not own evidence or competency-state truth.

## Implemented Phase 0 readiness core

domain/calculate-target-readiness.ts is the pure readiness-engine/0.1.0 implementation governed by
[ADR-0006](../../../docs/adr/0006-calculation-and-review-engines.md) and
[Mastery and Readiness Policy v0.1](../../../docs/policies/MASTERY_READINESS_POLICY_V0.1.md).

The engine consumes a normalized cross-context Mastery snapshot contract rather than importing
Mastery's domain code. Every consumed dimension must have the same explicit asOf as the
calculation. The v0.1 interval operators are deliberately transparent:

- a known leaf is min(1, current strength / required strength);
- an Unknown leaf remains [0, 1] with zero coverage, never zero attainment;
- ALL takes the minimum child bounds, ANY the maximum, and K_OF_N the K-th highest;
- WEIGHTED_THRESHOLD uses weighted lower, upper, and coverage values;
- MANDATORY_FLOOR is evaluated before aggregate status.

Outputs include interval, coverage, status, confidence, blockers, per-rule evaluations,
profile/policy/engine versions, input watermark, and explanation codes.

Not implemented here: profile persistence, Mastery queries, snapshot persistence/application,
outbox publication, best-action ranking, UI, or lifecycle commands. Cross-context interaction
continues to follow the [module topology](../../../docs/design/MODULE_TOPOLOGY.md).
