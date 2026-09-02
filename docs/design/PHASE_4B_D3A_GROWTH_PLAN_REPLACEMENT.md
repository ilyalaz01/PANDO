# Phase 4B D3a — Growth Plan replacement

Status: accepted implementation design

Date: 2026-09-02

Parent design: [Phase 4B lifecycle and editing commands](PHASE_4B_LIFECYCLE_COMMANDS.md)

Decision record:
[ADR-0010](../adr/0010-lifecycle-replacement-availability-and-campaign-semantics.md) §1 and §9

Prior slices: [D1b first Growth Plan setup](PHASE_4B_D1B_FIRST_GROWTH_PLAN_SETUP.md) and [D2b3
additional Learning Track creation](PHASE_4B_D2B3_ADDITIONAL_LEARNING_TRACKS.md)

## 1. Outcome and boundary

D3a lets a person who already has a Growth Plan start a new one without losing anything and without
ever leaving the workspace without a current Plan. One atomic command archives the outgoing Plan and
creates the incoming current Plan with one initial Learning Track derived from an explicitly chosen
active Readiness Goal.

This is the smallest reversible D3 slice named by ADR-0010 §9. It is clock-free, introduces no
calculation contract, no database extension, no availability window, no Campaign, and no
coordinator. It writes no Targets row.

Replacement is the only path to an archived Growth Plan. There is no standalone archive command, so
an initialized workspace always has exactly one current (`active | paused`) Plan.

## 2. Accepted semantics

- Replacement requires exactly one current Plan. Zero current Plans is first setup, not replacement.
- The outgoing Plan becomes `archived` and its `aggregate_version` advances exactly once. Archived
  Plans are already refused by every released Plan and Track command.
- The outgoing Plan's Learning Tracks, Track activity attributions, Focus sessions, Evidence,
  Mastery, Reviews, and immutable `PlanSnapshot` history are retained unchanged. Track lifecycle
  values are **not** rewritten: a Track under an archived Plan is frozen exactly as the person left
  it, and its editing is already refused because the parent is archived.
- Nothing is copied. The incoming Plan starts with exactly one new Track, in the same shape as first
  setup: Plan title is the authoritative Goal title, Track title is `btrim(left(goal title, 160))`,
  protected minimum `0`, cadence `0`, no admitted activities.
- Both new identifiers are derived deterministically from the workspace, command type, idempotency
  key, and a fixed label, so a retry cannot create a second Plan. The Track key binds its derived
  UUID, which keeps the workspace-unique `track_key` and `candidate_key` constraints satisfiable
  after replacement.
- Historical Focus sessions keep their original immutable Track attribution. The already released
  completed-work normalization counts such a session as consumed weekly capacity and grants it no
  cadence credit once its activity no longer belongs to a current Track, so replacement mid-week
  neither fabricates nor erases completed work.
- The Planning current-snapshot pointer is not rewritten by the command. The previous snapshot stays
  valid history that references the archived Plan, and Planning freshness is honestly `PENDING`
  until the ordinary projection catches up.
- Replacement makes no Evidence, Mastery, readiness, Goal, or outcome claim. It is a Planning
  lifecycle decision only.

## 3. Contracts

Three additive contracts keep every released contract's meaning unchanged:

- `GrowthPlanReplacementSourceV1` — actor-scoped current read with zero authority input;
- `GrowthPlanReplacementPreviewV1` — deterministic clock-free preview with an exact digest;
- `GrowthPlanReplacementApplyResultV1` — applied result.

### 3.1 Source

States:

| State | Meaning |
|---|---|
| `REPLACEMENT_AVAILABLE` | exactly one current Plan and at least one eligible active Goal |
| `NO_CURRENT_PLAN` | uninitialized workspace; first setup owns this case |
| `NO_ACTIVE_GOALS` | no active Readiness Goal with a published or retired profile version |
| `GOAL_PORTFOLIO_OVERFLOW` | more than 20 active Goals, the released setup bound |

`REPLACEMENT_AVAILABLE` returns the current Plan's title, lifecycle, weekly capacity, and aggregate
version; bounded Track counts by lifecycle plus the total; the same bounded Goal list the released
setup source returns; and the single capability `replace_growth_plan`. More than one current Plan is
a corrupt state and fails closed.

### 3.2 Request

The browser submits only:

- readiness goal key and its exact expected aggregate version;
- the exact expected current Growth Plan version;
- weekly capacity minutes `0..10080`, default session minutes `1..480`, Track priority `0..100`;
- a trimmed printable reason of 1..500 characters;
- a lowercase v4 request UUID as the idempotency key;
- at apply time, the exact server-issued preview digest.

Workspace, Plan identity, Track identity, Goal identity, and profile version are resolved on the
server. No client input selects them.

### 3.3 Preview

The preview reports the outgoing Plan, its retained Track counts and child-Track fingerprint, the
incoming Plan and Track, lifetime and current Plan counts before and after, applicability, blocking
reasons, warnings, retained history, and the pending recalculation state.

Blocking reasons:

- `NO_CURRENT_GROWTH_PLAN`;
- `PLANNING_CREATE_IDENTITY_COLLISION`.

Warnings are additive and never block:

- `ARCHIVED_PLAN_IS_READ_ONLY` — always;
- `CURRENT_TRACKS_NOT_COPIED` — when the outgoing Plan has at least one non-archived Track;
- `INITIAL_TRACK_HAS_NO_ACTIVITIES` — always.

The digest binds the contract and digest versions, workspace, operation, command type, idempotency
key, reason, both expected versions, every resolved Goal and profile field, the outgoing Plan state,
the child-Track fingerprint and counts, the incoming Plan and Track state, applicability, warnings,
retained facts, and the recalculation statement. It contains no clock-derived value.

## 4. Atomic owner command

Command type `planning.replace_growth_plan_v1`, operation `replace_growth_plan`.

1. Resolve actor and personal workspace from the authenticated session.
2. Validate scalar syntax and compute the canonical request hash, which binds both derived
   identifiers and the preview digest.
3. Serialize `(actor, command type, idempotency key)`; replay only an identical completed request.
4. Take `planning-workspace:<workspace UUID>`.
5. Lock every Growth Plan row of the workspace in stable identifier order, then every Learning Track
   of the outgoing Plan.
6. Re-resolve the Targets Goal source through the released bounded owner query and refuse a stale
   Goal version.
7. Rebuild the preview from locked state; require `canApply`, the exact digest, the exact expected
   Plan version, and both derived identifiers.
8. Update the outgoing Plan to `archived` and advance its version by exactly one.
9. Insert the incoming Plan and its initial Track, both at version `1`.
10. Append one validated `planning.input_changed` event and one fixed `planning.plan_snapshot_v1`
    delivery.
11. Complete the receipt response and commit every effect together.

The unique partial index `one_current_growth_plan_per_workspace` remains satisfied because the
archive statement precedes the insert inside the same transaction.

Event payload:

```json
{
  "change_kind": "PLAN_REPLACED",
  "archived_growth_plan_id": "<uuid>",
  "archived_growth_plan_version": "<positive bigint string>",
  "growth_plan_id": "<uuid>",
  "learning_track_id": "<uuid>",
  "readiness_goal_id": "<uuid>",
  "profile_version_id": "<uuid>"
}
```

The envelope aggregate is the incoming `planning.growth_plan` at version `1`. The event carries no
title, reason, capacity, Track history, Evidence, Mastery, or Today payload.

## 5. Manual UX

`/plan` gains a separate `Replace this Growth Plan` control beside the released Plan controls.

- It is available only when the source reports `REPLACEMENT_AVAILABLE`.
- It uses the same two-step discipline as every released control: choose a target and capacity, read
  the exact preview, then confirm with the returned digest.
- The preview copy states plainly that the current Plan is archived and stays readable, that its
  Tracks are not copied, that Evidence, Mastery, Reviews, and history are retained, and that Today
  recalculation will be pending.
- Changing any replacement intent dismisses a stale confirmation, and a sibling Plan intent
  dismisses a replacement confirmation.
- Keyboard, 320-pixel, touch-target, reduced-motion, forced-colors, and WCAG A/AA behavior match the
  released controls.

## 6. Required proof

D3a is complete only when tests prove:

- valid, boundary, invalid, and malicious source, preview, apply, and event contracts;
- replacement from an `active` and from a `paused` current Plan;
- refusal with no current Plan, a stale Plan version, a stale Goal version, a changed digest, an
  inactive Goal, a malformed selector, and a reused key with a different request;
- same-key replay returns the stored response and creates nothing new;
- exactly one archived Plan, exactly one new Plan and Track, one Plan version increment, unchanged
  Track rows of the archived Plan, and unchanged sentinel;
- atomic receipt, event, and delivery behavior, and full rollback on an injected failure;
- serialization against capacity, lifecycle, terminal lifecycle, creation, cadence, and admission
  commands on the same workspace;
- two-workspace positive and cross-workspace negative forced-RLS isolation;
- the released first-setup source no longer treats a replaced workspace as corrupt;
- `/plan` keyboard, responsive, reduced-motion, forced-colors, and accessibility behavior;
- repository gates proportionate to the change before merge.

## 7. Deferred

Deferred to D3b and later: availability windows, capacity composition, the persisted clock-bound
proposal, Campaign persistence, allocation overrides, the campaign lifecycle coordinator, and any
Track migration between Plans.
