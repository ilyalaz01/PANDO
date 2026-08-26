// @vitest-environment node

import { describe, expect, it } from "vitest";

import { validateSchema } from "../../src/shared/contracts/schema-registry";
import {
  decodeExploreSourceV1,
  ExploreSourceContractError,
  validateExploreSourceV1,
} from "../../src/ui/explore/server/explore-source-v1";
import { readJson } from "./support";

interface ExploreSourceCase {
  readonly caseId: string;
  readonly path: string;
  readonly expectedSchemaValid: boolean;
  readonly expectedSemanticValid: boolean;
  readonly expectedViolations: readonly string[];
}

function violationCodes(result: ReturnType<typeof validateExploreSourceV1>): string[] {
  return result.valid ? [] : result.violations.map(({ code }) => code).sort();
}

describe("ExploreSourceV1 runtime contract", () => {
  const manifest = readJson("explore-source/v1/fixture-manifest.json");
  for (const testCase of manifest.cases as unknown as ExploreSourceCase[]) {
    it(`executes Explore source fixture ${testCase.caseId}`, () => {
      const source = readJson(`explore-source/v1/${testCase.path}`);
      expect(validateSchema("explore-source", source).valid).toBe(testCase.expectedSchemaValid);
      const result = validateExploreSourceV1(source);
      expect(result.valid).toBe(testCase.expectedSemanticValid);
      expect(violationCodes(result)).toEqual([...testCase.expectedViolations].sort());
    });
  }

  it("returns a minimal plain-data copy after validation", () => {
    const source = readJson("explore-source/v1/valid/explore-source-v1.personal.json");
    const decoded = decodeExploreSourceV1(source);

    expect(decoded).not.toBe(source);
    expect(decoded).toMatchObject({
      contract: { name: "ExploreSourceV1", version: "1.0.0" },
      nodeCount: 2,
      edgeCount: 1,
    });
    expect(Object.keys(decoded).sort()).toEqual(
      [
        "catalogVersionKey",
        "contract",
        "edgeCount",
        "edges",
        "nodeCount",
        "nodes",
        "overlayVersion",
        "positions",
        "readinessGoalId",
        "readinessGoalKey",
        "roadmapVersionKey",
        "targetProfileVersionKey",
        "targetProfileVersionId",
        "workspaceId",
      ].sort(),
    );
  });

  it("fails closed without retaining a malicious private note value", () => {
    const source = readJson("explore-source/v1/malicious/explore-source-v1.note-injection.json");

    expect(() => decodeExploreSourceV1(source)).toThrow(ExploreSourceContractError);
    try {
      decodeExploreSourceV1(source);
    } catch (error) {
      expect(error).toBeInstanceOf(ExploreSourceContractError);
      expect(JSON.stringify(error)).not.toContain("rain-forest-42");
    }
  });

  it("requires exactly one evidence edge for a selected activity", () => {
    const source = readJson(
      "explore-source/v1/invalid/explore-source-v1.activity-without-evidence.json",
    );
    if (!Array.isArray(source.edges)) throw new Error("Fixture edges must be an array");
    source.edges = [
      {
        edgeKey: "edge:activity-evidences:linux-lab:a",
        edgeType: "ACTIVITY_EVIDENCES",
        sourceRef: "activity:linux-lab",
        targetRef: "competency:linux-log-triage",
        blocking: false,
        origin: "WORKSPACE_OVERLAY",
        workspaceId: String(source.workspaceId),
      },
      {
        edgeKey: "edge:activity-evidences:linux-lab:b",
        edgeType: "ACTIVITY_EVIDENCES",
        sourceRef: "activity:linux-lab",
        targetRef: "competency:linux-log-triage",
        blocking: false,
        origin: "WORKSPACE_OVERLAY",
        workspaceId: String(source.workspaceId),
      },
      ...source.edges,
    ];
    source.edgeCount = 3;

    expect(violationCodes(validateExploreSourceV1(source))).toEqual([
      "EXPLORE_SOURCE_ACTIVITY_EVIDENCE_CARDINALITY",
    ]);
  });

  it.each(["readinessGoalId", "targetProfileVersionId"] as const)(
    "rejects an independently foreign position %s",
    (field) => {
      const source = readJson("explore-source/v1/valid/explore-source-v1.personal.json");
      (source.positions as unknown as Record<string, unknown>[])[0]![field] =
        "90000000-0000-4000-8000-000000000009";

      expect(violationCodes(validateExploreSourceV1(source))).toEqual([
        "EXPLORE_SOURCE_FOREIGN_POSITION_SCOPE",
      ]);
    },
  );
});
