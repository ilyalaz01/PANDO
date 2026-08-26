"use client";

import { useActionState } from "react";

import { selectTargetAction, setupPersonalWorkspaceAction } from "../../app/start/actions";
import { initialStartActionState } from "./start-action-state";

export function SetupPersonalWorkspaceForm() {
  const [state, action, pending] = useActionState(
    setupPersonalWorkspaceAction,
    initialStartActionState,
  );
  return (
    <form action={action} className="mt-6">
      <p aria-live="polite" className="mb-3 min-h-6 text-sm" role="status">
        {state.message}
      </p>
      <button
        className="min-h-12 rounded-[var(--radius-control)] bg-[var(--color-accent)] px-5 font-extrabold text-white disabled:cursor-wait disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        {pending ? "Preparing workspace…" : "Prepare personal workspace"}
      </button>
    </form>
  );
}

export function SelectTargetForm({ profileVersionKey }: { readonly profileVersionKey: string }) {
  const [state, action, pending] = useActionState(selectTargetAction, initialStartActionState);
  return (
    <form action={action} className="mt-5">
      <input name="profileVersionKey" type="hidden" value={profileVersionKey} />
      <p aria-live="polite" className="mb-3 min-h-6 text-sm" role="status">
        {state.message}
      </p>
      <button
        className="min-h-12 w-full rounded-[var(--radius-control)] bg-[var(--color-accent)] px-5 font-extrabold text-white disabled:cursor-wait disabled:opacity-60 sm:w-auto"
        disabled={pending}
        type="submit"
      >
        {pending ? "Saving target…" : "Use this target"}
      </button>
    </form>
  );
}
