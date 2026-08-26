import styles from "../../ui/explore/explore.module.css";

export default function ExploreLoading() {
  return (
    <main className={styles.main} aria-busy="true" aria-live="polite">
      <section className={styles.intro}>
        <div>
          <p className={styles.eyebrow}>Loading your target</p>
          <h1>Tracing the roots of this goal…</h1>
        </div>
        <p className={styles.introNote}>
          PANDO is correlating the authorized target, roadmap, prerequisites, and personal overlay.
        </p>
      </section>
    </main>
  );
}
