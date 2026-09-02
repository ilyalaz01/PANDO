import {
  ACTIVE_TRACK_CONSTRAINT_FINGERPRINT_VERSION,
  activeTrackConstraintFingerprintInput,
  growthPlanCapacityDigestField,
  type ActiveTrackConstraintFingerprintEntry,
} from "./growth-plan-capacity-preview";
import {
  CURRENT_TRACK_ORDER_FINGERPRINT_VERSION,
  currentTrackOrderFingerprintInput,
  type CurrentTrackOrderFingerprintEntry,
} from "./learning-track-priority-minimum-preview";

export const LEARNING_TRACK_TERMINAL_LIFECYCLE_PREVIEW_DIGEST_VERSION =
  "learning-track-terminal-lifecycle-preview-digest/1.0.0" as const;
export const LEARNING_TRACK_TERMINAL_LIFECYCLE_COMMAND_TYPE =
  "planning.change_learning_track_terminal_lifecycle_v1" as const;

export type LearningTrackTerminalLifecycleOperationV1 = "complete_track" | "archive_track";
export type LearningTrackTerminalLifecycleV1 = "ACTIVE" | "PAUSED" | "COMPLETED" | "ARCHIVED";

export interface LearningTrackTerminalLifecycleTrackStateV1 {
  readonly learningTrackId: string;
  readonly trackKey: string;
  readonly title: string;
  readonly lifecycle: LearningTrackTerminalLifecycleV1;
  readonly priority: number;
  readonly protectedMinimumMinutes: number;
  readonly aggregateVersion: string;
}

export interface LearningTrackTerminalLifecyclePreviewDigestFieldsV1 {
  readonly workspaceId: string;
  readonly operation: LearningTrackTerminalLifecycleOperationV1;
  readonly reason: string;
  readonly expectedGrowthPlanVersion: string;
  readonly expectedLearningTrackVersion: string;
  readonly growthPlan: {
    readonly growthPlanId: string;
    readonly lifecycle: "ACTIVE" | "PAUSED";
    readonly weeklyCapacityMinutes: number;
    readonly aggregateVersion: string;
  };
  readonly before: LearningTrackTerminalLifecycleTrackStateV1;
  readonly after: LearningTrackTerminalLifecycleTrackStateV1;
  readonly currentPortfolio: {
    readonly countBefore: number;
    readonly countAfter: number;
    readonly orderFingerprintBefore: string;
    readonly orderFingerprintAfter: string;
  };
  readonly activeConstraint: {
    readonly activeTrackCountBefore: number;
    readonly activeTrackCountAfter: number;
    readonly activeProtectedMinimumMinutesBefore: number;
    readonly activeProtectedMinimumMinutesAfter: number;
    readonly flexibleMinutesBefore: number;
    readonly flexibleMinutesAfter: number;
    readonly activeTrackFingerprintBefore: string;
    readonly activeTrackFingerprintAfter: string;
  };
  readonly visibilityBefore: "CURRENT_PLAN" | "TERMINAL_HISTORY";
  readonly warning:
    "TRACK_COMPLETION_IS_TERMINAL_AND_NOT_MASTERY" | "TRACK_ARCHIVE_IS_TERMINAL_NOT_DELETION";
}

export function learningTrackTerminalActiveFingerprintInput(
  tracks: readonly ActiveTrackConstraintFingerprintEntry[],
): string {
  return activeTrackConstraintFingerprintInput(tracks);
}

export function learningTrackTerminalCurrentOrderFingerprintInput(
  tracks: readonly CurrentTrackOrderFingerprintEntry[],
): string {
  return currentTrackOrderFingerprintInput(tracks);
}

export function learningTrackTerminalLifecyclePreviewDigestInput(
  value: LearningTrackTerminalLifecyclePreviewDigestFieldsV1,
): string {
  return [
    growthPlanCapacityDigestField(
      "digestVersion",
      LEARNING_TRACK_TERMINAL_LIFECYCLE_PREVIEW_DIGEST_VERSION,
    ),
    growthPlanCapacityDigestField("contractVersion", "1.0.0"),
    growthPlanCapacityDigestField("commandType", LEARNING_TRACK_TERMINAL_LIFECYCLE_COMMAND_TYPE),
    growthPlanCapacityDigestField(
      "activeCapacityFingerprintVersion",
      ACTIVE_TRACK_CONSTRAINT_FINGERPRINT_VERSION,
    ),
    growthPlanCapacityDigestField(
      "currentOrderFingerprintVersion",
      CURRENT_TRACK_ORDER_FINGERPRINT_VERSION,
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
    ...trackFields("before", value.before),
    ...trackFields("after", value.after),
    growthPlanCapacityDigestField(
      "currentTrackCountBefore",
      String(value.currentPortfolio.countBefore),
    ),
    growthPlanCapacityDigestField(
      "currentTrackCountAfter",
      String(value.currentPortfolio.countAfter),
    ),
    growthPlanCapacityDigestField(
      "currentTrackOrderFingerprintBefore",
      value.currentPortfolio.orderFingerprintBefore,
    ),
    growthPlanCapacityDigestField(
      "currentTrackOrderFingerprintAfter",
      value.currentPortfolio.orderFingerprintAfter,
    ),
    ...activeConstraintFields(value.activeConstraint),
    growthPlanCapacityDigestField("visibilityBefore", value.visibilityBefore),
    growthPlanCapacityDigestField("visibilityAfter", "TERMINAL_HISTORY"),
    growthPlanCapacityDigestField("canApply", "true"),
    growthPlanCapacityDigestField("blockingReasonCount", "0"),
    growthPlanCapacityDigestField("warningCode", value.warning),
    growthPlanCapacityDigestField("retainedLearningTrackActivities", "true"),
    growthPlanCapacityDigestField("retainedFocusSessions", "true"),
    growthPlanCapacityDigestField("retainedEvidence", "true"),
    growthPlanCapacityDigestField("retainedMasteryAndReadiness", "true"),
    growthPlanCapacityDigestField("retainedReviewItems", "true"),
    growthPlanCapacityDigestField("retainedPlanSnapshots", "true"),
    growthPlanCapacityDigestField("retainedTrackHistory", "true"),
    growthPlanCapacityDigest("doesNotAssertEvidence"),
    growthPlanCapacityDigest("doesNotAssertMastery"),
    growthPlanCapacityDigest("doesNotAssertReadiness"),
    growthPlanCapacityDigest("doesNotAssertGoalCompletion"),
    growthPlanCapacityDigestField("projectionStateAfterApply", "PENDING"),
    growthPlanCapacityDigestField("eventChangeKind", "TRACK_TERMINAL_LIFECYCLE_CHANGED"),
    growthPlanCapacityDigestField("consumerName", "planning.plan_snapshot_v1"),
  ].join("");
}

function growthPlanCapacityDigest(name: string): string {
  return growthPlanCapacityDigestField(name, "true");
}

function trackFields(
  prefix: string,
  state: LearningTrackTerminalLifecycleTrackStateV1,
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

function activeConstraintFields(
  constraint: LearningTrackTerminalLifecyclePreviewDigestFieldsV1["activeConstraint"],
): readonly string[] {
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
  ];
}
