// @vitest-environment node

import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  LEARNING_TRACK_ACTIVITY_ADMISSION_COMMAND_TYPE,
  LEARNING_TRACK_ACTIVITY_ADMISSION_PREVIEW_DIGEST_VERSION,
  LEARNING_TRACK_ACTIVITY_ADMISSION_REQUEST_HASH_VERSION,
  learningTrackActivityAdmissionPreviewDigestInput,
  learningTrackActivityAdmissionRequestHashInput,
  type LearningTrackActivityAdmissionPreviewDigestFields,
} from "../../src/modules/planning/domain/learning-track-activity-admission-preview";
import {
  LearningTrackActivityAdmissionContractError,
  decodeLearningTrackActivityAdmissionApplyResultV1,
  decodeLearningTrackActivityAdmissionPreviewV1,
  decodeLearningTrackActivityAdmissionSourceV1,
  learningTrackActivityAdmissionControlSemanticViolations,
  validateLearningTrackActivityAdmissionControlV1,
} from "../../src/shared/contracts/learning-track-activity-admission-control";
import { validateSchema } from "../../src/shared/contracts/schema-registry";
import boundary from "./fixtures/planning/v1/learning-track-activity-admission-control.boundary.json";
import invalid from "./fixtures/planning/v1/learning-track-activity-admission-control.invalid.json";
import malicious from "./fixtures/planning/v1/learning-track-activity-admission-control.malicious.json";
import valid from "./fixtures/planning/v1/learning-track-activity-admission-control.valid.json";

function digestFields(): LearningTrackActivityAdmissionPreviewDigestFields {
  return {
    workspaceId: "A0000000-0000-4000-8000-000000000001",
    requestId: "10000000-0000-4000-8000-000000000001",
    reason: "Add SQL — 学習",
    expectedGrowthPlanVersion: "4",
    expectedLearningTrackVersion: "7",
    growthPlan: {
      growthPlanId: "20000000-0000-4000-8000-000000000001",
      title: "Backend readiness",
      lifecycle: "ACTIVE",
      weeklyCapacityMinutes: 600,
      aggregateVersion: "4",
    },
    learningTrack: {
      learningTrackId: "30000000-0000-4000-8000-000000000001",
      trackKey: "track:backend-core",
      title: "Backend readiness",
      lifecycle: "PAUSED",
      priority: 50,
      protectedMinimumMinutes: 0,
      defaultSessionMinutes: 30,
      aggregateVersionBefore: "7",
      aggregateVersionAfter: "8",
    },
    readinessGoalId: "40000000-0000-4000-8000-000000000001",
    profileVersionId: "50000000-0000-4000-8000-000000000001",
    targetsOwnerRevision: "readiness-goal:9",
    customActivityId: "60000000-0000-4000-8000-000000000001",
    activity: {
      activityKey: "activity:sql-practice",
      title: "SQL practice",
      activityType: "MANUAL_CODING",
      targetCompetencyRef: "competency:sql",
      lifecycle: "ACTIVE",
      mappingStatus: "ACCEPTED",
    },
    overlayOwnerRevision: "workspace-overlay:12",
    candidateKey: "candidate:10000000-0000-4000-8000-000000000001",
    estimatedMinutes: 45,
    energy: "MEDIUM",
    planActivityCountBefore: 2,
    planActivityCountAfter: 3,
    planActivityLimit: 200,
    canApply: true,
    blockingReason: undefined,
    warnings: ["LEARNING_TRACK_PAUSED"],
  };
}

describe("Learning Track activity admission control V1", () => {
  it("accepts the valid and boundary previews", () => {
    expect(validateLearningTrackActivityAdmissionControlV1(valid).valid).toBe(true);
    expect(validateLearningTrackActivityAdmissionControlV1(boundary).valid).toBe(true);
    expect(decodeLearningTrackActivityAdmissionPreviewV1(valid)).toEqual(valid);
  });

  it("rejects inconsistent and authority-injecting documents", () => {
    expect(validateSchema("learning-track-activity-admission-control-v1", invalid).valid).toBe(
      true,
    );
    expect(validateLearningTrackActivityAdmissionControlV1(invalid).valid).toBe(false);
    expect(
      learningTrackActivityAdmissionControlSemanticViolations(invalid).map((item) => item.code),
    ).toEqual(
      expect.arrayContaining([
        "ACTIVITY_ADMISSION_VERSION_BINDING",
        "ACTIVITY_ADMISSION_TRACK_INCREMENT",
        "ACTIVITY_ADMISSION_CANDIDATE_BINDING",
        "ACTIVITY_ADMISSION_APPLICABILITY",
        "ACTIVITY_ADMISSION_WARNING_ORDER",
      ]),
    );
    expect(validateSchema("learning-track-activity-admission-control-v1", malicious).valid).toBe(
      false,
    );
    expect(() => decodeLearningTrackActivityAdmissionSourceV1(malicious)).toThrow(
      LearningTrackActivityAdmissionContractError,
    );
  });

  it("pins source ordering, capability states, and minimized fields", () => {
    const source = {
      contract: { name: "LearningTrackActivityAdmissionSourceV1", version: "1.0.0" },
      state: "READY",
      capabilities: ["admit_activity_to_learning_track"],
      growthPlan: valid.growthPlan,
      learningTrack: {
        trackKey: valid.learningTrack.trackKey,
        title: valid.learningTrack.title,
        lifecycle: valid.learningTrack.lifecycle,
        priority: valid.learningTrack.priority,
        protectedMinimumMinutes: valid.learningTrack.protectedMinimumMinutes,
        defaultSessionMinutes: valid.learningTrack.defaultSessionMinutes,
        aggregateVersion: valid.learningTrack.aggregateVersionBefore,
      },
      activities: [
        {
          activityKey: "activity:aa",
          title: "A",
          activityType: "READING",
          targetCompetencyRef: "competency:aa",
        },
        {
          activityKey: "activity:bb",
          title: "B",
          activityType: "PROJECT",
          targetCompetencyRef: "competency:bb",
        },
      ],
    };
    expect(decodeLearningTrackActivityAdmissionSourceV1(source)).toEqual(source);
    expect(
      validateLearningTrackActivityAdmissionControlV1({
        ...source,
        activities: [...source.activities].reverse(),
      }).valid,
    ).toBe(false);
    expect(
      validateLearningTrackActivityAdmissionControlV1({
        ...source,
        state: "NO_ELIGIBLE_ACTIVITIES",
        capabilities: [],
        activities: [],
      }).valid,
    ).toBe(true);
  });

  it("accepts only a strict, lowercase applied result", () => {
    const result = {
      contract: { name: "LearningTrackActivityAdmissionApplyResultV1", version: "1.0.0" },
      commandId: "a0000000-0000-4000-8000-000000000001",
      changedTrack: { trackKey: "track:backend-core", aggregateVersion: "8" },
      admittedActivity: {
        activityKey: "activity:sql-practice",
        candidateKey: "candidate:10000000-0000-4000-8000-000000000001",
        estimatedMinutes: 45,
        energy: "MEDIUM",
      },
      projectionState: "PENDING",
      planningDeliveryId: "80000000-0000-4000-8000-000000000001",
      emittedEventIds: ["90000000-0000-4000-8000-000000000001"],
    };
    expect(decodeLearningTrackActivityAdmissionApplyResultV1(result)).toEqual(result);
    expect(() =>
      decodeLearningTrackActivityAdmissionApplyResultV1({
        ...result,
        commandId: result.commandId.toUpperCase(),
      }),
    ).toThrow(LearningTrackActivityAdmissionContractError);
  });
});

describe("Learning Track activity admission hashing protocol", () => {
  it("pins the complete Unicode digest stream and every line", () => {
    const input = learningTrackActivityAdmissionPreviewDigestInput(digestFields());
    expect(input).toContain(
      `digestVersion:54:${LEARNING_TRACK_ACTIVITY_ADMISSION_PREVIEW_DIGEST_VERSION}\n`,
    );
    expect(input).toContain(`commandType:39:${LEARNING_TRACK_ACTIVITY_ADMISSION_COMMAND_TYPE}\n`);
    expect(input).toContain("reason:18:Add SQL — 学習\n");
    expect(createHash("sha256").update(input, "utf8").digest("hex")).toBe(
      "7a05cc4b76cdb3883cfa4b269cff78c01670b183c72bc12f5d1eb440faa6ecdb",
    );
    const lines = input.trimEnd().split("\n");
    const original = createHash("sha256").update(input, "utf8").digest("hex");
    for (let index = 0; index < lines.length; index += 1) {
      const changed = [...lines];
      changed[index] = `${changed[index]}!`;
      expect(
        createHash("sha256")
          .update(`${changed.join("\n")}\n`, "utf8")
          .digest("hex"),
      ).not.toBe(original);
    }
  });

  it("pins the retry-safe request-hash stream", () => {
    const input = learningTrackActivityAdmissionRequestHashInput({
      workspaceId: "A0000000-0000-4000-8000-000000000001",
      requestId: "10000000-0000-4000-8000-000000000001",
      activityKey: "activity:sql-practice",
      estimatedMinutes: 45,
      energy: null,
      expectedGrowthPlanVersion: "4",
      expectedLearningTrackVersion: "7",
      reason: "Add SQL — 学習",
      previewDigest: "a".repeat(64),
    });
    expect(input).toContain(
      `requestHashVersion:52:${LEARNING_TRACK_ACTIVITY_ADMISSION_REQUEST_HASH_VERSION}\n`,
    );
    expect(createHash("sha256").update(input, "utf8").digest("hex")).toBe(
      "0df0303b6dfb1e8820d19bd4acdd43f2f5bd541a952d684faee877296cce0bea",
    );
  });
});
