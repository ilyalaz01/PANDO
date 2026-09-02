import type { PlanSnapshot, PlanSnapshotV2 } from "../../../modules/planning/domain/planning-types";
import { isJsonObject } from "../../../shared/contracts/json";
import { todayWorkspaceSemanticViolations } from "../../../shared/contracts/planning-semantics";
import { validateSchema } from "../../../shared/contracts/schema-registry";

export type TodayProjectionState = "CURRENT" | "PENDING" | "ERROR" | "NOT_STARTED";
export type TodayProjectionReason =
  "INITIALIZING" | "INPUTS_CHANGED" | "CALCULATION_FAILED" | "SNAPSHOT_EXPIRED" | null;
export type ReadablePlanSnapshot = PlanSnapshot | PlanSnapshotV2;

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
  readonly plan: ReadablePlanSnapshot;
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
    readonly nearestDeadline: ReadablePlanSnapshot["nearestDeadline"];
  };
}

export class TodayWorkspaceContractError extends TypeError {
  constructor() {
    super("Today workspace response is invalid.");
    this.name = "TodayWorkspaceContractError";
  }
}

function embeddedPlanContractIsValid(value: unknown): boolean {
  if (!isJsonObject(value)) return false;
  if (value.snapshot === null) return true;
  if (!isJsonObject(value.snapshot) || !isJsonObject(value.snapshot.plan)) return false;
  const plan = value.snapshot.plan;
  if (
    plan.engineVersion === "planner-engine/0.1.0" &&
    plan.policyVersion === "planning-policy/0.1"
  ) {
    return validateSchema("plan-snapshot-v1", plan).valid;
  }
  if (
    plan.engineVersion === "planner-engine/0.2.0" &&
    plan.policyVersion === "planning-policy/0.2"
  ) {
    return validateSchema("plan-snapshot-v2", plan).valid;
  }
  return false;
}

/** Rejects structural and cross-field drift before a Planning projection reaches browser code. */
export function decodeTodayWorkspaceV1(value: unknown): TodayWorkspaceV1 {
  const structural = validateSchema("today-workspace-v1", value);
  if (
    !structural.valid ||
    !embeddedPlanContractIsValid(value) ||
    todayWorkspaceSemanticViolations(value).length > 0
  ) {
    throw new TodayWorkspaceContractError();
  }
  return value as TodayWorkspaceV1;
}
