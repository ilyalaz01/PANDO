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

## Implemented target-selection boundary

Published Target Profile versions and Readiness Goals are persisted by Targets. The authenticated
zero-argument `api.get_target_selection_source_v1()` composer obtains the current personal
workspace from Identity, profile and goal facts from
`targets.get_target_selection_options_impl(uuid)`, and exact catalog/roadmap version keys from
`catalog.get_target_selection_version_keys_impl(uuid[],uuid[])`. No owner query reads another
bounded context's private tables; the `api` layer performs the read-only composition. The strict
[TargetSelectionSourceV1](../../../schemas/target-selection/v1/README.md) contract exposes exact
immutable profile/catalog/roadmap provenance and current goals in stable order. The browser submits
only a published `profileVersionKey`; server code derives the goal key, title, workspace, and
idempotency key before calling the owning `api.create_readiness_goal` command. Replay reuses only
the active Readiness Goal with that exact derived key and immutable profile version; it never
silently substitutes another goal or reactivates an archived lifecycle.

Best-action ranking, Planning/Today consumption, campaign lifecycle UI, and Agent Control remain
later owner-scoped work. Cross-context interaction continues to follow the
[module topology](../../../docs/design/MODULE_TOPOLOGY.md).

## Implemented Explore target-context boundary

The authenticated `targets.get_explore_target_requirements_impl(workspace, goal)` owner query
resolves a persisted Readiness Goal to its exact published or retired Target Profile and complete
immutable requirement tree. Rule UUID relationships are serialized as stable rule keys; rules,
members, and direct canonical/workspace-overlay requirement references use deterministic ordering.
The zero-workspace `api.get_explore_target_context_v1(goal)` composer combines this DTO with
Catalog closure and accepted required Overlay nodes as strict
[`ExploreTargetContextV1`](../../../schemas/explore-target-context/v1/README.md).

This structural boundary contains no Mastery or readiness values. The live Explore composer
correlates it with the current authorized structural source into `ExploreStructuralProjectionV1`,
whose explicit `NOT_MATERIALIZED` state replaces the representative fixture without pretending that
calculated node states exist. The read does not persist a readiness snapshot or emit an outbox
event.

## Implemented Phase 3B projection boundary

The fixed `targets.readiness_projection_v1` consumer wakes from Readiness Goal creation, relevant
Mastery state changes, and deterministic time-only freshness events. Its leased server worker
reloads the exact active goal/profile/rules plus a Mastery-owned effective-ledger query, recalculates
all required Mastery dimensions at one explicit clock, runs the pure readiness engine, and applies
only an authoritative, watermark-checked result. Immutable snapshots and minimized inputs retain
engine, policy, profile, evidence-watermark, fingerprint, validity, blockers, evaluations, and safe
evidence references. A current pointer may advance but calculation history cannot be edited.

The single-user MVP admits at most 20 active goals and 250 total requirement leaves per workspace.
One synchronized calculation accepts at most 250 competencies, 10,000 effective Evidence
observations per competency, and 50,000 in total. It persists at most eight recent supporting and
eight recent contradicting references per dimension while the full ledger remains authoritative.
These fail-closed bounds prevent silent truncation and keep the atomic completion payload within a
768 KiB transport budget below its 1 MiB database boundary; larger workloads require a versioned continuation or Mastery
sufficient-statistics contract.

`api.get_target_readiness_v1(goal)` exposes the authorized Targets detail with explicit
`NOT_MATERIALIZED | REBUILDING | CURRENT | STALE | ERROR` state. The Explore read composer joins its
competency references to the separately authorized structural projection for titles, Outline focus,
and count-only domain breakdown; it owns no readiness fact. The smaller
`api.get_current_planning_readiness_input_v1(goal)` returns either one current minimized snapshot or
a strict unavailable reason, so future Planning cannot consume stale numbers.

Planning activity admission revalidates the Track's exact readiness-goal/profile pair through
`targets.get_planning_track_goal_admission_source_v1`. The query shares the active-goal lifecycle
fence and is executable only by the Planning application role; Planning has no direct Targets table
read. Paused plans or tracks may be edited, but an inactive readiness goal cannot acquire new
target-backed activity input.

Immediate post-command dispatch improves target-selection and evidence/correction feedback. The
durable outbox remains authoritative, and the once-per-minute fixed recovery route is activated by
the [Phase 3B runbook](../../../docs/runbooks/database/phase-3b-target-readiness-projection.md).
