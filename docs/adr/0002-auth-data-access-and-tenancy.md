# ADR-0002 — Authentication, data access, and tenancy

Status: Accepted  
Date: 2026-08-25  
Owner: PANDO product owner

## Context

PANDO stores personal goals, notes, evidence, imported profiles, and competency overlays. Even with one current user, tenancy must be structurally testable before data accumulates. State-changing commands often need several writes plus an outbox event in one transaction.

## Decision

- Use Supabase Auth with email and password. Disable public signup and anonymous sign-in for the personal MVP; provision the owner account explicitly.
- Store workspace membership and role in identity tables. Do not rely on mutable membership claims embedded in a long-lived JWT.
- Create one personal workspace for the owner through an idempotent bootstrap command.
- Expose only an api schema through the Data API. Module tables live in private schemas.
- Browser code uses Supabase directly only for authentication. Domain reads and writes pass through Next.js server actions or route handlers.
- Server handlers validate the authenticated user and input, then call purpose-specific Postgres RPC functions using a user-scoped Supabase client. The same RPC remains secure when called directly.
- Do not use an ORM in Phase 0. Versioned Supabase SQL migrations are the single schema source. Generate TypeScript database types from the schema.
- Enable RLS on every workspace-owned table and add explicit USING and WITH CHECK membership policies. Add FORCE ROW LEVEL SECURITY to critical tables.
- Revoke default grants. Prefer SECURITY INVOKER. A SECURITY DEFINER helper requires a narrow purpose, empty search path, fully qualified names, minimal owner privileges, and a dedicated test.
- Secret or service-role credentials are restricted to migration, backup, and narrow internal worker/storage adapters. They are never used for ordinary user commands.

## Alternatives considered

- Direct browser writes to tables: rejected because multi-table invariants and state-plus-outbox atomicity would be fragmented.
- Service-role server handlers for user commands: rejected because they bypass RLS and widen the blast radius.
- Direct serverless Postgres connections plus an ORM: rejected because pooler behavior, user context, and a second schema model add complexity without current value.
- JWT-only workspace roles: rejected because revocation would wait for token refresh.

## Consequences

- Business commands require deliberate SQL RPC contracts and matching TypeScript schemas.
- Database constraints and RLS remain effective even if an HTTP handler is bypassed.
- Reads may use narrow security-invoker views or functions, but authoritative tables are never a public generic CRUD surface.

## Security and privacy

Mandatory tests use at least two users and two workspaces:

1. owner can access own workspace;
2. another user cannot read, write, infer, or pass the owner's workspace identifier;
3. anon and expired sessions are rejected;
4. every workspace table has the expected RLS state and grants;
5. service credentials cannot enter a user-facing module.

Imported profiles and competencies remain workspace-scoped. Canonical promotion is a separate curator path.

## Migration and rollback

Supabase Auth is the main provider lock-in. Keep application identity keyed by an internal user profile that references the external auth subject. A later auth provider can be introduced by mapping a new subject to the same internal identity. SQL schemas, RLS policies, and dumps remain standard Postgres.
