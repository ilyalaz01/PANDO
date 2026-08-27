# Review

Owns review scheduling, reasons, reminders, and deduplication.

## Implemented through Phase 3A

domain/calculate-review-item.ts is the pure review-engine/0.1.0 implementation governed by
[ADR-0006](../../../docs/adr/0006-calculation-and-review-engines.md) and
[Review Policy v0.1](../../../docs/policies/REVIEW_POLICY_V0.1.md).

The pure engine provides:

- versioned initial due rules for RETENTION_RISK, PERSONAL_REMINDER, GOAL_DEADLINE, and
  VERIFICATION_NEEDED;
- the table-driven Again/Hard/Good/Easy interval calculation, whole-day rounding, and 180-day cap;
- one active item per workspace/subject with every independently auditable active reason;
- earliest-active-reason due time and query-time Upcoming/Due/Overdue evaluation;
- exact event replay deduplication and order-independent validation of every source/revision group
  before latest-revision folding, including close and reopen after correction/invalidation;
- explicit asOf, engine/policy/watermark metadata, and no implicit time or external dependency.

The Review application and persistence slice now adds:

- a Mastery-owned qualifying-success query and fixed transactional-outbox delivery;
- append-only source/action ledgers, immutable calculation snapshots, typed current projections,
  FORCE RLS, workspace isolation, optimistic versions, and idempotent atomic commands;
- exact worker input reloading, per-workspace event ordering, authoritative completion validation,
  replay identities, retries, dead letters, recovery health, and optional Cron wake-up;
- personal reminders, reschedule, skip once, suppress, and restore without destructive history;
- a bounded `ReviewWorkspaceV1` query and accessible responsive `/review` UI with every current
  reason visible;
- a versioned privacy-minimized `ReviewEventV1` contract plus unit, contract, pgTAP, authenticated,
  responsive, keyboard, and automated accessibility coverage.

Day-based UI choices are converted from the Identity-owned workspace IANA time zone to one explicit
instant at the command boundary. Nonexistent and ambiguous DST-local times are rejected instead of
being silently normalized. The scheduler uses exact UTC durations after that conversion.

Not implemented here: goal-deadline Review reasons, substitute activity, grading/completion
responses, notifications, FSRS, Planning/Today consumption, or Agent Control exposure. Evidence
capture remains Evidence-owned and Focus remains Sessions-owned.
