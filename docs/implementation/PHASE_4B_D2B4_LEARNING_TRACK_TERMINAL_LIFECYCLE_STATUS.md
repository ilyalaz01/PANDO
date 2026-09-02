# Phase 4B D2b4 — Learning Track terminal lifecycle implementation status

Status: complete

Design:
[Learning Track completion and archive](../design/PHASE_4B_D2B4_LEARNING_TRACK_TERMINAL_LIFECYCLE.md)

Completed: 2026-09-02

## Delivered outcome

A signed-in person can complete or archive one current Learning Track, or archive a previously
completed Track, through a deterministic preview and explicit confirmation. Completion is a
terminal Planning decision and makes no Evidence, Mastery, readiness, or Goal-completion claim.
Archive is retained read-only history, never deletion. Neither state can be resumed.

Terminal Tracks leave current Track count and order, active protected-minimum totals, Today
candidate generation, and destination-aware activity admission. Activities and attributions,
Focus sessions, Evidence, Mastery/readiness, Review items, snapshots, receipts, events, and Track
history remain intact. The parent Growth Plan and sibling Track versions remain unchanged; only the
selected Track advances once per accepted transition.

## Owner boundary, contracts, and atomic command

- Planning owns the source, preview, lifecycle transition, receipts, minimal event, and fixed
  snapshot delivery. Existing pause/resume contracts retain their exact released meaning.
- The zero-authority-input source returns all `0..30` current Tracks plus one fixed 20-row terminal
  history page. Continuation uses a server-issued Base64 keyset cursor over timestamp, Track key,
  and Track UUID; invalid, foreign, oversized, and inconsistent cursors fail closed.
- Browser intent contains one opaque Track key, operation, exact Plan and Track versions, and a
  bounded printable reason. Apply additionally requires the recomputed SHA-256 preview digest and a
  lowercase request UUID.
- Apply serializes the idempotency key and Planning workspace, locks the Plan and all child Tracks
  in stable order, rebuilds the preview from locked owner state, and commits one Track update,
  receipt, minimal `TRACK_TERMINAL_LIFECYCLE_CHANGED` event, and one
  `planning.plan_snapshot_v1` delivery atomically.
- Same-key replay is byte-identical. Changed requests, stale Plan/target/sibling facts, invalid
  transitions, archived parents, foreign selectors, races, and injected failures leave no partial
  state, receipt, event, or delivery.

## Application and UI

- `/plan` adds a separate `Complete or archive a Learning Track` surface without broadening or
  replacing pause/resume. Current and loaded-history Tracks use one native selector; operations are
  derived by the server, and archived rows expose no mutation control.
- Exact previews show the before/after lifecycle and version, current/active portfolio effects,
  capacity effects, terminal consequence, retained history, non-claims, and pending Today
  recalculation before confirmation.
- Changing any terminal field, history page, or sibling Plan intent dismisses stale confirmation.
  Conflicts require reload, successful apply refreshes Plan and Today, and malformed history links
  recover to the first bounded page.
- Automated proof covers keyboard and native-radio behavior, 320-pixel layout, 44-pixel targets,
  reduced motion, forced colors, archived read-only history, true keyset pagination, and WCAG 2.2
  A/AA checks.

## Verification evidence

Verified on Windows against the committed dependency set:

- `pnpm verify` — PASS: formatting, lint, strict TypeScript, 15 database-runner checks, 3
  backup-archive unit checks, 381 contract tests, 3 performance tests, 911 unit/coverage tests,
  production build, and 35/35 Chromium E2E/accessibility tests. Coverage: 87.49% statements,
  81.29% branches, 92.21% functions, and 88.89% lines.
- `pnpm verify:db` — PASS from a clean migration: 44 pgTAP files, 2838 assertions, and
  warning-level database lint with no findings.
- `pnpm verify:auth` — PASS in an isolated migrated stack, including the existing authenticated
  target, Plan, activity, Today, Focus, Evidence, Review, reload, refresh, and sign-out journey plus
  real `complete -> reload -> archive -> reload` persistence and read-only-history proof.
- `pnpm verify:backup` — PASS: encrypted backup and clean restore against the complete migrated
  schema.

No production dependency or lockfile change was required. No ADR was required because D2b4 is an
additive implementation of accepted Planning ownership, lifecycle, deterministic preview,
idempotency, transactional outbox, history retention, and UI-parity decisions.

The authenticated proof also exposed an existing distributed-clock race: PostgreSQL could record
Evidence slightly ahead of the Windows host clock used by the immediate Mastery dispatch. The
worker transport now supplies a database-issued explicit calculation clock, preserving the
accepted pure-engine rule while preventing valid new Evidence from being classified as future
input.

## Next bounded outcome

Cadence is the remaining D2 concept and is not yet defined precisely enough to persist. Record its
product semantics and owner contract before implementing it. Do not enter D3
availability/replacement or D4–D5 Campaign work before the focused decisions required by the parent
lifecycle design are accepted.
