import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  verifySession: vi.fn(),
  saveNote: vi.fn(),
  addActivity: vi.fn(),
}));
const classes = vi.hoisted(() => ({
  CompetencyOverlayConflictError: class CompetencyOverlayConflictError extends Error {},
  CompetencyOverlayInputError: class CompetencyOverlayInputError extends Error {},
}));

vi.mock("../../shared/supabase/server", () => ({
  createPandoServerActionClient: mocks.createClient,
}));
vi.mock("../../shared/supabase/session", () => ({ verifyPandoSession: mocks.verifySession }));
vi.mock("../../ui/explore/server/database-competency-overlay", () => ({
  saveCurrentOverlayNoteV1: mocks.saveNote,
  addCurrentCustomActivityV1: mocks.addActivity,
  CompetencyOverlayConflictError: classes.CompetencyOverlayConflictError,
  CompetencyOverlayInputError: classes.CompetencyOverlayInputError,
}));
vi.mock("../../ui/explore/server/competency-overlay-detail-v1", () => ({
  CUSTOM_ACTIVITY_TYPES: ["MANUAL_CODING", "READING", "EXPLANATION", "MOCK", "PROJECT"],
}));

import { initialOverlayActionState } from "../../ui/explore/overlay-action-state";
import { addCompetencyActivityAction, saveCompetencyNoteAction } from "./actions";

const requestId = "10000000-0000-4000-8000-000000000001";
const client = { requestScoped: true };

function noteForm(): FormData {
  const form = new FormData();
  form.set("requestId", requestId);
  form.set("readinessGoalKey", "goal:personal-main");
  form.set("competencyRef", "competency:python-testing");
  form.set("body", "  Review failure modes.  ");
  form.set("expectedOverlayVersion", "7");
  // These hostile extra fields must never enter the domain command.
  form.set("workspaceId", "foreign-workspace");
  form.set("profileVersionKey", "target:foreign-profile");
  return form;
}

function activityForm(): FormData {
  const form = noteForm();
  form.set("title", "  Write one property test  ");
  form.set("activityType", "MANUAL_CODING");
  return form;
}

describe("Explore competency-overlay Server Actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createClient.mockResolvedValue(client);
    mocks.verifySession.mockResolvedValue({ client, subject: "owner-subject" });
    mocks.saveNote.mockResolvedValue({ overlayVersion: "8" });
    mocks.addActivity.mockResolvedValue({
      overlayVersion: "8",
      activityKey: "activity:custom-10000000000040008000000000000001",
    });
  });

  it("verifies the session and forwards no workspace or profile selector when saving a note", async () => {
    await expect(saveCompetencyNoteAction(initialOverlayActionState, noteForm())).resolves.toEqual({
      status: "saved",
      message: "Note saved.",
      overlayVersion: "8",
    });
    expect(mocks.verifySession).toHaveBeenCalledWith(client);
    expect(mocks.saveNote).toHaveBeenCalledWith(client, {
      readinessGoalKey: "goal:personal-main",
      competencyRef: "competency:python-testing",
      body: "Review failure modes.",
      expectedOverlayVersion: "7",
      idempotencyKey: `overlay-note:v1:${requestId}`,
    });
    const command = mocks.saveNote.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(command).not.toHaveProperty("workspaceId");
    expect(command).not.toHaveProperty("profileVersionKey");
  });

  it("derives fixed activity and idempotency keys from the submitted request id", async () => {
    await expect(
      addCompetencyActivityAction(initialOverlayActionState, activityForm()),
    ).resolves.toEqual({
      status: "added",
      message: "Activity added to this competency.",
      overlayVersion: "8",
      activityKey: "activity:custom-10000000000040008000000000000001",
    });
    expect(mocks.addActivity).toHaveBeenCalledWith(client, {
      readinessGoalKey: "goal:personal-main",
      competencyRef: "competency:python-testing",
      activityKey: "activity:custom-10000000000040008000000000000001",
      title: "Write one property test",
      activityType: "MANUAL_CODING",
      expectedOverlayVersion: "7",
      idempotencyKey: `overlay-activity:v1:${requestId}`,
    });
  });

  it("rejects malformed action input before any authenticated command can run", async () => {
    const form = activityForm();
    form.set("requestId", "not-a-uuid");
    await expect(addCompetencyActivityAction(initialOverlayActionState, form)).resolves.toEqual({
      status: "invalid",
      message: "Check the form and try again. Nothing was changed.",
    });
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.addActivity).not.toHaveBeenCalled();
  });

  it("collapses session failures and database detail while preserving an explicit conflict state", async () => {
    mocks.verifySession.mockRejectedValueOnce(new Error("private authorization detail"));
    await expect(saveCompetencyNoteAction(initialOverlayActionState, noteForm())).resolves.toEqual({
      status: "unavailable",
      message: "PANDO could not apply this change. Nothing was changed; try again.",
    });
    expect(mocks.saveNote).not.toHaveBeenCalled();

    mocks.saveNote.mockRejectedValueOnce(
      new classes.CompetencyOverlayConflictError("raw conflict"),
    );
    await expect(saveCompetencyNoteAction(initialOverlayActionState, noteForm())).resolves.toEqual({
      status: "conflict",
      message:
        "This plan changed in another request. Your draft is still here; review it and save again.",
    });

    mocks.addActivity.mockRejectedValueOnce(new Error("private token: pando-secret"));
    const unavailable = await addCompetencyActivityAction(
      initialOverlayActionState,
      activityForm(),
    );
    expect(unavailable).toEqual({
      status: "unavailable",
      message: "PANDO could not apply this change. Nothing was changed; try again.",
    });
    expect(unavailable.message).not.toMatch(/token|secret/iu);
  });
});
