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

const focusSessionId = "60000000-0000-4000-8000-000000000001";
const customActivityId = "70000000-0000-4000-8000-000000000001";

function sourceBundle(unclassifiableHistory = false, attributedActiveFocus = false) {
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
      activeFocus: attributedActiveFocus
        ? {
            focusSessionId,
            readinessGoalKey: "goal:backend",
            activityKey: "activity:debug-api",
            title: "Debug an API",
            plannedMinutes: 25,
            startedAt: "2026-09-01T11:55:00.000Z",
            planAttribution: {
              planSnapshotId: "80000000-0000-4000-8000-000000000001",
              candidateKey: "candidate:debug-api",
              trackId: "90000000-0000-4000-8000-000000000001",
            },
          }
        : null,
    },
    completedWork: {
      revision: `completed-work:${"e".repeat(64)}`,
      windowStart: "2026-08-25T12:00:00.000Z",
      sessions: unclassifiableHistory
        ? [
            {
              focusSessionId,
              customActivityId,
              activityKey: "activity:debug-api",
              readinessGoalKey: "goal:backend",
              state: "COMPLETED",
              startedAt: "2026-09-01T11:00:00.000Z",
              endedAt: "2026-09-01T11:30:00.000Z",
              plannedMinutes: 30,
            },
          ]
        : [],
    },
    evidence: {
      revision: `evidence-completed-work:${"0".repeat(64)}`,
      items: unclassifiableHistory
        ? // A terminal session whose Evidence attempt never reached a terminal state cannot be
          // classified by planning-completed-work/0.1 and must not publish invented minutes.
          [{ focusSessionId, attemptTerminal: false, evidenceBearing: false }]
        : [],
    },
    mastery: {
      policyVersion: "mastery-prerequisite-satisfaction/0.1",
      revision: `mastery-prerequisite:${"c".repeat(64)}`,
      items: [],
    },
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
            calculationContractVersion: "planning-calculation/1",
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
        prerequisiteEngineVersion: "mastery-prerequisite-engine/0.1.0",
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

  it("preserves Sessions-owned plan attribution through the real worker input", async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === "claim_plan_snapshot_projection_v1") return { data: [claim()], error: null };
      if (name === "load_plan_snapshot_projection_v1") {
        return {
          data: {
            attemptId,
            calculationContractVersion: "planning-calculation/1",
            sourceFence: `planning-source:${"a".repeat(64)}`,
            sourceBundle: sourceBundle(false, true),
            storedInput: null,
          },
          error: null,
        };
      }
      if (name === "record_plan_snapshot_input_v1") return { data: true, error: null };
      if (name === "complete_plan_snapshot_projection_v1") return { data: "APPLIED", error: null };
      throw new Error(`unexpected ${name}`);
    });

    await expect(dispatchPlanSnapshotProjection(client(rpc))).resolves.toMatchObject({
      completed: 1,
    });
    expect(rpc).toHaveBeenCalledWith(
      "record_plan_snapshot_input_v1",
      expect.objectContaining({
        p_input: expect.objectContaining({
          activeFocus: expect.objectContaining({
            planAttribution: {
              planSnapshotId: "80000000-0000-4000-8000-000000000001",
              candidateKey: "candidate:debug-api",
              trackId: "90000000-0000-4000-8000-000000000001",
            },
          }),
        }),
      }),
    );
    expect(rpc).toHaveBeenCalledWith(
      "complete_plan_snapshot_projection_v1",
      expect.objectContaining({
        p_result: expect.objectContaining({
          actions: [
            expect.objectContaining({
              actionKind: "RESUME",
              planAttribution: {
                planSnapshotId: "80000000-0000-4000-8000-000000000001",
                candidateKey: "candidate:debug-api",
                trackId: "90000000-0000-4000-8000-000000000001",
              },
            }),
          ],
        }),
      }),
    );
  });

  it("dead-letters unclassifiable history instead of fabricating consumed minutes", async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === "claim_plan_snapshot_projection_v1") return { data: [claim()], error: null };
      if (name === "load_plan_snapshot_projection_v1") {
        return {
          data: {
            attemptId,
            calculationContractVersion: "planning-calculation/1",
            sourceFence: `planning-source:${"a".repeat(64)}`,
            sourceBundle: sourceBundle(true),
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
            calculationContractVersion: "planning-calculation/1",
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
            calculationContractVersion: "planning-calculation/1",
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

  it("routes a V2-stamped attempt through V2 assembly and calculation", async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === "claim_plan_snapshot_projection_v1") return { data: [claim()], error: null };
      if (name === "load_plan_snapshot_projection_v1") {
        return {
          data: {
            attemptId,
            calculationContractVersion: "planning-calculation/2",
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

    await expect(dispatchPlanSnapshotProjection(client(rpc))).resolves.toMatchObject({
      completed: 1,
    });
    expect(rpc).toHaveBeenCalledWith(
      "record_plan_snapshot_input_v1",
      expect.objectContaining({
        p_input: expect.objectContaining({
          completedWorkPolicyVersion: "planning-completed-work/0.2",
        }),
      }),
    );
    expect(rpc).toHaveBeenCalledWith(
      "complete_plan_snapshot_projection_v1",
      expect.objectContaining({
        p_result: expect.objectContaining({
          engineVersion: "planner-engine/0.2.0",
          policyVersion: "planning-policy/0.2",
        }),
      }),
    );
  });

  it("routes a V3-stamped attempt through V3 assembly and calculation (expand-half plumbing)", async () => {
    // D3b2-rollout's dispatcher "expand" half: no real delivery can carry this contract yet — the
    // database CHECK constraint still admits only .../1 and .../2 — so this proves the dispatcher's
    // own routing logic is ready, using a synthetic claim rather than a real one.
    const rpc = vi.fn(async (name: string) => {
      if (name === "claim_plan_snapshot_projection_v1") return { data: [claim()], error: null };
      if (name === "load_plan_snapshot_projection_v1") {
        return {
          data: {
            attemptId,
            calculationContractVersion: "planning-calculation/3",
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

    await expect(dispatchPlanSnapshotProjection(client(rpc))).resolves.toMatchObject({
      completed: 1,
    });
    expect(rpc).toHaveBeenCalledWith(
      "record_plan_snapshot_input_v1",
      expect.objectContaining({
        p_input: expect.objectContaining({
          completedWorkPolicyVersion: "planning-completed-work/0.2",
        }),
      }),
    );
    expect(rpc).toHaveBeenCalledWith(
      "complete_plan_snapshot_projection_v1",
      expect.objectContaining({
        p_result: expect.objectContaining({
          engineVersion: "planner-engine/0.3.0",
          policyVersion: "planning-policy/0.3",
        }),
      }),
    );
  });

  it("fails closed when the attempt calculation contract is unknown", async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === "claim_plan_snapshot_projection_v1") return { data: [claim()], error: null };
      if (name === "load_plan_snapshot_projection_v1") {
        return {
          data: {
            attemptId,
            calculationContractVersion: "planning-calculation/999",
            sourceFence: `planning-source:${"a".repeat(64)}`,
            sourceBundle: sourceBundle(),
            storedInput: null,
          },
          error: null,
        };
      }
      if (name === "fail_plan_snapshot_projection_v1") return { data: "dead_letter", error: null };
      throw new Error(`unexpected ${name}`);
    });

    await expect(dispatchPlanSnapshotProjection(client(rpc))).resolves.toMatchObject({
      completed: 0,
      deadLettered: 1,
    });
    expect(rpc).toHaveBeenCalledWith(
      "fail_plan_snapshot_projection_v1",
      expect.objectContaining({
        p_failure_class: "INVALID_CONTRACT",
        p_error_code: "INVALID_PLANNING_PROJECTION",
      }),
    );
  });
});
