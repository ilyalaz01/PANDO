"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import {
  applyLearningTrackCadenceAction,
  previewLearningTrackCadenceAction,
} from "../../app/plan/actions";
import { initialPlanActionState, type PlanActionState } from "./plan-action-state";
import styles from "./plan.module.css";
import type {
  LearningTrackCadencePreviewV1,
  LearningTrackCadenceSourceV1,
  PlanPreviewV1,
} from "./plan-types";

function cadencePreview(preview: PlanPreviewV1 | null): preview is LearningTrackCadencePreviewV1 {
  return preview?.contract.name === "LearningTrackCadencePreviewV1";
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

function progressValue(value: number | null): string {
  return value === null ? "Unknown" : String(value);
}

function warningText(code: LearningTrackCadencePreviewV1["warnings"][number]["code"]): string {
  if (code === "PARENT_GROWTH_PLAN_PAUSED") return "The Growth Plan is paused.";
  if (code === "LEARNING_TRACK_PAUSED") return "This Learning Track is paused.";
  return "Current-week cadence progress is not available yet. The target can still change.";
}

function CadenceComparison({ preview }: { readonly preview: LearningTrackCadencePreviewV1 }) {
  return (
    <div aria-label="Exact Learning Track cadence preview" className={styles.comparison}>
      <div>
        <h3>Before</h3>
        <dl>
          <dt>Track</dt>
          <dd>{preview.before.title}</dd>
          <dt>Cadence target</dt>
          <dd>{preview.before.cadencePerWeek} sessions per week</dd>
          <dt>Completed this week</dt>
          <dd>{progressValue(preview.progress.completedCadenceSessionsThisWeek)}</dd>
          <dt>Cadence deficit</dt>
          <dd>{progressValue(preview.progress.beforeCadenceDeficit)}</dd>
          <dt>Track version</dt>
          <dd>{preview.before.aggregateVersion}</dd>
        </dl>
      </div>
      <div>
        <h3>After confirmation</h3>
        <dl>
          <dt>Cadence target</dt>
          <dd>{preview.after.cadencePerWeek} sessions per week</dd>
          <dt>Completed this week</dt>
          <dd>{progressValue(preview.progress.completedCadenceSessionsThisWeek)}</dd>
          <dt>Cadence deficit</dt>
          <dd>{progressValue(preview.progress.afterCadenceDeficit)}</dd>
          <dt>Track version</dt>
          <dd>{preview.after.aggregateVersion}</dd>
          <dt>Planning projection</dt>
          <dd>Pending recalculation</dd>
        </dl>
      </div>
    </div>
  );
}

export function LearningTrackCadence({
  source,
  dismissalVersion = 0,
  onIntentStart,
  initialPreviewState = initialPlanActionState,
  initialApplyState = initialPlanActionState,
}: {
  readonly source: LearningTrackCadenceSourceV1;
  readonly dismissalVersion?: number;
  readonly onIntentStart?: () => void;
  readonly initialPreviewState?: PlanActionState;
  readonly initialApplyState?: PlanActionState;
}) {
  const router = useRouter();
  const requestIdInput = useRef<HTMLInputElement>(null);
  const observedDismissalVersion = useRef(dismissalVersion);
  const initialPreview = cadencePreview(initialPreviewState.preview)
    ? initialPreviewState.preview
    : null;
  const initialTrack =
    source.learningTracks.find((track) => track.trackKey === initialPreview?.before.trackKey) ??
    source.learningTracks[0];
  const [trackKey, setTrackKey] = useState(initialTrack?.trackKey ?? "");
  const selectedTrack =
    source.learningTracks.find((track) => track.trackKey === trackKey) ?? initialTrack;
  const [cadencePerWeek, setCadencePerWeek] = useState(
    String(initialPreview?.after.cadencePerWeek ?? initialTrack?.cadencePerWeek ?? 0),
  );
  const [reason, setReason] = useState(initialPreview?.reason ?? "");
  const [requestId, setRequestId] = useState("");
  const [dismissed, setDismissed] = useState(false);
  const [submittedPreviewDigest, setSubmittedPreviewDigest] = useState<string | null>(() =>
    initialApplyState.status === "idle" ? null : (initialPreview?.previewDigest ?? null),
  );
  const [previewState, previewAction, previewPending] = useActionState(
    previewLearningTrackCadenceAction,
    initialPreviewState,
  );
  const [applyState, applyAction, applyPending] = useActionState(
    applyLearningTrackCadenceAction,
    initialApplyState,
  );
  const preview = cadencePreview(previewState.preview) ? previewState.preview : null;
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

  if (source.growthPlan === null) {
    return (
      <section aria-labelledby="track-cadence-heading" className={styles.panel}>
        <h2 id="track-cadence-heading">Track cadence</h2>
        <p>Create a Growth Plan before setting a Learning Track cadence.</p>
      </section>
    );
  }

  const announceIntent = () => {
    setDismissed(true);
    onIntentStart?.();
  };
  const startPreview = () => {
    onIntentStart?.();
    const nextRequestId = globalThis.crypto.randomUUID();
    setRequestId(nextRequestId);
    if (requestIdInput.current !== null) requestIdInput.current.value = nextRequestId;
    setDismissed(false);
  };
  const proposedCadence = Number(cadencePerWeek);
  const canPreview =
    selectedTrack !== undefined &&
    Number.isInteger(proposedCadence) &&
    proposedCadence >= 0 &&
    proposedCadence <= 100 &&
    proposedCadence !== selectedTrack.cadencePerWeek;

  return (
    <>
      <section aria-labelledby="track-cadence-heading" className={styles.panel}>
        <h2 id="track-cadence-heading">Track cadence</h2>
        <p>
          Set a soft target for evidence-bearing completed Focus sessions per week. It does not
          reserve minutes, prove Mastery, or block planning. A value of 0 means no cadence target.
        </p>
        {source.learningTracks.length === 0 ? (
          <p>No current Learning Tracks are available.</p>
        ) : null}
        {selectedTrack !== undefined ? (
          <form action={previewAction} className={styles.form} onSubmit={startPreview}>
            <label htmlFor="track-cadence-select">Track</label>
            <select
              className={styles.selectInput}
              id="track-cadence-select"
              name="trackKey"
              onChange={(event) => {
                const nextTrack = source.learningTracks.find(
                  (track) => track.trackKey === event.target.value,
                );
                setTrackKey(event.target.value);
                setCadencePerWeek(String(nextTrack?.cadencePerWeek ?? 0));
                announceIntent();
              }}
              value={selectedTrack.trackKey}
            >
              {source.learningTracks.map((track) => (
                <option key={track.learningTrackId} value={track.trackKey}>
                  {track.title}
                </option>
              ))}
            </select>
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
            <label htmlFor="track-cadence-value">Evidence-bearing sessions per week</label>
            <input
              className={styles.numberInput}
              id="track-cadence-value"
              inputMode="numeric"
              max={100}
              min={0}
              name="cadencePerWeek"
              onChange={(event) => {
                setCadencePerWeek(event.target.value);
                announceIntent();
              }}
              required
              step={1}
              type="number"
              value={cadencePerWeek}
            />
            <p className={styles.status}>
              Completed this week: {progressValue(selectedTrack.completedCadenceSessionsThisWeek)}.
              {source.progress.state !== "CURRENT"
                ? " Progress will appear after a current V2 planning snapshot is available."
                : ""}
            </p>
            <label htmlFor="track-cadence-reason">Why should this cadence change now?</label>
            <textarea
              id="track-cadence-reason"
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
              disabled={previewPending || !canPreview}
              type="submit"
            >
              {previewPending ? "Preparing preview…" : "Preview cadence change"}
            </button>
            <Status state={previewState} />
          </form>
        ) : null}
      </section>
      {effectivePreview !== null ? (
        <section aria-labelledby="track-cadence-preview-heading" className={styles.panel}>
          <h2 id="track-cadence-preview-heading">Review Track cadence</h2>
          <CadenceComparison preview={effectivePreview} />
          <p>Reason: {effectivePreview.reason}</p>
          {effectivePreview.warnings.map((warning) => (
            <p className={styles.notice} key={warning.code} role="status">
              {warningText(warning.code)}
            </p>
          ))}
          <p className={styles.notice}>
            Priority, protected minimum, activities, Focus history, Evidence, Mastery, readiness,
            Review, and previous snapshots stay unchanged. Planning recalculation will be pending.
          </p>
          {applyStateForPreview.status !== "conflict" ? (
            <form
              action={applyAction}
              className={styles.actions}
              onSubmit={() => setSubmittedPreviewDigest(effectivePreview.previewDigest)}
            >
              <input name="trackKey" type="hidden" value={effectivePreview.before.trackKey} />
              <input
                name="cadencePerWeek"
                type="hidden"
                value={effectivePreview.after.cadencePerWeek}
              />
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
                {applyPending ? "Applying…" : "Confirm cadence"}
              </button>
              <button
                className={styles.secondaryButton}
                disabled={applyPending}
                onClick={() => setDismissed(true)}
                type="button"
              >
                Keep current cadence
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
