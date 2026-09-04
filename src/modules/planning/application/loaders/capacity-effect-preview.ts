import "server-only";

import { sha256 } from "../../../../shared/contracts/json";
import {
  CAPACITY_EFFECT_PREVIEW_CALCULATION_CONTRACT,
  CAPACITY_EFFECT_PREVIEW_DIGEST_VERSION,
  CAPACITY_EFFECT_LIMITED_WARNING,
  capacityEffectPreviewDigestInput,
  capacityEffectTrackResults,
  composeDailyCapacityCaps,
  effectiveWeeklyCapacityMinutes,
  type CapacityEffectWindowInput,
  type TrackCapacityEffect,
} from "../../domain/capacity-effect-preview";
import type { RationableTrackInput } from "../../domain/calculate-plan";
import type { DailyCapacityCapInput } from "../../domain/planning-types";

/**
 * Real `AvailabilityWindow` and Learning Track rows, already loaded through the granted,
 * session-scoped `/plan` reads (`get_availability_window_source_v1`, `get_current_learning_tracks_v1`)
 * — this loader issues no query of its own and never touches Supabase. It exists to compose those
 * two already-authenticated reads into the same day-cap and rationing shape ADR-0010 §6 defines for
 * `PlanningCalculationInputV3`, so the live capacity-effect preview and (once activated) the real V3
 * snapshot compute from one shared implementation.
 */
export interface CapacityEffectPreviewSource {
  readonly currentLocalDate: string;
  readonly defaultWeeklyCapacityMinutes: number;
  readonly growthPlanAggregateVersion: string;
  readonly activeWindows: readonly CapacityEffectWindowInput[];
  readonly tracks: readonly RationableTrackInput[];
}

export interface CapacityEffectPreviewV1 {
  readonly contract: { readonly name: "CapacityEffectPreviewV1"; readonly version: "1.0.0" };
  readonly calculationContract: typeof CAPACITY_EFFECT_PREVIEW_CALCULATION_CONTRACT;
  readonly digestVersion: typeof CAPACITY_EFFECT_PREVIEW_DIGEST_VERSION;
  readonly asOfLocalDate: string;
  readonly defaultWeeklyCapacityMinutes: number;
  readonly effectiveWeeklyCapacityMinutes: number;
  readonly capacityLimitedByAvailability: boolean;
  readonly dailyCaps: readonly DailyCapacityCapInput[];
  readonly trackEffects: readonly TrackCapacityEffect[];
  readonly warningCodes: readonly string[];
  readonly previewDigest: string;
}

/**
 * Builds the stateless D3b2-rollout capacity-effect preview described in the D3b2-rollout status
 * report: recomputed in full on every call, never persisted, honestly labeled as an estimate. Pure
 * composition over already-fetched data — safe to call from a Server Component render.
 */
export function loadCapacityEffectPreviewV1(
  source: CapacityEffectPreviewSource,
): CapacityEffectPreviewV1 {
  const dailyCaps = composeDailyCapacityCaps(source.currentLocalDate, source.activeWindows);
  const effective = effectiveWeeklyCapacityMinutes(
    source.defaultWeeklyCapacityMinutes,
    dailyCaps.map((cap) => cap.capMinutes),
  );
  const trackEffects = capacityEffectTrackResults(source.tracks, effective);
  const capacityLimitedByAvailability = effective < source.defaultWeeklyCapacityMinutes;
  const warningCodes = trackEffects.some((effect) => effect.limited)
    ? [CAPACITY_EFFECT_LIMITED_WARNING]
    : [];
  const previewDigest = sha256(
    capacityEffectPreviewDigestInput({
      growthPlanAggregateVersion: source.growthPlanAggregateVersion,
      asOfLocalDate: source.currentLocalDate,
      defaultWeeklyCapacityMinutes: source.defaultWeeklyCapacityMinutes,
      effectiveWeeklyCapacityMinutes: effective,
      dailyCaps,
      trackEffects,
      warningCodes,
    }),
  );
  return {
    contract: { name: "CapacityEffectPreviewV1", version: "1.0.0" },
    calculationContract: CAPACITY_EFFECT_PREVIEW_CALCULATION_CONTRACT,
    digestVersion: CAPACITY_EFFECT_PREVIEW_DIGEST_VERSION,
    asOfLocalDate: source.currentLocalDate,
    defaultWeeklyCapacityMinutes: source.defaultWeeklyCapacityMinutes,
    effectiveWeeklyCapacityMinutes: effective,
    capacityLimitedByAvailability,
    dailyCaps,
    trackEffects,
    warningCodes,
    previewDigest,
  };
}
