# ADR-0004 — Graph layout and query boundary

Status: Accepted  
Date: 2026-08-25  
Owner: PANDO product owner

## Context

The Map is a desktop-first view of a canonical competency DAG projected through a selected roadmap or target profile. The MVP fixture is approximately 15 to 25 nodes, but the architecture must keep semantic meaning, layout, accessibility, and user overlay separate.

## Decision

- Render the interactive graph with @xyflow/react.
- Use @dagrejs/dagre for the initial deterministic layered layout.
- The server owns GraphProjectionV1: selected version identifiers, node and edge semantics, requirement rules, statuses, explanations, visibility hints, and layout version.
- The client owns viewport, selection, filters, focus, semantic zoom level, and temporary interaction state.
- Sort nodes and edges by stable identifiers before layout. Use fixed dimensions and spacing tokens. Cache layout by structural fingerprint.
- Recompute canonical layout only when structure or the layout algorithm version changes. Evidence, mastery, readiness, or review state changes must not move nodes.
- Store optional user position overrides in the workspace overlay. A reset returns to the current deterministic canonical layout.
- Use a flat projection per detail level. Do not use Dagre compound subflows with external edges.
- Send the complete target graph in MVP and render the semantic visible subset. Fetch inspector detail separately.
- Outline is a first-class accessible representation of the same projection, not a fallback generated from DOM order.

Initial scale and response budgets:

- representative graph: 25 nodes;
- stress fixture: 500 total nodes, at most 150 rendered nodes and 300 rendered edges;
- compressed projection payload at most 150 KB for the representative graph;
- projection plus layout p95 at most 250 ms;
- pan and zoom frame p95 at most 32 ms, with no main-thread task above 100 ms.

Introduce server-side expansion or pagination when a real target exceeds 500 total nodes or a compressed projection exceeds 250 KB.

## Alternatives considered

- ELK: more capable for compound and advanced constraint layouts, but larger and more complex than the current graph requires.
- Force-directed simulation: rejected because spatial stability is a product invariant.
- Layout entirely in the browser: rejected because results, caching, exports, and tests would vary by client.
- Graph database: rejected because Postgres adjacency and recursive queries are sufficient for the bounded DAG.

## Consequences

- Dagre is intentionally a simple first algorithm. The projection contract is independent of the renderer and layout implementation.
- Layout fixtures become golden artifacts keyed by layout version and structural fingerprint.
- State updates can stream or refresh without causing spatial churn.

## Security and privacy

GraphProjectionV1 is workspace-filtered before serialization. It must not expose private nodes, hidden imported proposals, free-form evidence, or another workspace's layout overrides. Inspector queries repeat authorization and do not trust a node identifier from the client.

## Migration and rollback

If representative fixtures prove Dagre cannot meet crossing, stability, or grouping acceptance criteria, create a superseding ADR and add an ELK layout version. Preserve previous cached coordinates and user overrides so rollback does not destroy spatial state.
