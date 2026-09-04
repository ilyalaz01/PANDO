"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  applyInterviewCampaignCreationAction,
  previewInterviewCampaignCreationAction,
} from "../../app/campaigns/actions";
import { initialCampaignActionState, type CampaignActionState } from "./campaign-action-state";
import type {
  ActiveReadinessGoalV1,
  CampaignPreviewV1,
  InterviewCampaignCreationPreviewV1,
} from "./campaign-types";
import styles from "./campaigns.module.css";

function requestId(): string {
  return globalThis.crypto.randomUUID();
}

function isCreationPreview(
  preview: CampaignPreviewV1 | null,
): preview is InterviewCampaignCreationPreviewV1 {
  return preview?.contract.name === "InterviewCampaignCreationPreviewV1";
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

function CreationComparison({ preview }: { readonly preview: InterviewCampaignCreationPreviewV1 }) {
  return (
    <div className={styles.comparison} aria-label="Exact Interview Campaign draft preview">
      <div>
        <h3>Target</h3>
        <dl>
          <div>
            <dt>Readiness Goal</dt>
            <dd>{preview.readinessGoal.title}</dd>
          </div>
        </dl>
      </div>
      <div>
        <h3>New draft campaign</h3>
        <dl>
          <div>
            <dt>Title</dt>
            <dd>{preview.after.title}</dd>
          </div>
          <div>
            <dt>Lifecycle</dt>
            <dd>{preview.after.lifecycle}</dd>
          </div>
          <div>
            <dt>Deadline</dt>
            <dd>
              {preview.after.deadline.localDate} ({preview.after.deadline.timeZone})
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

export function InterviewCampaignCreation({
  activeGoals,
  dismissalVersion = 0,
  onIntentStart,
  initialPreviewState = initialCampaignActionState,
  initialApplyState = initialCampaignActionState,
}: {
  readonly activeGoals: readonly ActiveReadinessGoalV1[];
  readonly dismissalVersion?: number;
  readonly onIntentStart?: () => void;
  readonly initialPreviewState?: CampaignActionState;
  readonly initialApplyState?: CampaignActionState;
}) {
  const router = useRouter();
  const previewRequestId = useRef<HTMLInputElement>(null);
  const observedDismissalVersion = useRef(dismissalVersion);
  const [selectedGoalKey, setSelectedGoalKey] = useState(activeGoals[0]?.readinessGoalKey ?? "");
  const [title, setTitle] = useState("");
  const [deadlineLocalDate, setDeadlineLocalDate] = useState("");
  const [reason, setReason] = useState("");
  const [currentRequestId, setCurrentRequestId] = useState("");
  const [dismissed, setDismissed] = useState(initialPreviewState.preview === null);
  const [submittedPreviewDigest, setSubmittedPreviewDigest] = useState<string | null>(() =>
    initialApplyState.status === "idle"
      ? null
      : (initialPreviewState.preview?.previewDigest ?? null),
  );
  const [previewState, previewAction, previewPending] = useActionState(
    previewInterviewCampaignCreationAction,
    initialPreviewState,
  );
  const [applyState, applyAction, applyPending] = useActionState(
    applyInterviewCampaignCreationAction,
    initialApplyState,
  );
  const preview = isCreationPreview(previewState.preview) ? previewState.preview : null;
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

  if (activeGoals.length === 0) return null;

  const selectedGoal = activeGoals.find((goal) => goal.readinessGoalKey === selectedGoalKey);
  const rotateIntent = (showPreview: boolean) => {
    const nextRequestId = requestId();
    setCurrentRequestId(nextRequestId);
    if (previewRequestId.current !== null) previewRequestId.current.value = nextRequestId;
    setDismissed(!showPreview);
    onIntentStart?.();
  };

  return (
    <section className={styles.panel} aria-labelledby="campaign-creation-heading">
      <h2 id="campaign-creation-heading">Draft a new Interview Campaign</h2>
      <p>Start a new campaign as a draft. Nothing changes until you start it.</p>
      <form action={previewAction} className={styles.form} onSubmit={() => rotateIntent(true)}>
        <input
          name="expectedReadinessGoalVersion"
          type="hidden"
          value={selectedGoal?.aggregateVersion ?? ""}
        />
        <input name="requestId" ref={previewRequestId} type="hidden" value={currentRequestId} />
        <label htmlFor="campaign-creation-goal">Readiness Goal</label>
        <select
          className={styles.selectInput}
          id="campaign-creation-goal"
          name="readinessGoalKey"
          onChange={(event) => {
            setSelectedGoalKey(event.target.value);
            rotateIntent(false);
          }}
          value={selectedGoalKey}
        >
          {activeGoals.map((goal) => (
            <option key={goal.readinessGoalKey} value={goal.readinessGoalKey}>
              {goal.title} — {goal.profileRoleTitle}
            </option>
          ))}
        </select>
        <label htmlFor="campaign-creation-title">Title</label>
        <input
          className={styles.textInput}
          id="campaign-creation-title"
          maxLength={200}
          name="title"
          onChange={(event) => {
            setTitle(event.target.value);
            rotateIntent(false);
          }}
          required
          type="text"
          value={title}
        />
        <label htmlFor="campaign-creation-deadline">Deadline (local date)</label>
        <input
          className={styles.dateInput}
          id="campaign-creation-deadline"
          name="deadlineLocalDate"
          onChange={(event) => {
            setDeadlineLocalDate(event.target.value);
            rotateIntent(false);
          }}
          required
          type="date"
          value={deadlineLocalDate}
        />
        <label htmlFor="campaign-creation-reason">Reason</label>
        <textarea
          id="campaign-creation-reason"
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
          {previewPending ? "Preparing preview…" : "Preview new draft"}
        </button>
      </form>
      {effectivePreview !== null ? (
        <section aria-labelledby="campaign-creation-preview-heading">
          <h3 id="campaign-creation-preview-heading">Review this exact draft</h3>
          <CreationComparison preview={effectivePreview} />
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
              value={effectivePreview.readinessGoal.aggregateVersion}
            />
            <input
              name="readinessGoalKey"
              type="hidden"
              value={effectivePreview.readinessGoal.readinessGoalKey}
            />
            <input name="title" type="hidden" value={effectivePreview.after.title} />
            <input
              name="deadlineLocalDate"
              type="hidden"
              value={effectivePreview.after.deadline.localDate}
            />
            <input name="reason" type="hidden" value={effectivePreview.reason} />
            <input name="requestId" type="hidden" value={effectivePreview.idempotencyKey} />
            <input name="previewDigest" type="hidden" value={effectivePreview.previewDigest} />
            <Status state={applyStateForPreview} />
            <div className={styles.actions}>
              {effectivePreview.canApply ? (
                <button className={styles.button} disabled={applyPending} type="submit">
                  {applyPending
                    ? "Drafting Interview Campaign…"
                    : "Confirm and draft this campaign"}
                </button>
              ) : null}
              <button
                className={styles.secondaryButton}
                onClick={() => setDismissed(true)}
                type="button"
              >
                Discard this draft
              </button>
            </div>
          </form>
        </section>
      ) : null}
    </section>
  );
}
