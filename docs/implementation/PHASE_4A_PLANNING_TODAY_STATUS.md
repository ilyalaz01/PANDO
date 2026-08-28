# Phase 4A Planning and Today status

Status: Engine, contracts, and initial Planning persistence implemented; calculation worker and
Today UI pending
Design: [Phase 4A Planning and Today](../design/PHASE_4A_PLANNING_TODAY.md)

This supporting record describes incremental implementation status. The nine canonical documents
and accepted design remain authoritative.

## Implemented

- pure `planner-engine/0.1.0` with an explicit clock and no database, framework, environment,
  browser, network, or cross-context imports;
- transparent `planning-policy/0.1` integer score factors, stable tie-breaking, one primary action,
  and at most four alternatives;
- active-Focus Resume precedence, weekly/session capacity filtering, paused-plan source removal,
  independently due Review fallback, current-only target-gap scoring, campaign overlay inputs,
  prerequisite filtering, repetition cost, and optional energy fit;
- explicit no-plan, paused-plan, no-capacity, and no-candidate states plus fail-closed readiness and
  Review warnings;
- strict bounded Draft 2020-12 `PlanningCalculationInputV1`, `PlanSnapshotV1`, and
  `TodayWorkspaceV1` schemas that reject unknown/private/authority-bearing fields;
- canonical input fingerprinting over normalized set-like collections, exact evaluation/week
  horizon, snapshot validity, multi-goal readiness identity/freshness/confidence, and explicit
  last-known-safe Today state;
- one verified application entry point for structural/fingerprint validation, inclusive validity
  caps for week, readiness, Review, and Campaign clock transitions, and display-only degraded Today
  snapshots;
- fail-closed goal/profile eligibility, single-track attribution, protected-capacity reservation,
  nullable energy, authoritative duration provenance, and bounded causal reason references;
- semantic snapshot checks for rank continuity, score-factor arithmetic/order, action uniqueness,
  non-zero factors, clock/Review/Campaign causal coherence, Start/Resume shape, capacity arithmetic,
  recommendation state, warning order, and readiness shape;
- bounded unique ReviewItem correlation, Campaign output-range safety, and transitive Today
  validation of the embedded plan;
- a versioned golden fixture, permutation/property tests, boundary fixtures, invalid fixtures, and
  malicious fixtures;
- a forced-RLS Planning-owned storage boundary for Growth Plan, Learning Track, track/activity
  attribution, immutable PlanSnapshot, and validated current-snapshot sentinel records; the
  initializer below currently writes the first plan, track, and sentinel;
- an idempotent Growth Plan initializer that derives the personal workspace and actor from the
  authenticated session, consumes a bounded Targets-owned initialization query, and atomically
  creates the first plan and track;
- an idempotent Learning Track activity-admission command that derives workspace and candidate
  identity, revalidates active Targets and Overlay owner state, persists explicit duration and
  nullable energy, checks the expected Track version and 200-candidate bound, and leaves the
  calculation pointer unchanged while recalculation is pending;
- a minimal `planning.input_changed` v1 event with a fixed `planning.plan_snapshot_v1` delivery,
  transactional receipt/state/outbox behavior, rollback injection coverage, cross-workspace
  isolation, replay, changed-payload conflict, real concurrency, and database constraint tests;
- a strict `planning.input_changed` v1 JSON contract for Growth Plan initialization and Track
  activity admission, with valid, boundary, invalid, and malicious fixtures.

## Not yet implemented

- later plan/track/activity lifecycle and capacity commands;
- calculation-attempt, action-selection, and delivery-ledger persistence;
- the remaining owner-scoped normalized input queries, leased worker, recovery, and
  fingerprint-checked snapshot application;
- live `TodayWorkspaceV1` query, opaque selection resolver/coordinator, `/today`, attributed
  Today-to-Focus journey, and responsive/accessibility acceptance;
- campaign persistence/overrides, dated availability, Plan/Track editing, ChangeSet preview, and
  Agent Control application.

No live recommendation is claimed before the worker boundary applies a current snapshot. Fixtures
and repository files are never used as live plan state.
