import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { readSupabasePublicConfig } from "./config";
import type { PandoDatabase, PandoSupabaseClient } from "./database";

type CookieWriteMode = "required" | "server-component";

async function createPandoServerClient(mode: CookieWriteMode): Promise<PandoSupabaseClient> {
  const config = readSupabasePublicConfig();
  const cookieStore = await cookies();

  return createServerClient<PandoDatabase, "api">(config.url, config.publishableKey, {
    db: { schema: "api" },
    cookieOptions: {
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    },
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet) {
        if (mode === "required") {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
          return;
        }
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot write cookies. src/proxy.ts refreshes them before rendering;
          // writable actions use createPandoServerActionClient and propagate any write failure.
        }
      },
    },
  });
}

export function createPandoServerComponentClient(): Promise<PandoSupabaseClient> {
  return createPandoServerClient("server-component");
}

export function createPandoServerActionClient(): Promise<PandoSupabaseClient> {
  return createPandoServerClient("required");
}
