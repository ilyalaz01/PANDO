import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apply: vi.fn(),
  createClient: vi.fn(),
  dispatch: vi.fn(),
  revalidate: vi.fn(),
  verifySession: vi.fn(),
}));
const classes = vi.hoisted(() => ({
  ReviewConflictError: class ReviewConflictError extends Error {},
  ReviewInputError: class ReviewInputError extends Error {},
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("../../shared/supabase/server", () => ({
  createPandoServerActionClient: mocks.createClient,
}));
vi.mock("../../shared/supabase/session", () => ({ verifyPandoSession: mocks.verifySession }));
vi.mock("../../modules/review/application/dispatch-review-projection", () => ({
  dispatchReviewItemProjectionIfConfigured: mocks.dispatch,
}));
vi.mock("../../ui/review/server/database-review-workspace", () => ({
  applyReviewCommandV1: mocks.apply,
  REVIEW_COMMAND_RPCS_V1: {
    reminder: "create_personal_review_reminder_v1",
    reschedule: "reschedule_review_reason_v1",
    skip: "skip_review_reason_once_v1",
    suppress: "suppress_review_reason_v1",
    restore: "restore_review_reason_v1",
  },
  ReviewConflictError: classes.ReviewConflictError,
  ReviewInputError: classes.ReviewInputError,
}));

import { initialReviewActionState } from "../../ui/review/review-action-state";
import { reviewAction } from "./actions";

const requestId = "10000000-0000-4000-8000-000000000001";
const subjectId = "20000000-0000-4000-8000-000000000001";
const reasonId = "30000000-0000-4000-8000-000000000001";
const client = { requestScoped: true };

function form(intent: string): FormData {
  const data = new FormData();
  data.set("requestId", requestId);
  data.set("intent", intent);
  data.set("subjectId", subjectId);
  data.set("reasonId", reasonId);
  data.set("projectionVersion", "4");
  data.set("sourceRevision", "2");
  data.set("competencyRef", "competency:python-error-handling");
  data.set("dimension", "APPLICATION");
  data.set("localDueAt", "2026-09-01T09:30");
  data.set("workspaceId", "attacker-selected-workspace");
  return data;
}

describe("Review Server Action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createClient.mockResolvedValue(client);
    mocks.verifySession.mockResolvedValue({ client, subject: "owner" });
    mocks.apply.mockResolvedValue(undefined);
    mocks.dispatch.mockResolvedValue({ configured: false, claimed: 0, completed: 0, retried: 0 });
  });

  it("applies an occurrence-fenced reschedule and wakes the fixed projection", async () => {
    await expect(reviewAction(initialReviewActionState, form("reschedule"))).resolves.toEqual({
      status: "updated",
      message: "Review schedule updated.",
    });
    expect(mocks.apply).toHaveBeenCalledWith(
      client,
      "reschedule",
      expect.objectContaining({
        p_subject_id: subjectId,
        p_reason_id: reasonId,
        p_expected_projection_version: "4",
        p_expected_source_revision: "2",
        p_local_due_at: "2026-09-01T09:30",
        p_idempotency_key: `review-reschedule:v1:${requestId}`,
      }),
    );
    expect(mocks.apply.mock.calls[0]?.[2]).not.toHaveProperty("p_workspace_id");
    expect(mocks.dispatch).toHaveBeenCalledTimes(1);
    expect(mocks.revalidate).toHaveBeenCalledWith("/review");
  });

  it("creates a reminder from a structured subject without accepting authority fields", async () => {
    await expect(reviewAction(initialReviewActionState, form("reminder"))).resolves.toMatchObject({
      status: "updated",
      message: "Personal reminder added.",
    });
    expect(mocks.apply).toHaveBeenCalledWith(
      client,
      "reminder",
      expect.objectContaining({
        p_competency_ref: "competency:python-error-handling",
        p_dimension: "APPLICATION",
        p_expected_subject_version: "4",
        p_local_due_at: "2026-09-01T09:30",
      }),
    );
  });

  it("rejects malformed input before creating a database client", async () => {
    const malformed = form("reschedule");
    malformed.set("subjectId", "another-workspace");
    await expect(reviewAction(initialReviewActionState, malformed)).resolves.toEqual({
      status: "invalid",
      message: "Check this review action. Nothing was changed.",
    });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("collapses conflicts and private failures into safe messages", async () => {
    mocks.apply.mockRejectedValueOnce(new classes.ReviewConflictError("private row version"));
    await expect(reviewAction(initialReviewActionState, form("skip"))).resolves.toMatchObject({
      status: "conflict",
    });

    mocks.verifySession.mockRejectedValueOnce(new Error("private token"));
    const unavailable = await reviewAction(initialReviewActionState, form("restore"));
    expect(unavailable).toEqual({
      status: "unavailable",
      message: "PANDO could not apply this review action. Nothing was changed; try again.",
    });
    expect(unavailable.message).not.toMatch(/token/iu);
  });
});
