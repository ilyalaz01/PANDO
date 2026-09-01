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
import {
  loadCurrentGrowthPlanV1,
  loadCurrentLearningTracksV1,
  loadGrowthPlanSetupSourceV1,
} from "../../ui/plan/server/database-plan";
import type {
  CurrentGrowthPlanV1,
  CurrentLearningTracksV1,
  GrowthPlanSetupSourceV1,
} from "../../ui/plan/plan-types";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = {
  title: "Plan · PANDO",
  description: "Keep your Growth Plan aligned with changing priorities.",
};

function planningReadsAgree(
  workspace: CurrentGrowthPlanV1,
  tracksWorkspace: CurrentLearningTracksV1,
  setupSource: GrowthPlanSetupSourceV1,
): boolean {
  const plan = workspace.currentPlan;
  const trackPlan = tracksWorkspace.growthPlan;
  const planAndTracksAgree =
    (plan === null && trackPlan === null && tracksWorkspace.learningTracks.length === 0) ||
    (plan !== null &&
      trackPlan !== null &&
      plan.growthPlanId === trackPlan.growthPlanId &&
      plan.lifecycle === trackPlan.lifecycle &&
      plan.weeklyCapacityMinutes === trackPlan.weeklyCapacityMinutes &&
      plan.aggregateVersion === trackPlan.aggregateVersion);
  return (
    planAndTracksAgree &&
    (plan === null
      ? setupSource.state !== "CURRENT_PLAN_EXISTS"
      : setupSource.state === "CURRENT_PLAN_EXISTS")
  );
}

export default async function PlanPage() {
  let workspace: CurrentGrowthPlanV1;
  let tracksWorkspace: CurrentLearningTracksV1;
  let setupSource: GrowthPlanSetupSourceV1;
  try {
    const client = await createPandoServerComponentClient();
    const authorizedClient = (await verifyPandoSession(client)).client;
    [workspace, tracksWorkspace, setupSource] = await Promise.all([
      loadCurrentGrowthPlanV1(authorizedClient),
      loadCurrentLearningTracksV1(authorizedClient),
      loadGrowthPlanSetupSourceV1(authorizedClient),
    ]);
    if (!planningReadsAgree(workspace, tracksWorkspace, setupSource)) {
      [workspace, tracksWorkspace, setupSource] = await Promise.all([
        loadCurrentGrowthPlanV1(authorizedClient),
        loadCurrentLearningTracksV1(authorizedClient),
        loadGrowthPlanSetupSourceV1(authorizedClient),
      ]);
    }
    if (!planningReadsAgree(workspace, tracksWorkspace, setupSource)) {
      throw new Error("Planning reads changed while loading.");
    }
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
        <PlanWorkspace
          setupSource={setupSource}
          tracksWorkspace={tracksWorkspace}
          workspace={workspace}
        />
      </main>
    </div>
  );
}
