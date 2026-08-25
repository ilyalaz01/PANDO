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

Every rule exposes its raw attainment interval and its outcome at a local threshold. When a rule is
used as a parent member, SATISFIED becomes [1, 1], FAILED becomes [0, 0], and UNRESOLVED becomes
[0, 1]; the child's raw interval remains in its own evaluation.

The effective target threshold governs a root logical rule, and a root WEIGHTED_THRESHOLD must
declare that exact value. Nested logical rules use threshold 1, nested weighted rules use their
declared threshold, and mandatory floors always use threshold 1.

ALL witnesses every child; ANY deterministically selects one strongest child; K_OF_N selects K;
weighted rules use every positively weighted child. Candidate ordering is lower, upper, coverage,
confidence, then stable member key. Only selected decision witnesses contribute confidence, and
nested witness leaf keys are deduplicated in stable order.

Outputs include interval, coverage, status, confidence, blockers, per-rule evaluations,
stable witness member keys, profile/policy/engine versions, input watermark, and explanation codes.

Not implemented here: profile persistence, Mastery queries, snapshot persistence/application,
outbox publication, best-action ranking, UI, or lifecycle commands. Cross-context interaction
continues to follow the [module topology](../../../docs/design/MODULE_TOPOLOGY.md).
