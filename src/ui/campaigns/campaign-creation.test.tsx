import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), preview: vi.fn(), apply: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("../../app/campaigns/actions", () => ({
  previewInterviewCampaignCreationAction: mocks.preview,
  applyInterviewCampaignCreationAction: mocks.apply,
}));

import previewFixture from "../../../tests/contract/fixtures/interview-campaign/v1/interview-campaign-creation-control.valid.json";
import blockedFixture from "../../../tests/contract/fixtures/interview-campaign/v1/interview-campaign-creation-control.boundary.json";
import { InterviewCampaignCreation } from "./campaign-creation";
import type { CampaignActionState } from "./campaign-action-state";
import type { ActiveReadinessGoalV1, InterviewCampaignCreationPreviewV1 } from "./campaign-types";

const preview = previewFixture as unknown as InterviewCampaignCreationPreviewV1;
const blockedPreview = blockedFixture as unknown as InterviewCampaignCreationPreviewV1;

const activeGoals: readonly ActiveReadinessGoalV1[] = [
  {
    readinessGoalKey: preview.readinessGoal.readinessGoalKey,
    title: preview.readinessGoal.title,
    profileRoleTitle: "Backend Engineer",
    aggregateVersion: preview.readinessGoal.aggregateVersion,
  },
];

const previewState: CampaignActionState = {
  status: "previewed",
  message: "Draft preview ready.",
  preview,
};

describe("InterviewCampaignCreation", () => {
  it("renders the exact draft comparison", () => {
    render(
      <InterviewCampaignCreation activeGoals={activeGoals} initialPreviewState={previewState} />,
    );
    const comparison = screen.getByLabelText("Exact Interview Campaign draft preview");
    expect(within(comparison).getByText(preview.after.title)).toBeVisible();
    expect(comparison).toHaveTextContent("DRAFT");
    expect(screen.getByRole("button", { name: "Confirm and draft this campaign" })).toBeEnabled();
  });

  it("binds the expected version, digest, and idempotency key to the confirmation", () => {
    const { container } = render(
      <InterviewCampaignCreation activeGoals={activeGoals} initialPreviewState={previewState} />,
    );
    const hidden = [...container.querySelectorAll<HTMLInputElement>("input[type=hidden]")];
    const value = (name: string) =>
      hidden.filter((input) => input.name === name).map((input) => input.value);
    expect(value("previewDigest")).toEqual([preview.previewDigest]);
    expect(value("requestId")).toContain(preview.idempotencyKey);
  });

  it("dismisses a stale confirmation when the draft intent changes", () => {
    render(
      <InterviewCampaignCreation activeGoals={activeGoals} initialPreviewState={previewState} />,
    );
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Different loop" } });
    expect(
      screen.queryByRole("button", { name: "Confirm and draft this campaign" }),
    ).not.toBeInTheDocument();
  });

  it("dismisses a stale confirmation when a sibling intent starts", () => {
    const { rerender } = render(
      <InterviewCampaignCreation
        activeGoals={activeGoals}
        dismissalVersion={0}
        initialPreviewState={previewState}
      />,
    );
    expect(screen.getByRole("button", { name: "Confirm and draft this campaign" })).toBeVisible();
    rerender(
      <InterviewCampaignCreation
        activeGoals={activeGoals}
        dismissalVersion={1}
        initialPreviewState={previewState}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Confirm and draft this campaign" }),
    ).not.toBeInTheDocument();
  });

  it("offers no control at all when there are no active Readiness Goals", () => {
    const { container } = render(<InterviewCampaignCreation activeGoals={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("hides the confirmation button while a blocked preview explains the exact blocker", () => {
    const blockedState: CampaignActionState = {
      status: "previewed",
      message: "This draft is no longer applicable.",
      preview: blockedPreview,
    };
    render(
      <InterviewCampaignCreation activeGoals={activeGoals} initialPreviewState={blockedState} />,
    );
    expect(screen.getByText("TARGETS_CREATE_IDENTITY_COLLISION")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Confirm and draft this campaign" }),
    ).not.toBeInTheDocument();
  });
});
