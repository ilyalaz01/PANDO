import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), preview: vi.fn(), apply: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("../../app/campaigns/actions", () => ({
  previewCampaignAllocationOverrideAction: mocks.preview,
  applyCampaignAllocationOverrideAction: mocks.apply,
}));

import previewFixture from "../../../tests/contract/fixtures/planning/v1/campaign-allocation-override-control.valid.json";
import blockedFixture from "../../../tests/contract/fixtures/planning/v1/campaign-allocation-override-control.boundary.json";
import { CampaignAllocationOverrides } from "./campaign-allocation-overrides";
import type { CampaignActionState } from "./campaign-action-state";
import type {
  CampaignAllocationOverrideChangePreviewV1,
  CampaignAllocationOverrideSummaryV1,
} from "./campaign-types";

const changePreview = previewFixture as unknown as CampaignAllocationOverrideChangePreviewV1;
const blockedPreview = blockedFixture as unknown as CampaignAllocationOverrideChangePreviewV1;

const campaignKey = "campaign:70000000-0000-8000-8000-000000000001";

const overrides: readonly CampaignAllocationOverrideSummaryV1[] = [
  {
    overrideKey: changePreview.before.overrideKey,
    campaignKey,
    learningTrack: { trackKey: "track:backend", title: "Backend" },
    lifecycle: "ACTIVE",
    priorityOverride: changePreview.before.priorityOverride,
    protectedMinimumMinutesOverride: changePreview.before.protectedMinimumMinutesOverride,
    cadencePerWeekOverride: changePreview.before.cadencePerWeekOverride,
    aggregateVersion: changePreview.before.aggregateVersion,
    capabilities: ["change_campaign_allocation_override", "remove_campaign_allocation_override"],
  },
  {
    overrideKey: "override:81000000-0000-8000-8000-000000000009",
    campaignKey,
    learningTrack: { trackKey: "track:algorithms", title: "Algorithms" },
    lifecycle: "SUPERSEDED",
    priorityOverride: null,
    protectedMinimumMinutesOverride: 60,
    cadencePerWeekOverride: null,
    aggregateVersion: "3",
    capabilities: [],
  },
];

describe("CampaignAllocationOverrides", () => {
  it("renders nothing when no active override belongs to this campaign", () => {
    const { container } = render(
      <CampaignAllocationOverrides
        campaignKey="campaign:70000000-0000-8000-8000-000000000099"
        dismissalVersion={0}
        onIntentStart={vi.fn()}
        overrides={overrides}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("lists only the active overrides for this campaign, not superseded ones", () => {
    render(
      <CampaignAllocationOverrides
        campaignKey={campaignKey}
        dismissalVersion={0}
        onIntentStart={vi.fn()}
        overrides={overrides}
      />,
    );
    expect(screen.getByText("Backend")).toBeVisible();
    expect(screen.queryByText("Algorithms")).not.toBeInTheDocument();
  });

  it("offers a change form pre-filled with the override's current values", () => {
    render(
      <CampaignAllocationOverrides
        campaignKey={campaignKey}
        dismissalVersion={0}
        onIntentStart={vi.fn()}
        overrides={overrides}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Change this override" }));
    const priorityInput = screen.getByLabelText(/Priority \(0-100/u) as HTMLInputElement;
    expect(priorityInput.value).toBe(String(changePreview.before.priorityOverride));
  });

  it("offers a direct remove form with no numeric fields", () => {
    render(
      <CampaignAllocationOverrides
        campaignKey={campaignKey}
        dismissalVersion={0}
        onIntentStart={vi.fn()}
        overrides={overrides}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove this override" }));
    expect(screen.queryByLabelText(/Priority \(0-100/u)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preview: Remove this override" })).toBeVisible();
  });

  it("renders the exact before/after comparison once previewed", () => {
    const focusedPreviewState: CampaignActionState = {
      status: "previewed",
      message: "Override preview ready.",
      preview: changePreview,
    };
    render(
      <CampaignAllocationOverrides
        campaignKey={campaignKey}
        dismissalVersion={0}
        focusedOverrideKey={changePreview.before.overrideKey}
        focusedPreviewState={focusedPreviewState}
        onIntentStart={vi.fn()}
        overrides={overrides}
      />,
    );
    expect(screen.getByText("Review this exact override change")).toBeVisible();
    const comparison = screen.getByLabelText("Exact allocation override preview");
    expect(
      within(comparison).getByText(String(changePreview.after.priorityOverride)),
    ).toBeVisible();
  });

  it("disables confirmation and warns when the preview reports a capacity blocker", () => {
    expect(blockedPreview.canApply).toBe(false);
    const focusedPreviewState: CampaignActionState = {
      status: "previewed",
      message: "Override preview ready.",
      preview: blockedPreview,
    };
    render(
      <CampaignAllocationOverrides
        campaignKey={campaignKey}
        dismissalVersion={0}
        focusedOverrideKey={blockedPreview.before.overrideKey}
        focusedPreviewState={focusedPreviewState}
        onIntentStart={vi.fn()}
        overrides={[
          {
            ...overrides[0]!,
            overrideKey: blockedPreview.before.overrideKey,
          },
        ]}
      />,
    );
    expect(screen.getByText(/would exceed the plan.s weekly capacity/u)).toBeVisible();
    expect(screen.getByRole("button", { name: /Confirm: Change this override/u })).toBeDisabled();
  });
});
