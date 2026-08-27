import { notFound } from "next/navigation";

import { ExploreWorkspace } from "../../../ui/explore/explore-workspace";
import styles from "../../../ui/explore/explore.module.css";
import { getRepresentativeExploreProjection } from "../../../ui/explore/server/representative-projection";
import { SkipLink } from "../../../ui/primitives/skip-link";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Explore interaction fixture · PANDO",
  description: "Test-only representative PANDO competency projection.",
  robots: { index: false, follow: false },
};

export default function ExploreFixturePage() {
  if (process.env.PANDO_ENABLE_EXPLORE_FIXTURE !== "true") notFound();

  const projection = getRepresentativeExploreProjection();

  return (
    <div className={styles.page}>
      <SkipLink targetId="explore-main">Skip to competency explorer</SkipLink>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <p className={styles.brand}>PANDO</p>
          <p>Automated interaction fixture</p>
        </div>
      </header>
      <main id="explore-main" tabIndex={-1} className={styles.main}>
        <section className={styles.intro} aria-labelledby="explore-title">
          <div>
            <p className={styles.eyebrow}>One organism · many competencies</p>
            <h1 id="explore-title">See the roots beneath your next move.</h1>
          </div>
          <p className={styles.introNote}>
            Representative Phase 0 fixture: 25 nodes for automated interaction and performance
            validation. This route is disabled unless the test harness explicitly enables it.
          </p>
        </section>
        <ExploreWorkspace projection={projection} readinessGoalKey="goal:representative-fixture" />
      </main>
    </div>
  );
}
