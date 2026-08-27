# Phase 3A — Review Core implementation design

Status: implementation-ready
Date: 2026-08-27
Owner: Review bounded context

This is a supporting implementation design. The nine canonical documents and accepted ADRs retain
precedence.

## 1. Outcome and non-scope

Phase 3A delivers the minimum Review Core that Planning can consume later:

- create deterministic review reasons after qualifying evidence;
- keep one Review item per workspace and structured competency/dimension subject;
- merge all active reasons and use the earliest active due instant;
- query mutually exclusive overdue, due-today, upcoming, personal-reminder, and suppressed views;
- append-only personal reminder, reschedule, skip-once, suppress, and restore commands;
- enter the existing Focus lifecycle from a safe activity reference;
- preserve reason/action/snapshot history through evidence correction and replay.

Readiness calculation, goal-deadline reasons, substitute activity, review grading, notification
delivery, Today ranking, and Planning are later outcomes. `Mark completed elsewhere` is not faked:
it requires the ordinary Evidence capture path before it can affect Review.

## 2. Ownership and interaction

Review owns subjects, reason sources and revisions, action history, calculation snapshots, current
pointers, Review events, and queue queries. Evidence and Mastery remain authoritative for evidence
and competency state. Sessions remains authoritative for Focus.

The flow is:

1. Mastery atomically attaches one fixed `review.item_projection_v1` delivery when its current
   pointer advances and emits `mastery.competency_state_changed`.
2. The Review worker treats the Mastery event as a wake-up only. A bounded Mastery-owned query
   reloads the current snapshot and returns, per objective dimension, only the authoritative level,
   first/latest qualifying-success instants, latest supporting evidence occurrence, and safe Focus
   references. Mastery derives the anchors from its own supporting-evidence selection; Review does
   not reimplement Evidence qualification.
3. The pure Review source/action fold combines prospective Mastery source events with immutable
   Review actions. The existing `review-engine/0.1.0` then calculates the item with an explicit
   clock.
4. A leased service-only RPC rechecks the current Mastery pointer and Review aggregate
   version, input event, and lease before atomically appending revisions, storing the immutable
   snapshot, advancing the pointer, emitting a privacy-minimized Review event, and completing the
   delivery.
5. Review commands append one source/action event plus command receipt, Review input event, and a
   fixed projection delivery in one transaction. The worker later persists the versioned snapshot;
   the queue labels the calculation pending until the pointer catches up.

No browser or agent writes Review tables directly. No Review function writes Evidence, Mastery,
Sessions, Overlay, or Targets tables. `Start now` is only a link into the existing authorized Focus
command boundary.

## 3. Structured subject, source, and occurrence identity

The MVP Review subject is stored structurally as:

```text
subject_type = COMPETENCY_DIMENSION
competency_ref = competency:<slug>
dimension = KNOWLEDGE | RECALL | APPLICATION | INTERVIEW_EXECUTION
subject_ref = <competency_ref>/<lowercase-dimension>
```

Code and constraints use the structured columns; parsing `subject_ref` is never the authority.

Each logical reason source has a stable UUID and a unique `(workspace, subject, reason_type)` key in
this slice. Its current occurrence has a stable `occurrence_id` derived from the supporting evidence
or created by the personal-reminder command. Reschedule and skip affect only that occurrence. A new
qualifying occurrence resets those temporary changes. Suppression is a source-level flag and
therefore survives later evidence until an explicit restore.

Evidence-driven state is:

- objective dimension `NOT_STARTED`: both evidence-driven reasons inactive;
- `COMPLETED`: `RETENTION_RISK` and `VERIFICATION_NEEDED` active;
- `VERIFIED` or `MASTERED`: `RETENTION_RISK` active and `VERIFICATION_NEEDED` inactive.

The anchor is the latest active supporting evidence occurrence selected by Mastery for that
dimension, not the event payload or worker clock. Initial due time is three days after that anchor under
`review-policy/0.1`. Failure-only, passive non-qualifying, completion-only, start, stop, and raw
provider events cannot create a Review reason.

## 4. Persistence

All tables carry `workspace_id`, use `FORCE ROW LEVEL SECURITY`, and have positive and negative
tenant tests.

- `review.subject_ledgers`: structural subject identity, safe last activity/readiness-goal references
  for Focus navigation, monotonic input watermark, and latest Mastery pointer.
- `review.reason_source_events`: immutable complete revisions from Mastery signals and personal
  reminder commands, including base due instant, source-active state, occurrence, and provenance.
- `review.action_events`: immutable user action audit with selected reason source and occurrence,
  old/new local intent, actor, and action type.
- `review.item_snapshots`: immutable `review-engine/0.1.0` / `review-policy/0.1` outputs keyed by
  subject watermark and projection generation.
- `review.items` and `review.item_reasons`: rebuildable typed current projection and current snapshot
  pointer. Timing remains query-time state rather than a persisted status.

Updates and deletes are rejected for source events, actions, and snapshots. Only Review-owned
commands append source/actions; only the fenced worker replaces the typed current projection.

The pure fold applies reschedule and skip only when an action occurrence matches the current source
occurrence. Suppress remains effective across later source occurrences until a later restore.
Database current rows are never the authority for these semantics; replaying immutable source and
action events rebuilds them.

## 5. Workspace time and day semantics

Identity adds an owned IANA `time_zone` preference to the personal workspace. Existing and newly
bootstrapped workspaces begin at `UTC`; a later Settings outcome may change it through an Identity
command. Review never infers a zone from an untrusted browser value.

User-selected local date/time is converted exactly once at the Review command boundary with the
workspace IANA zone, then stored as UTC. Skip once moves the current occurrence by one local calendar
day from the later of its current due time and the command time, so an overdue skip becomes useful
and DST days may correctly be 23 or 25 hours. Restore retains the source's effective due instant and
can intentionally make it overdue.

Queue membership is evaluated at query time; there is no midnight mutation:

1. `SUPPRESSED`: no active reason and at least one suppressed reason;
2. `OVERDUE`: earliest active due instant is before query `asOf`;
3. `DUE_TODAY`: earliest active due instant is before the next workspace-local midnight;
4. `PERSONAL_REMINDER`: a future reminder-only item;
5. `UPCOMING`: every other future item.

Each item appears in exactly one section and still displays every reason. A merged personal reminder
is shown as a reason on its single timing card, never as a duplicate item.

## 6. Commands and contracts

Public authenticated contracts are purpose-specific:

- `get_review_workspace_v1(asOf?)` returns a bounded `ReviewWorkspaceV1` DTO;
- `create_personal_review_reminder_v1` creates the one personal reminder source;
- `reschedule_review_reason_v1` changes one selected reason occurrence;
- `skip_review_reason_once_v1` postpones one selected occurrence once;
- `suppress_review_reason_v1` disables one source until restore;
- `restore_review_reason_v1` restores one suppressed source.

Every mutation derives the personal workspace and actor from the authenticated session, accepts a
UUID idempotency key, checks expected subject and reason revisions, rejects changed-hash replay, and
commits receipt, action/reason state, event, and delivery atomically. Client-visible reason IDs are
opaque UUIDs; internal source keys, raw evidence, notes, provider payloads, and workspace IDs are not
returned.

`ReviewWorkspaceV1` is capped at 100 items and returns stable order, workspace time zone, calculation
status/watermarks, safe subject/activity labels, optional Focus href inputs, effective due time,
bucket, and all current reasons. The DTO decoder rejects invalid identities, timestamps, duplicate
items/reasons, inconsistent buckets, and cross-field relationship errors.

Versioned Review events contain only subject identity, current subject version, effective due time
when active, active reason types, and projection status. They never contain evidence bodies,
supporting-evidence collections, notes, URLs, arbitrary consumer names, or user-supplied HTML.

## 7. Delivery, retry, and recovery

`review.item_projection_v1` follows ADR-0003 exactly: claim at most five, 120-second random
leases, 20-second per-handler timeout, bounded concurrency, permanent contract dead-letter,
transient retry up to eight attempts, capped exponential backoff with jitter, receipts, lease and
watermark fencing, and exhausted-lease cleanup.

The state-changing request may attempt one bounded dispatch after commit. A separate secret-authenticated
internal route and Supabase Cron wake the fixed Review dispatcher once per minute. Pending rows, not
HTTP or Cron, remain the durable queue. Health output exposes only aggregate counts, lag bands, and
safe failure codes.

## 8. UI and accessibility

`/review` is an authenticated, responsive server-rendered surface with a small client action island.
It provides Overdue, Due today, Upcoming, Personal reminders, and Suppressed/excluded sections,
all-reasons explanations, pending/stale state, and honest empty/error states. A reason disclosure
contains reschedule, skip once, suppress, or restore without changing sibling reasons.

Focus navigation uses the stored accepted activity/goal references and is unavailable with an
actionable Explore link when no valid reference exists. Controls remain keyboard operable, at least
44 px, usable at 320 px, visible in forced colors, and motion-free by default. Automated axe,
responsive, reduced-motion, and forced-colors checks accompany the flow.

## 9. Verification and release safety

Required evidence includes:

- domain/property tests for source adaptation, occurrence isolation, suppression persistence,
  merge/dedupe, exact replay, and order invariance;
- versioned valid, invalid, boundary, and malicious Review event/DTO fixtures;
- pgTAP for schema ownership, grants, FORCE RLS, two-workspace isolation, immutability, command
  replay/hash/version checks, action sibling preservation, atomic rollback, lease recovery,
  watermark fencing, event replay, dead letters, and stable non-duplicating query order;
- database-backed authenticated evidence-to-Review journey;
- Review UI component and E2E accessibility/responsive tests;
- repository verification, database, backup/restore, auth journey, secret scan, refreshed Graphify,
  and green CI before handoff.

The migrations are additive. Rollback of application code leaves durable Review deliveries and
authoritative Evidence untouched. A corrected worker can replay pending/dead-letter deliveries; a
later scheduler policy writes a new projection generation instead of rewriting history.
