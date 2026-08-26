import "server-only";

import type { PandoSupabaseClient } from "../../../shared/supabase/database";
import { verifyPandoSession } from "../../../shared/supabase/session";
import { ensurePersonalWorkspace } from "../../start/server/database-target-selection";

export interface SignInCredentials {
  readonly email: string;
  readonly password: string;
}

export type SignInWorkflowResult =
  | { readonly status: "authenticated" }
  | { readonly status: "invalid_credentials" }
  | { readonly status: "unavailable" };

function validCredentials(value: SignInCredentials): boolean {
  return (
    value.email.length >= 3 &&
    value.email.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value.email) &&
    value.password.length >= 8 &&
    value.password.length <= 1024
  );
}

export async function signInAndEnsureWorkspace(
  client: PandoSupabaseClient,
  credentials: SignInCredentials,
): Promise<SignInWorkflowResult> {
  if (!validCredentials(credentials)) return { status: "invalid_credentials" };

  let signInResult: Awaited<ReturnType<PandoSupabaseClient["auth"]["signInWithPassword"]>>;
  try {
    signInResult = await client.auth.signInWithPassword(credentials);
  } catch {
    return { status: "unavailable" };
  }
  if (signInResult.error !== null) return { status: "invalid_credentials" };

  try {
    const session = await verifyPandoSession(client);
    await ensurePersonalWorkspace(session.client, session.subject);
    return { status: "authenticated" };
  } catch {
    try {
      await client.auth.signOut({ scope: "local" });
    } catch {
      // The externally visible result remains generic even if local cookie cleanup also fails.
    }
    return { status: "unavailable" };
  }
}
