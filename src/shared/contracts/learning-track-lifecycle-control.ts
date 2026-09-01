import { asJsonObject, asNumber, asString } from "./json";

const MAX_ACTIVE_TRACKS = 30;

export function learningTrackLifecycleControlSemanticViolations(value: unknown): string[] {
  const root = asJsonObject(value, "Learning Track lifecycle control response");
  const contract = asJsonObject(root.contract, "Learning Track lifecycle control contract");
  const name = asString(contract.name);
  if (name === "CurrentLearningTracksV1") return currentViolations(root);
  if (name === "LearningTrackLifecycleApplyResultV1") return [];
  if (name !== "LearningTrackLifecyclePreviewV1")
    return ["LEARNING_TRACK_LIFECYCLE_CONTROL_CONTRACT"];
  return previewViolations(root);
}

function currentViolations(root: Record<string, unknown>): string[] {
  const tracks = Array.isArray(root.learningTracks) ? root.learningTracks : [];
  if (root.growthPlan === null) {
    return tracks.length === 0 ? [] : ["CURRENT_LEARNING_TRACKS_EMPTY_PLAN"];
  }
  const seen = new Set<string>();
  const violations: string[] = [];
  let previous:
    { readonly priority: number; readonly trackKey: string; readonly id: string } | undefined;
  for (const item of tracks) {
    const track = asJsonObject(item, "learning track");
    const key = asString(track.trackKey);
    const id = asString(track.learningTrackId).toLowerCase();
    if (seen.has(`${key}:${id}`)) violations.push("CURRENT_LEARNING_TRACKS_DUPLICATE");
    seen.add(`${key}:${id}`);
    const priority = asNumber(track.priority);
    if (priority === undefined) {
      violations.push("CURRENT_LEARNING_TRACKS_ORDER");
    } else if (
      previous !== undefined &&
      (priority > previous.priority ||
        (priority === previous.priority &&
          (key.localeCompare(previous.trackKey) < 0 ||
            (key === previous.trackKey && id.localeCompare(previous.id) < 0))))
    ) {
      violations.push("CURRENT_LEARNING_TRACKS_ORDER");
    }
    previous = priority === undefined ? previous : { priority, trackKey: key, id };
    const expected = track.lifecycle === "ACTIVE" ? "pause_track" : "resume_track";
    const capabilities = Array.isArray(track.capabilities) ? track.capabilities : [];
    if (capabilities.length !== 1 || capabilities[0] !== expected) {
      violations.push("CURRENT_LEARNING_TRACKS_CAPABILITY");
    }
  }
  return violations.sort();
}

function previewViolations(root: Record<string, unknown>): string[] {
  const before = asJsonObject(root.before, "before");
  const after = asJsonObject(root.after, "after");
  const plan = asJsonObject(root.growthPlan, "growthPlan");
  const constraint = asJsonObject(root.constraint, "constraint");
  const blockingReasons = Array.isArray(root.blockingReasons) ? root.blockingReasons : [];
  const warnings = Array.isArray(root.warnings) ? root.warnings : [];
  const violations: string[] = [];
  const reason = typeof root.reason === "string" ? root.reason : undefined;
  if (reason === undefined || /[\p{Cc}]/u.test(reason))
    violations.push("LEARNING_TRACK_PREVIEW_REASON");
  if (root.expectedGrowthPlanVersion !== plan.aggregateVersion) {
    violations.push("LEARNING_TRACK_PREVIEW_EXPECTED_PLAN_VERSION");
  }
  if (root.expectedLearningTrackVersion !== before.aggregateVersion) {
    violations.push("LEARNING_TRACK_PREVIEW_EXPECTED_TRACK_VERSION");
  }
  for (const field of [
    "learningTrackId",
    "trackKey",
    "title",
    "priority",
    "protectedMinimumMinutes",
  ] as const) {
    if (before[field] !== after[field]) violations.push("LEARNING_TRACK_PREVIEW_UNCHANGED_FIELDS");
  }
  try {
    if (BigInt(String(after.aggregateVersion)) !== BigInt(String(before.aggregateVersion)) + 1n) {
      violations.push("LEARNING_TRACK_PREVIEW_VERSION_ADVANCE");
    }
  } catch {
    violations.push("LEARNING_TRACK_PREVIEW_VERSION_ADVANCE");
  }
  const transition = `${String(before.lifecycle)}:${String(after.lifecycle)}`;
  if (
    (root.operation === "pause_track" && transition !== "ACTIVE:PAUSED") ||
    (root.operation === "resume_track" && transition !== "PAUSED:ACTIVE")
  )
    violations.push("LEARNING_TRACK_PREVIEW_TRANSITION");

  const beforeCount = asNumber(constraint.activeTrackCountBefore);
  const afterCount = asNumber(constraint.activeTrackCountAfter);
  const beforeMinimum = asNumber(constraint.activeProtectedMinimumMinutesBefore);
  const afterMinimum = asNumber(constraint.activeProtectedMinimumMinutesAfter);
  const capacity = asNumber(plan.weeklyCapacityMinutes);
  const trackMinimum = asNumber(before.protectedMinimumMinutes);
  if (
    [beforeCount, afterCount, beforeMinimum, afterMinimum, capacity, trackMinimum].some(
      (item) => item === undefined,
    )
  ) {
    violations.push("LEARNING_TRACK_PREVIEW_CONSTRAINT");
  } else {
    const delta = root.operation === "pause_track" ? -1 : 1;
    const minimumDelta = root.operation === "pause_track" ? -trackMinimum! : trackMinimum!;
    if (afterCount !== beforeCount! + delta || afterMinimum !== beforeMinimum! + minimumDelta) {
      violations.push("LEARNING_TRACK_PREVIEW_CONSTRAINT_DELTA");
    }
    if (
      constraint.flexibleMinutesBefore !== capacity! - beforeMinimum! ||
      constraint.flexibleMinutesAfter !== capacity! - afterMinimum!
    ) {
      violations.push("LEARNING_TRACK_PREVIEW_FLEXIBLE_MINUTES");
    }
    const expectedBlock =
      root.operation === "resume_track" && afterCount! > MAX_ACTIVE_TRACKS
        ? { code: "ACTIVE_TRACK_LIMIT_EXCEEDED", maximumActiveTracks: MAX_ACTIVE_TRACKS }
        : root.operation === "resume_track" && afterMinimum! > capacity!
          ? { code: "ACTIVE_TRACK_MINIMUM_EXCEEDS_CAPACITY", minimumCapacityMinutes: afterMinimum! }
          : undefined;
    const actual =
      blockingReasons.length === 1
        ? asJsonObject(blockingReasons[0], "blocking reason")
        : undefined;
    if (
      root.canApply !== (expectedBlock === undefined) ||
      (expectedBlock === undefined ? blockingReasons.length !== 0 : blockingReasons.length !== 1)
    ) {
      violations.push("LEARNING_TRACK_PREVIEW_APPLICABILITY");
    }
    if (
      expectedBlock !== undefined &&
      (actual?.code !== expectedBlock.code ||
        (expectedBlock.code === "ACTIVE_TRACK_LIMIT_EXCEEDED"
          ? actual.maximumActiveTracks !== MAX_ACTIVE_TRACKS
          : actual.minimumCapacityMinutes !== expectedBlock.minimumCapacityMinutes))
    ) {
      violations.push("LEARNING_TRACK_PREVIEW_BLOCKING_REASON");
    }
  }
  const expectedWarning = plan.lifecycle === "PAUSED" ? "PARENT_GROWTH_PLAN_PAUSED" : undefined;
  if (
    warnings.length !== (expectedWarning === undefined ? 0 : 1) ||
    (expectedWarning !== undefined && asJsonObject(warnings[0], "warning").code !== expectedWarning)
  ) {
    violations.push("LEARNING_TRACK_PREVIEW_WARNING");
  }
  return violations.sort();
}
