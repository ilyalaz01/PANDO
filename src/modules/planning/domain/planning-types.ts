export const PLANNER_ENGINE_VERSION = "planner-engine/0.1.0" as const;

export type EnergyMode = "LOW" | "MEDIUM" | "HIGH";
export type EstimateConfidence = "LOW" | "MEDIUM" | "HIGH";
export type PlanningSourceSignal = "GROWTH_PLAN" | "CAMPAIGN" | "REVIEW";
export type PrerequisiteState = "SATISFIED" | "UNKNOWN" | "BLOCKED";
export type ReviewBucket = "OVERDUE" | "DUE_TODAY";
export type ObjectiveDimension = "KNOWLEDGE" | "RECALL" | "APPLICATION" | "INTERVIEW_EXECUTION";
export type ReadinessGapCode =
  "FAILED_MANDATORY_FLOOR" | "UNKNOWN_MANDATORY_FLOOR" | "UNKNOWN_REQUIREMENT" | "KNOWN_SHORTFALL";
export type ReadinessUnavailableReason =
  "GOAL_INACTIVE" | "NOT_MATERIALIZED" | "REBUILDING" | "STALE" | "ERROR";

export interface PlanningPolicy {
  readonly version: string;
  readonly maximumActions: number;
  readonly failedMandatoryFloorPoints: number;
  readonly unknownMandatoryFloorPoints: number;
  readonly knownShortfallPoints: number;
  readonly unknownRequirementPoints: number;
  readonly overdueReviewPoints: number;
  readonly dueTodayReviewPoints: number;
  readonly protectedMinimumDeficitPoints: number;
  readonly campaignSourcePoints: number;
  readonly campaignDeadlinePoints: Readonly<{
    within7Days: number;
    within21Days: number;
    within42Days: number;
  }>;
  readonly unlockPointsPerCompetency: number;
  readonly maximumUnlockPoints: number;
  readonly exactEnergyFitPoints: number;
  readonly lowerEnergyFitPoints: number;
  readonly unknownPrerequisitePenalty: number;
  readonly higherEnergyPenalty: number;
  readonly repetitionPenaltyEach: number;
  readonly maximumRepetitionPenalty: number;
  readonly activeFocusResumePoints: number;
}

export interface PlanningTrackInput {
  readonly trackId: string;
  readonly trackKey: string;
  readonly title: string;
  readonly version: string;
  readonly readinessGoalKey: string;
  readonly targetProfileVersionKey: string;
  readonly lifecycle: "ACTIVE" | "PAUSED" | "COMPLETED";
  readonly priority: number;
  readonly protectedMinimumMinutes: number;
  readonly meaningfulMinutesThisWeek: number;
  readonly defaultSessionMinutes: number;
}

export interface GrowthPlanInput {
  readonly growthPlanId: string;
  readonly version: string;
  readonly lifecycle: "ACTIVE" | "PAUSED";
  readonly weeklyCapacityMinutes: number;
  readonly consumedMinutesThisWeek: number;
  readonly tracks: readonly PlanningTrackInput[];
}

export interface CampaignInput {
  readonly campaignId: string;
  readonly version: string;
  readonly title: string;
  readonly readinessGoalKey: string;
  readonly targetProfileVersionKey: string;
  readonly deadlineAt: string;
}

export interface ReadinessGapInput {
  readonly gapCode: ReadinessGapCode;
  readonly competencyRef: string;
  readonly dimension: ObjectiveDimension;
}

export interface ReadinessBlockerInput {
  readonly code: string;
  readonly ruleKey: string;
}

export type PlanningReadinessInput =
  | {
      readonly availability: "CURRENT";
      readonly reason: null;
      readonly readinessGoalKey: string;
      readonly targetProfileVersionKey: string;
      readonly snapshotId: string;
      readonly inputFingerprint: string;
      readonly calculatedAsOf: string;
      readonly validUntil: string | null;
      readonly status: "NOT_READY" | "INSUFFICIENT_EVIDENCE" | "READY" | "DEVELOPING";
      readonly coverage: number;
      readonly confidence: EstimateConfidence;
      readonly blockers: readonly ReadinessBlockerInput[];
      readonly gaps: readonly ReadinessGapInput[];
    }
  | {
      readonly availability: "UNAVAILABLE";
      readonly reason: ReadinessUnavailableReason;
      readonly readinessGoalKey: string;
      readonly targetProfileVersionKey: string;
      readonly snapshotId: null;
      readonly inputFingerprint: null;
      readonly calculatedAsOf: null;
      readonly validUntil: null;
      readonly status: null;
      readonly coverage: null;
      readonly confidence: null;
      readonly blockers: readonly [];
      readonly gaps: readonly [];
    };

export interface ReviewSignalInput {
  readonly reviewItemId: string;
  readonly bucket: ReviewBucket;
  readonly dueAt: string;
}

export interface CandidateCompetencyImpact {
  readonly competencyRef: string;
  readonly dimension: ObjectiveDimension;
}

export interface PlanningCandidateInput {
  readonly candidateKey: string;
  readonly readinessGoalKey: string;
  readonly targetProfileVersionKey: string;
  readonly activityKey: string;
  readonly title: string;
  readonly estimatedMinutes: number;
  readonly energy: EnergyMode | null;
  readonly durationSource: "PLANNING_ACTIVITY" | "REVIEW_POLICY";
  readonly sourceSignals: readonly PlanningSourceSignal[];
  readonly trackId: string | null;
  readonly competencyImpacts: readonly CandidateCompetencyImpact[];
  readonly prerequisiteState: PrerequisiteState;
  readonly unlockCount: number;
  readonly repetitionsInLast7Days: number;
  /** Oldest terminal-session end included in the half-open 168-hour repetition window. */
  readonly oldestRepetitionEndedAt: string | null;
  /**
   * Exclusive instant at which the oldest counted repetition leaves the 168-hour window under
   * `planning-completed-work/0.1`. Null exactly when no repetition is counted.
   */
  readonly repetitionWindowEndsAt: string | null;
  readonly review: ReviewSignalInput | null;
}

export interface ActiveFocusInput {
  readonly focusSessionId: string;
  readonly readinessGoalKey: string;
  readonly activityKey: string;
  readonly title: string;
  readonly plannedMinutes: number;
  readonly startedAt: string;
  readonly planAttribution: {
    readonly planSnapshotId: string;
    readonly candidateKey: string;
    readonly trackId: string | null;
  } | null;
}

export interface ReviewSummaryInput {
  readonly projectionState: "CURRENT" | "PENDING" | "NOT_STARTED";
  readonly overdueCount: number;
  readonly dueTodayCount: number;
  /** Inclusive owner-declared cutoff for clock-derived Review buckets, or null if none exists. */
  readonly validUntil: string | null;
}

export interface PlanningEvaluationHorizon {
  readonly asOf: string;
  readonly validUntil: string;
  readonly timeZone: string;
  readonly weekStart: string;
  readonly weekEnd: string;
}

export interface PlanningSourceRevision {
  readonly owner: "CATALOG" | "EVIDENCE" | "FOCUS" | "MASTERY" | "OVERLAY" | "REVIEW";
  readonly key: string;
  readonly revision: string;
}

export interface CalculatePlanInput {
  readonly inputFingerprint: string;
  /** Version of the input-normalization policy that produced every completed-work number. */
  readonly completedWorkPolicyVersion: string;
  readonly evaluationHorizon: PlanningEvaluationHorizon;
  readonly sourceRevisions: readonly PlanningSourceRevision[];
  readonly growthPlan: GrowthPlanInput | null;
  readonly campaign: CampaignInput | null;
  readonly sessionLimitMinutes: number | null;
  readonly energyPreference: EnergyMode | null;
  readonly activeFocus: ActiveFocusInput | null;
  readonly readiness: readonly PlanningReadinessInput[];
  readonly reviewSummary: ReviewSummaryInput;
  readonly candidates: readonly PlanningCandidateInput[];
}

declare const verifiedPlanningInput: unique symbol;
export type VerifiedCalculatePlanInput = CalculatePlanInput & {
  readonly [verifiedPlanningInput]: true;
};

export type PlanScoreFactorCode =
  | "ACTIVE_FOCUS_RESUME"
  | "CAMPAIGN_DEADLINE"
  | "CAMPAIGN_SOURCE"
  | "ENERGY_EXACT_FIT"
  | "ENERGY_HIGHER_MISMATCH"
  | "ENERGY_LOWER_FIT"
  | "PREREQUISITE_UNLOCK"
  | "PREREQUISITE_UNKNOWN"
  | "RECENT_REPETITION"
  | "REVIEW_DUE_TODAY"
  | "REVIEW_OVERDUE"
  | "TARGET_FAILED_MANDATORY_FLOOR"
  | "TARGET_KNOWN_SHORTFALL"
  | "TARGET_UNKNOWN_MANDATORY_FLOOR"
  | "TARGET_UNKNOWN_REQUIREMENT"
  | "TRACK_PRIORITY"
  | "TRACK_PROTECTED_MINIMUM";

export interface PlanScoreFactor {
  readonly code: PlanScoreFactorCode;
  readonly points: number;
}

export type ExpectedBenefitCode =
  | "RESUME_ACTIVE_FOCUS"
  | "REDUCE_MANDATORY_BLOCKER"
  | "VERIFY_MANDATORY_REQUIREMENT"
  | "COMPLETE_OVERDUE_REVIEW"
  | "COMPLETE_DUE_REVIEW"
  | "REDUCE_TARGET_GAP"
  | "REDUCE_UNCERTAINTY"
  | "PROTECT_TRACK_CADENCE"
  | "ADVANCE_CAMPAIGN"
  | "ADVANCE_GROWTH_TRACK";

export type PlanReasonRef =
  | {
      readonly factorCode: "ACTIVE_FOCUS_RESUME";
      readonly kind: "ACTIVE_FOCUS";
      readonly focusSessionId: string;
    }
  | {
      readonly factorCode:
        | "TARGET_FAILED_MANDATORY_FLOOR"
        | "TARGET_KNOWN_SHORTFALL"
        | "TARGET_UNKNOWN_MANDATORY_FLOOR"
        | "TARGET_UNKNOWN_REQUIREMENT";
      readonly kind: "TARGET_GAP";
      readonly gapCode: ReadinessGapCode;
      readonly readinessGoalKey: string;
      readonly competencyRef: string;
      readonly dimension: ObjectiveDimension;
    }
  | {
      readonly factorCode: "REVIEW_DUE_TODAY" | "REVIEW_OVERDUE";
      readonly kind: "REVIEW_ITEM";
      readonly reviewItemId: string;
      readonly bucket: ReviewBucket;
      readonly dueAt: string;
    }
  | {
      readonly factorCode: "TRACK_PRIORITY" | "TRACK_PROTECTED_MINIMUM";
      readonly kind: "TRACK";
      readonly trackId: string;
      readonly trackKey: string;
    }
  | {
      readonly factorCode: "CAMPAIGN_DEADLINE" | "CAMPAIGN_SOURCE";
      readonly kind: "CAMPAIGN";
      readonly campaignId: string;
      readonly campaignVersion: string;
      readonly readinessGoalKey: string;
      readonly deadlineAt: string;
      readonly daysUntilDeadline: number;
    };

export interface PlannedAction {
  readonly rank: number;
  readonly actionKind: "START" | "RESUME";
  readonly candidateKey: string;
  readonly focusSessionId: string | null;
  readonly readinessGoalKey: string;
  readonly activityKey: string;
  readonly trackId: string | null;
  readonly planAttribution: ActiveFocusInput["planAttribution"];
  readonly title: string;
  readonly durationMinutes: number;
  readonly durationSource: "ACTIVE_FOCUS" | PlanningCandidateInput["durationSource"];
  readonly energy: EnergyMode | null;
  readonly sourceSignals: readonly (PlanningSourceSignal | "ACTIVE_FOCUS")[];
  readonly score: number;
  readonly scoreFactors: readonly PlanScoreFactor[];
  readonly reasonRefs: readonly PlanReasonRef[];
  readonly expectedBenefit: ExpectedBenefitCode;
  readonly reason: string;
}

export interface PlanSnapshot {
  readonly engineVersion: typeof PLANNER_ENGINE_VERSION;
  readonly policyVersion: string;
  readonly inputFingerprint: string;
  readonly calculatedAsOf: string;
  readonly validUntil: string;
  readonly timeZone: string;
  readonly weekStart: string;
  readonly weekEnd: string;
  readonly recommendationState:
    "CURRENT" | "NO_PLAN" | "PLAN_PAUSED" | "NO_CAPACITY" | "NO_CANDIDATES";
  readonly warningCodes: readonly string[];
  readonly capacity: {
    readonly weeklyCapacityMinutes: number | null;
    readonly consumedMinutesThisWeek: number;
    readonly remainingMinutesThisWeek: number | null;
    readonly sessionLimitMinutes: number | null;
  };
  readonly reviewSummary: ReviewSummaryInput;
  readonly nearestDeadline: {
    readonly kind: "CAMPAIGN";
    readonly sourceId: string;
    readonly sourceVersion: string;
    readonly readinessGoalKey: string;
    readonly title: string;
    readonly deadlineAt: string;
  } | null;
  readonly readiness: readonly {
    readonly readinessGoalKey: string;
    readonly targetProfileVersionKey: string;
    readonly availability: PlanningReadinessInput["availability"];
    readonly reason: ReadinessUnavailableReason | null;
    readonly snapshotId: string | null;
    readonly inputFingerprint: string | null;
    readonly calculatedAsOf: string | null;
    readonly validUntil: string | null;
    readonly status: "NOT_READY" | "INSUFFICIENT_EVIDENCE" | "READY" | "DEVELOPING" | null;
    readonly coverage: number | null;
    readonly confidence: EstimateConfidence | null;
    readonly blockers: readonly ReadinessBlockerInput[];
    readonly blockerCount: number;
    readonly gapCount: number;
    readonly unknownGapCount: number;
    readonly criticalGap: ReadinessGapInput | null;
  }[];
  readonly actions: readonly PlannedAction[];
}

export class PlanningInputError extends Error {
  readonly code = "INVALID_PLANNING_INPUT";

  constructor(message: string) {
    super(message);
    this.name = "PlanningInputError";
  }
}
