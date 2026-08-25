# Review

Owns review scheduling, reasons, reminders, and deduplication.

## Implemented Phase 0 domain core

domain/calculate-review-item.ts is the pure review-engine/0.1.0 implementation governed by
[ADR-0006](../../../docs/adr/0006-calculation-and-review-engines.md) and
[Review Policy v0.1](../../../docs/policies/REVIEW_POLICY_V0.1.md).

The engine provides:

- versioned initial due rules for RETENTION_RISK, PERSONAL_REMINDER, GOAL_DEADLINE, and
  VERIFICATION_NEEDED;
- the table-driven Again/Hard/Good/Easy interval calculation, whole-day rounding, and 180-day cap;
- one active item per workspace/subject with every independently auditable active reason;
- earliest-active-reason due time and query-time Upcoming/Due/Overdue evaluation;
- exact event replay deduplication and latest source-revision folding, including close and reopen
  after correction/invalidation;
- explicit asOf, engine/policy/watermark metadata, and no implicit time or external dependency.

Day-based UI choices must already be converted from the workspace IANA time zone to an explicit
instant at the command boundary. The scheduler uses exact UTC durations after that conversion.

Not implemented here: append-only action persistence/folding for reschedule, skip, suppress,
restore, substitute, or complete; evidence capture; queue storage; outbox consumers; UI; or any
FSRS behavior.
