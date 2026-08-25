# PANDO — Review Policy v0.1

Status: Accepted for MVP fixtures  
Date: 2026-08-25  
Owner: PANDO product owner

## 1. Model

A ReviewItem is unique per workspace and review subject while active. It contains one or more independently auditable ReviewReasons. A reason source is unique so replay cannot duplicate it.

The effective due instant is the earliest active reason due instant. Due and overdue are evaluated at query time; no midnight status mutation or daily materialization job is required.

All instants are stored in UTC. Day-based choices are interpreted using the workspace IANA time zone and converted once.

## 2. Reasons

- RETENTION_RISK: deterministic interval scheduling for Recall.
- PERSONAL_REMINDER: explicit user choice.
- GOAL_DEADLINE: deadline pressure from a readiness goal or campaign.
- VERIFICATION_NEEDED: a qualifying first success needs independent or delayed reproduction.

Removing one reason does not remove the item while another active reason remains.

## 3. Initial due rules

- VERIFICATION_NEEDED: 3 days after the qualifying completion.
- RETENTION_RISK after first successful evidence: 3 days.
- PERSONAL_REMINDER: user-selected instant.
- GOAL_DEADLINE: policy proposes an instant, but never later than 7 days before the deadline and never overwrites another earlier reason.

## 4. Review response intervals

The previous interval is the duration used by the most recent completed review for this subject. If absent, use 3 days.

| Response | Next interval |
|---|---|
| Again | 1 day |
| Hard | maximum of 2 days and previous interval times 1.2 |
| Good | maximum of 3 days and previous interval times 2.0 |
| Easy | maximum of 7 days and previous interval times 3.0 |

Round to the nearest whole day and cap at 180 days. A failed review can also create contradicting evidence; the evidence engine, not the scheduler, decides mastery impact.

## 5. Actions

Every action is append-only:

- Start now opens the reusable Focus lifecycle.
- Reschedule changes the selected reason and records old and new instants.
- Skip once postpones only the current occurrence by 1 day.
- Suppress future recommendations disables the selected reason until explicitly restored.
- Substitute links the chosen activity but preserves the review subject and reasons.
- Mark completed elsewhere opens evidence capture; it cannot directly mark the review complete.

Completing qualifying evidence resolves the current occurrence, recalculates reasons, and schedules the next one.

## 6. Deduplication and corrections

Events may arrive late or be replayed. The scheduler rebuilds from authoritative evidence and append-only actions using event and action identifiers. Duplicate input produces no additional item or reason. Evidence correction or invalidation can reopen a reason and must preserve audit history.

## 7. Change rule

Do not introduce FSRS or tune intervals from intuition. Revisit after at least 100 completed review actions with timestamped responses. A new scheduler creates a new policy version and is compared on deterministic historical replay before activation.
