import { describe, expect, it } from "vitest";

import boundary from "../../../../tests/contract/fixtures/planning/v1/growth-plan-control.boundary.json";
import preview from "../../../../tests/contract/fixtures/planning/v1/growth-plan-control.valid.json";
import {
  decodeCurrentGrowthPlanV1,
  decodeGrowthPlanCapacityApplyResultV1,
  decodeGrowthPlanCapacityPreviewV1,
  decodeGrowthPlanLifecycleApplyResultV1,
  decodeGrowthPlanLifecyclePreviewV1,
  GrowthPlanControlContractError,
} from "./plan-workspace-v1";

const uuid = "30000000-0000-4000-8000-000000000001";

const capacityPreview = {
  contract: { name: "GrowthPlanCapacityPreviewV1", version: "1.0.0" },
  operation: "set_default_capacity",
  reason: "I have more time this term.",
  expectedGrowthPlanVersion: "4",
  before: structuredClone(preview.before),
  after: { ...structuredClone(preview.before), weeklyCapacityMinutes: 720, aggregateVersion: "5" },
  constraint: {
    activeTrackCount: 2,
    activeProtectedMinimumMinutes: 180,
    flexibleMinutesBefore: 420,
    flexibleMinutesAfter: 540,
    activeTrackFingerprint: "b".repeat(64),
  },
  canApply: true,
  blockingReasons: [],
  retained: structuredClone(preview.retained),
  recalculationAfterApply: structuredClone(preview.recalculationAfterApply),
  previewDigest: "c".repeat(64),
};

function applyResult() {
  return {
    contract: { name: "GrowthPlanLifecycleApplyResultV1", version: "1.0.0" },
    commandId: uuid,
    changedPlan: structuredClone(preview.after),
    projectionState: "PENDING",
    planningDeliveryId: "30000000-0000-4000-8000-000000000002",
    emittedEventIds: ["30000000-0000-4000-8000-000000000003"],
  };
}

describe("Growth Plan control V1 server decoder", () => {
  it("decodes only the expected minimized contract variant", () => {
    expect(decodeCurrentGrowthPlanV1(boundary)).toEqual(boundary);
    expect(decodeGrowthPlanLifecyclePreviewV1(preview)).toEqual(preview);
    expect(decodeGrowthPlanLifecycleApplyResultV1(applyResult())).toEqual(applyResult());
  });

  it("rejects a schema-valid wrong variant at every RPC boundary", () => {
    expect(() => decodeCurrentGrowthPlanV1(preview)).toThrow(GrowthPlanControlContractError);
    expect(() => decodeGrowthPlanLifecyclePreviewV1(boundary)).toThrow(
      GrowthPlanControlContractError,
    );
    expect(() => decodeGrowthPlanLifecycleApplyResultV1(preview)).toThrow(
      GrowthPlanControlContractError,
    );
  });

  it("rejects private fields and a structurally valid but incoherent preview", () => {
    expect(() =>
      decodeGrowthPlanLifecyclePreviewV1({ ...preview, workspaceId: "private" }),
    ).toThrow(GrowthPlanControlContractError);

    const incoherent = structuredClone(preview);
    incoherent.after.aggregateVersion = "99";
    expect(() => decodeGrowthPlanLifecyclePreviewV1(incoherent)).toThrow(
      GrowthPlanControlContractError,
    );
  });

  it("decodes coherent capacity previews and apply results", () => {
    expect(decodeGrowthPlanCapacityPreviewV1(capacityPreview)).toEqual(capacityPreview);
    const result = {
      contract: { name: "GrowthPlanCapacityApplyResultV1", version: "1.0.0" },
      commandId: uuid,
      changedPlan: capacityPreview.after,
      projectionState: "PENDING",
      planningDeliveryId: "30000000-0000-4000-8000-000000000002",
      emittedEventIds: ["30000000-0000-4000-8000-000000000003"],
    };
    expect(decodeGrowthPlanCapacityApplyResultV1(result)).toEqual(result);
  });

  it("rejects private or incoherent capacity previews", () => {
    expect(() =>
      decodeGrowthPlanCapacityPreviewV1({ ...capacityPreview, workspaceId: "private" }),
    ).toThrow(GrowthPlanControlContractError);
    expect(() =>
      decodeGrowthPlanCapacityPreviewV1({
        ...capacityPreview,
        canApply: false,
        blockingReasons: [],
      }),
    ).toThrow(GrowthPlanControlContractError);
  });
});
