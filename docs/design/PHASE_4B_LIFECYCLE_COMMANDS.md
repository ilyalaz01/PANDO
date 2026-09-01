# Phase 4B lifecycle and editing command design

Status: implementation design (D0); D1, D2a, D2b1, and D2b2 implemented; remaining D2 and D3–D5 pending
Date: 2026-08-29  
Canonical basis: `docs/00_PRODUCT_CONSTITUTION.md` through `docs/06_PROMPT_LIBRARY_UX.md`

## 1. Outcome

Phase 4B adds the authoritative commands that let a person safely change a persistent Growth Plan,
its Learning Tracks, dated availability, and an optional Interview Campaign. The browser and the
later Agent Control plane must invoke the same owner rules. Every change is previewed, explicitly
confirmed, version-fenced, idempotent, auditable, history-preserving, and atomic with its outbox
effects.

This design deliberately does not add an AI model, MCP transport, natural-language interpretation,
Preparation Pack import, or a second mutation path. Agent Control may coordinate owner commands;
it never becomes the owner of Planning or Targets state.

## 2. Resolved terminology and scope

The canonical lifecycle is authoritative:

- Growth Plan: `active | paused | archived`;
- Learning Track: `active | paused | completed | archived`;
- Interview Campaign: `draft | active | ended | cancelled`.

Therefore a Growth Plan is **archived**, never completed. The generic Phase 4 delivery word
“complete” applies to a Learning Track. The prior D0 handoff wording “Growth Plan ... complete” was
non-canonical and must not become a database state or command.

MVP has one current Growth Plan, meaning one row in `active` or `paused`, and at most one active
Interview Campaign. An archived plan remains queryable history. The canonical documents do not
settle whether an initialized workspace may return to zero current plans. Standalone archive is
therefore deferred until an ADR chooses replacement-only or an explicit no-current-plan outcome; it
is never disguised as pause.

## 3. Ownership and authoritative aggregates

| State or decision | Owner | Aggregate/version fence |
|---|---|---|
| Growth Plan lifecycle and default weekly capacity | Planning | Growth Plan |
| Learning Track lifecycle, priority, cadence, protected minimum | Planning | Learning Track |
| Dated availability | Planning | Growth Plan plus Availability Window revision |
| Campaign allocation override for a track | Planning | Growth Plan and affected Learning Track/override revision |
| Outcome/Readiness Goal lifecycle and exact target profile version | Targets | respective Goal |
| Interview Campaign lifecycle, deadline, target, requirement overrides | Targets | Interview Campaign |
| ChangeSet proposal, confirmation, orchestration, plan-revision audit | Agent Control | ChangeSet/context revision |
| Evidence, Mastery, Review, Today snapshot | their existing owners/derived projections | never directly mutated here |

Planning never writes a campaign or goal table. Targets never writes capacity or allocation tables.
Cross-owner reads use bounded owner queries; changes use owner commands or private owner hooks and
versioned events.

## 4. Transition rules

### 4.1 Growth Plan

| Command | From | To | Rule |
|---|---|---|---|
| initialize/replace | none | `active` | creates the one current plan; replacement semantics remain ADR-gated |
| `pause_growth_plan` | `active` | `paused` | reversible; retains tracks, snapshots, sessions, and evidence |
| `resume_growth_plan` | `paused` | `active` | fails if another current plan exists |
| `archive_growth_plan` | `active` or `paused` | `archived` | terminal; deferred until the current-plan cardinality ADR |
| `set_default_capacity` | `active` or `paused` | unchanged | `0..10080`; the sum of protected minima across active child Tracks above the new capacity is a blocking validation error |

A new idempotency key that requests the already-current lifecycle is rejected as an invalid
transition. A replay of the original completed key returns the stored response. Archived plans
cannot be resumed or edited.

### 4.2 Learning Track

| Command | From | To | Rule |
|---|---|---|---|
| `create_track` | none | `active` | parent plan must be current (`active` or `paused`) |
| `pause_track` | `active` | `paused` | reversible; removes its Growth Plan source from current candidate generation |
| `resume_track` | `paused` | `active` | parent plan must be current, not archived |
| `complete_track` | `active` or `paused` | `completed` | terminal Planning decision; history/evidence retained without asserting Mastery |
| `archive_track` | `active`, `paused`, or `completed` | `archived` | terminal visibility/history decision |
| `set_track_cadence` | `active` or `paused` | unchanged | cadence, protected minimum, and priority are validated together |

`completed` is not a synonym for `archived`. Completed records the user's Planning lifecycle
decision; it does not establish evidence, Mastery, readiness, or that an outcome was reached.
Archived removes a track from normal current-plan use. Neither state can be resumed. Track editing
is refused when the parent plan is archived.

### 4.3 Interview Campaign

| Command | From | To | Rule |
|---|---|---|---|
| create draft | none | `draft` | exact deadline, Readiness Goal, and target profile are required at creation |
| `start_campaign` | `draft` | `active` | at most one active campaign; installs validated temporary overlays |
| `end_campaign` | `active` | `ended` | normal close; removes temporary overlays |
| `cancel_campaign` | `draft` or `active` | `cancelled` | external opportunity disappeared; reason retained; removes temporary overlays if active |
| change deadline/target | `draft` or `active` | unchanged | exact versions; a target change points to a new/existing exact Readiness Goal rather than mutating one |

`ended` and `cancelled` are terminal. Both retain the campaign, linked goals, evidence, and revision
history. Removing temporary Planning overrides restores base Growth Plan allocation; it does not
rewrite completed work or Mastery.

### 4.4 Goals

Goals are superseded, not overwritten or deleted, and exact profile references remain immutable.
The precise goal lifecycle edge, predecessor identity, and campaign retarget workflow remain part
of the required campaign/target ADR. D1–D3 do not invent or expose those commands.

## 5. Owner command protocol

Every public owner mutation follows the same transaction shape:

1. Resolve actor and personal workspace exclusively from the authenticated session.
2. Validate scalar syntax and calculate a canonical request hash.
3. Lock `(actor, command type, idempotency key)` and replay only an identical completed request.
4. Acquire the owner workspace advisory lock, then lock aggregate rows in stable UUID order.
5. Recheck membership, lifecycle, cardinality, references, and every expected aggregate version.
6. Recompute the preview digest from locked authoritative state and require an exact match.
7. Insert the started command receipt.
8. Apply owner state and increment each touched aggregate version exactly once.
9. Insert owner event(s), fixed Planning delivery rows where recalculation is required, and the
   completed receipt response.
10. Commit all effects together; any error rolls back all effects.

The current Planning lock key remains `planning-workspace:<workspace UUID>`. Multi-owner Agent
Control application additionally takes one `agent-control-workspace:<workspace UUID>` lock before
entering owner hooks. Operations are ordered by owner, aggregate type, and UUID. Owner hooks still
lock and version-check their own rows, so direct UI commands and a coordinator cannot bypass one
another.

In accordance with ADR-0002, browser code calls domain reads/mutations only through a Next.js server
action or route handler using a user-scoped Supabase client. Purpose-specific `api` RPCs remain
granted to `authenticated` and independently enforce the same authentication, authorization, and
RLS if called directly. Private module implementation/owner-hook functions are not granted to
`authenticated` or `service_role` and are not an alternate public surface. Ordinary user commands
never use `service_role`.

## 6. Deterministic owner preview

An owner preview is a pure read and returns a versioned document containing:

- operation and resolved aggregate identifiers;
- every touched aggregate and expected version;
- canonical `before` and `after` owner state;
- lifecycle/history effects and explicitly unchanged evidence/history;
- recalculation state (`PENDING` after apply), warnings, and blocking unknowns;
- a SHA-256 digest over the contract version, workspace, resolved operation, expected-version
  vector, before/after state, and owner input fingerprints.

Clock-sensitive previews additionally receive one explicit `previewAsOf`, workspace time zone, and
expiry. They never call an implicit clock inside domain calculation. Operations, preconditions, and
impacts use canonical stable ordering before hashing.

The preview never becomes authority and never claims a final Today result. Apply locks current
state, recomputes the document, and refuses a stale version or changed digest. The browser shows
the preview and obtains explicit confirmation before calling apply. D1's digest is deliberately
limited to Growth Plan state and the statement that Today recalculation will be pending; it contains
no clock-derived ranking impact. Clock-sensitive previews begin only with a persisted server-issued
proposal that carries `previewAsOf` and expiry.

Agent Control later persists a server-resolved proposal around these owner previews. Its token,
expiry, actor/workspace binding, confirmation record, and aggregate preconditions add safety; they
do not replace owner validation.

The existing `PlanChangeSetV1` shape has only one `aggregate_ref` and `expected_version` per
operation. That is insufficient for operations such as campaign cancellation, which touches a
Targets Campaign and Planning overrides. Before a multi-owner coordinator is exposed, add a new
versioned contract with a required precondition vector:

```text
{ owner, aggregate_type, aggregate_id, expected_version }
```

Create operations also carry a workspace/cardinality sentinel precondition. The current
`base_projection_watermark` remains a freshness/re-preview signal, not a commit-order or
authorization fence. A workspace-scoped Agent Control context revision is the authoritative scalar
returned after apply.

The V1 operation catalog also needs reconciliation in that new contract: it has no
`create_growth_plan`, models campaign target changes too loosely for immutable goal/profile
identity, and exposes `cadence_per_week` while Planning currently persists only protected minutes
and default session length.

## 7. Events and projection behavior

Planning changes emit `planning.input_changed` with the owner aggregate ID/version, command and
correlation IDs, and a non-sensitive change kind. Every event has one fixed
`planning.plan_snapshot_v1` delivery. The current pointer becomes pending/stale through the existing
projection protocol; apply returns `projectionState: PENDING` and event/delivery IDs.

Targets lifecycle events remain Targets-owned and route to Target Readiness and Planning through
their registered fixed consumers. A coordinator may emit several owner events in one transaction;
it does not emit a fabricated combined domain event in place of them.

Preview impacts are estimates over the captured inputs. Only rebuilt owner projections may be
reported as current. Failure or quarantine remains visible through a status read and never converts
the authoritative change into a false success projection.

## 8. Persistence still required

Later slices add:

- Planning `availability_windows` and `campaign_allocation_overrides`, with forced RLS and revision
  history;
- Targets Outcome Goal and Interview Campaign persistence/commands;
- Agent Control `plan_change_sets`, append-only confirmations, `plan_revisions`, operation audit,
  and workspace context revisions.

Agent Control proposal rows contain resolved operations and fingerprints, not raw conversation,
evidence bodies, Preparation Packs, secrets, or model traces. Confirmation binds actor, workspace,
preview digest, and expiry. `apply_change_set` accepts only server IDs/token/confirmation and an
idempotency key; clients cannot replace the previewed body at apply time.

## 9. Ordered implementation slices

1. **D1 — Growth Plan pause/resume.** Read current plan lifecycle; preview/apply pause and resume
   through Planning; add a responsive `/plan` UI using the same APIs.
2. **D2 — Growth Plan capacity and Learning Track controls.** Preview/apply default capacity,
   create, priority, protected minimum, pause/resume/complete/archive; settle and then persist
   cadence. The first bounded increment is the accepted
   [D2a Growth Plan weekly-capacity design](PHASE_4B_D2A_GROWTH_PLAN_CAPACITY.md). The next accepted
   increment is
   [D2b1 Learning Track pause/resume](PHASE_4B_D2B1_LEARNING_TRACK_LIFECYCLE.md); it does not expose
   the remaining Track commands. The next accepted increment is
   [D2b2 Learning Track priority and protected minimum](PHASE_4B_D2B2_LEARNING_TRACK_PRIORITY_MINIMUM.md),
   which deliberately leaves cadence undefined.
3. **D3 — availability and plan replacement.** After the lifecycle ADR, add dated availability,
   plan archive/new-plan replacement, and deterministic capacity composition.
4. **D4 — Targets campaign foundation.** After the campaign-semantics ADR, persist Outcome Goals
   and Interview Campaigns; add draft/start/deadline/target/end/cancel commands and owner events.
5. **D5 — campaign overlays and atomic lifecycle coordination.** Add Planning allocation overrides,
   integrate them into the live Planning input, and add the purpose-specific cross-owner
   coordinator used by the manual UI before any override can become effective. Start/end/cancel and
   allocation apply atomically with a precondition on the exact Targets Campaign version plus every
   touched Planning aggregate. Prove cancellation restores base allocation and retains
   evidence/history.
6. **E1 — Agent Control V2 read/proposal boundary.** Add compact context projection and persisted
   previews with the multi-aggregate precondition vector.
7. **E2 — atomic coordinator.** Apply confirmed multi-owner change sets and plan-revision audit,
   then expose the same services through manual UI, CLI/skill, and authenticated MCP.

This order establishes owner truth before transport and exercises every owner operation manually
before an agent can invoke it.

## 10. Decisions required before later slices

D1 pause/resume implements accepted semantics and requires no ADR. Before D3–D5, one focused ADR
must settle the still-open cross-context rules:

1. whether an initialized workspace must always have one current `active|paused` Growth Plan and
   whether archive therefore requires atomic replacement;
2. whether a campaign continues to affect ranking while the Growth Plan is explicitly paused (the
   canonical model permits an independently active campaign, while planner policy 0.1 currently
   refuses every campaign unless the plan is active);
3. campaign deadline representation (`date` versus an instant), workspace-time-zone conversion,
   and behavior after the deadline passes;
4. campaign target changes through immutable Readiness Goal/profile references;
5. whether allocation minutes are reservations, caps, or preferences and their invariant against
   flexible capacity;
6. the unit and meaning of cadence, which is named in Agent Control but not represented in current
   Planning persistence;
7. Availability Window identity, create/update cardinality sentinel, overlap resolution,
   interval/time-zone semantics, and precedence in capacity composition;
8. the exact Phase 4 purpose-specific coordinator boundary for campaign lifecycle plus Planning
   overrides, before the general multi-operation Agent Control coordinator ships.

Changing the planner's campaign/paused-plan behavior also requires a versioned policy/engine
revision. No later implementation may silently choose one of these meanings.

## 11. First implementation outcome: D1 Growth Plan pause/resume

D1 is complete only when a signed-in user can open `/plan`, see the current plan title, lifecycle,
capacity and aggregate version, preview pause or resume, confirm it, and observe the accepted new
state plus pending/current recalculation status.

Required gates:

- database migration adds a bounded current-plan read and Planning-owned preview/apply APIs;
- the versioned `planning.input_changed` event contract, valid/boundary/invalid/malicious fixtures,
  and runtime tests admit the exact lifecycle-change payload before it can enter the outbox;
- apply accepts operation, expected Growth Plan version, exact preview digest, reason, and
  idempotency key; it changes only `planning.growth_plans` plus receipt/outbox/delivery state;
- transition, stale version, changed digest, same-key replay, changed-key conflict, and concurrent
  apply tests pass;
- two-workspace positive and cross-workspace/foreign-ID negative tests prove forced-RLS isolation;
- injected failure proves state, receipt, event, and delivery rollback together;
- `/plan` has no direct table write and no inert controls; it shows the exact before/after preview,
  requires confirmation, handles stale refresh, and exposes pending recalculation honestly;
- keyboard, mobile viewport, reduced-motion, and WCAG A/AA automated checks pass;
- generated Supabase API types are refreshed from the migrated database and typechecked;
- repository `verify`, `verify:db`, `verify:auth`, and relevant backup/restore gates pass before
  merge.

No ADR is required for D1: it implements the already accepted ownership, command/outbox,
deterministic-preview, and modular-monolith decisions. The later lifecycle/campaign ADR is required
before D3. A new versioned ChangeSet schema is required before E1, but it supersedes an internal
pre-release contract rather than changing product semantics.
