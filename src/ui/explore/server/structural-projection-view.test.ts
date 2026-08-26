import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { ExploreStructuralProjectionV1 } from "../../../shared/contracts/explore-structural-projection";
import { toExploreStructuralProjectionView } from "./structural-projection-view";

const projection: ExploreStructuralProjectionV1 = {
  contract: { name: "ExploreStructuralProjectionV1", version: "1.0.0" },
  projectionId: "projection:structural:test",
  workspaceScope: {
    workspaceId: "10000000-0000-4000-8000-000000000001",
    overlayRevision: "0",
    acceptedPersonalContentOnly: true,
  },
  selectedVersions: {
    catalogVersionKey: "catalog:seed-v1",
    roadmapVersionKey: null,
    targetProfileVersionKey: "target:test-v1",
  },
  calculationAvailability: "NOT_MATERIALIZED",
  layout: {
    layoutVersion: "graph-layout-v1",
    algorithmVersion: "dagre-layered-v1",
    structuralFingerprint: "0".repeat(64),
    coordinateSystem: "TOP_LEFT",
    fixedNodeSize: { width: 240, height: 104 },
    spacing: { rank: 88, node: 40 },
    positions: [
      {
        nodeId: "node:domain:test",
        canonical: { x: 0, y: 0 },
        effective: { x: 0, y: 0 },
        source: "CANONICAL_LAYOUT",
        overrideRevision: null,
      },
    ],
  },
  nodes: [
    {
      nodeId: "node:domain:test",
      nodeType: "DOMAIN",
      entityRef: {
        entityType: "DOMAIN",
        entityId: "domain:test",
        entityVersionId: "catalog:seed-v1",
      },
      origin: { kind: "CANONICAL", sourceVersionId: "catalog:seed-v1" },
      domainNodeId: null,
      title: "Test domain",
      shortLabel: "Test domain",
      requirementState: { kind: "NOT_REQUIRED" },
      visibilityHint: {
        defaultVisible: true,
        availableAtDetailLevels: ["DOMAIN", "COMPETENCY"],
        reasonCodes: ["STRUCTURAL_CONTEXT"],
      },
      accessibility: {
        label: "Test domain, domain",
        description: "Test structure.",
        statusText: "Calculation not materialized.",
        keyboardOrder: 1,
        outlineItemId: "outline:node:domain:test",
      },
      inspectorRef: "inspector:node:domain:test",
    },
  ],
  edges: [],
  requirements: {
    targetProfileVersionKey: "target:test-v1",
    rootRuleId: "rule:test",
    rules: [
      {
        ruleId: "rule:test",
        ruleType: "ALL",
        title: "Test rule",
        criticality: "MANDATORY",
        explanation: "Test rule explanation.",
        accessibilityLabel: "Test rule.",
        members: [
          {
            memberType: "NODE",
            nodeId: "node:domain:test",
            dimension: "KNOWLEDGE",
            requiredLevel: "COMPLETED",
          },
        ],
      },
    ],
  },
  visibilityHints: {
    completeTargetGraph: true,
    defaultVisibleNodeIds: ["node:domain:test"],
    defaultVisibleEdgeIds: [],
    totalNodeCount: 1,
    totalEdgeCount: 0,
    maximumRenderedNodes: 150,
    maximumRenderedEdges: 300,
  },
  outline: {
    projectionId: "projection:structural:test",
    rootItemIds: ["outline:node:domain:test"],
    items: [
      {
        outlineItemId: "outline:node:domain:test",
        nodeId: "node:domain:test",
        parentItemId: null,
        depth: 0,
        sortKey: "0001:test",
        childItemIds: [],
        accessibilityLabel: "Test domain, domain",
      },
    ],
  },
};

describe("structural Explore client view", () => {
  it("keeps calculations unavailable instead of converting them to Unknown or zero", () => {
    const view = toExploreStructuralProjectionView(projection);

    expect(view.projectionState.calculationState).toBe("NOT_MATERIALIZED");
    expect(view.readiness).toBeNull();
    expect(view.nodes.every((node) => node.state.kind === "UNAVAILABLE")).toBe(true);
    expect(JSON.stringify(view)).not.toMatch(
      /"achievementLevel"|"estimate"|"confidence"|"unknownNodeIds"/u,
    );
  });
});
