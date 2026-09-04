# Phase 4B D3b — availability windows: closure summary

Status: **partial**, not complete. D3b1 and D3b2's TypeScript-reachable halves are complete and
verified; the SQL-gated worker-activation half of D3b2 could not be completed under this session's
"no SQL migrations" constraint and is precisely scoped below as the concrete next step.

Design: [D3b availability windows](../design/PHASE_4B_D3B_AVAILABILITY_WINDOWS.md)

Decision record:
[ADR-0010](../adr/0010-lifecycle-replacement-availability-and-campaign-semantics.md) §6, §8, §9

This document exists to give one honest answer to "is D3b done" across its three constituent
sessions. Each session's own status report remains the detailed, authoritative record; read this
one first to know which to open next.

## What D3b was scoped to do

Per the design doc: let a person record which whole local days are limited or unavailable, and make
Planning respect that limit when deciding how much work fits in the current week — without ever
raising capacity, without a daily calendar, and without touching Campaigns or Growth Plan
replacement.

## What is actually true today, for a real signed-in person

- They can create, change, and remove availability windows on `/plan`, with an exact clock-free
  preview of the stored-state effect, forced RLS, and a database exclusion constraint that refuses
  overlap even if application code is bypassed. **(D3b1 — complete.)**
- Since this session, they also see a new "Estimated capacity effect" section on `/plan`: a live,
  honestly-labeled *estimate* of how their recorded availability would affect the next seven days if
  the availability-aware engine were active, including which Tracks would be rationed. It is
  recomputed on every page load and never saved. **(D3b2-rollout, this session — complete as a
  stateless interim preview.)**
- Their actual weekly capacity — the number Planning ranks candidates and reports readiness against
  — **is still computed by `planner-engine/0.2.0`, unaffected by any availability window they have
  recorded.** The D3b1 UI copy "Recorded availability does not change weekly capacity yet" remains
  literally true after this session, and `AvailabilityWindowSourceV1.growthPlan.capacityUsesAvailability`
  is still hard-coded `false` at the database. **This is the one part of D3b's original promise not
  yet delivered.**

## Why it stops here

Three Claude Code sessions delivered D3b in order:

1. **D3b1** (persistence, control, honest inert state) — complete.
2. **D3b2-engine** (the pure, versioned `planner-engine/0.3.0` capacity-composition and rationing
   math) — complete. See [`PHASE_4B_D3B2_ENGINE_STATUS.md`](PHASE_4B_D3B2_ENGINE_STATUS.md).
3. **D3b2-rollout** (this session) — wiring the engine into the live system. Its own instructions
   forbade any SQL migration. Investigation established that in this codebase, wiring a new
   calculation contract into the *live, real-delivery* async snapshot worker is inseparable from a
   SQL migration: a hard-coded database CHECK constraint admits only `planning-calculation/1` and
   `/2`, and the V1→V2 precedent for "activating" a new contract was itself a dedicated migration
   (`20260903000400_phase4b_planning_cadence_v2_activation.sql`) with no TypeScript-only equivalent.
   Full detail in [`PHASE_4B_D3B2_ROLLOUT_STATUS.md`](PHASE_4B_D3B2_ROLLOUT_STATUS.md).

Rather than silently narrow the outcome or claim a completion that is not true of the live system,
D3b2-rollout delivered everything reachable without SQL (the dispatcher's "expand" half, fully
tested but inert against real data; and a real, live, honestly-labeled stateless preview that gives
people genuine value today) and left the SQL-gated remainder as a named, bounded, independently
startable next session.

## The exact remaining slice

One follow-up session, explicitly permitted to write SQL migrations, needs to:

1. Add a migration mirroring `20260903000400_phase4b_planning_cadence_v2_activation.sql`'s shape:
   widen `planning.plan_snapshot_attempts.calculation_contract_version`'s CHECK constraint (and
   `plan_snapshots_calculation_tuple_check`) to admit `planning-calculation/3`; stamp new deliveries
   with it; let in-flight V2 attempts finish on V2; move each workspace's pointer through one
   idempotent per-workspace activation event, exactly as V1→V2 did.
2. Extend the worker's SQL-side source-bundle assembly to emit `bundle.availability.dailyCaps`
   (composing real `AvailabilityWindow` rows into the plan week's seven local days) — the shape
   `assemblePlanSnapshotInputV3` (added this session, in
   `src/modules/planning/application/assemble-plan-snapshot-input.ts`) already expects and is already
   tested against synthetically.
3. Flip `capacityUsesAvailability` from its hard-coded `false` to a real, computed value once the
   above is live, and update the D3b1 UI copy on `/plan` accordingly.
4. Decide whether to replace this session's stateless capacity-effect preview with the ADR-0010 §6
   persisted proposal, or keep it as a lighter-weight, explicitly non-committing display surface
   alongside a real persisted proposal used only when a person is about to *act* (see
   `PHASE_4B_D3B2_ROLLOUT_STATUS.md` remaining-work item 2 for the tradeoff).
5. Separately, unrelated to the above and inherited from D3b1-app: close D3b1-db's still-missing
   pgTAP proof (see D3b1-app's and D3b2-engine's status reports).

None of this requires reopening D3a, D3b1, or D3b2-engine — all three remain accepted and
unchanged. It also does not require D4/D5 (Campaign) work, which stays untouched.

## Roadmap note

`CLAUDE.md`'s roadmap line "D3–D5 — availability, Growth Plan replacement, and Campaign commands:
ADR-gated and pending" remains accurate for D3b: D3a is complete, D3b1 and D3b2's TypeScript-reachable
work are complete, but D3b as a whole is not yet fully live, and D4/D5 have not begun.
