import type { AchievementLevel, ObjectiveDimension } from "./types";

export const MASTERY_PREREQUISITE_ENGINE_VERSION = "mastery-prerequisite-engine/0.1.0" as const;

export type PrerequisiteSatisfactionState = "SATISFIED" | "BLOCKED" | "UNKNOWN";

export type PrerequisiteSatisfactionReason =
  | "FRESH_STRONG"
  | "FRESH_WEAK"
  | "NOT_MATERIALIZED"
  | "AFTER_CLAIM"
  | "UNSUPPORTED_PROJECTION"
  | "MALFORMED_STATE"
  | "NO_DECISIVE_FRESH_STATE";

/**
 * A minimized, owner-fenced Mastery projection. The transport payload is intentionally unknown:
 * the pure engine must fail closed on malformed or contradictory historical state.
 */
export interface CalculatePrerequisiteSatisfactionInput {
  readonly competencyRef: string;
  readonly projection: unknown | null;
}

export interface PrerequisiteSatisfactionPolicy {
  readonly version: string;
  readonly acceptedMasteryEngineVersion: string;
  readonly acceptedMasteryPolicyVersion: string;
  readonly freshnessDays: Readonly<Record<ObjectiveDimension, number>>;
  readonly satisfyingAchievementLevels: readonly AchievementLevel[];
}

export interface PrerequisiteSatisfactionResult {
  readonly engineVersion: typeof MASTERY_PREREQUISITE_ENGINE_VERSION;
  readonly policyVersion: string;
  readonly competencyRef: string;
  readonly state: PrerequisiteSatisfactionState;
  readonly reason: PrerequisiteSatisfactionReason;
  /** Inclusive freshness boundary for the decisive result, or null for Unknown. */
  readonly validUntil: string | null;
}
