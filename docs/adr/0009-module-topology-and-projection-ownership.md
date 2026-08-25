# ADR-0009 — Module topology and derived projection ownership

Status: Accepted
Date: 2026-08-25
Owner: PANDO product owner

## Context

The canonical Domain Model defines eleven bounded contexts, but the Phase 0 repository shape and
module skeleton listed only ten and omitted Agent Control. Derived outputs were described in several
documents without one explicit contract-owner map: target readiness, GraphProjectionV1,
AgentControlContextV1, Preparation Pack preview, and Today.

This made repository navigation unnecessarily expensive. The existing Graphify map grouped 54
top-level product, agent, and engineering nodes into one low-cohesion PANDO Product Architecture
community. A bounded query could find the documents, but Graphify explain showed the canonical
System Architecture node with only two direct relationships. This is evidence of missing explicit
navigation and ownership links, not evidence that the accepted bounded contexts should be split.

## Decision

- Preserve the eleven bounded contexts in the canonical Domain Model. Add the missing
  src/modules/agent-control boundary to the repository skeleton and Phase 0 shape.
- Record one implementation topology in
  [Module topology and reading routes](../design/MODULE_TOPOLOGY.md).
- Limit cross-context interaction to owning-module commands, bounded queries, versioned events, and
  read-only projection composition. Domain layers never import another context.
- A named application coordinator may call several public module interfaces for one atomic
  workflow. Coordination does not transfer ownership of authoritative facts.
- Assign derived contract ownership explicitly:
  - Mastery owns CompetencyState projections;
  - Targets owns target-specific readiness calculation policy and snapshots;
  - Review owns ReviewItem scheduling state;
  - Planning owns PlanSnapshot and Today explanations;
  - the server-side Explore composer owns GraphProjectionV1 assembly but no domain rows;
  - Agent Control owns AgentControlContextV1, ChangeSet, confirmation, revision, and coordination
    lifecycle but no goal, plan, evidence, or calculated truth;
  - Integrations owns Preparation Pack bytes, validation, preview, and import audit, while Targets,
    User Overlay, and Planning own the confirmed resulting state.
- Add task-oriented reading routes from the canonical index and AGENTS.md. Full canonical reading
  remains mandatory when product semantics, ownership, cross-context flows, or several routes may
  change.

## Alternatives considered

- Split the nine canonical documents by bounded context: rejected because it would duplicate
  product rules, weaken precedence, and turn navigation noise into normative fragmentation.
- Treat every projection as a new bounded context: rejected because rebuildable client contracts do
  not automatically own business truth.
- Put cross-context behavior in shared or a generic orchestration service: rejected because it
  hides workflow purpose and becomes an ownership dumping ground.
- Let Graphify communities define modules: rejected because Graphify is a regenerable orientation
  index, not architectural authority.

## Consequences

Implementation agents can identify the owner and decisive reading path before broad repository
searches. Agent Control receives the same visible module boundary as the other accepted contexts.
Preparation Pack activation now names Planning as the owner of accepted plan and track changes.

The system keeps a small number of purpose-specific cross-context coordinators. Review must reject a
coordinator that accumulates domain rules or bypasses owning commands.

## Security and privacy

The decision creates no new data exposure. Read projections repeat authorization and own no source
facts. Cross-context mutation still uses expected versions, idempotency, command receipts, RLS, and
transactional outbox behavior. Graphify remains excluded from live user state and authorization.

## Migration and rollback

This is an implementation clarification before the affected modules contain production behavior.
No data migration is required. If measured coupling later justifies moving a boundary, a
superseding ADR must name the new owner, event/query migration, compatibility window, and rollback
path. Removing the navigation map is safe but would restore the documented agent-orientation gap.
