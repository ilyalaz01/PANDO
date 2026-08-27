// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  config: vi.fn(),
  client: vi.fn(),
  dispatch: vi.fn(),
}));
const classes = vi.hoisted(() => ({
  ConfigurationError: class SupabaseInternalConfigurationError extends Error {},
}));

vi.mock("../../../../shared/supabase/internal-config", () => ({
  readSupabaseInternalConfig: mocks.config,
  SupabaseInternalConfigurationError: classes.ConfigurationError,
}));
vi.mock("../../../../shared/supabase/internal-server", () => ({
  createPandoInternalProjectionClient: mocks.client,
}));
vi.mock("../../../../modules/mastery/application/dispatch-evidence-projection", () => ({
  dispatchMasteryEvidenceProjection: mocks.dispatch,
}));

import { GET, POST } from "./route";

const secret = "dispatch-secret-with-more-than-32-characters";

describe("internal Mastery projection route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.config.mockReturnValue({ dispatchSecret: secret });
    mocks.client.mockReturnValue({ internal: true });
    mocks.dispatch.mockResolvedValue({ configured: true, claimed: 2, completed: 2, retried: 0 });
  });

  it("rejects absent, malformed, or non-equal bearer secrets before creating a client", async () => {
    for (const authorization of [undefined, "Basic value", `Bearer ${secret}x`]) {
      const response = await GET(
        new Request("https://pando.test/api/internal/mastery-projection", {
          ...(authorization === undefined ? {} : { headers: { authorization } }),
        }),
      );
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
    }
    expect(mocks.client).not.toHaveBeenCalled();
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("runs the bounded dispatcher for authorized GET and POST calls", async () => {
    for (const handler of [GET, POST]) {
      const response = await handler(
        new Request("https://pando.test/api/internal/mastery-projection", {
          headers: { authorization: `Bearer ${secret}` },
        }),
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toContain("no-store");
      await expect(response.json()).resolves.toEqual({
        configured: true,
        claimed: 2,
        completed: 2,
        retried: 0,
      });
    }
    expect(mocks.dispatch).toHaveBeenCalledTimes(2);
  });

  it("returns a safe unavailable envelope for missing configuration or worker failure", async () => {
    mocks.config.mockImplementationOnce(() => {
      throw new classes.ConfigurationError("secret detail");
    });
    let response = await GET(
      new Request("https://pando.test", { headers: { authorization: `Bearer ${secret}` } }),
    );
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "projection_dispatch_not_configured" });

    mocks.dispatch.mockRejectedValueOnce(new Error("database secret detail"));
    response = await POST(
      new Request("https://pando.test", { headers: { authorization: `Bearer ${secret}` } }),
    );
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "projection_dispatch_unavailable" });
  });
});
