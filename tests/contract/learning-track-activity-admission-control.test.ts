// @vitest-environment node

import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  LEARNING_TRACK_ACTIVITY_ADMISSION_COMMAND_TYPE,
  LEARNING_TRACK_ACTIVITY_ADMISSION_PREVIEW_DIGEST_VERSION,
  LEARNING_TRACK_ACTIVITY_ADMISSION_REQUEST_HASH_VERSION,
  LEARNING_TRACK_ACTIVITY_ADMISSION_V2_COMMAND_TYPE,
  LEARNING_TRACK_ACTIVITY_ADMISSION_V2_PREVIEW_DIGEST_VERSION,
  LEARNING_TRACK_ACTIVITY_ADMISSION_V2_REQUEST_HASH_VERSION,
  learningTrackActivityAdmissionPreviewDigestInput,
  learningTrackActivityAdmissionPreviewDigestInputV2,
  learningTrackActivityAdmissionRequestHashInput,
  learningTrackActivityAdmissionRequestHashInputV2,
  type LearningTrackActivityAdmissionPreviewDigestFields,
  type LearningTrackActivityAdmissionPreviewDigestFieldsV2,
} from "../../src/modules/planning/domain/learning-track-activity-admission-preview";
import {
  LearningTrackActivityAdmissionContractError,
  decodeLearningTrackActivityAdmissionApplyResultV1,
  decodeLearningTrackActivityAdmissionApplyResultV2,
  decodeLearningTrackActivityAdmissionPreviewV1,
  decodeLearningTrackActivityAdmissionPreviewV2,
  decodeLearningTrackActivityAdmissionSourceV1,
  decodeLearningTrackActivityAdmissionSourceV2,
  learningTrackActivityAdmissionControlSemanticViolations,
  validateLearningTrackActivityAdmissionControlV1,
} from "../../src/shared/contracts/learning-track-activity-admission-control";
import { validateSchema } from "../../src/shared/contracts/schema-registry";
import boundary from "./fixtures/planning/v1/learning-track-activity-admission-control.boundary.json";
import invalid from "./fixtures/planning/v1/learning-track-activity-admission-control.invalid.json";
import malicious from "./fixtures/planning/v1/learning-track-activity-admission-control.malicious.json";
import valid from "./fixtures/planning/v1/learning-track-activity-admission-control.valid.json";
import boundaryV2 from "./fixtures/planning/v1/learning-track-activity-admission-v2.boundary.json";
import blockedV2 from "./fixtures/planning/v1/learning-track-activity-admission-v2.blocked.json";
import invalidV2 from "./fixtures/planning/v1/learning-track-activity-admission-v2.invalid.json";
import maliciousV2 from "./fixtures/planning/v1/learning-track-activity-admission-v2.malicious.json";
import validV2 from "./fixtures/planning/v1/learning-track-activity-admission-v2.valid.json";

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

function digestFieldsV2(): LearningTrackActivityAdmissionPreviewDigestFieldsV2 {
  return {
    workspaceId: "A0000000-0000-4000-8000-000000000001",
    requestId: "21000000-0000-4000-8000-000000000001",
    reason: "Add graph practice — 学習",
    expectedGrowthPlanVersion: "4",
    expectedLearningTrackVersion: "7",
    growthPlan: {
      growthPlanId: "22000000-0000-4000-8000-000000000001",
      title: "Backend readiness",
      lifecycle: "ACTIVE",
      weeklyCapacityMinutes: 600,
      aggregateVersion: "4",
    },
    learningTrack: {
      learningTrackId: "23000000-0000-4000-8000-000000000001",
      trackKey: "track:algorithms",
      title: "Algorithms",
      lifecycle: "ACTIVE",
      priority: 80,
      protectedMinimumMinutes: 120,
      defaultSessionMinutes: 45,
      aggregateVersionBefore: "7",
      aggregateVersionAfter: "8",
    },
    readinessGoalId: "24000000-0000-4000-8000-000000000001",
    profileVersionId: "25000000-0000-4000-8000-000000000001",
    targetsOwnerRevision: "readiness-goal:11",
    customActivityId: "26000000-0000-4000-8000-000000000001",
    activity: {
      activityKey: "activity:graph-practice",
      title: "Graph practice",
      activityType: "PROJECT",
      targetCompetencyRef: "competency:graphs",
      lifecycle: "ACTIVE",
      mappingStatus: "ACCEPTED",
    },
    overlayOwnerRevision: "workspace-overlay:21",
    candidateKey: "candidate:21000000-0000-4000-8000-000000000001",
    estimatedMinutes: 60,
    energy: "HIGH",
    planActivityCountBefore: 2,
    planActivityCountAfter: 3,
    planActivityLimit: 200,
    canApply: true,
    blockingReason: undefined,
    warnings: [],
    constraint: {
      currentTrackOrderFingerprint: "f".repeat(64),
    },
  };
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
      ? "PLAN_ACTIVITY_LIMIT_REACHED"
      : typeof current === "boolean"
        ? !current
        : typeof current === "number"
          ? current + 1
          : `${String(current)}!`;
  return copy as T;
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

describe("Learning Track activity admission control V2", () => {
  it("accepts valid, boundary, and blocked V2 fixtures while rejecting malicious structure", () => {
    expect(validateSchema("learning-track-activity-admission-control-v1", validV2).valid).toBe(
      true,
    );
    expect(validateSchema("learning-track-activity-admission-control-v1", boundaryV2).valid).toBe(
      true,
    );
    expect(validateSchema("learning-track-activity-admission-control-v1", blockedV2).valid).toBe(
      true,
    );
    expect(validateSchema("learning-track-activity-admission-control-v1", invalidV2).valid).toBe(
      true,
    );
    expect(validateSchema("learning-track-activity-admission-control-v1", maliciousV2).valid).toBe(
      false,
    );

    expect(validateLearningTrackActivityAdmissionControlV1(validV2).valid).toBe(true);
    expect(validateLearningTrackActivityAdmissionControlV1(boundaryV2).valid).toBe(true);
    expect(validateLearningTrackActivityAdmissionControlV1(blockedV2).valid).toBe(true);
    expect(validateLearningTrackActivityAdmissionControlV1(invalidV2).valid).toBe(false);
    expect(decodeLearningTrackActivityAdmissionPreviewV2(validV2)).toEqual(validV2);
    expect(decodeLearningTrackActivityAdmissionSourceV2(blockedV2)).toEqual(blockedV2);
    expect(() => decodeLearningTrackActivityAdmissionSourceV2(maliciousV2)).toThrow(
      LearningTrackActivityAdmissionContractError,
    );
  });

  it("pins V2 source states, selected-track minimization, and unavailable destination semantics", () => {
    const ready = {
      contract: { name: "LearningTrackActivityAdmissionSourceV2", version: "2.0.0" },
      state: "READY",
      capabilities: ["admit_activity_to_learning_track"],
      growthPlan: validV2.growthPlan,
      selectedTrack: {
        trackKey: validV2.learningTrack.trackKey,
        title: validV2.learningTrack.title,
        lifecycle: validV2.learningTrack.lifecycle,
        priority: validV2.learningTrack.priority,
        protectedMinimumMinutes: validV2.learningTrack.protectedMinimumMinutes,
        defaultSessionMinutes: validV2.learningTrack.defaultSessionMinutes,
        aggregateVersion: validV2.learningTrack.aggregateVersionBefore,
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
    expect(decodeLearningTrackActivityAdmissionSourceV2(ready)).toEqual(ready);
    expect(
      validateLearningTrackActivityAdmissionControlV1({
        ...ready,
        activities: [...ready.activities].reverse(),
      }).valid,
    ).toBe(false);

    for (const state of [
      "NO_CURRENT_TRACKS",
      "CURRENT_TRACK_PORTFOLIO_UNAVAILABLE",
      "SELECTED_TRACK_UNAVAILABLE",
    ] as const) {
      const source = {
        contract: { name: "LearningTrackActivityAdmissionSourceV2", version: "2.0.0" },
        state,
        capabilities: [],
        growthPlan: validV2.growthPlan,
        selectedTrack: null,
        activities: [],
      };
      expect(validateLearningTrackActivityAdmissionControlV1(source).valid).toBe(true);
      expect(decodeLearningTrackActivityAdmissionSourceV2(source).state).toBe(state);
    }

    expect(
      validateLearningTrackActivityAdmissionControlV1({
        contract: { name: "LearningTrackActivityAdmissionSourceV2", version: "2.0.0" },
        state: "NO_CURRENT_PLAN",
        capabilities: [],
        growthPlan: null,
        selectedTrack: null,
        activities: [],
      }).valid,
    ).toBe(true);
  });

  it("rejects structurally valid V2 preview lies about versions, applicability, and warning order", () => {
    expect(
      learningTrackActivityAdmissionControlSemanticViolations(invalidV2).map((item) => item.code),
    ).toEqual(
      expect.arrayContaining([
        "ACTIVITY_ADMISSION_VERSION_BINDING",
        "ACTIVITY_ADMISSION_TRACK_INCREMENT",
        "ACTIVITY_ADMISSION_CANDIDATE_BINDING",
        "ACTIVITY_ADMISSION_APPLICABILITY",
        "ACTIVITY_ADMISSION_WARNING_ORDER",
      ]),
    );
  });

  it("accepts only a strict, lowercase V2 applied result", () => {
    const result = {
      contract: { name: "LearningTrackActivityAdmissionApplyResultV2", version: "2.0.0" },
      commandId: "a0000000-0000-4000-8000-000000000001",
      changedTrack: { trackKey: "track:algorithms", aggregateVersion: "8" },
      admittedActivity: {
        activityKey: "activity:graph-practice",
        candidateKey: "candidate:21000000-0000-4000-8000-000000000001",
        estimatedMinutes: 60,
        energy: "HIGH",
      },
      projectionState: "PENDING",
      planningDeliveryId: "b0000000-0000-4000-8000-000000000001",
      emittedEventIds: ["c0000000-0000-4000-8000-000000000001"],
    };
    expect(decodeLearningTrackActivityAdmissionApplyResultV2(result)).toEqual(result);
    expect(() =>
      decodeLearningTrackActivityAdmissionApplyResultV2({
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

  it("pins the complete Unicode V2 digest stream and field sensitivity", () => {
    const fields = digestFieldsV2();
    const input = learningTrackActivityAdmissionPreviewDigestInputV2(fields);
    expect(input).toContain(
      `digestVersion:54:${LEARNING_TRACK_ACTIVITY_ADMISSION_V2_PREVIEW_DIGEST_VERSION}\n`,
    );
    expect(input).toContain(
      `commandType:39:${LEARNING_TRACK_ACTIVITY_ADMISSION_V2_COMMAND_TYPE}\n`,
    );
    expect(input).toContain("reason:29:Add graph practice — 学習\n");
    const originalHash = createHash("sha256").update(input, "utf8").digest("hex");
    expect(originalHash).toMatch(/^[a-f0-9]{64}$/u);

    for (const path of [
      ["workspaceId"],
      ["requestId"],
      ["reason"],
      ["expectedGrowthPlanVersion"],
      ["expectedLearningTrackVersion"],
      ["growthPlan", "growthPlanId"],
      ["growthPlan", "title"],
      ["growthPlan", "lifecycle"],
      ["growthPlan", "weeklyCapacityMinutes"],
      ["growthPlan", "aggregateVersion"],
      ["learningTrack", "learningTrackId"],
      ["learningTrack", "trackKey"],
      ["learningTrack", "title"],
      ["learningTrack", "lifecycle"],
      ["learningTrack", "priority"],
      ["learningTrack", "protectedMinimumMinutes"],
      ["learningTrack", "defaultSessionMinutes"],
      ["learningTrack", "aggregateVersionBefore"],
      ["learningTrack", "aggregateVersionAfter"],
      ["readinessGoalId"],
      ["profileVersionId"],
      ["targetsOwnerRevision"],
      ["customActivityId"],
      ["activity", "activityKey"],
      ["activity", "title"],
      ["activity", "activityType"],
      ["activity", "targetCompetencyRef"],
      ["activity", "lifecycle"],
      ["activity", "mappingStatus"],
      ["overlayOwnerRevision"],
      ["candidateKey"],
      ["estimatedMinutes"],
      ["energy"],
      ["planActivityCountBefore"],
      ["planActivityCountAfter"],
      ["planActivityLimit"],
      ["canApply"],
      ["blockingReason"],
      ["warnings", "0"],
      ["constraint", "currentTrackOrderFingerprint"],
    ] as const) {
      expect(
        learningTrackActivityAdmissionPreviewDigestInputV2(mutateAtPath(fields, path)),
      ).not.toBe(input);
    }
  });

  it("pins the retry-safe V2 request-hash stream and selected Track binding", () => {
    const request = {
      workspaceId: "A0000000-0000-4000-8000-000000000001",
      requestId: "21000000-0000-4000-8000-000000000001",
      trackKey: "track:algorithms",
      activityKey: "activity:graph-practice",
      estimatedMinutes: 60,
      energy: "HIGH" as const,
      expectedGrowthPlanVersion: "4",
      expectedLearningTrackVersion: "7",
      reason: "Add graph practice — 学習",
      previewDigest: "c".repeat(64),
    };
    const input = learningTrackActivityAdmissionRequestHashInputV2(request);
    expect(input).toContain(
      `requestHashVersion:52:${LEARNING_TRACK_ACTIVITY_ADMISSION_V2_REQUEST_HASH_VERSION}\n`,
    );
    expect(input).toContain("trackKey:16:track:algorithms\n");
    expect(createHash("sha256").update(input, "utf8").digest("hex")).toMatch(/^[a-f0-9]{64}$/u);
    for (const field of Object.keys(request)) {
      expect(
        learningTrackActivityAdmissionRequestHashInputV2(mutateAtPath(request, [field])),
      ).not.toBe(input);
    }
  });
});
