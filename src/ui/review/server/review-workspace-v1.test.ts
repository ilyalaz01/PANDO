import { describe, expect, it } from "vitest";
import { decodeReviewWorkspaceV1 } from "./review-workspace-v1";

const reasonId = "10000000-0000-4000-8000-000000000001";
function workspace() {
  return {
    contract: { name: "ReviewWorkspaceV1", version: "1.0.0" },
    asOf: "2026-08-27T10:00:00.000Z",
    timeZone: "UTC",
    projectionState: "current",
    items: [
      {
        subjectId: "20000000-0000-4000-8000-000000000001",
        subjectRef: "competency:python-errors/knowledge",
        competencyRef: "competency:python-errors",
        dimension: "KNOWLEDGE",
        title: "Python error handling",
        effectiveDueAt: "2026-08-27T09:00:00.000Z",
        bucket: "OVERDUE",
        projectionVersion: "2",
        reasons: [
          {
            reasonId,
            reasonType: "RETENTION_RISK",
            dueAt: "2026-08-27T09:00:00.000Z",
            status: "active",
            sourceRevision: "1",
          },
        ],
        focus: { readinessGoalKey: "goal:personal-main", activityKey: "activity:typing-practice" },
      },
    ],
  };
}
describe("ReviewWorkspaceV1", () => {
  it("decodes a bounded, owner-safe review queue", () => {
    expect(decodeReviewWorkspaceV1(workspace())).toMatchObject({
      items: [{ bucket: "OVERDUE", reasons: [{ reasonType: "RETENTION_RISK" }] }],
    });
  });
  it("rejects a suppressed bucket with an active due instant", () => {
    const invalid = workspace();
    invalid.items[0]!.bucket = "SUPPRESSED";
    expect(() => decodeReviewWorkspaceV1(invalid)).toThrow(/bucket/u);
  });
  it("accepts owner-provided angle brackets as escaped text, not markup", () => {
    const safeText = workspace();
    safeText.items[0]!.title = "Compare a < b without rendering HTML";
    expect(decodeReviewWorkspaceV1(safeText).items[0]?.title).toBe(
      "Compare a < b without rendering HTML",
    );
  });
});
