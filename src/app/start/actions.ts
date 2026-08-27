"use server";

import { redirect } from "next/navigation";

import { dispatchTargetReadinessProjectionIfConfigured } from "../../modules/targets/application/dispatch-target-readiness-projection";
import { createPandoServerActionClient } from "../../shared/supabase/server";
import { verifyPandoSession } from "../../shared/supabase/session";
import type { StartActionState } from "../../ui/start/start-action-state";
import {
  ensurePersonalWorkspace,
  selectTargetProfile,
  TargetSelectionInputError,
} from "../../ui/start/server/database-target-selection";

export async function setupPersonalWorkspaceAction(
  _previousState: StartActionState,
  _formData: FormData,
): Promise<StartActionState> {
  void _previousState;
  void _formData;
  try {
    const client = await createPandoServerActionClient();
    const session = await verifyPandoSession(client);
    await ensurePersonalWorkspace(session.client, session.subject);
  } catch {
    return {
      status: "unavailable",
      message: "Your personal workspace could not be prepared. Try again.",
    };
  }
  redirect("/start");
}

export async function selectTargetAction(
  _previousState: StartActionState,
  formData: FormData,
): Promise<StartActionState> {
  const profileValue = formData.get("profileVersionKey");
  const profileVersionKey = typeof profileValue === "string" ? profileValue : "";
  let readinessGoalKey: string;
  try {
    const client = await createPandoServerActionClient();
    const session = await verifyPandoSession(client);
    const goal = await selectTargetProfile(session.client, profileVersionKey);
    readinessGoalKey = goal.readinessGoalKey;
    await dispatchTargetReadinessProjectionIfConfigured();
  } catch (error) {
    if (error instanceof TargetSelectionInputError) {
      return {
        status: "invalid_selection",
        message: "That target is no longer available. Reload and choose another target.",
      };
    }
    return {
      status: "unavailable",
      message: "PANDO could not save that target. Your existing goals were not changed.",
    };
  }
  redirect(`/start?goal=${encodeURIComponent(readinessGoalKey)}`);
}

export async function signOutAction(): Promise<never> {
  try {
    const client = await createPandoServerActionClient();
    await client.auth.getClaims();
    await client.auth.signOut({ scope: "local" });
  } catch {
    redirect("/start?status=sign-out-failed");
  }
  redirect("/sign-in");
}
