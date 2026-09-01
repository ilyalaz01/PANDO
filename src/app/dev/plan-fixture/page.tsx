import { notFound } from "next/navigation";

import type { PlanActionState } from "../../../ui/plan/plan-action-state";
import { initialPlanActionState } from "../../../ui/plan/plan-action-state";
import type {
  CurrentGrowthPlanV1,
  CurrentLearningTracksV1,
  GrowthPlanSetupSourceV1,
  LearningTrackActivityAdmissionSourceV1,
} from "../../../ui/plan/plan-types";
import { PlanWorkspace } from "../../../ui/plan/plan-workspace";
import styles from "../../../ui/plan/plan.module.css";
import { SkipLink } from "../../../ui/primitives/skip-link";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata = {
  title: "Plan interaction fixture · PANDO",
  description: "Test-only representative PANDO Growth Plan lifecycle preview.",
  robots: { index: false, follow: false },
};

const plan = {
  growthPlanId: "30000000-0000-4000-8000-000000000020",
  title: "Backend interview readiness",
  lifecycle: "ACTIVE",
  weeklyCapacityMinutes: 600,
  aggregateVersion: "4",
} as const;

const workspace: CurrentGrowthPlanV1 = {
  contract: { name: "CurrentGrowthPlanV1", version: "1.0.0" },
  currentPlan: plan,
  recalculation: { projectionState: "PENDING", reason: "INPUTS_CHANGED", lastKnownSafe: true },
  capabilities: ["pause_growth_plan"],
};

const tracksWorkspace: CurrentLearningTracksV1 = {
  contract: { name: "CurrentLearningTracksV1", version: "1.0.0" },
  growthPlan: {
    growthPlanId: plan.growthPlanId,
    lifecycle: plan.lifecycle,
    weeklyCapacityMinutes: plan.weeklyCapacityMinutes,
    aggregateVersion: plan.aggregateVersion,
  },
  learningTracks: [
    {
      learningTrackId: "31000000-0000-4000-8000-000000000001",
      trackKey: "track:system-design",
      title: "System design",
      lifecycle: "ACTIVE",
      priority: 9,
      protectedMinimumMinutes: 100,
      aggregateVersion: "2",
      capabilities: ["pause_track"],
    },
    {
      learningTrackId: "31000000-0000-4000-8000-000000000002",
      trackKey: "track:algorithms",
      title: "Algorithms",
      lifecycle: "PAUSED",
      priority: 8,
      protectedMinimumMinutes: 80,
      aggregateVersion: "3",
      capabilities: ["resume_track"],
    },
  ],
};

const activityTracksWorkspace: CurrentLearningTracksV1 = {
  ...tracksWorkspace,
  learningTracks: [tracksWorkspace.learningTracks[0]!],
};

const readyActivitySource: LearningTrackActivityAdmissionSourceV1 = {
  contract: { name: "LearningTrackActivityAdmissionSourceV1", version: "1.0.0" },
  state: "READY",
  capabilities: ["admit_activity_to_learning_track"],
  growthPlan: {
    title: plan.title,
    lifecycle: plan.lifecycle,
    weeklyCapacityMinutes: plan.weeklyCapacityMinutes,
    aggregateVersion: plan.aggregateVersion,
  },
  learningTrack: {
    trackKey: activityTracksWorkspace.learningTracks[0]!.trackKey,
    title: activityTracksWorkspace.learningTracks[0]!.title,
    lifecycle: activityTracksWorkspace.learningTracks[0]!.lifecycle,
    priority: activityTracksWorkspace.learningTracks[0]!.priority,
    protectedMinimumMinutes: activityTracksWorkspace.learningTracks[0]!.protectedMinimumMinutes,
    defaultSessionMinutes: 30,
    aggregateVersion: activityTracksWorkspace.learningTracks[0]!.aggregateVersion,
  },
  activities: [
    {
      activityKey: "activity:sql-practice",
      title: "SQL practice",
      activityType: "MANUAL_CODING",
      targetCompetencyRef: "competency:sql",
    },
  ],
};

function activitySourceState(
  state: Exclude<LearningTrackActivityAdmissionSourceV1["state"], "READY" | "NO_CURRENT_PLAN">,
): LearningTrackActivityAdmissionSourceV1 {
  return {
    ...readyActivitySource,
    state,
    capabilities: [],
    learningTrack:
      state === "CURRENT_TRACK_PORTFOLIO_UNAVAILABLE" ? null : readyActivitySource.learningTrack,
    activities: [],
  };
}

function activityPreviewState(blocked: boolean): PlanActionState {
  return {
    status: "previewed",
    message: blocked
      ? "This Growth Plan has reached its current activity limit."
      : "Activity preview ready. Confirm only if these exact facts are correct.",
    preview: {
      contract: { name: "LearningTrackActivityAdmissionPreviewV1", version: "1.0.0" },
      digestVersion: "learning-track-activity-admission-preview-digest/1.0.0",
      operation: "admit_activity_to_learning_track",
      commandType: "planning.add_learning_track_activity_v2",
      requestId: "50000000-0000-4000-8000-000000000001",
      reason: "Add deliberate SQL practice to this Track.",
      expectedGrowthPlanVersion: plan.aggregateVersion,
      expectedLearningTrackVersion: activityTracksWorkspace.learningTracks[0]!.aggregateVersion,
      growthPlan: readyActivitySource.growthPlan!,
      learningTrack: {
        ...readyActivitySource.learningTrack!,
        aggregateVersionBefore: activityTracksWorkspace.learningTracks[0]!.aggregateVersion,
        aggregateVersionAfter: "3",
      },
      activity: {
        ...readyActivitySource.activities[0]!,
        candidateKey: "candidate:50000000-0000-4000-8000-000000000001",
        estimatedMinutes: 45,
        energy: "MEDIUM",
      },
      constraint: {
        planActivityCountBefore: blocked ? 200 : 2,
        planActivityCountAfter: blocked ? 201 : 3,
        planActivityLimit: 200,
      },
      canApply: !blocked,
      blockingReasons: blocked ? [{ code: "PLAN_ACTIVITY_LIMIT_REACHED" }] : [],
      warnings: [],
      retained: {
        activitiesAndEvidence: true,
        planSnapshots: true,
        focusSessions: true,
        masteryAndReadiness: true,
      },
      recalculationAfterApply: {
        projectionState: "PENDING",
        eventChangeKind: "TRACK_ACTIVITY_ADMITTED",
        consumerName: "planning.plan_snapshot_v1",
      },
      previewDigest: "f".repeat(64),
    },
  };
}

const setupWorkspace: CurrentGrowthPlanV1 = {
  contract: { name: "CurrentGrowthPlanV1", version: "1.0.0" },
  currentPlan: null,
  recalculation: { projectionState: "NOT_STARTED", reason: "INITIALIZING", lastKnownSafe: false },
  capabilities: [],
};

const setupTracksWorkspace: CurrentLearningTracksV1 = {
  contract: { name: "CurrentLearningTracksV1", version: "1.0.0" },
  growthPlan: null,
  learningTracks: [],
};

const setupSource: GrowthPlanSetupSourceV1 = {
  contract: { name: "GrowthPlanSetupSourceV1", version: "1.0.0" },
  state: "SETUP_AVAILABLE",
  capabilities: ["initialize_growth_plan"],
  goals: [
    {
      readinessGoalKey: "goal:backend-interview-readiness",
      title: "Backend interview readiness",
      profileLabel: "Backend interview profile",
      profileVersionKey: "target:backend-interview-v1",
      roadmapPresent: true,
      aggregateVersion: "1",
    },
  ],
};

const initializationPreviewState: PlanActionState = {
  status: "previewed",
  message: "First Plan preview ready. Confirm only if these exact facts are correct.",
  preview: {
    contract: { name: "GrowthPlanInitializationPreviewV1", version: "1.0.0" },
    digestVersion: "growth-plan-initialization-preview-digest/1.0.0",
    identityVersion: "planning-create-identity/1.0.0",
    operation: "initialize_growth_plan",
    commandType: "planning.initialize_growth_plan_v2",
    idempotencyKey: "50000000-0000-8000-8000-000000000001",
    reason: "Set up a realistic first learning plan.",
    expectedReadinessGoalVersion: "1",
    source: {
      readinessGoalId: "51000000-0000-8000-8000-000000000001",
      readinessGoalKey: "goal:backend-interview-readiness",
      readinessGoalTitle: "Backend interview readiness",
      readinessGoalLifecycle: "ACTIVE",
      readinessGoalVersion: "1",
      profileVersionId: "52000000-0000-8000-8000-000000000001",
      profileVersionKey: "target:backend-interview-v1",
      sourceKind: "ROADMAP_TEMPLATE_VERSION",
      sourceRef: "53000000-0000-8000-8000-000000000001",
      roadmapVersionId: "53000000-0000-8000-8000-000000000001",
      sourceOwnerRevision: "readiness-goal:1",
    },
    before: { lifetimePlanCount: 0, currentPlanCount: 0, snapshotSentinelCount: 0 },
    after: {
      lifetimePlanCount: 1,
      currentPlanCount: 1,
      currentPlanLimit: 1,
      snapshotSentinelCount: 1,
      growthPlan: {
        growthPlanId: "54000000-0000-8000-8000-000000000001",
        title: "Backend interview readiness",
        lifecycle: "ACTIVE",
        weeklyCapacityMinutes: 600,
        aggregateVersion: "1",
      },
      learningTrack: {
        learningTrackId: "55000000-0000-8000-8000-000000000001",
        trackKey: "track:backend-interview-readiness",
        title: "Backend interview readiness",
        lifecycle: "ACTIVE",
        priority: 50,
        protectedMinimumMinutes: 0,
        defaultSessionMinutes: 30,
        aggregateVersion: "1",
      },
    },
    canApply: true,
    blockingReasons: [],
    warnings: [{ code: "INITIAL_TRACK_HAS_NO_ACTIVITIES" }],
    retained: {
      readinessGoal: true,
      competencyOverlay: true,
      activitiesAndEvidence: true,
      mastery: true,
      reviews: true,
      history: true,
    },
    recalculationAfterApply: {
      projectionState: "PENDING",
      eventChangeKind: "INITIALIZED",
      consumerName: "planning.plan_snapshot_v1",
    },
    previewDigest: "b".repeat(64),
  },
};

const previewState: PlanActionState = {
  status: "previewed",
  message: "Preview ready. Confirm only if these exact facts are correct.",
  preview: {
    contract: { name: "GrowthPlanLifecyclePreviewV1", version: "1.0.0" },
    operation: "pause_growth_plan",
    reason: "The interview was cancelled; preserve history while priorities change.",
    expectedGrowthPlanVersion: "4",
    before: plan,
    after: { ...plan, lifecycle: "PAUSED", aggregateVersion: "5" },
    retained: { learningTracks: true, planSnapshots: true, focusSessions: true, evidence: true },
    recalculationAfterApply: {
      projectionState: "PENDING",
      consumerName: "planning.plan_snapshot_v1",
    },
    previewDigest: "a".repeat(64),
  },
};

function capacityPreviewState(blocked: boolean): PlanActionState {
  const proposedCapacity = blocked ? 120 : 720;
  return {
    status: "previewed",
    message: blocked
      ? "This capacity conflicts with protected work. Review the required minimum."
      : "Capacity preview ready. Confirm only if these exact facts are correct.",
    preview: {
      contract: { name: "GrowthPlanCapacityPreviewV1", version: "1.0.0" },
      operation: "set_default_capacity",
      reason: blocked ? "Test the protected minimum boundary." : "Study time increased this term.",
      expectedGrowthPlanVersion: "4",
      before: plan,
      after: {
        ...plan,
        weeklyCapacityMinutes: proposedCapacity,
        aggregateVersion: "5",
      },
      constraint: {
        activeTrackCount: 2,
        activeProtectedMinimumMinutes: 180,
        flexibleMinutesBefore: 420,
        flexibleMinutesAfter: proposedCapacity - 180,
        activeTrackFingerprint: "b".repeat(64),
      },
      canApply: !blocked,
      blockingReasons: blocked
        ? [
            {
              code: "ACTIVE_TRACK_MINIMUM_EXCEEDS_CAPACITY",
              minimumCapacityMinutes: 180,
            },
          ]
        : [],
      retained: { learningTracks: true, planSnapshots: true, focusSessions: true, evidence: true },
      recalculationAfterApply: {
        projectionState: "PENDING",
        consumerName: "planning.plan_snapshot_v1",
      },
      previewDigest: "c".repeat(64),
    },
  };
}

function trackPreviewState(blocked: boolean): PlanActionState {
  const before = tracksWorkspace.learningTracks[1]!;
  return {
    status: "previewed",
    message: blocked
      ? "This Track cannot be resumed within the current plan constraints."
      : "Track preview ready. Confirm only if these exact facts are correct.",
    preview: {
      contract: { name: "LearningTrackLifecyclePreviewV1", version: "1.0.0" },
      operation: "resume_track",
      reason: blocked
        ? "Test the protected Track boundary."
        : "Algorithms matter for the next interview cycle.",
      expectedGrowthPlanVersion: "4",
      expectedLearningTrackVersion: "3",
      growthPlan: tracksWorkspace.growthPlan!,
      before: {
        learningTrackId: before.learningTrackId,
        trackKey: before.trackKey,
        title: before.title,
        lifecycle: before.lifecycle,
        priority: before.priority,
        protectedMinimumMinutes: before.protectedMinimumMinutes,
        aggregateVersion: before.aggregateVersion,
      },
      after: {
        learningTrackId: before.learningTrackId,
        trackKey: before.trackKey,
        title: before.title,
        lifecycle: "ACTIVE",
        priority: before.priority,
        protectedMinimumMinutes: before.protectedMinimumMinutes,
        aggregateVersion: "4",
      },
      constraint: {
        activeTrackCountBefore: 1,
        activeTrackCountAfter: 2,
        activeProtectedMinimumMinutesBefore: blocked ? 560 : 100,
        activeProtectedMinimumMinutesAfter: blocked ? 640 : 180,
        flexibleMinutesBefore: blocked ? 40 : 500,
        flexibleMinutesAfter: blocked ? -40 : 420,
        activeTrackFingerprintBefore: "d".repeat(64),
        activeTrackFingerprintAfter: "e".repeat(64),
      },
      canApply: !blocked,
      blockingReasons: blocked
        ? [
            {
              code: "ACTIVE_TRACK_MINIMUM_EXCEEDS_CAPACITY",
              minimumCapacityMinutes: 640,
            },
          ]
        : [],
      warnings: [],
      retained: {
        learningTrackActivities: true,
        planSnapshots: true,
        focusSessions: true,
        evidence: true,
      },
      recalculationAfterApply: {
        projectionState: "PENDING",
        consumerName: "planning.plan_snapshot_v1",
      },
      previewDigest: "d".repeat(64),
    },
  };
}

function trackSettingsPreviewState(blocked: boolean): PlanActionState {
  const before = tracksWorkspace.learningTracks[0]!;
  const proposedMinimum = blocked ? 560 : 120;
  const planForPreview = {
    ...tracksWorkspace.growthPlan!,
    weeklyCapacityMinutes: blocked ? 300 : tracksWorkspace.growthPlan!.weeklyCapacityMinutes,
  };
  return {
    status: "previewed",
    message: blocked
      ? "These active Track settings exceed current weekly capacity."
      : "Track settings preview ready. Confirm only if these exact facts are correct.",
    preview: {
      contract: { name: "LearningTrackPriorityMinimumPreviewV1", version: "1.0.0" },
      operation: "set_track_priority_minimum",
      reason: blocked ? "Test an active capacity block." : "Prioritize systems work this month.",
      expectedGrowthPlanVersion: "4",
      expectedLearningTrackVersion: "2",
      growthPlan: planForPreview,
      before,
      after: {
        ...before,
        priority: 12,
        protectedMinimumMinutes: proposedMinimum,
        aggregateVersion: "3",
      },
      constraint: {
        activeTrackCountBefore: 1,
        activeTrackCountAfter: 1,
        activeProtectedMinimumMinutesBefore: 100,
        activeProtectedMinimumMinutesAfter: proposedMinimum,
        flexibleMinutesBefore: planForPreview.weeklyCapacityMinutes - 100,
        flexibleMinutesAfter: planForPreview.weeklyCapacityMinutes - proposedMinimum,
        activeTrackFingerprintBefore: "e".repeat(64),
        activeTrackFingerprintAfter: "f".repeat(64),
        activeTrackCountIfTargetActiveAfter: 1,
        minimumCapacityIfTargetActiveAfter: proposedMinimum,
        targetActiveStateFitsCapacity: proposedMinimum <= planForPreview.weeklyCapacityMinutes,
        currentTrackPositionBefore: 1,
        currentTrackPositionAfter: 1,
        currentTrackOrderFingerprintBefore: "g".repeat(64),
        currentTrackOrderFingerprintAfter: "h".repeat(64),
      },
      canApply: !blocked,
      blockingReasons: blocked
        ? [
            {
              code: "ACTIVE_TRACK_MINIMUM_EXCEEDS_CAPACITY",
              minimumCapacityMinutes: proposedMinimum,
            },
          ]
        : [],
      warnings: [],
      retained: {
        learningTrackActivities: true,
        planSnapshots: true,
        focusSessions: true,
        evidence: true,
      },
      recalculationAfterApply: {
        projectionState: "PENDING",
        consumerName: "planning.plan_snapshot_v1",
      },
      previewDigest: "a".repeat(64),
    },
  };
}

export default async function PlanFixturePage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly preview?: string }>;
}) {
  if (process.env.PANDO_ENABLE_PLAN_FIXTURE !== "true") notFound();
  const previewKind = (await searchParams).preview ?? "lifecycle";
  const showsCapacity = previewKind === "capacity" || previewKind === "blocked";
  const showsTrack = previewKind === "track" || previewKind === "track-blocked";
  const showsTrackSettings =
    previewKind === "track-settings" || previewKind === "track-settings-blocked";
  const showsInitialization = previewKind === "setup";
  const showsActivity = previewKind.startsWith("activity");
  const activitySource =
    previewKind === "activity-empty"
      ? activitySourceState("NO_ELIGIBLE_ACTIVITIES")
      : previewKind === "activity-limit"
        ? activitySourceState("PLAN_ACTIVITY_LIMIT_REACHED")
        : previewKind === "activity-overflow"
          ? activitySourceState("ELIGIBLE_ACTIVITY_PORTFOLIO_OVERFLOW")
          : previewKind === "activity-unavailable"
            ? activitySourceState("CURRENT_TRACK_PORTFOLIO_UNAVAILABLE")
            : readyActivitySource;
  return (
    <div className={styles.page}>
      <SkipLink targetId="plan-main">Skip to Plan</SkipLink>
      <header className={styles.header}>
        <div>
          <span className={styles.brand}>PANDO</span>
          <span>Automated Plan fixture</span>
        </div>
      </header>
      <main className={styles.main} id="plan-main" tabIndex={-1}>
        <PlanWorkspace
          initialActivityAdmissionPreviewState={
            previewKind === "activity" || previewKind === "activity-blocked"
              ? activityPreviewState(previewKind === "activity-blocked")
              : initialPlanActionState
          }
          initialInitializationPreviewState={
            showsInitialization ? initializationPreviewState : initialPlanActionState
          }
          initialCapacityPreviewState={
            showsCapacity ? capacityPreviewState(previewKind === "blocked") : initialPlanActionState
          }
          initialPreviewState={
            showsCapacity || showsTrack || showsTrackSettings || showsActivity
              ? initialPlanActionState
              : previewState
          }
          initialTrackPreviewState={
            showsTrack ? trackPreviewState(previewKind === "track-blocked") : initialPlanActionState
          }
          initialTrackPriorityMinimumPreviewState={
            showsTrackSettings
              ? trackSettingsPreviewState(previewKind === "track-settings-blocked")
              : initialPlanActionState
          }
          {...(showsInitialization ? { setupSource } : {})}
          {...(showsActivity ? { activityAdmissionSource: activitySource } : {})}
          tracksWorkspace={
            showsInitialization
              ? setupTracksWorkspace
              : showsActivity
                ? activityTracksWorkspace
                : tracksWorkspace
          }
          workspace={showsInitialization ? setupWorkspace : workspace}
        />
      </main>
    </div>
  );
}
