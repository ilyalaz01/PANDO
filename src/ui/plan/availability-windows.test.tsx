import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), preview: vi.fn(), apply: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("../../app/plan/actions", () => ({
  previewAvailabilityWindowAction: mocks.preview,
  applyAvailabilityWindowAction: mocks.apply,
}));

import createPreviewFixture from "../../../tests/contract/fixtures/planning/v1/availability-window-control.valid.json";
import removePreviewFixture from "../../../tests/contract/fixtures/planning/v1/availability-window-control.remove.json";
import type { AvailabilityWindowPreviewV1, AvailabilityWindowSourceV1 } from "./plan-types";
import { AvailabilityWindows } from "./availability-windows";
import type { PlanActionState } from "./plan-action-state";

const createPreview = createPreviewFixture as unknown as AvailabilityWindowPreviewV1;
const removePreview = removePreviewFixture as unknown as AvailabilityWindowPreviewV1;

const source: AvailabilityWindowSourceV1 = {
  contract: { name: "AvailabilityWindowSourceV1", version: "1.0.0" },
  state: "AVAILABILITY_AVAILABLE",
  capabilities: [
    "create_availability_window",
    "change_availability_window",
    "remove_availability_window",
  ],
  growthPlan: {
    lifecycle: createPreview.growthPlan.lifecycle,
    weeklyCapacityMinutes: createPreview.growthPlan.weeklyCapacityMinutes,
    aggregateVersion: createPreview.growthPlan.aggregateVersion,
    timeZone: "America/New_York",
    currentLocalDate: "2026-09-04",
    activeWindowCount: 1,
    activeWindowLimit: 60,
    removedWindowCount: 1,
    capacityUsesAvailability: false,
  },
  availabilityWindows: [
    {
      windowKey: "window:76000002-0000-8000-8000-000000000002",
      startsOn: "2026-11-01",
      endsOn: "2026-11-05",
      timeZone: "America/New_York",
      availableMinutes: 240,
      energy: "MEDIUM",
      label: "Half days",
      lifecycle: "ACTIVE",
      aggregateVersion: "2",
    },
  ],
  removedAvailabilityWindows: [],
};

const noWindowSource: AvailabilityWindowSourceV1 = {
  ...source,
  availabilityWindows: [],
  growthPlan: { ...source.growthPlan!, activeWindowCount: 0, removedWindowCount: 0 },
};

const limitReachedSource: AvailabilityWindowSourceV1 = {
  ...source,
  state: "WINDOW_LIMIT_REACHED",
  capabilities: ["change_availability_window", "remove_availability_window"],
  growthPlan: { ...source.growthPlan!, activeWindowCount: 60 },
};

const secondWindow = {
  windowKey: "window:76000003-0000-8000-8000-000000000003",
  startsOn: "2027-01-10",
  endsOn: "2027-01-12",
  timeZone: "America/New_York",
  availableMinutes: 0,
  energy: null,
  label: null,
  lifecycle: "ACTIVE",
  aggregateVersion: "1",
} as const;

const twoWindowSource: AvailabilityWindowSourceV1 = {
  ...source,
  growthPlan: { ...source.growthPlan!, activeWindowCount: 2, removedWindowCount: 0 },
  availabilityWindows: [...source.availabilityWindows, secondWindow],
};

const changePreview: AvailabilityWindowPreviewV1 = {
  ...createPreview,
  operation: "change_availability_window",
  before: {
    activeWindowCount: 1,
    removedWindowCount: 1,
    activeWindowFingerprint: createPreview.before.activeWindowFingerprint,
    window: {
      windowKey: source.availabilityWindows[0]!.windowKey,
      availabilityWindowId: "76000002-0000-8000-8000-000000000002",
      startsOn: source.availabilityWindows[0]!.startsOn,
      endsOn: source.availabilityWindows[0]!.endsOn,
      timeZone: source.availabilityWindows[0]!.timeZone,
      availableMinutes: source.availabilityWindows[0]!.availableMinutes,
      energy: source.availabilityWindows[0]!.energy,
      label: source.availabilityWindows[0]!.label,
      lifecycle: "ACTIVE",
      aggregateVersion: source.availabilityWindows[0]!.aggregateVersion,
    },
  },
  after: {
    activeWindowCount: 1,
    window: {
      windowKey: source.availabilityWindows[0]!.windowKey,
      availabilityWindowId: "76000002-0000-8000-8000-000000000002",
      startsOn: "2026-11-02",
      endsOn: "2026-11-06",
      timeZone: source.availabilityWindows[0]!.timeZone,
      availableMinutes: 300,
      energy: "HIGH",
      label: "Half days extended",
      lifecycle: "ACTIVE",
      aggregateVersion: "3",
    },
  },
};

const previewState: PlanActionState = {
  status: "previewed",
  message: "Availability preview ready.",
  preview: createPreview,
};

describe("AvailabilityWindows", () => {
  it("renders the exact before/after comparison and every warning", () => {
    render(<AvailabilityWindows initialPreviewState={previewState} source={source} />);
    const comparison = screen.getByLabelText("Exact availability window preview");
    expect(within(comparison).getByText("2026-10-01 – 2026-10-03")).toBeVisible();
    expect(comparison).toHaveTextContent("180 minutes/day");
    expect(comparison).toHaveTextContent("2 → 3");
    expect(
      screen.getByText(/Recorded availability does not change weekly capacity yet/u),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Confirm availability change" })).toBeEnabled();
  });

  it("binds both expected versions and the exact digest to the confirmation", () => {
    const { container } = render(
      <AvailabilityWindows initialPreviewState={previewState} source={source} />,
    );
    const hidden = [...container.querySelectorAll<HTMLInputElement>("input[type=hidden]")];
    const value = (name: string) =>
      hidden.filter((input) => input.name === name).map((input) => input.value);
    expect(value("expectedGrowthPlanVersion")).toContain(createPreview.expectedGrowthPlanVersion);
    expect(value("previewDigest")).toContain(createPreview.previewDigest);
    expect(value("requestId")).toContain(createPreview.idempotencyKey);
    expect(value("windowKey")).toContain("");
  });

  it("submits the removed window's prior version and no proposed fields on a remove confirmation", () => {
    const removeState: PlanActionState = {
      status: "previewed",
      message: "Availability preview ready.",
      preview: removePreview,
    };
    const { container } = render(
      <AvailabilityWindows initialPreviewState={removeState} source={source} />,
    );
    const hidden = [...container.querySelectorAll<HTMLInputElement>("input[type=hidden]")];
    const value = (name: string) =>
      hidden.filter((input) => input.name === name).map((input) => input.value);
    expect(value("expectedWindowVersion")).toContain(removePreview.before.window!.aggregateVersion);
    expect(value("startsOn")).toContain("");
    expect(value("operation")).toContain("remove_availability_window");
  });

  it("dismisses a stale confirmation when the create-window intent changes", () => {
    render(<AvailabilityWindows initialPreviewState={previewState} source={source} />);
    const createSection = screen.getByRole("region", { name: "Add an availability window" });
    fireEvent.change(within(createSection).getByLabelText("Available minutes per day (0–1440)"), {
      target: { value: "300" },
    });
    expect(
      screen.queryByRole("button", { name: "Confirm availability change" }),
    ).not.toBeInTheDocument();
  });

  it("dismisses a stale confirmation when a sibling Plan intent starts", () => {
    const { rerender } = render(
      <AvailabilityWindows
        dismissalVersion={0}
        initialPreviewState={previewState}
        source={source}
      />,
    );
    expect(screen.getByRole("button", { name: "Confirm availability change" })).toBeVisible();
    rerender(
      <AvailabilityWindows
        dismissalVersion={1}
        initialPreviewState={previewState}
        source={source}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Confirm availability change" }),
    ).not.toBeInTheDocument();
  });

  it("hides the create control once the active-window limit is reached", () => {
    render(<AvailabilityWindows source={limitReachedSource} />);
    expect(
      screen.queryByRole("heading", { name: "Add an availability window" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Edit or remove a window" })).toBeVisible();
  });

  it("hides the manage control when no active window exists yet", () => {
    render(<AvailabilityWindows source={noWindowSource} />);
    expect(screen.getByRole("heading", { name: "Add an availability window" })).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "Edit or remove a window" }),
    ).not.toBeInTheDocument();
  });

  it("renders nothing when there is no current Plan", () => {
    const { container } = render(
      <AvailabilityWindows
        source={{
          contract: { name: "AvailabilityWindowSourceV1", version: "1.0.0" },
          state: "NO_CURRENT_PLAN",
          capabilities: [],
          growthPlan: null,
          availabilityWindows: [],
          removedAvailabilityWindows: [],
        }}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("hides the confirmation while a blocked preview explains the exact blocker", () => {
    const blocked: AvailabilityWindowPreviewV1 = {
      ...createPreview,
      canApply: false,
      blockingReasons: [{ code: "AVAILABILITY_WINDOW_OVERLAPS_EXISTING" }],
    };
    render(
      <AvailabilityWindows
        initialPreviewState={{ status: "previewed", message: "Blocked", preview: blocked }}
        source={source}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "These dates overlap an existing active window.",
    );
    expect(
      screen.queryByRole("button", { name: "Confirm availability change" }),
    ).not.toBeInTheDocument();
  });

  it("binds the changed window's proposed fields and its prior version on a change confirmation", () => {
    const changeState: PlanActionState = {
      status: "previewed",
      message: "Availability preview ready.",
      preview: changePreview,
    };
    const { container } = render(
      <AvailabilityWindows initialPreviewState={changeState} source={source} />,
    );
    const hidden = [...container.querySelectorAll<HTMLInputElement>("input[type=hidden]")];
    const value = (name: string) =>
      hidden.filter((input) => input.name === name).map((input) => input.value);
    expect(value("operation")).toContain("change_availability_window");
    expect(value("startsOn")).toContain("2026-11-02");
    expect(value("energy")).toContain("HIGH");
    expect(value("label")).toContain("Half days extended");
    expect(value("expectedWindowVersion")).toContain(changePreview.before.window!.aggregateVersion);
    expect(value("windowKey")).toContain(changePreview.after.window.windowKey);
  });

  it("shows every active window and omits the removed-history notice when there is none", () => {
    render(<AvailabilityWindows source={twoWindowSource} />);
    expect(screen.queryByText(/kept as history/iu)).not.toBeInTheDocument();
    const manageRegion = screen.getByRole("region", { name: "Edit or remove a window" });
    expect(
      within(within(manageRegion).getByLabelText("Window")).getAllByRole("option"),
    ).toHaveLength(2);
  });

  it("updates manage form fields for the selected window and hides them while removing", () => {
    render(<AvailabilityWindows source={twoWindowSource} />);
    const manageRegion = screen.getByRole("region", { name: "Edit or remove a window" });
    fireEvent.change(within(manageRegion).getByLabelText("Window"), {
      target: { value: secondWindow.windowKey },
    });
    expect(within(manageRegion).getByLabelText("Starts on")).toHaveValue(secondWindow.startsOn);
    expect(within(manageRegion).getByLabelText("Available minutes per day (0–1440)")).toHaveValue(
      0,
    );
    fireEvent.change(within(manageRegion).getByLabelText("Action"), {
      target: { value: "remove_availability_window" },
    });
    expect(within(manageRegion).queryByLabelText("Starts on")).not.toBeInTheDocument();
    expect(within(manageRegion).queryByLabelText("Energy (optional)")).not.toBeInTheDocument();
  });

  it("marks the create form dirty from every field", () => {
    render(<AvailabilityWindows initialPreviewState={previewState} source={source} />);
    const createRegion = screen.getByRole("region", { name: "Add an availability window" });
    fireEvent.change(within(createRegion).getByLabelText("Starts on"), {
      target: { value: "2026-12-01" },
    });
    fireEvent.change(within(createRegion).getByLabelText("Ends on"), {
      target: { value: "2026-12-05" },
    });
    fireEvent.change(within(createRegion).getByLabelText("Energy (optional)"), {
      target: { value: "HIGH" },
    });
    fireEvent.change(within(createRegion).getByLabelText("Label (optional)"), {
      target: { value: "Retreat" },
    });
    fireEvent.change(within(createRegion).getByLabelText("Why does this window belong now?"), {
      target: { value: "Because reasons" },
    });
    expect(
      screen.queryByRole("button", { name: "Confirm availability change" }),
    ).not.toBeInTheDocument();
  });

  it("marks the manage form dirty from every field while changing", () => {
    render(<AvailabilityWindows initialPreviewState={previewState} source={source} />);
    const manageRegion = screen.getByRole("region", { name: "Edit or remove a window" });
    fireEvent.change(within(manageRegion).getByLabelText("Starts on"), {
      target: { value: "2026-12-01" },
    });
    fireEvent.change(within(manageRegion).getByLabelText("Ends on"), {
      target: { value: "2026-12-05" },
    });
    fireEvent.change(within(manageRegion).getByLabelText("Energy (optional)"), {
      target: { value: "HIGH" },
    });
    fireEvent.change(within(manageRegion).getByLabelText("Label (optional)"), {
      target: { value: "Retreat" },
    });
    fireEvent.change(within(manageRegion).getByLabelText("Why is this window changing?"), {
      target: { value: "Because reasons" },
    });
    expect(
      screen.queryByRole("button", { name: "Confirm availability change" }),
    ).not.toBeInTheDocument();
  });

  it("submits a fresh request id when the create form is previewed", () => {
    mocks.preview.mockImplementation(() => new Promise<PlanActionState>(() => undefined));
    const { container } = render(<AvailabilityWindows source={source} />);
    const createRegion = screen.getByRole("region", { name: "Add an availability window" });
    fireEvent.change(within(createRegion).getByLabelText("Starts on"), {
      target: { value: "2026-12-01" },
    });
    fireEvent.change(within(createRegion).getByLabelText("Ends on"), {
      target: { value: "2026-12-05" },
    });
    fireEvent.change(within(createRegion).getByLabelText("Available minutes per day (0–1440)"), {
      target: { value: "200" },
    });
    fireEvent.change(within(createRegion).getByLabelText("Why does this window belong now?"), {
      target: { value: "Trip" },
    });
    fireEvent.click(within(createRegion).getByRole("button", { name: "Preview new window" }));
    const requestIdInputs = [
      ...container.querySelectorAll<HTMLInputElement>("input[name=requestId]"),
    ];
    expect(requestIdInputs.some((input) => input.value.length > 0)).toBe(true);
  });

  it("submits a fresh request id when the manage form is previewed", () => {
    mocks.preview.mockImplementation(() => new Promise<PlanActionState>(() => undefined));
    const { container } = render(<AvailabilityWindows source={source} />);
    const manageRegion = screen.getByRole("region", { name: "Edit or remove a window" });
    fireEvent.change(within(manageRegion).getByLabelText("Why is this window changing?"), {
      target: { value: "Because reasons" },
    });
    fireEvent.click(within(manageRegion).getByRole("button", { name: "Preview window change" }));
    const requestIdInputs = [
      ...container.querySelectorAll<HTMLInputElement>("input[name=requestId]"),
    ];
    expect(requestIdInputs.some((input) => input.value.length > 0)).toBe(true);
  });

  it("dismisses the confirmation without applying when Start over is clicked", () => {
    render(<AvailabilityWindows initialPreviewState={previewState} source={source} />);
    expect(screen.getByRole("button", { name: "Confirm availability change" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Start over" }));
    expect(
      screen.queryByRole("button", { name: "Confirm availability change" }),
    ).not.toBeInTheDocument();
  });

  it("refreshes the router once the apply completes", () => {
    mocks.refresh.mockClear();
    render(
      <AvailabilityWindows
        initialApplyState={{ status: "applied", message: "Availability changed.", preview: null }}
        source={source}
      />,
    );
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it("shows the conflict reload control and clears the confirmation", () => {
    mocks.refresh.mockClear();
    render(
      <AvailabilityWindows
        initialApplyState={{
          status: "conflict",
          message: "This plan changed elsewhere. Reload and create a fresh preview.",
          preview: null,
        }}
        initialPreviewState={previewState}
        source={source}
      />,
    );
    expect(screen.getByText(/The Plan or window changed/iu)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Reload current Plan" }));
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole("button", { name: "Confirm availability change" }),
    ).not.toBeInTheDocument();
  });
});
