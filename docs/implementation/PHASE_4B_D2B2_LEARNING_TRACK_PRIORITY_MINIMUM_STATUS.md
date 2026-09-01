# Phase 4B D2b2 Learning Track priority and protected minimum status

Status: complete

Design:
[D2b2 Learning Track priority and protected minimum](../design/PHASE_4B_D2B2_LEARNING_TRACK_PRIORITY_MINIMUM.md)

Completed: 2026-09-01

## Delivered outcome

A signed-in user can open `/plan`, select one current Learning Track through its opaque
server-returned key, enter both resulting settings and a reason, inspect their exact consequences,
and explicitly confirm one atomic change. Priority is an integer from 0 through 100. Protected
weekly minimum is an integer from 0 through 10080. Either value may remain unchanged, but an exact
two-value no-op is rejected.

For an active Track, the proposed protected minimum must keep the sum of all active Track minima at
or below the current Growth Plan capacity; equality is valid and no value is clamped. A paused
Track can store settings that would not currently fit because it consumes no active capacity. Its
preview reports the exact hypothetical resume requirement and warning instead of silently making
the Track active. A paused parent Plan also produces an ordered warning rather than blocking the
saved Track state.

Priority changes use the stable current-Track order: priority descending, ASCII Track key, then
Track UUID. The preview shows the target position before and after while remaining explicit that
priority guides Planning ranking and is not a quota or a guaranteed Today order.

## Owner boundary and atomic command

- D1, D2a, and D2b1 retain their released contracts. D2b2 adds a separate strict preview/apply
  contract, command type `planning.set_learning_track_priority_minimum`, and exact six-field
  `TRACK_PRIORITY_MINIMUM_CHANGED` event payload.
- The browser supplies only the opaque Track key, two bounded values, exact Plan and Track version
  fences, reason, preview digest, and idempotency key. Planning resolves the actor, personal
  workspace, Plan and Track IDs, capacity, siblings, positions, and fingerprints.
- The clock-free `learning-track-priority-minimum-preview-digest/1.0.0` protocol length-prefixes
  ordered UTF-8 fields. It binds the D2a active-capacity fingerprint and a new
  `current-track-order-fingerprint/1.0.0`, so a concurrent active constraint or current sibling
  priority/version change invalidates a stale preview.
- Apply locks the actor/key, Planning workspace, current Plan, and every child Track in stable UUID
  order. It rechecks both versions and the exact digest, updates only the target priority,
  protected minimum, aggregate version, and timestamp, then atomically commits the completed
  receipt, one minimal event, and one `planning.plan_snapshot_v1` delivery.
- Same-key/same-request replay returns the stored response. Changed requests, blocked or stale
  previews, foreign and terminal selectors, authorization failures, and injected event or delivery
  failures leave no partial effect. Private builders and validators are denied to runtime roles;
  Planning receives no cross-context owner-table grant.
- Real `dblink` races prove same-target D2b2 serialization, serialization with D2a capacity and
  D2b1 lifecycle in both relevant freshness directions, and the shared workspace lock with activity
  admission without over-fencing an unchanged Track. A priority-only active edit changes D2a
  freshness through the Track version even when the protected-minimum sum is unchanged.

## Application and UI

- The server adapter validates both JSON Schema and semantic coherence before UI code receives a
  preview or apply result. Server Actions discard injected workspace, aggregate, capacity, and
  fingerprint fields.
- Current Track cards now display priority as well as lifecycle, protected minimum, and version.
  The settings form uses native select and integer inputs, reason, preview, and explicit
  confirmation; it does not introduce a slider, drag ordering, or alternate write path.
- The exact comparison shows priority, protected minimum, position, active protected total,
  flexible capacity, and version before and after. Blocked active settings have no confirmation
  control. Paused-Plan and paused-Track consequences are rendered in deterministic order.
- Starting or changing a Plan, capacity, lifecycle, or settings intent removes older
  confirmations. A new settings preview receives a fresh idempotency request ID, while a retry of
  the same confirmed apply retains it. Success revalidates `/plan` and `/today` and remains honest
  that the ordinary Planning projection is pending.
- Keyboard flow, 320-pixel layout, touch targets, reduced motion, forced colors, automated WCAG
  A/AA, blocked settings, exact comparison, and a real authenticated persistence/reload journey
  are covered.

## Verification evidence

The final Windows release gates passed from clean disposable environments:

- `pnpm verify`: PASS — format, lint, Next.js type generation and TypeScript; 15 database-runner
  checks with 2 platform skips; 3 backup-archive tests; 337 contract tests; 3 performance tests;
  806 unit/coverage tests; 87.30% statement and 80.31% branch coverage; production build; and
  30/30 Chromium E2E tests.
- `pnpm verify:db`: PASS — every migration applied from zero, all 33 explicit pgTAP files and 2299
  assertions passed, and warning-level database lint reported no findings.
- `pnpm verify:auth`: PASS — the isolated signed-in browser journey previewed and applied Track
  settings, reloaded the page, observed priority 80 and protected minimum 120 through the
  authenticated current read, advanced only the selected Track version once, and completed the
  existing Plan, Today/Focus, overlay, refresh, and sign-out path.
- `pnpm verify:backup`: PASS — the encrypted archive completed a clean restore with the D2b2
  migration and API boundary.

The checked-in Graphify index was not refreshed because neither the approved `graphify` executable
nor its pinned `uvx` runtime is available in this Windows environment. No substitute version, hook,
remote backend, or dependency was installed. Authoritative source, schema, migration, and test
files were used for final impact review.

No production dependency or lockfile change was required. No ADR, Planning policy, completed-work
policy, prerequisite policy, or planner-engine version changed because D2b2 materializes accepted
Planning ownership and ranking/capacity inputs without redefining their calculation semantics.

## Next bounded outcome

Fresh-user review found that test fixtures directly initialize the first Plan while `/plan` exposes
no equivalent setup, and that activity admission has no manual UI. Implement the accepted
[D1b first Growth Plan setup](../design/PHASE_4B_D1B_FIRST_GROWTH_PLAN_SETUP.md), then add exact
preview/confirmation for manual activity admission. Additional Track creation follows only when a
new Track can receive useful work. Terminal Track transitions and cadence remain later bounded
increments; D3 availability/replacement and Campaign work remain behind their recorded decisions.
