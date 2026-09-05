import { planningInputSemanticViolations } from "../../../shared/contracts/planning-semantics";
import { validateSchema } from "../../../shared/contracts/schema-registry";
import {
  calculateVerifiedPlan,
  calculateVerifiedPlanV2,
  calculateVerifiedPlanV3,
  calculateVerifiedPlanV4,
} from "../domain/calculate-plan";
import {
  PlanningInputError,
  type CalculatePlanInput,
  type CalculatePlanInputV2,
  type CalculatePlanInputV3,
  type CalculatePlanInputV4,
  type PlanningPolicy,
  type PlanningPolicyV2,
  type PlanningPolicyV3,
  type PlanningPolicyV4,
  type PlanSnapshot,
  type PlanSnapshotV2,
  type PlanSnapshotV3,
  type PlanSnapshotV4,
  type VerifiedCalculatePlanInput,
  type VerifiedCalculatePlanInputV2,
  type VerifiedCalculatePlanInputV3,
  type VerifiedCalculatePlanInputV4,
} from "../domain/planning-types";

/** The only public raw-input entry point for the Planning calculation. */
export function calculatePlan(input: CalculatePlanInput, policy: PlanningPolicy): PlanSnapshot {
  const structural = validateSchema("planning-input-v1", input);
  if (!structural.valid) {
    throw new PlanningInputError(
      `Planning input contract rejected: ${structural.violations.map(({ code }) => code).join(",")}`,
    );
  }
  const semantic = planningInputSemanticViolations(input);
  if (semantic.length > 0) {
    throw new PlanningInputError(`Planning input contract rejected: ${semantic.join(",")}`);
  }
  return calculateVerifiedPlan(input as VerifiedCalculatePlanInput, policy);
}

/** Raw-input entry point for the versioned D2c Planning calculation. */
export function calculatePlanV2(
  input: CalculatePlanInputV2,
  policy: PlanningPolicyV2,
): PlanSnapshotV2 {
  const structural = validateSchema("planning-input-v2", input);
  if (!structural.valid) {
    throw new PlanningInputError(
      `Planning input contract rejected: ${structural.violations.map(({ code }) => code).join(",")}`,
    );
  }
  const semantic = planningInputSemanticViolations(input);
  if (semantic.length > 0) {
    throw new PlanningInputError(`Planning input contract rejected: ${semantic.join(",")}`);
  }
  const result = calculateVerifiedPlanV2(input as VerifiedCalculatePlanInputV2, policy);
  const resultStructural = validateSchema("plan-snapshot-v2", result);
  if (!resultStructural.valid) {
    throw new PlanningInputError(
      `Planning result contract rejected: ${resultStructural.violations.map(({ code }) => code).join(",")}`,
    );
  }
  return result;
}

/** Raw-input entry point for the versioned D3b availability-composed Planning calculation. */
export function calculatePlanV3(
  input: CalculatePlanInputV3,
  policy: PlanningPolicyV3,
): PlanSnapshotV3 {
  const structural = validateSchema("planning-input-v3", input);
  if (!structural.valid) {
    throw new PlanningInputError(
      `Planning input contract rejected: ${structural.violations.map(({ code }) => code).join(",")}`,
    );
  }
  const semantic = planningInputSemanticViolations(input);
  if (semantic.length > 0) {
    throw new PlanningInputError(`Planning input contract rejected: ${semantic.join(",")}`);
  }
  const result = calculateVerifiedPlanV3(input as VerifiedCalculatePlanInputV3, policy);
  const resultStructural = validateSchema("plan-snapshot-v3", result);
  if (!resultStructural.valid) {
    throw new PlanningInputError(
      `Planning result contract rejected: ${resultStructural.violations.map(({ code }) => code).join(",")}`,
    );
  }
  return result;
}

/** Raw-input entry point for the versioned D5 campaign-overlay Planning calculation. */
export function calculatePlanV4(
  input: CalculatePlanInputV4,
  policy: PlanningPolicyV4,
): PlanSnapshotV4 {
  const structural = validateSchema("planning-input-v4", input);
  if (!structural.valid) {
    throw new PlanningInputError(
      `Planning input contract rejected: ${structural.violations.map(({ code }) => code).join(",")}`,
    );
  }
  const semantic = planningInputSemanticViolations(input);
  if (semantic.length > 0) {
    throw new PlanningInputError(`Planning input contract rejected: ${semantic.join(",")}`);
  }
  const result = calculateVerifiedPlanV4(input as VerifiedCalculatePlanInputV4, policy);
  const resultStructural = validateSchema("plan-snapshot-v4", result);
  if (!resultStructural.valid) {
    throw new PlanningInputError(
      `Planning result contract rejected: ${resultStructural.violations.map(({ code }) => code).join(",")}`,
    );
  }
  return result;
}
