// @vitest-environment node

import { describe, expect, it } from "vitest";

import { decodeFocusWorkspaceV1 } from "./focus-workspace-v1";

function value() {
  return {
    contract: { name: "FocusWorkspaceV1", version: "1.0.0" },
    readinessGoalKey: "goal:personal-main",
    activity: {
      activityKey: "activity:typing-practice",
      title: "Typing practice",
      activityType: "MANUAL_CODING",
      competencyRef: "competency:python-typing",
      evidenceDimension: "APPLICATION",
      expectedEvidence: "Produce a working result.",
      resourceUrl: "https://example.test/practice",
    },
    activeSession: {
      focusSessionId: "10000000-0000-4000-8000-000000000001",
      activityKey: "activity:typing-practice",
      title: "Typing practice",
      state: "active",
      plannedMinutes: 25,
      sessionVersion: "1",
      startedAt: "2026-08-27T08:00:00.000Z",
    },
    history: [
      {
        focusSessionId: "10000000-0000-4000-8000-000000000002",
        activityKey: "activity:typing-practice",
        title: "Typing practice",
        state: "completed",
        startedAt: "2026-08-26T08:00:00.000Z",
        endedAt: "2026-08-26T08:25:00.000Z",
        resultKind: "OBSERVED_SUCCESS",
        evidenceId: "20000000-0000-4000-8000-000000000001",
        evidenceValid: true,
        dimension: "APPLICATION",
        outcome: "SUCCESS",
        ledgerWatermark: "1",
      },
    ],
    masteryState: {
      engineVersion: "mastery-engine/0.1.0",
      policyVersion: "mastery-readiness-policy/0.1",
      inputWatermark: "1",
      competencyId: "competency:python-typing",
      calculatedAsOf: "2026-08-27T08:01:00.000Z",
      achievementLevel: "COMPLETED",
      dimensions: {},
      supportingEvidenceIds: ["20000000-0000-4000-8000-000000000001"],
      contradictingEvidenceIds: [],
      explanationCodes: ["ACHIEVEMENT_COMPLETED"],
    },
    projectionState: "current",
  };
}

describe("FocusWorkspaceV1 decoder", () => {
  it("decodes the bounded activity, active session, history, and mastery summary", () => {
    expect(decodeFocusWorkspaceV1(value())).toMatchObject({
      readinessGoalKey: "goal:personal-main",
      activity: { evidenceDimension: "APPLICATION" },
      activeSession: { plannedMinutes: 25 },
      history: [{ evidenceValid: true, outcome: "SUCCESS" }],
      masteryState: { achievementLevel: "COMPLETED" },
      projectionState: "current",
    });
  });

  it("allows null optional state for a not-yet-started activity", () => {
    const decoded = decodeFocusWorkspaceV1({
      ...value(),
      activeSession: null,
      history: [],
      masteryState: null,
      projectionState: "not_started",
    });
    expect(decoded.activeSession).toBeNull();
    expect(decoded.masteryState).toBeNull();
  });

  it.each([
    ["contract drift", { ...value(), contract: { name: "FocusWorkspaceV2", version: "2" } }],
    ["unsafe title", { ...value(), activity: { ...value().activity, title: "Bad <title>" } }],
    [
      "credential URL",
      { ...value(), activity: { ...value().activity, resourceUrl: "https://u:p@example.test" } },
    ],
    ["future enum", { ...value(), projectionState: "done" }],
    ["bad session", { ...value(), activeSession: { ...value().activeSession, plannedMinutes: 0 } }],
    ["bad history", { ...value(), history: [{ ...value().history[0], evidenceId: "foreign" }] }],
    [
      "bad mastery",
      { ...value(), masteryState: { ...value().masteryState, engineVersion: "future" } },
    ],
    [
      "active activity mismatch",
      {
        ...value(),
        activeSession: { ...value().activeSession, activityKey: "activity:another" },
      },
    ],
    [
      "mastery competency mismatch",
      {
        ...value(),
        masteryState: { ...value().masteryState, competencyId: "competency:another" },
      },
    ],
    ["current without mastery", { ...value(), masteryState: null }],
    [
      "evidence without observed result",
      { ...value(), history: [{ ...value().history[0], resultKind: "COMPLETION_ONLY" }] },
    ],
    [
      "observed result without evidence",
      {
        ...value(),
        history: [
          {
            ...value().history[0],
            evidenceId: null,
            evidenceValid: null,
            dimension: null,
            outcome: null,
            ledgerWatermark: null,
          },
        ],
      },
    ],
  ])("fails closed on %s", (_label, candidate) => {
    expect(() => decodeFocusWorkspaceV1(candidate)).toThrow(TypeError);
  });

  it("rejects an unbounded history response", () => {
    expect(() =>
      decodeFocusWorkspaceV1({
        ...value(),
        history: Array.from({ length: 21 }, () => value().history[0]),
      }),
    ).toThrow("unbounded");
  });
});
