import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  LEARNING_TRACK_TERMINAL_LIFECYCLE_PREVIEW_DIGEST_VERSION,
  learningTrackTerminalCurrentOrderFingerprintInput,
  learningTrackTerminalLifecyclePreviewDigestInput,
} from "../../src/modules/planning/domain/learning-track-terminal-lifecycle-preview";
import { learningTrackTerminalLifecycleControlSemanticViolations } from "../../src/shared/contracts/learning-track-terminal-lifecycle-control";
import { validateSchema } from "../../src/shared/contracts/schema-registry";
import boundary from "./fixtures/planning/v1/learning-track-terminal-lifecycle-control.boundary.json";
import invalid from "./fixtures/planning/v1/learning-track-terminal-lifecycle-control.invalid.json";
import malicious from "./fixtures/planning/v1/learning-track-terminal-lifecycle-control.malicious.json";
import valid from "./fixtures/planning/v1/learning-track-terminal-lifecycle-control.valid.json";

describe("Learning Track Terminal Lifecycle Control V1", () => {
  it("validates strict valid, boundary, invalid, and malicious fixtures", () => {
    expect(validateSchema("learning-track-terminal-lifecycle-control-v1", valid).valid).toBe(true);
    expect(validateSchema("learning-track-terminal-lifecycle-control-v1", boundary).valid).toBe(
      true,
    );
    expect(validateSchema("learning-track-terminal-lifecycle-control-v1", invalid).valid).toBe(
      false,
    );
    expect(validateSchema("learning-track-terminal-lifecycle-control-v1", malicious).valid).toBe(
      false,
    );
    expect(learningTrackTerminalLifecycleControlSemanticViolations(valid)).toEqual([]);
    expect(learningTrackTerminalLifecycleControlSemanticViolations(boundary)).toEqual([]);
  });

  it("keeps source capability, uniqueness, ordering, and cursor facts honest", () => {
    const changed = structuredClone(boundary);
    changed.currentTracks[0]!.capabilities = ["archive_track"];
    Reflect.set(changed.currentTracks[0]!, "updatedAt", "2026-09-02T10:00:00.000Z");
    changed.terminalHistory.reverse();
    Reflect.set(changed.historyPage, "nextCursor", null);
    expect(validateSchema("learning-track-terminal-lifecycle-control-v1", changed).valid).toBe(
      true,
    );
    expect(learningTrackTerminalLifecycleControlSemanticViolations(changed)).toEqual(
      expect.arrayContaining([
        "TERMINAL_LIFECYCLE_SOURCE_CAPABILITY",
        "TERMINAL_LIFECYCLE_SOURCE_CURSOR",
        "TERMINAL_LIFECYCLE_SOURCE_CURRENT_TIMESTAMP",
        "TERMINAL_LIFECYCLE_SOURCE_HISTORY_ORDER",
      ]),
    );
  });

  it("requires the exact terminal transition and deterministic consequences", () => {
    const changed = structuredClone(valid);
    changed.after.lifecycle = "ARCHIVED";
    changed.currentPortfolio.countAfter = 3;
    changed.activeConstraint.activeProtectedMinimumMinutesAfter = 61;
    expect(validateSchema("learning-track-terminal-lifecycle-control-v1", changed).valid).toBe(
      true,
    );
    expect(learningTrackTerminalLifecycleControlSemanticViolations(changed)).toEqual(
      expect.arrayContaining([
        "TERMINAL_LIFECYCLE_PREVIEW_ACTIVE_DELTA",
        "TERMINAL_LIFECYCLE_PREVIEW_CURRENT_DELTA",
        "TERMINAL_LIFECYCLE_PREVIEW_FLEXIBLE_MINUTES",
        "TERMINAL_LIFECYCLE_PREVIEW_TRANSITION",
      ]),
    );
  });

  it("accepts completed to archived without changing current or active constraints", () => {
    const changed = structuredClone(valid);
    changed.operation = "archive_track";
    changed.before.lifecycle = "COMPLETED";
    changed.after.lifecycle = "ARCHIVED";
    changed.currentPortfolio.countAfter = changed.currentPortfolio.countBefore;
    changed.activeConstraint.activeTrackCountAfter =
      changed.activeConstraint.activeTrackCountBefore;
    changed.activeConstraint.activeProtectedMinimumMinutesAfter =
      changed.activeConstraint.activeProtectedMinimumMinutesBefore;
    changed.activeConstraint.flexibleMinutesAfter = changed.activeConstraint.flexibleMinutesBefore;
    changed.visibilityBefore = "TERMINAL_HISTORY";
    changed.warnings = [{ code: "TRACK_ARCHIVE_IS_TERMINAL_NOT_DELETION" }];
    expect(validateSchema("learning-track-terminal-lifecycle-control-v1", changed).valid).toBe(
      true,
    );
    expect(learningTrackTerminalLifecycleControlSemanticViolations(changed)).toEqual([]);
  });

  it("fixes current-order input and every terminal preview digest field", () => {
    const order = learningTrackTerminalCurrentOrderFingerprintInput([
      {
        learningTrackId: "40000000-0000-4000-8000-000000000022",
        aggregateVersion: "3",
        lifecycle: "PAUSED",
        priority: 50,
        trackKey: "track:python",
      },
      {
        learningTrackId: "40000000-0000-4000-8000-000000000021",
        aggregateVersion: "5",
        lifecycle: "ACTIVE",
        priority: 90,
        trackKey: "track:algorithms",
      },
    ]);
    expect(order.indexOf("track:algorithms")).toBeLessThan(order.indexOf("track:python"));
    const input = learningTrackTerminalLifecyclePreviewDigestInput({
      workspaceId: "40000000-0000-4000-8000-000000000001",
      operation: "complete_track",
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
        lifecycle: valid.after.lifecycle as "COMPLETED",
      },
      currentPortfolio: valid.currentPortfolio,
      activeConstraint: valid.activeConstraint,
      visibilityBefore: "CURRENT_PLAN",
      warning: "TRACK_COMPLETION_IS_TERMINAL_AND_NOT_MASTERY",
    });
    expect(input).toContain(
      `digestVersion:${LEARNING_TRACK_TERMINAL_LIFECYCLE_PREVIEW_DIGEST_VERSION.length}:${LEARNING_TRACK_TERMINAL_LIFECYCLE_PREVIEW_DIGEST_VERSION}`,
    );
    expect(input).toContain("doesNotAssertMastery:4:true");
    expect(input).toContain("eventChangeKind:32:TRACK_TERMINAL_LIFECYCLE_CHANGED");
    expect(createHash("sha256").update(input, "utf8").digest("hex")).toBe(
      "8d3c6e6509d68b26b1f2afb1cf91ccbe665a03f6966ce31be22c45a7fd5d6aa8",
    );
  });
});
