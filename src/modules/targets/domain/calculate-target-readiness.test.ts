import fc from "fast-check";
import { describe, expect, it } from "vitest";
import readinessGolden from "../../../../tests/fixtures/calculation-engines/v0.1/readiness.golden.json";
import { calculateTargetReadiness } from "./calculate-target-readiness";
import { READINESS_POLICY_V0_1 } from "./readiness-policy-v0.1";
import {
  ReadinessInputError,
  type AchievementLevel,
  type CalculateTargetReadinessInput,
  type ReadinessDimensionInput,
  type RequirementRule,
} from "./readiness-types";

const AS_OF = "2024-04-01T12:00:00Z";
const fixture = readinessGolden as unknown as {
  readonly input: CalculateTargetReadinessInput;
  readonly clock: { readonly asOf: string };
  readonly expected: unknown;
};

function state(
  competencyId: string,
  achievementLevel: AchievementLevel,
  overrides: Partial<ReadinessDimensionInput> = {},
): ReadinessDimensionInput {
  return {
    competencyId,
    dimension: "APPLICATION",
    calculatedAsOf: AS_OF,
    value: "KNOWN",
    achievementLevel,
    freshness: "FRESH",
    confidence: "HIGH",
    ...overrides,
  };
}

function node(competencyId: string) {
  return {
    memberType: "NODE" as const,
    competencyId,
    dimension: "APPLICATION" as const,
    requiredLevel: "MASTERED" as const,
  };
}

function calculate(
  rules: readonly RequirementRule[],
  masteryDimensions: readonly ReadinessDimensionInput[],
  targetThreshold: number | null = 0.8,
  rootRuleId = rules[0]?.ruleId ?? "rule:root",
) {
  return calculateTargetReadiness(
    {
      targetProfileVersionId: "target-profile:test/1",
      rootRuleId,
      inputWatermark: "mastery:1",
      targetThreshold,
      rules,
      masteryDimensions,
    },
    READINESS_POLICY_V0_1,
    { asOf: AS_OF },
  );
}

describe("calculateTargetReadiness", () => {
  it("matches the versioned weighted golden fixture", () => {
    expect(calculateTargetReadiness(fixture.input, READINESS_POLICY_V0_1, fixture.clock)).toEqual(
      fixture.expected,
    );
  });

  it("preserves Unknown as an interval and lowers coverage", () => {
    const result = calculate(
      [{ ruleId: "rule:root", kind: "ALL", members: [node("competency:unknown")] }],
      [
        state("competency:unknown", "NOT_STARTED", {
          value: "UNKNOWN",
          freshness: "UNKNOWN",
          confidence: null,
        }),
      ],
    );

    expect(result).toMatchObject({
      lower: 0,
      upper: 1,
      coverage: 0,
      status: "INSUFFICIENT_EVIDENCE",
      confidence: "LOW",
    });
    expect(result.explanationCodes).toContain("UNKNOWN_PRESERVED_AS_INTERVAL");
  });

  it("evaluates a mandatory floor before the aggregate", () => {
    const rules: RequirementRule[] = [
      {
        ruleId: "rule:root",
        kind: "ALL",
        members: [{ memberType: "RULE", ruleId: "rule:floor" }, node("competency:strong")],
      },
      {
        ruleId: "rule:floor",
        kind: "MANDATORY_FLOOR",
        member: node("competency:floor"),
      },
    ];

    const failed = calculate(rules, [
      state("competency:floor", "COMPLETED"),
      state("competency:strong", "MASTERED"),
    ]);
    const unknown = calculate(rules, [
      state("competency:floor", "NOT_STARTED", {
        value: "UNKNOWN",
        freshness: "UNKNOWN",
        confidence: null,
      }),
      state("competency:strong", "MASTERED"),
    ]);

    expect(failed.status).toBe("NOT_READY");
    expect(failed.blockers).toContainEqual({
      code: "MANDATORY_FLOOR_FAILED",
      ruleId: "rule:floor",
      lower: 0.5,
      upper: 0.5,
    });
    expect(unknown.status).toBe("INSUFFICIENT_EVIDENCE");
    expect(unknown.blockers).toContainEqual({
      code: "MANDATORY_FLOOR_UNKNOWN",
      ruleId: "rule:floor",
      lower: 0,
      upper: 1,
    });
  });

  it.each([
    ["ALL", 0],
    ["ANY", 1],
    ["K_OF_N", 0.5],
  ] as const)("uses the explicit %s interval operator", (kind, expected) => {
    const members = [node("competency:one"), node("competency:half"), node("competency:zero")];
    const rule: RequirementRule =
      kind === "K_OF_N"
        ? { ruleId: "rule:root", kind, requiredCount: 2, members }
        : { ruleId: "rule:root", kind, members };
    const result = calculate(
      [rule],
      [
        state("competency:one", "MASTERED"),
        state("competency:half", "COMPLETED"),
        state("competency:zero", "NOT_STARTED"),
      ],
      0.8,
    );

    expect(result.lower).toBe(expected);
    expect(result.upper).toBe(expected);
  });

  it("uses stale strength and profile default threshold transparently", () => {
    const result = calculate(
      [
        {
          ruleId: "rule:root",
          kind: "WEIGHTED_THRESHOLD",
          threshold: 0.8,
          members: [
            { member: { ...node("competency:stale"), requiredLevel: "VERIFIED" }, weight: 1 },
          ],
        },
      ],
      [
        state("competency:stale", "VERIFIED", {
          freshness: "STALE",
          confidence: "MEDIUM",
        }),
      ],
      null,
    );

    expect(result).toMatchObject({
      targetThreshold: 0.8,
      lower: 0.8,
      upper: 0.8,
      coverage: 1,
      status: "READY",
      confidence: "HIGH",
    });
  });

  it("keeps high coverage at Medium confidence when a required state is Low confidence", () => {
    const result = calculate(
      [{ ruleId: "rule:root", kind: "ANY", members: [node("competency:ready")] }],
      [state("competency:ready", "MASTERED", { confidence: "LOW" })],
    );

    expect(result.status).toBe("READY");
    expect(result.confidence).toBe("MEDIUM");
  });

  it("always returns a bounded monotone interval", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<AchievementLevel>("NOT_STARTED", "COMPLETED", "VERIFIED", "MASTERED"),
        fc.boolean(),
        (achievementLevel, stale) => {
          const result = calculate(
            [{ ruleId: "rule:root", kind: "ALL", members: [node("competency:x")] }],
            [
              state("competency:x", achievementLevel, {
                freshness: stale ? "STALE" : "FRESH",
              }),
            ],
          );

          expect(result.lower).toBeGreaterThanOrEqual(0);
          expect(result.lower).toBeLessThanOrEqual(result.upper);
          expect(result.upper).toBeLessThanOrEqual(1);
          expect(result.coverage).toBe(1);
        },
      ),
    );
  });

  it("rejects mixed asOf snapshots, cycles, invalid K, and unreachable rules", () => {
    expect(() =>
      calculate(
        [{ ruleId: "rule:root", kind: "ALL", members: [node("competency:x")] }],
        [state("competency:x", "MASTERED", { calculatedAsOf: "2024-04-01T11:59:59Z" })],
      ),
    ).toThrow(/recalculated at clock\.asOf/u);

    expect(() =>
      calculate(
        [
          {
            ruleId: "rule:root",
            kind: "ALL",
            members: [{ memberType: "RULE", ruleId: "rule:other" }],
          },
          {
            ruleId: "rule:other",
            kind: "ANY",
            members: [{ memberType: "RULE", ruleId: "rule:root" }],
          },
        ],
        [],
      ),
    ).toThrow(/cycle/u);

    expect(() =>
      calculate(
        [
          {
            ruleId: "rule:root",
            kind: "K_OF_N",
            requiredCount: 2,
            members: [node("competency:x")],
          },
        ],
        [],
      ),
    ).toThrow(ReadinessInputError);

    expect(() =>
      calculate(
        [
          { ruleId: "rule:root", kind: "ALL", members: [node("competency:x")] },
          { ruleId: "rule:orphan", kind: "ALL", members: [node("competency:y")] },
        ],
        [],
      ),
    ).toThrow(/unreachable/u);
  });

  it("reuses shared subrules deterministically", () => {
    const rules: RequirementRule[] = [
      {
        ruleId: "rule:root",
        kind: "ALL",
        members: [
          { memberType: "RULE", ruleId: "rule:left" },
          { memberType: "RULE", ruleId: "rule:right" },
        ],
      },
      {
        ruleId: "rule:left",
        kind: "ALL",
        members: [{ memberType: "RULE", ruleId: "rule:shared" }],
      },
      {
        ruleId: "rule:right",
        kind: "ANY",
        members: [{ memberType: "RULE", ruleId: "rule:shared" }],
      },
      {
        ruleId: "rule:shared",
        kind: "ALL",
        members: [node("competency:ready")],
      },
    ];

    expect(calculate(rules, [state("competency:ready", "MASTERED")])).toMatchObject({
      lower: 1,
      upper: 1,
      status: "READY",
    });
  });

  it("rejects malformed policies, profiles, weights, and state metadata", () => {
    const validInput: CalculateTargetReadinessInput = {
      targetProfileVersionId: "target-profile:test/1",
      rootRuleId: "rule:root",
      inputWatermark: "mastery:1",
      targetThreshold: 0.8,
      rules: [{ ruleId: "rule:root", kind: "ALL", members: [node("competency:x")] }],
      masteryDimensions: [state("competency:x", "MASTERED")],
    };

    expect(() =>
      calculateTargetReadiness(
        validInput,
        {
          ...READINESS_POLICY_V0_1,
          minimumCoverage: 0.8,
          highConfidenceCoverage: 0.7,
        },
        { asOf: AS_OF },
      ),
    ).toThrow(/at least/u);
    expect(() => calculate([{ ruleId: "rule:root", kind: "ALL", members: [] }], [])).toThrow(
      /at least one member/u,
    );
    expect(() =>
      calculate(
        [
          {
            ruleId: "rule:root",
            kind: "WEIGHTED_THRESHOLD",
            threshold: 0.8,
            members: [{ member: node("competency:x"), weight: 0 }],
          },
        ],
        [],
      ),
    ).toThrow(/weights/u);
    expect(() =>
      calculate(
        [
          {
            ruleId: "rule:root",
            kind: "ALL",
            members: [{ memberType: "RULE", ruleId: "rule:missing" }],
          },
        ],
        [],
      ),
    ).toThrow(/missing rule/u);
    expect(() =>
      calculate(
        [
          { ruleId: "rule:root", kind: "ALL", members: [node("competency:x")] },
          { ruleId: "rule:root", kind: "ANY", members: [node("competency:y")] },
        ],
        [],
      ),
    ).toThrow(/duplicate ruleId/u);
    expect(() =>
      calculateTargetReadiness(
        { ...validInput, rootRuleId: "rule:missing" },
        READINESS_POLICY_V0_1,
        { asOf: AS_OF },
      ),
    ).toThrow(/does not exist/u);
    expect(() =>
      calculate(validInput.rules, [
        state("competency:x", "MASTERED"),
        state("competency:x", "VERIFIED"),
      ]),
    ).toThrow(/duplicate mastery dimension/u);
    expect(() =>
      calculate(validInput.rules, [
        state("competency:x", "NOT_STARTED", {
          value: "UNKNOWN",
          freshness: "FRESH",
          confidence: "LOW",
        }),
      ]),
    ).toThrow(/inconsistent Unknown metadata/u);
  });
});
