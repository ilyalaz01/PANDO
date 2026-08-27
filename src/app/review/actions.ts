"use server";
import { revalidatePath } from "next/cache";
import { dispatchReviewItemProjectionIfConfigured } from "../../modules/review/application/dispatch-review-projection";
import { createPandoServerActionClient } from "../../shared/supabase/server";
import { verifyPandoSession } from "../../shared/supabase/session";
import { type ReviewActionState } from "../../ui/review/review-action-state";
import {
  applyReviewCommandV1,
  REVIEW_COMMAND_RPCS_V1,
  ReviewConflictError,
  ReviewInputError,
} from "../../ui/review/server/database-review-workspace";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const COMPETENCY_REF = /^competency:[a-z0-9][a-z0-9-]{1,100}$/u;
const NON_NEGATIVE_VERSION = /^(0|[1-9][0-9]{0,18})$/u;
const POSITIVE_VERSION = /^[1-9][0-9]{0,18}$/u;
const LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/u;
const DIMENSIONS = ["KNOWLEDGE", "RECALL", "APPLICATION", "INTERVIEW_EXECUTION"] as const;

function value(data: FormData, key: string): string {
  const item = data.get(key);
  return typeof item === "string" ? item : "";
}

function validateCommandFields(formData: FormData, intent: string): void {
  const projectionVersion = value(formData, "projectionVersion");
  if (!NON_NEGATIVE_VERSION.test(projectionVersion)) throw new ReviewInputError();

  if (intent === "reminder") {
    if (
      !COMPETENCY_REF.test(value(formData, "competencyRef")) ||
      !DIMENSIONS.includes(value(formData, "dimension") as (typeof DIMENSIONS)[number]) ||
      !LOCAL_DATE_TIME.test(value(formData, "localDueAt"))
    )
      throw new ReviewInputError();
    return;
  }

  if (
    !UUID.test(value(formData, "subjectId")) ||
    !UUID.test(value(formData, "reasonId")) ||
    !POSITIVE_VERSION.test(value(formData, "sourceRevision")) ||
    (intent === "reschedule" && !LOCAL_DATE_TIME.test(value(formData, "localDueAt")))
  )
    throw new ReviewInputError();
}

function fail(error: unknown): ReviewActionState {
  if (error instanceof ReviewConflictError)
    return {
      status: "conflict",
      message:
        "This review changed in another request. Your draft is still here; reload and review it.",
    };
  if (error instanceof ReviewInputError)
    return { status: "invalid", message: "Check this review action. Nothing was changed." };
  return {
    status: "unavailable",
    message: "PANDO could not apply this review action. Nothing was changed; try again.",
  };
}
export async function reviewAction(
  _previous: ReviewActionState,
  formData: FormData,
): Promise<ReviewActionState> {
  void _previous;
  try {
    const requestId = value(formData, "requestId");
    if (!UUID.test(requestId)) throw new ReviewInputError();
    const intent = value(formData, "intent");
    if (
      !(intent in { reminder: true, reschedule: true, skip: true, suppress: true, restore: true })
    )
      throw new ReviewInputError();
    validateCommandFields(formData, intent);
    const client = await createPandoServerActionClient();
    await verifyPandoSession(client);
    const fields = {
      p_subject_id: value(formData, "subjectId"),
      p_reason_id: value(formData, "reasonId"),
      p_expected_projection_version: value(formData, "projectionVersion"),
      p_expected_source_revision: value(formData, "sourceRevision"),
      p_competency_ref: value(formData, "competencyRef"),
      p_dimension: value(formData, "dimension"),
      p_expected_subject_version: value(formData, "projectionVersion"),
      p_local_due_at: value(formData, "localDueAt"),
      p_idempotency_key: `review-${intent}:v1:${requestId}`,
    };
    await applyReviewCommandV1(client, intent as keyof typeof REVIEW_COMMAND_RPCS_V1, fields);
    await dispatchReviewItemProjectionIfConfigured();
    revalidatePath("/review");
    return {
      status: "updated",
      message:
        intent === "reminder"
          ? "Personal reminder added."
          : intent === "suppress"
            ? "This reason is suppressed. Other reasons remain active."
            : intent === "restore"
              ? "This review reason was restored."
              : "Review schedule updated.",
    };
  } catch (error) {
    return fail(error);
  }
}
