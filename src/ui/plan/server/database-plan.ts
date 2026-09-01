import "server-only";

import type { PandoSupabaseClient } from "../../../shared/supabase/database";
import {
  decodeCurrentGrowthPlanV1,
  decodeGrowthPlanCapacityApplyResultV1,
  decodeGrowthPlanCapacityPreviewV1,
  decodeGrowthPlanLifecycleApplyResultV1,
  decodeGrowthPlanLifecyclePreviewV1,
  decodeCurrentLearningTracksV1,
  decodeLearningTrackLifecycleApplyResultV1,
  decodeLearningTrackLifecyclePreviewV1,
  type CurrentLearningTracksV1,
  type CurrentGrowthPlanV1,
  type GrowthPlanCapacityApplyResultV1,
  type GrowthPlanCapacityPreviewV1,
  type GrowthPlanLifecycleApplyResultV1,
  type GrowthPlanLifecycleOperationV1,
  type GrowthPlanLifecyclePreviewV1,
  type LearningTrackLifecycleApplyResultV1,
  type LearningTrackLifecycleOperationV1,
  type LearningTrackLifecyclePreviewV1,
} from "./plan-workspace-v1";

export const GET_CURRENT_GROWTH_PLAN_RPC_V1 = "get_current_growth_plan_v1" as const;
export const PREVIEW_GROWTH_PLAN_LIFECYCLE_RPC_V1 = "preview_growth_plan_lifecycle_v1" as const;
export const APPLY_GROWTH_PLAN_LIFECYCLE_RPC_V1 = "apply_growth_plan_lifecycle_v1" as const;
export const PREVIEW_GROWTH_PLAN_CAPACITY_RPC_V1 = "preview_growth_plan_capacity_v1" as const;
export const APPLY_GROWTH_PLAN_CAPACITY_RPC_V1 = "apply_growth_plan_capacity_v1" as const;
export const GET_CURRENT_LEARNING_TRACKS_RPC_V1 = "get_current_learning_tracks_v1" as const;
export const PREVIEW_LEARNING_TRACK_LIFECYCLE_RPC_V1 =
  "preview_learning_track_lifecycle_v1" as const;
export const APPLY_LEARNING_TRACK_LIFECYCLE_RPC_V1 = "apply_learning_track_lifecycle_v1" as const;

const POSITIVE_BIGINT = /^(?:[1-9][0-9]{0,18})$/u;
const SHA_256_HEX = /^[a-f0-9]{64}$/u;
const CONTROL_CHARACTER = /[\p{Cc}]/u;
const MAX_POSTGRES_BIGINT = BigInt("9223372036854775807");
const TRACK_KEY = /^track:[a-z0-9][a-z0-9-]{1,100}$/u;

export class PlanInputError extends Error {
  constructor() {
    super("The Plan request is invalid.");
    this.name = "PlanInputError";
  }
}

export class PlanConflictError extends Error {
  constructor() {
    super("Plan changed before this request completed.");
    this.name = "PlanConflictError";
  }
}

export class PlanUnavailableError extends Error {
  constructor() {
    super("Plan is unavailable for the current session.");
    this.name = "PlanUnavailableError";
  }
}

export interface GrowthPlanLifecyclePreviewCommandV1 {
  readonly operation: GrowthPlanLifecycleOperationV1;
  readonly expectedGrowthPlanVersion: string;
  readonly reason: string;
}

export interface GrowthPlanLifecycleApplyCommandV1 extends GrowthPlanLifecyclePreviewCommandV1 {
  readonly previewDigest: string;
  readonly idempotencyKey: string;
}

export interface GrowthPlanCapacityPreviewCommandV1 {
  readonly proposedWeeklyCapacityMinutes: number;
  readonly expectedGrowthPlanVersion: string;
  readonly reason: string;
}

export interface GrowthPlanCapacityApplyCommandV1 extends GrowthPlanCapacityPreviewCommandV1 {
  readonly previewDigest: string;
  readonly idempotencyKey: string;
}

export interface LearningTrackLifecyclePreviewCommandV1 {
  readonly trackKey: string;
  readonly operation: LearningTrackLifecycleOperationV1;
  readonly expectedGrowthPlanVersion: string;
  readonly expectedLearningTrackVersion: string;
  readonly reason: string;
}

export interface LearningTrackLifecycleApplyCommandV1 extends LearningTrackLifecyclePreviewCommandV1 {
  readonly previewDigest: string;
  readonly idempotencyKey: string;
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

function collapseRpcError(error: unknown): never {
  const code = errorCode(error);
  if (code === "40001" || code === "23505") throw new PlanConflictError();
  if (code === "22023" || code === "22003" || code === "22P02") throw new PlanInputError();
  throw new PlanUnavailableError();
}

function validVersion(value: string): boolean {
  if (!POSITIVE_BIGINT.test(value)) return false;
  try {
    return BigInt(value) <= MAX_POSTGRES_BIGINT;
  } catch {
    return false;
  }
}

function validReason(value: string): boolean {
  return (
    value.length >= 1 &&
    value.length <= 500 &&
    value.trim() === value &&
    !CONTROL_CHARACTER.test(value)
  );
}

function validOperation(value: string): value is GrowthPlanLifecycleOperationV1 {
  return value === "pause_growth_plan" || value === "resume_growth_plan";
}

function validIdempotencyKey(value: string): boolean {
  return (
    value.length >= 1 &&
    value.length <= 128 &&
    value.trim() === value &&
    !CONTROL_CHARACTER.test(value)
  );
}

function validPreview(command: GrowthPlanLifecyclePreviewCommandV1): boolean {
  return (
    validOperation(command.operation) &&
    validVersion(command.expectedGrowthPlanVersion) &&
    validReason(command.reason)
  );
}

function validCapacityPreview(command: GrowthPlanCapacityPreviewCommandV1): boolean {
  return (
    Number.isInteger(command.proposedWeeklyCapacityMinutes) &&
    command.proposedWeeklyCapacityMinutes >= 0 &&
    command.proposedWeeklyCapacityMinutes <= 10_080 &&
    validVersion(command.expectedGrowthPlanVersion) &&
    validReason(command.reason)
  );
}

function validTrackOperation(value: string): value is LearningTrackLifecycleOperationV1 {
  return value === "pause_track" || value === "resume_track";
}

function validTrackPreview(command: LearningTrackLifecyclePreviewCommandV1): boolean {
  return (
    TRACK_KEY.test(command.trackKey) &&
    validTrackOperation(command.operation) &&
    validVersion(command.expectedGrowthPlanVersion) &&
    validVersion(command.expectedLearningTrackVersion) &&
    validReason(command.reason)
  );
}

async function rpc(
  client: PandoSupabaseClient,
  name:
    | typeof GET_CURRENT_GROWTH_PLAN_RPC_V1
    | typeof PREVIEW_GROWTH_PLAN_LIFECYCLE_RPC_V1
    | typeof APPLY_GROWTH_PLAN_LIFECYCLE_RPC_V1
    | typeof PREVIEW_GROWTH_PLAN_CAPACITY_RPC_V1
    | typeof APPLY_GROWTH_PLAN_CAPACITY_RPC_V1
    | typeof GET_CURRENT_LEARNING_TRACKS_RPC_V1
    | typeof PREVIEW_LEARNING_TRACK_LIFECYCLE_RPC_V1
    | typeof APPLY_LEARNING_TRACK_LIFECYCLE_RPC_V1,
  parameters?: Record<string, string | number>,
): Promise<unknown> {
  let result: { data: unknown; error: unknown | null };
  try {
    result = (
      parameters === undefined
        ? await client.rpc(name as never)
        : await client.rpc(name as never, parameters as never)
    ) as {
      data: unknown;
      error: unknown | null;
    };
  } catch {
    throw new PlanUnavailableError();
  }
  if (result.error !== null) collapseRpcError(result.error);
  return result.data;
}

/** Loads only the session-resolved current Growth Plan; callers cannot select a workspace or plan. */
export async function loadCurrentGrowthPlanV1(
  client: PandoSupabaseClient,
): Promise<CurrentGrowthPlanV1> {
  try {
    return decodeCurrentGrowthPlanV1(await rpc(client, GET_CURRENT_GROWTH_PLAN_RPC_V1));
  } catch (error) {
    if (
      error instanceof PlanInputError ||
      error instanceof PlanConflictError ||
      error instanceof PlanUnavailableError
    ) {
      throw error;
    }
    throw new PlanUnavailableError();
  }
}

/** Builds an exact, side-effect-free owner preview. The server resolves all aggregate identity. */
export async function previewGrowthPlanLifecycleV1(
  client: PandoSupabaseClient,
  command: GrowthPlanLifecyclePreviewCommandV1,
): Promise<GrowthPlanLifecyclePreviewV1> {
  if (!validPreview(command)) throw new PlanInputError();
  try {
    return decodeGrowthPlanLifecyclePreviewV1(
      await rpc(client, PREVIEW_GROWTH_PLAN_LIFECYCLE_RPC_V1, {
        p_operation: command.operation,
        p_expected_growth_plan_version: command.expectedGrowthPlanVersion,
        p_reason: command.reason,
      }),
    );
  } catch (error) {
    if (
      error instanceof PlanInputError ||
      error instanceof PlanConflictError ||
      error instanceof PlanUnavailableError
    ) {
      throw error;
    }
    throw new PlanUnavailableError();
  }
}

/** Applies only a previously shown, exact preview through the owning Planning command. */
export async function applyGrowthPlanLifecycleV1(
  client: PandoSupabaseClient,
  command: GrowthPlanLifecycleApplyCommandV1,
): Promise<GrowthPlanLifecycleApplyResultV1> {
  if (
    !validPreview(command) ||
    !SHA_256_HEX.test(command.previewDigest) ||
    !validIdempotencyKey(command.idempotencyKey)
  ) {
    throw new PlanInputError();
  }
  try {
    return decodeGrowthPlanLifecycleApplyResultV1(
      await rpc(client, APPLY_GROWTH_PLAN_LIFECYCLE_RPC_V1, {
        p_operation: command.operation,
        p_expected_growth_plan_version: command.expectedGrowthPlanVersion,
        p_preview_digest: command.previewDigest,
        p_reason: command.reason,
        p_idempotency_key: command.idempotencyKey,
      }),
    );
  } catch (error) {
    if (
      error instanceof PlanInputError ||
      error instanceof PlanConflictError ||
      error instanceof PlanUnavailableError
    ) {
      throw error;
    }
    throw new PlanUnavailableError();
  }
}

/** Builds an exact capacity preview while Planning resolves every constraint input. */
export async function previewGrowthPlanCapacityV1(
  client: PandoSupabaseClient,
  command: GrowthPlanCapacityPreviewCommandV1,
): Promise<GrowthPlanCapacityPreviewV1> {
  if (!validCapacityPreview(command)) throw new PlanInputError();
  try {
    return decodeGrowthPlanCapacityPreviewV1(
      await rpc(client, PREVIEW_GROWTH_PLAN_CAPACITY_RPC_V1, {
        p_proposed_weekly_capacity_minutes: command.proposedWeeklyCapacityMinutes,
        p_expected_growth_plan_version: command.expectedGrowthPlanVersion,
        p_reason: command.reason,
      }),
    );
  } catch (error) {
    if (
      error instanceof PlanInputError ||
      error instanceof PlanConflictError ||
      error instanceof PlanUnavailableError
    ) {
      throw error;
    }
    throw new PlanUnavailableError();
  }
}

/** Applies only an applicable capacity preview through the Planning-owned transaction. */
export async function applyGrowthPlanCapacityV1(
  client: PandoSupabaseClient,
  command: GrowthPlanCapacityApplyCommandV1,
): Promise<GrowthPlanCapacityApplyResultV1> {
  if (
    !validCapacityPreview(command) ||
    !SHA_256_HEX.test(command.previewDigest) ||
    !validIdempotencyKey(command.idempotencyKey)
  ) {
    throw new PlanInputError();
  }
  try {
    return decodeGrowthPlanCapacityApplyResultV1(
      await rpc(client, APPLY_GROWTH_PLAN_CAPACITY_RPC_V1, {
        p_proposed_weekly_capacity_minutes: command.proposedWeeklyCapacityMinutes,
        p_expected_growth_plan_version: command.expectedGrowthPlanVersion,
        p_preview_digest: command.previewDigest,
        p_reason: command.reason,
        p_idempotency_key: command.idempotencyKey,
      }),
    );
  } catch (error) {
    if (
      error instanceof PlanInputError ||
      error instanceof PlanConflictError ||
      error instanceof PlanUnavailableError
    ) {
      throw error;
    }
    throw new PlanUnavailableError();
  }
}

/** Loads current nonterminal Tracks without accepting caller-selected Planning authority. */
export async function loadCurrentLearningTracksV1(
  client: PandoSupabaseClient,
): Promise<CurrentLearningTracksV1> {
  try {
    return decodeCurrentLearningTracksV1(await rpc(client, GET_CURRENT_LEARNING_TRACKS_RPC_V1));
  } catch (error) {
    if (
      error instanceof PlanInputError ||
      error instanceof PlanConflictError ||
      error instanceof PlanUnavailableError
    ) {
      throw error;
    }
    throw new PlanUnavailableError();
  }
}

/** Builds an exact Track lifecycle preview while Planning resolves owner and aggregate identity. */
export async function previewLearningTrackLifecycleV1(
  client: PandoSupabaseClient,
  command: LearningTrackLifecyclePreviewCommandV1,
): Promise<LearningTrackLifecyclePreviewV1> {
  if (!validTrackPreview(command)) throw new PlanInputError();
  try {
    return decodeLearningTrackLifecyclePreviewV1(
      await rpc(client, PREVIEW_LEARNING_TRACK_LIFECYCLE_RPC_V1, {
        p_track_key: command.trackKey,
        p_operation: command.operation,
        p_expected_growth_plan_version: command.expectedGrowthPlanVersion,
        p_expected_learning_track_version: command.expectedLearningTrackVersion,
        p_reason: command.reason,
      }),
    );
  } catch (error) {
    if (
      error instanceof PlanInputError ||
      error instanceof PlanConflictError ||
      error instanceof PlanUnavailableError
    ) {
      throw error;
    }
    throw new PlanUnavailableError();
  }
}

/** Applies only a still-current, applicable Track lifecycle preview. */
export async function applyLearningTrackLifecycleV1(
  client: PandoSupabaseClient,
  command: LearningTrackLifecycleApplyCommandV1,
): Promise<LearningTrackLifecycleApplyResultV1> {
  if (
    !validTrackPreview(command) ||
    !SHA_256_HEX.test(command.previewDigest) ||
    !validIdempotencyKey(command.idempotencyKey)
  ) {
    throw new PlanInputError();
  }
  try {
    return decodeLearningTrackLifecycleApplyResultV1(
      await rpc(client, APPLY_LEARNING_TRACK_LIFECYCLE_RPC_V1, {
        p_track_key: command.trackKey,
        p_operation: command.operation,
        p_expected_growth_plan_version: command.expectedGrowthPlanVersion,
        p_expected_learning_track_version: command.expectedLearningTrackVersion,
        p_preview_digest: command.previewDigest,
        p_reason: command.reason,
        p_idempotency_key: command.idempotencyKey,
      }),
    );
  } catch (error) {
    if (
      error instanceof PlanInputError ||
      error instanceof PlanConflictError ||
      error instanceof PlanUnavailableError
    ) {
      throw error;
    }
    throw new PlanUnavailableError();
  }
}
