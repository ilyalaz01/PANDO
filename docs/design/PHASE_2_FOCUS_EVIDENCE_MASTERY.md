# Phase 2 Focus, evidence, and first mastery vertical slice

Status: Implemented and locally verified
Date: 2026-08-27
Canonical authority: [Domain Model](../01_DOMAIN_MODEL.md),
[Product and UX Specification](../02_PRODUCT_AND_UX_SPEC.md), and
[MVP Delivery Plan](../04_MVP_DELIVERY_PLAN.md)

## 1. Outcome

Advance the first coherent Phase 2 journey without pulling Today, Review, or readiness forward:

1. A signed-in user selects an active personal activity from Explore and opens Focus.
2. Starting Focus creates one active `FocusSession` and one operational `ActivityAttempt`.
3. Stopping preserves time/history and creates no evidence.
4. Completing records an explicit result. A bare completion remains operational only; a success or
   failure becomes one normalized manual evidence event using the activity's owner-side mapping.
5. Evidence append or invalidation emits a durable Mastery delivery. The worker reloads the active
   ledger, runs the existing pure TypeScript engine, and persists an immutable competency-state
   snapshot behind a watermark-checked current pointer.
6. Focus shows session history, evidence/projection status, and the latest explainable competency
   state. Original evidence is never rewritten.

The first slice intentionally uses workspace-owned personal activities because the current Phase 1
database has no canonical Catalog Activity/Resource/ActivityCompetencyMap tables. It completes the
missing personal mapping fields required for trustworthy normalization. Canonical activities,
resources, and their versioned mapping tables remain a separately reviewable Catalog outcome before
MVP release.

## 2. Ownership clarification

The canonical Domain Model assigns `ActivityAttempt` to Evidence and `FocusSession` to Sessions.
The supporting module topology previously assigned an activity-attempt lifecycle to Sessions as
well. Canonical precedence resolves the conflict:

- Sessions owns `FocusSession`, its time budget, and `active → completed | stopped` lifecycle.
- Evidence owns `ActivityAttempt`, normalized evidence, and correction/invalidation records.
- User Overlay owns the personal activity and accepted activity-to-competency mapping.
- Mastery owns competency-state snapshots and the current projection pointer.
- A purpose-specific Focus application coordinator invokes the owning commands atomically; it does
  not become the owner of their rows.

Starting or ending a session and a bare completion are operational events. They never enter the
evidence ledger.

## 3. Personal activity mapping prerequisite

`overlay.custom_activities` gains owner-controlled fields:

- `evidence_dimension`: `KNOWLEDGE | RECALL | APPLICATION | INTERVIEW_EXECUTION`;
- `mapping_confidence`: fixed to `1.0` for the explicit user-created mapping in this slice;
- `mapping_status`: `accepted` for user-created activities;
- optional HTTPS `resource_url`;
- a short `expected_evidence` description.

The add-activity command derives these fields from the activity type. The browser cannot choose
confidence or reliability:

| Activity type   | Dimension             | Engagement without hint | Target-relevant performance |
| --------------- | --------------------- | ----------------------- | --------------------------- |
| `READING`       | `KNOWLEDGE`           | `PASSIVE`               | no                          |
| `EXPLANATION`   | `KNOWLEDGE`           | `INDEPENDENT`           | no                          |
| `MANUAL_CODING` | `APPLICATION`         | `INDEPENDENT`           | yes                         |
| `PROJECT`       | `APPLICATION`         | `INDEPENDENT`           | yes                         |
| `MOCK`          | `INTERVIEW_EXECUTION` | `INDEPENDENT`           | yes                         |

Using a hint changes non-passive engagement to `GUIDED`. Manual evidence has source reliability
`0.60`, the accepted policy floor, and records normalization policy
`manual-activity-outcome/0.1`. Here `targetRelevant` means that the observed applied/interview
performance came from an activity intentionally attached to a selected readiness target at the
time of observation. It is immutable evidence context, not a claim that every future target has the
same requirements.

## 4. Lifecycles and commands

Only one active Focus session is allowed per workspace in the MVP.

```text
FocusSession:    active ── complete ──> completed
                   └────── stop ─────> stopped

ActivityAttempt: in_progress ─ complete ─> completed
                     └─────── stop ─────> stopped
```

Commands are version 1, idempotent, and use the existing receipt/hash convention:

- `StartFocusActivityV1(goal, activity, plannedMinutes)`;
- `CompleteFocusActivityV1(sessionId, expectedVersion, resultKind, usedHint)`;
- `StopFocusActivityV1(sessionId, expectedVersion)`;
- `InvalidateEvidenceV1(evidenceId, reason)`.

`resultKind` is `OBSERVED_SUCCESS | OBSERVED_FAILURE | COMPLETION_ONLY`. Only the first two append
evidence. Completion and invalidation commit authoritative rows, command receipt, outbox events,
and the fixed Mastery delivery in the same transaction. Same key/same hash replays the stored safe
response; same key/different hash fails; stale expected versions apply nothing.

No command accepts a workspace, user, confidence, reliability, competency mapping, event payload,
table, or consumer name from the client. The authenticated subject resolves the workspace and every
owner-side reference.

## 5. Evidence and correction model

The ledger stores a normalized manual event plus one immutable mapping snapshot. Its public history
DTO exposes only identifiers, timestamps, result, dimension, source label, validity, and projection
status. Scratch text and private notes are excluded.

Invalidation inserts an immutable correction row that points to the original event. It never
updates or deletes the evidence row. Re-entering a corrected result is intentionally a new Focus
attempt in this first slice; replacement-in-one-command is a later Phase 2 extension.

Every evidence-bearing table rejects update/delete through a trigger. Workspace ownership has FORCE
RLS, positive own-workspace tests, and negative foreign-workspace tests even though authenticated
users receive no direct table grants.

## 6. Mastery worker

Evidence append/invalidation enqueues only `mastery.evidence_projection_v1`. The internal worker:

1. claims at most five fixed-consumer deliveries with an opaque lease;
2. reloads active authoritative evidence for the affected workspace/competency;
3. calls `calculateCompetencyState` with the accepted policy and an explicit clock;
4. completes through one worker-only RPC that checks lease, event contract, competency, and current
   evidence watermark;
5. inserts an immutable snapshot, advances the current pointer, writes the consumer receipt, and
   marks delivery succeeded atomically.

Snapshot identity includes engine version, policy version, the explicit `live-v1` projection
generation, and evidence watermark. Duplicate live deliveries therefore converge, while a future
replay or time-freshness recalculation can write a separate generation without mutating prior
snapshots. Activating a replay generation is a separate version-fenced Mastery operation; Phase 2
does not let the browser select or activate generations.

The browser cannot submit a mastery result. Worker RPCs are unavailable to `anon` and
`authenticated`; they accept neither arbitrary consumer names nor caller-selected workspaces. A
stale watermark writes no projection and leaves a retryable delivery. Duplicate completion creates
no second snapshot or receipt.

The server action may attempt one bounded dispatch after evidence commit. If internal worker
configuration is absent or dispatch fails, evidence remains committed and Focus truthfully shows
`Recalculating`; durable recovery remains available to the scheduled internal route.
Hosted activation and diagnosis follow the
[Phase 2 Mastery projection runbook](../runbooks/database/phase-2-mastery-projection.md). The schema
installs a fail-closed Supabase Cron activation function; it schedules nothing until the two named
Vault secrets are configured after deployment.

## 7. Focus UI

- Explore activity inspector: one `Start focus session` link; selecting map nodes remains selection,
  not mutation.
- `/focus`: server-owned authorized activity/session DTO and a small client form island.
- Initial state: activity goal, expected evidence, optional external resource, planned duration, and
  Start.
- Active state: elapsed timer, local unsaved scratch area, Stop, and compact result capture.
- Completed/stopped state: non-blocking confirmation, recent history, evidence status, and latest
  competency-state explanation.

The timer is advisory and server timestamps are authoritative. Scratch is explicitly local and
unsaved until an owning persistent-note decision is approved. The UI preserves drafts across
validation/conflict errors, uses stable request UUIDs for ambiguous retries, and never claims a
mastery update before the projection watermark catches up.

At mobile widths the page is a single column with minimum-size controls and no horizontal overflow.
Every field has a visible label, status updates are announced politely, failures use alerts,
completion does not require animation, and reduced/off motion remains valid.

## 8. Tests and failure cases

Verification required for this slice:

- pgTAP: schema constraints, FORCE RLS/grants, two-workspace isolation, valid lifecycle,
  invalid/stale transitions, active-session uniqueness, same-key replay, changed-hash rejection,
  state-plus-outbox atomicity, completion-only exclusion from ledger, normalized evidence mapping,
  immutable evidence/corrections/snapshots, worker lease/watermark fencing, and replay deduplication;
- TypeScript: DTO decoding, normalization/result boundaries, worker valid/stale/duplicate behavior,
  and existing Mastery golden/property tests;
- UI: start/active/stop/complete/pending/current/error states, draft preservation, keyboard,
  responsive layout, reduced motion, forced colors, and automated WCAG A/AA checks;
- authenticated journey: create/select a personal activity, start Focus, complete with observed
  success, verify one evidence event and recalculated state, reload, invalidate, and verify original
  history remains while the state rebuilds.

Injected failure before outbox append rolls back the owning command. Worker failure never rolls back
already committed evidence; it remains visible with a retryable projection state.

## 9. Migration and rollback

The migration is additive. Existing personal activities are deterministically backfilled from their
activity type before mapping fields become non-null. No existing evidence exists to migrate.

Application rollback leaves new private tables and rows in place but unused. Roll-forward is the
preferred recovery. The worker can replay immutable evidence into a new snapshot generation; it
never rewrites evidence. No destructive down migration is provided.
