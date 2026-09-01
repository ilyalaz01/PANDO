export const ACTIVE_TRACK_CONSTRAINT_FINGERPRINT_VERSION =
  "active-track-constraint-fingerprint/1.0.0" as const;
export const GROWTH_PLAN_CAPACITY_PREVIEW_DIGEST_VERSION =
  "growth-plan-capacity-preview-digest/1.0.0" as const;

const encoder = new TextEncoder();

/** A length-prefixed field. UTF-8 byte lengths and ordering are protocol material. */
export function growthPlanCapacityDigestField(name: string, value: string): string {
  return `${name}:${encoder.encode(value).byteLength}:${value}\n`;
}

export interface ActiveTrackConstraintFingerprintEntry {
  readonly learningTrackId: string;
  readonly aggregateVersion: string;
  readonly lifecycle: "ACTIVE";
  readonly protectedMinimumMinutes: number;
}

/**
 * Canonical input for a freshness fingerprint of active Learning Track constraints.
 * The caller supplies active rows only; the function orders them by UUID so storage order cannot
 * alter the preview.
 */
export function activeTrackConstraintFingerprintInput(
  tracks: readonly ActiveTrackConstraintFingerprintEntry[],
): string {
  const ordered = [...tracks].sort((left, right) =>
    left.learningTrackId.toLowerCase().localeCompare(right.learningTrackId.toLowerCase()),
  );
  return [
    growthPlanCapacityDigestField(
      "fingerprintVersion",
      ACTIVE_TRACK_CONSTRAINT_FINGERPRINT_VERSION,
    ),
    growthPlanCapacityDigestField("activeTrackCount", String(ordered.length)),
    ...ordered.flatMap((track) => [
      growthPlanCapacityDigestField("learningTrackId", track.learningTrackId.toLowerCase()),
      growthPlanCapacityDigestField("aggregateVersion", track.aggregateVersion),
      growthPlanCapacityDigestField("lifecycle", track.lifecycle),
      growthPlanCapacityDigestField(
        "protectedMinimumMinutes",
        String(track.protectedMinimumMinutes),
      ),
    ]),
  ].join("");
}

export interface GrowthPlanCapacityPreviewDigestFields {
  readonly workspaceId: string;
  readonly reason: string;
  readonly growthPlanId: string;
  readonly beforeAggregateVersion: string;
  readonly afterAggregateVersion: string;
  readonly title: string;
  readonly beforeLifecycle: "ACTIVE" | "PAUSED";
  readonly afterLifecycle: "ACTIVE" | "PAUSED";
  readonly beforeWeeklyCapacityMinutes: number;
  readonly afterWeeklyCapacityMinutes: number;
  readonly activeTrackCount: number;
  readonly activeProtectedMinimumMinutes: number;
  readonly flexibleMinutesBefore: number;
  readonly flexibleMinutesAfter: number;
  readonly activeTrackFingerprint: string;
  readonly canApply: boolean;
  readonly blockingReason:
    | {
        readonly code: "ACTIVE_TRACK_MINIMUM_EXCEEDS_CAPACITY";
        readonly minimumCapacityMinutes: number;
      }
    | undefined;
}

/** Canonical, clock-free input hashed by PostgreSQL and TypeScript for a D2a owner preview. */
export function growthPlanCapacityPreviewDigestInput(
  value: GrowthPlanCapacityPreviewDigestFields,
): string {
  return [
    growthPlanCapacityDigestField("digestVersion", GROWTH_PLAN_CAPACITY_PREVIEW_DIGEST_VERSION),
    growthPlanCapacityDigestField("contractVersion", "1.0.0"),
    growthPlanCapacityDigestField("workspaceId", value.workspaceId.toLowerCase()),
    growthPlanCapacityDigestField("operation", "set_default_capacity"),
    growthPlanCapacityDigestField("reason", value.reason),
    growthPlanCapacityDigestField("growthPlanId", value.growthPlanId.toLowerCase()),
    growthPlanCapacityDigestField("beforeAggregateVersion", value.beforeAggregateVersion),
    growthPlanCapacityDigestField("afterAggregateVersion", value.afterAggregateVersion),
    growthPlanCapacityDigestField("beforeLifecycle", value.beforeLifecycle),
    growthPlanCapacityDigestField("afterLifecycle", value.afterLifecycle),
    growthPlanCapacityDigestField("title", value.title),
    growthPlanCapacityDigestField(
      "beforeWeeklyCapacityMinutes",
      String(value.beforeWeeklyCapacityMinutes),
    ),
    growthPlanCapacityDigestField(
      "afterWeeklyCapacityMinutes",
      String(value.afterWeeklyCapacityMinutes),
    ),
    growthPlanCapacityDigestField("activeTrackCount", String(value.activeTrackCount)),
    growthPlanCapacityDigestField(
      "activeProtectedMinimumMinutes",
      String(value.activeProtectedMinimumMinutes),
    ),
    growthPlanCapacityDigestField("flexibleMinutesBefore", String(value.flexibleMinutesBefore)),
    growthPlanCapacityDigestField("flexibleMinutesAfter", String(value.flexibleMinutesAfter)),
    growthPlanCapacityDigestField("activeTrackFingerprint", value.activeTrackFingerprint),
    growthPlanCapacityDigestField("canApply", String(value.canApply)),
    growthPlanCapacityDigestField("blockingReasonCode", value.blockingReason?.code ?? ""),
    growthPlanCapacityDigestField(
      "blockingMinimumCapacityMinutes",
      value.blockingReason === undefined ? "" : String(value.blockingReason.minimumCapacityMinutes),
    ),
    growthPlanCapacityDigestField("projectionStateAfterApply", "PENDING"),
    growthPlanCapacityDigestField("consumerName", "planning.plan_snapshot_v1"),
  ].join("");
}
