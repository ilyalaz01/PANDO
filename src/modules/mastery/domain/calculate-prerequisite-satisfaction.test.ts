import fc from "fast-check";
import { describe, expect, it } from "vitest";
import golden from "../../../../tests/fixtures/calculation-engines/v0.1/mastery-prerequisite.golden.json";
import { calculatePrerequisiteSatisfaction } from "./calculate-prerequisite-satisfaction";
import { PREREQUISITE_SATISFACTION_POLICY_V0_1 } from "./prerequisite-satisfaction-policy-v0.1";
import type { CalculatePrerequisiteSatisfactionInput } from "./prerequisite-satisfaction-types";

const fixture = golden as unknown as {
  readonly input: CalculatePrerequisiteSatisfactionInput;
  readonly clock: Readonly<{ asOf: string }>;
  readonly expected: unknown;
};

function cloneProjection(): Record<string, unknown> {
  return structuredClone(fixture.input.projection) as Record<string, unknown>;
}

function calculate(
  projection: unknown | null,
  asOf = fixture.clock.asOf,
  competencyRef = fixture.input.competencyRef,
) {
  return calculatePrerequisiteSatisfaction(
    { competencyRef, projection },
    PREREQUISITE_SATISFACTION_POLICY_V0_1,
    { asOf },
  );
}

function application(projection: Record<string, unknown>): Record<string, unknown> {
  const state = projection.state as Record<string, unknown>;
  const dimensions = state.dimensions as Record<string, unknown>;
  return dimensions.APPLICATION as Record<string, unknown>;
}

describe("calculatePrerequisiteSatisfaction", () => {
  it("matches the versioned golden fixture at the inclusive freshness boundary", () => {
    expect(
      calculatePrerequisiteSatisfaction(
        fixture.input,
        PREREQUISITE_SATISFACTION_POLICY_V0_1,
        fixture.clock,
      ),
    ).toEqual(fixture.expected);
  });

  it("becomes Unknown one millisecond after the exact boundary", () => {
    expect(calculate(fixture.input.projection, "2026-08-31T12:00:00.001Z")).toMatchObject({
      state: "UNKNOWN",
      reason: "NO_DECISIVE_FRESH_STATE",
      validUntil: null,
    });
  });

  it("lets a fresh Strong completion win over a fresh Weak dimension", () => {
    const projection = cloneProjection();
    const state = projection.state as Record<string, unknown>;
    const dimensions = state.dimensions as Record<string, unknown>;
    dimensions.RECALL = {
      dimension: "RECALL",
      value: "KNOWN",
      achievementLevel: "NOT_STARTED",
      condition: "WEAK",
      confidence: "LOW",
      freshness: "FRESH",
      lastMeaningfulEvidenceAt: "2026-08-02T12:00:00Z",
    };

    expect(calculate(projection)).toMatchObject({ state: "SATISFIED", reason: "FRESH_STRONG" });
  });

  it("returns Blocked for a fresh Weak estimate when no positive witness exists", () => {
    const projection = cloneProjection();
    Object.assign(application(projection), {
      achievementLevel: "NOT_STARTED",
      condition: "WEAK",
    });
    projection.achievementLevel = "NOT_STARTED";
    (projection.state as Record<string, unknown>).achievementLevel = "NOT_STARTED";

    expect(calculate(projection)).toMatchObject({
      state: "BLOCKED",
      reason: "FRESH_WEAK",
      validUntil: "2026-08-31T12:00:00.000Z",
    });
  });

  it("keeps a missing or post-claim projection explicitly Unknown", () => {
    expect(calculate(null)).toMatchObject({ state: "UNKNOWN", reason: "NOT_MATERIALIZED" });
    const projection = cloneProjection();
    projection.pointerUpdatedAt = "2026-08-31T12:00:00.001Z";
    expect(calculate(projection)).toMatchObject({ state: "UNKNOWN", reason: "AFTER_CLAIM" });
  });

  it.each([
    [
      "scalar dimensions",
      (projection: Record<string, unknown>) => {
        (projection.state as Record<string, unknown>).dimensions = "bad";
      },
    ],
    [
      "contradictory stale label",
      (projection: Record<string, unknown>) => {
        application(projection).freshness = "STALE";
      },
    ],
    [
      "evidence after calculation",
      (projection: Record<string, unknown>) => {
        application(projection).lastMeaningfulEvidenceAt = "2026-08-03T12:00:00Z";
      },
    ],
    [
      "unknown with confidence",
      (projection: Record<string, unknown>) => {
        const state = projection.state as Record<string, unknown>;
        const dimensions = state.dimensions as Record<string, unknown>;
        (dimensions.KNOWLEDGE as Record<string, unknown>).confidence = "LOW";
      },
    ],
    [
      "state watermark mismatch",
      (projection: Record<string, unknown>) => {
        (projection.state as Record<string, unknown>).inputWatermark = "8";
      },
    ],
    [
      "impossible projection clock order",
      (projection: Record<string, unknown>) => {
        projection.createdAt = "2026-08-01T12:00:00Z";
      },
    ],
    [
      "aggregate achievement below a dimension achievement",
      (projection: Record<string, unknown>) => {
        projection.achievementLevel = "NOT_STARTED";
        (projection.state as Record<string, unknown>).achievementLevel = "NOT_STARTED";
      },
    ],
  ])("fails closed on malicious %s", (_name, mutate) => {
    const projection = cloneProjection();
    mutate(projection);
    expect(calculate(projection)).toMatchObject({
      state: "UNKNOWN",
      reason: "MALFORMED_STATE",
      validUntil: null,
    });
  });

  it("is deterministic across JSON key order and all supported claim offsets", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 60 * 86_400_000 + 1 }), (offset) => {
        const projection = cloneProjection();
        const reversed = Object.fromEntries(Object.entries(projection).reverse());
        const asOf = new Date(Date.parse("2026-07-02T12:00:00Z") + offset).toISOString();
        expect(calculate(reversed, asOf)).toEqual(calculate(projection, asOf));
      }),
    );
  });
});
