"use client";
import styles from "../../ui/plan/plan.module.css";
export default function Error({
  reset,
}: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}) {
  return (
    <main className={styles.fallback} role="alert">
      <h1>Plan could not load.</h1>
      <p>Your plan was not changed.</p>
      <button className={styles.secondaryButton} onClick={reset} type="button">
        Try again
      </button>
    </main>
  );
}
