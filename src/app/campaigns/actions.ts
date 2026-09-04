"use server";

import { revalidatePath } from "next/cache";
import { createPandoServerActionClient } from "../../shared/supabase/server";
import { verifyPandoSession } from "../../shared/supabase/session";
import type { CampaignActionState } from "../../ui/campaigns/campaign-action-state";
import { initialCampaignActionState } from "../../ui/campaigns/campaign-action-state";
import type { InterviewCampaignLifecycleOperationV1 } from "../../ui/campaigns/campaign-types";
import {
  applyInterviewCampaignCreationV1,
  applyInterviewCampaignDeadlineChangeV1,
  applyInterviewCampaignLifecycleV1,
  applyInterviewCampaignRetargetV1,
  previewInterviewCampaignCreationV1,
  previewInterviewCampaignDeadlineChangeV1,
  previewInterviewCampaignLifecycleV1,
  previewInterviewCampaignRetargetV1,
  CampaignConflictError,
  CampaignInputError,
} from "../../ui/campaigns/server/database-campaigns";

const VERSION = /^[1-9][0-9]{0,18}$/u;
const LOWERCASE_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CAMPAIGN_KEY =
  /^campaign:[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const GOAL_KEY = /^goal:[a-z0-9][a-z0-9-]{1,100}$/u;
const LOCAL_DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u;
const CONTROL_CHARACTER = /[\p{Cc}]/u;
const LIFECYCLE_OPERATIONS = ["start_campaign", "end_campaign", "cancel_campaign"] as const;

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
