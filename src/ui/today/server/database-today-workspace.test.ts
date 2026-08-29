// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import fixture from "../../../../tests/contract/fixtures/planning/v1/today-workspace.boundary.json";
import type { PandoSupabaseClient } from "../../../shared/supabase/database";
import {
  GET_TODAY_WORKSPACE_RPC_V1,
  START_FOCUS_FROM_PLAN_RPC_V1,
  TodayConflictError,
  TodayInputError,
  TodayUnavailableError,
  loadTodayWorkspaceV1,
  startFocusFromPlanV1,
} from "./database-today-workspace";

const selectionRef = "plan-action:10000000-0000-4000-8000-000000000001";
const commandId = "20000000-0000-4000-8000-000000000001";
const sessionId = "30000000-0000-4000-8000-000000000001";
const attemptId = "40000000-0000-4000-8000-000000000001";
const snapshotId = "50000000-0000-4000-8000-000000000001";
const eventId = "60000000-0000-4000-8000-000000000001";

function client(rpc: ReturnType<typeof vi.fn>): PandoSupabaseClient {
  return { rpc } as unknown as PandoSupabaseClient;
}

function startResponse() {
  return {
    commandId,
    focusSessionId: sessionId,
    activityAttemptId: attemptId,
    sessionVersion: "1",
    state: "active",
    startedAt: "2026-08-29T12:00:00.000Z",
    planAttribution: {
      planSnapshotId: snapshotId,
      candidateKey: "candidate:typing-practice",
      trackId: null,
    },
    emittedEventIds: [eventId],
  };
}

describe("Today database boundary", () => {
  it("loads Today through the zero-argument current-personal query", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: fixture, error: null });
    await expect(loadTodayWorkspaceV1(client(rpc))).resolves.toEqual(fixture);
    expect(rpc).toHaveBeenCalledWith(GET_TODAY_WORKSPACE_RPC_V1);
  });

  it("starts Focus with only the opaque selector and retry-stable key", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: startResponse(), error: null });
    await expect(
      startFocusFromPlanV1(client(rpc), {
        selectionRef,
        idempotencyKey: "today-start:v1:request",
      }),
    ).resolves.toMatchObject({ focusSessionId: sessionId, state: "active" });
    expect(rpc).toHaveBeenCalledWith(START_FOCUS_FROM_PLAN_RPC_V1, {
      p_selection_ref: selectionRef,
      p_idempotency_key: "today-start:v1:request",
    });
    expect(rpc.mock.calls[0]?.[1]).not.toHaveProperty("p_workspace_id");
    expect(rpc.mock.calls[0]?.[1]).not.toHaveProperty("p_activity_key");
  });

  it("rejects malformed selectors before RPC", async () => {
    const rpc = vi.fn();
    await expect(
      startFocusFromPlanV1(client(rpc), {
        selectionRef: "plan-action:not-a-selector",
        idempotencyKey: "today-start:v1:request",
      }),
    ).rejects.toThrow(TodayInputError);
    await expect(
      startFocusFromPlanV1(client(rpc), {
        selectionRef,
        idempotencyKey: " ",
      }),
    ).rejects.toThrow(TodayInputError);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects private or malformed command response fields", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { ...startResponse(), workspaceId: "private" },
      error: null,
    });
    await expect(
      startFocusFromPlanV1(client(rpc), {
        selectionRef,
        idempotencyKey: "today-start:v1:request",
      }),
    ).rejects.toThrow(TodayUnavailableError);
  });

  it("maps retry conflicts and collapses private failures", async () => {
    const conflict = client(
      vi.fn().mockResolvedValue({ data: null, error: { code: "40001", message: "private" } }),
    );
    await expect(
      startFocusFromPlanV1(conflict, { selectionRef, idempotencyKey: "today-conflict" }),
    ).rejects.toThrow(TodayConflictError);

    const invalid = client(vi.fn().mockResolvedValue({ data: null, error: { code: "22023" } }));
    await expect(
      startFocusFromPlanV1(invalid, { selectionRef, idempotencyKey: "today-invalid" }),
    ).rejects.toThrow(TodayInputError);

    const unavailable = client(vi.fn().mockRejectedValue(new Error("private database detail")));
    const error = await loadTodayWorkspaceV1(unavailable).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TodayUnavailableError);
    expect(String(error)).not.toContain("database detail");

    await expect(
      loadTodayWorkspaceV1(
        client(vi.fn().mockResolvedValue({ data: null, error: { code: "42501" } })),
      ),
    ).rejects.toThrow(TodayUnavailableError);

    await expect(
      loadTodayWorkspaceV1(
        client(vi.fn().mockResolvedValue({ data: { contract: {} }, error: null })),
      ),
    ).rejects.toThrow(TodayUnavailableError);
  });
});
