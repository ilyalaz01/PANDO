# Phase 3B Target Readiness projection worker runbook

## Purpose and safety boundary

Goal and Mastery commands durably enqueue only the fixed `targets.readiness_projection_v1`
delivery. Immediate dispatch improves feedback; a once-per-minute Supabase Cron wake-up provides
recovery. Neither path accepts a workspace, event body, consumer name, SQL text, or calculated
readiness from the HTTP caller.

Do not repair readiness through direct table, pointer, delivery, fixture, export, or repository-file
edits. Preserve evidence and immutable calculation history.

## One-time hosted activation

First configure the same server-only `PANDO_INTERNAL_DISPATCH_SECRET` and Vault values
`pando_app_base_url` and `pando_internal_dispatch_secret` used by the Mastery/Review workers. Follow
the [Mastery worker runbook](phase-2-mastery-projection.md) if they do not exist. Do not create
duplicate Vault secrets.

Then open the production Supabase **SQL Editor** and run:

```sql
select outbox.configure_target_readiness_projection_recovery_impl();
```

In **Integrations → Cron**, confirm exactly one enabled job named
`pando-target-readiness-projection-recovery-v1` with schedule `* * * * *`. Invoke it once. A
successful HTTP response is `200` and contains only `configured`, `claimed`, `completed`, and
`retried` counts. Activation fails closed for missing, duplicated, malformed, or short secrets.

## Diagnosis

Use read-only administrator queries:

```sql
select delivery_state, count(*)
from outbox.deliveries
where consumer_name = 'targets.readiness_projection_v1'
group by delivery_state
order by delivery_state;

select delivery_id, attempt_count, available_at, lease_expires_at,
       last_failure_class, last_error_code, last_failed_at, dead_lettered_at
from outbox.deliveries
where consumer_name = 'targets.readiness_projection_v1'
  and delivery_state in ('pending', 'retry', 'leased', 'dead_letter')
order by available_at, delivery_id
limit 50;
```

- `pending` for less than one minute can be normal; future scheduled refreshes remain pending until
  their exact freshness boundary.
- `retry` is durable backoff; `STALE_READINESS_INPUT` means authoritative input changed during work.
- an expired lease is reclaimed; the eighth exhausted lease becomes `dead_letter`.
- `READINESS_SOURCE_CAPACITY_EXCEEDED` means the workspace has crossed the current 10,000
  effective-observation-per-competency or 50,000-per-wake MVP calculation envelope. Preserve the
  ledger and add a reviewed Mastery sufficient-statistics/continuation migration; never delete
  Evidence to make the worker pass.
- contract/fingerprint/provenance failures are permanent and require a reviewed producer/consumer
  correction, never direct state repair.

## Safe wake-up and rollback

After correcting a transient platform/configuration issue, invoke the existing Cron job or run:

```sql
select outbox.invoke_target_readiness_projection_recovery_impl();
```

This is a wake-up, not replay. Manual dead-letter replay remains unavailable until an audited
reason and new projection-generation command exist. To roll back a faulty worker, disable only its
Cron job, roll the application forward to a corrected worker, then re-enable and invoke it. Goals,
Evidence, Mastery, snapshots, receipts, and pending deliveries remain intact.
