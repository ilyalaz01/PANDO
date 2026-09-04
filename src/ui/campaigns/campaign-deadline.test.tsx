import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), preview: vi.fn(), apply: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("../../app/campaigns/actions", () => ({
  previewInterviewCampaignDeadlineChangeAction: mocks.preview,
  applyInterviewCampaignDeadlineChangeAction: mocks.apply,
}));

import previewFixture from "../../../tests/contract/fixtures/interview-campaign/v1/interview-campaign-deadline-control.valid.json";
import { InterviewCampaignDeadline } from "./campaign-deadline";
import type { CampaignActionState } from "./campaign-action-state";
import type {
  InterviewCampaignDeadlineChangePreviewV1,
  InterviewCampaignSummaryV1,
} from "./campaign-types";

const preview = previewFixture as unknown as InterviewCampaignDeadlineChangePreviewV1;

const campaign: InterviewCampaignSummaryV1 = {
  campaignKey: preview.before.campaignKey,
  title: preview.before.title,
  lifecycle: preview.before.lifecycle,
  readinessGoal: { readinessGoalKey: "goal:backend-readiness", title: "Backend readiness" },
  deadline: {
    ...preview.before.deadline,
    at: "2026-12-16T05:00:00.000Z",
    passed: false,
    daysUntil: 10,
  },
  aggregateVersion: preview.before.aggregateVersion,
  capabilities: ["change_campaign_deadline"],
};

const previewState: CampaignActionState = {
  status: "previewed",
  message: "Deadline change preview ready.",
  preview,
};

describe("InterviewCampaignDeadline", () => {
  it("renders the exact before/after deadline comparison", () => {
    render(<InterviewCampaignDeadline campaign={campaign} initialPreviewState={previewState} />);
    const comparison = screen.getByLabelText("Exact Interview Campaign deadline preview");
    expect(within(comparison).getByText(/2026-12-15/u)).toBeVisible();
    expect(within(comparison).getByText(/2026-12-29/u)).toBeVisible();
    expect(screen.getByRole("button", { name: "Confirm deadline change" })).toBeEnabled();
  });

  it("dismisses a stale confirmation when the date changes", () => {
    render(<InterviewCampaignDeadline campaign={campaign} initialPreviewState={previewState} />);
    fireEvent.change(screen.getByLabelText("New deadline (local date)"), {
      target: { value: "2027-01-01" },
    });
    expect(
      screen.queryByRole("button", { name: "Confirm deadline change" }),
    ).not.toBeInTheDocument();
  });

  it("dismisses a stale confirmation when a sibling intent starts", () => {
    const { rerender } = render(
      <InterviewCampaignDeadline
        campaign={campaign}
        dismissalVersion={0}
        initialPreviewState={previewState}
      />,
    );
    expect(screen.getByRole("button", { name: "Confirm deadline change" })).toBeVisible();
    rerender(
      <InterviewCampaignDeadline
        campaign={campaign}
        dismissalVersion={1}
        initialPreviewState={previewState}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Confirm deadline change" }),
    ).not.toBeInTheDocument();
  });

  it("offers no control when the campaign cannot have its deadline changed", () => {
    const { container } = render(
      <InterviewCampaignDeadline campaign={{ ...campaign, capabilities: [] }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
