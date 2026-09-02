import { growthPlanCapacityDigestField } from "./growth-plan-capacity-preview";
import { PLANNING_CREATE_IDENTITY_VERSION } from "./growth-plan-initialization-preview";

export const GROWTH_PLAN_REPLACEMENT_PREVIEW_DIGEST_VERSION =
  "growth-plan-replacement-preview-digest/1.0.0" as const;
export const GROWTH_PLAN_REPLACEMENT_REQUEST_HASH_VERSION =
  "growth-plan-replacement-request-hash/1.0.0" as const;
export const GROWTH_PLAN_REPLACEMENT_COMMAND_TYPE = "planning.replace_growth_plan_v1" as const;
export const GROWTH_PLAN_CHILD_TRACK_FINGERPRINT_VERSION =
  "growth-plan-child-track-fingerprint/1.0.0" as const;

export type GrowthPlanReplacementIdentityLabel = "growth-plan" | "initial-learning-track";

export interface GrowthPlanReplacementIdentityFields {
  readonly workspaceId: string;
  readonly idempotencyKey: string;
  readonly label: GrowthPlanReplacementIdentityLabel;
}

/** Canonical, clock-free input used to derive a replacement Planning aggregate UUID. */
export function growthPlanReplacementIdentityInput(
  value: GrowthPlanReplacementIdentityFields,
): string {
  return [
    growthPlanCapacityDigestField("identityVersion", PLANNING_CREATE_IDENTITY_VERSION),
    growthPlanCapacityDigestField("workspaceId", value.workspaceId.toLowerCase()),
    growthPlanCapacityDigestField("commandType", GROWTH_PLAN_REPLACEMENT_COMMAND_TYPE),
    growthPlanCapacityDigestField("idempotencyKey", value.idempotencyKey.toLowerCase()),
    growthPlanCapacityDigestField("label", value.label),
  ].join("");
}

export interface GrowthPlanChildTrackFingerprintFields {
  readonly childTrackCount: number;
  /** Every child Track of the outgoing Plan, in ascending learning-track-id order. */
  readonly tracks: readonly {
    readonly learningTrackId: string;
    readonly aggregateVersion: string;
    readonly lifecycle: "ACTIVE" | "PAUSED" | "COMPLETED" | "ARCHIVED";
  }[];
}

/** Canonical input hashed into the outgoing Plan's child-Track fingerprint. */
export function growthPlanChildTrackFingerprintInput(
  value: GrowthPlanChildTrackFingerprintFields,
): string {
  return [
    growthPlanCapacityDigestField(
      "fingerprintVersion",
      GROWTH_PLAN_CHILD_TRACK_FINGERPRINT_VERSION,
    ),
    growthPlanCapacityDigestField("childTrackCount", String(value.childTrackCount)),
    ...value.tracks.flatMap((track) => [
      growthPlanCapacityDigestField("learningTrackId", track.learningTrackId.toLowerCase()),
      growthPlanCapacityDigestField("aggregateVersion", track.aggregateVersion),
      growthPlanCapacityDigestField("lifecycle", track.lifecycle),
    ]),
  ].join("");
}

export type GrowthPlanReplacementWarningCode =
  "ARCHIVED_PLAN_IS_READ_ONLY" | "CURRENT_TRACKS_NOT_COPIED" | "INITIAL_TRACK_HAS_NO_ACTIVITIES";

export interface GrowthPlanReplacementPreviewDigestFields {
  readonly workspaceId: string;
  readonly idempotencyKey: string;
  readonly reason: string;
  readonly expectedReadinessGoalVersion: string;
  readonly expectedGrowthPlanVersion: string;
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
  readonly before: {
    readonly lifetimePlanCount: number;
    readonly growthPlan: {
      readonly growthPlanId: string;
      readonly title: string;
      readonly lifecycle: "ACTIVE" | "PAUSED";
      readonly weeklyCapacityMinutes: number;
      readonly aggregateVersion: string;
    };
    readonly childTracks: {
      readonly total: number;
      readonly active: number;
      readonly paused: number;
      readonly completed: number;
      readonly archived: number;
      readonly fingerprint: string;
    };
  };
  readonly after: {
    readonly archivedPlan: { readonly aggregateVersion: string };
    readonly growthPlan: {
      readonly growthPlanId: string;
      readonly title: string;
      readonly lifecycle: "ACTIVE";
      readonly weeklyCapacityMinutes: number;
      readonly aggregateVersion: "1";
    };
    readonly learningTrack: {
      readonly learningTrackId: string;
      readonly trackKey: string;
      readonly title: string;
      readonly lifecycle: "ACTIVE";
      readonly priority: number;
      readonly protectedMinimumMinutes: 0;
      readonly cadencePerWeek: 0;
      readonly defaultSessionMinutes: number;
      readonly aggregateVersion: "1";
    };
  };
  readonly canApply: boolean;
  readonly blockingReasonCode: "PLANNING_CREATE_IDENTITY_COLLISION" | null;
  readonly warnings: readonly GrowthPlanReplacementWarningCode[];
}

/** Canonical input hashed by PostgreSQL and TypeScript for the D3a replacement preview. */
export function growthPlanReplacementPreviewDigestInput(
  value: GrowthPlanReplacementPreviewDigestFields,
): string {
  const source = value.source;
  const outgoing = value.before.growthPlan;
  const tracks = value.before.childTracks;
  const plan = value.after.growthPlan;
  const track = value.after.learningTrack;
  return [
    growthPlanCapacityDigestField("digestVersion", GROWTH_PLAN_REPLACEMENT_PREVIEW_DIGEST_VERSION),
    growthPlanCapacityDigestField("contractVersion", "1.0.0"),
    growthPlanCapacityDigestField("identityVersion", PLANNING_CREATE_IDENTITY_VERSION),
    growthPlanCapacityDigestField("workspaceId", value.workspaceId.toLowerCase()),
    growthPlanCapacityDigestField("operation", "replace_growth_plan"),
    growthPlanCapacityDigestField("commandType", GROWTH_PLAN_REPLACEMENT_COMMAND_TYPE),
    growthPlanCapacityDigestField("idempotencyKey", value.idempotencyKey.toLowerCase()),
    growthPlanCapacityDigestField("reason", value.reason),
    growthPlanCapacityDigestField(
      "expectedReadinessGoalVersion",
      value.expectedReadinessGoalVersion,
    ),
    growthPlanCapacityDigestField("expectedGrowthPlanVersion", value.expectedGrowthPlanVersion),
    growthPlanCapacityDigestField("readinessGoalId", source.readinessGoalId.toLowerCase()),
    growthPlanCapacityDigestField("readinessGoalKey", source.readinessGoalKey),
    growthPlanCapacityDigestField("readinessGoalTitle", source.readinessGoalTitle),
    growthPlanCapacityDigestField("readinessGoalLifecycle", source.readinessGoalLifecycle),
    growthPlanCapacityDigestField("readinessGoalVersion", source.readinessGoalVersion),
    growthPlanCapacityDigestField("profileVersionId", source.profileVersionId.toLowerCase()),
    growthPlanCapacityDigestField("profileVersionKey", source.profileVersionKey),
    growthPlanCapacityDigestField("sourceKind", source.sourceKind),
    growthPlanCapacityDigestField("sourceRef", source.sourceRef.toLowerCase()),
    growthPlanCapacityDigestField(
      "roadmapVersionId",
      source.roadmapVersionId === null ? "" : source.roadmapVersionId.toLowerCase(),
    ),
    growthPlanCapacityDigestField("sourceOwnerRevision", source.sourceOwnerRevision),
    growthPlanCapacityDigestField("archivedGrowthPlanId", outgoing.growthPlanId.toLowerCase()),
    growthPlanCapacityDigestField("archivedGrowthPlanTitle", outgoing.title),
    growthPlanCapacityDigestField("archivedGrowthPlanLifecycleBefore", outgoing.lifecycle),
    growthPlanCapacityDigestField("archivedGrowthPlanLifecycleAfter", "ARCHIVED"),
    growthPlanCapacityDigestField(
      "archivedGrowthPlanWeeklyCapacityMinutes",
      String(outgoing.weeklyCapacityMinutes),
    ),
    growthPlanCapacityDigestField("archivedGrowthPlanVersionBefore", outgoing.aggregateVersion),
    growthPlanCapacityDigestField(
      "archivedGrowthPlanVersionAfter",
      value.after.archivedPlan.aggregateVersion,
    ),
    growthPlanCapacityDigestField("childTrackCount", String(tracks.total)),
    growthPlanCapacityDigestField("activeTrackCount", String(tracks.active)),
    growthPlanCapacityDigestField("pausedTrackCount", String(tracks.paused)),
    growthPlanCapacityDigestField("completedTrackCount", String(tracks.completed)),
    growthPlanCapacityDigestField("archivedTrackCount", String(tracks.archived)),
    growthPlanCapacityDigestField("childTrackFingerprint", tracks.fingerprint),
    growthPlanCapacityDigestField(
      "lifetimePlanCountBefore",
      String(value.before.lifetimePlanCount),
    ),
    growthPlanCapacityDigestField(
      "lifetimePlanCountAfter",
      String(value.before.lifetimePlanCount + 1),
    ),
    growthPlanCapacityDigestField("currentPlanCountBefore", "1"),
    growthPlanCapacityDigestField("currentPlanCountAfter", "1"),
    growthPlanCapacityDigestField("currentPlanLimit", "1"),
    growthPlanCapacityDigestField("growthPlanId", plan.growthPlanId.toLowerCase()),
    growthPlanCapacityDigestField("growthPlanTitle", plan.title),
    growthPlanCapacityDigestField("growthPlanLifecycle", plan.lifecycle),
    growthPlanCapacityDigestField(
      "growthPlanWeeklyCapacityMinutes",
      String(plan.weeklyCapacityMinutes),
    ),
    growthPlanCapacityDigestField("growthPlanVersion", plan.aggregateVersion),
    growthPlanCapacityDigestField("learningTrackId", track.learningTrackId.toLowerCase()),
    growthPlanCapacityDigestField("trackKey", track.trackKey),
    growthPlanCapacityDigestField("learningTrackTitle", track.title),
    growthPlanCapacityDigestField("learningTrackLifecycle", track.lifecycle),
    growthPlanCapacityDigestField("learningTrackPriority", String(track.priority)),
    growthPlanCapacityDigestField(
      "learningTrackProtectedMinimumMinutes",
      String(track.protectedMinimumMinutes),
    ),
    growthPlanCapacityDigestField("learningTrackCadencePerWeek", String(track.cadencePerWeek)),
    growthPlanCapacityDigestField(
      "learningTrackDefaultSessionMinutes",
      String(track.defaultSessionMinutes),
    ),
    growthPlanCapacityDigestField("learningTrackVersion", track.aggregateVersion),
    growthPlanCapacityDigestField("canApply", String(value.canApply)),
    growthPlanCapacityDigestField("blockingReasonCode", value.blockingReasonCode ?? ""),
    growthPlanCapacityDigestField("warningCount", String(value.warnings.length)),
    ...value.warnings.map((warning) => growthPlanCapacityDigestField("warningCode", warning)),
    growthPlanCapacityDigestField("retainedReadinessGoal", "true"),
    growthPlanCapacityDigestField("retainedArchivedPlan", "true"),
    growthPlanCapacityDigestField("retainedLearningTrackHistory", "true"),
    growthPlanCapacityDigestField("retainedActivitiesAndEvidence", "true"),
    growthPlanCapacityDigestField("retainedMastery", "true"),
    growthPlanCapacityDigestField("retainedReviews", "true"),
    growthPlanCapacityDigestField("retainedPlanSnapshots", "true"),
    growthPlanCapacityDigestField("projectionStateAfterApply", "PENDING"),
    growthPlanCapacityDigestField("eventChangeKind", "PLAN_REPLACED"),
    growthPlanCapacityDigestField("consumerName", "planning.plan_snapshot_v1"),
  ].join("");
}

export interface GrowthPlanReplacementRequestHashFields {
  readonly workspaceId: string;
  readonly idempotencyKey: string;
  readonly readinessGoalKey: string;
  readonly expectedReadinessGoalVersion: string;
  readonly expectedGrowthPlanVersion: string;
  readonly weeklyCapacityMinutes: number;
  readonly defaultSessionMinutes: number;
  readonly trackPriority: number;
  readonly reason: string;
  readonly previewDigest: string;
  readonly growthPlanId: string;
  readonly learningTrackId: string;
  readonly trackKey: string;
}

/** Canonical request-hash input stored by the D3a command receipt. */
export function growthPlanReplacementRequestHashInput(
  value: GrowthPlanReplacementRequestHashFields,
): string {
  return [
    growthPlanCapacityDigestField(
      "requestHashVersion",
      GROWTH_PLAN_REPLACEMENT_REQUEST_HASH_VERSION,
    ),
    growthPlanCapacityDigestField("schemaVersion", "1.0.0"),
    growthPlanCapacityDigestField("identityVersion", PLANNING_CREATE_IDENTITY_VERSION),
    growthPlanCapacityDigestField("workspaceId", value.workspaceId.toLowerCase()),
    growthPlanCapacityDigestField("commandType", GROWTH_PLAN_REPLACEMENT_COMMAND_TYPE),
    growthPlanCapacityDigestField("operation", "replace_growth_plan"),
    growthPlanCapacityDigestField("idempotencyKey", value.idempotencyKey.toLowerCase()),
    growthPlanCapacityDigestField("readinessGoalKey", value.readinessGoalKey),
    growthPlanCapacityDigestField(
      "expectedReadinessGoalVersion",
      value.expectedReadinessGoalVersion,
    ),
    growthPlanCapacityDigestField("expectedGrowthPlanVersion", value.expectedGrowthPlanVersion),
    growthPlanCapacityDigestField("weeklyCapacityMinutes", String(value.weeklyCapacityMinutes)),
    growthPlanCapacityDigestField("defaultSessionMinutes", String(value.defaultSessionMinutes)),
    growthPlanCapacityDigestField("trackPriority", String(value.trackPriority)),
    growthPlanCapacityDigestField("reason", value.reason),
    growthPlanCapacityDigestField("previewDigest", value.previewDigest),
    growthPlanCapacityDigestField("growthPlanId", value.growthPlanId.toLowerCase()),
    growthPlanCapacityDigestField("learningTrackId", value.learningTrackId.toLowerCase()),
    growthPlanCapacityDigestField("trackKey", value.trackKey),
  ].join("");
}
