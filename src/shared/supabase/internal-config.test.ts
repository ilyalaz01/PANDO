// @vitest-environment node

import { describe, expect, it } from "vitest";

import { readSupabaseInternalConfig, SupabaseInternalConfigurationError } from "./internal-config";

const valid = {
  NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: `sb_secret_${"x".repeat(24)}`,
  PANDO_INTERNAL_DISPATCH_SECRET: "dispatch-secret-with-more-than-32-characters",
};

describe("internal Supabase projection configuration", () => {
  it("accepts a server-only secret key and exact dispatch secret", () => {
    expect(readSupabaseInternalConfig(valid)).toEqual({
      url: "https://project.supabase.co",
      serviceRoleKey: valid.SUPABASE_SERVICE_ROLE_KEY,
      dispatchSecret: valid.PANDO_INTERNAL_DISPATCH_SECRET,
    });
  });

  it.each([
    [{ ...valid, SUPABASE_SERVICE_ROLE_KEY: "sb_publishable_public" }],
    [{ ...valid, PANDO_INTERNAL_DISPATCH_SECRET: "too-short" }],
    [{ ...valid, NEXT_PUBLIC_SUPABASE_URL: "http://remote.example.test" }],
    [{ ...valid, NEXT_PUBLIC_SUPABASE_URL: "https://user:pass@example.test" }],
  ])("rejects unsafe internal configuration", (environment) => {
    expect(() => readSupabaseInternalConfig(environment)).toThrow(
      SupabaseInternalConfigurationError,
    );
  });

  it("allows loopback HTTP for the isolated local Supabase stack", () => {
    expect(
      readSupabaseInternalConfig({ ...valid, NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" })
        .url,
    ).toBe("http://127.0.0.1:54321");
  });
});
