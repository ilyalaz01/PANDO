"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  applyAvailabilityWindowAction,
  previewAvailabilityWindowAction,
} from "../../app/plan/actions";
import { initialPlanActionState, type PlanActionState } from "./plan-action-state";
import type {
  AvailabilityWindowPreviewV1,
  AvailabilityWindowSourceV1,
  PlanPreviewV1,
} from "./plan-types";
import styles from "./plan.module.css";

type ManageOperation = "change_availability_window" | "remove_availability_window";

function requestId(): string {
  return globalThis.crypto.randomUUID();
}

function isAvailabilityPreview(
  preview: PlanPreviewV1 | null,
): preview is AvailabilityWindowPreviewV1 {
  return preview?.contract.name === "AvailabilityWindowPreviewV1";
}

const WARNING_TEXT: Record<string, string> = {
  AVAILABILITY_NOT_YET_APPLIED_TO_CAPACITY:
    "Recorded availability does not change weekly capacity yet. That arrives in a later Planning release.",
  AVAILABILITY_WINDOW_IN_THE_PAST:
    "This window's last day is already behind today, so it becomes read-only history once saved.",
};

const BLOCKER_TEXT: Record<string, string> = {
  AVAILABILITY_WINDOW_OVERLAPS_EXISTING: "These dates overlap an existing active window.",
  AVAILABILITY_WINDOW_LIMIT_REACHED: "This Plan already has 60 active windows.",
  AVAILABILITY_WINDOW_ALREADY_REMOVED: "That window was already removed.",
  PLANNING_CREATE_IDENTITY_COLLISION:
    "This preview request key collided with an existing create intent. Start again to generate a fresh request.",
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

function WindowComparison({ preview }: { readonly preview: AvailabilityWindowPreviewV1 }) {
  const before = preview.before.window;
  const after = preview.after.window;
  return (
    <div aria-label="Exact availability window preview" className={styles.comparison}>
      <div>
        <h3>Before</h3>
        {before === null ? (
          <p>No window yet.</p>
        ) : (
          <dl>
            <div>
              <dt>Dates</dt>
              <dd>
                {before.startsOn} – {before.endsOn}
              </dd>
            </div>
            <div>
              <dt>Available</dt>
              <dd>{before.availableMinutes} minutes/day</dd>
            </div>
            <div>
              <dt>Energy</dt>
              <dd>{before.energy ?? "Not set"}</dd>
            </div>
            <div>
              <dt>Label</dt>
              <dd>{before.label ?? "Not set"}</dd>
            </div>
            <div>
              <dt>State</dt>
              <dd>{before.lifecycle}</dd>
            </div>
            <div>
              <dt>Version</dt>
              <dd>{before.aggregateVersion}</dd>
            </div>
          </dl>
        )}
      </div>
      <div>
        <h3>{preview.canApply ? "After confirmation" : "Proposed"}</h3>
        <dl>
          <div>
            <dt>Dates</dt>
            <dd>
              {after.startsOn} – {after.endsOn}
            </dd>
          </div>
          <div>
            <dt>Available</dt>
            <dd>{after.availableMinutes} minutes/day</dd>
          </div>
          <div>
            <dt>Energy</dt>
            <dd>{after.energy ?? "Not set"}</dd>
          </div>
          <div>
            <dt>Label</dt>
            <dd>{after.label ?? "Not set"}</dd>
          </div>
          <div>
            <dt>State</dt>
            <dd>{after.lifecycle}</dd>
          </div>
          <div>
            <dt>Version</dt>
            <dd>{after.aggregateVersion}</dd>
          </div>
          <div>
            <dt>Active windows</dt>
            <dd>
              {preview.before.activeWindowCount} → {preview.after.activeWindowCount}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

export function AvailabilityWindows({
  source,
  dismissalVersion = 0,
  onIntentStart,
  initialPreviewState = initialPlanActionState,
  initialApplyState = initialPlanActionState,
}: {
  readonly source: AvailabilityWindowSourceV1;
  readonly dismissalVersion?: number;
  readonly onIntentStart?: () => void;
  readonly initialPreviewState?: PlanActionState;
  readonly initialApplyState?: PlanActionState;
}) {
  const router = useRouter();
  const createRequestIdInput = useRef<HTMLInputElement>(null);
  const manageRequestIdInput = useRef<HTMLInputElement>(null);
  const observedDismissalVersion = useRef(dismissalVersion);
  const windows = source.state === "NO_CURRENT_PLAN" ? [] : source.availabilityWindows;

  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [availableMinutes, setAvailableMinutes] = useState("480");
  const [energy, setEnergy] = useState("");
  const [label, setLabel] = useState("");
  const [createReason, setCreateReason] = useState("");
  const [createRequestId, setCreateRequestId] = useState("");

  const [selectedWindowKey, setSelectedWindowKey] = useState(windows[0]?.windowKey ?? "");
  const [manageOperation, setManageOperation] = useState<ManageOperation>(
    "change_availability_window",
  );
  const [manageStartsOn, setManageStartsOn] = useState(windows[0]?.startsOn ?? "");
  const [manageEndsOn, setManageEndsOn] = useState(windows[0]?.endsOn ?? "");
  const [manageAvailableMinutes, setManageAvailableMinutes] = useState(
    String(windows[0]?.availableMinutes ?? ""),
  );
  const [manageEnergy, setManageEnergy] = useState(windows[0]?.energy ?? "");
  const [manageLabel, setManageLabel] = useState(windows[0]?.label ?? "");
  const [manageReason, setManageReason] = useState("");
  const [manageRequestId, setManageRequestId] = useState("");

  const [dismissed, setDismissed] = useState(initialPreviewState.preview === null);
  const [submittedPreviewDigest, setSubmittedPreviewDigest] = useState<string | null>(() =>
    initialApplyState.status === "idle"
      ? null
      : (initialPreviewState.preview?.previewDigest ?? null),
  );
  const [previewState, previewAction, previewPending] = useActionState(
    previewAvailabilityWindowAction,
    initialPreviewState,
  );
  const [applyState, applyAction, applyPending] = useActionState(
    applyAvailabilityWindowAction,
    initialApplyState,
  );
  const preview = isAvailabilityPreview(previewState.preview) ? previewState.preview : null;
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

  if (source.state === "NO_CURRENT_PLAN" || source.growthPlan === null) return null;

  const plan = source.growthPlan;
  const selectedWindow = windows.find((window) => window.windowKey === selectedWindowKey);
  const canCreate = source.capabilities.includes("create_availability_window");

  function markDirty() {
    setDismissed(true);
    onIntentStart?.();
  }

  function beginCreateIntent() {
    onIntentStart?.();
    const next = requestId();
    setCreateRequestId(next);
    if (createRequestIdInput.current !== null) createRequestIdInput.current.value = next;
    setDismissed(false);
  }

  function beginManageIntent() {
    onIntentStart?.();
    const next = requestId();
    setManageRequestId(next);
    if (manageRequestIdInput.current !== null) manageRequestIdInput.current.value = next;
    setDismissed(false);
  }

  return (
    <>
      <section aria-labelledby="availability-windows-heading" className={styles.panel}>
        <h2 id="availability-windows-heading">Availability windows</h2>
        <p>
          Mark whole local days as limited or unavailable. Recorded availability does not change
          weekly capacity until a later Planning release applies it.
        </p>
        {windows.length === 0 ? (
          <p>No active availability windows yet.</p>
        ) : (
          <ul className={styles.trackList}>
            {windows.map((window) => (
              <li className={styles.trackCard} key={window.windowKey}>
                <strong>
                  {window.startsOn} – {window.endsOn}
                </strong>
                <span>{window.availableMinutes} minutes/day</span>
                {window.energy !== null ? <span>{window.energy} energy</span> : null}
                {window.label !== null ? <span>{window.label}</span> : null}
                <span>Version {window.aggregateVersion}</span>
              </li>
            ))}
          </ul>
        )}
        {plan.removedWindowCount > 0 ? (
          <p className={styles.notice}>
            {plan.removedWindowCount} removed window{plan.removedWindowCount === 1 ? "" : "s"} kept
            as history.
          </p>
        ) : null}
      </section>
      {canCreate ? (
        <section aria-labelledby="availability-window-create-heading" className={styles.panel}>
          <h2 id="availability-window-create-heading">Add an availability window</h2>
          <p>Block off or limit a range of whole local days.</p>
          <form action={previewAction} className={styles.form} onSubmit={beginCreateIntent}>
            <input name="operation" type="hidden" value="create_availability_window" />
            <input name="windowKey" type="hidden" value="" />
            <input name="expectedWindowVersion" type="hidden" value="" />
            <input name="expectedGrowthPlanVersion" type="hidden" value={plan.aggregateVersion} />
            <input
              name="requestId"
              ref={createRequestIdInput}
              type="hidden"
              value={createRequestId}
            />
            <label htmlFor="availability-create-starts">Starts on</label>
            <input
              className={styles.selectInput}
              id="availability-create-starts"
              name="startsOn"
              onChange={(event) => {
                setStartsOn(event.target.value);
                markDirty();
              }}
              required
              type="date"
              value={startsOn}
            />
            <label htmlFor="availability-create-ends">Ends on</label>
            <input
              className={styles.selectInput}
              id="availability-create-ends"
              name="endsOn"
              onChange={(event) => {
                setEndsOn(event.target.value);
                markDirty();
              }}
              required
              type="date"
              value={endsOn}
            />
            <label htmlFor="availability-create-minutes">Available minutes per day (0–1440)</label>
            <input
              className={styles.numberInput}
              id="availability-create-minutes"
              inputMode="numeric"
              max={1440}
              min={0}
              name="availableMinutes"
              onChange={(event) => {
                setAvailableMinutes(event.target.value);
                markDirty();
              }}
              required
              step={1}
              type="number"
              value={availableMinutes}
            />
            <label htmlFor="availability-create-energy">Energy (optional)</label>
            <select
              className={styles.selectInput}
              id="availability-create-energy"
              name="energy"
              onChange={(event) => {
                setEnergy(event.target.value);
                markDirty();
              }}
              value={energy}
            >
              <option value="">Not set</option>
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
            </select>
            <label htmlFor="availability-create-label">Label (optional)</label>
            <input
              className={styles.selectInput}
              id="availability-create-label"
              maxLength={120}
              name="label"
              onChange={(event) => {
                setLabel(event.target.value);
                markDirty();
              }}
              type="text"
              value={label}
            />
            <label htmlFor="availability-create-reason">Why does this window belong now?</label>
            <textarea
              id="availability-create-reason"
              maxLength={500}
              name="reason"
              onChange={(event) => {
                setCreateReason(event.target.value);
                markDirty();
              }}
              required
              value={createReason}
            />
            <button className={styles.button} disabled={previewPending} type="submit">
              {previewPending ? "Preparing preview…" : "Preview new window"}
            </button>
            <Status state={previewState} />
          </form>
        </section>
      ) : null}
      {windows.length > 0 ? (
        <section aria-labelledby="availability-window-manage-heading" className={styles.panel}>
          <h2 id="availability-window-manage-heading">Edit or remove a window</h2>
          <form action={previewAction} className={styles.form} onSubmit={beginManageIntent}>
            <label htmlFor="availability-manage-window">Window</label>
            <select
              className={styles.selectInput}
              id="availability-manage-window"
              name="windowKey"
              onChange={(event) => {
                const next = windows.find((window) => window.windowKey === event.target.value);
                setSelectedWindowKey(event.target.value);
                setManageStartsOn(next?.startsOn ?? "");
                setManageEndsOn(next?.endsOn ?? "");
                setManageAvailableMinutes(String(next?.availableMinutes ?? ""));
                setManageEnergy(next?.energy ?? "");
                setManageLabel(next?.label ?? "");
                markDirty();
              }}
              value={selectedWindowKey}
            >
              {windows.map((window) => (
                <option key={window.windowKey} value={window.windowKey}>
                  {window.startsOn} – {window.endsOn} · {window.availableMinutes} min/day
                </option>
              ))}
            </select>
            <input name="expectedGrowthPlanVersion" type="hidden" value={plan.aggregateVersion} />
            <input
              name="expectedWindowVersion"
              type="hidden"
              value={selectedWindow?.aggregateVersion ?? ""}
            />
            <input
              name="requestId"
              ref={manageRequestIdInput}
              type="hidden"
              value={manageRequestId}
            />
            <label htmlFor="availability-manage-operation">Action</label>
            <select
              className={styles.selectInput}
              id="availability-manage-operation"
              name="operation"
              onChange={(event) => {
                setManageOperation(event.target.value as ManageOperation);
                markDirty();
              }}
              value={manageOperation}
            >
              <option value="change_availability_window">
                Edit dates, minutes, energy, or label
              </option>
              <option value="remove_availability_window">Remove this window</option>
            </select>
            {manageOperation === "change_availability_window" ? (
              <>
                <label htmlFor="availability-manage-starts">Starts on</label>
                <input
                  className={styles.selectInput}
                  id="availability-manage-starts"
                  name="startsOn"
                  onChange={(event) => {
                    setManageStartsOn(event.target.value);
                    markDirty();
                  }}
                  required
                  type="date"
                  value={manageStartsOn}
                />
                <label htmlFor="availability-manage-ends">Ends on</label>
                <input
                  className={styles.selectInput}
                  id="availability-manage-ends"
                  name="endsOn"
                  onChange={(event) => {
                    setManageEndsOn(event.target.value);
                    markDirty();
                  }}
                  required
                  type="date"
                  value={manageEndsOn}
                />
                <label htmlFor="availability-manage-minutes">
                  Available minutes per day (0–1440)
                </label>
                <input
                  className={styles.numberInput}
                  id="availability-manage-minutes"
                  inputMode="numeric"
                  max={1440}
                  min={0}
                  name="availableMinutes"
                  onChange={(event) => {
                    setManageAvailableMinutes(event.target.value);
                    markDirty();
                  }}
                  required
                  step={1}
                  type="number"
                  value={manageAvailableMinutes}
                />
                <label htmlFor="availability-manage-energy">Energy (optional)</label>
                <select
                  className={styles.selectInput}
                  id="availability-manage-energy"
                  name="energy"
                  onChange={(event) => {
                    setManageEnergy(event.target.value);
                    markDirty();
                  }}
                  value={manageEnergy}
                >
                  <option value="">Not set</option>
                  <option value="LOW">Low</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="HIGH">High</option>
                </select>
                <label htmlFor="availability-manage-label">Label (optional)</label>
                <input
                  className={styles.selectInput}
                  id="availability-manage-label"
                  maxLength={120}
                  name="label"
                  onChange={(event) => {
                    setManageLabel(event.target.value);
                    markDirty();
                  }}
                  type="text"
                  value={manageLabel}
                />
              </>
            ) : null}
            <label htmlFor="availability-manage-reason">Why is this window changing?</label>
            <textarea
              id="availability-manage-reason"
              maxLength={500}
              name="reason"
              onChange={(event) => {
                setManageReason(event.target.value);
                markDirty();
              }}
              required
              value={manageReason}
            />
            <button
              className={styles.button}
              disabled={previewPending || selectedWindow === undefined}
              type="submit"
            >
              {previewPending ? "Checking window…" : "Preview window change"}
            </button>
            <Status state={previewState} />
          </form>
        </section>
      ) : null}
      {effectivePreview ? (
        <section aria-labelledby="availability-window-preview-heading" className={styles.panel}>
          <h2 id="availability-window-preview-heading">Review availability change</h2>
          <WindowComparison preview={effectivePreview} />
          <p>Reason: {effectivePreview.reason}</p>
          <ul className={styles.notice}>
            {effectivePreview.warnings.map((warning) => (
              <li key={warning.code}>{WARNING_TEXT[warning.code] ?? warning.code}</li>
            ))}
          </ul>
          {!effectivePreview.canApply ? (
            <div className={styles.notice} role="alert">
              {effectivePreview.blockingReasons.map((blocker) => (
                <p key={blocker.code}>{BLOCKER_TEXT[blocker.code] ?? blocker.code}</p>
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
            <form
              action={applyAction}
              className={styles.actions}
              onSubmit={() => setSubmittedPreviewDigest(effectivePreview.previewDigest)}
            >
              <input name="operation" type="hidden" value={effectivePreview.operation} />
              <input
                name="windowKey"
                type="hidden"
                value={
                  effectivePreview.operation === "create_availability_window"
                    ? ""
                    : effectivePreview.after.window.windowKey
                }
              />
              <input
                name="startsOn"
                type="hidden"
                value={
                  effectivePreview.operation === "remove_availability_window"
                    ? ""
                    : effectivePreview.after.window.startsOn
                }
              />
              <input
                name="endsOn"
                type="hidden"
                value={
                  effectivePreview.operation === "remove_availability_window"
                    ? ""
                    : effectivePreview.after.window.endsOn
                }
              />
              <input
                name="availableMinutes"
                type="hidden"
                value={
                  effectivePreview.operation === "remove_availability_window"
                    ? ""
                    : effectivePreview.after.window.availableMinutes
                }
              />
              <input
                name="energy"
                type="hidden"
                value={
                  effectivePreview.operation === "remove_availability_window"
                    ? ""
                    : (effectivePreview.after.window.energy ?? "")
                }
              />
              <input
                name="label"
                type="hidden"
                value={
                  effectivePreview.operation === "remove_availability_window"
                    ? ""
                    : (effectivePreview.after.window.label ?? "")
                }
              />
              <input
                name="expectedGrowthPlanVersion"
                type="hidden"
                value={effectivePreview.expectedGrowthPlanVersion}
              />
              <input
                name="expectedWindowVersion"
                type="hidden"
                value={effectivePreview.before.window?.aggregateVersion ?? ""}
              />
              <input name="reason" type="hidden" value={effectivePreview.reason} />
              <input name="requestId" type="hidden" value={effectivePreview.idempotencyKey} />
              <input name="previewDigest" type="hidden" value={effectivePreview.previewDigest} />
              <button
                className={styles.button}
                disabled={applyPending || applyStateForPreview.status === "conflict"}
                type="submit"
              >
                {applyPending ? "Saving…" : "Confirm availability change"}
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
          )}
          {applyStateForPreview.status === "conflict" ? (
            <div className={styles.notice} role="alert">
              <p>The Plan or window changed. Reload, then create a fresh preview.</p>
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
