import { ExploreWorkspace } from "../../ui/explore/explore-workspace";
import styles from "../../ui/explore/explore.module.css";
import { getRepresentativeExploreProjection } from "../../ui/explore/server/representative-projection";
import { SkipLink } from "../../ui/primitives/skip-link";

export const metadata = {
  title: "Explore competency map · PANDO",
  description: "Accessible Map and Outline views of a PANDO competency projection.",
};

export default function ExplorePage() {
  const projection = getRepresentativeExploreProjection();

  return (
    <div className={styles.page}>
      <SkipLink targetId="explore-main">Skip to competency explorer</SkipLink>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <p className={styles.brand}>PANDO</p>
          <p>Phase 0 · Explore vertical slice</p>
        </div>
      </header>
      <main id="explore-main" tabIndex={-1} className={styles.main}>
        <section className={styles.intro} aria-labelledby="explore-title">
          <div>
            <p className={styles.eyebrow}>One organism · many competencies</p>
            <h1 id="explore-title">See the roots beneath your next move.</h1>
          </div>
          <p className={styles.introNote}>
            Representative Phase 0 fixture: 25 nodes for interaction and performance validation. It
            is not production database state or an authoritative employer target.
          </p>
        </section>
        <ExploreWorkspace projection={projection} />
      </main>
    </div>
  );
}
