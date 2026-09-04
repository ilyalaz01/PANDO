# Phase 4B D4 — Interview Campaign database and application layer implementation status

Status: **complete and verified**. The database layer (Исход 5 / D4-db) and the application/browser
layer (Исход 6 / D4-app) are both implemented, tested, and green. D5 (allocation overrides, the
`campaign_lifecycle_v1` coordinator, `planning-calculation/4`) remains untouched and out of scope.

Decision record:
[ADR-0010](../adr/0010-lifecycle-replacement-availability-and-campaign-semantics.md) §3, §4, and §9

D4-db completed: 2026-09-04. D4-app completed: 2026-09-04.

## Delivered outcome

Targets now owns a persisted `InterviewCampaign` aggregate with the exact six owner commands ADR-0010
§9 names for D4: `draft` (create), `start`, `change_campaign_deadline`, `change_campaign_target`
(retarget), `end`, and `cancel`. Every state-changing command has an exact server-computed preview,
an idempotent apply bound to the previewed digest, an expected-version fence, and an atomic
state + outbox-event + command-receipt commit, matching every previously released Planning
preview/apply command in shape and rigor. A bounded authenticated read (`api.get_interview_campaigns_v1`)
lists a workspace's lifetime campaigns with their computed deadline status and next-legal-command
capabilities.

D4 adds no Planning input and no calculation version, exactly as ADR-0010 §8 requires: no campaign
row is read by the planner, and no `outbox.deliveries` row is scheduled for any campaign event today.

D4-app (this session) built a dedicated `/campaigns` browser surface — a new route, not an addition
to the already-large `/plan` page — on top of the nine `api.*` RPCs: JSON Schema + TypeScript
application contracts for all four command families plus the read, Server Actions, a
database-RPC wrapper module, and a full UI controller with component, contract, and Playwright E2E
coverage. See "D4-app: application layer" below for the complete account.

## Owner commands, contracts, and boundary

- **Schema**: `targets.interview_campaigns` (the live aggregate: `campaign_id`, workspace-scoped
  opaque `campaign_key` in the `campaign:<uuid>` shape used by the released availability-window
  `window_key`, `title`, `readiness_goal_id`, `deadline_local_date`/`deadline_time_zone`/`deadline_at`,
  `lifecycle` in `draft|active|ended|cancelled`, `aggregate_version`) and
  `targets.interview_campaign_target_revisions` (append-only retarget history: previous/new
  Readiness Goal identity and the campaign version the retarget produced; the owner role has no
  UPDATE or DELETE grant on this table, so append-only is enforced by privilege, not convention
  alone).
- **Deadline representation** follows ADR-0010 §3 literally: `deadline_local_date` is what the user
  states, `deadline_time_zone` is the workspace time zone resolved at write time, and `deadline_at`
  is the derived exclusive end (`(deadline_local_date + 1)` at that time zone). The write path
  verifies the local round trip using `targets.local_timestamp_to_instant_v1`, a direct copy of the
  released `review.local_timestamp_to_instant_v1` defensive pattern (same ambiguity check via
  `generate_series` over a ±3 hour window). Both `draft_campaign` and `change_campaign_deadline`
  refuse a deadline already in the past (by the workspace's current local date) and a deadline more
  than 36,500 days out; a deadline already in the past on an *existing* campaign is never retroactively
  refused, since ADR-0010 §3 requires PANDO to never auto-mutate a campaign after its deadline passes.
- **Cross-context read**: Identity exposes `identity.read_target_calendar_source_v1(workspace_id, as_of)`
  (`{timeZone, localDate}`) to Targets only, through a new purpose-specific NOLOGIN role
  `pando_identity_phase1_source`, mirroring the released `pando_identity_planning_source` /
  `read_planning_calendar_source_v1` pattern exactly. Targets never reads `identity.workspaces`
  directly.
- **Retargeting** (ADR-0010 §4): `change_campaign_target` requires the expected campaign version and
  the expected version of the new, already-`active` Readiness Goal; refuses repointing to the
  identical goal; leaves both goals intact (Targets writes no `readiness_goals` row); and appends
  exactly one row to `interview_campaign_target_revisions` recording the previous and new goal
  identity plus the campaign version the retarget produced.
- **Lifecycle** (`draft → active → ended`, and `draft|active → cancelled`) is one generic
  `targets.change_interview_campaign_lifecycle_v1` command parameterized by operation
  (`start_campaign | end_campaign | cancel_campaign`), mirroring the released
  `planning.change_growth_plan_lifecycle` pause/resume shape. Every other transition (starting an
  already-active campaign, ending a draft, cancelling an ended campaign) is refused with
  `Interview Campaign lifecycle transition is invalid`.
- **Security**: every `api.*` entry point is `security definer`, pinned `search_path=''`, owned by
  the existing least-privilege `pando_phase1_api` NOLOGIN role — no new owner role was introduced for
  Targets' own surface, matching how Targets has owned every Phase 1 command since Phase 1. Private
  helpers (identity derivation, the round-trip helper, the four event-payload validators, the four
  preview builders) are ungranted to `anon`/`authenticated`/`service_role`. Both new tables have
  forced RLS with a single workspace-membership policy for `pando_phase1_api`; no runtime role has
  direct table privilege. Clients submit only the opaque `campaign_key`, expected versions, a
  bounded printable reason, a UUID idempotency key, and the server-issued digest — never a raw
  identifier of their own choosing, per ADR-0010's security section.
- **Idempotency and identity**: `draft_campaign`'s preview and apply both derive the future
  `campaign_id`/`campaign_key` from `(workspace, command type, idempotency key, label)` via
  `targets.derive_campaign_identity_v1`, the same SHA-256-derived-UUIDv8 pattern as
  `planning.derive_growth_plan_replacement_identity_v1`, so a retried create is naturally idempotent
  and a preview can show the campaign's future identity before any row exists. The three
  field-changing commands (deadline change, retarget, lifecycle) operate on an *existing* aggregate
  and therefore do not need — and deliberately do not carry — an idempotency key inside their preview
  digest, matching the released `growth_plan_lifecycle` (pause/resume) pattern rather than the
  `growth_plan_replacement` (create) pattern.
- **Events**: one `targets.interview_campaign_changed` event per command, each payload validated by
  a dedicated `targets.campaign_*_event_payload_v1_is_valid` function admitting only identifiers, a
  version, and a change kind (`CAMPAIGN_CREATED`, `CAMPAIGN_LIFECYCLE_CHANGED`,
  `CAMPAIGN_DEADLINE_CHANGED`, `CAMPAIGN_RETARGETED`). No title, deadline value, or reason body ever
  enters the outbox, per ADR-0010's security section. No `outbox.deliveries` row is inserted for any
  of them, since no consumer exists before D5.

## Decided behavior worth remembering

- **No single-active-campaign cardinality constraint was imposed.** ADR-0010 states Growth Plan
  cardinality precisely (§1: exactly one current plan) but never states an analogous campaign
  cardinality rule; §2 speaks of "an active Interview Campaign" in the singular only in the context
  of its interaction with a paused Growth Plan, not as an invariant on Targets' own aggregate. This
  session therefore allows a workspace to hold any number of campaigns in any independent lifecycle
  state, including more than one simultaneously `active`. This is a deliberate, conservative
  non-decision — recorded here for the product owner and for D5, which may need to revisit it once
  Planning-side allocation overlays make "which campaign" ambiguous for a workspace with two active
  campaigns.
- **The read boundary's `daysUntil` field is whole calendar days in the campaign's own recorded time
  zone** (`deadline_local_date − today's local date`, clamped to zero), not a fractional
  epoch-seconds computation. The two are not interchangeable: an epoch/86400 computation drifts by a
  day depending on what hour the read runs, which would make an already-fragile UI field flicker
  code-review-invisibly. This field is this session's own invention (ADR-0010 does not define a D4
  read contract), so it is free to be revised by D4-app if the UI needs a different presentation.
- **The private-function fixture-access pattern extends the existing scratch-only file.**
  `supabase/tests/fixture-migrations/99999999999999_d1b_pgtap_fixture_access.sql` (applied only by
  the pgTAP database gate, never a real migration) already grants `postgres` execute on
  `planning.derive_growth_plan_replacement_identity_v1` and friends so pgTAP can assert their
  determinism directly; this session added the analogous grant for
  `targets.derive_campaign_identity_v1`, `targets.local_timestamp_to_instant_v1`,
  `targets.frame_named_fields_v1`, and the four event-payload validators. No production grant was
  touched.
- **`api.get_interview_campaigns_v1`, `api.preview_interview_campaign_creation_v1`, and
  `api.preview_interview_campaign_deadline_change_v1` are declared plain (volatile) PL/pgSQL, not
  `stable`**, because each reads `pg_catalog.clock_timestamp()` (directly or through the new
  cross-context calendar source) to resolve "today." `supabase db lint` catches a `stable` function
  with a volatile expression inside it; the released `api.preview_growth_plan_replacement_v1` and
  `api.preview_availability_window_v1` are volatile for the identical reason. Only the pure preview
  *builder* functions (which take a pre-resolved date/time-zone as parameters) stay `stable`.

## Files and migrations

- `supabase/migrations/20260906000100_phase4b_d4_interview_campaigns.sql` — the new cross-context
  Identity role/function, both Targets tables and their trigger/RLS, the shared digest/identity/
  round-trip helpers, the four event-payload validators, the four preview-builder functions, the nine
  `api.*` entry points, and the ownership/grant/revoke block.
- `supabase/tests/fixture-migrations/99999999999999_d1b_pgtap_fixture_access.sql` — additive
  scratch-only grants so pgTAP can call the new private helpers directly (never part of the
  deployable migration tree).
- `supabase/tests/database/050_phase4b_d4_interview_campaigns.test.sql` (functional: boundary,
  ownership pinning, identity/round-trip/event-validator unit checks, full creation → deadline
  change → retarget → start → end lifecycle, a second campaign's draft → cancel path, the read
  boundary's capabilities/deadline fields, the workspace/key immutability trigger, and cross-workspace
  isolation) and `supabase/tests/database/051_phase4b_d4_interview_campaigns_concurrency.test.sql`
  (a real two-connection `dblink` race on `start_campaign` proving the shared workspace advisory lock
  serializes competing commands and the loser is refused with the exact stale-version error class,
  plus an injected-trigger-failure test proving the creation command's receipt + row + event insert
  is atomic).
- `supabase/tests/database/001_phase0_schema_security.test.sql` — the nine new `api.*` functions
  added to the "must be pinned Targets NOLOGIN definer, else must be SECURITY INVOKER" allowlist, and
  `pando_identity_phase1_source` added to the NOLOGIN/NOINHERIT/NOBYPASSRLS and
  cannot-SET-ROLE-from-anon/authenticated/service_role checks alongside every other bounded
  `..._source` role.
- `supabase/tests/database/005_catalog_targets_overlay_schema_seed.test.sql` — the authoritative
  Catalog/Targets/Overlay table allowlist extended with the two new Targets tables.
- `tests/database/verify-database.test.mjs` — the hardcoded expected pgTAP-file argv fixture extended
  with `050_...` and `051_...`.
- `src/shared/supabase/database.generated.ts` — regenerated via
  `pnpm exec supabase gen types typescript --local --schema api` against the migrated local database;
  `pnpm verify:auth` compares this file byte-for-byte against a fresh generation, and it was stale
  before this regeneration.

No production dependency, lockfile change, or calculation contract change was made by D4-db. No
database extension was added (the migration reuses `btree_gist`/`pgcrypto`/etc. already enabled by
earlier migrations; it adds none of its own).

## D4-app: application layer

This session (2026-09-04, branch `claude/d4-app`) built the complete authenticated browser journey
on top of the nine `api.*` RPCs D4-db delivered. It made **no SQL, migration, or schema change** —
every constraint the session was given ("Database must NOT be touched") held throughout.

### Route and UI

- **New route `/campaigns`**, deliberately not folded into the already-very-large `/plan` page
  (`src/app/plan/actions.ts` alone is 1235 lines; `/plan`'s server component composes ten different
  read sources with cross-read consistency checks). Interview Campaigns have exactly one read source
  (`get_interview_campaigns_v1`), so `/campaigns` needs none of that consistency-check machinery —
  a dedicated route keeps Targets' own surface architecturally separate from Planning's, matching the
  released one-route-per-bounded-context-feature pattern (`/plan`, `/explore`, `/review`, `/today`).
- `src/app/campaigns/page.tsx` loads the campaign list and the workspace's currently `active`
  Readiness Goals (reusing the already-released, Targets-owned `get_target_selection_source_v1` /
  `loadTargetSelectionSourceV1`, the same read `/start` already uses — not a new cross-context
  coupling), and renders `CampaignWorkspace` inside the same page-chrome shape (`SkipLink`, header,
  nav) every other route uses. `loading.tsx` and `error.tsx` mirror `/plan`'s exactly.
- `src/ui/campaigns/` holds the UI: `campaign-workspace.tsx` (top-level, owns one shared
  `dismissalVersion` counter so only one open confirmation exists across the whole page, exactly the
  released `/plan` pattern), `campaign-list.tsx` (renders every campaign's status badge, target, and
  an exact deadline phrase — "N days until the deadline" / "is today" / "is tomorrow" / "passed
  (date)" — plus an explicit prompt when an `ACTIVE` campaign's deadline has passed), and one
  component per command family: `campaign-creation.tsx`, `campaign-deadline.tsx`,
  `campaign-retarget.tsx`, `campaign-lifecycle.tsx` (one panel offering exactly the campaign's own
  `capabilities`-gated buttons: `start_campaign` / `end_campaign` / `cancel_campaign`). Every
  component follows the released preview→exact-comparison→confirm shape verbatim (`useActionState`,
  a rotating client-generated idempotency key threaded through a hidden field, dismissal on any
  sibling intent or input edit), copied from `growth-plan-replacement.tsx` and
  `availability-windows.tsx` rather than reinvented.
- **Retargeting history is not surfaced with real data.** ADR-0010 §4 requires append-only revision
  history (`targets.interview_campaign_target_revisions`, delivered by D4-db), but D4-db's read
  boundary is exactly `api.get_interview_campaigns_v1` — no RPC reads the revisions table. Since this
  session may not add one (explicit "no SQL" constraint), each campaign card shows an honest
  "Retargeting history" panel stating plainly that PANDO records every retarget but does not yet
  expose a read for it to the browser, rather than fabricating a list or omitting the feature
  silently. This is a real, named gap — see "Remaining work".
- `src/app/dev/campaigns-fixture/page.tsx`, gated by `PANDO_ENABLE_CAMPAIGNS_FIXTURE` (wired into
  `scripts/e2e-server.mjs` alongside the three existing fixture flags), mirrors `/dev/plan-fixture`:
  static representative campaigns (`ACTIVE`, `DRAFT`, `ENDED`, and a deadline-passed variant) and
  `?preview=` dispatch (`creation`, `creation-blocked`, `deadline`, `retarget`, `lifecycle`, `empty`,
  `no-goals`, `deadline-passed`) driving deterministic Playwright coverage with no live database.

### Contracts

Five new self-contained JSON Schema / TypeScript contract pairs under `schemas/interview-campaign/v1/`
and `src/shared/contracts/`, registered in `schema-registry.ts`
(`interview-campaign-creation-control-v1`, `-deadline-control-v1`, `-retarget-control-v1`,
`-lifecycle-control-v1`, `interview-campaigns-v1`), each derived **field-for-field from the actual
`jsonb_build_object` calls in `20260906000100_phase4b_d4_interview_campaigns.sql`**, not assumed from
convention — for example, the deadline-change preview's `before.deadline` intentionally has no `at`
field (only `after.deadline` does), and only the creation preview carries `idempotencyKey` and can
have a non-empty `blockingReasons`/non-`true` `canApply` (the other three field-changing commands
always return `canApply: true` since any invalid transition raises a database exception before a
JSON response is ever built). `campaignId`/`campaignKey` use a `uuidV8`-pattern definition (not
`format: "uuid"`, which only accepts RFC4122 versions 1–5) because `derive_campaign_identity_v1` uses
the same SHA-256-derived-UUIDv8 construction as Planning's replacement-identity helper. Each contract
file has a schema-validation layer plus a semantic-violations layer (UUID-lowercase-case checks,
`campaignKey`-binds-`campaignId` checks, before→after version-delta-of-exactly-one checks, and, for
the lifecycle contract, an exact transition table). 24 fixtures (valid/boundary/apply/invalid/
malicious per command family, valid/boundary/invalid/malicious for the read) exercise both layers;
`invalid` fixtures pass schema validation but fail a semantic check, `malicious` fixtures fail schema
validation outright (an injected `workspaceId` field, an out-of-enum operation, a negative
`daysUntil`, a wrong lifecycle enum value). All 5 new contract test files pass (100 assertions).

### Application layer

- `src/ui/campaigns/server/database-campaigns.ts` — the RPC wrapper, one function per `api.*` entry
  point (`loadInterviewCampaignsV1` plus 4 preview/apply pairs), following `database-plan.ts`'s exact
  shape: client-side input validation before any network call, a shared `rpc()` helper, Postgres
  error-code-to-typed-error mapping (`40001`/`23505` → `CampaignConflictError`,
  `22023`/`22003`/`22P02` → `CampaignInputError`, everything else → `CampaignUnavailableError`), and a
  decode step that throws the same typed unavailable error on a contract violation rather than
  leaking a raw schema error to the browser.
- `src/app/campaigns/actions.ts` — 8 Server Actions (`"use server"`), one preview/apply pair per
  command family, parsing `FormData` with the same purpose-specific regex validators used everywhere
  else in the codebase (`CAMPAIGN_KEY`, `GOAL_KEY`, `VERSION`, `LOCAL_DATE`, bounded `reason`/`title`),
  calling `verifyPandoSession` before every read or write, and calling `revalidatePath("/campaigns")`
  after every successful apply.

### Tests

- 5 contract test files (`tests/contract/interview-campaign*.test.ts`), 100 assertions.
- `database-campaigns.test.ts` (11 tests): every RPC call's exact `p_*` parameter names, malformed-
  input-before-any-RPC-call proofs, and Postgres error-code-to-typed-error mapping.
- `actions.test.ts` (10 tests): every Server Action's exact command shape passed to the (mocked)
  database layer, `revalidatePath("/campaigns")` firing on apply, and conflict/invalid/unavailable
  status mapping.
- `page.test.tsx` (3 tests): happy path, sign-in redirect on an unauthenticated session, and the
  fail-closed fallback UI on any other read failure.
- 7 component test files (`campaign-creation/deadline/retarget/lifecycle/list/workspace.test.tsx`,
  36 tests): exact preview comparisons, capability-gated rendering (a component renders nothing when
  its command isn't in the campaign's `capabilities`), dismissal on sibling intent and on input edit,
  and the honest retarget-history gap notice.
- `tests/e2e/campaigns.spec.ts` (12 Playwright tests against `/dev/campaigns-fixture`): list
  rendering, empty/no-active-goals states, exact draft/deadline/retarget/lifecycle preview
  consequences, the blocked-draft blocker text, the passed-deadline prompt, full keyboard operability
  from the skip link forward, 320px touch-target sizing, reduced-motion/forced-colors focus
  visibility, and an axe WCAG 2.1/2.2 A/AA scan across every fixture state (zero violations).

## Verification evidence

Every command below was run in this session on Node 24 with Docker available, against the actual
Supabase CLI local stack (not a rehearsal harness). D4-db's gates (recorded 2026-09-04) are repeated
here because D4-app re-ran every one of them after adding the application layer, on the same branch
lineage.

| Gate | Result |
|---|---|
| `pnpm verify:db` | PASS — 51 pgTAP files, 3273 assertions, zero failures; `supabase db lint --level warning --fail-on warning` clean. Unchanged from D4-db: D4-app touched no SQL. |
| `pnpm verify:auth` | PASS |
| `pnpm verify` (`format:check`, `lint`, `typecheck`, `test:database-runner`, `test:backup-archive`, `test:contracts`, `test:performance`, `test:unit:coverage`, `test:e2e`) | PASS — `test:database-runner` 15/15; `test:contracts` 446/446 (32 files, up from D4-db's session); unit coverage **86.36%/80.23%/91.02%/87.67%** (stmts/branch/funcs/lines) against the 85/80/85/85 threshold; `next build` succeeded; full Chromium E2E **51/51** (39 previously released + 12 new `campaigns.spec.ts`, proving zero cross-feature regression) |
| `pnpm verify:backup` | PASS — "encrypted backup clean-restore gate passed" |

One E2E authoring mistake, caught and fixed in this session: `page.getByLabel("Readiness Goal")` and
`page.getByLabel("Deadline (local date)")` without `{ exact: true }` matched multiple elements once
the fixture page rendered several campaign cards' own "New Readiness Goal" / "New deadline (local
date)" labels alongside the creation form's shorter labels (Playwright's default label matching is a
case-insensitive substring match). Fixed by adding `{ exact: true }`, matching the same pattern
`plan.spec.ts` already uses for `"Learning Track"` for the identical reason.

## Remaining work

1. **A read boundary for retarget history.** `targets.interview_campaign_target_revisions` exists and
   is written correctly (D4-db, pgTAP-proven), but no `api.*` function reads it, so `/campaigns`
   cannot show real retarget history — it says so honestly instead of fabricating one. Adding
   `api.get_interview_campaign_target_history_v1` (or folding a bounded, capped history array into
   `get_interview_campaigns_v1`) is a small, additive, D4-app-shaped follow-up; it needs its own
   session since this one may not touch SQL.
2. **D5** (allocation overlays, the `campaign_lifecycle_v1` coordinator, `planning-calculation/4`) is
   untouched. No Planning file, table, or function was edited by either D4-db or D4-app.
3. **The single-active-campaign cardinality question** (see "Decided behavior worth remembering")
   is still open for the product owner or a future ADR revision if D5 needs it resolved. D4-app's UI
   makes no assumption about it either — the list renders any number of campaigns in any lifecycle.
4. **D3b1-db's inherited missing pgTAP proof** remains unfixed, unrelated to this session's scope.
5. `docs/DAILY_PACE_AUTOREPLAN_AGENT_PROMPT.md` was not read, edited, or staged, per explicit
   instruction.

## Codex resume prompt

```text
Прочитай docs/implementation/CLAUDE_CODE_HANDOFF_REPORT.md,
docs/implementation/PHASE_4B_D4_CAMPAIGNS_STATUS.md, ADR-0010 (0010-lifecycle-replacement-
availability-and-campaign-semantics.md) §3/§4/§9, и supabase/migrations/
20260906000100_phase4b_d4_interview_campaigns.sql. Ветка claude/d4-app поверх claude/d4-db содержит
ЗАВЕРШЁННЫЙ и полностью проверенный D4: слой базы данных (девять api.* RPC, forced RLS,
pgTAP 050/051) и слой приложения — новый маршрут /campaigns (не встроен в уже очень большой /plan),
пять пар JSON Schema/TS-контрактов, зарегистрированных в schema-registry.ts и выведенных построчно
из реального jsonb_build_object в миграции, обёртка database-campaigns.ts, восемь Server Actions в
app/campaigns/actions.ts, UI-контроллер в src/ui/campaigns/ (campaign-workspace/list/creation/
deadline/retarget/lifecycle.tsx), dev-фикстура /dev/campaigns-fixture, и полное тестовое покрытие
(5 contract-тестов, unit-тесты для database/actions/page, 7 компонентных тестов, 12 Playwright
e2e-тестов включая axe WCAG-скан). Все четыре гейта зелёные: pnpm verify:db (3273/51, lint clean),
pnpm verify:auth, pnpm verify (coverage 86.36/80.23/91.02/87.67% выше порога 85/80/85/85, E2E 51/51),
pnpm verify:backup. Известный и осознанный пробел: история ретаргетинга не читается с бэкенда (нет
api.* RPC для targets.interview_campaign_target_revisions) — UI честно об этом сообщает вместо того,
чтобы выдумывать данные; добавление такого RPC — следующий маленький D4-shaped follow-up, требующий
отдельной сессии (эта не имела права трогать SQL). НЕ начинай D5 (allocation overrides, coordinator,
planning-calculation/4) — Planning не тронут ни одним файлом ни в D4-db, ни в D4-app. Открытый вопрос
для владельца продукта остаётся записанным в этом файле: нет ограничения на количество одновременно
активных Campaign на воркспейс, т.к. ADR-0010 явно такого не требует.
```
