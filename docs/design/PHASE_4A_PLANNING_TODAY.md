# Phase 4A — Planning and Today implementation design

Status: Accepted implementation design
Canonical authority: [Domain Model](../01_DOMAIN_MODEL.md),
[Product and UX Specification](../02_PRODUCT_AND_UX_SPEC.md), and
[MVP Delivery Plan](../04_MVP_DELIVERY_PLAN.md)

## 1. Outcome

Phase 4A delivers the first deterministic daily-plan vertical slice without pretending that a UI
composition or fixture is authoritative Planning state:

1. Planning owns a pure, versioned candidate-ranking engine and `PlanSnapshotV1` contract.
2. Planning persists one current (`active` or `paused`) Growth Plan, its Learning Tracks, capacity, immutable snapshots,
   and a current pointer before a live Today route consumes them.
3. Owner-scoped queries normalize current Targets readiness, Review urgency, Overlay activity
   candidates, and completed meaningful work. Planning never reads another module's private table.
4. `/today` renders one Planning-owned read model, links exact actions into the existing Focus
   lifecycle, and links due work into the existing Review queue.

The first implementation increment is deliberately the pure engine plus its policy, golden fixture,
and invariant tests. It adds no live recommendation until persistence and input loading can make the
result reproducible.

## 2. Scope and non-scope

### Phase 4A scope

- one current personal Growth Plan (`active` or `paused`) and at least one Learning Track before
  target-based ranking;
- weekly capacity, per-track priority, and protected minimum minutes;
- remaining weekly capacity plus an optional explicit same-session duration/energy preference;
- zero to 30 exact goal/profile readiness inputs, due Review signals, active Focus-compatible personal
  activities, prerequisite state, recent repetition, and completed meaningful minutes;
- deterministic filtering, scoring, stable tie-breaking, structured score factors, plain-language
  reasons, one primary action, and at most four alternatives;
- immutable `PlanSnapshotV1` history with engine/policy/input versions and a current pointer;
- responsive, keyboard-accessible Today current, empty, paused, zero-capacity, rebuilding, stale,
  failed, and no-candidate states;
- direct Today-to-Focus navigation that preserves snapshot, candidate, single-track attribution,
  and the exact authorized readiness-goal/activity pair.

### Deferred from Phase 4A

- Interview Campaign creation and lifecycle, requirement/allocation override commands;
- dated availability editing, default energy assumptions, plan/track lifecycle UI, and
  deterministic before/after ChangeSet preview;
- Preparation Pack activation, Agent Control transports, and MCP/CLI tools;
- canonical Catalog activities/resources. The initial live candidate boundary uses active accepted
  `User Overlay` activities that the existing Focus command already authorizes;
- substitute/defer recommendation commands and automatic calendar scheduling.

These remain Phase 4B/4C or Phase 5 work. No inert control is rendered before its command exists.

## 3. Ownership and interaction map

| Fact or behavior | Owner | Planning consumes it as |
| --- | --- | --- |
| Growth Plan, tracks, capacity, ranking, snapshot | Planning | authoritative local state |
| active readiness goal/profile/deadline and readiness | Targets | bounded current-only query |
| due/overdue item and optional Focus reference | Review | bounded urgency query |
| accepted personal activity and mapping | User Overlay | bounded candidate query |
| prerequisite structure | Catalog | exact-version bounded query |
| prerequisite satisfaction and Unknown state | Mastery | bounded state query |
| completed meaningful minutes and repetition | Sessions/Evidence | bounded aggregate query |
| Focus start/finish | Sessions/Evidence coordinator | exact link; never a Planning write |

Cross-context data is normalized by application adapters into `PlanningCalculationInputV1`. The
Planning domain imports no other bounded context and performs no I/O.

## 4. Versioned calculation contract

The pure engine receives:

- one explicit workspace-local week/evaluation horizon and one canonical SHA-256 input fingerprint;
- bounded owner source revisions for Catalog, Evidence, Focus, Mastery, Overlay, and Review; the
  fingerprint is computed over the whole normalized contract with set-like collections in canonical
  order;
- the version of the completed-work input-normalization policy, so a change to how consumed
  capacity, per-track cadence credit, or recent repetition is counted always produces a new
  fingerprint and a new snapshot;
- zero or one non-archived Growth Plan, its versioned tracks, weekly capacity, and work consumed in
  the current workspace-local week;
- an optional explicit session limit and energy preference; null means Unknown and contributes no
  fabricated fit score;
- one current active Focus reference, which takes precedence as a Resume action;
- zero or one active campaign-shaped priority overlay (accepted by the engine contract but not yet
  persisted by Phase 4A);
- zero to 30 exact readiness-goal/profile entries, each containing current Targets snapshot
  identity/freshness/confidence or a typed unavailable reason; a no-plan input uses an empty list
  rather than a fabricated goal, and Unknown gaps never become numeric zero;
- a bounded set of active Focus-compatible candidate activities with exact goal/activity keys,
  one optional track attribution, prerequisite state, Planning-persisted estimated effort, nullable
  energy, repetition, and source signals;
- bounded Review urgency already correlated to a Focus-compatible candidate when possible.

The engine returns `PlanSnapshotV1` with:

- engine/policy versions, canonical calculation/valid-until instants, workspace-local week horizon,
  and exact input fingerprint;
- recommendation state and any fail-closed warnings;
- capacity summary and Review counts;
- one ordered action list of at most five entries;
- exact Focus identifiers, single track attribution, duration provenance, nullable energy, canonical
  source signals, base score, score factors, bounded causal references, expected benefit, and
  deterministic explanation;
- readiness snapshot/profile identity, freshness, confidence, bounded blocker list/counts, and a
  policy-ranked critical gap reference when available. Planning does not invent blocker severity.

The domain engine does not create database UUIDs, read the current time, localize text through a
model, or persist anything.

## 5. Eligibility and ranking policy v0.1

The initial policy is transparent and intentionally provisional. Exact values are recorded in
[Planning Policy v0.1](../policies/PLANNING_POLICY_V0.1.md).

Eligibility is evaluated before score:

1. An already active Focus Session becomes the only recommendation until it ends.
2. The activity and referenced goal are active and Focus-compatible.
3. Target-backed track/campaign sources require the exact goal/profile readiness entry to be
   current. A due Review may survive rebuilding/stale/error, but not `GOAL_INACTIVE`.
4. `BLOCKED` prerequisites exclude the candidate. `UNKNOWN` prerequisites remain eligible with a
   warning and penalty rather than being fabricated as satisfied.
5. The duration must fit remaining weekly capacity and an optional explicit session limit. Capacity
   still needed for active protected track minima is reserved: unrelated campaign/Review work can
   use only the flexible remainder, while a candidate can use only its single track's own deficit.
   Zero remaining capacity or a zero session limit yields no new recommendation.
6. A paused Growth Plan contributes no track source, but an independently due Review may remain.

Eligible candidates receive additive integer points for mandatory-floor reduction, other target
gaps, Review urgency, protected-minimum deficit, track priority, deadline pressure, prerequisite
unlock value, and energy fit. Repetition, unknown prerequisites, and energy mismatch are explicit
penalties. Integer points avoid floating-point ranking drift. Final order is score descending,
duration ascending, then stable candidate key. The top entry is primary; the next four are
alternatives. The engine never invents alternatives when fewer valid candidates exist.

## 6. Persistence and recalculation

The persistence increment adds additive Planning-owned tables:

- `planning.growth_plans` with a partial unique constraint for one current (`active` or `paused`)
  plan per workspace;
- `planning.learning_tracks` with exact immutable roadmap/profile references where applicable;
- `planning.learning_track_activities` with one track attribution and persisted duration/nullable
  energy metadata, so calculation adapters never fabricate effort or energy;
- `planning.plan_snapshots` as immutable calculation history;
- `planning.current_plan_snapshots` as the only mutable projection-state/pointer row; initialization
  creates its workspace sentinel before the first calculation, with a nullable snapshot ID,
  monotonic `pointerVersion`, and applied attempt ID;
- `planning.plan_action_selections` as immutable, opaque server-issued selectors for the at most
  five actions of one snapshot; each row binds workspace, snapshot, candidate, rank, exact Focus
  pair, `actionKind`, nullable `focusSessionId`, optional track, planned minutes, and expiry;
- a Planning delivery/source ledger that records each fixed-consumer delivery as uncovered,
  covered-by-pointer-version, or superseded for idempotent event-triggered recalculation.

One backend-only idempotent `initialize_growth_plan_v1` command creates the initial plan and track
atomically from an already authorized active Readiness Goal. It is the same owner command later used
by onboarding and Preparation Pack activation; it is not a fixture-only shortcut. It records the
chosen weekly capacity and default session duration instead of inventing them in a read query.

The idempotent `add_learning_track_activity_v1` command admits one existing accepted User Overlay
activity to one current active or paused Learning Track. The caller supplies only stable Track and
activity keys, explicit Planning-owned duration, nullable energy, expected Track version, and an
idempotency key; workspace, goal/profile identities, custom activity UUID, and candidate key are
server-derived. Targets and Overlay revalidate the exact active goal/profile/activity through
fenced owner queries. The command increments the Track version, preserves the Growth Plan version,
and emits a Track-versioned `planning.input_changed` event with one fixed Planning delivery. It
rejects the 201st non-archived plan activity rather than allowing the worker to truncate input.

Ordinary input commands, including activity admission, do not null or advance the current snapshot
pointer. Their due delivery makes Today pending and may leave an unexpired prior snapshot available
only as `lastKnownSafe`. Pointer advancement belongs exclusively to successful worker completion;
the initializer's nullable reset is the special case for a newly created/reinitialized plan.

Every workspace-owned table has grants, forced RLS, positive isolation tests, and negative
cross-workspace tests. Plan/track/capacity state changes use purpose-specific idempotent commands
that atomically commit state, a command receipt, and outbox events.

The fixed `planning.plan_snapshot_v1` consumer claims at most five due deliveries and at most one
per workspace. Its candidate query uses the same invariant as Review/Targets: a later row is blocked
by any earlier due `pending`, `retry`, or `leased` row for that workspace, ordered by
`available_at`, source `event_position`, then `delivery_id`; rows with `available_at > claimAsOf`
are not due and do not block. Claiming one delivery fixes one `claimAsOf` with `clock_timestamp()`
and persists it in the Planning calculation attempt before any owner read. Every owner query in that
attempt receives the same instant and returns its exact revision/event-position fence. The worker
normalizes and persists the bounded input, including `claimAsOf`, then computes its canonical
fingerprint.

A crash retry reuses a persisted attempt generation only while its owner fences still match and
`claimAsOf <= validUntil`. If either condition no longer holds, the worker preserves that generation
as `SUPERSEDED` and creates the next generation for the same delivery with a fresh claim-scoped
clock and owner reads. A completion-time source mismatch or expiry returns this convergent
superseded/retry outcome, not a permanently retrying old fingerprint. The ordinary delivery attempt
limit still applies; a dead-lettered earlier row no longer blocks a later workspace delivery.

The workspace week is the half-open interval from Monday 00:00 to the next Monday 00:00 in the
workspace IANA time zone. One owner utility resolves both instants from `claimAsOf`; adding seven
elapsed days to a UTC instant is forbidden because daylight-saving transitions can change the local
offset. `validUntil` is an inclusive instant. The adapter chooses the earliest applicable inclusive
cutoff:

- one millisecond before the exclusive workspace week end;
- one millisecond before the exclusive instant at which a candidate's oldest counted repetition
  leaves the 168-hour completed-work window;
- every consumed current Targets readiness `validUntil`;
- Review's owner-declared summary validity, including the next local-midnight bucket transition,
  and the `dueAt` of each currently due-today candidate;
- the active Campaign deadline and one millisecond before the next point where its derived
  `daysUntilDeadline` value changes;
- any earlier owner-declared `validUntil`/`nextTransitionAt`, converted by that owner into an
  inclusive cutoff.

The engine rejects a horizon later than any cutoff it can verify from the input. At exactly
`validUntil` the snapshot is still usable; at `validUntil + 1 millisecond` it is expired. The week
end itself therefore belongs to the next calculation, not the old week.

Direct wake-up routing is fixed rather than discovered by a generic outbox trigger:

| atomic producer | source event v1 | Planning action |
|---|---|---|
| Planning plan/track/activity/capacity command | `planning.input_changed` | insert `planning.plan_snapshot_v1` delivery |
| Targets readiness completion | `targets.readiness_projection_changed` | insert Planning delivery in the completion transaction |
| Mastery completion | `mastery.competency_state_changed` | insert Planning delivery in the completion transaction |
| Review completion | `review.item_changed` | insert Planning delivery in the completion transaction |
| Overlay custom-activity command | `overlay.custom_activity_added` | insert Planning delivery beside the existing event |
| Focus start | `sessions.focus_started` | insert Planning delivery beside the existing event |
| Focus finish/stop | `sessions.focus_completed` / `sessions.focus_stopped` | insert Planning delivery beside each session event |
| Evidence correction | `evidence.observation_invalidated` | Mastery and Planning each receive their fixed delivery |

Catalog versions and template versions are immutable. Selecting one for a track is a Planning
command and emits `planning.input_changed`; publishing an unrelated Catalog version does not fan
out across every workspace. Evidence completion also reaches Planning immediately through the
session event and later through the resulting Mastery/Targets events, so the first refresh is fast
and the later refresh converges on authoritative projections. The Planning source ledger makes
duplicate wake-ups no-ops when the exact normalized fingerprint is already current.

Snapshot completion atomically writes the immutable snapshot, advances the current pointer, creates
its action-selection rows, and schedules one `planning.snapshot_refresh_scheduled` event v1. Its
payload is exactly `workspace_id`, `source_snapshot_id`, `input_fingerprint`, `valid_until`, and
`scheduled_for`, where `scheduled_for = valid_until + 1 millisecond`. Its event UUID is the
namespace-UUID-v5 of
`workspace_id|planning.plan_snapshot_v1|source_snapshot_id|canonical_valid_until`; the delivery is
unique by the existing `(event_id, consumer_name, handler_contract_version)` key and has
`available_at = scheduled_for`. Replay is a no-op when the same event/delivery or an exact-current
fingerprint exists. A scheduled attempt may advance the pointer only if its source snapshot is
still the recorded current pointer when claimed; otherwise it succeeds as superseded.

The same completion increments `pointerVersion`, records the applied attempt, and marks every
currently visible due Planning delivery whose owner source is subsumed by the rechecked revision
fence as covered by that version. It also supersedes failed/active attempt generations based on an
older pointer version. This is an exact delivery ledger, not an inference from outbox
`event_position` commit order. A concurrently committed event absent from the covered set remains
uncovered and triggers the next calculation.

Before completion the transaction takes the Planning workspace advisory lock, locks the sentinel
pointer row, and re-reads every recorded owner revision. Initialization, backfill, snapshot
completion, and selection resolution use that same lock, so the first nullable pointer is fenced as
strongly as later updates. Completion applies only when every revision still exactly matches, the
normalized fingerprint is unchanged, `attempt.basePointerVersion` equals the locked sentinel
`pointerVersion`, `clock_timestamp() <= validUntil`, and, for a scheduled attempt,
`source_snapshot_id` still equals the locked current snapshot. These predicates are rechecked under
the completion lock even when they passed at claim time. Any mismatch records the superseded
generation described above. The previous current snapshot remains intact and Today is visibly
pending. Old snapshots are never edited. A future policy version writes new snapshots side by side.

## 7. Today read model and UI

`TodayWorkspaceV1` is a strict Planning-owned freshness envelope around a snapshot pointer plus safe
labels. It carries projection state/reason, calculation clock, current input fingerprint, snapshot
identity, `lastKnownSafe`, nearest deadline, readiness provenance, one primary recommendation, and
up to four alternatives. The envelope cannot present an expired snapshot or silently label a prior
snapshot current. Only a `CURRENT` envelope contains action selections; a pending/error
last-known-safe snapshot is display-only until recalculation succeeds. It does not label a number as
"available today" unless the user supplied an explicit session limit.

The query first defines relevant work. A direct delivery is relevant only when it is due and has no
covered/superseded Planning-ledger row. A scheduled delivery is additionally relevant only when its
`source_snapshot_id` equals the current pointer; an obsolete schedule is ignored immediately, even
before a worker claims it. An attempt/failure is relevant only when its captured base
`pointerVersion` still equals the sentinel's current version. The query then evaluates state at one
`queryAsOf` with this precedence:

1. no initialized Planning sentinel is `NOT_STARTED`;
2. a relevant due `pending`/`retry` delivery, relevant active lease, or relevant active attempt is
   `PENDING`; a scheduled delivery whose `available_at > queryAsOf` is ignored;
3. with no newer relevant active work, the latest relevant failed attempt/dead letter is `ERROR`;
4. an expired pointer is `PENDING` with `SNAPSHOT_EXPIRED` and no snapshot/action selectors;
5. otherwise an unexpired exact pointer is `CURRENT`.

For `PENDING`/`ERROR`, `currentInputFingerprint` is nullable until an attempt has persisted and
normalized the new input. It is never fabricated from the triggering event. An unexpired prior
pointer may be returned as `lastKnownSafe` for explanation only, without action selectors; a future
scheduled refresh alone never makes an otherwise current snapshot pending.

The live journey is:

```text
/today → choose opaque selectionRef → /focus?selection=<opaque> → Start focus
```

That is one navigation and, for a new action, one deliberate start. `selectionRef` is a random v4
UUID prefixed with `plan-action:` and conveys no workspace, candidate, or authority. A
Planning-owned backend-only `resolve_today_action_v1` function derives the actor's workspace from
Identity, takes the shared Planning workspace lock, locks the selection and current pointer, and
requires that the row belongs to that workspace, references the exact current snapshot/action/rank,
and has not passed either row expiry or snapshot `validUntil`. It returns the exact
`actionKind`/goal/activity/minutes/track/snapshot/candidate tuple plus nullable `focusSessionId`; it
never trusts duplicated browser fields.

For `RESUME`, the resolver additionally requires that `focusSessionId` is still the workspace's
exact active Focus Session and the Focus page returns that existing session without creating or
mutating another one. For `START`, the authenticated
`start_focus_from_plan_v1(selectionRef, idempotencyKey)` coordinator takes the command advisory
lock, hashes the request including `selectionRef`, and checks an existing receipt before resolving
the selection. An exact completed replay returns its stored response even if the selection later
expired or ceased to be current; a hash mismatch conflicts. Only a first execution calls the
resolver and then the Sessions-owned start implementation in the same database transaction.
Sessions persists optional `planSnapshotId`, `candidateKey`, and single `trackId` attribution
together with the Focus Session, command receipt, outbox event, and Planning delivery.

Selection rows are immutable; they are selectors, not mutable one-time capability flags. Browser
parameters never establish attribution. Review work can still go through `/review`, which preserves
the same exact Focus pair.

Fail-closed behavior:

- no workspace/profile/plan: explain the missing prerequisite and link to the owning setup surface;
- paused plan: show the paused state without target-based recommendations;
- zero capacity: show the capacity constraint and safe Review/Explore links;
- readiness rebuilding/stale/error: never display or rank from stale readiness numbers; an
  independently due Review may still be recommended and the limitation is visible;
- no eligible activities: link to Explore to create/select a Focus-compatible activity;
- pending projection: show a previous snapshot only when explicitly marked last-known-safe and
  label it; otherwise show no actionable recommendation;
- query failure: actionable retry state with no implied command success.

Today uses one `main`, a skip link, semantic headings, ordinary links for primary/alternatives,
44-pixel minimum targets, no color-only status, shared motion tokens, and stacked 320/390-pixel
layouts without horizontal overflow.

## 8. Bounds

The first contract accepts at most:

- 30 Learning Tracks;
- 200 candidate activities;
- 100 active Review signals;
- 250 readiness gaps and 100 readiness blockers, inherited from Targets;
- 20 competency-impact references and at most one track reference per candidate;
- five output actions and 12 score factors per action.

The worker rejects rather than truncates owner input outside these limits. Scaling beyond them needs
a versioned sufficient-statistics or continuation contract.

## 9. Verification and rollout

The implementation gates are:

1. golden and property tests for deterministic order, stable ties, input permutations, bounded
   output, capacity filtering, campaign/base-plan coexistence, Unknown preservation, and Review
   fallback;
2. valid, invalid, boundary, and malicious JSON contract fixtures;
3. pgTAP constraints, command/outbox atomicity, idempotency, optimistic versions, RLS isolation,
   stale completion rejection, replay, and current-pointer invariants;
4. authenticated browser proof from Today into Focus, including reload and recalculation after
   meaningful completion;
5. responsive 320/390-pixel, keyboard, reduced-motion, forced-colors, and Axe coverage;
6. full repository, database, backup/restore, authenticated-journey, and secret gates before push.

The migration is additive. Application rollout must tolerate missing Planning state by returning
the explicit no-plan state. Roll-forward creates/recalculates snapshots; rollback stops the worker
and removes Today navigation while preserving Planning history.
