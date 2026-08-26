import "server-only";

import dagre from "@dagrejs/dagre";

import type { ExploreLayoutPosition } from "../types";

export const dagreLayoutAdapterVersion = "dagre-layered-v1";

const roundCoordinate = (value: number): number => Math.round(value * 1000) / 1000;
const stableIdCompare = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

export interface DagreLayoutProjectionInput {
  readonly layout: {
    readonly algorithmVersion: string;
    readonly fixedNodeSize: { readonly width: number; readonly height: number };
    readonly spacing: { readonly rank: number; readonly node: number };
    readonly positions: readonly ExploreLayoutPosition[];
  };
  readonly nodes: readonly { readonly nodeId: string }[];
  readonly edges: readonly {
    readonly edgeId: string;
    readonly edgeType: string;
    readonly sourceNodeId: string;
    readonly targetNodeId: string;
  }[];
}

export function computeDagrePositions(
  projection: DagreLayoutProjectionInput,
): ExploreLayoutPosition[] {
  if (projection.layout.algorithmVersion !== dagreLayoutAdapterVersion) {
    throw new Error("Unsupported graph layout algorithm: " + projection.layout.algorithmVersion);
  }

  const graph = new dagre.graphlib.Graph({ multigraph: true });
  graph.setGraph({
    rankdir: "LR",
    ranksep: projection.layout.spacing.rank,
    nodesep: projection.layout.spacing.node,
    marginx: 24,
    marginy: 24,
  });
  graph.setDefaultEdgeLabel(() => ({}));

  const size = projection.layout.fixedNodeSize;
  for (const node of [...projection.nodes].sort((a, b) => stableIdCompare(a.nodeId, b.nodeId))) {
    graph.setNode(node.nodeId, { width: size.width, height: size.height });
  }
  for (const edge of [...projection.edges].sort((a, b) => stableIdCompare(a.edgeId, b.edgeId))) {
    // PART_OF is inverted only for layout so navigation domains anchor the left-hand rank;
    // the emitted GraphProjection relationship remains unchanged.
    const layoutSource = edge.edgeType === "PART_OF" ? edge.targetNodeId : edge.sourceNodeId;
    const layoutTarget = edge.edgeType === "PART_OF" ? edge.sourceNodeId : edge.targetNodeId;
    graph.setEdge(layoutSource, layoutTarget, {}, edge.edgeId);
  }

  dagre.layout(graph);
  const previousById = new Map(
    projection.layout.positions.map((position) => [position.nodeId, position]),
  );

  return [...projection.nodes]
    .sort((a, b) => stableIdCompare(a.nodeId, b.nodeId))
    .map((node) => {
      const positioned = graph.node(node.nodeId) as { x: number; y: number } | undefined;
      const previous = previousById.get(node.nodeId);
      if (!positioned || !previous) throw new Error("Dagre omitted node " + node.nodeId);

      const canonical = {
        x: roundCoordinate(positioned.x - size.width / 2),
        y: roundCoordinate(positioned.y - size.height / 2),
      };
      const overrideDelta = {
        x: previous.effective.x - previous.canonical.x,
        y: previous.effective.y - previous.canonical.y,
      };
      const effective =
        previous.source === "WORKSPACE_OVERRIDE"
          ? {
              x: roundCoordinate(canonical.x + overrideDelta.x),
              y: roundCoordinate(canonical.y + overrideDelta.y),
            }
          : canonical;

      return {
        nodeId: node.nodeId,
        canonical,
        effective,
        source: previous.source,
        overrideRevision: previous.overrideRevision,
        ...(previous.overrideWorkspaceId === undefined
          ? {}
          : { overrideWorkspaceId: previous.overrideWorkspaceId }),
      };
    });
}
