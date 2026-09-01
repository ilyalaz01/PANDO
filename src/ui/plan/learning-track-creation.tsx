"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import {
  applyLearningTrackCreationAction,
  previewLearningTrackCreationAction,
} from "../../app/plan/actions";
import { initialPlanActionState, type PlanActionState } from "./plan-action-state";
import styles from "./plan.module.css";
import type {
  LearningTrackCreationPreviewV1,
  LearningTrackCreationSourceV1,
  PlanPreviewV1,
} from "./plan-types";

function creationPreview(preview: PlanPreviewV1 | null): preview is LearningTrackCreationPreviewV1 {
  return preview?.contract.name === "LearningTrackCreationPreviewV1";
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

function UnavailableSource({ source }: { readonly source: LearningTrackCreationSourceV1 }) {
  const copy =
    source.state === "TRACK_PORTFOLIO_LIMIT_REACHED"
      ? "This Plan already has 30 current Tracks. Pause or replace existing work before creating another lane."
      : source.state === "GOAL_PORTFOLIO_OVERFLOW"
        ? "More than 20 active Goals are competing here. Narrow the Targets portfolio before adding another Track."
        : source.state === "NO_ACTIVE_GOALS"
          ? "No active Targets are available for a new Track yet."
          : "Create a Growth Plan before adding another Learning Track.";
  return (
    <section aria-labelledby="learning-track-creation-heading" className={styles.panel}>
      <h2 id="learning-track-creation-heading">Create another Learning Track</h2>
      <p>{copy}</p>
      {(source.state === "NO_ACTIVE_GOALS" || source.state === "GOAL_PORTFOLIO_OVERFLOW") && (
        <Link className={styles.secondaryButton} href="/start">
          Open Targets
        </Link>
      )}
    </section>
  );
}

function PreviewDetails({ preview }: { readonly preview: LearningTrackCreationPreviewV1 }) {
  return (
    <div aria-label="Exact Learning Track creation preview" className={styles.comparison}>
      <div>
        <h3>Source and placement</h3>
        <dl>
          <dt>Target</dt>
          <dd>{preview.source.readinessGoalTitle}</dd>
          <dt>Profile</dt>
          <dd>{preview.source.profileVersionKey}</dd>
          <dt>Source</dt>
          <dd>
            {preview.source.roadmapVersionId === null
              ? "Requirement collection"
              : "Roadmap template"}
          </dd>
          <dt>Track order</dt>
          <dd>
            {preview.constraint.currentTrackCountBefore} →{" "}
            {preview.constraint.currentTrackCountAfter}
            {" / "}
            {preview.constraint.currentTrackLimit}
          </dd>
          <dt>New position</dt>
          <dd>{preview.constraint.newTrackPosition}</dd>
        </dl>
      </div>
      <div>
        <h3>{preview.canApply ? "After confirmation" : "Proposed"}</h3>
        <dl>
          <dt>Track title</dt>
          <dd>{preview.learningTrack.title}</dd>
          <dt>Priority</dt>
          <dd>{preview.learningTrack.priority}</dd>
          <dt>Default session</dt>
          <dd>{preview.learningTrack.defaultSessionMinutes} minutes</dd>
          <dt>Protected minimum</dt>
          <dd>{preview.learningTrack.protectedMinimumMinutes} minutes</dd>
          <dt>Plan version</dt>
          <dd>{preview.growthPlan.aggregateVersion} (unchanged)</dd>
          <dt>Track version</dt>
          <dd>{preview.learningTrack.aggregateVersion}</dd>
        </dl>
      </div>
    </div>
  );
}

export function LearningTrackCreation({
  source,
  dismissalVersion = 0,
  onIntentStart,
  initialPreviewState = initialPlanActionState,
  initialApplyState = initialPlanActionState,
}: {
  readonly source: LearningTrackCreationSourceV1;
  readonly dismissalVersion?: number;
  readonly onIntentStart?: () => void;
  readonly initialPreviewState?: PlanActionState;
  readonly initialApplyState?: PlanActionState;
}) {
  const router = useRouter();
  const previewRequestId = useRef<HTMLInputElement>(null);
  const observedDismissalVersion = useRef(dismissalVersion);
  const initialPreview = creationPreview(initialPreviewState.preview)
    ? initialPreviewState.preview
    : null;
  const [readinessGoalKey, setReadinessGoalKey] = useState(
    initialPreview?.source.readinessGoalKey ?? source.goals[0]?.readinessGoalKey ?? "",
  );
  const selectedGoal =
    source.goals.find((goal) => goal.readinessGoalKey === readinessGoalKey) ?? source.goals[0];
  const [title, setTitle] = useState(initialPreview?.learningTrack.title ?? "");
  const [priority, setPriority] = useState(String(initialPreview?.learningTrack.priority ?? 50));
  const [defaultSessionMinutes, setDefaultSessionMinutes] = useState(
    String(initialPreview?.learningTrack.defaultSessionMinutes ?? 30),
  );
  const [reason, setReason] = useState(initialPreview?.reason ?? "");
  const [requestId, setRequestId] = useState(initialPreview?.requestId ?? "");
  const [dismissed, setDismissed] = useState(false);
  const [submittedPreviewDigest, setSubmittedPreviewDigest] = useState<string | null>(() =>
    initialApplyState.status === "idle" ? null : (initialPreview?.previewDigest ?? null),
  );
  const [previewState, previewAction, previewPending] = useActionState(
    previewLearningTrackCreationAction,
    initialPreviewState,
  );
  const [applyState, applyAction, applyPending] = useActionState(
    applyLearningTrackCreationAction,
    initialApplyState,
  );
  const preview = creationPreview(previewState.preview) ? previewState.preview : null;
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
    return <UnavailableSource source={source} />;
  }

  const dismissPreview = () => setDismissed(true);
  const startPreview = () => {
    onIntentStart?.();
    const nextRequestId = globalThis.crypto.randomUUID();
    setRequestId(nextRequestId);
    if (previewRequestId.current !== null) previewRequestId.current.value = nextRequestId;
    setDismissed(false);
  };

  return (
    <>
      <section aria-labelledby="learning-track-creation-heading" className={styles.panel}>
        <h2 id="learning-track-creation-heading">Create another Learning Track</h2>
        <p>
          Add a separate planning lane under the current Growth Plan. The new Track starts active
          with zero protected minutes, so capacity does not change until useful work is admitted or
          settings are edited later.
        </p>
        <form action={previewAction} className={styles.form} onSubmit={startPreview}>
          <input
            name="expectedGrowthPlanVersion"
            type="hidden"
            value={source.growthPlan.aggregateVersion}
          />
          <input
            name="expectedReadinessGoalVersion"
            type="hidden"
            value={selectedGoal?.aggregateVersion ?? ""}
          />
          <input name="requestId" ref={previewRequestId} type="hidden" value={requestId} />
          <label htmlFor="learning-track-creation-target">Target</label>
          <select
            className={styles.selectInput}
            id="learning-track-creation-target"
            name="readinessGoalKey"
            onChange={(event) => {
              setReadinessGoalKey(event.target.value);
              dismissPreview();
            }}
            value={readinessGoalKey}
          >
            {source.goals.map((goal) => (
              <option key={goal.readinessGoalKey} value={goal.readinessGoalKey}>
                {goal.title} — {goal.profileLabel}
                {goal.roadmapPresent ? " · roadmap" : " · requirements"}
              </option>
            ))}
          </select>
          <label htmlFor="learning-track-creation-title">Track title</label>
          <input
            className={styles.selectInput}
            id="learning-track-creation-title"
            maxLength={160}
            name="title"
            onChange={(event) => {
              setTitle(event.target.value);
              dismissPreview();
            }}
            required
            type="text"
            value={title}
          />
          <label htmlFor="learning-track-creation-priority">Priority (0–100)</label>
          <input
            className={styles.numberInput}
            id="learning-track-creation-priority"
            inputMode="numeric"
            max={100}
            min={0}
            name="priority"
            onChange={(event) => {
              setPriority(event.target.value);
              dismissPreview();
            }}
            required
            step={1}
            type="number"
            value={priority}
          />
          <label htmlFor="learning-track-creation-default-session">Default session (minutes)</label>
          <input
            className={styles.numberInput}
            id="learning-track-creation-default-session"
            inputMode="numeric"
            max={480}
            min={1}
            name="defaultSessionMinutes"
            onChange={(event) => {
              setDefaultSessionMinutes(event.target.value);
              dismissPreview();
            }}
            required
            step={1}
            type="number"
            value={defaultSessionMinutes}
          />
          <label htmlFor="learning-track-creation-reason">Why does this Track belong now?</label>
          <textarea
            id="learning-track-creation-reason"
            maxLength={500}
            name="reason"
            onChange={(event) => {
              setReason(event.target.value);
              dismissPreview();
            }}
            required
            value={reason}
          />
          <button className={styles.button} disabled={previewPending} type="submit">
            {previewPending ? "Preparing preview…" : "Preview Learning Track"}
          </button>
          <Status state={previewState} />
        </form>
      </section>
      {effectivePreview ? (
        <section aria-labelledby="learning-track-creation-preview-heading" className={styles.panel}>
          <h2 id="learning-track-creation-preview-heading">Review Learning Track creation</h2>
          <PreviewDetails preview={effectivePreview} />
          <p>Reason: {effectivePreview.reason}</p>
          {effectivePreview.warnings.map((warning) => (
            <p className={styles.notice} key={warning.code} role="status">
              {warning.code === "PARENT_GROWTH_PLAN_PAUSED"
                ? "The Growth Plan is paused. This Track is saved, but Today stays paused until the Plan resumes."
                : "The new Track starts empty. It will not affect Today until useful work is added."}
            </p>
          ))}
          {!effectivePreview.canApply ? (
            <div className={styles.notice} role="alert">
              {effectivePreview.blockingReasons.map((reason) => (
                <p key={reason.code}>
                  {reason.code === "PLANNING_CREATE_IDENTITY_COLLISION"
                    ? "This preview request key collided with an existing create intent. Start again to generate a fresh request."
                    : `This Plan is already at ${effectivePreview.constraint.currentTrackLimit} current Tracks. Nothing can be confirmed from this preview.`}
                </p>
              ))}
              <button
                className={styles.secondaryButton}
                onClick={() => setDismissed(true)}
                type="button"
              >
                Start over
              </button>
            </div>
          ) : (
            <>
              <p className={styles.notice}>
                Existing activities, evidence, mastery, reviews, and plan history remain unchanged.
                One Planning recalculation will be pending after confirmation.
              </p>
              <form
                action={applyAction}
                className={styles.actions}
                onSubmit={() => setSubmittedPreviewDigest(effectivePreview.previewDigest)}
              >
                <input
                  name="readinessGoalKey"
                  type="hidden"
                  value={effectivePreview.source.readinessGoalKey}
                />
                <input
                  name="expectedReadinessGoalVersion"
                  type="hidden"
                  value={effectivePreview.expectedReadinessGoalVersion}
                />
                <input name="title" type="hidden" value={effectivePreview.learningTrack.title} />
                <input
                  name="priority"
                  type="hidden"
                  value={effectivePreview.learningTrack.priority}
                />
                <input
                  name="defaultSessionMinutes"
                  type="hidden"
                  value={effectivePreview.learningTrack.defaultSessionMinutes}
                />
                <input
                  name="expectedGrowthPlanVersion"
                  type="hidden"
                  value={effectivePreview.expectedGrowthPlanVersion}
                />
                <input name="reason" type="hidden" value={effectivePreview.reason} />
                <input name="requestId" type="hidden" value={effectivePreview.requestId} />
                <input name="previewDigest" type="hidden" value={effectivePreview.previewDigest} />
                <button
                  className={styles.button}
                  disabled={applyPending || applyStateForPreview.status === "conflict"}
                  type="submit"
                >
                  {applyPending ? "Creating…" : "Confirm and create Learning Track"}
                </button>
                <button
                  className={styles.secondaryButton}
                  disabled={applyPending}
                  onClick={() => setDismissed(true)}
                  type="button"
                >
                  Start over
                </button>
                <Status state={applyStateForPreview} />
              </form>
            </>
          )}
          {applyStateForPreview.status === "conflict" ? (
            <div className={styles.notice} role="alert">
              <p>The Plan or selected Target changed. Reload, then create a fresh preview.</p>
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
          ) : null}
        </section>
      ) : null}
    </>
  );
}
