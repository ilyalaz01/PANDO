# ADR-0010 — Growth Plan replacement, availability windows, and Interview Campaign semantics

Status: Accepted  
Date: 2026-09-02  
Owner: PANDO product owner; the open technical choices below were delegated to the implementing
agent by [the Codex D2c handoff](../implementation/CODEX_D2C_TO_CLAUDE_HANDOFF.md).

Resolves the seven open decisions in
[Phase 4B lifecycle and editing command design](../design/PHASE_4B_LIFECYCLE_COMMANDS.md) §10.
It changes no product semantics defined by the nine canonical documents; it selects the
implementation meaning those documents left open. This ADR contains no production code and no
schema change.

## Context

Phase 4B D1–D2c delivered the Planning-owned Growth Plan and Learning Track control surface: first
plan setup, pause/resume, weekly capacity, additional Track creation, priority, protected minimum,
terminal lifecycle, and soft weekly cadence, each with an exact preview, expected-version fence,
idempotent apply, atomic outbox behavior, forced RLS, and `/plan` parity.

The next three slices cannot be implemented from the canonical documents alone:

- D3 needs dated availability and Growth Plan replacement, but the canonical documents do not say
  whether an initialized workspace may return to zero current Growth Plans, and they define no
  interval, overlap, or capacity-composition semantics for `AvailabilityWindow`.
- D4 needs Interview Campaign persistence, but deadline representation, time-zone behavior, and
  post-deadline behavior are unspecified.
- D5 needs Planning allocation overrides, but `CampaignAllocationOverride` does not say whether an
  allocation is a reservation, a cap, or a preference, and
  [Planning Policy v0.1](../policies/PLANNING_POLICY_V0.1.md) currently refuses any campaign unless
  the Growth Plan is `ACTIVE`, while
  [the Domain Model](../01_DOMAIN_MODEL.md) §9 permits a campaign to continue while the base plan is
  explicitly paused.

Three implementation facts constrain the decision space and are load-bearing below:

1. `planning.growth_plans` already carries the partial unique index
   `one_current_growth_plan_per_workspace` over `lifecycle in ('active','paused')`, so *at most* one
   current plan is already a database invariant; *exactly* one is not.
2. `api.get_growth_plan_setup_source_v1` currently raises `Growth Plan setup state is corrupt` when
   a workspace has more than one lifetime plan, and returns `HISTORY_REQUIRES_REPLACEMENT` when it
   has one lifetime plan and no current plan. Replacement therefore requires revising that source.
3. `planning.learning_tracks` is unique on `(workspace_id, track_key)` and
   `planning.learning_track_activities` is unique on `(workspace_id, candidate_key)` and on
   `(workspace_id, growth_plan_id, custom_activity_id)`. Keys are workspace-scoped, not plan-scoped,
   so a replacement plan cannot reuse an old plan's Track or candidate keys.

## Decision

### 1. Exactly one current Growth Plan after initialization; archive only through replacement

- An **initialized** workspace — one that has ever completed `initialize_growth_plan` — MUST always
  have exactly one current Growth Plan, meaning exactly one row in `active` or `paused`. An
  uninitialized workspace has zero plans and keeps the released D1b setup flow.
- There is **no standalone `archive_growth_plan` command** in the MVP. Archive is reachable only as
  one effect of `replace_growth_plan`, which in one transaction archives the outgoing plan and
  creates the incoming current plan. A workspace can therefore never reach a "no current plan"
  state, and archive can never be disguised as pause.
- `replace_growth_plan` is Planning-owned and takes the ordinary `planning-workspace:<workspace>`
  lock. Its precondition vector is the outgoing plan `{PLANNING, growth_plan, id, version}`, every
  child Track `{PLANNING, learning_track, id, version}`, and the chosen
  `{TARGETS, readiness_goal, id, version}` read as a bounded owner query. Planning writes no
  Targets row.
- Replacement **preserves and does not copy**. The outgoing plan and every one of its Tracks,
  Track activity attributions, Focus history, Evidence, and immutable `PlanSnapshot` rows are
  retained exactly as they are. Track lifecycles are **not** rewritten to `archived`; a Track under
  an archived plan is frozen history and is already refused by every released Track command
  ("Track editing is refused when the parent plan is archived"). Nothing is deleted; `on delete
  restrict` foreign keys keep the history reachable.
- The incoming plan starts from the same shape as first setup: one explicitly chosen active
  Readiness Goal, one derived initial Track, an explicit weekly capacity, and `aggregate_version`
  `1`. Further Tracks are added afterwards through the released D2b3 creation command. No Track,
  activity admission, cadence, priority, or protected minimum is inherited implicitly.
- Because Track and candidate keys are workspace-unique (context fact 3), the incoming plan derives
  fresh keys with a bounded deterministic disambiguating suffix. Historical Focus sessions keep
  their original immutable Track attribution; replacement never reattributes history. Consequently
  the incoming plan's completed-work and cadence progress start at zero for its own Tracks, and the
  archived plan's history remains readable under its own Tracks.
- Replacement emits one `planning.input_changed` event with change kind `PLAN_REPLACED` and one
  fixed `planning.plan_snapshot_v1` delivery. The workspace current-snapshot pointer is not
  rewritten by the command; the previous snapshot remains valid history referencing the archived
  plan, and Planning freshness is honestly `PENDING` until the next calculation applies.
- Replacement is refused while the outgoing plan is `archived`, when the chosen Goal is not active,
  when the expected versions do not match, and when the workspace has never been initialized (that
  case is first setup, not replacement).

### 2. An active Campaign keeps ranking while the Growth Plan is paused

- Pausing the Growth Plan is a statement about **base-plan work**, not about an interview. While the
  plan is `paused`: `GROWTH_PLAN` source signals contribute no eligible candidate, no protected
  minimum reserves capacity, and no cadence factor applies — exactly the released behavior.
- An `active` Interview Campaign continues to affect ranking while the plan is `paused`.
  Campaign-sourced candidates remain eligible, still reference exactly one Learning Track for
  provenance, and consume the plan's effective weekly capacity as fully flexible capacity.
- The current engine rule "a campaign must overlay an active Growth Plan" is therefore replaced in
  D5 by "a campaign must overlay a current (`active` or `paused`) Growth Plan", and the campaign
  candidate eligibility filter stops requiring an `ACTIVE` parent Track lifecycle. The existing
  snapshot state logic already distinguishes `PLAN_PAUSED` only when no campaign exists, so the
  paused-with-campaign case reports `CURRENT` plus the warning code `BASE_PLAN_PAUSED`.
- Starting, ending, or cancelling a campaign never changes Growth Plan lifecycle, and resuming a
  Growth Plan never changes campaign lifecycle. They are independent aggregates with independent
  user decisions.
- This is an eligibility change and therefore requires a new engine and policy version (§8). It is
  implemented in D5, not earlier: no campaign row can exist before D4, and D4 adds no Planning
  input.

### 3. Campaign deadline is a workspace-local date with a derived exclusive instant

- A campaign deadline is captured as the user states it: a **local calendar date**. Targets persists
  three fields — `deadline_local_date date`, `deadline_time_zone text` (the workspace time zone
  resolved at write time, validated exactly as `identity.is_known_time_zone` already validates it),
  and the derived `deadline_at timestamptz`.
- `deadline_at` is the **exclusive end** of that local day:
  `deadline_at = ((deadline_local_date + 1)::timestamp at time zone deadline_time_zone)`. The write
  command verifies the local round trip and refuses a value that does not convert back, using the
  same defensive pattern as the released Review local-timestamp helper.
- A later change of the workspace time zone does **not** move an existing deadline. The recorded
  `deadline_time_zone` is part of the campaign's history. Moving a deadline is an explicit
  version-fenced `change_campaign_deadline` command that re-derives the instant from the workspace
  time zone in force at that moment.
- Post-deadline behavior: PANDO never auto-ends or auto-cancels a campaign, because a lifecycle
  change is a user decision and a silent one would violate P6 and the no-hidden-plan-change rule.
  After `deadline_at` passes the campaign stays `active`, keeps its overrides, and:
  - the derived days-until-deadline is clamped to `0` rather than becoming negative;
  - deadline pressure is capped at the nearest existing bucket (the "within 7 days" points); no new
    coefficient is introduced;
  - the snapshot carries warning code `CAMPAIGN_DEADLINE_PASSED`, and `/plan` and Today show an
    explicit prompt to end or cancel the campaign;
  - snapshot validity is no longer capped by a future deadline transition, because none remains.
- The engine's existing refusal of a deadline before `asOf` is replaced by this clamped behavior in
  D5. Deadlines further than 36,500 days ahead remain refused at the owner command, so the derived
  day count always stays representable.

### 4. Campaign target changes repoint to an exact Readiness Goal and never mutate one

- `InterviewCampaign` references exactly one `ReadinessGoal`, which references exactly one immutable
  `TargetProfileVersion`. None of these references is mutated in place.
- `change_campaign_target` is a Targets-owned command allowed in `draft` and `active`. It requires
  the expected campaign version and the expected version of the **new, already existing, active**
  Readiness Goal, records the previous goal identity in append-only campaign revision history, and
  leaves both goals intact.
- Superseding a Readiness Goal never retargets a campaign implicitly. A campaign that points to a
  superseded goal keeps pointing at it until the user explicitly retargets, and the UI surfaces the
  superseded state instead of silently following the successor.
- Requirement overrides (D5 and later) are bound to the exact goal and profile version they were
  written against. Retargeting marks them superseded and retains them; it never carries a weight or
  floor across profile versions.

### 5. Allocation overrides are bounded temporary replacements of a Track's own parameters

A `CampaignAllocationOverride` introduces **no new capacity concept**. It temporarily replaces
values that already exist on the Learning Track aggregate, for the lifetime of one active campaign:

| Override field | Range | Meaning while the campaign is active |
|---|---|---|
| `priority_override` | `0..100` | replaces the Track's ranking priority — a **preference** |
| `protected_minimum_minutes_override` | `0..10080` | replaces the Track's reserved floor — a **reservation** |
| `cadence_per_week_override` | `0..100` | replaces the Track's soft weekly session target — a **preference** |

- Allocations are never **caps**. Nothing prevents a Track from receiving more than its reserved
  minutes when its candidates rank highest; the reservation is a floor on eligibility, exactly as
  the released protected minimum already is.
- A protected-minimum override MUST NOT be lower than the Track's own protected minimum. A campaign
  may raise protection for campaign-critical work but can never erase base protection, preserving
  the released invariant "campaigns override flexible capacity, never protected base cadence".
  Lowering a floor stays an ordinary, visible Growth Plan edit on the Track itself.
- The existing blocking capacity invariant extends unchanged to effective values: the sum of
  effective protected minima across active Tracks may not exceed the plan's default weekly capacity
  at command time. Installing an override that would break it is a blocking validation error, not a
  warning.
- Base Track rows are never mutated by campaign lifecycle. Overrides are separate rows with their
  own aggregate version and lifecycle `active | superseded | removed`; `end_campaign` and
  `cancel_campaign` mark them terminal in the same transaction and retain them as history. Base
  allocation is therefore restored by construction rather than by copying values back, which is what
  release acceptance scenarios 14 and 17 require.

### 6. Availability windows are plan-scoped, whole-local-day, non-overlapping capacity caps

- **Ownership and scope.** Availability is Planning-owned and belongs to the **current Growth Plan**
  (`workspace_id, growth_plan_id` foreign key). Replacement therefore freezes the outgoing plan's
  windows with it; the incoming plan starts with none. No window is copied silently.
- **Identity.** A window has a server-issued `availability_window_id uuid`, an opaque server-issued
  `window_key`, and an `aggregate_version`. The browser and any future agent submit only the opaque
  key plus expected versions; they never choose an identifier.
- **Interval.** A window covers whole local days: `starts_on date`, `ends_on date`, both inclusive,
  with the `time_zone` recorded at write time. The derived instant interval is half-open,
  `[starts_on 00:00 local, (ends_on + 1) 00:00 local)`. Sub-day time ranges are deliberately out of
  scope: PANDO plans a weekly budget and "phases and milestones, not an immutable daily calendar".
  Adding intra-day availability later is additive and needs no change to the rules below.
- **Value.** `available_minutes smallint` in `0..1440` is the cap **per covered local day**, not a
  total for the range, so composition is independent of how a window straddles a plan week. `0`
  means unavailable.
- **Metadata.** An optional `energy` (`LOW|MEDIUM|HIGH|null`) and a bounded printable `label` are
  stored as display-only context. Neither feeds ranking in D3; window energy is not the per-request
  `energyPreference` and creates no new score factor.
- **Overlap and adjacency.** Active windows of one Growth Plan MUST be pairwise non-overlapping.
  This is enforced both inside the owner command under the Planning workspace lock and by a database
  exclusion constraint over `(workspace_id, growth_plan_id, daterange(starts_on, ends_on, '[]'))`
  where the window is active, which requires enabling the standard `btree_gist` contrib extension.
  Adjacent windows (`previous.ends_on + 1 = next.starts_on`) are legal, stay separate rows, and are
  never auto-merged, because merging would rewrite user intent.
- **Cardinality sentinel.** Create and change preconditions carry the current plan id and version,
  the count of active windows, and the ordered fingerprint of the windows intersecting the proposed
  range. At most 60 active windows exist per current plan; a single window spans at most 366 local
  days; a created window must end on or after the current local date. Windows that fall into the
  past become read-only history.
- **Removal.** `remove_availability_window` is a lifecycle transition to `removed`, retained as
  history. There is no hard delete, consistent with "destructive deletion is not an MVP operation".
- **Precedence in capacity composition.** Availability **caps**, never grants. For a plan week whose
  seven local days are `d1..d7` in the snapshot time zone:

  ```text
  dayCap(d)                      = available_minutes of the active window covering d, else 1440
  effectiveWeeklyCapacityMinutes = min(defaultWeeklyCapacityMinutes, sum(dayCap(d1..d7)))
  remainingMinutesThisWeek       = max(effectiveWeeklyCapacityMinutes - consumedMinutesThisWeek, 0)
  ```

  The Growth Plan's `weekly_capacity_minutes` remains the sustained default and the only way to
  raise capacity. `effective <= default` always holds, so no availability edit can inflate a plan.
- **Availability versus protected minima.** A window may legitimately push effective capacity below
  the sum of active protected minima; refusing that would force the user to misstate reality. It is
  therefore a non-blocking preview warning, and the engine rations deterministically: active Tracks
  reserve in `(effective priority desc, track key asc)` order, each reserving
  `min(its effective minimum, capacity still reservable)`. A Track that reserves less than its
  minimum contributes warning code `PROTECTED_MINIMUM_LIMITED_BY_AVAILABILITY`. Nothing is
  fabricated and no minimum is silently rewritten.
- **Clock sensitivity.** An availability preview shows a derived effect on the current plan week and
  is therefore the first clock-sensitive Planning preview. Per the parent design §6 it MUST be a
  persisted, server-issued, single-use Planning proposal that carries `previewAsOf`, the workspace
  time zone, the resolved week boundaries, and an expiry of at most 10 minutes and never beyond the
  next week boundary. Apply accepts the server proposal identifier, the exact digest, a reason, and
  an idempotency key; it re-derives the document under the workspace lock and refuses an expired,
  superseded, or drifted proposal. Stored window state itself remains clock-free.

### 7. One purpose-specific coordinator, used first by the manual UI

- D5 introduces exactly one cross-owner coordinator, `campaign_lifecycle_v1`. It lives in the
  Agent Control module boundary, which [ADR-0009](0009-module-topology-and-projection-ownership.md)
  already assigns "purpose-specific cross-module command coordination", and it acquires no ownership
  of campaigns, plans, tracks, or overrides.
- It handles only the three operations that genuinely touch both owners in one atomic decision:
  `start_campaign` (install validated overrides), `end_campaign`, and `cancel_campaign`. Every
  single-owner operation — create draft, change deadline, change target, edit one override while a
  campaign is already active, and every Growth Plan or Track command — remains a direct owner
  command with no coordinator.
- Lock order is fixed and total: `agent-control-workspace:<workspace>`, then
  `targets-workspace:<workspace>`, then `planning-workspace:<workspace>`; aggregates are then locked
  by owner, aggregate type, and UUID. No other order is permitted anywhere in the code base.
- The coordinator carries the multi-aggregate precondition vector
  `{ owner, aggregate_type, aggregate_id, expected_version }` required by the parent design §6,
  calls private owner hooks that repeat their own lifecycle, cardinality, and version validation,
  and commits both owners' state, receipts, events, and deliveries in one transaction. It contains
  no ranking or product rule and stores only coordination and audit rows.
- D5 exposes it to the manual `/plan` server boundary only. The general multi-operation
  `ApplyPlanChangeSet` surface, its persisted change sets, and MCP/CLI transport stay in E1–E2.

### 8. Calculation-contract and version consequences

- **D3a (replacement)** changes no calculation contract. Plan identity in a snapshot is already
  nullable and foreign-keyed; only a new `PLAN_REPLACED` change kind is admitted by the existing
  `planning.input_changed` version 1 payload contract.
- **D3b (availability)** changes capacity meaning and adds a rationing rule, so it ships
  `PlanningCalculationInputV3`, `PlanSnapshotV3`, calculation contract `planning-calculation/3`,
  `planner-engine/0.3.0`, and `planning-policy/0.3`. The V3 growth-plan input carries
  `defaultWeeklyCapacityMinutes`, `effectiveWeeklyCapacityMinutes`, and a bounded ordered array of
  the covered local days with their caps and source window keys, so the pure engine verifies the
  composition exactly instead of trusting an adapter number — the pattern already used for
  prerequisite counts. New warning codes: `PROTECTED_MINIMUM_LIMITED_BY_AVAILABILITY`.
- **D4** adds no Planning input and no calculation version. Campaign rows exist and are readable but
  do not reach the planner.
- **D5** changes campaign eligibility, paused-plan behavior, post-deadline clamping, and effective
  Track parameters, so it ships `PlanningCalculationInputV4`, `PlanSnapshotV4`,
  `planning-calculation/4`, `planner-engine/0.4.0`, and `planning-policy/0.4`. New warning codes:
  `BASE_PLAN_PAUSED`, `CAMPAIGN_DEADLINE_PASSED`. No existing coefficient changes value.
- Every rollout repeats the reviewed D2c expand-then-activate sequence: add persistence, storage
  compatibility, schemas, validators, dispatcher support, and readers while new attempts stay on the
  previous contract; prove the previous contract still reads and completes; activate assembly for
  new attempts; move each workspace pointer only when its new-contract attempt applies. No migration
  rewrites historical normalized inputs or result JSON, and no historical row is relabeled.
- Policy versions are never merged across slices. D3b and D5 are separate engine and policy
  versions with their own golden fixtures, so a regression can be attributed to exactly one change.

### 9. Ordered slices, and the smallest reversible D3

D3 is delivered as two separately verifiable, separately committable outcomes, in this order:

1. **D3a — Growth Plan replacement.** The smallest reversible D3 slice: one Planning-owned
   `replace_growth_plan` preview/apply pair, the revised setup source, the `/plan` replacement
   control, and tests. It is clock-free, adds no calculation contract, adds no extension, and
   touches no Targets table. It is reversible because the only new durable states are one archived
   plan row plus one new plan row, both already legal shapes.
2. **D3b — availability windows.** Persistence with forced RLS and revision history, the
   `btree_gist` exclusion constraint, the persisted clock-sensitive proposal, create/change/remove
   commands, V3 calculation rollout, `/plan` UI, and gates.
3. **D4 — Targets campaign foundation.** Outcome Goal and Interview Campaign persistence with the
   deadline representation in §3, draft/start/deadline/target/end/cancel owner commands and events,
   with no Planning input and no coordinator.
4. **D5 — campaign overlays and coordination.** Allocation overrides per §5, the coordinator per §7,
   the V4 calculation rollout per §8, and proof that cancellation restores base allocation while
   retaining evidence and history.

No slice starts before the previous one is complete, verified, documented, and committed.

## Alternatives considered

- **Allow an initialized workspace to have zero current plans** (standalone archive). Rejected: it
  creates a state with no capacity, no tracks, and no Today source that every released read contract
  would have to special-case, and the canonical Domain Model says a personal workspace has one
  active Growth Plan and *retains* archived plans, not that it may hold only archived plans.
- **Copy Tracks into the replacement plan.** Rejected: it duplicates history, breaks the
  workspace-unique Track and candidate keys, and would silently reattach old attributions to a plan
  the user has not described. The handoff explicitly forbids silent copying.
- **Keep a campaign inert while the Growth Plan is paused** (today's engine behavior). Rejected: the
  Domain Model permits an independently active campaign, and a person who pauses long-term growth
  during interview week is the exact scenario P14 protects. Retained as a fallback if D5 measurement
  shows the paused-plus-campaign explanation confuses users.
- **Store the campaign deadline as a bare instant supplied by the client.** Rejected: users state a
  date, not an instant; a client-derived instant would silently encode the browser time zone.
- **Auto-end a campaign when its deadline passes.** Rejected: a background lifecycle mutation is a
  hidden plan change and would destroy the user's chance to record an outcome.
- **Availability windows that can raise weekly capacity.** Rejected: two independent ways to
  increase capacity would make "why is my week bigger?" unanswerable, and sustained capacity already
  has a released, previewed command.
- **A per-day capacity model replacing weekly capacity.** Rejected as a canonical-semantics change:
  the product plans a weekly budget, and per-day budgets imply a daily calendar PANDO deliberately
  does not own.
- **Distributing weekly capacity into an arbitrary daily share** so that windows could add or
  subtract days. Rejected: any share is arbitrary, produces integer-rounding artifacts, and is not
  explainable to the user.
- **Enforcing window non-overlap only in application code.** Rejected: overlap is exactly the class
  of invariant the engineering guideline requires the database to hold regardless of application
  code. `btree_gist` is a standard contrib extension, adds no runtime dependency, and is dropped
  together with the constraint on rollback.
- **Allocation overrides as capacity caps or as a separate reservation ledger.** Rejected: caps
  would starve a highly ranked candidate for no stated reason, and a second reservation mechanism
  would compete with the released protected minimum for the same meaning.
- **A general multi-operation coordinator in D5.** Rejected: E1–E2 own that surface, and building it
  before campaign owner truth exists would expose an untested transport-shaped path.

## Consequences

- Replacement, not archive, becomes the single answer to "start over". Users keep every past plan,
  and PANDO always has one current plan to explain, which keeps `/plan`, `/today`, and every
  released read contract total.
- `api.get_growth_plan_setup_source_v1` must stop treating more than one lifetime plan as
  corruption. `HISTORY_REQUIRES_REPLACEMENT` becomes unreachable in normal operation and is
  retained only as a fail-closed guard for a repaired or imported database.
- Availability introduces the first persisted, clock-bound Planning proposal. That is deliberate
  preparation for Agent Control E1, but it is Planning-owned and purpose-specific; it is not the
  Agent Control change-set table and must not become one.
- The planner gains two honest degraded explanations — capacity limited by availability and base
  plan paused during a campaign — instead of a refusal or a fabricated number.
- Four calculation versions will coexist in history (V1 through V4). Readers already select
  validation by the stored engine/policy/contract tuple, and that discipline becomes mandatory for
  every new reader.
- Nothing in this ADR authorizes deleting a plan, a track, a window, an override, a campaign, a
  snapshot, or any evidence.

## Security and privacy

- Every new table is workspace-owned with forced RLS, positive isolation tests, and negative
  cross-workspace tests, and is reachable only through purpose-specific `api` functions granted to
  `authenticated`; private owner hooks stay ungranted. Ordinary user commands never use
  `service_role`.
- Actor and workspace continue to be resolved exclusively from the authenticated session. Clients
  submit opaque server-issued keys, expected versions, a bounded printable reason, a request UUID,
  and a server-issued digest — never a workspace, plan, campaign, or window identifier of their own
  choosing.
- New events stay minimal: identifiers, versions, and a change kind. No deadline label, window
  label, reason body, evidence, Mastery, readiness, or Today payload enters the outbox.
- A window label and a campaign title are user-authored text; they are length-bounded, printable,
  never logged, and never placed in an event payload or in any agent-facing summary beyond the
  bounded fields the control contract defines.
- The persisted availability proposal stores resolved operations, fingerprints, and expiry only. It
  binds actor, workspace, and digest, is single-use, and holds no conversation or model trace.

## Migration and rollback

- **D3a.** Additive: a `replace_growth_plan` command plus a revised setup source. Rollback is
  revoking the new `api` functions and restoring the previous setup source; already-archived plans
  and their replacements remain valid rows under the existing constraints, so no data is stranded.
  Roll-forward is preferred because a replaced plan is a user decision that must not be undone
  silently.
- **D3b.** Additive tables, one `create extension if not exists btree_gist`, one exclusion
  constraint, and the V3 calculation rollout. Rollback: revoke the availability `api` functions and
  stop assembling V3 input; existing V3 snapshots stay readable under their own version tuple, and
  windows become inert data rather than being deleted. Dropping the extension is possible only after
  dropping the constraint and is not required for rollback.
- **D4.** Additive Targets tables and commands with no Planning input, so rollback is revoking the
  new `api` functions. Deadline fields are stored as supplied and derived together; no backfill
  interprets an existing row, because none exists.
- **D5.** Additive override tables plus the coordinator and the V4 rollout. Rollback: revoke the
  coordinator surface and stop assembling V4 input. Because base Track values are never mutated,
  disabling overrides restores base allocation exactly, with no backfill and no compensating write.
- Every slice follows expand → migrate → contract, keeps migrations immutable after application,
  and adds no destructive statement. No slice rewrites or deletes evidence, snapshots, receipts, or
  events.
- If a slice must be abandoned mid-flight, the durable state left behind is inert additive rows plus
  historical snapshots on their own version tuple. That is the property that makes each ordered
  slice independently reversible.
