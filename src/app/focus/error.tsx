"use client";

import styles from "../../ui/focus/focus.module.css";

export default function FocusError({ reset }: { readonly reset: () => void }) {
  return (
    <main className={styles.fallback} role="alert">
      <h1>Focus hit a temporary problem.</h1>
      <p>No command is assumed to have succeeded. Reload the authorized state before retrying.</p>
      <button className={styles.primaryButton} type="button" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
