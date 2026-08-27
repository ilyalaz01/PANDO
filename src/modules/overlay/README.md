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

## Implemented competency-inspector boundary

The ordinary UI loads `CompetencyOverlayDetailV1` through
`api.get_current_competency_overlay_v1(readinessGoalKey, competencyRef)`. The API first composes the
Targets-owned authorized target context and accepts only competencies in that exact target closure.
Only then does the Overlay owner query load the note, active custom activities, and current overlay
version. Neither the browser nor the public RPC can choose a workspace or Target Profile.

`api.save_current_overlay_note_v1` and `api.add_current_custom_activity_v1` use the same scoped
selector. Their private implementations repeat session and membership checks, require an expected
overlay version and retry-stable idempotency key, and atomically commit the Overlay row, command
receipt, and outbox event. A stale version preserves the browser draft and requires an explicit
retry after the detail is refreshed. Empty notes do not imply deletion; deletion needs a separate
lifecycle command.

The current custom-activity command receives the already authorized immutable profile identity
from the API composer and reads no private Targets or Catalog object. The retired caller-selected
workspace/profile transports and their cross-context implementation are absent. The three scoped
API coordinators are pinned `SECURITY DEFINER` functions owned by the `NOLOGIN/NOBYPASSRLS`
Phase 1 role; authenticated callers cannot execute their Overlay bridges directly. JWT-backed
membership and forced RLS therefore remain in force while caller-selected profile identities
cannot bypass the exact target-closure check.
