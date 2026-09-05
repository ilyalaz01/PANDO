"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  applyCampaignLifecycleCoordinationAction,
  previewCampaignLifecycleCoordinationAction,
} from "../../app/campaigns/actions";
import { initialCampaignActionState, type CampaignActionState } from "./campaign-action-state";
import type {
  AvailableLearningTrackV1,
  CampaignLifecycleCoordinationOperationV1,
  CampaignLifecycleCoordinationPreviewV1,
  CampaignPreviewV1,
  InterviewCampaignSummaryV1,
} from "./campaign-types";
import styles from "./campaigns.module.css";

const OPERATION_LABEL: Record<CampaignLifecycleCoordinationOperationV1, string> = {
  start_campaign: "Start this campaign",
  end_campaign: "End this campaign",
  cancel_campaign: "Cancel this campaign",
};

const APPLYING_LABEL: Record<CampaignLifecycleCoordinationOperationV1, string> = {
  start_campaign: "Starting…",
  end_campaign: "Ending…",
  cancel_campaign: "Cancelling…",
};

function requestId(): string {
  return globalThis.crypto.randomUUID();
}

function isCoordinationPreview(
  preview: CampaignPreviewV1 | null,
): preview is CampaignLifecycleCoordinationPreviewV1 {
  return preview?.contract.name === "CampaignLifecycleCoordinationPreviewV1";
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

const LIFECYCLE_OPERATIONS: readonly CampaignLifecycleCoordinationOperationV1[] = [
  "start_campaign",
  "end_campaign",
  "cancel_campaign",
];

export function InterviewCampaignLifecycle({
  campaign,
  availableTracks = [],
  dismissalVersion = 0,
  onIntentStart,
  initialPreviewState = initialCampaignActionState,
  initialApplyState = initialCampaignActionState,
}: {
  readonly campaign: InterviewCampaignSummaryV1;
  readonly availableTracks?: readonly AvailableLearningTrackV1[];
  readonly dismissalVersion?: number;
  readonly onIntentStart?: () => void;
  readonly initialPreviewState?: CampaignActionState;
  readonly initialApplyState?: CampaignActionState;
}) {
  const router = useRouter();
  const previewRequestId = useRef<HTMLInputElement>(null);
  const observedDismissalVersion = useRef(dismissalVersion);
  const suppressNextDismiss = useRef(false);
  const [reason, setReason] = useState("");
  const [currentRequestId, setCurrentRequestId] = useState("");
  const [selectedOperation, setSelectedOperation] =
    useState<CampaignLifecycleCoordinationOperationV1 | null>(null);
  const [overrideTrackKey, setOverrideTrackKey] = useState("");
  const [overrideExpectedTrackVersion, setOverrideExpectedTrackVersion] = useState("");
  const [overridePriority, setOverridePriority] = useState("");
  const [overrideProtectedMinimum, setOverrideProtectedMinimum] = useState("");
  const [overrideCadence, setOverrideCadence] = useState("");
  const [dismissed, setDismissed] = useState(initialPreviewState.preview === null);
  const [submittedPreviewDigest, setSubmittedPreviewDigest] = useState<string | null>(() =>
    initialApplyState.status === "idle"
      ? null
      : (initialPreviewState.preview?.previewDigest ?? null),
  );
  const [previewState, previewAction, previewPending] = useActionState(
    previewCampaignLifecycleCoordinationAction,
    initialPreviewState,
  );
  const [applyState, applyAction, applyPending] = useActionState(
    applyCampaignLifecycleCoordinationAction,
    initialApplyState,
  );
  const preview = isCoordinationPreview(previewState.preview) ? previewState.preview : null;
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
      // A sibling's intent starting bumps this shared counter to dismiss every stale preview at
      // once, but the instance that itself just called `onIntentStart` below would otherwise
      // immediately dismiss the very form it just opened, in the same commit.
      if (suppressNextDismiss.current) {
        suppressNextDismiss.current = false;
        return;
      }
      setDismissed(true);
      setSelectedOperation(null);
    }
  }, [dismissalVersion]);

  const available = LIFECYCLE_OPERATIONS.filter((operation) =>
    campaign.capabilities.includes(operation),
  );
  if (available.length === 0) return null;
  const activeTracks = availableTracks.filter((track) => track.lifecycle === "ACTIVE");

  const startOperation = (operation: CampaignLifecycleCoordinationOperationV1) => {
    const nextRequestId = requestId();
    setCurrentRequestId(nextRequestId);
    if (previewRequestId.current !== null) previewRequestId.current.value = nextRequestId;
    setSelectedOperation(operation);
    setOverrideTrackKey("");
    setOverrideExpectedTrackVersion("");
    setOverridePriority("");
    setOverrideProtectedMinimum("");
    setOverrideCadence("");
    setDismissed(false);
    suppressNextDismiss.current = true;
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
          {selectedOperation === "start_campaign" && activeTracks.length > 0 ? (
            <>
              <label htmlFor={`campaign-override-track-${campaign.campaignKey}`}>
                Boost one Learning Track for this campaign (optional)
              </label>
              <select
                id={`campaign-override-track-${campaign.campaignKey}`}
                name="overrideTrackKey"
                onChange={(event) => {
                  const trackKey = event.target.value;
                  setOverrideTrackKey(trackKey);
                  const track = activeTracks.find((item) => item.trackKey === trackKey);
                  setOverrideExpectedTrackVersion(track?.aggregateVersion ?? "");
                }}
                value={overrideTrackKey}
              >
                <option value="">No override</option>
                {activeTracks.map((track) => (
                  <option key={track.trackKey} value={track.trackKey}>
                    {track.title}
                  </option>
                ))}
              </select>
              <input
                name="overrideExpectedTrackVersion"
                type="hidden"
                value={overrideExpectedTrackVersion}
              />
              {overrideTrackKey !== "" ? (
                <>
                  <label htmlFor={`campaign-override-priority-${campaign.campaignKey}`}>
                    Priority override (0-100, optional)
                  </label>
                  <input
                    id={`campaign-override-priority-${campaign.campaignKey}`}
                    max={100}
                    min={0}
                    name="overridePriorityOverride"
                    onChange={(event) => setOverridePriority(event.target.value)}
                    type="number"
                    value={overridePriority}
                  />
                  <label htmlFor={`campaign-override-protected-${campaign.campaignKey}`}>
                    Protected minutes override (0-10080, optional)
                  </label>
                  <input
                    id={`campaign-override-protected-${campaign.campaignKey}`}
                    max={10_080}
                    min={0}
                    name="overrideProtectedMinimumMinutesOverride"
                    onChange={(event) => setOverrideProtectedMinimum(event.target.value)}
                    type="number"
                    value={overrideProtectedMinimum}
                  />
                  <label htmlFor={`campaign-override-cadence-${campaign.campaignKey}`}>
                    Cadence per week override (0-100, optional)
                  </label>
                  <input
                    id={`campaign-override-cadence-${campaign.campaignKey}`}
                    max={100}
                    min={0}
                    name="overrideCadencePerWeekOverride"
                    onChange={(event) => setOverrideCadence(event.target.value)}
                    type="number"
                    value={overrideCadence}
                  />
                </>
              ) : null}
            </>
          ) : null}
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
                  <dd>{effectivePreview.campaign.before.lifecycle}</dd>
                </div>
              </dl>
            </div>
            <div>
              <h5>After confirmation</h5>
              <dl>
                <div>
                  <dt>Lifecycle</dt>
                  <dd>{effectivePreview.campaign.after.lifecycle}</dd>
                </div>
              </dl>
            </div>
          </div>
          {effectivePreview.overrides.installed.length > 0 ? (
            <p>
              Installs an allocation override on{" "}
              {effectivePreview.overrides.installed[0]!.learningTrack.trackKey}.
            </p>
          ) : null}
          {effectivePreview.overrides.closed.length > 0 ? (
            <p>Closes {effectivePreview.overrides.closed.length} active allocation override(s).</p>
          ) : null}
          {effectivePreview.blockingReasons.length > 0 ? (
            <p className={styles.notice} role="alert">
              This change is not applicable right now: {effectivePreview.blockingReasons[0]!.code}.
            </p>
          ) : null}
          <form
            action={applyAction}
            className={styles.form}
            onSubmit={() => setSubmittedPreviewDigest(effectivePreview.previewDigest)}
          >
            <input
              name="campaignKey"
              type="hidden"
              value={effectivePreview.campaign.before.campaignKey}
            />
            <input name="operation" type="hidden" value={effectivePreview.operation} />
            <input
              name="expectedCampaignVersion"
              type="hidden"
              value={effectivePreview.campaign.before.aggregateVersion}
            />
            {effectivePreview.overrides.installed.length > 0 ? (
              <>
                <input
                  name="overrideTrackKey"
                  type="hidden"
                  value={effectivePreview.overrides.installed[0]!.learningTrack.trackKey}
                />
                <input
                  name="overrideExpectedTrackVersion"
                  type="hidden"
                  value={effectivePreview.overrides.installed[0]!.learningTrack.expectedVersion}
                />
                <input
                  name="overridePriorityOverride"
                  type="hidden"
                  value={effectivePreview.overrides.installed[0]!.priorityOverride ?? ""}
                />
                <input
                  name="overrideProtectedMinimumMinutesOverride"
                  type="hidden"
                  value={
                    effectivePreview.overrides.installed[0]!.protectedMinimumMinutesOverride ?? ""
                  }
                />
                <input
                  name="overrideCadencePerWeekOverride"
                  type="hidden"
                  value={effectivePreview.overrides.installed[0]!.cadencePerWeekOverride ?? ""}
                />
              </>
            ) : null}
            <input name="reason" type="hidden" value={effectivePreview.reason} />
            <input name="requestId" type="hidden" value={currentRequestId} />
            <input name="previewDigest" type="hidden" value={effectivePreview.previewDigest} />
            <Status state={applyStateForPreview} />
            <div className={styles.actions}>
              <button
                className={styles.button}
                disabled={applyPending || !effectivePreview.canApply}
                type="submit"
              >
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
