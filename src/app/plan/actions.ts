"use server";

import { revalidatePath } from "next/cache";
import { createPandoServerActionClient } from "../../shared/supabase/server";
import { verifyPandoSession } from "../../shared/supabase/session";
import type { PlanActionState } from "../../ui/plan/plan-action-state";
import { initialPlanActionState } from "../../ui/plan/plan-action-state";
import type { PlanOperation, TrackOperation } from "../../ui/plan/plan-types";
import {
  applyLearningTrackLifecycleV1,
  applyLearningTrackPriorityMinimumV1,
  applyGrowthPlanInitializationV1,
  applyGrowthPlanCapacityV1,
  applyGrowthPlanLifecycleV1,
  previewGrowthPlanCapacityV1,
  previewGrowthPlanLifecycleV1,
  previewLearningTrackLifecycleV1,
  previewLearningTrackPriorityMinimumV1,
  previewGrowthPlanInitializationV1,
  PlanConflictError,
  PlanInputError,
} from "../../ui/plan/server/database-plan";

const VERSION = /^[1-9][0-9]{0,18}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const OPERATIONS = ["pause_growth_plan", "resume_growth_plan"] as const;
const CAPACITY = /^(?:0|[1-9][0-9]{0,4})$/u;
const TRACK_KEY = /^track:[a-z0-9][a-z0-9-]{1,100}$/u;
const GOAL_KEY = /^goal:[a-z0-9][a-z0-9-]{1,100}$/u;
const TRACK_OPERATIONS = ["pause_track", "resume_track"] as const;
const PRIORITY = /^(?:0|[1-9][0-9]{0,2})$/u;
const CONTROL_CHARACTER = /[\p{Cc}]/u;

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
