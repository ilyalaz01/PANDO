// @vitest-environment node

import { describe, expect, it } from "vitest";

import { calculatePlan } from "../../src/modules/planning/application/calculate-plan";
import { PLANNING_POLICY_V0_1 } from "../../src/modules/planning/domain/planning-policy-v0.1";
import type {
  CalculatePlanInput,
  PlanSnapshot,
} from "../../src/modules/planning/domain/planning-types";
import {
  planSnapshotSemanticViolations,
  planningInputFingerprint,
  planningInputSemanticViolations,
  todayWorkspaceSemanticViolations,
} from "../../src/shared/contracts/planning-semantics";
import { validateSchema } from "../../src/shared/contracts/schema-registry";
import planningGolden from "../fixtures/calculation-engines/v0.1/planning.golden.json";
import inputBoundary from "./fixtures/planning/v1/planning-input.boundary.json";
import inputInvalid from "./fixtures/planning/v1/planning-input.invalid.json";
import inputMalicious from "./fixtures/planning/v1/planning-input.malicious.json";
import snapshotBoundary from "./fixtures/planning/v1/plan-snapshot.boundary.json";
import snapshotInvalid from "./fixtures/planning/v1/plan-snapshot.invalid.json";
import snapshotMalicious from "./fixtures/planning/v1/plan-snapshot.malicious.json";
import todayBoundary from "./fixtures/planning/v1/today-workspace.boundary.json";
import todayInvalid from "./fixtures/planning/v1/today-workspace.invalid.json";
import todayMalicious from "./fixtures/planning/v1/today-workspace.malicious.json";

type RecordValue = Record<string, unknown>;

describe("PlanningCalculationInputV1", () => {
  it("keeps valid, invalid, boundary, and malicious fixtures executable", () => {
    expect(validateSchema("planning-input-v1", planningGolden.input).valid).toBe(true);
    expect(validateSchema("planning-input-v1", inputBoundary).valid).toBe(true);
    expect(validateSchema("planning-input-v1", inputInvalid).valid).toBe(false);
    expect(validateSchema("planning-input-v1", inputMalicious).valid).toBe(false);
    expect(planningInputFingerprint(planningGolden.input)).toBe(
      planningGolden.input.inputFingerprint,
    );
    expect(planningInputSemanticViolations(planningGolden.input)).toEqual([]);
    expect(planningInputSemanticViolations(inputBoundary)).toEqual([]);
  });

  it("keeps the 200-candidate worker bound aligned with the schema", () => {
    const base = structuredClone(planningGolden.input) as RecordValue;
    const candidate = (base.candidates as unknown as RecordValue[])[0]!;
    base.campaign = null;
    base.candidates = Array.from({ length: 200 }, (_unused, index) => ({
      ...candidate,
      candidateKey: `candidate:bounded-${String(index).padStart(3, "0")}`,
      activityKey: `activity:bounded-${String(index).padStart(3, "0")}`,
      sourceSignals: ["GROWTH_PLAN"],
    }));
    expect(validateSchema("planning-input-v1", base).valid).toBe(true);
    (base.candidates as unknown[]).push(structuredClone(candidate));
    expect(validateSchema("planning-input-v1", base).valid).toBe(false);
  });

  it("keeps the canonical fingerprint stable for set-like input permutations", () => {
    const changed = structuredClone(planningGolden.input);
    changed.candidates.reverse();
    changed.readiness[0]!.gaps.reverse();
    changed.candidates[0]!.sourceSignals.reverse();
    expect(planningInputFingerprint(changed)).toBe(planningGolden.input.inputFingerprint);
  });

  it("produces the boundary no-plan result without inventing capacity", () => {
    const result = calculatePlan(
      inputBoundary as unknown as CalculatePlanInput,
      PLANNING_POLICY_V0_1,
    );
    expect(result).toEqual(snapshotBoundary);
  });
});

describe("PlanSnapshotV1", () => {
  it("keeps valid, invalid, boundary, and malicious fixtures executable", () => {
    expect(validateSchema("plan-snapshot-v1", planningGolden.expected).valid).toBe(true);
    expect(validateSchema("plan-snapshot-v1", snapshotBoundary).valid).toBe(true);
    expect(validateSchema("plan-snapshot-v1", snapshotInvalid).valid).toBe(false);
    expect(validateSchema("plan-snapshot-v1", snapshotMalicious).valid).toBe(false);
  });

  it("accepts coherent engine output semantically", () => {
    expect(planSnapshotSemanticViolations(planningGolden.expected)).toEqual([]);
    expect(planSnapshotSemanticViolations(snapshotBoundary)).toEqual([]);
  });

  it("rejects rank gaps, score lies, duplicate actions, and inconsistent readiness", () => {
    const changed = structuredClone(planningGolden.expected) as unknown as PlanSnapshot &
      RecordValue;
    const actions = changed.actions as unknown as RecordValue[];
    actions[0]!.rank = 2;
    actions[0]!.score = 999_999;
    actions[1]!.candidateKey = actions[0]!.candidateKey;
    (changed.readiness as unknown as RecordValue[])[0]!.reason = "STALE";

    expect(validateSchema("plan-snapshot-v1", changed).valid).toBe(true);
    expect(planSnapshotSemanticViolations(changed)).toEqual([
      "PLAN_SNAPSHOT_ACTION_0_SCORE_SUM",
      "PLAN_SNAPSHOT_ACTION_DUPLICATE",
      "PLAN_SNAPSHOT_RANK_ORDER",
      "PLAN_SNAPSHOT_READINESS_SHAPE",
    ]);
  });

  it("rejects a mismatched input fingerprint and a coherently renumbered action reorder", () => {
    const changedInput = structuredClone(planningGolden.input) as RecordValue;
    changedInput.sessionLimitMinutes = 30;
    expect(planningInputFingerprint(changedInput)).not.toBe(changedInput.inputFingerprint);
    expect(planningInputSemanticViolations(changedInput)).toContain("PLANNING_INPUT_FINGERPRINT");

    const changedSnapshot = structuredClone(planningGolden.expected) as RecordValue;
    const actions = changedSnapshot.actions as RecordValue[];
    [actions[0], actions[1]] = [actions[1]!, actions[0]!];
    actions[0]!.rank = 1;
    actions[1]!.rank = 2;
    expect(validateSchema("plan-snapshot-v1", changedSnapshot).valid).toBe(true);
    expect(planSnapshotSemanticViolations(changedSnapshot)).toContain("PLAN_SNAPSHOT_ACTION_ORDER");
  });

  it("rejects a snapshot that outlives its Review summary", () => {
    const changed = structuredClone(planningGolden.expected) as RecordValue;
    (changed.reviewSummary as RecordValue).validUntil = "2026-09-01T17:59:59.999Z";
    expect(validateSchema("plan-snapshot-v1", changed).valid).toBe(true);
    expect(planSnapshotSemanticViolations(changed)).toContain("PLAN_SNAPSHOT_REVIEW_VALIDITY");
  });

  it("rejects a snapshot with an impossible inclusive clock horizon", () => {
    const changed = structuredClone(snapshotBoundary) as RecordValue;
    changed.validUntil = "2026-09-01T11:59:59.999Z";
    expect(validateSchema("plan-snapshot-v1", changed).valid).toBe(true);
    expect(planSnapshotSemanticViolations(changed)).toContain("PLAN_SNAPSHOT_CLOCK");
  });

  it("rejects Campaign and readiness freshness beyond their source cutoffs", () => {
    const campaign = structuredClone(planningGolden.expected) as RecordValue;
    campaign.validUntil = "2026-09-02T12:00:00.000Z";
    (campaign.reviewSummary as RecordValue).validUntil = "2026-09-02T12:00:00.000Z";
    expect(validateSchema("plan-snapshot-v1", campaign).valid).toBe(true);
    expect(planSnapshotSemanticViolations(campaign)).toContain("PLAN_SNAPSHOT_CAMPAIGN_VALIDITY");

    const readiness = structuredClone(planningGolden.expected) as RecordValue;
    ((readiness.readiness as RecordValue[])[0] as RecordValue).validUntil =
      "2026-09-01T17:59:59.999Z";
    expect(validateSchema("plan-snapshot-v1", readiness).valid).toBe(true);
    expect(planSnapshotSemanticViolations(readiness)).toContain("PLAN_SNAPSHOT_READINESS_VALIDITY");
  });

  it("binds causal track and campaign references to the exact action context", () => {
    const changed = structuredClone(planningGolden.expected) as RecordValue;
    const action = (changed.actions as RecordValue[])[0]!;
    const refs = action.reasonRefs as RecordValue[];
    const trackRef = refs.find(({ kind }) => kind === "TRACK")!;
    trackRef.trackId = "11000000-0000-4000-8000-000000000099";
    const campaignRef = refs.find(({ factorCode }) => factorCode === "CAMPAIGN_SOURCE")!;
    campaignRef.campaignVersion = "2";

    expect(validateSchema("plan-snapshot-v1", changed).valid).toBe(true);
    expect(planSnapshotSemanticViolations(changed)).toEqual(
      expect.arrayContaining([
        "PLAN_SNAPSHOT_ACTION_0_REASON_REF_COHERENCE",
        "PLAN_SNAPSHOT_CAMPAIGN_CONTEXT",
      ]),
    );
  });

  it("rejects clock-incoherent causal references and zero-point factors", () => {
    const changed = structuredClone(planningGolden.expected) as RecordValue;
    const actions = changed.actions as RecordValue[];
    const campaignRefs = (actions[0]!.reasonRefs as RecordValue[]).filter(
      ({ kind }) => kind === "CAMPAIGN",
    );
    for (const reference of campaignRefs) reference.daysUntilDeadline = 999;
    const reviewRef = (actions[1]!.reasonRefs as RecordValue[]).find(
      ({ kind }) => kind === "REVIEW_ITEM",
    )!;
    reviewRef.dueAt = "2030-01-01T00:00:00.000Z";
    (actions[3]!.scoreFactors as RecordValue[]).splice(1, 0, {
      code: "RECENT_REPETITION",
      points: 0,
    });

    expect(validateSchema("plan-snapshot-v1", changed).valid).toBe(true);
    expect(planSnapshotSemanticViolations(changed)).toEqual(
      expect.arrayContaining([
        "PLAN_SNAPSHOT_ACTION_0_REASON_REF_COHERENCE",
        "PLAN_SNAPSHOT_ACTION_1_REASON_REF_COHERENCE",
        "PLAN_SNAPSHOT_ACTION_3_FACTOR_POINTS",
      ]),
    );
  });

  it("rejects hidden private or authority-bearing fields structurally", () => {
    const changed = structuredClone(snapshotBoundary) as RecordValue;
    changed.evidenceBodies = ["private"];
    changed.workspaceId = "caller-selected";
    changed.table = "planning.plan_snapshots";
    expect(validateSchema("plan-snapshot-v1", changed).valid).toBe(false);
  });
});

describe("TodayWorkspaceV1", () => {
  it("validates boundary, invalid, malicious, and current envelopes", () => {
    expect(validateSchema("today-workspace-v1", todayBoundary).valid).toBe(true);
    expect(validateSchema("today-workspace-v1", todayInvalid).valid).toBe(false);
    expect(validateSchema("today-workspace-v1", todayMalicious).valid).toBe(false);
    expect(todayWorkspaceSemanticViolations(todayBoundary)).toEqual([]);

    const current = {
      contract: { name: "TodayWorkspaceV1", version: "1.0.0" },
      projectionState: "CURRENT",
      reason: null,
      lastKnownSafe: true,
      calculationClock: {
        asOf: planningGolden.expected.calculatedAsOf,
        timeZone: planningGolden.expected.timeZone,
        weekStart: planningGolden.expected.weekStart,
        weekEnd: planningGolden.expected.weekEnd,
      },
      currentInputFingerprint: planningGolden.expected.inputFingerprint,
      snapshot: {
        snapshotId: "15000000-0000-4000-8000-000000000001",
        inputFingerprint: planningGolden.expected.inputFingerprint,
        calculatedAsOf: planningGolden.expected.calculatedAsOf,
        validUntil: planningGolden.expected.validUntil,
        plan: planningGolden.expected,
      },
      actionSelections: planningGolden.expected.actions.map(({ rank, candidateKey }) => ({
        selectionRef: `plan-action:16000000-0000-4000-8000-00000000000${rank}`,
        rank,
        candidateKey,
      })),
      context: { nearestDeadline: planningGolden.expected.nearestDeadline },
    };
    expect(validateSchema("today-workspace-v1", current).valid).toBe(true);
    expect(todayWorkspaceSemanticViolations(current)).toEqual([]);

    const mismatchedDeadline = structuredClone(current) as RecordValue;
    (mismatchedDeadline.context as RecordValue).nearestDeadline = null;
    expect(todayWorkspaceSemanticViolations(mismatchedDeadline)).toContain(
      "TODAY_WORKSPACE_DEADLINE_SOURCE",
    );

    const corruptedPlan = structuredClone(current) as RecordValue;
    const embeddedPlan = (corruptedPlan.snapshot as RecordValue).plan as RecordValue;
    ((embeddedPlan.actions as RecordValue[])[0] as RecordValue).score = 999_999;
    expect(todayWorkspaceSemanticViolations(corruptedPlan)).toContain(
      "TODAY_WORKSPACE_PLAN_SEMANTICS",
    );
  });

  it("requires explicit safety and rejects expired last-known output", () => {
    const changed = structuredClone(todayBoundary) as RecordValue;
    changed.projectionState = "PENDING";
    changed.reason = "INPUTS_CHANGED";
    changed.currentInputFingerprint = null;
    changed.lastKnownSafe = true;
    changed.snapshot = {
      snapshotId: "15000000-0000-4000-8000-000000000001",
      inputFingerprint: planningGolden.expected.inputFingerprint,
      calculatedAsOf: planningGolden.expected.calculatedAsOf,
      validUntil: planningGolden.expected.validUntil,
      plan: planningGolden.expected,
    };
    changed.actionSelections = [];
    changed.context = { nearestDeadline: planningGolden.expected.nearestDeadline };
    expect(validateSchema("today-workspace-v1", changed).valid).toBe(true);
    expect(todayWorkspaceSemanticViolations(changed)).toEqual([]);

    changed.actionSelections = [
      {
        selectionRef: "plan-action:16000000-0000-4000-8000-000000000001",
        rank: 1,
        candidateKey: planningGolden.expected.actions[0]!.candidateKey,
      },
    ];
    expect(todayWorkspaceSemanticViolations(changed)).toContain(
      "TODAY_WORKSPACE_ACTION_SELECTIONS",
    );
    changed.actionSelections = [];

    (changed.calculationClock as RecordValue).asOf = "2026-09-01T18:00:00.001Z";
    expect(todayWorkspaceSemanticViolations(changed)).toContain("TODAY_WORKSPACE_SNAPSHOT_EXPIRED");
  });
});
