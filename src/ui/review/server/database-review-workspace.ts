import "server-only";
import type { PandoSupabaseClient } from "../../../shared/supabase/database";
import { decodeReviewWorkspaceV1, type ReviewWorkspaceV1 } from "./review-workspace-v1";

export const GET_REVIEW_WORKSPACE_RPC_V1 = "get_review_workspace_v1" as const;
export const REVIEW_COMMAND_RPCS_V1 = {
  reminder: "create_personal_review_reminder_v1",
  reschedule: "reschedule_review_reason_v1",
  skip: "skip_review_reason_once_v1",
  suppress: "suppress_review_reason_v1",
  restore: "restore_review_reason_v1",
} as const;
export class ReviewInputError extends Error {
  constructor() {
    super("The Review request is invalid.");
    this.name = "ReviewInputError";
  }
}
export class ReviewConflictError extends Error {
  constructor() {
    super("Review changed before this request completed.");
    this.name = "ReviewConflictError";
  }
}
export class ReviewUnavailableError extends Error {
  constructor() {
    super("Review is unavailable for the current session.");
    this.name = "ReviewUnavailableError";
  }
}
function errorCode(error: unknown): string | undefined {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : undefined;
}
function collapse(error: unknown): never {
  const code = errorCode(error);
  if (code === "40001" || code === "23505") throw new ReviewConflictError();
  if (code === "22023" || code === "22003" || code === "22P02") throw new ReviewInputError();
  throw new ReviewUnavailableError();
}
export async function loadReviewWorkspaceV1(
  client: PandoSupabaseClient,
): Promise<ReviewWorkspaceV1> {
  try {
    const result = (await client.rpc(GET_REVIEW_WORKSPACE_RPC_V1 as never, {} as never)) as {
      data: unknown;
      error: unknown | null;
    };
    if (result.error !== null) collapse(result.error);
    return decodeReviewWorkspaceV1(result.data);
  } catch (error) {
    if (
      error instanceof ReviewInputError ||
      error instanceof ReviewConflictError ||
      error instanceof ReviewUnavailableError
    )
      throw error;
    throw new ReviewUnavailableError();
  }
}
export async function applyReviewCommandV1(
  client: PandoSupabaseClient,
  name: keyof typeof REVIEW_COMMAND_RPCS_V1,
  values: Record<string, string>,
): Promise<void> {
  try {
    const common = {
      p_subject_id: values.p_subject_id,
      p_reason_id: values.p_reason_id,
      p_expected_projection_version: values.p_expected_projection_version,
      p_expected_source_revision: values.p_expected_source_revision,
      p_idempotency_key: values.p_idempotency_key,
    };
    const parameters =
      name === "reminder"
        ? {
            p_competency_ref: values.p_competency_ref,
            p_dimension: values.p_dimension,
            p_local_due_at: values.p_local_due_at,
            p_expected_subject_version: values.p_expected_subject_version,
            p_idempotency_key: values.p_idempotency_key,
          }
        : name === "reschedule"
          ? { ...common, p_local_due_at: values.p_local_due_at }
          : common;
    const result = (await client.rpc(
      REVIEW_COMMAND_RPCS_V1[name] as never,
      parameters as never,
    )) as {
      error: unknown | null;
    };
    if (result.error !== null) collapse(result.error);
  } catch (error) {
    if (
      error instanceof ReviewInputError ||
      error instanceof ReviewConflictError ||
      error instanceof ReviewUnavailableError
    )
      throw error;
    throw new ReviewUnavailableError();
  }
}
