"use client";

import { useState } from "react";
import { InterviewCampaignCreation } from "./campaign-creation";
import { InterviewCampaignList } from "./campaign-list";
import type { CampaignActionState } from "./campaign-action-state";
import type { ActiveReadinessGoalV1, InterviewCampaignSummaryV1 } from "./campaign-types";
import styles from "./campaigns.module.css";

export function CampaignWorkspace({
  campaigns,
  activeGoals,
  initialCreationPreviewState,
  initialCreationApplyState,
  focusedCampaignKey,
  focusedDeadlinePreviewState,
  focusedRetargetPreviewState,
  focusedLifecyclePreviewState,
}: {
  readonly campaigns: readonly InterviewCampaignSummaryV1[];
  readonly activeGoals: readonly ActiveReadinessGoalV1[];
  readonly initialCreationPreviewState?: CampaignActionState;
  readonly initialCreationApplyState?: CampaignActionState;
  readonly focusedCampaignKey?: string;
  readonly focusedDeadlinePreviewState?: CampaignActionState;
  readonly focusedRetargetPreviewState?: CampaignActionState;
  readonly focusedLifecyclePreviewState?: CampaignActionState;
}) {
  const [dismissalVersion, setDismissalVersion] = useState(0);
  const bumpDismissal = () => setDismissalVersion((version) => version + 1);

  return (
    <div className={styles.workspace}>
      <InterviewCampaignList
        activeGoals={activeGoals}
        campaigns={campaigns}
        dismissalVersion={dismissalVersion}
        onIntentStart={bumpDismissal}
        {...(focusedCampaignKey === undefined ? {} : { focusedCampaignKey })}
        {...(focusedDeadlinePreviewState === undefined ? {} : { focusedDeadlinePreviewState })}
        {...(focusedRetargetPreviewState === undefined ? {} : { focusedRetargetPreviewState })}
        {...(focusedLifecyclePreviewState === undefined ? {} : { focusedLifecyclePreviewState })}
      />
      <InterviewCampaignCreation
        activeGoals={activeGoals}
        dismissalVersion={dismissalVersion}
        onIntentStart={bumpDismissal}
        {...(initialCreationPreviewState === undefined
          ? {}
          : { initialPreviewState: initialCreationPreviewState })}
        {...(initialCreationApplyState === undefined
          ? {}
          : { initialApplyState: initialCreationApplyState })}
      />
    </div>
  );
}
