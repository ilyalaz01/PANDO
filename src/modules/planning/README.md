# Planning

Owns Growth Plans, Learning Tracks, capacity, ranking, explanations, and plan snapshots.

## Phase 4B implementation route

The accepted supporting design for lifecycle and editing work is
[`PHASE_4B_LIFECYCLE_COMMANDS.md`](../../../docs/design/PHASE_4B_LIFECYCLE_COMMANDS.md). It fixes the
owner transition matrices, deterministic owner preview, expected-version/idempotency protocol, and
ordered D1–D5 slices. D1 delivers Growth Plan pause/resume, and the accepted
[`PHASE_4B_D2A_GROWTH_PLAN_CAPACITY.md`](../../../docs/design/PHASE_4B_D2A_GROWTH_PLAN_CAPACITY.md)
settles the first D2 increment. Archive and campaign semantics remain behind the ADR required by
the parent design.

D1 is implemented. `api.get_current_growth_plan_v1` resolves only the authenticated personal
workspace and exposes title, lifecycle, weekly capacity, bigint-safe aggregate version, current
recalculation state, and the one allowed lifecycle capability. The Planning-owned preview/apply
pair accepts no browser-selected workspace or plan ID. Apply requires the expected version, exact
recomputed digest, reason, and idempotency key, then atomically changes lifecycle and version with
the command receipt, minimal `planning.input_changed` event, and fixed snapshot delivery. `/plan`
uses the same boundary with a two-step preview/confirmation flow and reports recalculation as
pending. The implementation record is
[`PHASE_4B_LIFECYCLE_COMMANDS_STATUS.md`](../../../docs/implementation/PHASE_4B_LIFECYCLE_COMMANDS_STATUS.md).

D2a is implemented through a separate versioned capacity preview/apply pair so D1's lifecycle
contract and digest keep their released meaning. The clock-free preview binds the exact Growth Plan
version plus an ordered fingerprint of active Track IDs, versions, lifecycle, and protected
minimums. A proposal below their aggregate minimum is returned as a typed blocked preview with no
apply control; paused, completed, and archived Tracks do not count. Apply re-locks the Plan and all
child Tracks, recomputes the digest, increments only Plan capacity/version, and atomically commits
one minimal capacity event and fixed Planning delivery. `/plan` exposes the same exact confirmation
discipline and the auth gate proves real persistence. See
[`PHASE_4B_D2A_GROWTH_PLAN_CAPACITY_STATUS.md`](../../../docs/implementation/PHASE_4B_D2A_GROWTH_PLAN_CAPACITY_STATUS.md).

D2b1 is implemented through a separate Planning-owned current-Track read and lifecycle
preview/apply pair. The browser selects only an opaque server-returned key and supplies both
aggregate version fences; Planning resolves and locks the current Plan and all child Tracks before
recomputing the exact preview. Pause preserves history and removes the Track from active planning.
Resume refuses a projected active protected-minimum total above Plan capacity, while a paused parent
produces an honest Today warning rather than blocking the saved Track state. Apply advances only the
target Track and atomically commits its receipt, minimal event, and fixed snapshot delivery. See
[`PHASE_4B_D2B1_LEARNING_TRACK_LIFECYCLE_STATUS.md`](../../../docs/implementation/PHASE_4B_D2B1_LEARNING_TRACK_LIFECYCLE_STATUS.md).

D2b2 is implemented as a separate priority/protected-minimum command that reuses the D2b1 current
read without broadening its lifecycle contract. It atomically proposes both resulting values,
enforces active-only capacity, reports paused-Track resume consequences without blocking the saved
edit, and binds both the active-capacity and current-order fingerprints. Cadence remains a
separate soft preference rather than part of this hard capacity command.
See
[`PHASE_4B_D2B2_LEARNING_TRACK_PRIORITY_MINIMUM_STATUS.md`](../../../docs/implementation/PHASE_4B_D2B2_LEARNING_TRACK_PRIORITY_MINIMUM_STATUS.md).

Manual activity admission is implemented through
`LearningTrackActivityAdmissionSourceV1` and an exact preview/apply pair. The actor-scoped source
accepts no selector and exposes only the sole current Track's opaque key, Plan/Track versions, and
at most 200 eligible accepted personal activities. The browser supplies one activity key, bounded
duration, nullable energy, both version fences, printable reason, lowercase request UUID, and then
the server-created digest. Planning re-resolves the workspace, Plan, Track, Goal, profile, owner
revisions, custom activity, candidate identity, and activity count under the shared workspace lock.
Apply advances only the Track version and atomically commits attribution, receipt, minimal event,
and fixed snapshot delivery. The historical six-argument v1 RPC remains in schema history but is no
longer executable by runtime roles. `/plan` renders the exact comparison and fail-closed source
states; a failed additive source read does not disable unrelated Plan controls. See
[`PHASE_4B_MANUAL_ACTIVITY_ADMISSION_STATUS.md`](../../../docs/implementation/PHASE_4B_MANUAL_ACTIVITY_ADMISSION_STATUS.md).

The completed D2b3 increment is
[`PHASE_4B_D2B3_ADDITIONAL_LEARNING_TRACKS.md`](../../../docs/design/PHASE_4B_D2B3_ADDITIONAL_LEARNING_TRACKS.md).
It keeps the current one-Track admission contract unchanged, adds a separate Targets-backed Track
creation flow, and introduces a destination-aware admission contract once the current portfolio can
contain more than one Track. Different Tracks may share or use different exact Goal/profile sources.

D2b4 is implemented through a separate terminal source/preview/apply contract so the released
pause/resume contract remains unchanged. Current Tracks can be completed or archived; completed
history can be archived; archived rows are read-only. A bounded keyset page exposes retained
terminal history while every apply re-locks the Plan and all child Tracks, verifies current-order
and active-capacity fingerprints, increments only the target Track, and atomically commits one
minimal event plus one snapshot delivery. Completion makes no Evidence, Mastery, readiness, or Goal
claim. See
[`PHASE_4B_D2B4_LEARNING_TRACK_TERMINAL_LIFECYCLE_STATUS.md`](../../../docs/implementation/PHASE_4B_D2B4_LEARNING_TRACK_TERMINAL_LIFECYCLE_STATUS.md).

The completed D2c increment is
[`PHASE_4B_D2C_LEARNING_TRACK_CADENCE.md`](../../../docs/design/PHASE_4B_D2C_LEARNING_TRACK_CADENCE.md).
It defines cadence as a soft desired count of evidence-bearing completed Focus sessions per
workspace week, separate from protected minutes, and requires versioned V2 Planning input/snapshot
contracts plus engine, policy, and completed-work successors before the setting can affect Today.
The additive calculation contracts are recorded in
[`Planning Policy v0.2`](../../../docs/policies/PLANNING_POLICY_V0.2.md) and
[`Planning Completed Work Policy v0.2`](../../../docs/policies/PLANNING_COMPLETED_WORK_POLICY_V0.2.md);
V1 inputs and snapshots remain on their unchanged historical schemas and exact version tuple.
The persisted control, authenticated `/plan` flow, dual-contract worker, and V2 rollout are recorded
in
[`PHASE_4B_D2C_LEARNING_TRACK_CADENCE_STATUS.md`](../../../docs/implementation/PHASE_4B_D2C_LEARNING_TRACK_CADENCE_STATUS.md).
The D3–D5 lifecycle decisions are settled by
[`ADR-0010`](../../../docs/adr/0010-lifecycle-replacement-availability-and-campaign-semantics.md):
exactly one current Growth Plan with archive only inside atomic replacement, plan-scoped
whole-local-day availability windows that cap but never raise weekly capacity, campaign deadlines
as a workspace-local date with a derived exclusive instant, allocation overrides that temporarily
replace a Track's own priority, protected minimum, and cadence, and one purpose-specific
campaign-lifecycle coordinator.

D3a is implemented as one atomic Planning-owned `replace_growth_plan` command. It archives the
outgoing Plan with exactly one version increment and creates the incoming Plan plus one initial
Track in the same transaction, so an initialized workspace always has exactly one current Plan and
there is still no standalone archive command. Tracks, activity attributions, Focus sessions,
Evidence, Mastery, Reviews, and immutable snapshots are retained and never copied; the clock-free
digest binds the outgoing Plan identity, its ordered child-Track fingerprint, and both expected
versions. See
[`PHASE_4B_D3A_GROWTH_PLAN_REPLACEMENT_STATUS.md`](../../../docs/implementation/PHASE_4B_D3A_GROWTH_PLAN_REPLACEMENT_STATUS.md).
D3b1 is implemented as the availability-window persistence and app layer: a Planning-owned
`change_availability_window_v1` command (`create_availability_window`, `change_availability_window`,
`remove_availability_window`), a `btree_gist` non-overlap exclusion constraint, forced RLS, and the
`/plan` "Availability windows" control described in
[`PHASE_4B_D3B1_AVAILABILITY_WINDOWS_STATUS.md`](../../../docs/implementation/PHASE_4B_D3B1_AVAILABILITY_WINDOWS_STATUS.md).
Recorded availability did not yet change weekly capacity until D3b2 shipped a versioned engine.

D3b2-engine is implemented as the pure availability-composed capacity engine: `planner-engine/0.3.0`
plus [Planning Policy v0.3](../../../docs/policies/PLANNING_POLICY_V0.3.md), the
`PlanningCalculationInputV3` and `PlanSnapshotV3` contracts, and the calculation-only half of
ADR-0010 §6/§8. `GrowthPlanInputV3` replaces the single `weeklyCapacityMinutes` with
`defaultWeeklyCapacityMinutes`, `effectiveWeeklyCapacityMinutes`, and a bounded seven-entry
`dailyCaps` composition; the engine never trusts the supplied effective number, always re-deriving
`min(defaultWeeklyCapacityMinutes, sum(dayCaps))` and failing closed on any mismatch. When effective
capacity falls below the sum of active protected minutes, the engine rations deterministically by
`(priority desc, trackKey asc)` and reports warning code `PROTECTED_MINIMUM_LIMITED_BY_AVAILABILITY`
without ever rewriting a Track's configured minimum. When availability never limits a plan, V3
output is arithmetically identical to V2's. See
[`PHASE_4B_D3B2_ENGINE_STATUS.md`](../../../docs/implementation/PHASE_4B_D3B2_ENGINE_STATUS.md).

D3b2-rollout adds `assemblePlanSnapshotInputV3` (the dispatcher's V3 counterpart to
`assemblePlanSnapshotInputV2`, additive, exercised only by synthetic fixtures this session since no
SQL migration yet extends the worker's source-bundle RPC to emit `bundle.availability`) and
dispatcher recognition of `planning-calculation/3` — the "expand" half of ADR-0010 §8/§9's
expand-then-activate sequence. It also adds a stateless, request-time capacity-effect preview
(`src/modules/planning/application/loaders/capacity-effect-preview.ts`,
`src/ui/plan/capacity-effect-preview.tsx`) that composes real `AvailabilityWindow` and Learning
Track rows — the same `AvailabilityWindowSourceV1`/`CurrentLearningTracksV1` reads `/plan` already
loads, no new query — into a live estimate of `planner-engine/0.3.0`'s effect over the next seven
local days, with a `previewDigest` proving reproducibility. This deliberately deviates from
ADR-0010 §6's persisted, server-issued proposal: it is recomputed in full on every read and never
persisted, because the persisted-proposal table, the CHECK-constraint widening that would admit
`planning-calculation/3`, and the SQL-side pointer-move the dispatcher's own V1→V2 precedent
required (`20260903000400_phase4b_planning_cadence_v2_activation.sql`) all need a SQL migration
outside this session's scope. See
[`PHASE_4B_D3B2_ROLLOUT_STATUS.md`](../../../docs/implementation/PHASE_4B_D3B2_ROLLOUT_STATUS.md).

D3b as a whole remains **partial** after D3b2-rollout: the live async snapshot worker still computes
only V1/V2 for every real workspace, `capacityUsesAvailability` stays `false`, and `/plan`'s
"Recorded availability does not change weekly capacity yet" text remains literally true. The
concrete remaining SQL-permitted slice — the activation migration and the persisted ADR-0010 §6
proposal — is recorded in
[`PHASE_4B_D3B_STATUS.md`](../../../docs/implementation/PHASE_4B_D3B_STATUS.md), D3b's closure
summary.

## Phase 4A implementation route

The accepted [Phase 4A design](../../../docs/design/PHASE_4A_PLANNING_TODAY.md) starts with a pure
`planner-engine/0.1.0` and transparent
[Planning Policy v0.1](../../../docs/policies/PLANNING_POLICY_V0.1.md). Cross-context owner queries
normalize Targets readiness, Review urgency, Overlay activities, Catalog prerequisites, and Mastery
state plus meaningful-work aggregates into a Planning-owned calculation input. The input uses exact
goal/profile identities, bounded owner revisions, a canonical fingerprint, and an explicit
validity/week horizon. The domain engine performs no I/O and imports no other bounded context. Raw
worker input enters only through the application calculation entry point, which first validates the
structural contract and exact canonical fingerprint before branding it for the domain engine.

Planning now has a forced-RLS storage boundary for Growth Plans, Learning Tracks, track/activity
attribution, immutable PlanSnapshot history, and a validated current-snapshot sentinel. The
idempotent initializer currently persists the first plan, track, and sentinel from a bounded
Targets-owned query, with a minimal `planning.input_changed` event routed only to
`planning.plan_snapshot_v1`.

The historical `api.add_learning_track_activity_v1` first established the atomic attribution,
event, and fixed-delivery semantics and was later hardened behind a pinned Planning-owned
`SECURITY DEFINER`. Its implementation helper remains private, and the completed v2
preview/confirmation outcome revokes runtime execution of the v1 wrapper so there is no alternate
mutation path without an exact digest. See the
[`Phase 4B activity-admission owner-boundary hardening record`](../../../docs/implementation/PHASE_4B_ACTIVITY_ADMISSION_OWNER_BOUNDARY_HARDENING_STATUS.md)
for that earlier compatibility step.

The first live `planning.plan_snapshot_v1` worker now persists a claim clock and normalized input,
reads every cross-context source through bounded owner functions, calculates through the verified
pure entry point, and atomically applies immutable snapshot history, the monotonic pointer, opaque
action selections, exact delivery coverage, receipts, and the next scheduled refresh. Its internal
route and optional once-per-minute Cron are wake-ups only; outbox rows remain the durable queue.

Completed work is normalized by the versioned
[`planning-completed-work/0.1`](../../../docs/policies/PLANNING_COMPLETED_WORK_POLICY_V0.1.md)
policy, whose version travels in the calculation input and therefore in every snapshot fingerprint.
Sessions supplies terminal Focus duration facts for the plan week and the 168-hour repetition
horizon; Evidence supplies only attempt terminality and whether a normalized observation exists and
has not been invalidated. Planning holds no Sessions or Evidence table grant. Counted duration is
the observed elapsed time floored to whole minutes, bounded by the minutes the user planned for that
activity and clipped to the plan week, so planned duration is never substituted for completed work
and an abandoned open session cannot claim a week of capacity. A completed session consumes
capacity, an evidence-bearing completed session also earns track cadence credit, and a stopped
session earns neither. Repetition counts completed sessions in the half-open 168-hour window and
carries an engine-verifiable oldest end plus exact `repetitionWindowEndsAt` cutoff that also caps
snapshot validity.

`UNSUPPORTED_MEANINGFUL_WORK_HISTORY` now covers only history this policy cannot classify: a missing
or non-terminal Evidence attempt, a stopped session that claims evidence, a session outside the
claim-scoped window, a window that does not cover the policy horizon, or derived totals that break
the week and cadence-credit invariants.

Direct blocking prerequisites now use the versioned
[`mastery-prerequisite-satisfaction/0.1`](../../../docs/policies/PLANNING_PREREQUISITE_SATISFACTION_POLICY_V0.1.md)
rule. Catalog returns canonical direct prerequisite references for each exact candidate/version
pair. Mastery returns one privacy-minimized, content-fenced source projection per requested
reference through a dedicated read-only owner role. The Planning application coordinator calls the
pure Mastery-owned `mastery-prerequisite-engine/0.1.0`, then aggregates bounded counts; the pure
Planning engine verifies those counts exactly imply the candidate state. Missing, post-claim,
malformed, or stale-only Mastery remains `UNKNOWN`; Fresh Weak is `BLOCKED`; a Fresh Strong
completion is `SATISFIED`. Snapshot validity is capped at the earliest decisive freshness boundary.
Planning has no Catalog or Mastery table grant.

Before those reads, an Overlay-owned bounded check requires exactly one origin: an accepted personal
competency or a competency in the exact Catalog version, including retired Catalog items. C5 never
guesses a missing origin or applies canonical prerequisites to an ambiguous personal node; future
personal-content import must prevent such collisions at admission.

Campaign and same-session preference inputs remain explicitly null. Direct wake-up routing from
Targets, Mastery, Review, Overlay, Focus, and Evidence
is now installed in the exact owner/coordinator transaction through a fixed, least-privilege
Planning router. Routing begins only after the Planning sentinel exists, is idempotent under owner
command replay, and includes a sentinel-scoped rollout backfill. Raw evidence append events do not
route directly: Focus completion provides the fast wake-up, while later Mastery and Targets changes
provide the convergence wake-ups. Planning input changes and scheduled refreshes remain first-class
wake-ups. A cursor-driven administrator repair can idempotently route accepted historical events
in observable batches of at most 500 after a sentinel exists. A malformed immutable historical
event blocks the cursor until an administrator records a reviewed append-only quarantine; that
idempotent command refuses valid events and atomically emits a Planning-owned current-state repair
wake-up with separate command provenance and causation back to the malformed event.

The live Today read model and opaque selection resolver are implemented behind authenticated,
current-personal server boundaries. Degraded output is display-only, selector authority is resolved
only in the database transaction, and attributed Focus start uses the ordinary idempotent Sessions
command path. The server-rendered `/today` route consumes this boundary, correlates actions to
selectors fail-closed, and returns planned completion to Today before the old selector becomes
stale. Its authenticated browser gate covers error, pending, current, Start, Resume, reload,
completion, stale-selector refusal, recalculation, responsive layouts, reduced motion, forced
colors, and automated accessibility.
