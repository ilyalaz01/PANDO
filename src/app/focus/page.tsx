import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { createPandoServerComponentClient } from "../../shared/supabase/server";
import {
  AuthenticatedSessionRequiredError,
  verifyPandoSession,
} from "../../shared/supabase/session";
import { FocusWorkspace } from "../../ui/focus/focus-workspace";
import styles from "../../ui/focus/focus.module.css";
import { loadFocusWorkspaceV1 } from "../../ui/focus/server/database-focus-workspace";
import type { FocusWorkspaceV1 } from "../../ui/focus/server/focus-workspace-v1";
import { SkipLink } from "../../ui/primitives/skip-link";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Focus session · PANDO",
  description: "Run a focused activity and record evidence without losing its history.",
};

type FocusSearchParams = Promise<{
  goal?: string | string[];
  activity?: string | string[];
}>;

function one(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export default async function FocusPage({ searchParams }: { searchParams: FocusSearchParams }) {
  let client: Awaited<ReturnType<typeof createPandoServerComponentClient>>;
  try {
    const candidate = await createPandoServerComponentClient();
    client = (await verifyPandoSession(candidate)).client;
  } catch (error) {
    if (error instanceof AuthenticatedSessionRequiredError) redirect("/sign-in");
    return (
      <main className={styles.fallback} role="alert">
        <h1>Focus is unavailable.</h1>
        <p>Your session and evidence were not changed.</p>
      </main>
    );
  }
  const query = await searchParams;
  const goal = one(query.goal);
  const activity = one(query.activity) ?? null;
  if (goal === undefined || Array.isArray(query.goal) || Array.isArray(query.activity)) {
    return (
      <main className={styles.fallback}>
        <h1>Open Focus from an activity.</h1>
        <p>Select an activity in Explore so PANDO can preserve its exact target mapping.</p>
        <Link href="/start">Choose a target</Link>
      </main>
    );
  }
  let workspace: FocusWorkspaceV1;
  try {
    workspace = await loadFocusWorkspaceV1(client, {
      readinessGoalKey: goal,
      activityKey: activity,
    });
  } catch {
    return (
      <main className={styles.fallback} role="alert">
        <h1>Focus could not load this activity.</h1>
        <p>Nothing was changed. Return to the authorized Explore view and try again.</p>
        <Link href={`/explore?${new URLSearchParams({ goal }).toString()}`}>Return to Explore</Link>
      </main>
    );
  }
  return (
    <div className={styles.page}>
      <SkipLink targetId="focus-main">Skip to Focus</SkipLink>
      <header className={styles.header}>
        <div>
          <Link className={styles.brand} href="/start">
            PANDO
          </Link>
          <nav className={styles.headerNav} aria-label="Workspace">
            <span>Focus</span>
            <Link href="/review">Review</Link>
          </nav>
        </div>
      </header>
      <main className={styles.main} id="focus-main" tabIndex={-1}>
        <FocusWorkspace workspace={workspace} />
      </main>
    </div>
  );
}
