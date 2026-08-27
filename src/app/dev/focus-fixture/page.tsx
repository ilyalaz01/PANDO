import { notFound } from "next/navigation";

import { FocusWorkspace } from "../../../ui/focus/focus-workspace";
import styles from "../../../ui/focus/focus.module.css";
import type { FocusWorkspaceV1 } from "../../../ui/focus/server/focus-workspace-v1";
import { SkipLink } from "../../../ui/primitives/skip-link";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Focus interaction fixture · PANDO",
  description: "Test-only representative PANDO Focus workspace.",
  robots: { index: false, follow: false },
};

function representativeFocusWorkspace(): FocusWorkspaceV1 {
  const now = Date.now();
  return {
    contract: { name: "FocusWorkspaceV1", version: "1.0.0" },
    readinessGoalKey: "goal:representative-fixture",
    activity: {
      activityKey: "activity:typing-practice",
      title: "Typing practice",
      activityType: "MANUAL_CODING",
      competencyRef: "competency:python-typing",
      evidenceDimension: "APPLICATION",
      expectedEvidence: "Produce a working result without copying the solution.",
      resourceUrl: "https://example.com/typing-practice",
    },
    activeSession: {
      focusSessionId: "10000000-0000-4000-8000-000000000001",
      activityKey: "activity:typing-practice",
      title: "Typing practice",
      state: "active",
      plannedMinutes: 25,
      sessionVersion: "1",
      startedAt: new Date(now - 12 * 60_000).toISOString(),
    },
    history: [
      {
        focusSessionId: "10000000-0000-4000-8000-000000000002",
        activityKey: "activity:typing-practice",
        title: "Typing practice",
        state: "completed",
        startedAt: new Date(now - 26 * 60 * 60_000).toISOString(),
        endedAt: new Date(now - 25.5 * 60 * 60_000).toISOString(),
        resultKind: "OBSERVED_SUCCESS",
        evidenceId: "20000000-0000-4000-8000-000000000001",
        evidenceValid: true,
        dimension: "APPLICATION",
        outcome: "SUCCESS",
        ledgerWatermark: "1",
      },
    ],
    masteryState: null,
    projectionState: "pending",
  };
}

export default function FocusFixturePage() {
  if (process.env.PANDO_ENABLE_FOCUS_FIXTURE !== "true") notFound();

  return (
    <div className={styles.page}>
      <SkipLink targetId="focus-main">Skip to Focus</SkipLink>
      <header className={styles.header}>
        <div>
          <p className={styles.brand}>PANDO</p>
          <span>Automated Focus fixture</span>
        </div>
      </header>
      <main className={styles.main} id="focus-main" tabIndex={-1}>
        <FocusWorkspace workspace={representativeFocusWorkspace()} />
      </main>
    </div>
  );
}
