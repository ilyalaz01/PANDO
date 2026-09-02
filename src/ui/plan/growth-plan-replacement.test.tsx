import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), preview: vi.fn(), apply: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("../../app/plan/actions", () => ({
  previewGrowthPlanReplacementAction: mocks.preview,
  applyGrowthPlanReplacementAction: mocks.apply,
}));

import previewFixture from "../../../tests/contract/fixtures/planning/v1/growth-plan-replacement-control.valid.json";
import type { GrowthPlanReplacementPreviewV1, GrowthPlanReplacementSourceV1 } from "./plan-types";
import { GrowthPlanReplacement } from "./growth-plan-replacement";
import type { PlanActionState } from "./plan-action-state";

const preview = previewFixture as unknown as GrowthPlanReplacementPreviewV1;

const source = {
  contract: { name: "GrowthPlanReplacementSourceV1", version: "1.0.0" },
  state: "REPLACEMENT_AVAILABLE",
  capabilities: ["replace_growth_plan"],
  currentPlan: {
    title: preview.before.growthPlan.title,
    lifecycle: preview.before.growthPlan.lifecycle,
    weeklyCapacityMinutes: preview.before.growthPlan.weeklyCapacityMinutes,
    aggregateVersion: preview.before.growthPlan.aggregateVersion,
    childTracks: {
      total: preview.before.childTracks.total,
      active: preview.before.childTracks.active,
      paused: preview.before.childTracks.paused,
      completed: preview.before.childTracks.completed,
      archived: preview.before.childTracks.archived,
    },
  },
  goals: [
    {
      readinessGoalKey: preview.source.readinessGoalKey,
      title: preview.source.readinessGoalTitle,
      profileLabel: "Backend Engineer",
      profileVersionKey: preview.source.profileVersionKey,
      roadmapPresent: true,
      aggregateVersion: preview.source.readinessGoalVersion,
    },
  ],
} as GrowthPlanReplacementSourceV1;

const previewState: PlanActionState = {
  status: "previewed",
  message: "Replacement preview ready.",
  preview,
};

describe("GrowthPlanReplacement", () => {
  it("renders the exact archive-plus-create comparison and every retained fact", () => {
    render(<GrowthPlanReplacement initialPreviewState={previewState} source={source} />);
    const comparison = screen.getByLabelText("Exact Growth Plan replacement preview");
    expect(within(comparison).getByText("Frontend readiness")).toBeVisible();
    expect(comparison).toHaveTextContent(
      "3 total · 1 active · 1 paused · 0 completed · 1 archived",
    );
    expect(comparison).toHaveTextContent("ARCHIVED · version 5");
    expect(comparison).toHaveTextContent("420 minutes");
    expect(comparison).toHaveTextContent("Recalculation pending");
    expect(comparison).toHaveTextContent(/Preserved: archived Plan and its Tracks/u);
    expect(screen.getByText(/The current Plan becomes archived history/u)).toBeVisible();
    expect(screen.getByText(/Its Learning Tracks stay with the archived Plan/u)).toBeVisible();
    expect(screen.getByRole("button", { name: "Confirm and replace Growth Plan" })).toBeEnabled();
  });

  it("binds both expected versions and the exact digest to the confirmation", () => {
    const { container } = render(
      <GrowthPlanReplacement initialPreviewState={previewState} source={source} />,
    );
    const hidden = [...container.querySelectorAll<HTMLInputElement>("input[type=hidden]")];
    const value = (name: string) =>
      hidden.filter((input) => input.name === name).map((input) => input.value);
    expect(value("expectedGrowthPlanVersion")).toContain(preview.expectedGrowthPlanVersion);
    expect(value("expectedReadinessGoalVersion")).toContain(preview.expectedReadinessGoalVersion);
    expect(value("previewDigest")).toEqual([preview.previewDigest]);
    expect(value("requestId")).toContain(preview.idempotencyKey);
  });

  it("dismisses a stale confirmation when the replacement intent changes", () => {
    render(<GrowthPlanReplacement initialPreviewState={previewState} source={source} />);
    fireEvent.change(screen.getByLabelText("New weekly capacity (minutes)"), {
      target: { value: "300" },
    });
    expect(
      screen.queryByRole("button", { name: "Confirm and replace Growth Plan" }),
    ).not.toBeInTheDocument();
  });

  it("dismisses a stale confirmation when a sibling Plan intent starts", () => {
    const { rerender } = render(
      <GrowthPlanReplacement
        dismissalVersion={0}
        initialPreviewState={previewState}
        source={source}
      />,
    );
    expect(screen.getByRole("button", { name: "Confirm and replace Growth Plan" })).toBeVisible();
    rerender(
      <GrowthPlanReplacement
        dismissalVersion={1}
        initialPreviewState={previewState}
        source={source}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Confirm and replace Growth Plan" }),
    ).not.toBeInTheDocument();
  });

  it("offers no control at all when replacement is unavailable", () => {
    const unavailable = {
      contract: { name: "GrowthPlanReplacementSourceV1", version: "1.0.0" },
      state: "NO_ACTIVE_GOALS",
      capabilities: [],
      currentPlan: null,
      goals: [],
    } as GrowthPlanReplacementSourceV1;
    const { container } = render(<GrowthPlanReplacement source={unavailable} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("hides the confirmation while a blocked preview explains the exact blocker", () => {
    const blocked = {
      ...preview,
      canApply: false,
      blockingReasons: [{ code: "PLANNING_CREATE_IDENTITY_COLLISION" }],
    } as GrowthPlanReplacementPreviewV1;
    render(
      <GrowthPlanReplacement
        initialPreviewState={{ status: "previewed", message: "Blocked", preview: blocked }}
        source={source}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("PLANNING_CREATE_IDENTITY_COLLISION");
    expect(
      screen.queryByRole("button", { name: "Confirm and replace Growth Plan" }),
    ).not.toBeInTheDocument();
  });
});
