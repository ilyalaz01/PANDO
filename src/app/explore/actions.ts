"use server";

import { createPandoServerActionClient } from "../../shared/supabase/server";
import { verifyPandoSession } from "../../shared/supabase/session";
import type { OverlayActionState } from "../../ui/explore/overlay-action-state";
import {
  addCurrentCustomActivityV1,
  CompetencyOverlayConflictError,
  CompetencyOverlayInputError,
  saveCurrentOverlayNoteV1,
} from "../../ui/explore/server/database-competency-overlay";
import { CUSTOM_ACTIVITY_TYPES } from "../../ui/explore/server/competency-overlay-detail-v1";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function stringValue(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function requestId(formData: FormData): string {
  const value = stringValue(formData, "requestId");
  if (!UUID.test(value)) throw new CompetencyOverlayInputError();
  return value.toLowerCase();
}

function failure(error: unknown): OverlayActionState {
  if (error instanceof CompetencyOverlayConflictError) {
    return {
      status: "conflict",
      message:
        "This plan changed in another request. Your draft is still here; review it and save again.",
    };
  }
  if (error instanceof CompetencyOverlayInputError) {
    return {
      status: "invalid",
      message: "Check the form and try again. Nothing was changed.",
    };
  }
  return {
    status: "unavailable",
    message: "PANDO could not apply this change. Nothing was changed; try again.",
  };
}

export async function saveCompetencyNoteAction(
  _previousState: OverlayActionState,
  formData: FormData,
): Promise<OverlayActionState> {
  void _previousState;
  try {
    const client = await createPandoServerActionClient();
    const session = await verifyPandoSession(client);
    const result = await saveCurrentOverlayNoteV1(session.client, {
      readinessGoalKey: stringValue(formData, "readinessGoalKey"),
      competencyRef: stringValue(formData, "competencyRef"),
      body: stringValue(formData, "body").trim(),
      expectedOverlayVersion: stringValue(formData, "expectedOverlayVersion"),
      idempotencyKey: `overlay-note:v1:${requestId(formData)}`,
    });
    return {
      status: "saved",
      message: "Note saved.",
      overlayVersion: result.overlayVersion,
    };
  } catch (error) {
    return failure(error);
  }
}

export async function addCompetencyActivityAction(
  _previousState: OverlayActionState,
  formData: FormData,
): Promise<OverlayActionState> {
  void _previousState;
  try {
    const id = requestId(formData);
    const activityType = stringValue(formData, "activityType");
    if (!(CUSTOM_ACTIVITY_TYPES as readonly string[]).includes(activityType)) {
      throw new CompetencyOverlayInputError();
    }
    const client = await createPandoServerActionClient();
    const session = await verifyPandoSession(client);
    const result = await addCurrentCustomActivityV1(session.client, {
      readinessGoalKey: stringValue(formData, "readinessGoalKey"),
      competencyRef: stringValue(formData, "competencyRef"),
      activityKey: `activity:custom-${id.replaceAll("-", "")}`,
      title: stringValue(formData, "title").trim(),
      activityType: activityType as (typeof CUSTOM_ACTIVITY_TYPES)[number],
      expectedOverlayVersion: stringValue(formData, "expectedOverlayVersion"),
      idempotencyKey: `overlay-activity:v1:${id}`,
    });
    return {
      status: "added",
      message: "Activity added to this competency.",
      overlayVersion: result.overlayVersion,
      activityKey: result.activityKey,
    };
  } catch (error) {
    return failure(error);
  }
}
