import { planningInputSemanticViolations } from "../../../shared/contracts/planning-semantics";
import { validateSchema } from "../../../shared/contracts/schema-registry";
import { calculateVerifiedPlan } from "../domain/calculate-plan";
import {
  PlanningInputError,
  type CalculatePlanInput,
  type PlanningPolicy,
  type PlanSnapshot,
  type VerifiedCalculatePlanInput,
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
