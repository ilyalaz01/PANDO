"use server";

import { revalidatePath } from "next/cache";
import { createPandoServerActionClient } from "../../shared/supabase/server";
import { verifyPandoSession } from "../../shared/supabase/session";
import type { PlanActionState } from "../../ui/plan/plan-action-state";
import { initialPlanActionState } from "../../ui/plan/plan-action-state";
import type { PlanOperation } from "../../ui/plan/plan-types";
import {
  applyGrowthPlanLifecycleV1,
  previewGrowthPlanLifecycleV1,
  PlanConflictError,
  PlanInputError,
} from "../../ui/plan/server/database-plan";

const VERSION = /^[1-9][0-9]{0,18}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const OPERATIONS = ["pause_growth_plan", "resume_growth_plan"] as const;
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
    reason.trim() !== reason ||
    reason.length < 1 ||
    reason.length > 500
  )
    throw new PlanInputError();
  return { operation: operation as PlanOperation, version, reason };
}
function failure(error: unknown): PlanActionState {
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
      message: "Check the reason and try again. Nothing changed.",
    };
  return {
    ...initialPlanActionState,
    status: "unavailable",
    message: "PANDO could not change this plan. Nothing changed; try again.",
  };
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
