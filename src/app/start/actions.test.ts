import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  verifySession: vi.fn(),
  ensureWorkspace: vi.fn(),
  selectTarget: vi.fn(),
  redirect: vi.fn(),
}));
const classes = vi.hoisted(() => ({
  TargetSelectionInputError: class TargetSelectionInputError extends Error {},
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("../../shared/supabase/server", () => ({
  createPandoServerActionClient: mocks.createClient,
}));
vi.mock("../../shared/supabase/session", () => ({ verifyPandoSession: mocks.verifySession }));
vi.mock("../../ui/start/server/database-target-selection", () => ({
  ensurePersonalWorkspace: mocks.ensureWorkspace,
  selectTargetProfile: mocks.selectTarget,
  TargetSelectionInputError: classes.TargetSelectionInputError,
}));

import { initialStartActionState } from "../../ui/start/start-action-state";
import { selectTargetAction, setupPersonalWorkspaceAction, signOutAction } from "./actions";

describe("start Server Actions", () => {
  const client = {
    auth: {
      getClaims: vi.fn(),
      signOut: vi.fn(),
    },
  };

  beforeEach(() => {
    mocks.createClient.mockReset().mockResolvedValue(client);
    mocks.verifySession.mockReset().mockResolvedValue({ client, subject: "owner-subject" });
    mocks.ensureWorkspace.mockReset().mockResolvedValue({ workspace: {} });
    mocks.selectTarget.mockReset();
    client.auth.getClaims.mockReset().mockResolvedValue({ data: { claims: {} }, error: null });
    client.auth.signOut.mockReset().mockResolvedValue({ error: null });
    mocks.redirect.mockReset().mockImplementation((path: string) => {
      throw new Error(`NEXT_REDIRECT:${path}`);
    });
  });

  it("runs explicit personal-workspace setup and redirects to a fixed route", async () => {
    await expect(
      setupPersonalWorkspaceAction(initialStartActionState, new FormData()),
    ).rejects.toThrow("NEXT_REDIRECT:/start");
    expect(mocks.ensureWorkspace).toHaveBeenCalledWith(client, "owner-subject");
  });

  it("returns an unavailable setup state when session or cookie persistence fails", async () => {
    mocks.createClient.mockRejectedValue(new Error("cookie write failed"));
    await expect(
      setupPersonalWorkspaceAction(initialStartActionState, new FormData()),
    ).resolves.toEqual({
      status: "unavailable",
      message: "Your personal workspace could not be prepared. Try again.",
    });
  });

  it("distinguishes invalid target input from an unavailable mutation", async () => {
    const form = new FormData();
    form.set("profileVersionKey", new File(["ignored"], "profile.txt"));
    mocks.selectTarget.mockRejectedValueOnce(new classes.TargetSelectionInputError());
    await expect(selectTargetAction(initialStartActionState, form)).resolves.toEqual({
      status: "invalid_selection",
      message: "That target is no longer available. Reload and choose another target.",
    });

    mocks.selectTarget.mockRejectedValueOnce(new Error("raw RPC"));
    await expect(selectTargetAction(initialStartActionState, new FormData())).resolves.toEqual({
      status: "unavailable",
      message: "PANDO could not save that target. Your existing goals were not changed.",
    });
  });

  it("encodes the server-returned goal key inside the fixed start route", async () => {
    mocks.selectTarget.mockResolvedValue({ readinessGoalKey: "goal:safe?next=https://evil.test" });
    const form = new FormData();
    form.set("profileVersionKey", "target:safe-profile");

    await expect(selectTargetAction(initialStartActionState, form)).rejects.toThrow(
      "NEXT_REDIRECT:/start?goal=goal%3Asafe%3Fnext%3Dhttps%3A%2F%2Fevil.test",
    );
  });

  it("clears only the local session and reports cookie-write failure without claiming success", async () => {
    await expect(signOutAction()).rejects.toThrow("NEXT_REDIRECT:/sign-in");
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: "local" });

    client.auth.signOut.mockRejectedValue(new Error("cookie write failed"));
    await expect(signOutAction()).rejects.toThrow("NEXT_REDIRECT:/start?status=sign-out-failed");
  });
});
