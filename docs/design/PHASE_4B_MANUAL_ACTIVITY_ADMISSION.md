# Phase 4B — Manual activity admission to the initial Learning Track

Status: accepted implementation design

Date: 2026-09-02

Parent design: [Phase 4B lifecycle and editing commands](PHASE_4B_LIFECYCLE_COMMANDS.md)

Persistence basis: [Phase 4A Planning and Today](PHASE_4A_PLANNING_TODAY.md)

Setup basis: [D1b first Growth Plan setup](PHASE_4B_D1B_FIRST_GROWTH_PLAN_SETUP.md)

## 1. Outcome and boundary

This increment lets a signed-in person add one existing, active, accepted personal User Overlay
activity to the single current Learning Track created by D1b. The person chooses the activity,
estimated duration and optional energy, explains the change, previews the exact effect and confirms
that preview before Planning writes anything.

The source is personal Overlay content only. Catalog activities are deferred because the released
Planning attribution requires an Overlay `custom_activity_id`; Catalog admission needs a separately
versioned source, attribution and event design. This increment also does not add activity creation,
additional Track creation, cadence, terminal lifecycle commands, Plan replacement, availability,
Campaigns, Preparation Packs or Agent Control transport.

The flow is intentionally available only while the current Growth Plan has exactly one current
`active|paused` Track. It does not guess which Track is "initial" from timestamps. Additional Track
creation follows this outcome and will define a new selector-capable admission contract.

## 2. Eligible activity and admission semantics

An eligible choice is an Overlay activity that:

- belongs to the authenticated person's personal workspace;
- points to the exact immutable Target Profile used by the current Track;
- is `active` with mapping status `accepted`;
- has not already been attributed anywhere in the current Growth Plan, including an archived
  attribution.

The selected activity remains owned by Overlay. Planning stores only its existing attribution,
estimated minutes and nullable energy. Estimated minutes are an integer in `1..480`; energy is
`LOW | MEDIUM | HIGH | null`. Title, type, competency mapping, lifecycle and evidence guidance are
not editable in this flow.

Admission increments only the Learning Track aggregate version. The Growth Plan version, capacity,
Track priority and protected minimum remain unchanged. It emits the existing
`TRACK_ACTIVITY_ADMITTED` Planning input event and one fixed `planning.plan_snapshot_v1` delivery.
The current snapshot pointer and all prior snapshots, sessions, evidence, mastery and readiness
history remain unchanged. The result is `PENDING`: the activity becomes a Planning candidate only
after the ordinary worker rebuilds the snapshot, and is never promised as a Today recommendation.

A paused Plan or paused Track may receive the activity. Preview warns that it cannot contribute a
current recommendation until the paused aggregate is resumed.

## 3. Actor-scoped source read

`LearningTrackActivityAdmissionSourceV1` is composed by Planning for the authenticated personal
workspace. The public read accepts no workspace, Plan, Track, Goal, profile or activity selector.
It returns one of these explicit states:

- `READY` — one current Plan, exactly one current Track, and `1..200` eligible choices;
- `NO_CURRENT_PLAN`;
- `CURRENT_TRACK_PORTFOLIO_UNAVAILABLE` — zero or multiple current Tracks;
- `NO_ELIGIBLE_ACTIVITIES`;
- `PLAN_ACTIVITY_LIMIT_REACHED` — the current Plan already has 200 non-archived activities;
- `ELIGIBLE_ACTIVITY_PORTFOLIO_OVERFLOW` — more than 200 eligible choices.

Only `READY` includes the `admit_activity_to_learning_track` capability. The response includes the
opaque Track key and current Plan/Track versions plus each activity's key, title, type and target
competency reference, ordered by `activityKey COLLATE "C"`. It exposes no workspace, aggregate,
Goal, profile or custom-activity UUID, note, resource, evidence guidance or unrelated Overlay data.

Overlay owns a purpose-specific bounded query. Planning supplies the exact profile and at most 200
server-derived already-attributed custom-activity UUIDs; Overlay returns at most 201 eligible rows
plus its workspace-overlay revision. The 201st row produces the overflow state rather than silent
truncation. Planning receives no direct Overlay table grant.

## 4. Exact preview contract

`LearningTrackActivityAdmissionPreviewV1` accepts only:

- a server-returned `activityKey`;
- estimated minutes and nullable energy;
- expected Growth Plan and Learning Track versions returned by the source;
- a trimmed printable reason of `1..500` characters;
- one lowercase request UUID generated at the start of this intent.

Workspace and all authority-bearing UUIDs, activity facts, counts, lifecycle, owner revisions,
candidate identity, event and delivery facts are server-resolved. The request UUID is not authority;
Planning derives the retry-stable candidate key as `candidate:<request UUID>`.

The clock-free preview shows:

- the exact Track and selected activity title, type and target competency;
- estimated minutes and energy;
- non-archived Plan activity count `N -> N + 1` against the limit of 200;
- Track aggregate version `v -> v + 1` and unchanged Growth Plan version;
- unchanged Plan capacity and Track priority/protected minimum;
- retained history facts, one pending recalculation and the fixed consumer;
- ordered warnings and `canApply`.

A count of 200 returns `canApply = false` with `PLAN_ACTIVITY_LIMIT_REACHED` and no confirmation.
Ineligible, duplicate, foreign or stale selectors fail closed without revealing whether another
workspace owns the supplied value. No-op is impossible because an already-attributed activity is
not eligible.

## 5. Digest and freshness

`learning-track-activity-admission-preview-digest/1.0.0` uses the existing ordered,
length-prefixed UTF-8 field protocol. It binds:

- contract, operation and digest versions, request UUID and reason;
- resolved workspace, Plan, Track, Goal, profile and custom-activity identities;
- both expected aggregate versions and Plan/Track lifecycle/settings;
- Targets and Overlay owner revisions;
- exact activity key/title/type/competency/lifecycle/mapping facts;
- deterministic candidate key, duration and energy;
- activity count before/after, limit, applicability, blocker and ordered warnings;
- retained-history facts, `PENDING`, event kind and fixed delivery consumer.

The browser never constructs the digest. Apply takes the standard Planning workspace lock,
re-resolves the unique current Track, revalidates Targets and Overlay through their owner queries,
rebuilds the exact preview from locked state and requires a digest match. The preview has no
time-based expiry; any bound state change makes it stale.

## 6. Apply, idempotency and compatibility

The new mutation uses command type `planning.add_learning_track_activity_v2`. Its public apply
accepts the same preview inputs plus the exact digest. The request UUID derives both the candidate
key and a namespaced idempotency key. Starting a changed intent rotates the UUID; retrying the same
confirmed request keeps it.

Apply follows this transaction order:

1. validate scalar syntax, resolve actor/personal workspace and hash the complete request;
2. serialize the actor, v2 command type and derived idempotency key, replaying only a byte-identical
   completed request;
3. take `planning-workspace:<workspace UUID>` and lock the current Plan and all of its Tracks in
   stable UUID order;
4. require exactly one current Track, recheck both versions and rebuild the owner-fenced preview;
5. require `canApply` and the exact digest, then insert the started receipt;
6. insert one attribution and increment the Track version exactly once;
7. append the existing validated event and one fixed Planning delivery;
8. complete the receipt and commit every effect together.

The existing six-argument `api.add_learning_track_activity_v1` is retained as historical schema
but loses runtime-role execute permission when v2 ships. Its hardened implementation remains
private. Database fixtures and internal setup paths must migrate explicitly; leaving v1 executable
by `authenticated` would preserve a mutation path without preview and confirmation.

## 7. Manual UI behavior

`/plan` shows one "Add useful work" section below the current Track summary. There is no Track
selector. The form uses a native activity select, whole estimated minutes, an optional native
energy select and a required reason. A link to Explore explains how to create a personal activity
when none are eligible.

Changing any admission input removes an older confirmation. Preview presents the exact comparison,
warnings and pending recalculation before a confirm button. A stale apply keeps nothing half-written
and offers a Plan reload. Success refreshes `/plan` and `/today`. Empty, limit, overflow and
unavailable portfolio states never render a misleading apply control.

The section must retain the existing keyboard order, 44-pixel targets, 320-pixel layout,
reduced-motion and forced-colors behavior. More than a few choices use the native select rather than
a custom virtualized widget; the explicit 200-source bound prevents an unbounded DOM.

## 8. Required proof

This outcome is complete only when tests prove:

- strict valid, boundary, blocked, invalid and malicious source/preview/apply contracts;
- deterministic TypeScript/PostgreSQL digest agreement and sensitivity to every bound field;
- source ordering, exact-profile eligibility, duplicate exclusion, 200/201 behavior and no silent
  truncation;
- side-effect-free preview, exact digest apply, stale Plan/Track/Targets/Overlay refusal and
  preview-to-apply races;
- duration/energy boundaries, paused warnings, same-key replay, changed-request conflict and
  serialization against Plan/Track edits and another admission;
- one Track increment, unchanged Plan/pointer/history, one receipt/event/delivery and full rollback
  after injected outbox failure;
- forced-RLS isolation, non-enumerating foreign selectors and exact public/private privilege
  matrix including denied v1 runtime calls;
- strict server-action validation that ignores injected authority fields;
- empty/limit/overflow/stale/success UI, keyboard, 320-pixel, touch, reduced-motion, forced-colors
  and WCAG A/AA behavior;
- a real signed-in source -> preview -> confirm -> reload persistence journey and Today pending
  behavior;
- `pnpm verify`, `pnpm verify:db`, `pnpm verify:auth` and `pnpm verify:backup` before merge.

No production dependency is required. Rollback removes the new UI and v2 public functions while
retaining all already admitted activities, immutable receipts, events, deliveries and snapshots.
