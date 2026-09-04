// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  InterviewCampaignLifecycleContractError,
  decodeInterviewCampaignLifecycleApplyResultV1,
  decodeInterviewCampaignLifecyclePreviewV1,
  interviewCampaignLifecycleControlSemanticViolations,
  validateInterviewCampaignLifecycleControlV1,
} from "../../src/shared/contracts/interview-campaign-lifecycle-control";
import { validateSchema } from "../../src/shared/contracts/schema-registry";
import apply from "./fixtures/interview-campaign/v1/interview-campaign-lifecycle-control.apply.json";
import boundary from "./fixtures/interview-campaign/v1/interview-campaign-lifecycle-control.boundary.json";
import invalid from "./fixtures/interview-campaign/v1/interview-campaign-lifecycle-control.invalid.json";
import malicious from "./fixtures/interview-campaign/v1/interview-campaign-lifecycle-control.malicious.json";
import valid from "./fixtures/interview-campaign/v1/interview-campaign-lifecycle-control.valid.json";

describe("PANDO Interview Campaign Lifecycle Control V1", () => {
  it("keeps valid, boundary, apply, invalid, and malicious fixtures executable", () => {
    expect(validateSchema("interview-campaign-lifecycle-control-v1", valid).valid).toBe(true);
    expect(validateSchema("interview-campaign-lifecycle-control-v1", boundary).valid).toBe(true);
    expect(validateSchema("interview-campaign-lifecycle-control-v1", apply).valid).toBe(true);
    expect(validateSchema("interview-campaign-lifecycle-control-v1", invalid).valid).toBe(true);
    expect(validateSchema("interview-campaign-lifecycle-control-v1", malicious).valid).toBe(false);
    expect(validateInterviewCampaignLifecycleControlV1(valid).valid).toBe(true);
    expect(validateInterviewCampaignLifecycleControlV1(boundary).valid).toBe(true);
    expect(validateInterviewCampaignLifecycleControlV1(apply).valid).toBe(true);
    expect(validateInterviewCampaignLifecycleControlV1(invalid).valid).toBe(false);
    expect(decodeInterviewCampaignLifecyclePreviewV1(valid)).toEqual(valid);
    expect(decodeInterviewCampaignLifecycleApplyResultV1(apply)).toEqual(apply);
    expect(() => decodeInterviewCampaignLifecyclePreviewV1(invalid)).toThrow(
      InterviewCampaignLifecycleContractError,
    );
  });

  it("accepts cancel from either draft or active as the boundary case", () => {
    expect(boundary.operation).toBe("cancel_campaign");
    expect(boundary.before.lifecycle).toBe("ACTIVE");
    expect(boundary.after.lifecycle).toBe("CANCELLED");
    expect(interviewCampaignLifecycleControlSemanticViolations(boundary)).toEqual([]);
  });

  it("rejects a start_campaign preview that reports no transition", () => {
    expect(invalid.before.lifecycle).toBe(invalid.after.lifecycle);
    expect(interviewCampaignLifecycleControlSemanticViolations(invalid)).toContainEqual(
      expect.objectContaining({ code: "INTERVIEW_CAMPAIGN_LIFECYCLE_OPERATION" }),
    );
  });

  it("requires the transition to advance exactly one version", () => {
    const skipped = { ...valid, after: { ...valid.after, aggregateVersion: "3" } };
    expect(interviewCampaignLifecycleControlSemanticViolations(skipped)).toContainEqual(
      expect.objectContaining({ code: "INTERVIEW_CAMPAIGN_LIFECYCLE_TRANSITION" }),
    );
  });

  it("rejects an unsupported contract name", () => {
    const unnamed = { ...valid, contract: { name: "SomethingElse", version: "1.0.0" } };
    expect(interviewCampaignLifecycleControlSemanticViolations(unnamed)).toContainEqual(
      expect.objectContaining({ code: "INTERVIEW_CAMPAIGN_CONTRACT" }),
    );
  });
});
