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
  loadLearningTrackActivityAdmissionSourceV2,
} from "../../ui/plan/server/database-plan";
import type {
  CurrentGrowthPlanV1,
  CurrentLearningTracksV1,
  GrowthPlanSetupSourceV1,
  LearningTrackActivityAdmissionSource,
  LearningTrackCreationSourceV1,
} from "../../ui/plan/plan-types";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = {
  title: "Plan · PANDO",
  description: "Keep your Growth Plan aligned with changing priorities.",
};

const TRACK_KEY = /^track:[a-z0-9][a-z0-9-]{1,100}$/u;

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
  activityAdmissionSource: LearningTrackActivityAdmissionSource,
  requestedTrackKey: string | undefined,
): boolean {
  const plan = workspace.currentPlan;
  const admissionPlan = activityAdmissionSource.growthPlan;
  const admissionPlanAgrees =
    plan === null
      ? activityAdmissionSource.state === "NO_CURRENT_PLAN" && admissionPlan === null
      : admissionPlan !== null &&
        admissionPlan.title === plan.title &&
        admissionPlan.lifecycle === plan.lifecycle &&
        admissionPlan.weeklyCapacityMinutes === plan.weeklyCapacityMinutes &&
        admissionPlan.aggregateVersion === plan.aggregateVersion;
  let admissionTrack = null;
  if ("selectedTrack" in activityAdmissionSource) {
    admissionTrack = activityAdmissionSource.selectedTrack;
  } else {
    admissionTrack = activityAdmissionSource.learningTrack;
  }
  const requestedTrackAgrees =
    !("selectedTrack" in activityAdmissionSource) ||
    admissionTrack === null ||
    admissionTrack.trackKey === requestedTrackKey;
  const matchingTrack =
    admissionTrack === null
      ? undefined
      : tracksWorkspace.learningTracks.find((track) => track.trackKey === admissionTrack.trackKey);
  const admissionTrackAgrees =
    admissionTrack === null
      ? plan === null
        ? true
        : tracksWorkspace.learningTracks.length === 0
          ? activityAdmissionSource.state === "NO_CURRENT_TRACKS"
          : activityAdmissionSource.state === "CURRENT_TRACK_PORTFOLIO_UNAVAILABLE" ||
            activityAdmissionSource.state === "SELECTED_TRACK_UNAVAILABLE"
      : matchingTrack !== undefined &&
        admissionTrack.title === matchingTrack.title &&
        admissionTrack.lifecycle === matchingTrack.lifecycle &&
        admissionTrack.priority === matchingTrack.priority &&
        admissionTrack.protectedMinimumMinutes === matchingTrack.protectedMinimumMinutes &&
        admissionTrack.aggregateVersion === matchingTrack.aggregateVersion;
  return admissionPlanAgrees && admissionTrackAgrees && requestedTrackAgrees;
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

async function loadActivityAdmissionSource(
  authorizedClient: Awaited<ReturnType<typeof verifyPandoSession>>["client"],
  tracksWorkspace: CurrentLearningTracksV1,
  selectedActivityTrackKey: string | undefined,
): Promise<LearningTrackActivityAdmissionSource | undefined> {
  if (tracksWorkspace.learningTracks.length === 1) {
    return loadLearningTrackActivityAdmissionSourceV1(authorizedClient).catch(() => undefined);
  }
  if (selectedActivityTrackKey === undefined) return undefined;
  return loadLearningTrackActivityAdmissionSourceV2(
    authorizedClient,
    selectedActivityTrackKey,
  ).catch(() => undefined);
}

export default async function PlanPage({
  searchParams = Promise.resolve({}),
}: {
  searchParams?: Promise<{ activityTrack?: string }>;
} = {}) {
  const requestedActivityTrackKey = (await searchParams).activityTrack;
  const selectedActivityTrackKey =
    typeof requestedActivityTrackKey === "string" && TRACK_KEY.test(requestedActivityTrackKey)
      ? requestedActivityTrackKey
      : undefined;
  let workspace: CurrentGrowthPlanV1;
  let tracksWorkspace: CurrentLearningTracksV1;
  let setupSource: GrowthPlanSetupSourceV1;
  let learningTrackCreationSource: LearningTrackCreationSourceV1 | undefined;
  let learningTrackCreationUnavailable = false;
  let activityAdmissionSource: LearningTrackActivityAdmissionSource | undefined;
  let activityAdmissionUnavailable = false;
  try {
    const client = await createPandoServerComponentClient();
    const authorizedClient = (await verifyPandoSession(client)).client;
    [workspace, tracksWorkspace, setupSource, learningTrackCreationSource] = await Promise.all([
      loadCurrentGrowthPlanV1(authorizedClient),
      loadCurrentLearningTracksV1(authorizedClient),
      loadGrowthPlanSetupSourceV1(authorizedClient),
      loadLearningTrackCreationSourceV1(authorizedClient).catch(() => undefined),
    ]);
    activityAdmissionSource = await loadActivityAdmissionSource(
      authorizedClient,
      tracksWorkspace,
      selectedActivityTrackKey,
    );
    if (
      !planningReadsAgree(workspace, tracksWorkspace, setupSource) ||
      (learningTrackCreationSource !== undefined &&
        !learningTrackCreationReadAgrees(
          workspace,
          tracksWorkspace,
          learningTrackCreationSource,
        )) ||
      (activityAdmissionSource !== undefined &&
        !activityAdmissionReadAgrees(
          workspace,
          tracksWorkspace,
          activityAdmissionSource,
          selectedActivityTrackKey,
        ))
    ) {
      [workspace, tracksWorkspace, setupSource, learningTrackCreationSource] = await Promise.all([
        loadCurrentGrowthPlanV1(authorizedClient),
        loadCurrentLearningTracksV1(authorizedClient),
        loadGrowthPlanSetupSourceV1(authorizedClient),
        loadLearningTrackCreationSourceV1(authorizedClient).catch(() => undefined),
      ]);
      activityAdmissionSource = await loadActivityAdmissionSource(
        authorizedClient,
        tracksWorkspace,
        selectedActivityTrackKey,
      );
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
      !activityAdmissionReadAgrees(
        workspace,
        tracksWorkspace,
        activityAdmissionSource,
        selectedActivityTrackKey,
      )
    ) {
      activityAdmissionSource = undefined;
    }
    learningTrackCreationUnavailable = learningTrackCreationSource === undefined;
    activityAdmissionUnavailable =
      (tracksWorkspace.learningTracks.length === 1 || selectedActivityTrackKey !== undefined) &&
      activityAdmissionSource === undefined;
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
          {...(selectedActivityTrackKey === undefined
            ? {}
            : { selectedActivityAdmissionTrackKey: selectedActivityTrackKey })}
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
