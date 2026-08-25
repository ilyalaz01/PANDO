import {
  asArray,
  asJsonObject,
  asNumber,
  asString,
  asciiCompare,
  hasDuplicates,
  isJsonObject,
  isSorted,
  type JsonObject,
  type JsonValue,
  sha256,
} from "./json";
import { type ContractViolation, type ValidationResult, validationResult } from "./result";
import { validateSchema } from "./schema-registry";

function objectArray(value: JsonValue | undefined): JsonObject[] {
  return asArray(value).filter(isJsonObject);
}

function violation(code: string, path: string, message: string): ContractViolation {
  return { code, path, message };
}

function addViolation(
  violations: ContractViolation[],
  code: string,
  path: string,
  message: string,
): void {
  if (!violations.some((item) => item.code === code)) {
    violations.push(violation(code, path, message));
  }
}

function ids(items: readonly JsonObject[], field: string): string[] {
  return items.flatMap((item) => {
    const value = asString(item[field]);
    return value === undefined ? [] : [value];
  });
}

function requirementMembers(rule: JsonObject): JsonObject[] {
  const member = rule.member;
  if (isJsonObject(member)) return [member];
  return objectArray(rule.members).map((item) => {
    const weightedMember = item.member;
    return isJsonObject(weightedMember) ? weightedMember : item;
  });
}

function memberId(member: JsonObject): string | undefined {
  return asString(member.nodeId) ?? asString(member.ruleId);
}

function graphHasCycle(adjacency: ReadonlyMap<string, readonly string[]>): boolean {
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

export function computeGraphStructuralFingerprint(value: unknown): string {
  const projection = asJsonObject(value, "GraphProjectionV1");
  const layout = asJsonObject(projection.layout, "layout");
  const fixedNodeSize = asJsonObject(layout.fixedNodeSize, "fixedNodeSize");
  const spacing = asJsonObject(layout.spacing, "spacing");

  const nodeTuples = objectArray(projection.nodes)
    .map((node) => [
      asString(node.nodeId) ?? "",
      asString(node.nodeType) ?? "",
      asString(node.domainNodeId) ?? null,
    ])
    .sort((left, right) => asciiCompare(String(left[0]), String(right[0])));
  const edgeTuples = objectArray(projection.edges)
    .map((edge) => [
      asString(edge.edgeId) ?? "",
      asString(edge.edgeType) ?? "",
      asString(edge.sourceNodeId) ?? "",
      asString(edge.targetNodeId) ?? "",
    ])
    .sort((left, right) => asciiCompare(String(left[0]), String(right[0])));

  return sha256(
    JSON.stringify([
      "GraphProjectionV1Structure",
      1,
      asString(layout.algorithmVersion),
      asNumber(fixedNodeSize.width),
      asNumber(fixedNodeSize.height),
      asNumber(spacing.rank),
      asNumber(spacing.node),
      nodeTuples,
      edgeTuples,
    ]),
  );
}

export function validateGraphProjectionSemantics(value: unknown): ValidationResult {
  const projection = asJsonObject(value, "GraphProjectionV1");
  const violations: ContractViolation[] = [];
  const nodes = objectArray(projection.nodes);
  const edges = objectArray(projection.edges);
  const layout = asJsonObject(projection.layout, "layout");
  const positions = objectArray(layout.positions);
  const requirements = asJsonObject(projection.requirements, "requirements");
  const rules = objectArray(requirements.rules);
  const readiness = asJsonObject(projection.readiness, "readiness");
  const visibility = asJsonObject(projection.visibilityHints, "visibilityHints");
  const outline = asJsonObject(projection.outline, "outline");
  const outlineItems = objectArray(outline.items);
  const workspaceScope = asJsonObject(projection.workspaceScope, "workspaceScope");
  const selectedVersions = asJsonObject(projection.selectedVersions, "selectedVersions");
  const projectionState = asJsonObject(projection.projectionState, "projectionState");

  const nodeIds = ids(nodes, "nodeId");
  const edgeIds = ids(edges, "edgeId");
  const positionIds = ids(positions, "nodeId");
  const ruleIds = ids(rules, "ruleId");
  const outlineIds = ids(outlineItems, "outlineItemId");
  const nodeById = new Map(nodes.map((node) => [asString(node.nodeId)!, node]));
  const edgeById = new Map(edges.map((edge) => [asString(edge.edgeId)!, edge]));
  const ruleById = new Map(rules.map((rule) => [asString(rule.ruleId)!, rule]));
  const outlineById = new Map(outlineItems.map((item) => [asString(item.outlineItemId)!, item]));

  if (hasDuplicates(nodeIds)) {
    addViolation(violations, "NODE_ID_DUPLICATE", "/nodes", "Node IDs must be unique.");
  }
  if (hasDuplicates(edgeIds)) {
    addViolation(violations, "EDGE_ID_DUPLICATE", "/edges", "Edge IDs must be unique.");
  }
  if (hasDuplicates(ruleIds)) {
    addViolation(
      violations,
      "RULE_ID_DUPLICATE",
      "/requirements/rules",
      "Requirement rule IDs must be unique.",
    );
  }
  if (hasDuplicates(outlineIds)) {
    addViolation(
      violations,
      "OUTLINE_ITEM_ID_DUPLICATE",
      "/outline/items",
      "Outline item IDs must be unique.",
    );
  }

  const orderedCollections: Array<[string, string[], string]> = [
    ["NODES_NOT_SORTED", nodeIds, "/nodes"],
    ["EDGES_NOT_SORTED", edgeIds, "/edges"],
    ["LAYOUT_POSITIONS_NOT_SORTED", positionIds, "/layout/positions"],
    ["REQUIREMENT_RULES_NOT_SORTED", ruleIds, "/requirements/rules"],
    ["OUTLINE_ITEMS_NOT_SORTED", outlineIds, "/outline/items"],
  ];
  for (const [code, values, path] of orderedCollections) {
    if (!isSorted(values)) {
      addViolation(violations, code, path, "Stable identifiers must be ASCII-sorted.");
    }
  }

  for (const [index, rule] of rules.entries()) {
    const memberIds = requirementMembers(rule).flatMap((member) => {
      const id = memberId(member);
      return id === undefined ? [] : [id];
    });
    if (!isSorted(memberIds)) {
      addViolation(
        violations,
        "REQUIREMENT_MEMBERS_NOT_SORTED",
        `/requirements/rules/${index}`,
        "Requirement members must be sorted by referenced stable ID.",
      );
    }
  }

  for (const [index, edge] of edges.entries()) {
    const sourceId = asString(edge.sourceNodeId)!;
    const targetId = asString(edge.targetNodeId)!;
    const source = nodeById.get(sourceId);
    const target = nodeById.get(targetId);
    if (source === undefined) {
      addViolation(
        violations,
        "EDGE_SOURCE_MISSING",
        `/edges/${index}/sourceNodeId`,
        "Edge source does not resolve in this projection.",
      );
    }
    if (target === undefined) {
      addViolation(
        violations,
        "EDGE_TARGET_MISSING",
        `/edges/${index}/targetNodeId`,
        "Edge target does not resolve in this projection.",
      );
    }
    const edgeType = asString(edge.edgeType);
    if (
      source !== undefined &&
      target !== undefined &&
      edgeType === "PREREQUISITE_OF" &&
      (asString(source?.nodeType) !== "COMPETENCY" || asString(target?.nodeType) !== "COMPETENCY")
    ) {
      addViolation(
        violations,
        "PREREQUISITE_ENDPOINT_TYPE",
        `/edges/${index}`,
        "Prerequisite edges must connect two competencies.",
      );
    }
    if (
      source !== undefined &&
      target !== undefined &&
      edgeType === "ACTIVITY_EVIDENCES" &&
      (asString(source?.nodeType) !== "ACTIVITY" || asString(target?.nodeType) !== "COMPETENCY")
    ) {
      addViolation(
        violations,
        "ACTIVITY_EVIDENCE_ENDPOINT_TYPE",
        `/edges/${index}`,
        "Activity evidence edges must connect an activity to a competency.",
      );
    }
    const origin = asJsonObject(edge.origin, "edge origin");
    if (
      asString(origin.kind) === "CANONICAL" &&
      (asString(asJsonObject(source?.origin ?? {}, "source origin").kind) === "WORKSPACE_OVERLAY" ||
        asString(asJsonObject(target?.origin ?? {}, "target origin").kind) === "WORKSPACE_OVERLAY")
    ) {
      addViolation(
        violations,
        "CANONICAL_EDGE_OVERLAY_ENDPOINT",
        `/edges/${index}/origin`,
        "A canonical edge cannot reference workspace-overlay content.",
      );
    }
  }

  const prerequisiteAdjacency = new Map<string, string[]>();
  for (const edge of edges.filter((item) => asString(item.edgeType) === "PREREQUISITE_OF")) {
    const source = asString(edge.sourceNodeId)!;
    const target = asString(edge.targetNodeId)!;
    prerequisiteAdjacency.set(source, [...(prerequisiteAdjacency.get(source) ?? []), target]);
    if (!prerequisiteAdjacency.has(target)) prerequisiteAdjacency.set(target, []);
  }
  if (graphHasCycle(prerequisiteAdjacency)) {
    addViolation(
      violations,
      "PREREQUISITE_CYCLE",
      "/edges",
      "The prerequisite subgraph must be acyclic.",
    );
  }

  const requirementAdjacency = new Map<string, string[]>();
  for (const [index, rule] of rules.entries()) {
    const currentRuleId = asString(rule.ruleId)!;
    const ruleTargets: string[] = [];
    for (const member of requirementMembers(rule)) {
      const memberType = asString(member.memberType);
      const referencedId = memberId(member);
      if (memberType === "RULE" && referencedId !== undefined) {
        ruleTargets.push(referencedId);
        if (!ruleById.has(referencedId)) {
          addViolation(
            violations,
            "REQUIREMENT_RULE_MISSING",
            `/requirements/rules/${index}`,
            "A referenced requirement rule does not exist.",
          );
        }
      }
      if (memberType === "NODE" && referencedId !== undefined) {
        const node = nodeById.get(referencedId);
        if (node === undefined) {
          addViolation(
            violations,
            "RULE_NODE_MISSING",
            `/requirements/rules/${index}`,
            "A requirement node does not exist.",
          );
        } else if (!["COMPETENCY", "DOMAIN"].includes(asString(node.nodeType)!)) {
          addViolation(
            violations,
            "RULE_NODE_TYPE_INVALID",
            `/requirements/rules/${index}`,
            "A NODE requirement may reference only a competency or domain.",
          );
        }
      }
    }
    requirementAdjacency.set(currentRuleId, ruleTargets);
    if (
      asString(rule.ruleType) === "K_OF_N" &&
      (asNumber(rule.requiredCount) ?? 0) > requirementMembers(rule).length
    ) {
      addViolation(
        violations,
        "K_OF_N_REQUIRED_COUNT_EXCEEDS_MEMBERS",
        `/requirements/rules/${index}/requiredCount`,
        "K_OF_N requiredCount cannot exceed its member count.",
      );
    }
  }
  if (graphHasCycle(requirementAdjacency)) {
    addViolation(
      violations,
      "REQUIREMENT_RULE_CYCLE",
      "/requirements/rules",
      "The requirement-rule graph must be acyclic.",
    );
  }
  const rootRuleId = asString(requirements.rootRuleId);
  if (rules.length > 0 && rootRuleId !== undefined) {
    const reachable = new Set<string>();
    const visit = (ruleId: string): void => {
      if (reachable.has(ruleId)) return;
      reachable.add(ruleId);
      for (const next of requirementAdjacency.get(ruleId) ?? []) visit(next);
    };
    visit(rootRuleId);
    if (rules.some((rule) => !reachable.has(asString(rule.ruleId)!))) {
      addViolation(
        violations,
        "REQUIREMENT_RULE_UNREACHABLE",
        "/requirements/rules",
        "Every requirement rule must be reachable from rootRuleId.",
      );
    }
  }

  if (
    positionIds.length !== nodeIds.length ||
    hasDuplicates(positionIds) ||
    positionIds.some((id) => !nodeById.has(id)) ||
    nodeIds.some((id) => !positionIds.includes(id))
  ) {
    addViolation(
      violations,
      "LAYOUT_NODE_POSITION_BIJECTION",
      "/layout/positions",
      "Layout positions must cover every node exactly once.",
    );
  }

  const workspaceId = asString(workspaceScope.workspaceId);
  const overlayRevision = asString(workspaceScope.overlayRevision);
  for (const [index, node] of nodes.entries()) {
    const origin = asJsonObject(node.origin, "node origin");
    if (
      asString(origin.kind) === "WORKSPACE_OVERLAY" &&
      (asString(origin.workspaceId) !== workspaceId ||
        asString(origin.overlayRevision) !== overlayRevision)
    ) {
      addViolation(
        violations,
        "FOREIGN_OVERLAY_ORIGIN",
        `/nodes/${index}/origin`,
        "Workspace overlay content must match projection workspace scope.",
      );
    }
  }
  for (const [index, edge] of edges.entries()) {
    const origin = asJsonObject(edge.origin, "edge origin");
    if (
      asString(origin.kind) === "WORKSPACE_OVERLAY" &&
      (asString(origin.workspaceId) !== workspaceId ||
        asString(origin.overlayRevision) !== overlayRevision)
    ) {
      addViolation(
        violations,
        "FOREIGN_OVERLAY_ORIGIN",
        `/edges/${index}/origin`,
        "Workspace overlay edge must match projection workspace scope.",
      );
    }
  }
  for (const [index, position] of positions.entries()) {
    if (
      asString(position.source) === "WORKSPACE_OVERRIDE" &&
      (asString(position.overrideWorkspaceId) !== workspaceId ||
        asString(position.overrideRevision) !== overlayRevision)
    ) {
      addViolation(
        violations,
        "FOREIGN_POSITION_OVERRIDE",
        `/layout/positions/${index}`,
        "A position override must match projection workspace scope.",
      );
    }
  }

  const outlineNodeIds = ids(outlineItems, "nodeId");
  const outlineMatchesNodes =
    outlineNodeIds.length === nodeIds.length &&
    !hasDuplicates(outlineNodeIds) &&
    nodeIds.every((id) => outlineNodeIds.includes(id));
  const backReferencesAgree = nodes.every((node) => {
    const accessibility = asJsonObject(node.accessibility, "accessibility");
    const item = outlineById.get(asString(accessibility.outlineItemId)!);
    return item !== undefined && asString(item.nodeId) === asString(node.nodeId);
  });
  if (!outlineMatchesNodes || !backReferencesAgree) {
    addViolation(
      violations,
      "OUTLINE_NODE_BIJECTION",
      "/outline/items",
      "Outline must contain exactly one item for every projection node.",
    );
  }
  const outlineAdjacency = new Map<string, string[]>();
  for (const item of outlineItems) {
    outlineAdjacency.set(
      asString(item.outlineItemId)!,
      asArray(item.childItemIds).flatMap((child) => (typeof child === "string" ? [child] : [])),
    );
  }
  if (graphHasCycle(outlineAdjacency)) {
    addViolation(
      violations,
      "OUTLINE_CYCLE",
      "/outline/items",
      "Outline hierarchy must be acyclic.",
    );
  }

  const readinessEstimate = asJsonObject(readiness.estimate, "readiness estimate");
  if ((asNumber(readinessEstimate.lower) ?? 0) > (asNumber(readinessEstimate.upper) ?? 0)) {
    addViolation(
      violations,
      "READINESS_INTERVAL_REVERSED",
      "/readiness/estimate",
      "Readiness lower bound cannot exceed upper bound.",
    );
  }
  if (
    readiness.targetProfileVersionId !== selectedVersions.targetProfileVersionId ||
    readiness.targetProfileVersionId !== requirements.targetProfileVersionId
  ) {
    addViolation(
      violations,
      "READINESS_TARGET_PROFILE_VERSION_MISMATCH",
      "/readiness/targetProfileVersionId",
      "Selected, requirement, and readiness target-profile versions must agree.",
    );
  }
  if (readiness.inputWatermark !== projectionState.inputWatermark) {
    addViolation(
      violations,
      "READINESS_INPUT_WATERMARK_MISMATCH",
      "/readiness/inputWatermark",
      "Current readiness must use the projection input watermark.",
    );
  }
  if (readiness.policyVersion !== selectedVersions.readinessPolicyVersion) {
    addViolation(
      violations,
      "READINESS_POLICY_VERSION_MISMATCH",
      "/readiness/policyVersion",
      "Readiness policy version must match the selected version.",
    );
  }
  for (const [index, node] of nodes.entries()) {
    if (asString(node.nodeType) === "ACTIVITY") continue;
    const state = asJsonObject(node.state, "semantic state");
    if (state.policyVersion !== selectedVersions.masteryPolicyVersion) {
      addViolation(
        violations,
        "MASTERY_POLICY_VERSION_MISMATCH",
        `/nodes/${index}/state/policyVersion`,
        "Semantic node policy must match the selected mastery policy.",
      );
    }
  }

  const unknownIds = asArray(readiness.unknownNodeIds).flatMap((item) =>
    typeof item === "string" ? [item] : [],
  );
  const staleIds = asArray(readiness.staleNodeIds).flatMap((item) =>
    typeof item === "string" ? [item] : [],
  );
  for (const id of unknownIds) {
    const node = nodeById.get(id);
    const state = node === undefined ? undefined : asJsonObject(node.state, "state");
    const estimate = state === undefined ? undefined : asJsonObject(state.estimate, "estimate");
    if (estimate === undefined || asString(estimate.availability) !== "UNKNOWN") {
      addViolation(
        violations,
        "READINESS_UNKNOWN_NODE_INCONSISTENT",
        "/readiness/unknownNodeIds",
        "Unknown readiness references must resolve to UNKNOWN semantic estimates.",
      );
    }
  }
  for (const id of staleIds) {
    const node = nodeById.get(id);
    const state = node === undefined ? undefined : asJsonObject(node.state, "state");
    const estimate = state === undefined ? undefined : asJsonObject(state.estimate, "estimate");
    if (estimate === undefined || asString(estimate.condition) !== "STALE") {
      addViolation(
        violations,
        "READINESS_STALE_NODE_INCONSISTENT",
        "/readiness/staleNodeIds",
        "Stale readiness references must resolve to STALE semantic estimates.",
      );
    }
  }

  const defaultVisibleNodeIds = asArray(visibility.defaultVisibleNodeIds).flatMap((item) =>
    typeof item === "string" ? [item] : [],
  );
  const defaultVisibleEdgeIds = asArray(visibility.defaultVisibleEdgeIds).flatMap((item) =>
    typeof item === "string" ? [item] : [],
  );
  if (!isSorted(defaultVisibleNodeIds)) {
    addViolation(
      violations,
      "DEFAULT_VISIBLE_NODE_IDS_NOT_SORTED",
      "/visibilityHints/defaultVisibleNodeIds",
      "Default-visible node IDs must be sorted.",
    );
  }
  if (!isSorted(defaultVisibleEdgeIds)) {
    addViolation(
      violations,
      "DEFAULT_VISIBLE_EDGE_IDS_NOT_SORTED",
      "/visibilityHints/defaultVisibleEdgeIds",
      "Default-visible edge IDs must be sorted.",
    );
  }
  if (visibility.totalNodeCount !== nodes.length) {
    addViolation(
      violations,
      "VISIBILITY_NODE_COUNT_MISMATCH",
      "/visibilityHints/totalNodeCount",
      "Visibility node count must equal the complete node array.",
    );
  }
  if (visibility.totalEdgeCount !== edges.length) {
    addViolation(
      violations,
      "VISIBILITY_EDGE_COUNT_MISMATCH",
      "/visibilityHints/totalEdgeCount",
      "Visibility edge count must equal the complete edge array.",
    );
  }
  const flaggedNodeIds = nodes
    .filter((node) => asJsonObject(node.visibilityHint, "hint").defaultVisible === true)
    .map((node) => asString(node.nodeId)!);
  const flaggedEdgeIds = edges
    .filter((edge) => asJsonObject(edge.visibilityHint, "hint").defaultVisible === true)
    .map((edge) => asString(edge.edgeId)!);
  if (
    flaggedNodeIds.length !== defaultVisibleNodeIds.length ||
    flaggedNodeIds.some((id) => !defaultVisibleNodeIds.includes(id))
  ) {
    addViolation(
      violations,
      "DEFAULT_VISIBLE_NODE_FLAGS_MISMATCH",
      "/visibilityHints/defaultVisibleNodeIds",
      "Node flags and default-visible node IDs must agree exactly.",
    );
  }
  if (
    flaggedEdgeIds.length !== defaultVisibleEdgeIds.length ||
    flaggedEdgeIds.some((id) => !defaultVisibleEdgeIds.includes(id))
  ) {
    addViolation(
      violations,
      "DEFAULT_VISIBLE_EDGE_FLAGS_MISMATCH",
      "/visibilityHints/defaultVisibleEdgeIds",
      "Edge flags and default-visible edge IDs must agree exactly.",
    );
  }
  if (
    defaultVisibleEdgeIds.some((id) => {
      const edge = edgeById.get(id);
      if (edge === undefined) return false;
      const sourceId = asString(edge.sourceNodeId)!;
      const targetId = asString(edge.targetNodeId)!;
      if (!nodeById.has(sourceId) || !nodeById.has(targetId)) return false;
      return !defaultVisibleNodeIds.includes(sourceId) || !defaultVisibleNodeIds.includes(targetId);
    })
  ) {
    addViolation(
      violations,
      "DEFAULT_VISIBLE_EDGE_ENDPOINT_HIDDEN",
      "/visibilityHints/defaultVisibleEdgeIds",
      "Every visible edge must have two visible endpoints.",
    );
  }

  if (asString(outline.projectionId) !== asString(projection.projectionId)) {
    addViolation(
      violations,
      "OUTLINE_PROJECTION_MISMATCH",
      "/outline/projectionId",
      "Outline projection ID must match the graph projection ID.",
    );
  }
  if (asString(layout.structuralFingerprint) !== computeGraphStructuralFingerprint(value)) {
    addViolation(
      violations,
      "STRUCTURAL_FINGERPRINT_MISMATCH",
      "/layout/structuralFingerprint",
      "Structural fingerprint does not match the topology and layout recipe.",
    );
  }

  return validationResult(violations);
}

export function validateGraphProjection(value: unknown): ValidationResult {
  const structural = validateSchema("graph-projection", value);
  return structural.valid ? validateGraphProjectionSemantics(value) : structural;
}
