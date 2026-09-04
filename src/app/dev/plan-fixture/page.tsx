import { notFound } from "next/navigation";

import type { PlanActionState } from "../../../ui/plan/plan-action-state";
import { initialPlanActionState } from "../../../ui/plan/plan-action-state";
import type {
  CurrentGrowthPlanV1,
  CurrentLearningTracksV1,
  GrowthPlanSetupSourceV1,
  LearningTrackCreationSourceV1,
  LearningTrackActivityAdmissionSourceV1,
  LearningTrackActivityAdmissionSourceV2,
  LearningTrackTerminalLifecycleSourceV1,
  LearningTrackCadenceSourceV1,
  GrowthPlanReplacementSourceV1,
  AvailabilityWindowSourceV1,
} from "../../../ui/plan/plan-types";
import { PlanWorkspace } from "../../../ui/plan/plan-workspace";
import { buildCapacityEffectPreview } from "../../../ui/plan/server/capacity-effect-preview";
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

const readyActivitySourceV2: LearningTrackActivityAdmissionSourceV2 = {
  contract: { name: "LearningTrackActivityAdmissionSourceV2", version: "2.0.0" },
  state: "READY",
  capabilities: ["admit_activity_to_learning_track"],
  growthPlan: readyActivitySource.growthPlan,
  selectedTrack: {
    trackKey: tracksWorkspace.learningTracks[1]!.trackKey,
    title: tracksWorkspace.learningTracks[1]!.title,
    lifecycle: tracksWorkspace.learningTracks[1]!.lifecycle,
    priority: tracksWorkspace.learningTracks[1]!.priority,
    protectedMinimumMinutes: tracksWorkspace.learningTracks[1]!.protectedMinimumMinutes,
    defaultSessionMinutes: 45,
    aggregateVersion: tracksWorkspace.learningTracks[1]!.aggregateVersion,
  },
  activities: [
    {
      activityKey: "activity:graph-practice",
      title: "Graph practice",
      activityType: "PROJECT",
      targetCompetencyRef: "competency:graphs",
    },
  ],
};

const readyCreationSource: LearningTrackCreationSourceV1 = {
  contract: { name: "LearningTrackCreationSourceV1", version: "1.0.0" },
  state: "READY",
  capabilities: ["create_learning_track"],
  growthPlan: {
    title: plan.title,
    lifecycle: plan.lifecycle,
    weeklyCapacityMinutes: plan.weeklyCapacityMinutes,
    aggregateVersion: plan.aggregateVersion,
  },
  trackPortfolio: { currentTrackCount: 2, currentTrackLimit: 30 },
  goals: [
    {
      readinessGoalKey: "goal:backend-interview-readiness",
      title: "Backend interview readiness",
      profileLabel: "Backend interview profile",
      profileVersionKey: "target:backend-interview-v1",
      roadmapPresent: true,
      aggregateVersion: "1",
    },
    {
      readinessGoalKey: "goal:algorithms-sprint",
      title: "Algorithms sprint",
      profileLabel: "Backend interview profile",
      profileVersionKey: "target:backend-interview-v1",
      roadmapPresent: false,
      aggregateVersion: "2",
    },
  ],
};

const terminalLifecycleSource: LearningTrackTerminalLifecycleSourceV1 = {
  contract: { name: "LearningTrackTerminalLifecycleSourceV1", version: "1.0.0" },
  state: "READY",
  growthPlan: tracksWorkspace.growthPlan,
  currentTracks: tracksWorkspace.learningTracks.map((track) => ({
    learningTrackId: track.learningTrackId,
    trackKey: track.trackKey,
    title: track.title,
    lifecycle: track.lifecycle,
    priority: track.priority,
    protectedMinimumMinutes: track.protectedMinimumMinutes,
    aggregateVersion: track.aggregateVersion,
    capabilities: ["complete_track", "archive_track"],
  })),
  terminalHistory: [
    {
      learningTrackId: "31000000-0000-4000-8000-000000000011",
      trackKey: "track:database-foundations",
      title: "Database foundations",
      lifecycle: "COMPLETED",
      priority: 7,
      protectedMinimumMinutes: 60,
      aggregateVersion: "5",
      updatedAt: "2026-09-01T10:00:00.000Z",
      capabilities: ["archive_track"],
    },
    {
      learningTrackId: "31000000-0000-4000-8000-000000000012",
      trackKey: "track:legacy-cloud-course",
      title: "Legacy cloud course",
      lifecycle: "ARCHIVED",
      priority: 6,
      protectedMinimumMinutes: 30,
      aggregateVersion: "4",
      updatedAt: "2026-08-20T10:00:00.000Z",
      capabilities: [],
    },
  ],
  historyPage: { hasMore: true, nextCursor: "dGVybWluYWwtaGlzdG9yeS1wYWdlLTI=" },
};

const terminalLifecycleSourcePageTwo: LearningTrackTerminalLifecycleSourceV1 = {
  ...terminalLifecycleSource,
  terminalHistory: [
    {
      learningTrackId: "31000000-0000-4000-8000-000000000013",
      trackKey: "track:retired-distributed-systems",
      title: "Retired distributed systems course",
      lifecycle: "ARCHIVED",
      priority: 5,
      protectedMinimumMinutes: 45,
      aggregateVersion: "6",
      updatedAt: "2026-07-10T10:00:00.000Z",
      capabilities: [],
    },
  ],
  historyPage: { hasMore: false, nextCursor: null },
};

const cadenceSource: LearningTrackCadenceSourceV1 = {
  contract: { name: "LearningTrackCadenceSourceV1", version: "1.0.0" },
  growthPlan: tracksWorkspace.growthPlan,
  progress: {
    state: "CURRENT",
    snapshotId: "31000000-0000-4000-8000-000000000021",
    appliedAttemptId: "31000000-0000-4000-8000-000000000022",
    inputFingerprint: `planning-input:${"a".repeat(64)}`,
    calculatedAsOf: "2026-09-02T10:00:00.000Z",
  },
  learningTracks: tracksWorkspace.learningTracks.map((track, index) => ({
    learningTrackId: track.learningTrackId,
    trackKey: track.trackKey,
    title: track.title,
    lifecycle: track.lifecycle,
    priority: track.priority,
    protectedMinimumMinutes: track.protectedMinimumMinutes,
    cadencePerWeek: index === 0 ? 2 : 0,
    aggregateVersion: track.aggregateVersion,
    completedCadenceSessionsThisWeek: index === 0 ? 1 : 0,
    capabilities: ["set_track_cadence"],
  })),
};

const replacementSource: GrowthPlanReplacementSourceV1 = {
  contract: { name: "GrowthPlanReplacementSourceV1", version: "1.0.0" },
  state: "REPLACEMENT_AVAILABLE",
  capabilities: ["replace_growth_plan"],
  currentPlan: {
    title: plan.title,
    lifecycle: plan.lifecycle,
    weeklyCapacityMinutes: plan.weeklyCapacityMinutes,
    aggregateVersion: plan.aggregateVersion,
    childTracks: { total: 3, active: 1, paused: 1, completed: 1, archived: 0 },
  },
  goals: [
    {
      readinessGoalKey: "goal:backend-interview-readiness",
      title: "Backend interview readiness",
      profileLabel: "Backend Engineer at Northwind",
      profileVersionKey: "target:backend-engineer-v1",
      roadmapPresent: true,
      aggregateVersion: "3",
    },
  ],
};

const replacementPreviewState: PlanActionState = {
  status: "previewed",
  message: "Replacement preview ready. Confirm only if these exact facts are correct.",
  preview: {
    contract: { name: "GrowthPlanReplacementPreviewV1", version: "1.0.0" },
    digestVersion: "growth-plan-replacement-preview-digest/1.0.0",
    identityVersion: "planning-create-identity/1.0.0",
    operation: "replace_growth_plan",
    commandType: "planning.replace_growth_plan_v1",
    idempotencyKey: "32000000-0000-4000-8000-000000000031",
    reason: "Switching my long-term direction.",
    expectedReadinessGoalVersion: "3",
    expectedGrowthPlanVersion: plan.aggregateVersion,
    source: {
      readinessGoalId: "32000000-0000-4000-8000-000000000032",
      readinessGoalKey: "goal:backend-interview-readiness",
      readinessGoalTitle: "Backend interview readiness",
      readinessGoalLifecycle: "ACTIVE",
      readinessGoalVersion: "3",
      profileVersionId: "32000000-0000-4000-8000-000000000033",
      profileVersionKey: "target:backend-engineer-v1",
      sourceKind: "ROADMAP_TEMPLATE_VERSION",
      sourceRef: "32000000-0000-4000-8000-000000000034",
      roadmapVersionId: "32000000-0000-4000-8000-000000000034",
      sourceOwnerRevision: "readiness-goal:3",
    },
    before: {
      lifetimePlanCount: 1,
      currentPlanCount: 1,
      growthPlan: {
        growthPlanId: plan.growthPlanId,
        title: plan.title,
        lifecycle: plan.lifecycle,
        weeklyCapacityMinutes: plan.weeklyCapacityMinutes,
        aggregateVersion: plan.aggregateVersion,
      },
      childTracks: {
        total: 3,
        active: 1,
        paused: 1,
        completed: 1,
        archived: 0,
        fingerprint: "b".repeat(64),
      },
    },
    after: {
      lifetimePlanCount: 2,
      currentPlanCount: 1,
      currentPlanLimit: 1,
      archivedPlan: {
        growthPlanId: plan.growthPlanId,
        title: plan.title,
        lifecycle: "ARCHIVED",
        weeklyCapacityMinutes: plan.weeklyCapacityMinutes,
        aggregateVersion: String(Number(plan.aggregateVersion) + 1),
      },
      growthPlan: {
        growthPlanId: "32000000-0000-8000-8000-000000000035",
        title: "Backend interview readiness",
        lifecycle: "ACTIVE",
        weeklyCapacityMinutes: 480,
        aggregateVersion: "1",
      },
      learningTrack: {
        learningTrackId: "32000000-0000-8000-8000-000000000036",
        trackKey: "track:32000000-0000-8000-8000-000000000036",
        title: "Backend interview readiness",
        lifecycle: "ACTIVE",
        priority: 50,
        protectedMinimumMinutes: 0,
        cadencePerWeek: 0,
        defaultSessionMinutes: 30,
        aggregateVersion: "1",
      },
    },
    canApply: true,
    blockingReasons: [],
    warnings: [
      { code: "ARCHIVED_PLAN_IS_READ_ONLY" },
      { code: "CURRENT_TRACKS_NOT_COPIED" },
      { code: "INITIAL_TRACK_HAS_NO_ACTIVITIES" },
    ],
    retained: {
      readinessGoal: true,
      archivedPlan: true,
      learningTrackHistory: true,
      activitiesAndEvidence: true,
      mastery: true,
      reviews: true,
      planSnapshots: true,
    },
    recalculationAfterApply: {
      projectionState: "PENDING",
      eventChangeKind: "PLAN_REPLACED",
      consumerName: "planning.plan_snapshot_v1",
    },
    previewDigest: "c".repeat(64),
  },
};

const cadencePreviewState: PlanActionState = {
  status: "previewed",
  message: "Track cadence preview ready. Confirm only if these exact facts are correct.",
  preview: {
    contract: { name: "LearningTrackCadencePreviewV1", version: "1.0.0" },
    operation: "set_track_cadence",
    reason: "Build a steady systems practice rhythm.",
    expectedGrowthPlanVersion: plan.aggregateVersion,
    expectedLearningTrackVersion: tracksWorkspace.learningTracks[0]!.aggregateVersion,
    growthPlan: tracksWorkspace.growthPlan!,
    before: {
      learningTrackId: cadenceSource.learningTracks[0]!.learningTrackId,
      trackKey: cadenceSource.learningTracks[0]!.trackKey,
      title: cadenceSource.learningTracks[0]!.title,
      lifecycle: cadenceSource.learningTracks[0]!.lifecycle,
      priority: cadenceSource.learningTracks[0]!.priority,
      protectedMinimumMinutes: cadenceSource.learningTracks[0]!.protectedMinimumMinutes,
      cadencePerWeek: 2,
      aggregateVersion: cadenceSource.learningTracks[0]!.aggregateVersion,
    },
    after: {
      learningTrackId: cadenceSource.learningTracks[0]!.learningTrackId,
      trackKey: cadenceSource.learningTracks[0]!.trackKey,
      title: cadenceSource.learningTracks[0]!.title,
      lifecycle: cadenceSource.learningTracks[0]!.lifecycle,
      priority: cadenceSource.learningTracks[0]!.priority,
      protectedMinimumMinutes: cadenceSource.learningTracks[0]!.protectedMinimumMinutes,
      cadencePerWeek: 3,
      aggregateVersion: "3",
    },
    progress: {
      ...cadenceSource.progress,
      completedCadenceSessionsThisWeek: 1,
      beforeCadenceDeficit: 1,
      afterCadenceDeficit: 2,
    },
    canApply: true,
    blockingReasons: [],
    warnings: [],
    unchanged: {
      priority: true,
      protectedMinimumMinutes: true,
      learningTrackActivities: true,
      planSnapshots: true,
      focusSessions: true,
      evidence: true,
      masteryAndReadiness: true,
      review: true,
    },
    recalculationAfterApply: {
      projectionState: "PENDING",
      consumerName: "planning.plan_snapshot_v1",
    },
    previewDigest: "9".repeat(64),
  },
};

const terminalLifecyclePreviewState: PlanActionState = {
  status: "previewed",
  message: "Terminal Track preview ready. Confirm only if these exact facts are correct.",
  preview: {
    contract: { name: "LearningTrackTerminalLifecyclePreviewV1", version: "1.0.0" },
    operation: "complete_track",
    reason: "The interview cycle ended, so this lane is no longer current work.",
    expectedGrowthPlanVersion: plan.aggregateVersion,
    expectedLearningTrackVersion: tracksWorkspace.learningTracks[0]!.aggregateVersion,
    growthPlan: tracksWorkspace.growthPlan!,
    before: {
      learningTrackId: tracksWorkspace.learningTracks[0]!.learningTrackId,
      trackKey: tracksWorkspace.learningTracks[0]!.trackKey,
      title: tracksWorkspace.learningTracks[0]!.title,
      lifecycle: tracksWorkspace.learningTracks[0]!.lifecycle,
      priority: tracksWorkspace.learningTracks[0]!.priority,
      protectedMinimumMinutes: tracksWorkspace.learningTracks[0]!.protectedMinimumMinutes,
      aggregateVersion: tracksWorkspace.learningTracks[0]!.aggregateVersion,
    },
    after: {
      learningTrackId: tracksWorkspace.learningTracks[0]!.learningTrackId,
      trackKey: tracksWorkspace.learningTracks[0]!.trackKey,
      title: tracksWorkspace.learningTracks[0]!.title,
      lifecycle: "COMPLETED",
      priority: tracksWorkspace.learningTracks[0]!.priority,
      protectedMinimumMinutes: tracksWorkspace.learningTracks[0]!.protectedMinimumMinutes,
      aggregateVersion: "3",
    },
    currentPortfolio: {
      countBefore: 2,
      countAfter: 1,
      orderFingerprintBefore: "a".repeat(64),
      orderFingerprintAfter: "b".repeat(64),
    },
    activeConstraint: {
      activeTrackCountBefore: 1,
      activeTrackCountAfter: 0,
      activeProtectedMinimumMinutesBefore: 100,
      activeProtectedMinimumMinutesAfter: 0,
      flexibleMinutesBefore: 500,
      flexibleMinutesAfter: 600,
      activeTrackFingerprintBefore: "c".repeat(64),
      activeTrackFingerprintAfter: "d".repeat(64),
    },
    visibilityBefore: "CURRENT_PLAN",
    visibilityAfter: "TERMINAL_HISTORY",
    canApply: true,
    blockingReasons: [],
    warnings: [{ code: "TRACK_COMPLETION_IS_TERMINAL_AND_NOT_MASTERY" }],
    retained: {
      learningTrackActivities: true,
      focusSessions: true,
      evidence: true,
      masteryAndReadiness: true,
      reviewItems: true,
      planSnapshots: true,
      trackHistory: true,
    },
    doesNotAssert: {
      evidence: true,
      mastery: true,
      readiness: true,
      goalCompletion: true,
    },
    recalculationAfterApply: {
      projectionState: "PENDING",
      consumerName: "planning.plan_snapshot_v1",
    },
    previewDigest: "e".repeat(64),
  },
};

const availabilityWindowSource: AvailabilityWindowSourceV1 = {
  contract: { name: "AvailabilityWindowSourceV1", version: "1.0.0" },
  state: "AVAILABILITY_AVAILABLE",
  capabilities: [
    "create_availability_window",
    "change_availability_window",
    "remove_availability_window",
  ],
  growthPlan: {
    lifecycle: plan.lifecycle,
    weeklyCapacityMinutes: plan.weeklyCapacityMinutes,
    aggregateVersion: plan.aggregateVersion,
    timeZone: "America/New_York",
    currentLocalDate: "2026-09-04",
    activeWindowCount: 1,
    activeWindowLimit: 60,
    removedWindowCount: 1,
    capacityUsesAvailability: false,
  },
  availabilityWindows: [
    {
      windowKey: "window:60000001-0000-8000-8000-000000000001",
      startsOn: "2026-11-01",
      endsOn: "2026-11-05",
      timeZone: "America/New_York",
      availableMinutes: 240,
      energy: "MEDIUM",
      label: "Conference travel",
      lifecycle: "ACTIVE",
      aggregateVersion: "2",
    },
  ],
  removedAvailabilityWindows: [],
};

/**
 * A separate, dedicated source for the `?preview=capacity-effect` fixture: its window covers the
 * rolling seven-day estimate window starting at `currentLocalDate` (unlike `availabilityWindowSource`
 * above, whose window is two months out and so never limits that fixture's estimate), so the D3b2
 * capacity-effect preview actually demonstrates rationing. Built through the real
 * `buildCapacityEffectPreview` adapter below, not hand-authored, so this fixture also exercises the
 * production composition path end to end.
 */
const capacityEffectAvailabilitySource: AvailabilityWindowSourceV1 = {
  ...availabilityWindowSource,
  availabilityWindows: [
    {
      windowKey: "window:60000010-0000-8000-8000-000000000010",
      startsOn: "2026-09-04",
      endsOn: "2026-09-10",
      timeZone: "America/New_York",
      availableMinutes: 10,
      energy: "LOW",
      label: "Interview travel",
      lifecycle: "ACTIVE",
      aggregateVersion: "1",
    },
  ],
};

const capacityEffectPreview = buildCapacityEffectPreview(
  capacityEffectAvailabilitySource,
  tracksWorkspace,
);

const availabilityWindowPreviewState: PlanActionState = {
  status: "previewed",
  message: "Availability preview ready. Confirm only if these exact facts are correct.",
  preview: {
    contract: { name: "AvailabilityWindowPreviewV1", version: "1.0.0" },
    digestVersion: "availability-window-preview-digest/1.0.0",
    identityVersion: "planning-create-identity/1.0.0",
    operation: "create_availability_window",
    commandType: "planning.change_availability_window_v1",
    idempotencyKey: "60000000-0000-4000-8000-000000000002",
    reason: "Block off finals week",
    expectedGrowthPlanVersion: plan.aggregateVersion,
    growthPlan: {
      growthPlanId: plan.growthPlanId,
      lifecycle: plan.lifecycle,
      weeklyCapacityMinutes: plan.weeklyCapacityMinutes,
      aggregateVersion: plan.aggregateVersion,
    },
    before: {
      activeWindowCount: 1,
      removedWindowCount: 1,
      activeWindowFingerprint: "a".repeat(64),
      window: null,
    },
    after: {
      activeWindowCount: 2,
      window: {
        windowKey: "window:60000002-0000-8000-8000-000000000002",
        availabilityWindowId: "60000002-0000-8000-8000-000000000002",
        startsOn: "2026-12-15",
        endsOn: "2026-12-19",
        timeZone: "America/New_York",
        availableMinutes: 120,
        energy: "LOW",
        label: "Finals week",
        lifecycle: "ACTIVE",
        aggregateVersion: "1",
      },
    },
    canApply: true,
    blockingReasons: [],
    warnings: [{ code: "AVAILABILITY_NOT_YET_APPLIED_TO_CAPACITY" }],
    retained: {
      growthPlan: true,
      learningTracks: true,
      activitiesAndEvidence: true,
      mastery: true,
      reviews: true,
      planSnapshots: true,
    },
    recalculationAfterApply: {
      projectionState: "PENDING",
      eventChangeKind: "AVAILABILITY_CHANGED",
      consumerName: "planning.plan_snapshot_v1",
    },
    previewDigest: "b".repeat(64),
  },
};

function creationSourceState(
  state: Exclude<LearningTrackCreationSourceV1["state"], "READY" | "NO_CURRENT_PLAN">,
): LearningTrackCreationSourceV1 {
  return {
    ...readyCreationSource,
    state,
    capabilities: [],
    trackPortfolio:
      state === "NO_ACTIVE_GOALS" || state === "GOAL_PORTFOLIO_OVERFLOW"
        ? readyCreationSource.trackPortfolio
        : {
            currentTrackCount: 30,
            currentTrackLimit: 30,
          },
    goals: state === "TRACK_PORTFOLIO_LIMIT_REACHED" ? readyCreationSource.goals : [],
  };
}

function creationPreviewState(blocked: boolean): PlanActionState {
  return {
    status: "previewed",
    message: blocked
      ? "This additional Learning Track is no longer applicable. Reload and start again."
      : "Track creation preview ready. Confirm only if these exact facts are correct.",
    preview: {
      contract: { name: "LearningTrackCreationPreviewV1", version: "1.0.0" },
      digestVersion: "learning-track-creation-preview-digest/1.0.0",
      identityVersion: "planning-create-identity/1.0.0",
      operation: "create_learning_track",
      commandType: "planning.create_learning_track_v1",
      requestId: "50000000-0000-4000-8000-000000000021",
      reason: blocked
        ? "Test the track portfolio boundary."
        : "Split algorithms practice into its own lane.",
      expectedGrowthPlanVersion: plan.aggregateVersion,
      expectedReadinessGoalVersion: "2",
      growthPlan: readyCreationSource.growthPlan!,
      source: {
        readinessGoalId: "56000000-0000-8000-8000-000000000001",
        readinessGoalKey: "goal:algorithms-sprint",
        readinessGoalTitle: "Algorithms sprint",
        readinessGoalLifecycle: "ACTIVE",
        readinessGoalVersion: "2",
        profileVersionId: "57000000-0000-8000-8000-000000000001",
        profileVersionKey: "target:backend-interview-v1",
        sourceKind: "TARGET_PROFILE_REQUIREMENT_COLLECTION",
        sourceRef: "57000000-0000-8000-8000-000000000001",
        roadmapVersionId: null,
        sourceOwnerRevision: "readiness-goal:2",
      },
      constraint: {
        currentTrackCountBefore: blocked ? 30 : 2,
        currentTrackCountAfter: blocked ? 31 : 3,
        currentTrackLimit: 30,
        activeProtectedMinimumMinutesBefore: 100,
        activeProtectedMinimumMinutesAfter: 100,
        flexibleMinutesBefore: 500,
        flexibleMinutesAfter: 500,
        currentTrackOrderFingerprintBefore: "k".repeat(64),
        currentTrackOrderFingerprintAfter: "l".repeat(64),
        newTrackPosition: blocked ? 31 : 2,
      },
      learningTrack: {
        learningTrackId: "58000000-0000-8000-8000-000000000001",
        trackKey: "track:58000000-0000-8000-8000-000000000001",
        title: blocked ? "Overflow lane" : "Algorithms sprint",
        lifecycle: "ACTIVE",
        priority: 80,
        protectedMinimumMinutes: 0,
        defaultSessionMinutes: 45,
        aggregateVersion: "1",
      },
      canApply: !blocked,
      blockingReasons: blocked ? [{ code: "TRACK_PORTFOLIO_LIMIT_REACHED" }] : [],
      warnings: [{ code: "TRACK_STARTS_EMPTY" }],
      retained: {
        planHistory: true,
        trackHistory: true,
        activitiesAndEvidence: true,
        masteryAndReadiness: true,
        reviewQueue: true,
        planSnapshots: true,
      },
      recalculationAfterApply: {
        projectionState: "PENDING",
        eventChangeKind: "TRACK_CREATED",
        consumerName: "planning.plan_snapshot_v1",
      },
      previewDigest: "m".repeat(64),
    },
  };
}

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

function activitySourceStateV2(
  state: Exclude<LearningTrackActivityAdmissionSourceV2["state"], "READY" | "NO_CURRENT_PLAN">,
): LearningTrackActivityAdmissionSourceV2 {
  return {
    ...readyActivitySourceV2,
    state,
    capabilities: [],
    selectedTrack:
      state === "CURRENT_TRACK_PORTFOLIO_UNAVAILABLE" ||
      state === "NO_CURRENT_TRACKS" ||
      state === "SELECTED_TRACK_UNAVAILABLE"
        ? null
        : readyActivitySourceV2.selectedTrack,
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

function activityPreviewStateV2(blocked: boolean): PlanActionState {
  return {
    status: "previewed",
    message: blocked
      ? "This Growth Plan has reached its current activity limit."
      : "Activity preview ready. Confirm only if these exact facts are correct.",
    preview: {
      contract: { name: "LearningTrackActivityAdmissionPreviewV2", version: "2.0.0" },
      digestVersion: "learning-track-activity-admission-preview-digest/2.0.0",
      operation: "admit_activity_to_learning_track",
      commandType: "planning.add_learning_track_activity_v3",
      requestId: "50000000-0000-4000-8000-000000000031",
      reason: "Add graph practice to the Algorithms Track.",
      expectedGrowthPlanVersion: plan.aggregateVersion,
      expectedLearningTrackVersion: tracksWorkspace.learningTracks[1]!.aggregateVersion,
      growthPlan: readyActivitySourceV2.growthPlan!,
      learningTrack: {
        ...readyActivitySourceV2.selectedTrack!,
        aggregateVersionBefore: tracksWorkspace.learningTracks[1]!.aggregateVersion,
        aggregateVersionAfter: "4",
      },
      activity: {
        ...readyActivitySourceV2.activities[0]!,
        candidateKey: "candidate:50000000-0000-4000-8000-000000000031",
        estimatedMinutes: 60,
        energy: "HIGH",
      },
      constraint: {
        planActivityCountBefore: blocked ? 200 : 2,
        planActivityCountAfter: blocked ? 201 : 3,
        planActivityLimit: 200,
        currentTrackOrderFingerprint: "a".repeat(64),
      },
      canApply: !blocked,
      blockingReasons: blocked ? [{ code: "PLAN_ACTIVITY_LIMIT_REACHED" }] : [],
      warnings: [{ code: "LEARNING_TRACK_PAUSED" }],
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
      previewDigest: "c".repeat(64),
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
  const showsCreation = previewKind.startsWith("track-create");
  const showsActivity = previewKind.startsWith("activity");
  const showsActivityV2 = previewKind.startsWith("activity-v2");
  const showsTerminal = previewKind.startsWith("terminal");
  const showsCadence = previewKind.startsWith("track-cadence");
  const showsReplacement = previewKind.startsWith("plan-replacement");
  const showsAvailability = previewKind === "availability";
  const showsCapacityEffect = previewKind === "capacity-effect";
  const creationSource =
    previewKind === "track-create-no-goals"
      ? creationSourceState("NO_ACTIVE_GOALS")
      : previewKind === "track-create-overflow"
        ? creationSourceState("GOAL_PORTFOLIO_OVERFLOW")
        : previewKind === "track-create-limit"
          ? creationSourceState("TRACK_PORTFOLIO_LIMIT_REACHED")
          : readyCreationSource;
  const activitySource = showsActivityV2
    ? previewKind === "activity-v2-empty"
      ? activitySourceStateV2("NO_ELIGIBLE_ACTIVITIES")
      : previewKind === "activity-v2-limit"
        ? activitySourceStateV2("PLAN_ACTIVITY_LIMIT_REACHED")
        : previewKind === "activity-v2-overflow"
          ? activitySourceStateV2("ELIGIBLE_ACTIVITY_PORTFOLIO_OVERFLOW")
          : previewKind === "activity-v2-stale"
            ? activitySourceStateV2("SELECTED_TRACK_UNAVAILABLE")
            : readyActivitySourceV2
    : previewKind === "activity-empty"
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
          initialLearningTrackCreationPreviewState={
            previewKind === "track-create" || previewKind === "track-create-blocked"
              ? creationPreviewState(previewKind === "track-create-blocked")
              : initialPlanActionState
          }
          initialActivityAdmissionPreviewState={
            previewKind === "activity-v2" || previewKind === "activity-v2-blocked"
              ? activityPreviewStateV2(previewKind === "activity-v2-blocked")
              : previewKind === "activity" || previewKind === "activity-blocked"
                ? activityPreviewState(previewKind === "activity-blocked")
                : initialPlanActionState
          }
          initialTerminalLifecyclePreviewState={
            previewKind === "terminal" ? terminalLifecyclePreviewState : initialPlanActionState
          }
          initialCadencePreviewState={
            previewKind === "track-cadence" ? cadencePreviewState : initialPlanActionState
          }
          initialReplacementPreviewState={
            previewKind === "plan-replacement" ? replacementPreviewState : initialPlanActionState
          }
          initialAvailabilityWindowPreviewState={
            showsAvailability ? availabilityWindowPreviewState : initialPlanActionState
          }
          initialInitializationPreviewState={
            showsInitialization ? initializationPreviewState : initialPlanActionState
          }
          initialCapacityPreviewState={
            showsCapacity ? capacityPreviewState(previewKind === "blocked") : initialPlanActionState
          }
          initialPreviewState={
            showsCapacity ||
            showsTrack ||
            showsTrackSettings ||
            showsCreation ||
            showsActivity ||
            showsTerminal ||
            showsCadence ||
            showsReplacement ||
            showsAvailability ||
            showsCapacityEffect
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
          {...(showsCreation ? { learningTrackCreationSource: creationSource } : {})}
          {...(showsActivity && previewKind !== "activity-v2-unselected"
            ? { activityAdmissionSource: activitySource }
            : {})}
          {...(showsActivityV2 && previewKind !== "activity-v2-unselected"
            ? {
                selectedActivityAdmissionTrackKey:
                  previewKind === "activity-v2-stale"
                    ? "track:retired"
                    : tracksWorkspace.learningTracks[1]!.trackKey,
              }
            : {})}
          {...(showsTerminal
            ? {
                terminalLifecycleSource:
                  previewKind === "terminal-history-page-2"
                    ? terminalLifecycleSourcePageTwo
                    : terminalLifecycleSource,
                ...(previewKind === "terminal"
                  ? {
                      terminalHistoryNextHref: "/dev/plan-fixture?preview=terminal-history-page-2",
                    }
                  : {}),
              }
            : {})}
          {...(showsCadence ? { cadenceSource } : {})}
          {...(showsReplacement ? { replacementSource } : {})}
          {...(showsAvailability ? { availabilityWindowSource } : {})}
          {...(showsCapacityEffect
            ? { availabilityWindowSource: capacityEffectAvailabilitySource }
            : {})}
          {...(showsCapacityEffect && capacityEffectPreview !== null
            ? { capacityEffectPreview }
            : {})}
          tracksWorkspace={
            showsInitialization
              ? setupTracksWorkspace
              : showsActivity && !showsActivityV2
                ? activityTracksWorkspace
                : tracksWorkspace
          }
          workspace={showsInitialization ? setupWorkspace : workspace}
        />
      </main>
    </div>
  );
}
