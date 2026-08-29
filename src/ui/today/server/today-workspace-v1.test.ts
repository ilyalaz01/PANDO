import fixture from "../../../../tests/contract/fixtures/planning/v1/today-workspace.boundary.json";
import golden from "../../../../tests/fixtures/calculation-engines/v0.1/planning.golden.json";
import { describe, expect, it } from "vitest";

import { decodeTodayWorkspaceV1, TodayWorkspaceContractError } from "./today-workspace-v1";

describe("TodayWorkspaceV1", () => {
  it("decodes the strict Planning-owned freshness envelope", () => {
    expect(decodeTodayWorkspaceV1(fixture)).toEqual(fixture);
  });

  it("rejects unknown fields and incoherent state semantics", () => {
    expect(() => decodeTodayWorkspaceV1({ ...fixture, workspaceId: "private" })).toThrow(
      TodayWorkspaceContractError,
    );

    expect(() =>
      decodeTodayWorkspaceV1({
        ...fixture,
        projectionState: "CURRENT",
        reason: null,
      }),
    ).toThrow(TodayWorkspaceContractError);
  });

  it("rejects a selector when the envelope is not authoritative", () => {
    expect(() =>
      decodeTodayWorkspaceV1({
        ...fixture,
        actionSelections: [
          {
            selectionRef: "plan-action:10000000-0000-4000-8000-000000000001",
            rank: 1,
            candidateKey: "candidate:typing-practice",
          },
        ],
      }),
    ).toThrow(TodayWorkspaceContractError);
  });

  it("accepts equivalent database timestamp forms but rejects hidden microsecond drift", () => {
    const plan = golden.expected;
    const current = {
      contract: { name: "TodayWorkspaceV1", version: "1.0.0" },
      projectionState: "CURRENT",
      reason: null,
      lastKnownSafe: true,
      calculationClock: {
        asOf: plan.calculatedAsOf,
        timeZone: plan.timeZone,
        weekStart: plan.weekStart.replace(".000Z", "+00:00"),
        weekEnd: plan.weekEnd.replace(".000Z", "+00:00"),
      },
      currentInputFingerprint: plan.inputFingerprint,
      snapshot: {
        snapshotId: "50000000-0000-4000-8000-000000000001",
        inputFingerprint: plan.inputFingerprint,
        calculatedAsOf: plan.calculatedAsOf.replace(".000Z", "+00:00"),
        validUntil: plan.validUntil.replace(".000Z", "+00:00"),
        plan,
      },
      actionSelections: plan.actions.map((action, index) => ({
        selectionRef: `plan-action:40000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        rank: action.rank,
        candidateKey: action.candidateKey,
      })),
      context: { nearestDeadline: plan.nearestDeadline },
    };

    expect(decodeTodayWorkspaceV1(current)).toEqual(current);
    expect(() =>
      decodeTodayWorkspaceV1({
        ...current,
        snapshot: {
          ...current.snapshot,
          calculatedAsOf: "2026-09-01T12:00:00.000001Z",
        },
      }),
    ).toThrow(TodayWorkspaceContractError);
  });
});
