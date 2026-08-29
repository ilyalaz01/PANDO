import "server-only";

import { asArray, asJsonObject, asString } from "../../../shared/contracts/json";
import type { PandoSupabaseClient } from "../../../shared/supabase/database";
import { decodeTodayWorkspaceV1, type TodayWorkspaceV1 } from "./today-workspace-v1";

export const GET_TODAY_WORKSPACE_RPC_V1 = "get_today_workspace_v1" as const;
export const START_FOCUS_FROM_PLAN_RPC_V1 = "start_focus_from_plan_v1" as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SELECTION_REF =
  /^plan-action:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CANDIDATE_KEY = /^(?:candidate:[a-z0-9][a-z0-9-]{1,100}|active-focus:[0-9a-f-]{36})$/u;

export class TodayInputError extends Error {
  constructor() {
    super("The Today request is invalid.");
    this.name = "TodayInputError";
  }
}

export class TodayConflictError extends Error {
  constructor() {
    super("Today changed before this request completed.");
    this.name = "TodayConflictError";
  }
}

export class TodayUnavailableError extends Error {
  constructor() {
    super("Today is unavailable for the current session.");
    this.name = "TodayUnavailableError";
  }
}

export interface StartFocusFromPlanCommandV1 {
  readonly selectionRef: string;
  readonly idempotencyKey: string;
}

export interface StartFocusFromPlanResultV1 {
  readonly commandId: string;
  readonly focusSessionId: string;
  readonly activityAttemptId: string;
  readonly sessionVersion: "1";
  readonly state: "active";
  readonly startedAt: string;
  readonly planAttribution: {
    readonly planSnapshotId: string;
    readonly candidateKey: string;
    readonly trackId: string | null;
  };
  readonly emittedEventIds: readonly string[];
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
  if (code === "40001" || code === "23505") throw new TodayConflictError();
  if (code === "22023" || code === "22003" || code === "22P02") throw new TodayInputError();
  throw new TodayUnavailableError();
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isoTimestamp(value: string | undefined): value is string {
  return (
    value !== undefined && /^\d{4}-\d{2}-\d{2}T/u.test(value) && Number.isFinite(Date.parse(value))
  );
}

export async function loadTodayWorkspaceV1(client: PandoSupabaseClient): Promise<TodayWorkspaceV1> {
  let result: { data: unknown; error: unknown | null };
  try {
    result = await client.rpc(GET_TODAY_WORKSPACE_RPC_V1);
  } catch {
    throw new TodayUnavailableError();
  }
  if (result.error !== null) collapseRpcError(result.error);
  try {
    return decodeTodayWorkspaceV1(result.data);
  } catch {
    throw new TodayUnavailableError();
  }
}

export async function startFocusFromPlanV1(
  client: PandoSupabaseClient,
  command: StartFocusFromPlanCommandV1,
): Promise<StartFocusFromPlanResultV1> {
  if (!SELECTION_REF.test(command.selectionRef) || !validIdempotencyKey(command.idempotencyKey)) {
    throw new TodayInputError();
  }

  let result: { data: unknown; error: unknown | null };
  try {
    result = await client.rpc(START_FOCUS_FROM_PLAN_RPC_V1, {
      p_selection_ref: command.selectionRef,
      p_idempotency_key: command.idempotencyKey,
    });
  } catch {
    throw new TodayUnavailableError();
  }
  if (result.error !== null) collapseRpcError(result.error);

  try {
    const response = asJsonObject(result.data, "Start Focus from plan response");
    const attribution = asJsonObject(response.planAttribution, "planAttribution");
    const commandId = asString(response.commandId);
    const focusSessionId = asString(response.focusSessionId);
    const activityAttemptId = asString(response.activityAttemptId);
    const startedAt = asString(response.startedAt);
    const planSnapshotId = asString(attribution.planSnapshotId);
    const candidateKey = asString(attribution.candidateKey);
    const trackId = attribution.trackId === null ? null : asString(attribution.trackId);
    const emittedEventIds = asArray(response.emittedEventIds);
    if (
      !exactKeys(response, [
        "commandId",
        "focusSessionId",
        "activityAttemptId",
        "sessionVersion",
        "state",
        "startedAt",
        "planAttribution",
        "emittedEventIds",
      ]) ||
      !exactKeys(attribution, ["planSnapshotId", "candidateKey", "trackId"]) ||
      commandId === undefined ||
      !UUID.test(commandId) ||
      focusSessionId === undefined ||
      !UUID.test(focusSessionId) ||
      activityAttemptId === undefined ||
      !UUID.test(activityAttemptId) ||
      response.sessionVersion !== "1" ||
      response.state !== "active" ||
      !isoTimestamp(startedAt) ||
      planSnapshotId === undefined ||
      !UUID.test(planSnapshotId) ||
      candidateKey === undefined ||
      !CANDIDATE_KEY.test(candidateKey) ||
      (trackId !== null && (trackId === undefined || !UUID.test(trackId))) ||
      emittedEventIds.length < 1 ||
      emittedEventIds.length > 5 ||
      emittedEventIds.some((eventId) => typeof eventId !== "string" || !UUID.test(eventId)) ||
      new Set(emittedEventIds).size !== emittedEventIds.length
    ) {
      throw new TypeError("Start Focus from plan response is invalid");
    }
    return {
      commandId,
      focusSessionId,
      activityAttemptId,
      sessionVersion: "1",
      state: "active",
      startedAt,
      planAttribution: { planSnapshotId, candidateKey, trackId },
      emittedEventIds: emittedEventIds as string[],
    };
  } catch {
    throw new TodayUnavailableError();
  }
}
