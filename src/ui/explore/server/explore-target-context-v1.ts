import "server-only";

import {
  asArray,
  asJsonObject,
  asNumber,
  asString,
  hasDuplicates,
  isSorted,
  type JsonObject,
  type JsonValue,
} from "../../../shared/contracts/json";
import {
  type ContractViolation,
  type ValidationResult,
  validationResult,
} from "../../../shared/contracts/result";
import { validateSchema } from "../../../shared/contracts/schema-registry";

export type TargetRequirementRuleType =
  "ALL" | "ANY" | "K_OF_N" | "MANDATORY_FLOOR" | "WEIGHTED_THRESHOLD";
export type TargetRequirementCriticality = "DIFFERENTIATING" | "MANDATORY" | "PREFERRED";
export type TargetRequirementDimension =
  "APPLICATION" | "INTERVIEW_EXECUTION" | "KNOWLEDGE" | "RECALL";
export type TargetRequirementLevel = "COMPLETED" | "MASTERED" | "VERIFIED";

export interface ExploreTargetNodeMemberV1 {
  readonly memberType: "NODE";
  readonly nodeScope: "canonical" | "workspace_overlay";
  readonly nodeType: "COMPETENCY" | "DOMAIN";
  readonly nodeRef: string;
  readonly dimension: TargetRequirementDimension;
  readonly requiredLevel: TargetRequirementLevel;
  readonly weight: number | null;
}

export interface ExploreTargetRuleMemberV1 {
  readonly memberType: "RULE";
  readonly ruleKey: string;
  readonly weight: number | null;
}

export type ExploreTargetRequirementMemberV1 =
  ExploreTargetNodeMemberV1 | ExploreTargetRuleMemberV1;

export interface ExploreTargetRequirementRuleV1 {
  readonly ruleKey: string;
  readonly ruleType: TargetRequirementRuleType;
  readonly title: string;
  readonly criticality: TargetRequirementCriticality;
  readonly explanation: string;
  readonly accessibilityLabel: string;
  readonly requiredCount: number | null;
  readonly threshold: number | null;
  readonly members: readonly ExploreTargetRequirementMemberV1[];
}

export interface ExploreTargetCanonicalNodeV1 {
  readonly nodeRef: string;
  readonly nodeType: "COMPETENCY" | "DOMAIN";
  readonly title: string;
  readonly description: string;
  readonly domainRef: string | null;
}

export interface ExploreTargetCanonicalEdgeV1 {
  readonly edgeKey: string;
  readonly edgeType: "PREREQUISITE_OF";
  readonly sourceRef: string;
  readonly targetRef: string;
  readonly blocking: true;
  readonly rationale: string;
}

export interface ExploreTargetOverlayNodeV1 {
  readonly nodeRef: string;
  readonly nodeType: "COMPETENCY";
  readonly title: string;
  readonly domainRef: string;
  readonly workspaceId: string;
}

export interface ExploreTargetContextV1 {
  readonly contract: { readonly name: "ExploreTargetContextV1"; readonly version: "1.0.0" };
  readonly workspaceId: string;
  readonly readinessGoal: {
    readonly readinessGoalId: string;
    readonly readinessGoalKey: string;
    readonly lifecycle: "active" | "archived" | "completed" | "paused";
    readonly aggregateVersion: string;
  };
  readonly targetProfile: {
    readonly profileVersionId: string;
    readonly profileVersionKey: string;
    readonly catalogVersionKey: string;
    readonly roadmapVersionKey: string | null;
    readonly rootRuleKey: string;
    readonly readinessThreshold: number;
  };
  readonly overlayVersion: string;
  readonly requirementRules: readonly ExploreTargetRequirementRuleV1[];
  readonly scope: {
    readonly requiredCanonicalNodeRefs: readonly string[];
    readonly requiredOverlayNodeRefs: readonly string[];
    readonly roadmapNodeRefs: readonly string[];
    readonly prerequisiteClosureNodeRefs: readonly string[];
    readonly canonicalNodes: readonly ExploreTargetCanonicalNodeV1[];
    readonly canonicalEdges: readonly ExploreTargetCanonicalEdgeV1[];
    readonly requiredOverlayNodes: readonly ExploreTargetOverlayNodeV1[];
  };
}

function addViolation(
  violations: ContractViolation[],
  code: string,
  path: string,
  message: string,
): void {
  violations.push({ code, path, message });
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function sameValues(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function memberKey(member: JsonObject): string {
  return asString(member.memberType) === "NODE"
    ? `NODE:${asString(member.nodeRef)!}:${asString(member.dimension)!}`
    : `RULE:${asString(member.ruleKey)!}`;
}

function graphHasCycle(adjacency: ReadonlyMap<string, readonly string[]>): boolean {
  const visited = new Set<string>();
  const active = new Set<string>();
  const visit = (node: string): boolean => {
    if (active.has(node)) return true;
    if (visited.has(node)) return false;
    visited.add(node);
    active.add(node);
    for (const next of adjacency.get(node) ?? []) if (visit(next)) return true;
    active.delete(node);
    return false;
  };
  return [...adjacency.keys()].some(visit);
}

function validateRules(
  source: JsonObject,
  violations: ContractViolation[],
): Readonly<{ canonicalRefs: string[]; overlayRefs: string[] }> {
  const profile = asJsonObject(source.targetProfile, "target profile");
  const scope = asJsonObject(source.scope, "target scope");
  const rules = asArray(source.requirementRules).map((rule) =>
    asJsonObject(rule, "target requirement rule"),
  );
  const ruleKeys = rules.map((rule) => asString(rule.ruleKey)!);
  const ruleKeySet = new Set(ruleKeys);
  const adjacency = new Map<string, string[]>();
  const canonicalRefs: string[] = [];
  const overlayRefs: string[] = [];

  if (!isSorted(ruleKeys))
    addViolation(
      violations,
      "EXPLORE_TARGET_RULES_NOT_SORTED",
      "/requirementRules",
      "Requirement rules must be sorted by ruleKey.",
    );
  if (hasDuplicates(ruleKeys))
    addViolation(
      violations,
      "EXPLORE_TARGET_RULE_DUPLICATE",
      "/requirementRules",
      "Requirement rule keys must be unique.",
    );

  const rootRuleKey = asString(profile.rootRuleKey)!;
  if (!ruleKeySet.has(rootRuleKey))
    addViolation(
      violations,
      "EXPLORE_TARGET_ROOT_RULE_MISSING",
      "/targetProfile/rootRuleKey",
      "The target root rule must resolve in requirementRules.",
    );

  for (const [ruleIndex, rule] of rules.entries()) {
    const ruleKey = asString(rule.ruleKey)!;
    const ruleType = asString(rule.ruleType)! as TargetRequirementRuleType;
    const criticality = asString(rule.criticality)!;
    const requiredCount = rule.requiredCount === null ? null : asNumber(rule.requiredCount)!;
    const threshold = rule.threshold === null ? null : asNumber(rule.threshold)!;
    const members = asArray(rule.members).map((member) =>
      asJsonObject(member, "target requirement member"),
    );
    const memberKeys = members.map(memberKey);
    const referencedRules: string[] = [];

    if (!isSorted(memberKeys))
      addViolation(
        violations,
        "EXPLORE_TARGET_MEMBERS_NOT_SORTED",
        `/requirementRules/${ruleIndex}/members`,
        "Requirement members must use stable lexical ordering.",
      );
    if (hasDuplicates(memberKeys))
      addViolation(
        violations,
        "EXPLORE_TARGET_MEMBER_DUPLICATE",
        `/requirementRules/${ruleIndex}/members`,
        "A requirement rule cannot repeat the same semantic member.",
      );

    for (const [memberIndex, member] of members.entries()) {
      if (asString(member.memberType) === "RULE") {
        const referencedRule = asString(member.ruleKey)!;
        referencedRules.push(referencedRule);
        if (!ruleKeySet.has(referencedRule))
          addViolation(
            violations,
            "EXPLORE_TARGET_RULE_REFERENCE_DANGLING",
            `/requirementRules/${ruleIndex}/members/${memberIndex}/ruleKey`,
            "Referenced requirement rules must exist in the same target profile.",
          );
      } else {
        const nodeRef = asString(member.nodeRef)!;
        if (asString(member.nodeScope) === "canonical") canonicalRefs.push(nodeRef);
        else overlayRefs.push(nodeRef);
        if (
          asString(member.nodeScope) === "workspace_overlay" &&
          asString(member.nodeType) !== "COMPETENCY"
        )
          addViolation(
            violations,
            "EXPLORE_TARGET_OVERLAY_REQUIREMENT_TYPE",
            `/requirementRules/${ruleIndex}/members/${memberIndex}/nodeType`,
            "Workspace Overlay requirements may reference accepted personal competencies only.",
          );
      }
    }
    adjacency.set(ruleKey, referencedRules);

    const weights = members.map((member) => member.weight);
    const parameterValid =
      (ruleType === "K_OF_N" &&
        requiredCount !== null &&
        requiredCount <= members.length &&
        threshold === null &&
        weights.every((weight) => weight === null)) ||
      (ruleType === "WEIGHTED_THRESHOLD" &&
        requiredCount === null &&
        threshold !== null &&
        weights.every((weight) => weight !== null)) ||
      (["ALL", "ANY"].includes(ruleType) &&
        requiredCount === null &&
        threshold === null &&
        weights.every((weight) => weight === null)) ||
      (ruleType === "MANDATORY_FLOOR" &&
        criticality === "MANDATORY" &&
        requiredCount === null &&
        threshold === null &&
        weights.every((weight) => weight === null) &&
        members.length === 1 &&
        asString(members[0]?.memberType) === "NODE");
    if (!parameterValid)
      addViolation(
        violations,
        "EXPLORE_TARGET_RULE_PARAMETER_SHAPE",
        `/requirementRules/${ruleIndex}`,
        "Rule parameters, weights, and mandatory-floor membership must match the rule type.",
      );
  }

  if (graphHasCycle(adjacency))
    addViolation(
      violations,
      "EXPLORE_TARGET_RULE_CYCLE",
      "/requirementRules",
      "Requirement rule references must be acyclic.",
    );

  const reachable = new Set<string>();
  const visit = (ruleKey: string): void => {
    if (reachable.has(ruleKey)) return;
    reachable.add(ruleKey);
    for (const child of adjacency.get(ruleKey) ?? []) visit(child);
  };
  visit(rootRuleKey);
  if (ruleKeys.some((ruleKey) => !reachable.has(ruleKey)))
    addViolation(
      violations,
      "EXPLORE_TARGET_RULE_UNREACHABLE",
      "/requirementRules",
      "Every requirement rule must be reachable from the target root.",
    );

  const rootRule = rules.find((rule) => asString(rule.ruleKey) === rootRuleKey);
  if (
    rootRule !== undefined &&
    asString(rootRule.ruleType) === "WEIGHTED_THRESHOLD" &&
    asNumber(rootRule.threshold) !== asNumber(profile.readinessThreshold)
  )
    addViolation(
      violations,
      "EXPLORE_TARGET_ROOT_THRESHOLD_MISMATCH",
      "/targetProfile/readinessThreshold",
      "A root weighted threshold must equal the effective target-profile threshold.",
    );

  const declaredCanonical = asArray(scope.requiredCanonicalNodeRefs).map((value) =>
    asString(value)!,
  );
  const declaredOverlay = asArray(scope.requiredOverlayNodeRefs).map((value) => asString(value)!);
  if (!sameValues(declaredCanonical, sortedUnique(canonicalRefs)))
    addViolation(
      violations,
      "EXPLORE_TARGET_CANONICAL_REQUIREMENTS_MISMATCH",
      "/scope/requiredCanonicalNodeRefs",
      "Declared canonical requirement refs must exactly match the rule tree.",
    );
  if (!sameValues(declaredOverlay, sortedUnique(overlayRefs)))
    addViolation(
      violations,
      "EXPLORE_TARGET_OVERLAY_REQUIREMENTS_MISMATCH",
      "/scope/requiredOverlayNodeRefs",
      "Declared overlay requirement refs must exactly match the rule tree.",
    );
  return { canonicalRefs, overlayRefs };
}

function validateScope(source: JsonObject, violations: ContractViolation[]): void {
  const workspaceId = asString(source.workspaceId)!;
  const scope = asJsonObject(source.scope, "target scope");
  const refArrays = [
    ["requiredCanonicalNodeRefs", scope.requiredCanonicalNodeRefs],
    ["requiredOverlayNodeRefs", scope.requiredOverlayNodeRefs],
    ["roadmapNodeRefs", scope.roadmapNodeRefs],
    ["prerequisiteClosureNodeRefs", scope.prerequisiteClosureNodeRefs],
  ] as const;
  for (const [name, raw] of refArrays) {
    const values = asArray(raw).map((value) => asString(value)!);
    if (!isSorted(values) || hasDuplicates(values))
      addViolation(
        violations,
        "EXPLORE_TARGET_SCOPE_REFS_UNSTABLE",
        `/scope/${name}`,
        "Scope reference arrays must be sorted and unique.",
      );
  }

  const requiredCanonical = asArray(scope.requiredCanonicalNodeRefs).map((value) =>
    asString(value)!,
  );
  const requiredOverlay = asArray(scope.requiredOverlayNodeRefs).map((value) => asString(value)!);
  const roadmapRefs = asArray(scope.roadmapNodeRefs).map((value) => asString(value)!);
  const prerequisiteRefs = asArray(scope.prerequisiteClosureNodeRefs).map((value) =>
    asString(value)!,
  );
  const canonicalNodes = asArray(scope.canonicalNodes).map((node) =>
    asJsonObject(node, "canonical target node"),
  );
  const overlayNodes = asArray(scope.requiredOverlayNodes).map((node) =>
    asJsonObject(node, "required overlay node"),
  );
  const canonicalEdges = asArray(scope.canonicalEdges).map((edge) =>
    asJsonObject(edge, "canonical target edge"),
  );
  const canonicalNodeRefs = canonicalNodes.map((node) => asString(node.nodeRef)!);
  const canonicalNodeTypes = new Map(
    canonicalNodes.map((node) => [asString(node.nodeRef)!, asString(node.nodeType)!]),
  );
  const overlayNodeRefs = overlayNodes.map((node) => asString(node.nodeRef)!);
  const edgeKeys = canonicalEdges.map((edge) => asString(edge.edgeKey)!);

  if (!isSorted(canonicalNodeRefs) || hasDuplicates(canonicalNodeRefs))
    addViolation(
      violations,
      "EXPLORE_TARGET_CANONICAL_NODES_UNSTABLE",
      "/scope/canonicalNodes",
      "Canonical target nodes must be sorted and unique.",
    );
  if (!isSorted(overlayNodeRefs) || hasDuplicates(overlayNodeRefs))
    addViolation(
      violations,
      "EXPLORE_TARGET_OVERLAY_NODES_UNSTABLE",
      "/scope/requiredOverlayNodes",
      "Required overlay nodes must be sorted and unique.",
    );
  if (!isSorted(edgeKeys) || hasDuplicates(edgeKeys))
    addViolation(
      violations,
      "EXPLORE_TARGET_CANONICAL_EDGES_UNSTABLE",
      "/scope/canonicalEdges",
      "Canonical target edges must be sorted and unique.",
    );

  if (!sameValues(requiredOverlay, overlayNodeRefs))
    addViolation(
      violations,
      "EXPLORE_TARGET_REQUIRED_OVERLAY_NODE_MISMATCH",
      "/scope/requiredOverlayNodes",
      "Required overlay nodes must exactly match the declared overlay requirements.",
    );
  if (overlayNodes.some((node) => asString(node.workspaceId) !== workspaceId))
    addViolation(
      violations,
      "EXPLORE_TARGET_FOREIGN_OVERLAY_NODE",
      "/scope/requiredOverlayNodes",
      "Every required overlay node must belong to the selected workspace.",
    );

  const canonicalSet = new Set(canonicalNodeRefs);
  if (overlayNodeRefs.some((nodeRef) => canonicalSet.has(nodeRef)))
    addViolation(
      violations,
      "EXPLORE_TARGET_NODE_IDENTITY_COLLISION",
      "/scope/requiredOverlayNodes",
      "Canonical and Workspace Overlay nodes must not share a global stable node reference.",
    );
  const requirementRules = asArray(source.requirementRules).map((rule) =>
    asJsonObject(rule, "target requirement rule"),
  );
  for (const [ruleIndex, rule] of requirementRules.entries()) {
    const members = asArray(rule.members).map((member) =>
      asJsonObject(member, "target requirement member"),
    );
    for (const [memberIndex, member] of members.entries()) {
      if (
        asString(member.memberType) === "NODE" &&
        asString(member.nodeScope) === "canonical" &&
        canonicalNodeTypes.has(asString(member.nodeRef)!) &&
        canonicalNodeTypes.get(asString(member.nodeRef)!) !== asString(member.nodeType)
      )
        addViolation(
          violations,
          "EXPLORE_TARGET_REQUIREMENT_NODE_TYPE_MISMATCH",
          `/requirementRules/${ruleIndex}/members/${memberIndex}/nodeType`,
          "Canonical requirement member types must match their resolved Catalog nodes.",
        );
    }
  }
  for (const nodeRef of [...requiredCanonical, ...roadmapRefs, ...prerequisiteRefs]) {
    if (!canonicalSet.has(nodeRef))
      addViolation(
        violations,
        "EXPLORE_TARGET_SCOPE_NODE_DANGLING",
        "/scope/canonicalNodes",
        "Every roadmap, requirement, and prerequisite-closure ref must resolve.",
      );
  }
  const seedSet = new Set([...requiredCanonical, ...roadmapRefs]);
  if (prerequisiteRefs.some((nodeRef) => seedSet.has(nodeRef)))
    addViolation(
      violations,
      "EXPLORE_TARGET_PREREQUISITE_SCOPE_OVERLAP",
      "/scope/prerequisiteClosureNodeRefs",
      "Prerequisite closure refs exclude direct roadmap and requirement seeds.",
    );

  const expectedRefs = new Set([...seedSet, ...prerequisiteRefs]);
  for (const node of overlayNodes) expectedRefs.add(asString(node.domainRef)!);
  for (const node of canonicalNodes) {
    const nodeRef = asString(node.nodeRef)!;
    const nodeType = asString(node.nodeType)!;
    const domainRef = node.domainRef === null ? null : asString(node.domainRef)!;
    if (
      (nodeRef.startsWith("domain:") && nodeType !== "DOMAIN") ||
      (nodeRef.startsWith("competency:") && nodeType !== "COMPETENCY")
    )
      addViolation(
        violations,
        "EXPLORE_TARGET_CANONICAL_NODE_TYPE_MISMATCH",
        "/scope/canonicalNodes",
        "Canonical node types must agree with their globally stable reference prefix.",
      );
    if (nodeType === "DOMAIN" && domainRef !== null)
      addViolation(
        violations,
        "EXPLORE_TARGET_DOMAIN_SHAPE",
        "/scope/canonicalNodes",
        "Canonical domain nodes cannot have a domain parent.",
      );
    if (nodeType === "COMPETENCY") {
      if (
        domainRef === null ||
        !canonicalSet.has(domainRef) ||
        canonicalNodeTypes.get(domainRef) !== "DOMAIN"
      )
        addViolation(
          violations,
          "EXPLORE_TARGET_COMPETENCY_DOMAIN_DANGLING",
          "/scope/canonicalNodes",
          "Every canonical competency must include a canonical DOMAIN parent.",
        );
      else expectedRefs.add(domainRef);
    }
    if (!expectedRefs.has(nodeRef) && nodeType !== "DOMAIN")
      addViolation(
        violations,
        "EXPLORE_TARGET_CANONICAL_NODE_OUTSIDE_CLOSURE",
        "/scope/canonicalNodes",
        "Canonical competency nodes must belong to the bounded target closure.",
      );
  }
  if (!sameValues(canonicalNodeRefs, sortedUnique([...expectedRefs])))
    addViolation(
      violations,
      "EXPLORE_TARGET_CANONICAL_CLOSURE_MISMATCH",
      "/scope/canonicalNodes",
      "Canonical nodes must exactly equal seeds, prerequisite ancestors, and domain parents.",
    );

  const adjacency = new Map<string, string[]>();
  const reverseAdjacency = new Map<string, string[]>();
  for (const edge of canonicalEdges) {
    const sourceRef = asString(edge.sourceRef)!;
    const targetRef = asString(edge.targetRef)!;
    if (!canonicalSet.has(sourceRef) || !canonicalSet.has(targetRef))
      addViolation(
        violations,
        "EXPLORE_TARGET_EDGE_DANGLING",
        "/scope/canonicalEdges",
        "Canonical prerequisite edge endpoints must resolve inside the closure.",
      );
    adjacency.set(sourceRef, [...(adjacency.get(sourceRef) ?? []), targetRef]);
    reverseAdjacency.set(targetRef, [...(reverseAdjacency.get(targetRef) ?? []), sourceRef]);
  }
  if (graphHasCycle(adjacency))
    addViolation(
      violations,
      "EXPLORE_TARGET_PREREQUISITE_CYCLE",
      "/scope/canonicalEdges",
      "The bounded prerequisite graph must be acyclic.",
    );

  const reachablePrerequisites = new Set<string>();
  const visitPrerequisites = (nodeRef: string): void => {
    for (const prerequisiteRef of reverseAdjacency.get(nodeRef) ?? []) {
      if (reachablePrerequisites.has(prerequisiteRef)) continue;
      reachablePrerequisites.add(prerequisiteRef);
      visitPrerequisites(prerequisiteRef);
    }
  };
  for (const seedRef of seedSet) {
    if (canonicalNodeTypes.get(seedRef) === "COMPETENCY") visitPrerequisites(seedRef);
  }
  const expectedPrerequisiteRefs = sortedUnique(
    [...reachablePrerequisites].filter((nodeRef) => !seedSet.has(nodeRef)),
  );
  if (!sameValues(prerequisiteRefs, expectedPrerequisiteRefs))
    addViolation(
      violations,
      "EXPLORE_TARGET_PREREQUISITE_CLOSURE_MISMATCH",
      "/scope/prerequisiteClosureNodeRefs",
      "Prerequisite closure refs must exactly equal the transitive ancestors of direct seeds.",
    );
}

function validateSemantics(value: unknown): ValidationResult {
  const source = asJsonObject(value, "ExploreTargetContextV1");
  const violations: ContractViolation[] = [];
  validateRules(source, violations);
  validateScope(source, violations);
  return validationResult(violations);
}

export function validateExploreTargetContextV1(value: unknown): ValidationResult {
  const structural = validateSchema("explore-target-context", value);
  return structural.valid ? validateSemantics(value) : structural;
}

export class ExploreTargetContextContractError extends Error {
  readonly violations: readonly ContractViolation[];

  constructor(violations: readonly ContractViolation[]) {
    super("Explore target context failed its contract.");
    this.name = "ExploreTargetContextContractError";
    this.violations = violations.map(({ code, path, message }) => ({ code, path, message }));
  }
}

function nullableNumber(value: JsonValue | undefined): number | null {
  return value === null ? null : asNumber(value)!;
}

function nullableString(value: unknown): string | null {
  return value === null ? null : asString(value as never)!;
}

function decodeMember(value: unknown): ExploreTargetRequirementMemberV1 {
  const member = asJsonObject(value, "target requirement member");
  if (asString(member.memberType) === "RULE") {
    return {
      memberType: "RULE",
      ruleKey: asString(member.ruleKey)!,
      weight: nullableNumber(member.weight),
    };
  }
  return {
    memberType: "NODE",
    nodeScope: asString(member.nodeScope)! as ExploreTargetNodeMemberV1["nodeScope"],
    nodeType: asString(member.nodeType)! as ExploreTargetNodeMemberV1["nodeType"],
    nodeRef: asString(member.nodeRef)!,
    dimension: asString(member.dimension)! as TargetRequirementDimension,
    requiredLevel: asString(member.requiredLevel)! as TargetRequirementLevel,
    weight: nullableNumber(member.weight),
  };
}

export function decodeExploreTargetContextV1(value: unknown): ExploreTargetContextV1 {
  const validation = validateExploreTargetContextV1(value);
  if (!validation.valid) throw new ExploreTargetContextContractError(validation.violations);

  const source = asJsonObject(value, "ExploreTargetContextV1");
  const goal = asJsonObject(source.readinessGoal, "readiness goal");
  const profile = asJsonObject(source.targetProfile, "target profile");
  const scope = asJsonObject(source.scope, "target scope");
  const stringArray = (raw: JsonValue | undefined): string[] =>
    asArray(raw).map((item) => asString(item)!);

  return {
    contract: { name: "ExploreTargetContextV1", version: "1.0.0" },
    workspaceId: asString(source.workspaceId)!,
    readinessGoal: {
      readinessGoalId: asString(goal.readinessGoalId)!,
      readinessGoalKey: asString(goal.readinessGoalKey)!,
      lifecycle: asString(goal.lifecycle)! as ExploreTargetContextV1["readinessGoal"]["lifecycle"],
      aggregateVersion: asString(goal.aggregateVersion)!,
    },
    targetProfile: {
      profileVersionId: asString(profile.profileVersionId)!,
      profileVersionKey: asString(profile.profileVersionKey)!,
      catalogVersionKey: asString(profile.catalogVersionKey)!,
      roadmapVersionKey: nullableString(profile.roadmapVersionKey),
      rootRuleKey: asString(profile.rootRuleKey)!,
      readinessThreshold: asNumber(profile.readinessThreshold)!,
    },
    overlayVersion: asString(source.overlayVersion)!,
    requirementRules: asArray(source.requirementRules).map((ruleValue) => {
      const rule = asJsonObject(ruleValue, "target requirement rule");
      return {
        ruleKey: asString(rule.ruleKey)!,
        ruleType: asString(rule.ruleType)! as TargetRequirementRuleType,
        title: asString(rule.title)!,
        criticality: asString(rule.criticality)! as TargetRequirementCriticality,
        explanation: asString(rule.explanation)!,
        accessibilityLabel: asString(rule.accessibilityLabel)!,
        requiredCount: nullableNumber(rule.requiredCount),
        threshold: nullableNumber(rule.threshold),
        members: asArray(rule.members).map(decodeMember),
      };
    }),
    scope: {
      requiredCanonicalNodeRefs: stringArray(scope.requiredCanonicalNodeRefs),
      requiredOverlayNodeRefs: stringArray(scope.requiredOverlayNodeRefs),
      roadmapNodeRefs: stringArray(scope.roadmapNodeRefs),
      prerequisiteClosureNodeRefs: stringArray(scope.prerequisiteClosureNodeRefs),
      canonicalNodes: asArray(scope.canonicalNodes).map((nodeValue) => {
        const node = asJsonObject(nodeValue, "canonical target node");
        return {
          nodeRef: asString(node.nodeRef)!,
          nodeType: asString(node.nodeType)! as ExploreTargetCanonicalNodeV1["nodeType"],
          title: asString(node.title)!,
          description: asString(node.description)!,
          domainRef: nullableString(node.domainRef),
        };
      }),
      canonicalEdges: asArray(scope.canonicalEdges).map((edgeValue) => {
        const edge = asJsonObject(edgeValue, "canonical target edge");
        return {
          edgeKey: asString(edge.edgeKey)!,
          edgeType: "PREREQUISITE_OF",
          sourceRef: asString(edge.sourceRef)!,
          targetRef: asString(edge.targetRef)!,
          blocking: true,
          rationale: asString(edge.rationale)!,
        };
      }),
      requiredOverlayNodes: asArray(scope.requiredOverlayNodes).map((nodeValue) => {
        const node = asJsonObject(nodeValue, "required overlay node");
        return {
          nodeRef: asString(node.nodeRef)!,
          nodeType: "COMPETENCY",
          title: asString(node.title)!,
          domainRef: asString(node.domainRef)!,
          workspaceId: asString(node.workspaceId)!,
        };
      }),
    },
  };
}
