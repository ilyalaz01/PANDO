import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const routerRefresh = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: routerRefresh }) }));
vi.mock("../../app/plan/actions", () => ({
  applyGrowthPlanCapacityAction: vi.fn(),
  applyGrowthPlanLifecycleAction: vi.fn(),
  applyLearningTrackCreationAction: vi.fn(),
  applyLearningTrackLifecycleAction: vi.fn(),
  applyLearningTrackTerminalLifecycleAction: vi.fn(),
  applyLearningTrackPriorityMinimumAction: vi.fn(),
  applyGrowthPlanInitializationAction: vi.fn(),
  applyLearningTrackActivityAdmissionAction: vi.fn(),
  previewGrowthPlanCapacityAction: vi.fn(),
  previewGrowthPlanLifecycleAction: vi.fn(),
  previewLearningTrackCreationAction: vi.fn(),
  previewLearningTrackLifecycleAction: vi.fn(),
  previewLearningTrackTerminalLifecycleAction: vi.fn(),
  previewLearningTrackPriorityMinimumAction: vi.fn(),
  previewGrowthPlanInitializationAction: vi.fn(),
  previewLearningTrackActivityAdmissionAction: vi.fn(),
}));

import type { PlanActionState } from "./plan-action-state";
import type {
  CurrentGrowthPlanV1,
  CurrentLearningTracksV1,
  GrowthPlanCapacityPreviewV1,
  LearningTrackActivityAdmissionPreviewV1,
  LearningTrackActivityAdmissionSourceV1,
  LearningTrackCreationSourceV1,
  LearningTrackLifecyclePreviewV1,
  LearningTrackPriorityMinimumPreviewV1,
  LearningTrackTerminalLifecycleSourceV1,
} from "./plan-types";
import {
  previewGrowthPlanLifecycleAction,
  previewLearningTrackCreationAction,
} from "../../app/plan/actions";
import admissionPreviewFixture from "../../../tests/contract/fixtures/planning/v1/learning-track-activity-admission-control.valid.json";
import creationPreviewFixture from "../../../tests/contract/fixtures/planning/v1/learning-track-creation-control.valid.json";
import terminalPreviewFixture from "../../../tests/contract/fixtures/planning/v1/learning-track-terminal-lifecycle-control.valid.json";
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

const trackSettingsPreview: LearningTrackPriorityMinimumPreviewV1 = {
  contract: { name: "LearningTrackPriorityMinimumPreviewV1", version: "1.0.0" },
  operation: "set_track_priority_minimum",
  reason: "Increase systems practice.",
  expectedGrowthPlanVersion: "4",
  expectedLearningTrackVersion: "2",
  growthPlan: tracksWorkspace.growthPlan!,
  before: tracksWorkspace.learningTracks[0]!,
  after: {
    ...tracksWorkspace.learningTracks[0]!,
    priority: 12,
    protectedMinimumMinutes: 180,
    aggregateVersion: "3",
  },
  constraint: {
    activeTrackCountBefore: 1,
    activeTrackCountAfter: 1,
    activeProtectedMinimumMinutesBefore: 100,
    activeProtectedMinimumMinutesAfter: 180,
    flexibleMinutesBefore: 500,
    flexibleMinutesAfter: 420,
    activeTrackFingerprintBefore: "e".repeat(64),
    activeTrackFingerprintAfter: "f".repeat(64),
    activeTrackCountIfTargetActiveAfter: 1,
    minimumCapacityIfTargetActiveAfter: 180,
    targetActiveStateFitsCapacity: true,
    currentTrackPositionBefore: 1,
    currentTrackPositionAfter: 1,
    currentTrackOrderFingerprintBefore: "g".repeat(64),
    currentTrackOrderFingerprintAfter: "h".repeat(64),
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
  previewDigest: "i".repeat(64),
};

const admissionPreview =
  admissionPreviewFixture as unknown as LearningTrackActivityAdmissionPreviewV1;
const admissionTracksWorkspace: CurrentLearningTracksV1 = {
  ...tracksWorkspace,
  learningTracks: [tracksWorkspace.learningTracks[0]!],
};
const activityAdmissionSource: LearningTrackActivityAdmissionSourceV1 = {
  contract: { name: "LearningTrackActivityAdmissionSourceV1", version: "1.0.0" },
  state: "READY",
  capabilities: ["admit_activity_to_learning_track"],
  growthPlan: {
    title: workspace.currentPlan!.title,
    lifecycle: workspace.currentPlan!.lifecycle,
    weeklyCapacityMinutes: workspace.currentPlan!.weeklyCapacityMinutes,
    aggregateVersion: workspace.currentPlan!.aggregateVersion,
  },
  learningTrack: {
    trackKey: admissionTracksWorkspace.learningTracks[0]!.trackKey,
    title: admissionTracksWorkspace.learningTracks[0]!.title,
    lifecycle: admissionTracksWorkspace.learningTracks[0]!.lifecycle,
    priority: admissionTracksWorkspace.learningTracks[0]!.priority,
    protectedMinimumMinutes: admissionTracksWorkspace.learningTracks[0]!.protectedMinimumMinutes,
    defaultSessionMinutes: 30,
    aggregateVersion: admissionTracksWorkspace.learningTracks[0]!.aggregateVersion,
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

const learningTrackCreationSource: LearningTrackCreationSourceV1 = {
  contract: { name: "LearningTrackCreationSourceV1", version: "1.0.0" },
  state: "READY",
  capabilities: ["create_learning_track"],
  growthPlan: {
    title: workspace.currentPlan!.title,
    lifecycle: workspace.currentPlan!.lifecycle,
    weeklyCapacityMinutes: workspace.currentPlan!.weeklyCapacityMinutes,
    aggregateVersion: workspace.currentPlan!.aggregateVersion,
  },
  trackPortfolio: { currentTrackCount: 2, currentTrackLimit: 30 },
  goals: [
    {
      readinessGoalKey: "goal:backend-interview-readiness",
      title: "Backend interview readiness",
      profileLabel: "Backend interview profile",
      profileVersionKey: "target:backend-interview-v1",
      roadmapPresent: true,
      aggregateVersion: "1",
    },
    {
      readinessGoalKey: "goal:algorithms-sprint",
      title: "Algorithms sprint",
      profileLabel: "Backend interview profile",
      profileVersionKey: "target:backend-interview-v1",
      roadmapPresent: false,
      aggregateVersion: "2",
    },
  ],
};

const learningTrackCreationPreviewed: PlanActionState = {
  status: "previewed",
  message: "Track creation preview ready.",
  preview: creationPreviewFixture as PlanActionState["preview"],
};

const terminalLifecycleSource: LearningTrackTerminalLifecycleSourceV1 = {
  contract: { name: "LearningTrackTerminalLifecycleSourceV1", version: "1.0.0" },
  state: "READY",
  growthPlan: tracksWorkspace.growthPlan,
  currentTracks: tracksWorkspace.learningTracks.map((track) => ({
    learningTrackId: track.learningTrackId,
    trackKey: track.trackKey,
    title: track.title,
    lifecycle: track.lifecycle,
    priority: track.priority,
    protectedMinimumMinutes: track.protectedMinimumMinutes,
    aggregateVersion: track.aggregateVersion,
    capabilities: ["complete_track", "archive_track"] as const,
  })),
  terminalHistory: [],
  historyPage: { hasMore: false, nextCursor: null },
};

const terminalLifecyclePreviewed: PlanActionState = {
  status: "previewed",
  message: "Terminal Track preview ready.",
  preview: terminalPreviewFixture as unknown as PlanActionState["preview"],
};

const setupWorkspace: CurrentGrowthPlanV1 = {
  contract: { name: "CurrentGrowthPlanV1", version: "1.0.0" },
  currentPlan: null,
  recalculation: { projectionState: "NOT_STARTED", reason: "INITIALIZING", lastKnownSafe: false },
  capabilities: [],
};

const setupTracksWorkspace: CurrentLearningTracksV1 = {
  contract: { name: "CurrentLearningTracksV1", version: "1.0.0" },
  growthPlan: null,
  learningTracks: [],
};

const setupSource = {
  contract: { name: "GrowthPlanSetupSourceV1", version: "1.0.0" },
  state: "SETUP_AVAILABLE",
  capabilities: ["initialize_growth_plan"],
  goals: [
    {
      readinessGoalKey: "goal:backend-interview-readiness",
      title: "Backend interview readiness",
      profileLabel: "Backend interview profile",
      profileVersionKey: "target:backend-interview-v1",
      roadmapPresent: true,
      aggregateVersion: "1",
    },
    {
      readinessGoalKey: "goal:frontend-interview-readiness",
      title: "Frontend interview readiness",
      profileLabel: "Frontend interview profile",
      profileVersionKey: "target:frontend-interview-v1",
      roadmapPresent: false,
      aggregateVersion: "2",
    },
  ],
} as const;

const initializationPreviewed = {
  status: "previewed",
  message: "First Plan preview ready.",
  preview: {
    contract: { name: "GrowthPlanInitializationPreviewV1", version: "1.0.0" },
    idempotencyKey: "50000000-0000-4000-8000-000000000001",
    reason: "Set up a first plan.",
    expectedReadinessGoalVersion: "1",
    source: { readinessGoalKey: "goal:backend-interview-readiness" },
    before: { lifetimePlanCount: 0, currentPlanCount: 0, snapshotSentinelCount: 0 },
    after: {
      growthPlan: { title: "Backend interview readiness", weeklyCapacityMinutes: 600 },
      learningTrack: {
        title: "Backend interview readiness",
        priority: 50,
        protectedMinimumMinutes: 0,
        defaultSessionMinutes: 30,
      },
    },
    canApply: true,
    blockingReasons: [],
    previewDigest: "b".repeat(64),
  },
} as unknown as PlanActionState;

describe("PlanWorkspace", () => {
  it("offers a bounded first-Plan setup and exact confirmation without a modal", () => {
    const { container } = render(
      <PlanWorkspace
        initialInitializationPreviewState={initializationPreviewed}
        setupSource={setupSource}
        tracksWorkspace={setupTracksWorkspace}
        workspace={setupWorkspace}
      />,
    );
    expect(screen.getByRole("heading", { name: "Set up your first Growth Plan." })).toBeVisible();
    expect(screen.getByLabelText("Target")).toHaveValue("goal:backend-interview-readiness");
    expect(screen.getByLabelText("Weekly capacity (minutes)")).toHaveValue(600);
    expect(screen.getByLabelText("Default session (minutes)")).toHaveValue(30);
    expect(screen.getByLabelText("First Track priority")).toHaveValue(50);
    expect(screen.getByLabelText("Exact first Growth Plan preview")).toHaveTextContent(
      "Protected minimum",
    );
    expect(screen.getByRole("button", { name: "Confirm and create Growth Plan" })).toBeEnabled();
    expect(
      screen
        .getByRole("button", { name: "Confirm and create Growth Plan" })
        .closest("form")
        ?.querySelector<HTMLInputElement>('input[name="requestId"]')?.value,
    ).toBe("50000000-0000-4000-8000-000000000001");
    const requestId = container.querySelector<HTMLInputElement>('input[name="requestId"]');
    expect(requestId).not.toBeNull();
    const initialRequestId = requestId?.value;
    fireEvent.change(screen.getByLabelText("Target"), {
      target: { value: "goal:frontend-interview-readiness" },
    });
    expect(screen.queryByRole("button", { name: "Confirm and create Growth Plan" })).toBeNull();
    expect(container.querySelector<HTMLInputElement>('input[name="requestId"]')?.value).not.toBe(
      initialRequestId,
    );
  });

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
    fireEvent.change(screen.getAllByLabelText("Learning Track")[0]!, {
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

  it("shows current priority and exact settings/order/capacity consequences", () => {
    render(
      <PlanWorkspace
        initialTrackPriorityMinimumPreviewState={{
          status: "previewed",
          message: "Preview ready.",
          preview: trackSettingsPreview,
        }}
        tracksWorkspace={tracksWorkspace}
        workspace={workspace}
      />,
    );
    expect(screen.getByText("Priority 9")).toBeVisible();
    const comparison = screen.getByLabelText("Exact Learning Track settings preview");
    expect(comparison).toHaveTextContent("Priority");
    expect(comparison).toHaveTextContent("180 minutes");
    expect(comparison).toHaveTextContent("420 minutes");
    expect(screen.getByRole("button", { name: "Confirm Track settings" })).toBeEnabled();
  });

  it("blocks active Track settings over capacity without an apply control", () => {
    render(
      <PlanWorkspace
        initialTrackPriorityMinimumPreviewState={{
          status: "previewed",
          message: "Blocked.",
          preview: {
            ...trackSettingsPreview,
            growthPlan: { ...trackSettingsPreview.growthPlan, weeklyCapacityMinutes: 150 },
            constraint: {
              ...trackSettingsPreview.constraint,
              activeProtectedMinimumMinutesAfter: 180,
              flexibleMinutesAfter: -30,
              minimumCapacityIfTargetActiveAfter: 180,
              targetActiveStateFitsCapacity: false,
            },
            canApply: false,
            blockingReasons: [
              { code: "ACTIVE_TRACK_MINIMUM_EXCEEDS_CAPACITY", minimumCapacityMinutes: 180 },
            ],
          },
        }}
        tracksWorkspace={tracksWorkspace}
        workspace={workspace}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("need at least 180 weekly minutes");
    expect(
      screen.queryByRole("button", { name: "Confirm Track settings" }),
    ).not.toBeInTheDocument();
  });

  it("dismisses an old Track settings confirmation when a proposed value changes", () => {
    render(
      <PlanWorkspace
        initialTrackPriorityMinimumPreviewState={{
          status: "previewed",
          message: "Preview ready.",
          preview: trackSettingsPreview,
        }}
        tracksWorkspace={tracksWorkspace}
        workspace={workspace}
      />,
    );
    expect(screen.getByRole("button", { name: "Confirm Track settings" })).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Priority (0–100)"), { target: { value: "13" } });
    expect(
      screen.queryByRole("button", { name: "Confirm Track settings" }),
    ).not.toBeInTheDocument();
  });

  it("offers an explicit stale Track settings reload and removes its confirmation", () => {
    routerRefresh.mockClear();
    render(
      <PlanWorkspace
        initialTrackPriorityMinimumApplyState={{
          status: "conflict",
          message: "This plan changed elsewhere. Reload and create a fresh preview.",
          preview: null,
        }}
        initialTrackPriorityMinimumPreviewState={{
          status: "previewed",
          message: "Preview ready.",
          preview: trackSettingsPreview,
        }}
        tracksWorkspace={tracksWorkspace}
        workspace={workspace}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Reload current Plan and Tracks" }));
    expect(routerRefresh).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole("button", { name: "Confirm Track settings" }),
    ).not.toBeInTheDocument();
  });

  it("changing an activity intent dismisses an older Plan confirmation", () => {
    render(
      <PlanWorkspace
        activityAdmissionSource={activityAdmissionSource}
        initialPreviewState={previewed}
        tracksWorkspace={admissionTracksWorkspace}
        workspace={workspace}
      />,
    );
    expect(screen.getByRole("button", { name: "Confirm and apply" })).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Why does this belong in the Plan?"), {
      target: { value: "Add deliberate practice." },
    });
    expect(screen.queryByRole("button", { name: "Confirm and apply" })).not.toBeInTheDocument();
  });

  it("changing the activity destination dismisses a Track creation confirmation", () => {
    render(
      <PlanWorkspace
        initialLearningTrackCreationPreviewState={learningTrackCreationPreviewed}
        learningTrackCreationSource={learningTrackCreationSource}
        tracksWorkspace={tracksWorkspace}
        workspace={workspace}
      />,
    );
    expect(screen.getByRole("button", { name: "Confirm and create Learning Track" })).toBeEnabled();
    const destinationRegion = screen
      .getByRole("heading", { name: "Choose destination Track" })
      .closest("section");
    expect(destinationRegion).not.toBeNull();
    fireEvent.change(within(destinationRegion!).getByLabelText("Learning Track"), {
      target: { value: "track:algorithms" },
    });
    expect(
      screen.queryByRole("button", { name: "Confirm and create Learning Track" }),
    ).not.toBeInTheDocument();
  });

  it("starting another Plan intent dismisses an activity confirmation", async () => {
    render(
      <PlanWorkspace
        activityAdmissionSource={activityAdmissionSource}
        initialActivityAdmissionPreviewState={{
          status: "previewed",
          message: "Activity preview ready.",
          preview: admissionPreview,
        }}
        tracksWorkspace={admissionTracksWorkspace}
        workspace={workspace}
      />,
    );
    expect(screen.getByRole("button", { name: "Confirm and add activity" })).toBeEnabled();

    fireEvent.change(screen.getByLabelText("Why is this changing?"), {
      target: { value: "Pause while priorities change." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview change" }));
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Confirm and add activity" }),
      ).not.toBeInTheDocument();
    });
  });

  it("shows exact Learning Track creation facts and a separate confirmation", () => {
    render(
      <PlanWorkspace
        initialLearningTrackCreationPreviewState={learningTrackCreationPreviewed}
        learningTrackCreationSource={learningTrackCreationSource}
        tracksWorkspace={tracksWorkspace}
        workspace={workspace}
      />,
    );
    const comparison = screen.getByLabelText("Exact Learning Track creation preview");
    expect(comparison).toHaveTextContent("Track order");
    expect(comparison).toHaveTextContent("Algorithms sprint");
    expect(comparison).toHaveTextContent("45 minutes");
    expect(screen.getByRole("button", { name: "Confirm and create Learning Track" })).toBeEnabled();
  });

  it("starting Track creation dismisses an older Plan confirmation", async () => {
    vi.mocked(previewLearningTrackCreationAction).mockImplementation(
      () => new Promise<PlanActionState>(() => undefined),
    );
    render(
      <PlanWorkspace
        initialPreviewState={previewed}
        learningTrackCreationSource={learningTrackCreationSource}
        tracksWorkspace={tracksWorkspace}
        workspace={workspace}
      />,
    );
    expect(screen.getByRole("button", { name: "Confirm and apply" })).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Track title"), {
      target: { value: "Algorithms sprint" },
    });
    fireEvent.change(screen.getByLabelText("Why does this Track belong now?"), {
      target: { value: "Split algorithms practice into its own lane." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview Learning Track" }));
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Confirm and apply" })).not.toBeInTheDocument();
    });
  });

  it("starting another Plan intent dismisses a Track creation confirmation", async () => {
    render(
      <PlanWorkspace
        initialLearningTrackCreationPreviewState={learningTrackCreationPreviewed}
        learningTrackCreationSource={learningTrackCreationSource}
        tracksWorkspace={tracksWorkspace}
        workspace={workspace}
      />,
    );
    expect(screen.getByRole("button", { name: "Confirm and create Learning Track" })).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Why is this changing?"), {
      target: { value: "Pause while priorities change." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview change" }));
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Confirm and create Learning Track" }),
      ).not.toBeInTheDocument();
    });
  });

  it("changing a terminal Track intent dismisses an older Plan confirmation", () => {
    render(
      <PlanWorkspace
        initialPreviewState={previewed}
        terminalLifecycleSource={terminalLifecycleSource}
        tracksWorkspace={tracksWorkspace}
        workspace={workspace}
      />,
    );
    expect(screen.getByRole("button", { name: "Confirm and apply" })).toBeEnabled();

    fireEvent.change(screen.getByLabelText("Why should this Track change now?"), {
      target: { value: "This Track is no longer part of the current plan." },
    });

    expect(screen.queryByRole("button", { name: "Confirm and apply" })).not.toBeInTheDocument();
  });

  it("changing another Plan intent dismisses a terminal Track confirmation", () => {
    render(
      <PlanWorkspace
        initialTerminalLifecyclePreviewState={terminalLifecyclePreviewed}
        terminalLifecycleSource={terminalLifecycleSource}
        tracksWorkspace={tracksWorkspace}
        workspace={workspace}
      />,
    );
    expect(screen.getByRole("button", { name: "Complete this Track" })).toBeEnabled();

    fireEvent.change(screen.getByLabelText("Why is this changing?"), {
      target: { value: "Pause the Plan while priorities change." },
    });

    expect(screen.queryByRole("button", { name: "Complete this Track" })).not.toBeInTheDocument();
  });
});
