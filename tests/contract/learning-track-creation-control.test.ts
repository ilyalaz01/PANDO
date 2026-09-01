// @vitest-environment node

import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  LEARNING_TRACK_CREATION_COMMAND_TYPE,
  LEARNING_TRACK_CREATION_PREVIEW_DIGEST_VERSION,
  LEARNING_TRACK_CREATION_REQUEST_HASH_VERSION,
  learningTrackCreationIdentityInput,
  learningTrackCreationPreviewDigestInput,
  learningTrackCreationRequestHashInput,
  learningTrackCreationUuidFromSha256,
  learningTrackKeyFromId,
  type LearningTrackCreationPreviewDigestFields,
} from "../../src/modules/planning/domain/learning-track-creation-preview";
import {
  LearningTrackCreationContractError,
  decodeLearningTrackCreationApplyResultV1,
  decodeLearningTrackCreationPreviewV1,
  decodeLearningTrackCreationSourceV1,
  learningTrackCreationControlSemanticViolations,
  validateLearningTrackCreationControlV1,
} from "../../src/shared/contracts/learning-track-creation-control";
import { validateSchema } from "../../src/shared/contracts/schema-registry";
import blocked from "./fixtures/planning/v1/learning-track-creation-control.blocked.json";
import boundary from "./fixtures/planning/v1/learning-track-creation-control.boundary.json";
import invalid from "./fixtures/planning/v1/learning-track-creation-control.invalid.json";
import malicious from "./fixtures/planning/v1/learning-track-creation-control.malicious.json";
import valid from "./fixtures/planning/v1/learning-track-creation-control.valid.json";

function sha256Bytes(value: string): Uint8Array {
  return createHash("sha256").update(value, "utf8").digest();
}

function mutateAtPath<T>(value: T, path: readonly string[]): T {
  const copy = structuredClone(value) as unknown;
  let parent = copy as Record<string, unknown>;
  for (const segment of path.slice(0, -1)) {
    parent = parent[segment] as Record<string, unknown>;
  }
  const key = path.at(-1)!;
  const current = parent[key];
  parent[key] =
    current === null
      ? "TRACK_PORTFOLIO_LIMIT_REACHED"
      : typeof current === "boolean"
        ? !current
        : typeof current === "number"
          ? current + 1
          : `${String(current)}!`;
  return copy as T;
}

function digestFields(): LearningTrackCreationPreviewDigestFields {
  return {
    workspaceId: "A0000000-0000-4000-8000-000000000001",
    requestId: "B0000000-0000-4000-8000-000000000001",
    reason: "Split algorithms — 学習",
    expectedGrowthPlanVersion: "4",
    expectedReadinessGoalVersion: "7",
    growthPlan: {
      title: "Backend readiness",
      lifecycle: "PAUSED",
      weeklyCapacityMinutes: 600,
      aggregateVersion: "4",
    },
    source: {
      readinessGoalId: "C0000000-0000-4000-8000-000000000001",
      readinessGoalKey: "goal:backend-readiness",
      readinessGoalTitle: "Backend readiness",
      readinessGoalLifecycle: "ACTIVE",
      readinessGoalVersion: "7",
      profileVersionId: "D0000000-0000-4000-8000-000000000001",
      profileVersionKey: "target:backend-engineer-v1",
      sourceKind: "ROADMAP_TEMPLATE_VERSION",
      sourceRef: "E0000000-0000-4000-8000-000000000001",
      roadmapVersionId: "E0000000-0000-4000-8000-000000000001",
      sourceOwnerRevision: "readiness-goal:7",
    },
    constraint: {
      currentTrackCountBefore: 2,
      currentTrackCountAfter: 3,
      currentTrackLimit: 30,
      activeProtectedMinimumMinutesBefore: 180,
      activeProtectedMinimumMinutesAfter: 180,
      flexibleMinutesBefore: 420,
      flexibleMinutesAfter: 420,
      currentTrackOrderFingerprintBefore: "a".repeat(64),
      currentTrackOrderFingerprintAfter: "b".repeat(64),
      newTrackPosition: 2,
    },
    learningTrack: {
      learningTrackId: "10000000-0000-8000-8000-000000000001",
      trackKey: "track:10000000-0000-8000-8000-000000000001",
      title: "Algorithms sprint",
      lifecycle: "ACTIVE",
      priority: 80,
      protectedMinimumMinutes: 0,
      defaultSessionMinutes: 45,
      aggregateVersion: "1",
    },
    canApply: true,
    blockingReasonCode: null,
    warnings: ["PARENT_GROWTH_PLAN_PAUSED", "TRACK_STARTS_EMPTY"],
  };
}

describe("Learning Track creation control V1", () => {
  it("accepts valid, boundary, and blocked fixtures while rejecting malicious structure", () => {
    expect(validateSchema("learning-track-creation-control-v1", valid).valid).toBe(true);
    expect(validateSchema("learning-track-creation-control-v1", boundary).valid).toBe(true);
    expect(validateSchema("learning-track-creation-control-v1", blocked).valid).toBe(true);
    expect(validateSchema("learning-track-creation-control-v1", invalid).valid).toBe(true);
    expect(validateSchema("learning-track-creation-control-v1", malicious).valid).toBe(false);

    expect(validateLearningTrackCreationControlV1(valid).valid).toBe(true);
    expect(validateLearningTrackCreationControlV1(boundary).valid).toBe(true);
    expect(validateLearningTrackCreationControlV1(blocked).valid).toBe(true);
    expect(validateLearningTrackCreationControlV1(invalid).valid).toBe(false);
    expect(decodeLearningTrackCreationPreviewV1(valid)).toEqual(valid);
    expect(decodeLearningTrackCreationSourceV1(boundary)).toEqual(boundary);
    expect(() => decodeLearningTrackCreationSourceV1(malicious)).toThrow(
      LearningTrackCreationContractError,
    );
  });

  it("pins source states, exact 20-goal cap, and non-ready minimization", () => {
    expect(boundary.goals).toHaveLength(20);
    const overflowed = structuredClone(boundary);
    overflowed.goals.push({ ...overflowed.goals[19]!, readinessGoalKey: "goal:z99" });
    expect(validateSchema("learning-track-creation-control-v1", overflowed).valid).toBe(false);

    const noPlan = {
      contract: { name: "LearningTrackCreationSourceV1", version: "1.0.0" },
      state: "NO_CURRENT_PLAN",
      capabilities: [],
      growthPlan: null,
      trackPortfolio: null,
      goals: [],
    };
    expect(validateLearningTrackCreationControlV1(noPlan).valid).toBe(true);

    for (const state of [
      "TRACK_PORTFOLIO_LIMIT_REACHED",
      "NO_ACTIVE_GOALS",
      "GOAL_PORTFOLIO_OVERFLOW",
    ] as const) {
      const source = {
        contract: { name: "LearningTrackCreationSourceV1", version: "1.0.0" },
        state,
        capabilities: [],
        growthPlan: boundary.growthPlan,
        trackPortfolio: {
          currentTrackCount: state === "TRACK_PORTFOLIO_LIMIT_REACHED" ? 30 : 2,
          currentTrackLimit: 30,
        },
        goals: [],
      };
      expect(validateLearningTrackCreationControlV1(source).valid).toBe(true);
      expect(decodeLearningTrackCreationSourceV1(source).state).toBe(state);
    }
  });

  it("rejects duplicate, unsorted, unsafe, and contradictory source envelopes", () => {
    const reversed = structuredClone(boundary);
    reversed.goals.reverse();
    expect(
      learningTrackCreationControlSemanticViolations(reversed).map((item) => item.code),
    ).toContain("LEARNING_TRACK_CREATION_GOAL_ORDER");

    const duplicated = structuredClone(boundary);
    duplicated.goals[1]!.readinessGoalKey = duplicated.goals[0]!.readinessGoalKey;
    expect(
      learningTrackCreationControlSemanticViolations(duplicated).map((item) => item.code),
    ).toContain("LEARNING_TRACK_CREATION_GOAL_DUPLICATE");

    const unsafe = structuredClone(boundary);
    unsafe.goals[0]!.profileLabel = "Secret\nprofile";
    expect(validateSchema("learning-track-creation-control-v1", unsafe).valid).toBe(true);
    expect(validateLearningTrackCreationControlV1(unsafe).valid).toBe(false);

    const contradictory = structuredClone(boundary);
    contradictory.trackPortfolio.currentTrackCount = 30;
    expect(validateLearningTrackCreationControlV1(contradictory).valid).toBe(false);
  });

  it("rejects structurally valid cross-field lies in preview semantics", () => {
    const codes = learningTrackCreationControlSemanticViolations(invalid).map((item) => item.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        "LEARNING_TRACK_CREATION_VERSION_BINDING",
        "LEARNING_TRACK_CREATION_SOURCE_BINDING",
        "LEARNING_TRACK_CREATION_TRACK_KEY",
        "LEARNING_TRACK_CREATION_APPLICABILITY",
        "LEARNING_TRACK_CREATION_CAPACITY_STABILITY",
        "LEARNING_TRACK_CREATION_ORDER_FINGERPRINT",
        "LEARNING_TRACK_CREATION_WARNING_ORDER",
      ]),
    );
  });

  it("accepts only a strict lowercase apply result", () => {
    const result = {
      contract: { name: "LearningTrackCreationApplyResultV1", version: "1.0.0" },
      commandId: "a0000000-0000-4000-8000-000000000001",
      createdTrack: valid.learningTrack,
      projectionState: "PENDING",
      planningDeliveryId: "b0000000-0000-4000-8000-000000000001",
      emittedEventIds: ["c0000000-0000-4000-8000-000000000001"],
    };
    expect(decodeLearningTrackCreationApplyResultV1(result)).toEqual(result);
    expect(() =>
      decodeLearningTrackCreationApplyResultV1({
        ...result,
        createdTrack: {
          ...result.createdTrack,
          trackKey: "track:aaaaaaaa-0000-8000-8000-000000000001",
        },
      }),
    ).toThrow(LearningTrackCreationContractError);
  });
});

describe("Learning Track creation hashing protocol", () => {
  it("pins identity framing and UUIDv8 derivation", () => {
    const input = learningTrackCreationIdentityInput({
      workspaceId: "A0000000-0000-4000-8000-000000000001",
      requestId: "B0000000-0000-4000-8000-000000000001",
    });
    expect(input).toContain("identityVersion:30:planning-create-identity/1.0.0\n");
    expect(input).toContain(`commandType:33:${LEARNING_TRACK_CREATION_COMMAND_TYPE}\n`);
    expect(input).toContain("label:25:additional-learning-track\n");
    expect(learningTrackCreationUuidFromSha256(sha256Bytes(input))).toBe(
      "b753ce07-b53a-8b4f-97a3-c4ed36a26566",
    );
    expect(learningTrackKeyFromId("10000000-0000-8000-8000-000000000001")).toBe(
      "track:10000000-0000-8000-8000-000000000001",
    );
  });

  it("pins the complete Unicode preview digest stream and field sensitivity", () => {
    const fields = digestFields();
    const input = learningTrackCreationPreviewDigestInput(fields);
    expect(input).toContain(`digestVersion:44:${LEARNING_TRACK_CREATION_PREVIEW_DIGEST_VERSION}\n`);
    expect(input).toContain(`commandType:33:${LEARNING_TRACK_CREATION_COMMAND_TYPE}\n`);
    expect(input).toContain("reason:27:Split algorithms — 学習\n");
    const originalHash = createHash("sha256").update(input, "utf8").digest("hex");
    expect(originalHash).toBe("238fb7ac4672c149f6242471ba182eda7d54cda12a83b466c45532911ca05e32");

    const lines = input.trimEnd().split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      const mutated = [...lines];
      mutated[index] = `${mutated[index]}!`;
      expect(
        createHash("sha256")
          .update(`${mutated.join("\n")}\n`, "utf8")
          .digest("hex"),
      ).not.toBe(originalHash);
    }

    for (const path of [
      ["workspaceId"],
      ["requestId"],
      ["reason"],
      ["expectedGrowthPlanVersion"],
      ["expectedReadinessGoalVersion"],
      ["growthPlan", "title"],
      ["growthPlan", "lifecycle"],
      ["growthPlan", "weeklyCapacityMinutes"],
      ["growthPlan", "aggregateVersion"],
      ["source", "readinessGoalId"],
      ["source", "readinessGoalKey"],
      ["source", "readinessGoalTitle"],
      ["source", "readinessGoalLifecycle"],
      ["source", "readinessGoalVersion"],
      ["source", "profileVersionId"],
      ["source", "profileVersionKey"],
      ["source", "sourceKind"],
      ["source", "sourceRef"],
      ["source", "roadmapVersionId"],
      ["source", "sourceOwnerRevision"],
      ["constraint", "currentTrackCountBefore"],
      ["constraint", "currentTrackCountAfter"],
      ["constraint", "currentTrackLimit"],
      ["constraint", "activeProtectedMinimumMinutesBefore"],
      ["constraint", "activeProtectedMinimumMinutesAfter"],
      ["constraint", "flexibleMinutesBefore"],
      ["constraint", "flexibleMinutesAfter"],
      ["constraint", "currentTrackOrderFingerprintBefore"],
      ["constraint", "currentTrackOrderFingerprintAfter"],
      ["constraint", "newTrackPosition"],
      ["learningTrack", "learningTrackId"],
      ["learningTrack", "trackKey"],
      ["learningTrack", "title"],
      ["learningTrack", "lifecycle"],
      ["learningTrack", "priority"],
      ["learningTrack", "protectedMinimumMinutes"],
      ["learningTrack", "defaultSessionMinutes"],
      ["learningTrack", "aggregateVersion"],
      ["canApply"],
      ["blockingReasonCode"],
      ["warnings", "0"],
    ] as const) {
      expect(learningTrackCreationPreviewDigestInput(mutateAtPath(fields, path))).not.toBe(input);
    }
  });

  it("pins the retry-safe request-hash stream", () => {
    const request = {
      workspaceId: "A0000000-0000-4000-8000-000000000001",
      requestId: "B0000000-0000-4000-8000-000000000001",
      readinessGoalKey: "goal:backend-readiness",
      expectedReadinessGoalVersion: "7",
      title: "Algorithms sprint",
      priority: 80,
      defaultSessionMinutes: 45,
      expectedGrowthPlanVersion: "4",
      reason: "Split algorithms — 学習",
      previewDigest: "a".repeat(64),
      learningTrackId: "10000000-0000-8000-8000-000000000001",
      trackKey: "track:10000000-0000-8000-8000-000000000001",
    };
    const input = learningTrackCreationRequestHashInput(request);
    expect(input).toContain(
      `requestHashVersion:42:${LEARNING_TRACK_CREATION_REQUEST_HASH_VERSION}\n`,
    );
    expect(createHash("sha256").update(input, "utf8").digest("hex")).toBe(
      "feadc93cae331158808fd6c017ade4aa56073431c7e552fbec9009167e9a8ae2",
    );
    for (const field of Object.keys(request)) {
      expect(learningTrackCreationRequestHashInput(mutateAtPath(request, [field]))).not.toBe(input);
    }
  });
});
