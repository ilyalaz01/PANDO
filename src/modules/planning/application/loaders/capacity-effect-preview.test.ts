// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  loadCapacityEffectPreviewV1,
  type CapacityEffectPreviewSource,
} from "./capacity-effect-preview";

const SHA_256_HEX = /^[0-9a-f]{64}$/u;

function source(overrides: Partial<CapacityEffectPreviewSource> = {}): CapacityEffectPreviewSource {
  return {
    currentLocalDate: "2026-08-31",
    defaultWeeklyCapacityMinutes: 300,
    growthPlanAggregateVersion: "5",
    activeWindows: [],
    tracks: [
      {
        trackId: "10000000-0000-4000-8000-000000000001",
        trackKey: "track:backend",
        priority: 50,
        protectedMinimumMinutes: 60,
        lifecycle: "ACTIVE",
      },
    ],
    ...overrides,
  };
}

describe("loadCapacityEffectPreviewV1", () => {
  it("composes real Availability window rows into an unlimited estimate with a valid digest", () => {
    const preview = loadCapacityEffectPreviewV1(source());
    expect(preview).toMatchObject({
      contract: { name: "CapacityEffectPreviewV1", version: "1.0.0" },
      calculationContract: "planning-calculation/3",
      asOfLocalDate: "2026-08-31",
      defaultWeeklyCapacityMinutes: 300,
      effectiveWeeklyCapacityMinutes: 300,
      capacityLimitedByAvailability: false,
      warningCodes: [],
    });
    expect(preview.dailyCaps).toHaveLength(7);
    expect(preview.previewDigest).toMatch(SHA_256_HEX);
  });

  it("limits effective capacity and rations protected minutes from a real recorded window", () => {
    const preview = loadCapacityEffectPreviewV1(
      source({
        activeWindows: [
          {
            windowKey: "window:1",
            startsOn: "2026-08-31",
            endsOn: "2026-09-06",
            availableMinutes: 5,
          },
        ],
      }),
    );
    expect(preview.effectiveWeeklyCapacityMinutes).toBe(35);
    expect(preview.capacityLimitedByAvailability).toBe(true);
    expect(preview.warningCodes).toEqual(["PROTECTED_MINIMUM_LIMITED_BY_AVAILABILITY"]);
    expect(preview.trackEffects).toEqual([
      {
        trackId: "10000000-0000-4000-8000-000000000001",
        trackKey: "track:backend",
        protectedMinimumMinutes: 60,
        reservedMinutes: 35,
        limited: true,
      },
    ]);
  });

  it("ignores a paused or completed Track when rationing", () => {
    const preview = loadCapacityEffectPreviewV1(
      source({
        tracks: [
          {
            trackId: "1",
            trackKey: "track:paused",
            priority: 90,
            protectedMinimumMinutes: 500,
            lifecycle: "PAUSED",
          },
        ],
      }),
    );
    expect(preview.trackEffects).toEqual([]);
    expect(preview.warningCodes).toEqual([]);
  });

  it("produces the same digest for the same real inputs and a different one for a changed window", () => {
    const first = loadCapacityEffectPreviewV1(source());
    const second = loadCapacityEffectPreviewV1(source());
    expect(first.previewDigest).toBe(second.previewDigest);

    const changed = loadCapacityEffectPreviewV1(
      source({
        activeWindows: [
          {
            windowKey: "window:1",
            startsOn: "2026-08-31",
            endsOn: "2026-08-31",
            availableMinutes: 0,
          },
        ],
      }),
    );
    expect(changed.previewDigest).not.toBe(first.previewDigest);
  });
});
