import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import golden from "../../../tests/fixtures/calculation-engines/v0.1/planning.golden.json";
import emptyPlan from "../../../tests/contract/fixtures/planning/v1/plan-snapshot.boundary.json";
import type { PlanSnapshot } from "../../modules/planning/domain/planning-types";
import { TodayWorkspace, correlateTodayActions } from "./today-workspace";
import type { TodayWorkspaceV1 } from "./server/today-workspace-v1";

const plan = golden.expected as unknown as PlanSnapshot;

function currentWorkspace(currentPlan: PlanSnapshot = plan): TodayWorkspaceV1 {
  return {
    contract: { name: "TodayWorkspaceV1", version: "1.0.0" },
    projectionState: "CURRENT",
    reason: null,
    lastKnownSafe: true,
    calculationClock: {
      asOf: currentPlan.calculatedAsOf,
      timeZone: currentPlan.timeZone,
      weekStart: currentPlan.weekStart,
      weekEnd: currentPlan.weekEnd,
    },
    currentInputFingerprint: currentPlan.inputFingerprint,
    snapshot: {
      snapshotId: "50000000-0000-4000-8000-000000000001",
      inputFingerprint: currentPlan.inputFingerprint,
      calculatedAsOf: currentPlan.calculatedAsOf,
      validUntil: currentPlan.validUntil,
      plan: currentPlan,
    },
    actionSelections: currentPlan.actions.map((action, index) => ({
      selectionRef: `plan-action:40000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      rank: action.rank,
      candidateKey: action.candidateKey,
    })),
    context: { nearestDeadline: currentPlan.nearestDeadline },
  };
}

describe("TodayWorkspace", () => {
  it("renders one primary recommendation and bounded alternatives from exact selectors", () => {
    const { container } = render(<TodayWorkspace workspace={currentWorkspace()} />);
    expect(screen.getByText("Next best action")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Debug a TCP connection" })).toBeVisible();
    expect(screen.getByText("Reduce a mandatory blocker")).toBeVisible();
    expect(screen.getByText(/Addresses a mandatory target blocker/iu)).toBeVisible();
    expect(screen.getByRole("heading", { name: "Alternatives" })).toBeVisible();
    const focusLinks = [...container.querySelectorAll<HTMLAnchorElement>('a[href^="/focus?"]')];
    expect(focusLinks).toHaveLength(plan.actions.length);
    for (const link of focusLinks) {
      const url = new URL(link.href);
      expect([...url.searchParams.keys()]).toEqual(["selection"]);
      expect(url.searchParams.get("selection")).toMatch(/^plan-action:/u);
      expect(link.href).not.toMatch(/candidate|activity|goal|snapshot|track/iu);
    }
  });

  it("removes every action affordance from a last-known-safe pending snapshot", () => {
    const workspace: TodayWorkspaceV1 = {
      ...currentWorkspace(),
      projectionState: "PENDING",
      reason: "INPUTS_CHANGED",
      currentInputFingerprint: null,
      actionSelections: [],
    };
    const { container } = render(<TodayWorkspace workspace={workspace} />);
    expect(screen.getByRole("status")).toHaveTextContent("Today is checking changed inputs");
    expect(screen.getByText("Previous recommendations, for context only")).toBeVisible();
    expect(screen.getAllByText(/Reference only/iu)).toHaveLength(plan.actions.length);
    expect(container.querySelector('a[href^="/focus?"]')).toBeNull();
    expect(screen.queryByRole("button", { name: /start|resume/iu })).not.toBeInTheDocument();
  });

  it("renders explicit initialization and calculation-failure recovery", () => {
    const base = currentWorkspace(emptyPlan as unknown as PlanSnapshot);
    const notStarted: TodayWorkspaceV1 = {
      ...base,
      projectionState: "NOT_STARTED",
      reason: "INITIALIZING",
      lastKnownSafe: false,
      currentInputFingerprint: null,
      snapshot: null,
      actionSelections: [],
      context: { nearestDeadline: null },
    };
    const { rerender } = render(<TodayWorkspace workspace={notStarted} />);
    expect(screen.getByRole("heading", { name: "Set up your first daily plan." })).toBeVisible();
    expect(screen.getByRole("link", { name: "Choose a target" })).toHaveAttribute("href", "/start");

    rerender(
      <TodayWorkspace
        workspace={{
          ...notStarted,
          projectionState: "ERROR",
          reason: "CALCULATION_FAILED",
        }}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Today could not refresh the plan");
    expect(screen.getByRole("link", { name: "Try again" })).toHaveAttribute("href", "/today");
  });

  it("renders a truthful current no-capacity state without inventing an action", () => {
    const noCapacity = {
      ...(emptyPlan as unknown as PlanSnapshot),
      recommendationState: "NO_CAPACITY" as const,
    };
    render(<TodayWorkspace workspace={currentWorkspace(noCapacity)} />);
    expect(
      screen.getByRole("heading", {
        name: "The current week has no remaining planned capacity.",
      }),
    ).toBeVisible();
    expect(screen.getAllByRole("link", { name: "Open Review" })[0]).toHaveAttribute(
      "href",
      "/review",
    );
  });

  it("fails correlation closed on missing, reordered, or duplicate selectors", () => {
    const workspace = currentWorkspace();
    expect(correlateTodayActions({ ...workspace, actionSelections: [] })).toBeNull();
    expect(
      correlateTodayActions({
        ...workspace,
        actionSelections: [...workspace.actionSelections].reverse(),
      }),
    ).toBeNull();
    expect(
      correlateTodayActions({
        ...workspace,
        actionSelections: workspace.actionSelections.map((selection) => ({
          ...selection,
          selectionRef: workspace.actionSelections[0]!.selectionRef,
        })),
      }),
    ).toBeNull();
  });
});
