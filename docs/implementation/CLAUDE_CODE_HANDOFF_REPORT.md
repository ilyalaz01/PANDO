# Claude Code handoff report

Session date: 2026-09-04
Agent: Claude Code (Sonnet 5), continuing from the released D4-db outcome
(`claude/d4-db` at `7617d9f`)
Branch: `claude/d4-app`
Scope: D4-app — exactly Исход 6 of the split plan: the client and application layer for
Targets-owned Interview Campaigns on top of the nine `api.*` RPCs D4-db delivered — schemas,
contracts, loaders/Server Actions, a UI controller, and component/unit/Playwright E2E tests.
Explicitly excluded: any SQL/migration change, and D5 (allocation overrides, paused-plan ranking,
`planning-calculation/4`).

## 1. Outcome attempted

D4-app. Status: **complete**. Every deliverable the session's own instructions required is
implemented, tested, and green: event/contract schemas and fixtures, loaders and Server Actions
calling the nine released `api.*` RPCs, a UI controller for campaign status/lifecycle/deadline/
retarget with timezone-aware deadline input, and component/unit/Playwright E2E coverage. Full
detail is in `docs/implementation/PHASE_4B_D4_CAMPAIGNS_STATUS.md`.

One requested UI element — retargeting history — could not be built with real data: D4-db's read
boundary is exactly `api.get_interview_campaigns_v1`, which does not read
`targets.interview_campaign_target_revisions`, and this session was explicitly forbidden from
touching SQL. Rather than fabricate history or silently drop the feature, the UI shows an honest
panel stating the gap. This is recorded as the first item in "Remaining work" below and in the
status document.

## 2. User-visible result

A signed-in person can now open `/campaigns` from any page's navigation and:

- see every Interview Campaign they have ever created, with its exact lifecycle status
  (`DRAFT`/`ACTIVE`/`ENDED`/`CANCELLED`), its target Readiness Goal, and a plain-language deadline
  phrase ("12 days until the deadline", "is today", "is tomorrow", or "passed (date)");
- draft a new campaign against any of their currently active Readiness Goals, with an exact preview
  of the resulting draft before confirming;
- change a campaign's deadline, retarget it to a different active Readiness Goal, or start/end/
  cancel it — each with an exact server-computed before/after preview shown before the change is
  confirmed, and a confirmation that is automatically discarded the moment any input changes or a
  sibling action starts, so a stale confirmation can never be applied by accident;
- see an explicit, honest notice that retargeting history is recorded but not yet readable from the
  browser, instead of a fabricated or silently missing history list;
- see an explicit prompt to end or cancel a running campaign whose deadline has passed.

Nothing else in the product changed. No other page's navigation, layout, or behavior was modified.

## 3. Architecture and policy decisions

Authority: ADR-0010 §3 (deadline representation), §4 (retargeting), §9 (D4 scope). No product
semantic was reinterpreted; every decision below is an implementation-shape choice within what D4-db
already delivered.

- **A dedicated `/campaigns` route, not an addition to `/plan`.** `/plan`'s server component already
  composes ten different read sources with cross-read consistency-checking machinery
  (`src/app/plan/page.tsx`); Interview Campaigns have exactly one read source
  (`get_interview_campaigns_v1`), so none of that machinery is needed. A separate route keeps
  Targets' own browser surface architecturally distinct from Planning's, matching the established
  one-route-per-bounded-context-feature pattern already used by `/plan`, `/explore`, `/review`, and
  `/today`.
- **Active-Readiness-Goal selection reuses the already-released, Targets-owned
  `get_target_selection_source_v1`** (`loadTargetSelectionSourceV1`, the same read `/start` already
  uses), filtered to `lifecycle === "active"`. This was chosen over inventing a new read or reusing
  Planning's `get_growth_plan_replacement_source_v1` (which would have wrongly coupled campaign
  creation to Growth Plan existence, since a workspace can have Interview Campaigns with or without a
  current Growth Plan in this slice). No new cross-context read was added.
- **All five JSON Schema/TypeScript contract pairs were derived field-for-field from the actual
  `jsonb_build_object` calls in `supabase/migrations/20260906000100_phase4b_d4_interview_campaigns.sql`**,
  read in full before writing a single schema field, rather than assumed from the shape of similar
  Planning contracts. Two shape decisions this caught: the deadline-change preview's `before.deadline`
  has no `at` field (only `after.deadline` does — the "before" object never got one in the SQL); and
  only the creation preview carries `idempotencyKey` and a possibly non-empty `blockingReasons`/
  non-`true` `canApply` — the other three field-changing commands always return `canApply: true`
  because the database raises an exception before returning JSON for any invalid transition, so there
  is no applicability state to represent.
- **`campaignId`/`campaignKey` use a dedicated `uuidV8` regex definition, not JSON Schema's
  `format: "uuid"`.** Ajv's `uuid` format (via `ajv-formats`) only accepts RFC4122 versions 1–5;
  `targets.derive_campaign_identity_v1` constructs a version-8 UUID (the identical SHA-256-derived
  technique as `planning.derive_growth_plan_replacement_identity_v1`), which `format: "uuid"` would
  reject. This mirrors the released `availability-window-control.schema.json`'s `windowKey` pattern.
- **No retarget-history read was added.** See §1 and the status document's "Remaining work" — this is
  a deliberate, recorded gap, not an oversight.
- **UI components are line-for-line structural copies of the released pattern**
  (`growth-plan-replacement.tsx` for the single-command creation flow;
  `availability-windows.tsx`/`plan-workspace.tsx` for the multi-panel-with-shared-dismissal-counter
  pattern), not a new design. `useActionState`, a client-generated rotating idempotency key threaded
  through a hidden form field, and dismissal-on-any-sibling-intent are copied verbatim.

## 4. Files and migrations changed

No migration, SQL file, or generated database type file was touched. Grouped by purpose:

- **Schemas** (new): `schemas/interview-campaign/v1/interview-campaign-creation-control.schema.json`,
  `-deadline-control.schema.json`, `-retarget-control.schema.json`, `-lifecycle-control.schema.json`,
  and `interview-campaigns.schema.json` (the read).
- **Contracts** (new): `src/shared/contracts/interview-campaign-creation-control.ts`,
  `-deadline-control.ts`, `-retarget-control.ts`, `-lifecycle-control.ts`, and `interview-campaigns.ts`
  — each with a schema-validation layer, a semantic-violations layer, a typed decode function, and a
  dedicated contract-error class. **Edited**: `src/shared/contracts/schema-registry.ts` (five new
  imports, `schemaNames` entries, and `schemasByName` entries).
- **Fixtures** (new, 24 files): `tests/contract/fixtures/interview-campaign/v1/*.json` — valid,
  boundary, apply, invalid, and malicious per command family (4×5) plus valid/boundary/invalid/
  malicious for the read (4).
- **Contract tests** (new, 5 files): `tests/contract/interview-campaign-creation-control.test.ts`,
  `-deadline-control.test.ts`, `-retarget-control.test.ts`, `-lifecycle-control.test.ts`,
  `interview-campaigns.test.ts` (100 assertions total).
- **Application layer** (new): `src/ui/campaigns/server/database-campaigns.ts` (the RPC wrapper, one
  function per `api.*` entry point, plus `database-campaigns.test.ts`, 11 tests);
  `src/app/campaigns/actions.ts` (8 Server Actions, plus `actions.test.ts`, 10 tests).
- **UI** (new): `src/ui/campaigns/campaign-types.ts`, `campaign-action-state.ts`,
  `campaigns.module.css`, `campaign-workspace.tsx`, `campaign-list.tsx`, `campaign-creation.tsx`,
  `campaign-deadline.tsx`, `campaign-retarget.tsx`, `campaign-lifecycle.tsx`, and one `.test.tsx` per
  component (7 files, 36 tests); `src/app/campaigns/page.tsx` (plus `page.test.tsx`, 3 tests),
  `loading.tsx`, `error.tsx`.
- **Dev fixture and E2E** (new): `src/app/dev/campaigns-fixture/page.tsx`; **edited**:
  `scripts/e2e-server.mjs` (added `PANDO_ENABLE_CAMPAIGNS_FIXTURE: "true"`); new
  `tests/e2e/campaigns.spec.ts` (12 Playwright tests: rendering, exact preview consequences per
  command family, keyboard operability, 320px touch targets, reduced-motion/forced-colors focus
  visibility, and an axe WCAG 2.1/2.2 A/AA scan with zero violations).
- **Docs**: `docs/implementation/PHASE_4B_D4_CAMPAIGNS_STATUS.md` (rewritten to record D4-app
  completion alongside the existing D4-db record), this report.

## 5. Contracts and invariants

- New application-layer contracts (all version `1.0.0`, registered in `schema-registry.ts`):
  `InterviewCampaignCreationPreviewV1`/`ApplyResultV1`,
  `InterviewCampaignDeadlineChangePreviewV1`/`ApplyResultV1`,
  `InterviewCampaignRetargetPreviewV1`/`ApplyResultV1`,
  `InterviewCampaignLifecyclePreviewV1`/`ApplyResultV1`, `InterviewCampaignsV1`. No calculation
  contract, engine version, or policy version changed — D4-app adds no Planning input, matching
  D4-db and ADR-0010 §8.
- Ownership: every new file is Targets/application-layer code calling Targets' own released `api.*`
  surface; no Planning file was read or written.
- Security: Server Actions call `verifyPandoSession` before every read or write; the RPC wrapper
  validates every field with a purpose-specific regex before any network call (mirroring
  `database-plan.ts`'s pattern exactly) and never accepts a client-chosen `campaignId` — only the
  opaque, server-issued `campaignKey`.
- Idempotency: every apply Server Action threads a client-generated UUID (`crypto.randomUUID()`,
  rotated on every input change) as the RPC's idempotency key, and every apply requires the exact
  SHA-256 preview digest returned by the matching preview call.
- Failure behavior: a stale expected version or a tampered/expired preview digest surfaces as
  `CampaignConflictError` → a "changed elsewhere, reload" UI status; a malformed request never
  reaches the network and surfaces as `CampaignInputError` → an "invalid" UI status; any other
  failure (including the callee's own contract violation on the response) surfaces as
  `CampaignUnavailableError` → an "unavailable" UI status. No raw error detail reaches the browser.

## 6. Verification

Every command below was executed in this session on Node 24, with Docker available and used for
every database-backed gate, against the real Supabase CLI local stack.

| Gate | Result |
|---|---|
| `pnpm verify:db` | PASS — 51 pgTAP files, 3273 assertions, zero failures (unchanged from D4-db: no SQL touched); `supabase db lint --level warning --fail-on warning` clean |
| `pnpm verify:auth` | PASS |
| `pnpm verify` (`format:check`, `lint`, `typecheck`, `test:database-runner`, `test:backup-archive`, `test:contracts`, `test:performance`, `test:unit:coverage`, `test:e2e`) | PASS — `test:database-runner` 15/15; `test:backup-archive` 3/3; `test:contracts` 446/446 (32 files); `test:performance` 3/3; `test:unit:coverage` 1108/1108, coverage **86.36%/80.23%/91.02%/87.67%** (statements/branches/functions/lines) against the 85/80/85/85 threshold; `next build` succeeded; full Chromium E2E **51/51** (39 previously released + 12 new `campaigns.spec.ts`) |
| `pnpm verify:backup` | PASS — "encrypted backup clean-restore gate passed" |

One authoring mistake was caught and fixed before this final run: two `tests/e2e/campaigns.spec.ts`
assertions used `page.getByLabel("Readiness Goal")` and `page.getByLabel("Deadline (local date)")`
without `{ exact: true }`, which matched multiple elements once the fixture page rendered campaign
cards carrying "New Readiness Goal" / "New deadline (local date)" labels alongside the creation
form's shorter ones (Playwright's default label match is a case-insensitive substring match). Fixed
by adding `{ exact: true }`, the same fix `plan.spec.ts` already applies to `"Learning Track"` for
the identical reason.

## 7. Git state

- Branch `claude/d4-app`, based on `claude/d4-db` at `7617d9f`.
- Commit `1efe6ce`: `feat(targets): D4 Interview Campaign application layer` — 67 files changed, all
  four verify gates passing at commit time.
- This report's own commit follows as a separate `docs` commit, per this repository's established
  two-commit convention (feature commit, then a docs commit recording it).
- Not pushed. `main` is unaffected.
- `docs/DAILY_PACE_AUTOREPLAN_AGENT_PROMPT.md` was not read, edited, or staged.
- Working tree is clean except the same pre-existing, unrelated, already-modified `.gitignore` (adds
  `.aider*`) every prior session in this line has found and left untouched.

## 8. Remaining work

1. **A read boundary for retarget history** — `targets.interview_campaign_target_revisions` is
   written correctly but has no `api.*` read. Adding one (e.g.
   `api.get_interview_campaign_target_history_v1`) is additive, D4-app-shaped, and small, but it is
   SQL and therefore needs its own session; the UI already has a place ready to render it (see
   `src/ui/campaigns/campaign-list.tsx`'s "Retargeting history" section).
2. **D5** (allocation overrides, the `campaign_lifecycle_v1` coordinator, `planning-calculation/4`) is
   untouched. No Planning file, table, or function was edited by D4-db or D4-app.
3. **The single-active-campaign cardinality question** (recorded by D4-db) is still open for the
   product owner or a future ADR revision.
4. **D3b1-db's inherited missing pgTAP proof** remains unfixed, unrelated to this session's scope.

## 9. Codex resume prompt

```text
Прочитай docs/implementation/CLAUDE_CODE_HANDOFF_REPORT.md,
docs/implementation/PHASE_4B_D4_CAMPAIGNS_STATUS.md, и ADR-0010
(docs/adr/0010-lifecycle-replacement-availability-and-campaign-semantics.md) §3/§4/§9. Ветка
claude/d4-app поверх claude/d4-db (7617d9f, коммит этой сессии 1efe6ce) содержит ЗАВЕРШЁННЫЙ и
полностью проверенный
клиентский/прикладной слой для D4 (Interview Campaign): новый маршрут /campaigns (сознательно НЕ
встроен в уже очень большой /plan), пять пар JSON Schema/TS-контрактов в schemas/interview-campaign/v1
и src/shared/contracts/interview-campaign-*.ts (зарегистрированы в schema-registry.ts, выведены
построчно из реального jsonb_build_object в supabase/migrations/20260906000100_...sql), 24
контрактных фикстуры и 5 контрактных тестов, обёртка src/ui/campaigns/server/database-campaigns.ts
над всеми девятью api.* RPC, восемь Server Actions в src/app/campaigns/actions.ts, UI-контроллер в
src/ui/campaigns/ (campaign-workspace/list/creation/deadline/retarget/lifecycle.tsx) с полным
component/unit-покрытием, dev-фикстура src/app/dev/campaigns-fixture (PANDO_ENABLE_CAMPAIGNS_FIXTURE)
и tests/e2e/campaigns.spec.ts (12 тестов включая axe WCAG-скан). БД НЕ тронута ни одним файлом.
Все четыре гейта зелёные на коммите этой сессии: pnpm verify:db (3273 assertions/51 files, db lint
clean, без изменений), pnpm verify:auth, pnpm verify (unit coverage 86.36/80.23/91.02/87.67% выше
порога 85/80/85/85, полный E2E 51/51), pnpm verify:backup. Осознанный и явно задокументированный
пробел: UI честно сообщает, что история ретаргетинга (targets.interview_campaign_target_revisions)
пишется, но не читается браузером — потому что api.* для неё не существует, а этой сессии было
прямо запрещено трогать SQL; добавление такого RPC — маленький следующий D4-shaped выход для
отдельной сессии. НЕ начинай D5 (allocation overrides, coordinator, planning-calculation/4) — Planning
не тронут ни одним файлом ни в D4-db, ни в D4-app.
```
