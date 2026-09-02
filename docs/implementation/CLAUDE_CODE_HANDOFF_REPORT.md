# Claude Code handoff report

Session date: 2026-09-02
Agent: Claude Code (Opus 5), working from `CODEX_D2C_TO_CLAUDE_HANDOFF.md`
Branches: `claude/d3-d5-lifecycle-adr`, then `claude/d3a-growth-plan-replacement`

This file replaces the historical C4 report, which remains in Git history.

## 1. Outcome attempted

Two ordered outcomes from the Codex D2c handoff:

1. **D3–D5 lifecycle ADR** — settle every open decision in
   `docs/design/PHASE_4B_LIFECYCLE_COMMANDS.md` §10 with no production-code or schema change.
   Status: **complete and committed** (`60e793e`).
2. **D3a Growth Plan replacement** — the smallest reversible D3 slice named by the accepted ADR.
   Status: **complete and committed** (`44c3f3b`), verified by every gate this environment can run
   (§6), with two owner-run gates outstanding.

D3b availability, D4 Campaign persistence, and D5 overlays/coordinator are **not** started.

## 2. User-visible result

The ADR changes nothing a person can see.

D3a adds one control to `/plan`: **Replace this Growth Plan**. A signed-in person with a current
Plan chooses a target, initial weekly capacity, default session length, and first-Track priority,
reads an exact preview, and confirms. On confirmation the current Plan becomes archived, readable
history and a new current Plan with one initial Track takes its place in the same transaction.
Nothing is deleted and nothing is copied: the archived Plan keeps its Learning Tracks exactly as the
person left them, and every Focus session, Evidence record, Mastery state, Review, and plan snapshot
is retained. Today reports honest `PENDING` recalculation afterwards.

## 3. Architecture and policy decisions

`docs/adr/0010-lifecycle-replacement-availability-and-campaign-semantics.md` is the authority for
all of them. In brief:

1. **Exactly one current Growth Plan after initialization.** No standalone archive command; archive
   is reachable only inside atomic replacement, which never copies Tracks.
2. **A paused Growth Plan no longer silences an active Campaign** (implemented in D5, with a new
   engine/policy version).
3. **Campaign deadlines are a workspace-local date** plus the recorded time zone and a derived
   exclusive instant; no auto-end after the deadline, a clamped day count, and an explicit prompt.
4. **Campaign retarget repoints to an exact existing active Readiness Goal**; goals and profile
   versions are never mutated, and requirement overrides are superseded rather than carried over.
5. **Allocation overrides temporarily replace a Track's own priority, protected minimum, and
   cadence.** Minima are reservations that may only be raised; nothing is a cap; base rows are never
   mutated, so cancellation restores base allocation by construction.
6. **Availability windows are plan-scoped, whole-local-day, non-overlapping caps** with per-day
   minute values; effective weekly capacity is `min(default, sum of the week's day caps)`, so a
   window can only reduce capacity. Protected minima are rationed deterministically when
   availability drops below their sum.
7. **One purpose-specific `campaign_lifecycle_v1` coordinator** in the Agent Control boundary for
   start/end/cancel only, with the fixed lock order agent-control → targets → planning.
8. **Calculation versions per slice**: D3a none; D3b `planner-engine/0.3.0`,
   `planning-policy/0.3`, and `planning-calculation/3`; D4 none; D5 `0.4.0`, `0.4`, and `4`, each
   with the reviewed D2c expand-then-activate rollout.
9. **Ordered slices**: D3a, D3b, D4, D5, each finished, verified, documented, and committed alone.

D3a's own decisions are recorded in
`docs/design/PHASE_4B_D3A_GROWTH_PLAN_REPLACEMENT.md` and
`docs/implementation/PHASE_4B_D3A_GROWTH_PLAN_REPLACEMENT_STATUS.md`. The two that matter most for
future work: Track lifecycle values under an archived Plan are never rewritten, and historical Focus
sessions keep their immutable Track attribution, so a mid-week replacement neither fabricates nor
erases completed work.

## 4. Files and migrations changed

**ADR outcome (`60e793e`)** — documentation only:
`docs/adr/0010-lifecycle-replacement-availability-and-campaign-semantics.md` (new),
`docs/README.md`, `docs/design/PHASE_4B_LIFECYCLE_COMMANDS.md`,
`docs/implementation/PHASE_4B_LIFECYCLE_COMMANDS_STATUS.md`, `src/modules/planning/README.md`.

**D3a outcome (`44c3f3b`)**:

- migration: `supabase/migrations/20260904000100_phase4b_growth_plan_replacement.sql`;
- schemas: `schemas/planning/v1/growth-plan-replacement-control.schema.json` (new),
  `schemas/events/v1/planning-event.schema.json` (additive `PLAN_REPLACED` variant);
- domain and contracts: `src/modules/planning/domain/growth-plan-replacement-preview.ts`,
  `src/shared/contracts/growth-plan-replacement-control.ts`,
  `src/shared/contracts/schema-registry.ts`;
- boundary and UI: `src/ui/plan/server/plan-workspace-v1.ts`, `src/ui/plan/server/database-plan.ts`,
  `src/app/plan/actions.ts`, `src/app/plan/page.tsx`, `src/ui/plan/plan-types.ts`,
  `src/ui/plan/plan-workspace.tsx`, `src/ui/plan/growth-plan-replacement.tsx`,
  `src/app/dev/plan-fixture/page.tsx`;
- tests: `supabase/tests/database/048_…replacement.test.sql`,
  `supabase/tests/database/049_…replacement_concurrency.test.sql`,
  `tests/contract/growth-plan-replacement-control.test.ts` and five fixtures, four
  `planning-plan-replaced.*.json` event fixtures, `tests/contract/planning-event.test.ts`,
  `src/ui/plan/growth-plan-replacement.test.tsx`, `src/app/plan/page.test.tsx`,
  `tests/e2e/plan.spec.ts`, `tests/database/verify-database.test.mjs`,
  `supabase/tests/database/001_phase0_schema_security.test.sql`,
  `supabase/tests/database/034_phase4b_first_growth_plan_setup.test.sql`;
- documentation: the D3a design and status records plus the index updates listed above.

No production dependency, lockfile, calculation contract, or database extension changed. One
released database test (034) was updated because ADR-0010 §1 deliberately changes the rule it
asserted: archived history beside one current Plan is legitimate, not corruption.

## 5. Contracts and invariants

- Command `planning.replace_growth_plan_v1`, operation `replace_growth_plan`, contracts
  `GrowthPlanReplacementSourceV1`, `GrowthPlanReplacementPreviewV1`,
  `GrowthPlanReplacementApplyResultV1`, all at `1.0.0`.
- Digest version `growth-plan-replacement-preview-digest/1.0.0`, request hash
  `growth-plan-replacement-request-hash/1.0.0`, identity version `planning-create-identity/1.0.0`,
  child-Track fingerprint `growth-plan-child-track-fingerprint/1.0.0`. The digest is clock-free and
  has one TypeScript/PostgreSQL oracle proven in both suites.
- Planning owns every write. Targets is read only through the released bounded owner query;
  `pando_planning_api` still has no Targets table privilege.
- Apply requires the authenticated session, both expected versions, the exact recomputed digest, a
  printable reason, and a lowercase request UUID. The outgoing Plan advances exactly one version;
  the incoming Plan and Track start at version `1`; the snapshot sentinel is untouched.
- Same-key replay returns the stored response. A changed request with the same key, a stale Plan or
  Goal version, a changed digest, an unknown goal, an archived parent, and an out-of-range value all
  fail closed with no partial state.
- Forced RLS is unchanged; the new `api` functions are pinned `SECURITY DEFINER` owned by
  `pando_planning_api`, granted only to `authenticated`, with every helper ungranted.
- The `PLAN_REPLACED` event payload carries seven identifier/version fields and no private body; its
  validator also refuses archiving and creating the same aggregate.

## 6. Verification

Every command below was executed in this session and its result observed.

| Gate | Result |
|---|---|
| `prettier --check .` | PASS |
| `eslint . --max-warnings=0` | PASS |
| `next typegen && tsc --noEmit` | PASS |
| `node --test tests/database/*.test.mjs` | PASS — 15 checks |
| `node --test tests/backup/*.test.mjs` | PASS — 3 checks |
| contract tests | PASS — 403 tests / 25 files (392 before D3a) |
| performance tests | PASS — 3 tests |
| unit tests with coverage | PASS — 961 tests / 96 files; 86.77% statements, 80.83% branches, 91.11% functions, 88.15% lines against 85/80/85/85 |
| `next build` | PASS |
| Chromium E2E | PASS — 37 tests (36 before D3a) |
| pgTAP suite | PASS — 49 files, 3070 assertions, 0 failures (47 files / 2972 before D3a) |

**How the database gate was run, exactly.** This session has no Docker daemon and no container
registry access, so `supabase db start` cannot run. The pgTAP suite was executed against a local
PostgreSQL 16 cluster with `pgtap`, `pg_cron`, `pgcrypto`, and `dblink`, plus small shims for the
Supabase platform objects the migration chain expects: `auth.users` with the columns the fixtures
use, `auth.uid`/`auth.role`/`auth.jwt`, `vault.decrypted_secrets`, `net.http_post`, the `anon`,
`authenticated`, and `service_role` roles, and `grant usage on schema extensions` to those roles.
Every PANDO migration, the scratch fixture migration, and `seed.sql` applied unchanged; the two
`create extension` statements for `pg_net` were the only lines adjusted at load time, because that
extension does not exist outside the Supabase image. Concurrency tests ran over a real non-loopback
`dblink` connection with password authentication, exactly as the tests require.

**Not run here:** `pnpm verify:db` through the Supabase CLI (image and lint), `pnpm verify:auth`,
and `pnpm verify:backup`. They need Docker and the full Supabase stack on the owner's Windows host.

## 7. Git state

- `main` is still `9949dd9` and equals `origin/main`. Nothing was pushed; this shell has no GitHub
  credentials.
- `claude/d3-d5-lifecycle-adr` — `60e793e` `docs(planning): accept d3-d5 lifecycle adr`.
- `claude/d3a-growth-plan-replacement` — `44c3f3b` `feat(planning): add atomic growth plan
  replacement`, branched from `60e793e`, so it contains both outcomes.
- Working tree at the end of D3a: clean except the owner's untracked
  `docs/DAILY_PACE_AUTOREPLAN_AGENT_PROMPT.md`, which was never staged, committed, or edited.
- `git checkout main && git merge --ff-only claude/d3a-growth-plan-replacement` fast-forwards both
  outcomes onto `main` once the owner-run gates in §6 pass.

## 8. Remaining work

1. **Owner verification before merge.** Run `pnpm verify`, `pnpm verify:db`, `pnpm verify:auth`, and
   `pnpm verify:backup` on Windows with Docker Desktop, then fast-forward and push.
2. **D3b availability windows** — ADR-0010 §6 and §9. Plan-scoped whole-local-day windows with
   per-day caps, the `btree_gist` non-overlap exclusion constraint, bounded cardinality sentinels,
   the first persisted clock-bound Planning proposal, the V3 calculation rollout, `/plan` control,
   and gates.
3. **D4 Targets Campaign foundation**, then **D5 overlays and the coordinator**, in that order.
4. **Known risks.** `src/shared/supabase/database.generated.ts` was not regenerated (the Planning
   boundary casts RPC names, so this does not break typecheck or runtime). The local pgTAP rehearsal
   is close to but not identical to the Supabase image. `/plan` grows one more control per slice and
   will need a layout review before Phase 7.

## 9. Codex resume prompt

```text
Прочитай docs/adr/0010-lifecycle-replacement-availability-and-campaign-semantics.md,
docs/design/PHASE_4B_D3A_GROWTH_PLAN_REPLACEMENT.md,
docs/implementation/PHASE_4B_D3A_GROWTH_PLAN_REPLACEMENT_STATUS.md и
docs/implementation/CLAUDE_CODE_HANDOFF_REPORT.md.
Ветки claude/d3-d5-lifecycle-adr (ADR) и claude/d3a-growth-plan-replacement (D3a) готовы; main
остаётся на 9949dd9. Сначала прогони на Windows pnpm verify, pnpm verify:db, pnpm verify:auth и
pnpm verify:backup на ветке claude/d3a-growth-plan-replacement. Если всё зелёное — сделай
git checkout main && git merge --ff-only claude/d3a-growth-plan-replacement и запушь в origin/main.
Затем продолжай строго по ADR-0010 §9: следующий bounded outcome — D3b availability windows
(§6: plan-scoped дни целиком, per-day cap, btree_gist exclusion, persisted clock-bound proposal,
V3 calculation rollout). D4 и D5 — только после D3b.
```
