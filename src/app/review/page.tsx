import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createPandoServerComponentClient } from "../../shared/supabase/server";
import {
  AuthenticatedSessionRequiredError,
  verifyPandoSession,
} from "../../shared/supabase/session";
import { SkipLink } from "../../ui/primitives/skip-link";
import { ReviewWorkspace } from "../../ui/review/review-workspace";
import styles from "../../ui/review/review.module.css";
import { loadReviewWorkspaceV1 } from "../../ui/review/server/database-review-workspace";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = {
  title: "Review Center · PANDO",
  description: "Inspect due learning reviews and every reason behind them.",
};
export default async function ReviewPage() {
  let workspace: Awaited<ReturnType<typeof loadReviewWorkspaceV1>> | undefined;
  try {
    const client = (await verifyPandoSession(await createPandoServerComponentClient())).client;
    workspace = await loadReviewWorkspaceV1(client);
  } catch (error) {
    if (error instanceof AuthenticatedSessionRequiredError) redirect("/sign-in");
  }
  if (!workspace) {
    return (
      <main className={styles.fallback} role="alert">
        <h1>Review is unavailable.</h1>
        <p>Your review schedule was not changed.</p>
      </main>
    );
  }
  return (
    <div className={styles.page}>
      <SkipLink targetId="review-main">Skip to Review</SkipLink>
      <header className={styles.header}>
        <div>
          <Link className={styles.brand} href="/start">
            PANDO
          </Link>
          <nav className={styles.headerNav} aria-label="Workspace">
            <span>Review</span>
            <Link href="/today">Today</Link>
            <Link href="/plan">Plan</Link>
            <Link href="/explore">Explore</Link>
            <Link href="/start">Targets</Link>
          </nav>
        </div>
      </header>
      <main className={styles.main} id="review-main" tabIndex={-1}>
        <ReviewWorkspace workspace={workspace} />
      </main>
    </div>
  );
}
