# Planning Policy v0.1

Status: Accepted initial deterministic policy
Engine: `planner-engine/0.1.0`
Policy version: `planning-policy/0.1`

## 1. Purpose

This policy ranks already-authorized candidate activities for Today. It does not establish
evidence, Mastery, readiness, target requirements, or user availability. Its coefficients are
transparent initial product assumptions, not statistically calibrated claims.

## 2. Eligibility

A candidate is eligible only when:

- its activity is active and has an exact Focus-compatible readiness-goal/activity pair;
- every target-backed track/campaign source has the exact current readiness goal/profile input; a
  due Review may remain during rebuild/stale/error but not for an inactive goal;
- it has an active track, campaign, or due Review source after that fail-closed filtering;
- prerequisites are not `BLOCKED`;
- its estimated duration is at most remaining weekly capacity and any explicit session limit;
- remaining weekly capacity and any explicit session limit are greater than zero.

At most 100 Review-backed candidates may enter one calculation. Each references a different
ReviewItem, and candidate counts in each urgency bucket cannot exceed the current owner summary.
Campaign deadlines are bounded to 36,500 derived days so every valid input remains representable by
the output contract.

A paused Growth Plan contributes no track source. Review urgency remains independent. Unknown
prerequisites remain eligible with a visible penalty and warning.

Capacity still required to meet active protected track minima is reserved before unrelated work is
eligible. A candidate has at most one track and can use only the flexible remainder plus that
track's own unmet minimum. Campaigns therefore override flexible capacity, never protected base
cadence.

Energy fit points apply only when both an explicit user preference and owner-persisted candidate
energy are present. Either null is Unknown and contributes neither reward nor penalty. Candidate
duration comes from Planning-owned activity metadata or the explicit Review policy source; an
adapter may not infer it from the title or evidence.

## 3. Score factors

| Factor | Points |
| --- | ---: |
| failed mandatory floor | +500 |
| unknown mandatory floor | +450 |
| known target shortfall | +350 |
| unknown target requirement | +250 |
| overdue Review | +450 |
| due-today Review | +350 |
| protected track minimum currently unmet | +200 |
| active campaign source | +250 |
| campaign deadline within 7 / 21 / 42 days | +300 / +200 / +100 |
| track priority | +0 through +100 |
| prerequisite unlock value | +20 each, capped at +100 |
| exact energy fit | +75 |
| candidate below available energy | +25 |
| unknown prerequisites | -150 |
| candidate above available energy | -200 |
| recent repetition | -75 each, capped at -225 |

Only the strongest matching target-gap factor is used for one candidate. Each candidate references
at most one track, whose priority and protected-minimum deficit can each contribute once. An unknown
mandatory floor produces `VERIFY_MANDATORY_REQUIREMENT`, never wording that claims a confirmed
blocker.

## 4. Stable order and output

Candidates are ordered by total integer score descending, estimated minutes ascending, and stable
candidate key ascending. The first candidate is the Next Best Action. At most the next four are
alternatives. Fewer valid candidates produce fewer actions; the engine never fabricates variety.

Every action stores all non-zero score factors in code-point factor-code order, the total score,
exact Focus identifiers, optional single-track attribution, duration provenance, nullable energy,
code-point ordered source signals, expected-benefit code, deterministic explanation, and bounded
causal references for target gaps, Review items, tracks, campaigns, or active Focus. An eligible
zero-score candidate therefore has an empty factor/reference list rather than a fabricated
zero-point factor.

Snapshot validity is inclusive and may not cross a clock-derived ranking change. The adapter caps
it before the exclusive workspace-week boundary, at each current readiness/Review validity cutoff,
at a due-today Review transition, and before the next derived Campaign day-count transition. A
snapshot is refreshed one millisecond after its inclusive `validUntil`.

## 5. Change control

A coefficient or eligibility change creates a new policy version and golden fixture. Existing
snapshots retain their original engine/policy versions. A replacement policy is compared on
representative fixtures before its current pointer is activated.
