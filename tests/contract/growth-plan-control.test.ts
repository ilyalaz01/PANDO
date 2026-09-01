// @vitest-environment node

import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { growthPlanLifecyclePreviewDigestInput } from "../../src/modules/planning/domain/growth-plan-lifecycle-preview";
import {
  activeTrackConstraintFingerprintInput,
  growthPlanCapacityPreviewDigestInput,
} from "../../src/modules/planning/domain/growth-plan-capacity-preview";
import {
  growthPlanCapacityControlSemanticViolations,
  growthPlanControlSemanticViolations,
} from "../../src/shared/contracts/growth-plan-control";
import { validateSchema } from "../../src/shared/contracts/schema-registry";
import boundary from "./fixtures/planning/v1/growth-plan-control.boundary.json";
import invalid from "./fixtures/planning/v1/growth-plan-control.invalid.json";
import malicious from "./fixtures/planning/v1/growth-plan-control.malicious.json";
import valid from "./fixtures/planning/v1/growth-plan-control.valid.json";
import capacityBoundary from "./fixtures/planning/v1/growth-plan-capacity-control.boundary.json";
import capacityInvalid from "./fixtures/planning/v1/growth-plan-capacity-control.invalid.json";
import capacityMalicious from "./fixtures/planning/v1/growth-plan-capacity-control.malicious.json";
import capacityValid from "./fixtures/planning/v1/growth-plan-capacity-control.valid.json";

describe("PANDO Growth Plan Control V1", () => {
  it("keeps valid, boundary, invalid, and malicious fixtures executable", () => {
    expect(validateSchema("growth-plan-control-v1", valid).valid).toBe(true);
    expect(validateSchema("growth-plan-control-v1", boundary).valid).toBe(true);
    expect(validateSchema("growth-plan-control-v1", invalid).valid).toBe(false);
    expect(validateSchema("growth-plan-control-v1", malicious).valid).toBe(false);
    expect(growthPlanControlSemanticViolations(valid)).toEqual([]);
    expect(growthPlanControlSemanticViolations(boundary)).toEqual([]);
  });

  it("rejects a structurally valid preview that lies about transition or versions", () => {
    const changed = structuredClone(valid);
    changed.after.lifecycle = "ACTIVE";
    changed.after.aggregateVersion = "6";
    expect(validateSchema("growth-plan-control-v1", changed).valid).toBe(true);
    expect(growthPlanControlSemanticViolations(changed)).toEqual([
      "GROWTH_PLAN_PREVIEW_TRANSITION",
      "GROWTH_PLAN_PREVIEW_VERSION_ADVANCE",
    ]);
  });

  it("rejects control characters even when a generic JSON Schema string pattern accepts them", () => {
    const changed = structuredClone(valid);
    changed.reason = "Pause\nnow";
    expect(validateSchema("growth-plan-control-v1", changed).valid).toBe(true);
    expect(growthPlanControlSemanticViolations(changed)).toContain("GROWTH_PLAN_PREVIEW_REASON");
  });

  it("rejects decimal versions above PostgreSQL bigint", () => {
    const changed = structuredClone(valid);
    changed.after.aggregateVersion = "9223372036854775808";
    expect(validateSchema("growth-plan-control-v1", changed).valid).toBe(false);
  });

  it("fixes the digest field order and UTF-8 byte-length protocol", () => {
    const input = growthPlanLifecyclePreviewDigestInput({
      workspaceId: "30000000-0000-4000-8000-000000000001",
      operation: "pause_growth_plan",
      reason: "Pause — confirmed",
      growthPlanId: "30000000-0000-4000-8000-000000000020",
      beforeAggregateVersion: "4",
      afterAggregateVersion: "5",
      beforeLifecycle: "ACTIVE",
      afterLifecycle: "PAUSED",
      title: "Backend readiness",
      weeklyCapacityMinutes: 600,
    });
    expect(input).toContain("reason:19:Pause — confirmed\n");
    expect(createHash("sha256").update(input, "utf8").digest("hex")).toBe(
      "0d897f054cad2c84b2edc4935999f6a05b5bd8d104290d11592d8f47eeb73b6f",
    );
  });
});

describe("PANDO Growth Plan Capacity Control V1", () => {
  it("keeps valid, boundary, invalid, and malicious fixtures executable", () => {
    expect(validateSchema("growth-plan-capacity-control-v1", capacityValid).valid).toBe(true);
    expect(validateSchema("growth-plan-capacity-control-v1", capacityBoundary).valid).toBe(true);
    expect(validateSchema("growth-plan-capacity-control-v1", capacityInvalid).valid).toBe(false);
    expect(validateSchema("growth-plan-capacity-control-v1", capacityMalicious).valid).toBe(false);
    expect(growthPlanCapacityControlSemanticViolations(capacityValid)).toEqual([]);
    expect(growthPlanCapacityControlSemanticViolations(capacityBoundary)).toEqual([]);
  });

  it("rejects structurally valid no-op, version, and applicability lies", () => {
    const changed = structuredClone(capacityValid);
    changed.after.weeklyCapacityMinutes = 600;
    changed.after.aggregateVersion = "4";
    changed.constraint.flexibleMinutesAfter = 450;
    changed.canApply = false;
    expect(validateSchema("growth-plan-capacity-control-v1", changed).valid).toBe(true);
    expect(growthPlanCapacityControlSemanticViolations(changed)).toEqual(
      expect.arrayContaining([
        "GROWTH_PLAN_CAPACITY_PREVIEW_NOOP",
        "GROWTH_PLAN_CAPACITY_PREVIEW_VERSION_ADVANCE",
        "GROWTH_PLAN_CAPACITY_PREVIEW_APPLICABILITY",
      ]),
    );
  });

  it("accepts an exact active protected minimum", () => {
    const changed = structuredClone(capacityValid);
    changed.after.weeklyCapacityMinutes = 150;
    changed.constraint.flexibleMinutesAfter = 0;
    expect(validateSchema("growth-plan-capacity-control-v1", changed).valid).toBe(true);
    expect(growthPlanCapacityControlSemanticViolations(changed)).toEqual([]);
  });

  it("fixes active-track ordering and capacity preview digest inputs", () => {
    const fingerprintInput = activeTrackConstraintFingerprintInput([
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
    expect(fingerprintInput.indexOf("000000000031")).toBeLessThan(
      fingerprintInput.indexOf("000000000032"),
    );
    const fingerprint = createHash("sha256").update(fingerprintInput, "utf8").digest("hex");
    expect(fingerprint).toBe("5a0ef16ebb323cbb8b452ad620476487560b46b51fe23659ca9ceb3264387849");

    const digestInput = growthPlanCapacityPreviewDigestInput({
      workspaceId: "30000000-0000-4000-8000-000000000001",
      reason: "Reserve — confirmed",
      growthPlanId: "30000000-0000-4000-8000-000000000020",
      beforeAggregateVersion: "4",
      afterAggregateVersion: "5",
      title: "Backend readiness",
      beforeLifecycle: "ACTIVE",
      afterLifecycle: "ACTIVE",
      beforeWeeklyCapacityMinutes: 600,
      afterWeeklyCapacityMinutes: 480,
      activeTrackCount: 2,
      activeProtectedMinimumMinutes: 150,
      flexibleMinutesBefore: 450,
      flexibleMinutesAfter: 330,
      activeTrackFingerprint: fingerprint,
      canApply: true,
      blockingReason: undefined,
    });
    expect(digestInput).toContain("reason:21:Reserve — confirmed\n");
    expect(createHash("sha256").update(digestInput, "utf8").digest("hex")).toBe(
      "221555ef5b5c99d6517005ebb6bba36690adaea7f27580b9c1661f24cc7e7dc3",
    );
  });
});
