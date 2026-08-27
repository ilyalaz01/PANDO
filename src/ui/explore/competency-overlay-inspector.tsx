"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useActionState, useCallback, useEffect, useRef, useState } from "react";

import { addCompetencyActivityAction, saveCompetencyNoteAction } from "../../app/explore/actions";
import { initialOverlayActionState, type OverlayActionState } from "./overlay-action-state";
import type {
  CompetencyOverlayDetailV1,
  CustomActivityType,
} from "./server/competency-overlay-detail-v1";
import styles from "./explore.module.css";

const activityTypeLabels: ReadonlyArray<readonly [CustomActivityType, string]> = [
  ["MANUAL_CODING", "Hands-on practice"],
  ["READING", "Reading"],
  ["EXPLANATION", "Explain it"],
  ["MOCK", "Mock or rehearsal"],
  ["PROJECT", "Project"],
];

type DetailState =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready"; readonly detail: CompetencyOverlayDetailV1 };

function newRequestId(): string {
  return globalThis.crypto.randomUUID();
}

export interface CompetencyOverlayInspectorProps {
  readonly readinessGoalKey: string;
  readonly competencyRef: string;
  readonly inspectorRef: string;
  readonly initialOverlayVersion: string;
  readonly onDirtyChange: (inspectorRef: string, dirty: boolean) => void;
}

export function CompetencyOverlayInspector({
  readinessGoalKey,
  competencyRef,
  inspectorRef,
  initialOverlayVersion,
  onDirtyChange,
}: CompetencyOverlayInspectorProps) {
  const router = useRouter();
  const [detailState, setDetailState] = useState<DetailState>({ status: "loading" });
  const [overlayVersion, setOverlayVersion] = useState(initialOverlayVersion);
  const [noteDraft, setNoteDraft] = useState("");
  const [persistedNoteBody, setPersistedNoteBody] = useState("");
  const [activityTitle, setActivityTitle] = useState("");
  const [activityType, setActivityType] = useState<CustomActivityType>("MANUAL_CODING");
  const [noteRequestId, setNoteRequestId] = useState(newRequestId);
  const [activityRequestId, setActivityRequestId] = useState(newRequestId);
  const requestSequence = useRef(0);
  const noteDirty = noteDraft !== persistedNoteBody;
  const activityDirty = activityTitle.trim().length > 0;
  const dirty = noteDirty || activityDirty;

  const fetchDetail = useCallback(async () => {
    const query = new URLSearchParams({ goal: readinessGoalKey, competency: competencyRef });
    const response = await fetch(`/api/explore/competency-overlay?${query.toString()}`, {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!response.ok) throw new Error("overlay unavailable");
    return (await response.json()) as CompetencyOverlayDetailV1;
  }, [competencyRef, readinessGoalKey]);

  const loadDetail = useCallback(
    async (preserveNoteDraft = false) => {
      const sequence = ++requestSequence.current;
      try {
        const detail = await fetchDetail();
        if (sequence !== requestSequence.current) return;
        setOverlayVersion(detail.overlayVersion);
        setPersistedNoteBody(detail.note?.body ?? "");
        if (!preserveNoteDraft) setNoteDraft(detail.note?.body ?? "");
        setDetailState({ status: "ready", detail });
      } catch {
        if (sequence !== requestSequence.current) return;
        setDetailState({
          status: "error",
          message: "Personal notes and activities could not be loaded. Try again.",
        });
      }
    },
    [fetchDetail],
  );

  const runNoteAction = useCallback(
    async (previousState: OverlayActionState, formData: FormData) => {
      const nextState = await saveCompetencyNoteAction(previousState, formData);
      if (nextState.status === "saved") {
        setOverlayVersion(nextState.overlayVersion);
        setNoteRequestId(newRequestId());
        await loadDetail(true);
      } else if (nextState.status === "conflict") {
        setNoteRequestId(newRequestId());
        await loadDetail(true);
      }
      return nextState;
    },
    [loadDetail],
  );
  const runActivityAction = useCallback(
    async (previousState: OverlayActionState, formData: FormData) => {
      const nextState = await addCompetencyActivityAction(previousState, formData);
      if (nextState.status === "added") {
        setOverlayVersion(nextState.overlayVersion);
        setActivityRequestId(newRequestId());
        setActivityTitle("");
        setActivityType("MANUAL_CODING");
        if (noteDirty) {
          await loadDetail(true);
        } else {
          const query = new URLSearchParams({
            goal: readinessGoalKey,
            activity: nextState.activityKey,
          });
          router.replace(`/explore?${query.toString()}`);
        }
      } else if (nextState.status === "conflict") {
        setActivityRequestId(newRequestId());
        await loadDetail(true);
      }
      return nextState;
    },
    [loadDetail, noteDirty, readinessGoalKey, router],
  );
  const [noteState, noteAction, notePending] = useActionState(
    runNoteAction,
    initialOverlayActionState,
  );
  const [activityState, activityAction, activityPending] = useActionState(
    runActivityAction,
    initialOverlayActionState,
  );
  useEffect(() => {
    onDirtyChange(inspectorRef, dirty);
    return () => onDirtyChange(inspectorRef, false);
  }, [dirty, inspectorRef, onDirtyChange]);

  useEffect(() => {
    const sequence = ++requestSequence.current;
    void fetchDetail()
      .then((detail) => {
        if (sequence !== requestSequence.current) return;
        setOverlayVersion(detail.overlayVersion);
        setPersistedNoteBody(detail.note?.body ?? "");
        setNoteDraft(detail.note?.body ?? "");
        setDetailState({ status: "ready", detail });
      })
      .catch(() => {
        if (sequence !== requestSequence.current) return;
        setDetailState({
          status: "error",
          message: "Personal notes and activities could not be loaded. Try again.",
        });
      });
    return () => {
      requestSequence.current += 1;
    };
  }, [fetchDetail]);

  if (detailState.status === "loading") {
    return (
      <section className={styles.overlayInspector} data-inspector-ref={inspectorRef}>
        <h3>Personal layer</h3>
        <p aria-live="polite" role="status">
          Loading your note and activities…
        </p>
      </section>
    );
  }

  if (detailState.status === "error") {
    return (
      <section className={styles.overlayInspector} data-inspector-ref={inspectorRef}>
        <h3>Personal layer</h3>
        <p role="alert">{detailState.message}</p>
        <button
          className={styles.secondaryButton}
          type="button"
          onClick={() => {
            setDetailState({ status: "loading" });
            void loadDetail(noteDirty);
          }}
        >
          Try again
        </button>
      </section>
    );
  }

  return (
    <section className={styles.overlayInspector} data-inspector-ref={inspectorRef}>
      <div>
        <p className={styles.eyebrow}>Your workspace</p>
        <h3>Personal layer</h3>
        <p>Keep context here or add a concrete activity without changing the shared catalog.</p>
      </div>

      <form action={noteAction} className={styles.overlayForm}>
        <input name="readinessGoalKey" type="hidden" value={readinessGoalKey} />
        <input name="competencyRef" type="hidden" value={competencyRef} />
        <input name="expectedOverlayVersion" type="hidden" value={overlayVersion} />
        <input name="requestId" type="hidden" value={noteRequestId} />
        <label htmlFor={`${inspectorRef}-note`}>Private note</label>
        <textarea
          id={`${inspectorRef}-note`}
          maxLength={10_000}
          name="body"
          onChange={(event) => setNoteDraft(event.currentTarget.value)}
          placeholder="What matters about this competency right now?"
          required
          rows={5}
          value={noteDraft}
        />
        <p className={styles.formHint}>1–10,000 characters. Empty text does not delete a note.</p>
        <p
          aria-live="polite"
          className={styles.formStatus}
          role={
            noteState.status === "invalid" || noteState.status === "unavailable"
              ? "alert"
              : "status"
          }
        >
          {noteState.message}
        </p>
        <button
          className={styles.primaryButton}
          disabled={notePending || noteDraft.trim().length === 0}
          type="submit"
        >
          {notePending
            ? "Saving note…"
            : detailState.detail.note === null
              ? "Save note"
              : "Update note"}
        </button>
      </form>

      <div className={styles.activityList}>
        <h4>Your activities</h4>
        {detailState.detail.customActivities.length === 0 ? (
          <p>No personal activities for this competency yet.</p>
        ) : (
          <ul>
            {detailState.detail.customActivities.map((activity) => (
              <li key={activity.activityKey}>
                <strong>{activity.title}</strong>
                <span>
                  {activityTypeLabels.find(([type]) => type === activity.activityType)?.[1]}
                </span>
                <Link
                  className={styles.focusLink}
                  href={`/focus?${new URLSearchParams({
                    goal: readinessGoalKey,
                    activity: activity.activityKey,
                  }).toString()}`}
                  prefetch={false}
                >
                  Start focus session
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <form action={activityAction} className={styles.overlayForm}>
        <input name="readinessGoalKey" type="hidden" value={readinessGoalKey} />
        <input name="competencyRef" type="hidden" value={competencyRef} />
        <input name="expectedOverlayVersion" type="hidden" value={overlayVersion} />
        <input name="requestId" type="hidden" value={activityRequestId} />
        <label htmlFor={`${inspectorRef}-activity-title`}>New activity</label>
        <input
          id={`${inspectorRef}-activity-title`}
          maxLength={200}
          name="title"
          onChange={(event) => setActivityTitle(event.currentTarget.value)}
          placeholder="For example: explain this aloud"
          required
          type="text"
          value={activityTitle}
        />
        <label htmlFor={`${inspectorRef}-activity-type`}>Activity type</label>
        <select
          id={`${inspectorRef}-activity-type`}
          name="activityType"
          onChange={(event) => setActivityType(event.currentTarget.value as CustomActivityType)}
          value={activityType}
        >
          {activityTypeLabels.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <p
          aria-live="polite"
          className={styles.formStatus}
          role={
            activityState.status === "invalid" || activityState.status === "unavailable"
              ? "alert"
              : "status"
          }
        >
          {activityState.message}
        </p>
        <button
          className={styles.primaryButton}
          disabled={activityPending || activityTitle.trim().length === 0}
          type="submit"
        >
          {activityPending ? "Adding activity…" : "Add activity"}
        </button>
      </form>
    </section>
  );
}
