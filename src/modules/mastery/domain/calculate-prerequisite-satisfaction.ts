import {
  MILLISECONDS_PER_DAY,
  parseInstant,
  toCanonicalInstant,
} from "../../../shared/domain/utc-instant";
import {
  MASTERY_ENGINE_VERSION,
  MasteryInputError,
  OBJECTIVE_DIMENSIONS,
  type AchievementLevel,
  type ObjectiveDimension,
} from "./types";
import {
  MASTERY_PREREQUISITE_ENGINE_VERSION,
  type CalculatePrerequisiteSatisfactionInput,
  type PrerequisiteSatisfactionPolicy,
  type PrerequisiteSatisfactionReason,
  type PrerequisiteSatisfactionResult,
  type PrerequisiteSatisfactionState,
} from "./prerequisite-satisfaction-types";

const COMPETENCY_REF = /^competency:[a-z0-9][a-z0-9-]{1,100}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const POSITIVE_INTEGER = /^[1-9][0-9]{0,18}$/u;
const PROJECTION_GENERATION = /^[a-z][a-z0-9_.-]{1,79}$/u;
const ACHIEVEMENT_LEVELS = ["NOT_STARTED", "COMPLETED", "VERIFIED", "MASTERED"] as const;
const ACHIEVEMENT_RANK: Readonly<Record<AchievementLevel, number>> = {
  NOT_STARTED: 0,
  COMPLETED: 1,
  VERIFIED: 2,
  MASTERED: 3,
};
const CONDITIONS = ["WEAK", "STALE", "STRONG"] as const;
const CONFIDENCE = ["LOW", "MEDIUM", "HIGH"] as const;
const FRESHNESS = ["FRESH", "STALE", "UNKNOWN"] as const;

interface ParsedDimension {
  readonly dimension: ObjectiveDimension;
  readonly value: "KNOWN" | "UNKNOWN";
  readonly achievementLevel: AchievementLevel;
  readonly condition: "WEAK" | "STALE" | "STRONG" | null;
  readonly confidence: "LOW" | "MEDIUM" | "HIGH" | null;
  readonly freshness: "FRESH" | "STALE" | "UNKNOWN";
  readonly lastMeaningfulEvidenceAtMs: number | null;
}

function fail(message: string): never {
  throw new MasteryInputError(message);
}

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  return actual.length === required.length && actual.every((key, index) => key === required[index]);
}

function oneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === "string" && values.includes(value as T);
}

function parsedInstant(value: unknown): number | null {
  if (typeof value !== "string") return null;
  try {
    return parseInstant(value, "Mastery prerequisite source instant");
  } catch {
    return null;
  }
}

function result(
  policy: PrerequisiteSatisfactionPolicy,
  competencyRef: string,
  state: PrerequisiteSatisfactionState,
  reason: PrerequisiteSatisfactionReason,
  validUntilMs: number | null = null,
): PrerequisiteSatisfactionResult {
  return {
    engineVersion: MASTERY_PREREQUISITE_ENGINE_VERSION,
    policyVersion: policy.version,
    competencyRef,
    state,
    reason,
    validUntil: validUntilMs === null ? null : toCanonicalInstant(validUntilMs),
  };
}

function malformed(
  policy: PrerequisiteSatisfactionPolicy,
  competencyRef: string,
): PrerequisiteSatisfactionResult {
  return result(policy, competencyRef, "UNKNOWN", "MALFORMED_STATE");
}

function validatePolicy(policy: PrerequisiteSatisfactionPolicy): void {
  if (
    policy.version !== "mastery-prerequisite-satisfaction/0.1" ||
    policy.acceptedMasteryEngineVersion !== MASTERY_ENGINE_VERSION ||
    policy.acceptedMasteryPolicyVersion !== "mastery-readiness-policy/0.1"
  ) {
    fail("Mastery prerequisite policy metadata is unsupported");
  }
  if (!exactKeys(policy.freshnessDays as Record<string, unknown>, OBJECTIVE_DIMENSIONS)) {
    fail("Mastery prerequisite freshness policy is incomplete");
  }
  for (const dimension of OBJECTIVE_DIMENSIONS) {
    const days = policy.freshnessDays[dimension];
    if (!Number.isSafeInteger(days) || days <= 0) {
      fail("Mastery prerequisite freshness policy is invalid");
    }
  }
  if (
    policy.satisfyingAchievementLevels.length !== 3 ||
    !["COMPLETED", "VERIFIED", "MASTERED"].every((level) =>
      policy.satisfyingAchievementLevels.includes(level as AchievementLevel),
    )
  ) {
    fail("Mastery prerequisite achievement policy is invalid");
  }
}

function parseDimension(
  raw: unknown,
  name: ObjectiveDimension,
  calculatedAsOfMs: number,
  policy: PrerequisiteSatisfactionPolicy,
): ParsedDimension | null {
  const dimension = object(raw);
  if (
    dimension === null ||
    !exactKeys(dimension, [
      "dimension",
      "value",
      "achievementLevel",
      "condition",
      "confidence",
      "freshness",
      "lastMeaningfulEvidenceAt",
    ]) ||
    dimension.dimension !== name ||
    !oneOf(dimension.value, ["KNOWN", "UNKNOWN"] as const) ||
    !oneOf(dimension.achievementLevel, ACHIEVEMENT_LEVELS) ||
    !oneOf(dimension.freshness, FRESHNESS)
  ) {
    return null;
  }
  if (dimension.value === "UNKNOWN") {
    if (
      dimension.achievementLevel !== "NOT_STARTED" ||
      dimension.condition !== null ||
      dimension.confidence !== null ||
      dimension.freshness !== "UNKNOWN" ||
      dimension.lastMeaningfulEvidenceAt !== null
    ) {
      return null;
    }
    return {
      dimension: name,
      value: "UNKNOWN",
      achievementLevel: "NOT_STARTED",
      condition: null,
      confidence: null,
      freshness: "UNKNOWN",
      lastMeaningfulEvidenceAtMs: null,
    };
  }
  if (
    !oneOf(dimension.condition, CONDITIONS) ||
    !oneOf(dimension.confidence, CONFIDENCE) ||
    dimension.freshness === "UNKNOWN"
  ) {
    return null;
  }
  const lastMeaningfulEvidenceAtMs = parsedInstant(dimension.lastMeaningfulEvidenceAt);
  if (lastMeaningfulEvidenceAtMs === null || lastMeaningfulEvidenceAtMs > calculatedAsOfMs) {
    return null;
  }
  const boundary = lastMeaningfulEvidenceAtMs + policy.freshnessDays[name] * MILLISECONDS_PER_DAY;
  if (!Number.isSafeInteger(boundary)) return null;
  const freshAtCalculation = calculatedAsOfMs <= boundary;
  if (
    (freshAtCalculation && (dimension.freshness !== "FRESH" || dimension.condition === "STALE")) ||
    (!freshAtCalculation && (dimension.freshness !== "STALE" || dimension.condition !== "STALE")) ||
    (dimension.condition === "STRONG" && dimension.achievementLevel === "NOT_STARTED")
  ) {
    return null;
  }
  return {
    dimension: name,
    value: "KNOWN",
    achievementLevel: dimension.achievementLevel,
    condition: dimension.condition,
    confidence: dimension.confidence,
    freshness: dimension.freshness,
    lastMeaningfulEvidenceAtMs,
  };
}

/**
 * Pure Mastery-owned classifier used by Planning's read-projection composition. It consumes only
 * the minimized current Mastery projection and an explicit clock; malformed state fails Unknown.
 */
export function calculatePrerequisiteSatisfaction(
  input: CalculatePrerequisiteSatisfactionInput,
  policy: PrerequisiteSatisfactionPolicy,
  clock: Readonly<{ asOf: string }>,
): PrerequisiteSatisfactionResult {
  validatePolicy(policy);
  if (!COMPETENCY_REF.test(input.competencyRef))
    fail("Prerequisite competency reference is invalid");
  const asOfMs = parseInstant(clock.asOf, "Mastery prerequisite calculation clock");
  if (input.projection === null) {
    return result(policy, input.competencyRef, "UNKNOWN", "NOT_MATERIALIZED");
  }
  const projection = object(input.projection);
  if (
    projection === null ||
    !exactKeys(projection, [
      "snapshotId",
      "pointerInputWatermark",
      "pointerProjectionVersion",
      "pointerUpdatedAt",
      "projectionGeneration",
      "engineVersion",
      "policyVersion",
      "calculatedAsOf",
      "achievementLevel",
      "createdAt",
      "state",
    ]) ||
    typeof projection.snapshotId !== "string" ||
    !UUID.test(projection.snapshotId) ||
    typeof projection.pointerInputWatermark !== "string" ||
    !POSITIVE_INTEGER.test(projection.pointerInputWatermark) ||
    typeof projection.pointerProjectionVersion !== "string" ||
    !POSITIVE_INTEGER.test(projection.pointerProjectionVersion) ||
    typeof projection.projectionGeneration !== "string" ||
    !PROJECTION_GENERATION.test(projection.projectionGeneration) ||
    !oneOf(projection.achievementLevel, ACHIEVEMENT_LEVELS)
  ) {
    return malformed(policy, input.competencyRef);
  }
  const pointerUpdatedAtMs = parsedInstant(projection.pointerUpdatedAt);
  const createdAtMs = parsedInstant(projection.createdAt);
  const calculatedAsOfMs = parsedInstant(projection.calculatedAsOf);
  if (pointerUpdatedAtMs === null || createdAtMs === null || calculatedAsOfMs === null) {
    return malformed(policy, input.competencyRef);
  }
  if (pointerUpdatedAtMs > asOfMs || createdAtMs > asOfMs || calculatedAsOfMs > asOfMs) {
    return result(policy, input.competencyRef, "UNKNOWN", "AFTER_CLAIM");
  }
  if (createdAtMs < calculatedAsOfMs || pointerUpdatedAtMs < createdAtMs) {
    return malformed(policy, input.competencyRef);
  }
  if (
    projection.engineVersion !== policy.acceptedMasteryEngineVersion ||
    projection.policyVersion !== policy.acceptedMasteryPolicyVersion
  ) {
    return result(policy, input.competencyRef, "UNKNOWN", "UNSUPPORTED_PROJECTION");
  }
  const state = object(projection.state);
  if (
    state === null ||
    !exactKeys(state, [
      "engineVersion",
      "policyVersion",
      "inputWatermark",
      "competencyId",
      "calculatedAsOf",
      "achievementLevel",
      "dimensions",
    ]) ||
    state.engineVersion !== projection.engineVersion ||
    state.policyVersion !== projection.policyVersion ||
    state.inputWatermark !== projection.pointerInputWatermark ||
    state.competencyId !== input.competencyRef ||
    state.achievementLevel !== projection.achievementLevel ||
    parsedInstant(state.calculatedAsOf) !== calculatedAsOfMs
  ) {
    return malformed(policy, input.competencyRef);
  }
  const dimensions = object(state.dimensions);
  if (dimensions === null || !exactKeys(dimensions, OBJECTIVE_DIMENSIONS)) {
    return malformed(policy, input.competencyRef);
  }
  const parsed: ParsedDimension[] = [];
  for (const name of OBJECTIVE_DIMENSIONS) {
    const dimension = parseDimension(dimensions[name], name, calculatedAsOfMs, policy);
    if (dimension === null) return malformed(policy, input.competencyRef);
    parsed.push(dimension);
  }
  if (
    parsed.some(
      (dimension) =>
        ACHIEVEMENT_RANK[dimension.achievementLevel] >
        ACHIEVEMENT_RANK[projection.achievementLevel as AchievementLevel],
    )
  ) {
    return malformed(policy, input.competencyRef);
  }

  const decisive = parsed.flatMap((dimension) => {
    if (dimension.value !== "KNOWN" || dimension.lastMeaningfulEvidenceAtMs === null) return [];
    const boundary =
      dimension.lastMeaningfulEvidenceAtMs +
      policy.freshnessDays[dimension.dimension] * MILLISECONDS_PER_DAY;
    return asOfMs <= boundary ? [{ dimension, boundary }] : [];
  });
  const satisfying = decisive.filter(
    ({ dimension }) =>
      dimension.condition === "STRONG" &&
      policy.satisfyingAchievementLevels.includes(dimension.achievementLevel),
  );
  if (satisfying.length > 0) {
    return result(
      policy,
      input.competencyRef,
      "SATISFIED",
      "FRESH_STRONG",
      Math.min(...satisfying.map(({ boundary }) => boundary)),
    );
  }
  const weak = decisive.filter(({ dimension }) => dimension.condition === "WEAK");
  if (weak.length > 0) {
    return result(
      policy,
      input.competencyRef,
      "BLOCKED",
      "FRESH_WEAK",
      Math.min(...weak.map(({ boundary }) => boundary)),
    );
  }
  return result(policy, input.competencyRef, "UNKNOWN", "NO_DECISIVE_FRESH_STATE");
}
