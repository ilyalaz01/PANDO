# PANDO agent instructions

## Read before acting

For every new task:

1. Read docs/README.md completely.
2. Follow its canonical reading order for any product or architecture change.
3. Read docs/PHASE_0_TECHNICAL_BASELINE.md and only the ADRs or policies relevant to the task.
4. Stop and report any conflict. Do not silently reinterpret product semantics.

The nine canonical documents outrank supporting ADRs. A superseding ADR is required before changing an accepted hard-to-reverse technical decision.

## Repository orientation

- When `graphify-out/graph.json` exists, use the project `graphify` skill and a bounded graph query before broad searches for architecture, dependency paths, or cross-file impact.
- Treat Graphify as a regenerable repository index. Verify decisive claims in authoritative source files before editing.
- Never confuse Graphify with the competency DAG, GraphProjectionV1, AgentControlContextV1, authorization, or live user state.
- Do not install Graphify hooks, change its pinned version, use remote semantic backends, or broaden `.graphifyignore` without explicit approval and review.

## Product control safety

- For a live PANDO explanation or plan change, use the `pando-control` skill and authenticated PANDO tools.
- Never change live goals, campaigns, tracks, evidence, mastery, readiness, or reviews by editing repository files, exports, fixtures, SQL, or Graphify output.
- Reads use the compact control summary first and expand only relevant detail.
- Writes follow preview → exact confirmation → idempotent apply through the ordinary command boundary.
- Preserve history with pause, resume, complete, end, cancel, archive, or supersede. Agent-facing destructive deletion is not an MVP operation.
- If live tools are unavailable, say that no product state was changed.

## Delivery rules

- Work on one clearly named outcome per task.
- Preserve bounded-context ownership. Cross-module writes use commands and versioned events.
- Keep domain and calculation code pure and independent of Next.js, Supabase, browser state, time, network, and environment variables.
- SQL migrations are the only database schema source. Do not add an ORM in Phase 0.
- Browser code must not write authoritative domain tables directly.
- Every workspace-owned table needs grants, RLS, positive isolation tests, and negative isolation tests.
- Every state-changing command needs idempotency and atomic state plus outbox behavior.
- Never place secrets, tokens, personal evidence, Preparation Pack bodies, or production exports in Git or logs.
- Use pnpm and commit the lockfile. Do not switch package managers.
- Add production dependencies only when the current outcome needs them and document the reason.

## Verification

- Run the narrowest relevant checks while iterating and the repository verification command before handoff.
- Security-critical command, RLS, outbox, evidence, and calculation changes require invariant or property tests, not line coverage alone.
- UI changes require keyboard, responsive, reduced-motion, and automated accessibility checks.
- Graph changes require stable-layout and representative performance fixtures.
- Contract changes require versioned valid, invalid, boundary, and malicious fixtures.

## Multi-agent work

- Use subagents for independent read-heavy exploration, security review, test-gap review, and documentation verification.
- Keep the main task responsible for decisions and integration.
- Do not let parallel agents edit overlapping files.
- Use separate Git worktrees and branches for write-heavy outcomes that run in parallel.
- Return concise evidence-backed summaries to the main task.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
