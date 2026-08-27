import "server-only";

import {
  asJsonObject,
  isJsonObject,
  type JsonObject,
  type JsonValue,
} from "../../../shared/contracts/json";
import type {
  ExploreEdge,
  ExploreGraphProjectionView,
  ExploreLayoutPosition,
  ExploreNode,
  ExploreOutlineItem,
} from "../types";

function requiredArray(value: JsonValue | undefined, label: string): JsonValue[] {
  if (!Array.isArray(value)) throw new TypeError(label + " must be an array");
  return value;
}

function objectArray(value: JsonValue | undefined, label: string): JsonObject[] {
  return requiredArray(value, label).map((item, index) => {
    if (!isJsonObject(item)) throw new TypeError(label + "[" + index + "] must be an object");
    return item;
  });
}

function requiredString(value: JsonValue | undefined, label: string): string {
  if (typeof value !== "string") throw new TypeError(label + " must be a string");
  return value;
}

function nullableString(value: JsonValue | undefined, label: string): string | null {
  if (value === null) return null;
  return requiredString(value, label);
}

function requiredNumber(value: JsonValue | undefined, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(label + " must be a finite number");
  }
  return value;
}

function requiredBoolean(value: JsonValue | undefined, label: string): boolean {
  if (typeof value !== "boolean") throw new TypeError(label + " must be a boolean");
  return value;
}

function enumValue<const Values extends readonly string[]>(
  value: JsonValue | undefined,
  allowed: Values,
  label: string,
): Values[number] {
  const candidate = requiredString(value, label);
  if (!allowed.includes(candidate)) throw new TypeError(label + " has an unsupported value");
  return candidate as Values[number];
}

function stringArray(value: JsonValue | undefined, label: string): string[] {
  return requiredArray(value, label).map((item, index) =>
    requiredString(item, label + "[" + index + "]"),
  );
}

function mapPoint(value: JsonValue | undefined, label: string) {
  const point = asJsonObject(value, label);
  return {
    x: requiredNumber(point.x, label + ".x"),
    y: requiredNumber(point.y, label + ".y"),
  };
}

function mapPosition(value: JsonObject, index: number): ExploreLayoutPosition {
  const label = "layout.positions[" + index + "]";
  const overrideWorkspaceId =
    value.overrideWorkspaceId === undefined
      ? undefined
      : requiredString(value.overrideWorkspaceId, label + ".overrideWorkspaceId");

  return {
    nodeId: requiredString(value.nodeId, label + ".nodeId"),
    canonical: mapPoint(value.canonical, label + ".canonical"),
    effective: mapPoint(value.effective, label + ".effective"),
    source: enumValue(
      value.source,
      ["CANONICAL_LAYOUT", "WORKSPACE_OVERRIDE"] as const,
      label + ".source",
    ),
    overrideRevision: nullableString(value.overrideRevision, label + ".overrideRevision"),
    ...(overrideWorkspaceId === undefined ? {} : { overrideWorkspaceId }),
  };
}

function mapExplanations(value: JsonValue | undefined, label: string) {
  return objectArray(value, label).map((explanation, index) => ({
    code: requiredString(explanation.code, label + "[" + index + "].code"),
    message: requiredString(explanation.message, label + "[" + index + "].message"),
  }));
}

function mapNode(value: JsonObject, index: number): ExploreNode {
  const label = "nodes[" + index + "]";
  const nodeType = enumValue(
    value.nodeType,
    ["DOMAIN", "GROUP", "COMPETENCY", "ACTIVITY"] as const,
    label + ".nodeType",
  );
  const entityRef = asJsonObject(value.entityRef, label + ".entityRef");
  const state = asJsonObject(value.state, label + ".state");
  const requirementState = asJsonObject(value.requirementState, label + ".requirementState");
  const accessibility = asJsonObject(value.accessibility, label + ".accessibility");
  const common = {
    nodeId: requiredString(value.nodeId, label + ".nodeId"),
    entityRef: {
      entityType: enumValue(
        entityRef.entityType,
        ["DOMAIN", "GROUP", "COMPETENCY", "ACTIVITY"] as const,
        label + ".entityRef.entityType",
      ),
      entityId: requiredString(entityRef.entityId, label + ".entityRef.entityId"),
      entityVersionId: nullableString(
        entityRef.entityVersionId,
        label + ".entityRef.entityVersionId",
      ),
    },
    inspectorRef: requiredString(value.inspectorRef, label + ".inspectorRef"),
    domainNodeId: nullableString(value.domainNodeId, label + ".domainNodeId"),
    title: requiredString(value.title, label + ".title"),
    shortLabel: requiredString(value.shortLabel, label + ".shortLabel"),
    requirementState: {
      kind: enumValue(
        requirementState.kind,
        ["NOT_REQUIRED", "REQUIRED_UNKNOWN", "REQUIRED_KNOWN"] as const,
        label + ".requirementState.kind",
      ),
      ...(requirementState.floorStatus === undefined
        ? {}
        : {
            floorStatus: enumValue(
              requirementState.floorStatus,
              ["NOT_APPLICABLE", "UNKNOWN", "BELOW", "MET"] as const,
              label + ".requirementState.floorStatus",
            ),
          }),
    },
    explanations: mapExplanations(value.explanations, label + ".explanations"),
    accessibility: {
      label: requiredString(accessibility.label, label + ".accessibility.label"),
      description: requiredString(accessibility.description, label + ".accessibility.description"),
      statusText: requiredString(accessibility.statusText, label + ".accessibility.statusText"),
      keyboardOrder: requiredNumber(
        accessibility.keyboardOrder,
        label + ".accessibility.keyboardOrder",
      ),
      outlineItemId: requiredString(
        accessibility.outlineItemId,
        label + ".accessibility.outlineItemId",
      ),
    },
  };

  if (nodeType === "ACTIVITY") {
    return {
      ...common,
      nodeType,
      state: {
        kind: "ACTIVITY",
        lifecycleStatus: enumValue(
          state.lifecycleStatus,
          ["AVAILABLE", "IN_PROGRESS", "COMPLETED", "UNAVAILABLE"] as const,
          label + ".state.lifecycleStatus",
        ),
        evidenceExpectation: enumValue(
          state.evidenceExpectation,
          ["NONE", "POSSIBLE", "EXPECTED"] as const,
          label + ".state.evidenceExpectation",
        ),
        summaryText: requiredString(state.summaryText, label + ".state.summaryText"),
      },
    };
  }

  return {
    ...common,
    nodeType,
    state: {
      kind: "SEMANTIC",
      achievementLevel:
        state.achievementLevel === null
          ? null
          : enumValue(
              state.achievementLevel,
              ["NOT_STARTED", "COMPLETED", "VERIFIED", "MASTERED"] as const,
              label + ".state.achievementLevel",
            ),
      summaryText: requiredString(state.summaryText, label + ".state.summaryText"),
    },
  };
}

function mapEdge(value: JsonObject, index: number): ExploreEdge {
  const label = "edges[" + index + "]";
  return {
    edgeId: requiredString(value.edgeId, label + ".edgeId"),
    edgeType: enumValue(
      value.edgeType,
      [
        "PREREQUISITE_OF",
        "RELATED_TO",
        "PART_OF",
        "ACTIVITY_EVIDENCES",
        "TARGET_REQUIRES",
        "RESOURCE_SUPPORTS",
        "USER_ADDED",
      ] as const,
      label + ".edgeType",
    ),
    sourceNodeId: requiredString(value.sourceNodeId, label + ".sourceNodeId"),
    targetNodeId: requiredString(value.targetNodeId, label + ".targetNodeId"),
    blocking: requiredBoolean(value.blocking, label + ".blocking"),
    accessibilityLabel: requiredString(value.accessibilityLabel, label + ".accessibilityLabel"),
  };
}

function mapOutlineItem(value: JsonObject, index: number): ExploreOutlineItem {
  const label = "outline.items[" + index + "]";
  return {
    outlineItemId: requiredString(value.outlineItemId, label + ".outlineItemId"),
    nodeId: requiredString(value.nodeId, label + ".nodeId"),
    parentItemId: nullableString(value.parentItemId, label + ".parentItemId"),
    depth: requiredNumber(value.depth, label + ".depth"),
    childItemIds: stringArray(value.childItemIds, label + ".childItemIds"),
    accessibilityLabel: requiredString(value.accessibilityLabel, label + ".accessibilityLabel"),
  };
}

/**
 * Maps only client-consumed fields after the complete document has passed GraphProjectionV1
 * structural and semantic validation. The mapper does not calculate domain state.
 */
export function toExploreProjectionView(value: unknown): ExploreGraphProjectionView {
  const projection = asJsonObject(value, "GraphProjectionV1");
  const contract = asJsonObject(projection.contract, "contract");
  const projectionState = asJsonObject(projection.projectionState, "projectionState");
  const workspaceScope = asJsonObject(projection.workspaceScope, "workspaceScope");
  const layout = asJsonObject(projection.layout, "layout");
  const fixedNodeSize = asJsonObject(layout.fixedNodeSize, "layout.fixedNodeSize");
  const spacing = asJsonObject(layout.spacing, "layout.spacing");
  const readiness = asJsonObject(projection.readiness, "readiness");
  const estimate = asJsonObject(readiness.estimate, "readiness.estimate");
  const visibility = asJsonObject(projection.visibilityHints, "visibilityHints");
  const outline = asJsonObject(projection.outline, "outline");

  return {
    contract: {
      name: enumValue(contract.name, ["GraphProjectionV1"] as const, "contract.name"),
      version: enumValue(contract.version, ["1.0.0"] as const, "contract.version"),
    },
    projectionId: requiredString(projection.projectionId, "projectionId"),
    workspaceScope: {
      overlayRevision: requiredString(
        workspaceScope.overlayRevision,
        "workspaceScope.overlayRevision",
      ),
    },
    projectionState: {
      calculationState: enumValue(
        projectionState.calculationState,
        ["CURRENT", "STALE", "REBUILDING", "ERROR"] as const,
        "projectionState.calculationState",
      ),
      staleReason: nullableString(projectionState.staleReason, "projectionState.staleReason"),
      explanation: requiredString(projectionState.explanation, "projectionState.explanation"),
    },
    layout: {
      layoutVersion: requiredString(layout.layoutVersion, "layout.layoutVersion"),
      algorithmVersion: requiredString(layout.algorithmVersion, "layout.algorithmVersion"),
      structuralFingerprint: requiredString(
        layout.structuralFingerprint,
        "layout.structuralFingerprint",
      ),
      coordinateSystem: enumValue(
        layout.coordinateSystem,
        ["TOP_LEFT"] as const,
        "layout.coordinateSystem",
      ),
      fixedNodeSize: {
        width: requiredNumber(fixedNodeSize.width, "layout.fixedNodeSize.width"),
        height: requiredNumber(fixedNodeSize.height, "layout.fixedNodeSize.height"),
      },
      spacing: {
        rank: requiredNumber(spacing.rank, "layout.spacing.rank"),
        node: requiredNumber(spacing.node, "layout.spacing.node"),
      },
      positions: objectArray(layout.positions, "layout.positions").map(mapPosition),
    },
    nodes: objectArray(projection.nodes, "nodes").map(mapNode),
    edges: objectArray(projection.edges, "edges").map(mapEdge),
    readiness: {
      targetProfileVersionId: nullableString(
        readiness.targetProfileVersionId,
        "readiness.targetProfileVersionId",
      ),
      status: enumValue(
        readiness.status,
        ["NOT_APPLICABLE", "NOT_READY", "INSUFFICIENT_EVIDENCE", "DEVELOPING", "READY"] as const,
        "readiness.status",
      ),
      estimate: {
        lower: requiredNumber(estimate.lower, "readiness.estimate.lower"),
        upper: requiredNumber(estimate.upper, "readiness.estimate.upper"),
      },
      coverage: requiredNumber(readiness.coverage, "readiness.coverage"),
      confidence: enumValue(
        readiness.confidence,
        ["LOW", "MEDIUM", "HIGH"] as const,
        "readiness.confidence",
      ),
      mandatoryBlockerRuleIds: stringArray(
        readiness.mandatoryBlockerRuleIds,
        "readiness.mandatoryBlockerRuleIds",
      ),
      unknownNodeIds: stringArray(readiness.unknownNodeIds, "readiness.unknownNodeIds"),
      staleNodeIds: stringArray(readiness.staleNodeIds, "readiness.staleNodeIds"),
      explanations: mapExplanations(readiness.explanations, "readiness.explanations"),
      displayLabel: requiredString(readiness.displayLabel, "readiness.displayLabel"),
    },
    visibilityHints: {
      defaultVisibleNodeIds: stringArray(
        visibility.defaultVisibleNodeIds,
        "visibilityHints.defaultVisibleNodeIds",
      ),
      defaultVisibleEdgeIds: stringArray(
        visibility.defaultVisibleEdgeIds,
        "visibilityHints.defaultVisibleEdgeIds",
      ),
      totalNodeCount: requiredNumber(visibility.totalNodeCount, "visibilityHints.totalNodeCount"),
      totalEdgeCount: requiredNumber(visibility.totalEdgeCount, "visibilityHints.totalEdgeCount"),
      maximumRenderedNodes: requiredNumber(
        visibility.maximumRenderedNodes,
        "visibilityHints.maximumRenderedNodes",
      ),
      maximumRenderedEdges: requiredNumber(
        visibility.maximumRenderedEdges,
        "visibilityHints.maximumRenderedEdges",
      ),
    },
    outline: {
      rootItemIds: stringArray(outline.rootItemIds, "outline.rootItemIds"),
      items: objectArray(outline.items, "outline.items").map(mapOutlineItem),
    },
  };
}
