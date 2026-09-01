import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const routerRefresh = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: routerRefresh }) }));
vi.mock("../../app/plan/actions", () => ({
  applyGrowthPlanCapacityAction: vi.fn(),
  applyGrowthPlanLifecycleAction: vi.fn(),
  applyLearningTrackLifecycleAction: vi.fn(),
  previewGrowthPlanCapacityAction: vi.fn(),
  previewGrowthPlanLifecycleAction: vi.fn(),
  previewLearningTrackLifecycleAction: vi.fn(),
}));

import type { PlanActionState } from "./plan-action-state";
import type {
  CurrentGrowthPlanV1,
  CurrentLearningTracksV1,
  GrowthPlanCapacityPreviewV1,
  LearningTrackLifecyclePreviewV1,
} from "./plan-types";
import { previewGrowthPlanLifecycleAction } from "../../app/plan/actions";
import { PlanWorkspace } from "./plan-workspace";

const workspace: CurrentGrowthPlanV1 = {
  contract: { name: "CurrentGrowthPlanV1", version: "1.0.0" },
  currentPlan: {
    growthPlanId: "30000000-0000-4000-8000-000000000020",
    title: "Backend interview readiness",
    lifecycle: "ACTIVE",
    weeklyCapacityMinutes: 600,
    aggregateVersion: "4",
  },
  recalculation: { projectionState: "PENDING", reason: "INPUTS_CHANGED", lastKnownSafe: true },
  capabilities: ["pause_growth_plan"],
};

const tracksWorkspace: CurrentLearningTracksV1 = {
  contract: { name: "CurrentLearningTracksV1", version: "1.0.0" },
  growthPlan: {
    growthPlanId: workspace.currentPlan!.growthPlanId,
    lifecycle: workspace.currentPlan!.lifecycle,
    weeklyCapacityMinutes: workspace.currentPlan!.weeklyCapacityMinutes,
    aggregateVersion: workspace.currentPlan!.aggregateVersion,
  },
  learningTracks: [
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
      trackKey: "track:algorithms",
      title: "Algorithms",
      lifecycle: "PAUSED",
      priority: 8,
      protectedMinimumMinutes: 80,
      aggregateVersion: "3",
      capabilities: ["resume_track"],
    },
  ],
};

const previewed: PlanActionState = {
  status: "previewed",
  message: "Preview ready.",
  preview: {
    contract: { name: "GrowthPlanLifecyclePreviewV1", version: "1.0.0" },
    operation: "pause_growth_plan",
    reason: "Interview was cancelled.",
    expectedGrowthPlanVersion: "4",
    before: workspace.currentPlan!,
    after: { ...workspace.currentPlan!, lifecycle: "PAUSED", aggregateVersion: "5" },
    retained: { learningTracks: true, planSnapshots: true, focusSessions: true, evidence: true },
    recalculationAfterApply: {
      projectionState: "PENDING",
      consumerName: "planning.plan_snapshot_v1",
    },
    previewDigest: "a".repeat(64),
  },
};

const capacityPreviewed: PlanActionState = {
  status: "previewed",
  message: "Capacity preview ready.",
  preview: {
    contract: { name: "GrowthPlanCapacityPreviewV1", version: "1.0.0" },
    operation: "set_default_capacity",
    reason: "I have more time this term.",
    expectedGrowthPlanVersion: "4",
    before: workspace.currentPlan!,
    after: { ...workspace.currentPlan!, weeklyCapacityMinutes: 720, aggregateVersion: "5" },
    constraint: {
      activeTrackCount: 2,
      activeProtectedMinimumMinutes: 180,
      flexibleMinutesBefore: 420,
      flexibleMinutesAfter: 540,
      activeTrackFingerprint: "b".repeat(64),
    },
    canApply: true,
    blockingReasons: [],
    retained: { learningTracks: true, planSnapshots: true, focusSessions: true, evidence: true },
    recalculationAfterApply: {
      projectionState: "PENDING",
      consumerName: "planning.plan_snapshot_v1",
    },
    previewDigest: "c".repeat(64),
  },
};

const trackPreview: LearningTrackLifecyclePreviewV1 = {
  contract: { name: "LearningTrackLifecyclePreviewV1", version: "1.0.0" },
  operation: "resume_track",
  reason: "Algorithms matter for the next interview cycle.",
  expectedGrowthPlanVersion: "4",
  expectedLearningTrackVersion: "3",
  growthPlan: tracksWorkspace.growthPlan!,
  before: {
    learningTrackId: tracksWorkspace.learningTracks[1]!.learningTrackId,
    trackKey: tracksWorkspace.learningTracks[1]!.trackKey,
    title: tracksWorkspace.learningTracks[1]!.title,
    lifecycle: "PAUSED",
    priority: tracksWorkspace.learningTracks[1]!.priority,
    protectedMinimumMinutes: 80,
    aggregateVersion: "3",
  },
  after: {
    learningTrackId: tracksWorkspace.learningTracks[1]!.learningTrackId,
    trackKey: tracksWorkspace.learningTracks[1]!.trackKey,
    title: tracksWorkspace.learningTracks[1]!.title,
    lifecycle: "ACTIVE",
    priority: tracksWorkspace.learningTracks[1]!.priority,
    protectedMinimumMinutes: 80,
    aggregateVersion: "4",
  },
  constraint: {
    activeTrackCountBefore: 1,
    activeTrackCountAfter: 2,
    activeProtectedMinimumMinutesBefore: 100,
    activeProtectedMinimumMinutesAfter: 180,
    flexibleMinutesBefore: 500,
    flexibleMinutesAfter: 420,
    activeTrackFingerprintBefore: "d".repeat(64),
    activeTrackFingerprintAfter: "e".repeat(64),
  },
  canApply: true,
  blockingReasons: [],
  warnings: [],
  retained: {
    learningTrackActivities: true,
    planSnapshots: true,
    focusSessions: true,
    evidence: true,
  },
  recalculationAfterApply: {
    projectionState: "PENDING",
    consumerName: "planning.plan_snapshot_v1",
  },
  previewDigest: "d".repeat(64),
};

const trackPreviewed: PlanActionState = {
  status: "previewed",
  message: "Track preview ready.",
  preview: trackPreview,
};

describe("PlanWorkspace", () => {
  it("shows the current owner state and an honest pending notice", () => {
    render(<PlanWorkspace tracksWorkspace={tracksWorkspace} workspace={workspace} />);
    expect(screen.getByText("Backend interview readiness")).toBeVisible();
    expect(screen.getByText("600 minutes")).toBeVisible();
    expect(screen.getByText(/Plan inputs changed/iu)).toBeVisible();
  });

  it("shows exact before/after facts and requires a separate confirmation", () => {
    render(
      <PlanWorkspace
        initialPreviewState={previewed}
        tracksWorkspace={tracksWorkspace}
        workspace={workspace}
      />,
    );
    const comparison = screen.getByLabelText("Exact plan change preview");
    expect(comparison).toHaveTextContent("ACTIVE");
    expect(comparison).toHaveTextContent("PAUSED");
    expect(comparison).toHaveTextContent("4");
    expect(comparison).toHaveTextContent("5");
    expect(screen.getByText("Reason: Interview was cancelled.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Confirm and apply" })).toBeEnabled();
  });

  it("removes an old confirmation while a replacement preview is pending", async () => {
    vi.mocked(previewGrowthPlanLifecycleAction).mockImplementation(
      () => new Promise<PlanActionState>(() => undefined),
    );
    render(
      <PlanWorkspace
        initialPreviewState={previewed}
        tracksWorkspace={tracksWorkspace}
        workspace={workspace}
      />,
    );
    fireEvent.change(screen.getByLabelText("Why is this changing?"), {
      target: { value: "A newer reason." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview change" }));
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Confirm and apply" })).not.toBeInTheDocument();
    });
  });

  it("offers an explicit stale-plan reload and clears the old preview", async () => {
    routerRefresh.mockClear();
    render(
      <PlanWorkspace
        initialApplyState={{
          status: "conflict",
          message: "This plan changed elsewhere. Reload and create a fresh preview.",
          preview: null,
        }}
        initialPreviewState={previewed}
        tracksWorkspace={tracksWorkspace}
        workspace={workspace}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Reload current plan" }));
    expect(routerRefresh).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Confirm and apply" })).not.toBeInTheDocument();
  });

  it("does not fabricate a Plan for an empty personal workspace", () => {
    render(
      <PlanWorkspace
        workspace={{
          ...workspace,
          currentPlan: null,
          capabilities: [],
          recalculation: {
            projectionState: "NOT_STARTED",
            reason: "INITIALIZING",
            lastKnownSafe: false,
          },
        }}
        tracksWorkspace={{
          contract: { name: "CurrentLearningTracksV1", version: "1.0.0" },
          growthPlan: null,
          learningTracks: [],
        }}
      />,
    );
    expect(screen.getByRole("heading", { name: "No Growth Plan yet." })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Preview change" })).not.toBeInTheDocument();
  });

  it("shows exact capacity consequences and a separate confirmation", () => {
    render(
      <PlanWorkspace
        initialCapacityPreviewState={capacityPreviewed}
        tracksWorkspace={tracksWorkspace}
        workspace={workspace}
      />,
    );
    const comparison = screen.getByLabelText("Exact weekly capacity preview");
    expect(comparison).toHaveTextContent("600 minutes");
    expect(comparison).toHaveTextContent("720 minutes");
    expect(comparison).toHaveTextContent("180 minutes");
    expect(comparison).toHaveTextContent("540 minutes");
    expect(screen.getByText("Reason: I have more time this term.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Confirm capacity" })).toBeEnabled();
  });

  it("explains a protected-minimum block and exposes no apply control", () => {
    const applicable = capacityPreviewed.preview as GrowthPlanCapacityPreviewV1;
    const blocked: PlanActionState = {
      ...capacityPreviewed,
      preview: {
        ...applicable,
        after: { ...applicable.after, weeklyCapacityMinutes: 120 },
        constraint: { ...applicable.constraint, flexibleMinutesAfter: -60 },
        canApply: false,
        blockingReasons: [
          { code: "ACTIVE_TRACK_MINIMUM_EXCEEDS_CAPACITY", minimumCapacityMinutes: 180 },
        ],
      },
    };
    render(
      <PlanWorkspace
        initialCapacityPreviewState={blocked}
        tracksWorkspace={tracksWorkspace}
        workspace={workspace}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Capacity can't be set to 120 minutes. Active tracks reserve 180 minutes.",
    );
    expect(screen.queryByRole("button", { name: "Confirm capacity" })).not.toBeInTheDocument();
  });

  it("shows Track state, capacity consequences, and an exact confirmation", () => {
    render(
      <PlanWorkspace
        initialTrackPreviewState={trackPreviewed}
        tracksWorkspace={tracksWorkspace}
        workspace={workspace}
      />,
    );
    expect(screen.getByText("System design")).toBeVisible();
    const comparison = screen.getByLabelText("Exact Learning Track change preview");
    expect(comparison).toHaveTextContent("Algorithms");
    expect(comparison).toHaveTextContent("PAUSED");
    expect(comparison).toHaveTextContent("ACTIVE");
    expect(comparison).toHaveTextContent("420 minutes");
    expect(screen.getByRole("button", { name: "Confirm Track change" })).toBeEnabled();
  });

  it("explains a blocked Track resume and exposes no apply control", () => {
    const blocked: PlanActionState = {
      ...trackPreviewed,
      preview: {
        ...trackPreview,
        constraint: {
          ...trackPreview.constraint,
          activeProtectedMinimumMinutesBefore: 560,
          activeProtectedMinimumMinutesAfter: 640,
          flexibleMinutesBefore: 40,
          flexibleMinutesAfter: -40,
        },
        canApply: false,
        blockingReasons: [
          { code: "ACTIVE_TRACK_MINIMUM_EXCEEDS_CAPACITY", minimumCapacityMinutes: 640 },
        ],
      },
    };
    render(
      <PlanWorkspace
        initialTrackPreviewState={blocked}
        tracksWorkspace={tracksWorkspace}
        workspace={workspace}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This Track cannot resume within 600 weekly minutes",
    );
    expect(screen.queryByRole("button", { name: "Confirm Track change" })).not.toBeInTheDocument();
  });

  it("warns honestly when a Track changes under a paused parent Plan", () => {
    render(
      <PlanWorkspace
        initialTrackPreviewState={{
          ...trackPreviewed,
          preview: {
            ...trackPreview,
            growthPlan: { ...trackPreview.growthPlan, lifecycle: "PAUSED" },
            warnings: [{ code: "PARENT_GROWTH_PLAN_PAUSED" }],
          },
        }}
        tracksWorkspace={{
          ...tracksWorkspace,
          growthPlan: { ...tracksWorkspace.growthPlan!, lifecycle: "PAUSED" },
        }}
        workspace={workspace}
      />,
    );
    expect(
      screen.getByText(/Today will not schedule it until the parent Plan is resumed/iu),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Confirm Track change" })).toBeEnabled();
  });

  it("dismisses an old Track confirmation when the selector changes", () => {
    render(
      <PlanWorkspace
        initialTrackPreviewState={trackPreviewed}
        tracksWorkspace={tracksWorkspace}
        workspace={workspace}
      />,
    );
    expect(screen.getByRole("button", { name: "Confirm Track change" })).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Learning Track"), {
      target: { value: "track:system-design" },
    });
    expect(screen.queryByRole("button", { name: "Confirm Track change" })).not.toBeInTheDocument();
  });

  it("offers an explicit stale Track reload and removes its confirmation", () => {
    routerRefresh.mockClear();
    render(
      <PlanWorkspace
        initialTrackApplyState={{
          status: "conflict",
          message: "This plan changed elsewhere. Reload and create a fresh preview.",
          preview: null,
        }}
        initialTrackPreviewState={trackPreviewed}
        tracksWorkspace={tracksWorkspace}
        workspace={workspace}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Reload current Plan and Tracks" }));
    expect(routerRefresh).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Confirm Track change" })).not.toBeInTheDocument();
  });
});
