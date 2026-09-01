import { notFound } from "next/navigation";

import type { PlanActionState } from "../../../ui/plan/plan-action-state";
import { initialPlanActionState } from "../../../ui/plan/plan-action-state";
import type { CurrentGrowthPlanV1, CurrentLearningTracksV1 } from "../../../ui/plan/plan-types";
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

export default async function PlanFixturePage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly preview?: string }>;
}) {
  if (process.env.PANDO_ENABLE_PLAN_FIXTURE !== "true") notFound();
  const previewKind = (await searchParams).preview ?? "lifecycle";
  const showsCapacity = previewKind === "capacity" || previewKind === "blocked";
  const showsTrack = previewKind === "track" || previewKind === "track-blocked";
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
          initialCapacityPreviewState={
            showsCapacity ? capacityPreviewState(previewKind === "blocked") : initialPlanActionState
          }
          initialPreviewState={showsCapacity || showsTrack ? initialPlanActionState : previewState}
          initialTrackPreviewState={
            showsTrack ? trackPreviewState(previewKind === "track-blocked") : initialPlanActionState
          }
          tracksWorkspace={tracksWorkspace}
          workspace={workspace}
        />
      </main>
    </div>
  );
}
