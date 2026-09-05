// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  CampaignAllocationOverrideContractError,
  campaignAllocationOverrideControlSemanticViolations,
  decodeCampaignAllocationOverrideChangeApplyResultV1,
  decodeCampaignAllocationOverrideChangePreviewV1,
  validateCampaignAllocationOverrideControlV1,
} from "../../src/shared/contracts/campaign-allocation-override-control";
import { validateSchema } from "../../src/shared/contracts/schema-registry";
import apply from "./fixtures/planning/v1/campaign-allocation-override-control.apply.json";
import boundary from "./fixtures/planning/v1/campaign-allocation-override-control.boundary.json";
import invalid from "./fixtures/planning/v1/campaign-allocation-override-control.invalid.json";
import malicious from "./fixtures/planning/v1/campaign-allocation-override-control.malicious.json";
import valid from "./fixtures/planning/v1/campaign-allocation-override-control.valid.json";

describe("PANDO Campaign Allocation Override Control V1", () => {
  it("keeps valid, boundary, apply, invalid, and malicious fixtures executable", () => {
    expect(validateSchema("campaign-allocation-override-control-v1", valid).valid).toBe(true);
    expect(validateSchema("campaign-allocation-override-control-v1", boundary).valid).toBe(true);
    expect(validateSchema("campaign-allocation-override-control-v1", apply).valid).toBe(true);
    expect(validateSchema("campaign-allocation-override-control-v1", invalid).valid).toBe(true);
    expect(validateSchema("campaign-allocation-override-control-v1", malicious).valid).toBe(false);
    expect(validateCampaignAllocationOverrideControlV1(valid).valid).toBe(true);
    expect(validateCampaignAllocationOverrideControlV1(boundary).valid).toBe(true);
    expect(validateCampaignAllocationOverrideControlV1(apply).valid).toBe(true);
    expect(validateCampaignAllocationOverrideControlV1(invalid).valid).toBe(false);
    expect(decodeCampaignAllocationOverrideChangePreviewV1(valid)).toEqual(valid);
    expect(decodeCampaignAllocationOverrideChangeApplyResultV1(apply)).toEqual(apply);
    expect(() => decodeCampaignAllocationOverrideChangePreviewV1(invalid)).toThrow(
      CampaignAllocationOverrideContractError,
    );
  });

  it("accepts a blocked preview whose capacity would be exceeded as the boundary case", () => {
    expect(boundary.canApply).toBe(false);
    expect(boundary.blockingReasons).toEqual([{ code: "ALLOCATION_OVERRIDE_EXCEEDS_CAPACITY" }]);
    expect(campaignAllocationOverrideControlSemanticViolations(boundary)).toEqual([]);
  });

  it("rejects a preview that skips an aggregate version", () => {
    expect(campaignAllocationOverrideControlSemanticViolations(invalid)).toContainEqual(
      expect.objectContaining({ code: "CAMPAIGN_ALLOCATION_OVERRIDE_TRANSITION" }),
    );
  });

  it("rejects removal that changes the retained override values", () => {
    const removal = {
      ...valid,
      operation: "remove_campaign_allocation_override",
      after: { ...valid.after, lifecycle: "REMOVED", priorityOverride: 10 },
    };
    expect(campaignAllocationOverrideControlSemanticViolations(removal)).toContainEqual(
      expect.objectContaining({ code: "CAMPAIGN_ALLOCATION_OVERRIDE_REMOVAL_VALUES" }),
    );
  });

  it("requires the override key to bind its own derived identity", () => {
    const unbound = {
      ...valid,
      after: { ...valid.after, overrideKey: "override:99999999-0000-8000-8000-000000000009" },
    };
    expect(campaignAllocationOverrideControlSemanticViolations(unbound)).toContainEqual(
      expect.objectContaining({ code: "CAMPAIGN_ALLOCATION_OVERRIDE_KEY_BINDING" }),
    );
  });

  it("rejects an unsupported contract name", () => {
    const unnamed = { ...valid, contract: { name: "SomethingElse", version: "1.0.0" } };
    expect(campaignAllocationOverrideControlSemanticViolations(unnamed)).toContainEqual(
      expect.objectContaining({ code: "CAMPAIGN_ALLOCATION_OVERRIDE_CONTRACT" }),
    );
  });
});
