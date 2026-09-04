import { describe, expect, it } from "vitest";

import {
  addCalendarDays,
  capacityEffectPreviewDigestInput,
  capacityEffectTrackResults,
  composeDailyCapacityCaps,
  type CapacityEffectWindowInput,
} from "./capacity-effect-preview";
import type { RationableTrackInput } from "./calculate-plan";

function track(overrides: Partial<RationableTrackInput> = {}): RationableTrackInput {
  return {
    trackId: "10000000-0000-4000-8000-000000000001",
    trackKey: "track:backend",
    priority: 50,
    protectedMinimumMinutes: 60,
    lifecycle: "ACTIVE",
    ...overrides,
  };
}

describe("addCalendarDays", () => {
  it("adds whole calendar days without crossing a real time-zone instant", () => {
    expect(addCalendarDays("2026-08-31", 0)).toBe("2026-08-31");
    expect(addCalendarDays("2026-08-31", 6)).toBe("2026-09-06");
  });

  it("crosses a month and a leap-year February boundary correctly", () => {
    expect(addCalendarDays("2028-02-27", 3)).toBe("2028-03-01");
  });
});

describe("composeDailyCapacityCaps", () => {
  it("falls back every day to a full 1440-minute cap when there are no active windows", () => {
    const days = composeDailyCapacityCaps("2026-08-31", []);
    expect(days).toHaveLength(7);
    expect(days[0]).toEqual({ date: "2026-08-31", capMinutes: 1_440, sourceWindowKey: null });
    expect(days.every((day) => day.capMinutes === 1_440 && day.sourceWindowKey === null)).toBe(
      true,
    );
  });

  it("caps only the days one window's inclusive range covers", () => {
    const windows: readonly CapacityEffectWindowInput[] = [
      {
        windowKey: "window:1",
        startsOn: "2026-09-01",
        endsOn: "2026-09-02",
        availableMinutes: 120,
      },
    ];
    const days = composeDailyCapacityCaps("2026-08-31", windows);
    expect(days.map((day) => [day.date, day.capMinutes, day.sourceWindowKey])).toEqual([
      ["2026-08-31", 1_440, null],
      ["2026-09-01", 120, "window:1"],
      ["2026-09-02", 120, "window:1"],
      ["2026-09-03", 1_440, null],
      ["2026-09-04", 1_440, null],
      ["2026-09-05", 1_440, null],
      ["2026-09-06", 1_440, null],
    ]);
  });

  it("composes two disjoint windows across the seven-day range", () => {
    const windows: readonly CapacityEffectWindowInput[] = [
      { windowKey: "window:1", startsOn: "2026-08-31", endsOn: "2026-08-31", availableMinutes: 0 },
      {
        windowKey: "window:2",
        startsOn: "2026-09-05",
        endsOn: "2026-09-06",
        availableMinutes: 200,
      },
    ];
    const days = composeDailyCapacityCaps("2026-08-31", windows);
    expect(days[0]).toMatchObject({ capMinutes: 0, sourceWindowKey: "window:1" });
    expect(days[5]).toMatchObject({ capMinutes: 200, sourceWindowKey: "window:2" });
    expect(days[6]).toMatchObject({ capMinutes: 200, sourceWindowKey: "window:2" });
    expect(days.slice(1, 5).every((day) => day.sourceWindowKey === null)).toBe(true);
  });

  it("rejects a malformed local-date label", () => {
    expect(() => composeDailyCapacityCaps("2026/08/31", [])).toThrow(RangeError);
  });
});

describe("capacityEffectTrackResults", () => {
  it("orders active Tracks by priority desc, then trackKey asc, and rations deterministically", () => {
    const tracks = [
      track({ trackId: "1", trackKey: "track:b", priority: 50, protectedMinimumMinutes: 40 }),
      track({ trackId: "2", trackKey: "track:a", priority: 50, protectedMinimumMinutes: 40 }),
      track({ trackId: "3", trackKey: "track:c", priority: 90, protectedMinimumMinutes: 30 }),
    ];
    const results = capacityEffectTrackResults(tracks, 60);
    expect(results.map((result) => result.trackKey)).toEqual(["track:c", "track:a", "track:b"]);
    // Pool starts at 60: track:c (priority 90) claims its full 30, leaving 30 for the priority-50
    // pair, tie-broken by trackKey asc; track:a claims the remaining 30 (short of its 40 minimum),
    // and track:b receives nothing.
    expect(results[0]).toMatchObject({ reservedMinutes: 30, limited: false });
    expect(results[1]).toMatchObject({ reservedMinutes: 30, limited: true });
    expect(results[2]).toMatchObject({ reservedMinutes: 0, limited: true });
  });

  it("excludes paused and completed Tracks from the estimate", () => {
    const tracks = [
      track({ trackId: "1", lifecycle: "PAUSED" }),
      track({ trackId: "2", lifecycle: "COMPLETED" }),
    ];
    expect(capacityEffectTrackResults(tracks, 100)).toEqual([]);
  });

  it("reserves every active minimum in full when effective capacity is not limiting", () => {
    const tracks = [track({ protectedMinimumMinutes: 60 })];
    const results = capacityEffectTrackResults(tracks, 300);
    expect(results[0]).toMatchObject({ reservedMinutes: 60, limited: false });
  });
});

describe("capacityEffectPreviewDigestInput", () => {
  const baseFields = {
    growthPlanAggregateVersion: "5",
    asOfLocalDate: "2026-08-31",
    defaultWeeklyCapacityMinutes: 300,
    effectiveWeeklyCapacityMinutes: 300,
    dailyCaps: composeDailyCapacityCaps("2026-08-31", []),
    trackEffects: capacityEffectTrackResults([track()], 300),
    warningCodes: [] as readonly string[],
  };

  it("is deterministic for identical fields", () => {
    expect(capacityEffectPreviewDigestInput(baseFields)).toBe(
      capacityEffectPreviewDigestInput({ ...baseFields }),
    );
  });

  it("changes when the effective capacity changes", () => {
    const changed = capacityEffectPreviewDigestInput({
      ...baseFields,
      effectiveWeeklyCapacityMinutes: 140,
    });
    expect(changed).not.toBe(capacityEffectPreviewDigestInput(baseFields));
  });

  it("changes when the warning codes change", () => {
    const changed = capacityEffectPreviewDigestInput({
      ...baseFields,
      warningCodes: ["PROTECTED_MINIMUM_LIMITED_BY_AVAILABILITY"],
    });
    expect(changed).not.toBe(capacityEffectPreviewDigestInput(baseFields));
  });
});
