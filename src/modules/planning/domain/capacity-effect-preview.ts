import { growthPlanCapacityDigestField } from "./growth-plan-capacity-preview";
import { effectiveWeeklyCapacityMinutes } from "./availability-window-preview";
import { rationProtectedMinutes, type RationableTrackInput } from "./calculate-plan";
import type { DailyCapacityCapInput } from "./planning-types";

/**
 * D3b2-rollout's stateless interim capacity-effect preview. ADR-0010 §6 requires a persisted,
 * server-issued, single-use Planning proposal for a clock-sensitive preview; this session cannot
 * add the table or SQL that would require, so this preview is instead recomputed in full on every
 * read from already-loaded, already-authenticated data (`AvailabilityWindowSourceV1` plus
 * `CurrentLearningTracksV1`, both already granted `/plan` reads) and never persisted. It is exact
 * and reproducible (the digest below proves that), but — unlike the ADR's persisted proposal — it
 * cannot fail closed on server-side replay or expiry, only on a digest mismatch between two reads.
 * Documented as a deliberate, temporary deviation; see the D3b2-rollout status report.
 */
export const CAPACITY_EFFECT_PREVIEW_DIGEST_VERSION =
  "capacity-effect-preview-digest/1.0.0" as const;
export const CAPACITY_EFFECT_PREVIEW_CALCULATION_CONTRACT = "planning-calculation/3" as const;
export const CAPACITY_EFFECT_LIMITED_WARNING = "PROTECTED_MINIMUM_LIMITED_BY_AVAILABILITY" as const;

const MILLISECONDS_PER_DAY = 86_400_000;
const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/u;
const DAYS_IN_PREVIEW_WINDOW = 7;

function compareCodePoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function calendarDateMs(date: string, label: string): number {
  if (!LOCAL_DATE.test(date)) throw new RangeError(`${label} must be a local calendar date`);
  const ms = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(ms)) throw new RangeError(`${label} is not a valid calendar date`);
  return ms;
}

/** Adds whole calendar days to a local date label, never crossing a real time-zone instant. */
export function addCalendarDays(date: string, days: number): string {
  const ms = calendarDateMs(date, "date") + days * MILLISECONDS_PER_DAY;
  return new Date(ms).toISOString().slice(0, 10);
}

export interface CapacityEffectWindowInput {
  readonly windowKey: string;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly availableMinutes: number;
}

/**
 * A rolling seven-local-day window starting at the server-resolved current local date. This is a
 * deliberate, honest approximation of ADR-0010 §6's "plan week whose seven local days are d1..d7":
 * the live `/plan` read boundary this preview reuses has no granted read for the async worker's
 * Monday-anchored calendar-week boundaries, so it previews the *next seven days* instead. It can
 * therefore disagree with a future persisted V3 snapshot's own plan-week boundaries; the caller
 * must present it as an estimate, never as the current week's authoritative capacity.
 */
export function composeDailyCapacityCaps(
  asOfLocalDate: string,
  windows: readonly CapacityEffectWindowInput[],
): readonly DailyCapacityCapInput[] {
  calendarDateMs(asOfLocalDate, "asOfLocalDate");
  const ordered = [...windows].sort((left, right) =>
    compareCodePoints(left.startsOn, right.startsOn),
  );
  const days: DailyCapacityCapInput[] = [];
  for (let offset = 0; offset < DAYS_IN_PREVIEW_WINDOW; offset += 1) {
    const date = addCalendarDays(asOfLocalDate, offset);
    const covering = ordered.find((window) => window.startsOn <= date && date <= window.endsOn);
    days.push({
      date,
      capMinutes: covering === undefined ? 1_440 : covering.availableMinutes,
      sourceWindowKey: covering === undefined ? null : covering.windowKey,
    });
  }
  return days;
}

export interface TrackCapacityEffect {
  readonly trackId: string;
  readonly trackKey: string;
  readonly protectedMinimumMinutes: number;
  readonly reservedMinutes: number;
  readonly limited: boolean;
}

/** Deterministic `(priority desc, trackKey asc)` order, matching the V3 engine's own ordering. */
export function capacityEffectTrackResults(
  tracks: readonly RationableTrackInput[],
  effectiveWeeklyCapacityMinutesValue: number,
): readonly TrackCapacityEffect[] {
  const active = tracks.filter((track) => track.lifecycle === "ACTIVE");
  const rationed = rationProtectedMinutes(active, effectiveWeeklyCapacityMinutesValue);
  return active
    .slice()
    .sort(
      (left, right) =>
        right.priority - left.priority || compareCodePoints(left.trackKey, right.trackKey),
    )
    .map((track) => {
      const ration = rationed.get(track.trackId);
      if (ration === undefined) throw new RangeError("Rationing omitted an active Track");
      return {
        trackId: track.trackId,
        trackKey: track.trackKey,
        protectedMinimumMinutes: track.protectedMinimumMinutes,
        reservedMinutes: ration.reservedMinutes,
        limited: ration.limited,
      };
    });
}

export interface CapacityEffectPreviewDigestFields {
  readonly growthPlanAggregateVersion: string;
  readonly asOfLocalDate: string;
  readonly defaultWeeklyCapacityMinutes: number;
  readonly effectiveWeeklyCapacityMinutes: number;
  readonly dailyCaps: readonly DailyCapacityCapInput[];
  readonly trackEffects: readonly TrackCapacityEffect[];
  readonly warningCodes: readonly string[];
}

/**
 * Canonical input hashed into the stateless capacity-effect preview's `previewDigest`. Unlike
 * `availabilityWindowPreviewDigestInput` (whose digest SQL computes authoritatively, with the
 * TypeScript builder kept only as an independently checkable parity reference), this function's
 * caller is the *only* place this digest is ever computed — there is no SQL counterpart, because
 * this preview never reaches the database. It fences on `growthPlanAggregateVersion` rather than a
 * workspace or actor identifier, because the live `/plan` read boundary this preview composes from
 * never exposes either to server-rendered or client code — only session-resolved, already-scoped
 * state.
 */
export function capacityEffectPreviewDigestInput(value: CapacityEffectPreviewDigestFields): string {
  return [
    growthPlanCapacityDigestField("digestVersion", CAPACITY_EFFECT_PREVIEW_DIGEST_VERSION),
    growthPlanCapacityDigestField(
      "calculationContract",
      CAPACITY_EFFECT_PREVIEW_CALCULATION_CONTRACT,
    ),
    growthPlanCapacityDigestField("growthPlanAggregateVersion", value.growthPlanAggregateVersion),
    growthPlanCapacityDigestField("asOfLocalDate", value.asOfLocalDate),
    growthPlanCapacityDigestField(
      "defaultWeeklyCapacityMinutes",
      String(value.defaultWeeklyCapacityMinutes),
    ),
    growthPlanCapacityDigestField(
      "effectiveWeeklyCapacityMinutes",
      String(value.effectiveWeeklyCapacityMinutes),
    ),
    ...value.dailyCaps.flatMap((cap) => [
      growthPlanCapacityDigestField("dailyCapDate", cap.date),
      growthPlanCapacityDigestField("dailyCapMinutes", String(cap.capMinutes)),
      growthPlanCapacityDigestField("dailyCapSourceWindowKey", cap.sourceWindowKey ?? ""),
    ]),
    growthPlanCapacityDigestField("trackEffectCount", String(value.trackEffects.length)),
    ...value.trackEffects.flatMap((effect) => [
      growthPlanCapacityDigestField("trackId", effect.trackId.toLowerCase()),
      growthPlanCapacityDigestField("trackKey", effect.trackKey),
      growthPlanCapacityDigestField(
        "protectedMinimumMinutes",
        String(effect.protectedMinimumMinutes),
      ),
      growthPlanCapacityDigestField("reservedMinutes", String(effect.reservedMinutes)),
      growthPlanCapacityDigestField("limited", String(effect.limited)),
    ]),
    growthPlanCapacityDigestField("warningCount", String(value.warningCodes.length)),
    ...value.warningCodes.map((code) => growthPlanCapacityDigestField("warningCode", code)),
  ].join("");
}

export { effectiveWeeklyCapacityMinutes };
