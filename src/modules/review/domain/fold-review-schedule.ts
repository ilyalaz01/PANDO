import {
  parseInstant,
  toCanonicalInstant,
  type EvaluationClock,
} from "../../../shared/domain/utc-instant";
import { calculateReviewItem } from "./calculate-review-item";
import {
  REVIEW_ACTION_TYPES,
  type EffectiveReviewReason,
  type FoldReviewScheduleInput,
  type ReviewActionEventInput,
  type ReviewReasonSourceEventInput,
  type ReviewScheduleProjection,
} from "./review-schedule-types";
import { ReviewInputError, type ReviewPolicy, type ReviewReasonType } from "./review-types";

const REVIEW_REASONS: readonly ReviewReasonType[] = [
  "RETENTION_RISK",
  "PERSONAL_REMINDER",
  "GOAL_DEADLINE",
  "VERIFICATION_NEEDED",
];
const SOURCE_KINDS = ["MASTERY", "PERSONAL_REMINDER"] as const;

function fail(message: string): never {
  throw new ReviewInputError(message);
}

function identifier(value: string, label: string): void {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 240) {
    fail(`${label} must be a bounded non-empty identifier`);
  }
}

function positiveRevision(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) fail(`${label} must be a positive integer`);
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    fail(`${label} has an unsupported value`);
  }
  return value as T;
}

function instant(value: string, label: string): string {
  try {
    return toCanonicalInstant(parseInstant(value, label));
  } catch (error) {
    fail(String(error));
  }
}

function sourceFingerprint(event: ReviewReasonSourceEventInput): string {
  return [
    event.reasonId,
    event.sourceKey,
    event.sourceRevision,
    event.sourceKind,
    event.subjectId,
    event.reason,
    event.occurrenceId,
    event.baseDueAt,
    event.sourceActive,
  ].join("\u001f");
}

function actionFingerprint(event: ReviewActionEventInput): string {
  return [
    event.actionRevision,
    event.sourceKey,
    event.occurrenceId,
    event.action,
    event.occurredAt,
    event.targetDueAt,
  ].join("\u001f");
}

function validateSources(
  events: readonly ReviewReasonSourceEventInput[],
  subjectId: string,
): readonly ReviewReasonSourceEventInput[] {
  if (!Array.isArray(events)) fail("input.sourceEvents must be an array");
  const byEventId = new Map<string, ReviewReasonSourceEventInput>();

  for (const event of events) {
    identifier(event.eventId, "sourceEvent.eventId");
    identifier(event.reasonId, `sourceEvent ${event.eventId} reasonId`);
    identifier(event.sourceKey, `sourceEvent ${event.eventId} sourceKey`);
    identifier(event.subjectId, `sourceEvent ${event.eventId} subjectId`);
    identifier(event.occurrenceId, `sourceEvent ${event.eventId} occurrenceId`);
    positiveRevision(event.sourceRevision, `sourceEvent ${event.eventId} sourceRevision`);
    oneOf(event.sourceKind, SOURCE_KINDS, `sourceEvent ${event.eventId} sourceKind`);
    oneOf(event.reason, REVIEW_REASONS, `sourceEvent ${event.eventId} reason`);
    if (event.subjectId !== subjectId)
      fail(`sourceEvent ${event.eventId} belongs to another subject`);
    if (typeof event.sourceActive !== "boolean") {
      fail(`sourceEvent ${event.eventId} sourceActive must be boolean`);
    }
    instant(event.baseDueAt, `sourceEvent ${event.eventId} baseDueAt`);

    const existing = byEventId.get(event.eventId);
    if (existing !== undefined) {
      if (sourceFingerprint(existing) !== sourceFingerprint(event)) {
        fail(`source eventId ${event.eventId} has conflicting duplicates`);
      }
      continue;
    }
    byEventId.set(event.eventId, event);
  }

  const byRevision = new Map<string, ReviewReasonSourceEventInput>();
  for (const event of byEventId.values()) {
    const key = `${event.sourceKey}\u001f${event.sourceRevision}`;
    const existing = byRevision.get(key);
    if (existing !== undefined && existing.eventId !== event.eventId) {
      fail(
        `sourceKey ${event.sourceKey} has conflicting events at revision ${event.sourceRevision}`,
      );
    }
    byRevision.set(key, event);
  }
  return [...byEventId.values()];
}

function latestSources(
  events: readonly ReviewReasonSourceEventInput[],
): readonly ReviewReasonSourceEventInput[] {
  const bySource = new Map<string, ReviewReasonSourceEventInput[]>();
  for (const event of events) {
    const group = bySource.get(event.sourceKey) ?? [];
    group.push(event);
    bySource.set(event.sourceKey, group);
  }

  const latest: ReviewReasonSourceEventInput[] = [];
  for (const sourceKey of [...bySource.keys()].sort()) {
    const group = bySource.get(sourceKey)!;
    if (new Set(group.map(({ reasonId }) => reasonId)).size !== 1) {
      fail(`sourceKey ${sourceKey} changes reason identity`);
    }
    if (new Set(group.map(({ reason }) => reason)).size !== 1) {
      fail(`sourceKey ${sourceKey} changes reason type`);
    }
    if (new Set(group.map(({ sourceKind }) => sourceKind)).size !== 1) {
      fail(`sourceKey ${sourceKey} changes source kind`);
    }
    latest.push(
      [...group].sort(
        (left, right) =>
          right.sourceRevision - left.sourceRevision || left.eventId.localeCompare(right.eventId),
      )[0]!,
    );
  }
  return latest;
}

function validateActions(
  events: readonly ReviewActionEventInput[],
  knownSources: ReadonlySet<string>,
): readonly ReviewActionEventInput[] {
  if (!Array.isArray(events)) fail("input.actionEvents must be an array");
  const byActionId = new Map<string, ReviewActionEventInput>();
  const byRevision = new Map<number, ReviewActionEventInput>();
  const skips = new Set<string>();

  for (const event of events) {
    identifier(event.actionId, "actionEvent.actionId");
    identifier(event.sourceKey, `actionEvent ${event.actionId} sourceKey`);
    identifier(event.occurrenceId, `actionEvent ${event.actionId} occurrenceId`);
    positiveRevision(event.actionRevision, `actionEvent ${event.actionId} actionRevision`);
    const action = oneOf(event.action, REVIEW_ACTION_TYPES, `actionEvent ${event.actionId} action`);
    instant(event.occurredAt, `actionEvent ${event.actionId} occurredAt`);
    if (!knownSources.has(event.sourceKey)) {
      fail(`actionEvent ${event.actionId} refers to an unknown source`);
    }
    if (action === "RESCHEDULE" || action === "SKIP_ONCE") {
      if (event.targetDueAt === null) fail(`${action} requires targetDueAt`);
      instant(event.targetDueAt, `actionEvent ${event.actionId} targetDueAt`);
    } else if (event.targetDueAt !== null) {
      fail(`${action} must not contain targetDueAt`);
    }

    const existing = byActionId.get(event.actionId);
    if (existing !== undefined) {
      if (actionFingerprint(existing) !== actionFingerprint(event)) {
        fail(`actionId ${event.actionId} has conflicting duplicates`);
      }
      continue;
    }
    const revision = byRevision.get(event.actionRevision);
    if (revision !== undefined) {
      fail(`action revision ${event.actionRevision} has conflicting events`);
    }
    if (action === "SKIP_ONCE") {
      const skipKey = `${event.sourceKey}\u001f${event.occurrenceId}`;
      if (skips.has(skipKey)) fail(`occurrence ${event.occurrenceId} is skipped more than once`);
      skips.add(skipKey);
    }
    byActionId.set(event.actionId, event);
    byRevision.set(event.actionRevision, event);
  }

  return [...byActionId.values()].sort(
    (left, right) =>
      left.actionRevision - right.actionRevision || left.actionId.localeCompare(right.actionId),
  );
}

function effectiveReason(
  source: ReviewReasonSourceEventInput,
  actions: readonly ReviewActionEventInput[],
): EffectiveReviewReason {
  let dueAt = instant(source.baseDueAt, "source.baseDueAt");
  let suppressed = false;

  for (const action of actions) {
    if (action.sourceKey !== source.sourceKey) continue;
    if (action.action === "SUPPRESS") suppressed = true;
    if (action.action === "RESTORE") suppressed = false;
    if (
      action.occurrenceId === source.occurrenceId &&
      (action.action === "RESCHEDULE" || action.action === "SKIP_ONCE")
    ) {
      dueAt = instant(action.targetDueAt!, `actionEvent ${action.actionId} targetDueAt`);
    }
  }

  return {
    reasonId: source.reasonId,
    sourceKey: source.sourceKey,
    sourceRevision: source.sourceRevision,
    sourceKind: source.sourceKind,
    reason: source.reason,
    occurrenceId: source.occurrenceId,
    baseDueAt: instant(source.baseDueAt, "source.baseDueAt"),
    dueAt,
    sourceActive: source.sourceActive,
    suppressed,
    active: source.sourceActive && !suppressed,
  };
}

export function foldReviewSchedule(
  input: FoldReviewScheduleInput,
  policy: ReviewPolicy,
  clock: EvaluationClock,
): ReviewScheduleProjection {
  identifier(input.workspaceId, "input.workspaceId");
  identifier(input.subjectId, "input.subjectId");
  identifier(input.inputWatermark, "input.inputWatermark");
  const sourceEvents = validateSources(input.sourceEvents, input.subjectId);
  const sources = latestSources(sourceEvents);
  const actions = validateActions(
    input.actionEvents,
    new Set(sources.map(({ sourceKey }) => sourceKey)),
  );
  const reasons = sources
    .map((source) => effectiveReason(source, actions))
    .sort(
      (left, right) =>
        Date.parse(left.dueAt) - Date.parse(right.dueAt) ||
        left.reason.localeCompare(right.reason) ||
        left.sourceKey.localeCompare(right.sourceKey),
    );
  const calculation = calculateReviewItem(
    {
      workspaceId: input.workspaceId,
      subjectId: input.subjectId,
      inputWatermark: input.inputWatermark,
      reasonEvents: reasons.map((reason) => ({
        eventId: `effective:${reason.sourceKey}:${reason.sourceRevision}:${reason.occurrenceId}`,
        sourceKey: reason.sourceKey,
        sourceRevision: reason.sourceRevision,
        subjectId: input.subjectId,
        reason: reason.reason,
        dueAt: reason.dueAt,
        active: reason.active,
      })),
    },
    policy,
    clock,
  );

  return {
    calculation,
    reasons,
    replayedSourceEventIds: [...new Set(sourceEvents.map(({ eventId }) => eventId))].sort(),
    replayedActionIds: [...new Set(actions.map(({ actionId }) => actionId))].sort(),
  };
}
