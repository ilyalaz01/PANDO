import "server-only";

import type { PandoSupabaseClient } from "./database";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export class AuthenticatedSessionRequiredError extends Error {
  constructor() {
    super("An authenticated PANDO session is required.");
    this.name = "AuthenticatedSessionRequiredError";
  }
}

export interface VerifiedPandoSession {
  readonly subject: string;
  readonly client: PandoSupabaseClient;
}

export async function verifyPandoSession(
  client: PandoSupabaseClient,
): Promise<VerifiedPandoSession> {
  let claimsResult: Awaited<ReturnType<PandoSupabaseClient["auth"]["getClaims"]>>;
  try {
    claimsResult = await client.auth.getClaims();
  } catch {
    throw new AuthenticatedSessionRequiredError();
  }
  const subject = claimsResult.data?.claims?.sub;
  if (claimsResult.error !== null || typeof subject !== "string" || !UUID.test(subject)) {
    throw new AuthenticatedSessionRequiredError();
  }
  return { subject, client };
}
