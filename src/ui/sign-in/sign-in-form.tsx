"use client";

import { useActionState } from "react";

import { signInAction } from "../../app/sign-in/actions";
import { initialSignInActionState } from "./sign-in-action-state";

export function SignInForm() {
  const [state, formAction, pending] = useActionState(signInAction, initialSignInActionState);

  return (
    <form action={formAction} className="mt-8 grid gap-5" noValidate={false}>
      <div className="grid gap-2">
        <label className="font-bold" htmlFor="email">
          Email
        </label>
        <input
          autoComplete="email"
          className="min-h-12 rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-4 text-base"
          id="email"
          inputMode="email"
          maxLength={254}
          name="email"
          required
          type="email"
        />
      </div>
      <div className="grid gap-2">
        <label className="font-bold" htmlFor="password">
          Password
        </label>
        <input
          autoComplete="current-password"
          className="min-h-12 rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-4 text-base"
          id="password"
          maxLength={1024}
          minLength={8}
          name="password"
          required
          type="password"
        />
      </div>
      <p aria-live="polite" className="min-h-6 text-sm text-[var(--color-danger)]" role="status">
        {state.message}
      </p>
      <button
        className="min-h-12 rounded-[var(--radius-control)] bg-[var(--color-accent)] px-5 font-extrabold text-white disabled:cursor-wait disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
