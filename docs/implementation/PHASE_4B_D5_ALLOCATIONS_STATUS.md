# Phase 4B D5 — Campaign allocation overrides, coordinator, and calculation-engine rollout

Status: **complete and verified — Phase 4B D3–D5 closed**. Both Исход 7 (D5-db, the database
layer) and Исход 8 (D5-app, the calculation engine, contracts, and browser workflow) are
implemented, tested, and green. This document now covers the full D5 slice; the first half below
(through "Codex resume prompt" for D5-db) is D5-db's original, unmodified record. The D5-app
section that follows records this session's own outcome and is authoritative for what is actually
live today.

Decision record:
[ADR-0010](../adr/0010-lifecycle-replacement-availability-and-campaign-semantics.md) §2, §3, §5,
§7, §8, and §9

D5-db completed: 2026-09-05. D5-app completed: 2026-09-05.

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

---

# D5-app — calculation engine, contracts, and browser workflow

Session date: 2026-09-05. Branch `claude/d5-app` on top of `claude/d5-db`. Исход 8 of the split
plan: everything D5-db explicitly deferred — `PlanningCalculationInputV4`/`PlanSnapshotV4`,
`planner-engine/0.4.0`, `planning-policy/0.4`, the five new commands' JSON Schema/TypeScript
contracts, `assemblePlanSnapshotInputV4`, and a real `/campaigns` browser workflow for allocation
overrides and campaign lifecycle coordination.

## Session constraints that shaped this outcome

This session's instructions forbid creating or changing any SQL migration. That has one direct,
load-bearing consequence, and it is the same one D3b2-rollout already established as precedent:

- `planning.plan_snapshot_attempts.calculation_contract_version`'s CHECK constraint still admits
  only `planning-calculation/1` and `.../2` (D3b's own `.../3` was never activated either — see
  `PHASE_4B_D3B2_ROLLOUT_STATUS.md`). No SQL migration this session extends
  `planning.load_plan_snapshot_source_bundle_v1/v2`-equivalent SQL to emit `bundle.campaign` or a
  Track's `allocationOverride`, and none widens the CHECK constraint.
- Consequently, `planner-engine/0.4.0` and `assemblePlanSnapshotInputV4` are shipped as real,
  fully unit-tested, dispatcher-recognized code — but, exactly like `.../3` before it, remain
  **inert plumbing** for the async Planning snapshot worker: no real delivery can carry
  `planning-calculation/4` this session. This is not a partial or compromised outcome; it is the
  same "expand" half of ADR-0010 §8's expand-then-activate sequence every prior calculation-version
  rollout in this codebase has used, applied consistently again.
- The override and coordinator **commands** are a completely different story: D5-db already shipped
  real, callable, RLS-enforced RPCs for all five (`preview_/apply_campaign_allocation_override_v1`,
  `get_campaign_allocation_overrides_v1`, `preview_/apply_campaign_lifecycle_coordination_v1`).
  Wiring the browser to them needed no SQL at all, so that half of this outcome is fully live —
  a person can attach, edit, and remove allocation overrides and start/end/cancel a campaign
  through the coordinator today, exactly like D3b1's real availability-window commands were live
  while D3b2's engine wiring stayed inert.

## Delivered outcome 1: `planner-engine/0.4.0` and `planning-policy/0.4`

Real, pure, fully unit-tested domain code implementing every ADR-0010 D5 rule:

- **Campaign eligibility while paused** (§2): `validateInputV4`'s campaign block drops the
  `growthPlan.lifecycle !== 'ACTIVE'` refusal V1–V3 had; a campaign may now overlay any current
  (`active` or `paused`) Growth Plan. `warningCodesV4` adds `BASE_PLAN_PAUSED` exactly when the plan
  is paused and a campaign exists; the existing, unmodified `PLAN_PAUSED` gate (`growthPlan?.lifecycle
  === "PAUSED" && campaign === null`) already reports `CURRENT` instead once a campaign exists, so
  no change was needed there.
- **Campaign-candidate Track provenance while paused** (§2, a real correctness gap this session
  closes): V1–V3 nulled a candidate's `trackId` whenever `GROWTH_PLAN` dropped out of its effective
  sources — which silently stripped Focus attribution from a campaign-sourced candidate the moment
  its parent Track (or the base plan) was not `ACTIVE`, even though ADR-0010 §2 requires it to
  "still reference exactly one Learning Track for provenance." `scoreCandidateV4` retains `trackId`
  whenever `CAMPAIGN` is an effective source too, independent of `GROWTH_PLAN`. The `TRACK_PRIORITY`
  / `TRACK_PROTECTED_MINIMUM` / `TRACK_CADENCE_DEFICIT` factors and their reason refs are unaffected
  (still gated on `GROWTH_PLAN` and an `ACTIVE` Track), so this is a narrow, additive fix, not a
  scoring change.
- **Post-deadline clamping** (§3): a passed deadline no longer raises `PlanningInputError`.
  `campaignDaysUntilDeadlineV4` clamps to `max(0, ...)`; `campaignHasPassedV4` uses the exclusive-end
  semantics (`deadlineMs <= asOfMs`) from ADR-0010 §3; `warningCodesV4` adds
  `CAMPAIGN_DEADLINE_PASSED`; and the "next Campaign clock transition" validity cap is skipped
  entirely once the deadline has passed, because none remains. `candidateReasonRefsV4` is a
  necessary, narrow fork of the shared `candidateReasonRefs` (not a reuse-with-cast like every other
  V4 helper) purely to substitute the clamped day count in the `CAMPAIGN_DEADLINE` reason ref.
- **Allocation overrides as bounded temporary replacements** (§5): `PlanningTrackInputV4` adds one
  nullable `allocationOverride: CampaignAllocationOverrideInput | null`. The engine independently
  verifies it rather than trusting the adapter, exactly like V3 already re-derives effective
  capacity instead of trusting a supplied number: `validateAllocationOverride` enforces the floor
  invariant (`protectedMinimumMinutesOverride` must not be lower than the Track's own
  `protectedMinimumMinutes`) as a hard `raise`, matching D5-db's own identical choice for the direct
  command; `effectiveTrackPriority`/`effectiveTrackProtectedMinimumMinutes`/
  `effectiveTrackCadencePerWeek` compute the override-or-base value, and every scoring/rationing
  path (`scoreCandidateV4`, `validateGrowthPlanCapacityV4`'s hard capacity invariant, and the
  reused, unmodified `rationProtectedMinutes`) consumes the effective value instead of the raw one.
  No new score factor was added — an override changes an existing factor's *inputs*
  (`TRACK_PRIORITY`'s points, the `TRACK_PROTECTED_MINIMUM` deficit gate, the cadence deficit
  bucket), never introduces a new factor code, matching ADR-0010 §8's "no existing coefficient
  changes value."
- `PlanningPolicyV4`/`PLANNING_POLICY_V0_4` are a version-bump-only copy of V3's weights, per
  ADR-0010 §8 ("D5 changes campaign eligibility ... not scoring").
- `PlanSnapshotV4` reuses V3's exact shape (only `engineVersion`/`policyVersion` differ); no new
  contract field.

A cross-version fix was required in the **shared, version-agnostic**
`src/shared/contracts/planning-semantics.ts`: `planSnapshotSemanticViolations` and its
`actionViolations` helper hard-rejected any snapshot whose nearest deadline preceded
`calculatedAsOf`, and expected a reason ref's `daysUntilDeadline` to equal the *unclamped* value —
both assumptions ADR-0010 §3 deliberately breaks for V4 only. Both checks now branch on a new
`allowsPassedCampaignDeadline` flag computed from `value.engineVersion ===
"planner-engine/0.4.0"`, so V1–V3 keep their exact original, unrelaxed behavior (the flag is always
`false` for their own `engineVersion` strings) while V4 gets the ADR-required relaxation. This was
caught before it could ship: the very first V4 golden-fixture and `calculate-plan-v0.4.test.ts` run
against a real past deadline failed both checks until this fix landed.

## Delivered outcome 2: application-layer "expand" plumbing

- `assemblePlanSnapshotInputV4` (`assemble-plan-snapshot-input.ts`) is one more branch of the
  existing internal function, following the exact V1→V2→V3 precedent. It reads a new, this
  session's own invented (undocumented elsewhere, since no real producer exists yet) source-bundle
  shape: `bundle.campaign` (`null`, or `{campaignId, version, title, readinessGoalId, deadlineAt}`,
  resolved to `readinessGoalKey`/`targetProfileVersionKey` through the same `targetByGoalId` map a
  Track already uses) and each `plan.tracks[]` entry's own `allocationOverride` (`null`, or
  `{overrideId, version, priorityOverride, protectedMinimumMinutesOverride,
  cadencePerWeekOverride}`). A shared `resolveDailyCaps` helper factors out the day-cap parsing V3
  and V4 both need, with zero behavior change to the already-released V3 path.
- `dispatch-plan-snapshot-projection.ts` recognizes `planning-calculation/4` and routes a claim
  carrying it through `assemblePlanSnapshotInputV4`/`calculatePlanV4`, mirroring the V1/V2/V3
  branches exactly.
- **Exercised only by synthetic fixtures** in this session's own tests, exactly like `.../3`: a new
  V4 `describe` block in `assemble-plan-snapshot-input.test.ts` (campaign resolution, a missing
  readiness-goal failure, override assembly, absent-vs-null override equivalence, and V3 parity when
  neither is present) and one new dispatcher-routing test. No real delivery can reach this path.

## Delivered outcome 3: five new contracts

New JSON Schema + TypeScript semantic-validator pairs, following the released
`interview-campaign-lifecycle-control.ts` / `growth-plan-replacement-control.ts` pattern exactly
(structural schema in `schemas/`, semantic violations, a `ContractError` class, `decode*`
functions), built directly from the exact response shapes D5-db's own migration produces (verified
by reading the SQL, not guessed):

- `CampaignAllocationOverrideChangePreviewV1`/`ApplyResultV1`
  (`src/shared/contracts/campaign-allocation-override-control.ts`,
  `schemas/planning/v1/campaign-allocation-override-control.schema.json`) — checks the override key
  binds its derived identity, the transition advances exactly one version, the operation matches its
  released lifecycle table (`change` keeps `ACTIVE`; `remove` moves to `REMOVED` and retains every
  value unchanged as history), and `canApply` exactly reflects `blockingReasons`.
- `CampaignAllocationOverridesV1` (`campaign-allocation-overrides.ts`, the read boundary) — checks
  each row's `capabilities` exactly match its lifecycle, mirroring `interview-campaigns.ts`'s own
  capability-matrix check.
- `CampaignLifecycleCoordinationPreviewV1`/`ApplyResultV1`
  (`campaign-lifecycle-coordination-control.ts`,
  `schemas/agent-control/v1/campaign-lifecycle-coordination-control.schema.json` — placed under the
  `agent_control` schema tree since that is where the coordinator itself lives, not under
  `interview-campaign`) — checks the campaign key binds its identity and the transition table
  matches the released draft/active/ended/cancelled rules (reused from the interview-campaign
  contract's own transition logic), that `start_campaign` never carries closed overrides and
  `end_campaign`/`cancel_campaign` never carry installed ones, and that one apply result's
  `overrides` array is uniformly either every-installed-shape or every-closed-shape, never mixed
  (the two shapes are structurally distinct: an installed item's `learningTrack` carries `title`,
  a closed item carries none at all).
- Every fixture set (`valid`/`boundary`/`apply`/`invalid`/`malicious`) was authored from the actual
  migration output shapes, not invented, and each is exercised by a dedicated
  `tests/contract/*.test.ts` file asserting schema validity, semantic-violation detection, and
  round-trip decode.
- `schema-registry.ts` gained five new schema names (three control contracts, plus
  `planning-input-v4`/`plan-snapshot-v4`, near-identical copies of the V3 schemas with the version
  consts flipped and one new `allocationOverride` object added to the track definition).

## Delivered outcome 4: a real `/campaigns` browser workflow

Live today, needing no SQL activation, because D5-db's commands are already real:

- `src/ui/campaigns/server/database-campaigns.ts` gained five wrapper functions
  (`loadCampaignAllocationOverridesV1`, `preview_/applyCampaignAllocationOverrideV1`,
  `preview_/applyCampaignLifecycleCoordinationV1`), following the file's own established validation
  pattern (regex/range checks before any RPC call, `CampaignInputError`/`CampaignConflictError`/
  `CampaignUnavailableError` collapse, contract-error collapse to `CampaignUnavailableError`).
- **`campaign-lifecycle.tsx` was rewritten to call the coordinator, not the plain D4 command**,
  closing D5-db's own recorded remaining-work item #2: every `start_campaign`/`end_campaign`/
  `cancel_campaign` in the browser now goes through `preview_/applyCampaignLifecycleCoordinationV1`.
  This is a strict superset of the plain path's capability (identical preconditions, plus optional
  overrides), so nothing regresses for a campaign that carries no override; the plain
  `preview_/applyInterviewCampaignLifecycleV1` wrapper and its Server Actions are left in place,
  unused by any component now, because they remain valid, tested, independently callable D4 command
  wrappers (D5-db's report calls the plain path "completely valid for a campaign with no override"),
  and removing still-correct, tested code that nothing asked to be removed was judged out of scope.
- **Scope decision, recorded deliberately**: `start_campaign` accepts at most **one** attached
  allocation override in this browser workflow, via a single Learning Track `<select>` plus three
  optional number inputs, even though the coordinator itself accepts up to 20. This keeps the form
  reasonably sized for a first release; the wire-level plumbing (`overrides: readonly
  CampaignLifecycleCoordinationOverrideIntentV1[]`) already supports more, so raising the UI limit
  later is additive.
- New `src/ui/campaigns/campaign-allocation-overrides.tsx`: lists a campaign's own active overrides
  and offers change (pre-filled with current values; a blank field clears that dimension, matching
  the command's replace-not-merge semantics) and remove forms, each with its own preview/confirm
  step and digest binding, following the same accordion pattern as every other campaign sub-form.
- `campaign-list.tsx`/`campaign-workspace.tsx`/`/campaigns/page.tsx` thread two new, optional
  (default `[]`) props end to end: `availableTracks` (from the already-released
  `loadCurrentLearningTracksV1` Planning read, composed here as read-only cross-context projection,
  not a new command) and `overrides` (from the new read). `/campaigns/page.tsx` loads both
  alongside its existing two reads in one `Promise.all`.
- **A genuine pre-existing bug was found and fixed**, not introduced by this session but exposed by
  its own new end-to-end tests: `campaign-lifecycle.tsx`'s (and now
  `campaign-allocation-overrides.tsx`'s) shared "dismiss every stale sibling preview" mechanism
  calls the parent's `onIntentStart` synchronously inside the same click handler that opens the
  clicked instance's own form. Because React batches all of that into one commit, the
  `dismissalVersion`-watching `useEffect` could not tell its *own* instance's self-caused bump from
  a sibling's, and would immediately re-dismiss the form the very click had just opened. No existing
  e2e test had ever clicked a "Start/End/Cancel this campaign" button on the real page and then
  checked the form stayed open (every released lifecycle e2e case exercises the already-open state
  via a `focused*PreviewState` fixture instead) — this session's own new
  "offers a Learning Track override picker" test was the first to do so, and caught it immediately.
  Fixed with a `suppressNextDismiss` ref set immediately before calling `onIntentStart`, consumed
  (and cleared) by the effect on the very next run instead of triggering the dismiss — applied
  identically to both components.

## Files and migrations changed

No SQL migration, schema-owning file, production dependency, or lockfile changed.
`docs/DAILY_PACE_AUTOREPLAN_AGENT_PROMPT.md` was not read, edited, or staged.

- **Domain**: `src/modules/planning/domain/planning-types.ts` (+`PLANNER_ENGINE_VERSION_V4`,
  `PlanningPolicyV4`, `CampaignAllocationOverrideInput`, `PlanningTrackInputV4`,
  `GrowthPlanInputV4`, `CalculatePlanInputV4`, `VerifiedCalculatePlanInputV4`, `PlanSnapshotV4`, all
  additive); new `src/modules/planning/domain/planning-policy-v0.4.ts`;
  `src/modules/planning/domain/calculate-plan.ts` (+the full V4 engine, appended after the V3
  block, reusing every version-agnostic V1–V3 helper unchanged); new
  `src/modules/planning/domain/calculate-plan-v0.4.test.ts` (13 cases).
- **Application**: `src/modules/planning/application/assemble-plan-snapshot-input.ts`
  (+`assemblePlanSnapshotInputV4`, `resolveDailyCaps`, `allocationOverrideInput`, additive);
  `src/modules/planning/application/calculate-plan.ts` (+`calculatePlanV4`);
  `src/modules/planning/application/dispatch-plan-snapshot-projection.ts` (+`.../4` recognition and
  routing); matching new/extended test blocks in each file's own test file.
- **Contracts**: new `src/shared/contracts/campaign-allocation-override-control.ts`,
  `campaign-allocation-overrides.ts`, `campaign-lifecycle-coordination-control.ts`; new
  `schemas/planning/v1/campaign-allocation-override-control.schema.json`,
  `schemas/planning/v1/campaign-allocation-overrides.schema.json`,
  `schemas/agent-control/v1/campaign-lifecycle-coordination-control.schema.json`,
  `schemas/planning/v4/planning-input.schema.json`, `schemas/planning/v4/plan-snapshot.schema.json`;
  `src/shared/contracts/schema-registry.ts` (+5 registrations); `src/shared/contracts/
  planning-semantics.ts` (the `allowsPassedCampaignDeadline`-gated V4 relaxation described above —
  the only edit to a file shared by every released calculation version).
- **UI/app**: `src/ui/campaigns/server/database-campaigns.ts` (+5 functions, +5 RPC name consts,
  +validation helpers); new `src/ui/campaigns/campaign-allocation-overrides.tsx` (+test file);
  `src/ui/campaigns/campaign-lifecycle.tsx` (rewritten for the coordinator, +override picker,
  +dismiss-race fix); `src/ui/campaigns/campaign-list.tsx`/`campaign-workspace.tsx`/
  `campaign-types.ts` (thread `availableTracks`/`overrides`); `src/app/campaigns/page.tsx` (+2
  reads); `src/app/campaigns/actions.ts` (+4 Server Actions, +field parsers); `src/app/dev/
  campaigns-fixture/page.tsx` (fixed the now-stale lifecycle preview fixture to the coordinator
  shape; +override/track fixtures; +`?preview=override`).
- **Tests**: new `tests/contract/planning-v4.test.ts`;
  `tests/contract/campaign-allocation-override-control.test.ts`,
  `campaign-allocation-overrides.test.ts`, `campaign-lifecycle-coordination-control.test.ts` (+their
  fixture sets under `tests/contract/fixtures/planning/v1/` and
  `tests/contract/fixtures/agent-control/v1/`); new
  `tests/fixtures/calculation-engines/v0.4/planning.golden.json` (generated by actually running
  `calculatePlanV4`, not hand-authored — confirmed byte-identical to the V3 golden's `actions` and
  `capacity` aside from version stamps and fingerprint, the expected parity result for an input with
  no override and a future deadline); `tests/e2e/campaigns.spec.ts` (+2 new cases, +2 preview kinds
  in the WCAG loop); every touched component/module's own `*.test.ts(x)` file extended in place.

## Contracts and invariants

- New calculation contract: `PlanningCalculationInputV4`/`PlanSnapshotV4`,
  `planner-engine/0.4.0`, `planning-policy/0.4` — real, pure, fully tested, but **inert**: no
  delivery can carry it, per the session constraint above.
- New client-facing contracts (all `1.0.0`): `CampaignAllocationOverrideChangePreviewV1`/
  `ApplyResultV1`, `CampaignAllocationOverridesV1`, `CampaignLifecycleCoordinationPreviewV1`/
  `ApplyResultV1` — these ARE live, reachable from `/campaigns` today.
- Ownership unchanged from D5-db: Planning owns the override aggregate and its commands; the
  coordinator owns nothing and reaches both owners only through already-granted functions.
- Idempotency/security: unchanged from D5-db; this session added no new command, only clients and a
  pure calculation path.
- Failure behavior: the browser layer collapses every RPC/contract failure to the same three
  existing error classes (`CampaignInputError`/`CampaignConflictError`/`CampaignUnavailableError`)
  the rest of `/campaigns` already uses, so the page's existing `failure()` handler needed no
  change.

## Verification

Every command below was executed in this session on Node 24, with Docker available and used for
every database-backed gate, against the real Supabase CLI local stack. No SQL migration exists to
verify beyond D5-db's own, unmodified one.

| Gate | Result |
|---|---|
| `pnpm exec tsc --noEmit` (run repeatedly while iterating) | PASS throughout |
| `pnpm format:check` | PASS |
| `pnpm lint` | PASS |
| `pnpm verify:db` | PASS — 53 pgTAP files, 3402 assertions, zero failures (unchanged from D5-db, no migration touched); `supabase db lint --level warning --fail-on warning` clean |
| `pnpm verify:auth` | PASS |
| `pnpm verify` (`format:check`, `lint`, `typecheck`, `test:database-runner` 15/15, `test:backup-archive` 3/3, `test:contracts` 465/465, `test:performance` 3/3, `test:unit:coverage`, `test:e2e`) | PASS — unit coverage **86.16%/80.01%/91.03%/87.44%** (statements/branches/functions/lines) against the 85/80/85/85 threshold*, 1172/1172 unit tests; `next build` succeeded; full Chromium E2E **53/53** (up from the prior session's 51/51: +2 new campaigns cases) |
| `pnpm verify:backup` | PASS — "encrypted backup clean-restore gate passed" |

\* Statements (86.16%) and lines (87.44%) clear the 85% floor; branches (80.01%) clears the 80%
floor by 0.01 point after two rounds of adding targeted tests for previously-uncovered validation
branches in `database-campaigns.ts` and `calculate-plan.ts`'s V4 addition — genuinely exercised
branches, not coverage-gaming. This is worth a future session's attention if it drifts back under
threshold; it is not a currently-failing gate.

Targeted runs during iteration (all passing before the full gates above): `npx vitest run
src/modules/planning`, `tests/contract`, `src/ui/campaigns src/app/campaigns` (71 tests),
`PANDO_ENABLE_CAMPAIGNS_FIXTURE=true npx playwright test tests/e2e/campaigns.spec.ts` (14/14, run
twice — once catching the dismiss-race bug, once confirming the fix).

## Remaining work

1. **The SQL-gated "activate" half for both `.../3` and `.../4`** — unchanged from D3b2-rollout's
   own open item, now joined by an identical one for V4: a future SQL-permitted session must widen
   `plan_snapshot_attempts.calculation_contract_version`'s CHECK constraint and extend
   `planning.load_plan_snapshot_source_bundle_v1/v2`-equivalent SQL to actually emit
   `bundle.campaign` and each Track's `allocationOverride` (composing them from
   `targets.interview_campaigns` and `planning.campaign_allocation_overrides`, mirroring how V3's
   own still-pending activation would compose `bundle.availability` from `AvailabilityWindow` rows).
   Until then, the real `/today`/`/plan` recommendation snapshot never reflects a campaign or an
   override — only the direct override/coordinator commands and their own read do.
2. **The "attach one override only" UI scope decision** (recorded above) — raising it to the
   coordinator's real 20-override limit is additive whenever a product need justifies the added form
   complexity.
3. **D5-db's own two open questions** (unchanged, still for the product owner): at-most-one-active-
   override-per-Track, and no path to attach a new override to an already-active campaign (only at
   `start_campaign`, or edit/remove of an existing one).
4. **D3b1-db's inherited missing pgTAP proof** remains unfixed, unrelated to this session's scope.
5. `docs/DAILY_PACE_AUTOREPLAN_AGENT_PROMPT.md` was not read, edited, or staged, per explicit
   instruction.

## Codex resume prompt

```text
Прочитай docs/implementation/CLAUDE_CODE_HANDOFF_REPORT.md и весь этот документ
(PHASE_4B_D5_ALLOCATIONS_STATUS.md, включая раздел "D5-app" в конце). Ветка claude/d5-app поверх
claude/d5-db содержит ЗАВЕРШЁННЫЙ Phase 4B D3-D5: planner-engine/0.4.0 и planning-policy/0.4
(campaign eligibility при paused Growth Plan, retained Track provenance для campaign-кандидата на
неактивном Track, post-deadline clamping до нуля дней вместо отказа, allocation override effective
values с независимой проверкой floor-инварианта движком), assemblePlanSnapshotInputV4 и
dispatcher-роутинг (inert plumbing — SQL CHECK-constraint на calculation_contract_version всё ещё
допускает только .../1 и .../2, ни одна реальная доставка не может нести .../3 или .../4, это
осознанно и задокументировано, не баг), пять новых контрактов (JSON Schema + TS +
semantic-violations + fixtures) для CampaignAllocationOverrideChangePreview/ApplyResult,
CampaignAllocationOverrides, CampaignLifecycleCoordinationPreview/ApplyResult, и полностью РЕАЛЬНЫЙ
браузерный workflow на /campaigns: campaign-lifecycle.tsx переведён на координатор
(preview_/apply_campaign_lifecycle_coordination_v1) вместо прямой D4-команды, с опциональным
прикреплением ОДНОГО override на Learning Track при старте кампании; новый компонент
campaign-allocation-overrides.tsx для просмотра/редактирования/удаления активных overrides. По
пути найден и исправлен настоящий предсуществовавший баг гонки состояний (dismissalVersion
самовызов), не introduced этой сессией, но обнаруженный её первым реальным e2e-кликом по кнопке
"Start this campaign". Все четыре гейта зелёные: pnpm verify:db (3402 assertions/53 files, lint
clean, миграции не менялись), pnpm verify:auth, pnpm verify (unit coverage
86.16/80.01/91.03/87.44% — branches чуть выше порога 80% после точечного добавления тестов на
непокрытые ветки валидации; E2E 53/53, было 51/51), pnpm verify:backup. Открытые пункты: SQL-gated
активация V3 И V4 (обе одинаково недостижимы без миграции), UI ограничен ОДНИМ override при
старте кампании (координатор поддерживает до 20 — сознательное решение), и два прежних открытых
вопроса D5-db (не более одного активного override на Track; нет команды "добавить override к уже
активной кампании"). docs/DAILY_PACE_AUTOREPLAN_AGENT_PROMPT.md не читался и не менялся.
```
