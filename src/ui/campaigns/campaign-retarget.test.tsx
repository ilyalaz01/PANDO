import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), preview: vi.fn(), apply: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("../../app/campaigns/actions", () => ({
  previewInterviewCampaignRetargetAction: mocks.preview,
  applyInterviewCampaignRetargetAction: mocks.apply,
}));

import previewFixture from "../../../tests/contract/fixtures/interview-campaign/v1/interview-campaign-retarget-control.valid.json";
import { InterviewCampaignRetarget } from "./campaign-retarget";
import type { CampaignActionState } from "./campaign-action-state";
import type {
  ActiveReadinessGoalV1,
  InterviewCampaignRetargetPreviewV1,
  InterviewCampaignSummaryV1,
} from "./campaign-types";

const preview = previewFixture as unknown as InterviewCampaignRetargetPreviewV1;

const campaign: InterviewCampaignSummaryV1 = {
  campaignKey: preview.before.campaignKey,
  title: preview.before.title,
  lifecycle: preview.before.lifecycle,
  readinessGoal: {
    readinessGoalKey: preview.before.readinessGoal.readinessGoalKey,
    title: preview.before.readinessGoal.title,
  },
  deadline: {
    localDate: "2026-12-15",
    timeZone: "America/New_York",
    at: "2026-12-16T05:00:00.000Z",
    passed: false,
    daysUntil: 10,
  },
  aggregateVersion: preview.before.aggregateVersion,
  capabilities: ["change_campaign_target"],
};

const activeGoals: readonly ActiveReadinessGoalV1[] = [
  {
    readinessGoalKey: preview.before.readinessGoal.readinessGoalKey,
    title: preview.before.readinessGoal.title,
    profileRoleTitle: "Backend Engineer",
    aggregateVersion: "7",
  },
  {
    readinessGoalKey: preview.after.readinessGoal.readinessGoalKey,
    title: preview.after.readinessGoal.title,
    profileRoleTitle: "Platform Engineer",
    aggregateVersion: preview.after.readinessGoal.aggregateVersion,
  },
];

const previewState: CampaignActionState = {
  status: "previewed",
  message: "Retarget preview ready.",
  preview,
};

describe("InterviewCampaignRetarget", () => {
  it("renders the exact before/after target comparison and revision number", () => {
    render(
      <InterviewCampaignRetarget
        activeGoals={activeGoals}
        campaign={campaign}
        initialPreviewState={previewState}
      />,
    );
    const comparison = screen.getByLabelText("Exact Interview Campaign retarget preview");
    expect(within(comparison).getByText(preview.before.readinessGoal.title)).toBeVisible();
    expect(within(comparison).getByText(preview.after.readinessGoal.title)).toBeVisible();
    expect(comparison).toHaveTextContent(String(preview.after.revisionNumber));
    expect(screen.getByRole("button", { name: "Confirm retarget" })).toBeEnabled();
  });

  it("dismisses a stale confirmation when the selected target changes", () => {
    render(
      <InterviewCampaignRetarget
        activeGoals={activeGoals}
        campaign={campaign}
        initialPreviewState={previewState}
      />,
    );
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Different reason" } });
    expect(screen.queryByRole("button", { name: "Confirm retarget" })).not.toBeInTheDocument();
  });

  it("offers no control when the campaign cannot be retargeted", () => {
    const { container } = render(
      <InterviewCampaignRetarget
        activeGoals={activeGoals}
        campaign={{ ...campaign, capabilities: [] }}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("offers no control when there is no alternative active Readiness Goal", () => {
    const { container } = render(
      <InterviewCampaignRetarget activeGoals={[activeGoals[0]!]} campaign={campaign} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
