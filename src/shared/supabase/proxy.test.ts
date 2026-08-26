// @vitest-environment node

import { type CookieMethodsServer } from "@supabase/ssr";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import { SupabaseConfigurationError } from "./config";
import { updatePandoSession } from "./proxy";

describe("Supabase session proxy", () => {
  it("copies chunked cookies, cookie options, and anti-cache headers", async () => {
    const request = new NextRequest("https://pando.test/start");
    const response = await updatePandoSession(request, (cookies: CookieMethodsServer) => ({
      auth: {
        async getClaims() {
          await cookies.setAll?.(
            [
              {
                name: "sb-session.0",
                value: "chunk-zero",
                options: { httpOnly: true, path: "/", sameSite: "lax", secure: true },
              },
              {
                name: "sb-session.1",
                value: "chunk-one",
                options: { httpOnly: true, path: "/", sameSite: "lax", secure: true },
              },
            ],
            { "Cache-Control": "private, no-store", Expires: "0", Pragma: "no-cache" },
          );
          return {
            data: { claims: { sub: "10000000-0000-4000-8000-000000000001" } },
            error: null,
          };
        },
      },
    }));

    expect(response.cookies.get("sb-session.0")).toMatchObject({
      value: "chunk-zero",
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: true,
    });
    expect(response.cookies.get("sb-session.1")?.value).toBe("chunk-one");
    expect(response.headers.get("cache-control")).toContain("private");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("expires")).toBe("0");
    expect(response.headers.get("pragma")).toBe("no-cache");
  });

  it("redirects invalid claims to the fixed sign-in route", async () => {
    const request = new NextRequest("https://pando.test/start?goal=goal:untrusted");
    const response = await updatePandoSession(request, () => ({
      auth: { getClaims: vi.fn().mockResolvedValue({ data: null, error: new Error("expired") }) },
    }));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://pando.test/sign-in?status=session-required",
    );
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("maps missing configuration to a generic unavailable redirect", async () => {
    const request = new NextRequest("https://pando.test/start");
    const response = await updatePandoSession(request, () => {
      throw new SupabaseConfigurationError();
    });

    expect(response.headers.get("location")).toBe("https://pando.test/sign-in?status=unavailable");
  });

  it("creates a new client for each request without shared state", async () => {
    const factory = vi.fn(() => ({
      auth: {
        getClaims: vi.fn().mockResolvedValue({
          data: { claims: { sub: "10000000-0000-4000-8000-000000000001" } },
          error: null,
        }),
      },
    }));
    await updatePandoSession(new NextRequest("https://pando.test/start"), factory);
    await updatePandoSession(new NextRequest("https://pando.test/start"), factory);
    expect(factory).toHaveBeenCalledTimes(2);
  });
});
