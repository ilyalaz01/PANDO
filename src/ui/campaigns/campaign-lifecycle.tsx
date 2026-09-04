"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  applyInterviewCampaignLifecycleAction,
  previewInterviewCampaignLifecycleAction,
} from "../../app/campaigns/actions";
import { initialCampaignActionState, type CampaignActionState } from "./campaign-action-state";
import type {
  CampaignPreviewV1,
  InterviewCampaignLifecycleOperationV1,
  InterviewCampaignLifecyclePreviewV1,
  InterviewCampaignSummaryV1,
} from "./campaign-types";
import styles from "./campaigns.module.css";

const OPERATION_LABEL: Record<InterviewCampaignLifecycleOperationV1, string> = {
  start_campaign: "Start this campaign",
  end_campaign: "End this campaign",
  cancel_campaign: "Cancel this campaign",
};

const APPLYING_LABEL: Record<InterviewCampaignLifecycleOperationV1, string> = {
  start_campaign: "Starting…",
  end_campaign: "Ending…",
  cancel_campaign: "Cancelling…",
};

function requestId(): string {
  return globalThis.crypto.randomUUID();
}

function isLifecyclePreview(
  preview: CampaignPreviewV1 | null,
): preview is InterviewCampaignLifecyclePreviewV1 {
  return preview?.contract.name === "InterviewCampaignLifecyclePreviewV1";
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

const LIFECYCLE_OPERATIONS: readonly InterviewCampaignLifecycleOperationV1[] = [
  "start_campaign",
  "end_campaign",
  "cancel_campaign",
];

export function InterviewCampaignLifecycle({
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
  const previewRequestId = useRef<HTMLInputElement>(null);
  const observedDismissalVersion = useRef(dismissalVersion);
  const [reason, setReason] = useState("");
  const [currentRequestId, setCurrentRequestId] = useState("");
  const [selectedOperation, setSelectedOperation] =
    useState<InterviewCampaignLifecycleOperationV1 | null>(null);
  const [dismissed, setDismissed] = useState(initialPreviewState.preview === null);
  const [submittedPreviewDigest, setSubmittedPreviewDigest] = useState<string | null>(() =>
    initialApplyState.status === "idle"
      ? null
      : (initialPreviewState.preview?.previewDigest ?? null),
  );
  const [previewState, previewAction, previewPending] = useActionState(
    previewInterviewCampaignLifecycleAction,
    initialPreviewState,
  );
  const [applyState, applyAction, applyPending] = useActionState(
    applyInterviewCampaignLifecycleAction,
    initialApplyState,
  );
  const preview = isLifecyclePreview(previewState.preview) ? previewState.preview : null;
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
      setSelectedOperation(null);
    }
  }, [dismissalVersion]);

  const available = LIFECYCLE_OPERATIONS.filter((operation) =>
    campaign.capabilities.includes(operation),
  );
  if (available.length === 0) return null;

  const startOperation = (operation: InterviewCampaignLifecycleOperationV1) => {
    const nextRequestId = requestId();
    setCurrentRequestId(nextRequestId);
    if (previewRequestId.current !== null) previewRequestId.current.value = nextRequestId;
    setSelectedOperation(operation);
    setDismissed(false);
    onIntentStart?.();
  };

  return (
    <section
      aria-labelledby={`campaign-lifecycle-heading-${campaign.campaignKey}`}
      className={styles.panel}
    >
      <h3 id={`campaign-lifecycle-heading-${campaign.campaignKey}`}>Lifecycle</h3>
      <div className={styles.actions}>
        {available.map((operation) => (
          <button
            className={styles.secondaryButton}
            key={operation}
            onClick={() => startOperation(operation)}
            type="button"
          >
            {OPERATION_LABEL[operation]}
          </button>
        ))}
      </div>
      {selectedOperation !== null && !dismissed ? (
        <form action={previewAction} className={styles.form}>
          <input name="campaignKey" type="hidden" value={campaign.campaignKey} />
          <input name="operation" type="hidden" value={selectedOperation} />
          <input name="expectedCampaignVersion" type="hidden" value={campaign.aggregateVersion} />
          <input name="requestId" ref={previewRequestId} type="hidden" value={currentRequestId} />
          <label htmlFor={`campaign-lifecycle-reason-${campaign.campaignKey}`}>Reason</label>
          <textarea
            id={`campaign-lifecycle-reason-${campaign.campaignKey}`}
            maxLength={500}
            name="reason"
            onChange={(event) => setReason(event.target.value)}
            required
            value={reason}
          />
          <Status state={previewState} />
          <button className={styles.button} disabled={previewPending} type="submit">
            {previewPending
              ? "Preparing preview…"
              : `Preview: ${OPERATION_LABEL[selectedOperation]}`}
          </button>
        </form>
      ) : null}
      {effectivePreview !== null ? (
        <section aria-labelledby={`campaign-lifecycle-preview-heading-${campaign.campaignKey}`}>
          <h4 id={`campaign-lifecycle-preview-heading-${campaign.campaignKey}`}>
            Review this exact lifecycle change
          </h4>
          <div
            className={styles.comparison}
            aria-label="Exact Interview Campaign lifecycle preview"
          >
            <div>
              <h5>Before</h5>
              <dl>
                <div>
                  <dt>Lifecycle</dt>
                  <dd>{effectivePreview.before.lifecycle}</dd>
                </div>
              </dl>
            </div>
            <div>
              <h5>After confirmation</h5>
              <dl>
                <div>
                  <dt>Lifecycle</dt>
                  <dd>{effectivePreview.after.lifecycle}</dd>
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
            <input name="operation" type="hidden" value={effectivePreview.operation} />
            <input
              name="expectedCampaignVersion"
              type="hidden"
              value={effectivePreview.before.aggregateVersion}
            />
            <input name="reason" type="hidden" value={effectivePreview.reason} />
            <input name="requestId" type="hidden" value={currentRequestId} />
            <input name="previewDigest" type="hidden" value={effectivePreview.previewDigest} />
            <Status state={applyStateForPreview} />
            <div className={styles.actions}>
              <button className={styles.button} disabled={applyPending} type="submit">
                {applyPending
                  ? APPLYING_LABEL[effectivePreview.operation]
                  : `Confirm: ${OPERATION_LABEL[effectivePreview.operation]}`}
              </button>
              <button
                className={styles.secondaryButton}
                onClick={() => {
                  setDismissed(true);
                  setSelectedOperation(null);
                }}
                type="button"
              >
                Keep the current lifecycle
              </button>
            </div>
          </form>
        </section>
      ) : null}
    </section>
  );
}
