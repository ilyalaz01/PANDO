import {
  asArray,
  asJsonObject,
  asNumber,
  asString,
  asciiCompare,
  canonicalize,
  hasDuplicates,
  isJsonObject,
  referenceKey,
  type JsonObject,
  type JsonValue,
  sha256,
} from "./json";
import { type ContractViolation, type ValidationResult, validationResult } from "./result";
import { validateSchema } from "./schema-registry";

function objects(value: JsonValue | undefined): JsonObject[] {
  return asArray(value).filter(isJsonObject);
}

function add(violations: ContractViolation[], code: string, path: string, message: string): void {
  if (!violations.some((item) => item.code === code)) {
    violations.push({ code, path, message });
  }
}

function bytes(value: Uint8Array | string): Uint8Array {
  return typeof value === "string" ? Buffer.from(value, "utf8") : value;
}

export interface PreparationCatalogState {
  readonly catalogVersion: string;
  readonly competencyIds: ReadonlySet<string>;
  readonly prerequisiteEdges?: readonly {
    readonly from: string;
    readonly to: string;
  }[];
}

export interface PreparationPackInput {
  readonly manifest: unknown;
  readonly preparationPlan: unknown;
  readonly preparationContext: unknown;
  readonly targetProfile?: unknown;
  readonly files: Readonly<Record<string, Uint8Array | string>>;
  readonly catalogState?: PreparationCatalogState;
}

export function computePreparationContextFingerprint(contextValue: unknown): string {
  const context = asJsonObject(contextValue, "preparation context");
  const unsigned = { ...context };
  delete unsigned.context_fingerprint;
  return sha256(canonicalize(unsigned));
}

export function computePreparationPackContentFingerprint(
  files: Readonly<Record<string, Uint8Array | string>>,
): string {
  const tuples = Object.entries(files)
    .map(([path, value]) => {
      const body = bytes(value);
      return `${path}\0${sha256(body)}\0${body.byteLength}\n`;
    })
    .sort((left, right) => asciiCompare(left.split("\0", 1)[0]!, right.split("\0", 1)[0]!));
  return sha256(tuples.join(""));
}

function collectSourceReferences(value: JsonValue): string[] {
  if (Array.isArray(value)) return value.flatMap(collectSourceReferences);
  if (!isJsonObject(value)) return [];
  const current = asArray(value.source_refs).flatMap((item) =>
    typeof item === "string" ? [item] : [],
  );
  return [
    ...current,
    ...Object.entries(value)
      .filter(([key]) => key !== "source_refs")
      .flatMap(([, child]) => collectSourceReferences(child)),
  ];
}

function collectCompetencyReferences(value: JsonValue): JsonObject[] {
  if (Array.isArray(value)) return value.flatMap(collectCompetencyReferences);
  if (!isJsonObject(value)) return [];
  const isReference =
    (value.kind === "canonical" && typeof value.competency_id === "string") ||
    (value.kind === "proposed" && typeof value.proposed_competency_id === "string");
  return [
    ...(isReference ? [value] : []),
    ...Object.values(value).flatMap(collectCompetencyReferences),
  ];
}

function findCycle(edges: readonly { from: string; to: string }[]): boolean {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    adjacency.set(edge.from, [...(adjacency.get(edge.from) ?? []), edge.to]);
    if (!adjacency.has(edge.to)) adjacency.set(edge.to, []);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (node: string): boolean => {
    if (visiting.has(node)) return true;
    if (visited.has(node)) return false;
    visiting.add(node);
    for (const next of adjacency.get(node) ?? []) {
      if (visit(next)) return true;
    }
    visiting.delete(node);
    visited.add(node);
    return false;
  };
  return [...adjacency.keys()].some(visit);
}

function ids(items: readonly JsonObject[], field: string): string[] {
  return items.map((item) => asString(item[field])!).filter(Boolean);
}

function checkUniqueNamespaces(
  violations: ContractViolation[],
  groups: readonly [readonly JsonObject[], string, string][],
): void {
  for (const [items, field, path] of groups) {
    if (hasDuplicates(ids(items, field))) {
      add(violations, "SEMANTIC_DUPLICATE_ID", path, `Identifiers in ${path} must be unique.`);
    }
  }
}

function catalogStateFromContext(context: JsonObject): PreparationCatalogState {
  const catalog = asJsonObject(context.catalog, "catalog");
  return {
    catalogVersion: asString(catalog.catalog_version)!,
    competencyIds: new Set(
      objects(catalog.supported_competencies).map((competency) =>
        asString(competency.competency_id)!,
      ),
    ),
  };
}

export function validatePreparationPackSemantics(input: PreparationPackInput): ValidationResult {
  const manifest = asJsonObject(input.manifest, "manifest");
  const plan = asJsonObject(input.preparationPlan, "preparation plan");
  const context = asJsonObject(input.preparationContext, "preparation context");
  const target =
    input.targetProfile === undefined
      ? undefined
      : asJsonObject(input.targetProfile, "target profile");
  const violations: ContractViolation[] = [];
  const catalogState = input.catalogState ?? catalogStateFromContext(context);

  const contextFingerprint = computePreparationContextFingerprint(context);
  const contextFingerprintObject = asJsonObject(context.context_fingerprint, "context fingerprint");
  if (asString(contextFingerprintObject.digest) !== contextFingerprint) {
    add(
      violations,
      "SEMANTIC_CONTEXT_FINGERPRINT_MISMATCH",
      "/preparation-context/context_fingerprint",
      "Preparation Context fingerprint does not match RFC 8785 canonical bytes.",
    );
  }
  const manifestInputContext = asJsonObject(manifest.input_context, "manifest input context");
  const manifestFingerprint = asJsonObject(
    manifestInputContext.fingerprint,
    "manifest context fingerprint",
  );
  if (asString(manifestFingerprint.digest) !== contextFingerprint) {
    add(
      violations,
      "SEMANTIC_CONTEXT_FINGERPRINT_MISMATCH",
      "/manifest/input_context/fingerprint",
      "Manifest must copy the exported Preparation Context fingerprint.",
    );
  }
  if (manifestInputContext.context_id !== context.context_id) {
    add(
      violations,
      "SEMANTIC_CONTEXT_ID_MISMATCH",
      "/manifest/input_context/context_id",
      "Manifest context_id must match the exported context.",
    );
  }

  for (const [index, descriptor] of objects(manifest.files).entries()) {
    const path = asString(descriptor.path)!;
    const body = input.files[path];
    if (body === undefined) {
      add(
        violations,
        "SEMANTIC_FILE_MISSING",
        `/manifest/files/${index}/path`,
        `Manifest file ${path} is missing.`,
      );
      continue;
    }
    const raw = bytes(body);
    if (asNumber(descriptor.byte_length) !== raw.byteLength) {
      add(
        violations,
        "SEMANTIC_BYTE_LENGTH_MISMATCH",
        `/manifest/files/${index}/byte_length`,
        `Manifest byte length does not match ${path}.`,
      );
    }
    const checksum = asJsonObject(descriptor.checksum, "descriptor checksum");
    if (asString(checksum.digest) !== sha256(raw)) {
      add(
        violations,
        "SEMANTIC_CHECKSUM_MISMATCH",
        `/manifest/files/${index}/checksum/digest`,
        `Manifest checksum does not match ${path}.`,
      );
    }
  }

  const manifestTarget = asJsonObject(manifest.target, "manifest target");
  const planKind = asString(plan.kind);
  const manifestKind = asString(manifestTarget.kind);
  const isGrowth = planKind === "growth_plan_change";
  if (
    (isGrowth && manifestKind !== "growth_plan") ||
    (!isGrowth && manifestKind !== "interview_campaign")
  ) {
    add(
      violations,
      "SEMANTIC_TARGET_KIND_MISMATCH",
      "/manifest/target/kind",
      "Manifest target kind must match the plan-change discriminator.",
    );
  }
  if (isGrowth && target !== undefined) {
    add(
      violations,
      "SEMANTIC_TARGET_PROFILE_FORBIDDEN",
      "/target-profile",
      "Growth Plan packs cannot contain a Target Profile.",
    );
  }
  if (!isGrowth && target === undefined) {
    add(
      violations,
      "SEMANTIC_TARGET_PROFILE_REQUIRED",
      "/target-profile",
      "Interview Campaign packs require a Target Profile.",
    );
  }
  if (!isGrowth) {
    const deadline = asString(plan.deadline);
    if (
      deadline !== asString(manifestTarget.deadline) ||
      (target?.deadline !== undefined && deadline !== asString(target.deadline))
    ) {
      add(
        violations,
        "SEMANTIC_TARGET_DEADLINE_MISMATCH",
        "/preparation-plan/deadline",
        "Campaign deadline must agree across manifest, plan, and target profile.",
      );
    }
    const profileRef = asJsonObject(plan.target_profile_ref, "target profile ref");
    if (
      target !== undefined &&
      (profileRef.profile_id !== target.profile_id ||
        profileRef.profile_version !== target.profile_version)
    ) {
      add(
        violations,
        "SEMANTIC_TARGET_PROFILE_REF_MISMATCH",
        "/preparation-plan/target_profile_ref",
        "Plan target_profile_ref must identify the included target profile exactly.",
      );
    }
  }

  const sources = isGrowth ? objects(plan.sources) : objects(target?.sources);
  const sourceIds = new Set(ids(sources, "source_id"));
  for (const sourceRef of [
    ...collectSourceReferences(plan),
    ...(target === undefined ? [] : collectSourceReferences(target)),
  ]) {
    if (!sourceIds.has(sourceRef)) {
      add(
        violations,
        "SEMANTIC_UNKNOWN_SOURCE_REF",
        "/",
        `Source reference ${sourceRef} is not declared by this pack variant.`,
      );
    }
  }

  const proposedCompetencies = objects(target?.proposed_competencies);
  const proposedIds = new Set(ids(proposedCompetencies, "proposed_competency_id"));
  for (const reference of [
    ...collectCompetencyReferences(plan),
    ...(target === undefined ? [] : collectCompetencyReferences(target)),
  ]) {
    const key = referenceKey(reference)!;
    if (reference.kind === "canonical") {
      if (!catalogState.competencyIds.has(key)) {
        add(
          violations,
          "SEMANTIC_UNKNOWN_CANONICAL_REF",
          "/",
          `Canonical competency ${key} is absent from the exported catalog.`,
        );
      }
      if (asString(reference.catalog_version) !== catalogState.catalogVersion) {
        add(
          violations,
          "SEMANTIC_CATALOG_VERSION_MISMATCH",
          "/",
          `Canonical competency ${key} uses the wrong catalog version.`,
        );
      }
    } else if (!proposedIds.has(key)) {
      add(
        violations,
        "SEMANTIC_UNKNOWN_PROPOSED_REF",
        "/",
        `Proposed competency ${key} is not declared in this pack.`,
      );
    }
  }

  const requirements = objects(target?.requirements);
  const requirementIds = new Set(ids(requirements, "requirement_id"));
  const requirementGroups = objects(target?.requirement_groups);
  for (const [index, group] of requirementGroups.entries()) {
    const members = asArray(group.member_requirement_ids).flatMap((item) =>
      typeof item === "string" ? [item] : [],
    );
    if (members.some((id) => !requirementIds.has(id))) {
      add(
        violations,
        "SEMANTIC_UNKNOWN_REQUIREMENT_REF",
        `/target-profile/requirement_groups/${index}/member_requirement_ids`,
        "Every requirement-group member must resolve.",
      );
    }
    const rule = asJsonObject(group.rule, "requirement group rule");
    if (asString(rule.kind) === "K_OF_N" && (asNumber(rule.k) ?? 0) > members.length) {
      add(
        violations,
        "SEMANTIC_REQUIREMENT_CARDINALITY",
        `/target-profile/requirement_groups/${index}/rule/k`,
        "K_OF_N cannot require more members than the group contains.",
      );
    }
  }

  const phases = objects(plan.phases);
  const milestones = objects(plan.milestones);
  const activities = objects(plan.proposed_activities);
  const phaseIds = new Set(ids(phases, "phase_id"));
  const milestoneIds = new Set(ids(milestones, "milestone_id"));
  const activityIds = new Set(ids(activities, "activity_id"));
  for (const [index, phase] of phases.entries()) {
    const starts = asString(phase.starts_on);
    const ends = asString(phase.ends_on);
    if (starts !== undefined && ends !== undefined && starts > ends) {
      add(
        violations,
        "SEMANTIC_DATE_ORDER",
        `/preparation-plan/phases/${index}`,
        "A phase cannot end before it starts.",
      );
    }
  }
  for (const [index, milestone] of milestones.entries()) {
    if (!phaseIds.has(asString(milestone.phase_id)!)) {
      add(
        violations,
        "SEMANTIC_UNKNOWN_PHASE_REF",
        `/preparation-plan/milestones/${index}/phase_id`,
        "Milestone phase_id must resolve.",
      );
    }
  }
  for (const [index, activity] of activities.entries()) {
    const effort = asJsonObject(activity.effort, "activity effort");
    if ((asNumber(effort.minimum_minutes) ?? 0) > (asNumber(effort.maximum_minutes) ?? 0)) {
      add(
        violations,
        "SEMANTIC_EFFORT_RANGE_ORDER",
        `/preparation-plan/proposed_activities/${index}/effort`,
        "Activity minimum effort cannot exceed maximum effort.",
      );
    }
  }
  for (const [index, path] of objects(plan.paths).entries()) {
    const unknownMilestone = asArray(path.milestone_ids).some(
      (id) => typeof id === "string" && !milestoneIds.has(id),
    );
    if (unknownMilestone) {
      add(
        violations,
        "SEMANTIC_UNKNOWN_MILESTONE_REF",
        `/preparation-plan/paths/${index}/milestone_ids`,
        "Path milestone IDs must resolve.",
      );
    }
    const unknownActivity = asArray(path.activity_ids).some(
      (id) => typeof id === "string" && !activityIds.has(id),
    );
    if (unknownActivity) {
      add(
        violations,
        "SEMANTIC_UNKNOWN_ACTIVITY_REF",
        `/preparation-plan/paths/${index}/activity_ids`,
        "Path activity IDs must resolve.",
      );
    }
  }
  for (const [index, checkpoint] of objects(plan.mock_checkpoints).entries()) {
    if (!milestoneIds.has(asString(checkpoint.milestone_id)!)) {
      add(
        violations,
        "SEMANTIC_UNKNOWN_MILESTONE_REF",
        `/preparation-plan/mock_checkpoints/${index}/milestone_id`,
        "Mock checkpoint milestone_id must resolve.",
      );
    }
  }

  checkUniqueNamespaces(violations, [
    [sources, "source_id", "/sources"],
    [requirements, "requirement_id", "/target-profile/requirements"],
    [requirementGroups, "requirement_group_id", "/target-profile/requirement_groups"],
    [objects(target?.interview_stages), "stage_id", "/target-profile/interview_stages"],
    [proposedCompetencies, "proposed_competency_id", "/target-profile/proposed_competencies"],
    [phases, "phase_id", "/preparation-plan/phases"],
    [milestones, "milestone_id", "/preparation-plan/milestones"],
    [activities, "activity_id", "/preparation-plan/proposed_activities"],
  ]);

  if (proposedCompetencies.length + activities.length > 500) {
    add(
      violations,
      "SEMANTIC_PROPOSAL_LIMIT",
      "/",
      "Combined proposed competency and activity count cannot exceed 500.",
    );
  }

  const proposedEdges = objects(target?.prerequisite_proposals).flatMap((edge) => {
    const from = isJsonObject(edge.from) ? referenceKey(edge.from) : undefined;
    const to = isJsonObject(edge.to) ? referenceKey(edge.to) : undefined;
    return from === undefined || to === undefined ? [] : [{ from, to }];
  });
  if (proposedEdges.some((edge) => edge.from === edge.to)) {
    add(
      violations,
      "SEMANTIC_PREREQUISITE_SELF_EDGE",
      "/target-profile/prerequisite_proposals",
      "Prerequisite proposals cannot contain a self-edge.",
    );
  } else if (findCycle([...(catalogState.prerequisiteEdges ?? []), ...proposedEdges])) {
    add(
      violations,
      "SEMANTIC_PREREQUISITE_CYCLE",
      "/target-profile/prerequisite_proposals",
      "Canonical and proposed prerequisite edges must remain acyclic.",
    );
  }

  return validationResult(violations);
}

export function validatePreparationPack(input: PreparationPackInput): ValidationResult {
  const structuralResults = [
    validateSchema("preparation-manifest", input.manifest),
    validateSchema("preparation-plan", input.preparationPlan),
    validateSchema("preparation-context", input.preparationContext),
    ...(input.targetProfile === undefined
      ? []
      : [validateSchema("target-profile", input.targetProfile)]),
  ];
  const structuralViolations = structuralResults.flatMap((result) =>
    result.valid ? [] : result.violations,
  );
  return structuralViolations.length > 0
    ? validationResult(structuralViolations)
    : validatePreparationPackSemantics(input);
}
