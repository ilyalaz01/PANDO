import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { createPandoServerComponentClient } from "../../shared/supabase/server";
import {
  AuthenticatedSessionRequiredError,
  verifyPandoSession,
} from "../../shared/supabase/session";
import { TodayWorkspace } from "../../ui/today/today-workspace";
import styles from "../../ui/today/today.module.css";
import { loadTodayWorkspaceV1 } from "../../ui/today/server/database-today-workspace";
import type { TodayWorkspaceV1 } from "../../ui/today/server/today-workspace-v1";
import { SkipLink } from "../../ui/primitives/skip-link";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Today · PANDO",
  description: "Choose the next explainable action from the current PANDO plan.",
};

export default async function TodayPage() {
  let workspace: TodayWorkspaceV1;
  try {
    const client = await createPandoServerComponentClient();
    const session = await verifyPandoSession(client);
    workspace = await loadTodayWorkspaceV1(session.client);
  } catch (error) {
    if (error instanceof AuthenticatedSessionRequiredError) redirect("/sign-in");
    return (
      <main className={styles.fallback} role="alert">
        <h1>Today is temporarily unavailable.</h1>
        <p>No recommendation or command is assumed to be current. Reload the authorized plan.</p>
        <Link className={styles.secondaryLink} href="/today">
          Try again
        </Link>
      </main>
    );
  }

  return (
    <div className={styles.page}>
      <SkipLink targetId="today-main">Skip to Today</SkipLink>
      <header className={styles.header}>
        <div>
          <Link className={styles.brand} href="/start">
            PANDO
          </Link>
          <nav className={styles.headerNav} aria-label="Workspace">
            <span>Today</span>
            <Link href="/explore">Explore</Link>
            <Link href="/review">Review</Link>
          </nav>
        </div>
      </header>
      <main className={styles.main} id="today-main" tabIndex={-1}>
        <TodayWorkspace workspace={workspace} />
      </main>
    </div>
  );
}
