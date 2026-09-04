import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), preview: vi.fn(), apply: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("../../app/campaigns/actions", () => ({
  previewInterviewCampaignLifecycleAction: mocks.preview,
  applyInterviewCampaignLifecycleAction: mocks.apply,
}));

import previewFixture from "../../../tests/contract/fixtures/interview-campaign/v1/interview-campaign-lifecycle-control.valid.json";
import { InterviewCampaignLifecycle } from "./campaign-lifecycle";
import type { CampaignActionState } from "./campaign-action-state";
import type {
  InterviewCampaignLifecyclePreviewV1,
  InterviewCampaignSummaryV1,
} from "./campaign-types";

const preview = previewFixture as unknown as InterviewCampaignLifecyclePreviewV1;

const draftCampaign: InterviewCampaignSummaryV1 = {
  campaignKey: preview.before.campaignKey,
  title: preview.before.title,
  lifecycle: "DRAFT",
  readinessGoal: { readinessGoalKey: "goal:backend-readiness", title: "Backend readiness" },
  deadline: {
    localDate: "2026-12-15",
    timeZone: "America/New_York",
    at: "2026-12-16T05:00:00.000Z",
    passed: false,
    daysUntil: 10,
  },
  aggregateVersion: preview.before.aggregateVersion,
  capabilities: ["start_campaign", "cancel_campaign"],
};

const previewState: CampaignActionState = {
  status: "previewed",
  message: "Lifecycle change preview ready.",
  preview,
};

describe("InterviewCampaignLifecycle", () => {
  it("offers one button per available lifecycle operation", () => {
    render(<InterviewCampaignLifecycle campaign={draftCampaign} />);
    expect(screen.getByRole("button", { name: "Start this campaign" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Cancel this campaign" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "End this campaign" })).not.toBeInTheDocument();
  });

  it("renders the exact before/after lifecycle comparison once previewed", () => {
    render(
      <InterviewCampaignLifecycle campaign={draftCampaign} initialPreviewState={previewState} />,
    );
    const comparison = screen.getByLabelText("Exact Interview Campaign lifecycle preview");
    expect(within(comparison).getByText(preview.before.lifecycle)).toBeVisible();
    expect(within(comparison).getByText(preview.after.lifecycle)).toBeVisible();
  });

  it("dismisses a stale confirmation when a sibling intent starts", () => {
    const { rerender } = render(
      <InterviewCampaignLifecycle
        campaign={draftCampaign}
        dismissalVersion={0}
        initialPreviewState={previewState}
      />,
    );
    expect(screen.getByLabelText("Exact Interview Campaign lifecycle preview")).toBeVisible();
    rerender(
      <InterviewCampaignLifecycle
        campaign={draftCampaign}
        dismissalVersion={1}
        initialPreviewState={previewState}
      />,
    );
    expect(
      screen.queryByLabelText("Exact Interview Campaign lifecycle preview"),
    ).not.toBeInTheDocument();
  });

  it("offers no control at all when no lifecycle transition is available", () => {
    const { container } = render(
      <InterviewCampaignLifecycle campaign={{ ...draftCampaign, capabilities: [] }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("opens a bounded reason form when a lifecycle action starts", () => {
    render(<InterviewCampaignLifecycle campaign={draftCampaign} />);
    fireEvent.click(screen.getByRole("button", { name: "Start this campaign" }));
    expect(screen.getByRole("button", { name: "Preview: Start this campaign" })).toBeVisible();
  });
});
