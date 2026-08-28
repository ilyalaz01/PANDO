# Phase 4A Planning snapshot projection worker runbook

## Purpose and safety boundary

Planning commands and the accepted Targets, Mastery, Review, Overlay, Sessions Focus lifecycle, and
Evidence invalidation producers enqueue Planning's fixed `planning.plan_snapshot_v1` delivery
alongside any existing owner-specific deliveries. The producer calls a purpose-specific router in
the same transaction as its state and source event. The worker persists one bounded normalized
input before calculation, rechecks every owner fence, and atomically applies the immutable snapshot,
pointer, action selectors, receipts, exact delivery coverage, and the next scheduled refresh. The
HTTP and Cron paths are wake-ups, never the queue.

Direct source routing starts only after `planning.current_plan_snapshots` contains the workspace
sentinel. A source event created while no sentinel exists receives no immediate delivery; the
initializer wake-up loads the owners' current state. The explicit rollout repair may later enqueue
accepted history, including pre-plan events, once a sentinel exists. This is a conservative wake-up:
the worker always reloads current authoritative owner state rather than replaying old payload state.
`evidence.observation_appended` is not a Planning source event. Focus completion is the immediate
wake-up; subsequent Mastery and Targets projection events become convergence inputs after the
meaningful-work policy supports terminal session history.

Do not repair a plan through direct snapshot, pointer, attempt, selector, ledger, delivery, fixture,
export, Graphify, or repository-file edits. Old snapshots and attempt generations are audit history.

## Current supported envelope

The first live increment supports fresh Growth Plans with no terminal Focus sessions in the current
workspace-local week. Until a reviewed meaningful-duration/repetition policy is implemented,
`UNSUPPORTED_MEANINGFUL_WORK_HISTORY` is a deliberate permanent failure: preserve history and ship
the missing policy/query increment. Never substitute planned minutes or wall-clock elapsed time.

Campaign and same-session duration/energy preferences are currently explicit null inputs.
Prerequisite-bearing activities remain `UNKNOWN`; do not infer satisfaction from a Mastery level
without a versioned policy.

## One-time hosted activation

Use the same server-only `PANDO_INTERNAL_DISPATCH_SECRET` and Vault values
`pando_app_base_url` and `pando_internal_dispatch_secret` as the other projection workers. Follow
the [Mastery worker runbook](phase-2-mastery-projection.md) if they are absent. Do not create
duplicate Vault secrets.

In the production Supabase **SQL Editor**, run:

```sql
select outbox.backfill_plan_snapshot_source_deliveries_v1(0, 500);
```

Record `nextAfterEventPosition` and repeat with that value as the first argument until
`complete=true`. Every call processes at most 500 events, reports `processedCount` and
`quarantinedCount`, and can be replayed safely. Do not enable the Planning Cron until the repair
reports completion.

If a call fails with `Planning source backfill failed at event_position ... (event_id ...):`, retain
the last successful cursor and inspect that exact immutable event and its producer contract. First
deploy the reviewed producer/consumer correction so the malformed shape cannot recur. If the old
event still cannot satisfy the corrected contract, record the review decision through the only
supported terminal-history command, substituting the exact event ID, a specific printable reason,
and a durable ticket, commit, or incident reference:

```sql
select outbox.quarantine_invalid_plan_snapshot_source_event_v1(
  '<event-id>'::uuid,
  'Historical event is malformed because ...; forward producer is corrected.',
  'PANDO-INCIDENT-123',
  'planning-quarantine-<event-id>-v1'
);
```

The command is administrator-only, refuses valid or unsupported events, appends one immutable
quarantine audit row, stores its own versioned command receipt and request hash, and atomically emits
a `planning.source_event_quarantined` repair delivery. Use the same idempotency key only for an exact
retry of the same event, reason, and review reference; a changed request fails. The new command and
correlation IDs preserve the administrator action's provenance, while the repair event's
`causation_id` points to the malformed source event. That delivery makes Planning reload current
authoritative owner state; it never treats the malformed payload as input. A second command cannot
rewrite the audit record. Resume the backfill from the retained cursor. It advances past only the
reviewed quarantine, increments `quarantinedCount`, and creates no delivery for the malformed source
event itself. Never jump the cursor manually, and never edit or delete the source event, quarantine,
command receipt, repair event, or delivery to make progress.

Then run:

```sql
select outbox.configure_plan_snapshot_projection_recovery_impl();
```

In **Integrations → Cron**, confirm exactly one enabled job named
`pando-plan-snapshot-projection-recovery-v1` with schedule `* * * * *`. Invoke it once. A successful
HTTP response is `200` and contains only `configured`, `claimed`, `completed`, `retried`,
`deadLettered`, and `superseded` counts. Missing, duplicated, malformed, or short secrets fail
closed.

## Diagnosis

Use read-only administrator queries:

```sql
select delivery_state, count(*)
from outbox.deliveries
where consumer_name = 'planning.plan_snapshot_v1'
group by delivery_state
order by delivery_state;

select delivery_id, attempt_count, available_at, lease_expires_at,
       last_failure_class, last_error_code, last_failed_at, dead_lettered_at
from outbox.deliveries
where consumer_name = 'planning.plan_snapshot_v1'
  and delivery_state in ('pending', 'retry', 'leased', 'dead_letter')
order by available_at, delivery_id
limit 50;

select attempt_state, failure_class, error_code, count(*)
from planning.plan_snapshot_attempts
group by attempt_state, failure_class, error_code
order by attempt_state, failure_class, error_code;
```

- a future `pending` refresh is normal until its exact `validUntil + 1 millisecond` boundary;
- `STALE_PLANNING_INPUT` means an owner fence, pointer version, or validity clock changed during
  calculation; the preserved generation is superseded and a fresh generation retries. On the
  eighth attempt it instead dead-letters as `STALE_PLANNING_INPUT_AFTER_MAX_ATTEMPTS`;
- an obsolete scheduled refresh succeeds as `SUPERSEDED` and never moves the pointer;
- the eighth exhausted lease becomes `dead_letter`, and its active attempt becomes `FAILED` in the
  same transaction;
- `UNSUPPORTED_MEANINGFUL_WORK_HISTORY` requires the reviewed duration-policy increment described
  above, not data deletion or manual pointer movement;
- fingerprint, result, bound, or owner-contract failures require a reviewed producer/consumer fix.
- a missing direct source delivery after the workspace already had a Planning sentinel is a
  producer-transaction defect; do not manufacture it by editing `outbox.deliveries`. Correct the
  producer/router forward and use a reviewed, idempotent repair command.

## Safe wake-up and rollback

After correcting a transient platform/configuration problem, invoke the existing Cron job or run:

```sql
select outbox.invoke_plan_snapshot_projection_recovery_impl();
```

This is a wake-up, not replay. Manual dead-letter replay remains unavailable until an audited
reason and new attempt-generation command exist. To roll back a faulty application worker, disable
only this Cron job, roll the application forward to a corrected version, then re-enable and invoke
it. Plans, snapshots, attempts, selectors, receipts, ledgers, and pending deliveries remain intact.
