import "server-only";

import type { ExploreStructuralProjectionV1 } from "../../../shared/contracts/explore-structural-projection";

import type { ExploreStructuralProjectionView } from "../types";

const NOT_MATERIALIZED_EXPLANATION =
  "This is the live authorized target structure. Evidence-derived Mastery and readiness have not been materialized yet.";

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
    nodes: projection.nodes.map((node) => ({
      nodeId: node.nodeId,
      nodeType: node.nodeType,
      domainNodeId: node.domainNodeId,
      title: node.title,
      shortLabel: node.shortLabel,
      state: {
        kind: "UNAVAILABLE",
        summaryText: "Calculation not materialized.",
      },
      requirementState:
        node.requirementState.kind === "NOT_REQUIRED"
          ? { kind: "NOT_REQUIRED" }
          : { kind: "REQUIRED_UNEVALUATED" },
      explanations: [
        {
          code: "calculation.not-materialized",
          message: NOT_MATERIALIZED_EXPLANATION,
        },
      ],
      accessibility: { ...node.accessibility },
    })),
    edges: projection.edges.map((edge) => ({
      edgeId: edge.edgeId,
      edgeType: edge.edgeType,
      sourceNodeId: edge.sourceNodeId,
      targetNodeId: edge.targetNodeId,
      blocking: edge.blocking,
      accessibilityLabel: edge.accessibilityLabel,
    })),
    readiness: null,
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
