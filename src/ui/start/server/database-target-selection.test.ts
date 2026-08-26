// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import type { PandoSupabaseClient } from "../../../shared/supabase/database";
import {
  BOOTSTRAP_PERSONAL_WORKSPACE_RPC,
  CREATE_READINESS_GOAL_RPC,
  deriveReadinessGoalCommand,
  ensurePersonalWorkspace,
  loadTargetSelectionSourceV1,
  selectTargetProfile,
  TARGET_SELECTION_SOURCE_RPC_V1,
  TargetSelectionInputError,
  TargetSelectionUnavailableError,
} from "./database-target-selection";

const workspaceId = "20000000-0000-4000-8000-000000000001";
const subject = "10000000-0000-4000-8000-000000000001";
const profileVersionKey = "target:nvidia-python-verification-base-v1";
const readinessGoalKey = "goal:nvidia-python-verification-base-v1";

function source({ workspace = true, goal = false } = {}) {
  return {
    contract: { name: "TargetSelectionSourceV1", version: "1.0.0" },
    workspace: workspace
      ? {
          workspaceId,
          workspaceKind: "personal",
          displayName: "Personal workspace",
          membershipRole: "owner",
        }
      : null,
    profiles: workspace
      ? [
          {
            profileVersionKey,
            profileSeriesKey: "target-series:nvidia-python-verification-base",
            scope: "canonical",
            roleTitle: "Python and Verification Interview Readiness",
            companyName: "NVIDIA",
            versionNumber: 1,
            baseProfileVersionKey: null,
            catalogVersionKey: "catalog:seed-v1",
            roadmapVersionKey: "roadmap:nvidia-python-verification-v1",
            sourceSummary: "Initial product fixture assumptions.",
            freshnessStatus: "initial_curated_assumption",
            reviewedAt: "2026-08-26",
          },
        ]
      : [],
    readinessGoals:
      workspace && goal
        ? [
            {
              readinessGoalKey,
              title: "Python and Verification Interview Readiness",
              profileVersionKey,
              profileRoleTitle: "Python and Verification Interview Readiness",
              lifecycle: "active",
              aggregateVersion: "1",
            },
          ]
        : [],
  };
}

function fakeClient(rpc: ReturnType<typeof vi.fn>): PandoSupabaseClient {
  return { rpc } as unknown as PandoSupabaseClient;
}

describe("database target-selection boundary", () => {
  it("calls the zero-argument source RPC and decodes a plain DTO", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: source(), error: null });
    const decoded = await loadTargetSelectionSourceV1(fakeClient(rpc));
    expect(rpc).toHaveBeenCalledWith(TARGET_SELECTION_SOURCE_RPC_V1);
    expect(decoded.workspace?.workspaceId).toBe(workspaceId);
    expect(decoded.profiles[0]?.freshnessStatus).toBe("initial_curated_assumption");
  });

  it("collapses thrown and returned RPC details into one safe error", async () => {
    const thrown = fakeClient(vi.fn().mockRejectedValue(new Error("JWT detail")));
    const returned = fakeClient(
      vi.fn().mockResolvedValue({ data: null, error: { message: "SQL detail" } }),
    );
    for (const client of [thrown, returned]) {
      const error = await loadTargetSelectionSourceV1(client).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(TargetSelectionUnavailableError);
      expect(String(error)).not.toMatch(/JWT|SQL/u);
    }
  });

  it("reuses an existing workspace without issuing a bootstrap command", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: source(), error: null });
    await expect(ensurePersonalWorkspace(fakeClient(rpc), subject)).resolves.toMatchObject({
      workspace: { workspaceId },
    });
    expect(rpc).toHaveBeenCalledOnce();
  });

  it("bootstraps once with a server-derived actor key and reloads the source", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: source({ workspace: false }), error: null })
      .mockResolvedValueOnce({
        data: {
          command_id: "40000000-0000-4000-8000-000000000001",
          workspace_id: workspaceId,
          workspace_name: "Personal workspace",
          membership_role: "owner",
          emitted_event_ids: ["50000000-0000-4000-8000-000000000001"],
        },
        error: null,
      })
      .mockResolvedValueOnce({ data: source(), error: null });

    await ensurePersonalWorkspace(fakeClient(rpc), subject);
    expect(rpc).toHaveBeenNthCalledWith(2, BOOTSTRAP_PERSONAL_WORKSPACE_RPC, {
      p_idempotency_key: `workspace-bootstrap-v1:${subject}`,
      p_workspace_name: "Personal workspace",
    });
    expect(rpc).toHaveBeenCalledTimes(3);
  });

  it("does not issue bootstrap for a malformed subject", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: source({ workspace: false }), error: null });
    await expect(ensurePersonalWorkspace(fakeClient(rpc), "not-a-subject")).rejects.toThrow(
      TargetSelectionUnavailableError,
    );
    expect(rpc).toHaveBeenCalledOnce();
  });

  it("derives bounded stable goal identifiers entirely on the server", () => {
    expect(
      deriveReadinessGoalCommand(profileVersionKey, "Python and Verification Interview Readiness"),
    ).toEqual({
      readinessGoalKey,
      title: "Python and Verification Interview Readiness",
      profileVersionKey,
      idempotencyKey: `target-select-v1:${profileVersionKey}`,
    });
    expect(() => deriveReadinessGoalCommand("target:<script>", "Safe title")).toThrow(
      TargetSelectionInputError,
    );
    expect(() => deriveReadinessGoalCommand(profileVersionKey, " unsafe title ")).toThrow(
      TargetSelectionInputError,
    );
    expect(() => deriveReadinessGoalCommand(profileVersionKey, "unsafe <title>")).toThrow(
      TargetSelectionInputError,
    );
  });

  it("rejects malformed or unavailable profile keys before mutation", async () => {
    const malformedRpc = vi.fn();
    await expect(selectTargetProfile(fakeClient(malformedRpc), "target:<script>")).rejects.toThrow(
      TargetSelectionInputError,
    );
    expect(malformedRpc).not.toHaveBeenCalled();

    const unavailableRpc = vi.fn().mockResolvedValue({ data: source(), error: null });
    await expect(
      selectTargetProfile(fakeClient(unavailableRpc), "target:well-formed-but-missing"),
    ).rejects.toThrow(TargetSelectionInputError);
    expect(unavailableRpc).toHaveBeenCalledOnce();
  });

  it("returns an existing goal without creating a duplicate", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: source({ goal: true }), error: null });
    await expect(selectTargetProfile(fakeClient(rpc), profileVersionKey)).resolves.toMatchObject({
      readinessGoalKey,
      profileVersionKey,
    });
    expect(rpc).toHaveBeenCalledOnce();
  });

  it("ignores unrelated historical goals for the same profile and creates the derived goal", async () => {
    const firstSource = source();
    const historicalGoal = {
      readinessGoalKey: "goal:aaa-history",
      title: "Historical goal",
      profileVersionKey,
      profileRoleTitle: "Python and Verification Interview Readiness",
      lifecycle: "archived",
      aggregateVersion: "2",
    };
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: { ...firstSource, readinessGoals: [historicalGoal] },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          commandId: "60000000-0000-4000-8000-000000000001",
          workspaceId,
          readinessGoalId: "30000000-0000-4000-8000-000000000001",
          readinessGoalKey,
          profileVersionKey,
          aggregateVersion: 1,
          emittedEventIds: ["70000000-0000-4000-8000-000000000001"],
        },
        error: null,
      })
      .mockResolvedValueOnce({ data: source({ goal: true }), error: null });

    await expect(selectTargetProfile(fakeClient(rpc), profileVersionKey)).resolves.toMatchObject({
      readinessGoalKey,
    });
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      CREATE_READINESS_GOAL_RPC,
      expect.objectContaining({ p_readiness_goal_key: readinessGoalKey }),
    );
  });

  it("does not silently reactivate an exact archived goal", async () => {
    const current = source({ goal: true });
    const rpc = vi.fn().mockResolvedValue({
      data: {
        ...current,
        readinessGoals: current.readinessGoals.map((goal) => ({
          ...goal,
          lifecycle: "archived",
        })),
      },
      error: null,
    });

    await expect(selectTargetProfile(fakeClient(rpc), profileVersionKey)).rejects.toThrow(
      TargetSelectionInputError,
    );
    expect(rpc).toHaveBeenCalledOnce();
  });

  it("creates an exact-version goal and verifies it through a fresh owner read", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: source(), error: null })
      .mockResolvedValueOnce({
        data: {
          commandId: "60000000-0000-4000-8000-000000000001",
          workspaceId,
          readinessGoalId: "30000000-0000-4000-8000-000000000001",
          readinessGoalKey,
          profileVersionKey,
          aggregateVersion: 1,
          emittedEventIds: ["70000000-0000-4000-8000-000000000001"],
        },
        error: null,
      })
      .mockResolvedValueOnce({ data: source({ goal: true }), error: null });

    const goal = await selectTargetProfile(fakeClient(rpc), profileVersionKey);
    expect(goal.readinessGoalKey).toBe(readinessGoalKey);
    expect(rpc).toHaveBeenNthCalledWith(2, CREATE_READINESS_GOAL_RPC, {
      p_workspace_id: workspaceId,
      p_readiness_goal_key: readinessGoalKey,
      p_title: "Python and Verification Interview Readiness",
      p_profile_version_key: profileVersionKey,
      p_idempotency_key: `target-select-v1:${profileVersionKey}`,
    });
    expect(rpc).toHaveBeenCalledTimes(3);
  });

  it("fails closed when a successful command response changes its bound workspace", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: source(), error: null })
      .mockResolvedValueOnce({
        data: {
          commandId: "60000000-0000-4000-8000-000000000001",
          workspaceId: "90000000-0000-4000-8000-000000000009",
          readinessGoalId: "30000000-0000-4000-8000-000000000001",
          readinessGoalKey,
          profileVersionKey,
          aggregateVersion: 1,
          emittedEventIds: ["70000000-0000-4000-8000-000000000001"],
        },
        error: null,
      });
    await expect(selectTargetProfile(fakeClient(rpc), profileVersionKey)).rejects.toThrow(
      TargetSelectionUnavailableError,
    );
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});
