import { describe, expect, it } from "vitest";

import { validateSchema } from "../../src/shared/contracts/schema-registry";
import boundaryFixture from "./fixtures/events/v1/planning.boundary.json";
import invalidFixture from "./fixtures/events/v1/planning.invalid.json";
import maliciousFixture from "./fixtures/events/v1/planning.malicious.json";
import validFixture from "./fixtures/events/v1/planning.valid.json";
import lifecycleBoundaryFixture from "./fixtures/events/v1/planning-lifecycle.boundary.json";
import lifecycleInvalidFixture from "./fixtures/events/v1/planning-lifecycle.invalid.json";
import lifecycleMaliciousFixture from "./fixtures/events/v1/planning-lifecycle.malicious.json";
import lifecycleValidFixture from "./fixtures/events/v1/planning-lifecycle.valid.json";
import capacityBoundaryFixture from "./fixtures/events/v1/planning-capacity.boundary.json";
import capacityInvalidFixture from "./fixtures/events/v1/planning-capacity.invalid.json";
import capacityMaliciousFixture from "./fixtures/events/v1/planning-capacity.malicious.json";
import capacityValidFixture from "./fixtures/events/v1/planning-capacity.valid.json";
import trackLifecycleBoundaryFixture from "./fixtures/events/v1/planning-track-lifecycle.boundary.json";
import trackLifecycleInvalidFixture from "./fixtures/events/v1/planning-track-lifecycle.invalid.json";
import trackLifecycleMaliciousFixture from "./fixtures/events/v1/planning-track-lifecycle.malicious.json";
import trackLifecycleValidFixture from "./fixtures/events/v1/planning-track-lifecycle.valid.json";
import trackTerminalLifecycleBoundaryFixture from "./fixtures/events/v1/planning-track-terminal-lifecycle.boundary.json";
import trackTerminalLifecycleInvalidFixture from "./fixtures/events/v1/planning-track-terminal-lifecycle.invalid.json";
import trackTerminalLifecycleMaliciousFixture from "./fixtures/events/v1/planning-track-terminal-lifecycle.malicious.json";
import trackTerminalLifecycleValidFixture from "./fixtures/events/v1/planning-track-terminal-lifecycle.valid.json";
import trackPriorityMinimumBoundaryFixture from "./fixtures/events/v1/planning-track-priority-minimum.boundary.json";
import trackPriorityMinimumInvalidFixture from "./fixtures/events/v1/planning-track-priority-minimum.invalid.json";
import trackPriorityMinimumMaliciousFixture from "./fixtures/events/v1/planning-track-priority-minimum.malicious.json";
import trackPriorityMinimumValidFixture from "./fixtures/events/v1/planning-track-priority-minimum.valid.json";
import trackCreatedBoundaryFixture from "./fixtures/events/v1/planning-track-created.boundary.json";
import trackCreatedInvalidFixture from "./fixtures/events/v1/planning-track-created.invalid.json";
import trackCreatedMaliciousFixture from "./fixtures/events/v1/planning-track-created.malicious.json";
import trackCreatedValidFixture from "./fixtures/events/v1/planning-track-created.valid.json";

describe("Planning Input Event V1", () => {
  it("keeps valid, boundary, invalid, and malicious fixtures executable", () => {
    expect(validateSchema("planning-event-v1", validFixture).valid).toBe(true);
    expect(validateSchema("planning-event-v1", boundaryFixture).valid).toBe(true);
    expect(validateSchema("planning-event-v1", invalidFixture).valid).toBe(false);
    expect(validateSchema("planning-event-v1", maliciousFixture).valid).toBe(false);
    expect(validateSchema("planning-event-v1", lifecycleValidFixture).valid).toBe(true);
    expect(validateSchema("planning-event-v1", lifecycleBoundaryFixture).valid).toBe(true);
    expect(validateSchema("planning-event-v1", lifecycleInvalidFixture).valid).toBe(false);
    expect(validateSchema("planning-event-v1", lifecycleMaliciousFixture).valid).toBe(false);
    expect(validateSchema("planning-event-v1", capacityValidFixture).valid).toBe(true);
    expect(validateSchema("planning-event-v1", capacityBoundaryFixture).valid).toBe(true);
    expect(validateSchema("planning-event-v1", capacityInvalidFixture).valid).toBe(false);
    expect(validateSchema("planning-event-v1", capacityMaliciousFixture).valid).toBe(false);
    expect(validateSchema("planning-event-v1", trackLifecycleValidFixture).valid).toBe(true);
    expect(validateSchema("planning-event-v1", trackLifecycleBoundaryFixture).valid).toBe(true);
    expect(validateSchema("planning-event-v1", trackLifecycleInvalidFixture).valid).toBe(false);
    expect(validateSchema("planning-event-v1", trackLifecycleMaliciousFixture).valid).toBe(false);
    expect(validateSchema("planning-event-v1", trackTerminalLifecycleValidFixture).valid).toBe(
      true,
    );
    expect(validateSchema("planning-event-v1", trackTerminalLifecycleBoundaryFixture).valid).toBe(
      true,
    );
    expect(validateSchema("planning-event-v1", trackTerminalLifecycleInvalidFixture).valid).toBe(
      false,
    );
    expect(validateSchema("planning-event-v1", trackTerminalLifecycleMaliciousFixture).valid).toBe(
      false,
    );
    expect(validateSchema("planning-event-v1", trackPriorityMinimumValidFixture).valid).toBe(true);
    expect(validateSchema("planning-event-v1", trackPriorityMinimumBoundaryFixture).valid).toBe(
      true,
    );
    expect(validateSchema("planning-event-v1", trackPriorityMinimumInvalidFixture).valid).toBe(
      false,
    );
    expect(validateSchema("planning-event-v1", trackPriorityMinimumMaliciousFixture).valid).toBe(
      false,
    );
    expect(validateSchema("planning-event-v1", trackCreatedValidFixture).valid).toBe(true);
    expect(validateSchema("planning-event-v1", trackCreatedBoundaryFixture).valid).toBe(true);
    expect(validateSchema("planning-event-v1", trackCreatedInvalidFixture).valid).toBe(false);
    expect(validateSchema("planning-event-v1", trackCreatedMaliciousFixture).valid).toBe(false);
  });

  it("covers only the registered initialization, admission, lifecycle, capacity, and Track-input variants", () => {
    for (const changeKind of ["CAPACITY_CHANGED", "ACTIVITY_COMPLETED", "RAW_SQL"]) {
      expect(
        validateSchema("planning-event-v1", {
          ...validFixture,
          payload: { ...validFixture.payload, change_kind: changeKind },
        }).valid,
      ).toBe(false);
    }
  });

  it("keeps Track lifecycle wake-ups minimal and bigint-safe", () => {
    expect(trackLifecycleValidFixture.payload).toEqual({
      change_kind: "TRACK_LIFECYCLE_CHANGED",
      growth_plan_id: "30000000-0000-4000-8000-000000000020",
      learning_track_id: "30000000-0000-4000-8000-000000000021",
      learning_track_version: "8",
      lifecycle: "PAUSED",
    });
    expect(
      validateSchema("planning-event-v1", {
        ...trackLifecycleValidFixture,
        payload: { ...trackLifecycleValidFixture.payload, learning_track_version: 8 },
      }).valid,
    ).toBe(false);
  });

  it("keeps terminal Track wake-ups separate, minimal, and bigint-safe", () => {
    expect(trackTerminalLifecycleValidFixture.payload).toEqual({
      change_kind: "TRACK_TERMINAL_LIFECYCLE_CHANGED",
      growth_plan_id: "40000000-0000-4000-8000-000000000020",
      learning_track_id: "40000000-0000-4000-8000-000000000021",
      learning_track_version: "6",
      lifecycle: "COMPLETED",
    });
    expect(
      validateSchema("planning-event-v1", {
        ...trackTerminalLifecycleValidFixture,
        payload: { ...trackTerminalLifecycleValidFixture.payload, learning_track_version: 6 },
      }).valid,
    ).toBe(false);
  });

  it("keeps Track priority/minimum wake-ups exact, minimal, bounded, and bigint-safe", () => {
    expect(trackPriorityMinimumValidFixture.payload).toEqual({
      change_kind: "TRACK_PRIORITY_MINIMUM_CHANGED",
      growth_plan_id: "30000000-0000-4000-8000-000000000020",
      learning_track_id: "30000000-0000-4000-8000-000000000021",
      learning_track_version: "8",
      priority: 80,
      protected_minimum_minutes: 120,
    });
    expect(
      validateSchema("planning-event-v1", {
        ...trackPriorityMinimumValidFixture,
        payload: { ...trackPriorityMinimumValidFixture.payload, learning_track_version: 8 },
      }).valid,
    ).toBe(false);
    const missingResultingValue = structuredClone(trackPriorityMinimumValidFixture);
    Reflect.deleteProperty(missingResultingValue.payload, "protected_minimum_minutes");
    expect(validateSchema("planning-event-v1", missingResultingValue).valid).toBe(false);
    expect(
      validateSchema("planning-event-v1", {
        ...trackPriorityMinimumBoundaryFixture,
        payload: { ...trackPriorityMinimumBoundaryFixture.payload, priority: 100 },
      }).valid,
    ).toBe(true);
    expect(
      validateSchema("planning-event-v1", {
        ...trackPriorityMinimumBoundaryFixture,
        payload: { ...trackPriorityMinimumBoundaryFixture.payload, priority: -1 },
      }).valid,
    ).toBe(false);
  });

  it("keeps capacity wake-ups minimal and bigint-safe", () => {
    expect(capacityValidFixture.payload).toEqual({
      change_kind: "PLAN_CAPACITY_CHANGED",
      growth_plan_id: "30000000-0000-4000-8000-000000000011",
      growth_plan_version: "2",
      weekly_capacity_minutes: 480,
    });
    expect(
      validateSchema("planning-event-v1", {
        ...capacityValidFixture,
        payload: { ...capacityValidFixture.payload, growth_plan_version: 2 },
      }).valid,
    ).toBe(false);
  });

  it("keeps lifecycle wake-ups minimal and bigint-safe", () => {
    expect(lifecycleValidFixture.payload).toEqual({
      change_kind: "PLAN_LIFECYCLE_CHANGED",
      growth_plan_id: "30000000-0000-4000-8000-000000000011",
      growth_plan_version: "2",
      lifecycle: "PAUSED",
    });
    expect(
      validateSchema("planning-event-v1", {
        ...lifecycleValidFixture,
        payload: { ...lifecycleValidFixture.payload, growth_plan_version: 2 },
      }).valid,
    ).toBe(false);
    expect(
      validateSchema("planning-event-v1", {
        ...lifecycleBoundaryFixture,
        payload: {
          ...lifecycleBoundaryFixture.payload,
          growth_plan_version: "9223372036854775808",
        },
      }).valid,
    ).toBe(false);
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
