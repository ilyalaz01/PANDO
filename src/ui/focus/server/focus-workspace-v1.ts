import { asArray, asJsonObject, asString, type JsonObject } from "../../../shared/contracts/json";
import { OBJECTIVE_DIMENSIONS, type AchievementLevel } from "../../../modules/mastery/domain/types";

export const FOCUS_RESULT_KINDS = [
  "OBSERVED_SUCCESS",
  "OBSERVED_FAILURE",
  "COMPLETION_ONLY",
] as const;
export type FocusResultKind = (typeof FOCUS_RESULT_KINDS)[number];

export interface FocusActivityV1 {
  readonly activityKey: string;
  readonly title: string;
  readonly activityType: "MANUAL_CODING" | "READING" | "EXPLANATION" | "MOCK" | "PROJECT";
  readonly competencyRef: string;
  readonly evidenceDimension: "KNOWLEDGE" | "RECALL" | "APPLICATION" | "INTERVIEW_EXECUTION";
  readonly expectedEvidence: string;
  readonly resourceUrl: string | null;
}

export interface ActiveFocusSessionV1 {
  readonly focusSessionId: string;
  readonly activityKey: string;
  readonly title: string;
  readonly state: "active";
  readonly plannedMinutes: number;
  readonly sessionVersion: string;
  readonly startedAt: string;
}

export interface FocusHistoryItemV1 {
  readonly focusSessionId: string;
  readonly activityKey: string;
  readonly title: string;
  readonly state: "completed" | "stopped";
  readonly startedAt: string;
  readonly endedAt: string;
  readonly resultKind: FocusResultKind | null;
  readonly evidenceId: string | null;
  readonly evidenceValid: boolean | null;
  readonly dimension: FocusActivityV1["evidenceDimension"] | null;
  readonly outcome: "SUCCESS" | "FAILURE" | null;
  readonly ledgerWatermark: string | null;
}

export interface FocusMasterySummaryV1 {
  readonly engineVersion: "mastery-engine/0.1.0";
  readonly policyVersion: "mastery-readiness-policy/0.1";
  readonly inputWatermark: string;
  readonly competencyId: string;
  readonly calculatedAsOf: string;
  readonly achievementLevel: AchievementLevel;
  readonly explanationCodes: readonly string[];
}

export interface FocusWorkspaceV1 {
  readonly contract: { readonly name: "FocusWorkspaceV1"; readonly version: "1.0.0" };
  readonly readinessGoalKey: string;
  readonly activity: FocusActivityV1 | null;
  readonly activeSession: ActiveFocusSessionV1 | null;
  readonly history: readonly FocusHistoryItemV1[];
  readonly masteryState: FocusMasterySummaryV1 | null;
  readonly projectionState: "not_started" | "pending" | "current";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ACTIVITY_KEY = /^activity:[a-z0-9][a-z0-9-]{1,100}$/u;
const COMPETENCY_REF = /^competency:[a-z0-9][a-z0-9-]{1,100}$/u;
const GOAL_KEY = /^goal:[a-z0-9][a-z0-9-]{1,100}$/u;
const VERSION = /^(0|[1-9][0-9]{0,18})$/u;
const ACTIVITY_TYPES = ["MANUAL_CODING", "READING", "EXPLANATION", "MOCK", "PROJECT"] as const;
const ACHIEVEMENT_LEVELS = ["NOT_STARTED", "COMPLETED", "VERIFIED", "MASTERED"] as const;

function required(object: JsonObject, key: string, label: string): string {
  const value = asString(object[key]);
  if (value === undefined) throw new TypeError(`${label}.${key} must be a string`);
  return value;
}

function nullableString(object: JsonObject, key: string, label: string): string | null {
  if (object[key] === null) return null;
  return required(object, key, label);
}

function timestamp(value: string, label: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T/u.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new TypeError(`${label} must be an ISO timestamp`);
  }
  return value;
}

function safeText(value: string, label: string, maximum: number): string {
  if (
    value.length < 1 ||
    value.length > maximum ||
    value.trim() !== value ||
    /[\u0000-\u001f<>]/u.test(value)
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function oneOf<T extends string>(value: string, allowed: readonly T[], label: string): T {
  if (!allowed.includes(value as T)) throw new TypeError(`${label} is unsupported`);
  return value as T;
}

function version(value: string, label: string): string {
  if (!VERSION.test(value)) throw new TypeError(`${label} is invalid`);
  return value;
}

function activity(value: unknown): FocusActivityV1 | null {
  if (value === null) return null;
  const item = asJsonObject(value, "FocusWorkspaceV1.activity");
  const activityKey = required(item, "activityKey", "activity");
  const competencyRef = required(item, "competencyRef", "activity");
  if (!ACTIVITY_KEY.test(activityKey) || !COMPETENCY_REF.test(competencyRef)) {
    throw new TypeError("activity identity is invalid");
  }
  const rawResourceUrl = nullableString(item, "resourceUrl", "activity");
  if (rawResourceUrl !== null) {
    const url = new URL(rawResourceUrl);
    if (url.protocol !== "https:" || url.username !== "" || url.password !== "") {
      throw new TypeError("activity.resourceUrl is invalid");
    }
  }
  return {
    activityKey,
    title: safeText(required(item, "title", "activity"), "activity.title", 200),
    activityType: oneOf(
      required(item, "activityType", "activity"),
      ACTIVITY_TYPES,
      "activity.type",
    ),
    competencyRef,
    evidenceDimension: oneOf(
      required(item, "evidenceDimension", "activity"),
      OBJECTIVE_DIMENSIONS,
      "activity.evidenceDimension",
    ),
    expectedEvidence: safeText(
      required(item, "expectedEvidence", "activity"),
      "activity.expectedEvidence",
      500,
    ),
    resourceUrl: rawResourceUrl,
  };
}

function activeSession(value: unknown): ActiveFocusSessionV1 | null {
  if (value === null) return null;
  const item = asJsonObject(value, "FocusWorkspaceV1.activeSession");
  const focusSessionId = required(item, "focusSessionId", "activeSession");
  const activityKey = required(item, "activityKey", "activeSession");
  const state = required(item, "state", "activeSession");
  const plannedMinutes = item.plannedMinutes;
  if (
    !UUID.test(focusSessionId) ||
    !ACTIVITY_KEY.test(activityKey) ||
    state !== "active" ||
    typeof plannedMinutes !== "number" ||
    !Number.isSafeInteger(plannedMinutes) ||
    plannedMinutes < 1 ||
    plannedMinutes > 480
  ) {
    throw new TypeError("active session is invalid");
  }
  return {
    focusSessionId,
    activityKey,
    title: safeText(required(item, "title", "activeSession"), "activeSession.title", 200),
    state: "active",
    plannedMinutes,
    sessionVersion: version(required(item, "sessionVersion", "activeSession"), "sessionVersion"),
    startedAt: timestamp(required(item, "startedAt", "activeSession"), "activeSession.startedAt"),
  };
}

function historyItem(value: unknown, index: number): FocusHistoryItemV1 {
  const item = asJsonObject(value, `history[${index}]`);
  const focusSessionId = required(item, "focusSessionId", `history[${index}]`);
  const activityKey = required(item, "activityKey", `history[${index}]`);
  const state = required(item, "state", `history[${index}]`);
  const rawResult = nullableString(item, "resultKind", `history[${index}]`);
  const evidenceId = nullableString(item, "evidenceId", `history[${index}]`);
  const evidenceValid = item.evidenceValid;
  const rawDimension = nullableString(item, "dimension", `history[${index}]`);
  const rawOutcome = nullableString(item, "outcome", `history[${index}]`);
  const watermark = nullableString(item, "ledgerWatermark", `history[${index}]`);
  if (
    !UUID.test(focusSessionId) ||
    !ACTIVITY_KEY.test(activityKey) ||
    (state !== "completed" && state !== "stopped") ||
    (evidenceId !== null && !UUID.test(evidenceId)) ||
    (evidenceValid !== null && typeof evidenceValid !== "boolean") ||
    (watermark !== null && !VERSION.test(watermark))
  ) {
    throw new TypeError(`history[${index}] is invalid`);
  }
  return {
    focusSessionId,
    activityKey,
    title: safeText(required(item, "title", `history[${index}]`), "history.title", 200),
    state,
    startedAt: timestamp(required(item, "startedAt", `history[${index}]`), "history.startedAt"),
    endedAt: timestamp(required(item, "endedAt", `history[${index}]`), "history.endedAt"),
    resultKind:
      rawResult === null ? null : oneOf(rawResult, FOCUS_RESULT_KINDS, "history.resultKind"),
    evidenceId,
    evidenceValid: evidenceValid as boolean | null,
    dimension:
      rawDimension === null ? null : oneOf(rawDimension, OBJECTIVE_DIMENSIONS, "history.dimension"),
    outcome:
      rawOutcome === null ? null : oneOf(rawOutcome, ["SUCCESS", "FAILURE"] as const, "outcome"),
    ledgerWatermark: watermark,
  };
}

function masteryState(value: unknown): FocusMasterySummaryV1 | null {
  if (value === null) return null;
  const item = asJsonObject(value, "FocusWorkspaceV1.masteryState");
  const engineVersion = required(item, "engineVersion", "masteryState");
  const policyVersion = required(item, "policyVersion", "masteryState");
  const competencyId = required(item, "competencyId", "masteryState");
  if (
    engineVersion !== "mastery-engine/0.1.0" ||
    policyVersion !== "mastery-readiness-policy/0.1" ||
    !COMPETENCY_REF.test(competencyId)
  ) {
    throw new TypeError("mastery state identity is invalid");
  }
  const explanationCodes = asArray(item.explanationCodes).map((code) => {
    if (typeof code !== "string" || !/^[A-Z][A-Z0-9_]{1,79}$/u.test(code)) {
      throw new TypeError("mastery explanation code is invalid");
    }
    return code;
  });
  return {
    engineVersion,
    policyVersion,
    inputWatermark: version(required(item, "inputWatermark", "masteryState"), "inputWatermark"),
    competencyId,
    calculatedAsOf: timestamp(required(item, "calculatedAsOf", "masteryState"), "calculatedAsOf"),
    achievementLevel: oneOf(
      required(item, "achievementLevel", "masteryState"),
      ACHIEVEMENT_LEVELS,
      "achievementLevel",
    ),
    explanationCodes,
  };
}

export function decodeFocusWorkspaceV1(value: unknown): FocusWorkspaceV1 {
  const workspace = asJsonObject(value, "FocusWorkspaceV1");
  const contract = asJsonObject(workspace.contract, "FocusWorkspaceV1.contract");
  if (
    required(contract, "name", "contract") !== "FocusWorkspaceV1" ||
    required(contract, "version", "contract") !== "1.0.0"
  ) {
    throw new TypeError("Focus workspace contract is unsupported");
  }
  const readinessGoalKey = required(workspace, "readinessGoalKey", "workspace");
  if (!GOAL_KEY.test(readinessGoalKey)) throw new TypeError("readinessGoalKey is invalid");
  const projectionState = oneOf(
    required(workspace, "projectionState", "workspace"),
    ["not_started", "pending", "current"] as const,
    "projectionState",
  );
  const history = asArray(workspace.history).map(historyItem);
  if (history.length > 20) throw new TypeError("Focus history is unbounded");
  const decodedActivity = activity(workspace.activity);
  const decodedActiveSession = activeSession(workspace.activeSession);
  const decodedMasteryState = masteryState(workspace.masteryState);

  if (
    (decodedActiveSession !== null &&
      (decodedActivity === null ||
        decodedActiveSession.activityKey !== decodedActivity.activityKey ||
        decodedActiveSession.title !== decodedActivity.title)) ||
    (decodedMasteryState !== null &&
      (decodedActivity === null ||
        decodedMasteryState.competencyId !== decodedActivity.competencyRef)) ||
    (projectionState === "current" && decodedMasteryState === null) ||
    (projectionState === "not_started" && decodedMasteryState !== null)
  ) {
    throw new TypeError("Focus workspace relationships are inconsistent");
  }

  for (const item of history) {
    const observed =
      item.resultKind === "OBSERVED_SUCCESS" || item.resultKind === "OBSERVED_FAILURE";
    if (
      (item.state === "stopped" && item.resultKind !== null) ||
      observed !== (item.evidenceId !== null) ||
      (item.evidenceId === null &&
        (item.evidenceValid !== null ||
          item.dimension !== null ||
          item.outcome !== null ||
          item.ledgerWatermark !== null)) ||
      (item.evidenceId !== null &&
        (item.evidenceValid === null ||
          item.dimension === null ||
          item.outcome === null ||
          item.ledgerWatermark === null)) ||
      (item.resultKind === "OBSERVED_SUCCESS" && item.outcome !== "SUCCESS") ||
      (item.resultKind === "OBSERVED_FAILURE" && item.outcome !== "FAILURE")
    ) {
      throw new TypeError("Focus history relationships are inconsistent");
    }
  }
  return {
    contract: { name: "FocusWorkspaceV1", version: "1.0.0" },
    readinessGoalKey,
    activity: decodedActivity,
    activeSession: decodedActiveSession,
    history,
    masteryState: decodedMasteryState,
    projectionState,
  };
}
