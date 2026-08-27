import {
  MILLISECONDS_PER_DAY,
  parseInstant,
  toCanonicalInstant,
} from "../../../shared/domain/utc-instant";
import { calculateCompetencyState } from "../domain/calculate-competency-state";
import { MASTERY_POLICY_V0_1 } from "../domain/policy-v0.1";
import {
  MASTERY_ENGINE_VERSION,
  MasteryInputError,
  OBJECTIVE_DIMENSIONS,
  type MasteryEvidenceInput,
} from "../domain/types";

export const MASTERY_READINESS_ENGINE_VERSION = MASTERY_ENGINE_VERSION;
export const MASTERY_READINESS_POLICY_VERSION = MASTERY_POLICY_V0_1.version;
export const MASTERY_READINESS_OBJECTIVE_DIMENSIONS = OBJECTIVE_DIMENSIONS;

export const MASTERY_READINESS_SOURCE_LIMITS_V1 = Object.freeze({
  evidencePerCompetency: 10_000,
  totalEvidence: 50_000,
});

export const MASTERY_READINESS_EVIDENCE_REFERENCES_PER_OUTCOME_V1 = 8;

export type MasteryReadinessObjectiveDimension =
  (typeof MASTERY_READINESS_OBJECTIVE_DIMENSIONS)[number];
export type MasteryReadinessAchievementLevel =
  "NOT_STARTED" | "COMPLETED" | "VERIFIED" | "MASTERED";
export type MasteryReadinessEstimateConfidence = "LOW" | "MEDIUM" | "HIGH";

export interface MasteryReadinessEvidenceInputV1 {
  readonly evidenceId: string;
  readonly attemptId: string;
  readonly sourceId: string;
  readonly occurredAt: string;
  readonly dimension: MasteryReadinessObjectiveDimension;
  readonly outcome: "SUCCESS" | "FAILURE";
  readonly engagement: "INDEPENDENT" | "GUIDED" | "PASSIVE";
  readonly normalized: boolean;
  readonly invalidated: boolean;
  readonly observedResult: boolean;
  readonly mappingConfidence: number;
  readonly sourceReliability: number;
  readonly targetRelevant: boolean;
}

export interface MasteryReadinessCompetencySourceV1 {
  readonly competencyRef: string;
  readonly evidence: readonly MasteryReadinessEvidenceInputV1[];
}

export interface MasteryReadinessRequiredDimensionV1 {
  readonly competencyRef: string;
  readonly dimension: MasteryReadinessObjectiveDimension;
}

export interface MasteryReadinessDimensionInputV1 {
  readonly competencyRef: string;
  readonly dimension: MasteryReadinessObjectiveDimension;
  readonly calculatedAsOf: string;
  readonly value: "KNOWN" | "UNKNOWN";
  readonly achievementLevel: MasteryReadinessAchievementLevel;
  readonly freshness: "FRESH" | "STALE" | "UNKNOWN";
  readonly confidence: MasteryReadinessEstimateConfidence | null;
  readonly lastMeaningfulEvidenceAt: string | null;
  readonly supportingEvidenceIds: readonly string[];
  readonly contradictingEvidenceIds: readonly string[];
}

export interface MasteryReadinessInputSetV1 {
  readonly calculatedAsOf: string;
  readonly sourceEvidenceWatermark: string;
  readonly masteryEngineVersion: typeof MASTERY_READINESS_ENGINE_VERSION;
  readonly masteryPolicyVersion: string;
  readonly dimensions: readonly MasteryReadinessDimensionInputV1[];
}

export interface SynchronizeMasteryReadinessInputsV1 {
  readonly calculatedAsOf: string;
  readonly sourceEvidenceWatermark: string;
  readonly declaredMasteryEngineVersion: string;
  readonly declaredMasteryPolicyVersion: string;
  readonly competencies: readonly MasteryReadinessCompetencySourceV1[];
  readonly requiredDimensions: readonly MasteryReadinessRequiredDimensionV1[];
}

export class MasteryReadinessSynchronizationError extends TypeError {
  readonly code = "INVALID_MASTERY_INPUT";

  constructor(message: string) {
    super(message);
    this.name = "MasteryReadinessSynchronizationError";
  }
}

function fail(message: string): never {
  throw new MasteryReadinessSynchronizationError(message);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function dimensionIdentity(input: MasteryReadinessRequiredDimensionV1): string {
  return `${input.competencyRef}\u001f${input.dimension}`;
}

function validateEnvelope(input: SynchronizeMasteryReadinessInputsV1): string {
  if (input.declaredMasteryEngineVersion !== MASTERY_READINESS_ENGINE_VERSION) {
    fail("Declared Mastery engine version is unsupported");
  }
  if (input.declaredMasteryPolicyVersion !== MASTERY_READINESS_POLICY_VERSION) {
    fail("Declared Mastery policy version is unsupported");
  }
  if (!Array.isArray(input.competencies) || !Array.isArray(input.requiredDimensions)) {
    fail("Mastery readiness inputs must be arrays");
  }

  let calculatedAsOf: string;
  try {
    calculatedAsOf = toCanonicalInstant(parseInstant(input.calculatedAsOf, "calculatedAsOf"));
  } catch (error) {
    fail(String(error));
  }

  const competencyRefs = new Set<string>();
  const evidenceIds = new Set<string>();
  let totalEvidence = 0;
  for (const competency of input.competencies) {
    if (
      typeof competency.competencyRef !== "string" ||
      competency.competencyRef.length === 0 ||
      competencyRefs.has(competency.competencyRef) ||
      !Array.isArray(competency.evidence) ||
      competency.evidence.length > MASTERY_READINESS_SOURCE_LIMITS_V1.evidencePerCompetency
    ) {
      fail("Mastery competency source is invalid or exceeds its evidence limit");
    }
    competencyRefs.add(competency.competencyRef);
    totalEvidence += competency.evidence.length;
    if (totalEvidence > MASTERY_READINESS_SOURCE_LIMITS_V1.totalEvidence) {
      fail("Mastery readiness source exceeds its total evidence limit");
    }
    for (const evidence of competency.evidence) {
      if (
        typeof evidence.evidenceId !== "string" ||
        evidence.evidenceId.length === 0 ||
        evidenceIds.has(evidence.evidenceId)
      ) {
        fail("Mastery readiness source contains a duplicate or invalid evidence identifier");
      }
      evidenceIds.add(evidence.evidenceId);
    }
  }

  const requiredIdentities = new Set<string>();
  const requiredCompetencyRefs = new Set<string>();
  for (const required of input.requiredDimensions) {
    if (
      typeof required.competencyRef !== "string" ||
      required.competencyRef.length === 0 ||
      !MASTERY_READINESS_OBJECTIVE_DIMENSIONS.includes(required.dimension) ||
      requiredIdentities.has(dimensionIdentity(required))
    ) {
      fail("Required Mastery dimension is invalid or duplicated");
    }
    requiredIdentities.add(dimensionIdentity(required));
    requiredCompetencyRefs.add(required.competencyRef);
  }
  if (
    competencyRefs.size !== requiredCompetencyRefs.size ||
    [...requiredCompetencyRefs].some((competencyRef) => !competencyRefs.has(competencyRef))
  ) {
    fail("Mastery source competency set does not match required dimensions");
  }
  return calculatedAsOf;
}

function mostRecentEvidenceIds(
  evidenceIds: readonly string[],
  source: MasteryReadinessCompetencySourceV1,
  dimension: MasteryReadinessObjectiveDimension,
): readonly string[] {
  const requested = new Set(evidenceIds);
  const matches = source.evidence.filter(
    (evidence) => requested.has(evidence.evidenceId) && evidence.dimension === dimension,
  );
  if (matches.length !== requested.size) {
    fail("Calculated Mastery evidence provenance is inconsistent");
  }
  return matches
    .sort((left, right) => {
      const leftTime = Date.parse(left.occurredAt);
      const rightTime = Date.parse(right.occurredAt);
      return rightTime - leftTime || compareText(left.evidenceId, right.evidenceId);
    })
    .slice(0, MASTERY_READINESS_EVIDENCE_REFERENCES_PER_OUTCOME_V1)
    .map(({ evidenceId }) => evidenceId);
}

export function masteryReadinessPolicyFingerprintManifestV1(): readonly unknown[] {
  return [
    MASTERY_READINESS_ENGINE_VERSION,
    MASTERY_READINESS_POLICY_VERSION,
    MASTERY_POLICY_V0_1.minimumMappingConfidence,
    MASTERY_POLICY_V0_1.minimumSourceReliability,
    MASTERY_POLICY_V0_1.verificationDelayHours,
    MASTERY_POLICY_V0_1.masteryMinimumEvents,
    MASTERY_POLICY_V0_1.masteryMinimumUtcDates,
    MASTERY_POLICY_V0_1.masteryMinimumSpanHours,
    MASTERY_READINESS_OBJECTIVE_DIMENSIONS.map((dimension) => [
      dimension,
      MASTERY_POLICY_V0_1.freshnessDays[dimension],
    ]),
  ];
}

export function synchronizeMasteryReadinessInputsV1(
  input: SynchronizeMasteryReadinessInputsV1,
): MasteryReadinessInputSetV1 {
  const calculatedAsOf = validateEnvelope(input);
  const sources = new Map(input.competencies.map((source) => [source.competencyRef, source]));
  const states = new Map<string, ReturnType<typeof calculateCompetencyState>>();

  try {
    for (const source of input.competencies) {
      const state = calculateCompetencyState(
        {
          competencyId: source.competencyRef,
          inputWatermark: input.sourceEvidenceWatermark,
          evidence: source.evidence as readonly MasteryEvidenceInput[],
        },
        MASTERY_POLICY_V0_1,
        { asOf: calculatedAsOf },
      );
      if (
        state.competencyId !== source.competencyRef ||
        state.calculatedAsOf !== calculatedAsOf ||
        state.inputWatermark !== input.sourceEvidenceWatermark ||
        state.engineVersion !== input.declaredMasteryEngineVersion ||
        state.policyVersion !== input.declaredMasteryPolicyVersion
      ) {
        fail("Calculated Mastery provenance is inconsistent");
      }
      states.set(source.competencyRef, state);
    }
  } catch (error) {
    if (error instanceof MasteryReadinessSynchronizationError) throw error;
    if (error instanceof MasteryInputError) {
      throw new MasteryReadinessSynchronizationError(error.message);
    }
    throw error;
  }

  const dimensions = [...input.requiredDimensions]
    .sort((left, right) => compareText(dimensionIdentity(left), dimensionIdentity(right)))
    .map((required): MasteryReadinessDimensionInputV1 => {
      const competency = states.get(required.competencyRef);
      const source = sources.get(required.competencyRef);
      if (competency === undefined || source === undefined) {
        fail("Required Mastery competency was not calculated");
      }
      const state = competency.dimensions[required.dimension];
      return {
        competencyRef: competency.competencyId,
        dimension: required.dimension,
        calculatedAsOf: competency.calculatedAsOf,
        value: state.value,
        achievementLevel: state.achievementLevel,
        freshness: state.freshness,
        confidence: state.confidence,
        lastMeaningfulEvidenceAt: state.lastMeaningfulEvidenceAt,
        supportingEvidenceIds: mostRecentEvidenceIds(
          state.supportingEvidenceIds,
          source,
          required.dimension,
        ),
        contradictingEvidenceIds: mostRecentEvidenceIds(
          state.contradictingEvidenceIds,
          source,
          required.dimension,
        ),
      };
    });

  return {
    calculatedAsOf,
    sourceEvidenceWatermark: input.sourceEvidenceWatermark,
    masteryEngineVersion: MASTERY_READINESS_ENGINE_VERSION,
    masteryPolicyVersion: MASTERY_READINESS_POLICY_VERSION,
    dimensions,
  };
}

export function calculateMasteryReadinessValidUntilV1(
  inputs: readonly MasteryReadinessDimensionInputV1[],
  calculatedAsOf: string,
): string | null {
  const asOfMs = Date.parse(calculatedAsOf);
  if (!Number.isFinite(asOfMs) || new Date(asOfMs).toISOString() !== calculatedAsOf) {
    fail("Mastery readiness clock is not canonical");
  }
  let earliest: number | null = null;
  for (const input of inputs) {
    if (input.calculatedAsOf !== calculatedAsOf) {
      fail("Mastery readiness dimension clock is inconsistent");
    }
    if (
      input.value !== "KNOWN" ||
      input.freshness !== "FRESH" ||
      input.lastMeaningfulEvidenceAt === null
    ) {
      continue;
    }
    const boundary =
      Date.parse(input.lastMeaningfulEvidenceAt) +
      MASTERY_POLICY_V0_1.freshnessDays[input.dimension] * MILLISECONDS_PER_DAY;
    if (!Number.isSafeInteger(boundary) || boundary < asOfMs) {
      fail("Mastery freshness boundary is inconsistent");
    }
    earliest = earliest === null ? boundary : Math.min(earliest, boundary);
  }
  return earliest === null ? null : new Date(earliest).toISOString();
}
