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
  loadLearningTrackCreationSourceV1,
  loadLearningTrackActivityAdmissionSourceV1,
} from "../../ui/plan/server/database-plan";
import type {
  CurrentGrowthPlanV1,
  CurrentLearningTracksV1,
  GrowthPlanSetupSourceV1,
  LearningTrackCreationSourceV1,
  LearningTrackActivityAdmissionSourceV1,
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
  const setupAgrees =
    plan === null
      ? setupSource.state !== "CURRENT_PLAN_EXISTS"
      : setupSource.state === "CURRENT_PLAN_EXISTS";
  return planAndTracksAgree && setupAgrees;
}

function activityAdmissionReadAgrees(
  workspace: CurrentGrowthPlanV1,
  tracksWorkspace: CurrentLearningTracksV1,
  activityAdmissionSource: LearningTrackActivityAdmissionSourceV1,
): boolean {
  const plan = workspace.currentPlan;
  const admissionPlan = activityAdmissionSource.growthPlan;
  const admissionTrack = activityAdmissionSource.learningTrack;
  const admissionPlanAgrees =
    plan === null
      ? activityAdmissionSource.state === "NO_CURRENT_PLAN" && admissionPlan === null
      : admissionPlan !== null &&
        admissionPlan.title === plan.title &&
        admissionPlan.lifecycle === plan.lifecycle &&
        admissionPlan.weeklyCapacityMinutes === plan.weeklyCapacityMinutes &&
        admissionPlan.aggregateVersion === plan.aggregateVersion;
  const soleTrack = tracksWorkspace.learningTracks[0];
  const admissionTrackAgrees =
    tracksWorkspace.learningTracks.length === 1 && soleTrack !== undefined
      ? admissionTrack !== null &&
        admissionTrack.trackKey === soleTrack.trackKey &&
        admissionTrack.title === soleTrack.title &&
        admissionTrack.lifecycle === soleTrack.lifecycle &&
        admissionTrack.priority === soleTrack.priority &&
        admissionTrack.protectedMinimumMinutes === soleTrack.protectedMinimumMinutes &&
        admissionTrack.aggregateVersion === soleTrack.aggregateVersion
      : plan === null
        ? admissionTrack === null
        : activityAdmissionSource.state === "CURRENT_TRACK_PORTFOLIO_UNAVAILABLE" &&
          admissionTrack === null;
  return admissionPlanAgrees && admissionTrackAgrees;
}

function learningTrackCreationReadAgrees(
  workspace: CurrentGrowthPlanV1,
  tracksWorkspace: CurrentLearningTracksV1,
  learningTrackCreationSource: LearningTrackCreationSourceV1,
): boolean {
  const plan = workspace.currentPlan;
  const creationPlan = learningTrackCreationSource.growthPlan;
  const trackPortfolio = learningTrackCreationSource.trackPortfolio;
  return plan === null
    ? learningTrackCreationSource.state === "NO_CURRENT_PLAN" &&
        creationPlan === null &&
        trackPortfolio === null
    : creationPlan !== null &&
        trackPortfolio !== null &&
        creationPlan.title === plan.title &&
        creationPlan.lifecycle === plan.lifecycle &&
        creationPlan.weeklyCapacityMinutes === plan.weeklyCapacityMinutes &&
        creationPlan.aggregateVersion === plan.aggregateVersion &&
        trackPortfolio.currentTrackCount === tracksWorkspace.learningTracks.length;
}

export default async function PlanPage() {
  let workspace: CurrentGrowthPlanV1;
  let tracksWorkspace: CurrentLearningTracksV1;
  let setupSource: GrowthPlanSetupSourceV1;
  let learningTrackCreationSource: LearningTrackCreationSourceV1 | undefined;
  let learningTrackCreationUnavailable = false;
  let activityAdmissionSource: LearningTrackActivityAdmissionSourceV1 | undefined;
  let activityAdmissionUnavailable = false;
  try {
    const client = await createPandoServerComponentClient();
    const authorizedClient = (await verifyPandoSession(client)).client;
    [
      workspace,
      tracksWorkspace,
      setupSource,
      learningTrackCreationSource,
      activityAdmissionSource,
    ] = await Promise.all([
      loadCurrentGrowthPlanV1(authorizedClient),
      loadCurrentLearningTracksV1(authorizedClient),
      loadGrowthPlanSetupSourceV1(authorizedClient),
      loadLearningTrackCreationSourceV1(authorizedClient).catch(() => undefined),
      loadLearningTrackActivityAdmissionSourceV1(authorizedClient).catch(() => undefined),
    ]);
    if (
      !planningReadsAgree(workspace, tracksWorkspace, setupSource) ||
      (learningTrackCreationSource !== undefined &&
        !learningTrackCreationReadAgrees(
          workspace,
          tracksWorkspace,
          learningTrackCreationSource,
        )) ||
      (activityAdmissionSource !== undefined &&
        !activityAdmissionReadAgrees(workspace, tracksWorkspace, activityAdmissionSource))
    ) {
      [
        workspace,
        tracksWorkspace,
        setupSource,
        learningTrackCreationSource,
        activityAdmissionSource,
      ] = await Promise.all([
        loadCurrentGrowthPlanV1(authorizedClient),
        loadCurrentLearningTracksV1(authorizedClient),
        loadGrowthPlanSetupSourceV1(authorizedClient),
        loadLearningTrackCreationSourceV1(authorizedClient).catch(() => undefined),
        loadLearningTrackActivityAdmissionSourceV1(authorizedClient).catch(() => undefined),
      ]);
    }
    if (!planningReadsAgree(workspace, tracksWorkspace, setupSource)) {
      throw new Error("Planning reads changed while loading.");
    }
    if (
      learningTrackCreationSource !== undefined &&
      !learningTrackCreationReadAgrees(workspace, tracksWorkspace, learningTrackCreationSource)
    ) {
      learningTrackCreationSource = undefined;
    }
    if (
      activityAdmissionSource !== undefined &&
      !activityAdmissionReadAgrees(workspace, tracksWorkspace, activityAdmissionSource)
    ) {
      activityAdmissionSource = undefined;
    }
    learningTrackCreationUnavailable = learningTrackCreationSource === undefined;
    activityAdmissionUnavailable = activityAdmissionSource === undefined;
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
          {...(learningTrackCreationSource === undefined ? {} : { learningTrackCreationSource })}
          {...(activityAdmissionSource === undefined ? {} : { activityAdmissionSource })}
          learningTrackCreationUnavailable={learningTrackCreationUnavailable}
          activityAdmissionUnavailable={activityAdmissionUnavailable}
          setupSource={setupSource}
          tracksWorkspace={tracksWorkspace}
          workspace={workspace}
        />
      </main>
    </div>
  );
}
