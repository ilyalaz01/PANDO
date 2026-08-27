import styles from "../../ui/focus/focus.module.css";

export default function FocusLoading() {
  return (
    <main className={styles.fallback} aria-live="polite" role="status">
      <h1>Loading Focus…</h1>
      <p>Correlating your activity, evidence history, and current projection.</p>
    </main>
  );
}
