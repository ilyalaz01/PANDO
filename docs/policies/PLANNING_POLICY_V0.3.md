# Planning Policy v0.3

Status: Accepted D3b2 deterministic policy

Engine: `planner-engine/0.3.0`

Policy version: `planning-policy/0.3`

Predecessor: [Planning Policy v0.2](PLANNING_POLICY_V0.2.md)

Decision record:
[ADR-0010](../adr/0010-lifecycle-replacement-availability-and-campaign-semantics.md) §6, §8

Completed-work input: [Planning Completed Work Policy v0.2](PLANNING_COMPLETED_WORK_POLICY_V0.2.md)
(unchanged — D3b adds no completed-work rule).

## 1. Preserved behavior

V0.3 preserves every v0.2 eligibility, scoring, cadence, mandatory Review, readiness, campaign,
energy, prerequisite, repetition, stable-order, validity, and maximum-action rule unchanged. It
adds no scoring coefficient: capacity composition and protected-minimum rationing change *how much
capacity exists*, not *how a candidate is scored*.

The calculation input and result use the separate `PlanningCalculationInputV3` and `PlanSnapshotV3`
contracts. Historical V1 and V2 calculations continue to use their exact engine/policy pairs.

## 2. Capacity composition

`GrowthPlanInputV3` replaces the single `weeklyCapacityMinutes` with `defaultWeeklyCapacityMinutes`
(the sustained default, unchanged meaning from V1/V2's field), `effectiveWeeklyCapacityMinutes`, and
an ordered seven-entry `dailyCaps` array covering the plan week's local days `d1..d7`. Per
[ADR-0010](../adr/0010-lifecycle-replacement-availability-and-campaign-semantics.md) §6:

```text
dayCap(d)                      = available_minutes of the active window covering d, else 1440
effectiveWeeklyCapacityMinutes = min(defaultWeeklyCapacityMinutes, sum(dayCap(d1..d7)))
remainingMinutesThisWeek       = max(effectiveWeeklyCapacityMinutes - consumedMinutesThisWeek, 0)
```

The engine never trusts the supplied `effectiveWeeklyCapacityMinutes` number: it re-derives it from
`defaultWeeklyCapacityMinutes` and the seven `dailyCaps.capMinutes` values and fails closed
(`INVALID_PLANNING_INPUT`) on any mismatch — the same "verify, don't trust the adapter" discipline
already used for prerequisite counts.

The hard invariant that active protected-minimum minutes may not exceed weekly capacity is checked
against `defaultWeeklyCapacityMinutes`, exactly as V1/V2 checked it against the single
`weeklyCapacityMinutes` field. It is **not** checked against the (possibly lower) effective
capacity: an availability-limited week is expected, non-blocking behavior, not corrupt input.

## 3. Protected-minimum rationing

When `effectiveWeeklyCapacityMinutes` falls below the sum of active protected minima, the engine
rations deterministically instead of refusing:

```text
ordered      = active Tracks sorted by (priority desc, trackKey asc)
poolRemaining = effectiveWeeklyCapacityMinutes
for each track in ordered:
  reservedMinutes = min(track.protectedMinimumMinutes, poolRemaining)
  poolRemaining  -= reservedMinutes
```

A track whose `reservedMinutes < protectedMinimumMinutes` contributes the snapshot warning code
`PROTECTED_MINIMUM_LIMITED_BY_AVAILABILITY` (added once, not per track). Nothing is fabricated and
no minimum is silently rewritten: `protectedMinimumMinutes` itself never changes, only how much of
it the current week's effective capacity can actually reserve.

Per-candidate admission reuses the released V1/V2 deficit/flexible split (remaining capacity minus
the sum of active tracks' still-outstanding protected minutes, each track's own candidate keeping
its own outstanding minutes as headroom), with two substitutions: the pool is
`effectiveWeeklyCapacityMinutes` instead of the default, and each track's protected-minute basis is
its **rationed** `reservedMinutes` instead of its raw `protectedMinimumMinutes`. When availability
does not limit a plan (`effectiveWeeklyCapacityMinutes === defaultWeeklyCapacityMinutes`), rationing
always reserves every active track's full minimum — because the write-time invariant in §2 already
guarantees the sum fits — so V3 admission is arithmetically identical to V2 admission in every
plan that availability does not limit.

The `TRACK_PROTECTED_MINIMUM` score factor keeps its released V1/V2 meaning
(`meaningfulMinutesThisWeek < protectedMinimumMinutes`, using the raw configured minimum): whether a
Track deserves priority for being behind is independent of whether this week's capacity can fully
honor it.

## 4. Change control

Changing the composition formula, the rationing order, the rationing pool, applicability, or the
warning trigger requires a new Planning policy/engine version and representative golden fixtures. A
V3 snapshot is valid only under the exact `planner-engine/0.3.0` plus `planning-policy/0.3` tuple.
