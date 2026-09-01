# Phase 4B D2b2 — Learning Track priority and protected minimum

Status: implemented

Date: 2026-09-01

Parent design: [Phase 4B lifecycle and editing commands](PHASE_4B_LIFECYCLE_COMMANDS.md)

Capacity basis: [D2a Growth Plan weekly-capacity control](PHASE_4B_D2A_GROWTH_PLAN_CAPACITY.md)

Lifecycle basis: [D2b1 Learning Track pause/resume](PHASE_4B_D2B1_LEARNING_TRACK_LIFECYCLE.md)

## 1. Outcome and boundary

D2b2 lets a signed-in person change one current Learning Track's priority and protected weekly
minimum through Planning's existing exact-preview and explicit-confirmation discipline. Both
resulting values are supplied to one atomic `set_track_priority_minimum` command so a client cannot
observe or persist an intermediate combination.

This increment does not add Track creation, cadence, default-session editing, terminal lifecycle
commands, availability, Campaigns, Agent Control transport, or natural-language interpretation.
It does not extend the already released lifecycle preview or reinterpret Agent Control V1.

The parent D0 design used the future name `set_track_cadence` for cadence, protected minimum, and
priority together, while its accepted delivery order explicitly places priority and protected
minimum before cadence is defined. D2b2 resolves that implementation gap narrowly: priority and
protected minimum receive their own versioned command now; cadence remains unset and requires its
own later semantics. This is a focused design clarification, not a new product rule or ADR.

## 2. Values, lifecycle, and capacity semantics

- Priority is an inclusive integer in `0..100`. It is the existing Track contribution to Planning
  ranking, not a percentage, strict quota, or promise of Today order.
- Protected minimum is an inclusive integer in `0..10080` weekly minutes. It reserves capacity only
  while the Track is `active`.
- The target must be a current `active|paused` Track under the one current `active|paused` Growth
  Plan. Completed or archived Tracks and an archived parent are unavailable and non-enumerating.
- One value may remain unchanged when the other changes. Proposing the exact current pair is an
  invalid no-op. A replay of the identical completed request still returns the stored response.
- An active target's proposed minimum applies immediately. The projected sum of minima across all
  active Tracks must not exceed the current Plan capacity. Equality is valid; no value is clamped.
- A paused target remains excluded from active capacity and Today ranking. Its settings may be
  saved even when resuming it would exceed current capacity; the preview reports that future
  consequence without blocking the edit. Resume continues to revalidate the invariant through
  D2b1.
- A paused parent does not relax the persisted active-child capacity invariant. Settings remain
  editable, but Today continues to exclude every parent-Track source until the Plan resumes.
- The compact portfolio still fails closed above 30 current `active|paused` Tracks. D2b2 is not an
  administrative repair path for corrupted state.

Changing these user-owned inputs does not change the meaning or coefficients of
`planning-policy/0.1` or `planner-engine/0.1.0`; it schedules an ordinary recalculation under those
versions. No policy or engine version changes.

## 3. Separate versioned contract

D2b2 reuses `CurrentLearningTracksV1` unchanged for the opaque `trackKey`, current values, stable
order, and Plan/Track version fences. Lifecycle capabilities keep their D2b1-only meaning.

A separate `LearningTrackPriorityMinimumControlV1` schema contains:

- `LearningTrackPriorityMinimumPreviewV1`, with operation, reason, both expected versions, parent
  Plan state, exact Track before/after state, constraint and ordering consequences, applicability,
  warnings, retained-history facts, pending recalculation, and digest;
- `LearningTrackPriorityMinimumApplyResultV1`, with the resulting Track, command ID, one event, one
  fixed Planning delivery, and honest `PENDING` projection state.

The preview is clock-free. The Track version advances by exactly one in `after`; its key, title,
lifecycle, and parent stay unchanged. The constraint contains:

- active Track count, active protected-minimum total, flexible minutes, and D2a-format active-Track
  fingerprint before and after;
- the active count and minimum capacity that would result if the target were active after the
  change, plus whether that state fits current capacity;
- a bounded current-Track order fingerprint and the target's one-based position before and after,
  using `priority DESC`, `track_key COLLATE "C"`, then Learning Track UUID.

The order fingerprint includes every current Track's UUID, aggregate version, lifecycle, priority,
and key. It prevents a concurrent priority change—including one on a paused sibling—from silently
invalidating the exact ordering effect while leaving the active-capacity fingerprint unchanged.

An active edit above capacity returns `canApply = false` with one
`ACTIVE_TRACK_MINIMUM_EXCEEDS_CAPACITY` blocker and exact `minimumCapacityMinutes`. It exposes no
apply control. Warnings are ordered and may include:

1. `PARENT_GROWTH_PLAN_PAUSED`;
2. `LEARNING_TRACK_PAUSED`;
3. `PAUSED_TRACK_RESUME_WOULD_EXCEED_CAPACITY`, with exact `minimumCapacityMinutes`.

The last warning is nonblocking because the saved paused Track does not consume capacity. The
future resume remains a separate explicit command.

## 4. Digest and freshness

`learning-track-priority-minimum-preview-digest/1.0.0` uses the existing ordered,
length-prefixed UTF-8 field protocol. It binds:

- digest, contract, active-capacity-fingerprint, and current-order-fingerprint versions;
- resolved workspace, Plan, and Track identities;
- operation, reason, both expected aggregate versions, and parent state;
- every before/after Track field;
- active constraints and fingerprints before/after;
- hypothetical active constraint, applicability, blocker, ordered warnings, exact positions, and
  order fingerprints;
- retained-history facts, `PENDING`, and `planning.plan_snapshot_v1`.

The browser never constructs this digest. Apply locks authoritative state, rebuilds the preview,
and requires an exact match. The digest is freshness evidence, never authority.

## 5. Owner command and security boundary

The public actor-scoped APIs accept only:

- `trackKey`;
- proposed priority and protected-minimum integers;
- expected Growth Plan and Learning Track versions;
- reason;
- for apply, the exact preview digest and idempotency key.

Workspace, Plan/Track UUIDs, lifecycle, current values, capacity, sibling inputs, fingerprints,
positions, blockers, warnings, and projected state are always server-resolved.

Apply uses command type `planning.set_learning_track_priority_minimum` and this order:

1. validate scalar syntax, resolve actor and personal workspace, and hash the exact request;
2. serialize `(actor, command type, idempotency key)` and replay only an identical completion;
3. take `planning-workspace:<workspace UUID>`;
4. lock the current Plan, then every child Track including terminal rows in UUID order;
5. resolve the current target, recheck both versions and the 30-current-Track bound, and rebuild the
   exact preview including both fingerprints;
6. require an applicable exact digest, insert the started receipt, and update only target priority,
   protected minimum, aggregate version, and timestamp with an exact one-row check;
7. append one validated event and one fixed `planning.plan_snapshot_v1` delivery;
8. complete exactly one receipt and commit all effects together.

The Growth Plan and sibling versions remain unchanged. The Plan version, target version, active
fingerprint, and order fingerprint are preconditions. This shared workspace/all-Track lock
serializes D2a capacity, D2b1 lifecycle, activity admission, and D2b2 settings without write skew.

Public RPCs are `SECURITY DEFINER`, owned by `pando_planning_api`, use an empty `search_path`, and
are executable only by `authenticated`. Private builders, fingerprint helpers, and validators are
unavailable to `PUBLIC`, `anon`, `authenticated`, and `service_role`. Planning receives only the
column update privileges required by this command and no grant on another bounded context.

## 6. Event and projection behavior

Apply emits `planning.input_changed` V1 on aggregate `planning.learning_track`. Its exact payload is:

```json
{
  "change_kind": "TRACK_PRIORITY_MINIMUM_CHANGED",
  "growth_plan_id": "<uuid>",
  "learning_track_id": "<uuid>",
  "learning_track_version": "<positive bigint string>",
  "priority": 80,
  "protected_minimum_minutes": 120
}
```

Both resulting values travel because this command defines them atomically. The event carries no
title, key, reason, fingerprints, personal content, Evidence, or Today body. The ordinary Planning
worker reloads owner state and is the only component that may publish a current snapshot.

## 7. Manual UI behavior

`/plan` keeps the existing Track cards and displays each current priority and protected minimum. A
separate native form selects one returned Track key, accepts both integer values and a reason, then
shows the exact comparison before confirmation. It uses no modal, slider, drag interaction, or
per-card duplicate form.

Starting or changing any Plan, capacity, lifecycle, or settings intent removes every older
confirmation. A new settings intent rotates only its idempotency key; retrying the same apply keeps
the key. Blocked active-minimum previews show the exact capacity requirement and no confirmation.
Paused warnings explain when changes start affecting Today and whether resume would currently fit.
A stale apply offers a current Plan/Track reload. Success refreshes `/plan` and `/today` while
reporting recalculation as pending.

## 8. Required proof

D2b2 is complete only when tests prove:

- strict valid, boundary, blocked, invalid/no-op, and malicious control/event contracts;
- deterministic TypeScript/PostgreSQL digest, active fingerprint, and current-order fingerprint
  agreement, plus sensitivity to every bound field;
- priority/minimum boundaries, one-field changes, active exact-capacity success, active over-capacity
  blocking, paused high-minimum success/warnings, parent-paused behavior, and terminal refusal;
- side-effect-free preview; stale Plan, target, active sibling, and ordering-only sibling refusal;
- same-key replay, changed-request conflict, same-target concurrency, and serialization against D2a
  capacity, D2b1 lifecycle, and activity admission;
- one target version increment, unchanged Plan/siblings/history, one event, one delivery, and full
  rollback after injected event/delivery failure;
- forced-RLS isolation, non-enumerating foreign selectors, exact public/private privilege matrix,
  and real denied private-helper calls;
- property tests over bounded Track portfolios showing that only projected active minima block and
  priority never changes the capacity sum;
- server actions ignore injected authority/constraint fields and collapse errors safely;
- keyboard order, number-input labels/errors, 320-pixel layout, 44-pixel targets, reduced motion,
  forced colors, WCAG A/AA, stale reload, and blocked preview with no apply control;
- a real isolated signed-in preview/apply/reload persistence journey; and full repository,
  database, auth, and backup release gates before merge.

No production dependency is required. The migration is additive; rollback removes the UI entry
point and public functions while retaining already saved Track values and immutable history.
