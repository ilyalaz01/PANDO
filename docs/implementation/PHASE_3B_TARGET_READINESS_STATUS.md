# Phase 3B Target Readiness status

Status: implemented and release-gated
Owner: Targets bounded context
Design: [Phase 3B Target Readiness](../design/PHASE_3B_TARGET_READINESS.md)

This supporting record describes the implemented Phase 3B slice. The nine canonical documents and
accepted ADRs remain authoritative.

## Delivered

- fixed outbox routing from goal creation, Mastery changes, and deterministic freshness refresh;
- shared-clock Mastery input reconstruction and pure readiness calculation with Unknown intervals,
  mandatory-floor precedence, stable fingerprints, and exact source provenance;
- immutable Targets snapshots/inputs, guarded current pointer, atomic completion, retries,
  dead-letter health, immediate dispatch, and once-per-minute recovery wake-up;
- command- and table-side active-workspace admission plus deployment preflights that prevent an
  older uncapped producer from crossing the worker envelope during rollout;
- authenticated `TargetReadinessV1` detail plus fail-closed `PlanningReadinessInputV1`;
- separate Explore composition with current-only numeric presentation, blockers, requirement gaps,
  count-only domain breakdown, exact Outline focus, responsive layout, and degraded states;
- valid, invalid, boundary, and malicious contracts; pure-engine/application tests; two-workspace
  pgTAP/RLS/atomicity tests; and authenticated evidence/correction browser coverage.

## Deliberate non-scope and limit

Phase 3B does not implement Planning/Today ranking, campaign overrides, Agent Control, numeric domain
aggregation, DOMAIN requirement semantics, calibrated readiness, or full calculated graph-node
states. A workspace admits at most 20 active goals and 250 total requirement leaves; one wake-up
accepts at most 250 distinct competencies and 50,000 effective Evidence observations, including at
most 10,000 for one competency. Persisted input detail keeps the eight most recent safe supporting
and contradicting references per dimension. Larger workloads require stable continuation and/or a
Mastery-owned sufficient-statistics contract rather than truncation.

## Release evidence

On 2026-08-28 the repository gate passed 592 unit tests with coverage, 279 contract tests, three
performance tests, 21 Chromium E2E/accessibility tests, strict TypeScript, ESLint, formatting, and
the production build. The isolated database gate applied the migration chain twice, passed all 15
pgTAP files (1,539 assertions), and reported zero lint warnings. Encrypted clean restore and the
authenticated owner journey—including readiness calculation, gap navigation, Evidence correction,
mobile Axe, generated API-type drift, and sign-out—also passed.
