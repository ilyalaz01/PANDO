import { describe, expect, it } from "vitest";

import { validateSchema } from "../../src/shared/contracts/schema-registry";
import boundaryFixture from "./fixtures/events/v1/readiness.boundary.json";
import invalidFixture from "./fixtures/events/v1/readiness.invalid.json";
import maliciousFixture from "./fixtures/events/v1/readiness.malicious.json";
import validFixture from "./fixtures/events/v1/readiness.valid.json";

function intervalOrderViolations(value: unknown): readonly string[] {
  if (typeof value !== "object" || value === null) return [];
  const payload = (value as Record<string, unknown>).payload;
  if (typeof payload !== "object" || payload === null) return [];
  const { lower, upper } = payload as Record<string, unknown>;
  return typeof lower === "number" && typeof upper === "number" && lower > upper
    ? ["READINESS_EVENT_INTERVAL_ORDER"]
    : [];
}

describe("Target Readiness Event V1", () => {
  it("keeps valid, boundary, invalid, and malicious fixtures executable", () => {
    expect(validateSchema("readiness-event-v1", validFixture).valid).toBe(true);
    expect(validateSchema("readiness-event-v1", boundaryFixture).valid).toBe(true);
    expect(validateSchema("readiness-event-v1", invalidFixture).valid).toBe(false);
    expect(validateSchema("readiness-event-v1", maliciousFixture).valid).toBe(false);
  });

  it("covers exactly the changed and scheduled Targets facts", () => {
    for (const eventName of [
      "targets.readiness_goal_created",
      "mastery.competency_state_changed",
      "targets.readiness_projection_failed",
    ]) {
      expect(
        validateSchema("readiness-event-v1", { ...validFixture, event_name: eventName }).valid,
      ).toBe(false);
    }
  });

  it.each([
    { ...validFixture, event_schema_version: 2 },
    { ...validFixture, workspace_id: "foreign" },
    {
      ...validFixture,
      payload: { ...validFixture.payload, source_evidence_watermark: "-1" },
    },
    {
      ...validFixture,
      payload: { ...validFixture.payload, ruleEvaluations: [] },
    },
    {
      ...boundaryFixture,
      payload: { ...boundaryFixture.payload, consumer_name: "attacker.consumer" },
    },
  ])("rejects future, malformed, or privacy-expanding envelopes", (value) => {
    expect(validateSchema("readiness-event-v1", value).valid).toBe(false);
  });

  it("rejects a reversed interval semantically when JSON Schema bounds still pass", () => {
    const reversed = {
      ...validFixture,
      payload: { ...validFixture.payload, lower: 0.9, upper: 0.2 },
    };
    expect(validateSchema("readiness-event-v1", reversed).valid).toBe(true);
    expect(intervalOrderViolations(reversed)).toEqual(["READINESS_EVENT_INTERVAL_ORDER"]);
  });
});
