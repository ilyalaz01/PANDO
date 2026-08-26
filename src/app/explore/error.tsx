"use client";

import styles from "../../ui/explore/explore.module.css";

export default function ExploreError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className={styles.main}>
      <section className={styles.intro} role="alert">
        <div>
          <p className={styles.eyebrow}>Explore unavailable</p>
          <h1>Your saved goal was not changed.</h1>
        </div>
        <div className={styles.introNote}>
          <p>PANDO could not assemble the authorized target structure.</p>
          <button type="button" onClick={props.reset}>
            Try again
          </button>
        </div>
      </section>
    </main>
  );
}
