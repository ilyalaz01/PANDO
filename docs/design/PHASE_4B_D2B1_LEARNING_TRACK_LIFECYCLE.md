# Phase 4B D2b1 — Learning Track pause/resume

Status: implemented

Date: 2026-09-01

Parent design: [Phase 4B lifecycle and editing commands](PHASE_4B_LIFECYCLE_COMMANDS.md)

Capacity basis: [D2a Growth Plan weekly-capacity control](PHASE_4B_D2A_GROWTH_PLAN_CAPACITY.md)

## 1. Outcome and boundary

D2b1 lets a signed-in person pause or resume one current Learning Track through Planning's
existing read, deterministic preview, explicit confirmation, and atomic apply discipline. It does
not add Track creation, priority or protected-minimum editing, completed or archived transitions,
cadence, availability, Campaigns, Agent Control transport, or natural-language interpretation.

The browser may submit only a `trackKey` returned by the authenticated current-Track read, the
operation, exact expected Growth Plan and Track versions, reason, preview digest, and idempotency
key. Planning resolves the actor, personal workspace, current Plan, Track UUID, siblings, and every
constraint input. Browser-supplied workspace, Plan, Track UUID, capacity, minimum, fingerprint, or
projected-state fields are never authority.

## 2. Accepted lifecycle and capacity semantics

- `pause_track` changes `active -> paused`; `resume_track` changes `paused -> active`.
- Both transitions are valid while the parent Growth Plan is current, meaning `active` or `paused`.
  A paused parent does not relax the capacity invariant. A resumed Track remains saved as active,
  but contributes no Today candidate source until the parent Plan is also active.
- Pause removes the Track from active candidate generation and from the active protected-minimum
  sum. It does not rewrite activities, Plan snapshots, completed Focus work, Evidence, Mastery,
  readiness, or Review history.
- Resume is applicable only when the projected active protected-minimum sum is at most the current
  Plan weekly capacity. Equality is valid; Planning never clamps a minimum or capacity.
- A new key requesting the already-current lifecycle is invalid. A replay of the identical
  completed key returns the stored response.
- `completed` and `archived` are terminal for resume and are not exposed as D2b1 mutation targets.
  The current read returns only `active|paused` Tracks.
- At most 30 current `active|paused` Tracks may exist in the compact MVP portfolio. The current read
  fails closed rather than truncating if persisted state exceeds that boundary. Future Track create
  must enforce the same limit before it is exposed. Because the paused resume target already counts
  toward the portfolio, a valid resume can produce at most 30 active Tracks and needs no separate
  active-count blocker.

These rules materialize the accepted canonical lifecycle and D2a active-only capacity invariant.
The existing Planning policy already requires both an active parent Plan and active Track before a
Track source is eligible. D2b1 changes neither eligibility meaning nor ranking coefficients, so it
requires no ADR, planner policy version, or engine version.

## 3. Separate versioned control contract

D1 and D2a contracts keep their released meanings. D2b1 adds a separate
`LearningTrackLifecycleControlV1` schema with three documents:

- `CurrentLearningTracksV1` contains the exact current parent Plan identity, lifecycle, weekly
  capacity and aggregate version, plus zero to 30 `active|paused` Track summaries in stable
  priority-descending, `trackKey`, UUID order. A Track summary contains only resolved UUID, key,
  title, lifecycle, priority, protected minimum, aggregate version, and its one allowed D2b1
  capability. Before a Plan exists it returns `growthPlan: null` together with an empty Track list,
  preserving the existing honest onboarding state.
- `LearningTrackLifecyclePreviewV1` contains the operation/reason, both expected versions, parent
  state, exact Track before/after state, constraint consequences, applicability, retained-history
  facts, warnings, pending recalculation effect, and digest.
- `LearningTrackLifecycleApplyResultV1` contains the changed Track, command identity, one Planning
  delivery, one emitted event, and honest `PENDING` projection state.

The read accepts no client argument. Missing, foreign, malformed, terminal, or non-current Track
selectors collapse to the same unavailable result so the API cannot enumerate another workspace or
historical aggregate.

## 4. Deterministic preview and blockers

The preview is clock-free. It reports:

- parent Plan ID, lifecycle, weekly capacity, and aggregate version;
- target Track ID/key/title, lifecycle, priority, protected minimum, and aggregate version before
  and after the proposed transition;
- active Track count, active protected-minimum total, and flexible minutes before and after;
- SHA-256 fingerprints of the active Track constraint inputs before and after the proposed
  transition, using D2a's versioned UUID-order, Track-version, lifecycle, and minimum protocol;
- `canApply`, zero or one stable blocking reason, zero or one deterministic warning, and the fixed
  Planning recalculation effect.

Resume has one stable blocker: `ACTIVE_TRACK_MINIMUM_EXCEEDS_CAPACITY` with the exact
`minimumCapacityMinutes` when the active protected-minimum sum would exceed Plan capacity.

A blocked preview has no apply control. `PARENT_GROWTH_PLAN_PAUSED` is a warning, not a blocker: it
explains that the saved Track will become active but Today remains paused until the parent resumes.

The `learning-track-lifecycle-preview-digest/1.0.0` input uses ordered, length-prefixed UTF-8 fields
and binds contract/digest versions, resolved workspace/Plan/Track identities, operation, reason,
both expected versions, parent state, Track before/after state, both constraint summaries and
fingerprints, applicability/blocker, warning, and the fixed consumer. Apply never trusts the digest
as authority; it locks, rebuilds the preview from current state, and requires an exact match.

## 5. Atomic owner command

Public APIs are actor-scoped `SECURITY DEFINER` functions owned by `pando_planning_api`, with empty
search paths and execute granted only to `authenticated`. D2b1's private builders and validators
remain unavailable to browser and service roles. No new table or RLS policy is required; the existing
forced-RLS Track table receives only the narrow lifecycle/version/timestamp update grant.

Apply uses command type `planning.change_learning_track_lifecycle` and this order:

1. validate scalar syntax; resolve actor and personal workspace; hash the exact request;
2. lock actor/command/idempotency key and replay only an identical completed request;
3. take `planning-workspace:<workspace UUID>`;
4. lock the current Plan, then every child Track including terminal rows in UUID order;
5. resolve the submitted key within that locked current Plan; recheck both expected versions,
   transition, current invariant, projected capacity limit, and exact digest;
6. insert the started receipt and update only target Track lifecycle, aggregate version, and
   timestamp, requiring exactly one affected row;
7. append one minimal event and exactly one fixed `planning.plan_snapshot_v1` delivery;
8. complete exactly one receipt row with the stored response and commit all effects together.

The Growth Plan and sibling aggregate versions do not change. Plan version and both active Track
fingerprints are constraint preconditions. Any stale Plan, target, sibling, digest, authorization,
event, delivery, or row-count failure rolls back every effect.

## 6. Event and UI behavior

The new exact `planning.input_changed` V1 payload is:

```json
{
  "change_kind": "TRACK_LIFECYCLE_CHANGED",
  "growth_plan_id": "<uuid>",
  "learning_track_id": "<uuid>",
  "learning_track_version": "<positive bigint string>",
  "lifecycle": "ACTIVE|PAUSED"
}
```

Its envelope aggregate is `planning.learning_track` with the changed Track UUID/version. It carries
no title, key, reason, minimum, Evidence, or Today body.

`/plan` adds a “Learning tracks” section from the separate read. Each Track shows its current state,
priority, protected minimum, and one pause/resume action. The chosen action follows the existing
reason -> exact preview -> explicit confirmation flow. Starting any Plan, capacity, or Track
preview dismisses every older confirmation and rotates only that intent's idempotency key; retrying
the same apply keeps its key. A blocked resume explains the exact capacity limit and exposes no
confirmation. A stale apply offers one current-plan reload. Successful apply
refreshes `/plan` and `/today` and reports recalculation as pending.

## 7. Required proof

D2b1 is complete only when tests prove:

- strict current-read, preview, apply, and minimal-event valid/boundary/blocked/invalid/malicious
  contracts plus semantic transition/version/constraint checks;
- active-to-paused and paused-to-active under active and paused parents, exact-capacity resume,
  over-capacity blocking, no-op/terminal/archived refusal, compact-portfolio fail-closed reads, and
  exclusion of all non-active sibling minima;
- no preview side effects; TypeScript/PostgreSQL digest and before/after fingerprint agreement;
  stale Plan, target, and active-sibling refusal;
- same-key replay, changed-request conflict, different-key concurrency, D2a capacity-versus-resume
  serialization, and injected event/delivery rollback;
- two-workspace positive and negative isolation, non-enumerating selectors, least privilege, exact
  row counts, one Track version increment, unchanged Plan/siblings/history, one event, and one fixed
  delivery;
- server actions ignore injected authority/constraint fields and collapse errors safely;
- keyboard, 320-pixel responsive, touch-target, reduced-motion, forced-colors, and WCAG A/AA UI
  behavior, including blocked resume with no apply control;
- a real isolated signed-in pause/resume/reload/persistence journey; and full repository,
  database, auth, and relevant backup release gates before merge.

## 8. Recorded adjacent security follow-up

The older `planning.add_learning_track_activity_impl_v1` still grants direct execute to
`authenticated` because its public wrapper is `SECURITY INVOKER`. This predates the D0 rule that
private owner helpers are not alternate public surfaces. D2b1 does not copy or silently redesign
that existing API. A separate bounded hardening outcome should convert the wrapper/ownership model,
revoke the direct helper grant, and rerun its authorization/concurrency gates.
