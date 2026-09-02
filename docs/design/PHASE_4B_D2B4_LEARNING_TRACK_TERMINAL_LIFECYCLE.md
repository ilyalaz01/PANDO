# Phase 4B D2b4 — Learning Track completion and archive

Status: accepted implementation design

Date: 2026-09-02

Parent design: [Phase 4B lifecycle and editing commands](PHASE_4B_LIFECYCLE_COMMANDS.md)

Reversible lifecycle basis:
[D2b1 Learning Track pause/resume](PHASE_4B_D2B1_LEARNING_TRACK_LIFECYCLE.md)

## 1. Outcome and boundary

D2b4 lets a signed-in person complete or archive one Learning Track through Planning's existing
actor-scoped read, deterministic preview, explicit confirmation, idempotent apply, audit, outbox,
and atomicity discipline.

The already released `CurrentLearningTracksV1` and `LearningTrackLifecyclePreviewV1` remain exactly
pause/resume-only. Terminal operations use a separate additive contract so old clients do not gain
new meanings or transition states silently.

This outcome does not add cadence, Plan archive/replacement, availability, Campaigns, Goal
completion, evidence, Mastery/readiness mutation, Agent Control transport, or destructive deletion.

## 2. Accepted terminal semantics

- `complete_track` changes `active|paused -> completed`.
- `archive_track` changes `active|paused|completed -> archived`.
- A completed Track is a terminal Planning decision. It is not evidence and does not assert
  competency Mastery, target readiness, Readiness Goal completion, or an Outcome Goal.
- Archive is a terminal visibility/history decision, not deletion.
- Neither completed nor archived Tracks can be paused, resumed, edited, or receive newly admitted
  work.
- Activities and attributions, Focus sessions, Evidence, Mastery/readiness, Review items, plan
  snapshots, receipts, and events remain intact.
- Terminal Tracks leave the current Track count, active protected-minimum total, current ordering,
  Today candidate generation, and destination-aware activity admission.
- The parent Growth Plan must be current (`active|paused`). Editing is refused once the parent Plan
  is archived.

The Growth Plan and sibling Track versions remain unchanged. The target Track version increments
exactly once.

## 3. Bounded source and history

Add zero-authority-input `LearningTrackTerminalLifecycleSourceV1` with an optional opaque history
cursor. It returns one current Growth Plan or the honest `NO_CURRENT_PLAN` state.

For a current Plan it returns:

- all `0..30` current `active|paused` Tracks in the existing deterministic order;
- one page of at most 20 terminal `completed|archived` Tracks;
- a nullable server-issued next cursor and `hasMore`;
- per-Track capabilities derived by the server:
  - active/paused: `complete_track`, `archive_track`;
  - completed: `archive_track`;
  - archived: none.

The terminal page uses keyset order `updated_at DESC`, then `track_key COLLATE "C"`, then Track
UUID. The cursor encodes exactly that tuple and a cursor version. Invalid, oversized, or malformed
cursors fail closed. The page size is fixed so the browser cannot request an unbounded collection.
Fetching a later history page does not remove the complete current Track list.

More than 30 current Tracks, corrupt current-Plan cardinality, duplicate keys, or an inconsistent
cursor is unavailable rather than silently truncated. Missing and foreign selectors collapse to the
same unavailable mutation result. Archived rows remain visible as read-only history; they never
become mutation targets.

The source is a safe current-state/history projection, not a second authority. Planning rows and
the append-only events remain authoritative.

## 4. Versioned preview

Add `LearningTrackTerminalLifecyclePreviewV1` for `complete_track|archive_track`. The browser sends
only a server-returned Track key, operation, exact expected Growth Plan and Track versions, and a
trimmed printable reason of `1..500` characters.

The preview binds and shows:

- the current parent Plan identity, lifecycle, capacity, and version;
- exact Track identity, key, title, lifecycle, priority, protected minimum, and version before and
  after the transition;
- current Track count and deterministic current-order fingerprint before and after;
- active Track count, protected-minimum total, flexible minutes, and active-constraint fingerprint
  before and after;
- current-versus-history visibility before and after;
- the terminal/no-resume consequence;
- retained history and the explicit non-claim about Evidence, Mastery, readiness, and Goals;
- one operation-specific warning;
- one fixed `planning.plan_snapshot_v1` delivery and honest `PENDING` recalculation after apply;
- the exact SHA-256 preview digest.

Warnings are exact and ordered:

- `TRACK_COMPLETION_IS_TERMINAL_AND_NOT_MASTERY`; or
- `TRACK_ARCHIVE_IS_TERMINAL_NOT_DELETION`.

A valid transition is applicable and has no blocker. Invalid/no-op transitions, archived selectors,
stale expected versions, foreign keys, and archived parent Plans are unavailable errors and expose
no confirmation.

`learning-track-terminal-lifecycle-preview-digest/1.0.0` uses the existing ordered,
length-prefixed UTF-8 framing. It binds the contract/digest versions, authenticated workspace,
command type, operation, reason, both expected versions, resolved Plan and Track facts, exact
before/after state, both current-order fingerprints, both active-constraint fingerprints and
summaries, visibility, applicability, warning, retained/non-claim facts, event kind, and fixed
consumer. Apply never trusts the digest as authority.

## 5. Atomic owner command and event

The command type is `planning.change_learning_track_terminal_lifecycle_v1`. Apply accepts the same
preview inputs plus the exact digest and a lowercase request UUID used as the idempotency key.

Apply:

1. validates scalar syntax, resolves actor/workspace, and hashes the exact request;
2. serializes `(actor, command type, idempotency key)` and replays only an identical completion;
3. takes `planning-workspace:<workspace UUID>`;
4. locks the current Plan and every child Track, including terminal rows, in stable UUID order;
5. resolves the submitted key inside that Plan, rechecks the transition and both versions, and
   rebuilds the exact preview from locked state;
6. requires an exact digest, inserts the started receipt, and updates only the target Track's
   lifecycle, aggregate version, and timestamp, requiring exactly one affected row;
7. appends one minimal event and exactly one fixed Planning delivery;
8. completes the receipt response and commits every effect together.

The additive `planning.input_changed` V1 payload is:

```json
{
  "change_kind": "TRACK_TERMINAL_LIFECYCLE_CHANGED",
  "growth_plan_id": "<uuid>",
  "learning_track_id": "<uuid>",
  "learning_track_version": "<positive bigint string>",
  "lifecycle": "COMPLETED|ARCHIVED"
}
```

Its envelope aggregate is `planning.learning_track`. It carries no title, reason, activity,
Evidence, Mastery, Goal, or Today body. The existing reversible
`TRACK_LIFECYCLE_CHANGED` variant remains unchanged.

## 6. Manual UI

`/plan` keeps the existing pause/resume section unchanged and adds `Complete or archive a Learning
Track`.

- A native Track selector contains current Tracks plus the loaded terminal history page.
- Active/paused Tracks offer operation radios for complete and archive.
- Completed Tracks offer archive only.
- Archived Tracks are labelled read-only and expose no operation or confirmation.
- The reason, preview, and exact operation-specific confirmation follow the existing Plan action
  pattern.
- Completion copy says explicitly that it does not prove Mastery/readiness or complete a Goal.
- Archive copy says explicitly that it is not deletion.
- The preview names retained activities, sessions, Evidence, Mastery/readiness, Review, snapshots,
  and Track history.
- A next-page action loads another bounded terminal-history page without changing authoritative
  state.

Changing Track, operation, reason, or history page dismisses the terminal confirmation. Starting or
changing any Plan, capacity, lifecycle, settings, creation, or admission intent dismisses every
other pending confirmation. A stale conflict disables apply and offers reload. Success refreshes
`/plan` and `/today`.

Keyboard order, 44-pixel targets, 320-pixel layout, reduced motion, forced colors, and automated
WCAG 2.2 A/AA checks remain required.

## 7. Required proof

D2b4 is complete only when tests prove:

- strict valid, boundary, invalid, and malicious source/preview/apply/event contracts;
- active and paused completion, active and paused archive, and completed archive;
- every no-op, resurrection, archived mutation, parent-archived, foreign, and malformed refusal;
- fixed 20-item keyset history pages, stable continuation, archived read-only visibility, invalid
  cursor refusal, and no silent truncation;
- TypeScript/PostgreSQL digest and current-order/active-constraint fingerprint agreement;
- preview purity; stale Plan, target Track, and sibling-order refusal;
- same-key replay, changed-request conflict, same/distinct-request races, and serialization against
  capacity, pause/resume, settings, creation, and both activity-admission versions;
- exactly one Track version increment, unchanged Plan/siblings, and retained activities,
  attributions, sessions, Evidence, Mastery/readiness, Review, snapshots, receipts, and event history;
- one minimal event, one fixed delivery, and full rollback on injected receipt/update/event/delivery
  failure;
- forced RLS, positive/negative workspace isolation, non-enumeration, least privilege, and ignored
  browser-supplied authority;
- operation-aware controls, exact confirmation copy, stale/empty/history states, reload persistence,
  keyboard, responsive, touch, reduced-motion, forced-colors, and accessibility behavior;
- one real authenticated `complete -> reload -> archive -> reload` journey after the existing
  activity/Focus/evidence flow;
- `pnpm verify`, `pnpm verify:db`, `pnpm verify:auth`, and `pnpm verify:backup` before merge.

## 8. Roll-forward and deferred work

The migration is additive. UI rollback removes the new controls while keeping terminal Track rows,
receipts, events, deliveries, and all linked history valid. Existing pause/resume, settings,
creation, and admission contracts remain readable and executable.

Deferred: cadence, Plan archive/replacement, availability, Campaigns and allocation overrides,
generic competency-collection Tracks, Preparation Packs, and Agent Control transport.
