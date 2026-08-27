import "server-only";

import { asArray, asJsonObject, asString } from "../../../shared/contracts/json";
import type { PandoSupabaseClient } from "../../../shared/supabase/database";
import {
  CUSTOM_ACTIVITY_TYPES,
  decodeCompetencyOverlayDetailV1,
  isCompetencyRef,
  isOverlayVersion,
  isReadinessGoalKey,
  type CompetencyOverlayDetailV1,
  type CustomActivityType,
} from "./competency-overlay-detail-v1";

export const CURRENT_COMPETENCY_OVERLAY_RPC_V1 = "get_current_competency_overlay_v1" as const;
export const SAVE_CURRENT_OVERLAY_NOTE_RPC_V1 = "save_current_overlay_note_v1" as const;
export const ADD_CURRENT_CUSTOM_ACTIVITY_RPC_V1 = "add_current_custom_activity_v1" as const;

const ACTIVITY_KEY = /^activity:[a-z0-9][a-z0-9-]{1,100}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export class CompetencyOverlayInputError extends Error {
  constructor() {
    super("The competency overlay change is invalid.");
    this.name = "CompetencyOverlayInputError";
  }
}

export class CompetencyOverlayConflictError extends Error {
  constructor() {
    super("The competency overlay changed before this request completed.");
    this.name = "CompetencyOverlayConflictError";
  }
}

export class CompetencyOverlayUnavailableError extends Error {
  constructor() {
    super("The competency overlay is unavailable for the current session.");
    this.name = "CompetencyOverlayUnavailableError";
  }
}

export interface SaveOverlayNoteCommandV1 {
  readonly readinessGoalKey: string;
  readonly competencyRef: string;
  readonly body: string;
  readonly expectedOverlayVersion: string;
  readonly idempotencyKey: string;
}

export interface AddCustomActivityCommandV1 {
  readonly readinessGoalKey: string;
  readonly competencyRef: string;
  readonly activityKey: string;
  readonly title: string;
  readonly activityType: CustomActivityType;
  readonly expectedOverlayVersion: string;
  readonly idempotencyKey: string;
}

export interface OverlayCommandResultV1 {
  readonly commandId: string;
  readonly overlayVersion: string;
  readonly emittedEventIds: readonly string[];
}

export interface SaveOverlayNoteResultV1 extends OverlayCommandResultV1 {
  readonly competencyRef: string;
  readonly operation: "created" | "updated";
}

export interface AddCustomActivityResultV1 extends OverlayCommandResultV1 {
  readonly activityKey: string;
  readonly targetCompetencyRef: string;
}

function input(value: {
  readinessGoalKey: string;
  competencyRef: string;
  expectedOverlayVersion?: string;
  idempotencyKey?: string;
}): void {
  if (!isReadinessGoalKey(value.readinessGoalKey) || !isCompetencyRef(value.competencyRef)) {
    throw new CompetencyOverlayInputError();
  }
  if (
    value.expectedOverlayVersion !== undefined &&
    !isOverlayVersion(value.expectedOverlayVersion)
  ) {
    throw new CompetencyOverlayInputError();
  }
  if (
    value.idempotencyKey !== undefined &&
    (value.idempotencyKey.length < 1 ||
      value.idempotencyKey.length > 128 ||
      value.idempotencyKey.trim() !== value.idempotencyKey)
  ) {
    throw new CompetencyOverlayInputError();
  }
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

function collapseRpcError(error: unknown): never {
  const code = errorCode(error);
  if (code === "40001" || code === "23505") throw new CompetencyOverlayConflictError();
  if (code === "22023" || code === "22003") throw new CompetencyOverlayInputError();
  throw new CompetencyOverlayUnavailableError();
}

async function rpc(
  client: PandoSupabaseClient,
  name:
    | typeof CURRENT_COMPETENCY_OVERLAY_RPC_V1
    | typeof SAVE_CURRENT_OVERLAY_NOTE_RPC_V1
    | typeof ADD_CURRENT_CUSTOM_ACTIVITY_RPC_V1,
  parameters: Record<string, string>,
): Promise<unknown> {
  let result: { data: unknown; error: unknown | null };
  try {
    result = (await client.rpc(name, parameters as never)) as {
      data: unknown;
      error: unknown | null;
    };
  } catch {
    throw new CompetencyOverlayUnavailableError();
  }
  if (result.error !== null) collapseRpcError(result.error);
  return result.data;
}

function commandBase(value: unknown): OverlayCommandResultV1 {
  const response = asJsonObject(value, "overlay command response");
  const commandId = asString(response.commandId);
  const overlayVersion = asString(response.overlayVersion);
  const emittedEventIds = asArray(response.emittedEventIds).flatMap((item) =>
    typeof item === "string" ? [item] : [],
  );
  if (
    commandId === undefined ||
    !UUID.test(commandId) ||
    overlayVersion === undefined ||
    !isOverlayVersion(overlayVersion) ||
    emittedEventIds.length !== 1 ||
    !UUID.test(emittedEventIds[0]!)
  ) {
    throw new CompetencyOverlayUnavailableError();
  }
  return { commandId, overlayVersion, emittedEventIds };
}

export async function loadCurrentCompetencyOverlayV1(
  client: PandoSupabaseClient,
  query: Readonly<{ readinessGoalKey: string; competencyRef: string }>,
): Promise<CompetencyOverlayDetailV1> {
  input(query);
  const value = await rpc(client, CURRENT_COMPETENCY_OVERLAY_RPC_V1, {
    p_readiness_goal_key: query.readinessGoalKey,
    p_competency_ref: query.competencyRef,
  });
  try {
    const detail = decodeCompetencyOverlayDetailV1(value);
    if (
      detail.readinessGoalKey !== query.readinessGoalKey ||
      detail.competencyRef !== query.competencyRef
    ) {
      throw new TypeError("Overlay response does not match the authorized selector");
    }
    return detail;
  } catch {
    throw new CompetencyOverlayUnavailableError();
  }
}

export async function saveCurrentOverlayNoteV1(
  client: PandoSupabaseClient,
  command: SaveOverlayNoteCommandV1,
): Promise<SaveOverlayNoteResultV1> {
  input(command);
  if (
    command.body.length < 1 ||
    command.body.length > 10_000 ||
    command.body.trim() !== command.body
  ) {
    throw new CompetencyOverlayInputError();
  }
  const value = await rpc(client, SAVE_CURRENT_OVERLAY_NOTE_RPC_V1, {
    p_readiness_goal_key: command.readinessGoalKey,
    p_competency_ref: command.competencyRef,
    p_note_body: command.body,
    p_expected_overlay_version: command.expectedOverlayVersion,
    p_idempotency_key: command.idempotencyKey,
  });
  try {
    const response = asJsonObject(value, "save note response");
    const base = commandBase(response);
    const competencyRef = asString(response.competencyRef);
    const operation = asString(response.operation);
    if (
      competencyRef !== command.competencyRef ||
      (operation !== "created" && operation !== "updated")
    ) {
      throw new TypeError("Save note response does not match the command");
    }
    return { ...base, competencyRef, operation };
  } catch (error) {
    if (error instanceof CompetencyOverlayUnavailableError) throw error;
    throw new CompetencyOverlayUnavailableError();
  }
}

export async function addCurrentCustomActivityV1(
  client: PandoSupabaseClient,
  command: AddCustomActivityCommandV1,
): Promise<AddCustomActivityResultV1> {
  input(command);
  if (
    !ACTIVITY_KEY.test(command.activityKey) ||
    command.title.length < 1 ||
    command.title.length > 200 ||
    command.title.trim() !== command.title ||
    !(CUSTOM_ACTIVITY_TYPES as readonly string[]).includes(command.activityType)
  ) {
    throw new CompetencyOverlayInputError();
  }
  const value = await rpc(client, ADD_CURRENT_CUSTOM_ACTIVITY_RPC_V1, {
    p_readiness_goal_key: command.readinessGoalKey,
    p_activity_key: command.activityKey,
    p_title: command.title,
    p_activity_type: command.activityType,
    p_target_competency_ref: command.competencyRef,
    p_expected_overlay_version: command.expectedOverlayVersion,
    p_idempotency_key: command.idempotencyKey,
  });
  try {
    const response = asJsonObject(value, "add activity response");
    const base = commandBase(response);
    const activityKey = asString(response.activityKey);
    const targetCompetencyRef = asString(response.targetCompetencyRef);
    if (activityKey !== command.activityKey || targetCompetencyRef !== command.competencyRef) {
      throw new TypeError("Add activity response does not match the command");
    }
    return { ...base, activityKey, targetCompetencyRef };
  } catch (error) {
    if (error instanceof CompetencyOverlayUnavailableError) throw error;
    throw new CompetencyOverlayUnavailableError();
  }
}
