# PANDO — Claude Code project handoff

This file is the repository-level operating contract for Claude Code. Read it completely before
planning or changing anything. It complements `AGENTS.md`; neither file overrides the canonical
product documents.

## Mission

Continue PANDO as a small, dependable, evidence-first learning and planning product. Prefer one
complete, useful vertical increment over broad scaffolding. Do not add code merely to make the
repository look busy.

The project owner is temporarily handing implementation from Codex to Claude Code. Work as the
only writer in this worktree and leave a precise report so Codex can continue later without
reconstructing your reasoning.

## Mandatory startup sequence

Before making a plan or editing a file:

1. Run `git status --short --branch` and `git log -8 --oneline --decorate`.
2. Read `docs/README.md` completely.
3. Follow the full canonical reading order in that file for any product-semantic, architecture,
   ownership, cross-context, or multi-route change. The canonical set is `docs/README.md`,
   `docs/00_PRODUCT_CONSTITUTION.md` through `docs/06_PROMPT_LIBRARY_UX.md`, then
   `SOFTWARE_PROJECT_GUIDELINES.md`.
4. Read `docs/PHASE_0_TECHNICAL_BASELINE.md` and `docs/design/MODULE_TOPOLOGY.md`.
5. Read `docs/implementation/PHASE_4A_PLANNING_TODAY_STATUS.md`,
   `docs/design/PHASE_4A_PLANNING_TODAY.md`, `docs/policies/PLANNING_POLICY_V0.1.md`, and
   `src/modules/planning/README.md` before continuing Phase 4A.
6. Use the task-oriented route in `docs/design/MODULE_TOPOLOGY.md` and read every decisive owner
   contract, ADR, policy, schema, migration, and test before editing that route.
7. When `graphify-out/graph.json` exists and the reviewed `graphifyy==0.9.50` command is available,
   use a bounded Graphify query for orientation. Verify every decisive claim in authoritative
   source files. Do not install hooks, upgrade Graphify, enable remote semantic extraction, or
   treat its output as live product state.
8. Compare the status documents with the actual implementation and tests. Supporting status prose
   can lag behind code. Do not infer completion from prose alone.

If canonical documents conflict, stop implementation and record the conflict. Do not silently
reinterpret product semantics.

## Current position

At handoff creation, the code baseline before this instruction file was commit `00ffaca` on `main`,
matching `origin/main`. Recheck this instead of assuming it remains true.

Human roadmap position:

- A — foundation, authentication, workspace, target selection, Explore Map/Outline: complete.
- B — Focus, manual evidence, Mastery, Review, and Target Readiness: complete.
- C1 — pure deterministic Planning engine and policy: complete.
- C2 — Growth Plan, Learning Track, candidate, snapshot, and current-pointer persistence: complete.
- C3 — snapshot worker, exact owner reads, fixed source-event routing, recovery, and quarantine:
  complete.
- C4 — meaningful completed-work duration and recent-repetition policy/query: next.
- C5 — versioned Mastery prerequisite-satisfaction policy/query: pending.
- C6–C9 — live Today read boundary, `/today`, Today-to-Focus, responsive/accessibility/browser
  acceptance: pending.
- D — plan/capacity/campaign lifecycle and editing: pending.
- E — authenticated ChatGPT Work/Codex control plane: pending.
- F — Preparation Pack browser workflow and Prompt Library UI: pending.
- G — integration and operational hardening: pending.
- H — deployment and release hardening: pending.

The root `README.md` currently contains stale wording that says Planning persistence and its worker
are still pending. The implementation status, migrations, tests, and commits show that they are
implemented; the live Today route is still pending. Correct that sentence only in a focused docs
commit or alongside an accurately completed Phase 4A status update.

## Current bounded outcome: C4 meaningful completed work

Finish C4 before starting C5 or Today UI. The present worker intentionally fails with
`UNSUPPORTED_MEANINGFUL_WORK_HISTORY` when the current workspace-local week contains terminal
Focus sessions. This safety gate must remain until a reviewed, versioned policy and owner-scoped
query replace it.

Required outcome:

- define a small, explicit, versioned policy for what counts as completed meaningful minutes and
  how recent candidate repetition is counted;
- preserve the canonical evidence boundary: raw provider events and session lifecycle events are
  not evidence;
- obtain source facts through bounded Sessions/Evidence owner queries; Planning must not read
  another module's private tables or import its infrastructure;
- use the same explicit `claimAsOf` and workspace-local week semantics as the existing Planning
  attempt;
- populate `completedMinutesThisWeek`, per-track consumption where supported, and
  `repetitionsInLast7Days` without fabricating values;
- remove `UNSUPPORTED_MEANINGFUL_WORK_HISTORY` only for the exact history now supported by the
  policy; keep unsupported or ambiguous states fail-closed;
- preserve source revisions/fences, canonical input fingerprinting, deterministic replay,
  idempotency, RLS isolation, and atomic outbox behavior;
- add boundary, invalid, malicious, invariant/property, database, and worker-path tests appropriate
  to the changed contracts;
- update the Phase 4A status and runbook only when the executable behavior genuinely changed.

Never substitute planned duration for completed work. Never count naive page-open time or raw
wall-clock elapsed time without a reviewed rule. Never mutate evidence, snapshots, pointers,
fixtures, exports, or Graphify output to make the worker pass.

The exact technical shape is yours to decide after reading the owner models. If no accepted policy
defines the semantic threshold or evidence relationship, record a focused supporting policy/design
increment before implementing it. Do not alter a canonical product rule without the required
review/superseding ADR.

After C4 is complete, verified, and committed, continue sequentially with C5 and then C6. Use a
separate plan item and commit for each outcome. Do not begin `/today` UI while the live Today query
and opaque action-selection boundary are absent.

## Architecture and safety rules

- Preserve bounded-context ownership. Cross-context interactions are only owning commands, bounded
  queries, versioned events, or read-only projection composition.
- Domain and calculation code stays pure: no Next.js, Supabase, browser state, environment,
  network, or implicit clock dependencies.
- SQL migrations are the database schema source. Do not add an ORM.
- Browser code never writes authoritative domain tables directly.
- Every workspace-owned table needs grants, forced RLS, positive isolation tests, and negative
  cross-workspace tests.
- Every state-changing command needs idempotency and atomic state + receipt + outbox behavior.
- Preserve immutable evidence and calculation history. Corrections are append-only.
- Never use repository files, fixtures, SQL edits, exports, or Graphify as live user-state
  mutation.
- Do not add production dependencies unless the bounded outcome genuinely requires one. Use pnpm
  and commit `pnpm-lock.yaml` when a legitimate dependency changes.
- Do not expose coordinators, internal schemas, secrets, service-role keys, personal data, evidence
  bodies, Preparation Packs, or production exports.
- For Next.js work, read the relevant installed guide under `node_modules/next/dist/docs/` before
  coding; this repository's Next.js version has breaking changes.
- Preserve unrelated user changes. Never use `git reset --hard`, broad checkout/restore, mass
  formatting, or destructive cleanup.

## Git and multi-agent protocol

There must be only one writer in this worktree.

- The user should stop Codex before starting Claude Code here.
- Do not run Claude and Codex concurrently in this same folder, even if they appear to edit
  different files: they share the working tree, Git index, generated files, ports, and test state.
- If another agent must work in parallel, use a separate Git worktree and a separate branch with
  disjoint file ownership. Do not let agents edit overlapping migrations, contracts, generated
  types, status documents, or the lockfile.
- At startup, if the worktree has unexpected changes, inspect them and stop before overwriting
  anything. Treat them as user-owned unless provenance is certain.
- Work on one clearly named outcome at a time. Prefer a branch such as
  `claude/c4-meaningful-work`; do not switch or rewrite another agent's branch.
- Make focused commits. Do not squash or rewrite existing history.
- The owner has previously allowed a push to `origin/main` after all required checks pass. Do not
  force-push. Do not deploy, change hosted secrets, run production SQL, or mutate live services
  without a separate explicit instruction and verified target.

Sequential use of Codex and Claude is safe. `AGENTS.md` and `CLAUDE.md` can coexist; the practical
conflict comes from simultaneous writes, Git operations, generated files, servers, or database
test stacks in one worktree.

## Verification discipline

While iterating, run the narrowest relevant unit, contract, and database checks. Before handing
off a completed outcome, run the repository gates proportionate to risk:

```text
pnpm verify
pnpm verify:db
pnpm verify:auth
```

Run `pnpm verify:backup` when backup/storage behavior changes, and `pnpm verify:phase0` when the
aggregate Phase 0 gate is materially affected. Database gates require Docker. Never report a check
as passed unless you actually ran it and saw success. Record exact commands, results, and any
skipped checks.

Security-critical command, RLS, outbox, evidence, and calculation work requires invariant or
property tests, not only line coverage. Contract changes require versioned valid, invalid,
boundary, and malicious fixtures. UI changes require keyboard, responsive, reduced-motion, and
automated accessibility coverage.

## Stop conditions

Stop and explain instead of guessing when:

- canonical sources conflict;
- ownership or interaction form is unclear after following the topology route;
- a migration would delete/rewrite authoritative history;
- credentials, hosted configuration, production SQL, deployment, or external paid services are
  required;
- unexpected worktree changes overlap the outcome;
- a failing gate indicates an unrelated regression that cannot be safely isolated;
- completion requires changing a hard-to-reverse accepted decision without a superseding ADR.

## Mandatory handoff report

Before ending the Claude Code session, create or replace
`docs/implementation/CLAUDE_CODE_HANDOFF_REPORT.md`. It must be factual and concise, with these
sections:

1. `Outcome attempted` — exact bounded outcome and whether it is complete, partial, or blocked.
2. `User-visible result` — what changed from the user's perspective.
3. `Architecture and policy decisions` — decisions plus authoritative file references.
4. `Files and migrations changed` — grouped by purpose.
5. `Contracts and invariants` — versions, ownership, security, idempotency, and failure behavior.
6. `Verification` — every command actually run and its exact pass/fail/skip result.
7. `Git state` — branch, implementation commits, push status, and final `git status --short`.
8. `Remaining work` — concrete next bounded outcome, known risks, and blockers.
9. `Codex resume prompt` — a short copy/paste instruction telling Codex which files to read and
   exactly where to resume.

Run formatting/checks that include the report, commit it, and leave the working tree clean whenever
possible. Never hide a failure or mark an incomplete phase complete.

## Copy/paste startup prompt for the owner

The owner can start Claude Code in the repository root and send:

```text
Прочитай CLAUDE.md полностью и выполни Mandatory startup sequence. Затем продолжай PANDO только с
Current bounded outcome, сверяя решения с каноническими документами и реальным кодом. Работай
поэтапно, проверяй каждый инкремент и не переходи к следующему outcome, пока текущий не завершён и
не закоммичен. Перед остановкой создай docs/implementation/CLAUDE_CODE_HANDOFF_REPORT.md по шаблону
из CLAUDE.md и оставь понятное состояние Git для продолжения Codex.
```
