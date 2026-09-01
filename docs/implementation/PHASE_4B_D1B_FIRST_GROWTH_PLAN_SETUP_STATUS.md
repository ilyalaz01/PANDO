# Phase 4B D1b first Growth Plan setup status

Status: complete

Design: [D1b first Growth Plan setup](../design/PHASE_4B_D1B_FIRST_GROWTH_PLAN_SETUP.md)

Completed: 2026-09-02

## Delivered outcome

A signed-in user who has selected an active Readiness Goal but has no Growth Plan can now follow
the ordinary `/start -> /plan -> preview -> confirm -> reload` journey. The user selects one of at
most 20 actor-scoped active Goals, sets bounded weekly capacity, default session length and initial
Track priority, enters a reason, and sees the exact first Plan and Track before anything is written.

Confirmation creates one active Growth Plan, one active empty Learning Track with protected minimum
zero, and the initial snapshot sentinel. The result is honestly `PENDING`: an empty Track produces
no Today action until a later activity-admission command adds useful work. Existing Goal, profile,
overlay, activity/evidence, Mastery, Review and history data are retained.

No second current Plan, archived-history replacement, additional Track, activity admission,
Campaign, availability or Agent Control transport was added by D1b.

## Owner boundary and atomic command

- `GrowthPlanSetupSourceV1`, `GrowthPlanInitializationPreviewV1` and
  `GrowthPlanInitializationApplyResultV1`, all version `1.0.0`, are structurally and semantically
  decoded before application or UI code trusts them.
- Targets owns the bounded active-Goal/profile source. Planning receives only a purpose-specific
  query and gains no Targets table grant. The browser receives opaque Goal keys and cannot choose a
  workspace, Goal UUID, profile UUID, Plan UUID, Track UUID, capacity fingerprint or source fence.
- Preview and apply share the exact bounded values, Goal aggregate-version fence, lowercase UUID
  request key and `growth-plan-initialization-preview-digest/1.0.0` digest. Apply also re-resolves
  the source and refuses stale, foreign, inactive, terminal, missing or malformed Goals.
- Plan and Track UUIDv8 identities are derived by `planning-create-identity/1.0.0` from the personal
  workspace, command type, request UUID and fixed label. They are stable for replay and are never
  supplied by the browser.
- The `planning.initialize_growth_plan_v2` transaction commits the Plan, Track, sentinel, completed
  receipt, one minimal `planning.input_changed` `INITIALIZED` event and one
  `planning.plan_snapshot_v1` delivery together. Same-key/same-request replay returns the stored
  result; changed requests and every injected late failure roll back completely.
- Current Plan, archived history, corrupt cardinality, orphan sentinel and deterministic identity
  collisions fail closed. Workspace and Goal locks serialize same-key, different-key and Goal
  lifecycle/version races.
- The legacy `api.initialize_growth_plan_v1` path remains only for isolated historical test setup;
  every runtime role is denied. Scratch-only fixture access is copied into disposable DB gates and
  is absent from production migrations.

## Application and UI

- `/start` exposes `Set up Growth Plan`; `/plan` loads current Plan, current Tracks and setup source
  through three actor-scoped reads, retries one legitimate interleaving, then fails closed if they
  still disagree.
- Native select, integer inputs and a 500-character reason form produce a separate exact preview.
  The comparison shows source/profile, pre-state cardinality, Plan/Track values, pending
  recalculation, empty-Track warning and retained-state facts.
- Any Goal, capacity, session, priority or reason change removes the old confirmation and rotates
  the preview request UUID. Apply uses the request UUID echoed by that exact preview, so a retry of
  the same confirmation remains idempotent.
- Runtime-generated request UUIDs are created only at the user-intent boundary, avoiding divergent
  server/client render values. Success revalidates `/plan` and `/today`.
- Keyboard flow, 320-pixel layout, touch targets, reduced motion, forced colors and automated WCAG
  A/AA coverage are included. The real authenticated gate creates and reloads the first Plan through
  the browser rather than calling the legacy initializer.

## Verification evidence

The final Windows release gates passed from clean disposable environments:

- `pnpm verify`: PASS — format, lint, Next.js type generation and TypeScript; 15 database-runner
  checks with 2 platform skips; 3 backup-archive tests; 352 contract tests; 3 performance tests;
  828 unit/coverage tests; 87.18% statement and 80.23% branch coverage; production build; and 31/31
  Chromium E2E tests.
- `pnpm verify:db`: PASS — every production migration plus the scratch-only test fixture migration
  applied from zero, all 35 pgTAP files and 2450 assertions passed, and warning-level DB lint found
  no schema errors.
- `pnpm verify:auth`: PASS — generated API types matched the migrated schema and the isolated
  signed-in browser completed target selection, first-Plan setup preview/confirm/reload, Plan and
  Track controls, Today/Focus, overlay persistence, refresh and sign-out.
- `pnpm verify:backup`: PASS — the encrypted archive completed a clean restore with the D1b
  production migration.

No production dependency or lockfile change was required. No canonical product rule, Planning
ranking policy, completed-work policy, prerequisite policy or planner-engine version changed.

## Next bounded outcome

Manual admission is now complete; see the
[implementation status](PHASE_4B_MANUAL_ACTIVITY_ADMISSION_STATUS.md). Additional Learning Track
creation is the next bounded outcome and must define its exact destination-selector protocol before
the admission contract is broadened. Terminal transitions, cadence, availability/replacement,
Campaigns and Agent Control transport remain later bounded outcomes.
