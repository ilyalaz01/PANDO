"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  applyInterviewCampaignRetargetAction,
  previewInterviewCampaignRetargetAction,
} from "../../app/campaigns/actions";
import { initialCampaignActionState, type CampaignActionState } from "./campaign-action-state";
import type {
  ActiveReadinessGoalV1,
  CampaignPreviewV1,
  InterviewCampaignRetargetPreviewV1,
  InterviewCampaignSummaryV1,
} from "./campaign-types";
import styles from "./campaigns.module.css";

function requestId(): string {
  return globalThis.crypto.randomUUID();
}

function isRetargetPreview(
  preview: CampaignPreviewV1 | null,
): preview is InterviewCampaignRetargetPreviewV1 {
  return preview?.contract.name === "InterviewCampaignRetargetPreviewV1";
}

function Status({ state }: { readonly state: CampaignActionState }) {
  return (
    <p
      aria-live="polite"
      className={styles.status}
      role={
        state.status === "invalid" || state.status === "conflict" || state.status === "unavailable"
          ? "alert"
          : "status"
      }
    >
      {state.message}
    </p>
  );
}

export function InterviewCampaignRetarget({
  campaign,
  activeGoals,
  dismissalVersion = 0,
  onIntentStart,
  initialPreviewState = initialCampaignActionState,
  initialApplyState = initialCampaignActionState,
}: {
  readonly campaign: InterviewCampaignSummaryV1;
  readonly activeGoals: readonly ActiveReadinessGoalV1[];
  readonly dismissalVersion?: number;
  readonly onIntentStart?: () => void;
  readonly initialPreviewState?: CampaignActionState;
  readonly initialApplyState?: CampaignActionState;
}) {
  const router = useRouter();
  const observedDismissalVersion = useRef(dismissalVersion);
  const alternatives = activeGoals.filter(
    (goal) => goal.readinessGoalKey !== campaign.readinessGoal.readinessGoalKey,
  );
  const [selectedGoalKey, setSelectedGoalKey] = useState(alternatives[0]?.readinessGoalKey ?? "");
  const [reason, setReason] = useState("");
  const [currentRequestId, setCurrentRequestId] = useState(() => requestId());
  const [dismissed, setDismissed] = useState(initialPreviewState.preview === null);
  const [submittedPreviewDigest, setSubmittedPreviewDigest] = useState<string | null>(() =>
    initialApplyState.status === "idle"
      ? null
      : (initialPreviewState.preview?.previewDigest ?? null),
  );
  const [previewState, previewAction, previewPending] = useActionState(
    previewInterviewCampaignRetargetAction,
    initialPreviewState,
  );
  const [applyState, applyAction, applyPending] = useActionState(
    applyInterviewCampaignRetargetAction,
    initialApplyState,
  );
  const preview = isRetargetPreview(previewState.preview) ? previewState.preview : null;
  const applyStateForPreview =
    preview !== null && preview.previewDigest === submittedPreviewDigest
      ? applyState
      : initialCampaignActionState;
  const effectivePreview =
    dismissed ||
    previewPending ||
    (applyStateForPreview.status === "applied" && preview?.previewDigest === submittedPreviewDigest)
      ? null
      : preview;

  useEffect(() => {
    if (applyState.status === "applied") router.refresh();
  }, [applyState, router]);

  useEffect(() => {
    if (observedDismissalVersion.current !== dismissalVersion) {
      observedDismissalVersion.current = dismissalVersion;
      setDismissed(true);
    }
  }, [dismissalVersion]);

  if (!campaign.capabilities.includes("change_campaign_target") || alternatives.length === 0) {
    return null;
  }

  const selectedGoal = alternatives.find((goal) => goal.readinessGoalKey === selectedGoalKey);
  const rotateIntent = (showPreview: boolean) => {
    setCurrentRequestId(requestId());
    setDismissed(!showPreview);
    onIntentStart?.();
  };

  return (
    <section
      aria-labelledby={`campaign-retarget-heading-${campaign.campaignKey}`}
      className={styles.panel}
    >
      <h3 id={`campaign-retarget-heading-${campaign.campaignKey}`}>Retarget</h3>
      <p>Current target: {campaign.readinessGoal.title}.</p>
      <form action={previewAction} className={styles.form} onSubmit={() => rotateIntent(true)}>
        <input name="campaignKey" type="hidden" value={campaign.campaignKey} />
        <input name="expectedCampaignVersion" type="hidden" value={campaign.aggregateVersion} />
        <input
          name="expectedReadinessGoalVersion"
          type="hidden"
          value={selectedGoal?.aggregateVersion ?? ""}
        />
        <label htmlFor={`campaign-retarget-goal-${campaign.campaignKey}`}>New Readiness Goal</label>
        <select
          className={styles.selectInput}
          id={`campaign-retarget-goal-${campaign.campaignKey}`}
          name="readinessGoalKey"
          onChange={(event) => {
            setSelectedGoalKey(event.target.value);
            rotateIntent(false);
          }}
          value={selectedGoalKey}
        >
          {alternatives.map((goal) => (
            <option key={goal.readinessGoalKey} value={goal.readinessGoalKey}>
              {goal.title} — {goal.profileRoleTitle}
            </option>
          ))}
        </select>
        <label htmlFor={`campaign-retarget-reason-${campaign.campaignKey}`}>Reason</label>
        <textarea
          id={`campaign-retarget-reason-${campaign.campaignKey}`}
          maxLength={500}
          name="reason"
          onChange={(event) => {
            setReason(event.target.value);
            rotateIntent(false);
          }}
          required
          value={reason}
        />
        <Status state={previewState} />
        <button className={styles.button} disabled={previewPending} type="submit">
          {previewPending ? "Preparing preview…" : "Preview retarget"}
        </button>
      </form>
      {effectivePreview !== null ? (
        <section aria-labelledby={`campaign-retarget-preview-heading-${campaign.campaignKey}`}>
          <h4 id={`campaign-retarget-preview-heading-${campaign.campaignKey}`}>
            Review this exact retarget
          </h4>
          <div className={styles.comparison} aria-label="Exact Interview Campaign retarget preview">
            <div>
              <h5>Before</h5>
              <dl>
                <div>
                  <dt>Target</dt>
                  <dd>{effectivePreview.before.readinessGoal.title}</dd>
                </div>
              </dl>
            </div>
            <div>
              <h5>After confirmation</h5>
              <dl>
                <div>
                  <dt>Target</dt>
                  <dd>{effectivePreview.after.readinessGoal.title}</dd>
                </div>
                <div>
                  <dt>Revision</dt>
                  <dd>{effectivePreview.after.revisionNumber}</dd>
                </div>
              </dl>
            </div>
          </div>
          <p className={styles.notice}>
            Preserved: both the previous and the new Readiness Goal keep their own history.
          </p>
          <form
            action={applyAction}
            className={styles.form}
            onSubmit={() => setSubmittedPreviewDigest(effectivePreview.previewDigest)}
          >
            <input name="campaignKey" type="hidden" value={effectivePreview.before.campaignKey} />
            <input
              name="expectedCampaignVersion"
              type="hidden"
              value={effectivePreview.before.aggregateVersion}
            />
            <input
              name="readinessGoalKey"
              type="hidden"
              value={effectivePreview.after.readinessGoal.readinessGoalKey}
            />
            <input
              name="expectedReadinessGoalVersion"
              type="hidden"
              value={effectivePreview.after.readinessGoal.aggregateVersion}
            />
            <input name="reason" type="hidden" value={effectivePreview.reason} />
            <input name="requestId" type="hidden" value={currentRequestId} />
            <input name="previewDigest" type="hidden" value={effectivePreview.previewDigest} />
            <Status state={applyStateForPreview} />
            <div className={styles.actions}>
              <button className={styles.button} disabled={applyPending} type="submit">
                {applyPending ? "Retargeting…" : "Confirm retarget"}
              </button>
              <button
                className={styles.secondaryButton}
                onClick={() => setDismissed(true)}
                type="button"
              >
                Keep the current target
              </button>
            </div>
          </form>
        </section>
      ) : null}
    </section>
  );
}
