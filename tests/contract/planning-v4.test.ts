// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  calculatePlanV3,
  calculatePlanV4,
} from "../../src/modules/planning/application/calculate-plan";
import { PLANNING_POLICY_V0_3 } from "../../src/modules/planning/domain/planning-policy-v0.3";
import { PLANNING_POLICY_V0_4 } from "../../src/modules/planning/domain/planning-policy-v0.4";
import type {
  CalculatePlanInputV3,
  CalculatePlanInputV4,
} from "../../src/modules/planning/domain/planning-types";
import {
  planSnapshotSemanticViolations,
  planningInputFingerprint,
  planningInputSemanticViolations,
} from "../../src/shared/contracts/planning-semantics";
import { validateSchema } from "../../src/shared/contracts/schema-registry";
import planningGoldenV3 from "../fixtures/calculation-engines/v0.3/planning.golden.json";
import planningGoldenV4 from "../fixtures/calculation-engines/v0.4/planning.golden.json";

const fixtureV4 = planningGoldenV4 as unknown as {
  readonly input: CalculatePlanInputV4;
  readonly expected: unknown;
};

function v4Input(
  mutate?: (input: CalculatePlanInputV4) => CalculatePlanInputV4,
): CalculatePlanInputV4 {
  const base = structuredClone(fixtureV4.input);
  const changed = mutate?.(base) ?? base;
  return { ...changed, inputFingerprint: planningInputFingerprint(changed) };
}

describe("Planning calculation V4 contract separation", () => {
  it("matches the checked-in V4 golden without changing the V3 golden", () => {
    expect(calculatePlanV4(fixtureV4.input, PLANNING_POLICY_V0_4)).toEqual(fixtureV4.expected);
    expect(validateSchema("planning-input-v4", fixtureV4.input).valid).toBe(true);
    expect(validateSchema("plan-snapshot-v4", fixtureV4.expected).valid).toBe(true);
    expect(validateSchema("planning-input-v3", planningGoldenV3.input).valid).toBe(true);
    expect(validateSchema("plan-snapshot-v3", planningGoldenV3.expected).valid).toBe(true);
  });

  it("rejects cross-version inputs in both directions", () => {
    const v3 = planningGoldenV3.input as unknown as CalculatePlanInputV3;
    expect(calculatePlanV3(v3, PLANNING_POLICY_V0_3)).toEqual(planningGoldenV3.expected);
    expect(validateSchema("planning-input-v4", v3).valid).toBe(false);
    expect(validateSchema("planning-input-v3", fixtureV4.input).valid).toBe(false);
    expect(planningInputSemanticViolations(fixtureV4.input)).toEqual([]);

    expect(() =>
      calculatePlanV4(fixtureV4.input, {
        ...PLANNING_POLICY_V0_4,
        version: "planning-policy/0.3" as "planning-policy/0.4",
      }),
    ).toThrow(/planning-policy\/0\.4/u);
  });

  it("requires a track's allocationOverride to be null or a well-formed object", () => {
    const malformed = structuredClone(fixtureV4.input) as unknown as {
      growthPlan: { tracks: Record<string, unknown>[] };
    };
    malformed.growthPlan.tracks[0]!.allocationOverride = { priorityOverride: 200 };
    expect(validateSchema("planning-input-v4", malformed).valid).toBe(false);
  });

  it("admits a campaign whose deadline already passed, unlike every earlier version", () => {
    const passed = v4Input((current) => ({
      ...current,
      campaign: current.campaign
        ? { ...current.campaign, deadlineAt: "2020-01-01T00:00:00Z" }
        : null,
    }));
    const result = calculatePlanV4(passed, PLANNING_POLICY_V0_4);
    expect(result.warningCodes).toContain("CAMPAIGN_DEADLINE_PASSED");
    expect(validateSchema("plan-snapshot-v4", result).valid).toBe(true);
    expect(planSnapshotSemanticViolations(result)).toEqual([]);
  });
});
