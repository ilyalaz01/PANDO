import {
  MILLISECONDS_PER_DAY,
  parseInstant,
  toCanonicalInstant,
  type EvaluationClock,
} from "../../../shared/domain/utc-instant";
import {
  REVIEW_ENGINE_VERSION,
  ReviewInputError,
  type CalculateReviewItemInput,
  type InitialReviewDueInput,
  type ReviewCalculation,
  type ReviewPolicy,
  type ReviewReasonEventInput,
  type ReviewReasonSnapshot,
  type ReviewResponse,
  type ScheduleReviewResponseInput,
  type ScheduledReviewResponse,
} from "./review-types";

interface EvaluatedReasonEvent {
  readonly input: ReviewReasonEventInput;
  readonly dueAtMs: number;
}

function fail(message: string): never {
  throw new ReviewInputError(message);
}

function requireIdentifier(value: string, fieldName: string): void {
  if (value.trim().length === 0) {
    fail(`${fieldName} must not be empty`);
  }
}

function parseReviewInstant(value: string, fieldName: string): number {
  try {
    return parseInstant(value, fieldName);
  } catch (error) {
    fail(String(error));
  }
}

function validatePositiveWholeDay(value: number, fieldName: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    fail(`${fieldName} must be a positive whole number of days`);
  }
}

function validatePolicy(policy: ReviewPolicy): void {
  requireIdentifier(policy.version, "policy.version");
  validatePositiveWholeDay(policy.initialVerificationDays, "policy.initialVerificationDays");
  validatePositiveWholeDay(policy.initialRetentionDays, "policy.initialRetentionDays");
  validatePositiveWholeDay(policy.goalDeadlineLeadDays, "policy.goalDeadlineLeadDays");
  validatePositiveWholeDay(
    policy.defaultPreviousIntervalDays,
    "policy.defaultPreviousIntervalDays",
  );
  validatePositiveWholeDay(policy.maximumIntervalDays, "policy.maximumIntervalDays");

  const responses: readonly ReviewResponse[] = ["AGAIN", "HARD", "GOOD", "EASY"];
  for (const response of responses) {
    const rule = policy.responseRules[response];
    validatePositiveWholeDay(rule.minimumDays, `policy.responseRules.${response}.minimumDays`);
    if (rule.fixedDays !== null) {
      validatePositiveWholeDay(rule.fixedDays, `policy.responseRules.${response}.fixedDays`);
    }
    if (!Number.isFinite(rule.multiplier) || rule.multiplier < 0) {
      fail(`policy.responseRules.${response}.multiplier must be finite and non-negative`);
    }
  }
}

export function calculateInitialReviewDueAt(
  input: InitialReviewDueInput,
  policy: ReviewPolicy,
): string {
  validatePolicy(policy);
  const anchorAtMs = parseReviewInstant(input.anchorAt, "input.anchorAt");

  if (input.reason === "VERIFICATION_NEEDED") {
    return toCanonicalInstant(anchorAtMs + policy.initialVerificationDays * MILLISECONDS_PER_DAY);
  }
  if (input.reason === "RETENTION_RISK") {
    return toCanonicalInstant(anchorAtMs + policy.initialRetentionDays * MILLISECONDS_PER_DAY);
  }
  if (input.reason === "PERSONAL_REMINDER") {
    if (input.selectedDueAt === null) {
      fail("PERSONAL_REMINDER requires input.selectedDueAt");
    }
    return toCanonicalInstant(parseReviewInstant(input.selectedDueAt, "input.selectedDueAt"));
  }

  if (input.proposedDueAt === null || input.goalDeadlineAt === null) {
    fail("GOAL_DEADLINE requires input.proposedDueAt and input.goalDeadlineAt");
  }
  const proposedDueAtMs = parseReviewInstant(input.proposedDueAt, "input.proposedDueAt");
  const deadlineAtMs = parseReviewInstant(input.goalDeadlineAt, "input.goalDeadlineAt");
  const latestAllowedAtMs = deadlineAtMs - policy.goalDeadlineLeadDays * MILLISECONDS_PER_DAY;

  return toCanonicalInstant(Math.min(proposedDueAtMs, latestAllowedAtMs));
}

export function scheduleReviewResponse(
  input: ScheduleReviewResponseInput,
  policy: ReviewPolicy,
): ScheduledReviewResponse {
  validatePolicy(policy);
  const completedAtMs = parseReviewInstant(input.completedAt, "input.completedAt");
  const previousIntervalDays = input.previousIntervalDays ?? policy.defaultPreviousIntervalDays;

  if (!Number.isFinite(previousIntervalDays) || previousIntervalDays <= 0) {
    fail("input.previousIntervalDays must be positive when provided");
  }

  const rule = policy.responseRules[input.response];
  const candidate =
    rule.fixedDays ?? Math.max(rule.minimumDays, previousIntervalDays * rule.multiplier);
  const intervalDays = Math.min(policy.maximumIntervalDays, Math.round(candidate));

  return {
    response: input.response,
    intervalDays,
    dueAt: toCanonicalInstant(completedAtMs + intervalDays * MILLISECONDS_PER_DAY),
  };
}

function reasonFingerprint(event: ReviewReasonEventInput): string {
  return [
    event.sourceKey,
    event.sourceRevision,
    event.subjectId,
    event.reason,
    event.dueAt,
    event.active,
  ].join("\u001f");
}

function validateAndDeduplicateEvents(
  events: readonly ReviewReasonEventInput[],
  subjectId: string,
): readonly EvaluatedReasonEvent[] {
  const byEventId = new Map<string, EvaluatedReasonEvent>();

  for (const event of events) {
    requireIdentifier(event.eventId, "reasonEvent.eventId");
    requireIdentifier(event.sourceKey, `reasonEvent ${event.eventId} sourceKey`);
    requireIdentifier(event.subjectId, `reasonEvent ${event.eventId} subjectId`);
    if (event.subjectId !== subjectId) {
      fail(`reasonEvent ${event.eventId} belongs to another subject`);
    }
    if (!Number.isInteger(event.sourceRevision) || event.sourceRevision < 1) {
      fail(`reasonEvent ${event.eventId} sourceRevision must be a positive integer`);
    }

    const dueAtMs = parseReviewInstant(event.dueAt, `reasonEvent ${event.eventId} dueAt`);
    const existing = byEventId.get(event.eventId);
    if (existing) {
      if (reasonFingerprint(existing.input) !== reasonFingerprint(event)) {
        fail(`eventId ${event.eventId} has conflicting duplicates`);
      }
      continue;
    }

    byEventId.set(event.eventId, { input: event, dueAtMs });
  }

  return [...byEventId.values()];
}

function latestReasonsBySource(
  events: readonly EvaluatedReasonEvent[],
): readonly EvaluatedReasonEvent[] {
  const latest = new Map<string, EvaluatedReasonEvent>();

  for (const event of events) {
    const existing = latest.get(event.input.sourceKey);
    if (!existing) {
      latest.set(event.input.sourceKey, event);
      continue;
    }
    if (existing.input.reason !== event.input.reason) {
      fail(`sourceKey ${event.input.sourceKey} changes reason type`);
    }
    if (
      existing.input.sourceRevision === event.input.sourceRevision &&
      existing.input.eventId !== event.input.eventId
    ) {
      fail(
        `sourceKey ${event.input.sourceKey} has conflicting events at revision ${event.input.sourceRevision}`,
      );
    }
    if (event.input.sourceRevision > existing.input.sourceRevision) {
      latest.set(event.input.sourceKey, event);
    }
  }

  return [...latest.values()];
}

export function calculateReviewItem(
  input: CalculateReviewItemInput,
  policy: ReviewPolicy,
  clock: EvaluationClock,
): ReviewCalculation {
  requireIdentifier(input.workspaceId, "input.workspaceId");
  requireIdentifier(input.subjectId, "input.subjectId");
  requireIdentifier(input.inputWatermark, "input.inputWatermark");
  validatePolicy(policy);

  const asOfMs = parseReviewInstant(clock.asOf, "clock.asOf");
  const events = validateAndDeduplicateEvents(input.reasonEvents, input.subjectId);
  const activeReasons: ReviewReasonSnapshot[] = latestReasonsBySource(events)
    .filter(({ input: event }) => event.active)
    .sort(
      (left, right) =>
        left.dueAtMs - right.dueAtMs ||
        left.input.reason.localeCompare(right.input.reason) ||
        left.input.sourceKey.localeCompare(right.input.sourceKey),
    )
    .map(({ input: event, dueAtMs }) => ({
      sourceKey: event.sourceKey,
      sourceRevision: event.sourceRevision,
      sourceEventId: event.eventId,
      reason: event.reason,
      dueAt: toCanonicalInstant(dueAtMs),
    }));
  const replayedEventIds = [...new Set(events.map(({ input: event }) => event.eventId))].sort();

  if (activeReasons.length === 0) {
    return {
      engineVersion: REVIEW_ENGINE_VERSION,
      policyVersion: policy.version,
      inputWatermark: input.inputWatermark,
      calculatedAsOf: toCanonicalInstant(asOfMs),
      item: null,
      replayedEventIds,
      explanationCodes: ["NO_ACTIVE_REASONS"],
    };
  }

  const effectiveDueAt = activeReasons[0]!.dueAt;
  const effectiveDueAtMs = parseReviewInstant(effectiveDueAt, "effectiveDueAt");
  const timing =
    effectiveDueAtMs < asOfMs ? "OVERDUE" : effectiveDueAtMs === asOfMs ? "DUE" : "UPCOMING";

  return {
    engineVersion: REVIEW_ENGINE_VERSION,
    policyVersion: policy.version,
    inputWatermark: input.inputWatermark,
    calculatedAsOf: toCanonicalInstant(asOfMs),
    item: {
      workspaceId: input.workspaceId,
      subjectId: input.subjectId,
      effectiveDueAt,
      timing,
      reasons: activeReasons,
    },
    replayedEventIds,
    explanationCodes: [
      "ONE_ITEM_PER_SUBJECT",
      "EARLIEST_ACTIVE_REASON_WINS",
      "SOURCE_REVISIONS_DEDUPLICATED",
    ],
  };
}
