# Phase 4B D2b3 — Additional Learning Tracks and destination-aware admission

Status: accepted implementation design

Date: 2026-09-02

Parent design: [Phase 4B lifecycle and editing commands](PHASE_4B_LIFECYCLE_COMMANDS.md)

Setup basis: [D1b first Growth Plan setup](PHASE_4B_D1B_FIRST_GROWTH_PLAN_SETUP.md)

Admission basis: [Manual activity admission](PHASE_4B_MANUAL_ACTIVITY_ADMISSION.md)

## 1. Outcome and boundary

This outcome lets a signed-in person create one additional current Learning Track under the one
current Growth Plan and then choose an exact current Track when admitting one eligible personal
activity. Both writes use Planning's exact preview, explicit confirmation, optimistic version,
idempotency, audit, outbox, and atomicity discipline.

Creation and destination-aware admission are one product outcome but two compatible commands. The
already released sole-Track admission V1 keeps its exact meaning. New selector-capable V2 contracts
are additive; no client silently receives a different V1 interpretation.

This outcome does not add cadence, positive protected minimum at creation, default-session editing
after creation, terminal Track lifecycle, Plan replacement, availability, Campaigns, Catalog
activity admission, Preparation Packs, or Agent Control transport. It does not change Planning,
completed-work, or prerequisite policy versions.

## 2. Ownership and source semantics

Planning owns the Plan, Track, ordering, activity attribution, command receipt, event, and fixed
snapshot delivery. Targets owns every Readiness Goal and immutable Target Profile source. Overlay
owns eligible personal activities. Planning uses bounded owner queries and receives no direct grant
on another context's tables.

An additional Track is Targets-backed in this slice:

- exactly one current `active|paused` Growth Plan must exist;
- the person chooses any active, server-returned Readiness Goal in the personal workspace;
- the Track binds that Goal's exact immutable profile and nullable roadmap version; a null roadmap
  means the profile's exact requirement collection, never an unbound Track;
- several current Tracks may intentionally share one Goal/profile source because they are distinct
  planning lanes with their own title, priority, minimum, session length, activities, and history;
- a Plan may also contain Tracks backed by different active Readiness Goals; the existing planner
  already resolves each Track against its own exact Goal/profile source;
- no browser value chooses a workspace, Plan UUID, Track UUID, Goal UUID, profile UUID, roadmap
  UUID, owner revision, fingerprint, event, or delivery.

The same-source multiplicity is required by the representative Planning fixture, which models
separate Python and Algorithms Tracks against one readiness goal. Therefore Goal/profile identity
is not a uniqueness key for Learning Tracks, and title is a required user input.

## 3. Track creation source and inputs

Add a zero-argument actor-scoped `LearningTrackCreationSourceV1`. It returns exactly one state:

- `READY` — one current Plan, `0..29` current `active|paused` Tracks, and `1..20` active Goal choices;
- `NO_CURRENT_PLAN`;
- `TRACK_PORTFOLIO_LIMIT_REACHED` — exactly 30 current Tracks;
- `NO_ACTIVE_GOALS`;
- `GOAL_PORTFOLIO_OVERFLOW` — more than 20 active Goals.

More than 30 current Tracks, corrupt Plan cardinality, or an inconsistent owner response is an
unavailable RPC failure rather than an actionable state. Nothing is silently truncated. Only
`READY` exposes `create_learning_track`.

The ready source contains the current Plan title, lifecycle, capacity and aggregate version; current
Track count and limit `30`; and all active Goal choices in `readinessGoalKey COLLATE "C"` order.
Each choice contains only an opaque Goal key, safe title/profile label and key, roadmap-presence
fact, and bigint-safe Goal aggregate version.

Preview accepts only:

- `readinessGoalKey` and its exact expected aggregate version from the source;
- a trimmed printable Track title of `1..160` characters;
- priority `0..100`;
- default session length `1..480` minutes;
- a trimmed printable reason of `1..500` characters;
- one lowercase request UUID created when this intent starts.

The new Track is `active`, aggregate version `1`, and has protected minimum `0`. An empty Track must
not reserve capacity it cannot yet consume. The existing D2b2 settings command can add a protected
minimum after useful work is admitted. The Plan and all sibling aggregate versions remain unchanged.

## 4. Deterministic create preview

Use `planning-create-identity/1.0.0` with the authenticated workspace UUID, command type
`planning.create_learning_track_v1`, request UUID, and label `additional-learning-track`. The
derived UUID is lowercase RFC-variant UUIDv8 and the key is exactly `track:<derived UUID>`. The
browser chooses neither value.

`LearningTrackCreationPreviewV1` shows and binds:

- the exact resolved Goal/profile/roadmap owner source and expected Goal version;
- unchanged parent Plan lifecycle, capacity, and version;
- current Track count `N -> N + 1` against limit `30`;
- exact new Track identity, title, source, lifecycle, priority, protected minimum, session length,
  and version;
- active protected-minimum and flexible-capacity totals before/after, unchanged because the new
  minimum is zero;
- the current-order fingerprint before and after plus the new one-based position under
  `priority DESC`, `track_key COLLATE "C"`, then Track UUID;
- retained Plan/Track/activity/evidence/Mastery/Review/snapshot history;
- `PENDING` recalculation, one fixed `planning.plan_snapshot_v1` delivery, blockers and warnings.

Warnings are ordered: `PARENT_GROWTH_PLAN_PAUSED` when applicable, followed by
`TRACK_STARTS_EMPTY` for every applicable preview. At a count of 30, preview is blocked by
`TRACK_PORTFOLIO_LIMIT_REACHED` and exposes no confirmation. A derived identity collision is a
separate blocking condition that requires a fresh request UUID.

`learning-track-creation-preview-digest/1.0.0` uses the existing ordered length-prefixed UTF-8
framing and binds every input and resolved fact above, both order fingerprints, applicability,
warnings, retained facts, event kind, and consumer. Apply never trusts a browser-created digest.

## 5. Creation apply, event, and concurrency

The new command type is `planning.create_learning_track_v1`. Apply:

1. validates scalars, resolves actor/workspace, derives identity, and hashes the complete request;
2. serializes `(actor, command type, request UUID)` and replays only an identical completion;
3. takes `planning-workspace:<workspace UUID>`;
4. locks the current Plan and every child Track in stable UUID order;
5. rechecks the Plan version and `<=29` current-Track bound, re-resolves the exact Targets source,
   and verifies its Goal version/owner revision;
6. rebuilds the preview from locked state and requires its exact digest;
7. inserts one started receipt, one Track, one validated event, and one fixed delivery;
8. completes the receipt and commits all effects together.

The additive `planning.input_changed` V1 variant uses change kind `TRACK_CREATED` with only
`growth_plan_id`, `learning_track_id`, `learning_track_version`, `readiness_goal_id`, and
`profile_version_id`. It contains no title, reason, notes, evidence, source body, capacity, or Today
body. Any stale source/count/order, same-key changed request, identity collision, authorization
failure, or receipt/event/delivery failure rolls back everything.

## 6. Destination-aware activity source

`CurrentLearningTracksV1` remains the authoritative compact destination list and stable ordering.
The UI chooses one returned opaque `trackKey`, then requests a bounded actor-scoped
`LearningTrackActivityAdmissionSourceV2(trackKey)`. The selector is a query hint, not authority;
the server resolves it inside the authenticated current Plan and returns the same unavailable shape
for missing, foreign, terminal, or stale-looking keys.

The V2 source returns the selected Track summary and `0..200` eligible activities for that Track's
exact immutable profile. Eligibility is unchanged from V1:

- active, accepted personal Overlay activity in the actor's workspace;
- exact profile match for the selected destination Track;
- no attribution anywhere in the current Plan, including archived history;
- at most 200 non-archived Plan activities and at most 200 eligible choices;
- stable `activityKey COLLATE "C"` order, no silent truncation.

States are `READY`, `NO_CURRENT_PLAN`, `NO_CURRENT_TRACKS`,
`CURRENT_TRACK_PORTFOLIO_UNAVAILABLE`, `SELECTED_TRACK_UNAVAILABLE`,
`NO_ELIGIBLE_ACTIVITIES`, `PLAN_ACTIVITY_LIMIT_REACHED`, or
`ELIGIBLE_ACTIVITY_PORTFOLIO_OVERFLOW`. Only `READY` exposes the admission capability.

Returning all Track/activity combinations is forbidden: the bounded per-Track read avoids a
worst-case 30-by-200 payload and keeps cross-context data minimized.

## 7. Destination-aware preview and apply

Add `LearningTrackActivityAdmissionPreviewV2` and
`LearningTrackActivityAdmissionApplyResultV2` without changing V1. Preview accepts the selected
server-returned `trackKey`, activity key, duration `1..480`, nullable energy, expected Plan and
selected Track versions, reason, and lowercase request UUID. Its command type is
`planning.add_learning_track_activity_v3`.

V2 retains V1 eligibility, candidate identity, activity-count, history, and pending-recalculation
semantics. It additionally binds the selected destination and the complete current-Track order
fingerprint. Apply takes the shared Planning workspace lock, locks all child Tracks, re-resolves
the selected Track plus Targets and Overlay owner sources, rebuilds the exact preview, and advances
only the destination Track once. Creation, lifecycle, settings, capacity, V1/V2 admission, and
concurrent sibling edits therefore serialize without write skew.

## 8. Manual UI

`/plan` adds `Create another Learning Track` with native Goal selection, title, whole priority,
whole default-session minutes, and reason. Preview explains exact source, placement, unchanged
capacity, empty-Track warning, retained history, and pending Today recalculation.

`Add useful work` uses current Tracks as a native destination selector. Selecting a Track loads its
bounded V2 source; then the person chooses an activity, duration, energy and reason. The exact
preview names the destination. Load failure affects only this additive section, not unrelated Plan
controls.

Starting or changing any Plan, capacity, Track lifecycle, Track settings, Track creation, or
activity-admission intent dismisses every other pending confirmation. Blocked, empty, overflow,
unavailable and stale states expose no misleading apply control. Success refreshes `/plan` and
`/today`. Keyboard order, 44-pixel targets, 320-pixel layout, reduced motion, forced colors, and
automated WCAG 2.2 A/AA checks remain required.

## 9. Required proof

Tests must prove:

- strict valid, boundary, blocked, invalid and malicious create/V2-admission contracts;
- TypeScript/PostgreSQL identity, digest and request-hash parity and field sensitivity;
- active-Goal `20/21`, current-Track `29/30/31`, Plan-activity `200/201`, and eligible-activity
  `200/201` behavior without truncation;
- same-source multiple Tracks with distinct user titles and mixed Goal/profile Tracks;
- preview purity; exact versions; stale Plan, Goal, selected Track, owner revision and sibling-order
  refusal; same-key replay and changed-request conflict;
- real same-request and distinct-request races plus serialization against capacity, lifecycle,
  settings, creation and both admission versions;
- one created Track with unchanged Plan/siblings, or one attribution with only the selected Track
  incremented; exact receipt/event/delivery; injected-failure rollback;
- forced RLS, positive/negative workspace isolation, non-enumerating selectors, least-privilege
  grants, private-helper denial, and ignored injected browser authority;
- create, destination load, preview, confirmation, reload, empty, blocked, overflow, stale, keyboard,
  responsive, touch, reduced-motion, forced-colors and accessibility UI states;
- a real authenticated create -> reload -> select Track -> admit -> reload journey;
- `pnpm verify`, `pnpm verify:db`, `pnpm verify:auth`, and `pnpm verify:backup` before merge.

## 10. Roll-forward and deferred work

The migration is additive. UI rollback removes the new controls and public functions while keeping
created Tracks, admitted attributions, receipts, events, deliveries and history valid. V1 remains
readable and executable for its released sole-Track case.

Deferred: cadence, positive minimum at creation, post-create session editing, terminal Track
transitions, generic competency-collection Track creation, Catalog activity admission, Plan
replacement, availability, Campaigns, Preparation Packs, and Agent Control transport.
