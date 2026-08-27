import { notFound } from "next/navigation";

import { SkipLink } from "../../../ui/primitives/skip-link";
import { ReviewWorkspace } from "../../../ui/review/review-workspace";
import styles from "../../../ui/review/review.module.css";
import type { ReviewWorkspaceV1 } from "../../../ui/review/server/review-workspace-v1";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata = {
  title: "Review interaction fixture · PANDO",
  description: "Test-only representative PANDO Review workspace.",
  robots: { index: false, follow: false },
};

function fixture(): ReviewWorkspaceV1 {
  return {
    contract: { name: "ReviewWorkspaceV1", version: "1.0.0" },
    asOf: "2026-08-27T10:00:00.000Z",
    timeZone: "UTC",
    projectionState: "current",
    items: [
      {
        subjectId: "10000000-0000-4000-8000-000000000001",
        subjectRef: "competency:python-errors/knowledge",
        competencyRef: "competency:python-errors",
        dimension: "KNOWLEDGE",
        title: "Python error handling",
        effectiveDueAt: "2026-08-27T09:00:00.000Z",
        bucket: "OVERDUE",
        projectionVersion: "2",
        reasons: [
          {
            reasonId: "20000000-0000-4000-8000-000000000001",
            reasonType: "RETENTION_RISK",
            dueAt: "2026-08-27T09:00:00.000Z",
            status: "active",
            sourceRevision: "1",
          },
          {
            reasonId: "20000000-0000-4000-8000-000000000002",
            reasonType: "PERSONAL_REMINDER",
            dueAt: "2026-08-27T12:00:00.000Z",
            status: "active",
            sourceRevision: "1",
          },
        ],
        focus: {
          readinessGoalKey: "goal:representative-fixture",
          activityKey: "activity:typing-practice",
        },
      },
      {
        subjectId: "10000000-0000-4000-8000-000000000002",
        subjectRef: "competency:python-errors/application",
        competencyRef: "competency:python-errors",
        dimension: "APPLICATION",
        title: "Apply exception boundaries",
        effectiveDueAt: "2026-08-28T10:00:00.000Z",
        bucket: "UPCOMING",
        projectionVersion: "1",
        reasons: [
          {
            reasonId: "20000000-0000-4000-8000-000000000003",
            reasonType: "VERIFICATION_NEEDED",
            dueAt: "2026-08-28T10:00:00.000Z",
            status: "active",
            sourceRevision: "1",
          },
        ],
        focus: null,
      },
      {
        subjectId: "10000000-0000-4000-8000-000000000003",
        subjectRef: "competency:python-errors/recall",
        competencyRef: "competency:python-errors",
        dimension: "RECALL",
        title: "Recall exception hierarchy",
        effectiveDueAt: null,
        bucket: "SUPPRESSED",
        projectionVersion: "3",
        reasons: [
          {
            reasonId: "20000000-0000-4000-8000-000000000004",
            reasonType: "RETENTION_RISK",
            dueAt: "2026-08-26T10:00:00.000Z",
            status: "suppressed",
            sourceRevision: "2",
          },
        ],
        focus: null,
      },
    ],
  };
}

export default function ReviewFixturePage() {
  if (process.env.PANDO_ENABLE_REVIEW_FIXTURE !== "true") notFound();
  return (
    <div className={styles.page}>
      <SkipLink targetId="review-main">Skip to Review</SkipLink>
      <header className={styles.header}>
        <div>
          <span className={styles.brand}>PANDO</span>
          <span>Automated Review fixture</span>
        </div>
      </header>
      <main className={styles.main} id="review-main" tabIndex={-1}>
        <ReviewWorkspace workspace={fixture()} />
      </main>
    </div>
  );
}
