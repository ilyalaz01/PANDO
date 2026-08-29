# Claude Code handoff report

Session date: 2026-08-28
Agent: Claude Code (Opus 5)
Branch: `claude/c4-meaningful-work`

Current note (2026-08-29): this is the historical C4 report. Codex completed the independent
hardening below, fast-forwarded C4 to `main` at `9c76f5f`, and pushed it to `origin/main`. C5 and C6
were implemented afterward and are documented separately in
[`CODEX_C5_HANDOFF_REPORT.md`](CODEX_C5_HANDOFF_REPORT.md) and
[`CODEX_C6_HANDOFF_REPORT.md`](CODEX_C6_HANDOFF_REPORT.md). Statements below that C5 or the live
Today boundary had not started describe the original Claude handoff, not the current repository.

## 1. Outcome attempted

Phase 4A **C4 — meaningful completed work**, as defined in `CLAUDE.md` under "Current bounded
outcome". Status: **complete and verified** — every gate proportionate to the change was run and
passed (§6).

The bounded outcome was to replace the blanket `UNSUPPORTED_MEANINGFUL_WORK_HISTORY` safety gate with
a reviewed, versioned policy for completed meaningful minutes and recent candidate repetition, fed by
bounded Sessions/Evidence owner queries, without fabricating any value.

At this original C4 handoff, C5 (Mastery prerequisite satisfaction) and C6 (live Today read
boundary) were **not** started.

## 2. User-visible result

No UI changed; `/today` still does not exist. The production Planning pipeline no longer refuses a
snapshot solely because the workspace has completed Focus history in the current week. When its
owner bundle is otherwise valid, a finished Focus activity is normalized into a snapshot whose
`capacity.consumedMinutesThisWeek` reflects actual completed work, whose per-track cadence credit
reflects evidence-bearing work only, and whose ranking applies a real recent-repetition penalty.

Before this change, any workspace with a terminal Focus session in the current local week was
permanently dead-lettered. That was the single blocker preventing a real user's plan from ever
recalculating after their first completed session.

## 3. Architecture and policy decisions

### 3.1 A separate versioned input-normalization policy

`docs/policies/PLANNING_COMPLETED_WORK_POLICY_V0.1.md` defines `planning-completed-work/0.1`. It is
deliberately *not* part of `planning-policy/0.1`: no ranking coefficient or eligibility rule moved,
so `planner-engine/0.1.0` and `planning-policy/0.1` are unchanged and the existing
`plan_snapshots` check constraints still hold.

The version travels in the calculation input as `completedWorkPolicyVersion`, so it enters the
canonical SHA-256 fingerprint. A future rule change therefore always produces a new fingerprint and a
new snapshot instead of silently reinterpreting an existing one. It is persisted in
`planning.plan_snapshot_attempts.normalized_input`, which is the audit record.

Authority: `docs/adr/0006-calculation-and-review-engines.md` (versioned policy, explicit clock,
stored snapshots); `docs/design/PHASE_4A_PLANNING_TODAY.md` §4 and §6.

### 3.2 Counted duration

```text
countedMinutes = min( floor((endedAt - max(startedAt, weekStart)) / 60s), plannedMinutes )
```

Three properties, each required by `CLAUDE.md`:

- planned duration is only ever an **upper bound**, never a substitute for completed work;
- unbounded wall-clock/page-open time cannot be credited — an abandoned open session is capped at the
  minutes the user themselves planned for that activity;
- only the part of a session inside the current plan week consumes this week's capacity.

Because a workspace has at most one active Focus Session at a time
(`one_active_focus_session_per_workspace`), counted durations cannot overlap, so
`consumedMinutesThisWeek <= 10080` is provable rather than asserted. The adapter still checks it and
fails closed.

### 3.3 Three session tiers, one duration rule

| Tier | Condition | Consumes capacity | Earns track cadence credit | Counts as repetition |
|---|---|---|---|---|
| `EVIDENCE_BEARING` | completed + non-invalidated normalized observation | yes | yes | yes |
| `COMPLETED` | completed, terminal attempt, any `result_kind` | yes | no | yes |
| stopped | session state `stopped` | no | no | no |

The `COMPLETED` vs `EVIDENCE_BEARING` split is the substantive product decision. A `COMPLETION_ONLY`
result (finished a reading, recorded no result) is completed work in the plain sense and consumes the
week's capacity, but it does not satisfy a protected track minimum, because protected cadence exists
to guarantee evidenced progress. Authority: `docs/01_DOMAIN_MODEL.md` §4 ("An activity may become
operationally complete without producing competency evidence"), `docs/00_PRODUCT_CONSTITUTION.md` P1,
and `docs/02_PRODUCT_AND_UX_SPEC.md` §13 (do not reward clicking complete without evidence).

A stopped session is abandonment, not work, so it earns nothing.

### 3.4 Repetition window and its clock transition

`repetitionsInLast7Days` counts `COMPLETED` sessions for the candidate's exact activity in the
half-open window `(claimAsOf − 168 hours, claimAsOf]`. It is expressed as **168 elapsed hours**, never
"seven calendar days", for the same reason `docs/design/PHASE_4A_PLANNING_TODAY.md` §6 forbids adding
seven days to a UTC instant: a daylight-saving transition would otherwise resize the window.

A repetition leaving that window is a clock-derived ranking change, which Planning Policy v0.1 §4
forbids a snapshot from outliving. The adapter therefore caps `validUntil` at
`oldestCountedRepetitionEndedAt + 168h − 1ms`, and each candidate carries that oldest end plus the
exclusive `repetitionWindowEndsAt`. The **pure engine verifies the exact 168-hour relationship and
the cap** rather than trusting the adapter. Both instants are null exactly when no repetition is
counted.

### 3.5 Ownership boundary

Planning gained **no** Sessions or Evidence table grant. Two bounded owner queries were added, both
receiving the attempt's single persisted `claimAsOf`:

- `sessions.read_planning_completed_work_source_v1` — terminal Focus duration facts inside
  `[least(weekStart, claimAsOf − 168h), claimAsOf]`, owned by `pando_phase2_planning_source`;
- `evidence.read_planning_completed_work_source_v2` — **two booleans per session** (`attemptTerminal`,
  `evidenceBearing`) plus the ledger fence, owned by a new least-privilege
  `pando_evidence_planning_source` role. No observation body, competency reference, outcome,
  engagement, hint, or correction reason reaches Planning.

Per-track attribution joins Planning's own `learning_track_activities` against the session's
`customActivityId` inside the Planning bundle loader. Work on an activity no longer admitted to a
track still consumes capacity but earns no cadence credit — this is the "per-track consumption where
supported" boundary, and it never fabricates an attribution.

Authority: `docs/design/MODULE_TOPOLOGY.md` §2 (query is one of the four permitted interaction
forms), `docs/design/PHASE_4A_PLANNING_TODAY.md` §3 ("completed meaningful minutes and repetition |
Sessions/Evidence | bounded aggregate query").

### 3.6 Fences

Two new source revisions enter the canonical fingerprint:

- `FOCUS`/`completed-work` — SHA-256 of the exact returned session payload;
- `EVIDENCE`/`completed-work` — SHA-256 of the exact claim-scoped classification answer, so a
  correction changes the fence without pairing pre-claim facts with a post-claim ledger watermark.

`EVIDENCE` was added to the `sourceRevision.owner` enum and the engine now requires it
unconditionally alongside `FOCUS` and `REVIEW`.

`sessions.read_planning_focus_source_v1` temporarily preserves its legacy `terminalCount` field for
rolling-deploy compatibility. New workers ignore it: the completed-work source is their
authoritative terminal-session boundary and is bounded by the same claim clock.

## 4. Files and migrations changed

### New

- `docs/policies/PLANNING_COMPLETED_WORK_POLICY_V0.1.md` — the versioned policy.
- `supabase/migrations/20260828000425_phase4a_planning_completed_work_sources.sql` — additive: new
  `pando_evidence_planning_source` role, initial read-only grants and RLS policies on four Evidence
  tables, two new owner queries, `create or replace` of `sessions.read_planning_focus_source_v1`
  and `planning.load_plan_snapshot_source_bundle_v1` (adds `completedWork`
  and `evidence`, computes the 168-hour window).
- `supabase/migrations/20260829000100_phase4a_planning_completed_work_hardening.sql` — forward-only
  post-review hardening for bounded pre-aggregation reads, column-minimal grants, explicit Evidence
  claim clock, source-fence recomputation, and rolling-worker compatibility. The already committed
  `20260828000425` migration remains byte-for-byte unchanged.
- `supabase/tests/database/023_phase4a_planning_completed_work.test.sql` — pgTAP.

### Contract

- `schemas/planning/v1/planning-input.schema.json` — `completedWorkPolicyVersion`, `EVIDENCE` owner,
  `oldestRepetitionEndedAt`, and `repetitionWindowEndsAt`.
- `schemas/planning/v1/README.md`.

### Implementation

- `src/modules/planning/application/assemble-plan-snapshot-input.ts` — the policy.
- `src/modules/planning/domain/planning-types.ts`, `src/modules/planning/domain/calculate-plan.ts` —
  contract types and engine verification.

### Tests and fixtures

- `src/modules/planning/application/assemble-plan-snapshot-input.test.ts` — tiers, duration bounds,
  week clipping, window boundary, untracked attribution, seven fail-closed cases, property test.
- `src/modules/planning/domain/calculate-plan.test.ts` — policy-version and repetition-window
  verification.
- `src/modules/planning/application/dispatch-plan-snapshot-projection.test.ts`,
  `tests/contract/planning.test.ts`, `tests/database/verify-database.test.mjs`.
- `tests/fixtures/calculation-engines/v0.1/planning.golden.json` and the four
  `tests/contract/fixtures/planning/v1/` fixtures (fingerprints recomputed).

### Documentation

- `docs/implementation/PHASE_4A_PLANNING_TODAY_STATUS.md`, `src/modules/planning/README.md`,
  `docs/policies/PLANNING_POLICY_V0.1.md`, `docs/design/PHASE_4A_PLANNING_TODAY.md`,
  `docs/runbooks/database/phase-4a-planning-snapshot-projection.md`, `README.md`.

`README.md` carried the stale sentence `CLAUDE.md` flagged ("Planning persistence, its worker, and
the live Today route remain in progress"); it was corrected alongside this accurate status update, as
that file permits.

## 5. Contracts and invariants

- **Versions.** `planner-engine/0.1.0` and `planning-policy/0.1` unchanged.
  `planning-completed-work/0.1` is new and carried in the input.
- **Ownership.** Planning holds no Sessions/Evidence table grant; both new functions are
  `security definer`, owned by their bounded context's source role, executable only by
  `pando_planning_worker`, and revoked from `public`, `anon`, `authenticated`, and `service_role`.
- **Security.** `pando_evidence_planning_source` is `NOLOGIN NOINHERIT NOBYPASSRLS` and holds only
  `SELECT`. The migration revokes every temporary `CREATE` grant and its own role memberships.
- **Idempotency / atomicity.** No command changed; no new outbox path. Read-only additions.
- **Determinism.** All three derived numbers enter the canonical fingerprint, so replay of an
  unchanged normalized input is a no-op and a policy change is not.
- **Failure behavior.** `UNSUPPORTED_MEANINGFUL_WORK_HISTORY` narrowed from "any terminal session in
  the week" to genuinely unclassifiable history; `COMPLETED_WORK_SOURCE_BOUND` (>500 sessions) and
  `MISSING_SESSION_SOURCE` added. Everything unsupported still fails closed, preserving the previous
  snapshot and leaving Today visibly pending.

## 6. Verification

Claude executed the following gates on the original C4 handoff tree using Node 24.20.0, pnpm
11.19.0, and WSL2 Linux. The authoritative post-review Windows results follow this historical table.

| Command | Result |
| --- | --- |
| `pnpm verify:db` | **PASS** — migrations rebuilt from empty through `20260828000425`; pgTAP `Files=23, Tests=1858`, `Result: PASS`; `db lint` returned `{"results":[]}` |
| `pnpm format:check` | PASS |
| `pnpm lint` | PASS (`--max-warnings=0`) |
| `pnpm typecheck` | PASS |
| `pnpm test:database-runner` | PASS — 15 pass, 0 fail |
| `pnpm test:backup-archive` | PASS — 3 pass, 0 fail |
| `pnpm test:contracts` | PASS — 15 files, 306 tests |
| `pnpm test:performance` | PASS — 1 file, 3 tests |
| `pnpm test:unit:coverage` | PASS — 69 files, 674 tests; statements 87.91%, branches 80.41%, functions 93.46%, lines 89.72% |
| `pnpm test:e2e` | PASS — 21 Chromium specs passed, including the axe WCAG A/AA checks |
| `pnpm verify` | **PASS end to end**, all nine stages including `test:e2e` |
| `pnpm verify:auth` | PASS — "isolated auth, target selection, overlay note/activity persistence, reload, refresh, and sign-out gate passed" |
| `pnpm verify:backup` | **NOT RUN** — deliberately skipped; no backup or storage behavior changed. `test:backup-archive` did run |
| `pnpm verify:phase0` | **NOT RUN** as one command; it aggregates `verify`, `verify:db`, `verify:backup`, and `verify:auth`, and all except `verify:backup` were run individually above |

The two browser gates were initially blocked: Chromium could not start in this WSL2 distribution
(`chrome-headless-shell: error while loading shared libraries: libnspr4.so`), with `libnspr4.so`,
`libnss3.so`, `libnssutil3.so`, and `libasound.so.2` unresolved. The owner installed those system
packages, after which both gates were re-run and passed on this branch's final tree.

### Codex post-handoff audit and Windows verification

Codex then reviewed the TypeScript contract, database boundary, tests, and this report independently.
That audit found and corrected seven issues before integration:

- the public schema and pure engine accepted physically impossible weekly totals;
- the engine trusted a supplied repetition cutoff without proving its relationship to the oldest
  counted repetition;
- the 500-session refusal happened after an unbounded aggregate;
- the Evidence source role had table-wide rather than column-minimal read grants;
- replacing the v1 Focus source removed `terminalCount` and would break an older worker during a
  rolling deployment.
- the initial correction rewrote an already committed migration instead of applying a forward-only
  upgrade;
- the first claim-scoped Evidence query paired old-claim facts with a current ledger revision rather
  than an exact claim-scoped content fence.

The Evidence query now also receives the persisted `claimAsOf` and applies it to observation and
correction records. The central security suite covers the new role and both owner functions. The
reviewed tree was verified on Windows with Node 24.19.0 and pnpm 11.19.0:

| Command | Final reviewed result |
| --- | --- |
| `pnpm verify` | **PASS** — format, lint, typecheck, database-runner 13 pass/2 platform skips, backup-archive 3/3, contracts 306/306, performance 3/3, unit 674/674, build, Chromium E2E 21/21 |
| `pnpm verify:db` | **PASS** — clean rebuild through `20260829000100`; 23 pgTAP files / 1869 tests; db lint `{"results":[]}` |
| `pnpm verify:auth` | **PASS** — isolated auth, target selection, overlay persistence, reload, refresh, and sign-out |
| focused C4 suite | **PASS** — 4 files / 70 tests |
| `pnpm verify:backup` | **NOT RUN** — backup/storage behavior did not change; both archive tests in `pnpm verify` and the database rebuild did run |

This post-handoff audit supersedes the original verification counts for the reviewed C4 tree.

Verification is compositional at the process boundary: pgTAP exercises the real Sessions/Evidence
owner queries and bundle loader, while TypeScript tests exercise that source shape through the real
normalizer, pure engine, and dispatcher. The existing SQL worker test still constructs its
normalized input explicitly; there is not yet one test process that crosses PostgreSQL → TypeScript
→ PostgreSQL with completed history. The report does not treat that missing cross-runtime harness as
executed coverage.

### Environment changes made during the session

These were needed to run any gate at all and are outside the repository:

- the repo-root `node_modules` was a symlink into
  `.codex-worktrees/phase1-auth-target-selection/node_modules` holding a **Windows** pnpm install
  (`@rolldown/binding-win32-x64-msvc`, `@next/swc-win32-x64-msvc`). Only the symlink was removed —
  the Codex worktree's directory is intact — and `pnpm install --frozen-lockfile` produced a Linux
  install. **Windows Codex sessions must re-run `pnpm install` before using this checkout.**
- Node 24.14.1 was below `jsdom@30.0.1`'s `^24.15.0` engine floor; Node 24.20.0 was installed under
  `~/.n` via `n`. Add `~/.n/bin` to `PATH`.
- Playwright's cached browser was build 1228 while `@playwright/test` 1.62.1 requires 1234;
  `pnpm test:e2e:install` downloaded 1234. The required system libraries were then installed and
  both browser gates passed.

## 7. Git state at handoff and review

- Branch: `claude/c4-meaningful-work`, created from `main` at `85c07db`.
- Implementation commit: `72def41` — "feat: derive meaningful completed work from owner sources".
- This report: committed separately on the same branch.
- Push status at Claude handoff: **not pushed.** The feature branch was left for explicit review
  and integration.
- Codex integration decision: approved only after the corrective audit and all final Windows gates
  above passed. The corrective review was committed as `9c76f5f`, fast-forwarded to `main`, and
  pushed to `origin/main`.

## 8. Remaining work

C5 was subsequently implemented as a pure, versioned Mastery classifier over privacy-minimized
Mastery source state and exact direct blocking Catalog edges. Its current implementation,
verification, and limits are recorded in
[`CODEX_C5_HANDOFF_REPORT.md`](CODEX_C5_HANDOFF_REPORT.md).

The next bounded outcome is **C6** — the live `TodayWorkspaceV1` read boundary and opaque
action-selection resolver — before any `/today` UI.

Known risks and limits, all recorded in the policy document §9:

- counted duration is bounded by the user's self-reported planned minutes, not a measured attention
  signal;
- `EVIDENCE_BEARING` does not yet weigh outcome, engagement, independence, or source reliability;
- repetition counts sessions, not distinct calendar days;
- the 500-session window bound needs a continuation contract before it can be raised.

## 9. Codex resume prompt

```text
Continue PANDO Phase 4A from current main after C5.

C4 and C5 are done. Read, in order:
  docs/README.md
  docs/implementation/PHASE_4A_PLANNING_TODAY_STATUS.md
  docs/design/PHASE_4A_PLANNING_TODAY.md
  src/modules/planning/README.md
  docs/implementation/CODEX_C5_HANDOFF_REPORT.md

Resume at C6: implement the live Today query boundary and opaque selection resolver/coordinator.
Expose only schema-valid Today data and opaque action tokens; the browser must not receive internal
candidate authority or write Planning tables. Preserve last-known-safe/pending/error semantics,
workspace isolation, inclusive validity, and the ordinary command boundary. Do not start the
`/today` UI until the read contract and database security tests are complete.
```
