import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const routerRefresh = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: routerRefresh }) }));
vi.mock("../../app/plan/actions", () => ({
  applyLearningTrackCreationAction: vi.fn(),
  previewLearningTrackCreationAction: vi.fn(),
}));

import type { PlanActionState } from "./plan-action-state";
import type { LearningTrackCreationPreviewV1, LearningTrackCreationSourceV1 } from "./plan-types";
import {
  applyLearningTrackCreationAction,
  previewLearningTrackCreationAction,
} from "../../app/plan/actions";
import creationBlocked from "../../../tests/contract/fixtures/planning/v1/learning-track-creation-control.blocked.json";
import creationPreview from "../../../tests/contract/fixtures/planning/v1/learning-track-creation-control.valid.json";
import { LearningTrackCreation } from "./learning-track-creation";

const preview = creationPreview as LearningTrackCreationPreviewV1;
const blockedPreview = creationBlocked as LearningTrackCreationPreviewV1;
const source: LearningTrackCreationSourceV1 = {
  contract: { name: "LearningTrackCreationSourceV1", version: "1.0.0" },
  state: "READY",
  capabilities: ["create_learning_track"],
  growthPlan: preview.growthPlan,
  trackPortfolio: {
    currentTrackCount: preview.constraint.currentTrackCountBefore,
    currentTrackLimit: preview.constraint.currentTrackLimit,
  },
  goals: [
    {
      readinessGoalKey: preview.source.readinessGoalKey,
      title: preview.source.readinessGoalTitle,
      profileLabel: "Backend interview profile",
      profileVersionKey: preview.source.profileVersionKey,
      roadmapPresent: preview.source.roadmapVersionId !== null,
      aggregateVersion: preview.source.readinessGoalVersion,
    },
  ],
};

describe("LearningTrackCreation", () => {
  it("renders bounded inputs and an exact confirmation preview", () => {
    render(
      <LearningTrackCreation
        initialPreviewState={{
          status: "previewed",
          message: "Track creation preview ready.",
          preview,
        }}
        source={source}
      />,
    );
    expect(screen.getByRole("heading", { name: "Create another Learning Track" })).toBeVisible();
    expect(screen.getByLabelText("Target")).toHaveValue(preview.source.readinessGoalKey);
    expect(screen.getByLabelText("Track title")).toHaveValue(preview.learningTrack.title);
    expect(screen.getByLabelText("Priority (0–100)")).toHaveValue(preview.learningTrack.priority);
    expect(screen.getByLabelText("Default session (minutes)")).toHaveValue(
      preview.learningTrack.defaultSessionMinutes,
    );
    expect(screen.getByLabelText("Exact Learning Track creation preview")).toHaveTextContent(
      "Track order",
    );
    expect(screen.getByRole("button", { name: "Confirm and create Learning Track" })).toBeEnabled();
  });

  it("dismisses an old confirmation when the title changes", () => {
    render(
      <LearningTrackCreation
        initialPreviewState={{
          status: "previewed",
          message: "Track creation preview ready.",
          preview,
        }}
        source={source}
      />,
    );
    expect(screen.getByRole("button", { name: "Confirm and create Learning Track" })).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Track title"), {
      target: { value: "Algorithms lane" },
    });
    expect(
      screen.queryByRole("button", { name: "Confirm and create Learning Track" }),
    ).not.toBeInTheDocument();
  });

  it("dismisses the preview when a sibling intent advances its dismissal version", async () => {
    vi.mocked(previewLearningTrackCreationAction).mockImplementation(
      () => new Promise<PlanActionState>(() => undefined),
    );
    const { rerender } = render(<LearningTrackCreation source={source} />);
    fireEvent.change(screen.getByLabelText("Track title"), {
      target: { value: "Algorithms lane" },
    });
    fireEvent.change(screen.getByLabelText("Why does this Track belong now?"), {
      target: { value: "Split algorithms practice into its own lane." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview Learning Track" }));
    rerender(
      <LearningTrackCreation
        dismissalVersion={1}
        initialPreviewState={{
          status: "previewed",
          message: "Track creation preview ready.",
          preview,
        }}
        source={source}
      />,
    );
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Confirm and create Learning Track" }),
      ).not.toBeInTheDocument();
    });
  });

  it("shows blocked and unavailable source states without a misleading apply control", () => {
    const { rerender } = render(
      <LearningTrackCreation
        initialPreviewState={{
          status: "previewed",
          message: "Blocked preview.",
          preview: blockedPreview,
        }}
        source={source}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("already at 30 current Tracks");
    expect(
      screen.queryByRole("button", { name: "Confirm and create Learning Track" }),
    ).not.toBeInTheDocument();

    rerender(
      <LearningTrackCreation
        source={{
          ...source,
          state: "GOAL_PORTFOLIO_OVERFLOW",
          capabilities: [],
          goals: [],
        }}
      />,
    );
    expect(screen.getByText(/More than 20 active Goals/iu)).toBeVisible();
    expect(screen.getByRole("link", { name: "Open Targets" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Preview Learning Track" })).toBeNull();
  });

  it("offers an explicit stale reload and clears the old confirmation", () => {
    routerRefresh.mockClear();
    render(
      <LearningTrackCreation
        initialApplyState={{
          status: "conflict",
          message: "This plan changed elsewhere. Reload and create a fresh preview.",
          preview: null,
        }}
        initialPreviewState={{
          status: "previewed",
          message: "Track creation preview ready.",
          preview,
        }}
        source={source}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Reload current Plan" }));
    expect(routerRefresh).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole("button", { name: "Confirm and create Learning Track" }),
    ).not.toBeInTheDocument();
    expect(vi.mocked(applyLearningTrackCreationAction)).not.toHaveBeenCalled();
  });
});
