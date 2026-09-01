"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  CurrentGrowthPlanV1,
  GrowthPlanLifecyclePreviewV1,
  PlanOperation,
  PlanStateV1,
} from "./plan-types";
import { initialPlanActionState, type PlanActionState } from "./plan-action-state";
import styles from "./plan.module.css";
import {
  applyGrowthPlanLifecycleAction,
  previewGrowthPlanLifecycleAction,
} from "../../app/plan/actions";

function requestId(): string {
  return globalThis.crypto.randomUUID();
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

function PlanDetails({ plan }: { readonly plan: PlanStateV1 }) {
  return (
    <dl className={styles.planSummary}>
      <div className={styles.metric}>
        <dt>State</dt>
        <dd>{plan.lifecycle === "ACTIVE" ? "Active" : "Paused"}</dd>
      </div>
      <div className={styles.metric}>
        <dt>Weekly capacity</dt>
        <dd>{plan.weeklyCapacityMinutes} minutes</dd>
      </div>
      <div className={styles.metric}>
        <dt>Version</dt>
        <dd>{plan.aggregateVersion}</dd>
      </div>
    </dl>
  );
}

function Comparison({ preview }: { readonly preview: GrowthPlanLifecyclePreviewV1 }) {
  const fields: readonly (keyof PlanStateV1)[] = [
    "lifecycle",
    "title",
    "weeklyCapacityMinutes",
    "aggregateVersion",
  ];
  return (
    <div className={styles.comparison} aria-label="Exact plan change preview">
      {(["before", "after"] as const).map((side) => (
        <div key={side}>
          <h3>{side === "before" ? "Before" : "After confirmation"}</h3>
          <dl>
            {fields.map((field) => (
              <div key={field}>
                <dt>{field === "weeklyCapacityMinutes" ? "Capacity" : field}</dt>
                <dd>{String(preview[side][field])}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}

function RecalculationNotice({ workspace }: { readonly workspace: CurrentGrowthPlanV1 }) {
  if (workspace.recalculation.projectionState === "CURRENT") return null;
  const message =
    workspace.recalculation.projectionState === "ERROR"
      ? "The latest plan recalculation failed. The saved plan remains at the state shown above, but Today is not current. Retry after the calculation service recovers."
      : workspace.recalculation.projectionState === "NOT_STARTED"
        ? "The first plan calculation has not started yet. PANDO will not invent a Today schedule."
        : workspace.recalculation.reason === "SNAPSHOT_EXPIRED"
          ? "The last plan snapshot expired. Recalculation is pending before Today can show a current schedule."
          : "Plan inputs changed. Recalculation is pending before Today can show a current schedule.";
  return (
    <p className={styles.notice} role="status">
      {message}
    </p>
  );
}

export function PlanWorkspace({
  workspace,
  initialPreviewState = initialPlanActionState,
  initialApplyState = initialPlanActionState,
}: {
  readonly workspace: CurrentGrowthPlanV1;
  readonly initialPreviewState?: PlanActionState;
  readonly initialApplyState?: PlanActionState;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [dismissed, setDismissed] = useState(false);
  const [applyRequestId, setApplyRequestId] = useState(requestId);
  const [submittedPreviewDigest, setSubmittedPreviewDigest] = useState<string | null>(() =>
    initialApplyState.status === "idle"
      ? null
      : (initialPreviewState.preview?.previewDigest ?? null),
  );
  const [previewState, previewAction, previewPending] = useActionState(
    previewGrowthPlanLifecycleAction,
    initialPreviewState,
  );
  const [applyState, applyAction, applyPending] = useActionState(
    applyGrowthPlanLifecycleAction,
    initialApplyState,
  );
  const plan = workspace.currentPlan;
  const preview = previewState.preview;
  const operation = workspace.capabilities[0] as PlanOperation | undefined;
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

  if (!plan)
    return (
      <section className={styles.panel}>
        <h2>No Growth Plan yet.</h2>
        <p>Choose a target first. PANDO will not invent a plan or capacity.</p>
      </section>
    );
  return (
    <div className={styles.workspace}>
      <section className={styles.intro}>
        <p className={styles.eyebrow}>Growth Plan</p>
        <h1>Keep the plan aligned with your life.</h1>
        <p>{plan.title}</p>
        <PlanDetails plan={plan} />
        <RecalculationNotice workspace={workspace} />
      </section>
      <section className={styles.panel} aria-labelledby="lifecycle-heading">
        <h2 id="lifecycle-heading">
          {operation === "pause_growth_plan" ? "Pause this plan" : "Resume this plan"}
        </h2>
        <p>
          This preserves tracks, snapshots, focus sessions, and evidence. Explain the change, then
          inspect the exact preview before confirming.
        </p>
        <form
          action={previewAction}
          className={styles.form}
          onSubmit={() => {
            setDismissed(false);
            setApplyRequestId(requestId());
          }}
        >
          <input name="operation" type="hidden" value={operation ?? ""} />
          <input name="expectedGrowthPlanVersion" type="hidden" value={plan.aggregateVersion} />
          <label htmlFor="plan-reason">Why is this changing?</label>
          <textarea
            id="plan-reason"
            name="reason"
            maxLength={500}
            onChange={(event) => setReason(event.target.value)}
            required
            value={reason}
          />
          <button className={styles.button} disabled={previewPending || !operation} type="submit">
            {previewPending ? "Preparing preview…" : "Preview change"}
          </button>
          <Status state={previewState} />
        </form>
      </section>
      {effectivePreview ? (
        <section className={styles.panel} aria-labelledby="preview-heading">
          <h2 id="preview-heading">Review before applying</h2>
          <Comparison preview={effectivePreview} />
          <p>Reason: {effectivePreview.reason}</p>
          <p className={styles.notice}>
            After confirmation, Planning recalculates asynchronously. The result is honestly
            reported as pending.
          </p>
          <form
            action={applyAction}
            className={styles.actions}
            onSubmit={() => setSubmittedPreviewDigest(effectivePreview.previewDigest)}
          >
            <input name="operation" type="hidden" value={effectivePreview.operation} />
            <input
              name="expectedGrowthPlanVersion"
              type="hidden"
              value={effectivePreview.expectedGrowthPlanVersion}
            />
            <input name="previewDigest" type="hidden" value={effectivePreview.previewDigest} />
            <input name="reason" type="hidden" value={effectivePreview.reason} />
            <input name="requestId" type="hidden" value={applyRequestId} />
            <button
              className={styles.button}
              disabled={applyPending || applyStateForPreview.status === "conflict"}
              type="submit"
            >
              {applyPending ? "Applying…" : "Confirm and apply"}
            </button>
            <button
              className={styles.secondaryButton}
              disabled={applyPending}
              onClick={() => {
                setReason("");
                setDismissed(true);
              }}
              type="button"
            >
              Start over
            </button>
            <Status state={applyStateForPreview} />
          </form>
          {applyStateForPreview.status === "conflict" ? (
            <div className={styles.notice} role="alert">
              <p>The plan is stale. Reload the current version, then create a new preview.</p>
              <button
                className={styles.secondaryButton}
                onClick={() => {
                  setDismissed(true);
                  setReason("");
                  router.refresh();
                }}
                type="button"
              >
                Reload current plan
              </button>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
