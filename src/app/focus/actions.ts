"use server";

import { revalidatePath } from "next/cache";

import { dispatchMasteryEvidenceProjectionIfConfigured } from "../../modules/mastery/application/dispatch-evidence-projection";
import { createPandoServerActionClient } from "../../shared/supabase/server";
import { verifyPandoSession } from "../../shared/supabase/session";
import type { FocusActionState } from "../../ui/focus/focus-action-state";
import {
  FocusConflictError,
  FocusInputError,
  finishFocusActivityV1,
  invalidateEvidenceV1,
  startFocusActivityV1,
} from "../../ui/focus/server/database-focus-workspace";
import { FOCUS_RESULT_KINDS, type FocusResultKind } from "../../ui/focus/server/focus-workspace-v1";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function stringValue(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function requestId(formData: FormData): string {
  const value = stringValue(formData, "requestId");
  if (!UUID.test(value)) throw new FocusInputError();
  return value.toLowerCase();
}

function failure(error: unknown): FocusActionState {
  if (error instanceof FocusConflictError) {
    return {
      status: "conflict",
      message: "Focus changed in another request. Your draft is still here; reload and review it.",
    };
  }
  if (error instanceof FocusInputError) {
    return { status: "invalid", message: "Check this form. Nothing was changed." };
  }
  return {
    status: "unavailable",
    message: "PANDO could not apply this Focus change. Nothing was lost; try again.",
  };
}

export async function startFocusAction(
  _previousState: FocusActionState,
  formData: FormData,
): Promise<FocusActionState> {
  void _previousState;
  try {
    const commandRequestId = requestId(formData);
    const plannedMinutes = Number(stringValue(formData, "plannedMinutes"));
    const client = await createPandoServerActionClient();
    const session = await verifyPandoSession(client);
    await startFocusActivityV1(session.client, {
      readinessGoalKey: stringValue(formData, "readinessGoalKey"),
      activityKey: stringValue(formData, "activityKey"),
      plannedMinutes,
      idempotencyKey: `focus-start:v1:${commandRequestId}`,
    });
    revalidatePath("/focus");
    return { status: "updated", message: "Focus session started." };
  } catch (error) {
    return failure(error);
  }
}

export async function completeFocusAction(
  _previousState: FocusActionState,
  formData: FormData,
): Promise<FocusActionState> {
  void _previousState;
  try {
    const commandRequestId = requestId(formData);
    const resultKind = stringValue(formData, "resultKind");
    if (!(FOCUS_RESULT_KINDS as readonly string[]).includes(resultKind)) {
      throw new FocusInputError();
    }
    const client = await createPandoServerActionClient();
    const session = await verifyPandoSession(client);
    const result = await finishFocusActivityV1(session.client, {
      focusSessionId: stringValue(formData, "focusSessionId"),
      expectedVersion: Number(stringValue(formData, "expectedVersion")),
      terminalAction: "COMPLETE",
      resultKind: resultKind as FocusResultKind,
      usedHint: formData.get("usedHint") === "on",
      idempotencyKey: `focus-finish:v1:${commandRequestId}`,
    });
    if (result.evidenceId !== null && result.evidenceId !== undefined) {
      await dispatchMasteryEvidenceProjectionIfConfigured();
    }
    revalidatePath("/focus");
    return {
      status: "updated",
      message:
        result.evidenceId === null
          ? "Completion saved without evidence."
          : "Result saved. Competency state is recalculating.",
    };
  } catch (error) {
    return failure(error);
  }
}

export async function stopFocusAction(
  _previousState: FocusActionState,
  formData: FormData,
): Promise<FocusActionState> {
  void _previousState;
  try {
    const commandRequestId = requestId(formData);
    const client = await createPandoServerActionClient();
    const session = await verifyPandoSession(client);
    await finishFocusActivityV1(session.client, {
      focusSessionId: stringValue(formData, "focusSessionId"),
      expectedVersion: Number(stringValue(formData, "expectedVersion")),
      terminalAction: "STOP",
      resultKind: null,
      usedHint: null,
      idempotencyKey: `focus-stop:v1:${commandRequestId}`,
    });
    revalidatePath("/focus");
    return { status: "updated", message: "Focus session stopped. No evidence was added." };
  } catch (error) {
    return failure(error);
  }
}

export async function invalidateEvidenceAction(
  _previousState: FocusActionState,
  formData: FormData,
): Promise<FocusActionState> {
  void _previousState;
  try {
    const commandRequestId = requestId(formData);
    const client = await createPandoServerActionClient();
    const session = await verifyPandoSession(client);
    await invalidateEvidenceV1(session.client, {
      evidenceId: stringValue(formData, "evidenceId"),
      reason: stringValue(formData, "reason").trim(),
      idempotencyKey: `evidence-invalidate:v1:${commandRequestId}`,
    });
    await dispatchMasteryEvidenceProjectionIfConfigured();
    revalidatePath("/focus");
    return {
      status: "updated",
      message: "Evidence invalidated. The original remains in history while mastery recalculates.",
    };
  } catch (error) {
    return failure(error);
  }
}
