// @vitest-environment node

import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  CURRENT_TRACK_ORDER_FINGERPRINT_VERSION,
  LEARNING_TRACK_PRIORITY_MINIMUM_PREVIEW_DIGEST_VERSION,
  currentTrackOrderFingerprintInput,
  learningTrackPriorityMinimumActiveFingerprintInput,
  learningTrackPriorityMinimumPreviewDigestInput,
  type LearningTrackPriorityMinimumPreviewDigestFields,
} from "../../src/modules/planning/domain/learning-track-priority-minimum-preview";
import { learningTrackPriorityMinimumControlSemanticViolations } from "../../src/shared/contracts/learning-track-priority-minimum-control";
import { validateSchema } from "../../src/shared/contracts/schema-registry";
import blocked from "./fixtures/planning/v1/learning-track-priority-minimum-control.blocked.json";
import boundary from "./fixtures/planning/v1/learning-track-priority-minimum-control.boundary.json";
import invalid from "./fixtures/planning/v1/learning-track-priority-minimum-control.invalid.json";
import malicious from "./fixtures/planning/v1/learning-track-priority-minimum-control.malicious.json";
import valid from "./fixtures/planning/v1/learning-track-priority-minimum-control.valid.json";

type Mutable<T> = {
  -readonly [Key in keyof T]: T[Key] extends readonly (infer Item)[]
    ? Mutable<Item>[]
    : T[Key] extends object
      ? Mutable<T[Key]>
      : T[Key];
};

describe("Learning Track Priority and Protected Minimum Control V1", () => {
  it("validates applicable, boundary, blocked, invalid/no-op, and malicious fixtures", () => {
    for (const fixture of [valid, boundary, blocked]) {
      expect(validateSchema("learning-track-priority-minimum-control-v1", fixture).valid).toBe(
        true,
      );
      expect(learningTrackPriorityMinimumControlSemanticViolations(fixture)).toEqual([]);
    }
    expect(validateSchema("learning-track-priority-minimum-control-v1", invalid).valid).toBe(true);
    expect(learningTrackPriorityMinimumControlSemanticViolations(invalid)).toEqual([
      "LEARNING_TRACK_PRIORITY_MINIMUM_PREVIEW_NOOP",
    ]);
    expect(validateSchema("learning-track-priority-minimum-control-v1", malicious).valid).toBe(
      false,
    );
  });

  it("accepts the exact minimal apply result and rejects authority expansion", () => {
    const result = {
      contract: { name: "LearningTrackPriorityMinimumApplyResultV1", version: "1.0.0" },
      commandId: "30000000-0000-4000-8000-000000000031",
      changedTrack: valid.after,
      projectionState: "PENDING",
      planningDeliveryId: "30000000-0000-4000-8000-000000000032",
      emittedEventIds: ["30000000-0000-4000-8000-000000000033"],
    };
    expect(validateSchema("learning-track-priority-minimum-control-v1", result).valid).toBe(true);
    expect(learningTrackPriorityMinimumControlSemanticViolations(result)).toEqual([]);
    expect(
      validateSchema("learning-track-priority-minimum-control-v1", {
        ...result,
        workspaceId: "30000000-0000-4000-8000-000000000099",
      }).valid,
    ).toBe(false);
  });

  it("enforces active-only capacity, exact hypothetical resume effects, and warning order", () => {
    const exactCapacity = structuredClone(blocked);
    exactCapacity.growthPlan.weeklyCapacityMinutes = 360;
    exactCapacity.constraint.flexibleMinutesBefore = 120;
    exactCapacity.constraint.flexibleMinutesAfter = 0;
    exactCapacity.constraint.targetActiveStateFitsCapacity = true;
    exactCapacity.canApply = true;
    exactCapacity.blockingReasons = [];
    expect(learningTrackPriorityMinimumControlSemanticViolations(exactCapacity)).toEqual([]);

    const warningLie = structuredClone(boundary);
    warningLie.warnings = [boundary.warnings[1]!, boundary.warnings[0]!, boundary.warnings[2]!];
    expect(learningTrackPriorityMinimumControlSemanticViolations(warningLie)).toContain(
      "LEARNING_TRACK_PRIORITY_MINIMUM_PREVIEW_WARNINGS",
    );

    const pausedCapacityLie = structuredClone(boundary);
    pausedCapacityLie.constraint.activeProtectedMinimumMinutesAfter = 0;
    expect(learningTrackPriorityMinimumControlSemanticViolations(pausedCapacityLie)).toContain(
      "LEARNING_TRACK_PRIORITY_MINIMUM_PREVIEW_ACTIVE_CONSTRAINT",
    );
  });

  it("rejects version, identity, fingerprint, position, and applicability lies", () => {
    const changed = structuredClone(valid);
    changed.after.lifecycle = "PAUSED";
    changed.after.priority = 95;
    changed.after.aggregateVersion = "9";
    changed.constraint.activeTrackFingerprintAfter =
      changed.constraint.activeTrackFingerprintBefore;
    changed.constraint.currentTrackPositionAfter = 2;
    changed.canApply = false;
    expect(validateSchema("learning-track-priority-minimum-control-v1", changed).valid).toBe(true);
    expect(learningTrackPriorityMinimumControlSemanticViolations(changed)).toEqual(
      expect.arrayContaining([
        "LEARNING_TRACK_PRIORITY_MINIMUM_PREVIEW_ACTIVE_FINGERPRINT",
        "LEARNING_TRACK_PRIORITY_MINIMUM_PREVIEW_APPLICABILITY",
        "LEARNING_TRACK_PRIORITY_MINIMUM_PREVIEW_ORDER_POSITION",
        "LEARNING_TRACK_PRIORITY_MINIMUM_PREVIEW_UNCHANGED_FIELDS",
        "LEARNING_TRACK_PRIORITY_MINIMUM_PREVIEW_VERSION_ADVANCE",
      ]),
    );
  });

  it("fixes active UUID order and current priority/key/UUID order", () => {
    const activeInput = learningTrackPriorityMinimumActiveFingerprintInput([
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
    expect(activeInput.indexOf("000000000031")).toBeLessThan(activeInput.indexOf("000000000032"));

    const orderEntries = [
      {
        learningTrackId: "30000000-0000-4000-8000-000000000033",
        aggregateVersion: "3",
        lifecycle: "PAUSED",
        priority: 80,
        trackKey: "track:systems",
      },
      {
        learningTrackId: "30000000-0000-4000-8000-000000000032",
        aggregateVersion: "2",
        lifecycle: "ACTIVE",
        priority: 90,
        trackKey: "track:backend",
      },
      {
        learningTrackId: "30000000-0000-4000-8000-000000000031",
        aggregateVersion: "1",
        lifecycle: "ACTIVE",
        priority: 90,
        trackKey: "track:algorithms",
      },
    ] as const;
    const orderInput = currentTrackOrderFingerprintInput(orderEntries);
    expect(orderInput).toContain(
      `fingerprintVersion:${CURRENT_TRACK_ORDER_FINGERPRINT_VERSION.length}:${CURRENT_TRACK_ORDER_FINGERPRINT_VERSION}`,
    );
    expect(orderInput.indexOf("000000000031")).toBeLessThan(orderInput.indexOf("000000000032"));
    expect(orderInput.indexOf("000000000032")).toBeLessThan(orderInput.indexOf("000000000033"));
    expect(createHash("sha256").update(orderInput, "utf8").digest("hex")).toBe(
      "78387e21346c7812ae3b3e6db5ca7cfcf34d4517b4ad1b05473fc58c8c24d3c6",
    );
    for (const changedEntry of [
      { ...orderEntries[0], learningTrackId: "30000000-0000-4000-8000-000000000034" },
      { ...orderEntries[0], aggregateVersion: "4" },
      { ...orderEntries[0], lifecycle: "ACTIVE" as const },
      { ...orderEntries[0], priority: 81 },
      { ...orderEntries[0], trackKey: "track:testing" },
    ]) {
      expect(currentTrackOrderFingerprintInput([changedEntry, ...orderEntries.slice(1)])).not.toBe(
        orderInput,
      );
    }
  });

  it("fixes the digest protocol and is sensitive to every bound field", () => {
    const base = digestFields();
    const baselineInput = learningTrackPriorityMinimumPreviewDigestInput(base);
    expect(baselineInput).toContain(
      `digestVersion:${LEARNING_TRACK_PRIORITY_MINIMUM_PREVIEW_DIGEST_VERSION.length}:${LEARNING_TRACK_PRIORITY_MINIMUM_PREVIEW_DIGEST_VERSION}`,
    );
    expect(baselineInput).toContain("operation:26:set_track_priority_minimum");
    expect(baselineInput).toContain("consumerName:25:planning.plan_snapshot_v1");
    expect(createHash("sha256").update(baselineInput, "utf8").digest("hex")).toBe(
      "3b7f19f845fa951fd2961480c0b7718642a3983a2e3000cd55418a68f4d26ba4",
    );

    const mutations: readonly ((
      value: Mutable<LearningTrackPriorityMinimumPreviewDigestFields>,
    ) => void)[] = [
      (value) => {
        value.workspaceId = "30000000-0000-4000-8000-000000000002";
      },
      (value) => {
        value.reason = "Different reason";
      },
      (value) => {
        value.expectedGrowthPlanVersion = "5";
      },
      (value) => {
        value.expectedLearningTrackVersion = "8";
      },
      (value) => {
        value.growthPlan.growthPlanId = "30000000-0000-4000-8000-000000000022";
      },
      (value) => {
        value.growthPlan.lifecycle = "PAUSED";
      },
      (value) => {
        value.growthPlan.weeklyCapacityMinutes = 599;
      },
      (value) => {
        value.growthPlan.aggregateVersion = "5";
      },
      (value) => {
        value.before.learningTrackId = "30000000-0000-4000-8000-000000000022";
      },
      (value) => {
        value.before.trackKey = "track:backend";
      },
      (value) => {
        value.before.title = "Backend";
      },
      (value) => {
        value.before.lifecycle = "PAUSED";
      },
      (value) => {
        value.before.priority = 89;
      },
      (value) => {
        value.before.protectedMinimumMinutes = 119;
      },
      (value) => {
        value.before.aggregateVersion = "6";
      },
      (value) => {
        value.after.learningTrackId = "30000000-0000-4000-8000-000000000022";
      },
      (value) => {
        value.after.trackKey = "track:backend";
      },
      (value) => {
        value.after.title = "Backend";
      },
      (value) => {
        value.after.lifecycle = "PAUSED";
      },
      (value) => {
        value.after.priority = 79;
      },
      (value) => {
        value.after.protectedMinimumMinutes = 119;
      },
      (value) => {
        value.after.aggregateVersion = "9";
      },
      (value) => {
        value.constraint.activeTrackCountBefore = 1;
      },
      (value) => {
        value.constraint.activeTrackCountAfter = 1;
      },
      (value) => {
        value.constraint.activeProtectedMinimumMinutesBefore = 179;
      },
      (value) => {
        value.constraint.activeProtectedMinimumMinutesAfter = 179;
      },
      (value) => {
        value.constraint.flexibleMinutesBefore = 421;
      },
      (value) => {
        value.constraint.flexibleMinutesAfter = 421;
      },
      (value) => {
        value.constraint.activeTrackFingerprintBefore = "f".repeat(64);
      },
      (value) => {
        value.constraint.activeTrackFingerprintAfter = "f".repeat(64);
      },
      (value) => {
        value.constraint.activeTrackCountIfTargetActiveAfter = 1;
      },
      (value) => {
        value.constraint.minimumCapacityIfTargetActiveAfter = 179;
      },
      (value) => {
        value.constraint.targetActiveStateFitsCapacity = false;
      },
      (value) => {
        value.constraint.currentTrackPositionBefore = 2;
      },
      (value) => {
        value.constraint.currentTrackPositionAfter = 2;
      },
      (value) => {
        value.constraint.currentTrackOrderFingerprintBefore = "f".repeat(64);
      },
      (value) => {
        value.constraint.currentTrackOrderFingerprintAfter = "f".repeat(64);
      },
      (value) => {
        value.canApply = false;
      },
      (value) => {
        value.blockingReason = {
          code: "ACTIVE_TRACK_MINIMUM_EXCEEDS_CAPACITY",
          minimumCapacityMinutes: 601,
        };
      },
      (value) => {
        value.warnings.push({ code: "PARENT_GROWTH_PLAN_PAUSED" });
      },
    ];
    for (const mutate of mutations) {
      const changed = structuredClone(base);
      mutate(changed);
      expect(learningTrackPriorityMinimumPreviewDigestInput(changed)).not.toBe(baselineInput);
    }
  });
});

function digestFields(): Mutable<LearningTrackPriorityMinimumPreviewDigestFields> {
  return {
    workspaceId: "30000000-0000-4000-8000-000000000001",
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
    canApply: valid.canApply,
    blockingReason: undefined,
    warnings: [],
  };
}
