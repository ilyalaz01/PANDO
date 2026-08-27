import { NextResponse } from "next/server";

import { createPandoServerComponentClient } from "../../../../shared/supabase/server";
import {
  AuthenticatedSessionRequiredError,
  verifyPandoSession,
} from "../../../../shared/supabase/session";
import {
  CompetencyOverlayInputError,
  loadCurrentCompetencyOverlayV1,
} from "../../../../ui/explore/server/database-competency-overlay";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "private, no-store" };

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const url = new URL(request.url);
    if (
      url.searchParams.getAll("goal").length !== 1 ||
      url.searchParams.getAll("competency").length !== 1
    ) {
      throw new CompetencyOverlayInputError();
    }
    const client = await createPandoServerComponentClient();
    const session = await verifyPandoSession(client);
    const detail = await loadCurrentCompetencyOverlayV1(session.client, {
      readinessGoalKey: url.searchParams.get("goal") ?? "",
      competencyRef: url.searchParams.get("competency") ?? "",
    });
    return NextResponse.json(detail, { headers: noStore });
  } catch (error) {
    if (error instanceof AuthenticatedSessionRequiredError) {
      return NextResponse.json(
        { message: "Sign in to continue." },
        { status: 401, headers: noStore },
      );
    }
    if (error instanceof CompetencyOverlayInputError) {
      return NextResponse.json(
        { message: "The overlay selector is invalid." },
        { status: 400, headers: noStore },
      );
    }
    return NextResponse.json(
      { message: "The competency overlay is temporarily unavailable." },
      { status: 503, headers: noStore },
    );
  }
}
