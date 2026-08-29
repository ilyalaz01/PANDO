"use client";

import styles from "../../ui/today/today.module.css";

export default function TodayError({ reset }: { readonly reset: () => void }) {
  return (
    <main className={styles.fallback} role="alert">
      <h1>Today hit a temporary problem.</h1>
      <p>No action is assumed to be current and nothing was changed.</p>
      <button className={styles.secondaryLink} onClick={reset} type="button">
        Try again
      </button>
    </main>
  );
}
