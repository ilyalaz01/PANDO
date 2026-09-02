import { describe, expect, it } from "vitest";

import boundary from "../../../../tests/contract/fixtures/planning/v1/growth-plan-control.boundary.json";
import preview from "../../../../tests/contract/fixtures/planning/v1/growth-plan-control.valid.json";
import trackPreview from "../../../../tests/contract/fixtures/planning/v1/learning-track-lifecycle-control.valid.json";
import trackSettingsPreview from "../../../../tests/contract/fixtures/planning/v1/learning-track-priority-minimum-control.valid.json";
import cadencePreview from "../../../../tests/contract/fixtures/planning/v1/learning-track-cadence-control.valid.json";
import cadenceSource from "../../../../tests/contract/fixtures/planning/v1/learning-track-cadence-control.boundary.json";
import admissionPreview from "../../../../tests/contract/fixtures/planning/v1/learning-track-activity-admission-control.valid.json";
import {
  decodeCurrentLearningTracksV1,
  decodeCurrentGrowthPlanV1,
  decodeGrowthPlanCapacityApplyResultV1,
  decodeGrowthPlanCapacityPreviewV1,
  decodeGrowthPlanLifecycleApplyResultV1,
  decodeGrowthPlanLifecyclePreviewV1,
  decodeLearningTrackLifecycleApplyResultV1,
  decodeLearningTrackLifecyclePreviewV1,
  decodeLearningTrackActivityAdmissionApplyResultV1,
  decodeLearningTrackActivityAdmissionPreviewV1,
  decodeLearningTrackActivityAdmissionSourceV1,
  decodeLearningTrackPriorityMinimumApplyResultV1,
  decodeLearningTrackPriorityMinimumPreviewV1,
  decodeLearningTrackCadencePreviewV1,
  decodeLearningTrackCadenceSourceV1,
  GrowthPlanControlContractError,
} from "./plan-workspace-v1";

const uuid = "30000000-0000-4000-8000-000000000001";

const capacityPreview = {
  contract: { name: "GrowthPlanCapacityPreviewV1", version: "1.0.0" },
  operation: "set_default_capacity",
  reason: "I have more time this term.",
  expectedGrowthPlanVersion: "4",
  before: structuredClone(preview.before),
  after: { ...structuredClone(preview.before), weeklyCapacityMinutes: 720, aggregateVersion: "5" },
  constraint: {
    activeTrackCount: 2,
    activeProtectedMinimumMinutes: 180,
    flexibleMinutesBefore: 420,
    flexibleMinutesAfter: 540,
    activeTrackFingerprint: "b".repeat(64),
  },
  canApply: true,
  blockingReasons: [],
  retained: structuredClone(preview.retained),
  recalculationAfterApply: structuredClone(preview.recalculationAfterApply),
  previewDigest: "c".repeat(64),
};

function applyResult() {
  return {
    contract: { name: "GrowthPlanLifecycleApplyResultV1", version: "1.0.0" },
    commandId: uuid,
    changedPlan: structuredClone(preview.after),
    projectionState: "PENDING",
    planningDeliveryId: "30000000-0000-4000-8000-000000000002",
    emittedEventIds: ["30000000-0000-4000-8000-000000000003"],
  };
}

describe("Growth Plan control V1 server decoder", () => {
  it("decodes only the expected minimized contract variant", () => {
    expect(decodeCurrentGrowthPlanV1(boundary)).toEqual(boundary);
    expect(decodeGrowthPlanLifecyclePreviewV1(preview)).toEqual(preview);
    expect(decodeGrowthPlanLifecycleApplyResultV1(applyResult())).toEqual(applyResult());
  });

  it("decodes cadence source and preview only through their exact variants", () => {
    expect(decodeLearningTrackCadenceSourceV1(cadenceSource)).toEqual(cadenceSource);
    expect(decodeLearningTrackCadencePreviewV1(cadencePreview)).toEqual(cadencePreview);
    expect(() => decodeLearningTrackCadenceSourceV1(cadencePreview)).toThrow(
      GrowthPlanControlContractError,
    );
  });

  it("rejects a schema-valid wrong variant at every RPC boundary", () => {
    expect(() => decodeCurrentGrowthPlanV1(preview)).toThrow(GrowthPlanControlContractError);
    expect(() => decodeGrowthPlanLifecyclePreviewV1(boundary)).toThrow(
      GrowthPlanControlContractError,
    );
    expect(() => decodeGrowthPlanLifecycleApplyResultV1(preview)).toThrow(
      GrowthPlanControlContractError,
    );
  });

  it("rejects private fields and a structurally valid but incoherent preview", () => {
    expect(() =>
      decodeGrowthPlanLifecyclePreviewV1({ ...preview, workspaceId: "private" }),
    ).toThrow(GrowthPlanControlContractError);

    const incoherent = structuredClone(preview);
    incoherent.after.aggregateVersion = "99";
    expect(() => decodeGrowthPlanLifecyclePreviewV1(incoherent)).toThrow(
      GrowthPlanControlContractError,
    );
  });

  it("decodes coherent capacity previews and apply results", () => {
    expect(decodeGrowthPlanCapacityPreviewV1(capacityPreview)).toEqual(capacityPreview);
    const result = {
      contract: { name: "GrowthPlanCapacityApplyResultV1", version: "1.0.0" },
      commandId: uuid,
      changedPlan: capacityPreview.after,
      projectionState: "PENDING",
      planningDeliveryId: "30000000-0000-4000-8000-000000000002",
      emittedEventIds: ["30000000-0000-4000-8000-000000000003"],
    };
    expect(decodeGrowthPlanCapacityApplyResultV1(result)).toEqual(result);
  });

  it("rejects private or incoherent capacity previews", () => {
    expect(() =>
      decodeGrowthPlanCapacityPreviewV1({ ...capacityPreview, workspaceId: "private" }),
    ).toThrow(GrowthPlanControlContractError);
    expect(() =>
      decodeGrowthPlanCapacityPreviewV1({
        ...capacityPreview,
        canApply: false,
        blockingReasons: [],
      }),
    ).toThrow(GrowthPlanControlContractError);
  });

  it("decodes the bounded Track read, preview, and apply receipt", () => {
    const current = {
      contract: { name: "CurrentLearningTracksV1", version: "1.0.0" },
      growthPlan: trackPreview.growthPlan,
      learningTracks: [{ ...trackPreview.before, capabilities: ["pause_track"] }],
    };
    const result = {
      contract: { name: "LearningTrackLifecycleApplyResultV1", version: "1.0.0" },
      commandId: uuid,
      changedTrack: trackPreview.after,
      projectionState: "PENDING",
      planningDeliveryId: "30000000-0000-4000-8000-000000000002",
      emittedEventIds: ["30000000-0000-4000-8000-000000000003"],
    };
    expect(decodeCurrentLearningTracksV1(current)).toEqual(current);
    expect(decodeLearningTrackLifecyclePreviewV1(trackPreview)).toEqual(trackPreview);
    expect(decodeLearningTrackLifecycleApplyResultV1(result)).toEqual(result);
  });

  it("rejects Track variants, private fields, and semantic lies", () => {
    expect(() => decodeCurrentLearningTracksV1(trackPreview)).toThrow(
      GrowthPlanControlContractError,
    );
    expect(() =>
      decodeLearningTrackLifecyclePreviewV1({ ...trackPreview, workspaceId: "private" }),
    ).toThrow(GrowthPlanControlContractError);
    expect(() =>
      decodeLearningTrackLifecyclePreviewV1({
        ...trackPreview,
        expectedLearningTrackVersion: "6",
      }),
    ).toThrow(GrowthPlanControlContractError);
  });

  it("decodes only coherent Track priority/minimum previews and receipts", () => {
    const result = {
      contract: { name: "LearningTrackPriorityMinimumApplyResultV1", version: "1.0.0" },
      commandId: uuid,
      changedTrack: trackSettingsPreview.after,
      projectionState: "PENDING",
      planningDeliveryId: "30000000-0000-4000-8000-000000000002",
      emittedEventIds: ["30000000-0000-4000-8000-000000000003"],
    };
    expect(decodeLearningTrackPriorityMinimumPreviewV1(trackSettingsPreview)).toEqual(
      trackSettingsPreview,
    );
    expect(decodeLearningTrackPriorityMinimumApplyResultV1(result)).toEqual(result);
    expect(() =>
      decodeLearningTrackPriorityMinimumPreviewV1({
        ...trackSettingsPreview,
        workspaceId: "private",
      }),
    ).toThrow(GrowthPlanControlContractError);
  });

  it("decodes only the public manual activity admission source, preview, and receipt", () => {
    const source = {
      contract: { name: "LearningTrackActivityAdmissionSourceV1", version: "1.0.0" },
      state: "READY",
      capabilities: ["admit_activity_to_learning_track"],
      growthPlan: admissionPreview.growthPlan,
      learningTrack: {
        trackKey: admissionPreview.learningTrack.trackKey,
        title: admissionPreview.learningTrack.title,
        lifecycle: admissionPreview.learningTrack.lifecycle,
        priority: admissionPreview.learningTrack.priority,
        protectedMinimumMinutes: admissionPreview.learningTrack.protectedMinimumMinutes,
        defaultSessionMinutes: admissionPreview.learningTrack.defaultSessionMinutes,
        aggregateVersion: admissionPreview.learningTrack.aggregateVersionBefore,
      },
      activities: [
        {
          activityKey: admissionPreview.activity.activityKey,
          title: admissionPreview.activity.title,
          activityType: admissionPreview.activity.activityType,
          targetCompetencyRef: admissionPreview.activity.targetCompetencyRef,
        },
      ],
    };
    const result = {
      contract: { name: "LearningTrackActivityAdmissionApplyResultV1", version: "1.0.0" },
      commandId: uuid,
      changedTrack: {
        trackKey: admissionPreview.learningTrack.trackKey,
        aggregateVersion: admissionPreview.learningTrack.aggregateVersionAfter,
      },
      admittedActivity: {
        activityKey: admissionPreview.activity.activityKey,
        candidateKey: admissionPreview.activity.candidateKey,
        estimatedMinutes: admissionPreview.activity.estimatedMinutes,
        energy: admissionPreview.activity.energy,
      },
      projectionState: "PENDING",
      planningDeliveryId: "30000000-0000-4000-8000-000000000002",
      emittedEventIds: ["30000000-0000-4000-8000-000000000003"],
    };

    expect(decodeLearningTrackActivityAdmissionSourceV1(source)).toEqual(source);
    expect(decodeLearningTrackActivityAdmissionPreviewV1(admissionPreview)).toEqual(
      admissionPreview,
    );
    expect(decodeLearningTrackActivityAdmissionApplyResultV1(result)).toEqual(result);
    expect(() =>
      decodeLearningTrackActivityAdmissionPreviewV1({
        ...admissionPreview,
        internal: { workspaceId: uuid },
      }),
    ).toThrow(/failed its contract/iu);
    expect(() => decodeLearningTrackActivityAdmissionSourceV1(admissionPreview)).toThrow(
      /failed its contract/iu,
    );
  });
});
