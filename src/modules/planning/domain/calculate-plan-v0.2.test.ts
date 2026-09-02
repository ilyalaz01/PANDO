import { describe, expect, it } from "vitest";

import planningGolden from "../../../../tests/fixtures/calculation-engines/v0.1/planning.golden.json";
import {
  planningInputFingerprint,
  planSnapshotSemanticViolations,
} from "../../../shared/contracts/planning-semantics";
import { calculatePlan, calculatePlanV2 } from "../application/calculate-plan";
import { calculateVerifiedPlanV2 } from "./calculate-plan";
import { PLANNING_POLICY_V0_1 } from "./planning-policy-v0.1";
import { PLANNING_POLICY_V0_2 } from "./planning-policy-v0.2";
import {
  PlanningInputError,
  type CalculatePlanInput,
  type CalculatePlanInputV2,
  type PlanningPolicyV2,
  type VerifiedCalculatePlanInputV2,
} from "./planning-types";

const fixture = planningGolden as unknown as { readonly input: CalculatePlanInput };

function v2Input(): CalculatePlanInputV2 {
  const source = structuredClone(fixture.input);
  const input: CalculatePlanInputV2 = {
    ...source,
    completedWorkPolicyVersion: "planning-completed-work/0.2",
    growthPlan:
      source.growthPlan === null
        ? null
        : {
            ...source.growthPlan,
            tracks: source.growthPlan.tracks.map((track) => ({
              ...track,
              cadencePerWeek: 0,
              completedCadenceSessionsThisWeek: 0,
            })),
          },
  };
  return { ...input, inputFingerprint: planningInputFingerprint(input) };
}

function calculate(
  mutate?: (input: CalculatePlanInputV2) => CalculatePlanInputV2,
  policy: PlanningPolicyV2 = PLANNING_POLICY_V0_2,
) {
  const base = v2Input();
  const changed = mutate?.(base) ?? base;
  const input = { ...changed, inputFingerprint: planningInputFingerprint(changed) };
  return calculatePlanV2(input, policy);
}

function firstGrowthTrackId(input: CalculatePlanInputV2): string {
  const trackId = input.candidates.find(({ trackId }) => trackId !== null)?.trackId;
  if (trackId === null || trackId === undefined) throw new Error("fixture needs a growth Track");
  return trackId;
}

describe("planner-engine/0.2.0 cadence policy", () => {
  it("preserves the V1 deterministic track-minimum explanation", () => {
    const input = structuredClone(fixture.input) as CalculatePlanInput;
    const trackId = firstGrowthTrackId(v2Input());
    const prepared = {
      ...input,
      campaign: null,
      readiness: input.readiness.map((readiness) =>
        readiness.availability === "CURRENT"
          ? { ...readiness, blockers: [], gaps: [], status: "DEVELOPING" as const }
          : readiness,
      ),
      candidates: input.candidates
        .filter((candidate) => candidate.trackId === trackId)
        .map((candidate) => ({
          ...candidate,
          durationSource: "PLANNING_ACTIVITY" as const,
          sourceSignals: ["GROWTH_PLAN"] as const,
          review: null,
        })),
    };
    const result = calculatePlan(
      { ...prepared, inputFingerprint: planningInputFingerprint(prepared) },
      PLANNING_POLICY_V0_1,
    );

    expect(result.actions[0]).toMatchObject({
      expectedBenefit: "PROTECT_TRACK_CADENCE",
      reason: expect.stringMatching(/^Protects a track minimum that is not met yet; estimated/u),
    });
  });

  it("adds no factor for zero or met cadence and preserves the V2 tuple", () => {
    const result = calculate((input) => ({
      ...input,
      growthPlan: {
        ...input.growthPlan!,
        tracks: input.growthPlan!.tracks.map((track) => ({
          ...track,
          cadencePerWeek: 2,
          completedCadenceSessionsThisWeek: 2,
        })),
      },
    }));

    expect(result).toMatchObject({
      engineVersion: "planner-engine/0.2.0",
      policyVersion: "planning-policy/0.2",
    });
    expect(planSnapshotSemanticViolations(result)).toEqual([]);
    expect(result.actions.flatMap(({ scoreFactors }) => scoreFactors)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "TRACK_CADENCE_DEFICIT" })]),
    );
  });

  it.each([
    { target: 2, completed: 1, points: 75 },
    { target: 3, completed: 1, points: 150 },
    { target: 100, completed: 0, points: 150 },
  ])("adds the transparent soft factor for deficit $target-$completed", (example) => {
    const input = v2Input();
    const trackId = firstGrowthTrackId(input);
    const result = calculate((current) => ({
      ...current,
      campaign: null,
      readiness: current.readiness.map((readiness) =>
        readiness.availability === "CURRENT"
          ? { ...readiness, blockers: [], gaps: [], status: "DEVELOPING" }
          : readiness,
      ),
      candidates: current.candidates
        .filter((candidate) => candidate.trackId === trackId)
        .map((candidate) => ({
          ...candidate,
          durationSource: "PLANNING_ACTIVITY" as const,
          sourceSignals: ["GROWTH_PLAN"] as const,
          review: null,
        })),
      growthPlan: {
        ...current.growthPlan!,
        tracks: current.growthPlan!.tracks.map((track) =>
          track.trackId === trackId
            ? {
                ...track,
                cadencePerWeek: example.target,
                completedCadenceSessionsThisWeek: example.completed,
              }
            : track,
        ),
      },
    }));
    const action = result.actions.find((candidate) => candidate.trackId === trackId);

    expect(action?.scoreFactors).toContainEqual({
      code: "TRACK_CADENCE_DEFICIT",
      points: example.points,
    });
    expect(action?.reasonRefs).toContainEqual(
      expect.objectContaining({ factorCode: "TRACK_CADENCE_DEFICIT", kind: "TRACK", trackId }),
    );
    expect(action).toMatchObject({
      expectedBenefit: "PROTECT_TRACK_CADENCE",
      reason: expect.stringContaining("soft weekly session rhythm"),
    });
  });

  it("does not make oversized or blocked work eligible", () => {
    const baseline = v2Input();
    const trackId = firstGrowthTrackId(baseline);
    const result = calculate((input) => ({
      ...input,
      sessionLimitMinutes: 1,
      growthPlan: {
        ...input.growthPlan!,
        tracks: input.growthPlan!.tracks.map((track) =>
          track.trackId === trackId
            ? { ...track, cadencePerWeek: 100, completedCadenceSessionsThisWeek: 0 }
            : track,
        ),
      },
    }));

    expect(result.actions).toEqual([]);
    expect(result.recommendationState).toBe("NO_CANDIDATES");
  });

  it("fails closed for missing cadence fields, invalid bounds, or a mismatched policy tuple", () => {
    const missing = v2Input() as unknown as {
      growthPlan: { tracks: Record<string, unknown>[] };
    };
    delete missing.growthPlan.tracks[0]!.cadencePerWeek;
    expect(() =>
      calculateVerifiedPlanV2(
        missing as unknown as VerifiedCalculatePlanInputV2,
        PLANNING_POLICY_V0_2,
      ),
    ).toThrow(PlanningInputError);

    expect(() =>
      calculate((input) => ({
        ...input,
        growthPlan: {
          ...input.growthPlan!,
          tracks: input.growthPlan!.tracks.map((track, index) =>
            index === 0 ? { ...track, cadencePerWeek: 101 } : track,
          ),
        },
      })),
    ).toThrow(/SCHEMA_MAXIMUM/u);

    expect(() =>
      calculate(undefined, {
        ...PLANNING_POLICY_V0_2,
        version: "planning-policy/0.1" as "planning-policy/0.2",
      }),
    ).toThrow(/planning-policy\/0\.2/u);
  });
});
