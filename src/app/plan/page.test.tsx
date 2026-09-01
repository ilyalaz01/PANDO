import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
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

describe("PlanPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verify.mockResolvedValue({ client: { authorized: true }, subject: "owner" });
    mocks.load.mockResolvedValue(workspace);
  });

  it("authenticates and loads the actor-scoped current Growth Plan", async () => {
    render(await PlanPage());
    expect(mocks.load).toHaveBeenCalledWith({ authorized: true });
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

  it("redirects an unauthenticated request before loading Planning", async () => {
    mocks.verify.mockRejectedValueOnce(new classes.AuthenticatedSessionRequiredError());
    await expect(PlanPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.redirect).toHaveBeenCalledWith("/sign-in");
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it("collapses private read failures into a safe retry state", async () => {
    mocks.load.mockRejectedValueOnce(new Error("private SQL detail"));
    render(await PlanPage());
    expect(screen.getByRole("alert")).toHaveTextContent("Plan is temporarily unavailable");
    expect(screen.queryByText(/private SQL/iu)).not.toBeInTheDocument();
  });
});
