import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CapacityEffectPreview } from "./capacity-effect-preview";
import type { CapacityEffectPreviewV1 } from "./plan-types";

function preview(overrides: Partial<CapacityEffectPreviewV1> = {}): CapacityEffectPreviewV1 {
  return {
    contract: { name: "CapacityEffectPreviewV1", version: "1.0.0" },
    calculationContract: "planning-calculation/3",
    digestVersion: "capacity-effect-preview-digest/1.0.0",
    asOfLocalDate: "2026-08-31",
    defaultWeeklyCapacityMinutes: 300,
    effectiveWeeklyCapacityMinutes: 300,
    capacityLimitedByAvailability: false,
    dailyCaps: [
      { date: "2026-08-31", capMinutes: 1_440, sourceWindowKey: null },
      { date: "2026-09-01", capMinutes: 1_440, sourceWindowKey: null },
      { date: "2026-09-02", capMinutes: 1_440, sourceWindowKey: null },
      { date: "2026-09-03", capMinutes: 1_440, sourceWindowKey: null },
      { date: "2026-09-04", capMinutes: 1_440, sourceWindowKey: null },
      { date: "2026-09-05", capMinutes: 1_440, sourceWindowKey: null },
      { date: "2026-09-06", capMinutes: 1_440, sourceWindowKey: null },
    ],
    trackEffects: [],
    warningCodes: [],
    previewDigest: "0".repeat(64),
    ...overrides,
  };
}

describe("CapacityEffectPreview", () => {
  it("shows the unlimited estimate and every daily cap without a rationing notice", () => {
    render(<CapacityEffectPreview preview={preview()} />);
    const region = screen.getByRole("region", { name: "Estimated capacity effect" });
    expect(within(region).getByText("300 of 300")).toBeVisible();
    const dailyList = screen.getByLabelText("Estimated daily capacity");
    expect(within(dailyList).getAllByRole("listitem")).toHaveLength(7);
    expect(within(dailyList).getByText("2026-08-31")).toBeVisible();
    expect(screen.queryByLabelText("Estimated Track rationing")).not.toBeInTheDocument();
  });

  it("shows the limited estimate and every rationed Track", () => {
    render(
      <CapacityEffectPreview
        preview={preview({
          effectiveWeeklyCapacityMinutes: 35,
          capacityLimitedByAvailability: true,
          warningCodes: ["PROTECTED_MINIMUM_LIMITED_BY_AVAILABILITY"],
          trackEffects: [
            {
              trackId: "1",
              trackKey: "track:backend",
              protectedMinimumMinutes: 60,
              reservedMinutes: 35,
              limited: true,
            },
          ],
        })}
      />,
    );
    expect(screen.getByText("35 of 300")).toBeVisible();
    expect(screen.getByText(/limited by recorded availability/iu)).toBeVisible();
    const rationingList = screen.getByLabelText("Estimated Track rationing");
    expect(within(rationingList).getByText("track:backend")).toBeVisible();
    expect(within(rationingList).getByText("35 of 60 protected minutes")).toBeVisible();
  });
});
