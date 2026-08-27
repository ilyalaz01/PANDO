# Phase 3A Review Core status

Status: implemented and release-gated
Owner: Review bounded context
Design: [Phase 3A Review Core](../design/PHASE_3A_REVIEW_CORE.md)

This supporting record describes the implemented Phase 3A slice. The nine canonical documents and
accepted ADRs remain authoritative.

## Delivered

- Mastery qualifying-success signal → fixed Review outbox delivery → deterministic Review fold;
- one structured Review subject per competency/dimension and one current item per subject;
- retention-risk, verification-needed, and personal-reminder reason lifecycles;
- idempotent reschedule, skip-once, suppress, and restore commands with immutable history;
- Identity-owned workspace time zone conversion with gap/fold rejection for user-entered instants
  and deterministic 23/25-hour calendar-day resolution for system-computed skip-once actions;
- exact authoritative worker completion, ordered workspace processing, stale-wake coalescing,
  immutable snapshots, typed current rows, privacy-minimized events, recovery and health;
- authenticated bounded queue query and responsive accessible `/review` UI;
- Review event schema/fixtures, domain/application tests, database invariants, authenticated browser
  journey, accessibility checks, and generated Supabase API contract.

## Deliberate non-scope

Phase 3A does not claim target-readiness calculation, goal-deadline reasons, review grading,
substitution, notifications, Planning/Today, Agent Control, FSRS, or live PyPrep integration. Those
remain later owner-scoped phases.
