// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import type { PandoSupabaseClient } from "../../../shared/supabase/database";
import {
  GET_REVIEW_WORKSPACE_RPC_V1,
  REVIEW_COMMAND_RPCS_V1,
  ReviewConflictError,
  ReviewInputError,
  ReviewUnavailableError,
  applyReviewCommandV1,
  loadReviewWorkspaceV1,
} from "./database-review-workspace";

function client(rpc: ReturnType<typeof vi.fn>): PandoSupabaseClient {
  return { rpc } as unknown as PandoSupabaseClient;
}

function workspace(): Record<string, unknown> {
  return {
    contract: { name: "ReviewWorkspaceV1", version: "1.0.0" },
    timeZone: "UTC",
    asOf: "2026-08-27T09:00:00.000Z",
    projectionState: "current",
    items: [],
  };
}

const values = {
  p_subject_id: "20000000-0000-4000-8000-000000000001",
  p_reason_id: "30000000-0000-4000-8000-000000000001",
  p_expected_projection_version: "4",
  p_expected_source_revision: "2",
  p_competency_ref: "competency:python-error-handling",
  p_dimension: "APPLICATION",
  p_expected_subject_version: "4",
  p_local_due_at: "2026-09-01T09:30",
  p_idempotency_key: "review-command:v1:request",
  p_workspace_id: "attacker-workspace",
};

describe("Review database boundary", () => {
  it("loads the current personal queue without a caller-selected clock or workspace", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: workspace(), error: null });
    await expect(loadReviewWorkspaceV1(client(rpc))).resolves.toMatchObject({
      timeZone: "UTC",
      projectionState: "current",
    });
    expect(rpc).toHaveBeenCalledWith(GET_REVIEW_WORKSPACE_RPC_V1, {});
  });

  it("sends only the purpose-specific reminder parameters", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: {}, error: null });
    await applyReviewCommandV1(client(rpc), "reminder", values);
    expect(rpc).toHaveBeenCalledWith(REVIEW_COMMAND_RPCS_V1.reminder, {
      p_competency_ref: values.p_competency_ref,
      p_dimension: values.p_dimension,
      p_local_due_at: values.p_local_due_at,
      p_expected_subject_version: values.p_expected_subject_version,
      p_idempotency_key: values.p_idempotency_key,
    });
    expect(rpc.mock.calls[0]?.[1]).not.toHaveProperty("p_workspace_id");
    expect(rpc.mock.calls[0]?.[1]).not.toHaveProperty("p_reason_id");
  });

  it("keeps skip and suppress commands free of an injected due time", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: {}, error: null });
    await applyReviewCommandV1(client(rpc), "skip", values);
    expect(rpc).toHaveBeenCalledWith(REVIEW_COMMAND_RPCS_V1.skip, {
      p_subject_id: values.p_subject_id,
      p_reason_id: values.p_reason_id,
      p_expected_projection_version: values.p_expected_projection_version,
      p_expected_source_revision: values.p_expected_source_revision,
      p_idempotency_key: values.p_idempotency_key,
    });
    expect(rpc.mock.calls[0]?.[1]).not.toHaveProperty("p_local_due_at");
  });

  it("maps conflicts, invalid input, and private failures to safe errors", async () => {
    await expect(
      applyReviewCommandV1(
        client(vi.fn().mockResolvedValue({ data: null, error: { code: "40001" } })),
        "restore",
        values,
      ),
    ).rejects.toThrow(ReviewConflictError);
    await expect(
      applyReviewCommandV1(
        client(vi.fn().mockResolvedValue({ data: null, error: { code: "22023" } })),
        "restore",
        values,
      ),
    ).rejects.toThrow(ReviewInputError);

    const error = await loadReviewWorkspaceV1(
      client(vi.fn().mockRejectedValue(new Error("private database detail"))),
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ReviewUnavailableError);
    expect(String(error)).not.toMatch(/database detail/iu);
  });
});
