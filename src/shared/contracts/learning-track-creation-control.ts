import {
  asArray,
  asJsonObject,
  asNumber,
  asString,
  hasDuplicates,
  isSorted,
  type JsonObject,
  type JsonValue,
} from "./json";
import { type ContractViolation, type ValidationResult, validationResult } from "./result";
import { validateSchema } from "./schema-registry";

export type LearningTrackCreationSourceStateV1 =
  | "READY"
  | "NO_CURRENT_PLAN"
  | "TRACK_PORTFOLIO_LIMIT_REACHED"
  | "NO_ACTIVE_GOALS"
  | "GOAL_PORTFOLIO_OVERFLOW";

export interface LearningTrackCreationGoalChoiceV1 {
  readonly readinessGoalKey: string;
  readonly title: string;
  readonly profileLabel: string;
  readonly profileVersionKey: string;
  readonly roadmapPresent: boolean;
  readonly aggregateVersion: string;
}

export interface LearningTrackCreationPlanV1 {
  readonly title: string;
  readonly lifecycle: "ACTIVE" | "PAUSED";
  readonly weeklyCapacityMinutes: number;
  readonly aggregateVersion: string;
}

export interface LearningTrackCreationTrackPortfolioV1 {
  readonly currentTrackCount: number;
  readonly currentTrackLimit: 30;
}

export interface LearningTrackCreationSourceV1 {
  readonly contract: {
    readonly name: "LearningTrackCreationSourceV1";
    readonly version: "1.0.0";
  };
  readonly state: LearningTrackCreationSourceStateV1;
  readonly capabilities: readonly [] | readonly ["create_learning_track"];
  readonly growthPlan: LearningTrackCreationPlanV1 | null;
  readonly trackPortfolio: LearningTrackCreationTrackPortfolioV1 | null;
  readonly goals: readonly LearningTrackCreationGoalChoiceV1[];
}

export interface LearningTrackCreationResolvedSourceV1 {
  readonly readinessGoalId: string;
  readonly readinessGoalKey: string;
  readonly readinessGoalTitle: string;
  readonly readinessGoalLifecycle: "ACTIVE";
  readonly readinessGoalVersion: string;
  readonly profileVersionId: string;
  readonly profileVersionKey: string;
  readonly sourceKind: "ROADMAP_TEMPLATE_VERSION" | "TARGET_PROFILE_REQUIREMENT_COLLECTION";
  readonly sourceRef: string;
  readonly roadmapVersionId: string | null;
  readonly sourceOwnerRevision: string;
}

export interface LearningTrackCreationTrackV1 {
  readonly learningTrackId: string;
  readonly trackKey: string;
  readonly title: string;
  readonly lifecycle: "ACTIVE";
  readonly priority: number;
  readonly protectedMinimumMinutes: 0;
  readonly defaultSessionMinutes: number;
  readonly aggregateVersion: "1";
}

export interface LearningTrackCreationPreviewV1 {
  readonly contract: {
    readonly name: "LearningTrackCreationPreviewV1";
    readonly version: "1.0.0";
  };
  readonly digestVersion: "learning-track-creation-preview-digest/1.0.0";
  readonly identityVersion: "planning-create-identity/1.0.0";
  readonly operation: "create_learning_track";
  readonly commandType: "planning.create_learning_track_v1";
  readonly requestId: string;
  readonly reason: string;
  readonly expectedGrowthPlanVersion: string;
  readonly expectedReadinessGoalVersion: string;
  readonly growthPlan: LearningTrackCreationPlanV1;
  readonly source: LearningTrackCreationResolvedSourceV1;
  readonly constraint: {
    readonly currentTrackCountBefore: number;
    readonly currentTrackCountAfter: number;
    readonly currentTrackLimit: 30;
    readonly activeProtectedMinimumMinutesBefore: number;
    readonly activeProtectedMinimumMinutesAfter: number;
    readonly flexibleMinutesBefore: number;
    readonly flexibleMinutesAfter: number;
    readonly currentTrackOrderFingerprintBefore: string;
    readonly currentTrackOrderFingerprintAfter: string;
    readonly newTrackPosition: number;
  };
  readonly learningTrack: LearningTrackCreationTrackV1;
  readonly canApply: boolean;
  readonly blockingReasons: readonly {
    readonly code: "TRACK_PORTFOLIO_LIMIT_REACHED" | "PLANNING_CREATE_IDENTITY_COLLISION";
  }[];
  readonly warnings: readonly {
    readonly code: "PARENT_GROWTH_PLAN_PAUSED" | "TRACK_STARTS_EMPTY";
  }[];
  readonly retained: {
    readonly planHistory: true;
    readonly trackHistory: true;
    readonly activitiesAndEvidence: true;
    readonly masteryAndReadiness: true;
    readonly reviewQueue: true;
    readonly planSnapshots: true;
  };
  readonly recalculationAfterApply: {
    readonly projectionState: "PENDING";
    readonly eventChangeKind: "TRACK_CREATED";
    readonly consumerName: "planning.plan_snapshot_v1";
  };
  readonly previewDigest: string;
}

export interface LearningTrackCreationApplyResultV1 {
  readonly contract: {
    readonly name: "LearningTrackCreationApplyResultV1";
    readonly version: "1.0.0";
  };
  readonly commandId: string;
  readonly createdTrack: LearningTrackCreationTrackV1;
  readonly projectionState: "PENDING";
  readonly planningDeliveryId: string;
  readonly emittedEventIds: readonly [string];
}

function violation(code: string, path: string, message: string): ContractViolation {
  return { code, path, message };
}

function hasControlCharacters(value: JsonValue | undefined): boolean {
  return typeof value !== "string" || /[\p{Cc}]/u.test(value);
}

function isLowercase(value: JsonValue | undefined): boolean {
  return typeof value === "string" && value === value.toLowerCase();
}

function sourceViolations(root: JsonObject): ContractViolation[] {
  const goals = asArray(root.goals);
  const state = asString(root.state);
  const growthPlan = root.growthPlan === null ? null : asJsonObject(root.growthPlan, "growthPlan");
  const trackPortfolio =
    root.trackPortfolio === null ? null : asJsonObject(root.trackPortfolio, "trackPortfolio");
  const violations: ContractViolation[] = [];

  if (state === "READY") {
    const keys = goals.map((entry) =>
      asString(asJsonObject(entry, "goal choice").readinessGoalKey),
    ) as string[];
    if (!isSorted(keys)) {
      violations.push(
        violation(
          "LEARNING_TRACK_CREATION_GOAL_ORDER",
          "/goals",
          "Ready goal choices must use stable ASCII readiness-goal-key order.",
        ),
      );
    }
    if (hasDuplicates(keys)) {
      violations.push(
        violation(
          "LEARNING_TRACK_CREATION_GOAL_DUPLICATE",
          "/goals",
          "Ready goal choices must have unique readiness-goal keys.",
        ),
      );
    }
    goals.forEach((entry, index) => {
      const goal = asJsonObject(entry, "goal choice");
      if (hasControlCharacters(goal.title) || hasControlCharacters(goal.profileLabel)) {
        violations.push(
          violation(
            "LEARNING_TRACK_CREATION_UNSAFE_TEXT",
            `/goals/${index}`,
            "Goal labels must not contain control characters.",
          ),
        );
      }
    });
    if (
      growthPlan === null ||
      trackPortfolio === null ||
      asNumber(trackPortfolio.currentTrackCount) === 30
    ) {
      violations.push(
        violation(
          "LEARNING_TRACK_CREATION_SOURCE_READY_BINDING",
          "/",
          "Ready state requires one current Plan, a Track portfolio below 30, and visible goals.",
        ),
      );
    }
    return violations;
  }

  if (goals.length !== 0) {
    violations.push(
      violation(
        "LEARNING_TRACK_CREATION_SOURCE_BLOCKED_GOALS",
        "/goals",
        "Blocked or unavailable source states must not expose goal choices.",
      ),
    );
  }

  if (state === "NO_CURRENT_PLAN") {
    if (growthPlan !== null || trackPortfolio !== null) {
      violations.push(
        violation(
          "LEARNING_TRACK_CREATION_SOURCE_PLAN_ABSENCE",
          "/",
          "No-current-Plan state must omit Plan and Track portfolio details.",
        ),
      );
    }
    return violations;
  }

  if (growthPlan === null || trackPortfolio === null) {
    violations.push(
      violation(
        "LEARNING_TRACK_CREATION_SOURCE_PLAN_BINDING",
        "/",
        "Plan-backed unavailable states must still expose the current Plan and Track count.",
      ),
    );
    return violations;
  }

  const count = asNumber(trackPortfolio.currentTrackCount);
  if (
    (state === "TRACK_PORTFOLIO_LIMIT_REACHED" && count !== 30) ||
    (state !== "TRACK_PORTFOLIO_LIMIT_REACHED" && count === 30)
  ) {
    violations.push(
      violation(
        "LEARNING_TRACK_CREATION_SOURCE_TRACK_LIMIT",
        "/trackPortfolio/currentTrackCount",
        "The exact 30-Track cap must match the blocked source state.",
      ),
    );
  }
  return violations;
}

function previewViolations(root: JsonObject): ContractViolation[] {
  const growthPlan = asJsonObject(root.growthPlan, "growthPlan");
  const source = asJsonObject(root.source, "resolved source");
  const constraint = asJsonObject(root.constraint, "constraint");
  const learningTrack = asJsonObject(root.learningTrack, "learningTrack");
  const blockers = asArray(root.blockingReasons);
  const warnings = asArray(root.warnings).map((entry) =>
    asString(asJsonObject(entry, "warning").code),
  );
  const violations: ContractViolation[] = [];

  if (
    hasControlCharacters(root.reason) ||
    hasControlCharacters(growthPlan.title) ||
    hasControlCharacters(source.readinessGoalTitle) ||
    hasControlCharacters(learningTrack.title)
  ) {
    violations.push(
      violation(
        "LEARNING_TRACK_CREATION_UNSAFE_TEXT",
        "/",
        "Preview text must not contain control characters.",
      ),
    );
  }

  if (
    root.expectedGrowthPlanVersion !== growthPlan.aggregateVersion ||
    root.expectedReadinessGoalVersion !== source.readinessGoalVersion ||
    source.sourceOwnerRevision !== `readiness-goal:${String(source.readinessGoalVersion)}`
  ) {
    violations.push(
      violation(
        "LEARNING_TRACK_CREATION_VERSION_BINDING",
        "/",
        "Expected versions and source owner revision must bind the previewed Plan and Goal.",
      ),
    );
  }

  const roadmapVersionId = source.roadmapVersionId;
  const sourceBindingValid =
    (source.sourceKind === "ROADMAP_TEMPLATE_VERSION" &&
      typeof roadmapVersionId === "string" &&
      source.sourceRef === roadmapVersionId) ||
    (source.sourceKind === "TARGET_PROFILE_REQUIREMENT_COLLECTION" &&
      roadmapVersionId === null &&
      source.sourceRef === source.profileVersionId);
  if (!sourceBindingValid) {
    violations.push(
      violation(
        "LEARNING_TRACK_CREATION_SOURCE_BINDING",
        "/source",
        "Source kind, source reference, roadmap, and immutable profile must agree exactly.",
      ),
    );
  }

  if (
    !isLowercase(root.requestId) ||
    !isLowercase(source.readinessGoalId) ||
    !isLowercase(source.profileVersionId) ||
    !isLowercase(source.sourceRef) ||
    (source.roadmapVersionId !== null && !isLowercase(source.roadmapVersionId)) ||
    !isLowercase(learningTrack.learningTrackId)
  ) {
    violations.push(
      violation(
        "LEARNING_TRACK_CREATION_UUID_CASE",
        "/",
        "Preview UUID values must keep exact lowercase representation.",
      ),
    );
  }

  if (learningTrack.trackKey !== `track:${String(learningTrack.learningTrackId).toLowerCase()}`) {
    violations.push(
      violation(
        "LEARNING_TRACK_CREATION_TRACK_KEY",
        "/learningTrack/trackKey",
        "Track key must bind the derived Track UUID.",
      ),
    );
  }

  const before = asNumber(constraint.currentTrackCountBefore);
  const after = asNumber(constraint.currentTrackCountAfter);
  const minBefore = asNumber(constraint.activeProtectedMinimumMinutesBefore);
  const minAfter = asNumber(constraint.activeProtectedMinimumMinutesAfter);
  const flexibleBefore = asNumber(constraint.flexibleMinutesBefore);
  const flexibleAfter = asNumber(constraint.flexibleMinutesAfter);
  const position = asNumber(constraint.newTrackPosition);
  const weeklyCapacity = asNumber(growthPlan.weeklyCapacityMinutes);
  if (
    [
      before,
      after,
      minBefore,
      minAfter,
      flexibleBefore,
      flexibleAfter,
      position,
      weeklyCapacity,
    ].some((value) => value === undefined)
  ) {
    violations.push(
      violation(
        "LEARNING_TRACK_CREATION_CONSTRAINT",
        "/constraint",
        "Track-creation constraint fields must be complete integers.",
      ),
    );
    return violations;
  }

  const actualBlocker =
    blockers.length === 1 ? asString(asJsonObject(blockers[0], "blocking reason").code) : undefined;
  const expectedBlocker =
    before! >= 30
      ? "TRACK_PORTFOLIO_LIMIT_REACHED"
      : actualBlocker === "PLANNING_CREATE_IDENTITY_COLLISION"
        ? "PLANNING_CREATE_IDENTITY_COLLISION"
        : undefined;
  const shouldApply = before! <= 29 && expectedBlocker === undefined;

  if (
    after !== before! + 1 ||
    root.canApply !== shouldApply ||
    blockers.length !== (expectedBlocker === undefined ? 0 : 1) ||
    actualBlocker !== expectedBlocker
  ) {
    violations.push(
      violation(
        "LEARNING_TRACK_CREATION_APPLICABILITY",
        "/constraint",
        "Track counts, blocker, and applicability must agree with the 30-Track bound.",
      ),
    );
  }

  if (
    minAfter !== minBefore ||
    flexibleAfter !== flexibleBefore ||
    flexibleBefore !== weeklyCapacity! - minBefore!
  ) {
    violations.push(
      violation(
        "LEARNING_TRACK_CREATION_CAPACITY_STABILITY",
        "/constraint",
        "Creating an empty Track must not change protected-minimum or flexible capacity totals.",
      ),
    );
  }

  if (
    constraint.currentTrackOrderFingerprintBefore === constraint.currentTrackOrderFingerprintAfter
  ) {
    violations.push(
      violation(
        "LEARNING_TRACK_CREATION_ORDER_FINGERPRINT",
        "/constraint/currentTrackOrderFingerprintAfter",
        "Track creation must change the current-order fingerprint.",
      ),
    );
  }

  if (position! < 1 || position! > after!) {
    violations.push(
      violation(
        "LEARNING_TRACK_CREATION_POSITION",
        "/constraint/newTrackPosition",
        "The new Track position must fit inside the proposed post-create order.",
      ),
    );
  }

  const expectedWarnings = [
    ...(growthPlan.lifecycle === "PAUSED" ? ["PARENT_GROWTH_PLAN_PAUSED"] : []),
    "TRACK_STARTS_EMPTY",
  ];
  if (
    warnings.length !== expectedWarnings.length ||
    warnings.some((warning, index) => warning !== expectedWarnings[index])
  ) {
    violations.push(
      violation(
        "LEARNING_TRACK_CREATION_WARNING_ORDER",
        "/warnings",
        "Warnings must be complete and ordered as paused-parent first, then empty-track.",
      ),
    );
  }

  return violations;
}

function applyViolations(root: JsonObject): ContractViolation[] {
  const track = asJsonObject(root.createdTrack, "createdTrack");
  const violations: ContractViolation[] = [];
  if (
    !isLowercase(root.commandId) ||
    !isLowercase(root.planningDeliveryId) ||
    !asArray(root.emittedEventIds).every(isLowercase) ||
    !isLowercase(track.learningTrackId)
  ) {
    violations.push(
      violation(
        "LEARNING_TRACK_CREATION_UUID_CASE",
        "/",
        "Applied-result UUID values must keep exact lowercase representation.",
      ),
    );
  }
  if (track.trackKey !== `track:${String(track.learningTrackId).toLowerCase()}`) {
    violations.push(
      violation(
        "LEARNING_TRACK_CREATION_TRACK_KEY",
        "/createdTrack/trackKey",
        "Created Track key must bind its UUID.",
      ),
    );
  }
  if (track.lifecycle !== "ACTIVE" || track.aggregateVersion !== "1") {
    violations.push(
      violation(
        "LEARNING_TRACK_CREATION_CREATED_TRACK_STATE",
        "/createdTrack",
        "Created Track must begin active at aggregate version 1.",
      ),
    );
  }
  return violations;
}

export function learningTrackCreationControlSemanticViolations(
  value: unknown,
): readonly ContractViolation[] {
  const root = asJsonObject(value, "Learning Track creation response");
  const contract = asJsonObject(root.contract, "Learning Track creation contract");
  switch (asString(contract.name)) {
    case "LearningTrackCreationSourceV1":
      return sourceViolations(root);
    case "LearningTrackCreationPreviewV1":
      return previewViolations(root);
    case "LearningTrackCreationApplyResultV1":
      return applyViolations(root);
    default:
      return [
        violation(
          "LEARNING_TRACK_CREATION_CONTRACT",
          "/contract/name",
          "Unsupported Learning Track creation contract.",
        ),
      ];
  }
}

export function validateLearningTrackCreationControlV1(value: unknown): ValidationResult {
  const structural = validateSchema("learning-track-creation-control-v1", value);
  return structural.valid
    ? validationResult(learningTrackCreationControlSemanticViolations(value))
    : structural;
}

export class LearningTrackCreationContractError extends TypeError {
  readonly violations: readonly ContractViolation[];

  constructor(violations: readonly ContractViolation[]) {
    super("Learning Track creation response failed its contract.");
    this.name = "LearningTrackCreationContractError";
    this.violations = violations.map(({ code, path, message }) => ({ code, path, message }));
  }
}

function decodeNamed<T>(value: unknown, expectedName: string): T {
  const validation = validateLearningTrackCreationControlV1(value);
  if (!validation.valid) throw new LearningTrackCreationContractError(validation.violations);
  const root = asJsonObject(value, expectedName);
  const contract = asJsonObject(root.contract, `${expectedName} contract`);
  if (contract.name !== expectedName) {
    throw new LearningTrackCreationContractError([
      violation("LEARNING_TRACK_CREATION_CONTRACT", "/contract/name", `Expected ${expectedName}.`),
    ]);
  }
  return value as T;
}

export function decodeLearningTrackCreationSourceV1(value: unknown): LearningTrackCreationSourceV1 {
  return decodeNamed<LearningTrackCreationSourceV1>(value, "LearningTrackCreationSourceV1");
}

export function decodeLearningTrackCreationPreviewV1(
  value: unknown,
): LearningTrackCreationPreviewV1 {
  return decodeNamed<LearningTrackCreationPreviewV1>(value, "LearningTrackCreationPreviewV1");
}

export function decodeLearningTrackCreationApplyResultV1(
  value: unknown,
): LearningTrackCreationApplyResultV1 {
  return decodeNamed<LearningTrackCreationApplyResultV1>(
    value,
    "LearningTrackCreationApplyResultV1",
  );
}
