import {
  PLANNING_CREATE_IDENTITY_VERSION,
  planningCreateUuidFromSha256,
} from "./growth-plan-initialization-preview";
import { growthPlanCapacityDigestField } from "./growth-plan-capacity-preview";

export const LEARNING_TRACK_CREATION_PREVIEW_DIGEST_VERSION =
  "learning-track-creation-preview-digest/1.0.0" as const;
export const LEARNING_TRACK_CREATION_REQUEST_HASH_VERSION =
  "learning-track-creation-request-hash/1.0.0" as const;
export const LEARNING_TRACK_CREATION_COMMAND_TYPE = "planning.create_learning_track_v1" as const;
export const LEARNING_TRACK_CREATION_IDENTITY_LABEL = "additional-learning-track" as const;

export type LearningTrackCreationWarningV1 = "PARENT_GROWTH_PLAN_PAUSED" | "TRACK_STARTS_EMPTY";

export interface LearningTrackCreationPreviewDigestFields {
  readonly workspaceId: string;
  readonly requestId: string;
  readonly reason: string;
  readonly expectedGrowthPlanVersion: string;
  readonly expectedReadinessGoalVersion: string;
  readonly growthPlan: {
    readonly title: string;
    readonly lifecycle: "ACTIVE" | "PAUSED";
    readonly weeklyCapacityMinutes: number;
    readonly aggregateVersion: string;
  };
  readonly source: {
    readonly readinessGoalId: string;
    readonly readinessGoalKey: string;
    readonly readinessGoalTitle: string;
    readonly readinessGoalLifecycle: "ACTIVE";
    readonly readinessGoalVersion: string;
    readonly profileVersionId: string;
    readonly profileVersionKey: string;
    readonly sourceKind: "ROADMAP_TEMPLATE_VERSION" | "TARGET_PROFILE_REQUIREMENT_COLLECTION";
    readonly sourceRef: string;
    readonly roadmapVersionId: string | null;
    readonly sourceOwnerRevision: string;
  };
  readonly constraint: {
    readonly currentTrackCountBefore: number;
    readonly currentTrackCountAfter: number;
    readonly currentTrackLimit: 30;
    readonly activeProtectedMinimumMinutesBefore: number;
    readonly activeProtectedMinimumMinutesAfter: number;
    readonly flexibleMinutesBefore: number;
    readonly flexibleMinutesAfter: number;
    readonly currentTrackOrderFingerprintBefore: string;
    readonly currentTrackOrderFingerprintAfter: string;
    readonly newTrackPosition: number;
  };
  readonly learningTrack: {
    readonly learningTrackId: string;
    readonly trackKey: string;
    readonly title: string;
    readonly lifecycle: "ACTIVE";
    readonly priority: number;
    readonly protectedMinimumMinutes: 0;
    readonly defaultSessionMinutes: number;
    readonly aggregateVersion: "1";
  };
  readonly canApply: boolean;
  readonly blockingReasonCode:
    "TRACK_PORTFOLIO_LIMIT_REACHED" | "PLANNING_CREATE_IDENTITY_COLLISION" | null;
  readonly warnings: readonly LearningTrackCreationWarningV1[];
}

export interface LearningTrackCreationRequestHashFields {
  readonly workspaceId: string;
  readonly requestId: string;
  readonly readinessGoalKey: string;
  readonly expectedReadinessGoalVersion: string;
  readonly title: string;
  readonly priority: number;
  readonly defaultSessionMinutes: number;
  readonly expectedGrowthPlanVersion: string;
  readonly reason: string;
  readonly previewDigest: string;
  readonly learningTrackId: string;
  readonly trackKey: string;
}

export function learningTrackCreationIdentityInput(value: {
  readonly workspaceId: string;
  readonly requestId: string;
}): string {
  return [
    growthPlanCapacityDigestField("identityVersion", PLANNING_CREATE_IDENTITY_VERSION),
    growthPlanCapacityDigestField("workspaceId", value.workspaceId.toLowerCase()),
    growthPlanCapacityDigestField("commandType", LEARNING_TRACK_CREATION_COMMAND_TYPE),
    growthPlanCapacityDigestField("idempotencyKey", value.requestId.toLowerCase()),
    growthPlanCapacityDigestField("label", LEARNING_TRACK_CREATION_IDENTITY_LABEL),
  ].join("");
}

export function learningTrackCreationUuidFromSha256(digest: Uint8Array): string {
  return planningCreateUuidFromSha256(digest);
}

export function learningTrackKeyFromId(learningTrackId: string): string {
  return `track:${learningTrackId.toLowerCase()}`;
}

export function learningTrackCreationPreviewDigestInput(
  value: LearningTrackCreationPreviewDigestFields,
): string {
  return [
    growthPlanCapacityDigestField("digestVersion", LEARNING_TRACK_CREATION_PREVIEW_DIGEST_VERSION),
    growthPlanCapacityDigestField("contractVersion", "1.0.0"),
    growthPlanCapacityDigestField("identityVersion", PLANNING_CREATE_IDENTITY_VERSION),
    growthPlanCapacityDigestField("workspaceId", value.workspaceId.toLowerCase()),
    growthPlanCapacityDigestField("operation", "create_learning_track"),
    growthPlanCapacityDigestField("commandType", LEARNING_TRACK_CREATION_COMMAND_TYPE),
    growthPlanCapacityDigestField("requestId", value.requestId.toLowerCase()),
    growthPlanCapacityDigestField("reason", value.reason),
    growthPlanCapacityDigestField("expectedGrowthPlanVersion", value.expectedGrowthPlanVersion),
    growthPlanCapacityDigestField(
      "expectedReadinessGoalVersion",
      value.expectedReadinessGoalVersion,
    ),
    growthPlanCapacityDigestField("growthPlanTitle", value.growthPlan.title),
    growthPlanCapacityDigestField("growthPlanLifecycle", value.growthPlan.lifecycle),
    growthPlanCapacityDigestField(
      "growthPlanWeeklyCapacityMinutes",
      String(value.growthPlan.weeklyCapacityMinutes),
    ),
    growthPlanCapacityDigestField("growthPlanAggregateVersion", value.growthPlan.aggregateVersion),
    growthPlanCapacityDigestField("readinessGoalId", value.source.readinessGoalId.toLowerCase()),
    growthPlanCapacityDigestField("readinessGoalKey", value.source.readinessGoalKey),
    growthPlanCapacityDigestField("readinessGoalTitle", value.source.readinessGoalTitle),
    growthPlanCapacityDigestField("readinessGoalLifecycle", value.source.readinessGoalLifecycle),
    growthPlanCapacityDigestField("readinessGoalVersion", value.source.readinessGoalVersion),
    growthPlanCapacityDigestField("profileVersionId", value.source.profileVersionId.toLowerCase()),
    growthPlanCapacityDigestField("profileVersionKey", value.source.profileVersionKey),
    growthPlanCapacityDigestField("sourceKind", value.source.sourceKind),
    growthPlanCapacityDigestField("sourceRef", value.source.sourceRef.toLowerCase()),
    growthPlanCapacityDigestField(
      "roadmapVersionId",
      value.source.roadmapVersionId?.toLowerCase() ?? "",
    ),
    growthPlanCapacityDigestField("sourceOwnerRevision", value.source.sourceOwnerRevision),
    growthPlanCapacityDigestField(
      "currentTrackCountBefore",
      String(value.constraint.currentTrackCountBefore),
    ),
    growthPlanCapacityDigestField(
      "currentTrackCountAfter",
      String(value.constraint.currentTrackCountAfter),
    ),
    growthPlanCapacityDigestField("currentTrackLimit", String(value.constraint.currentTrackLimit)),
    growthPlanCapacityDigestField(
      "activeProtectedMinimumMinutesBefore",
      String(value.constraint.activeProtectedMinimumMinutesBefore),
    ),
    growthPlanCapacityDigestField(
      "activeProtectedMinimumMinutesAfter",
      String(value.constraint.activeProtectedMinimumMinutesAfter),
    ),
    growthPlanCapacityDigestField(
      "flexibleMinutesBefore",
      String(value.constraint.flexibleMinutesBefore),
    ),
    growthPlanCapacityDigestField(
      "flexibleMinutesAfter",
      String(value.constraint.flexibleMinutesAfter),
    ),
    growthPlanCapacityDigestField(
      "currentTrackOrderFingerprintBefore",
      value.constraint.currentTrackOrderFingerprintBefore,
    ),
    growthPlanCapacityDigestField(
      "currentTrackOrderFingerprintAfter",
      value.constraint.currentTrackOrderFingerprintAfter,
    ),
    growthPlanCapacityDigestField("newTrackPosition", String(value.constraint.newTrackPosition)),
    growthPlanCapacityDigestField(
      "learningTrackId",
      value.learningTrack.learningTrackId.toLowerCase(),
    ),
    growthPlanCapacityDigestField("trackKey", value.learningTrack.trackKey),
    growthPlanCapacityDigestField("learningTrackTitle", value.learningTrack.title),
    growthPlanCapacityDigestField("learningTrackLifecycle", value.learningTrack.lifecycle),
    growthPlanCapacityDigestField("learningTrackPriority", String(value.learningTrack.priority)),
    growthPlanCapacityDigestField(
      "learningTrackProtectedMinimumMinutes",
      String(value.learningTrack.protectedMinimumMinutes),
    ),
    growthPlanCapacityDigestField(
      "learningTrackDefaultSessionMinutes",
      String(value.learningTrack.defaultSessionMinutes),
    ),
    growthPlanCapacityDigestField(
      "learningTrackAggregateVersion",
      value.learningTrack.aggregateVersion,
    ),
    growthPlanCapacityDigestField("canApply", String(value.canApply)),
    growthPlanCapacityDigestField("blockingReasonCode", value.blockingReasonCode ?? ""),
    growthPlanCapacityDigestField("warningCount", String(value.warnings.length)),
    ...value.warnings.map((warning) => growthPlanCapacityDigestField("warningCode", warning)),
    growthPlanCapacityDigestField("retainedPlanHistory", "true"),
    growthPlanCapacityDigestField("retainedTrackHistory", "true"),
    growthPlanCapacityDigestField("retainedActivitiesAndEvidence", "true"),
    growthPlanCapacityDigestField("retainedMasteryAndReadiness", "true"),
    growthPlanCapacityDigestField("retainedReviewQueue", "true"),
    growthPlanCapacityDigestField("retainedPlanSnapshots", "true"),
    growthPlanCapacityDigestField("projectionStateAfterApply", "PENDING"),
    growthPlanCapacityDigestField("eventChangeKind", "TRACK_CREATED"),
    growthPlanCapacityDigestField("consumerName", "planning.plan_snapshot_v1"),
  ].join("");
}

export function learningTrackCreationRequestHashInput(
  value: LearningTrackCreationRequestHashFields,
): string {
  return [
    growthPlanCapacityDigestField(
      "requestHashVersion",
      LEARNING_TRACK_CREATION_REQUEST_HASH_VERSION,
    ),
    growthPlanCapacityDigestField("schemaVersion", "1.0.0"),
    growthPlanCapacityDigestField("identityVersion", PLANNING_CREATE_IDENTITY_VERSION),
    growthPlanCapacityDigestField("workspaceId", value.workspaceId.toLowerCase()),
    growthPlanCapacityDigestField("commandType", LEARNING_TRACK_CREATION_COMMAND_TYPE),
    growthPlanCapacityDigestField("operation", "create_learning_track"),
    growthPlanCapacityDigestField("requestId", value.requestId.toLowerCase()),
    growthPlanCapacityDigestField("readinessGoalKey", value.readinessGoalKey),
    growthPlanCapacityDigestField(
      "expectedReadinessGoalVersion",
      value.expectedReadinessGoalVersion,
    ),
    growthPlanCapacityDigestField("title", value.title),
    growthPlanCapacityDigestField("priority", String(value.priority)),
    growthPlanCapacityDigestField("defaultSessionMinutes", String(value.defaultSessionMinutes)),
    growthPlanCapacityDigestField("expectedGrowthPlanVersion", value.expectedGrowthPlanVersion),
    growthPlanCapacityDigestField("reason", value.reason),
    growthPlanCapacityDigestField("previewDigest", value.previewDigest),
    growthPlanCapacityDigestField("learningTrackId", value.learningTrackId.toLowerCase()),
    growthPlanCapacityDigestField("trackKey", value.trackKey),
  ].join("");
}
