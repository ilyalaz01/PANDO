import type { PlanningPolicy } from "./planning-types";

export const PLANNING_POLICY_V0_1: PlanningPolicy = Object.freeze({
  version: "planning-policy/0.1",
  maximumActions: 5,
  failedMandatoryFloorPoints: 500,
  unknownMandatoryFloorPoints: 450,
  knownShortfallPoints: 350,
  unknownRequirementPoints: 250,
  overdueReviewPoints: 450,
  dueTodayReviewPoints: 350,
  protectedMinimumDeficitPoints: 200,
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
