import type { ReadinessPolicy } from "./readiness-types";

export const READINESS_POLICY_V0_1: ReadinessPolicy = Object.freeze({
  version: "mastery-readiness-policy/0.1",
  defaultTargetThreshold: 0.8,
  minimumCoverage: 0.7,
  highConfidenceCoverage: 0.9,
  freshStrength: Object.freeze({
    NOT_STARTED: 0,
    COMPLETED: 0.5,
    VERIFIED: 0.75,
    MASTERED: 1,
  }),
  staleStrength: Object.freeze({
    NOT_STARTED: 0,
    COMPLETED: 0.4,
    VERIFIED: 0.6,
    MASTERED: 0.8,
  }),
  requiredStrength: Object.freeze({
    COMPLETED: 0.5,
    VERIFIED: 0.75,
    MASTERED: 1,
  }),
});
