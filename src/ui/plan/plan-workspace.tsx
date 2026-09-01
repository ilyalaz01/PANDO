"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  CurrentGrowthPlanV1,
  GrowthPlanCapacityPreviewV1,
  GrowthPlanLifecyclePreviewV1,
  PlanOperation,
  PlanPreviewV1,
  PlanStateV1,
} from "./plan-types";
import { initialPlanActionState, type PlanActionState } from "./plan-action-state";
import styles from "./plan.module.css";
import {
  applyGrowthPlanCapacityAction,
  applyGrowthPlanLifecycleAction,
  previewGrowthPlanCapacityAction,
  previewGrowthPlanLifecycleAction,
} from "../../app/plan/actions";

function requestId(): string {
  return globalThis.crypto.randomUUID();
}

function isLifecyclePreview(
  preview: PlanPreviewV1 | null,
): preview is GrowthPlanLifecyclePreviewV1 {
  return preview?.contract.name === "GrowthPlanLifecyclePreviewV1";
}

function isCapacityPreview(preview: PlanPreviewV1 | null): preview is GrowthPlanCapacityPreviewV1 {
  return preview?.contract.name === "GrowthPlanCapacityPreviewV1";
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

function LifecycleComparison({ preview }: { readonly preview: GrowthPlanLifecyclePreviewV1 }) {
  const fields: readonly { readonly field: keyof PlanStateV1; readonly label: string }[] = [
    { field: "lifecycle", label: "State" },
    { field: "title", label: "Title" },
    { field: "weeklyCapacityMinutes", label: "Capacity (minutes)" },
    { field: "aggregateVersion", label: "Version" },
  ];
  return (
    <div className={styles.comparison} aria-label="Exact plan change preview">
      {(["before", "after"] as const).map((side) => (
        <div key={side}>
          <h3>{side === "before" ? "Before" : "After confirmation"}</h3>
          <dl>
            {fields.map(({ field, label }) => (
              <div key={field}>
                <dt>{label}</dt>
                <dd>{String(preview[side][field])}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}

function CapacityComparison({ preview }: { readonly preview: GrowthPlanCapacityPreviewV1 }) {
  return (
    <div className={styles.comparison} aria-label="Exact weekly capacity preview">
      <div>
        <h3>Before</h3>
        <dl>
          <div>
            <dt>Weekly capacity</dt>
            <dd>{preview.before.weeklyCapacityMinutes} minutes</dd>
          </div>
          <div>
            <dt>Active protected minimum</dt>
            <dd>{preview.constraint.activeProtectedMinimumMinutes} minutes</dd>
          </div>
          <div>
            <dt>Flexible capacity</dt>
            <dd>{preview.constraint.flexibleMinutesBefore} minutes</dd>
          </div>
          <div>
            <dt>Version</dt>
            <dd>{preview.before.aggregateVersion}</dd>
          </div>
        </dl>
      </div>
      <div>
        <h3>{preview.canApply ? "After confirmation" : "Proposed"}</h3>
        <dl>
          <div>
            <dt>Weekly capacity</dt>
            <dd>{preview.after.weeklyCapacityMinutes} minutes</dd>
          </div>
          <div>
            <dt>Active protected minimum</dt>
            <dd>{preview.constraint.activeProtectedMinimumMinutes} minutes</dd>
          </div>
          <div>
            <dt>{preview.canApply ? "Flexible capacity" : "Capacity shortfall"}</dt>
            <dd>{Math.abs(preview.constraint.flexibleMinutesAfter)} minutes</dd>
          </div>
          <div>
            <dt>Version if applied</dt>
            <dd>{preview.after.aggregateVersion}</dd>
          </div>
        </dl>
      </div>
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
  initialCapacityPreviewState = initialPlanActionState,
  initialCapacityApplyState = initialPlanActionState,
}: {
  readonly workspace: CurrentGrowthPlanV1;
  readonly initialPreviewState?: PlanActionState;
  readonly initialApplyState?: PlanActionState;
  readonly initialCapacityPreviewState?: PlanActionState;
  readonly initialCapacityApplyState?: PlanActionState;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [dismissed, setDismissed] = useState(false);
  const [applyRequestId, setApplyRequestId] = useState(requestId);
  const [capacityReason, setCapacityReason] = useState("");
  const [proposedCapacity, setProposedCapacity] = useState(() =>
    String(workspace.currentPlan?.weeklyCapacityMinutes ?? ""),
  );
  const [capacityDismissed, setCapacityDismissed] = useState(false);
  const [capacityApplyRequestId, setCapacityApplyRequestId] = useState(requestId);
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
  const [capacityPreviewState, capacityPreviewAction, capacityPreviewPending] = useActionState(
    previewGrowthPlanCapacityAction,
    initialCapacityPreviewState,
  );
  const [capacityApplyState, capacityApplyAction, capacityApplyPending] = useActionState(
    applyGrowthPlanCapacityAction,
    initialCapacityApplyState,
  );
  const [submittedCapacityPreviewDigest, setSubmittedCapacityPreviewDigest] = useState<
    string | null
  >(() =>
    initialCapacityApplyState.status === "idle"
      ? null
      : (initialCapacityPreviewState.preview?.previewDigest ?? null),
  );
  const plan = workspace.currentPlan;
  const preview = isLifecyclePreview(previewState.preview) ? previewState.preview : null;
  const capacityPreview = isCapacityPreview(capacityPreviewState.preview)
    ? capacityPreviewState.preview
    : null;
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
  const capacityApplyStateForPreview =
    capacityPreview !== null && capacityPreview.previewDigest === submittedCapacityPreviewDigest
      ? capacityApplyState
      : initialPlanActionState;
  const effectiveCapacityPreview =
    capacityDismissed ||
    capacityPreviewPending ||
    (capacityApplyStateForPreview.status === "applied" &&
      capacityPreview?.previewDigest === submittedCapacityPreviewDigest)
      ? null
      : capacityPreview;
  useEffect(() => {
    if (applyState.status === "applied" || capacityApplyState.status === "applied")
      router.refresh();
  }, [applyState, capacityApplyState, router]);

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
            setCapacityDismissed(true);
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
          <LifecycleComparison preview={effectivePreview} />
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
      <section className={styles.panel} aria-labelledby="capacity-heading">
        <h2 id="capacity-heading">Edit weekly capacity</h2>
        <p>
          Set the total minutes you can realistically use in a week. PANDO will check protected work
          before offering confirmation and will never reduce a Track minimum silently.
        </p>
        <form
          action={capacityPreviewAction}
          className={styles.form}
          onSubmit={() => {
            setDismissed(true);
            setCapacityDismissed(false);
            setCapacityApplyRequestId(requestId());
          }}
        >
          <input name="expectedGrowthPlanVersion" type="hidden" value={plan.aggregateVersion} />
          <label htmlFor="weekly-capacity">Weekly capacity in minutes</label>
          <input
            className={styles.numberInput}
            id="weekly-capacity"
            inputMode="numeric"
            max={10_080}
            min={0}
            name="proposedWeeklyCapacityMinutes"
            onChange={(event) => setProposedCapacity(event.target.value)}
            required
            step={1}
            type="number"
            value={proposedCapacity}
          />
          <label htmlFor="capacity-reason">Why is capacity changing?</label>
          <textarea
            id="capacity-reason"
            name="reason"
            maxLength={500}
            onChange={(event) => setCapacityReason(event.target.value)}
            required
            value={capacityReason}
          />
          <button className={styles.button} disabled={capacityPreviewPending} type="submit">
            {capacityPreviewPending ? "Checking capacity…" : "Preview capacity change"}
          </button>
          <Status state={capacityPreviewState} />
        </form>
      </section>
      {effectiveCapacityPreview ? (
        <section className={styles.panel} aria-labelledby="capacity-preview-heading">
          <h2 id="capacity-preview-heading">Review weekly capacity</h2>
          <CapacityComparison preview={effectiveCapacityPreview} />
          <p>Reason: {effectiveCapacityPreview.reason}</p>
          {!effectiveCapacityPreview.canApply ? (
            <div className={styles.notice} role="alert">
              <p>
                Capacity can&apos;t be set to {effectiveCapacityPreview.after.weeklyCapacityMinutes}{" "}
                minutes. Active tracks reserve{" "}
                {effectiveCapacityPreview.constraint.activeProtectedMinimumMinutes} minutes.
                Increase capacity to at least{" "}
                {effectiveCapacityPreview.constraint.activeProtectedMinimumMinutes} minutes, or
                pause or edit a track when Track controls are available.
              </p>
              <button
                className={styles.secondaryButton}
                onClick={() => {
                  setCapacityDismissed(true);
                  setCapacityReason("");
                }}
                type="button"
              >
                Start over
              </button>
            </div>
          ) : (
            <>
              <p className={styles.notice}>
                Track settings and completed history stay unchanged. Planning recalculates Today
                asynchronously after confirmation.
              </p>
              <form
                action={capacityApplyAction}
                className={styles.actions}
                onSubmit={() =>
                  setSubmittedCapacityPreviewDigest(effectiveCapacityPreview.previewDigest)
                }
              >
                <input
                  name="proposedWeeklyCapacityMinutes"
                  type="hidden"
                  value={effectiveCapacityPreview.after.weeklyCapacityMinutes}
                />
                <input
                  name="expectedGrowthPlanVersion"
                  type="hidden"
                  value={effectiveCapacityPreview.expectedGrowthPlanVersion}
                />
                <input
                  name="previewDigest"
                  type="hidden"
                  value={effectiveCapacityPreview.previewDigest}
                />
                <input name="reason" type="hidden" value={effectiveCapacityPreview.reason} />
                <input name="requestId" type="hidden" value={capacityApplyRequestId} />
                <button
                  className={styles.button}
                  disabled={
                    capacityApplyPending || capacityApplyStateForPreview.status === "conflict"
                  }
                  type="submit"
                >
                  {capacityApplyPending ? "Applying…" : "Confirm capacity"}
                </button>
                <button
                  className={styles.secondaryButton}
                  disabled={capacityApplyPending}
                  onClick={() => {
                    setCapacityReason("");
                    setCapacityDismissed(true);
                  }}
                  type="button"
                >
                  Start over
                </button>
                <Status state={capacityApplyStateForPreview} />
              </form>
              {capacityApplyStateForPreview.status === "conflict" ? (
                <div className={styles.notice} role="alert">
                  <p>The plan is stale. Reload the current version, then create a new preview.</p>
                  <button
                    className={styles.secondaryButton}
                    onClick={() => {
                      setCapacityDismissed(true);
                      setCapacityReason("");
                      router.refresh();
                    }}
                    type="button"
                  >
                    Reload current plan
                  </button>
                </div>
              ) : null}
            </>
          )}
        </section>
      ) : null}
    </div>
  );
}
