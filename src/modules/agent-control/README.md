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
