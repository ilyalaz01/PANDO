# Phase 4B D2a — Growth Plan weekly-capacity control

Status: accepted implementation design  
Date: 2026-09-01  
Parent design: [Phase 4B lifecycle and editing commands](PHASE_4B_LIFECYCLE_COMMANDS.md)

## 1. Outcome and boundary

D2a lets a signed-in person change the default weekly capacity of the one current Growth Plan
through Planning's existing preview, explicit confirmation, and atomic apply protocol. It does not
add Learning Track editing, cadence, availability, Campaigns, Agent Control transport, or automatic
interpretation of text.

The browser supplies only the proposed integer capacity, expected Growth Plan version, reason,
preview digest, and idempotency key. The authenticated Planning boundary resolves the actor,
personal workspace, current Growth Plan, and every Learning Track used by the constraint. No
workspace, plan, or track identity is accepted from the browser.

## 2. Capacity invariant

The persisted weekly capacity is an inclusive integer in `0..10080` minutes and must be greater
than or equal to the sum of `protected_minimum_minutes` across every `active` Learning Track in the
current Growth Plan.

- A paused, completed, or archived Track contributes zero to this constraint.
- Pausing the parent Growth Plan does not change Track lifecycle and does not relax the persisted
  invariant.
- Capacity exactly equal to the active protected-minimum total is valid.
- Capacity below already consumed minutes remains valid: completed history is retained and the
  recalculated remaining capacity clamps to zero.
- A no-op proposal equal to the current capacity is invalid.
- Planning never silently clamps capacity or rewrites a Track minimum.

This is not a new product rule. It applies the accepted D0 blocking rule to the aggregate definition
already enforced by `planner-engine/0.1.0`. Agent Control's V1 context model carries Track lifecycle,
but its pre-implementation semantic validator currently sums terminal and paused Tracks too; D2a
corrects that validator to the same canonical active-only rule. No ADR or policy version change is
required because calculation eligibility and scoring do not change.

## 3. Versioned preview contract

D1's `GrowthPlanLifecyclePreviewV1` remains unchanged. D2a adds a separate
`GrowthPlanCapacityPreviewV1` so the released lifecycle contract and digest protocol do not gain a
new meaning in place.

The capacity preview contains:

- operation `set_default_capacity`, required reason, and expected Growth Plan version;
- exact before/after Growth Plan state;
- active Track count, summed protected minimum, flexible minutes before/after, and a canonical
  fingerprint of the ordered active Track constraint inputs;
- one `canApply` flag and zero or one typed blocking reason;
- retained history/evidence facts and the honest `PENDING` recalculation effect;
- a SHA-256 digest over the contract/digest versions, resolved workspace and plan, operation,
  reason, before/after state, constraint summary/fingerprint, and recalculation effect.

An in-range proposal below the protected total returns a non-applicable preview with
`ACTIVE_TRACK_MINIMUM_EXCEEDS_CAPACITY`, the proposed capacity, and the exact required minimum. It
has no confirm/apply control. Out-of-range, fractional, malformed, and no-op requests are rejected
as invalid input.

The active-Track fingerprint is calculated from the active Track IDs, aggregate versions,
lifecycles, and protected minima in UUID order. It is a preview freshness input, not authority and
not a replacement for row locking or invariant revalidation.

## 4. Atomic apply

Apply follows the D1 command protocol with a distinct command type and idempotency namespace:

1. Validate scalar syntax and request hash, then resolve actor and personal workspace from the
   session.
2. Lock the actor/command/idempotency key and replay only an identical completed request.
3. Take the existing Planning workspace advisory lock.
4. Lock the current Growth Plan and all of its Learning Tracks in stable UUID order.
5. Rebuild the capacity preview from locked state and require `canApply = true`, the expected Growth
   Plan version, exact digest, and the capacity invariant.
6. Insert the started receipt; update only `weekly_capacity_minutes`, Growth Plan aggregate version,
   and timestamp.
7. Insert one minimal `planning.input_changed` event with change kind
   `PLAN_CAPACITY_CHANGED`, plus exactly one fixed `planning.plan_snapshot_v1` delivery.
8. Complete the receipt and commit all effects together.

Any validation, stale-input, digest, concurrency, authorization, event, or delivery failure rolls
back state, receipt, event, and delivery. Apply returns the saved Growth Plan plus `PENDING`; only
the ordinary Planning worker may publish a current Today snapshot.

## 5. UI behavior

`/plan` keeps the D1 lifecycle flow and adds one separate “Edit weekly capacity” form using the
same two-step interaction discipline:

1. enter whole minutes and a reason;
2. inspect the exact before/after capacity, protected total, flexible remainder, and version;
3. confirm the exact digest or start over.

A blocked preview explains the required minimum without exposing private Track data and offers no
apply button. A stale apply disables confirmation and offers a current-plan reload. Starting a new
preview replaces the old confirmation and rotates the idempotency key; retrying the same apply keeps
the same key. Successful apply refreshes `/plan` and `/today` and reports recalculation as pending.

## 6. Required proof

D2a is complete only when tests prove:

- inclusive range boundaries, exact-minimum acceptance, aggregate active-minimum blocking, and
  exclusion of paused/completed/archived Tracks, including a paused parent plan;
- side-effect-free previews, deterministic TypeScript/PostgreSQL digest agreement, changed
  constraint fingerprint, stale plan/digest refusal, replay, changed-request conflict, concurrency,
  two-workspace isolation, and injected full rollback;
- one Growth Plan version increment, one minimal capacity event, and one fixed Planning delivery;
- strict valid, boundary, blocked, invalid, and malicious contracts/events;
- no browser-selected authority fields and safe server error collapse;
- keyboard, 320-pixel, reduced-motion, forced-colors, and WCAG A/AA UI behavior;
- a real signed-in preview/apply/reload/persistence path in the isolated auth gate;
- the repository `verify`, `verify:db`, `verify:auth`, and relevant backup gate.
