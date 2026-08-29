import fixture from "../../../../tests/contract/fixtures/planning/v1/today-workspace.boundary.json";
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
});
