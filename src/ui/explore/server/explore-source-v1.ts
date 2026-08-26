import "server-only";

import {
  asArray,
  asJsonObject,
  asNumber,
  asString,
  hasDuplicates,
  isSorted,
  type JsonObject,
} from "../../../shared/contracts/json";
import {
  type ContractViolation,
  type ValidationResult,
  validationResult,
} from "../../../shared/contracts/result";
import { validateSchema } from "../../../shared/contracts/schema-registry";

export type ExploreSourceNodeType = "ACTIVITY" | "COMPETENCY" | "DOMAIN";
export type ExploreSourceOrigin = "CANONICAL" | "WORKSPACE_OVERLAY";
export type ExploreSourceEdgeType =
  "ACTIVITY_EVIDENCES" | "PART_OF" | "PREREQUISITE_OF" | "RELATED_TO" | "USER_ADDED";

export interface ExploreSourceContractV1 {
  readonly name: "ExploreSourceV1";
  readonly version: "1.0.0";
}

export interface ExploreSourceNodeV1 {
  readonly nodeRef: string;
  readonly nodeType: ExploreSourceNodeType;
  readonly title: string;
  readonly domainRef: string | null;
  readonly origin: ExploreSourceOrigin;
  readonly sourceVersionKey?: string;
  readonly workspaceId?: string;
  readonly activityType?: "EXPLANATION" | "MANUAL_CODING" | "MOCK" | "PROJECT" | "READING";
  readonly targetCompetencyRef?: string;
}

export interface ExploreSourceEdgeV1 {
  readonly edgeKey: string;
  readonly edgeType: ExploreSourceEdgeType;
  readonly sourceRef: string;
  readonly targetRef: string;
  readonly blocking: boolean;
  readonly origin: ExploreSourceOrigin;
  readonly workspaceId?: string;
}

export interface ExploreSourcePositionV1 {
  readonly nodeRef: string;
  readonly x: number;
  readonly y: number;
  readonly workspaceId: string;
  readonly readinessGoalId: string;
  readonly targetProfileVersionId: string;
}

/**
 * Authorized structural source returned by api.get_explore_source_v1.
 *
 * This is deliberately not GraphProjectionV1. Mastery state, target readiness, requirement
 * explanations, semantic watermarks, and canonical layout must arrive from their owning query or
 * calculation boundaries before the production Explore page can use this source.
 */
export interface ExploreSourceV1 {
  readonly contract: ExploreSourceContractV1;
  readonly workspaceId: string;
  readonly readinessGoalKey: string;
  readonly readinessGoalId: string;
  readonly targetProfileVersionId: string;
  readonly overlayVersion: string;
  readonly catalogVersionKey: string;
  readonly roadmapVersionKey: string | null;
  readonly targetProfileVersionKey: string;
  readonly nodes: readonly ExploreSourceNodeV1[];
  readonly edges: readonly ExploreSourceEdgeV1[];
  readonly positions: readonly ExploreSourcePositionV1[];
  readonly nodeCount: number;
  readonly edgeCount: number;
}

function addViolation(
  violations: ContractViolation[],
  code: string,
  path: string,
  message: string,
): void {
  violations.push({ code, path, message });
}

function graphHasCycle(adjacency: ReadonlyMap<string, readonly string[]>): boolean {
  const visited = new Set<string>();
  const active = new Set<string>();
  const visit = (node: string): boolean => {
    if (active.has(node)) return true;
    if (visited.has(node)) return false;
    visited.add(node);
    active.add(node);
    for (const next of adjacency.get(node) ?? []) {
      if (visit(next)) return true;
    }
    active.delete(node);
    return false;
  };
  return [...adjacency.keys()].some(visit);
}

function validateExploreSourceSemantics(value: unknown): ValidationResult {
  const source = asJsonObject(value, "ExploreSourceV1");
  const nodes = asArray(source.nodes).map((node) => asJsonObject(node, "Explore source node"));
  const edges = asArray(source.edges).map((edge) => asJsonObject(edge, "Explore source edge"));
  const positions = asArray(source.positions).map((position) =>
    asJsonObject(position, "Explore source position"),
  );
  const violations: ContractViolation[] = [];
  const workspaceId = asString(source.workspaceId)!;
  const readinessGoalId = asString(source.readinessGoalId)!;
  const targetProfileVersionId = asString(source.targetProfileVersionId)!;
  const catalogVersionKey = asString(source.catalogVersionKey)!;
  const nodeRefs = nodes.map((node) => asString(node.nodeRef)!);
  const edgeKeys = edges.map((edge) => asString(edge.edgeKey)!);
  const positionRefs = positions.map((position) => asString(position.nodeRef)!);

  if (asNumber(source.nodeCount) !== nodes.length) {
    addViolation(
      violations,
      "EXPLORE_SOURCE_NODE_COUNT_MISMATCH",
      "/nodeCount",
      "Declared node count must equal the complete node array.",
    );
  }
  if (asNumber(source.edgeCount) !== edges.length) {
    addViolation(
      violations,
      "EXPLORE_SOURCE_EDGE_COUNT_MISMATCH",
      "/edgeCount",
      "Declared edge count must equal the complete edge array.",
    );
  }
  if (!isSorted(nodeRefs)) {
    addViolation(
      violations,
      "EXPLORE_SOURCE_NODES_NOT_SORTED",
      "/nodes",
      "Nodes must be sorted by nodeRef.",
    );
  }
  if (hasDuplicates(nodeRefs)) {
    addViolation(
      violations,
      "EXPLORE_SOURCE_NODE_REF_DUPLICATE",
      "/nodes",
      "Node references must be unique.",
    );
  }
  if (!isSorted(edgeKeys)) {
    addViolation(
      violations,
      "EXPLORE_SOURCE_EDGES_NOT_SORTED",
      "/edges",
      "Edges must be sorted by edgeKey.",
    );
  }
  if (hasDuplicates(edgeKeys)) {
    addViolation(
      violations,
      "EXPLORE_SOURCE_EDGE_KEY_DUPLICATE",
      "/edges",
      "Edge keys must be unique.",
    );
  }
  if (!isSorted(positionRefs)) {
    addViolation(
      violations,
      "EXPLORE_SOURCE_POSITIONS_NOT_SORTED",
      "/positions",
      "Positions must be sorted by nodeRef.",
    );
  }
  if (hasDuplicates(positionRefs)) {
    addViolation(
      violations,
      "EXPLORE_SOURCE_POSITION_REF_DUPLICATE",
      "/positions",
      "A node may have at most one persisted position.",
    );
  }

  const nodeByRef = new Map(nodes.map((node) => [asString(node.nodeRef)!, node]));
  for (const [index, node] of nodes.entries()) {
    const nodeRef = asString(node.nodeRef)!;
    const nodeType = asString(node.nodeType)!;
    const origin = asString(node.origin)!;
    const domainRef = asString(node.domainRef);
    if (
      (nodeType === "DOMAIN" && !nodeRef.startsWith("domain:")) ||
      (nodeType === "COMPETENCY" && !nodeRef.startsWith("competency:")) ||
      (nodeType === "ACTIVITY" && !nodeRef.startsWith("activity:"))
    ) {
      addViolation(
        violations,
        "EXPLORE_SOURCE_NODE_REF_TYPE_MISMATCH",
        `/nodes/${index}/nodeRef`,
        "Node reference prefix must match nodeType.",
      );
    }
    if (nodeType === "DOMAIN" && node.domainRef !== null) {
      addViolation(
        violations,
        "EXPLORE_SOURCE_DOMAIN_PARENT_PRESENT",
        `/nodes/${index}/domainRef`,
        "A domain node cannot have a domain parent.",
      );
    }
    if (nodeType === "COMPETENCY") {
      const domain = domainRef === undefined ? undefined : nodeByRef.get(domainRef);
      if (domain === undefined || asString(domain.nodeType) !== "DOMAIN") {
        addViolation(
          violations,
          "EXPLORE_SOURCE_COMPETENCY_DOMAIN_MISSING",
          `/nodes/${index}/domainRef`,
          "A competency domain reference must resolve to a domain node.",
        );
      }
    }
    if (origin === "CANONICAL" && asString(node.sourceVersionKey) !== catalogVersionKey) {
      addViolation(
        violations,
        "EXPLORE_SOURCE_CATALOG_VERSION_MISMATCH",
        `/nodes/${index}/sourceVersionKey`,
        "Canonical nodes must use the selected catalog version.",
      );
    }
    if (origin === "WORKSPACE_OVERLAY" && asString(node.workspaceId) !== workspaceId) {
      addViolation(
        violations,
        "EXPLORE_SOURCE_FOREIGN_OVERLAY_NODE",
        `/nodes/${index}/workspaceId`,
        "Workspace-overlay nodes must match the authorized workspace.",
      );
    }
    if (nodeType === "ACTIVITY") {
      const target = nodeByRef.get(asString(node.targetCompetencyRef)!);
      if (target === undefined || asString(target.nodeType) !== "COMPETENCY") {
        addViolation(
          violations,
          "EXPLORE_SOURCE_ACTIVITY_TARGET_MISSING",
          `/nodes/${index}/targetCompetencyRef`,
          "An activity target must resolve to a competency node.",
        );
      }
    }
  }

  const prerequisiteAdjacency = new Map<string, string[]>();
  const activityEvidenceCounts = new Map<string, number>();
  for (const nodeRef of nodeRefs) prerequisiteAdjacency.set(nodeRef, []);
  for (const [index, edge] of edges.entries()) {
    const edgeType = asString(edge.edgeType)!;
    const sourceRef = asString(edge.sourceRef)!;
    const targetRef = asString(edge.targetRef)!;
    const origin = asString(edge.origin)!;
    const sourceNode = nodeByRef.get(sourceRef);
    const targetNode = nodeByRef.get(targetRef);
    if (sourceNode === undefined) {
      addViolation(
        violations,
        "EXPLORE_SOURCE_EDGE_SOURCE_MISSING",
        `/edges/${index}/sourceRef`,
        "Edge source must resolve within the source DTO.",
      );
    }
    if (targetNode === undefined) {
      addViolation(
        violations,
        "EXPLORE_SOURCE_EDGE_TARGET_MISSING",
        `/edges/${index}/targetRef`,
        "Edge target must resolve within the source DTO.",
      );
    }
    if (
      origin === "CANONICAL" &&
      (asString(sourceNode?.origin) === "WORKSPACE_OVERLAY" ||
        asString(targetNode?.origin) === "WORKSPACE_OVERLAY")
    ) {
      addViolation(
        violations,
        "EXPLORE_SOURCE_CANONICAL_EDGE_OVERLAY_ENDPOINT",
        `/edges/${index}/origin`,
        "An edge involving workspace-overlay content must be overlay-owned.",
      );
    }
    if (origin === "WORKSPACE_OVERLAY" && asString(edge.workspaceId) !== workspaceId) {
      addViolation(
        violations,
        "EXPLORE_SOURCE_FOREIGN_OVERLAY_EDGE",
        `/edges/${index}/workspaceId`,
        "Workspace-overlay edges must match the authorized workspace.",
      );
    }
    if (edgeType === "USER_ADDED" && origin !== "WORKSPACE_OVERLAY") {
      addViolation(
        violations,
        "EXPLORE_SOURCE_USER_ADDED_ORIGIN_INVALID",
        `/edges/${index}/origin`,
        "USER_ADDED edges must be workspace-overlay owned.",
      );
    }
    if (
      edgeType === "PART_OF" &&
      (asString(sourceNode?.nodeType) !== "COMPETENCY" ||
        asString(targetNode?.nodeType) !== "DOMAIN")
    ) {
      addViolation(
        violations,
        "EXPLORE_SOURCE_PART_OF_ENDPOINT_TYPE",
        `/edges/${index}`,
        "PART_OF must connect a competency to a domain.",
      );
    }
    if (
      edgeType === "PART_OF" &&
      sourceNode !== undefined &&
      asString(sourceNode.domainRef) !== targetRef
    ) {
      addViolation(
        violations,
        "EXPLORE_SOURCE_PART_OF_DOMAIN_MISMATCH",
        `/edges/${index}/targetRef`,
        "PART_OF must target the competency's declared domain.",
      );
    }
    if (
      edgeType === "PREREQUISITE_OF" &&
      (asString(sourceNode?.nodeType) !== "COMPETENCY" ||
        asString(targetNode?.nodeType) !== "COMPETENCY")
    ) {
      addViolation(
        violations,
        "EXPLORE_SOURCE_PREREQUISITE_ENDPOINT_TYPE",
        `/edges/${index}`,
        "PREREQUISITE_OF must connect two competencies.",
      );
    }
    if (
      edgeType === "ACTIVITY_EVIDENCES" &&
      (asString(sourceNode?.nodeType) !== "ACTIVITY" ||
        asString(targetNode?.nodeType) !== "COMPETENCY")
    ) {
      addViolation(
        violations,
        "EXPLORE_SOURCE_ACTIVITY_EVIDENCE_ENDPOINT_TYPE",
        `/edges/${index}`,
        "ACTIVITY_EVIDENCES must connect an activity to a competency.",
      );
    }
    if (edgeType === "ACTIVITY_EVIDENCES" && asString(sourceNode?.nodeType) === "ACTIVITY") {
      activityEvidenceCounts.set(sourceRef, (activityEvidenceCounts.get(sourceRef) ?? 0) + 1);
    }
    if (
      edgeType === "ACTIVITY_EVIDENCES" &&
      sourceNode !== undefined &&
      (origin !== "WORKSPACE_OVERLAY" || asString(sourceNode.targetCompetencyRef) !== targetRef)
    ) {
      addViolation(
        violations,
        "EXPLORE_SOURCE_ACTIVITY_EVIDENCE_TARGET_MISMATCH",
        `/edges/${index}`,
        "ACTIVITY_EVIDENCES must be overlay-owned and match the activity target.",
      );
    }
    if (edgeType !== "PREREQUISITE_OF" && edge.blocking === true) {
      addViolation(
        violations,
        "EXPLORE_SOURCE_NON_PREREQUISITE_BLOCKING",
        `/edges/${index}/blocking`,
        "Only a prerequisite edge may be blocking.",
      );
    }
    if (edgeType === "PREREQUISITE_OF" && sourceNode !== undefined && targetNode !== undefined) {
      prerequisiteAdjacency.get(sourceRef)!.push(targetRef);
    }
  }
  if (graphHasCycle(prerequisiteAdjacency)) {
    addViolation(
      violations,
      "EXPLORE_SOURCE_PREREQUISITE_CYCLE",
      "/edges",
      "The prerequisite source subgraph must be acyclic.",
    );
  }

  for (const [index, node] of nodes.entries()) {
    if (asString(node.nodeType) !== "ACTIVITY") continue;
    if (activityEvidenceCounts.get(asString(node.nodeRef)!) !== 1) {
      addViolation(
        violations,
        "EXPLORE_SOURCE_ACTIVITY_EVIDENCE_CARDINALITY",
        `/nodes/${index}/nodeRef`,
        "Each selected activity must have exactly one ACTIVITY_EVIDENCES edge.",
      );
    }
  }

  for (const [index, position] of positions.entries()) {
    const node = nodeByRef.get(asString(position.nodeRef)!);
    if (node === undefined) {
      addViolation(
        violations,
        "EXPLORE_SOURCE_POSITION_NODE_MISSING",
        `/positions/${index}/nodeRef`,
        "A persisted position must reference a source node.",
      );
    } else if (asString(node.nodeType) === "ACTIVITY") {
      addViolation(
        violations,
        "EXPLORE_SOURCE_ACTIVITY_POSITION_FORBIDDEN",
        `/positions/${index}/nodeRef`,
        "Selected activity nodes do not accept persisted positions.",
      );
    }
    if (
      asString(position.workspaceId) !== workspaceId ||
      asString(position.readinessGoalId) !== readinessGoalId ||
      asString(position.targetProfileVersionId) !== targetProfileVersionId
    ) {
      addViolation(
        violations,
        "EXPLORE_SOURCE_FOREIGN_POSITION_SCOPE",
        `/positions/${index}`,
        "Persisted position scope must match the authorized workspace, goal, and profile.",
      );
    }
  }

  return validationResult(violations);
}

export function validateExploreSourceV1(value: unknown): ValidationResult {
  const structural = validateSchema("explore-source", value);
  return structural.valid ? validateExploreSourceSemantics(value) : structural;
}

export class ExploreSourceContractError extends Error {
  readonly violations: readonly Pick<ContractViolation, "code" | "path">[];

  constructor(violations: readonly ContractViolation[]) {
    super("Explore source response failed contract validation.");
    this.name = "ExploreSourceContractError";
    this.violations = violations.map(({ code, path }) => ({ code, path }));
  }
}

function nodeDto(node: JsonObject): ExploreSourceNodeV1 {
  const base: ExploreSourceNodeV1 = {
    nodeRef: asString(node.nodeRef)!,
    nodeType: asString(node.nodeType)! as ExploreSourceNodeType,
    title: asString(node.title)!,
    domainRef: node.domainRef === null ? null : asString(node.domainRef)!,
    origin: asString(node.origin)! as ExploreSourceOrigin,
  };
  if (base.origin === "CANONICAL") {
    return { ...base, sourceVersionKey: asString(node.sourceVersionKey)! };
  }
  if (base.nodeType === "ACTIVITY") {
    return {
      ...base,
      workspaceId: asString(node.workspaceId)!,
      activityType: asString(node.activityType)! as NonNullable<
        ExploreSourceNodeV1["activityType"]
      >,
      targetCompetencyRef: asString(node.targetCompetencyRef)!,
    };
  }
  return { ...base, workspaceId: asString(node.workspaceId)! };
}

/** Validates an untrusted RPC response and returns a minimal plain-data DTO. */
export function decodeExploreSourceV1(value: unknown): ExploreSourceV1 {
  const validation = validateExploreSourceV1(value);
  if (!validation.valid) throw new ExploreSourceContractError(validation.violations);
  const source = asJsonObject(value, "ExploreSourceV1");
  return {
    contract: { name: "ExploreSourceV1", version: "1.0.0" },
    workspaceId: asString(source.workspaceId)!,
    readinessGoalKey: asString(source.readinessGoalKey)!,
    readinessGoalId: asString(source.readinessGoalId)!,
    targetProfileVersionId: asString(source.targetProfileVersionId)!,
    overlayVersion: asString(source.overlayVersion)!,
    catalogVersionKey: asString(source.catalogVersionKey)!,
    roadmapVersionKey:
      source.roadmapVersionKey === null ? null : asString(source.roadmapVersionKey)!,
    targetProfileVersionKey: asString(source.targetProfileVersionKey)!,
    nodes: asArray(source.nodes).map((node) => nodeDto(asJsonObject(node, "node"))),
    edges: asArray(source.edges).map((edge) => {
      const item = asJsonObject(edge, "edge");
      const result: ExploreSourceEdgeV1 = {
        edgeKey: asString(item.edgeKey)!,
        edgeType: asString(item.edgeType)! as ExploreSourceEdgeType,
        sourceRef: asString(item.sourceRef)!,
        targetRef: asString(item.targetRef)!,
        blocking: item.blocking === true,
        origin: asString(item.origin)! as ExploreSourceOrigin,
      };
      return result.origin === "WORKSPACE_OVERLAY"
        ? { ...result, workspaceId: asString(item.workspaceId)! }
        : result;
    }),
    positions: asArray(source.positions).map((position) => {
      const item = asJsonObject(position, "position");
      return {
        nodeRef: asString(item.nodeRef)!,
        x: asNumber(item.x)!,
        y: asNumber(item.y)!,
        workspaceId: asString(item.workspaceId)!,
        readinessGoalId: asString(item.readinessGoalId)!,
        targetProfileVersionId: asString(item.targetProfileVersionId)!,
      };
    }),
    nodeCount: asNumber(source.nodeCount)!,
    edgeCount: asNumber(source.edgeCount)!,
  };
}
