// @vitest-environment node

import type { CookieMethodsServer } from "@supabase/ssr";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  cookies: vi.fn(),
  getAll: vi.fn(),
  set: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.createServerClient }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("./config", () => ({
  readSupabasePublicConfig: () => ({
    url: "https://pando.test",
    publishableKey: "sb_publishable_12345678901234567890",
  }),
}));

import { createPandoServerActionClient, createPandoServerComponentClient } from "./server";

describe("request-scoped PANDO Supabase server client", () => {
  beforeEach(() => {
    mocks.createServerClient.mockReset().mockReturnValue({ requestScoped: true });
    mocks.cookies.mockReset().mockResolvedValue({ getAll: mocks.getAll, set: mocks.set });
    mocks.getAll.mockReset().mockReturnValue([{ name: "session", value: "opaque" }]);
    mocks.set.mockReset();
  });

  it("creates a fresh api-schema client with hardened auth cookie defaults on each request", async () => {
    await expect(createPandoServerActionClient()).resolves.toEqual({ requestScoped: true });
    await createPandoServerActionClient();

    expect(mocks.createServerClient).toHaveBeenCalledTimes(2);
    const [url, key, options] = mocks.createServerClient.mock.calls[0] as [
      string,
      string,
      {
        db: { schema: string };
        cookieOptions: Record<string, unknown>;
        cookies: CookieMethodsServer;
      },
    ];
    expect(url).toBe("https://pando.test");
    expect(key).toBe("sb_publishable_12345678901234567890");
    expect(options.db).toEqual({ schema: "api" });
    expect(options.cookieOptions).toMatchObject({
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: false,
    });
    expect(options.cookies.getAll()).toEqual([{ name: "session", value: "opaque" }]);

    options.cookies.setAll?.(
      [{ name: "session", value: "refreshed", options: { maxAge: 60, sameSite: "lax" } }],
      {},
    );
    expect(mocks.set).toHaveBeenCalledWith("session", "refreshed", {
      maxAge: 60,
      sameSite: "lax",
    });
  });

  it("allows a read-only Server Component cookie store while Proxy owns refresh writes", async () => {
    mocks.set.mockImplementation(() => {
      throw new Error("Cookies can only be modified in a Server Action");
    });
    await createPandoServerComponentClient();
    const options = mocks.createServerClient.mock.calls[0]?.[2] as {
      cookies: CookieMethodsServer;
    };

    expect(() =>
      options.cookies.setAll?.([{ name: "session", value: "refreshed", options: {} }], {}),
    ).not.toThrow();
  });

  it("propagates cookie-write failures from writable Server Actions", async () => {
    mocks.set.mockImplementation(() => {
      throw new Error("cookie persistence failed");
    });
    await createPandoServerActionClient();
    const options = mocks.createServerClient.mock.calls[0]?.[2] as {
      cookies: CookieMethodsServer;
    };

    expect(() =>
      options.cookies.setAll?.([{ name: "session", value: "refreshed", options: {} }], {}),
    ).toThrow("cookie persistence failed");
  });
});
