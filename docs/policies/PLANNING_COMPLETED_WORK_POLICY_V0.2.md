# Planning Completed Work Policy v0.2

Status: Accepted deterministic D2c successor

Policy version: `planning-completed-work/0.2`

Consumed by: `planner-engine/0.2.0` under
[Planning Policy v0.2](PLANNING_POLICY_V0.2.md)

Predecessor: [Planning Completed Work Policy v0.1](PLANNING_COMPLETED_WORK_POLICY_V0.1.md)

## 1. Unchanged rules

Every v0.1 source boundary, claim clock, 168-hour repetition window, 500-session refusal bound,
session tier, counted-duration rule, capacity total, meaningful-minute assignment, repetition
calculation, snapshot-validity cutoff, owner fence, and fail-closed code remains unchanged.

V0.2 does not reinterpret historical V1 input. It adds one derived frequency count needed only by
`PlanningCalculationInputV2`.

## 2. Weekly cadence count

For every Track in the current Growth Plan,
`completedCadenceSessionsThisWeek` is the number of terminal sessions that satisfy all of these
conditions:

- state is `COMPLETED` and the Evidence attempt is terminal;
- a normalized, non-invalidated Evidence observation exists at the attempt claim clock;
- the terminal `endedAt` lies in the half-open current Planning week `[weekStart, weekEnd)` and is
  not after `claimAsOf`;
- the session's activity has the one immutable current-Plan Track attribution released by Planning.

Each qualifying Focus session contributes exactly one to exactly one Track. Completion-only,
stopped, open, invalidated, prior-week, and unattributed sessions contribute zero. A qualifying
session shorter than one whole counted minute still contributes one session: cadence measures
evidence-bearing frequency, while counted minutes independently protect capacity from inflated
wall-clock claims.

The value is not clamped to `cadencePerWeek`; progress above the target remains reproducible. The
existing source bound proves the per-Track count is in `0..500`. More than 500 terminal source rows
still refuses the entire calculation with `COMPLETED_WORK_SOURCE_BOUND`; rows are never truncated.

## 3. Attribution stability

Released Planning commands admit an activity once and do not move or remove that attribution, so
current attribution is stable for the historical sessions used here. A future reassignment or
removal feature must introduce an immutable historical-attribution source or a new explicit
reclassification policy before changing this rule.

## 4. Change control

Changing cadence eligibility, the week boundary, attribution, or count semantics requires another
`planning-completed-work` version and new fixtures. V1 normalized inputs and snapshots keep v0.1;
they are never rewritten or relabeled.
