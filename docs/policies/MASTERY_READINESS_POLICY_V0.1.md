# PANDO — Mastery and Readiness Policy v0.1

Status: Accepted for MVP fixtures  
Date: 2026-08-25  
Owner: PANDO product owner

This policy is transparent and provisional. It is not a scientific or hiring-outcome model.

## 1. Qualifying evidence

Evidence participates in an achievement transition when it:

- is normalized, mapped to the competency and objective dimension, and not invalidated;
- has mapping confidence at least 0.75;
- has source reliability at least 0.60;
- represents an observed result rather than an activity start or raw provider event.

Passive consumption can support Knowledge completion but cannot by itself establish VERIFIED or MASTERED. SelfConfidence is never objective evidence.

## 2. Achievement levels

- NOT_STARTED: no qualifying successful evidence has raised the level.
- COMPLETED: at least one qualifying successful event.
- VERIFIED: COMPLETED plus a second successful event from a distinct attempt that is independent or occurs at least 24 hours later.
- MASTERED: at least three qualifying successful events across at least three UTC dates and a span of at least 72 hours, including at least one target-relevant Application or InterviewExecution event.

Invalidation or correction triggers full recalculation. Historical achievement can remain visible while current estimate becomes stale.

## 3. Dimension condition and confidence

With no relevant evidence, the dimension value is Unknown. A reliable mapped failure makes the dimension known Weak without raising achievement.

Freshness windows:

| Dimension | Fresh for |
|---|---:|
| Knowledge | 90 days |
| Recall | 30 days |
| Application | 60 days |
| InterviewExecution | 45 days |

The dimension is Stale when its latest meaningful evidence is older than its window.

Confidence:

- Low: one attempt or source, only guided/passive evidence, or unresolved contradiction;
- Medium: at least two distinct attempts with at least one independent event;
- High: at least three attempts across at least three days, at least two independent events, and no unresolved contradiction.

Stale lowers confidence by one category, with Low remaining Low.

## 4. Readiness attainment

Achievement strength:

| Current state | Fresh strength | Stale strength |
|---|---:|---:|
| known NOT_STARTED | 0.00 | 0.00 |
| COMPLETED | 0.50 | 0.40 |
| VERIFIED | 0.75 | 0.60 |
| MASTERED | 1.00 | 0.80 |

Required strength is 0.50 for COMPLETED, 0.75 for VERIFIED, and 1.00 for MASTERED.

For a known leaf requirement:

    attainment = minimum of 1 and current strength divided by required strength

For an Unknown leaf, attainment is the interval 0 to 1. It is never substituted with zero.

For weighted requirements:

    lower = known weighted attainment divided by total weight
    upper = known weighted attainment plus unknown weight, divided by total weight
    coverage = known weight divided by total weight

ALL, ANY, and K_OF_N evaluate their child rules explicitly. WEIGHTED_THRESHOLD uses the interval. MANDATORY_FLOOR is evaluated before the aggregate.

## 5. Status

- Not ready: any known mandatory floor is below its requirement, or all requirements are known and the upper bound is below the profile threshold.
- Insufficient evidence: any mandatory floor is Unknown or weighted coverage is below 0.70.
- Ready: every mandatory floor is met, coverage is at least 0.70, and the lower bound meets the target profile threshold.
- Developing: no mandatory floor fails, coverage is at least 0.70, but the lower bound is below the threshold.

Default target profile threshold is 0.80 unless the versioned profile specifies another value.

Display the range when lower and upper differ. A single approximate score may be displayed only when coverage is at least 0.70, and it must remain labeled readiness, never offer probability.

Readiness confidence:

- Low when coverage is below 0.70 or any mandatory floor is Unknown;
- Medium when coverage is at least 0.70 but below 0.90, or any required state has Low confidence;
- High when coverage is at least 0.90, all floors are known, and every mandatory requirement has Medium or High confidence.

## 6. Review trigger

Create or refresh VERIFICATION_NEEDED when a required competency is COMPLETED but not VERIFIED. Create or refresh RETENTION_RISK when a required objective dimension becomes stale or its next review becomes due.

## 7. Change rule

Review this policy after 100 completed review actions, 50 corrected evidence events, or the first outcome-analysis dataset, whichever comes first. Any coefficient or threshold change creates a new policy version and golden fixture comparison.
