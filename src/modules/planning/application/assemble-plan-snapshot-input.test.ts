import { describe, expect, it } from "vitest";

import { calculatePlan } from "./calculate-plan";
import {
  assemblePlanSnapshotInput,
  PlanningProjectionSourceError,
} from "./assemble-plan-snapshot-input";
import { PLANNING_POLICY_V0_1 } from "../domain/planning-policy-v0.1";

function sourceBundle() {
  return {
    claimAsOf: "2026-08-31 12:00:00+00",
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
          unlockCount: 2,
        },
      ],
    },
    focus: {
      revision: `focus-scope:${"b".repeat(64)}`,
      terminalCount: 0,
      activeFocus: null,
    },
    mastery: { revision: `mastery-scope:${"c".repeat(64)}` },
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

describe("assemblePlanSnapshotInput", () => {
  it("builds a canonical, engine-valid input without inventing unresolved mastery semantics", () => {
    const input = assemblePlanSnapshotInput(sourceBundle());
    expect(input.evaluationHorizon.asOf).toBe("2026-08-31T12:00:00.000Z");
    expect(input.candidates[0]).toMatchObject({
      candidateKey: "candidate:debug-api",
      prerequisiteState: "UNKNOWN",
      unlockCount: 2,
      repetitionsInLast7Days: 0,
    });
    expect(input.sourceRevisions.map(({ owner }) => owner)).toEqual([
      "CATALOG",
      "FOCUS",
      "MASTERY",
      "OVERLAY",
      "REVIEW",
    ]);
    expect(calculatePlan(input, PLANNING_POLICY_V0_1).recommendationState).toBe("NO_CANDIDATES");
  });

  it("fails closed when completed work would require an unapproved duration policy", () => {
    const source = sourceBundle();
    source.focus.terminalCount = 1;
    expect(() => assemblePlanSnapshotInput(source)).toThrowError(
      expect.objectContaining<Partial<PlanningProjectionSourceError>>({
        code: "UNSUPPORTED_MEANINGFUL_WORK_HISTORY",
      }),
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
      catalog: { ...source.catalog, items: [{ ...graph, prerequisiteCount: 0 }] },
      focus: {
        ...source.focus,
        activeFocus: {
          focusSessionId: "26000000-0000-4000-8000-000000000109",
          readinessGoalKey: "goal:backend",
          activityKey: "activity:debug-api",
          title: "Debug an API",
          plannedMinutes: 25,
          startedAt: "2026-08-31T11:55:00Z",
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
      planAttribution: null,
    });
    expect(input.candidates[0]).toMatchObject({
      energy: null,
      prerequisiteState: "SATISFIED",
      sourceSignals: ["GROWTH_PLAN", "REVIEW"],
      review: { bucket: "OVERDUE", dueAt: "2026-08-30T12:00:00.000Z" },
    });
    expect(calculatePlan(input, PLANNING_POLICY_V0_1).recommendationState).toBe("CURRENT");
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
});
