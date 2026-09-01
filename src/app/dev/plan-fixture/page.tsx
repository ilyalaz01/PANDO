import { notFound } from "next/navigation";

import type { PlanActionState } from "../../../ui/plan/plan-action-state";
import type { CurrentGrowthPlanV1 } from "../../../ui/plan/plan-types";
import { PlanWorkspace } from "../../../ui/plan/plan-workspace";
import styles from "../../../ui/plan/plan.module.css";
import { SkipLink } from "../../../ui/primitives/skip-link";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata = {
  title: "Plan interaction fixture · PANDO",
  description: "Test-only representative PANDO Growth Plan lifecycle preview.",
  robots: { index: false, follow: false },
};

const plan = {
  growthPlanId: "30000000-0000-4000-8000-000000000020",
  title: "Backend interview readiness",
  lifecycle: "ACTIVE",
  weeklyCapacityMinutes: 600,
  aggregateVersion: "4",
} as const;

const workspace: CurrentGrowthPlanV1 = {
  contract: { name: "CurrentGrowthPlanV1", version: "1.0.0" },
  currentPlan: plan,
  recalculation: { projectionState: "PENDING", reason: "INPUTS_CHANGED", lastKnownSafe: true },
  capabilities: ["pause_growth_plan"],
};

const previewState: PlanActionState = {
  status: "previewed",
  message: "Preview ready. Confirm only if these exact facts are correct.",
  preview: {
    contract: { name: "GrowthPlanLifecyclePreviewV1", version: "1.0.0" },
    operation: "pause_growth_plan",
    reason: "The interview was cancelled; preserve history while priorities change.",
    expectedGrowthPlanVersion: "4",
    before: plan,
    after: { ...plan, lifecycle: "PAUSED", aggregateVersion: "5" },
    retained: { learningTracks: true, planSnapshots: true, focusSessions: true, evidence: true },
    recalculationAfterApply: {
      projectionState: "PENDING",
      consumerName: "planning.plan_snapshot_v1",
    },
    previewDigest: "a".repeat(64),
  },
};

export default function PlanFixturePage() {
  if (process.env.PANDO_ENABLE_PLAN_FIXTURE !== "true") notFound();
  return (
    <div className={styles.page}>
      <SkipLink targetId="plan-main">Skip to Plan</SkipLink>
      <header className={styles.header}>
        <div>
          <span className={styles.brand}>PANDO</span>
          <span>Automated Plan fixture</span>
        </div>
      </header>
      <main className={styles.main} id="plan-main" tabIndex={-1}>
        <PlanWorkspace initialPreviewState={previewState} workspace={workspace} />
      </main>
    </div>
  );
}
