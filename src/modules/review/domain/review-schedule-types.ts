import type { ReviewCalculation, ReviewReasonType } from "./review-types";

export const REVIEW_ACTION_TYPES = ["RESCHEDULE", "SKIP_ONCE", "SUPPRESS", "RESTORE"] as const;

export type ReviewActionType = (typeof REVIEW_ACTION_TYPES)[number];
export type ReviewReasonSourceKind = "MASTERY" | "PERSONAL_REMINDER";

export interface ReviewReasonSourceEventInput {
  readonly eventId: string;
  readonly reasonId: string;
  readonly sourceKey: string;
  readonly sourceRevision: number;
  readonly sourceKind: ReviewReasonSourceKind;
  readonly subjectId: string;
  readonly reason: ReviewReasonType;
  readonly occurrenceId: string;
  readonly baseDueAt: string;
  readonly sourceActive: boolean;
}

export interface ReviewActionEventInput {
  readonly actionId: string;
  readonly actionRevision: number;
  readonly sourceKey: string;
  readonly occurrenceId: string;
  readonly action: ReviewActionType;
  readonly occurredAt: string;
  readonly targetDueAt: string | null;
}

export interface FoldReviewScheduleInput {
  readonly workspaceId: string;
  readonly subjectId: string;
  readonly inputWatermark: string;
  readonly sourceEvents: readonly ReviewReasonSourceEventInput[];
  readonly actionEvents: readonly ReviewActionEventInput[];
}

export interface EffectiveReviewReason {
  readonly reasonId: string;
  readonly sourceKey: string;
  readonly sourceRevision: number;
  readonly sourceKind: ReviewReasonSourceKind;
  readonly reason: ReviewReasonType;
  readonly occurrenceId: string;
  readonly baseDueAt: string;
  readonly dueAt: string;
  readonly sourceActive: boolean;
  readonly suppressed: boolean;
  readonly active: boolean;
}

export interface ReviewScheduleProjection {
  readonly calculation: ReviewCalculation;
  readonly reasons: readonly EffectiveReviewReason[];
  readonly replayedSourceEventIds: readonly string[];
  readonly replayedActionIds: readonly string[];
}
