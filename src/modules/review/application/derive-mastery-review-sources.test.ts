import { describe, expect, it } from "vitest";

import type { ReviewReasonSourceEventInput } from "../domain/review-schedule-types";
import {
  deriveMasteryReviewSources,
  type DeriveMasteryReviewSourcesInput,
} from "./derive-mastery-review-sources";

const identities = [
  {
    reasonId: "11111111-1111-5111-a111-111111111111",
    sourceKey: "mastery:competency:python/knowledge:retention",
    reason: "RETENTION_RISK",
  },
  {
    reasonId: "22222222-2222-5222-a222-222222222222",
    sourceKey: "mastery:competency:python/knowledge:verification",
    reason: "VERIFICATION_NEEDED",
  },
] as const;

function derive(
  overrides: Partial<DeriveMasteryReviewSourcesInput> = {},
): readonly ReviewReasonSourceEventInput[] {
  return deriveMasteryReviewSources({
    subjectId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    identities,
    sourceEvents: [],
    signal: {
      achievementLevel: "COMPLETED",
      latestQualifyingSuccessAt: "2026-08-27T10:00:00.000Z",
      latestSupportingEvidenceId: "33333333-3333-4333-8333-333333333333",
    },
    createEventId: (identity, revision) => `${identity.reason}:${revision}`,
    ...overrides,
  });
}

describe("Mastery to Review source adapter", () => {
  it("creates both initial reasons three days after a qualifying success", () => {
    const result = derive();

    expect(result).toHaveLength(2);
    expect(result.map(({ reason }) => reason).sort()).toEqual([
      "RETENTION_RISK",
      "VERIFICATION_NEEDED",
    ]);
    expect(result.every(({ baseDueAt }) => baseDueAt === "2026-08-30T10:00:00.000Z")).toBe(true);
    expect(result.every(({ sourceActive }) => sourceActive)).toBe(true);
  });

  it("deactivates verification after the dimension becomes verified", () => {
    const initial = derive();
    const result = derive({
      sourceEvents: initial,
      signal: {
        achievementLevel: "VERIFIED",
        latestQualifyingSuccessAt: "2026-08-27T10:00:00.000Z",
        latestSupportingEvidenceId: "33333333-3333-4333-8333-333333333333",
      },
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      reason: "VERIFICATION_NEEDED",
      sourceRevision: 2,
      sourceActive: false,
    });
  });

  it("closes active reasons after correction without inventing a new occurrence", () => {
    const initial = derive();
    const result = derive({
      sourceEvents: initial,
      signal: {
        achievementLevel: "NOT_STARTED",
        latestQualifyingSuccessAt: null,
        latestSupportingEvidenceId: null,
      },
    });

    expect(result).toHaveLength(2);
    expect(result.every(({ sourceActive }) => !sourceActive)).toBe(true);
    expect(result.every(({ occurrenceId }) => occurrenceId === initial[0]?.occurrenceId)).toBe(
      true,
    );
  });

  it("does not append a revision when the authoritative signal is unchanged", () => {
    const initial = derive();
    expect(derive({ sourceEvents: [...initial].reverse() })).toEqual([]);
  });
});
