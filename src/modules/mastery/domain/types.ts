export const MASTERY_ENGINE_VERSION = "mastery-engine/0.1.0";

export const OBJECTIVE_DIMENSIONS = [
  "KNOWLEDGE",
  "RECALL",
  "APPLICATION",
  "INTERVIEW_EXECUTION",
] as const;

export type ObjectiveDimension = (typeof OBJECTIVE_DIMENSIONS)[number];
export type AchievementLevel = "NOT_STARTED" | "COMPLETED" | "VERIFIED" | "MASTERED";
export type EstimateCondition = "WEAK" | "STALE" | "STRONG";
export type EstimateConfidence = "LOW" | "MEDIUM" | "HIGH";
export type EvidenceOutcome = "SUCCESS" | "FAILURE";
export type EvidenceEngagement = "INDEPENDENT" | "GUIDED" | "PASSIVE";

export interface MasteryPolicy {
  readonly version: string;
  readonly minimumMappingConfidence: number;
  readonly minimumSourceReliability: number;
  readonly verificationDelayHours: number;
  readonly masteryMinimumEvents: number;
  readonly masteryMinimumUtcDates: number;
  readonly masteryMinimumSpanHours: number;
  readonly freshnessDays: Readonly<Record<ObjectiveDimension, number>>;
}

export interface MasteryEvidenceInput {
  readonly evidenceId: string;
  readonly attemptId: string;
  readonly sourceId: string;
  readonly occurredAt: string;
  readonly dimension: ObjectiveDimension;
  readonly outcome: EvidenceOutcome;
  readonly engagement: EvidenceEngagement;
  readonly normalized: boolean;
  readonly invalidated: boolean;
  readonly observedResult: boolean;
  readonly mappingConfidence: number;
  readonly sourceReliability: number;
  readonly targetRelevant: boolean;
}

export interface CalculateCompetencyStateInput {
  readonly competencyId: string;
  readonly inputWatermark: string;
  readonly evidence: readonly MasteryEvidenceInput[];
}

export interface DimensionState {
  readonly dimension: ObjectiveDimension;
  readonly value: "KNOWN" | "UNKNOWN";
  readonly achievementLevel: AchievementLevel;
  readonly condition: EstimateCondition | null;
  readonly confidence: EstimateConfidence | null;
  readonly freshness: "FRESH" | "STALE" | "UNKNOWN";
  readonly lastMeaningfulEvidenceAt: string | null;
  readonly supportingEvidenceIds: readonly string[];
  readonly contradictingEvidenceIds: readonly string[];
  readonly explanationCodes: readonly string[];
}

export interface CompetencyState {
  readonly engineVersion: typeof MASTERY_ENGINE_VERSION;
  readonly policyVersion: string;
  readonly inputWatermark: string;
  readonly competencyId: string;
  readonly calculatedAsOf: string;
  readonly achievementLevel: AchievementLevel;
  readonly dimensions: Readonly<Record<ObjectiveDimension, DimensionState>>;
  readonly supportingEvidenceIds: readonly string[];
  readonly contradictingEvidenceIds: readonly string[];
  readonly explanationCodes: readonly string[];
}

export class MasteryInputError extends Error {
  readonly code = "INVALID_MASTERY_INPUT";

  constructor(message: string) {
    super(message);
    this.name = "MasteryInputError";
  }
}
