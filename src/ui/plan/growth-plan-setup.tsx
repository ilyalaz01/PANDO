"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  applyGrowthPlanInitializationAction,
  previewGrowthPlanInitializationAction,
} from "../../app/plan/actions";
import { initialPlanActionState, type PlanActionState } from "./plan-action-state";
import type {
  GrowthPlanInitializationPreviewV1,
  GrowthPlanSetupSourceV1,
  PlanPreviewV1,
} from "./plan-types";
import styles from "./plan.module.css";

function requestId(): string {
  return globalThis.crypto.randomUUID();
}

function isInitializationPreview(
  preview: PlanPreviewV1 | null,
): preview is GrowthPlanInitializationPreviewV1 {
  return preview?.contract.name === "GrowthPlanInitializationPreviewV1";
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

function SetupUnavailable({
  source,
}: {
  readonly source: Exclude<GrowthPlanSetupSourceV1, { state: "SETUP_AVAILABLE" }>;
}) {
  const content = {
    NO_ACTIVE_GOALS: {
      heading: "Choose a target before setting up your Growth Plan.",
      message:
        "PANDO needs one active target with a current readiness profile before it can create a Plan.",
      href: "/start",
      label: "Choose a target",
    },
    CURRENT_PLAN_EXISTS: {
      heading: "A current Growth Plan already exists.",
      message:
        "Reload this workspace to manage the current Plan. PANDO will not create a second current Plan.",
      href: "/plan",
      label: "Reload Plan",
    },
    HISTORY_REQUIRES_REPLACEMENT: {
      heading: "This Growth Plan history needs an explicit replacement.",
      message: "PANDO preserves Plan history. Replacement is not part of first Plan setup.",
      href: "/start",
      label: "Review targets",
    },
    GOAL_PORTFOLIO_OVERFLOW: {
      heading: "Choose a smaller active target portfolio first.",
      message:
        "PANDO cannot safely select one target while the active portfolio exceeds this setup limit.",
      href: "/start",
      label: "Review targets",
    },
  }[source.state];
  return (
    <section className={styles.panel} aria-labelledby="growth-plan-setup-heading">
      <h1 id="growth-plan-setup-heading">{content.heading}</h1>
      <p>{content.message}</p>
      <Link className={styles.secondaryButton} href={content.href}>
        {content.label}
      </Link>
    </section>
  );
}

function InitializationComparison({
  preview,
  profileLabel,
}: {
  readonly preview: GrowthPlanInitializationPreviewV1;
  readonly profileLabel: string;
}) {
  const track = preview.after.learningTrack;
  return (
    <div className={styles.comparison} aria-label="Exact first Growth Plan preview">
      <div>
        <h3>Before</h3>
        <dl>
          <div>
            <dt>Current Plans</dt>
            <dd>{preview.before.currentPlanCount}</dd>
          </div>
          <div>
            <dt>Plan history</dt>
            <dd>{preview.before.lifetimePlanCount}</dd>
          </div>
          <div>
            <dt>Schedule snapshot</dt>
            <dd>{preview.before.snapshotSentinelCount === 0 ? "Not created" : "Present"}</dd>
          </div>
        </dl>
      </div>
      <div>
        <h3>After confirmation</h3>
        <dl>
          <div>
            <dt>Growth Plan</dt>
            <dd>{preview.after.growthPlan.title}</dd>
          </div>
          <div>
            <dt>Weekly capacity</dt>
            <dd>{preview.after.growthPlan.weeklyCapacityMinutes} minutes</dd>
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
            <dt>Default session</dt>
            <dd>{track.defaultSessionMinutes} minutes</dd>
          </div>
          <div>
            <dt>Schedule snapshot</dt>
            <dd>Created; recalculation pending</dd>
          </div>
        </dl>
      </div>
      <p className={styles.notice}>
        Source: {profileLabel} · {preview.source.profileVersionKey} · {preview.source.sourceKind}
      </p>
      <p className={styles.notice}>
        Preserved: readiness Goal, competency overlay, activities and evidence, mastery, reviews,
        and history.
      </p>
    </div>
  );
}

export function GrowthPlanSetup({
  source,
  initialPreviewState = initialPlanActionState,
  initialApplyState = initialPlanActionState,
}: {
  readonly source: GrowthPlanSetupSourceV1;
  readonly initialPreviewState?: PlanActionState;
  readonly initialApplyState?: PlanActionState;
}) {
  const router = useRouter();
  const previewRequestId = useRef<HTMLInputElement>(null);
  const [selectedGoalKey, setSelectedGoalKey] = useState(
    source.state === "SETUP_AVAILABLE" ? (source.goals[0]?.readinessGoalKey ?? "") : "",
  );
  const [weeklyCapacityMinutes, setWeeklyCapacityMinutes] = useState("600");
  const [defaultSessionMinutes, setDefaultSessionMinutes] = useState("30");
  const [trackPriority, setTrackPriority] = useState("50");
  const [reason, setReason] = useState("");
  const [currentRequestId, setCurrentRequestId] = useState("");
  const [dismissed, setDismissed] = useState(false);
  const [submittedPreviewDigest, setSubmittedPreviewDigest] = useState<string | null>(() =>
    initialApplyState.status === "idle"
      ? null
      : (initialPreviewState.preview?.previewDigest ?? null),
  );
  const [previewState, previewAction, previewPending] = useActionState(
    previewGrowthPlanInitializationAction,
    initialPreviewState,
  );
  const [applyState, applyAction, applyPending] = useActionState(
    applyGrowthPlanInitializationAction,
    initialApplyState,
  );
  const preview = isInitializationPreview(previewState.preview) ? previewState.preview : null;
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

  if (source.state !== "SETUP_AVAILABLE") return <SetupUnavailable source={source} />;

  const selectedGoal = source.goals.find((goal) => goal.readinessGoalKey === selectedGoalKey);
  const rotateIntent = (showPreview: boolean) => {
    const nextRequestId = requestId();
    setCurrentRequestId(nextRequestId);
    if (previewRequestId.current !== null) previewRequestId.current.value = nextRequestId;
    setDismissed(!showPreview);
  };

  return (
    <div className={styles.workspace}>
      <section className={styles.intro}>
        <p className={styles.eyebrow}>Growth Plan</p>
        <h1>Set up your first Growth Plan.</h1>
        <p>
          Select one current target, set initial working limits, then inspect the exact Plan and
          Track PANDO will create.
        </p>
      </section>
      <section className={styles.panel} aria-labelledby="growth-plan-setup-heading">
        <h2 id="growth-plan-setup-heading">Initial Plan settings</h2>
        <p>These values are editable defaults for this setup. PANDO does not add activities yet.</p>
        <form action={previewAction} className={styles.form} onSubmit={() => rotateIntent(true)}>
          <input
            name="expectedReadinessGoalVersion"
            type="hidden"
            value={selectedGoal?.aggregateVersion ?? ""}
          />
          <input name="requestId" ref={previewRequestId} type="hidden" value={currentRequestId} />
          <label htmlFor="setup-readiness-goal">Target</label>
          <select
            className={styles.selectInput}
            id="setup-readiness-goal"
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
          <label htmlFor="setup-weekly-capacity">Weekly capacity (minutes)</label>
          <input
            className={styles.numberInput}
            id="setup-weekly-capacity"
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
          <label htmlFor="setup-default-session">Default session (minutes)</label>
          <input
            className={styles.numberInput}
            id="setup-default-session"
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
          <label htmlFor="setup-track-priority">First Track priority</label>
          <input
            className={styles.numberInput}
            id="setup-track-priority"
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
          <label htmlFor="setup-reason">Reason</label>
          <textarea
            id="setup-reason"
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
            {previewPending ? "Preparing preview…" : "Preview first Growth Plan"}
          </button>
        </form>
        {effectivePreview !== null ? (
          <section aria-labelledby="initialization-preview-heading">
            <h2 id="initialization-preview-heading">Review this exact setup</h2>
            <InitializationComparison
              preview={effectivePreview}
              profileLabel={selectedGoal?.profileLabel ?? "Current target profile"}
            />
            <p className={styles.notice} role="note">
              The initial Track has no activities yet. Add work through the normal activity flow
              after the Plan is created.
            </p>
            {effectivePreview.blockingReasons.length > 0 ? (
              <p className={styles.notice} role="alert">
                {effectivePreview.blockingReasons.map((reason) => reason.code).join(". ")}
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
                    {applyPending ? "Creating Growth Plan…" : "Confirm and create Growth Plan"}
                  </button>
                ) : null}
                <button
                  className={styles.secondaryButton}
                  onClick={() => setDismissed(true)}
                  type="button"
                >
                  Change settings
                </button>
              </div>
            </form>
          </section>
        ) : null}
      </section>
    </div>
  );
}
