import { describe, expect, it } from "vitest";

import { validateSchema } from "../../src/shared/contracts/schema-registry";
import boundaryFixture from "./fixtures/events/v1/planning.boundary.json";
import invalidFixture from "./fixtures/events/v1/planning.invalid.json";
import maliciousFixture from "./fixtures/events/v1/planning.malicious.json";
import validFixture from "./fixtures/events/v1/planning.valid.json";

describe("Planning Input Event V1", () => {
  it("keeps valid, boundary, invalid, and malicious fixtures executable", () => {
    expect(validateSchema("planning-event-v1", validFixture).valid).toBe(true);
    expect(validateSchema("planning-event-v1", boundaryFixture).valid).toBe(true);
    expect(validateSchema("planning-event-v1", invalidFixture).valid).toBe(false);
    expect(validateSchema("planning-event-v1", maliciousFixture).valid).toBe(false);
  });

  it("covers exactly the initialized and Track-activity admission variants", () => {
    for (const changeKind of ["CAPACITY_CHANGED", "ACTIVITY_COMPLETED", "RAW_SQL"]) {
      expect(
        validateSchema("planning-event-v1", {
          ...validFixture,
          payload: { ...validFixture.payload, change_kind: changeKind },
        }).valid,
      ).toBe(false);
    }
  });

  it.each([
    { ...validFixture, event_schema_version: 2 },
    { ...validFixture, workspace_id: "foreign" },
    {
      ...validFixture,
      payload: { ...validFixture.payload, learning_track_version: "0" },
    },
    {
      ...validFixture,
      payload: { ...validFixture.payload, candidate_key: "candidate:../secret" },
    },
    {
      ...boundaryFixture,
      payload: { ...boundaryFixture.payload, custom_activity_id: validFixture.workspace_id },
    },
  ])("rejects future, malformed, cross-variant, or privacy-expanding envelopes", (value) => {
    expect(validateSchema("planning-event-v1", value).valid).toBe(false);
  });
});
