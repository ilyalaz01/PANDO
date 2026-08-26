# Graph Report - PANDO  (2026-08-26)

## Corpus Check
- 266 files · ~158,447 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 3745 nodes · 5087 edges · 302 communities (277 shown, 25 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 55 edges (avg confidence: 0.87)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `cb80bae1`
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
- schema-registry.ts
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
- properties
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
- title
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
- properties
- projection-view.ts
- calculate-competency-state.ts
- required
- calculate-target-readiness.ts
- verify-auth-target-selection.mjs
- required
- inputContext
- enum
- weightedRequirementMember
- contract
- enum
- graph-projection.ts
- $ref
- properties
- unavailable_dates
- properties
- properties
- Agent Control Plane implementation design
- package.json
- enum
- preparation-context.schema.json
- kOfNRule
- $defs
- PANDO module topology and reading routes
- confirmation
- pando-backup.mjs
- properties
- properties
- weightedThresholdRule
- Runtime, hosting, and toolchain decision
- properties
- edgeVisibilityHint
- graph-stress-materializer.ts
- enum
- enum
- backup.integration.mjs
- properties
- properties
- $defs
- properties
- $defs
- 20260826000150_profile_scoped_overlay_and_catalog_dag.sql
- mandatoryFloorRule
- properties
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
- required
- interviewCampaignFiles
- explore-source-v1.ts
- supabase/proxy.ts
- properties
- asJsonObject
- required
- properties
- enum
- enum
- required
- enum
- $defs
- workspace
- e2e-server.mjs
- 002_identity_command_rls.test.sql
- .prettierrc.json
- database-target-selection.ts
- required
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
- lifecycle_reason
- priority
- protected_minimum_minutes
- goals
- weekly_capacity_minutes
- Encrypted logical backup and clean-restore gate
- 20260826000175_readiness_goal_boundary.sql
- r2-plan.mjs
- required
- activityId
- common.schema.json
- preparation-archive.ts
- canonicalCompetencyId
- target-selection-source.schema.json
- date
- packId
- 20260826000275_explore_source_owner_queries.sql
- requirementGroupId
- properties
- reason
- $defs
- control-context.schema.json
- start/actions.ts
- requirementSet
- initial_reviews
- mock_checkpoints
- required
- impact
- interview_stages
- properties
- $ref
- required
- unknowns
- vacancy_reference
- growthPlanFiles
- preparation-plan.schema.json
- contract
- fake-supabase-cli.mjs
- Phase 0 gate 9 - deterministic engine status
- enum
- app/layout.tsx
- UI
- 007_catalog_targets_overlay_atomic_concurrency.test.sql
- eslint.config.mjs
- next.config.ts
- database.generated.ts
- semver
- supabase-config-boundary.test.mjs
- required
- enum
- postcss.config.mjs
- Domain-owned interfaces
- 003_outbox_delivery_lifecycle.test.sql
- Domain layer
- milestones
- $ref
- $defs
- tracks
- 009_catalog_publication_concurrency.test.sql
- 008_catalog_targets_overlay_integrity.test.sql
- enum
- overlay.positions
- overlay.positions
- sign-in/actions.ts
- phaseId
- profileId
- unknowns
- 006_catalog_targets_overlay_behavior.test.sql
- positions
- items
- ExploreSourceV1 server query contract
- projection_watermark
- threshold
- compose-graph-projection.ts
- result
- slug
- kind
- kind
- source
- 010_target_selection_auth_boundary.test.sql
- enum
- enum
- change-set.schema.json
- Invite-only owner provisioning
- enum
- overlay.personal_competencies
- overlay.custom_activities
- catalog.items
- overlay.custom_activities
- goalText
- roleText
- sourceText
- allocation_minutes
- reason
- title
- today
- proposedCompetencyId
- sourceId
- proposed_activities
- etag
- TargetSelectionSourceV1 server query contract
- jsdom
- @testing-library/jest-dom
- @vitest/coverage-v8
- identity.workspaces
- targets.target_profile_versions
- targets.readiness_goals

## God Nodes (most connected - your core abstractions)
1. `$defs` - 31 edges
2. `asJsonObject()` - 30 edges
3. `$defs` - 27 edges
4. `asString()` - 27 edges
5. `scripts` - 25 edges
6. `enum` - 21 edges
7. `asArray()` - 21 edges
8. `validatePreparationPackSemantics()` - 20 edges
9. `validationResult` - 20 edges
10. `isJsonObject()` - 19 edges

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

## Communities (302 total, 25 thin omitted)

### Community 0 - "Nine-file canonical documentation set"
Cohesion: 0.05
Nodes (54): PANDO agent instructions, Product control safety rules, Graphify agent interface, Graphify for PANDO skill, Repository knowledge graph, PANDO Control agent interface, PANDO Control skill, Preview-confirm-apply workflow (+46 more)

### Community 1 - "activityState"
Cohesion: 0.05
Nodes (38): achievementLevel, AVAILABLE, estimate, evidenceExpectation, EXPECTED, IN_PROGRESS, lifecycleStatus, NONE (+30 more)

### Community 2 - "properties"
Cohesion: 0.10
Nodes (21): applied, expired, previewed, rejected, minimum, type, $ref, anyOf (+13 more)

### Community 3 - "enum"
Cohesion: 0.05
Nodes (40): accept_staged_personal_content, aggregate_ref, archive_growth_plan, archive_track, arguments, cancel_campaign, change_campaign_deadline, change_campaign_target (+32 more)

### Community 4 - "properties"
Cohesion: 0.10
Nodes (35): $ref, additionalProperties, properties, type, additionalProperties, properties, type, const (+27 more)

### Community 5 - "properties"
Cohesion: 0.12
Nodes (17): catalogVersionId, masteryPolicyVersion, readinessPolicyVersion, roadmapTemplateVersionId, $ref, $ref, catalogVersionId, masteryPolicyVersion (+9 more)

### Community 6 - "compilerOptions"
Cohesion: 0.07
Nodes (29): dom, dom.iterable, esnext, .next/dev/types/**/*.ts, .next/types/**/*.ts, node_modules, **/*.ts, **/*.tsx (+21 more)

### Community 7 - "properties"
Cohesion: 0.12
Nodes (17): competency_refs, milestone_id, scheduled_on, items, maxItems, minItems, type, mockCheckpoint (+9 more)

### Community 8 - "20260825000200_identity_commands_outbox_tables.sql"
Cohesion: 0.13
Nodes (19): auth.users, identity, outbox, outbox.protect_completed_command_receipt, outbox.reject_consumer_receipt_mutation, outbox.reject_event_mutation, outbox.reject_phase0_probe_effect_mutation, completed_command_receipts_are_immutable (+11 more)

### Community 9 - "enum"
Cohesion: 0.17
Nodes (12): archive, cancel, change, complete, create, end, pause, replan (+4 more)

### Community 10 - "$defs"
Cohesion: 0.06
Nodes (36): format, type, $defs, dateTime, kOfNRule, mandatoryFloorRule, origin, requirementMember (+28 more)

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
Cohesion: 0.13
Nodes (19): from, member_requirement_ids, relationship, requirement_group_id, rule, stage_id, to, required (+11 more)

### Community 15 - "required"
Cohesion: 0.15
Nodes (13): excluded_items, initial_reviews, milestones, mock_checkpoints, paths, phases, plan_id, proposed_activities (+5 more)

### Community 16 - "properties"
Cohesion: 0.10
Nodes (21): anyOf, format, type, detailRef, goal, additionalProperties, properties, type (+13 more)

### Community 17 - "Authentication, data access, and tenancy decision"
Cohesion: 0.16
Nodes (20): Authentication, data access, and tenancy decision, Private api schema, Purpose-specific Postgres RPC, Postgres row-level security, SQL migrations as the schema source, Supabase Auth, Workspace membership tenancy, Commands, outbox, and jobs decision (+12 more)

### Community 18 - "confidence"
Cohesion: 0.14
Nodes (20): activity_ids, impact, milestone_ids, not_before, protected_growth_minutes, required, required, required (+12 more)

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

### Community 27 - "target"
Cohesion: 0.11
Nodes (19): interview_campaign, $ref, target, growth_plan, kind, title, enum, type (+11 more)

### Community 28 - "growth-plan-minimal/manifest.json"
Cohesion: 0.11
Nodes (18): files, algorithm, canonicalization, digest, generated_at, generator, label, prompt_id (+10 more)

### Community 29 - "$defs"
Cohesion: 0.11
Nodes (18): $defs, generator, preparationPlanDescriptor, rationaleDescriptor, sourcesDescriptor, targetProfileDescriptor, additionalProperties, required (+10 more)

### Community 30 - "Mastery and readiness policy v0.1"
Cohesion: 0.17
Nodes (17): Calculation and review engines decision, Fixed MVP review engine, Pure deterministic calculation engines, Versioned projection snapshots, Achievement level, Mastery and readiness policy v0.1, Mastery-driven review triggers, Unknown mastery state (+9 more)

### Community 31 - "properties"
Cohesion: 0.17
Nodes (12): $ref, properties, maximum, minimum, type, action_id, duration_minutes, reason (+4 more)

### Community 32 - "schema-registry.ts"
Cohesion: 0.15
Nodes (11): fieldFromPath(), JsonSchema, registry, schemaNames, schemasByName, structuralCode(), toViolation(), validateSchema() (+3 more)

### Community 33 - "properties"
Cohesion: 0.14
Nodes (14): critical, info, warning, $ref, properties, anyOf, maxLength, minLength (+6 more)

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
Cohesion: 0.15
Nodes (13): $ref, properties, campaign_id, readiness_goal_id, temporary_allocation_minutes, title, $ref, maximum (+5 more)

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
Cohesion: 0.08
Nodes (24): INTERVIEW_EXECUTION, memberType, nodeId, requiredLevel, nodeRequirementMember, ruleRequirementMember, enum, APPLICATION (+16 more)

### Community 45 - "spacing"
Cohesion: 0.13
Nodes (15): node, rank, maximum, minimum, type, node, rank, spacing (+7 more)

### Community 46 - "properties"
Cohesion: 0.11
Nodes (19): timezone, additionalProperties, properties, required, type, maxItems, type, uniqueItems (+11 more)

### Community 47 - "properties"
Cohesion: 0.17
Nodes (12): anyOf, const, format, type, anyOf, properties, active_campaign, contract_version (+4 more)

### Community 48 - "$defs"
Cohesion: 0.17
Nodes (12): additionalProperties, type, $defs, campaign, id, version, maxLength, minLength (+4 more)

### Community 49 - "properties"
Cohesion: 0.09
Nodes (22): type, projectionEdge, $ref, enum, ACTIVITY_EVIDENCES, PART_OF, PREREQUISITE_OF, RELATED_TO (+14 more)

### Community 50 - "milestoneId"
Cohesion: 0.50
Nodes (4): milestoneId, maxLength, pattern, type

### Community 51 - "properties"
Cohesion: 0.13
Nodes (15): properties, maxLength, minLength, type, maxLength, minLength, type, maxLength (+7 more)

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
Nodes (19): accessibility, domainNodeId, edgeId, entityRef, explanations, inspectorRef, rationale, requirementState (+11 more)

### Community 57 - "required"
Cohesion: 0.20
Nodes (21): accessibilityLabel, calculationState, generatedAt, inputWatermark, members, requiredCount, ruleId, ruleType (+13 more)

### Community 58 - "required"
Cohesion: 0.12
Nodes (17): action_id, blocker_id, detail_ref, duration_minutes, severity, source, additionalProperties, required (+9 more)

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
Cohesion: 0.11
Nodes (19): enum, type, $ref, differentiating, mandatory, preferred, $ref, category (+11 more)

### Community 66 - "title"
Cohesion: 0.14
Nodes (14): maxItems, minItems, type, uniqueItems, member_requirement_ids, requirement_group_id, rule, title (+6 more)

### Community 67 - "Graph-projection v1 schema documentation"
Cohesion: 0.24
Nodes (13): Accessible graph outline fallback, Deterministic Dagre layout, Graph layout and query boundary decision, GraphProjectionV1, Server and client graph ownership split, Graphify repository orientation graph, Four graph and contract separation, GraphProjectionV1 contract (+5 more)

### Community 68 - "Preparation Pack ingestion decision"
Cohesion: 0.22
Nodes (13): Bounded in-memory ZIP ingestion, Content-addressed object storage, Preparation Pack ingestion decision, Preparation Pack v1, Retention quota and cleanup policy, Structural and semantic validation, Provider-neutral Preparation Pack, Preparation Pack bulk import versus ChangeSet operations (+5 more)

### Community 69 - "required"
Cohesion: 0.20
Nodes (10): expires_at, impacts, material_unknowns, preview_token, requires_confirmation, warnings, preview, additionalProperties (+2 more)

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
Cohesion: 0.22
Nodes (9): items, maxItems, type, items, maxItems, type, $ref, assumptions (+1 more)

### Community 77 - "properties"
Cohesion: 0.08
Nodes (25): items, maxItems, type, maxLength, minLength, type, $ref, $ref (+17 more)

### Community 78 - "preparation-pack.test.ts"
Cohesion: 0.16
Nodes (22): JsonObject, PreparationCatalogState, PreparationPackInput, SchemaName, generatedCollection(), materializeSemanticCase(), SemanticCase, semanticCases() (+14 more)

### Community 79 - "required"
Cohesion: 0.12
Nodes (17): active_campaign, blockers, campaign, capabilities, detail_refs, etag, goals, manual (+9 more)

### Community 80 - "structuredExplanation"
Cohesion: 0.17
Nodes (12): code, message, relatedNodeIds, relatedRuleIds, $ref, structuredExplanation, code, message (+4 more)

### Community 82 - "properties"
Cohesion: 0.13
Nodes (17): InterviewExecution, const, $ref, enum, type, Application, Knowledge, Recall (+9 more)

### Community 83 - "properties"
Cohesion: 0.20
Nodes (10): source, maxLength, pattern, type, locator, source_id, additionalProperties, $ref (+2 more)

### Community 84 - "preparation-pack.ts"
Cohesion: 0.21
Nodes (20): asciiCompare(), canonicalize(), isJsonObject(), isSorted(), JsonPrimitive, maximumJsonNesting(), referenceKey(), sha256() (+12 more)

### Community 85 - "properties"
Cohesion: 0.17
Nodes (12): prerequisiteProposal, $ref, additionalProperties, properties, type, from, relationship, source_refs (+4 more)

### Community 86 - "properties"
Cohesion: 0.17
Nodes (12): interviewStage, additionalProperties, properties, type, maximum, minimum, type, order (+4 more)

### Community 87 - "projection-view.ts"
Cohesion: 0.06
Nodes (56): ExploreLayout(), ExplorePage(), metadata, ExploreMapNode(), ExploreNodeInteraction, nodeTypeLabel(), nodeTypeLabels, chooseViewFocus() (+48 more)

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

### Community 93 - "inputContext"
Cohesion: 0.15
Nodes (13): fingerprint, $ref, inputContext, $ref, additionalProperties, properties, required, type (+5 more)

### Community 94 - "enum"
Cohesion: 0.15
Nodes (13): growth_plan_change, interview_campaign_change, minimum, stretch, enum, type, research, sourced (+5 more)

### Community 95 - "weightedRequirementMember"
Cohesion: 0.18
Nodes (11): weightedRequirementMember, member, weight, weight, exclusiveMinimum, maximum, type, additionalProperties (+3 more)

### Community 96 - "contract"
Cohesion: 0.18
Nodes (11): additionalProperties, properties, required, type, name, version, const, contract (+3 more)

### Community 97 - "enum"
Cohesion: 0.18
Nodes (11): recruiter, vacancy, enum, type, research, sourced, unconfirmed, user_provided (+3 more)

### Community 98 - "graph-projection.ts"
Cohesion: 0.21
Nodes (15): addViolation(), computeGraphStructuralFingerprint(), graphHasCycle(), ids(), memberId(), objectArray(), requirementMembers(), validateGraphProjectionSemantics() (+7 more)

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
Cohesion: 0.18
Nodes (11): $ref, $ref, $ref, properties, capacity, deadline, plan_id, schema_version (+3 more)

### Community 103 - "properties"
Cohesion: 0.18
Nodes (11): maxLength, minLength, type, maxLength, pattern, type, label, locator (+3 more)

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

### Community 108 - "kOfNRule"
Cohesion: 0.25
Nodes (8): kOfNRule, maximum, minimum, type, additionalProperties, properties, type, k

### Community 109 - "$defs"
Cohesion: 0.13
Nodes (18): last_meaningful_evidence_at, $defs, dimensionSummary, goal, knownDimensionSummary, unknownDimensionSummary, oneOf, oneOf (+10 more)

### Community 110 - "PANDO module topology and reading routes"
Cohesion: 0.09
Nodes (19): ADR-0009 — Module topology and derived projection ownership, Alternatives considered, Consequences, Context, Decision, Migration and rollback, Security and privacy, 1. Purpose (+11 more)

### Community 111 - "confirmation"
Cohesion: 0.15
Nodes (13): confirmed_at, preview_digest, additionalProperties, properties, required, type, format, type (+5 more)

### Community 112 - "pando-backup.mjs"
Cohesion: 0.10
Nodes (20): publishExtractedMembers(), stageBackupMember(), a, BM, command, decoded(), decrypt(), encrypt() (+12 more)

### Community 113 - "properties"
Cohesion: 0.05
Nodes (46): CURRENT, ERROR, lastMeaningfulEvidenceAt, REBUILDING, const, enum, enum, enum (+38 more)

### Community 114 - "properties"
Cohesion: 0.14
Nodes (14): proposedCompetency, maxLength, minLength, type, const, description, lifecycle, proposed_competency_id (+6 more)

### Community 115 - "weightedThresholdRule"
Cohesion: 0.25
Nodes (8): weightedThresholdRule, threshold, exclusiveMinimum, maximum, type, additionalProperties, properties, type

### Community 116 - "Runtime, hosting, and toolchain decision"
Cohesion: 0.22
Nodes (9): Cloudflare R2 backup storage, Modular monolith, Next.js 16, React 19, TypeScript, Node 24, and pnpm 11 toolchain, Portable Node runtime boundary, Runtime, hosting, and toolchain decision, Supabase Free managed platform, Vercel Hobby web hosting, pnpm workspace configuration (+1 more)

### Community 117 - "properties"
Cohesion: 0.18
Nodes (11): growthPlan, $ref, additionalProperties, properties, type, growth_plan_id, status, weekly_capacity_minutes (+3 more)

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

### Community 124 - "properties"
Cohesion: 0.22
Nodes (9): format, type, $ref, applied_at, plan_revision_id, resulting_projection_watermark, properties, minimum (+1 more)

### Community 125 - "$defs"
Cohesion: 0.22
Nodes (9): additionalProperties, type, $defs, arguments, id, maxLength, minLength, pattern (+1 more)

### Community 126 - "properties"
Cohesion: 0.11
Nodes (19): properties, maximum, minimum, type, $ref, format, type, format (+11 more)

### Community 127 - "$defs"
Cohesion: 0.07
Nodes (29): pattern, type, $defs, catalogVersionKey, domainRef, edgeKey, goalKey, nodeRef (+21 more)

### Community 128 - "20260826000150_profile_scoped_overlay_and_catalog_dag.sql"
Cohesion: 0.15
Nodes (11): catalog.catalog_versions, catalog.competency_edges, catalog.roadmap_template_items, catalog.roadmap_template_versions, overlay.guard_custom_activity_profile_scope, catalog.validate_roadmap_for_publication(), catalog.validate_version_for_publication(), custom_activity_profile_scope (+3 more)

### Community 129 - "mandatoryFloorRule"
Cohesion: 0.25
Nodes (8): floor, mandatoryFloorRule, $ref, additionalProperties, properties, required, type, floor

### Community 130 - "properties"
Cohesion: 0.18
Nodes (11): format, type, properties, $ref, expires_at, preview_token, requires_confirmation, warnings (+3 more)

### Community 131 - "impacts"
Cohesion: 0.12
Nodes (16): items, maxItems, minItems, type, $ref, items, maxItems, minItems (+8 more)

### Community 132 - "properties"
Cohesion: 0.12
Nodes (20): protected_weekly_minutes, items, additionalProperties, maxLength, minLength, properties, required, type (+12 more)

### Community 133 - "properties"
Cohesion: 0.12
Nodes (17): items, maxItems, type, uniqueItems, path, type, items, maxItems (+9 more)

### Community 134 - "properties"
Cohesion: 0.07
Nodes (29): $ref, maximum, minimum, type, items, maxItems, type, oneOf (+21 more)

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

### Community 142 - "required"
Cohesion: 0.18
Nodes (11): activity_id, activity_type, competency_impacts, effort, expected_evidence, proposedActivity, lifecycle, scope (+3 more)

### Community 143 - "interviewCampaignFiles"
Cohesion: 0.29
Nodes (7): interviewCampaignFiles, description, items, maxItems, minItems, prefixItems, type

### Community 144 - "explore-source-v1.ts"
Cohesion: 0.10
Nodes (20): ContractViolation, AuthenticatedUserScopedRpcClient, EXPLORE_SOURCE_RPC_V1, ExploreSourceAccessError, ExploreSourceQueryV1, loadDatabaseExploreSourceV1(), UserScopedRpcResult, validateQuery() (+12 more)

### Community 145 - "supabase/proxy.ts"
Cohesion: 0.15
Nodes (15): config, proxy(), isAllowedPublicKey(), isLoopbackHostname(), legacyJwtRole(), readSupabasePublicConfig(), SupabaseConfigurationError, SupabasePublicConfig (+7 more)

### Community 146 - "properties"
Cohesion: 0.15
Nodes (17): type, properties, $ref, enum, ACTIVITY_EVIDENCES, PART_OF, PREREQUISITE_OF, RELATED_TO (+9 more)

### Community 147 - "asJsonObject"
Cohesion: 0.14
Nodes (29): add(), AgentChangeSetValidationOptions, AgentControlContextValidationOptions, objects(), OperationContract, operationContracts, validateAgentChangeSet(), validateAgentChangeSetSemantics() (+21 more)

### Community 148 - "required"
Cohesion: 0.17
Nodes (18): activityType, domainRef, nodeRef, sourceVersionKey, targetCompetencyRef, additionalProperties, required, type (+10 more)

### Community 149 - "properties"
Cohesion: 0.11
Nodes (18): position, additionalProperties, properties, type, readinessGoalId, targetProfileVersionId, x, y (+10 more)

### Community 150 - "enum"
Cohesion: 0.33
Nodes (6): enum, type, confidence, high, low, medium

### Community 151 - "enum"
Cohesion: 0.33
Nodes (6): enum, type, Stale, Strong, Weak, condition

### Community 152 - "required"
Cohesion: 0.09
Nodes (23): edgeCount, nodeCount, overlayVersion, readinessGoalId, targetProfileVersionKey, x, y, additionalProperties (+15 more)

### Community 153 - "enum"
Cohesion: 0.18
Nodes (11): apply_change_set, preview_change_goal, preview_change_set, preview_close_goal, preview_create_goal, read, items, type (+3 more)

### Community 154 - "$defs"
Cohesion: 0.10
Nodes (21): pattern, type, $defs, catalogVersionKey, profileSeriesKey, profileVersionKey, readinessGoalKey, roadmapVersionKey (+13 more)

### Community 155 - "workspace"
Cohesion: 0.10
Nodes (20): displayName, membershipRole, owner, workspaceKind, workspace, $ref, member, workspaceId (+12 more)

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
Cohesion: 0.20
Nodes (13): BOOTSTRAP_PERSONAL_WORKSPACE_RPC, bootstrapIdempotencyKey(), callRpc(), CREATE_READINESS_GOAL_RPC, DerivedReadinessGoalCommand, deriveReadinessGoalCommand(), ensurePersonalWorkspace(), loadTargetSelectionSourceV1() (+5 more)

### Community 160 - "required"
Cohesion: 0.20
Nodes (10): category, minimum_level, requirement_id, subject_ref, requirement, criticality, weight, additionalProperties (+2 more)

### Community 161 - "availableAtDetailLevels"
Cohesion: 0.40
Nodes (5): items, minItems, type, uniqueItems, availableAtDetailLevels

### Community 162 - "confidence"
Cohesion: 0.13
Nodes (17): $ref, properties, $ref, initialReview, exclusiveMinimum, maximum, type, additionalProperties (+9 more)

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
Cohesion: 0.13
Nodes (17): objective, phase_id, success_criteria, additionalProperties, type, $defs, competencyImpact, milestone (+9 more)

### Community 172 - "database.ts"
Cohesion: 0.22
Nodes (9): PandoSupabaseClient, AuthenticatedSessionRequiredError, VerifiedPandoSession, verifyPandoSession(), signInAndEnsureWorkspace(), SignInCredentials, SignInWorkflowResult, source (+1 more)

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

### Community 179 - "lifecycle_reason"
Cohesion: 0.50
Nodes (4): maxLength, minLength, type, lifecycle_reason

### Community 180 - "priority"
Cohesion: 0.50
Nodes (4): maximum, minimum, type, priority

### Community 181 - "protected_minimum_minutes"
Cohesion: 0.50
Nodes (4): protected_minimum_minutes, maximum, minimum, type

### Community 182 - "goals"
Cohesion: 0.50
Nodes (4): items, maxItems, type, goals

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

### Community 187 - "required"
Cohesion: 0.13
Nodes (15): baseProfileVersionKey, companyName, freshnessStatus, profileSeriesKey, reviewedAt, roleTitle, sourceSummary, versionNumber (+7 more)

### Community 188 - "activityId"
Cohesion: 0.50
Nodes (4): maxLength, pattern, type, activityId

### Community 189 - "common.schema.json"
Cohesion: 0.50
Nodes (3): $id, $schema, title

### Community 190 - "preparation-archive.ts"
Cohesion: 0.33
Nodes (10): acceptedRootEntries, isAbsoluteArchivePath(), normalizedArchivePath(), preparationPackLimits, reject(), RetentionQuotaInput, validateArchiveEntries(), validateArchiveLimits() (+2 more)

### Community 191 - "canonicalCompetencyId"
Cohesion: 0.50
Nodes (4): maxLength, pattern, type, canonicalCompetencyId

### Community 192 - "target-selection-source.schema.json"
Cohesion: 0.13
Nodes (14): canonical, profiles, readinessGoals, additionalProperties, description, $id, contract, workspace (+6 more)

### Community 193 - "date"
Cohesion: 0.50
Nodes (4): format, pattern, type, date

### Community 194 - "packId"
Cohesion: 0.50
Nodes (4): packId, maxLength, pattern, type

### Community 195 - "20260826000275_explore_source_owner_queries.sql"
Cohesion: 0.29
Nodes (3): overlay_source, selection, targets.get_explore_selection_impl()

### Community 196 - "requirementGroupId"
Cohesion: 0.50
Nodes (4): requirementGroupId, maxLength, pattern, type

### Community 197 - "properties"
Cohesion: 0.33
Nodes (6): $ref, properties, oneOf, entityId, entityType, entityVersionId

### Community 198 - "reason"
Cohesion: 0.15
Nodes (13): excludedItem, additionalProperties, properties, type, maxLength, minLength, type, label (+5 more)

### Community 199 - "$defs"
Cohesion: 0.13
Nodes (15): oneOf, maxLength, pattern, type, $defs, competencyRef, contextId, planId (+7 more)

### Community 200 - "control-context.schema.json"
Cohesion: 0.33
Nodes (5): additionalProperties, $id, $schema, title, type

### Community 201 - "start/actions.ts"
Cohesion: 0.31
Nodes (10): selectTargetAction(), setupPersonalWorkspaceAction(), signOutAction(), classes, mocks, createPandoServerActionClient(), SelectTargetForm(), SetupPersonalWorkspaceForm() (+2 more)

### Community 202 - "requirementSet"
Cohesion: 0.13
Nodes (15): rootRuleId, rules, requirementSet, targetProfileVersionId, rootRuleId, rules, targetProfileVersionId, additionalProperties (+7 more)

### Community 203 - "initial_reviews"
Cohesion: 0.50
Nodes (4): items, maxItems, type, initial_reviews

### Community 204 - "mock_checkpoints"
Cohesion: 0.50
Nodes (4): items, maxItems, type, mock_checkpoints

### Community 205 - "required"
Cohesion: 0.21
Nodes (13): edgeKey, sourceRef, targetRef, additionalProperties, required, type, canonicalEdge, overlayEdge (+5 more)

### Community 206 - "impact"
Cohesion: 0.17
Nodes (12): summary, impact, additionalProperties, properties, required, type, kind, kind (+4 more)

### Community 207 - "interview_stages"
Cohesion: 0.50
Nodes (4): items, maxItems, type, interview_stages

### Community 208 - "properties"
Cohesion: 0.18
Nodes (12): $ref, items, maxItems, type, properties, profiles, readinessGoals, workspace (+4 more)

### Community 209 - "$ref"
Cohesion: 0.08
Nodes (25): $ref, items, items, maxItems, type, prerequisite_proposals, proposed_competencies, requirement_groups (+17 more)

### Community 210 - "required"
Cohesion: 0.18
Nodes (11): base_projection_watermark, change_set_id, confirmation, operations, preview, result, source_client, contract_version (+3 more)

### Community 211 - "unknowns"
Cohesion: 0.50
Nodes (4): unknowns, items, maxItems, type

### Community 212 - "vacancy_reference"
Cohesion: 0.50
Nodes (4): vacancy_reference, maxLength, pattern, type

### Community 213 - "growthPlanFiles"
Cohesion: 0.29
Nodes (7): growthPlanFiles, description, items, maxItems, minItems, prefixItems, type

### Community 214 - "preparation-plan.schema.json"
Cohesion: 0.25
Nodes (7): additionalProperties, allOf, description, $id, $schema, title, type

### Community 215 - "contract"
Cohesion: 0.18
Nodes (11): additionalProperties, properties, required, type, name, version, const, contract (+3 more)

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

### Community 226 - "database.generated.ts"
Cohesion: 0.18
Nodes (10): CompositeTypes, Constants, Database, DatabaseWithoutInternals, DefaultSchema, Enums, Json, Tables (+2 more)

### Community 227 - "semver"
Cohesion: 0.50
Nodes (4): semver, maxLength, pattern, type

### Community 229 - "required"
Cohesion: 0.20
Nodes (10): aggregateVersion, profileRoleTitle, profileVersionKey, readinessGoal, lifecycle, readinessGoalKey, title, additionalProperties (+2 more)

### Community 231 - "enum"
Cohesion: 0.50
Nodes (4): enum, DIFFERENTIATING, MANDATORY, PREFERRED

### Community 239 - "milestones"
Cohesion: 0.40
Nodes (5): items, maxItems, minItems, type, milestones

### Community 244 - "$ref"
Cohesion: 0.22
Nodes (9): items, maxItems, type, items, maxItems, type, $ref, blockers (+1 more)

### Community 245 - "$defs"
Cohesion: 0.20
Nodes (10): additionalProperties, properties, type, $defs, anyRule, requirementGroup, requirementRule, additionalProperties (+2 more)

### Community 246 - "tracks"
Cohesion: 0.50
Nodes (4): tracks, items, maxItems, type

### Community 250 - "enum"
Cohesion: 0.22
Nodes (9): cancelled, ended, superseded, active, archived, completed, draft, paused (+1 more)

### Community 254 - "sign-in/actions.ts"
Cohesion: 0.44
Nodes (5): signInAction(), mocks, initialSignInActionState, SignInActionState, SignInForm()

### Community 255 - "phaseId"
Cohesion: 0.50
Nodes (4): phaseId, maxLength, pattern, type

### Community 256 - "profileId"
Cohesion: 0.50
Nodes (4): profileId, maxLength, pattern, type

### Community 257 - "unknowns"
Cohesion: 0.50
Nodes (4): unknowns, items, maxItems, type

### Community 258 - "006_catalog_targets_overlay_behavior.test.sql"
Cohesion: 0.50
Nodes (3): phase1_results, phase1_rule_map, phase1_workspaces

### Community 259 - "positions"
Cohesion: 0.40
Nodes (5): $ref, items, maxItems, type, positions

### Community 260 - "items"
Cohesion: 0.32
Nodes (8): maxLength, minLength, type, items, maxItems, type, material_unknowns, items

### Community 261 - "ExploreSourceV1 server query contract"
Cohesion: 0.50
Nodes (3): Boundary and security invariants, Compatibility, ExploreSourceV1 server query contract

### Community 262 - "projection_watermark"
Cohesion: 0.67
Nodes (3): minimum, type, projection_watermark

### Community 263 - "threshold"
Cohesion: 0.50
Nodes (4): threshold, exclusiveMinimum, maximum, type

### Community 264 - "compose-graph-projection.ts"
Cohesion: 0.39
Nodes (4): validateGraphProjection(), projection, assertProjection(), composeExploreProjection()

### Community 265 - "result"
Cohesion: 0.29
Nodes (7): applied_at, plan_revision_id, resulting_projection_watermark, result, additionalProperties, required, type

### Community 266 - "slug"
Cohesion: 0.50
Nodes (4): slug, maxLength, pattern, type

### Community 267 - "kind"
Cohesion: 0.29
Nodes (7): k, required, required, kind, threshold, required, required

### Community 268 - "kind"
Cohesion: 0.29
Nodes (7): additionalProperties, properties, type, allRule, const, type, kind

### Community 269 - "source"
Cohesion: 0.29
Nodes (7): source, assertion_status, label, source_id, additionalProperties, required, type

### Community 270 - "010_target_selection_auth_boundary.test.sql"
Cohesion: 0.33
Nodes (4): pg_temp.reject_target_selection_outbox_event, pgtap_reject_target_selection_outbox_event, target_selection_results, target_selection_workspaces

### Community 271 - "enum"
Cohesion: 0.33
Nodes (6): api, chatgpt_work, codex, web, source_client, enum

### Community 272 - "enum"
Cohesion: 0.33
Nodes (6): important, supporting, enum, type, blocking, criticality

### Community 273 - "change-set.schema.json"
Cohesion: 0.33
Nodes (5): additionalProperties, $id, $schema, title, type

### Community 274 - "Invite-only owner provisioning"
Cohesion: 0.40
Nodes (4): Hosted deployment, Invite-only owner provisioning, Local development, Safety rules

### Community 275 - "enum"
Cohesion: 0.40
Nodes (5): enum, growth, outcome, readiness, goal_kind

### Community 281 - "goalText"
Cohesion: 0.40
Nodes (5): goalText, maxLength, minLength, pattern, type

### Community 282 - "roleText"
Cohesion: 0.40
Nodes (5): roleText, maxLength, minLength, pattern, type

### Community 283 - "sourceText"
Cohesion: 0.40
Nodes (5): sourceText, maxLength, minLength, pattern, type

### Community 285 - "allocation_minutes"
Cohesion: 0.50
Nodes (4): maximum, minimum, type, allocation_minutes

### Community 286 - "reason"
Cohesion: 0.50
Nodes (4): reason, maxLength, minLength, type

### Community 287 - "title"
Cohesion: 0.50
Nodes (4): title, maxLength, minLength, type

### Community 288 - "today"
Cohesion: 0.50
Nodes (4): today, items, maxItems, type

### Community 289 - "proposedCompetencyId"
Cohesion: 0.50
Nodes (4): proposedCompetencyId, maxLength, pattern, type

### Community 290 - "sourceId"
Cohesion: 0.50
Nodes (4): sourceId, maxLength, pattern, type

### Community 291 - "proposed_activities"
Cohesion: 0.50
Nodes (4): proposed_activities, items, maxItems, type

### Community 292 - "etag"
Cohesion: 0.67
Nodes (3): pattern, type, etag

## Knowledge Gaps
- **1835 isolated node(s):** `printWidth`, `semi`, `singleQuote`, `trailingComma`, `eslintConfig` (+1830 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **25 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `$defs` connect `$defs` to `activityState`, `properties`, `properties`, `entityRef`, `attainmentInterval`, `properties`, `graph-projection.schema.json`, `nodeRequirementMember`, `nodeVisibilityHint`, `requirementSet`, `structuredExplanation`, `properties`, `properties`, `edgeVisibilityHint`, `weightedRequirementMember`?**
  _High betweenness centrality (0.129) - this node is a cross-community bridge._
- **Why does `properties` connect `properties` to `contract`, `$ref`, `properties`, `graph-projection.schema.json`, `properties`, `workspaceScope`, `required`?**
  _High betweenness centrality (0.084) - this node is a cross-community bridge._
- **Why does `$defs` connect `$defs` to `profileId`, `enum`, `slug`, `canonicalCompetencyRef`, `sourceRefs`, `contextFingerprint`, `enum`, `proposedCompetencyId`, `sourceId`, `claim`, `utcTimestamp`, `effortRange`, `milestoneId`, `activityId`, `common.schema.json`, `canonicalCompetencyId`, `date`, `packId`, `requirementGroupId`, `semver`, `phaseId`?**
  _High betweenness centrality (0.083) - this node is a cross-community bridge._
- **What connects `printWidth`, `semi`, `singleQuote` to the rest of the system?**
  _1835 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Nine-file canonical documentation set` be split into smaller, more focused modules?**
  _Cohesion score 0.05101327742837177 - nodes in this community are weakly interconnected._
- **Should `activityState` be split into smaller, more focused modules?**
  _Cohesion score 0.05405405405405406 - nodes in this community are weakly interconnected._
- **Should `properties` be split into smaller, more focused modules?**
  _Cohesion score 0.09523809523809523 - nodes in this community are weakly interconnected._