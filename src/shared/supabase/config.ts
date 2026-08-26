import "server-only";

import { Buffer } from "node:buffer";

export interface SupabasePublicConfig {
  readonly url: string;
  readonly publishableKey: string;
}

export class SupabaseConfigurationError extends Error {
  constructor() {
    super("PANDO authentication is not configured.");
    this.name = "SupabaseConfigurationError";
  }
}

function legacyJwtRole(key: string): string | undefined {
  if (key.split(".").length !== 3) return undefined;
  const payload = key.split(".")[1];
  if (payload === undefined) return undefined;
  try {
    const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as unknown;
    return typeof value === "object" && value !== null && "role" in value
      ? typeof value.role === "string"
        ? value.role
        : undefined
      : undefined;
  } catch {
    return undefined;
  }
}

function isAllowedPublicKey(key: string): boolean {
  return (key.startsWith("sb_publishable_") && key.length >= 20) || legacyJwtRole(key) === "anon";
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function readSupabasePublicConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): SupabasePublicConfig {
  const rawUrl = environment.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (rawUrl === undefined || publishableKey === undefined || !isAllowedPublicKey(publishableKey)) {
    throw new SupabaseConfigurationError();
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SupabaseConfigurationError();
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username !== "" || url.password !== "") {
    throw new SupabaseConfigurationError();
  }
  if (url.protocol === "http:" && !isLoopbackHostname(url.hostname)) {
    throw new SupabaseConfigurationError();
  }

  return { url: url.origin, publishableKey };
}
