import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), preview: vi.fn(), apply: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("../../app/campaigns/actions", () => ({
  previewCampaignLifecycleCoordinationAction: mocks.preview,
  applyCampaignLifecycleCoordinationAction: mocks.apply,
}));

import previewFixture from "../../../tests/contract/fixtures/agent-control/v1/campaign-lifecycle-coordination-control.valid.json";
import blockedFixture from "../../../tests/contract/fixtures/agent-control/v1/campaign-lifecycle-coordination-control.boundary.json";
import { InterviewCampaignLifecycle } from "./campaign-lifecycle";
import type { CampaignActionState } from "./campaign-action-state";
import type {
  AvailableLearningTrackV1,
  CampaignLifecycleCoordinationPreviewV1,
  InterviewCampaignSummaryV1,
} from "./campaign-types";

const preview = previewFixture as unknown as CampaignLifecycleCoordinationPreviewV1;
const blockedPreview = blockedFixture as unknown as CampaignLifecycleCoordinationPreviewV1;

const draftCampaign: InterviewCampaignSummaryV1 = {
  campaignKey: preview.campaign.before.campaignKey,
  title: preview.campaign.before.title,
  lifecycle: "DRAFT",
  readinessGoal: { readinessGoalKey: "goal:backend-readiness", title: "Backend readiness" },
  deadline: {
    localDate: "2026-12-15",
    timeZone: "America/New_York",
    at: "2026-12-16T05:00:00.000Z",
    passed: false,
    daysUntil: 10,
  },
  aggregateVersion: preview.campaign.before.aggregateVersion,
  capabilities: ["start_campaign", "cancel_campaign"],
};

const availableTracks: readonly AvailableLearningTrackV1[] = [
  {
    learningTrackId: "26000000-0000-4000-8000-000000000102",
    trackKey: "track:backend",
    title: "Backend",
    lifecycle: "ACTIVE",
    aggregateVersion: "2",
  },
];

const previewState: CampaignActionState = {
  status: "previewed",
  message: "Lifecycle change preview ready.",
  preview,
};

const blockedPreviewState: CampaignActionState = {
  status: "previewed",
  message: "Lifecycle change preview ready.",
  preview: blockedPreview,
};

describe("InterviewCampaignLifecycle", () => {
  it("offers one button per available lifecycle operation", () => {
    render(<InterviewCampaignLifecycle availableTracks={[]} campaign={draftCampaign} />);
    expect(screen.getByRole("button", { name: "Start this campaign" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Cancel this campaign" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "End this campaign" })).not.toBeInTheDocument();
  });

  it("renders the exact before/after lifecycle comparison once previewed", () => {
    render(
      <InterviewCampaignLifecycle
        availableTracks={[]}
        campaign={draftCampaign}
        initialPreviewState={previewState}
      />,
    );
    const comparison = screen.getByLabelText("Exact Interview Campaign lifecycle preview");
    expect(within(comparison).getByText(preview.campaign.before.lifecycle)).toBeVisible();
    expect(within(comparison).getByText(preview.campaign.after.lifecycle)).toBeVisible();
  });

  it("summarizes the installed allocation override in the preview", () => {
    render(
      <InterviewCampaignLifecycle
        availableTracks={[]}
        campaign={draftCampaign}
        initialPreviewState={previewState}
      />,
    );
    expect(screen.getByText(/Installs an allocation override on track:backend/u)).toBeVisible();
  });

  it("disables confirmation and shows the blocking reason for a blocked preview", () => {
    render(
      <InterviewCampaignLifecycle
        availableTracks={[]}
        campaign={draftCampaign}
        initialPreviewState={blockedPreviewState}
      />,
    );
    expect(screen.getByText(/ALLOCATION_OVERRIDE_TRACK_ALREADY_OVERRIDDEN/u)).toBeVisible();
    expect(screen.getByRole("button", { name: /Confirm: Start this campaign/u })).toBeDisabled();
  });

  it("dismisses a stale confirmation when a sibling intent starts", () => {
    const { rerender } = render(
      <InterviewCampaignLifecycle
        availableTracks={[]}
        campaign={draftCampaign}
        dismissalVersion={0}
        initialPreviewState={previewState}
      />,
    );
    expect(screen.getByLabelText("Exact Interview Campaign lifecycle preview")).toBeVisible();
    rerender(
      <InterviewCampaignLifecycle
        availableTracks={[]}
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
      <InterviewCampaignLifecycle
        availableTracks={[]}
        campaign={{ ...draftCampaign, capabilities: [] }}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("opens a bounded reason form when a lifecycle action starts", () => {
    render(<InterviewCampaignLifecycle availableTracks={[]} campaign={draftCampaign} />);
    fireEvent.click(screen.getByRole("button", { name: "Start this campaign" }));
    expect(screen.getByRole("button", { name: "Preview: Start this campaign" })).toBeVisible();
  });

  it("offers an optional Track override picker only when starting a campaign", () => {
    render(
      <InterviewCampaignLifecycle availableTracks={availableTracks} campaign={draftCampaign} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Start this campaign" }));
    expect(
      screen.getByLabelText("Boost one Learning Track for this campaign (optional)"),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Cancel this campaign" }));
    expect(
      screen.queryByLabelText("Boost one Learning Track for this campaign (optional)"),
    ).not.toBeInTheDocument();
  });

  it("reveals override value fields only once a Track is selected", () => {
    render(
      <InterviewCampaignLifecycle availableTracks={availableTracks} campaign={draftCampaign} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Start this campaign" }));
    expect(screen.queryByLabelText(/Priority override/u)).not.toBeInTheDocument();
    fireEvent.change(
      screen.getByLabelText("Boost one Learning Track for this campaign (optional)"),
      { target: { value: "track:backend" } },
    );
    expect(screen.getByLabelText(/Priority override/u)).toBeVisible();
  });
});
