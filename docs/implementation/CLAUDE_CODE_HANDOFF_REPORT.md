# Claude Code handoff report

Session date: 2026-09-05
Agent: Claude Code (Sonnet 5), continuing from the released D5-db outcome (`claude/d5-db` at
`a17cbad`)
Branch: `claude/d5-app`
Scope: D5-app — exactly Исход 8 of the split plan, the final outcome of Phase 4B D3–D5: the
`planner-engine/0.4.0`/`planning-policy/0.4` calculation engine, `assemblePlanSnapshotInputV4` and
its dispatcher routing, five new JSON Schema/TypeScript contracts (with fixtures) for the D5-db
commands, and a real `/campaigns` browser workflow for allocation overrides and campaign lifecycle
coordination. Explicitly excluded, per this session's own instructions: any SQL migration
(create or modify), weakening any existing test, and touching
`docs/DAILY_PACE_AUTOREPLAN_AGENT_PROMPT.md`.

## 1. Outcome attempted

D5-app. Status: **complete**. Every deliverable the session's own instructions required is
implemented, tested, and green: the domain engine and policy, the application-layer "expand"
plumbing (real code, but inert until a future SQL-permitted session activates it — see below), the
five contracts with fixtures, and a fully working `/campaigns` browser workflow wired to D5-db's
already-real commands. Full detail is in
`docs/implementation/PHASE_4B_D5_ALLOCATIONS_STATUS.md`'s "D5-app" section (appended after D5-db's
own, unmodified record).

## 2. User-visible result

On `/campaigns`, a signed-in person can now:

- **Start, end, or cancel a campaign through the coordinator** instead of the plain D4 command
  (`campaign-lifecycle.tsx` was rewritten). Nothing regresses for a campaign with no override; a
  campaign that does carry an active override can now be ended/cancelled from the browser without
  hitting D5-db's own guard-trigger refusal, closing D5-db's own recorded remaining-work item.
- **Optionally attach one allocation override to one Learning Track when starting a campaign** —
  a `<select>` of the workspace's active Tracks plus optional priority/protected-minute/cadence
  number fields, previewed and confirmed exactly like every other campaign command on this page.
- **View, change, and remove a campaign's active allocation overrides** through a new "Allocation
  overrides" panel on each campaign card (`campaign-allocation-overrides.tsx`), each with its own
  preview/confirm step.

What is *not* yet user-visible: the `/today` and `/plan` recommendation snapshot still never
reflects a campaign, an override, a paused-plan-plus-campaign, or a passed deadline. The pure
`planner-engine/0.4.0` that would compute that is fully built and tested, but — like
`planner-engine/0.3.0` before it — cannot be reached by any real delivery without a SQL migration
this session was forbidden from writing. This is a deliberate, documented, expand-only rollout half,
not a partial or broken feature.

## 3. Architecture and policy decisions

Authority: ADR-0010 §2, §3, §5, §7, §8, §9. No product semantic was reinterpreted.

- **The campaign-candidate Track-provenance fix (ADR-0010 §2) is a real correctness gap closure,
  not a new feature.** V1–V3 nulled a candidate's `trackId` whenever `GROWTH_PLAN` fell out of its
  effective sources, which silently discarded Focus attribution for a campaign-sourced candidate
  the instant its parent Track (or the base plan) stopped being `ACTIVE` — contradicting ADR-0010
  §2's explicit requirement that a campaign-sourced candidate "still reference exactly one Learning
  Track for provenance." `scoreCandidateV4` retains `trackId` whenever `CAMPAIGN` is an effective
  source, independent of `GROWTH_PLAN`; the `TRACK_*` scoring factors stay gated on `GROWTH_PLAN`
  and an `ACTIVE` Track exactly as before, so this is additive, not a scoring change.
- **The engine independently re-verifies the allocation-override floor invariant and every override
  field's range, rather than trusting the adapter** — the same defensive posture V3 already applies
  to effective capacity. `validateAllocationOverride` raises a hard error (not a soft blocker) when
  `protectedMinimumMinutesOverride` is below the Track's own floor, matching D5-db's own identical
  choice for the direct command.
- **No new score factor, warning-array shape, or snapshot field was introduced beyond two warning
  *codes*** (`BASE_PLAN_PAUSED`, `CAMPAIGN_DEADLINE_PASSED`), per ADR-0010 §8's explicit "no
  existing coefficient changes value."
- **A cross-version fix to the shared `planning-semantics.ts` was required and is the one edit that
  touches code every released calculation version depends on.** Its `planSnapshotSemanticViolations`
  hard-rejected any snapshot whose nearest deadline preceded `calculatedAsOf`, and its
  `actionViolations` expected an unclamped `daysUntilDeadline` — both correct for V1–V3, both
  contradicted by ADR-0010 §3 for V4. Both checks now branch on `engineVersion ===
  "planner-engine/0.4.0"` so V1–V3 keep their exact original behavior unconditionally.
- **`assemblePlanSnapshotInputV4` and the dispatcher's `.../4` routing are real, fully tested, but
  deliberately inert** — the same "expand" half of ADR-0010 §8's expand-then-activate sequence
  D3b2-rollout already established as this codebase's precedent for exactly this situation (a
  SQL-forbidden session extending a calculation version). No delivery can carry
  `planning-calculation/4` until a future session widens the
  `plan_snapshot_attempts.calculation_contract_version` CHECK constraint and extends the source-
  bundle SQL — the identical remaining gap `.../3` already has, now shared by `.../4` too.
- **`campaign-lifecycle.tsx` was moved to the coordinator for every operation**, not kept on the
  plain D4 path with a coordinator-only fallback for overrides — the coordinator is a strict
  superset of the plain path's preconditions, so this is a safe, non-regressing simplification. The
  plain D4 Server Action and its underlying command wrapper were left in place (unused by the UI
  now) rather than deleted, since they remain valid, tested, independently correct code that
  nothing asked to be removed.
- **The browser accepts at most one attached override at `start_campaign`**, a deliberate, recorded
  scope decision distinct from the coordinator's own 20-override capacity — kept for form
  simplicity in this first release; the wire-level plumbing already supports more.
- **A genuine pre-existing bug, not introduced this session, was found and fixed**: the shared
  "dismiss every stale sibling preview" `dismissalVersion` mechanism in `campaign-lifecycle.tsx`
  (and, by the same inherited pattern, the new `campaign-allocation-overrides.tsx`) could not
  distinguish a self-caused bump from a sibling's, so clicking "Start this campaign" would
  immediately re-dismiss the very form the click had just opened, inside the same React commit. No
  released e2e test had ever exercised this exact path (every prior lifecycle e2e case opens
  straight into an already-previewed state via a fixture, never via a fresh click on the full
  multi-campaign page); this session's own new e2e test for the override picker was the first to
  click through it and caught it immediately. Fixed with a `suppressNextDismiss` ref, applied
  identically to both components.

## 4. Files and migrations changed

No SQL migration, schema-owning file, production dependency, or lockfile changed.

- **Domain**: `src/modules/planning/domain/planning-types.ts` (+V4 types, additive); new
  `planning-policy-v0.4.ts`; `calculate-plan.ts` (+full V4 engine, appended after V3, reusing every
  version-agnostic helper unchanged); new `calculate-plan-v0.4.test.ts`.
- **Application**: `src/modules/planning/application/assemble-plan-snapshot-input.ts`
  (+`assemblePlanSnapshotInputV4` and helpers); `calculate-plan.ts` (+`calculatePlanV4`);
  `dispatch-plan-snapshot-projection.ts` (+`.../4` routing); each file's own test extended.
- **Contracts**: new `campaign-allocation-override-control.ts`, `campaign-allocation-overrides.ts`,
  `campaign-lifecycle-coordination-control.ts` (+3 JSON Schemas, one under `schemas/agent-control/
  v1/`); new `schemas/planning/v4/planning-input.schema.json` and `plan-snapshot.schema.json`;
  `schema-registry.ts` (+5 registrations); `planning-semantics.ts` (the V4-only relaxation above).
- **UI/app**: `src/ui/campaigns/server/database-campaigns.ts` (+5 functions); new
  `campaign-allocation-overrides.tsx` (+test); `campaign-lifecycle.tsx` (rewritten for the
  coordinator, +override picker, +dismiss-race fix); `campaign-list.tsx`/`campaign-workspace.tsx`/
  `campaign-types.ts` (thread new optional props); `src/app/campaigns/page.tsx` (+2 reads);
  `src/app/campaigns/actions.ts` (+4 Server Actions); `src/app/dev/campaigns-fixture/page.tsx`
  (fixed the stale lifecycle fixture; +override fixtures).
- **Tests**: new `tests/contract/planning-v4.test.ts` and three new contract test files with
  fixtures; new `tests/fixtures/calculation-engines/v0.4/planning.golden.json` (generated by
  actually running the engine); `tests/e2e/campaigns.spec.ts` (+2 cases, +2 WCAG-loop kinds); every
  touched module's own test file extended.
- **Docs**: `docs/implementation/PHASE_4B_D5_ALLOCATIONS_STATUS.md` (D5-app section appended; D5-db's
  own record left unmodified); this report (replaced).

## 5. Contracts and invariants

- New calculation contract: `PlanningCalculationInputV4`/`PlanSnapshotV4`, `planner-engine/0.4.0`,
  `planning-policy/0.4` — real and fully tested, but **inert**: no real delivery can carry it (see
  §3). This mirrors `.../3`'s own still-open status exactly.
- New client-facing contracts (`1.0.0`, live today): `CampaignAllocationOverrideChangePreviewV1`/
  `ApplyResultV1`, `CampaignAllocationOverridesV1`, `CampaignLifecycleCoordinationPreviewV1`/
  `ApplyResultV1`.
- Ownership, idempotency, and security are unchanged from D5-db — this session added no new SQL
  command, only pure calculation code and browser clients for commands D5-db already shipped.
- Failure behavior: the browser layer collapses every RPC/contract failure to the three existing
  error classes (`CampaignInputError`/`CampaignConflictError`/`CampaignUnavailableError`) the rest
  of `/campaigns` already uses.

## 6. Verification

Every command below was executed in this session on Node 24, with Docker available and used for
every database-backed gate, against the real Supabase CLI local stack.

| Gate | Result |
|---|---|
| `pnpm verify:db` | PASS — 53 pgTAP files, 3402 assertions, zero failures (unchanged from D5-db; no migration touched); `supabase db lint --level warning --fail-on warning` clean |
| `pnpm verify:auth` | PASS |
| `pnpm verify` (`format:check`, `lint`, `typecheck`, `test:database-runner` 15/15, `test:backup-archive` 3/3, `test:contracts` 465/465, `test:performance` 3/3, `test:unit:coverage`, `test:e2e`) | PASS — unit coverage **86.16%/80.01%/91.03%/87.44%** (statements/branches/functions/lines) against the 85/80/85/85 threshold, 1172/1172 unit tests passing; `next build` succeeded; full Chromium E2E **53/53** (51/51 prior + 2 new campaigns cases) |
| `pnpm verify:backup` | PASS — "encrypted backup clean-restore gate passed" |

Branch coverage (80.01%) clears its 80% floor narrowly, after two rounds of adding tests targeting
genuinely-uncovered validation branches in `database-campaigns.ts` and the V4 engine addition — real
coverage, not gamed. Worth a future session's attention if it drifts back under threshold; not
currently failing.

Also run and passing during iteration: `pnpm exec tsc --noEmit` (repeatedly), `pnpm format:check`,
`pnpm lint` (repo-wide), and a standalone
`PANDO_ENABLE_CAMPAIGNS_FIXTURE=true npx playwright test tests/e2e/campaigns.spec.ts` run twice
(first run caught the dismiss-race bug described in §3; second run, after the fix, passed 14/14).

## 7. Git state

- Branch `claude/d5-app`, based on `claude/d5-db` at `a17cbad`.
- This session's changes are staged for two commits, per this repository's established convention:
  one feature commit (`feat(planning): D5-app calculation engine, contracts, and campaign
  coordination workflow`) and one docs commit recording this report and the finalized status
  document.
- Not pushed. `main` is unaffected.
- `docs/DAILY_PACE_AUTOREPLAN_AGENT_PROMPT.md` was not read, edited, or staged.
- No SQL migration was created or modified.
- Working tree is clean except the same pre-existing, unrelated, already-modified `.gitignore`
  (adds `.aider*`) every prior session in this line has found and left untouched.

## 8. Remaining work

1. **The SQL-gated "activate" half for both `.../3` and `.../4`** — a future SQL-permitted session
   must widen the `calculation_contract_version` CHECK constraint and extend the source-bundle SQL
   to emit `bundle.availability`, `bundle.campaign`, and each Track's `allocationOverride`. Until
   then, `/today`/`/plan` never reflect a campaign, override, paused-plan-plus-campaign, or passed
   deadline — only the direct commands and their own read do.
2. **The "attach one override only" UI scope decision** — raising it to the coordinator's real
   20-override limit is additive whenever a product need justifies the added form complexity.
3. **D5-db's own two open questions** (unchanged, for the product owner): at-most-one-active-
   override-per-Track, and no path to attach a new override to an already-active campaign.
4. **D3b1-db's inherited missing pgTAP proof** remains unfixed, unrelated to this session's scope.
5. **Phase 4B D3–D5 is now closed** per this session's own instructions. The next bounded outcome is
   Phase 4B's own next item per `docs/README.md`'s canonical route, or Phase E (the authenticated
   ChatGPT Work/Codex Agent Control plane) per the human roadmap in `CLAUDE.md` — whichever the
   product owner selects next; this session did not choose it.

## 9. Codex resume prompt

```text
Прочитай CLAUDE.md, docs/implementation/CLAUDE_CODE_HANDOFF_REPORT.md, и
docs/implementation/PHASE_4B_D5_ALLOCATIONS_STATUS.md целиком (включая добавленный в конце раздел
"D5-app"). Ветка claude/d5-app поверх claude/d5-db закрывает Phase 4B D3-D5 полностью: реализован
planner-engine/0.4.0 и planning-policy/0.4 (campaign eligibility при paused Growth Plan сохранением
Track-provenance для campaign-кандидата на неактивном Track, post-deadline clamping до нуля дней
вместо отказа с независимой проверкой движком floor-инварианта allocation override), пять новых
контрактов (JSON Schema + TS + fixtures) для команд, которые D5-db уже сделал реальными
(CampaignAllocationOverrideChangePreview/ApplyResult, CampaignAllocationOverrides,
CampaignLifecycleCoordinationPreview/ApplyResult), и полностью РАБОЧИЙ браузерный workflow на
/campaigns — campaign-lifecycle.tsx переведён на координатор вместо прямой D4-команды с
опциональным прикреплением одного override при старте кампании, и новый компонент
campaign-allocation-overrides.tsx для просмотра/изменения/удаления активных overrides. Найден и
исправлен настоящий предсуществовавший баг гонки dismissalVersion (не introduced этой сессией, но
обнаруженный её первым реальным e2e-кликом). ВАЖНО: assemblePlanSnapshotInputV4 и dispatcher-роутинг
.../4 — это inert plumbing по образцу уже принятого прецедента D3b2-rollout для .../3: ни одна
реальная доставка не может нести planning-calculation/3 ИЛИ /4, пока SQL-разрешённая сессия не
расширит CHECK-constraint calculation_contract_version и не научит SQL source-bundle отдавать
bundle.availability/bundle.campaign/allocationOverride — это осознанно, задокументировано, не баг.
Все четыре гейта зелёные: pnpm verify:db (3402 assertions/53 files, lint clean, миграции не
менялись), pnpm verify:auth, pnpm verify (unit coverage 86.16/80.01/91.03/87.44% — branches чуть
выше 80%-порога после точечного добавления тестов; E2E 53/53, было 51/51), pnpm verify:backup.
Открытые пункты записаны в обоих документах: SQL-gated активация V3 и V4, UI ограничен одним
override при старте кампании (сознательно), и старые открытые вопросы D5-db про cardinality
overrides. Следующий bounded outcome выбирает владелец продукта — это не выбрано этой сессией.
docs/DAILY_PACE_AUTOREPLAN_AGENT_PROMPT.md не читался и не менялся.
```
