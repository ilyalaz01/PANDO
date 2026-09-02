import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const routerRefresh = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: routerRefresh }) }));
vi.mock("../../app/plan/actions", () => ({
  applyLearningTrackTerminalLifecycleAction: vi.fn(),
  previewLearningTrackTerminalLifecycleAction: vi.fn(),
}));

import terminalFixture from "../../../tests/contract/fixtures/planning/v1/learning-track-terminal-lifecycle-control.valid.json";
import type {
  LearningTrackTerminalLifecyclePreviewV1,
  LearningTrackTerminalLifecycleSourceV1,
} from "./plan-types";
import { LearningTrackTerminalLifecycle } from "./learning-track-terminal-lifecycle";

const preview = terminalFixture as unknown as LearningTrackTerminalLifecyclePreviewV1;
const source: LearningTrackTerminalLifecycleSourceV1 = {
  contract: { name: "LearningTrackTerminalLifecycleSourceV1", version: "1.0.0" },
  state: "READY",
  growthPlan: preview.growthPlan,
  currentTracks: [
    {
      ...preview.before,
      lifecycle: "ACTIVE",
      capabilities: ["complete_track", "archive_track"],
    },
  ],
  terminalHistory: [
    {
      ...preview.before,
      learningTrackId: "40000000-0000-4000-8000-000000000031",
      trackKey: "track:completed-history",
      title: "Completed history",
      lifecycle: "COMPLETED",
      aggregateVersion: "3",
      updatedAt: "2026-09-02T10:00:00.000Z",
      capabilities: ["archive_track"],
    },
    {
      ...preview.before,
      learningTrackId: "40000000-0000-4000-8000-000000000032",
      trackKey: "track:archived-history",
      title: "Archived history",
      lifecycle: "ARCHIVED",
      aggregateVersion: "4",
      updatedAt: "2026-09-01T10:00:00.000Z",
      capabilities: [],
    },
  ],
  historyPage: { hasMore: true, nextCursor: "YWJjKysvPQ==" },
};

describe("LearningTrackTerminalLifecycle", () => {
  it("renders the exact terminal consequence and explicit non-claim", () => {
    render(
      <LearningTrackTerminalLifecycle
        initialPreviewState={{
          status: "previewed",
          message: "Terminal preview ready.",
          preview,
        }}
        source={source}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Complete or archive a Learning Track" }),
    ).toBeVisible();
    expect(screen.getByLabelText("Exact terminal Learning Track preview")).toHaveTextContent(
      "Terminal history",
    );
    expect(screen.getByText(/proves no Mastery or readiness/iu)).toBeVisible();
    expect(screen.getByRole("button", { name: "Complete this Track" })).toBeEnabled();
  });

  it("derives operations from lifecycle and keeps archived history read-only", () => {
    render(<LearningTrackTerminalLifecycle source={source} />);
    const selector = screen.getByLabelText("Track");
    expect(screen.getByRole("option", { name: "Algorithms — Active" })).toBeVisible();
    expect(screen.getByRole("option", { name: "Completed history — Completed" })).toBeVisible();
    expect(
      screen.getByRole("option", { name: "Archived history — Archived · read-only" }),
    ).toBeVisible();
    fireEvent.change(selector, { target: { value: "track:completed-history" } });
    expect(screen.queryByLabelText("Complete Track")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Archive Track")).toBeChecked();

    fireEvent.change(selector, { target: { value: "track:archived-history" } });
    expect(screen.queryByLabelText("Archive Track")).not.toBeInTheDocument();
    expect(screen.getByText(/archived Track is read-only/iu)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Preview terminal change" })).toBeNull();
  });

  it("dismisses confirmation when intent or history page changes", () => {
    const onIntentStart = vi.fn();
    render(
      <LearningTrackTerminalLifecycle
        initialPreviewState={{
          status: "previewed",
          message: "Terminal preview ready.",
          preview,
        }}
        nextHistoryHref="/plan?trackHistoryCursor=YWJjKysvPQ%3D%3D"
        onIntentStart={onIntentStart}
        source={source}
      />,
    );
    fireEvent.change(screen.getByLabelText("Why should this Track change now?"), {
      target: { value: "The interview preparation is no longer needed." },
    });
    expect(screen.queryByRole("button", { name: "Complete this Track" })).toBeNull();
    expect(onIntentStart).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("link", { name: "Next history page" }));
    expect(onIntentStart).toHaveBeenCalledTimes(2);
  });

  it("hides apply after a stale conflict and offers an explicit reload", () => {
    routerRefresh.mockClear();
    render(
      <LearningTrackTerminalLifecycle
        initialApplyState={{ status: "conflict", message: "Track changed.", preview: null }}
        initialPreviewState={{
          status: "previewed",
          message: "Terminal preview ready.",
          preview,
        }}
        source={source}
      />,
    );
    expect(screen.queryByRole("button", { name: "Complete this Track" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reload current Plan" }));
    expect(routerRefresh).toHaveBeenCalledOnce();
  });
});
