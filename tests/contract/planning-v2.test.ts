// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  calculatePlan,
  calculatePlanV2,
} from "../../src/modules/planning/application/calculate-plan";
import { PLANNING_POLICY_V0_1 } from "../../src/modules/planning/domain/planning-policy-v0.1";
import { PLANNING_POLICY_V0_2 } from "../../src/modules/planning/domain/planning-policy-v0.2";
import type {
  CalculatePlanInput,
  CalculatePlanInputV2,
} from "../../src/modules/planning/domain/planning-types";
import {
  planSnapshotSemanticViolations,
  planningInputFingerprint,
  planningInputSemanticViolations,
} from "../../src/shared/contracts/planning-semantics";
import { validateSchema } from "../../src/shared/contracts/schema-registry";
import planningGolden from "../fixtures/calculation-engines/v0.1/planning.golden.json";
import planningGoldenV2 from "../fixtures/calculation-engines/v0.2/planning.golden.json";

function inputV2(cadencePerWeek = 3, completedCadenceSessionsThisWeek = 1): CalculatePlanInputV2 {
  const inputV1 = structuredClone(planningGolden.input) as unknown as CalculatePlanInput;
  const input: CalculatePlanInputV2 = {
    ...inputV1,
    completedWorkPolicyVersion: "planning-completed-work/0.2",
    growthPlan:
      inputV1.growthPlan === null
        ? null
        : {
            ...inputV1.growthPlan,
            tracks: inputV1.growthPlan.tracks.map((track) => ({
              ...track,
              cadencePerWeek,
              completedCadenceSessionsThisWeek,
            })),
          },
  };
  return { ...input, inputFingerprint: planningInputFingerprint(input) };
}

describe("Planning calculation V1/V2 contract separation", () => {
  it("matches the checked-in V2 golden without changing the V1 golden", () => {
    const fixture = planningGoldenV2 as unknown as {
      input: CalculatePlanInputV2;
      expected: unknown;
    };
    expect(calculatePlanV2(fixture.input, PLANNING_POLICY_V0_2)).toEqual(fixture.expected);
    expect(validateSchema("planning-input-v2", fixture.input).valid).toBe(true);
    expect(validateSchema("plan-snapshot-v2", fixture.expected).valid).toBe(true);
    expect(validateSchema("planning-input-v1", planningGolden.input).valid).toBe(true);
    expect(validateSchema("plan-snapshot-v1", planningGolden.expected).valid).toBe(true);
  });

  it("keeps the historical V1 golden executable and rejects cross-version inputs", () => {
    const v1 = planningGolden.input as unknown as CalculatePlanInput;
    const v2 = inputV2();

    expect(calculatePlan(v1, PLANNING_POLICY_V0_1)).toEqual(planningGolden.expected);
    expect(validateSchema("planning-input-v1", v1).valid).toBe(true);
    expect(validateSchema("planning-input-v2", v1).valid).toBe(false);
    expect(validateSchema("planning-input-v2", v2).valid).toBe(true);
    expect(validateSchema("planning-input-v1", v2).valid).toBe(false);
    expect(planningInputSemanticViolations(v2)).toEqual([]);

    expect(() => calculatePlan(v1, PLANNING_POLICY_V0_2)).toThrow(/planning-policy\/0\.1/u);
    const relabeledV1 = {
      ...v1,
      completedWorkPolicyVersion: "planning-completed-work/0.2",
    };
    const fingerprinted = {
      ...relabeledV1,
      inputFingerprint: planningInputFingerprint(relabeledV1),
    };
    expect(() => calculatePlan(fingerprinted as CalculatePlanInput, PLANNING_POLICY_V0_1)).toThrow(
      /planning-completed-work\/0\.1/u,
    );
  });

  it.each([
    { cadence: 0, completed: 0 },
    { cadence: 100, completed: 500 },
  ])("accepts the V2 cadence boundaries %#", ({ cadence, completed }) => {
    const input = inputV2(cadence, completed);
    const result = calculatePlanV2(input, PLANNING_POLICY_V0_2);

    expect(validateSchema("planning-input-v2", input).valid).toBe(true);
    expect(validateSchema("plan-snapshot-v2", result).valid).toBe(true);
    expect(validateSchema("plan-snapshot-v1", result).valid).toBe(false);
    expect(planSnapshotSemanticViolations(result)).toEqual([]);
  });

  it("rejects missing, out-of-range, and malicious V2 cadence input", () => {
    const missing = structuredClone(inputV2()) as unknown as {
      growthPlan: { tracks: Record<string, unknown>[] };
    };
    delete missing.growthPlan.tracks[0]!.cadencePerWeek;
    expect(validateSchema("planning-input-v2", missing).valid).toBe(false);

    const highTarget = structuredClone(inputV2()) as unknown as {
      growthPlan: { tracks: { cadencePerWeek: number }[] };
    };
    highTarget.growthPlan.tracks[0]!.cadencePerWeek = 101;
    expect(validateSchema("planning-input-v2", highTarget).valid).toBe(false);

    const highProgress = structuredClone(inputV2()) as unknown as {
      growthPlan: { tracks: { completedCadenceSessionsThisWeek: number }[] };
    };
    highProgress.growthPlan.tracks[0]!.completedCadenceSessionsThisWeek = 501;
    expect(validateSchema("planning-input-v2", highProgress).valid).toBe(false);

    const injected = structuredClone(inputV2()) as unknown as {
      growthPlan: { tracks: Record<string, unknown>[] };
    };
    injected.growthPlan.tracks[0]!.evidenceBodies = ["secret"];
    expect(validateSchema("planning-input-v2", injected).valid).toBe(false);
  });

  it("rejects mixed result tuples and incoherent cadence reason references", () => {
    const result = calculatePlanV2(inputV2(), PLANNING_POLICY_V0_2);
    const mixed = { ...result, policyVersion: "planning-policy/0.1" };
    expect(validateSchema("plan-snapshot-v2", mixed).valid).toBe(false);

    const actionIndex = result.actions.findIndex(({ reasonRefs }) =>
      reasonRefs.some(({ factorCode }) => factorCode === "TRACK_CADENCE_DEFICIT"),
    );
    expect(actionIndex).toBeGreaterThanOrEqual(0);
    const incoherent = structuredClone(result);
    const cadenceRef = incoherent.actions[actionIndex]!.reasonRefs.find(
      ({ factorCode }) => factorCode === "TRACK_CADENCE_DEFICIT",
    );
    if (cadenceRef === undefined || cadenceRef.kind !== "TRACK") {
      throw new Error("fixture requires a cadence Track reason");
    }
    (cadenceRef as { trackId: string }).trackId = "11000000-0000-4000-8000-000000000099";
    expect(validateSchema("plan-snapshot-v2", incoherent).valid).toBe(true);
    expect(planSnapshotSemanticViolations(incoherent)).toContain(
      `PLAN_SNAPSHOT_ACTION_${actionIndex}_REASON_REF_COHERENCE`,
    );
  });
});
