import { asArray, asJsonObject, asString, type JsonObject } from "../../../shared/contracts/json";

export const CUSTOM_ACTIVITY_TYPES = [
  "MANUAL_CODING",
  "READING",
  "EXPLANATION",
  "MOCK",
  "PROJECT",
] as const;

export type CustomActivityType = (typeof CUSTOM_ACTIVITY_TYPES)[number];

export interface CompetencyOverlayNoteV1 {
  readonly body: string;
  readonly updatedAt: string;
}

export interface CompetencyOverlayActivityV1 {
  readonly activityKey: string;
  readonly title: string;
  readonly activityType: CustomActivityType;
  readonly lifecycle: "active";
  readonly createdAt: string;
}

export interface CompetencyOverlayDetailV1 {
  readonly contract: { readonly name: "CompetencyOverlayDetailV1"; readonly version: "1.0.0" };
  readonly readinessGoalKey: string;
  readonly competencyRef: string;
  readonly overlayVersion: string;
  readonly note: CompetencyOverlayNoteV1 | null;
  readonly customActivities: readonly CompetencyOverlayActivityV1[];
}

const GOAL_KEY = /^goal:[a-z0-9][a-z0-9-]{1,100}$/u;
const COMPETENCY_REF = /^competency:[a-z0-9][a-z0-9-]{1,100}$/u;
const ACTIVITY_KEY = /^activity:[a-z0-9][a-z0-9-]{1,100}$/u;
const OVERLAY_VERSION = /^(0|[1-9][0-9]{0,18})$/u;

function requiredString(object: JsonObject, key: string, label: string): string {
  const value = asString(object[key]);
  if (value === undefined) throw new TypeError(`${label}.${key} must be a string`);
  return value;
}

function timestamp(value: string, label: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T/u.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new TypeError(`${label} must be an ISO timestamp`);
  }
  return value;
}

function activityType(value: string): CustomActivityType {
  if (!(CUSTOM_ACTIVITY_TYPES as readonly string[]).includes(value)) {
    throw new TypeError("custom activity type is unsupported");
  }
  return value as CustomActivityType;
}

export function isReadinessGoalKey(value: string): boolean {
  return GOAL_KEY.test(value);
}

export function isCompetencyRef(value: string): boolean {
  return COMPETENCY_REF.test(value);
}

export function isOverlayVersion(value: string): boolean {
  if (!OVERLAY_VERSION.test(value)) return false;
  try {
    return BigInt(value) <= 9_223_372_036_854_775_807n;
  } catch {
    return false;
  }
}

export function decodeCompetencyOverlayDetailV1(value: unknown): CompetencyOverlayDetailV1 {
  const detail = asJsonObject(value, "CompetencyOverlayDetailV1");
  const contract = asJsonObject(detail.contract, "CompetencyOverlayDetailV1.contract");
  const name = requiredString(contract, "name", "contract");
  const version = requiredString(contract, "version", "contract");
  const readinessGoalKey = requiredString(detail, "readinessGoalKey", "detail");
  const competencyRef = requiredString(detail, "competencyRef", "detail");
  const overlayVersion = requiredString(detail, "overlayVersion", "detail");
  if (name !== "CompetencyOverlayDetailV1" || version !== "1.0.0") {
    throw new TypeError("Competency overlay contract is unsupported");
  }
  if (!isReadinessGoalKey(readinessGoalKey)) throw new TypeError("readinessGoalKey is invalid");
  if (!isCompetencyRef(competencyRef)) throw new TypeError("competencyRef is invalid");
  if (!isOverlayVersion(overlayVersion)) throw new TypeError("overlayVersion is invalid");

  const note =
    detail.note === null
      ? null
      : (() => {
          const item = asJsonObject(detail.note, "CompetencyOverlayDetailV1.note");
          const body = requiredString(item, "body", "note");
          if (body.length < 1 || body.length > 10_000 || body.trim() !== body) {
            throw new TypeError("note.body is invalid");
          }
          return {
            body,
            updatedAt: timestamp(requiredString(item, "updatedAt", "note"), "note.updatedAt"),
          };
        })();

  const customActivities = asArray(detail.customActivities).map((value, index) => {
    const item = asJsonObject(value, `customActivities[${index}]`);
    const activityKey = requiredString(item, "activityKey", `customActivities[${index}]`);
    const title = requiredString(item, "title", `customActivities[${index}]`);
    const lifecycle = requiredString(item, "lifecycle", `customActivities[${index}]`);
    if (!ACTIVITY_KEY.test(activityKey)) throw new TypeError("custom activity key is invalid");
    if (title.length < 1 || title.length > 200 || title.trim() !== title) {
      throw new TypeError("custom activity title is invalid");
    }
    if (lifecycle !== "active") throw new TypeError("custom activity lifecycle is unsupported");
    return {
      activityKey,
      title,
      activityType: activityType(
        requiredString(item, "activityType", `customActivities[${index}]`),
      ),
      lifecycle: "active" as const,
      createdAt: timestamp(
        requiredString(item, "createdAt", `customActivities[${index}]`),
        `customActivities[${index}].createdAt`,
      ),
    };
  });

  if (
    customActivities.some(
      (activity, index) =>
        index > 0 &&
        customActivities[index - 1]!.activityKey.localeCompare(activity.activityKey) >= 0,
    )
  ) {
    throw new TypeError("custom activities must be uniquely sorted");
  }

  return {
    contract: { name: "CompetencyOverlayDetailV1", version: "1.0.0" },
    readinessGoalKey,
    competencyRef,
    overlayVersion,
    note,
    customActivities,
  };
}
