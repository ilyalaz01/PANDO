# Phase 4B D2c — Learning Track cadence implementation status

Status: complete; all required release gates passed

Design:
[Learning Track cadence](../design/PHASE_4B_D2C_LEARNING_TRACK_CADENCE.md)

Completed: 2026-09-03

## Delivered outcome

A signed-in person can set a current Learning Track's desired evidence-bearing Focus-session count
for the current Planning week through a separate exact preview and explicit confirmation. A value
of `0` means no cadence target. Cadence is a soft ranking preference: it does not reserve capacity,
replace protected minimum minutes, create Evidence, or claim Mastery, readiness, or Goal
completion.

The `/plan` source reports observed current-week progress only from the normalized input behind one
exact current V2 Planning pointer. Missing, stale, failed, V1-only, or incompatible projection state
remains `Unknown`; it is never converted to zero. Apply changes only cadence and the selected Track
version, preserves every sibling and historical fact, emits one minimal event and fixed Planning
delivery, and reports recalculation as pending.

## Versioned calculation and rollout

- Historical `PlanningCalculationInputV1`, `PlanSnapshotV1`, `planning-calculation/1`,
  `planner-engine/0.1.0`, `planning-policy/0.1`, and `planning-completed-work/0.1` rows remain
  immutable and readable.
- V2 adds explicit `cadencePerWeek` and `completedCadenceSessionsThisWeek` Track inputs,
  `TRACK_CADENCE_DEFICIT`, `planning-calculation/2`, `planner-engine/0.2.0`,
  `planning-policy/0.2`, and `planning-completed-work/0.2` without relabeling V1 history.
- The activation migration treats its own deployment as the durable cutover: every newly created
  attempt uses V2, while an already active V1 attempt is reused and completes through the unchanged
  V1 path.
- Exact V1 pointers receive one deterministic, idempotent activation event and delivery. Idle
  workspaces recalculate after the current snapshot boundary; any new ordinary Planning input uses
  V2 immediately, so repeated edits cannot postpone activation indefinitely.
- Activation events bind the exact historical workspace, snapshot, applied attempt, pointer
  version, input fingerprint, engine, policy, and causation tuple. Invalid or mixed tuples fail
  closed, and a stale V2 result cannot move the pointer.
- A failed calculation blocks cadence progress only at its current pointer frontier. A later exact
  V2 success restores `CURRENT` progress without deleting or relabeling the historical uncovered
  dead letter, matching Today recovery semantics.

## Owner command, application, and UI

- `LearningTrackCadenceSourceV1`, `LearningTrackCadencePreviewV1`, and
  `LearningTrackCadenceApplyResultV1` are additive Planning contracts; released lifecycle and
  settings contracts retain their meaning.
- The browser submits only an opaque Track key, proposed whole-session target, Plan and Track
  version fences, printable reason, preview digest, and request UUID. Workspace, Plan, Track,
  progress, and snapshot authority are resolved on the server.
- Apply takes the shared Planning workspace lock, locks the current pointer and child Tracks in
  stable order, rebuilds the exact preview, advances only the target Track, and commits state,
  receipt, `TRACK_CADENCE_CHANGED` event, and one projection delivery atomically.
- Same-key replay is stable. Changed requests, stale versions or projection identity, terminal
  Tracks, archived parents, invalid selectors, and injected failures leave no partial state.
- The control explains before/after target and deficit, distinguishes soft cadence from protected
  capacity, supports active and paused Tracks, dismisses stale sibling confirmations, and preserves
  keyboard, mobile, reduced-motion, forced-colors, and WCAG behavior.

## Verification evidence

Verified on Windows against a clean local PostgreSQL/Supabase stack:

- `pnpm verify` — PASS: formatting, lint, type checking, 13 database-runner tests plus 2 documented
  Windows platform skips, 3 backup-archive tests, 392 contract tests, 3 performance tests, 944 unit
  tests, production build, coverage thresholds, and 36 Chromium E2E tests including WCAG checks.
- `pnpm verify:db` — PASS: 47 pgTAP files, 2972 assertions, and warning-level database lint with no
  findings.
- The database proof includes V1/V2 routing and persistence, exact activation-event validation,
  pending/current/unavailable cadence reads, current-failure blocking, historical-dead-letter
  recovery, stale/failure pointer safety, and real advisory-lock races against capacity, lifecycle,
  terminal lifecycle, additional-Track creation, and destination-aware activity admission.
- `pnpm verify:auth` — PASS: the isolated authenticated browser journey covers target selection,
  Plan lifecycle and activity admission, terminal Track lifecycle, a real cadence edit through the
  worker, current Plan/Today reloads, overlay persistence, token refresh, and sign-out.
- `pnpm verify:backup` — PASS: encrypted backup and clean restore.

No production dependency or lockfile change was required.

## Next bounded outcome

D2 is complete after the final release gates. Do not start availability, Growth Plan replacement,
or Campaign implementation from assumptions. First accept the focused D3–D5 lifecycle ADR required
by the parent design: it must settle current-plan replacement cardinality and history, availability
window identity/time-zone/overlap/capacity semantics, Campaign deadline behavior, and paused-plan
interaction. The next implementation slice is D3 only after those decisions are explicit.
