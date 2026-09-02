# Phase 4B activity-admission owner-boundary hardening status

Status: complete

Recorded follow-up:
[D2b1 Learning Track lifecycle design](../design/PHASE_4B_D2B1_LEARNING_TRACK_LIFECYCLE.md#8-resolved-adjacent-security-follow-up)

Completed: 2026-09-01

## Delivered outcome

The public `api.add_learning_track_activity_v1` contract is unchanged: the exact name, argument
names and types, optional energy default, JSON result, validation errors, idempotency behavior,
authoritative mutation, event, and Planning delivery retain their released meanings. The
unsupported private execution surface is removed.

The public wrapper is now a pinned `SECURITY DEFINER` owned by the `pando_planning_api` NOLOGIN role
with an empty search path and fully qualified implementation call. Only `authenticated` can execute
the public RPC. `planning.add_learning_track_activity_impl_v1` is no longer executable by `PUBLIC`,
`anon`, `authenticated`, or `service_role`; the owner retains the narrow internal call path.

## Migration and compatibility

- One forward-only migration changes only the existing wrapper's security mode and exact function
  ACLs. It does not replace the body or change tables, RLS, function arguments, result shapes,
  events, deliveries, or command receipt semantics.
- The migration temporarily grants the function owner `USAGE` on the exposed `api` schema only so
  PostgreSQL can resolve the owner-operated `ALTER FUNCTION`, then revokes that privilege before
  completion. No permanent role capability is broadened.
- PostgREST continues to expose the same six-argument RPC. Generated TypeScript database types do
  not change, and all application, worker, and authenticated browser callers continue to use the
  public name.
- No ADR is required: the change implements the existing ADR-0002 least-privilege rule and D0 owner
  boundary without changing product behavior or a released contract.

## Verification evidence

The final Windows gates passed from disposable stacks after the migration:

- `pnpm verify`: PASS — formatting, lint, typecheck, database-runner and backup-archive tests, 329
  contract tests, 3 performance tests, 789 unit/coverage tests, production build, and 29/29 Chromium
  E2E tests. Coverage remained 87.73% statements and 80.53% branches.
- `pnpm verify:db`: PASS — all migrations applied from zero; 31 explicit pgTAP files and 2,182
  assertions passed; warning-level database lint reported no findings.
- `pnpm verify:auth`: PASS — the real authenticated journey admitted the activity through the
  unchanged PostgREST RPC, then completed the existing Planning, Today/Focus, overlay, reload,
  refresh, accessibility, and sign-out path.
- `pnpm verify:backup`: PASS — the encrypted archive completed a clean restore with the new function
  metadata and ACL migration included.

The database proof includes the exact `PUBLIC`/`anon`/`authenticated`/`service_role` privilege
matrix, owner/security-mode/search-path metadata, a real denied private-helper call under
`authenticated`, the existing public success and same-key replay, cross-workspace refusal,
concurrency, rollback injection, event, and delivery invariants.

No dependency, lockfile, JSON Schema, event contract, generated type, Planning policy, or engine
version changed.

## Next bounded outcome

Continue D2b with a separate Learning Track priority/protected-minimum edit design. It must settle
the exact preview, aggregate fences, priority ordering effects, and protected-capacity invariant
before implementation. Subsequent work completed Track creation and terminal lifecycle; cadence
remains the later D2 increment.
