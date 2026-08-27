// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import type { PandoSupabaseClient } from "../../../shared/supabase/database";
import {
  ADD_CURRENT_CUSTOM_ACTIVITY_RPC_V1,
  addCurrentCustomActivityV1,
  CompetencyOverlayConflictError,
  CompetencyOverlayInputError,
  CompetencyOverlayUnavailableError,
  CURRENT_COMPETENCY_OVERLAY_RPC_V1,
  loadCurrentCompetencyOverlayV1,
  SAVE_CURRENT_OVERLAY_NOTE_RPC_V1,
  saveCurrentOverlayNoteV1,
} from "./database-competency-overlay";

const goalKey = "goal:personal-main";
const competencyRef = "competency:python-testing";
const commandId = "10000000-0000-4000-8000-000000000001";
const eventId = "20000000-0000-4000-8000-000000000002";

function client(rpc: ReturnType<typeof vi.fn>): PandoSupabaseClient {
  return { rpc } as unknown as PandoSupabaseClient;
}

function detail() {
  return {
    contract: { name: "CompetencyOverlayDetailV1", version: "1.0.0" },
    readinessGoalKey: goalKey,
    competencyRef,
    overlayVersion: "7",
    note: { body: "Review failure modes.", updatedAt: "2026-08-27T08:00:00.000Z" },
    customActivities: [
      {
        activityKey: "activity:custom-first",
        title: "Write one property test",
        activityType: "MANUAL_CODING",
        lifecycle: "active",
        createdAt: "2026-08-27T08:05:00.000Z",
      },
    ],
  };
}

describe("current competency overlay database boundary", () => {
  it("loads a goal-scoped detail without a caller-selected workspace or profile", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: detail(), error: null });
    await expect(
      loadCurrentCompetencyOverlayV1(client(rpc), { readinessGoalKey: goalKey, competencyRef }),
    ).resolves.toMatchObject({ overlayVersion: "7", note: { body: "Review failure modes." } });
    expect(rpc).toHaveBeenCalledWith(CURRENT_COMPETENCY_OVERLAY_RPC_V1, {
      p_readiness_goal_key: goalKey,
      p_competency_ref: competencyRef,
    });
    expect(rpc.mock.calls[0]?.[1]).not.toHaveProperty("p_workspace_id");
    expect(rpc.mock.calls[0]?.[1]).not.toHaveProperty("p_profile_version_key");
  });

  it("fails closed on malformed, foreign-correlated, or unsorted detail responses", async () => {
    for (const value of [
      { ...detail(), readinessGoalKey: "goal:other" },
      { ...detail(), overlayVersion: "-1" },
      {
        ...detail(),
        customActivities: [
          { ...detail().customActivities[0], activityKey: "activity:z-last" },
          { ...detail().customActivities[0], activityKey: "activity:a-first" },
        ],
      },
    ]) {
      const rpc = vi.fn().mockResolvedValue({ data: value, error: null });
      await expect(
        loadCurrentCompetencyOverlayV1(client(rpc), { readinessGoalKey: goalKey, competencyRef }),
      ).rejects.toThrow(CompetencyOverlayUnavailableError);
    }
  });

  it("rejects invalid selectors before issuing a read", async () => {
    const rpc = vi.fn();
    await expect(
      loadCurrentCompetencyOverlayV1(client(rpc), {
        readinessGoalKey: "goal:<script>",
        competencyRef,
      }),
    ).rejects.toThrow(CompetencyOverlayInputError);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("saves a trimmed note with the supplied retry-stable idempotency key", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        commandId,
        competencyRef,
        operation: "updated",
        overlayVersion: "8",
        emittedEventIds: [eventId],
      },
      error: null,
    });
    const command = {
      readinessGoalKey: goalKey,
      competencyRef,
      body: "Review failure modes.",
      expectedOverlayVersion: "7",
      idempotencyKey: "overlay-note:v1:10000000-0000-4000-8000-000000000003",
    };
    await expect(saveCurrentOverlayNoteV1(client(rpc), command)).resolves.toMatchObject({
      overlayVersion: "8",
      operation: "updated",
    });
    expect(rpc).toHaveBeenCalledWith(SAVE_CURRENT_OVERLAY_NOTE_RPC_V1, {
      p_readiness_goal_key: goalKey,
      p_competency_ref: competencyRef,
      p_note_body: command.body,
      p_expected_overlay_version: "7",
      p_idempotency_key: command.idempotencyKey,
    });
  });

  it("adds a custom activity and validates command-response correlation", async () => {
    const activityKey = "activity:custom-10000000000040008000000000000004";
    const rpc = vi.fn().mockResolvedValue({
      data: {
        commandId,
        activityKey,
        targetCompetencyRef: competencyRef,
        overlayVersion: "8",
        emittedEventIds: [eventId],
      },
      error: null,
    });
    await expect(
      addCurrentCustomActivityV1(client(rpc), {
        readinessGoalKey: goalKey,
        competencyRef,
        activityKey,
        title: "Write one property test",
        activityType: "MANUAL_CODING",
        expectedOverlayVersion: "7",
        idempotencyKey: "overlay-activity:v1:10000000-0000-4000-8000-000000000004",
      }),
    ).resolves.toMatchObject({ activityKey, overlayVersion: "8" });
    expect(rpc).toHaveBeenCalledWith(
      ADD_CURRENT_CUSTOM_ACTIVITY_RPC_V1,
      expect.not.objectContaining({ p_workspace_id: expect.anything() }),
    );

    rpc.mockResolvedValueOnce({
      data: {
        commandId,
        activityKey: "activity:wrong",
        targetCompetencyRef: competencyRef,
        overlayVersion: "8",
        emittedEventIds: [eventId],
      },
      error: null,
    });
    await expect(
      addCurrentCustomActivityV1(client(rpc), {
        readinessGoalKey: goalKey,
        competencyRef,
        activityKey,
        title: "Write one property test",
        activityType: "PROJECT",
        expectedOverlayVersion: "7",
        idempotencyKey: "overlay-activity:v1:10000000-0000-4000-8000-000000000004",
      }),
    ).rejects.toThrow(CompetencyOverlayUnavailableError);
  });

  it("maps serialization conflicts and collapses private database errors", async () => {
    const conflict = client(
      vi.fn().mockResolvedValue({ data: null, error: { code: "40001", message: "raw SQL" } }),
    );
    await expect(
      saveCurrentOverlayNoteV1(conflict, {
        readinessGoalKey: goalKey,
        competencyRef,
        body: "Safe note",
        expectedOverlayVersion: "0",
        idempotencyKey: "note-retry",
      }),
    ).rejects.toThrow(CompetencyOverlayConflictError);

    const unavailable = client(vi.fn().mockRejectedValue(new Error("JWT secret detail")));
    const error = await loadCurrentCompetencyOverlayV1(unavailable, {
      readinessGoalKey: goalKey,
      competencyRef,
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CompetencyOverlayUnavailableError);
    expect(String(error)).not.toMatch(/JWT|secret/iu);
  });
});
