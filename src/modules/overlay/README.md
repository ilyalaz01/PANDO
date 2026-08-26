# User Overlay

Owns workspace-scoped catalog deltas and personal content. The foundation reserves this boundary
only.

## Implemented required-node query

`overlay.get_explore_required_overlay_nodes_impl` repeats current membership authorization and
resolves only the accepted personal competencies directly referenced by one immutable Target
Profile. Missing or archived required content fails closed instead of silently weakening the
target. The DTO includes current overlay version and minimal node identity/title/domain fields; it
never exposes notes, provenance bodies, hidden drafts, evidence, or unrelated personal content.

The zero-workspace live Explore path additionally consumes accepted structural edges, the
explicitly selected activity, and goal-scoped position overrides. The server materializer filters
that broad owner DTO to the authorized target closure, correlates workspace and overlay revision,
and fails closed rather than exposing unrelated personal content.
