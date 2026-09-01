import {
  ACTIVE_TRACK_CONSTRAINT_FINGERPRINT_VERSION,
  activeTrackConstraintFingerprintInput,
  growthPlanCapacityDigestField,
  type ActiveTrackConstraintFingerprintEntry,
} from "./growth-plan-capacity-preview";

export const CURRENT_TRACK_ORDER_FINGERPRINT_VERSION =
  "current-track-order-fingerprint/1.0.0" as const;
export const LEARNING_TRACK_PRIORITY_MINIMUM_PREVIEW_DIGEST_VERSION =
  "learning-track-priority-minimum-preview-digest/1.0.0" as const;

export interface CurrentTrackOrderFingerprintEntry {
  readonly learningTrackId: string;
  readonly aggregateVersion: string;
  readonly lifecycle: "ACTIVE" | "PAUSED";
  readonly priority: number;
  readonly trackKey: string;
}

export interface LearningTrackPriorityMinimumTrackState {
  readonly learningTrackId: string;
  readonly trackKey: string;
  readonly title: string;
  readonly lifecycle: "ACTIVE" | "PAUSED";
  readonly priority: number;
  readonly protectedMinimumMinutes: number;
  readonly aggregateVersion: string;
}

export interface LearningTrackPriorityMinimumConstraint {
  readonly activeTrackCountBefore: number;
  readonly activeTrackCountAfter: number;
  readonly activeProtectedMinimumMinutesBefore: number;
  readonly activeProtectedMinimumMinutesAfter: number;
  readonly flexibleMinutesBefore: number;
  readonly flexibleMinutesAfter: number;
  readonly activeTrackFingerprintBefore: string;
  readonly activeTrackFingerprintAfter: string;
  readonly activeTrackCountIfTargetActiveAfter: number;
  readonly minimumCapacityIfTargetActiveAfter: number;
  readonly targetActiveStateFitsCapacity: boolean;
  readonly currentTrackPositionBefore: number;
  readonly currentTrackPositionAfter: number;
  readonly currentTrackOrderFingerprintBefore: string;
  readonly currentTrackOrderFingerprintAfter: string;
}

export type LearningTrackPriorityMinimumBlockingReason = {
  readonly code: "ACTIVE_TRACK_MINIMUM_EXCEEDS_CAPACITY";
  readonly minimumCapacityMinutes: number;
};

export type LearningTrackPriorityMinimumWarning =
  | { readonly code: "PARENT_GROWTH_PLAN_PAUSED" }
  | { readonly code: "LEARNING_TRACK_PAUSED" }
  | {
      readonly code: "PAUSED_TRACK_RESUME_WOULD_EXCEED_CAPACITY";
      readonly minimumCapacityMinutes: number;
    };

export interface LearningTrackPriorityMinimumPreviewDigestFields {
  readonly workspaceId: string;
  readonly reason: string;
  readonly expectedGrowthPlanVersion: string;
  readonly expectedLearningTrackVersion: string;
  readonly growthPlan: {
    readonly growthPlanId: string;
    readonly lifecycle: "ACTIVE" | "PAUSED";
    readonly weeklyCapacityMinutes: number;
    readonly aggregateVersion: string;
  };
  readonly before: LearningTrackPriorityMinimumTrackState;
  readonly after: LearningTrackPriorityMinimumTrackState;
  readonly constraint: LearningTrackPriorityMinimumConstraint;
  readonly canApply: boolean;
  readonly blockingReason: LearningTrackPriorityMinimumBlockingReason | undefined;
  readonly warnings: readonly LearningTrackPriorityMinimumWarning[];
}

/** D2b2 preserves D2a's UUID-ordered active-capacity freshness protocol. */
export function learningTrackPriorityMinimumActiveFingerprintInput(
  tracks: readonly ActiveTrackConstraintFingerprintEntry[],
): string {
  return activeTrackConstraintFingerprintInput(tracks);
}

/**
 * Canonical input for current Track order freshness. The sort exactly mirrors PostgreSQL
 * `priority DESC, track_key COLLATE "C", learning_track_id` for the schema's ASCII keys/UUIDs.
 */
export function currentTrackOrderFingerprintInput(
  tracks: readonly CurrentTrackOrderFingerprintEntry[],
): string {
  const ordered = [...tracks].sort((left, right) => {
    if (left.priority !== right.priority) return right.priority - left.priority;
    const keyOrder = asciiOrder(left.trackKey, right.trackKey);
    return keyOrder === 0
      ? asciiOrder(left.learningTrackId.toLowerCase(), right.learningTrackId.toLowerCase())
      : keyOrder;
  });
  return [
    growthPlanCapacityDigestField("fingerprintVersion", CURRENT_TRACK_ORDER_FINGERPRINT_VERSION),
    growthPlanCapacityDigestField("currentTrackCount", String(ordered.length)),
    ...ordered.flatMap((track) => [
      growthPlanCapacityDigestField("learningTrackId", track.learningTrackId.toLowerCase()),
      growthPlanCapacityDigestField("aggregateVersion", track.aggregateVersion),
      growthPlanCapacityDigestField("lifecycle", track.lifecycle),
      growthPlanCapacityDigestField("priority", String(track.priority)),
      growthPlanCapacityDigestField("trackKey", track.trackKey),
    ]),
  ].join("");
}

/** Canonical clock-free SHA-256 input. Field order and UTF-8 byte lengths are protocol material. */
export function learningTrackPriorityMinimumPreviewDigestInput(
  value: LearningTrackPriorityMinimumPreviewDigestFields,
): string {
  const blocking = value.blockingReason;
  return [
    growthPlanCapacityDigestField(
      "digestVersion",
      LEARNING_TRACK_PRIORITY_MINIMUM_PREVIEW_DIGEST_VERSION,
    ),
    growthPlanCapacityDigestField("contractVersion", "1.0.0"),
    growthPlanCapacityDigestField(
      "activeCapacityFingerprintVersion",
      ACTIVE_TRACK_CONSTRAINT_FINGERPRINT_VERSION,
    ),
    growthPlanCapacityDigestField(
      "currentOrderFingerprintVersion",
      CURRENT_TRACK_ORDER_FINGERPRINT_VERSION,
    ),
    growthPlanCapacityDigestField("workspaceId", value.workspaceId.toLowerCase()),
    growthPlanCapacityDigestField("operation", "set_track_priority_minimum"),
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
    ...constraintFields(value.constraint),
    growthPlanCapacityDigestField("canApply", String(value.canApply)),
    growthPlanCapacityDigestField("blockingReasonCode", blocking?.code ?? ""),
    growthPlanCapacityDigestField(
      "blockingMinimumCapacityMinutes",
      blocking === undefined ? "" : String(blocking.minimumCapacityMinutes),
    ),
    growthPlanCapacityDigestField("warningCount", String(value.warnings.length)),
    ...value.warnings.flatMap((warning) => [
      growthPlanCapacityDigestField("warningCode", warning.code),
      growthPlanCapacityDigestField(
        "warningMinimumCapacityMinutes",
        "minimumCapacityMinutes" in warning ? String(warning.minimumCapacityMinutes) : "",
      ),
    ]),
    growthPlanCapacityDigestField("retainedLearningTrackActivities", "true"),
    growthPlanCapacityDigestField("retainedPlanSnapshots", "true"),
    growthPlanCapacityDigestField("retainedFocusSessions", "true"),
    growthPlanCapacityDigestField("retainedEvidence", "true"),
    growthPlanCapacityDigestField("projectionStateAfterApply", "PENDING"),
    growthPlanCapacityDigestField("consumerName", "planning.plan_snapshot_v1"),
  ].join("");
}

function asciiOrder(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function trackStateFields(
  prefix: string,
  state: LearningTrackPriorityMinimumTrackState,
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

function constraintFields(constraint: LearningTrackPriorityMinimumConstraint): readonly string[] {
  return [
    growthPlanCapacityDigestField(
      "activeTrackCountBefore",
      String(constraint.activeTrackCountBefore),
    ),
    growthPlanCapacityDigestField(
      "activeTrackCountAfter",
      String(constraint.activeTrackCountAfter),
    ),
    growthPlanCapacityDigestField(
      "activeProtectedMinimumMinutesBefore",
      String(constraint.activeProtectedMinimumMinutesBefore),
    ),
    growthPlanCapacityDigestField(
      "activeProtectedMinimumMinutesAfter",
      String(constraint.activeProtectedMinimumMinutesAfter),
    ),
    growthPlanCapacityDigestField(
      "flexibleMinutesBefore",
      String(constraint.flexibleMinutesBefore),
    ),
    growthPlanCapacityDigestField("flexibleMinutesAfter", String(constraint.flexibleMinutesAfter)),
    growthPlanCapacityDigestField(
      "activeTrackFingerprintBefore",
      constraint.activeTrackFingerprintBefore,
    ),
    growthPlanCapacityDigestField(
      "activeTrackFingerprintAfter",
      constraint.activeTrackFingerprintAfter,
    ),
    growthPlanCapacityDigestField(
      "activeTrackCountIfTargetActiveAfter",
      String(constraint.activeTrackCountIfTargetActiveAfter),
    ),
    growthPlanCapacityDigestField(
      "minimumCapacityIfTargetActiveAfter",
      String(constraint.minimumCapacityIfTargetActiveAfter),
    ),
    growthPlanCapacityDigestField(
      "targetActiveStateFitsCapacity",
      String(constraint.targetActiveStateFitsCapacity),
    ),
    growthPlanCapacityDigestField(
      "currentTrackPositionBefore",
      String(constraint.currentTrackPositionBefore),
    ),
    growthPlanCapacityDigestField(
      "currentTrackPositionAfter",
      String(constraint.currentTrackPositionAfter),
    ),
    growthPlanCapacityDigestField(
      "currentTrackOrderFingerprintBefore",
      constraint.currentTrackOrderFingerprintBefore,
    ),
    growthPlanCapacityDigestField(
      "currentTrackOrderFingerprintAfter",
      constraint.currentTrackOrderFingerprintAfter,
    ),
  ];
}
