import {
  MILLISECONDS_PER_DAY,
  parseInstant,
  toCanonicalInstant,
  utcDateKey,
  type EvaluationClock,
} from "../../../shared/domain/utc-instant";
import {
  MASTERY_ENGINE_VERSION,
  MasteryInputError,
  OBJECTIVE_DIMENSIONS,
  type AchievementLevel,
  type CalculateCompetencyStateInput,
  type CompetencyState,
  type DimensionState,
  type EstimateConfidence,
  type MasteryEvidenceInput,
  type MasteryPolicy,
  type ObjectiveDimension,
} from "./types";

const HOURS_TO_MILLISECONDS = 3_600_000;

interface EvaluatedEvidence {
  readonly input: MasteryEvidenceInput;
  readonly occurredAtMs: number;
}

function fail(message: string): never {
  throw new MasteryInputError(message);
}

function requireIdentifier(value: string, fieldName: string): void {
  if (value.trim().length === 0) {
    fail(`${fieldName} must not be empty`);
  }
}

function requireProbability(value: number, fieldName: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    fail(`${fieldName} must be between 0 and 1`);
  }
}

function parseMasteryInstant(value: string, fieldName: string): number {
  try {
    return parseInstant(value, fieldName);
  } catch (error) {
    fail(String(error));
  }
}

function validatePolicy(policy: MasteryPolicy): void {
  requireIdentifier(policy.version, "policy.version");
  requireProbability(policy.minimumMappingConfidence, "policy.minimumMappingConfidence");
  requireProbability(policy.minimumSourceReliability, "policy.minimumSourceReliability");

  const positivePolicyNumbers = [
    ["verificationDelayHours", policy.verificationDelayHours],
    ["masteryMinimumEvents", policy.masteryMinimumEvents],
    ["masteryMinimumUtcDates", policy.masteryMinimumUtcDates],
    ["masteryMinimumSpanHours", policy.masteryMinimumSpanHours],
  ] as const;

  for (const [name, value] of positivePolicyNumbers) {
    if (!Number.isInteger(value) || value <= 0) {
      fail(`policy.${name} must be a positive whole number`);
    }
  }

  for (const dimension of OBJECTIVE_DIMENSIONS) {
    const days = policy.freshnessDays[dimension];
    if (!Number.isInteger(days) || days <= 0) {
      fail(`policy.freshnessDays.${dimension} must be a positive whole number`);
    }
  }
}

function evidenceFingerprint(evidence: MasteryEvidenceInput): string {
  return [
    evidence.attemptId,
    evidence.sourceId,
    evidence.occurredAt,
    evidence.dimension,
    evidence.outcome,
    evidence.engagement,
    evidence.normalized,
    evidence.invalidated,
    evidence.observedResult,
    evidence.mappingConfidence,
    evidence.sourceReliability,
    evidence.targetRelevant,
  ].join("\u001f");
}

function validateAndDeduplicateEvidence(
  input: readonly MasteryEvidenceInput[],
  asOfMs: number,
): readonly EvaluatedEvidence[] {
  const unique = new Map<string, EvaluatedEvidence>();

  for (const evidence of input) {
    requireIdentifier(evidence.evidenceId, "evidence.evidenceId");
    requireIdentifier(evidence.attemptId, `evidence ${evidence.evidenceId} attemptId`);
    requireIdentifier(evidence.sourceId, `evidence ${evidence.evidenceId} sourceId`);
    requireProbability(
      evidence.mappingConfidence,
      `evidence ${evidence.evidenceId} mappingConfidence`,
    );
    requireProbability(
      evidence.sourceReliability,
      `evidence ${evidence.evidenceId} sourceReliability`,
    );

    const occurredAtMs = parseMasteryInstant(
      evidence.occurredAt,
      `evidence ${evidence.evidenceId} occurredAt`,
    );
    if (occurredAtMs > asOfMs) {
      fail(`evidence ${evidence.evidenceId} occurs after clock.asOf`);
    }

    const existing = unique.get(evidence.evidenceId);
    if (existing) {
      if (evidenceFingerprint(existing.input) !== evidenceFingerprint(evidence)) {
        fail(`evidenceId ${evidence.evidenceId} has conflicting duplicates`);
      }
      continue;
    }

    unique.set(evidence.evidenceId, { input: evidence, occurredAtMs });
  }

  return [...unique.values()].sort(
    (left, right) =>
      left.occurredAtMs - right.occurredAtMs ||
      left.input.evidenceId.localeCompare(right.input.evidenceId),
  );
}

function isMeaningful(evidence: MasteryEvidenceInput, policy: MasteryPolicy): boolean {
  return (
    evidence.normalized &&
    !evidence.invalidated &&
    evidence.observedResult &&
    evidence.mappingConfidence >= policy.minimumMappingConfidence &&
    evidence.sourceReliability >= policy.minimumSourceReliability
  );
}

function isQualifyingSuccess(evidence: MasteryEvidenceInput): boolean {
  return (
    evidence.outcome === "SUCCESS" &&
    (evidence.engagement !== "PASSIVE" || evidence.dimension === "KNOWLEDGE")
  );
}

function hasDelayedOrIndependentReproduction(
  successes: readonly EvaluatedEvidence[],
  policy: MasteryPolicy,
): boolean {
  const delayMs = policy.verificationDelayHours * HOURS_TO_MILLISECONDS;

  for (let laterIndex = 1; laterIndex < successes.length; laterIndex += 1) {
    const later = successes[laterIndex]!;

    for (let earlierIndex = 0; earlierIndex < laterIndex; earlierIndex += 1) {
      const earlier = successes[earlierIndex]!;
      if (
        earlier.input.attemptId !== later.input.attemptId &&
        (later.input.engagement === "INDEPENDENT" ||
          later.occurredAtMs - earlier.occurredAtMs >= delayMs)
      ) {
        return true;
      }
    }
  }

  return false;
}

function achievementLevel(
  successes: readonly EvaluatedEvidence[],
  allCompetencySuccesses: readonly EvaluatedEvidence[],
  policy: MasteryPolicy,
): AchievementLevel {
  if (successes.length === 0) {
    return "NOT_STARTED";
  }

  if (
    successes.every((evidence) => evidence.input.engagement === "PASSIVE") ||
    !hasDelayedOrIndependentReproduction(successes, policy)
  ) {
    return "COMPLETED";
  }

  const utcDates = new Set(successes.map((evidence) => utcDateKey(evidence.occurredAtMs)));
  const first = successes[0]!;
  const last = successes.at(-1)!;
  const hasMasterySpan =
    last.occurredAtMs - first.occurredAtMs >=
    policy.masteryMinimumSpanHours * HOURS_TO_MILLISECONDS;
  const hasTargetRelevantPerformance = allCompetencySuccesses.some(
    ({ input: evidence }) =>
      evidence.targetRelevant &&
      (evidence.dimension === "APPLICATION" || evidence.dimension === "INTERVIEW_EXECUTION"),
  );

  if (
    successes.length >= policy.masteryMinimumEvents &&
    utcDates.size >= policy.masteryMinimumUtcDates &&
    hasMasterySpan &&
    hasTargetRelevantPerformance
  ) {
    return "MASTERED";
  }

  return "VERIFIED";
}

function lowerConfidence(confidence: EstimateConfidence): EstimateConfidence {
  if (confidence === "HIGH") {
    return "MEDIUM";
  }
  return "LOW";
}

function estimateConfidence(
  evidence: readonly EvaluatedEvidence[],
  stale: boolean,
  unresolvedContradiction: boolean,
): EstimateConfidence {
  const attemptCount = new Set(evidence.map(({ input }) => input.attemptId)).size;
  const sourceCount = new Set(evidence.map(({ input }) => input.sourceId)).size;
  const independentCount = evidence.filter(
    ({ input }) => input.engagement === "INDEPENDENT",
  ).length;
  const utcDateCount = new Set(evidence.map(({ occurredAtMs }) => utcDateKey(occurredAtMs))).size;
  const onlyGuidedOrPassive = independentCount === 0;

  let confidence: EstimateConfidence;
  if (attemptCount <= 1 || sourceCount <= 1 || onlyGuidedOrPassive || unresolvedContradiction) {
    confidence = "LOW";
  } else if (attemptCount >= 3 && utcDateCount >= 3 && independentCount >= 2) {
    confidence = "HIGH";
  } else {
    confidence = "MEDIUM";
  }

  return stale ? lowerConfidence(confidence) : confidence;
}

function calculateDimension(
  dimension: ObjectiveDimension,
  allMeaningful: readonly EvaluatedEvidence[],
  allCompetencySuccesses: readonly EvaluatedEvidence[],
  policy: MasteryPolicy,
  asOfMs: number,
): DimensionState {
  const meaningful = allMeaningful.filter(({ input }) => input.dimension === dimension);
  if (meaningful.length === 0) {
    return {
      dimension,
      value: "UNKNOWN",
      achievementLevel: "NOT_STARTED",
      condition: null,
      confidence: null,
      freshness: "UNKNOWN",
      lastMeaningfulEvidenceAt: null,
      supportingEvidenceIds: [],
      contradictingEvidenceIds: [],
      explanationCodes: ["NO_RELEVANT_EVIDENCE", "UNKNOWN_NOT_ZERO"],
    };
  }

  const successes = meaningful.filter(({ input }) => isQualifyingSuccess(input));
  const supporting = meaningful
    .filter(({ input }) => input.outcome === "SUCCESS")
    .map(({ input }) => input.evidenceId)
    .sort();
  const contradicting = meaningful
    .filter(({ input }) => input.outcome === "FAILURE")
    .map(({ input }) => input.evidenceId)
    .sort();
  const latest = meaningful.at(-1)!;

  const stale =
    asOfMs - latest.occurredAtMs > policy.freshnessDays[dimension] * MILLISECONDS_PER_DAY;
  const unresolvedContradiction = supporting.length > 0 && contradicting.length > 0;
  const level = achievementLevel(successes, allCompetencySuccesses, policy);
  const condition = stale
    ? "STALE"
    : contradicting.length > 0
      ? "WEAK"
      : successes.length > 0
        ? "STRONG"
        : "WEAK";
  const explanationCodes = [
    level === "NOT_STARTED" ? "NO_QUALIFYING_SUCCESS" : `ACHIEVEMENT_${level}`,
    stale ? "FRESHNESS_WINDOW_EXCEEDED" : "WITHIN_FRESHNESS_WINDOW",
  ];

  if (unresolvedContradiction) {
    explanationCodes.push("UNRESOLVED_CONTRADICTION");
  }

  return {
    dimension,
    value: "KNOWN",
    achievementLevel: level,
    condition,
    confidence: estimateConfidence(meaningful, stale, unresolvedContradiction),
    freshness: stale ? "STALE" : "FRESH",
    lastMeaningfulEvidenceAt: toCanonicalInstant(latest.occurredAtMs),
    supportingEvidenceIds: supporting,
    contradictingEvidenceIds: contradicting,
    explanationCodes,
  };
}

export function calculateCompetencyState(
  input: CalculateCompetencyStateInput,
  policy: MasteryPolicy,
  clock: EvaluationClock,
): CompetencyState {
  requireIdentifier(input.competencyId, "input.competencyId");
  requireIdentifier(input.inputWatermark, "input.inputWatermark");
  validatePolicy(policy);

  const asOfMs = parseMasteryInstant(clock.asOf, "clock.asOf");
  const evidence = validateAndDeduplicateEvidence(input.evidence, asOfMs);
  const meaningful = evidence.filter(({ input: event }) => isMeaningful(event, policy));
  const successes = meaningful.filter(({ input: event }) => isQualifyingSuccess(event));
  const supportingEvidenceIds = meaningful
    .filter(({ input: event }) => event.outcome === "SUCCESS")
    .map(({ input: event }) => event.evidenceId)
    .sort();
  const contradictingEvidenceIds = meaningful
    .filter(({ input: event }) => event.outcome === "FAILURE")
    .map(({ input: event }) => event.evidenceId)
    .sort();

  const dimensions = Object.fromEntries(
    OBJECTIVE_DIMENSIONS.map((dimension) => [
      dimension,
      calculateDimension(dimension, meaningful, successes, policy, asOfMs),
    ]),
  ) as Record<ObjectiveDimension, DimensionState>;
  const overallLevel = achievementLevel(successes, successes, policy);

  return {
    engineVersion: MASTERY_ENGINE_VERSION,
    policyVersion: policy.version,
    inputWatermark: input.inputWatermark,
    competencyId: input.competencyId,
    calculatedAsOf: toCanonicalInstant(asOfMs),
    achievementLevel: overallLevel,
    dimensions,
    supportingEvidenceIds,
    contradictingEvidenceIds,
    explanationCodes:
      meaningful.length === 0
        ? ["NO_RELEVANT_EVIDENCE", "UNKNOWN_DIMENSIONS_PRESERVED"]
        : [`ACHIEVEMENT_${overallLevel}`, "FULL_RECALCULATION_FROM_ACTIVE_EVIDENCE"],
  };
}
