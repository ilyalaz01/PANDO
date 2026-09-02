# Planning calculation contracts v2

`planning-input.schema.json` is the D2c successor to `PlanningCalculationInputV1`. It preserves the
V1 bounded owner-query shape and adds two required integers to every Track:
`cadencePerWeek` (`0..100`) and `completedCadenceSessionsThisWeek` (`0..500`). It requires
`planning-completed-work/0.2`; V1 inputs remain valid only against the unchanged V1 schema.

`plan-snapshot.schema.json` is the immutable output of `planner-engine/0.2.0` with
`planning-policy/0.2`. It preserves the V1 result shape and adds `TRACK_CADENCE_DEFICIT` to the
score-factor and Track-reason vocabularies. The factor is additive and soft: it does not change
eligibility, capacity, mandatory Review, or campaign deadline rules.

The schemas are intentionally separate from V1 so stored historical inputs and snapshots are
validated by their recorded calculation-contract, engine, and policy tuple. Mixed tuples fail
closed and no V1 JSON is relabeled or rewritten.
