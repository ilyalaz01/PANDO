import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { CampaignWorkspace } from "./campaign-workspace";
import type { ActiveReadinessGoalV1, InterviewCampaignSummaryV1 } from "./campaign-types";

const activeGoals: readonly ActiveReadinessGoalV1[] = [
  {
    readinessGoalKey: "goal:backend-readiness",
    title: "Backend readiness",
    profileRoleTitle: "Backend Engineer",
    aggregateVersion: "7",
  },
];

const campaign: InterviewCampaignSummaryV1 = {
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
  capabilities: ["cancel_campaign", "change_campaign_deadline", "end_campaign"],
};

describe("CampaignWorkspace", () => {
  it("renders the campaign list above the draft form", () => {
    render(<CampaignWorkspace activeGoals={activeGoals} campaigns={[campaign]} />);
    expect(screen.getByRole("heading", { name: "Your Interview Campaigns" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Draft a new Interview Campaign" })).toBeVisible();
  });

  it("bumps a shared dismissal counter when the draft form's own intent starts", () => {
    render(<CampaignWorkspace activeGoals={activeGoals} campaigns={[campaign]} />);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "A new title" } });
    expect(screen.getByLabelText("Title")).toHaveValue("A new title");
  });
});
