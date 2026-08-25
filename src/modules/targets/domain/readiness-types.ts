export type ObjectiveDimension = "KNOWLEDGE" | "RECALL" | "APPLICATION" | "INTERVIEW_EXECUTION";
export type AchievementLevel = "NOT_STARTED" | "COMPLETED" | "VERIFIED" | "MASTERED";
export type EstimateConfidence = "LOW" | "MEDIUM" | "HIGH";

export const READINESS_ENGINE_VERSION = "readiness-engine/0.1.0";

export interface ReadinessPolicy {
  readonly version: string;
  readonly defaultTargetThreshold: number;
  readonly minimumCoverage: number;
  readonly highConfidenceCoverage: number;
  readonly freshStrength: Readonly<Record<AchievementLevel, number>>;
  readonly staleStrength: Readonly<Record<AchievementLevel, number>>;
  readonly requiredStrength: Readonly<Record<Exclude<AchievementLevel, "NOT_STARTED">, number>>;
}

export interface ReadinessDimensionInput {
  readonly competencyId: string;
  readonly dimension: ObjectiveDimension;
  readonly calculatedAsOf: string;
  readonly value: "KNOWN" | "UNKNOWN";
  readonly achievementLevel: AchievementLevel;
  readonly freshness: "FRESH" | "STALE" | "UNKNOWN";
  readonly confidence: EstimateConfidence | null;
}

export interface NodeRequirementMember {
  readonly memberType: "NODE";
  readonly competencyId: string;
  readonly dimension: ObjectiveDimension;
  readonly requiredLevel: Exclude<AchievementLevel, "NOT_STARTED">;
}

export interface RuleRequirementMember {
  readonly memberType: "RULE";
  readonly ruleId: string;
}

export type RequirementMember = NodeRequirementMember | RuleRequirementMember;

interface RequirementRuleBase {
  readonly ruleId: string;
}

export interface AllRequirementRule extends RequirementRuleBase {
  readonly kind: "ALL";
  readonly members: readonly RequirementMember[];
}

export interface AnyRequirementRule extends RequirementRuleBase {
  readonly kind: "ANY";
  readonly members: readonly RequirementMember[];
}

export interface KOfNRequirementRule extends RequirementRuleBase {
  readonly kind: "K_OF_N";
  readonly requiredCount: number;
  readonly members: readonly RequirementMember[];
}

export interface WeightedRequirementMember {
  readonly member: RequirementMember;
  readonly weight: number;
}

export interface WeightedThresholdRequirementRule extends RequirementRuleBase {
  readonly kind: "WEIGHTED_THRESHOLD";
  readonly threshold: number;
  readonly members: readonly WeightedRequirementMember[];
}

export interface MandatoryFloorRequirementRule extends RequirementRuleBase {
  readonly kind: "MANDATORY_FLOOR";
  readonly member: NodeRequirementMember;
}

export type RequirementRule =
  | AllRequirementRule
  | AnyRequirementRule
  | KOfNRequirementRule
  | WeightedThresholdRequirementRule
  | MandatoryFloorRequirementRule;

export interface CalculateTargetReadinessInput {
  readonly targetProfileVersionId: string;
  readonly rootRuleId: string;
  readonly inputWatermark: string;
  readonly targetThreshold: number | null;
  readonly rules: readonly RequirementRule[];
  readonly masteryDimensions: readonly ReadinessDimensionInput[];
}

export interface ReadinessInterval {
  readonly lower: number;
  readonly upper: number;
}

export interface RuleEvaluation extends ReadinessInterval {
  readonly ruleId: string;
  readonly kind: RequirementRule["kind"];
  readonly coverage: number;
  readonly threshold: number;
  readonly outcome: "SATISFIED" | "FAILED" | "UNRESOLVED";
  readonly witnessMemberKeys: readonly string[];
}

export interface ReadinessBlocker extends ReadinessInterval {
  readonly code: "MANDATORY_FLOOR_FAILED" | "MANDATORY_FLOOR_UNKNOWN" | "AGGREGATE_BELOW_THRESHOLD";
  readonly ruleId: string;
}

export interface TargetReadinessSnapshot extends ReadinessInterval {
  readonly engineVersion: typeof READINESS_ENGINE_VERSION;
  readonly policyVersion: string;
  readonly targetProfileVersionId: string;
  readonly inputWatermark: string;
  readonly calculatedAsOf: string;
  readonly targetThreshold: number;
  readonly coverage: number;
  readonly status: "NOT_READY" | "INSUFFICIENT_EVIDENCE" | "READY" | "DEVELOPING";
  readonly confidence: EstimateConfidence;
  readonly blockers: readonly ReadinessBlocker[];
  readonly ruleEvaluations: readonly RuleEvaluation[];
  readonly explanationCodes: readonly string[];
}

export class ReadinessInputError extends Error {
  readonly code = "INVALID_READINESS_INPUT";

  constructor(message: string) {
    super(message);
    this.name = "ReadinessInputError";
  }
}
