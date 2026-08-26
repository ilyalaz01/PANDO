import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
}));

vi.mock("../../shared/supabase/server", () => ({
  createPandoServerComponentClient: vi.fn().mockResolvedValue({}),
}));
vi.mock("../../shared/supabase/session", () => ({
  AuthenticatedSessionRequiredError: class AuthenticatedSessionRequiredError extends Error {},
  verifyPandoSession: vi.fn().mockResolvedValue({ client: {}, subject: "owner" }),
}));
vi.mock("../../ui/start/server/database-target-selection", () => ({
  loadTargetSelectionSourceV1: mocks.load,
}));

import StartPage from "./page";

const workspace = {
  workspaceId: "20000000-0000-4000-8000-000000000001",
  workspaceKind: "personal",
  displayName: "Personal workspace",
  membershipRole: "owner",
} as const;

const profile = {
  profileVersionKey: "target:nvidia-python-verification-base-v1",
  profileSeriesKey: "target-series:nvidia-python-verification",
  scope: "canonical",
  roleTitle: "Python and Verification Interview Readiness",
  companyName: "NVIDIA",
  versionNumber: 1,
  baseProfileVersionKey: null,
  catalogVersionKey: "catalog:seed-v1",
  roadmapVersionKey: "roadmap:nvidia-python-verification-v1",
  sourceSummary: "Initial curated assumption.",
  freshnessStatus: "initial_curated_assumption",
  reviewedAt: "2026-08-26",
} as const;

describe("StartPage", () => {
  beforeEach(() => mocks.load.mockReset());

  it("requires an explicit one-time command when no personal workspace exists", async () => {
    mocks.load.mockResolvedValue({
      contract: { name: "TargetSelectionSourceV1", version: "1.0.0" },
      workspace: null,
      profiles: [],
      readinessGoals: [],
    });

    render(await StartPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("heading", { name: "Prepare your personal workspace." })).toBeVisible();
    expect(screen.getByRole("button", { name: "Prepare personal workspace" })).toBeVisible();
  });

  it("renders exact target provenance and restores a selected persisted goal from the URL", async () => {
    mocks.load.mockResolvedValue({
      contract: { name: "TargetSelectionSourceV1", version: "1.0.0" },
      workspace,
      profiles: [profile],
      readinessGoals: [
        {
          readinessGoalKey: "goal:nvidia-python-verification-base-v1",
          title: profile.roleTitle,
          profileVersionKey: profile.profileVersionKey,
          profileRoleTitle: profile.roleTitle,
          lifecycle: "active",
          aggregateVersion: "1",
        },
      ],
    });

    render(
      await StartPage({
        searchParams: Promise.resolve({ goal: "goal:nvidia-python-verification-base-v1" }),
      }),
    );
    expect(screen.getByRole("heading", { level: 2, name: profile.roleTitle })).toBeVisible();
    expect(screen.getByText("Initial curated assumption.")).toBeVisible();
    expect(screen.getByText("Selected readiness goal")).toBeVisible();
    expect(screen.getByRole("link", { name: profile.roleTitle })).toHaveAttribute(
      "href",
      "/start?goal=goal%3Anvidia-python-verification-base-v1",
    );
    expect(screen.getByRole("link", { name: "Explore this target" })).toHaveAttribute(
      "href",
      "/explore?goal=goal%3Anvidia-python-verification-base-v1",
    );
  });
});
