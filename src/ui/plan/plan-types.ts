import type {
  GrowthPlanInitializationApplyResultV1,
  GrowthPlanInitializationPreviewV1,
  GrowthPlanSetupSourceV1,
} from "../../shared/contracts/growth-plan-initialization-control";
import type {
  LearningTrackCreationApplyResultV1,
  LearningTrackCreationPreviewV1,
  LearningTrackCreationSourceV1,
} from "../../shared/contracts/learning-track-creation-control";
import type {
  LearningTrackActivityAdmissionApplyResultV1,
  LearningTrackActivityAdmissionPreviewV1,
  LearningTrackActivityAdmissionSourceV1,
} from "../../shared/contracts/learning-track-activity-admission-control";

export type Lifecycle = "ACTIVE" | "PAUSED";
export type PlanOperation = "pause_growth_plan" | "resume_growth_plan";
export type CapacityOperation = "set_default_capacity";
export type TrackOperation = "pause_track" | "resume_track";
export type TrackPriorityMinimumOperation = "set_track_priority_minimum";

export interface PlanStateV1 {
  readonly growthPlanId: string;
  readonly title: string;
  readonly lifecycle: Lifecycle;
  readonly weeklyCapacityMinutes: number;
  readonly aggregateVersion: string;
}

export interface TrackParentPlanStateV1 {
  readonly growthPlanId: string;
  readonly lifecycle: Lifecycle;
  readonly weeklyCapacityMinutes: number;
  readonly aggregateVersion: string;
}

export interface LearningTrackStateV1 {
  readonly learningTrackId: string;
  readonly trackKey: string;
  readonly title: string;
  readonly lifecycle: Lifecycle;
  readonly priority: number;
  readonly protectedMinimumMinutes: number;
  readonly aggregateVersion: string;
}

export interface CurrentLearningTrackV1 extends LearningTrackStateV1 {
  readonly capabilities: readonly TrackOperation[];
}

export interface CurrentLearningTracksV1 {
  readonly contract: { readonly name: "CurrentLearningTracksV1"; readonly version: "1.0.0" };
  readonly growthPlan: TrackParentPlanStateV1 | null;
  readonly learningTracks: readonly CurrentLearningTrackV1[];
}

export interface GrowthPlanLifecyclePreviewV1 {
  readonly contract: { readonly name: "GrowthPlanLifecyclePreviewV1"; readonly version: "1.0.0" };
  readonly operation: PlanOperation;
  readonly reason: string;
  readonly expectedGrowthPlanVersion: string;
  readonly before: PlanStateV1;
  readonly after: PlanStateV1;
  readonly retained: {
    readonly learningTracks: true;
    readonly planSnapshots: true;
    readonly focusSessions: true;
    readonly evidence: true;
  };
  readonly recalculationAfterApply: {
    readonly projectionState: "PENDING";
    readonly consumerName: "planning.plan_snapshot_v1";
  };
  readonly previewDigest: string;
}

export interface GrowthPlanCapacityPreviewV1 {
  readonly contract: { readonly name: "GrowthPlanCapacityPreviewV1"; readonly version: "1.0.0" };
  readonly operation: CapacityOperation;
  readonly reason: string;
  readonly expectedGrowthPlanVersion: string;
  readonly before: PlanStateV1;
  readonly after: PlanStateV1;
  readonly constraint: {
    readonly activeTrackCount: number;
    readonly activeProtectedMinimumMinutes: number;
    readonly flexibleMinutesBefore: number;
    readonly flexibleMinutesAfter: number;
    readonly activeTrackFingerprint: string;
  };
  readonly canApply: boolean;
  readonly blockingReasons: readonly {
    readonly code: "ACTIVE_TRACK_MINIMUM_EXCEEDS_CAPACITY";
    readonly minimumCapacityMinutes: number;
  }[];
  readonly retained: {
    readonly learningTracks: true;
    readonly planSnapshots: true;
    readonly focusSessions: true;
    readonly evidence: true;
  };
  readonly recalculationAfterApply: {
    readonly projectionState: "PENDING";
    readonly consumerName: "planning.plan_snapshot_v1";
  };
  readonly previewDigest: string;
}

export interface LearningTrackLifecyclePreviewV1 {
  readonly contract: {
    readonly name: "LearningTrackLifecyclePreviewV1";
    readonly version: "1.0.0";
  };
  readonly operation: TrackOperation;
  readonly reason: string;
  readonly expectedGrowthPlanVersion: string;
  readonly expectedLearningTrackVersion: string;
  readonly growthPlan: TrackParentPlanStateV1;
  readonly before: LearningTrackStateV1;
  readonly after: LearningTrackStateV1;
  readonly constraint: {
    readonly activeTrackCountBefore: number;
    readonly activeTrackCountAfter: number;
    readonly activeProtectedMinimumMinutesBefore: number;
    readonly activeProtectedMinimumMinutesAfter: number;
    readonly flexibleMinutesBefore: number;
    readonly flexibleMinutesAfter: number;
    readonly activeTrackFingerprintBefore: string;
    readonly activeTrackFingerprintAfter: string;
  };
  readonly canApply: boolean;
  readonly blockingReasons: readonly {
    readonly code: "ACTIVE_TRACK_MINIMUM_EXCEEDS_CAPACITY";
    readonly minimumCapacityMinutes: number;
  }[];
  readonly warnings: readonly { readonly code: "PARENT_GROWTH_PLAN_PAUSED" }[];
  readonly retained: {
    readonly learningTrackActivities: true;
    readonly planSnapshots: true;
    readonly focusSessions: true;
    readonly evidence: true;
  };
  readonly recalculationAfterApply: {
    readonly projectionState: "PENDING";
    readonly consumerName: "planning.plan_snapshot_v1";
  };
  readonly previewDigest: string;
}

export interface LearningTrackPriorityMinimumPreviewV1 {
  readonly contract: {
    readonly name: "LearningTrackPriorityMinimumPreviewV1";
    readonly version: "1.0.0";
  };
  readonly operation: TrackPriorityMinimumOperation;
  readonly reason: string;
  readonly expectedGrowthPlanVersion: string;
  readonly expectedLearningTrackVersion: string;
  readonly growthPlan: TrackParentPlanStateV1;
  readonly before: LearningTrackStateV1;
  readonly after: LearningTrackStateV1;
  readonly constraint: {
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
  };
  readonly canApply: boolean;
  readonly blockingReasons: readonly {
    readonly code: "ACTIVE_TRACK_MINIMUM_EXCEEDS_CAPACITY";
    readonly minimumCapacityMinutes: number;
  }[];
  readonly warnings: readonly (
    | { readonly code: "PARENT_GROWTH_PLAN_PAUSED" }
    | { readonly code: "LEARNING_TRACK_PAUSED" }
    | {
        readonly code: "PAUSED_TRACK_RESUME_WOULD_EXCEED_CAPACITY";
        readonly minimumCapacityMinutes: number;
      }
  )[];
  readonly retained: {
    readonly learningTrackActivities: true;
    readonly planSnapshots: true;
    readonly focusSessions: true;
    readonly evidence: true;
  };
  readonly recalculationAfterApply: {
    readonly projectionState: "PENDING";
    readonly consumerName: "planning.plan_snapshot_v1";
  };
  readonly previewDigest: string;
}

export type PlanPreviewV1 =
  | GrowthPlanLifecyclePreviewV1
  | GrowthPlanCapacityPreviewV1
  | LearningTrackLifecyclePreviewV1
  | LearningTrackPriorityMinimumPreviewV1
  | GrowthPlanInitializationPreviewV1
  | LearningTrackCreationPreviewV1
  | LearningTrackActivityAdmissionPreviewV1;

export interface CurrentGrowthPlanV1 {
  readonly contract: { readonly name: "CurrentGrowthPlanV1"; readonly version: "1.0.0" };
  readonly currentPlan: PlanStateV1 | null;
  readonly recalculation: {
    readonly projectionState: "CURRENT" | "PENDING" | "ERROR" | "NOT_STARTED";
    readonly reason:
      "INPUTS_CHANGED" | "SNAPSHOT_EXPIRED" | "CALCULATION_FAILED" | "INITIALIZING" | null;
    readonly lastKnownSafe: boolean;
  };
  readonly capabilities: readonly PlanOperation[];
}
export type {
  GrowthPlanInitializationApplyResultV1,
  GrowthPlanInitializationPreviewV1,
  GrowthPlanSetupSourceV1,
  LearningTrackCreationApplyResultV1,
  LearningTrackCreationPreviewV1,
  LearningTrackCreationSourceV1,
  LearningTrackActivityAdmissionApplyResultV1,
  LearningTrackActivityAdmissionPreviewV1,
  LearningTrackActivityAdmissionSourceV1,
};
