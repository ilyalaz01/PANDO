import { describe, expect, it } from "vitest";

import { learningTrackCadenceControlSemanticViolations } from "../../src/shared/contracts/learning-track-cadence-control";
import { validateSchema } from "../../src/shared/contracts/schema-registry";
import applyFixture from "./fixtures/planning/v1/learning-track-cadence-control.apply.json";
import boundaryFixture from "./fixtures/planning/v1/learning-track-cadence-control.boundary.json";
import invalidFixture from "./fixtures/planning/v1/learning-track-cadence-control.invalid.json";
import maliciousFixture from "./fixtures/planning/v1/learning-track-cadence-control.malicious.json";
import validFixture from "./fixtures/planning/v1/learning-track-cadence-control.valid.json";

describe("Learning Track cadence control V1", () => {
  it("accepts valid, boundary, and apply contracts", () => {
    for (const fixture of [validFixture, boundaryFixture, applyFixture]) {
      expect(validateSchema("learning-track-cadence-control-v1", fixture).valid).toBe(true);
      expect(learningTrackCadenceControlSemanticViolations(fixture)).toEqual([]);
    }
  });

  it("rejects semantic no-ops and authority injection", () => {
    expect(validateSchema("learning-track-cadence-control-v1", invalidFixture).valid).toBe(true);
    expect(learningTrackCadenceControlSemanticViolations(invalidFixture)).toContain(
      "LEARNING_TRACK_CADENCE_PREVIEW_NOOP",
    );
    expect(validateSchema("learning-track-cadence-control-v1", maliciousFixture).valid).toBe(false);
  });

  it("never presents unavailable progress as zero", () => {
    const substituted = structuredClone(boundaryFixture);
    Reflect.set(substituted.learningTracks[0]!, "completedCadenceSessionsThisWeek", 0);
    expect(learningTrackCadenceControlSemanticViolations(substituted)).toContain(
      "LEARNING_TRACK_CADENCE_SOURCE_PROGRESS",
    );
  });

  it("requires cadence deficits to match the displayed count", () => {
    const changed = structuredClone(validFixture);
    changed.progress.afterCadenceDeficit = 0;
    expect(learningTrackCadenceControlSemanticViolations(changed)).toContain(
      "LEARNING_TRACK_CADENCE_PREVIEW_PROGRESS",
    );
  });
});
