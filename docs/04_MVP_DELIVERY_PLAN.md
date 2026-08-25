# PANDO — MVP Delivery Plan v0.2

## 1. MVP objective

Deliver a trustworthy end-to-end system for one initial technical target profile. It must turn roadmap requirements and real user evidence into an explainable daily recommendation, competency state, readiness breakdown, and review queue.

Optimize for a coherent vertical product, not maximum catalog size or visual spectacle.

## 2. MVP scope

### Must ship

- Authentication and single personal workspace.
- One versioned roadmap template and one target profile.
- One persistent Growth Plan containing multiple Learning Tracks and optional protected weekly cadence.
- Optional Interview Campaign that overlays deadline-driven priorities without replacing the Growth Plan.
- Competency DAG with prerequisite validation.
- Map plus Outline projections and competency inspector.
- Activities/resources with manual completion/attempt flow.
- Evidence ledger, corrections, provenance, and idempotency.
- Initial versioned mastery rules for representative activity types.
- Explainable readiness with mandatory floors, unknown, stale, and confidence.
- Today with deterministic next-best-action and alternatives.
- Focus Session and minimal optional feedback.
- Unified Review Center with multiple reasons and deduplication.
- User overlay for notes, workspace-scoped competencies, custom activities/resources, exclusions, reminders, mappings, and personal edges.
- Workspace-scoped target-profile draft/publish flow for imported vacancy content.
- Versioned Preparation Pack schema, context download, browser upload, validation, preview, and confirmed application; no hosted flow depends on a local watcher.
- Prompt Library with scenario cards, guided input checklist, copy action, expected-output explanation, and at least the core Growth Plan and Interview Campaign prompts.
- Versioned PyPrep adapter contract, tested mock, and manual path. A live connection is conditional on its event source being available and passing release gates.
- No required LLM API or per-token product cost; embedded Learning Partner is deferred or feature-flagged.
- Template upgrade preview/three-way merge proven by at least one controlled version change.
- Mobile-quality responsive Today, Review, Focus, notes, and Preparation Pack upload/preview; full graph editing remains desktop-first.
- RLS/authorization, audit basics, observability, accessibility, and reduced motion.

### Should ship if P0 is stable

- ChatGPT Work prompt template and one-command/context-file export for creating Preparation Packs.
- Live PyPrep connection if its source is available and stable.
- Optional embedded Learning Partner explanations and confirmed plan/activity proposals only if operating cost is accepted.
- URL metadata and suggested competency mapping.

### Later

- Multiple company comparison.
- Goal Simulator and capacity trade-offs.
- GitHub evidence adapter.
- Internal code runner/judge.
- Mock interview calibration and rubrics at scale.
- Mentor/public portfolio views.
- Outcome pipeline and statistically calibrated prediction research.

## 3. Delivery sequence

### Phase 0 — Foundation and executable decisions

Deliverables:

- repository architecture and module boundaries;
- accepted Phase 0 ADRs and [technical baseline](PHASE_0_TECHNICAL_BASELINE.md);
- schema/event conventions;
- design/motion/accessibility tokens;
- CI, migrations, test harness, local seed data;
- minimal transactional outbox table, dispatcher, idempotent consumer harness, and failure test;
- representative roadmap/profile fixture.

Exit: one command starts the product and tests; tenancy and module boundaries are testable.

### Phase 1 — Catalog, templates, targets, and overlay

Build competency DAG, activities/resources, versioned roadmap/profile with `Targets` ownership, explicit Growth Plan/Learning Track/Readiness Goal/Interview Campaign cardinality, personal-content overlay operations, Map/Outline read model, and inspector.

Exit: a user can select the seeded target, explore a stable graph, inspect requirements, add a note/custom activity, and retain overlay data across reloads.

### Phase 2 — Session lifecycle and evidence vertical slice

Build the reusable Focus Session lifecycle and attempt capture, append-only normalized evidence, correction/invalidation, mapping to competencies, first mastery projection, and history view. `ActivityStarted` and raw provider imports remain outside the evidence ledger. This phase provides session commands/components but not Today orchestration.

Exit: completing representative activities produces auditable evidence and recalculates affected competency states without direct status mutation.

### Phase 3 — Review Core, readiness, and explanation

First build the minimum Review Core required by Planning: review-item creation from evidence, due/overdue state, reason merge/deduplication, reschedule/skip/suppress actions, and deterministic queries. Then build target requirements, weights, mandatory floors, unknown/stale/confidence semantics, versioned readiness calculation, breakdown, blockers, and explanation.

Exit: due reviews are queryable and deterministic before Planning consumes them; the same evidence yields reproducible readiness; a mandatory blocker cannot be hidden by a high average; users can inspect supporting data.

### Phase 4 — Today, Focus, and Planning

Build Growth Plan tracks, capacity/availability, optional Interview Campaign requirement/allocation overrides, constraints, candidate generation, deterministic ranking, structured explanations, alternatives, and entry from Today/Review into the Phase 2 Focus Session lifecycle.

Exit: a user with seeded state can open Today, understand the recommendation, choose an alternative, and start within two actions. Activating or ending a campaign changes priorities without erasing the base plan or evidence.

### Phase 5 — Preparation Pack onboarding and Prompt Library

Build PreparationContext download, Preparation Pack schemas and storage, browser upload, immutable import audit, profile/personal-competency staging, validation, preview/diff, partial acceptance, confirmed application, and Prompt Library core scenarios. Add repository-folder import only as an optional development/self-hosted convenience.

Exit: a user can create or update a Growth Plan or Interview Campaign through ChatGPT Work and browser upload; new target/competency proposals remain workspace-scoped; invalid identifiers fail safely; PANDO runtime requires no AI service or filesystem watcher.

### Phase 6 — Integration and resilience

Validate the PyPrep contract against the tested mock and connect the live source only if available. Add integration inbox normalization, then harden the Phase 0 outbox with retry policies, dead-letter/replay tooling, monitoring, partial-failure UI, freshness, and manual fallback.

Exit: duplicate or delayed provider events do not duplicate evidence; provider failure does not block manual workflows.

### Phase 7 — Release hardening and responsive polish

Complete template-upgrade preview/merge, mobile-quality core surfaces, accessibility, motion modes, visual regression, security checks, backup/restore rehearsal, staged deployment/rollback, and representative performance testing. Embedded AI and a live PyPrep connection are not required for release.

Exit: all unconditional release acceptance scenarios pass on the hosted web flow, including browser-based pack import, responsive core work, template migration, accessibility, resilience, and performance budgets.

## 4. Recommended first vertical slice

Use a deliberately small seeded domain:

- Target: `NVIDIA Python/Verification Interview Ready` as a product fixture, with all weights clearly marked as initial curated assumptions until separately sourced and reviewed.
- Domains: Python, Algorithms, Linux, Networking, Testing.
- 15–25 competencies.
- 20–35 activities across manual coding, PyPrep-like recall, reading, explanation, and mock evidence.
- One mandatory-floor blocker.
- One stale competency and one unknown domain.

This fixture must prove semantics, not claim authoritative real-world company requirements. Production target profiles require documented sources, curator, review date, and freshness policy.

## 5. Definition of done for every feature

A feature is done only when:

- domain semantics match these documents;
- authorization and tenant isolation are tested;
- loading, empty, error, stale, and degraded states exist;
- relevant events are idempotent and observable;
- explanations/provenance are visible where the feature affects readiness or planning;
- keyboard and reduced-motion behavior work;
- tests cover the happy path and important failure/correction paths;
- documentation and ADRs reflect hard-to-reverse decisions;
- no AI or integration dependency silently becomes authoritative.

## 6. Release acceptance scenarios

1. **New user:** selects a target and sees `Unknown` states with onboarding actions, not zeros.
2. **First activity:** completes an activity; evidence is appended; competency becomes at most `Completed` under policy.
3. **Delayed verification:** later independent success upgrades qualifying state and schedules the next review.
4. **Mandatory blocker:** overall aggregate is high but the UI remains `Not ready` and names the blocker.
5. **Stale evidence:** old strength fades to stale while history remains visible.
6. **Merged review:** personal reminder and retention review become one queue item with two reasons.
7. **Correction:** user corrects an imported attempt; projections rebuild without deleting history.
8. **Provider outage:** Today, manual activity, evidence, and review still work; sync status is visible.
9. **Proposal confirmation:** a Preparation Pack proposes plan/profile changes; nothing authoritative persists until the user confirms the diff.
10. **Template upgrade:** new curated content appears while personal overlay and notes survive.
11. **Accessibility:** core flows work by keyboard with motion disabled and without color-only meaning.
12. **Performance:** representative graph data remains stable and interactive under the agreed budget.
13. **Preparation Pack:** an external pack is uploaded through the hosted browser flow, validated, and previewed; invalid references fail safely; accepted new profiles and competencies remain workspace-scoped versioned data.
14. **Global plus campaign plan:** a long-term LeetCode/Python/ML plan continues without a vacancy; starting a three-week campaign temporarily reallocates capacity; ending it restores the baseline with all new evidence retained.
15. **Responsive core:** Today, Review, Focus, notes, and pack upload/preview are usable at the agreed mobile viewport and pass keyboard/touch accessibility checks; full graph editing is not required on mobile.

## 7. Risks and mitigations

| Risk | Mitigation |
|---|---|
| False precision | Unknown/stale/confidence; versioned transparent formulas; no probability claims. |
| Domain collapse into generic nodes | Separate domain types and contracts; UI projection only. |
| Graph becomes the product bottleneck | Today/Focus/Review first-class; visible-subgraph rendering. |
| Provider dependency | Capability adapters, inbox/idempotency, manual fallback. |
| AI invents truth | Typed advisory proposals, validation, confirmation, deterministic engines. |
| Template/user conflicts | Versioned template plus overlay and deterministic merge preview. |
| Premature scale complexity | Modular monolith, workload model, profiling before decomposition. |
| Gamified busywork | Reward delayed and applied evidence, not clicks or coercive streaks. |

## 8. Decisions requiring product-owner approval later

- Production target profile content and evidence-backed company weights.
- Numeric mastery/readiness policy after prototype validation.
- Exact retention grading UX for each activity type.
- Data retention/export/deletion policy.
- Monetization, collaboration, mentor, and public sharing boundaries.
- Whether internal code execution is strategically central after MVP.

Until approved, agents should implement replaceable policy/configuration and avoid encoding guesses as permanent truth.
