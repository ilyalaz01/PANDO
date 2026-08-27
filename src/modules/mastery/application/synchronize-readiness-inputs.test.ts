import { describe, expect, it } from "vitest";

import {
  calculateMasteryReadinessValidUntilV1,
  MASTERY_READINESS_ENGINE_VERSION,
  MASTERY_READINESS_EVIDENCE_REFERENCES_PER_OUTCOME_V1,
  MASTERY_READINESS_POLICY_VERSION,
  MasteryReadinessSynchronizationError,
  synchronizeMasteryReadinessInputsV1,
  type MasteryReadinessEvidenceInputV1,
} from "./synchronize-readiness-inputs";

function evidence(
  evidenceId: string,
  occurredAt: string,
  outcome: "SUCCESS" | "FAILURE" = "SUCCESS",
): MasteryReadinessEvidenceInputV1 {
  return {
    evidenceId,
    attemptId: `attempt:${evidenceId}`,
    sourceId: "manual.focus",
    occurredAt,
    dimension: "KNOWLEDGE",
    outcome,
    engagement: "INDEPENDENT",
    normalized: true,
    invalidated: false,
    observedResult: true,
    mappingConfidence: 1,
    sourceReliability: 1,
    targetRelevant: true,
  };
}

function synchronize(
  sourceEvidence: readonly MasteryReadinessEvidenceInputV1[],
  calculatedAsOf = "2026-08-28T12:00:00.000Z",
) {
  return synchronizeMasteryReadinessInputsV1({
    calculatedAsOf,
    sourceEvidenceWatermark: String(sourceEvidence.length),
    declaredMasteryEngineVersion: MASTERY_READINESS_ENGINE_VERSION,
    declaredMasteryPolicyVersion: MASTERY_READINESS_POLICY_VERSION,
    competencies: [{ competencyRef: "competency:typescript", evidence: sourceEvidence }],
    requiredDimensions: [{ competencyRef: "competency:typescript", dimension: "KNOWLEDGE" }],
  });
}

describe("Mastery readiness input synchronization", () => {
  it("owns declared and calculated provenance while preserving explicit Unknown", () => {
    const result = synchronize([]);
    expect(result).toMatchObject({
      calculatedAsOf: "2026-08-28T12:00:00.000Z",
      sourceEvidenceWatermark: "0",
      masteryEngineVersion: MASTERY_READINESS_ENGINE_VERSION,
      masteryPolicyVersion: MASTERY_READINESS_POLICY_VERSION,
    });
    expect(result.dimensions).toEqual([
      expect.objectContaining({
        competencyRef: "competency:typescript",
        dimension: "KNOWLEDGE",
        calculatedAsOf: result.calculatedAsOf,
        value: "UNKNOWN",
        achievementLevel: "NOT_STARTED",
        freshness: "UNKNOWN",
        confidence: null,
        supportingEvidenceIds: [],
        contradictingEvidenceIds: [],
      }),
    ]);

    expect(() =>
      synchronizeMasteryReadinessInputsV1({
        calculatedAsOf: result.calculatedAsOf,
        sourceEvidenceWatermark: "0",
        declaredMasteryEngineVersion: "mastery-engine/unsupported",
        declaredMasteryPolicyVersion: MASTERY_READINESS_POLICY_VERSION,
        competencies: [{ competencyRef: "competency:typescript", evidence: [] }],
        requiredDimensions: [{ competencyRef: "competency:typescript", dimension: "KNOWLEDGE" }],
      }),
    ).toThrow(MasteryReadinessSynchronizationError);
  });

  it("retains only the eight most recent references per outcome with an ID tie-break", () => {
    const source = Array.from({ length: 10 }, (_unused, index) =>
      evidence(
        `support:${String(index).padStart(2, "0")}`,
        `2026-08-28T10:${String(index).padStart(2, "0")}:00.000Z`,
      ),
    ).concat(
      Array.from({ length: 10 }, (_unused, index) =>
        evidence(
          `contradict:${String(index).padStart(2, "0")}`,
          index >= 8
            ? "2026-08-28T11:59:00.000Z"
            : `2026-08-28T11:${String(index).padStart(2, "0")}:00.000Z`,
          "FAILURE",
        ),
      ),
    );
    const [dimension] = synchronize(source).dimensions;

    expect(dimension?.supportingEvidenceIds).toEqual(
      Array.from(
        { length: MASTERY_READINESS_EVIDENCE_REFERENCES_PER_OUTCOME_V1 },
        (_unused, index) => `support:${String(9 - index).padStart(2, "0")}`,
      ),
    );
    expect(dimension?.contradictingEvidenceIds).toEqual([
      "contradict:08",
      "contradict:09",
      "contradict:07",
      "contradict:06",
      "contradict:05",
      "contradict:04",
      "contradict:03",
      "contradict:02",
    ]);
  });

  it("derives the exact freshness boundary from the Mastery-owned policy", () => {
    const boundary = "2026-08-28T12:00:00.000Z";
    const result = synchronize(
      [evidence("support:boundary", "2026-05-30T12:00:00.000Z")],
      boundary,
    );
    expect(result.dimensions[0]).toMatchObject({ value: "KNOWN", freshness: "FRESH" });
    expect(calculateMasteryReadinessValidUntilV1(result.dimensions, boundary)).toBe(boundary);
  });
});
