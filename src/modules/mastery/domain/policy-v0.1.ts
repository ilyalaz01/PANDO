import type { MasteryPolicy } from "./types";

export const MASTERY_POLICY_V0_1: MasteryPolicy = Object.freeze({
  version: "mastery-readiness-policy/0.1",
  minimumMappingConfidence: 0.75,
  minimumSourceReliability: 0.6,
  verificationDelayHours: 24,
  masteryMinimumEvents: 3,
  masteryMinimumUtcDates: 3,
  masteryMinimumSpanHours: 72,
  freshnessDays: Object.freeze({
    KNOWLEDGE: 90,
    RECALL: 30,
    APPLICATION: 60,
    INTERVIEW_EXECUTION: 45,
  }),
});
