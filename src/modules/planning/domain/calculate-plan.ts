import { parseInstant, toCanonicalInstant } from "../../../shared/domain/utc-instant";
import {
  PLANNER_ENGINE_VERSION,
  PlanningInputError,
  type CalculatePlanInput,
  type EnergyMode,
  type ExpectedBenefitCode,
  type PlanScoreFactor,
  type PlanScoreFactorCode,
  type PlanReasonRef,
  type PlanSnapshot,
  type PlannedAction,
  type PlanningCandidateInput,
  type PlanningPolicy,
  type PlanningReadinessInput,
  type PlanningSourceSignal,
  type PlanningTrackInput,
  type ReadinessGapInput,
  type ReadinessGapCode,
  type VerifiedCalculatePlanInput,
} from "./planning-types";

const ENERGY_VALUES = ["LOW", "MEDIUM", "HIGH"] as const;
const CONFIDENCE_VALUES = ["LOW", "MEDIUM", "HIGH"] as const;
const SOURCE_VALUES = ["GROWTH_PLAN", "CAMPAIGN", "REVIEW"] as const;
const PREREQUISITE_VALUES = ["SATISFIED", "UNKNOWN", "BLOCKED"] as const;
const GAP_VALUES = [
  "FAILED_MANDATORY_FLOOR",
  "UNKNOWN_MANDATORY_FLOOR",
  "UNKNOWN_REQUIREMENT",
  "KNOWN_SHORTFALL",
] as const;
const DIMENSION_VALUES = ["KNOWLEDGE", "RECALL", "APPLICATION", "INTERVIEW_EXECUTION"] as const;

interface ScoredCandidate {
  readonly candidate: PlanningCandidateInput;
  readonly factors: readonly PlanScoreFactor[];
  readonly strongestGap: ReadinessGapInput | null;
  readonly effectiveTrack: PlanningTrackInput | null;
  readonly score: number;
}

function fail(message: string): never {
  throw new PlanningInputError(message);
}

function requireIdentifier(value: unknown, fieldName: string): asserts value is string {
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    value.length === 0 ||
    value.length > 200
  ) {
    fail(`${fieldName} must contain 1 to 200 trimmed characters`);
  }
}

function requireInteger(value: unknown, minimum: number, maximum: number, fieldName: string): void {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    fail(`${fieldName} must be an integer between ${minimum} and ${maximum}`);
  }
}

function requireEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fieldName: string,
): asserts value is T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    fail(`${fieldName} has an unsupported value`);
  }
}

function parsePlanningInstant(value: string, fieldName: string): number {
  try {
    return parseInstant(value, fieldName);
  } catch (error) {
    fail(String(error));
  }
}

function requireUnique(values: readonly string[], fieldName: string): void {
  if (new Set(values).size !== values.length) {
    fail(`${fieldName} must not contain duplicates`);
  }
}

function compareCodePoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function validatePolicy(policy: PlanningPolicy): void {
  requireIdentifier(policy.version, "policy.version");
  requireInteger(policy.maximumActions, 1, 5, "policy.maximumActions");
  const pointValues = [
    policy.failedMandatoryFloorPoints,
    policy.unknownMandatoryFloorPoints,
    policy.knownShortfallPoints,
    policy.unknownRequirementPoints,
    policy.overdueReviewPoints,
    policy.dueTodayReviewPoints,
    policy.protectedMinimumDeficitPoints,
    policy.campaignSourcePoints,
    policy.campaignDeadlinePoints.within7Days,
    policy.campaignDeadlinePoints.within21Days,
    policy.campaignDeadlinePoints.within42Days,
    policy.unlockPointsPerCompetency,
    policy.maximumUnlockPoints,
    policy.exactEnergyFitPoints,
    policy.lowerEnergyFitPoints,
    policy.unknownPrerequisitePenalty,
    policy.higherEnergyPenalty,
    policy.repetitionPenaltyEach,
    policy.maximumRepetitionPenalty,
    policy.activeFocusResumePoints,
  ];
  for (const [index, value] of pointValues.entries()) {
    requireInteger(value, 0, 100_000, `policy point value ${index}`);
  }
  if (
    policy.campaignDeadlinePoints.within7Days < policy.campaignDeadlinePoints.within21Days ||
    policy.campaignDeadlinePoints.within21Days < policy.campaignDeadlinePoints.within42Days
  ) {
    fail("campaign deadline points must not increase as the deadline moves farther away");
  }
}

function validateTrack(track: PlanningTrackInput): void {
  requireIdentifier(track.trackId, "track.trackId");
  requireIdentifier(track.trackKey, "track.trackKey");
  requireIdentifier(track.title, "track.title");
  requireIdentifier(track.version, "track.version");
  requireIdentifier(track.readinessGoalKey, "track.readinessGoalKey");
  requireIdentifier(track.targetProfileVersionKey, "track.targetProfileVersionKey");
  requireEnum(track.lifecycle, ["ACTIVE", "PAUSED", "COMPLETED"] as const, "track.lifecycle");
  requireInteger(track.priority, 0, 100, "track.priority");
  requireInteger(track.protectedMinimumMinutes, 0, 10_080, "track.protectedMinimumMinutes");
  requireInteger(track.meaningfulMinutesThisWeek, 0, 10_000_000, "track.meaningfulMinutesThisWeek");
  requireInteger(track.defaultSessionMinutes, 1, 480, "track.defaultSessionMinutes");
}

function validateReadiness(readiness: PlanningReadinessInput, asOfMs: number): void {
  requireIdentifier(readiness.readinessGoalKey, "readiness.readinessGoalKey");
  requireIdentifier(readiness.targetProfileVersionKey, "readiness.targetProfileVersionKey");
  if (readiness.availability === "UNAVAILABLE") {
    requireEnum(
      readiness.reason,
      ["GOAL_INACTIVE", "NOT_MATERIALIZED", "REBUILDING", "STALE", "ERROR"] as const,
      "readiness.reason",
    );
    if (
      readiness.calculatedAsOf !== null ||
      readiness.validUntil !== null ||
      readiness.status !== null ||
      readiness.snapshotId !== null ||
      readiness.inputFingerprint !== null ||
      readiness.coverage !== null ||
      readiness.confidence !== null ||
      readiness.blockers.length !== 0 ||
      readiness.gaps.length !== 0
    ) {
      fail("unavailable readiness must not carry a snapshot");
    }
    return;
  }

  if (readiness.reason !== null) fail("current readiness must not carry an unavailable reason");
  requireIdentifier(readiness.snapshotId, "readiness.snapshotId");
  if (!/^readiness-input:[a-f0-9]{64}$/u.test(readiness.inputFingerprint)) {
    fail("readiness.inputFingerprint must be a canonical SHA-256 fingerprint");
  }
  requireEnum(
    readiness.status,
    ["NOT_READY", "INSUFFICIENT_EVIDENCE", "READY", "DEVELOPING"] as const,
    "readiness.status",
  );
  const calculatedMs = parsePlanningInstant(readiness.calculatedAsOf, "readiness.calculatedAsOf");
  if (calculatedMs > asOfMs) fail("readiness cannot be calculated after clock.asOf");
  if (readiness.validUntil !== null) {
    const validUntilMs = parsePlanningInstant(readiness.validUntil, "readiness.validUntil");
    if (validUntilMs < asOfMs) fail("Planning cannot consume expired readiness");
  }
  if (typeof readiness.coverage !== "number" || readiness.coverage < 0 || readiness.coverage > 1) {
    fail("readiness.coverage must be between zero and one");
  }
  requireEnum(readiness.confidence, CONFIDENCE_VALUES, "readiness.confidence");
  if (readiness.blockers.length > 100) fail("readiness.blockers exceeds 100");
  if (readiness.gaps.length > 250) fail("readiness.gaps exceeds 250");
  requireUnique(
    readiness.blockers.map(({ code, ruleKey }) => `${code}\u001f${ruleKey}`),
    "readiness.blockers",
  );
  requireUnique(
    readiness.gaps.map(
      ({ gapCode, competencyRef, dimension }) =>
        `${gapCode}\u001f${competencyRef}\u001f${dimension}`,
    ),
    "readiness.gaps",
  );
  for (const blocker of readiness.blockers) {
    requireIdentifier(blocker.code, "readiness.blocker.code");
    requireIdentifier(blocker.ruleKey, "readiness.blocker.ruleKey");
  }
  for (const gap of readiness.gaps) {
    requireEnum(gap.gapCode, GAP_VALUES, "readiness.gap.gapCode");
    requireIdentifier(gap.competencyRef, "readiness.gap.competencyRef");
    requireEnum(gap.dimension, DIMENSION_VALUES, "readiness.gap.dimension");
  }
}

function validateCandidate(
  candidate: PlanningCandidateInput,
  trackById: ReadonlyMap<string, PlanningTrackInput>,
  input: CalculatePlanInput,
  asOfMs: number,
  validUntilMs: number,
): void {
  requireIdentifier(candidate.candidateKey, "candidate.candidateKey");
  requireIdentifier(candidate.readinessGoalKey, "candidate.readinessGoalKey");
  requireIdentifier(candidate.targetProfileVersionKey, "candidate.targetProfileVersionKey");
  requireIdentifier(candidate.activityKey, "candidate.activityKey");
  requireIdentifier(candidate.title, "candidate.title");
  requireInteger(candidate.estimatedMinutes, 1, 480, "candidate.estimatedMinutes");
  if (candidate.energy !== null) requireEnum(candidate.energy, ENERGY_VALUES, "candidate.energy");
  requireEnum(
    candidate.durationSource,
    ["PLANNING_ACTIVITY", "REVIEW_POLICY"] as const,
    "candidate.durationSource",
  );
  requireEnum(candidate.prerequisiteState, PREREQUISITE_VALUES, "candidate.prerequisiteState");
  requireInteger(candidate.unlockCount, 0, 20, "candidate.unlockCount");
  requireInteger(candidate.repetitionsInLast7Days, 0, 50, "candidate.repetitionsInLast7Days");
  if (candidate.repetitionWindowEndsAt === null) {
    if (candidate.repetitionsInLast7Days !== 0) {
      fail("a counted repetition requires an explicit repetition window cutoff");
    }
  } else {
    if (candidate.repetitionsInLast7Days === 0) {
      fail("an uncounted candidate must not declare a repetition window cutoff");
    }
    const windowEndsMs = parsePlanningInstant(
      candidate.repetitionWindowEndsAt,
      "candidate.repetitionWindowEndsAt",
    );
    if (windowEndsMs <= asOfMs) fail("a counted repetition window cannot end before clock.asOf");
    if (validUntilMs >= windowEndsMs) {
      fail("evaluation validity cannot reach the next repetition window transition");
    }
  }
  if (candidate.sourceSignals.length < 1 || candidate.sourceSignals.length > 3) {
    fail("candidate.sourceSignals must contain 1 to 3 values");
  }
  requireUnique(candidate.sourceSignals, "candidate.sourceSignals");
  for (const source of candidate.sourceSignals) {
    requireEnum(source, SOURCE_VALUES, "candidate.sourceSignals");
  }
  const hasGrowthSource = candidate.sourceSignals.includes("GROWTH_PLAN");
  if (hasGrowthSource !== (candidate.trackId !== null)) {
    fail("a Growth Plan candidate must reference exactly one track");
  }
  if (candidate.trackId !== null) {
    requireIdentifier(candidate.trackId, "candidate.trackId");
    const track = trackById.get(candidate.trackId);
    if (!track) fail(`candidate references unknown track ${candidate.trackId}`);
    if (
      track.readinessGoalKey !== candidate.readinessGoalKey ||
      track.targetProfileVersionKey !== candidate.targetProfileVersionKey
    ) {
      fail("candidate goal/profile must match its exact track");
    }
  }
  if (candidate.competencyImpacts.length < 1 || candidate.competencyImpacts.length > 20) {
    fail("candidate.competencyImpacts must contain 1 to 20 values");
  }
  requireUnique(
    candidate.competencyImpacts.map(
      ({ competencyRef, dimension }) => `${competencyRef}\u001f${dimension}`,
    ),
    "candidate.competencyImpacts",
  );
  for (const impact of candidate.competencyImpacts) {
    requireIdentifier(impact.competencyRef, "candidate.competencyImpact.competencyRef");
    requireEnum(impact.dimension, DIMENSION_VALUES, "candidate.competencyImpact.dimension");
  }
  const hasReviewSource = candidate.sourceSignals.includes("REVIEW");
  if (hasReviewSource !== (candidate.review !== null)) {
    fail("candidate REVIEW source and review signal must appear together");
  }
  if (candidate.durationSource === "REVIEW_POLICY" && !hasReviewSource) {
    fail("REVIEW_POLICY duration requires a Review source");
  }
  if (candidate.durationSource === "PLANNING_ACTIVITY" && !hasGrowthSource) {
    fail("PLANNING_ACTIVITY duration requires one exact Growth Plan track");
  }
  if (candidate.durationSource === "REVIEW_POLICY" && hasGrowthSource) {
    fail("a tracked Growth Plan candidate requires PLANNING_ACTIVITY duration");
  }
  if (candidate.energy !== null && !hasGrowthSource) {
    fail("candidate energy requires one exact Planning activity track");
  }
  if (candidate.review) {
    requireIdentifier(candidate.review.reviewItemId, "candidate.review.reviewItemId");
    requireEnum(
      candidate.review.bucket,
      ["OVERDUE", "DUE_TODAY"] as const,
      "candidate.review.bucket",
    );
    const dueAtMs = parsePlanningInstant(candidate.review.dueAt, "candidate.review.dueAt");
    if (candidate.review.bucket === "OVERDUE" && dueAtMs >= asOfMs) {
      fail("an overdue Review must be due before clock.asOf");
    }
    if (candidate.review.bucket === "DUE_TODAY" && dueAtMs < asOfMs) {
      fail("a due-today Review cannot be due before clock.asOf");
    }
    if (candidate.review.bucket === "DUE_TODAY" && validUntilMs > dueAtMs) {
      fail("evaluation validity cannot exceed a due-today Review transition");
    }
    if (input.reviewSummary.projectionState !== "CURRENT") {
      fail("a non-current Review projection cannot contribute recommendation candidates");
    }
  }
  if (candidate.sourceSignals.includes("CAMPAIGN")) {
    if (
      !input.campaign ||
      input.campaign.readinessGoalKey !== candidate.readinessGoalKey ||
      input.campaign.targetProfileVersionKey !== candidate.targetProfileVersionKey
    ) {
      fail("a campaign candidate must match the active campaign goal/profile");
    }
    if (!hasGrowthSource) fail("a campaign candidate must overlay one exact Growth Plan track");
  }
}

function validateInput(input: CalculatePlanInput, policy: PlanningPolicy) {
  validatePolicy(policy);
  if (!/^planning-input:[a-f0-9]{64}$/u.test(input.inputFingerprint)) {
    fail("input.inputFingerprint must be a canonical SHA-256 fingerprint");
  }
  if (
    !/^planning-completed-work\/[0-9]{1,3}\.[0-9]{1,3}$/u.test(input.completedWorkPolicyVersion)
  ) {
    fail("input.completedWorkPolicyVersion must name a versioned completed-work policy");
  }
  const asOfMs = parsePlanningInstant(input.evaluationHorizon.asOf, "evaluationHorizon.asOf");
  const validUntilMs = parsePlanningInstant(
    input.evaluationHorizon.validUntil,
    "evaluationHorizon.validUntil",
  );
  const weekStartMs = parsePlanningInstant(
    input.evaluationHorizon.weekStart,
    "evaluationHorizon.weekStart",
  );
  const weekEndMs = parsePlanningInstant(
    input.evaluationHorizon.weekEnd,
    "evaluationHorizon.weekEnd",
  );
  requireIdentifier(input.evaluationHorizon.timeZone, "evaluationHorizon.timeZone");
  if (validUntilMs < asOfMs) fail("evaluation horizon must not expire before asOf");
  if (weekStartMs > asOfMs || weekEndMs <= asOfMs || weekStartMs >= weekEndMs) {
    fail("evaluation clock must fall inside its half-open week horizon");
  }
  if (validUntilMs >= weekEndMs) {
    fail("evaluation validity must end before the exclusive week boundary");
  }
  if (input.sourceRevisions.length > 100) fail("input.sourceRevisions exceeds 100");
  const revisionKeys = input.sourceRevisions.map(({ owner, key, revision }) => {
    requireEnum(
      owner,
      ["CATALOG", "EVIDENCE", "FOCUS", "MASTERY", "OVERLAY", "REVIEW"] as const,
      "sourceRevision.owner",
    );
    requireIdentifier(key, "sourceRevision.key");
    requireIdentifier(revision, "sourceRevision.revision");
    return `${owner}\u001f${key}`;
  });
  requireUnique(revisionKeys, "sourceRevisions");
  if (
    !revisionKeys.every(
      (value, index) => index === 0 || compareCodePoints(revisionKeys[index - 1]!, value) < 0,
    )
  ) {
    fail("sourceRevisions must be in canonical code-point order");
  }
  const revisionOwners = new Set(input.sourceRevisions.map(({ owner }) => owner));
  if (
    !revisionOwners.has("EVIDENCE") ||
    !revisionOwners.has("FOCUS") ||
    !revisionOwners.has("REVIEW")
  ) {
    fail("sourceRevisions must identify Evidence, Focus, and Review state");
  }
  if (
    input.candidates.length > 0 &&
    (!revisionOwners.has("CATALOG") ||
      !revisionOwners.has("MASTERY") ||
      !revisionOwners.has("OVERLAY"))
  ) {
    fail("candidate input must identify Catalog, Mastery, and Overlay revisions");
  }

  if (input.sessionLimitMinutes !== null) {
    requireInteger(input.sessionLimitMinutes, 0, 1_440, "input.sessionLimitMinutes");
  }
  if (input.energyPreference !== null) {
    requireEnum(input.energyPreference, ENERGY_VALUES, "input.energyPreference");
  }
  requireEnum(
    input.reviewSummary.projectionState,
    ["CURRENT", "PENDING", "NOT_STARTED"] as const,
    "reviewSummary.projectionState",
  );
  requireInteger(input.reviewSummary.overdueCount, 0, 100, "reviewSummary.overdueCount");
  requireInteger(input.reviewSummary.dueTodayCount, 0, 100, "reviewSummary.dueTodayCount");
  if (input.reviewSummary.overdueCount + input.reviewSummary.dueTodayCount > 100) {
    fail("reviewSummary exceeds the 100-item input bound");
  }
  if (input.reviewSummary.validUntil === null) {
    if (
      input.reviewSummary.projectionState === "CURRENT" &&
      input.reviewSummary.dueTodayCount > 0
    ) {
      fail("a current due-today Review summary requires an owner validity cutoff");
    }
  } else {
    if (input.reviewSummary.projectionState !== "CURRENT") {
      fail("a non-current Review summary cannot declare current validity");
    }
    const reviewValidUntilMs = parsePlanningInstant(
      input.reviewSummary.validUntil,
      "reviewSummary.validUntil",
    );
    if (reviewValidUntilMs < asOfMs) fail("Review summary validity cannot precede clock.asOf");
    if (validUntilMs > reviewValidUntilMs) {
      fail("evaluation validity cannot exceed Review summary validity");
    }
  }

  const trackById = new Map<string, PlanningTrackInput>();
  if (input.growthPlan) {
    requireIdentifier(input.growthPlan.growthPlanId, "growthPlan.growthPlanId");
    requireIdentifier(input.growthPlan.version, "growthPlan.version");
    requireEnum(input.growthPlan.lifecycle, ["ACTIVE", "PAUSED"] as const, "growthPlan.lifecycle");
    requireInteger(
      input.growthPlan.weeklyCapacityMinutes,
      0,
      10_080,
      "growthPlan.weeklyCapacityMinutes",
    );
    requireInteger(
      input.growthPlan.consumedMinutesThisWeek,
      0,
      10_000_000,
      "growthPlan.consumedMinutesThisWeek",
    );
    if (input.growthPlan.tracks.length < 1 || input.growthPlan.tracks.length > 30) {
      fail("growthPlan.tracks must contain 1 to 30 values");
    }
    for (const track of input.growthPlan.tracks) {
      validateTrack(track);
      if (trackById.has(track.trackId)) fail(`duplicate trackId ${track.trackId}`);
      trackById.set(track.trackId, track);
    }
    const protectedTotal = input.growthPlan.tracks
      .filter(({ lifecycle }) => lifecycle === "ACTIVE")
      .reduce((total, track) => total + track.protectedMinimumMinutes, 0);
    if (protectedTotal > input.growthPlan.weeklyCapacityMinutes) {
      fail("active protected track minimums exceed weekly capacity");
    }
  }

  if (input.campaign) {
    requireIdentifier(input.campaign.campaignId, "campaign.campaignId");
    requireIdentifier(input.campaign.version, "campaign.version");
    requireIdentifier(input.campaign.title, "campaign.title");
    requireIdentifier(input.campaign.readinessGoalKey, "campaign.readinessGoalKey");
    requireIdentifier(input.campaign.targetProfileVersionKey, "campaign.targetProfileVersionKey");
    const deadlineMs = parsePlanningInstant(input.campaign.deadlineAt, "campaign.deadlineAt");
    if (deadlineMs < asOfMs) fail("active campaign deadline cannot precede evaluation asOf");
    const daysUntilDeadline = Math.ceil((deadlineMs - asOfMs) / 86_400_000);
    if (daysUntilDeadline > 36_500) fail("active Campaign deadline cannot exceed 36,500 days");
    const nextDayCountChangeAt = deadlineMs - Math.max(0, daysUntilDeadline - 1) * 86_400_000;
    const campaignValidUntilMs =
      deadlineMs === asOfMs ? deadlineMs : Math.min(deadlineMs, nextDayCountChangeAt - 1);
    if (validUntilMs > campaignValidUntilMs) {
      fail("evaluation validity cannot exceed the next Campaign clock transition");
    }
    if (!input.growthPlan || input.growthPlan.lifecycle !== "ACTIVE") {
      fail("a campaign must overlay an active Growth Plan");
    }
  }

  if (input.readiness.length > 30) fail("input.readiness exceeds 30");
  const readinessByGoal = new Map<string, PlanningReadinessInput>();
  for (const readiness of input.readiness) {
    validateReadiness(readiness, asOfMs);
    if (
      readiness.availability === "CURRENT" &&
      readiness.validUntil !== null &&
      validUntilMs > parsePlanningInstant(readiness.validUntil, "readiness.validUntil")
    ) {
      fail("evaluation validity cannot exceed current readiness validity");
    }
    if (readinessByGoal.has(readiness.readinessGoalKey)) {
      fail(`duplicate readiness goal ${readiness.readinessGoalKey}`);
    }
    readinessByGoal.set(readiness.readinessGoalKey, readiness);
  }
  const readinessKeys = input.readiness.map(({ readinessGoalKey }) => readinessGoalKey);
  if (
    !readinessKeys.every(
      (value, index) => index === 0 || compareCodePoints(readinessKeys[index - 1]!, value) < 0,
    )
  ) {
    fail("readiness inputs must be in canonical goal-key order");
  }
  for (const track of trackById.values()) {
    const readiness = readinessByGoal.get(track.readinessGoalKey);
    if (!readiness || readiness.targetProfileVersionKey !== track.targetProfileVersionKey) {
      fail("every track must reference one exact readiness goal/profile input");
    }
  }
  if (input.campaign) {
    const readiness = readinessByGoal.get(input.campaign.readinessGoalKey);
    if (
      !readiness ||
      readiness.targetProfileVersionKey !== input.campaign.targetProfileVersionKey
    ) {
      fail("campaign must reference one exact readiness goal/profile input");
    }
  }

  if (input.activeFocus) {
    requireIdentifier(input.activeFocus.focusSessionId, "activeFocus.focusSessionId");
    requireIdentifier(input.activeFocus.readinessGoalKey, "activeFocus.readinessGoalKey");
    requireIdentifier(input.activeFocus.activityKey, "activeFocus.activityKey");
    requireIdentifier(input.activeFocus.title, "activeFocus.title");
    requireInteger(input.activeFocus.plannedMinutes, 1, 480, "activeFocus.plannedMinutes");
    const startedAtMs = parsePlanningInstant(input.activeFocus.startedAt, "activeFocus.startedAt");
    if (startedAtMs > asOfMs) fail("active Focus cannot start after clock.asOf");
    if (input.activeFocus.planAttribution) {
      requireIdentifier(
        input.activeFocus.planAttribution.planSnapshotId,
        "activeFocus.planAttribution.planSnapshotId",
      );
      requireIdentifier(
        input.activeFocus.planAttribution.candidateKey,
        "activeFocus.planAttribution.candidateKey",
      );
      if (input.activeFocus.planAttribution.trackId !== null) {
        requireIdentifier(
          input.activeFocus.planAttribution.trackId,
          "activeFocus.planAttribution.trackId",
        );
      }
    }
  }

  if (!input.growthPlan && !input.campaign) {
    if (input.readiness.length !== 0 || input.candidates.length !== 0) {
      fail("a no-plan input must not carry readiness or recommendation candidates");
    }
  }

  if (input.candidates.length > 200) fail("input.candidates exceeds 200");
  const candidateKeys = new Set<string>();
  const focusPairs = new Set<string>();
  const reviewItemIds: string[] = [];
  let overdueReviewCandidateCount = 0;
  let dueTodayReviewCandidateCount = 0;
  for (const candidate of input.candidates) {
    validateCandidate(candidate, trackById, input, asOfMs, validUntilMs);
    const readiness = readinessByGoal.get(candidate.readinessGoalKey);
    if (!readiness || readiness.targetProfileVersionKey !== candidate.targetProfileVersionKey) {
      fail("candidate must reference one exact readiness goal/profile input");
    }
    if (candidateKeys.has(candidate.candidateKey)) {
      fail(`duplicate candidateKey ${candidate.candidateKey}`);
    }
    candidateKeys.add(candidate.candidateKey);
    const pair = `${candidate.readinessGoalKey}\u001f${candidate.activityKey}`;
    if (focusPairs.has(pair)) fail(`duplicate Focus candidate pair ${pair}`);
    focusPairs.add(pair);
    if (candidate.review) {
      reviewItemIds.push(candidate.review.reviewItemId);
      if (candidate.review.bucket === "OVERDUE") overdueReviewCandidateCount += 1;
      else dueTodayReviewCandidateCount += 1;
    }
  }
  if (reviewItemIds.length > 100) fail("input Review candidates exceed 100");
  requireUnique(reviewItemIds, "candidate Review item references");
  if (
    overdueReviewCandidateCount > input.reviewSummary.overdueCount ||
    dueTodayReviewCandidateCount > input.reviewSummary.dueTodayCount
  ) {
    fail("Review candidate buckets cannot exceed the current Review summary");
  }

  return { asOfMs, validUntilMs, weekStartMs, weekEndMs, trackById, readinessByGoal };
}

function gapPoints(code: ReadinessGapCode, policy: PlanningPolicy): number {
  switch (code) {
    case "FAILED_MANDATORY_FLOOR":
      return policy.failedMandatoryFloorPoints;
    case "UNKNOWN_MANDATORY_FLOOR":
      return policy.unknownMandatoryFloorPoints;
    case "KNOWN_SHORTFALL":
      return policy.knownShortfallPoints;
    case "UNKNOWN_REQUIREMENT":
      return policy.unknownRequirementPoints;
  }
}

function gapFactor(code: ReadinessGapCode): PlanScoreFactorCode {
  switch (code) {
    case "FAILED_MANDATORY_FLOOR":
      return "TARGET_FAILED_MANDATORY_FLOOR";
    case "UNKNOWN_MANDATORY_FLOOR":
      return "TARGET_UNKNOWN_MANDATORY_FLOOR";
    case "KNOWN_SHORTFALL":
      return "TARGET_KNOWN_SHORTFALL";
    case "UNKNOWN_REQUIREMENT":
      return "TARGET_UNKNOWN_REQUIREMENT";
  }
}

function energyRank(value: EnergyMode): number {
  return ENERGY_VALUES.indexOf(value);
}

function factor(code: PlanScoreFactorCode, points: number): PlanScoreFactor | null {
  return points === 0 ? null : { code, points };
}

function strongestGap(
  candidate: PlanningCandidateInput,
  readiness: PlanningReadinessInput | undefined,
  policy: PlanningPolicy,
): { readonly factor: PlanScoreFactor; readonly gap: ReadinessGapInput } | null {
  if (
    !readiness ||
    readiness.availability !== "CURRENT" ||
    readiness.readinessGoalKey !== candidate.readinessGoalKey
  ) {
    return null;
  }
  const impacts = new Set(
    candidate.competencyImpacts.map(
      ({ competencyRef, dimension }) => `${competencyRef}\u001f${dimension}`,
    ),
  );
  const matches = readiness.gaps
    .filter(({ competencyRef, dimension }) => impacts.has(`${competencyRef}\u001f${dimension}`))
    .flatMap((gap) => {
      const scored = factor(gapFactor(gap.gapCode), gapPoints(gap.gapCode, policy));
      return scored ? [{ gap, factor: scored }] : [];
    })
    .sort(
      (left, right) =>
        right.factor.points - left.factor.points ||
        compareCodePoints(left.factor.code, right.factor.code) ||
        compareCodePoints(left.gap.competencyRef, right.gap.competencyRef) ||
        compareCodePoints(left.gap.dimension, right.gap.dimension),
    );
  return matches[0] ?? null;
}

function campaignDeadlinePoints(daysUntilDeadline: number, policy: PlanningPolicy): number {
  if (daysUntilDeadline <= 7) return policy.campaignDeadlinePoints.within7Days;
  if (daysUntilDeadline <= 21) return policy.campaignDeadlinePoints.within21Days;
  if (daysUntilDeadline <= 42) return policy.campaignDeadlinePoints.within42Days;
  return 0;
}

function campaignDaysUntilDeadline(input: CalculatePlanInput): number {
  if (!input.campaign) return 0;
  const deadline = parsePlanningInstant(input.campaign.deadlineAt, "campaign.deadlineAt");
  const asOf = parsePlanningInstant(input.evaluationHorizon.asOf, "evaluationHorizon.asOf");
  return Math.ceil((deadline - asOf) / 86_400_000);
}

function candidateHasActiveTrack(
  candidate: PlanningCandidateInput,
  trackById: ReadonlyMap<string, PlanningTrackInput>,
): boolean {
  return candidate.trackId !== null && trackById.get(candidate.trackId)?.lifecycle === "ACTIVE";
}

function effectiveSources(
  candidate: PlanningCandidateInput,
  input: CalculatePlanInput,
  trackById: ReadonlyMap<string, PlanningTrackInput>,
) {
  const readiness = input.readiness.find(
    ({ readinessGoalKey, targetProfileVersionKey }) =>
      readinessGoalKey === candidate.readinessGoalKey &&
      targetProfileVersionKey === candidate.targetProfileVersionKey,
  );
  if (readiness?.reason === "GOAL_INACTIVE") return [];
  return candidate.sourceSignals
    .filter((source) => {
      if (source !== "REVIEW" && readiness?.availability !== "CURRENT") return false;
      if (source === "GROWTH_PLAN") {
        return (
          input.growthPlan?.lifecycle === "ACTIVE" && candidateHasActiveTrack(candidate, trackById)
        );
      }
      if (source === "CAMPAIGN") return input.campaign !== null;
      return input.reviewSummary.projectionState === "CURRENT";
    })
    .sort(compareCodePoints);
}

function protectedCapacityLimit(
  candidate: PlanningCandidateInput,
  sources: readonly PlanningSourceSignal[],
  input: CalculatePlanInput,
  trackById: ReadonlyMap<string, PlanningTrackInput>,
): number | null {
  if (!input.growthPlan) return null;
  const remaining = Math.max(
    0,
    input.growthPlan.weeklyCapacityMinutes - input.growthPlan.consumedMinutesThisWeek,
  );
  if (input.growthPlan.lifecycle !== "ACTIVE") return remaining;
  const deficits = input.growthPlan.tracks
    .filter(({ lifecycle }) => lifecycle === "ACTIVE")
    .map((track) => ({
      track,
      minutes: Math.max(0, track.protectedMinimumMinutes - track.meaningfulMinutesThisWeek),
    }));
  const totalProtected = Math.min(
    remaining,
    deficits.reduce((total, { minutes }) => total + minutes, 0),
  );
  const flexible = remaining - totalProtected;
  if (!sources.includes("GROWTH_PLAN") || candidate.trackId === null) return flexible;
  const track = trackById.get(candidate.trackId);
  const candidateProtected =
    track?.lifecycle === "ACTIVE"
      ? Math.max(0, track.protectedMinimumMinutes - track.meaningfulMinutesThisWeek)
      : 0;
  return Math.min(remaining, flexible + candidateProtected);
}

function scoreCandidate(
  candidate: PlanningCandidateInput,
  input: CalculatePlanInput,
  trackById: ReadonlyMap<string, PlanningTrackInput>,
  policy: PlanningPolicy,
): ScoredCandidate | null {
  const sources = effectiveSources(candidate, input, trackById);
  if (sources.length === 0 || candidate.prerequisiteState === "BLOCKED") return null;

  const capacityLimit = protectedCapacityLimit(candidate, sources, input, trackById);
  if (capacityLimit !== null && candidate.estimatedMinutes > capacityLimit) return null;
  if (
    input.sessionLimitMinutes !== null &&
    candidate.estimatedMinutes > input.sessionLimitMinutes
  ) {
    return null;
  }

  const factors: (PlanScoreFactor | null)[] = [];
  const matchedGap = strongestGap(
    candidate,
    input.readiness.find(({ readinessGoalKey }) => readinessGoalKey === candidate.readinessGoalKey),
    policy,
  );
  factors.push(matchedGap?.factor ?? null);

  if (sources.includes("REVIEW") && candidate.review) {
    factors.push(
      factor(
        candidate.review.bucket === "OVERDUE" ? "REVIEW_OVERDUE" : "REVIEW_DUE_TODAY",
        candidate.review.bucket === "OVERDUE"
          ? policy.overdueReviewPoints
          : policy.dueTodayReviewPoints,
      ),
    );
  }

  const activeTrack =
    candidate.trackId === null ? null : (trackById.get(candidate.trackId) ?? null);
  if (sources.includes("GROWTH_PLAN") && activeTrack?.lifecycle === "ACTIVE") {
    factors.push(factor("TRACK_PRIORITY", activeTrack.priority));
    if (activeTrack.meaningfulMinutesThisWeek < activeTrack.protectedMinimumMinutes) {
      factors.push(factor("TRACK_PROTECTED_MINIMUM", policy.protectedMinimumDeficitPoints));
    }
  }

  if (sources.includes("CAMPAIGN") && input.campaign) {
    factors.push(factor("CAMPAIGN_SOURCE", policy.campaignSourcePoints));
    factors.push(
      factor("CAMPAIGN_DEADLINE", campaignDeadlinePoints(campaignDaysUntilDeadline(input), policy)),
    );
  }

  factors.push(
    factor(
      "PREREQUISITE_UNLOCK",
      Math.min(
        candidate.unlockCount * policy.unlockPointsPerCompetency,
        policy.maximumUnlockPoints,
      ),
    ),
  );
  if (candidate.prerequisiteState === "UNKNOWN") {
    factors.push(factor("PREREQUISITE_UNKNOWN", -policy.unknownPrerequisitePenalty));
  }

  if (input.energyPreference !== null && candidate.energy !== null) {
    const difference = energyRank(candidate.energy) - energyRank(input.energyPreference);
    factors.push(
      difference === 0
        ? factor("ENERGY_EXACT_FIT", policy.exactEnergyFitPoints)
        : difference < 0
          ? factor("ENERGY_LOWER_FIT", policy.lowerEnergyFitPoints)
          : factor("ENERGY_HIGHER_MISMATCH", -policy.higherEnergyPenalty),
    );
  }

  factors.push(
    factor(
      "RECENT_REPETITION",
      -Math.min(
        candidate.repetitionsInLast7Days * policy.repetitionPenaltyEach,
        policy.maximumRepetitionPenalty,
      ),
    ),
  );

  const presentFactors = factors
    .filter((value): value is PlanScoreFactor => value !== null)
    .sort((left, right) => compareCodePoints(left.code, right.code));
  return {
    candidate: {
      ...candidate,
      sourceSignals: sources,
      trackId: sources.includes("GROWTH_PLAN") ? candidate.trackId : null,
    },
    factors: presentFactors,
    strongestGap: matchedGap?.gap ?? null,
    effectiveTrack:
      sources.includes("GROWTH_PLAN") && activeTrack?.lifecycle === "ACTIVE" ? activeTrack : null,
    score: presentFactors.reduce((total, current) => total + current.points, 0),
  };
}

function expectedBenefit(factors: readonly PlanScoreFactor[]): ExpectedBenefitCode {
  const codes = new Set(factors.map(({ code }) => code));
  if (codes.has("TARGET_FAILED_MANDATORY_FLOOR")) {
    return "REDUCE_MANDATORY_BLOCKER";
  }
  if (codes.has("TARGET_UNKNOWN_MANDATORY_FLOOR")) return "VERIFY_MANDATORY_REQUIREMENT";
  if (codes.has("REVIEW_OVERDUE")) return "COMPLETE_OVERDUE_REVIEW";
  if (codes.has("REVIEW_DUE_TODAY")) return "COMPLETE_DUE_REVIEW";
  if (codes.has("TARGET_UNKNOWN_REQUIREMENT")) return "REDUCE_UNCERTAINTY";
  if (codes.has("TARGET_KNOWN_SHORTFALL")) return "REDUCE_TARGET_GAP";
  if (codes.has("TRACK_PROTECTED_MINIMUM")) return "PROTECT_TRACK_CADENCE";
  if (codes.has("CAMPAIGN_SOURCE")) return "ADVANCE_CAMPAIGN";
  return "ADVANCE_GROWTH_TRACK";
}

function explanation(benefit: ExpectedBenefitCode, durationMinutes: number): string {
  const lead: Readonly<Record<ExpectedBenefitCode, string>> = {
    RESUME_ACTIVE_FOCUS: "Resume the Focus Session already in progress",
    REDUCE_MANDATORY_BLOCKER: "Addresses a mandatory target blocker",
    VERIFY_MANDATORY_REQUIREMENT: "Collects evidence for an unknown mandatory requirement",
    COMPLETE_OVERDUE_REVIEW: "Refreshes an overdue competency",
    COMPLETE_DUE_REVIEW: "Completes a review due today",
    REDUCE_TARGET_GAP: "Works on a current target shortfall",
    REDUCE_UNCERTAINTY: "Collects evidence in an unknown target area",
    PROTECT_TRACK_CADENCE: "Protects a track minimum that is not met yet",
    ADVANCE_CAMPAIGN: "Advances the active deadline-driven campaign",
    ADVANCE_GROWTH_TRACK: "Advances the highest-value active growth track",
  };
  return `${lead[benefit]}; estimated ${durationMinutes} minutes.`;
}

function capacity(input: CalculatePlanInput) {
  if (!input.growthPlan) {
    return {
      weeklyCapacityMinutes: null,
      consumedMinutesThisWeek: 0,
      remainingMinutesThisWeek: null,
      sessionLimitMinutes: input.sessionLimitMinutes,
    } as const;
  }
  return {
    weeklyCapacityMinutes: input.growthPlan.weeklyCapacityMinutes,
    consumedMinutesThisWeek: input.growthPlan.consumedMinutesThisWeek,
    remainingMinutesThisWeek: Math.max(
      0,
      input.growthPlan.weeklyCapacityMinutes - input.growthPlan.consumedMinutesThisWeek,
    ),
    sessionLimitMinutes: input.sessionLimitMinutes,
  } as const;
}

function nearestDeadline(input: CalculatePlanInput): PlanSnapshot["nearestDeadline"] {
  return input.campaign
    ? {
        kind: "CAMPAIGN",
        sourceId: input.campaign.campaignId,
        sourceVersion: input.campaign.version,
        readinessGoalKey: input.campaign.readinessGoalKey,
        title: input.campaign.title,
        deadlineAt: toCanonicalInstant(
          parsePlanningInstant(input.campaign.deadlineAt, "campaign.deadlineAt"),
        ),
      }
    : null;
}

function warningCodes(input: CalculatePlanInput): readonly string[] {
  const warnings: string[] = [];
  for (const readiness of input.readiness) {
    if (readiness.availability === "UNAVAILABLE") {
      warnings.push(`READINESS_${readiness.reason}`);
    }
  }
  if (input.reviewSummary.projectionState === "PENDING") warnings.push("REVIEW_PENDING");
  if (input.reviewSummary.projectionState === "NOT_STARTED") warnings.push("REVIEW_NOT_STARTED");
  return [...new Set(warnings)].sort(compareCodePoints);
}

function readinessSummary(
  input: CalculatePlanInput,
  policy: PlanningPolicy,
): PlanSnapshot["readiness"] {
  return input.readiness.map((readiness) => {
    if (readiness.availability === "UNAVAILABLE") {
      return {
        readinessGoalKey: readiness.readinessGoalKey,
        targetProfileVersionKey: readiness.targetProfileVersionKey,
        availability: "UNAVAILABLE" as const,
        reason: readiness.reason,
        snapshotId: null,
        inputFingerprint: null,
        calculatedAsOf: null,
        validUntil: null,
        status: null,
        coverage: null,
        confidence: null,
        blockers: [],
        blockerCount: 0,
        gapCount: 0,
        unknownGapCount: 0,
        criticalGap: null,
      };
    }
    const criticalGap =
      [...readiness.gaps].sort(
        (left, right) =>
          gapPoints(right.gapCode, policy) - gapPoints(left.gapCode, policy) ||
          compareCodePoints(left.competencyRef, right.competencyRef) ||
          compareCodePoints(left.dimension, right.dimension),
      )[0] ?? null;
    return {
      readinessGoalKey: readiness.readinessGoalKey,
      targetProfileVersionKey: readiness.targetProfileVersionKey,
      availability: "CURRENT" as const,
      reason: null,
      snapshotId: readiness.snapshotId,
      inputFingerprint: readiness.inputFingerprint,
      calculatedAsOf: toCanonicalInstant(
        parsePlanningInstant(readiness.calculatedAsOf, "readiness.calculatedAsOf"),
      ),
      validUntil:
        readiness.validUntil === null
          ? null
          : toCanonicalInstant(parsePlanningInstant(readiness.validUntil, "readiness.validUntil")),
      status: readiness.status,
      coverage: readiness.coverage,
      confidence: readiness.confidence,
      blockers: [...readiness.blockers].sort(
        (left, right) =>
          compareCodePoints(left.code, right.code) ||
          compareCodePoints(left.ruleKey, right.ruleKey),
      ),
      blockerCount: readiness.blockers.length,
      gapCount: readiness.gaps.length,
      unknownGapCount: readiness.gaps.filter(({ gapCode }) => gapCode.startsWith("UNKNOWN_"))
        .length,
      criticalGap,
    };
  });
}

function candidateReasonRefs(
  candidate: PlanningCandidateInput,
  factors: readonly PlanScoreFactor[],
  matchedGap: ReadinessGapInput | null,
  effectiveTrack: PlanningTrackInput | null,
  input: CalculatePlanInput,
): readonly PlanReasonRef[] {
  const campaign = input.campaign;
  const refs: PlanReasonRef[] = [];
  for (const { code } of factors) {
    if (code.startsWith("TARGET_") && matchedGap) {
      refs.push({
        factorCode: code as Extract<PlanReasonRef, { kind: "TARGET_GAP" }>["factorCode"],
        kind: "TARGET_GAP",
        gapCode: matchedGap.gapCode,
        readinessGoalKey: candidate.readinessGoalKey,
        competencyRef: matchedGap.competencyRef,
        dimension: matchedGap.dimension,
      });
    } else if ((code === "REVIEW_DUE_TODAY" || code === "REVIEW_OVERDUE") && candidate.review) {
      refs.push({
        factorCode: code,
        kind: "REVIEW_ITEM",
        reviewItemId: candidate.review.reviewItemId,
        bucket: candidate.review.bucket,
        dueAt: toCanonicalInstant(parsePlanningInstant(candidate.review.dueAt, "review.dueAt")),
      });
    } else if (
      (code === "TRACK_PRIORITY" || code === "TRACK_PROTECTED_MINIMUM") &&
      effectiveTrack
    ) {
      refs.push({
        factorCode: code,
        kind: "TRACK",
        trackId: effectiveTrack.trackId,
        trackKey: effectiveTrack.trackKey,
      });
    } else if ((code === "CAMPAIGN_DEADLINE" || code === "CAMPAIGN_SOURCE") && campaign) {
      refs.push({
        factorCode: code,
        kind: "CAMPAIGN",
        campaignId: campaign.campaignId,
        campaignVersion: campaign.version,
        readinessGoalKey: candidate.readinessGoalKey,
        deadlineAt: toCanonicalInstant(
          parsePlanningInstant(campaign.deadlineAt, "campaign.deadlineAt"),
        ),
        daysUntilDeadline: campaignDaysUntilDeadline(input),
      });
    }
  }
  return refs.sort((left, right) => compareCodePoints(left.factorCode, right.factorCode));
}

export function calculateVerifiedPlan(
  input: VerifiedCalculatePlanInput,
  policy: PlanningPolicy,
): PlanSnapshot {
  const { asOfMs, validUntilMs, weekStartMs, weekEndMs, trackById } = validateInput(input, policy);
  const common = {
    engineVersion: PLANNER_ENGINE_VERSION,
    policyVersion: policy.version,
    inputFingerprint: input.inputFingerprint,
    calculatedAsOf: toCanonicalInstant(asOfMs),
    validUntil: toCanonicalInstant(validUntilMs),
    timeZone: input.evaluationHorizon.timeZone,
    weekStart: toCanonicalInstant(weekStartMs),
    weekEnd: toCanonicalInstant(weekEndMs),
    warningCodes: warningCodes(input),
    capacity: capacity(input),
    reviewSummary: {
      ...input.reviewSummary,
      validUntil:
        input.reviewSummary.validUntil === null
          ? null
          : toCanonicalInstant(
              parsePlanningInstant(input.reviewSummary.validUntil, "reviewSummary.validUntil"),
            ),
    },
    nearestDeadline: nearestDeadline(input),
    readiness: readinessSummary(input, policy),
  } as const;

  if (input.activeFocus) {
    const benefit = "RESUME_ACTIVE_FOCUS" as const;
    const resumeFactor = factor("ACTIVE_FOCUS_RESUME", policy.activeFocusResumePoints);
    const actions: readonly PlannedAction[] = [
      {
        rank: 1,
        actionKind: "RESUME",
        candidateKey: `active-focus:${input.activeFocus.focusSessionId}`,
        focusSessionId: input.activeFocus.focusSessionId,
        readinessGoalKey: input.activeFocus.readinessGoalKey,
        activityKey: input.activeFocus.activityKey,
        trackId: input.activeFocus.planAttribution?.trackId ?? null,
        planAttribution: input.activeFocus.planAttribution,
        title: input.activeFocus.title,
        durationMinutes: input.activeFocus.plannedMinutes,
        durationSource: "ACTIVE_FOCUS",
        energy: null,
        sourceSignals: ["ACTIVE_FOCUS"],
        score: policy.activeFocusResumePoints,
        scoreFactors: resumeFactor ? [resumeFactor] : [],
        reasonRefs: resumeFactor
          ? [
              {
                factorCode: "ACTIVE_FOCUS_RESUME" as const,
                kind: "ACTIVE_FOCUS" as const,
                focusSessionId: input.activeFocus.focusSessionId,
              },
            ]
          : [],
        expectedBenefit: benefit,
        reason: explanation(benefit, input.activeFocus.plannedMinutes),
      },
    ];
    return { ...common, recommendationState: "CURRENT", actions };
  }

  if (input.growthPlan === null && input.campaign === null) {
    return { ...common, recommendationState: "NO_PLAN", actions: [] };
  }
  if (input.growthPlan?.lifecycle === "PAUSED" && input.campaign === null) {
    const hasIndependentReview = input.candidates.some(
      (candidate) =>
        candidate.prerequisiteState !== "BLOCKED" &&
        effectiveSources(candidate, input, trackById).includes("REVIEW"),
    );
    if (!hasIndependentReview) {
      return { ...common, recommendationState: "PLAN_PAUSED", actions: [] };
    }
  }

  const remaining = common.capacity.remainingMinutesThisWeek;
  if (input.sessionLimitMinutes === 0 || (remaining !== null && remaining === 0)) {
    return { ...common, recommendationState: "NO_CAPACITY", actions: [] };
  }

  const scored = input.candidates
    .map((candidate) => scoreCandidate(candidate, input, trackById, policy))
    .filter((candidate): candidate is ScoredCandidate => candidate !== null)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.candidate.estimatedMinutes - right.candidate.estimatedMinutes ||
        compareCodePoints(left.candidate.candidateKey, right.candidate.candidateKey),
    )
    .slice(0, policy.maximumActions);

  const actions: readonly PlannedAction[] = scored.map((scoredCandidate, index) => {
    const { candidate, factors, score, strongestGap: matchedGap, effectiveTrack } = scoredCandidate;
    const benefit = expectedBenefit(factors);
    return {
      rank: index + 1,
      actionKind: "START",
      candidateKey: candidate.candidateKey,
      focusSessionId: null,
      readinessGoalKey: candidate.readinessGoalKey,
      activityKey: candidate.activityKey,
      trackId: candidate.trackId,
      planAttribution: null,
      title: candidate.title,
      durationMinutes: candidate.estimatedMinutes,
      durationSource: candidate.durationSource,
      energy: candidate.energy,
      sourceSignals: candidate.sourceSignals,
      score,
      scoreFactors: factors,
      reasonRefs: candidateReasonRefs(candidate, factors, matchedGap, effectiveTrack, input),
      expectedBenefit: benefit,
      reason: explanation(benefit, candidate.estimatedMinutes),
    };
  });

  const recommendationState: PlanSnapshot["recommendationState"] =
    actions.length > 0
      ? "CURRENT"
      : input.growthPlan?.lifecycle === "PAUSED" && input.campaign === null
        ? "PLAN_PAUSED"
        : "NO_CANDIDATES";

  return { ...common, recommendationState, actions };
}
