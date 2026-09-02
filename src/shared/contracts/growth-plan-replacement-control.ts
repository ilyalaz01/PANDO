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

export type GrowthPlanReplacementState =
  "REPLACEMENT_AVAILABLE" | "NO_CURRENT_PLAN" | "NO_ACTIVE_GOALS" | "GOAL_PORTFOLIO_OVERFLOW";

export interface GrowthPlanReplacementGoalV1 {
  readonly readinessGoalKey: string;
  readonly title: string;
  readonly profileLabel: string;
  readonly profileVersionKey: string;
  readonly roadmapPresent: boolean;
  readonly aggregateVersion: string;
}

export interface GrowthPlanReplacementTrackCountsV1 {
  readonly total: number;
  readonly active: number;
  readonly paused: number;
  readonly completed: number;
  readonly archived: number;
}

export type GrowthPlanReplacementSourceV1 =
  | {
      readonly contract: {
        readonly name: "GrowthPlanReplacementSourceV1";
        readonly version: "1.0.0";
      };
      readonly state: "REPLACEMENT_AVAILABLE";
      readonly capabilities: readonly ["replace_growth_plan"];
      readonly currentPlan: {
        readonly title: string;
        readonly lifecycle: "ACTIVE" | "PAUSED";
        readonly weeklyCapacityMinutes: number;
        readonly aggregateVersion: string;
        readonly childTracks: GrowthPlanReplacementTrackCountsV1;
      };
      readonly goals: readonly GrowthPlanReplacementGoalV1[];
    }
  | {
      readonly contract: {
        readonly name: "GrowthPlanReplacementSourceV1";
        readonly version: "1.0.0";
      };
      readonly state: Exclude<GrowthPlanReplacementState, "REPLACEMENT_AVAILABLE">;
      readonly capabilities: readonly [];
      readonly currentPlan: null;
      readonly goals: readonly [];
    };

export interface GrowthPlanReplacementArchivedPlanStateV1 {
  readonly growthPlanId: string;
  readonly title: string;
  readonly lifecycle: "ARCHIVED";
  readonly weeklyCapacityMinutes: number;
  readonly aggregateVersion: string;
}

export interface GrowthPlanReplacementPlanStateV1 {
  readonly growthPlanId: string;
  readonly title: string;
  readonly lifecycle: "ACTIVE";
  readonly weeklyCapacityMinutes: number;
  readonly aggregateVersion: "1";
}

export interface GrowthPlanReplacementTrackStateV1 {
  readonly learningTrackId: string;
  readonly trackKey: string;
  readonly title: string;
  readonly lifecycle: "ACTIVE";
  readonly priority: number;
  readonly protectedMinimumMinutes: 0;
  readonly cadencePerWeek: 0;
  readonly defaultSessionMinutes: number;
  readonly aggregateVersion: "1";
}

export interface GrowthPlanReplacementPreviewV1 {
  readonly contract: { readonly name: "GrowthPlanReplacementPreviewV1"; readonly version: "1.0.0" };
  readonly digestVersion: "growth-plan-replacement-preview-digest/1.0.0";
  readonly identityVersion: "planning-create-identity/1.0.0";
  readonly operation: "replace_growth_plan";
  readonly commandType: "planning.replace_growth_plan_v1";
  readonly idempotencyKey: string;
  readonly reason: string;
  readonly expectedReadinessGoalVersion: string;
  readonly expectedGrowthPlanVersion: string;
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
    readonly currentPlanCount: 1;
    readonly growthPlan: {
      readonly growthPlanId: string;
      readonly title: string;
      readonly lifecycle: "ACTIVE" | "PAUSED";
      readonly weeklyCapacityMinutes: number;
      readonly aggregateVersion: string;
    };
    readonly childTracks: GrowthPlanReplacementTrackCountsV1 & { readonly fingerprint: string };
  };
  readonly after: {
    readonly lifetimePlanCount: number;
    readonly currentPlanCount: 1;
    readonly currentPlanLimit: 1;
    readonly archivedPlan: GrowthPlanReplacementArchivedPlanStateV1;
    readonly growthPlan: GrowthPlanReplacementPlanStateV1;
    readonly learningTrack: GrowthPlanReplacementTrackStateV1;
  };
  readonly canApply: boolean;
  readonly blockingReasons: readonly { readonly code: "PLANNING_CREATE_IDENTITY_COLLISION" }[];
  readonly warnings: readonly {
    readonly code:
      | "ARCHIVED_PLAN_IS_READ_ONLY"
      | "CURRENT_TRACKS_NOT_COPIED"
      | "INITIAL_TRACK_HAS_NO_ACTIVITIES";
  }[];
  readonly retained: {
    readonly readinessGoal: true;
    readonly archivedPlan: true;
    readonly learningTrackHistory: true;
    readonly activitiesAndEvidence: true;
    readonly mastery: true;
    readonly reviews: true;
    readonly planSnapshots: true;
  };
  readonly recalculationAfterApply: {
    readonly projectionState: "PENDING";
    readonly eventChangeKind: "PLAN_REPLACED";
    readonly consumerName: "planning.plan_snapshot_v1";
  };
  readonly previewDigest: string;
}

export interface GrowthPlanReplacementApplyResultV1 {
  readonly contract: {
    readonly name: "GrowthPlanReplacementApplyResultV1";
    readonly version: "1.0.0";
  };
  readonly commandId: string;
  readonly archivedPlan: GrowthPlanReplacementArchivedPlanStateV1;
  readonly createdPlan: GrowthPlanReplacementPlanStateV1;
  readonly createdTrack: GrowthPlanReplacementTrackStateV1;
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

function isLowercase(value: JsonValue | undefined): boolean {
  return typeof value === "string" && value === value.toLowerCase();
}

function countsAgree(counts: JsonObject): boolean {
  const total = asNumber(counts.total);
  const active = asNumber(counts.active);
  const paused = asNumber(counts.paused);
  const completed = asNumber(counts.completed);
  const archived = asNumber(counts.archived);
  if (
    total === undefined ||
    active === undefined ||
    paused === undefined ||
    completed === undefined ||
    archived === undefined
  ) {
    return false;
  }
  return active + paused + completed + archived === total;
}

function sourceSemanticViolations(root: JsonObject): ContractViolation[] {
  const violations: ContractViolation[] = [];
  if (root.state !== "REPLACEMENT_AVAILABLE") return violations;
  const goals = asArray(root.goals);
  const keys = goals.map((item) =>
    asString(asJsonObject(item, "replacement goal").readinessGoalKey)!,
  );
  if (!isSorted(keys)) {
    violations.push(
      semanticViolation(
        "GROWTH_PLAN_REPLACEMENT_GOAL_ORDER",
        "/goals",
        "Replacement goals must use stable ASCII readiness-goal-key order.",
      ),
    );
  }
  if (hasDuplicates(keys)) {
    violations.push(
      semanticViolation(
        "GROWTH_PLAN_REPLACEMENT_GOAL_DUPLICATE",
        "/goals",
        "Replacement readiness goal keys must be unique.",
      ),
    );
  }
  goals.forEach((item, index) => {
    const goal = asJsonObject(item, "replacement goal");
    if (hasControlCharacters(goal.title) || hasControlCharacters(goal.profileLabel)) {
      violations.push(
        semanticViolation(
          "GROWTH_PLAN_REPLACEMENT_UNSAFE_TEXT",
          `/goals/${index}`,
          "Replacement labels must not contain control characters.",
        ),
      );
    }
  });
  const currentPlan = asJsonObject(root.currentPlan, "current plan");
  if (hasControlCharacters(currentPlan.title)) {
    violations.push(
      semanticViolation(
        "GROWTH_PLAN_REPLACEMENT_UNSAFE_TEXT",
        "/currentPlan/title",
        "Current Plan title must not contain control characters.",
      ),
    );
  }
  if (!countsAgree(asJsonObject(currentPlan.childTracks, "child tracks"))) {
    violations.push(
      semanticViolation(
        "GROWTH_PLAN_REPLACEMENT_TRACK_COUNTS",
        "/currentPlan/childTracks",
        "Child Track lifecycle counts must sum to the reported total.",
      ),
    );
  }
  return violations;
}

function expectedWarningCodes(childTracks: JsonObject): string[] {
  const active = asNumber(childTracks.active) ?? 0;
  const paused = asNumber(childTracks.paused) ?? 0;
  const completed = asNumber(childTracks.completed) ?? 0;
  const codes = ["ARCHIVED_PLAN_IS_READ_ONLY"];
  if (active + paused + completed > 0) codes.push("CURRENT_TRACKS_NOT_COPIED");
  codes.push("INITIAL_TRACK_HAS_NO_ACTIVITIES");
  return codes;
}

function previewSemanticViolations(root: JsonObject): ContractViolation[] {
  const source = asJsonObject(root.source, "replacement source");
  const before = asJsonObject(root.before, "replacement before");
  const after = asJsonObject(root.after, "replacement after");
  const outgoing = asJsonObject(before.growthPlan, "outgoing plan");
  const childTracks = asJsonObject(before.childTracks, "child tracks");
  const archived = asJsonObject(after.archivedPlan, "archived plan");
  const plan = asJsonObject(after.growthPlan, "created plan");
  const track = asJsonObject(after.learningTrack, "created track");
  const violations: ContractViolation[] = [];

  if (
    hasControlCharacters(root.reason) ||
    hasControlCharacters(source.readinessGoalTitle) ||
    hasControlCharacters(outgoing.title)
  ) {
    violations.push(
      semanticViolation(
        "GROWTH_PLAN_REPLACEMENT_UNSAFE_TEXT",
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
        "GROWTH_PLAN_REPLACEMENT_SOURCE_VERSION",
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
        "GROWTH_PLAN_REPLACEMENT_SOURCE_BINDING",
        "/source",
        "Source kind, reference, roadmap, and immutable profile must agree.",
      ),
    );
  }
  if (
    !isLowercase(root.idempotencyKey) ||
    !isLowercase(source.readinessGoalId) ||
    !isLowercase(source.profileVersionId) ||
    !isLowercase(source.sourceRef) ||
    (source.roadmapVersionId !== null && !isLowercase(source.roadmapVersionId)) ||
    !isLowercase(outgoing.growthPlanId) ||
    !isLowercase(archived.growthPlanId) ||
    !isLowercase(plan.growthPlanId) ||
    !isLowercase(track.learningTrackId)
  ) {
    violations.push(
      semanticViolation(
        "GROWTH_PLAN_REPLACEMENT_UUID_CASE",
        "/",
        "Replacement UUID values must use their exact lowercase representation.",
      ),
    );
  }

  if (root.expectedGrowthPlanVersion !== outgoing.aggregateVersion) {
    violations.push(
      semanticViolation(
        "GROWTH_PLAN_REPLACEMENT_PLAN_VERSION",
        "/expectedGrowthPlanVersion",
        "The expected Plan version must bind the observed outgoing Plan version.",
      ),
    );
  }
  const outgoingVersion = BigInt(String(outgoing.aggregateVersion));
  if (
    archived.growthPlanId !== outgoing.growthPlanId ||
    archived.title !== outgoing.title ||
    archived.weeklyCapacityMinutes !== outgoing.weeklyCapacityMinutes ||
    archived.aggregateVersion !== String(outgoingVersion + 1n)
  ) {
    violations.push(
      semanticViolation(
        "GROWTH_PLAN_REPLACEMENT_ARCHIVE_TRANSITION",
        "/after/archivedPlan",
        "Archiving must advance the outgoing Plan by one version and change nothing else.",
      ),
    );
  }
  if (plan.growthPlanId === outgoing.growthPlanId) {
    violations.push(
      semanticViolation(
        "GROWTH_PLAN_REPLACEMENT_PLAN_IDENTITY",
        "/after/growthPlan/growthPlanId",
        "The incoming Plan must be a different aggregate from the archived Plan.",
      ),
    );
  }
  if (plan.title !== source.readinessGoalTitle) {
    violations.push(
      semanticViolation(
        "GROWTH_PLAN_REPLACEMENT_PLAN_TITLE",
        "/after/growthPlan/title",
        "The incoming Plan title must equal the authoritative Goal title.",
      ),
    );
  }
  if (track.title !== initialLearningTrackTitle(String(source.readinessGoalTitle))) {
    violations.push(
      semanticViolation(
        "GROWTH_PLAN_REPLACEMENT_TRACK_TITLE",
        "/after/learningTrack/title",
        "The incoming Track title must use PostgreSQL btrim(left(goal title, 160)) semantics.",
      ),
    );
  }
  if (track.trackKey !== `track:${String(track.learningTrackId).toLowerCase()}`) {
    violations.push(
      semanticViolation(
        "GROWTH_PLAN_REPLACEMENT_TRACK_KEY",
        "/after/learningTrack/trackKey",
        "The incoming Track key must bind its derived UUID.",
      ),
    );
  }
  if (!countsAgree(childTracks)) {
    violations.push(
      semanticViolation(
        "GROWTH_PLAN_REPLACEMENT_TRACK_COUNTS",
        "/before/childTracks",
        "Child Track lifecycle counts must sum to the reported total.",
      ),
    );
  }
  const lifetimeBefore = asNumber(before.lifetimePlanCount) ?? 0;
  if (after.lifetimePlanCount !== lifetimeBefore + 1) {
    violations.push(
      semanticViolation(
        "GROWTH_PLAN_REPLACEMENT_CARDINALITY",
        "/after/lifetimePlanCount",
        "Replacement must add exactly one Plan to lifetime history.",
      ),
    );
  }

  const blockers = asArray(root.blockingReasons);
  if (root.canApply !== (blockers.length === 0)) {
    violations.push(
      semanticViolation(
        "GROWTH_PLAN_REPLACEMENT_APPLICABILITY",
        "/canApply",
        "Applicability must exactly reflect the reported blocking reasons.",
      ),
    );
  }
  const warningCodes = asArray(root.warnings).map((item) =>
    String(asJsonObject(item, "warning").code),
  );
  const expected = expectedWarningCodes(childTracks);
  if (warningCodes.length !== expected.length || warningCodes.some((c, i) => c !== expected[i])) {
    violations.push(
      semanticViolation(
        "GROWTH_PLAN_REPLACEMENT_WARNINGS",
        "/warnings",
        "Warnings must exactly describe the archived Plan, its retained Tracks, and the empty new Track.",
      ),
    );
  }
  return violations;
}

function applySemanticViolations(root: JsonObject): ContractViolation[] {
  const archived = asJsonObject(root.archivedPlan, "archived plan");
  const plan = asJsonObject(root.createdPlan, "created plan");
  const track = asJsonObject(root.createdTrack, "created track");
  const violations: ContractViolation[] = [];
  if (
    !isLowercase(root.commandId) ||
    !isLowercase(root.planningDeliveryId) ||
    !asArray(root.emittedEventIds).every(isLowercase) ||
    !isLowercase(archived.growthPlanId) ||
    !isLowercase(plan.growthPlanId) ||
    !isLowercase(track.learningTrackId)
  ) {
    violations.push(
      semanticViolation(
        "GROWTH_PLAN_REPLACEMENT_UUID_CASE",
        "/",
        "Applied-result UUID values must use their exact lowercase representation.",
      ),
    );
  }
  if (archived.growthPlanId === plan.growthPlanId) {
    violations.push(
      semanticViolation(
        "GROWTH_PLAN_REPLACEMENT_PLAN_IDENTITY",
        "/createdPlan/growthPlanId",
        "The created Plan must be a different aggregate from the archived Plan.",
      ),
    );
  }
  if (track.trackKey !== `track:${String(track.learningTrackId).toLowerCase()}`) {
    violations.push(
      semanticViolation(
        "GROWTH_PLAN_REPLACEMENT_TRACK_KEY",
        "/createdTrack/trackKey",
        "The created Track key must bind its derived UUID.",
      ),
    );
  }
  if (track.title !== initialLearningTrackTitle(String(plan.title))) {
    violations.push(
      semanticViolation(
        "GROWTH_PLAN_REPLACEMENT_TRACK_TITLE",
        "/createdTrack/title",
        "The created Track title must be derived from the created Plan title.",
      ),
    );
  }
  if (BigInt(String(archived.aggregateVersion)) < 2n) {
    violations.push(
      semanticViolation(
        "GROWTH_PLAN_REPLACEMENT_ARCHIVE_TRANSITION",
        "/archivedPlan/aggregateVersion",
        "An archived Plan version must be at least two after its archiving increment.",
      ),
    );
  }
  return violations;
}

export function growthPlanReplacementControlSemanticViolations(
  value: unknown,
): readonly ContractViolation[] {
  const root = asJsonObject(value, "Growth Plan replacement control response");
  const contract = asJsonObject(root.contract, "Growth Plan replacement contract");
  const name = asString(contract.name);
  if (name === "GrowthPlanReplacementSourceV1") return sourceSemanticViolations(root);
  if (name === "GrowthPlanReplacementPreviewV1") return previewSemanticViolations(root);
  if (name === "GrowthPlanReplacementApplyResultV1") return applySemanticViolations(root);
  return [
    semanticViolation(
      "GROWTH_PLAN_REPLACEMENT_CONTRACT",
      "/contract/name",
      "Unsupported Growth Plan replacement contract.",
    ),
  ];
}

export function validateGrowthPlanReplacementControlV1(value: unknown): ValidationResult {
  const structural = validateSchema("growth-plan-replacement-control-v1", value);
  return structural.valid
    ? validationResult(growthPlanReplacementControlSemanticViolations(value))
    : structural;
}

export class GrowthPlanReplacementContractError extends TypeError {
  readonly violations: readonly ContractViolation[];

  constructor(violations: readonly ContractViolation[]) {
    super("Growth Plan replacement response failed its contract.");
    this.name = "GrowthPlanReplacementContractError";
    this.violations = violations.map(({ code, path, message }) => ({ code, path, message }));
  }
}

function decodeNamed<T>(value: unknown, expectedName: string): T {
  const validation = validateGrowthPlanReplacementControlV1(value);
  if (!validation.valid) throw new GrowthPlanReplacementContractError(validation.violations);
  const root = asJsonObject(value, expectedName);
  const contract = asJsonObject(root.contract, `${expectedName} contract`);
  if (contract.name !== expectedName) {
    throw new GrowthPlanReplacementContractError([
      semanticViolation(
        "GROWTH_PLAN_REPLACEMENT_CONTRACT",
        "/contract/name",
        `Expected ${expectedName}.`,
      ),
    ]);
  }
  return value as T;
}

export function decodeGrowthPlanReplacementSourceV1(value: unknown): GrowthPlanReplacementSourceV1 {
  return decodeNamed<GrowthPlanReplacementSourceV1>(value, "GrowthPlanReplacementSourceV1");
}

export function decodeGrowthPlanReplacementPreviewV1(
  value: unknown,
): GrowthPlanReplacementPreviewV1 {
  return decodeNamed<GrowthPlanReplacementPreviewV1>(value, "GrowthPlanReplacementPreviewV1");
}

export function decodeGrowthPlanReplacementApplyResultV1(
  value: unknown,
): GrowthPlanReplacementApplyResultV1 {
  return decodeNamed<GrowthPlanReplacementApplyResultV1>(
    value,
    "GrowthPlanReplacementApplyResultV1",
  );
}
