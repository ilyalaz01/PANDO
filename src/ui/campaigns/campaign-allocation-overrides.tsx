"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  applyCampaignAllocationOverrideAction,
  previewCampaignAllocationOverrideAction,
} from "../../app/campaigns/actions";
import { initialCampaignActionState, type CampaignActionState } from "./campaign-action-state";
import type {
  CampaignAllocationOverrideChangePreviewV1,
  CampaignAllocationOverrideOperationV1,
  CampaignAllocationOverrideSummaryV1,
  CampaignPreviewV1,
} from "./campaign-types";
import styles from "./campaigns.module.css";

const OPERATION_LABEL: Record<CampaignAllocationOverrideOperationV1, string> = {
  change_campaign_allocation_override: "Change this override",
  remove_campaign_allocation_override: "Remove this override",
};

const APPLYING_LABEL: Record<CampaignAllocationOverrideOperationV1, string> = {
  change_campaign_allocation_override: "Changing…",
  remove_campaign_allocation_override: "Removing…",
};

function requestId(): string {
  return globalThis.crypto.randomUUID();
}

function isOverridePreview(
  preview: CampaignPreviewV1 | null,
): preview is CampaignAllocationOverrideChangePreviewV1 {
  return preview?.contract.name === "CampaignAllocationOverrideChangePreviewV1";
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

function numberFieldValue(value: number | null): string {
  return value === null ? "" : String(value);
}

function OverrideRow({
  override,
  dismissalVersion,
  onIntentStart,
  initialPreviewState = initialCampaignActionState,
  initialApplyState = initialCampaignActionState,
}: {
  readonly override: CampaignAllocationOverrideSummaryV1;
  readonly dismissalVersion: number;
  readonly onIntentStart: () => void;
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
    useState<CampaignAllocationOverrideOperationV1 | null>(null);
  const [priorityOverride, setPriorityOverride] = useState(
    numberFieldValue(override.priorityOverride),
  );
  const [protectedMinimumMinutesOverride, setProtectedMinimumMinutesOverride] = useState(
    numberFieldValue(override.protectedMinimumMinutesOverride),
  );
  const [cadencePerWeekOverride, setCadencePerWeekOverride] = useState(
    numberFieldValue(override.cadencePerWeekOverride),
  );
  const [dismissed, setDismissed] = useState(initialPreviewState.preview === null);
  const [submittedPreviewDigest, setSubmittedPreviewDigest] = useState<string | null>(() =>
    initialApplyState.status === "idle"
      ? null
      : (initialPreviewState.preview?.previewDigest ?? null),
  );
  const [previewState, previewAction, previewPending] = useActionState(
    previewCampaignAllocationOverrideAction,
    initialPreviewState,
  );
  const [applyState, applyAction, applyPending] = useActionState(
    applyCampaignAllocationOverrideAction,
    initialApplyState,
  );
  const preview = isOverridePreview(previewState.preview) ? previewState.preview : null;
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
      // once, but the row that itself just called `onIntentStart` below would otherwise
      // immediately dismiss the very form it just opened, in the same commit.
      if (suppressNextDismiss.current) {
        suppressNextDismiss.current = false;
        return;
      }
      setDismissed(true);
      setSelectedOperation(null);
    }
  }, [dismissalVersion]);

  const startOperation = (operation: CampaignAllocationOverrideOperationV1) => {
    const nextRequestId = requestId();
    setCurrentRequestId(nextRequestId);
    if (previewRequestId.current !== null) previewRequestId.current.value = nextRequestId;
    setSelectedOperation(operation);
    setDismissed(false);
    suppressNextDismiss.current = true;
    onIntentStart();
  };

  return (
    <li className={styles.campaignCard}>
      <div>
        <strong>{override.learningTrack.title}</strong>
      </div>
      <dl>
        <div>
          <dt>Priority</dt>
          <dd>{override.priorityOverride ?? "unchanged"}</dd>
        </div>
        <div>
          <dt>Protected minutes</dt>
          <dd>{override.protectedMinimumMinutesOverride ?? "unchanged"}</dd>
        </div>
        <div>
          <dt>Cadence per week</dt>
          <dd>{override.cadencePerWeekOverride ?? "unchanged"}</dd>
        </div>
      </dl>
      <div className={styles.actions}>
        <button
          className={styles.secondaryButton}
          onClick={() => startOperation("change_campaign_allocation_override")}
          type="button"
        >
          {OPERATION_LABEL.change_campaign_allocation_override}
        </button>
        <button
          className={styles.secondaryButton}
          onClick={() => startOperation("remove_campaign_allocation_override")}
          type="button"
        >
          {OPERATION_LABEL.remove_campaign_allocation_override}
        </button>
      </div>
      {selectedOperation !== null && !dismissed ? (
        <form action={previewAction} className={styles.form}>
          <input name="overrideKey" type="hidden" value={override.overrideKey} />
          <input name="operation" type="hidden" value={selectedOperation} />
          <input name="expectedOverrideVersion" type="hidden" value={override.aggregateVersion} />
          <input name="requestId" ref={previewRequestId} type="hidden" value={currentRequestId} />
          {selectedOperation === "change_campaign_allocation_override" ? (
            <>
              <label htmlFor={`override-priority-${override.overrideKey}`}>
                Priority (0-100, blank clears it)
              </label>
              <input
                id={`override-priority-${override.overrideKey}`}
                max={100}
                min={0}
                name="priorityOverride"
                onChange={(event) => setPriorityOverride(event.target.value)}
                type="number"
                value={priorityOverride}
              />
              <label htmlFor={`override-protected-${override.overrideKey}`}>
                Protected minutes (0-10080, blank clears it)
              </label>
              <input
                id={`override-protected-${override.overrideKey}`}
                max={10_080}
                min={0}
                name="protectedMinimumMinutesOverride"
                onChange={(event) => setProtectedMinimumMinutesOverride(event.target.value)}
                type="number"
                value={protectedMinimumMinutesOverride}
              />
              <label htmlFor={`override-cadence-${override.overrideKey}`}>
                Cadence per week (0-100, blank clears it)
              </label>
              <input
                id={`override-cadence-${override.overrideKey}`}
                max={100}
                min={0}
                name="cadencePerWeekOverride"
                onChange={(event) => setCadencePerWeekOverride(event.target.value)}
                type="number"
                value={cadencePerWeekOverride}
              />
            </>
          ) : null}
          <label htmlFor={`override-reason-${override.overrideKey}`}>Reason</label>
          <textarea
            id={`override-reason-${override.overrideKey}`}
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
        <section aria-labelledby={`override-preview-heading-${override.overrideKey}`}>
          <h4 id={`override-preview-heading-${override.overrideKey}`}>
            Review this exact override change
          </h4>
          <div className={styles.comparison} aria-label="Exact allocation override preview">
            <div>
              <h5>Before</h5>
              <dl>
                <div>
                  <dt>Priority</dt>
                  <dd>{effectivePreview.before.priorityOverride ?? "unchanged"}</dd>
                </div>
                <div>
                  <dt>Protected minutes</dt>
                  <dd>{effectivePreview.before.protectedMinimumMinutesOverride ?? "unchanged"}</dd>
                </div>
                <div>
                  <dt>Cadence per week</dt>
                  <dd>{effectivePreview.before.cadencePerWeekOverride ?? "unchanged"}</dd>
                </div>
              </dl>
            </div>
            <div>
              <h5>After confirmation</h5>
              <dl>
                <div>
                  <dt>Priority</dt>
                  <dd>{effectivePreview.after.priorityOverride ?? "unchanged"}</dd>
                </div>
                <div>
                  <dt>Protected minutes</dt>
                  <dd>{effectivePreview.after.protectedMinimumMinutesOverride ?? "unchanged"}</dd>
                </div>
                <div>
                  <dt>Cadence per week</dt>
                  <dd>{effectivePreview.after.cadencePerWeekOverride ?? "unchanged"}</dd>
                </div>
              </dl>
            </div>
          </div>
          {effectivePreview.blockingReasons.length > 0 ? (
            <p className={styles.notice} role="alert">
              This would exceed the plan&rsquo;s weekly capacity. Nothing changed.
            </p>
          ) : null}
          <form
            action={applyAction}
            className={styles.form}
            onSubmit={() => setSubmittedPreviewDigest(effectivePreview.previewDigest)}
          >
            <input name="overrideKey" type="hidden" value={effectivePreview.before.overrideKey} />
            <input name="operation" type="hidden" value={effectivePreview.operation} />
            <input
              name="expectedOverrideVersion"
              type="hidden"
              value={effectivePreview.before.aggregateVersion}
            />
            <input
              name="priorityOverride"
              type="hidden"
              value={numberFieldValue(effectivePreview.after.priorityOverride)}
            />
            <input
              name="protectedMinimumMinutesOverride"
              type="hidden"
              value={numberFieldValue(effectivePreview.after.protectedMinimumMinutesOverride)}
            />
            <input
              name="cadencePerWeekOverride"
              type="hidden"
              value={numberFieldValue(effectivePreview.after.cadencePerWeekOverride)}
            />
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
                Keep this override as-is
              </button>
            </div>
          </form>
        </section>
      ) : null}
    </li>
  );
}

export function CampaignAllocationOverrides({
  campaignKey,
  overrides,
  dismissalVersion,
  onIntentStart,
  focusedOverrideKey,
  focusedPreviewState,
}: {
  readonly campaignKey: string;
  readonly overrides: readonly CampaignAllocationOverrideSummaryV1[];
  readonly dismissalVersion: number;
  readonly onIntentStart: () => void;
  readonly focusedOverrideKey?: string;
  readonly focusedPreviewState?: CampaignActionState;
}) {
  const activeOverrides = overrides.filter(
    (override) => override.campaignKey === campaignKey && override.lifecycle === "ACTIVE",
  );
  if (activeOverrides.length === 0) return null;

  return (
    <section aria-labelledby={`campaign-overrides-heading-${campaignKey}`} className={styles.panel}>
      <h3 id={`campaign-overrides-heading-${campaignKey}`}>Allocation overrides</h3>
      <ul className={styles.campaignList}>
        {activeOverrides.map((override) => (
          <OverrideRow
            dismissalVersion={dismissalVersion}
            key={override.overrideKey}
            onIntentStart={onIntentStart}
            override={override}
            {...(override.overrideKey === focusedOverrideKey && focusedPreviewState !== undefined
              ? { initialPreviewState: focusedPreviewState }
              : {})}
          />
        ))}
      </ul>
    </section>
  );
}
