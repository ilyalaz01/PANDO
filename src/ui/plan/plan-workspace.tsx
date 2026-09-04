"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  CurrentGrowthPlanV1,
  CurrentLearningTracksV1,
  LearningTrackActivityAdmissionSource,
  GrowthPlanSetupSourceV1,
  GrowthPlanCapacityPreviewV1,
  GrowthPlanLifecyclePreviewV1,
  LearningTrackCreationSourceV1,
  LearningTrackTerminalLifecycleSourceV1,
  LearningTrackCadenceSourceV1,
  GrowthPlanReplacementSourceV1,
  AvailabilityWindowSourceV1,
  CapacityEffectPreviewV1,
  LearningTrackLifecyclePreviewV1,
  LearningTrackPriorityMinimumPreviewV1,
  PlanOperation,
  PlanPreviewV1,
  PlanStateV1,
} from "./plan-types";
import { initialPlanActionState, type PlanActionState } from "./plan-action-state";
import styles from "./plan.module.css";
import { GrowthPlanSetup } from "./growth-plan-setup";
import { GrowthPlanReplacement } from "./growth-plan-replacement";
import { ActivityAdmission } from "./activity-admission";
import { LearningTrackCreation } from "./learning-track-creation";
import { LearningTrackTerminalLifecycle } from "./learning-track-terminal-lifecycle";
import { LearningTrackCadence } from "./learning-track-cadence";
import { AvailabilityWindows } from "./availability-windows";
import { CapacityEffectPreview } from "./capacity-effect-preview";
import {
  applyGrowthPlanCapacityAction,
  applyGrowthPlanLifecycleAction,
  applyLearningTrackLifecycleAction,
  applyLearningTrackPriorityMinimumAction,
  previewGrowthPlanCapacityAction,
  previewGrowthPlanLifecycleAction,
  previewLearningTrackLifecycleAction,
  previewLearningTrackPriorityMinimumAction,
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

function isTrackPreview(preview: PlanPreviewV1 | null): preview is LearningTrackLifecyclePreviewV1 {
  return preview?.contract.name === "LearningTrackLifecyclePreviewV1";
}

function isTrackPriorityMinimumPreview(
  preview: PlanPreviewV1 | null,
): preview is LearningTrackPriorityMinimumPreviewV1 {
  return preview?.contract.name === "LearningTrackPriorityMinimumPreviewV1";
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

function TrackComparison({ preview }: { readonly preview: LearningTrackLifecyclePreviewV1 }) {
  return (
    <div className={styles.comparison} aria-label="Exact Learning Track change preview">
      {(["before", "after"] as const).map((side) => (
        <div key={side}>
          <h3>
            {side === "before" ? "Before" : preview.canApply ? "After confirmation" : "Proposed"}
          </h3>
          <dl>
            <div>
              <dt>Track</dt>
              <dd>{preview[side].title}</dd>
            </div>
            <div>
              <dt>State</dt>
              <dd>{preview[side].lifecycle}</dd>
            </div>
            <div>
              <dt>Protected minimum</dt>
              <dd>{preview[side].protectedMinimumMinutes} minutes</dd>
            </div>
            <div>
              <dt>Version</dt>
              <dd>{preview[side].aggregateVersion}</dd>
            </div>
            <div>
              <dt>Active Track minimum total</dt>
              <dd>
                {side === "before"
                  ? preview.constraint.activeProtectedMinimumMinutesBefore
                  : preview.constraint.activeProtectedMinimumMinutesAfter}{" "}
                minutes
              </dd>
            </div>
            <div>
              <dt>Flexible capacity</dt>
              <dd>
                {side === "before"
                  ? preview.constraint.flexibleMinutesBefore
                  : preview.constraint.flexibleMinutesAfter}{" "}
                minutes
              </dd>
            </div>
          </dl>
        </div>
      ))}
    </div>
  );
}

function TrackPriorityMinimumComparison({
  preview,
}: {
  readonly preview: LearningTrackPriorityMinimumPreviewV1;
}) {
  return (
    <div className={styles.comparison} aria-label="Exact Learning Track settings preview">
      {(["before", "after"] as const).map((side) => (
        <div key={side}>
          <h3>
            {side === "before" ? "Before" : preview.canApply ? "After confirmation" : "Proposed"}
          </h3>
          <dl>
            <div>
              <dt>Track</dt>
              <dd>{preview[side].title}</dd>
            </div>
            <div>
              <dt>Priority</dt>
              <dd>{preview[side].priority}</dd>
            </div>
            <div>
              <dt>Protected minimum</dt>
              <dd>{preview[side].protectedMinimumMinutes} minutes</dd>
            </div>
            <div>
              <dt>Order position</dt>
              <dd>
                {side === "before"
                  ? preview.constraint.currentTrackPositionBefore
                  : preview.constraint.currentTrackPositionAfter}
              </dd>
            </div>
            <div>
              <dt>Active protected minimum total</dt>
              <dd>
                {side === "before"
                  ? preview.constraint.activeProtectedMinimumMinutesBefore
                  : preview.constraint.activeProtectedMinimumMinutesAfter}{" "}
                minutes
              </dd>
            </div>
            <div>
              <dt>Flexible capacity</dt>
              <dd>
                {side === "before"
                  ? preview.constraint.flexibleMinutesBefore
                  : preview.constraint.flexibleMinutesAfter}{" "}
                minutes
              </dd>
            </div>
            <div>
              <dt>Version</dt>
              <dd>{preview[side].aggregateVersion}</dd>
            </div>
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
  tracksWorkspace,
  setupSource,
  learningTrackCreationSource,
  learningTrackCreationUnavailable = false,
  activityAdmissionSource,
  activityAdmissionUnavailable = false,
  selectedActivityAdmissionTrackKey,
  terminalLifecycleSource,
  terminalLifecycleUnavailable = false,
  cadenceSource,
  cadenceUnavailable = false,
  replacementSource,
  replacementUnavailable = false,
  availabilityWindowSource,
  availabilityWindowUnavailable = false,
  capacityEffectPreview,
  terminalHistoryCursor,
  terminalHistoryNextHref,
  terminalHistoryRecoveryHref = "/plan",
  initialPreviewState = initialPlanActionState,
  initialApplyState = initialPlanActionState,
  initialCapacityPreviewState = initialPlanActionState,
  initialCapacityApplyState = initialPlanActionState,
  initialTrackPreviewState = initialPlanActionState,
  initialTrackApplyState = initialPlanActionState,
  initialTrackPriorityMinimumPreviewState = initialPlanActionState,
  initialTrackPriorityMinimumApplyState = initialPlanActionState,
  initialInitializationPreviewState = initialPlanActionState,
  initialInitializationApplyState = initialPlanActionState,
  initialLearningTrackCreationPreviewState = initialPlanActionState,
  initialLearningTrackCreationApplyState = initialPlanActionState,
  initialActivityAdmissionPreviewState = initialPlanActionState,
  initialActivityAdmissionApplyState = initialPlanActionState,
  initialTerminalLifecyclePreviewState = initialPlanActionState,
  initialTerminalLifecycleApplyState = initialPlanActionState,
  initialCadencePreviewState = initialPlanActionState,
  initialCadenceApplyState = initialPlanActionState,
  initialReplacementPreviewState = initialPlanActionState,
  initialReplacementApplyState = initialPlanActionState,
  initialAvailabilityWindowPreviewState = initialPlanActionState,
  initialAvailabilityWindowApplyState = initialPlanActionState,
}: {
  readonly workspace: CurrentGrowthPlanV1;
  readonly tracksWorkspace: CurrentLearningTracksV1;
  readonly setupSource?: GrowthPlanSetupSourceV1;
  readonly learningTrackCreationSource?: LearningTrackCreationSourceV1;
  readonly learningTrackCreationUnavailable?: boolean;
  readonly activityAdmissionSource?: LearningTrackActivityAdmissionSource;
  readonly activityAdmissionUnavailable?: boolean;
  readonly selectedActivityAdmissionTrackKey?: string;
  readonly terminalLifecycleSource?: LearningTrackTerminalLifecycleSourceV1;
  readonly terminalLifecycleUnavailable?: boolean;
  readonly cadenceSource?: LearningTrackCadenceSourceV1;
  readonly cadenceUnavailable?: boolean;
  readonly replacementSource?: GrowthPlanReplacementSourceV1;
  readonly replacementUnavailable?: boolean;
  readonly availabilityWindowSource?: AvailabilityWindowSourceV1;
  readonly availabilityWindowUnavailable?: boolean;
  readonly capacityEffectPreview?: CapacityEffectPreviewV1;
  readonly terminalHistoryCursor?: string;
  readonly terminalHistoryNextHref?: string;
  readonly terminalHistoryRecoveryHref?: string;
  readonly initialPreviewState?: PlanActionState;
  readonly initialApplyState?: PlanActionState;
  readonly initialCapacityPreviewState?: PlanActionState;
  readonly initialCapacityApplyState?: PlanActionState;
  readonly initialTrackPreviewState?: PlanActionState;
  readonly initialTrackApplyState?: PlanActionState;
  readonly initialTrackPriorityMinimumPreviewState?: PlanActionState;
  readonly initialTrackPriorityMinimumApplyState?: PlanActionState;
  readonly initialInitializationPreviewState?: PlanActionState;
  readonly initialInitializationApplyState?: PlanActionState;
  readonly initialLearningTrackCreationPreviewState?: PlanActionState;
  readonly initialLearningTrackCreationApplyState?: PlanActionState;
  readonly initialActivityAdmissionPreviewState?: PlanActionState;
  readonly initialActivityAdmissionApplyState?: PlanActionState;
  readonly initialTerminalLifecyclePreviewState?: PlanActionState;
  readonly initialTerminalLifecycleApplyState?: PlanActionState;
  readonly initialCadencePreviewState?: PlanActionState;
  readonly initialCadenceApplyState?: PlanActionState;
  readonly initialReplacementPreviewState?: PlanActionState;
  readonly initialReplacementApplyState?: PlanActionState;
  readonly initialAvailabilityWindowPreviewState?: PlanActionState;
  readonly initialAvailabilityWindowApplyState?: PlanActionState;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [dismissed, setDismissed] = useState(false);
  const [applyRequestId, setApplyRequestId] = useState("");
  const [capacityReason, setCapacityReason] = useState("");
  const [proposedCapacity, setProposedCapacity] = useState(() =>
    String(workspace.currentPlan?.weeklyCapacityMinutes ?? ""),
  );
  const [capacityDismissed, setCapacityDismissed] = useState(false);
  const [capacityApplyRequestId, setCapacityApplyRequestId] = useState("");
  const initialSelectedTrackKey = isTrackPriorityMinimumPreview(
    initialTrackPriorityMinimumPreviewState.preview,
  )
    ? initialTrackPriorityMinimumPreviewState.preview.before.trackKey
    : isTrackPreview(initialTrackPreviewState.preview)
      ? initialTrackPreviewState.preview.before.trackKey
      : (tracksWorkspace.learningTracks[0]?.trackKey ?? "");
  const initialSelectedTrack = tracksWorkspace.learningTracks.find(
    (track) => track.trackKey === initialSelectedTrackKey,
  );
  const [selectedTrackKey, setSelectedTrackKey] = useState(initialSelectedTrackKey);
  const [trackReason, setTrackReason] = useState("");
  const [trackDismissed, setTrackDismissed] = useState(false);
  const [trackApplyRequestId, setTrackApplyRequestId] = useState("");
  const [trackPriority, setTrackPriority] = useState(() =>
    String(initialSelectedTrack?.priority ?? ""),
  );
  const [trackProtectedMinimum, setTrackProtectedMinimum] = useState(() =>
    String(initialSelectedTrack?.protectedMinimumMinutes ?? ""),
  );
  const [trackSettingsReason, setTrackSettingsReason] = useState("");
  const [trackSettingsDismissed, setTrackSettingsDismissed] = useState(false);
  const [trackSettingsApplyRequestId, setTrackSettingsApplyRequestId] = useState("");
  const [learningTrackCreationDismissalVersion, setLearningTrackCreationDismissalVersion] =
    useState(0);
  const [activityAdmissionDismissalVersion, setActivityAdmissionDismissalVersion] = useState(0);
  const [terminalLifecycleDismissalVersion, setTerminalLifecycleDismissalVersion] = useState(0);
  const [cadenceDismissalVersion, setCadenceDismissalVersion] = useState(0);
  const [replacementDismissalVersion, setReplacementDismissalVersion] = useState(0);
  const [availabilityWindowDismissalVersion, setAvailabilityWindowDismissalVersion] = useState(0);
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
  const [trackPreviewState, trackPreviewAction, trackPreviewPending] = useActionState(
    previewLearningTrackLifecycleAction,
    initialTrackPreviewState,
  );
  const [trackApplyState, trackApplyAction, trackApplyPending] = useActionState(
    applyLearningTrackLifecycleAction,
    initialTrackApplyState,
  );
  const [
    trackPriorityMinimumPreviewState,
    trackPriorityMinimumPreviewAction,
    trackPriorityMinimumPreviewPending,
  ] = useActionState(
    previewLearningTrackPriorityMinimumAction,
    initialTrackPriorityMinimumPreviewState,
  );
  const [
    trackPriorityMinimumApplyState,
    trackPriorityMinimumApplyAction,
    trackPriorityMinimumApplyPending,
  ] = useActionState(
    applyLearningTrackPriorityMinimumAction,
    initialTrackPriorityMinimumApplyState,
  );
  const [submittedCapacityPreviewDigest, setSubmittedCapacityPreviewDigest] = useState<
    string | null
  >(() =>
    initialCapacityApplyState.status === "idle"
      ? null
      : (initialCapacityPreviewState.preview?.previewDigest ?? null),
  );
  const [submittedTrackPreviewDigest, setSubmittedTrackPreviewDigest] = useState<string | null>(
    () =>
      initialTrackApplyState.status === "idle"
        ? null
        : (initialTrackPreviewState.preview?.previewDigest ?? null),
  );
  const [
    submittedTrackPriorityMinimumPreviewDigest,
    setSubmittedTrackPriorityMinimumPreviewDigest,
  ] = useState<string | null>(() =>
    initialTrackPriorityMinimumApplyState.status === "idle"
      ? null
      : (initialTrackPriorityMinimumPreviewState.preview?.previewDigest ?? null),
  );
  const plan = workspace.currentPlan;
  const preview = isLifecyclePreview(previewState.preview) ? previewState.preview : null;
  const capacityPreview = isCapacityPreview(capacityPreviewState.preview)
    ? capacityPreviewState.preview
    : null;
  const trackPreview = isTrackPreview(trackPreviewState.preview) ? trackPreviewState.preview : null;
  const trackPriorityMinimumPreview = isTrackPriorityMinimumPreview(
    trackPriorityMinimumPreviewState.preview,
  )
    ? trackPriorityMinimumPreviewState.preview
    : null;
  const selectedTrack = tracksWorkspace.learningTracks.find(
    (track) => track.trackKey === selectedTrackKey,
  );
  let selectedActivityAdmissionTrack = null;
  if (activityAdmissionSource !== undefined && "selectedTrack" in activityAdmissionSource) {
    selectedActivityAdmissionTrack = activityAdmissionSource.selectedTrack;
  } else if (activityAdmissionSource !== undefined) {
    selectedActivityAdmissionTrack = activityAdmissionSource.learningTrack;
  }
  const activityAdmissionIdentity =
    selectedActivityAdmissionTrack?.trackKey ??
    selectedActivityAdmissionTrackKey ??
    tracksWorkspace.learningTracks[0]?.trackKey ??
    "unselected";
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
  const trackApplyStateForPreview =
    trackPreview !== null && trackPreview.previewDigest === submittedTrackPreviewDigest
      ? trackApplyState
      : initialPlanActionState;
  const effectiveTrackPreview =
    trackDismissed ||
    trackPreviewPending ||
    (trackApplyStateForPreview.status === "applied" &&
      trackPreview?.previewDigest === submittedTrackPreviewDigest)
      ? null
      : trackPreview;
  const trackPriorityMinimumApplyStateForPreview =
    trackPriorityMinimumPreview !== null &&
    trackPriorityMinimumPreview.previewDigest === submittedTrackPriorityMinimumPreviewDigest
      ? trackPriorityMinimumApplyState
      : initialPlanActionState;
  const effectiveTrackPriorityMinimumPreview =
    trackSettingsDismissed ||
    trackPriorityMinimumPreviewPending ||
    (trackPriorityMinimumApplyStateForPreview.status === "applied" &&
      trackPriorityMinimumPreview?.previewDigest === submittedTrackPriorityMinimumPreviewDigest)
      ? null
      : trackPriorityMinimumPreview;
  useEffect(() => {
    if (
      applyState.status === "applied" ||
      capacityApplyState.status === "applied" ||
      trackApplyState.status === "applied" ||
      trackPriorityMinimumApplyState.status === "applied"
    )
      router.refresh();
  }, [applyState, capacityApplyState, router, trackApplyState, trackPriorityMinimumApplyState]);

  function dismissOtherPlanIntents() {
    setDismissed(true);
    setCapacityDismissed(true);
    setTrackDismissed(true);
    setTrackSettingsDismissed(true);
  }

  function dismissLearningTrackCreationIntent() {
    setLearningTrackCreationDismissalVersion((version) => version + 1);
  }

  function dismissActivityAdmissionIntent() {
    setActivityAdmissionDismissalVersion((version) => version + 1);
  }

  function dismissTerminalLifecycleIntent() {
    setTerminalLifecycleDismissalVersion((version) => version + 1);
  }

  function dismissCadenceIntent() {
    setCadenceDismissalVersion((version) => version + 1);
  }

  function dismissReplacementIntent() {
    setReplacementDismissalVersion((version) => version + 1);
  }

  function dismissAvailabilityWindowIntent() {
    setAvailabilityWindowDismissalVersion((version) => version + 1);
  }

  function dismissAdditiveIntents() {
    dismissLearningTrackCreationIntent();
    dismissActivityAdmissionIntent();
    dismissTerminalLifecycleIntent();
    dismissCadenceIntent();
    dismissReplacementIntent();
    dismissAvailabilityWindowIntent();
  }

  if (!plan)
    return setupSource === undefined ? (
      <section className={styles.panel}>
        <h2>No Growth Plan yet.</h2>
        <p>No Plan was changed. Reload the authorized workspace.</p>
      </section>
    ) : (
      <GrowthPlanSetup
        initialApplyState={initialInitializationApplyState}
        initialPreviewState={initialInitializationPreviewState}
        source={setupSource}
      />
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
            dismissAdditiveIntents();
            setDismissed(false);
            setCapacityDismissed(true);
            setTrackDismissed(true);
            setTrackSettingsDismissed(true);
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
            onChange={(event) => {
              dismissAdditiveIntents();
              setReason(event.target.value);
              setTrackSettingsDismissed(true);
            }}
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
      <section className={styles.panel} aria-labelledby="tracks-heading">
        <h2 id="tracks-heading">Learning Tracks</h2>
        <p>
          Pause work that no longer belongs in Today, or resume it when the Plan has enough weekly
          capacity. History and completed work stay intact.
        </p>
        {tracksWorkspace.learningTracks.length === 0 ? (
          <p>No current Learning Tracks are available.</p>
        ) : (
          <>
            <ul className={styles.trackList}>
              {tracksWorkspace.learningTracks.map((track) => (
                <li className={styles.trackCard} key={track.learningTrackId}>
                  <strong>{track.title}</strong>
                  <span>{track.lifecycle === "ACTIVE" ? "Active" : "Paused"}</span>
                  <span>Priority {track.priority}</span>
                  <span>{track.protectedMinimumMinutes} protected minutes</span>
                  <span>Version {track.aggregateVersion}</span>
                </li>
              ))}
            </ul>
            <form
              action={trackPreviewAction}
              className={styles.form}
              onSubmit={() => {
                dismissAdditiveIntents();
                setDismissed(true);
                setCapacityDismissed(true);
                setTrackDismissed(false);
                setTrackSettingsDismissed(true);
                setTrackApplyRequestId(requestId());
              }}
            >
              <label htmlFor="learning-track">Learning Track</label>
              <select
                className={styles.selectInput}
                id="learning-track"
                name="trackKey"
                onChange={(event) => {
                  dismissAdditiveIntents();
                  setSelectedTrackKey(event.target.value);
                  setTrackDismissed(true);
                  setTrackSettingsDismissed(true);
                  const selected = tracksWorkspace.learningTracks.find(
                    (track) => track.trackKey === event.target.value,
                  );
                  setTrackPriority(String(selected?.priority ?? ""));
                  setTrackProtectedMinimum(String(selected?.protectedMinimumMinutes ?? ""));
                }}
                value={selectedTrackKey}
              >
                {tracksWorkspace.learningTracks.map((track) => (
                  <option key={track.learningTrackId} value={track.trackKey}>
                    {track.title} — {track.lifecycle === "ACTIVE" ? "Active" : "Paused"}
                  </option>
                ))}
              </select>
              <input name="operation" type="hidden" value={selectedTrack?.capabilities[0] ?? ""} />
              <input
                name="expectedGrowthPlanVersion"
                type="hidden"
                value={tracksWorkspace.growthPlan?.aggregateVersion ?? ""}
              />
              <input
                name="expectedLearningTrackVersion"
                type="hidden"
                value={selectedTrack?.aggregateVersion ?? ""}
              />
              <label htmlFor="track-reason">Why is this Track changing?</label>
              <textarea
                id="track-reason"
                maxLength={500}
                name="reason"
                onChange={(event) => {
                  dismissAdditiveIntents();
                  setTrackReason(event.target.value);
                  setTrackSettingsDismissed(true);
                }}
                required
                value={trackReason}
              />
              <button
                className={styles.button}
                disabled={trackPreviewPending || !selectedTrack?.capabilities[0]}
                type="submit"
              >
                {trackPreviewPending ? "Checking Track…" : "Preview Track change"}
              </button>
              <Status state={trackPreviewState} />
            </form>
          </>
        )}
      </section>
      {learningTrackCreationSource ? (
        <LearningTrackCreation
          dismissalVersion={learningTrackCreationDismissalVersion}
          initialApplyState={initialLearningTrackCreationApplyState}
          initialPreviewState={initialLearningTrackCreationPreviewState}
          onIntentStart={() => {
            dismissActivityAdmissionIntent();
            dismissTerminalLifecycleIntent();
            dismissCadenceIntent();
            dismissAvailabilityWindowIntent();
            dismissOtherPlanIntents();
          }}
          source={learningTrackCreationSource}
        />
      ) : learningTrackCreationUnavailable ? (
        <section className={styles.panel} aria-labelledby="learning-track-creation-heading">
          <h2 id="learning-track-creation-heading">Create another Learning Track</h2>
          <p>
            Learning Track creation is temporarily unavailable. Other Plan controls remain
            available; nothing changed.
          </p>
        </section>
      ) : null}
      {tracksWorkspace.learningTracks.length > 0 ||
      activityAdmissionSource !== undefined ||
      activityAdmissionUnavailable ? (
        <ActivityAdmission
          key={activityAdmissionIdentity}
          dismissalVersion={activityAdmissionDismissalVersion}
          initialApplyState={initialActivityAdmissionApplyState}
          initialPreviewState={initialActivityAdmissionPreviewState}
          onIntentStart={() => {
            dismissLearningTrackCreationIntent();
            dismissTerminalLifecycleIntent();
            dismissCadenceIntent();
            dismissAvailabilityWindowIntent();
            dismissOtherPlanIntents();
          }}
          sourceUnavailable={activityAdmissionUnavailable}
          tracks={tracksWorkspace.learningTracks}
          {...(activityAdmissionSource === undefined ? {} : { source: activityAdmissionSource })}
          {...((selectedActivityAdmissionTrack?.trackKey ?? selectedActivityAdmissionTrackKey) ===
          undefined
            ? {}
            : {
                selectedTrackKey:
                  selectedActivityAdmissionTrack?.trackKey ?? selectedActivityAdmissionTrackKey,
              })}
        />
      ) : null}
      {terminalLifecycleSource !== undefined ? (
        <LearningTrackTerminalLifecycle
          key={terminalHistoryCursor ?? "terminal-history-first-page"}
          dismissalVersion={terminalLifecycleDismissalVersion}
          initialApplyState={initialTerminalLifecycleApplyState}
          initialPreviewState={initialTerminalLifecyclePreviewState}
          onIntentStart={() => {
            dismissLearningTrackCreationIntent();
            dismissActivityAdmissionIntent();
            dismissCadenceIntent();
            dismissAvailabilityWindowIntent();
            dismissOtherPlanIntents();
          }}
          source={terminalLifecycleSource}
          {...(terminalHistoryNextHref === undefined
            ? {}
            : { nextHistoryHref: terminalHistoryNextHref })}
        />
      ) : terminalLifecycleUnavailable ? (
        <section className={styles.panel} aria-labelledby="terminal-track-heading">
          <h2 id="terminal-track-heading">Complete or archive a Learning Track</h2>
          <p>
            Terminal Track history is temporarily unavailable. Other Plan controls remain available;
            nothing changed.
          </p>
          <Link
            className={styles.secondaryButton}
            href={terminalHistoryRecoveryHref}
            scroll={false}
          >
            Load first history page
          </Link>
        </section>
      ) : null}
      {replacementSource !== undefined ? (
        <GrowthPlanReplacement
          dismissalVersion={replacementDismissalVersion}
          initialApplyState={initialReplacementApplyState}
          initialPreviewState={initialReplacementPreviewState}
          onIntentStart={() => {
            dismissLearningTrackCreationIntent();
            dismissActivityAdmissionIntent();
            dismissTerminalLifecycleIntent();
            dismissCadenceIntent();
            dismissAvailabilityWindowIntent();
            dismissOtherPlanIntents();
          }}
          source={replacementSource}
        />
      ) : replacementUnavailable ? (
        <section aria-labelledby="growth-plan-replacement-heading" className={styles.panel}>
          <h2 id="growth-plan-replacement-heading">Replace this Growth Plan</h2>
          <p>
            Growth Plan replacement is temporarily unavailable. Other Plan controls remain
            available; nothing changed.
          </p>
        </section>
      ) : null}
      {cadenceSource !== undefined ? (
        <LearningTrackCadence
          dismissalVersion={cadenceDismissalVersion}
          initialApplyState={initialCadenceApplyState}
          initialPreviewState={initialCadencePreviewState}
          onIntentStart={() => {
            dismissLearningTrackCreationIntent();
            dismissActivityAdmissionIntent();
            dismissTerminalLifecycleIntent();
            dismissAvailabilityWindowIntent();
            dismissOtherPlanIntents();
          }}
          source={cadenceSource}
        />
      ) : cadenceUnavailable ? (
        <section aria-labelledby="track-cadence-heading" className={styles.panel}>
          <h2 id="track-cadence-heading">Track cadence</h2>
          <p>
            Track cadence is temporarily unavailable. Other Plan controls remain available; nothing
            changed.
          </p>
        </section>
      ) : null}
      {availabilityWindowSource !== undefined ? (
        <AvailabilityWindows
          dismissalVersion={availabilityWindowDismissalVersion}
          initialApplyState={initialAvailabilityWindowApplyState}
          initialPreviewState={initialAvailabilityWindowPreviewState}
          onIntentStart={() => {
            dismissLearningTrackCreationIntent();
            dismissActivityAdmissionIntent();
            dismissTerminalLifecycleIntent();
            dismissCadenceIntent();
            dismissReplacementIntent();
            dismissOtherPlanIntents();
          }}
          source={availabilityWindowSource}
        />
      ) : availabilityWindowUnavailable ? (
        <section aria-labelledby="availability-windows-heading" className={styles.panel}>
          <h2 id="availability-windows-heading">Availability windows</h2>
          <p>
            Availability windows are temporarily unavailable. Other Plan controls remain available;
            nothing changed.
          </p>
        </section>
      ) : null}
      {capacityEffectPreview !== undefined ? (
        <CapacityEffectPreview preview={capacityEffectPreview} />
      ) : null}
      {effectiveTrackPreview ? (
        <section className={styles.panel} aria-labelledby="track-preview-heading">
          <h2 id="track-preview-heading">Review Learning Track change</h2>
          <TrackComparison preview={effectiveTrackPreview} />
          <p>Reason: {effectiveTrackPreview.reason}</p>
          {effectiveTrackPreview.warnings.some(
            (warning) => warning.code === "PARENT_GROWTH_PLAN_PAUSED",
          ) ? (
            <p className={styles.notice} role="status">
              The Growth Plan is paused. This Track state will be saved now, but Today will not
              schedule it until the parent Plan is resumed and recalculated.
            </p>
          ) : null}
          {!effectiveTrackPreview.canApply ? (
            <div className={styles.notice} role="alert">
              {effectiveTrackPreview.blockingReasons.map((reason) => (
                <p key={reason.code}>
                  This Track cannot resume within{" "}
                  {effectiveTrackPreview.growthPlan.weeklyCapacityMinutes} weekly minutes. Active
                  protected work would require {reason.minimumCapacityMinutes} minutes.
                </p>
              ))}
              <button
                className={styles.secondaryButton}
                onClick={() => {
                  setTrackDismissed(true);
                  setTrackReason("");
                }}
                type="button"
              >
                Start over
              </button>
            </div>
          ) : (
            <>
              <p className={styles.notice}>
                Completed activity and evidence stay unchanged. Planning recalculates Today
                asynchronously after confirmation.
              </p>
              <form
                action={trackApplyAction}
                className={styles.actions}
                onSubmit={() => setSubmittedTrackPreviewDigest(effectiveTrackPreview.previewDigest)}
              >
                <input
                  name="trackKey"
                  type="hidden"
                  value={effectiveTrackPreview.before.trackKey}
                />
                <input name="operation" type="hidden" value={effectiveTrackPreview.operation} />
                <input
                  name="expectedGrowthPlanVersion"
                  type="hidden"
                  value={effectiveTrackPreview.expectedGrowthPlanVersion}
                />
                <input
                  name="expectedLearningTrackVersion"
                  type="hidden"
                  value={effectiveTrackPreview.expectedLearningTrackVersion}
                />
                <input
                  name="previewDigest"
                  type="hidden"
                  value={effectiveTrackPreview.previewDigest}
                />
                <input name="reason" type="hidden" value={effectiveTrackPreview.reason} />
                <input name="requestId" type="hidden" value={trackApplyRequestId} />
                <button
                  className={styles.button}
                  disabled={trackApplyPending || trackApplyStateForPreview.status === "conflict"}
                  type="submit"
                >
                  {trackApplyPending ? "Applying…" : "Confirm Track change"}
                </button>
                <button
                  className={styles.secondaryButton}
                  disabled={trackApplyPending}
                  onClick={() => {
                    setTrackReason("");
                    setTrackDismissed(true);
                  }}
                  type="button"
                >
                  Start over
                </button>
                <Status state={trackApplyStateForPreview} />
              </form>
              {trackApplyStateForPreview.status === "conflict" ? (
                <div className={styles.notice} role="alert">
                  <p>The Plan or Track is stale. Reload both, then create a new preview.</p>
                  <button
                    className={styles.secondaryButton}
                    onClick={() => {
                      setTrackDismissed(true);
                      setTrackReason("");
                      router.refresh();
                    }}
                    type="button"
                  >
                    Reload current Plan and Tracks
                  </button>
                </div>
              ) : null}
            </>
          )}
        </section>
      ) : null}
      <section className={styles.panel} aria-labelledby="track-settings-heading">
        <h2 id="track-settings-heading">Edit Track priority and protected minimum</h2>
        <p>
          Priority guides Planning ranking; it is not a quota or a promise of Today order. Protected
          minutes reserve weekly capacity only while a Track is active.
        </p>
        {tracksWorkspace.learningTracks.length === 0 ? (
          <p>No current Learning Tracks are available.</p>
        ) : (
          <form
            action={trackPriorityMinimumPreviewAction}
            className={styles.form}
            onSubmit={() => {
              dismissAdditiveIntents();
              setDismissed(true);
              setCapacityDismissed(true);
              setTrackDismissed(true);
              setTrackSettingsDismissed(false);
              setTrackSettingsApplyRequestId(requestId());
            }}
          >
            <label htmlFor="track-settings-track">Learning Track</label>
            <select
              className={styles.selectInput}
              id="track-settings-track"
              name="trackKey"
              onChange={(event) => {
                dismissAdditiveIntents();
                const selected = tracksWorkspace.learningTracks.find(
                  (track) => track.trackKey === event.target.value,
                );
                setSelectedTrackKey(event.target.value);
                setTrackPriority(String(selected?.priority ?? ""));
                setTrackProtectedMinimum(String(selected?.protectedMinimumMinutes ?? ""));
                setTrackSettingsDismissed(true);
                setTrackDismissed(true);
                setDismissed(true);
                setCapacityDismissed(true);
              }}
              value={selectedTrackKey}
            >
              {tracksWorkspace.learningTracks.map((track) => (
                <option key={track.learningTrackId} value={track.trackKey}>
                  {track.title} — priority {track.priority}, {track.protectedMinimumMinutes}{" "}
                  protected minutes
                </option>
              ))}
            </select>
            <input
              name="expectedGrowthPlanVersion"
              type="hidden"
              value={tracksWorkspace.growthPlan?.aggregateVersion ?? ""}
            />
            <input
              name="expectedLearningTrackVersion"
              type="hidden"
              value={selectedTrack?.aggregateVersion ?? ""}
            />
            <label htmlFor="track-priority">Priority (0–100)</label>
            <input
              className={styles.numberInput}
              id="track-priority"
              inputMode="numeric"
              max={100}
              min={0}
              name="priority"
              onChange={(event) => {
                dismissAdditiveIntents();
                setTrackPriority(event.target.value);
                setTrackSettingsDismissed(true);
                setDismissed(true);
                setCapacityDismissed(true);
                setTrackDismissed(true);
              }}
              required
              step={1}
              type="number"
              value={trackPriority}
            />
            <label htmlFor="track-protected-minimum">
              Protected weekly minimum in minutes (0–10080)
            </label>
            <input
              className={styles.numberInput}
              id="track-protected-minimum"
              inputMode="numeric"
              max={10_080}
              min={0}
              name="protectedMinimumMinutes"
              onChange={(event) => {
                dismissAdditiveIntents();
                setTrackProtectedMinimum(event.target.value);
                setTrackSettingsDismissed(true);
                setDismissed(true);
                setCapacityDismissed(true);
                setTrackDismissed(true);
              }}
              required
              step={1}
              type="number"
              value={trackProtectedMinimum}
            />
            <label htmlFor="track-settings-reason">Why are these settings changing?</label>
            <textarea
              id="track-settings-reason"
              maxLength={500}
              name="reason"
              onChange={(event) => {
                dismissAdditiveIntents();
                setTrackSettingsReason(event.target.value);
                setTrackSettingsDismissed(true);
                setDismissed(true);
                setCapacityDismissed(true);
                setTrackDismissed(true);
              }}
              required
              value={trackSettingsReason}
            />
            <button
              className={styles.button}
              disabled={trackPriorityMinimumPreviewPending || !selectedTrack}
              type="submit"
            >
              {trackPriorityMinimumPreviewPending
                ? "Checking Track settings…"
                : "Preview Track settings"}
            </button>
            <Status state={trackPriorityMinimumPreviewState} />
          </form>
        )}
      </section>
      {effectiveTrackPriorityMinimumPreview ? (
        <section className={styles.panel} aria-labelledby="track-settings-preview-heading">
          <h2 id="track-settings-preview-heading">Review Learning Track settings</h2>
          <TrackPriorityMinimumComparison preview={effectiveTrackPriorityMinimumPreview} />
          <p>Reason: {effectiveTrackPriorityMinimumPreview.reason}</p>
          {effectiveTrackPriorityMinimumPreview.warnings.map((warning) => (
            <p className={styles.notice} key={warning.code} role="status">
              {warning.code === "PARENT_GROWTH_PLAN_PAUSED"
                ? "The Growth Plan is paused. These settings are saved now, but Today remains paused until the Plan resumes."
                : warning.code === "LEARNING_TRACK_PAUSED"
                  ? "This Track is paused, so its protected minimum does not reserve capacity or affect Today until you explicitly resume it."
                  : `If you resume this Track now, active protected work would require ${warning.minimumCapacityMinutes} weekly minutes.`}
            </p>
          ))}
          {!effectiveTrackPriorityMinimumPreview.canApply ? (
            <div className={styles.notice} role="alert">
              {effectiveTrackPriorityMinimumPreview.blockingReasons.map((reason) => (
                <p key={reason.code}>
                  These active Track settings need at least {reason.minimumCapacityMinutes} weekly
                  minutes; the Plan has{" "}
                  {effectiveTrackPriorityMinimumPreview.growthPlan.weeklyCapacityMinutes}.
                </p>
              ))}
              <button
                className={styles.secondaryButton}
                onClick={() => {
                  setTrackSettingsDismissed(true);
                  setTrackSettingsReason("");
                }}
                type="button"
              >
                Start over
              </button>
            </div>
          ) : (
            <>
              <p className={styles.notice}>
                Completed activity and evidence stay unchanged. Planning recalculates Today
                asynchronously after confirmation.
              </p>
              <form
                action={trackPriorityMinimumApplyAction}
                className={styles.actions}
                onSubmit={() =>
                  setSubmittedTrackPriorityMinimumPreviewDigest(
                    effectiveTrackPriorityMinimumPreview.previewDigest,
                  )
                }
              >
                <input
                  name="trackKey"
                  type="hidden"
                  value={effectiveTrackPriorityMinimumPreview.before.trackKey}
                />
                <input
                  name="priority"
                  type="hidden"
                  value={effectiveTrackPriorityMinimumPreview.after.priority}
                />
                <input
                  name="protectedMinimumMinutes"
                  type="hidden"
                  value={effectiveTrackPriorityMinimumPreview.after.protectedMinimumMinutes}
                />
                <input
                  name="expectedGrowthPlanVersion"
                  type="hidden"
                  value={effectiveTrackPriorityMinimumPreview.expectedGrowthPlanVersion}
                />
                <input
                  name="expectedLearningTrackVersion"
                  type="hidden"
                  value={effectiveTrackPriorityMinimumPreview.expectedLearningTrackVersion}
                />
                <input
                  name="previewDigest"
                  type="hidden"
                  value={effectiveTrackPriorityMinimumPreview.previewDigest}
                />
                <input
                  name="reason"
                  type="hidden"
                  value={effectiveTrackPriorityMinimumPreview.reason}
                />
                <input name="requestId" type="hidden" value={trackSettingsApplyRequestId} />
                <button
                  className={styles.button}
                  disabled={
                    trackPriorityMinimumApplyPending ||
                    trackPriorityMinimumApplyStateForPreview.status === "conflict"
                  }
                  type="submit"
                >
                  {trackPriorityMinimumApplyPending ? "Applying…" : "Confirm Track settings"}
                </button>
                <button
                  className={styles.secondaryButton}
                  disabled={trackPriorityMinimumApplyPending}
                  onClick={() => {
                    setTrackSettingsDismissed(true);
                    setTrackSettingsReason("");
                  }}
                  type="button"
                >
                  Start over
                </button>
                <Status state={trackPriorityMinimumApplyStateForPreview} />
              </form>
              {trackPriorityMinimumApplyStateForPreview.status === "conflict" ? (
                <div className={styles.notice} role="alert">
                  <p>The Plan or Track is stale. Reload both, then create a new preview.</p>
                  <button
                    className={styles.secondaryButton}
                    onClick={() => {
                      setTrackSettingsDismissed(true);
                      setTrackSettingsReason("");
                      router.refresh();
                    }}
                    type="button"
                  >
                    Reload current Plan and Tracks
                  </button>
                </div>
              ) : null}
            </>
          )}
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
            dismissAdditiveIntents();
            setDismissed(true);
            setCapacityDismissed(false);
            setTrackDismissed(true);
            setTrackSettingsDismissed(true);
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
            onChange={(event) => {
              dismissAdditiveIntents();
              setProposedCapacity(event.target.value);
              setTrackSettingsDismissed(true);
            }}
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
            onChange={(event) => {
              dismissAdditiveIntents();
              setCapacityReason(event.target.value);
              setTrackSettingsDismissed(true);
            }}
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
