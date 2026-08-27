"use client";
import styles from "../../ui/review/review.module.css";
export default function ReviewError({ reset }: { readonly reset: () => void }) {
  return (
    <main className={styles.fallback} role="alert">
      <h1>Review hit a temporary problem.</h1>
      <p>No command is assumed to have succeeded. Reload the authorized queue before retrying.</p>
      <button className={styles.secondaryButton} onClick={reset} type="button">
        Try again
      </button>
    </main>
  );
}
