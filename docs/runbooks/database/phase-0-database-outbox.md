# Phase 0 database and outbox runbook

## Scope

This slice establishes only the database execution boundary required by Phase 0:

- private bounded-context schemas and the exposed `api` schema;
- Supabase Auth subject mapping, personal workspace bootstrap, and membership;
- command receipts, immutable versioned outbox events, deliveries, consumer receipts, and the fixed probe projection effect;
- fixed worker RPCs for the `phase0.identity_workspace_bootstrap_probe` contract;
- grants, forced RLS, idempotency, lease fencing, bounded retry, and dead letter behavior.

It does not add Catalog, Evidence, Planning, or other domain feature tables. Full replay tooling, monitoring, and production consumers remain Phase 6 work.

## Rebuild and verify

From the repository root, with Docker running and a compatible Supabase CLI available:

```text
supabase start
supabase db reset --local
supabase test db --local
supabase db lint --local --level warning
```

`db reset` must rebuild from the timestamped files under `supabase/migrations/`; do not patch a local database manually. The seed file is intentionally empty. pgTAP fixtures use only synthetic `.test` identities and are rolled back.

The tests cover:

- grants plus enabled and forced RLS on every Phase 0 user/workspace table;
- two auth users in two personal workspaces, positive own access, cross-workspace denial, and live membership revocation;
- anon and missing-subject denial;
- same-request replay, changed-request conflict, and database-computed request hashes;
- rollback when event insertion fails after the identity writes;
- delivery uniqueness, five-row claim bounds, 120-second leases, stale-token fencing, lease reclaim, duplicate completion, retry, and dead letter transitions;
- rollback after a probe effect is inserted but before its receipt, followed by lease reclaim and exactly one final effect.

JWT expiry is enforced before SQL by the Auth/PostgREST boundary. pgTAP verifies anon and missing-subject database behavior; a real expired-token HTTP scenario belongs in the server integration suite once that boundary exists.

## Command and event invariants

`api.bootstrap_personal_workspace` derives the actor from the validated PostgREST JWT subject (the same request setting used by `auth.uid()`) and accepts no actor, workspace, role, command UUID, correlation UUID, or request hash from the caller. It normalizes and validates typed input, computes SHA-256 inside Postgres, and atomically persists identity state, the completed receipt, the version 1 event, and its delivery on the first bootstrap. An identical retry returns the stored response. A new key with the same name records a completed no-op receipt for the existing personal workspace without another event; a new key cannot silently rename that workspace. Reusing one key with changed input fails without changing state.

`outbox.events.event_position` is an observation cursor, not global commit order. Aggregate ordering uses `aggregate_version`. Event payloads contain only the minimum identifiers and facts needed by the contract.

The worker surface has a fixed consumer name and handler contract version. Callers cannot select a workspace, event body, or consumer. A claim returns at most five due rows and gives each a random 120-second lease. Completion requires the current lease token and exact input event position. Eight total claims are the Phase 0 attempt limit; a permanent failure or exhausted lease moves the delivery to `dead_letter`.

The fixed probe is the executable proof for delivery idempotency. Its durable effect is an immutable row in `outbox.phase0_probe_effects`, keyed uniquely by `(event_id, consumer_name, handler_contract_version)`. The purpose-specific completion RPC validates the exact version 1 workspace-bootstrap contract, inserts that effect, inserts the consumer receipt, and marks the delivery succeeded in one transaction. A failure in any later step rolls back the effect; timeout recovery can then reclaim the same delivery with a new fencing token. Duplicate completion after success returns `false` and creates no second effect.

Production consumers remain purpose-specific. They must commit their authoritative effect plus receipt/completion atomically, or prove an equivalent idempotency invariant for a genuinely external side effect. The probe table is not a generic handler registry or caller-selectable execution surface.

## Command-principal prerequisite

The current Agent Control Plane executes user-directed changes as the verified OAuth user. The Phase 0 `outbox.command_receipts.actor_user_id NOT NULL` model is therefore sufficient for the currently authorized user command surface.

Before the first command originated by a scheduler, provider, or other system/integration principal, stop implementation and add a forward SQL migration for an explicit command-principal model. It must distinguish user, system, and integration actors, preserve an optional initiating user separately, and define a collision-safe idempotency scope for commands without a user. Do not attribute those commands to a fake Identity user. Update ADR-0003, authorization tests, event provenance tests, and this runbook in the same change.

## Security checks

- Only `api` is listed in `supabase/config.toml` as a PANDO Data API schema.
- `anon` has no API schema usage or RPC execution.
- `authenticated` has only the two exposed user RPC contracts and no table DML.
- `service_role` has only the three exposed worker RPC contracts and no direct private-table DML.
- Exposed RPCs are `SECURITY INVOKER`; narrow implementations are private, have an empty `search_path`, and are owned by dedicated `NOLOGIN` roles.
- `pando_rls_authorizer` is the single `BYPASSRLS` exception. It is `NOLOGIN`/`NOINHERIT`, has read access only to Identity authorization tables, and owns only the narrow subject/membership helpers.

Do not add a private schema to the Data API list, grant browser roles table access, place a privileged implementation in `api`, or use a service credential for an ordinary user command.

## Failure diagnosis

| Symptom | Check | Safe action |
|---|---|---|
| Bootstrap returns `an authenticated user is required` | The request has no valid Auth subject | Re-authenticate; do not accept an actor ID from request data |
| Bootstrap returns idempotency conflict | The same key was reused with different normalized input | Generate a new key for a genuinely new request |
| Workspace query returns `workspace is not accessible` | Live membership is absent or the ID belongs to another tenant | Restore membership only through an authorized Identity command |
| Delivery remains `leased` | Compare lease expiry and attempt count | Let the dispatcher reclaim it after expiry; do not overwrite the token |
| Delivery is `dead_letter` | Inspect bounded failure class/code and original immutable event | Diagnose the consumer contract; Phase 0 has no manual replay RPC |
| Local verification cannot connect | Docker daemon and Supabase local stack status | Start Docker, then rerun the four rebuild/verify commands above |

## Roll-forward

Migrations are immutable after sharing. Correct a defect with a new timestamped migration and rerun the full reset plus pgTAP suite. Do not delete or edit persisted event/receipt history. This slice has no down migration; a development reset recreates an empty local database, while a deployed correction must roll forward.


## Encrypted backup restore

The destructive clean-restore rehearsal runs only in a randomly named temporary local stack. Follow [the Phase 0 encrypted backup runbook](../backup/phase-0-encrypted-backup-restore.md); migrations remain the schema source, and plaintext dumps must stay in private temporary storage.
