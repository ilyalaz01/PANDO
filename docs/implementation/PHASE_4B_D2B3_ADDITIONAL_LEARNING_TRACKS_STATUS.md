# Phase 4B D2b3 — Additional Learning Tracks implementation status

Status: complete

Design: [Additional Learning Tracks and destination-aware admission](../design/PHASE_4B_D2B3_ADDITIONAL_LEARNING_TRACKS.md)

Completed: 2026-09-02

## Delivered outcome

A signed-in person can create an additional active Learning Track beneath the one current Growth
Plan, choosing an exact active Readiness Goal, title, priority, and default session length. The new
Track starts empty with protected minimum `0`. The person can then select one current destination
Track, load only that Track's bounded eligible personal activities, preview the exact attribution,
confirm it, and observe the changed Track after reload.

Creation and admission are separate Planning commands with separate versioned contracts. The
released sole-Track admission V1 retains its exact meaning. Multi-Track UI uses additive V2 source
and preview/apply contracts and never preloads the Cartesian product of Tracks and activities.

## Owner boundaries and atomic commands

- Planning owns Track creation, ordering, attribution, receipts, events, and fixed snapshot
  deliveries. Targets and Overlay data enter through bounded owner queries; Planning received no
  cross-context table grants.
- Public reads resolve the actor and personal workspace from the authenticated session. Browser
  inputs contain opaque keys and scalar intent only, never workspace, Plan, Track, Goal, profile,
  roadmap, activity, event, or delivery UUID authority.
- Both apply commands re-resolve current owner state under the shared Planning workspace lock,
  require exact aggregate versions and preview digests, serialize against sibling changes, replay
  only an identical idempotent request, and commit state plus receipt/event/delivery atomically.
- Track creation emits the minimal `TRACK_CREATED` variant of `planning.input_changed` and leaves the
  parent Plan and sibling aggregate versions unchanged. Destination-aware admission increments only
  the selected Track.
- Multiple Tracks may intentionally share one Goal/Profile. The Planning readiness owner query now
  collapses identical positional Goal/Profile sources before source assembly, while the Plan keeps
  both Track identities. NULL positional elements fail explicitly.

## Application and UI

- `/plan` exposes native, keyboard-operable creation and destination selectors with exact
  preview/confirm flows. A selected Track is loaded explicitly; changing destination or any activity
  field invalidates an unrelated pending confirmation.
- A stale URL selector is normalized to a current Track in the selector, while the server rejects a
  READY V2 response for any destination other than the requested current Track.
- Empty, blocked, overflow, unavailable, and stale states fail closed without an apply control. The
  additive section cannot take down unrelated Plan controls.
- Browser proof covers 320-pixel layout without horizontal overflow, 44-pixel targets, keyboard
  order, reduced motion, forced colors, and automated WCAG 2.2 A/AA checks.

## Verification evidence

Verified on Windows against the committed dependency set:

- `pnpm verify` — PASS: formatting, lint, strict TypeScript, 15 database-runner checks, 3
  backup-archive unit checks, 374 contract tests, 3 performance tests, 889 unit/coverage tests, the
  production build, and 34/34 Chromium E2E/accessibility tests. Production-code coverage excludes only
  browser-only `/dev` fixtures and remains above every unchanged repository threshold.
- `pnpm verify:db` — PASS from a clean migration: 42 pgTAP files, 2749 assertions, and warning-level
  database lint with no findings. The final test exercises the real Planning source-bundle path with
  two Tracks sharing one Goal/Profile.
- `pnpm verify:auth` — PASS in an isolated migrated stack, including real authenticated
  create -> reload -> select destination -> V2 preview/apply -> reload, projection worker, Today,
  Focus, persistence, refresh, and sign-out behavior.
- `pnpm verify:backup` — PASS: encrypted backup and clean restore. The previously running local PANDO
  Supabase stack was stopped with data preservation for the gate and restarted successfully.

No production dependency or lockfile change was required. No new ADR was required because D2b3
implements already accepted Planning/Targets/Overlay ownership, same-source Track multiplicity,
preview/confirmation, optimistic concurrency, transactional outbox, and additive contract-versioning
decisions.

## Next bounded outcome

Implement terminal Learning Track lifecycle as one bounded D2 increment: `complete_track` records a
Planning decision without claiming Mastery, while `archive_track` removes a Track from normal use;
both retain history and cannot be resumed. Cadence remains undefined and must receive an accepted
design before persistence. D3 availability/replacement and D4–D5 Campaign work remain blocked on the
focused decisions listed in the parent lifecycle design.
