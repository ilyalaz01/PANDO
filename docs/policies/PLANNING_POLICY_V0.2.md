# Planning Policy v0.2

Status: Accepted D2c deterministic policy

Engine: `planner-engine/0.2.0`

Policy version: `planning-policy/0.2`

Predecessor: [Planning Policy v0.1](PLANNING_POLICY_V0.1.md)

Completed-work input: [Planning Completed Work Policy v0.2](PLANNING_COMPLETED_WORK_POLICY_V0.2.md)

## 1. Preserved behavior

V0.2 preserves every v0.1 eligibility, capacity, protected-minimum, mandatory Review, readiness,
campaign, energy, prerequisite, repetition, stable-order, validity, and maximum-action rule. It
does not make a candidate eligible and does not reserve capacity.

The calculation input and result use the separate `PlanningCalculationInputV2` and
`PlanSnapshotV2` contracts. Historical V1 calculations continue to use the exact
`planner-engine/0.1.0` plus `planning-policy/0.1` pair.

## 2. Cadence factor

For an eligible candidate with an active Growth Plan Track:

```text
cadenceDeficit = max(cadencePerWeek - completedCadenceSessionsThisWeek, 0)
```

The additive factor is:

| Factor | Points |
| --- | ---: |
| `TRACK_CADENCE_DEFICIT`, deficit `0` | none |
| `TRACK_CADENCE_DEFICIT`, deficit `1` | +75 |
| `TRACK_CADENCE_DEFICIT`, deficit `2+` | +150 |

The factor is emitted at most once per candidate and receives the same bounded Track reason
reference as priority and protected minimum. It is evaluated only after existing hard eligibility
and capacity checks. Final ordering remains total integer score descending, estimated minutes
ascending, then candidate key ascending.

`PROTECT_TRACK_CADENCE` remains the expected-benefit code when the strongest applicable reason is
Track-level recovery. Its deterministic text distinguishes a hard protected-minute deficit, a soft
weekly session deficit, or both. Stronger target and Review expected-benefit precedence remains
unchanged even when the cadence factor also contributes to total score.

## 3. Change control

Changing either cadence coefficient, deficit threshold, applicability, precedence, or explanation
semantics requires a new Planning policy/engine version and representative golden fixtures. A V2
snapshot is valid only under the exact `planner-engine/0.2.0` plus `planning-policy/0.2` tuple.
