import styles from "../../ui/review/review.module.css";
export default function ReviewLoading() {
  return (
    <main className={styles.fallback} aria-live="polite" role="status">
      <h1>Loading Review…</h1>
      <p>Collecting the current review queue and its reasons.</p>
    </main>
  );
}
