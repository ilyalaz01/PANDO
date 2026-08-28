# Planning Completed Work Policy v0.1

Status: Accepted initial deterministic input-normalization policy
Policy version: `planning-completed-work/0.1`
Consumed by: `planner-engine/0.1.0` under [Planning Policy v0.1](PLANNING_POLICY_V0.1.md)
Canonical authority: [Domain Model](../01_DOMAIN_MODEL.md) §4 and §9,
[Product Constitution](../00_PRODUCT_CONSTITUTION.md) P1/P5,
[Product and UX Specification](../02_PRODUCT_AND_UX_SPEC.md) §3

## 1. Purpose

This policy defines exactly how Planning converts Sessions and Evidence owner facts into the three
completed-work numbers of `PlanningCalculationInputV1`:

- `growthPlan.consumedMinutesThisWeek`;
- `growthPlan.tracks[].meaningfulMinutesThisWeek`;
- `candidates[].repetitionsInLast7Days` and its `repetitionWindowEndsAt` cutoff.

It establishes no evidence, Mastery, readiness, or target requirement. It never ranks a candidate.
It is an input-normalization rule owned by the Planning application adapter, not by the pure ranking
engine, and its version is carried in `completedWorkPolicyVersion` so a rule change always produces a
new canonical input fingerprint and a new snapshot.

## 2. Source boundary

Planning reads only two bounded owner queries and never another module's private tables:

| Fact | Owner query | Fence |
| --- | --- | --- |
| terminal Focus Sessions in the window, with `startedAt`, `endedAt`, `plannedMinutes`, and activity identity | `sessions.read_planning_completed_work_source_v1` | `FOCUS`/`completed-work` revision |
| per-session attempt terminality and whether a normalized, non-invalidated observation exists | `evidence.read_planning_completed_work_source_v1` | `EVIDENCE`/`workspace-ledger` revision from `evidence.subject_ledgers.ledger_version` |

Session lifecycle facts remain operational history and never enter the evidence ledger. Raw
observation bodies, competency references, outcomes, engagement, hints, and correction reasons are
never returned to Planning; Evidence returns only two booleans per session.

Both queries receive the attempt's single persisted `claimAsOf`. Every considered session satisfies
`endedAt <= claimAsOf`; a session that ends after the claim belongs to the next calculation, which
its own Planning delivery triggers.

## 3. Counting window

The **plan week** is the existing half-open workspace-local week `[weekStart, weekEnd)` resolved by
the Identity calendar owner utility.

The **repetition window** is the half-open elapsed interval `(claimAsOf − 168 hours, claimAsOf]`.
It is expressed as 168 elapsed hours, never as "seven calendar days", so a daylight-saving
transition cannot change its length.

The owner query window is `[least(weekStart, claimAsOf − 168 hours), claimAsOf]`. More than 500
terminal sessions in that window is refused rather than truncated.

## 4. Session tiers

Each terminal Focus Session is classified once:

| Tier | Condition |
| --- | --- |
| `COMPLETED` | session state is `completed` and its Evidence attempt is terminal |
| `EVIDENCE_BEARING` | `COMPLETED` and the attempt produced a normalized observation that has not been invalidated |
| neither | session state is `stopped` |

A `stopped` session is abandoned work: it consumes no capacity, earns no cadence credit, and is not
a repetition. A `COMPLETION_ONLY` result is completed work but not competency evidence, exactly as
the Domain Model requires: it consumes capacity and counts as repetition, and it does not satisfy a
protected track minimum.

## 5. Counted duration

For one terminal session the counted duration is:

```text
countedMinutes = min(
  floor( (endedAt − max(startedAt, weekStart)) / 60 seconds ),
  plannedMinutes
)
```

Three deliberate properties:

1. **Never planned-only.** Planned minutes are only an upper bound. A session shorter than planned
   contributes its observed length.
2. **Never unbounded wall clock.** A session left open contributes at most the minutes the user
   themselves planned for that activity, so an abandoned browser tab cannot claim a week of work.
3. **Never borrowed from another week.** Only the part of the session inside the current plan week
   consumes this week's capacity.

`floor` is used so no unearned minute is ever rounded up. A session shorter than one minute
contributes zero.

Because a workspace has at most one active Focus Session at a time, counted durations cannot
overlap, so `consumedMinutesThisWeek` is provably at most 10,080. Exceeding that is treated as an
unsupported history rather than published.

## 6. Assignment

- `consumedMinutesThisWeek` is the sum of counted durations of `COMPLETED` sessions that ended
  inside the plan week.
- A track's `meaningfulMinutesThisWeek` is the sum of counted durations of `EVIDENCE_BEARING`
  sessions that ended inside the plan week and whose activity is currently attributed to that track
  in the current Growth Plan. Work on an activity that is no longer admitted to a track still
  consumes plan capacity but earns no track cadence credit; this is the "per-track consumption where
  supported" boundary and it never fabricates an attribution.
- A candidate's `repetitionsInLast7Days` is the number of `COMPLETED` sessions for that candidate's
  exact activity inside the repetition window, clamped to the contract maximum of 50. The clamp only
  lowers a count; the ranking penalty already saturates at three repetitions.

Total track cadence credit is therefore never greater than consumed capacity.

## 7. Snapshot validity

A repetition leaves the window at a clock-derived instant, so the adapter caps the inclusive
snapshot `validUntil` at `oldestCountedRepetitionEndedAt + 168 hours − 1 millisecond`, alongside the
existing week, readiness, Review, and Campaign cutoffs. `repetitionWindowEndsAt` carries that
exclusive instant per candidate so the pure engine can verify the cap instead of trusting the
adapter. It is null exactly when the candidate has no counted repetition. When a count is clamped,
the oldest in-window repetition is still used, which can only refresh earlier than required.

## 8. Fail-closed states

The calculation refuses to publish, keeping the previous snapshot intact and Today visibly pending,
when the sources cannot be classified under this policy:

| Code | Condition |
| --- | --- |
| `UNSUPPORTED_MEANINGFUL_WORK_HISTORY` | a terminal session has no Evidence answer, its attempt is not terminal, a `stopped` session reports evidence, a session lies outside the claim-scoped window, the window does not cover the policy horizon, the derived consumed total exceeds one week, or track credit exceeds consumed capacity |
| `COMPLETED_WORK_SOURCE_BOUND` | the window holds more than 500 terminal sessions |
| `MISSING_SESSION_SOURCE` | Evidence answered about a Focus session Sessions did not return |
| `OWNER_FENCE_CONFLICT` | either owner repeats a Focus session |

No number is invented for any of these states. This replaces the earlier blanket refusal of every
workspace that had terminal sessions in the current week; only genuinely ambiguous history now fails
closed.

## 9. Known limits

- Duration is bounded by the user's own planned minutes, which is a self-reported bound, not a
  measured attention signal. Only replace it with a reviewed successor policy.
- `EVIDENCE_BEARING` currently means "a normalized observation exists and was not invalidated". It
  does not yet weigh outcome, engagement, independence, or source reliability.
- Repetition counts sessions, not distinct calendar days.

## 10. Change control

A change to any tier, duration rule, window, assignment, or fail-closed condition creates a new
`planning-completed-work` version and new fixtures. Existing snapshots retain the version recorded in
their persisted normalized input. `planner-engine/0.1.0` and `planning-policy/0.1` are unchanged by
this policy because no coefficient or eligibility rule moves.
