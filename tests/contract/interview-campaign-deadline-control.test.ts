// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  InterviewCampaignDeadlineContractError,
  decodeInterviewCampaignDeadlineChangeApplyResultV1,
  decodeInterviewCampaignDeadlineChangePreviewV1,
  interviewCampaignDeadlineControlSemanticViolations,
  validateInterviewCampaignDeadlineControlV1,
} from "../../src/shared/contracts/interview-campaign-deadline-control";
import { validateSchema } from "../../src/shared/contracts/schema-registry";
import apply from "./fixtures/interview-campaign/v1/interview-campaign-deadline-control.apply.json";
import boundary from "./fixtures/interview-campaign/v1/interview-campaign-deadline-control.boundary.json";
import invalid from "./fixtures/interview-campaign/v1/interview-campaign-deadline-control.invalid.json";
import malicious from "./fixtures/interview-campaign/v1/interview-campaign-deadline-control.malicious.json";
import valid from "./fixtures/interview-campaign/v1/interview-campaign-deadline-control.valid.json";

describe("PANDO Interview Campaign Deadline Control V1", () => {
  it("keeps valid, boundary, apply, invalid, and malicious fixtures executable", () => {
    expect(validateSchema("interview-campaign-deadline-control-v1", valid).valid).toBe(true);
    expect(validateSchema("interview-campaign-deadline-control-v1", boundary).valid).toBe(true);
    expect(validateSchema("interview-campaign-deadline-control-v1", apply).valid).toBe(true);
    expect(validateSchema("interview-campaign-deadline-control-v1", invalid).valid).toBe(true);
    expect(validateSchema("interview-campaign-deadline-control-v1", malicious).valid).toBe(false);
    expect(validateInterviewCampaignDeadlineControlV1(valid).valid).toBe(true);
    expect(validateInterviewCampaignDeadlineControlV1(boundary).valid).toBe(true);
    expect(validateInterviewCampaignDeadlineControlV1(apply).valid).toBe(true);
    expect(validateInterviewCampaignDeadlineControlV1(invalid).valid).toBe(false);
    expect(decodeInterviewCampaignDeadlineChangePreviewV1(valid)).toEqual(valid);
    expect(decodeInterviewCampaignDeadlineChangeApplyResultV1(apply)).toEqual(apply);
    expect(() => decodeInterviewCampaignDeadlineChangePreviewV1(invalid)).toThrow(
      InterviewCampaignDeadlineContractError,
    );
  });

  it("accepts the maximum representable aggregate version at the boundary", () => {
    expect(boundary.before.aggregateVersion).toBe("9223372036854775806");
    expect(boundary.after.aggregateVersion).toBe("9223372036854775807");
    expect(interviewCampaignDeadlineControlSemanticViolations(boundary)).toEqual([]);
  });

  it("requires the transition to advance exactly one version and change nothing else", () => {
    expect(interviewCampaignDeadlineControlSemanticViolations(invalid)).toContainEqual(
      expect.objectContaining({ code: "INTERVIEW_CAMPAIGN_DEADLINE_TRANSITION" }),
    );
    const relabeled = { ...valid, after: { ...valid.after, title: "Renamed loop" } };
    expect(interviewCampaignDeadlineControlSemanticViolations(relabeled)).toContainEqual(
      expect.objectContaining({ code: "INTERVIEW_CAMPAIGN_DEADLINE_TRANSITION" }),
    );
  });

  it("rejects an unsupported contract name", () => {
    const unnamed = { ...valid, contract: { name: "SomethingElse", version: "1.0.0" } };
    expect(interviewCampaignDeadlineControlSemanticViolations(unnamed)).toContainEqual(
      expect.objectContaining({ code: "INTERVIEW_CAMPAIGN_CONTRACT" }),
    );
  });
});
