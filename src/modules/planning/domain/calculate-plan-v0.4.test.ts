import { describe, expect, it } from "vitest";

import planningGoldenV4 from "../../../../tests/fixtures/calculation-engines/v0.4/planning.golden.json";
import {
  planSnapshotSemanticViolations,
  planningInputFingerprint,
} from "../../../shared/contracts/planning-semantics";
import { calculatePlanV3, calculatePlanV4 } from "../application/calculate-plan";
import { calculateVerifiedPlanV4 } from "./calculate-plan";
import { PLANNING_POLICY_V0_3 } from "./planning-policy-v0.3";
import { PLANNING_POLICY_V0_4 } from "./planning-policy-v0.4";
import {
  PlanningInputError,
  type CalculatePlanInputV3,
  type CalculatePlanInputV4,
  type VerifiedCalculatePlanInputV4,
} from "./planning-types";

const fixture = planningGoldenV4 as unknown as {
  readonly input: CalculatePlanInputV4;
  readonly expected: unknown;
};

function v4Input(
  mutate?: (input: CalculatePlanInputV4) => CalculatePlanInputV4,
): CalculatePlanInputV4 {
  const base = structuredClone(fixture.input);
  const changed = mutate?.(base) ?? base;
  return { ...changed, inputFingerprint: planningInputFingerprint(changed) };
}

function calculate(mutate?: (input: CalculatePlanInputV4) => CalculatePlanInputV4) {
  return calculatePlanV4(v4Input(mutate), PLANNING_POLICY_V0_4);
}

describe("planner-engine/0.4.0 campaign overlays and coordination", () => {
  it("matches the checked-in V4 golden and passes semantic validation", () => {
    const result = calculatePlanV4(fixture.input, PLANNING_POLICY_V0_4);
    expect(result).toEqual(fixture.expected);
    expect(result.engineVersion).toBe("planner-engine/0.4.0");
    expect(result.policyVersion).toBe("planning-policy/0.4");
    expect(planSnapshotSemanticViolations(result)).toEqual([]);
  });

  it("equals V3's output for the same unmodified fixture, aside from version stamps", () => {
    const source = structuredClone(fixture.input);
    const v3Input: CalculatePlanInputV3 = {
      ...source,
      growthPlan: source.growthPlan
        ? {
            ...source.growthPlan,
            tracks: source.growthPlan.tracks.map((track) => {
              const { allocationOverride, ...withoutOverride } = track;
              void allocationOverride;
              return withoutOverride;
            }),
          }
        : null,
    };
    const fingerprinted = { ...v3Input, inputFingerprint: planningInputFingerprint(v3Input) };
    const v3Result = calculatePlanV3(fingerprinted, PLANNING_POLICY_V0_3);
    const v4Result = calculatePlanV4(fixture.input, PLANNING_POLICY_V0_4);
    expect(v4Result.actions).toEqual(v3Result.actions);
    expect(v4Result.capacity).toEqual(v3Result.capacity);
    expect(v4Result.recommendationState).toBe(v3Result.recommendationState);
  });

  it("ranks a campaign candidate while the Growth Plan is paused, reporting BASE_PLAN_PAUSED", () => {
    const result = calculate((input) => ({
      ...input,
      growthPlan: input.growthPlan ? { ...input.growthPlan, lifecycle: "PAUSED" } : null,
    }));

    expect(result.recommendationState).toBe("CURRENT");
    expect(result.warningCodes).toContain("BASE_PLAN_PAUSED");
    const networkDebug = result.actions.find((a) => a.candidateKey === "candidate:network-debug");
    expect(networkDebug).toMatchObject({
      trackId: "11000000-0000-4000-8000-000000000001",
      sourceSignals: ["CAMPAIGN"],
    });
    expect(networkDebug?.scoreFactors.map((f) => f.code)).toEqual(
      expect.arrayContaining(["CAMPAIGN_SOURCE", "CAMPAIGN_DEADLINE"]),
    );
    expect(networkDebug?.scoreFactors.map((f) => f.code)).not.toEqual(
      expect.arrayContaining(["TRACK_PRIORITY", "TRACK_PROTECTED_MINIMUM"]),
    );
    // A pure GROWTH_PLAN candidate has no eligible source left while the plan is paused.
    expect(result.actions.map((a) => a.candidateKey)).not.toContain("candidate:algorithm-drill");
  });

  it("refuses a campaign with no current Growth Plan at all", () => {
    expect(() => calculate((input) => ({ ...input, growthPlan: null }))).toThrow(
      /current Growth Plan/u,
    );
  });

  it("clamps a passed deadline to zero days, warns, and stops capping validity", () => {
    const result = calculate((input) => ({
      ...input,
      campaign: input.campaign ? { ...input.campaign, deadlineAt: "2026-08-25T12:00:00Z" } : null,
    }));

    expect(result.warningCodes).toContain("CAMPAIGN_DEADLINE_PASSED");
    const networkDebug = result.actions.find((a) => a.candidateKey === "candidate:network-debug");
    expect(networkDebug?.scoreFactors).toContainEqual({
      code: "CAMPAIGN_DEADLINE",
      points: PLANNING_POLICY_V0_4.campaignDeadlinePoints.within7Days,
    });
    const campaignRef = networkDebug?.reasonRefs.find((ref) => ref.kind === "CAMPAIGN");
    expect(campaignRef).toMatchObject({ daysUntilDeadline: 0 });
    expect(planSnapshotSemanticViolations(result)).toEqual([]);
  });

  it("retains Track provenance for a campaign candidate whose parent Track is not ACTIVE", () => {
    const result = calculate((input) => ({
      ...input,
      growthPlan: input.growthPlan
        ? {
            ...input.growthPlan,
            tracks: input.growthPlan.tracks.map((track) =>
              track.trackId === "11000000-0000-4000-8000-000000000001"
                ? { ...track, lifecycle: "PAUSED" as const }
                : track,
            ),
          }
        : null,
    }));

    const networkDebug = result.actions.find((a) => a.candidateKey === "candidate:network-debug");
    expect(networkDebug).toMatchObject({
      trackId: "11000000-0000-4000-8000-000000000001",
      sourceSignals: ["CAMPAIGN"],
    });
    expect(networkDebug?.reasonRefs.some((ref) => ref.kind === "TRACK")).toBe(false);
  });

  it("applies an allocation override's effective priority and cadence to score factors", () => {
    const result = calculate((input) => ({
      ...input,
      growthPlan: input.growthPlan
        ? {
            ...input.growthPlan,
            tracks: input.growthPlan.tracks.map((track) =>
              track.trackId === "11000000-0000-4000-8000-000000000001"
                ? {
                    ...track,
                    allocationOverride: {
                      overrideId: "13000000-0000-4000-8000-000000000001",
                      version: "1",
                      priorityOverride: 55,
                      protectedMinimumMinutesOverride: null,
                      cadencePerWeekOverride: 2,
                    },
                  }
                : track,
            ),
          }
        : null,
    }));

    const networkDebug = result.actions.find((a) => a.candidateKey === "candidate:network-debug");
    expect(networkDebug?.scoreFactors).toContainEqual({ code: "TRACK_PRIORITY", points: 55 });
    expect(networkDebug?.scoreFactors).toContainEqual({
      code: "TRACK_CADENCE_DEFICIT",
      points: PLANNING_POLICY_V0_4.cadenceDeficitOnePoints,
    });
  });

  it("rejects an override protected minimum below the Track's own floor", () => {
    expect(() =>
      calculate((input) => ({
        ...input,
        growthPlan: input.growthPlan
          ? {
              ...input.growthPlan,
              tracks: input.growthPlan.tracks.map((track) =>
                track.trackId === "11000000-0000-4000-8000-000000000001"
                  ? {
                      ...track,
                      allocationOverride: {
                        overrideId: "13000000-0000-4000-8000-000000000001",
                        version: "1",
                        priorityOverride: null,
                        protectedMinimumMinutesOverride: 100,
                        cadencePerWeekOverride: null,
                      },
                    }
                  : track,
              ),
            }
          : null,
      })),
    ).toThrow(/must not be lower than the track's floor/u);
  });

  it("enforces the capacity invariant using effective protected minimums, not raw ones", () => {
    expect(() =>
      calculate((input) => ({
        ...input,
        growthPlan: input.growthPlan
          ? {
              ...input.growthPlan,
              tracks: input.growthPlan.tracks.map((track) =>
                track.trackId === "11000000-0000-4000-8000-000000000001"
                  ? {
                      ...track,
                      allocationOverride: {
                        overrideId: "13000000-0000-4000-8000-000000000001",
                        version: "1",
                        priorityOverride: null,
                        protectedMinimumMinutesOverride: 500,
                        cadencePerWeekOverride: null,
                      },
                    }
                  : track,
              ),
            }
          : null,
      })),
    ).toThrow(/active protected track minimums exceed default weekly capacity/u);
  });

  it("rejects an allocation override that sets no field at all", () => {
    expect(() =>
      calculate((input) => ({
        ...input,
        growthPlan: input.growthPlan
          ? {
              ...input.growthPlan,
              tracks: input.growthPlan.tracks.map((track) =>
                track.trackId === "11000000-0000-4000-8000-000000000001"
                  ? {
                      ...track,
                      allocationOverride: {
                        overrideId: "13000000-0000-4000-8000-000000000001",
                        version: "1",
                        priorityOverride: null,
                        protectedMinimumMinutesOverride: null,
                        cadencePerWeekOverride: null,
                      },
                    }
                  : track,
              ),
            }
          : null,
      })),
    ).toThrow(/must set at least one field/u);
  });

  it("fails closed for a mismatched policy tuple or completed-work version", () => {
    expect(() => calculate(undefined)).not.toThrow();
    expect(() =>
      calculatePlanV4(fixture.input, {
        ...PLANNING_POLICY_V0_4,
        version: "planning-policy/0.3" as "planning-policy/0.4",
      }),
    ).toThrow(PlanningInputError);
    const badCompletedWork = {
      ...fixture.input,
      completedWorkPolicyVersion: "planning-completed-work/0.1" as "planning-completed-work/0.2",
    };
    const fingerprinted = {
      ...badCompletedWork,
      inputFingerprint: planningInputFingerprint(badCompletedWork),
    };
    expect(() =>
      calculateVerifiedPlanV4(
        fingerprinted as unknown as VerifiedCalculatePlanInputV4,
        PLANNING_POLICY_V0_4,
      ),
    ).toThrow(/planning-completed-work\/0\.2/u);
  });

  it("rejects an out-of-range priority or cadence override independently of the floor", () => {
    expect(() =>
      calculate((input) => ({
        ...input,
        growthPlan: input.growthPlan
          ? {
              ...input.growthPlan,
              tracks: input.growthPlan.tracks.map((track) =>
                track.trackId === "11000000-0000-4000-8000-000000000001"
                  ? {
                      ...track,
                      allocationOverride: {
                        overrideId: "13000000-0000-4000-8000-000000000001",
                        version: "1",
                        priorityOverride: 101,
                        protectedMinimumMinutesOverride: null,
                        cadencePerWeekOverride: null,
                      },
                    }
                  : track,
              ),
            }
          : null,
      })),
    ).toThrow(PlanningInputError);
    expect(() =>
      calculate((input) => ({
        ...input,
        growthPlan: input.growthPlan
          ? {
              ...input.growthPlan,
              tracks: input.growthPlan.tracks.map((track) =>
                track.trackId === "11000000-0000-4000-8000-000000000001"
                  ? {
                      ...track,
                      allocationOverride: {
                        overrideId: "13000000-0000-4000-8000-000000000001",
                        version: "1",
                        priorityOverride: null,
                        protectedMinimumMinutesOverride: null,
                        cadencePerWeekOverride: 101,
                      },
                    }
                  : track,
              ),
            }
          : null,
      })),
    ).toThrow(PlanningInputError);
  });
});
