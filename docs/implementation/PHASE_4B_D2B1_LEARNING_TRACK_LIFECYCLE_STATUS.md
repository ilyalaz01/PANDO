# Phase 4B D2b1 Learning Track lifecycle status

Status: complete

Design: [D2b1 Learning Track pause/resume](../design/PHASE_4B_D2B1_LEARNING_TRACK_LIFECYCLE.md)

Completed: 2026-09-01

## Delivered outcome

A signed-in user can open `/plan`, select one current Learning Track through an opaque
server-returned key, enter a reason, inspect an exact pause or resume preview, and explicitly
confirm the change. Pause preserves every activity and historical result while removing the Track
from active candidate generation. Resume refuses a projected active protected-minimum total above
the parent Plan's capacity; equality remains valid and Planning never clamps either value.

Both transitions remain available while the current parent Growth Plan is active or paused. A
paused parent produces a deterministic warning rather than a blocker: the Track is saved as active,
but Today remains paused until the parent resumes. Completed and archived Tracks are not returned as
D2b1 mutation targets. The compact current read fails closed instead of truncating a persisted
portfolio above 30 active-or-paused Tracks.

## Owner boundary and atomic command

- D1 and D2a contracts retain their released meanings. D2b1 adds separate strict current-read,
  deterministic preview, apply-result, and minimal-event contracts. PostgreSQL aggregate versions
  travel as bounded decimal strings.
- The browser submits only the opaque Track key, operation, exact parent and Track version fences,
  reason, preview digest, and idempotency key. Planning resolves the actor, personal workspace,
  current Plan, Track UUID, siblings, capacity, minima, fingerprints, and projected state.
- TypeScript and PostgreSQL share the ordered, length-prefixed
  `learning-track-lifecycle-preview-digest/1.0.0` protocol. The digest covers both aggregate fences,
  parent and target states, exact constraint summaries and fingerprints, applicability, warning,
  retained-history facts, and the fixed Planning consumer.
- Apply serializes the actor/key and Planning workspace, then locks the current Plan and all child
  Tracks in stable UUID order. It rebuilds the preview, checks both versions and every sibling
  constraint, and changes only the target lifecycle, version, and timestamp.
- The mutation, completed command receipt, one minimal `TRACK_LIFECYCLE_CHANGED` event, and one
  `planning.plan_snapshot_v1` delivery commit atomically. Same-key/same-request replay returns the
  stored response; changed requests, stale Plan/target/sibling state, authorization failures, and
  injected event or delivery failures leave no partial effect.
- Public functions derive authority from the authenticated session. D2b1's private builders and
  validators remain non-executable to browser and service roles, and Planning gains no grant on
  Sessions, Evidence, or another bounded context's owner tables. The older activity-attribution
  helper exception is now closed by the separate
  [owner-boundary hardening outcome](PHASE_4B_ACTIVITY_ADMISSION_OWNER_BOUNDARY_HARDENING_STATUS.md).

## Application and UI

- The server adapter validates structural and semantic contracts before returning the compact
  current portfolio. `/plan` retries one legitimate cross-read interleaving once, then fails closed
  instead of composing mismatched Plan and Track versions.
- Each Track card shows lifecycle, priority, protected minimum, and its one allowed operation. A
  new Plan, capacity, or Track intent removes every older confirmation; an exact apply retry retains
  its key.
- Applicable previews show exact before/after state, active count, protected total, flexible
  capacity, retained-history facts, warning, version fences, and pending recalculation. A blocked
  resume exposes the exact required capacity and no confirmation control.
- A stale apply disables the old confirmation and offers a current-plan reload. Success refreshes
  `/plan` and `/today`; the UI remains honest that the ordinary Planning worker has not yet
  published the new snapshot.
- Keyboard operation, touch targets, 320-pixel layouts, reduced motion, forced colors, automated
  WCAG A/AA, selector dismissal, blocked capacity, stale reload, and the real signed-in persistence
  journey are covered.

## Verification evidence

The final Windows release gates passed from clean disposable database stacks:

- `pnpm verify`: PASS — formatting, lint, Next.js type generation and TypeScript; 13
  database-runner tests passed with 2 platform skips; 3 backup-archive tests; 329 contract tests; 3
  representative performance tests; 789 unit tests; 87.73% statement and 80.53% branch coverage;
  production build; and 29/29 Chromium E2E tests.
- `pnpm verify:db`: PASS — every migration applied from zero, all 31 explicit pgTAP files and 2,174
  assertions passed, and warning-level database lint reported no findings. The tests include
  isolation, least privilege, deterministic SQL/TypeScript digest agreement, stale and concurrent
  serialization, idempotency, rollback injection, exact row effects, and unchanged retained data.
- `pnpm verify:auth`: PASS — the isolated browser journey persisted pause then resume through the
  authenticated boundary, advanced only the target Track by two versions, retained opaque browser
  authority, and completed the existing Plan, Today/Focus, overlay, reload, refresh, accessibility,
  and sign-out checks.
- `pnpm verify:backup`: PASS — the encrypted archive completed a clean restore after D2b1's schema
  and API additions.

The checked-in Graphify index was not refreshed: neither the approved `graphify` executable nor its
pinned `uvx` runtime is available in this Windows environment. No substitute version, hook, remote
backend, or dependency was installed. `graphify-out/graph.json` therefore remains a stale developer
index; authoritative source, schema, migration, and test files were used for final impact review.

No production dependency or lockfile change was required. No ADR, Planning policy, or planner
engine version changed because D2b1 materializes the already accepted lifecycle and active-only
capacity rules without changing ranking semantics.

## Next bounded outcome

The adjacent pre-existing activity-admission owner-boundary gap is closed. Continue D2b with a
separate priority/protected-minimum edit design and command. Track creation, terminal transitions,
and cadence remain later increments; D3 availability/replacement and Campaign work remain behind
their recorded focused decisions.
