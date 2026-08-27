import { describe, expect, it } from "vitest";

import { validateSchema } from "../../src/shared/contracts/schema-registry";
import boundaryFixture from "./fixtures/events/v1/review.boundary.json";
import invalidFixture from "./fixtures/events/v1/review.invalid.json";
import maliciousFixture from "./fixtures/events/v1/review.malicious.json";
import validFixture from "./fixtures/events/v1/review.valid.json";

const valid = validFixture as {
  readonly event_name: string;
  readonly event_schema_version: number;
  readonly workspace_id: string;
  readonly payload: Record<string, unknown>;
};

function withPayload(payload: Record<string, unknown>) {
  return { ...valid, payload: { ...valid.payload, ...payload } };
}

describe("Review Event V1", () => {
  it("keeps versioned valid, invalid, boundary, and malicious fixtures executable", () => {
    expect(validateSchema("review-event-v1", validFixture).valid).toBe(true);
    expect(validateSchema("review-event-v1", boundaryFixture).valid).toBe(true);
    expect(validateSchema("review-event-v1", invalidFixture).valid).toBe(false);
    expect(validateSchema("review-event-v1", maliciousFixture).valid).toBe(false);
  });

  it.each(["INACTIVE", "SUPPRESSED"] as const)(
    "accepts a privacy-minimized %s projection without an effective due instant",
    (projectionStatus) => {
      expect(
        validateSchema(
          "review-event-v1",
          withPayload({
            effective_due_at: null,
            active_reason_types: [],
            projection_status: projectionStatus,
          }),
        ).valid,
      ).toBe(true);
    },
  );

  it.each([
    { ...valid, event_name: "review.input_changed" },
    { ...valid, event_schema_version: 2 },
    { ...valid, workspace_id: "foreign" },
    withPayload({ subject_version: "0" }),
    withPayload({ subject_type: "EVIDENCE" }),
    withPayload({ dimension: "RECALL" }),
    withPayload({ effective_due_at: "2026-08-30T12:00:00+03:00" }),
    withPayload({ effective_due_at: null }),
    withPayload({ active_reason_types: [] }),
    withPayload({ active_reason_types: ["RETENTION_RISK", "RETENTION_RISK"] }),
    withPayload({ active_reason_types: ["EXPERT_REVIEW"] }),
    withPayload({
      projection_status: "SUPPRESSED",
      effective_due_at: "2026-08-30T09:00:00.000Z",
      active_reason_types: ["RETENTION_RISK"],
    }),
    withPayload({ note: "private evidence body" }),
    withPayload({ supporting_evidence_ids: ["30000000-0000-4000-8000-000000000001"] }),
    { ...valid, consumer_name: "attacker.consumer" },
  ])("rejects inconsistent, future, internal, or privacy-expanding envelopes", (value) => {
    expect(validateSchema("review-event-v1", value).valid).toBe(false);
  });
});
