import "server-only";

import { growthPlanCapacityControlSemanticViolations } from "../../../shared/contracts/growth-plan-capacity-control";
import { growthPlanControlSemanticViolations } from "../../../shared/contracts/growth-plan-control";
import {
  decodeGrowthPlanInitializationApplyResultV1 as decodeGrowthPlanInitializationApplyResult,
  decodeGrowthPlanInitializationPreviewV1 as decodeGrowthPlanInitializationPreview,
  decodeGrowthPlanSetupSourceV1 as decodeGrowthPlanSetupSource,
  type GrowthPlanInitializationApplyResultV1,
  type GrowthPlanInitializationPreviewV1,
  type GrowthPlanSetupSourceV1,
} from "../../../shared/contracts/growth-plan-initialization-control";
import {
  decodeLearningTrackCreationApplyResultV1 as decodeLearningTrackCreationApplyResult,
  decodeLearningTrackCreationPreviewV1 as decodeLearningTrackCreationPreview,
  decodeLearningTrackCreationSourceV1 as decodeLearningTrackCreationSource,
  type LearningTrackCreationApplyResultV1,
  type LearningTrackCreationPreviewV1,
  type LearningTrackCreationSourceV1,
} from "../../../shared/contracts/learning-track-creation-control";
import { learningTrackLifecycleControlSemanticViolations } from "../../../shared/contracts/learning-track-lifecycle-control";
import {
  learningTrackTerminalLifecycleControlSemanticViolations,
  type LearningTrackTerminalLifecycleApplyResultV1,
  type LearningTrackTerminalLifecycleOperationV1,
  type LearningTrackTerminalLifecyclePreviewV1,
  type LearningTrackTerminalLifecycleSourceV1,
} from "../../../shared/contracts/learning-track-terminal-lifecycle-control";
import {
  decodeLearningTrackActivityAdmissionApplyResultV1 as decodeLearningTrackActivityAdmissionApplyResult,
  decodeLearningTrackActivityAdmissionApplyResultV2 as decodeLearningTrackActivityAdmissionApplyResultV2Contract,
  decodeLearningTrackActivityAdmissionPreviewV1 as decodeLearningTrackActivityAdmissionPreview,
  decodeLearningTrackActivityAdmissionPreviewV2 as decodeLearningTrackActivityAdmissionPreviewV2Contract,
  decodeLearningTrackActivityAdmissionSourceV1 as decodeLearningTrackActivityAdmissionSource,
  decodeLearningTrackActivityAdmissionSourceV2 as decodeLearningTrackActivityAdmissionSourceV2Contract,
  type LearningTrackActivityAdmissionApplyResultV1,
  type LearningTrackActivityAdmissionApplyResultV2,
  type LearningTrackActivityAdmissionPreviewV1,
  type LearningTrackActivityAdmissionPreviewV2,
  type LearningTrackActivityAdmissionSourceV1,
  type LearningTrackActivityAdmissionSourceV2,
} from "../../../shared/contracts/learning-track-activity-admission-control";
import { learningTrackPriorityMinimumControlSemanticViolations } from "../../../shared/contracts/learning-track-priority-minimum-control";
import {
  learningTrackCadenceControlSemanticViolations,
  type LearningTrackCadenceApplyResultV1,
  type LearningTrackCadencePreviewV1,
  type LearningTrackCadenceSourceV1,
} from "../../../shared/contracts/learning-track-cadence-control";
import { validateSchema } from "../../../shared/contracts/schema-registry";

export type {
  GrowthPlanInitializationApplyResultV1,
  GrowthPlanInitializationPreviewV1,
  GrowthPlanSetupSourceV1,
  LearningTrackCreationApplyResultV1,
  LearningTrackCreationPreviewV1,
  LearningTrackCreationSourceV1,
  LearningTrackActivityAdmissionApplyResultV1,
  LearningTrackActivityAdmissionApplyResultV2,
  LearningTrackActivityAdmissionPreviewV1,
  LearningTrackActivityAdmissionPreviewV2,
  LearningTrackActivityAdmissionSourceV1,
  LearningTrackActivityAdmissionSourceV2,
  LearningTrackTerminalLifecycleApplyResultV1,
  LearningTrackTerminalLifecycleOperationV1,
  LearningTrackTerminalLifecyclePreviewV1,
  LearningTrackTerminalLifecycleSourceV1,
  LearningTrackCadenceApplyResultV1,
  LearningTrackCadencePreviewV1,
  LearningTrackCadenceSourceV1,
};

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

export interface LearningTrackPriorityMinimumPreviewV1 {
  readonly contract: {
    readonly name: "LearningTrackPriorityMinimumPreviewV1";
    readonly version: "1.0.0";
  };
  readonly operation: "set_track_priority_minimum";
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

export interface LearningTrackPriorityMinimumApplyResultV1 {
  readonly contract: {
    readonly name: "LearningTrackPriorityMinimumApplyResultV1";
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

function decodeTerminalTrack(value: unknown, expectedName: string): unknown {
  const structural = validateSchema("learning-track-terminal-lifecycle-control-v1", value);
  if (
    !structural.valid ||
    learningTrackTerminalLifecycleControlSemanticViolations(value).length > 0
  ) {
    throw new GrowthPlanControlContractError();
  }
  const contract = (value as { readonly contract?: unknown }).contract;
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

function decodeTrackPriorityMinimum(value: unknown, expectedName: string): unknown {
  const structural = validateSchema("learning-track-priority-minimum-control-v1", value);
  if (
    !structural.valid ||
    learningTrackPriorityMinimumControlSemanticViolations(value).length > 0
  ) {
    throw new GrowthPlanControlContractError();
  }
  const contract = (value as { readonly contract?: unknown }).contract;
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

function decodeTrackCadence(value: unknown, expectedName: string): unknown {
  const structural = validateSchema("learning-track-cadence-control-v1", value);
  if (!structural.valid || learningTrackCadenceControlSemanticViolations(value).length > 0) {
    throw new GrowthPlanControlContractError();
  }
  const contract = (value as { readonly contract?: unknown }).contract;
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

/** Decodes the current Track portfolio and one bounded terminal-history page. */
export function decodeLearningTrackTerminalLifecycleSourceV1(
  value: unknown,
): LearningTrackTerminalLifecycleSourceV1 {
  return decodeTerminalTrack(
    value,
    "LearningTrackTerminalLifecycleSourceV1",
  ) as LearningTrackTerminalLifecycleSourceV1;
}

/** Decodes the exact irreversible Track lifecycle consequence preview. */
export function decodeLearningTrackTerminalLifecyclePreviewV1(
  value: unknown,
): LearningTrackTerminalLifecyclePreviewV1 {
  return decodeTerminalTrack(
    value,
    "LearningTrackTerminalLifecyclePreviewV1",
  ) as LearningTrackTerminalLifecyclePreviewV1;
}

/** Decodes the atomic terminal Track lifecycle receipt response. */
export function decodeLearningTrackTerminalLifecycleApplyResultV1(
  value: unknown,
): LearningTrackTerminalLifecycleApplyResultV1 {
  return decodeTerminalTrack(
    value,
    "LearningTrackTerminalLifecycleApplyResultV1",
  ) as LearningTrackTerminalLifecycleApplyResultV1;
}

/** Decodes the exact Track settings and ordering consequence preview. */
export function decodeLearningTrackPriorityMinimumPreviewV1(
  value: unknown,
): LearningTrackPriorityMinimumPreviewV1 {
  return decodeTrackPriorityMinimum(
    value,
    "LearningTrackPriorityMinimumPreviewV1",
  ) as LearningTrackPriorityMinimumPreviewV1;
}

/** Decodes the atomic Track priority/minimum receipt response. */
export function decodeLearningTrackPriorityMinimumApplyResultV1(
  value: unknown,
): LearningTrackPriorityMinimumApplyResultV1 {
  return decodeTrackPriorityMinimum(
    value,
    "LearningTrackPriorityMinimumApplyResultV1",
  ) as LearningTrackPriorityMinimumApplyResultV1;
}

/** Decodes the bounded cadence source without exposing Planning's normalized input. */
export function decodeLearningTrackCadenceSourceV1(value: unknown): LearningTrackCadenceSourceV1 {
  return decodeTrackCadence(value, "LearningTrackCadenceSourceV1") as LearningTrackCadenceSourceV1;
}

/** Decodes the exact cadence and compatible current-week progress preview. */
export function decodeLearningTrackCadencePreviewV1(value: unknown): LearningTrackCadencePreviewV1 {
  return decodeTrackCadence(
    value,
    "LearningTrackCadencePreviewV1",
  ) as LearningTrackCadencePreviewV1;
}

/** Decodes the atomic cadence command response. */
export function decodeLearningTrackCadenceApplyResultV1(
  value: unknown,
): LearningTrackCadenceApplyResultV1 {
  return decodeTrackCadence(
    value,
    "LearningTrackCadenceApplyResultV1",
  ) as LearningTrackCadenceApplyResultV1;
}

/** Decodes the bounded current-personal first-Plan setup selector. */
export function decodeGrowthPlanSetupSourceV1(value: unknown): GrowthPlanSetupSourceV1 {
  return decodeGrowthPlanSetupSource(value);
}

/** Decodes an exact first-Plan creation preview. */
export function decodeGrowthPlanInitializationPreviewV1(
  value: unknown,
): GrowthPlanInitializationPreviewV1 {
  return decodeGrowthPlanInitializationPreview(value);
}

/** Decodes the atomic first-Plan creation receipt. */
export function decodeGrowthPlanInitializationApplyResultV1(
  value: unknown,
): GrowthPlanInitializationApplyResultV1 {
  return decodeGrowthPlanInitializationApplyResult(value);
}

/** Decodes the bounded current-personal additional-Track creation source. */
export function decodeLearningTrackCreationSourceV1(value: unknown): LearningTrackCreationSourceV1 {
  return decodeLearningTrackCreationSource(value);
}

/** Decodes an exact additional-Track creation preview. */
export function decodeLearningTrackCreationPreviewV1(
  value: unknown,
): LearningTrackCreationPreviewV1 {
  return decodeLearningTrackCreationPreview(value);
}

/** Decodes the atomic additional-Track creation receipt. */
export function decodeLearningTrackCreationApplyResultV1(
  value: unknown,
): LearningTrackCreationApplyResultV1 {
  return decodeLearningTrackCreationApplyResult(value);
}

/** Decodes the bounded personal-activity selector composed by Planning. */
export function decodeLearningTrackActivityAdmissionSourceV1(
  value: unknown,
): LearningTrackActivityAdmissionSourceV1 {
  return decodeLearningTrackActivityAdmissionSource(value);
}

/** Decodes the bounded personal-activity selector for one chosen current Track. */
export function decodeLearningTrackActivityAdmissionSourceV2(
  value: unknown,
): LearningTrackActivityAdmissionSourceV2 {
  return decodeLearningTrackActivityAdmissionSourceV2Contract(value);
}

/** Decodes an exact, side-effect-free manual activity admission preview. */
export function decodeLearningTrackActivityAdmissionPreviewV1(
  value: unknown,
): LearningTrackActivityAdmissionPreviewV1 {
  return decodeLearningTrackActivityAdmissionPreview(value);
}

/** Decodes an exact, side-effect-free destination-aware activity admission preview. */
export function decodeLearningTrackActivityAdmissionPreviewV2(
  value: unknown,
): LearningTrackActivityAdmissionPreviewV2 {
  return decodeLearningTrackActivityAdmissionPreviewV2Contract(value);
}

/** Decodes the atomic manual activity admission receipt. */
export function decodeLearningTrackActivityAdmissionApplyResultV1(
  value: unknown,
): LearningTrackActivityAdmissionApplyResultV1 {
  return decodeLearningTrackActivityAdmissionApplyResult(value);
}

/** Decodes the atomic destination-aware activity admission receipt. */
export function decodeLearningTrackActivityAdmissionApplyResultV2(
  value: unknown,
): LearningTrackActivityAdmissionApplyResultV2 {
  return decodeLearningTrackActivityAdmissionApplyResultV2Contract(value);
}
