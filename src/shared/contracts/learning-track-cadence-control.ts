import { asJsonObject, asNumber, asString, type JsonObject } from "./json";

export type LearningTrackCadenceProgressStateV1 = "CURRENT" | "PENDING" | "UNAVAILABLE";

export interface LearningTrackCadencePlanV1 {
  readonly growthPlanId: string;
  readonly lifecycle: "ACTIVE" | "PAUSED";
  readonly weeklyCapacityMinutes: number;
  readonly aggregateVersion: string;
}

export interface LearningTrackCadenceStateV1 {
  readonly learningTrackId: string;
  readonly trackKey: string;
  readonly title: string;
  readonly lifecycle: "ACTIVE" | "PAUSED";
  readonly priority: number;
  readonly protectedMinimumMinutes: number;
  readonly cadencePerWeek: number;
  readonly aggregateVersion: string;
}

export interface LearningTrackCadenceProgressIdentityV1 {
  readonly state: LearningTrackCadenceProgressStateV1;
  readonly snapshotId: string | null;
  readonly appliedAttemptId: string | null;
  readonly inputFingerprint: string | null;
  readonly calculatedAsOf: string | null;
}

export interface LearningTrackCadenceSourceV1 {
  readonly contract: { readonly name: "LearningTrackCadenceSourceV1"; readonly version: "1.0.0" };
  readonly growthPlan: LearningTrackCadencePlanV1 | null;
  readonly progress: LearningTrackCadenceProgressIdentityV1;
  readonly learningTracks: readonly (LearningTrackCadenceStateV1 & {
    readonly completedCadenceSessionsThisWeek: number | null;
    readonly capabilities: readonly ["set_track_cadence"];
  })[];
}

export interface LearningTrackCadencePreviewV1 {
  readonly contract: {
    readonly name: "LearningTrackCadencePreviewV1";
    readonly version: "1.0.0";
  };
  readonly operation: "set_track_cadence";
  readonly reason: string;
  readonly expectedGrowthPlanVersion: string;
  readonly expectedLearningTrackVersion: string;
  readonly growthPlan: LearningTrackCadencePlanV1;
  readonly before: LearningTrackCadenceStateV1;
  readonly after: LearningTrackCadenceStateV1;
  readonly progress: LearningTrackCadenceProgressIdentityV1 & {
    readonly completedCadenceSessionsThisWeek: number | null;
    readonly beforeCadenceDeficit: number | null;
    readonly afterCadenceDeficit: number | null;
  };
  readonly canApply: true;
  readonly blockingReasons: readonly [];
  readonly warnings: readonly {
    readonly code:
      "PARENT_GROWTH_PLAN_PAUSED" | "LEARNING_TRACK_PAUSED" | "CADENCE_PROGRESS_PENDING";
  }[];
  readonly unchanged: {
    readonly priority: true;
    readonly protectedMinimumMinutes: true;
    readonly learningTrackActivities: true;
    readonly planSnapshots: true;
    readonly focusSessions: true;
    readonly evidence: true;
    readonly masteryAndReadiness: true;
    readonly review: true;
  };
  readonly recalculationAfterApply: {
    readonly projectionState: "PENDING";
    readonly consumerName: "planning.plan_snapshot_v1";
  };
  readonly previewDigest: string;
}

export interface LearningTrackCadenceApplyResultV1 {
  readonly contract: {
    readonly name: "LearningTrackCadenceApplyResultV1";
    readonly version: "1.0.0";
  };
  readonly commandId: string;
  readonly changedTrack: LearningTrackCadenceStateV1;
  readonly projectionState: "PENDING";
  readonly planningDeliveryId: string;
  readonly emittedEventIds: readonly [string];
}

export function learningTrackCadenceControlSemanticViolations(value: unknown): string[] {
  const root = asJsonObject(value, "Learning Track cadence control response");
  const contract = asJsonObject(root.contract, "Learning Track cadence contract");
  const name = asString(contract.name);
  if (name === "LearningTrackCadenceApplyResultV1") return [];
  if (name === "LearningTrackCadenceSourceV1") return sourceViolations(root);
  if (name === "LearningTrackCadencePreviewV1") return previewViolations(root);
  return ["LEARNING_TRACK_CADENCE_CONTROL_CONTRACT"];
}

function sourceViolations(root: JsonObject): string[] {
  const progress = asJsonObject(root.progress, "progress");
  const tracks = Array.isArray(root.learningTracks) ? root.learningTracks : [];
  const violations: string[] = [];
  if (root.growthPlan === null) {
    if (tracks.length !== 0 || progress.state !== "UNAVAILABLE") {
      violations.push("LEARNING_TRACK_CADENCE_SOURCE_EMPTY_PLAN");
    }
    return violations;
  }

  const current = progress.state === "CURRENT";
  const seenIds = new Set<string>();
  const seenKeys = new Set<string>();
  for (const item of tracks) {
    const track = asJsonObject(item, "learningTrack");
    const id = asString(track.learningTrackId);
    const key = asString(track.trackKey);
    if (id === undefined || key === undefined || seenIds.has(id) || seenKeys.has(key)) {
      violations.push("LEARNING_TRACK_CADENCE_SOURCE_UNIQUE_TRACK");
    } else {
      seenIds.add(id);
      seenKeys.add(key);
    }
    const completed = asNumber(track.completedCadenceSessionsThisWeek);
    if (
      (current && completed === undefined) ||
      (!current && track.completedCadenceSessionsThisWeek !== null)
    ) {
      violations.push("LEARNING_TRACK_CADENCE_SOURCE_PROGRESS");
    }
  }
  return [...new Set(violations)].sort();
}

function previewViolations(root: JsonObject): string[] {
  const before = asJsonObject(root.before, "before");
  const after = asJsonObject(root.after, "after");
  const plan = asJsonObject(root.growthPlan, "growthPlan");
  const progress = asJsonObject(root.progress, "progress");
  const warnings = Array.isArray(root.warnings) ? root.warnings : [];
  const violations: string[] = [];

  const reason = asString(root.reason);
  if (reason === undefined || /[\p{Cc}]/u.test(reason)) {
    violations.push("LEARNING_TRACK_CADENCE_PREVIEW_REASON");
  }
  if (root.expectedGrowthPlanVersion !== plan.aggregateVersion) {
    violations.push("LEARNING_TRACK_CADENCE_PREVIEW_EXPECTED_PLAN_VERSION");
  }
  if (root.expectedLearningTrackVersion !== before.aggregateVersion) {
    violations.push("LEARNING_TRACK_CADENCE_PREVIEW_EXPECTED_TRACK_VERSION");
  }
  for (const field of [
    "learningTrackId",
    "trackKey",
    "title",
    "lifecycle",
    "priority",
    "protectedMinimumMinutes",
  ] as const) {
    if (before[field] !== after[field]) {
      violations.push("LEARNING_TRACK_CADENCE_PREVIEW_UNCHANGED_FIELDS");
    }
  }
  if (before.cadencePerWeek === after.cadencePerWeek) {
    violations.push("LEARNING_TRACK_CADENCE_PREVIEW_NOOP");
  }
  try {
    if (BigInt(String(after.aggregateVersion)) !== BigInt(String(before.aggregateVersion)) + 1n) {
      violations.push("LEARNING_TRACK_CADENCE_PREVIEW_VERSION_ADVANCE");
    }
  } catch {
    violations.push("LEARNING_TRACK_CADENCE_PREVIEW_VERSION_ADVANCE");
  }

  const completed = asNumber(progress.completedCadenceSessionsThisWeek);
  if (progress.state === "CURRENT") {
    const beforeCadence = asNumber(before.cadencePerWeek);
    const afterCadence = asNumber(after.cadencePerWeek);
    if (
      completed === undefined ||
      beforeCadence === undefined ||
      afterCadence === undefined ||
      progress.beforeCadenceDeficit !== Math.max(beforeCadence - completed, 0) ||
      progress.afterCadenceDeficit !== Math.max(afterCadence - completed, 0)
    ) {
      violations.push("LEARNING_TRACK_CADENCE_PREVIEW_PROGRESS");
    }
  } else if (
    progress.completedCadenceSessionsThisWeek !== null ||
    progress.beforeCadenceDeficit !== null ||
    progress.afterCadenceDeficit !== null
  ) {
    violations.push("LEARNING_TRACK_CADENCE_PREVIEW_PROGRESS");
  }

  const expectedWarnings: string[] = [];
  if (plan.lifecycle === "PAUSED") expectedWarnings.push("PARENT_GROWTH_PLAN_PAUSED");
  if (before.lifecycle === "PAUSED") expectedWarnings.push("LEARNING_TRACK_PAUSED");
  if (progress.state !== "CURRENT") expectedWarnings.push("CADENCE_PROGRESS_PENDING");
  const actualWarnings = warnings.map((item) => asString(asJsonObject(item, "warning").code));
  if (
    actualWarnings.length !== expectedWarnings.length ||
    actualWarnings.some((item, index) => item !== expectedWarnings[index])
  ) {
    violations.push("LEARNING_TRACK_CADENCE_PREVIEW_WARNINGS");
  }
  if (
    root.canApply !== true ||
    !Array.isArray(root.blockingReasons) ||
    root.blockingReasons.length !== 0
  ) {
    violations.push("LEARNING_TRACK_CADENCE_PREVIEW_APPLICABILITY");
  }
  return [...new Set(violations)].sort();
}
