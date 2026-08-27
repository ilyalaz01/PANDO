import type { NextRequest } from "next/server";

import { updatePandoSession } from "./shared/supabase/proxy";

export function proxy(request: NextRequest) {
  return updatePandoSession(request);
}

export const config = {
  matcher: ["/start/:path*", "/explore/:path*", "/focus/:path*"],
};
