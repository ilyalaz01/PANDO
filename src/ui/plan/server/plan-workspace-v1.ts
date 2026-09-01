import "server-only";

import { growthPlanCapacityControlSemanticViolations } from "../../../shared/contracts/growth-plan-capacity-control";
import { growthPlanControlSemanticViolations } from "../../../shared/contracts/growth-plan-control";
import { learningTrackLifecycleControlSemanticViolations } from "../../../shared/contracts/learning-track-lifecycle-control";
import { validateSchema } from "../../../shared/contracts/schema-registry";

export type GrowthPlanLifecycleOperationV1 = "pause_growth_plan" | "resume_growth_plan";
export type GrowthPlanLifecycleV1 = "ACTIVE" | "PAUSED";
export type PlanRecalculationStateV1 = "CURRENT" | "PENDING" | "ERROR" | "NOT_STARTED";

export interface GrowthPlanStateV1 {
  readonly growthPlanId: string;
  readonly title: string;
  readonly lifecycle: GrowthPlanLifecycleV1;
  readonly weeklyCapacityMinutes: number;
  readonly aggregateVersion: string;
}

export interface CurrentGrowthPlanV1 {
  readonly contract: { readonly name: "CurrentGrowthPlanV1"; readonly version: "1.0.0" };
  readonly currentPlan: GrowthPlanStateV1 | null;
  readonly recalculation: {
    readonly projectionState: PlanRecalculationStateV1;
    readonly reason:
      "INITIALIZING" | "INPUTS_CHANGED" | "CALCULATION_FAILED" | "SNAPSHOT_EXPIRED" | null;
    readonly lastKnownSafe: boolean;
  };
  readonly capabilities: readonly GrowthPlanLifecycleOperationV1[];
}

export interface GrowthPlanLifecyclePreviewV1 {
  readonly contract: { readonly name: "GrowthPlanLifecyclePreviewV1"; readonly version: "1.0.0" };
  readonly operation: GrowthPlanLifecycleOperationV1;
  readonly reason: string;
  readonly expectedGrowthPlanVersion: string;
  readonly before: GrowthPlanStateV1;
  readonly after: GrowthPlanStateV1;
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

export interface GrowthPlanLifecycleApplyResultV1 {
  readonly contract: {
    readonly name: "GrowthPlanLifecycleApplyResultV1";
    readonly version: "1.0.0";
  };
  readonly commandId: string;
  readonly changedPlan: GrowthPlanStateV1;
  readonly projectionState: "PENDING";
  readonly planningDeliveryId: string;
  readonly emittedEventIds: readonly [string];
}

export interface GrowthPlanCapacityPreviewV1 {
  readonly contract: { readonly name: "GrowthPlanCapacityPreviewV1"; readonly version: "1.0.0" };
  readonly operation: "set_default_capacity";
  readonly reason: string;
  readonly expectedGrowthPlanVersion: string;
  readonly before: GrowthPlanStateV1;
  readonly after: GrowthPlanStateV1;
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

export interface GrowthPlanCapacityApplyResultV1 {
  readonly contract: {
    readonly name: "GrowthPlanCapacityApplyResultV1";
    readonly version: "1.0.0";
  };
  readonly commandId: string;
  readonly changedPlan: GrowthPlanStateV1;
  readonly projectionState: "PENDING";
  readonly planningDeliveryId: string;
  readonly emittedEventIds: readonly [string];
}

export type LearningTrackLifecycleOperationV1 = "pause_track" | "resume_track";

export interface LearningTrackParentPlanStateV1 {
  readonly growthPlanId: string;
  readonly lifecycle: GrowthPlanLifecycleV1;
  readonly weeklyCapacityMinutes: number;
  readonly aggregateVersion: string;
}

export interface LearningTrackStateV1 {
  readonly learningTrackId: string;
  readonly trackKey: string;
  readonly title: string;
  readonly lifecycle: GrowthPlanLifecycleV1;
  readonly priority: number;
  readonly protectedMinimumMinutes: number;
  readonly aggregateVersion: string;
}

export interface CurrentLearningTracksV1 {
  readonly contract: { readonly name: "CurrentLearningTracksV1"; readonly version: "1.0.0" };
  readonly growthPlan: LearningTrackParentPlanStateV1 | null;
  readonly learningTracks: readonly (LearningTrackStateV1 & {
    readonly capabilities: readonly [LearningTrackLifecycleOperationV1];
  })[];
}

export interface LearningTrackLifecyclePreviewV1 {
  readonly contract: {
    readonly name: "LearningTrackLifecyclePreviewV1";
    readonly version: "1.0.0";
  };
  readonly operation: LearningTrackLifecycleOperationV1;
  readonly reason: string;
  readonly expectedGrowthPlanVersion: string;
  readonly expectedLearningTrackVersion: string;
  readonly growthPlan: LearningTrackParentPlanStateV1;
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

export interface LearningTrackLifecycleApplyResultV1 {
  readonly contract: {
    readonly name: "LearningTrackLifecycleApplyResultV1";
    readonly version: "1.0.0";
  };
  readonly commandId: string;
  readonly changedTrack: LearningTrackStateV1;
  readonly projectionState: "PENDING";
  readonly planningDeliveryId: string;
  readonly emittedEventIds: readonly [string];
}

export class GrowthPlanControlContractError extends TypeError {
  constructor() {
    super("Growth Plan control response is invalid.");
    this.name = "GrowthPlanControlContractError";
  }
}

function decode(value: unknown, expectedName: string): unknown {
  const structural = validateSchema("growth-plan-control-v1", value);
  if (!structural.valid || growthPlanControlSemanticViolations(value).length > 0) {
    throw new GrowthPlanControlContractError();
  }
  const response = value as { readonly contract?: unknown };
  const contract = response.contract;
  if (
    typeof value !== "object" ||
    value === null ||
    !Object.hasOwn(value, "contract") ||
    typeof contract !== "object" ||
    contract === null ||
    !Object.hasOwn(contract, "name") ||
    (contract as { readonly name?: unknown }).name !== expectedName
  ) {
    throw new GrowthPlanControlContractError();
  }
  return value;
}

function decodeCapacity(value: unknown, expectedName: string): unknown {
  const structural = validateSchema("growth-plan-capacity-control-v1", value);
  if (!structural.valid || growthPlanCapacityControlSemanticViolations(value).length > 0) {
    throw new GrowthPlanControlContractError();
  }
  const response = value as { readonly contract?: unknown };
  const contract = response.contract;
  if (
    typeof contract !== "object" ||
    contract === null ||
    !Object.hasOwn(contract, "name") ||
    (contract as { readonly name?: unknown }).name !== expectedName
  ) {
    throw new GrowthPlanControlContractError();
  }
  return value;
}

function decodeTrack(value: unknown, expectedName: string): unknown {
  const structural = validateSchema("learning-track-lifecycle-control-v1", value);
  if (!structural.valid || learningTrackLifecycleControlSemanticViolations(value).length > 0) {
    throw new GrowthPlanControlContractError();
  }
  const response = value as { readonly contract?: unknown };
  const contract = response.contract;
  if (
    typeof contract !== "object" ||
    contract === null ||
    !Object.hasOwn(contract, "name") ||
    (contract as { readonly name?: unknown }).name !== expectedName
  ) {
    throw new GrowthPlanControlContractError();
  }
  return value;
}

/** Decodes the minimized, current-personal Planning read model before it reaches UI code. */
export function decodeCurrentGrowthPlanV1(value: unknown): CurrentGrowthPlanV1 {
  return decode(value, "CurrentGrowthPlanV1") as CurrentGrowthPlanV1;
}

/** Decodes a deterministic owner preview, not a final Today projection. */
export function decodeGrowthPlanLifecyclePreviewV1(value: unknown): GrowthPlanLifecyclePreviewV1 {
  return decode(value, "GrowthPlanLifecyclePreviewV1") as GrowthPlanLifecyclePreviewV1;
}

/** Decodes the atomic command receipt response with its pending Planning delivery. */
export function decodeGrowthPlanLifecycleApplyResultV1(
  value: unknown,
): GrowthPlanLifecycleApplyResultV1 {
  return decode(value, "GrowthPlanLifecycleApplyResultV1") as GrowthPlanLifecycleApplyResultV1;
}

/** Decodes the clock-free, constraint-aware weekly-capacity preview. */
export function decodeGrowthPlanCapacityPreviewV1(value: unknown): GrowthPlanCapacityPreviewV1 {
  return decodeCapacity(value, "GrowthPlanCapacityPreviewV1") as GrowthPlanCapacityPreviewV1;
}

/** Decodes the atomic weekly-capacity command response. */
export function decodeGrowthPlanCapacityApplyResultV1(
  value: unknown,
): GrowthPlanCapacityApplyResultV1 {
  return decodeCapacity(
    value,
    "GrowthPlanCapacityApplyResultV1",
  ) as GrowthPlanCapacityApplyResultV1;
}

/** Decodes the bounded, actor-scoped current Track selector. */
export function decodeCurrentLearningTracksV1(value: unknown): CurrentLearningTracksV1 {
  return decodeTrack(value, "CurrentLearningTracksV1") as CurrentLearningTracksV1;
}

/** Decodes the exact Track lifecycle and capacity consequence preview. */
export function decodeLearningTrackLifecyclePreviewV1(
  value: unknown,
): LearningTrackLifecyclePreviewV1 {
  return decodeTrack(value, "LearningTrackLifecyclePreviewV1") as LearningTrackLifecyclePreviewV1;
}

/** Decodes the atomic Track lifecycle receipt response. */
export function decodeLearningTrackLifecycleApplyResultV1(
  value: unknown,
): LearningTrackLifecycleApplyResultV1 {
  return decodeTrack(
    value,
    "LearningTrackLifecycleApplyResultV1",
  ) as LearningTrackLifecycleApplyResultV1;
}
