"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  applyInterviewCampaignDeadlineChangeAction,
  previewInterviewCampaignDeadlineChangeAction,
} from "../../app/campaigns/actions";
import { initialCampaignActionState, type CampaignActionState } from "./campaign-action-state";
import type {
  CampaignPreviewV1,
  InterviewCampaignDeadlineChangePreviewV1,
  InterviewCampaignSummaryV1,
} from "./campaign-types";
import styles from "./campaigns.module.css";

function requestId(): string {
  return globalThis.crypto.randomUUID();
}

function isDeadlinePreview(
  preview: CampaignPreviewV1 | null,
): preview is InterviewCampaignDeadlineChangePreviewV1 {
  return preview?.contract.name === "InterviewCampaignDeadlineChangePreviewV1";
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

export function InterviewCampaignDeadline({
  campaign,
  dismissalVersion = 0,
  onIntentStart,
  initialPreviewState = initialCampaignActionState,
  initialApplyState = initialCampaignActionState,
}: {
  readonly campaign: InterviewCampaignSummaryV1;
  readonly dismissalVersion?: number;
  readonly onIntentStart?: () => void;
  readonly initialPreviewState?: CampaignActionState;
  readonly initialApplyState?: CampaignActionState;
}) {
  const router = useRouter();
  const observedDismissalVersion = useRef(dismissalVersion);
  const [deadlineLocalDate, setDeadlineLocalDate] = useState(campaign.deadline.localDate);
  const [reason, setReason] = useState("");
  const [currentRequestId, setCurrentRequestId] = useState(() => requestId());
  const [dismissed, setDismissed] = useState(initialPreviewState.preview === null);
  const [submittedPreviewDigest, setSubmittedPreviewDigest] = useState<string | null>(() =>
    initialApplyState.status === "idle"
      ? null
      : (initialPreviewState.preview?.previewDigest ?? null),
  );
  const [previewState, previewAction, previewPending] = useActionState(
    previewInterviewCampaignDeadlineChangeAction,
    initialPreviewState,
  );
  const [applyState, applyAction, applyPending] = useActionState(
    applyInterviewCampaignDeadlineChangeAction,
    initialApplyState,
  );
  const preview = isDeadlinePreview(previewState.preview) ? previewState.preview : null;
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

  if (!campaign.capabilities.includes("change_campaign_deadline")) return null;

  const rotateIntent = (showPreview: boolean) => {
    setCurrentRequestId(requestId());
    setDismissed(!showPreview);
    onIntentStart?.();
  };

  return (
    <section
      aria-labelledby={`campaign-deadline-heading-${campaign.campaignKey}`}
      className={styles.panel}
    >
      <h3 id={`campaign-deadline-heading-${campaign.campaignKey}`}>Change deadline</h3>
      <p>
        Current deadline: {campaign.deadline.localDate} ({campaign.deadline.timeZone}).
      </p>
      <form action={previewAction} className={styles.form} onSubmit={() => rotateIntent(true)}>
        <input name="campaignKey" type="hidden" value={campaign.campaignKey} />
        <input name="expectedCampaignVersion" type="hidden" value={campaign.aggregateVersion} />
        <label htmlFor={`campaign-deadline-date-${campaign.campaignKey}`}>
          New deadline (local date)
        </label>
        <input
          className={styles.dateInput}
          id={`campaign-deadline-date-${campaign.campaignKey}`}
          name="deadlineLocalDate"
          onChange={(event) => {
            setDeadlineLocalDate(event.target.value);
            rotateIntent(false);
          }}
          required
          type="date"
          value={deadlineLocalDate}
        />
        <label htmlFor={`campaign-deadline-reason-${campaign.campaignKey}`}>Reason</label>
        <textarea
          id={`campaign-deadline-reason-${campaign.campaignKey}`}
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
          {previewPending ? "Preparing preview…" : "Preview deadline change"}
        </button>
      </form>
      {effectivePreview !== null ? (
        <section aria-labelledby={`campaign-deadline-preview-heading-${campaign.campaignKey}`}>
          <h4 id={`campaign-deadline-preview-heading-${campaign.campaignKey}`}>
            Review this exact deadline change
          </h4>
          <div className={styles.comparison} aria-label="Exact Interview Campaign deadline preview">
            <div>
              <h5>Before</h5>
              <dl>
                <div>
                  <dt>Deadline</dt>
                  <dd>
                    {effectivePreview.before.deadline.localDate} (
                    {effectivePreview.before.deadline.timeZone})
                  </dd>
                </div>
              </dl>
            </div>
            <div>
              <h5>After confirmation</h5>
              <dl>
                <div>
                  <dt>Deadline</dt>
                  <dd>
                    {effectivePreview.after.deadline.localDate} (
                    {effectivePreview.after.deadline.timeZone})
                  </dd>
                </div>
              </dl>
            </div>
          </div>
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
              name="deadlineLocalDate"
              type="hidden"
              value={effectivePreview.after.deadline.localDate}
            />
            <input name="reason" type="hidden" value={effectivePreview.reason} />
            <input name="requestId" type="hidden" value={currentRequestId} />
            <input name="previewDigest" type="hidden" value={effectivePreview.previewDigest} />
            <Status state={applyStateForPreview} />
            <div className={styles.actions}>
              <button className={styles.button} disabled={applyPending} type="submit">
                {applyPending ? "Changing deadline…" : "Confirm deadline change"}
              </button>
              <button
                className={styles.secondaryButton}
                onClick={() => setDismissed(true)}
                type="button"
              >
                Keep the current deadline
              </button>
            </div>
          </form>
        </section>
      ) : null}
    </section>
  );
}
