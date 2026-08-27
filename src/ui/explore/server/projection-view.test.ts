import fixture from "../../../../tests/fixtures/graph/v1/valid/graph-projection-v1.representative.json";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { toExploreProjectionView } from "./projection-view";

describe("GraphProjection client view", () => {
  it("preserves opaque entity, inspector, and overlay revision references", () => {
    const view = toExploreProjectionView(fixture);
    const node = view.nodes.find(
      ({ nodeId }) => nodeId === "node:competency:algorithms-complexity-analysis",
    );

    expect(view.workspaceScope).toEqual({
      overlayRevision: "overlay:fixture-primary-v1",
    });
    expect(node).toEqual(
      expect.objectContaining({
        entityRef: {
          entityType: "COMPETENCY",
          entityId: "competency:algorithms-complexity-analysis",
          entityVersionId: "catalog:seed-v1",
        },
        inspectorRef: "inspector:node:competency:algorithms-complexity-analysis",
      }),
    );
  });
});
