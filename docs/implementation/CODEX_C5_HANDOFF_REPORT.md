# Codex C5 handoff report

Session date: 2026-08-29
Branch: `codex/c5-prerequisite-satisfaction`
Outcome: Phase 4A C5 — versioned prerequisite satisfaction from Mastery

## 1. Result

C5 replaces Planning's permanent `UNKNOWN` placeholder for candidates with blocking prerequisites.
Planning now receives exact direct blocking edges from the candidate's immutable Catalog version,
asks Mastery for one privacy-minimized current projection per distinct prerequisite, invokes a pure
versioned Mastery classifier, and aggregates the results into the existing Planning tri-state.

There is no UI change in C5. The live Today boundary remains C6.

## 2. Accepted policy and ownership

The new policy is
[`mastery-prerequisite-satisfaction/0.1`](../policies/PLANNING_PREREQUISITE_SATISFACTION_POLICY_V0.1.md),
implemented by `mastery-prerequisite-engine/0.1.0`.

- Catalog owns exact direct incoming blocking `PREREQUISITE_OF` edges and bounded unlock counts.
- Mastery owns projection validation and `SATISFIED | BLOCKED | UNKNOWN` classification.
- Planning owns bounded aggregation, eligibility, ranking, snapshot validity, and persistence.
- SQL returns bounded owner state; it does not implement the product classifier.
- Planning has no direct Catalog or Mastery table grant.

One prerequisite is `SATISFIED` when at least one known, currently fresh dimension is Strong and at
least `COMPLETED`. It is `BLOCKED` when no positive witness exists and at least one known, currently
fresh dimension is Weak. Missing, stale-only, unsupported, post-claim, or malformed state is
`UNKNOWN`; a positive witness wins over a Weak dimension.

The classifier consumes the latest materialized Mastery projection published no later than the
attempt's persisted `claimAsOf` and recalculates freshness at that instant. It does not reconstruct
Evidence inside Planning. A later Mastery publication changes the source fence and wakes Planning,
providing the accepted eventual-consistency convergence path.

## 3. Bounds, privacy, and fail-closed behavior

- at most 20 direct blocking prerequisites per candidate;
- at most 200 distinct candidate/Catalog-version pairs per bundle;
- at most 500 distinct prerequisite competency references per bundle;
- exact published or retired Catalog versions only;
- missing or ambiguous personal/canonical competency origins fail at the Overlay owner boundary
  before Catalog prerequisites are read, including collisions with retired exact-version Catalog
  items; future personal-content admission/import must prevent them;
- one sorted Mastery answer per requested reference;
- no Evidence identifiers, explanations, bodies, outcomes, or authority-bearing fields cross the
  Mastery source boundary;
- malformed projection envelopes, impossible clocks, incompatible versions, contradictory
  freshness, impossible aggregate achievement, incomplete answers, and fence disagreements fail
  closed.

The earliest inclusive freshness boundary among decisive witnesses caps Planning snapshot validity.
All policy/engine versions, derived counts, and owner revisions enter the canonical Planning input
fingerprint.

## 4. Main implementation

### New

- `docs/policies/PLANNING_PREREQUISITE_SATISFACTION_POLICY_V0.1.md`
- `src/modules/mastery/domain/prerequisite-satisfaction-types.ts`
- `src/modules/mastery/domain/prerequisite-satisfaction-policy-v0.1.ts`
- `src/modules/mastery/domain/calculate-prerequisite-satisfaction.ts`
- `src/modules/mastery/application/prerequisite-satisfaction-v1.ts`
- `tests/fixtures/calculation-engines/v0.1/mastery-prerequisite.golden.json`
- `supabase/migrations/20260829000125_phase4a_planning_prerequisite_satisfaction.sql`
- `supabase/tests/database/024_phase4a_planning_prerequisite_satisfaction.test.sql`

### Updated

- Planning source assembler, input types, pure-engine invariants, dispatcher tests, schema,
  malicious/boundary fixtures, and golden fingerprint;
- Phase 4A design/status, Planning policy/runbook, module READMEs, root status, central database
  security coverage, and database test discovery.

The migration adds least-privilege `NOLOGIN NOINHERIT NOBYPASSRLS` source roles/policies, two
bounded Catalog indexes, `catalog.read_planning_graph_source_v2`,
`mastery.read_planning_prerequisite_source_v1`, and an expand/contract replacement of the public
Planning bundle-loader signature without exposing the prior implementation.

## 5. Review corrections

Three independent read-only audits covered TypeScript contracts, SQL/RLS/bounds, and documentation.
Their blocking findings were corrected before integration:

- classification moved out of SQL into a pure Mastery TypeScript engine;
- empty/no-plan bundles now preserve the owner-policy handshake;
- malformed projection envelopes and impossible aggregate/dimension achievement fail Unknown;
- claim-time wording now matches the materialized-projection/eventual-convergence architecture;
- Catalog scans apply `LIMIT` before sorting, so collation cannot force an unbounded top-N scan;
- missing origins and legacy/import personal/canonical reference collisions (including retired
  Catalog items) fail closed before Catalog prerequisites can be applied;
- unlock counts and source cardinalities are structurally bounded;
- the database test exercises a real non-empty owner bundle and exact covering fence;
- this report supersedes the historical C4 report's old C5 resume instructions.

No blocker remained after re-audit.

## 6. Verification

Verification is compositional at the PostgreSQL/TypeScript process boundary: pgTAP exercises real
Catalog/Mastery owner queries and a real non-empty Planning source bundle, while TypeScript tests
exercise the database-shaped bundle through the real assembler, classifier, pure Planning engine,
and dispatcher. The repository does not yet have one process that crosses PostgreSQL → TypeScript →
PostgreSQL; this report does not claim that absent harness as executed coverage.

| Gate | Result |
| --- | --- |
| focused C5 suite | PASS — 5 files / 88 tests |
| `pnpm typecheck` | PASS |
| `pnpm verify:db` | PASS — clean rebuild, 24 pgTAP files / 1903 tests, database lint clean |
| `pnpm verify` | PASS — format, lint, typecheck, database-runner 13 pass/2 Windows platform skips, backup archive 3/3, contracts 307/307, performance 3/3, unit 692/692 with 87.83% statements and 80.68% branches, production build, Chromium E2E 21/21 |
| `pnpm verify:auth` | PASS — isolated auth, target selection, overlay persistence, reload, refresh, and sign-out |
| `pnpm verify:backup` | NOT RUN — backup/storage behavior did not change; archive coverage remains part of `pnpm verify` |

## 7. Next outcome

C6 is the live `TodayWorkspaceV1` read boundary and opaque action-selection resolver/coordinator.
It must preserve workspace isolation, pending/error/last-known-safe behavior, inclusive validity,
and UI/agent parity through ordinary commands. It must not expose internal candidate authority or
allow browser writes to Planning tables. The `/today` UI starts only after this boundary and its
database security/contract tests are complete.
