import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  start: vi.fn(),
  complete: vi.fn(),
  stop: vi.fn(),
  invalidate: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("../../app/focus/actions", () => ({
  startFocusAction: mocks.start,
  completeFocusAction: mocks.complete,
  stopFocusAction: mocks.stop,
  invalidateEvidenceAction: mocks.invalidate,
}));

import { FocusWorkspace } from "./focus-workspace";
import type { FocusWorkspaceV1 } from "./server/focus-workspace-v1";

function workspace(): FocusWorkspaceV1 {
  return {
    contract: { name: "FocusWorkspaceV1", version: "1.0.0" },
    readinessGoalKey: "goal:personal-main",
    activity: {
      activityKey: "activity:typing-practice",
      title: "Typing practice",
      activityType: "MANUAL_CODING",
      competencyRef: "competency:python-typing",
      evidenceDimension: "APPLICATION",
      expectedEvidence: "Produce a working result without copying the solution.",
      resourceUrl: "https://example.test/practice",
    },
    activeSession: null,
    history: [],
    masteryState: null,
    projectionState: "not_started",
  };
}

function activeWorkspace(): FocusWorkspaceV1 {
  return {
    ...workspace(),
    activeSession: {
      focusSessionId: "10000000-0000-4000-8000-000000000001",
      activityKey: "activity:typing-practice",
      title: "Typing practice",
      state: "active",
      plannedMinutes: 25,
      sessionVersion: "1",
      startedAt: "2026-08-27T08:00:00.000Z",
    },
  };
}

function historyWorkspace(): FocusWorkspaceV1 {
  return {
    ...workspace(),
    history: [
      {
        focusSessionId: "10000000-0000-4000-8000-000000000002",
        activityKey: "activity:typing-practice",
        title: "Typing practice",
        state: "completed",
        startedAt: "2026-08-26T08:00:00.000Z",
        endedAt: "2026-08-26T08:25:00.000Z",
        resultKind: "OBSERVED_SUCCESS",
        evidenceId: "20000000-0000-4000-8000-000000000001",
        evidenceValid: true,
        dimension: "APPLICATION",
        outcome: "SUCCESS",
        ledgerWatermark: "1",
      },
    ],
    masteryState: {
      engineVersion: "mastery-engine/0.1.0",
      policyVersion: "mastery-readiness-policy/0.1",
      inputWatermark: "1",
      competencyId: "competency:python-typing",
      calculatedAsOf: "2026-08-26T08:25:01.000Z",
      achievementLevel: "COMPLETED",
      explanationCodes: ["ACHIEVEMENT_COMPLETED"],
    },
    projectionState: "current",
  };
}

describe("FocusWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.setSystemTime(new Date("2026-08-27T08:12:00.000Z"));
    let request = 0;
    vi.stubGlobal("crypto", {
      randomUUID: vi.fn(() => `90000000-0000-4000-8000-${String(++request).padStart(12, "0")}`),
    });
    for (const action of [mocks.start, mocks.complete, mocks.stop, mocks.invalidate]) {
      action.mockResolvedValue({ status: "idle", message: "" });
    }
  });

  it("shows the owner-derived activity goal and starts without authority fields", async () => {
    const { container } = render(<FocusWorkspace workspace={workspace()} />);
    expect(screen.getByRole("heading", { name: "Typing practice", level: 1 })).toBeVisible();
    expect(screen.getByText(/Produce a working result/iu)).toBeVisible();
    expect(screen.getByText("application")).toBeVisible();
    expect(screen.getByRole("link", { name: /Open activity resource/iu })).toHaveAttribute(
      "target",
      "_blank",
    );
    expect(container.querySelector('[name="workspaceId"]')).toBeNull();
    expect(container.querySelector('[name="mappingConfidence"]')).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Start focus session" }));
    await waitFor(() => expect(mocks.start).toHaveBeenCalled());
    const formData = mocks.start.mock.calls[0]?.[1] as FormData;
    expect(formData.get("activityKey")).toBe("activity:typing-practice");
    expect(formData.get("plannedMinutes")).toBe("25");
  });

  it("provides a local scratch area and explicit evidence result choices", async () => {
    render(<FocusWorkspace workspace={activeWorkspace()} />);
    expect(screen.getByRole("heading", { name: "Typing practice", level: 1 })).toBeVisible();
    expect(screen.getByText(/Produce a working result/iu)).toBeVisible();
    expect(screen.getByRole("link", { name: /Open activity resource/iu })).toBeVisible();
    expect(screen.getByText("12 min elapsed")).toBeVisible();
    const scratch = screen.getByLabelText("Scratch area");
    fireEvent.change(scratch, { target: { value: "Keep this only in the browser." } });
    expect(scratch).toHaveValue("Keep this only in the browser.");
    expect(screen.getByText(/Local and unsaved/iu)).toBeVisible();
    expect(screen.getByLabelText("I produced the expected result")).toBeChecked();

    fireEvent.click(screen.getByLabelText("I tried, but the result did not work"));
    fireEvent.click(screen.getByLabelText("I used a hint or guided solution"));
    fireEvent.click(screen.getByRole("button", { name: "Complete and save result" }));
    await waitFor(() => expect(mocks.complete).toHaveBeenCalled());
    const formData = mocks.complete.mock.calls[0]?.[1] as FormData;
    expect(formData.get("resultKind")).toBe("OBSERVED_FAILURE");
    expect(formData.get("usedHint")).toBe("on");
    expect(formData.get("scratch")).toBeNull();
  });

  it("stops through a separate no-evidence action", async () => {
    render(<FocusWorkspace workspace={activeWorkspace()} />);
    fireEvent.click(screen.getByRole("button", { name: "Stop without evidence" }));
    await waitFor(() => expect(mocks.stop).toHaveBeenCalled());
    const formData = mocks.stop.mock.calls[0]?.[1] as FormData;
    expect(formData.get("focusSessionId")).toBe("10000000-0000-4000-8000-000000000001");
    expect(formData.get("resultKind")).toBeNull();
  });

  it("renders explainable history and requires a reason before invalidation", async () => {
    render(<FocusWorkspace workspace={historyWorkspace()} />);
    expect(screen.getByText("observed success", { exact: false })).toBeVisible();
    expect(screen.getByText("application evidence")).toBeVisible();
    expect(screen.getByText("completed", { selector: "strong" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Correct this evidence" }));
    const reason = screen.getByLabelText("Why is this evidence incorrect?");
    fireEvent.change(reason, { target: { value: "The result was recorded incorrectly." } });
    fireEvent.click(screen.getByRole("button", { name: "Invalidate evidence" }));
    await waitFor(() => expect(mocks.invalidate).toHaveBeenCalled());
    const formData = mocks.invalidate.mock.calls[0]?.[1] as FormData;
    expect(formData.get("evidenceId")).toBe("20000000-0000-4000-8000-000000000001");
    expect(formData.get("reason")).toBe("The result was recorded incorrectly.");
  });

  it("announces pending calculation without claiming the old projection is current", () => {
    render(<FocusWorkspace workspace={{ ...historyWorkspace(), projectionState: "pending" }} />);
    expect(screen.getByText(/Recalculating from the active evidence ledger/iu)).toHaveAttribute(
      "role",
      "status",
    );
    expect(screen.queryByText("achievement completed")).not.toBeInTheDocument();
  });

  it("renders a safe empty state when no activity is selected", () => {
    render(<FocusWorkspace workspace={{ ...workspace(), activity: null }} />);
    expect(
      screen.getByRole("heading", { name: "Choose a personal activity in Explore." }),
    ).toBeVisible();
  });
});
