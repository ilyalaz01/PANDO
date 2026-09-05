// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import creationPreview from "../../../../tests/contract/fixtures/interview-campaign/v1/interview-campaign-creation-control.valid.json";
import creationApplyResult from "../../../../tests/contract/fixtures/interview-campaign/v1/interview-campaign-creation-control.apply.json";
import deadlinePreview from "../../../../tests/contract/fixtures/interview-campaign/v1/interview-campaign-deadline-control.valid.json";
import deadlineApplyResult from "../../../../tests/contract/fixtures/interview-campaign/v1/interview-campaign-deadline-control.apply.json";
import retargetPreview from "../../../../tests/contract/fixtures/interview-campaign/v1/interview-campaign-retarget-control.valid.json";
import retargetApplyResult from "../../../../tests/contract/fixtures/interview-campaign/v1/interview-campaign-retarget-control.apply.json";
import lifecyclePreview from "../../../../tests/contract/fixtures/interview-campaign/v1/interview-campaign-lifecycle-control.valid.json";
import lifecycleApplyResult from "../../../../tests/contract/fixtures/interview-campaign/v1/interview-campaign-lifecycle-control.apply.json";
import campaignsList from "../../../../tests/contract/fixtures/interview-campaign/v1/interview-campaigns.valid.json";
import overrideChangePreview from "../../../../tests/contract/fixtures/planning/v1/campaign-allocation-override-control.valid.json";
import overrideChangeApplyResult from "../../../../tests/contract/fixtures/planning/v1/campaign-allocation-override-control.apply.json";
import overridesList from "../../../../tests/contract/fixtures/planning/v1/campaign-allocation-overrides.valid.json";
import coordinationPreview from "../../../../tests/contract/fixtures/agent-control/v1/campaign-lifecycle-coordination-control.valid.json";
import coordinationApplyResult from "../../../../tests/contract/fixtures/agent-control/v1/campaign-lifecycle-coordination-control.apply.json";
import type { PandoSupabaseClient } from "../../../shared/supabase/database";
import {
  APPLY_CAMPAIGN_ALLOCATION_OVERRIDE_RPC_V1,
  APPLY_CAMPAIGN_LIFECYCLE_COORDINATION_RPC_V1,
  APPLY_INTERVIEW_CAMPAIGN_CREATION_RPC_V1,
  CampaignConflictError,
  CampaignInputError,
  CampaignUnavailableError,
  GET_CAMPAIGN_ALLOCATION_OVERRIDES_RPC_V1,
  GET_INTERVIEW_CAMPAIGNS_RPC_V1,
  PREVIEW_CAMPAIGN_ALLOCATION_OVERRIDE_RPC_V1,
  PREVIEW_CAMPAIGN_LIFECYCLE_COORDINATION_RPC_V1,
  PREVIEW_INTERVIEW_CAMPAIGN_CREATION_RPC_V1,
  PREVIEW_INTERVIEW_CAMPAIGN_DEADLINE_CHANGE_RPC_V1,
  PREVIEW_INTERVIEW_CAMPAIGN_LIFECYCLE_RPC_V1,
  PREVIEW_INTERVIEW_CAMPAIGN_RETARGET_RPC_V1,
  applyCampaignAllocationOverrideV1,
  applyCampaignLifecycleCoordinationV1,
  applyInterviewCampaignCreationV1,
  applyInterviewCampaignDeadlineChangeV1,
  applyInterviewCampaignLifecycleV1,
  applyInterviewCampaignRetargetV1,
  loadCampaignAllocationOverridesV1,
  loadInterviewCampaignsV1,
  previewCampaignAllocationOverrideV1,
  previewCampaignLifecycleCoordinationV1,
  previewInterviewCampaignCreationV1,
  previewInterviewCampaignDeadlineChangeV1,
  previewInterviewCampaignLifecycleV1,
  previewInterviewCampaignRetargetV1,
} from "./database-campaigns";

function client(rpc: ReturnType<typeof vi.fn>): PandoSupabaseClient {
  return { rpc } as unknown as PandoSupabaseClient;
}

const creationCommand = {
  readinessGoalKey: creationPreview.readinessGoal.readinessGoalKey,
  expectedReadinessGoalVersion: creationPreview.readinessGoal.aggregateVersion,
  title: creationPreview.after.title,
  deadlineLocalDate: creationPreview.after.deadline.localDate,
  reason: creationPreview.reason,
  idempotencyKey: creationPreview.idempotencyKey,
};

const deadlineCommand = {
  campaignKey: deadlinePreview.before.campaignKey,
  expectedCampaignVersion: deadlinePreview.before.aggregateVersion,
  deadlineLocalDate: deadlinePreview.after.deadline.localDate,
  reason: deadlinePreview.reason,
};

const retargetCommand = {
  campaignKey: retargetPreview.before.campaignKey,
  expectedCampaignVersion: retargetPreview.before.aggregateVersion,
  readinessGoalKey: retargetPreview.after.readinessGoal.readinessGoalKey,
  expectedReadinessGoalVersion: retargetPreview.after.readinessGoal.aggregateVersion,
  reason: retargetPreview.reason,
};

const lifecycleCommand = {
  campaignKey: lifecyclePreview.before.campaignKey,
  operation: lifecyclePreview.operation as "start_campaign",
  expectedCampaignVersion: lifecyclePreview.before.aggregateVersion,
  reason: lifecyclePreview.reason,
};

const idempotencyKey = "10000000-0000-4000-8000-000000000099";

const overrideChangeCommand = {
  overrideKey: overrideChangePreview.before.overrideKey,
  operation: overrideChangePreview.operation as "change_campaign_allocation_override",
  expectedOverrideVersion: overrideChangePreview.before.aggregateVersion,
  priorityOverride: overrideChangePreview.after.priorityOverride,
  protectedMinimumMinutesOverride: overrideChangePreview.after.protectedMinimumMinutesOverride,
  cadencePerWeekOverride: overrideChangePreview.after.cadencePerWeekOverride,
  reason: overrideChangePreview.reason,
};

const coordinationCommand = {
  campaignKey: coordinationPreview.campaign.before.campaignKey,
  operation: coordinationPreview.operation as "start_campaign",
  expectedCampaignVersion: coordinationPreview.campaign.before.aggregateVersion,
  reason: coordinationPreview.reason,
  idempotencyKey: coordinationPreview.idempotencyKey,
  overrides: [
    {
      trackKey: coordinationPreview.overrides.installed[0]!.learningTrack.trackKey,
      expectedTrackVersion:
        coordinationPreview.overrides.installed[0]!.learningTrack.expectedVersion,
      priorityOverride: coordinationPreview.overrides.installed[0]!.priorityOverride,
      protectedMinimumMinutesOverride:
        coordinationPreview.overrides.installed[0]!.protectedMinimumMinutesOverride,
      cadencePerWeekOverride: coordinationPreview.overrides.installed[0]!.cadencePerWeekOverride,
    },
  ],
};

describe("database-campaigns", () => {
  it("loads the session-resolved Interview Campaign list without caller-selected authority", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: campaignsList, error: null });
    await expect(loadInterviewCampaignsV1(client(rpc))).resolves.toEqual(campaignsList);
    expect(rpc).toHaveBeenCalledWith(GET_INTERVIEW_CAMPAIGNS_RPC_V1);
  });

  it("maps a read failure to CampaignUnavailableError", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: "XX000" } });
    await expect(loadInterviewCampaignsV1(client(rpc))).rejects.toThrow(CampaignUnavailableError);
  });

  it("previews and applies creation with only purpose-specific scalar parameters", async () => {
    const previewRpc = vi.fn().mockResolvedValue({ data: creationPreview, error: null });
    await expect(
      previewInterviewCampaignCreationV1(client(previewRpc), creationCommand),
    ).resolves.toEqual(creationPreview);
    expect(previewRpc).toHaveBeenCalledWith(PREVIEW_INTERVIEW_CAMPAIGN_CREATION_RPC_V1, {
      p_readiness_goal_key: creationCommand.readinessGoalKey,
      p_expected_readiness_goal_version: creationCommand.expectedReadinessGoalVersion,
      p_title: creationCommand.title,
      p_deadline_local_date: creationCommand.deadlineLocalDate,
      p_reason: creationCommand.reason,
      p_idempotency_key: creationCommand.idempotencyKey,
    });

    const applyRpc = vi.fn().mockResolvedValue({ data: creationApplyResult, error: null });
    await expect(
      applyInterviewCampaignCreationV1(client(applyRpc), {
        ...creationCommand,
        previewDigest: creationPreview.previewDigest,
      }),
    ).resolves.toEqual(creationApplyResult);
    expect(applyRpc).toHaveBeenCalledWith(
      APPLY_INTERVIEW_CAMPAIGN_CREATION_RPC_V1,
      expect.objectContaining({ p_preview_digest: creationPreview.previewDigest }),
    );
  });

  it("rejects malformed creation inputs before any RPC", async () => {
    const rpc = vi.fn();
    await expect(
      previewInterviewCampaignCreationV1(client(rpc), { ...creationCommand, readinessGoalKey: "" }),
    ).rejects.toThrow(CampaignInputError);
    await expect(
      applyInterviewCampaignCreationV1(client(rpc), {
        ...creationCommand,
        previewDigest: "not-a-digest",
      }),
    ).rejects.toThrow(CampaignInputError);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("previews and applies a deadline change through exact scalar parameters", async () => {
    const previewRpc = vi.fn().mockResolvedValue({ data: deadlinePreview, error: null });
    await expect(
      previewInterviewCampaignDeadlineChangeV1(client(previewRpc), deadlineCommand),
    ).resolves.toEqual(deadlinePreview);
    expect(previewRpc).toHaveBeenCalledWith(PREVIEW_INTERVIEW_CAMPAIGN_DEADLINE_CHANGE_RPC_V1, {
      p_campaign_key: deadlineCommand.campaignKey,
      p_expected_campaign_version: deadlineCommand.expectedCampaignVersion,
      p_deadline_local_date: deadlineCommand.deadlineLocalDate,
      p_reason: deadlineCommand.reason,
    });

    const applyRpc = vi.fn().mockResolvedValue({ data: deadlineApplyResult, error: null });
    await expect(
      applyInterviewCampaignDeadlineChangeV1(client(applyRpc), {
        ...deadlineCommand,
        previewDigest: deadlinePreview.previewDigest,
        idempotencyKey,
      }),
    ).resolves.toEqual(deadlineApplyResult);
  });

  it("rejects malformed deadline inputs and maps a stale-version conflict", async () => {
    const rpc = vi.fn();
    await expect(
      previewInterviewCampaignDeadlineChangeV1(client(rpc), {
        ...deadlineCommand,
        deadlineLocalDate: "not-a-date",
      }),
    ).rejects.toThrow(CampaignInputError);
    expect(rpc).not.toHaveBeenCalled();

    await expect(
      previewInterviewCampaignDeadlineChangeV1(
        client(vi.fn().mockResolvedValue({ data: null, error: { code: "40001" } })),
        deadlineCommand,
      ),
    ).rejects.toThrow(CampaignConflictError);
  });

  it("previews and applies a retarget through exact scalar parameters", async () => {
    const previewRpc = vi.fn().mockResolvedValue({ data: retargetPreview, error: null });
    await expect(
      previewInterviewCampaignRetargetV1(client(previewRpc), retargetCommand),
    ).resolves.toEqual(retargetPreview);
    expect(previewRpc).toHaveBeenCalledWith(PREVIEW_INTERVIEW_CAMPAIGN_RETARGET_RPC_V1, {
      p_campaign_key: retargetCommand.campaignKey,
      p_expected_campaign_version: retargetCommand.expectedCampaignVersion,
      p_readiness_goal_key: retargetCommand.readinessGoalKey,
      p_expected_readiness_goal_version: retargetCommand.expectedReadinessGoalVersion,
      p_reason: retargetCommand.reason,
    });

    const applyRpc = vi.fn().mockResolvedValue({ data: retargetApplyResult, error: null });
    await expect(
      applyInterviewCampaignRetargetV1(client(applyRpc), {
        ...retargetCommand,
        previewDigest: retargetPreview.previewDigest,
        idempotencyKey,
      }),
    ).resolves.toEqual(retargetApplyResult);
  });

  it("rejects malformed retarget selectors and versions before RPC", async () => {
    const rpc = vi.fn();
    await expect(
      previewInterviewCampaignRetargetV1(client(rpc), { ...retargetCommand, campaignKey: "bogus" }),
    ).rejects.toThrow(CampaignInputError);
    await expect(
      previewInterviewCampaignRetargetV1(client(rpc), {
        ...retargetCommand,
        expectedReadinessGoalVersion: "0",
      }),
    ).rejects.toThrow(CampaignInputError);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("previews and applies a lifecycle change through exact scalar parameters", async () => {
    const previewRpc = vi.fn().mockResolvedValue({ data: lifecyclePreview, error: null });
    await expect(
      previewInterviewCampaignLifecycleV1(client(previewRpc), lifecycleCommand),
    ).resolves.toEqual(lifecyclePreview);
    expect(previewRpc).toHaveBeenCalledWith(PREVIEW_INTERVIEW_CAMPAIGN_LIFECYCLE_RPC_V1, {
      p_campaign_key: lifecycleCommand.campaignKey,
      p_operation: lifecycleCommand.operation,
      p_expected_campaign_version: lifecycleCommand.expectedCampaignVersion,
      p_reason: lifecycleCommand.reason,
    });

    const applyRpc = vi.fn().mockResolvedValue({ data: lifecycleApplyResult, error: null });
    await expect(
      applyInterviewCampaignLifecycleV1(client(applyRpc), {
        ...lifecycleCommand,
        previewDigest: lifecyclePreview.previewDigest,
        idempotencyKey,
      }),
    ).resolves.toEqual(lifecycleApplyResult);
  });

  it("rejects an unsupported lifecycle operation before any RPC", async () => {
    const rpc = vi.fn();
    await expect(
      previewInterviewCampaignLifecycleV1(client(rpc), {
        ...lifecycleCommand,
        operation: "delete_campaign" as never,
      }),
    ).rejects.toThrow(CampaignInputError);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("fails closed when a preview response fails its own contract", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { contract: { name: "Unexpected", version: "1.0.0" } },
      error: null,
    });
    await expect(
      previewInterviewCampaignLifecycleV1(client(rpc), lifecycleCommand),
    ).rejects.toThrow(CampaignUnavailableError);
  });

  it("loads a workspace's campaign allocation override history", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: overridesList, error: null });
    await expect(loadCampaignAllocationOverridesV1(client(rpc))).resolves.toEqual(overridesList);
    expect(rpc).toHaveBeenCalledWith(GET_CAMPAIGN_ALLOCATION_OVERRIDES_RPC_V1);
  });

  it("previews and applies an override change through exact scalar parameters", async () => {
    const previewRpc = vi.fn().mockResolvedValue({ data: overrideChangePreview, error: null });
    await expect(
      previewCampaignAllocationOverrideV1(client(previewRpc), overrideChangeCommand),
    ).resolves.toEqual(overrideChangePreview);
    expect(previewRpc).toHaveBeenCalledWith(PREVIEW_CAMPAIGN_ALLOCATION_OVERRIDE_RPC_V1, {
      p_override_key: overrideChangeCommand.overrideKey,
      p_operation: overrideChangeCommand.operation,
      p_expected_override_version: overrideChangeCommand.expectedOverrideVersion,
      p_priority_override: overrideChangeCommand.priorityOverride,
      p_protected_minimum_minutes_override: overrideChangeCommand.protectedMinimumMinutesOverride,
      p_cadence_per_week_override: overrideChangeCommand.cadencePerWeekOverride,
      p_reason: overrideChangeCommand.reason,
    });

    const applyRpc = vi.fn().mockResolvedValue({ data: overrideChangeApplyResult, error: null });
    await expect(
      applyCampaignAllocationOverrideV1(client(applyRpc), {
        ...overrideChangeCommand,
        previewDigest: overrideChangePreview.previewDigest,
        idempotencyKey,
      }),
    ).resolves.toEqual(overrideChangeApplyResult);
    expect(applyRpc).toHaveBeenCalledWith(
      APPLY_CAMPAIGN_ALLOCATION_OVERRIDE_RPC_V1,
      expect.objectContaining({ p_preview_digest: overrideChangePreview.previewDigest }),
    );
  });

  it("rejects malformed override change inputs before any RPC", async () => {
    const rpc = vi.fn();
    await expect(
      previewCampaignAllocationOverrideV1(client(rpc), {
        ...overrideChangeCommand,
        overrideKey: "not-an-override-key",
      }),
    ).rejects.toThrow(CampaignInputError);
    await expect(
      previewCampaignAllocationOverrideV1(client(rpc), {
        ...overrideChangeCommand,
        priorityOverride: 101,
      }),
    ).rejects.toThrow(CampaignInputError);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("previews and applies a campaign lifecycle coordination through the array payload", async () => {
    const previewRpc = vi.fn().mockResolvedValue({ data: coordinationPreview, error: null });
    await expect(
      previewCampaignLifecycleCoordinationV1(client(previewRpc), coordinationCommand),
    ).resolves.toEqual(coordinationPreview);
    expect(previewRpc).toHaveBeenCalledWith(PREVIEW_CAMPAIGN_LIFECYCLE_COORDINATION_RPC_V1, {
      p_campaign_key: coordinationCommand.campaignKey,
      p_operation: coordinationCommand.operation,
      p_expected_campaign_version: coordinationCommand.expectedCampaignVersion,
      p_reason: coordinationCommand.reason,
      p_overrides: [
        {
          trackKey: coordinationCommand.overrides[0]!.trackKey,
          expectedTrackVersion: coordinationCommand.overrides[0]!.expectedTrackVersion,
          priorityOverride: coordinationCommand.overrides[0]!.priorityOverride,
          protectedMinimumMinutesOverride:
            coordinationCommand.overrides[0]!.protectedMinimumMinutesOverride,
          cadencePerWeekOverride: coordinationCommand.overrides[0]!.cadencePerWeekOverride,
        },
      ],
      p_idempotency_key: coordinationCommand.idempotencyKey,
    });

    const applyRpc = vi.fn().mockResolvedValue({ data: coordinationApplyResult, error: null });
    await expect(
      applyCampaignLifecycleCoordinationV1(client(applyRpc), {
        ...coordinationCommand,
        previewDigest: coordinationPreview.previewDigest,
      }),
    ).resolves.toEqual(coordinationApplyResult);
    expect(applyRpc).toHaveBeenCalledWith(
      APPLY_CAMPAIGN_LIFECYCLE_COORDINATION_RPC_V1,
      expect.objectContaining({ p_preview_digest: coordinationPreview.previewDigest }),
    );
  });

  it("rejects coordination overrides for end_campaign/cancel_campaign before any RPC", async () => {
    const rpc = vi.fn();
    await expect(
      previewCampaignLifecycleCoordinationV1(client(rpc), {
        ...coordinationCommand,
        operation: "end_campaign",
      }),
    ).rejects.toThrow(CampaignInputError);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a duplicate Track across coordination override intents before any RPC", async () => {
    const rpc = vi.fn();
    await expect(
      previewCampaignLifecycleCoordinationV1(client(rpc), {
        ...coordinationCommand,
        overrides: [coordinationCommand.overrides[0]!, coordinationCommand.overrides[0]!],
      }),
    ).rejects.toThrow(CampaignInputError);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects every malformed override change field independently", async () => {
    const rpc = vi.fn();
    await expect(
      previewCampaignAllocationOverrideV1(client(rpc), {
        ...overrideChangeCommand,
        operation: "delete_campaign_allocation_override" as never,
      }),
    ).rejects.toThrow(CampaignInputError);
    await expect(
      previewCampaignAllocationOverrideV1(client(rpc), {
        ...overrideChangeCommand,
        expectedOverrideVersion: "0",
      }),
    ).rejects.toThrow(CampaignInputError);
    await expect(
      previewCampaignAllocationOverrideV1(client(rpc), {
        ...overrideChangeCommand,
        protectedMinimumMinutesOverride: 10_081,
      }),
    ).rejects.toThrow(CampaignInputError);
    await expect(
      previewCampaignAllocationOverrideV1(client(rpc), {
        ...overrideChangeCommand,
        cadencePerWeekOverride: -1,
      }),
    ).rejects.toThrow(CampaignInputError);
    await expect(
      previewCampaignAllocationOverrideV1(client(rpc), {
        ...overrideChangeCommand,
        reason: "",
      }),
    ).rejects.toThrow(CampaignInputError);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("accepts a null override field and rejects a malformed apply digest", async () => {
    const previewRpc = vi.fn().mockResolvedValue({ data: overrideChangePreview, error: null });
    await expect(
      previewCampaignAllocationOverrideV1(client(previewRpc), {
        ...overrideChangeCommand,
        priorityOverride: null,
      }),
    ).resolves.toEqual(overrideChangePreview);
    const applyRpc = vi.fn();
    await expect(
      applyCampaignAllocationOverrideV1(client(applyRpc), {
        ...overrideChangeCommand,
        previewDigest: "not-a-digest",
        idempotencyKey,
      }),
    ).rejects.toThrow(CampaignInputError);
    expect(applyRpc).not.toHaveBeenCalled();
  });

  it("rejects malformed coordination requests independently of the override array", async () => {
    const rpc = vi.fn();
    await expect(
      previewCampaignLifecycleCoordinationV1(client(rpc), {
        ...coordinationCommand,
        campaignKey: "bogus",
      }),
    ).rejects.toThrow(CampaignInputError);
    await expect(
      previewCampaignLifecycleCoordinationV1(client(rpc), {
        ...coordinationCommand,
        operation: "delete_campaign" as never,
      }),
    ).rejects.toThrow(CampaignInputError);
    await expect(
      previewCampaignLifecycleCoordinationV1(client(rpc), {
        ...coordinationCommand,
        idempotencyKey: "not-a-uuid",
      }),
    ).rejects.toThrow(CampaignInputError);
    await expect(
      applyCampaignLifecycleCoordinationV1(client(rpc), {
        ...coordinationCommand,
        previewDigest: "not-a-digest",
      }),
    ).rejects.toThrow(CampaignInputError);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects more than the maximum coordination override intents", async () => {
    const rpc = vi.fn();
    const overrides = Array.from({ length: 21 }, (_, index) => ({
      trackKey: `track:backend-${index}`,
      expectedTrackVersion: "2",
      priorityOverride: 50,
      protectedMinimumMinutesOverride: null,
      cadencePerWeekOverride: null,
    }));
    await expect(
      previewCampaignLifecycleCoordinationV1(client(rpc), { ...coordinationCommand, overrides }),
    ).rejects.toThrow(CampaignInputError);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a coordination override intent with an out-of-range field or no field at all", async () => {
    const rpc = vi.fn();
    await expect(
      previewCampaignLifecycleCoordinationV1(client(rpc), {
        ...coordinationCommand,
        overrides: [
          {
            ...coordinationCommand.overrides[0]!,
            priorityOverride: null,
            protectedMinimumMinutesOverride: null,
            cadencePerWeekOverride: null,
          },
        ],
      }),
    ).rejects.toThrow(CampaignInputError);
    await expect(
      previewCampaignLifecycleCoordinationV1(client(rpc), {
        ...coordinationCommand,
        overrides: [{ ...coordinationCommand.overrides[0]!, priorityOverride: 101 }],
      }),
    ).rejects.toThrow(CampaignInputError);
    expect(rpc).not.toHaveBeenCalled();
  });
});
