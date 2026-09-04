# Claude Code handoff report

Session date: 2026-09-04
Agent: Claude Code (Sonnet 5), continuing from the released D3b2-engine calculation-only outcome
(`claude/d3b2-engine` at `4b56c4e`)
Branch: `claude/d3b2-rollout`
Scope: D3b2-rollout — the next bounded outcome named explicitly by the D3b2-engine session's own
report: assemble real `AvailabilityWindow` rows into `PlanningCalculationInputV3`, a safe engine
switchover strategy, a capacity-effect preview, rollout/UI tests, and D3b's final status document.

## 1. Outcome attempted

D3b2-rollout. Status: **partial**, by explicit session-scoped design, not oversight. Everything
reachable without a SQL migration is complete and verified. The session's own instructions forbid
changing or creating any SQL migration; investigation before writing any code established that this
codebase's real engine-version "activation" — the step that lets the async Planning snapshot worker
actually compute `planning-calculation/3` for a real delivery — is entirely SQL-gated (a hard-coded
database CHECK constraint admits only `.../1` and `.../2`, and the released V1→V2 "activate" step
was itself a dedicated SQL migration with no TypeScript-only equivalent). That half is therefore
explicitly out of reach this session and is recorded as precisely scoped follow-up work rather than
silently narrowed or claimed done. Full detail in
`docs/implementation/PHASE_4B_D3B2_ROLLOUT_STATUS.md` and the D3b closure summary
`docs/implementation/PHASE_4B_D3B_STATUS.md` (both new this session).

## 2. User-visible result

A signed-in person now sees a new "Estimated capacity effect" section on `/plan`, directly under
"Availability windows": a live, honestly-labeled *estimate* — recomputed on every page load, never
saved — of how their recorded availability would affect the next seven local days if the
availability-aware capacity engine (`planner-engine/0.3.0`) were active, including which active
Learning Tracks would not receive their full protected minimum. It is explicitly and repeatedly
labeled as an estimate ("This is only an estimate: it is not saved, and it does not change your
Plan"). The pre-existing D3b1 text in the Availability windows section — "Recorded availability does
not change weekly capacity yet" — is unchanged and remains literally true: the person's actual
ranked Today/Plan output is still computed by `planner-engine/0.2.0`, unaffected by any window they
record, because the live async snapshot worker still only ever computes V1/V2.

## 3. Architecture and policy decisions

Authority: `docs/design/PHASE_4B_D3B_AVAILABILITY_WINDOWS.md` §4.2 and ADR-0010 §6/§8/§9. No product
semantic was reinterpreted. The one substantive decision this session made, not dictated verbatim by
either document, is recorded in both new status docs and summarized here:

- **The dispatcher "expand" half is genuinely additive and safe to ship inert.** `assemblePlanSnapshotInputV3`
  (new function in `assemble-plan-snapshot-input.ts`) and V3 recognition in
  `dispatch-plan-snapshot-projection.ts` are byte-for-byte incapable of affecting any real V1/V2
  delivery — the shared `assemblePlanSnapshotInputInternal` function's V1/V2 branches are unchanged,
  and no real database row can ever carry `calculationContractVersion = "planning-calculation/3"`
  today (the CHECK constraint in `20260903000100_phase4b_planning_cadence_dual_contract.sql` still
  only admits `.../1` and `.../2`). This was verified by inspection, not assumed.
- **The capacity-effect preview is stateless by necessity, not preference**, deviating from
  ADR-0010 §6's persisted, server-issued, ≤10-minute proposal. Persisting anything new needs a
  table, which needs a migration. Accepted because the preview answers no command and nothing is
  ever applied against its digest — there is no matching apply RPC, so the weaker guarantee (a
  digest mismatch between two reads, not server-side replay/expiry protection) has no exploitable
  consequence. This is documented as narrow and temporary, not a precedent for weakening any real
  command preview.
- **The preview composes only already-loaded, already-authenticated data** (`AvailabilityWindowSourceV1`,
  `CurrentLearningTracksV1` — both already fetched by `/plan` for their own sections) — no new RPC,
  no new SQL read, no new grant.
- **The preview's seven-day window is a rolling window from the server-resolved current local date,
  not the async worker's Monday-anchored plan week**, because the live `/plan` read boundary has no
  granted access to those boundaries. This is a documented, honest approximation, never presented as
  authoritative.
- `rationProtectedMinutes` (in `calculate-plan.ts`) is now exported with its parameter type widened
  from `PlanningTrackInputV2[]` to a new minimal structural interface, `RationableTrackInput`
  (`trackId`, `trackKey`, `priority`, `protectedMinimumMinutes`, `lifecycle`) — a type-level
  relaxation only, zero behavior change, verified by every pre-existing V1/V2/V3 test passing
  unmodified. This lets the stateless preview reuse the engine's own rationing math instead of a
  second implementation of ADR-0010 §6's formula.

## 4. Files and migrations changed

No migration, schema-owning SQL, production dependency, or lockfile changed. Grouped by purpose:

- **Domain**: `src/modules/planning/domain/calculate-plan.ts` (exports `rationProtectedMinutes` +
  new `RationableTrackInput` type; behavior unchanged); new
  `src/modules/planning/domain/capacity-effect-preview.ts` (pure day-cap composition, rationing
  wrapper, digest-input builder).
- **Application**: `src/modules/planning/application/assemble-plan-snapshot-input.ts`
  (+`assemblePlanSnapshotInputV3`); `src/modules/planning/application/dispatch-plan-snapshot-projection.ts`
  (+V3 contract recognition/routing); new
  `src/modules/planning/application/loaders/capacity-effect-preview.ts` (the literal
  `application/loaders` location the session instructions named).
- **UI**: new `src/ui/plan/server/capacity-effect-preview.ts` (adapts the two already-loaded `/plan`
  reads into the loader's input), `src/ui/plan/capacity-effect-preview.tsx` (presentational);
  `src/ui/plan/plan-types.ts`, `src/ui/plan/plan-workspace.tsx`, `src/app/plan/page.tsx` (wiring).
- **Dev fixture**: `src/app/dev/plan-fixture/page.tsx` (+`?preview=capacity-effect`, built through
  the real production adapter, not hand-authored JSON).
- **Tests** (24 new cases across 6 files, all passing): `capacity-effect-preview.test.ts` (domain,
  12 cases); new V3 `describe` block in `assemble-plan-snapshot-input.test.ts` (3 cases); new V3
  case in `dispatch-plan-snapshot-projection.test.ts` (1 case); `loaders/capacity-effect-preview.test.ts`
  (4 cases); `server/capacity-effect-preview.test.ts` (2 cases); `capacity-effect-preview.test.tsx`
  (2 cases); one new `tests/e2e/plan.spec.ts` case.
- **Docs**: new `docs/implementation/PHASE_4B_D3B2_ROLLOUT_STATUS.md` (this outcome's detailed
  record), new `docs/implementation/PHASE_4B_D3B_STATUS.md` (D3b's honest closure summary across all
  three D3b sessions), `src/modules/planning/README.md` (replaces the D3b2-engine "remaining work"
  paragraph), this report.

## 5. Contracts and invariants

- No new calculation contract, engine version, or policy version — `planning-calculation/3`,
  `planner-engine/0.3.0`, `planning-policy/0.3` were already shipped by D3b2-engine; this outcome
  wires more callers to them.
- New additive client-facing shape `CapacityEffectPreviewV1` (`contract`, `calculationContract`,
  `digestVersion`, `asOfLocalDate`, `defaultWeeklyCapacityMinutes`, `effectiveWeeklyCapacityMinutes`,
  `capacityLimitedByAvailability`, `dailyCaps`, `trackEffects`, `warningCodes`, `previewDigest`).
  Reuses the released `PROTECTED_MINIMUM_LIMITED_BY_AVAILABILITY` warning code; no new code.
  Read-only: no idempotency key, no apply path, no persistence.
- Domain code (`capacity-effect-preview.ts`) stays pure: no I/O, no Next.js/Supabase/browser
  dependency, no implicit clock read.
- `assemblePlanSnapshotInputV3`/dispatcher V3 routing fail closed identically to the released V1/V2
  behavior on malformed input; no existing fail-closed condition was relaxed anywhere in the shared
  code path both share.
- Security: the stateless preview issues no Supabase call of its own; it only recomposes data two
  already-granted, already-RLS-scoped reads returned for this same request. It exposes no new
  surface.

## 6. Verification

Every command below was executed in this session on Node 24, with Docker available and used for
every database-backed gate.

| Gate | Result |
|---|---|
| `pnpm format:check` | PASS (after `prettier --write` on the 10 new/changed files it initially flagged) |
| `pnpm lint` | PASS |
| `pnpm typecheck` | PASS |
| `npx vitest run src/modules/planning src/ui/plan tests/contract/planning` | PASS — 257/257 (233 pre-existing + 24 new) |
| `pnpm build` (`next build`, standalone) | PASS |
| `npx playwright test tests/e2e/plan.spec.ts` (standalone, against the production build) | PASS — 18/18 |
| `pnpm verify:db` | PASS — 49 pgTAP files, 3070 assertions (unchanged), `db lint` clean — confirms zero DB drift |
| `pnpm verify:auth` | PASS, unaffected |
| `pnpm verify` (format, lint, typecheck, database-runner, backup-archive, contracts, performance, unit coverage, full E2E) | PASS — `test:database-runner` 15/15, `test:backup-archive` 3/3, `test:contracts` 27 files/424 tests (unchanged — no new schema/contract this session), `test:performance` 3/3, `test:unit:coverage` 104 files/1037 tests (100/1013 before this session, +4 files/+24 tests) at 86.30%/80.47%/91.20%/87.68% (stmts/branch/funcs/lines) against 85/80/85/85, `next build` succeeded, full Playwright E2E **39/39** (all suites, not just Plan — proves zero cross-feature regression) |
| `pnpm verify:backup` | PASS — "encrypted backup clean-restore gate passed" |

## 7. Git state

- Branch `claude/d3b2-rollout`, based on `main`/`claude/d3b2-engine` at `4b56c4e`.
- Commit `3625341`: `feat(planning): D3b2-rollout application wiring and stateless capacity preview`
  — 21 files changed, all four verify gates passing at commit time.
- Not pushed. `main` is unaffected.
- `docs/DAILY_PACE_AUTOREPLAN_AGENT_PROMPT.md` was not read, edited, or staged.
- Working tree is clean except the same pre-existing, unrelated, already-modified `.gitignore` (adds
  `.aider*`) every prior session in this line has found and left untouched.

## 8. Remaining work

1. **The SQL-gated "activate" half of D3b2**, and, contingent on it, the ADR-0010 §6 persisted
   proposal — the exact scope is written out step by step in
   `docs/implementation/PHASE_4B_D3B_STATUS.md` ("The exact remaining slice") and
   `docs/implementation/PHASE_4B_D3B2_ROLLOUT_STATUS.md` ("Remaining work"). Needs a session
   explicitly permitted to write SQL migrations. Do not begin it in the same session as any other
   outcome.
2. **D3b1-db's pgTAP proof remains missing** — inherited across three sessions now, still not fixed,
   still out of scope whenever a session's task does not include database work. See the D3b closure
   summary for the scratch-project draft location.
3. **D4 (Campaign) work was not started**, per the session's explicit constraint. No file under
   Targets' Campaign surface was touched.
4. No production dependency, migration, or schema changed this session. `database.generated.ts` was
   not regenerated (no schema change occurred).

## 9. Codex resume prompt

```text
Прочитай docs/implementation/CLAUDE_CODE_HANDOFF_REPORT.md,
docs/implementation/PHASE_4B_D3B_STATUS.md (D3b closure summary — читай в первую очередь, отвечает
на вопрос "что реально работает"), docs/implementation/PHASE_4B_D3B2_ROLLOUT_STATUS.md,
docs/design/PHASE_4B_D3B_AVAILABILITY_WINDOWS.md §4.2 и ADR-0010 §6/§8/§9. Ветка claude/d3b2-rollout
поверх claude/d3b2-engine (4b56c4e) содержит завершённую (в рамках сессионного запрета на SQL) часть
D3b2-rollout: assemblePlanSnapshotInputV3 и V3-роутинг в диспетчере (src/modules/planning/application/
assemble-plan-snapshot-input.ts, dispatch-plan-snapshot-projection.ts) — это ТОЛЬКО "expand"-половина,
она инертна, потому что ни одна реальная запись в БД не может получить
calculation_contract_version = 'planning-calculation/3' без миграции, расширяющей CHECK constraint
в 20260903000100_phase4b_planning_cadence_dual_contract.sql; и полностью рабочий stateless
capacity-effect preview на /plan (src/modules/planning/application/loaders/capacity-effect-preview.ts,
src/ui/plan/capacity-effect-preview.tsx) — считается заново при каждом заходе на /plan из уже
загруженных AvailabilityWindowSourceV1/CurrentLearningTracksV1, ничего не сохраняет, явно помечен как
оценка. Реальная "активация" V3 для боевого воркера снапшотов НЕ сделана — она СВЯЗАНА с SQL-миграцией
(ровно как переход V1→V2 был отдельной миграцией 20260903000400_phase4b_planning_cadence_v2_activation.sql)
и явно вне рамок этой сессии. Следующий bounded outcome — SQL-разрешённая сессия, которая: (1) добавит
миграцию активации V3 по образцу V2-миграции, (2) расширит SQL-сборку source bundle воркера полем
bundle.availability.dailyCaps (форму уже ожидает assemblePlanSnapshotInputV3), (3) решит, заменять ли
stateless preview на персистентный ADR-0010 §6 proposal. Все точные шаги расписаны в
PHASE_4B_D3B_STATUS.md. Отдельно остаётся неисправленным унаследованный пробел: pgTAP-доказательство
для D3b1-db. D4 (Campaign) не начат — не начинай его в этой же сессии. Все гейты (verify:db, verify:auth,
verify — включая полный E2E 39/39, verify:backup) прошли зелёными на коммите 3625341.
```
