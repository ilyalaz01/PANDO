import { growthPlanCapacityDigestField } from "./growth-plan-capacity-preview";
import { PLANNING_CREATE_IDENTITY_VERSION } from "./growth-plan-initialization-preview";

export const AVAILABILITY_WINDOW_PREVIEW_DIGEST_VERSION =
  "availability-window-preview-digest/1.0.0" as const;
export const AVAILABILITY_WINDOW_REQUEST_HASH_VERSION =
  "availability-window-request-hash/1.0.0" as const;
export const AVAILABILITY_WINDOW_COMMAND_TYPE = "planning.change_availability_window_v1" as const;
export const AVAILABILITY_WINDOW_FINGERPRINT_VERSION =
  "availability-window-fingerprint/1.0.0" as const;

export type AvailabilityWindowOperation =
  "create_availability_window" | "change_availability_window" | "remove_availability_window";

export interface AvailabilityWindowIdentityFields {
  readonly workspaceId: string;
  readonly idempotencyKey: string;
}

/** Canonical, clock-free input used to derive a new availability-window UUID. */
export function availabilityWindowIdentityInput(value: AvailabilityWindowIdentityFields): string {
  return [
    growthPlanCapacityDigestField("identityVersion", PLANNING_CREATE_IDENTITY_VERSION),
    growthPlanCapacityDigestField("workspaceId", value.workspaceId.toLowerCase()),
    growthPlanCapacityDigestField("commandType", AVAILABILITY_WINDOW_COMMAND_TYPE),
    growthPlanCapacityDigestField("idempotencyKey", value.idempotencyKey.toLowerCase()),
    growthPlanCapacityDigestField("label", "availability-window"),
  ].join("");
}

export interface AvailabilityWindowFingerprintFields {
  readonly activeWindowCount: number;
  /** Every active window of the current Plan, in ascending window-key order. */
  readonly windows: readonly {
    readonly windowKey: string;
    readonly aggregateVersion: string;
    readonly startsOn: string;
    readonly endsOn: string;
    readonly availableMinutes: number;
  }[];
}

/** Canonical input hashed into the current Plan's active availability fingerprint. */
export function availabilityWindowFingerprintInput(
  value: AvailabilityWindowFingerprintFields,
): string {
  return [
    growthPlanCapacityDigestField("fingerprintVersion", AVAILABILITY_WINDOW_FINGERPRINT_VERSION),
    growthPlanCapacityDigestField("activeWindowCount", String(value.activeWindowCount)),
    ...value.windows.flatMap((window) => [
      growthPlanCapacityDigestField("windowKey", window.windowKey),
      growthPlanCapacityDigestField("aggregateVersion", window.aggregateVersion),
      growthPlanCapacityDigestField("startsOn", window.startsOn),
      growthPlanCapacityDigestField("endsOn", window.endsOn),
      growthPlanCapacityDigestField("availableMinutes", String(window.availableMinutes)),
    ]),
  ].join("");
}

export interface AvailabilityWindowStateFields {
  readonly windowKey: string;
  readonly availabilityWindowId: string;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly timeZone: string;
  readonly availableMinutes: number;
  readonly energy: "LOW" | "MEDIUM" | "HIGH" | null;
  readonly label: string | null;
  readonly lifecycle: "ACTIVE" | "REMOVED";
  readonly aggregateVersion: string;
}

export interface AvailabilityWindowPreviewDigestFields {
  readonly workspaceId: string;
  readonly operation: AvailabilityWindowOperation;
  readonly idempotencyKey: string;
  readonly reason: string;
  readonly expectedGrowthPlanVersion: string;
  readonly growthPlan: {
    readonly growthPlanId: string;
    readonly lifecycle: "ACTIVE" | "PAUSED";
    readonly weeklyCapacityMinutes: number;
    readonly aggregateVersion: string;
  };
  readonly before: {
    readonly activeWindowCount: number;
    readonly removedWindowCount: number;
    readonly activeWindowFingerprint: string;
    readonly window: AvailabilityWindowStateFields | null;
  };
  readonly after: {
    readonly activeWindowCount: number;
    readonly window: AvailabilityWindowStateFields;
  };
  readonly canApply: boolean;
  readonly blockingReasonCode: string | null;
  readonly warnings: readonly (
    "AVAILABILITY_NOT_YET_APPLIED_TO_CAPACITY" | "AVAILABILITY_WINDOW_IN_THE_PAST"
  )[];
}

function optional(value: string | number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

/** Canonical input hashed by PostgreSQL and TypeScript for the D3b availability preview. */
export function availabilityWindowPreviewDigestInput(
  value: AvailabilityWindowPreviewDigestFields,
): string {
  const plan = value.growthPlan;
  const before = value.before.window;
  const after = value.after.window;
  return [
    growthPlanCapacityDigestField("digestVersion", AVAILABILITY_WINDOW_PREVIEW_DIGEST_VERSION),
    growthPlanCapacityDigestField("contractVersion", "1.0.0"),
    growthPlanCapacityDigestField("identityVersion", PLANNING_CREATE_IDENTITY_VERSION),
    growthPlanCapacityDigestField("workspaceId", value.workspaceId.toLowerCase()),
    growthPlanCapacityDigestField("operation", value.operation),
    growthPlanCapacityDigestField("commandType", AVAILABILITY_WINDOW_COMMAND_TYPE),
    growthPlanCapacityDigestField("idempotencyKey", value.idempotencyKey.toLowerCase()),
    growthPlanCapacityDigestField("reason", value.reason),
    growthPlanCapacityDigestField("expectedGrowthPlanVersion", value.expectedGrowthPlanVersion),
    growthPlanCapacityDigestField("growthPlanId", plan.growthPlanId.toLowerCase()),
    growthPlanCapacityDigestField("growthPlanLifecycle", plan.lifecycle),
    growthPlanCapacityDigestField(
      "growthPlanWeeklyCapacityMinutes",
      String(plan.weeklyCapacityMinutes),
    ),
    growthPlanCapacityDigestField("growthPlanVersion", plan.aggregateVersion),
    growthPlanCapacityDigestField(
      "activeWindowCountBefore",
      String(value.before.activeWindowCount),
    ),
    growthPlanCapacityDigestField("activeWindowCountAfter", String(value.after.activeWindowCount)),
    growthPlanCapacityDigestField("removedWindowCount", String(value.before.removedWindowCount)),
    growthPlanCapacityDigestField("activeWindowFingerprint", value.before.activeWindowFingerprint),
    growthPlanCapacityDigestField("beforeWindowKey", optional(before?.windowKey)),
    growthPlanCapacityDigestField("beforeStartsOn", optional(before?.startsOn)),
    growthPlanCapacityDigestField("beforeEndsOn", optional(before?.endsOn)),
    growthPlanCapacityDigestField("beforeTimeZone", optional(before?.timeZone)),
    growthPlanCapacityDigestField("beforeAvailableMinutes", optional(before?.availableMinutes)),
    growthPlanCapacityDigestField("beforeEnergy", optional(before?.energy)),
    growthPlanCapacityDigestField("beforeLabel", optional(before?.label)),
    growthPlanCapacityDigestField("beforeLifecycle", optional(before?.lifecycle)),
    growthPlanCapacityDigestField("beforeVersion", optional(before?.aggregateVersion)),
    growthPlanCapacityDigestField("afterWindowKey", after.windowKey),
    growthPlanCapacityDigestField(
      "afterAvailabilityWindowId",
      after.availabilityWindowId.toLowerCase(),
    ),
    growthPlanCapacityDigestField("afterStartsOn", after.startsOn),
    growthPlanCapacityDigestField("afterEndsOn", after.endsOn),
    growthPlanCapacityDigestField("afterTimeZone", after.timeZone),
    growthPlanCapacityDigestField("afterAvailableMinutes", String(after.availableMinutes)),
    growthPlanCapacityDigestField("afterEnergy", optional(after.energy)),
    growthPlanCapacityDigestField("afterLabel", optional(after.label)),
    growthPlanCapacityDigestField("afterLifecycle", after.lifecycle),
    growthPlanCapacityDigestField("afterVersion", after.aggregateVersion),
    growthPlanCapacityDigestField("canApply", String(value.canApply)),
    growthPlanCapacityDigestField("blockingReasonCode", value.blockingReasonCode ?? ""),
    growthPlanCapacityDigestField("warningCount", String(value.warnings.length)),
    ...value.warnings.map((warning) => growthPlanCapacityDigestField("warningCode", warning)),
    growthPlanCapacityDigestField("retainedGrowthPlan", "true"),
    growthPlanCapacityDigestField("retainedLearningTracks", "true"),
    growthPlanCapacityDigestField("retainedActivitiesAndEvidence", "true"),
    growthPlanCapacityDigestField("retainedMastery", "true"),
    growthPlanCapacityDigestField("retainedReviews", "true"),
    growthPlanCapacityDigestField("retainedPlanSnapshots", "true"),
    growthPlanCapacityDigestField("projectionStateAfterApply", "PENDING"),
    growthPlanCapacityDigestField("eventChangeKind", "AVAILABILITY_CHANGED"),
    growthPlanCapacityDigestField("consumerName", "planning.plan_snapshot_v1"),
  ].join("");
}

export interface AvailabilityWindowRequestHashFields {
  readonly workspaceId: string;
  readonly operation: AvailabilityWindowOperation;
  readonly idempotencyKey: string;
  readonly windowKey: string | null;
  readonly startsOn: string | null;
  readonly endsOn: string | null;
  readonly availableMinutes: number | null;
  readonly energy: "LOW" | "MEDIUM" | "HIGH" | null;
  readonly label: string | null;
  readonly expectedGrowthPlanVersion: string;
  readonly expectedWindowVersion: string | null;
  readonly reason: string;
  readonly previewDigest: string;
}

/** Canonical request-hash input stored by the D3b availability command receipt. */
export function availabilityWindowRequestHashInput(
  value: AvailabilityWindowRequestHashFields,
): string {
  return [
    growthPlanCapacityDigestField("requestHashVersion", AVAILABILITY_WINDOW_REQUEST_HASH_VERSION),
    growthPlanCapacityDigestField("schemaVersion", "1.0.0"),
    growthPlanCapacityDigestField("workspaceId", value.workspaceId.toLowerCase()),
    growthPlanCapacityDigestField("commandType", AVAILABILITY_WINDOW_COMMAND_TYPE),
    growthPlanCapacityDigestField("operation", value.operation),
    growthPlanCapacityDigestField("idempotencyKey", value.idempotencyKey.toLowerCase()),
    growthPlanCapacityDigestField("windowKey", optional(value.windowKey)),
    growthPlanCapacityDigestField("startsOn", optional(value.startsOn)),
    growthPlanCapacityDigestField("endsOn", optional(value.endsOn)),
    growthPlanCapacityDigestField("availableMinutes", optional(value.availableMinutes)),
    growthPlanCapacityDigestField("energy", optional(value.energy)),
    growthPlanCapacityDigestField("label", optional(value.label)),
    growthPlanCapacityDigestField("expectedGrowthPlanVersion", value.expectedGrowthPlanVersion),
    growthPlanCapacityDigestField("expectedWindowVersion", optional(value.expectedWindowVersion)),
    growthPlanCapacityDigestField("reason", value.reason),
    growthPlanCapacityDigestField("previewDigest", value.previewDigest),
  ].join("");
}

/**
 * Effective weekly capacity under ADR-0010 section 6: availability caps, never grants. Each covered
 * local day contributes its window's minutes and every uncovered day contributes a full day.
 */
export function effectiveWeeklyCapacityMinutes(
  defaultWeeklyCapacityMinutes: number,
  dayCaps: readonly number[],
): number {
  if (dayCaps.length !== 7) {
    throw new RangeError("Effective weekly capacity requires exactly seven local day caps");
  }
  const total = dayCaps.reduce((sum, cap) => sum + cap, 0);
  return Math.min(defaultWeeklyCapacityMinutes, total);
}
