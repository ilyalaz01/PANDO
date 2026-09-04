import "server-only";

import {
  loadCapacityEffectPreviewV1,
  type CapacityEffectPreviewV1,
} from "../../../modules/planning/application/loaders/capacity-effect-preview";
import type { RationableTrackInput } from "../../../modules/planning/domain/calculate-plan";
import type { AvailabilityWindowSourceV1, CurrentLearningTracksV1 } from "../plan-types";

export type { CapacityEffectPreviewV1 };

/**
 * Adapts the two `/plan` reads the page already loads (`AvailabilityWindowSourceV1`,
 * `CurrentLearningTracksV1`) into the Planning module's UI-agnostic loader input, and returns null
 * exactly when there is no current Plan to preview — mirroring every other `/plan` section's
 * "no current Plan" handling. Issues no query of its own.
 */
export function buildCapacityEffectPreview(
  availabilitySource: AvailabilityWindowSourceV1,
  tracksWorkspace: CurrentLearningTracksV1,
): CapacityEffectPreviewV1 | null {
  if (availabilitySource.state === "NO_CURRENT_PLAN" || availabilitySource.growthPlan === null) {
    return null;
  }
  if (tracksWorkspace.growthPlan === null) return null;
  const tracks: readonly RationableTrackInput[] = tracksWorkspace.learningTracks.map((track) => ({
    trackId: track.learningTrackId,
    trackKey: track.trackKey,
    priority: track.priority,
    protectedMinimumMinutes: track.protectedMinimumMinutes,
    lifecycle: track.lifecycle,
  }));
  return loadCapacityEffectPreviewV1({
    currentLocalDate: availabilitySource.growthPlan.currentLocalDate,
    defaultWeeklyCapacityMinutes: availabilitySource.growthPlan.weeklyCapacityMinutes,
    growthPlanAggregateVersion: availabilitySource.growthPlan.aggregateVersion,
    activeWindows: availabilitySource.availabilityWindows.map((window) => ({
      windowKey: window.windowKey,
      startsOn: window.startsOn,
      endsOn: window.endsOn,
      availableMinutes: window.availableMinutes,
    })),
    tracks,
  });
}
