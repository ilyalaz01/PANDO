# Claude Code handoff report

Session date: 2026-09-04
Agent: Claude Code (Sonnet 5), continuing from the released D3b2-rollout outcome
(`claude/d3b2-rollout` at `c7fe481`)
Branch: `claude/d4-db`
Scope: D4-db — exactly Исход 5 of the split plan: the database layer for Targets-owned Interview
Campaigns (ADR-0010 §3, §4, §9), explicitly excluding the UI/controller layer (D4-app, next session)
and D5 (allocation overrides).

## 1. Outcome attempted

D4-db. Status: **complete**. Every command, table, RLS policy, and pgTAP proof the session's own
instructions required is implemented and green. Full detail, including a recorded open product
question the ADR does not resolve, is in
`docs/implementation/PHASE_4B_D4_CAMPAIGNS_STATUS.md`.

## 2. User-visible result

None. This session adds no UI, Server Action, or React component — it is a pure database-layer
outcome by explicit instruction. A signed-in person cannot yet see or use Interview Campaigns from
the browser; that is D4-app, the next bounded outcome.

## 3. Architecture and policy decisions

Authority: ADR-0010 §3 (deadline representation), §4 (retargeting), §9 (D4 scope: "no Planning
input and no coordinator"). No product semantic was reinterpreted. Decisions the ADR left open or
that this session made while implementing it, all recorded in full in the status document:

- **No single-active-campaign cardinality constraint.** ADR-0010 states Growth Plan cardinality
  precisely (exactly one current plan) but never states an analogous rule for campaigns. This
  session therefore permits any number of campaigns per workspace in any independent lifecycle
  state, including more than one simultaneously `active`. Recorded as an open question for the
  product owner or a future ADR, not silently decided.
- **Campaign identity is a server-issued opaque key** (`campaign:<uuid>`, mirroring the released
  availability-window `window_key`), never a user-chosen slug, per ADR-0010's security section
  explicitly naming "campaign" among the identifiers a client never chooses.
- **The deadline round-trip check reuses the released Review pattern verbatim**
  (`targets.local_timestamp_to_instant_v1` is byte-for-byte the same defensive logic as
  `review.local_timestamp_to_instant_v1`, just owned by Targets), per the ADR's own instruction to
  use "the same defensive pattern as the released Review local-timestamp helper."
- **A new bounded cross-context query, `identity.read_target_calendar_source_v1`, and its own
  purpose-specific NOLOGIN role `pando_identity_phase1_source`**, mirroring the released
  `pando_identity_planning_source` / `read_planning_calendar_source_v1` pattern exactly. This was
  necessary because Targets previously had no way to resolve the workspace's current local date and
  time zone, and the architecture rule is that cross-context reads are always a purpose-specific
  bounded query with its own grant, never a direct table read.
- **Creation-family commands (draft_campaign) carry an idempotency key inside their preview digest;
  field-changing commands (deadline change, retarget, lifecycle) do not.** This matches the
  released split between `growth_plan_replacement`-style creates (which must derive a stable future
  identity before any row exists) and `growth_plan_lifecycle`-style transitions on an existing
  aggregate (which need no such derivation). Getting this wrong first (by uniformly copying the
  create pattern everywhere) produced a real bug — a preview computed with a placeholder idempotency
  key that could never match the apply's real one — caught and fixed before any test was written
  against it.
- **`api.get_interview_campaigns_v1` and the two clock-reading preview entry points are declared
  volatile, not stable.** `supabase db lint` correctly flagged the mismatch (a `stable` function
  calling `pg_catalog.clock_timestamp()`); the released `api.preview_growth_plan_replacement_v1` and
  `api.preview_availability_window_v1` are volatile for the identical reason.
- **The read boundary's `daysUntil` field is whole calendar days in the campaign's recorded time
  zone, not fractional epoch-seconds.** The epoch-based formula written first was silently wrong —
  it drifts by a day depending on what hour a read happens to run — caught by hand-deriving the
  expected test value before trusting it, not by the test failing.

## 4. Files and migrations changed

One migration, one scratch-only pgTAP fixture file, four existing test/allowlist files updated, and
one generated file regenerated. Grouped by purpose:

- **Migration**: `supabase/migrations/20260906000100_phase4b_d4_interview_campaigns.sql` — the
  Identity→Targets calendar-source role/function; `targets.interview_campaigns` and
  `targets.interview_campaign_target_revisions` (forced RLS, one workspace-scoped policy each,
  append-only enforced by grant on the revision table); the immutability/goal-scope trigger; shared
  digest/identity/round-trip helpers; four event-payload validators; four pure preview-builder
  functions; nine `api.*` entry points (four preview/apply pairs plus one read); full
  ownership/grant/revoke bracketing matching the established `pando_phase1_api` role dance.
- **Test-only fixture**: `supabase/tests/fixture-migrations/99999999999999_d1b_pgtap_fixture_access.sql`
  — additive grants so pgTAP can call the new private helpers directly (never part of the deployable
  migration tree; applied only by the database gate).
- **New pgTAP tests**: `supabase/tests/database/050_phase4b_d4_interview_campaigns.test.sql`
  (functional — boundary/ownership pinning, identity/round-trip/event-validator unit checks, the
  full creation→deadline-change→retarget→start→end lifecycle plus a second campaign's cancel path,
  the read boundary, the immutability trigger, cross-workspace isolation) and
  `supabase/tests/database/051_phase4b_d4_interview_campaigns_concurrency.test.sql` (a real
  two-connection `dblink` race on `start_campaign` proving the workspace advisory lock serializes
  competing commands, plus an injected-trigger-failure atomicity proof for creation).
- **Updated allowlists**: `supabase/tests/database/001_phase0_schema_security.test.sql` (the nine
  new `api.*` functions added to the Targets-NOLOGIN-definer pinning check;
  `pando_identity_phase1_source` added to the bounded-`_source`-role security checks);
  `supabase/tests/database/005_catalog_targets_overlay_schema_seed.test.sql` (the two new tables
  added to the authoritative Catalog/Targets/Overlay table list); `tests/database/verify-database.test.mjs`
  (the hardcoded expected pgTAP argv list extended with the two new files).
- **Regenerated**: `src/shared/supabase/database.generated.ts`, via
  `pnpm exec supabase gen types typescript --local --schema api` against the migrated local database
  (`pnpm verify:auth` diffs this file byte-for-byte against a fresh generation and failed before the
  regeneration).
- **Docs**: new `docs/implementation/PHASE_4B_D4_CAMPAIGNS_STATUS.md`, this report.

## 5. Contracts and invariants

- New calculation-independent contracts: `InterviewCampaignCreationPreviewV1`/`ApplyResultV1`,
  `InterviewCampaignDeadlineChangePreviewV1`/`ApplyResultV1`,
  `InterviewCampaignRetargetPreviewV1`/`ApplyResultV1`,
  `InterviewCampaignLifecyclePreviewV1`/`ApplyResultV1`, `InterviewCampaignsV1`. None of these are
  registered in `src/shared/contracts/schema-registry.ts` yet — that JSON-Schema/TypeScript pairing
  is application-layer work for D4-app, not the database layer.
- No new calculation contract, engine version, or policy version. D4 adds no Planning input, per
  ADR-0010 §8.
- Ownership: every new table and function is Targets-owned (`pando_phase1_api`), matching every
  prior Targets command since Phase 1. No new Planning table, function, or grant was touched.
- Security: forced RLS with positive workspace-membership policies on both new tables; no
  cross-workspace table privilege exists for any runtime role (verified negatively in 050); every
  `api.*` function is `security definer`, pinned `search_path=''`, owned by a NOLOGIN role; private
  helpers are ungranted to all runtime roles (verified in 050 and 001).
- Idempotency: every apply command takes a UUID-shaped idempotency key, records a
  `outbox.command_receipts` row keyed on `(actor_user_id, command_type, idempotency_key)`, replays
  the stored response byte-for-byte on an identical retry, and refuses a reused key carrying a
  different request (verified in 050 for creation; the identical mechanism backs the other three
  commands).
- Failure behavior: every apply command fails closed before any write on a stale expected version, a
  stale/tampered preview digest, an inaccessible campaign or goal (including cross-workspace access,
  verified in 050), or an invalid lifecycle transition; 051 proves the whole command is atomic
  (receipt + row + event insert all roll back together) under an injected outbox trigger failure, and
  proves a losing concurrent command is refused with the exact stale-version error class, not a
  partial write.

## 6. Verification

Every command below was executed in this session on Node 24, with Docker available and used for
every database-backed gate, against the real Supabase CLI local stack.

| Gate | Result |
|---|---|
| `pnpm verify:db` | PASS — 51 pgTAP files, 3273 assertions, zero failures (49 files/3070 assertions before this session); `supabase db lint --level warning --fail-on warning` clean |
| `pnpm verify:auth` | PASS, after regenerating `database.generated.ts` (failed with a byte-for-byte diff before the regeneration) |
| `pnpm verify` (`format:check`, `lint`, `typecheck`, `test:database-runner`, `test:backup-archive`, `test:contracts`, `test:performance`, `test:unit:coverage`, `test:e2e`) | PASS — `test:database-runner` 15/15 after fixing its hardcoded pgTAP-file-list fixture (it failed once before the fix); unit coverage 86.30%/80.47%/91.20%/87.68% (stmts/branch/funcs/lines), numerically identical to the prior session because no TypeScript file was touched; `next build` succeeded; full Chromium E2E **39/39** (proves zero cross-feature regression) |
| `pnpm verify:backup` | PASS — "encrypted backup clean-restore gate passed" |

## 7. Git state

- Branch `claude/d4-db`, based on `main`/`claude/d3b2-rollout` at `c7fe481`.
- Commit `d560b83`: `feat(targets): D4 Interview Campaign database layer` — 9 files changed
  (1 new migration, 1 new status doc, 2 new pgTAP test files, 4 updated test/fixture files, 1
  regenerated types file), all four verify gates passing at commit time.
- This report's own commit follows as a separate `docs` commit, per this repository's established
  two-commit convention (feature commit, then a docs commit recording it).
- Not pushed. `main` is unaffected.
- `docs/DAILY_PACE_AUTOREPLAN_AGENT_PROMPT.md` was not read, edited, or staged.
- Working tree is clean except the same pre-existing, unrelated, already-modified `.gitignore` (adds
  `.aider*`) every prior session in this line has found and left untouched.

## 8. Remaining work

1. **D4-app** — the authenticated browser journey on top of the nine `api.*` RPCs delivered here:
   Server Actions, a domain/application contract layer (JSON Schema + TypeScript pairing registered
   in `schema-registry.ts`, mirroring `growth-plan-replacement-control.schema.json`'s shape for each
   of the four command families), contract fixtures (valid/invalid/boundary/malicious), UI
   components with keyboard/responsive/reduced-motion/automated-WCAG coverage, and Playwright E2E
   coverage. This is the exact next bounded outcome; do not begin it in the same session as D5.
2. **D5** (allocation overrides, the `campaign_lifecycle_v1` coordinator, `planning-calculation/4`)
   is untouched, per this session's explicit constraint.
3. **The single-active-campaign cardinality question** is open for the product owner; see
   `PHASE_4B_D4_CAMPAIGNS_STATUS.md` for the exact reasoning.
4. **D3b1-db's pgTAP proof remains missing** — inherited across four sessions now, still out of
   scope whenever a session's task does not include it.

## 9. Codex resume prompt

```text
Прочитай docs/implementation/CLAUDE_CODE_HANDOFF_REPORT.md,
docs/implementation/PHASE_4B_D4_CAMPAIGNS_STATUS.md, и ADR-0010
(docs/adr/0010-lifecycle-replacement-availability-and-campaign-semantics.md) §3/§4/§9. Ветка
claude/d4-db поверх claude/d3b2-rollout (c7fe481) содержит ЗАВЕРШЁННЫЙ и полностью проверенный слой
базы данных для D4 (Interview Campaign): таблицы targets.interview_campaigns и
targets.interview_campaign_target_revisions (миграция
supabase/migrations/20260906000100_phase4b_d4_interview_campaigns.sql), девять api.* RPC
(draft/start/change_campaign_deadline/change_campaign_target/end/cancel как четыре preview+apply
пары плюс один read api.get_interview_campaigns_v1), forced RLS, новый bounded cross-context read
identity.read_target_calendar_source_v1 (Identity → Targets, по образцу
read_planning_calendar_source_v1), и исчерпывающие pgTAP-тесты
(supabase/tests/database/050_phase4b_d4_interview_campaigns.test.sql — функциональность/RLS/
изоляция/lifecycle, 051_..._concurrency.test.sql — реальная гонка через dblink на start_campaign
плюс injected-trigger-failure atomicity-тест). database.generated.ts перегенерирован и закоммичен.
Все гейты зелёные на коммите d560b83: pnpm verify:db (3273 assertions/51 files, db lint clean),
pnpm verify:auth, pnpm verify (включая полный E2E 39/39; unit coverage не изменился, т.к.
TypeScript-код не трогали), pnpm verify:backup. UI/контроллеры НЕ созданы — это следующий bounded
outcome D4-app: Server Actions, domain/application contracts (JSON Schema + TS, зарегистрированные
в schema-registry.ts), UI-компоненты с keyboard/responsive/reduced-motion/WCAG-покрытием, Playwright
E2E — поверх уже готовых девяти api.* RPC. НЕ начинай D5 (allocation overrides, coordinator,
planning-calculation/4) в этой же сессии — Planning не тронут ни одним файлом. Открытый вопрос для
владельца продукта записан в статусном файле: ADR-0010 не задаёт ограничение на количество
одновременно активных Campaign на воркспейс, поэтому оно сознательно не реализовано в D4-db.
```
