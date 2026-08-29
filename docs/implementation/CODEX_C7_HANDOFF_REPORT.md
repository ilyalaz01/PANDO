# Codex C7–C9 handoff report

Date: 2026-08-29

Branch: `codex/c7-today-page`

Outcome: live Today page, selection-to-Focus journey, and authenticated responsive/accessibility
acceptance

## Result

C7–C9 are complete. An authenticated user can open `/today`, see an explicit Planning freshness
state, understand a current recommendation and its bounded alternatives, open the exact action by
opaque selector, start or resume its attributed Focus session, reload without losing continuity,
complete the session, and return to a recalculating Today view. A stale selector cannot reopen or
mutate completed work.

No browser code receives the Planning action authority tuple or writes authoritative tables. The
manual UI uses the same authenticated command boundaries intended for later Agent Control clients.

## Delivered boundary

- `/today` is dynamic and server-rendered from the zero-argument `get_today_workspace_v1()` adapter.
- `NOT_STARTED`, `PENDING`, `ERROR`, and `CURRENT` have distinct UI. Degraded snapshots are
  display-only and contain no Start/Resume affordance.
- Current actions are correlated to selections by array position, rank, candidate key, and unique
  selector before a link is rendered.
- Focus receives only `selection=plan-action:<uuid>`. Resolution remains backend-only.
- START has exact post-command/reload continuity for its still-active attributed session. RESUME
  requires the current snapshot and exact active session. Historical or stale RESUME is refused.
- Completion and stop return to the fixed `/today` route from the server action, before the old
  selector route can be invalidated by the command.
- Today navigation is present on the authenticated core surfaces, and successful sign-in opens
  Today by default.

## Integration defects found and corrected

The authenticated journey was deliberately run against a fresh migrated stack rather than inferred
from separate unit and SQL tests. It exposed four contract seams:

1. Targets stores a richer readiness blocker than Planning accepts. A Targets-owned adapter now
   emits only `{code, ruleKey}` and drops interval detail.
2. JavaScript `Date` truncated the Planning worker's PostgreSQL microsecond claim clock. The
   normalized input and calculated result now preserve sub-millisecond provenance while ordinary
   instants remain canonical.
3. Today compared equivalent `Z` and `+00:00` timestamps as strings. Its semantic boundary now
   compares exact instants without hiding microsecond drift.
4. Client-side navigation after planned Focus completion could lose a race with selector
   invalidation. The successful server action now performs the fixed safe redirect outside its
   error boundary.

Each issue has a focused regression test in addition to the end-to-end proof.

## Security and ownership evidence

- The new Planning selector read function executes only for the dedicated Phase 2 API role and
  delegates Focus workspace facts through the existing owner boundary.
- Browser input remains an opaque selector; workspace, snapshot, candidate, track, goal, activity,
  session, duration, and attribution authority are derived server-side.
- Current START, exact active-session continuity, current RESUME, stale refusal, cross-workspace
  refusal, expiry, and 500-session bounded refusal are covered in pgTAP.
- The readiness adapter remains Targets-owned and adds no Planning table grant.
- No production dependency or lockfile change was required.

## Verification on Windows

- `pnpm format:check` — pass.
- `pnpm lint` — pass.
- `pnpm typecheck` — pass.
- `pnpm test:unit` — 75 files, 727 tests passed.
- `pnpm verify` — pass, including 307 contract tests, 3 performance tests, 727 coverage tests,
  production build, and 21/21 Chromium tests; coverage is 88.31% statements and 81.32% branches.
- `pnpm verify:db` — pass from a clean database: 25 pgTAP files, 1957 tests, database lint clean.
- `pnpm verify:auth` — pass against a disposable migrated Supabase stack and production Next.js
  server, including Today error/pending/current/degraded states, planned Start/Resume/reload,
  completion/stale/recalculation, 320/390 layouts, reduced motion, forced colors, Axe, and sign-out.
- `pnpm verify:backup` — pass, including encrypted backup and clean restore of the migrated schema.

The final commit and push hashes are intentionally not prewritten here; Git remains the authority.

## Next bounded outcome

Begin D0: write the accepted Phase 4B lifecycle/editing implementation design before adding another
public mutation. It must settle aggregate transitions, expected-version fences, idempotency,
atomic state/receipt/outbox behavior, deterministic before/after preview, and the order of Growth
Plan, Learning Track, capacity/cadence, and Campaign slices. The first implementation outcome should
be small enough to prove through both the manual UI and the future Agent Control command surface.
