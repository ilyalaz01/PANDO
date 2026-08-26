# ExploreStructuralProjectionV1 contract

`ExploreStructuralProjectionV1` is the strict server-internal Map and Outline response for a
selected persisted target before Mastery states and a Targets-owned readiness result exist. It
advances the Phase 1 Explore acceptance path without fabricating Phase 2/3 calculation truth.

The marker is:

```json
{ "name": "ExploreStructuralProjectionV1", "version": "1.0.0" }
```

The root `calculationAvailability` is always `NOT_MATERIALIZED`. Nodes contain either
`NOT_REQUIRED` or `REQUIRED_UNEVALUATED` with the exact requirement-rule definitions that refer to
the node. The contract has no mastery level, estimate, evidence date, confidence, attainment,
floor result, blocker result, readiness status, score, or domain readiness value. UI consumers
must explain that calculations are not materialized; they must not relabel this state as
competency `Unknown`.

`selectedVersions.catalogVersionKey`, `roadmapVersionKey`, and `targetProfileVersionKey` preserve
the stable owner keys supplied by `ExploreSourceV1`/`ExploreTargetContextV1`; they are deliberately
not named or represented as database UUIDs. `requirements.targetProfileVersionKey` repeats the
same stable target key for correlation.

## Ownership and security

The server-side Explore composer owns this read-only response and no authoritative rows. It
correlates the authenticated `ExploreSourceV1` and `ExploreTargetContextV1` owner DTOs, emits only
the bounded target closure and explicitly selected activity, and fails closed on scope or version
disagreement. It never substitutes a representative fixture after a live failure.

- `workspaceScope.workspaceId` is the authenticated workspace UUID; `overlayRevision` preserves
  the exact non-negative bigint string supplied by User Overlay.
- Every overlay node, edge, and position override must match that workspace and revision and must
  be accepted. An edge involving personal content is overlay-owned.
- Every canonical node and edge origin, plus each canonical entity version, must match the selected
  immutable Catalog version; overlay entities cannot claim a canonical entity version.
- Notes, evidence, provider payloads, hidden proposals, calculation guesses, client viewport,
  selection, query, filters, focus, and drag state are rejected by strict
  `additionalProperties: false` boundaries.
- The projection is not `GraphProjectionV1`, does not supersede ADR-0004, and does not weaken the
  complete calculated contract.

## Deterministic semantic invariants

JSON Schema validates shape. `validateExploreStructuralProjectionSemantics` additionally enforces:

1. Stable node, edge, layout-position, rule, and Outline IDs are unique and unsigned-ASCII sorted.
   Requirement members, rule-ID lists, visibility-ID lists, Outline roots, and child lists are
   sorted by their referenced stable ID.
2. Every edge endpoint resolves. `PREREQUISITE_OF` connects competencies and remains acyclic;
   `ACTIVITY_EVIDENCES` connects an activity to a competency. Non-prerequisite edges do not become
   blockers.
3. Every requirement reference resolves to a rule or a projected competency/domain. The rule graph
   is rooted, reachable, and acyclic; `K_OF_N` is bounded by member count and weighted members have
   positive finite schema-bounded weights.
4. Node `requirementState` is derived only from definitions: referenced nodes expose exactly their
   sorted rule IDs as `REQUIRED_UNEVALUATED`; all others are `NOT_REQUIRED`.
5. Layout positions and Outline items each form a bijection with nodes. Outline roots,
   parent/child back-references, depths, labels, keyboard order, and projection ID agree.
6. Visibility counts and flags agree exactly; a visible edge has two visible endpoints and the
   150-node/300-edge render caps remain explicit.
7. Workspace overlay origins and overrides match root scope. Canonical layout entries have equal
   canonical/effective points; personal positioning changes only the effective point.

## Structural fingerprint

`structuralFingerprint` is lowercase SHA-256 over the UTF-8 bytes of one minified JSON array:

```text
["ExploreStructuralProjectionV1Structure", 1, algorithmVersion,
 width, height, rankSpacing, nodeSpacing, nodeTuples, edgeTuples]
```

Each node tuple is `[nodeId, nodeType, domainNodeId]`; each edge tuple is
`[edgeId, edgeType, sourceNodeId, targetNodeId]`. Tuple arrays are ASCII-sorted by their first
element. All hashed strings use the schema's ASCII identifier grammar. Requirement definitions,
titles, visibility, accessibility text, origins, overlay revisions, and both canonical/effective
coordinates are excluded, so calculation-free metadata refreshes and personal position overrides
do not cause spatial churn.

Any new required field, calculation claim, ownership change, or semantic-invariant change requires
an intentional new contract version and consumer migration.
