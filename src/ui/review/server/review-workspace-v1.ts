import { asArray, asJsonObject, asString, type JsonObject } from "../../../shared/contracts/json";

export const REVIEW_BUCKETS = [
  "OVERDUE",
  "DUE_TODAY",
  "UPCOMING",
  "PERSONAL_REMINDER",
  "SUPPRESSED",
] as const;
export type ReviewBucket = (typeof REVIEW_BUCKETS)[number];
export const REVIEW_REASON_TYPES = [
  "RETENTION_RISK",
  "PERSONAL_REMINDER",
  "VERIFICATION_NEEDED",
] as const;
export type ReviewReasonType = (typeof REVIEW_REASON_TYPES)[number];

export interface ReviewReasonV1 {
  readonly reasonId: string;
  readonly reasonType: ReviewReasonType;
  readonly dueAt: string;
  readonly status: "active" | "suppressed";
  readonly sourceRevision: string;
}

export interface ReviewItemV1 {
  readonly subjectId: string;
  readonly subjectRef: string;
  readonly competencyRef: string;
  readonly dimension: "KNOWLEDGE" | "RECALL" | "APPLICATION" | "INTERVIEW_EXECUTION";
  readonly title: string;
  readonly effectiveDueAt: string | null;
  readonly bucket: ReviewBucket;
  readonly projectionVersion: string;
  readonly reasons: readonly ReviewReasonV1[];
  readonly focus: { readonly readinessGoalKey: string; readonly activityKey: string } | null;
}

export interface ReviewWorkspaceV1 {
  readonly contract: { readonly name: "ReviewWorkspaceV1"; readonly version: "1.0.0" };
  readonly asOf: string;
  readonly timeZone: string;
  readonly projectionState: "not_started" | "pending" | "current";
  readonly items: readonly ReviewItemV1[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const COMPETENCY = /^competency:[a-z0-9][a-z0-9-]{1,100}$/u;
const GOAL = /^goal:[a-z0-9][a-z0-9-]{1,100}$/u;
const ACTIVITY = /^activity:[a-z0-9][a-z0-9-]{1,100}$/u;
const VERSION = /^[1-9][0-9]{0,18}$/u;

function required(value: JsonObject, key: string, label: string): string {
  const result = asString(value[key]);
  if (result === undefined) throw new TypeError(`${label}.${key} must be a string`);
  return result;
}
function instant(value: string, label: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T/u.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new TypeError(`${label} must be an ISO instant`);
  }
  return value;
}
function text(value: string, label: string, max: number): string {
  if (
    value.trim() !== value ||
    value.length < 1 ||
    value.length > max ||
    /[\u0000-\u001f]/u.test(value)
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}
function oneOf<T extends string>(value: string, allowed: readonly T[], label: string): T {
  if (!allowed.includes(value as T)) throw new TypeError(`${label} is unsupported`);
  return value as T;
}

function reason(value: unknown, index: number): ReviewReasonV1 {
  const item = asJsonObject(value, `reasons[${index}]`);
  const reasonId = required(item, "reasonId", "reason");
  const sourceRevision = required(item, "sourceRevision", "reason");
  if (!UUID.test(reasonId) || !VERSION.test(sourceRevision))
    throw new TypeError("review reason identity is invalid");
  return {
    reasonId,
    reasonType: oneOf(required(item, "reasonType", "reason"), REVIEW_REASON_TYPES, "reason.type"),
    dueAt: instant(required(item, "dueAt", "reason"), "reason.dueAt"),
    status: oneOf(
      required(item, "status", "reason"),
      ["active", "suppressed"] as const,
      "reason.status",
    ),
    sourceRevision,
  };
}

function item(value: unknown, index: number): ReviewItemV1 {
  const raw = asJsonObject(value, `items[${index}]`);
  const subjectId = required(raw, "subjectId", "item");
  const competencyRef = required(raw, "competencyRef", "item");
  const projectionVersion = required(raw, "projectionVersion", "item");
  const rawDue = raw.effectiveDueAt;
  if (!UUID.test(subjectId) || !COMPETENCY.test(competencyRef) || !VERSION.test(projectionVersion))
    throw new TypeError("review item identity is invalid");
  const reasons = asArray(raw.reasons).map(reason);
  if (
    reasons.length < 1 ||
    reasons.length > 4 ||
    new Set(reasons.map((entry) => entry.reasonId)).size !== reasons.length
  )
    throw new TypeError("review item reasons are invalid");
  const rawFocus = raw.focus;
  let focus: ReviewItemV1["focus"] = null;
  if (rawFocus !== null) {
    const value = asJsonObject(rawFocus, "item.focus");
    const readinessGoalKey = required(value, "readinessGoalKey", "focus");
    const activityKey = required(value, "activityKey", "focus");
    if (!GOAL.test(readinessGoalKey) || !ACTIVITY.test(activityKey))
      throw new TypeError("review focus reference is invalid");
    focus = { readinessGoalKey, activityKey };
  }
  const bucket = oneOf(required(raw, "bucket", "item"), REVIEW_BUCKETS, "item.bucket");
  const effectiveDueAt =
    rawDue === null
      ? null
      : instant(required(raw, "effectiveDueAt", "item"), "item.effectiveDueAt");
  if ((bucket === "SUPPRESSED") !== (effectiveDueAt === null))
    throw new TypeError("review item bucket and due time conflict");
  if (bucket === "SUPPRESSED" && !reasons.some((entry) => entry.status === "suppressed"))
    throw new TypeError("suppressed item needs a suppressed reason");
  return {
    subjectId,
    subjectRef: text(required(raw, "subjectRef", "item"), "item.subjectRef", 180),
    competencyRef,
    dimension: oneOf(
      required(raw, "dimension", "item"),
      ["KNOWLEDGE", "RECALL", "APPLICATION", "INTERVIEW_EXECUTION"] as const,
      "item.dimension",
    ),
    title: text(required(raw, "title", "item"), "item.title", 200),
    effectiveDueAt,
    bucket,
    projectionVersion,
    reasons,
    focus,
  };
}

export function decodeReviewWorkspaceV1(value: unknown): ReviewWorkspaceV1 {
  const raw = asJsonObject(value, "ReviewWorkspaceV1");
  const contract = asJsonObject(raw.contract, "ReviewWorkspaceV1.contract");
  if (
    required(contract, "name", "contract") !== "ReviewWorkspaceV1" ||
    required(contract, "version", "contract") !== "1.0.0"
  )
    throw new TypeError("Review workspace contract is unsupported");
  const timeZone = required(raw, "timeZone", "workspace");
  try {
    Intl.DateTimeFormat(undefined, { timeZone });
  } catch {
    throw new TypeError("workspace.timeZone is invalid");
  }
  const items = asArray(raw.items).map(item);
  if (items.length > 100 || new Set(items.map((entry) => entry.subjectId)).size !== items.length)
    throw new TypeError("review items are invalid");
  return {
    contract: { name: "ReviewWorkspaceV1", version: "1.0.0" },
    asOf: instant(required(raw, "asOf", "workspace"), "workspace.asOf"),
    timeZone,
    projectionState: oneOf(
      required(raw, "projectionState", "workspace"),
      ["not_started", "pending", "current"] as const,
      "workspace.projectionState",
    ),
    items,
  };
}
