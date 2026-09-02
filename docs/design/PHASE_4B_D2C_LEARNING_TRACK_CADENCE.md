# Phase 4B D2c — Learning Track cadence

Status: accepted implementation design

Date: 2026-09-02

Parent design: [Phase 4B lifecycle and editing commands](PHASE_4B_LIFECYCLE_COMMANDS.md)

Prior slices:
[D2b2 Learning Track priority and protected minimum](PHASE_4B_D2B2_LEARNING_TRACK_PRIORITY_MINIMUM.md)
and
[D2b4 Learning Track completion and archive](PHASE_4B_D2B4_LEARNING_TRACK_TERMINAL_LIFECYCLE.md)

## 1. Outcome and boundary

D2c gives each current Learning Track one explicit weekly cadence target that can be explained,
edited, persisted, and used by Planning without reinterpreting protected minimum minutes as the
same concept.

Cadence is a soft weekly planning preference. It does not create evidence, reserve capacity by
itself, complete a Track, complete a Goal, or bypass mandatory Review, readiness blockers, or
campaign deadline rules.

The canonical Domain Model's phrase "protected minimum cadence" remains implemented by the
existing hard `protectedMinimumMinutes` capacity floor. D2c does not weaken or rename that
protection: `cadencePerWeek` is the separate desired session frequency named by Agent Control and
the lifecycle roadmap. A Track that must retain capacity during a Campaign therefore uses a
protected minimum; its cadence target only helps Planning distribute that capacity as a visible
weekly rhythm.

This outcome does not add availability windows, Growth Plan replacement, Campaign allocation
overrides, Agent Control transport, destructive deletion, or any new source of truth outside
Planning's ordinary command/query/event boundary.

## 2. Accepted cadence semantics

- `cadencePerWeek` is the desired number of evidence-bearing completed Focus sessions for one
  Learning Track in the current planning week.
- The persisted unit is whole sessions per week, not minutes per week and not "days active".
- The allowed stored range is `0..100`. `0` means the Track has no cadence target.
- Persistence adds one non-null bounded `cadence_per_week` value to the Learning Track aggregate.
  Existing and newly created Tracks start at `0`; migration does not infer a target from protected
  minutes, activity count, or prior sessions.
- Cadence is editable only while the parent Growth Plan is current (`active | paused`) and the
  Track is current (`active | paused`).
- Completed and archived Tracks retain their last cadence value as history but cannot edit it.
- Protected minimum minutes remain the hard capacity floor. Cadence remains the soft "how often"
  preference. They are related but not interchangeable.

The count comes from the same authoritative completed-work session set already used by Planning:

- only completed Focus sessions attributed to the Track and backed by non-invalidated normalized
  Evidence count;
- each qualifying session counts exactly once for its single immutable current-Plan Track
  attribution;
- the qualifying week is determined by the session's terminal end instant inside the current
  Planning week boundary;
- stopped sessions, open sessions, non-evidence completions, and invalidated observations add no
  cadence progress.

This keeps cadence progress aligned with the reviewed completed-work policy without inventing a new
ledger or a second historical classifier.

Released Planning commands allow an activity to be admitted once and do not move or remove its
Track attribution, so that attribution is stable for prior sessions. Any future reassignment or
removal outcome must first define an immutable historical-attribution source (or a new versioned
reclassification policy); it cannot silently make old sessions change Tracks under D2c.

## 3. Planning behavior

Planning persists cadence on the Learning Track aggregate and derives one bounded progress summary
for the current week:

- `cadencePerWeek`;
- `completedCadenceSessionsThisWeek`;
- `cadenceDeficit = max(cadencePerWeek - completedCadenceSessionsThisWeek, 0)`.

The session count uses the existing completed-work source bound. More than 500 terminal sessions in
the source window refuses the V2 calculation with `COMPLETED_WORK_SOURCE_BOUND`; it is never
truncated. A valid count above the stored target remains visible rather than being clamped to the
target; only the derived deficit is clamped to zero.

Cadence affects ranking as a soft factor only:

- it never makes a candidate ineligible;
- it never reserves minutes the way active protected minima do;
- it is evaluated only after existing eligibility, protected-capacity, mandatory-floor, Review, and
  campaign rules;
- it adds one track-level preference when the candidate belongs to a Track whose cadence deficit is
  positive.

This is a calculation-contract change, not an in-place reinterpretation of V1. D2c introduces:

- `planning-completed-work/0.2`, which retains every v0.1 duration and repetition rule and adds the
  per-Track evidence-bearing session count;
- `PlanningCalculationInputV2`, which adds `cadencePerWeek` and
  `completedCadenceSessionsThisWeek` to each Track;
- `planner-engine/0.2.0` and `planning-policy/0.2`;
- `PlanSnapshotV2`, whose factor vocabulary admits `TRACK_CADENCE_DEFICIT`.

Historical V1 inputs and snapshots remain valid and queryable with their original engine and policy
versions. The persistence migration widens compatibility for both versions; the current pointer
switches to V2 only after one complete V2 calculation. A V1 snapshot never fabricates cadence
progress and is not relabeled as V2.

Planning policy v0.2 adds `TRACK_CADENCE_DEFICIT` with transparent points:

- `+75` when the Track is short by one session;
- `+150` when the Track is short by two or more sessions.

The existing expected-benefit code `PROTECT_TRACK_CADENCE` remains the user-facing explanation when
the strongest Track-level reason is either protected-minimum recovery or cadence recovery. The
explanation text must distinguish whether PANDO is protecting hard minutes, soft weekly cadence, or
both.

Representative golden fixtures must prove both the unchanged v0.1 result and the new v0.2 result.
Stable ordering remains total score descending, duration ascending, then candidate key. Cadence is
one additive factor inside that existing order; it does not create a separate queue or hidden
precedence rule.

### 3.1 Contract and persistence matrix

| Concern | Historical V1 | D2c V2 |
|---|---|---|
| Input schema | `schemas/planning/v1/planning-input.schema.json`, title `PlanningCalculationInputV1` | new `schemas/planning/v2/planning-input.schema.json`, title `PlanningCalculationInputV2` |
| Snapshot schema | `schemas/planning/v1/plan-snapshot.schema.json`, title `PlanSnapshotV1` | new `schemas/planning/v2/plan-snapshot.schema.json`, title `PlanSnapshotV2` |
| Attempt calculation contract | `planning-calculation/1` | `planning-calculation/2` |
| Completed-work policy | `planning-completed-work/0.1` | `planning-completed-work/0.2` |
| Engine and ranking policy | `planner-engine/0.1.0` + `planning-policy/0.1` | `planner-engine/0.2.0` + `planning-policy/0.2` |
| Track input fields | existing V1 fields unchanged | V1 fields plus required `cadencePerWeek: 0..100` and `completedCadenceSessionsThisWeek: 0..500` |
| Snapshot score vocabulary | existing V1 factors unchanged | V1 factors plus `TRACK_CADENCE_DEFICIT`; Track reason references admit that code |
| Storage | existing rows retained | engine/policy checks admit only the exact V1 pair or exact V2 pair; mixed pairs are rejected |

The existing `planning.plan_snapshot_v1` delivery consumer name and handler contract version `1`
remain stable because they identify the durable projection workflow, not the calculation payload
schema. `planning.plan_snapshot_attempts` gains an explicit calculation-contract version. V1
attempts accept only the exact V1 input/result pair; V2 attempts accept only the exact V2 pair.
Today and history readers select validation by the stored engine/policy/contract tuple rather than
treating every result as V1.

The authoritative V2 activation marker is the exact joined tuple, not pointer age or deployment
time: the current pointer's `snapshot_id` and `applied_attempt_id` must join to one workspace,
the attempt must declare calculation contract `planning-calculation/2`, and both attempt and
snapshot must agree on `planner-engine/0.2.0` plus `planning-policy/0.2`. Only that state is
`CURRENT` for cadence progress. A V1 tuple, a mixed tuple, a broken join, or disagreement fails
closed as `UNAVAILABLE`; a newer queued/leased/ready V2 attempt may additionally make the ordinary
Planning freshness state `PENDING` without relabeling the V1 pointer.

Rollout is expand then activate:

1. add cadence persistence/control plus dual V1/V2 storage, attempt metadata, schemas, validators,
   dispatcher support, and readers while new attempts remain V1;
2. prove existing V1 attempts and snapshots still read and complete;
3. activate V2 input assembly for new attempts, leaving already leased/ready V1 attempts on the V1
   path;
4. move each workspace pointer only when its V2 attempt applies successfully; failures retain the
   prior current snapshot and visible pending/error state.

No migration rewrites historical normalized inputs or result JSON. D2c is complete only after the
V2 activation slice ships; the intermediate persistence/control slice must be reported as partial.

## 4. Current read, preview, and apply

Add a separate additive contract rather than broadening D2b2's released priority/minimum preview:

- `LearningTrackCadenceSourceV1`
- `LearningTrackCadencePreviewV1`
- `LearningTrackCadenceApplyResultV1`

The current source remains actor-scoped, zero-authority-input, and bounded to the existing maximum
of 30 current Tracks. For a current plan it returns all current Tracks with:

- Track identity, lifecycle, priority, protected minimum, and aggregate version;
- `cadencePerWeek`;
- nullable `completedCadenceSessionsThisWeek`, the compatible current `PlanSnapshotV2` identity,
  its applied V2 attempt/input fingerprint and calculation instant, and
  `CURRENT | PENDING | UNAVAILABLE` progress state;
- the one capability `set_track_cadence`.

Cadence progress comes only from the normalized V2 input of the successfully applied attempt behind
Planning's current V2 snapshot. That input was assembled from the bounded Sessions/Evidence owner
queries. The actor-facing source does not gain grants on Sessions or Evidence and does not
reconstruct history. A missing, stale, pending, failed, or V1-only snapshot/attempt pair returns no
count; it never substitutes zero.

The browser submits only:

- opaque Track key;
- exact expected Growth Plan version;
- exact expected Learning Track version;
- proposed `cadencePerWeek`;
- trimmed printable reason.

The preview shows:

- cadence before and after;
- current-week completed cadence sessions and resulting deficit before and after when a compatible
  current V2 snapshot exists, otherwise explicit `Unknown` progress;
- unchanged priority, protected minimum, history, Focus sessions, Evidence, Mastery/readiness,
  Review, and snapshots;
- honest `PENDING` Planning recalculation after apply;
- exact preview digest.

The digest binds the observed current-snapshot identity/input fingerprint and all displayed progress
fields when they exist. Apply takes the ordinary Planning workspace lock, re-reads the current
pointer, and forces a fresh preview if that projection changed. When progress is unavailable, the
preview remains applicable and binds that explicit state rather than a guessed number.

Warnings are additive and non-blocking:

- `PARENT_GROWTH_PLAN_PAUSED`;
- `LEARNING_TRACK_PAUSED`.
- `CADENCE_PROGRESS_PENDING` when no compatible current V2 snapshot can supply the count.

There is no capacity blocker because cadence is intentionally soft. Invalid selectors, stale
versions, terminal Tracks, archived parents, malformed input, and changed digests still fail closed
and expose no confirmation.

## 5. Atomic owner command and event

The command type is `planning.change_learning_track_cadence_v1`.

Apply follows the existing Planning mutation protocol:

1. resolve actor and workspace from the authenticated session;
2. validate scalar syntax and request hash;
3. serialize `(actor, command type, idempotency key)` and replay only an identical completed
   request;
4. take `planning-workspace:<workspace UUID>`;
5. lock the current parent Plan, every child Track in stable order, and the Planning current-snapshot
   pointer used by the preview;
6. resolve the submitted Track key inside that Plan, rebuild the preview from locked state, and
   require exact Plan/Track versions plus exact digest;
7. update only the target Track's cadence, aggregate version, and timestamp;
8. append one minimal event and one fixed `planning.plan_snapshot_v1` delivery;
9. complete the receipt response and commit all effects together.

The additive `planning.input_changed` V1 payload is:

```json
{
  "change_kind": "TRACK_CADENCE_CHANGED",
  "growth_plan_id": "<uuid>",
  "learning_track_id": "<uuid>",
  "learning_track_version": "<positive bigint string>",
  "cadence_per_week": 0
}
```

The envelope aggregate remains `planning.learning_track`. The event carries no reason body,
priority, protected minimum, activity, Evidence, Mastery, Goal, or Today payload.

## 6. Manual and agent-facing UX

`/plan` adds a separate `Track cadence` control instead of overloading priority/minimum editing.

- The selector and confirmation pattern match the existing Track controls.
- Copy uses plain language such as "3 evidence-bearing sessions per week".
- `0` is explicitly explained as "no cadence target".
- The preview explains that cadence is a soft weekly rhythm, not a hard minimum and not a Goal
  completion claim.
- Changing cadence intent dismisses any stale confirmation, and any sibling Plan intent dismisses a
  cadence confirmation.

For future ChatGPT Work/Codex control, cadence must be easy to map from short text:

- "make algorithms 3 times a week";
- "set ML cadence to zero for now";
- "keep systems once a week but don't increase minimum minutes".

The compact control summary should therefore expose, per current Track:

- `cadence_per_week`;
- `completed_cadence_sessions_this_week`;
- whether the cadence target is already met this week.

That keeps the external agent grounded in one short read model instead of reconstructing cadence
from raw session history.

The pre-release Agent Control V1 operation currently couples cadence with an optional protected
minimum. D2c does not broaden that contract. Agent Control V2 must map cadence and
priority/protected-minimum to their separate released Planning owner commands and preconditions.

## 7. Required proof

D2c is complete only when tests prove:

- valid, boundary, invalid, and malicious source/preview/apply/event contracts;
- active and paused Track cadence edits, including `0` and a non-zero target;
- completed/archived Track refusal and parent-archived refusal;
- same-key replay, changed-request conflict, stale Plan/Track versions, changed digest refusal, and
  serialization against capacity, lifecycle, terminal lifecycle, creation, and activity-admission
  commands;
- exactly one Track version increment, unchanged parent Plan/siblings, and atomic
  receipt/event/delivery behavior;
- source/current-week cadence progress derives from the same qualifying completed-work session set
  and counts one qualifying session once for its single Track attribution;
- V1 historical input/snapshot validation remains green while V2 valid, boundary, invalid, and
  malicious fixtures prove the version transition without relabeling old rows;
- dual-attempt routing proves V1 accepts only the V1 engine/policy pair, V2 accepts only the V2 pair,
  mixed pairs fail closed, and an already-ready V1 attempt completes during V2 rollout;
- completed-work v0.2, Planning input V2, engine 0.2.0, policy 0.2, snapshot V2, persistence checks,
  and Today explanation prove that cadence deficit is a soft score factor rather than a hard
  eligibility or capacity rule;
- keyboard, responsive, touch-target, reduced-motion, forced-colors, and accessibility behavior for
  the `/plan` cadence control;
- one real authenticated `/plan` cadence edit followed by a current Today/Plan reload;
- `pnpm verify`, `pnpm verify:db`, `pnpm verify:auth`, and `pnpm verify:backup` before merge.

## 8. Deferred work

Deferred: availability windows, Growth Plan replacement/archive semantics, Campaign allocation
overrides, Agent Control V2 transport, imported cadence proposals, and any smarter "plausibility
this week" heuristic beyond the simple soft deficit points above.
