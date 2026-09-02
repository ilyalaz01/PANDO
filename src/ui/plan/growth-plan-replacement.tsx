"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  applyGrowthPlanReplacementAction,
  previewGrowthPlanReplacementAction,
} from "../../app/plan/actions";
import { initialPlanActionState, type PlanActionState } from "./plan-action-state";
import type {
  GrowthPlanReplacementPreviewV1,
  GrowthPlanReplacementSourceV1,
  PlanPreviewV1,
} from "./plan-types";
import styles from "./plan.module.css";

function requestId(): string {
  return globalThis.crypto.randomUUID();
}

function isReplacementPreview(
  preview: PlanPreviewV1 | null,
): preview is GrowthPlanReplacementPreviewV1 {
  return preview?.contract.name === "GrowthPlanReplacementPreviewV1";
}

const WARNING_TEXT: Record<string, string> = {
  ARCHIVED_PLAN_IS_READ_ONLY:
    "The current Plan becomes archived history. It stays readable and can no longer be edited.",
  CURRENT_TRACKS_NOT_COPIED:
    "Its Learning Tracks stay with the archived Plan. PANDO does not copy them into the new Plan.",
  INITIAL_TRACK_HAS_NO_ACTIVITIES: "The new Plan starts with one Track and no activities yet.",
};

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

function ReplacementComparison({ preview }: { readonly preview: GrowthPlanReplacementPreviewV1 }) {
  const outgoing = preview.before.growthPlan;
  const tracks = preview.before.childTracks;
  const plan = preview.after.growthPlan;
  const track = preview.after.learningTrack;
  return (
    <div className={styles.comparison} aria-label="Exact Growth Plan replacement preview">
      <div>
        <h3>Before</h3>
        <dl>
          <div>
            <dt>Current Plan</dt>
            <dd>{outgoing.title}</dd>
          </div>
          <div>
            <dt>Lifecycle</dt>
            <dd>{outgoing.lifecycle}</dd>
          </div>
          <div>
            <dt>Weekly capacity</dt>
            <dd>{outgoing.weeklyCapacityMinutes} minutes</dd>
          </div>
          <div>
            <dt>Learning Tracks</dt>
            <dd>
              {tracks.total} total · {tracks.active} active · {tracks.paused} paused ·{" "}
              {tracks.completed} completed · {tracks.archived} archived
            </dd>
          </div>
          <div>
            <dt>Plan history</dt>
            <dd>{preview.before.lifetimePlanCount}</dd>
          </div>
        </dl>
      </div>
      <div>
        <h3>After confirmation</h3>
        <dl>
          <div>
            <dt>Archived Plan</dt>
            <dd>
              {preview.after.archivedPlan.title} · ARCHIVED · version{" "}
              {preview.after.archivedPlan.aggregateVersion}
            </dd>
          </div>
          <div>
            <dt>New Growth Plan</dt>
            <dd>{plan.title}</dd>
          </div>
          <div>
            <dt>Weekly capacity</dt>
            <dd>{plan.weeklyCapacityMinutes} minutes</dd>
          </div>
          <div>
            <dt>First Track</dt>
            <dd>{track.title}</dd>
          </div>
          <div>
            <dt>Track priority</dt>
            <dd>{track.priority}</dd>
          </div>
          <div>
            <dt>Protected minimum</dt>
            <dd>{track.protectedMinimumMinutes} minutes</dd>
          </div>
          <div>
            <dt>Weekly cadence</dt>
            <dd>{track.cadencePerWeek} sessions</dd>
          </div>
          <div>
            <dt>Plan history</dt>
            <dd>{preview.after.lifetimePlanCount}</dd>
          </div>
          <div>
            <dt>Schedule snapshot</dt>
            <dd>Recalculation pending</dd>
          </div>
        </dl>
      </div>
      <p className={styles.notice}>
        Source: {preview.source.profileVersionKey} · {preview.source.sourceKind}
      </p>
      <p className={styles.notice}>
        Preserved: archived Plan and its Tracks, readiness Goal, activities and evidence, mastery,
        reviews, and every plan snapshot.
      </p>
    </div>
  );
}

export function GrowthPlanReplacement({
  source,
  dismissalVersion = 0,
  onIntentStart,
  initialPreviewState = initialPlanActionState,
  initialApplyState = initialPlanActionState,
}: {
  readonly source: GrowthPlanReplacementSourceV1;
  readonly dismissalVersion?: number;
  readonly onIntentStart?: () => void;
  readonly initialPreviewState?: PlanActionState;
  readonly initialApplyState?: PlanActionState;
}) {
  const router = useRouter();
  const previewRequestId = useRef<HTMLInputElement>(null);
  const observedDismissalVersion = useRef(dismissalVersion);
  const [selectedGoalKey, setSelectedGoalKey] = useState(
    source.state === "REPLACEMENT_AVAILABLE" ? (source.goals[0]?.readinessGoalKey ?? "") : "",
  );
  const [weeklyCapacityMinutes, setWeeklyCapacityMinutes] = useState(
    source.state === "REPLACEMENT_AVAILABLE"
      ? String(source.currentPlan.weeklyCapacityMinutes)
      : "600",
  );
  const [defaultSessionMinutes, setDefaultSessionMinutes] = useState("30");
  const [trackPriority, setTrackPriority] = useState("50");
  const [reason, setReason] = useState("");
  const [currentRequestId, setCurrentRequestId] = useState("");
  const [dismissed, setDismissed] = useState(initialPreviewState.preview === null);
  const [submittedPreviewDigest, setSubmittedPreviewDigest] = useState<string | null>(() =>
    initialApplyState.status === "idle"
      ? null
      : (initialPreviewState.preview?.previewDigest ?? null),
  );
  const [previewState, previewAction, previewPending] = useActionState(
    previewGrowthPlanReplacementAction,
    initialPreviewState,
  );
  const [applyState, applyAction, applyPending] = useActionState(
    applyGrowthPlanReplacementAction,
    initialApplyState,
  );
  const preview = isReplacementPreview(previewState.preview) ? previewState.preview : null;
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

  if (source.state !== "REPLACEMENT_AVAILABLE") return null;

  const currentPlan = source.currentPlan;
  const selectedGoal = source.goals.find((goal) => goal.readinessGoalKey === selectedGoalKey);
  const rotateIntent = (showPreview: boolean) => {
    const nextRequestId = requestId();
    setCurrentRequestId(nextRequestId);
    if (previewRequestId.current !== null) previewRequestId.current.value = nextRequestId;
    setDismissed(!showPreview);
    onIntentStart?.();
  };

  return (
    <section className={styles.panel} aria-labelledby="growth-plan-replacement-heading">
      <h2 id="growth-plan-replacement-heading">Replace this Growth Plan</h2>
      <p>
        Replacing archives “{currentPlan.title}” with its {currentPlan.childTracks.total} Learning
        Track{currentPlan.childTracks.total === 1 ? "" : "s"} as readable history and starts one new
        Plan from a target you choose. Nothing is deleted and nothing is copied.
      </p>
      <form action={previewAction} className={styles.form} onSubmit={() => rotateIntent(true)}>
        <input
          name="expectedReadinessGoalVersion"
          type="hidden"
          value={selectedGoal?.aggregateVersion ?? ""}
        />
        <input
          name="expectedGrowthPlanVersion"
          type="hidden"
          value={currentPlan.aggregateVersion}
        />
        <input name="requestId" ref={previewRequestId} type="hidden" value={currentRequestId} />
        <label htmlFor="replacement-readiness-goal">New Plan target</label>
        <select
          className={styles.selectInput}
          id="replacement-readiness-goal"
          name="readinessGoalKey"
          onChange={(event) => {
            setSelectedGoalKey(event.target.value);
            rotateIntent(false);
          }}
          value={selectedGoalKey}
        >
          {source.goals.map((goal) => (
            <option key={goal.readinessGoalKey} value={goal.readinessGoalKey}>
              {goal.title} — {goal.profileLabel}
            </option>
          ))}
        </select>
        <label htmlFor="replacement-weekly-capacity">New weekly capacity (minutes)</label>
        <input
          className={styles.numberInput}
          id="replacement-weekly-capacity"
          max={10080}
          min={0}
          name="weeklyCapacityMinutes"
          onChange={(event) => {
            setWeeklyCapacityMinutes(event.target.value);
            rotateIntent(false);
          }}
          required
          step={1}
          type="number"
          value={weeklyCapacityMinutes}
        />
        <label htmlFor="replacement-default-session">Default session (minutes)</label>
        <input
          className={styles.numberInput}
          id="replacement-default-session"
          max={480}
          min={1}
          name="defaultSessionMinutes"
          onChange={(event) => {
            setDefaultSessionMinutes(event.target.value);
            rotateIntent(false);
          }}
          required
          step={1}
          type="number"
          value={defaultSessionMinutes}
        />
        <label htmlFor="replacement-track-priority">First Track priority</label>
        <input
          className={styles.numberInput}
          id="replacement-track-priority"
          max={100}
          min={0}
          name="trackPriority"
          onChange={(event) => {
            setTrackPriority(event.target.value);
            rotateIntent(false);
          }}
          required
          step={1}
          type="number"
          value={trackPriority}
        />
        <label htmlFor="replacement-reason">Reason</label>
        <textarea
          id="replacement-reason"
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
          {previewPending ? "Preparing preview…" : "Preview Growth Plan replacement"}
        </button>
      </form>
      {effectivePreview !== null ? (
        <section aria-labelledby="replacement-preview-heading">
          <h3 id="replacement-preview-heading">Review this exact replacement</h3>
          <ReplacementComparison preview={effectivePreview} />
          <ul className={styles.notice}>
            {effectivePreview.warnings.map((warning) => (
              <li key={warning.code}>{WARNING_TEXT[warning.code] ?? warning.code}</li>
            ))}
          </ul>
          {effectivePreview.blockingReasons.length > 0 ? (
            <p className={styles.notice} role="alert">
              {effectivePreview.blockingReasons.map((blocker) => blocker.code).join(". ")}
            </p>
          ) : null}
          <form
            action={applyAction}
            className={styles.form}
            onSubmit={() => setSubmittedPreviewDigest(effectivePreview.previewDigest)}
          >
            <input
              name="expectedReadinessGoalVersion"
              type="hidden"
              value={effectivePreview.expectedReadinessGoalVersion}
            />
            <input
              name="expectedGrowthPlanVersion"
              type="hidden"
              value={effectivePreview.expectedGrowthPlanVersion}
            />
            <input
              name="readinessGoalKey"
              type="hidden"
              value={effectivePreview.source.readinessGoalKey}
            />
            <input
              name="weeklyCapacityMinutes"
              type="hidden"
              value={effectivePreview.after.growthPlan.weeklyCapacityMinutes}
            />
            <input
              name="defaultSessionMinutes"
              type="hidden"
              value={effectivePreview.after.learningTrack.defaultSessionMinutes}
            />
            <input
              name="trackPriority"
              type="hidden"
              value={effectivePreview.after.learningTrack.priority}
            />
            <input name="reason" type="hidden" value={effectivePreview.reason} />
            <input name="requestId" type="hidden" value={effectivePreview.idempotencyKey} />
            <input name="previewDigest" type="hidden" value={effectivePreview.previewDigest} />
            <Status state={applyStateForPreview} />
            <div className={styles.actions}>
              {effectivePreview.canApply ? (
                <button className={styles.button} disabled={applyPending} type="submit">
                  {applyPending ? "Replacing Growth Plan…" : "Confirm and replace Growth Plan"}
                </button>
              ) : null}
              <button
                className={styles.secondaryButton}
                onClick={() => setDismissed(true)}
                type="button"
              >
                Keep the current Plan
              </button>
            </div>
          </form>
        </section>
      ) : null}
    </section>
  );
}
