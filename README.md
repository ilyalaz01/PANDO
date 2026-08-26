# PANDO

PANDO is **source-available**, not OSI-approved open-source software. Noncommercial use is governed
by the [PolyForm Noncommercial License 1.0.0](LICENSE) and the required attribution in
[NOTICE](NOTICE). This public license does not grant commercial rights; see
[COMMERCIAL.md](COMMERCIAL.md) for non-binding information about requesting a separate agreement.
PANDO has completed its Phase 0 technical foundation and is entering Phase 1. The repository
contains the executable Next.js modular monolith, strict contract/runtime validators, deterministic
mastery/readiness/review engines, the Identity/RLS/outbox database boundary, an encrypted
clean-restore proof, and an accessible Explore Map/Outline vertical slice. It also contains
invite-only Supabase email/password sign-in, idempotent personal-workspace onboarding, and
persisted Target Profile selection into an exact Readiness Goal. `/explore` now loads the selected
goal's authorized live structure through a zero-workspace server boundary and renders the bounded
target closure without inventing Mastery or readiness values. The representative 25-node graph is
retained only by the explicitly enabled test harness. Authenticated Mastery/readiness projections
and the remaining product command/persistence paths are not yet implemented.

## Prerequisites

- Node.js `24.19.0` (pinned in `.node-version` and `.nvmrc`)
- pnpm `11.19.0` (pinned in `package.json`)
- Docker Desktop or Docker Engine for the complete database and backup/restore gates

Enable Corepack if pnpm is not already available, then install the locked dependencies and the
test browser:

```shell
corepack enable
pnpm install --frozen-lockfile
pnpm test:e2e:install
```

## Run locally

One command starts the development application:

```shell
pnpm dev
```

Open <http://localhost:3000>, sign in, select or reuse a Readiness Goal on `/start`, then follow
`Explore this target`. The live `/explore?goal=...` route requires the configured authenticated
Supabase boundary; it never substitutes demo data after a failed or unauthorized read.

To use the authenticated `/start` journey, configure the two public Supabase values from
[`.env.example`](.env.example) in an untracked `.env.local` and provision the invite-only owner by
following the [owner provisioning runbook](docs/runbooks/auth/owner-provisioning.md). Never use a
secret or service-role key in a `NEXT_PUBLIC_` variable.

## Verify locally

The ordinary application gate does not require Docker:

```shell
pnpm verify
```

The gate checks formatting, lint rules and module-boundary guards, strict TypeScript, contract and
unit tests, coverage, representative graph payload/layout budgets, the production build, and
Chromium end-to-end/accessibility and graph-interaction budgets.

The complete Phase 0 aggregate also proves migrations, every database pgTAP file, database lint,
and encrypted clean restore in separate randomly named local Supabase stacks:

```shell
pnpm verify:phase0
```

Use `pnpm verify:db`, `pnpm verify:backup`, or `pnpm verify:auth` for an individual Docker-backed
gate. These commands copy the required Supabase files to OS-created temporary directories and stop
only their own random project IDs, so they do not reset or remove an ordinary local development
stack. The auth gate creates one synthetic owner inside its disposable stack, exercises sign-in,
workspace bootstrap, target selection, reload, responsive accessibility, and sign-out through a
real browser, and checks that generated `api` schema types have not drifted. CI runs the four
expensive suites as separate jobs from the same frozen lockfile and combines their results in a
cheap `phase0` status; it does not rerun them in the aggregate job. Committed history is scanned for
secrets.

## Repository shape

```text
src/
  app/        Next.js App Router shell
  modules/    bounded-context ownership boundaries
  shared/     small, stable cross-cutting code
  ui/         repository-owned design system and UI projections, including Explore adapters
tests/
  e2e/        Playwright journeys and automated accessibility checks
  unit/       shared Vitest setup
```

Each bounded-context directory documents its owner. When implementation is added, code is split
by `domain`, `application`, and `infrastructure`; domain code remains pure and framework-free.
The [module topology](docs/design/MODULE_TOPOLOGY.md) maps every accepted context, derived
projection owner, command/query/event path, and task-oriented reading route. Cross-context
interaction is limited to owning commands, bounded queries, versioned events, and read-only
projection composition.

## Dependency policy

Production dependencies are Next.js, React, and React DOM; the request-scoped Supabase Auth/Data
API clients `@supabase/ssr` and `@supabase/supabase-js`; the contract-boundary libraries required by
ADR-0005 (Ajv Draft 2020-12, `ajv-formats`, and RFC 8785 JSON canonicalization); and the exact
ADR-0004 graph adapter pins `@xyflow/react@12.11.3` and `@dagrejs/dagre@3.1.1`. Tailwind CSS and the
lint, format, type, unit, accessibility, and E2E tools remain development-only. There is no ORM,
monorepo tooling, global state library, or privileged runtime provider SDK. `pnpm-workspace.yaml` is pnpm 11's
required project-settings file; because it declares no `packages`, the repository remains a single
package. `src/shared/supabase/database.generated.ts` is generated from the migrated exposed `api`
schema; the authenticated journey gate fails when the committed type surface drifts from the live
temporary database.

## Licensing and contributions

- Read [LICENSE](LICENSE) and [NOTICE](NOTICE) before using or redistributing PANDO.
- [COMMERCIAL.md](COMMERCIAL.md) is informational only and grants no commercial rights.
- External contributions are closed until the project has a contributor license agreement that
  supports both public and commercial licensing; see [CONTRIBUTING.md](CONTRIBUTING.md).

The repository's licensing documents are not legal advice. A qualified lawyer and tax adviser must
review any commercial agreement for the relevant parties and jurisdictions.
