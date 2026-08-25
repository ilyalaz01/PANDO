# UI

Repository-owned design tokens, accessible primitives, and UI projections live here. UI code may
call module application interfaces, but it never becomes authoritative domain state.
`explore/` is the client projection boundary for GraphProjectionV1. The server composer validates,
maps, and lays out a read-only payload. Map and Outline share temporary selection but keep separate
roving focus constrained to each server-projected view. The representative adapter currently reads
the explicit Phase 0 fixture, not production module queries.

The mobile fallback currently hides, but does not lazy-load, the React Flow renderer. A viewport-only
client split is deferred until SSR/hydration behavior and the separate mobile bundle can be measured.
