// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import type { PandoSupabaseClient } from "../../../shared/supabase/database";
import {
  dispatchMasteryEvidenceProjection,
  MASTERY_HANDLER_TIMEOUT_MS,
} from "./dispatch-evidence-projection";

const deliveryId = "10000000-0000-4000-8000-000000000001";
const leaseToken = "20000000-0000-4000-8000-000000000001";

function claim() {
  return {
    delivery_id: deliveryId,
    event_id: "30000000-0000-4000-8000-000000000001",
    event_position: 7,
    workspace_id: "40000000-0000-4000-8000-000000000001",
    lease_token: leaseToken,
    lease_expires_at: "2026-08-27T09:02:00.000Z",
    attempt_count: 1,
    event_name: "evidence.observation_appended",
    event_schema_version: 1,
    payload: { competency_ref: "competency:python-typing" },
  };
}

function input() {
  return {
    deliveryId,
    eventId: claim().event_id,
    eventPosition: "7",
    workspaceId: claim().workspace_id,
    competencyId: "competency:python-typing",
    inputWatermark: "1",
    calculationAsOf: "2026-08-27T09:00:00.000000Z",
    evidence: [
      {
        evidenceId: "50000000-0000-4000-8000-000000000001",
        attemptId: "60000000-0000-4000-8000-000000000001",
        sourceId: "manual.focus",
        occurredAt: "2026-08-27T08:30:00.000Z",
        dimension: "APPLICATION",
        outcome: "SUCCESS",
        engagement: "INDEPENDENT",
        normalized: true,
        invalidated: false,
        observedResult: true,
        mappingConfidence: 1,
        sourceReliability: 0.6,
        targetRelevant: true,
      },
    ],
  };
}

function client(handler: ReturnType<typeof vi.fn>): PandoSupabaseClient {
  return { rpc: handler } as unknown as PandoSupabaseClient;
}

describe("Evidence to Mastery dispatcher", () => {
  afterEach(() => vi.useRealTimers());

  it("claims fixed work, reloads authoritative evidence, runs the pure engine, and applies it", async () => {
    const rpc = vi.fn(async (name: string, parameters: unknown) => {
      if (name === "claim_mastery_evidence_projection_v1") return { data: [claim()], error: null };
      if (name === "load_mastery_evidence_projection_v1") return { data: input(), error: null };
      if (name === "complete_mastery_evidence_projection_v1") return { data: true, error: null };
      throw new Error(`unexpected ${name} ${String(parameters)}`);
    });
    await expect(dispatchMasteryEvidenceProjection(client(rpc))).resolves.toEqual({
      configured: true,
      claimed: 1,
      completed: 1,
      retried: 0,
    });
    expect(rpc).toHaveBeenCalledWith("load_mastery_evidence_projection_v1", {
      p_delivery_id: deliveryId,
      p_lease_token: leaseToken,
    });
    const complete = rpc.mock.calls.find(
      ([name]) => name === "complete_mastery_evidence_projection_v1",
    );
    expect(complete?.[1]).toMatchObject({
      p_delivery_id: deliveryId,
      p_expected_event_position: 7,
      p_expected_input_watermark: 1,
      p_state: {
        engineVersion: "mastery-engine/0.1.0",
        policyVersion: "mastery-readiness-policy/0.1",
        competencyId: "competency:python-typing",
        inputWatermark: "1",
        calculatedAsOf: "2026-08-27T09:00:00.000Z",
        achievementLevel: "COMPLETED",
      },
    });
  });

  it("marks a stale watermark retry without applying a projection", async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === "claim_mastery_evidence_projection_v1") return { data: [claim()], error: null };
      if (name === "load_mastery_evidence_projection_v1") return { data: input(), error: null };
      if (name === "complete_mastery_evidence_projection_v1") return { data: false, error: null };
      if (name === "fail_mastery_evidence_projection_v1") return { data: "retry", error: null };
      throw new Error(`unexpected ${name}`);
    });
    await expect(dispatchMasteryEvidenceProjection(client(rpc))).resolves.toEqual({
      configured: true,
      claimed: 1,
      completed: 0,
      retried: 1,
    });
    expect(rpc).toHaveBeenCalledWith(
      "fail_mastery_evidence_projection_v1",
      expect.objectContaining({
        p_failure_class: "STALE_INPUT",
        p_error_code: "STALE_LEDGER_WATERMARK",
      }),
    );
  });

  it("classifies malicious input as a permanent invalid contract", async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === "claim_mastery_evidence_projection_v1") return { data: [claim()], error: null };
      if (name === "load_mastery_evidence_projection_v1") {
        return {
          data: {
            ...input(),
            evidence: [{ ...input().evidence[0], mappingConfidence: Number.NaN }],
          },
          error: null,
        };
      }
      if (name === "fail_mastery_evidence_projection_v1") {
        return { data: "dead_letter", error: null };
      }
      throw new Error(`unexpected ${name}`);
    });
    const summary = await dispatchMasteryEvidenceProjection(client(rpc));
    expect(summary).toEqual({ configured: true, claimed: 1, completed: 0, retried: 1 });
    expect(rpc).toHaveBeenCalledWith(
      "fail_mastery_evidence_projection_v1",
      expect.objectContaining({ p_failure_class: "INVALID_CONTRACT" }),
    );
  });

  it("requires the database-issued calculation clock in the projection transport", async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === "claim_mastery_evidence_projection_v1") return { data: [claim()], error: null };
      if (name === "load_mastery_evidence_projection_v1") {
        const withoutClock = structuredClone(input()) as Record<string, unknown>;
        delete withoutClock.calculationAsOf;
        return { data: withoutClock, error: null };
      }
      if (name === "fail_mastery_evidence_projection_v1") {
        return { data: "dead_letter", error: null };
      }
      throw new Error(`unexpected ${name}`);
    });

    await expect(dispatchMasteryEvidenceProjection(client(rpc))).resolves.toEqual({
      configured: true,
      claimed: 1,
      completed: 0,
      retried: 1,
    });
    expect(rpc).toHaveBeenCalledWith(
      "fail_mastery_evidence_projection_v1",
      expect.objectContaining({
        p_failure_class: "INVALID_CONTRACT",
        p_error_code: "INVALID_PROJECTION_INPUT",
      }),
    );
  });

  it("bounds a never-resolving handler and records a transient timeout", async () => {
    vi.useFakeTimers();
    const rpc = vi.fn((name: string) => {
      if (name === "claim_mastery_evidence_projection_v1") {
        return Promise.resolve({ data: [claim()], error: null });
      }
      if (name === "load_mastery_evidence_projection_v1") return new Promise(() => undefined);
      if (name === "fail_mastery_evidence_projection_v1") {
        return Promise.resolve({ data: "retry", error: null });
      }
      throw new Error(`unexpected ${name}`);
    });

    const dispatch = dispatchMasteryEvidenceProjection(client(rpc));
    await vi.advanceTimersByTimeAsync(MASTERY_HANDLER_TIMEOUT_MS);

    await expect(dispatch).resolves.toEqual({
      configured: true,
      claimed: 1,
      completed: 0,
      retried: 1,
    });
    expect(rpc).toHaveBeenCalledWith(
      "fail_mastery_evidence_projection_v1",
      expect.objectContaining({
        p_failure_class: "TRANSIENT",
        p_error_code: "HANDLER_TIMEOUT",
      }),
    );
  });

  it("does not hang when durable failure reporting also stops responding", async () => {
    vi.useFakeTimers();
    const rpc = vi.fn((name: string) => {
      if (name === "claim_mastery_evidence_projection_v1") {
        return Promise.resolve({ data: [claim()], error: null });
      }
      if (name === "load_mastery_evidence_projection_v1") {
        return Promise.resolve({
          data: { ...input(), evidence: [{ ...input().evidence[0], mappingConfidence: 2 }] },
          error: null,
        });
      }
      if (name === "fail_mastery_evidence_projection_v1") return new Promise(() => undefined);
      throw new Error(`unexpected ${name}`);
    });

    const dispatch = dispatchMasteryEvidenceProjection(client(rpc));
    await vi.advanceTimersByTimeAsync(MASTERY_HANDLER_TIMEOUT_MS);

    await expect(dispatch).resolves.toEqual({
      configured: true,
      claimed: 1,
      completed: 0,
      retried: 1,
    });
  });

  it("preserves database contract error codes for permanent classification", async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === "claim_mastery_evidence_projection_v1") return { data: [claim()], error: null };
      if (name === "load_mastery_evidence_projection_v1") {
        return { data: null, error: { code: "22023", message: "unsafe detail" } };
      }
      if (name === "fail_mastery_evidence_projection_v1") {
        return { data: "dead_letter", error: null };
      }
      throw new Error(`unexpected ${name}`);
    });

    await expect(dispatchMasteryEvidenceProjection(client(rpc))).resolves.toEqual({
      configured: true,
      claimed: 1,
      completed: 0,
      retried: 1,
    });
    expect(rpc).toHaveBeenCalledWith(
      "fail_mastery_evidence_projection_v1",
      expect.objectContaining({
        p_failure_class: "INVALID_CONTRACT",
        p_error_code: "PROJECTION_CONTRACT_REJECTED",
      }),
    );
  });

  it("returns a zero-work summary and rejects malformed claim envelopes", async () => {
    await expect(
      dispatchMasteryEvidenceProjection(
        client(vi.fn().mockResolvedValue({ data: [], error: null })),
      ),
    ).resolves.toEqual({ configured: true, claimed: 0, completed: 0, retried: 0 });
    await expect(
      dispatchMasteryEvidenceProjection(
        client(
          vi.fn().mockResolvedValue({ data: [{ ...claim(), lease_token: "bad" }], error: null }),
        ),
      ),
    ).rejects.toThrow("claim row");
  });
});
