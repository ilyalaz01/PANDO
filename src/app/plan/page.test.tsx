import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  loadTracks: vi.fn(),
  loadSetup: vi.fn(),
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

describe("PlanPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verify.mockResolvedValue({ client: { authorized: true }, subject: "owner" });
    mocks.load.mockResolvedValue(workspace);
    mocks.loadTracks.mockResolvedValue(tracksWorkspace);
    mocks.loadSetup.mockResolvedValue(currentPlanSetupSource);
  });

  it("authenticates and loads the actor-scoped current Growth Plan", async () => {
    render(await PlanPage());
    expect(mocks.load).toHaveBeenCalledWith({ authorized: true });
    expect(mocks.loadTracks).toHaveBeenCalledWith({ authorized: true });
    expect(mocks.loadSetup).toHaveBeenCalledWith({ authorized: true });
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

  it("renders the first-Plan setup when all three actor-scoped reads agree no Plan exists", async () => {
    mocks.load.mockResolvedValue(setupWorkspace);
    mocks.loadTracks.mockResolvedValue(setupTracksWorkspace);
    mocks.loadSetup.mockResolvedValue(availableSetupSource);
    render(await PlanPage());
    expect(screen.getByRole("heading", { name: "Set up your first Growth Plan." })).toBeVisible();
    expect(screen.getByLabelText("Target")).toHaveValue("goal:backend-interview-readiness");
    expect(mocks.load).toHaveBeenCalledTimes(1);
    expect(mocks.loadTracks).toHaveBeenCalledTimes(1);
    expect(mocks.loadSetup).toHaveBeenCalledTimes(1);
  });

  it("redirects an unauthenticated request before loading Planning", async () => {
    mocks.verify.mockRejectedValueOnce(new classes.AuthenticatedSessionRequiredError());
    await expect(PlanPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.redirect).toHaveBeenCalledWith("/sign-in");
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.loadTracks).not.toHaveBeenCalled();
    expect(mocks.loadSetup).not.toHaveBeenCalled();
  });

  it("collapses private read failures into a safe retry state", async () => {
    mocks.load.mockRejectedValueOnce(new Error("private SQL detail"));
    render(await PlanPage());
    expect(screen.getByRole("alert")).toHaveTextContent("Plan is temporarily unavailable");
    expect(screen.queryByText(/private SQL/iu)).not.toBeInTheDocument();
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
  });
});
