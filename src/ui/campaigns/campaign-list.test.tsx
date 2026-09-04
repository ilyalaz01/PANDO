import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { InterviewCampaignList } from "./campaign-list";
import type { ActiveReadinessGoalV1, InterviewCampaignSummaryV1 } from "./campaign-types";

const activeGoals: readonly ActiveReadinessGoalV1[] = [
  {
    readinessGoalKey: "goal:backend-readiness",
    title: "Backend readiness",
    profileRoleTitle: "Backend Engineer",
    aggregateVersion: "7",
  },
];

function campaign(overrides: Partial<InterviewCampaignSummaryV1>): InterviewCampaignSummaryV1 {
  return {
    campaignKey: "campaign:70000000-0000-8000-8000-000000000001",
    title: "Acme backend loop",
    lifecycle: "ACTIVE",
    readinessGoal: { readinessGoalKey: "goal:backend-readiness", title: "Backend readiness" },
    deadline: {
      localDate: "2026-12-15",
      timeZone: "America/New_York",
      at: "2026-12-16T05:00:00.000Z",
      passed: false,
      daysUntil: 10,
    },
    aggregateVersion: "2",
    capabilities: [
      "cancel_campaign",
      "change_campaign_deadline",
      "change_campaign_target",
      "end_campaign",
    ],
    ...overrides,
  };
}

describe("InterviewCampaignList", () => {
  it("explains there are no campaigns yet when the list is empty", () => {
    render(
      <InterviewCampaignList
        activeGoals={activeGoals}
        campaigns={[]}
        dismissalVersion={0}
        onIntentStart={vi.fn()}
      />,
    );
    expect(screen.getByText(/No Interview Campaigns yet/u)).toBeVisible();
  });

  it("shows the exact status badge, target, and deadline phrasing for each campaign", () => {
    const active = campaign({});
    const tomorrow = campaign({
      campaignKey: "campaign:70000000-0000-8000-8000-000000000002",
      deadline: { ...active.deadline, daysUntil: 1 },
    });
    const today = campaign({
      campaignKey: "campaign:70000000-0000-8000-8000-000000000003",
      deadline: { ...active.deadline, daysUntil: 0 },
    });
    const passed = campaign({
      campaignKey: "campaign:70000000-0000-8000-8000-000000000004",
      deadline: { ...active.deadline, passed: true },
    });
    render(
      <InterviewCampaignList
        activeGoals={activeGoals}
        campaigns={[active, tomorrow, today, passed]}
        dismissalVersion={0}
        onIntentStart={vi.fn()}
      />,
    );
    expect(screen.getByText("10 days until the deadline")).toBeVisible();
    expect(screen.getByText("Deadline is tomorrow")).toBeVisible();
    expect(screen.getByText("Deadline is today")).toBeVisible();
    expect(screen.getByText(/Deadline passed/u)).toBeVisible();
    expect(screen.getAllByText("ACTIVE")).toHaveLength(4);
  });

  it("warns explicitly when an active campaign's deadline has passed", () => {
    render(
      <InterviewCampaignList
        activeGoals={activeGoals}
        campaigns={[campaign({ deadline: { ...campaign({}).deadline, passed: true } })]}
        dismissalVersion={0}
        onIntentStart={vi.fn()}
      />,
    );
    expect(screen.getByText(/deadline has passed/u)).toBeVisible();
  });

  it("hides every edit control for a terminal campaign and still explains history honestly", () => {
    render(
      <InterviewCampaignList
        activeGoals={activeGoals}
        campaigns={[campaign({ lifecycle: "ENDED", capabilities: [] })]}
        dismissalVersion={0}
        onIntentStart={vi.fn()}
      />,
    );
    expect(screen.queryByText("Change deadline")).not.toBeInTheDocument();
    expect(screen.queryByText("Retarget")).not.toBeInTheDocument();
    expect(screen.queryByText("Lifecycle")).not.toBeInTheDocument();
    const history = screen.getByText("Retargeting history").closest("section")!;
    expect(within(history).getByText(/does not yet expose a read/u)).toBeVisible();
  });
});
