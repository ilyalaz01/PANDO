"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import {
  applyLearningTrackActivityAdmissionAction,
  previewLearningTrackActivityAdmissionAction,
} from "../../app/plan/actions";
import { initialPlanActionState, type PlanActionState } from "./plan-action-state";
import styles from "./plan.module.css";
import type {
  LearningTrackActivityAdmissionPreviewV1,
  LearningTrackActivityAdmissionSourceV1,
  PlanPreviewV1,
} from "./plan-types";

function activityPreview(
  preview: PlanPreviewV1 | null,
): preview is LearningTrackActivityAdmissionPreviewV1 {
  return preview?.contract.name === "LearningTrackActivityAdmissionPreviewV1";
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

function UnavailableSource({
  source,
}: {
  readonly source: LearningTrackActivityAdmissionSourceV1;
}) {
  const copy =
    source.state === "CURRENT_TRACK_PORTFOLIO_UNAVAILABLE"
      ? "This first activity flow is available only while the Plan has exactly one current Track. Nothing changed."
      : source.state === "PLAN_ACTIVITY_LIMIT_REACHED"
        ? "This Plan already has 200 current activities. Archive or complete existing work before adding more."
        : source.state === "ELIGIBLE_ACTIVITY_PORTFOLIO_OVERFLOW"
          ? "More than 200 personal activities match this Track. Narrow your active work in Explore before adding one here."
          : "No accepted personal activity is ready for this Track yet.";
  return (
    <section className={styles.panel} aria-labelledby="activity-admission-heading">
      <h2 id="activity-admission-heading">Add useful work</h2>
      <p>{copy}</p>
      {source.state === "NO_ELIGIBLE_ACTIVITIES" ||
      source.state === "ELIGIBLE_ACTIVITY_PORTFOLIO_OVERFLOW" ? (
        <Link className={styles.secondaryButton} href="/explore">
          Open Explore
        </Link>
      ) : null}
    </section>
  );
}

function PreviewDetails({
  preview,
}: {
  readonly preview: LearningTrackActivityAdmissionPreviewV1;
}) {
  return (
    <div aria-label="Exact activity admission preview" className={styles.comparison}>
      <div>
        <h3>Selected work</h3>
        <dl>
          <dt>Activity</dt>
          <dd>{preview.activity.title}</dd>
          <dt>Type</dt>
          <dd>{preview.activity.activityType.replaceAll("_", " ")}</dd>
          <dt>Competency</dt>
          <dd>{preview.activity.targetCompetencyRef}</dd>
          <dt>Estimate</dt>
          <dd>{preview.activity.estimatedMinutes} minutes</dd>
          <dt>Energy</dt>
          <dd>{preview.activity.energy ?? "Not set"}</dd>
        </dl>
      </div>
      <div>
        <h3>Planning effect</h3>
        <dl>
          <dt>Track</dt>
          <dd>{preview.learningTrack.title}</dd>
          <dt>Activities</dt>
          <dd>
            {preview.constraint.planActivityCountBefore} →{" "}
            {preview.constraint.planActivityCountAfter}
            {" / "}
            {preview.constraint.planActivityLimit}
          </dd>
          <dt>Track version</dt>
          <dd>
            {preview.learningTrack.aggregateVersionBefore} →{" "}
            {preview.learningTrack.aggregateVersionAfter}
          </dd>
          <dt>Plan version</dt>
          <dd>{preview.growthPlan.aggregateVersion} (unchanged)</dd>
          <dt>Recalculation</dt>
          <dd>Pending after confirmation</dd>
        </dl>
      </div>
    </div>
  );
}

export function ActivityAdmission({
  source,
  dismissalVersion = 0,
  onIntentStart,
  initialPreviewState = initialPlanActionState,
  initialApplyState = initialPlanActionState,
}: {
  readonly source: LearningTrackActivityAdmissionSourceV1;
  readonly dismissalVersion?: number;
  readonly onIntentStart?: () => void;
  readonly initialPreviewState?: PlanActionState;
  readonly initialApplyState?: PlanActionState;
}) {
  const router = useRouter();
  const previewRequestId = useRef<HTMLInputElement>(null);
  const observedDismissalVersion = useRef(dismissalVersion);
  const initialPreview = activityPreview(initialPreviewState.preview)
    ? initialPreviewState.preview
    : null;
  const [activityKey, setActivityKey] = useState(
    initialPreview?.activity.activityKey ?? source.activities[0]?.activityKey ?? "",
  );
  const [estimatedMinutes, setEstimatedMinutes] = useState(
    String(
      initialPreview?.activity.estimatedMinutes ??
        source.learningTrack?.defaultSessionMinutes ??
        30,
    ),
  );
  const [energy, setEnergy] = useState(initialPreview?.activity.energy ?? "");
  const [reason, setReason] = useState(initialPreview?.reason ?? "");
  const [requestId, setRequestId] = useState(initialPreview?.requestId ?? "");
  const [dismissed, setDismissed] = useState(false);
  const [submittedPreviewDigest, setSubmittedPreviewDigest] = useState<string | null>(() =>
    initialApplyState.status === "idle" ? null : (initialPreview?.previewDigest ?? null),
  );
  const [previewState, previewAction, previewPending] = useActionState(
    previewLearningTrackActivityAdmissionAction,
    initialPreviewState,
  );
  const [applyState, applyAction, applyPending] = useActionState(
    applyLearningTrackActivityAdmissionAction,
    initialApplyState,
  );
  const preview = activityPreview(previewState.preview) ? previewState.preview : null;
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

  if (source.state !== "READY" || source.growthPlan === null || source.learningTrack === null) {
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
      <section className={styles.panel} aria-labelledby="activity-admission-heading">
        <h2 id="activity-admission-heading">Add useful work</h2>
        <p>
          Add one accepted personal activity to {source.learningTrack.title}. It becomes a Planning
          candidate after recalculation; this does not promise a Today recommendation.
        </p>
        <form action={previewAction} className={styles.form} onSubmit={startPreview}>
          <input
            name="expectedGrowthPlanVersion"
            type="hidden"
            value={source.growthPlan.aggregateVersion}
          />
          <input
            name="expectedLearningTrackVersion"
            type="hidden"
            value={source.learningTrack.aggregateVersion}
          />
          <input name="requestId" ref={previewRequestId} type="hidden" value={requestId} />
          <label htmlFor="activity-admission-choice">Personal activity</label>
          <select
            className={styles.selectInput}
            id="activity-admission-choice"
            name="activityKey"
            onChange={(event) => {
              setActivityKey(event.target.value);
              dismissPreview();
            }}
            value={activityKey}
          >
            {source.activities.map((activity) => (
              <option key={activity.activityKey} value={activity.activityKey}>
                {activity.title} — {activity.targetCompetencyRef}
              </option>
            ))}
          </select>
          <label htmlFor="activity-admission-minutes">Estimated minutes</label>
          <input
            className={styles.numberInput}
            id="activity-admission-minutes"
            inputMode="numeric"
            max={480}
            min={1}
            name="estimatedMinutes"
            onChange={(event) => {
              setEstimatedMinutes(event.target.value);
              dismissPreview();
            }}
            required
            step={1}
            type="number"
            value={estimatedMinutes}
          />
          <label htmlFor="activity-admission-energy">Energy (optional)</label>
          <select
            className={styles.selectInput}
            id="activity-admission-energy"
            name="energy"
            onChange={(event) => {
              setEnergy(event.target.value as "" | "LOW" | "MEDIUM" | "HIGH");
              dismissPreview();
            }}
            value={energy}
          >
            <option value="">Not set</option>
            <option value="LOW">Low</option>
            <option value="MEDIUM">Medium</option>
            <option value="HIGH">High</option>
          </select>
          <label htmlFor="activity-admission-reason">Why does this belong in the Plan?</label>
          <textarea
            id="activity-admission-reason"
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
            {previewPending ? "Preparing preview…" : "Preview activity"}
          </button>
          <Status state={previewState} />
        </form>
      </section>
      {effectivePreview ? (
        <section className={styles.panel} aria-labelledby="activity-admission-preview-heading">
          <h2 id="activity-admission-preview-heading">Review activity admission</h2>
          <PreviewDetails preview={effectivePreview} />
          <p>Reason: {effectivePreview.reason}</p>
          {effectivePreview.warnings.map((warning) => (
            <p className={styles.notice} key={warning.code} role="status">
              {warning.code === "PARENT_GROWTH_PLAN_PAUSED"
                ? "The Growth Plan is paused. The activity is saved, but cannot contribute to Today until the Plan resumes."
                : "The Learning Track is paused. The activity is saved, but cannot contribute to Today until the Track resumes."}
            </p>
          ))}
          <p className={styles.notice}>
            Existing activities, evidence, snapshots, focus sessions, mastery, and readiness remain
            unchanged. One Planning recalculation will be pending.
          </p>
          {effectivePreview.canApply ? (
            <form
              action={applyAction}
              className={styles.actions}
              onSubmit={() => setSubmittedPreviewDigest(effectivePreview.previewDigest)}
            >
              <input
                name="activityKey"
                type="hidden"
                value={effectivePreview.activity.activityKey}
              />
              <input
                name="estimatedMinutes"
                type="hidden"
                value={effectivePreview.activity.estimatedMinutes}
              />
              <input name="energy" type="hidden" value={effectivePreview.activity.energy ?? ""} />
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
              <input name="requestId" type="hidden" value={effectivePreview.requestId} />
              <input name="previewDigest" type="hidden" value={effectivePreview.previewDigest} />
              <button
                className={styles.button}
                disabled={applyPending || applyStateForPreview.status === "conflict"}
                type="submit"
              >
                {applyPending ? "Adding activity…" : "Confirm and add activity"}
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
          ) : (
            <p className={styles.notice} role="alert">
              The Plan has reached its 200-activity limit. Nothing can be confirmed from this
              preview.
            </p>
          )}
          {applyStateForPreview.status === "conflict" ? (
            <div className={styles.notice} role="alert">
              <p>The Plan, Track, or activity changed. Reload, then create a fresh preview.</p>
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
