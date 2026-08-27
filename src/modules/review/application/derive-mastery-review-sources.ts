import { calculateInitialReviewDueAt } from "../domain/calculate-review-item";
import { REVIEW_POLICY_V0_1 } from "../domain/review-policy-v0.1";
import type {
  ReviewReasonSourceEventInput,
  ReviewReasonSourceKind,
} from "../domain/review-schedule-types";
import type { ReviewReasonType } from "../domain/review-types";

export type ReviewMasteryAchievementLevel = "NOT_STARTED" | "COMPLETED" | "VERIFIED" | "MASTERED";

export interface MasteryReviewSignal {
  readonly achievementLevel: ReviewMasteryAchievementLevel;
  readonly latestQualifyingSuccessAt: string | null;
  readonly latestSupportingEvidenceId: string | null;
}

export interface MasteryReviewReasonIdentity {
  readonly reasonId: string;
  readonly sourceKey: string;
  readonly reason: "RETENTION_RISK" | "VERIFICATION_NEEDED";
}

export interface DeriveMasteryReviewSourcesInput {
  readonly subjectId: string;
  readonly signal: MasteryReviewSignal;
  readonly identities: readonly MasteryReviewReasonIdentity[];
  readonly sourceEvents: readonly ReviewReasonSourceEventInput[];
  readonly createEventId: (identity: MasteryReviewReasonIdentity, sourceRevision: number) => string;
}

const MASTERY_SOURCE_KIND: ReviewReasonSourceKind = "MASTERY";

function latestBySource(
  sourceEvents: readonly ReviewReasonSourceEventInput[],
): ReadonlyMap<string, ReviewReasonSourceEventInput> {
  const latest = new Map<string, ReviewReasonSourceEventInput>();
  for (const event of sourceEvents) {
    const current = latest.get(event.sourceKey);
    if (
      current === undefined ||
      event.sourceRevision > current.sourceRevision ||
      (event.sourceRevision === current.sourceRevision && event.eventId < current.eventId)
    ) {
      latest.set(event.sourceKey, event);
    }
  }
  return latest;
}

function activeFor(reason: ReviewReasonType, level: ReviewMasteryAchievementLevel): boolean {
  if (reason === "RETENTION_RISK") return level !== "NOT_STARTED";
  return level === "COMPLETED";
}

function sameSourceState(
  event: ReviewReasonSourceEventInput,
  occurrenceId: string,
  baseDueAt: string,
  sourceActive: boolean,
): boolean {
  return (
    event.occurrenceId === occurrenceId &&
    event.baseDueAt === baseDueAt &&
    event.sourceActive === sourceActive
  );
}

export function deriveMasteryReviewSources(
  input: DeriveMasteryReviewSourcesInput,
): readonly ReviewReasonSourceEventInput[] {
  const existing = latestBySource(input.sourceEvents);
  const anchorAt = input.signal.latestQualifyingSuccessAt;
  const occurrenceId = input.signal.latestSupportingEvidenceId;
  const changes: ReviewReasonSourceEventInput[] = [];

  for (const identity of [...input.identities].sort((left, right) =>
    left.sourceKey.localeCompare(right.sourceKey),
  )) {
    const previous = existing.get(identity.sourceKey);
    const sourceActive = activeFor(identity.reason, input.signal.achievementLevel);

    if (anchorAt === null || occurrenceId === null) {
      if (previous === undefined || previous.sourceActive === false) continue;
      const sourceRevision = previous.sourceRevision + 1;
      changes.push({
        ...previous,
        eventId: input.createEventId(identity, sourceRevision),
        sourceRevision,
        sourceActive: false,
      });
      continue;
    }

    const baseDueAt = calculateInitialReviewDueAt(
      {
        reason: identity.reason,
        anchorAt,
        selectedDueAt: null,
        proposedDueAt: null,
        goalDeadlineAt: null,
      },
      REVIEW_POLICY_V0_1,
    );
    if (
      previous !== undefined &&
      sameSourceState(previous, occurrenceId, baseDueAt, sourceActive)
    ) {
      continue;
    }

    const sourceRevision = (previous?.sourceRevision ?? 0) + 1;
    changes.push({
      eventId: input.createEventId(identity, sourceRevision),
      reasonId: previous?.reasonId ?? identity.reasonId,
      sourceKey: identity.sourceKey,
      sourceRevision,
      sourceKind: MASTERY_SOURCE_KIND,
      subjectId: input.subjectId,
      reason: identity.reason,
      occurrenceId,
      baseDueAt,
      sourceActive,
    });
  }

  return changes;
}
