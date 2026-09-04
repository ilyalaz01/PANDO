// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  InterviewCampaignsContractError,
  decodeInterviewCampaignsV1,
  interviewCampaignsSemanticViolations,
  validateInterviewCampaignsV1,
} from "../../src/shared/contracts/interview-campaigns";
import { validateSchema } from "../../src/shared/contracts/schema-registry";
import boundary from "./fixtures/interview-campaign/v1/interview-campaigns.boundary.json";
import invalid from "./fixtures/interview-campaign/v1/interview-campaigns.invalid.json";
import malicious from "./fixtures/interview-campaign/v1/interview-campaigns.malicious.json";
import valid from "./fixtures/interview-campaign/v1/interview-campaigns.valid.json";

describe("PANDO Interview Campaigns V1", () => {
  it("keeps valid, boundary, invalid, and malicious fixtures executable", () => {
    expect(validateSchema("interview-campaigns-v1", valid).valid).toBe(true);
    expect(validateSchema("interview-campaigns-v1", boundary).valid).toBe(true);
    expect(validateSchema("interview-campaigns-v1", invalid).valid).toBe(true);
    expect(validateSchema("interview-campaigns-v1", malicious).valid).toBe(false);
    expect(validateInterviewCampaignsV1(valid).valid).toBe(true);
    expect(validateInterviewCampaignsV1(boundary).valid).toBe(true);
    expect(validateInterviewCampaignsV1(invalid).valid).toBe(false);
    expect(decodeInterviewCampaignsV1(valid)).toEqual(valid);
    expect(() => decodeInterviewCampaignsV1(invalid)).toThrow(InterviewCampaignsContractError);
  });

  it("permits zero campaigns", () => {
    const empty = { contract: { name: "InterviewCampaignsV1", version: "1.0.0" }, campaigns: [] };
    expect(validateSchema("interview-campaigns-v1", empty).valid).toBe(true);
    expect(interviewCampaignsSemanticViolations(empty)).toEqual([]);
  });

  it("clears capabilities for every terminal lifecycle in the boundary fixture", () => {
    for (const campaign of boundary.campaigns) {
      expect(campaign.capabilities).toEqual([]);
      expect(["ENDED", "CANCELLED"]).toContain(campaign.lifecycle);
    }
    expect(interviewCampaignsSemanticViolations(boundary)).toEqual([]);
  });

  it("requires capabilities to exactly match the campaign's own lifecycle", () => {
    expect(invalid.campaigns[0]!.lifecycle).toBe("DRAFT");
    expect(invalid.campaigns[0]!.capabilities).toContain("end_campaign");
    expect(interviewCampaignsSemanticViolations(invalid)).toContainEqual(
      expect.objectContaining({ code: "INTERVIEW_CAMPAIGN_CAPABILITIES" }),
    );
  });
});
