import type { Metadata } from "next";
import Link from "next/link";

import { SkipLink } from "../../ui/primitives/skip-link";
import { SignInForm } from "../../ui/sign-in/sign-in-form";

export const metadata: Metadata = {
  title: "Sign in · PANDO",
  description: "Invite-only access to your personal PANDO workspace.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const unavailable = status === "unavailable";

  return (
    <>
      <SkipLink targetId="sign-in-main">Skip to sign in</SkipLink>
      <main
        className="mx-auto flex min-h-screen w-full max-w-xl items-center px-5 py-12 sm:px-8"
        id="sign-in-main"
        tabIndex={-1}
      >
        <section className="w-full rounded-[var(--radius-panel)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-[var(--shadow-panel)] sm:p-10">
          <Link
            className="text-sm font-extrabold tracking-[0.22em] text-[var(--color-accent)]"
            href="/"
          >
            PANDO
          </Link>
          <p className="mt-8 text-sm font-bold uppercase tracking-[0.18em] text-[var(--color-accent)]">
            Invite-only access
          </p>
          <h1 className="mt-3 text-4xl font-black tracking-[-0.04em]">Return to your roots.</h1>
          <p className="mt-4 max-w-[var(--measure-prose)] leading-7 text-[var(--color-text-muted)]">
            Sign in with the owner account provisioned for this PANDO workspace. Public sign-up is
            intentionally disabled.
          </p>
          {unavailable ? (
            <div
              className="mt-6 rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-accent-soft)] p-4 text-sm leading-6"
              role="status"
            >
              Authentication is not configured or cannot be reached. Follow the owner provisioning
              runbook, then try again.
            </div>
          ) : null}
          <SignInForm />
        </section>
      </main>
    </>
  );
}
