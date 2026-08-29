import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  verifySession: vi.fn(),
  start: vi.fn(),
  startPlan: vi.fn(),
  finish: vi.fn(),
  invalidate: vi.fn(),
  dispatch: vi.fn(),
  dispatchReview: vi.fn(),
  dispatchReadiness: vi.fn(),
  revalidate: vi.fn(),
  redirect: vi.fn(),
}));
const classes = vi.hoisted(() => ({
  FocusConflictError: class FocusConflictError extends Error {},
  FocusInputError: class FocusInputError extends Error {},
  TodayConflictError: class TodayConflictError extends Error {},
  TodayInputError: class TodayInputError extends Error {},
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
  RedirectType: { replace: "replace" },
}));
vi.mock("../../shared/supabase/server", () => ({
  createPandoServerActionClient: mocks.createClient,
}));
vi.mock("../../shared/supabase/session", () => ({ verifyPandoSession: mocks.verifySession }));
vi.mock("../../modules/mastery/application/dispatch-evidence-projection", () => ({
  dispatchMasteryEvidenceProjectionIfConfigured: mocks.dispatch,
}));
vi.mock("../../modules/review/application/dispatch-review-projection", () => ({
  dispatchReviewItemProjectionIfConfigured: mocks.dispatchReview,
}));
vi.mock("../../modules/targets/application/dispatch-target-readiness-projection", () => ({
  dispatchTargetReadinessProjectionIfConfigured: mocks.dispatchReadiness,
}));
vi.mock("../../ui/focus/server/database-focus-workspace", () => ({
  startFocusActivityV1: mocks.start,
  finishFocusActivityV1: mocks.finish,
  invalidateEvidenceV1: mocks.invalidate,
  FocusConflictError: classes.FocusConflictError,
  FocusInputError: classes.FocusInputError,
}));
vi.mock("../../ui/today/server/database-today-workspace", () => ({
  startFocusFromPlanV1: mocks.startPlan,
  TodayConflictError: classes.TodayConflictError,
  TodayInputError: classes.TodayInputError,
}));

import { initialFocusActionState } from "../../ui/focus/focus-action-state";
import {
  completeFocusAction,
  invalidateEvidenceAction,
  startFocusAction,
  startFocusFromPlanAction,
  stopFocusAction,
} from "./actions";

const requestId = "10000000-0000-4000-8000-000000000001";
const sessionId = "20000000-0000-4000-8000-000000000001";
const evidenceId = "30000000-0000-4000-8000-000000000001";
const client = { requestScoped: true };

function baseForm(): FormData {
  const form = new FormData();
  form.set("requestId", requestId);
  form.set("readinessGoalKey", "goal:personal-main");
  form.set("activityKey", "activity:typing-practice");
  form.set("plannedMinutes", "25");
  form.set("focusSessionId", sessionId);
  form.set("expectedVersion", "1");
  form.set("resultKind", "OBSERVED_SUCCESS");
  form.set("workspaceId", "attacker-workspace");
  form.set("mappingConfidence", "999");
  form.set("sourceReliability", "999");
  return form;
}

describe("Focus Server Actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createClient.mockResolvedValue(client);
    mocks.verifySession.mockResolvedValue({ client, subject: "owner" });
    mocks.start.mockResolvedValue({ state: "active" });
    mocks.startPlan.mockResolvedValue({ state: "active" });
    mocks.finish.mockResolvedValue({ state: "completed", evidenceId, projectionState: "pending" });
    mocks.invalidate.mockResolvedValue({ evidenceId, projectionState: "pending" });
    mocks.dispatch.mockResolvedValue({ configured: false, claimed: 0, completed: 0, retried: 0 });
    mocks.dispatchReview.mockResolvedValue({
      configured: false,
      claimed: 0,
      completed: 0,
      retried: 0,
    });
    mocks.dispatchReadiness.mockResolvedValue({
      configured: false,
      claimed: 0,
      completed: 0,
      retried: 0,
    });
  });

  it("starts only with goal, activity, bounded duration, and a derived idempotency key", async () => {
    await expect(startFocusAction(initialFocusActionState, baseForm())).resolves.toEqual({
      status: "updated",
      message: "Focus session started.",
    });
    expect(mocks.start).toHaveBeenCalledWith(client, {
      readinessGoalKey: "goal:personal-main",
      activityKey: "activity:typing-practice",
      plannedMinutes: 25,
      idempotencyKey: `focus-start:v1:${requestId}`,
    });
    const command = mocks.start.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(command).not.toHaveProperty("workspaceId");
    expect(command).not.toHaveProperty("mappingConfidence");
    expect(mocks.revalidate).toHaveBeenCalledWith("/focus");
  });

  it("starts a Today action with a selector-stable key and redirects without returning command data", async () => {
    const form = baseForm();
    form.set("selectionRef", "plan-action:40000000-0000-4000-8000-000000000001");
    await expect(startFocusFromPlanAction(initialFocusActionState, form)).resolves.toBeUndefined();
    expect(mocks.startPlan).toHaveBeenCalledWith(client, {
      selectionRef: "plan-action:40000000-0000-4000-8000-000000000001",
      idempotencyKey: "today-focus-start:v1:40000000-0000-4000-8000-000000000001",
    });
    const command = mocks.startPlan.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(command).not.toHaveProperty("readinessGoalKey");
    expect(command).not.toHaveProperty("activityKey");
    expect(command).not.toHaveProperty("plannedMinutes");
    expect(mocks.revalidate).toHaveBeenCalledWith("/today");
    expect(mocks.redirect).toHaveBeenCalledWith(
      "/focus?selection=plan-action%3A40000000-0000-4000-8000-000000000001",
      "replace",
    );
  });

  it("does not redirect when the Today selector is stale", async () => {
    mocks.startPlan.mockRejectedValueOnce(new classes.TodayConflictError("private"));
    const form = new FormData();
    form.set("selectionRef", "plan-action:40000000-0000-4000-8000-000000000001");
    await expect(startFocusFromPlanAction(initialFocusActionState, form)).resolves.toMatchObject({
      status: "conflict",
    });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("completes with explicit outcome facts and attempts a bounded projection dispatch", async () => {
    const form = baseForm();
    form.set("usedHint", "on");
    await expect(completeFocusAction(initialFocusActionState, form)).resolves.toEqual({
      status: "updated",
      message: "Result saved. Competency state is recalculating.",
    });
    expect(mocks.finish).toHaveBeenCalledWith(client, {
      focusSessionId: sessionId,
      expectedVersion: 1,
      terminalAction: "COMPLETE",
      resultKind: "OBSERVED_SUCCESS",
      usedHint: true,
      idempotencyKey: `focus-finish:v1:${requestId}`,
    });
    expect(mocks.dispatch).toHaveBeenCalledTimes(1);
    expect(mocks.dispatchReview).toHaveBeenCalledTimes(1);
    expect(mocks.dispatchReadiness).toHaveBeenCalledTimes(1);
    expect(mocks.revalidate).toHaveBeenCalledWith("/explore");
    expect(mocks.revalidate).toHaveBeenCalledWith("/today");
  });

  it("returns a completed planned session to Today before its selector becomes stale", async () => {
    const form = baseForm();
    form.set("returnToToday", "true");

    await expect(completeFocusAction(initialFocusActionState, form)).resolves.toBeUndefined();

    expect(mocks.finish).toHaveBeenCalledTimes(1);
    expect(mocks.redirect).toHaveBeenCalledWith("/today", "replace");
  });

  it("keeps completion-only and stop outside evidence projection", async () => {
    mocks.finish.mockResolvedValueOnce({
      state: "completed",
      evidenceId: null,
      projectionState: "not_applicable",
    });
    const completion = baseForm();
    completion.set("resultKind", "COMPLETION_ONLY");
    await expect(completeFocusAction(initialFocusActionState, completion)).resolves.toMatchObject({
      message: "Completion saved without evidence.",
    });
    expect(mocks.dispatch).not.toHaveBeenCalled();
    expect(mocks.dispatchReview).not.toHaveBeenCalled();
    expect(mocks.dispatchReadiness).not.toHaveBeenCalled();

    mocks.finish.mockResolvedValueOnce({ state: "stopped", evidenceId: null });
    await expect(stopFocusAction(initialFocusActionState, baseForm())).resolves.toEqual({
      status: "updated",
      message: "Focus session stopped. No evidence was added.",
    });
    expect(mocks.finish).toHaveBeenLastCalledWith(
      client,
      expect.objectContaining({ terminalAction: "STOP", resultKind: null, usedHint: null }),
    );
    expect(mocks.revalidate).toHaveBeenCalledWith("/today");
  });

  it("invalidates through an exact evidence identifier and trimmed bounded reason", async () => {
    const form = baseForm();
    form.set("evidenceId", evidenceId);
    form.set("reason", "  The result was recorded incorrectly.  ");
    await expect(invalidateEvidenceAction(initialFocusActionState, form)).resolves.toMatchObject({
      status: "updated",
      message: expect.stringContaining("original remains in history"),
    });
    expect(mocks.invalidate).toHaveBeenCalledWith(client, {
      evidenceId,
      reason: "The result was recorded incorrectly.",
      idempotencyKey: `evidence-invalidate:v1:${requestId}`,
    });
    expect(mocks.dispatch).toHaveBeenCalledTimes(1);
    expect(mocks.dispatchReview).toHaveBeenCalledTimes(1);
    expect(mocks.dispatchReadiness).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed action input and collapses private errors", async () => {
    const malformed = baseForm();
    malformed.set("requestId", "bad");
    await expect(startFocusAction(initialFocusActionState, malformed)).resolves.toEqual({
      status: "invalid",
      message: "Check this form. Nothing was changed.",
    });
    expect(mocks.createClient).not.toHaveBeenCalled();

    mocks.start.mockRejectedValueOnce(new classes.FocusConflictError("private conflict"));
    await expect(startFocusAction(initialFocusActionState, baseForm())).resolves.toMatchObject({
      status: "conflict",
    });
    mocks.verifySession.mockRejectedValueOnce(new Error("private token"));
    const unavailable = await stopFocusAction(initialFocusActionState, baseForm());
    expect(unavailable).toEqual({
      status: "unavailable",
      message: "PANDO could not apply this Focus change. Nothing was lost; try again.",
    });
    expect(unavailable.message).not.toMatch(/token/iu);
  });
});
