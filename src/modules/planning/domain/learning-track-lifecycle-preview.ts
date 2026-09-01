import {
  ACTIVE_TRACK_CONSTRAINT_FINGERPRINT_VERSION,
  activeTrackConstraintFingerprintInput,
  growthPlanCapacityDigestField,
  type ActiveTrackConstraintFingerprintEntry,
} from "./growth-plan-capacity-preview";

export const LEARNING_TRACK_LIFECYCLE_PREVIEW_DIGEST_VERSION =
  "learning-track-lifecycle-preview-digest/1.0.0" as const;

export interface LearningTrackLifecyclePreviewDigestFields {
  readonly workspaceId: string;
  readonly operation: "pause_track" | "resume_track";
  readonly reason: string;
  readonly expectedGrowthPlanVersion: string;
  readonly expectedLearningTrackVersion: string;
  readonly growthPlan: {
    readonly growthPlanId: string;
    readonly lifecycle: "ACTIVE" | "PAUSED";
    readonly weeklyCapacityMinutes: number;
    readonly aggregateVersion: string;
  };
  readonly before: LearningTrackLifecycleTrackState;
  readonly after: LearningTrackLifecycleTrackState;
  readonly constraint: LearningTrackLifecycleConstraint;
  readonly canApply: boolean;
  readonly blockingReason: LearningTrackLifecycleBlockingReason | undefined;
  readonly warning: "PARENT_GROWTH_PLAN_PAUSED" | undefined;
}

export interface LearningTrackLifecycleTrackState {
  readonly learningTrackId: string;
  readonly trackKey: string;
  readonly title: string;
  readonly lifecycle: "ACTIVE" | "PAUSED";
  readonly priority: number;
  readonly protectedMinimumMinutes: number;
  readonly aggregateVersion: string;
}

export interface LearningTrackLifecycleConstraint {
  readonly activeTrackCountBefore: number;
  readonly activeTrackCountAfter: number;
  readonly activeProtectedMinimumMinutesBefore: number;
  readonly activeProtectedMinimumMinutesAfter: number;
  readonly flexibleMinutesBefore: number;
  readonly flexibleMinutesAfter: number;
  readonly activeTrackFingerprintBefore: string;
  readonly activeTrackFingerprintAfter: string;
}

export type LearningTrackLifecycleBlockingReason = {
  readonly code: "ACTIVE_TRACK_MINIMUM_EXCEEDS_CAPACITY";
  readonly minimumCapacityMinutes: number;
};

/** D2b1 shares D2a's UUID-ordered active-track constraint fingerprint protocol. */
export function learningTrackLifecycleActiveFingerprintInput(
  tracks: readonly ActiveTrackConstraintFingerprintEntry[],
): string {
  return activeTrackConstraintFingerprintInput(tracks);
}

/** Canonical clock-free SHA-256 input. Field order and UTF-8 byte lengths are protocol material. */
export function learningTrackLifecyclePreviewDigestInput(
  value: LearningTrackLifecyclePreviewDigestFields,
): string {
  const blocking = value.blockingReason;
  return [
    growthPlanCapacityDigestField("digestVersion", LEARNING_TRACK_LIFECYCLE_PREVIEW_DIGEST_VERSION),
    growthPlanCapacityDigestField("contractVersion", "1.0.0"),
    growthPlanCapacityDigestField(
      "fingerprintVersion",
      ACTIVE_TRACK_CONSTRAINT_FINGERPRINT_VERSION,
    ),
    growthPlanCapacityDigestField("workspaceId", value.workspaceId.toLowerCase()),
    growthPlanCapacityDigestField("operation", value.operation),
    growthPlanCapacityDigestField("reason", value.reason),
    growthPlanCapacityDigestField("expectedGrowthPlanVersion", value.expectedGrowthPlanVersion),
    growthPlanCapacityDigestField(
      "expectedLearningTrackVersion",
      value.expectedLearningTrackVersion,
    ),
    growthPlanCapacityDigestField("growthPlanId", value.growthPlan.growthPlanId.toLowerCase()),
    growthPlanCapacityDigestField("growthPlanLifecycle", value.growthPlan.lifecycle),
    growthPlanCapacityDigestField(
      "growthPlanWeeklyCapacityMinutes",
      String(value.growthPlan.weeklyCapacityMinutes),
    ),
    growthPlanCapacityDigestField("growthPlanAggregateVersion", value.growthPlan.aggregateVersion),
    ...trackStateFields("before", value.before),
    ...trackStateFields("after", value.after),
    growthPlanCapacityDigestField(
      "activeTrackCountBefore",
      String(value.constraint.activeTrackCountBefore),
    ),
    growthPlanCapacityDigestField(
      "activeTrackCountAfter",
      String(value.constraint.activeTrackCountAfter),
    ),
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
      "activeTrackFingerprintBefore",
      value.constraint.activeTrackFingerprintBefore,
    ),
    growthPlanCapacityDigestField(
      "activeTrackFingerprintAfter",
      value.constraint.activeTrackFingerprintAfter,
    ),
    growthPlanCapacityDigestField("canApply", String(value.canApply)),
    growthPlanCapacityDigestField("blockingReasonCode", blocking?.code ?? ""),
    growthPlanCapacityDigestField(
      "blockingMinimumCapacityMinutes",
      blocking === undefined ? "" : String(blocking.minimumCapacityMinutes),
    ),
    growthPlanCapacityDigestField("warningCode", value.warning ?? ""),
    growthPlanCapacityDigestField("retainedLearningTrackActivities", "true"),
    growthPlanCapacityDigestField("retainedPlanSnapshots", "true"),
    growthPlanCapacityDigestField("retainedFocusSessions", "true"),
    growthPlanCapacityDigestField("retainedEvidence", "true"),
    growthPlanCapacityDigestField("projectionStateAfterApply", "PENDING"),
    growthPlanCapacityDigestField("consumerName", "planning.plan_snapshot_v1"),
  ].join("");
}

function trackStateFields(
  prefix: string,
  state: LearningTrackLifecycleTrackState,
): readonly string[] {
  return [
    growthPlanCapacityDigestField(`${prefix}LearningTrackId`, state.learningTrackId.toLowerCase()),
    growthPlanCapacityDigestField(`${prefix}TrackKey`, state.trackKey),
    growthPlanCapacityDigestField(`${prefix}Title`, state.title),
    growthPlanCapacityDigestField(`${prefix}Lifecycle`, state.lifecycle),
    growthPlanCapacityDigestField(`${prefix}Priority`, String(state.priority)),
    growthPlanCapacityDigestField(
      `${prefix}ProtectedMinimumMinutes`,
      String(state.protectedMinimumMinutes),
    ),
    growthPlanCapacityDigestField(`${prefix}AggregateVersion`, state.aggregateVersion),
  ];
}
