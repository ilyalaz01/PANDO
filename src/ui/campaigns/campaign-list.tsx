"use client";

import { InterviewCampaignDeadline } from "./campaign-deadline";
import { InterviewCampaignLifecycle } from "./campaign-lifecycle";
import { InterviewCampaignRetarget } from "./campaign-retarget";
import type { CampaignActionState } from "./campaign-action-state";
import type { ActiveReadinessGoalV1, InterviewCampaignSummaryV1 } from "./campaign-types";
import styles from "./campaigns.module.css";

function deadlineText(campaign: InterviewCampaignSummaryV1): string {
  if (campaign.deadline.passed) return `Deadline passed (${campaign.deadline.localDate})`;
  if (campaign.deadline.daysUntil === 0) return "Deadline is today";
  if (campaign.deadline.daysUntil === 1) return "Deadline is tomorrow";
  return `${campaign.deadline.daysUntil} days until the deadline`;
}

export function InterviewCampaignList({
  campaigns,
  activeGoals,
  dismissalVersion,
  onIntentStart,
  focusedCampaignKey,
  focusedDeadlinePreviewState,
  focusedRetargetPreviewState,
  focusedLifecyclePreviewState,
}: {
  readonly campaigns: readonly InterviewCampaignSummaryV1[];
  readonly activeGoals: readonly ActiveReadinessGoalV1[];
  readonly dismissalVersion: number;
  readonly onIntentStart: () => void;
  readonly focusedCampaignKey?: string;
  readonly focusedDeadlinePreviewState?: CampaignActionState;
  readonly focusedRetargetPreviewState?: CampaignActionState;
  readonly focusedLifecyclePreviewState?: CampaignActionState;
}) {
  if (campaigns.length === 0) {
    return (
      <section aria-labelledby="campaign-list-heading" className={styles.panel}>
        <h2 id="campaign-list-heading">Your Interview Campaigns</h2>
        <p>No Interview Campaigns yet. Draft one below to start preparing for a specific loop.</p>
      </section>
    );
  }

  return (
    <section aria-labelledby="campaign-list-heading" className={styles.panel}>
      <h2 id="campaign-list-heading">Your Interview Campaigns</h2>
      <ul className={styles.campaignList}>
        {campaigns.map((campaign) => (
          <li className={styles.campaignCard} key={campaign.campaignKey}>
            <div>
              <strong>{campaign.title}</strong>{" "}
              <span className={styles.statusBadge}>{campaign.lifecycle}</span>
            </div>
            <span>{campaign.readinessGoal.title}</span>
            <span>{deadlineText(campaign)}</span>
            {campaign.deadline.passed && campaign.lifecycle === "ACTIVE" ? (
              <p className={styles.notice} role="status">
                This campaign&rsquo;s deadline has passed. End or cancel it to close it out.
              </p>
            ) : null}
            <InterviewCampaignDeadline
              campaign={campaign}
              dismissalVersion={dismissalVersion}
              onIntentStart={onIntentStart}
              {...(campaign.campaignKey === focusedCampaignKey &&
              focusedDeadlinePreviewState !== undefined
                ? { initialPreviewState: focusedDeadlinePreviewState }
                : {})}
            />
            <InterviewCampaignRetarget
              activeGoals={activeGoals}
              campaign={campaign}
              dismissalVersion={dismissalVersion}
              onIntentStart={onIntentStart}
              {...(campaign.campaignKey === focusedCampaignKey &&
              focusedRetargetPreviewState !== undefined
                ? { initialPreviewState: focusedRetargetPreviewState }
                : {})}
            />
            <InterviewCampaignLifecycle
              campaign={campaign}
              dismissalVersion={dismissalVersion}
              onIntentStart={onIntentStart}
              {...(campaign.campaignKey === focusedCampaignKey &&
              focusedLifecyclePreviewState !== undefined
                ? { initialPreviewState: focusedLifecyclePreviewState }
                : {})}
            />
            <section
              aria-labelledby={`campaign-history-heading-${campaign.campaignKey}`}
              className={styles.panel}
            >
              <h3 id={`campaign-history-heading-${campaign.campaignKey}`}>Retargeting history</h3>
              <p>
                Every retarget is recorded and neither Readiness Goal is ever changed by it, but
                PANDO does not yet expose a read for that history to the browser. This is a known
                gap in the current bounded outcome, not missing data.
              </p>
            </section>
          </li>
        ))}
      </ul>
    </section>
  );
}
