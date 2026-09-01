// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import currentPlan from "../../../../tests/contract/fixtures/planning/v1/growth-plan-control.boundary.json";
import preview from "../../../../tests/contract/fixtures/planning/v1/growth-plan-control.valid.json";
import type { PandoSupabaseClient } from "../../../shared/supabase/database";
import {
  APPLY_GROWTH_PLAN_LIFECYCLE_RPC_V1,
  applyGrowthPlanLifecycleV1,
  GET_CURRENT_GROWTH_PLAN_RPC_V1,
  loadCurrentGrowthPlanV1,
  PlanConflictError,
  PlanInputError,
  PlanUnavailableError,
  PREVIEW_GROWTH_PLAN_LIFECYCLE_RPC_V1,
  previewGrowthPlanLifecycleV1,
} from "./database-plan";

const commandId = "30000000-0000-4000-8000-000000000001";

function client(rpc: ReturnType<typeof vi.fn>): PandoSupabaseClient {
  return { rpc } as unknown as PandoSupabaseClient;
}

function applyResult() {
  return {
    contract: { name: "GrowthPlanLifecycleApplyResultV1", version: "1.0.0" },
    commandId,
    changedPlan: structuredClone(preview.after),
    projectionState: "PENDING",
    planningDeliveryId: "30000000-0000-4000-8000-000000000002",
    emittedEventIds: ["30000000-0000-4000-8000-000000000003"],
  };
}

const previewCommand = {
  operation: "pause_growth_plan" as const,
  expectedGrowthPlanVersion: "4",
  reason: "Pause this plan while priorities change.",
};

describe("Growth Plan database boundary", () => {
  it("loads the current personal plan without caller-selected authority", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: currentPlan, error: null });
    await expect(loadCurrentGrowthPlanV1(client(rpc))).resolves.toEqual(currentPlan);
    expect(rpc).toHaveBeenCalledWith(GET_CURRENT_GROWTH_PLAN_RPC_V1);
  });

  it("previews and applies only the purpose-specific, version-fenced parameters", async () => {
    const previewRpc = vi.fn().mockResolvedValue({ data: preview, error: null });
    await expect(previewGrowthPlanLifecycleV1(client(previewRpc), previewCommand)).resolves.toEqual(
      preview,
    );
    expect(previewRpc).toHaveBeenCalledWith(PREVIEW_GROWTH_PLAN_LIFECYCLE_RPC_V1, {
      p_operation: "pause_growth_plan",
      p_expected_growth_plan_version: "4",
      p_reason: "Pause this plan while priorities change.",
    });
    expect(previewRpc.mock.calls[0]?.[1]).not.toHaveProperty("p_workspace_id");
    expect(previewRpc.mock.calls[0]?.[1]).not.toHaveProperty("p_growth_plan_id");

    const applyRpc = vi.fn().mockResolvedValue({ data: applyResult(), error: null });
    await expect(
      applyGrowthPlanLifecycleV1(client(applyRpc), {
        ...previewCommand,
        previewDigest: preview.previewDigest,
        idempotencyKey: "plan-lifecycle:v1:request",
      }),
    ).resolves.toMatchObject({ commandId, projectionState: "PENDING" });
    expect(applyRpc).toHaveBeenCalledWith(APPLY_GROWTH_PLAN_LIFECYCLE_RPC_V1, {
      p_operation: "pause_growth_plan",
      p_expected_growth_plan_version: "4",
      p_preview_digest: preview.previewDigest,
      p_reason: "Pause this plan while priorities change.",
      p_idempotency_key: "plan-lifecycle:v1:request",
    });
    expect(applyRpc.mock.calls[0]?.[1]).not.toHaveProperty("p_workspace_id");
    expect(applyRpc.mock.calls[0]?.[1]).not.toHaveProperty("p_growth_plan_id");
  });

  it("rejects malformed inputs before RPC", async () => {
    const rpc = vi.fn();
    await expect(
      previewGrowthPlanLifecycleV1(client(rpc), { ...previewCommand, reason: " bad" }),
    ).rejects.toThrow(PlanInputError);
    await expect(
      previewGrowthPlanLifecycleV1(client(rpc), {
        ...previewCommand,
        expectedGrowthPlanVersion: "9223372036854775808",
      }),
    ).rejects.toThrow(PlanInputError);
    await expect(
      applyGrowthPlanLifecycleV1(client(rpc), {
        ...previewCommand,
        previewDigest: "not-a-digest",
        idempotencyKey: "plan-lifecycle:v1:request",
      }),
    ).rejects.toThrow(PlanInputError);
    await expect(
      applyGrowthPlanLifecycleV1(client(rpc), {
        ...previewCommand,
        previewDigest: preview.previewDigest,
        idempotencyKey: "plan-lifecycle:v1:\nrequest",
      }),
    ).rejects.toThrow(PlanInputError);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps conflicts, invalid requests, and private failures to safe errors", async () => {
    await expect(
      previewGrowthPlanLifecycleV1(
        client(vi.fn().mockResolvedValue({ data: null, error: { code: "40001" } })),
        previewCommand,
      ),
    ).rejects.toThrow(PlanConflictError);
    await expect(
      previewGrowthPlanLifecycleV1(
        client(vi.fn().mockResolvedValue({ data: null, error: { code: "22023" } })),
        previewCommand,
      ),
    ).rejects.toThrow(PlanInputError);
    const error = await loadCurrentGrowthPlanV1(
      client(vi.fn().mockRejectedValue(new Error("private database detail"))),
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PlanUnavailableError);
    expect(String(error)).not.toMatch(/database detail/iu);
    await expect(
      loadCurrentGrowthPlanV1(
        client(vi.fn().mockResolvedValue({ data: { contract: {} }, error: null })),
      ),
    ).rejects.toThrow(PlanUnavailableError);
  });
});
