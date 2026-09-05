import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createPandoServerComponentClient } from "../../shared/supabase/server";
import {
  AuthenticatedSessionRequiredError,
  verifyPandoSession,
} from "../../shared/supabase/session";
import { SkipLink } from "../../ui/primitives/skip-link";
import { CampaignWorkspace } from "../../ui/campaigns/campaign-workspace";
import styles from "../../ui/campaigns/campaigns.module.css";
import {
  loadCampaignAllocationOverridesV1,
  loadInterviewCampaignsV1,
} from "../../ui/campaigns/server/database-campaigns";
import { loadTargetSelectionSourceV1 } from "../../ui/start/server/database-target-selection";
import { loadCurrentLearningTracksV1 } from "../../ui/plan/server/database-plan";
import type {
  ActiveReadinessGoalV1,
  AvailableLearningTrackV1,
  CampaignAllocationOverrideSummaryV1,
  InterviewCampaignSummaryV1,
} from "../../ui/campaigns/campaign-types";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = {
  title: "Interview Campaigns · PANDO",
  description: "Draft, start, retarget, and close Interview Campaigns for a specific loop.",
};

export default async function CampaignsPage() {
  let campaigns: readonly InterviewCampaignSummaryV1[] = [];
  let activeGoals: readonly ActiveReadinessGoalV1[] = [];
  let availableTracks: readonly AvailableLearningTrackV1[] = [];
  let overrides: readonly CampaignAllocationOverrideSummaryV1[] = [];
  try {
    const client = await createPandoServerComponentClient();
    const authorizedClient = (await verifyPandoSession(client)).client;
    const [campaignsWorkspace, targetSelectionSource, learningTracks, overridesWorkspace] =
      await Promise.all([
        loadInterviewCampaignsV1(authorizedClient),
        loadTargetSelectionSourceV1(authorizedClient),
        loadCurrentLearningTracksV1(authorizedClient),
        loadCampaignAllocationOverridesV1(authorizedClient),
      ]);
    campaigns = campaignsWorkspace.campaigns;
    activeGoals = targetSelectionSource.readinessGoals.filter(
      (goal) => goal.lifecycle === "active",
    );
    availableTracks = learningTracks.learningTracks;
    overrides = overridesWorkspace.overrides;
  } catch (error) {
    if (error instanceof AuthenticatedSessionRequiredError) redirect("/sign-in");
    return (
      <main className={styles.fallback} role="alert">
        <h1>Interview Campaigns are temporarily unavailable.</h1>
        <p>Nothing was changed. Reload the authorized workspace.</p>
        <Link className={styles.secondaryButton} href="/campaigns">
          Try again
        </Link>
      </main>
    );
  }
  return (
    <div className={styles.page}>
      <SkipLink targetId="campaigns-main">Skip to Interview Campaigns</SkipLink>
      <header className={styles.header}>
        <div>
          <Link className={styles.brand} href="/start">
            PANDO
          </Link>
          <nav aria-label="Workspace" className={styles.headerNav}>
            <Link href="/today">Today</Link>
            <Link href="/plan">Plan</Link>
            <span>Interview Campaigns</span>
            <Link href="/explore">Explore</Link>
            <Link href="/review">Review</Link>
            <Link href="/start">Targets</Link>
          </nav>
        </div>
      </header>
      <main className={styles.main} id="campaigns-main" tabIndex={-1}>
        <div className={styles.intro}>
          <p>Interview Campaigns</p>
          <h1>Prepare for one loop at a time.</h1>
          <p>
            A campaign has its own deadline and target, independent of your Growth Plan. Draft one,
            start it, and change its deadline or target as the loop moves.
          </p>
        </div>
        <CampaignWorkspace
          activeGoals={activeGoals}
          availableTracks={availableTracks}
          campaigns={campaigns}
          overrides={overrides}
        />
      </main>
    </div>
  );
}
