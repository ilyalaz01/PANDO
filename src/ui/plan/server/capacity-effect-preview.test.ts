// @vitest-environment node

import { describe, expect, it } from "vitest";

import { buildCapacityEffectPreview } from "./capacity-effect-preview";
import type { AvailabilityWindowSourceV1, CurrentLearningTracksV1 } from "../plan-types";

const availabilitySource: AvailabilityWindowSourceV1 = {
  contract: { name: "AvailabilityWindowSourceV1", version: "1.0.0" },
  state: "AVAILABILITY_AVAILABLE",
  capabilities: ["create_availability_window"],
  growthPlan: {
    lifecycle: "ACTIVE",
    weeklyCapacityMinutes: 300,
    aggregateVersion: "5",
    timeZone: "America/New_York",
    currentLocalDate: "2026-08-31",
    activeWindowCount: 1,
    activeWindowLimit: 60,
    removedWindowCount: 0,
    capacityUsesAvailability: false,
  },
  availabilityWindows: [
    {
      windowKey: "window:1",
      startsOn: "2026-08-31",
      endsOn: "2026-09-06",
      timeZone: "America/New_York",
      availableMinutes: 5,
      energy: null,
      label: null,
      lifecycle: "ACTIVE",
      aggregateVersion: "1",
    },
  ],
  removedAvailabilityWindows: [],
};

const tracksWorkspace: CurrentLearningTracksV1 = {
  contract: { name: "CurrentLearningTracksV1", version: "1.0.0" },
  growthPlan: {
    growthPlanId: "20000000-0000-4000-8000-000000000001",
    lifecycle: "ACTIVE",
    weeklyCapacityMinutes: 300,
    aggregateVersion: "5",
  },
  learningTracks: [
    {
      learningTrackId: "30000000-0000-4000-8000-000000000001",
      trackKey: "track:backend",
      title: "Backend",
      lifecycle: "ACTIVE",
      priority: 50,
      protectedMinimumMinutes: 60,
      aggregateVersion: "2",
      capabilities: ["pause_track"],
    },
  ],
};

describe("buildCapacityEffectPreview", () => {
  it("adapts the already-loaded availability and Track reads into a real preview", () => {
    const preview = buildCapacityEffectPreview(availabilitySource, tracksWorkspace);
    expect(preview).not.toBeNull();
    expect(preview).toMatchObject({
      asOfLocalDate: "2026-08-31",
      defaultWeeklyCapacityMinutes: 300,
      effectiveWeeklyCapacityMinutes: 35,
      capacityLimitedByAvailability: true,
      warningCodes: ["PROTECTED_MINIMUM_LIMITED_BY_AVAILABILITY"],
    });
    expect(preview?.trackEffects).toEqual([
      {
        trackId: "30000000-0000-4000-8000-000000000001",
        trackKey: "track:backend",
        protectedMinimumMinutes: 60,
        reservedMinutes: 35,
        limited: true,
      },
    ]);
  });

  it("returns null when there is no current Plan", () => {
    const preview = buildCapacityEffectPreview(
      {
        contract: { name: "AvailabilityWindowSourceV1", version: "1.0.0" },
        state: "NO_CURRENT_PLAN",
        capabilities: [],
        growthPlan: null,
        availabilityWindows: [],
        removedAvailabilityWindows: [],
      },
      {
        contract: { name: "CurrentLearningTracksV1", version: "1.0.0" },
        growthPlan: null,
        learningTracks: [],
      },
    );
    expect(preview).toBeNull();
  });
});
