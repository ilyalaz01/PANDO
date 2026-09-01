import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const routerRefresh = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: routerRefresh }) }));
vi.mock("../../app/plan/actions", () => ({
  applyLearningTrackActivityAdmissionAction: vi.fn(),
  previewLearningTrackActivityAdmissionAction: vi.fn(),
}));

import admissionPreviewFixture from "../../../tests/contract/fixtures/planning/v1/learning-track-activity-admission-control.valid.json";
import type { PlanActionState } from "./plan-action-state";
import type {
  LearningTrackActivityAdmissionPreviewV1,
  LearningTrackActivityAdmissionSourceV1,
} from "./plan-types";
import { ActivityAdmission } from "./activity-admission";

const admissionPreview =
  admissionPreviewFixture as unknown as LearningTrackActivityAdmissionPreviewV1;

const source: LearningTrackActivityAdmissionSourceV1 = {
  contract: { name: "LearningTrackActivityAdmissionSourceV1", version: "1.0.0" },
  state: "READY",
  capabilities: ["admit_activity_to_learning_track"],
  growthPlan: admissionPreview.growthPlan,
  learningTrack: {
    trackKey: admissionPreview.learningTrack.trackKey,
    title: admissionPreview.learningTrack.title,
    lifecycle: admissionPreview.learningTrack.lifecycle,
    priority: admissionPreview.learningTrack.priority,
    protectedMinimumMinutes: admissionPreview.learningTrack.protectedMinimumMinutes,
    defaultSessionMinutes: admissionPreview.learningTrack.defaultSessionMinutes,
    aggregateVersion: admissionPreview.learningTrack.aggregateVersionBefore,
  },
  activities: [
    {
      activityKey: admissionPreview.activity.activityKey,
      title: admissionPreview.activity.title,
      activityType: admissionPreview.activity.activityType,
      targetCompetencyRef: admissionPreview.activity.targetCompetencyRef,
    },
  ],
};

const previewed: PlanActionState = {
  status: "previewed",
  message: "Activity preview ready.",
  preview: admissionPreview,
};

describe("ActivityAdmission", () => {
  beforeEach(() => routerRefresh.mockClear());

  it("offers one bounded activity selector with the current Track defaults", () => {
    render(<ActivityAdmission source={source} />);
    expect(screen.getByRole("heading", { name: "Add useful work" })).toBeVisible();
    expect(screen.getByLabelText("Personal activity")).toHaveValue(
      admissionPreview.activity.activityKey,
    );
    expect(screen.getByLabelText("Estimated minutes")).toHaveValue(
      source.learningTrack!.defaultSessionMinutes,
    );
    expect(screen.getByLabelText("Energy (optional)")).toHaveValue("");
    expect(screen.queryByLabelText("Learning Track")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preview activity" })).toBeEnabled();
  });

  it("shows the exact effect and removes confirmation when an input changes", () => {
    render(<ActivityAdmission initialPreviewState={previewed} source={source} />);
    expect(screen.getByText("SQL practice")).toBeVisible();
    expect(screen.getByText("2 → 3 / 200")).toBeVisible();
    expect(screen.getByText("4 (unchanged)")).toBeVisible();
    expect(screen.getByRole("button", { name: "Confirm and add activity" })).toBeEnabled();
    expect(screen.getByText(/activities, evidence, snapshots/iu)).toBeVisible();

    fireEvent.change(screen.getByLabelText("Estimated minutes"), { target: { value: "60" } });
    expect(
      screen.queryByRole("button", { name: "Confirm and add activity" }),
    ).not.toBeInTheDocument();
  });

  it("guides an empty eligible portfolio to Explore without exposing a form", () => {
    render(
      <ActivityAdmission
        source={{
          ...source,
          state: "NO_ELIGIBLE_ACTIVITIES",
          capabilities: [],
          activities: [],
        }}
      />,
    );
    expect(screen.getByText(/No accepted personal activity/iu)).toBeVisible();
    expect(screen.getByRole("link", { name: "Open Explore" })).toHaveAttribute("href", "/explore");
    expect(screen.queryByRole("button", { name: "Preview activity" })).not.toBeInTheDocument();
  });

  it("offers a safe reload for a stale exact preview", () => {
    render(
      <ActivityAdmission
        initialApplyState={{
          status: "conflict",
          message: "This plan changed elsewhere. Reload and create a fresh preview.",
          preview: null,
        }}
        initialPreviewState={previewed}
        source={source}
      />,
    );
    expect(screen.getByRole("button", { name: "Confirm and add activity" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Reload current Plan" }));
    expect(routerRefresh).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole("button", { name: "Confirm and add activity" }),
    ).not.toBeInTheDocument();
  });

  it("refreshes the server view after a successful admission", () => {
    render(
      <ActivityAdmission
        initialApplyState={{ status: "applied", message: "Added.", preview: null }}
        initialPreviewState={previewed}
        source={source}
      />,
    );
    expect(routerRefresh).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole("button", { name: "Confirm and add activity" }),
    ).not.toBeInTheDocument();
  });
});
