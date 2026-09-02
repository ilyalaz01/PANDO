import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const routerRefresh = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: routerRefresh }) }));
vi.mock("../../app/plan/actions", () => ({
  applyLearningTrackActivityAdmissionAction: vi.fn(),
  previewLearningTrackActivityAdmissionAction: vi.fn(),
}));

import admissionPreviewFixture from "../../../tests/contract/fixtures/planning/v1/learning-track-activity-admission-control.valid.json";
import admissionPreviewFixtureV2 from "../../../tests/contract/fixtures/planning/v1/learning-track-activity-admission-v2.valid.json";
import type { PlanActionState } from "./plan-action-state";
import type {
  CurrentLearningTrackV1,
  LearningTrackActivityAdmissionPreviewV1,
  LearningTrackActivityAdmissionPreviewV2,
  LearningTrackActivityAdmissionSourceV1,
  LearningTrackActivityAdmissionSourceV2,
} from "./plan-types";
import { ActivityAdmission } from "./activity-admission";

const admissionPreview =
  admissionPreviewFixture as unknown as LearningTrackActivityAdmissionPreviewV1;
const admissionPreviewV2 =
  admissionPreviewFixtureV2 as unknown as LearningTrackActivityAdmissionPreviewV2;

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

const multiTrackSource: LearningTrackActivityAdmissionSourceV2 = {
  contract: { name: "LearningTrackActivityAdmissionSourceV2", version: "2.0.0" },
  state: "READY",
  capabilities: ["admit_activity_to_learning_track"],
  growthPlan: admissionPreviewV2.growthPlan,
  selectedTrack: {
    trackKey: admissionPreviewV2.learningTrack.trackKey,
    title: admissionPreviewV2.learningTrack.title,
    lifecycle: admissionPreviewV2.learningTrack.lifecycle,
    priority: admissionPreviewV2.learningTrack.priority,
    protectedMinimumMinutes: admissionPreviewV2.learningTrack.protectedMinimumMinutes,
    defaultSessionMinutes: admissionPreviewV2.learningTrack.defaultSessionMinutes,
    aggregateVersion: admissionPreviewV2.learningTrack.aggregateVersionBefore,
  },
  activities: [
    {
      activityKey: admissionPreviewV2.activity.activityKey,
      title: admissionPreviewV2.activity.title,
      activityType: admissionPreviewV2.activity.activityType,
      targetCompetencyRef: admissionPreviewV2.activity.targetCompetencyRef,
    },
  ],
};
const multiTracks: readonly CurrentLearningTrackV1[] = [
  {
    learningTrackId: "31000000-0000-4000-8000-000000000001",
    trackKey: "track:system-design",
    title: "System design",
    lifecycle: "ACTIVE",
    priority: 9,
    protectedMinimumMinutes: 100,
    aggregateVersion: "2",
    capabilities: ["pause_track"],
  },
  {
    learningTrackId: "31000000-0000-4000-8000-000000000002",
    trackKey: admissionPreviewV2.learningTrack.trackKey,
    title: admissionPreviewV2.learningTrack.title,
    lifecycle: admissionPreviewV2.learningTrack.lifecycle,
    priority: admissionPreviewV2.learningTrack.priority,
    protectedMinimumMinutes: admissionPreviewV2.learningTrack.protectedMinimumMinutes,
    aggregateVersion: admissionPreviewV2.learningTrack.aggregateVersionBefore,
    capabilities: ["resume_track"],
  },
];

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

  it("requires an explicit destination Track load when several current Tracks exist", () => {
    render(<ActivityAdmission tracks={multiTracks} />);
    expect(screen.getByRole("heading", { name: "Choose destination Track" })).toBeVisible();
    expect(screen.getByLabelText("Learning Track")).toHaveValue("track:system-design");
    expect(screen.getByRole("button", { name: "Load activity choices" })).toBeEnabled();
    expect(
      screen.getByText(/Choose a current Track above to load its bounded activity choices/iu),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: "Preview activity" })).not.toBeInTheDocument();
  });

  it("renders the selected destination Track source without preloading every portfolio combination", () => {
    render(
      <ActivityAdmission
        selectedTrackKey={admissionPreviewV2.learningTrack.trackKey}
        source={multiTrackSource}
        tracks={multiTracks}
      />,
    );
    expect(screen.getByLabelText("Learning Track")).toHaveValue(
      admissionPreviewV2.learningTrack.trackKey,
    );
    expect(screen.getByText(/Add one accepted personal activity to Algorithms\./iu)).toBeVisible();
    expect(screen.getByRole("button", { name: "Preview activity" })).toBeEnabled();
  });

  it("falls back to the first current Track when a selected URL key is stale", () => {
    render(<ActivityAdmission selectedTrackKey="track:retired" tracks={multiTracks} />);
    expect(screen.getByLabelText("Learning Track")).toHaveValue("track:system-design");
    expect(screen.getByRole("button", { name: "Load activity choices" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Preview activity" })).not.toBeInTheDocument();
  });
});
