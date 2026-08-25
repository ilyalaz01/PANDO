# PANDO

PANDO is **source-available**, not OSI-approved open-source software. Noncommercial use is governed
by the [PolyForm Noncommercial License 1.0.0](LICENSE) and the required attribution in
[NOTICE](NOTICE). This public license does not grant commercial rights; see
[COMMERCIAL.md](COMMERCIAL.md) for non-binding information about requesting a separate agreement.
PANDO is currently at the Phase 0 foundation stage. This repository contains an executable
Next.js modular-monolith shell and its quality harness; product features, persistence, and
domain calculations are intentionally not implemented in this change.

## Prerequisites

- Node.js `24.19.0` (pinned in `.node-version` and `.nvmrc`)
- pnpm `11.19.0` (pinned in `package.json`)

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

Open <http://localhost:3000>.

## Verify locally

One command runs the complete local gate:

```shell
pnpm verify
```

The gate checks formatting, lint rules and module-boundary guards, strict TypeScript, unit tests
and coverage, the production build, and Chromium end-to-end/accessibility tests. CI runs the same
command from a frozen lockfile and scans the committed Git history for secrets.

## Repository shape

```text
src/
  app/        Next.js App Router shell
  modules/    bounded-context ownership boundaries
  shared/     small, stable cross-cutting code
  ui/         repository-owned design system and UI projections
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

The only production dependencies are Next.js, React, and React DOM. Tailwind CSS and the lint,
format, type, unit, accessibility, and E2E tools are development-only dependencies required by
ADR-0001 and this executable foundation. There is no ORM, monorepo tooling, global state library,
or runtime provider SDK. `pnpm-workspace.yaml` is pnpm 11's required project-settings file; because
it declares no `packages`, the repository remains a single package.

## Licensing and contributions

- Read [LICENSE](LICENSE) and [NOTICE](NOTICE) before using or redistributing PANDO.
- [COMMERCIAL.md](COMMERCIAL.md) is informational only and grants no commercial rights.
- External contributions are closed until the project has a contributor license agreement that
  supports both public and commercial licensing; see [CONTRIBUTING.md](CONTRIBUTING.md).

The repository's licensing documents are not legal advice. A qualified lawyer and tax adviser must
review any commercial agreement for the relevant parties and jurisdictions.
