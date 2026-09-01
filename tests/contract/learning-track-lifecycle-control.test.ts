import { createHash } from "node:crypto";

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

    const duplicateSelector = {
      ...current,
      learningTracks: [
        first,
        {
          ...first,
          learningTrackId: "30000000-0000-4000-8000-000000000099",
        },
      ],
    };
    expect(validateSchema("learning-track-lifecycle-control-v1", duplicateSelector).valid).toBe(
      true,
    );
    expect(learningTrackLifecycleControlSemanticViolations(duplicateSelector)).toContain(
      "CURRENT_LEARNING_TRACKS_DUPLICATE",
    );
  });

  it("rejects semantic transition, applicability, and warning lies", () => {
    const changed = structuredClone(valid);
    changed.after.lifecycle = "ACTIVE";
    changed.constraint.activeTrackCountAfter = 3;
    Reflect.set(changed, "warnings", [{ code: "PARENT_GROWTH_PLAN_PAUSED" }]);
    expect(validateSchema("learning-track-lifecycle-control-v1", changed).valid).toBe(true);
    expect(learningTrackLifecycleControlSemanticViolations(changed)).toEqual(
      expect.arrayContaining([
        "LEARNING_TRACK_PREVIEW_CONSTRAINT_DELTA",
        "LEARNING_TRACK_PREVIEW_TRANSITION",
        "LEARNING_TRACK_PREVIEW_WARNING",
      ]),
    );
  });

  it("represents an exact resume minimum above the maximum configurable weekly capacity", () => {
    const changed = structuredClone(boundary);
    changed.growthPlan.weeklyCapacityMinutes = 10_080;
    changed.before.protectedMinimumMinutes = 10_080;
    changed.after.protectedMinimumMinutes = 10_080;
    changed.constraint.activeTrackCountBefore = 1;
    changed.constraint.activeTrackCountAfter = 2;
    changed.constraint.activeProtectedMinimumMinutesBefore = 10_080;
    changed.constraint.activeProtectedMinimumMinutesAfter = 20_160;
    changed.constraint.flexibleMinutesBefore = 0;
    changed.constraint.flexibleMinutesAfter = -10_080;
    Reflect.set(changed, "blockingReasons", [
      { code: "ACTIVE_TRACK_MINIMUM_EXCEEDS_CAPACITY", minimumCapacityMinutes: 20_160 },
    ]);
    expect(validateSchema("learning-track-lifecycle-control-v1", changed).valid).toBe(true);
    expect(learningTrackLifecycleControlSemanticViolations(changed)).toEqual([]);
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
      growthPlan: {
        ...valid.growthPlan,
        lifecycle: valid.growthPlan.lifecycle as "ACTIVE" | "PAUSED",
      },
      before: {
        ...valid.before,
        lifecycle: valid.before.lifecycle as "ACTIVE" | "PAUSED",
      },
      after: {
        ...valid.after,
        lifecycle: valid.after.lifecycle as "ACTIVE" | "PAUSED",
      },
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
    expect(createHash("sha256").update(input, "utf8").digest("hex")).toBe(
      "d9549adbdef7cf05c06642f8240b621115e0013c65605a7d74687cf53fc64c38",
    );
  });
});
