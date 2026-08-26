# Graph Report - PANDO  (2026-08-26)

## Corpus Check
- 204 files · ~136,588 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 3151 nodes · 4198 edges · 255 communities (240 shown, 15 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 51 edges (avg confidence: 0.87)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `9c0dc7b6`
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
- confidence
- 20260825000200_identity_commands_outbox_tables.sql
- enum
- $defs
- properties
- canonicalCompetencyRef
- required
- required
- required
- properties
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
- target
- growth-plan-minimal/manifest.json
- $defs
- Mastery and readiness policy v0.1
- properties
- properties
- properties
- properties
- properties
- claim
- properties
- properties
- target-profile.schema.json
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
- milestoneId
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
- properties
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
- verify-database-core.mjs
- required
- schema_version
- enum
- weightedRequirementMember
- contract
- enum
- properties
- $ref
- properties
- dimensions
- properties
- properties
- Agent Control Plane implementation design
- package.json
- edgeVisibilityHint
- required
- kOfNRule
- required
- PANDO module topology and reading routes
- confirmation
- pando-backup.mjs
- properties
- $defs
- weightedThresholdRule
- Runtime, hosting, and toolchain decision
- enum
- nodeVisibilityHint
- graph-stress-materializer.ts
- enum
- enum
- backup.integration.mjs
- knownEstimate
- properties
- $defs
- properties
- detailRef
- 20260826000150_profile_scoped_overlay_and_catalog_dag.sql
- mandatoryFloorRule
- items
- impacts
- properties
- properties
- $defs
- dependencies
- PANDO commercial licensing information
- result
- enum
- graph-projection.schema.json
- properties
- sourceRefs
- required
- interviewCampaignFiles
- preparation-context.schema.json
- constraints
- source
- enum
- properties
- properties
- enum
- enum
- required
- kind
- assumptions
- required
- e2e-server.mjs
- 002_identity_command_rls.test.sql
- .prettierrc.json
- enum
- enum
- availableAtDetailLevels
- required
- properties
- catalog
- utcTimestamp
- milestones
- paths
- phases
- sources
- requirement_groups
- requirements
- sources
- Practical Python Growth Plan proposal
- Minimum Preparation Pack path
- 004_phase0_probe_effect_atomicity.test.sql
- enum
- available_minutes
- cadence_per_week
- lifecycle_reason
- priority
- protected_minimum_minutes
- title
- weekly_capacity_minutes
- Encrypted logical backup and clean-restore gate
- 20260826000175_readiness_goal_boundary.sql
- r2-plan.mjs
- $defs
- profileId
- common.schema.json
- activityId
- canonicalCompetencyId
- contextId
- date
- packId
- phaseId
- $defs
- properties
- kind
- sourceId
- excluded_items
- milestone_ids
- enum
- initial_reviews
- mock_checkpoints
- enum
- company
- interview_stages
- prerequisite_proposals
- $ref
- role
- unknowns
- vacancy_reference
- growthPlanFiles
- staged_item_ids
- proposed_activities
- fake-supabase-cli.mjs
- Phase 0 gate 9 - deterministic engine status
- repository
- app/layout.tsx
- UI
- 007_catalog_targets_overlay_atomic_concurrency.test.sql
- eslint.config.mjs
- next.config.ts
- enum
- semver
- supabase-config-boundary.test.mjs
- unknownEstimate
- enum
- postcss.config.mjs
- Domain-owned interfaces
- 003_outbox_delivery_lifecycle.test.sql
- Domain layer
- planId
- proposedCompetencyId
- competency_summaries
- 006_catalog_targets_overlay_behavior.test.sql
- 009_catalog_publication_concurrency.test.sql
- 008_catalog_targets_overlay_integrity.test.sql
- overlay.custom_activities
- overlay.positions
- overlay.positions

## God Nodes (most connected - your core abstractions)
1. `$defs` - 31 edges
2. `$defs` - 27 edges
3. `scripts` - 24 edges
4. `enum` - 21 edges
5. `asJsonObject()` - 21 edges
6. `validatePreparationPackSemantics()` - 20 edges
7. `isJsonObject()` - 19 edges
8. `compilerOptions` - 19 edges
9. `required` - 18 edges
10. `validateGraphProjectionSemantics()` - 17 edges

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

## Communities (255 total, 15 thin omitted)

### Community 0 - "Nine-file canonical documentation set"
Cohesion: 0.05
Nodes (54): PANDO agent instructions, Product control safety rules, Graphify agent interface, Graphify for PANDO skill, Repository knowledge graph, PANDO Control agent interface, PANDO Control skill, Preview-confirm-apply workflow (+46 more)

### Community 1 - "activityState"
Cohesion: 0.04
Nodes (48): achievementLevel, AVAILABLE, estimate, evidenceExpectation, EXPECTED, IN_PROGRESS, INTERVIEW_EXECUTION, lifecycleStatus (+40 more)

### Community 2 - "properties"
Cohesion: 0.04
Nodes (47): api, applied, base_projection_watermark, change_set_id, chatgpt_work, codex, confirmation, expired (+39 more)

### Community 3 - "enum"
Cohesion: 0.10
Nodes (21): accept_staged_personal_content, archive_growth_plan, archive_track, cancel_campaign, change_campaign_deadline, change_campaign_target, complete_track, create_goal (+13 more)

### Community 4 - "properties"
Cohesion: 0.08
Nodes (40): $ref, additionalProperties, properties, type, additionalProperties, properties, type, const (+32 more)

### Community 5 - "properties"
Cohesion: 0.06
Nodes (32): catalogVersionId, masteryPolicyVersion, readinessPolicyVersion, roadmapTemplateVersionId, rootRuleId, rules, targetProfileVersionId, $ref (+24 more)

### Community 6 - "compilerOptions"
Cohesion: 0.07
Nodes (29): dom, dom.iterable, esnext, .next/dev/types/**/*.ts, .next/types/**/*.ts, node_modules, **/*.ts, **/*.tsx (+21 more)

### Community 7 - "confidence"
Cohesion: 0.10
Nodes (23): $ref, properties, $ref, excludedItem, additionalProperties, properties, type, exclusiveMinimum (+15 more)

### Community 8 - "20260825000200_identity_commands_outbox_tables.sql"
Cohesion: 0.13
Nodes (19): auth.users, identity, outbox, outbox.protect_completed_command_receipt, outbox.reject_consumer_receipt_mutation, outbox.reject_event_mutation, outbox.reject_phase0_probe_effect_mutation, completed_command_receipts_are_immutable (+11 more)

### Community 9 - "enum"
Cohesion: 0.08
Nodes (24): archive, cancel, change, complete, create, end, pause, replan (+16 more)

### Community 10 - "$defs"
Cohesion: 0.06
Nodes (33): format, type, $defs, dateTime, kOfNRule, origin, requirementMember, requirementRule (+25 more)

### Community 11 - "properties"
Cohesion: 0.09
Nodes (22): keyboardOrder, outlineItemId, statusText, additionalProperties, properties, required, type, accessibility (+14 more)

### Community 12 - "canonicalCompetencyRef"
Cohesion: 0.10
Nodes (22): additionalProperties, properties, required, type, $ref, $ref, canonicalCompetencyRef, proposedCompetencyRef (+14 more)

### Community 13 - "required"
Cohesion: 0.13
Nodes (22): campaign_id, deadline, entity_id, goal_id, growth_plan_id, protected_minimum_minutes, readiness_goal_id, ref (+14 more)

### Community 14 - "required"
Cohesion: 0.13
Nodes (19): from, member_requirement_ids, relationship, requirement_group_id, rule, stage_id, to, required (+11 more)

### Community 15 - "required"
Cohesion: 0.10
Nodes (20): excluded_items, initial_reviews, milestones, mock_checkpoints, paths, phases, plan_id, proposed_activities (+12 more)

### Community 16 - "properties"
Cohesion: 0.14
Nodes (14): growthPlan, $ref, additionalProperties, properties, type, growth_plan_id, tracks, weekly_capacity_minutes (+6 more)

### Community 17 - "Authentication, data access, and tenancy decision"
Cohesion: 0.16
Nodes (20): Authentication, data access, and tenancy decision, Private api schema, Purpose-specific Postgres RPC, Postgres row-level security, SQL migrations as the schema source, Supabase Auth, Workspace membership tenancy, Commands, outbox, and jobs decision (+12 more)

### Community 18 - "confidence"
Cohesion: 0.13
Nodes (23): competency_refs, impact, milestone_id, not_before, objective, phase_id, protected_growth_minutes, scheduled_on (+15 more)

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
Cohesion: 0.05
Nodes (39): @axe-core/playwright, eslint, eslint-config-next, fast-check, jsdom, devDependencies, @axe-core/playwright, eslint (+31 more)

### Community 26 - "20260825000300_identity_commands_outbox_rpcs.sql"
Cohesion: 0.13
Nodes (7): identity.users, identity.workspace_memberships, identity.can_bootstrap_owner_membership(), identity.current_user_id(), identity.is_workspace_member(), identity.personal_workspace_id_for_current_user(), identity.workspaces

### Community 27 - "target"
Cohesion: 0.11
Nodes (19): interview_campaign, $ref, target, growth_plan, kind, title, enum, type (+11 more)

### Community 28 - "growth-plan-minimal/manifest.json"
Cohesion: 0.11
Nodes (18): files, algorithm, canonicalization, digest, generated_at, generator, label, prompt_id (+10 more)

### Community 29 - "$defs"
Cohesion: 0.11
Nodes (19): fingerprint, $defs, inputContext, preparationPlanDescriptor, rationaleDescriptor, sourcesDescriptor, targetProfileDescriptor, additionalProperties (+11 more)

### Community 30 - "Mastery and readiness policy v0.1"
Cohesion: 0.17
Nodes (17): Calculation and review engines decision, Fixed MVP review engine, Pure deterministic calculation engines, Versioned projection snapshots, Achievement level, Mastery and readiness policy v0.1, Mastery-driven review triggers, Unknown mastery state (+9 more)

### Community 31 - "properties"
Cohesion: 0.12
Nodes (17): campaign, manual, review, $ref, properties, maximum, minimum, type (+9 more)

### Community 32 - "properties"
Cohesion: 0.15
Nodes (13): items, maxItems, minItems, type, mockCheckpoint, $ref, additionalProperties, properties (+5 more)

### Community 33 - "properties"
Cohesion: 0.14
Nodes (14): critical, info, warning, $ref, properties, anyOf, maxLength, minLength (+6 more)

### Community 34 - "properties"
Cohesion: 0.12
Nodes (17): $ref, $ref, $ref, $ref, $ref, $ref, $ref, properties (+9 more)

### Community 35 - "properties"
Cohesion: 0.13
Nodes (15): $ref, maxLength, minLength, type, maximum, minimum, type, $ref (+7 more)

### Community 36 - "claim"
Cohesion: 0.12
Nodes (16): text, additionalProperties, properties, required, type, $ref, claim, confidence (+8 more)

### Community 37 - "properties"
Cohesion: 0.10
Nodes (23): $ref, properties, anyOf, format, type, $ref, properties, campaign_id (+15 more)

### Community 38 - "properties"
Cohesion: 0.09
Nodes (23): $ref, projectionNode, oneOf, $ref, $ref, $ref, additionalProperties, allOf (+15 more)

### Community 39 - "target-profile.schema.json"
Cohesion: 0.29
Nodes (6): additionalProperties, description, $id, $schema, title, type

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
Cohesion: 0.13
Nodes (15): memberType, nodeId, requiredLevel, nodeRequirementMember, ruleRequirementMember, dimension, const, additionalProperties (+7 more)

### Community 45 - "spacing"
Cohesion: 0.13
Nodes (15): node, rank, maximum, minimum, type, node, rank, spacing (+7 more)

### Community 46 - "properties"
Cohesion: 0.13
Nodes (15): timezone, additionalProperties, properties, required, type, availability, weekly_minutes, timezone (+7 more)

### Community 47 - "properties"
Cohesion: 0.05
Nodes (46): apply_change_set, preview_change_goal, preview_change_set, preview_close_goal, preview_create_goal, read, anyOf, items (+38 more)

### Community 48 - "$defs"
Cohesion: 0.13
Nodes (15): additionalProperties, type, $defs, campaign, goal, id, version, additionalProperties (+7 more)

### Community 49 - "properties"
Cohesion: 0.09
Nodes (22): ACTIVITY_EVIDENCES, PART_OF, PREREQUISITE_OF, RELATED_TO, USER_ADDED, type, projectionEdge, $ref (+14 more)

### Community 50 - "milestoneId"
Cohesion: 0.50
Nodes (4): milestoneId, maxLength, pattern, type

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
Nodes (24): scripts, backup:open, backup:r2-plan, backup:seal, build, dev, format, format:check (+16 more)

### Community 55 - "workspaceScope"
Cohesion: 0.14
Nodes (14): acceptedPersonalContentOnly, overlayRevision, workspaceId, const, $ref, acceptedPersonalContentOnly, overlayRevision, workspaceId (+6 more)

### Community 56 - "required"
Cohesion: 0.11
Nodes (19): accessibility, domainNodeId, edgeId, edgeType, entityRef, explanations, inspectorRef, nodeType (+11 more)

### Community 57 - "required"
Cohesion: 0.40
Nodes (14): accessibilityLabel, members, requiredCount, ruleId, ruleType, required, required, criticality (+6 more)

### Community 58 - "required"
Cohesion: 0.12
Nodes (16): action_id, blocker_id, detail_ref, duration_minutes, severity, source, additionalProperties, required (+8 more)

### Community 59 - "enum"
Cohesion: 0.25
Nodes (8): CRITICAL_PATH, MANDATORY_BLOCKER, PERSONAL_OVERLAY, REQUIRED_BY_TARGET, SELECTED_ACTIVITY, SELECTED_CONTEXT, STRUCTURAL_CONTEXT, enum

### Community 60 - "enum"
Cohesion: 0.14
Nodes (14): constraint, evidence_summary, mandatory_floor, today_explanation, track, unknown, capacity, goal (+6 more)

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
Cohesion: 0.15
Nodes (13): $ref, $ref, confidence, minimum_level, requirement_id, subject_ref, weight, $ref (+5 more)

### Community 66 - "properties"
Cohesion: 0.14
Nodes (14): requirementGroup, items, maxItems, minItems, type, uniqueItems, member_requirement_ids, requirement_group_id (+6 more)

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
Nodes (13): contract, edges, layout, nodes, outline, projectionId, projectionState, selectedVersions (+5 more)

### Community 71 - "competencySummary"
Cohesion: 0.15
Nodes (13): dimensions, $ref, additionalProperties, properties, required, type, competencySummary, competency_ref (+5 more)

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
Cohesion: 0.22
Nodes (9): items, maxItems, type, $ref, assumptions, unknowns, items, maxItems (+1 more)

### Community 77 - "properties"
Cohesion: 0.15
Nodes (13): $ref, $ref, $ref, $ref, $ref, properties, deadline, metadata_confidence (+5 more)

### Community 78 - "properties"
Cohesion: 0.14
Nodes (14): proposedCompetency, maxLength, minLength, type, const, description, lifecycle, proposed_competency_id (+6 more)

### Community 79 - "required"
Cohesion: 0.11
Nodes (17): active_campaign, blockers, capabilities, detail_refs, etag, goals, projection_watermark, today (+9 more)

### Community 80 - "structuredExplanation"
Cohesion: 0.17
Nodes (12): code, message, relatedNodeIds, relatedRuleIds, $ref, structuredExplanation, code, message (+4 more)

### Community 82 - "properties"
Cohesion: 0.20
Nodes (12): const, $ref, type, properties, $ref, confidence, dimension, last_meaningful_evidence_at (+4 more)

### Community 83 - "properties"
Cohesion: 0.18
Nodes (11): maxLength, minLength, type, maxLength, pattern, type, label, locator (+3 more)

### Community 84 - "preparation-pack.ts"
Cohesion: 0.06
Nodes (93): add(), AgentChangeSetValidationOptions, AgentControlContextValidationOptions, objects(), OperationContract, operationContracts, validateAgentChangeSet(), validateAgentChangeSetSemantics() (+85 more)

### Community 85 - "properties"
Cohesion: 0.17
Nodes (12): prerequisiteProposal, $ref, additionalProperties, properties, type, from, relationship, source_refs (+4 more)

### Community 86 - "title"
Cohesion: 0.12
Nodes (16): interviewStage, additionalProperties, properties, type, maximum, minimum, type, order (+8 more)

### Community 87 - "projection-view.ts"
Cohesion: 0.05
Nodes (66): ExploreLayout(), ExplorePage(), metadata, FoundationPage(), phase0Capabilities, initialMotionMode(), MotionMode, motionModes (+58 more)

### Community 88 - "calculate-competency-state.ts"
Cohesion: 0.05
Nodes (76): achievementLevel(), calculateCompetencyState(), calculateDimension(), estimateConfidence(), EvaluatedEvidence, EVIDENCE_ENGAGEMENTS, EVIDENCE_OUTCOMES, evidenceFingerprint() (+68 more)

### Community 89 - "required"
Cohesion: 0.18
Nodes (11): algorithmVersion, coordinateSystem, fixedNodeSize, layoutVersion, positions, spacing, structuralFingerprint, additionalProperties (+3 more)

### Community 90 - "calculate-target-readiness.ts"
Cohesion: 0.06
Nodes (61): ACHIEVEMENT_LEVELS, asRuleMemberInterval(), average(), calculateTargetReadiness(), evaluateMember(), evaluateRule(), compareDecisionWitnesses(), confidenceRank() (+53 more)

### Community 91 - "verify-database-core.mjs"
Cohesion: 0.09
Nodes (29): assertSafeScratch(), closesWithin(), combineErrors(), copyValidatedDirectory(), copyValidatedFile(), copyValidatedSupabaseInputs(), createOnceAsync(), createSupabaseRunner() (+21 more)

### Community 92 - "required"
Cohesion: 0.44
Nodes (11): byte_length, checksum, encoding, media_type, path, schema_id, schema_version, required (+3 more)

### Community 93 - "schema_version"
Cohesion: 0.29
Nodes (7): $ref, $ref, properties, context_id, fingerprint, schema_version, const

### Community 94 - "enum"
Cohesion: 0.15
Nodes (13): growth_plan_change, interview_campaign_change, minimum, stretch, enum, type, research, sourced (+5 more)

### Community 95 - "weightedRequirementMember"
Cohesion: 0.15
Nodes (13): member, weightedRequirementMember, weight, $ref, member, weight, exclusiveMinimum, maximum (+5 more)

### Community 96 - "contract"
Cohesion: 0.18
Nodes (11): name, additionalProperties, properties, required, type, version, const, contract (+3 more)

### Community 97 - "enum"
Cohesion: 0.18
Nodes (11): recruiter, vacancy, enum, type, research, sourced, unconfirmed, user_provided (+3 more)

### Community 98 - "properties"
Cohesion: 0.18
Nodes (11): format, type, properties, $ref, expires_at, preview_token, requires_confirmation, warnings (+3 more)

### Community 99 - "$ref"
Cohesion: 0.13
Nodes (15): items, maxItems, type, items, maxItems, minItems, type, $ref (+7 more)

### Community 100 - "properties"
Cohesion: 0.18
Nodes (11): $ref, $ref, properties, outline, projectionId, readiness, requirements, visibilityHints (+3 more)

### Community 101 - "dimensions"
Cohesion: 0.18
Nodes (11): items, maxItems, minItems, type, $ref, dimensions, unavailable_dates, items (+3 more)

### Community 102 - "properties"
Cohesion: 0.18
Nodes (11): $ref, $ref, $ref, properties, capacity, deadline, plan_id, schema_version (+3 more)

### Community 103 - "properties"
Cohesion: 0.18
Nodes (11): maxLength, minLength, type, maxLength, pattern, type, label, locator (+3 more)

### Community 104 - "Agent Control Plane implementation design"
Cohesion: 0.29
Nodes (10): AgentControlContextV1, PlanChangeSet, Agent Control Plane implementation design, PreviewPlanChange service, Read, preview, and apply flow, Root context 12 KiB budget, AgentControlContextV1 JSON Schema, Agent-control v1 schema documentation (+2 more)

### Community 105 - "package.json"
Cohesion: 0.17
Nodes (11): description, engines, node, pnpm, homepage, license, name, packageManager (+3 more)

### Community 106 - "edgeVisibilityHint"
Cohesion: 0.20
Nodes (10): ACTIVE_PREREQUISITE, NAVIGATION_ONLY, PERSONAL_CONTEXT, SEMANTIC_CONTEXT, edgeVisibilityHint, additionalProperties, properties, type (+2 more)

### Community 107 - "required"
Cohesion: 0.20
Nodes (10): catalog, competency_summaries, context_fingerprint, exported_at, availability, context_id, goal, growth_plan (+2 more)

### Community 108 - "kOfNRule"
Cohesion: 0.25
Nodes (8): kOfNRule, maximum, minimum, type, additionalProperties, properties, type, k

### Community 109 - "required"
Cohesion: 0.24
Nodes (10): last_meaningful_evidence_at, knownDimensionSummary, condition, confidence, dimension, state, additionalProperties, required (+2 more)

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

### Community 114 - "$defs"
Cohesion: 0.09
Nodes (24): activity_ids, milestone_ids, additionalProperties, type, $defs, competencyImpact, initialReview, path (+16 more)

### Community 115 - "weightedThresholdRule"
Cohesion: 0.25
Nodes (8): weightedThresholdRule, threshold, exclusiveMinimum, maximum, type, additionalProperties, properties, type

### Community 116 - "Runtime, hosting, and toolchain decision"
Cohesion: 0.22
Nodes (9): Cloudflare R2 backup storage, Modular monolith, Next.js 16, React 19, TypeScript, Node 24, and pnpm 11 toolchain, Portable Node runtime boundary, Runtime, hosting, and toolchain decision, Supabase Free managed platform, Vercel Hobby web hosting, pnpm workspace configuration (+1 more)

### Community 117 - "enum"
Cohesion: 0.22
Nodes (9): active, archived, cancelled, ended, paused, superseded, completed, draft (+1 more)

### Community 118 - "nodeVisibilityHint"
Cohesion: 0.22
Nodes (9): availableAtDetailLevels, defaultVisible, reasonCode, reasonCodes, nodeVisibilityHint, required, additionalProperties, required (+1 more)

### Community 119 - "graph-stress-materializer.ts"
Cohesion: 0.28
Nodes (20): baseRule(), canonicalOrigin(), competencyNodeId(), constants, directMember(), directRuleMap(), domainNodeId(), edge() (+12 more)

### Community 120 - "enum"
Cohesion: 0.22
Nodes (9): coding, mock_interview, project, reading, enum, type, explanation, recall (+1 more)

### Community 121 - "enum"
Cohesion: 0.22
Nodes (9): CodingAttemptAccepted, EvidenceSelfReportAdded, ExplanationAssessed, MockInterviewAssessed, ProjectArtifactVerified, ReviewGraded, enum, type (+1 more)

### Community 122 - "backup.integration.mjs"
Cohesion: 0.15
Nodes (17): archive, BACKUP_MAGIC, BUNDLE_MAGIC, cli, encodedLength(), encryptMalformedFixture(), expectInvalidBundle(), expectInvalidStorage() (+9 more)

### Community 123 - "knownEstimate"
Cohesion: 0.25
Nodes (9): lastMeaningfulEvidenceAt, knownEstimate, availability, condition, confidence, additionalProperties, required, type (+1 more)

### Community 124 - "properties"
Cohesion: 0.22
Nodes (9): format, type, $ref, applied_at, plan_revision_id, resulting_projection_watermark, properties, minimum (+1 more)

### Community 125 - "$defs"
Cohesion: 0.17
Nodes (12): additionalProperties, type, $defs, arguments, id, preview, maxLength, minLength (+4 more)

### Community 126 - "properties"
Cohesion: 0.11
Nodes (19): maximum, minimum, type, properties, $ref, format, type, format (+11 more)

### Community 127 - "detailRef"
Cohesion: 0.22
Nodes (9): detailRef, additionalProperties, properties, type, $ref, entity_id, kind, ref (+1 more)

### Community 128 - "20260826000150_profile_scoped_overlay_and_catalog_dag.sql"
Cohesion: 0.15
Nodes (11): catalog.catalog_versions, catalog.competency_edges, catalog.items, catalog.roadmap_template_items, catalog.roadmap_template_versions, overlay.guard_custom_activity_profile_scope, catalog.validate_roadmap_for_publication(), catalog.validate_version_for_publication() (+3 more)

### Community 129 - "mandatoryFloorRule"
Cohesion: 0.25
Nodes (8): floor, mandatoryFloorRule, $ref, additionalProperties, properties, required, type, floor

### Community 130 - "items"
Cohesion: 0.32
Nodes (8): maxLength, minLength, type, items, maxItems, type, material_unknowns, items

### Community 131 - "impacts"
Cohesion: 0.17
Nodes (12): items, maxItems, minItems, type, $ref, items, maxItems, minItems (+4 more)

### Community 132 - "properties"
Cohesion: 0.18
Nodes (14): protected_weekly_minutes, additionalProperties, properties, required, type, competency_id, priority, track_id (+6 more)

### Community 133 - "properties"
Cohesion: 0.25
Nodes (8): items, maxItems, type, uniqueItems, type, properties, activity_ids, kind

### Community 134 - "$defs"
Cohesion: 0.29
Nodes (7): additionalProperties, properties, type, $defs, allRule, requirementRule, oneOf

### Community 135 - "dependencies"
Cohesion: 0.12
Nodes (17): ajv, ajv-formats, @dagrejs/dagre, json-canonicalize, next, dependencies, ajv, ajv-formats (+9 more)

### Community 136 - "PANDO commercial licensing information"
Cohesion: 0.20
Nodes (8): Information required for an actual agreement, Legal disclaimer, No commercial license is granted here, Non-binding starting terms, PANDO commercial licensing information, Contributing to PANDO, Current contribution status, Why a CLA is required

### Community 137 - "result"
Cohesion: 0.29
Nodes (7): applied_at, plan_revision_id, resulting_projection_watermark, result, additionalProperties, required, type

### Community 138 - "enum"
Cohesion: 0.29
Nodes (7): NOT_STARTED, objectiveLevel, COMPLETED, MASTERED, VERIFIED, enum, type

### Community 139 - "graph-projection.schema.json"
Cohesion: 0.29
Nodes (6): additionalProperties, description, $id, $schema, title, type

### Community 140 - "properties"
Cohesion: 0.29
Nodes (7): type, properties, defaultVisible, reasonCodes, items, type, uniqueItems

### Community 141 - "sourceRefs"
Cohesion: 0.29
Nodes (7): sourceRefs, $ref, items, maxItems, minItems, type, uniqueItems

### Community 142 - "required"
Cohesion: 0.18
Nodes (11): activity_id, activity_type, competency_impacts, effort, expected_evidence, proposedActivity, lifecycle, scope (+3 more)

### Community 143 - "interviewCampaignFiles"
Cohesion: 0.29
Nodes (7): interviewCampaignFiles, description, items, maxItems, minItems, prefixItems, type

### Community 144 - "preparation-context.schema.json"
Cohesion: 0.29
Nodes (6): additionalProperties, description, $id, $schema, title, type

### Community 145 - "constraints"
Cohesion: 0.29
Nodes (7): items, maxItems, type, uniqueItems, maxLength, minLength, constraints

### Community 146 - "source"
Cohesion: 0.29
Nodes (7): source, assertion_status, label, source_id, additionalProperties, required, type

### Community 147 - "enum"
Cohesion: 0.33
Nodes (6): important, supporting, enum, type, blocking, criticality

### Community 148 - "properties"
Cohesion: 0.20
Nodes (10): anyOf, $ref, anyOf, $ref, properties, aggregate_ref, arguments, expected_version (+2 more)

### Community 149 - "properties"
Cohesion: 0.14
Nodes (14): milestone, $ref, additionalProperties, properties, type, due_on, success_criteria, title (+6 more)

### Community 150 - "enum"
Cohesion: 0.33
Nodes (6): enum, type, confidence, high, low, medium

### Community 151 - "enum"
Cohesion: 0.33
Nodes (6): enum, type, Stale, Strong, Weak, condition

### Community 152 - "required"
Cohesion: 0.22
Nodes (9): aggregate_ref, arguments, expected_version, operation_id, operation_type, operation, additionalProperties, required (+1 more)

### Community 153 - "kind"
Cohesion: 0.29
Nodes (7): additionalProperties, properties, type, anyRule, const, type, kind

### Community 154 - "assumptions"
Cohesion: 0.50
Nodes (4): items, maxItems, type, assumptions

### Community 155 - "required"
Cohesion: 0.22
Nodes (9): calculationState, generatedAt, inputWatermark, semanticRevision, staleReason, additionalProperties, required, type (+1 more)

### Community 156 - "e2e-server.mjs"
Cohesion: 0.40
Nodes (5): nextCli, server, stopFile, stopServer(), stopWatcher

### Community 157 - "002_identity_command_rls.test.sql"
Cohesion: 0.40
Nodes (3): pg_temp.reject_outbox_event, command_results, pgtap_reject_outbox_event

### Community 158 - ".prettierrc.json"
Cohesion: 0.40
Nodes (4): printWidth, semi, singleQuote, trailingComma

### Community 159 - "enum"
Cohesion: 0.25
Nodes (8): CURRENT, ERROR, REBUILDING, enum, enum, STALE, STRONG, WEAK

### Community 160 - "enum"
Cohesion: 0.40
Nodes (5): enum, growth, outcome, readiness, goal_kind

### Community 161 - "availableAtDetailLevels"
Cohesion: 0.40
Nodes (5): items, minItems, type, uniqueItems, availableAtDetailLevels

### Community 162 - "required"
Cohesion: 0.20
Nodes (10): category, minimum_level, requirement_id, subject_ref, requirement, criticality, weight, additionalProperties (+2 more)

### Community 163 - "properties"
Cohesion: 0.29
Nodes (8): const, properties, $ref, type, availability, condition, lastMeaningfulEvidenceAt, properties

### Community 164 - "catalog"
Cohesion: 0.17
Nodes (12): supported_competencies, additionalProperties, properties, required, type, $ref, catalog, catalog_version (+4 more)

### Community 165 - "utcTimestamp"
Cohesion: 0.40
Nodes (5): utcTimestamp, format, maxLength, pattern, type

### Community 166 - "milestones"
Cohesion: 0.40
Nodes (5): items, maxItems, minItems, type, milestones

### Community 167 - "paths"
Cohesion: 0.40
Nodes (5): items, maxItems, minItems, type, paths

### Community 168 - "phases"
Cohesion: 0.40
Nodes (5): items, maxItems, minItems, type, phases

### Community 169 - "sources"
Cohesion: 0.40
Nodes (5): sources, items, maxItems, minItems, type

### Community 170 - "requirement_groups"
Cohesion: 0.40
Nodes (5): requirement_groups, items, maxItems, minItems, type

### Community 171 - "requirements"
Cohesion: 0.50
Nodes (4): requirements, maxItems, minItems, type

### Community 172 - "sources"
Cohesion: 0.40
Nodes (5): sources, items, maxItems, minItems, type

### Community 173 - "Practical Python Growth Plan proposal"
Cohesion: 0.40
Nodes (5): Growth Plan, Practical Python Growth Plan proposal, Practical Python work, source:unconfirmed, source:user-goal

### Community 174 - "Minimum Preparation Pack path"
Cohesion: 0.40
Nodes (5): Minimum Preparation Pack path, Python parsing, Workspace-scoped proposed competency, source:unconfirmed, source:vacancy

### Community 176 - "enum"
Cohesion: 0.43
Nodes (7): ACTIVITY, COMPETENCY, DOMAIN, GROUP, enum, enum, nodeType

### Community 177 - "available_minutes"
Cohesion: 0.50
Nodes (4): maximum, minimum, type, available_minutes

### Community 178 - "cadence_per_week"
Cohesion: 0.50
Nodes (4): maximum, minimum, type, cadence_per_week

### Community 179 - "lifecycle_reason"
Cohesion: 0.50
Nodes (4): maxLength, minLength, type, lifecycle_reason

### Community 180 - "priority"
Cohesion: 0.50
Nodes (4): maximum, minimum, type, priority

### Community 181 - "protected_minimum_minutes"
Cohesion: 0.50
Nodes (4): protected_minimum_minutes, maximum, minimum, type

### Community 182 - "title"
Cohesion: 0.50
Nodes (4): title, maxLength, minLength, type

### Community 183 - "weekly_capacity_minutes"
Cohesion: 0.50
Nodes (4): weekly_capacity_minutes, maximum, minimum, type

### Community 184 - "Encrypted logical backup and clean-restore gate"
Cohesion: 0.29
Nodes (6): Boundary and status, Create, Encrypted logical backup and clean-restore gate, Restore, Retention and off-site boundary, Secret handling and cryptography

### Community 185 - "20260826000175_readiness_goal_boundary.sql"
Cohesion: 0.22
Nodes (8): overlay.guard_position_goal_scope, overlay_position_goal_scope, readiness_goal_profile_scope, identity.workspaces, targets.target_profile_versions, targets.guard_readiness_goal_profile_scope(), targets.readiness_goals, targets.guard_readiness_goal_profile_scope

### Community 186 - "r2-plan.mjs"
Cohesion: 0.33
Nodes (5): input, MAGIC, nonce, salt, values

### Community 187 - "$defs"
Cohesion: 0.25
Nodes (8): $defs, dimensionSummary, goal, unknownDimensionSummary, oneOf, oneOf, additionalProperties, type

### Community 188 - "profileId"
Cohesion: 0.50
Nodes (4): profileId, maxLength, pattern, type

### Community 189 - "common.schema.json"
Cohesion: 0.50
Nodes (3): $id, $schema, title

### Community 190 - "activityId"
Cohesion: 0.50
Nodes (4): maxLength, pattern, type, activityId

### Community 191 - "canonicalCompetencyId"
Cohesion: 0.50
Nodes (4): maxLength, pattern, type, canonicalCompetencyId

### Community 192 - "contextId"
Cohesion: 0.50
Nodes (4): maxLength, pattern, type, contextId

### Community 193 - "date"
Cohesion: 0.50
Nodes (4): format, pattern, type, date

### Community 194 - "packId"
Cohesion: 0.50
Nodes (4): packId, maxLength, pattern, type

### Community 195 - "phaseId"
Cohesion: 0.50
Nodes (4): phaseId, maxLength, pattern, type

### Community 196 - "$defs"
Cohesion: 0.13
Nodes (15): oneOf, $defs, competencyRef, requirementGroupId, requirementId, slug, maxLength, pattern (+7 more)

### Community 197 - "properties"
Cohesion: 0.33
Nodes (6): $ref, properties, oneOf, entityId, entityType, entityVersionId

### Community 198 - "kind"
Cohesion: 0.29
Nodes (7): k, required, required, kind, threshold, required, required

### Community 199 - "sourceId"
Cohesion: 0.50
Nodes (4): sourceId, maxLength, pattern, type

### Community 200 - "excluded_items"
Cohesion: 0.50
Nodes (4): items, maxItems, type, excluded_items

### Community 201 - "milestone_ids"
Cohesion: 0.33
Nodes (6): items, maxItems, minItems, type, uniqueItems, milestone_ids

### Community 202 - "enum"
Cohesion: 0.33
Nodes (6): enum, type, differentiating, mandatory, preferred, category

### Community 203 - "initial_reviews"
Cohesion: 0.50
Nodes (4): items, maxItems, type, initial_reviews

### Community 204 - "mock_checkpoints"
Cohesion: 0.50
Nodes (4): items, maxItems, type, mock_checkpoints

### Community 205 - "enum"
Cohesion: 0.40
Nodes (5): enum, HIGH, LOW, MEDIUM, confidence

### Community 206 - "company"
Cohesion: 0.50
Nodes (4): maxLength, minLength, type, company

### Community 207 - "interview_stages"
Cohesion: 0.50
Nodes (4): items, maxItems, type, interview_stages

### Community 208 - "prerequisite_proposals"
Cohesion: 0.50
Nodes (4): items, maxItems, type, prerequisite_proposals

### Community 209 - "$ref"
Cohesion: 0.33
Nodes (6): $ref, proposed_competencies, items, maxItems, type, items

### Community 210 - "role"
Cohesion: 0.50
Nodes (4): role, maxLength, minLength, type

### Community 211 - "unknowns"
Cohesion: 0.50
Nodes (4): unknowns, items, maxItems, type

### Community 212 - "vacancy_reference"
Cohesion: 0.50
Nodes (4): vacancy_reference, maxLength, pattern, type

### Community 213 - "growthPlanFiles"
Cohesion: 0.29
Nodes (7): growthPlanFiles, description, items, maxItems, minItems, prefixItems, type

### Community 214 - "staged_item_ids"
Cohesion: 0.50
Nodes (4): staged_item_ids, maxItems, type, uniqueItems

### Community 215 - "proposed_activities"
Cohesion: 0.50
Nodes (4): proposed_activities, items, maxItems, type

### Community 216 - "fake-supabase-cli.mjs"
Cohesion: 0.50
Nodes (3): command, rawArguments, workdirIndex

### Community 218 - "repository"
Cohesion: 0.67
Nodes (3): repository, type, url

### Community 220 - "UI"
Cohesion: 0.67
Nodes (3): Application layer, UI, UI projections

### Community 221 - "007_catalog_targets_overlay_atomic_concurrency.test.sql"
Cohesion: 0.40
Nodes (4): pg_temp.phase1_concurrency_fixture, pg_temp.reject_phase1_atomic_event, pg_temp.reject_phase1_atomic_event(), pgtap_reject_phase1_atomic_event

### Community 226 - "enum"
Cohesion: 0.40
Nodes (5): InterviewExecution, enum, Application, Knowledge, Recall

### Community 227 - "semver"
Cohesion: 0.50
Nodes (4): semver, maxLength, pattern, type

### Community 229 - "unknownEstimate"
Cohesion: 0.67
Nodes (3): unknownEstimate, additionalProperties, type

### Community 231 - "enum"
Cohesion: 0.50
Nodes (4): enum, DIFFERENTIATING, MANDATORY, PREFERRED

### Community 239 - "planId"
Cohesion: 0.50
Nodes (4): planId, maxLength, pattern, type

### Community 244 - "proposedCompetencyId"
Cohesion: 0.50
Nodes (4): proposedCompetencyId, maxLength, pattern, type

### Community 245 - "competency_summaries"
Cohesion: 0.50
Nodes (4): items, maxItems, type, competency_summaries

### Community 246 - "006_catalog_targets_overlay_behavior.test.sql"
Cohesion: 0.50
Nodes (3): phase1_results, phase1_rule_map, phase1_workspaces

## Knowledge Gaps
- **1560 isolated node(s):** `printWidth`, `semi`, `singleQuote`, `trailingComma`, `eslintConfig` (+1555 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **15 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `$defs` connect `$defs` to `activityState`, `properties`, `properties`, `properties`, `unknownEstimate`, `entityRef`, `attainmentInterval`, `properties`, `graph-projection.schema.json`, `edgeVisibilityHint`, `nodeRequirementMember`, `structuredExplanation`, `properties`, `nodeVisibilityHint`, `knownEstimate`, `weightedRequirementMember`?**
  _High betweenness centrality (0.188) - this node is a cross-community bridge._
- **Why does `$defs` connect `$defs` to `properties`, `enum`, `result`, `confirmation`, `required`?**
  _High betweenness centrality (0.082) - this node is a cross-community bridge._
- **Why does `$defs` connect `$defs` to `properties`, `confidence`, `required`, `required`, `properties`, `properties`, `targetProfileRef`?**
  _High betweenness centrality (0.080) - this node is a cross-community bridge._
- **What connects `printWidth`, `semi`, `singleQuote` to the rest of the system?**
  _1560 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Nine-file canonical documentation set` be split into smaller, more focused modules?**
  _Cohesion score 0.05101327742837177 - nodes in this community are weakly interconnected._
- **Should `activityState` be split into smaller, more focused modules?**
  _Cohesion score 0.0425531914893617 - nodes in this community are weakly interconnected._
- **Should `properties` be split into smaller, more focused modules?**
  _Cohesion score 0.041666666666666664 - nodes in this community are weakly interconnected._