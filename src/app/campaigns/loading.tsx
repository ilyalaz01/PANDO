import styles from "../../ui/campaigns/campaigns.module.css";
export default function Loading() {
  return (
    <main aria-busy="true" className={styles.fallback}>
      <h1>Loading your Interview Campaigns…</h1>
    </main>
  );
}
