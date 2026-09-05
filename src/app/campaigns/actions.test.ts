import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  applyCreation: vi.fn(),
  applyDeadline: vi.fn(),
  applyLifecycle: vi.fn(),
  applyRetarget: vi.fn(),
  applyOverride: vi.fn(),
  applyCoordination: vi.fn(),
  createClient: vi.fn(),
  previewCreation: vi.fn(),
  previewDeadline: vi.fn(),
  previewLifecycle: vi.fn(),
  previewRetarget: vi.fn(),
  previewOverride: vi.fn(),
  previewCoordination: vi.fn(),
  revalidate: vi.fn(),
  verifySession: vi.fn(),
}));
const classes = vi.hoisted(() => ({
  CampaignConflictError: class CampaignConflictError extends Error {},
  CampaignInputError: class CampaignInputError extends Error {},
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("../../shared/supabase/server", () => ({
  createPandoServerActionClient: mocks.createClient,
}));
vi.mock("../../shared/supabase/session", () => ({ verifyPandoSession: mocks.verifySession }));
vi.mock("../../ui/campaigns/server/database-campaigns", () => ({
  applyInterviewCampaignCreationV1: mocks.applyCreation,
  applyInterviewCampaignDeadlineChangeV1: mocks.applyDeadline,
  applyInterviewCampaignLifecycleV1: mocks.applyLifecycle,
  applyInterviewCampaignRetargetV1: mocks.applyRetarget,
  applyCampaignAllocationOverrideV1: mocks.applyOverride,
  applyCampaignLifecycleCoordinationV1: mocks.applyCoordination,
  previewInterviewCampaignCreationV1: mocks.previewCreation,
  previewInterviewCampaignDeadlineChangeV1: mocks.previewDeadline,
  previewInterviewCampaignLifecycleV1: mocks.previewLifecycle,
  previewInterviewCampaignRetargetV1: mocks.previewRetarget,
  previewCampaignAllocationOverrideV1: mocks.previewOverride,
  previewCampaignLifecycleCoordinationV1: mocks.previewCoordination,
  CampaignConflictError: classes.CampaignConflictError,
  CampaignInputError: classes.CampaignInputError,
}));

import { initialCampaignActionState } from "../../ui/campaigns/campaign-action-state";
import {
  applyInterviewCampaignCreationAction,
  applyInterviewCampaignDeadlineChangeAction,
  applyInterviewCampaignLifecycleAction,
  applyInterviewCampaignRetargetAction,
  applyCampaignAllocationOverrideAction,
  applyCampaignLifecycleCoordinationAction,
  previewInterviewCampaignCreationAction,
  previewInterviewCampaignDeadlineChangeAction,
  previewInterviewCampaignLifecycleAction,
  previewInterviewCampaignRetargetAction,
  previewCampaignAllocationOverrideAction,
  previewCampaignLifecycleCoordinationAction,
} from "./actions";

const client = { requestScoped: true };
const requestId = "10000000-0000-4000-8000-000000000001";
const digest = "a".repeat(64);
const campaignKey = "campaign:70000000-0000-8000-8000-000000000001";
const goalKey = "goal:backend-readiness";

function formData(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

describe("campaigns server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createClient.mockResolvedValue(client);
    mocks.verifySession.mockResolvedValue({ client });
  });

  it("previews a creation only with purpose-specific parameters", async () => {
    const preview = { canApply: true };
    mocks.previewCreation.mockResolvedValue(preview);
    const result = await previewInterviewCampaignCreationAction(
      initialCampaignActionState,
      formData({
        readinessGoalKey: goalKey,
        expectedReadinessGoalVersion: "7",
        title: "Acme loop",
        deadlineLocalDate: "2026-12-15",
        reason: "Preparing for the loop.",
        requestId,
      }),
    );
    expect(mocks.previewCreation).toHaveBeenCalledWith(client, {
      readinessGoalKey: goalKey,
      expectedReadinessGoalVersion: "7",
      title: "Acme loop",
      deadlineLocalDate: "2026-12-15",
      reason: "Preparing for the loop.",
      idempotencyKey: requestId,
    });
    expect(result.status).toBe("previewed");
    expect(result.preview).toBe(preview);
  });

  it("rejects a malformed creation preview before any client call", async () => {
    const result = await previewInterviewCampaignCreationAction(
      initialCampaignActionState,
      formData({
        readinessGoalKey: "not-a-goal-key",
        expectedReadinessGoalVersion: "7",
        title: "Acme loop",
        deadlineLocalDate: "2026-12-15",
        reason: "Preparing for the loop.",
        requestId,
      }),
    );
    expect(result.status).toBe("invalid");
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("applies a creation only with the confirmed digest and revalidates /campaigns", async () => {
    mocks.applyCreation.mockResolvedValue({});
    const result = await applyInterviewCampaignCreationAction(
      initialCampaignActionState,
      formData({
        readinessGoalKey: goalKey,
        expectedReadinessGoalVersion: "7",
        title: "Acme loop",
        deadlineLocalDate: "2026-12-15",
        reason: "Preparing for the loop.",
        requestId,
        previewDigest: digest,
      }),
    );
    expect(mocks.applyCreation).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ previewDigest: digest, idempotencyKey: requestId }),
    );
    expect(mocks.revalidate).toHaveBeenCalledWith("/campaigns");
    expect(result.status).toBe("applied");
  });

  it("rejects an apply with a malformed digest before any client call", async () => {
    const result = await applyInterviewCampaignCreationAction(
      initialCampaignActionState,
      formData({
        readinessGoalKey: goalKey,
        expectedReadinessGoalVersion: "7",
        title: "Acme loop",
        deadlineLocalDate: "2026-12-15",
        reason: "Preparing for the loop.",
        requestId,
        previewDigest: "not-a-digest",
      }),
    );
    expect(result.status).toBe("invalid");
    expect(mocks.applyCreation).not.toHaveBeenCalled();
  });

  it("maps a conflict to the conflict status without leaking detail", async () => {
    mocks.previewDeadline.mockRejectedValue(new classes.CampaignConflictError());
    const result = await previewInterviewCampaignDeadlineChangeAction(
      initialCampaignActionState,
      formData({
        campaignKey,
        expectedCampaignVersion: "2",
        deadlineLocalDate: "2026-12-29",
        reason: "The recruiter moved the onsite.",
      }),
    );
    expect(result.status).toBe("conflict");
  });

  it("previews and applies a deadline change with exact scalar parameters", async () => {
    const preview = { canApply: true };
    mocks.previewDeadline.mockResolvedValue(preview);
    const previewed = await previewInterviewCampaignDeadlineChangeAction(
      initialCampaignActionState,
      formData({
        campaignKey,
        expectedCampaignVersion: "2",
        deadlineLocalDate: "2026-12-29",
        reason: "The recruiter moved the onsite.",
      }),
    );
    expect(previewed.status).toBe("previewed");

    mocks.applyDeadline.mockResolvedValue({});
    const applied = await applyInterviewCampaignDeadlineChangeAction(
      initialCampaignActionState,
      formData({
        campaignKey,
        expectedCampaignVersion: "2",
        deadlineLocalDate: "2026-12-29",
        reason: "The recruiter moved the onsite.",
        requestId,
        previewDigest: digest,
      }),
    );
    expect(mocks.applyDeadline).toHaveBeenCalledWith(client, {
      campaignKey,
      expectedCampaignVersion: "2",
      deadlineLocalDate: "2026-12-29",
      reason: "The recruiter moved the onsite.",
      previewDigest: digest,
      idempotencyKey: requestId,
    });
    expect(applied.status).toBe("applied");
  });

  it("previews and applies a retarget with exact scalar parameters", async () => {
    const preview = { canApply: true };
    mocks.previewRetarget.mockResolvedValue(preview);
    const previewed = await previewInterviewCampaignRetargetAction(
      initialCampaignActionState,
      formData({
        campaignKey,
        expectedCampaignVersion: "3",
        readinessGoalKey: "goal:platform-readiness",
        expectedReadinessGoalVersion: "2",
        reason: "The role changed.",
      }),
    );
    expect(previewed.status).toBe("previewed");

    mocks.applyRetarget.mockResolvedValue({});
    const applied = await applyInterviewCampaignRetargetAction(
      initialCampaignActionState,
      formData({
        campaignKey,
        expectedCampaignVersion: "3",
        readinessGoalKey: "goal:platform-readiness",
        expectedReadinessGoalVersion: "2",
        reason: "The role changed.",
        requestId,
        previewDigest: digest,
      }),
    );
    expect(mocks.applyRetarget).toHaveBeenCalledWith(client, {
      campaignKey,
      expectedCampaignVersion: "3",
      readinessGoalKey: "goal:platform-readiness",
      expectedReadinessGoalVersion: "2",
      reason: "The role changed.",
      previewDigest: digest,
      idempotencyKey: requestId,
    });
    expect(applied.status).toBe("applied");
  });

  it("previews and applies a lifecycle change with exact scalar parameters", async () => {
    const preview = { canApply: true };
    mocks.previewLifecycle.mockResolvedValue(preview);
    const previewed = await previewInterviewCampaignLifecycleAction(
      initialCampaignActionState,
      formData({
        campaignKey,
        operation: "start_campaign",
        expectedCampaignVersion: "1",
        reason: "The onsite is scheduled.",
      }),
    );
    expect(previewed.status).toBe("previewed");

    mocks.applyLifecycle.mockResolvedValue({});
    const applied = await applyInterviewCampaignLifecycleAction(
      initialCampaignActionState,
      formData({
        campaignKey,
        operation: "start_campaign",
        expectedCampaignVersion: "1",
        reason: "The onsite is scheduled.",
        requestId,
        previewDigest: digest,
      }),
    );
    expect(mocks.applyLifecycle).toHaveBeenCalledWith(client, {
      campaignKey,
      operation: "start_campaign",
      expectedCampaignVersion: "1",
      reason: "The onsite is scheduled.",
      previewDigest: digest,
      idempotencyKey: requestId,
    });
    expect(applied.status).toBe("applied");
  });

  it("rejects an unsupported lifecycle operation before any client call", async () => {
    const result = await previewInterviewCampaignLifecycleAction(
      initialCampaignActionState,
      formData({
        campaignKey,
        operation: "delete_campaign",
        expectedCampaignVersion: "1",
        reason: "The onsite is scheduled.",
      }),
    );
    expect(result.status).toBe("invalid");
    expect(mocks.previewLifecycle).not.toHaveBeenCalled();
  });

  it("reports an unavailable state for any other failure", async () => {
    mocks.previewLifecycle.mockRejectedValue(new Error("boom"));
    const result = await previewInterviewCampaignLifecycleAction(
      initialCampaignActionState,
      formData({
        campaignKey,
        operation: "start_campaign",
        expectedCampaignVersion: "1",
        reason: "The onsite is scheduled.",
      }),
    );
    expect(result.status).toBe("unavailable");
  });

  const overrideKey = "override:81000000-0000-8000-8000-000000000001";

  it("previews and applies an override change, mapping blank fields to null", async () => {
    const preview = { canApply: true };
    mocks.previewOverride.mockResolvedValue(preview);
    const previewed = await previewCampaignAllocationOverrideAction(
      initialCampaignActionState,
      formData({
        overrideKey,
        operation: "change_campaign_allocation_override",
        expectedOverrideVersion: "1",
        priorityOverride: "95",
        protectedMinimumMinutesOverride: "",
        cadencePerWeekOverride: "",
        reason: "Raising priority for the onsite loop.",
      }),
    );
    expect(mocks.previewOverride).toHaveBeenCalledWith(client, {
      overrideKey,
      operation: "change_campaign_allocation_override",
      expectedOverrideVersion: "1",
      priorityOverride: 95,
      protectedMinimumMinutesOverride: null,
      cadencePerWeekOverride: null,
      reason: "Raising priority for the onsite loop.",
    });
    expect(previewed.status).toBe("previewed");

    mocks.applyOverride.mockResolvedValue({});
    const applied = await applyCampaignAllocationOverrideAction(
      initialCampaignActionState,
      formData({
        overrideKey,
        operation: "change_campaign_allocation_override",
        expectedOverrideVersion: "1",
        priorityOverride: "95",
        protectedMinimumMinutesOverride: "",
        cadencePerWeekOverride: "",
        reason: "Raising priority for the onsite loop.",
        requestId,
        previewDigest: digest,
      }),
    );
    expect(mocks.applyOverride).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ previewDigest: digest, idempotencyKey: requestId }),
    );
    expect(mocks.revalidate).toHaveBeenCalledWith("/campaigns");
    expect(applied.status).toBe("applied");
  });

  it("rejects an out-of-range override field before any client call", async () => {
    const result = await previewCampaignAllocationOverrideAction(
      initialCampaignActionState,
      formData({
        overrideKey,
        operation: "change_campaign_allocation_override",
        expectedOverrideVersion: "1",
        priorityOverride: "101",
        protectedMinimumMinutesOverride: "",
        cadencePerWeekOverride: "",
        reason: "Raising priority for the onsite loop.",
      }),
    );
    expect(result.status).toBe("invalid");
    expect(mocks.previewOverride).not.toHaveBeenCalled();
  });

  it("previews and applies a start_campaign coordination with one attached override", async () => {
    const preview = { canApply: true };
    mocks.previewCoordination.mockResolvedValue(preview);
    const previewed = await previewCampaignLifecycleCoordinationAction(
      initialCampaignActionState,
      formData({
        campaignKey,
        operation: "start_campaign",
        expectedCampaignVersion: "1",
        reason: "The onsite is scheduled.",
        requestId,
        overrideTrackKey: "track:backend",
        overrideExpectedTrackVersion: "2",
        overridePriorityOverride: "95",
        overrideProtectedMinimumMinutesOverride: "",
        overrideCadencePerWeekOverride: "",
      }),
    );
    expect(mocks.previewCoordination).toHaveBeenCalledWith(client, {
      campaignKey,
      operation: "start_campaign",
      expectedCampaignVersion: "1",
      reason: "The onsite is scheduled.",
      idempotencyKey: requestId,
      overrides: [
        {
          trackKey: "track:backend",
          expectedTrackVersion: "2",
          priorityOverride: 95,
          protectedMinimumMinutesOverride: null,
          cadencePerWeekOverride: null,
        },
      ],
    });
    expect(previewed.status).toBe("previewed");

    mocks.applyCoordination.mockResolvedValue({});
    const applied = await applyCampaignLifecycleCoordinationAction(
      initialCampaignActionState,
      formData({
        campaignKey,
        operation: "start_campaign",
        expectedCampaignVersion: "1",
        reason: "The onsite is scheduled.",
        requestId,
        previewDigest: digest,
        overrideTrackKey: "track:backend",
        overrideExpectedTrackVersion: "2",
        overridePriorityOverride: "95",
        overrideProtectedMinimumMinutesOverride: "",
        overrideCadencePerWeekOverride: "",
      }),
    );
    expect(mocks.applyCoordination).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ previewDigest: digest }),
    );
    expect(applied.status).toBe("applied");
  });

  it("ignores override fields for end_campaign and cancel_campaign", async () => {
    mocks.previewCoordination.mockResolvedValue({ canApply: true });
    await previewCampaignLifecycleCoordinationAction(
      initialCampaignActionState,
      formData({
        campaignKey,
        operation: "end_campaign",
        expectedCampaignVersion: "2",
        reason: "The loop concluded.",
        requestId,
        overrideTrackKey: "track:backend",
        overrideExpectedTrackVersion: "2",
      }),
    );
    expect(mocks.previewCoordination).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ overrides: [] }),
    );
  });

  it("rejects a coordination override intent that sets no field at all", async () => {
    const result = await previewCampaignLifecycleCoordinationAction(
      initialCampaignActionState,
      formData({
        campaignKey,
        operation: "start_campaign",
        expectedCampaignVersion: "1",
        reason: "The onsite is scheduled.",
        requestId,
        overrideTrackKey: "track:backend",
        overrideExpectedTrackVersion: "2",
      }),
    );
    expect(result.status).toBe("invalid");
    expect(mocks.previewCoordination).not.toHaveBeenCalled();
  });
});
