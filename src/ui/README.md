# UI

Repository-owned design tokens, accessible primitives, and UI projections live here. UI code may
call module application interfaces, but it never becomes authoritative domain state.
`explore/` is the client projection boundary shared by calculated `GraphProjectionV1` and the
pre-calculation `ExploreStructuralProjectionV1`. The production server route authenticates the
request, correlates live owner DTOs, lays out the bounded target closure, and maps a read-only
payload. Map and Outline share temporary selection but keep separate roving focus constrained to
each server-projected view. The representative Phase 0 adapter is reachable only through an
explicitly enabled test-only route; production failures never fall back to it.

The mobile fallback currently hides, but does not lazy-load, the React Flow renderer. A viewport-only
client split is deferred until SSR/hydration behavior and the separate mobile bundle can be measured.
