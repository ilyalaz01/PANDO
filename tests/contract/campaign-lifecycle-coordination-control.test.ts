// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  CampaignLifecycleCoordinationContractError,
  campaignLifecycleCoordinationControlSemanticViolations,
  decodeCampaignLifecycleCoordinationApplyResultV1,
  decodeCampaignLifecycleCoordinationPreviewV1,
  validateCampaignLifecycleCoordinationControlV1,
} from "../../src/shared/contracts/campaign-lifecycle-coordination-control";
import { validateSchema } from "../../src/shared/contracts/schema-registry";
import apply from "./fixtures/agent-control/v1/campaign-lifecycle-coordination-control.apply.json";
import boundary from "./fixtures/agent-control/v1/campaign-lifecycle-coordination-control.boundary.json";
import invalid from "./fixtures/agent-control/v1/campaign-lifecycle-coordination-control.invalid.json";
import malicious from "./fixtures/agent-control/v1/campaign-lifecycle-coordination-control.malicious.json";
import valid from "./fixtures/agent-control/v1/campaign-lifecycle-coordination-control.valid.json";

describe("PANDO Campaign Lifecycle Coordination Control V1", () => {
  it("keeps valid, boundary, apply, invalid, and malicious fixtures executable", () => {
    expect(validateSchema("campaign-lifecycle-coordination-control-v1", valid).valid).toBe(true);
    expect(validateSchema("campaign-lifecycle-coordination-control-v1", boundary).valid).toBe(true);
    expect(validateSchema("campaign-lifecycle-coordination-control-v1", apply).valid).toBe(true);
    expect(validateSchema("campaign-lifecycle-coordination-control-v1", invalid).valid).toBe(true);
    expect(validateSchema("campaign-lifecycle-coordination-control-v1", malicious).valid).toBe(
      false,
    );
    expect(validateCampaignLifecycleCoordinationControlV1(valid).valid).toBe(true);
    expect(validateCampaignLifecycleCoordinationControlV1(boundary).valid).toBe(true);
    expect(validateCampaignLifecycleCoordinationControlV1(apply).valid).toBe(true);
    expect(validateCampaignLifecycleCoordinationControlV1(invalid).valid).toBe(false);
    expect(decodeCampaignLifecycleCoordinationPreviewV1(valid)).toEqual(valid);
    expect(decodeCampaignLifecycleCoordinationApplyResultV1(apply)).toEqual(apply);
    expect(() => decodeCampaignLifecycleCoordinationPreviewV1(invalid)).toThrow(
      CampaignLifecycleCoordinationContractError,
    );
  });

  it("accepts a blocked start_campaign preview naming the already-overridden Track", () => {
    expect(boundary.canApply).toBe(false);
    expect(boundary.blockingReasons).toEqual([
      { code: "ALLOCATION_OVERRIDE_TRACK_ALREADY_OVERRIDDEN", trackKey: "track:backend" },
    ]);
    expect(campaignLifecycleCoordinationControlSemanticViolations(boundary)).toEqual([]);
  });

  it("rejects start_campaign closing an existing override", () => {
    expect(campaignLifecycleCoordinationControlSemanticViolations(invalid)).toContainEqual(
      expect.objectContaining({ code: "CAMPAIGN_COORDINATION_OVERRIDE_SCOPE" }),
    );
  });

  it("rejects an apply result mixing installed and closed override shapes", () => {
    const mixed = {
      ...apply,
      overrides: [
        ...apply.overrides,
        {
          overrideKey: "override:81000000-0000-8000-8000-000000000009",
          learningTrack: { trackKey: "track:algorithms", title: "Algorithms" },
          lifecycle: "ACTIVE",
          priorityOverride: null,
          protectedMinimumMinutesOverride: 60,
          cadencePerWeekOverride: null,
          aggregateVersion: "1",
        },
      ],
    };
    expect(campaignLifecycleCoordinationControlSemanticViolations(mixed)).toContainEqual(
      expect.objectContaining({ code: "CAMPAIGN_COORDINATION_OVERRIDE_SHAPE" }),
    );
  });

  it("requires the campaign key to bind its own derived identity", () => {
    const unbound = {
      ...valid,
      campaign: {
        ...valid.campaign,
        after: {
          ...valid.campaign.after,
          campaignKey: "campaign:99999999-0000-8000-8000-000000000009",
        },
      },
    };
    expect(campaignLifecycleCoordinationControlSemanticViolations(unbound)).toContainEqual(
      expect.objectContaining({ code: "CAMPAIGN_COORDINATION_KEY_BINDING" }),
    );
  });

  it("rejects an unsupported contract name", () => {
    const unnamed = { ...valid, contract: { name: "SomethingElse", version: "1.0.0" } };
    expect(campaignLifecycleCoordinationControlSemanticViolations(unnamed)).toContainEqual(
      expect.objectContaining({ code: "CAMPAIGN_COORDINATION_CONTRACT" }),
    );
  });
});
