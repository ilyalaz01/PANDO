# ADR-0003 — Transactional commands, outbox, and background work

Status: Accepted  
Date: 2026-08-25  
Owner: PANDO product owner

## Context

Canonical state changes must atomically publish versioned facts for downstream mastery, readiness, review, and planning projections. The current load does not justify Redis, SQS, or a separate queue, and the hosting runtime is serverless.

## Decision

### Command boundary

Every retriable mutation has a command identifier, command type and schema version, workspace, idempotency key, request hash, correlation identifier, optional causation identifier, optional expected aggregate version, and validated payload.

A purpose-specific Postgres RPC performs, in one transaction:

1. authenticated membership check;
2. command receipt insert or idempotent replay;
3. aggregate lock and expected-version check when required;
4. invariant enforcement and authoritative mutation;
5. outbox event plus consumer delivery inserts;
6. stored response and emitted event identifiers.

Reusing an idempotency key with a different request hash fails. A retry with the same hash returns the stored response.

### Event envelope

The version 1 envelope contains:

- event_id UUID;
- event_position BIGINT identity used as an observation cursor;
- event_name and event_schema_version;
- workspace_id;
- aggregate_type, aggregate_id, and aggregate_version where applicable;
- actor_type and optional actor_user_id;
- command_id, correlation_id, and optional causation_id;
- occurred_at and recorded_at timestamps;
- source;
- minimal JSON payload and metadata.

Global commit order is not inferred from the identity value. Per-aggregate order uses aggregate_version. Corrections and late observations are new events; consumers that are order-sensitive reload authoritative inputs.

### Delivery

Use immutable outbox events and explicit per-consumer delivery rows. Enqueue deliveries from the command function, not from a hidden cross-module trigger.

The dispatcher:

- claims at most 5 due deliveries with FOR UPDATE SKIP LOCKED;
- commits a random lease token and 120-second expiry before running handlers;
- gives each handler at most 20 seconds;
- completes through one RPC that checks the lease, expected input watermark, and unique consumer receipt;
- retries transient failures up to 8 attempts;
- uses capped exponential backoff with jitter, starting at 5 seconds and capped at 15 minutes;
- sends permanent contract failures and exhausted retries to dead letter state;
- requires an audited reason for manual replay.

Unique consumer receipt: event_id, consumer_name, handler_contract_version.

### Wake-up

- A command request may attempt one bounded dispatch after commit for responsive UX.
- Supabase Cron calls a secret-authenticated internal Next.js route once per minute as the recovery wake-up.
- The wake-up is not the queue. Pending delivery rows remain durable if Cron or HTTP fails.
- UI can display calculation pending until the projection watermark catches up.

No Redis, pgmq, pg-boss, SQS, or separate worker deployment is used in Phase 0.

## Alternatives considered

- Direct synchronous cross-module calls: rejected because a downstream failure would lengthen or couple the command transaction.
- LISTEN/NOTIFY: rejected because it is not durable.
- Database webhooks: rejected because retry, replay, idempotency, and dead-letter behavior are less explicit.
- Supabase Queues or an external broker: valid later, but currently duplicate capability without measured load.
- Persistent in-process worker: simpler operationally, but requires paid always-on hosting now.

## Consequences

- Normal recovery latency can approach one minute when the immediate attempt does not run.
- Handlers must be small, idempotent, and resumable.
- A numeric checkpoint is observability, not the only selector of work. Receipts and delivery state are authoritative.
- Replay builds a new projection generation, captures a high-water boundary, catches up later events, verifies gaps, and atomically switches the active generation.

## Security and privacy

- The internal route uses a dedicated random secret stored in Supabase Vault and Vercel environment configuration.
- The worker surface accepts no arbitrary SQL, event body, consumer name, or workspace from the caller.
- Event payloads contain identifiers and necessary facts only; no uploaded files, free-form notes, tokens, or secrets.
- Service-role access is isolated to the internal adapter and covered by tests.

## Migration and rollback

Add pgmq or a persistent Node worker only after measured backlog, concurrency, or handler duration exceeds the budgets. The outbox and consumer contracts remain the source, so a new transport can claim the same delivery rows or receive mirrored deliveries. A failed worker release can roll back independently because events are immutable and handler versions are explicit.
