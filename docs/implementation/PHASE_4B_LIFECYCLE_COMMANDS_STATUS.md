# Phase 4B lifecycle and editing command status

Status: D1, D1b, and D2a–D2c complete; D3–D5 ADR and implementation pending
Design: [Phase 4B lifecycle and editing commands](../design/PHASE_4B_LIFECYCLE_COMMANDS.md)
Completed: 2026-09-02

## Delivered outcome

D1 is the first complete manual control slice for a persistent Growth Plan. A signed-in user can
open `/plan`, see the current title, lifecycle, weekly capacity, aggregate version, and honest
Planning freshness, then preview and explicitly confirm either `active -> paused` or
`paused -> active`. The saved plan changes immediately; Today remains visibly pending until the
ordinary Planning projection catches up.

Growth Plan pause and resume preserve Learning Tracks, immutable PlanSnapshot history, Focus
sessions, and Evidence. D2a weekly-capacity editing is complete in the separate
[D2a implementation record](PHASE_4B_D2A_GROWTH_PLAN_CAPACITY_STATUS.md). D2b1 adds Planning-owned
Learning Track pause/resume with a protected-capacity resume check and retained history; see the
[D2b1 implementation record](PHASE_4B_D2B1_LEARNING_TRACK_LIFECYCLE_STATUS.md). D2b2 adds one atomic
priority/protected-minimum edit with active-capacity and current-order freshness; see the
[D2b2 implementation record](PHASE_4B_D2B2_LEARNING_TRACK_PRIORITY_MINIMUM_STATUS.md). Growth Plan
replacement/archive, availability, Campaigns, and Agent Control transport remain later work. D1b
closes the fresh-user no-Plan gap through the exact setup flow recorded in the
[D1b implementation record](PHASE_4B_D1B_FIRST_GROWTH_PLAN_SETUP_STATUS.md). D2b3 adds an exact
additional-Track creation command and bounded destination-aware activity admission without changing
the released sole-Track admission meaning; see the
[D2b3 implementation record](PHASE_4B_D2B3_ADDITIONAL_LEARNING_TRACKS_STATUS.md).
D2b4 adds separate completion/archive contracts, bounded terminal history, and exact terminal
confirmation without broadening the released pause/resume meaning; see the
[D2b4 implementation record](PHASE_4B_D2B4_LEARNING_TRACK_TERMINAL_LIFECYCLE_STATUS.md). The
D2c adds the separate soft weekly cadence command plus the V2 Planning calculation rollout; see the
[D2c implementation record](PHASE_4B_D2C_LEARNING_TRACK_CADENCE_STATUS.md).

## Owner boundary and contracts

- `GrowthPlanControlV1` contains the minimized current read, deterministic lifecycle preview, and
  apply result. PostgreSQL aggregate versions travel as decimal strings and reject values above
  `9223372036854775807`.
- The preview digest protocol is clock-free, length-prefixes ordered UTF-8 fields, and has one
  TypeScript/PostgreSQL SHA-256 oracle.
- `planning.input_changed` version 1 admits the exact minimal `PLAN_LIFECYCLE_CHANGED` payload. It
  carries no title, reason, evidence, Today action, or other private body.
- Public APIs resolve the actor and personal workspace from the authenticated session; the browser
  cannot select a workspace or Growth Plan ID. Private helpers and owner tables are not public
  alternate command surfaces.
- Apply requires operation, expected Growth Plan version, exact recomputed preview digest, reason,
  and idempotency key. One transaction locks the actor/key and Planning workspace, rechecks the
  current plan, advances its version once, and commits the command receipt, event, and fixed
  `planning.plan_snapshot_v1` delivery together.
- Same-key/same-request replay returns the stored response. Same-key/different-request, stale
  version, changed digest, no-op transition, unauthorized workspace, and concurrent stale apply
  fail without a partial state change.

## Application and UI

- The server boundary decodes structural and semantic contracts before UI code receives them and
  collapses database details into safe invalid, conflict, or unavailable states.
- `/plan` is a dynamic authenticated Server Component. Its client form uses two distinct steps:
  reason and preview first, then an explicit apply using the exact returned digest.
- A replacement preview immediately removes the old confirmation. A new intent receives a new
  idempotency key, while retries of the same apply retain the same key. Conflicts disable stale
  confirmation and expose a direct `Reload current plan` action.
- The route is linked from the authenticated core surfaces and has 320-pixel, keyboard,
  reduced-motion, forced-colors, and automated WCAG A/AA coverage.

## Verification evidence

The completed D1 source was verified on Windows:

- `pnpm verify` — PASS: format, lint, typecheck, 15 database-runner checks, 3 backup-archive unit
  checks, 313 contract tests, 3 performance tests, 752 unit/coverage tests, production build, and
  25/25 Chromium E2E tests. Coverage: 88.20% statements, 81.16% branches, 93.57% functions, and
  90.05% lines.
- `pnpm verify:db` — PASS from a clean migration: 27 pgTAP files, 2013 assertions, and warning-level
  database lint with no findings.
- `pnpm verify:auth` — PASS in an isolated migrated stack, including real signed-in `/plan`
  pause/preview/apply and resume/preview/apply, final active lifecycle at aggregate version 3, the
  existing Today/Focus/Review journey, refresh, persistence, and sign-out.
- `pnpm verify:backup` — PASS: encrypted backup and clean restore.

No production dependency or lockfile change was required. No new ADR was required because D1
implements already accepted Planning ownership, lifecycle, deterministic preview, idempotency,
transactional outbox, and UI parity decisions.

## Next bounded outcome

D1b, D2a–D2c, settings, and exact manual activity admission are complete. The implementation
records cover [admission](PHASE_4B_MANUAL_ACTIVITY_ADMISSION_STATUS.md),
[D2b3](PHASE_4B_D2B3_ADDITIONAL_LEARNING_TRACKS_STATUS.md), and
[D2b4](PHASE_4B_D2B4_LEARNING_TRACK_TERMINAL_LIFECYCLE_STATUS.md), and
[D2c](PHASE_4B_D2C_LEARNING_TRACK_CADENCE_STATUS.md). The next bounded outcome is the focused D3–D5
lifecycle ADR. Do not implement availability/replacement or Campaign work before the decisions
required by the D0 design are recorded.
