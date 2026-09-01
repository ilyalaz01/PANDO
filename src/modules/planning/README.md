# Planning

Owns Growth Plans, Learning Tracks, capacity, ranking, explanations, and plan snapshots.

## Phase 4B implementation route

The accepted supporting design for lifecycle and editing work is
[`PHASE_4B_LIFECYCLE_COMMANDS.md`](../../../docs/design/PHASE_4B_LIFECYCLE_COMMANDS.md). It fixes the
owner transition matrices, deterministic owner preview, expected-version/idempotency protocol, and
ordered D1–D5 slices. D1 is intentionally limited to Growth Plan pause/resume; archive and campaign
semantics remain behind the ADR required by that design.

D1 is implemented. `api.get_current_growth_plan_v1` resolves only the authenticated personal
workspace and exposes title, lifecycle, weekly capacity, bigint-safe aggregate version, current
recalculation state, and the one allowed lifecycle capability. The Planning-owned preview/apply
pair accepts no browser-selected workspace or plan ID. Apply requires the expected version, exact
recomputed digest, reason, and idempotency key, then atomically changes lifecycle and version with
the command receipt, minimal `planning.input_changed` event, and fixed snapshot delivery. `/plan`
uses the same boundary with a two-step preview/confirmation flow and reports recalculation as
pending. The implementation record is
[`PHASE_4B_LIFECYCLE_COMMANDS_STATUS.md`](../../../docs/implementation/PHASE_4B_LIFECYCLE_COMMANDS_STATUS.md).

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

`api.add_learning_track_activity_v1` admits one exact active/accepted personal activity through
Targets- and Overlay-owned fenced queries. It requires explicit Planning duration, nullable energy,
the expected Track version, and an idempotency key; all authority-bearing IDs and the candidate key
are server-derived. The atomic command writes attribution, increments only the Track aggregate,
emits the strict Track input event, and creates one fixed delivery. It keeps the current calculation
pointer intact so a prior unexpired snapshot can remain display-only while the new delivery makes
Today pending. Active and paused plans/tracks are editable; terminal lifecycle and inactive goal or
activity state fail closed. A Growth Plan cannot exceed 200 non-archived candidate activities.

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
