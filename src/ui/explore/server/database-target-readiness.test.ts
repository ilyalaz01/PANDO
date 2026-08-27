import fixture from "../../../../tests/contract/fixtures/target-readiness/v1/target-readiness.valid.json";
import { describe, expect, it } from "vitest";

import { decodeTargetReadinessV1, TargetReadinessContractError } from "./database-target-readiness";

describe("TargetReadinessV1 Explore adapter", () => {
  it("accepts the validated current detail for its selected goal", () => {
    expect(decodeTargetReadinessV1(fixture, "goal:python-readiness").readinessGoalKey).toBe(
      "goal:python-readiness",
    );
  });

  it("rejects a mismatched goal and a reversed semantic interval", () => {
    expect(() => decodeTargetReadinessV1(fixture, "goal:other")).toThrow(
      TargetReadinessContractError,
    );
    const malformed = structuredClone(fixture);
    malformed.snapshot.lower = 0.9;
    malformed.snapshot.upper = 0.1;
    expect(() => decodeTargetReadinessV1(malformed, "goal:python-readiness")).toThrow(
      TargetReadinessContractError,
    );
  });

  it("rejects incoherent calculation and validity clocks", () => {
    const futureCalculation = structuredClone(fixture);
    futureCalculation.snapshot.calculatedAsOf = "2026-08-28T11:00:00.000Z";
    expect(() => decodeTargetReadinessV1(futureCalculation, "goal:python-readiness")).toThrow(
      TargetReadinessContractError,
    );

    const expiredCurrent = structuredClone(fixture);
    expiredCurrent.asOf = "2026-08-29T09:00:00.001Z";
    expect(() => decodeTargetReadinessV1(expiredCurrent, "goal:python-readiness")).toThrow(
      TargetReadinessContractError,
    );

    const prematureStale: Record<string, unknown> = {
      ...structuredClone(fixture),
      projectionState: "STALE",
      stateReason: "SNAPSHOT_EXPIRED",
    };
    expect(() => decodeTargetReadinessV1(prematureStale, "goal:python-readiness")).toThrow(
      TargetReadinessContractError,
    );
  });

  it("rejects duplicated inputs and gaps that contradict their persisted input", () => {
    const duplicated = structuredClone(fixture);
    duplicated.inputs.push(structuredClone(duplicated.inputs[0]!));
    expect(() => decodeTargetReadinessV1(duplicated, "goal:python-readiness")).toThrow(
      TargetReadinessContractError,
    );

    const mismatchedGap = structuredClone(fixture);
    mismatchedGap.gaps[0]!.freshness = "STALE";
    expect(() => decodeTargetReadinessV1(mismatchedGap, "goal:python-readiness")).toThrow(
      TargetReadinessContractError,
    );
  });
});
