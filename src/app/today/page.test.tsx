import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
  verify: vi.fn(),
}));
const classes = vi.hoisted(() => ({
  AuthenticatedSessionRequiredError: class AuthenticatedSessionRequiredError extends Error {},
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("../../shared/supabase/server", () => ({
  createPandoServerComponentClient: vi.fn().mockResolvedValue({ requestScoped: true }),
}));
vi.mock("../../shared/supabase/session", () => ({
  AuthenticatedSessionRequiredError: classes.AuthenticatedSessionRequiredError,
  verifyPandoSession: mocks.verify,
}));
vi.mock("../../ui/today/server/database-today-workspace", () => ({
  loadTodayWorkspaceV1: mocks.load,
}));

import TodayPage from "./page";

const notStarted = {
  contract: { name: "TodayWorkspaceV1", version: "1.0.0" },
  projectionState: "NOT_STARTED",
  reason: "INITIALIZING",
  lastKnownSafe: false,
  calculationClock: {
    asOf: "2026-09-01T12:00:00.000Z",
    timeZone: "Asia/Jerusalem",
    weekStart: "2026-08-30T21:00:00.000Z",
    weekEnd: "2026-09-06T21:00:00.000Z",
  },
  currentInputFingerprint: null,
  snapshot: null,
  actionSelections: [],
  context: { nearestDeadline: null },
} as const;

describe("TodayPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verify.mockResolvedValue({ client: { authorized: true }, subject: "owner" });
    mocks.load.mockResolvedValue(notStarted);
  });

  it("authenticates and loads the zero-argument Today adapter", async () => {
    render(await TodayPage());
    expect(mocks.load).toHaveBeenCalledWith({ authorized: true });
    expect(mocks.load).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: "Skip to Today" })).toHaveAttribute(
      "href",
      "#today-main",
    );
    expect(screen.getByRole("heading", { name: "Set up your first daily plan." })).toBeVisible();
  });

  it("redirects an unauthenticated request before loading Planning", async () => {
    mocks.verify.mockRejectedValueOnce(new classes.AuthenticatedSessionRequiredError());
    await expect(TodayPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.redirect).toHaveBeenCalledWith("/sign-in");
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it("collapses private read failures into a safe retry state", async () => {
    mocks.load.mockRejectedValueOnce(new Error("private SQL detail"));
    render(await TodayPage());
    expect(screen.getByRole("alert")).toHaveTextContent("Today is temporarily unavailable");
    expect(screen.queryByText(/private SQL/iu)).not.toBeInTheDocument();
  });
});
