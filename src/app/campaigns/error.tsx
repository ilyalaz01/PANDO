"use client";
import styles from "../../ui/campaigns/campaigns.module.css";
export default function Error({
  reset,
}: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}) {
  return (
    <main className={styles.fallback} role="alert">
      <h1>Interview Campaigns could not load.</h1>
      <p>Nothing was changed.</p>
      <button className={styles.secondaryButton} onClick={reset} type="button">
        Try again
      </button>
    </main>
  );
}
