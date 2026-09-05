# Claude Code handoff report

Session date: 2026-09-05
Agent: Claude Code (Sonnet 5), continuing from the released D4-app outcome
(`claude/d4-app` at `cff1475`)
Branch: `claude/d5-db`
Scope: D5-db — exactly Исход 7 of the split plan: the database layer for campaign allocation
overrides and the campaign lifecycle coordinator — new additive SQL migration (allocation
overrides table, the first cross-owner coordinator `campaign_lifecycle_v1` in the new
`agent_control` module boundary), RLS, `api.*` RPCs with server-computed digest previews and
idempotent apply, full pgTAP functional and concurrency coverage, and regenerated database types.
Explicitly excluded: client code, UI, and the calculation-engine implementation
(`planner-engine/0.4.0`, `PlanningCalculationInputV4`) — that is D5-app, a separate future session.

## 1. Outcome attempted

D5-db. Status: **complete**. Every deliverable the session's own instructions required is
implemented, tested, and green: the additive migration (overrides table + floor-guard trigger,
direct edit/remove command, read boundary, the `agent_control` coordinator with two narrow
cross-context bounded reads and two private owner hooks, and a table-level guard closing an
invariant gap the ADR's design implies), RLS on every new table and every new bounded read, full
pgTAP functional (052) and concurrency (053) suites, regenerated `database.generated.ts`, and the
status document. Full detail is in `docs/implementation/PHASE_4B_D5_ALLOCATIONS_STATUS.md`.

## 2. User-visible result

None — this is a database-only slice with no client, UI, or Server Action change. Nothing a signed-
in person can see or do today changed. What is now available for D5-app to build on:

- `api.preview_campaign_lifecycle_coordination_v1` / `api.apply_campaign_lifecycle_coordination_v1`
  — start a campaign with a bounded set of validated Learning Track overrides installed
  atomically, or end/cancel a campaign with its active overrides closed atomically, all in one
  transaction spanning Targets (campaign lifecycle) and Planning (overrides).
- `api.preview_campaign_allocation_override_v1` / `api.apply_campaign_allocation_override_v1` —
  edit or remove one already-installed override on an active campaign.
- `api.get_campaign_allocation_overrides_v1()` — a workspace's full override history across every
  campaign and lifecycle state.
- A table-level guard now refuses ending or cancelling a campaign that still carries an active
  override through the already-released, unmodified D4 command, directing the caller to the
  coordinator instead — closing a real invariant gap this slice introduced, before any client ever
  had a way to install an override in the first place.

## 3. Architecture and policy decisions

Authority: ADR-0010 §5 (allocation overrides), §7 (the coordinator), §9 (D5 scope). No product
semantic was reinterpreted; every decision below is either an implementation-shape choice within
what the ADR specifies, or a conservative gap-closure recorded explicitly for the product owner
(mirroring how D4-db recorded its own open questions).

- **A single active override per Learning Track**, enforced by a partial unique index plus a soft
  `ALLOCATION_OVERRIDE_TRACK_ALREADY_OVERRIDDEN` preview blocker. ADR-0010 §5 does not resolve what
  happens when two simultaneously active campaigns try to overlay the same Track (D4-db left
  general campaign cardinality open); this session closes that gap conservatively and only for
  overrides, since an ambiguous "which campaign's override wins" would be unexplainable to a user.
  Recorded as an open question for the product owner, exactly like D4-db's own cardinality note.
- **The floor invariant (`protectedMinimumMinutesOverride` must not be lower than the Track's own
  protected minimum) is a hard `raise`, not a soft preview blocker** — unlike capacity, which
  ADR-0010 §5 explicitly calls "a blocking validation error, not a warning" (i.e., an enumerable,
  previewable condition). The floor is a structural input error, matching how this codebase already
  treats other malformed-input cases; capacity depends on other tracks' current state, which is
  exactly what a soft blocker is for.
- **Overrides are installed only through `start_campaign`.** No command attaches a new override to
  an already-active campaign; only editing or removing an existing one is direct. This bounds this
  session's scope to exactly what ADR-0010 §5 describes ("start_campaign (install validated
  overrides)") and is recorded as a deliberate, revisitable limitation, not an oversight.
- **The coordinator owns no table.** ADR-0010 §7 says it "stores only coordination and audit rows";
  this session reads that as the existing `outbox.command_receipts`/`outbox.events` infrastructure
  every command already shares, not a dedicated Agent Control ledger. `agent_control` holds only
  function definitions.
- **A table-level trigger, not a replaced D4 function, closes the orphaned-override risk.** Ending
  or cancelling a campaign through the plain, already-released D4 command
  (`api.apply_interview_campaign_lifecycle_v1`) would never close an override, stranding it "active"
  forever. Rather than touch that tested function, this session added
  `targets.guard_interview_campaign_lifecycle_overrides` (a `before update` trigger on
  `targets.interview_campaigns`) that refuses the transition whenever an active override exists.
  The coordinator's own path satisfies the guard by construction, because it always closes
  overrides before flipping the campaign's lifecycle in the same transaction. The released 050/051
  pgTAP suite never installs an override, so the guard never fires for it.
- **Two new single-purpose NOLOGIN "source" roles** (`pando_phase1_agent_control_source`,
  `pando_planning_agent_control_source`) carry the coordinator's two cross-context bounded reads,
  mirroring the established `pando_identity_phase1_source` / `pando_phase1_planning_source`
  pattern exactly, rather than granting the general `pando_agent_control_api` role direct table
  access to either owner's tables. A third bounded read
  (`targets.read_interview_campaign_for_override_source_v1`, used by the direct override command
  and the read boundary) reuses the already-existing `pando_phase1_planning_source` role instead of
  inventing a fourth, since that role already carries Planning's other Targets-owned bounded reads.

## 4. Files and migrations changed

- **Migration** (new): `supabase/migrations/20260907000100_phase4b_d5_campaign_allocation_overrides.sql`
  — the `agent_control` schema/role, `planning.campaign_allocation_overrides` (+ trigger + RLS),
  identity/event-payload helpers, the direct change/remove command (preview + apply) and read
  boundary, the lifecycle-overrides guard trigger and its narrow Planning read, three cross-context
  bounded-read functions, the coordinator's digest helper and preview builder, two private owner
  hooks, the coordinator's `api.*` entry points, and the consolidated ownership/grant/cleanup block.
- **Fixture access** (edited, additive-only): `supabase/tests/fixture-migrations/99999999999999_d1b_pgtap_fixture_access.sql`
  — grants for pgTAP to call the two new private Planning helpers directly.
- **pgTAP tests** (new): `supabase/tests/database/052_phase4b_d5_campaign_allocation_overrides.test.sql`
  (functional) and `053_phase4b_d5_campaign_allocation_overrides_concurrency.test.sql`
  (two-connection `dblink` race plus an injected-atomicity-failure proof).
- **pgTAP tests** (edited, additive-only): `supabase/tests/database/001_phase0_schema_security.test.sql`
  — new schema, new SECURITY-DEFINER function names in the exemption/ownership lists, new roles in
  the NOLOGIN and cannot-SET-ROLE checks, new bounded-read functions in the pinned-owner tuple list.
- **Test runner** (edited): `tests/database/verify-database.test.mjs` — the hardcoded pgTAP-file
  argv fixture extended with `052_...` and `053_...`.
- **Generated types** (regenerated): `src/shared/supabase/database.generated.ts` via
  `pnpm exec supabase gen types typescript --local --schema api`, purely additive versus the
  pre-D5 file (five new function signatures).
- **Docs**: `docs/implementation/PHASE_4B_D5_ALLOCATIONS_STATUS.md` (new), this report.

No client code, UI, Server Action, JSON Schema/TypeScript contract, or calculation-engine file was
touched.

## 5. Contracts and invariants

- New SQL-level contracts (envelope `contract: {name, version: "1.0.0"}` only — JSON
  Schema/TypeScript pairs are D5-app's job, matching how D4-db shipped ahead of D4-app):
  `CampaignAllocationOverrideChangePreviewV1`/`ApplyResultV1`, `CampaignAllocationOverridesV1`,
  `CampaignLifecycleCoordinationPreviewV1`/`ApplyResultV1`.
- Ownership: `planning.campaign_allocation_overrides` and every function mutating it are
  Planning-owned; the coordinator (`pando_agent_control_api`) owns no table and holds no direct
  grant on either owner's tables — it reaches them only through narrowly granted functions.
- Security: every new `api.*` function is `security definer`, pinned `search_path=''`, owned by a
  NOLOGIN role; every new table has forced RLS with a single owning-role policy plus, where a
  cross-context bounded read needs it, an additional narrowly-scoped `using (true)` policy for that
  read's own dedicated role — never a blanket grant to the general owning role.
- Idempotency: the coordinator's apply is idempotent on `(actor_user_id, command_type,
  idempotency_key)`, proven by an exact-replay pgTAP assertion (identical cached response, no
  duplicate override row).
- Failure behavior: stale versions, a preview no longer matching freshly recomputed state
  (including a concurrent winner's committed change), or a blocked preview all surface as `40001`
  at apply; malformed input is refused before any lock (`22023`); an inaccessible campaign, Track,
  or override is `42501`; a cross-owner atomicity failure (proven via an injected outbox-trigger
  failure) rolls back both owners' state, events, and the receipt together.

## 6. Verification

Every command below was executed in this session on Node 24, with Docker available and used for
every database-backed gate, against the real Supabase CLI local stack.

| Gate | Result |
|---|---|
| `pnpm verify:db` | PASS — 53 pgTAP files, 3402 assertions, zero failures; `supabase db lint --level warning --fail-on warning` clean |
| `pnpm verify:auth` | PASS |
| `pnpm verify` (`format:check`, `lint`, `typecheck`, `test:database-runner`, `test:backup-archive`, `test:contracts`, `test:performance`, `test:unit:coverage`, `test:e2e`) | PASS — unit coverage unchanged at **86.36%/80.23%/91.02%/87.67%** against the 85/80/85/85 threshold (no TypeScript changed this session); `next build` succeeded; full Chromium E2E **51/51** unchanged (no client code changed) |
| `pnpm verify:backup` | PASS — "encrypted backup clean-restore gate passed" |

Several authoring mistakes were caught and fixed before this final run — see
`docs/implementation/PHASE_4B_D5_ALLOCATIONS_STATUS.md`'s "Verification" section for the exact
list (the most notable: `ALTER FUNCTION ... OWNER TO` requires the new owner to hold `CREATE` on
the function's schema, not merely role membership; `jsonb ->> 'key'` already collapses a stored
JSON `null` to SQL `NULL`, unlike bare `->`; and the released `events_planning_insert` RLS policy
only admits the Growth-Plan/Learning-Track aggregate types, so the new override event needed its
own additive policy).

## 7. Git state

- Branch `claude/d5-db`, based on `claude/d4-app` at `cff1475`.
- This session's changes are staged for a single feature commit (`feat(planning): D5 campaign
  allocation overrides and lifecycle coordinator database layer`) followed by this report's own
  `docs` commit, per this repository's established two-commit convention.
- Not pushed. `main` is unaffected.
- `docs/DAILY_PACE_AUTOREPLAN_AGENT_PROMPT.md` was not read, edited, or staged.
- Working tree is clean except the same pre-existing, unrelated, already-modified `.gitignore`
  (adds `.aider*`) every prior session in this line has found and left untouched.

## 8. Remaining work

1. **D5-app** — the calculation-engine rollout (`PlanningCalculationInputV4`, `PlanSnapshotV4`,
   `planner-engine/0.4.0`, `planning-policy/0.4`), JSON Schema/TypeScript contracts for the five
   new commands/read this session delivered, Server Actions, and a UI surface (most naturally an
   extension of `/campaigns`'s existing lifecycle controls, since overrides attach at
   start/end/cancel). This is the next bounded outcome; the database layer it needs is now
   complete.
2. **Wiring `/campaigns`'s released lifecycle UI to the coordinator** so a person can attach
   overrides while starting a campaign, and so ending/cancelling an override-carrying campaign does
   not surface the new guard's refusal to an end user (the plain D4 path remains fully valid for a
   campaign with no override).
3. Two deliberately recorded, revisitable scope decisions for the product owner: no path to attach
   a new override to an already-active campaign (only start-time install, or edit/remove of an
   existing one), and at-most-one-active-override-per-Track (a conservative closure of a gap
   ADR-0010 §5 leaves open, mirroring D4-db's own still-open single-active-campaign question).
4. **D3b1-db's inherited missing pgTAP proof** remains unfixed, unrelated to this session's scope.

## 9. Codex resume prompt

```text
Прочитай docs/implementation/CLAUDE_CODE_HANDOFF_REPORT.md,
docs/implementation/PHASE_4B_D5_ALLOCATIONS_STATUS.md, ADR-0010 (0010-lifecycle-replacement-
availability-and-campaign-semantics.md) §5/§7/§9, и supabase/migrations/
20260907000100_phase4b_d5_campaign_allocation_overrides.sql. Ветка claude/d5-db поверх
claude/d4-app (cff1475) содержит ЗАВЕРШЁННЫЙ и полностью проверенный слой базы данных для D5
(Исход 7): planning.campaign_allocation_overrides с триггером нижней границы, прямую команду
change/remove (api.preview_/apply_campaign_allocation_override_v1), read
api.get_campaign_allocation_overrides_v1, первый межконтекстный координатор
agent_control.coordinate_campaign_lifecycle_v1 (api.preview_/apply_campaign_lifecycle_coordination_v1)
с фиксированным порядком блокировок agent-control-workspace → targets-workspace →
planning-workspace, приватные owner hooks, два новых bounded-read источника со своими NOLOGIN-
ролями, и защитный триггер targets.guard_interview_campaign_lifecycle_overrides поверх уже
принятой (и не изменённой) D4 api.apply_interview_campaign_lifecycle_v1. Полное тестовое покрытие:
052 (функциональный) и 053 (dblink-race плюс injected-failure атомарность). Все четыре гейта
зелёные: pnpm verify:db (3402 assertions/53 files, lint clean), pnpm verify:auth, pnpm verify
(coverage не изменился — 86.36/80.23/91.02/87.67% выше порога 85/80/85/85, т.к. TS не менялся;
E2E 51/51 не изменился), pnpm verify:backup. НЕ начинай D5-app (planner-engine/0.4.0,
PlanningCalculationInputV4, planning-policy/0.4, JSON Schema/TS-контракты, UI, миграция /campaigns
на координатор) — это следующий отдельный выход; слой базы данных для него полностью готов.
Открытые вопросы для владельца продукта записаны в обоих документах: не более одного активного
override на Track одновременно, и отсутствие отдельной команды "добавить override к уже активной
кампании" (только на старте или редактирование/удаление существующего).
```
