import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  signIn: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("../../shared/supabase/server", () => ({
  createPandoServerActionClient: mocks.createClient,
}));
vi.mock("../../ui/sign-in/server/sign-in-workflow", () => ({
  signInAndEnsureWorkspace: mocks.signIn,
}));

import { initialSignInActionState } from "../../ui/sign-in/sign-in-action-state";
import { signInAction } from "./actions";

describe("sign-in Server Action", () => {
  beforeEach(() => {
    mocks.createClient.mockReset().mockResolvedValue({ requestScoped: true });
    mocks.signIn.mockReset();
    mocks.redirect.mockReset().mockImplementation((path: string) => {
      throw new Error(`NEXT_REDIRECT:${path}`);
    });
  });

  it("normalizes only string fields and returns the generic invalid-credentials state", async () => {
    mocks.signIn.mockResolvedValue({ status: "invalid_credentials" });
    const form = new FormData();
    form.set("email", "  owner@pando.test  ");
    form.set("password", new File(["not-used"], "password.txt"));

    await expect(signInAction(initialSignInActionState, form)).resolves.toEqual({
      status: "invalid_credentials",
      message: "We could not sign you in with those credentials.",
    });
    expect(mocks.signIn).toHaveBeenCalledWith(
      { requestScoped: true },
      { email: "owner@pando.test", password: "" },
    );
  });

  it("redirects authenticated sessions only to the fixed start route", async () => {
    mocks.signIn.mockResolvedValue({ status: "authenticated" });
    const form = new FormData();
    form.set("email", "owner@pando.test");
    form.set("password", "strong-password");

    await expect(signInAction(initialSignInActionState, form)).rejects.toThrow(
      "NEXT_REDIRECT:/start",
    );
  });

  it("collapses client and workflow failures into one unavailable response", async () => {
    const form = new FormData();
    form.set("email", "owner@pando.test");
    form.set("password", "strong-password");
    for (const failure of ["client", "workflow"] as const) {
      mocks.createClient.mockReset().mockResolvedValue({ requestScoped: true });
      mocks.signIn.mockReset().mockResolvedValue({ status: "unavailable" });
      if (failure === "client") mocks.createClient.mockRejectedValue(new Error("raw config"));
      else mocks.signIn.mockRejectedValue(new Error("raw auth"));

      await expect(signInAction(initialSignInActionState, form)).resolves.toEqual({
        status: "unavailable",
        message: "PANDO sign-in is temporarily unavailable. Check the connection and try again.",
      });
    }
  });
});
