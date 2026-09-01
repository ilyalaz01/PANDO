import { describe, expect, it } from "vitest";

import {
  LEARNING_TRACK_LIFECYCLE_PREVIEW_DIGEST_VERSION,
  learningTrackLifecycleActiveFingerprintInput,
  learningTrackLifecyclePreviewDigestInput,
} from "../../src/modules/planning/domain/learning-track-lifecycle-preview";
import { learningTrackLifecycleControlSemanticViolations } from "../../src/shared/contracts/learning-track-lifecycle-control";
import { validateSchema } from "../../src/shared/contracts/schema-registry";
import boundary from "./fixtures/planning/v1/learning-track-lifecycle-control.boundary.json";
import invalid from "./fixtures/planning/v1/learning-track-lifecycle-control.invalid.json";
import malicious from "./fixtures/planning/v1/learning-track-lifecycle-control.malicious.json";
import valid from "./fixtures/planning/v1/learning-track-lifecycle-control.valid.json";

describe("Learning Track Lifecycle Control V1", () => {
  it("validates applicable, boundary, invalid, and malicious fixtures", () => {
    expect(validateSchema("learning-track-lifecycle-control-v1", valid).valid).toBe(true);
    expect(validateSchema("learning-track-lifecycle-control-v1", boundary).valid).toBe(true);
    expect(validateSchema("learning-track-lifecycle-control-v1", invalid).valid).toBe(false);
    expect(validateSchema("learning-track-lifecycle-control-v1", malicious).valid).toBe(false);
    expect(learningTrackLifecycleControlSemanticViolations(valid)).toEqual([]);
    expect(learningTrackLifecycleControlSemanticViolations(boundary)).toEqual([]);
  });

  it("permits only the no-current-plan empty pairing", () => {
    const empty = {
      contract: { name: "CurrentLearningTracksV1", version: "1.0.0" },
      growthPlan: null,
      learningTracks: [],
    };
    expect(validateSchema("learning-track-lifecycle-control-v1", empty).valid).toBe(true);
    expect(learningTrackLifecycleControlSemanticViolations(empty)).toEqual([]);
    expect(
      learningTrackLifecycleControlSemanticViolations({ ...empty, learningTracks: [valid.before] }),
    ).toEqual(["CURRENT_LEARNING_TRACKS_EMPTY_PLAN"]);
  });

  it("requires stable priority-descending, key, and UUID read order", () => {
    const first = { ...valid.before, capabilities: ["pause_track"] };
    const second = {
      ...valid.after,
      trackKey: "track:backend",
      lifecycle: "PAUSED",
      priority: 91,
      capabilities: ["resume_track"],
    };
    const current = {
      contract: { name: "CurrentLearningTracksV1", version: "1.0.0" },
      growthPlan: valid.growthPlan,
      learningTracks: [first, second],
    };
    expect(validateSchema("learning-track-lifecycle-control-v1", current).valid).toBe(true);
    expect(learningTrackLifecycleControlSemanticViolations(current)).toContain(
      "CURRENT_LEARNING_TRACKS_ORDER",
    );
  });

  it("rejects semantic transition, applicability, and warning lies", () => {
    const changed = structuredClone(valid);
    changed.after.lifecycle = "ACTIVE";
    changed.constraint.activeTrackCountAfter = 3;
    changed.warnings = [{ code: "PARENT_GROWTH_PLAN_PAUSED" }];
    expect(validateSchema("learning-track-lifecycle-control-v1", changed).valid).toBe(true);
    expect(learningTrackLifecycleControlSemanticViolations(changed)).toEqual(
      expect.arrayContaining([
        "LEARNING_TRACK_PREVIEW_CONSTRAINT_DELTA",
        "LEARNING_TRACK_PREVIEW_TRANSITION",
        "LEARNING_TRACK_PREVIEW_WARNING",
      ]),
    );
  });

  it("fixes UUID ordering and every lifecycle digest field", () => {
    const fingerprint = learningTrackLifecycleActiveFingerprintInput([
      {
        learningTrackId: "30000000-0000-4000-8000-000000000032",
        aggregateVersion: "7",
        lifecycle: "ACTIVE",
        protectedMinimumMinutes: 60,
      },
      {
        learningTrackId: "30000000-0000-4000-8000-000000000031",
        aggregateVersion: "5",
        lifecycle: "ACTIVE",
        protectedMinimumMinutes: 90,
      },
    ]);
    expect(fingerprint.indexOf("000000000031")).toBeLessThan(fingerprint.indexOf("000000000032"));
    const input = learningTrackLifecyclePreviewDigestInput({
      workspaceId: "30000000-0000-4000-8000-000000000001",
      operation: "pause_track",
      reason: valid.reason,
      expectedGrowthPlanVersion: valid.expectedGrowthPlanVersion,
      expectedLearningTrackVersion: valid.expectedLearningTrackVersion,
      growthPlan: valid.growthPlan,
      before: valid.before,
      after: valid.after,
      constraint: valid.constraint,
      canApply: true,
      blockingReason: undefined,
      warning: undefined,
    });
    expect(input).toContain(
      `digestVersion:${LEARNING_TRACK_LIFECYCLE_PREVIEW_DIGEST_VERSION.length}:${LEARNING_TRACK_LIFECYCLE_PREVIEW_DIGEST_VERSION}`,
    );
    expect(input).toContain("beforeTrackKey:16:track:algorithms");
    expect(input).toContain("consumerName:25:planning.plan_snapshot_v1");
  });
});
