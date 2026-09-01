# Phase 4B manual activity admission status

Status: complete

Design: [Manual activity admission](../design/PHASE_4B_MANUAL_ACTIVITY_ADMISSION.md)

Completed: 2026-09-02

## Delivered outcome

A signed-in user can open `/plan`, choose one existing active and accepted personal Overlay
activity for the sole current Learning Track, set an estimate of 1–480 minutes and optional energy,
enter a reason, inspect the exact effect, and explicitly confirm it. The activity becomes a
Planning candidate and Today reports recalculation as pending; admission does not promise that the
activity will be recommended.

Paused Plans and Tracks accept the activity with deterministic warnings. No eligible activity,
Plan limit, source overflow, and zero-or-multiple-current-Track states are explicit and expose no
misleading apply control. A transient failure of this additive source disables only the activity
section, not the already-authorized lifecycle, capacity, or Track controls.

## Owner boundary and atomic command

- `LearningTrackActivityAdmissionSourceV1` is a zero-selector, actor-scoped read. Planning composes
  the current Plan/Track with Targets' exact Goal/profile fence and Overlay's bounded personal
  choices. The browser receives no workspace, aggregate, Goal, profile, or custom-activity UUID.
- `LearningTrackActivityAdmissionPreviewV1` binds the exact public input, resolved identities,
  Plan/Track versions and settings, Targets/Overlay revisions, activity facts, deterministic
  candidate key, count/limit, warnings, retention, and fixed consumer in a versioned clock-free
  digest.
- `planning.add_learning_track_activity_v2` derives idempotency from the lowercase request UUID,
  serializes the actor/key and Planning workspace, locks the Plan and all child Tracks, re-resolves
  owner facts, and requires the exact digest. It atomically inserts attribution, advances only the
  selected Track once, completes the receipt, emits one `TRACK_ACTIVITY_ADMITTED` event, and creates
  one `planning.plan_snapshot_v1` delivery.
- The historical six-argument v1 RPC remains migration history but runtime roles can no longer
  execute it. Private builders, validators, and owner queries remain denied; Planning receives no
  direct Targets or Overlay table grant.

## Application and UI

- Server adapters decode strict source, preview, and apply contracts. Server Actions validate only
  bounded scalar fields, ignore injected authority fields, preserve the request UUID across exact
  apply retry, and revalidate `/plan` plus `/today` after success.
- `/plan` places “Add useful work” below the current Track summary with native activity and energy
  selects, integer duration, reason, exact comparison, retention notice, warnings, and a separate
  confirmation. Changing any field removes the old confirmation.
- Starting any Plan, Track, settings, capacity, or activity preview dismisses confirmations from
  the other operations. A stale apply offers an explicit reload and cannot leave partial state.
- The activity section has automated keyboard-order, 320-pixel, touch-target, reduced-motion,
  forced-colors, and WCAG A/AA coverage. The real authenticated journey proves source → preview →
  confirm → reload persistence and the resulting Today pending/current transition.

## Verification evidence

- `pnpm verify`: PASS — format, lint, Next.js type generation and TypeScript; 15 database-runner
  checks with 2 platform skips; 3 backup-archive tests; 358 contract tests; 3 performance tests;
  849 unit/coverage tests; 87.11% statement and 80.02% branch coverage; production build; and 32/32
  Chromium E2E tests.
- Focused application suite: PASS — 6 files / 71 tests.
- Activity-aware Plan browser suite: PASS — 11/11 Chromium tests.
- `pnpm verify:auth`: PASS — generated API types match the migrated schema and the disposable
  signed-in browser journey admits the activity through v2 before continuing through Today/Focus,
  readiness, review, reload, accessibility, and sign-out.
- `pnpm verify:db`: PASS — every migration applied from zero, all 37 pgTAP files / 2,557
  assertions passed, and warning-level database lint reported no findings. The release proof
  includes exact TypeScript/SQL
  digest and request-hash parity, 200/201 bounds, archived-history exclusion, non-enumeration,
  forced-RLS/ACL isolation, rollback injection, same-key replay, and distinct-preview races.
- `pnpm verify:backup`: PASS — the encrypted archive completed a clean restore with the v2
  migration, function metadata, and ACLs included.

No production dependency or lockfile change was required. No canonical product rule, ADR,
Planning policy, completed-work policy, prerequisite policy, or planner-engine version changed.
The checked-in Graphify index was not refreshed because the approved CLI/pinned runtime is not
available in this Windows environment; authoritative source and contracts were reviewed directly,
without installing a substitute or remote backend.

## Next bounded outcome

Write the accepted design for additional Learning Track creation and the destination-Track
selector it requires for later activity admission. Preserve the one-current-Plan invariant,
protected-capacity rules, stable Track ordering, owner-derived identities, exact preview/apply
discipline, and retained history. Terminal Track transitions and cadence remain separate bounded
outcomes; D3 availability/replacement and D4–D5 Campaign work still require the focused decisions
recorded in the Phase 4B lifecycle design.
