"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import {
  applyLearningTrackTerminalLifecycleAction,
  previewLearningTrackTerminalLifecycleAction,
} from "../../app/plan/actions";
import { initialPlanActionState, type PlanActionState } from "./plan-action-state";
import styles from "./plan.module.css";
import type {
  LearningTrackTerminalLifecyclePreviewV1,
  LearningTrackTerminalLifecycleSourceV1,
  PlanPreviewV1,
} from "./plan-types";

type TerminalTrack =
  | LearningTrackTerminalLifecycleSourceV1["currentTracks"][number]
  | LearningTrackTerminalLifecycleSourceV1["terminalHistory"][number];
type TerminalOperation = TerminalTrack["capabilities"][number];

function terminalPreview(
  preview: PlanPreviewV1 | null,
): preview is LearningTrackTerminalLifecyclePreviewV1 {
  return preview?.contract.name === "LearningTrackTerminalLifecyclePreviewV1";
}

function Status({ state }: { readonly state: PlanActionState }) {
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

function PreviewDetails({
  preview,
}: {
  readonly preview: LearningTrackTerminalLifecyclePreviewV1;
}) {
  return (
    <div aria-label="Exact terminal Learning Track preview" className={styles.comparison}>
      <div>
        <h3>Before</h3>
        <dl>
          <dt>Track</dt>
          <dd>{preview.before.title}</dd>
          <dt>Lifecycle</dt>
          <dd>{preview.before.lifecycle}</dd>
          <dt>Track version</dt>
          <dd>{preview.before.aggregateVersion}</dd>
          <dt>Current Tracks</dt>
          <dd>{preview.currentPortfolio.countBefore}</dd>
          <dt>Active Tracks</dt>
          <dd>{preview.activeConstraint.activeTrackCountBefore}</dd>
          <dt>Protected minimum</dt>
          <dd>{preview.activeConstraint.activeProtectedMinimumMinutesBefore} minutes</dd>
          <dt>Flexible capacity</dt>
          <dd>{preview.activeConstraint.flexibleMinutesBefore} minutes</dd>
        </dl>
      </div>
      <div>
        <h3>After confirmation</h3>
        <dl>
          <dt>Lifecycle</dt>
          <dd>{preview.after.lifecycle}</dd>
          <dt>Track version</dt>
          <dd>{preview.after.aggregateVersion}</dd>
          <dt>Visibility</dt>
          <dd>{visibilityLabel(preview.visibilityAfter)}</dd>
          <dt>Current Tracks</dt>
          <dd>{preview.currentPortfolio.countAfter}</dd>
          <dt>Active Tracks</dt>
          <dd>{preview.activeConstraint.activeTrackCountAfter}</dd>
          <dt>Protected minimum</dt>
          <dd>{preview.activeConstraint.activeProtectedMinimumMinutesAfter} minutes</dd>
          <dt>Flexible capacity</dt>
          <dd>{preview.activeConstraint.flexibleMinutesAfter} minutes</dd>
        </dl>
      </div>
    </div>
  );
}

function firstOperation(track: TerminalTrack | undefined): TerminalOperation | "" {
  return track?.capabilities[0] ?? "";
}

function visibilityLabel(
  value: LearningTrackTerminalLifecyclePreviewV1["visibilityAfter"],
): string {
  const label = value.replaceAll("_", " ").toLowerCase();
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function lifecycleLabel(value: TerminalTrack["lifecycle"]): string {
  return value.charAt(0) + value.slice(1).toLowerCase();
}

export function LearningTrackTerminalLifecycle({
  source,
  nextHistoryHref,
  dismissalVersion = 0,
  onIntentStart,
  initialPreviewState = initialPlanActionState,
  initialApplyState = initialPlanActionState,
}: {
  readonly source: LearningTrackTerminalLifecycleSourceV1;
  readonly nextHistoryHref?: string;
  readonly dismissalVersion?: number;
  readonly onIntentStart?: () => void;
  readonly initialPreviewState?: PlanActionState;
  readonly initialApplyState?: PlanActionState;
}) {
  const router = useRouter();
  const requestIdInput = useRef<HTMLInputElement>(null);
  const observedDismissalVersion = useRef(dismissalVersion);
  const initialPreview = terminalPreview(initialPreviewState.preview)
    ? initialPreviewState.preview
    : null;
  const tracks: readonly TerminalTrack[] = [...source.currentTracks, ...source.terminalHistory];
  const initialTrack =
    tracks.find((track) => track.trackKey === initialPreview?.before.trackKey) ?? tracks[0];
  const [trackKey, setTrackKey] = useState(initialTrack?.trackKey ?? "");
  const selectedTrack = tracks.find((track) => track.trackKey === trackKey) ?? initialTrack;
  const [operation, setOperation] = useState<TerminalOperation | "">(
    initialPreview?.operation ?? firstOperation(initialTrack),
  );
  const [reason, setReason] = useState(initialPreview?.reason ?? "");
  const [requestId, setRequestId] = useState("");
  const [dismissed, setDismissed] = useState(false);
  const [submittedPreviewDigest, setSubmittedPreviewDigest] = useState<string | null>(() =>
    initialApplyState.status === "idle" ? null : (initialPreview?.previewDigest ?? null),
  );
  const [previewState, previewAction, previewPending] = useActionState(
    previewLearningTrackTerminalLifecycleAction,
    initialPreviewState,
  );
  const [applyState, applyAction, applyPending] = useActionState(
    applyLearningTrackTerminalLifecycleAction,
    initialApplyState,
  );
  const preview = terminalPreview(previewState.preview) ? previewState.preview : null;
  const applyStateForPreview =
    preview !== null && preview.previewDigest === submittedPreviewDigest
      ? applyState
      : initialPlanActionState;
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

  if (source.state !== "READY" || source.growthPlan === null) {
    return (
      <section aria-labelledby="terminal-track-heading" className={styles.panel}>
        <h2 id="terminal-track-heading">Complete or archive a Learning Track</h2>
        <p>Create a Growth Plan before managing terminal Track history.</p>
      </section>
    );
  }

  const dismissPreview = () => setDismissed(true);
  const announceIntent = () => {
    dismissPreview();
    onIntentStart?.();
  };
  const startPreview = () => {
    onIntentStart?.();
    const nextRequestId = globalThis.crypto.randomUUID();
    setRequestId(nextRequestId);
    if (requestIdInput.current !== null) requestIdInput.current.value = nextRequestId;
    setDismissed(false);
  };
  const canPreview = selectedTrack !== undefined && selectedTrack.capabilities.length > 0;

  return (
    <>
      <section aria-labelledby="terminal-track-heading" className={styles.panel}>
        <h2 id="terminal-track-heading">Complete or archive a Learning Track</h2>
        <p>
          Completion removes a Track from current planning without claiming Mastery, readiness, or
          Goal completion. Archive moves it to read-only history; neither action deletes work.
        </p>
        {tracks.length === 0 ? <p>No current or terminal Tracks are available.</p> : null}
        {tracks.length > 0 ? (
          <form action={previewAction} className={styles.form} onSubmit={startPreview}>
            <label htmlFor="terminal-track-select">Track</label>
            <select
              className={styles.selectInput}
              id="terminal-track-select"
              name="trackKey"
              onChange={(event) => {
                const nextKey = event.target.value;
                const nextTrack = tracks.find((track) => track.trackKey === nextKey);
                setTrackKey(nextKey);
                setOperation(firstOperation(nextTrack));
                announceIntent();
              }}
              value={selectedTrack?.trackKey ?? ""}
            >
              {tracks.map((track) => (
                <option key={track.learningTrackId} value={track.trackKey}>
                  {track.title} — {lifecycleLabel(track.lifecycle)}
                  {track.lifecycle === "ARCHIVED" ? " · read-only" : ""}
                </option>
              ))}
            </select>
            {canPreview && selectedTrack !== undefined ? (
              <>
                <input
                  name="expectedGrowthPlanVersion"
                  type="hidden"
                  value={source.growthPlan.aggregateVersion}
                />
                <input
                  name="expectedLearningTrackVersion"
                  type="hidden"
                  value={selectedTrack.aggregateVersion}
                />
                <fieldset>
                  <legend>Operation</legend>
                  {selectedTrack.capabilities.map((capability) => (
                    <label key={capability}>
                      <input
                        checked={operation === capability}
                        name="operation"
                        onChange={() => {
                          setOperation(capability);
                          announceIntent();
                        }}
                        type="radio"
                        value={capability}
                      />{" "}
                      {capability === "complete_track" ? "Complete Track" : "Archive Track"}
                    </label>
                  ))}
                </fieldset>
                <label htmlFor="terminal-track-reason">Why should this Track change now?</label>
                <textarea
                  id="terminal-track-reason"
                  maxLength={500}
                  name="reason"
                  onChange={(event) => {
                    setReason(event.target.value);
                    announceIntent();
                  }}
                  required
                  value={reason}
                />
                <button
                  className={styles.button}
                  disabled={previewPending || operation === ""}
                  type="submit"
                >
                  {previewPending ? "Preparing preview…" : "Preview terminal change"}
                </button>
                <Status state={previewState} />
              </>
            ) : (
              <p className={styles.notice} role="status">
                This archived Track is read-only. Its activities, sessions, Evidence, mastery,
                readiness, Review items, snapshots, and history remain available.
              </p>
            )}
          </form>
        ) : null}
        {nextHistoryHref !== undefined ? (
          <Link
            className={styles.secondaryButton}
            href={nextHistoryHref}
            onClick={announceIntent}
            scroll={false}
          >
            Next history page
          </Link>
        ) : null}
      </section>
      {effectivePreview !== null ? (
        <section aria-labelledby="terminal-track-preview-heading" className={styles.panel}>
          <h2 id="terminal-track-preview-heading">Review terminal Track change</h2>
          <PreviewDetails preview={effectivePreview} />
          <p>Reason: {effectivePreview.reason}</p>
          <p className={styles.notice} role="status">
            {effectivePreview.operation === "complete_track"
              ? "This Planning decision is terminal. It creates no Evidence, proves no Mastery or readiness, and completes no Goal."
              : "Archive is terminal history visibility, not deletion. This Track cannot be resumed."}
          </p>
          <p className={styles.notice}>
            Activities and attributions, Focus sessions, Evidence, Mastery and readiness, Review
            items, plan snapshots, receipts, events, and Track history are retained. One Planning
            recalculation will be pending after confirmation.
          </p>
          {applyStateForPreview.status !== "conflict" ? (
            <form
              action={applyAction}
              className={styles.actions}
              onSubmit={() => setSubmittedPreviewDigest(effectivePreview.previewDigest)}
            >
              <input name="trackKey" type="hidden" value={effectivePreview.before.trackKey} />
              <input name="operation" type="hidden" value={effectivePreview.operation} />
              <input
                name="expectedGrowthPlanVersion"
                type="hidden"
                value={effectivePreview.expectedGrowthPlanVersion}
              />
              <input
                name="expectedLearningTrackVersion"
                type="hidden"
                value={effectivePreview.expectedLearningTrackVersion}
              />
              <input name="reason" type="hidden" value={effectivePreview.reason} />
              <input name="previewDigest" type="hidden" value={effectivePreview.previewDigest} />
              <input name="requestId" ref={requestIdInput} type="hidden" value={requestId} />
              <button className={styles.button} disabled={applyPending} type="submit">
                {applyPending
                  ? "Applying…"
                  : effectivePreview.operation === "complete_track"
                    ? "Complete this Track"
                    : "Archive this Track"}
              </button>
              <button
                className={styles.secondaryButton}
                disabled={applyPending}
                onClick={() => setDismissed(true)}
                type="button"
              >
                Keep current state
              </button>
              <Status state={applyStateForPreview} />
            </form>
          ) : (
            <div className={styles.notice} role="alert">
              <p>The Plan or Track changed. Reload and create a fresh preview.</p>
              <button
                className={styles.secondaryButton}
                onClick={() => {
                  setDismissed(true);
                  router.refresh();
                }}
                type="button"
              >
                Reload current Plan
              </button>
            </div>
          )}
        </section>
      ) : null}
    </>
  );
}
