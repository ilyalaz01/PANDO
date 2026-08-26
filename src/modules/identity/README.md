# Identity & Workspace

Owns users, workspaces, memberships, roles, and preferences.

## Implemented boundary

- Supabase Auth supplies the external subject. Server code verifies it with `getClaims()` on a
  request-scoped publishable-key client; JWT metadata is never treated as workspace authority.
- `api.bootstrap_personal_workspace` is the idempotent owner command for first-use setup. It derives
  the user from the authenticated subject and atomically persists user, personal workspace,
  membership, command receipt, and outbox events.
- `identity.get_current_personal_workspace_impl()` is the owner query used by authenticated
  application composers. It selects the subject's creator-owned personal workspace even when the
  user has several memberships and re-checks its current database membership on every read.
  Revocation is denied immediately rather than being represented as first use or waiting for a
  token refresh.
- Public sign-up and anonymous sign-in remain disabled. A maintainer provisions the initial owner
  using the [owner provisioning runbook](../../../docs/runbooks/auth/owner-provisioning.md).

The browser never writes Identity tables or chooses workspace identifiers. Live state changes use
the owning command boundary; repository files and exported data are not control surfaces.
