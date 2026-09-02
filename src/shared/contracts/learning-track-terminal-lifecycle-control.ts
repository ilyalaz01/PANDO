import { asJsonObject, asNumber, asString, type JsonObject, type JsonValue } from "./json";

const CURRENT_CAPABILITIES = ["complete_track", "archive_track"] as const;

export type LearningTrackTerminalLifecycleOperationV1 = "complete_track" | "archive_track";
export type LearningTrackTerminalLifecycleV1 = "ACTIVE" | "PAUSED" | "COMPLETED" | "ARCHIVED";

export interface LearningTrackTerminalLifecyclePlanV1 {
  readonly growthPlanId: string;
  readonly lifecycle: "ACTIVE" | "PAUSED";
  readonly weeklyCapacityMinutes: number;
  readonly aggregateVersion: string;
}

export interface LearningTrackTerminalLifecycleTrackV1 {
  readonly learningTrackId: string;
  readonly trackKey: string;
  readonly title: string;
  readonly lifecycle: LearningTrackTerminalLifecycleV1;
  readonly priority: number;
  readonly protectedMinimumMinutes: number;
  readonly aggregateVersion: string;
}

export interface LearningTrackTerminalLifecycleCurrentTrackV1 extends LearningTrackTerminalLifecycleTrackV1 {
  readonly lifecycle: "ACTIVE" | "PAUSED";
  readonly capabilities: readonly ["complete_track", "archive_track"];
}

export type LearningTrackTerminalLifecycleHistoryTrackV1 =
  | (LearningTrackTerminalLifecycleTrackV1 & {
      readonly lifecycle: "COMPLETED";
      readonly updatedAt: string;
      readonly capabilities: readonly ["archive_track"];
    })
  | (LearningTrackTerminalLifecycleTrackV1 & {
      readonly lifecycle: "ARCHIVED";
      readonly updatedAt: string;
      readonly capabilities: readonly [];
    });

export interface LearningTrackTerminalLifecycleSourceV1 {
  readonly contract: {
    readonly name: "LearningTrackTerminalLifecycleSourceV1";
    readonly version: "1.0.0";
  };
  readonly state: "READY" | "NO_CURRENT_PLAN";
  readonly growthPlan: LearningTrackTerminalLifecyclePlanV1 | null;
  readonly currentTracks: readonly LearningTrackTerminalLifecycleCurrentTrackV1[];
  readonly terminalHistory: readonly LearningTrackTerminalLifecycleHistoryTrackV1[];
  readonly historyPage: {
    readonly hasMore: boolean;
    readonly nextCursor: string | null;
  };
}

export interface LearningTrackTerminalLifecyclePreviewV1 {
  readonly contract: {
    readonly name: "LearningTrackTerminalLifecyclePreviewV1";
    readonly version: "1.0.0";
  };
  readonly operation: LearningTrackTerminalLifecycleOperationV1;
  readonly reason: string;
  readonly expectedGrowthPlanVersion: string;
  readonly expectedLearningTrackVersion: string;
  readonly growthPlan: LearningTrackTerminalLifecyclePlanV1;
  readonly before: LearningTrackTerminalLifecycleTrackV1;
  readonly after: LearningTrackTerminalLifecycleTrackV1;
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
  readonly visibilityAfter: "TERMINAL_HISTORY";
  readonly canApply: true;
  readonly blockingReasons: readonly [];
  readonly warnings: readonly [
    {
      readonly code:
        "TRACK_COMPLETION_IS_TERMINAL_AND_NOT_MASTERY" | "TRACK_ARCHIVE_IS_TERMINAL_NOT_DELETION";
    },
  ];
  readonly retained: {
    readonly learningTrackActivities: true;
    readonly focusSessions: true;
    readonly evidence: true;
    readonly masteryAndReadiness: true;
    readonly reviewItems: true;
    readonly planSnapshots: true;
    readonly trackHistory: true;
  };
  readonly doesNotAssert: {
    readonly evidence: true;
    readonly mastery: true;
    readonly readiness: true;
    readonly goalCompletion: true;
  };
  readonly recalculationAfterApply: {
    readonly projectionState: "PENDING";
    readonly consumerName: "planning.plan_snapshot_v1";
  };
  readonly previewDigest: string;
}

export interface LearningTrackTerminalLifecycleApplyResultV1 {
  readonly contract: {
    readonly name: "LearningTrackTerminalLifecycleApplyResultV1";
    readonly version: "1.0.0";
  };
  readonly commandId: string;
  readonly changedTrack: LearningTrackTerminalLifecycleTrackV1;
  readonly projectionState: "PENDING";
  readonly planningDeliveryId: string;
  readonly emittedEventIds: readonly [string];
}

export function learningTrackTerminalLifecycleControlSemanticViolations(value: unknown): string[] {
  const root = asJsonObject(value, "Learning Track terminal lifecycle control response");
  const contract = asJsonObject(root.contract, "Learning Track terminal lifecycle contract");
  const name = asString(contract.name);
  if (name === "LearningTrackTerminalLifecycleSourceV1") return sourceViolations(root);
  if (name === "LearningTrackTerminalLifecycleApplyResultV1") return applyViolations(root);
  if (name !== "LearningTrackTerminalLifecyclePreviewV1") {
    return ["LEARNING_TRACK_TERMINAL_LIFECYCLE_CONTROL_CONTRACT"];
  }
  return previewViolations(root);
}

function sourceViolations(root: JsonObject): string[] {
  const current = Array.isArray(root.currentTracks) ? root.currentTracks : [];
  const history = Array.isArray(root.terminalHistory) ? root.terminalHistory : [];
  const page = asJsonObject(root.historyPage, "terminal history page");
  const violations: string[] = [];
  if (root.state === "NO_CURRENT_PLAN") {
    if (
      root.growthPlan !== null ||
      current.length !== 0 ||
      history.length !== 0 ||
      page.hasMore !== false ||
      page.nextCursor !== null
    ) {
      violations.push("TERMINAL_LIFECYCLE_SOURCE_EMPTY_PLAN");
    }
    return violations;
  }
  if (root.growthPlan === null) violations.push("TERMINAL_LIFECYCLE_SOURCE_READY_PLAN");
  const seenIds = new Set<string>();
  const seenKeys = new Set<string>();
  validateTrackCollection(current, "current", seenIds, seenKeys, violations);
  validateTrackCollection(history, "history", seenIds, seenKeys, violations);
  if (page.hasMore !== (typeof page.nextCursor === "string")) {
    violations.push("TERMINAL_LIFECYCLE_SOURCE_CURSOR");
  }
  return violations.sort();
}

function validateTrackCollection(
  values: readonly JsonValue[],
  kind: "current" | "history",
  seenIds: Set<string>,
  seenKeys: Set<string>,
  violations: string[],
): void {
  let previousCurrent:
    { readonly priority: number; readonly trackKey: string; readonly id: string } | undefined;
  let previousHistory:
    { readonly updatedAt: string; readonly trackKey: string; readonly id: string } | undefined;
  for (const value of values) {
    const track = asJsonObject(value, "terminal lifecycle track");
    const idValue = asString(track.learningTrackId);
    const trackKey = asString(track.trackKey);
    const lifecycle = asString(track.lifecycle);
    const priority = asNumber(track.priority);
    const updatedAt = asString(track.updatedAt);
    if (idValue === undefined || trackKey === undefined || priority === undefined) {
      violations.push("TERMINAL_LIFECYCLE_SOURCE_ORDER");
      continue;
    }
    const id = idValue.toLowerCase();
    if (seenIds.has(id) || seenKeys.has(trackKey)) {
      violations.push("TERMINAL_LIFECYCLE_SOURCE_DUPLICATE");
    }
    seenIds.add(id);
    seenKeys.add(trackKey);
    const capabilities = Array.isArray(track.capabilities) ? track.capabilities : [];
    const expected =
      lifecycle === "ACTIVE" || lifecycle === "PAUSED"
        ? CURRENT_CAPABILITIES
        : lifecycle === "COMPLETED"
          ? (["archive_track"] as const)
          : ([] as const);
    if (
      capabilities.length !== expected.length ||
      capabilities.some((item, i) => item !== expected[i])
    ) {
      violations.push("TERMINAL_LIFECYCLE_SOURCE_CAPABILITY");
    }
    if (kind === "current") {
      if (updatedAt !== undefined) {
        violations.push("TERMINAL_LIFECYCLE_SOURCE_CURRENT_TIMESTAMP");
      }
      if (lifecycle !== "ACTIVE" && lifecycle !== "PAUSED") {
        violations.push("TERMINAL_LIFECYCLE_SOURCE_CURRENT_STATE");
      }
      if (
        previousCurrent !== undefined &&
        (priority > previousCurrent.priority ||
          (priority === previousCurrent.priority &&
            (trackKey < previousCurrent.trackKey ||
              (trackKey === previousCurrent.trackKey && id < previousCurrent.id))))
      ) {
        violations.push("TERMINAL_LIFECYCLE_SOURCE_CURRENT_ORDER");
      }
      previousCurrent = { priority, trackKey, id };
    } else {
      if (lifecycle !== "COMPLETED" && lifecycle !== "ARCHIVED") {
        violations.push("TERMINAL_LIFECYCLE_SOURCE_HISTORY_STATE");
      }
      if (updatedAt === undefined) {
        violations.push("TERMINAL_LIFECYCLE_SOURCE_HISTORY_ORDER");
      } else if (
        previousHistory !== undefined &&
        (updatedAt > previousHistory.updatedAt ||
          (updatedAt === previousHistory.updatedAt &&
            (trackKey < previousHistory.trackKey ||
              (trackKey === previousHistory.trackKey && id < previousHistory.id))))
      ) {
        violations.push("TERMINAL_LIFECYCLE_SOURCE_HISTORY_ORDER");
      }
      previousHistory = { updatedAt: updatedAt ?? "", trackKey, id };
    }
  }
}

function previewViolations(root: JsonObject): string[] {
  const before = asJsonObject(root.before, "before");
  const after = asJsonObject(root.after, "after");
  const plan = asJsonObject(root.growthPlan, "growthPlan");
  const portfolio = asJsonObject(root.currentPortfolio, "current portfolio");
  const active = asJsonObject(root.activeConstraint, "active constraint");
  const warnings = Array.isArray(root.warnings) ? root.warnings : [];
  const violations: string[] = [];
  const reason = asString(root.reason);
  if (reason === undefined || /[\p{Cc}]/u.test(reason)) {
    violations.push("TERMINAL_LIFECYCLE_PREVIEW_REASON");
  }
  if (root.expectedGrowthPlanVersion !== plan.aggregateVersion) {
    violations.push("TERMINAL_LIFECYCLE_PREVIEW_EXPECTED_PLAN_VERSION");
  }
  if (root.expectedLearningTrackVersion !== before.aggregateVersion) {
    violations.push("TERMINAL_LIFECYCLE_PREVIEW_EXPECTED_TRACK_VERSION");
  }
  for (const field of [
    "learningTrackId",
    "trackKey",
    "title",
    "priority",
    "protectedMinimumMinutes",
  ] as const) {
    if (before[field] !== after[field]) {
      violations.push("TERMINAL_LIFECYCLE_PREVIEW_UNCHANGED_FIELDS");
    }
  }
  try {
    if (BigInt(String(after.aggregateVersion)) !== BigInt(String(before.aggregateVersion)) + 1n) {
      violations.push("TERMINAL_LIFECYCLE_PREVIEW_VERSION_ADVANCE");
    }
  } catch {
    violations.push("TERMINAL_LIFECYCLE_PREVIEW_VERSION_ADVANCE");
  }
  const beforeLifecycle = asString(before.lifecycle);
  const afterLifecycle = asString(after.lifecycle);
  const expectedAfter = root.operation === "complete_track" ? "COMPLETED" : "ARCHIVED";
  const allowedBefore =
    root.operation === "complete_track"
      ? beforeLifecycle === "ACTIVE" || beforeLifecycle === "PAUSED"
      : beforeLifecycle === "ACTIVE" ||
        beforeLifecycle === "PAUSED" ||
        beforeLifecycle === "COMPLETED";
  if (!allowedBefore || afterLifecycle !== expectedAfter) {
    violations.push("TERMINAL_LIFECYCLE_PREVIEW_TRANSITION");
  }
  validateConsequences(before, plan, portfolio, active, violations);
  const expectedWarning =
    root.operation === "complete_track"
      ? "TRACK_COMPLETION_IS_TERMINAL_AND_NOT_MASTERY"
      : "TRACK_ARCHIVE_IS_TERMINAL_NOT_DELETION";
  if (
    warnings.length !== 1 ||
    asJsonObject(warnings[0], "terminal lifecycle warning").code !== expectedWarning
  ) {
    violations.push("TERMINAL_LIFECYCLE_PREVIEW_WARNING");
  }
  const expectedVisibility = beforeLifecycle === "COMPLETED" ? "TERMINAL_HISTORY" : "CURRENT_PLAN";
  if (root.visibilityBefore !== expectedVisibility || root.visibilityAfter !== "TERMINAL_HISTORY") {
    violations.push("TERMINAL_LIFECYCLE_PREVIEW_VISIBILITY");
  }
  return violations.sort();
}

function validateConsequences(
  before: JsonObject,
  plan: JsonObject,
  portfolio: JsonObject,
  active: JsonObject,
  violations: string[],
): void {
  const wasCurrent = before.lifecycle === "ACTIVE" || before.lifecycle === "PAUSED";
  const wasActive = before.lifecycle === "ACTIVE";
  const minimum = asNumber(before.protectedMinimumMinutes);
  const capacity = asNumber(plan.weeklyCapacityMinutes);
  const currentBefore = asNumber(portfolio.countBefore);
  const currentAfter = asNumber(portfolio.countAfter);
  const activeBefore = asNumber(active.activeTrackCountBefore);
  const activeAfter = asNumber(active.activeTrackCountAfter);
  const minimumBefore = asNumber(active.activeProtectedMinimumMinutesBefore);
  const minimumAfter = asNumber(active.activeProtectedMinimumMinutesAfter);
  if (
    [
      minimum,
      capacity,
      currentBefore,
      currentAfter,
      activeBefore,
      activeAfter,
      minimumBefore,
      minimumAfter,
    ].some((item) => item === undefined)
  ) {
    violations.push("TERMINAL_LIFECYCLE_PREVIEW_CONSEQUENCE");
    return;
  }
  if (currentAfter !== currentBefore! - (wasCurrent ? 1 : 0)) {
    violations.push("TERMINAL_LIFECYCLE_PREVIEW_CURRENT_DELTA");
  }
  if (
    activeAfter !== activeBefore! - (wasActive ? 1 : 0) ||
    minimumAfter !== minimumBefore! - (wasActive ? minimum! : 0)
  ) {
    violations.push("TERMINAL_LIFECYCLE_PREVIEW_ACTIVE_DELTA");
  }
  if (
    active.flexibleMinutesBefore !== capacity! - minimumBefore! ||
    active.flexibleMinutesAfter !== capacity! - minimumAfter!
  ) {
    violations.push("TERMINAL_LIFECYCLE_PREVIEW_FLEXIBLE_MINUTES");
  }
}

function applyViolations(root: JsonObject): string[] {
  const changed = asJsonObject(root.changedTrack, "changed Track");
  return changed.lifecycle === "COMPLETED" || changed.lifecycle === "ARCHIVED"
    ? []
    : ["TERMINAL_LIFECYCLE_APPLY_STATE"];
}
