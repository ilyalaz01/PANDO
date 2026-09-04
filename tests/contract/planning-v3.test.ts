// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  calculatePlan,
  calculatePlanV2,
  calculatePlanV3,
} from "../../src/modules/planning/application/calculate-plan";
import { PLANNING_POLICY_V0_1 } from "../../src/modules/planning/domain/planning-policy-v0.1";
import { PLANNING_POLICY_V0_2 } from "../../src/modules/planning/domain/planning-policy-v0.2";
import { PLANNING_POLICY_V0_3 } from "../../src/modules/planning/domain/planning-policy-v0.3";
import type {
  CalculatePlanInput,
  CalculatePlanInputV2,
  CalculatePlanInputV3,
} from "../../src/modules/planning/domain/planning-types";
import {
  planSnapshotSemanticViolations,
  planningInputFingerprint,
  planningInputSemanticViolations,
} from "../../src/shared/contracts/planning-semantics";
import { validateSchema } from "../../src/shared/contracts/schema-registry";
import planningGolden from "../fixtures/calculation-engines/v0.1/planning.golden.json";
import planningGoldenV2 from "../fixtures/calculation-engines/v0.2/planning.golden.json";
import planningGoldenV3 from "../fixtures/calculation-engines/v0.3/planning.golden.json";

const fixtureV3 = planningGoldenV3 as unknown as {
  readonly input: CalculatePlanInputV3;
  readonly expected: unknown;
};

function v3Input(
  mutate?: (input: CalculatePlanInputV3) => CalculatePlanInputV3,
): CalculatePlanInputV3 {
  const base = structuredClone(fixtureV3.input);
  const changed = mutate?.(base) ?? base;
  return { ...changed, inputFingerprint: planningInputFingerprint(changed) };
}

describe("Planning calculation V3 contract separation", () => {
  it("matches the checked-in V3 golden without changing the V1/V2 goldens", () => {
    expect(calculatePlanV3(fixtureV3.input, PLANNING_POLICY_V0_3)).toEqual(fixtureV3.expected);
    expect(validateSchema("planning-input-v3", fixtureV3.input).valid).toBe(true);
    expect(validateSchema("plan-snapshot-v3", fixtureV3.expected).valid).toBe(true);
    expect(validateSchema("planning-input-v1", planningGolden.input).valid).toBe(true);
    expect(validateSchema("plan-snapshot-v1", planningGolden.expected).valid).toBe(true);
    expect(validateSchema("planning-input-v2", planningGoldenV2.input).valid).toBe(true);
    expect(validateSchema("plan-snapshot-v2", planningGoldenV2.expected).valid).toBe(true);
  });

  it("keeps the historical V1 and V2 goldens executable and rejects cross-version inputs", () => {
    const v1 = planningGolden.input as unknown as CalculatePlanInput;
    const v2 = planningGoldenV2.input as unknown as CalculatePlanInputV2;

    expect(calculatePlan(v1, PLANNING_POLICY_V0_1)).toEqual(planningGolden.expected);
    expect(calculatePlanV2(v2, PLANNING_POLICY_V0_2)).toEqual(planningGoldenV2.expected);
    expect(validateSchema("planning-input-v3", v1).valid).toBe(false);
    expect(validateSchema("planning-input-v3", v2).valid).toBe(false);
    expect(validateSchema("planning-input-v1", fixtureV3.input).valid).toBe(false);
    expect(validateSchema("planning-input-v2", fixtureV3.input).valid).toBe(false);
    expect(planningInputSemanticViolations(fixtureV3.input)).toEqual([]);

    expect(() =>
      calculatePlanV3(fixtureV3.input, {
        ...PLANNING_POLICY_V0_3,
        version: "planning-policy/0.2" as "planning-policy/0.3",
      }),
    ).toThrow(/planning-policy\/0\.3/u);
  });

  it("when availability never limits capacity, V3 output equals V2's output", () => {
    expect(fixtureV3.expected).toMatchObject({
      engineVersion: "planner-engine/0.3.0",
      policyVersion: "planning-policy/0.3",
      // Same scored actions as the V2 golden that shares the same underlying default capacity.
      actions: planningGoldenV2.expected.actions,
    });
    expect(planSnapshotSemanticViolations(fixtureV3.expected)).toEqual([]);
  });

  it("rations protected minutes deterministically when availability caps effective capacity", () => {
    // Restrict every day to 40 minutes: effective = min(600, 280) = 280, which is below the sum
    // of the two active tracks' protected minimums (180 + 120 = 300).
    const input = v3Input((current) => ({
      ...current,
      growthPlan: current.growthPlan
        ? {
            ...current.growthPlan,
            effectiveWeeklyCapacityMinutes: 280,
            dailyCaps: current.growthPlan.dailyCaps.map((cap) => ({ ...cap, capMinutes: 40 })),
          }
        : null,
    }));
    const result = calculatePlanV3(input, PLANNING_POLICY_V0_3);

    expect(result.capacity).toMatchObject({
      defaultWeeklyCapacityMinutes: 600,
      effectiveWeeklyCapacityMinutes: 280,
      remainingMinutesThisWeek: 100,
    });
    expect(result.warningCodes).toContain("PROTECTED_MINIMUM_LIMITED_BY_AVAILABILITY");
    expect(validateSchema("plan-snapshot-v3", result).valid).toBe(true);
    expect(planSnapshotSemanticViolations(result)).toEqual([]);
  });

  it("fails closed when the supplied effective capacity does not match the day-cap composition", () => {
    const input = v3Input((current) => ({
      ...current,
      growthPlan: current.growthPlan
        ? { ...current.growthPlan, effectiveWeeklyCapacityMinutes: 599 }
        : null,
    }));
    expect(() => calculatePlanV3(input, PLANNING_POLICY_V0_3)).toThrow(/day-cap composition/u);
  });

  it("rejects a malformed, wrong-count, or non-consecutive dailyCaps array", () => {
    const wrongCount = structuredClone(fixtureV3.input) as unknown as {
      growthPlan: { dailyCaps: unknown[] };
    };
    wrongCount.growthPlan.dailyCaps.pop();
    expect(validateSchema("planning-input-v3", wrongCount).valid).toBe(false);

    const outOfRange = structuredClone(fixtureV3.input) as unknown as {
      growthPlan: { dailyCaps: { capMinutes: number }[] };
    };
    outOfRange.growthPlan.dailyCaps[0]!.capMinutes = 1441;
    expect(validateSchema("planning-input-v3", outOfRange).valid).toBe(false);

    const injected = structuredClone(fixtureV3.input) as unknown as {
      growthPlan: { dailyCaps: Record<string, unknown>[] };
    };
    injected.growthPlan.dailyCaps[0]!.evidenceBodies = ["secret"];
    expect(validateSchema("planning-input-v3", injected).valid).toBe(false);

    const nonConsecutive = v3Input((current) => ({
      ...current,
      growthPlan: current.growthPlan
        ? {
            ...current.growthPlan,
            dailyCaps: current.growthPlan.dailyCaps.map((cap, index) =>
              index === 3 ? { ...cap, date: "2099-01-01" } : cap,
            ),
          }
        : null,
    }));
    expect(() => calculatePlanV3(nonConsecutive, PLANNING_POLICY_V0_3)).toThrow(
      /consecutive ascending/u,
    );
  });
});
