import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { PandoSupabaseClient } from "../../../shared/supabase/database";
import {
  assertTargetReadinessCompletionPayloadWithinBudget,
  dispatchTargetReadinessProjection,
  TARGET_READINESS_COMPLETION_MAX_UTF8_BYTES,
  TargetReadinessCompletionCapacityError,
} from "./dispatch-target-readiness-projection";
import {
  decodeTargetReadinessProjectionInputV1,
  prepareTargetReadinessProjectionResults,
  UnsupportedDomainRequirementError,
} from "./target-readiness-projection";

const deliveryId = "11111111-1111-4111-8111-111111111111";
const eventId = "22222222-2222-4222-8222-222222222222";
const workspaceId = "33333333-3333-4333-8333-333333333333";
const goalId = "44444444-4444-4444-8444-444444444444";
const profileId = "55555555-5555-4555-8555-555555555555";
const leaseToken = "66666666-6666-4666-8666-666666666666";

function node(
  memberOrder: number,
  nodeRef: string,
  dimension: string,
  requiredLevel: string,
  nodeKind = "COMPETENCY",
) {
  return {
    memberOrder,
    memberType: "NODE",
    nodeScope: "canonical",
    nodeKind,
    nodeRef,
    dimension,
    requiredLevel,
  };
}

function ruleMember(memberOrder: number, referencedRuleKey: string) {
  return { memberOrder, memberType: "RULE", referencedRuleKey };
}

function masteryEvidence(
  evidenceId: string,
  attemptId: string,
  occurredAt: string,
  dimension = "KNOWLEDGE",
  outcome = "SUCCESS",
) {
  return {
    evidenceId,
    attemptId,
    sourceId: "manual.focus",
    occurredAt,
    dimension,
    outcome,
    engagement: "INDEPENDENT",
    normalized: true,
    invalidated: false,
    observedResult: true,
    mappingConfidence: 1,
    sourceReliability: 0.6,
    targetRelevant: true,
  };
}

function baseInput(calculatedAsOf = "2026-08-28T12:00:00.000Z") {
  return {
    contract: { name: "TargetReadinessProjectionInputV1", version: "1.0.0" },
    deliveryId,
    eventId,
    eventPosition: "7",
    workspaceId,
    eventName: "targets.readiness_goal_created",
    calculatedAsOf,
    sourceEvidenceWatermark: "0",
    projectionGeneration: "live-v1",
    projectionError: null,
    goals: [
      {
        readinessGoalId: goalId,
        readinessGoalKey: "goal:backend-role",
        goalAggregateVersion: "1",
        profileVersionId: profileId,
        profileVersionKey: "target:backend-role-v1",
        rootRuleKey: "rule:root",
        targetThreshold: 0.8,
        currentPointer: null,
        rules: [
          {
            ruleKey: "rule:root",
            ruleType: "ALL",
            criticality: "MANDATORY",
            requiredCount: null,
            threshold: null,
            members: [
              node(1, "competency:typescript", "KNOWLEDGE", "COMPLETED"),
              ruleMember(2, "rule:floor"),
            ],
          },
          {
            ruleKey: "rule:floor",
            ruleType: "MANDATORY_FLOOR",
            criticality: "MANDATORY",
            requiredCount: null,
            threshold: null,
            members: [node(1, "competency:testing", "RECALL", "VERIFIED")],
          },
        ],
        requiredLeaves: [
          {
            competencyRef: "competency:typescript",
            dimension: "KNOWLEDGE",
            requiredLevel: "COMPLETED",
            owningRuleKeys: ["rule:root"],
          },
          {
            competencyRef: "competency:testing",
            dimension: "RECALL",
            requiredLevel: "VERIFIED",
            owningRuleKeys: ["rule:floor"],
          },
        ],
      },
    ],
    masterySource: {
      contract: { name: "MasteryReadinessCalculationSourceV1", version: "1.0.0" },
      sourceEvidenceWatermark: "0",
      masteryEngineVersion: "mastery-engine/0.1.0",
      masteryPolicyVersion: "mastery-readiness-policy/0.1",
      competencies: [
        { competencyRef: "competency:typescript", evidence: [] as unknown[] },
        { competencyRef: "competency:testing", evidence: [] as unknown[] },
      ],
    },
  };
}

function oneLeafInput(calculatedAsOf: string, evidence: readonly unknown[]) {
  const input = baseInput(calculatedAsOf);
  return {
    ...input,
    sourceEvidenceWatermark: evidence.length === 0 ? "0" : "1",
    goals: [
      {
        ...input.goals[0]!,
        rules: [
          {
            ruleKey: "rule:root",
            ruleType: "ALL",
            criticality: "MANDATORY",
            requiredCount: null,
            threshold: null,
            members: [node(1, "competency:typescript", "KNOWLEDGE", "COMPLETED")],
          },
        ],
        requiredLeaves: [input.goals[0]!.requiredLeaves[0]!],
      },
    ],
    masterySource: {
      ...input.masterySource,
      sourceEvidenceWatermark: evidence.length === 0 ? "0" : "1",
      competencies: [{ competencyRef: "competency:typescript", evidence }],
    },
  };
}

function decoded(value: unknown) {
  return decodeTargetReadinessProjectionInputV1(value);
}

describe("Target readiness projection calculation", () => {
  it("rejects extra transport fields and bounded batch overflow", () => {
    const extra = baseInput() as ReturnType<typeof baseInput> & { unexpected?: boolean };
    extra.unexpected = true;
    expect(() => decoded(extra)).toThrow(/TargetReadinessProjectionInputV1 is invalid/u);

    const unbounded = baseInput();
    unbounded.goals = Array.from({ length: 21 }, () => structuredClone(unbounded.goals[0]!));
    expect(() => decoded(unbounded)).toThrow(/goals is invalid/u);
  });

  it("rejects more than 250 required leaves across multiple goals", () => {
    const overflow = baseInput();
    const goalWithLeaves = (suffix: string, count: number) => ({
      ...structuredClone(overflow.goals[0]!),
      readinessGoalId:
        suffix === "a"
          ? "44444444-4444-4444-8444-444444444444"
          : "99999999-9999-4999-8999-999999999999",
      readinessGoalKey: `goal:backend-role-${suffix}`,
      rules: [
        {
          ruleKey: "rule:root",
          ruleType: "ALL",
          criticality: "MANDATORY",
          requiredCount: null,
          threshold: null,
          members: Array.from({ length: count }, (_unused, index) =>
            node(index + 1, `competency:leaf-${index}`, "KNOWLEDGE", "COMPLETED"),
          ),
        },
      ],
      requiredLeaves: Array.from({ length: count }, (_unused, index) => ({
        competencyRef: `competency:leaf-${index}`,
        dimension: "KNOWLEDGE",
        requiredLevel: "COMPLETED",
        owningRuleKeys: ["rule:root"],
      })),
    });
    overflow.goals = [goalWithLeaves("a", 126), goalWithLeaves("b", 125)];

    expect(() => decoded(overflow)).toThrow(/goals is invalid/u);
  });

  it("recalculates every required competency at one clock and preserves explicit Unknown", () => {
    const input = decoded(baseInput("2026-08-28T12:00:00+00:00"));
    const [result] = prepareTargetReadinessProjectionResults(input);

    expect(result?.calculatedAsOf).toBe("2026-08-28T12:00:00.000Z");
    expect(result?.readiness.calculatedAsOf).toBe(result?.calculatedAsOf);
    expect(result?.inputs).toHaveLength(2);
    expect(result?.inputs.every((item) => item.calculatedAsOf === result.calculatedAsOf)).toBe(
      true,
    );
    expect(result?.inputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          value: "UNKNOWN",
          achievementLevel: "NOT_STARTED",
          freshness: "UNKNOWN",
          confidence: null,
          supportingEvidenceIds: [],
          contradictingEvidenceIds: [],
        }),
      ]),
    );
    expect(result?.readiness.ruleEvaluations.map(({ kind }) => kind).sort()).toEqual([
      "ALL",
      "MANDATORY_FLOOR",
    ]);
  });

  it("is permutation invariant but changes the fingerprint when an authoritative input changes", () => {
    const original = baseInput();
    const expected = prepareTargetReadinessProjectionResults(decoded(original))[0]!
      .inputFingerprint;

    fc.assert(
      fc.property(
        fc.boolean(),
        fc.boolean(),
        fc.boolean(),
        (reverseRules, reverseLeaves, reverseSources) => {
          const permuted = structuredClone(original);
          if (reverseRules) permuted.goals[0]!.rules.reverse();
          if (reverseLeaves) permuted.goals[0]!.requiredLeaves.reverse();
          if (reverseSources) permuted.masterySource.competencies.reverse();
          if (reverseRules)
            permuted.goals[0]!.rules.find(
              ({ ruleKey }) => ruleKey === "rule:root",
            )!.members.reverse();
          const actual = prepareTargetReadinessProjectionResults(decoded(permuted))[0]!
            .inputFingerprint;
          expect(actual).toBe(expected);
        },
      ),
    );

    const later = baseInput("2026-08-28T12:00:00.001Z");
    expect(prepareTargetReadinessProjectionResults(decoded(later))[0]!.inputFingerprint).not.toBe(
      expected,
    );
  });

  it("keeps the exact Mastery freshness boundary fresh and expires one millisecond later", () => {
    const occurredAt = "2026-05-30T12:00:00.000Z";
    const event = masteryEvidence(
      "77777777-7777-4777-8777-777777777777",
      "88888888-8888-4888-8888-888888888888",
      occurredAt,
    );
    const boundary = "2026-08-28T12:00:00.000Z";
    const atBoundary = prepareTargetReadinessProjectionResults(
      decoded(oneLeafInput(boundary, [event])),
    )[0]!;
    expect(atBoundary.inputs[0]).toMatchObject({ freshness: "FRESH", value: "KNOWN" });
    expect(atBoundary.validUntil).toBe(boundary);

    const afterBoundary = prepareTargetReadinessProjectionResults(
      decoded(oneLeafInput("2026-08-28T12:00:00.001Z", [event])),
    )[0]!;
    expect(afterBoundary.inputs[0]).toMatchObject({ freshness: "STALE", value: "KNOWN" });
    expect(afterBoundary.validUntil).toBeNull();
  });

  it("rejects a DOMAIN requirement explicitly instead of converting it to Unknown", () => {
    const input = baseInput();
    input.goals[0]!.rules[0]!.members[0] = node(
      1,
      "domain:software-engineering",
      "KNOWLEDGE",
      "COMPLETED",
      "DOMAIN",
    );
    input.goals[0]!.requiredLeaves.splice(0, 1);
    input.masterySource.competencies.splice(0, 1);
    expect(() => prepareTargetReadinessProjectionResults(decoded(input))).toThrow(
      UnsupportedDomainRequirementError,
    );
  });

  it("orders failed and Unknown mandatory floors before other Unknown and known shortfalls", () => {
    const input = baseInput("2026-08-28T12:00:00.000Z");
    const failure = masteryEvidence(
      "77777777-7777-4777-8777-777777777771",
      "88888888-8888-4888-8888-888888888881",
      "2026-08-28T11:00:00.000Z",
      "KNOWLEDGE",
      "FAILURE",
    );
    const success = masteryEvidence(
      "77777777-7777-4777-8777-777777777772",
      "88888888-8888-4888-8888-888888888882",
      "2026-08-28T11:00:00.000Z",
    );
    input.sourceEvidenceWatermark = "2";
    input.goals[0]!.rules = [
      {
        ruleKey: "rule:root",
        ruleType: "ALL",
        criticality: "MANDATORY",
        requiredCount: null,
        threshold: null,
        members: [
          ruleMember(1, "rule:failed-floor"),
          ruleMember(2, "rule:unknown-floor"),
          node(3, "competency:other-unknown", "KNOWLEDGE", "COMPLETED"),
          node(4, "competency:shortfall", "KNOWLEDGE", "MASTERED"),
        ],
      },
      {
        ruleKey: "rule:failed-floor",
        ruleType: "MANDATORY_FLOOR",
        criticality: "MANDATORY",
        requiredCount: null,
        threshold: null,
        members: [node(1, "competency:failed-floor", "KNOWLEDGE", "COMPLETED")],
      },
      {
        ruleKey: "rule:unknown-floor",
        ruleType: "MANDATORY_FLOOR",
        criticality: "MANDATORY",
        requiredCount: null,
        threshold: null,
        members: [node(1, "competency:unknown-floor", "KNOWLEDGE", "COMPLETED")],
      },
    ];
    input.goals[0]!.requiredLeaves = [
      {
        competencyRef: "competency:failed-floor",
        dimension: "KNOWLEDGE",
        requiredLevel: "COMPLETED",
        owningRuleKeys: ["rule:failed-floor"],
      },
      {
        competencyRef: "competency:unknown-floor",
        dimension: "KNOWLEDGE",
        requiredLevel: "COMPLETED",
        owningRuleKeys: ["rule:unknown-floor"],
      },
      {
        competencyRef: "competency:other-unknown",
        dimension: "KNOWLEDGE",
        requiredLevel: "COMPLETED",
        owningRuleKeys: ["rule:root"],
      },
      {
        competencyRef: "competency:shortfall",
        dimension: "KNOWLEDGE",
        requiredLevel: "MASTERED",
        owningRuleKeys: ["rule:root"],
      },
    ];
    input.masterySource = {
      ...input.masterySource,
      sourceEvidenceWatermark: "2",
      competencies: [
        { competencyRef: "competency:failed-floor", evidence: [failure] },
        { competencyRef: "competency:unknown-floor", evidence: [] },
        { competencyRef: "competency:other-unknown", evidence: [] },
        { competencyRef: "competency:shortfall", evidence: [success] },
      ],
    };

    expect(
      prepareTargetReadinessProjectionResults(decoded(input))[0]!.gaps.map(
        ({ gapCode }) => gapCode,
      ),
    ).toEqual([
      "FAILED_MANDATORY_FLOOR",
      "UNKNOWN_MANDATORY_FLOOR",
      "UNKNOWN_REQUIREMENT",
      "KNOWN_SHORTFALL",
    ]);
  });
});

function claim() {
  return {
    delivery_id: deliveryId,
    workspace_id: workspaceId,
    lease_token: leaseToken,
    event_position: 7,
  };
}

function client(
  handler: (
    name: string,
    parameters: Record<string, unknown>,
  ) => { readonly data: unknown; readonly error: unknown | null },
): PandoSupabaseClient {
  return {
    rpc(name: string, parameters: Record<string, unknown> = {}) {
      return Promise.resolve(handler(name, parameters));
    },
  } as unknown as PandoSupabaseClient;
}

describe("Target readiness projection dispatcher", () => {
  it("rejects an oversized completion before crossing the database boundary", () => {
    expect(() =>
      assertTargetReadinessCompletionPayloadWithinBudget([
        "x".repeat(TARGET_READINESS_COMPLETION_MAX_UTF8_BYTES),
      ]),
    ).toThrow(TargetReadinessCompletionCapacityError);
    expect(() =>
      assertTargetReadinessCompletionPayloadWithinBudget([{ small: true }]),
    ).not.toThrow();
  });

  it("claims, calculates, and completes the exact result envelope", async () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    const summary = await dispatchTargetReadinessProjection(
      client((name, parameters) => {
        calls.push([name, parameters]);
        if (name === "claim_target_readiness_projection_v1")
          return { data: [claim()], error: null };
        if (name === "load_target_readiness_projection_v1")
          return { data: baseInput(), error: null };
        if (name === "complete_target_readiness_projection_v1") return { data: true, error: null };
        throw new Error(name);
      }),
    );

    expect(summary).toEqual({ configured: true, claimed: 1, completed: 1, retried: 0 });
    const completion = calls.find(([name]) => name === "complete_target_readiness_projection_v1")!;
    const result = (completion[1].p_results as Array<Record<string, unknown>>)[0]!;
    expect(Object.keys(result).sort()).toEqual(
      [
        "readinessGoalId",
        "profileVersionId",
        "projectionGeneration",
        "inputFingerprint",
        "sourceEvidenceWatermark",
        "calculatedAsOf",
        "validUntil",
        "masteryEngineVersion",
        "masteryPolicyVersion",
        "readiness",
        "gaps",
        "inputs",
      ].sort(),
    );
    expect(result.inputFingerprint).toMatch(/^readiness-input:[a-f0-9]{64}$/u);
  });

  it("classifies a false completion as stale input", async () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    const summary = await dispatchTargetReadinessProjection(
      client((name, parameters) => {
        calls.push([name, parameters]);
        if (name === "claim_target_readiness_projection_v1")
          return { data: [claim()], error: null };
        if (name === "load_target_readiness_projection_v1")
          return { data: baseInput(), error: null };
        if (name === "complete_target_readiness_projection_v1") return { data: false, error: null };
        if (name === "fail_target_readiness_projection_v1") return { data: "retry", error: null };
        throw new Error(name);
      }),
    );

    expect(summary.retried).toBe(1);
    expect(
      calls.find(([name]) => name === "fail_target_readiness_projection_v1")?.[1],
    ).toMatchObject({
      p_failure_class: "STALE_INPUT",
      p_error_code: "STALE_READINESS_INPUT",
    });
  });

  it("dead-letters explicit unsupported DOMAIN input and retries transient source races", async () => {
    for (const scenario of ["domain", "race"] as const) {
      const calls: Array<[string, Record<string, unknown>]> = [];
      const unsupported = { ...baseInput(), projectionError: "UNSUPPORTED_DOMAIN_REQUIREMENT" };
      const summary = await dispatchTargetReadinessProjection(
        client((name, parameters) => {
          calls.push([name, parameters]);
          if (name === "claim_target_readiness_projection_v1")
            return { data: [claim()], error: null };
          if (name === "load_target_readiness_projection_v1") {
            return scenario === "domain"
              ? { data: unsupported, error: null }
              : {
                  data: null,
                  error: { code: "40001", message: "readiness Evidence watermark changed" },
                };
          }
          if (name === "fail_target_readiness_projection_v1") return { data: "retry", error: null };
          throw new Error(name);
        }),
      );

      expect(summary.retried).toBe(1);
      expect(
        calls.find(([name]) => name === "fail_target_readiness_projection_v1")?.[1],
      ).toMatchObject(
        scenario === "domain"
          ? { p_failure_class: "INVALID_CONTRACT", p_error_code: "UNSUPPORTED_DOMAIN_REQUIREMENT" }
          : { p_failure_class: "TRANSIENT", p_error_code: "DISPATCH_FAILED" },
      );
    }
  });
});
