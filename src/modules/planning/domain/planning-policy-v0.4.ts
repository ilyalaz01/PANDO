import type { PlanningPolicyV4 } from "./planning-types";

/** D5 successor: identical V0.3 weights. Eligibility and clamping add no coefficient. */
export const PLANNING_POLICY_V0_4: PlanningPolicyV4 = Object.freeze({
  version: "planning-policy/0.4",
  maximumActions: 5,
  failedMandatoryFloorPoints: 500,
  unknownMandatoryFloorPoints: 450,
  knownShortfallPoints: 350,
  unknownRequirementPoints: 250,
  overdueReviewPoints: 450,
  dueTodayReviewPoints: 350,
  protectedMinimumDeficitPoints: 200,
  cadenceDeficitOnePoints: 75,
  cadenceDeficitMultiplePoints: 150,
  campaignSourcePoints: 250,
  campaignDeadlinePoints: Object.freeze({
    within7Days: 300,
    within21Days: 200,
    within42Days: 100,
  }),
  unlockPointsPerCompetency: 20,
  maximumUnlockPoints: 100,
  exactEnergyFitPoints: 75,
  lowerEnergyFitPoints: 25,
  unknownPrerequisitePenalty: 150,
  higherEnergyPenalty: 200,
  repetitionPenaltyEach: 75,
  maximumRepetitionPenalty: 225,
  activeFocusResumePoints: 10_000,
});
