# Claude Code handoff report

Session date: 2026-08-28
Agent: Claude Code (Opus 5)
Branch: `claude/c4-meaningful-work`

## 1. Outcome attempted

Phase 4A **C4 — meaningful completed work**, as defined in `CLAUDE.md` under "Current bounded
outcome". Status: **complete and verified** — every gate proportionate to the change was run and
passed (§6).

The bounded outcome was to replace the blanket `UNSUPPORTED_MEANINGFUL_WORK_HISTORY` safety gate with
a reviewed, versioned policy for completed meaningful minutes and recent candidate repetition, fed by
bounded Sessions/Evidence owner queries, without fabricating any value.

C5 (Mastery prerequisite satisfaction) and C6 (live Today read boundary) were **not** started.

## 2. User-visible result

No UI changed; `/today` still does not exist. The user-visible consequence is that Planning no longer
refuses to publish a snapshot for a workspace that has completed Focus history in the current week.
A workspace that has finished at least one Focus activity now gets a real snapshot whose
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
`oldestCountedRepetitionEndedAt + 168h − 1ms`, and each candidate carries the exclusive
`repetitionWindowEndsAt` so the **pure engine verifies the cap** rather than trusting the adapter.
It is null exactly when no repetition is counted.

### 3.5 Ownership boundary

Planning gained **no** Sessions or Evidence table grant. Two bounded owner queries were added, both
receiving the attempt's single persisted `claimAsOf`:

- `sessions.read_planning_completed_work_source_v1` — terminal Focus duration facts inside
  `[least(weekStart, claimAsOf − 168h), claimAsOf]`, owned by `pando_phase2_planning_source`;
- `evidence.read_planning_completed_work_source_v1` — **two booleans per session** (`attemptTerminal`,
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
- `EVIDENCE`/`workspace-ledger` — `evidence.subject_ledgers.ledger_version`, which advances on both
  observation append and invalidation, so a correction always invalidates a stale snapshot.

`EVIDENCE` was added to the `sourceRevision.owner` enum and the engine now requires it
unconditionally alongside `FOCUS` and `REVIEW`.

`sessions.read_planning_focus_source_v1` no longer publishes `terminalCount`; the completed-work
source is the authoritative terminal-session boundary and is bounded by the same claim clock.

## 4. Files and migrations changed

### New

- `docs/policies/PLANNING_COMPLETED_WORK_POLICY_V0.1.md` — the versioned policy.
- `supabase/migrations/20260828000425_phase4a_planning_completed_work_sources.sql` — additive: new
  `pando_evidence_planning_source` role, read-only grants and RLS policies on the four Evidence
  tables, two new owner queries, `create or replace` of `sessions.read_planning_focus_source_v1`
  (drops `terminalCount`) and `planning.load_plan_snapshot_source_bundle_v1` (adds `completedWork`
  and `evidence`, computes the 168-hour window).
- `supabase/tests/database/023_phase4a_planning_completed_work.test.sql` — pgTAP.

### Contract

- `schemas/planning/v1/planning-input.schema.json` — `completedWorkPolicyVersion`, `EVIDENCE` owner,
  `repetitionWindowEndsAt`.
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

Every command below was actually executed on this branch's final tree. Node 24.20.0, pnpm 11.19.0,
WSL2 Linux.

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
  `pnpm test:e2e:install` downloaded 1234. Its system libraries remain missing.

## 7. Git state

- Branch: `claude/c4-meaningful-work`, created from `main` at `85c07db`.
- Implementation commit: `72def41` — "feat: derive meaningful completed work from owner sources".
- This report: committed separately on the same branch.
- Push status: **not pushed.** All required checks now pass, so a push to `origin/main` is
  permitted, but merging and pushing is left as the owner's explicit decision.
- Final `git status --short`: clean.

## 8. Remaining work

Next bounded outcome is **C5 — versioned Mastery prerequisite-satisfaction policy**. Candidates with
any blocking prerequisite edge are still normalized to `prerequisiteState: "UNKNOWN"` in
`assemble-plan-snapshot-input.ts`, which costs them the `PREREQUISITE_UNKNOWN` penalty and raises a
warning. A reviewed policy plus a bounded Mastery owner query should resolve `SATISFIED` / `BLOCKED`.
Do not infer satisfaction from a Mastery level without that policy.

Then **C6** — live `TodayWorkspaceV1` query and the opaque action-selection resolver — before any
`/today` UI.

Known risks and limits, all recorded in the policy document §9:

- counted duration is bounded by the user's self-reported planned minutes, not a measured attention
  signal;
- `EVIDENCE_BEARING` does not yet weigh outcome, engagement, independence, or source reliability;
- repetition counts sessions, not distinct calendar days;
- the 500-session window bound needs a continuation contract before it can be raised.

## 9. Codex resume prompt

```text
Continue PANDO Phase 4A on branch claude/c4-meaningful-work (or after merging it to main).

C4 (meaningful completed work) is done. Read, in order:
  docs/policies/PLANNING_COMPLETED_WORK_POLICY_V0.1.md
  docs/implementation/PHASE_4A_PLANNING_TODAY_STATUS.md
  src/modules/planning/README.md
  supabase/migrations/20260828000425_phase4a_planning_completed_work_sources.sql
  src/modules/planning/application/assemble-plan-snapshot-input.ts

Resume at C5: the versioned Mastery prerequisite-satisfaction policy. The exact place to change is
the prerequisiteState line in assemble-plan-snapshot-input.ts, which currently maps any blocking
prerequisite edge to UNKNOWN. Add a bounded Mastery owner query beside
mastery.read_planning_mastery_source_v1 and a versioned policy document, following the same shape
C4 used: policy version carried in the calculation input so it enters the canonical fingerprint,
owner-scoped query with its own revision fence, engine-verifiable invariants, and fail-closed
handling for anything the policy cannot classify. Do not start C6 or /today before C5 is committed.
```
