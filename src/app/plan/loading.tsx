import styles from "../../ui/plan/plan.module.css";
export default function Loading() {
  return (
    <main aria-busy="true" className={styles.fallback}>
      <h1>Loading your plan…</h1>
    </main>
  );
}
