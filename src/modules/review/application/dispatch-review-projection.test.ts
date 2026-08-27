import { describe, expect, it } from "vitest";

import type { PandoSupabaseClient } from "../../../shared/supabase/database";
import { dispatchReviewItemProjection } from "./dispatch-review-projection";

const deliveryId = "11111111-1111-4111-8111-111111111111";
const leaseToken = "22222222-2222-4222-8222-222222222222";
const workspaceId = "33333333-3333-4333-8333-333333333333";
const subjectId = "44444444-4444-4444-8444-444444444444";
const snapshotId = "55555555-5555-4555-8555-555555555555";
const evidenceId = "66666666-6666-4666-8666-666666666666";
const eventId = "99999999-9999-4999-8999-999999999999";

function claim() {
  return { delivery_id: deliveryId, lease_token: leaseToken, event_position: 7 };
}

function input() {
  return {
    eventId,
    workspaceId,
    calculatedAsOf: "2026-08-27T10:00:00+00:00",
    subjects: [
      {
        subjectId,
        subjectRef: "competency:python/knowledge",
        competencyRef: "competency:python",
        dimension: "KNOWLEDGE",
        currentInputWatermark: "0",
        currentMasterySnapshotId: null,
        currentMasteryInputWatermark: null,
        currentMasteryProjectionVersion: null,
        focus: null,
        masterySignal: {
          achievementLevel: "COMPLETED",
          latestQualifyingSuccessAt: "2026-08-27T09:00:00+00:00",
          latestSupportingEvidenceId: evidenceId,
          snapshotId,
          inputWatermark: "3",
          projectionVersion: "1",
          focus: null,
        },
        reasonIdentities: [
          {
            reasonId: "77777777-7777-5777-a777-777777777777",
            sourceKey: "mastery:competency:python/knowledge:retention",
            reason: "RETENTION_RISK",
          },
          {
            reasonId: "88888888-8888-5888-a888-888888888888",
            sourceKey: "mastery:competency:python/knowledge:verification",
            reason: "VERIFICATION_NEEDED",
          },
        ],
        sourceEvents: [],
        actionEvents: [],
      },
    ],
  };
}

function client(
  handler: (name: string, parameters: Record<string, unknown>) => unknown,
): PandoSupabaseClient {
  return {
    rpc(name: string, parameters: Record<string, unknown> = {}) {
      return Promise.resolve({ data: handler(name, parameters), error: null });
    },
  } as unknown as PandoSupabaseClient;
}

describe("Review projection dispatcher", () => {
  it("folds a Mastery signal and completes the fixed delivery", async () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    const result = await dispatchReviewItemProjection(
      client((name, parameters) => {
        calls.push([name, parameters]);
        if (name === "claim_review_item_projection_v1") return [claim()];
        if (name === "load_review_item_projection_v1") return input();
        if (name === "complete_review_item_projection_v1") return true;
        throw new Error(name);
      }),
    );

    expect(result).toEqual({ configured: true, claimed: 1, completed: 1, retried: 0 });
    const completed = calls.find(([name]) => name === "complete_review_item_projection_v1");
    const subjects = completed?.[1].p_subjects as Array<Record<string, unknown>>;
    expect(subjects[0]).toMatchObject({
      expectedInputWatermark: "0",
      nextInputWatermark: "1",
      masterySnapshotId: snapshotId,
    });
    expect(subjects[0]?.newSourceEvents).toHaveLength(2);
    expect(subjects[0]?.newSourceEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventId: expect.stringMatching(/^[0-9a-f-]{36}$/u),
        }),
      ]),
    );
  });

  it("clears a stale Focus pointer when the authoritative Mastery signal has no evidence", async () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    const original = input();
    const invalidated = {
      ...original,
      subjects: [
        {
          ...original.subjects[0]!,
          currentInputWatermark: "1",
          focus: {
            readinessGoalKey: "goal:python-verification",
            activityKey: "activity:python-errors",
            activityTitle: "Practice Python errors",
          },
          masterySignal: {
            ...original.subjects[0]!.masterySignal,
            achievementLevel: "NOT_STARTED",
            latestQualifyingSuccessAt: null,
            latestSupportingEvidenceId: null,
            focus: null,
          },
        },
      ],
    };

    await dispatchReviewItemProjection(
      client((name, parameters) => {
        calls.push([name, parameters]);
        if (name === "claim_review_item_projection_v1") return [claim()];
        if (name === "load_review_item_projection_v1") return invalidated;
        if (name === "complete_review_item_projection_v1") return true;
        throw new Error(name);
      }),
    );

    const completed = calls.find(([name]) => name === "complete_review_item_projection_v1");
    const subjects = completed?.[1].p_subjects as Array<Record<string, unknown>>;
    expect(subjects[0]?.focus).toBeNull();
  });

  it("retries a stale completion through the fixed failure RPC", async () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    const result = await dispatchReviewItemProjection(
      client((name, parameters) => {
        calls.push([name, parameters]);
        if (name === "claim_review_item_projection_v1") return [claim()];
        if (name === "load_review_item_projection_v1") return input();
        if (name === "complete_review_item_projection_v1") return false;
        if (name === "fail_review_item_projection_v1") return "retry";
        throw new Error(name);
      }),
    );

    expect(result.retried).toBe(1);
    expect(calls.find(([name]) => name === "fail_review_item_projection_v1")?.[1]).toMatchObject({
      p_failure_class: "STALE_INPUT",
      p_error_code: "STALE_REVIEW_INPUT",
    });
  });

  it("dead-letters malformed transport input", async () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    const result = await dispatchReviewItemProjection(
      client((name, parameters) => {
        calls.push([name, parameters]);
        if (name === "claim_review_item_projection_v1") return [claim()];
        if (name === "load_review_item_projection_v1") return { ...input(), workspaceId: "bad" };
        if (name === "fail_review_item_projection_v1") return "dead_letter";
        throw new Error(name);
      }),
    );

    expect(result.retried).toBe(1);
    expect(calls.find(([name]) => name === "fail_review_item_projection_v1")?.[1]).toMatchObject({
      p_failure_class: "INVALID_CONTRACT",
      p_error_code: "INVALID_PROJECTION_INPUT",
    });
  });
});
