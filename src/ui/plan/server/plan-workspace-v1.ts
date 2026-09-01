import "server-only";

import { growthPlanCapacityControlSemanticViolations } from "../../../shared/contracts/growth-plan-capacity-control";
import { growthPlanControlSemanticViolations } from "../../../shared/contracts/growth-plan-control";
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
