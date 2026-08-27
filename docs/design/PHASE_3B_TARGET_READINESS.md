# Phase 3B — Target readiness implementation design

Status: implemented
Date: 2026-08-28
Owner: Targets bounded context

This is a supporting implementation design. The nine canonical documents and accepted ADRs retain
precedence.

## 1. Outcome and non-scope

Phase 3B completes the readiness half of Phase 3 without starting Planning prematurely:

- calculate one reproducible Targets-owned readiness snapshot for every active Readiness Goal;
- preserve `Unknown` as an interval and keep mandatory floors ahead of the aggregate;
- rebuild after relevant Mastery changes, evidence corrections, and time-only freshness expiry;
- expose one bounded authenticated detail query for Explore and one minimized current-only query for
  future Planning;
- show status, interval, coverage, confidence, exact profile/version/clock, blockers, requirement
  gaps, Unknown/Stale inputs, descriptive per-domain counts, and safe evidence references;
- preserve immutable calculation inputs and snapshots for audit and replay-safe diagnosis.

Planner-ranked actions, Today, campaign overrides, Agent Control, goal-deadline Review reasons, full
live `GraphProjectionV1`, evidence bodies, notes, and domain-level target-requirement aggregation are
not part of this outcome.

## 2. Ownership and interaction

Targets owns readiness policy application, readiness snapshots, current pointers, readiness events,
and the two readiness read contracts. Mastery owns synchronized competency-state inputs. Evidence
owns the immutable effective ledger. Explore composes authorized read models but owns no facts.

The flow is:

1. `targets.readiness_goal_created` and `mastery.competency_state_changed` wake only the fixed
   `targets.readiness_projection_v1` consumer. A scheduled freshness event can wake the same
   consumer later.
2. The leased Targets loader resolves affected active goals and their exact immutable profile/rule
   trees. A Mastery-owned bounded query reloads only the effective normalized observations for the
   required competencies and returns the workspace evidence watermark.
3. The Mastery application layer runs the existing pure Mastery engine for every required
   competency at one shared explicit clock. Missing evidence produces explicit Unknown dimensions.
4. Targets adapts the synchronized dimensions into the existing pure readiness engine, derives a
   deterministic input fingerprint and descriptive projection detail, and returns one result per
   affected goal.
5. A service-only completion RPC rechecks the lease, event contract, current evidence watermark,
   goal/profile/rule identity, exact required leaf set, shared clock, and result shape before it
   atomically stores immutable inputs/snapshot, advances the current pointer, emits a minimized
   readiness event, schedules the earliest freshness refresh, records the receipt, and completes the
   delivery.

Targets never reads Evidence tables directly and never rewrites Mastery timestamps. Browser, agent,
and Planning callers never submit calculated values or write readiness tables.

## 3. One synchronized calculation clock

Current Mastery pointers are calculated independently and therefore cannot be passed directly into
the readiness engine, which correctly requires every dimension to share `clock.asOf`. Changing only
the timestamp would preserve an obsolete freshness/confidence value and is forbidden.

`MasteryReadinessInputSetV1` is an internal, minimized application contract containing:

- one explicit `calculatedAsOf` for the complete set;
- the exact workspace Evidence ledger watermark;
- Mastery engine and policy versions;
- one state for every required competency/dimension, including explicit Unknown;
- achievement, freshness, confidence, last meaningful evidence instant, and opaque supporting and
  contradicting evidence identifiers, bounded to the eight most recent safe references of each
  kind per dimension;
- no evidence bodies, notes, attempt results, provider payloads, or activity text.

Mastery recalculates the set from the effective ledger through `mastery-engine/0.1.0` and
`mastery-readiness-policy/0.1`. The clock is truncated to milliseconds before calculation and
persistence so JavaScript and PostgreSQL compare the same instant.

## 4. Requirement capability and breakdown semantics

The current readiness engine evaluates competency/dimension leaves. The database also permits a
`DOMAIN` leaf for future policies, but no accepted rule defines how a domain expands or aggregates.
Phase 3B therefore fails such a calculation explicitly with `UNSUPPORTED_DOMAIN_REQUIREMENT`; it
does not reinterpret the domain as a competency and does not silently convert it to Unknown. The
seeded release profile contains only competency leaves. A later policy and versioned migration must
define domain aggregation before those profiles can produce current readiness.

The root readiness formula and `readiness-engine/0.1.0` output remain unchanged. Phase 3B adds
descriptive detail around that result rather than a second score:

- a requirement gap is one unique competency/dimension/required-level leaf plus its owning rules;
- gap order is failed mandatory floor, Unknown mandatory floor, other Unknown requirement, known
  shortfall, then stable semantic key;
- per-domain breakdown contains required-leaf, known, Unknown, Stale, and blocker counts only;
- domain membership comes from the exact authorized Catalog/Overlay structure at read-composition
  time; visual containment never changes readiness or target rules;
- Explore/Focus links help inspect or gather evidence but are not planner-ranked recommendations.

This meets the domain-breakdown UX without inventing a numeric aggregation for nested `ANY`,
`K_OF_N`, and weighted rules.

## 5. Persistence

Every table carries `workspace_id`, uses `ENABLE` plus `FORCE ROW LEVEL SECURITY`, and has positive
and negative isolation tests.

- `targets.readiness_snapshots`: immutable engine result, exact goal/profile/generation, canonical
  input fingerprint, source Evidence watermark, engine/policy versions, explicit clock,
  `valid_until`, interval, coverage, status, confidence, blockers, rule evaluations, and safe
  explanation codes.
- `targets.readiness_snapshot_inputs`: immutable audit manifest with one row per unique required
  competency/dimension/level, owning rule keys, synchronized Mastery state, last meaningful
  evidence instant, and opaque evidence IDs. It copies minimized calculation input but is not a
  second Mastery authority.
- `targets.current_readiness_snapshots`: one rebuildable pointer per goal with projection version,
  source watermark, calculation clock, and `valid_until`.

The pointer advances only when the source watermark is greater, or when it is equal and the
calculation clock is strictly later. A late result can never replace a newer projection. Snapshot
and input updates/deletes are rejected.

`readiness-input:<sha256>` fingerprints the ordered goal/profile/rule/input/policy/clock manifest.
The fingerprint is reproducibility metadata; completion correctness also uses typed database
fences and never trusts the digest alone.

## 6. Freshness without new evidence

The Mastery policy treats a dimension as Stale only after its exact freshness window. Each result
derives `valid_until` as the earliest next required-dimension freshness transition; an exact
boundary remains fresh and boundary plus one millisecond becomes stale.

Snapshot completion emits one `targets.readiness_refresh_scheduled` event and one fixed delivery
whose `available_at` is `valid_until + 1 ms`. The event references the source snapshot. If evidence
creates a newer snapshot first, the old scheduled delivery succeeds as a no-op after its pointer
fence fails. Pending delivery state remains durable if Cron or HTTP recovery is unavailable.

The authenticated query never reports an expired result as current. Explore may show the last
snapshot explicitly as Stale or Rebuilding; the Planning query fails closed unless the pointer is
current and inside its validity interval.

## 7. Commands, events, and contracts

Fixed worker RPCs mirror the accepted outbox pattern:

- `claim_target_readiness_projection_v1`;
- `load_target_readiness_projection_v1`;
- `complete_target_readiness_projection_v1`;
- `fail_target_readiness_projection_v1`;
- `get_target_readiness_projection_health_v1`.

`TargetReadinessV1` is the authenticated zero-workspace detail read. It returns
`NOT_MATERIALIZED | REBUILDING | CURRENT | STALE | ERROR`, the last safe snapshot when available,
the exact profile/version/clock, blockers, ordered gaps, and minimized supporting inputs.

`PlanningReadinessInputV1` is a smaller Targets query containing only a current snapshot identity,
versions/fingerprint, interval/status/confidence, blockers, gaps, and validity. It returns no stale
result, UI prose, notes, or evidence bodies.

`targets.readiness_projection_changed` event v1 contains only goal/profile/snapshot identifiers,
projection version, fingerprint, status, interval, confidence, source watermark, calculation clock,
and versions. Consumers reload the bounded Targets query.

Historical goal-created events are backfilled idempotently. Future goal and Mastery events are
routed only to the fixed consumer; callers cannot select a consumer, workspace, goal, event body,
or table.

## 8. Delivery, retry, and recovery

The worker follows ADR-0003: claim at most five, process at most one leased delivery per workspace,
use random 120-second leases and a 20-second handler deadline, classify contract failures as
permanent, retry transient/stale input up to eight attempts with capped exponential backoff and
jitter, and retain safe health codes and dead letters.

Observation cursor order is never correctness authority. Every wake-up reloads authoritative
state, and exact typed watermark/pointer/clock fences decide whether a result applies. Duplicate,
late, irrelevant, and superseded events converge without duplicate snapshots or pointer regression.

A secret-authenticated fixed Next.js route provides bounded immediate and Cron recovery dispatch.
Creating a goal and completing/correcting evidence may attempt one dispatch after commit. The route
is not the queue.

Goal admission is enforced both at the idempotent command boundary and by a table-side trigger that
serializes active-goal writes on the workspace advisory key. Upgrade preflights run before each
historical delivery backfill, and the producer replacement, repeated preflight, and rollout-closing
backfill share one explicit table-locked transaction. A caller that entered an older producer body
before deployment therefore still reaches the new table invariant after the lock is released.

The current single-user MVP admits at most 20 active goals and 250 total requirement leaves across
those goals, with at most 250 distinct required competencies in one workspace wake-up. Calculation
may read at most 10,000 effective Evidence observations per competency and 50,000 across the wake;
the ledger itself remains authoritative and is not truncated. Persisted readiness inputs retain at
most the eight most recent safe supporting and eight most recent safe contradicting references per
dimension. The result is also rejected before transport when its encoded payload exceeds the
768 KiB worker safety budget below the database's 1 MiB boundary. These are explicit supported MVP
envelopes, not scale claims. The seeded release profile is far below them. Before a larger profile,
workspace workload, or evidence history is admitted, the worker needs stable continuation batching
and/or a Mastery-owned sufficient-statistics contract. Silently truncating requirements or
calculation evidence is never allowed.

## 9. Explore and accessibility

The existing `ExploreStructuralProjectionV1` remains the live structural Map/Outline contract.
Phase 3B renders the separately validated `TargetReadinessV1` beside it. This avoids lossy
translation of slash-containing live engine versions into the older `GraphProjectionV1`
`versionString` grammar and avoids inventing numeric domain states.

The readiness summary shows:

- status and interval, or one approximate value only when the interval is a point and coverage is
  sufficient;
- coverage, confidence, exact target profile version, and calculation date;
- mandatory blockers before other gaps;
- Unknown and Stale as different states, never zero;
- descriptive domain counts and safe last-evidence/support references;
- explicit not-materialized, rebuilding, stale, error, and empty states.

Gap actions select the corresponding Outline competency and move keyboard focus; they do not mutate
state. The surface remains usable at 320 px, with keyboard, forced colors, reduced/off motion, and
screen-reader labels. Full numeric domain readiness and calculated graph node states wait for a
separate versioned `GraphProjection` migration.

## 10. Verification and release safety

Required evidence includes:

- unit/property tests for one shared clock, Unknown synthesis, exact freshness boundaries, stable
  input fingerprints, requirement adaptation, mandatory-floor precedence, gap order, and input
  permutation invariance;
- valid, invalid, boundary, and malicious fixtures for the readiness event and read contracts;
- pgTAP for schema/grants/FORCE RLS, two-workspace isolation, immutable history, atomic rollback,
  claim/lease/retry/dead-letter behavior, watermark fencing, no pointer regression, irrelevant and
  superseded wake-ups, bounded table-side goal admission, time-only refresh, and strict read state;
- authenticated goal-to-Unknown and evidence/correction-to-readiness browser journeys;
- responsive, keyboard, reduced-motion, forced-colors, and axe checks;
- repository verification, database lint/tests, backup/restore, auth journey, secret scan, Graphify
  refresh, and green CI before handoff.

Migrations are additive. Rolling application rollback leaves authoritative goals, Evidence, and
Mastery untouched; deliveries remain durable for a corrected worker. A future policy uses a new
projection generation and snapshots rather than rewriting readiness history.
