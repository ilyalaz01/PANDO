import fixture from "../../../tests/fixtures/graph/v1/valid/graph-projection-v1.representative.json";
import { describe, expect, it } from "vitest";

import { buildReactFlowElements } from "./react-flow-adapter";
import { composeExploreProjection } from "./server/compose-graph-projection";

const projection = composeExploreProjection(fixture);

describe("React Flow adapter", () => {
  it("renders exactly the visibility and positions projected by the server", () => {
    const elements = buildReactFlowElements(projection);
    const positions = new Map(
      projection.layout.positions.map((position) => [position.nodeId, position]),
    );

    expect(elements.nodes.map((node) => node.id)).toEqual(
      projection.visibilityHints.defaultVisibleNodeIds,
    );
    expect(elements.edges.map((edge) => edge.id)).toEqual(
      projection.visibilityHints.defaultVisibleEdgeIds,
    );
    for (const node of elements.nodes) {
      expect(node.position).toEqual(positions.get(node.id)?.effective);
      expect(node.data.projectionNode).toBe(
        projection.nodes.find((item) => item.nodeId === node.id),
      );
      expect(node.data).not.toHaveProperty("readiness");
      expect(node.data).not.toHaveProperty("mastery");
    }
  });

  it("fails closed when a visible node has no server-provided position", () => {
    const invalid = structuredClone(projection);
    invalid.layout.positions = invalid.layout.positions.filter(
      (position) => position.nodeId !== invalid.visibilityHints.defaultVisibleNodeIds[0],
    );
    expect(() => buildReactFlowElements(invalid)).toThrow("has no position");
  });

  it("maps blocking styling from the payload without deriving blocking state", () => {
    const invalid = structuredClone(projection);
    invalid.edges[0]!.blocking = true;
    const edge = buildReactFlowElements(invalid).edges[0];
    expect(edge?.style).toMatchObject({ strokeWidth: 3 });
  });
});
