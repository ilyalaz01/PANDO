import { initialLearningTrackTitle } from "../../modules/planning/domain/growth-plan-initialization-preview";

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

export type GrowthPlanSetupState =
  | "SETUP_AVAILABLE"
  | "NO_ACTIVE_GOALS"
  | "CURRENT_PLAN_EXISTS"
  | "HISTORY_REQUIRES_REPLACEMENT"
  | "GOAL_PORTFOLIO_OVERFLOW";

export interface GrowthPlanSetupGoalV1 {
  readonly readinessGoalKey: string;
  readonly title: string;
  readonly profileLabel: string;
  readonly profileVersionKey: string;
  readonly roadmapPresent: boolean;
  readonly aggregateVersion: string;
}

export type GrowthPlanSetupSourceV1 =
  | {
      readonly contract: { readonly name: "GrowthPlanSetupSourceV1"; readonly version: "1.0.0" };
      readonly state: "SETUP_AVAILABLE";
      readonly capabilities: readonly ["initialize_growth_plan"];
      readonly goals: readonly GrowthPlanSetupGoalV1[];
    }
  | {
      readonly contract: { readonly name: "GrowthPlanSetupSourceV1"; readonly version: "1.0.0" };
      readonly state: Exclude<GrowthPlanSetupState, "SETUP_AVAILABLE">;
      readonly capabilities: readonly [];
      readonly goals: readonly [];
    };

export interface GrowthPlanInitializationPlanStateV1 {
  readonly growthPlanId: string;
  readonly title: string;
  readonly lifecycle: "ACTIVE";
  readonly weeklyCapacityMinutes: number;
  readonly aggregateVersion: "1";
}

export interface GrowthPlanInitializationTrackStateV1 {
  readonly learningTrackId: string;
  readonly trackKey: string;
  readonly title: string;
  readonly lifecycle: "ACTIVE";
  readonly priority: number;
  readonly protectedMinimumMinutes: 0;
  readonly defaultSessionMinutes: number;
  readonly aggregateVersion: "1";
}

export interface GrowthPlanInitializationPreviewV1 {
  readonly contract: {
    readonly name: "GrowthPlanInitializationPreviewV1";
    readonly version: "1.0.0";
  };
  readonly digestVersion: "growth-plan-initialization-preview-digest/1.0.0";
  readonly identityVersion: "planning-create-identity/1.0.0";
  readonly operation: "initialize_growth_plan";
  readonly commandType: "planning.initialize_growth_plan_v2";
  readonly idempotencyKey: string;
  readonly reason: string;
  readonly expectedReadinessGoalVersion: string;
  readonly source: {
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
  };
  readonly before: {
    readonly lifetimePlanCount: number;
    readonly currentPlanCount: number;
    readonly snapshotSentinelCount: number;
  };
  readonly after: {
    readonly lifetimePlanCount: 1;
    readonly currentPlanCount: 1;
    readonly currentPlanLimit: 1;
    readonly snapshotSentinelCount: 1;
    readonly growthPlan: GrowthPlanInitializationPlanStateV1;
    readonly learningTrack: GrowthPlanInitializationTrackStateV1;
  };
  readonly canApply: boolean;
  readonly blockingReasons: readonly {
    readonly code:
      | "CURRENT_GROWTH_PLAN_EXISTS"
      | "GROWTH_PLAN_HISTORY_REQUIRES_REPLACEMENT"
      | "PLANNING_CREATE_IDENTITY_COLLISION";
  }[];
  readonly warnings: readonly { readonly code: "INITIAL_TRACK_HAS_NO_ACTIVITIES" }[];
  readonly retained: {
    readonly readinessGoal: true;
    readonly competencyOverlay: true;
    readonly activitiesAndEvidence: true;
    readonly mastery: true;
    readonly reviews: true;
    readonly history: true;
  };
  readonly recalculationAfterApply: {
    readonly projectionState: "PENDING";
    readonly eventChangeKind: "INITIALIZED";
    readonly consumerName: "planning.plan_snapshot_v1";
  };
  readonly previewDigest: string;
}

export interface GrowthPlanInitializationApplyResultV1 {
  readonly contract: {
    readonly name: "GrowthPlanInitializationApplyResultV1";
    readonly version: "1.0.0";
  };
  readonly commandId: string;
  readonly createdPlan: GrowthPlanInitializationPlanStateV1;
  readonly createdTrack: GrowthPlanInitializationTrackStateV1;
  readonly projectionState: "PENDING";
  readonly planningDeliveryId: string;
  readonly emittedEventIds: readonly [string];
}

function semanticViolation(code: string, path: string, message: string): ContractViolation {
  return { code, path, message };
}

function hasControlCharacters(value: JsonValue | undefined): boolean {
  return typeof value !== "string" || /[\p{Cc}]/u.test(value);
}

function setupSourceSemanticViolations(root: JsonObject): ContractViolation[] {
  const goals = asArray(root.goals);
  if (root.state !== "SETUP_AVAILABLE") return [];
  const keys = goals.map((item) => asString(asJsonObject(item, "setup goal").readinessGoalKey)!);
  const violations: ContractViolation[] = [];
  if (!isSorted(keys)) {
    violations.push(
      semanticViolation(
        "GROWTH_PLAN_SETUP_GOAL_ORDER",
        "/goals",
        "Setup goals must use stable ASCII readiness-goal-key order.",
      ),
    );
  }
  if (hasDuplicates(keys)) {
    violations.push(
      semanticViolation(
        "GROWTH_PLAN_SETUP_GOAL_DUPLICATE",
        "/goals",
        "Setup readiness goal keys must be unique.",
      ),
    );
  }
  goals.forEach((item, index) => {
    const goal = asJsonObject(item, "setup goal");
    if (hasControlCharacters(goal.title) || hasControlCharacters(goal.profileLabel)) {
      violations.push(
        semanticViolation(
          "GROWTH_PLAN_SETUP_UNSAFE_TEXT",
          `/goals/${index}`,
          "Setup labels must not contain control characters.",
        ),
      );
    }
  });
  return violations;
}

function previewSemanticViolations(root: JsonObject): ContractViolation[] {
  const source = asJsonObject(root.source, "initialization source");
  const before = asJsonObject(root.before, "initialization before");
  const after = asJsonObject(root.after, "initialization after");
  const plan = asJsonObject(after.growthPlan, "created plan");
  const track = asJsonObject(after.learningTrack, "created track");
  const blockers = asArray(root.blockingReasons);
  const violations: ContractViolation[] = [];

  if (hasControlCharacters(root.reason) || hasControlCharacters(source.readinessGoalTitle)) {
    violations.push(
      semanticViolation(
        "GROWTH_PLAN_INITIALIZATION_UNSAFE_TEXT",
        "/reason",
        "Preview text must not contain control characters.",
      ),
    );
  }
  if (
    root.expectedReadinessGoalVersion !== source.readinessGoalVersion ||
    source.sourceOwnerRevision !== `readiness-goal:${String(source.readinessGoalVersion)}`
  ) {
    violations.push(
      semanticViolation(
        "GROWTH_PLAN_INITIALIZATION_SOURCE_VERSION",
        "/source",
        "Expected Goal version and owner revision must bind the resolved Goal version.",
      ),
    );
  }

  const roadmapVersionId = source.roadmapVersionId;
  const sourceRepresentationValid =
    (source.sourceKind === "ROADMAP_TEMPLATE_VERSION" &&
      typeof roadmapVersionId === "string" &&
      source.sourceRef === roadmapVersionId) ||
    (source.sourceKind === "TARGET_PROFILE_REQUIREMENT_COLLECTION" &&
      roadmapVersionId === null &&
      source.sourceRef === source.profileVersionId);
  if (!sourceRepresentationValid) {
    violations.push(
      semanticViolation(
        "GROWTH_PLAN_INITIALIZATION_SOURCE_BINDING",
        "/source",
        "Source kind, reference, roadmap, and immutable profile must agree.",
      ),
    );
  }

  if (plan.title !== source.readinessGoalTitle) {
    violations.push(
      semanticViolation(
        "GROWTH_PLAN_INITIALIZATION_PLAN_TITLE",
        "/after/growthPlan/title",
        "The first Plan title must equal the authoritative Goal title.",
      ),
    );
  }
  if (track.title !== initialLearningTrackTitle(String(source.readinessGoalTitle))) {
    violations.push(
      semanticViolation(
        "GROWTH_PLAN_INITIALIZATION_TRACK_TITLE",
        "/after/learningTrack/title",
        "The first Track title must use PostgreSQL btrim(left(goal title, 160)) semantics.",
      ),
    );
  }
  if (track.trackKey !== `track:${String(track.learningTrackId).toLowerCase()}`) {
    violations.push(
      semanticViolation(
        "GROWTH_PLAN_INITIALIZATION_TRACK_KEY",
        "/after/learningTrack/trackKey",
        "The first Track key must bind its derived UUID.",
      ),
    );
  }

  const lifetime = asNumber(before.lifetimePlanCount)!;
  const current = asNumber(before.currentPlanCount)!;
  const sentinel = asNumber(before.snapshotSentinelCount)!;
  if (current > lifetime || (lifetime === 0 && sentinel !== 0)) {
    violations.push(
      semanticViolation(
        "GROWTH_PLAN_INITIALIZATION_CARDINALITY",
        "/before",
        "Current Plan count cannot exceed lifetime history and a sentinel cannot exist without a Plan.",
      ),
    );
  }
  const expectedBlocker =
    current === 1
      ? "CURRENT_GROWTH_PLAN_EXISTS"
      : lifetime === 1
        ? "GROWTH_PLAN_HISTORY_REQUIRES_REPLACEMENT"
        : blockers.length === 1 &&
            asString(asJsonObject(blockers[0], "blocking reason").code) ===
              "PLANNING_CREATE_IDENTITY_COLLISION"
          ? "PLANNING_CREATE_IDENTITY_COLLISION"
          : undefined;
  const actualBlocker =
    blockers.length === 1 ? asString(asJsonObject(blockers[0], "blocking reason").code) : undefined;
  const shouldApply =
    lifetime === 0 && current === 0 && sentinel === 0 && expectedBlocker === undefined;
  if (
    root.canApply !== shouldApply ||
    actualBlocker !== expectedBlocker ||
    blockers.length !== (expectedBlocker === undefined ? 0 : 1)
  ) {
    violations.push(
      semanticViolation(
        "GROWTH_PLAN_INITIALIZATION_APPLICABILITY",
        "/canApply",
        "Applicability and blocker must exactly reflect current Plan/history/collision state.",
      ),
    );
  }
  if (
    after.lifetimePlanCount !== 1 ||
    after.currentPlanCount !== 1 ||
    after.snapshotSentinelCount !== 1 ||
    after.currentPlanLimit !== 1
  ) {
    violations.push(
      semanticViolation(
        "GROWTH_PLAN_INITIALIZATION_AFTER_CARDINALITY",
        "/after",
        "The proposed first-Plan state must contain exactly one Plan and one sentinel.",
      ),
    );
  }
  return violations;
}

function applySemanticViolations(root: JsonObject): ContractViolation[] {
  const plan = asJsonObject(root.createdPlan, "created plan");
  const track = asJsonObject(root.createdTrack, "created track");
  const violations: ContractViolation[] = [];
  if (track.trackKey !== `track:${String(track.learningTrackId).toLowerCase()}`) {
    violations.push(
      semanticViolation(
        "GROWTH_PLAN_INITIALIZATION_TRACK_KEY",
        "/createdTrack/trackKey",
        "The created Track key must bind its derived UUID.",
      ),
    );
  }
  if (track.title !== initialLearningTrackTitle(String(plan.title))) {
    violations.push(
      semanticViolation(
        "GROWTH_PLAN_INITIALIZATION_TRACK_TITLE",
        "/createdTrack/title",
        "The created Track title must be derived from the created Plan title.",
      ),
    );
  }
  if (plan.lifecycle !== "ACTIVE" || track.lifecycle !== "ACTIVE") {
    violations.push(
      semanticViolation(
        "GROWTH_PLAN_INITIALIZATION_CREATED_LIFECYCLE",
        "/",
        "Both created aggregates must be active.",
      ),
    );
  }
  return violations;
}

export function growthPlanInitializationControlSemanticViolations(
  value: unknown,
): readonly ContractViolation[] {
  const root = asJsonObject(value, "Growth Plan initialization control response");
  const contract = asJsonObject(root.contract, "Growth Plan initialization contract");
  const name = asString(contract.name);
  if (name === "GrowthPlanSetupSourceV1") return setupSourceSemanticViolations(root);
  if (name === "GrowthPlanInitializationPreviewV1") return previewSemanticViolations(root);
  if (name === "GrowthPlanInitializationApplyResultV1") return applySemanticViolations(root);
  return [
    semanticViolation(
      "GROWTH_PLAN_INITIALIZATION_CONTRACT",
      "/contract/name",
      "Unsupported Growth Plan initialization contract.",
    ),
  ];
}

export function validateGrowthPlanInitializationControlV1(value: unknown): ValidationResult {
  const structural = validateSchema("growth-plan-initialization-control-v1", value);
  return structural.valid
    ? validationResult(growthPlanInitializationControlSemanticViolations(value))
    : structural;
}

export class GrowthPlanInitializationContractError extends TypeError {
  readonly violations: readonly ContractViolation[];

  constructor(violations: readonly ContractViolation[]) {
    super("Growth Plan initialization response failed its contract.");
    this.name = "GrowthPlanInitializationContractError";
    this.violations = violations.map(({ code, path, message }) => ({ code, path, message }));
  }
}

function decodeNamed<T>(value: unknown, expectedName: string): T {
  const validation = validateGrowthPlanInitializationControlV1(value);
  if (!validation.valid) throw new GrowthPlanInitializationContractError(validation.violations);
  const root = asJsonObject(value, expectedName);
  const contract = asJsonObject(root.contract, `${expectedName} contract`);
  if (contract.name !== expectedName) {
    throw new GrowthPlanInitializationContractError([
      semanticViolation(
        "GROWTH_PLAN_INITIALIZATION_CONTRACT",
        "/contract/name",
        `Expected ${expectedName}.`,
      ),
    ]);
  }
  return value as T;
}

export function decodeGrowthPlanSetupSourceV1(value: unknown): GrowthPlanSetupSourceV1 {
  return decodeNamed<GrowthPlanSetupSourceV1>(value, "GrowthPlanSetupSourceV1");
}

export function decodeGrowthPlanInitializationPreviewV1(
  value: unknown,
): GrowthPlanInitializationPreviewV1 {
  return decodeNamed<GrowthPlanInitializationPreviewV1>(value, "GrowthPlanInitializationPreviewV1");
}

export function decodeGrowthPlanInitializationApplyResultV1(
  value: unknown,
): GrowthPlanInitializationApplyResultV1 {
  return decodeNamed<GrowthPlanInitializationApplyResultV1>(
    value,
    "GrowthPlanInitializationApplyResultV1",
  );
}
