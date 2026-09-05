# Phase 4B D5 — Campaign allocation overrides and coordinator database layer

Status: **complete and verified (database layer only)**. Исход 7 / D5-db is implemented, tested, and
green. The calculation-engine rollout (`PlanningCalculationInputV4`, `planner-engine/0.4.0`,
`planning-policy/0.4`), the client/UI layer, and any switch of `/plan` or `/campaigns` to the new
coordinator entry points are explicitly out of scope for this session (D5-app).

Decision record:
[ADR-0010](../adr/0010-lifecycle-replacement-availability-and-campaign-semantics.md) §5, §7, and §9

D5-db completed: 2026-09-05.

## Delivered outcome

Planning now owns a persisted `CampaignAllocationOverride` aggregate (ADR-0010 §5): a bounded,
versioned replacement of a Learning Track's own `priority` / `protected_minimum_minutes` /
`cadence_per_week` values for the lifetime of one campaign's override. A new `agent_control` module
boundary hosts the first cross-owner coordinator in the codebase, `campaign_lifecycle_v1`
(ADR-0010 §7), which atomically installs overrides when a campaign starts and closes them when it
ends or is cancelled — in the same transaction as the Targets-owned campaign lifecycle change,
under the fixed lock order `agent-control-workspace` → `targets-workspace` → `planning-workspace`.

This slice adds no Planning calculation input and no calculation-contract version, exactly as D4-db
did: no override or coordination event reaches the planner, and no `outbox.deliveries` row is
scheduled for any of them, because the V4 consumer does not exist before D5-app.

## Owner commands, contracts, and boundary

- **Schema**: `planning.campaign_allocation_overrides` — `override_id`, workspace-scoped opaque
  `override_key` (`override:<uuid>`), `growth_plan_id`/`learning_track_id` (FK to
  `planning.learning_tracks`), `campaign_id` (FK to `targets.interview_campaigns`, the same
  cross-schema-FK pattern `planning.learning_tracks` already uses for `targets.readiness_goals`),
  the three nullable override value columns, `lifecycle` in `active | superseded | removed`, and
  `aggregate_version`. At most one *active* override may exist per `learning_track_id`
  (`campaign_allocation_overrides_active_per_track`, a partial unique index) — see "Decided behavior
  worth remembering" below. The protected-minimum floor invariant ("MUST NOT be lower than the
  Track's own protected minimum") is enforced by a `before insert or update` trigger,
  `planning.guard_campaign_allocation_override_floor`, because it depends on another table's
  current, mutable value and cannot be a plain check constraint.
- **Direct owner command** (no coordinator): `change_campaign_allocation_override` /
  `remove_campaign_allocation_override`, one command type parameterized by operation exactly like
  the released `planning.change_availability_window_v1`, exposed as
  `api.preview_campaign_allocation_override_v1` / `api.apply_campaign_allocation_override_v1`. This
  is the only way to edit or remove an override while its campaign remains active — ADR-0010 §5
  scopes installation itself to `start_campaign` alone. A blocking capacity check
  (`ALLOCATION_OVERRIDE_EXCEEDS_CAPACITY`) recomputes the sum of effective protected minutes across
  the plan's active Tracks before allowing a raise; the floor invariant is a hard refusal
  (`23514`), matching how out-of-range input is refused elsewhere, not a soft preview blocker.
  Removal is a lifecycle transition only — the override's recorded values are retained unchanged as
  history, exactly like the coordinator's own close path.
- **Read boundary**: `api.get_campaign_allocation_overrides_v1()` lists every override a workspace
  has ever installed, across all campaigns and lifecycles, with `capabilities` gated to `active`
  rows exactly like the released `get_interview_campaigns_v1`.
- **The coordinator** (`agent_control.coordinate_campaign_lifecycle_v1`, ADR-0010 §7): exposed as
  `api.preview_campaign_lifecycle_coordination_v1` / `api.apply_campaign_lifecycle_coordination_v1`.
  It owns nothing itself — no new table, no domain event of its own — and stores only its own
  `outbox.command_receipts` row as the coordination/audit record. It:
  1. resolves the campaign and, for `start_campaign`, the requested Tracks and the plan's current
     active-Track roster through two new narrow bounded reads
     (`targets.read_interview_campaign_coordination_source_v1`,
     `planning.read_campaign_lifecycle_coordination_source_v1`), each owned by its own
     single-purpose NOLOGIN role (`pando_phase1_agent_control_source`,
     `pando_planning_agent_control_source`) and granted execute only to the coordinator role,
     mirroring the released `identity.read_target_calendar_source_v1` pattern exactly;
  2. computes one combined preview (`agent_control.build_campaign_lifecycle_coordination_preview_v1`)
     spanning both aggregates, with the same per-override validation (Track must be active and
     belong to the current plan, must not already carry an active override, floor and capacity
     checks) the direct command uses;
  3. on apply, acquires the fixed lock order, recomputes the preview fresh, and calls two private
     owner hooks under one shared `command_id`/`correlation_id`:
     `targets.apply_interview_campaign_lifecycle_hook_v1` (repeats the released lifecycle
     transition validation and emits the existing `targets.interview_campaign_changed` event) and
     either `planning.install_campaign_allocation_overrides_hook_v1` (start) or
     `planning.close_campaign_allocation_overrides_hook_v1` (end/cancel), each re-validating its
     own preconditions independently rather than trusting the coordinator's preview, per ADR-0010
     §7's "repeat their own ... validation."
  - For `end_campaign`/`cancel_campaign`, the coordinator closes overrides **before** flipping the
    campaign's lifecycle in the same transaction; see the guard below for why this order matters.
- **Guard against orphaned overrides**: a workspace could otherwise end or cancel an
  override-carrying campaign through the already-released, unmodified D4 command
  (`api.apply_interview_campaign_lifecycle_v1`), which does not close overrides and would strand
  them "active" forever. Rather than replace that tested function, this session added a
  table-level trigger, `targets.guard_interview_campaign_lifecycle_overrides` (before update on
  `targets.interview_campaigns`), that refuses any `end_campaign`/`cancel_campaign` transition while
  an active override exists (`planning.has_active_campaign_allocation_override_v1`, a new narrow
  Planning-owned boolean read granted only to `pando_phase1_api`). The guard is satisfied by
  construction on the coordinator's own path, because the coordinator always closes overrides
  first. The released 050/051 pgTAP suite installs no override, so the guard never fires for it and
  its assertions are unaffected.
- **Security**: every new `api.*` entry point is `security definer`, pinned `search_path=''`, and
  owned by a NOLOGIN role — the direct command and read by the existing `pando_planning_api`, the
  coordinator by a new `pando_agent_control_api` (owning nothing but its own function definitions
  and its own `outbox.command_receipts` rows). Both new tables' RLS is forced with a single
  workspace-membership policy for their owning role; the two new bounded-read roles get their own
  narrowly-scoped, permissive (`using (true)`) policies exactly like every released cross-context
  source, since workspace scoping is enforced by the validated `p_workspace_id` parameter the
  caller already resolved from the authenticated session, not by the read's own RLS predicate.
- **Idempotency and identity**: `planning.derive_campaign_allocation_override_identity_v1` is the
  same SHA-256-derived-UUIDv8 pattern as `targets.derive_campaign_identity_v1`, keyed by
  `(workspace, command type, idempotency key, Track key)` — so a coordinator preview can show an
  override's future identity before the row exists, and a retried `start_campaign` naturally
  reconciles to the same override rows. The three field-changing direct commands and the
  coordinator's `end_campaign`/`cancel_campaign` operate on existing rows and carry no such identity.
- **Events**: `planning.campaign_allocation_override_changed` (`OVERRIDE_INSTALLED` /
  `OVERRIDE_CHANGED` / `OVERRIDE_CLOSED`), validated by
  `planning.campaign_allocation_override_changed_event_payload_v1_is_valid` (identifiers, a version,
  a lifecycle, and the change kind only — no override value ever enters the outbox, per ADR-0010's
  security section). A dedicated, additive RLS insert policy
  (`events_planning_allocation_override_insert`) was added rather than widening the released
  `events_planning_insert` policy (which only admits `planning.input_changed` for the Growth Plan
  and Learning Track aggregates), so no existing policy predicate was touched.

## Decided behavior worth remembering

- **At most one active override per Learning Track.** ADR-0010 §5 does not resolve what happens
  when two simultaneously active campaigns try to overlay the same Track (D4-db left campaign
  cardinality open generally). This session closes that gap conservatively and only for overrides:
  a partial unique index enforces that a Track's effective parameters are never ambiguous between
  two campaigns. Installing a second override on an already-overridden Track is refused with the
  blocking reason `ALLOCATION_OVERRIDE_TRACK_ALREADY_OVERRIDDEN`, both in the coordinator's preview
  and, as a concurrency backstop, by the unique index itself. This is a recorded, deliberate
  non-decision — like D4-db's own campaign-cardinality note — for the product owner or a future ADR
  revision if D5-app's UX needs a different answer.
- **The floor invariant is a hard refusal, not a preview blocker.** Unlike capacity (which ADR-0010
  §5 explicitly calls "a blocking validation error, not a warning," i.e. a soft, enumerable
  `blockingReasons` entry), a protected-minimum override below the Track's own floor is refused by
  raising immediately, in both the direct command and the coordinator's per-override validation
  loop — matching how this codebase already treats other structurally-invalid inputs (an
  out-of-range priority, a malformed key) rather than state-dependent conditions.
- **Overrides are installed only at `start_campaign`.** ADR-0010 §5 frames installation as part of
  starting a campaign; this session does not add a path to attach a brand-new override to an
  already-active campaign (only to edit or remove an existing one). Adding one is additive and
  small, but deliberately deferred — a recorded option for D5-app or a later session, not an
  oversight.
- **The coordinator introduces no new table.** ADR-0010 §7 says the coordinator "stores only
  coordination and audit rows"; this session reads that as the same `outbox.command_receipts` /
  `outbox.events` infrastructure every other command already uses, not a dedicated Agent Control
  ledger. `agent_control` therefore holds only function definitions today.
- **`api.get_campaign_allocation_overrides_v1` resolves campaign identity through a bounded read,
  not a SQL join.** Planning does not own `targets.interview_campaigns`, so a raw join across the
  ownership boundary would either require a table grant Planning has no business holding or fail
  under RLS; the read instead calls the same granted
  `targets.read_interview_campaign_for_override_source_v1` the direct override command uses, once
  per row. The row counts here are small and bounded by a workspace's own override history, so the
  per-row call has no meaningful cost.

## Files and migrations

- `supabase/migrations/20260907000100_phase4b_d5_campaign_allocation_overrides.sql` — the new
  `agent_control` schema and its `pando_agent_control_api` role; two new narrow bounded-read roles
  (`pando_phase1_agent_control_source`, `pando_planning_agent_control_source`); the
  `campaign_allocation_overrides` table, its floor-guard trigger, RLS, and identity/event-payload
  helpers; the direct change/remove command (preview + apply) and read boundary; the
  lifecycle-overrides guard trigger on `targets.interview_campaigns` plus its narrow
  `planning.has_active_campaign_allocation_override_v1` read; the two coordination source
  functions; the coordinator's own digest helper and preview builder; the two private owner hooks
  (`targets.apply_interview_campaign_lifecycle_hook_v1`,
  `planning.install_campaign_allocation_overrides_hook_v1`,
  `planning.close_campaign_allocation_overrides_hook_v1`); the coordinator's `api.*` entry points;
  and the consolidated ownership/grant/cleanup block.
- `supabase/tests/fixture-migrations/99999999999999_d1b_pgtap_fixture_access.sql` — additive
  scratch-only grants so pgTAP can call `planning.derive_campaign_allocation_override_identity_v1`
  and `planning.campaign_allocation_override_changed_event_payload_v1_is_valid` directly, mirroring
  the existing D3a/D4 grants in the same file.
- `supabase/tests/database/052_phase4b_d5_campaign_allocation_overrides.test.sql` (functional:
  schema/ownership/privilege boundary, identity and event-payload unit checks, a full
  fixture → install-override-at-start → idempotent-replay → direct-end-refused-by-guard →
  coordinator-end-closes-override lifecycle, a second campaign blocked from overlaying an
  already-overridden Track, direct edit/remove of an active override including the floor refusal,
  a dedicated tightly-capacitated workspace proving the capacity blocker, and cross-workspace
  isolation) and `supabase/tests/database/053_phase4b_d5_campaign_allocation_overrides_concurrency.test.sql`
  (a real two-connection `dblink` race: two campaigns racing to install an override on the same
  Track, proving the `planning-workspace` advisory lock serializes them and the loser is refused
  with the exact `campaign lifecycle coordination preview is stale` (`40001`) class once it sees
  the winner's committed state; plus an injected-trigger-failure test proving the coordinator's
  campaign-lifecycle-change-plus-override-install is atomic across both owners).
- `supabase/tests/database/001_phase0_schema_security.test.sql` — the `agent_control` schema added
  to the schema-existence check; the five new `api.*` functions added to the SECURITY-INVOKER
  exemption list with new ownership-check blocks for `pando_planning_api` (the three
  Planning-owned ones) and the new `pando_agent_control_api` (the two coordinator ones);
  `pando_agent_control_api`, `pando_phase1_agent_control_source`, and
  `pando_planning_agent_control_source` added to the NOLOGIN/NOINHERIT/NOBYPASSRLS role check and
  (the two `_source` roles) the cannot-SET-ROLE-from-anon/authenticated/service_role check; the two
  new bounded-read functions added to the pinned-NOLOGIN-owner tuple list alongside every other
  released `_source` function.
- `tests/database/verify-database.test.mjs` — the hardcoded expected pgTAP-file argv fixture
  extended with `052_...` and `053_...`.
- `src/shared/supabase/database.generated.ts` — regenerated via
  `pnpm exec supabase gen types typescript --local --schema api` against the migrated local
  database; `pnpm verify:auth` compares this file byte-for-byte against a fresh generation, and it
  was stale before this regeneration. The diff against the pre-D5 file is purely additive: the five
  new function signatures.

No production dependency, lockfile change, or calculation contract change was made. No database
extension was added.

## Contracts and invariants

- New contracts (all version `1.0.0`, not yet registered as TypeScript application contracts —
  that is D5-app's job, matching how D4-db shipped only the SQL-level `contract.name`/`version`
  envelope and D4-app added the JSON Schema/TS pair afterward): `CampaignAllocationOverrideChange
  PreviewV1`/`ApplyResultV1`, `CampaignAllocationOverridesV1`, `CampaignLifecycleCoordination
  PreviewV1`/`ApplyResultV1`.
- Ownership: `planning.campaign_allocation_overrides` and every function that mutates it are
  Planning-owned; the coordinator owns no aggregate and holds no table grant on either owner's
  tables, reaching them only through granted, narrowly-scoped functions.
- Idempotency: the coordinator's apply is idempotent on `(actor_user_id, command_type,
  idempotency_key)` exactly like every other command, verified by an exact-replay pgTAP assertion
  (052) proving a retried `start_campaign` returns the byte-identical cached response and creates no
  duplicate override row.
- Failure behavior: a stale expected campaign or Track version, a preview digest that no longer
  matches freshly recomputed state (including a state change caused by a concurrent winner), or a
  blocked preview (`canApply` false) all surface as `40001` at apply; a malformed request is refused
  before any lock is taken (`22023`); an inaccessible campaign, Track, or override is `42501`; a
  cross-owner atomicity failure (proven via an injected outbox-trigger failure in 053) rolls back
  the campaign lifecycle change, the override insert, the events, and the receipt together, in one
  transaction.

## Verification

Every command below was executed in this session on Node 24, with Docker available and used for
every database-backed gate, against the real Supabase CLI local stack.

| Gate | Result |
|---|---|
| `pnpm verify:db` | PASS — 53 pgTAP files, 3402 assertions, zero failures; `supabase db lint --level warning --fail-on warning` clean |
| `pnpm verify:auth` | PASS |
| `pnpm verify` (`format:check`, `lint`, `typecheck`, `test:database-runner`, `test:backup-archive`, `test:contracts`, `test:performance`, `test:unit:coverage`, `test:e2e`) | PASS — unit coverage unchanged at **86.36%/80.23%/91.02%/87.67%** (statements/branches/functions/lines) against the 85/80/85/85 threshold, since this session added no TypeScript; `next build` succeeded; full Chromium E2E **51/51** unchanged, since this session added no client code |
| `pnpm verify:backup` | PASS — "encrypted backup clean-restore gate passed" |

Authoring mistakes caught and fixed before this final run (recorded for anyone extending this
migration): a coordinator-role-to-role `ALTER ... OWNER TO` requires the *new* owner to hold
`CREATE` on the function's schema, not merely membership — missed initially for the two new
narrow source roles and for the reused `pando_phase1_planning_source`; three empty-array PL/pgSQL
variable initializers (`:= '{}'`) needed an explicit `::text[]`/`::uuid[]`/`::integer[]` cast to
satisfy `supabase db lint`; the `outbox.events` RLS policy for `pando_planning_api`
(`events_planning_insert`) only admits the Growth-Plan/Learning-Track aggregate types, so the new
override event needed its own additive policy rather than reuse; and `jsonb ->> 'key'` (unlike bare
`->`) already returns SQL `NULL` for both a missing key and a stored JSON `null`, which the first
draft's `p_plan_source->'currentPlan' is null` check did not account for — fixed by adding an
explicit `hasCurrentPlan` boolean to the source payload instead of relying on that fact.

## Remaining work

1. **D5-app** — everything this session was explicitly forbidden from touching: the
   `PlanningCalculationInputV4`/`PlanSnapshotV4` rollout, `planner-engine/0.4.0`,
   `planning-policy/0.4`, JSON Schema/TypeScript contracts for the five new commands/read, Server
   Actions, and a UI surface for overrides and the coordinator (most naturally an addition to the
   existing `/campaigns` page's lifecycle controls, since starting/ending/cancelling a campaign is
   where overrides now attach).
2. **Wiring `/campaigns`'s existing lifecycle UI to the coordinator.** D4-app's
   `campaign-lifecycle.tsx` still calls the plain `api.preview_interview_campaign_lifecycle_v1` /
   `api.apply_interview_campaign_lifecycle_v1` pair for start/end/cancel. That remains completely
   valid for a campaign that carries no override (the guard trigger never fires for it), but
   D5-app should move the client to the coordinator entry points so a person can attach overrides
   while starting a campaign from the browser, and so ending/cancelling a campaign that does carry
   an override does not surface the guard's refusal to an end user.
3. **The "no new override on an already-active campaign" gap.** Recorded above as a deliberate,
   bounded scope decision, not an oversight — worth a product-owner call once D5-app's UX is
   designed.
4. **The Track-already-overridden cardinality decision** (this session's own conservative choice,
   above) is open for the product owner to revisit, exactly like D4-db's still-open
   single-active-campaign-per-workspace question.
5. **D3b1-db's inherited missing pgTAP proof** remains unfixed, unrelated to this session's scope.
6. `docs/DAILY_PACE_AUTOREPLAN_AGENT_PROMPT.md` was not read, edited, or staged, per explicit
   instruction.

## Codex resume prompt

```text
Прочитай docs/implementation/CLAUDE_CODE_HANDOFF_REPORT.md,
docs/implementation/PHASE_4B_D5_ALLOCATIONS_STATUS.md, ADR-0010 (0010-lifecycle-replacement-
availability-and-campaign-semantics.md) §5/§7/§9, и supabase/migrations/
20260907000100_phase4b_d5_campaign_allocation_overrides.sql. Ветка claude/d5-db поверх D4
(20260906000100_phase4b_d4_interview_campaigns.sql, не изменён) содержит ЗАВЕРШЁННЫЙ и полностью
проверенный слой базы данных для D5 (Исход 7): таблицу planning.campaign_allocation_overrides с
триггером нижней границы protected-minimum, прямую команду change/remove
(api.preview_/apply_campaign_allocation_override_v1) и read api.get_campaign_allocation_overrides_v1,
первый в кодовой базе межконтекстный координатор agent_control.coordinate_campaign_lifecycle_v1
(api.preview_/apply_campaign_lifecycle_coordination_v1) с фиксированным порядком блокировок
agent-control-workspace → targets-workspace → planning-workspace, два приватных owner hook
(targets.apply_interview_campaign_lifecycle_hook_v1,
planning.install_/close_campaign_allocation_overrides_hook_v1), два новых узких bounded-read
источника с собственными NOLOGIN-ролями, и защитный триггер
targets.guard_interview_campaign_lifecycle_overrides, который не даёт закрыть кампанию с активным
override в обход координатора — не трогая и не ослабляя уже принятую функцию D4
api.apply_interview_campaign_lifecycle_v1. Все четыре гейта зелёные: pnpm verify:db (3402
assertions/53 files, db lint clean), pnpm verify:auth, pnpm verify (unit coverage без изменений
86.36/80.23/91.02/87.67% выше порога 85/80/85/85, т.к. TS не менялся, E2E 51/51 без изменений),
pnpm verify:backup. Осознанные и явно задокументированные решения: не более одного активного
override на Track одновременно (частичный уникальный индекс + мягкий blocker
ALLOCATION_OVERRIDE_TRACK_ALREADY_OVERRIDDEN в превью координатора); floor-инвариант — жёсткий
raise, а не soft blocker; overrides устанавливаются только через start_campaign, не через
отдельную команду "добавить override к уже активной кампании". НЕ начинай D5-app (planner-engine/
0.4.0, PlanningCalculationInputV4, planning-policy/0.4, JSON Schema/TS-контракты, UI) — это
следующий отдельный выход, для которого этот слой базы данных теперь полностью готов.
```
