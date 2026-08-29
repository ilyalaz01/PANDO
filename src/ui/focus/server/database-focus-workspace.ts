import "server-only";

import { asArray, asJsonObject, asNumber, asString } from "../../../shared/contracts/json";
import type { PandoSupabaseClient } from "../../../shared/supabase/database";
import {
  FOCUS_RESULT_KINDS,
  decodeFocusWorkspaceV1,
  type FocusResultKind,
  type FocusWorkspaceV1,
} from "./focus-workspace-v1";

export const GET_FOCUS_WORKSPACE_RPC_V1 = "get_focus_workspace_v1" as const;
export const GET_FOCUS_FROM_PLAN_RPC_V1 = "get_focus_from_plan_v1" as const;
export const START_FOCUS_ACTIVITY_RPC_V1 = "start_focus_activity_v1" as const;
export const FINISH_FOCUS_ACTIVITY_RPC_V1 = "finish_focus_activity_v1" as const;
export const INVALIDATE_EVIDENCE_RPC_V1 = "invalidate_evidence_v1" as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ACTIVITY_KEY = /^activity:[a-z0-9][a-z0-9-]{1,100}$/u;
const GOAL_KEY = /^goal:[a-z0-9][a-z0-9-]{1,100}$/u;
const SELECTION_REF =
  /^plan-action:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export class FocusInputError extends Error {
  constructor() {
    super("The Focus request is invalid.");
    this.name = "FocusInputError";
  }
}

export class FocusConflictError extends Error {
  constructor() {
    super("Focus changed before this request completed.");
    this.name = "FocusConflictError";
  }
}

export class FocusUnavailableError extends Error {
  constructor() {
    super("Focus is unavailable for the current session.");
    this.name = "FocusUnavailableError";
  }
}

export interface StartFocusCommandV1 {
  readonly readinessGoalKey: string;
  readonly activityKey: string;
  readonly plannedMinutes: number;
  readonly idempotencyKey: string;
}

export interface FinishFocusCommandV1 {
  readonly focusSessionId: string;
  readonly expectedVersion: number;
  readonly terminalAction: "COMPLETE" | "STOP";
  readonly resultKind: FocusResultKind | null;
  readonly usedHint: boolean | null;
  readonly idempotencyKey: string;
}

export interface InvalidateEvidenceCommandV1 {
  readonly evidenceId: string;
  readonly reason: string;
  readonly idempotencyKey: string;
}

export interface FocusCommandResultV1 {
  readonly commandId: string;
  readonly focusSessionId: string;
  readonly state: "active" | "completed" | "stopped";
  readonly sessionVersion: string;
  readonly emittedEventIds: readonly string[];
  readonly evidenceId?: string | null;
  readonly projectionState?: "not_applicable" | "pending";
}

export interface EvidenceInvalidationResultV1 {
  readonly commandId: string;
  readonly correctionId: string;
  readonly evidenceId: string;
  readonly ledgerWatermark: string;
  readonly projectionState: "pending";
  readonly emittedEventIds: readonly string[];
}

export interface FocusFromPlanWorkspaceV1 {
  readonly contract: { readonly name: "FocusFromPlanWorkspaceV1"; readonly version: "1.0.0" };
  readonly selectionRef: string;
  readonly entryState: "READY_TO_START" | "ACTIVE";
  readonly plannedMinutes: number;
  readonly workspace: FocusWorkspaceV1;
}

function validIdempotencyKey(value: string): boolean {
  return value.length >= 1 && value.length <= 128 && value.trim() === value;
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

function collapseRpcError(error: unknown): never {
  const code = errorCode(error);
  if (code === "40001" || code === "23505") throw new FocusConflictError();
  if (code === "22023" || code === "22003" || code === "22P02") throw new FocusInputError();
  throw new FocusUnavailableError();
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

async function rpc(
  client: PandoSupabaseClient,
  name:
    | typeof GET_FOCUS_WORKSPACE_RPC_V1
    | typeof GET_FOCUS_FROM_PLAN_RPC_V1
    | typeof START_FOCUS_ACTIVITY_RPC_V1
    | typeof FINISH_FOCUS_ACTIVITY_RPC_V1
    | typeof INVALIDATE_EVIDENCE_RPC_V1,
  parameters: Record<string, boolean | number | null | string>,
): Promise<unknown> {
  let result: { data: unknown; error: unknown | null };
  try {
    result = (await client.rpc(name, parameters as never)) as {
      data: unknown;
      error: unknown | null;
    };
  } catch {
    throw new FocusUnavailableError();
  }
  if (result.error !== null) collapseRpcError(result.error);
  return result.data;
}

export async function loadFocusFromPlanWorkspaceV1(
  client: PandoSupabaseClient,
  selectionRef: string,
): Promise<FocusFromPlanWorkspaceV1> {
  if (!SELECTION_REF.test(selectionRef)) throw new FocusInputError();
  const value = await rpc(client, GET_FOCUS_FROM_PLAN_RPC_V1, {
    p_selection_ref: selectionRef,
  });
  try {
    const response = asJsonObject(value, "Focus from plan response");
    const contract = asJsonObject(response.contract, "Focus from plan contract");
    const returnedSelection = asString(response.selectionRef);
    const entryState = asString(response.entryState);
    const plannedMinutes = asNumber(response.plannedMinutes);
    if (
      !exactKeys(response, [
        "contract",
        "selectionRef",
        "entryState",
        "plannedMinutes",
        "workspace",
      ]) ||
      !exactKeys(contract, ["name", "version"]) ||
      contract.name !== "FocusFromPlanWorkspaceV1" ||
      contract.version !== "1.0.0" ||
      returnedSelection !== selectionRef ||
      (entryState !== "READY_TO_START" && entryState !== "ACTIVE") ||
      plannedMinutes === undefined ||
      !Number.isSafeInteger(plannedMinutes) ||
      plannedMinutes < 1 ||
      plannedMinutes > 480
    ) {
      throw new TypeError("Focus from plan response is invalid");
    }
    const workspace = decodeFocusWorkspaceV1(response.workspace);
    if (
      workspace.activity === null ||
      (entryState === "READY_TO_START" && workspace.activeSession !== null) ||
      (entryState === "ACTIVE" &&
        (workspace.activeSession === null ||
          workspace.activeSession.plannedMinutes !== plannedMinutes))
    ) {
      throw new TypeError("Focus from plan relationships are inconsistent");
    }
    return {
      contract: { name: "FocusFromPlanWorkspaceV1", version: "1.0.0" },
      selectionRef: returnedSelection,
      entryState,
      plannedMinutes,
      workspace,
    };
  } catch (error) {
    if (error instanceof FocusInputError) throw error;
    throw new FocusUnavailableError();
  }
}

function commandBase(value: unknown): {
  commandId: string;
  emittedEventIds: readonly string[];
} {
  const response = asJsonObject(value, "Focus command response");
  const commandId = asString(response.commandId);
  const emittedEventIds = asArray(response.emittedEventIds).flatMap((item) =>
    typeof item === "string" && UUID.test(item) ? [item] : [],
  );
  if (commandId === undefined || !UUID.test(commandId) || emittedEventIds.length < 1) {
    throw new FocusUnavailableError();
  }
  return { commandId, emittedEventIds };
}

export async function loadFocusWorkspaceV1(
  client: PandoSupabaseClient,
  query: Readonly<{ readinessGoalKey: string; activityKey: string | null }>,
): Promise<FocusWorkspaceV1> {
  if (
    !GOAL_KEY.test(query.readinessGoalKey) ||
    (query.activityKey !== null && !ACTIVITY_KEY.test(query.activityKey))
  ) {
    throw new FocusInputError();
  }
  const value = await rpc(client, GET_FOCUS_WORKSPACE_RPC_V1, {
    p_readiness_goal_key: query.readinessGoalKey,
    p_activity_key: query.activityKey,
  });
  try {
    const workspace = decodeFocusWorkspaceV1(value);
    if (
      workspace.readinessGoalKey !== query.readinessGoalKey ||
      (query.activityKey !== null &&
        workspace.activeSession === null &&
        workspace.activity?.activityKey !== query.activityKey)
    ) {
      throw new TypeError("Focus response does not match its selector");
    }
    return workspace;
  } catch (error) {
    if (error instanceof FocusInputError) throw error;
    throw new FocusUnavailableError();
  }
}

export async function startFocusActivityV1(
  client: PandoSupabaseClient,
  command: StartFocusCommandV1,
): Promise<FocusCommandResultV1> {
  if (
    !GOAL_KEY.test(command.readinessGoalKey) ||
    !ACTIVITY_KEY.test(command.activityKey) ||
    !Number.isSafeInteger(command.plannedMinutes) ||
    command.plannedMinutes < 1 ||
    command.plannedMinutes > 480 ||
    !validIdempotencyKey(command.idempotencyKey)
  ) {
    throw new FocusInputError();
  }
  const value = await rpc(client, START_FOCUS_ACTIVITY_RPC_V1, {
    p_readiness_goal_key: command.readinessGoalKey,
    p_activity_key: command.activityKey,
    p_planned_minutes: command.plannedMinutes,
    p_idempotency_key: command.idempotencyKey,
  });
  const response = asJsonObject(value, "Start Focus response");
  const base = commandBase(response);
  const focusSessionId = asString(response.focusSessionId);
  if (
    focusSessionId === undefined ||
    !UUID.test(focusSessionId) ||
    response.state !== "active" ||
    response.sessionVersion !== "1"
  ) {
    throw new FocusUnavailableError();
  }
  return {
    ...base,
    focusSessionId,
    state: "active",
    sessionVersion: "1",
  };
}

export async function finishFocusActivityV1(
  client: PandoSupabaseClient,
  command: FinishFocusCommandV1,
): Promise<FocusCommandResultV1> {
  const completionIsValid =
    command.terminalAction === "COMPLETE" &&
    command.resultKind !== null &&
    (FOCUS_RESULT_KINDS as readonly string[]).includes(command.resultKind) &&
    typeof command.usedHint === "boolean";
  const stopIsValid =
    command.terminalAction === "STOP" && command.resultKind === null && command.usedHint === null;
  if (
    !UUID.test(command.focusSessionId) ||
    command.expectedVersion !== 1 ||
    (!completionIsValid && !stopIsValid) ||
    !validIdempotencyKey(command.idempotencyKey)
  ) {
    throw new FocusInputError();
  }
  const value = await rpc(client, FINISH_FOCUS_ACTIVITY_RPC_V1, {
    p_focus_session_id: command.focusSessionId,
    p_expected_version: command.expectedVersion,
    p_terminal_action: command.terminalAction,
    p_result_kind: command.resultKind,
    p_used_hint: command.usedHint,
    p_idempotency_key: command.idempotencyKey,
  });
  const response = asJsonObject(value, "Finish Focus response");
  const base = commandBase(response);
  const focusSessionId = asString(response.focusSessionId);
  const state = asString(response.state);
  const evidenceId = response.evidenceId === null ? null : asString(response.evidenceId);
  const projectionState = asString(response.projectionState);
  if (
    focusSessionId !== command.focusSessionId ||
    (state !== "completed" && state !== "stopped") ||
    response.sessionVersion !== "2" ||
    (evidenceId !== null && (evidenceId === undefined || !UUID.test(evidenceId))) ||
    (projectionState !== "not_applicable" && projectionState !== "pending")
  ) {
    throw new FocusUnavailableError();
  }
  return {
    ...base,
    focusSessionId,
    state,
    sessionVersion: "2",
    evidenceId,
    projectionState,
  };
}

export async function invalidateEvidenceV1(
  client: PandoSupabaseClient,
  command: InvalidateEvidenceCommandV1,
): Promise<EvidenceInvalidationResultV1> {
  if (
    !UUID.test(command.evidenceId) ||
    command.reason.length < 1 ||
    command.reason.length > 500 ||
    command.reason.trim() !== command.reason ||
    !validIdempotencyKey(command.idempotencyKey)
  ) {
    throw new FocusInputError();
  }
  const value = await rpc(client, INVALIDATE_EVIDENCE_RPC_V1, {
    p_evidence_id: command.evidenceId,
    p_reason: command.reason,
    p_idempotency_key: command.idempotencyKey,
  });
  const response = asJsonObject(value, "Invalidate evidence response");
  const base = commandBase(response);
  const correctionId = asString(response.correctionId);
  const evidenceId = asString(response.evidenceId);
  const ledgerWatermark = asString(response.ledgerWatermark);
  if (
    correctionId === undefined ||
    !UUID.test(correctionId) ||
    evidenceId !== command.evidenceId ||
    ledgerWatermark === undefined ||
    !/^[1-9][0-9]{0,18}$/u.test(ledgerWatermark) ||
    response.projectionState !== "pending"
  ) {
    throw new FocusUnavailableError();
  }
  return {
    ...base,
    correctionId,
    evidenceId,
    ledgerWatermark,
    projectionState: "pending",
  };
}
