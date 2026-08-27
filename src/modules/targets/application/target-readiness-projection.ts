import { createHash } from "node:crypto";

import {
  calculateMasteryReadinessValidUntilV1,
  MASTERY_READINESS_ENGINE_VERSION as MASTERY_ENGINE_VERSION,
  MASTERY_READINESS_OBJECTIVE_DIMENSIONS as OBJECTIVE_DIMENSIONS,
  MASTERY_READINESS_SOURCE_LIMITS_V1,
  masteryReadinessPolicyFingerprintManifestV1,
  synchronizeMasteryReadinessInputsV1,
  type MasteryReadinessAchievementLevel as AchievementLevel,
  type MasteryReadinessCompetencySourceV1,
  type MasteryReadinessDimensionInputV1,
  type MasteryReadinessEstimateConfidence as EstimateConfidence,
  type MasteryReadinessEvidenceInputV1 as MasteryEvidenceInput,
  type MasteryReadinessInputSetV1,
  type MasteryReadinessObjectiveDimension as ObjectiveDimension,
  type MasteryReadinessRequiredDimensionV1,
} from "../../mastery/application/synchronize-readiness-inputs";
import { calculateTargetReadiness } from "../domain/calculate-target-readiness";
import { READINESS_POLICY_V0_1 } from "../domain/readiness-policy-v0.1";
import {
  READINESS_ENGINE_VERSION,
  type ReadinessDimensionInput,
  type RequirementMember,
  type RequirementRule,
  type TargetReadinessSnapshot,
} from "../domain/readiness-types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const COMPETENCY_REF = /^competency:[a-z0-9][a-z0-9-]{1,100}$/u;
const DOMAIN_REF = /^domain:[a-z0-9][a-z0-9-]{1,100}$/u;
const GOAL_KEY = /^goal:[a-z0-9][a-z0-9-]{1,100}$/u;
const PROFILE_KEY = /^target:[a-z0-9][a-z0-9-]{1,100}$/u;
const RULE_KEY = /^rule:[a-z0-9][a-z0-9-]{1,100}$/u;
const NON_NEGATIVE_BIGINT = /^(0|[1-9][0-9]{0,18})$/u;
const POSITIVE_BIGINT = /^[1-9][0-9]{0,18}$/u;
const MAX_SIGNED_BIGINT = 9_223_372_036_854_775_807n;
const MAX_GOALS = 20;
const MAX_COMPETENCIES = 250;
const MAX_RULES_PER_GOAL = 500;
const MAX_MEMBERS_PER_RULE = 500;
const MAX_REQUIRED_LEAVES_TOTAL = 250;

const REQUIRED_LEVELS = ["COMPLETED", "VERIFIED", "MASTERED"] as const;
const RULE_TYPES = ["ALL", "ANY", "K_OF_N", "WEIGHTED_THRESHOLD", "MANDATORY_FLOOR"] as const;
const CRITICALITIES = ["MANDATORY", "PREFERRED", "DIFFERENTIATING"] as const;
const NODE_SCOPES = ["canonical", "workspace_overlay"] as const;
const NODE_KINDS = ["COMPETENCY", "DOMAIN"] as const;
const EVENT_NAMES = [
  "targets.readiness_goal_created",
  "mastery.competency_state_changed",
  "targets.readiness_refresh_scheduled",
] as const;

type RequiredLevel = (typeof REQUIRED_LEVELS)[number];
type RuleType = (typeof RULE_TYPES)[number];
type Criticality = (typeof CRITICALITIES)[number];
type NodeScope = (typeof NODE_SCOPES)[number];
type NodeKind = (typeof NODE_KINDS)[number];

interface ContractIdentity {
  readonly name: string;
  readonly version: string;
}

interface CurrentPointerV1 {
  readonly snapshotId: string;
  readonly projectionVersion: string;
  readonly sourceEvidenceWatermark: string;
  readonly calculatedAsOf: string;
  readonly validUntil: string | null;
}

interface TransportNodeMemberV1 {
  readonly memberOrder: number;
  readonly memberType: "NODE";
  readonly nodeScope: NodeScope;
  readonly nodeKind: NodeKind;
  readonly nodeRef: string;
  readonly dimension: ObjectiveDimension;
  readonly requiredLevel: RequiredLevel;
  readonly weight: number | null;
}

interface TransportRuleMemberV1 {
  readonly memberOrder: number;
  readonly memberType: "RULE";
  readonly referencedRuleKey: string;
  readonly weight: number | null;
}

type TransportMemberV1 = TransportNodeMemberV1 | TransportRuleMemberV1;

interface TransportRuleV1 {
  readonly ruleKey: string;
  readonly ruleType: RuleType;
  readonly criticality: Criticality;
  readonly requiredCount: number | null;
  readonly threshold: number | null;
  readonly members: readonly TransportMemberV1[];
}

export interface TargetReadinessRequiredLeafV1 {
  readonly competencyRef: string;
  readonly dimension: ObjectiveDimension;
  readonly requiredLevel: RequiredLevel;
  readonly owningRuleKeys: readonly string[];
}

interface TargetReadinessGoalInputV1 {
  readonly readinessGoalId: string;
  readonly readinessGoalKey: string;
  readonly goalAggregateVersion: string;
  readonly profileVersionId: string;
  readonly profileVersionKey: string;
  readonly rootRuleKey: string;
  readonly targetThreshold: number;
  readonly currentPointer: CurrentPointerV1 | null;
  readonly rules: readonly TransportRuleV1[];
  readonly requiredLeaves: readonly TargetReadinessRequiredLeafV1[];
}

interface MasteryReadinessCalculationSourceV1 {
  readonly contract: ContractIdentity;
  readonly sourceEvidenceWatermark: string;
  readonly masteryEngineVersion: string;
  readonly masteryPolicyVersion: string;
  readonly competencies: readonly MasteryReadinessCompetencySourceV1[];
}

export interface TargetReadinessProjectionInputV1 {
  readonly contract: ContractIdentity;
  readonly deliveryId: string;
  readonly eventId: string;
  readonly eventPosition: string;
  readonly workspaceId: string;
  readonly eventName: (typeof EVENT_NAMES)[number];
  readonly calculatedAsOf: string;
  readonly sourceEvidenceWatermark: string;
  readonly projectionGeneration: "live-v1";
  readonly projectionError: "UNSUPPORTED_DOMAIN_REQUIREMENT" | null;
  readonly goals: readonly TargetReadinessGoalInputV1[];
  readonly masterySource: MasteryReadinessCalculationSourceV1;
}

export type { MasteryReadinessDimensionInputV1, MasteryReadinessInputSetV1 };

export type TargetReadinessGapCode =
  "FAILED_MANDATORY_FLOOR" | "UNKNOWN_MANDATORY_FLOOR" | "UNKNOWN_REQUIREMENT" | "KNOWN_SHORTFALL";

export interface TargetReadinessGapV1 {
  readonly gapCode: TargetReadinessGapCode;
  readonly competencyRef: string;
  readonly dimension: ObjectiveDimension;
  readonly requiredLevel: RequiredLevel;
  readonly owningRuleKeys: readonly string[];
  readonly freshness: "FRESH" | "STALE" | "UNKNOWN";
  readonly confidence: EstimateConfidence | null;
}

export interface TargetReadinessProjectionResultV1 {
  readonly readinessGoalId: string;
  readonly profileVersionId: string;
  readonly projectionGeneration: "live-v1";
  readonly inputFingerprint: string;
  readonly sourceEvidenceWatermark: string;
  readonly calculatedAsOf: string;
  readonly validUntil: string | null;
  readonly masteryEngineVersion: typeof MASTERY_ENGINE_VERSION;
  readonly masteryPolicyVersion: string;
  readonly readiness: TargetReadinessSnapshot;
  readonly gaps: readonly TargetReadinessGapV1[];
  readonly inputs: readonly (TargetReadinessRequiredLeafV1 & MasteryReadinessDimensionInputV1)[];
}

export class TargetReadinessProjectionContractError extends TypeError {
  constructor(message = "Target readiness projection input did not match its transport contract.") {
    super(message);
    this.name = "TargetReadinessProjectionContractError";
  }
}

export class UnsupportedDomainRequirementError extends Error {
  readonly code = "UNSUPPORTED_DOMAIN_REQUIREMENT";

  constructor() {
    super("DOMAIN target requirements are not supported by readiness-engine/0.1.0.");
    this.name = "UnsupportedDomainRequirementError";
  }
}

function fail(label: string): never {
  throw new TargetReadinessProjectionContractError(`${label} is invalid`);
}

function exactObject(
  value: unknown,
  expectedKeys: readonly string[],
  label: string,
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(label);
  const object = value as Readonly<Record<string, unknown>>;
  const actual = Object.keys(object).sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(label);
  }
  return object;
}

function boundedArray(value: unknown, maximum: number, label: string): readonly unknown[] {
  if (!Array.isArray(value) || value.length > maximum) fail(label);
  return value;
}

function matching(value: unknown, pattern: RegExp, label: string): string {
  if (typeof value !== "string" || !pattern.test(value)) fail(label);
  return value;
}

function boundedString(value: unknown, maximum: number, label: string): string {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum) fail(label);
  return value;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) fail(label);
  return value as T;
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") fail(label);
  return value;
}

function probability(value: unknown, label: string, allowZero = true): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value > 1 ||
    (allowZero ? value < 0 : value <= 0)
  ) {
    fail(label);
  }
  return value;
}

function positiveInteger(value: unknown, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum) {
    fail(label);
  }
  return value as number;
}

function positiveNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) fail(label);
  return value;
}

function bigintString(value: unknown, positive: boolean, label: string): string {
  const result = matching(value, positive ? POSITIVE_BIGINT : NON_NEGATIVE_BIGINT, label);
  if (BigInt(result) > MAX_SIGNED_BIGINT) fail(label);
  return result;
}

function instant(value: unknown, label: string): string {
  if (typeof value !== "string") fail(label);
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) fail(label);
  return new Date(milliseconds).toISOString();
}

function nullableInstant(value: unknown, label: string): string | null {
  return value === null ? null : instant(value, label);
}

function nullableNumber(value: unknown, label: string): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) fail(label);
  return value;
}

function contract(
  value: unknown,
  expectedName: string,
  expectedVersion: string,
  label: string,
): ContractIdentity {
  const item = exactObject(value, ["name", "version"], label);
  if (item.name !== expectedName || item.version !== expectedVersion) fail(label);
  return { name: expectedName, version: expectedVersion };
}

function currentPointer(value: unknown): CurrentPointerV1 | null {
  if (value === null) return null;
  const item = exactObject(
    value,
    ["snapshotId", "projectionVersion", "sourceEvidenceWatermark", "calculatedAsOf", "validUntil"],
    "currentPointer",
  );
  return {
    snapshotId: matching(item.snapshotId, UUID, "currentPointer.snapshotId"),
    projectionVersion: bigintString(
      item.projectionVersion,
      true,
      "currentPointer.projectionVersion",
    ),
    sourceEvidenceWatermark: bigintString(
      item.sourceEvidenceWatermark,
      false,
      "currentPointer.sourceEvidenceWatermark",
    ),
    calculatedAsOf: instant(item.calculatedAsOf, "currentPointer.calculatedAsOf"),
    validUntil: nullableInstant(item.validUntil, "currentPointer.validUntil"),
  };
}

function transportMember(value: unknown, index: number): TransportMemberV1 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`member[${index}]`);
  }
  const discriminator = (value as Readonly<Record<string, unknown>>).memberType;
  if (discriminator === "NODE") {
    const hasWeight = Object.hasOwn(value, "weight");
    const item = exactObject(
      value,
      [
        "memberOrder",
        "memberType",
        "nodeScope",
        "nodeKind",
        "nodeRef",
        "dimension",
        "requiredLevel",
        ...(hasWeight ? ["weight"] : []),
      ],
      `member[${index}]`,
    );
    const nodeKind = oneOf(item.nodeKind, NODE_KINDS, `member[${index}].nodeKind`);
    return {
      memberOrder: positiveInteger(item.memberOrder, 1_000_000, `member[${index}].memberOrder`),
      memberType: "NODE",
      nodeScope: oneOf(item.nodeScope, NODE_SCOPES, `member[${index}].nodeScope`),
      nodeKind,
      nodeRef: matching(
        item.nodeRef,
        nodeKind === "COMPETENCY" ? COMPETENCY_REF : DOMAIN_REF,
        `member[${index}].nodeRef`,
      ),
      dimension: oneOf(item.dimension, OBJECTIVE_DIMENSIONS, `member[${index}].dimension`),
      requiredLevel: oneOf(item.requiredLevel, REQUIRED_LEVELS, `member[${index}].requiredLevel`),
      weight: hasWeight ? positiveNumber(item.weight, `member[${index}].weight`) : null,
    };
  }
  if (discriminator === "RULE") {
    const hasWeight = Object.hasOwn(value, "weight");
    const item = exactObject(
      value,
      ["memberOrder", "memberType", "referencedRuleKey", ...(hasWeight ? ["weight"] : [])],
      `member[${index}]`,
    );
    return {
      memberOrder: positiveInteger(item.memberOrder, 1_000_000, `member[${index}].memberOrder`),
      memberType: "RULE",
      referencedRuleKey: matching(
        item.referencedRuleKey,
        RULE_KEY,
        `member[${index}].referencedRuleKey`,
      ),
      weight: hasWeight ? positiveNumber(item.weight, `member[${index}].weight`) : null,
    };
  }
  fail(`member[${index}].memberType`);
}

function transportRule(value: unknown, index: number): TransportRuleV1 {
  const item = exactObject(
    value,
    ["ruleKey", "ruleType", "criticality", "requiredCount", "threshold", "members"],
    `rules[${index}]`,
  );
  const ruleType = oneOf(item.ruleType, RULE_TYPES, `rules[${index}].ruleType`);
  const members = boundedArray(item.members, MAX_MEMBERS_PER_RULE, `rules[${index}].members`).map(
    transportMember,
  );
  if (
    members.length < 1 ||
    new Set(members.map(({ memberOrder }) => memberOrder)).size !== members.length
  ) {
    fail(`rules[${index}].members`);
  }
  const requiredCount =
    item.requiredCount === null
      ? null
      : positiveInteger(item.requiredCount, MAX_MEMBERS_PER_RULE, `rules[${index}].requiredCount`);
  const threshold = nullableNumber(item.threshold, `rules[${index}].threshold`);
  if (
    (ruleType === "K_OF_N" &&
      (requiredCount === null || requiredCount > members.length || threshold !== null)) ||
    (ruleType === "WEIGHTED_THRESHOLD" &&
      (requiredCount !== null ||
        threshold === null ||
        probability(threshold, "rule.threshold", false) !== threshold)) ||
    (!["K_OF_N", "WEIGHTED_THRESHOLD"].includes(ruleType) &&
      (requiredCount !== null || threshold !== null)) ||
    (ruleType === "WEIGHTED_THRESHOLD" && members.some(({ weight }) => weight === null)) ||
    (ruleType !== "WEIGHTED_THRESHOLD" && members.some(({ weight }) => weight !== null)) ||
    (ruleType === "MANDATORY_FLOOR" && (members.length !== 1 || members[0]?.memberType !== "NODE"))
  ) {
    fail(`rules[${index}]`);
  }
  return {
    ruleKey: matching(item.ruleKey, RULE_KEY, `rules[${index}].ruleKey`),
    ruleType,
    criticality: oneOf(item.criticality, CRITICALITIES, `rules[${index}].criticality`),
    requiredCount,
    threshold,
    members,
  };
}

function requiredLeaf(value: unknown, index: number): TargetReadinessRequiredLeafV1 {
  const item = exactObject(
    value,
    ["competencyRef", "dimension", "requiredLevel", "owningRuleKeys"],
    `requiredLeaves[${index}]`,
  );
  const owningRuleKeys = boundedArray(
    item.owningRuleKeys,
    MAX_RULES_PER_GOAL,
    `requiredLeaves[${index}].owningRuleKeys`,
  ).map((key, keyIndex) => matching(key, RULE_KEY, `owningRuleKeys[${keyIndex}]`));
  if (owningRuleKeys.length < 1 || new Set(owningRuleKeys).size !== owningRuleKeys.length) {
    fail(`requiredLeaves[${index}].owningRuleKeys`);
  }
  return {
    competencyRef: matching(
      item.competencyRef,
      COMPETENCY_REF,
      `requiredLeaves[${index}].competencyRef`,
    ),
    dimension: oneOf(item.dimension, OBJECTIVE_DIMENSIONS, `requiredLeaves[${index}].dimension`),
    requiredLevel: oneOf(
      item.requiredLevel,
      REQUIRED_LEVELS,
      `requiredLeaves[${index}].requiredLevel`,
    ),
    owningRuleKeys,
  };
}

function goal(value: unknown, index: number): TargetReadinessGoalInputV1 {
  const item = exactObject(
    value,
    [
      "readinessGoalId",
      "readinessGoalKey",
      "goalAggregateVersion",
      "profileVersionId",
      "profileVersionKey",
      "rootRuleKey",
      "targetThreshold",
      "currentPointer",
      "rules",
      "requiredLeaves",
    ],
    `goals[${index}]`,
  );
  const rules = boundedArray(item.rules, MAX_RULES_PER_GOAL, `goals[${index}].rules`).map(
    transportRule,
  );
  const requiredLeaves = boundedArray(
    item.requiredLeaves,
    MAX_REQUIRED_LEAVES_TOTAL,
    `goals[${index}].requiredLeaves`,
  ).map(requiredLeaf);
  const ruleKeys = new Set(rules.map(({ ruleKey }) => ruleKey));
  if (rules.length < 1 || ruleKeys.size !== rules.length) fail(`goals[${index}].rules`);
  const rootRuleKey = matching(item.rootRuleKey, RULE_KEY, `goals[${index}].rootRuleKey`);
  if (!ruleKeys.has(rootRuleKey)) fail(`goals[${index}].rootRuleKey`);
  for (const rule of rules) {
    for (const member of rule.members) {
      if (member.memberType === "RULE" && !ruleKeys.has(member.referencedRuleKey)) {
        fail(`goals[${index}].rules`);
      }
    }
  }
  for (const leaf of requiredLeaves) {
    if (leaf.owningRuleKeys.some((key) => !ruleKeys.has(key)))
      fail(`goals[${index}].requiredLeaves`);
  }
  const leafKeys = requiredLeaves.map(leafIdentity);
  if (new Set(leafKeys).size !== leafKeys.length) fail(`goals[${index}].requiredLeaves`);
  const expectedLeaves = new Map<string, Set<string>>();
  for (const rule of rules) {
    if (rule.ruleType === "MANDATORY_FLOOR" && rule.criticality !== "MANDATORY") {
      fail(`goals[${index}].rules`);
    }
    for (const member of rule.members) {
      if (member.memberType !== "NODE" || member.nodeKind !== "COMPETENCY") continue;
      const key = leafIdentity({
        competencyRef: member.nodeRef,
        dimension: member.dimension,
        requiredLevel: member.requiredLevel,
        owningRuleKeys: [],
      });
      const owners = expectedLeaves.get(key) ?? new Set<string>();
      owners.add(rule.ruleKey);
      expectedLeaves.set(key, owners);
    }
  }
  if (
    expectedLeaves.size !== requiredLeaves.length ||
    requiredLeaves.some((leaf) => {
      const owners = expectedLeaves.get(leafIdentity(leaf));
      const supplied = [...leaf.owningRuleKeys].sort();
      return (
        owners === undefined ||
        owners.size !== supplied.length ||
        [...owners].sort().some((owner, ownerIndex) => owner !== supplied[ownerIndex])
      );
    })
  ) {
    fail(`goals[${index}].requiredLeaves`);
  }
  return {
    readinessGoalId: matching(item.readinessGoalId, UUID, `goals[${index}].readinessGoalId`),
    readinessGoalKey: matching(item.readinessGoalKey, GOAL_KEY, `goals[${index}].readinessGoalKey`),
    goalAggregateVersion: bigintString(
      item.goalAggregateVersion,
      true,
      `goals[${index}].goalAggregateVersion`,
    ),
    profileVersionId: matching(item.profileVersionId, UUID, `goals[${index}].profileVersionId`),
    profileVersionKey: matching(
      item.profileVersionKey,
      PROFILE_KEY,
      `goals[${index}].profileVersionKey`,
    ),
    rootRuleKey,
    targetThreshold: probability(item.targetThreshold, `goals[${index}].targetThreshold`, false),
    currentPointer: currentPointer(item.currentPointer),
    rules,
    requiredLeaves,
  };
}

function evidence(value: unknown, index: number): MasteryEvidenceInput {
  const item = exactObject(
    value,
    [
      "evidenceId",
      "attemptId",
      "sourceId",
      "occurredAt",
      "dimension",
      "outcome",
      "engagement",
      "normalized",
      "invalidated",
      "observedResult",
      "mappingConfidence",
      "sourceReliability",
      "targetRelevant",
    ],
    `evidence[${index}]`,
  );
  if (typeof item.sourceId !== "string" || item.sourceId.length < 1 || item.sourceId.length > 200) {
    fail(`evidence[${index}].sourceId`);
  }
  return {
    evidenceId: matching(item.evidenceId, UUID, `evidence[${index}].evidenceId`),
    attemptId: matching(item.attemptId, UUID, `evidence[${index}].attemptId`),
    sourceId: item.sourceId,
    occurredAt: instant(item.occurredAt, `evidence[${index}].occurredAt`),
    dimension: oneOf(item.dimension, OBJECTIVE_DIMENSIONS, `evidence[${index}].dimension`),
    outcome: oneOf(item.outcome, ["SUCCESS", "FAILURE"] as const, `evidence[${index}].outcome`),
    engagement: oneOf(
      item.engagement,
      ["INDEPENDENT", "GUIDED", "PASSIVE"] as const,
      `evidence[${index}].engagement`,
    ),
    normalized: booleanValue(item.normalized, `evidence[${index}].normalized`),
    invalidated: booleanValue(item.invalidated, `evidence[${index}].invalidated`),
    observedResult: booleanValue(item.observedResult, `evidence[${index}].observedResult`),
    mappingConfidence: probability(item.mappingConfidence, `evidence[${index}].mappingConfidence`),
    sourceReliability: probability(item.sourceReliability, `evidence[${index}].sourceReliability`),
    targetRelevant: booleanValue(item.targetRelevant, `evidence[${index}].targetRelevant`),
  };
}

function masteryCompetency(value: unknown, index: number): MasteryReadinessCompetencySourceV1 {
  const item = exactObject(value, ["competencyRef", "evidence"], `competencies[${index}]`);
  const entries = boundedArray(
    item.evidence,
    MASTERY_READINESS_SOURCE_LIMITS_V1.evidencePerCompetency,
    `competencies[${index}].evidence`,
  ).map(evidence);
  if (new Set(entries.map(({ evidenceId }) => evidenceId)).size !== entries.length) {
    fail(`competencies[${index}].evidence`);
  }
  return {
    competencyRef: matching(
      item.competencyRef,
      COMPETENCY_REF,
      `competencies[${index}].competencyRef`,
    ),
    evidence: entries,
  };
}

function masterySource(value: unknown): MasteryReadinessCalculationSourceV1 {
  const item = exactObject(
    value,
    [
      "contract",
      "sourceEvidenceWatermark",
      "masteryEngineVersion",
      "masteryPolicyVersion",
      "competencies",
    ],
    "masterySource",
  );
  const competencies = boundedArray(
    item.competencies,
    MAX_COMPETENCIES,
    "masterySource.competencies",
  ).map(masteryCompetency);
  if (
    new Set(competencies.map(({ competencyRef }) => competencyRef)).size !== competencies.length ||
    competencies.reduce((count, competency) => count + competency.evidence.length, 0) >
      MASTERY_READINESS_SOURCE_LIMITS_V1.totalEvidence ||
    new Set(
      competencies.flatMap((competency) => competency.evidence.map(({ evidenceId }) => evidenceId)),
    ).size !== competencies.reduce((count, competency) => count + competency.evidence.length, 0)
  ) {
    fail("masterySource.competencies");
  }
  return {
    contract: contract(
      item.contract,
      "MasteryReadinessCalculationSourceV1",
      "1.0.0",
      "masterySource.contract",
    ),
    sourceEvidenceWatermark: bigintString(
      item.sourceEvidenceWatermark,
      false,
      "masterySource.sourceEvidenceWatermark",
    ),
    masteryEngineVersion: boundedString(
      item.masteryEngineVersion,
      200,
      "masterySource.masteryEngineVersion",
    ),
    masteryPolicyVersion: boundedString(
      item.masteryPolicyVersion,
      200,
      "masterySource.masteryPolicyVersion",
    ),
    competencies,
  };
}

export function decodeTargetReadinessProjectionInputV1(
  value: unknown,
): TargetReadinessProjectionInputV1 {
  const item = exactObject(
    value,
    [
      "contract",
      "deliveryId",
      "eventId",
      "eventPosition",
      "workspaceId",
      "eventName",
      "calculatedAsOf",
      "sourceEvidenceWatermark",
      "projectionGeneration",
      "projectionError",
      "goals",
      "masterySource",
    ],
    "TargetReadinessProjectionInputV1",
  );
  const goals = boundedArray(item.goals, MAX_GOALS, "goals").map(goal);
  if (
    new Set(goals.map(({ readinessGoalId }) => readinessGoalId)).size !== goals.length ||
    new Set(goals.map(({ readinessGoalKey }) => readinessGoalKey)).size !== goals.length ||
    goals.reduce((count, current) => count + current.requiredLeaves.length, 0) >
      MAX_REQUIRED_LEAVES_TOTAL
  ) {
    fail("goals");
  }
  const source = masterySource(item.masterySource);
  const sourceEvidenceWatermark = bigintString(
    item.sourceEvidenceWatermark,
    false,
    "sourceEvidenceWatermark",
  );
  if (source.sourceEvidenceWatermark !== sourceEvidenceWatermark) fail("sourceEvidenceWatermark");
  const projectionError =
    item.projectionError === null
      ? null
      : oneOf(item.projectionError, ["UNSUPPORTED_DOMAIN_REQUIREMENT"] as const, "projectionError");
  return {
    contract: contract(item.contract, "TargetReadinessProjectionInputV1", "1.0.0", "contract"),
    deliveryId: matching(item.deliveryId, UUID, "deliveryId"),
    eventId: matching(item.eventId, UUID, "eventId"),
    eventPosition: bigintString(item.eventPosition, true, "eventPosition"),
    workspaceId: matching(item.workspaceId, UUID, "workspaceId"),
    eventName: oneOf(item.eventName, EVENT_NAMES, "eventName"),
    calculatedAsOf: instant(item.calculatedAsOf, "calculatedAsOf"),
    sourceEvidenceWatermark,
    projectionGeneration:
      item.projectionGeneration === "live-v1" ? "live-v1" : fail("projectionGeneration"),
    projectionError,
    goals,
    masterySource: source,
  };
}

function transportMemberTuple(member: TransportMemberV1): readonly unknown[] {
  return member.memberType === "NODE"
    ? [
        member.memberOrder,
        member.memberType,
        member.nodeScope,
        member.nodeKind,
        member.nodeRef,
        member.dimension,
        member.requiredLevel,
        member.weight,
      ]
    : [member.memberOrder, member.memberType, member.referencedRuleKey, member.weight];
}

function inputTuple(
  input: TargetReadinessRequiredLeafV1 & MasteryReadinessDimensionInputV1,
): readonly unknown[] {
  return [
    input.competencyRef,
    input.dimension,
    input.requiredLevel,
    [...input.owningRuleKeys].sort(),
    input.calculatedAsOf,
    input.value,
    input.achievementLevel,
    input.freshness,
    input.confidence,
    input.lastMeaningfulEvidenceAt,
    [...input.supportingEvidenceIds].sort(),
    [...input.contradictingEvidenceIds].sort(),
  ];
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function leafIdentity(leaf: TargetReadinessRequiredLeafV1): string {
  return `${leaf.competencyRef}\u001f${leaf.dimension}\u001f${leaf.requiredLevel}`;
}

function inputIdentity(
  input: Pick<MasteryReadinessDimensionInputV1, "competencyRef" | "dimension">,
): string {
  return `${input.competencyRef}\u001f${input.dimension}`;
}

export function canonicalReadinessInputFingerprint(
  projection: TargetReadinessProjectionInputV1,
  goalInput: TargetReadinessGoalInputV1,
  inputs: readonly (TargetReadinessRequiredLeafV1 & MasteryReadinessDimensionInputV1)[],
): string {
  const rules = [...goalInput.rules]
    .sort((left, right) => compareText(left.ruleKey, right.ruleKey))
    .map((rule) => [
      rule.ruleKey,
      rule.ruleType,
      rule.criticality,
      rule.requiredCount,
      rule.threshold,
      [...rule.members]
        .sort(
          (left, right) =>
            left.memberOrder - right.memberOrder ||
            compareText(
              JSON.stringify(transportMemberTuple(left)),
              JSON.stringify(transportMemberTuple(right)),
            ),
        )
        .map(transportMemberTuple),
    ]);
  const orderedInputs = [...inputs]
    .sort((left, right) => compareText(leafIdentity(left), leafIdentity(right)))
    .map(inputTuple);
  const manifest = [
    "TargetReadinessInputV1",
    1,
    [
      projection.workspaceId,
      goalInput.readinessGoalId,
      goalInput.readinessGoalKey,
      goalInput.goalAggregateVersion,
    ],
    [
      goalInput.profileVersionId,
      goalInput.profileVersionKey,
      goalInput.rootRuleKey,
      goalInput.targetThreshold,
    ],
    projection.projectionGeneration,
    projection.sourceEvidenceWatermark,
    projection.calculatedAsOf,
    masteryReadinessPolicyFingerprintManifestV1(),
    [
      READINESS_ENGINE_VERSION,
      READINESS_POLICY_V0_1.version,
      READINESS_POLICY_V0_1.defaultTargetThreshold,
      READINESS_POLICY_V0_1.minimumCoverage,
      READINESS_POLICY_V0_1.highConfidenceCoverage,
      ["NOT_STARTED", "COMPLETED", "VERIFIED", "MASTERED"].map((level) => [
        level,
        READINESS_POLICY_V0_1.freshStrength[level as AchievementLevel],
        READINESS_POLICY_V0_1.staleStrength[level as AchievementLevel],
      ]),
      REQUIRED_LEVELS.map((level) => [level, READINESS_POLICY_V0_1.requiredStrength[level]]),
    ],
    rules,
    orderedInputs,
  ];
  return `readiness-input:${createHash("sha256").update(JSON.stringify(manifest), "utf8").digest("hex")}`;
}

function adaptMember(member: TransportMemberV1): RequirementMember {
  if (member.memberType === "RULE") {
    return { memberType: "RULE", ruleId: member.referencedRuleKey };
  }
  if (member.nodeKind === "DOMAIN") throw new UnsupportedDomainRequirementError();
  return {
    memberType: "NODE",
    competencyId: member.nodeRef,
    dimension: member.dimension,
    requiredLevel: member.requiredLevel,
  };
}

export function adaptTargetReadinessRules(
  rules: readonly TransportRuleV1[],
): readonly RequirementRule[] {
  return rules.map((rule): RequirementRule => {
    if (rule.ruleType === "MANDATORY_FLOOR") {
      const member = adaptMember(rule.members[0]!);
      if (member.memberType !== "NODE") throw new TargetReadinessProjectionContractError();
      return { ruleId: rule.ruleKey, kind: "MANDATORY_FLOOR", member };
    }
    if (rule.ruleType === "WEIGHTED_THRESHOLD") {
      return {
        ruleId: rule.ruleKey,
        kind: "WEIGHTED_THRESHOLD",
        threshold: rule.threshold!,
        members: rule.members.map((member) => ({
          member: adaptMember(member),
          weight: member.weight!,
        })),
      };
    }
    const members = rule.members.map(adaptMember);
    if (rule.ruleType === "K_OF_N") {
      return { ruleId: rule.ruleKey, kind: "K_OF_N", requiredCount: rule.requiredCount!, members };
    }
    return { ruleId: rule.ruleKey, kind: rule.ruleType, members };
  });
}

function masteryInputSet(projection: TargetReadinessProjectionInputV1): MasteryReadinessInputSetV1 {
  const required = new Map<string, MasteryReadinessRequiredDimensionV1>();
  for (const goal of projection.goals) {
    for (const leaf of goal.requiredLeaves) {
      required.set(inputIdentity(leaf), {
        competencyRef: leaf.competencyRef,
        dimension: leaf.dimension,
      });
    }
  }
  return synchronizeMasteryReadinessInputsV1({
    calculatedAsOf: projection.calculatedAsOf,
    sourceEvidenceWatermark: projection.sourceEvidenceWatermark,
    declaredMasteryEngineVersion: projection.masterySource.masteryEngineVersion,
    declaredMasteryPolicyVersion: projection.masterySource.masteryPolicyVersion,
    competencies: projection.masterySource.competencies,
    requiredDimensions: [...required.values()],
  });
}

function leafStrength(input: MasteryReadinessDimensionInputV1): number | null {
  if (input.value === "UNKNOWN") return null;
  return input.freshness === "FRESH"
    ? READINESS_POLICY_V0_1.freshStrength[input.achievementLevel]
    : READINESS_POLICY_V0_1.staleStrength[input.achievementLevel];
}

const GAP_ORDER: Readonly<Record<TargetReadinessGapCode, number>> = {
  FAILED_MANDATORY_FLOOR: 0,
  UNKNOWN_MANDATORY_FLOOR: 1,
  UNKNOWN_REQUIREMENT: 2,
  KNOWN_SHORTFALL: 3,
};

export function deriveOrderedReadinessGaps(
  rules: readonly RequirementRule[],
  inputs: readonly (TargetReadinessRequiredLeafV1 & MasteryReadinessDimensionInputV1)[],
): readonly TargetReadinessGapV1[] {
  const mandatoryRuleKeys = new Set(
    rules.filter(({ kind }) => kind === "MANDATORY_FLOOR").map(({ ruleId }) => ruleId),
  );
  return inputs
    .flatMap((input): readonly TargetReadinessGapV1[] => {
      const mandatory = input.owningRuleKeys.some((key) => mandatoryRuleKeys.has(key));
      const strength = leafStrength(input);
      let gapCode: TargetReadinessGapCode | null = null;
      if (strength === null) {
        gapCode = mandatory ? "UNKNOWN_MANDATORY_FLOOR" : "UNKNOWN_REQUIREMENT";
      } else if (
        strength + Number.EPSILON <
        READINESS_POLICY_V0_1.requiredStrength[input.requiredLevel]
      ) {
        gapCode = mandatory ? "FAILED_MANDATORY_FLOOR" : "KNOWN_SHORTFALL";
      }
      return gapCode === null
        ? []
        : [
            {
              gapCode,
              competencyRef: input.competencyRef,
              dimension: input.dimension,
              requiredLevel: input.requiredLevel,
              owningRuleKeys: [...input.owningRuleKeys].sort(),
              freshness: input.freshness,
              confidence: input.confidence,
            },
          ];
    })
    .sort(
      (left, right) =>
        GAP_ORDER[left.gapCode] - GAP_ORDER[right.gapCode] ||
        compareText(leafIdentity(left), leafIdentity(right)),
    );
}

export function prepareTargetReadinessProjectionResults(
  projection: TargetReadinessProjectionInputV1,
): readonly TargetReadinessProjectionResultV1[] {
  if (projection.projectionError === "UNSUPPORTED_DOMAIN_REQUIREMENT") {
    throw new UnsupportedDomainRequirementError();
  }
  const synchronized = masteryInputSet(projection);
  const dimensions = new Map(synchronized.dimensions.map((input) => [inputIdentity(input), input]));
  return [...projection.goals]
    .sort((left, right) => compareText(left.readinessGoalKey, right.readinessGoalKey))
    .map((goalInput) => {
      const rules = adaptTargetReadinessRules(goalInput.rules);
      const inputs = goalInput.requiredLeaves
        .map((leaf) => {
          const state = dimensions.get(inputIdentity(leaf));
          if (state === undefined) throw new TargetReadinessProjectionContractError();
          return { ...leaf, owningRuleKeys: [...leaf.owningRuleKeys].sort(), ...state };
        })
        .sort((left, right) => compareText(leafIdentity(left), leafIdentity(right)));
      const fingerprint = canonicalReadinessInputFingerprint(projection, goalInput, inputs);
      const readinessDimensions: ReadinessDimensionInput[] = [
        ...new Map(
          inputs.map((input) => [
            inputIdentity(input),
            {
              competencyId: input.competencyRef,
              dimension: input.dimension,
              calculatedAsOf: input.calculatedAsOf,
              value: input.value,
              achievementLevel: input.achievementLevel,
              freshness: input.freshness,
              confidence: input.confidence,
            } satisfies ReadinessDimensionInput,
          ]),
        ).values(),
      ];
      const readiness = calculateTargetReadiness(
        {
          targetProfileVersionId: goalInput.profileVersionId,
          rootRuleId: goalInput.rootRuleKey,
          inputWatermark: fingerprint,
          targetThreshold: goalInput.targetThreshold,
          rules,
          masteryDimensions: readinessDimensions,
        },
        READINESS_POLICY_V0_1,
        { asOf: projection.calculatedAsOf },
      );
      return {
        readinessGoalId: goalInput.readinessGoalId,
        profileVersionId: goalInput.profileVersionId,
        projectionGeneration: "live-v1",
        inputFingerprint: fingerprint,
        sourceEvidenceWatermark: synchronized.sourceEvidenceWatermark,
        calculatedAsOf: synchronized.calculatedAsOf,
        validUntil: calculateMasteryReadinessValidUntilV1(inputs, synchronized.calculatedAsOf),
        masteryEngineVersion: synchronized.masteryEngineVersion,
        masteryPolicyVersion: synchronized.masteryPolicyVersion,
        readiness,
        gaps: deriveOrderedReadinessGaps(rules, inputs),
        inputs,
      };
    });
}
