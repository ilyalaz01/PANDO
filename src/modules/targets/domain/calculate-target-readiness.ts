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

interface EvaluatedInterval {
  readonly lower: number;
  readonly upper: number;
  readonly coverage: number;
  readonly requiredConfidences: readonly EstimateConfidence[];
}

function fail(message: string): never {
  throw new ReadinessInputError(message);
}

function requireIdentifier(value: string, fieldName: string): void {
  if (value.trim().length === 0) {
    fail(`${fieldName} must not be empty`);
  }
}

function requireUnitInterval(value: number, fieldName: string, allowZero = true): void {
  if (!Number.isFinite(value) || value > 1 || (allowZero ? value < 0 : value <= 0)) {
    fail(`${fieldName} must be ${allowZero ? "between 0 and 1" : "above 0 and at most 1"}`);
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

  for (const [level, strength] of Object.entries(policy.freshStrength)) {
    requireUnitInterval(strength, `policy.freshStrength.${level}`);
  }
  for (const [level, strength] of Object.entries(policy.staleStrength)) {
    requireUnitInterval(strength, `policy.staleStrength.${level}`);
  }
  for (const [level, strength] of Object.entries(policy.requiredStrength)) {
    requireUnitInterval(strength, `policy.requiredStrength.${level}`, false);
  }
}

function dimensionKey(member: NodeRequirementMember): string {
  return `${member.competencyId}\u001f${member.dimension}`;
}

function validateDimensions(
  dimensions: readonly ReadinessDimensionInput[],
  asOfMs: number,
): ReadonlyMap<string, ReadinessDimensionInput> {
  const result = new Map<string, ReadinessDimensionInput>();

  for (const dimension of dimensions) {
    requireIdentifier(dimension.competencyId, "masteryDimensions.competencyId");
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
        (dimension.freshness !== "UNKNOWN" || dimension.confidence !== null)) ||
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
  const byId = new Map<string, RequirementRule>();

  for (const rule of rules) {
    requireIdentifier(rule.ruleId, "rule.ruleId");
    if (byId.has(rule.ruleId)) {
      fail(`duplicate ruleId ${rule.ruleId}`);
    }

    if (rule.kind !== "MANDATORY_FLOOR" && rule.members.length === 0) {
      fail(`rule ${rule.ruleId} must contain at least one member`);
    }
    if (
      rule.kind === "K_OF_N" &&
      (!Number.isInteger(rule.requiredCount) ||
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
    }

    byId.set(rule.ruleId, rule);
  }

  requireIdentifier(rootRuleId, "input.rootRuleId");
  if (!byId.has(rootRuleId)) {
    fail(`root rule ${rootRuleId} does not exist`);
  }

  for (const rule of rules) {
    for (const member of membersForRule(rule)) {
      if (member.memberType === "RULE" && !byId.has(member.ruleId)) {
        fail(`rule ${rule.ruleId} references missing rule ${member.ruleId}`);
      }
      if (member.memberType === "NODE") {
        requireIdentifier(member.competencyId, `rule ${rule.ruleId} competencyId`);
      }
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

function ruleThreshold(rule: RequirementRule): number {
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
  const dimensions = validateDimensions(input.masteryDimensions, asOfMs);
  const memo = new Map<string, EvaluatedInterval>();
  const visiting = new Set<string>();

  const evaluateMember = (member: RequirementMember): EvaluatedInterval =>
    member.memberType === "NODE"
      ? evaluateLeaf(member, dimensions, policy)
      : evaluateRule(member.ruleId);

  const evaluateRule = (ruleId: string): EvaluatedInterval => {
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
      result = evaluateMember(rule.member);
    } else {
      const childResults =
        rule.kind === "WEIGHTED_THRESHOLD"
          ? rule.members.map(({ member }) => evaluateMember(member))
          : rule.members.map(evaluateMember);
      const lowers = childResults.map(({ lower }) => lower);
      const uppers = childResults.map(({ upper }) => upper);
      const coverages = childResults.map(({ coverage }) => coverage);
      const requiredConfidences = childResults.flatMap(
        ({ requiredConfidences: confidences }) => confidences,
      );

      if (rule.kind === "ALL") {
        result = {
          lower: Math.min(...lowers),
          upper: Math.min(...uppers),
          coverage: average(coverages),
          requiredConfidences,
        };
      } else if (rule.kind === "ANY") {
        result = {
          lower: Math.max(...lowers),
          upper: Math.max(...uppers),
          coverage: average(coverages),
          requiredConfidences,
        };
      } else if (rule.kind === "K_OF_N") {
        const lower = [...lowers].sort((left, right) => right - left)[rule.requiredCount - 1]!;
        const upper = [...uppers].sort((left, right) => right - left)[rule.requiredCount - 1]!;
        result = {
          lower,
          upper,
          coverage: average(coverages),
          requiredConfidences,
        };
      } else {
        const weights = rule.members.map(({ weight }) => weight);
        result = {
          lower: weightedAverage(lowers, weights),
          upper: weightedAverage(uppers, weights),
          coverage: weightedAverage(coverages, weights),
          requiredConfidences,
        };
      }
    }

    const normalized = {
      ...result,
      lower: rounded(result.lower),
      upper: rounded(result.upper),
      coverage: rounded(result.coverage),
    };
    visiting.delete(ruleId);
    memo.set(ruleId, normalized);
    return normalized;
  };

  const root = evaluateRule(input.rootRuleId);
  if (memo.size !== rules.size) {
    const unreachable = [...rules.keys()].filter((ruleId) => !memo.has(ruleId)).sort();
    fail(`unreachable requirement rules: ${unreachable.join(", ")}`);
  }

  const ruleEvaluations: RuleEvaluation[] = [...rules.values()]
    .sort((left, right) => left.ruleId.localeCompare(right.ruleId))
    .map((rule) => {
      const interval = memo.get(rule.ruleId)!;
      const threshold = ruleThreshold(rule);
      return {
        ruleId: rule.ruleId,
        kind: rule.kind,
        lower: interval.lower,
        upper: interval.upper,
        coverage: interval.coverage,
        threshold,
        outcome: ruleOutcome(interval, threshold),
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
