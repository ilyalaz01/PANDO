// @vitest-environment node

import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { growthPlanLifecyclePreviewDigestInput } from "../../src/modules/planning/domain/growth-plan-lifecycle-preview";
import { growthPlanControlSemanticViolations } from "../../src/shared/contracts/growth-plan-control";
import { validateSchema } from "../../src/shared/contracts/schema-registry";
import boundary from "./fixtures/planning/v1/growth-plan-control.boundary.json";
import invalid from "./fixtures/planning/v1/growth-plan-control.invalid.json";
import malicious from "./fixtures/planning/v1/growth-plan-control.malicious.json";
import valid from "./fixtures/planning/v1/growth-plan-control.valid.json";

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
