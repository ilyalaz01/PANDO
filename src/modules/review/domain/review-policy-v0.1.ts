import type { ReviewPolicy } from "./review-types";

export const REVIEW_POLICY_V0_1: ReviewPolicy = Object.freeze({
  version: "review-policy/0.1",
  initialVerificationDays: 3,
  initialRetentionDays: 3,
  goalDeadlineLeadDays: 7,
  defaultPreviousIntervalDays: 3,
  maximumIntervalDays: 180,
  responseRules: Object.freeze({
    AGAIN: Object.freeze({ fixedDays: 1, minimumDays: 1, multiplier: 0 }),
    HARD: Object.freeze({ fixedDays: null, minimumDays: 2, multiplier: 1.2 }),
    GOOD: Object.freeze({ fixedDays: null, minimumDays: 3, multiplier: 2 }),
    EASY: Object.freeze({ fixedDays: null, minimumDays: 7, multiplier: 3 }),
  }),
});
