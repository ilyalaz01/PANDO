// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import type { PandoSupabaseClient } from "../../../shared/supabase/database";
import {
  FINISH_FOCUS_ACTIVITY_RPC_V1,
  FocusConflictError,
  FocusInputError,
  FocusUnavailableError,
  GET_FOCUS_FROM_PLAN_RPC_V1,
  GET_FOCUS_WORKSPACE_RPC_V1,
  INVALIDATE_EVIDENCE_RPC_V1,
  START_FOCUS_ACTIVITY_RPC_V1,
  finishFocusActivityV1,
  invalidateEvidenceV1,
  loadFocusFromPlanWorkspaceV1,
  loadFocusWorkspaceV1,
  startFocusActivityV1,
} from "./database-focus-workspace";

const commandId = "10000000-0000-4000-8000-000000000001";
const sessionId = "10000000-0000-4000-8000-000000000002";
const evidenceId = "20000000-0000-4000-8000-000000000001";
const eventId = "30000000-0000-4000-8000-000000000001";
const selectionRef = "plan-action:40000000-0000-4000-8000-000000000001";

function client(rpc: ReturnType<typeof vi.fn>): PandoSupabaseClient {
  return { rpc } as unknown as PandoSupabaseClient;
}

function workspace() {
  return {
    contract: { name: "FocusWorkspaceV1", version: "1.0.0" },
    readinessGoalKey: "goal:personal-main",
    activity: {
      activityKey: "activity:typing-practice",
      title: "Typing practice",
      activityType: "MANUAL_CODING",
      competencyRef: "competency:python-typing",
      evidenceDimension: "APPLICATION",
      expectedEvidence: "Produce a working result.",
      resourceUrl: null,
    },
    activeSession: null,
    history: [],
    masteryState: null,
    projectionState: "not_started",
  };
}

describe("Focus database boundary", () => {
  it("loads a plan-selected Focus view with only the opaque selector", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        contract: { name: "FocusFromPlanWorkspaceV1", version: "1.0.0" },
        selectionRef,
        entryState: "READY_TO_START",
        plannedMinutes: 45,
        workspace: workspace(),
      },
      error: null,
    });
    await expect(loadFocusFromPlanWorkspaceV1(client(rpc), selectionRef)).resolves.toMatchObject({
      entryState: "READY_TO_START",
      plannedMinutes: 45,
      workspace: { activity: { activityKey: "activity:typing-practice" } },
    });
    expect(rpc).toHaveBeenCalledWith(GET_FOCUS_FROM_PLAN_RPC_V1, {
      p_selection_ref: selectionRef,
    });
    expect(rpc.mock.calls[0]?.[1]).not.toHaveProperty("p_workspace_id");
    expect(rpc.mock.calls[0]?.[1]).not.toHaveProperty("p_activity_key");
  });

  it("rejects malformed, mismatched, and authority-bearing plan responses", async () => {
    const rpc = vi.fn();
    await expect(
      loadFocusFromPlanWorkspaceV1(client(rpc), "plan-action:not-valid"),
    ).rejects.toThrow(FocusInputError);
    expect(rpc).not.toHaveBeenCalled();

    rpc.mockResolvedValueOnce({
      data: {
        contract: { name: "FocusFromPlanWorkspaceV1", version: "1.0.0" },
        selectionRef: "plan-action:40000000-0000-4000-8000-000000000002",
        entryState: "READY_TO_START",
        plannedMinutes: 45,
        workspace: workspace(),
      },
      error: null,
    });
    await expect(loadFocusFromPlanWorkspaceV1(client(rpc), selectionRef)).rejects.toThrow(
      FocusUnavailableError,
    );

    rpc.mockResolvedValueOnce({
      data: {
        contract: { name: "FocusFromPlanWorkspaceV1", version: "1.0.0" },
        selectionRef,
        entryState: "READY_TO_START",
        plannedMinutes: 45,
        workspace: workspace(),
        planSnapshotId: "attacker-visible-authority",
      },
      error: null,
    });
    await expect(loadFocusFromPlanWorkspaceV1(client(rpc), selectionRef)).rejects.toThrow(
      FocusUnavailableError,
    );
  });

  it("requires an exact active Focus projection for plan continuity", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        contract: { name: "FocusFromPlanWorkspaceV1", version: "1.0.0" },
        selectionRef,
        entryState: "ACTIVE",
        plannedMinutes: 45,
        workspace: workspace(),
      },
      error: null,
    });
    await expect(loadFocusFromPlanWorkspaceV1(client(rpc), selectionRef)).rejects.toThrow(
      FocusUnavailableError,
    );
  });

  it("loads a current-personal Focus DTO without caller-selected authority fields", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: workspace(), error: null });
    await expect(
      loadFocusWorkspaceV1(client(rpc), {
        readinessGoalKey: "goal:personal-main",
        activityKey: "activity:typing-practice",
      }),
    ).resolves.toMatchObject({ activity: { title: "Typing practice" } });
    expect(rpc).toHaveBeenCalledWith(GET_FOCUS_WORKSPACE_RPC_V1, {
      p_readiness_goal_key: "goal:personal-main",
      p_activity_key: "activity:typing-practice",
    });
    expect(rpc.mock.calls[0]?.[1]).not.toHaveProperty("p_workspace_id");
  });

  it("validates read selectors and response correlation", async () => {
    const rpc = vi.fn();
    await expect(
      loadFocusWorkspaceV1(client(rpc), { readinessGoalKey: "goal:<bad>", activityKey: null }),
    ).rejects.toThrow(FocusInputError);
    expect(rpc).not.toHaveBeenCalled();

    rpc.mockResolvedValue({
      data: { ...workspace(), readinessGoalKey: "goal:other" },
      error: null,
    });
    await expect(
      loadFocusWorkspaceV1(client(rpc), {
        readinessGoalKey: "goal:personal-main",
        activityKey: "activity:typing-practice",
      }),
    ).rejects.toThrow(FocusUnavailableError);
  });

  it("starts with a bounded duration and retry-stable key", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        commandId,
        focusSessionId: sessionId,
        state: "active",
        sessionVersion: "1",
        emittedEventIds: [eventId],
      },
      error: null,
    });
    await expect(
      startFocusActivityV1(client(rpc), {
        readinessGoalKey: "goal:personal-main",
        activityKey: "activity:typing-practice",
        plannedMinutes: 25,
        idempotencyKey: "focus-start:v1:request",
      }),
    ).resolves.toMatchObject({ state: "active", focusSessionId: sessionId });
    expect(rpc).toHaveBeenCalledWith(START_FOCUS_ACTIVITY_RPC_V1, {
      p_readiness_goal_key: "goal:personal-main",
      p_activity_key: "activity:typing-practice",
      p_planned_minutes: 25,
      p_idempotency_key: "focus-start:v1:request",
    });
  });

  it("completes with explicit evidence facts and stops with null result facts", async () => {
    const rpc = vi.fn().mockResolvedValueOnce({
      data: {
        commandId,
        focusSessionId: sessionId,
        state: "completed",
        sessionVersion: "2",
        evidenceId,
        projectionState: "pending",
        emittedEventIds: [eventId, "30000000-0000-4000-8000-000000000002"],
      },
      error: null,
    });
    await expect(
      finishFocusActivityV1(client(rpc), {
        focusSessionId: sessionId,
        expectedVersion: 1,
        terminalAction: "COMPLETE",
        resultKind: "OBSERVED_SUCCESS",
        usedHint: false,
        idempotencyKey: "focus-finish:v1:request",
      }),
    ).resolves.toMatchObject({ evidenceId, projectionState: "pending" });

    rpc.mockResolvedValueOnce({
      data: {
        commandId,
        focusSessionId: sessionId,
        state: "stopped",
        sessionVersion: "2",
        evidenceId: null,
        projectionState: "not_applicable",
        emittedEventIds: [eventId],
      },
      error: null,
    });
    await expect(
      finishFocusActivityV1(client(rpc), {
        focusSessionId: sessionId,
        expectedVersion: 1,
        terminalAction: "STOP",
        resultKind: null,
        usedHint: null,
        idempotencyKey: "focus-stop:v1:request",
      }),
    ).resolves.toMatchObject({ state: "stopped", evidenceId: null });
    expect(rpc).toHaveBeenLastCalledWith(
      FINISH_FOCUS_ACTIVITY_RPC_V1,
      expect.objectContaining({ p_result_kind: null, p_used_hint: null }),
    );
  });

  it("rejects inconsistent command combinations before RPC", async () => {
    const rpc = vi.fn();
    await expect(
      finishFocusActivityV1(client(rpc), {
        focusSessionId: sessionId,
        expectedVersion: 1,
        terminalAction: "STOP",
        resultKind: "OBSERVED_SUCCESS",
        usedHint: false,
        idempotencyKey: "bad-combination",
      }),
    ).rejects.toThrow(FocusInputError);
    await expect(
      startFocusActivityV1(client(rpc), {
        readinessGoalKey: "goal:personal-main",
        activityKey: "activity:typing-practice",
        plannedMinutes: 0,
        idempotencyKey: "bad-duration",
      }),
    ).rejects.toThrow(FocusInputError);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("invalidates evidence through the narrow correction command", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        commandId,
        correctionId: "40000000-0000-4000-8000-000000000001",
        evidenceId,
        ledgerWatermark: "2",
        projectionState: "pending",
        emittedEventIds: [eventId],
      },
      error: null,
    });
    await expect(
      invalidateEvidenceV1(client(rpc), {
        evidenceId,
        reason: "The result was recorded incorrectly.",
        idempotencyKey: "evidence-invalidate:v1:request",
      }),
    ).resolves.toMatchObject({ evidenceId, ledgerWatermark: "2" });
    expect(rpc).toHaveBeenCalledWith(INVALIDATE_EVIDENCE_RPC_V1, {
      p_evidence_id: evidenceId,
      p_reason: "The result was recorded incorrectly.",
      p_idempotency_key: "evidence-invalidate:v1:request",
    });
  });

  it("maps conflicts and collapses private failures", async () => {
    const conflict = client(vi.fn().mockResolvedValue({ data: null, error: { code: "40001" } }));
    await expect(
      startFocusActivityV1(conflict, {
        readinessGoalKey: "goal:personal-main",
        activityKey: "activity:typing-practice",
        plannedMinutes: 25,
        idempotencyKey: "focus-conflict",
      }),
    ).rejects.toThrow(FocusConflictError);

    const unavailable = client(vi.fn().mockRejectedValue(new Error("private database detail")));
    const error = await loadFocusWorkspaceV1(unavailable, {
      readinessGoalKey: "goal:personal-main",
      activityKey: null,
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(FocusUnavailableError);
    expect(String(error)).not.toContain("database detail");
  });
});
