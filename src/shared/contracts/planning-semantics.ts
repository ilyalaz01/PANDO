import {
  asArray,
  asNumber,
  asString,
  canonicalize,
  isJsonObject,
  sha256,
  type JsonObject,
  type JsonValue,
} from "./json";
import { sameInstant } from "../domain/utc-instant";

function integer(value: JsonValue | undefined): number | null {
  const number = asNumber(value);
  return number !== undefined && Number.isSafeInteger(number) ? number : null;
}

function duplicate(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}

function sorted(values: readonly string[]): boolean {
  return values.every((value, index) => index === 0 || values[index - 1]! < value);
}

export function planningInputFingerprint(value: unknown): string {
  if (!isJsonObject(value)) throw new TypeError("Planning input must be an object");
  const unsigned = structuredClone(value);
  delete unsigned.inputFingerprint;
  const sortObjects = (items: JsonValue | undefined, key: (item: JsonObject) => string): void => {
    if (!Array.isArray(items)) return;
    items.sort((left, right) => {
      if (!isJsonObject(left) || !isJsonObject(right)) return 0;
      const leftKey = key(left);
      const rightKey = key(right);
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    });
  };
  sortObjects(
    unsigned.sourceRevisions,
    (item) => `${asString(item.owner)}\u001f${asString(item.key)}`,
  );
  if (isJsonObject(unsigned.growthPlan)) {
    sortObjects(unsigned.growthPlan.tracks, (item) => asString(item.trackId) ?? "");
  }
  sortObjects(unsigned.readiness, (item) => asString(item.readinessGoalKey) ?? "");
  for (const readiness of asArray(unsigned.readiness).filter(isJsonObject)) {
    sortObjects(
      readiness.blockers,
      (item) => `${asString(item.code)}\u001f${asString(item.ruleKey)}`,
    );
    sortObjects(
      readiness.gaps,
      (item) =>
        `${asString(item.gapCode)}\u001f${asString(item.competencyRef)}\u001f${asString(item.dimension)}`,
    );
  }
  sortObjects(unsigned.candidates, (item) => asString(item.candidateKey) ?? "");
  for (const candidate of asArray(unsigned.candidates).filter(isJsonObject)) {
    if (Array.isArray(candidate.sourceSignals)) candidate.sourceSignals.sort();
    sortObjects(
      candidate.competencyImpacts,
      (item) => `${asString(item.competencyRef)}\u001f${asString(item.dimension)}`,
    );
  }
  return `planning-input:${sha256(canonicalize(unsigned))}`;
}

export function planningInputSemanticViolations(value: unknown): readonly string[] {
  if (!isJsonObject(value)) return ["PLANNING_INPUT_NOT_OBJECT"];
  const violations: string[] = [];
  if (asString(value.inputFingerprint) !== planningInputFingerprint(value)) {
    violations.push("PLANNING_INPUT_FINGERPRINT");
  }
  const revisionKeys = asArray(value.sourceRevisions)
    .filter(isJsonObject)
    .map((revision) => `${asString(revision.owner) ?? ""}\u001f${asString(revision.key) ?? ""}`);
  if (duplicate(revisionKeys) || !sorted(revisionKeys)) {
    violations.push("PLANNING_INPUT_SOURCE_REVISION_ORDER");
  }
  const readinessKeys = asArray(value.readiness)
    .filter(isJsonObject)
    .map((readiness) => asString(readiness.readinessGoalKey) ?? "");
  if (duplicate(readinessKeys) || !sorted(readinessKeys)) {
    violations.push("PLANNING_INPUT_READINESS_ORDER");
  }
  return violations.sort();
}

function actionViolations(
  action: JsonObject,
  index: number,
  calculatedAsOfMs: number,
  validUntilMs: number,
): readonly string[] {
  const violations: string[] = [];
  const prefix = `PLAN_SNAPSHOT_ACTION_${index}`;
  const actionKind = asString(action.actionKind);
  const focusSessionId = action.focusSessionId;
  const energy = action.energy;
  const trackId = action.trackId;
  const planAttribution = isJsonObject(action.planAttribution) ? action.planAttribution : null;
  const durationSource = asString(action.durationSource);
  const sources = asArray(action.sourceSignals)
    .map(asString)
    .filter((value): value is string => value !== undefined);
  const factors = asArray(action.scoreFactors).filter(isJsonObject);
  const factorCodes = factors
    .map(({ code }) => asString(code))
    .filter((value): value is string => value !== undefined);
  const factorPoints = factors.map(({ points }) => integer(points));
  const score = integer(action.score);
  const reasonRefs = asArray(action.reasonRefs).filter(isJsonObject);
  const reasonFactorCodes = reasonRefs
    .map(({ factorCode }) => asString(factorCode))
    .filter((value): value is string => value !== undefined);
  const referencedFactorCodes = factorCodes.filter(
    (code) =>
      code === "ACTIVE_FOCUS_RESUME" ||
      code.startsWith("CAMPAIGN_") ||
      code.startsWith("REVIEW_") ||
      code.startsWith("TARGET_") ||
      code.startsWith("TRACK_"),
  );

  if (
    (actionKind === "RESUME" &&
      (typeof focusSessionId !== "string" ||
        energy !== null ||
        (planAttribution === null && trackId !== null) ||
        (planAttribution !== null && planAttribution.trackId !== trackId) ||
        durationSource !== "ACTIVE_FOCUS" ||
        sources.join("\u001f") !== "ACTIVE_FOCUS")) ||
    (actionKind === "START" &&
      (focusSessionId !== null ||
        planAttribution !== null ||
        durationSource === "ACTIVE_FOCUS" ||
        sources.includes("ACTIVE_FOCUS") ||
        sources.includes("GROWTH_PLAN") !== (typeof trackId === "string")))
  ) {
    violations.push(`${prefix}_SHAPE`);
  }
  if (factorCodes.length !== factors.length || duplicate(factorCodes) || !sorted(factorCodes)) {
    violations.push(`${prefix}_FACTOR_ORDER`);
  }
  if (factorPoints.some((points) => points === 0)) {
    violations.push(`${prefix}_FACTOR_POINTS`);
  }
  if (duplicate(sources) || !sorted(sources)) {
    violations.push(`${prefix}_SOURCE_ORDER`);
  }
  if (
    score === null ||
    factorPoints.some((points) => points === null) ||
    factorPoints.reduce((total: number, points) => total + (points ?? 0), 0) !== score
  ) {
    violations.push(`${prefix}_SCORE_SUM`);
  }
  if (
    reasonRefs.length !== asArray(action.reasonRefs).length ||
    duplicate(reasonFactorCodes) ||
    !sorted(reasonFactorCodes) ||
    reasonFactorCodes.some((code) => !factorCodes.includes(code)) ||
    reasonFactorCodes.join("\u001f") !== referencedFactorCodes.join("\u001f")
  ) {
    violations.push(`${prefix}_REASON_REFS`);
  }
  const gapFactorByCode: Readonly<Record<string, string>> = {
    FAILED_MANDATORY_FLOOR: "TARGET_FAILED_MANDATORY_FLOOR",
    KNOWN_SHORTFALL: "TARGET_KNOWN_SHORTFALL",
    UNKNOWN_MANDATORY_FLOOR: "TARGET_UNKNOWN_MANDATORY_FLOOR",
    UNKNOWN_REQUIREMENT: "TARGET_UNKNOWN_REQUIREMENT",
  };
  if (
    reasonRefs.some((reference) => {
      const kind = asString(reference.kind);
      const factorCode = asString(reference.factorCode);
      if (kind === "ACTIVE_FOCUS") {
        return reference.focusSessionId !== focusSessionId;
      }
      if (kind === "TARGET_GAP") {
        const gapCode = asString(reference.gapCode);
        return (
          gapCode === undefined ||
          gapFactorByCode[gapCode] !== factorCode ||
          reference.readinessGoalKey !== action.readinessGoalKey
        );
      }
      if (kind === "REVIEW_ITEM") {
        const bucket = asString(reference.bucket);
        const dueAtMs =
          typeof reference.dueAt === "string" ? Date.parse(reference.dueAt) : Number.NaN;
        return (
          (bucket === "OVERDUE" && factorCode !== "REVIEW_OVERDUE") ||
          (bucket === "DUE_TODAY" && factorCode !== "REVIEW_DUE_TODAY") ||
          (bucket !== "OVERDUE" && bucket !== "DUE_TODAY") ||
          !Number.isFinite(dueAtMs) ||
          (bucket === "OVERDUE" && dueAtMs >= calculatedAsOfMs) ||
          (bucket === "DUE_TODAY" && (dueAtMs < calculatedAsOfMs || validUntilMs > dueAtMs)) ||
          !sources.includes("REVIEW")
        );
      }
      if (kind === "TRACK") {
        return reference.trackId !== trackId || !sources.includes("GROWTH_PLAN");
      }
      if (kind === "CAMPAIGN") {
        const deadlineMs =
          typeof reference.deadlineAt === "string" ? Date.parse(reference.deadlineAt) : Number.NaN;
        const expectedDays = Math.ceil((deadlineMs - calculatedAsOfMs) / 86_400_000);
        return (
          !sources.includes("CAMPAIGN") ||
          reference.readinessGoalKey !== action.readinessGoalKey ||
          !Number.isFinite(deadlineMs) ||
          deadlineMs < calculatedAsOfMs ||
          integer(reference.daysUntilDeadline) !== expectedDays
        );
      }
      return false;
    })
  ) {
    violations.push(`${prefix}_REASON_REF_COHERENCE`);
  }
  const trackRefs = reasonRefs.filter(({ kind }) => kind === "TRACK");
  const campaignRefs = reasonRefs.filter(({ kind }) => kind === "CAMPAIGN");
  if (
    (trackRefs.length > 1 &&
      trackRefs.some(
        (reference) =>
          reference.trackId !== trackRefs[0]!.trackId ||
          reference.trackKey !== trackRefs[0]!.trackKey,
      )) ||
    (campaignRefs.length > 1 &&
      campaignRefs.some(
        (reference) =>
          reference.campaignId !== campaignRefs[0]!.campaignId ||
          reference.campaignVersion !== campaignRefs[0]!.campaignVersion ||
          reference.readinessGoalKey !== campaignRefs[0]!.readinessGoalKey ||
          reference.deadlineAt !== campaignRefs[0]!.deadlineAt ||
          reference.daysUntilDeadline !== campaignRefs[0]!.daysUntilDeadline,
      ))
  ) {
    violations.push(`${prefix}_REASON_REF_COHERENCE`);
  }
  return violations;
}

export function planSnapshotSemanticViolations(value: unknown): readonly string[] {
  if (!isJsonObject(value)) return ["PLAN_SNAPSHOT_NOT_OBJECT"];
  const violations: string[] = [];
  const actions = asArray(value.actions).filter(isJsonObject);
  const state = asString(value.recommendationState);
  const warningCodes = asArray(value.warningCodes)
    .map(asString)
    .filter((code): code is string => code !== undefined);
  const capacity = isJsonObject(value.capacity) ? value.capacity : null;
  const readiness = asArray(value.readiness).filter(isJsonObject);
  const nearestDeadline = isJsonObject(value.nearestDeadline) ? value.nearestDeadline : null;
  const reviewSummary = isJsonObject(value.reviewSummary) ? value.reviewSummary : null;
  const calculatedAsOfMs =
    typeof value.calculatedAsOf === "string" ? Date.parse(value.calculatedAsOf) : Number.NaN;
  const validUntilMs =
    typeof value.validUntil === "string" ? Date.parse(value.validUntil) : Number.NaN;
  const weekStartMs =
    typeof value.weekStart === "string" ? Date.parse(value.weekStart) : Number.NaN;
  const weekEndMs = typeof value.weekEnd === "string" ? Date.parse(value.weekEnd) : Number.NaN;

  if (actions.length !== asArray(value.actions).length)
    violations.push("PLAN_SNAPSHOT_ACTION_SHAPE");
  if ((state === "CURRENT") !== actions.length > 0) {
    violations.push("PLAN_SNAPSHOT_RECOMMENDATION_STATE");
  }
  if (duplicate(warningCodes) || !sorted(warningCodes)) {
    violations.push("PLAN_SNAPSHOT_WARNING_ORDER");
  }
  if (
    ![calculatedAsOfMs, validUntilMs, weekStartMs, weekEndMs].every(Number.isFinite) ||
    validUntilMs < calculatedAsOfMs ||
    weekStartMs > calculatedAsOfMs ||
    weekEndMs <= calculatedAsOfMs ||
    weekStartMs >= weekEndMs ||
    validUntilMs >= weekEndMs
  ) {
    violations.push("PLAN_SNAPSHOT_CLOCK");
  }
  if (
    nearestDeadline &&
    (typeof nearestDeadline.deadlineAt !== "string" ||
      typeof value.calculatedAsOf !== "string" ||
      Date.parse(nearestDeadline.deadlineAt) < Date.parse(value.calculatedAsOf))
  ) {
    violations.push("PLAN_SNAPSHOT_DEADLINE_EXPIRED");
  }
  if (nearestDeadline && typeof nearestDeadline.deadlineAt === "string") {
    const deadlineMs = Date.parse(nearestDeadline.deadlineAt);
    const daysUntilDeadline = Math.ceil((deadlineMs - calculatedAsOfMs) / 86_400_000);
    const nextDayCountChangeAt = deadlineMs - Math.max(0, daysUntilDeadline - 1) * 86_400_000;
    const campaignValidUntilMs =
      deadlineMs === calculatedAsOfMs ? deadlineMs : Math.min(deadlineMs, nextDayCountChangeAt - 1);
    if (
      !Number.isFinite(deadlineMs) ||
      daysUntilDeadline < 0 ||
      daysUntilDeadline > 36_500 ||
      validUntilMs > campaignValidUntilMs
    ) {
      violations.push("PLAN_SNAPSHOT_CAMPAIGN_VALIDITY");
    }
  }
  if (reviewSummary) {
    const reviewState = asString(reviewSummary.projectionState);
    const dueTodayCount = integer(reviewSummary.dueTodayCount);
    const reviewValidUntil =
      typeof reviewSummary.validUntil === "string"
        ? Date.parse(reviewSummary.validUntil)
        : reviewSummary.validUntil === null
          ? null
          : Number.NaN;
    const calculatedAsOf =
      typeof value.calculatedAsOf === "string" ? Date.parse(value.calculatedAsOf) : Number.NaN;
    const planValidUntil =
      typeof value.validUntil === "string" ? Date.parse(value.validUntil) : Number.NaN;
    if (
      (reviewState !== "CURRENT" && reviewValidUntil !== null) ||
      (reviewState === "CURRENT" &&
        dueTodayCount !== null &&
        dueTodayCount > 0 &&
        reviewValidUntil === null) ||
      (typeof reviewValidUntil === "number" &&
        (!Number.isFinite(reviewValidUntil) ||
          reviewValidUntil < calculatedAsOf ||
          planValidUntil > reviewValidUntil))
    ) {
      violations.push("PLAN_SNAPSHOT_REVIEW_VALIDITY");
    }
  }

  const ranks = actions.map(({ rank }) => integer(rank));
  if (ranks.some((rank, index) => rank !== index + 1)) violations.push("PLAN_SNAPSHOT_RANK_ORDER");
  if (
    actions.some((action, index) => {
      if (index === 0) return false;
      const previous = actions[index - 1]!;
      const previousScore = integer(previous.score);
      const score = integer(action.score);
      const previousDuration = integer(previous.durationMinutes);
      const duration = integer(action.durationMinutes);
      const previousKey = asString(previous.candidateKey);
      const key = asString(action.candidateKey);
      if (
        previousScore === null ||
        score === null ||
        previousDuration === null ||
        duration === null ||
        previousKey === undefined ||
        key === undefined
      ) {
        return true;
      }
      return (
        previousScore < score ||
        (previousScore === score && previousDuration > duration) ||
        (previousScore === score && previousDuration === duration && previousKey > key)
      );
    })
  ) {
    violations.push("PLAN_SNAPSHOT_ACTION_ORDER");
  }
  const candidateKeys = actions
    .map(({ candidateKey }) => asString(candidateKey))
    .filter((candidateKey): candidateKey is string => candidateKey !== undefined);
  const focusPairs = actions
    .map(({ readinessGoalKey, activityKey }) => {
      const goal = asString(readinessGoalKey);
      const activity = asString(activityKey);
      return goal && activity ? `${goal}\u001f${activity}` : null;
    })
    .filter((pair): pair is string => pair !== null);
  if (duplicate(candidateKeys) || duplicate(focusPairs))
    violations.push("PLAN_SNAPSHOT_ACTION_DUPLICATE");
  actions.forEach((action, index) =>
    violations.push(...actionViolations(action, index, calculatedAsOfMs, validUntilMs)),
  );
  for (const action of actions) {
    for (const reference of asArray(action.reasonRefs).filter(isJsonObject)) {
      if (reference.kind !== "CAMPAIGN") continue;
      if (
        !nearestDeadline ||
        reference.campaignId !== nearestDeadline.sourceId ||
        reference.campaignVersion !== nearestDeadline.sourceVersion ||
        reference.readinessGoalKey !== nearestDeadline.readinessGoalKey ||
        reference.deadlineAt !== nearestDeadline.deadlineAt
      ) {
        violations.push("PLAN_SNAPSHOT_CAMPAIGN_CONTEXT");
      }
    }
  }

  if (capacity) {
    const weekly = capacity.weeklyCapacityMinutes;
    const consumed = integer(capacity.consumedMinutesThisWeek);
    const remaining = capacity.remainingMinutesThisWeek;
    if (
      (weekly === null && (consumed !== 0 || remaining !== null)) ||
      (typeof weekly === "number" &&
        (consumed === null || remaining !== Math.max(0, weekly - consumed)))
    ) {
      violations.push("PLAN_SNAPSHOT_CAPACITY_ARITHMETIC");
    }
  }

  const readinessKeys = readiness.map(({ readinessGoalKey }) => asString(readinessGoalKey) ?? "");
  if (
    readiness.length !== asArray(value.readiness).length ||
    duplicate(readinessKeys) ||
    !sorted(readinessKeys)
  ) {
    violations.push("PLAN_SNAPSHOT_READINESS_ORDER");
  }
  for (const item of readiness) {
    const availability = asString(item.availability);
    const currentShape =
      item.reason === null &&
      typeof item.status === "string" &&
      typeof item.snapshotId === "string" &&
      typeof item.inputFingerprint === "string" &&
      typeof item.calculatedAsOf === "string" &&
      (typeof item.validUntil === "string" || item.validUntil === null) &&
      typeof item.coverage === "number" &&
      typeof item.confidence === "string";
    const unavailableShape =
      typeof item.reason === "string" &&
      item.status === null &&
      item.snapshotId === null &&
      item.inputFingerprint === null &&
      item.calculatedAsOf === null &&
      item.validUntil === null &&
      item.coverage === null &&
      item.confidence === null &&
      asArray(item.blockers).length === 0 &&
      item.criticalGap === null &&
      integer(item.blockerCount) === 0 &&
      integer(item.gapCount) === 0 &&
      integer(item.unknownGapCount) === 0;
    if (
      (availability === "CURRENT" && !currentShape) ||
      (availability === "UNAVAILABLE" && !unavailableShape)
    ) {
      violations.push("PLAN_SNAPSHOT_READINESS_SHAPE");
    }
    if (availability === "CURRENT") {
      const readinessCalculatedAsOf =
        typeof item.calculatedAsOf === "string" ? Date.parse(item.calculatedAsOf) : Number.NaN;
      const readinessValidUntil =
        typeof item.validUntil === "string"
          ? Date.parse(item.validUntil)
          : item.validUntil === null
            ? null
            : Number.NaN;
      if (
        !Number.isFinite(readinessCalculatedAsOf) ||
        readinessCalculatedAsOf > calculatedAsOfMs ||
        (typeof readinessValidUntil === "number" &&
          (!Number.isFinite(readinessValidUntil) || readinessValidUntil < validUntilMs))
      ) {
        violations.push("PLAN_SNAPSHOT_READINESS_VALIDITY");
      }
    }
    const blockers = asArray(item.blockers).filter(isJsonObject);
    const blockerKeys = blockers.map(
      ({ code, ruleKey }) => `${asString(code) ?? ""}\u001f${asString(ruleKey) ?? ""}`,
    );
    if (
      blockers.length !== asArray(item.blockers).length ||
      blockers.length !== integer(item.blockerCount) ||
      duplicate(blockerKeys) ||
      !sorted(blockerKeys) ||
      (integer(item.unknownGapCount) ?? 0) > (integer(item.gapCount) ?? 0)
    ) {
      violations.push("PLAN_SNAPSHOT_READINESS_COUNTS");
    }
  }

  return [...new Set(violations)].sort();
}

export function todayWorkspaceSemanticViolations(value: unknown): readonly string[] {
  if (!isJsonObject(value)) return ["TODAY_WORKSPACE_NOT_OBJECT"];
  const violations: string[] = [];
  const state = asString(value.projectionState);
  const reason = value.reason;
  const safe = value.lastKnownSafe;
  const currentFingerprint = value.currentInputFingerprint;
  const snapshot = isJsonObject(value.snapshot) ? value.snapshot : null;
  const clock = isJsonObject(value.calculationClock) ? value.calculationClock : null;
  const selections = asArray(value.actionSelections).filter(isJsonObject);
  const context = isJsonObject(value.context) ? value.context : null;

  if (safe !== (snapshot !== null)) violations.push("TODAY_WORKSPACE_SAFE_SNAPSHOT");
  if (selections.length !== asArray(value.actionSelections).length) {
    violations.push("TODAY_WORKSPACE_ACTION_SELECTIONS");
  }
  if (state === "CURRENT") {
    if (
      reason !== null ||
      safe !== true ||
      snapshot === null ||
      typeof currentFingerprint !== "string" ||
      snapshot.inputFingerprint !== currentFingerprint
    ) {
      violations.push("TODAY_WORKSPACE_CURRENT_SHAPE");
    }
  } else if (state === "NOT_STARTED") {
    if (
      reason !== "INITIALIZING" ||
      safe !== false ||
      snapshot !== null ||
      currentFingerprint !== null
    ) {
      violations.push("TODAY_WORKSPACE_NOT_STARTED_SHAPE");
    }
  } else if (state === "PENDING" || state === "ERROR") {
    if (
      typeof reason !== "string" ||
      (currentFingerprint !== null && typeof currentFingerprint !== "string")
    ) {
      violations.push("TODAY_WORKSPACE_DEGRADED_SHAPE");
    }
  }

  if (snapshot) {
    const plan = isJsonObject(snapshot.plan) ? snapshot.plan : null;
    if (plan && planSnapshotSemanticViolations(plan).length > 0) {
      violations.push("TODAY_WORKSPACE_PLAN_SEMANTICS");
    }
    if (
      !plan ||
      snapshot.inputFingerprint !== plan.inputFingerprint ||
      typeof snapshot.calculatedAsOf !== "string" ||
      typeof plan.calculatedAsOf !== "string" ||
      !sameInstant(snapshot.calculatedAsOf, plan.calculatedAsOf) ||
      typeof snapshot.validUntil !== "string" ||
      typeof plan.validUntil !== "string" ||
      !sameInstant(snapshot.validUntil, plan.validUntil)
    ) {
      violations.push("TODAY_WORKSPACE_SNAPSHOT_IDENTITY");
    }
    const asOf = clock && typeof clock.asOf === "string" ? Date.parse(clock.asOf) : Number.NaN;
    const validUntil =
      typeof snapshot.validUntil === "string" ? Date.parse(snapshot.validUntil) : Number.NaN;
    if (!Number.isFinite(asOf) || !Number.isFinite(validUntil) || validUntil < asOf) {
      violations.push("TODAY_WORKSPACE_SNAPSHOT_EXPIRED");
    }
    if (
      plan &&
      clock &&
      (plan.timeZone !== clock.timeZone ||
        typeof plan.weekStart !== "string" ||
        typeof clock.weekStart !== "string" ||
        !sameInstant(plan.weekStart, clock.weekStart) ||
        typeof plan.weekEnd !== "string" ||
        typeof clock.weekEnd !== "string" ||
        !sameInstant(plan.weekEnd, clock.weekEnd))
    ) {
      violations.push("TODAY_WORKSPACE_CLOCK_MISMATCH");
    }
    const actions = plan ? asArray(plan.actions).filter(isJsonObject) : [];
    const selectionRefs = selections
      .map(({ selectionRef }) => asString(selectionRef))
      .filter((selectionRef): selectionRef is string => selectionRef !== undefined);
    if (
      state === "CURRENT"
        ? selections.length !== actions.length ||
          duplicate(selectionRefs) ||
          selections.some(
            (selection, index) =>
              integer(selection.rank) !== integer(actions[index]?.rank) ||
              asString(selection.candidateKey) !== asString(actions[index]?.candidateKey),
          )
        : selections.length !== 0
    ) {
      violations.push("TODAY_WORKSPACE_ACTION_SELECTIONS");
    }
    const deadline = context?.nearestDeadline;
    const planDeadline = plan?.nearestDeadline;
    if (
      canonicalize((deadline ?? null) as JsonValue) !==
      canonicalize((planDeadline ?? null) as JsonValue)
    ) {
      violations.push("TODAY_WORKSPACE_DEADLINE_SOURCE");
    }
    if (
      isJsonObject(deadline) &&
      (typeof deadline.deadlineAt !== "string" ||
        !clock ||
        typeof clock.asOf !== "string" ||
        Date.parse(deadline.deadlineAt) < Date.parse(clock.asOf))
    ) {
      violations.push("TODAY_WORKSPACE_DEADLINE_EXPIRED");
    }
  } else if (selections.length !== 0 || context?.nearestDeadline !== null) {
    violations.push("TODAY_WORKSPACE_ACTION_SELECTIONS");
    if (context?.nearestDeadline !== null) violations.push("TODAY_WORKSPACE_DEADLINE_SOURCE");
  }

  return [...new Set(violations)].sort();
}
