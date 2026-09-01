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

export type LearningTrackActivityAdmissionSourceStateV1 =
  | "READY"
  | "NO_CURRENT_PLAN"
  | "CURRENT_TRACK_PORTFOLIO_UNAVAILABLE"
  | "NO_ELIGIBLE_ACTIVITIES"
  | "PLAN_ACTIVITY_LIMIT_REACHED"
  | "ELIGIBLE_ACTIVITY_PORTFOLIO_OVERFLOW";
export type LearningTrackActivityAdmissionSourceStateV2 =
  | "READY"
  | "NO_CURRENT_PLAN"
  | "NO_CURRENT_TRACKS"
  | "CURRENT_TRACK_PORTFOLIO_UNAVAILABLE"
  | "SELECTED_TRACK_UNAVAILABLE"
  | "NO_ELIGIBLE_ACTIVITIES"
  | "PLAN_ACTIVITY_LIMIT_REACHED"
  | "ELIGIBLE_ACTIVITY_PORTFOLIO_OVERFLOW";
export type LearningTrackActivityAdmissionEnergyV1 = "LOW" | "MEDIUM" | "HIGH" | null;
export type LearningTrackActivityTypeV1 =
  "MANUAL_CODING" | "READING" | "EXPLANATION" | "MOCK" | "PROJECT";

export interface LearningTrackActivityAdmissionChoiceV1 {
  readonly activityKey: string;
  readonly title: string;
  readonly activityType: LearningTrackActivityTypeV1;
  readonly targetCompetencyRef: string;
}

export interface LearningTrackActivityAdmissionPlanV1 {
  readonly title: string;
  readonly lifecycle: "ACTIVE" | "PAUSED";
  readonly weeklyCapacityMinutes: number;
  readonly aggregateVersion: string;
}

export interface LearningTrackActivityAdmissionTrackV1 {
  readonly trackKey: string;
  readonly title: string;
  readonly lifecycle: "ACTIVE" | "PAUSED";
  readonly priority: number;
  readonly protectedMinimumMinutes: number;
  readonly defaultSessionMinutes: number;
  readonly aggregateVersion: string;
}

export interface LearningTrackActivityAdmissionSourceV1 {
  readonly contract: {
    readonly name: "LearningTrackActivityAdmissionSourceV1";
    readonly version: "1.0.0";
  };
  readonly state: LearningTrackActivityAdmissionSourceStateV1;
  readonly capabilities: readonly [] | readonly ["admit_activity_to_learning_track"];
  readonly growthPlan: LearningTrackActivityAdmissionPlanV1 | null;
  readonly learningTrack: LearningTrackActivityAdmissionTrackV1 | null;
  readonly activities: readonly LearningTrackActivityAdmissionChoiceV1[];
}

export interface LearningTrackActivityAdmissionSourceV2 {
  readonly contract: {
    readonly name: "LearningTrackActivityAdmissionSourceV2";
    readonly version: "2.0.0";
  };
  readonly state: LearningTrackActivityAdmissionSourceStateV2;
  readonly capabilities: readonly [] | readonly ["admit_activity_to_learning_track"];
  readonly growthPlan: LearningTrackActivityAdmissionPlanV1 | null;
  readonly selectedTrack: LearningTrackActivityAdmissionTrackV1 | null;
  readonly activities: readonly LearningTrackActivityAdmissionChoiceV1[];
}

export interface LearningTrackActivityAdmissionPreviewV1 {
  readonly contract: {
    readonly name: "LearningTrackActivityAdmissionPreviewV1";
    readonly version: "1.0.0";
  };
  readonly digestVersion: "learning-track-activity-admission-preview-digest/1.0.0";
  readonly operation: "admit_activity_to_learning_track";
  readonly commandType: "planning.add_learning_track_activity_v2";
  readonly requestId: string;
  readonly reason: string;
  readonly expectedGrowthPlanVersion: string;
  readonly expectedLearningTrackVersion: string;
  readonly growthPlan: LearningTrackActivityAdmissionPlanV1;
  readonly learningTrack: Omit<LearningTrackActivityAdmissionTrackV1, "aggregateVersion"> & {
    readonly aggregateVersionBefore: string;
    readonly aggregateVersionAfter: string;
  };
  readonly activity: LearningTrackActivityAdmissionChoiceV1 & {
    readonly candidateKey: string;
    readonly estimatedMinutes: number;
    readonly energy: LearningTrackActivityAdmissionEnergyV1;
  };
  readonly constraint: {
    readonly planActivityCountBefore: number;
    readonly planActivityCountAfter: number;
    readonly planActivityLimit: 200;
  };
  readonly canApply: boolean;
  readonly blockingReasons: readonly { readonly code: "PLAN_ACTIVITY_LIMIT_REACHED" }[];
  readonly warnings: readonly {
    readonly code: "PARENT_GROWTH_PLAN_PAUSED" | "LEARNING_TRACK_PAUSED";
  }[];
  readonly retained: {
    readonly activitiesAndEvidence: true;
    readonly planSnapshots: true;
    readonly focusSessions: true;
    readonly masteryAndReadiness: true;
  };
  readonly recalculationAfterApply: {
    readonly projectionState: "PENDING";
    readonly eventChangeKind: "TRACK_ACTIVITY_ADMITTED";
    readonly consumerName: "planning.plan_snapshot_v1";
  };
  readonly previewDigest: string;
}

export interface LearningTrackActivityAdmissionApplyResultV1 {
  readonly contract: {
    readonly name: "LearningTrackActivityAdmissionApplyResultV1";
    readonly version: "1.0.0";
  };
  readonly commandId: string;
  readonly changedTrack: { readonly trackKey: string; readonly aggregateVersion: string };
  readonly admittedActivity: {
    readonly activityKey: string;
    readonly candidateKey: string;
    readonly estimatedMinutes: number;
    readonly energy: LearningTrackActivityAdmissionEnergyV1;
  };
  readonly projectionState: "PENDING";
  readonly planningDeliveryId: string;
  readonly emittedEventIds: readonly [string];
}

export interface LearningTrackActivityAdmissionPreviewV2 {
  readonly contract: {
    readonly name: "LearningTrackActivityAdmissionPreviewV2";
    readonly version: "2.0.0";
  };
  readonly digestVersion: "learning-track-activity-admission-preview-digest/2.0.0";
  readonly operation: "admit_activity_to_learning_track";
  readonly commandType: "planning.add_learning_track_activity_v3";
  readonly requestId: string;
  readonly reason: string;
  readonly expectedGrowthPlanVersion: string;
  readonly expectedLearningTrackVersion: string;
  readonly growthPlan: LearningTrackActivityAdmissionPlanV1;
  readonly learningTrack: Omit<LearningTrackActivityAdmissionTrackV1, "aggregateVersion"> & {
    readonly aggregateVersionBefore: string;
    readonly aggregateVersionAfter: string;
  };
  readonly activity: LearningTrackActivityAdmissionChoiceV1 & {
    readonly candidateKey: string;
    readonly estimatedMinutes: number;
    readonly energy: LearningTrackActivityAdmissionEnergyV1;
  };
  readonly constraint: {
    readonly planActivityCountBefore: number;
    readonly planActivityCountAfter: number;
    readonly planActivityLimit: 200;
    readonly currentTrackOrderFingerprint: string;
  };
  readonly canApply: boolean;
  readonly blockingReasons: readonly { readonly code: "PLAN_ACTIVITY_LIMIT_REACHED" }[];
  readonly warnings: readonly {
    readonly code: "PARENT_GROWTH_PLAN_PAUSED" | "LEARNING_TRACK_PAUSED";
  }[];
  readonly retained: {
    readonly activitiesAndEvidence: true;
    readonly planSnapshots: true;
    readonly focusSessions: true;
    readonly masteryAndReadiness: true;
  };
  readonly recalculationAfterApply: {
    readonly projectionState: "PENDING";
    readonly eventChangeKind: "TRACK_ACTIVITY_ADMITTED";
    readonly consumerName: "planning.plan_snapshot_v1";
  };
  readonly previewDigest: string;
}

export interface LearningTrackActivityAdmissionApplyResultV2 {
  readonly contract: {
    readonly name: "LearningTrackActivityAdmissionApplyResultV2";
    readonly version: "2.0.0";
  };
  readonly commandId: string;
  readonly changedTrack: { readonly trackKey: string; readonly aggregateVersion: string };
  readonly admittedActivity: {
    readonly activityKey: string;
    readonly candidateKey: string;
    readonly estimatedMinutes: number;
    readonly energy: LearningTrackActivityAdmissionEnergyV1;
  };
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

function sourceViolations(root: JsonObject): ContractViolation[] {
  const activities = asArray(root.activities);
  const keys = activities.map((entry) =>
    asString(asJsonObject(entry, "activity choice").activityKey),
  ) as string[];
  const violations: ContractViolation[] = [];
  if (!isSorted(keys)) {
    violations.push(
      violation(
        "ACTIVITY_ADMISSION_SOURCE_ORDER",
        "/activities",
        "Eligible activities must use stable ASCII activity-key order.",
      ),
    );
  }
  if (hasDuplicates(keys)) {
    violations.push(
      violation(
        "ACTIVITY_ADMISSION_SOURCE_DUPLICATE",
        "/activities",
        "Eligible activity keys must be unique.",
      ),
    );
  }
  activities.forEach((entry, index) => {
    if (hasControlCharacters(asJsonObject(entry, "activity choice").title)) {
      violations.push(
        violation(
          "ACTIVITY_ADMISSION_UNSAFE_TEXT",
          `/activities/${index}/title`,
          "Activity labels must not contain control characters.",
        ),
      );
    }
  });
  return violations;
}

function sourceV2Violations(root: JsonObject): ContractViolation[] {
  const activities = asArray(root.activities);
  const keys = activities.map((entry) =>
    asString(asJsonObject(entry, "activity choice").activityKey),
  ) as string[];
  const violations: ContractViolation[] = [];
  const state = asString(root.state);
  const selectedTrack = root.selectedTrack;

  if (!isSorted(keys)) {
    violations.push(
      violation(
        "ACTIVITY_ADMISSION_SOURCE_ORDER",
        "/activities",
        "Eligible activities must use stable ASCII activity-key order.",
      ),
    );
  }
  if (hasDuplicates(keys)) {
    violations.push(
      violation(
        "ACTIVITY_ADMISSION_SOURCE_DUPLICATE",
        "/activities",
        "Eligible activity keys must be unique.",
      ),
    );
  }
  activities.forEach((entry, index) => {
    if (hasControlCharacters(asJsonObject(entry, "activity choice").title)) {
      violations.push(
        violation(
          "ACTIVITY_ADMISSION_UNSAFE_TEXT",
          `/activities/${index}/title`,
          "Activity labels must not contain control characters.",
        ),
      );
    }
  });
  if (
    (state === "NO_CURRENT_TRACKS" ||
      state === "CURRENT_TRACK_PORTFOLIO_UNAVAILABLE" ||
      state === "SELECTED_TRACK_UNAVAILABLE") &&
    selectedTrack !== null
  ) {
    violations.push(
      violation(
        "ACTIVITY_ADMISSION_SELECTED_TRACK_BINDING",
        "/selectedTrack",
        "Unavailable destination states must not expose a selected Track.",
      ),
    );
  }
  return violations;
}

function previewViolations(root: JsonObject): ContractViolation[] {
  const plan = asJsonObject(root.growthPlan, "admission Plan");
  const track = asJsonObject(root.learningTrack, "admission Track");
  const activity = asJsonObject(root.activity, "admission activity");
  const constraint = asJsonObject(root.constraint, "admission constraint");
  const blockers = asArray(root.blockingReasons);
  const warnings = asArray(root.warnings).map((entry) =>
    asString(asJsonObject(entry, "admission warning").code),
  );
  const violations: ContractViolation[] = [];
  if (
    hasControlCharacters(root.reason) ||
    hasControlCharacters(plan.title) ||
    hasControlCharacters(track.title) ||
    hasControlCharacters(activity.title)
  ) {
    violations.push(
      violation(
        "ACTIVITY_ADMISSION_UNSAFE_TEXT",
        "/",
        "Preview text must not contain control characters.",
      ),
    );
  }
  if (
    root.expectedGrowthPlanVersion !== plan.aggregateVersion ||
    root.expectedLearningTrackVersion !== track.aggregateVersionBefore
  ) {
    violations.push(
      violation(
        "ACTIVITY_ADMISSION_VERSION_BINDING",
        "/",
        "Expected versions must bind the exact previewed Plan and Track.",
      ),
    );
  }
  try {
    if (
      BigInt(String(track.aggregateVersionAfter)) !==
      BigInt(String(track.aggregateVersionBefore)) + 1n
    ) {
      violations.push(
        violation(
          "ACTIVITY_ADMISSION_TRACK_INCREMENT",
          "/learningTrack/aggregateVersionAfter",
          "Admission must increment the Track version exactly once.",
        ),
      );
    }
  } catch {
    violations.push(
      violation(
        "ACTIVITY_ADMISSION_TRACK_INCREMENT",
        "/learningTrack/aggregateVersionAfter",
        "Admission Track versions must be valid positive integers.",
      ),
    );
  }
  const requestId = asString(root.requestId)!;
  if (requestId !== requestId.toLowerCase() || activity.candidateKey !== `candidate:${requestId}`) {
    violations.push(
      violation(
        "ACTIVITY_ADMISSION_CANDIDATE_BINDING",
        "/activity/candidateKey",
        "Candidate identity must be derived from the lowercase request UUID.",
      ),
    );
  }
  const before = asNumber(constraint.planActivityCountBefore)!;
  const after = asNumber(constraint.planActivityCountAfter)!;
  const shouldApply = before < 200;
  const blockerCode =
    blockers.length === 1
      ? asString(asJsonObject(blockers[0], "admission blocker").code)
      : undefined;
  if (
    after !== before + 1 ||
    root.canApply !== shouldApply ||
    blockerCode !== (shouldApply ? undefined : "PLAN_ACTIVITY_LIMIT_REACHED") ||
    blockers.length !== (shouldApply ? 0 : 1)
  ) {
    violations.push(
      violation(
        "ACTIVITY_ADMISSION_APPLICABILITY",
        "/constraint",
        "Count, applicability and blocker must agree with the 200-activity limit.",
      ),
    );
  }
  const expectedWarnings = [
    ...(plan.lifecycle === "PAUSED" ? ["PARENT_GROWTH_PLAN_PAUSED"] : []),
    ...(track.lifecycle === "PAUSED" ? ["LEARNING_TRACK_PAUSED"] : []),
  ];
  if (
    warnings.length !== expectedWarnings.length ||
    warnings.some((item, i) => item !== expectedWarnings[i])
  ) {
    violations.push(
      violation(
        "ACTIVITY_ADMISSION_WARNING_ORDER",
        "/warnings",
        "Paused-state warnings must be complete and deterministically ordered.",
      ),
    );
  }
  return violations;
}

function previewV2Violations(root: JsonObject): ContractViolation[] {
  const plan = asJsonObject(root.growthPlan, "admission Plan");
  const track = asJsonObject(root.learningTrack, "admission Track");
  const activity = asJsonObject(root.activity, "admission activity");
  const constraint = asJsonObject(root.constraint, "admission constraint");
  const blockers = asArray(root.blockingReasons);
  const warnings = asArray(root.warnings).map((entry) =>
    asString(asJsonObject(entry, "admission warning").code),
  );
  const violations: ContractViolation[] = [];

  if (
    hasControlCharacters(root.reason) ||
    hasControlCharacters(plan.title) ||
    hasControlCharacters(track.title) ||
    hasControlCharacters(activity.title)
  ) {
    violations.push(
      violation(
        "ACTIVITY_ADMISSION_UNSAFE_TEXT",
        "/",
        "Preview text must not contain control characters.",
      ),
    );
  }
  if (
    root.expectedGrowthPlanVersion !== plan.aggregateVersion ||
    root.expectedLearningTrackVersion !== track.aggregateVersionBefore
  ) {
    violations.push(
      violation(
        "ACTIVITY_ADMISSION_VERSION_BINDING",
        "/",
        "Expected versions must bind the exact previewed Plan and Track.",
      ),
    );
  }
  try {
    if (
      BigInt(String(track.aggregateVersionAfter)) !==
      BigInt(String(track.aggregateVersionBefore)) + 1n
    ) {
      violations.push(
        violation(
          "ACTIVITY_ADMISSION_TRACK_INCREMENT",
          "/learningTrack/aggregateVersionAfter",
          "Admission must increment the Track version exactly once.",
        ),
      );
    }
  } catch {
    violations.push(
      violation(
        "ACTIVITY_ADMISSION_TRACK_INCREMENT",
        "/learningTrack/aggregateVersionAfter",
        "Admission Track versions must be valid positive integers.",
      ),
    );
  }
  const requestId = asString(root.requestId)!;
  if (requestId !== requestId.toLowerCase() || activity.candidateKey !== `candidate:${requestId}`) {
    violations.push(
      violation(
        "ACTIVITY_ADMISSION_CANDIDATE_BINDING",
        "/activity/candidateKey",
        "Candidate identity must be derived from the lowercase request UUID.",
      ),
    );
  }
  const before = asNumber(constraint.planActivityCountBefore)!;
  const after = asNumber(constraint.planActivityCountAfter)!;
  const shouldApply = before < 200;
  const blockerCode =
    blockers.length === 1
      ? asString(asJsonObject(blockers[0], "admission blocker").code)
      : undefined;
  if (
    after !== before + 1 ||
    root.canApply !== shouldApply ||
    blockerCode !== (shouldApply ? undefined : "PLAN_ACTIVITY_LIMIT_REACHED") ||
    blockers.length !== (shouldApply ? 0 : 1)
  ) {
    violations.push(
      violation(
        "ACTIVITY_ADMISSION_APPLICABILITY",
        "/constraint",
        "Count, applicability and blocker must agree with the 200-activity limit.",
      ),
    );
  }
  if (hasControlCharacters(constraint.currentTrackOrderFingerprint)) {
    violations.push(
      violation(
        "ACTIVITY_ADMISSION_TRACK_ORDER_FINGERPRINT",
        "/constraint/currentTrackOrderFingerprint",
        "Current Track order fingerprint must be a stable digest value.",
      ),
    );
  }
  const expectedWarnings = [
    ...(plan.lifecycle === "PAUSED" ? ["PARENT_GROWTH_PLAN_PAUSED"] : []),
    ...(track.lifecycle === "PAUSED" ? ["LEARNING_TRACK_PAUSED"] : []),
  ];
  if (
    warnings.length !== expectedWarnings.length ||
    warnings.some((item, i) => item !== expectedWarnings[i])
  ) {
    violations.push(
      violation(
        "ACTIVITY_ADMISSION_WARNING_ORDER",
        "/warnings",
        "Paused-state warnings must be complete and deterministically ordered.",
      ),
    );
  }
  return violations;
}

function applyViolations(root: JsonObject): ContractViolation[] {
  const activity = asJsonObject(root.admittedActivity, "admitted activity");
  const ids = [root.commandId, root.planningDeliveryId, ...asArray(root.emittedEventIds)];
  return ids.some((id) => typeof id !== "string" || id !== id.toLowerCase()) ||
    (typeof activity.candidateKey === "string" &&
      activity.candidateKey !== activity.candidateKey.toLowerCase())
    ? [
        violation(
          "ACTIVITY_ADMISSION_UUID_CASE",
          "/",
          "Admission UUID-derived values must use lowercase representation.",
        ),
      ]
    : [];
}

export function learningTrackActivityAdmissionControlSemanticViolations(
  value: unknown,
): readonly ContractViolation[] {
  const root = asJsonObject(value, "Learning Track activity admission response");
  const contract = asJsonObject(root.contract, "activity admission contract");
  switch (asString(contract.name)) {
    case "LearningTrackActivityAdmissionSourceV1":
      return sourceViolations(root);
    case "LearningTrackActivityAdmissionSourceV2":
      return sourceV2Violations(root);
    case "LearningTrackActivityAdmissionPreviewV1":
      return previewViolations(root);
    case "LearningTrackActivityAdmissionPreviewV2":
      return previewV2Violations(root);
    case "LearningTrackActivityAdmissionApplyResultV1":
      return applyViolations(root);
    case "LearningTrackActivityAdmissionApplyResultV2":
      return applyViolations(root);
    default:
      return [
        violation(
          "ACTIVITY_ADMISSION_CONTRACT",
          "/contract/name",
          "Unsupported Learning Track activity admission contract.",
        ),
      ];
  }
}

export function validateLearningTrackActivityAdmissionControlV1(value: unknown): ValidationResult {
  const structural = validateSchema("learning-track-activity-admission-control-v1", value);
  return structural.valid
    ? validationResult(learningTrackActivityAdmissionControlSemanticViolations(value))
    : structural;
}

export class LearningTrackActivityAdmissionContractError extends TypeError {
  readonly violations: readonly ContractViolation[];

  constructor(violations: readonly ContractViolation[]) {
    super("Learning Track activity admission response failed its contract.");
    this.name = "LearningTrackActivityAdmissionContractError";
    this.violations = violations.map(({ code, path, message }) => ({ code, path, message }));
  }
}

function decodeNamed<T>(value: unknown, expectedName: string): T {
  const validation = validateLearningTrackActivityAdmissionControlV1(value);
  if (!validation.valid)
    throw new LearningTrackActivityAdmissionContractError(validation.violations);
  const root = asJsonObject(value, expectedName);
  if (asJsonObject(root.contract, `${expectedName} contract`).name !== expectedName) {
    throw new LearningTrackActivityAdmissionContractError([
      violation("ACTIVITY_ADMISSION_CONTRACT", "/contract/name", `Expected ${expectedName}.`),
    ]);
  }
  return value as T;
}

export function decodeLearningTrackActivityAdmissionSourceV1(
  value: unknown,
): LearningTrackActivityAdmissionSourceV1 {
  return decodeNamed(value, "LearningTrackActivityAdmissionSourceV1");
}

export function decodeLearningTrackActivityAdmissionSourceV2(
  value: unknown,
): LearningTrackActivityAdmissionSourceV2 {
  return decodeNamed(value, "LearningTrackActivityAdmissionSourceV2");
}

export function decodeLearningTrackActivityAdmissionPreviewV1(
  value: unknown,
): LearningTrackActivityAdmissionPreviewV1 {
  return decodeNamed(value, "LearningTrackActivityAdmissionPreviewV1");
}

export function decodeLearningTrackActivityAdmissionPreviewV2(
  value: unknown,
): LearningTrackActivityAdmissionPreviewV2 {
  return decodeNamed(value, "LearningTrackActivityAdmissionPreviewV2");
}

export function decodeLearningTrackActivityAdmissionApplyResultV1(
  value: unknown,
): LearningTrackActivityAdmissionApplyResultV1 {
  return decodeNamed(value, "LearningTrackActivityAdmissionApplyResultV1");
}

export function decodeLearningTrackActivityAdmissionApplyResultV2(
  value: unknown,
): LearningTrackActivityAdmissionApplyResultV2 {
  return decodeNamed(value, "LearningTrackActivityAdmissionApplyResultV2");
}
