import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { calculatePlan, calculatePlanV2, calculatePlanV3, calculatePlanV4 } from "./calculate-plan";
import {
  assemblePlanSnapshotInput,
  assemblePlanSnapshotInputV2,
  assemblePlanSnapshotInputV3,
  assemblePlanSnapshotInputV4,
  PlanningProjectionSourceError,
} from "./assemble-plan-snapshot-input";
import { PLANNING_POLICY_V0_1 } from "../domain/planning-policy-v0.1";
import { PLANNING_POLICY_V0_2 } from "../domain/planning-policy-v0.2";
import { PLANNING_POLICY_V0_3 } from "../domain/planning-policy-v0.3";
import { PLANNING_POLICY_V0_4 } from "../domain/planning-policy-v0.4";

const trackedActivityId = "26000000-0000-4000-8000-000000000105";

interface WorkSession {
  focusSessionId: string;
  customActivityId: string;
  activityKey: string;
  readinessGoalKey: string;
  state: "COMPLETED" | "STOPPED";
  startedAt: string;
  endedAt: string;
  plannedMinutes: number;
}

interface EvidenceAnswer {
  focusSessionId: string;
  attemptTerminal: boolean;
  evidenceBearing: boolean;
}

let sessionCounter = 0;

function prerequisiteProjection(
  competencyRef: string,
  condition: "STRONG" | "WEAK" | "STALE",
  achievementLevel: "NOT_STARTED" | "COMPLETED" | "VERIFIED" | "MASTERED",
  lastMeaningfulEvidenceAt: string,
  calculatedAsOf = "2026-08-02T12:00:00Z",
) {
  const unknownDimension = (dimension: string) => ({
    dimension,
    value: "UNKNOWN",
    achievementLevel: "NOT_STARTED",
    condition: null,
    confidence: null,
    freshness: "UNKNOWN",
    lastMeaningfulEvidenceAt: null,
  });
  return {
    snapshotId: "29000000-0000-4000-8000-000000000001",
    pointerInputWatermark: "1",
    pointerProjectionVersion: "1",
    pointerUpdatedAt: calculatedAsOf,
    projectionGeneration: "live-v1",
    engineVersion: "mastery-engine/0.1.0",
    policyVersion: "mastery-readiness-policy/0.1",
    calculatedAsOf,
    achievementLevel,
    createdAt: calculatedAsOf,
    state: {
      engineVersion: "mastery-engine/0.1.0",
      policyVersion: "mastery-readiness-policy/0.1",
      inputWatermark: "1",
      competencyId: competencyRef,
      calculatedAsOf,
      achievementLevel,
      dimensions: {
        KNOWLEDGE: unknownDimension("KNOWLEDGE"),
        RECALL: unknownDimension("RECALL"),
        APPLICATION: {
          dimension: "APPLICATION",
          value: "KNOWN",
          achievementLevel,
          condition,
          confidence: "LOW",
          freshness: condition === "STALE" ? "STALE" : "FRESH",
          lastMeaningfulEvidenceAt,
        },
        INTERVIEW_EXECUTION: unknownDimension("INTERVIEW_EXECUTION"),
      },
    },
  };
}

/** One terminal Focus Session plus the exact Evidence answer that classifies it. */
function terminalSession(
  overrides: Partial<WorkSession> & { evidenceBearing?: boolean; attemptTerminal?: boolean } = {},
): { session: WorkSession; answer: EvidenceAnswer } {
  sessionCounter += 1;
  const focusSessionId = `27000000-0000-4000-8000-0000000001${String(sessionCounter).padStart(2, "0")}`;
  const { evidenceBearing = true, attemptTerminal = true, ...sessionOverrides } = overrides;
  return {
    session: {
      focusSessionId,
      customActivityId: trackedActivityId,
      activityKey: "activity:debug-api",
      readinessGoalKey: "goal:backend",
      state: "COMPLETED",
      startedAt: "2026-08-31T09:00:00Z",
      endedAt: "2026-08-31T09:25:00Z",
      plannedMinutes: 25,
      ...sessionOverrides,
    },
    answer: { focusSessionId, attemptTerminal, evidenceBearing },
  };
}

function withWork(
  entries: readonly { session: WorkSession; answer: EvidenceAnswer }[],
  base = sourceBundle(),
) {
  return {
    ...base,
    completedWork: { ...base.completedWork, sessions: entries.map(({ session }) => session) },
    evidence: { ...base.evidence, items: entries.map(({ answer }) => answer) },
  };
}

function sourceBundle() {
  return {
    claimAsOf: "2026-08-31T12:00:00+00:00",
    sourceFence: `planning-source:${"a".repeat(64)}`,
    calendar: {
      timeZone: "UTC",
      weekStart: "2026-08-31T00:00:00+00:00",
      weekEnd: "2026-09-07T00:00:00+00:00",
      validUntil: "2026-09-06T23:59:59.999+00:00",
      fence: "identity-calendar:UTC",
    },
    plan: {
      growthPlanId: "26000000-0000-4000-8000-000000000101",
      title: "Backend growth",
      lifecycle: "ACTIVE",
      weeklyCapacityMinutes: 300,
      version: "1",
      tracks: [
        {
          trackId: "26000000-0000-4000-8000-000000000102",
          trackKey: "track:backend",
          title: "Backend",
          version: "2",
          readinessGoalId: "26000000-0000-4000-8000-000000000103",
          profileVersionId: "26000000-0000-4000-8000-000000000104",
          lifecycle: "ACTIVE",
          priority: 80,
          protectedMinimumMinutes: 60,
          cadencePerWeek: 3,
          defaultSessionMinutes: 25,
        },
      ],
      activities: [
        {
          trackId: "26000000-0000-4000-8000-000000000102",
          customActivityId: "26000000-0000-4000-8000-000000000105",
          candidateKey: "candidate:debug-api",
          estimatedMinutes: 25,
          energy: "MEDIUM",
          version: "1",
        },
      ],
    },
    targets: {
      items: [
        {
          readinessGoalId: "26000000-0000-4000-8000-000000000103",
          readinessGoalKey: "goal:backend",
          profileVersionId: "26000000-0000-4000-8000-000000000104",
          profileVersionKey: "target:backend-v1",
          catalogVersionId: "26000000-0000-4000-8000-000000000106",
          revision: "readiness:1:0:NOT_MATERIALIZED",
          availability: "UNAVAILABLE",
          reason: "NOT_MATERIALIZED",
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
      ],
    },
    overlay: {
      revision: "workspace-overlay:2",
      items: [
        {
          customActivityId: "26000000-0000-4000-8000-000000000105",
          activityKey: "activity:debug-api",
          title: "Debug an API",
          targetCompetencyRef: "competency:debugging",
          dimension: "APPLICATION",
        },
      ],
    },
    catalog: {
      versions: [
        {
          catalogVersionId: "26000000-0000-4000-8000-000000000106",
          catalogVersionKey: "catalog:v1",
          versionNumber: 1,
        },
      ],
      items: [
        {
          catalogVersionId: "26000000-0000-4000-8000-000000000106",
          competencyRef: "competency:debugging",
          prerequisiteCount: 1,
          prerequisiteRefs: ["competency:foundations"],
          unlockCount: 2,
        },
      ],
    },
    focus: {
      revision: `focus-scope:${"b".repeat(64)}`,
      activeFocus: null,
    },
    completedWork: {
      revision: `completed-work:${"f".repeat(64)}`,
      windowStart: "2026-08-24T12:00:00Z",
      sessions: [] as WorkSession[],
    },
    evidence: {
      revision: `evidence-completed-work:${"4".repeat(64)}`,
      items: [] as EvidenceAnswer[],
    },
    mastery: {
      policyVersion: "mastery-prerequisite-satisfaction/0.1",
      revision: `mastery-prerequisite:${"c".repeat(64)}`,
      items: [
        {
          competencyRef: "competency:foundations",
          projectionFence: "not-materialized",
          projection: null,
        },
      ],
    },
    review: {
      revision: `review-scope:${"d".repeat(64)}`,
      projectionState: "NOT_STARTED",
      overdueCount: 0,
      dueTodayCount: 0,
      validUntil: null,
      items: [],
    },
    visibleDeliveryIds: ["26000000-0000-4000-8000-000000000107"],
  };
}

const WEEK_DATES = [
  "2026-08-31",
  "2026-09-01",
  "2026-09-02",
  "2026-09-03",
  "2026-09-04",
  "2026-09-05",
  "2026-09-06",
] as const;

/** Seven consecutive plan-week day caps, one entry per `WEEK_DATES`, matching `sourceBundle()`. */
function dailyCaps(capMinutes: number | readonly number[]) {
  const caps = Array.isArray(capMinutes)
    ? (capMinutes as readonly number[])
    : (Array(7).fill(capMinutes) as readonly number[]);
  return WEEK_DATES.map((date, index) => ({
    date,
    capMinutes: caps[index],
    sourceWindowKey: null as string | null,
  }));
}

describe("assemblePlanSnapshotInput", () => {
  it("builds a canonical, engine-valid input without inventing unresolved mastery semantics", () => {
    const input = assemblePlanSnapshotInput(sourceBundle());
    expect(input.evaluationHorizon.asOf).toBe("2026-08-31T12:00:00+00:00");
    expect(input.candidates[0]).toMatchObject({
      candidateKey: "candidate:debug-api",
      prerequisiteState: "UNKNOWN",
      prerequisiteSummary: { total: 1, satisfied: 0, blocked: 0, unknown: 1 },
      unlockCount: 2,
      repetitionsInLast7Days: 0,
    });
    expect(input.sourceRevisions.map(({ owner, key }) => `${owner}/${key}`)).toEqual([
      "CATALOG/catalog:v1",
      "EVIDENCE/completed-work",
      "FOCUS/completed-work",
      "FOCUS/workspace-focus",
      "MASTERY/prerequisite-scope",
      "OVERLAY/workspace-overlay",
      "REVIEW/workspace-review",
    ]);
    expect(calculatePlan(input, PLANNING_POLICY_V0_1).recommendationState).toBe("NO_CANDIDATES");
  });

  it("preserves the owner claim clock including PostgreSQL microseconds", () => {
    const source = sourceBundle();
    const claimAsOf = "2026-08-31T12:00:00.123456+00:00";

    const input = assemblePlanSnapshotInput({ ...source, claimAsOf });

    expect(input.evaluationHorizon.asOf).toBe(claimAsOf);
    expect(calculatePlan(input, PLANNING_POLICY_V0_1).calculatedAsOf).toBe(claimAsOf);
  });

  it("accepts the C5 owner contract for an empty no-plan bundle", () => {
    const source = sourceBundle();
    const input = assemblePlanSnapshotInput({
      ...source,
      plan: null,
      targets: { items: [] },
      overlay: { ...source.overlay, items: [] },
      catalog: { versions: [], items: [] },
      mastery: { ...source.mastery, items: [] },
    });

    expect(input).toMatchObject({
      growthPlan: null,
      candidates: [],
      prerequisiteEngineVersion: "mastery-prerequisite-engine/0.1.0",
      prerequisitePolicyVersion: "mastery-prerequisite-satisfaction/0.1",
    });
  });

  it("records the completed-work policy version and both new owner fences", () => {
    const input = assemblePlanSnapshotInput(sourceBundle());
    expect(input.completedWorkPolicyVersion).toBe("planning-completed-work/0.1");
    expect(input.prerequisiteEngineVersion).toBe("mastery-prerequisite-engine/0.1.0");
    expect(input.prerequisitePolicyVersion).toBe("mastery-prerequisite-satisfaction/0.1");
    expect(input.sourceRevisions).toEqual(
      expect.arrayContaining([
        {
          owner: "EVIDENCE",
          key: "completed-work",
          revision: `evidence-completed-work:${"4".repeat(64)}`,
        },
        { owner: "FOCUS", key: "completed-work", revision: `completed-work:${"f".repeat(64)}` },
      ]),
    );
    expect(input.growthPlan?.consumedMinutesThisWeek).toBe(0);
    expect(input.growthPlan?.tracks[0]?.meaningfulMinutesThisWeek).toBe(0);
    expect(input.candidates[0]?.repetitionWindowEndsAt).toBeNull();
  });

  it("assembles V2 cadence from the same evidence-bearing current-week session set", () => {
    const currentEvidence = terminalSession();
    const completionOnly = terminalSession({ evidenceBearing: false });
    const stopped = terminalSession({ state: "STOPPED", evidenceBearing: false });
    const priorWeekEvidence = terminalSession({
      startedAt: "2026-08-30T09:00:00Z",
      endedAt: "2026-08-30T09:25:00Z",
    });
    const source = withWork([currentEvidence, completionOnly, stopped, priorWeekEvidence]);

    const v1 = assemblePlanSnapshotInput(source);
    const v2 = assemblePlanSnapshotInputV2(source);

    expect(v1.growthPlan?.tracks[0]).not.toHaveProperty("cadencePerWeek");
    expect(v2).toMatchObject({
      completedWorkPolicyVersion: "planning-completed-work/0.2",
      growthPlan: {
        tracks: [
          {
            cadencePerWeek: 3,
            completedCadenceSessionsThisWeek: 1,
          },
        ],
      },
    });
    expect(v2.inputFingerprint).not.toBe(v1.inputFingerprint);
    const result = calculatePlanV2(v2, PLANNING_POLICY_V0_2);
    expect(result).toMatchObject({
      engineVersion: "planner-engine/0.2.0",
      policyVersion: "planning-policy/0.2",
    });
  });

  it("keeps the V2 cadence window half-open at weekEnd", () => {
    const source = sourceBundle();
    const endedAtWeekEnd = terminalSession({
      startedAt: "2026-09-06T23:35:00Z",
      endedAt: "2026-09-07T00:00:00Z",
    });
    const input = assemblePlanSnapshotInputV2(
      withWork([endedAtWeekEnd], {
        ...source,
        claimAsOf: "2026-09-07T00:05:00+00:00",
      }),
    );

    expect(input.growthPlan?.tracks[0]?.completedCadenceSessionsThisWeek).toBe(0);
  });

  it("refuses duplicate activity attribution instead of overwriting it", () => {
    const source = sourceBundle();
    const duplicate = {
      ...source,
      plan: {
        ...source.plan,
        activities: [...source.plan.activities, structuredClone(source.plan.activities[0]!)],
      },
    };

    for (const assemble of [assemblePlanSnapshotInput, assemblePlanSnapshotInputV2]) {
      expect(() => assemble(duplicate)).toThrowError(
        expect.objectContaining<Partial<PlanningProjectionSourceError>>({
          code: "OWNER_FENCE_CONFLICT",
        }),
      );
    }
  });

  it("counts an evidence-bearing completion as capacity, cadence credit, and repetition", () => {
    const input = assemblePlanSnapshotInput(withWork([terminalSession()]));
    expect(input.growthPlan?.consumedMinutesThisWeek).toBe(25);
    expect(input.growthPlan?.tracks[0]?.meaningfulMinutesThisWeek).toBe(25);
    expect(input.candidates[0]).toMatchObject({
      repetitionsInLast7Days: 1,
      oldestRepetitionEndedAt: "2026-08-31T09:25:00.000Z",
      repetitionWindowEndsAt: "2026-09-07T09:25:00.000Z",
    });
    expect(() => calculatePlan(input, PLANNING_POLICY_V0_1)).not.toThrow();
  });

  it("bounds a long session by planned minutes and clips it to the plan week", () => {
    const overrun = assemblePlanSnapshotInput(
      withWork([
        terminalSession({ startedAt: "2026-08-31T06:00:00Z", endedAt: "2026-08-31T11:00:00Z" }),
      ]),
    );
    expect(overrun.growthPlan?.consumedMinutesThisWeek).toBe(25);

    const straddling = assemblePlanSnapshotInput(
      withWork([
        terminalSession({
          startedAt: "2026-08-30T23:50:00Z",
          endedAt: "2026-08-31T00:05:00Z",
          plannedMinutes: 30,
        }),
      ]),
    );
    expect(straddling.growthPlan?.consumedMinutesThisWeek).toBe(5);

    const shorterThanPlanned = assemblePlanSnapshotInput(
      withWork([terminalSession({ endedAt: "2026-08-31T09:07:30Z" })]),
    );
    expect(shorterThanPlanned.growthPlan?.consumedMinutesThisWeek).toBe(7);
  });

  it("separates abandoned work, completion-only work, and evidence-bearing work", () => {
    const stopped = assemblePlanSnapshotInput(
      withWork([terminalSession({ state: "STOPPED", evidenceBearing: false })]),
    );
    expect(stopped.growthPlan?.consumedMinutesThisWeek).toBe(0);
    expect(stopped.growthPlan?.tracks[0]?.meaningfulMinutesThisWeek).toBe(0);
    expect(stopped.candidates[0]?.repetitionsInLast7Days).toBe(0);

    const completionOnly = assemblePlanSnapshotInput(
      withWork([terminalSession({ evidenceBearing: false })]),
    );
    expect(completionOnly.growthPlan?.consumedMinutesThisWeek).toBe(25);
    expect(completionOnly.growthPlan?.tracks[0]?.meaningfulMinutesThisWeek).toBe(0);
    expect(completionOnly.candidates[0]?.repetitionsInLast7Days).toBe(1);
  });

  it("counts a repetition from the previous week and caps snapshot validity at its expiry", () => {
    const input = assemblePlanSnapshotInput(
      withWork([
        terminalSession({
          startedAt: "2026-08-30T09:30:00Z",
          endedAt: "2026-08-30T10:00:00Z",
        }),
      ]),
    );
    expect(input.growthPlan?.consumedMinutesThisWeek).toBe(0);
    expect(input.candidates[0]).toMatchObject({
      repetitionsInLast7Days: 1,
      oldestRepetitionEndedAt: "2026-08-30T10:00:00.000Z",
      repetitionWindowEndsAt: "2026-09-06T10:00:00.000Z",
    });
    expect(input.evaluationHorizon.validUntil).toBe("2026-09-06T09:59:59.999Z");
    expect(() => calculatePlan(input, PLANNING_POLICY_V0_1)).not.toThrow();
  });

  it("ignores work outside the repetition window and untracked activity attribution", () => {
    // The repetition window is half-open: a session that ended exactly 168 hours before the claim
    // clock has already left it.
    const expired = assemblePlanSnapshotInput(
      withWork([
        terminalSession({
          startedAt: "2026-08-24T11:35:00Z",
          endedAt: "2026-08-24T12:00:00Z",
        }),
      ]),
    );
    expect(expired.candidates[0]?.repetitionsInLast7Days).toBe(0);
    expect(expired.candidates[0]?.oldestRepetitionEndedAt).toBeNull();
    expect(expired.candidates[0]?.repetitionWindowEndsAt).toBeNull();

    const untracked = assemblePlanSnapshotInput(
      withWork([terminalSession({ customActivityId: "26000000-0000-4000-8000-000000000199" })]),
    );
    expect(untracked.growthPlan?.consumedMinutesThisWeek).toBe(25);
    expect(untracked.growthPlan?.tracks[0]?.meaningfulMinutesThisWeek).toBe(0);
    expect(untracked.candidates[0]?.repetitionsInLast7Days).toBe(0);
  });

  it.each([
    [
      "a non-terminal attempt",
      () => withWork([terminalSession({ attemptTerminal: false })]),
      "UNSUPPORTED_MEANINGFUL_WORK_HISTORY",
    ],
    [
      "a stopped session that claims evidence",
      () => withWork([terminalSession({ state: "STOPPED", evidenceBearing: true })]),
      "UNSUPPORTED_MEANINGFUL_WORK_HISTORY",
    ],
    [
      "a session that ends after the claim clock",
      () =>
        withWork([
          terminalSession({
            startedAt: "2026-08-31T12:30:00Z",
            endedAt: "2026-08-31T12:55:00Z",
          }),
        ]),
      "UNSUPPORTED_MEANINGFUL_WORK_HISTORY",
    ],
    [
      "a window that does not cover the policy horizon",
      () => {
        const source = withWork([]);
        return {
          ...source,
          completedWork: { ...source.completedWork, windowStart: "2026-08-31T00:00:00Z" },
        };
      },
      "UNSUPPORTED_MEANINGFUL_WORK_HISTORY",
    ],
    [
      "a missing Evidence answer",
      () => {
        const source = withWork([terminalSession()]);
        return { ...source, evidence: { ...source.evidence, items: [] } };
      },
      "UNSUPPORTED_MEANINGFUL_WORK_HISTORY",
    ],
    [
      "an Evidence answer about an unreturned session",
      () => {
        const source = withWork([terminalSession()]);
        return {
          ...source,
          completedWork: { ...source.completedWork, sessions: [] },
        };
      },
      "MISSING_SESSION_SOURCE",
    ],
    [
      "more terminal sessions than the source bound",
      () => withWork(Array.from({ length: 501 }, () => terminalSession())),
      "COMPLETED_WORK_SOURCE_BOUND",
    ],
  ])("fails closed on %s", (_label, build, code) => {
    expect(() => assemblePlanSnapshotInput(build())).toThrowError(
      expect.objectContaining<Partial<PlanningProjectionSourceError>>({ code }),
    );
  });

  it("assembles current readiness, due Review, active Focus, and prerequisite-free candidates", () => {
    const source = sourceBundle();
    const target = source.targets.items[0];
    const activity = source.plan.activities[0];
    const graph = source.catalog.items[0];
    const input = assemblePlanSnapshotInput({
      ...source,
      plan: {
        ...source.plan,
        activities: [{ ...activity, energy: null }],
      },
      targets: {
        items: [
          {
            ...target,
            availability: "CURRENT",
            reason: null,
            snapshotId: "26000000-0000-4000-8000-000000000108",
            inputFingerprint: `readiness-input:${"e".repeat(64)}`,
            calculatedAsOf: "2026-08-31T11:00:00Z",
            validUntil: "2026-09-02T12:00:00Z",
            status: "DEVELOPING",
            coverage: 0.75,
            confidence: "MEDIUM",
            blockers: [{ code: "UNKNOWN_FLOOR", ruleKey: "rule:floor" }],
            gaps: [
              {
                gapCode: "KNOWN_SHORTFALL",
                competencyRef: "competency:debugging",
                dimension: "APPLICATION",
              },
            ],
          },
        ],
      },
      catalog: {
        ...source.catalog,
        items: [{ ...graph, prerequisiteCount: 0, prerequisiteRefs: [] }],
      },
      mastery: { ...source.mastery, items: [] },
      focus: {
        ...source.focus,
        activeFocus: {
          focusSessionId: "26000000-0000-4000-8000-000000000109",
          readinessGoalKey: "goal:backend",
          activityKey: "activity:debug-api",
          title: "Debug an API",
          plannedMinutes: 25,
          startedAt: "2026-08-31T11:55:00Z",
          planAttribution: {
            planSnapshotId: "26000000-0000-4000-8000-000000000111",
            candidateKey: "candidate:debug-api",
            trackId: "26000000-0000-4000-8000-000000000102",
          },
        },
      },
      review: {
        ...source.review,
        projectionState: "CURRENT",
        overdueCount: 1,
        validUntil: "2026-09-01T12:00:00Z",
        items: [
          {
            readinessGoalKey: "goal:backend",
            activityKey: "activity:debug-api",
            reviewItemId: "26000000-0000-4000-8000-000000000110",
            bucket: "OVERDUE",
            dueAt: "2026-08-30T12:00:00Z",
          },
        ],
      },
    });

    expect(input.evaluationHorizon.validUntil).toBe("2026-09-01T12:00:00.000Z");
    expect(input.readiness[0]).toMatchObject({
      availability: "CURRENT",
      confidence: "MEDIUM",
      coverage: 0.75,
    });
    expect(input.activeFocus).toMatchObject({
      focusSessionId: "26000000-0000-4000-8000-000000000109",
      startedAt: "2026-08-31T11:55:00.000Z",
      planAttribution: {
        planSnapshotId: "26000000-0000-4000-8000-000000000111",
        candidateKey: "candidate:debug-api",
        trackId: "26000000-0000-4000-8000-000000000102",
      },
    });
    expect(input.candidates[0]).toMatchObject({
      energy: null,
      prerequisiteState: "SATISFIED",
      prerequisiteSummary: { total: 0, satisfied: 0, blocked: 0, unknown: 0 },
      sourceSignals: ["GROWTH_PLAN", "REVIEW"],
      review: { bucket: "OVERDUE", dueAt: "2026-08-30T12:00:00.000Z" },
    });
    expect(calculatePlan(input, PLANNING_POLICY_V0_1).recommendationState).toBe("CURRENT");
  });

  it.each([
    ["missing attribution", undefined],
    [
      "partial attribution",
      {
        planSnapshotId: "26000000-0000-4000-8000-000000000111",
        candidateKey: "candidate:debug-api",
      },
    ],
    [
      "additional attribution data",
      {
        planSnapshotId: "26000000-0000-4000-8000-000000000111",
        candidateKey: "candidate:debug-api",
        trackId: null,
        privateNote: "must not cross the owner boundary",
      },
    ],
    [
      "malformed attribution",
      { planSnapshotId: "not-a-uuid", candidateKey: "active-focus:forged", trackId: null },
    ],
  ])("fails closed on active Focus %s", (_label, planAttribution) => {
    const source = sourceBundle();
    expect(() =>
      assemblePlanSnapshotInput({
        ...source,
        focus: {
          ...source.focus,
          activeFocus: {
            focusSessionId: "26000000-0000-4000-8000-000000000109",
            readinessGoalKey: "goal:backend",
            activityKey: "activity:debug-api",
            title: "Debug an API",
            plannedMinutes: 25,
            startedAt: "2026-08-31T11:55:00Z",
            planAttribution,
          },
        },
      }),
    ).toThrowError(
      expect.objectContaining<Partial<PlanningProjectionSourceError>>({
        code: "INVALID_OWNER_SOURCE",
      }),
    );
  });

  it("aggregates Mastery classifications with Blocked precedence and caps validity", () => {
    const source = sourceBundle();
    const graph = source.catalog.items[0];
    const input = assemblePlanSnapshotInput({
      ...source,
      catalog: {
        ...source.catalog,
        items: [
          {
            ...graph,
            prerequisiteCount: 3,
            prerequisiteRefs: ["competency:blocked", "competency:satisfied", "competency:unknown"],
          },
        ],
      },
      mastery: {
        ...source.mastery,
        items: [
          {
            competencyRef: "competency:blocked",
            projectionFence: "blocked:1",
            projection: prerequisiteProjection(
              "competency:blocked",
              "WEAK",
              "NOT_STARTED",
              "2026-07-03T12:00:00Z",
            ),
          },
          {
            competencyRef: "competency:satisfied",
            projectionFence: "satisfied:1",
            projection: prerequisiteProjection(
              "competency:satisfied",
              "STRONG",
              "COMPLETED",
              "2026-07-04T12:00:00Z",
            ),
          },
          {
            competencyRef: "competency:unknown",
            projectionFence: "not-materialized",
            projection: null,
          },
        ],
      },
    });

    expect(input.candidates[0]).toMatchObject({
      prerequisiteState: "BLOCKED",
      prerequisiteSummary: { total: 3, satisfied: 1, blocked: 1, unknown: 1 },
    });
    expect(input.evaluationHorizon.validUntil).toBe("2026-09-01T12:00:00.000Z");
  });

  it("fails closed on incomplete or conflicting prerequisite owner answers", () => {
    const source = sourceBundle();
    expect(() =>
      assemblePlanSnapshotInput({ ...source, mastery: { ...source.mastery, items: [] } }),
    ).toThrowError(
      expect.objectContaining<Partial<PlanningProjectionSourceError>>({
        code: "MISSING_MASTERY_SOURCE",
      }),
    );

    expect(() =>
      assemblePlanSnapshotInput({
        ...source,
        mastery: {
          ...source.mastery,
          items: [
            ...source.mastery.items,
            {
              competencyRef: "competency:unrequested",
              projectionFence: "not-materialized",
              projection: null,
            },
          ],
        },
      }),
    ).toThrowError(
      expect.objectContaining<Partial<PlanningProjectionSourceError>>({
        code: "OWNER_FENCE_CONFLICT",
      }),
    );
  });

  it("holds the completed-work invariants for arbitrary terminal history", () => {
    const windowStartMs = Date.parse("2026-08-24T12:00:00Z");
    const asOfMs = Date.parse("2026-08-31T12:00:00Z");
    const untrackedActivityId = "26000000-0000-4000-8000-000000000199";

    const workArbitrary = fc.array(
      fc.record({
        endedAtMs: fc.integer({ min: windowStartMs, max: asOfMs }),
        elapsedSeconds: fc.integer({ min: 0, max: 40_000 }),
        plannedMinutes: fc.integer({ min: 1, max: 480 }),
        completed: fc.boolean(),
        evidenceBearing: fc.boolean(),
        tracked: fc.boolean(),
      }),
      { maxLength: 24 },
    );

    fc.assert(
      fc.property(workArbitrary, fc.array(fc.nat(), { maxLength: 24 }), (rows, shuffleKeys) => {
        const entries = rows.map((row, index) => {
          const focusSessionId = `28000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
          const evidenceBearing = row.completed && row.evidenceBearing;
          return {
            session: {
              focusSessionId,
              customActivityId: row.tracked ? trackedActivityId : untrackedActivityId,
              activityKey: "activity:debug-api",
              readinessGoalKey: "goal:backend",
              state: row.completed ? ("COMPLETED" as const) : ("STOPPED" as const),
              startedAt: new Date(row.endedAtMs - row.elapsedSeconds * 1_000).toISOString(),
              endedAt: new Date(row.endedAtMs).toISOString(),
              plannedMinutes: row.plannedMinutes,
            },
            answer: { focusSessionId, attemptTerminal: true, evidenceBearing },
          };
        });

        const input = assemblePlanSnapshotInput(withWork(entries));
        const consumed = input.growthPlan!.consumedMinutesThisWeek;
        const credited = input.growthPlan!.tracks.reduce(
          (total, track) => total + track.meaningfulMinutesThisWeek,
          0,
        );
        const plannedCeiling = rows
          .filter(({ completed }) => completed)
          .reduce((total, row) => total + row.plannedMinutes, 0);

        // Consumed capacity is bounded by the week, by the user's own planned minutes, and is
        // never smaller than the cadence credit derived from the same sessions.
        expect(consumed).toBeGreaterThanOrEqual(0);
        expect(consumed).toBeLessThanOrEqual(10_080);
        expect(consumed).toBeLessThanOrEqual(plannedCeiling);
        expect(credited).toBeLessThanOrEqual(consumed);

        const expectedRepetitions = Math.min(
          50,
          rows.filter((row, index) => {
            void index;
            return row.completed && row.tracked && row.endedAtMs > asOfMs - 604_800_000;
          }).length,
        );
        const candidate = input.candidates[0]!;
        expect(candidate.repetitionsInLast7Days).toBe(expectedRepetitions);
        expect(candidate.oldestRepetitionEndedAt === null).toBe(expectedRepetitions === 0);
        expect(candidate.repetitionWindowEndsAt === null).toBe(expectedRepetitions === 0);
        if (
          candidate.oldestRepetitionEndedAt !== null &&
          candidate.repetitionWindowEndsAt !== null
        ) {
          expect(
            Date.parse(candidate.repetitionWindowEndsAt) -
              Date.parse(candidate.oldestRepetitionEndedAt),
          ).toBe(604_800_000);
          expect(Date.parse(input.evaluationHorizon.validUntil)).toBeLessThan(
            Date.parse(candidate.repetitionWindowEndsAt),
          );
        }

        // Owner rows are set-like: the canonical fingerprint cannot depend on their order.
        const permuted = [...entries].sort(
          (left, right) =>
            (shuffleKeys[entries.indexOf(left)] ?? 0) - (shuffleKeys[entries.indexOf(right)] ?? 0),
        );
        const reordered = assemblePlanSnapshotInput({
          ...withWork(permuted),
          evidence: {
            ...sourceBundle().evidence,
            items: [...permuted].reverse().map(({ answer }) => answer),
          },
        });
        expect(reordered.inputFingerprint).toBe(input.inputFingerprint);

        // Abandoned work never adds capacity, cadence credit, or repetition.
        const withStopped = assemblePlanSnapshotInput(
          withWork([...entries, terminalSession({ state: "STOPPED", evidenceBearing: false })]),
        );
        expect(withStopped.growthPlan!.consumedMinutesThisWeek).toBe(consumed);
        expect(withStopped.candidates[0]!.repetitionsInLast7Days).toBe(expectedRepetitions);
      }),
      { numRuns: 120 },
    );
  });

  it("rejects conflicting duplicate owner rows", () => {
    const source = sourceBundle();
    const target = source.targets.items[0];
    expect(() =>
      assemblePlanSnapshotInput({
        ...source,
        targets: {
          items: [
            target,
            {
              ...target,
              readinessGoalId: "26000000-0000-4000-8000-000000000111",
            },
          ],
        },
      }),
    ).toThrowError(
      expect.objectContaining<Partial<PlanningProjectionSourceError>>({
        code: "OWNER_FENCE_CONFLICT",
      }),
    );
  });

  it("rejects duplicate Review correlation and missing owner rows", () => {
    const source = sourceBundle();
    const reviewItem = {
      readinessGoalKey: "goal:backend",
      activityKey: "activity:debug-api",
      reviewItemId: "26000000-0000-4000-8000-000000000112",
      bucket: "DUE_TODAY",
      dueAt: "2026-08-31T15:00:00Z",
    };
    expect(() =>
      assemblePlanSnapshotInput({
        ...source,
        review: {
          ...source.review,
          items: [
            reviewItem,
            {
              ...reviewItem,
              reviewItemId: "26000000-0000-4000-8000-000000000113",
            },
          ],
        },
      }),
    ).toThrowError(
      expect.objectContaining<Partial<PlanningProjectionSourceError>>({
        code: "DUPLICATE_REVIEW_FOCUS_PAIR",
      }),
    );

    expect(() =>
      assemblePlanSnapshotInput({ ...source, overlay: { ...source.overlay, items: [] } }),
    ).toThrowError(
      expect.objectContaining<Partial<PlanningProjectionSourceError>>({
        code: "MISSING_OVERLAY_SOURCE",
      }),
    );
  });

  describe("assemblePlanSnapshotInputV3", () => {
    it("matches V2's shape and derives effective capacity equal to the default when unlimited", () => {
      const source = { ...sourceBundle(), availability: { dailyCaps: dailyCaps(1_440) } };

      const v2 = assemblePlanSnapshotInputV2(sourceBundle());
      const v3 = assemblePlanSnapshotInputV3(source);

      expect(v3.growthPlan).not.toHaveProperty("weeklyCapacityMinutes");
      expect(v3).toMatchObject({
        completedWorkPolicyVersion: "planning-completed-work/0.2",
        growthPlan: {
          defaultWeeklyCapacityMinutes: 300,
          effectiveWeeklyCapacityMinutes: 300,
          tracks: [{ cadencePerWeek: 3 }],
        },
      });
      const v2Result = calculatePlanV2(v2, PLANNING_POLICY_V0_2);
      const v3Result = calculatePlanV3(v3, PLANNING_POLICY_V0_3);
      expect(v3Result.warningCodes).not.toContain("PROTECTED_MINIMUM_LIMITED_BY_AVAILABILITY");
      expect(v3Result).toMatchObject({
        engineVersion: "planner-engine/0.3.0",
        policyVersion: "planning-policy/0.3",
        recommendationState: v2Result.recommendationState,
      });
    });

    it("derives a below-default effective capacity from real day caps and rations protected minutes", () => {
      // The Track's protectedMinimumMinutes is 60; 7 x 5 = 35 forces it below that minimum.
      const source = { ...sourceBundle(), availability: { dailyCaps: dailyCaps(5) } };

      const v3 = assemblePlanSnapshotInputV3(source);

      expect(v3.growthPlan?.effectiveWeeklyCapacityMinutes).toBe(35);
      const result = calculatePlanV3(v3, PLANNING_POLICY_V0_3);
      expect(result.capacity).toMatchObject({
        defaultWeeklyCapacityMinutes: 300,
        effectiveWeeklyCapacityMinutes: 35,
      });
      expect(result.warningCodes).toContain("PROTECTED_MINIMUM_LIMITED_BY_AVAILABILITY");
    });

    it("fails closed when the source bundle supplies other than exactly seven day caps", () => {
      const source = {
        ...sourceBundle(),
        availability: { dailyCaps: dailyCaps(1_440).slice(0, 6) },
      };

      expect(() => assemblePlanSnapshotInputV3(source)).toThrowError(
        expect.objectContaining<Partial<PlanningProjectionSourceError>>({
          code: "INVALID_OWNER_SOURCE",
        }),
      );
    });
  });

  describe("assemblePlanSnapshotInputV4", () => {
    function v4Source() {
      return { ...sourceBundle(), availability: { dailyCaps: dailyCaps(1_440) } };
    }

    it("matches V3's shape and output when no campaign or override is present", () => {
      const source = v4Source();

      const v3 = assemblePlanSnapshotInputV3(source);
      const v4 = assemblePlanSnapshotInputV4(source);

      expect(v4.campaign).toBeNull();
      expect(v4.growthPlan?.tracks[0]).toMatchObject({ allocationOverride: null });
      const v3Result = calculatePlanV3(v3, PLANNING_POLICY_V0_3);
      const v4Result = calculatePlanV4(v4, PLANNING_POLICY_V0_4);
      expect(v4Result).toMatchObject({
        engineVersion: "planner-engine/0.4.0",
        policyVersion: "planning-policy/0.4",
        recommendationState: v3Result.recommendationState,
        capacity: v3Result.capacity,
      });
    });

    it("resolves bundle.campaign through the Targets readiness source, like a Track does", () => {
      const source = {
        ...v4Source(),
        campaign: {
          campaignId: "26000000-0000-4000-8000-000000000120",
          version: "1",
          title: "Backend loop",
          readinessGoalId: "26000000-0000-4000-8000-000000000103",
          deadlineAt: "2026-09-15T00:00:00Z",
        },
      };

      const v4 = assemblePlanSnapshotInputV4(source);

      expect(v4.campaign).toMatchObject({
        campaignId: "26000000-0000-4000-8000-000000000120",
        version: "1",
        title: "Backend loop",
        readinessGoalKey: "goal:backend",
        targetProfileVersionKey: "target:backend-v1",
        deadlineAt: "2026-09-15T00:00:00.000Z",
      });
    });

    it("fails closed when the campaign references an unknown readiness goal", () => {
      const source = {
        ...v4Source(),
        campaign: {
          campaignId: "26000000-0000-4000-8000-000000000120",
          version: "1",
          title: "Backend loop",
          readinessGoalId: "26000000-0000-4000-8000-000000000199",
          deadlineAt: "2026-09-15T00:00:00Z",
        },
      };

      expect(() => assemblePlanSnapshotInputV4(source)).toThrowError(
        expect.objectContaining<Partial<PlanningProjectionSourceError>>({
          code: "MISSING_TARGET_SOURCE",
        }),
      );
    });

    it("assembles a Track's allocationOverride from the same raw track object", () => {
      const source = v4Source();
      const withOverride = {
        ...source,
        plan: {
          ...source.plan,
          tracks: [
            {
              ...source.plan.tracks[0],
              allocationOverride: {
                overrideId: "26000000-0000-4000-8000-000000000121",
                version: "1",
                priorityOverride: 95,
                protectedMinimumMinutesOverride: null,
                cadencePerWeekOverride: null,
              },
            },
          ],
        },
      };

      const v4 = assemblePlanSnapshotInputV4(withOverride);

      expect(v4.growthPlan?.tracks[0]?.allocationOverride).toEqual({
        overrideId: "26000000-0000-4000-8000-000000000121",
        version: "1",
        priorityOverride: 95,
        protectedMinimumMinutesOverride: null,
        cadencePerWeekOverride: null,
      });
      expect(() => calculatePlanV4(v4, PLANNING_POLICY_V0_4)).not.toThrow();
    });

    it("treats an absent allocationOverride identically to an explicit null", () => {
      const source = v4Source();
      const withoutKey = {
        ...source,
        plan: { ...source.plan, tracks: [{ ...source.plan.tracks[0] }] },
      };
      const withNull = {
        ...source,
        plan: {
          ...source.plan,
          tracks: [{ ...source.plan.tracks[0], allocationOverride: null }],
        },
      };

      expect(assemblePlanSnapshotInputV4(withoutKey).growthPlan?.tracks[0]).toMatchObject({
        allocationOverride: null,
      });
      expect(assemblePlanSnapshotInputV4(withNull).growthPlan?.tracks[0]).toMatchObject({
        allocationOverride: null,
      });
    });
  });
});
