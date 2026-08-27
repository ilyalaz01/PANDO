import { describe, expect, it } from "vitest";

import { validateSchema } from "../../src/shared/contracts/schema-registry";
import boundaryFixture from "./fixtures/events/v1/evidence.boundary.json";
import invalidFixture from "./fixtures/events/v1/evidence.invalid.json";
import maliciousFixture from "./fixtures/events/v1/evidence.malicious.json";
import validFixture from "./fixtures/events/v1/evidence.valid.json";

const workspaceId = "10000000-0000-4000-8000-000000000001";
const evidenceId = "20000000-0000-4000-8000-000000000001";

function appended() {
  return {
    event_name: "evidence.observation_appended",
    event_schema_version: 1,
    workspace_id: workspaceId,
    payload: {
      evidence_id: evidenceId,
      competency_ref: "competency:python-typing",
      ledger_watermark: "1",
    },
  };
}

describe("Evidence Event V1", () => {
  it("keeps versioned valid, invalid, boundary, and malicious fixtures executable", () => {
    expect(validateSchema("evidence-event-v1", validFixture).valid).toBe(true);
    expect(validateSchema("evidence-event-v1", boundaryFixture).valid).toBe(true);
    expect(validateSchema("evidence-event-v1", invalidFixture).valid).toBe(false);
    expect(validateSchema("evidence-event-v1", maliciousFixture).valid).toBe(false);
  });

  it("accepts append and invalidation wake-up envelopes", () => {
    expect(validateSchema("evidence-event-v1", appended()).valid).toBe(true);
    expect(
      validateSchema("evidence-event-v1", {
        event_name: "evidence.observation_invalidated",
        event_schema_version: 1,
        workspace_id: workspaceId,
        payload: {
          correction_id: "30000000-0000-4000-8000-000000000001",
          evidence_id: evidenceId,
          competency_ref: "competency:python-typing",
          ledger_watermark: "2",
        },
      }).valid,
    ).toBe(true);
  });

  it.each([
    { ...appended(), event_schema_version: 2 },
    { ...appended(), workspace_id: "foreign" },
    { ...appended(), payload: { ...appended().payload, ledger_watermark: "0" } },
    { ...appended(), payload: { ...appended().payload, note: "private evidence body" } },
    { ...appended(), consumer_name: "attacker.consumer" },
  ])("rejects invalid, future, or privacy-expanding envelopes", (value) => {
    expect(validateSchema("evidence-event-v1", value).valid).toBe(false);
  });
});
