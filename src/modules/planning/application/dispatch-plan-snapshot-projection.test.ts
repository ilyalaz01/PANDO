// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import type { PandoSupabaseClient } from "../../../shared/supabase/database";
import { assemblePlanSnapshotInput } from "./assemble-plan-snapshot-input";
import { dispatchPlanSnapshotProjection } from "./dispatch-plan-snapshot-projection";

const deliveryId = "10000000-0000-4000-8000-000000000001";
const workspaceId = "20000000-0000-4000-8000-000000000001";
const leaseToken = "30000000-0000-4000-8000-000000000001";
const attemptId = "40000000-0000-4000-8000-000000000001";

function claim() {
  return {
    delivery_id: deliveryId,
    event_id: "50000000-0000-4000-8000-000000000001",
    event_position: 9,
    workspace_id: workspaceId,
    lease_token: leaseToken,
    lease_expires_at: "2026-09-01T12:02:00.000Z",
    attempt_count: 1,
    attempt_id: attemptId,
    generation: 1,
    claim_as_of: "2026-09-01T12:00:00.000Z",
  };
}

function sourceBundle(terminalCount = 0) {
  return {
    claimAsOf: "2026-09-01T12:00:00.000Z",
    sourceFence: `planning-source:${"a".repeat(64)}`,
    calendar: {
      timeZone: "UTC",
      weekStart: "2026-08-31T00:00:00.000Z",
      weekEnd: "2026-09-07T00:00:00.000Z",
      validUntil: "2026-09-06T23:59:59.999Z",
      fence: "identity-calendar:UTC",
    },
    plan: null,
    targets: { items: [] },
    overlay: { revision: "workspace-overlay:0", items: [] },
    catalog: { versions: [], items: [] },
    focus: {
      revision: `focus-scope:${"b".repeat(64)}`,
      terminalCount,
      activeFocus: null,
    },
    mastery: { revision: `mastery-scope:${"c".repeat(64)}` },
    review: {
      revision: `review-scope:${"d".repeat(64)}`,
      projectionState: "NOT_STARTED",
      overdueCount: 0,
      dueTodayCount: 0,
      validUntil: null,
      items: [],
    },
    visibleDeliveryIds: [deliveryId],
  };
}

function client(handler: ReturnType<typeof vi.fn>): PandoSupabaseClient {
  return { rpc: handler } as unknown as PandoSupabaseClient;
}

describe("Planning snapshot dispatcher", () => {
  it("persists the normalized input before calculation and applies the verified snapshot", async () => {
    const rpc = vi.fn(async (name: string, parameters?: unknown) => {
      void parameters;
      if (name === "claim_plan_snapshot_projection_v1") return { data: [claim()], error: null };
      if (name === "load_plan_snapshot_projection_v1") {
        return {
          data: {
            attemptId,
            generation: 1,
            claimAsOf: "2026-09-01T12:00:00.000Z",
            sourceFence: `planning-source:${"a".repeat(64)}`,
            sourceBundle: sourceBundle(),
            storedInput: null,
          },
          error: null,
        };
      }
      if (name === "record_plan_snapshot_input_v1") return { data: true, error: null };
      if (name === "complete_plan_snapshot_projection_v1") return { data: "APPLIED", error: null };
      throw new Error(`unexpected ${name}`);
    });
    await expect(dispatchPlanSnapshotProjection(client(rpc))).resolves.toEqual({
      configured: true,
      claimed: 1,
      completed: 1,
      retried: 0,
      deadLettered: 0,
      superseded: 0,
    });
    const record = rpc.mock.calls.find(([name]) => name === "record_plan_snapshot_input_v1");
    const complete = rpc.mock.calls.find(
      ([name]) => name === "complete_plan_snapshot_projection_v1",
    );
    expect(record?.[1]).toMatchObject({
      p_attempt_id: attemptId,
      p_input: {
        evaluationHorizon: { asOf: "2026-09-01T12:00:00.000Z" },
        growthPlan: null,
      },
    });
    expect(complete?.[1]).toMatchObject({
      p_attempt_id: attemptId,
      p_result: { recommendationState: "NO_PLAN", actions: [] },
    });
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "claim_plan_snapshot_projection_v1",
      "load_plan_snapshot_projection_v1",
      "record_plan_snapshot_input_v1",
      "complete_plan_snapshot_projection_v1",
    ]);
  });

  it("dead-letters unsupported historical work instead of fabricating consumed minutes", async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === "claim_plan_snapshot_projection_v1") return { data: [claim()], error: null };
      if (name === "load_plan_snapshot_projection_v1") {
        return {
          data: {
            attemptId,
            sourceFence: `planning-source:${"a".repeat(64)}`,
            sourceBundle: sourceBundle(1),
            storedInput: null,
          },
          error: null,
        };
      }
      if (name === "fail_plan_snapshot_projection_v1") return { data: "dead_letter", error: null };
      throw new Error(`unexpected ${name}`);
    });
    await expect(dispatchPlanSnapshotProjection(client(rpc))).resolves.toEqual({
      configured: true,
      claimed: 1,
      completed: 0,
      retried: 0,
      deadLettered: 1,
      superseded: 0,
    });
    expect(rpc).toHaveBeenCalledWith(
      "fail_plan_snapshot_projection_v1",
      expect.objectContaining({
        p_failure_class: "INVALID_CONTRACT",
        p_error_code: "UNSUPPORTED_MEANINGFUL_WORK_HISTORY",
      }),
    );
  });

  it("bounds claims and rejects two concurrent claims for one workspace", async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === "claim_plan_snapshot_projection_v1") {
        return {
          data: [
            claim(),
            {
              ...claim(),
              delivery_id: "10000000-0000-4000-8000-000000000002",
              attempt_id: "40000000-0000-4000-8000-000000000002",
            },
          ],
          error: null,
        };
      }
      throw new Error(`unexpected ${name}`);
    });
    await expect(dispatchPlanSnapshotProjection(client(rpc))).rejects.toThrow(
      /overlap a workspace/u,
    );
  });

  it.each([
    ["COVERED", { completed: 1, retried: 0, deadLettered: 0, superseded: 0 }],
    ["SUPERSEDED", { completed: 0, retried: 0, deadLettered: 0, superseded: 1 }],
    ["RETRY", { completed: 0, retried: 1, deadLettered: 0, superseded: 0 }],
    ["DEAD_LETTER", { completed: 0, retried: 0, deadLettered: 1, superseded: 0 }],
  ])("reuses a persisted normalized input for the %s outcome", async (outcome, expected) => {
    const storedInput = assemblePlanSnapshotInput(sourceBundle());
    const replacementAttemptId = "40000000-0000-4000-8000-000000000002";
    const rpc = vi.fn(async (name: string) => {
      if (name === "claim_plan_snapshot_projection_v1") return { data: [claim()], error: null };
      if (name === "load_plan_snapshot_projection_v1") {
        return {
          data: {
            attemptId: replacementAttemptId,
            sourceFence: `planning-source:${"a".repeat(64)}`,
            sourceBundle: sourceBundle(),
            storedInput,
          },
          error: null,
        };
      }
      if (name === "complete_plan_snapshot_projection_v1") return { data: outcome, error: null };
      throw new Error(`unexpected ${name}`);
    });

    await expect(dispatchPlanSnapshotProjection(client(rpc))).resolves.toMatchObject(expected);
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "claim_plan_snapshot_projection_v1",
      "load_plan_snapshot_projection_v1",
      "complete_plan_snapshot_projection_v1",
    ]);
    expect(rpc).toHaveBeenCalledWith(
      "complete_plan_snapshot_projection_v1",
      expect.objectContaining({ p_attempt_id: replacementAttemptId }),
    );
  });

  it.each([
    ["23514", "INVALID_CONTRACT", "PROJECTION_CONTRACT_REJECTED"],
    ["08006", "TRANSIENT", "DISPATCH_FAILED"],
  ])(
    "classifies owner RPC code %s without leaking its payload",
    async (rpcCode, failureClass, errorCode) => {
      const rpc = vi.fn(async (name: string) => {
        if (name === "claim_plan_snapshot_projection_v1") return { data: [claim()], error: null };
        if (name === "load_plan_snapshot_projection_v1") {
          return { data: null, error: { code: rpcCode, message: "private database detail" } };
        }
        if (name === "fail_plan_snapshot_projection_v1") {
          return {
            data: failureClass === "INVALID_CONTRACT" ? "dead_letter" : "retry",
            error: null,
          };
        }
        throw new Error(`unexpected ${name}`);
      });

      await expect(dispatchPlanSnapshotProjection(client(rpc))).resolves.toMatchObject({
        completed: 0,
        ...(failureClass === "INVALID_CONTRACT"
          ? { retried: 0, deadLettered: 1 }
          : { retried: 1, deadLettered: 0 }),
      });
      expect(rpc).toHaveBeenCalledWith(
        "fail_plan_snapshot_projection_v1",
        expect.objectContaining({
          p_failure_class: failureClass,
          p_error_code: errorCode,
        }),
      );
    },
  );

  it("never calculates when durable input recording is rejected", async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === "claim_plan_snapshot_projection_v1") return { data: [claim()], error: null };
      if (name === "load_plan_snapshot_projection_v1") {
        return {
          data: {
            attemptId,
            sourceFence: `planning-source:${"a".repeat(64)}`,
            sourceBundle: sourceBundle(),
            storedInput: null,
          },
          error: null,
        };
      }
      if (name === "record_plan_snapshot_input_v1") return { data: false, error: null };
      if (name === "fail_plan_snapshot_projection_v1") return { data: "dead_letter", error: null };
      throw new Error(`unexpected ${name}`);
    });

    await expect(dispatchPlanSnapshotProjection(client(rpc))).resolves.toMatchObject({
      completed: 0,
      retried: 0,
      deadLettered: 1,
    });
    expect(rpc).toHaveBeenCalledWith(
      "fail_plan_snapshot_projection_v1",
      expect.objectContaining({
        p_failure_class: "INVALID_CONTRACT",
        p_error_code: "INVALID_PLANNING_PROJECTION",
      }),
    );
    expect(rpc.mock.calls.some(([name]) => name === "complete_plan_snapshot_projection_v1")).toBe(
      false,
    );
  });
});
