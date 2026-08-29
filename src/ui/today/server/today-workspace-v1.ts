import type { PlanSnapshot } from "../../../modules/planning/domain/planning-types";
import { todayWorkspaceSemanticViolations } from "../../../shared/contracts/planning-semantics";
import { validateSchema } from "../../../shared/contracts/schema-registry";

export type TodayProjectionState = "CURRENT" | "PENDING" | "ERROR" | "NOT_STARTED";
export type TodayProjectionReason =
  "INITIALIZING" | "INPUTS_CHANGED" | "CALCULATION_FAILED" | "SNAPSHOT_EXPIRED" | null;

export interface TodayCalculationClockV1 {
  readonly asOf: string;
  readonly timeZone: string;
  readonly weekStart: string;
  readonly weekEnd: string;
}

export interface TodaySnapshotPointerV1 {
  readonly snapshotId: string;
  readonly inputFingerprint: string;
  readonly calculatedAsOf: string;
  readonly validUntil: string;
  readonly plan: PlanSnapshot;
}

export interface TodayActionSelectionV1 {
  readonly selectionRef: string;
  readonly rank: number;
  readonly candidateKey: string;
}

export interface TodayWorkspaceV1 {
  readonly contract: { readonly name: "TodayWorkspaceV1"; readonly version: "1.0.0" };
  readonly projectionState: TodayProjectionState;
  readonly reason: TodayProjectionReason;
  readonly lastKnownSafe: boolean;
  readonly calculationClock: TodayCalculationClockV1;
  readonly currentInputFingerprint: string | null;
  readonly snapshot: TodaySnapshotPointerV1 | null;
  readonly actionSelections: readonly TodayActionSelectionV1[];
  readonly context: {
    readonly nearestDeadline: PlanSnapshot["nearestDeadline"];
  };
}

export class TodayWorkspaceContractError extends TypeError {
  constructor() {
    super("Today workspace response is invalid.");
    this.name = "TodayWorkspaceContractError";
  }
}

/** Rejects structural and cross-field drift before a Planning projection reaches browser code. */
export function decodeTodayWorkspaceV1(value: unknown): TodayWorkspaceV1 {
  const structural = validateSchema("today-workspace-v1", value);
  if (!structural.valid || todayWorkspaceSemanticViolations(value).length > 0) {
    throw new TodayWorkspaceContractError();
  }
  return value as TodayWorkspaceV1;
}
