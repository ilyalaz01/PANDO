"use server";

import { revalidatePath } from "next/cache";
import { createPandoServerActionClient } from "../../shared/supabase/server";
import { verifyPandoSession } from "../../shared/supabase/session";
import type { CampaignActionState } from "../../ui/campaigns/campaign-action-state";
import { initialCampaignActionState } from "../../ui/campaigns/campaign-action-state";
import type {
  CampaignAllocationOverrideOperationV1,
  CampaignLifecycleCoordinationOperationV1,
  InterviewCampaignLifecycleOperationV1,
} from "../../ui/campaigns/campaign-types";
import {
  applyCampaignAllocationOverrideV1,
  applyCampaignLifecycleCoordinationV1,
  applyInterviewCampaignCreationV1,
  applyInterviewCampaignDeadlineChangeV1,
  applyInterviewCampaignLifecycleV1,
  applyInterviewCampaignRetargetV1,
  previewCampaignAllocationOverrideV1,
  previewCampaignLifecycleCoordinationV1,
  previewInterviewCampaignCreationV1,
  previewInterviewCampaignDeadlineChangeV1,
  previewInterviewCampaignLifecycleV1,
  previewInterviewCampaignRetargetV1,
  CampaignConflictError,
  CampaignInputError,
  type CampaignLifecycleCoordinationOverrideIntentV1,
} from "../../ui/campaigns/server/database-campaigns";

const VERSION = /^[1-9][0-9]{0,18}$/u;
const LOWERCASE_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CAMPAIGN_KEY =
  /^campaign:[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const OVERRIDE_KEY =
  /^override:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const TRACK_KEY = /^track:[a-z0-9][a-z0-9-]{1,100}$/u;
const GOAL_KEY = /^goal:[a-z0-9][a-z0-9-]{1,100}$/u;
const LOCAL_DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u;
const CONTROL_CHARACTER = /[\p{Cc}]/u;
const LIFECYCLE_OPERATIONS = ["start_campaign", "end_campaign", "cancel_campaign"] as const;
const OVERRIDE_OPERATIONS = [
  "change_campaign_allocation_override",
  "remove_campaign_allocation_override",
] as const;

function validReason(value: string): boolean {
  return (
    value.trim() === value &&
    Array.from(value).length >= 1 &&
    Array.from(value).length <= 500 &&
    !CONTROL_CHARACTER.test(value)
  );
}

function validTitle(value: string): boolean {
  return (
    value.trim() === value &&
    Array.from(value).length >= 1 &&
    Array.from(value).length <= 200 &&
    !CONTROL_CHARACTER.test(value)
  );
}

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function creationInput(formData: FormData): {
  readinessGoalKey: string;
  expectedReadinessGoalVersion: string;
  title: string;
  deadlineLocalDate: string;
  reason: string;
  requestId: string;
} {
  const readinessGoalKey = field(formData, "readinessGoalKey");
  const expectedReadinessGoalVersion = field(formData, "expectedReadinessGoalVersion");
  const title = field(formData, "title");
  const deadlineLocalDate = field(formData, "deadlineLocalDate");
  const reason = field(formData, "reason");
  const requestId = field(formData, "requestId");
  if (
    !GOAL_KEY.test(readinessGoalKey) ||
    !VERSION.test(expectedReadinessGoalVersion) ||
    !validTitle(title) ||
    !LOCAL_DATE.test(deadlineLocalDate) ||
    !validReason(reason) ||
    !LOWERCASE_UUID.test(requestId)
  ) {
    throw new CampaignInputError();
  }
  return {
    readinessGoalKey,
    expectedReadinessGoalVersion,
    title,
    deadlineLocalDate,
    reason,
    requestId,
  };
}

function deadlineInput(formData: FormData): {
  campaignKey: string;
  expectedCampaignVersion: string;
  deadlineLocalDate: string;
  reason: string;
} {
  const campaignKey = field(formData, "campaignKey");
  const expectedCampaignVersion = field(formData, "expectedCampaignVersion");
  const deadlineLocalDate = field(formData, "deadlineLocalDate");
  const reason = field(formData, "reason");
  if (
    !CAMPAIGN_KEY.test(campaignKey) ||
    !VERSION.test(expectedCampaignVersion) ||
    !LOCAL_DATE.test(deadlineLocalDate) ||
    !validReason(reason)
  ) {
    throw new CampaignInputError();
  }
  return { campaignKey, expectedCampaignVersion, deadlineLocalDate, reason };
}

function retargetInput(formData: FormData): {
  campaignKey: string;
  expectedCampaignVersion: string;
  readinessGoalKey: string;
  expectedReadinessGoalVersion: string;
  reason: string;
} {
  const campaignKey = field(formData, "campaignKey");
  const expectedCampaignVersion = field(formData, "expectedCampaignVersion");
  const readinessGoalKey = field(formData, "readinessGoalKey");
  const expectedReadinessGoalVersion = field(formData, "expectedReadinessGoalVersion");
  const reason = field(formData, "reason");
  if (
    !CAMPAIGN_KEY.test(campaignKey) ||
    !VERSION.test(expectedCampaignVersion) ||
    !GOAL_KEY.test(readinessGoalKey) ||
    !VERSION.test(expectedReadinessGoalVersion) ||
    !validReason(reason)
  ) {
    throw new CampaignInputError();
  }
  return {
    campaignKey,
    expectedCampaignVersion,
    readinessGoalKey,
    expectedReadinessGoalVersion,
    reason,
  };
}

function lifecycleInput(formData: FormData): {
  campaignKey: string;
  operation: InterviewCampaignLifecycleOperationV1;
  expectedCampaignVersion: string;
  reason: string;
} {
  const campaignKey = field(formData, "campaignKey");
  const operation = field(formData, "operation");
  const expectedCampaignVersion = field(formData, "expectedCampaignVersion");
  const reason = field(formData, "reason");
  if (
    !CAMPAIGN_KEY.test(campaignKey) ||
    !LIFECYCLE_OPERATIONS.includes(operation as InterviewCampaignLifecycleOperationV1) ||
    !VERSION.test(expectedCampaignVersion) ||
    !validReason(reason)
  ) {
    throw new CampaignInputError();
  }
  return {
    campaignKey,
    operation: operation as InterviewCampaignLifecycleOperationV1,
    expectedCampaignVersion,
    reason,
  };
}

function nullableIntegerField(
  formData: FormData,
  name: string,
  minimum: number,
  maximum: number,
): number | null {
  const raw = field(formData, name);
  if (raw === "") return null;
  if (!/^[0-9]+$/u.test(raw)) throw new CampaignInputError();
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new CampaignInputError();
  }
  return value;
}

function overrideChangeInput(formData: FormData): {
  overrideKey: string;
  operation: CampaignAllocationOverrideOperationV1;
  expectedOverrideVersion: string;
  priorityOverride: number | null;
  protectedMinimumMinutesOverride: number | null;
  cadencePerWeekOverride: number | null;
  reason: string;
} {
  const overrideKey = field(formData, "overrideKey");
  const operation = field(formData, "operation");
  const expectedOverrideVersion = field(formData, "expectedOverrideVersion");
  const reason = field(formData, "reason");
  if (
    !OVERRIDE_KEY.test(overrideKey) ||
    !OVERRIDE_OPERATIONS.includes(operation as CampaignAllocationOverrideOperationV1) ||
    !VERSION.test(expectedOverrideVersion) ||
    !validReason(reason)
  ) {
    throw new CampaignInputError();
  }
  return {
    overrideKey,
    operation: operation as CampaignAllocationOverrideOperationV1,
    expectedOverrideVersion,
    priorityOverride: nullableIntegerField(formData, "priorityOverride", 0, 100),
    protectedMinimumMinutesOverride: nullableIntegerField(
      formData,
      "protectedMinimumMinutesOverride",
      0,
      10_080,
    ),
    cadencePerWeekOverride: nullableIntegerField(formData, "cadencePerWeekOverride", 0, 100),
    reason,
  };
}

/** Reads at most one optional start-time override intent (ADR-0010 §5/§7). */
function overrideIntentInput(
  formData: FormData,
): readonly CampaignLifecycleCoordinationOverrideIntentV1[] {
  const trackKey = field(formData, "overrideTrackKey");
  if (trackKey === "") return [];
  const expectedTrackVersion = field(formData, "overrideExpectedTrackVersion");
  if (!TRACK_KEY.test(trackKey) || !VERSION.test(expectedTrackVersion)) {
    throw new CampaignInputError();
  }
  const priorityOverride = nullableIntegerField(formData, "overridePriorityOverride", 0, 100);
  const protectedMinimumMinutesOverride = nullableIntegerField(
    formData,
    "overrideProtectedMinimumMinutesOverride",
    0,
    10_080,
  );
  const cadencePerWeekOverride = nullableIntegerField(
    formData,
    "overrideCadencePerWeekOverride",
    0,
    100,
  );
  if (
    priorityOverride === null &&
    protectedMinimumMinutesOverride === null &&
    cadencePerWeekOverride === null
  ) {
    throw new CampaignInputError();
  }
  return [
    {
      trackKey,
      expectedTrackVersion,
      priorityOverride,
      protectedMinimumMinutesOverride,
      cadencePerWeekOverride,
    },
  ];
}

function coordinationInput(formData: FormData): {
  campaignKey: string;
  operation: CampaignLifecycleCoordinationOperationV1;
  expectedCampaignVersion: string;
  reason: string;
  idempotencyKey: string;
  overrides: readonly CampaignLifecycleCoordinationOverrideIntentV1[];
} {
  const campaignKey = field(formData, "campaignKey");
  const operation = field(formData, "operation");
  const expectedCampaignVersion = field(formData, "expectedCampaignVersion");
  const reason = field(formData, "reason");
  const requestId = field(formData, "requestId");
  if (
    !CAMPAIGN_KEY.test(campaignKey) ||
    !LIFECYCLE_OPERATIONS.includes(operation as CampaignLifecycleCoordinationOperationV1) ||
    !VERSION.test(expectedCampaignVersion) ||
    !validReason(reason) ||
    !LOWERCASE_UUID.test(requestId)
  ) {
    throw new CampaignInputError();
  }
  const overrides = operation === "start_campaign" ? overrideIntentInput(formData) : [];
  return {
    campaignKey,
    operation: operation as CampaignLifecycleCoordinationOperationV1,
    expectedCampaignVersion,
    reason,
    idempotencyKey: requestId,
    overrides,
  };
}

function failure(error: unknown, invalidMessage?: string): CampaignActionState {
  if (error instanceof CampaignConflictError) {
    return {
      ...initialCampaignActionState,
      status: "conflict",
      message: "This campaign changed elsewhere. Reload and create a fresh preview.",
    };
  }
  if (error instanceof CampaignInputError) {
    return {
      ...initialCampaignActionState,
      status: "invalid",
      message: invalidMessage ?? "Check the reason and try again. Nothing changed.",
    };
  }
  return {
    ...initialCampaignActionState,
    status: "unavailable",
    message: "PANDO could not change this Interview Campaign. Nothing changed; try again.",
  };
}

export async function previewInterviewCampaignCreationAction(
  _previous: CampaignActionState,
  formData: FormData,
): Promise<CampaignActionState> {
  try {
    const value = creationInput(formData);
    const client = await createPandoServerActionClient();
    await verifyPandoSession(client);
    const preview = await previewInterviewCampaignCreationV1(client, {
      readinessGoalKey: value.readinessGoalKey,
      expectedReadinessGoalVersion: value.expectedReadinessGoalVersion,
      title: value.title,
      deadlineLocalDate: value.deadlineLocalDate,
      reason: value.reason,
      idempotencyKey: value.requestId,
    });
    return {
      status: "previewed",
      message: preview.canApply
        ? "Draft preview ready. Confirm only if these exact facts are correct."
        : "This draft is no longer applicable. Reload and start again.",
      preview,
    };
  } catch (error) {
    return failure(
      error,
      "Choose a current readiness goal, a title, a future local date, and enter a reason. Nothing changed.",
    );
  }
}

export async function applyInterviewCampaignCreationAction(
  _previous: CampaignActionState,
  formData: FormData,
): Promise<CampaignActionState> {
  try {
    const value = creationInput(formData);
    const previewDigest = field(formData, "previewDigest");
    if (!/^[a-f0-9]{64}$/u.test(previewDigest)) throw new CampaignInputError();
    const client = await createPandoServerActionClient();
    await verifyPandoSession(client);
    await applyInterviewCampaignCreationV1(client, {
      readinessGoalKey: value.readinessGoalKey,
      expectedReadinessGoalVersion: value.expectedReadinessGoalVersion,
      title: value.title,
      deadlineLocalDate: value.deadlineLocalDate,
      reason: value.reason,
      idempotencyKey: value.requestId,
      previewDigest,
    });
    revalidatePath("/campaigns");
    return {
      status: "applied",
      message: "Interview Campaign drafted. Start it when you are ready to prepare actively.",
      preview: null,
    };
  } catch (error) {
    return failure(
      error,
      "Choose a current readiness goal, a title, a future local date, and enter a reason. Nothing changed.",
    );
  }
}

export async function previewInterviewCampaignDeadlineChangeAction(
  _previous: CampaignActionState,
  formData: FormData,
): Promise<CampaignActionState> {
  try {
    const value = deadlineInput(formData);
    const client = await createPandoServerActionClient();
    await verifyPandoSession(client);
    const preview = await previewInterviewCampaignDeadlineChangeV1(client, value);
    return {
      status: "previewed",
      message: "Deadline change preview ready. Confirm only if these exact facts are correct.",
      preview,
    };
  } catch (error) {
    return failure(error, "Choose a valid local date and enter a reason. Nothing changed.");
  }
}

export async function applyInterviewCampaignDeadlineChangeAction(
  _previous: CampaignActionState,
  formData: FormData,
): Promise<CampaignActionState> {
  try {
    const value = deadlineInput(formData);
    const previewDigest = field(formData, "previewDigest");
    const requestId = field(formData, "requestId");
    if (!/^[a-f0-9]{64}$/u.test(previewDigest) || !LOWERCASE_UUID.test(requestId)) {
      throw new CampaignInputError();
    }
    const client = await createPandoServerActionClient();
    await verifyPandoSession(client);
    await applyInterviewCampaignDeadlineChangeV1(client, {
      ...value,
      previewDigest,
      idempotencyKey: requestId,
    });
    revalidatePath("/campaigns");
    return {
      status: "applied",
      message: "Deadline changed.",
      preview: null,
    };
  } catch (error) {
    return failure(error, "Choose a valid local date and enter a reason. Nothing changed.");
  }
}

export async function previewInterviewCampaignRetargetAction(
  _previous: CampaignActionState,
  formData: FormData,
): Promise<CampaignActionState> {
  try {
    const value = retargetInput(formData);
    const client = await createPandoServerActionClient();
    await verifyPandoSession(client);
    const preview = await previewInterviewCampaignRetargetV1(client, value);
    return {
      status: "previewed",
      message: "Retarget preview ready. Confirm only if these exact facts are correct.",
      preview,
    };
  } catch (error) {
    return failure(
      error,
      "Choose a different current readiness goal and enter a reason. Nothing changed.",
    );
  }
}

export async function applyInterviewCampaignRetargetAction(
  _previous: CampaignActionState,
  formData: FormData,
): Promise<CampaignActionState> {
  try {
    const value = retargetInput(formData);
    const previewDigest = field(formData, "previewDigest");
    const requestId = field(formData, "requestId");
    if (!/^[a-f0-9]{64}$/u.test(previewDigest) || !LOWERCASE_UUID.test(requestId)) {
      throw new CampaignInputError();
    }
    const client = await createPandoServerActionClient();
    await verifyPandoSession(client);
    await applyInterviewCampaignRetargetV1(client, {
      ...value,
      previewDigest,
      idempotencyKey: requestId,
    });
    revalidatePath("/campaigns");
    return {
      status: "applied",
      message: "Interview Campaign retargeted. The previous goal keeps its own history.",
      preview: null,
    };
  } catch (error) {
    return failure(
      error,
      "Choose a different current readiness goal and enter a reason. Nothing changed.",
    );
  }
}

export async function previewInterviewCampaignLifecycleAction(
  _previous: CampaignActionState,
  formData: FormData,
): Promise<CampaignActionState> {
  try {
    const value = lifecycleInput(formData);
    const client = await createPandoServerActionClient();
    await verifyPandoSession(client);
    const preview = await previewInterviewCampaignLifecycleV1(client, value);
    return {
      status: "previewed",
      message: "Lifecycle change preview ready. Confirm only if these exact facts are correct.",
      preview,
    };
  } catch (error) {
    return failure(error, "Enter a reason and try again. Nothing changed.");
  }
}

export async function applyInterviewCampaignLifecycleAction(
  _previous: CampaignActionState,
  formData: FormData,
): Promise<CampaignActionState> {
  try {
    const value = lifecycleInput(formData);
    const previewDigest = field(formData, "previewDigest");
    const requestId = field(formData, "requestId");
    if (!/^[a-f0-9]{64}$/u.test(previewDigest) || !LOWERCASE_UUID.test(requestId)) {
      throw new CampaignInputError();
    }
    const client = await createPandoServerActionClient();
    await verifyPandoSession(client);
    await applyInterviewCampaignLifecycleV1(client, {
      ...value,
      previewDigest,
      idempotencyKey: requestId,
    });
    revalidatePath("/campaigns");
    return {
      status: "applied",
      message: "Interview Campaign lifecycle changed.",
      preview: null,
    };
  } catch (error) {
    return failure(error, "Enter a reason and try again. Nothing changed.");
  }
}

export async function previewCampaignAllocationOverrideAction(
  _previous: CampaignActionState,
  formData: FormData,
): Promise<CampaignActionState> {
  try {
    const value = overrideChangeInput(formData);
    const client = await createPandoServerActionClient();
    await verifyPandoSession(client);
    const preview = await previewCampaignAllocationOverrideV1(client, value);
    return {
      status: "previewed",
      message: preview.canApply
        ? "Override preview ready. Confirm only if these exact facts are correct."
        : "This override change is not applicable right now. Reload and try again.",
      preview,
    };
  } catch (error) {
    return failure(error, "Enter a reason and at least one field to change. Nothing changed.");
  }
}

export async function applyCampaignAllocationOverrideAction(
  _previous: CampaignActionState,
  formData: FormData,
): Promise<CampaignActionState> {
  try {
    const value = overrideChangeInput(formData);
    const previewDigest = field(formData, "previewDigest");
    const requestId = field(formData, "requestId");
    if (!/^[a-f0-9]{64}$/u.test(previewDigest) || !LOWERCASE_UUID.test(requestId)) {
      throw new CampaignInputError();
    }
    const client = await createPandoServerActionClient();
    await verifyPandoSession(client);
    await applyCampaignAllocationOverrideV1(client, {
      ...value,
      previewDigest,
      idempotencyKey: requestId,
    });
    revalidatePath("/campaigns");
    return {
      status: "applied",
      message:
        value.operation === "remove_campaign_allocation_override"
          ? "Allocation override removed."
          : "Allocation override changed.",
      preview: null,
    };
  } catch (error) {
    return failure(error, "Enter a reason and at least one field to change. Nothing changed.");
  }
}

export async function previewCampaignLifecycleCoordinationAction(
  _previous: CampaignActionState,
  formData: FormData,
): Promise<CampaignActionState> {
  try {
    const value = coordinationInput(formData);
    const client = await createPandoServerActionClient();
    await verifyPandoSession(client);
    const preview = await previewCampaignLifecycleCoordinationV1(client, value);
    return {
      status: "previewed",
      message: preview.canApply
        ? "Lifecycle change preview ready. Confirm only if these exact facts are correct."
        : "This lifecycle change is not applicable right now. Reload and try again.",
      preview,
    };
  } catch (error) {
    return failure(error, "Enter a reason and try again. Nothing changed.");
  }
}

export async function applyCampaignLifecycleCoordinationAction(
  _previous: CampaignActionState,
  formData: FormData,
): Promise<CampaignActionState> {
  try {
    const value = coordinationInput(formData);
    const previewDigest = field(formData, "previewDigest");
    if (!/^[a-f0-9]{64}$/u.test(previewDigest)) throw new CampaignInputError();
    const client = await createPandoServerActionClient();
    await verifyPandoSession(client);
    await applyCampaignLifecycleCoordinationV1(client, { ...value, previewDigest });
    revalidatePath("/campaigns");
    return {
      status: "applied",
      message: "Interview Campaign lifecycle changed.",
      preview: null,
    };
  } catch (error) {
    return failure(error, "Enter a reason and try again. Nothing changed.");
  }
}
