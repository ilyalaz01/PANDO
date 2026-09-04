// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  InterviewCampaignCreationContractError,
  decodeInterviewCampaignCreationApplyResultV1,
  decodeInterviewCampaignCreationPreviewV1,
  interviewCampaignCreationControlSemanticViolations,
  validateInterviewCampaignCreationControlV1,
} from "../../src/shared/contracts/interview-campaign-creation-control";
import { validateSchema } from "../../src/shared/contracts/schema-registry";
import apply from "./fixtures/interview-campaign/v1/interview-campaign-creation-control.apply.json";
import boundary from "./fixtures/interview-campaign/v1/interview-campaign-creation-control.boundary.json";
import invalid from "./fixtures/interview-campaign/v1/interview-campaign-creation-control.invalid.json";
import malicious from "./fixtures/interview-campaign/v1/interview-campaign-creation-control.malicious.json";
import valid from "./fixtures/interview-campaign/v1/interview-campaign-creation-control.valid.json";

describe("PANDO Interview Campaign Creation Control V1", () => {
  it("keeps valid, boundary, apply, invalid, and malicious fixtures executable", () => {
    expect(validateSchema("interview-campaign-creation-control-v1", valid).valid).toBe(true);
    expect(validateSchema("interview-campaign-creation-control-v1", boundary).valid).toBe(true);
    expect(validateSchema("interview-campaign-creation-control-v1", apply).valid).toBe(true);
    expect(validateSchema("interview-campaign-creation-control-v1", invalid).valid).toBe(true);
    expect(validateSchema("interview-campaign-creation-control-v1", malicious).valid).toBe(false);
    expect(validateInterviewCampaignCreationControlV1(valid).valid).toBe(true);
    expect(validateInterviewCampaignCreationControlV1(boundary).valid).toBe(true);
    expect(validateInterviewCampaignCreationControlV1(apply).valid).toBe(true);
    expect(validateInterviewCampaignCreationControlV1(invalid).valid).toBe(false);
    expect(decodeInterviewCampaignCreationPreviewV1(valid)).toEqual(valid);
    expect(decodeInterviewCampaignCreationApplyResultV1(apply)).toEqual(apply);
    expect(() => decodeInterviewCampaignCreationPreviewV1(invalid)).toThrow(
      InterviewCampaignCreationContractError,
    );
  });

  it("reflects applicability exactly through the identity-collision blocker", () => {
    expect(boundary.canApply).toBe(false);
    expect(boundary.blockingReasons).toEqual([{ code: "TARGETS_CREATE_IDENTITY_COLLISION" }]);
    expect(interviewCampaignCreationControlSemanticViolations(boundary)).toEqual([]);
    const mismatched = { ...boundary, canApply: true };
    expect(interviewCampaignCreationControlSemanticViolations(mismatched)).toContainEqual(
      expect.objectContaining({ code: "INTERVIEW_CAMPAIGN_APPLICABILITY" }),
    );
  });

  it("binds the created campaign key to its own derived identity", () => {
    const rebound = structuredClone(valid);
    rebound.after.campaignKey = "campaign:70000000-0000-8000-8000-000000000099";
    expect(validateSchema("interview-campaign-creation-control-v1", rebound).valid).toBe(true);
    expect(interviewCampaignCreationControlSemanticViolations(rebound)).toContainEqual(
      expect.objectContaining({ code: "INTERVIEW_CAMPAIGN_KEY_BINDING" }),
    );
  });

  it("rejects an unsupported contract name", () => {
    const unnamed = { ...valid, contract: { name: "SomethingElse", version: "1.0.0" } };
    expect(interviewCampaignCreationControlSemanticViolations(unnamed)).toContainEqual(
      expect.objectContaining({ code: "INTERVIEW_CAMPAIGN_CONTRACT" }),
    );
  });
});
