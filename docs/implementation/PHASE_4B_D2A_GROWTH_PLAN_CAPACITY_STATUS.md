# Phase 4B D2a Growth Plan weekly-capacity status

Status: complete

Design: [D2a Growth Plan weekly-capacity control](../design/PHASE_4B_D2A_GROWTH_PLAN_CAPACITY.md)

Completed: 2026-09-01

## Delivered outcome

A signed-in user can open `/plan`, enter a new default weekly capacity and reason, inspect an exact
before/after preview, and explicitly confirm the change. An in-range proposal below the summed
protected minimum of active Learning Tracks returns a typed blocked preview with the exact required
minimum and no apply control. Planning never clamps capacity or changes a Track silently.

Capacity remains editable while the current Growth Plan is active or paused. Paused, completed,
and archived Tracks do not contribute to the constraint, while active child Tracks still count when
the parent Plan is paused so resume cannot reveal an infeasible portfolio. Capacity below already
completed minutes is allowed because history remains immutable and the ordinary planner clamps
remaining capacity to zero.

## Owner boundary and atomic command

- D1's current-plan and lifecycle contracts remain unchanged. D2a adds separate
  `GrowthPlanCapacityPreviewV1` and `GrowthPlanCapacityApplyResultV1` contracts with strict valid,
  boundary, blocked, invalid, and malicious fixtures.
- Public preview/apply RPCs derive actor, personal workspace, current Plan, and Track constraints
  from the authenticated session. Browser input contains no workspace, Plan, or Track identity.
- The clock-free digest binds the Plan before/after state, reason, expected version, aggregate
  protected minimum, and a stable fingerprint of active Track IDs, versions, lifecycle, and minima.
  TypeScript and PostgreSQL share fixed SHA-256 oracle cases.
- Apply locks the actor/idempotency key, Planning workspace, current Plan, and every child Track in
  stable order; it recomputes the preview and rejects stale Plan or Track state.
- One transaction changes only weekly capacity, Plan aggregate version, and timestamp, then commits
  the completed receipt, one minimal `PLAN_CAPACITY_CHANGED` event, and one fixed
  `planning.plan_snapshot_v1` delivery. Same-key replay is byte-identical; changed requests,
  concurrent stale applies, and injected event failure leave no partial effect.
- The previously over-broad Agent Control V1 semantic validator now sums protected minima from
  active Tracks only, matching the canonical model and planner engine. No live Agent Control
  mutation path was added.

## Application and UI

- The server adapter validates scalar input and both structural and semantic response contracts,
  collapses database detail into safe invalid/conflict/unavailable states, and never accepts owner
  identifiers from form data.
- The `/plan` capacity form uses the D1 two-step discipline. A new preview dismisses any older
  lifecycle/capacity confirmation and rotates its idempotency key; retrying the exact apply keeps
  the same key.
- Applicable previews show capacity, protected total, flexible remainder, and aggregate version
  before/after. Blocked previews show the shortfall and an actionable minimum without exposing
  individual Track data.
- A stale apply disables confirmation and offers a current-plan reload. A successful apply refreshes
  `/plan` and `/today` and reports Planning as pending until the ordinary worker publishes a current
  snapshot.
- The interaction has keyboard, 320-pixel, touch-target, reduced-motion, forced-colors, and WCAG
  A/AA automation, plus a real signed-in 300-to-360-minute persistence check.

## Verification evidence

The final Windows release gates passed from a clean database rebuild after the last security
hardening change:

- `pnpm verify`: PASS — formatting, lint, Next.js type generation and TypeScript; 13 database-runner
  tests passed with 2 platform skips; 3 backup-archive tests; 320 contract tests; 3 representative
  performance tests; 767 unit tests; 87.92% statement and 80.85% branch coverage; production build;
  and 27/27 Chromium E2E tests including keyboard, 320-pixel responsive, reduced-motion,
  forced-colors, and automated WCAG A/AA checks.
- `pnpm verify:db`: PASS — all migrations applied from zero, 29 explicit pgTAP files and 2,089
  assertions passed, and database lint reported no warnings. The final review added bigint-safe SQL
  event validation and fail-closed row-count checks for the Plan mutation and completed receipt.
- `pnpm verify:auth`: PASS — the isolated real signed-in journey persisted the lifecycle operations
  and a weekly-capacity change from 300 to 360 minutes, advanced the Plan from aggregate version 3
  to 4, preserved refresh/reload behavior, and completed sign-out.
- `pnpm verify:backup`: PASS — the encrypted backup completed the clean-restore gate.

The checked-in Graphify index was not refreshed: neither the approved `graphify` executable nor its
pinned `uvx` runtime is available in this Windows environment. No replacement version, hook, remote
backend, or dependency was installed. `graphify-out/graph.json` therefore remains a stale developer
index until the approved pinned tool is available; authoritative source and contract files were
used for the final impact review.

No production dependency or lockfile change was required. No ADR or Planning policy version change
was required because D2a materializes the already accepted active-Track protected-capacity
invariant without changing ranking or completed-work semantics.

## Next bounded outcome

D2b begins with Learning Track lifecycle control, not the still-undefined cadence field. First
record and implement `active -> paused` and `paused -> active` through a Planning-owned Track read,
preview, and apply boundary. Resuming must preserve the D2a aggregate invariant by refusing a Track
whose protected minimum would exceed current Plan capacity. Track priority/protected-minimum
editing, create, complete, archive, and cadence remain later bounded increments; D3 availability
and Plan replacement remain behind the focused ADR required by the parent design.
