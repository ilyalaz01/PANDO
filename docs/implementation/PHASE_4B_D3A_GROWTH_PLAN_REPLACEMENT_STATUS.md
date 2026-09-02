# Phase 4B D3a — Growth Plan replacement implementation status

Status: complete; every gate reproducible in this environment passed

Design: [Growth Plan replacement](../design/PHASE_4B_D3A_GROWTH_PLAN_REPLACEMENT.md)

Decision record:
[ADR-0010](../adr/0010-lifecycle-replacement-availability-and-campaign-semantics.md) §1 and §9

Completed: 2026-09-02

## Delivered outcome

A signed-in person with a current Growth Plan can archive it and start a new one in a single atomic
command, through an exact preview and explicit confirmation. The archived Plan, its Learning Tracks,
Track activity attributions, Focus sessions, Evidence, Mastery, Reviews, and every immutable
PlanSnapshot are retained unchanged. Nothing is copied: the incoming Plan starts with one initial
Track derived from an explicitly chosen active Readiness Goal and no admitted activities.

An initialized workspace therefore always has exactly one current (`active | paused`) Growth Plan.
There is still no standalone archive command.

## Owner command, contracts, and boundary

- `GrowthPlanReplacementSourceV1`, `GrowthPlanReplacementPreviewV1`, and
  `GrowthPlanReplacementApplyResultV1` are additive; every released Plan and Track contract keeps
  its meaning.
- The source is actor-scoped with zero authority input. `REPLACEMENT_AVAILABLE` returns the current
  Plan title, lifecycle, capacity, aggregate version, bounded child-Track counts, the released
  20-goal bound, and the single capability `replace_growth_plan`. `NO_CURRENT_PLAN`,
  `NO_ACTIVE_GOALS`, and `GOAL_PORTFOLIO_OVERFLOW` expose no Plan detail at all.
- The browser submits only a goal key, both expected versions, whole capacity/session/priority
  values, a printable reason, a lowercase request UUID, and the server-issued digest. Workspace,
  Plan, Track, Goal, and profile identity are resolved on the server.
- Both incoming identifiers are derived from workspace, command type, idempotency key, and a fixed
  label, so a retry cannot create a second Plan and the derivation cannot collide with first setup.
- The clock-free digest binds the outgoing Plan identity, lifecycle, capacity, version before and
  after, the ordered child-Track fingerprint and counts, the resolved Goal and profile, the incoming
  Plan and Track, applicability, warnings, retained facts, and the pending recalculation statement.
- Apply takes the shared `planning-workspace` lock, locks every Plan of the workspace and every
  child Track of the outgoing Plan in stable order, re-resolves Targets through the released bounded
  owner query, rebuilds the preview, and requires `canApply`, the exact digest, the exact expected
  Plan version, and both derived identifiers.
- One transaction archives the outgoing Plan with exactly one version increment, inserts the
  incoming Plan and Track at version `1`, appends one validated `PLAN_REPLACED` event plus one fixed
  `planning.plan_snapshot_v1` delivery, and completes the command receipt.
- The event payload carries only identifiers, the archived version, and the change kind. Its
  validator additionally refuses a payload that would archive and create the same aggregate.

## Decided behavior worth remembering

- Track lifecycle values under an archived Plan are never rewritten. A Track is frozen exactly as
  the person left it, and every released Track command already refuses an archived parent.
- Historical Focus sessions keep their immutable Track attribution. The released completed-work
  normalization counts such a session as consumed weekly capacity and grants it no cadence credit
  once its activity no longer belongs to a current Track, so replacing mid-week neither fabricates
  nor erases completed work.
- The workspace current-snapshot pointer is untouched. The previous snapshot stays valid history
  referencing the archived Plan and Planning freshness is honestly `PENDING`.
- `api.get_growth_plan_setup_source_v1` no longer treats more than one lifetime Plan as corruption;
  only more than one current Plan, or a sentinel without any Plan, remains corrupt. The released D1b
  database test was updated to assert the ADR-0010 semantics instead of the previous rule.
- A competing command that previewed the outgoing Plan fails closed after a replacement commits,
  because the digest binds Plan identity rather than only the version number.

## Files and migrations

- `supabase/migrations/20260904000100_phase4b_growth_plan_replacement.sql` — the child-Track
  constraint and fingerprint, replacement identity derivation, the event-payload validator, the
  preview builder and resolver, the three `api` functions, and the revised first-setup source.
- `schemas/planning/v1/growth-plan-replacement-control.schema.json`,
  `schemas/events/v1/planning-event.schema.json` (additive `PLAN_REPLACED` variant).
- `src/modules/planning/domain/growth-plan-replacement-preview.ts` (pure digest, identity,
  fingerprint, and request-hash inputs), `src/shared/contracts/growth-plan-replacement-control.ts`,
  `src/shared/contracts/schema-registry.ts`.
- `src/ui/plan/server/plan-workspace-v1.ts`, `src/ui/plan/server/database-plan.ts`,
  `src/app/plan/actions.ts`, `src/app/plan/page.tsx`, `src/ui/plan/plan-types.ts`,
  `src/ui/plan/plan-workspace.tsx`, `src/ui/plan/growth-plan-replacement.tsx`,
  `src/app/dev/plan-fixture/page.tsx`.
- Tests: `supabase/tests/database/048_phase4b_growth_plan_replacement.test.sql`,
  `supabase/tests/database/049_phase4b_growth_plan_replacement_concurrency.test.sql`,
  `tests/contract/growth-plan-replacement-control.test.ts` plus five fixtures, four
  `planning-plan-replaced.*.json` event fixtures, `tests/contract/planning-event.test.ts`,
  `src/ui/plan/growth-plan-replacement.test.tsx`, `src/app/plan/page.test.tsx`,
  `tests/e2e/plan.spec.ts`, `tests/database/verify-database.test.mjs`,
  `supabase/tests/database/001_phase0_schema_security.test.sql`, and
  `supabase/tests/database/034_phase4b_first_growth_plan_setup.test.sql`.

No production dependency, lockfile, or calculation contract changed. No database extension was
added.

## Verification evidence

Every gate below was executed in this session against a rebuilt database. The database gate ran
through a local PostgreSQL 16 rehearsal harness rather than the Supabase CLI, because this session
has no Docker daemon and no registry access; see `Remaining risks`.

- formatting (`prettier --check .`) — PASS.
- lint (`eslint . --max-warnings=0`) — PASS.
- type checking (`next typegen && tsc --noEmit`) — PASS.
- database-runner (`node --test tests/database/*.test.mjs`) — PASS, 15 checks.
- backup-archive (`node --test tests/backup/*.test.mjs`) — PASS, 3 checks.
- contract tests — PASS, 403 tests in 25 files (392 before D3a).
- performance tests — PASS, 3 tests.
- unit tests with coverage — PASS, 961 tests in 96 files (944 before D3a); 86.77% statements,
  80.83% branches, 91.11% functions, 88.15% lines against the 85/80/85/85 thresholds.
- production build (`next build`) — PASS.
- Chromium end-to-end (`playwright test`) — PASS, 37 tests (36 before D3a), including the new
  replacement journey plus its keyboard, 320-pixel, touch-target, reduced-motion, forced-colors, and
  automated WCAG A/AA coverage.
- pgTAP — PASS, 49 files and 3070 assertions with zero failures (47 files and 2972 assertions
  before D3a).

## Remaining risks

- The pgTAP run used a local PostgreSQL 16 cluster with pgTAP, pg_cron, and dblink, plus small shims
  for the Supabase platform objects the migration chain expects (`auth.users`, `auth.uid`,
  `vault.decrypted_secrets`, and `net.http_post`). Every PANDO migration, the scratch fixture
  migration, and the seed applied unchanged, and the whole suite passed, but the owner should still
  run `pnpm verify:db` on Windows with Docker so the exact Supabase image and CLI lint confirm it.
- `pnpm verify:auth` and `pnpm verify:backup` need the full Supabase stack and were not run here.
  Nothing in D3a touches authentication or backup behavior, and the `/plan` replacement control uses
  the same server-action boundary as every released control, but the authenticated browser gate has
  not exercised a real replacement yet.
- `src/shared/supabase/database.generated.ts` was not regenerated. The Planning boundary calls RPCs
  through a typed name union with an explicit `as never` cast, so the new functions typecheck and
  run without it; regenerate it from a migrated database when convenient.

## Next bounded outcome

D3b availability windows, exactly as ADR-0010 §6 and §9 define them: plan-scoped whole-local-day
windows with per-day minute caps, a database-enforced non-overlap invariant, bounded cardinality
sentinels, the first persisted clock-bound Planning proposal, and the V3 calculation rollout.
