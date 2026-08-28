# Phase 4A Planning and Today status

Status: Live calculation worker, owner-event routing, and the versioned completed-work policy
implemented; Mastery prerequisite satisfaction and Today UI pending
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
- a dedicated NOLOGIN Planning worker with bounded Identity, Targets, Overlay, Catalog, Focus,
  Mastery, and Review owner queries that all receive one persisted `claimAsOf`; Planning has no
  cross-context table grants;
- durable immutable calculation-attempt provenance, an exact Planning delivery/source ledger,
  immutable opaque action selections, and a real FK from the current pointer to its applied
  attempt;
- a fixed `planning.plan_snapshot_v1` leased worker that claims at most five deliveries and one per
  workspace, persists the normalized canonical input before calculation, reuses only current
  attempt generations, runs the verified pure engine, and fails stale source/pointer fences closed;
- cross-wake workspace lease exclusion plus terminal eighth-attempt behavior that atomically closes
  both delivery and attempt for expired leases and stale calculations;
- atomic snapshot, pointer, selection, receipt, delivery-coverage, and deterministic scheduled
  refresh application, including exact `validUntil + 1 millisecond` recovery delivery timing;
- a constant-time secret-authenticated `/api/internal/planning-snapshot` route, aggregate health
  RPC, and opt-in once-per-minute Supabase Cron recovery function;
- live database coverage from authenticated goal/plan/activity creation through owner-source load,
  immutable snapshot publication, pointer advance, exact multi-delivery coverage, and future
  refresh scheduling, plus dispatcher and route unit tests;
- explicit same-transaction Planning routing from Targets readiness, Mastery state, Review item,
  Overlay activity, Sessions Focus start/complete/stop, and Evidence invalidation producers. A
  dedicated `NOLOGIN`/`NOINHERIT`/`NOBYPASSRLS` router fixes the consumer and contract version,
  validates each exact owner envelope, and inserts idempotently only after the Planning sentinel
  exists. A cursor-driven rollout repair processes at most 500 historical accepted events per
  call, reports progress, is replay-safe, and rejects malformed envelopes. Reviewed malformed
  immutable history has an administrator-only append-only quarantine path that atomically emits a
  valid Planning-owned current-state repair wake-up under its own idempotent command receipt; valid
  events, changed-request replays, and audit rewrites are refused. Public coordinator signatures
  remain in the exposed `api` schema, while their unrouteable implementations live only in the
  authoritative `overlay`, `sessions`, and `evidence` schemas and stay out of generated client
  types.
  Raw evidence append events remain outside this ledger; Focus completion supplies the immediate
  wake-up and later
  Mastery/Targets events provide the convergence wake-ups that become calculable after the
  meaningful-work policy is implemented;
- database proofs for router privilege isolation, real user-producer routing, pre-plan suppression,
  explicit historical repair, audited malformed-history recovery, replay uniqueness, user-command
  and Mastery-completion rollback on delivery failure, plan-enabled real Mastery/Review/Targets
  completion routing, and strict valid/boundary/invalid/malicious envelope handling;
- a versioned [`planning-completed-work/0.1`](../policies/PLANNING_COMPLETED_WORK_POLICY_V0.1.md)
  input-normalization policy carried in `completedWorkPolicyVersion`, so a rule change always
  produces a new canonical fingerprint and a new snapshot rather than silently reinterpreting an
  existing one. Two new bounded owner queries supply its facts: Sessions returns terminal Focus
  duration facts inside `[least(weekStart, claimAsOf − 168 hours), claimAsOf]`, and Evidence returns
  only attempt terminality plus whether a normalized observation exists and has not been
  invalidated. Planning gained no Sessions or Evidence table grant. Counted duration is
  `min(floor(observed elapsed), plannedMinutes)` clipped to the plan week, so planned duration is
  only ever an upper bound and no unbounded page-open time is credited. A completed session consumes
  capacity, an evidence-bearing completed session also earns track cadence credit, a stopped session
  earns neither, and repetition counts completed sessions in the half-open 168-hour window with a
  verifiable `repetitionWindowEndsAt` cutoff that also caps snapshot validity;
- `UNSUPPORTED_MEANINGFUL_WORK_HISTORY` now rejects only genuinely unclassifiable history — a
  missing or non-terminal Evidence attempt, a stopped session claiming evidence, a session outside
  the claim-scoped window, a window that does not cover the policy horizon, or derived totals that
  break the week/credit invariants — instead of every workspace with terminal sessions.
  Prerequisite-bearing candidates still remain `UNKNOWN` until a versioned Mastery satisfaction rule
  exists.

## Not yet implemented

- later plan/track/activity lifecycle and capacity commands;
- the versioned Mastery prerequisite-satisfaction policy that would let prerequisite-bearing
  candidates leave `UNKNOWN`;
- campaign persistence, same-session duration/energy preference persistence, and Focus plan
  attribution columns;
- live `TodayWorkspaceV1` query, opaque selection resolver/coordinator, `/today`, attributed
  Today-to-Focus journey, and responsive/accessibility acceptance;
- campaign overrides, dated availability, Plan/Track editing, ChangeSet preview, and Agent Control
  application.

The worker now applies real snapshots for workspaces that already have completed Focus history, with
capacity, per-track cadence credit, and repetition derived from the reviewed completed-work policy.
No live Today recommendation is exposed before the Today read boundary is implemented. Fixtures and
repository files are never used as live plan state.
