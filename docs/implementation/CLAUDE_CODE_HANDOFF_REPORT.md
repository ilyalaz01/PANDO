# Claude Code handoff report

Session date: 2026-09-04
Agent: Claude Code (Sonnet 5), continuing from the released D3b1 availability-window app layer
(`main`/`claude/d3b1-app` at `8f6c1ca`)
Branch: `claude/d3b2-engine`
Scope: D3b2-engine — row 3 of `docs/implementation/CLAUDE_SESSION_SPLIT_PLAN.md` (on
`claude/d3a-growth-plan-replacement`, commit `b482f08`; read there this session before proceeding),
narrowed by explicit session instruction to the pure calculation engine and policy only: contracts,
`planner-engine/0.3.0`, `planning-policy/0.3`, the availability-composed capacity/rationing math, and
unit/contract tests. UI rollout, engine-version switching controllers, and application-layer input
assembly from real `AvailabilityWindow` rows are explicitly out of scope for this session (they are
D3b2-rollout, the next bounded outcome).

## 1. Outcome attempted

D3b2-engine: `PlanningCalculationInputV3`/`PlanSnapshotV3` contracts, `planner-engine/0.3.0`,
`planning-policy/0.3`, the capacity-composition and priority-ordered protected-minimum rationing math
from ADR-0010 §6, and unit plus contract tests. Status: **complete** — this session's own scoped
outcome is fully implemented and verified. D3b2 as a whole (engine + rollout) remains **partial**
until D3b2-rollout ships; D3b (D3b1 + D3b2) remains partial for the same reason.

## 2. User-visible result

None yet. This outcome is calculation-only: a new pure engine function and policy exist and are
fully tested, but nothing reads real availability-window rows into it, no worker computes a V3
snapshot, and `/plan` shows nothing new. A signed-in person's experience is unchanged by this
session; D3b1's already-released "Availability windows" section still states plainly that recorded
availability does not yet change weekly capacity, which remains literally true until D3b2-rollout
wires this engine into the live calculation pipeline.

## 3. Architecture and policy decisions

Authority: `docs/design/PHASE_4B_D3B_AVAILABILITY_WINDOWS.md` §3/§4.2 and ADR-0010 §6/§8/§9. No
decision in either document was reinterpreted. Full detail — the composition/rationing formulas, the
exact implementation approach (why V3 could not safely delegate wholesale to the V2 pipeline, and
which V1/V2 helpers it reuses unchanged versus reimplements), and the complete test list — is
recorded in `docs/implementation/PHASE_4B_D3B2_ENGINE_STATUS.md`. Read that file for anything this
report only summarizes.

One implementation choice made this session, not dictated verbatim by the design doc: V3's engine and
validation functions are additive, appended to the existing `calculate-plan.ts`, following the exact
precedent the codebase already set when V2 was added alongside V1 in the same file — not a separate
module. Every existing V1/V2 function (`validateInput`, `protectedCapacityLimit`, `scoreCandidate`,
`capacity`, `warningCodes`, `calculateVerifiedPlanInternal`, and both public V1/V2 entry points) is
byte-for-byte unchanged; V3 could not safely reuse them wholesale because `GrowthPlanInputV3` drops
`weeklyCapacityMinutes`, and the hard protected-minimum invariant (checked against default capacity)
and the per-candidate admission pool (gated by effective capacity) need two different numbers that
V1/V2's single field cannot represent at once. This was proven by direct analysis, not just asserted:
an earlier "derive a V2-shaped view and delegate to `calculateVerifiedPlanV2`" design was rejected
mid-session specifically because it would incorrectly re-run V2's protected-minimum invariant check
against effective capacity, throwing exactly in the availability-limited scenario the feature exists
to support.

## 4. Files and migrations changed

No migration, schema-owning SQL, production dependency, or lockfile changed. Grouped by purpose:

- **Contracts**: new `schemas/planning/v3/planning-input.schema.json`,
  `schemas/planning/v3/plan-snapshot.schema.json`; `src/shared/contracts/schema-registry.ts` (+2
  registry entries); `src/shared/contracts/planning-semantics.ts` (+1 additive branch in
  `planSnapshotSemanticViolations` for the V3 capacity shape; V1/V2 branch unchanged).
- **Types**: `src/modules/planning/domain/planning-types.ts` (+`PLANNER_ENGINE_VERSION_V3`,
  `PlanningPolicyV3`, `DailyCapacityCapInput`, `GrowthPlanInputV3`, `CalculatePlanInputV3`,
  `VerifiedCalculatePlanInputV3`, `PlanSnapshotV3`; every V1/V2 type unchanged).
- **Engine and policy**: `src/modules/planning/domain/calculate-plan.ts` (+V3 section, ~600 lines,
  fully additive); new `src/modules/planning/domain/planning-policy-v0.3.ts`.
- **Application boundary**: `src/modules/planning/application/calculate-plan.ts` (+`calculatePlanV3`).
- **Fixtures**: new `tests/fixtures/calculation-engines/v0.3/planning.golden.json`.
- **Tests**: new `src/modules/planning/domain/calculate-plan-v0.3.test.ts` (9 cases),
  `tests/contract/planning-v3.test.ts` (6 cases).
- **Docs**: new `docs/policies/PLANNING_POLICY_V0.3.md`,
  `docs/implementation/PHASE_4B_D3B2_ENGINE_STATUS.md` (the authoritative outcome record);
  `src/modules/planning/README.md` (+D3b1 completion note, +this outcome); this report.

## 5. Contracts and invariants

- `PlanningCalculationInputV3`/`PlanSnapshotV3`, `planner-engine/0.3.0`, `planning-policy/0.3` — all
  new, additive alongside the unchanged V1/V2 tuples. `completedWorkPolicyVersion` stays
  `planning-completed-work/0.2` (D3b adds no completed-work rule, per ADR-0010 §8).
- New warning code `PROTECTED_MINIMUM_LIMITED_BY_AVAILABILITY`. No new score factor, reason-ref kind,
  or `expectedBenefit` code — D3b2 changes capacity meaning, not scoring, matching ADR-0010's stated
  consequence that "no existing coefficient changes value."
- The engine never trusts a supplied `effectiveWeeklyCapacityMinutes`; it re-derives
  `min(defaultWeeklyCapacityMinutes, sum(dailyCaps.capMinutes))` (reusing the exact pure helper the
  D3b1 preview digest already uses) and fails closed on mismatch — verify, don't trust the adapter.
- Rationing is deterministic: active tracks reserve in `(priority desc, trackKey asc)` order against
  the effective pool; a track's configured `protectedMinimumMinutes` is never rewritten, only how much
  of it a given week's effective capacity can reserve.
- Domain code stays pure: no I/O, no Next.js/Supabase/browser dependency, no implicit clock read.
- Fails closed (`PlanningInputError`) on a day-cap mismatch, a malformed/non-seven/non-consecutive
  `dailyCaps` array, a protected-minimum sum exceeding default capacity, a wrong policy tuple, or a
  wrong completed-work version — the same fail-closed contract V1/V2 already have.

## 6. Verification

Every command below was executed in this session on Node 24.15.0
(`/home/ilya/.local/share/pnpm/bin/node`, the environment's default `node` on `PATH`). Docker was
available and used for every database-backed gate.

| Gate | Result |
|---|---|
| `pnpm format:check` | PASS (after `prettier --write` on the 4 files it initially flagged) |
| `pnpm lint` | PASS |
| `pnpm typecheck` | PASS |
| `pnpm verify:db` | PASS — 49 pgTAP files, 3070 assertions, `db lint` clean (unchanged from before this session; confirms zero DB drift from this engine-only diff) |
| `pnpm verify:auth` | PASS, unaffected (this outcome touches no route, action, or UI file) |
| `npx vitest run src/modules/planning tests/contract/planning` | PASS — 129/129 (114 pre-existing + 15 new V3 cases), confirming zero V1/V2 regression |
| `pnpm test:contracts` | PASS — 27 files / 424 tests (was 26/418 before this session) |
| `pnpm test:unit:coverage` (standalone, before the full `pnpm verify` run) | PASS — 100 files / 1013 tests; 86.17%/80.19%/91.07%/87.55% (stmts/branch/funcs/lines) against the 85/80/85/85 thresholds |
| `pnpm verify` (format, lint, typecheck, database-runner, backup-archive, contracts, performance, unit coverage, full E2E) | PASS — format/lint/typecheck clean; `test:database-runner` and `test:backup-archive` (`node --test`) all green; `test:contracts` 27/424; `test:performance` green; `test:unit:coverage` 100 files/1013 tests at 86.17%/80.19%/91.07%/87.55% against 85/80/85/85; `next build` succeeded; full Playwright E2E 38/38, unchanged from before this session since this outcome touches no UI, route, or action file |
| `pnpm verify:backup` | PASS — "encrypted backup clean-restore gate passed" |

`pnpm format:check` initially failed on 4 files (`calculate-plan.ts`, `planning-types.ts`, the two new
V3 test files) — fixed with `prettier --write`, re-verified green, and both new tests still passed
after reformatting.

## 7. Git state

- Branch `claude/d3b2-engine`, based on `main` at `8f6c1ca` (D3b1-app).
- GIT_COMMIT_PLACEHOLDER
- `docs/DAILY_PACE_AUTOREPLAN_AGENT_PROMPT.md` was not read, edited, or staged.
- Working tree is clean except a pre-existing, unrelated, already-modified `.gitignore` (adds
  `.aider*`) that predates this session and was left untouched, per "preserve unrelated user
  changes" — same file the prior D3b1-app session also found and left alone.

## 8. Remaining work

1. **D3b2-rollout** — the next bounded outcome, explicitly excluded from this session by its own
   scope: assemble real `PlanningCalculationInputV3` from `AvailabilityWindow` rows and the current
   Growth Plan (the application-layer input-assembly counterpart to
   `assemble-plan-snapshot-input.ts`), the persisted clock-bound capacity-effect proposal the parent
   design §6 requires, worker/dispatcher V3 routing following the exact D2c expand-then-activate
   sequence, and the `/plan` capacity display. Do not begin it in the same chat as any other outcome.
2. **D3b1-db's pgTAP proof remains missing** — inherited from the D3b1-app session, not touched or
   fixed this session (out of scope; confirmed still true by this session's own `pnpm verify:db` run,
   which still executes the same 49 files / 3070 assertions with none named for availability windows).
   Treat closing this as the fastest next step whenever a session's scope allows database work; a
   verified draft exists in a scratch project at `/home/ilya/pando-d3b1-dev`, outside this repository.
3. No production dependency, migration, or schema changed this session. `database.generated.ts` was
   not regenerated (no schema change occurred, so nothing to regenerate).

## 9. Codex resume prompt

```text
Прочитай docs/implementation/CLAUDE_CODE_HANDOFF_REPORT.md,
docs/implementation/PHASE_4B_D3B2_ENGINE_STATUS.md, docs/design/PHASE_4B_D3B_AVAILABILITY_WINDOWS.md
§3/§4.2 и ADR-0010 §6/§8. Ветка claude/d3b2-engine содержит завершённый D3b2-engine: контракты
PlanningCalculationInputV3/PlanSnapshotV3 (schemas/planning/v3/*.schema.json), planner-engine/0.3.0
и planning-policy/0.3 (src/modules/planning/domain/calculate-plan.ts, planning-policy-v0.3.ts),
математику композиции эффективной недельной емкости и приоритетного рационирования protected-minimum
по (priority desc, trackKey asc), calculatePlanV3 в application-слое, полное юнит- и контрактное
тестовое покрытие (15 новых тестов), и golden-фикстуру v0.3, доказывающую что V3 арифметически
совпадает с V2 когда availability не ограничивает емкость. Все существующие V1/V2 функции не
изменены — только добавлены новые. Все гейты (verify:db, verify:auth, verify, verify:backup) прошли
зелёными на момент финального коммита. D3b2-engine полностью завершён и проверен, но это ЧИСТО
calculation-only outcome: UI-роллаут, переключение версий движка, assemble-plan-snapshot-input для
V3, персистентный clock-bound capacity-effect preview и worker/dispatcher роутинг НЕ реализованы —
это следующий bounded outcome, D3b2-rollout (design doc §4.2, ADR-0010 §8's expand-then-activate
sequence). Отдельно остаётся неисправленным унаследованный пробел: pgTAP-доказательство для D3b1-db
(availability windows) так и не закоммичено (см. §8 этого отчёта). Начинай каждый из этих outcomes
в отдельном новом чате, не в этом же.
```
