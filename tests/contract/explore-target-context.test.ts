// @vitest-environment node

import { describe, expect, it } from "vitest";

import { validateSchema } from "../../src/shared/contracts/schema-registry";
import {
  decodeExploreTargetContextV1,
  ExploreTargetContextContractError,
  validateExploreTargetContextV1,
} from "../../src/ui/explore/server/explore-target-context-v1";
import { readJson } from "./support";

interface ExploreTargetContextCase {
  readonly caseId: string;
  readonly path: string;
  readonly expectedSchemaValid: boolean;
  readonly expectedSemanticValid: boolean;
  readonly expectedViolations: readonly string[];
}

function violationCodes(value: unknown): string[] {
  const result = validateExploreTargetContextV1(value);
  return result.valid ? [] : result.violations.map(({ code }) => code).sort();
}

describe("ExploreTargetContextV1 runtime contract", () => {
  const manifest = readJson("explore-target-context/v1/fixture-manifest.json");
  for (const testCase of manifest.cases as unknown as ExploreTargetContextCase[]) {
    it(`executes target-context fixture ${testCase.caseId}`, () => {
      const context = readJson(`explore-target-context/v1/${testCase.path}`);
      expect(validateSchema("explore-target-context", context).valid).toBe(
        testCase.expectedSchemaValid,
      );
      const result = validateExploreTargetContextV1(context);
      expect(result.valid).toBe(testCase.expectedSemanticValid);
      expect(violationCodes(context)).toEqual([...testCase.expectedViolations].sort());
    });
  }

  it("returns a minimal plain-data copy after complete validation", () => {
    const source = readJson(
      "explore-target-context/v1/valid/explore-target-context-v1.canonical.json",
    );
    const decoded = decodeExploreTargetContextV1(source);

    expect(decoded).not.toBe(source);
    expect(decoded.contract).toEqual({ name: "ExploreTargetContextV1", version: "1.0.0" });
    expect(decoded.targetProfile).toMatchObject({
      rootRuleKey: "rule:root",
      catalogVersionKey: "catalog:seed-v1",
    });
    expect(decoded.scope.canonicalNodes).toHaveLength(3);
    expect(Object.keys(decoded).sort()).toEqual(
      [
        "contract",
        "overlayVersion",
        "readinessGoal",
        "requirementRules",
        "scope",
        "targetProfile",
        "workspaceId",
      ].sort(),
    );
  });

  it("rejects a rule cycle and unreachable rules even when the JSON shape is valid", () => {
    const source = readJson(
      "explore-target-context/v1/valid/explore-target-context-v1.canonical.json",
    );
    const rules = source.requirementRules as unknown as Record<string, unknown>[];
    const floor = rules[0]!;
    floor.ruleType = "ALL";
    floor.members = [{ memberType: "RULE", ruleKey: "rule:root", weight: null }];

    expect(violationCodes(source)).toEqual(["EXPLORE_TARGET_RULE_CYCLE"]);
  });

  it("rejects invalid rule parameters before a readiness engine can observe them", () => {
    const source = readJson(
      "explore-target-context/v1/valid/explore-target-context-v1.canonical.json",
    );
    const rules = source.requirementRules as unknown as Record<string, unknown>[];
    const weighted = rules[2]!;
    const members = weighted.members as Record<string, unknown>[];
    members[0]!.weight = null;

    expect(violationCodes(source)).toEqual(["EXPLORE_TARGET_RULE_PARAMETER_SHAPE"]);
  });

  it("rejects a root weighted threshold that disagrees with the target profile", () => {
    const source = readJson(
      "explore-target-context/v1/valid/explore-target-context-v1.canonical.json",
    );
    const rules = source.requirementRules as unknown as Record<string, unknown>[];
    const root = rules[1]!;
    root.ruleType = "WEIGHTED_THRESHOLD";
    root.threshold = 0.9;
    for (const member of root.members as Record<string, unknown>[]) member.weight = 1;

    expect(validateSchema("explore-target-context", source).valid).toBe(true);
    expect(violationCodes(source)).toEqual(["EXPLORE_TARGET_ROOT_THRESHOLD_MISMATCH"]);
  });

  it("rejects a canonical rule member whose declared type disagrees with Catalog", () => {
    const source = readJson(
      "explore-target-context/v1/valid/explore-target-context-v1.canonical.json",
    );
    const rules = source.requirementRules as unknown as Record<string, unknown>[];
    const floorMembers = rules[0]!.members as Record<string, unknown>[];
    floorMembers[0]!.nodeType = "DOMAIN";

    expect(violationCodes(source)).toEqual(["EXPLORE_TARGET_REQUIREMENT_NODE_TYPE_MISMATCH"]);
  });

  it("rejects a canonical node whose stable-ref prefix disagrees with its type", () => {
    const source = readJson(
      "explore-target-context/v1/valid/explore-target-context-v1.canonical.json",
    );
    const scope = source.scope as unknown as Record<string, unknown>;
    const canonicalNodes = scope.canonicalNodes as Record<string, unknown>[];
    canonicalNodes[0]!.nodeType = "DOMAIN";
    canonicalNodes[0]!.domainRef = null;

    expect(validateSchema("explore-target-context", source).valid).toBe(true);
    expect(violationCodes(source)).toEqual(["EXPLORE_TARGET_CANONICAL_NODE_TYPE_MISMATCH"]);
  });

  it("rejects a stable node identity shared by Catalog and Workspace Overlay", () => {
    const source = readJson(
      "explore-target-context/v1/valid/explore-target-context-v1.canonical.json",
    );
    const rules = source.requirementRules as unknown as Record<string, unknown>[];
    const weightedMembers = rules[2]!.members as Record<string, unknown>[];
    weightedMembers.push({
      memberType: "NODE",
      nodeScope: "workspace_overlay",
      nodeType: "COMPETENCY",
      nodeRef: "competency:beta",
      dimension: "RECALL",
      requiredLevel: "VERIFIED",
      weight: 1,
    });
    const scope = source.scope as unknown as Record<string, unknown>;
    scope.requiredOverlayNodeRefs = ["competency:beta"];
    scope.requiredOverlayNodes = [
      {
        nodeRef: "competency:beta",
        nodeType: "COMPETENCY",
        title: "Conflicting personal beta",
        domainRef: "domain:core",
        workspaceId: source.workspaceId,
      },
    ];

    expect(validateSchema("explore-target-context", source).valid).toBe(true);
    expect(violationCodes(source)).toEqual(["EXPLORE_TARGET_NODE_IDENTITY_COLLISION"]);
  });

  it("rejects an unrelated node smuggled into the prerequisite closure", () => {
    const source = readJson(
      "explore-target-context/v1/valid/explore-target-context-v1.canonical.json",
    );
    const scope = source.scope as unknown as Record<string, unknown>;
    scope.prerequisiteClosureNodeRefs = ["competency:alpha", "competency:gamma"];
    const canonicalNodes = scope.canonicalNodes as Record<string, unknown>[];
    canonicalNodes.splice(2, 0, {
      nodeRef: "competency:gamma",
      nodeType: "COMPETENCY",
      title: "Gamma unrelated capability",
      description: "A valid node that is not an ancestor of a target seed.",
      domainRef: "domain:core",
    });

    expect(validateSchema("explore-target-context", source).valid).toBe(true);
    expect(violationCodes(source)).toEqual(["EXPLORE_TARGET_PREREQUISITE_CLOSURE_MISMATCH"]);
  });

  it("fails closed without retaining an injected private note", () => {
    const source = readJson(
      "explore-target-context/v1/valid/explore-target-context-v1.canonical.json",
    );
    (source as Record<string, unknown>).privateNote = "rain-forest-42";

    expect(() => decodeExploreTargetContextV1(source)).toThrow(ExploreTargetContextContractError);
    try {
      decodeExploreTargetContextV1(source);
    } catch (error) {
      expect(error).toBeInstanceOf(ExploreTargetContextContractError);
      expect(JSON.stringify(error)).not.toContain("rain-forest-42");
    }
  });
});
