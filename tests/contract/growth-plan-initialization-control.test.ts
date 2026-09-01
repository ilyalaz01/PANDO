// @vitest-environment node

import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  GROWTH_PLAN_INITIALIZATION_COMMAND_TYPE,
  GROWTH_PLAN_INITIALIZATION_PREVIEW_DIGEST_VERSION,
  GROWTH_PLAN_INITIALIZATION_REQUEST_HASH_VERSION,
  PLANNING_CREATE_IDENTITY_VERSION,
  growthPlanInitializationPreviewDigestInput,
  growthPlanInitializationRequestHashInput,
  initialLearningTrackTitle,
  planningCreateIdentityInput,
  planningCreateUuidFromSha256,
  type GrowthPlanInitializationPreviewDigestFields,
} from "../../src/modules/planning/domain/growth-plan-initialization-preview";
import {
  GrowthPlanInitializationContractError,
  decodeGrowthPlanInitializationApplyResultV1,
  decodeGrowthPlanInitializationPreviewV1,
  decodeGrowthPlanSetupSourceV1,
  growthPlanInitializationControlSemanticViolations,
  validateGrowthPlanInitializationControlV1,
} from "../../src/shared/contracts/growth-plan-initialization-control";
import { validateSchema } from "../../src/shared/contracts/schema-registry";
import boundary from "./fixtures/planning/v1/growth-plan-initialization-control.boundary.json";
import invalid from "./fixtures/planning/v1/growth-plan-initialization-control.invalid.json";
import malicious from "./fixtures/planning/v1/growth-plan-initialization-control.malicious.json";
import valid from "./fixtures/planning/v1/growth-plan-initialization-control.valid.json";

function sha256Bytes(value: string): Uint8Array {
  return createHash("sha256").update(value, "utf8").digest();
}

function digestFields(): GrowthPlanInitializationPreviewDigestFields {
  return {
    workspaceId: "A0000000-0000-4000-8000-000000000001",
    idempotencyKey: "B0000000-0000-4000-8000-000000000001",
    reason: "Start — 学習",
    expectedReadinessGoalVersion: "7",
    source: {
      readinessGoalId: "C0000000-0000-4000-8000-000000000001",
      readinessGoalKey: "goal:backend-readiness",
      readinessGoalTitle: "Backend readiness — 学習",
      readinessGoalLifecycle: "ACTIVE",
      readinessGoalVersion: "7",
      profileVersionId: "D0000000-0000-4000-8000-000000000001",
      profileVersionKey: "target:backend-engineer-v1",
      sourceKind: "ROADMAP_TEMPLATE_VERSION",
      sourceRef: "E0000000-0000-4000-8000-000000000001",
      roadmapVersionId: "E0000000-0000-4000-8000-000000000001",
      sourceOwnerRevision: "readiness-goal:7",
    },
    before: { lifetimePlanCount: 0, currentPlanCount: 0, snapshotSentinelCount: 0 },
    after: {
      lifetimePlanCount: 1,
      currentPlanCount: 1,
      currentPlanLimit: 1,
      snapshotSentinelCount: 1,
      growthPlan: {
        growthPlanId: "F0000000-0000-8000-8000-000000000001",
        title: "Backend readiness — 学習",
        lifecycle: "ACTIVE",
        weeklyCapacityMinutes: 600,
        aggregateVersion: "1",
      },
      learningTrack: {
        learningTrackId: "10000000-0000-8000-8000-000000000001",
        trackKey: "track:10000000-0000-8000-8000-000000000001",
        title: "Backend readiness — 学習",
        lifecycle: "ACTIVE",
        priority: 50,
        protectedMinimumMinutes: 0,
        defaultSessionMinutes: 30,
        aggregateVersion: "1",
      },
    },
    canApply: true,
    blockingReasonCode: null,
    warnings: ["INITIAL_TRACK_HAS_NO_ACTIVITIES"],
    retained: {
      readinessGoal: true,
      competencyOverlay: true,
      activitiesAndEvidence: true,
      mastery: true,
      reviews: true,
      history: true,
    },
  };
}

describe("PANDO Growth Plan Initialization Control V1", () => {
  it("keeps valid, boundary, invalid, and malicious fixtures executable", () => {
    expect(validateSchema("growth-plan-initialization-control-v1", valid).valid).toBe(true);
    expect(validateSchema("growth-plan-initialization-control-v1", boundary).valid).toBe(true);
    expect(validateSchema("growth-plan-initialization-control-v1", invalid).valid).toBe(true);
    expect(validateSchema("growth-plan-initialization-control-v1", malicious).valid).toBe(false);
    expect(validateGrowthPlanInitializationControlV1(valid).valid).toBe(true);
    expect(validateGrowthPlanInitializationControlV1(boundary).valid).toBe(true);
    expect(validateGrowthPlanInitializationControlV1(invalid).valid).toBe(false);
    expect(decodeGrowthPlanInitializationPreviewV1(valid)).toEqual(valid);
    expect(decodeGrowthPlanSetupSourceV1(boundary)).toEqual(boundary);
    expect(() => decodeGrowthPlanInitializationPreviewV1(invalid)).toThrow(
      GrowthPlanInitializationContractError,
    );
  });

  it("enforces the strict five-state source envelope and exact 20-goal cap", () => {
    expect(boundary.goals).toHaveLength(20);
    const overflowed = structuredClone(boundary);
    overflowed.goals.push({ ...overflowed.goals[19]!, readinessGoalKey: "goal:c0" });
    expect(validateSchema("growth-plan-initialization-control-v1", overflowed).valid).toBe(false);

    for (const state of [
      "NO_ACTIVE_GOALS",
      "CURRENT_PLAN_EXISTS",
      "HISTORY_REQUIRES_REPLACEMENT",
      "GOAL_PORTFOLIO_OVERFLOW",
    ] as const) {
      const source = {
        contract: { name: "GrowthPlanSetupSourceV1", version: "1.0.0" },
        state,
        capabilities: [],
        goals: [],
      };
      expect(validateGrowthPlanInitializationControlV1(source).valid).toBe(true);
      expect(decodeGrowthPlanSetupSourceV1(source).state).toBe(state);
      expect(
        validateSchema("growth-plan-initialization-control-v1", {
          ...source,
          capabilities: ["initialize_growth_plan"],
        }).valid,
      ).toBe(false);
    }
  });

  it("rejects duplicate, non-ASCII-ordered, unsafe, and authority-bearing setup choices", () => {
    const reversed = structuredClone(boundary);
    reversed.goals.reverse();
    expect(
      growthPlanInitializationControlSemanticViolations(reversed).map((item) => item.code),
    ).toContain("GROWTH_PLAN_SETUP_GOAL_ORDER");

    const duplicated = structuredClone(boundary);
    duplicated.goals[1]!.readinessGoalKey = duplicated.goals[0]!.readinessGoalKey;
    expect(
      growthPlanInitializationControlSemanticViolations(duplicated).map((item) => item.code),
    ).toContain("GROWTH_PLAN_SETUP_GOAL_DUPLICATE");

    const unsafe = structuredClone(boundary);
    unsafe.goals[0]!.profileLabel = "Private\nlabel";
    expect(validateSchema("growth-plan-initialization-control-v1", unsafe).valid).toBe(true);
    expect(validateGrowthPlanInitializationControlV1(unsafe).valid).toBe(false);
    expect(validateGrowthPlanInitializationControlV1(malicious).valid).toBe(false);
  });

  it("rejects structurally valid cross-field lies", () => {
    const codes = growthPlanInitializationControlSemanticViolations(invalid).map(
      (item) => item.code,
    );
    expect(codes).toEqual(
      expect.arrayContaining([
        "GROWTH_PLAN_INITIALIZATION_SOURCE_VERSION",
        "GROWTH_PLAN_INITIALIZATION_SOURCE_BINDING",
        "GROWTH_PLAN_INITIALIZATION_PLAN_TITLE",
        "GROWTH_PLAN_INITIALIZATION_TRACK_TITLE",
        "GROWTH_PLAN_INITIALIZATION_TRACK_KEY",
        "GROWTH_PLAN_INITIALIZATION_APPLICABILITY",
      ]),
    );
  });

  it("rejects an orphan snapshot sentinel instead of presenting corruption as a blocker", () => {
    const orphaned = structuredClone(valid);
    orphaned.before.snapshotSentinelCount = 1;
    orphaned.canApply = false;
    expect(validateSchema("growth-plan-initialization-control-v1", orphaned).valid).toBe(true);
    expect(
      growthPlanInitializationControlSemanticViolations(orphaned).map((item) => item.code),
    ).toContain("GROWTH_PLAN_INITIALIZATION_CARDINALITY");
  });

  it("accepts only the exact derived first-Track title at 160, 161, and 200 characters", () => {
    const title160 = `${"界".repeat(159)} `;
    const title161 = `${"界".repeat(159)} X`;
    const title200 = `${"界".repeat(159)} X${"後".repeat(39)}`;
    expect(Array.from(title160)).toHaveLength(160);
    expect(initialLearningTrackTitle(title160)).toBe("界".repeat(159));
    expect(Array.from(title161)).toHaveLength(161);
    expect(initialLearningTrackTitle(title161)).toBe("界".repeat(159));
    expect(Array.from(title200)).toHaveLength(200);
    expect(initialLearningTrackTitle(title200)).toBe("界".repeat(159));
  });

  it("decodes the strict applied result and rejects a forged Track key", () => {
    const result = {
      contract: { name: "GrowthPlanInitializationApplyResultV1", version: "1.0.0" },
      commandId: "70000000-0000-4000-8000-000000000001",
      createdPlan: valid.after.growthPlan,
      createdTrack: valid.after.learningTrack,
      projectionState: "PENDING",
      planningDeliveryId: "80000000-0000-4000-8000-000000000001",
      emittedEventIds: ["90000000-0000-4000-8000-000000000001"],
    };
    expect(decodeGrowthPlanInitializationApplyResultV1(result)).toEqual(result);
    expect(
      validateGrowthPlanInitializationControlV1({
        ...result,
        createdTrack: { ...result.createdTrack, trackKey: valid.after.learningTrack.trackKey },
      }).valid,
    ).toBe(true);
    expect(() =>
      decodeGrowthPlanInitializationApplyResultV1({
        ...result,
        createdTrack: {
          ...result.createdTrack,
          trackKey: "track:60000000-0000-8000-8000-000000000002",
        },
      }),
    ).toThrow(GrowthPlanInitializationContractError);
    expect(() =>
      decodeGrowthPlanInitializationApplyResultV1({
        ...result,
        createdTrack: { ...result.createdTrack, title: "A forged Track title" },
      }),
    ).toThrow(GrowthPlanInitializationContractError);
  });
});

describe("D1b deterministic identity and hashing protocol", () => {
  it("fixes the identity framing and UUIDv8 oracle", () => {
    const growthPlanInput = planningCreateIdentityInput({
      workspaceId: "A0000000-0000-4000-8000-000000000001",
      idempotencyKey: "B0000000-0000-4000-8000-000000000001",
      label: "growth-plan",
    });
    const trackInput = planningCreateIdentityInput({
      workspaceId: "A0000000-0000-4000-8000-000000000001",
      idempotencyKey: "B0000000-0000-4000-8000-000000000001",
      label: "initial-learning-track",
    });
    expect(growthPlanInput).toContain(`identityVersion:30:${PLANNING_CREATE_IDENTITY_VERSION}\n`);
    expect(growthPlanInput).toContain(
      `commandType:34:${GROWTH_PLAN_INITIALIZATION_COMMAND_TYPE}\n`,
    );
    expect(planningCreateUuidFromSha256(sha256Bytes(growthPlanInput))).toBe(
      "8be6ee4e-a2c2-8966-9bfb-62b79981922d",
    );
    expect(planningCreateUuidFromSha256(sha256Bytes(trackInput))).toBe(
      "5fa43cf7-45b5-81e8-8023-8d5415997089",
    );
    expect(() => planningCreateUuidFromSha256(new Uint8Array(16))).toThrow(RangeError);
  });

  it("fixes the complete Unicode preview digest stream and every framed-field sensitivity", () => {
    const fields = digestFields();
    const input = growthPlanInitializationPreviewDigestInput(fields);
    expect(input).toContain("reason:16:Start — 学習\n");
    expect(input).toContain(
      `digestVersion:47:${GROWTH_PLAN_INITIALIZATION_PREVIEW_DIGEST_VERSION}\n`,
    );
    expect(createHash("sha256").update(input, "utf8").digest("hex")).toBe(
      "f5e6e9626fd9fdc5b93c25b66178bef8c38e3f644da23502514c08344045ffa4",
    );

    const expectedNames = [
      "digestVersion",
      "contractVersion",
      "identityVersion",
      "workspaceId",
      "operation",
      "commandType",
      "idempotencyKey",
      "reason",
      "expectedReadinessGoalVersion",
      "readinessGoalId",
      "readinessGoalKey",
      "readinessGoalTitle",
      "readinessGoalLifecycle",
      "readinessGoalVersion",
      "profileVersionId",
      "profileVersionKey",
      "sourceKind",
      "sourceRef",
      "roadmapVersionId",
      "sourceOwnerRevision",
      "lifetimePlanCountBefore",
      "lifetimePlanCountAfter",
      "currentPlanCountBefore",
      "currentPlanCountAfter",
      "currentPlanLimit",
      "snapshotSentinelCountBefore",
      "snapshotSentinelCountAfter",
      "growthPlanId",
      "growthPlanTitle",
      "growthPlanLifecycle",
      "growthPlanWeeklyCapacityMinutes",
      "growthPlanVersion",
      "learningTrackId",
      "trackKey",
      "learningTrackTitle",
      "learningTrackLifecycle",
      "learningTrackPriority",
      "learningTrackProtectedMinimumMinutes",
      "learningTrackDefaultSessionMinutes",
      "learningTrackVersion",
      "canApply",
      "blockingReasonCode",
      "warningCount",
      "warningCode",
      "retainedReadinessGoal",
      "retainedCompetencyOverlay",
      "retainedActivitiesAndEvidence",
      "retainedMastery",
      "retainedReviews",
      "retainedHistory",
      "projectionStateAfterApply",
      "eventChangeKind",
      "consumerName",
    ];
    const lines = input.trimEnd().split("\n");
    expect(lines.map((line) => line.slice(0, line.indexOf(":")))).toEqual(expectedNames);
    const originalHash = createHash("sha256").update(input, "utf8").digest("hex");
    for (let index = 0; index < lines.length; index += 1) {
      const mutated = [...lines];
      mutated[index] = `${mutated[index]}!`;
      expect(
        createHash("sha256")
          .update(`${mutated.join("\n")}\n`, "utf8")
          .digest("hex"),
      ).not.toBe(originalHash);
    }

    const permuted = Object.fromEntries(
      Object.entries(fields).reverse(),
    ) as unknown as typeof fields;
    expect(growthPlanInitializationPreviewDigestInput(permuted)).toBe(input);
  });

  it("fixes the complete apply request-hash stream", () => {
    const input = growthPlanInitializationRequestHashInput({
      workspaceId: "A0000000-0000-4000-8000-000000000001",
      idempotencyKey: "B0000000-0000-4000-8000-000000000001",
      readinessGoalKey: "goal:backend-readiness",
      expectedReadinessGoalVersion: "7",
      weeklyCapacityMinutes: 600,
      defaultSessionMinutes: 30,
      trackPriority: 50,
      reason: "Start — 学習",
      previewDigest: "a".repeat(64),
      growthPlanId: "F0000000-0000-8000-8000-000000000001",
      learningTrackId: "10000000-0000-8000-8000-000000000001",
      trackKey: "track:10000000-0000-8000-8000-000000000001",
    });
    expect(
      input.startsWith(
        `requestHashVersion:45:${GROWTH_PLAN_INITIALIZATION_REQUEST_HASH_VERSION}\n`,
      ),
    ).toBe(true);
    expect(createHash("sha256").update(input, "utf8").digest("hex")).toBe(
      "aeb2d58e299d6a7ff1b0e90279538f32e25eac2317239d9b0c2f57a153da9a9c",
    );
  });
});
