"use client";

import type { CapacityEffectPreviewV1 } from "./plan-types";
import styles from "./plan.module.css";

/**
 * D3b2-rollout's stateless interim capacity-effect preview (see the D3b2-rollout status report).
 * Recomputed on every page load from live Availability windows and Learning Tracks; never
 * persisted, never applied. It estimates what `planner-engine/0.3.0` would compute over the next
 * seven local days — not the exact plan-week boundaries a future activated V3 snapshot will use.
 */
export function CapacityEffectPreview({ preview }: { readonly preview: CapacityEffectPreviewV1 }) {
  const isLimited = preview.capacityLimitedByAvailability;
  const limitedTracks = preview.trackEffects.filter((effect) => effect.limited);
  return (
    <section aria-labelledby="capacity-effect-heading" className={styles.panel}>
      <h2 id="capacity-effect-heading">Estimated capacity effect</h2>
      <p>
        An early, unofficial look at how your recorded availability would affect the next seven days
        if the availability-aware capacity engine were already active. This is only an estimate: it
        is not saved, and it does not change your Plan.
      </p>
      <p>
        <strong>
          {preview.effectiveWeeklyCapacityMinutes} of {preview.defaultWeeklyCapacityMinutes}
        </strong>{" "}
        minutes estimated available
        {isLimited ? ", limited by recorded availability." : "."}
      </p>
      <ul className={styles.trackList} aria-label="Estimated daily capacity">
        {preview.dailyCaps.map((day) => (
          <li className={styles.trackCard} key={day.date}>
            <strong>{day.date}</strong>
            <span>{day.capMinutes} minutes</span>
            <span>{day.sourceWindowKey === null ? "No recorded window" : "Recorded window"}</span>
          </li>
        ))}
      </ul>
      {limitedTracks.length > 0 ? (
        <>
          <p className={styles.notice}>
            {limitedTracks.length} active Track{limitedTracks.length === 1 ? "" : "s"} would not
            receive its full protected minimum this estimate.
          </p>
          <ul className={styles.trackList} aria-label="Estimated Track rationing">
            {limitedTracks.map((effect) => (
              <li className={styles.trackCard} key={effect.trackId}>
                <strong>{effect.trackKey}</strong>
                <span>
                  {effect.reservedMinutes} of {effect.protectedMinimumMinutes} protected minutes
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
