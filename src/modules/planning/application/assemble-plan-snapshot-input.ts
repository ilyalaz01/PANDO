import {
  asArray,
  asJsonObject,
  asNumber,
  asString,
  canonicalize,
  type JsonObject,
  type JsonValue,
} from "../../../shared/contracts/json";
import { planningInputFingerprint } from "../../../shared/contracts/planning-semantics";
import type {
  CalculatePlanInput,
  PlanningCandidateInput,
  PlanningReadinessInput,
  PlanningSourceRevision,
  PlanningTrackInput,
  ReviewSignalInput,
} from "../domain/planning-types";

export class PlanningProjectionSourceError extends TypeError {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PlanningProjectionSourceError";
  }
}

function fail(code: string, message: string): never {
  throw new PlanningProjectionSourceError(code, message);
}

function requiredString(object: JsonObject, key: string): string {
  return asString(object[key]) ?? fail("INVALID_OWNER_SOURCE", `${key} must be a string`);
}

function requiredNumber(object: JsonObject, key: string): number {
  return asNumber(object[key]) ?? fail("INVALID_OWNER_SOURCE", `${key} must be a number`);
}

function integer(object: JsonObject, key: string): number {
  const value = requiredNumber(object, key);
  if (!Number.isSafeInteger(value)) fail("INVALID_OWNER_SOURCE", `${key} must be an integer`);
  return value;
}

function instant(value: JsonValue | undefined, label: string): string {
  if (typeof value !== "string") fail("INVALID_OWNER_SOURCE", `${label} must be an instant`);
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) fail("INVALID_OWNER_SOURCE", `${label} must be an instant`);
  return new Date(milliseconds).toISOString();
}

function optionalInstant(value: JsonValue | undefined, label: string): string | null {
  return value === null ? null : instant(value, label);
}

function objectArray(value: JsonValue | undefined, label: string): JsonObject[] {
  const raw = asArray(value);
  return raw.map((item, index) => asJsonObject(item, `${label}[${index}]`));
}

function minimumInstant(values: readonly (string | null)[]): string {
  const candidates = values.filter((value): value is string => value !== null);
  if (candidates.length === 0) fail("INVALID_OWNER_SOURCE", "validity cutoffs are missing");
  return candidates.reduce((minimum, value) =>
    Date.parse(value) < Date.parse(minimum) ? value : minimum,
  );
}

function sourceRevision(owner: PlanningSourceRevision["owner"], key: string, revision: string) {
  return { owner, key, revision } satisfies PlanningSourceRevision;
}

function compareCodePoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function readinessInput(item: JsonObject): PlanningReadinessInput {
  const availability = requiredString(item, "availability");
  const readinessGoalKey = requiredString(item, "readinessGoalKey");
  const targetProfileVersionKey = requiredString(item, "profileVersionKey");
  if (availability === "UNAVAILABLE") {
    return {
      availability,
      reason: requiredString(item, "reason") as Extract<
        PlanningReadinessInput,
        { availability: "UNAVAILABLE" }
      >["reason"],
      readinessGoalKey,
      targetProfileVersionKey,
      snapshotId: null,
      inputFingerprint: null,
      calculatedAsOf: null,
      validUntil: null,
      status: null,
      coverage: null,
      confidence: null,
      blockers: [],
      gaps: [],
    };
  }
  if (availability !== "CURRENT") fail("INVALID_OWNER_SOURCE", "readiness availability is invalid");
  return {
    availability,
    reason: null,
    readinessGoalKey,
    targetProfileVersionKey,
    snapshotId: requiredString(item, "snapshotId"),
    inputFingerprint: requiredString(item, "inputFingerprint"),
    calculatedAsOf: instant(item.calculatedAsOf, "readiness.calculatedAsOf"),
    validUntil: optionalInstant(item.validUntil, "readiness.validUntil"),
    status: requiredString(item, "status") as Extract<
      PlanningReadinessInput,
      { availability: "CURRENT" }
    >["status"],
    coverage: requiredNumber(item, "coverage"),
    confidence: requiredString(item, "confidence") as Extract<
      PlanningReadinessInput,
      { availability: "CURRENT" }
    >["confidence"],
    blockers: objectArray(item.blockers, "readiness.blockers").map((blocker) => ({
      code: requiredString(blocker, "code"),
      ruleKey: requiredString(blocker, "ruleKey"),
    })),
    gaps: objectArray(item.gaps, "readiness.gaps").map((gap) => ({
      gapCode: requiredString(gap, "gapCode") as Extract<
        PlanningReadinessInput,
        { availability: "CURRENT" }
      >["gaps"][number]["gapCode"],
      competencyRef: requiredString(gap, "competencyRef"),
      dimension: requiredString(gap, "dimension") as Extract<
        PlanningReadinessInput,
        { availability: "CURRENT" }
      >["gaps"][number]["dimension"],
    })),
  };
}

function uniqueBy<T>(items: readonly T[], key: (item: T) => string, label: string): T[] {
  const result = new Map<string, T>();
  for (const item of items) {
    const itemKey = key(item);
    const existing = result.get(itemKey);
    if (
      existing !== undefined &&
      canonicalize(existing as unknown as JsonValue) !== canonicalize(item as unknown as JsonValue)
    ) {
      fail("OWNER_FENCE_CONFLICT", `${label} contains conflicting duplicate ${itemKey}`);
    }
    result.set(itemKey, item);
  }
  return [...result.values()];
}

export function assemblePlanSnapshotInput(source: unknown): CalculatePlanInput {
  const bundle = asJsonObject(source, "Planning source bundle");
  const claimAsOf = instant(bundle.claimAsOf, "claimAsOf");
  const calendar = asJsonObject(bundle.calendar, "calendar");
  const weekStart = instant(calendar.weekStart, "calendar.weekStart");
  const weekEnd = instant(calendar.weekEnd, "calendar.weekEnd");
  const calendarValidUntil = instant(calendar.validUntil, "calendar.validUntil");
  const focus = asJsonObject(bundle.focus, "focus");
  if (integer(focus, "terminalCount") !== 0) {
    fail(
      "UNSUPPORTED_MEANINGFUL_WORK_HISTORY",
      "Planning cannot publish until the meaningful-work duration policy is implemented",
    );
  }
  const review = asJsonObject(bundle.review, "review");
  const overlay = asJsonObject(bundle.overlay, "overlay");
  const targets = asJsonObject(bundle.targets, "targets");
  const catalog = asJsonObject(bundle.catalog, "catalog");
  const mastery = asJsonObject(bundle.mastery, "mastery");

  const targetItems = uniqueBy(
    objectArray(targets.items, "targets.items"),
    (item) => requiredString(item, "readinessGoalKey"),
    "Targets source",
  );
  const readiness = targetItems
    .map(readinessInput)
    .sort((left, right) => compareCodePoints(left.readinessGoalKey, right.readinessGoalKey));
  const targetByGoalId = new Map(
    targetItems.map((item) => [requiredString(item, "readinessGoalId"), item]),
  );
  const overlayById = new Map(
    objectArray(overlay.items, "overlay.items").map((item) => [
      requiredString(item, "customActivityId"),
      item,
    ]),
  );
  const graphByPair = new Map(
    objectArray(catalog.items, "catalog.items").map((item) => [
      `${requiredString(item, "catalogVersionId")}\u001f${requiredString(item, "competencyRef")}`,
      item,
    ]),
  );

  const reviewByPair = new Map<string, ReviewSignalInput>();
  for (const item of objectArray(review.items, "review.items")) {
    const pair = `${requiredString(item, "readinessGoalKey")}\u001f${requiredString(item, "activityKey")}`;
    if (reviewByPair.has(pair))
      fail("DUPLICATE_REVIEW_FOCUS_PAIR", "Review source repeats a Focus pair");
    reviewByPair.set(pair, {
      reviewItemId: requiredString(item, "reviewItemId"),
      bucket: requiredString(item, "bucket") as ReviewSignalInput["bucket"],
      dueAt: instant(item.dueAt, "review.dueAt"),
    });
  }

  const rawPlan = bundle.plan === null ? null : asJsonObject(bundle.plan, "plan");
  let growthPlan: CalculatePlanInput["growthPlan"] = null;
  let candidates: PlanningCandidateInput[] = [];
  if (rawPlan !== null) {
    const rawTracks = objectArray(rawPlan.tracks, "plan.tracks");
    const tracks: PlanningTrackInput[] = rawTracks.map((track) => {
      const target = targetByGoalId.get(requiredString(track, "readinessGoalId"));
      if (target === undefined) fail("MISSING_TARGET_SOURCE", "Track readiness source is missing");
      return {
        trackId: requiredString(track, "trackId"),
        trackKey: requiredString(track, "trackKey"),
        title: requiredString(track, "title"),
        version: requiredString(track, "version"),
        readinessGoalKey: requiredString(target, "readinessGoalKey"),
        targetProfileVersionKey: requiredString(target, "profileVersionKey"),
        lifecycle: requiredString(track, "lifecycle") as PlanningTrackInput["lifecycle"],
        priority: integer(track, "priority"),
        protectedMinimumMinutes: integer(track, "protectedMinimumMinutes"),
        meaningfulMinutesThisWeek: 0,
        defaultSessionMinutes: integer(track, "defaultSessionMinutes"),
      };
    });
    const trackById = new Map(tracks.map((track) => [track.trackId, track]));
    const rawTrackById = new Map(
      rawTracks.map((track) => [requiredString(track, "trackId"), track]),
    );
    candidates = objectArray(rawPlan.activities, "plan.activities").map((activity) => {
      const trackId = requiredString(activity, "trackId");
      const track = trackById.get(trackId);
      const rawTrack = rawTrackById.get(trackId);
      if (track === undefined || rawTrack === undefined)
        fail("MISSING_TRACK_SOURCE", "Candidate track is missing");
      const overlayItem = overlayById.get(requiredString(activity, "customActivityId"));
      if (overlayItem === undefined)
        fail("MISSING_OVERLAY_SOURCE", "Candidate Overlay source is missing");
      const target = targetByGoalId.get(requiredString(rawTrack, "readinessGoalId"));
      if (target === undefined)
        fail("MISSING_TARGET_SOURCE", "Candidate Targets source is missing");
      const competencyRef = requiredString(overlayItem, "targetCompetencyRef");
      const graph = graphByPair.get(
        `${requiredString(target, "catalogVersionId")}\u001f${competencyRef}`,
      );
      if (graph === undefined)
        fail("MISSING_CATALOG_SOURCE", "Candidate Catalog source is missing");
      const activityKey = requiredString(overlayItem, "activityKey");
      const reviewSignal =
        reviewByPair.get(`${track.readinessGoalKey}\u001f${activityKey}`) ?? null;
      return {
        candidateKey: requiredString(activity, "candidateKey"),
        readinessGoalKey: track.readinessGoalKey,
        targetProfileVersionKey: track.targetProfileVersionKey,
        activityKey,
        title: requiredString(overlayItem, "title"),
        estimatedMinutes: integer(activity, "estimatedMinutes"),
        energy:
          activity.energy === null
            ? null
            : (requiredString(activity, "energy") as PlanningCandidateInput["energy"]),
        durationSource: "PLANNING_ACTIVITY",
        sourceSignals: reviewSignal === null ? ["GROWTH_PLAN"] : ["GROWTH_PLAN", "REVIEW"],
        trackId,
        competencyImpacts: [
          {
            competencyRef,
            dimension: requiredString(
              overlayItem,
              "dimension",
            ) as PlanningCandidateInput["competencyImpacts"][number]["dimension"],
          },
        ],
        prerequisiteState: integer(graph, "prerequisiteCount") === 0 ? "SATISFIED" : "UNKNOWN",
        unlockCount: integer(graph, "unlockCount"),
        repetitionsInLast7Days: 0,
        review: reviewSignal,
      };
    });
    growthPlan = {
      growthPlanId: requiredString(rawPlan, "growthPlanId"),
      version: requiredString(rawPlan, "version"),
      lifecycle: requiredString(rawPlan, "lifecycle") as "ACTIVE" | "PAUSED",
      weeklyCapacityMinutes: integer(rawPlan, "weeklyCapacityMinutes"),
      consumedMinutesThisWeek: 0,
      tracks,
    };
  }

  const sourceRevisions: PlanningSourceRevision[] = [
    ...objectArray(catalog.versions, "catalog.versions").map((version) =>
      sourceRevision(
        "CATALOG",
        requiredString(version, "catalogVersionKey"),
        `catalog-version:${integer(version, "versionNumber")}`,
      ),
    ),
    sourceRevision("FOCUS", "workspace-focus", requiredString(focus, "revision")),
    sourceRevision("MASTERY", "candidate-scope", requiredString(mastery, "revision")),
    sourceRevision("OVERLAY", "workspace-overlay", requiredString(overlay, "revision")),
    sourceRevision("REVIEW", "workspace-review", requiredString(review, "revision")),
  ].sort((left, right) =>
    compareCodePoints(`${left.owner}\u001f${left.key}`, `${right.owner}\u001f${right.key}`),
  );

  const reviewValidUntil = optionalInstant(review.validUntil, "review.validUntil");
  const validUntil = minimumInstant([
    calendarValidUntil,
    reviewValidUntil,
    ...readiness.map((item) => (item.availability === "CURRENT" ? item.validUntil : null)),
  ]);
  const unsigned: CalculatePlanInput = {
    inputFingerprint: "planning-input:" + "0".repeat(64),
    evaluationHorizon: {
      asOf: claimAsOf,
      validUntil,
      timeZone: requiredString(calendar, "timeZone"),
      weekStart,
      weekEnd,
    },
    sourceRevisions,
    growthPlan,
    campaign: null,
    sessionLimitMinutes: null,
    energyPreference: null,
    activeFocus:
      focus.activeFocus === null
        ? null
        : (() => {
            const active = asJsonObject(focus.activeFocus, "focus.activeFocus");
            return {
              focusSessionId: requiredString(active, "focusSessionId"),
              readinessGoalKey: requiredString(active, "readinessGoalKey"),
              activityKey: requiredString(active, "activityKey"),
              title: requiredString(active, "title"),
              plannedMinutes: integer(active, "plannedMinutes"),
              startedAt: instant(active.startedAt, "focus.startedAt"),
              planAttribution: null,
            };
          })(),
    readiness,
    reviewSummary: {
      projectionState: requiredString(
        review,
        "projectionState",
      ) as CalculatePlanInput["reviewSummary"]["projectionState"],
      overdueCount: integer(review, "overdueCount"),
      dueTodayCount: integer(review, "dueTodayCount"),
      validUntil: reviewValidUntil,
    },
    candidates,
  };
  return { ...unsigned, inputFingerprint: planningInputFingerprint(unsigned) };
}
