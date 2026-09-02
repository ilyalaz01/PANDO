// @vitest-environment node

import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  GROWTH_PLAN_CHILD_TRACK_FINGERPRINT_VERSION,
  GROWTH_PLAN_REPLACEMENT_COMMAND_TYPE,
  GROWTH_PLAN_REPLACEMENT_PREVIEW_DIGEST_VERSION,
  GROWTH_PLAN_REPLACEMENT_REQUEST_HASH_VERSION,
  growthPlanChildTrackFingerprintInput,
  growthPlanReplacementIdentityInput,
  growthPlanReplacementPreviewDigestInput,
  growthPlanReplacementRequestHashInput,
  type GrowthPlanReplacementPreviewDigestFields,
} from "../../src/modules/planning/domain/growth-plan-replacement-preview";
import { planningCreateUuidFromSha256 } from "../../src/modules/planning/domain/growth-plan-initialization-preview";
import {
  GrowthPlanReplacementContractError,
  decodeGrowthPlanReplacementApplyResultV1,
  decodeGrowthPlanReplacementPreviewV1,
  decodeGrowthPlanReplacementSourceV1,
  growthPlanReplacementControlSemanticViolations,
  validateGrowthPlanReplacementControlV1,
} from "../../src/shared/contracts/growth-plan-replacement-control";
import { validateSchema } from "../../src/shared/contracts/schema-registry";
import apply from "./fixtures/planning/v1/growth-plan-replacement-control.apply.json";
import boundary from "./fixtures/planning/v1/growth-plan-replacement-control.boundary.json";
import invalid from "./fixtures/planning/v1/growth-plan-replacement-control.invalid.json";
import malicious from "./fixtures/planning/v1/growth-plan-replacement-control.malicious.json";
import valid from "./fixtures/planning/v1/growth-plan-replacement-control.valid.json";

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function digestFields(): GrowthPlanReplacementPreviewDigestFields {
  return {
    workspaceId: valid.before.growthPlan.growthPlanId.replace(/^5/, "1"),
    idempotencyKey: valid.idempotencyKey,
    reason: valid.reason,
    expectedReadinessGoalVersion: valid.expectedReadinessGoalVersion,
    expectedGrowthPlanVersion: valid.expectedGrowthPlanVersion,
    source: valid.source as GrowthPlanReplacementPreviewDigestFields["source"],
    before: valid.before as GrowthPlanReplacementPreviewDigestFields["before"],
    after: valid.after as GrowthPlanReplacementPreviewDigestFields["after"],
    canApply: valid.canApply,
    blockingReasonCode: null,
    warnings: valid.warnings.map(
      (warning) => warning.code,
    ) as GrowthPlanReplacementPreviewDigestFields["warnings"],
  };
}

describe("PANDO Growth Plan Replacement Control V1", () => {
  it("keeps valid, boundary, invalid, malicious, and apply fixtures executable", () => {
    expect(validateSchema("growth-plan-replacement-control-v1", valid).valid).toBe(true);
    expect(validateSchema("growth-plan-replacement-control-v1", boundary).valid).toBe(true);
    expect(validateSchema("growth-plan-replacement-control-v1", apply).valid).toBe(true);
    expect(validateSchema("growth-plan-replacement-control-v1", invalid).valid).toBe(true);
    expect(validateSchema("growth-plan-replacement-control-v1", malicious).valid).toBe(false);
    expect(validateGrowthPlanReplacementControlV1(valid).valid).toBe(true);
    expect(validateGrowthPlanReplacementControlV1(boundary).valid).toBe(true);
    expect(validateGrowthPlanReplacementControlV1(apply).valid).toBe(true);
    expect(validateGrowthPlanReplacementControlV1(invalid).valid).toBe(false);
    expect(decodeGrowthPlanReplacementPreviewV1(valid)).toEqual(valid);
    expect(decodeGrowthPlanReplacementSourceV1(boundary)).toEqual(boundary);
    expect(decodeGrowthPlanReplacementApplyResultV1(apply)).toEqual(apply);
    expect(() => decodeGrowthPlanReplacementPreviewV1(invalid)).toThrow(
      GrowthPlanReplacementContractError,
    );
  });

  it("enforces the four-state source envelope, the 20-goal cap, and a plan only when available", () => {
    expect(boundary.goals).toHaveLength(20);
    const overflowed = structuredClone(boundary);
    overflowed.goals.push({ ...overflowed.goals[19]!, readinessGoalKey: "goal:target-99" });
    expect(validateSchema("growth-plan-replacement-control-v1", overflowed).valid).toBe(false);

    for (const state of [
      "NO_CURRENT_PLAN",
      "NO_ACTIVE_GOALS",
      "GOAL_PORTFOLIO_OVERFLOW",
    ] as const) {
      const source = {
        contract: { name: "GrowthPlanReplacementSourceV1", version: "1.0.0" },
        state,
        capabilities: [],
        currentPlan: null,
        goals: [],
      };
      expect(validateGrowthPlanReplacementControlV1(source).valid).toBe(true);
      expect(decodeGrowthPlanReplacementSourceV1(source).state).toBe(state);
      expect(
        validateSchema("growth-plan-replacement-control-v1", {
          ...source,
          capabilities: ["replace_growth_plan"],
        }).valid,
      ).toBe(false);
      expect(
        validateSchema("growth-plan-replacement-control-v1", {
          ...source,
          currentPlan: boundary.currentPlan,
        }).valid,
      ).toBe(false);
    }
  });

  it("rejects duplicate, non-ASCII-ordered, and unsafe replacement choices", () => {
    const reversed = structuredClone(boundary);
    reversed.goals.reverse();
    expect(
      growthPlanReplacementControlSemanticViolations(reversed).map((item) => item.code),
    ).toContain("GROWTH_PLAN_REPLACEMENT_GOAL_ORDER");

    const duplicated = structuredClone(boundary);
    duplicated.goals[1]!.readinessGoalKey = duplicated.goals[0]!.readinessGoalKey;
    expect(
      growthPlanReplacementControlSemanticViolations(duplicated).map((item) => item.code),
    ).toContain("GROWTH_PLAN_REPLACEMENT_GOAL_DUPLICATE");

    const unsafe = structuredClone(boundary);
    unsafe.currentPlan.title = "Private\nplan";
    expect(validateSchema("growth-plan-replacement-control-v1", unsafe).valid).toBe(true);
    expect(validateGrowthPlanReplacementControlV1(unsafe).valid).toBe(false);

    const miscounted = structuredClone(boundary);
    miscounted.currentPlan.childTracks.archived = 4;
    expect(
      growthPlanReplacementControlSemanticViolations(miscounted).map((item) => item.code),
    ).toContain("GROWTH_PLAN_REPLACEMENT_TRACK_COUNTS");
  });

  it("rejects structurally valid cross-field lies", () => {
    const codes = growthPlanReplacementControlSemanticViolations(invalid).map((item) => item.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        "GROWTH_PLAN_REPLACEMENT_SOURCE_VERSION",
        "GROWTH_PLAN_REPLACEMENT_SOURCE_BINDING",
        "GROWTH_PLAN_REPLACEMENT_PLAN_VERSION",
        "GROWTH_PLAN_REPLACEMENT_ARCHIVE_TRANSITION",
        "GROWTH_PLAN_REPLACEMENT_PLAN_TITLE",
        "GROWTH_PLAN_REPLACEMENT_TRACK_KEY",
        "GROWTH_PLAN_REPLACEMENT_TRACK_COUNTS",
        "GROWTH_PLAN_REPLACEMENT_CARDINALITY",
        "GROWTH_PLAN_REPLACEMENT_APPLICABILITY",
        "GROWTH_PLAN_REPLACEMENT_WARNINGS",
      ]),
    );
  });

  it("requires the archived Plan to be the outgoing Plan advanced by exactly one version", () => {
    const skipped = structuredClone(valid);
    skipped.after.archivedPlan.aggregateVersion = "6";
    expect(
      growthPlanReplacementControlSemanticViolations(skipped).map((item) => item.code),
    ).toContain("GROWTH_PLAN_REPLACEMENT_ARCHIVE_TRANSITION");

    const retitled = structuredClone(valid);
    retitled.after.archivedPlan.title = "Renamed while archiving";
    expect(
      growthPlanReplacementControlSemanticViolations(retitled).map((item) => item.code),
    ).toContain("GROWTH_PLAN_REPLACEMENT_ARCHIVE_TRANSITION");

    const sameAggregate = structuredClone(valid);
    sameAggregate.after.growthPlan.growthPlanId = sameAggregate.before.growthPlan.growthPlanId;
    expect(
      growthPlanReplacementControlSemanticViolations(sameAggregate).map((item) => item.code),
    ).toContain("GROWTH_PLAN_REPLACEMENT_PLAN_IDENTITY");
  });

  it("derives the warning vocabulary from retained Track lifecycle counts alone", () => {
    const emptyPlan = structuredClone(valid);
    emptyPlan.before.childTracks = {
      total: 2,
      active: 0,
      paused: 0,
      completed: 0,
      archived: 2,
      fingerprint: emptyPlan.before.childTracks.fingerprint,
    };
    emptyPlan.warnings = [
      { code: "ARCHIVED_PLAN_IS_READ_ONLY" },
      { code: "INITIAL_TRACK_HAS_NO_ACTIVITIES" },
    ];
    expect(validateGrowthPlanReplacementControlV1(emptyPlan).valid).toBe(true);

    const missingCopyWarning = structuredClone(valid);
    missingCopyWarning.warnings = [
      { code: "ARCHIVED_PLAN_IS_READ_ONLY" },
      { code: "INITIAL_TRACK_HAS_NO_ACTIVITIES" },
    ];
    expect(
      growthPlanReplacementControlSemanticViolations(missingCopyWarning).map((item) => item.code),
    ).toContain("GROWTH_PLAN_REPLACEMENT_WARNINGS");
  });

  it("enforces lowercase UUID representation for every replacement authority", () => {
    const uppercase = structuredClone(valid);
    uppercase.source.sourceRef = "A0000000-0000-4000-8000-000000000001";
    uppercase.source.roadmapVersionId = "A0000000-0000-4000-8000-000000000001";
    expect(validateSchema("growth-plan-replacement-control-v1", uppercase).valid).toBe(true);
    expect(
      growthPlanReplacementControlSemanticViolations(uppercase).map((item) => item.code),
    ).toContain("GROWTH_PLAN_REPLACEMENT_UUID_CASE");
  });

  it("pins the fixed clock-free digest, identity, fingerprint, and request-hash oracles", () => {
    expect(GROWTH_PLAN_REPLACEMENT_PREVIEW_DIGEST_VERSION).toBe(
      "growth-plan-replacement-preview-digest/1.0.0",
    );
    expect(GROWTH_PLAN_REPLACEMENT_REQUEST_HASH_VERSION).toBe(
      "growth-plan-replacement-request-hash/1.0.0",
    );
    expect(GROWTH_PLAN_REPLACEMENT_COMMAND_TYPE).toBe("planning.replace_growth_plan_v1");
    expect(GROWTH_PLAN_CHILD_TRACK_FINGERPRINT_VERSION).toBe(
      "growth-plan-child-track-fingerprint/1.0.0",
    );

    const digestInput = growthPlanReplacementPreviewDigestInput(digestFields());
    expect(digestInput).not.toContain("previewAsOf");
    expect(digestInput).toContain("commandType:31:planning.replace_growth_plan_v1\n");
    expect(digestInput).toContain("warningCount:1:3\n");

    const identity = growthPlanReplacementIdentityInput({
      workspaceId: "A0000000-0000-4000-8000-000000000001",
      idempotencyKey: "B0000000-0000-4000-8000-000000000001",
      label: "growth-plan",
    });
    expect(identity).toContain("workspaceId:36:a0000000-0000-4000-8000-000000000001\n");
    expect(
      planningCreateUuidFromSha256(createHash("sha256").update(identity, "utf8").digest()),
    ).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);

    const fingerprint = growthPlanChildTrackFingerprintInput({
      childTrackCount: 2,
      tracks: [
        {
          learningTrackId: "10000000-0000-8000-8000-000000000001",
          aggregateVersion: "3",
          lifecycle: "ACTIVE",
        },
        {
          learningTrackId: "20000000-0000-8000-8000-000000000002",
          aggregateVersion: "1",
          lifecycle: "ARCHIVED",
        },
      ],
    });
    expect(sha256Hex(fingerprint)).toMatch(/^[a-f0-9]{64}$/u);

    const requestHash = growthPlanReplacementRequestHashInput({
      workspaceId: "A0000000-0000-4000-8000-000000000001",
      idempotencyKey: "B0000000-0000-4000-8000-000000000001",
      readinessGoalKey: valid.source.readinessGoalKey,
      expectedReadinessGoalVersion: "7",
      expectedGrowthPlanVersion: "4",
      weeklyCapacityMinutes: 420,
      defaultSessionMinutes: 30,
      trackPriority: 50,
      reason: valid.reason,
      previewDigest: valid.previewDigest,
      growthPlanId: valid.after.growthPlan.growthPlanId,
      learningTrackId: valid.after.learningTrack.learningTrackId,
      trackKey: valid.after.learningTrack.trackKey,
    });
    expect(requestHash).toContain("expectedGrowthPlanVersion:1:4\n");
    expect(sha256Hex(requestHash)).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("matches the independently framed fixture digest", () => {
    const fields = digestFields();
    const recomputed = sha256Hex(
      growthPlanReplacementPreviewDigestInput({
        ...fields,
        workspaceId: "10000000-0000-4000-8000-0000000000ff",
      }),
    );
    expect(recomputed).toBe(valid.previewDigest);
  });

  it("pins every public numeric and reason boundary", () => {
    const minimums = structuredClone(valid);
    minimums.reason = "x";
    minimums.after.growthPlan.weeklyCapacityMinutes = 0;
    minimums.after.learningTrack.defaultSessionMinutes = 1;
    minimums.after.learningTrack.priority = 0;
    expect(validateGrowthPlanReplacementControlV1(minimums).valid).toBe(true);

    const maximums = structuredClone(valid);
    maximums.after.growthPlan.weeklyCapacityMinutes = 10080;
    maximums.after.learningTrack.defaultSessionMinutes = 480;
    maximums.after.learningTrack.priority = 100;
    expect(validateGrowthPlanReplacementControlV1(maximums).valid).toBe(true);

    const overCapacity = structuredClone(valid);
    overCapacity.after.growthPlan.weeklyCapacityMinutes = 10081;
    expect(validateSchema("growth-plan-replacement-control-v1", overCapacity).valid).toBe(false);

    const nonZeroMinimum = structuredClone(valid);
    nonZeroMinimum.after.learningTrack.protectedMinimumMinutes = 1;
    expect(validateSchema("growth-plan-replacement-control-v1", nonZeroMinimum).valid).toBe(false);

    const nonZeroCadence = structuredClone(valid);
    nonZeroCadence.after.learningTrack.cadencePerWeek = 1;
    expect(validateSchema("growth-plan-replacement-control-v1", nonZeroCadence).valid).toBe(false);
  });
});
