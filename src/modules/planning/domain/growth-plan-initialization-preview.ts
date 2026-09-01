import { growthPlanCapacityDigestField } from "./growth-plan-capacity-preview";

export const PLANNING_CREATE_IDENTITY_VERSION = "planning-create-identity/1.0.0" as const;
export const GROWTH_PLAN_INITIALIZATION_PREVIEW_DIGEST_VERSION =
  "growth-plan-initialization-preview-digest/1.0.0" as const;
export const GROWTH_PLAN_INITIALIZATION_REQUEST_HASH_VERSION =
  "growth-plan-initialization-request-hash/1.0.0" as const;
export const GROWTH_PLAN_INITIALIZATION_COMMAND_TYPE =
  "planning.initialize_growth_plan_v2" as const;

export type PlanningCreateIdentityLabel = "growth-plan" | "initial-learning-track";

export interface PlanningCreateIdentityFields {
  readonly workspaceId: string;
  readonly idempotencyKey: string;
  readonly label: PlanningCreateIdentityLabel;
}

/** Canonical, clock-free input used to derive a new Planning aggregate UUID. */
export function planningCreateIdentityInput(value: PlanningCreateIdentityFields): string {
  return [
    growthPlanCapacityDigestField("identityVersion", PLANNING_CREATE_IDENTITY_VERSION),
    growthPlanCapacityDigestField("workspaceId", value.workspaceId.toLowerCase()),
    growthPlanCapacityDigestField("commandType", GROWTH_PLAN_INITIALIZATION_COMMAND_TYPE),
    growthPlanCapacityDigestField("idempotencyKey", value.idempotencyKey.toLowerCase()),
    growthPlanCapacityDigestField("label", value.label),
  ].join("");
}

/** Converts the first 16 SHA-256 bytes to a lowercase RFC-variant UUIDv8. */
export function planningCreateUuidFromSha256(digest: Uint8Array): string {
  if (digest.byteLength !== 32) throw new RangeError("Planning create identity requires SHA-256");
  const bytes = Uint8Array.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x80;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** PostgreSQL-compatible `btrim(left(title, 160))` for bounded Unicode titles. */
export function initialLearningTrackTitle(readinessGoalTitle: string): string {
  return Array.from(readinessGoalTitle)
    .slice(0, 160)
    .join("")
    .replace(/^ +| +$/gu, "");
}

export interface GrowthPlanInitializationPreviewDigestFields {
  readonly workspaceId: string;
  readonly idempotencyKey: string;
  readonly reason: string;
  readonly expectedReadinessGoalVersion: string;
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
    readonly currentPlanCount: number;
    readonly snapshotSentinelCount: number;
  };
  readonly after: {
    readonly lifetimePlanCount: number;
    readonly currentPlanCount: number;
    readonly currentPlanLimit: 1;
    readonly snapshotSentinelCount: number;
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
      readonly defaultSessionMinutes: number;
      readonly aggregateVersion: "1";
    };
  };
  readonly canApply: boolean;
  readonly blockingReasonCode:
    | "CURRENT_GROWTH_PLAN_EXISTS"
    | "GROWTH_PLAN_HISTORY_REQUIRES_REPLACEMENT"
    | "PLANNING_CREATE_IDENTITY_COLLISION"
    | null;
  readonly warnings: readonly "INITIAL_TRACK_HAS_NO_ACTIVITIES"[];
  readonly retained: {
    readonly readinessGoal: true;
    readonly competencyOverlay: true;
    readonly activitiesAndEvidence: true;
    readonly mastery: true;
    readonly reviews: true;
    readonly history: true;
  };
}

/** Canonical input hashed by PostgreSQL and TypeScript for the D1b setup preview. */
export function growthPlanInitializationPreviewDigestInput(
  value: GrowthPlanInitializationPreviewDigestFields,
): string {
  const source = value.source;
  const plan = value.after.growthPlan;
  const track = value.after.learningTrack;
  return [
    growthPlanCapacityDigestField(
      "digestVersion",
      GROWTH_PLAN_INITIALIZATION_PREVIEW_DIGEST_VERSION,
    ),
    growthPlanCapacityDigestField("contractVersion", "1.0.0"),
    growthPlanCapacityDigestField("identityVersion", PLANNING_CREATE_IDENTITY_VERSION),
    growthPlanCapacityDigestField("workspaceId", value.workspaceId.toLowerCase()),
    growthPlanCapacityDigestField("operation", "initialize_growth_plan"),
    growthPlanCapacityDigestField("commandType", GROWTH_PLAN_INITIALIZATION_COMMAND_TYPE),
    growthPlanCapacityDigestField("idempotencyKey", value.idempotencyKey.toLowerCase()),
    growthPlanCapacityDigestField("reason", value.reason),
    growthPlanCapacityDigestField(
      "expectedReadinessGoalVersion",
      value.expectedReadinessGoalVersion,
    ),
    growthPlanCapacityDigestField("readinessGoalId", source.readinessGoalId.toLowerCase()),
    growthPlanCapacityDigestField("readinessGoalKey", source.readinessGoalKey),
    growthPlanCapacityDigestField("readinessGoalTitle", source.readinessGoalTitle),
    growthPlanCapacityDigestField("readinessGoalLifecycle", source.readinessGoalLifecycle),
    growthPlanCapacityDigestField("readinessGoalVersion", source.readinessGoalVersion),
    growthPlanCapacityDigestField("profileVersionId", source.profileVersionId.toLowerCase()),
    growthPlanCapacityDigestField("profileVersionKey", source.profileVersionKey),
    growthPlanCapacityDigestField("sourceKind", source.sourceKind),
    growthPlanCapacityDigestField("sourceRef", source.sourceRef.toLowerCase()),
    growthPlanCapacityDigestField("roadmapVersionId", source.roadmapVersionId?.toLowerCase() ?? ""),
    growthPlanCapacityDigestField("sourceOwnerRevision", source.sourceOwnerRevision),
    growthPlanCapacityDigestField(
      "lifetimePlanCountBefore",
      String(value.before.lifetimePlanCount),
    ),
    growthPlanCapacityDigestField("lifetimePlanCountAfter", String(value.after.lifetimePlanCount)),
    growthPlanCapacityDigestField("currentPlanCountBefore", String(value.before.currentPlanCount)),
    growthPlanCapacityDigestField("currentPlanCountAfter", String(value.after.currentPlanCount)),
    growthPlanCapacityDigestField("currentPlanLimit", String(value.after.currentPlanLimit)),
    growthPlanCapacityDigestField(
      "snapshotSentinelCountBefore",
      String(value.before.snapshotSentinelCount),
    ),
    growthPlanCapacityDigestField(
      "snapshotSentinelCountAfter",
      String(value.after.snapshotSentinelCount),
    ),
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
    growthPlanCapacityDigestField(
      "learningTrackDefaultSessionMinutes",
      String(track.defaultSessionMinutes),
    ),
    growthPlanCapacityDigestField("learningTrackVersion", track.aggregateVersion),
    growthPlanCapacityDigestField("canApply", String(value.canApply)),
    growthPlanCapacityDigestField("blockingReasonCode", value.blockingReasonCode ?? ""),
    growthPlanCapacityDigestField("warningCount", String(value.warnings.length)),
    ...value.warnings.map((warning) => growthPlanCapacityDigestField("warningCode", warning)),
    growthPlanCapacityDigestField("retainedReadinessGoal", String(value.retained.readinessGoal)),
    growthPlanCapacityDigestField(
      "retainedCompetencyOverlay",
      String(value.retained.competencyOverlay),
    ),
    growthPlanCapacityDigestField(
      "retainedActivitiesAndEvidence",
      String(value.retained.activitiesAndEvidence),
    ),
    growthPlanCapacityDigestField("retainedMastery", String(value.retained.mastery)),
    growthPlanCapacityDigestField("retainedReviews", String(value.retained.reviews)),
    growthPlanCapacityDigestField("retainedHistory", String(value.retained.history)),
    growthPlanCapacityDigestField("projectionStateAfterApply", "PENDING"),
    growthPlanCapacityDigestField("eventChangeKind", "INITIALIZED"),
    growthPlanCapacityDigestField("consumerName", "planning.plan_snapshot_v1"),
  ].join("");
}

export interface GrowthPlanInitializationRequestHashFields {
  readonly workspaceId: string;
  readonly idempotencyKey: string;
  readonly readinessGoalKey: string;
  readonly expectedReadinessGoalVersion: string;
  readonly weeklyCapacityMinutes: number;
  readonly defaultSessionMinutes: number;
  readonly trackPriority: number;
  readonly reason: string;
  readonly previewDigest: string;
  readonly growthPlanId: string;
  readonly learningTrackId: string;
  readonly trackKey: string;
}

/** Canonical request-hash input stored by the D1b command receipt. */
export function growthPlanInitializationRequestHashInput(
  value: GrowthPlanInitializationRequestHashFields,
): string {
  return [
    growthPlanCapacityDigestField(
      "requestHashVersion",
      GROWTH_PLAN_INITIALIZATION_REQUEST_HASH_VERSION,
    ),
    growthPlanCapacityDigestField("schemaVersion", "1.0.0"),
    growthPlanCapacityDigestField("identityVersion", PLANNING_CREATE_IDENTITY_VERSION),
    growthPlanCapacityDigestField("workspaceId", value.workspaceId.toLowerCase()),
    growthPlanCapacityDigestField("commandType", GROWTH_PLAN_INITIALIZATION_COMMAND_TYPE),
    growthPlanCapacityDigestField("operation", "initialize_growth_plan"),
    growthPlanCapacityDigestField("idempotencyKey", value.idempotencyKey.toLowerCase()),
    growthPlanCapacityDigestField("readinessGoalKey", value.readinessGoalKey),
    growthPlanCapacityDigestField(
      "expectedReadinessGoalVersion",
      value.expectedReadinessGoalVersion,
    ),
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
