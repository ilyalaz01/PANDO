export default function StartLoading() {
  return (
    <main className="mx-auto min-h-screen max-w-5xl px-5 py-16 sm:px-8" aria-busy="true">
      <p className="font-bold text-[var(--color-text-muted)]">Loading your PANDO workspace…</p>
    </main>
  );
}
