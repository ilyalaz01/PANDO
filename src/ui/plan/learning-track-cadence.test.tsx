import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), preview: vi.fn(), apply: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("../../app/plan/actions", () => ({
  previewLearningTrackCadenceAction: mocks.preview,
  applyLearningTrackCadenceAction: mocks.apply,
}));

import previewFixture from "../../../tests/contract/fixtures/planning/v1/learning-track-cadence-control.valid.json";
import type { LearningTrackCadencePreviewV1, LearningTrackCadenceSourceV1 } from "./plan-types";
import { LearningTrackCadence } from "./learning-track-cadence";
import type { PlanActionState } from "./plan-action-state";

const source = {
  contract: { name: "LearningTrackCadenceSourceV1", version: "1.0.0" },
  growthPlan: previewFixture.growthPlan,
  progress: previewFixture.progress,
  learningTracks: [
    {
      ...previewFixture.before,
      completedCadenceSessionsThisWeek: 2,
      capabilities: ["set_track_cadence"],
    },
  ],
} as LearningTrackCadenceSourceV1;
const pendingPreview = {
  ...previewFixture,
  progress: {
    ...previewFixture.progress,
    state: "PENDING",
    snapshotId: null,
    appliedAttemptId: null,
    inputFingerprint: null,
    calculatedAsOf: null,
    completedCadenceSessionsThisWeek: null,
    beforeCadenceDeficit: null,
    afterCadenceDeficit: null,
  },
  warnings: [{ code: "CADENCE_PROGRESS_PENDING" }],
} as unknown as LearningTrackCadencePreviewV1;

describe("LearningTrackCadence", () => {
  it("renders exact progress and preview, then dismisses it when cadence intent changes", () => {
    const initialPreviewState: PlanActionState = {
      status: "previewed",
      message: "Preview ready.",
      preview: previewFixture as unknown as LearningTrackCadencePreviewV1,
    };
    render(<LearningTrackCadence initialPreviewState={initialPreviewState} source={source} />);
    expect(screen.getByLabelText("Exact Learning Track cadence preview")).toHaveTextContent(
      "3 sessions per week",
    );
    const comparison = screen.getByLabelText("Exact Learning Track cadence preview");
    expect(within(comparison).getAllByText("Cadence deficit")[1]?.parentElement).toHaveTextContent(
      "1",
    );
    expect(screen.getByRole("button", { name: "Confirm cadence" })).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Evidence-bearing sessions per week"), {
      target: { value: "4" },
    });
    expect(screen.queryByRole("button", { name: "Confirm cadence" })).not.toBeInTheDocument();
  });

  it("shows Unknown progress for a pending source and dismisses on sibling intent version", () => {
    const pendingSource = {
      ...source,
      progress: { ...source.progress, state: "PENDING" },
      learningTracks: [{ ...source.learningTracks[0]!, completedCadenceSessionsThisWeek: null }],
    } as LearningTrackCadenceSourceV1;
    const { rerender } = render(
      <LearningTrackCadence
        dismissalVersion={0}
        initialPreviewState={{ status: "previewed", message: "Preview", preview: pendingPreview }}
        source={pendingSource}
      />,
    );
    expect(
      screen.getByText(/Progress will appear after a current V2 planning snapshot/iu),
    ).toBeVisible();
    expect(screen.getAllByText("Unknown")).toHaveLength(4);
    rerender(
      <LearningTrackCadence
        dismissalVersion={1}
        initialPreviewState={{ status: "previewed", message: "Preview", preview: pendingPreview }}
        source={pendingSource}
      />,
    );
    expect(screen.queryByRole("button", { name: "Confirm cadence" })).not.toBeInTheDocument();
  });
});
