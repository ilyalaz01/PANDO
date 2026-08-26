// @vitest-environment node

import targetFixture from "../../../../tests/fixtures/explore-target-context/v1/valid/explore-target-context-v1.canonical.json";
import { describe, expect, it } from "vitest";

import { computeExploreStructuralFingerprint } from "../../../shared/contracts/explore-structural-projection";
import type { ExploreSourceV1 } from "./explore-source-v1";
import {
  decodeExploreTargetContextV1,
  type ExploreTargetContextV1,
} from "./explore-target-context-v1";
import {
  LiveExploreStructureMaterializationError,
  materializeLiveExploreStructure,
} from "./materialize-live-explore-structure";

const WORKSPACE_ID = "10000000-0000-4000-8000-000000000001";
const ACTIVITY_REF = "activity:beta-lab";

function targetContext(): ExploreTargetContextV1 {
  return decodeExploreTargetContextV1(structuredClone(targetFixture));
}

function broadSource(): ExploreSourceV1 {
  return {
    contract: { name: "ExploreSourceV1", version: "1.0.0" },
    workspaceId: WORKSPACE_ID,
    readinessGoalKey: "goal:canonical-main",
    readinessGoalId: "30000000-0000-4000-8000-000000000003",
    targetProfileVersionId: "40000000-0000-4000-8000-000000000004",
    overlayVersion: "0",
    catalogVersionKey: "catalog:seed-v1",
    roadmapVersionKey: "roadmap:seed-v1",
    targetProfileVersionKey: "target:canonical-main-v1",
    nodes: [
      {
        nodeRef: ACTIVITY_REF,
        nodeType: "ACTIVITY",
        title: "Beta lab",
        domainRef: null,
        origin: "WORKSPACE_OVERLAY",
        workspaceId: WORKSPACE_ID,
        activityType: "MANUAL_CODING",
        targetCompetencyRef: "competency:beta",
      },
      {
        nodeRef: "competency:alpha",
        nodeType: "COMPETENCY",
        title: "Alpha foundations",
        domainRef: "domain:core",
        origin: "CANONICAL",
        sourceVersionKey: "catalog:seed-v1",
      },
      {
        nodeRef: "competency:beta",
        nodeType: "COMPETENCY",
        title: "Beta application",
        domainRef: "domain:core",
        origin: "CANONICAL",
        sourceVersionKey: "catalog:seed-v1",
      },
      {
        nodeRef: "competency:extra",
        nodeType: "COMPETENCY",
        title: "Unrelated competency",
        domainRef: "domain:extra",
        origin: "CANONICAL",
        sourceVersionKey: "catalog:seed-v1",
      },
      {
        nodeRef: "domain:core",
        nodeType: "DOMAIN",
        title: "Core",
        domainRef: null,
        origin: "CANONICAL",
        sourceVersionKey: "catalog:seed-v1",
      },
      {
        nodeRef: "domain:extra",
        nodeType: "DOMAIN",
        title: "Extra",
        domainRef: null,
        origin: "CANONICAL",
        sourceVersionKey: "catalog:seed-v1",
      },
    ],
    edges: [
      {
        edgeKey: "edge:activity-evidences:beta-lab:beta",
        edgeType: "ACTIVITY_EVIDENCES",
        sourceRef: ACTIVITY_REF,
        targetRef: "competency:beta",
        blocking: false,
        origin: "WORKSPACE_OVERLAY",
        workspaceId: WORKSPACE_ID,
      },
      {
        edgeKey: "edge:part-of:alpha:core",
        edgeType: "PART_OF",
        sourceRef: "competency:alpha",
        targetRef: "domain:core",
        blocking: false,
        origin: "CANONICAL",
      },
      {
        edgeKey: "edge:part-of:beta:core",
        edgeType: "PART_OF",
        sourceRef: "competency:beta",
        targetRef: "domain:core",
        blocking: false,
        origin: "CANONICAL",
      },
      {
        edgeKey: "edge:part-of:extra:extra",
        edgeType: "PART_OF",
        sourceRef: "competency:extra",
        targetRef: "domain:extra",
        blocking: false,
        origin: "CANONICAL",
      },
      {
        edgeKey: "edge:prerequisite:alpha:beta",
        edgeType: "PREREQUISITE_OF",
        sourceRef: "competency:alpha",
        targetRef: "competency:beta",
        blocking: true,
        origin: "CANONICAL",
      },
      {
        edgeKey: "edge:related:beta:extra",
        edgeType: "RELATED_TO",
        sourceRef: "competency:beta",
        targetRef: "competency:extra",
        blocking: false,
        origin: "CANONICAL",
      },
    ],
    positions: [
      {
        nodeRef: "competency:beta",
        x: 125.5,
        y: -40,
        workspaceId: WORKSPACE_ID,
        readinessGoalId: "30000000-0000-4000-8000-000000000003",
        targetProfileVersionId: "40000000-0000-4000-8000-000000000004",
      },
      {
        nodeRef: "competency:extra",
        x: 900,
        y: 900,
        workspaceId: WORKSPACE_ID,
        readinessGoalId: "30000000-0000-4000-8000-000000000003",
        targetProfileVersionId: "40000000-0000-4000-8000-000000000004",
      },
    ],
    nodeCount: 6,
    edgeCount: 6,
  };
}

describe("live Explore structural materializer", () => {
  it("emits only the bounded target closure and selected activity without semantic guesses", () => {
    const projection = materializeLiveExploreStructure({
      source: broadSource(),
      targetContext: targetContext(),
      selectedActivityKey: ACTIVITY_REF,
    });

    expect(projection.calculationAvailability).toBe("NOT_MATERIALIZED");
    expect(projection.nodes.map(({ nodeId }) => nodeId)).toEqual([
      "node:activity:beta-lab",
      "node:competency:alpha",
      "node:competency:beta",
      "node:domain:core",
    ]);
    expect(projection.edges.map(({ edgeId }) => edgeId)).toEqual([
      "edge:activity-evidences:beta-lab:beta",
      "edge:part-of:alpha:core",
      "edge:part-of:beta:core",
      "edge:prerequisite:alpha:beta",
    ]);
    expect(projection.requirements.rules).toHaveLength(3);
    expect(
      projection.nodes.find(({ nodeId }) => nodeId === "node:competency:beta")?.requirementState,
    ).toEqual({ kind: "REQUIRED_UNEVALUATED", ruleIds: ["rule:floor", "rule:weighted"] });

    const forbiddenKeys = new Set([
      "achievementLevel",
      "attainment",
      "confidence",
      "estimate",
      "mastery",
      "readiness",
      "state",
      "unknownNodeIds",
    ]);
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      if (typeof value !== "object" || value === null) return;
      for (const [key, child] of Object.entries(value)) {
        expect(forbiddenKeys.has(key), `forbidden semantic key ${key}`).toBe(false);
        visit(child);
      }
    };
    visit(projection);
  });

  it("uses stable layout, Outline, fingerprint, and goal-scoped absolute overrides", () => {
    const input = {
      source: broadSource(),
      targetContext: targetContext(),
      selectedActivityKey: ACTIVITY_REF,
    };
    const first = materializeLiveExploreStructure(input);
    const second = materializeLiveExploreStructure(structuredClone(input));

    expect(second).toEqual(first);
    expect(first.layout.structuralFingerprint).toBe(computeExploreStructuralFingerprint(first));
    expect(first.outline.items).toHaveLength(first.nodes.length);
    expect(first.outline.rootItemIds).toEqual(["outline:node:domain:core"]);
    expect(
      first.outline.items.find(({ nodeId }) => nodeId === "node:activity:beta-lab")?.parentItemId,
    ).toBe("outline:node:competency:beta");
    expect(first.layout.positions.find(({ nodeId }) => nodeId === "node:competency:beta")).toEqual(
      expect.objectContaining({
        effective: { x: 125.5, y: -40 },
        source: "WORKSPACE_OVERRIDE",
        overrideRevision: "0",
        overrideWorkspaceId: WORKSPACE_ID,
      }),
    );
    expect(first.layout.positions.some(({ nodeId }) => nodeId.includes("extra"))).toBe(false);
  });

  it.each([
    [
      "workspace mismatch",
      (source: ExploreSourceV1, target: ExploreTargetContextV1) => {
        (target as { workspaceId: string }).workspaceId = "20000000-0000-4000-8000-000000000002";
      },
    ],
    [
      "profile mismatch",
      (source: ExploreSourceV1, target: ExploreTargetContextV1) => {
        (target.targetProfile as { profileVersionId: string }).profileVersionId =
          "50000000-0000-4000-8000-000000000005";
      },
    ],
    [
      "goal UUID mismatch",
      (source: ExploreSourceV1, target: ExploreTargetContextV1) => {
        (target.readinessGoal as { readinessGoalId: string }).readinessGoalId =
          "60000000-0000-4000-8000-000000000006";
      },
    ],
    [
      "goal key mismatch",
      (source: ExploreSourceV1, target: ExploreTargetContextV1) => {
        (target.readinessGoal as { readinessGoalKey: string }).readinessGoalKey = "goal:other-main";
      },
    ],
    [
      "profile key mismatch",
      (source: ExploreSourceV1, target: ExploreTargetContextV1) => {
        (target.targetProfile as { profileVersionKey: string }).profileVersionKey =
          "target:other-v1";
      },
    ],
    [
      "catalog mismatch",
      (source: ExploreSourceV1, target: ExploreTargetContextV1) => {
        (target.targetProfile as { catalogVersionKey: string }).catalogVersionKey =
          "catalog:other-v1";
      },
    ],
    [
      "roadmap mismatch",
      (source: ExploreSourceV1, target: ExploreTargetContextV1) => {
        (target.targetProfile as { roadmapVersionKey: string | null }).roadmapVersionKey = null;
      },
    ],
    [
      "overlay mismatch",
      (source: ExploreSourceV1, target: ExploreTargetContextV1) => {
        (target as { overlayVersion: string }).overlayVersion = "1";
      },
    ],
    [
      "target node mismatch",
      (source: ExploreSourceV1) => {
        (source.nodes[2] as { title: string }).title = "Different title";
      },
    ],
    [
      "foreign overlay",
      (source: ExploreSourceV1) => {
        (source.nodes[0] as { workspaceId: string }).workspaceId =
          "20000000-0000-4000-8000-000000000002";
      },
    ],
    [
      "dangling source edge",
      (source: ExploreSourceV1) => {
        (source.edges[1] as { targetRef: string }).targetRef = "domain:missing";
      },
    ],
  ] as const)("fails closed on %s", (_label, mutate) => {
    const source = broadSource();
    const target = targetContext();
    mutate(source, target);

    expect(() =>
      materializeLiveExploreStructure({
        source,
        targetContext: target,
        selectedActivityKey: ACTIVITY_REF,
      }),
    ).toThrow(LiveExploreStructureMaterializationError);
  });

  it("fails closed on missing, unexpected, or out-of-target selected activity state", () => {
    expect(() =>
      materializeLiveExploreStructure({
        source: broadSource(),
        targetContext: targetContext(),
      }),
    ).toThrow(LiveExploreStructureMaterializationError);

    expect(() =>
      materializeLiveExploreStructure({
        source: broadSource(),
        targetContext: targetContext(),
        selectedActivityKey: "activity:other",
      }),
    ).toThrow(LiveExploreStructureMaterializationError);

    const source = broadSource();
    (source.nodes[0] as { targetCompetencyRef: string }).targetCompetencyRef = "competency:extra";
    (source.edges[0] as { targetRef: string }).targetRef = "competency:extra";
    expect(() =>
      materializeLiveExploreStructure({
        source,
        targetContext: targetContext(),
        selectedActivityKey: ACTIVITY_REF,
      }),
    ).toThrow(LiveExploreStructureMaterializationError);
  });
});
