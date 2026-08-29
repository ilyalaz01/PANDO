import styles from "../../ui/today/today.module.css";

export default function TodayLoading() {
  return (
    <main className={styles.fallback} aria-live="polite" role="status">
      <h1>Loading Today…</h1>
      <p>Checking the current Planning snapshot and safe action selectors.</p>
    </main>
  );
}
