"use client";

import type { ExploreTargetReadinessView } from "./types";
import styles from "./explore.module.css";

function percentage(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function TargetReadinessPanel({
  readiness,
  onInspectGap,
}: {
  readonly readiness: ExploreTargetReadinessView | null;
  readonly onInspectGap: (outlineNodeId: string) => void;
}) {
  if (readiness === null) {
    return (
      <section className={styles.readiness} aria-labelledby="readiness-title">
        <h2 id="readiness-title">Readiness unavailable</h2>
        <p>Target readiness could not be loaded. Your target structure remains available.</p>
      </section>
    );
  }
  const currentSnapshot = readiness.state === "CURRENT" ? readiness.snapshot : null;
  const detailSnapshot =
    readiness.state === "CURRENT" || readiness.state === "STALE" ? readiness.snapshot : null;
  const showsPointEstimate =
    currentSnapshot !== null &&
    currentSnapshot.coverage >= 0.7 &&
    currentSnapshot.lower === currentSnapshot.upper;
  return (
    <section className={styles.readiness} aria-labelledby="readiness-title">
      <div>
        <p className={styles.eyebrow}>Readiness · {readiness.state.replaceAll("_", " ")}</p>
        <h2 id="readiness-title">
          {currentSnapshot
            ? currentSnapshot.status.replaceAll("_", " ")
            : "Readiness is not current"}
        </h2>
        <p className={styles.projectionExplanation}>{readiness.message}</p>
        <p className={styles.readinessContext}>
          Profile {readiness.profileVersionKey}
          {readiness.calculatedAt ? (
            <>
              {" · calculated "}
              <time dateTime={readiness.calculatedAt}>{readiness.calculatedAt.slice(0, 10)}</time>
            </>
          ) : null}
        </p>
      </div>
      {currentSnapshot ? (
        <dl className={styles.readinessMetrics} aria-label="Current readiness">
          <div>
            <dt>{showsPointEstimate ? "Readiness" : "Range"}</dt>
            <dd>
              {showsPointEstimate
                ? `≈${percentage(currentSnapshot.lower)}`
                : `${percentage(currentSnapshot.lower)}–${percentage(currentSnapshot.upper)}`}
            </dd>
          </div>
          <div>
            <dt>Coverage</dt>
            <dd>{percentage(currentSnapshot.coverage)}</dd>
          </div>
          <div>
            <dt>Confidence</dt>
            <dd>{currentSnapshot.confidence}</dd>
          </div>
        </dl>
      ) : (
        <p className={styles.projectionNotice}>
          {readiness.state === "STALE"
            ? "The last safe breakdown is shown below, but its readiness number is stale."
            : "No readiness number is presented until the snapshot is current."}
        </p>
      )}
      {detailSnapshot ? (
        <div className={styles.readinessDetail}>
          {detailSnapshot.blockers.length > 0 ? (
            <div>
              <h3>Readiness blockers</h3>
              <ul>
                {detailSnapshot.blockers.map((blocker) => (
                  <li key={`${blocker.code}:${blocker.title}`}>
                    {blocker.title} · {blocker.code.replaceAll("_", " ")}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {detailSnapshot.gaps.length > 0 ? (
            <div>
              <h3>Requirement gaps</h3>
              <ul>
                {detailSnapshot.gaps.map((gap) => (
                  <li key={gap.gapKey}>
                    <button type="button" onClick={() => onInspectGap(gap.outlineNodeId)}>
                      Inspect {gap.title}
                    </button>
                    <span>
                      {gap.gapCode.replaceAll("_", " ")} · {gap.dimension} to {gap.requiredLevel} ·{" "}
                      {gap.freshness}
                    </span>
                    {gap.evidenceRefCount > 0 ? (
                      <small>
                        {gap.evidenceRefs.join(", ")}
                        {gap.evidenceRefCount > gap.evidenceRefs.length
                          ? ` +${gap.evidenceRefCount - gap.evidenceRefs.length} more`
                          : ""}
                      </small>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {detailSnapshot.domains.length > 0 ? (
            <div>
              <h3>Domain evidence counts</h3>
              <ul>
                {detailSnapshot.domains.map((domain) => (
                  <li key={domain.domainNodeId}>
                    {domain.title}: {domain.requiredCount} required · {domain.knownCount} known ·{" "}
                    {domain.unknownCount} unknown · {domain.staleCount} stale ·{" "}
                    {domain.mandatoryFloorBlockerCount} mandatory-floor blockers
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
