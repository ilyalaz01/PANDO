// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  InterviewCampaignRetargetContractError,
  decodeInterviewCampaignRetargetApplyResultV1,
  decodeInterviewCampaignRetargetPreviewV1,
  interviewCampaignRetargetControlSemanticViolations,
  validateInterviewCampaignRetargetControlV1,
} from "../../src/shared/contracts/interview-campaign-retarget-control";
import { validateSchema } from "../../src/shared/contracts/schema-registry";
import apply from "./fixtures/interview-campaign/v1/interview-campaign-retarget-control.apply.json";
import boundary from "./fixtures/interview-campaign/v1/interview-campaign-retarget-control.boundary.json";
import invalid from "./fixtures/interview-campaign/v1/interview-campaign-retarget-control.invalid.json";
import malicious from "./fixtures/interview-campaign/v1/interview-campaign-retarget-control.malicious.json";
import valid from "./fixtures/interview-campaign/v1/interview-campaign-retarget-control.valid.json";

describe("PANDO Interview Campaign Retarget Control V1", () => {
  it("keeps valid, boundary, apply, invalid, and malicious fixtures executable", () => {
    expect(validateSchema("interview-campaign-retarget-control-v1", valid).valid).toBe(true);
    expect(validateSchema("interview-campaign-retarget-control-v1", boundary).valid).toBe(true);
    expect(validateSchema("interview-campaign-retarget-control-v1", apply).valid).toBe(true);
    expect(validateSchema("interview-campaign-retarget-control-v1", invalid).valid).toBe(true);
    expect(validateSchema("interview-campaign-retarget-control-v1", malicious).valid).toBe(false);
    expect(validateInterviewCampaignRetargetControlV1(valid).valid).toBe(true);
    expect(validateInterviewCampaignRetargetControlV1(boundary).valid).toBe(true);
    expect(validateInterviewCampaignRetargetControlV1(apply).valid).toBe(true);
    expect(validateInterviewCampaignRetargetControlV1(invalid).valid).toBe(false);
    expect(decodeInterviewCampaignRetargetPreviewV1(valid)).toEqual(valid);
    expect(decodeInterviewCampaignRetargetApplyResultV1(apply)).toEqual(apply);
    expect(() => decodeInterviewCampaignRetargetPreviewV1(invalid)).toThrow(
      InterviewCampaignRetargetContractError,
    );
  });

  it("refuses a retarget onto the identical Readiness Goal", () => {
    expect(invalid.before.readinessGoal.readinessGoalId).toBe(
      invalid.after.readinessGoal.readinessGoalId,
    );
    expect(interviewCampaignRetargetControlSemanticViolations(invalid)).toContainEqual(
      expect.objectContaining({ code: "INTERVIEW_CAMPAIGN_RETARGET_SAME_GOAL" }),
    );
  });

  it("accepts a later revision number on a draft campaign at the boundary", () => {
    expect(boundary.after.revisionNumber).toBe(3);
    expect(interviewCampaignRetargetControlSemanticViolations(boundary)).toEqual([]);
  });

  it("requires the transition to advance exactly one version and change nothing else", () => {
    const relabeled = { ...valid, after: { ...valid.after, title: "Renamed loop" } };
    expect(interviewCampaignRetargetControlSemanticViolations(relabeled)).toContainEqual(
      expect.objectContaining({ code: "INTERVIEW_CAMPAIGN_RETARGET_TRANSITION" }),
    );
  });

  it("rejects an unsupported contract name", () => {
    const unnamed = { ...valid, contract: { name: "SomethingElse", version: "1.0.0" } };
    expect(interviewCampaignRetargetControlSemanticViolations(unnamed)).toContainEqual(
      expect.objectContaining({ code: "INTERVIEW_CAMPAIGN_CONTRACT" }),
    );
  });
});
