// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  CampaignAllocationOverridesContractError,
  campaignAllocationOverridesSemanticViolations,
  decodeCampaignAllocationOverridesV1,
  validateCampaignAllocationOverridesV1,
} from "../../src/shared/contracts/campaign-allocation-overrides";
import { validateSchema } from "../../src/shared/contracts/schema-registry";
import boundary from "./fixtures/planning/v1/campaign-allocation-overrides.boundary.json";
import invalid from "./fixtures/planning/v1/campaign-allocation-overrides.invalid.json";
import malicious from "./fixtures/planning/v1/campaign-allocation-overrides.malicious.json";
import valid from "./fixtures/planning/v1/campaign-allocation-overrides.valid.json";

describe("CampaignAllocationOverridesV1", () => {
  it("keeps valid, boundary, invalid, and malicious fixtures executable", () => {
    expect(validateSchema("campaign-allocation-overrides-v1", valid).valid).toBe(true);
    expect(validateSchema("campaign-allocation-overrides-v1", boundary).valid).toBe(true);
    expect(validateSchema("campaign-allocation-overrides-v1", invalid).valid).toBe(true);
    expect(validateSchema("campaign-allocation-overrides-v1", malicious).valid).toBe(false);
    expect(validateCampaignAllocationOverridesV1(valid).valid).toBe(true);
    expect(validateCampaignAllocationOverridesV1(boundary).valid).toBe(true);
    expect(validateCampaignAllocationOverridesV1(invalid).valid).toBe(false);
    expect(decodeCampaignAllocationOverridesV1(valid)).toEqual(valid);
    expect(() => decodeCampaignAllocationOverridesV1(invalid)).toThrow(
      CampaignAllocationOverridesContractError,
    );
  });

  it("accepts an empty override history as the boundary case", () => {
    expect(boundary.overrides).toEqual([]);
    expect(campaignAllocationOverridesSemanticViolations(boundary)).toEqual([]);
  });

  it("rejects a superseded row that still claims live capabilities", () => {
    expect(campaignAllocationOverridesSemanticViolations(invalid)).toContainEqual(
      expect.objectContaining({ code: "CAMPAIGN_ALLOCATION_OVERRIDE_CAPABILITIES" }),
    );
  });
});
