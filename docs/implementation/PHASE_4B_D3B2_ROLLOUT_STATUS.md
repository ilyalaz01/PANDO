# Phase 4B D3b2-rollout — application-layer wiring and stateless interim preview

Status: partial — dispatcher "expand" half and a stateless capacity-effect preview are complete and
verified; the SQL-gated "activate" half (real worker V3 routing, the ADR-0010 §6 persisted proposal)
is explicitly out of reach this session and remains open. See
[`PHASE_4B_D3B_STATUS.md`](PHASE_4B_D3B_STATUS.md) for D3b's overall closure summary.

Design: [D3b availability windows](../design/PHASE_4B_D3B_AVAILABILITY_WINDOWS.md) §4.2

Decision record:
[ADR-0010](../adr/0010-lifecycle-replacement-availability-and-campaign-semantics.md) §6, §8, §9

Prior slice: [D3b2-engine](PHASE_4B_D3B2_ENGINE_STATUS.md)

Completed: 2026-09-04

## Session constraint that shaped this outcome

This session's instructions forbid changing or creating any SQL migration. Investigation before
writing any code established that this codebase's real engine-version "activation" — the step that
lets the async Planning snapshot worker actually compute a new calculation contract for real
deliveries — is entirely SQL-gated:

- `planning.plan_snapshot_attempts.calculation_contract_version` (and the paired
  `plan_snapshots_calculation_tuple_check` constraint) carries a hard-coded
  `check (... in ('planning-calculation/1', 'planning-calculation/2'))`, added by
  `supabase/migrations/20260903000100_phase4b_planning_cadence_dual_contract.sql`. No delivery can
  ever carry `planning-calculation/3` until a migration widens this constraint.
- The V1→V2 "activate" step was itself a dedicated SQL migration
  (`supabase/migrations/20260903000400_phase4b_planning_cadence_v2_activation.sql`) that changed
  which contract new deliveries are stamped with and moved each workspace's pointer once,
  idempotently. There is no TypeScript-only equivalent of this step.
- The worker's own source-bundle assembly (`planning.load_plan_snapshot_source_bundle_v1/v2`, SQL
  functions reached only through the internal-role `load_plan_snapshot_projection_v1` RPC) would
  also need to start emitting availability-window data. No SQL migration this session extends it.
- ADR-0010 §6 requires the capacity-effect preview to be a **persisted**, server-issued, single-use
  Planning proposal (`previewAsOf`, resolved week boundaries, an expiry of at most 10 minutes).
  Persisting anything new requires a table, which requires a migration.

Given this, D3b2-rollout as literally specified by the design doc (full expand-then-activate V3
worker routing, plus a persisted preview) cannot be completed without a SQL migration. This
session's bounded, honest outcome is therefore split in two, both recorded below, with the SQL-gated
remainder precisely scoped as follow-up work rather than silently declared done.

## Delivered outcome 1: dispatcher "expand" half

- `assemblePlanSnapshotInputV3` (`src/modules/planning/application/assemble-plan-snapshot-input.ts`)
  — the V3 counterpart to the released `assemblePlanSnapshotInputV2`, added as one more branch of the
  same internal `assemblePlanSnapshotInputInternal` function, following the exact precedent V1/V2
  already set in this file. It reads a new `bundle.availability.dailyCaps` sub-object (seven
  `{date, capMinutes, sourceWindowKey}` entries) and derives `defaultWeeklyCapacityMinutes` from the
  same `plan.weeklyCapacityMinutes` field V1/V2 already read (ADR-0010 §6: "The Growth Plan's
  `weekly_capacity_minutes` remains the sustained default"), re-deriving
  `effectiveWeeklyCapacityMinutes` through the exact same pure helper
  (`effectiveWeeklyCapacityMinutes` in `availability-window-preview.ts`) the D3b2 engine and the
  stateless preview both use — one source of truth for the composition formula, not three. Fails
  closed (`PlanningProjectionSourceError`, code `INVALID_OWNER_SOURCE`) when `dailyCaps` is not
  exactly seven entries, matching the engine's own fail-closed contract.
- `dispatch-plan-snapshot-projection.ts` now recognizes `planning-calculation/3` in its
  `calculationContract()` validator and routes a claim carrying it through
  `assemblePlanSnapshotInputV3` and `calculatePlanV3`, exactly mirroring the existing V1/V2 branches.
- **This is inert plumbing, not a live capability.** No real delivery can ever carry
  `planning-calculation/3` this session, because of the CHECK constraint above. It is exercised only
  by synthetic fixtures in this session's own tests (a hand-built `bundle.availability` in
  `assemble-plan-snapshot-input.test.ts`, and a mocked RPC response in
  `dispatch-plan-snapshot-projection.test.ts`) — proven correct, never proven against real data,
  because no real data path to it exists yet.
- Every existing V1/V2 function, branch, and test is unchanged and still passes unmodified.

## Delivered outcome 2: stateless interim capacity-effect preview

Real, user-visible, live-data value delivered without any SQL change, replacing the ADR-0010 §6
persisted proposal with a documented, temporary alternative for this interim period only:

- **Pure composition** (`src/modules/planning/domain/capacity-effect-preview.ts`): `composeDailyCapacityCaps`
  builds a rolling seven-local-day window starting at the server-resolved current local date (not the
  async worker's Monday-anchored plan week, which this preview's read boundary has no granted access
  to — an explicit, documented, honest approximation, never presented as the authoritative plan
  week); `capacityEffectTrackResults` reuses the domain engine's own `rationProtectedMinutes` (now
  exported with a widened, minimal structural parameter type, `RationableTrackInput`, so it can
  accept a live-read Track projection without duplicating ADR-0010 §6's rationing math);
  `capacityEffectPreviewDigestInput` builds a canonical field-ordered digest input in the same style
  as every other Planning preview digest (`growthPlanCapacityDigestField`).
- **Application loader** (`src/modules/planning/application/loaders/capacity-effect-preview.ts`,
  the literal `application/loaders` location this session's instructions named): `loadCapacityEffectPreviewV1`
  composes already-fetched, already-authenticated data (never queries Supabase itself) into a
  `CapacityEffectPreviewV1`, hashing the digest input with the same `sha256` helper
  (`shared/contracts/json.ts`) `planningInputFingerprint` already uses.
- **UI adapter and presentation** (`src/ui/plan/server/capacity-effect-preview.ts`,
  `src/ui/plan/capacity-effect-preview.tsx`): `buildCapacityEffectPreview` adapts the two `/plan`
  reads the page already loads for their own sections (`AvailabilityWindowSourceV1`,
  `CurrentLearningTracksV1`) into the loader's UI-agnostic input — **no new RPC call, no new
  persistence, nothing written**. `/plan` computes it once per render, alongside its other reads, and
  renders a new "Estimated capacity effect" section directly under "Availability windows", showing
  the estimated effective-vs-default capacity and, when any active Track would be rationed, which
  Tracks and by how much.
- **Explicitly and repeatedly labeled as an estimate**, never as the current week's authoritative
  capacity: the UI copy says "This is only an estimate: it is not saved, and it does not change your
  Plan," the existing D3b1 "Recorded availability does not change weekly capacity yet" text in the
  Availability windows section is left untouched (still literally true), and `capacityUsesAvailability`
  (the server-resolved flag `AvailabilityWindowSourceV1.growthPlan` already carries, hard-coded
  `false` in the D3b1 migration, meant to flip once V3 is truly activated) is never read or
  overridden by this preview.
- Recomputed in full on every read; nothing is persisted. This is the documented deviation from
  ADR-0010 §6's persisted, server-issued, ≤10-minute proposal: unlike that proposal, this preview
  cannot fail closed on server-side replay or expiry — only a digest mismatch between two reads can
  ever be detected, and there is no `previewAsOf` fencing a concurrent Plan or window edit. This is an
  accepted, narrow, temporary weakening for an inherently read-only, non-committing surface (nothing
  is ever applied against this preview's digest — there is no matching apply command), not a
  precedent for weakening any command preview.

## Files changed

- **Domain**: `src/modules/planning/domain/calculate-plan.ts` (exports `rationProtectedMinutes` and
  a new `RationableTrackInput` structural type; behavior byte-for-byte unchanged — a type-level
  widening only, verified by every pre-existing V1/V2/V3 unit and contract test passing unmodified);
  new `src/modules/planning/domain/capacity-effect-preview.ts`.
- **Application**: `src/modules/planning/application/assemble-plan-snapshot-input.ts` (+`assemblePlanSnapshotInputV3`,
  additive); `src/modules/planning/application/dispatch-plan-snapshot-projection.ts` (+V3 contract
  recognition and routing, additive); new
  `src/modules/planning/application/loaders/capacity-effect-preview.ts`.
- **UI**: new `src/ui/plan/server/capacity-effect-preview.ts`, `src/ui/plan/capacity-effect-preview.tsx`;
  `src/ui/plan/plan-types.ts` (+`CapacityEffectPreviewV1` re-export); `src/ui/plan/plan-workspace.tsx`
  (+`capacityEffectPreview` prop, rendered after the Availability windows section);
  `src/app/plan/page.tsx` (+computes and passes the preview from already-loaded reads).
- **Dev fixture**: `src/app/dev/plan-fixture/page.tsx` (+`?preview=capacity-effect`, built through the
  real `buildCapacityEffectPreview` adapter rather than hand-authored JSON, so the fixture also
  exercises the production composition path).
- **Tests**: `src/modules/planning/domain/capacity-effect-preview.test.ts` (12 cases: calendar-day
  arithmetic, day-cap composition with zero/one/two windows and a malformed date, Track ordering and
  rationing, paused/completed Track exclusion, digest determinism); new V3 `describe` block in
  `src/modules/planning/application/assemble-plan-snapshot-input.test.ts` (3 cases: V2-parity in the
  unlimited case, a below-default case that rations and warns, and the seven-day fail-closed check);
  new V3 case in `src/modules/planning/application/dispatch-plan-snapshot-projection.test.ts` (routes
  a synthetic V3-stamped claim correctly, alongside the pre-existing V1/V2 non-regression cases);
  `src/modules/planning/application/loaders/capacity-effect-preview.test.ts` (4 cases: unlimited
  estimate with a valid digest, a limited/rationed estimate from a real window, paused-Track
  exclusion, digest determinism and change-detection); `src/ui/plan/server/capacity-effect-preview.test.ts`
  (2 cases: real adapter composition, null on no current Plan);
  `src/ui/plan/capacity-effect-preview.test.tsx` (2 cases: unlimited rendering, limited/rationed
  rendering with every daily cap and Track effect); one new `tests/e2e/plan.spec.ts` case ("shows the
  stateless D3b2 capacity-effect estimate and its Track rationing") against the new fixture kind.
- **Docs**: this report; `docs/implementation/PHASE_4B_D3B_STATUS.md` (new, D3b closure summary);
  `src/modules/planning/README.md` (replaces the D3b2-engine "remaining work" paragraph with this
  outcome's summary and the honest overall-partial statement).

No SQL migration, schema-owning file, production dependency, or lockfile changed.
`docs/DAILY_PACE_AUTOREPLAN_AGENT_PROMPT.md` was not read, edited, or staged.

## Contracts and invariants

- No new calculation contract, engine version, or policy version — this outcome wires the
  already-shipped `planning-calculation/3` / `planner-engine/0.3.0` / `planning-policy/0.3` into more
  callers; it defines none of its own.
- New, additive-only client-facing shape: `CapacityEffectPreviewV1` (`contract`, `calculationContract:
  "planning-calculation/3"`, `digestVersion`, `asOfLocalDate`, `defaultWeeklyCapacityMinutes`,
  `effectiveWeeklyCapacityMinutes`, `capacityLimitedByAvailability`, `dailyCaps`, `trackEffects`,
  `warningCodes`, `previewDigest`). It reuses the released `PROTECTED_MINIMUM_LIMITED_BY_AVAILABILITY`
  warning code — no new warning code, matching ADR-0010 §8's "no existing coefficient changes value."
- The stateless preview never persists, never mutates, and issues no RPC of its own — pure
  composition over data the page already authenticated and fetched for other sections. It carries no
  idempotency key and answers no command, because it is not a command: there is nothing to replay or
  apply against it.
- Domain code (`capacity-effect-preview.ts`) stays pure: no I/O, no Next.js/Supabase/browser
  dependency, no implicit clock read (it takes `asOfLocalDate` as supplied, exactly like the engine
  takes `evaluationHorizon.asOf`).
- `assemblePlanSnapshotInputV3`/dispatcher V3 routing fail closed identically to V1/V2 on a malformed
  or wrong-length `bundle.availability.dailyCaps`, an unrecognized calculation contract, or any
  existing V1/V2 fail-closed condition — no relaxation was introduced anywhere in the shared
  `assemblePlanSnapshotInputInternal` code path.

## Verification

Every command below was executed in this session. Docker was available and used for every
database-backed gate.

| Gate | Result |
|---|---|
| `pnpm format:check` | PASS (after `prettier --write` on the 10 new/changed files it initially flagged) |
| `pnpm lint` | PASS |
| `pnpm typecheck` | PASS |
| `npx vitest run src/modules/planning src/ui/plan tests/contract/planning` | PASS — 257/257 (233 pre-existing + 24 new, confirming zero regression across the whole Planning module and UI) |
| `pnpm build` (`next build`) | PASS |
| `npx playwright test tests/e2e/plan.spec.ts` (against the production build) | PASS — 18/18, including the pre-existing WCAG A/AA, reduced-motion/forced-colors, and 320px-viewport gates (proving the new section introduces no accessibility or responsive regression) and one new capacity-effect-preview case |
| `pnpm verify:db` | see the handoff report — run once for the full outcome |
| `pnpm verify:auth` | see the handoff report |
| `pnpm verify` (full gate, includes the full E2E suite, not just `plan.spec.ts`) | see the handoff report |
| `pnpm verify:backup` | see the handoff report |

## Remaining work (tracked in `PHASE_4B_D3B_STATUS.md`)

1. **The SQL-gated "activate" half** — a follow-up SQL-permitted session must: widen
   `plan_snapshot_attempts.calculation_contract_version`'s CHECK constraint (and the paired
   `plan_snapshots_calculation_tuple_check`) to admit `planning-calculation/3`; extend
   `planning.load_plan_snapshot_source_bundle_v1/v2`-equivalent SQL to emit `bundle.availability`
   (composing real `AvailabilityWindow` rows server-side into the seven-day `dailyCaps` this
   session's `assemblePlanSnapshotInputV3` already expects); write the activation migration itself
   (mirroring `20260903000400_phase4b_planning_cadence_v2_activation.sql`'s pattern: new deliveries
   stamped V3, in-flight V2 attempts finish on V2, one idempotent per-workspace activation event
   moves the pointer); and flip `capacityUsesAvailability` to a real, non-hard-coded value.
2. **The ADR-0010 §6 persisted proposal** — once the above lands, replace this session's stateless
   preview with the actual persisted, server-issued, ≤10-minute proposal ADR-0010 §6 specifies
   (`previewAsOf`, resolved week boundaries, single-use, actor/workspace/digest-bound), or keep the
   stateless preview explicitly as a lighter-weight *display* surface distinct from the real,
   persisted capacity-effect *command* preview — that choice belongs to whoever picks up this slice,
   informed by whether users need to *act* on a capacity effect (pause a Track, adjust a window) from
   the estimate itself.
3. **Exact plan-week alignment** — this session's stateless preview uses a rolling seven-day window
   from the current local date, not the async worker's Monday-anchored plan week, because the live
   `/plan` read boundary has no granted access to those boundaries. Once the SQL-gated work above
   exposes them (or a bounded read for them), align the preview's window to match exactly.
4. **D3b1-db's pgTAP proof** — inherited from D3b1-app, still not closed. See D3b1-app's and
   D3b2-engine's status reports for the original finding and the scratch-project draft location. Out
   of this session's scope.
