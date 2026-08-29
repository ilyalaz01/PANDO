import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadPlan: vi.fn(),
  loadLegacy: vi.fn(),
  verify: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("../../shared/supabase/server", () => ({
  createPandoServerComponentClient: vi.fn().mockResolvedValue({ requestScoped: true }),
}));
vi.mock("../../shared/supabase/session", () => ({
  AuthenticatedSessionRequiredError: class AuthenticatedSessionRequiredError extends Error {},
  verifyPandoSession: mocks.verify,
}));
vi.mock("../../ui/focus/server/database-focus-workspace", () => ({
  loadFocusFromPlanWorkspaceV1: mocks.loadPlan,
  loadFocusWorkspaceV1: mocks.loadLegacy,
}));
vi.mock("../../ui/focus/focus-workspace", () => ({
  FocusWorkspace: ({
    planEntry,
  }: {
    readonly planEntry?: { readonly selectionRef: string; readonly plannedMinutes: number };
  }) => (
    <div data-testid="focus-workspace">
      {planEntry === undefined ? "legacy" : `${planEntry.selectionRef}:${planEntry.plannedMinutes}`}
    </div>
  ),
}));

import FocusPage from "./page";

const selectionRef = "plan-action:40000000-0000-4000-8000-000000000001";
const workspace = {
  contract: { name: "FocusWorkspaceV1", version: "1.0.0" },
  readinessGoalKey: "goal:personal-main",
  activity: null,
  activeSession: null,
  history: [],
  masteryState: null,
  projectionState: "not_started",
} as const;

describe("FocusPage Today selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verify.mockResolvedValue({ client: { authorized: true }, subject: "owner" });
    mocks.loadPlan.mockResolvedValue({
      selectionRef,
      plannedMinutes: 45,
      entryState: "READY_TO_START",
      workspace,
    });
  });

  it("loads a selector through the dedicated server boundary", async () => {
    render(
      await FocusPage({
        searchParams: Promise.resolve({ selection: selectionRef }),
      }),
    );
    expect(mocks.loadPlan).toHaveBeenCalledWith({ authorized: true }, selectionRef);
    expect(mocks.loadLegacy).not.toHaveBeenCalled();
    expect(screen.getByTestId("focus-workspace")).toHaveTextContent(`${selectionRef}:45`);
  });

  it("rejects mixed or repeated query authority before any Focus read", async () => {
    const { rerender } = render(
      await FocusPage({
        searchParams: Promise.resolve({ selection: selectionRef, goal: "goal:personal-main" }),
      }),
    );
    expect(
      screen.getByRole("heading", { name: "Open Focus from Today or an activity." }),
    ).toBeVisible();
    expect(mocks.loadPlan).not.toHaveBeenCalled();

    rerender(
      await FocusPage({
        searchParams: Promise.resolve({ selection: [selectionRef, selectionRef] }),
      }),
    );
    expect(mocks.loadPlan).not.toHaveBeenCalled();
  });

  it("renders a generic stale-selection recovery without leaking the failure", async () => {
    mocks.loadPlan.mockRejectedValueOnce(new Error("private resolver tuple"));
    render(
      await FocusPage({
        searchParams: Promise.resolve({ selection: selectionRef }),
      }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent("This Today action is no longer available");
    expect(screen.queryByText(/resolver tuple/iu)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Reload Today" })).toHaveAttribute("href", "/today");
  });
});
