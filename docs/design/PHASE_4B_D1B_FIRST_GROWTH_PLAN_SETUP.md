# Phase 4B D1b — first Growth Plan setup

Status: implemented

Implementation:
[D1b first Growth Plan setup status](../implementation/PHASE_4B_D1B_FIRST_GROWTH_PLAN_SETUP_STATUS.md)

Date: 2026-09-01

Canonical basis: `docs/00_PRODUCT_CONSTITUTION.md` through `docs/06_PROMPT_LIBRARY_UX.md`

## 1. Outcome and sequence

D1b closes the fresh-user gap between selecting a Readiness Goal and receiving a persistent Growth
Plan. A signed-in user with no current Plan can open `/plan`, select one active server-returned
Readiness Goal, enter a weekly capacity, initial session length and priority, preview the exact first
Plan plus first Learning Track, explicitly confirm it, and observe honest pending recalculation.

This outcome precedes additional Learning Track creation. D2b3 requires an existing current parent
Plan and therefore cannot repair the current no-Plan dead end. A separate following outcome exposes
the already-owned activity-admission behavior through a manual UI before additional empty Tracks are
valuable.

D1b does not create a new Readiness Goal, import a target, admit an activity, create a campaign,
define cadence, or expose Agent Control transport.

## 2. Existing gap being closed

`/start` currently creates or reuses an exact active Readiness Goal and links to Explore. `/plan`
currently tells a user with no Plan to choose a target but exposes no setup action. The only existing
creator, `api.initialize_growth_plan_v1`, immediately writes the first Plan and Track. It has no
deterministic preview/digest/confirmation boundary, and its implementation function is directly
executable by `authenticated`.

That state is acceptable as an earlier persistence bootstrap but not as the released manual command
surface. D1b supersedes it with an exact preview/apply command and removes authenticated execution
from both the legacy wrapper and implementation. Tests and trusted implementation code may not use
the legacy path as a second production mutation boundary.

## 3. Ownership and supported source

- Planning owns the new Growth Plan, initial Learning Track, current-snapshot sentinel, command
  receipt, Planning input-change event and fixed delivery.
- Targets owns the selected Readiness Goal and immutable Target Profile version. Planning receives
  them only through a new purpose-specific Targets owner query.
- The supported D1b source is one active Readiness Goal in the actor's personal workspace, bound to
  its exact immutable profile version. When that profile names a roadmap version, the Track uses
  that exact roadmap. When it does not, the immutable Target Profile version's exact requirement
  references are the canonical competency collection named by the Domain Model's “roadmap template
  version or competency collection” rule. A null roadmap therefore never means an unbound Track.
- Workspace, user, Goal UUID, profile UUID, roadmap UUID, Plan UUID and Track UUID are never
  accepted from the browser.
- A missing, inactive, malformed or foreign same-shaped Goal selector is non-enumerating and
  produces the same unavailable result.

The source read is separate from `TargetSelectionSourceV1`. That broader Targets UI contract is a
useful precedent but is not silently repurposed as Planning authority.

## 4. Setup source read

Add a zero-argument authenticated `GrowthPlanSetupSourceV1` read. It derives the actor and personal
workspace, then returns:

- one exact state: `SETUP_AVAILABLE`, `NO_ACTIVE_GOALS`, `CURRENT_PLAN_EXISTS`,
  `HISTORY_REQUIRES_REPLACEMENT`, or `GOAL_PORTFOLIO_OVERFLOW`;
- capability `initialize_growth_plan` only for `SETUP_AVAILABLE`, which requires lifetime Plan count
  `0`, current Plan count `0`, snapshot-sentinel count `0`, and `1..20` active Goal choices;
- for `SETUP_AVAILABLE`, all active Readiness Goal choices in stable ASCII key order;
- for each choice: opaque `readinessGoalKey`, safe title, profile label/key, nullable roadmap-presence
  fact, and Readiness Goal aggregate version;
- empty capabilities and choices for every other state.

Exactly 20 choices are valid. If more than 20 active choices exist, the source fails closed with an
explicit `GOAL_PORTFOLIO_OVERFLOW` state, returns no capability and does not truncate or silently
hide a valid Goal. A current Plan produces `CURRENT_PLAN_EXISTS`; archived-only history produces
`HISTORY_REQUIRES_REPLACEMENT`; zero goals produces `NO_ACTIVE_GOALS`. Corrupt Plan cardinality or
an orphan sentinel is an unavailable RPC failure rather than another UI-actionable state.

The public read contains no workspace ID, Goal/profile/roadmap UUID, source documents, requirements,
evidence, fingerprints or table-shaped rows. Planning calls a bounded Targets-owned function and
receives no Targets table grant.

The Targets function takes the existing
`hashtextextended('<workspace UUID>:targets.active-readiness-goals', 2)` transaction advisory lock
before resolving choices and returns `ownerRevision: readiness-goal:<aggregate version>` for the
selected source. Preview and apply both use that fence. A concurrent Targets selection/lifecycle
change therefore serializes with setup or causes the exact source revision/version check to fail;
Planning never tries to reproduce Targets locking with a table grant.

The resolved source representation is exact. A non-null roadmap produces
`sourceKind: ROADMAP_TEMPLATE_VERSION` and `sourceRef` equal to the lowercase roadmap UUID. A null
roadmap produces `sourceKind: TARGET_PROFILE_REQUIREMENT_COLLECTION` and `sourceRef` equal to the
lowercase immutable profile-version UUID. No other source kind or representation is valid in D1b.

If a current Plan appears between the ordinary current-Plan read and this source read, `/plan`
reloads both once and otherwise fails closed rather than showing a stale setup form beside current
Plan controls.

## 5. Public command inputs and derived state

The preview accepts only:

- `readinessGoalKey`, chosen from the setup source;
- exact expected Readiness Goal aggregate version;
- weekly capacity, integer `0..10080` minutes;
- initial default session length, integer `1..480` minutes;
- initial Track priority, integer `0..100`;
- trimmed reason, `1..500` characters;
- an opaque UUID idempotency/request key generated for this preview attempt.

Apply accepts the same values plus the exact preview digest. It cannot replace any previewed field.

The exact public functions are:

```text
api.get_growth_plan_setup_source_v1()
api.preview_growth_plan_initialization_v1(
  readiness_goal_key, expected_readiness_goal_version,
  weekly_capacity_minutes, default_session_minutes, track_priority,
  reason, idempotency_key
)
api.apply_growth_plan_initialization_v1(
  readiness_goal_key, expected_readiness_goal_version,
  weekly_capacity_minutes, default_session_minutes, track_priority,
  reason, idempotency_key, preview_digest
)
```

Text and integer SQL types follow that displayed order exactly.

The resulting state is derived as follows:

- Growth Plan lifecycle is `active`, aggregate version is `1`, and title is the authoritative
  Readiness Goal title;
- initial Learning Track lifecycle is `active`, aggregate version is `1`, and title is exactly
  `btrim(left(readiness_goal_title, 160))`; the Plan keeps the full authoritative Goal title up to
  its 200-character bound;
- readiness-goal/profile/roadmap bindings come only from the locked Targets source;
- protected minimum is fixed to `0` for the first empty Track;
- no activity, evidence, Mastery, Review, readiness or historical row is created or rewritten.

Protected minimum is deliberately not an input in D1b. The first Track has no admitted activity, so
reserving positive minutes would reduce flexible capacity while no candidate could consume the
reservation. After the separate activity-admission UI exists, the released D2b2 command can set an
explicit protected minimum with its exact capacity preview.

The UI may prefill editable presentation suggestions of 600 weekly minutes, 30 session minutes and
priority 50. These are convenience values only, not policy, persisted defaults or inferred facts.

## 6. Deterministic create identity

The preview must contain resolved aggregate identifiers even though no aggregate row exists yet.
D1b therefore uses `planning-create-identity/1.0.0`:

1. encode fields with the existing Planning primitive
   `name:<UTF-8-byte-length>:<value>\n`, in the exact order `identityVersion`, `workspaceId`,
   `commandType`, `idempotencyKey`, `label`; workspace UUID is lowercase and the label is ASCII;
2. hash with SHA-256;
3. take the first 16 bytes; zero-based byte 6 becomes `(byte6 & 0x0f) | 0x80` and byte 8 becomes
   `(byte8 & 0x3f) | 0x80`, producing UUID version 8 with RFC variant bits `10`;
4. format the result as a lowercase UUID.

Labels `growth-plan` and `initial-learning-track` produce distinct IDs. The Track key is
`track:<derived-track-uuid>`. The browser chooses neither identifier. A fixed TypeScript/SQL oracle
proves byte-identical derivation. An impossible pre-existing identity/key collision blocks without
writing and requires a fresh request key.

Command, correlation, event and delivery IDs may remain random at apply because they are not owner
aggregate identities in the preview. Completed idempotent replay returns the originally stored
response byte-for-byte.

## 7. Deterministic preview

`GrowthPlanInitializationPreviewV1` contains:

- contract, digest and identity-derivation versions;
- operation `initialize_growth_plan` and command type `planning.initialize_growth_plan_v2`;
- resolved derived Plan and Track IDs/key;
- the expected Goal version and exact resolved Goal/profile/roadmap source summary;
- `before`: no lifetime Plan rows, lifetime Plan count `0` and current Plan count `0`;
- `after`: exact Plan and Track state, including every bounded numeric value and both aggregate
  versions;
- lifetime and current Plan cardinality before/after and current limit `1`;
- retained Goal, Overlay, activity/evidence, Mastery, Review and history facts;
- warning `INITIAL_TRACK_HAS_NO_ACTIVITIES`;
- applicability/blocker;
- `projectionStateAfterApply: PENDING` and fixed consumer `planning.plan_snapshot_v1`;
- a SHA-256 digest over every field above, the workspace identity, canonical request values and
  source owner revision.

The preview digest reuses the same `name:<UTF-8-byte-length>:<value>\n` primitive. Its ordered field
stream is: `digestVersion`, `contractVersion`, `identityVersion`, lowercase `workspaceId`,
`operation`, `commandType`, `idempotencyKey`, `reason`, `expectedReadinessGoalVersion`; resolved Goal
`id`, `key`, `title`, `lifecycle`, `version`; profile `id`, `key`; `sourceKind`, `sourceRef`, nullable
`roadmapVersionId`; `sourceOwnerRevision`; lifetime Plan count before/after; current Plan count
before/after and limit; snapshot-sentinel count before/after; derived Plan `id`, `title`,
`lifecycle`, `weeklyCapacityMinutes`, `version`;
derived Track `id`, `key`, `title`, `lifecycle`, `priority`, `protectedMinimumMinutes`,
`defaultSessionMinutes`, `version`; `canApply`, `blockingReasonCode`; `warningCount` and each ordered
`warningCode`; retained Goal/Overlay/activity/evidence/Mastery/Review/history booleans;
`projectionStateAfterApply`, `eventChangeKind`, and `consumerName`. Values use lowercase UUIDs,
canonical base-10 integers, lowercase `true|false`, uppercase enum literals and an empty string for
a null roadmap. `previewDigest` is never an input to itself. SQL and TypeScript share this literal
field order.

The canonical apply request hash uses the same framing in this exact order: `requestHashVersion`,
`schemaVersion`, `identityVersion`, lowercase `workspaceId`, `commandType`, `operation`,
`idempotencyKey`, `readinessGoalKey`, `expectedReadinessGoalVersion`, `weeklyCapacityMinutes`,
`defaultSessionMinutes`, `trackPriority`, `reason`, `previewDigest`, derived `growthPlanId`, derived
`learningTrackId` and derived `trackKey`. The receipt stores expected aggregate version `0`. A
same-key request changed by value or protocol therefore conflicts deterministically.

The preview is a pure read with no receipt, Plan, Track, pointer, event or delivery effect. Before
state also binds snapshot-sentinel count `0` and after state binds exactly one sentinel. A current
Plan is a typed blocking preview `CURRENT_GROWTH_PLAN_EXISTS`. Archived Plan history without a
current Plan is `GROWTH_PLAN_HISTORY_REQUIRES_REPLACEMENT` and cannot use D1b; replacement remains
D3/ADR-gated. An orphan snapshot sentinel without a Plan, more than one lifetime Plan row, or more
than one current Plan fails closed as corruption. A well-shaped missing, inactive or foreign Goal
is not represented as a discoverable blocker. A syntactically malformed Goal key is a generic
invalid request rejected before lookup.

## 8. Apply, locks and atomicity

Apply uses the established owner-command order:

1. resolve actor/workspace; validate bounded scalars; calculate the canonical request hash;
2. lock actor, command type and idempotency key; return only an identical completed replay;
3. acquire `planning-workspace:<workspace UUID>`;
4. lock every lifetime Plan row in stable UUID order and require the lifetime count to remain zero;
5. through the Targets owner resolver, acquire
   `hashtextextended('<workspace UUID>:targets.active-readiness-goals', 2)`, resolve the selected
   active Goal and verify its exact version and owner revision;
6. rebuild the complete preview and require the same identity, request, source revision and digest;
7. insert one started receipt;
8. insert exactly one Plan, one initial Track and exactly one new current-snapshot sentinel; never
   upsert or reuse a pre-existing sentinel;
9. insert exactly one existing v1 `planning.input_changed` `INITIALIZED` event and one fixed
   `planning.plan_snapshot_v1` delivery;
10. complete exactly one receipt and commit all effects together.

The existing minimal `INITIALIZED` event payload remains valid: Plan ID/version, Track ID/version,
Readiness Goal ID and profile version ID. Its envelope aggregate is `planning.growth_plan` with the
derived Plan ID at version `1`; the existing payload version values remain JSON numbers `1`, not
bigint strings. Title, reason, Track key, capacity, session length, fingerprints and source bodies
remain forbidden. No event schema, Planning policy or planner-engine version changes.

Any Goal/source staleness, current-Plan race, digest mismatch, changed idempotency request, insert
collision, receipt/event/delivery failure or authorization error rolls back every effect. The
snapshot pointer does not become falsely current; apply returns `PENDING`.

## 9. Security surface

- Public preview/apply RPCs are `SECURITY DEFINER`, owned by `pando_planning_api`, use an empty
  search path and grant execute only to `authenticated`.
- `api.get_growth_plan_setup_source_v1()` has the same public security shape: `SECURITY DEFINER`,
  owner `pando_planning_api`, empty search path and execute only for `authenticated`.
- Its Targets helper is owned by `pando_phase1_api`, executable only by `pando_planning_api`, and
  denied to every runtime role. It returns all active Goals inside the enforced bound and never uses
  `LIMIT 20` truncation.
- Private source adapters, builders, digest/identity helpers, validators and apply hooks deny
  `PUBLIC`, `anon`, `authenticated` and `service_role`.
- Revoke `authenticated` from both `api.initialize_growth_plan_v1` and
  `planning.initialize_growth_plan_impl_v1`; the old direct mutation is not an alternate path.
- The browser uses only a user-scoped server action and cannot write Planning tables.
- Planning receives execute on the bounded Targets query and no Targets table privilege.
- Forced RLS and positive/negative workspace-isolation proofs remain required for every written
  workspace-owned table.

## 10. `/start` and `/plan` experience

- After selecting a Readiness Goal, `/start` offers a clear `Set up Growth Plan` link to `/plan`.
- With no Plan, `/plan` loads the setup source and renders a native Goal select plus integer inputs
  for weekly capacity, session length and priority, and a required reason.
- Preview shows `no Plan -> active Plan`, `no Track -> active Track`, exact values, source binding,
  the empty-Track warning, retained state and pending Today recalculation.
- Blocked/unavailable setup exposes no confirmation control. Confirmation is keyboard-operable and
  separate from preview.
- Changing any source/value/reason dismisses the old preview and rotates the request key on the next
  preview. Retrying the same confirmed apply retains the key.
- Success revalidates `/plan` and `/today`, removes the setup form and shows ordinary Plan controls.
- Existing Plan users never see the setup form.

No URL value, hidden workspace field or client-supplied UUID becomes authority. A URL may only be a
display hint after it is matched against the fresh server-returned source.

## 11. Required proof

Contract/domain:

- valid, boundary, invalid and malicious fixtures;
- exact-key rejection and semantic cross-field validation;
- fixed Unicode digest and deterministic UUID TypeScript/SQL oracle;
- permutation independence and sensitivity to every bound field;
- preview purity and unchanged retained-state facts.

Database/security:

- no Plan, exact numeric boundaries and ordinary success;
- existing current Plan block and persisted-cardinality corruption failure;
- malformed Goal rejection plus stale, inactive, terminal, missing and foreign well-shaped Goal
  refusal without enumeration;
- 20 active Goal choices accepted and 21 fail closed without truncation;
- Goal/Plan title lengths 160, 161 and 200, including Unicode and whitespace at the Track-title cut;
- zero lifetime Plans succeeds; current Plan and archived-only history block separately; corrupt
  lifetime/current cardinality fails closed;
- same-key replay, changed-request conflict and derived-identity collision;
- a real same-key/same-request race waits and returns one byte-identical response with one Plan,
  Track, sentinel, receipt, event and delivery;
- two distinct concurrent first-Plan requests produce one winner and one stale/cardinality loser;
- an active-Goal lifecycle/version writer racing setup is tested in both commit orders and either
  serializes or fails the exact source fence;
- injected Plan, Track, receipt, event and delivery failures roll back all effects;
- exact event envelope/payload, one delivery, pointer pending state and unchanged history;
- forced-RLS isolation, public/private privilege matrix and direct legacy-RPC denial.

Application/UI:

- decoder and server-action rejection of malformed values and injected authority fields;
- no-Plan, no-active-goal, unavailable, blocked, stale and retry states;
- old confirmation dismissal, request-key rotation and same-apply retry;
- keyboard, 320-pixel viewport, touch targets, reduced motion, forced colors and automated WCAG
  A/AA;
- authenticated `/start -> /plan -> preview -> confirm -> reload` persistence journey that no
  longer invokes the legacy initializer directly.

Revoking the legacy RPC is intentionally a broad fixture migration, not a one-line ACL change.
Every pgTAP/auth fixture that currently initializes state as `authenticated` through
`api.initialize_growth_plan_v1` must move to the new public preview/apply contract or an explicitly
test-only setup executed outside runtime roles. No production migration may add a hidden fixture
role or retain the legacy grant merely to keep old tests unchanged.
Pre-existing v1 command receipts, events, deliveries, Plans, Tracks and snapshot history remain
byte-identical and readable after the upgrade.

Run `pnpm verify`, `pnpm verify:db`, `pnpm verify:auth` and `pnpm verify:backup` before completion.

## 12. Deferred outcomes

The next bounded outcome exposes manual admission of one accepted Overlay activity to the initial
Track through a deterministic preview, explicit confirmation and the existing Planning owner
semantics. Until that apply is projected, D1b's empty Track produces no Today candidate: the setup
apply is honestly `PENDING`, and the eventual current snapshot may remain action-empty. D2b3 then
creates additional Targets-backed Tracks. Also deferred:

- competency-collection-backed Tracks;
- positive minimum during first empty-Track setup;
- default-session editing after creation and cadence;
- terminal Track lifecycle, availability, Plan replacement and Campaigns;
- Preparation Pack application and Agent Control/MCP transport.
