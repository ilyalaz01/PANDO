"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";

import {
  completeFocusAction,
  invalidateEvidenceAction,
  startFocusAction,
  stopFocusAction,
} from "../../app/focus/actions";
import { initialFocusActionState, type FocusActionState } from "./focus-action-state";
import type { FocusHistoryItemV1, FocusWorkspaceV1 } from "./server/focus-workspace-v1";
import styles from "./focus.module.css";

function newRequestId(): string {
  return globalThis.crypto.randomUUID();
}

function ActionStatus({ state }: { readonly state: FocusActionState }) {
  return (
    <p
      aria-live="polite"
      className={styles.status}
      role={state.status === "invalid" || state.status === "unavailable" ? "alert" : "status"}
    >
      {state.message}
    </p>
  );
}

function useRefreshOnUpdate(state: FocusActionState): void {
  const router = useRouter();
  useEffect(() => {
    if (state.status !== "updated") return;
    router.refresh();
  }, [router, state.status]);
}

function ElapsedTime({ startedAt }: { readonly startedAt: string }) {
  const [elapsedMinutes, setElapsedMinutes] = useState(() =>
    Math.max(0, Math.floor((Date.now() - Date.parse(startedAt)) / 60_000)),
  );
  useEffect(() => {
    const update = () =>
      setElapsedMinutes(Math.max(0, Math.floor((Date.now() - Date.parse(startedAt)) / 60_000)));
    const interval = globalThis.setInterval(update, 30_000);
    return () => globalThis.clearInterval(interval);
  }, [startedAt]);
  return <time dateTime={`PT${elapsedMinutes}M`}>{elapsedMinutes} min elapsed</time>;
}

function StartForm({ workspace }: { readonly workspace: FocusWorkspaceV1 }) {
  const [requestId] = useState(newRequestId);
  const [state, action, pending] = useActionState(startFocusAction, initialFocusActionState);
  useRefreshOnUpdate(state);
  const activity = workspace.activity;
  if (activity === null) return null;
  return (
    <form action={action} className={styles.form}>
      <input name="requestId" type="hidden" value={requestId} />
      <input name="readinessGoalKey" type="hidden" value={workspace.readinessGoalKey} />
      <input name="activityKey" type="hidden" value={activity.activityKey} />
      <label htmlFor="planned-minutes">Planned focus time</label>
      <select defaultValue="25" id="planned-minutes" name="plannedMinutes">
        <option value="10">10 minutes</option>
        <option value="25">25 minutes</option>
        <option value="45">45 minutes</option>
        <option value="60">60 minutes</option>
      </select>
      <ActionStatus state={state} />
      <button className={styles.primaryButton} disabled={pending} type="submit">
        {pending ? "Starting…" : "Start focus session"}
      </button>
    </form>
  );
}

function ActiveSession({ workspace }: { readonly workspace: FocusWorkspaceV1 }) {
  const active = workspace.activeSession;
  const activity = workspace.activity;
  const [completeRequestId] = useState(newRequestId);
  const [stopRequestId] = useState(newRequestId);
  const [completeState, completeAction, completePending] = useActionState(
    completeFocusAction,
    initialFocusActionState,
  );
  const [stopState, stopAction, stopPending] = useActionState(
    stopFocusAction,
    initialFocusActionState,
  );
  useRefreshOnUpdate(completeState);
  useRefreshOnUpdate(stopState);
  if (active === null) return null;
  return (
    <section className={styles.activeCard} aria-labelledby="active-focus-title">
      <div className={styles.cardHeading}>
        <div>
          <p className={styles.eyebrow}>Focus is active</p>
          <h1 id="active-focus-title">{active.title}</h1>
        </div>
        <div className={styles.timer}>
          <ElapsedTime startedAt={active.startedAt} />
          <span>{active.plannedMinutes} min planned</span>
        </div>
      </div>

      {activity === null ? null : (
        <div className={styles.activeGuidance}>
          <div>
            <strong>Expected evidence</strong>
            <p>{activity.expectedEvidence}</p>
          </div>
          {activity.resourceUrl === null ? null : (
            <a href={activity.resourceUrl} rel="noreferrer" target="_blank">
              Open activity resource in a new tab
            </a>
          )}
        </div>
      )}

      <label htmlFor="focus-scratch">Scratch area</label>
      <textarea
        id="focus-scratch"
        name="scratch"
        placeholder="Temporary thinking space…"
        rows={7}
      />
      <p className={styles.hint}>
        Local and unsaved. Copy anything you want to keep before leaving.
      </p>

      <form action={completeAction} className={styles.form}>
        <input name="requestId" type="hidden" value={completeRequestId} />
        <input name="focusSessionId" type="hidden" value={active.focusSessionId} />
        <input name="expectedVersion" type="hidden" value={active.sessionVersion} />
        <fieldset>
          <legend>What happened?</legend>
          <label className={styles.choice}>
            <input defaultChecked name="resultKind" type="radio" value="OBSERVED_SUCCESS" />I
            produced the expected result
          </label>
          <label className={styles.choice}>
            <input name="resultKind" type="radio" value="OBSERVED_FAILURE" />I tried, but the result
            did not work
          </label>
          <label className={styles.choice}>
            <input name="resultKind" type="radio" value="COMPLETION_ONLY" />
            Save completion only — not evidence
          </label>
        </fieldset>
        <label className={styles.choice}>
          <input name="usedHint" type="checkbox" />I used a hint or guided solution
        </label>
        <ActionStatus state={completeState} />
        <button
          className={styles.primaryButton}
          disabled={completePending || stopPending}
          type="submit"
        >
          {completePending ? "Saving result…" : "Complete and save result"}
        </button>
      </form>

      <form action={stopAction} className={styles.stopForm}>
        <input name="requestId" type="hidden" value={stopRequestId} />
        <input name="focusSessionId" type="hidden" value={active.focusSessionId} />
        <input name="expectedVersion" type="hidden" value={active.sessionVersion} />
        <ActionStatus state={stopState} />
        <button
          className={styles.secondaryButton}
          disabled={stopPending || completePending}
          type="submit"
        >
          {stopPending ? "Stopping…" : "Stop without evidence"}
        </button>
      </form>
    </section>
  );
}

function InvalidateEvidenceForm({ item }: { readonly item: FocusHistoryItemV1 }) {
  const [requestId] = useState(newRequestId);
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(
    invalidateEvidenceAction,
    initialFocusActionState,
  );
  useRefreshOnUpdate(state);
  if (item.evidenceId === null || item.evidenceValid !== true) return null;
  if (!open) {
    return (
      <button className={styles.textButton} type="button" onClick={() => setOpen(true)}>
        Correct this evidence
      </button>
    );
  }
  return (
    <form action={action} className={styles.correctionForm}>
      <input name="requestId" type="hidden" value={requestId} />
      <input name="evidenceId" type="hidden" value={item.evidenceId} />
      <label htmlFor={`reason-${item.evidenceId}`}>Why is this evidence incorrect?</label>
      <textarea id={`reason-${item.evidenceId}`} maxLength={500} name="reason" required rows={3} />
      <ActionStatus state={state} />
      <div className={styles.inlineActions}>
        <button className={styles.dangerButton} disabled={pending} type="submit">
          {pending ? "Invalidating…" : "Invalidate evidence"}
        </button>
        <button className={styles.textButton} type="button" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function History({ history }: { readonly history: readonly FocusHistoryItemV1[] }) {
  return (
    <section className={styles.history} aria-labelledby="focus-history-title">
      <div>
        <p className={styles.eyebrow}>Immutable history</p>
        <h2 id="focus-history-title">Recent sessions</h2>
      </div>
      {history.length === 0 ? (
        <p>No Focus sessions yet.</p>
      ) : (
        <ol>
          {history.map((item) => (
            <li key={item.focusSessionId}>
              <div className={styles.historyHeader}>
                <strong>{item.title}</strong>
                <span>{item.state === "stopped" ? "Stopped" : "Completed"}</span>
              </div>
              <p>
                <time dateTime={item.startedAt}>{new Date(item.startedAt).toLocaleString()}</time>
                {item.outcome === "SUCCESS"
                  ? " · observed success"
                  : item.outcome === "FAILURE"
                    ? " · observed failure"
                    : " · no evidence"}
              </p>
              {item.evidenceId !== null ? (
                <p className={item.evidenceValid ? styles.validEvidence : styles.invalidEvidence}>
                  {item.evidenceValid
                    ? `${item.dimension?.toLowerCase().replaceAll("_", " ")} evidence`
                    : "Evidence invalidated; original preserved"}
                </p>
              ) : null}
              <InvalidateEvidenceForm item={item} />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function FocusWorkspace({ workspace }: { readonly workspace: FocusWorkspaceV1 }) {
  const exploreQuery = new URLSearchParams({ goal: workspace.readinessGoalKey });
  if (workspace.activity !== null) exploreQuery.set("activity", workspace.activity.activityKey);
  return (
    <div className={styles.workspace}>
      <Link className={styles.backLink} href={`/explore?${exploreQuery.toString()}`}>
        ← Back to Explore
      </Link>

      {workspace.activity === null ? (
        <section className={styles.emptyCard}>
          <h1>Choose a personal activity in Explore.</h1>
          <p>Focus starts from an accepted activity-to-competency mapping.</p>
        </section>
      ) : workspace.activeSession === null ? (
        <section className={styles.activityCard} aria-labelledby="focus-title">
          <p className={styles.eyebrow}>Ready to focus</p>
          <h1 id="focus-title">{workspace.activity.title}</h1>
          <dl>
            <div>
              <dt>Goal</dt>
              <dd>{workspace.activity.expectedEvidence}</dd>
            </div>
            <div>
              <dt>Evidence dimension</dt>
              <dd>{workspace.activity.evidenceDimension.toLowerCase().replaceAll("_", " ")}</dd>
            </div>
          </dl>
          {workspace.activity.resourceUrl === null ? null : (
            <a href={workspace.activity.resourceUrl} rel="noreferrer" target="_blank">
              Open activity resource in a new tab
            </a>
          )}
          <StartForm workspace={workspace} />
        </section>
      ) : (
        <ActiveSession workspace={workspace} />
      )}

      <section className={styles.projectionCard} aria-labelledby="mastery-summary-title">
        <div>
          <p className={styles.eyebrow}>Evidence-derived state</p>
          <h2 id="mastery-summary-title">Competency state</h2>
        </div>
        {workspace.projectionState === "pending" ? (
          <p aria-live="polite" role="status">
            Recalculating from the active evidence ledger…
          </p>
        ) : workspace.masteryState === null ? (
          <p>No qualifying evidence has been projected yet.</p>
        ) : (
          <div>
            <strong className={styles.masteryLevel}>
              {workspace.masteryState.achievementLevel.toLowerCase().replaceAll("_", " ")}
            </strong>
            <p>
              {workspace.masteryState.explanationCodes
                .map((code) => code.toLowerCase().replaceAll("_", " "))
                .join(" · ")}
            </p>
          </div>
        )}
      </section>

      <History history={workspace.history} />
    </div>
  );
}
