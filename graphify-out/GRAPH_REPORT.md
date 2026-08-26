# Graph Report - PANDO  (2026-08-26)

## Corpus Check
- 279 files · ~168,099 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 4109 nodes · 5548 edges · 327 communities (299 shown, 28 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 57 edges (avg confidence: 0.87)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `4f353335`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Nine-file canonical documentation set
- activityState
- properties
- enum
- properties
- properties
- compilerOptions
- properties
- 20260825000200_identity_commands_outbox_tables.sql
- enum
- $defs
- properties
- canonicalCompetencyRef
- required
- required
- required
- detailRef
- Authentication, data access, and tenancy decision
- confidence
- contextFingerprint
- required
- properties
- properties
- Bounded contexts
- minimal/manifest.json
- devDependencies
- 20260825000300_identity_commands_outbox_rpcs.sql
- title
- growth-plan-minimal/manifest.json
- $defs
- Mastery and readiness policy v0.1
- properties
- schema-registry.ts
- properties
- properties
- properties
- claim
- properties
- properties
- $defs
- manifest.schema.json
- fixedNodeSize
- attainmentInterval
- effortRange
- nodeRequirementMember
- spacing
- properties
- properties
- $defs
- properties
- $defs
- generator
- growthPlan
- Agent Control Plane decision
- scripts
- workspaceScope
- required
- required
- required
- enum
- enum
- targetProfileRef
- 20260826000100_catalog_targets_overlay_tables.sql
- properties
- properties
- properties
- properties
- Graph-projection v1 schema documentation
- Preparation Pack ingestion decision
- required
- required
- competencySummary
- entityRef
- workspace
- properties
- properties
- $ref
- properties
- preparation-pack.test.ts
- required
- structuredExplanation
- properties
- properties
- preparation-pack.ts
- properties
- title
- projection-view.ts
- calculate-competency-state.ts
- required
- calculate-target-readiness.ts
- verify-auth-target-selection.mjs
- required
- schema_version
- enum
- weightedRequirementMember
- contract
- enum
- asJsonObject
- $ref
- properties
- unavailable_dates
- properties
- properties
- Agent Control Plane implementation design
- package.json
- enum
- preparation-context.schema.json
- kind
- $defs
- PANDO module topology and reading routes
- confirmation
- pando-backup.mjs
- properties
- required
- weightedThresholdRule
- Runtime, hosting, and toolchain decision
- properties
- edgeVisibilityHint
- graph-stress-materializer.ts
- enum
- enum
- backup.integration.mjs
- properties
- result
- $defs
- properties
- $defs
- 20260826000150_profile_scoped_overlay_and_catalog_dag.sql
- explore-target-context.schema.json
- required
- impacts
- properties
- properties
- properties
- dependencies
- PANDO commercial licensing information
- properties
- enum
- graph-projection.schema.json
- nodeVisibilityHint
- sourceRefs
- readinessGoal
- kOfNRule
- explore-source-v1.ts
- supabase/proxy.ts
- properties
- agent-control.ts
- required
- y
- enum
- enum
- required
- enum
- $defs
- properties
- e2e-server.mjs
- 002_identity_command_rls.test.sql
- .prettierrc.json
- database-target-selection.ts
- enum
- availableAtDetailLevels
- confidence
- properties
- catalog
- utcTimestamp
- contract
- paths
- phases
- sources
- start/page.tsx
- $defs
- database.ts
- Practical Python Growth Plan proposal
- Minimum Preparation Pack path
- 004_phase0_probe_effect_atomicity.test.sql
- enum
- app/page.tsx
- cadence_per_week
- preparation-plan.schema.json
- properties
- explore-target-context-v1.ts
- $ref
- 20260826000325_explore_target_context_owner_queries.sql
- Encrypted logical backup and clean-restore gate
- 20260826000175_readiness_goal_boundary.sql
- r2-plan.mjs
- required
- activityId
- common.schema.json
- validationResult
- canonicalCompetencyId
- target-selection-source.schema.json
- date
- packId
- 20260826000275_explore_source_owner_queries.sql
- requirementGroupId
- required
- properties
- $defs
- $ref
- start/actions.ts
- requirementSet
- properties
- target
- required
- properties
- interview_stages
- properties
- proposed_competencies
- enum
- unknowns
- vacancy_reference
- growthPlanFiles
- database-explore-target-context.ts
- control-context.schema.json
- fake-supabase-cli.mjs
- Phase 0 gate 9 - deterministic engine status
- enum
- app/layout.tsx
- UI
- 007_catalog_targets_overlay_atomic_concurrency.test.sql
- eslint.config.mjs
- next.config.ts
- properties
- semver
- supabase-config-boundary.test.mjs
- required
- enum
- postcss.config.mjs
- Domain-owned interfaces
- 003_outbox_delivery_lifecycle.test.sql
- Domain layer
- milestones
- blockers
- properties
- properties
- 009_catalog_publication_concurrency.test.sql
- 008_catalog_targets_overlay_integrity.test.sql
- enum
- overlay.positions
- overlay.positions
- sign-in/actions.ts
- phaseId
- properties
- unknowns
- 006_catalog_targets_overlay_behavior.test.sql
- positions
- properties
- ExploreSourceV1 server query contract
- explanationText
- threshold
- required
- required
- slug
- contract
- required
- goalText
- 010_target_selection_auth_boundary.test.sql
- allocation_minutes
- required
- knownEstimate
- Invite-only owner provisioning
- available_minutes
- overlay.personal_competencies
- overlay.custom_activities
- catalog.items
- overlay.custom_activities
- edges
- enum
- priority
- sourceText
- workspace
- properties
- title
- protected_minimum_minutes
- proposedCompetencyId
- sourceId
- canonicalEdges
- etag
- TargetSelectionSourceV1 server query contract
- jsdom
- @testing-library/jest-dom
- @vitest/coverage-v8
- identity.workspaces
- targets.target_profile_versions
- targets.readiness_goals
- enum
- explore-source.schema.json
- nodeRefArray
- milestoneId
- profileId
- initial_reviews
- enum
- requirement_groups
- sources
- workspaceText
- 011_explore_target_context_contract.test.sql
- detail_refs
- unitIntervalExclusiveZero
- sourcesDescriptor
- targetProfileDescriptor
- $ref
- company
- prerequisite_proposals
- requirements
- role
- catalog.competency_edges
- catalog.items
- unknownEstimate
- targets.target_requirement_rules

## God Nodes (most connected - your core abstractions)
1. `asJsonObject()` - 36 edges
2. `asString()` - 34 edges
3. `$defs` - 31 edges
4. `$defs` - 27 edges
5. `scripts` - 25 edges
6. `$defs` - 25 edges
7. `asArray()` - 25 edges
8. `asNumber()` - 22 edges
9. `validationResult` - 22 edges
10. `validateSchema()` - 22 edges

## Surprising Connections (you probably didn't know these)
- `Evidence` --semantically_similar_to--> `Evidence`  [INFERRED] [semantically similar]
  tests/fixtures/preparation-pack/valid/minimal/rationale.md → src/modules/evidence/README.md
- `Preparation Pack contract v1` --semantically_similar_to--> `Preparation Pack v1`  [INFERRED] [semantically similar]
  schemas/preparation-pack/v1/README.md → docs/adr/0005-preparation-pack-ingestion.md
- `Agent execution contract` --semantically_similar_to--> `PANDO agent instructions`  [INFERRED] [semantically similar]
  SOFTWARE_PROJECT_GUIDELINES.md → AGENTS.md
- `Preview-confirm-apply workflow` --semantically_similar_to--> `Conversational control interaction flow`  [INFERRED] [semantically similar]
  .agents/skills/pando-control/SKILL.md → docs/02_PRODUCT_AND_UX_SPEC.md
- `Unknown is not zero` --semantically_similar_to--> `Correctness and evidence`  [INFERRED] [semantically similar]
  docs/00_PRODUCT_CONSTITUTION.md → SOFTWARE_PROJECT_GUIDELINES.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Safe external agent control plane** — agents_skills_pando_control_skill_preview_confirm_apply, docs_01_domain_model_agent_control_context_v1, docs_01_domain_model_plan_change_set, docs_01_domain_model_apply_plan_change_set, docs_03_system_architecture_live_control_plane [EXTRACTED 1.00]
- **Zero-cost hosting stack** — docs_adr_0001_runtime_hosting_and_toolchain_vercel_hobby, docs_adr_0001_runtime_hosting_and_toolchain_supabase_free, docs_adr_0001_runtime_hosting_and_toolchain_cloudflare_r2_backup_storage [EXTRACTED 1.00]
- **Agent change application flow** — docs_adr_0008_agent_control_plane_agent_control_context_v1, docs_adr_0008_agent_control_plane_plan_change_set, docs_design_agent_control_plane_preview_plan_change_service, docs_design_agent_control_plane_apply_plan_change_set_command, docs_adr_0003_commands_outbox_and_jobs_transactional_outbox [EXTRACTED 1.00]
- **Canonical product and architecture baseline** — docs_readme_documentation_index, docs_00_product_constitution_product_constitution, docs_01_domain_model_domain_model, docs_02_product_and_ux_spec_product_and_ux_specification, docs_03_system_architecture_system_architecture, docs_04_mvp_delivery_plan_mvp_delivery_plan, docs_05_external_ai_preparation_pack_external_ai_preparation_pack, docs_06_prompt_library_ux_prompt_library_ux, software_project_guidelines_normative_guideline [EXTRACTED 1.00]
- **Evidence-to-daily projection pipeline** — docs_00_product_constitution_evidence_before_status, docs_01_domain_model_evidence_ledger, docs_01_domain_model_competency_state, docs_01_domain_model_readiness_projection, docs_02_product_and_ux_spec_today [EXTRACTED 1.00]
- **Module internal layers** — src_modules_readme_domain_layer, src_modules_readme_application_layer, src_modules_readme_infrastructure_layer [EXTRACTED 1.00]
- **PANDO deterministic responsibilities** — tests_fixtures_preparation_pack_valid_minimal_rationale_daily_planning, tests_fixtures_preparation_pack_valid_minimal_rationale_evidence, tests_fixtures_preparation_pack_valid_minimal_rationale_readiness [EXTRACTED 1.00]

## Communities (327 total, 28 thin omitted)

### Community 0 - "Nine-file canonical documentation set"
Cohesion: 0.05
Nodes (54): PANDO agent instructions, Product control safety rules, Graphify agent interface, Graphify for PANDO skill, Repository knowledge graph, PANDO Control agent interface, PANDO Control skill, Preview-confirm-apply workflow (+46 more)

### Community 1 - "activityState"
Cohesion: 0.05
Nodes (39): achievementLevel, AVAILABLE, estimate, evidenceExpectation, EXPECTED, IN_PROGRESS, lifecycleStatus, NONE (+31 more)

### Community 2 - "properties"
Cohesion: 0.08
Nodes (25): applied, expired, previewed, rejected, minimum, type, $ref, anyOf (+17 more)

### Community 3 - "enum"
Cohesion: 0.05
Nodes (40): accept_staged_personal_content, aggregate_ref, archive_growth_plan, archive_track, arguments, cancel_campaign, change_campaign_deadline, change_campaign_target (+32 more)

### Community 4 - "properties"
Cohesion: 0.10
Nodes (33): $ref, additionalProperties, properties, type, properties, const, allRule, mandatoryFloorRule (+25 more)

### Community 5 - "properties"
Cohesion: 0.12
Nodes (17): catalogVersionId, masteryPolicyVersion, readinessPolicyVersion, roadmapTemplateVersionId, $ref, $ref, catalogVersionId, masteryPolicyVersion (+9 more)

### Community 6 - "compilerOptions"
Cohesion: 0.07
Nodes (29): dom, dom.iterable, esnext, .next/dev/types/**/*.ts, .next/types/**/*.ts, node_modules, **/*.ts, **/*.tsx (+21 more)

### Community 7 - "properties"
Cohesion: 0.15
Nodes (13): items, maxItems, minItems, type, mockCheckpoint, $ref, additionalProperties, properties (+5 more)

### Community 8 - "20260825000200_identity_commands_outbox_tables.sql"
Cohesion: 0.13
Nodes (19): auth.users, identity, outbox, outbox.protect_completed_command_receipt, outbox.reject_consumer_receipt_mutation, outbox.reject_event_mutation, outbox.reject_phase0_probe_effect_mutation, completed_command_receipts_are_immutable (+11 more)

### Community 9 - "enum"
Cohesion: 0.08
Nodes (24): archive, cancel, change, complete, create, end, pause, replan (+16 more)

### Community 10 - "$defs"
Cohesion: 0.06
Nodes (36): additionalProperties, type, format, type, $defs, anyRule, dateTime, kOfNRule (+28 more)

### Community 11 - "properties"
Cohesion: 0.09
Nodes (22): keyboardOrder, outlineItemId, statusText, additionalProperties, properties, required, type, accessibility (+14 more)

### Community 12 - "canonicalCompetencyRef"
Cohesion: 0.10
Nodes (22): additionalProperties, properties, required, type, $ref, $ref, canonicalCompetencyRef, proposedCompetencyRef (+14 more)

### Community 13 - "required"
Cohesion: 0.13
Nodes (21): campaign_id, deadline, entity_id, goal_id, growth_plan_id, protected_minimum_minutes, readiness_goal_id, ref (+13 more)

### Community 14 - "required"
Cohesion: 0.10
Nodes (26): category, from, member_requirement_ids, minimum_level, relationship, requirement_group_id, requirement_id, rule (+18 more)

### Community 15 - "required"
Cohesion: 0.15
Nodes (13): excluded_items, initial_reviews, milestones, mock_checkpoints, paths, phases, plan_id, proposed_activities (+5 more)

### Community 16 - "detailRef"
Cohesion: 0.22
Nodes (9): detailRef, additionalProperties, properties, type, $ref, entity_id, kind, ref (+1 more)

### Community 17 - "Authentication, data access, and tenancy decision"
Cohesion: 0.16
Nodes (20): Authentication, data access, and tenancy decision, Private api schema, Purpose-specific Postgres RPC, Postgres row-level security, SQL migrations as the schema source, Supabase Auth, Workspace membership tenancy, Commands, outbox, and jobs decision (+12 more)

### Community 18 - "confidence"
Cohesion: 0.08
Nodes (34): activity_ids, competency_refs, impact, milestone_id, milestone_ids, not_before, objective, phase_id (+26 more)

### Community 19 - "contextFingerprint"
Cohesion: 0.12
Nodes (20): algorithm, canonicalization, digest, const, const, additionalProperties, properties, required (+12 more)

### Community 20 - "required"
Cohesion: 0.13
Nodes (15): interview_stages, metadata_confidence, metadata_source_refs, prerequisite_proposals, proposed_competencies, requirement_groups, role, sources (+7 more)

### Community 21 - "properties"
Cohesion: 0.20
Nodes (18): maximum, minimum, type, $ref, const, const, const, properties (+10 more)

### Community 22 - "properties"
Cohesion: 0.10
Nodes (20): additionalProperties, properties, type, items, maxItems, type, uniqueItems, capacity (+12 more)

### Community 23 - "Bounded contexts"
Cohesion: 0.13
Nodes (20): Canonical competency DAG, Catalog, Evidence, Immutable normalized evidence ledger, Identity and Workspace, Integrations, Normalized provider observations, Mastery (+12 more)

### Community 24 - "minimal/manifest.json"
Cohesion: 0.10
Nodes (19): files, algorithm, canonicalization, digest, generated_at, generator, label, prompt_id (+11 more)

### Community 25 - "devDependencies"
Cohesion: 0.06
Nodes (33): @axe-core/playwright, eslint, eslint-config-next, fast-check, devDependencies, @axe-core/playwright, eslint, eslint-config-next (+25 more)

### Community 26 - "20260825000300_identity_commands_outbox_rpcs.sql"
Cohesion: 0.13
Nodes (7): identity.users, identity.workspace_memberships, identity.can_bootstrap_owner_membership(), identity.current_user_id(), identity.is_workspace_member(), identity.personal_workspace_id_for_current_user(), identity.workspaces

### Community 27 - "title"
Cohesion: 0.17
Nodes (12): interview_campaign, $ref, growth_plan, enum, type, deadline, kind, title (+4 more)

### Community 28 - "growth-plan-minimal/manifest.json"
Cohesion: 0.11
Nodes (18): files, algorithm, canonicalization, digest, generated_at, generator, label, prompt_id (+10 more)

### Community 29 - "$defs"
Cohesion: 0.10
Nodes (20): fingerprint, $defs, inputContext, interviewCampaignFiles, preparationPlanDescriptor, rationaleDescriptor, additionalProperties, required (+12 more)

### Community 30 - "Mastery and readiness policy v0.1"
Cohesion: 0.17
Nodes (17): Calculation and review engines decision, Fixed MVP review engine, Pure deterministic calculation engines, Versioned projection snapshots, Achievement level, Mastery and readiness policy v0.1, Mastery-driven review triggers, Unknown mastery state (+9 more)

### Community 31 - "properties"
Cohesion: 0.12
Nodes (17): campaign, manual, review, $ref, properties, maximum, minimum, type (+9 more)

### Community 32 - "schema-registry.ts"
Cohesion: 0.19
Nodes (11): fieldFromPath(), JsonSchema, registry, schemaNames, schemasByName, structuralCode(), toViolation(), validateSchema() (+3 more)

### Community 33 - "properties"
Cohesion: 0.12
Nodes (17): critical, info, warning, additionalProperties, $ref, properties, type, blocker (+9 more)

### Community 34 - "properties"
Cohesion: 0.12
Nodes (17): $ref, $ref, $ref, $ref, $ref, $ref, $ref, properties (+9 more)

### Community 35 - "properties"
Cohesion: 0.08
Nodes (26): $ref, $ref, properties, maxLength, minLength, type, maximum, minimum (+18 more)

### Community 36 - "claim"
Cohesion: 0.12
Nodes (16): text, additionalProperties, properties, required, type, $ref, claim, confidence (+8 more)

### Community 37 - "properties"
Cohesion: 0.10
Nodes (23): $ref, properties, anyOf, format, type, $ref, properties, campaign_id (+15 more)

### Community 38 - "properties"
Cohesion: 0.09
Nodes (23): $ref, projectionNode, oneOf, $ref, $ref, $ref, additionalProperties, allOf (+15 more)

### Community 39 - "$defs"
Cohesion: 0.15
Nodes (12): additionalProperties, $defs, proposedCompetency, requirementRule, description, $id, additionalProperties, type (+4 more)

### Community 40 - "manifest.schema.json"
Cohesion: 0.13
Nodes (14): files, generator, input_context, pack_id, additionalProperties, allOf, description, $id (+6 more)

### Community 41 - "fixedNodeSize"
Cohesion: 0.13
Nodes (15): height, width, additionalProperties, properties, required, type, maximum, minimum (+7 more)

### Community 42 - "attainmentInterval"
Cohesion: 0.13
Nodes (15): lower, upper, additionalProperties, properties, required, type, attainmentInterval, maximum (+7 more)

### Community 43 - "effortRange"
Cohesion: 0.13
Nodes (15): maximum_minutes, minimum_minutes, effortRange, additionalProperties, properties, required, type, maximum (+7 more)

### Community 44 - "nodeRequirementMember"
Cohesion: 0.09
Nodes (24): nodeId, nodeRequirementMember, ruleRequirementMember, enum, APPLICATION, dimension, INTERVIEW_EXECUTION, KNOWLEDGE (+16 more)

### Community 45 - "spacing"
Cohesion: 0.13
Nodes (15): node, rank, maximum, minimum, type, node, rank, spacing (+7 more)

### Community 46 - "properties"
Cohesion: 0.11
Nodes (19): timezone, additionalProperties, properties, required, type, maxItems, type, uniqueItems (+11 more)

### Community 47 - "properties"
Cohesion: 0.13
Nodes (15): anyOf, const, format, type, anyOf, minimum, type, properties (+7 more)

### Community 48 - "$defs"
Cohesion: 0.13
Nodes (15): additionalProperties, type, $defs, campaign, goal, id, version, additionalProperties (+7 more)

### Community 49 - "properties"
Cohesion: 0.09
Nodes (22): type, projectionEdge, $ref, enum, ACTIVITY_EVIDENCES, PART_OF, PREREQUISITE_OF, RELATED_TO (+14 more)

### Community 50 - "$defs"
Cohesion: 0.06
Nodes (36): pattern, type, pattern, type, $defs, catalogVersionKey, competencyRef, domainRef (+28 more)

### Community 51 - "generator"
Cohesion: 0.10
Nodes (20): generator, additionalProperties, properties, required, type, label, maxLength, minLength (+12 more)

### Community 52 - "growthPlan"
Cohesion: 0.13
Nodes (15): growthPlan, additionalProperties, properties, required, type, title, tracks, title (+7 more)

### Community 53 - "Agent Control Plane decision"
Cohesion: 0.16
Nodes (14): AI and PyPrep boundaries decision, External agent control allowed, No embedded AI in Phase 0, PyPrep contract boundary, Agent Control Plane decision, External Agent Control Plane, Focused agent tool surface, Graphify GitHub repository (+6 more)

### Community 54 - "scripts"
Cohesion: 0.08
Nodes (25): scripts, backup:open, backup:r2-plan, backup:seal, build, dev, format, format:check (+17 more)

### Community 55 - "workspaceScope"
Cohesion: 0.14
Nodes (14): acceptedPersonalContentOnly, overlayRevision, const, workspaceId, $ref, acceptedPersonalContentOnly, overlayRevision, workspaceId (+6 more)

### Community 56 - "required"
Cohesion: 0.11
Nodes (19): accessibility, domainNodeId, edgeId, entityRef, explanations, inspectorRef, requirementState, shortLabel (+11 more)

### Community 57 - "required"
Cohesion: 0.40
Nodes (14): ruleId, required, required, accessibilityLabel, criticality, explanation, members, requiredCount (+6 more)

### Community 58 - "required"
Cohesion: 0.14
Nodes (14): action_id, blocker_id, detail_ref, duration_minutes, severity, source, additionalProperties, required (+6 more)

### Community 59 - "enum"
Cohesion: 0.25
Nodes (8): CRITICAL_PATH, MANDATORY_BLOCKER, PERSONAL_OVERLAY, REQUIRED_BY_TARGET, SELECTED_ACTIVITY, SELECTED_CONTEXT, STRUCTURAL_CONTEXT, enum

### Community 60 - "enum"
Cohesion: 0.14
Nodes (14): constraint, evidence_summary, today_explanation, track, unknown, capacity, goal, growth (+6 more)

### Community 61 - "targetProfileRef"
Cohesion: 0.14
Nodes (14): file, targetProfileRef, const, profile_id, profile_version, $ref, $ref, file (+6 more)

### Community 62 - "20260826000100_catalog_targets_overlay_tables.sql"
Cohesion: 0.09
Nodes (38): catalog.guard_roadmap_item_mutation, catalog.guard_roadmap_version_mutation, catalog.guard_version_child_mutation, catalog.catalog_versions, catalog.competency_edges, catalog_edges_follow_version_immutability, catalog.guard_roadmap_item_mutation(), catalog.guard_version_child_mutation() (+30 more)

### Community 63 - "properties"
Cohesion: 0.14
Nodes (14): track, maximum, minimum, type, priority, protected_minimum_minutes, track_id, maximum (+6 more)

### Community 64 - "properties"
Cohesion: 0.14
Nodes (14): $ref, items, maxItems, minItems, type, $ref, const, activity_id (+6 more)

### Community 65 - "properties"
Cohesion: 0.08
Nodes (26): important, supporting, enum, type, enum, type, requirement, blocking (+18 more)

### Community 66 - "properties"
Cohesion: 0.15
Nodes (13): requirementGroup, maxItems, minItems, type, uniqueItems, member_requirement_ids, requirement_group_id, rule (+5 more)

### Community 67 - "Graph-projection v1 schema documentation"
Cohesion: 0.24
Nodes (13): Accessible graph outline fallback, Deterministic Dagre layout, Graph layout and query boundary decision, GraphProjectionV1, Server and client graph ownership split, Graphify repository orientation graph, Four graph and contract separation, GraphProjectionV1 contract (+5 more)

### Community 68 - "Preparation Pack ingestion decision"
Cohesion: 0.22
Nodes (13): Bounded in-memory ZIP ingestion, Content-addressed object storage, Preparation Pack ingestion decision, Preparation Pack v1, Retention quota and cleanup policy, Structural and semantic validation, Provider-neutral Preparation Pack, Preparation Pack bulk import versus ChangeSet operations (+5 more)

### Community 69 - "required"
Cohesion: 0.20
Nodes (10): confirmed_at, expires_at, impacts, material_unknowns, preview_digest, preview_token, requires_confirmation, warnings (+2 more)

### Community 70 - "required"
Cohesion: 0.15
Nodes (13): layout, outline, projectionId, projectionState, selectedVersions, visibilityHints, workspaceScope, contract (+5 more)

### Community 71 - "competencySummary"
Cohesion: 0.12
Nodes (17): dimensions, $ref, additionalProperties, properties, required, type, competencySummary, maxItems (+9 more)

### Community 72 - "entityRef"
Cohesion: 0.29
Nodes (7): entityId, entityType, entityVersionId, entityRef, additionalProperties, required, type

### Community 73 - "workspace"
Cohesion: 0.15
Nodes (13): time_zone, workspace_id, workspace, time_zone, workspace_id, maxLength, minLength, type (+5 more)

### Community 74 - "properties"
Cohesion: 0.15
Nodes (13): $ref, const, properties, $ref, items, maxItems, type, algorithmVersion (+5 more)

### Community 75 - "properties"
Cohesion: 0.15
Nodes (13): oneOf, $ref, $ref, $ref, $ref, properties, files, generated_at (+5 more)

### Community 76 - "$ref"
Cohesion: 0.15
Nodes (13): items, maxItems, type, items, maxItems, type, $ref, items (+5 more)

### Community 77 - "properties"
Cohesion: 0.15
Nodes (13): $ref, $ref, $ref, $ref, $ref, properties, deadline, metadata_confidence (+5 more)

### Community 78 - "preparation-pack.test.ts"
Cohesion: 0.12
Nodes (27): JsonValue, PreparationCatalogState, PreparationPackInput, SchemaName, applyOracleOperation(), GraphCase, itemById(), OracleOperation (+19 more)

### Community 79 - "required"
Cohesion: 0.17
Nodes (12): active_campaign, blockers, capabilities, detail_refs, etag, goals, projection_watermark, today (+4 more)

### Community 80 - "structuredExplanation"
Cohesion: 0.17
Nodes (12): code, message, relatedNodeIds, relatedRuleIds, $ref, structuredExplanation, code, message (+4 more)

### Community 82 - "properties"
Cohesion: 0.13
Nodes (17): InterviewExecution, const, $ref, enum, type, Application, Knowledge, Recall (+9 more)

### Community 83 - "properties"
Cohesion: 0.15
Nodes (13): enum, type, sourced, unconfirmed, user-stated, maxLength, pattern, type (+5 more)

### Community 84 - "preparation-pack.ts"
Cohesion: 0.22
Nodes (19): asciiCompare(), canonicalize(), isJsonObject(), JsonPrimitive, maximumJsonNesting(), referenceKey(), sha256(), add() (+11 more)

### Community 85 - "properties"
Cohesion: 0.08
Nodes (25): $ref, prerequisiteProposal, maxLength, minLength, type, $ref, const, additionalProperties (+17 more)

### Community 86 - "title"
Cohesion: 0.12
Nodes (16): interviewStage, additionalProperties, properties, type, maximum, minimum, type, order (+8 more)

### Community 87 - "projection-view.ts"
Cohesion: 0.06
Nodes (59): ExploreLayout(), ExplorePage(), metadata, ExploreMapNode(), ExploreNodeInteraction, nodeTypeLabel(), nodeTypeLabels, chooseViewFocus() (+51 more)

### Community 88 - "calculate-competency-state.ts"
Cohesion: 0.05
Nodes (76): achievementLevel(), calculateCompetencyState(), calculateDimension(), estimateConfidence(), EvaluatedEvidence, EVIDENCE_ENGAGEMENTS, EVIDENCE_OUTCOMES, evidenceFingerprint() (+68 more)

### Community 89 - "required"
Cohesion: 0.18
Nodes (11): algorithmVersion, coordinateSystem, fixedNodeSize, layoutVersion, spacing, structuralFingerprint, positions, additionalProperties (+3 more)

### Community 90 - "calculate-target-readiness.ts"
Cohesion: 0.06
Nodes (61): ACHIEVEMENT_LEVELS, asRuleMemberInterval(), average(), calculateTargetReadiness(), evaluateMember(), evaluateRule(), compareDecisionWitnesses(), confidenceRank() (+53 more)

### Community 91 - "verify-auth-target-selection.mjs"
Cohesion: 0.06
Nodes (47): assertSafeScratch(), cleanup, closeRuntime(), cleanupAuthGate(), combineAuthGateErrors(), contextualCleanupError(), describeError(), formatAuthGateError() (+39 more)

### Community 92 - "required"
Cohesion: 0.44
Nodes (11): byte_length, checksum, encoding, media_type, path, schema_id, schema_version, required (+3 more)

### Community 93 - "schema_version"
Cohesion: 0.29
Nodes (7): $ref, $ref, properties, context_id, fingerprint, schema_version, const

### Community 94 - "enum"
Cohesion: 0.22
Nodes (9): growth_plan_change, interview_campaign_change, minimum, stretch, research, user_provided, enum, type (+1 more)

### Community 95 - "weightedRequirementMember"
Cohesion: 0.15
Nodes (13): weightedRequirementMember, member, weight, $ref, member, weight, exclusiveMinimum, maximum (+5 more)

### Community 96 - "contract"
Cohesion: 0.18
Nodes (11): additionalProperties, properties, required, type, name, version, const, contract (+3 more)

### Community 97 - "enum"
Cohesion: 0.18
Nodes (11): recruiter, vacancy, enum, type, research, sourced, unconfirmed, user_provided (+3 more)

### Community 98 - "asJsonObject"
Cohesion: 0.17
Nodes (27): addViolation(), computeGraphStructuralFingerprint(), graphHasCycle(), ids(), memberId(), objectArray(), requirementMembers(), validateGraphProjection() (+19 more)

### Community 99 - "$ref"
Cohesion: 0.13
Nodes (15): items, maxItems, type, items, maxItems, minItems, type, $ref (+7 more)

### Community 100 - "properties"
Cohesion: 0.18
Nodes (11): $ref, $ref, properties, outline, projectionId, readiness, requirements, visibilityHints (+3 more)

### Community 101 - "unavailable_dates"
Cohesion: 0.18
Nodes (11): items, maxItems, type, items, $ref, competency_summaries, unavailable_dates, items (+3 more)

### Community 102 - "properties"
Cohesion: 0.13
Nodes (15): $ref, $ref, $ref, properties, capacity, deadline, plan_id, proposed_activities (+7 more)

### Community 103 - "properties"
Cohesion: 0.11
Nodes (18): source, assertion_status, label, source_id, maxLength, minLength, type, maxLength (+10 more)

### Community 104 - "Agent Control Plane implementation design"
Cohesion: 0.29
Nodes (10): AgentControlContextV1, PlanChangeSet, Agent Control Plane implementation design, PreviewPlanChange service, Read, preview, and apply flow, Root context 12 KiB budget, AgentControlContextV1 JSON Schema, Agent-control v1 schema documentation (+2 more)

### Community 105 - "package.json"
Cohesion: 0.13
Nodes (14): description, engines, node, pnpm, homepage, license, name, packageManager (+6 more)

### Community 106 - "enum"
Cohesion: 0.29
Nodes (7): ACTIVE_PREREQUISITE, NAVIGATION_ONLY, PERSONAL_CONTEXT, SEMANTIC_CONTEXT, properties, reasonCode, enum

### Community 107 - "preparation-context.schema.json"
Cohesion: 0.12
Nodes (16): catalog, competency_summaries, context_fingerprint, exported_at, additionalProperties, description, $id, availability (+8 more)

### Community 108 - "kind"
Cohesion: 0.10
Nodes (22): floor, additionalProperties, properties, required, type, additionalProperties, properties, required (+14 more)

### Community 109 - "$defs"
Cohesion: 0.13
Nodes (18): last_meaningful_evidence_at, $defs, dimensionSummary, goal, knownDimensionSummary, unknownDimensionSummary, oneOf, oneOf (+10 more)

### Community 110 - "PANDO module topology and reading routes"
Cohesion: 0.09
Nodes (19): ADR-0009 — Module topology and derived projection ownership, Alternatives considered, Consequences, Context, Decision, Migration and rollback, Security and privacy, 1. Purpose (+11 more)

### Community 111 - "confirmation"
Cohesion: 0.20
Nodes (10): additionalProperties, properties, type, format, type, confirmation, pattern, type (+2 more)

### Community 112 - "pando-backup.mjs"
Cohesion: 0.10
Nodes (20): publishExtractedMembers(), stageBackupMember(), a, BM, command, decoded(), decrypt(), encrypt() (+12 more)

### Community 113 - "properties"
Cohesion: 0.20
Nodes (10): $ref, $ref, properties, calculationState, generatedAt, inputWatermark, semanticRevision, staleReason (+2 more)

### Community 114 - "required"
Cohesion: 0.12
Nodes (16): base_projection_watermark, change_set_id, confirmation, operations, preview, result, source_client, additionalProperties (+8 more)

### Community 115 - "weightedThresholdRule"
Cohesion: 0.20
Nodes (10): weightedThresholdRule, threshold, threshold, exclusiveMinimum, maximum, type, additionalProperties, properties (+2 more)

### Community 116 - "Runtime, hosting, and toolchain decision"
Cohesion: 0.22
Nodes (9): Cloudflare R2 backup storage, Modular monolith, Next.js 16, React 19, TypeScript, Node 24, and pnpm 11 toolchain, Portable Node runtime boundary, Runtime, hosting, and toolchain decision, Supabase Free managed platform, Vercel Hobby web hosting, pnpm workspace configuration (+1 more)

### Community 117 - "properties"
Cohesion: 0.14
Nodes (14): growthPlan, $ref, additionalProperties, properties, type, growth_plan_id, tracks, weekly_capacity_minutes (+6 more)

### Community 118 - "edgeVisibilityHint"
Cohesion: 0.22
Nodes (9): availableAtDetailLevels, defaultVisible, reasonCode, reasonCodes, edgeVisibilityHint, additionalProperties, required, type (+1 more)

### Community 119 - "graph-stress-materializer.ts"
Cohesion: 0.28
Nodes (20): baseRule(), canonicalOrigin(), competencyNodeId(), constants, directMember(), directRuleMap(), domainNodeId(), edge() (+12 more)

### Community 120 - "enum"
Cohesion: 0.22
Nodes (9): coding, mock_interview, enum, type, explanation, project, reading, recall (+1 more)

### Community 121 - "enum"
Cohesion: 0.22
Nodes (9): CodingAttemptAccepted, EvidenceSelfReportAdded, ExplanationAssessed, MockInterviewAssessed, ProjectArtifactVerified, ReviewGraded, enum, type (+1 more)

### Community 122 - "backup.integration.mjs"
Cohesion: 0.15
Nodes (17): archive, BACKUP_MAGIC, BUNDLE_MAGIC, cli, encodedLength(), encryptMalformedFixture(), expectInvalidBundle(), expectInvalidStorage() (+9 more)

### Community 123 - "properties"
Cohesion: 0.07
Nodes (27): initial_curated_assumption, reviewed, oneOf, $ref, oneOf, enum, stale, properties (+19 more)

### Community 124 - "result"
Cohesion: 0.12
Nodes (16): applied_at, plan_revision_id, resulting_projection_watermark, format, type, result, $ref, applied_at (+8 more)

### Community 125 - "$defs"
Cohesion: 0.22
Nodes (9): additionalProperties, type, $defs, arguments, id, maxLength, minLength, pattern (+1 more)

### Community 126 - "properties"
Cohesion: 0.07
Nodes (28): properties, $ref, format, type, format, type, $ref, enum (+20 more)

### Community 127 - "$defs"
Cohesion: 0.08
Nodes (26): pattern, type, $defs, catalogVersionKey, domainRef, edgeKey, goalKey, nodeRef (+18 more)

### Community 128 - "20260826000150_profile_scoped_overlay_and_catalog_dag.sql"
Cohesion: 0.15
Nodes (11): catalog.catalog_versions, catalog.roadmap_template_items, catalog.roadmap_template_versions, overlay.guard_custom_activity_profile_scope, catalog.validate_roadmap_for_publication(), catalog.validate_version_for_publication(), custom_activity_profile_scope, overlay.guard_custom_activity_profile_scope() (+3 more)

### Community 129 - "explore-target-context.schema.json"
Cohesion: 0.14
Nodes (13): readinessGoal, requirementRules, targetProfile, additionalProperties, description, $id, contract, overlayVersion (+5 more)

### Community 130 - "required"
Cohesion: 0.18
Nodes (11): activity_id, activity_type, competency_impacts, effort, expected_evidence, proposedActivity, lifecycle, scope (+3 more)

### Community 131 - "impacts"
Cohesion: 0.12
Nodes (16): items, maxItems, minItems, type, $ref, items, maxItems, minItems (+8 more)

### Community 132 - "properties"
Cohesion: 0.12
Nodes (20): protected_weekly_minutes, items, additionalProperties, maxLength, minLength, properties, required, type (+12 more)

### Community 133 - "properties"
Cohesion: 0.13
Nodes (15): items, maxItems, type, uniqueItems, path, items, maxItems, minItems (+7 more)

### Community 134 - "properties"
Cohesion: 0.07
Nodes (31): $ref, maximum, minimum, type, maximum, minimum, type, pattern (+23 more)

### Community 135 - "dependencies"
Cohesion: 0.10
Nodes (21): ajv, ajv-formats, @dagrejs/dagre, json-canonicalize, next, dependencies, ajv, ajv-formats (+13 more)

### Community 136 - "PANDO commercial licensing information"
Cohesion: 0.20
Nodes (8): Information required for an actual agreement, Legal disclaimer, No commercial license is granted here, Non-binding starting terms, PANDO commercial licensing information, Contributing to PANDO, Current contribution status, Why a CLA is required

### Community 137 - "properties"
Cohesion: 0.10
Nodes (26): properties, $ref, type, COMPETENCY, DOMAIN, $ref, const, enum (+18 more)

### Community 138 - "enum"
Cohesion: 0.29
Nodes (7): NOT_STARTED, objectiveLevel, COMPLETED, MASTERED, VERIFIED, enum, type

### Community 139 - "graph-projection.schema.json"
Cohesion: 0.29
Nodes (6): additionalProperties, description, $id, $schema, title, type

### Community 140 - "nodeVisibilityHint"
Cohesion: 0.20
Nodes (10): type, nodeVisibilityHint, additionalProperties, properties, type, defaultVisible, reasonCodes, items (+2 more)

### Community 141 - "sourceRefs"
Cohesion: 0.29
Nodes (7): sourceRefs, $ref, items, maxItems, minItems, type, uniqueItems

### Community 142 - "readinessGoal"
Cohesion: 0.12
Nodes (17): $ref, readinessGoal, aggregateVersion, lifecycle, readinessGoalId, readinessGoalKey, aggregateVersion, lifecycle (+9 more)

### Community 143 - "kOfNRule"
Cohesion: 0.20
Nodes (10): k, kOfNRule, maximum, minimum, type, additionalProperties, properties, required (+2 more)

### Community 144 - "explore-source-v1.ts"
Cohesion: 0.09
Nodes (25): ContractViolation, AuthenticatedUserScopedRpcClient, EXPLORE_SOURCE_RPC_V1, ExploreSourceAccessError, ExploreSourceQueryV1, loadDatabaseExploreSourceV1(), UserScopedRpcResult, validateQuery() (+17 more)

### Community 145 - "supabase/proxy.ts"
Cohesion: 0.15
Nodes (15): config, proxy(), isAllowedPublicKey(), isLoopbackHostname(), legacyJwtRole(), readSupabasePublicConfig(), SupabaseConfigurationError, SupabasePublicConfig (+7 more)

### Community 146 - "properties"
Cohesion: 0.15
Nodes (17): type, properties, $ref, enum, ACTIVITY_EVIDENCES, PART_OF, PREREQUISITE_OF, RELATED_TO (+9 more)

### Community 147 - "agent-control.ts"
Cohesion: 0.22
Nodes (11): add(), AgentChangeSetValidationOptions, AgentControlContextValidationOptions, objects(), OperationContract, operationContracts, validateAgentChangeSet(), validateAgentChangeSetSemantics() (+3 more)

### Community 148 - "required"
Cohesion: 0.14
Nodes (19): activityType, sourceVersionKey, targetCompetencyRef, additionalProperties, required, type, canonicalNode, overlayActivityNode (+11 more)

### Community 149 - "y"
Cohesion: 0.50
Nodes (4): y, maximum, minimum, type

### Community 150 - "enum"
Cohesion: 0.33
Nodes (6): enum, type, confidence, high, low, medium

### Community 151 - "enum"
Cohesion: 0.33
Nodes (6): enum, type, Stale, Strong, Weak, condition

### Community 152 - "required"
Cohesion: 0.10
Nodes (21): edgeCount, nodeCount, targetProfileVersionKey, x, y, position, catalogVersionKey, contract (+13 more)

### Community 153 - "enum"
Cohesion: 0.18
Nodes (11): apply_change_set, preview_change_goal, preview_change_set, preview_close_goal, preview_create_goal, read, items, type (+3 more)

### Community 154 - "$defs"
Cohesion: 0.10
Nodes (21): pattern, type, $defs, catalogVersionKey, profileSeriesKey, profileVersionKey, readinessGoalKey, roadmapVersionKey (+13 more)

### Community 155 - "properties"
Cohesion: 0.17
Nodes (12): owner, $ref, member, enum, displayName, membershipRole, workspaceId, workspaceKind (+4 more)

### Community 156 - "e2e-server.mjs"
Cohesion: 0.40
Nodes (5): nextCli, server, stopFile, stopServer(), stopWatcher

### Community 157 - "002_identity_command_rls.test.sql"
Cohesion: 0.40
Nodes (3): pg_temp.reject_outbox_event, command_results, pgtap_reject_outbox_event

### Community 158 - ".prettierrc.json"
Cohesion: 0.40
Nodes (4): printWidth, semi, singleQuote, trailingComma

### Community 159 - "database-target-selection.ts"
Cohesion: 0.18
Nodes (15): BOOTSTRAP_PERSONAL_WORKSPACE_RPC, bootstrapIdempotencyKey(), callRpc(), CREATE_READINESS_GOAL_RPC, DerivedReadinessGoalCommand, deriveReadinessGoalCommand(), ensurePersonalWorkspace(), exactKeys() (+7 more)

### Community 160 - "enum"
Cohesion: 0.25
Nodes (8): active, archived, completed, MASTERED, paused, VERIFIED, enum, enum

### Community 161 - "availableAtDetailLevels"
Cohesion: 0.40
Nodes (5): items, minItems, type, uniqueItems, availableAtDetailLevels

### Community 162 - "confidence"
Cohesion: 0.08
Nodes (30): $ref, properties, $ref, excludedItem, initialReview, additionalProperties, properties, type (+22 more)

### Community 163 - "properties"
Cohesion: 0.11
Nodes (18): pattern, type, active, archived, completed, paused, enum, $ref (+10 more)

### Community 164 - "catalog"
Cohesion: 0.22
Nodes (9): supported_competencies, additionalProperties, properties, required, type, $ref, catalog, catalog_version (+1 more)

### Community 165 - "utcTimestamp"
Cohesion: 0.40
Nodes (5): utcTimestamp, format, maxLength, pattern, type

### Community 166 - "contract"
Cohesion: 0.18
Nodes (11): additionalProperties, properties, required, type, name, version, const, contract (+3 more)

### Community 167 - "paths"
Cohesion: 0.40
Nodes (5): items, maxItems, minItems, type, paths

### Community 168 - "phases"
Cohesion: 0.40
Nodes (5): items, maxItems, minItems, type, phases

### Community 169 - "sources"
Cohesion: 0.40
Nodes (5): sources, items, maxItems, minItems, type

### Community 170 - "start/page.tsx"
Cohesion: 0.14
Nodes (13): dynamic, metadata, revalidate, StartPage(), mocks, profile, workspace, PandoDatabase (+5 more)

### Community 171 - "$defs"
Cohesion: 0.20
Nodes (10): additionalProperties, type, $defs, competencyImpact, milestone, source, additionalProperties, type (+2 more)

### Community 172 - "database.ts"
Cohesion: 0.11
Nodes (18): CompositeTypes, Constants, Database, DatabaseWithoutInternals, DefaultSchema, Enums, Json, Tables (+10 more)

### Community 173 - "Practical Python Growth Plan proposal"
Cohesion: 0.40
Nodes (5): Growth Plan, Practical Python Growth Plan proposal, Practical Python work, source:unconfirmed, source:user-goal

### Community 174 - "Minimum Preparation Pack path"
Cohesion: 0.40
Nodes (5): Minimum Preparation Pack path, Python parsing, Workspace-scoped proposed competency, source:unconfirmed, source:vacancy

### Community 176 - "enum"
Cohesion: 0.43
Nodes (7): ACTIVITY, GROUP, enum, COMPETENCY, DOMAIN, enum, nodeType

### Community 177 - "app/page.tsx"
Cohesion: 0.18
Nodes (9): FoundationPage(), phase0Capabilities, metadata, SignInPage(), initialMotionMode(), MotionMode, motionModes, SkipLink() (+1 more)

### Community 178 - "cadence_per_week"
Cohesion: 0.50
Nodes (4): maximum, minimum, type, cadence_per_week

### Community 179 - "preparation-plan.schema.json"
Cohesion: 0.25
Nodes (7): additionalProperties, allOf, description, $id, $schema, title, type

### Community 180 - "properties"
Cohesion: 0.08
Nodes (24): profileVersionId, readinessThreshold, rootRuleKey, $ref, targetProfile, catalogVersionKey, profileVersionKey, roadmapVersionKey (+16 more)

### Community 181 - "explore-target-context-v1.ts"
Cohesion: 0.15
Nodes (22): hasDuplicates(), isSorted(), addViolation(), ExploreTargetCanonicalEdgeV1, ExploreTargetCanonicalNodeV1, ExploreTargetNodeMemberV1, ExploreTargetOverlayNodeV1, ExploreTargetRequirementMemberV1 (+14 more)

### Community 182 - "$ref"
Cohesion: 0.20
Nodes (10): items, items, maxItems, type, $ref, goals, today, items (+2 more)

### Community 183 - "20260826000325_explore_target_context_owner_queries.sql"
Cohesion: 0.25
Nodes (3): overlay_source, targets.guard_root_weighted_threshold_on_publication(), target_source

### Community 184 - "Encrypted logical backup and clean-restore gate"
Cohesion: 0.29
Nodes (6): Boundary and status, Create, Encrypted logical backup and clean-restore gate, Restore, Retention and off-site boundary, Secret handling and cryptography

### Community 185 - "20260826000175_readiness_goal_boundary.sql"
Cohesion: 0.22
Nodes (8): overlay.guard_position_goal_scope, overlay_position_goal_scope, readiness_goal_profile_scope, identity.workspaces, targets.target_profile_versions, targets.guard_readiness_goal_profile_scope(), targets.readiness_goals, targets.guard_readiness_goal_profile_scope

### Community 186 - "r2-plan.mjs"
Cohesion: 0.33
Nodes (5): input, MAGIC, nonce, salt, values

### Community 187 - "required"
Cohesion: 0.13
Nodes (15): baseProfileVersionKey, companyName, freshnessStatus, profileSeriesKey, reviewedAt, roleTitle, sourceSummary, versionNumber (+7 more)

### Community 188 - "activityId"
Cohesion: 0.50
Nodes (4): maxLength, pattern, type, activityId

### Community 189 - "common.schema.json"
Cohesion: 0.50
Nodes (3): $id, $schema, title

### Community 190 - "validationResult"
Cohesion: 0.30
Nodes (10): acceptedRootEntries, isAbsoluteArchivePath(), normalizedArchivePath(), preparationPackLimits, reject(), RetentionQuotaInput, validateArchiveEntries(), validateArchiveLimits() (+2 more)

### Community 191 - "canonicalCompetencyId"
Cohesion: 0.50
Nodes (4): maxLength, pattern, type, canonicalCompetencyId

### Community 192 - "target-selection-source.schema.json"
Cohesion: 0.13
Nodes (14): profiles, readinessGoals, additionalProperties, description, $id, canonical, contract, workspace (+6 more)

### Community 193 - "date"
Cohesion: 0.50
Nodes (4): format, pattern, type, date

### Community 194 - "packId"
Cohesion: 0.50
Nodes (4): packId, maxLength, pattern, type

### Community 195 - "20260826000275_explore_source_owner_queries.sql"
Cohesion: 0.29
Nodes (3): selection, overlay_source, targets.get_explore_selection_impl()

### Community 196 - "requirementGroupId"
Cohesion: 0.50
Nodes (4): requirementGroupId, maxLength, pattern, type

### Community 197 - "required"
Cohesion: 0.18
Nodes (14): additionalProperties, required, type, canonicalNode, overlayNode, description, domainRef, nodeRef (+6 more)

### Community 198 - "properties"
Cohesion: 0.15
Nodes (16): properties, $ref, oneOf, $ref, COMPETENCY, DOMAIN, $ref, const (+8 more)

### Community 199 - "$defs"
Cohesion: 0.13
Nodes (15): oneOf, maxLength, pattern, type, $defs, competencyRef, contextId, planId (+7 more)

### Community 200 - "$ref"
Cohesion: 0.14
Nodes (14): items, maxItems, type, competencyRefArray, $ref, requiredOverlayNodes, requirementRules, items (+6 more)

### Community 201 - "start/actions.ts"
Cohesion: 0.30
Nodes (11): selectTargetAction(), setupPersonalWorkspaceAction(), signOutAction(), classes, mocks, createPandoServerActionClient(), verifyPandoSession(), SelectTargetForm() (+3 more)

### Community 202 - "requirementSet"
Cohesion: 0.13
Nodes (15): rootRuleId, rules, requirementSet, targetProfileVersionId, rootRuleId, rules, targetProfileVersionId, additionalProperties (+7 more)

### Community 203 - "properties"
Cohesion: 0.15
Nodes (13): items, maxItems, type, $ref, canonicalNodes, prerequisiteClosureNodeRefs, requiredCanonicalNodeRefs, requiredOverlayNodeRefs (+5 more)

### Community 204 - "target"
Cohesion: 0.29
Nodes (7): target, kind, title, additionalProperties, allOf, required, type

### Community 205 - "required"
Cohesion: 0.20
Nodes (14): additionalProperties, required, type, canonicalEdge, overlayEdge, blocking, edgeKey, edgeType (+6 more)

### Community 206 - "properties"
Cohesion: 0.17
Nodes (12): $ref, properties, overlayVersion, readinessGoal, scope, targetProfile, workspaceId, $ref (+4 more)

### Community 207 - "interview_stages"
Cohesion: 0.50
Nodes (4): items, maxItems, type, interview_stages

### Community 208 - "properties"
Cohesion: 0.09
Nodes (23): additionalProperties, properties, required, type, $ref, name, version, const (+15 more)

### Community 209 - "proposed_competencies"
Cohesion: 0.50
Nodes (4): proposed_competencies, items, maxItems, type

### Community 210 - "enum"
Cohesion: 0.33
Nodes (6): api, chatgpt_work, codex, web, source_client, enum

### Community 211 - "unknowns"
Cohesion: 0.50
Nodes (4): unknowns, items, maxItems, type

### Community 212 - "vacancy_reference"
Cohesion: 0.50
Nodes (4): vacancy_reference, maxLength, pattern, type

### Community 213 - "growthPlanFiles"
Cohesion: 0.29
Nodes (7): growthPlanFiles, description, items, maxItems, minItems, prefixItems, type

### Community 214 - "database-explore-target-context.ts"
Cohesion: 0.19
Nodes (8): EXPLORE_TARGET_CONTEXT_RPC_V1, ExploreTargetContextAccessError, ExploreTargetContextQueryV1, ExploreTargetContextRpcClient, ExploreTargetContextRpcResult, loadDatabaseExploreTargetContextV1(), ExploreTargetContextContractError, ExploreTargetContextV1

### Community 215 - "control-context.schema.json"
Cohesion: 0.33
Nodes (5): additionalProperties, $id, $schema, title, type

### Community 216 - "fake-supabase-cli.mjs"
Cohesion: 0.50
Nodes (3): command, rawArguments, workdirIndex

### Community 218 - "enum"
Cohesion: 0.33
Nodes (6): MANUAL_CODING, MOCK, enum, EXPLANATION, PROJECT, READING

### Community 220 - "UI"
Cohesion: 0.67
Nodes (3): Application layer, UI, UI projections

### Community 221 - "007_catalog_targets_overlay_atomic_concurrency.test.sql"
Cohesion: 0.40
Nodes (4): pg_temp.phase1_concurrency_fixture, pg_temp.reject_phase1_atomic_event, pg_temp.reject_phase1_atomic_event(), pgtap_reject_phase1_atomic_event

### Community 226 - "properties"
Cohesion: 0.09
Nodes (22): $ref, enum, $ref, oneOf, DIFFERENTIATING, MANDATORY, PREFERRED, items (+14 more)

### Community 227 - "semver"
Cohesion: 0.50
Nodes (4): semver, maxLength, pattern, type

### Community 229 - "required"
Cohesion: 0.20
Nodes (10): profileRoleTitle, readinessGoal, aggregateVersion, lifecycle, profileVersionKey, readinessGoalKey, title, additionalProperties (+2 more)

### Community 231 - "enum"
Cohesion: 0.50
Nodes (4): enum, DIFFERENTIATING, MANDATORY, PREFERRED

### Community 239 - "milestones"
Cohesion: 0.40
Nodes (5): items, maxItems, minItems, type, milestones

### Community 244 - "blockers"
Cohesion: 0.67
Nodes (3): maxItems, type, blockers

### Community 245 - "properties"
Cohesion: 0.08
Nodes (24): const, additionalProperties, properties, required, type, canonicalEdge, pattern, type (+16 more)

### Community 246 - "properties"
Cohesion: 0.12
Nodes (17): workspace_overlay, enum, APPLICATION, canonical, INTERVIEW_EXECUTION, KNOWLEDGE, RECALL, const (+9 more)

### Community 250 - "enum"
Cohesion: 0.22
Nodes (9): cancelled, ended, superseded, active, archived, completed, draft, paused (+1 more)

### Community 254 - "sign-in/actions.ts"
Cohesion: 0.44
Nodes (5): signInAction(), mocks, initialSignInActionState, SignInActionState, SignInForm()

### Community 255 - "phaseId"
Cohesion: 0.50
Nodes (4): phaseId, maxLength, pattern, type

### Community 256 - "properties"
Cohesion: 0.33
Nodes (6): $ref, properties, oneOf, entityId, entityType, entityVersionId

### Community 257 - "unknowns"
Cohesion: 0.50
Nodes (4): unknowns, items, maxItems, type

### Community 258 - "006_catalog_targets_overlay_behavior.test.sql"
Cohesion: 0.50
Nodes (3): phase1_results, phase1_rule_map, phase1_workspaces

### Community 259 - "positions"
Cohesion: 0.40
Nodes (5): $ref, items, maxItems, type, positions

### Community 260 - "properties"
Cohesion: 0.10
Nodes (22): preview, format, type, maxLength, minLength, type, items, maxItems (+14 more)

### Community 261 - "ExploreSourceV1 server query contract"
Cohesion: 0.25
Nodes (6): Boundary and security invariants, Compatibility, ExploreSourceV1 server query contract, Deterministic closure, ExploreTargetContextV1 server query contract, Security and compatibility

### Community 262 - "explanationText"
Cohesion: 0.40
Nodes (5): explanationText, maxLength, minLength, pattern, type

### Community 263 - "threshold"
Cohesion: 0.50
Nodes (4): threshold, exclusiveMinimum, maximum, type

### Community 264 - "required"
Cohesion: 0.18
Nodes (11): canonicalEdges, canonicalNodes, prerequisiteClosureNodeRefs, requiredCanonicalNodeRefs, requiredOverlayNodeRefs, requiredOverlayNodes, roadmapNodeRefs, scope (+3 more)

### Community 265 - "required"
Cohesion: 0.15
Nodes (14): nodeScope, ruleKey, nodeRequirementMember, ruleRequirementMember, dimension, memberType, requiredLevel, weight (+6 more)

### Community 266 - "slug"
Cohesion: 0.50
Nodes (4): slug, maxLength, pattern, type

### Community 267 - "contract"
Cohesion: 0.18
Nodes (11): additionalProperties, properties, required, type, name, version, const, contract (+3 more)

### Community 268 - "required"
Cohesion: 0.18
Nodes (11): requirementRule, accessibilityLabel, criticality, explanation, members, requiredCount, ruleType, threshold (+3 more)

### Community 269 - "goalText"
Cohesion: 0.40
Nodes (5): goalText, maxLength, minLength, pattern, type

### Community 270 - "010_target_selection_auth_boundary.test.sql"
Cohesion: 0.33
Nodes (4): pg_temp.reject_target_selection_outbox_event, pgtap_reject_target_selection_outbox_event, target_selection_results, target_selection_workspaces

### Community 271 - "allocation_minutes"
Cohesion: 0.50
Nodes (4): maximum, minimum, type, allocation_minutes

### Community 272 - "required"
Cohesion: 0.22
Nodes (9): calculationState, generatedAt, inputWatermark, semanticRevision, staleReason, additionalProperties, required, type (+1 more)

### Community 273 - "knownEstimate"
Cohesion: 0.25
Nodes (9): lastMeaningfulEvidenceAt, knownEstimate, availability, condition, confidence, additionalProperties, required, type (+1 more)

### Community 274 - "Invite-only owner provisioning"
Cohesion: 0.40
Nodes (4): Hosted deployment, Invite-only owner provisioning, Local development, Safety rules

### Community 275 - "available_minutes"
Cohesion: 0.50
Nodes (4): maximum, minimum, type, available_minutes

### Community 280 - "edges"
Cohesion: 0.22
Nodes (9): items, maxItems, type, oneOf, items, maxItems, type, edges (+1 more)

### Community 281 - "enum"
Cohesion: 0.25
Nodes (8): CURRENT, ERROR, REBUILDING, enum, enum, STALE, STRONG, WEAK

### Community 282 - "priority"
Cohesion: 0.50
Nodes (4): maximum, minimum, type, priority

### Community 283 - "sourceText"
Cohesion: 0.40
Nodes (5): sourceText, maxLength, minLength, pattern, type

### Community 285 - "workspace"
Cohesion: 0.25
Nodes (8): displayName, membershipRole, workspaceKind, workspace, workspaceId, additionalProperties, required, type

### Community 286 - "properties"
Cohesion: 0.29
Nodes (8): const, properties, $ref, type, availability, condition, lastMeaningfulEvidenceAt, properties

### Community 287 - "title"
Cohesion: 0.50
Nodes (4): title, maxLength, minLength, type

### Community 288 - "protected_minimum_minutes"
Cohesion: 0.50
Nodes (4): protected_minimum_minutes, maximum, minimum, type

### Community 289 - "proposedCompetencyId"
Cohesion: 0.50
Nodes (4): proposedCompetencyId, maxLength, pattern, type

### Community 290 - "sourceId"
Cohesion: 0.50
Nodes (4): sourceId, maxLength, pattern, type

### Community 291 - "canonicalEdges"
Cohesion: 0.50
Nodes (4): items, maxItems, type, canonicalEdges

### Community 292 - "etag"
Cohesion: 0.67
Nodes (3): pattern, type, etag

### Community 302 - "enum"
Cohesion: 0.29
Nodes (7): ALL, ANY, K_OF_N, WEIGHTED_THRESHOLD, MANDATORY_FLOOR, ruleType, enum

### Community 303 - "explore-source.schema.json"
Cohesion: 0.29
Nodes (6): additionalProperties, description, $id, $schema, title, type

### Community 304 - "nodeRefArray"
Cohesion: 0.50
Nodes (4): nodeRefArray, items, maxItems, type

### Community 305 - "milestoneId"
Cohesion: 0.50
Nodes (4): milestoneId, maxLength, pattern, type

### Community 306 - "profileId"
Cohesion: 0.50
Nodes (4): profileId, maxLength, pattern, type

### Community 307 - "initial_reviews"
Cohesion: 0.50
Nodes (4): items, maxItems, type, initial_reviews

### Community 308 - "enum"
Cohesion: 0.40
Nodes (5): enum, HIGH, LOW, MEDIUM, confidence

### Community 309 - "requirement_groups"
Cohesion: 0.40
Nodes (5): requirement_groups, items, maxItems, minItems, type

### Community 310 - "sources"
Cohesion: 0.40
Nodes (5): sources, items, maxItems, minItems, type

### Community 311 - "workspaceText"
Cohesion: 0.40
Nodes (5): workspaceText, maxLength, minLength, pattern, type

### Community 312 - "011_explore_target_context_contract.test.sql"
Cohesion: 0.50
Nodes (3): target_context_mutation_baseline, target_context_results, target_context_workspaces

### Community 313 - "detail_refs"
Cohesion: 0.50
Nodes (4): items, maxItems, type, detail_refs

### Community 314 - "unitIntervalExclusiveZero"
Cohesion: 0.50
Nodes (4): unitIntervalExclusiveZero, exclusiveMinimum, maximum, type

### Community 315 - "sourcesDescriptor"
Cohesion: 0.67
Nodes (3): sourcesDescriptor, additionalProperties, type

### Community 316 - "targetProfileDescriptor"
Cohesion: 0.67
Nodes (3): targetProfileDescriptor, additionalProperties, type

### Community 317 - "$ref"
Cohesion: 0.33
Nodes (6): items, maxItems, type, $ref, items, assumptions

### Community 318 - "company"
Cohesion: 0.50
Nodes (4): maxLength, minLength, type, company

### Community 319 - "prerequisite_proposals"
Cohesion: 0.50
Nodes (4): items, maxItems, type, prerequisite_proposals

### Community 320 - "requirements"
Cohesion: 0.40
Nodes (5): requirements, items, maxItems, minItems, type

### Community 321 - "role"
Cohesion: 0.50
Nodes (4): role, maxLength, minLength, type

### Community 325 - "unknownEstimate"
Cohesion: 0.67
Nodes (3): unknownEstimate, additionalProperties, type

## Knowledge Gaps
- **2034 isolated node(s):** `printWidth`, `semi`, `singleQuote`, `trailingComma`, `eslintConfig` (+2029 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **28 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `$defs` connect `$defs` to `activityState`, `properties`, `unknownEstimate`, `properties`, `entityRef`, `attainmentInterval`, `properties`, `graph-projection.schema.json`, `nodeRequirementMember`, `nodeVisibilityHint`, `requirementSet`, `structuredExplanation`, `knownEstimate`, `properties`, `edgeVisibilityHint`, `weightedRequirementMember`?**
  _High betweenness centrality (0.131) - this node is a cross-community bridge._
- **Why does `$defs` connect `$defs` to `enum`, `slug`, `canonicalCompetencyRef`, `sourceRefs`, `contextFingerprint`, `enum`, `proposedCompetencyId`, `sourceId`, `claim`, `utcTimestamp`, `effortRange`, `milestoneId`, `profileId`, `activityId`, `common.schema.json`, `canonicalCompetencyId`, `date`, `packId`, `requirementGroupId`, `semver`, `phaseId`?**
  _High betweenness centrality (0.091) - this node is a cross-community bridge._
- **Why does `$defs` connect `$defs` to `enum`, `properties`, `enum`, `confirmation`, `required`, `result`?**
  _High betweenness centrality (0.082) - this node is a cross-community bridge._
- **What connects `printWidth`, `semi`, `singleQuote` to the rest of the system?**
  _2034 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Nine-file canonical documentation set` be split into smaller, more focused modules?**
  _Cohesion score 0.05101327742837177 - nodes in this community are weakly interconnected._
- **Should `activityState` be split into smaller, more focused modules?**
  _Cohesion score 0.05263157894736842 - nodes in this community are weakly interconnected._
- **Should `properties` be split into smaller, more focused modules?**
  _Cohesion score 0.08 - nodes in this community are weakly interconnected._