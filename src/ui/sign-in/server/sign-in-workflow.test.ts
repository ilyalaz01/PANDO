// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import type { PandoSupabaseClient } from "../../../shared/supabase/database";
import { signInAndEnsureWorkspace } from "./sign-in-workflow";

const source = {
  contract: { name: "TargetSelectionSourceV1", version: "1.0.0" },
  workspace: {
    workspaceId: "20000000-0000-4000-8000-000000000001",
    workspaceKind: "personal",
    displayName: "Personal workspace",
    membershipRole: "owner",
  },
  profiles: [],
  readinessGoals: [],
};

function client({
  signInError = null,
  claimsError = null,
  rpcError = null,
}: {
  signInError?: unknown;
  claimsError?: unknown;
  rpcError?: unknown;
} = {}) {
  const value = {
    auth: {
      signInWithPassword: vi.fn().mockResolvedValue({ data: {}, error: signInError }),
      getClaims: vi.fn().mockResolvedValue({
        data: { claims: { sub: "10000000-0000-4000-8000-000000000001" } },
        error: claimsError,
      }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
    rpc: vi.fn().mockResolvedValue({ data: source, error: rpcError }),
  };
  return { value, typed: value as unknown as PandoSupabaseClient };
}

describe("invite-only sign-in workflow", () => {
  it("rejects malformed credentials without contacting Auth or domain RPCs", async () => {
    const current = client();
    await expect(
      signInAndEnsureWorkspace(current.typed, { email: "bad", password: "short" }),
    ).resolves.toEqual({ status: "invalid_credentials" });
    expect(current.value.auth.signInWithPassword).not.toHaveBeenCalled();
    expect(current.value.rpc).not.toHaveBeenCalled();
  });

  it("uses the same generic result for an unknown email or wrong password", async () => {
    for (const rawMessage of ["user not found", "invalid password"]) {
      const current = client({ signInError: { message: rawMessage } });
      const result = await signInAndEnsureWorkspace(current.typed, {
        email: "owner@pando.test",
        password: "strong-password",
      });
      expect(result).toEqual({ status: "invalid_credentials" });
      expect(JSON.stringify(result)).not.toContain(rawMessage);
      expect(current.value.auth.getClaims).not.toHaveBeenCalled();
      expect(current.value.rpc).not.toHaveBeenCalled();
    }
  });

  it("verifies claims before loading workspace state through the same client", async () => {
    const current = client();
    await expect(
      signInAndEnsureWorkspace(current.typed, {
        email: "owner@pando.test",
        password: "strong-password",
      }),
    ).resolves.toEqual({ status: "authenticated" });
    expect(current.value.auth.signInWithPassword).toHaveBeenCalledWith({
      email: "owner@pando.test",
      password: "strong-password",
    });
    expect(current.value.auth.getClaims).toHaveBeenCalledOnce();
    expect(current.value.rpc).toHaveBeenCalledWith("get_target_selection_source_v1");
    expect(current.value.auth.signOut).not.toHaveBeenCalled();
  });

  it("fails closed and clears local auth when claims or workspace setup fails", async () => {
    for (const current of [client({ claimsError: {} }), client({ rpcError: {} })]) {
      await expect(
        signInAndEnsureWorkspace(current.typed, {
          email: "owner@pando.test",
          password: "strong-password",
        }),
      ).resolves.toEqual({ status: "unavailable" });
      expect(current.value.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    }
  });
});
