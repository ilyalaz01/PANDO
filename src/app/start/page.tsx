import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { createPandoServerComponentClient } from "../../shared/supabase/server";
import {
  AuthenticatedSessionRequiredError,
  verifyPandoSession,
} from "../../shared/supabase/session";
import { SkipLink } from "../../ui/primitives/skip-link";
import { SelectTargetForm, SetupPersonalWorkspaceForm } from "../../ui/start/start-action-form";
import { loadTargetSelectionSourceV1 } from "../../ui/start/server/database-target-selection";
import type { TargetSelectionSourceV1 } from "../../ui/start/server/target-selection-source-v1";
import { signOutAction } from "./actions";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Choose a target · PANDO",
  description: "Choose an exact target profile for your personal PANDO readiness goal.",
};

function UnavailableState() {
  return (
    <section className="rounded-[var(--radius-panel)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-6 shadow-[var(--shadow-panel)]">
      <h1 className="text-3xl font-black tracking-[-0.03em]">
        Your workspace is temporarily unavailable.
      </h1>
      <p className="mt-4 max-w-[var(--measure-prose)] leading-7 text-[var(--color-text-muted)]">
        Your existing goals were not changed. Check the Supabase connection and reload this page.
      </p>
    </section>
  );
}

export default async function StartPage({
  searchParams,
}: {
  searchParams: Promise<{ goal?: string; status?: string }>;
}) {
  let source: TargetSelectionSourceV1 | undefined;
  try {
    const client = await createPandoServerComponentClient();
    const session = await verifyPandoSession(client);
    source = await loadTargetSelectionSourceV1(session.client);
  } catch (error) {
    if (error instanceof AuthenticatedSessionRequiredError) redirect("/sign-in");
    source = undefined;
  }

  const { goal: requestedGoalKey, status } = await searchParams;
  const signOutFailed = status === "sign-out-failed";
  const selectedGoal = source?.readinessGoals.find(
    ({ readinessGoalKey }) => readinessGoalKey === requestedGoalKey,
  );

  return (
    <>
      <SkipLink targetId="start-main">Skip to target selection</SkipLink>
      <header className="border-b border-[var(--color-border)] bg-[var(--color-surface)]/90">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <Link
            className="text-sm font-extrabold tracking-[0.22em] text-[var(--color-accent)]"
            href="/"
          >
            PANDO
          </Link>
          <form action={signOutAction}>
            <button className="min-h-11 px-3 text-sm font-bold underline" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main
        className="mx-auto grid min-h-[calc(100vh-73px)] max-w-5xl gap-8 px-5 py-12 sm:px-8 sm:py-16"
        id="start-main"
        tabIndex={-1}
      >
        {source === undefined ? (
          <UnavailableState />
        ) : source.workspace === null ? (
          <section className="self-start rounded-[var(--radius-panel)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-[var(--shadow-panel)] sm:p-8">
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-[var(--color-accent)]">
              One-time setup
            </p>
            <h1 className="mt-3 text-4xl font-black tracking-[-0.04em]">
              Prepare your personal workspace.
            </h1>
            <p className="mt-4 max-w-[var(--measure-prose)] leading-7 text-[var(--color-text-muted)]">
              PANDO will create one private workspace through an idempotent command. Refreshing or
              retrying cannot create a duplicate.
            </p>
            <SetupPersonalWorkspaceForm />
          </section>
        ) : (
          <>
            {signOutFailed ? (
              <div
                className="rounded-[var(--radius-control)] border border-[var(--color-danger)] bg-[var(--color-surface)] p-4 leading-7"
                role="alert"
              >
                Sign-out could not clear this browser session. Your session remains protected; try
                again before leaving this device.
              </div>
            ) : null}
            <section aria-labelledby="start-title">
              <p className="text-sm font-bold uppercase tracking-[0.18em] text-[var(--color-accent)]">
                {source.workspace.displayName}
              </p>
              <h1
                className="mt-3 text-4xl font-black tracking-[-0.04em] sm:text-5xl"
                id="start-title"
              >
                Choose the outcome that gives your learning direction.
              </h1>
              <p className="mt-5 max-w-[var(--measure-prose)] text-lg leading-8 text-[var(--color-text-muted)]">
                Each choice creates or reuses a Readiness Goal pinned to one immutable Target
                Profile version. It does not overwrite your other goals.
              </p>
            </section>

            {selectedGoal === undefined ? null : (
              <section
                className="rounded-[var(--radius-panel)] border border-[var(--color-border-strong)] bg-[var(--color-accent-soft)] p-6"
                aria-labelledby="selected-goal-title"
              >
                <p className="text-sm font-bold uppercase tracking-[0.16em] text-[var(--color-accent-strong)]">
                  Selected readiness goal
                </p>
                <h2 className="mt-2 text-2xl font-black" id="selected-goal-title">
                  {selectedGoal.title}
                </h2>
                <p className="mt-3 leading-7 text-[var(--color-text-muted)]">
                  Saved as {selectedGoal.readinessGoalKey}. Reloading this URL restores the same
                  selection.
                </p>
                <Link
                  className="mt-5 inline-flex min-h-11 items-center font-bold underline"
                  href="/explore"
                >
                  View the Explore interaction fixture
                </Link>
                <p className="mt-2 text-sm leading-6 text-[var(--color-text-muted)]">
                  Explore is still representative, not your live readiness map. The live projection
                  will connect only after Mastery and readiness materialization are complete.
                </p>
              </section>
            )}

            <section aria-labelledby="available-targets-title">
              <h2 className="text-2xl font-black" id="available-targets-title">
                Available target profiles
              </h2>
              {source.profiles.length === 0 ? (
                <p className="mt-4 leading-7 text-[var(--color-text-muted)]">
                  No published target profiles are available yet.
                </p>
              ) : (
                <ul className="mt-5 grid gap-5 md:grid-cols-2">
                  {source.profiles.map((profile) => (
                    <li
                      className="min-w-0 rounded-[var(--radius-panel)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-[var(--shadow-panel)]"
                      key={profile.profileVersionKey}
                    >
                      <p className="break-words text-sm font-bold text-[var(--color-accent-strong)]">
                        {profile.companyName ?? "Personal target"} · version {profile.versionNumber}
                      </p>
                      <h3 className="mt-2 text-xl font-black">{profile.roleTitle}</h3>
                      <p className="mt-4 leading-7 text-[var(--color-text-muted)]">
                        {profile.sourceSummary}
                      </p>
                      <dl className="mt-5 grid gap-2 text-sm">
                        <div className="flex flex-wrap justify-between gap-2">
                          <dt className="font-bold">Freshness</dt>
                          <dd>{profile.freshnessStatus.replaceAll("_", " ")}</dd>
                        </div>
                        <div className="flex flex-wrap justify-between gap-2">
                          <dt className="font-bold">Reviewed</dt>
                          <dd>
                            <time dateTime={profile.reviewedAt}>{profile.reviewedAt}</time>
                          </dd>
                        </div>
                      </dl>
                      <SelectTargetForm profileVersionKey={profile.profileVersionKey} />
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section aria-labelledby="saved-goals-title">
              <h2 className="text-2xl font-black" id="saved-goals-title">
                Saved readiness goals
              </h2>
              {source.readinessGoals.length === 0 ? (
                <p className="mt-4 text-[var(--color-text-muted)]">
                  No readiness goal has been selected yet.
                </p>
              ) : (
                <ul className="mt-4 grid gap-3">
                  {source.readinessGoals.map((goal) => (
                    <li
                      className="rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
                      key={goal.readinessGoalKey}
                    >
                      <Link
                        className="font-bold underline"
                        href={`/start?goal=${encodeURIComponent(goal.readinessGoalKey)}`}
                      >
                        {goal.title}
                      </Link>
                      <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                        {goal.lifecycle} · aggregate version {goal.aggregateVersion}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </main>
    </>
  );
}
