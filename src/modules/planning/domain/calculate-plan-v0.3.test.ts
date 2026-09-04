import { describe, expect, it } from "vitest";

import planningGoldenV3 from "../../../../tests/fixtures/calculation-engines/v0.3/planning.golden.json";
import {
  planSnapshotSemanticViolations,
  planningInputFingerprint,
} from "../../../shared/contracts/planning-semantics";
import { calculatePlanV2, calculatePlanV3 } from "../application/calculate-plan";
import { calculateVerifiedPlanV3 } from "./calculate-plan";
import { PLANNING_POLICY_V0_2 } from "./planning-policy-v0.2";
import { PLANNING_POLICY_V0_3 } from "./planning-policy-v0.3";
import {
  PlanningInputError,
  type CalculatePlanInputV2,
  type CalculatePlanInputV3,
  type VerifiedCalculatePlanInputV3,
} from "./planning-types";

const fixture = planningGoldenV3 as unknown as { readonly input: CalculatePlanInputV3 };

function v3Input(
  mutate?: (input: CalculatePlanInputV3) => CalculatePlanInputV3,
): CalculatePlanInputV3 {
  const base = structuredClone(fixture.input);
  const changed = mutate?.(base) ?? base;
  return { ...changed, inputFingerprint: planningInputFingerprint(changed) };
}

function calculate(mutate?: (input: CalculatePlanInputV3) => CalculatePlanInputV3) {
  return calculatePlanV3(v3Input(mutate), PLANNING_POLICY_V0_3);
}

describe("planner-engine/0.3.0 availability-composed capacity", () => {
  it("re-derives effective capacity from default plus day caps and never trusts the field", () => {
    const result = calculate();
    expect(result.capacity).toMatchObject({
      defaultWeeklyCapacityMinutes: 600,
      effectiveWeeklyCapacityMinutes: 600,
    });
    expect(result.engineVersion).toBe("planner-engine/0.3.0");
    expect(result.policyVersion).toBe("planning-policy/0.3");
    expect(planSnapshotSemanticViolations(result)).toEqual([]);
  });

  it("caps effective capacity below default when windows limit the week", () => {
    const result = calculate((input) => ({
      ...input,
      growthPlan: input.growthPlan
        ? {
            ...input.growthPlan,
            effectiveWeeklyCapacityMinutes: 350,
            dailyCaps: input.growthPlan.dailyCaps.map((cap, index) => ({
              ...cap,
              capMinutes: index === 0 ? 50 : 50,
            })),
          }
        : null,
    }));
    expect(result.capacity.effectiveWeeklyCapacityMinutes).toBe(350);
    expect(result.capacity.remainingMinutesThisWeek).toBe(170);
  });

  it("treats an all-zero week as no capacity, distinct from no plan", () => {
    const result = calculate((input) => ({
      ...input,
      growthPlan: input.growthPlan
        ? {
            ...input.growthPlan,
            effectiveWeeklyCapacityMinutes: 0,
            dailyCaps: input.growthPlan.dailyCaps.map((cap) => ({ ...cap, capMinutes: 0 })),
          }
        : null,
    }));
    expect(result.recommendationState).toBe("NO_CAPACITY");
    expect(result.actions).toEqual([]);
  });

  it("rations protected minutes by (priority desc, trackKey asc) and warns without rewriting minima", () => {
    const result = calculate((input) => ({
      ...input,
      growthPlan: input.growthPlan
        ? {
            ...input.growthPlan,
            consumedMinutesThisWeek: 0,
            effectiveWeeklyCapacityMinutes: 190,
            dailyCaps: [30, 30, 30, 30, 30, 30, 10].map((capMinutes, index) => ({
              ...input.growthPlan!.dailyCaps[index]!,
              capMinutes,
            })),
            tracks: input.growthPlan.tracks.map((track) => ({
              ...track,
              meaningfulMinutesThisWeek: 0,
            })),
          }
        : null,
    }));

    expect(result.warningCodes).toContain("PROTECTED_MINIMUM_LIMITED_BY_AVAILABILITY");
    // The higher-priority track (track:python, priority 80) keeps its full 180-minute
    // reservation; the lower-priority track:algorithms is rationed down to the 10 minutes left
    // in the pool, so its 35-minute candidate no longer fits while track:python's still do.
    const candidateKeys = result.actions.map((action) => action.candidateKey);
    expect(candidateKeys).toContain("candidate:network-debug");
    expect(candidateKeys).toContain("candidate:typing-review");
    expect(candidateKeys).not.toContain("candidate:algorithm-drill");

    // Raw protectedMinimumMinutes is never rewritten by rationing.
    expect(result.actions.find((a) => a.candidateKey === "candidate:network-debug")).toBeDefined();
  });

  it("keeps the TRACK_PROTECTED_MINIMUM factor based on the raw configured minimum, not the ration", () => {
    const result = calculate((input) => ({
      ...input,
      growthPlan: input.growthPlan
        ? {
            ...input.growthPlan,
            consumedMinutesThisWeek: 0,
            effectiveWeeklyCapacityMinutes: 190,
            dailyCaps: [30, 30, 30, 30, 30, 30, 10].map((capMinutes, index) => ({
              ...input.growthPlan!.dailyCaps[index]!,
              capMinutes,
            })),
            tracks: input.growthPlan.tracks.map((track) => ({
              ...track,
              meaningfulMinutesThisWeek: 0,
            })),
          }
        : null,
    }));
    const networkDebug = result.actions.find((a) => a.candidateKey === "candidate:network-debug");
    expect(networkDebug?.scoreFactors).toContainEqual({
      code: "TRACK_PROTECTED_MINIMUM",
      points: PLANNING_POLICY_V0_3.protectedMinimumDeficitPoints,
    });
  });

  it("distinguishes tie-broken rationing order by ascending trackKey when priorities are equal", () => {
    const goalKey = fixture.input.readiness[0]!.readinessGoalKey;
    const profileKey = fixture.input.readiness[0]!.targetProfileVersionKey;
    const trackA = {
      trackId: "21000000-0000-4000-8000-000000000001",
      trackKey: "track:aaa",
      title: "Track A",
      version: "1",
      readinessGoalKey: goalKey,
      targetProfileVersionKey: profileKey,
      lifecycle: "ACTIVE" as const,
      priority: 50,
      protectedMinimumMinutes: 100,
      meaningfulMinutesThisWeek: 0,
      defaultSessionMinutes: 45,
      cadencePerWeek: 0,
      completedCadenceSessionsThisWeek: 0,
    };
    const trackZ = {
      ...trackA,
      trackId: "21000000-0000-4000-8000-000000000002",
      trackKey: "track:zzz",
    };
    const candidateFor = (track: typeof trackA, suffix: string) => ({
      candidateKey: `candidate:tie-${suffix}`,
      readinessGoalKey: goalKey,
      targetProfileVersionKey: profileKey,
      activityKey: `activity:tie-${suffix}`,
      title: `Tie work ${suffix}`,
      estimatedMinutes: 90,
      energy: null,
      durationSource: "PLANNING_ACTIVITY" as const,
      sourceSignals: ["GROWTH_PLAN"] as const,
      trackId: track.trackId,
      competencyImpacts: [
        { competencyRef: "competency:tie-break", dimension: "APPLICATION" as const },
      ],
      prerequisiteState: "SATISFIED" as const,
      prerequisiteSummary: { total: 0, satisfied: 0, blocked: 0, unknown: 0 },
      unlockCount: 0,
      repetitionsInLast7Days: 0,
      oldestRepetitionEndedAt: null,
      repetitionWindowEndsAt: null,
      review: null,
    });

    const input = v3Input((base) => ({
      ...base,
      growthPlan: base.growthPlan
        ? {
            ...base.growthPlan,
            consumedMinutesThisWeek: 0,
            defaultWeeklyCapacityMinutes: 200,
            effectiveWeeklyCapacityMinutes: 100,
            dailyCaps: [20, 20, 20, 20, 20, 0, 0].map((capMinutes, index) => ({
              ...base.growthPlan!.dailyCaps[index]!,
              capMinutes,
            })),
            tracks: [trackA, trackZ],
          }
        : null,
      candidates: [candidateFor(trackA, "a"), candidateFor(trackZ, "z")],
    }));

    const result = calculatePlanV3(input, PLANNING_POLICY_V0_3);
    const candidateKeys = result.actions.map((action) => action.candidateKey);
    expect(candidateKeys).toContain("candidate:tie-a");
    expect(candidateKeys).not.toContain("candidate:tie-z");
    expect(result.warningCodes).toContain("PROTECTED_MINIMUM_LIMITED_BY_AVAILABILITY");
  });

  it("still enforces the hard invariant against default capacity, not effective", () => {
    const input = v3Input((base) => ({
      ...base,
      growthPlan: base.growthPlan
        ? {
            ...base.growthPlan,
            defaultWeeklyCapacityMinutes: 299,
            effectiveWeeklyCapacityMinutes: 299,
          }
        : null,
    }));
    expect(() => calculatePlanV3(input, PLANNING_POLICY_V0_3)).toThrow(/default weekly capacity/u);
  });

  it("fails closed for a mismatched policy tuple or completed-work version", () => {
    expect(() => calculate(undefined)).not.toThrow();
    expect(() =>
      calculatePlanV3(fixture.input, {
        ...PLANNING_POLICY_V0_3,
        version: "planning-policy/0.2" as "planning-policy/0.3",
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
      calculateVerifiedPlanV3(
        fingerprinted as unknown as VerifiedCalculatePlanInputV3,
        PLANNING_POLICY_V0_3,
      ),
    ).toThrow(/planning-completed-work\/0\.2/u);
  });

  it("keeps V2 executable and unaffected by the V3 addition", () => {
    const source = structuredClone(fixture.input);
    const v2Input: CalculatePlanInputV2 = {
      ...source,
      growthPlan: source.growthPlan
        ? {
            growthPlanId: source.growthPlan.growthPlanId,
            version: source.growthPlan.version,
            lifecycle: source.growthPlan.lifecycle,
            weeklyCapacityMinutes: source.growthPlan.defaultWeeklyCapacityMinutes,
            consumedMinutesThisWeek: source.growthPlan.consumedMinutesThisWeek,
            tracks: source.growthPlan.tracks,
          }
        : null,
    };
    const fingerprinted = { ...v2Input, inputFingerprint: planningInputFingerprint(v2Input) };
    const result = calculatePlanV2(fingerprinted, PLANNING_POLICY_V0_2);
    expect(result.engineVersion).toBe("planner-engine/0.2.0");
    expect(result.capacity).toMatchObject({ weeklyCapacityMinutes: 600 });
  });
});
