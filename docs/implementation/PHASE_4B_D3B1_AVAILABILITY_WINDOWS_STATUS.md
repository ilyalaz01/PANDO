# Phase 4B D3b1 — availability window persistence, control, and app layer status

Status: D3b1 complete (persistence, owner command, and app layer). Per design §4, full D3b remains
**partial** until D3b2 ships the V3 capacity composition and rollout — recorded availability does
not yet change effective weekly capacity.

Design: [Phase 4B D3b — dated availability windows](../design/PHASE_4B_D3B_AVAILABILITY_WINDOWS.md)

Decision record:
[ADR-0010](../adr/0010-lifecycle-replacement-availability-and-campaign-semantics.md) §6, §8, §9

Persistence completed: 2026-09-03 (`bd83745`). App layer completed: 2026-09-04 (this outcome).

## Delivered outcome

A signed-in person with a current Growth Plan can create, edit, and remove whole-local-day
availability windows through `/plan`, each through an exact, clock-free, digest-bound preview
before confirmation. Up to 60 active windows are non-overlapping per current Plan, enforced by both
the owning command and a database exclusion constraint; removed windows are retained as bounded
history. The `/plan` page states plainly that recorded availability does not yet change weekly
capacity — that is the deferred D3b2 outcome — and every Planning read remains honest about
`PENDING` recalculation. No calculation contract changed in this outcome.

## Owner command, contracts, and boundary (persistence, prior session)

- Table `planning.availability_windows` is workspace-owned with forced RLS
  (`identity.is_workspace_member(workspace_id)`), `SELECT`/`INSERT`/`UPDATE` only (no `DELETE`) to
  `pando_planning_api`, and a `btree_gist` partial exclusion constraint over
  `(workspace_id, growth_plan_id, daterange(starts_on, ends_on, '[]'))` for active windows.
- One command type `planning.change_availability_window_v1` with three operations
  (`create_availability_window`, `change_availability_window`, `remove_availability_window`),
  exposed through `api.get_availability_window_source_v1`, `api.preview_availability_window_v1`,
  and `api.apply_availability_window_v1` — all `SECURITY DEFINER`, `search_path = ''`, granted only
  to `authenticated`.
- Apply follows the released Planning mutation protocol: session-resolved actor and workspace,
  `(actor, command type, idempotency key)` serialization with exact replay, the
  `planning-workspace` lock, locking the current Plan and every active window in stable order,
  digest recomputation from freshly locked state, one state change, one minimal
  `planning.input_changed` event with change kind `AVAILABILITY_CHANGED`, one fixed
  `planning.plan_snapshot_v1` delivery, and one completed receipt — all in one transaction.
- Contracts `AvailabilityWindowSourceV1`, `AvailabilityWindowPreviewV1`, and
  `AvailabilityWindowApplyResultV1` (all `1.0.0`) live in
  `src/shared/contracts/availability-window-control.ts` and
  `schemas/planning/v1/availability-window-control.schema.json`. The pure digest, identity,
  fingerprint, and request-hash oracle is `src/modules/planning/domain/availability-window-preview.ts`,
  proven against a PostgreSQL-computed value in `tests/contract/availability-window-control.test.ts`.

## App layer delivered this outcome

- **Event variant.** `schemas/events/v1/planning-event.schema.json` gained the `availabilityChanged`
  `$def` (change kind `AVAILABILITY_CHANGED`) in its top-level `oneOf`, carrying only `operation`,
  `growth_plan_id`, `availability_window_id`, and `availability_window_version` — no label, reason,
  dates, or minutes, per design §6. Four fixtures
  (`tests/contract/fixtures/events/v1/planning-availability-changed.{valid,boundary,invalid,malicious}.json`)
  and new assertions in `tests/contract/planning-event.test.ts` cover it alongside the eight existing
  `planning.input_changed` variants.
- **Loaders and actions.** `src/ui/plan/server/database-plan.ts` gained
  `loadAvailabilityWindowSourceV1`, `previewAvailabilityWindowV1`, and `applyAvailabilityWindowV1`,
  each calling the three released `api` RPCs through the same typed-name-union `rpc()` helper every
  other Plan control uses, with the same `PlanInputError` / `PlanConflictError` /
  `PlanUnavailableError` collapse. `src/ui/plan/server/plan-workspace-v1.ts` re-exports the decode
  functions and contract types. `src/app/plan/actions.ts` gained `previewAvailabilityWindowAction`
  and `applyAvailabilityWindowAction`, sharing one form-input parser (`availabilityWindowInput`)
  across all three operations; it forces `startsOn`/`endsOn`/`availableMinutes`/`energy`/`label` to
  `null` for `remove_availability_window` and requires a null `windowKey`/`expectedWindowVersion`
  exactly for `create_availability_window`, mirroring the database validator
  (`planning.validate_availability_window_request_v1`) exactly.
- **`/plan` control.** `src/ui/plan/availability-windows.tsx` is a new client component listing
  active windows, an "Add an availability window" create form (shown only while
  `create_availability_window` is an offered capability), an "Edit or remove a window" form (shown
  only when at least one active window exists, selecting an existing window then either editing its
  fields or removing it), and one shared preview/confirm review section reused by all three
  operations — following the same `useActionState` preview-then-apply, digest-bound,
  dismiss-on-new-intent pattern as every other Plan control (modeled on
  `growth-plan-replacement.tsx` and `learning-track-creation.tsx`).
- **Wiring.** `src/ui/plan/plan-workspace.tsx` renders `AvailabilityWindows` alongside every other
  additive Plan control, cross-dismissing and being cross-dismissed by every sibling intent.
  `src/app/plan/page.tsx` loads the source in parallel with every other Plan read, added
  `availabilityWindowReadAgrees` to the existing single-retry cross-read-coherence check, and treats
  `NO_CURRENT_PLAN` the same way replacement does (omitted, not rendered) once no current Plan
  exists. `src/ui/plan/plan-types.ts` re-exports the availability contract types and extends the
  `PlanPreviewV1` union.
- **Fixtures.** `src/app/dev/plan-fixture/page.tsx` gained a `?preview=availability` state (one
  active window, a ready-to-confirm create preview) for component and end-to-end testing without a
  live database.

## Decided behavior worth remembering

- A window's opaque `windowKey` and `availabilityWindowId` are always server-issued; the browser
  never submits its own identifier. Create leaves both fields empty; change/remove require the
  server-issued key and the exact expected window version.
- The `/plan` control shares one preview/apply action pair across create, change, and remove — the
  `operation` hidden field carries the distinction — matching the one-command/three-operation shape
  of the owner command itself, rather than three separate action pairs.
- Editing a window's fields keeps its identity and recorded time zone; removal changes only
  lifecycle, version, and the active count and leaves every other field exactly as it was (proved by
  the existing contract test, reused here as component-test fixtures for the create and remove
  cases).
- The active-window and removed-window lists are read-only in this outcome beyond the count shown
  for removed history; no paginated removed-window browsing UI was built, since neither the design's
  required-proof list (§7) nor the ADR calls for it at D3b1.

## Files and migrations

Persistence (prior session, unchanged here): `supabase/migrations/20260905000100_phase4b_availability_windows.sql`,
`schemas/planning/v1/availability-window-control.schema.json`,
`src/modules/planning/domain/availability-window-preview.ts`,
`src/shared/contracts/availability-window-control.ts`,
`tests/contract/availability-window-control.test.ts` plus six fixtures under
`tests/contract/fixtures/planning/v1/availability-window-control.*.json`.

App layer (this outcome):

- `schemas/events/v1/planning-event.schema.json`; four new fixtures under
  `tests/contract/fixtures/events/v1/planning-availability-changed.*.json`;
  `tests/contract/planning-event.test.ts`.
- `src/ui/plan/server/database-plan.ts`, `src/ui/plan/server/plan-workspace-v1.ts`,
  `src/app/plan/actions.ts`, `src/app/plan/page.tsx`, `src/ui/plan/plan-types.ts`,
  `src/ui/plan/plan-workspace.tsx`.
- New: `src/ui/plan/availability-windows.tsx`, `src/ui/plan/availability-windows.test.tsx`.
- `src/app/dev/plan-fixture/page.tsx`, `src/app/plan/page.test.tsx` (mock wiring for the new
  loader), `src/ui/plan/server/database-plan.test.ts` (load/preview/apply RPC-mapping, malformed-input,
  and error-mapping coverage for the three new functions), `tests/e2e/plan.spec.ts` (keyboard,
  320px/touch-target, reduced-motion/forced-colors, automated WCAG A/AA, and one dedicated
  availability-window journey test).

No production dependency, lockfile, database migration, or calculation contract changed in this
outcome.

## Contracts and invariants

- Command `planning.change_availability_window_v1`, operations `create_availability_window`,
  `change_availability_window`, `remove_availability_window`; contracts
  `AvailabilityWindowSourceV1`, `AvailabilityWindowPreviewV1`, `AvailabilityWindowApplyResultV1`,
  all `1.0.0`. No calculation contract changes; D3b1 is clock-free for capacity.
- Event `planning.input_changed` gained change kind `AVAILABILITY_CHANGED` (`event_schema_version`
  unchanged at `1`), validated additively alongside the eight released variants.
- Every new `app`-layer function fails closed through the same `PlanInputError` /
  `PlanConflictError` / `PlanUnavailableError` taxonomy already used by every Plan control; a stale
  Plan or window version surfaces as `conflict`, malformed input as `invalid`, anything else as
  `unavailable`. No new failure mode was introduced.
- Idempotency: the browser generates one lowercase request UUID per preview intent, used directly as
  `idempotencyKey` (unprefixed), matching the `planning-create-identity/1.0.0` pattern already used
  by Growth Plan replacement and Learning Track creation, not the namespaced-key pattern used by the
  older pause/resume-style controls.

## Verification

Every command below was executed in this session on Node 24.19.0 (`/home/ilya/.n/bin`), the same
environment constraint recorded by the prior D3b1-db session. Docker was available and used for
every database-backed gate.

| Gate | Result |
|---|---|
| `pnpm format:check` | PASS |
| `pnpm lint` | PASS |
| `pnpm typecheck` | PASS |
| `pnpm verify:db` (`scripts/database/verify-database.mjs`) | PASS — 49 pgTAP files, 3070 assertions, `db lint` clean; unchanged from the prior D3b1-db session, confirming no drift from an app-only diff |
| `pnpm verify:auth` (`scripts/auth/verify-auth-target-selection.mjs`) | PASS after one fix (see below) |
| `pnpm test:database-runner` | PASS — 15 checks |
| `pnpm test:backup-archive` | PASS — 3 checks |
| `pnpm test:contracts` | PASS — 418 tests / 26 files (389 before this outcome) |
| `pnpm test:performance` | PASS — 3 tests |
| `pnpm test:unit:coverage` | PASS — 998 tests / 98 files; 86.51% statements, 80.77% branches, 91.05% functions, 87.82% lines against the 85/80/85/85 thresholds |
| `pnpm test:e2e` (`next build && playwright test`, full suite) | PASS — 38 tests |
| `pnpm verify` (the full chain above) | PASS |
| `pnpm verify:backup` (`scripts/backup/backup.integration.mjs`) | PASS |

**One real regression found and fixed by `verify:auth`.** The first `AvailabilityWindows` draft
labeled its create-form reason field "Why is this changing?" — verbatim the same accessible name
the base Growth Plan pause/resume section already uses. `scripts/auth/verify-auth-target-selection.mjs`
queries that field unscoped (`page.getByLabel("Why is this changing?")`) against the real,
authenticated `/plan` page, where every Plan control renders simultaneously (unlike the isolated
per-scenario `/dev/plan-fixture` harness the component tests and most of `tests/e2e/plan.spec.ts`
use). The duplicate label made that query ambiguous and failed the gate outright. Fixed by renaming
both of the component's reason labels to "Why does this window belong now?" (create) and "Why is
this window changing?" (manage) — unique across the whole `/plan` page, matching the existing
convention every other Plan control already follows (e.g. "Why does this Track belong now?", "Why
should this cadence change now?"). Every other field this component duplicates elsewhere on the page
(`Energy (optional)`, `Priority (0–100)`-style labels) was confirmed safe because every other
`getByLabel` call in the auth gate is scoped to its own form locator; only the base lifecycle
section's reason field was queried unscoped.

**Coverage required two rounds of additional tests.** The first `pnpm verify` run failed the global
80% branch threshold at 79.71%, then 79.97% after a partial fix, because the new
`availability-windows.tsx` (52.72% branch coverage as first written) and the three new
`database-plan.ts` RPC wrappers (untested, 43.7% branch on the whole file) pulled the project
average down. Fixed by adding ten more component tests (manage-form field updates and window
switching, a `change_availability_window` confirmation binding, the conflict-reload path, the
post-apply `router.refresh()` effect, and dirtying every remaining field) and three new
`database-plan.test.ts` cases (load/preview/apply RPC parameter mapping for create/remove, a
13-assertion malformed-input rejection test, and conflict/unavailable error mapping) — the same
patterns every sibling Plan control already uses in both test files. No test was weakened or
deleted to reach the threshold; only new coverage was added.

## Next bounded outcome

D3b2 — V3 capacity composition and rollout: `PlanningCalculationInputV3`, `PlanSnapshotV3`,
calculation contract `planning-calculation/3`, `planner-engine/0.3.0`, `planning-policy/0.3`, the
composition and protected-minimum rationing rules in design §3, the persisted clock-bound
capacity-effect preview design §6 requires, and the same expand-then-activate rollout D2c used.
Historical V1 and V2 rows stay immutable and readable under their own version tuples. D3b2 has not
started; per design §4, D3b as a whole is not complete until it ships.
