import { asJsonObject, asNumber, asString, type JsonObject } from "./json";

export function learningTrackPriorityMinimumControlSemanticViolations(value: unknown): string[] {
  const root = asJsonObject(value, "Learning Track priority/minimum control response");
  const contract = asJsonObject(root.contract, "Learning Track priority/minimum contract");
  const name = asString(contract.name);
  if (name === "LearningTrackPriorityMinimumApplyResultV1") return [];
  if (name !== "LearningTrackPriorityMinimumPreviewV1") {
    return ["LEARNING_TRACK_PRIORITY_MINIMUM_CONTROL_CONTRACT"];
  }
  return previewViolations(root);
}

function previewViolations(root: JsonObject): string[] {
  const before = asJsonObject(root.before, "before");
  const after = asJsonObject(root.after, "after");
  const plan = asJsonObject(root.growthPlan, "growthPlan");
  const constraint = asJsonObject(root.constraint, "constraint");
  const blockingReasons = Array.isArray(root.blockingReasons) ? root.blockingReasons : [];
  const warnings = Array.isArray(root.warnings) ? root.warnings : [];
  const violations: string[] = [];

  const reason = asString(root.reason);
  if (reason === undefined || /[\p{Cc}]/u.test(reason)) {
    violations.push("LEARNING_TRACK_PRIORITY_MINIMUM_PREVIEW_REASON");
  }
  if (root.expectedGrowthPlanVersion !== plan.aggregateVersion) {
    violations.push("LEARNING_TRACK_PRIORITY_MINIMUM_PREVIEW_EXPECTED_PLAN_VERSION");
  }
  if (root.expectedLearningTrackVersion !== before.aggregateVersion) {
    violations.push("LEARNING_TRACK_PRIORITY_MINIMUM_PREVIEW_EXPECTED_TRACK_VERSION");
  }
  for (const field of ["learningTrackId", "trackKey", "title", "lifecycle"] as const) {
    if (before[field] !== after[field]) {
      violations.push("LEARNING_TRACK_PRIORITY_MINIMUM_PREVIEW_UNCHANGED_FIELDS");
    }
  }

  const beforePriority = asNumber(before.priority);
  const afterPriority = asNumber(after.priority);
  const beforeTrackMinimum = asNumber(before.protectedMinimumMinutes);
  const afterTrackMinimum = asNumber(after.protectedMinimumMinutes);
  if (beforePriority === afterPriority && beforeTrackMinimum === afterTrackMinimum) {
    violations.push("LEARNING_TRACK_PRIORITY_MINIMUM_PREVIEW_NOOP");
  }
  try {
    if (BigInt(String(after.aggregateVersion)) !== BigInt(String(before.aggregateVersion)) + 1n) {
      violations.push("LEARNING_TRACK_PRIORITY_MINIMUM_PREVIEW_VERSION_ADVANCE");
    }
  } catch {
    violations.push("LEARNING_TRACK_PRIORITY_MINIMUM_PREVIEW_VERSION_ADVANCE");
  }

  const beforeCount = asNumber(constraint.activeTrackCountBefore);
  const afterCount = asNumber(constraint.activeTrackCountAfter);
  const beforeMinimum = asNumber(constraint.activeProtectedMinimumMinutesBefore);
  const afterMinimum = asNumber(constraint.activeProtectedMinimumMinutesAfter);
  const capacity = asNumber(plan.weeklyCapacityMinutes);
  const hypotheticalCount = asNumber(constraint.activeTrackCountIfTargetActiveAfter);
  const hypotheticalMinimum = asNumber(constraint.minimumCapacityIfTargetActiveAfter);
  const positionBefore = asNumber(constraint.currentTrackPositionBefore);
  const positionAfter = asNumber(constraint.currentTrackPositionAfter);

  if (
    [
      beforePriority,
      afterPriority,
      beforeTrackMinimum,
      afterTrackMinimum,
      beforeCount,
      afterCount,
      beforeMinimum,
      afterMinimum,
      capacity,
      hypotheticalCount,
      hypotheticalMinimum,
      positionBefore,
      positionAfter,
    ].some((item) => item === undefined)
  ) {
    violations.push("LEARNING_TRACK_PRIORITY_MINIMUM_PREVIEW_CONSTRAINT");
    return violations.sort();
  }

  const active = before.lifecycle === "ACTIVE";
  const expectedAfterMinimum = active
    ? beforeMinimum! - beforeTrackMinimum! + afterTrackMinimum!
    : beforeMinimum!;
  if (afterCount !== beforeCount || afterMinimum !== expectedAfterMinimum) {
    violations.push("LEARNING_TRACK_PRIORITY_MINIMUM_PREVIEW_ACTIVE_CONSTRAINT");
  }
  if (active && beforeMinimum! < beforeTrackMinimum!) {
    violations.push("LEARNING_TRACK_PRIORITY_MINIMUM_PREVIEW_ACTIVE_CONSTRAINT");
  }
  if (
    constraint.flexibleMinutesBefore !== capacity! - beforeMinimum! ||
    constraint.flexibleMinutesAfter !== capacity! - afterMinimum!
  ) {
    violations.push("LEARNING_TRACK_PRIORITY_MINIMUM_PREVIEW_FLEXIBLE_MINUTES");
  }

  const expectedHypotheticalCount = active ? afterCount! : afterCount! + 1;
  const expectedHypotheticalMinimum = active ? afterMinimum! : afterMinimum! + afterTrackMinimum!;
  const expectedHypotheticalFits = expectedHypotheticalMinimum <= capacity!;
  if (
    hypotheticalCount !== expectedHypotheticalCount ||
    hypotheticalMinimum !== expectedHypotheticalMinimum ||
    constraint.targetActiveStateFitsCapacity !== expectedHypotheticalFits
  ) {
    violations.push("LEARNING_TRACK_PRIORITY_MINIMUM_PREVIEW_HYPOTHETICAL_ACTIVE");
  }

  const expectedBlock =
    active && afterMinimum! > capacity!
      ? {
          code: "ACTIVE_TRACK_MINIMUM_EXCEEDS_CAPACITY",
          minimumCapacityMinutes: afterMinimum!,
        }
      : undefined;
  const actualBlock =
    blockingReasons.length === 1 ? asJsonObject(blockingReasons[0], "blocking reason") : undefined;
  if (
    root.canApply !== (expectedBlock === undefined) ||
    blockingReasons.length !== (expectedBlock === undefined ? 0 : 1)
  ) {
    violations.push("LEARNING_TRACK_PRIORITY_MINIMUM_PREVIEW_APPLICABILITY");
  }
  if (
    expectedBlock !== undefined &&
    (actualBlock?.code !== expectedBlock.code ||
      actualBlock.minimumCapacityMinutes !== expectedBlock.minimumCapacityMinutes)
  ) {
    violations.push("LEARNING_TRACK_PRIORITY_MINIMUM_PREVIEW_BLOCKING_REASON");
  }

  const expectedWarnings: JsonObject[] = [];
  if (plan.lifecycle === "PAUSED") {
    expectedWarnings.push({ code: "PARENT_GROWTH_PLAN_PAUSED" });
  }
  if (!active) {
    expectedWarnings.push({ code: "LEARNING_TRACK_PAUSED" });
    if (!expectedHypotheticalFits) {
      expectedWarnings.push({
        code: "PAUSED_TRACK_RESUME_WOULD_EXCEED_CAPACITY",
        minimumCapacityMinutes: expectedHypotheticalMinimum,
      });
    }
  }
  if (!sameWarnings(warnings, expectedWarnings)) {
    violations.push("LEARNING_TRACK_PRIORITY_MINIMUM_PREVIEW_WARNINGS");
  }

  const activeFingerprintsEqual =
    constraint.activeTrackFingerprintBefore === constraint.activeTrackFingerprintAfter;
  if ((active && activeFingerprintsEqual) || (!active && !activeFingerprintsEqual)) {
    violations.push("LEARNING_TRACK_PRIORITY_MINIMUM_PREVIEW_ACTIVE_FINGERPRINT");
  }
  if (
    constraint.currentTrackOrderFingerprintBefore === constraint.currentTrackOrderFingerprintAfter
  ) {
    violations.push("LEARNING_TRACK_PRIORITY_MINIMUM_PREVIEW_ORDER_FINGERPRINT");
  }
  if (
    (afterPriority! === beforePriority! && positionAfter !== positionBefore) ||
    (afterPriority! > beforePriority! && positionAfter! > positionBefore!) ||
    (afterPriority! < beforePriority! && positionAfter! < positionBefore!)
  ) {
    violations.push("LEARNING_TRACK_PRIORITY_MINIMUM_PREVIEW_ORDER_POSITION");
  }

  return violations.sort();
}

function sameWarnings(actual: readonly unknown[], expected: readonly JsonObject[]): boolean {
  if (actual.length !== expected.length) return false;
  return actual.every((item, index) => {
    const warning = asJsonObject(item, "warning");
    const expectedWarning = expected[index]!;
    return (
      warning.code === expectedWarning.code &&
      warning.minimumCapacityMinutes === expectedWarning.minimumCapacityMinutes
    );
  });
}
