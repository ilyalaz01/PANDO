import { motionModes } from "../ui/design-system/motion";
import { SkipLink } from "../ui/primitives/skip-link";
import Link from "next/link";

const phase0Capabilities = [
  {
    title: "Deterministic domain core",
    description: "Mastery, readiness, and review calculations are versioned, pure, and tested.",
  },
  {
    title: "Database invariants",
    description: "Migrations and pgTAP prove tenancy, RLS, commands, and transactional outbox.",
  },
  {
    title: "Accessible Explore proof",
    description: "A stable 25-node fixture proves keyboard, responsive, and graph budgets.",
  },
] as const;

export default function FoundationPage() {
  return (
    <>
      <SkipLink targetId="main-content">Skip to content</SkipLink>
      <div className="min-h-screen bg-[var(--color-canvas)] text-[var(--color-text)]">
        <header className="border-b border-[var(--color-border)] bg-[var(--color-surface)]/90">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
            <p className="text-sm font-extrabold tracking-[0.22em] text-[var(--color-accent)]">
              PANDO
            </p>
            <p className="text-sm text-[var(--color-text-muted)]">Phase 0 · Executable baseline</p>
          </div>
        </header>

        <main
          id="main-content"
          tabIndex={-1}
          className="mx-auto flex max-w-6xl flex-col gap-10 px-5 py-16 outline-none sm:px-8 sm:py-24"
        >
          <section aria-labelledby="foundation-title" className="max-w-3xl">
            <p className="mb-4 text-sm font-bold uppercase tracking-[0.18em] text-[var(--color-accent)]">
              Verified slices
            </p>
            <h1
              id="foundation-title"
              className="text-balance text-4xl font-black tracking-[-0.04em] sm:text-6xl"
            >
              A working Phase 0 baseline for PANDO.
            </h1>
            <p className="mt-6 max-w-[var(--measure-prose)] text-lg leading-8 text-[var(--color-text-muted)]">
              Contracts, deterministic calculations, database invariants, encrypted restore, and an
              accessible Explore fixture are executable. Invite-only target onboarding is now
              persisted; the remaining live projections and planning workflows are still being
              built.
            </p>
          </section>

          <section aria-labelledby="capabilities-title">
            <h2 id="capabilities-title" className="sr-only">
              Foundation capabilities
            </h2>
            <ul className="grid gap-4 md:grid-cols-3">
              {phase0Capabilities.map((capability) => (
                <li
                  key={capability.title}
                  className="rounded-[var(--radius-panel)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-[var(--shadow-panel)]"
                >
                  <h3 className="text-lg font-bold">{capability.title}</h3>
                  <p className="mt-3 leading-7 text-[var(--color-text-muted)]">
                    {capability.description}
                  </p>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-[var(--radius-panel)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-6 shadow-[var(--shadow-panel)] sm:flex sm:items-center sm:justify-between sm:gap-6">
            <div>
              <h2 className="text-xl font-black">Phase 1 target onboarding is ready.</h2>
              <p className="mt-2 max-w-[var(--measure-prose)] leading-7 text-[var(--color-text-muted)]">
                Sign in with the invite-only owner account, create the personal workspace once, and
                select an exact seeded Target Profile.
              </p>
            </div>
            <Link
              className="mt-5 inline-flex min-h-12 shrink-0 items-center rounded-[var(--radius-control)] bg-[var(--color-accent)] px-5 font-extrabold text-white sm:mt-0"
              href="/sign-in"
            >
              Sign in to PANDO
            </Link>
          </section>

          <aside
            aria-label="Motion accessibility contract"
            className="flex flex-col gap-3 rounded-[var(--radius-panel)] border border-[var(--color-border-strong)] bg-[var(--color-accent-soft)] p-6 sm:flex-row sm:items-center sm:justify-between"
          >
            <div>
              <p className="font-bold">Motion is a user preference.</p>
              <p className="mt-1 text-sm leading-6 text-[var(--color-text-muted)]">
                System reduced-motion is honored before a saved preference exists.
              </p>
            </div>
            <p className="font-mono text-sm uppercase tracking-wider text-[var(--color-accent-strong)]">
              {motionModes.join(" · ")}
            </p>
          </aside>
        </main>
      </div>
    </>
  );
}
