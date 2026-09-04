# Phase 4B D4 — Interview Campaign database layer implementation status

Status: database layer complete and verified; the browser/controller layer (D4-app) is explicitly
out of scope for this session and remains to be built

Decision record:
[ADR-0010](../adr/0010-lifecycle-replacement-availability-and-campaign-semantics.md) §3, §4, and §9

Completed: 2026-09-04

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

No UI, Server Action, or React component was touched this session. The next session (D4-app) builds
the `/plan` (or a new `/campaigns`) browser surface on top of the nine `api.*` RPCs and the contracts
they imply.

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

No production dependency, lockfile, application/UI file, or calculation contract changed. No database
extension was added (the migration reuses `btree_gist`/`pgcrypto`/etc. already enabled by earlier
migrations; it adds none of its own).

## Verification evidence

Every command below was run in this session on Node 24 with Docker available, against the actual
Supabase CLI local stack (not a rehearsal harness).

| Gate | Result |
|---|---|
| `pnpm verify:db` | PASS — 51 pgTAP files, 3273 assertions, zero failures (49 files/3070 assertions before D4); `supabase db lint --level warning --fail-on warning` clean |
| `pnpm verify:auth` | PASS, after regenerating `database.generated.ts` (the gate diffs the checked-in file against a fresh generation and failed before the regeneration) |
| `pnpm verify` (`format:check`, `lint`, `typecheck`, `test:database-runner`, `test:backup-archive`, `test:contracts`, `test:performance`, `test:unit:coverage`, `test:e2e`) | PASS — `test:database-runner` 15/15 after fixing its hardcoded pgTAP-file-list fixture; unit coverage 86.30%/80.47%/91.20%/87.68% (stmts/branch/funcs/lines), numerically unchanged from the prior session because no TypeScript/domain/application file was touched; `next build` succeeded; full Chromium E2E **39/39** (proves zero cross-feature regression, since D4 added no browser surface of its own) |
| `pnpm verify:backup` | PASS — "encrypted backup clean-restore gate passed" |

## Remaining work

1. **D4-app**: the `/plan` (or new `/campaigns`) authenticated browser journey — Server Actions
   calling the nine `api.*` RPCs, a domain/application contract layer mirroring
   `growth-plan-replacement-control.schema.json`'s shape for each of the four command families,
   contract fixtures (valid/invalid/boundary/malicious), UI components with keyboard/responsive/
   reduced-motion/automated-WCAG coverage, and Playwright E2E coverage. This is the next bounded
   outcome named by the user's own session scope, not started here.
2. **D5** (allocation overlays, the `campaign_lifecycle_v1` coordinator, `planning-calculation/4`) is
   untouched, per this session's explicit constraint. No Planning file, table, or function was edited.
3. **The single-active-campaign cardinality question** (see "Decided behavior worth remembering")
   is open for the product owner or a future ADR revision if D5 needs it resolved.
4. **D3b1-db's inherited missing pgTAP proof** remains unfixed, unrelated to this session's scope.
5. `docs/DAILY_PACE_AUTOREPLAN_AGENT_PROMPT.md` was not read, edited, or staged, per explicit
   instruction.

## Codex resume prompt

```text
Прочитай docs/implementation/CLAUDE_CODE_HANDOFF_REPORT.md,
docs/implementation/PHASE_4B_D4_CAMPAIGNS_STATUS.md, ADR-0010 (0010-lifecycle-replacement-
availability-and-campaign-semantics.md) §3/§4/§9, и supabase/migrations/
20260906000100_phase4b_d4_interview_campaigns.sql. Ветка claude/d4-db поверх main содержит
ЗАВЕРШЁННЫЙ и проверенный слой базы данных для D4 (Interview Campaign): таблицы
targets.interview_campaigns и targets.interview_campaign_target_revisions, девять api.*
RPC (draft/start/change_campaign_deadline/change_campaign_target/end/cancel как
preview+apply пары плюс один read), forced RLS, кросс-контекстное bounded-query чтение
identity.read_target_calendar_source_v1 для Targets, и исчерпывающие pgTAP-тесты
(050_phase4b_d4_interview_campaigns.test.sql — функциональность/RLS/изоляция,
051_..._concurrency.test.sql — реальная гонка через dblink и atomicity-тест через
injected trigger failure). Все гейты зелёные на коммите этой сессии: pnpm verify:db
(3273 assertions/51 files, db lint clean), pnpm verify:auth (потребовал регенерации
src/shared/supabase/database.generated.ts — это уже сделано и закоммичено), pnpm verify
(включая полный E2E 39/39, coverage не изменился, т.к. TS-код не трогали), pnpm verify:backup.
Следующий bounded outcome — D4-app: слой приложения (Server Actions, domain/application
contracts, UI, contract-тесты, Playwright E2E) поверх уже готовых девяти api.* RPC. НЕ начинай
D5 (allocation overrides, coordinator, planning-calculation/4) в этой же сессии — Planning не
тронут. Открытый вопрос для владельца продукта записан в статусном файле: нет ограничения на
количество одновременно активных Campaign на воркспейс, т.к. ADR-0010 явно такого не требует.
```
