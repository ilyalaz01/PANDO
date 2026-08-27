import "server-only";

import { createClient } from "@supabase/supabase-js";

import type { PandoDatabase, PandoSupabaseClient } from "./database";
import { readSupabaseInternalConfig } from "./internal-config";

export function createPandoInternalProjectionClient(): PandoSupabaseClient {
  const config = readSupabaseInternalConfig();
  return createClient<PandoDatabase, "api">(config.url, config.serviceRoleKey, {
    db: { schema: "api" },
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
}
