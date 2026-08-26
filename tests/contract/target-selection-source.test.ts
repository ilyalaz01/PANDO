// @vitest-environment node

import { describe, expect, it } from "vitest";

import { validateSchema } from "../../src/shared/contracts/schema-registry";
import {
  decodeTargetSelectionSourceV1,
  TargetSelectionContractError,
  validateTargetSelectionSourceV1,
} from "../../src/ui/start/server/target-selection-source-v1";
import { readJson } from "./support";

interface TargetSelectionCase {
  readonly caseId: string;
  readonly path: string;
  readonly expectedSchemaValid: boolean;
  readonly expectedSemanticValid: boolean;
  readonly expectedViolations: readonly string[];
}

function violationCodes(result: ReturnType<typeof validateTargetSelectionSourceV1>): string[] {
  return result.valid ? [] : result.violations.map(({ code }) => code).sort();
}

describe("TargetSelectionSourceV1 runtime contract", () => {
  const manifest = readJson("target-selection/v1/fixture-manifest.json");
  for (const testCase of manifest.cases as unknown as TargetSelectionCase[]) {
    it(`executes target-selection fixture ${testCase.caseId}`, () => {
      const source = readJson(`target-selection/v1/${testCase.path}`);
      expect(validateSchema("target-selection-source", source).valid).toBe(
        testCase.expectedSchemaValid,
      );
      const result = validateTargetSelectionSourceV1(source);
      expect(result.valid).toBe(testCase.expectedSemanticValid);
      expect(violationCodes(result)).toEqual([...testCase.expectedViolations].sort());
    });
  }

  it("returns a minimal plain-data copy after validation", () => {
    const source = readJson("target-selection/v1/valid/target-selection-source-v1.seeded.json");
    const decoded = decodeTargetSelectionSourceV1(source);

    expect(decoded).not.toBe(source);
    expect(decoded.contract).toEqual({ name: "TargetSelectionSourceV1", version: "1.0.0" });
    expect(decoded.workspace?.displayName).toBe("Personal workspace");
    expect(decoded.profiles).toHaveLength(1);
    expect(decoded.readinessGoals).toHaveLength(1);
  });

  it("fails closed without retaining an injected private value", () => {
    const source = readJson(
      "target-selection/v1/malicious/target-selection-source-v1.private-note.json",
    );

    expect(() => decodeTargetSelectionSourceV1(source)).toThrow(TargetSelectionContractError);
    try {
      decodeTargetSelectionSourceV1(source);
    } catch (error) {
      expect(error).toBeInstanceOf(TargetSelectionContractError);
      expect(JSON.stringify(error)).not.toContain("never-return-this-private-value");
    }
  });

  it("rejects unstable profile and goal ordering", () => {
    const source = readJson("target-selection/v1/valid/target-selection-source-v1.seeded.json");
    const profile = structuredClone((source.profiles as unknown[])[0]);
    const goal = structuredClone((source.readinessGoals as unknown[])[0]);
    if (typeof profile !== "object" || profile === null) throw new Error("profile fixture missing");
    if (typeof goal !== "object" || goal === null) throw new Error("goal fixture missing");
    source.profiles = [
      { ...profile, profileVersionKey: "target:z-profile" },
      { ...profile, profileVersionKey: "target:a-profile" },
    ];
    source.readinessGoals = [
      { ...goal, readinessGoalKey: "goal:z-goal" },
      { ...goal, readinessGoalKey: "goal:a-goal" },
    ];

    expect(violationCodes(validateTargetSelectionSourceV1(source))).toEqual([
      "TARGET_SELECTION_GOALS_NOT_SORTED",
      "TARGET_SELECTION_PROFILES_NOT_SORTED",
    ]);
  });
});
