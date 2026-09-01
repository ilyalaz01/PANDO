export const GROWTH_PLAN_LIFECYCLE_PREVIEW_DIGEST_VERSION =
  "growth-plan-lifecycle-preview-digest/1.0.0" as const;

export type GrowthPlanLifecycleOperation = "pause_growth_plan" | "resume_growth_plan";
export type GrowthPlanLifecycle = "ACTIVE" | "PAUSED";

export interface GrowthPlanLifecycleDigestFields {
  readonly workspaceId: string;
  readonly operation: GrowthPlanLifecycleOperation;
  readonly reason: string;
  readonly growthPlanId: string;
  readonly beforeAggregateVersion: string;
  readonly afterAggregateVersion: string;
  readonly beforeLifecycle: GrowthPlanLifecycle;
  readonly afterLifecycle: GrowthPlanLifecycle;
  readonly title: string;
  readonly weeklyCapacityMinutes: number;
}

const encoder = new TextEncoder();

function field(name: string, value: string): string {
  return `${name}:${encoder.encode(value).byteLength}:${value}\n`;
}

/**
 * Canonical, clock-free input hashed by both PostgreSQL and TypeScript for a D1 owner preview.
 * Field order and UTF-8 byte lengths are part of the versioned digest protocol.
 */
export function growthPlanLifecyclePreviewDigestInput(
  value: GrowthPlanLifecycleDigestFields,
): string {
  return [
    field("digestVersion", GROWTH_PLAN_LIFECYCLE_PREVIEW_DIGEST_VERSION),
    field("contractVersion", "1.0.0"),
    field("workspaceId", value.workspaceId.toLowerCase()),
    field("operation", value.operation),
    field("reason", value.reason),
    field("growthPlanId", value.growthPlanId.toLowerCase()),
    field("beforeAggregateVersion", value.beforeAggregateVersion),
    field("afterAggregateVersion", value.afterAggregateVersion),
    field("beforeLifecycle", value.beforeLifecycle),
    field("afterLifecycle", value.afterLifecycle),
    field("title", value.title),
    field("weeklyCapacityMinutes", String(value.weeklyCapacityMinutes)),
    field("projectionStateAfterApply", "PENDING"),
    field("consumerName", "planning.plan_snapshot_v1"),
  ].join("");
}
