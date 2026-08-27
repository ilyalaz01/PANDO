import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { foldReviewSchedule } from "./fold-review-schedule";
import { REVIEW_POLICY_V0_1 } from "./review-policy-v0.1";
import type { ReviewActionEventInput, ReviewReasonSourceEventInput } from "./review-schedule-types";

const clock = { asOf: "2026-08-27T12:00:00Z" } as const;

function source(
  overrides: Partial<ReviewReasonSourceEventInput> = {},
): ReviewReasonSourceEventInput {
  return {
    eventId: "source-event:retention:1",
    reasonId: "reason:retention",
    sourceKey: "mastery:python:knowledge:retention",
    sourceRevision: 1,
    sourceKind: "MASTERY",
    subjectId: "competency:python/knowledge",
    reason: "RETENTION_RISK",
    occurrenceId: "evidence:11111111-1111-4111-8111-111111111111",
    baseDueAt: "2026-08-30T12:00:00Z",
    sourceActive: true,
    ...overrides,
  };
}

function action(overrides: Partial<ReviewActionEventInput> = {}): ReviewActionEventInput {
  return {
    actionId: "action:1",
    actionRevision: 2,
    sourceKey: "mastery:python:knowledge:retention",
    occurrenceId: "evidence:11111111-1111-4111-8111-111111111111",
    action: "RESCHEDULE",
    occurredAt: "2026-08-27T12:00:00Z",
    targetDueAt: "2026-09-02T12:00:00Z",
    ...overrides,
  };
}

function calculate(
  sourceEvents: readonly ReviewReasonSourceEventInput[],
  actionEvents: readonly ReviewActionEventInput[] = [],
) {
  return foldReviewSchedule(
    {
      workspaceId: "workspace:personal",
      subjectId: "competency:python/knowledge",
      inputWatermark: "5",
      sourceEvents,
      actionEvents,
    },
    REVIEW_POLICY_V0_1,
    clock,
  );
}

describe("review schedule fold", () => {
  it("merges sources and keeps one earliest-due item", () => {
    const result = calculate([
      source(),
      source({
        eventId: "source-event:verification:1",
        reasonId: "reason:verification",
        sourceKey: "mastery:python:knowledge:verification",
        reason: "VERIFICATION_NEEDED",
        baseDueAt: "2026-08-29T12:00:00Z",
      }),
    ]);

    expect(result.calculation.item?.effectiveDueAt).toBe("2026-08-29T12:00:00.000Z");
    expect(result.calculation.item?.reasons).toHaveLength(2);
    expect(result.reasons.every(({ active }) => active)).toBe(true);
  });

  it("applies reschedule and skip only to their bound occurrence", () => {
    const current = source();
    const moved = calculate([current], [action()]);
    const nextOccurrence = calculate(
      [
        current,
        source({
          eventId: "source-event:retention:2",
          sourceRevision: 2,
          occurrenceId: "evidence:22222222-2222-4222-8222-222222222222",
          baseDueAt: "2026-09-05T12:00:00Z",
        }),
      ],
      [action()],
    );

    expect(moved.reasons[0]?.dueAt).toBe("2026-09-02T12:00:00.000Z");
    expect(nextOccurrence.reasons[0]?.dueAt).toBe("2026-09-05T12:00:00.000Z");
  });

  it("keeps suppression across new source occurrences until restore", () => {
    const suppressed = action({ action: "SUPPRESS", targetDueAt: null });
    const next = source({
      eventId: "source-event:retention:2",
      sourceRevision: 2,
      occurrenceId: "evidence:22222222-2222-4222-8222-222222222222",
    });
    const beforeRestore = calculate([source(), next], [suppressed]);
    const afterRestore = calculate(
      [source(), next],
      [
        suppressed,
        action({
          actionId: "action:2",
          actionRevision: 3,
          action: "RESTORE",
          occurrenceId: next.occurrenceId,
          occurredAt: "2026-08-28T12:00:00Z",
          targetDueAt: null,
        }),
      ],
    );

    expect(beforeRestore.calculation.item).toBeNull();
    expect(beforeRestore.reasons[0]).toMatchObject({ active: false, suppressed: true });
    expect(afterRestore.reasons[0]).toMatchObject({ active: true, suppressed: false });
  });

  it("does not let one reason action change a sibling", () => {
    const reminder = source({
      eventId: "source-event:reminder:1",
      reasonId: "reason:reminder",
      sourceKey: "personal:python:knowledge",
      sourceKind: "PERSONAL_REMINDER",
      reason: "PERSONAL_REMINDER",
      occurrenceId: "reminder:1",
      baseDueAt: "2026-08-31T12:00:00Z",
    });
    const result = calculate([source(), reminder], [action()]);

    expect(result.reasons.find(({ reason }) => reason === "RETENTION_RISK")?.dueAt).toBe(
      "2026-09-02T12:00:00.000Z",
    );
    expect(result.reasons.find(({ reason }) => reason === "PERSONAL_REMINDER")?.dueAt).toBe(
      "2026-08-31T12:00:00.000Z",
    );
  });

  it("is invariant to input order and exact replay", () => {
    const sources = [
      source(),
      source({
        eventId: "source-event:verification:1",
        reasonId: "reason:verification",
        sourceKey: "mastery:python:knowledge:verification",
        reason: "VERIFICATION_NEEDED",
      }),
    ];
    const actions = [
      action(),
      action({ actionId: "action:2", actionRevision: 3, action: "SUPPRESS", targetDueAt: null }),
    ];
    const expected = calculate(sources, actions);

    fc.assert(
      fc.property(fc.boolean(), fc.boolean(), (reverseSources, reverseActions) => {
        const orderedSources = reverseSources ? [...sources].reverse() : [...sources];
        const orderedActions = reverseActions ? [...actions].reverse() : [...actions];
        expect(
          calculate([...orderedSources, sources[0]!], [...orderedActions, actions[0]!]),
        ).toEqual(expected);
      }),
    );
  });

  it("rejects two skip-once actions for one occurrence and conflicting source revisions", () => {
    expect(() =>
      calculate(
        [source()],
        [
          action({ action: "SKIP_ONCE" }),
          action({ actionId: "action:2", actionRevision: 3, action: "SKIP_ONCE" }),
        ],
      ),
    ).toThrow(/skipped more than once/u);
    expect(() =>
      calculate([
        source(),
        source({ eventId: "source-event:conflict", baseDueAt: "2026-09-01T12:00:00Z" }),
      ]),
    ).toThrow(/conflicting events at revision/u);
  });
});
