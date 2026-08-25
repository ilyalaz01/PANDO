# PANDO — Domain Model v0.3

## 1. Bounded contexts

| Context | Owns | Does not own |
|---|---|---|
| Identity & Workspace | users, workspaces, roles, preferences | mastery or roadmap content |
| Catalog | canonical competencies, prerequisite DAG, activities, resources, roadmap templates | target profiles and user-specific state |
| Targets | outcome goals, readiness goals, interview campaigns, target-profile series/versions/drafts, requirement rules | evidence calculation and canonical competencies |
| User Overlay | workspace-scoped competencies, activities, resources, edges, exclusions, notes, positions, and accepted mappings | canonical template/catalog mutation |
| Evidence | attempts and immutable evidence ledger | UI-specific progress fields |
| Mastery | derived competency states and estimate confidence | raw attempts |
| Review | algorithmic reviews, reminders, goal-driven dates, deduplication | notification delivery |
| Planning | Growth Plan, Learning Tracks, availability/capacity policies, campaign allocation overrides, next-best-action ranking, explanations, snapshots | target requirements and free-form LLM decisions |
| Sessions | focus sessions, time budgets, completion flow | competency truth |
| Integrations | provider accounts, cursors, imports, normalized provider events | domain semantics |
| Agent Control | minimized control read models, version-checked change sets, confirmation records, and cross-module command coordination | domain truth, conversation retention, or direct authoritative writes |

## 2. Principal entities

### Catalog and target entities

```text
Competency(id, slug, title, description, type, status, version metadata)
CompetencyEdge(id, from, to, type, rationale, source, validity)
Activity(id, type, title, effort range, difficulty, provider ref, lifecycle)
Resource(id, type, title, locator, metadata, rights metadata)
ActivityCompetencyMap(activity, competency, evidence dimension, weight, status)
RoadmapTemplate(id, version, lifecycle, changelog)
TemplateItem(template version, item ref, requirement rule, visual grouping)
TargetProfileSeries(id, scope canonical/workspace, owning workspace nullable, lifecycle)
TargetProfileVersion(id, series, version, role/company metadata, sources, freshness, published_at)
TargetRequirement(profile version, competency/domain, weight, floor, criticality)
TargetProfileDraft(id, workspace, source import, base profile version, lifecycle)
TargetRequirementDraft(id, profile draft, proposed target ref, rule, provenance)
```

### User and evidence entities

```text
GrowthPlan(id, workspace, title, status, default capacity/allocation policy)
LearningTrack(id, growth plan, roadmap template version or competency collection, priority, cadence, protected minimum)
OutcomeGoal(id, workspace, title, result state, occurred_at)
ReadinessGoal(id, workspace, exact target profile version, status)
InterviewCampaign(id, workspace, readiness goal, optional outcome goal, deadline, status)
CampaignRequirementOverride(id, campaign, target requirement ref, weight/floor/criticality override, reason)
CampaignAllocationOverride(id, campaign, learning track ref, capacity/priority/cadence override, reason)
AvailabilityWindow(id, workspace, interval, available minutes, energy/constraint metadata)
UserOverlayItem(id, user/workspace, operation, target ref, payload)
PersonalCompetency(id, workspace, title, lifecycle, provenance)
FocusSession(id, planned duration, actual duration, energy, state)
ActivityAttempt(id, activity, session, started/ended, result, provider)
EvidenceEvent(id, occurred_at, recorded_at, subject, source, payload, reliability)
EvidenceCorrection(id, evidence id, reason, replacement/invalidation)
CompetencyState(user, competency, dimensions, level, freshness, confidence, version)
ReviewItem(id, subject, due_at, reasons, state, scheduler metadata)
PlanSnapshot(id, horizon, constraints, ranked actions, engine version)
PlanChangeSet(id, workspace, base watermark, status, source client, reason, expires_at)
PlanChangeOperation(id, change set, command type, aggregate ref, expected version, parameters)
PlanRevision(id, workspace, applied change set, before/after watermark, summary, occurred_at)
```

Identifiers, timestamps, workspace ownership, schema version, provenance, and audit metadata are required where applicable.

### Ownership and cardinality invariants

- A personal workspace has exactly one active `GrowthPlan` in the MVP and may retain archived plans for history.
- `GrowthPlan` lifecycle is `active | paused | archived`; `LearningTrack` lifecycle is `active | paused | completed | archived`. Pausing is reversible and never deletes prior plan revisions or evidence.
- A `GrowthPlan` has one or more `LearningTrack` records. Track template/profile references always point to exact immutable versions.
- A workspace may retain many past campaigns but has at most one active `InterviewCampaign` in the MVP. Supporting simultaneous active campaigns requires a later policy and ADR.
- `InterviewCampaign` lifecycle is `draft | active | ended | cancelled`. `cancelled` records that the external opportunity disappeared; `ended` records a normal campaign close. Neither state deletes the associated readiness/outcome goal or evidence.
- An `InterviewCampaign` owns exactly one deadline and references exactly one `ReadinessGoal`; that goal references exactly one immutable `TargetProfile` version.
- An optional `OutcomeGoal` records the real-world result. Readiness never completes it automatically.
- Default weekly capacity belongs to the `GrowthPlan`; dated availability belongs to `AvailabilityWindow`; temporary reallocations belong to `CampaignAllocationOverride`.
- Requirement weights/floors belong to `TargetProfile` versions or `CampaignRequirementOverride`, never to Planning.
- The active interview target is derived from the active campaign's readiness goal. It is not duplicated on the workspace or in a generic `UserGoal`.
- Agent Control owns only proposal/audit coordination. The operation named in each change set is executed by the bounded context that owns the affected aggregate.
- Publishing a new template/profile version never silently retargets an existing track or goal. Upgrade occurs through preview and confirmed migration.

## 3. Canonical edge types

| Edge | Meaning | Constraint |
|---|---|---|
| `PREREQUISITE_OF` | Competency A is needed before B | Canonical prerequisite edges must remain acyclic. |
| `RELATED_TO` | Helpful semantic relationship | Does not unlock or block by itself. |
| `PART_OF` | Navigation/grouping relation | Must not be used as evidence logic automatically. |
| `ACTIVITY_EVIDENCES` | Activity can provide evidence for competency/dimension | Has mapping confidence and curator status. |
| `TARGET_REQUIRES` | Target profile requires competency/domain | Carries weight, floor, and criticality. |
| `RESOURCE_SUPPORTS` | Resource is used by an activity | Resource consumption alone is weak evidence. |
| `USER_ADDED` | Personal overlay relationship | Never silently promoted to canonical. |

## 4. Evidence ledger

### Event stages

Operational/session events are not evidence. `ActivityStarted`, `FocusSessionStarted`, `FocusSessionEnded`, and a bare completion click belong to Sessions/activity history.

Raw provider payloads are stored as `ProviderInboxEvent` by Integrations. `ProviderEventImported` means only that ingestion succeeded; it does not enter the evidence ledger. After deduplication, validation, and normalization, Integrations submits a typed observation to Evidence.

The evidence ledger accepts only normalized observations that state what was observed and with what reliability. Required evidence families are:

- `ActivityOutcomeObserved`
- `CodingAttemptSubmitted`
- `CodingAttemptAccepted`
- `ReviewGraded`
- `ExplanationAssessed`
- `MockInterviewAssessed`
- `ProjectArtifactVerified`
- `EvidenceSelfReportAdded`
- `EvidenceCorrected`
- `EvidenceInvalidated`

An activity may become operationally complete without producing competency evidence. For example, opening or finishing a video can update activity history; only a qualifying result such as a graded recall, explanation, or application produces competency evidence.

Each evidence event records:

- user/workspace and subject;
- activity and mapped competencies;
- event and evidence type;
- source (`manual`, `PyPrep`, `GitHub`, `internal`, etc.);
- occurrence and ingestion timestamps;
- outcome and measurable rubric where available;
- independence indicators: hints, reference use, collaboration, unknown;
- context: timed/untimed, first attempt/review, environment;
- source reliability and mapping confidence;
- event schema version and idempotency key.

An imported event may be reliable about what the provider observed while still being weak evidence of independence. Store these as separate concepts.

## 5. Competency dimensions and state

Four objective dimensions:

- `Knowledge` — demonstrated conceptual understanding.
- `Recall` — estimated current retrievability.
- `Application` — independent use in exercises or real work.
- `InterviewExecution` — performance under time, explanation, and follow-up constraints.

One subjective dimension:

- `SelfConfidence` — explicit user report, never averaged into objective mastery by default.

### Levels

| Level | Semantics |
|---|---|
| `NOT_STARTED` | No qualifying successful evidence has raised the achievement level. With no relevant evidence, display `Unknown`; failed or otherwise nonqualifying evidence may make a dimension estimate known without raising the level. |
| `COMPLETED` | At least one qualifying first successful activity. |
| `VERIFIED` | Independent or delayed successful reproduction. |
| `MASTERED` | Multiple qualifying events across days plus target-relevant application/interview evidence. |

The exact thresholds are versioned policy, not hard-coded UI logic. Different activity types use different evidence rules. A watched video can establish completion of the activity but cannot alone establish competency mastery.

### Estimate condition

Each dimension exposes:

- value or `Unknown`;
- condition: `Weak`, `Stale`, or `Strong` when known;
- estimate confidence: `Low`, `Medium`, or `High`;
- last meaningful evidence date;
- top supporting and contradicting evidence;
- calculation policy version.

## 6. Requirement rules

Roadmap/target requirements support:

- `ALL` — every mandatory requirement.
- `ANY` — at least one alternative.
- `K_OF_N` — any K qualifying children.
- `WEIGHTED_THRESHOLD` — weighted evidence reaches a threshold.
- `MANDATORY_FLOOR` — a specific minimum cannot be compensated by averages.

Visual containment must never automatically imply one of these rules.

## 7. Readiness calculation contract

Readiness is a versioned deterministic projection:

```text
inputs = selected target profile version
       + current competency states
       + requirement weights and mandatory floors
       + evidence freshness and estimate confidence

output = status + score/range when defensible + confidence
       + domain breakdown + blockers + explanation + best improvement actions
```

Rules:

1. A mandatory-floor failure produces `Not ready` even if the weighted aggregate is high.
2. Unknown areas reduce estimate confidence; policy may show a bounded range rather than treating them as zero.
3. Stale evidence can lower current readiness without deleting historical achievement.
4. The projection stores its engine/profile/input versions for reproducibility.
5. The score is never called offer probability.

The initial formula must be deliberately simple, documented, and replaceable. Do not claim scientific calibration until outcome data and validation exist.

## 8. Review scheduling

A single `ReviewItem` may contain multiple reasons:

- `RETENTION_RISK` — algorithmic scheduling such as FSRS-like recall logic;
- `PERSONAL_REMINDER` — explicit user request;
- `GOAL_DEADLINE` — target or mock deadline pressure;
- `VERIFICATION_NEEDED` — insufficient independent evidence.

If reasons collide for the same subject, merge them into one queue item and retain every reason. Supported actions: start now, reschedule, skip once, suppress future recommendations, substitute a similar activity, or mark completed elsewhere.

FSRS-style state influences `Recall` scheduling only. It is not the full mastery engine.

## 9. Planning engine contract

The planner receives:

- the active campaign's readiness goal, target-profile version, and deadline when a campaign exists;
- user time/energy constraints;
- prerequisites and unlock value;
- target impact and mandatory blockers;
- due reviews and retention urgency;
- evidence freshness/uncertainty;
- estimated effort/difficulty;
- recent workload and user preferences;
- exclusions and already completed activities;
- active Growth Plan tracks and their desired cadence/minimum allocation;
- zero or one active Interview Campaign in the MVP and its requirement/allocation overrides.

It returns ranked candidates with a structured explanation. A conceptual ranking is:

```text
priority = goal impact
         + blocker reduction
         + retention urgency
         + prerequisite unlock value
         + deadline pressure
         + uncertainty reduction
         - effort mismatch
         - repetition cost
```

All terms, weights, filters, and engine versions are persisted or reproducible. The LLM can verbalize the result but cannot replace this calculation.

### Planning horizons and precedence

The planner operates on two layers:

1. `Growth Plan` — continuous development without a required interview date.
2. `Interview Campaign` — temporary deadline-driven overlay.

Campaign priorities override the flexible share of near-term capacity, but the base plan remains active unless the user explicitly pauses it. Each track may define a protected minimum cadence, for example one machine-learning session per week, so an interview campaign does not silently erase long-term development.

When a campaign ends, the planner removes its temporary overrides and resumes the Growth Plan using the same evidence history. Activities completed during the campaign strengthen shared competencies everywhere; progress is never campaign-local.

## 10. Template, personal content, and overlay semantics

Each Learning Track and Readiness Goal references an exact template/profile version. The overlay stores deltas and workspace-scoped content:

- add a personal competency or competency draft;
- add custom activity/resource;
- exclude or substitute an item;
- add notes/reminders;
- override personal priority;
- store personal visual position;
- accept a suggested competency mapping;
- add a permitted personal edge.

Preparation Pack imports use a staging model:

1. Integrations stores the immutable raw pack and validation result.
2. Existing canonical identifiers map to their exact versions.
3. A vacancy-specific profile is staged as `TargetProfileDraft` owned by Targets.
4. Unknown competencies are staged as workspace-scoped competency drafts owned by User Overlay.
5. The preview shows every proposed create/update/mapping and its provenance.
6. Confirmation publishes a workspace-scoped target-profile version and accepted personal catalog items through ordinary commands.
7. Personal content can influence only its workspace until separately curated into a canonical version.

Template upgrades run a deterministic three-way merge: old template, new template, user overlay. Conflicts are shown; user content is never discarded silently.

## 11. State-changing commands

Every command validates authorization and invariants and is idempotent where external retries are possible. When a command publishes a domain event or triggers asynchronous projection work, its state change and outbox record are committed in the same transaction. Evidence append, correction, target/profile publication, template upgrade, campaign lifecycle, and provider-normalization commands always use this path. Read models are rebuildable from authoritative state plus ledger/history.

An agent, CLI, MCP tool, or UI never receives a separate mutation path. Multi-operation plan changes use one purpose-specific `ApplyPlanChangeSet` coordinator. It verifies the authenticated workspace, preview token, expiry, expected aggregate versions, base watermark, and confirmation record; executes the ordered owning-context commands; writes the plan revision and outbox events; and commits all effects atomically. A stale or partially invalid proposal applies nothing.

## 12. Agent control contract

`AgentControlContextV1` is a compact read projection, not authoritative state. Its root summary contains:

- workspace and projection watermarks;
- active Growth Plan, tracks, zero or one active Interview Campaign, and stable identifiers;
- deadlines, current capacity/availability, protected minima, blockers, unknown/stale counts, and near-term actions;
- aggregate versions required for optimistic concurrency;
- links or opaque references for selectively expanding one goal, track, campaign, target, or explanation.

The root summary has a hard serialized budget of 12 KiB and excludes raw evidence bodies, notes, provider payloads, secrets, and unrelated history. Detail resources are fetched only when the request requires them. An ETag or `changed_since` cursor allows incremental refresh.

`PlanChangeSet` states are `draft | previewed | applied | rejected | expired`. Preview is deterministic and reports:

- semantic operations and owning contexts;
- what stops, pauses, remains active, or is newly created;
- capacity and Today-plan impact;
- history retained;
- warnings, material unknowns, and required confirmations;
- expected versions and the base input watermark.

Reads and explanations do not require confirmation. Persisted plan changes require an explicit confirmation bound to the exact preview. Destructive deletion is not an agent operation in MVP; cancellation, ending, pausing, archiving, and superseding preserve history.
