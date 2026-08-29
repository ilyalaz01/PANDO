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
import {
  calculatePrerequisiteSatisfaction,
  MASTERY_PREREQUISITE_ENGINE_VERSION,
  PREREQUISITE_SATISFACTION_POLICY_V0_1,
} from "../../mastery/application/prerequisite-satisfaction-v1";
import type {
  CalculatePlanInput,
  PlanningCandidateInput,
  PlanningReadinessInput,
  PlanningSourceRevision,
  PlanningTrackInput,
  ReviewSignalInput,
} from "../domain/planning-types";

/**
 * Version of `planning-completed-work`, the input-normalization policy recorded in
 * `docs/policies/PLANNING_COMPLETED_WORK_POLICY_V0.1.md`. It converts bounded Sessions and
 * Evidence owner facts into consumed capacity, per-track cadence credit, and recent repetition.
 */
export const COMPLETED_WORK_POLICY_VERSION = "planning-completed-work/0.1";
export const PREREQUISITE_POLICY_VERSION = "mastery-prerequisite-satisfaction/0.1";

/** 168 elapsed hours, never seven calendar days: a local offset change cannot resize the window. */
const REPETITION_WINDOW_MILLISECONDS = 604_800_000;
const MILLISECONDS_PER_MINUTE = 60_000;
const MAXIMUM_TERMINAL_SESSIONS = 500;
const MAXIMUM_REPETITIONS = 50;
const MAXIMUM_SESSION_MINUTES = 480;
const MINUTES_PER_WEEK = 10_080;
const MAXIMUM_DIRECT_PREREQUISITES = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CANDIDATE_KEY = /^candidate:[a-z0-9][a-z0-9-]{1,100}$/u;

export class PlanningProjectionSourceError extends TypeError {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PlanningProjectionSourceError";
  }
}

interface CompletedWorkSession {
  readonly focusSessionId: string;
  readonly customActivityId: string;
  readonly completed: boolean;
  readonly evidenceBearing: boolean;
  readonly startedAtMs: number;
  readonly endedAtMs: number;
  readonly plannedMinutes: number;
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

function provenanceInstant(value: JsonValue | undefined, label: string): string {
  if (typeof value !== "string") fail("INVALID_OWNER_SOURCE", `${label} must be an instant`);
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) fail("INVALID_OWNER_SOURCE", `${label} must be an instant`);
  // Keep the owner's exact representation. PostgreSQL claim clocks carry microseconds;
  // round-tripping through Date would truncate them and break the attempt provenance fence.
  return value;
}

function optionalInstant(value: JsonValue | undefined, label: string): string | null {
  return value === null ? null : instant(value, label);
}

function instantMilliseconds(value: JsonValue | undefined, label: string): number {
  return Date.parse(instant(value, label));
}

function requiredBoolean(object: JsonObject, key: string): boolean {
  const value = object[key];
  if (typeof value !== "boolean") fail("INVALID_OWNER_SOURCE", `${key} must be a boolean`);
  return value;
}

function exactKeys(object: JsonObject, expected: readonly string[], label: string): void {
  const actual = Object.keys(object).sort(compareCodePoints);
  const canonicalExpected = [...expected].sort(compareCodePoints);
  if (
    actual.length !== canonicalExpected.length ||
    actual.some((key, index) => key !== canonicalExpected[index])
  ) {
    fail("INVALID_OWNER_SOURCE", `${label} must contain exactly ${canonicalExpected.join(", ")}`);
  }
}

function requiredUuid(object: JsonObject, key: string, label: string): string {
  const value = requiredString(object, key);
  if (!UUID.test(value)) fail("INVALID_OWNER_SOURCE", `${label}.${key} must be a UUID`);
  return value;
}

function activePlanAttribution(value: JsonValue | undefined) {
  if (value === null) return null;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail("INVALID_OWNER_SOURCE", "focus.activeFocus.planAttribution must be an object or null");
  }
  const attribution = value as JsonObject;
  exactKeys(
    attribution,
    ["planSnapshotId", "candidateKey", "trackId"],
    "focus.activeFocus.planAttribution",
  );
  const candidateKey = requiredString(attribution, "candidateKey");
  if (!CANDIDATE_KEY.test(candidateKey)) {
    fail(
      "INVALID_OWNER_SOURCE",
      "focus.activeFocus.planAttribution.candidateKey must be a candidate key",
    );
  }
  const trackId =
    attribution.trackId === null
      ? null
      : requiredUuid(attribution, "trackId", "focus.activeFocus.planAttribution");
  return {
    planSnapshotId: requiredUuid(
      attribution,
      "planSnapshotId",
      "focus.activeFocus.planAttribution",
    ),
    candidateKey,
    trackId,
  };
}

function objectArray(value: JsonValue | undefined, label: string): JsonObject[] {
  const raw = asArray(value);
  return raw.map((item, index) => asJsonObject(item, `${label}[${index}]`));
}

function canonicalStringArray(value: JsonValue | undefined, label: string): string[] {
  if (!Array.isArray(value)) fail("INVALID_OWNER_SOURCE", `${label} must be an array`);
  const values = value.map((item, index) => {
    if (typeof item !== "string" || item.length === 0 || item !== item.trim()) {
      fail("INVALID_OWNER_SOURCE", `${label}[${index}] must be a trimmed string`);
    }
    return item;
  });
  if (new Set(values).size !== values.length) {
    fail("OWNER_FENCE_CONFLICT", `${label} contains duplicates`);
  }
  if (
    !values.every((item, index) => index === 0 || compareCodePoints(values[index - 1]!, item) < 0)
  ) {
    fail("INVALID_OWNER_SOURCE", `${label} must use canonical code-point order`);
  }
  return values;
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

/**
 * `planning-completed-work/0.1` classification. Sessions supplies terminal duration facts and
 * Evidence supplies only attempt terminality plus whether a non-invalidated observation exists.
 * Anything this policy cannot classify fails closed instead of publishing an invented number.
 */
function completedWorkSessions(
  bundle: JsonObject,
  weekStartMs: number,
  asOfMs: number,
): readonly CompletedWorkSession[] {
  const completedWork = asJsonObject(bundle.completedWork, "completedWork");
  const evidence = asJsonObject(bundle.evidence, "evidence");
  const windowStartMs = instantMilliseconds(completedWork.windowStart, "completedWork.windowStart");
  if (windowStartMs > Math.min(weekStartMs, asOfMs - REPETITION_WINDOW_MILLISECONDS)) {
    fail(
      "UNSUPPORTED_MEANINGFUL_WORK_HISTORY",
      "the completed-work window does not cover the plan week and repetition horizon",
    );
  }
  const rawSessions = objectArray(completedWork.sessions, "completedWork.sessions");
  if (rawSessions.length > MAXIMUM_TERMINAL_SESSIONS) {
    fail(
      "COMPLETED_WORK_SOURCE_BOUND",
      `completed-work source exceeds ${MAXIMUM_TERMINAL_SESSIONS} terminal sessions`,
    );
  }
  const evidenceBySession = new Map<string, JsonObject>();
  for (const item of objectArray(evidence.items, "evidence.items")) {
    const key = requiredString(item, "focusSessionId");
    if (evidenceBySession.has(key)) {
      fail("OWNER_FENCE_CONFLICT", "Evidence source repeats a Focus session");
    }
    evidenceBySession.set(key, item);
  }

  const seen = new Set<string>();
  const sessions = rawSessions.map((raw) => {
    const focusSessionId = requiredString(raw, "focusSessionId");
    if (seen.has(focusSessionId)) {
      fail("OWNER_FENCE_CONFLICT", "Sessions source repeats a Focus session");
    }
    seen.add(focusSessionId);
    const answer = evidenceBySession.get(focusSessionId);
    if (answer === undefined) {
      fail(
        "UNSUPPORTED_MEANINGFUL_WORK_HISTORY",
        "a terminal Focus Session has no Evidence attempt answer",
      );
    }
    if (!requiredBoolean(answer, "attemptTerminal")) {
      fail(
        "UNSUPPORTED_MEANINGFUL_WORK_HISTORY",
        "a terminal Focus Session still has a non-terminal attempt",
      );
    }
    const state = requiredString(raw, "state");
    if (state !== "COMPLETED" && state !== "STOPPED") {
      fail("INVALID_OWNER_SOURCE", "terminal Focus state is invalid");
    }
    const evidenceBearing = requiredBoolean(answer, "evidenceBearing");
    if (state === "STOPPED" && evidenceBearing) {
      fail(
        "UNSUPPORTED_MEANINGFUL_WORK_HISTORY",
        "a stopped Focus Session cannot carry normalized evidence",
      );
    }
    const startedAtMs = instantMilliseconds(raw.startedAt, "completedWork.startedAt");
    const endedAtMs = instantMilliseconds(raw.endedAt, "completedWork.endedAt");
    if (endedAtMs < startedAtMs || endedAtMs > asOfMs || endedAtMs < windowStartMs) {
      fail(
        "UNSUPPORTED_MEANINGFUL_WORK_HISTORY",
        "a terminal Focus Session lies outside its claim-scoped window",
      );
    }
    const plannedMinutes = integer(raw, "plannedMinutes");
    if (plannedMinutes < 1 || plannedMinutes > MAXIMUM_SESSION_MINUTES) {
      fail("INVALID_OWNER_SOURCE", "terminal Focus planned minutes are out of range");
    }
    return {
      focusSessionId,
      customActivityId: requiredString(raw, "customActivityId"),
      completed: state === "COMPLETED",
      evidenceBearing,
      startedAtMs,
      endedAtMs,
      plannedMinutes,
    } satisfies CompletedWorkSession;
  });
  if (evidenceBySession.size !== sessions.length) {
    fail("MISSING_SESSION_SOURCE", "Evidence answered about an unreturned Focus session");
  }
  return sessions;
}

/**
 * Observed length, floored to whole minutes, bounded by the minutes the user planned for that
 * activity and clipped to the part of the session inside the current plan week. Planned duration is
 * only ever an upper bound, so completed work is never fabricated from an unfinished intention and
 * an abandoned open session cannot claim a week of capacity.
 */
function countedMinutes(session: CompletedWorkSession, weekStartMs: number): number {
  const fromMs = Math.max(session.startedAtMs, weekStartMs);
  if (session.endedAtMs <= fromMs) return 0;
  const elapsedMinutes = Math.floor((session.endedAtMs - fromMs) / MILLISECONDS_PER_MINUTE);
  return Math.max(0, Math.min(elapsedMinutes, session.plannedMinutes));
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
  const claimAsOf = provenanceInstant(bundle.claimAsOf, "claimAsOf");
  const calendar = asJsonObject(bundle.calendar, "calendar");
  const weekStart = instant(calendar.weekStart, "calendar.weekStart");
  const weekEnd = instant(calendar.weekEnd, "calendar.weekEnd");
  const calendarValidUntil = instant(calendar.validUntil, "calendar.validUntil");
  const focus = asJsonObject(bundle.focus, "focus");
  const completedWork = asJsonObject(bundle.completedWork, "completedWork");
  const evidence = asJsonObject(bundle.evidence, "evidence");
  const asOfMs = Date.parse(claimAsOf);
  const weekStartMs = Date.parse(weekStart);
  const workSessions = completedWorkSessions(bundle, weekStartMs, asOfMs);
  const repetitionCutoffMs = asOfMs - REPETITION_WINDOW_MILLISECONDS;
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
  const catalogItems = objectArray(catalog.items, "catalog.items");
  const graphByPair = new Map(
    uniqueBy(
      catalogItems,
      (item) =>
        `${requiredString(item, "catalogVersionId")}\u001f${requiredString(item, "competencyRef")}`,
      "Catalog source",
    ).map((item) => [
      `${requiredString(item, "catalogVersionId")}\u001f${requiredString(item, "competencyRef")}`,
      item,
    ]),
  );
  const catalogHasAnyPrerequisiteContract = catalogItems.some(
    (item) => item.prerequisiteRefs !== undefined,
  );
  const catalogHasOnlyPrerequisiteContract = catalogItems.every(
    (item) => item.prerequisiteRefs !== undefined,
  );
  if (catalogHasAnyPrerequisiteContract && !catalogHasOnlyPrerequisiteContract) {
    fail("OWNER_FENCE_CONFLICT", "Catalog source mixes prerequisite contract versions");
  }
  const masteryPolicy = asString(mastery.policyVersion);
  const hasPrerequisiteSource = masteryPolicy === PREREQUISITE_POLICY_VERSION;
  if (
    (masteryPolicy === undefined && catalogHasAnyPrerequisiteContract) ||
    (masteryPolicy !== undefined && !catalogHasOnlyPrerequisiteContract)
  ) {
    fail("OWNER_FENCE_CONFLICT", "Catalog and Mastery prerequisite source versions disagree");
  }
  if (masteryPolicy !== undefined && masteryPolicy !== PREREQUISITE_POLICY_VERSION) {
    fail("INVALID_OWNER_SOURCE", "Mastery prerequisite policy version is unsupported");
  }
  const masteryItems = hasPrerequisiteSource
    ? uniqueBy(
        objectArray(mastery.items, "mastery.items"),
        (item) => requiredString(item, "competencyRef"),
        "Mastery prerequisite source",
      )
    : [];
  const masteryByCompetency = new Map(
    masteryItems.map((item) => [requiredString(item, "competencyRef"), item]),
  );
  const usedPrerequisiteRefs = new Set<string>();
  const prerequisiteValidityInstants: string[] = [];

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

  // Consumed capacity is plan-wide and provably at most one week, because a workspace has at most
  // one active Focus Session at a time, so counted durations cannot overlap.
  const consumedMinutesThisWeek = workSessions.reduce(
    (total, session) => (session.completed ? total + countedMinutes(session, weekStartMs) : total),
    0,
  );
  if (consumedMinutesThisWeek > MINUTES_PER_WEEK) {
    fail(
      "UNSUPPORTED_MEANINGFUL_WORK_HISTORY",
      "derived completed work exceeds the minutes available in one week",
    );
  }

  const repetitionCutoffInstants: string[] = [];
  const rawPlan = bundle.plan === null ? null : asJsonObject(bundle.plan, "plan");
  let growthPlan: CalculatePlanInput["growthPlan"] = null;
  let candidates: PlanningCandidateInput[] = [];
  if (rawPlan !== null) {
    const rawTracks = objectArray(rawPlan.tracks, "plan.tracks");
    const rawActivities = objectArray(rawPlan.activities, "plan.activities");
    const trackByActivityId = new Map(
      rawActivities.map((activity) => [
        requiredString(activity, "customActivityId"),
        requiredString(activity, "trackId"),
      ]),
    );
    const meaningfulMinutesByTrack = new Map<string, number>();
    for (const session of workSessions) {
      if (!session.completed || !session.evidenceBearing) continue;
      const attributedTrackId = trackByActivityId.get(session.customActivityId);
      // Work on an activity that no longer belongs to a track still consumed plan capacity, but it
      // earns no cadence credit rather than a fabricated attribution.
      if (attributedTrackId === undefined) continue;
      meaningfulMinutesByTrack.set(
        attributedTrackId,
        (meaningfulMinutesByTrack.get(attributedTrackId) ?? 0) +
          countedMinutes(session, weekStartMs),
      );
    }
    const creditedMinutes = [...meaningfulMinutesByTrack.values()].reduce(
      (total, minutes) => total + minutes,
      0,
    );
    if (creditedMinutes > consumedMinutesThisWeek) {
      fail(
        "UNSUPPORTED_MEANINGFUL_WORK_HISTORY",
        "track cadence credit cannot exceed consumed capacity",
      );
    }
    const tracks: PlanningTrackInput[] = rawTracks.map((track) => {
      const target = targetByGoalId.get(requiredString(track, "readinessGoalId"));
      if (target === undefined) fail("MISSING_TARGET_SOURCE", "Track readiness source is missing");
      const trackId = requiredString(track, "trackId");
      return {
        trackId,
        trackKey: requiredString(track, "trackKey"),
        title: requiredString(track, "title"),
        version: requiredString(track, "version"),
        readinessGoalKey: requiredString(target, "readinessGoalKey"),
        targetProfileVersionKey: requiredString(target, "profileVersionKey"),
        lifecycle: requiredString(track, "lifecycle") as PlanningTrackInput["lifecycle"],
        priority: integer(track, "priority"),
        protectedMinimumMinutes: integer(track, "protectedMinimumMinutes"),
        meaningfulMinutesThisWeek: meaningfulMinutesByTrack.get(trackId) ?? 0,
        defaultSessionMinutes: integer(track, "defaultSessionMinutes"),
      };
    });
    const trackById = new Map(tracks.map((track) => [track.trackId, track]));
    const rawTrackById = new Map(
      rawTracks.map((track) => [requiredString(track, "trackId"), track]),
    );
    candidates = rawActivities.map((activity) => {
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
      const prerequisiteCount = integer(graph, "prerequisiteCount");
      if (prerequisiteCount < 0 || prerequisiteCount > MAXIMUM_DIRECT_PREREQUISITES) {
        fail(
          "PREREQUISITE_SOURCE_BOUND",
          `candidate direct prerequisites exceed ${MAXIMUM_DIRECT_PREREQUISITES}`,
        );
      }
      let prerequisiteSummary: PlanningCandidateInput["prerequisiteSummary"];
      if (!hasPrerequisiteSource) {
        prerequisiteSummary = {
          total: prerequisiteCount,
          satisfied: 0,
          blocked: 0,
          unknown: prerequisiteCount,
        };
      } else {
        const prerequisiteRefs = canonicalStringArray(
          graph.prerequisiteRefs,
          "catalog.prerequisiteRefs",
        );
        if (prerequisiteRefs.length !== prerequisiteCount) {
          fail(
            "OWNER_FENCE_CONFLICT",
            "Catalog prerequisite count does not match its exact references",
          );
        }
        let satisfied = 0;
        let blocked = 0;
        let unknown = 0;
        for (const prerequisiteRef of prerequisiteRefs) {
          usedPrerequisiteRefs.add(prerequisiteRef);
          const classification = masteryByCompetency.get(prerequisiteRef);
          if (classification === undefined) {
            fail(
              "MISSING_MASTERY_SOURCE",
              "a direct prerequisite has no Mastery owner classification",
            );
          }
          requiredString(classification, "projectionFence");
          if (!Object.prototype.hasOwnProperty.call(classification, "projection")) {
            fail("INVALID_OWNER_SOURCE", "Mastery prerequisite projection is missing");
          }
          const classified = calculatePrerequisiteSatisfaction(
            {
              competencyRef: prerequisiteRef,
              projection: classification.projection ?? null,
            },
            PREREQUISITE_SATISFACTION_POLICY_V0_1,
            { asOf: claimAsOf },
          );
          const { state } = classified;
          const validity = classified.validUntil;
          if (state === "SATISFIED") satisfied += 1;
          else if (state === "BLOCKED") blocked += 1;
          else if (state === "UNKNOWN") unknown += 1;
          else fail("INVALID_OWNER_SOURCE", "Mastery prerequisite state is invalid");
          if (state === "UNKNOWN" && validity !== null) {
            fail("INVALID_OWNER_SOURCE", "Unknown prerequisite state cannot declare validity");
          }
          if (state !== "UNKNOWN" && validity === null) {
            fail("INVALID_OWNER_SOURCE", "decisive prerequisite state requires validity");
          }
          if (validity !== null) {
            if (Date.parse(validity) < asOfMs) {
              fail("INVALID_OWNER_SOURCE", "Mastery prerequisite validity precedes claim clock");
            }
            prerequisiteValidityInstants.push(validity);
          }
        }
        prerequisiteSummary = {
          total: prerequisiteCount,
          satisfied,
          blocked,
          unknown,
        };
      }
      const prerequisiteState =
        prerequisiteSummary.blocked > 0
          ? "BLOCKED"
          : prerequisiteSummary.unknown > 0
            ? "UNKNOWN"
            : "SATISFIED";
      const activityKey = requiredString(overlayItem, "activityKey");
      const customActivityId = requiredString(activity, "customActivityId");
      const repetitionEndedAtMs = workSessions
        .filter(
          (session) =>
            session.completed &&
            session.customActivityId === customActivityId &&
            session.endedAtMs > repetitionCutoffMs,
        )
        .map(({ endedAtMs }) => endedAtMs);
      const oldestRepetitionMs =
        repetitionEndedAtMs.length === 0 ? null : Math.min(...repetitionEndedAtMs);
      const repetitionWindowEndsAt =
        oldestRepetitionMs === null
          ? null
          : new Date(oldestRepetitionMs + REPETITION_WINDOW_MILLISECONDS).toISOString();
      if (oldestRepetitionMs !== null) {
        // The oldest counted repetition leaves the window at a clock-derived instant, so the
        // snapshot must expire one millisecond earlier.
        repetitionCutoffInstants.push(
          new Date(oldestRepetitionMs + REPETITION_WINDOW_MILLISECONDS - 1).toISOString(),
        );
      }
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
        prerequisiteState,
        prerequisiteSummary,
        unlockCount: integer(graph, "unlockCount"),
        repetitionsInLast7Days: Math.min(MAXIMUM_REPETITIONS, repetitionEndedAtMs.length),
        oldestRepetitionEndedAt:
          oldestRepetitionMs === null ? null : new Date(oldestRepetitionMs).toISOString(),
        repetitionWindowEndsAt,
        review: reviewSignal,
      };
    });
    growthPlan = {
      growthPlanId: requiredString(rawPlan, "growthPlanId"),
      version: requiredString(rawPlan, "version"),
      lifecycle: requiredString(rawPlan, "lifecycle") as "ACTIVE" | "PAUSED",
      weeklyCapacityMinutes: integer(rawPlan, "weeklyCapacityMinutes"),
      consumedMinutesThisWeek,
      tracks,
    };
  }

  if (
    hasPrerequisiteSource &&
    (usedPrerequisiteRefs.size !== masteryByCompetency.size ||
      [...masteryByCompetency.keys()].some((key) => !usedPrerequisiteRefs.has(key)))
  ) {
    fail("OWNER_FENCE_CONFLICT", "Mastery returned an unrequested prerequisite classification");
  }

  const sourceRevisions: PlanningSourceRevision[] = [
    ...objectArray(catalog.versions, "catalog.versions").map((version) =>
      sourceRevision(
        "CATALOG",
        requiredString(version, "catalogVersionKey"),
        `catalog-version:${integer(version, "versionNumber")}`,
      ),
    ),
    sourceRevision("EVIDENCE", "completed-work", requiredString(evidence, "revision")),
    sourceRevision("FOCUS", "completed-work", requiredString(completedWork, "revision")),
    sourceRevision("FOCUS", "workspace-focus", requiredString(focus, "revision")),
    sourceRevision("MASTERY", "prerequisite-scope", requiredString(mastery, "revision")),
    sourceRevision("OVERLAY", "workspace-overlay", requiredString(overlay, "revision")),
    sourceRevision("REVIEW", "workspace-review", requiredString(review, "revision")),
  ].sort((left, right) =>
    compareCodePoints(`${left.owner}\u001f${left.key}`, `${right.owner}\u001f${right.key}`),
  );

  const reviewValidUntil = optionalInstant(review.validUntil, "review.validUntil");
  const validUntil = minimumInstant([
    calendarValidUntil,
    reviewValidUntil,
    ...repetitionCutoffInstants,
    ...prerequisiteValidityInstants,
    ...readiness.map((item) => (item.availability === "CURRENT" ? item.validUntil : null)),
  ]);
  const unsigned: CalculatePlanInput = {
    inputFingerprint: "planning-input:" + "0".repeat(64),
    completedWorkPolicyVersion: COMPLETED_WORK_POLICY_VERSION,
    prerequisiteEngineVersion: MASTERY_PREREQUISITE_ENGINE_VERSION,
    prerequisitePolicyVersion: PREREQUISITE_POLICY_VERSION,
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
              planAttribution: activePlanAttribution(active.planAttribution),
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
