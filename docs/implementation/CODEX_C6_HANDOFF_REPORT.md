# Codex C6 handoff report

Session date: 2026-08-29

Branch: `codex/c6-today-read-model`

Outcome: Phase 4A C6 — live Today read/selection boundary and attributed Focus start

## 1. Result

C6 is complete. An authenticated user can load the strict `TodayWorkspaceV1` envelope through a
zero-argument server adapter and start the exact current Planning recommendation using only an
opaque selector and idempotency key. The browser never receives or supplies the authoritative
action tuple. There is still no `/today` page; that is C7.

## 2. Architecture and behavior

- `api.get_today_workspace_v1()` derives the personal workspace and one query clock. The internal
  classifier returns `NOT_STARTED`, relevant `PENDING`, relevant `ERROR`, expired `PENDING`, or
  exact `CURRENT`; only `CURRENT` includes actionable opaque selectors.
- Pending/error output may include an unexpired last-known-safe snapshot for display, but never
  selectors. Future and obsolete scheduled refreshes do not make Today stale.
- `planning.resolve_today_action_v1()` is private. Under the shared workspace lock it rechecks the
  current pointer, applied attempt, inclusive expiry, selector/action tuple, and exact active Focus
  session for Resume.
- `api.start_focus_from_plan_v1(selectionRef,idempotencyKey)` accepts only a `START` action, derives
  every authoritative field, and atomically writes the command receipt, Focus session, activity
  attempt, plan attribution, event, fixed Planning delivery, and response. Exact completed replay
  is checked before selector resolution, so retries remain valid after the pointer changes.
- Sessions owns the bounded plan-attribution source. Planning receives no Sessions table grant.
  The TypeScript assembler strictly decodes and preserves attribution into a real `RESUME`
  calculation. Legacy unattributed Focus rows retain the pre-C6 source-revision tuple byte for byte.
- A dedicated `pando_today_reader` role is `NOLOGIN NOINHERIT NOBYPASSRLS`, read-only, and limited
  by forced workspace RLS. Public database failures are collapsed by the server adapter.

Authority: `docs/design/PHASE_4A_PLANNING_TODAY.md`, `docs/design/MODULE_TOPOLOGY.md`,
`schemas/planning/v1/today-workspace.schema.json`, and the existing Planning/Focus policies.

## 3. Main implementation

### New

- `supabase/migrations/20260829000150_phase4a_today_read_boundary.sql`
- `supabase/tests/database/025_phase4a_today_read_boundary.test.sql`
- `src/ui/today/server/today-workspace-v1.ts`
- `src/ui/today/server/today-workspace-v1.test.ts`
- `src/ui/today/server/database-today-workspace.ts`
- `src/ui/today/server/database-today-workspace.test.ts`

### Updated

- Planning worker publication fixture, central security matrix, database-gate discovery, generated
  Supabase types, active-Focus source assembly/dispatch tests, Planning/status READMEs, root README,
  and `CLAUDE.md`.

The migration also forward-fixes the non-empty snapshot worker path: immutable selections are
created once and no longer receive a redundant update that their immutability trigger rejects.

## 4. Invariants and review corrections

Independent route, server-pattern, and security reviews were incorporated. The final implementation
proves or enforces:

- state precedence by newest relevant event position, with active work winning a tie;
- obsolete dead letters cannot make `ERROR` sticky or erase a later normalized fingerprint;
- recovery proceeds `ERROR → PENDING → CURRENT` and preserves the exact new fingerprint;
- expiry and mutation clocks are sampled after lock acquisition;
- selector resolution fails closed for guessed, foreign, stale, expired, or non-current values;
- one selector can create at most one attributed Focus session, while replay returns the same
  response and changed reuse conflicts;
- an injected Planning-delivery failure rolls back receipt, session, attempt, event, and delivery;
- raw roles and cross-workspace RLS cannot enumerate another workspace's projection;
- legacy null-attribution source hashes are upgrade-compatible;
- database-shaped attribution survives the real TypeScript assembler and worker result.

The SQL and TypeScript process boundary remains compositional: pgTAP exercises real owner queries,
state transitions, selectors, coordinator, RLS, rollback, and recovery; TypeScript tests exercise the
strict schema/semantic decoder and worker. The repository does not yet run one test process that
feeds a live PostgreSQL JSON response directly into Vitest.

## 5. Verification

| Gate | Result |
| --- | --- |
| focused C6 TypeScript suite | PASS — 4 files / 44 tests |
| `pnpm typecheck` | PASS |
| `pnpm verify:db` | PASS — clean rebuild, 25 pgTAP files / 1,948 tests, database lint clean |
| `pnpm verify:auth` | PASS — isolated auth, selection, overlay persistence, reload, refresh, and sign-out |
| `pnpm verify` | PASS — format, lint, typecheck, database runner 13 pass/2 platform skips, backup archive 3/3, contracts 307/307, performance 3/3, unit 705/705, 87.98% statements / 80.88% branches, production build, Chromium E2E 21/21 |
| `pnpm verify:backup` | NOT RUN — backup/storage behavior did not change; archive coverage ran in `pnpm verify` |

Graphify orientation was attempted as required, but its pinned executable was unavailable in this
Windows environment. Decisive claims were verified in authoritative source files.

## 6. Next outcome

C7 is the first live `/today` page. It must render every projection state, correlate actions to
opaque selectors, keep degraded snapshots display-only, and implement the server-owned
Today-to-Focus journey through `start_focus_from_plan_v1`. It needs keyboard, 320/390-pixel,
reduced-motion, forced-colors, axe, authenticated reload, stale/recalculation, Start, and Resume
coverage. Plan editing, campaigns, and Agent Control remain out of scope.
