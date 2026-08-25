import fixture from "../../../../tests/fixtures/graph/v1/valid/graph-projection-v1.representative.json";
import goldenLayout from "../../../../tests/fixtures/graph/v1/valid/graph-projection-v1.representative-layout.golden.json";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { ExploreGraphProjectionView } from "../types";
import { composeExploreProjection, ExploreProjectionError } from "./compose-graph-projection";
import { computeDagrePositions } from "./dagre-layout";

const fingerprint = "650e5b39cea63a3b6746aca6ce3234e20756eb3b7422b5df8d26be18e7f29394";

describe("Explore GraphProjection composer", () => {
  it("materializes the representative 25-node projection without changing its fingerprint", () => {
    const projection = composeExploreProjection(fixture);

    expect(projection.nodes).toHaveLength(25);
    expect(projection.edges).toHaveLength(35);
    expect(projection.layout.positions).toHaveLength(25);
    expect(projection.layout.structuralFingerprint).toBe(fingerprint);
    expect({
      layoutVersion: projection.layout.layoutVersion,
      algorithmVersion: projection.layout.algorithmVersion,
      structuralFingerprint: projection.layout.structuralFingerprint,
      positions: projection.layout.positions,
    }).toEqual(goldenLayout);

    const domain = projection.layout.positions.find(
      (position) => position.nodeId === "node:domain:algorithms",
    );
    const child = projection.layout.positions.find(
      (position) => position.nodeId === "node:competency:algorithms-complexity-analysis",
    );
    expect(domain!.canonical.x).toBeLessThan(child!.canonical.x);
  });

  it("is deterministic for input iteration order and ignores semantic display fields", () => {
    const projection = composeExploreProjection(fixture);
    const expected = computeDagrePositions(projection);

    fc.assert(
      fc.property(
        fc.shuffledSubarray(projection.nodes, {
          minLength: projection.nodes.length,
          maxLength: projection.nodes.length,
        }),
        fc.shuffledSubarray(projection.edges, {
          minLength: projection.edges.length,
          maxLength: projection.edges.length,
        }),
        fc.string(),
        (nodes, edges, semanticSummary) => {
          const reordered = structuredClone(projection);
          reordered.nodes = nodes;
          reordered.edges = edges;
          reordered.nodes[0]!.state.summaryText = semanticSummary;
          expect(computeDagrePositions(reordered)).toEqual(expected);
        },
      ),
      { numRuns: 30 },
    );
  });

  it("preserves the accepted workspace override delta over a new canonical position", () => {
    const projection = composeExploreProjection(fixture);
    const position = projection.layout.positions.find(
      (item) => item.nodeId === "node:competency:linux-log-triage",
    );

    expect(position?.source).toBe("WORKSPACE_OVERRIDE");
    expect(position?.effective.x).toBe((position?.canonical.x ?? 0) + 40);
    expect(position?.effective.y).toBe((position?.canonical.y ?? 0) + 24);
    expect(position?.overrideRevision).toBe("overlay:fixture-primary-v1");
  });

  it("rejects unsupported algorithm versions and structurally invalid sources", () => {
    const projection = composeExploreProjection(fixture);
    projection.layout.algorithmVersion = "unknown-layout";
    expect(() => computeDagrePositions(projection)).toThrow("Unsupported graph layout algorithm");

    const invalid: unknown = { ...fixture, nodes: [] };
    expect(() => composeExploreProjection(invalid)).toThrow(ExploreProjectionError);
  });

  it("fails rather than inventing a position when a validated projection is corrupted", () => {
    const projection = composeExploreProjection(fixture);
    projection.layout.positions = projection.layout.positions.slice(1);
    expect(() => computeDagrePositions(projection as ExploreGraphProjectionView)).toThrow(
      "Dagre omitted node",
    );
  });
});
