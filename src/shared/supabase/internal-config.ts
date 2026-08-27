import "server-only";

import { Buffer } from "node:buffer";

export interface SupabaseInternalConfig {
  readonly url: string;
  readonly serviceRoleKey: string;
  readonly dispatchSecret: string;
}

export class SupabaseInternalConfigurationError extends Error {
  constructor() {
    super("PANDO internal projection dispatch is not configured.");
    this.name = "SupabaseInternalConfigurationError";
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

function serviceKey(value: string): boolean {
  return (
    (value.startsWith("sb_secret_") && value.length >= 24) ||
    legacyJwtRole(value) === "service_role"
  );
}

export function readSupabaseInternalConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): SupabaseInternalConfig {
  const rawUrl = environment.NEXT_PUBLIC_SUPABASE_URL;
  const rawServiceKey = environment.SUPABASE_SERVICE_ROLE_KEY;
  const dispatchSecret = environment.PANDO_INTERNAL_DISPATCH_SECRET;
  if (
    rawUrl === undefined ||
    rawServiceKey === undefined ||
    dispatchSecret === undefined ||
    !serviceKey(rawServiceKey) ||
    dispatchSecret.length < 32 ||
    dispatchSecret.trim() !== dispatchSecret
  ) {
    throw new SupabaseInternalConfigurationError();
  }
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SupabaseInternalConfigurationError();
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    (url.protocol === "http:" && !loopback) ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw new SupabaseInternalConfigurationError();
  }
  return { url: url.origin, serviceRoleKey: rawServiceKey, dispatchSecret };
}
