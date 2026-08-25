import fc from "fast-check";
import { describe, expect, it } from "vitest";
import reviewGolden from "../../../../tests/fixtures/calculation-engines/v0.1/review.golden.json";
import {
  calculateInitialReviewDueAt,
  calculateReviewItem,
  scheduleReviewResponse,
} from "./calculate-review-item";
import { REVIEW_POLICY_V0_1 } from "./review-policy-v0.1";
import {
  ReviewInputError,
  type CalculateReviewItemInput,
  type ReviewReasonEventInput,
} from "./review-types";

const fixture = reviewGolden as unknown as {
  readonly input: CalculateReviewItemInput;
  readonly clock: { readonly asOf: string };
  readonly expected: unknown;
};

function reason(overrides: Partial<ReviewReasonEventInput> = {}): ReviewReasonEventInput {
  return {
    eventId: "event:base",
    sourceKey: "source:base",
    sourceRevision: 1,
    subjectId: "subject:recall",
    reason: "RETENTION_RISK",
    dueAt: "2024-04-02T12:00:00Z",
    active: true,
    ...overrides,
  };
}

function calculate(reasonEvents: readonly ReviewReasonEventInput[], asOf = "2024-04-01T12:00:00Z") {
  return calculateReviewItem(
    {
      workspaceId: "workspace:personal",
      subjectId: "subject:recall",
      inputWatermark: "review:1",
      reasonEvents,
    },
    REVIEW_POLICY_V0_1,
    { asOf },
  );
}

describe("review engine", () => {
  it("matches the versioned merge/dedup golden fixture", () => {
    expect(calculateReviewItem(fixture.input, REVIEW_POLICY_V0_1, fixture.clock)).toEqual(
      fixture.expected,
    );
  });

  it("applies every initial due rule and the goal deadline cap", () => {
    const base = {
      anchorAt: "2024-02-28T12:00:00Z",
      selectedDueAt: null,
      proposedDueAt: null,
      goalDeadlineAt: null,
    };

    expect(
      calculateInitialReviewDueAt({ ...base, reason: "VERIFICATION_NEEDED" }, REVIEW_POLICY_V0_1),
    ).toBe("2024-03-02T12:00:00.000Z");
    expect(
      calculateInitialReviewDueAt({ ...base, reason: "RETENTION_RISK" }, REVIEW_POLICY_V0_1),
    ).toBe("2024-03-02T12:00:00.000Z");
    expect(
      calculateInitialReviewDueAt(
        {
          ...base,
          reason: "PERSONAL_REMINDER",
          selectedDueAt: "2024-03-10T09:30:00+02:00",
        },
        REVIEW_POLICY_V0_1,
      ),
    ).toBe("2024-03-10T07:30:00.000Z");
    expect(
      calculateInitialReviewDueAt(
        {
          ...base,
          reason: "GOAL_DEADLINE",
          proposedDueAt: "2024-04-18T12:00:00Z",
          goalDeadlineAt: "2024-04-20T12:00:00Z",
        },
        REVIEW_POLICY_V0_1,
      ),
    ).toBe("2024-04-13T12:00:00.000Z");
  });

  it("uses exact UTC durations across a daylight-saving transition", () => {
    expect(
      calculateInitialReviewDueAt(
        {
          reason: "VERIFICATION_NEEDED",
          anchorAt: "2024-03-09T12:00:00-05:00",
          selectedDueAt: null,
          proposedDueAt: null,
          goalDeadlineAt: null,
        },
        REVIEW_POLICY_V0_1,
      ),
    ).toBe("2024-03-12T17:00:00.000Z");
  });

  it.each([
    ["AGAIN", 20, 1],
    ["HARD", 5, 6],
    ["GOOD", 3, 6],
    ["EASY", 3, 9],
    ["EASY", 100, 180],
  ] as const)(
    "schedules %s from the transparent response table",
    (response, previousIntervalDays, expectedDays) => {
      expect(
        scheduleReviewResponse(
          {
            response,
            completedAt: "2024-04-01T12:00:00Z",
            previousIntervalDays,
          },
          REVIEW_POLICY_V0_1,
        ),
      ).toEqual({
        response,
        intervalDays: expectedDays,
        dueAt: new Date(
          Date.parse("2024-04-01T12:00:00Z") + expectedDays * 86_400_000,
        ).toISOString(),
      });
    },
  );

  it("uses the default interval and evaluates due state only at query time", () => {
    const scheduled = scheduleReviewResponse(
      {
        response: "GOOD",
        completedAt: "2024-04-01T12:00:00Z",
        previousIntervalDays: null,
      },
      REVIEW_POLICY_V0_1,
    );
    const event = reason({ dueAt: scheduled.dueAt });

    expect(scheduled.intervalDays).toBe(6);
    expect(calculate([event], scheduled.dueAt).item?.timing).toBe("DUE");
    expect(calculate([event], "2024-04-08T12:00:00Z").item?.timing).toBe("OVERDUE");
  });

  it("removes one reason without removing another and can reopen after correction", () => {
    const events = [
      reason({ eventId: "retention:1", sourceKey: "retention", sourceRevision: 1 }),
      reason({
        eventId: "verification:1",
        sourceKey: "verification",
        sourceRevision: 1,
        reason: "VERIFICATION_NEEDED",
        dueAt: "2024-03-31T12:00:00Z",
      }),
      reason({
        eventId: "verification:2",
        sourceKey: "verification",
        sourceRevision: 2,
        reason: "VERIFICATION_NEEDED",
        dueAt: "2024-03-31T12:00:00Z",
        active: false,
      }),
    ];
    const withoutVerification = calculate(events);
    const reopened = calculate([
      ...events,
      reason({
        eventId: "verification:3",
        sourceKey: "verification",
        sourceRevision: 3,
        reason: "VERIFICATION_NEEDED",
        dueAt: "2024-03-31T12:00:00Z",
      }),
    ]);

    expect(withoutVerification.item?.reasons).toHaveLength(1);
    expect(withoutVerification.item?.reasons[0]?.reason).toBe("RETENTION_RISK");
    expect(reopened.item?.reasons).toHaveLength(2);
    expect(reopened.item?.timing).toBe("OVERDUE");
  });

  it("returns no item when every latest reason revision is inactive", () => {
    const result = calculate([
      reason(),
      reason({
        eventId: "event:closed",
        sourceRevision: 2,
        active: false,
      }),
    ]);

    expect(result.item).toBeNull();
    expect(result.explanationCodes).toEqual(["NO_ACTIVE_REASONS"]);
  });

  it("is invariant to event order and exact delivery replay", () => {
    fc.assert(
      fc.property(fc.boolean(), fc.integer({ min: 1, max: 4 }), (reverse, copies) => {
        const source = reverse
          ? [...fixture.input.reasonEvents].reverse()
          : [...fixture.input.reasonEvents];
        const replayed = [...source];
        for (let index = 0; index < copies; index += 1) {
          const event = source[index % source.length];
          if (event) {
            replayed.push(event);
          }
        }

        expect(
          calculateReviewItem(
            { ...fixture.input, reasonEvents: replayed },
            REVIEW_POLICY_V0_1,
            fixture.clock,
          ),
        ).toEqual(fixture.expected);
      }),
    );
  });

  it("rejects invalid reminder input, foreign subjects, and conflicting revisions", () => {
    expect(() =>
      calculateInitialReviewDueAt(
        {
          reason: "PERSONAL_REMINDER",
          anchorAt: "2024-01-01T00:00:00Z",
          selectedDueAt: null,
          proposedDueAt: null,
          goalDeadlineAt: null,
        },
        REVIEW_POLICY_V0_1,
      ),
    ).toThrow(ReviewInputError);

    expect(() => calculate([reason({ subjectId: "subject:other" })])).toThrow(/another subject/u);

    expect(() =>
      calculate([
        reason({ eventId: "event:one" }),
        reason({ eventId: "event:two", dueAt: "2024-04-03T12:00:00Z" }),
      ]),
    ).toThrow(/conflicting events at revision/u);
  });

  it("keeps an earlier goal proposal and orders tied reasons deterministically", () => {
    expect(
      calculateInitialReviewDueAt(
        {
          reason: "GOAL_DEADLINE",
          anchorAt: "2024-04-01T12:00:00Z",
          selectedDueAt: null,
          proposedDueAt: "2024-04-10T12:00:00Z",
          goalDeadlineAt: "2024-04-20T12:00:00Z",
        },
        REVIEW_POLICY_V0_1,
      ),
    ).toBe("2024-04-10T12:00:00.000Z");

    const tied = calculate([
      reason({
        eventId: "event:z",
        sourceKey: "source:z",
        reason: "RETENTION_RISK",
      }),
      reason({
        eventId: "event:a",
        sourceKey: "source:a",
        reason: "GOAL_DEADLINE",
      }),
    ]);

    expect(tied.item?.reasons.map(({ reason: itemReason }) => itemReason)).toEqual([
      "GOAL_DEADLINE",
      "RETENTION_RISK",
    ]);
  });

  it("rejects invalid intervals, policy tables, event revisions, duplicates, and reason mutation", () => {
    expect(() =>
      scheduleReviewResponse(
        {
          response: "GOOD",
          completedAt: "2024-04-01T12:00:00Z",
          previousIntervalDays: 0,
        },
        REVIEW_POLICY_V0_1,
      ),
    ).toThrow(/must be positive/u);
    expect(() =>
      scheduleReviewResponse(
        {
          response: "GOOD",
          completedAt: "2024-04-01T12:00:00Z",
          previousIntervalDays: 3,
        },
        {
          ...REVIEW_POLICY_V0_1,
          responseRules: {
            ...REVIEW_POLICY_V0_1.responseRules,
            GOOD: {
              ...REVIEW_POLICY_V0_1.responseRules.GOOD,
              multiplier: -1,
            },
          },
        },
      ),
    ).toThrow(/non-negative/u);
    expect(() =>
      calculateInitialReviewDueAt(
        {
          reason: "GOAL_DEADLINE",
          anchorAt: "2024-04-01T12:00:00Z",
          selectedDueAt: null,
          proposedDueAt: null,
          goalDeadlineAt: "2024-04-20T12:00:00Z",
        },
        REVIEW_POLICY_V0_1,
      ),
    ).toThrow(/requires/u);
    expect(() => calculate([reason({ sourceRevision: 0 })])).toThrow(/positive integer/u);
    expect(() =>
      calculate([
        reason({ eventId: "event:duplicate" }),
        reason({ eventId: "event:duplicate", active: false }),
      ]),
    ).toThrow(/conflicting duplicates/u);
    expect(() =>
      calculate([
        reason({ eventId: "event:retention" }),
        reason({
          eventId: "event:goal",
          sourceRevision: 2,
          reason: "GOAL_DEADLINE",
        }),
      ]),
    ).toThrow(/changes reason type/u);
    expect(() => calculate([reason({ dueAt: "2024-99-99T12:00:00Z" })])).toThrow(ReviewInputError);
  });
});
