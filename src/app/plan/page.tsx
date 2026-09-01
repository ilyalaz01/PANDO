import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createPandoServerComponentClient } from "../../shared/supabase/server";
import {
  AuthenticatedSessionRequiredError,
  verifyPandoSession,
} from "../../shared/supabase/session";
import { SkipLink } from "../../ui/primitives/skip-link";
import { PlanWorkspace } from "../../ui/plan/plan-workspace";
import styles from "../../ui/plan/plan.module.css";
import { loadCurrentGrowthPlanV1 } from "../../ui/plan/server/database-plan";
import type { CurrentGrowthPlanV1 } from "../../ui/plan/plan-types";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = {
  title: "Plan · PANDO",
  description: "Keep your Growth Plan aligned with changing priorities.",
};

export default async function PlanPage() {
  let workspace: CurrentGrowthPlanV1;
  try {
    const client = await createPandoServerComponentClient();
    workspace = await loadCurrentGrowthPlanV1((await verifyPandoSession(client)).client);
  } catch (error) {
    if (error instanceof AuthenticatedSessionRequiredError) redirect("/sign-in");
    return (
      <main className={styles.fallback} role="alert">
        <h1>Plan is temporarily unavailable.</h1>
        <p>No plan was changed. Reload the authorized workspace.</p>
        <Link className={styles.secondaryButton} href="/plan">
          Try again
        </Link>
      </main>
    );
  }
  return (
    <div className={styles.page}>
      <SkipLink targetId="plan-main">Skip to Plan</SkipLink>
      <header className={styles.header}>
        <div>
          <Link className={styles.brand} href="/start">
            PANDO
          </Link>
          <nav aria-label="Workspace" className={styles.headerNav}>
            <span>Plan</span>
            <Link href="/today">Today</Link>
            <Link href="/explore">Explore</Link>
            <Link href="/review">Review</Link>
            <Link href="/start">Targets</Link>
          </nav>
        </div>
      </header>
      <main className={styles.main} id="plan-main" tabIndex={-1}>
        <PlanWorkspace workspace={workspace} />
      </main>
    </div>
  );
}
