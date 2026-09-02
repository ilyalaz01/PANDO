# Phase 4B D3b — dated availability windows

Status: accepted implementation design

Date: 2026-09-02

Parent design: [Phase 4B lifecycle and editing commands](PHASE_4B_LIFECYCLE_COMMANDS.md)

Decision record:
[ADR-0010](../adr/0010-lifecycle-replacement-availability-and-campaign-semantics.md) §6, §8, §9

Prior slice: [D3a Growth Plan replacement](PHASE_4B_D3A_GROWTH_PLAN_REPLACEMENT.md)

## 1. Outcome and boundary

D3b lets a person tell PANDO which whole local days are limited or unavailable, and makes Planning
respect that limit when it decides how much work fits in the current week. It adds no Campaign, no
allocation override, no coordinator, and no intra-day calendar.

Availability caps. It can never raise weekly capacity above the Growth Plan's default; raising
sustained capacity remains the released D2a command.

## 2. Accepted semantics

- A window belongs to the current Growth Plan, not to the workspace, so replacement freezes the
  outgoing Plan's windows with it and an incoming Plan starts with none.
- A window covers whole local days: inclusive `starts_on` and `ends_on` with the workspace time zone
  recorded at write time. The derived instant interval is half-open, `[starts_on 00:00 local,
  (ends_on + 1) 00:00 local)`.
- `available_minutes` is `0..1440` and applies to **each covered local day**, not to the range. `0`
  means unavailable.
- Optional `energy` (`LOW | MEDIUM | HIGH`) and a bounded printable `label` are display-only.
  Neither feeds ranking in D3b.
- Active windows of one Plan are pairwise non-overlapping. Adjacent windows are legal, stay separate
  rows, and are never merged.
- Removal is a lifecycle transition to `removed`, retained as history. There is no hard delete.
- Bounds: at most 60 active windows per current Plan, at most 366 local days per window, and a
  created or changed window must end on or after the current local date.

## 3. Capacity composition

For a plan week whose seven local days are `d1..d7` in the snapshot time zone:

```text
dayCap(d)                      = available_minutes of the active window covering d, else 1440
effectiveWeeklyCapacityMinutes = min(defaultWeeklyCapacityMinutes, sum(dayCap(d1..d7)))
remainingMinutesThisWeek       = max(effectiveWeeklyCapacityMinutes - consumedMinutesThisWeek, 0)
```

`effective <= default` always holds. When the effective capacity falls below the sum of active
protected minima, the engine rations deterministically: active Tracks reserve in `(priority desc,
track key asc)` order, each reserving `min(its minimum, capacity still reservable)`. A Track that
reserves less than its minimum contributes the warning `PROTECTED_MINIMUM_LIMITED_BY_AVAILABILITY`.
No minimum is rewritten and no number is invented.

## 4. Two ordered sub-slices

D3b ships as two separately verifiable, separately committed outcomes. The first must be reported as
partial until the second lands.

### 4.1 D3b1 — persistence, control, and honest inert state

Adds the table, the `btree_gist` non-overlap exclusion constraint, forced RLS, the three-operation
owner command, the actor-scoped source, and the `/plan` control. The preview is clock-free: it shows
only stored window state before and after, states plainly that recorded availability does not change
weekly capacity until the next Planning calculation version is active, and reports honest `PENDING`
recalculation. No calculation contract changes.

### 4.2 D3b2 — V3 capacity composition and rollout

Adds `PlanningCalculationInputV3`, `PlanSnapshotV3`, calculation contract `planning-calculation/3`,
`planner-engine/0.3.0`, `planning-policy/0.3`, the composition and rationing rules in §3, the
persisted clock-bound Planning proposal that a capacity-effect preview requires, and the same
expand-then-activate rollout D2c used. Historical V1 and V2 rows stay immutable and readable under
their own version tuples.

## 5. Contracts

- `AvailabilityWindowSourceV1` — actor-scoped, zero authority input, bounded to 60 active windows
  plus a bounded page of removed history, with the current Plan version fence and the three
  capabilities.
- `AvailabilityWindowPreviewV1` — deterministic clock-free preview with an exact digest.
- `AvailabilityWindowApplyResultV1` — applied result.

Command type `planning.change_availability_window_v1` with operations `create_availability_window`,
`change_availability_window`, and `remove_availability_window`.

The browser submits only an opaque window key (absent when creating), the proposed local dates,
minutes, optional energy and label, the exact expected Plan version, the exact expected window
version when changing or removing, a printable reason, a lowercase request UUID, and at apply time
the server-issued digest.

Blocking reasons:

- `AVAILABILITY_WINDOW_OVERLAPS_EXISTING`;
- `AVAILABILITY_WINDOW_LIMIT_REACHED`;
- `AVAILABILITY_WINDOW_ALREADY_REMOVED`;
- `PLANNING_CREATE_IDENTITY_COLLISION`.

Warnings:

- `AVAILABILITY_NOT_YET_APPLIED_TO_CAPACITY` while the workspace has no current V3 snapshot;
- `AVAILABILITY_WINDOW_IN_THE_PAST` when the window's last local day is already behind the
  workspace's current local date at write time.

## 6. Atomic owner command

The command follows the released Planning mutation protocol: session-resolved actor and workspace,
scalar validation, request hash, `(actor, command type, idempotency key)` serialization with exact
replay, the `planning-workspace` lock, locking the current Plan and every active window in stable
order, digest recomputation from locked state, one state change, one minimal
`planning.input_changed` event with change kind `AVAILABILITY_CHANGED`, one fixed
`planning.plan_snapshot_v1` delivery, and one completed receipt — all in one transaction.

Event payload:

```json
{
  "change_kind": "AVAILABILITY_CHANGED",
  "operation": "create_availability_window",
  "growth_plan_id": "<uuid>",
  "availability_window_id": "<uuid>",
  "availability_window_version": "<positive bigint string>"
}
```

It carries no label, reason, dates, minutes, or any other body.

## 7. Required proof

- valid, boundary, invalid, and malicious source, preview, apply, and event contracts;
- create, change, and remove against active and paused current Plans;
- refusal of an overlap, an adjacent-but-overlapping edit, a stale Plan or window version, a changed
  digest, a removed window, a past-only range, an over-long range, an out-of-range minute value, the
  61st active window, and a malformed selector;
- the database exclusion constraint refuses an overlapping row even when application code is
  bypassed;
- same-key replay, changed-request conflict, injected-failure rollback, and serialization against
  the released Plan and Track commands;
- two-workspace positive and cross-workspace negative forced-RLS isolation;
- D3b2 additionally: composition and rationing golden fixtures, V1/V2/V3 routing, activation, and an
  unchanged historical result;
- `/plan` keyboard, responsive, reduced-motion, forced-colors, and accessibility behavior;
- the repository gates proportionate to the change before merge.

## 8. Deferred

Deferred: intra-day availability, energy-aware ranking, Campaign persistence and overlays, the
cross-owner coordinator, and any automatic merging or splitting of windows.
