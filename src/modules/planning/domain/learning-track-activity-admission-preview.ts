import { growthPlanCapacityDigestField } from "./growth-plan-capacity-preview";

export const LEARNING_TRACK_ACTIVITY_ADMISSION_PREVIEW_DIGEST_VERSION =
  "learning-track-activity-admission-preview-digest/1.0.0" as const;
export const LEARNING_TRACK_ACTIVITY_ADMISSION_REQUEST_HASH_VERSION =
  "learning-track-activity-admission-request-hash/1.0.0" as const;
export const LEARNING_TRACK_ACTIVITY_ADMISSION_COMMAND_TYPE =
  "planning.add_learning_track_activity_v2" as const;
export const LEARNING_TRACK_ACTIVITY_ADMISSION_V2_PREVIEW_DIGEST_VERSION =
  "learning-track-activity-admission-preview-digest/2.0.0" as const;
export const LEARNING_TRACK_ACTIVITY_ADMISSION_V2_REQUEST_HASH_VERSION =
  "learning-track-activity-admission-request-hash/2.0.0" as const;
export const LEARNING_TRACK_ACTIVITY_ADMISSION_V2_COMMAND_TYPE =
  "planning.add_learning_track_activity_v3" as const;

export type ActivityAdmissionEnergy = "LOW" | "MEDIUM" | "HIGH" | null;
export type ActivityAdmissionLifecycle = "ACTIVE" | "PAUSED";
export type ActivityAdmissionWarning = "PARENT_GROWTH_PLAN_PAUSED" | "LEARNING_TRACK_PAUSED";

export interface LearningTrackActivityAdmissionPreviewDigestFields {
  readonly workspaceId: string;
  readonly requestId: string;
  readonly reason: string;
  readonly expectedGrowthPlanVersion: string;
  readonly expectedLearningTrackVersion: string;
  readonly growthPlan: {
    readonly growthPlanId: string;
    readonly title: string;
    readonly lifecycle: ActivityAdmissionLifecycle;
    readonly weeklyCapacityMinutes: number;
    readonly aggregateVersion: string;
  };
  readonly learningTrack: {
    readonly learningTrackId: string;
    readonly trackKey: string;
    readonly title: string;
    readonly lifecycle: ActivityAdmissionLifecycle;
    readonly priority: number;
    readonly protectedMinimumMinutes: number;
    readonly defaultSessionMinutes: number;
    readonly aggregateVersionBefore: string;
    readonly aggregateVersionAfter: string;
  };
  readonly readinessGoalId: string;
  readonly profileVersionId: string;
  readonly targetsOwnerRevision: string;
  readonly customActivityId: string;
  readonly activity: {
    readonly activityKey: string;
    readonly title: string;
    readonly activityType: "MANUAL_CODING" | "READING" | "EXPLANATION" | "MOCK" | "PROJECT";
    readonly targetCompetencyRef: string;
    readonly lifecycle: "ACTIVE";
    readonly mappingStatus: "ACCEPTED";
  };
  readonly overlayOwnerRevision: string;
  readonly candidateKey: string;
  readonly estimatedMinutes: number;
  readonly energy: ActivityAdmissionEnergy;
  readonly planActivityCountBefore: number;
  readonly planActivityCountAfter: number;
  readonly planActivityLimit: 200;
  readonly canApply: boolean;
  readonly blockingReason: "PLAN_ACTIVITY_LIMIT_REACHED" | undefined;
  readonly warnings: readonly ActivityAdmissionWarning[];
}

export interface LearningTrackActivityAdmissionRequestHashFields {
  readonly workspaceId: string;
  readonly requestId: string;
  readonly activityKey: string;
  readonly estimatedMinutes: number;
  readonly energy: ActivityAdmissionEnergy;
  readonly expectedGrowthPlanVersion: string;
  readonly expectedLearningTrackVersion: string;
  readonly reason: string;
  readonly previewDigest: string;
}

export interface LearningTrackActivityAdmissionPreviewDigestFieldsV2 extends LearningTrackActivityAdmissionPreviewDigestFields {
  readonly constraint: {
    readonly currentTrackOrderFingerprint: string;
  };
}

export interface LearningTrackActivityAdmissionRequestHashFieldsV2 extends LearningTrackActivityAdmissionRequestHashFields {
  readonly trackKey: string;
}

/** Canonical clock-free SHA-256 input. Field order and UTF-8 byte lengths are protocol material. */
export function learningTrackActivityAdmissionPreviewDigestInput(
  value: LearningTrackActivityAdmissionPreviewDigestFields,
): string {
  const field = growthPlanCapacityDigestField;
  return [
    field("digestVersion", LEARNING_TRACK_ACTIVITY_ADMISSION_PREVIEW_DIGEST_VERSION),
    field("contractVersion", "1.0.0"),
    field("workspaceId", value.workspaceId.toLowerCase()),
    field("operation", "admit_activity_to_learning_track"),
    field("commandType", LEARNING_TRACK_ACTIVITY_ADMISSION_COMMAND_TYPE),
    field("requestId", value.requestId.toLowerCase()),
    field("reason", value.reason),
    field("expectedGrowthPlanVersion", value.expectedGrowthPlanVersion),
    field("expectedLearningTrackVersion", value.expectedLearningTrackVersion),
    field("growthPlanId", value.growthPlan.growthPlanId.toLowerCase()),
    field("growthPlanTitle", value.growthPlan.title),
    field("growthPlanLifecycle", value.growthPlan.lifecycle),
    field("growthPlanWeeklyCapacityMinutes", String(value.growthPlan.weeklyCapacityMinutes)),
    field("growthPlanAggregateVersion", value.growthPlan.aggregateVersion),
    field("learningTrackId", value.learningTrack.learningTrackId.toLowerCase()),
    field("trackKey", value.learningTrack.trackKey),
    field("learningTrackTitle", value.learningTrack.title),
    field("learningTrackLifecycle", value.learningTrack.lifecycle),
    field("learningTrackPriority", String(value.learningTrack.priority)),
    field(
      "learningTrackProtectedMinimumMinutes",
      String(value.learningTrack.protectedMinimumMinutes),
    ),
    field("learningTrackDefaultSessionMinutes", String(value.learningTrack.defaultSessionMinutes)),
    field("learningTrackVersionBefore", value.learningTrack.aggregateVersionBefore),
    field("learningTrackVersionAfter", value.learningTrack.aggregateVersionAfter),
    field("readinessGoalId", value.readinessGoalId.toLowerCase()),
    field("profileVersionId", value.profileVersionId.toLowerCase()),
    field("targetsOwnerRevision", value.targetsOwnerRevision),
    field("customActivityId", value.customActivityId.toLowerCase()),
    field("activityKey", value.activity.activityKey),
    field("activityTitle", value.activity.title),
    field("activityType", value.activity.activityType),
    field("targetCompetencyRef", value.activity.targetCompetencyRef),
    field("activityLifecycle", value.activity.lifecycle),
    field("activityMappingStatus", value.activity.mappingStatus),
    field("overlayOwnerRevision", value.overlayOwnerRevision),
    field("candidateKey", value.candidateKey),
    field("estimatedMinutes", String(value.estimatedMinutes)),
    field("energy", value.energy ?? ""),
    field("planActivityCountBefore", String(value.planActivityCountBefore)),
    field("planActivityCountAfter", String(value.planActivityCountAfter)),
    field("planActivityLimit", String(value.planActivityLimit)),
    field("canApply", String(value.canApply)),
    field("blockingReasonCode", value.blockingReason ?? ""),
    field("warningCount", String(value.warnings.length)),
    ...value.warnings.map((warning) => field("warningCode", warning)),
    field("retainedActivitiesAndEvidence", "true"),
    field("retainedPlanSnapshots", "true"),
    field("retainedFocusSessions", "true"),
    field("retainedMasteryAndReadiness", "true"),
    field("projectionStateAfterApply", "PENDING"),
    field("eventChangeKind", "TRACK_ACTIVITY_ADMITTED"),
    field("consumerName", "planning.plan_snapshot_v1"),
  ].join("");
}

/** Canonical input for retry-safe apply receipt matching. */
export function learningTrackActivityAdmissionRequestHashInput(
  value: LearningTrackActivityAdmissionRequestHashFields,
): string {
  const field = growthPlanCapacityDigestField;
  return [
    field("requestHashVersion", LEARNING_TRACK_ACTIVITY_ADMISSION_REQUEST_HASH_VERSION),
    field("commandType", LEARNING_TRACK_ACTIVITY_ADMISSION_COMMAND_TYPE),
    field("workspaceId", value.workspaceId.toLowerCase()),
    field("requestId", value.requestId.toLowerCase()),
    field("activityKey", value.activityKey),
    field("estimatedMinutes", String(value.estimatedMinutes)),
    field("energy", value.energy ?? ""),
    field("expectedGrowthPlanVersion", value.expectedGrowthPlanVersion),
    field("expectedLearningTrackVersion", value.expectedLearningTrackVersion),
    field("reason", value.reason),
    field("previewDigest", value.previewDigest),
  ].join("");
}

/** Canonical clock-free SHA-256 input for destination-aware V2 admission. */
export function learningTrackActivityAdmissionPreviewDigestInputV2(
  value: LearningTrackActivityAdmissionPreviewDigestFieldsV2,
): string {
  const field = growthPlanCapacityDigestField;
  return [
    field("digestVersion", LEARNING_TRACK_ACTIVITY_ADMISSION_V2_PREVIEW_DIGEST_VERSION),
    field("contractVersion", "2.0.0"),
    field("workspaceId", value.workspaceId.toLowerCase()),
    field("operation", "admit_activity_to_learning_track"),
    field("commandType", LEARNING_TRACK_ACTIVITY_ADMISSION_V2_COMMAND_TYPE),
    field("requestId", value.requestId.toLowerCase()),
    field("reason", value.reason),
    field("expectedGrowthPlanVersion", value.expectedGrowthPlanVersion),
    field("expectedLearningTrackVersion", value.expectedLearningTrackVersion),
    field("growthPlanId", value.growthPlan.growthPlanId.toLowerCase()),
    field("growthPlanTitle", value.growthPlan.title),
    field("growthPlanLifecycle", value.growthPlan.lifecycle),
    field("growthPlanWeeklyCapacityMinutes", String(value.growthPlan.weeklyCapacityMinutes)),
    field("growthPlanAggregateVersion", value.growthPlan.aggregateVersion),
    field("learningTrackId", value.learningTrack.learningTrackId.toLowerCase()),
    field("trackKey", value.learningTrack.trackKey),
    field("learningTrackTitle", value.learningTrack.title),
    field("learningTrackLifecycle", value.learningTrack.lifecycle),
    field("learningTrackPriority", String(value.learningTrack.priority)),
    field(
      "learningTrackProtectedMinimumMinutes",
      String(value.learningTrack.protectedMinimumMinutes),
    ),
    field("learningTrackDefaultSessionMinutes", String(value.learningTrack.defaultSessionMinutes)),
    field("learningTrackVersionBefore", value.learningTrack.aggregateVersionBefore),
    field("learningTrackVersionAfter", value.learningTrack.aggregateVersionAfter),
    field("readinessGoalId", value.readinessGoalId.toLowerCase()),
    field("profileVersionId", value.profileVersionId.toLowerCase()),
    field("targetsOwnerRevision", value.targetsOwnerRevision),
    field("customActivityId", value.customActivityId.toLowerCase()),
    field("activityKey", value.activity.activityKey),
    field("activityTitle", value.activity.title),
    field("activityType", value.activity.activityType),
    field("targetCompetencyRef", value.activity.targetCompetencyRef),
    field("activityLifecycle", value.activity.lifecycle),
    field("activityMappingStatus", value.activity.mappingStatus),
    field("overlayOwnerRevision", value.overlayOwnerRevision),
    field("candidateKey", value.candidateKey),
    field("estimatedMinutes", String(value.estimatedMinutes)),
    field("energy", value.energy ?? ""),
    field("planActivityCountBefore", String(value.planActivityCountBefore)),
    field("planActivityCountAfter", String(value.planActivityCountAfter)),
    field("planActivityLimit", String(value.planActivityLimit)),
    field(
      "currentTrackOrderFingerprint",
      value.constraint.currentTrackOrderFingerprint.toLowerCase(),
    ),
    field("canApply", String(value.canApply)),
    field("blockingReasonCode", value.blockingReason ?? ""),
    field("warningCount", String(value.warnings.length)),
    ...value.warnings.map((warning) => field("warningCode", warning)),
    field("retainedActivitiesAndEvidence", "true"),
    field("retainedPlanSnapshots", "true"),
    field("retainedFocusSessions", "true"),
    field("retainedMasteryAndReadiness", "true"),
    field("projectionStateAfterApply", "PENDING"),
    field("eventChangeKind", "TRACK_ACTIVITY_ADMITTED"),
    field("consumerName", "planning.plan_snapshot_v1"),
  ].join("");
}

/** Canonical input for retry-safe V2 apply receipt matching. */
export function learningTrackActivityAdmissionRequestHashInputV2(
  value: LearningTrackActivityAdmissionRequestHashFieldsV2,
): string {
  const field = growthPlanCapacityDigestField;
  return [
    field("requestHashVersion", LEARNING_TRACK_ACTIVITY_ADMISSION_V2_REQUEST_HASH_VERSION),
    field("commandType", LEARNING_TRACK_ACTIVITY_ADMISSION_V2_COMMAND_TYPE),
    field("workspaceId", value.workspaceId.toLowerCase()),
    field("requestId", value.requestId.toLowerCase()),
    field("trackKey", value.trackKey),
    field("activityKey", value.activityKey),
    field("estimatedMinutes", String(value.estimatedMinutes)),
    field("energy", value.energy ?? ""),
    field("expectedGrowthPlanVersion", value.expectedGrowthPlanVersion),
    field("expectedLearningTrackVersion", value.expectedLearningTrackVersion),
    field("reason", value.reason),
    field("previewDigest", value.previewDigest),
  ].join("");
}
