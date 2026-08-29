"use server";

import { redirect } from "next/navigation";

import { createPandoServerActionClient } from "../../shared/supabase/server";
import type { SignInActionState } from "../../ui/sign-in/sign-in-action-state";
import { signInAndEnsureWorkspace } from "../../ui/sign-in/server/sign-in-workflow";

export async function signInAction(
  _previousState: SignInActionState,
  formData: FormData,
): Promise<SignInActionState> {
  const emailValue = formData.get("email");
  const passwordValue = formData.get("password");
  const email = typeof emailValue === "string" ? emailValue.trim() : "";
  const password = typeof passwordValue === "string" ? passwordValue : "";

  let result: Awaited<ReturnType<typeof signInAndEnsureWorkspace>>;
  try {
    const client = await createPandoServerActionClient();
    result = await signInAndEnsureWorkspace(client, { email, password });
  } catch {
    result = { status: "unavailable" };
  }

  if (result.status === "authenticated") redirect("/today");
  if (result.status === "invalid_credentials") {
    return {
      status: "invalid_credentials",
      message: "We could not sign you in with those credentials.",
    };
  }
  return {
    status: "unavailable",
    message: "PANDO sign-in is temporarily unavailable. Check the connection and try again.",
  };
}
