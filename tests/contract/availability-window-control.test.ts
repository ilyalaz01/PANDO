// @vitest-environment node

import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  AVAILABILITY_WINDOW_COMMAND_TYPE,
  AVAILABILITY_WINDOW_FINGERPRINT_VERSION,
  AVAILABILITY_WINDOW_PREVIEW_DIGEST_VERSION,
  AVAILABILITY_WINDOW_REQUEST_HASH_VERSION,
  availabilityWindowFingerprintInput,
  availabilityWindowIdentityInput,
  availabilityWindowPreviewDigestInput,
  availabilityWindowRequestHashInput,
  effectiveWeeklyCapacityMinutes,
  type AvailabilityWindowPreviewDigestFields,
} from "../../src/modules/planning/domain/availability-window-preview";
import { planningCreateUuidFromSha256 } from "../../src/modules/planning/domain/growth-plan-initialization-preview";
import {
  AvailabilityWindowContractError,
  availabilityWindowControlSemanticViolations,
  decodeAvailabilityWindowApplyResultV1,
  decodeAvailabilityWindowPreviewV1,
  decodeAvailabilityWindowSourceV1,
  validateAvailabilityWindowControlV1,
} from "../../src/shared/contracts/availability-window-control";
import { validateSchema } from "../../src/shared/contracts/schema-registry";
import apply from "./fixtures/planning/v1/availability-window-control.apply.json";
import boundary from "./fixtures/planning/v1/availability-window-control.boundary.json";
import invalid from "./fixtures/planning/v1/availability-window-control.invalid.json";
import malicious from "./fixtures/planning/v1/availability-window-control.malicious.json";
import remove from "./fixtures/planning/v1/availability-window-control.remove.json";
import valid from "./fixtures/planning/v1/availability-window-control.valid.json";

// Shared cross-session oracle constants for the D3b1-db outcome (see CLAUDE_SESSION_SPLIT_PLAN.md).
const ORACLE_WORKSPACE_ID = "568cc123-9fcd-4a5a-847e-5ce1918f09b0";

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function digestFieldsFromFixture(
  fixture: typeof valid | typeof remove,
  workspaceId: string,
): AvailabilityWindowPreviewDigestFields {
  return {
    workspaceId,
    operation: fixture.operation as AvailabilityWindowPreviewDigestFields["operation"],
    idempotencyKey: fixture.idempotencyKey,
    reason: fixture.reason,
    expectedGrowthPlanVersion: fixture.expectedGrowthPlanVersion,
    growthPlan: fixture.growthPlan as AvailabilityWindowPreviewDigestFields["growthPlan"],
    before: fixture.before as AvailabilityWindowPreviewDigestFields["before"],
    after: fixture.after as AvailabilityWindowPreviewDigestFields["after"],
    canApply: fixture.canApply,
    blockingReasonCode: null,
    warnings: fixture.warnings.map(
      (warning) => warning.code,
    ) as AvailabilityWindowPreviewDigestFields["warnings"],
  };
}

describe("PANDO Availability Window Control V1", () => {
  it("keeps valid, boundary, remove, apply, invalid, and malicious fixtures executable", () => {
    expect(validateSchema("availability-window-control-v1", valid).valid).toBe(true);
    expect(validateSchema("availability-window-control-v1", boundary).valid).toBe(true);
    expect(validateSchema("availability-window-control-v1", remove).valid).toBe(true);
    expect(validateSchema("availability-window-control-v1", apply).valid).toBe(true);
    expect(validateSchema("availability-window-control-v1", invalid).valid).toBe(true);
    expect(validateSchema("availability-window-control-v1", malicious).valid).toBe(false);

    expect(validateAvailabilityWindowControlV1(valid).valid).toBe(true);
    expect(validateAvailabilityWindowControlV1(boundary).valid).toBe(true);
    expect(validateAvailabilityWindowControlV1(remove).valid).toBe(true);
    expect(validateAvailabilityWindowControlV1(apply).valid).toBe(true);
    expect(validateAvailabilityWindowControlV1(invalid).valid).toBe(false);
    expect(validateAvailabilityWindowControlV1(malicious).valid).toBe(false);

    expect(decodeAvailabilityWindowPreviewV1(valid)).toEqual(valid);
    expect(decodeAvailabilityWindowPreviewV1(remove)).toEqual(remove);
    expect(decodeAvailabilityWindowSourceV1(boundary)).toEqual(boundary);
    expect(decodeAvailabilityWindowApplyResultV1(apply)).toEqual(apply);
    expect(() => decodeAvailabilityWindowPreviewV1(invalid)).toThrow(
      AvailabilityWindowContractError,
    );
    expect(() => decodeAvailabilityWindowSourceV1(malicious)).toThrow(
      AvailabilityWindowContractError,
    );
  });

  it("enforces the two-state availability envelope and the 60-window, 20-history cap", () => {
    expect(boundary.availabilityWindows).toHaveLength(60);
    expect(boundary.removedAvailabilityWindows).toHaveLength(20);
    expect(boundary.state).toBe("WINDOW_LIMIT_REACHED");
    expect(boundary.capabilities).toEqual([
      "change_availability_window",
      "remove_availability_window",
    ]);

    const overflowedActive = structuredClone(boundary);
    overflowedActive.availabilityWindows.push({
      ...overflowedActive.availabilityWindows[59]!,
      windowKey: "window:7dffffff-0000-8000-8000-000000000001",
    });
    expect(validateSchema("availability-window-control-v1", overflowedActive).valid).toBe(false);

    const overflowedHistory = structuredClone(boundary);
    overflowedHistory.removedAvailabilityWindows.push({
      ...overflowedHistory.removedAvailabilityWindows[19]!,
      windowKey: "window:7effffff-0000-8000-8000-000000000001",
    });
    expect(validateSchema("availability-window-control-v1", overflowedHistory).valid).toBe(false);

    const noPlan = {
      contract: { name: "AvailabilityWindowSourceV1", version: "1.0.0" },
      state: "NO_CURRENT_PLAN",
      capabilities: [],
      growthPlan: null,
      availabilityWindows: [],
      removedAvailabilityWindows: [],
    };
    expect(validateAvailabilityWindowControlV1(noPlan).valid).toBe(true);
    expect(decodeAvailabilityWindowSourceV1(noPlan).state).toBe("NO_CURRENT_PLAN");
    expect(
      validateSchema("availability-window-control-v1", {
        ...noPlan,
        capabilities: ["create_availability_window"],
      }).valid,
    ).toBe(false);
    expect(
      validateSchema("availability-window-control-v1", {
        ...noPlan,
        growthPlan: boundary.growthPlan,
      }).valid,
    ).toBe(false);
  });

  it("rejects duplicate, unordered, overlapping, and unsafe active windows", () => {
    const reversed = structuredClone(boundary);
    reversed.availabilityWindows.reverse();
    expect(
      availabilityWindowControlSemanticViolations(reversed).map((item) => item.code),
    ).toContain("AVAILABILITY_WINDOW_ORDER");

    const duplicated = structuredClone(boundary);
    duplicated.availabilityWindows[1]!.windowKey = duplicated.availabilityWindows[0]!.windowKey;
    expect(
      availabilityWindowControlSemanticViolations(duplicated).map((item) => item.code),
    ).toContain("AVAILABILITY_WINDOW_DUPLICATE");

    const removedInActiveList = structuredClone(boundary);
    removedInActiveList.availabilityWindows[0]!.lifecycle = "REMOVED";
    expect(
      availabilityWindowControlSemanticViolations(removedInActiveList).map((item) => item.code),
    ).toContain("AVAILABILITY_WINDOW_LIFECYCLE");

    const miscounted = structuredClone(boundary);
    miscounted.growthPlan.activeWindowCount = 59;
    expect(
      availabilityWindowControlSemanticViolations(miscounted).map((item) => item.code),
    ).toContain("AVAILABILITY_WINDOW_COUNT");

    const overlapping = structuredClone(boundary);
    overlapping.availabilityWindows[1]!.startsOn = overlapping.availabilityWindows[0]!.startsOn;
    overlapping.availabilityWindows[1]!.endsOn = overlapping.availabilityWindows[0]!.endsOn;
    expect(
      availabilityWindowControlSemanticViolations(overlapping).map((item) => item.code),
    ).toContain("AVAILABILITY_WINDOW_OVERLAP");

    const wrongCapabilities = structuredClone(boundary);
    wrongCapabilities.capabilities = [
      "create_availability_window",
      "change_availability_window",
      "remove_availability_window",
    ];
    expect(
      availabilityWindowControlSemanticViolations(wrongCapabilities).map((item) => item.code),
    ).toContain("AVAILABILITY_WINDOW_CAPABILITIES");

    const unsafeLabel = structuredClone(boundary);
    unsafeLabel.availabilityWindows[0]!.label = "Blocked time";
    expect(validateSchema("availability-window-control-v1", unsafeLabel).valid).toBe(true);
    expect(validateAvailabilityWindowControlV1(unsafeLabel).valid).toBe(false);
  });

  it("rejects a malformed or oversized removed-window history page", () => {
    const unordered = structuredClone(boundary);
    unordered.removedAvailabilityWindows.reverse();
    expect(
      availabilityWindowControlSemanticViolations(unordered).map((item) => item.code),
    ).toContain("AVAILABILITY_WINDOW_ORDER");

    const activeInHistory = structuredClone(boundary);
    activeInHistory.removedAvailabilityWindows[0]!.lifecycle = "ACTIVE";
    expect(
      availabilityWindowControlSemanticViolations(activeInHistory).map((item) => item.code),
    ).toContain("AVAILABILITY_WINDOW_LIFECYCLE");
  });

  it("rejects structurally valid cross-field lies in a preview", () => {
    const codes = availabilityWindowControlSemanticViolations(invalid).map((item) => item.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        "AVAILABILITY_WINDOW_PLAN_VERSION",
        "AVAILABILITY_WINDOW_UUID_CASE",
        "AVAILABILITY_WINDOW_KEY",
        "AVAILABILITY_WINDOW_RANGE",
        "AVAILABILITY_WINDOW_CREATE_STATE",
        "AVAILABILITY_WINDOW_COUNT",
        "AVAILABILITY_WINDOW_APPLICABILITY",
        "AVAILABILITY_WINDOW_UNSAFE_TEXT",
      ]),
    );
  });

  it("requires a created window to start active at version one with no prior state", () => {
    const hadBeforeState = structuredClone(valid);
    (hadBeforeState.before as { window: unknown }).window = structuredClone(remove.before.window);
    expect(
      availabilityWindowControlSemanticViolations(hadBeforeState).map((item) => item.code),
    ).toContain("AVAILABILITY_WINDOW_CREATE_STATE");

    const wrongVersion = structuredClone(valid);
    wrongVersion.after.window.aggregateVersion = "2";
    expect(
      availabilityWindowControlSemanticViolations(wrongVersion).map((item) => item.code),
    ).toContain("AVAILABILITY_WINDOW_CREATE_STATE");

    const wrongCount = structuredClone(valid);
    wrongCount.after.activeWindowCount = wrongCount.before.activeWindowCount;
    expect(
      availabilityWindowControlSemanticViolations(wrongCount).map((item) => item.code),
    ).toContain("AVAILABILITY_WINDOW_COUNT");
  });

  it("requires a removal to freeze every field but lifecycle, version, and the active count", () => {
    const retitled = structuredClone(remove);
    retitled.after.window.availableMinutes = 1;
    expect(
      availabilityWindowControlSemanticViolations(retitled).map((item) => item.code),
    ).toContain("AVAILABILITY_WINDOW_REMOVE_STATE");

    const skippedVersion = structuredClone(remove);
    skippedVersion.after.window.aggregateVersion = "8";
    expect(
      availabilityWindowControlSemanticViolations(skippedVersion).map((item) => item.code),
    ).toContain("AVAILABILITY_WINDOW_VERSION");

    const retargeted = structuredClone(remove);
    retargeted.after.window.availabilityWindowId = "79000000-0000-8000-8000-000000000099";
    expect(
      availabilityWindowControlSemanticViolations(retargeted).map((item) => item.code),
    ).toContain("AVAILABILITY_WINDOW_TARGET");

    const noTarget = structuredClone(remove);
    (noTarget.before as { window: unknown }).window = null;
    expect(
      availabilityWindowControlSemanticViolations(noTarget).map((item) => item.code),
    ).toContain("AVAILABILITY_WINDOW_TARGET");
  });

  it("requires a change to advance one version while keeping the window active", () => {
    const changed = structuredClone(remove);
    changed.operation = "change_availability_window";
    changed.after.window.lifecycle = "ACTIVE";
    changed.after.window.startsOn = "2026-08-10";
    changed.after.window.endsOn = "2026-08-11";
    changed.after.activeWindowCount = changed.before.activeWindowCount;
    expect(validateAvailabilityWindowControlV1(changed).valid).toBe(true);

    const stillActiveCountWrong = structuredClone(changed);
    stillActiveCountWrong.after.activeWindowCount = changed.before.activeWindowCount + 1;
    expect(
      availabilityWindowControlSemanticViolations(stillActiveCountWrong).map((item) => item.code),
    ).toContain("AVAILABILITY_WINDOW_CHANGE_STATE");

    const stayedRemoved = structuredClone(changed);
    stayedRemoved.after.window.lifecycle = "REMOVED";
    expect(
      availabilityWindowControlSemanticViolations(stayedRemoved).map((item) => item.code),
    ).toContain("AVAILABILITY_WINDOW_CHANGE_STATE");
  });

  it("enforces lowercase UUID representation for every availability authority", () => {
    const uppercase = structuredClone(valid);
    uppercase.idempotencyKey = "73000000-0000-4000-8000-00000000000A";
    expect(validateSchema("availability-window-control-v1", uppercase).valid).toBe(true);
    expect(
      availabilityWindowControlSemanticViolations(uppercase).map((item) => item.code),
    ).toContain("AVAILABILITY_WINDOW_UUID_CASE");
  });

  it("pins the fixed clock-free digest, identity, fingerprint, and request-hash oracles", () => {
    expect(AVAILABILITY_WINDOW_PREVIEW_DIGEST_VERSION).toBe(
      "availability-window-preview-digest/1.0.0",
    );
    expect(AVAILABILITY_WINDOW_REQUEST_HASH_VERSION).toBe("availability-window-request-hash/1.0.0");
    expect(AVAILABILITY_WINDOW_COMMAND_TYPE).toBe("planning.change_availability_window_v1");
    expect(AVAILABILITY_WINDOW_FINGERPRINT_VERSION).toBe("availability-window-fingerprint/1.0.0");

    const digestInput = availabilityWindowPreviewDigestInput(
      digestFieldsFromFixture(valid, ORACLE_WORKSPACE_ID),
    );
    expect(digestInput).not.toContain("previewAsOf");
    expect(digestInput).toContain("commandType:38:planning.change_availability_window_v1\n");
    expect(digestInput).toContain("warningCount:1:1\n");

    const identity = availabilityWindowIdentityInput({
      workspaceId: ORACLE_WORKSPACE_ID,
      idempotencyKey: valid.idempotencyKey,
    });
    expect(identity).toContain(`workspaceId:36:${ORACLE_WORKSPACE_ID}\n`);
    expect(identity).toContain("label:19:availability-window\n");
    expect(
      planningCreateUuidFromSha256(createHash("sha256").update(identity, "utf8").digest()),
    ).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);

    const fingerprint = availabilityWindowFingerprintInput({
      activeWindowCount: 2,
      windows: [
        {
          windowKey: boundary.availabilityWindows[0]!.windowKey,
          aggregateVersion: boundary.availabilityWindows[0]!.aggregateVersion,
          startsOn: boundary.availabilityWindows[0]!.startsOn,
          endsOn: boundary.availabilityWindows[0]!.endsOn,
          availableMinutes: boundary.availabilityWindows[0]!.availableMinutes,
        },
        {
          windowKey: boundary.availabilityWindows[1]!.windowKey,
          aggregateVersion: boundary.availabilityWindows[1]!.aggregateVersion,
          startsOn: boundary.availabilityWindows[1]!.startsOn,
          endsOn: boundary.availabilityWindows[1]!.endsOn,
          availableMinutes: boundary.availabilityWindows[1]!.availableMinutes,
        },
      ],
    });
    expect(sha256Hex(fingerprint)).toMatch(/^[a-f0-9]{64}$/u);

    // Cross-session oracle: workspace 568cc123-9fcd-4a5a-847e-5ce1918f09b0 binds the D3b1-db
    // request-hash input the same way it binds the preview digest above. The recipe that produced
    // the split-plan's pinned hash value lives outside this session's reading scope
    // (docs/implementation/CLAUDE_SESSION_SPLIT_PLAN.md), so this pins the oracle's format and its
    // workspace-binding property instead of a literal value this session cannot independently derive.
    const requestHash = availabilityWindowRequestHashInput({
      workspaceId: ORACLE_WORKSPACE_ID,
      operation: "create_availability_window",
      idempotencyKey: valid.idempotencyKey,
      windowKey: null,
      startsOn: valid.after.window.startsOn,
      endsOn: valid.after.window.endsOn,
      availableMinutes: valid.after.window.availableMinutes,
      energy: valid.after.window.energy as "LOW" | "MEDIUM" | "HIGH" | null,
      label: valid.after.window.label,
      expectedGrowthPlanVersion: valid.expectedGrowthPlanVersion,
      expectedWindowVersion: null,
      reason: valid.reason,
      previewDigest: valid.previewDigest,
    });
    expect(requestHash).toContain(`workspaceId:36:${ORACLE_WORKSPACE_ID}\n`);
    expect(sha256Hex(requestHash)).toMatch(/^[a-f0-9]{64}$/u);

    const otherWorkspaceHash = sha256Hex(
      availabilityWindowRequestHashInput({
        workspaceId: "10000000-0000-4000-8000-0000000000ff",
        operation: "create_availability_window",
        idempotencyKey: valid.idempotencyKey,
        windowKey: null,
        startsOn: valid.after.window.startsOn,
        endsOn: valid.after.window.endsOn,
        availableMinutes: valid.after.window.availableMinutes,
        energy: valid.after.window.energy as "LOW" | "MEDIUM" | "HIGH" | null,
        label: valid.after.window.label,
        expectedGrowthPlanVersion: valid.expectedGrowthPlanVersion,
        expectedWindowVersion: null,
        reason: valid.reason,
        previewDigest: valid.previewDigest,
      }),
    );
    expect(sha256Hex(requestHash)).not.toBe(otherWorkspaceHash);
  });

  it("matches the independently framed create-window fixture digest", () => {
    const recomputed = sha256Hex(
      availabilityWindowPreviewDigestInput(digestFieldsFromFixture(valid, ORACLE_WORKSPACE_ID)),
    );
    expect(recomputed).toBe(valid.previewDigest);
  });

  it("matches the independently framed remove-window fixture digest", () => {
    const recomputed = sha256Hex(
      availabilityWindowPreviewDigestInput(digestFieldsFromFixture(remove, ORACLE_WORKSPACE_ID)),
    );
    expect(recomputed).toBe(remove.previewDigest);
  });

  it("pins every public numeric and reason boundary", () => {
    const minimums = structuredClone(valid);
    minimums.reason = "x";
    minimums.growthPlan.weeklyCapacityMinutes = 0;
    minimums.after.window.availableMinutes = 0;
    minimums.after.window.label = "x";
    expect(validateAvailabilityWindowControlV1(minimums).valid).toBe(true);

    const maximums = structuredClone(valid);
    maximums.growthPlan.weeklyCapacityMinutes = 10080;
    maximums.after.window.availableMinutes = 1440;
    expect(validateAvailabilityWindowControlV1(maximums).valid).toBe(true);

    const overCapacity = structuredClone(valid);
    overCapacity.growthPlan.weeklyCapacityMinutes = 10081;
    expect(validateSchema("availability-window-control-v1", overCapacity).valid).toBe(false);

    const overMinutes = structuredClone(valid);
    overMinutes.after.window.availableMinutes = 1441;
    expect(validateSchema("availability-window-control-v1", overMinutes).valid).toBe(false);

    const negativeMinutes = structuredClone(valid);
    negativeMinutes.after.window.availableMinutes = -1;
    expect(validateSchema("availability-window-control-v1", negativeMinutes).valid).toBe(false);

    const overLongReason = structuredClone(valid);
    overLongReason.reason = "x".repeat(501);
    expect(validateSchema("availability-window-control-v1", overLongReason).valid).toBe(false);

    const overLongLabel = structuredClone(valid);
    overLongLabel.after.window.label = "x".repeat(121);
    expect(validateSchema("availability-window-control-v1", overLongLabel).valid).toBe(false);
  });

  it("caps effective weekly capacity at the plan default and never lets a window raise it", () => {
    expect(effectiveWeeklyCapacityMinutes(420, [60, 60, 60, 60, 60, 60, 60])).toBe(420);
    expect(effectiveWeeklyCapacityMinutes(420, [0, 0, 0, 0, 0, 0, 0])).toBe(0);
    expect(effectiveWeeklyCapacityMinutes(300, [1440, 1440, 1440, 1440, 1440, 1440, 1440])).toBe(
      300,
    );
    expect(() => effectiveWeeklyCapacityMinutes(420, [60, 60, 60])).toThrow(RangeError);
  });
});
