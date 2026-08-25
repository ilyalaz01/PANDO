import {
  parseInstant,
  toCanonicalInstant,
  type EvaluationClock,
} from "../../../shared/domain/utc-instant";
import {
  READINESS_ENGINE_VERSION,
  ReadinessInputError,
  type CalculateTargetReadinessInput,
  type EstimateConfidence,
  type NodeRequirementMember,
  type ReadinessBlocker,
  type ReadinessDimensionInput,
  type ReadinessPolicy,
  type RequirementMember,
  type RequirementRule,
  type RuleEvaluation,
  type TargetReadinessSnapshot,
} from "./readiness-types";

const EPSILON = 1e-12;
const OBJECTIVE_DIMENSIONS = ["KNOWLEDGE", "RECALL", "APPLICATION", "INTERVIEW_EXECUTION"] as const;
const ACHIEVEMENT_LEVELS = ["NOT_STARTED", "COMPLETED", "VERIFIED", "MASTERED"] as const;
const REQUIRED_LEVELS = ["COMPLETED", "VERIFIED", "MASTERED"] as const;
const ESTIMATE_CONFIDENCES = ["LOW", "MEDIUM", "HIGH"] as const;
const FRESHNESS_VALUES = ["FRESH", "STALE", "UNKNOWN"] as const;
const REQUIREMENT_KINDS = [
  "ALL",
  "ANY",
  "K_OF_N",
  "WEIGHTED_THRESHOLD",
  "MANDATORY_FLOOR",
] as const;
const MEMBER_TYPES = ["NODE", "RULE"] as const;

interface EvaluatedInterval {
  readonly lower: number;
  readonly upper: number;
  readonly coverage: number;
  readonly requiredConfidences: readonly EstimateConfidence[];
  readonly witnessMemberKeys: readonly string[];
}

interface EvaluatedRule extends EvaluatedInterval {
  readonly threshold: number;
  readonly outcome: RuleEvaluation["outcome"];
}

interface EvaluatedMember {
  readonly memberKey: string;
  readonly interval: EvaluatedInterval;
}

function fail(message: string): never {
  throw new ReadinessInputError(message);
}

function requireIdentifier(value: string, fieldName: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(`${fieldName} must not be empty`);
  }
}

function requireUnitInterval(value: number, fieldName: string, allowZero = true): void {
  if (!Number.isFinite(value) || value > 1 || (allowZero ? value < 0 : value <= 0)) {
    fail(`${fieldName} must be ${allowZero ? "between 0 and 1" : "above 0 and at most 1"}`);
  }
}

function requireEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fieldName: string,
): asserts value is T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    fail(`${fieldName} has an unsupported value`);
  }
}

function requireExactKeys(
  value: unknown,
  expectedKeys: readonly string[],
  fieldName: string,
): asserts value is Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${fieldName} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${fieldName} must contain exactly: ${expected.join(", ")}`);
  }
}

function parseReadinessInstant(value: string, fieldName: string): number {
  try {
    return parseInstant(value, fieldName);
  } catch (error) {
    fail(String(error));
  }
}

function rounded(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000_000_000) / 1_000_000_000_000;
}

function validatePolicy(policy: ReadinessPolicy): void {
  requireIdentifier(policy.version, "policy.version");
  requireUnitInterval(policy.defaultTargetThreshold, "policy.defaultTargetThreshold", false);
  requireUnitInterval(policy.minimumCoverage, "policy.minimumCoverage");
  requireUnitInterval(policy.highConfidenceCoverage, "policy.highConfidenceCoverage");

  if (policy.highConfidenceCoverage < policy.minimumCoverage) {
    fail("policy.highConfidenceCoverage must be at least policy.minimumCoverage");
  }

  requireExactKeys(policy.freshStrength, ACHIEVEMENT_LEVELS, "policy.freshStrength");
  requireExactKeys(policy.staleStrength, ACHIEVEMENT_LEVELS, "policy.staleStrength");
  requireExactKeys(policy.requiredStrength, REQUIRED_LEVELS, "policy.requiredStrength");

  for (const level of ACHIEVEMENT_LEVELS) {
    const strength = policy.freshStrength[level];
    requireUnitInterval(strength, `policy.freshStrength.${level}`);
  }
  for (const level of ACHIEVEMENT_LEVELS) {
    const strength = policy.staleStrength[level];
    requireUnitInterval(strength, `policy.staleStrength.${level}`);
  }
  for (const level of REQUIRED_LEVELS) {
    const strength = policy.requiredStrength[level];
    requireUnitInterval(strength, `policy.requiredStrength.${level}`, false);
  }
}

function dimensionKey(member: NodeRequirementMember): string {
  return `${member.competencyId}\u001f${member.dimension}`;
}

function requirementMemberKey(member: RequirementMember): string {
  return member.memberType === "NODE"
    ? `NODE:${member.competencyId}:${member.dimension}:${member.requiredLevel}`
    : `RULE:${member.ruleId}`;
}

function mergedUnique(values: readonly (readonly string[])[]): readonly string[] {
  return [...new Set(values.flat())].sort();
}

function confidenceRank(confidences: readonly EstimateConfidence[]): number {
  if (confidences.includes("LOW")) return 1;
  if (confidences.includes("MEDIUM")) return 2;
  if (confidences.includes("HIGH")) return 3;
  return 0;
}

function compareDecisionWitnesses(left: EvaluatedMember, right: EvaluatedMember): number {
  return (
    right.interval.lower - left.interval.lower ||
    right.interval.upper - left.interval.upper ||
    right.interval.coverage - left.interval.coverage ||
    confidenceRank(right.interval.requiredConfidences) -
      confidenceRank(left.interval.requiredConfidences) ||
    left.memberKey.localeCompare(right.memberKey)
  );
}

function validateDimensions(
  dimensions: readonly ReadinessDimensionInput[],
  asOfMs: number,
): ReadonlyMap<string, ReadinessDimensionInput> {
  if (!Array.isArray(dimensions)) {
    fail("input.masteryDimensions must be an array");
  }
  const result = new Map<string, ReadinessDimensionInput>();

  for (const dimension of dimensions) {
    requireIdentifier(dimension.competencyId, "masteryDimensions.competencyId");
    requireEnum(dimension.dimension, OBJECTIVE_DIMENSIONS, "masteryDimensions.dimension");
    requireEnum(dimension.value, ["KNOWN", "UNKNOWN"] as const, "masteryDimensions.value");
    requireEnum(
      dimension.achievementLevel,
      ACHIEVEMENT_LEVELS,
      "masteryDimensions.achievementLevel",
    );
    requireEnum(dimension.freshness, FRESHNESS_VALUES, "masteryDimensions.freshness");
    if (dimension.confidence !== null) {
      requireEnum(dimension.confidence, ESTIMATE_CONFIDENCES, "masteryDimensions.confidence");
    }
    const stateAsOf = parseReadinessInstant(
      dimension.calculatedAsOf,
      `mastery dimension ${dimension.competencyId}/${dimension.dimension} calculatedAsOf`,
    );
    if (stateAsOf !== asOfMs) {
      fail(
        `mastery dimension ${dimension.competencyId}/${dimension.dimension} must be recalculated at clock.asOf`,
      );
    }

    if (
      (dimension.value === "UNKNOWN" &&
        (dimension.freshness !== "UNKNOWN" ||
          dimension.confidence !== null ||
          dimension.achievementLevel !== "NOT_STARTED")) ||
      (dimension.value === "KNOWN" &&
        (dimension.freshness === "UNKNOWN" || dimension.confidence === null))
    ) {
      fail(
        `mastery dimension ${dimension.competencyId}/${dimension.dimension} has inconsistent Unknown metadata`,
      );
    }

    const key = dimensionKey({
      memberType: "NODE",
      competencyId: dimension.competencyId,
      dimension: dimension.dimension,
      requiredLevel: "COMPLETED",
    });
    if (result.has(key)) {
      fail(`duplicate mastery dimension ${dimension.competencyId}/${dimension.dimension}`);
    }
    result.set(key, dimension);
  }

  return result;
}

function membersForRule(rule: RequirementRule): readonly RequirementMember[] {
  if (rule.kind === "MANDATORY_FLOOR") {
    return [rule.member];
  }
  if (rule.kind === "WEIGHTED_THRESHOLD") {
    return rule.members.map(({ member }) => member);
  }
  return rule.members;
}

function validateRules(
  rules: readonly RequirementRule[],
  rootRuleId: string,
): ReadonlyMap<string, RequirementRule> {
  if (!Array.isArray(rules)) {
    fail("input.rules must be an array");
  }
  const byId = new Map<string, RequirementRule>();

  for (const rule of rules) {
    requireIdentifier(rule.ruleId, "rule.ruleId");
    requireEnum(rule.kind, REQUIREMENT_KINDS, `rule ${rule.ruleId} kind`);
    if (rule.kind !== "MANDATORY_FLOOR" && !Array.isArray(rule.members)) {
      fail(`rule ${rule.ruleId} members must be an array`);
    }
    if (rule.kind === "MANDATORY_FLOOR" && !rule.member) {
      fail(`rule ${rule.ruleId} requires a member`);
    }
    if (byId.has(rule.ruleId)) {
      fail(`duplicate ruleId ${rule.ruleId}`);
    }

    if (rule.kind !== "MANDATORY_FLOOR" && rule.members.length === 0) {
      fail(`rule ${rule.ruleId} must contain at least one member`);
    }
    if (
      rule.kind === "K_OF_N" &&
      (!Number.isSafeInteger(rule.requiredCount) ||
        rule.requiredCount < 1 ||
        rule.requiredCount > rule.members.length)
    ) {
      fail(`rule ${rule.ruleId} has invalid requiredCount`);
    }
    if (rule.kind === "WEIGHTED_THRESHOLD") {
      requireUnitInterval(rule.threshold, `rule ${rule.ruleId} threshold`, false);
      for (const weightedMember of rule.members) {
        if (!Number.isFinite(weightedMember.weight) || weightedMember.weight <= 0) {
          fail(`rule ${rule.ruleId} weights must be positive finite numbers`);
        }
      }
      const totalWeight = rule.members.reduce(
        (sum: number, member: { readonly weight: number }) => sum + member.weight,
        0,
      );
      if (!Number.isFinite(totalWeight) || totalWeight <= 0) {
        fail(`rule ${rule.ruleId} total weight must be positive and finite`);
      }
    }

    byId.set(rule.ruleId, rule);
  }

  requireIdentifier(rootRuleId, "input.rootRuleId");
  if (!byId.has(rootRuleId)) {
    fail(`root rule ${rootRuleId} does not exist`);
  }

  for (const rule of rules) {
    const seenMembers = new Set<string>();
    for (const member of membersForRule(rule)) {
      requireEnum(member.memberType, MEMBER_TYPES, `rule ${rule.ruleId} memberType`);
      if (member.memberType === "NODE") {
        requireIdentifier(member.competencyId, `rule ${rule.ruleId} competencyId`);
        requireEnum(member.dimension, OBJECTIVE_DIMENSIONS, `rule ${rule.ruleId} dimension`);
        requireEnum(member.requiredLevel, REQUIRED_LEVELS, `rule ${rule.ruleId} requiredLevel`);
      } else {
        requireIdentifier(member.ruleId, `rule ${rule.ruleId} referenced ruleId`);
        if (!byId.has(member.ruleId)) {
          fail(`rule ${rule.ruleId} references missing rule ${member.ruleId}`);
        }
      }

      const key = requirementMemberKey(member);
      if (seenMembers.has(key)) {
        fail(`rule ${rule.ruleId} contains duplicate semantic member ${key}`);
      }
      seenMembers.add(key);
    }
  }

  return byId;
}

function evaluateLeaf(
  member: NodeRequirementMember,
  dimensions: ReadonlyMap<string, ReadinessDimensionInput>,
  policy: ReadinessPolicy,
): EvaluatedInterval {
  const state = dimensions.get(dimensionKey(member));
  if (!state || state.value === "UNKNOWN") {
    return {
      lower: 0,
      upper: 1,
      coverage: 0,
      requiredConfidences: [],
      witnessMemberKeys: [requirementMemberKey(member)],
    };
  }

  const currentStrength =
    state.freshness === "STALE"
      ? policy.staleStrength[state.achievementLevel]
      : policy.freshStrength[state.achievementLevel];
  const requiredStrength = policy.requiredStrength[member.requiredLevel];
  const attainment = rounded(Math.min(1, currentStrength / requiredStrength));

  return {
    lower: attainment,
    upper: attainment,
    coverage: 1,
    requiredConfidences: state.confidence ? [state.confidence] : [],
    witnessMemberKeys: [requirementMemberKey(member)],
  };
}

function average(values: readonly number[]): number {
  return rounded(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function weightedAverage(values: readonly number[], weights: readonly number[]): number {
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  return rounded(
    values.reduce((sum, value, index) => sum + value * weights[index]!, 0) / totalWeight,
  );
}

function ruleThreshold(rule: RequirementRule, isRoot: boolean, targetThreshold: number): number {
  if (rule.kind === "MANDATORY_FLOOR") {
    return 1;
  }
  if (isRoot) {
    return targetThreshold;
  }
  return rule.kind === "WEIGHTED_THRESHOLD" ? rule.threshold : 1;
}

function ruleOutcome(interval: EvaluatedInterval, threshold: number): RuleEvaluation["outcome"] {
  if (interval.lower + EPSILON >= threshold) {
    return "SATISFIED";
  }
  if (interval.upper + EPSILON < threshold) {
    return "FAILED";
  }
  return "UNRESOLVED";
}

export function calculateTargetReadiness(
  input: CalculateTargetReadinessInput,
  policy: ReadinessPolicy,
  clock: EvaluationClock,
): TargetReadinessSnapshot {
  requireIdentifier(input.targetProfileVersionId, "input.targetProfileVersionId");
  requireIdentifier(input.inputWatermark, "input.inputWatermark");
  validatePolicy(policy);

  const asOfMs = parseReadinessInstant(clock.asOf, "clock.asOf");
  const targetThreshold = input.targetThreshold ?? policy.defaultTargetThreshold;
  requireUnitInterval(targetThreshold, "input.targetThreshold", false);

  const rules = validateRules(input.rules, input.rootRuleId);
  const rootRule = rules.get(input.rootRuleId)!;
  if (rootRule.kind === "WEIGHTED_THRESHOLD" && rootRule.threshold !== targetThreshold) {
    fail("root WEIGHTED_THRESHOLD threshold must equal the effective target threshold");
  }
  const dimensions = validateDimensions(input.masteryDimensions, asOfMs);
  const memo = new Map<string, EvaluatedRule>();
  const visiting = new Set<string>();

  function evaluateMember(member: RequirementMember): EvaluatedMember {
    const memberKey = requirementMemberKey(member);
    if (member.memberType === "NODE") {
      return { memberKey, interval: evaluateLeaf(member, dimensions, policy) };
    }

    return {
      memberKey,
      interval: asRuleMemberInterval(evaluateRule(member.ruleId)),
    };
  }

  function evaluateRule(ruleId: string): EvaluatedRule {
    const cached = memo.get(ruleId);
    if (cached) {
      return cached;
    }
    if (visiting.has(ruleId)) {
      fail(`requirement rule cycle reaches ${ruleId}`);
    }

    const rule = rules.get(ruleId)!;
    visiting.add(ruleId);

    let result: EvaluatedInterval;
    if (rule.kind === "MANDATORY_FLOOR") {
      result = evaluateMember(rule.member).interval;
    } else {
      const childResults =
        rule.kind === "WEIGHTED_THRESHOLD"
          ? rule.members.map(({ member }) => evaluateMember(member))
          : rule.members.map(evaluateMember);
      const lowers = childResults.map(({ interval }) => interval.lower);
      const uppers = childResults.map(({ interval }) => interval.upper);
      const witnessSelection =
        rule.kind === "ANY"
          ? [[...childResults].sort(compareDecisionWitnesses)[0]!]
          : rule.kind === "K_OF_N"
            ? [...childResults].sort(compareDecisionWitnesses).slice(0, rule.requiredCount)
            : childResults;
      const requiredConfidences = [
        ...new Set(witnessSelection.flatMap(({ interval }) => interval.requiredConfidences)),
      ].sort();
      const witnessMemberKeys = mergedUnique(
        witnessSelection.map(({ interval }) => interval.witnessMemberKeys),
      );

      if (rule.kind === "ALL") {
        result = {
          lower: Math.min(...lowers),
          upper: Math.min(...uppers),
          coverage: average(childResults.map(({ interval }) => interval.coverage)),
          requiredConfidences,
          witnessMemberKeys,
        };
      } else if (rule.kind === "ANY") {
        result = {
          lower: Math.max(...lowers),
          upper: Math.max(...uppers),
          coverage: witnessSelection[0]!.interval.coverage,
          requiredConfidences,
          witnessMemberKeys,
        };
      } else if (rule.kind === "K_OF_N") {
        const lower = [...lowers].sort((left, right) => right - left)[rule.requiredCount - 1]!;
        const upper = [...uppers].sort((left, right) => right - left)[rule.requiredCount - 1]!;
        result = {
          lower,
          upper,
          coverage: average(witnessSelection.map(({ interval }) => interval.coverage)),
          requiredConfidences,
          witnessMemberKeys,
        };
      } else {
        const weights = rule.members.map(({ weight }) => weight);
        result = {
          lower: weightedAverage(lowers, weights),
          upper: weightedAverage(uppers, weights),
          coverage: weightedAverage(
            childResults.map(({ interval }) => interval.coverage),
            weights,
          ),
          requiredConfidences,
          witnessMemberKeys,
        };
      }
    }

    const normalized: EvaluatedInterval = {
      ...result,
      lower: rounded(result.lower),
      upper: rounded(result.upper),
      coverage: rounded(result.coverage),
    };
    const threshold = ruleThreshold(rule, ruleId === input.rootRuleId, targetThreshold);
    const evaluated: EvaluatedRule = {
      ...normalized,
      threshold,
      outcome: ruleOutcome(normalized, threshold),
    };
    visiting.delete(ruleId);
    memo.set(ruleId, evaluated);
    return evaluated;
  }
  const root = evaluateRule(input.rootRuleId);
  if (memo.size !== rules.size) {
    const unreachable = [...rules.keys()].filter((ruleId) => !memo.has(ruleId)).sort();
    fail(`unreachable requirement rules: ${unreachable.join(", ")}`);
  }

  const ruleEvaluations: RuleEvaluation[] = [...rules.values()]
    .sort((left, right) => left.ruleId.localeCompare(right.ruleId))
    .map((rule) => {
      const evaluated = memo.get(rule.ruleId)!;
      return {
        ruleId: rule.ruleId,
        kind: rule.kind,
        lower: evaluated.lower,
        upper: evaluated.upper,
        coverage: evaluated.coverage,
        threshold: evaluated.threshold,
        outcome: evaluated.outcome,
        witnessMemberKeys: evaluated.witnessMemberKeys,
      };
    });

  const floorEvaluations = ruleEvaluations.filter(({ kind }) => kind === "MANDATORY_FLOOR");
  const blockers: ReadinessBlocker[] = floorEvaluations
    .filter(({ outcome }) => outcome !== "SATISFIED")
    .map((floor) => ({
      code: floor.outcome === "FAILED" ? "MANDATORY_FLOOR_FAILED" : "MANDATORY_FLOOR_UNKNOWN",
      ruleId: floor.ruleId,
      lower: floor.lower,
      upper: floor.upper,
    }));

  if (root.lower + EPSILON < targetThreshold) {
    blockers.push({
      code: "AGGREGATE_BELOW_THRESHOLD",
      ruleId: input.rootRuleId,
      lower: root.lower,
      upper: root.upper,
    });
  }

  const hasFailedFloor = floorEvaluations.some(({ outcome }) => outcome === "FAILED");
  const hasUnknownFloor = floorEvaluations.some(({ outcome }) => outcome === "UNRESOLVED");
  const allRequirementsKnown = root.coverage + EPSILON >= 1;

  let status: TargetReadinessSnapshot["status"];
  if (hasFailedFloor || (allRequirementsKnown && root.upper + EPSILON < targetThreshold)) {
    status = "NOT_READY";
  } else if (hasUnknownFloor || root.coverage + EPSILON < policy.minimumCoverage) {
    status = "INSUFFICIENT_EVIDENCE";
  } else if (root.lower + EPSILON >= targetThreshold) {
    status = "READY";
  } else {
    status = "DEVELOPING";
  }

  const hasLowRequiredConfidence = root.requiredConfidences.includes("LOW");
  const confidence: EstimateConfidence =
    root.coverage + EPSILON < policy.minimumCoverage || hasUnknownFloor
      ? "LOW"
      : root.coverage + EPSILON < policy.highConfidenceCoverage || hasLowRequiredConfidence
        ? "MEDIUM"
        : "HIGH";

  return {
    engineVersion: READINESS_ENGINE_VERSION,
    policyVersion: policy.version,
    targetProfileVersionId: input.targetProfileVersionId,
    inputWatermark: input.inputWatermark,
    calculatedAsOf: toCanonicalInstant(asOfMs),
    targetThreshold,
    lower: root.lower,
    upper: root.upper,
    coverage: root.coverage,
    status,
    confidence,
    blockers: blockers.sort(
      (left, right) =>
        left.ruleId.localeCompare(right.ruleId) || left.code.localeCompare(right.code),
    ),
    ruleEvaluations,
    explanationCodes: [
      `STATUS_${status}`,
      root.lower === root.upper ? "POINT_ESTIMATE" : "UNKNOWN_PRESERVED_AS_INTERVAL",
      "MANDATORY_FLOORS_EVALUATED_FIRST",
    ],
  };
}

function asRuleMemberInterval(rule: EvaluatedRule): EvaluatedInterval {
  const satisfaction =
    rule.outcome === "SATISFIED"
      ? { lower: 1, upper: 1 }
      : rule.outcome === "FAILED"
        ? { lower: 0, upper: 0 }
        : { lower: 0, upper: 1 };

  return {
    ...satisfaction,
    coverage: rule.coverage,
    requiredConfidences: rule.requiredConfidences,
    witnessMemberKeys: rule.witnessMemberKeys,
  };
}
