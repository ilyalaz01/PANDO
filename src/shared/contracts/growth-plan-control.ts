import { asJsonObject, asNumber, asString } from "./json";

export function growthPlanControlSemanticViolations(value: unknown): string[] {
  const root = asJsonObject(value, "Growth Plan control response");
  const contract = asJsonObject(root.contract, "Growth Plan control contract");
  const name = asString(contract.name);
  if (name === "CurrentGrowthPlanV1") return currentPlanViolations(root);
  if (name === "GrowthPlanLifecyclePreviewV1") return previewViolations(root);
  if (name === "GrowthPlanLifecycleApplyResultV1") return [];
  return ["GROWTH_PLAN_CONTROL_CONTRACT"];
}

export function growthPlanCapacityControlSemanticViolations(value: unknown): string[] {
  const root = asJsonObject(value, "Growth Plan capacity control response");
  const contract = asJsonObject(root.contract, "Growth Plan capacity control contract");
  const name = asString(contract.name);
  if (name === "GrowthPlanCapacityApplyResultV1") return [];
  if (name !== "GrowthPlanCapacityPreviewV1") {
    return ["GROWTH_PLAN_CAPACITY_CONTROL_CONTRACT"];
  }

  const before = asJsonObject(root.before, "before");
  const after = asJsonObject(root.after, "after");
  const constraint = asJsonObject(root.constraint, "constraint");
  const blockingReasons = Array.isArray(root.blockingReasons) ? root.blockingReasons : [];
  const violations: string[] = [];
  const reason = typeof root.reason === "string" ? root.reason : undefined;
  if (reason === undefined || /[\p{Cc}]/u.test(reason)) {
    violations.push("GROWTH_PLAN_CAPACITY_PREVIEW_REASON");
  }
  if (root.expectedGrowthPlanVersion !== before.aggregateVersion) {
    violations.push("GROWTH_PLAN_CAPACITY_PREVIEW_EXPECTED_VERSION");
  }
  if (
    before.growthPlanId !== after.growthPlanId ||
    before.title !== after.title ||
    before.lifecycle !== after.lifecycle
  ) {
    violations.push("GROWTH_PLAN_CAPACITY_PREVIEW_UNCHANGED_FIELDS");
  }
  if (before.weeklyCapacityMinutes === after.weeklyCapacityMinutes) {
    violations.push("GROWTH_PLAN_CAPACITY_PREVIEW_NOOP");
  }
  try {
    if (BigInt(String(after.aggregateVersion)) !== BigInt(String(before.aggregateVersion)) + 1n) {
      violations.push("GROWTH_PLAN_CAPACITY_PREVIEW_VERSION_ADVANCE");
    }
  } catch {
    violations.push("GROWTH_PLAN_CAPACITY_PREVIEW_VERSION_ADVANCE");
  }

  const protectedMinimum = asNumber(constraint.activeProtectedMinimumMinutes);
  const beforeCapacity = asNumber(before.weeklyCapacityMinutes);
  const afterCapacity = asNumber(after.weeklyCapacityMinutes);
  if (
    protectedMinimum === undefined ||
    beforeCapacity === undefined ||
    afterCapacity === undefined
  ) {
    violations.push("GROWTH_PLAN_CAPACITY_PREVIEW_CONSTRAINT");
  } else {
    if (constraint.flexibleMinutesBefore !== beforeCapacity - protectedMinimum) {
      violations.push("GROWTH_PLAN_CAPACITY_PREVIEW_FLEXIBLE_BEFORE");
    }
    if (constraint.flexibleMinutesAfter !== afterCapacity - protectedMinimum) {
      violations.push("GROWTH_PLAN_CAPACITY_PREVIEW_FLEXIBLE_AFTER");
    }
    const shouldApply = afterCapacity >= protectedMinimum;
    const blocked = blockingReasons.length === 1;
    const reasonValue = blocked ? asJsonObject(blockingReasons[0], "blocking reason") : undefined;
    if (root.canApply !== shouldApply || blocked === shouldApply) {
      violations.push("GROWTH_PLAN_CAPACITY_PREVIEW_APPLICABILITY");
    }
    if (
      !shouldApply &&
      (reasonValue?.code !== "ACTIVE_TRACK_MINIMUM_EXCEEDS_CAPACITY" ||
        reasonValue.minimumCapacityMinutes !== protectedMinimum)
    ) {
      violations.push("GROWTH_PLAN_CAPACITY_PREVIEW_BLOCKING_REASON");
    }
    if (shouldApply && blockingReasons.length !== 0) {
      violations.push("GROWTH_PLAN_CAPACITY_PREVIEW_BLOCKING_REASON");
    }
  }
  return violations.sort();
}

function currentPlanViolations(root: Record<string, unknown>): string[] {
  const plan = root.currentPlan === null ? null : asJsonObject(root.currentPlan, "currentPlan");
  const recalculation = asJsonObject(root.recalculation, "recalculation");
  const capabilities = Array.isArray(root.capabilities) ? root.capabilities : [];
  if (plan === null) {
    return recalculation.projectionState === "NOT_STARTED" && capabilities.length === 0
      ? []
      : ["CURRENT_GROWTH_PLAN_EMPTY_STATE"];
  }
  if (recalculation.projectionState === "NOT_STARTED") {
    return ["CURRENT_GROWTH_PLAN_PROJECTION_STATE"];
  }
  const expected = plan.lifecycle === "ACTIVE" ? "pause_growth_plan" : "resume_growth_plan";
  return capabilities.length === 1 && capabilities[0] === expected
    ? []
    : ["CURRENT_GROWTH_PLAN_CAPABILITY"];
}

function previewViolations(root: Record<string, unknown>): string[] {
  const before = asJsonObject(root.before, "before");
  const after = asJsonObject(root.after, "after");
  const violations: string[] = [];
  const reason = typeof root.reason === "string" ? root.reason : undefined;
  if (reason === undefined || /[\p{Cc}]/u.test(reason)) {
    violations.push("GROWTH_PLAN_PREVIEW_REASON");
  }
  if (root.expectedGrowthPlanVersion !== before.aggregateVersion) {
    violations.push("GROWTH_PLAN_PREVIEW_EXPECTED_VERSION");
  }
  if (
    before.growthPlanId !== after.growthPlanId ||
    before.title !== after.title ||
    before.weeklyCapacityMinutes !== after.weeklyCapacityMinutes
  ) {
    violations.push("GROWTH_PLAN_PREVIEW_UNCHANGED_FIELDS");
  }
  try {
    if (BigInt(String(after.aggregateVersion)) !== BigInt(String(before.aggregateVersion)) + 1n) {
      violations.push("GROWTH_PLAN_PREVIEW_VERSION_ADVANCE");
    }
  } catch {
    violations.push("GROWTH_PLAN_PREVIEW_VERSION_ADVANCE");
  }
  const transition = `${String(before.lifecycle)}:${String(after.lifecycle)}`;
  if (
    (root.operation === "pause_growth_plan" && transition !== "ACTIVE:PAUSED") ||
    (root.operation === "resume_growth_plan" && transition !== "PAUSED:ACTIVE")
  ) {
    violations.push("GROWTH_PLAN_PREVIEW_TRANSITION");
  }
  return violations.sort();
}
