# Phase 2 Mastery projection worker runbook

## Purpose and safety boundary

Evidence commands durably enqueue only the fixed `mastery.evidence_projection_v1` delivery.
Immediate dispatch improves the UI response; a once-per-minute Supabase Cron wake-up provides
recovery. Neither path accepts a workspace, event body, consumer name, SQL text, or calculated state
from the HTTP caller.

Do not repair projection state with direct table edits. Preserve evidence, delivery, receipt, and
snapshot history. A pending projection is honest and recoverable; a fabricated current state is not.

## One-time hosted activation

Do this only after the production Vercel URL exists and the same random dispatch secret is already
stored as the server-only `PANDO_INTERNAL_DISPATCH_SECRET` Vercel environment variable.

1. Open the Supabase Dashboard for the production project.
2. Open **SQL Editor** and run the following, replacing both placeholders. Do not commit or paste
   the real values into issues, chat logs, screenshots, or shell history.

```sql
select vault.create_secret(
  'https://YOUR-VERCEL-HOSTNAME',
  'pando_app_base_url',
  'PANDO production application origin'
);
select vault.create_secret(
  'PASTE-THE-SAME-32+-CHARACTER-DISPATCH-SECRET',
  'pando_internal_dispatch_secret',
  'PANDO fixed Mastery recovery authorization'
);
select outbox.configure_mastery_projection_recovery_impl();
```

3. In **Integrations → Cron**, confirm exactly one enabled job named
   `pando-mastery-projection-recovery-v1` with schedule `* * * * *`.
4. Invoke the job once. A successful HTTP response is `200` and contains only aggregate counts:
   `configured`, `claimed`, `completed`, and `retried`.

The activation function fails closed when a Vault value is absent, duplicated, non-HTTPS, has a
trailing slash, or the dispatch secret is shorter than 32 characters. The migration never creates a
job with placeholder credentials.

## Diagnosis

Run read-only queries in the Supabase SQL Editor as the project administrator:

```sql
select delivery_state, count(*)
from outbox.deliveries
where consumer_name = 'mastery.evidence_projection_v1'
group by delivery_state
order by delivery_state;

select delivery_id, attempt_count, available_at, lease_expires_at,
       last_failure_class, last_error_code, last_failed_at, dead_lettered_at
from outbox.deliveries
where consumer_name = 'mastery.evidence_projection_v1'
  and delivery_state in ('pending', 'retry', 'leased', 'dead_letter')
order by available_at, delivery_id
limit 50;
```

- `pending` for less than one minute can be normal.
- `retry` means the durable backoff policy is active.
- an expired `leased` row is reclaimed by the next claim, except an exhausted eighth lease, which
  is moved to `dead_letter`.
- `INVALID_CONTRACT` is permanent and must be fixed by a reviewed producer/consumer migration.
- `HANDLER_TIMEOUT` and `DISPATCH_FAILED` are transient. Check Vercel function logs and Supabase
  availability without logging request authorization or evidence bodies.

## Safe wake-up and recovery

After correcting a transient platform/configuration problem, invoke the existing Cron job or run:

```sql
select outbox.invoke_mastery_projection_recovery_impl();
```

This is a wake-up, not a replay or direct mutation. It claims only due fixed-consumer deliveries.
Never set `delivery_state`, lease fields, current pointers, or snapshots manually.

Manual dead-letter replay is intentionally not exposed in Phase 2 because ADR-0003 requires an
audited reason and a new projection generation. Add that purpose-specific command before replay is
needed.

## Rollback

Application rollback leaves immutable evidence, outbox rows, snapshots, and receipts intact. If a
worker release is faulty, disable the Cron job in the Supabase Dashboard, roll the application
forward to a corrected worker, then re-enable and invoke the job. Pending rows are not lost while
the job is disabled.
