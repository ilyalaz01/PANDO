// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import type { PandoSupabaseClient } from "./database";
import { AuthenticatedSessionRequiredError, verifyPandoSession } from "./session";

function clientWithClaims(result: unknown): PandoSupabaseClient {
  return {
    auth: { getClaims: vi.fn().mockResolvedValue(result) },
  } as unknown as PandoSupabaseClient;
}

describe("verified PANDO session", () => {
  it("returns the same request-scoped client and validated UUID subject", async () => {
    const client = clientWithClaims({
      data: { claims: { sub: "10000000-0000-4000-8000-000000000001" } },
      error: null,
    });
    await expect(verifyPandoSession(client)).resolves.toEqual({
      subject: "10000000-0000-4000-8000-000000000001",
      client,
    });
    expect(client.auth.getClaims).toHaveBeenCalledOnce();
  });

  it.each([
    { data: null, error: null },
    { data: { claims: {} }, error: null },
    { data: { claims: { sub: "not-a-uuid" } }, error: null },
    { data: { claims: { sub: "10000000-0000-4000-8000-000000000001" } }, error: {} },
  ])("rejects missing, malformed, or errored claims", async (result) => {
    await expect(verifyPandoSession(clientWithClaims(result))).rejects.toThrow(
      AuthenticatedSessionRequiredError,
    );
  });

  it("collapses an auth exception into the same safe error", async () => {
    const client = {
      auth: { getClaims: vi.fn().mockRejectedValue(new Error("raw token detail")) },
    } as unknown as PandoSupabaseClient;
    const error = await verifyPandoSession(client).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AuthenticatedSessionRequiredError);
    expect(String(error)).not.toContain("raw token detail");
  });
});
