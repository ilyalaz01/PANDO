# Agent Control

Owns minimized control read models, PlanChangeSet proposal/confirmation lifecycle, PlanRevision audit,
and the purpose-specific ApplyPlanChangeSet coordinator. It owns no goals, plans, tracks, evidence,
mastery, readiness truth, reviews, or external conversation transcript.

Its application layer queries authorized interfaces from Targets, Planning, Review, and related read
projections, then delegates every confirmed operation to the module that owns the affected aggregate.
The coordinator enforces exact-preview confirmation, expected versions, base watermark, idempotency,
atomic rollback, and transactional outbox behavior.

Canonical semantics are in the Domain Model Agent Control contract. The accepted transport and
security decision is ADR-0008; detailed contracts are in docs/design/AGENT_CONTROL_PLANE.md and
schemas/agent-control/v1/.

The owner-command sequence and unresolved multi-aggregate contract requirements are fixed in
`docs/design/PHASE_4B_LIFECYCLE_COMMANDS.md`. In particular, the current internal
`PlanChangeSetV1` single aggregate/version pair is not sufficient for multi-owner apply. Agent
Control transport must wait for the versioned precondition-vector contract and ordinary owner
commands; it must not work around that gap with direct table access.
