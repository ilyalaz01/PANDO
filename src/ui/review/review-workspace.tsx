"use client";
import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { reviewAction } from "../../app/review/actions";
import { initialReviewActionState, type ReviewActionState } from "./review-action-state";
import type {
  ReviewBucket,
  ReviewItemV1,
  ReviewReasonV1,
  ReviewWorkspaceV1,
} from "./server/review-workspace-v1";
import styles from "./review.module.css";
const labels: Record<ReviewReasonV1["reasonType"], string> = {
  RETENTION_RISK: "Retention risk",
  PERSONAL_REMINDER: "Personal reminder",
  VERIFICATION_NEEDED: "Verification needed",
};
const sections: readonly [ReviewBucket, string, string][] = [
  ["OVERDUE", "Overdue", "Needs attention now"],
  ["DUE_TODAY", "Due today", "Scheduled before your local midnight"],
  ["UPCOMING", "Upcoming", "Future evidence refreshes"],
  ["PERSONAL_REMINDER", "Personal reminders", "Future reminder-only reviews"],
  [
    "SUPPRESSED",
    "Suppressed / excluded",
    "History is retained; these reasons do not currently recommend work",
  ],
];
function requestId(): string {
  return globalThis.crypto.randomUUID();
}
function Status({ state }: { readonly state: ReviewActionState }) {
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
function ReasonActions({
  item,
  reason,
  manageable,
}: {
  readonly item: ReviewItemV1;
  readonly reason: ReviewReasonV1;
  readonly manageable: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [id] = useState(requestId);
  const [state, action, pending] = useActionState(reviewAction, initialReviewActionState);
  const router = useRouter();
  useEffect(() => {
    if (state.status === "updated") router.refresh();
  }, [router, state.status]);
  if (!manageable) return <span className={styles.status}>Available after recalculation.</span>;
  if (!open)
    return (
      <button className={styles.textButton} type="button" onClick={() => setOpen(true)}>
        Manage {labels[reason.reasonType].toLowerCase()}
      </button>
    );
  return (
    <form action={action} className={styles.reasonForm}>
      <input type="hidden" name="requestId" value={id} />
      <input type="hidden" name="subjectId" value={item.subjectId} />
      <input type="hidden" name="reasonId" value={reason.reasonId} />
      <input type="hidden" name="projectionVersion" value={item.projectionVersion} />
      <input type="hidden" name="sourceRevision" value={reason.sourceRevision} />
      {reason.status === "suppressed" ? (
        <button className={styles.secondaryButton} disabled={pending} name="intent" value="restore">
          Restore this reason
        </button>
      ) : (
        <>
          <label htmlFor={`due-${reason.reasonId}`}>New local due date and time</label>
          <input id={`due-${reason.reasonId}`} name="localDueAt" type="datetime-local" />
          <div className={styles.actions}>
            <button
              className={styles.secondaryButton}
              disabled={pending}
              name="intent"
              value="reschedule"
            >
              Reschedule
            </button>
            <button
              className={styles.secondaryButton}
              disabled={pending}
              name="intent"
              value="skip"
            >
              Skip once
            </button>
            <button
              className={styles.dangerButton}
              disabled={pending}
              name="intent"
              value="suppress"
            >
              Suppress
            </button>
          </div>
        </>
      )}
      <Status state={state} />
      <button className={styles.textButton} type="button" onClick={() => setOpen(false)}>
        Cancel
      </button>
    </form>
  );
}
function PersonalReminderAction({
  item,
  manageable,
}: {
  readonly item: ReviewItemV1;
  readonly manageable: boolean;
}) {
  const [id] = useState(requestId);
  const [state, action, pending] = useActionState(reviewAction, initialReviewActionState);
  const router = useRouter();
  useEffect(() => {
    if (state.status === "updated") router.refresh();
  }, [router, state.status]);
  if (item.reasons.some(({ reasonType }) => reasonType === "PERSONAL_REMINDER")) return null;
  if (!manageable) return null;
  return (
    <form action={action} className={styles.reasonForm}>
      <input type="hidden" name="requestId" value={id} />
      <input type="hidden" name="competencyRef" value={item.competencyRef} />
      <input type="hidden" name="dimension" value={item.dimension} />
      <input type="hidden" name="projectionVersion" value={item.projectionVersion} />
      <label htmlFor={`reminder-${item.subjectId}`}>Add a personal reminder</label>
      <input id={`reminder-${item.subjectId}`} name="localDueAt" required type="datetime-local" />
      <button className={styles.secondaryButton} disabled={pending} name="intent" value="reminder">
        Add reminder
      </button>
      <Status state={state} />
    </form>
  );
}
function Card({ item, manageable }: { readonly item: ReviewItemV1; readonly manageable: boolean }) {
  return (
    <li className={styles.card}>
      <div className={styles.cardHeader}>
        <div>
          <h3>{item.title}</h3>
          <p>{item.dimension.toLowerCase().replaceAll("_", " ")}</p>
        </div>
        {item.effectiveDueAt === null ? (
          <span className={styles.badge}>Suppressed</span>
        ) : (
          <time className={styles.badge} dateTime={item.effectiveDueAt}>
            {new Date(item.effectiveDueAt).toLocaleString()}
          </time>
        )}
      </div>
      <p className={styles.explanation}>
        Due because of the earliest active reason. Every current reason remains visible below.
      </p>
      <ul className={styles.reasonList}>
        {item.reasons.map((reason) => (
          <li key={reason.reasonId}>
            <div>
              <strong>{labels[reason.reasonType]}</strong>
              <span>
                {reason.status === "suppressed"
                  ? "Suppressed"
                  : `Due ${new Date(reason.dueAt).toLocaleString()}`}
              </span>
            </div>
            <ReasonActions item={item} manageable={manageable} reason={reason} />
          </li>
        ))}
      </ul>
      <PersonalReminderAction item={item} manageable={manageable} />
      {item.focus === null ? (
        <Link
          className={styles.focusLink}
          href={`/explore?competency=${encodeURIComponent(item.competencyRef)}`}
        >
          Choose an activity in Explore
        </Link>
      ) : (
        <Link
          className={styles.focusLink}
          href={`/focus?${new URLSearchParams({ goal: item.focus.readinessGoalKey, activity: item.focus.activityKey }).toString()}`}
        >
          Start review in Focus
        </Link>
      )}
    </li>
  );
}
export function ReviewWorkspace({ workspace }: { readonly workspace: ReviewWorkspaceV1 }) {
  const grouped = new Map<ReviewBucket, ReviewItemV1[]>(sections.map(([bucket]) => [bucket, []]));
  for (const item of workspace.items) grouped.get(item.bucket)?.push(item);
  return (
    <div className={styles.workspace}>
      <section className={styles.intro}>
        <p className={styles.eyebrow}>Review Center</p>
        <h1>Refresh what needs proof.</h1>
        <p>
          Each subject appears once. PANDO shows every reason, while the earliest active reason sets
          its place in the queue.
        </p>
        {workspace.projectionState === "pending" ? (
          <p className={styles.pending} role="status">
            Review schedule is recalculating from evidence. The last known queue is shown.
          </p>
        ) : null}
      </section>
      {workspace.items.length === 0 ? (
        <section className={styles.empty}>
          <h2>No reviews yet.</h2>
          <p>Qualifying evidence schedules a review. PANDO will not invent a zero or a streak.</p>
          <Link className={styles.focusLink} href="/start">
            Choose a target and start useful work
          </Link>
        </section>
      ) : (
        sections.map(([bucket, title, detail]) => {
          const items = grouped.get(bucket) ?? [];
          return (
            <section className={styles.section} aria-labelledby={`review-${bucket}`} key={bucket}>
              <div>
                <h2 id={`review-${bucket}`}>{title}</h2>
                <p>{detail}</p>
              </div>
              {items.length === 0 ? (
                <p className={styles.none}>Nothing here.</p>
              ) : (
                <ol>
                  {items.map((item) => (
                    <Card
                      item={item}
                      key={item.subjectId}
                      manageable={workspace.projectionState === "current"}
                    />
                  ))}
                </ol>
              )}
            </section>
          );
        })
      )}
    </div>
  );
}
