import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  loadTracks: vi.fn(),
  loadSetup: vi.fn(),
  loadCreation: vi.fn(),
  loadAdmission: vi.fn(),
  loadAdmissionV2: vi.fn(),
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
  refresh: vi.fn(),
  verify: vi.fn(),
}));
const classes = vi.hoisted(() => ({
  AuthenticatedSessionRequiredError: class AuthenticatedSessionRequiredError extends Error {},
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
  useRouter: () => ({ refresh: mocks.refresh }),
}));
vi.mock("../../shared/supabase/server", () => ({
  createPandoServerComponentClient: vi.fn().mockResolvedValue({ requestScoped: true }),
}));
vi.mock("../../shared/supabase/session", () => ({
  AuthenticatedSessionRequiredError: classes.AuthenticatedSessionRequiredError,
  verifyPandoSession: mocks.verify,
}));
vi.mock("../../ui/plan/server/database-plan", () => ({
  loadCurrentGrowthPlanV1: mocks.load,
  loadCurrentLearningTracksV1: mocks.loadTracks,
  loadGrowthPlanSetupSourceV1: mocks.loadSetup,
  loadLearningTrackCreationSourceV1: mocks.loadCreation,
  loadLearningTrackActivityAdmissionSourceV1: mocks.loadAdmission,
  loadLearningTrackActivityAdmissionSourceV2: mocks.loadAdmissionV2,
}));

import PlanPage from "./page";

const workspace = {
  contract: { name: "CurrentGrowthPlanV1", version: "1.0.0" },
  currentPlan: {
    growthPlanId: "30000000-0000-4000-8000-000000000020",
    title: "Backend interview readiness",
    lifecycle: "ACTIVE",
    weeklyCapacityMinutes: 600,
    aggregateVersion: "4",
  },
  recalculation: { projectionState: "CURRENT", reason: null, lastKnownSafe: true },
  capabilities: ["pause_growth_plan"],
} as const;
const tracksWorkspace = {
  contract: { name: "CurrentLearningTracksV1", version: "1.0.0" },
  growthPlan: {
    growthPlanId: workspace.currentPlan.growthPlanId,
    lifecycle: workspace.currentPlan.lifecycle,
    weeklyCapacityMinutes: workspace.currentPlan.weeklyCapacityMinutes,
    aggregateVersion: workspace.currentPlan.aggregateVersion,
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
  ],
} as const;
const currentPlanSetupSource = {
  contract: { name: "GrowthPlanSetupSourceV1", version: "1.0.0" },
  state: "CURRENT_PLAN_EXISTS",
  capabilities: [],
  goals: [],
} as const;
const activityAdmissionSource = {
  contract: { name: "LearningTrackActivityAdmissionSourceV1", version: "1.0.0" },
  state: "READY",
  capabilities: ["admit_activity_to_learning_track"],
  growthPlan: {
    title: workspace.currentPlan.title,
    lifecycle: workspace.currentPlan.lifecycle,
    weeklyCapacityMinutes: workspace.currentPlan.weeklyCapacityMinutes,
    aggregateVersion: workspace.currentPlan.aggregateVersion,
  },
  learningTrack: {
    trackKey: tracksWorkspace.learningTracks[0].trackKey,
    title: tracksWorkspace.learningTracks[0].title,
    lifecycle: tracksWorkspace.learningTracks[0].lifecycle,
    priority: tracksWorkspace.learningTracks[0].priority,
    protectedMinimumMinutes: tracksWorkspace.learningTracks[0].protectedMinimumMinutes,
    defaultSessionMinutes: 45,
    aggregateVersion: tracksWorkspace.learningTracks[0].aggregateVersion,
  },
  activities: [
    {
      activityKey: "activity:system-design-practice",
      title: "System design practice",
      activityType: "PROJECT",
      targetCompetencyRef: "competency:system-design",
    },
  ],
} as const;
const learningTrackCreationSource = {
  contract: { name: "LearningTrackCreationSourceV1", version: "1.0.0" },
  state: "READY",
  capabilities: ["create_learning_track"],
  growthPlan: {
    title: workspace.currentPlan.title,
    lifecycle: workspace.currentPlan.lifecycle,
    weeklyCapacityMinutes: workspace.currentPlan.weeklyCapacityMinutes,
    aggregateVersion: workspace.currentPlan.aggregateVersion,
  },
  trackPortfolio: { currentTrackCount: 1, currentTrackLimit: 30 },
  goals: [
    {
      readinessGoalKey: "goal:backend-interview-readiness",
      title: "Backend interview readiness",
      profileLabel: "Backend interview profile",
      profileVersionKey: "target:backend-interview-v1",
      roadmapPresent: true,
      aggregateVersion: "1",
    },
  ],
} as const;
const multiTrackWorkspace = {
  ...tracksWorkspace,
  learningTracks: [
    tracksWorkspace.learningTracks[0],
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
} as const;
const selectedTrackAdmissionSource = {
  contract: { name: "LearningTrackActivityAdmissionSourceV2", version: "2.0.0" },
  state: "READY",
  capabilities: ["admit_activity_to_learning_track"],
  growthPlan: {
    title: workspace.currentPlan.title,
    lifecycle: workspace.currentPlan.lifecycle,
    weeklyCapacityMinutes: workspace.currentPlan.weeklyCapacityMinutes,
    aggregateVersion: workspace.currentPlan.aggregateVersion,
  },
  selectedTrack: {
    trackKey: multiTrackWorkspace.learningTracks[1].trackKey,
    title: multiTrackWorkspace.learningTracks[1].title,
    lifecycle: multiTrackWorkspace.learningTracks[1].lifecycle,
    priority: multiTrackWorkspace.learningTracks[1].priority,
    protectedMinimumMinutes: multiTrackWorkspace.learningTracks[1].protectedMinimumMinutes,
    defaultSessionMinutes: 30,
    aggregateVersion: multiTrackWorkspace.learningTracks[1].aggregateVersion,
  },
  activities: [
    {
      activityKey: "activity:algorithms-drills",
      title: "Algorithms drills",
      activityType: "MANUAL_CODING",
      targetCompetencyRef: "competency:algorithms",
    },
  ],
} as const;
const setupWorkspace = {
  contract: { name: "CurrentGrowthPlanV1", version: "1.0.0" },
  currentPlan: null,
  recalculation: { projectionState: "NOT_STARTED", reason: "INITIALIZING", lastKnownSafe: false },
  capabilities: [],
} as const;
const setupTracksWorkspace = {
  contract: { name: "CurrentLearningTracksV1", version: "1.0.0" },
  growthPlan: null,
  learningTracks: [],
} as const;
const availableSetupSource = {
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
  ],
} as const;
const noPlanActivityAdmissionSource = {
  contract: { name: "LearningTrackActivityAdmissionSourceV1", version: "1.0.0" },
  state: "NO_CURRENT_PLAN",
  capabilities: [],
  growthPlan: null,
  learningTrack: null,
  activities: [],
} as const;
const noPlanLearningTrackCreationSource = {
  contract: { name: "LearningTrackCreationSourceV1", version: "1.0.0" },
  state: "NO_CURRENT_PLAN",
  capabilities: [],
  growthPlan: null,
  trackPortfolio: null,
  goals: [],
} as const;

describe("PlanPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verify.mockResolvedValue({ client: { authorized: true }, subject: "owner" });
    mocks.load.mockResolvedValue(workspace);
    mocks.loadTracks.mockResolvedValue(tracksWorkspace);
    mocks.loadSetup.mockResolvedValue(currentPlanSetupSource);
    mocks.loadCreation.mockResolvedValue(learningTrackCreationSource);
    mocks.loadAdmission.mockResolvedValue(activityAdmissionSource);
    mocks.loadAdmissionV2.mockResolvedValue(selectedTrackAdmissionSource);
  });

  it("authenticates and loads the actor-scoped current Growth Plan", async () => {
    render(await PlanPage());
    expect(mocks.load).toHaveBeenCalledWith({ authorized: true });
    expect(mocks.loadTracks).toHaveBeenCalledWith({ authorized: true });
    expect(mocks.loadSetup).toHaveBeenCalledWith({ authorized: true });
    expect(mocks.loadCreation).toHaveBeenCalledWith({ authorized: true });
    expect(mocks.loadAdmission).toHaveBeenCalledWith({ authorized: true });
    expect(screen.getByRole("link", { name: "Skip to Plan" })).toHaveAttribute(
      "href",
      "#plan-main",
    );
    expect(
      screen.getByRole("heading", { name: "Keep the plan aligned with your life." }),
    ).toBeVisible();
    expect(screen.getByText("Backend interview readiness")).toBeVisible();
    expect(screen.getByRole("button", { name: "Preview change" })).toBeEnabled();
  });

  it("renders the first-Plan setup when all four actor-scoped reads agree no Plan exists", async () => {
    mocks.load.mockResolvedValue(setupWorkspace);
    mocks.loadTracks.mockResolvedValue(setupTracksWorkspace);
    mocks.loadSetup.mockResolvedValue(availableSetupSource);
    mocks.loadCreation.mockResolvedValue(noPlanLearningTrackCreationSource);
    mocks.loadAdmission.mockResolvedValue(noPlanActivityAdmissionSource);
    render(await PlanPage());
    expect(screen.getByRole("heading", { name: "Set up your first Growth Plan." })).toBeVisible();
    expect(screen.getByLabelText("Target")).toHaveValue("goal:backend-interview-readiness");
    expect(mocks.load).toHaveBeenCalledTimes(1);
    expect(mocks.loadTracks).toHaveBeenCalledTimes(1);
    expect(mocks.loadSetup).toHaveBeenCalledTimes(1);
    expect(mocks.loadCreation).toHaveBeenCalledTimes(1);
    expect(mocks.loadAdmission).not.toHaveBeenCalled();
    expect(mocks.loadAdmissionV2).not.toHaveBeenCalled();
  });

  it("redirects an unauthenticated request before loading Planning", async () => {
    mocks.verify.mockRejectedValueOnce(new classes.AuthenticatedSessionRequiredError());
    await expect(PlanPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.redirect).toHaveBeenCalledWith("/sign-in");
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.loadTracks).not.toHaveBeenCalled();
    expect(mocks.loadSetup).not.toHaveBeenCalled();
    expect(mocks.loadCreation).not.toHaveBeenCalled();
    expect(mocks.loadAdmission).not.toHaveBeenCalled();
  });

  it("collapses private read failures into a safe retry state", async () => {
    mocks.load.mockRejectedValueOnce(new Error("private SQL detail"));
    render(await PlanPage());
    expect(screen.getByRole("alert")).toHaveTextContent("Plan is temporarily unavailable");
    expect(screen.queryByText(/private SQL/iu)).not.toBeInTheDocument();
  });

  it("keeps core Plan controls available when only activity choices fail to load", async () => {
    mocks.loadAdmission.mockRejectedValueOnce(new Error("private overlay detail"));
    render(await PlanPage());
    expect(screen.getByText("Backend interview readiness")).toBeVisible();
    expect(screen.getByRole("button", { name: "Preview change" })).toBeEnabled();
    expect(screen.getByText(/Activity choices are temporarily unavailable/iu)).toBeVisible();
    expect(screen.queryByText(/private overlay/iu)).not.toBeInTheDocument();
  });

  it("keeps core Plan controls available when only Track creation choices fail to load", async () => {
    mocks.loadCreation.mockRejectedValueOnce(new Error("private target detail"));
    render(await PlanPage());
    expect(screen.getByText("Backend interview readiness")).toBeVisible();
    expect(screen.getByRole("button", { name: "Preview change" })).toBeEnabled();
    expect(screen.getByText(/Learning Track creation is temporarily unavailable/iu)).toBeVisible();
    expect(screen.queryByText(/private target/iu)).not.toBeInTheDocument();
  });

  it("fails closed when the separately decoded Plan and Track reads do not agree", async () => {
    mocks.loadTracks.mockResolvedValue({
      ...tracksWorkspace,
      growthPlan: { ...tracksWorkspace.growthPlan, aggregateVersion: "5" },
    });
    render(await PlanPage());
    expect(screen.getByRole("alert")).toHaveTextContent("Plan is temporarily unavailable");
    expect(screen.queryByText("System design")).not.toBeInTheDocument();
  });

  it("retries one legitimate cross-read interleaving before showing an outage", async () => {
    mocks.loadTracks.mockResolvedValueOnce({
      ...tracksWorkspace,
      growthPlan: { ...tracksWorkspace.growthPlan, aggregateVersion: "3" },
    });
    render(await PlanPage());
    expect(screen.getByText("Backend interview readiness")).toBeVisible();
    expect(mocks.load).toHaveBeenCalledTimes(2);
    expect(mocks.loadTracks).toHaveBeenCalledTimes(2);
    expect(mocks.loadSetup).toHaveBeenCalledTimes(2);
    expect(mocks.loadCreation).toHaveBeenCalledTimes(2);
    expect(mocks.loadAdmission).toHaveBeenCalledTimes(2);
  });

  it("retries and then isolates a persistently incoherent Track creation source", async () => {
    mocks.loadCreation.mockResolvedValue({
      ...learningTrackCreationSource,
      growthPlan: { ...learningTrackCreationSource.growthPlan, aggregateVersion: "99" },
    });
    render(await PlanPage());
    expect(mocks.loadCreation).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Backend interview readiness")).toBeVisible();
    expect(screen.getByText(/Learning Track creation is temporarily unavailable/iu)).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Preview Learning Track" }),
    ).not.toBeInTheDocument();
  });

  it("retries and isolates a stale Track creation portfolio count", async () => {
    mocks.loadCreation.mockResolvedValue({
      ...learningTrackCreationSource,
      trackPortfolio: { currentTrackCount: 2, currentTrackLimit: 30 },
    });
    render(await PlanPage());
    expect(mocks.loadCreation).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Backend interview readiness")).toBeVisible();
    expect(screen.getByText(/Learning Track creation is temporarily unavailable/iu)).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Preview Learning Track" }),
    ).not.toBeInTheDocument();
  });

  it("retries and then isolates a persistently incoherent activity source", async () => {
    mocks.loadAdmission.mockResolvedValue({
      ...activityAdmissionSource,
      learningTrack: { ...activityAdmissionSource.learningTrack, aggregateVersion: "99" },
    });
    render(await PlanPage());
    expect(mocks.loadAdmission).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Backend interview readiness")).toBeVisible();
    expect(screen.getByText(/Activity choices are temporarily unavailable/iu)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Preview activity" })).not.toBeInTheDocument();
  });

  it("does not preload activity choices for every Track when several current Tracks exist", async () => {
    mocks.loadTracks.mockResolvedValue(multiTrackWorkspace);
    render(await PlanPage({ searchParams: Promise.resolve({}) }));
    expect(mocks.loadAdmission).not.toHaveBeenCalled();
    expect(mocks.loadAdmissionV2).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Choose destination Track" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Load activity choices" })).toBeEnabled();
  });

  it("loads only the selected Track admission source when a destination Track is chosen", async () => {
    mocks.loadTracks.mockResolvedValue(multiTrackWorkspace);
    render(
      await PlanPage({ searchParams: Promise.resolve({ activityTrack: "track:algorithms" }) }),
    );
    expect(mocks.loadAdmission).not.toHaveBeenCalled();
    expect(mocks.loadAdmissionV2).toHaveBeenCalledWith({ authorized: true }, "track:algorithms");
    expect(screen.getByText(/Add one accepted personal activity to Algorithms/iu)).toBeVisible();
  });

  it("retries and isolates a V2 source that resolves a different current Track", async () => {
    mocks.loadTracks.mockResolvedValue(multiTrackWorkspace);
    mocks.loadAdmissionV2.mockResolvedValue({
      ...selectedTrackAdmissionSource,
      selectedTrack: {
        ...selectedTrackAdmissionSource.selectedTrack,
        trackKey: "track:system-design",
        title: "System design",
        lifecycle: "ACTIVE",
        priority: 9,
        protectedMinimumMinutes: 100,
        aggregateVersion: "2",
      },
    });
    render(
      await PlanPage({ searchParams: Promise.resolve({ activityTrack: "track:algorithms" }) }),
    );
    expect(mocks.loadAdmissionV2).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/Activity choices are temporarily unavailable/iu)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Preview activity" })).not.toBeInTheDocument();
  });
});
