# Codex D2c to Claude Code handoff

Date: 2026-09-03

## Safe starting point

Codex completed Phase 4B D2c, including the V2 Planning calculation activation, authenticated
weekly-cadence editing, historical V1 compatibility, concurrency coverage, and the Windows release
gates. The intended starting point for Claude is a clean, pushed `main` containing the D2c commits.

At startup, do not trust this prose by itself. Run:

```text
git status --short --branch
git log -8 --oneline --decorate
git fetch origin
git rev-parse main
git rev-parse origin/main
```

If `main` and `origin/main` differ, or the worktree contains changes other than the owner's known
files, inspect and explain the difference before editing. Never overwrite or commit
`docs/DAILY_PACE_AUTOREPLAN_AGENT_PROMPT.md` unless the owner separately asks for that file.

## Required reading

Read `AGENTS.md` and `CLAUDE.md` completely, then perform the `Mandatory startup sequence` in
`CLAUDE.md`. The next work changes cross-context product semantics, so read all nine canonical
documents in the exact order from `docs/README.md`, followed by:

1. `docs/PHASE_0_TECHNICAL_BASELINE.md`
2. `docs/design/MODULE_TOPOLOGY.md`
3. `docs/design/PHASE_4B_LIFECYCLE_COMMANDS.md`
4. `docs/implementation/PHASE_4B_LIFECYCLE_COMMANDS_STATUS.md`
5. `docs/design/PHASE_4B_D2C_LEARNING_TRACK_CADENCE.md`
6. `docs/implementation/PHASE_4B_D2C_LEARNING_TRACK_CADENCE_STATUS.md`
7. `src/modules/planning/README.md`

Use Graphify only as the regenerable repository orientation index described by the project skill;
verify decisions in authoritative files. It is never live PANDO state or authorization.

## Verified D2c baseline

The final Codex tree passed on Windows:

- `pnpm verify`: 392 contract tests, 3 performance tests, 944 unit tests, production build, and
  36 Chromium E2E tests; database-runner had 13 passes and 2 documented Windows platform skips;
- `pnpm verify:db`: clean migration rebuild, 47 pgTAP files and 2972 assertions, database lint with
  no findings;
- `pnpm verify:auth`: authenticated target, Plan, activity, cadence, worker, Today/Focus, reload,
  refresh, and sign-out journey;
- `pnpm verify:backup`: encrypted backup and clean restore.

One regression is especially important: a failed calculation blocks cadence progress at the
current pointer frontier, but a later successful V2 snapshot restores `CURRENT` without deleting
the historical uncovered dead letter. Do not weaken that audit/recovery behavior.

## Ordered continuation

Work on one bounded outcome at a time. Finish, verify, document, and commit each outcome before
starting the next.

1. **D3–D5 lifecycle ADR only.** Resolve every open decision in
   `docs/design/PHASE_4B_LIFECYCLE_COMMANDS.md` §10. Do not change production code or schema in this
   outcome. The owner has delegated unresolved technical choices, but the ADR may not contradict
   canonical product semantics or bounded-context ownership.
2. **D3 availability and Growth Plan replacement.** Only after the ADR is internally consistent,
   accepted, and committed. Implement the smallest complete Planning-owned vertical slice with
   preview/confirmation, versions, RLS, idempotency, atomic outbox, UI parity, failure states, and
   relevant Windows gates. Do not silently copy Tracks into a replacement Plan.
3. **D4 Targets Campaign foundation.** Start only after D3 is complete and green. Keep Targets as
   owner of Campaign, Goal, deadline, and immutable profile references. Do not add Planning
   allocation overrides yet.
4. **D5 Campaign overlays and atomic lifecycle coordination.** Start only after D4 is complete and
   green. Preserve the owner-command boundary and prove cancellation restores base allocation while
   retaining evidence and history.

Do not jump to Agent Control transport, Preparation Packs, or broad UI polish while an earlier
outcome is incomplete. If time remains after D5, first update `CLAUDE.md` and the implementation
status with the real repository state, then design the smallest E1 outcome before coding it.

## Working and Git rules

- Claude Code must be the only writer in this checkout. Codex should be stopped.
- Create a `claude/<outcome>` branch from the verified `main` for each write-heavy outcome.
- Keep commits focused and never rewrite existing history or force-push.
- Use explicit file lists when staging; do not stage unrelated/untracked owner files.
- A completed outcome may be fast-forwarded to `main` and pushed to `origin/main` only after every
  required gate passes. Never deploy, change hosted secrets, or run production SQL without a new
  explicit instruction.
- If Docker Desktop fails, record the environment error accurately. Do not call an unexecuted gate
  passed and do not weaken tests to accommodate the machine.

## Mandatory report for Codex

Continuously maintain `docs/implementation/CLAUDE_CODE_HANDOFF_REPORT.md` so an interruption does not
erase the handoff. Before ending, make it a comprehensive factual report using all nine sections
required by `CLAUDE.md`: outcome, user-visible result, decisions and authority, files/migrations,
contracts/invariants, exact verification, Git state, remaining work, and a copy/paste Codex resume
prompt.

For every completed outcome, include its branch and commit hashes, whether it was merged/pushed,
all test counts, skipped or failed checks, migration/rollback implications, security/privacy impact,
and known limitations. Run formatting/checks that include the final report and commit it. Leave the
worktree clean when possible.
