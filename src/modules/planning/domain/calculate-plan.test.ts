import fc from "fast-check";
import { describe, expect, it } from "vitest";

import planningGolden from "../../../../tests/fixtures/calculation-engines/v0.1/planning.golden.json";
import {
  planningInputFingerprint,
  planSnapshotSemanticViolations,
} from "../../../shared/contracts/planning-semantics";
import { calculatePlan } from "../application/calculate-plan";
import { calculateVerifiedPlan } from "./calculate-plan";
import { PLANNING_POLICY_V0_1 } from "./planning-policy-v0.1";
import {
  PlanningInputError,
  type CalculatePlanInput,
  type PlanningCandidateInput,
  type PlanningPolicy,
  type VerifiedCalculatePlanInput,
} from "./planning-types";

const fixture = planningGolden as unknown as {
  readonly input: CalculatePlanInput;
  readonly expected: unknown;
};

type Mutable<T> = { -readonly [Key in keyof T]: T[Key] };

function baseInput(): Mutable<CalculatePlanInput> {
  return structuredClone(fixture.input);
}

function withoutCampaignSources(
  candidates: readonly PlanningCandidateInput[],
): readonly PlanningCandidateInput[] {
  return candidates.map((candidate) => ({
    ...candidate,
    sourceSignals: candidate.sourceSignals.filter((source) => source !== "CAMPAIGN"),
  }));
}

function verifiedInput(input: CalculatePlanInput = baseInput()): CalculatePlanInput {
  const prepared = structuredClone(input) as Mutable<CalculatePlanInput>;
  prepared.inputFingerprint = planningInputFingerprint(prepared);
  return prepared;
}

function calculate(input: CalculatePlanInput = baseInput()) {
  return calculatePlan(verifiedInput(input), PLANNING_POLICY_V0_1);
}

function unavailableReadiness(
  reason: "NOT_MATERIALIZED" | "REBUILDING" | "STALE" | "ERROR" | "GOAL_INACTIVE",
) {
  return [
    {
      availability: "UNAVAILABLE",
      reason,
      readinessGoalKey: "goal:nvidia-verification",
      targetProfileVersionKey: "target:nvidia-swe-v1",
      snapshotId: null,
      inputFingerprint: null,
      calculatedAsOf: null,
      validUntil: null,
      status: null,
      coverage: null,
      confidence: null,
      blockers: [],
      gaps: [],
    },
  ] as const;
}

function removeReadinessGaps(input: Mutable<CalculatePlanInput>): void {
  input.readiness = input.readiness.map((readiness) =>
    readiness.availability === "CURRENT"
      ? { ...readiness, blockers: [], gaps: [], status: "DEVELOPING" }
      : readiness,
  );
}

function growthCandidate(
  candidateKey: string,
  overrides: Partial<PlanningCandidateInput> = {},
): PlanningCandidateInput {
  return {
    candidateKey,
    readinessGoalKey: "goal:nvidia-verification",
    targetProfileVersionKey: "target:nvidia-swe-v1",
    activityKey: `activity:${candidateKey.split(":").at(-1)}`,
    title: candidateKey,
    estimatedMinutes: 30,
    energy: "MEDIUM",
    durationSource: "PLANNING_ACTIVITY",
    sourceSignals: ["GROWTH_PLAN"],
    trackId: "11000000-0000-4000-8000-000000000001",
    competencyImpacts: [
      { competencyRef: `competency:${candidateKey.split(":").at(-1)}`, dimension: "APPLICATION" },
    ],
    prerequisiteState: "SATISFIED",
    unlockCount: 0,
    repetitionsInLast7Days: 0,
    repetitionWindowEndsAt: null,
    review: null,
    ...overrides,
  };
}

function reviewCandidate(
  index: number,
  bucket: "OVERDUE" | "DUE_TODAY" = "DUE_TODAY",
): PlanningCandidateInput {
  const suffix = index.toString().padStart(3, "0");
  return {
    candidateKey: `candidate:review-${suffix}`,
    readinessGoalKey: "goal:nvidia-verification",
    targetProfileVersionKey: "target:nvidia-swe-v1",
    activityKey: `activity:review-${suffix}`,
    title: `Review ${suffix}`,
    estimatedMinutes: 25,
    energy: null,
    durationSource: "REVIEW_POLICY",
    sourceSignals: ["REVIEW"],
    trackId: null,
    competencyImpacts: [{ competencyRef: `competency:review-${suffix}`, dimension: "APPLICATION" }],
    prerequisiteState: "SATISFIED",
    unlockCount: 0,
    repetitionsInLast7Days: 0,
    repetitionWindowEndsAt: null,
    review: {
      reviewItemId: `13000000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
      bucket,
      dueAt: bucket === "OVERDUE" ? "2026-08-31T12:00:00Z" : "2026-09-01T18:00:00Z",
    },
  };
}

describe("calculatePlan", () => {
  it("matches the versioned Planning golden fixture", () => {
    expect(calculatePlan(fixture.input, PLANNING_POLICY_V0_1)).toEqual(fixture.expected);
  });

  it("always resumes an active Focus before proposing new work", () => {
    const input = baseInput();
    input.growthPlan = { ...input.growthPlan!, consumedMinutesThisWeek: 600 };
    input.activeFocus = {
      focusSessionId: "20000000-0000-4000-8000-000000000001",
      readinessGoalKey: "goal:nvidia-verification",
      activityKey: "activity:network-debug",
      title: "Debug a TCP connection",
      plannedMinutes: 45,
      startedAt: "2026-09-01T11:45:00Z",
      planAttribution: {
        planSnapshotId: "15000000-0000-4000-8000-000000000001",
        candidateKey: "candidate:network-debug",
        trackId: "11000000-0000-4000-8000-000000000001",
      },
    };
    const planAttribution = input.activeFocus.planAttribution;
    if (planAttribution === null) throw new Error("test requires plan attribution");

    const result = calculate(input);
    expect(result).toMatchObject({
      recommendationState: "CURRENT",
      actions: [
        {
          actionKind: "RESUME",
          focusSessionId: input.activeFocus.focusSessionId,
          trackId: planAttribution.trackId,
          planAttribution,
          expectedBenefit: "RESUME_ACTIVE_FOCUS",
        },
      ],
    });
    expect(planSnapshotSemanticViolations(result)).toEqual([]);
    const changed = structuredClone(result);
    (changed.actions[0]!.reasonRefs[0] as { focusSessionId: string }).focusSessionId =
      "20000000-0000-4000-8000-000000000099";
    expect(planSnapshotSemanticViolations(changed)).toContain(
      "PLAN_SNAPSHOT_ACTION_0_REASON_REF_COHERENCE",
    );
  });

  it("does not convert unavailable readiness into target score", () => {
    const input = baseInput();
    input.readiness = unavailableReadiness("STALE");

    const result = calculate(input);
    expect(result.warningCodes).toContain("READINESS_STALE");
    expect(result.actions.flatMap(({ scoreFactors }) => scoreFactors)).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: expect.stringMatching(/^TARGET_/u) }),
      ]),
    );
    expect(result.actions.every(({ sourceSignals }) => sourceSignals.includes("REVIEW"))).toBe(
      true,
    );
  });

  it("does not recommend any action for an inactive readiness goal", () => {
    const input = baseInput();
    input.readiness = unavailableReadiness("GOAL_INACTIVE");
    expect(calculate(input).actions).toEqual([]);
  });

  it("does not apply one goal's readiness gaps to another goal's activity", () => {
    const input = baseInput();
    input.campaign = null;
    input.growthPlan = {
      ...input.growthPlan!,
      tracks: [
        ...input.growthPlan!.tracks,
        {
          ...input.growthPlan!.tracks[0]!,
          trackId: "11000000-0000-4000-8000-000000000099",
          trackKey: "track:other-target",
          readinessGoalKey: "goal:other-target",
        },
      ],
    };
    input.readiness = [
      ...input.readiness,
      {
        ...unavailableReadiness("NOT_MATERIALIZED")[0],
        readinessGoalKey: "goal:other-target",
      },
    ];
    input.candidates = [
      growthCandidate("candidate:other-goal", {
        readinessGoalKey: "goal:other-target",
        trackId: "11000000-0000-4000-8000-000000000099",
        competencyImpacts: [
          { competencyRef: "competency:networking-tcp-ip", dimension: "APPLICATION" },
        ],
      }),
    ];

    expect(calculate(input).actions[0]?.scoreFactors).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "TARGET_FAILED_MANDATORY_FLOOR" })]),
    );
  });

  it("fails closed when weekly or session capacity cannot fit work", () => {
    const weekly = baseInput();
    weekly.growthPlan = { ...weekly.growthPlan!, consumedMinutesThisWeek: 600 };
    expect(calculate(weekly)).toMatchObject({ recommendationState: "NO_CAPACITY", actions: [] });

    const session = baseInput();
    session.sessionLimitMinutes = 20;
    expect(calculate(session)).toMatchObject({ recommendationState: "NO_CANDIDATES", actions: [] });
  });

  it("keeps truthful observed minutes above the capacity ceiling", () => {
    const input = baseInput();
    input.growthPlan = {
      ...input.growthPlan!,
      consumedMinutesThisWeek: 10_081,
      tracks: input.growthPlan!.tracks.map((track, index) =>
        index === 0 ? { ...track, meaningfulMinutesThisWeek: 10_081 } : track,
      ),
    };
    expect(calculate(input)).toMatchObject({
      recommendationState: "NO_CAPACITY",
      capacity: { consumedMinutesThisWeek: 10_081, remainingMinutesThisWeek: 0 },
    });
  });

  it("reserves protected minima from campaign-only work", () => {
    const input = baseInput();
    input.growthPlan = { ...input.growthPlan!, consumedMinutesThisWeek: 570 };
    input.candidates = [
      growthCandidate("candidate:protected", { estimatedMinutes: 25 }),
      growthCandidate("candidate:campaign-flexible", {
        estimatedMinutes: 25,
        sourceSignals: ["GROWTH_PLAN", "CAMPAIGN"],
        trackId: "11000000-0000-4000-8000-000000000002",
      }),
    ];

    expect(calculate(input).actions.map(({ candidateKey }) => candidateKey)).toEqual([
      "candidate:protected",
    ]);
  });

  it("keeps an independently due Review eligible when the Growth Plan is paused", () => {
    const input = baseInput();
    input.growthPlan = { ...input.growthPlan!, lifecycle: "PAUSED" };
    input.campaign = null;
    input.candidates = withoutCampaignSources(input.candidates);

    const result = calculate(input);
    expect(result.actions.map(({ candidateKey }) => candidateKey)).toEqual([
      "candidate:error-review",
      "candidate:typing-review",
    ]);
    expect(result.actions[0]?.sourceSignals).toEqual(["REVIEW"]);
  });

  it("excludes blocked work and returns at most five unique actions", () => {
    const input = baseInput();
    removeReadinessGaps(input);
    input.campaign = null;
    input.energyPreference = null;
    input.candidates = [
      growthCandidate("candidate:blocked", { prerequisiteState: "BLOCKED" }),
      ...Array.from({ length: 8 }, (_unused, index) =>
        growthCandidate(`candidate:eligible-${index}`, { unlockCount: index }),
      ),
    ];

    const result = calculate(input);
    expect(result.actions).toHaveLength(5);
    expect(new Set(result.actions.map(({ candidateKey }) => candidateKey))).toHaveProperty(
      "size",
      5,
    );
    expect(result.actions.map(({ candidateKey }) => candidateKey)).not.toContain(
      "candidate:blocked",
    );
  });

  it("is stable under candidate permutations and stable-key tie breaks", () => {
    fc.assert(
      fc.property(
        fc.shuffledSubarray([0, 1, 2, 3, 4, 5], { minLength: 6, maxLength: 6 }),
        (order) => {
          const input = baseInput();
          input.campaign = null;
          removeReadinessGaps(input);
          input.energyPreference = null;
          const candidates = order.map((index) => growthCandidate(`candidate:tie-${index}`));
          input.candidates = candidates;

          expect(calculate(input).actions.map(({ candidateKey }) => candidateKey)).toEqual([
            "candidate:tie-0",
            "candidate:tie-1",
            "candidate:tie-2",
            "candidate:tie-3",
            "candidate:tie-4",
          ]);
        },
      ),
    );
  });

  it("canonicalizes set-like source signals", () => {
    const left = baseInput();
    left.candidates = [left.candidates[0]!];
    const right = baseInput();
    right.candidates = [
      { ...right.candidates[0]!, sourceSignals: [...right.candidates[0]!.sourceSignals].reverse() },
    ];

    expect(calculate(left)).toEqual(calculate(right));
    expect(calculate(left).actions[0]?.sourceSignals).toEqual(["CAMPAIGN", "GROWTH_PLAN"]);
  });

  it("emits a contract-valid empty factor list for eligible zero-score work", () => {
    const input = baseInput();
    input.campaign = null;
    input.energyPreference = null;
    removeReadinessGaps(input);
    input.growthPlan = {
      ...input.growthPlan!,
      tracks: input.growthPlan!.tracks.map((track, index) =>
        index === 0
          ? { ...track, priority: 0, protectedMinimumMinutes: 0, meaningfulMinutesThisWeek: 20 }
          : track,
      ),
    };
    input.candidates = [growthCandidate("candidate:zero-score", { energy: null })];

    expect(calculate(input).actions[0]).toMatchObject({ score: 0, scoreFactors: [] });
  });

  it("omits zero-valued policy factors and their causal references", () => {
    const zeroGapPolicy: PlanningPolicy = {
      ...PLANNING_POLICY_V0_1,
      failedMandatoryFloorPoints: 0,
      unknownMandatoryFloorPoints: 0,
      knownShortfallPoints: 0,
      unknownRequirementPoints: 0,
    };
    const gapResult = calculatePlan(verifiedInput(), zeroGapPolicy);
    expect(gapResult.actions.flatMap(({ scoreFactors }) => scoreFactors)).not.toContainEqual(
      expect.objectContaining({ points: 0 }),
    );
    expect(planSnapshotSemanticViolations(gapResult)).toEqual([]);

    const focus = baseInput();
    focus.activeFocus = {
      focusSessionId: "20000000-0000-4000-8000-000000000001",
      readinessGoalKey: "goal:nvidia-verification",
      activityKey: "activity:network-debug",
      title: "Debug a TCP connection",
      plannedMinutes: 45,
      startedAt: "2026-09-01T11:45:00Z",
      planAttribution: null,
    };
    const resumeResult = calculatePlan(verifiedInput(focus), {
      ...PLANNING_POLICY_V0_1,
      activeFocusResumePoints: 0,
    });
    expect(resumeResult.actions[0]).toMatchObject({
      score: 0,
      scoreFactors: [],
      reasonRefs: [],
    });
    expect(planSnapshotSemanticViolations(resumeResult)).toEqual([]);
  });

  it("describes an unknown mandatory floor as verification, not a confirmed blocker", () => {
    const input = baseInput();
    input.campaign = null;
    input.readiness = input.readiness.map((readiness) =>
      readiness.availability === "CURRENT"
        ? {
            ...readiness,
            blockers: [],
            gaps: [
              {
                gapCode: "UNKNOWN_MANDATORY_FLOOR" as const,
                competencyRef: "competency:networking-tcp-ip",
                dimension: "APPLICATION" as const,
              },
            ],
          }
        : readiness,
    );
    input.candidates = [
      growthCandidate("candidate:networking", {
        competencyImpacts: [
          { competencyRef: "competency:networking-tcp-ip", dimension: "APPLICATION" },
        ],
      }),
    ];

    expect(calculate(input).actions[0]).toMatchObject({
      expectedBenefit: "VERIFY_MANDATORY_REQUIREMENT",
      reason: expect.stringContaining("unknown mandatory requirement"),
    });
  });

  it("uses duration before stable key for tied scores", () => {
    const input = baseInput();
    input.campaign = null;
    removeReadinessGaps(input);
    input.energyPreference = null;
    input.candidates = [
      growthCandidate("candidate:a-long", { estimatedMinutes: 45 }),
      growthCandidate("candidate:z-short", { estimatedMinutes: 20 }),
    ];

    expect(calculate(input).actions.map(({ candidateKey }) => candidateKey)).toEqual([
      "candidate:z-short",
      "candidate:a-long",
    ]);
  });

  it("returns explicit no-plan and paused-plan states without fabricating actions", () => {
    const noPlan = baseInput();
    noPlan.growthPlan = null;
    noPlan.campaign = null;
    noPlan.readiness = [];
    noPlan.candidates = [];
    noPlan.sessionLimitMinutes = 0;
    expect(calculate(noPlan)).toMatchObject({ recommendationState: "NO_PLAN", actions: [] });

    const paused = baseInput();
    paused.growthPlan = { ...paused.growthPlan!, lifecycle: "PAUSED" };
    paused.campaign = null;
    paused.candidates = withoutCampaignSources(
      paused.candidates.filter(({ review }) => review === null),
    );
    expect(calculate(paused)).toMatchObject({ recommendationState: "PLAN_PAUSED", actions: [] });
  });

  it("rejects expired inputs, pending Review candidates, duplicate Focus pairs, and bad references", () => {
    const expired = baseInput();
    expired.readiness = [
      {
        ...expired.readiness[0]!,
        availability: "CURRENT",
        validUntil: "2026-09-01T11:59:59Z",
      },
    ] as CalculatePlanInput["readiness"];
    expect(() => calculate(expired)).toThrow(/expired readiness/u);

    const pending = baseInput();
    pending.reviewSummary = { ...pending.reviewSummary, projectionState: "PENDING" };
    expect(() => calculate(pending)).toThrow(/non-current Review/u);

    const duplicate = baseInput();
    duplicate.candidates = [
      duplicate.candidates[0]!,
      { ...duplicate.candidates[0]!, candidateKey: "candidate:duplicate" },
    ];
    expect(() => calculate(duplicate)).toThrow(/duplicate Focus candidate pair/u);

    const unknownTrack = baseInput();
    unknownTrack.candidates = [
      growthCandidate("candidate:unknown-track", {
        trackId: "11000000-0000-4000-8000-000000000099",
      }),
    ];
    expect(() => calculate(unknownTrack)).toThrow(/unknown track/u);

    const misbucketed = baseInput();
    misbucketed.candidates = misbucketed.candidates.map((candidate) =>
      candidate.review?.bucket === "DUE_TODAY"
        ? { ...candidate, review: { ...candidate.review, dueAt: "2026-09-01T11:59:59Z" } }
        : candidate,
    );
    expect(() => calculate(misbucketed)).toThrow(/due-today Review/u);
  });

  it("rejects raw input before the domain when structure or fingerprint is unverified", () => {
    const structurallyInvalid = baseInput();
    structurallyInvalid.sessionLimitMinutes = -1;
    expect(() => calculatePlan(structurallyInvalid, PLANNING_POLICY_V0_1)).toThrow(
      /input contract rejected/u,
    );

    const fingerprintMismatch = baseInput();
    fingerprintMismatch.energyPreference = "LOW";
    expect(() => calculatePlan(fingerprintMismatch, PLANNING_POLICY_V0_1)).toThrow(
      /PLANNING_INPUT_FINGERPRINT/u,
    );
  });

  it("bounds and correlates Review candidates to unique current Review items", () => {
    const tooMany = baseInput();
    tooMany.candidates = Array.from({ length: 101 }, (_, index) => reviewCandidate(index + 1));
    tooMany.reviewSummary = {
      projectionState: "CURRENT",
      overdueCount: 0,
      dueTodayCount: 100,
      validUntil: "2026-09-01T18:00:00Z",
    };
    expect(() => calculate(tooMany)).toThrow(/Review candidates exceed 100/u);

    const duplicateItem = baseInput();
    const first = reviewCandidate(1);
    duplicateItem.candidates = [
      first,
      {
        ...reviewCandidate(2),
        review: { ...reviewCandidate(2).review!, reviewItemId: first.review!.reviewItemId },
      },
    ];
    duplicateItem.reviewSummary = {
      projectionState: "CURRENT",
      overdueCount: 0,
      dueTodayCount: 2,
      validUntil: "2026-09-01T18:00:00Z",
    };
    expect(() => calculate(duplicateItem)).toThrow(/Review item references.*duplicates/u);

    const impossibleSummary = baseInput();
    impossibleSummary.candidates = [reviewCandidate(1, "OVERDUE")];
    impossibleSummary.reviewSummary = {
      projectionState: "CURRENT",
      overdueCount: 0,
      dueTodayCount: 0,
      validUntil: null,
    };
    expect(() => calculate(impossibleSummary)).toThrow(/cannot exceed the current Review summary/u);
  });

  it("caps snapshot validity at Review, Campaign, and week clock transitions", () => {
    const reviewTransition = baseInput();
    reviewTransition.evaluationHorizon = {
      ...reviewTransition.evaluationHorizon,
      validUntil: "2026-09-01T18:00:00.001Z",
    };
    expect(() => calculate(reviewTransition)).toThrow(/Review summary validity/u);

    const campaignTransition = baseInput();
    campaignTransition.reviewSummary = {
      projectionState: "NOT_STARTED",
      overdueCount: 0,
      dueTodayCount: 0,
      validUntil: null,
    };
    campaignTransition.candidates = withoutCampaignSources(
      campaignTransition.candidates.filter(({ review }) => review === null),
    );
    campaignTransition.readiness = campaignTransition.readiness.map((readiness) =>
      readiness.availability === "CURRENT"
        ? { ...readiness, validUntil: "2026-09-04T12:00:00Z" }
        : readiness,
    );
    campaignTransition.evaluationHorizon = {
      ...campaignTransition.evaluationHorizon,
      validUntil: "2026-09-02T12:00:00Z",
    };
    expect(() => calculate(campaignTransition)).toThrow(/Campaign clock transition/u);

    const nextWeek = baseInput();
    nextWeek.growthPlan = null;
    nextWeek.campaign = null;
    nextWeek.readiness = [];
    nextWeek.candidates = [];
    nextWeek.reviewSummary = {
      projectionState: "NOT_STARTED",
      overdueCount: 0,
      dueTodayCount: 0,
      validUntil: null,
    };
    nextWeek.evaluationHorizon = {
      ...nextWeek.evaluationHorizon,
      validUntil: nextWeek.evaluationHorizon.weekEnd,
    };
    expect(() => calculate(nextWeek)).toThrow(/exclusive week boundary/u);

    const farFutureCampaign = baseInput();
    farFutureCampaign.campaign = {
      ...farFutureCampaign.campaign!,
      deadlineAt: "2200-01-01T00:00:00Z",
    };
    expect(() => calculate(farFutureCampaign)).toThrow(/36,500 days/u);
  });

  it("rejects impossible plan invariants, future Focus, and malformed policy", () => {
    const protectedOverflow = baseInput();
    protectedOverflow.growthPlan = {
      ...protectedOverflow.growthPlan!,
      weeklyCapacityMinutes: 100,
    };
    expect(() => calculate(protectedOverflow)).toThrow(/protected track minimums/u);

    const futureFocus = baseInput();
    futureFocus.activeFocus = {
      focusSessionId: "20000000-0000-4000-8000-000000000001",
      readinessGoalKey: "goal:nvidia-verification",
      activityKey: "activity:network-debug",
      title: "Debug a TCP connection",
      plannedMinutes: 45,
      startedAt: "2026-09-01T12:00:01Z",
      planAttribution: null,
    };
    expect(() => calculate(futureFocus)).toThrow(/cannot start after/u);

    const missingMastery = baseInput();
    missingMastery.sourceRevisions = missingMastery.sourceRevisions.filter(
      ({ owner }) => owner !== "MASTERY",
    );
    expect(() => calculate(missingMastery)).toThrow(/Catalog, Mastery, and Overlay/u);

    const malformedPolicy = {
      ...PLANNING_POLICY_V0_1,
      campaignDeadlinePoints: { within7Days: 1, within21Days: 2, within42Days: 3 },
    } satisfies PlanningPolicy;
    expect(() => calculatePlan(verifiedInput(), malformedPolicy)).toThrow(/must not increase/u);
    expect(() =>
      calculatePlan(verifiedInput(), { ...PLANNING_POLICY_V0_1, maximumActions: 6 }),
    ).toThrow(PlanningInputError);
  });

  it("requires a versioned completed-work policy and its Evidence fence", () => {
    // The contract entry point rejects the malformed version structurally, and the pure engine
    // rejects it again so a caller cannot bypass the schema.
    for (const version of ["planning-completed-work", "mastery-readiness-policy/0.1"]) {
      const input = verifiedInput({ ...baseInput(), completedWorkPolicyVersion: version });
      expect(() => calculatePlan(input, PLANNING_POLICY_V0_1)).toThrow(PlanningInputError);
      expect(() =>
        calculateVerifiedPlan(input as VerifiedCalculatePlanInput, PLANNING_POLICY_V0_1),
      ).toThrow(/versioned completed-work policy/u);
    }

    const missingEvidence = baseInput();
    missingEvidence.sourceRevisions = missingEvidence.sourceRevisions.filter(
      ({ owner }) => owner !== "EVIDENCE",
    );
    expect(() => calculate(missingEvidence)).toThrow(/Evidence, Focus, and Review/u);
  });

  it("binds a counted repetition to a verifiable window cutoff", () => {
    const repeated = fixture.input.candidates.findIndex(
      ({ repetitionsInLast7Days }) => repetitionsInLast7Days > 0,
    );
    expect(repeated).toBeGreaterThanOrEqual(0);

    const withoutCutoff = baseInput();
    withoutCutoff.candidates = withoutCutoff.candidates.map((candidate, index) =>
      index === repeated ? { ...candidate, repetitionWindowEndsAt: null } : candidate,
    );
    expect(() => calculate(withoutCutoff)).toThrow(/counted repetition requires/u);

    const uncountedCutoff = baseInput();
    uncountedCutoff.candidates = uncountedCutoff.candidates.map((candidate, index) =>
      index === repeated
        ? { ...candidate, repetitionsInLast7Days: 0 }
        : { ...candidate, repetitionWindowEndsAt: "2026-09-05T00:00:00Z" },
    );
    expect(() => calculate(uncountedCutoff)).toThrow(/must not declare a repetition window/u);

    const alreadyExpired = baseInput();
    alreadyExpired.candidates = alreadyExpired.candidates.map((candidate, index) =>
      index === repeated
        ? { ...candidate, repetitionWindowEndsAt: "2026-09-01T11:00:00Z" }
        : candidate,
    );
    expect(() => calculate(alreadyExpired)).toThrow(/cannot end before clock.asOf/u);

    // The snapshot may not outlive the instant at which the oldest counted repetition drops out.
    const outlivingWindow = baseInput();
    outlivingWindow.candidates = outlivingWindow.candidates.map((candidate, index) =>
      index === repeated
        ? { ...candidate, repetitionWindowEndsAt: fixture.input.evaluationHorizon.validUntil }
        : candidate,
    );
    expect(() => calculate(outlivingWindow)).toThrow(/repetition window transition/u);
  });
});
