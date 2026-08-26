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

export type ExploreStructuralNodeType = "ACTIVITY" | "COMPETENCY" | "DOMAIN";
export type ExploreStructuralEdgeType =
  "ACTIVITY_EVIDENCES" | "PART_OF" | "PREREQUISITE_OF" | "RELATED_TO" | "USER_ADDED";
export type ExploreStructuralRequirementRuleType =
  "ALL" | "ANY" | "K_OF_N" | "MANDATORY_FLOOR" | "WEIGHTED_THRESHOLD";
export type ExploreStructuralRequirementCriticality = "DIFFERENTIATING" | "MANDATORY" | "PREFERRED";
export type ExploreStructuralRequirementDimension =
  "APPLICATION" | "INTERVIEW_EXECUTION" | "KNOWLEDGE" | "RECALL";
export type ExploreStructuralRequirementLevel = "COMPLETED" | "MASTERED" | "VERIFIED";

export type ExploreStructuralOriginV1 =
  | {
      readonly kind: "CANONICAL";
      readonly sourceVersionId: string;
    }
  | {
      readonly kind: "WORKSPACE_OVERLAY";
      readonly workspaceId: string;
      readonly overlayRevision: string;
      readonly acceptance: "ACCEPTED";
    };

export interface ExploreStructuralEntityRefV1 {
  readonly entityType: ExploreStructuralNodeType;
  readonly entityId: string;
  readonly entityVersionId: string | null;
}

export type ExploreStructuralRequirementStateV1 =
  | { readonly kind: "NOT_REQUIRED" }
  | {
      readonly kind: "REQUIRED_UNEVALUATED";
      readonly ruleIds: readonly string[];
    };

export interface ExploreStructuralNodeV1 {
  readonly nodeId: string;
  readonly nodeType: ExploreStructuralNodeType;
  readonly entityRef: ExploreStructuralEntityRefV1;
  readonly origin: ExploreStructuralOriginV1;
  readonly domainNodeId: string | null;
  readonly title: string;
  readonly shortLabel: string;
  readonly requirementState: ExploreStructuralRequirementStateV1;
  readonly visibilityHint: {
    readonly defaultVisible: boolean;
    readonly availableAtDetailLevels: readonly ("DOMAIN" | "COMPETENCY" | "SELECTED_ACTIVITY")[];
    readonly reasonCodes: readonly (
      "PERSONAL_OVERLAY" | "REQUIRED_BY_TARGET" | "SELECTED_CONTEXT" | "STRUCTURAL_CONTEXT"
    )[];
  };
  readonly accessibility: {
    readonly label: string;
    readonly description: string;
    readonly statusText: string;
    readonly keyboardOrder: number;
    readonly outlineItemId: string;
  };
  readonly inspectorRef: string;
}

export interface ExploreStructuralEdgeV1 {
  readonly edgeId: string;
  readonly edgeType: ExploreStructuralEdgeType;
  readonly sourceNodeId: string;
  readonly targetNodeId: string;
  readonly origin: ExploreStructuralOriginV1;
  readonly blocking: boolean;
  readonly rationale: string;
  readonly accessibilityLabel: string;
  readonly visibilityHint: {
    readonly defaultVisible: boolean;
    readonly reasonCode:
      "ACTIVE_PREREQUISITE" | "NAVIGATION_ONLY" | "PERSONAL_CONTEXT" | "SEMANTIC_CONTEXT";
  };
}

export interface ExploreStructuralNodeRequirementMemberV1 {
  readonly memberType: "NODE";
  readonly nodeId: string;
  readonly dimension: ExploreStructuralRequirementDimension;
  readonly requiredLevel: ExploreStructuralRequirementLevel;
}

export interface ExploreStructuralRuleRequirementMemberV1 {
  readonly memberType: "RULE";
  readonly ruleId: string;
}

export type ExploreStructuralRequirementMemberV1 =
  ExploreStructuralNodeRequirementMemberV1 | ExploreStructuralRuleRequirementMemberV1;

interface ExploreStructuralRequirementRuleBaseV1 {
  readonly ruleId: string;
  readonly title: string;
  readonly criticality: ExploreStructuralRequirementCriticality;
  readonly explanation: string;
  readonly accessibilityLabel: string;
}

export type ExploreStructuralRequirementRuleV1 =
  | (ExploreStructuralRequirementRuleBaseV1 & {
      readonly ruleType: "ALL" | "ANY";
      readonly members: readonly ExploreStructuralRequirementMemberV1[];
    })
  | (ExploreStructuralRequirementRuleBaseV1 & {
      readonly ruleType: "K_OF_N";
      readonly requiredCount: number;
      readonly members: readonly ExploreStructuralRequirementMemberV1[];
    })
  | (ExploreStructuralRequirementRuleBaseV1 & {
      readonly ruleType: "WEIGHTED_THRESHOLD";
      readonly threshold: number;
      readonly members: readonly {
        readonly member: ExploreStructuralRequirementMemberV1;
        readonly weight: number;
      }[];
    })
  | (ExploreStructuralRequirementRuleBaseV1 & {
      readonly ruleType: "MANDATORY_FLOOR";
      readonly criticality: "MANDATORY";
      readonly member: ExploreStructuralNodeRequirementMemberV1;
    });

export interface ExploreStructuralLayoutPositionV1 {
  readonly nodeId: string;
  readonly canonical: { readonly x: number; readonly y: number };
  readonly effective: { readonly x: number; readonly y: number };
  readonly source: "CANONICAL_LAYOUT" | "WORKSPACE_OVERRIDE";
  readonly overrideRevision: string | null;
  readonly overrideWorkspaceId?: string;
}

export interface ExploreStructuralLayoutV1 {
  readonly layoutVersion: string;
  readonly algorithmVersion: string;
  readonly structuralFingerprint: string;
  readonly coordinateSystem: "TOP_LEFT";
  readonly fixedNodeSize: { readonly width: number; readonly height: number };
  readonly spacing: { readonly rank: number; readonly node: number };
  readonly positions: readonly ExploreStructuralLayoutPositionV1[];
}

export interface ExploreStructuralOutlineItemV1 {
  readonly outlineItemId: string;
  readonly nodeId: string;
  readonly parentItemId: string | null;
  readonly depth: number;
  readonly sortKey: string;
  readonly childItemIds: readonly string[];
  readonly accessibilityLabel: string;
}

export interface ExploreStructuralProjectionV1 {
  readonly contract: {
    readonly name: "ExploreStructuralProjectionV1";
    readonly version: "1.0.0";
  };
  readonly projectionId: string;
  readonly workspaceScope: {
    readonly workspaceId: string;
    readonly overlayRevision: string;
    readonly acceptedPersonalContentOnly: true;
  };
  readonly selectedVersions: {
    readonly catalogVersionKey: string;
    readonly roadmapVersionKey: string | null;
    readonly targetProfileVersionKey: string;
  };
  readonly calculationAvailability: "NOT_MATERIALIZED";
  readonly layout: ExploreStructuralLayoutV1;
  readonly nodes: readonly ExploreStructuralNodeV1[];
  readonly edges: readonly ExploreStructuralEdgeV1[];
  readonly requirements: {
    readonly targetProfileVersionKey: string;
    readonly rootRuleId: string;
    readonly rules: readonly ExploreStructuralRequirementRuleV1[];
  };
  readonly visibilityHints: {
    readonly completeTargetGraph: true;
    readonly defaultVisibleNodeIds: readonly string[];
    readonly defaultVisibleEdgeIds: readonly string[];
    readonly totalNodeCount: number;
    readonly totalEdgeCount: number;
    readonly maximumRenderedNodes: 150;
    readonly maximumRenderedEdges: 300;
  };
  readonly outline: {
    readonly projectionId: string;
    readonly rootItemIds: readonly string[];
    readonly items: readonly ExploreStructuralOutlineItemV1[];
  };
}

function objectArray(value: JsonValue | undefined): JsonObject[] {
  return asArray(value).filter(isJsonObject);
}

function ids(items: readonly JsonObject[], field: string): string[] {
  return items.flatMap((item) => {
    const value = asString(item[field]);
    return value === undefined ? [] : [value];
  });
}

function addViolation(
  violations: ContractViolation[],
  code: string,
  path: string,
  message: string,
): void {
  if (!violations.some((item) => item.code === code)) violations.push({ code, path, message });
}

function sameValues(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(asciiCompare);
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

function requirementMembers(rule: JsonObject): JsonObject[] {
  if (isJsonObject(rule.member)) return [rule.member];
  return objectArray(rule.members).map((item) => (isJsonObject(item.member) ? item.member : item));
}

function memberId(member: JsonObject): string {
  return asString(member.nodeId) ?? asString(member.ruleId) ?? "";
}

function pointEquals(left: JsonObject, right: JsonObject): boolean {
  return asNumber(left.x) === asNumber(right.x) && asNumber(left.y) === asNumber(right.y);
}

export function computeExploreStructuralFingerprint(value: unknown): string {
  const projection = asJsonObject(value, "ExploreStructuralProjectionV1");
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
      "ExploreStructuralProjectionV1Structure",
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

export function validateExploreStructuralProjectionSemantics(value: unknown): ValidationResult {
  const projection = asJsonObject(value, "ExploreStructuralProjectionV1");
  const violations: ContractViolation[] = [];
  const workspaceScope = asJsonObject(projection.workspaceScope, "workspaceScope");
  const selectedVersions = asJsonObject(projection.selectedVersions, "selectedVersions");
  const layout = asJsonObject(projection.layout, "layout");
  const nodes = objectArray(projection.nodes);
  const edges = objectArray(projection.edges);
  const positions = objectArray(layout.positions);
  const requirements = asJsonObject(projection.requirements, "requirements");
  const rules = objectArray(requirements.rules);
  const visibility = asJsonObject(projection.visibilityHints, "visibilityHints");
  const outline = asJsonObject(projection.outline, "outline");
  const outlineItems = objectArray(outline.items);

  const nodeIds = ids(nodes, "nodeId");
  const edgeIds = ids(edges, "edgeId");
  const positionIds = ids(positions, "nodeId");
  const ruleIds = ids(rules, "ruleId");
  const outlineIds = ids(outlineItems, "outlineItemId");
  const nodeById = new Map(nodes.map((node) => [asString(node.nodeId)!, node]));
  const edgeById = new Map(edges.map((edge) => [asString(edge.edgeId)!, edge]));
  const ruleById = new Map(rules.map((rule) => [asString(rule.ruleId)!, rule]));
  const outlineById = new Map(outlineItems.map((item) => [asString(item.outlineItemId)!, item]));

  const uniqueCollections: Array<[string, string[], string]> = [
    ["STRUCTURAL_NODE_ID_DUPLICATE", nodeIds, "/nodes"],
    ["STRUCTURAL_EDGE_ID_DUPLICATE", edgeIds, "/edges"],
    ["STRUCTURAL_RULE_ID_DUPLICATE", ruleIds, "/requirements/rules"],
    ["STRUCTURAL_OUTLINE_ID_DUPLICATE", outlineIds, "/outline/items"],
  ];
  for (const [code, values, path] of uniqueCollections) {
    if (hasDuplicates(values)) addViolation(violations, code, path, "Stable IDs must be unique.");
  }
  const sortedCollections: Array<[string, string[], string]> = [
    ["STRUCTURAL_NODES_NOT_SORTED", nodeIds, "/nodes"],
    ["STRUCTURAL_EDGES_NOT_SORTED", edgeIds, "/edges"],
    ["STRUCTURAL_LAYOUT_NOT_SORTED", positionIds, "/layout/positions"],
    ["STRUCTURAL_RULES_NOT_SORTED", ruleIds, "/requirements/rules"],
    ["STRUCTURAL_OUTLINE_NOT_SORTED", outlineIds, "/outline/items"],
  ];
  for (const [code, values, path] of sortedCollections) {
    if (!isSorted(values)) addViolation(violations, code, path, "Stable IDs must be ASCII-sorted.");
  }

  const workspaceId = asString(workspaceScope.workspaceId)!;
  const overlayRevision = asString(workspaceScope.overlayRevision)!;
  const catalogVersionKey = asString(selectedVersions.catalogVersionKey)!;
  for (const [index, node] of nodes.entries()) {
    const nodeId = asString(node.nodeId)!;
    const nodeType = asString(node.nodeType)!;
    const entityRef = asJsonObject(node.entityRef, "entityRef");
    const entityId = asString(entityRef.entityId)!;
    const origin = asJsonObject(node.origin, "origin");
    const domainNodeId = asString(node.domainNodeId);
    if (nodeId !== `node:${entityId}` || asString(entityRef.entityType) !== nodeType) {
      addViolation(
        violations,
        "STRUCTURAL_NODE_ENTITY_MISMATCH",
        `/nodes/${index}/entityRef`,
        "Node identity and entity reference must agree.",
      );
    }
    if (nodeType === "DOMAIN" && node.domainNodeId !== null) {
      addViolation(
        violations,
        "STRUCTURAL_DOMAIN_PARENT_PRESENT",
        `/nodes/${index}/domainNodeId`,
        "A domain node cannot have a domain parent.",
      );
    }
    if (nodeType === "COMPETENCY") {
      const domain = domainNodeId === undefined ? undefined : nodeById.get(domainNodeId);
      if (domain === undefined || asString(domain.nodeType) !== "DOMAIN") {
        addViolation(
          violations,
          "STRUCTURAL_COMPETENCY_DOMAIN_MISSING",
          `/nodes/${index}/domainNodeId`,
          "A competency domain must resolve to a projected domain node.",
        );
      }
    }
    if (
      asString(origin.kind) === "WORKSPACE_OVERLAY" &&
      (asString(origin.workspaceId) !== workspaceId ||
        asString(origin.overlayRevision) !== overlayRevision)
    ) {
      addViolation(
        violations,
        "STRUCTURAL_FOREIGN_OVERLAY_ORIGIN",
        `/nodes/${index}/origin`,
        "Overlay node origin must match workspace scope.",
      );
    }
    if (
      asString(origin.kind) === "CANONICAL" &&
      (asString(origin.sourceVersionId) !== catalogVersionKey ||
        asString(entityRef.entityVersionId) !== catalogVersionKey)
    ) {
      addViolation(
        violations,
        "STRUCTURAL_CATALOG_VERSION_MISMATCH",
        `/nodes/${index}/origin`,
        "Canonical node origin and entity version must match the selected Catalog version.",
      );
    }
    if (asString(origin.kind) === "WORKSPACE_OVERLAY" && entityRef.entityVersionId !== null) {
      addViolation(
        violations,
        "STRUCTURAL_OVERLAY_ENTITY_VERSION_PRESENT",
        `/nodes/${index}/entityRef/entityVersionId`,
        "Workspace-overlay nodes cannot claim a canonical entity version.",
      );
    }
  }

  const prerequisiteAdjacency = new Map<string, string[]>();
  for (const [index, edge] of edges.entries()) {
    const sourceId = asString(edge.sourceNodeId)!;
    const targetId = asString(edge.targetNodeId)!;
    const source = nodeById.get(sourceId);
    const target = nodeById.get(targetId);
    const edgeType = asString(edge.edgeType)!;
    const origin = asJsonObject(edge.origin, "origin");
    if (source === undefined || target === undefined) {
      addViolation(
        violations,
        "STRUCTURAL_EDGE_ENDPOINT_MISSING",
        `/edges/${index}`,
        "Every edge endpoint must resolve in the same projection.",
      );
      continue;
    }
    if (
      edgeType === "PREREQUISITE_OF" &&
      (asString(source.nodeType) !== "COMPETENCY" || asString(target.nodeType) !== "COMPETENCY")
    ) {
      addViolation(
        violations,
        "STRUCTURAL_PREREQUISITE_ENDPOINT_TYPE",
        `/edges/${index}`,
        "Prerequisite edges must connect competencies.",
      );
    }
    if (
      edgeType === "ACTIVITY_EVIDENCES" &&
      (asString(source.nodeType) !== "ACTIVITY" || asString(target.nodeType) !== "COMPETENCY")
    ) {
      addViolation(
        violations,
        "STRUCTURAL_ACTIVITY_EVIDENCE_ENDPOINT_TYPE",
        `/edges/${index}`,
        "Activity-evidence edges must connect an activity to a competency.",
      );
    }
    const sourceOrigin = asJsonObject(source.origin, "source origin");
    const targetOrigin = asJsonObject(target.origin, "target origin");
    const hasOverlayEndpoint =
      asString(sourceOrigin.kind) === "WORKSPACE_OVERLAY" ||
      asString(targetOrigin.kind) === "WORKSPACE_OVERLAY";
    if (hasOverlayEndpoint && asString(origin.kind) !== "WORKSPACE_OVERLAY") {
      addViolation(
        violations,
        "STRUCTURAL_EDGE_OVERLAY_SCOPE",
        `/edges/${index}/origin`,
        "An edge involving overlay content must be overlay-owned.",
      );
    }
    if (
      asString(origin.kind) === "WORKSPACE_OVERLAY" &&
      (asString(origin.workspaceId) !== workspaceId ||
        asString(origin.overlayRevision) !== overlayRevision)
    ) {
      addViolation(
        violations,
        "STRUCTURAL_FOREIGN_OVERLAY_ORIGIN",
        `/edges/${index}/origin`,
        "Overlay edge origin must match workspace scope.",
      );
    }
    if (
      asString(origin.kind) === "CANONICAL" &&
      asString(origin.sourceVersionId) !== catalogVersionKey
    ) {
      addViolation(
        violations,
        "STRUCTURAL_CATALOG_VERSION_MISMATCH",
        `/edges/${index}/origin`,
        "Canonical edge origin must match the selected Catalog version.",
      );
    }
    if (edgeType === "PREREQUISITE_OF") {
      prerequisiteAdjacency.set(sourceId, [
        ...(prerequisiteAdjacency.get(sourceId) ?? []),
        targetId,
      ]);
      if (!prerequisiteAdjacency.has(targetId)) prerequisiteAdjacency.set(targetId, []);
    }
  }
  if (graphHasCycle(prerequisiteAdjacency)) {
    addViolation(
      violations,
      "STRUCTURAL_PREREQUISITE_CYCLE",
      "/edges",
      "The prerequisite subgraph must be acyclic.",
    );
  }

  const ruleAdjacency = new Map<string, string[]>();
  const requiredRuleIdsByNode = new Map<string, string[]>();
  for (const [index, rule] of rules.entries()) {
    const ruleId = asString(rule.ruleId)!;
    const members = requirementMembers(rule);
    const memberIds = members.map(memberId);
    if (!isSorted(memberIds)) {
      addViolation(
        violations,
        "STRUCTURAL_REQUIREMENT_MEMBERS_NOT_SORTED",
        `/requirements/rules/${index}`,
        "Requirement members must be sorted by referenced stable ID.",
      );
    }
    if (hasDuplicates(memberIds)) {
      addViolation(
        violations,
        "STRUCTURAL_REQUIREMENT_MEMBER_DUPLICATE",
        `/requirements/rules/${index}`,
        "Requirement members must be unique by referenced stable ID.",
      );
    }
    const referencedRules: string[] = [];
    for (const member of members) {
      const referencedId = memberId(member);
      if (asString(member.memberType) === "RULE") {
        referencedRules.push(referencedId);
        if (!ruleById.has(referencedId)) {
          addViolation(
            violations,
            "STRUCTURAL_REQUIREMENT_RULE_MISSING",
            `/requirements/rules/${index}`,
            "A referenced requirement rule is missing.",
          );
        }
      } else {
        const node = nodeById.get(referencedId);
        if (node === undefined) {
          addViolation(
            violations,
            "STRUCTURAL_REQUIREMENT_NODE_MISSING",
            `/requirements/rules/${index}`,
            "A referenced requirement node is missing.",
          );
        } else if (!["COMPETENCY", "DOMAIN"].includes(asString(node.nodeType)!)) {
          addViolation(
            violations,
            "STRUCTURAL_REQUIREMENT_NODE_TYPE",
            `/requirements/rules/${index}`,
            "Requirements may reference only competencies or domains.",
          );
        }
        requiredRuleIdsByNode.set(referencedId, [
          ...(requiredRuleIdsByNode.get(referencedId) ?? []),
          ruleId,
        ]);
      }
    }
    ruleAdjacency.set(ruleId, referencedRules);
    if (
      asString(rule.ruleType) === "K_OF_N" &&
      (asNumber(rule.requiredCount) ?? 0) > members.length
    ) {
      addViolation(
        violations,
        "STRUCTURAL_K_OF_N_EXCEEDS_MEMBERS",
        `/requirements/rules/${index}/requiredCount`,
        "K_OF_N requiredCount cannot exceed member count.",
      );
    }
  }
  if (graphHasCycle(ruleAdjacency)) {
    addViolation(
      violations,
      "STRUCTURAL_REQUIREMENT_CYCLE",
      "/requirements/rules",
      "The requirement-rule graph must be acyclic.",
    );
  }
  const rootRuleId = asString(requirements.rootRuleId)!;
  if (!ruleById.has(rootRuleId)) {
    addViolation(
      violations,
      "STRUCTURAL_ROOT_RULE_MISSING",
      "/requirements/rootRuleId",
      "The root requirement rule must resolve.",
    );
  } else {
    const reachable = new Set<string>();
    const visit = (id: string): void => {
      if (reachable.has(id)) return;
      reachable.add(id);
      for (const next of ruleAdjacency.get(id) ?? []) visit(next);
    };
    visit(rootRuleId);
    if (ruleIds.some((id) => !reachable.has(id))) {
      addViolation(
        violations,
        "STRUCTURAL_REQUIREMENT_UNREACHABLE",
        "/requirements/rules",
        "Every requirement rule must be reachable from the root.",
      );
    }
  }
  if (requirements.targetProfileVersionKey !== selectedVersions.targetProfileVersionKey) {
    addViolation(
      violations,
      "STRUCTURAL_TARGET_PROFILE_MISMATCH",
      "/requirements/targetProfileVersionKey",
      "Selected and requirement target-profile versions must agree.",
    );
  }
  for (const [index, node] of nodes.entries()) {
    const nodeId = asString(node.nodeId)!;
    const state = asJsonObject(node.requirementState, "requirementState");
    const expectedRuleIds = sortedUnique(requiredRuleIdsByNode.get(nodeId) ?? []);
    if (expectedRuleIds.length === 0 && asString(state.kind) !== "NOT_REQUIRED") {
      addViolation(
        violations,
        "STRUCTURAL_REQUIREMENT_STATE_MISMATCH",
        `/nodes/${index}/requirementState`,
        "Unreferenced nodes must be NOT_REQUIRED.",
      );
    }
    if (expectedRuleIds.length > 0) {
      const declared = asArray(state.ruleIds).flatMap((item) =>
        typeof item === "string" ? [item] : [],
      );
      if (
        asString(state.kind) !== "REQUIRED_UNEVALUATED" ||
        !isSorted(declared) ||
        !sameValues(declared, expectedRuleIds)
      ) {
        addViolation(
          violations,
          "STRUCTURAL_REQUIREMENT_STATE_MISMATCH",
          `/nodes/${index}/requirementState`,
          "Required nodes must expose exactly their sorted rule definitions as unevaluated.",
        );
      }
    }
  }

  if (
    positionIds.length !== nodeIds.length ||
    hasDuplicates(positionIds) ||
    !sameValues(sortedUnique(positionIds), sortedUnique(nodeIds))
  ) {
    addViolation(
      violations,
      "STRUCTURAL_LAYOUT_NODE_BIJECTION",
      "/layout/positions",
      "Layout positions must cover every node exactly once.",
    );
  }
  for (const [index, position] of positions.entries()) {
    const source = asString(position.source);
    const canonical = asJsonObject(position.canonical, "canonical point");
    const effective = asJsonObject(position.effective, "effective point");
    if (source === "CANONICAL_LAYOUT" && !pointEquals(canonical, effective)) {
      addViolation(
        violations,
        "STRUCTURAL_CANONICAL_POSITION_CHANGED",
        `/layout/positions/${index}`,
        "Canonical positions must use identical canonical and effective points.",
      );
    }
    if (
      source === "WORKSPACE_OVERRIDE" &&
      (asString(position.overrideWorkspaceId) !== workspaceId ||
        asString(position.overrideRevision) !== overlayRevision)
    ) {
      addViolation(
        violations,
        "STRUCTURAL_FOREIGN_POSITION_OVERRIDE",
        `/layout/positions/${index}`,
        "Position overrides must match workspace scope.",
      );
    }
  }

  const outlineNodeIds = ids(outlineItems, "nodeId");
  if (
    outlineNodeIds.length !== nodeIds.length ||
    hasDuplicates(outlineNodeIds) ||
    !sameValues(sortedUnique(outlineNodeIds), sortedUnique(nodeIds))
  ) {
    addViolation(
      violations,
      "STRUCTURAL_OUTLINE_NODE_BIJECTION",
      "/outline/items",
      "Outline must contain exactly one item for every node.",
    );
  }
  const declaredRootIds = asArray(outline.rootItemIds).flatMap((item) =>
    typeof item === "string" ? [item] : [],
  );
  if (!isSorted(declaredRootIds)) {
    addViolation(
      violations,
      "STRUCTURAL_OUTLINE_ROOTS_NOT_SORTED",
      "/outline/rootItemIds",
      "Outline roots must be ASCII-sorted.",
    );
  }
  const actualRootIds: string[] = [];
  const outlineAdjacency = new Map<string, string[]>();
  const keyboardOrders: number[] = [];
  for (const [index, item] of outlineItems.entries()) {
    const itemId = asString(item.outlineItemId)!;
    const nodeId = asString(item.nodeId)!;
    const parentId = asString(item.parentItemId);
    const children = asArray(item.childItemIds).flatMap((child) =>
      typeof child === "string" ? [child] : [],
    );
    outlineAdjacency.set(itemId, children);
    if (item.parentItemId === null) actualRootIds.push(itemId);
    if (!isSorted(children)) {
      addViolation(
        violations,
        "STRUCTURAL_OUTLINE_CHILDREN_NOT_SORTED",
        `/outline/items/${index}/childItemIds`,
        "Outline children must be ASCII-sorted.",
      );
    }
    const node = nodeById.get(nodeId);
    const accessibility =
      node === undefined ? undefined : asJsonObject(node.accessibility, "accessibility");
    if (
      node === undefined ||
      asString(accessibility?.outlineItemId) !== itemId ||
      asString(accessibility?.label) !== asString(item.accessibilityLabel)
    ) {
      addViolation(
        violations,
        "STRUCTURAL_OUTLINE_NODE_LINK_MISMATCH",
        `/outline/items/${index}`,
        "Outline and node accessibility links must agree.",
      );
    }
    if (accessibility !== undefined) keyboardOrders.push(asNumber(accessibility.keyboardOrder)!);
    if (parentId !== undefined) {
      const parent = outlineById.get(parentId);
      if (
        parent === undefined ||
        !asArray(parent.childItemIds).includes(itemId) ||
        asNumber(item.depth) !== (asNumber(parent.depth) ?? -1) + 1
      ) {
        addViolation(
          violations,
          "STRUCTURAL_OUTLINE_PARENT_LINK_MISMATCH",
          `/outline/items/${index}`,
          "Outline parent, child, and depth links must agree.",
        );
      }
    } else if (item.parentItemId !== null || asNumber(item.depth) !== 0) {
      addViolation(
        violations,
        "STRUCTURAL_OUTLINE_PARENT_LINK_MISMATCH",
        `/outline/items/${index}`,
        "Outline roots must have null parent and depth zero.",
      );
    }
    for (const childId of children) {
      if (asString(outlineById.get(childId)?.parentItemId) !== itemId) {
        addViolation(
          violations,
          "STRUCTURAL_OUTLINE_PARENT_LINK_MISMATCH",
          `/outline/items/${index}/childItemIds`,
          "Every child back-reference must identify its parent.",
        );
      }
    }
  }
  if (!sameValues(sortedUnique(actualRootIds), sortedUnique(declaredRootIds))) {
    addViolation(
      violations,
      "STRUCTURAL_OUTLINE_ROOT_MISMATCH",
      "/outline/rootItemIds",
      "Declared roots must equal items with null parents.",
    );
  }
  if (graphHasCycle(outlineAdjacency)) {
    addViolation(
      violations,
      "STRUCTURAL_OUTLINE_CYCLE",
      "/outline/items",
      "Outline hierarchy must be acyclic.",
    );
  }
  const expectedKeyboardOrders = Array.from({ length: nodes.length }, (_, index) => index + 1);
  if (
    !sameValues(
      keyboardOrders.sort((a, b) => a - b).map(String),
      expectedKeyboardOrders.map(String),
    )
  ) {
    addViolation(
      violations,
      "STRUCTURAL_KEYBOARD_ORDER_INVALID",
      "/nodes",
      "Keyboard order must contain each integer from one through the node count exactly once.",
    );
  }

  const visibleNodeIds = asArray(visibility.defaultVisibleNodeIds).flatMap((item) =>
    typeof item === "string" ? [item] : [],
  );
  const visibleEdgeIds = asArray(visibility.defaultVisibleEdgeIds).flatMap((item) =>
    typeof item === "string" ? [item] : [],
  );
  if (!isSorted(visibleNodeIds) || !isSorted(visibleEdgeIds)) {
    addViolation(
      violations,
      "STRUCTURAL_VISIBILITY_IDS_NOT_SORTED",
      "/visibilityHints",
      "Default-visible IDs must be ASCII-sorted.",
    );
  }
  if (asNumber(visibility.totalNodeCount) !== nodes.length) {
    addViolation(
      violations,
      "STRUCTURAL_VISIBILITY_NODE_COUNT_MISMATCH",
      "/visibilityHints/totalNodeCount",
      "Visibility node count must equal nodes length.",
    );
  }
  if (asNumber(visibility.totalEdgeCount) !== edges.length) {
    addViolation(
      violations,
      "STRUCTURAL_VISIBILITY_EDGE_COUNT_MISMATCH",
      "/visibilityHints/totalEdgeCount",
      "Visibility edge count must equal edges length.",
    );
  }
  const flaggedNodeIds = nodes
    .filter((node) => asJsonObject(node.visibilityHint, "visibilityHint").defaultVisible === true)
    .map((node) => asString(node.nodeId)!);
  const flaggedEdgeIds = edges
    .filter((edge) => asJsonObject(edge.visibilityHint, "visibilityHint").defaultVisible === true)
    .map((edge) => asString(edge.edgeId)!);
  if (!sameValues(sortedUnique(flaggedNodeIds), sortedUnique(visibleNodeIds))) {
    addViolation(
      violations,
      "STRUCTURAL_VISIBLE_NODE_FLAGS_MISMATCH",
      "/visibilityHints/defaultVisibleNodeIds",
      "Visible node flags and ID list must agree.",
    );
  }
  if (!sameValues(sortedUnique(flaggedEdgeIds), sortedUnique(visibleEdgeIds))) {
    addViolation(
      violations,
      "STRUCTURAL_VISIBLE_EDGE_FLAGS_MISMATCH",
      "/visibilityHints/defaultVisibleEdgeIds",
      "Visible edge flags and ID list must agree.",
    );
  }
  if (
    visibleEdgeIds.some((edgeId) => {
      const edge = edgeById.get(edgeId);
      return (
        edge !== undefined &&
        (!visibleNodeIds.includes(asString(edge.sourceNodeId)!) ||
          !visibleNodeIds.includes(asString(edge.targetNodeId)!))
      );
    })
  ) {
    addViolation(
      violations,
      "STRUCTURAL_VISIBLE_EDGE_ENDPOINT_HIDDEN",
      "/visibilityHints/defaultVisibleEdgeIds",
      "Every visible edge must have two visible endpoints.",
    );
  }

  if (asString(outline.projectionId) !== asString(projection.projectionId)) {
    addViolation(
      violations,
      "STRUCTURAL_OUTLINE_PROJECTION_MISMATCH",
      "/outline/projectionId",
      "Outline projection ID must match the root projection ID.",
    );
  }
  if (asString(layout.structuralFingerprint) !== computeExploreStructuralFingerprint(value)) {
    addViolation(
      violations,
      "STRUCTURAL_FINGERPRINT_MISMATCH",
      "/layout/structuralFingerprint",
      "Structural fingerprint must match topology and layout recipe.",
    );
  }

  return validationResult(violations);
}

export function validateExploreStructuralProjection(value: unknown): ValidationResult {
  const structural = validateSchema("explore-structural-projection", value);
  return structural.valid ? validateExploreStructuralProjectionSemantics(value) : structural;
}
