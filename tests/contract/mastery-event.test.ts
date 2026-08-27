import { describe, expect, it } from "vitest";

import { validateSchema } from "../../src/shared/contracts/schema-registry";
import boundaryFixture from "./fixtures/events/v1/mastery.boundary.json";
import invalidFixture from "./fixtures/events/v1/mastery.invalid.json";
import maliciousFixture from "./fixtures/events/v1/mastery.malicious.json";
import validFixture from "./fixtures/events/v1/mastery.valid.json";

const valid = {
  event_name: "mastery.competency_state_changed",
  event_schema_version: 1,
  workspace_id: "10000000-0000-4000-8000-000000000001",
  payload: {
    competency_ref: "competency:python-typing",
    snapshot_id: "20000000-0000-4000-8000-000000000001",
    projection_generation: "live-v1",
    input_watermark: "1",
    achievement_level: "COMPLETED",
    engine_version: "mastery-engine/0.1.0",
    policy_version: "mastery-readiness-policy/0.1",
    calculated_as_of: "2026-08-27T09:00:00.000Z",
  },
} as const;

describe("Mastery Event V1", () => {
  it("keeps versioned valid, invalid, boundary, and malicious fixtures executable", () => {
    expect(validateSchema("mastery-event-v1", validFixture).valid).toBe(true);
    expect(validateSchema("mastery-event-v1", boundaryFixture).valid).toBe(true);
    expect(validateSchema("mastery-event-v1", invalidFixture).valid).toBe(false);
    expect(validateSchema("mastery-event-v1", maliciousFixture).valid).toBe(false);
  });

  it("accepts the privacy-minimized competency-state change envelope", () => {
    expect(validateSchema("mastery-event-v1", valid).valid).toBe(true);
  });

  it.each([
    { ...valid, event_schema_version: 2 },
    { ...valid, workspace_id: "foreign" },
    { ...valid, payload: { ...valid.payload, input_watermark: "0" } },
    { ...valid, payload: { ...valid.payload, achievement_level: "EXPERT" } },
    { ...valid, payload: { ...valid.payload, supportingEvidenceIds: [valid.payload.snapshot_id] } },
  ])("rejects invalid, future, boundary, and privacy-expanding envelopes", (value) => {
    expect(validateSchema("mastery-event-v1", value).valid).toBe(false);
  });
});
