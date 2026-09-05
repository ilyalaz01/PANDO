import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadCampaigns: vi.fn(),
  loadOverrides: vi.fn(),
  loadTargetSelection: vi.fn(),
  loadCurrentLearningTracks: vi.fn(),
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
vi.mock("../../ui/campaigns/server/database-campaigns", () => ({
  loadInterviewCampaignsV1: mocks.loadCampaigns,
  loadCampaignAllocationOverridesV1: mocks.loadOverrides,
}));
vi.mock("../../ui/start/server/database-target-selection", () => ({
  loadTargetSelectionSourceV1: mocks.loadTargetSelection,
}));
vi.mock("../../ui/plan/server/database-plan", () => ({
  loadCurrentLearningTracksV1: mocks.loadCurrentLearningTracks,
}));

import CampaignsPage from "./page";

const campaignsWorkspace = {
  contract: { name: "InterviewCampaignsV1", version: "1.0.0" },
  campaigns: [
    {
      campaignKey: "campaign:70000000-0000-8000-8000-000000000001",
      title: "Acme backend loop",
      lifecycle: "ACTIVE",
      readinessGoal: { readinessGoalKey: "goal:backend-readiness", title: "Backend readiness" },
      deadline: {
        localDate: "2026-12-15",
        timeZone: "America/New_York",
        at: "2026-12-16T05:00:00.000Z",
        passed: false,
        daysUntil: 10,
      },
      aggregateVersion: "2",
      capabilities: ["cancel_campaign", "change_campaign_deadline", "end_campaign"],
    },
  ],
} as const;

const targetSelectionSource = {
  contract: { name: "TargetSelectionSourceV1", version: "1.0.0" },
  workspace: {
    workspaceId: "10000000-0000-4000-8000-000000000001",
    workspaceKind: "personal",
    displayName: "Personal workspace",
    membershipRole: "owner",
  },
  profiles: [],
  readinessGoals: [
    {
      readinessGoalKey: "goal:backend-readiness",
      title: "Backend readiness",
      profileVersionKey: "target:backend-engineer-v1",
      profileRoleTitle: "Backend Engineer",
      lifecycle: "active",
      aggregateVersion: "7",
    },
    {
      readinessGoalKey: "goal:archived-readiness",
      title: "Archived readiness",
      profileVersionKey: "target:archived-v1",
      profileRoleTitle: "Archived role",
      lifecycle: "archived",
      aggregateVersion: "1",
    },
  ],
} as const;

const emptyOverrides = {
  contract: { name: "CampaignAllocationOverridesV1", version: "1.0.0" },
  overrides: [],
} as const;

const emptyLearningTracks = {
  contract: { name: "CurrentLearningTracksV1", version: "1.0.0" },
  growthPlan: null,
  learningTracks: [],
} as const;

describe("CampaignsPage", () => {
  it("renders the campaign list and only currently active Readiness Goals", async () => {
    mocks.verify.mockResolvedValue({ client: { requestScoped: true } });
    mocks.loadCampaigns.mockResolvedValue(campaignsWorkspace);
    mocks.loadTargetSelection.mockResolvedValue(targetSelectionSource);
    mocks.loadOverrides.mockResolvedValue(emptyOverrides);
    mocks.loadCurrentLearningTracks.mockResolvedValue(emptyLearningTracks);
    render(await CampaignsPage());
    expect(screen.getByText("Acme backend loop")).toBeVisible();
    expect(screen.getByLabelText("Readiness Goal")).toHaveTextContent("Backend readiness");
    expect(screen.queryByText("Archived readiness")).not.toBeInTheDocument();
  });

  it("redirects to sign-in when the session is not authenticated", async () => {
    mocks.verify.mockRejectedValue(new classes.AuthenticatedSessionRequiredError());
    await expect(CampaignsPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.redirect).toHaveBeenCalledWith("/sign-in");
  });

  it("shows a fail-closed fallback without changing anything on any other read failure", async () => {
    mocks.verify.mockResolvedValue({ client: { requestScoped: true } });
    mocks.loadCampaigns.mockRejectedValue(new Error("unavailable"));
    render(await CampaignsPage());
    expect(screen.getByRole("heading", { name: /temporarily unavailable/u })).toBeVisible();
  });
});
