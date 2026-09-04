# Phase 4B D3b2 — availability-composed capacity engine implementation status

Status: complete (engine only); every gate reproducible in this environment passed

Design: [D3b availability windows](../design/PHASE_4B_D3B_AVAILABILITY_WINDOWS.md) §3, §4.2

Decision record:
[ADR-0010](../adr/0010-lifecycle-replacement-availability-and-campaign-semantics.md) §6, §8

Policy: [Planning Policy v0.3](../policies/PLANNING_POLICY_V0.3.md)

Prior slice: [D3b1 availability windows](PHASE_4B_D3B1_AVAILABILITY_WINDOWS_STATUS.md)

Completed: 2026-09-04

## Delivered outcome

The pure, deterministic half of D3b2: a versioned Planning calculation engine that composes weekly
capacity from a Growth Plan's sustained default plus a verified seven-day availability composition,
and rations protected Track minutes deterministically when that composition falls short. This is
calculation-only — no persisted clock-bound preview, no real `AvailabilityWindow` input assembly, no
worker/dispatcher routing, and no `/plan` display exist yet. That is the explicitly separate
D3b2-rollout outcome (see "Remaining work").

## Contracts and policy

- `PlanningCalculationInputV3` (`schemas/planning/v3/planning-input.schema.json`) and
  `PlanSnapshotV3` (`schemas/planning/v3/plan-snapshot.schema.json`), both additive: every V1/V2
  schema, golden fixture, and contract test is unchanged and still passes.
- `GrowthPlanInputV3` replaces `weeklyCapacityMinutes` with `defaultWeeklyCapacityMinutes`,
  `effectiveWeeklyCapacityMinutes`, and an ordered, exactly-seven-entry `dailyCaps` array
  (`{ date, capMinutes, sourceWindowKey }`) covering the plan week's local days `d1..d7`. Tracks keep
  the released V2 shape unchanged (cadence fields included; no new per-track field).
- `planner-engine/0.3.0` (`calculateVerifiedPlanV3` in
  `src/modules/planning/domain/calculate-plan.ts`) and `planning-policy/0.3`
  (`PLANNING_POLICY_V0_3`, identical coefficients to v0.2 — capacity composition and rationing add no
  scoring coefficient).
- `calculatePlanV3` in `src/modules/planning/application/calculate-plan.ts` is the raw-input entry
  point: validates `planning-input-v3`, checks `planningInputSemanticViolations`, calls the pure
  engine, then validates `plan-snapshot-v3` before returning — the same three-step discipline as
  `calculatePlan`/`calculatePlanV2`.

## Composition and rationing

Per ADR-0010 §6/§8, for the plan week's local days `d1..d7`:

```text
dayCap(d)                      = available_minutes of the active window covering d, else 1440
effectiveWeeklyCapacityMinutes = min(defaultWeeklyCapacityMinutes, sum(dayCap(d1..d7)))
remainingMinutesThisWeek       = max(effectiveWeeklyCapacityMinutes - consumedMinutesThisWeek, 0)
```

The engine never trusts the supplied `effectiveWeeklyCapacityMinutes`: `validateGrowthPlanCapacityV3`
re-derives it from `defaultWeeklyCapacityMinutes` and `dailyCaps[].capMinutes` (reusing the exact pure
`effectiveWeeklyCapacityMinutes` helper the D3b1 preview digest already uses, so there is one source
of truth for the formula) and fails closed (`INVALID_PLANNING_INPUT`) on any mismatch — the same
"verify, don't trust the adapter" discipline C5 already established for Mastery prerequisite counts.
`dailyCaps` must be exactly seven entries covering seven consecutive ascending calendar dates; the
engine treats the array positionally (`d1..d7` by index), not by cross-checking each date against the
evaluation horizon's time zone, keeping the composition math clock-free and dependency-free.

The hard invariant that active protected-minimum minutes may not exceed weekly capacity is checked
against `defaultWeeklyCapacityMinutes` (the write-time invariant D2b2 already enforces), never against
the possibly-lower effective capacity — an availability-limited week is expected, non-blocking
behavior, not corrupt input.

When effective capacity falls below the sum of active protected minima, `rationProtectedMinutes`
reserves deterministically in `(priority desc, trackKey asc)` order, each track claiming
`min(protectedMinimumMinutes, poolRemaining)` from a pool that starts at
`effectiveWeeklyCapacityMinutes`. A track that receives less than its configured minimum is `limited`;
if any active track is `limited`, the snapshot's `warningCodes` gains
`PROTECTED_MINIMUM_LIMITED_BY_AVAILABILITY` (added once, not per track — the existing flat
warning-code list has no per-track slot). `protectedMinimumMinutes` itself is never rewritten.

Per-candidate admission reuses the released V1/V2 deficit/flexible split unchanged in shape
(`protectedCapacityLimitV3` mirrors `protectedCapacityLimit`), substituting the effective pool for the
default pool and each active track's **rationed** `reservedMinutes` for its raw
`protectedMinimumMinutes` when computing how much of a track's protected minute deficit still needs
reserved room this week. When availability does not limit a plan
(`effectiveWeeklyCapacityMinutes === defaultWeeklyCapacityMinutes`), rationing always reserves every
active track's full minimum — the default-capacity invariant already guarantees the sum fits — so V3
admission, scoring, and output are arithmetically identical to V2's in every unlimited plan. The
checked-in V3 golden fixture proves this directly: its `expected.actions` equals the V2 golden's
`expected.actions` byte-for-byte.

The `TRACK_PROTECTED_MINIMUM` score factor keeps its released V1/V2 meaning
(`meaningfulMinutesThisWeek < protectedMinimumMinutes`, the raw configured minimum): whether a track
deserves priority for being behind its own goal is independent of whether this week's capacity can
fully honor it. No new score factor, reason-ref kind, or `expectedBenefit` code was added — D3b2
changes capacity meaning, not scoring.

## Implementation approach

`calculateVerifiedPlanV3` and its supporting functions
(`validateInputV3`, `validateGrowthPlanCapacityV3`, `rationProtectedMinutes`,
`protectedCapacityLimitV3`, `scoreCandidateV3`, `capacityV3`, `warningCodesV3`) are additive functions
appended to `src/modules/planning/domain/calculate-plan.ts`. Every existing V1/V2 function
(`validateInput`, `protectedCapacityLimit`, `scoreCandidate`, `capacity`, `warningCodes`,
`calculateVerifiedPlanInternal`, `calculateVerifiedPlan`, `calculateVerifiedPlanV2`, and every
validation/scoring helper) is byte-for-byte unchanged — verified both by inspection and by re-running
every pre-existing V1/V2 unit and contract test unmodified after the change (all pass). V3 could not
safely delegate wholesale to the V2 pipeline: `GrowthPlanInputV3` drops `weeklyCapacityMinutes`, and
the hard protected-minimum invariant and the per-candidate admission pool need two different
capacity numbers (default vs. effective) that V1/V2's single field cannot represent simultaneously.
Everywhere a shared V1/V2 helper only reads fields identical across versions (readiness, campaign,
evaluation horizon, energy, review — never `growthPlan.weeklyCapacityMinutes`), it is called directly
with a documented, narrow cast rather than duplicated.

`src/shared/contracts/planning-semantics.ts`'s `planSnapshotSemanticViolations` gained one additive
branch: when `capacity.effectiveWeeklyCapacityMinutes` is present (a V3 snapshot), it checks
`remainingMinutesThisWeek === max(0, effective - consumed)` and `effective <= default`; the existing
V1/V2 branch (`capacity.weeklyCapacityMinutes`) is unchanged and still runs for V1/V2 snapshots.
`src/shared/contracts/schema-registry.ts` gained `planning-input-v3` and `plan-snapshot-v3` entries
alongside the existing v1/v2 ones.

## Files changed

- **Types**: `src/modules/planning/domain/planning-types.ts` — `PLANNER_ENGINE_VERSION_V3`,
  `PlanningPolicyV3`, `DailyCapacityCapInput`, `GrowthPlanInputV3`, `CalculatePlanInputV3`,
  `VerifiedCalculatePlanInputV3`, `PlanSnapshotV3` (additive; every V1/V2 type unchanged).
- **Engine**: `src/modules/planning/domain/calculate-plan.ts` (additive V3 section);
  `src/modules/planning/domain/planning-policy-v0.3.ts` (new).
- **Application**: `src/modules/planning/application/calculate-plan.ts` — `calculatePlanV3`.
- **Contracts**: `schemas/planning/v3/planning-input.schema.json`,
  `schemas/planning/v3/plan-snapshot.schema.json` (new);
  `src/shared/contracts/schema-registry.ts`, `src/shared/contracts/planning-semantics.ts` (additive).
- **Fixtures**: `tests/fixtures/calculation-engines/v0.3/planning.golden.json` (new; derived from the
  v0.2 golden with an unlimited seven-day composition, proving V3-equals-V2 in the unlimited case).
- **Tests**: `src/modules/planning/domain/calculate-plan-v0.3.test.ts` (9 cases: composition
  re-derivation, below-default effective capacity, all-zero-week `NO_CAPACITY`, rationing plus the
  warning code, `TRACK_PROTECTED_MINIMUM` using the raw minimum, trackKey tie-break, the
  default-capacity invariant, policy/completed-work version fail-closed, and V2 non-regression);
  `tests/contract/planning-v3.test.ts` (6 cases: golden match, V1/V2 cross-rejection, V2-equivalence
  in the unlimited case, rationing plus warning, composition-mismatch fail-closed, malformed/
  non-consecutive `dailyCaps`).
- **Docs**: `docs/policies/PLANNING_POLICY_V0.3.md` (new), this report,
  `src/modules/planning/README.md` (D3b1 completion note plus this outcome).

`docs/DAILY_PACE_AUTOREPLAN_AGENT_PROMPT.md` was not read, edited, or staged, per the session
constraint.

## Contracts and invariants

- Engine `planner-engine/0.3.0`, policy `planning-policy/0.3`, calculation contract
  `PlanningCalculationInputV3`/`PlanSnapshotV3` — all new, additive alongside V1/V2's unchanged
  tuples. `completedWorkPolicyVersion` stays `planning-completed-work/0.2` (D3b adds no
  completed-work rule).
- New warning code: `PROTECTED_MINIMUM_LIMITED_BY_AVAILABILITY`. No new score factor, reason-ref
  kind, or `expectedBenefit` code.
- The domain layer stays pure: no I/O, no Next.js/Supabase/browser dependency, no implicit clock
  read (the engine consumes `evaluationHorizon.asOf`/`dailyCaps` as supplied, never reads the wall
  clock or a real time zone database).
- Fails closed (`PlanningInputError`, code `INVALID_PLANNING_INPUT`) on: a day-cap composition that
  does not match the supplied effective number, a `dailyCaps` array that is not exactly seven
  consecutive ascending calendar days, a protected-minimum sum exceeding default capacity, a policy
  tuple other than `planning-policy/0.3`, or a `completedWorkPolicyVersion` other than
  `planning-completed-work/0.2` — matching the same fail-closed contract V1/V2 already have.

## Verification

Every command below was executed in this session on Node 24.15.0
(`/home/ilya/.local/share/pnpm/bin/node`, already the default on `PATH`). Docker was available and
used for every database-backed gate.

| Gate | Result |
|---|---|
| `pnpm format:check` | PASS |
| `pnpm lint` | PASS |
| `pnpm typecheck` | PASS |
| `pnpm verify:db` | PASS — 49 pgTAP files, 3070 assertions, `db lint` clean (unchanged from before this session; confirms zero DB drift from this engine-only diff) |
| `pnpm verify:auth` | PASS, unaffected (this outcome touches no route, action, or UI file) |
| `npx vitest run src/modules/planning tests/contract/planning` | PASS — 129/129 (114 pre-existing + 15 new V3 cases), confirming zero V1/V2 regression |
| `pnpm test:contracts` | PASS — 27 files / 424 tests (was 26/418 before this session; +1 file, +6 tests) |
| `pnpm verify` (format, lint, typecheck, database-runner, backup-archive, contracts, performance, unit coverage, full E2E) | PASS — `test:database-runner`/`test:backup-archive` green, `test:contracts` 27 files/424 tests, `test:performance` green, `test:unit:coverage` 100 files/1013 tests at 86.17%/80.19%/91.07%/87.55% (stmts/branch/funcs/lines) against 85/80/85/85, `next build` succeeded, full Playwright E2E 38/38 unchanged |
| `pnpm verify:backup` | PASS — "encrypted backup clean-restore gate passed" |

## Remaining work

1. **D3b2-rollout** — the next bounded outcome, explicitly excluded from this session by its own
   scope: assemble real `PlanningCalculationInputV3` from `AvailabilityWindow` rows and the current
   Growth Plan (the application-layer input-assembly counterpart to
   `assemble-plan-snapshot-input.ts`), the persisted clock-bound capacity-effect proposal the parent
   design §6 requires for a capacity-effect preview, worker/dispatcher V3 routing following the exact
   D2c expand-then-activate sequence (add, prove V1/V2 still read, activate, move pointers), and the
   `/plan` capacity display. Do not begin it in the same session as any other outcome.
2. **D3b1-db's pgTAP proof remains missing** — inherited, not touched or fixed this session (out of
   this session's scope; confirmed still true by this session's own `pnpm verify:db` run, which still
   executes the same 49 files / 3070 assertions with none named for availability windows). See the
   D3b1-app handoff report §8 for the original finding and the scratch-project draft location.
3. No production dependency, migration, or schema changed this session. `db.generated.ts` was not
   regenerated (no schema change).

## Codex/Claude resume prompt

```text
Прочитай docs/implementation/CLAUDE_CODE_HANDOFF_REPORT.md, этот файл
(docs/implementation/PHASE_4B_D3B2_ENGINE_STATUS.md), docs/design/PHASE_4B_D3B_AVAILABILITY_WINDOWS.md
§3/§4.2, ADR-0010 §6/§8, docs/policies/PLANNING_POLICY_V0.3.md. Ветка claude/d3b2-engine содержит
завершённый D3b2-engine: PlanningCalculationInputV3/PlanSnapshotV3 контракты
(schemas/planning/v3/*.schema.json), planner-engine/0.3.0 и planning-policy/0.3
(src/modules/planning/domain/calculate-plan.ts, planning-policy-v0.3.ts), математику композиции и
приоритетного рационирования протектед-минимумов, calculatePlanV3 в application-слое, и полное
покрытие юнит/контрактными тестами. Все существующие V1/V2 функции не изменены (только добавлены
новые). Это ЧИСТО calculation-only outcome — UI-роллаут, переключение версий движка,
assemble-plan-snapshot-input для V3, персистентный clock-bound preview и worker/dispatcher роутинг
НЕ реализованы (это D3b2-rollout, следующий bounded outcome). Начинай D3b2-rollout в отдельном новом
чате.
```
