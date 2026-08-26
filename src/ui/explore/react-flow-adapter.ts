import type { Edge, Node } from "@xyflow/react";

import type { ExploreNode, ExploreWorkspaceProjectionView } from "./types";

export interface ExploreFlowNodeData extends Record<string, unknown> {
  projectionNode: ExploreNode;
  positionX: number;
  positionY: number;
}

export type ExploreFlowNode = Node<ExploreFlowNodeData, "explore">;

export function buildReactFlowElements(projection: ExploreWorkspaceProjectionView): {
  nodes: ExploreFlowNode[];
  edges: Edge[];
} {
  const visibleNodeIds = new Set(projection.visibilityHints.defaultVisibleNodeIds);
  const visibleEdgeIds = new Set(projection.visibilityHints.defaultVisibleEdgeIds);
  const positions = new Map(
    projection.layout.positions.map((position) => [position.nodeId, position]),
  );

  const nodes = projection.nodes
    .filter((node) => visibleNodeIds.has(node.nodeId))
    .map((node): ExploreFlowNode => {
      const position = positions.get(node.nodeId);
      if (!position) throw new Error(`Explore projection has no position for ${node.nodeId}`);
      return {
        id: node.nodeId,
        type: "explore",
        position: position.effective,
        width: projection.layout.fixedNodeSize.width,
        height: projection.layout.fixedNodeSize.height,
        data: {
          projectionNode: node,
          positionX: position.effective.x,
          positionY: position.effective.y,
        },
        draggable: false,
        selectable: false,
        focusable: false,
        ariaLabel: node.accessibility.label,
      };
    });

  const edges = projection.edges
    .filter((edge) => visibleEdgeIds.has(edge.edgeId))
    .map((edge): Edge => ({
      id: edge.edgeId,
      source: edge.sourceNodeId,
      target: edge.targetNodeId,
      ariaLabel: edge.accessibilityLabel,
      focusable: false,
      selectable: false,
      animated: false,
      style: {
        strokeWidth: edge.blocking ? 3 : 1.5,
        stroke: edge.blocking ? "var(--color-graph-blocker)" : "var(--color-graph-edge)",
      },
    }));

  return { nodes, edges };
}
