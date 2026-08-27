// @vitest-environment node

import { describe, expect, it } from "vitest";

import { validateSchema } from "../../src/shared/contracts/schema-registry";
import {
  planningReadinessSemanticViolations,
  targetReadinessSemanticViolations,
} from "../../src/shared/contracts/target-readiness-semantics";
import planningBoundaryFixture from "./fixtures/target-readiness/v1/planning-readiness.boundary.json";
import planningInvalidFixture from "./fixtures/target-readiness/v1/planning-readiness.invalid.json";
import planningMaliciousFixture from "./fixtures/target-readiness/v1/planning-readiness.malicious.json";
import planningValidFixture from "./fixtures/target-readiness/v1/planning-readiness.valid.json";
import targetBoundaryFixture from "./fixtures/target-readiness/v1/target-readiness.boundary.json";
import targetInvalidFixture from "./fixtures/target-readiness/v1/target-readiness.invalid.json";
import targetMaliciousFixture from "./fixtures/target-readiness/v1/target-readiness.malicious.json";
import targetValidFixture from "./fixtures/target-readiness/v1/target-readiness.valid.json";
import { cloneJson } from "./support";

type RecordValue = Record<string, unknown>;

describe("TargetReadinessV1", () => {
  const valid = targetValidFixture;
  const boundary = targetBoundaryFixture;

  it("keeps valid, invalid, boundary, and malicious fixtures executable", () => {
    expect(validateSchema("target-readiness-v1", valid).valid).toBe(true);
    expect(validateSchema("target-readiness-v1", boundary).valid).toBe(true);
    expect(validateSchema("target-readiness-v1", targetInvalidFixture).valid).toBe(false);
    expect(validateSchema("target-readiness-v1", targetMaliciousFixture).valid).toBe(false);
  });

  it("accepts the exact valid-until boundary and coherent persisted gaps", () => {
    expect(targetReadinessSemanticViolations(valid)).toEqual([]);
    expect(targetReadinessSemanticViolations(boundary)).toEqual([]);
  });

  it("rejects reversed intervals and expired CURRENT state semantically", () => {
    const reversed = cloneJson(valid);
    const snapshot = reversed.snapshot as RecordValue;
    snapshot.lower = 0.9;
    snapshot.upper = 0.1;
    reversed.asOf = "2026-08-30T00:00:00.000Z";
    expect(validateSchema("target-readiness-v1", reversed).valid).toBe(true);
    expect(targetReadinessSemanticViolations(reversed)).toEqual([
      "TARGET_READINESS_CURRENT_EXPIRED",
      "TARGET_READINESS_INTERVAL_ORDER",
    ]);
  });

  it("rejects duplicated inputs, evidence overlap, and gaps detached from persisted input", () => {
    const changed = cloneJson(valid);
    const inputs = changed.inputs as unknown as RecordValue[];
    inputs.push(structuredClone(inputs[0]!));
    inputs[0]!.supportingEvidenceIds = ["50000000-0000-4000-8000-000000000001"];
    inputs[0]!.contradictingEvidenceIds = ["50000000-0000-4000-8000-000000000001"];
    const gaps = changed.gaps as unknown as RecordValue[];
    gaps[0]!.freshness = "STALE";
    expect(validateSchema("target-readiness-v1", changed).valid).toBe(true);
    expect(targetReadinessSemanticViolations(changed)).toEqual([
      "TARGET_READINESS_EVIDENCE_OVERLAP",
      "TARGET_READINESS_GAP_INPUT_MISMATCH",
      "TARGET_READINESS_INPUT_DUPLICATE",
    ]);
  });

  it("does not admit Explore domain composition or evidence bodies", () => {
    const changed = cloneJson(valid);
    (changed as RecordValue).domainBreakdown = { domains: [] };
    const inputs = changed.inputs as unknown as RecordValue[];
    inputs[0]!.evidenceBody = "private";
    expect(validateSchema("target-readiness-v1", changed).valid).toBe(false);
  });

  it("keeps the public leaf bound aligned with the 250-leaf batch envelope", () => {
    const withinWorkerEnvelope = cloneJson(valid) as RecordValue;
    const input = (withinWorkerEnvelope.inputs as unknown as RecordValue[])[0]!;
    withinWorkerEnvelope.gaps = [];
    withinWorkerEnvelope.inputs = Array.from({ length: 250 }, (_unused, index) => ({
      ...input,
      competencyRef: `competency:leaf-${String(index).padStart(4, "0")}`,
    }));
    expect(validateSchema("target-readiness-v1", withinWorkerEnvelope).valid).toBe(true);

    const beyondWorkerEnvelope = structuredClone(withinWorkerEnvelope);
    beyondWorkerEnvelope.inputs = Array.from({ length: 251 }, (_unused, index) => ({
      ...input,
      competencyRef: `competency:leaf-${String(index).padStart(4, "0")}`,
    }));
    expect(validateSchema("target-readiness-v1", beyondWorkerEnvelope).valid).toBe(false);
  });

  it("bounds minimized evidence references independently of ledger history", () => {
    const changed = cloneJson(valid);
    const [input] = changed.inputs as unknown as RecordValue[];
    input!.supportingEvidenceIds = Array.from(
      { length: 9 },
      (_unused, index) => `50000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    );
    expect(validateSchema("target-readiness-v1", changed).valid).toBe(false);
  });
});

describe("PlanningReadinessInputV1", () => {
  const valid = planningValidFixture;
  const boundary = planningBoundaryFixture;

  it("keeps CURRENT, UNAVAILABLE, invalid, and malicious fixtures executable", () => {
    expect(validateSchema("planning-readiness-input-v1", valid).valid).toBe(true);
    expect(validateSchema("planning-readiness-input-v1", boundary).valid).toBe(true);
    expect(validateSchema("planning-readiness-input-v1", planningInvalidFixture).valid).toBe(false);
    expect(validateSchema("planning-readiness-input-v1", planningMaliciousFixture).valid).toBe(
      false,
    );
  });

  it("rejects a reversed CURRENT interval semantically", () => {
    const reversed = cloneJson(valid);
    const snapshot = reversed.snapshot as RecordValue;
    snapshot.lower = 0.9;
    snapshot.upper = 0.1;
    expect(validateSchema("planning-readiness-input-v1", reversed).valid).toBe(true);
    expect(planningReadinessSemanticViolations(reversed)).toEqual([
      "PLANNING_READINESS_INTERVAL_ORDER",
    ]);
  });

  it("omits rule evaluations, explanation codes, inputs, and evidence identifiers", () => {
    const snapshot = valid.snapshot as RecordValue;
    expect(snapshot.ruleEvaluations).toBeUndefined();
    expect(snapshot.explanationCodes).toBeUndefined();
    expect(snapshot.inputs).toBeUndefined();
    expect(snapshot.supportingEvidenceIds).toBeUndefined();
  });
});
