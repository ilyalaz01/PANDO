# PANDO — GPT-6 mid-project architecture audit brief

Status: ready for an independent audit

Prepared: 2026-09-05

Baseline at preparation: `main` / `origin/main` at `c2c54ffe97fb7d491b75b19c33f01531fe0767d4`

## Purpose

Perform an evidence-backed mid-project audit before the next implementation lane begins. PANDO is
already a substantial working system; this is not permission to redesign it for novelty or to
discard completed work. The audit should determine whether the implemented system still serves the
intended user experience, whether D3-D5 are correct and safely integrated, and what the highest-value
next outcome should be.

PANDO's intended experience is a durable personal learning and planning system with two equivalent
control surfaces:

- a responsive web UI for direct manual control; and
- a compact, safe ChatGPT Work/Codex text or voice control plane that can understand a short change
  of intent, explain the current plan, preview exact consequences, obtain confirmation, and apply
  the same ordinary domain commands as the UI.

The product is evidence-first. It preserves history, represents unknown knowledge honestly, and
keeps AI advisory rather than authoritative. A cancelled interview, changed university, new career
direction, or three-month deadline must replan affected work without silently deleting unrelated
goals, evidence, or completed history.

## Working mode and authority

1. Start read-only. Build the product and implementation model before proposing changes.
2. Treat the nine canonical documents as authoritative. If they conflict, stop implementation and
   report the conflict; do not silently reinterpret semantics.
3. Verify statements in this brief, status reports, and handoff reports against source, migrations,
   tests, and Git history. They are hypotheses and navigation aids, not authority.
4. Do not begin the next feature lane during this audit.
5. Prefer preserving the existing modular-monolith, bounded-context, append-only, and
   expand-then-activate foundations. Recommend a replacement only when concrete evidence shows that
   an incremental correction cannot meet the product outcome.
6. You may correct factual documentation drift and write the audit report. A small P0/P1 fix is
   allowed only if its necessity is established by the audit, it is safely bounded, and all relevant
   gates can be run. Larger code, schema, technology, or product changes belong in the report and an
   ADR/implementation plan, not in this audit task.
7. Do not deploy, mutate hosted services, run production SQL, rewrite history, force-push, or touch
   unrelated user changes.
8. At preparation time the main checkout had a user-owned `.gitignore` modification adding
   `.aider*`. Do not modify, stage, discard, or attribute it to the audit. Recheck actual state.

## Mandatory reading order

Read files completely unless a section is explicitly described as a targeted source review.

1. `AGENTS.md`.
2. `docs/README.md`, then its complete canonical order:
   - `docs/00_PRODUCT_CONSTITUTION.md`
   - `docs/01_DOMAIN_MODEL.md`
   - `docs/02_PRODUCT_AND_UX_SPEC.md`
   - `docs/03_SYSTEM_ARCHITECTURE.md`
   - `docs/04_MVP_DELIVERY_PLAN.md`
   - `docs/05_EXTERNAL_AI_PREPARATION_PACK.md`
   - `docs/06_PROMPT_LIBRARY_UX.md`
   - `SOFTWARE_PROJECT_GUIDELINES.md`
3. `docs/PHASE_0_TECHNICAL_BASELINE.md` and `docs/design/MODULE_TOPOLOGY.md`.
4. The decisive cross-context decisions:
   - `docs/adr/0008-agent-control-plane.md`
   - `docs/adr/0009-module-topology-and-projection-ownership.md`
   - `docs/adr/0010-lifecycle-replacement-availability-and-campaign-semantics.md`
   - `docs/design/PHASE_4B_LIFECYCLE_COMMANDS.md`
5. Phase 4B implementation evidence:
   - `docs/implementation/PHASE_4B_LIFECYCLE_COMMANDS_STATUS.md`
   - `docs/implementation/PHASE_4B_D3A_GROWTH_PLAN_REPLACEMENT_STATUS.md`
   - `docs/implementation/PHASE_4B_D3B_STATUS.md`
   - `docs/implementation/PHASE_4B_D3B1_AVAILABILITY_WINDOWS_STATUS.md`
   - `docs/implementation/PHASE_4B_D3B2_ENGINE_STATUS.md`
   - `docs/implementation/PHASE_4B_D3B2_ROLLOUT_STATUS.md`
   - `docs/implementation/PHASE_4B_D4_CAMPAIGNS_STATUS.md`
   - `docs/implementation/PHASE_4B_D5_ALLOCATIONS_STATUS.md`
   - `docs/implementation/CLAUDE_CODE_HANDOFF_REPORT.md`
6. Owner boundaries:
   - `src/modules/planning/README.md`
   - `src/modules/targets/README.md`
   - `src/modules/agent-control/README.md`
   - every policy, schema, migration, API adapter, UI route, and test decisive for a finding.

`CLAUDE.md` is useful history, but its roadmap and current-outcome section were stale at preparation
time and still described D3-D5 as pending. Do not let it override current Git evidence or canonical
documents. Also verify suspected status drift in `README.md`, `docs/README.md`, and
`docs/implementation/PHASE_4B_LIFECYCLE_COMMANDS_STATUS.md`.

Use the project `graphify` skill and a bounded query when `graphify-out/graph.json` and the reviewed
tool are available. Graphify was not executable in the preparing Windows session, so do not install
or upgrade it merely for this audit. It is only a repository index; verify every decisive claim in
authoritative files and never treat it as product state or authorization.

## Efficient source and history review

Do not read all changed files linearly. First inspect:

```text
git status --short --branch
git log --oneline --decorate --graph -40
git diff --stat 9949dd9..HEAD
git diff --name-status 9949dd9..HEAD
```

Then trace the relevant code paths from the owner contracts and migrations. D3-D5 span commits from
the D3a/D3b series through `c2c54ff`; use the actual current history rather than assuming commit IDs
remain unchanged.

At minimum inspect:

- migrations `20260905000100_phase4b_availability_windows.sql`,
  `20260906000100_phase4b_d4_interview_campaigns.sql`, and
  `20260907000100_phase4b_d5_campaign_allocation_overrides.sql`;
- the earlier V2 dual-contract and activation migrations to understand the intended rollout model;
- `planning.plan_snapshot_attempts`, source-bundle construction, worker claim/dispatch/completion,
  current-pointer reads, and every calculation-version fence;
- `assemblePlanSnapshotInputV3`, `assemblePlanSnapshotInputV4`, their dispatch branches, V3/V4
  engines and policies, and `planning-semantics.ts`;
- Targets campaign commands, Planning override commands, and
  `agent_control.coordinate_campaign_lifecycle_v1` preview/apply paths;
- `/plan`, `/campaigns`, `/today`, and their authenticated server boundaries;
- pgTAP, contract, unit/property, concurrency, authenticated-browser, accessibility, and regression
  coverage relevant to D3-D5.

## Required audit questions

### Product and user experience

- Can the current architecture actually support the short text/voice control experience described
  above without granting an agent direct database or repository mutation?
- Does manual UI parity exist for every state change the future Agent Control plane will expose?
- Are preview, exact confirmation, idempotent apply, history preservation, and understandable
  consequences consistent across Plan, availability, campaigns, and overrides?
- Are important states implemented but invisible, misleading, or unusable in the current UI?
- Is E (authenticated Agent Control) truly the best next lane, or must a bounded D3-D5 closure occur
  first to avoid building control tools over inactive or contradictory behavior?

### D3-D5 risk hypotheses to prove or refute

1. **V3 and V4 are implemented but inactive.** `planner-engine/0.3.0` and `0.4.0`, input assembly,
   dispatch, contracts, and UI exist, while the database still admits/schedules only
   `planning-calculation/1` and `/2`. Determine the exact migration, source-bundle, rollout,
   compatibility, rollback, and end-to-end proof needed to activate `/3` and `/4` safely.
2. **The availability capacity preview deviates from ADR-0010 section 6.** The current
   `preview_digest` calculation is stateless and recomputed on read rather than a persisted,
   server-issued, single-use, expiring proposal. Decide whether to implement the ADR, supersede it
   with a better and simpler decision, or explicitly separate a display estimate from a command
   preview. Evaluate session size, database complexity, stale-confirmation risk, UX, and cost.
3. **Cross-domain lock ordering needs independent review.** Verify the total order
   `agent_control` -> `targets` -> `planning` in
   `agent_control.coordinate_campaign_lifecycle_v1`, including all direct owner commands that may
   run concurrently. Look for reverse-order acquisition, deadlocks, partial/orphaned overrides,
   receipt replay problems, and failure paths. Do not infer safety solely from comments.
4. **Campaign cardinality appears to violate canon.** `docs/01_DOMAIN_MODEL.md` says an MVP
   workspace has at most one active Interview Campaign, while D4 explicitly records that no
   single-active-campaign constraint was imposed. Assess current database and application behavior,
   concurrent starts, conflicting Track overrides, and the safest forward correction. Do not delete
   historical campaigns.
5. **D3b1 lacks its own native pgTAP proof.** At preparation time database tests ended at 053 and no
   availability-window `.test.sql` proved the Postgres exclusion constraint and owner-command/RLS
   invariants directly. Confirm the gap and specify or implement only the narrowly required proof.
6. **Previously discovered defects may reveal missing test classes.** Independently examine the
   corrected V4 post-deadline snapshot rejection in `planning-semantics.ts`, the D4 deadline-change
   idempotency digest mismatch, and the UI `dismissed-on-open` race. Determine whether each root
   cause now has a durable regression test and whether the same pattern exists elsewhere.

Also review these known compromises: the browser start flow accepts at most one initial override
although the coordinator can accept more; no command attaches a new override to an already-active
campaign; multiple active campaigns can compete for one Track; branch coverage was reported at
80.01%, barely above the configured floor; and D4 retarget history is persisted but not exposed by a
bounded read/UI.

### Whole-system audit

Assess, with concrete evidence:

- canonical consistency, bounded-context ownership, and cross-context interaction forms;
- RLS, grants, workspace isolation, idempotency, atomic state-plus-outbox behavior, version fences,
  immutable history, and malicious/boundary fixtures;
- snapshot freshness, invalidation, worker recovery, quarantine, version coexistence, activation,
  and observability;
- correctness around time zones, DST, exclusive deadlines, overlapping availability, paused plans,
  cancellation, replacement, simultaneous commands, and stale previews;
- accessibility, keyboard/responsive/reduced-motion behavior, comprehensibility, and the shortest
  path to actual single-user usefulness;
- operational simplicity, backup/restore, deployment readiness, dependency and maintenance burden,
  and the owner's approximately USD 10 budget;
- whether the roadmap optimizes for user value rather than accumulating internal machinery.

Explicitly distinguish six states for every major capability: **documented**, **implemented**,
**tested**, **activated in the real worker/data path**, **visible and usable**, and
**production-ready**. A unit-tested dormant engine is not a shipped user outcome.

## Required deliverable

Create `docs/implementation/GPT6_MIDPROJECT_AUDIT_REPORT.md` with:

1. Executive verdict and the three most important actions.
2. Concise product/system understanding.
3. A capability matrix using the six states above, covering at least A-D5 and readiness for E-H.
4. D3, D4, and D5 evidence review, including each hypothesis above marked `confirmed`, `partly
   confirmed`, or `refuted`, with exact source references.
5. Findings ordered by P0/P1/P2/P3. For each: user impact, evidence, root cause, recommendation,
   migration/compatibility risk, and missing proof.
6. Decisions to keep, revise, defer, or remove. Preserve accepted work wherever a forward-compatible
   correction is sufficient.
7. A revised human-readable roadmap with one clearly named next bounded outcome, acceptance
   criteria, required gates, and explicit non-goals.
8. Every file changed during the audit and why.
9. Verification commands actually run with exact results; never convert an environmental skip into
   a pass.
10. Final branch, commit(s), push status, and `git status --short`.
11. A short copy/paste prompt for a fresh implementation task to continue from the accepted audit.

Use exact file-and-line citations in the report. Separate facts from inferences and recommendations.
If the architecture is sound, say so plainly and recommend the smallest valuable closure rather
than manufacturing a redesign.

## Verification and Git handoff

- For a report/documentation-only audit, run targeted Markdown formatting plus repository link or
  documentation checks that exist; record why code/database gates were not rerun.
- If production code or SQL changes, run the narrowest checks while iterating and all risk-relevant
  repository gates before calling the fix complete. SQL/RLS/outbox/concurrency changes require
  `pnpm verify:db`; authenticated boundaries require `pnpm verify:auth`; ordinary code requires
  `pnpm verify`; backup/storage changes require `pnpm verify:backup`.
- Work in an isolated Codex worktree and branch, preferably `codex/gpt6-midproject-audit`.
- Commit the report and any justified audit corrections, but do not merge or push to `main` unless
  the owner explicitly asks after reading the verdict.
- End after the audit deliverable. The next implementation task should start with a clean context
  from the reviewed audit branch or accepted merged commit.
