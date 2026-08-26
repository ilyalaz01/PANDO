// @vitest-environment node

import { Buffer } from "node:buffer";

import { describe, expect, it } from "vitest";

import { readSupabasePublicConfig, SupabaseConfigurationError } from "./config";

function jwt(role: string): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ role })}.signature-value`;
}

describe("Supabase public configuration", () => {
  it("accepts an HTTPS project URL and publishable key without exposing extras", () => {
    expect(
      readSupabasePublicConfig({
        NODE_ENV: "production",
        NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co/path-that-is-not-retained",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_12345678901234567890",
      }),
    ).toEqual({
      url: "https://project.supabase.co",
      publishableKey: "sb_publishable_12345678901234567890",
    });
  });

  it("accepts the legacy local anon key and HTTP loopback outside production", () => {
    const anonKey = jwt("anon");
    expect(
      readSupabasePublicConfig({
        NODE_ENV: "development",
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: anonKey,
      }),
    ).toEqual({ url: "http://127.0.0.1:54321", publishableKey: anonKey });
  });

  it.each([
    {},
    {
      NEXT_PUBLIC_SUPABASE_URL: "not a URL",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_12345678901234567890",
    },
    {
      NEXT_PUBLIC_SUPABASE_URL: "http://supabase.internal.test:54321",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_12345678901234567890",
    },
    {
      NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_secret_12345678901234567890",
    },
    {
      NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: jwt("service_role"),
    },
    {
      NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: jwt("authenticated"),
    },
    {
      NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "unknown_public_key_shape_1234567890",
    },
  ])("fails closed for missing, malformed, insecure, or privileged config", (environment) => {
    expect(() => readSupabasePublicConfig(environment)).toThrow(SupabaseConfigurationError);
  });

  it("does not place a rejected secret in the error", () => {
    const secret = "sb_secret_never-echo-this-value";
    try {
      readSupabasePublicConfig({
        NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: secret,
      });
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });
});
