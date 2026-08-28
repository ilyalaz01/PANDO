import { MASTERY_POLICY_V0_1 } from "./policy-v0.1";
import type { PrerequisiteSatisfactionPolicy } from "./prerequisite-satisfaction-types";

export const PREREQUISITE_SATISFACTION_POLICY_V0_1 = {
  version: "mastery-prerequisite-satisfaction/0.1",
  acceptedMasteryEngineVersion: "mastery-engine/0.1.0",
  acceptedMasteryPolicyVersion: MASTERY_POLICY_V0_1.version,
  freshnessDays: MASTERY_POLICY_V0_1.freshnessDays,
  satisfyingAchievementLevels: ["COMPLETED", "VERIFIED", "MASTERED"],
} as const satisfies PrerequisiteSatisfactionPolicy;
