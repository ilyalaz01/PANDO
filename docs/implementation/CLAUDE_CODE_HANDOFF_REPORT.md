# Claude Code handoff report

Session date: 2026-09-04
Agent: Claude Code (Sonnet 5), continuing from the verified D3b1-db persistence in `bd83745`
Branch: `claude/d3b1-app`
Scope: Outcome 2 (D3b1-app) of `docs/implementation/CLAUDE_SESSION_SPLIT_PLAN.md` (that file lives
only on `claude/d3a-growth-plan-replacement`, commit `b482f08` — never merged to this branch's
ancestry; read there this session before proceeding) — the application layer half of D3b1.

## 1. Outcome attempted

D3b1-app: contracts and event variant, fixtures, the `/plan` availability-window controller,
loaders, server actions, E2E and component tests, and the status document, exactly as row 2 of the
split plan specifies. Status: **complete** — this session's own scoped outcome is fully done and
verified.

D3b1-db (persistence, the owner command, RLS, the exclusion constraint) was not touched this session
and its migration, RLS, and TS contract test were already committed and verified before this
session started. While reconciling status docs with actual files this session, one gap in D3b1-db's
own original scope was found and confirmed still open: no pgTAP database-level proof file for
availability windows exists in this repository (see §8). D3b2 (V3 capacity composition and rollout)
is out of scope for this outcome and has not started. Per the design doc's own instruction (§4), D3b
as a whole remains **partial** until D3b2 ships — this session completes D3b1-app but does not close
D3b1's residual database-proof gap or D3b as a whole.

## 2. User-visible result

A signed-in person with a current Growth Plan can now open `/plan` and see an "Availability windows"
section: a list of active windows, an "Add an availability window" form, and an "Edit or remove a
window" form. Each operation (create, change, remove) goes through an exact, digest-bound preview
before confirmation, exactly like every other Plan control. The page states plainly that recorded
availability does not yet change weekly capacity — that arrives with D3b2 — so nothing about
capacity, Today, or scheduling changes for anyone yet.

## 3. Architecture and policy decisions

Authority: `docs/design/PHASE_4B_D3B_AVAILABILITY_WINDOWS.md` and
`docs/adr/0010-lifecycle-replacement-availability-and-campaign-semantics.md` §6, §8, §9. No decision
in either document was reinterpreted; this outcome only finishes implementing the app layer they
already specify for D3b1, following the same preview/apply, digest-bound, dismiss-on-new-intent
pattern every other `/plan` control (`growth-plan-replacement.tsx`, `learning-track-creation.tsx`,
the base lifecycle/capacity/track sections in `plan-workspace.tsx`) already uses. No new pattern was
invented.

One implementation choice made this session, not dictated verbatim by the design doc: the `/plan`
control uses **one shared preview/apply action pair** across all three operations (create, change,
remove), with the `operation` hidden form field carrying the distinction, rather than three separate
action pairs. This mirrors the owner command's own one-command/three-operation shape and the
existing "Learning Tracks" pause/resume section's pattern (one action pair, an `operation` field
resolved from the selected Track's capability).

Full detail — contracts, decided behavior, and the real regression `verify:auth` caught (a duplicate
accessible name between this component's create-form reason field and the base lifecycle section's
reason field, only found because the auth gate exercises the real `/plan` page with every control
rendered at once, unlike the isolated fixture harness) — is recorded in
`docs/implementation/PHASE_4B_D3B1_AVAILABILITY_WINDOWS_STATUS.md`. Read that file for anything this
report only summarizes.

## 4. Files and migrations changed

No migration, schema-owning SQL, production dependency, or lockfile changed. Full file list is in
the status document's "Files and migrations" section; summarized here by purpose:

- **Event contract**: `schemas/events/v1/planning-event.schema.json` (additive `AVAILABILITY_CHANGED`
  variant), four new event fixtures, `tests/contract/planning-event.test.ts`.
- **Server boundary**: `src/ui/plan/server/database-plan.ts` (+3 functions, +tests in
  `database-plan.test.ts`), `src/ui/plan/server/plan-workspace-v1.ts` (re-exports),
  `src/app/plan/actions.ts` (+2 server actions and one shared input parser).
- **UI**: new `src/ui/plan/availability-windows.tsx` and its test; `src/ui/plan/plan-types.ts`,
  `src/ui/plan/plan-workspace.tsx`, `src/app/plan/page.tsx` (+its test) wired to load, cross-check,
  and render it alongside every other Plan control.
- **Test harness**: `src/app/dev/plan-fixture/page.tsx` gained a `?preview=availability` state used
  by both the E2E suite and manual inspection.
- **E2E**: `tests/e2e/plan.spec.ts` — one dedicated journey test plus additions to the shared
  keyboard, 320px/touch-target, reduced-motion/forced-colors, and WCAG A/AA tests.
- **Docs**: new `docs/implementation/PHASE_4B_D3B1_AVAILABILITY_WINDOWS_STATUS.md` (the authoritative
  outcome record), this report.

## 5. Contracts and invariants

- Command `planning.change_availability_window_v1`, operations `create_availability_window`,
  `change_availability_window`, `remove_availability_window`; contracts
  `AvailabilityWindowSourceV1`, `AvailabilityWindowPreviewV1`, `AvailabilityWindowApplyResultV1`, all
  `1.0.0` — unchanged this session, already shipped by D3b1-db.
- New this session: event `planning.input_changed` gained change kind `AVAILABILITY_CHANGED`
  (`event_schema_version` unchanged at `1`), additive alongside the eight released variants.
- Every new app-layer function fails closed through the existing `PlanInputError` /
  `PlanConflictError` / `PlanUnavailableError` taxonomy; no new failure mode was introduced.
- Idempotency: the browser generates one lowercase request UUID per preview intent, used directly as
  `idempotencyKey` (unprefixed) — the `planning-create-identity/1.0.0` pattern Growth Plan
  replacement and Learning Track creation already use.
- No calculation contract changed. D3b1 stays clock-free for capacity.

## 6. Verification

Every command below was executed in this session on Node 24.19.0 (`/home/ilya/.n/bin`; the
environment's default `node` on `PATH` is one patch below what `jsdom@30.0.1` requires). Docker was
available and used for every database-backed gate.

| Gate | Result |
|---|---|
| `pnpm format:check` | PASS |
| `pnpm lint` | PASS |
| `pnpm typecheck` | PASS |
| `pnpm verify:db` | PASS — 49 pgTAP files, 3070 assertions, `db lint` clean (unchanged from the prior D3b1-db session; confirms no DB drift from this app-only diff) |
| `pnpm verify:auth` | PASS, after fixing one real regression it caught (see §3 and the status doc) |
| `pnpm verify` (format, lint, typecheck, database-runner, backup-archive, contracts, performance, unit coverage, full E2E) | PASS — contracts 418/26 files, unit coverage 998 tests/98 files at 86.51%/80.77%/91.05%/87.82% (stmts/branch/funcs/lines) against the 85/80/85/85 thresholds, full E2E suite 38/38 |
| `pnpm verify:backup` | PASS |

`pnpm verify` initially failed twice before passing: once on formatting (fixed with
`prettier --write`), once on the global branch-coverage threshold (79.71%, then 79.97%, both just
under 80% — fixed by adding ten more component tests and three more `database-plan.test.ts` cases,
never by weakening or deleting a test; see the status doc for the exact list). `pnpm verify:auth`
also failed once for the real label-collision regression described in §3, fixed and re-verified
green before the final `pnpm verify` run above.

## 7. Git state

- Branch `claude/d3b1-app`, one new commit on top of `bd83745` (D3b1-db) → `7860feb` (generated
  Supabase types sync).
- Commit `f5f1a55`: `feat(planning): D3b1 availability window app layer` — 19 files changed, all
  four verify gates passing at commit time.
- Not pushed. `main` is unaffected.
- `docs/DAILY_PACE_AUTOREPLAN_AGENT_PROMPT.md` and `AGENTS.md` were not read, edited, or staged.
- Working tree is clean except a pre-existing, unrelated, already-modified `.gitignore` (adds
  `.aider*`) that predates this session and was left untouched, per "preserve unrelated user
  changes."

## 8. Remaining work

1. **D3b1's own pgTAP database proof is confirmed still missing** — checked this session, not just
   inherited as an open question. Neither `supabase/tests/database/050_phase4b_availability_windows.test.sql`
   nor a `051_..._concurrency.test.sql` exists in this repository; nothing under
   `supabase/tests/database/` covers availability windows as its subject, and `verify:db` still runs
   the same 49 files / 3070 assertions as before D3b1 started. The prior D3b1-db session's own
   handoff report recorded this honestly as deferred (a verified draft exists in a scratch project at
   `/home/ilya/pando-d3b1-dev`, outside this repository, never copied in), even though the split
   plan's row 1 originally scoped "pgTAP + concurrency tests" into D3b1-db. This app-layer outcome
   did not touch the database layer (explicitly out of scope for this session) and did not add these
   files. Treat closing this as the fastest next step before D3b2, since a verified draft already
   exists elsewhere.
2. **D3b2 — V3 capacity composition and rollout**, per row 3 of
   `docs/implementation/CLAUDE_SESSION_SPLIT_PLAN.md` (on `claude/d3a-growth-plan-replacement`,
   `b482f08`): `PlanningCalculationInputV3`, `PlanSnapshotV3`, calculation contract
   `planning-calculation/3`, `planner-engine/0.3.0`, `planning-policy/0.3`, the composition and
   protected-minimum rationing rules (design doc §3), and the persisted clock-bound capacity-effect
   preview design §6 requires. This has not started. Do not begin it in the same chat as any other
   outcome, per the split plan's own rule 1.
3. Known low-signal item, not a blocker: `src/shared/supabase/database.generated.ts` was not
   regenerated this session (no schema change occurred, so nothing to regenerate); the Planning
   boundary calls RPCs through a typed name union with an explicit `as never` cast, so this causes no
   type or runtime gap.

## 9. Codex resume prompt

```text
Прочитай docs/implementation/CLAUDE_CODE_HANDOFF_REPORT.md,
docs/implementation/PHASE_4B_D3B1_AVAILABILITY_WINDOWS_STATUS.md,
docs/design/PHASE_4B_D3B_AVAILABILITY_WINDOWS.md и ADR-0010 §6/§8/§9.
Ветка claude/d3b1-app теперь содержит завершённый D3b1: DB-слой (из bd83745, без изменений в этой
сессии) плюс полный app-слой — событие AVAILABILITY_CHANGED, loaders/actions в database-plan.ts,
компонент src/ui/plan/availability-windows.tsx с формами create/change/remove, интеграцию в
plan-workspace.tsx и page.tsx, фикстуру /dev/plan-fixture?preview=availability, component-тесты,
unit-тесты database-plan.test.ts и E2E-покрытие в tests/e2e/plan.spec.ts. Все четыре гейта
(pnpm verify:db, verify:auth, verify, verify:backup) прошли зелёными на момент коммита f5f1a55.
D3b1-app полностью завершён и проверен. ОДНАКО: в этой сессии обнаружен и подтверждён пробел из
исходного объёма D3b1-db — файлы supabase/tests/database/050_phase4b_availability_windows.test.sql
и 051_..._concurrency.test.sql так и не были закоммичены (черновик существует в отдельном scratch
проекте /home/ilya/pando-d3b1-dev, вне этого репозитория). D3b1 в целом (db+app) поэтому НЕ
полностью завершён, а D3b (D3b1+D3b2) остаётся partial. Следующий bounded outcome — сначала
закрыть этот pgTAP-пробел D3b1-db (самый быстрый путь: скопировать и проверить черновик из
scratch-проекта), затем D3b2 (V3 capacity composition and rollout), пункт 3 из
docs/implementation/CLAUDE_SESSION_SPLIT_PLAN.md (файл лежит на ветке
claude/d3a-growth-plan-replacement, коммит b482f08 — не смёржен в эту ветку; прочитай его оттуда).
Начинай каждый из них в отдельном новом чате, не в этом же.
```
