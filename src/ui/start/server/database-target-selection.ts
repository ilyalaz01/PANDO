import "server-only";

import { asArray, asJsonObject, asNumber, asString } from "../../../shared/contracts/json";
import type { PandoSupabaseClient } from "../../../shared/supabase/database";
import {
  decodeTargetSelectionSourceV1,
  type TargetSelectionReadinessGoalV1,
  type TargetSelectionSourceV1,
} from "./target-selection-source-v1";

export const TARGET_SELECTION_SOURCE_RPC_V1 = "get_target_selection_source_v1" as const;
export const BOOTSTRAP_PERSONAL_WORKSPACE_RPC = "bootstrap_personal_workspace" as const;
export const CREATE_READINESS_GOAL_RPC = "create_readiness_goal" as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const PROFILE_KEY = /^target:[a-z0-9][a-z0-9-]{1,100}$/u;
const GOAL_KEY = /^goal:[a-z0-9][a-z0-9-]{1,100}$/u;

export class TargetSelectionUnavailableError extends Error {
  constructor() {
    super("Target selection is unavailable for the current session.");
    this.name = "TargetSelectionUnavailableError";
  }
}

export class TargetSelectionInputError extends Error {
  constructor() {
    super("The selected target profile is invalid or unavailable.");
    this.name = "TargetSelectionInputError";
  }
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

async function callRpc<T>(
  operation: () => PromiseLike<{ data: T; error: unknown | null }>,
): Promise<T> {
  let result: { data: T; error: unknown | null };
  try {
    result = await operation();
  } catch {
    throw new TargetSelectionUnavailableError();
  }
  if (result.error !== null) throw new TargetSelectionUnavailableError();
  return result.data;
}

export async function loadTargetSelectionSourceV1(
  client: PandoSupabaseClient,
): Promise<TargetSelectionSourceV1> {
  const data = await callRpc(() => client.rpc(TARGET_SELECTION_SOURCE_RPC_V1));
  return decodeTargetSelectionSourceV1(data);
}

function bootstrapIdempotencyKey(subject: string): string {
  if (!UUID.test(subject)) throw new TargetSelectionUnavailableError();
  return `workspace-bootstrap-v1:${subject.toLowerCase()}`;
}

function validateBootstrapResponse(value: unknown): string {
  const response = asJsonObject(value, "Bootstrap personal workspace response");
  if (
    !exactKeys(response as unknown as Record<string, unknown>, [
      "command_id",
      "emitted_event_ids",
      "membership_role",
      "workspace_id",
      "workspace_name",
    ]) ||
    !UUID.test(asString(response.command_id) ?? "") ||
    !UUID.test(asString(response.workspace_id) ?? "") ||
    asString(response.workspace_name) !== "Personal workspace" ||
    asString(response.membership_role) !== "owner" ||
    !asArray(response.emitted_event_ids).every((eventId) => UUID.test(asString(eventId) ?? ""))
  ) {
    throw new TargetSelectionUnavailableError();
  }
  return asString(response.workspace_id)!;
}

export async function ensurePersonalWorkspace(
  client: PandoSupabaseClient,
  subject: string,
): Promise<TargetSelectionSourceV1> {
  const existing = await loadTargetSelectionSourceV1(client);
  if (existing.workspace !== null) return existing;

  const response = await callRpc(() =>
    client.rpc(BOOTSTRAP_PERSONAL_WORKSPACE_RPC, {
      p_idempotency_key: bootstrapIdempotencyKey(subject),
      p_workspace_name: "Personal workspace",
    }),
  );
  const workspaceId = validateBootstrapResponse(response);
  const reloaded = await loadTargetSelectionSourceV1(client);
  if (reloaded.workspace?.workspaceId !== workspaceId) {
    throw new TargetSelectionUnavailableError();
  }
  return reloaded;
}

export interface DerivedReadinessGoalCommand {
  readonly readinessGoalKey: string;
  readonly title: string;
  readonly profileVersionKey: string;
  readonly idempotencyKey: string;
}

export function deriveReadinessGoalCommand(
  profileVersionKey: string,
  title: string,
): DerivedReadinessGoalCommand {
  if (
    !PROFILE_KEY.test(profileVersionKey) ||
    title.length < 1 ||
    title.length > 160 ||
    title !== title.trim() ||
    /[\p{Cc}<>]/u.test(title)
  ) {
    throw new TargetSelectionInputError();
  }
  const suffix = profileVersionKey.slice("target:".length);
  const readinessGoalKey = `goal:${suffix}`;
  const idempotencyKey = `target-select-v1:${profileVersionKey}`;
  if (!GOAL_KEY.test(readinessGoalKey) || idempotencyKey.length > 128) {
    throw new TargetSelectionInputError();
  }
  return { readinessGoalKey, title, profileVersionKey, idempotencyKey };
}

function validateCreateGoalResponse(
  value: unknown,
  workspaceId: string,
  command: DerivedReadinessGoalCommand,
): void {
  const response = asJsonObject(value, "Create readiness goal response");
  if (
    !exactKeys(response as unknown as Record<string, unknown>, [
      "aggregateVersion",
      "commandId",
      "emittedEventIds",
      "profileVersionKey",
      "readinessGoalId",
      "readinessGoalKey",
      "workspaceId",
    ]) ||
    !UUID.test(asString(response.commandId) ?? "") ||
    !UUID.test(asString(response.readinessGoalId) ?? "") ||
    asString(response.workspaceId) !== workspaceId ||
    asString(response.readinessGoalKey) !== command.readinessGoalKey ||
    asString(response.profileVersionKey) !== command.profileVersionKey ||
    asNumber(response.aggregateVersion) !== 1 ||
    !asArray(response.emittedEventIds).every((eventId) => UUID.test(asString(eventId) ?? ""))
  ) {
    throw new TargetSelectionUnavailableError();
  }
}

export async function selectTargetProfile(
  client: PandoSupabaseClient,
  profileVersionKey: string,
): Promise<TargetSelectionReadinessGoalV1> {
  if (!PROFILE_KEY.test(profileVersionKey)) throw new TargetSelectionInputError();
  const source = await loadTargetSelectionSourceV1(client);
  const workspace = source.workspace;
  if (workspace === null) throw new TargetSelectionUnavailableError();
  const profile = source.profiles.find((item) => item.profileVersionKey === profileVersionKey);
  if (profile === undefined) throw new TargetSelectionInputError();
  const command = deriveReadinessGoalCommand(profile.profileVersionKey, profile.roleTitle);
  const existing = source.readinessGoals.find(
    (goal) =>
      goal.readinessGoalKey === command.readinessGoalKey &&
      goal.profileVersionKey === command.profileVersionKey,
  );
  if (existing !== undefined) {
    if (existing.lifecycle !== "active") throw new TargetSelectionInputError();
    return existing;
  }

  const response = await callRpc(() =>
    client.rpc(CREATE_READINESS_GOAL_RPC, {
      p_workspace_id: workspace.workspaceId,
      p_readiness_goal_key: command.readinessGoalKey,
      p_title: command.title,
      p_profile_version_key: command.profileVersionKey,
      p_idempotency_key: command.idempotencyKey,
    }),
  );
  validateCreateGoalResponse(response, workspace.workspaceId, command);

  const reloaded = await loadTargetSelectionSourceV1(client);
  const created = reloaded.readinessGoals.find(
    (goal) =>
      goal.readinessGoalKey === command.readinessGoalKey &&
      goal.profileVersionKey === command.profileVersionKey,
  );
  if (created === undefined) throw new TargetSelectionUnavailableError();
  return created;
}
