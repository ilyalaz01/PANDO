"use server";

import { revalidatePath } from "next/cache";
import { createPandoServerActionClient } from "../../shared/supabase/server";
import { verifyPandoSession } from "../../shared/supabase/session";
import type { PlanActionState } from "../../ui/plan/plan-action-state";
import { initialPlanActionState } from "../../ui/plan/plan-action-state";
import type { PlanOperation, TrackOperation } from "../../ui/plan/plan-types";
import type { LearningTrackTerminalLifecycleOperationV1 } from "../../shared/contracts/learning-track-terminal-lifecycle-control";
import {
  applyLearningTrackLifecycleV1,
  applyLearningTrackTerminalLifecycleV1,
  applyLearningTrackCreationV1,
  applyLearningTrackActivityAdmissionV1,
  applyLearningTrackActivityAdmissionV2,
  applyLearningTrackPriorityMinimumV1,
  applyLearningTrackCadenceV1,
  applyGrowthPlanInitializationV1,
  applyGrowthPlanReplacementV1,
  applyGrowthPlanCapacityV1,
  applyGrowthPlanLifecycleV1,
  applyAvailabilityWindowV1,
  previewGrowthPlanCapacityV1,
  previewGrowthPlanLifecycleV1,
  previewLearningTrackLifecycleV1,
  previewLearningTrackTerminalLifecycleV1,
  previewLearningTrackCreationV1,
  previewLearningTrackActivityAdmissionV1,
  previewLearningTrackActivityAdmissionV2,
  previewLearningTrackPriorityMinimumV1,
  previewLearningTrackCadenceV1,
  previewGrowthPlanInitializationV1,
  previewGrowthPlanReplacementV1,
  previewAvailabilityWindowV1,
  PlanConflictError,
  PlanInputError,
} from "../../ui/plan/server/database-plan";
import type { AvailabilityWindowOperationV1 } from "../../ui/plan/plan-types";

const VERSION = /^[1-9][0-9]{0,18}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const OPERATIONS = ["pause_growth_plan", "resume_growth_plan"] as const;
const CAPACITY = /^(?:0|[1-9][0-9]{0,4})$/u;
const TRACK_KEY = /^track:[a-z0-9][a-z0-9-]{1,100}$/u;
const ACTIVITY_KEY = /^activity:[a-z0-9][a-z0-9-]{1,100}$/u;
const GOAL_KEY = /^goal:[a-z0-9][a-z0-9-]{1,100}$/u;
const TRACK_OPERATIONS = ["pause_track", "resume_track"] as const;
const TERMINAL_TRACK_OPERATIONS = ["complete_track", "archive_track"] as const;
const PRIORITY = /^(?:0|[1-9][0-9]{0,2})$/u;
const CONTROL_CHARACTER = /[\p{Cc}]/u;
const WINDOW_KEY = /^window:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const LOCAL_DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u;
const AVAILABILITY_OPERATIONS = [
  "create_availability_window",
  "change_availability_window",
  "remove_availability_window",
] as const;

function validReason(value: string): boolean {
  return (
    value.trim() === value &&
    Array.from(value).length >= 1 &&
    Array.from(value).length <= 500 &&
    !CONTROL_CHARACTER.test(value)
  );
}

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}
function input(formData: FormData): { operation: PlanOperation; version: string; reason: string } {
  const operation = field(formData, "operation");
  const version = field(formData, "expectedGrowthPlanVersion");
  const reason = field(formData, "reason");
  if (
    !OPERATIONS.includes(operation as PlanOperation) ||
    !VERSION.test(version) ||
    !validReason(reason)
  )
    throw new PlanInputError();
  return { operation: operation as PlanOperation, version, reason };
}
function capacityInput(formData: FormData): {
  proposedWeeklyCapacityMinutes: number;
  version: string;
  reason: string;
} {
  const proposedCapacity = field(formData, "proposedWeeklyCapacityMinutes");
  const version = field(formData, "expectedGrowthPlanVersion");
  const reason = field(formData, "reason");
  if (
    !CAPACITY.test(proposedCapacity) ||
    Number(proposedCapacity) > 10_080 ||
    !VERSION.test(version) ||
    !validReason(reason)
  ) {
    throw new PlanInputError();
  }
  return { proposedWeeklyCapacityMinutes: Number(proposedCapacity), version, reason };
}
function trackInput(formData: FormData): {
  trackKey: string;
  operation: TrackOperation;
  growthPlanVersion: string;
  learningTrackVersion: string;
  reason: string;
} {
  const trackKey = field(formData, "trackKey");
  const operation = field(formData, "operation");
  const growthPlanVersion = field(formData, "expectedGrowthPlanVersion");
  const learningTrackVersion = field(formData, "expectedLearningTrackVersion");
  const reason = field(formData, "reason");
  if (
    !TRACK_KEY.test(trackKey) ||
    !TRACK_OPERATIONS.includes(operation as TrackOperation) ||
    !VERSION.test(growthPlanVersion) ||
    !VERSION.test(learningTrackVersion) ||
    !validReason(reason)
  ) {
    throw new PlanInputError();
  }
  return {
    trackKey,
    operation: operation as TrackOperation,
    growthPlanVersion,
    learningTrackVersion,
    reason,
  };
}
function terminalTrackInput(formData: FormData): {
  trackKey: string;
  operation: LearningTrackTerminalLifecycleOperationV1;
  growthPlanVersion: string;
  learningTrackVersion: string;
  reason: string;
} {
  const trackKey = field(formData, "trackKey");
  const operation = field(formData, "operation");
  const growthPlanVersion = field(formData, "expectedGrowthPlanVersion");
  const learningTrackVersion = field(formData, "expectedLearningTrackVersion");
  const reason = field(formData, "reason");
  if (
    !TRACK_KEY.test(trackKey) ||
    !TERMINAL_TRACK_OPERATIONS.includes(operation as LearningTrackTerminalLifecycleOperationV1) ||
    !VERSION.test(growthPlanVersion) ||
    !VERSION.test(learningTrackVersion) ||
    !validReason(reason)
  ) {
    throw new PlanInputError();
  }
  return {
    trackKey,
    operation: operation as LearningTrackTerminalLifecycleOperationV1,
    growthPlanVersion,
    learningTrackVersion,
    reason,
  };
}
function trackPriorityMinimumInput(formData: FormData): {
  trackKey: string;
  priority: number;
  protectedMinimumMinutes: number;
  growthPlanVersion: string;
  learningTrackVersion: string;
  reason: string;
} {
  const trackKey = field(formData, "trackKey");
  const priority = field(formData, "priority");
  const protectedMinimumMinutes = field(formData, "protectedMinimumMinutes");
  const growthPlanVersion = field(formData, "expectedGrowthPlanVersion");
  const learningTrackVersion = field(formData, "expectedLearningTrackVersion");
  const reason = field(formData, "reason");
  if (
    !TRACK_KEY.test(trackKey) ||
    !PRIORITY.test(priority) ||
    Number(priority) > 100 ||
    !CAPACITY.test(protectedMinimumMinutes) ||
    Number(protectedMinimumMinutes) > 10_080 ||
    !VERSION.test(growthPlanVersion) ||
    !VERSION.test(learningTrackVersion) ||
    !validReason(reason)
  ) {
    throw new PlanInputError();
  }
  return {
    trackKey,
    priority: Number(priority),
    protectedMinimumMinutes: Number(protectedMinimumMinutes),
    growthPlanVersion,
    learningTrackVersion,
    reason,
  };
}

function trackCadenceInput(formData: FormData): {
  trackKey: string;
  cadencePerWeek: number;
  growthPlanVersion: string;
  learningTrackVersion: string;
  reason: string;
} {
  const trackKey = field(formData, "trackKey");
  const cadencePerWeek = field(formData, "cadencePerWeek");
  const growthPlanVersion = field(formData, "expectedGrowthPlanVersion");
  const learningTrackVersion = field(formData, "expectedLearningTrackVersion");
  const reason = field(formData, "reason");
  if (
    !TRACK_KEY.test(trackKey) ||
    !PRIORITY.test(cadencePerWeek) ||
    Number(cadencePerWeek) > 100 ||
    !VERSION.test(growthPlanVersion) ||
    !VERSION.test(learningTrackVersion) ||
    !validReason(reason)
  ) {
    throw new PlanInputError();
  }
  return {
    trackKey,
    cadencePerWeek: Number(cadencePerWeek),
    growthPlanVersion,
    learningTrackVersion,
    reason,
  };
}
function initializationInput(formData: FormData): {
  readinessGoalKey: string;
  expectedReadinessGoalVersion: string;
  weeklyCapacityMinutes: number;
  defaultSessionMinutes: number;
  trackPriority: number;
  reason: string;
  requestId: string;
} {
  const readinessGoalKey = field(formData, "readinessGoalKey");
  const expectedReadinessGoalVersion = field(formData, "expectedReadinessGoalVersion");
  const weeklyCapacityMinutes = field(formData, "weeklyCapacityMinutes");
  const defaultSessionMinutes = field(formData, "defaultSessionMinutes");
  const trackPriority = field(formData, "trackPriority");
  const reason = field(formData, "reason");
  const requestId = field(formData, "requestId");
  if (
    !GOAL_KEY.test(readinessGoalKey) ||
    !VERSION.test(expectedReadinessGoalVersion) ||
    !CAPACITY.test(weeklyCapacityMinutes) ||
    Number(weeklyCapacityMinutes) > 10_080 ||
    !CAPACITY.test(defaultSessionMinutes) ||
    Number(defaultSessionMinutes) < 1 ||
    Number(defaultSessionMinutes) > 480 ||
    !PRIORITY.test(trackPriority) ||
    Number(trackPriority) > 100 ||
    !UUID.test(requestId) ||
    requestId !== requestId.toLowerCase() ||
    !validReason(reason)
  ) {
    throw new PlanInputError();
  }
  return {
    readinessGoalKey,
    expectedReadinessGoalVersion,
    weeklyCapacityMinutes: Number(weeklyCapacityMinutes),
    defaultSessionMinutes: Number(defaultSessionMinutes),
    trackPriority: Number(trackPriority),
    reason,
    requestId,
  };
}

function replacementInput(formData: FormData): {
  readinessGoalKey: string;
  expectedReadinessGoalVersion: string;
  expectedGrowthPlanVersion: string;
  weeklyCapacityMinutes: number;
  defaultSessionMinutes: number;
  trackPriority: number;
  reason: string;
  requestId: string;
} {
  const expectedGrowthPlanVersion = field(formData, "expectedGrowthPlanVersion");
  if (!VERSION.test(expectedGrowthPlanVersion)) throw new PlanInputError();
  return { ...initializationInput(formData), expectedGrowthPlanVersion };
}

function learningTrackCreationInput(formData: FormData): {
  readinessGoalKey: string;
  expectedReadinessGoalVersion: string;
  title: string;
  priority: number;
  defaultSessionMinutes: number;
  expectedGrowthPlanVersion: string;
  reason: string;
  requestId: string;
} {
  const readinessGoalKey = field(formData, "readinessGoalKey");
  const expectedReadinessGoalVersion = field(formData, "expectedReadinessGoalVersion");
  const title = field(formData, "title");
  const priority = field(formData, "priority");
  const defaultSessionMinutes = field(formData, "defaultSessionMinutes");
  const expectedGrowthPlanVersion = field(formData, "expectedGrowthPlanVersion");
  const reason = field(formData, "reason");
  const requestId = field(formData, "requestId");
  if (
    !GOAL_KEY.test(readinessGoalKey) ||
    !VERSION.test(expectedReadinessGoalVersion) ||
    !validReason(title) ||
    Array.from(title).length > 160 ||
    !PRIORITY.test(priority) ||
    Number(priority) > 100 ||
    !CAPACITY.test(defaultSessionMinutes) ||
    Number(defaultSessionMinutes) < 1 ||
    Number(defaultSessionMinutes) > 480 ||
    !VERSION.test(expectedGrowthPlanVersion) ||
    !validReason(reason) ||
    !UUID.test(requestId) ||
    requestId !== requestId.toLowerCase()
  ) {
    throw new PlanInputError();
  }
  return {
    readinessGoalKey,
    expectedReadinessGoalVersion,
    title,
    priority: Number(priority),
    defaultSessionMinutes: Number(defaultSessionMinutes),
    expectedGrowthPlanVersion,
    reason,
    requestId,
  };
}

function activityAdmissionInput(formData: FormData): {
  trackKey: string | null;
  activityKey: string;
  estimatedMinutes: number;
  energy: "LOW" | "MEDIUM" | "HIGH" | null;
  growthPlanVersion: string;
  learningTrackVersion: string;
  reason: string;
  requestId: string;
} {
  const trackKeyInput = field(formData, "trackKey");
  const activityKey = field(formData, "activityKey");
  const estimatedMinutes = field(formData, "estimatedMinutes");
  const energyInput = field(formData, "energy");
  const growthPlanVersion = field(formData, "expectedGrowthPlanVersion");
  const learningTrackVersion = field(formData, "expectedLearningTrackVersion");
  const reason = field(formData, "reason");
  const requestId = field(formData, "requestId");
  const trackKey = trackKeyInput === "" ? null : trackKeyInput;
  const energy = energyInput === "" ? null : energyInput;
  if (
    (trackKey !== null && !TRACK_KEY.test(trackKey)) ||
    !ACTIVITY_KEY.test(activityKey) ||
    !/^[1-9][0-9]{0,2}$/u.test(estimatedMinutes) ||
    Number(estimatedMinutes) > 480 ||
    (energy !== null && !["LOW", "MEDIUM", "HIGH"].includes(energy)) ||
    !VERSION.test(growthPlanVersion) ||
    !VERSION.test(learningTrackVersion) ||
    !validReason(reason) ||
    !UUID.test(requestId) ||
    requestId !== requestId.toLowerCase()
  ) {
    throw new PlanInputError();
  }
  return {
    trackKey,
    activityKey,
    estimatedMinutes: Number(estimatedMinutes),
    energy: energy as "LOW" | "MEDIUM" | "HIGH" | null,
    growthPlanVersion,
    learningTrackVersion,
    reason,
    requestId,
  };
}
function availabilityWindowInput(formData: FormData): {
  operation: AvailabilityWindowOperationV1;
  windowKey: string | null;
  startsOn: string | null;
  endsOn: string | null;
  availableMinutes: number | null;
  energy: "LOW" | "MEDIUM" | "HIGH" | null;
  label: string | null;
  expectedGrowthPlanVersion: string;
  expectedWindowVersion: string | null;
  reason: string;
  requestId: string;
} {
  const operation = field(formData, "operation");
  const windowKeyInput = field(formData, "windowKey");
  const startsOnInput = field(formData, "startsOn");
  const endsOnInput = field(formData, "endsOn");
  const availableMinutesInput = field(formData, "availableMinutes");
  const energyInput = field(formData, "energy");
  const labelInput = field(formData, "label");
  const expectedGrowthPlanVersion = field(formData, "expectedGrowthPlanVersion");
  const expectedWindowVersionInput = field(formData, "expectedWindowVersion");
  const reason = field(formData, "reason");
  const requestId = field(formData, "requestId");
  const windowKey = windowKeyInput === "" ? null : windowKeyInput;
  const expectedWindowVersion =
    expectedWindowVersionInput === "" ? null : expectedWindowVersionInput;
  const energy = energyInput === "" ? null : energyInput;
  const label = labelInput === "" ? null : labelInput;

  if (
    !AVAILABILITY_OPERATIONS.includes(operation as AvailabilityWindowOperationV1) ||
    !VERSION.test(expectedGrowthPlanVersion) ||
    !validReason(reason) ||
    !UUID.test(requestId) ||
    requestId !== requestId.toLowerCase()
  ) {
    throw new PlanInputError();
  }
  if (operation === "create_availability_window") {
    if (windowKey !== null || expectedWindowVersion !== null) throw new PlanInputError();
  } else if (
    windowKey === null ||
    !WINDOW_KEY.test(windowKey) ||
    expectedWindowVersion === null ||
    !VERSION.test(expectedWindowVersion)
  ) {
    throw new PlanInputError();
  }
  if (operation === "remove_availability_window") {
    return {
      operation,
      windowKey,
      startsOn: null,
      endsOn: null,
      availableMinutes: null,
      energy: null,
      label: null,
      expectedGrowthPlanVersion,
      expectedWindowVersion,
      reason,
      requestId,
    };
  }
  if (
    !LOCAL_DATE.test(startsOnInput) ||
    !LOCAL_DATE.test(endsOnInput) ||
    !CAPACITY.test(availableMinutesInput) ||
    Number(availableMinutesInput) > 1440 ||
    (energy !== null && !["LOW", "MEDIUM", "HIGH"].includes(energy)) ||
    (label !== null && (!validReason(label) || Array.from(label).length > 120))
  ) {
    throw new PlanInputError();
  }
  return {
    operation: operation as AvailabilityWindowOperationV1,
    windowKey,
    startsOn: startsOnInput,
    endsOn: endsOnInput,
    availableMinutes: Number(availableMinutesInput),
    energy: energy as "LOW" | "MEDIUM" | "HIGH" | null,
    label,
    expectedGrowthPlanVersion,
    expectedWindowVersion,
    reason,
    requestId,
  };
}

function failure(error: unknown, invalidMessage?: string): PlanActionState {
  if (error instanceof PlanConflictError)
    return {
      ...initialPlanActionState,
      status: "conflict",
      message: "This plan changed elsewhere. Reload and create a fresh preview.",
    };
  if (error instanceof PlanInputError)
    return {
      ...initialPlanActionState,
      status: "invalid",
      message: invalidMessage ?? "Check the reason and try again. Nothing changed.",
    };
  return {
    ...initialPlanActionState,
    status: "unavailable",
    message: "PANDO could not change this plan. Nothing changed; try again.",
  };
}

export async function previewGrowthPlanReplacementAction(
  _previous: PlanActionState,
  formData: FormData,
): Promise<PlanActionState> {
  try {
    const value = replacementInput(formData);
    const client = await createPandoServerActionClient();
    await verifyPandoSession(client);
    const preview = await previewGrowthPlanReplacementV1(client, {
      readinessGoalKey: value.readinessGoalKey,
      expectedReadinessGoalVersion: value.expectedReadinessGoalVersion,
      expectedGrowthPlanVersion: value.expectedGrowthPlanVersion,
      weeklyCapacityMinutes: value.weeklyCapacityMinutes,
      defaultSessionMinutes: value.defaultSessionMinutes,
      trackPriority: value.trackPriority,
      reason: value.reason,
      idempotencyKey: value.requestId,
    });
    return {
      status: "previewed",
      message: preview.canApply
        ? "Replacement preview ready. Confirm only if these exact facts are correct."
        : "This replacement is no longer applicable. Reload the Plan and start again.",
      preview,
    };
  } catch (error) {
    return failure(
      error,
      "Choose a current readiness goal, use whole values in range, and enter a reason. Nothing changed.",
    );
  }
}

export async function applyGrowthPlanReplacementAction(
  _previous: PlanActionState,
  formData: FormData,
): Promise<PlanActionState> {
  try {
    const value = replacementInput(formData);
    const previewDigest = field(formData, "previewDigest");
    if (!/^[a-f0-9]{64}$/u.test(previewDigest)) throw new PlanInputError();
    const client = await createPandoServerActionClient();
    await verifyPandoSession(client);
    await applyGrowthPlanReplacementV1(client, {
      readinessGoalKey: value.readinessGoalKey,
      expectedReadinessGoalVersion: value.expectedReadinessGoalVersion,
      expectedGrowthPlanVersion: value.expectedGrowthPlanVersion,
      weeklyCapacityMinutes: value.weeklyCapacityMinutes,
      defaultSessionMinutes: value.defaultSessionMinutes,
      trackPriority: value.trackPriority,
      reason: value.reason,
      idempotencyKey: value.requestId,
      previewDigest,
    });
    revalidatePath("/plan");
    revalidatePath("/today");
    return {
      status: "applied",
      message:
        "Growth Plan replaced. The previous Plan is archived history; recalculation is pending.",
      preview: null,
    };
  } catch (error) {
    return failure(
      error,
      "Choose a current readiness goal, use whole values in range, and enter a reason. Nothing changed.",
    );
  }
}

export async function previewGrowthPlanInitializationAction(
  _previous: PlanActionState,
  formData: FormData,
): Promise<PlanActionState> {
  try {
    const value = initializationInput(formData);
    const client = await createPandoServerActionClient();
    await verifyPandoSession(client);
    const preview = await previewGrowthPlanInitializationV1(client, {
      readinessGoalKey: value.readinessGoalKey,
      expectedReadinessGoalVersion: value.expectedReadinessGoalVersion,
      weeklyCapacityMinutes: value.weeklyCapacityMinutes,
      defaultSessionMinutes: value.defaultSessionMinutes,
      trackPriority: value.trackPriority,
      reason: value.reason,
      idempotencyKey: value.requestId,
    });
    return {
      status: "previewed",
      message: preview.canApply
        ? "First Plan preview ready. Confirm only if these exact facts are correct."
        : "This first Growth Plan setup is no longer applicable. Reload and start again.",
      preview,
    };
  } catch (error) {
    return failure(
      error,
      "Choose a current readiness goal, use whole values in range, and enter a reason. Nothing changed.",
    );
  }
}

export async function applyGrowthPlanInitializationAction(
  _previous: PlanActionState,
  formData: FormData,
): Promise<PlanActionState> {
  try {
    const value = initializationInput(formData);
    const previewDigest = field(formData, "previewDigest");
    if (!/^[a-f0-9]{64}$/u.test(previewDigest)) throw new PlanInputError();
    const client = await createPandoServerActionClient();
    await verifyPandoSession(client);
    await applyGrowthPlanInitializationV1(client, {
      readinessGoalKey: value.readinessGoalKey,
      expectedReadinessGoalVersion: value.expectedReadinessGoalVersion,
      weeklyCapacityMinutes: value.weeklyCapacityMinutes,
      defaultSessionMinutes: value.defaultSessionMinutes,
      trackPriority: value.trackPriority,
      reason: value.reason,
      idempotencyKey: value.requestId,
      previewDigest,
    });
    revalidatePath("/plan");
    revalidatePath("/today");
    return {
      status: "applied",
      message:
        "Growth Plan created. Planning recalculation is pending; Today will update when it completes.",
      preview: null,
    };
  } catch (error) {
    return failure(
      error,
      "Choose a current readiness goal, use whole values in range, and enter a reason. Nothing changed.",
    );
  }
}

export async function previewLearningTrackCreationAction(
  _previous: PlanActionState,
  formData: FormData,
): Promise<PlanActionState> {
  try {
    const value = learningTrackCreationInput(formData);
    const client = await createPandoServerActionClient();
    await verifyPandoSession(client);
    const preview = await previewLearningTrackCreationV1(client, {
      readinessGoalKey: value.readinessGoalKey,
      expectedReadinessGoalVersion: value.expectedReadinessGoalVersion,
      title: value.title,
      priority: value.priority,
      defaultSessionMinutes: value.defaultSessionMinutes,
      expectedGrowthPlanVersion: value.expectedGrowthPlanVersion,
      reason: value.reason,
      requestId: value.requestId,
    });
    return {
      status: "previewed",
      message: preview.canApply
        ? "Track creation preview ready. Confirm only if these exact facts are correct."
        : "This additional Learning Track is no longer applicable. Reload and start again.",
      preview,
    };
  } catch (error) {
    return failure(
      error,
      "Choose a current target, enter a title, use whole values in range, and enter a reason. Nothing changed.",
    );
  }
}

export async function applyLearningTrackCreationAction(
  _previous: PlanActionState,
  formData: FormData,
): Promise<PlanActionState> {
  try {
    const value = learningTrackCreationInput(formData);
    const previewDigest = field(formData, "previewDigest");
    if (!/^[a-f0-9]{64}$/u.test(previewDigest)) throw new PlanInputError();
    const client = await createPandoServerActionClient();
    await verifyPandoSession(client);
    await applyLearningTrackCreationV1(client, {
      readinessGoalKey: value.readinessGoalKey,
      expectedReadinessGoalVersion: value.expectedReadinessGoalVersion,
      title: value.title,
      priority: value.priority,
      defaultSessionMinutes: value.defaultSessionMinutes,
      expectedGrowthPlanVersion: value.expectedGrowthPlanVersion,
      reason: value.reason,
      requestId: value.requestId,
      previewDigest,
    });
    revalidatePath("/plan");
    revalidatePath("/today");
    return {
      status: "applied",
      message:
        "Learning Track created. Planning recalculation is pending; Today will update when it completes.",
      preview: null,
    };
  } catch (error) {
    return failure(
      error,
      "Choose a current target, enter a title, use whole values in range, and enter a reason. Nothing changed.",
    );
  }
}

export async function previewGrowthPlanCapacityAction(
  _previous: PlanActionState,
  formData: FormData,
): Promise<PlanActionState> {
  try {
    const value = capacityInput(formData);
    const client = await createPandoServerActionClient();
    await verifyPandoSession(client);
    const preview = await previewGrowthPlanCapacityV1(client, {
      proposedWeeklyCapacityMinutes: value.proposedWeeklyCapacityMinutes,
      expectedGrowthPlanVersion: value.version,
      reason: value.reason,
    });
    return {
      status: "previewed",
      message: preview.canApply
        ? "Capacity preview ready. Confirm only if these exact facts are correct."
        : "This capacity conflicts with protected work. Review the required minimum.",
      preview,
    };
  } catch (error) {
    return failure(
      error,
      "Enter whole weekly minutes from 0 to 10080 and a reason. Nothing changed.",
    );
  }
}

export async function applyGrowthPlanCapacityAction(
  _previous: PlanActionState,
  formData: FormData,
): Promise<PlanActionState> {
  try {
    const value = capacityInput(formData);
    const digest = field(formData, "previewDigest");
    const requestIdValue = field(formData, "requestId");
    if (!/^[a-f0-9]{64}$/u.test(digest) || !UUID.test(requestIdValue)) throw new PlanInputError();
    const client = await createPandoServerActionClient();
    await verifyPandoSession(client);
    await applyGrowthPlanCapacityV1(client, {
      proposedWeeklyCapacityMinutes: value.proposedWeeklyCapacityMinutes,
      expectedGrowthPlanVersion: value.version,
      reason: value.reason,
      previewDigest: digest,
      idempotencyKey: `growth-plan-capacity:v1:${requestIdValue}`,
    });
    revalidatePath("/plan");
    revalidatePath("/today");
    return {
      status: "applied",
      message:
        "Weekly capacity changed. Planning recalculation is pending; Today will update when it completes.",
      preview: null,
    };
  } catch (error) {
    return failure(
      error,
      "Enter whole weekly minutes from 0 to 10080 and a reason. Nothing changed.",
    );
  }
}
export async function previewGrowthPlanLifecycleAction(
  _previous: PlanActionState,
  formData: FormData,
): Promise<PlanActionState> {
  try {
    const value = input(formData);
    const client = await createPandoServerActionClient();
    await verifyPandoSession(client);
    const preview = await previewGrowthPlanLifecycleV1(client, {
      operation: value.operation,
      expectedGrowthPlanVersion: value.version,
      reason: value.reason,
    });
    return {
      status: "previewed",
      message: "Preview ready. Confirm only if these exact facts are correct.",
      preview,
    };
  } catch (error) {
    return failure(error);
  }
}
export async function applyGrowthPlanLifecycleAction(
  _previous: PlanActionState,
  formData: FormData,
): Promise<PlanActionState> {
  try {
    const value = input(formData);
    const digest = field(formData, "previewDigest");
    const requestIdValue = field(formData, "requestId");
    if (!/^[a-f0-9]{64}$/u.test(digest) || !UUID.test(requestIdValue)) throw new PlanInputError();
    const client = await createPandoServerActionClient();
    await verifyPandoSession(client);
    await applyGrowthPlanLifecycleV1(client, {
      operation: value.operation,
      expectedGrowthPlanVersion: value.version,
      reason: value.reason,
      previewDigest: digest,
      idempotencyKey: `growth-plan-lifecycle:v1:${requestIdValue}`,
    });
    revalidatePath("/plan");
    revalidatePath("/today");
    return {
      status: "applied",
      message:
        "Plan changed. Planning recalculation is pending; Today will update when it completes.",
      preview: null,
    };
  } catch (error) {
    return failure(error);
  }
}

export async function previewLearningTrackLifecycleAction(
  _previous: PlanActionState,
  formData: FormData,
): Promise<PlanActionState> {
  try {
    const value = trackInput(formData);
    const client = await createPandoServerActionClient();
    await verifyPandoSession(client);
    const preview = await previewLearningTrackLifecycleV1(client, {
      trackKey: value.trackKey,
      operation: value.operation,
      expectedGrowthPlanVersion: value.growthPlanVersion,
      expectedLearningTrackVersion: value.learningTrackVersion,
      reason: value.reason,
    });
    return {
      status: "previewed",
      message: preview.canApply
        ? "Track preview ready. Confirm only if these exact facts are correct."
        : "This Track cannot be resumed within the current plan constraints.",
      preview,
    };
  } catch (error) {
    return failure(error, "Choose a current Track and enter a reason. Nothing changed.");
  }
}

export async function applyLearningTrackLifecycleAction(
  _previous: PlanActionState,
  formData: FormData,
): Promise<PlanActionState> {
  try {
    const value = trackInput(formData);
    const digest = field(formData, "previewDigest");
    const requestIdValue = field(formData, "requestId");
    if (!/^[a-f0-9]{64}$/u.test(digest) || !UUID.test(requestIdValue)) throw new PlanInputError();
    const client = await createPandoServerActionClient();
    await verifyPandoSession(client);
    await applyLearningTrackLifecycleV1(client, {
      trackKey: value.trackKey,
      operation: value.operation,
      expectedGrowthPlanVersion: value.growthPlanVersion,
      expectedLearningTrackVersion: value.learningTrackVersion,
      reason: value.reason,
      previewDigest: digest,
      idempotencyKey: `learning-track-lifecycle:v1:${requestIdValue}`,
    });
    revalidatePath("/plan");
    revalidatePath("/today");
    return {
      status: "applied",
      message:
        "Track changed. Planning recalculation is pending; Today will update when it completes.",
      preview: null,
    };
  } catch (error) {
    return failure(error, "Choose a current Track and enter a reason. Nothing changed.");
  }
}

export async function previewLearningTrackTerminalLifecycleAction(
  _previous: PlanActionState,
  formData: FormData,
): Promise<PlanActionState> {
  try {
    const value = terminalTrackInput(formData);
    const client = await createPandoServerActionClient();
    await verifyPandoSession(client);
    const preview = await previewLearningTrackTerminalLifecycleV1(client, {
      trackKey: value.trackKey,
      operation: value.operation,
      expectedGrowthPlanVersion: value.growthPlanVersion,
      expectedLearningTrackVersion: value.learningTrackVersion,
      reason: value.reason,
    });
    return {
      status: "previewed",
      message: "Terminal Track preview ready. Confirm only if these exact facts are correct.",
      preview,
    };
  } catch (error) {
    return failure(
      error,
      "Choose an available Track operation and enter a reason. Nothing changed.",
    );
  }
}

export async function applyLearningTrackTerminalLifecycleAction(
  _previous: PlanActionState,
  formData: FormData,
): Promise<PlanActionState> {
  try {
    const value = terminalTrackInput(formData);
    const digest = field(formData, "previewDigest");
    const requestIdValue = field(formData, "requestId");
    if (
      !/^[a-f0-9]{64}$/u.test(digest) ||
      !UUID.test(requestIdValue) ||
      requestIdValue !== requestIdValue.toLowerCase()
    ) {
      throw new PlanInputError();
    }
    const client = await createPandoServerActionClient();
    await verifyPandoSession(client);
    await applyLearningTrackTerminalLifecycleV1(client, {
      trackKey: value.trackKey,
      operation: value.operation,
      expectedGrowthPlanVersion: value.growthPlanVersion,
      expectedLearningTrackVersion: value.learningTrackVersion,
      reason: value.reason,
      previewDigest: digest,
      idempotencyKey: requestIdValue,
    });
    revalidatePath("/plan");
    revalidatePath("/today");
    return {
      status: "applied",
      message:
        "Track moved to terminal history. Planning recalculation is pending; Today will update when it completes.",
      preview: null,
    };
  } catch (error) {
    return failure(
      error,
      "Choose an available Track operation and enter a reason. Nothing changed.",
    );
  }
}

export async function previewLearningTrackPriorityMinimumAction(
  _previous: PlanActionState,
  formData: FormData,
): Promise<PlanActionState> {
  try {
    const value = trackPriorityMinimumInput(formData);
    const client = await createPandoServerActionClient();
    await verifyPandoSession(client);
    const preview = await previewLearningTrackPriorityMinimumV1(client, {
      trackKey: value.trackKey,
      priority: value.priority,
      protectedMinimumMinutes: value.protectedMinimumMinutes,
      expectedGrowthPlanVersion: value.growthPlanVersion,
      expectedLearningTrackVersion: value.learningTrackVersion,
      reason: value.reason,
    });
    return {
      status: "previewed",
      message: preview.canApply
        ? "Track settings preview ready. Confirm only if these exact facts are correct."
        : "These active Track settings exceed current weekly capacity.",
      preview,
    };
  } catch (error) {
    return failure(
      error,
      "Choose a current Track, use whole values in range, and enter a reason. Nothing changed.",
    );
  }
}

export async function applyLearningTrackPriorityMinimumAction(
  _previous: PlanActionState,
  formData: FormData,
): Promise<PlanActionState> {
  try {
    const value = trackPriorityMinimumInput(formData);
    const digest = field(formData, "previewDigest");
    const requestIdValue = field(formData, "requestId");
    if (!/^[a-f0-9]{64}$/u.test(digest) || !UUID.test(requestIdValue)) throw new PlanInputError();
    const client = await createPandoServerActionClient();
    await verifyPandoSession(client);
    await applyLearningTrackPriorityMinimumV1(client, {
      trackKey: value.trackKey,
      priority: value.priority,
      protectedMinimumMinutes: value.protectedMinimumMinutes,
      expectedGrowthPlanVersion: value.growthPlanVersion,
      expectedLearningTrackVersion: value.learningTrackVersion,
      reason: value.reason,
      previewDigest: digest,
      idempotencyKey: `learning-track-priority-minimum:v1:${requestIdValue}`,
    });
    revalidatePath("/plan");
    revalidatePath("/today");
    return {
      status: "applied",
      message:
        "Track settings changed. Planning recalculation is pending; Today will update when it completes.",
      preview: null,
    };
  } catch (error) {
    return failure(
      error,
      "Choose a current Track, use whole values in range, and enter a reason. Nothing changed.",
    );
  }
}

export async function previewLearningTrackCadenceAction(
  _previous: PlanActionState,
  formData: FormData,
): Promise<PlanActionState> {
  try {
    const value = trackCadenceInput(formData);
    const client = await createPandoServerActionClient();
    await verifyPandoSession(client);
    const preview = await previewLearningTrackCadenceV1(client, {
      trackKey: value.trackKey,
      cadencePerWeek: value.cadencePerWeek,
      expectedGrowthPlanVersion: value.growthPlanVersion,
      expectedLearningTrackVersion: value.learningTrackVersion,
      reason: value.reason,
    });
    return {
      status: "previewed",
      message: "Track cadence preview ready. Confirm only if these exact facts are correct.",
      preview,
    };
  } catch (error) {
    return failure(
      error,
      "Choose a current Track, use a whole cadence from 0 to 100, and enter a reason. Nothing changed.",
    );
  }
}

export async function applyLearningTrackCadenceAction(
  _previous: PlanActionState,
  formData: FormData,
): Promise<PlanActionState> {
  try {
    const value = trackCadenceInput(formData);
    const digest = field(formData, "previewDigest");
    const requestIdValue = field(formData, "requestId");
    if (!/^[a-f0-9]{64}$/u.test(digest) || !UUID.test(requestIdValue)) throw new PlanInputError();
    const client = await createPandoServerActionClient();
    await verifyPandoSession(client);
    await applyLearningTrackCadenceV1(client, {
      trackKey: value.trackKey,
      cadencePerWeek: value.cadencePerWeek,
      expectedGrowthPlanVersion: value.growthPlanVersion,
      expectedLearningTrackVersion: value.learningTrackVersion,
      reason: value.reason,
      previewDigest: digest,
      idempotencyKey: `learning-track-cadence:v1:${requestIdValue}`,
    });
    revalidatePath("/plan");
    revalidatePath("/today");
    return {
      status: "applied",
      message:
        "Track cadence changed. Planning recalculation is pending; Today will update when it completes.",
      preview: null,
    };
  } catch (error) {
    return failure(
      error,
      "Choose a current Track, use a whole cadence from 0 to 100, and enter a reason. Nothing changed.",
    );
  }
}

export async function previewLearningTrackActivityAdmissionAction(
  _previous: PlanActionState,
  formData: FormData,
): Promise<PlanActionState> {
  try {
    const value = activityAdmissionInput(formData);
    const client = await createPandoServerActionClient();
    await verifyPandoSession(client);
    const preview =
      value.trackKey === null
        ? await previewLearningTrackActivityAdmissionV1(client, {
            activityKey: value.activityKey,
            estimatedMinutes: value.estimatedMinutes,
            energy: value.energy,
            expectedGrowthPlanVersion: value.growthPlanVersion,
            expectedLearningTrackVersion: value.learningTrackVersion,
            reason: value.reason,
            requestId: value.requestId,
          })
        : await previewLearningTrackActivityAdmissionV2(client, {
            trackKey: value.trackKey,
            activityKey: value.activityKey,
            estimatedMinutes: value.estimatedMinutes,
            energy: value.energy,
            expectedGrowthPlanVersion: value.growthPlanVersion,
            expectedLearningTrackVersion: value.learningTrackVersion,
            reason: value.reason,
            requestId: value.requestId,
          });
    return {
      status: "previewed",
      message: preview.canApply
        ? "Activity preview ready. Confirm only if these exact facts are correct."
        : "This Growth Plan has reached its current activity limit.",
      preview,
    };
  } catch (error) {
    return failure(
      error,
      "Choose an available activity, use 1 to 480 whole minutes, and enter a reason. Nothing changed.",
    );
  }
}

export async function applyLearningTrackActivityAdmissionAction(
  _previous: PlanActionState,
  formData: FormData,
): Promise<PlanActionState> {
  try {
    const value = activityAdmissionInput(formData);
    const previewDigest = field(formData, "previewDigest");
    if (!/^[a-f0-9]{64}$/u.test(previewDigest)) throw new PlanInputError();
    const client = await createPandoServerActionClient();
    await verifyPandoSession(client);
    await (value.trackKey === null
      ? applyLearningTrackActivityAdmissionV1(client, {
          activityKey: value.activityKey,
          estimatedMinutes: value.estimatedMinutes,
          energy: value.energy,
          expectedGrowthPlanVersion: value.growthPlanVersion,
          expectedLearningTrackVersion: value.learningTrackVersion,
          reason: value.reason,
          requestId: value.requestId,
          previewDigest,
        })
      : applyLearningTrackActivityAdmissionV2(client, {
          trackKey: value.trackKey,
          activityKey: value.activityKey,
          estimatedMinutes: value.estimatedMinutes,
          energy: value.energy,
          expectedGrowthPlanVersion: value.growthPlanVersion,
          expectedLearningTrackVersion: value.learningTrackVersion,
          reason: value.reason,
          requestId: value.requestId,
          previewDigest,
        }));
    revalidatePath("/plan");
    revalidatePath("/today");
    return {
      status: "applied",
      message:
        "Activity added to the Track. Planning recalculation is pending; Today will update when it completes.",
      preview: null,
    };
  } catch (error) {
    return failure(
      error,
      "Choose an available activity, use 1 to 480 whole minutes, and enter a reason. Nothing changed.",
    );
  }
}

export async function previewAvailabilityWindowAction(
  _previous: PlanActionState,
  formData: FormData,
): Promise<PlanActionState> {
  try {
    const value = availabilityWindowInput(formData);
    const client = await createPandoServerActionClient();
    await verifyPandoSession(client);
    const preview = await previewAvailabilityWindowV1(client, {
      operation: value.operation,
      windowKey: value.windowKey,
      startsOn: value.startsOn,
      endsOn: value.endsOn,
      availableMinutes: value.availableMinutes,
      energy: value.energy,
      label: value.label,
      expectedGrowthPlanVersion: value.expectedGrowthPlanVersion,
      expectedWindowVersion: value.expectedWindowVersion,
      reason: value.reason,
      idempotencyKey: value.requestId,
    });
    return {
      status: "previewed",
      message: preview.canApply
        ? "Availability preview ready. Confirm only if these exact facts are correct."
        : "This availability change is no longer applicable. Reload and start again.",
      preview,
    };
  } catch (error) {
    return failure(
      error,
      "Choose valid local dates, whole minutes from 0 to 1440, and enter a reason. Nothing changed.",
    );
  }
}

export async function applyAvailabilityWindowAction(
  _previous: PlanActionState,
  formData: FormData,
): Promise<PlanActionState> {
  try {
    const value = availabilityWindowInput(formData);
    const previewDigest = field(formData, "previewDigest");
    if (!/^[a-f0-9]{64}$/u.test(previewDigest)) throw new PlanInputError();
    const client = await createPandoServerActionClient();
    await verifyPandoSession(client);
    await applyAvailabilityWindowV1(client, {
      operation: value.operation,
      windowKey: value.windowKey,
      startsOn: value.startsOn,
      endsOn: value.endsOn,
      availableMinutes: value.availableMinutes,
      energy: value.energy,
      label: value.label,
      expectedGrowthPlanVersion: value.expectedGrowthPlanVersion,
      expectedWindowVersion: value.expectedWindowVersion,
      reason: value.reason,
      idempotencyKey: value.requestId,
      previewDigest,
    });
    revalidatePath("/plan");
    revalidatePath("/today");
    return {
      status: "applied",
      message:
        "Availability changed. Planning recalculation is pending; Today will update when it completes.",
      preview: null,
    };
  } catch (error) {
    return failure(
      error,
      "Choose valid local dates, whole minutes from 0 to 1440, and enter a reason. Nothing changed.",
    );
  }
}
