import "server-only";

import type { ExploreStructuralProjectionV1 } from "../../../shared/contracts/explore-structural-projection";

import type { ExploreNode, ExploreStructuralProjectionView } from "../types";

const NOT_MATERIALIZED_EXPLANATION =
  "This is the live authorized target structure. Evidence-derived Mastery and readiness have not been materialized yet.";

function mapStructuralNode(node: ExploreStructuralProjectionV1["nodes"][number]): ExploreNode {
  const common = {
    nodeId: node.nodeId,
    entityRef: { ...node.entityRef },
    inspectorRef: node.inspectorRef,
    domainNodeId: node.domainNodeId,
    title: node.title,
    shortLabel: node.shortLabel,
    state: {
      kind: "UNAVAILABLE" as const,
      summaryText: "Calculation not materialized.",
    },
    requirementState:
      node.requirementState.kind === "NOT_REQUIRED"
        ? ({ kind: "NOT_REQUIRED" } as const)
        : ({ kind: "REQUIRED_UNEVALUATED" } as const),
    explanations: [
      {
        code: "calculation.not-materialized",
        message: NOT_MATERIALIZED_EXPLANATION,
      },
    ],
    accessibility: { ...node.accessibility },
  };

  return node.nodeType === "ACTIVITY"
    ? { ...common, nodeType: "ACTIVITY" }
    : { ...common, nodeType: node.nodeType };
}

/** Maps structural facts to the client view without manufacturing any calculation result. */
export function toExploreStructuralProjectionView(
  projection: ExploreStructuralProjectionV1,
): ExploreStructuralProjectionView {
  return {
    contract: projection.contract,
    projectionId: projection.projectionId,
    projectionState: {
      calculationState: "NOT_MATERIALIZED",
      staleReason: null,
      explanation: NOT_MATERIALIZED_EXPLANATION,
    },
    workspaceScope: {
      overlayRevision: projection.workspaceScope.overlayRevision,
    },
    layout: {
      ...projection.layout,
      fixedNodeSize: { ...projection.layout.fixedNodeSize },
      spacing: { ...projection.layout.spacing },
      positions: projection.layout.positions.map((position) => ({
        ...position,
        canonical: { ...position.canonical },
        effective: { ...position.effective },
      })),
    },
    nodes: projection.nodes.map(mapStructuralNode),
    edges: projection.edges.map((edge) => ({
      edgeId: edge.edgeId,
      edgeType: edge.edgeType,
      sourceNodeId: edge.sourceNodeId,
      targetNodeId: edge.targetNodeId,
      blocking: edge.blocking,
      accessibilityLabel: edge.accessibilityLabel,
    })),
    readiness: null,
    selectedVersions: {
      catalogVersionKey: projection.selectedVersions.catalogVersionKey,
      targetProfileVersionKey: projection.selectedVersions.targetProfileVersionKey,
    },
    visibilityHints: {
      defaultVisibleNodeIds: [...projection.visibilityHints.defaultVisibleNodeIds],
      defaultVisibleEdgeIds: [...projection.visibilityHints.defaultVisibleEdgeIds],
      totalNodeCount: projection.visibilityHints.totalNodeCount,
      totalEdgeCount: projection.visibilityHints.totalEdgeCount,
      maximumRenderedNodes: projection.visibilityHints.maximumRenderedNodes,
      maximumRenderedEdges: projection.visibilityHints.maximumRenderedEdges,
    },
    outline: {
      rootItemIds: [...projection.outline.rootItemIds],
      items: projection.outline.items.map((item) => ({
        outlineItemId: item.outlineItemId,
        nodeId: item.nodeId,
        parentItemId: item.parentItemId,
        depth: item.depth,
        childItemIds: [...item.childItemIds],
        accessibilityLabel: item.accessibilityLabel,
      })),
    },
  };
}
