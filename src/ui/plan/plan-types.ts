export type Lifecycle = "ACTIVE" | "PAUSED";
export type PlanOperation = "pause_growth_plan" | "resume_growth_plan";

export interface PlanStateV1 {
  readonly growthPlanId: string;
  readonly title: string;
  readonly lifecycle: Lifecycle;
  readonly weeklyCapacityMinutes: number;
  readonly aggregateVersion: string;
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
