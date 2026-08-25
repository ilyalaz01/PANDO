export const REVIEW_ENGINE_VERSION = "review-engine/0.1.0";

export type ReviewReasonType =
  "RETENTION_RISK" | "PERSONAL_REMINDER" | "GOAL_DEADLINE" | "VERIFICATION_NEEDED";
export type ReviewResponse = "AGAIN" | "HARD" | "GOOD" | "EASY";

export interface ReviewResponseRule {
  readonly fixedDays: number | null;
  readonly minimumDays: number;
  readonly multiplier: number;
}

export interface ReviewPolicy {
  readonly version: string;
  readonly initialVerificationDays: number;
  readonly initialRetentionDays: number;
  readonly goalDeadlineLeadDays: number;
  readonly defaultPreviousIntervalDays: number;
  readonly maximumIntervalDays: number;
  readonly responseRules: Readonly<Record<ReviewResponse, ReviewResponseRule>>;
}

export interface ReviewReasonEventInput {
  readonly eventId: string;
  readonly sourceKey: string;
  readonly sourceRevision: number;
  readonly subjectId: string;
  readonly reason: ReviewReasonType;
  readonly dueAt: string;
  readonly active: boolean;
}

export interface CalculateReviewItemInput {
  readonly workspaceId: string;
  readonly subjectId: string;
  readonly inputWatermark: string;
  readonly reasonEvents: readonly ReviewReasonEventInput[];
}

export interface ReviewReasonSnapshot {
  readonly sourceKey: string;
  readonly sourceRevision: number;
  readonly sourceEventId: string;
  readonly reason: ReviewReasonType;
  readonly dueAt: string;
}

export interface ReviewItemSnapshot {
  readonly workspaceId: string;
  readonly subjectId: string;
  readonly effectiveDueAt: string;
  readonly timing: "UPCOMING" | "DUE" | "OVERDUE";
  readonly reasons: readonly ReviewReasonSnapshot[];
}

export interface ReviewCalculation {
  readonly engineVersion: typeof REVIEW_ENGINE_VERSION;
  readonly policyVersion: string;
  readonly inputWatermark: string;
  readonly calculatedAsOf: string;
  readonly item: ReviewItemSnapshot | null;
  readonly replayedEventIds: readonly string[];
  readonly explanationCodes: readonly string[];
}

export interface InitialReviewDueInput {
  readonly reason: ReviewReasonType;
  readonly anchorAt: string;
  readonly selectedDueAt: string | null;
  readonly proposedDueAt: string | null;
  readonly goalDeadlineAt: string | null;
}

export interface ScheduleReviewResponseInput {
  readonly response: ReviewResponse;
  readonly completedAt: string;
  readonly previousIntervalDays: number | null;
}

export interface ScheduledReviewResponse {
  readonly response: ReviewResponse;
  readonly intervalDays: number;
  readonly dueAt: string;
}

export class ReviewInputError extends Error {
  readonly code = "INVALID_REVIEW_INPUT";

  constructor(message: string) {
    super(message);
    this.name = "ReviewInputError";
  }
}
