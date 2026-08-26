import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.generated";

export type { Json } from "./database.generated";
export type PandoDatabase = Database;

export type PandoSupabaseClient = SupabaseClient<PandoDatabase, "api">;
