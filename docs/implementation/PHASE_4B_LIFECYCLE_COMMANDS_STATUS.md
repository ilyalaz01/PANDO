# Phase 4B lifecycle and editing command status

Status: D1 and D2a complete; D2b–D5 pending
Design: [Phase 4B lifecycle and editing commands](../design/PHASE_4B_LIFECYCLE_COMMANDS.md)
Completed: 2026-09-01

## Delivered outcome

D1 is the first complete manual control slice for a persistent Growth Plan. A signed-in user can
open `/plan`, see the current title, lifecycle, weekly capacity, aggregate version, and honest
Planning freshness, then preview and explicitly confirm either `active -> paused` or
`paused -> active`. The saved plan changes immediately; Today remains visibly pending until the
ordinary Planning projection catches up.

Pause and resume preserve Learning Tracks, immutable PlanSnapshot history, Focus sessions, and
Evidence. D2a weekly-capacity editing is now complete in the separate
[D2a implementation record](PHASE_4B_D2A_GROWTH_PLAN_CAPACITY_STATUS.md). Growth Plan archive,
Track editing, availability, Campaigns, and Agent Control transport remain later work.

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

D2a is complete. Continue D2 incrementally with D2b Learning Track controls, beginning with Track
pause/resume and the capacity check required when a protected Track resumes. Track
create/priority/protected-minimum and terminal lifecycle commands follow as bounded increments;
cadence must be defined before it is persisted. Do not enter D3 availability/replacement or D4–D5
Campaign work before the focused decisions required by the D0 design are recorded.
