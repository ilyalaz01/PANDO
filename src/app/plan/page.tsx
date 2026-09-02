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
  loadLearningTrackTerminalLifecycleSourceV1,
} from "../../ui/plan/server/database-plan";
import type {
  CurrentGrowthPlanV1,
  CurrentLearningTracksV1,
  GrowthPlanSetupSourceV1,
  LearningTrackActivityAdmissionSource,
  LearningTrackCreationSourceV1,
  LearningTrackTerminalLifecycleSourceV1,
} from "../../ui/plan/plan-types";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = {
  title: "Plan · PANDO",
  description: "Keep your Growth Plan aligned with changing priorities.",
};

const TRACK_KEY = /^track:[a-z0-9][a-z0-9-]{1,100}$/u;
const HISTORY_CURSOR = /^[A-Za-z0-9+/=]{1,512}$/u;

type PlanSearchParams = {
  readonly activityTrack?: string | string[];
  readonly trackHistoryCursor?: string | string[];
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

function terminalLifecycleReadAgrees(
  workspace: CurrentGrowthPlanV1,
  tracksWorkspace: CurrentLearningTracksV1,
  source: LearningTrackTerminalLifecycleSourceV1,
): boolean {
  const plan = workspace.currentPlan;
  const sourcePlan = source.growthPlan;
  if (plan === null) {
    return (
      source.state === "NO_CURRENT_PLAN" &&
      sourcePlan === null &&
      source.currentTracks.length === 0 &&
      source.terminalHistory.length === 0
    );
  }
  if (
    source.state !== "READY" ||
    sourcePlan === null ||
    sourcePlan.growthPlanId !== plan.growthPlanId ||
    sourcePlan.lifecycle !== plan.lifecycle ||
    sourcePlan.weeklyCapacityMinutes !== plan.weeklyCapacityMinutes ||
    sourcePlan.aggregateVersion !== plan.aggregateVersion ||
    source.currentTracks.length !== tracksWorkspace.learningTracks.length
  ) {
    return false;
  }
  return source.currentTracks.every((track, index) => {
    const current = tracksWorkspace.learningTracks[index];
    return (
      current !== undefined &&
      track.learningTrackId === current.learningTrackId &&
      track.trackKey === current.trackKey &&
      track.title === current.title &&
      track.lifecycle === current.lifecycle &&
      track.priority === current.priority &&
      track.protectedMinimumMinutes === current.protectedMinimumMinutes &&
      track.aggregateVersion === current.aggregateVersion
    );
  });
}

function terminalHistoryNextHref(
  source: LearningTrackTerminalLifecycleSourceV1 | undefined,
  selectedActivityTrackKey: string | undefined,
): string | undefined {
  const cursor = source?.historyPage.nextCursor;
  if (source?.historyPage.hasMore !== true || cursor === null || cursor === undefined) {
    return undefined;
  }
  const parameters = new URLSearchParams();
  if (selectedActivityTrackKey !== undefined) {
    parameters.set("activityTrack", selectedActivityTrackKey);
  }
  parameters.set("trackHistoryCursor", cursor);
  return `/plan?${parameters.toString()}`;
}

function terminalHistoryFirstHref(selectedActivityTrackKey: string | undefined): string {
  if (selectedActivityTrackKey === undefined) return "/plan";
  const parameters = new URLSearchParams({ activityTrack: selectedActivityTrackKey });
  return `/plan?${parameters.toString()}`;
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
  searchParams?: Promise<PlanSearchParams>;
} = {}) {
  const resolvedSearchParams = await searchParams;
  const requestedActivityTrackKey = resolvedSearchParams.activityTrack;
  const selectedActivityTrackKey =
    typeof requestedActivityTrackKey === "string" && TRACK_KEY.test(requestedActivityTrackKey)
      ? requestedActivityTrackKey
      : undefined;
  const requestedHistoryCursor = resolvedSearchParams.trackHistoryCursor;
  const terminalHistoryCursor =
    typeof requestedHistoryCursor === "string" && HISTORY_CURSOR.test(requestedHistoryCursor)
      ? requestedHistoryCursor
      : undefined;
  const malformedHistoryCursor =
    requestedHistoryCursor !== undefined && terminalHistoryCursor === undefined;
  let workspace: CurrentGrowthPlanV1;
  let tracksWorkspace: CurrentLearningTracksV1;
  let setupSource: GrowthPlanSetupSourceV1;
  let learningTrackCreationSource: LearningTrackCreationSourceV1 | undefined;
  let learningTrackCreationUnavailable = false;
  let activityAdmissionSource: LearningTrackActivityAdmissionSource | undefined;
  let activityAdmissionUnavailable = false;
  let terminalLifecycleSource: LearningTrackTerminalLifecycleSourceV1 | undefined;
  let terminalLifecycleUnavailable = malformedHistoryCursor;
  try {
    const client = await createPandoServerComponentClient();
    const authorizedClient = (await verifyPandoSession(client)).client;
    [
      workspace,
      tracksWorkspace,
      setupSource,
      learningTrackCreationSource,
      terminalLifecycleSource,
    ] = await Promise.all([
      loadCurrentGrowthPlanV1(authorizedClient),
      loadCurrentLearningTracksV1(authorizedClient),
      loadGrowthPlanSetupSourceV1(authorizedClient),
      loadLearningTrackCreationSourceV1(authorizedClient).catch(() => undefined),
      malformedHistoryCursor
        ? Promise.resolve(undefined)
        : loadLearningTrackTerminalLifecycleSourceV1(authorizedClient, terminalHistoryCursor).catch(
            () => undefined,
          ),
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
      (terminalLifecycleSource !== undefined &&
        !terminalLifecycleReadAgrees(workspace, tracksWorkspace, terminalLifecycleSource)) ||
      (activityAdmissionSource !== undefined &&
        !activityAdmissionReadAgrees(
          workspace,
          tracksWorkspace,
          activityAdmissionSource,
          selectedActivityTrackKey,
        ))
    ) {
      [
        workspace,
        tracksWorkspace,
        setupSource,
        learningTrackCreationSource,
        terminalLifecycleSource,
      ] = await Promise.all([
        loadCurrentGrowthPlanV1(authorizedClient),
        loadCurrentLearningTracksV1(authorizedClient),
        loadGrowthPlanSetupSourceV1(authorizedClient),
        loadLearningTrackCreationSourceV1(authorizedClient).catch(() => undefined),
        malformedHistoryCursor
          ? Promise.resolve(undefined)
          : loadLearningTrackTerminalLifecycleSourceV1(
              authorizedClient,
              terminalHistoryCursor,
            ).catch(() => undefined),
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
    if (
      terminalLifecycleSource !== undefined &&
      !terminalLifecycleReadAgrees(workspace, tracksWorkspace, terminalLifecycleSource)
    ) {
      terminalLifecycleSource = undefined;
    }
    learningTrackCreationUnavailable = learningTrackCreationSource === undefined;
    terminalLifecycleUnavailable = malformedHistoryCursor || terminalLifecycleSource === undefined;
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
  const terminalHistoryNextPageHref = terminalHistoryNextHref(
    terminalLifecycleSource,
    selectedActivityTrackKey,
  );
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
          {...(terminalLifecycleSource === undefined ? {} : { terminalLifecycleSource })}
          {...(terminalHistoryCursor === undefined ? {} : { terminalHistoryCursor })}
          {...(terminalHistoryNextPageHref === undefined
            ? {}
            : { terminalHistoryNextHref: terminalHistoryNextPageHref })}
          terminalHistoryRecoveryHref={terminalHistoryFirstHref(selectedActivityTrackKey)}
          {...(selectedActivityTrackKey === undefined
            ? {}
            : { selectedActivityAdmissionTrackKey: selectedActivityTrackKey })}
          learningTrackCreationUnavailable={learningTrackCreationUnavailable}
          activityAdmissionUnavailable={activityAdmissionUnavailable}
          terminalLifecycleUnavailable={terminalLifecycleUnavailable}
          setupSource={setupSource}
          tracksWorkspace={tracksWorkspace}
          workspace={workspace}
        />
      </main>
    </div>
  );
}
