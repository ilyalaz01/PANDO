import fc from "fast-check";
import { describe, expect, it } from "vitest";
import masteryGolden from "../../../../tests/fixtures/calculation-engines/v0.1/mastery.golden.json";
import { calculateCompetencyState } from "./calculate-competency-state";
import { MASTERY_POLICY_V0_1 } from "./policy-v0.1";
import {
  MasteryInputError,
  type CalculateCompetencyStateInput,
  type MasteryEvidenceInput,
} from "./types";

const fixture = masteryGolden as unknown as {
  readonly input: CalculateCompetencyStateInput;
  readonly clock: { readonly asOf: string };
  readonly expected: unknown;
};

function evidence(overrides: Partial<MasteryEvidenceInput> = {}): MasteryEvidenceInput {
  return {
    evidenceId: "evidence:base",
    attemptId: "attempt:base",
    sourceId: "source:base",
    occurredAt: "2024-03-20T12:00:00Z",
    dimension: "RECALL",
    outcome: "SUCCESS",
    engagement: "INDEPENDENT",
    normalized: true,
    invalidated: false,
    observedResult: true,
    mappingConfidence: 0.9,
    sourceReliability: 0.9,
    targetRelevant: false,
    ...overrides,
  };
}

function calculate(items: readonly MasteryEvidenceInput[], asOf = "2024-04-01T12:00:00Z") {
  return calculateCompetencyState(
    {
      competencyId: "competency:test",
      inputWatermark: "watermark:1",
      evidence: items,
    },
    MASTERY_POLICY_V0_1,
    { asOf },
  );
}

describe("calculateCompetencyState", () => {
  it("matches the versioned golden fixture", () => {
    expect(calculateCompetencyState(fixture.input, MASTERY_POLICY_V0_1, fixture.clock)).toEqual(
      fixture.expected,
    );
  });

  it("preserves missing dimensions as Unknown rather than numeric zero", () => {
    const state = calculate([]);

    expect(state.achievementLevel).toBe("NOT_STARTED");
    expect(state.dimensions.RECALL).toMatchObject({
      value: "UNKNOWN",
      condition: null,
      confidence: null,
      freshness: "UNKNOWN",
      explanationCodes: ["NO_RELEVANT_EVIDENCE", "UNKNOWN_NOT_ZERO"],
    });
  });

  it("makes a reliable mapped failure known Weak without raising achievement", () => {
    const state = calculate([
      evidence({ evidenceId: "failure", outcome: "FAILURE" }),
      evidence({
        evidenceId: "below-threshold",
        attemptId: "attempt:ignored",
        mappingConfidence: 0.749,
      }),
    ]);

    expect(state.dimensions.RECALL).toMatchObject({
      value: "KNOWN",
      achievementLevel: "NOT_STARTED",
      condition: "WEAK",
      contradictingEvidenceIds: ["failure"],
    });
  });

  it("fully recalculates after invalidation and correction", () => {
    const corrected = calculate([
      evidence({
        evidenceId: "original-success",
        invalidated: true,
      }),
      evidence({
        evidenceId: "correction-failure",
        attemptId: "attempt:correction",
        sourceId: "source:correction",
        outcome: "FAILURE",
      }),
    ]);
    const repaired = calculate([
      evidence({
        evidenceId: "original-success",
        invalidated: true,
      }),
      evidence({
        evidenceId: "correction-failure",
        attemptId: "attempt:correction",
        sourceId: "source:correction",
        outcome: "FAILURE",
        invalidated: true,
      }),
      evidence({
        evidenceId: "replacement-success",
        attemptId: "attempt:replacement",
        sourceId: "source:replacement",
      }),
    ]);

    expect(corrected.dimensions.RECALL).toMatchObject({
      achievementLevel: "NOT_STARTED",
      condition: "WEAK",
    });
    expect(repaired.dimensions.RECALL).toMatchObject({
      achievementLevel: "COMPLETED",
      condition: "STRONG",
      supportingEvidenceIds: ["replacement-success"],
      contradictingEvidenceIds: [],
    });
  });

  it("caps passive-only Knowledge at Completed", () => {
    const state = calculate(
      [0, 1, 2].map((index) =>
        evidence({
          evidenceId: `passive:${index}`,
          attemptId: `attempt:${index}`,
          sourceId: `source:${index}`,
          occurredAt: `2024-03-0${index + 1}T12:00:00Z`,
          dimension: "KNOWLEDGE",
          engagement: "PASSIVE",
        }),
      ),
      "2024-03-10T12:00:00Z",
    );

    expect(state.achievementLevel).toBe("COMPLETED");
    expect(state.dimensions.KNOWLEDGE.achievementLevel).toBe("COMPLETED");
    expect(state.dimensions.KNOWLEDGE.confidence).toBe("LOW");
  });

  it("reaches Verified through delayed reproduction and Mastered across DST-normalized UTC dates", () => {
    const verified = calculate(
      [
        evidence({
          evidenceId: "guided:1",
          attemptId: "attempt:1",
          sourceId: "source:1",
          engagement: "GUIDED",
          occurredAt: "2024-03-01T12:00:00Z",
        }),
        evidence({
          evidenceId: "guided:2",
          attemptId: "attempt:2",
          sourceId: "source:2",
          engagement: "GUIDED",
          occurredAt: "2024-03-02T12:00:00Z",
        }),
      ],
      "2024-03-03T12:00:00Z",
    );
    const mastered = calculate(
      [
        evidence({
          evidenceId: "dst:1",
          attemptId: "attempt:1",
          sourceId: "source:1",
          occurredAt: "2024-03-08T12:00:00-05:00",
          dimension: "APPLICATION",
          targetRelevant: true,
        }),
        evidence({
          evidenceId: "dst:2",
          attemptId: "attempt:2",
          sourceId: "source:2",
          occurredAt: "2024-03-09T12:00:00-05:00",
          dimension: "APPLICATION",
        }),
        evidence({
          evidenceId: "dst:3",
          attemptId: "attempt:3",
          sourceId: "source:3",
          occurredAt: "2024-03-11T13:00:00-04:00",
          dimension: "APPLICATION",
        }),
      ],
      "2024-03-12T17:00:00Z",
    );

    expect(verified.achievementLevel).toBe("VERIFIED");
    expect(mastered.achievementLevel).toBe("MASTERED");
    expect(mastered.dimensions.APPLICATION).toMatchObject({
      achievementLevel: "MASTERED",
      confidence: "HIGH",
    });
  });

  it("keeps the exact leap-day freshness boundary fresh and becomes stale after it", () => {
    const item = evidence({ occurredAt: "2024-02-29T12:00:00Z" });
    const boundary = calculate([item], "2024-03-30T12:00:00Z");
    const beyond = calculate([item], "2024-03-30T12:00:00.001Z");

    expect(boundary.dimensions.RECALL.freshness).toBe("FRESH");
    expect(beyond.dimensions.RECALL).toMatchObject({
      freshness: "STALE",
      condition: "STALE",
      confidence: "LOW",
    });
  });

  it("is order-independent and replay-idempotent", () => {
    fc.assert(
      fc.property(fc.boolean(), fc.integer({ min: 1, max: 5 }), (reverse, copies) => {
        const source = reverse
          ? [...fixture.input.evidence].reverse()
          : [...fixture.input.evidence];
        const replayed = [...source];
        for (let index = 0; index < copies; index += 1) {
          const event = source[index % source.length];
          if (event) {
            replayed.push(event);
          }
        }

        expect(
          calculateCompetencyState(
            { ...fixture.input, evidence: replayed },
            MASTERY_POLICY_V0_1,
            fixture.clock,
          ),
        ).toEqual(fixture.expected);
      }),
    );
  });

  it("rejects future evidence and conflicting duplicate identifiers", () => {
    expect(() =>
      calculate([evidence({ occurredAt: "2025-01-01T00:00:00Z" })], "2024-01-01T00:00:00Z"),
    ).toThrow(MasteryInputError);

    expect(() =>
      calculate([
        evidence({ evidenceId: "duplicate" }),
        evidence({ evidenceId: "duplicate", outcome: "FAILURE" }),
      ]),
    ).toThrow(/conflicting duplicates/u);
  });

  it("reports Medium confidence, unresolved contradiction, and stale confidence downgrade", () => {
    const medium = calculate([
      evidence({
        evidenceId: "medium:1",
        attemptId: "attempt:1",
        sourceId: "source:1",
      }),
      evidence({
        evidenceId: "medium:2",
        attemptId: "attempt:2",
        sourceId: "source:2",
        occurredAt: "2024-03-21T12:00:00Z",
      }),
    ]);
    const contradicted = calculate([
      evidence({ evidenceId: "support" }),
      evidence({
        evidenceId: "contradiction",
        attemptId: "attempt:failure",
        sourceId: "source:failure",
        outcome: "FAILURE",
      }),
    ]);
    const staleHigh = calculate(
      [
        evidence({
          evidenceId: "stale:1",
          attemptId: "attempt:1",
          sourceId: "source:1",
          occurredAt: "2024-01-01T12:00:00Z",
          dimension: "APPLICATION",
          targetRelevant: true,
        }),
        evidence({
          evidenceId: "stale:2",
          attemptId: "attempt:2",
          sourceId: "source:2",
          occurredAt: "2024-01-02T12:00:00Z",
          dimension: "APPLICATION",
        }),
        evidence({
          evidenceId: "stale:3",
          attemptId: "attempt:3",
          sourceId: "source:3",
          occurredAt: "2024-01-04T12:00:00Z",
          dimension: "APPLICATION",
        }),
      ],
      "2024-04-01T12:00:00Z",
    );

    expect(medium.dimensions.RECALL.confidence).toBe("MEDIUM");
    expect(contradicted.dimensions.RECALL).toMatchObject({
      condition: "WEAK",
      confidence: "LOW",
    });
    expect(contradicted.dimensions.RECALL.explanationCodes).toContain("UNRESOLVED_CONTRADICTION");
    expect(staleHigh.dimensions.APPLICATION).toMatchObject({
      condition: "STALE",
      confidence: "MEDIUM",
    });
  });

  it("rejects malformed policy, evidence probabilities, identifiers, and instants", () => {
    const input: CalculateCompetencyStateInput = {
      competencyId: "competency:test",
      inputWatermark: "watermark:1",
      evidence: [],
    };

    expect(() =>
      calculateCompetencyState(
        input,
        {
          ...MASTERY_POLICY_V0_1,
          freshnessDays: { ...MASTERY_POLICY_V0_1.freshnessDays, RECALL: 0 },
        },
        { asOf: "2024-04-01T12:00:00Z" },
      ),
    ).toThrow(/freshnessDays/u);
    expect(() =>
      calculateCompetencyState(
        input,
        { ...MASTERY_POLICY_V0_1, verificationDelayHours: 0 },
        { asOf: "2024-04-01T12:00:00Z" },
      ),
    ).toThrow(/positive whole number/u);
    expect(() => calculate([evidence({ mappingConfidence: 2 })])).toThrow(/between 0 and 1/u);
    expect(() =>
      calculateCompetencyState({ ...input, competencyId: " " }, MASTERY_POLICY_V0_1, {
        asOf: "2024-04-01T12:00:00Z",
      }),
    ).toThrow(/must not be empty/u);
    expect(() => calculate([], "2024-99-99T12:00:00Z")).toThrow(MasteryInputError);
  });
});
