import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { dispatchPlanSnapshotProjection } from "../../../../modules/planning/application/dispatch-plan-snapshot-projection";
import {
  readSupabaseInternalConfig,
  SupabaseInternalConfigurationError,
} from "../../../../shared/supabase/internal-config";
import { createPandoInternalProjectionClient } from "../../../../shared/supabase/internal-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function authorized(request: Request, expected: string): boolean {
  const header = request.headers.get("authorization");
  if (header === null || !header.startsWith("Bearer ")) return false;
  const candidate = header.slice("Bearer ".length);
  const left = Buffer.from(candidate, "utf8");
  const right = Buffer.from(expected, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

async function dispatch(request: Request): Promise<NextResponse> {
  try {
    const config = readSupabaseInternalConfig();
    if (!authorized(request, config.dispatchSecret)) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const summary = await dispatchPlanSnapshotProjection(createPandoInternalProjectionClient());
    return NextResponse.json(summary, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof SupabaseInternalConfigurationError
            ? "projection_dispatch_not_configured"
            : "projection_dispatch_unavailable",
      },
      { status: 503, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }
}

export function GET(request: Request): Promise<NextResponse> {
  return dispatch(request);
}

export function POST(request: Request): Promise<NextResponse> {
  return dispatch(request);
}
