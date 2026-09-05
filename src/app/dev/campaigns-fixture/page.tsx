import { notFound } from "next/navigation";

import { CampaignWorkspace } from "../../../ui/campaigns/campaign-workspace";
import { initialCampaignActionState } from "../../../ui/campaigns/campaign-action-state";
import type { CampaignActionState } from "../../../ui/campaigns/campaign-action-state";
import type {
  ActiveReadinessGoalV1,
  AvailableLearningTrackV1,
  CampaignAllocationOverrideSummaryV1,
  InterviewCampaignCreationPreviewV1,
  InterviewCampaignSummaryV1,
} from "../../../ui/campaigns/campaign-types";
import styles from "../../../ui/campaigns/campaigns.module.css";
import { SkipLink } from "../../../ui/primitives/skip-link";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata = {
  title: "Interview Campaigns fixture · PANDO",
  description: "Test-only representative PANDO Interview Campaign lifecycle preview.",
  robots: { index: false, follow: false },
};

const activeCampaign: InterviewCampaignSummaryV1 = {
  campaignKey: "campaign:70000000-0000-8000-8000-000000000001",
  title: "Acme backend loop",
  lifecycle: "ACTIVE",
  readinessGoal: { readinessGoalKey: "goal:backend-readiness", title: "Backend readiness" },
  deadline: {
    localDate: "2026-12-15",
    timeZone: "America/New_York",
    at: "2026-12-16T05:00:00.000Z",
    passed: false,
    daysUntil: 102,
  },
  aggregateVersion: "2",
  capabilities: [
    "cancel_campaign",
    "change_campaign_deadline",
    "change_campaign_target",
    "end_campaign",
  ],
};

const draftCampaign: InterviewCampaignSummaryV1 = {
  campaignKey: "campaign:70000000-0000-8000-8000-000000000003",
  title: "Draft loop",
  lifecycle: "DRAFT",
  readinessGoal: { readinessGoalKey: "goal:frontend-readiness", title: "Frontend readiness" },
  deadline: {
    localDate: "2026-10-01",
    timeZone: "UTC",
    at: "2026-10-02T00:00:00.000Z",
    passed: false,
    daysUntil: 27,
  },
  aggregateVersion: "1",
  capabilities: [
    "cancel_campaign",
    "change_campaign_deadline",
    "change_campaign_target",
    "start_campaign",
  ],
};

const endedCampaign: InterviewCampaignSummaryV1 = {
  campaignKey: "campaign:70000000-0000-8000-8000-000000000005",
  title: "Ended loop",
  lifecycle: "ENDED",
  readinessGoal: { readinessGoalKey: "goal:backend-readiness", title: "Backend readiness" },
  deadline: {
    localDate: "2026-01-01",
    timeZone: "UTC",
    at: "2026-01-02T00:00:00.000Z",
    passed: true,
    daysUntil: 0,
  },
  aggregateVersion: "3",
  capabilities: [],
};

const passedActiveCampaign: InterviewCampaignSummaryV1 = {
  ...activeCampaign,
  campaignKey: "campaign:70000000-0000-8000-8000-000000000007",
  title: "Overdue loop",
  deadline: { ...activeCampaign.deadline, passed: true, daysUntil: 0, localDate: "2026-01-01" },
};

const activeGoals: readonly ActiveReadinessGoalV1[] = [
  {
    readinessGoalKey: "goal:backend-readiness",
    title: "Backend readiness",
    profileRoleTitle: "Backend Engineer",
    aggregateVersion: "7",
  },
  {
    readinessGoalKey: "goal:frontend-readiness",
    title: "Frontend readiness",
    profileRoleTitle: "Frontend Engineer",
    aggregateVersion: "3",
  },
  {
    readinessGoalKey: "goal:platform-readiness",
    title: "Platform readiness",
    profileRoleTitle: "Platform Engineer",
    aggregateVersion: "2",
  },
];

const creationPreview: InterviewCampaignCreationPreviewV1 = {
  contract: { name: "InterviewCampaignCreationPreviewV1", version: "1.0.0" },
  operation: "create_interview_campaign",
  commandType: "targets.create_interview_campaign_v1",
  idempotencyKey: "10000000-0000-4000-8000-000000000001",
  reason: "Preparing for the backend interview loop.",
  readinessGoal: {
    readinessGoalId: "20000000-0000-4000-8000-000000000001",
    readinessGoalKey: "goal:backend-readiness",
    title: "Backend readiness",
    lifecycle: "ACTIVE",
    aggregateVersion: "7",
  },
  after: {
    campaignId: "70000000-0000-8000-8000-000000000009",
    campaignKey: "campaign:70000000-0000-8000-8000-000000000009",
    title: "New onsite loop",
    lifecycle: "DRAFT",
    aggregateVersion: "1",
    deadline: {
      localDate: "2026-12-20",
      timeZone: "America/New_York",
      at: "2026-12-21T05:00:00.000Z",
    },
  },
  canApply: true,
  blockingReasons: [],
  warnings: [],
  previewDigest: "c".repeat(64),
};

const creationPreviewState: CampaignActionState = {
  status: "previewed",
  message: "Draft preview ready.",
  preview: creationPreview,
};

const creationBlockedPreviewState: CampaignActionState = {
  status: "previewed",
  message: "This draft is no longer applicable.",
  preview: {
    ...creationPreview,
    canApply: false,
    blockingReasons: [{ code: "TARGETS_CREATE_IDENTITY_COLLISION" }],
  },
};

const deadlinePreviewState: CampaignActionState = {
  status: "previewed",
  message: "Deadline change preview ready.",
  preview: {
    contract: { name: "InterviewCampaignDeadlineChangePreviewV1", version: "1.0.0" },
    operation: "change_campaign_deadline",
    commandType: "targets.change_interview_campaign_deadline_v1",
    reason: "The recruiter moved the onsite by two weeks.",
    before: {
      campaignId: "70000000-0000-8000-8000-000000000001",
      campaignKey: activeCampaign.campaignKey,
      title: activeCampaign.title,
      lifecycle: "ACTIVE",
      aggregateVersion: "2",
      deadline: { localDate: "2026-12-15", timeZone: "America/New_York" },
    },
    after: {
      campaignId: "70000000-0000-8000-8000-000000000001",
      campaignKey: activeCampaign.campaignKey,
      title: activeCampaign.title,
      lifecycle: "ACTIVE",
      aggregateVersion: "3",
      deadline: {
        localDate: "2026-12-29",
        timeZone: "America/New_York",
        at: "2026-12-30T05:00:00.000Z",
      },
    },
    canApply: true,
    blockingReasons: [],
    warnings: [],
    previewDigest: "d".repeat(64),
  },
};

const retargetPreviewState: CampaignActionState = {
  status: "previewed",
  message: "Retarget preview ready.",
  preview: {
    contract: { name: "InterviewCampaignRetargetPreviewV1", version: "1.0.0" },
    operation: "change_campaign_target",
    commandType: "targets.retarget_interview_campaign_v1",
    reason: "The role changed from backend to platform engineering.",
    before: {
      campaignId: "70000000-0000-8000-8000-000000000001",
      campaignKey: activeCampaign.campaignKey,
      title: activeCampaign.title,
      lifecycle: "ACTIVE",
      aggregateVersion: "2",
      readinessGoal: {
        readinessGoalId: "20000000-0000-4000-8000-000000000001",
        readinessGoalKey: "goal:backend-readiness",
        title: "Backend readiness",
      },
    },
    after: {
      campaignId: "70000000-0000-8000-8000-000000000001",
      campaignKey: activeCampaign.campaignKey,
      title: activeCampaign.title,
      lifecycle: "ACTIVE",
      aggregateVersion: "3",
      readinessGoal: {
        readinessGoalId: "20000000-0000-4000-8000-000000000003",
        readinessGoalKey: "goal:platform-readiness",
        title: "Platform readiness",
        lifecycle: "ACTIVE",
        aggregateVersion: "2",
      },
      revisionNumber: 1,
    },
    retained: { previousReadinessGoal: true, newReadinessGoal: true },
    canApply: true,
    blockingReasons: [],
    warnings: [],
    previewDigest: "e".repeat(64),
  },
};

const lifecyclePreviewState: CampaignActionState = {
  status: "previewed",
  message: "Lifecycle change preview ready.",
  preview: {
    contract: { name: "CampaignLifecycleCoordinationPreviewV1", version: "1.0.0" },
    operation: "end_campaign",
    commandType: "agent_control.coordinate_campaign_lifecycle_v1",
    reason: "The onsite is complete.",
    idempotencyKey: "10000000-0000-4000-8000-000000000005",
    campaign: {
      before: {
        campaignId: "70000000-0000-8000-8000-000000000001",
        campaignKey: activeCampaign.campaignKey,
        title: activeCampaign.title,
        lifecycle: "ACTIVE",
        aggregateVersion: "2",
      },
      after: {
        campaignId: "70000000-0000-8000-8000-000000000001",
        campaignKey: activeCampaign.campaignKey,
        title: activeCampaign.title,
        lifecycle: "ENDED",
        aggregateVersion: "3",
      },
    },
    overrides: { installed: [], closed: [] },
    canApply: true,
    blockingReasons: [],
    warnings: [],
    previewDigest: "f".repeat(64),
  },
};

const availableTracks: readonly AvailableLearningTrackV1[] = [
  {
    learningTrackId: "26000000-0000-4000-8000-000000000102",
    trackKey: "track:backend",
    title: "Backend",
    lifecycle: "ACTIVE",
    aggregateVersion: "2",
  },
];

const allocationOverrides: readonly CampaignAllocationOverrideSummaryV1[] = [
  {
    overrideKey: "override:81000000-0000-8000-8000-000000000001",
    campaignKey: activeCampaign.campaignKey,
    learningTrack: { trackKey: "track:backend", title: "Backend" },
    lifecycle: "ACTIVE",
    priorityOverride: 95,
    protectedMinimumMinutesOverride: null,
    cadencePerWeekOverride: null,
    aggregateVersion: "1",
    capabilities: ["change_campaign_allocation_override", "remove_campaign_allocation_override"],
  },
];

export default async function CampaignsFixturePage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly preview?: string }>;
}) {
  if (process.env.PANDO_ENABLE_CAMPAIGNS_FIXTURE !== "true") notFound();
  const previewKind = (await searchParams).preview ?? "list";

  const campaigns: readonly InterviewCampaignSummaryV1[] =
    previewKind === "empty"
      ? []
      : previewKind === "deadline-passed"
        ? [passedActiveCampaign, draftCampaign]
        : [activeCampaign, draftCampaign, endedCampaign];

  return (
    <div className={styles.page}>
      <SkipLink targetId="campaigns-main">Skip to Interview Campaigns</SkipLink>
      <header className={styles.header}>
        <div>
          <span className={styles.brand}>PANDO</span>
          <span>Automated Interview Campaigns fixture</span>
        </div>
      </header>
      <main className={styles.main} id="campaigns-main" tabIndex={-1}>
        <div className={styles.intro}>
          <p>Interview Campaigns</p>
          <h1>Prepare for one loop at a time.</h1>
        </div>
        <CampaignWorkspace
          activeGoals={previewKind === "no-goals" ? [] : activeGoals}
          availableTracks={previewKind === "lifecycle" ? availableTracks : []}
          campaigns={campaigns}
          initialCreationPreviewState={
            previewKind === "creation"
              ? creationPreviewState
              : previewKind === "creation-blocked"
                ? creationBlockedPreviewState
                : initialCampaignActionState
          }
          overrides={previewKind === "override" ? allocationOverrides : []}
          {...(previewKind === "deadline" ||
          previewKind === "retarget" ||
          previewKind === "lifecycle"
            ? { focusedCampaignKey: activeCampaign.campaignKey }
            : {})}
          {...(previewKind === "deadline"
            ? { focusedDeadlinePreviewState: deadlinePreviewState }
            : {})}
          {...(previewKind === "retarget"
            ? { focusedRetargetPreviewState: retargetPreviewState }
            : {})}
          {...(previewKind === "lifecycle"
            ? { focusedLifecyclePreviewState: lifecyclePreviewState }
            : {})}
        />
      </main>
    </div>
  );
}
