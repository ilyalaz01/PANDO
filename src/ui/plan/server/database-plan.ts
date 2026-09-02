import "server-only";

import type { PandoSupabaseClient } from "../../../shared/supabase/database";
import {
  decodeCurrentGrowthPlanV1,
  decodeGrowthPlanInitializationApplyResultV1,
  decodeGrowthPlanInitializationPreviewV1,
  decodeGrowthPlanSetupSourceV1,
  decodeLearningTrackCreationApplyResultV1,
  decodeLearningTrackCreationPreviewV1,
  decodeLearningTrackCreationSourceV1,
  decodeLearningTrackActivityAdmissionApplyResultV1,
  decodeLearningTrackActivityAdmissionApplyResultV2,
  decodeLearningTrackActivityAdmissionPreviewV1,
  decodeLearningTrackActivityAdmissionPreviewV2,
  decodeLearningTrackActivityAdmissionSourceV1,
  decodeLearningTrackActivityAdmissionSourceV2,
  decodeGrowthPlanCapacityApplyResultV1,
  decodeGrowthPlanCapacityPreviewV1,
  decodeGrowthPlanLifecycleApplyResultV1,
  decodeGrowthPlanLifecyclePreviewV1,
  decodeCurrentLearningTracksV1,
  decodeLearningTrackLifecycleApplyResultV1,
  decodeLearningTrackLifecyclePreviewV1,
  decodeLearningTrackPriorityMinimumApplyResultV1,
  decodeLearningTrackPriorityMinimumPreviewV1,
  type CurrentLearningTracksV1,
  type CurrentGrowthPlanV1,
  type GrowthPlanCapacityApplyResultV1,
  type GrowthPlanCapacityPreviewV1,
  type GrowthPlanInitializationApplyResultV1,
  type GrowthPlanInitializationPreviewV1,
  type GrowthPlanSetupSourceV1,
  type LearningTrackCreationApplyResultV1,
  type LearningTrackCreationPreviewV1,
  type LearningTrackCreationSourceV1,
  type GrowthPlanLifecycleApplyResultV1,
  type GrowthPlanLifecycleOperationV1,
  type GrowthPlanLifecyclePreviewV1,
  type LearningTrackActivityAdmissionApplyResultV1,
  type LearningTrackActivityAdmissionApplyResultV2,
  type LearningTrackActivityAdmissionPreviewV1,
  type LearningTrackActivityAdmissionPreviewV2,
  type LearningTrackActivityAdmissionSourceV1,
  type LearningTrackActivityAdmissionSourceV2,
  type LearningTrackLifecycleApplyResultV1,
  type LearningTrackLifecycleOperationV1,
  type LearningTrackLifecyclePreviewV1,
  type LearningTrackPriorityMinimumApplyResultV1,
  type LearningTrackPriorityMinimumPreviewV1,
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
export const PREVIEW_LEARNING_TRACK_PRIORITY_MINIMUM_RPC_V1 =
  "preview_learning_track_priority_minimum_v1" as const;
export const APPLY_LEARNING_TRACK_PRIORITY_MINIMUM_RPC_V1 =
  "apply_learning_track_priority_minimum_v1" as const;
export const GET_GROWTH_PLAN_SETUP_SOURCE_RPC_V1 = "get_growth_plan_setup_source_v1" as const;
export const PREVIEW_GROWTH_PLAN_INITIALIZATION_RPC_V1 =
  "preview_growth_plan_initialization_v1" as const;
export const APPLY_GROWTH_PLAN_INITIALIZATION_RPC_V1 =
  "apply_growth_plan_initialization_v1" as const;
export const GET_LEARNING_TRACK_CREATION_SOURCE_RPC_V1 =
  "get_learning_track_creation_source_v1" as const;
export const PREVIEW_LEARNING_TRACK_CREATION_RPC_V1 = "preview_learning_track_creation_v1" as const;
export const APPLY_LEARNING_TRACK_CREATION_RPC_V1 = "apply_learning_track_creation_v1" as const;
export const GET_LEARNING_TRACK_ACTIVITY_ADMISSION_SOURCE_RPC_V1 =
  "get_learning_track_activity_admission_source_v1" as const;
export const GET_LEARNING_TRACK_ACTIVITY_ADMISSION_SOURCE_RPC_V2 =
  "get_learning_track_activity_admission_source_v2" as const;
export const PREVIEW_LEARNING_TRACK_ACTIVITY_ADMISSION_RPC_V1 =
  "preview_learning_track_activity_admission_v1" as const;
export const PREVIEW_LEARNING_TRACK_ACTIVITY_ADMISSION_RPC_V2 =
  "preview_learning_track_activity_admission_v2" as const;
export const APPLY_LEARNING_TRACK_ACTIVITY_ADMISSION_RPC_V1 =
  "apply_learning_track_activity_admission_v1" as const;
export const APPLY_LEARNING_TRACK_ACTIVITY_ADMISSION_RPC_V2 =
  "apply_learning_track_activity_admission_v2" as const;

const POSITIVE_BIGINT = /^(?:[1-9][0-9]{0,18})$/u;
const SHA_256_HEX = /^[a-f0-9]{64}$/u;
const CONTROL_CHARACTER = /[\p{Cc}]/u;
const MAX_POSTGRES_BIGINT = BigInt("9223372036854775807");
const TRACK_KEY = /^track:[a-z0-9][a-z0-9-]{1,100}$/u;
const ACTIVITY_KEY = /^activity:[a-z0-9][a-z0-9-]{1,100}$/u;
const GOAL_KEY = /^goal:[a-z0-9][a-z0-9-]{1,100}$/u;
const LOWERCASE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

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

export interface LearningTrackPriorityMinimumPreviewCommandV1 {
  readonly trackKey: string;
  readonly priority: number;
  readonly protectedMinimumMinutes: number;
  readonly expectedGrowthPlanVersion: string;
  readonly expectedLearningTrackVersion: string;
  readonly reason: string;
}

export interface LearningTrackPriorityMinimumApplyCommandV1 extends LearningTrackPriorityMinimumPreviewCommandV1 {
  readonly previewDigest: string;
  readonly idempotencyKey: string;
}

export interface GrowthPlanInitializationPreviewCommandV1 {
  readonly readinessGoalKey: string;
  readonly expectedReadinessGoalVersion: string;
  readonly weeklyCapacityMinutes: number;
  readonly defaultSessionMinutes: number;
  readonly trackPriority: number;
  readonly reason: string;
  readonly idempotencyKey: string;
}

export interface GrowthPlanInitializationApplyCommandV1 extends GrowthPlanInitializationPreviewCommandV1 {
  readonly previewDigest: string;
}

export interface LearningTrackCreationPreviewCommandV1 {
  readonly readinessGoalKey: string;
  readonly expectedReadinessGoalVersion: string;
  readonly title: string;
  readonly priority: number;
  readonly defaultSessionMinutes: number;
  readonly expectedGrowthPlanVersion: string;
  readonly reason: string;
  readonly requestId: string;
}

export interface LearningTrackCreationApplyCommandV1 extends LearningTrackCreationPreviewCommandV1 {
  readonly previewDigest: string;
}

export interface LearningTrackActivityAdmissionPreviewCommandV1 {
  readonly activityKey: string;
  readonly estimatedMinutes: number;
  readonly energy: "LOW" | "MEDIUM" | "HIGH" | null;
  readonly expectedGrowthPlanVersion: string;
  readonly expectedLearningTrackVersion: string;
  readonly reason: string;
  readonly requestId: string;
}

export interface LearningTrackActivityAdmissionApplyCommandV1 extends LearningTrackActivityAdmissionPreviewCommandV1 {
  readonly previewDigest: string;
}

export interface LearningTrackActivityAdmissionPreviewCommandV2 extends LearningTrackActivityAdmissionPreviewCommandV1 {
  readonly trackKey: string;
}

export interface LearningTrackActivityAdmissionApplyCommandV2 extends LearningTrackActivityAdmissionPreviewCommandV2 {
  readonly previewDigest: string;
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
    Array.from(value).length >= 1 &&
    Array.from(value).length <= 500 &&
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

function validTrackPriorityMinimumPreview(
  command: LearningTrackPriorityMinimumPreviewCommandV1,
): boolean {
  return (
    TRACK_KEY.test(command.trackKey) &&
    Number.isInteger(command.priority) &&
    command.priority >= 0 &&
    command.priority <= 100 &&
    Number.isInteger(command.protectedMinimumMinutes) &&
    command.protectedMinimumMinutes >= 0 &&
    command.protectedMinimumMinutes <= 10_080 &&
    validVersion(command.expectedGrowthPlanVersion) &&
    validVersion(command.expectedLearningTrackVersion) &&
    validReason(command.reason)
  );
}

function validInitializationPreview(command: GrowthPlanInitializationPreviewCommandV1): boolean {
  return (
    GOAL_KEY.test(command.readinessGoalKey) &&
    validVersion(command.expectedReadinessGoalVersion) &&
    Number.isInteger(command.weeklyCapacityMinutes) &&
    command.weeklyCapacityMinutes >= 0 &&
    command.weeklyCapacityMinutes <= 10_080 &&
    Number.isInteger(command.defaultSessionMinutes) &&
    command.defaultSessionMinutes >= 1 &&
    command.defaultSessionMinutes <= 480 &&
    Number.isInteger(command.trackPriority) &&
    command.trackPriority >= 0 &&
    command.trackPriority <= 100 &&
    validReason(command.reason) &&
    LOWERCASE_UUID.test(command.idempotencyKey)
  );
}

function validTrackTitle(value: string): boolean {
  return (
    Array.from(value).length >= 1 &&
    Array.from(value).length <= 160 &&
    value.trim() === value &&
    !CONTROL_CHARACTER.test(value)
  );
}

function validLearningTrackCreationPreview(
  command: LearningTrackCreationPreviewCommandV1,
): boolean {
  return (
    GOAL_KEY.test(command.readinessGoalKey) &&
    validVersion(command.expectedReadinessGoalVersion) &&
    validTrackTitle(command.title) &&
    Number.isInteger(command.priority) &&
    command.priority >= 0 &&
    command.priority <= 100 &&
    Number.isInteger(command.defaultSessionMinutes) &&
    command.defaultSessionMinutes >= 1 &&
    command.defaultSessionMinutes <= 480 &&
    validVersion(command.expectedGrowthPlanVersion) &&
    validReason(command.reason) &&
    LOWERCASE_UUID.test(command.requestId)
  );
}

function validActivityAdmissionPreview(
  command: LearningTrackActivityAdmissionPreviewCommandV1,
): boolean {
  return (
    ACTIVITY_KEY.test(command.activityKey) &&
    Number.isInteger(command.estimatedMinutes) &&
    command.estimatedMinutes >= 1 &&
    command.estimatedMinutes <= 480 &&
    (command.energy === null || ["LOW", "MEDIUM", "HIGH"].includes(command.energy)) &&
    validVersion(command.expectedGrowthPlanVersion) &&
    validVersion(command.expectedLearningTrackVersion) &&
    validReason(command.reason) &&
    LOWERCASE_UUID.test(command.requestId)
  );
}

function validActivityAdmissionPreviewV2(
  command: LearningTrackActivityAdmissionPreviewCommandV2,
): boolean {
  return TRACK_KEY.test(command.trackKey) && validActivityAdmissionPreview(command);
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
    | typeof APPLY_LEARNING_TRACK_LIFECYCLE_RPC_V1
    | typeof PREVIEW_LEARNING_TRACK_PRIORITY_MINIMUM_RPC_V1
    | typeof APPLY_LEARNING_TRACK_PRIORITY_MINIMUM_RPC_V1
    | typeof GET_GROWTH_PLAN_SETUP_SOURCE_RPC_V1
    | typeof PREVIEW_GROWTH_PLAN_INITIALIZATION_RPC_V1
    | typeof APPLY_GROWTH_PLAN_INITIALIZATION_RPC_V1
    | typeof GET_LEARNING_TRACK_CREATION_SOURCE_RPC_V1
    | typeof PREVIEW_LEARNING_TRACK_CREATION_RPC_V1
    | typeof APPLY_LEARNING_TRACK_CREATION_RPC_V1
    | typeof GET_LEARNING_TRACK_ACTIVITY_ADMISSION_SOURCE_RPC_V1
    | typeof GET_LEARNING_TRACK_ACTIVITY_ADMISSION_SOURCE_RPC_V2
    | typeof PREVIEW_LEARNING_TRACK_ACTIVITY_ADMISSION_RPC_V1
    | typeof PREVIEW_LEARNING_TRACK_ACTIVITY_ADMISSION_RPC_V2
    | typeof APPLY_LEARNING_TRACK_ACTIVITY_ADMISSION_RPC_V1
    | typeof APPLY_LEARNING_TRACK_ACTIVITY_ADMISSION_RPC_V2,
  parameters?: Record<string, string | number | null>,
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

/** Builds an exact priority/minimum preview while Planning resolves every authority-bearing input. */
export async function previewLearningTrackPriorityMinimumV1(
  client: PandoSupabaseClient,
  command: LearningTrackPriorityMinimumPreviewCommandV1,
): Promise<LearningTrackPriorityMinimumPreviewV1> {
  if (!validTrackPriorityMinimumPreview(command)) throw new PlanInputError();
  try {
    return decodeLearningTrackPriorityMinimumPreviewV1(
      await rpc(client, PREVIEW_LEARNING_TRACK_PRIORITY_MINIMUM_RPC_V1, {
        p_track_key: command.trackKey,
        p_priority: command.priority,
        p_protected_minimum_minutes: command.protectedMinimumMinutes,
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

/** Applies one exact, current Track priority/minimum preview through Planning's atomic command. */
export async function applyLearningTrackPriorityMinimumV1(
  client: PandoSupabaseClient,
  command: LearningTrackPriorityMinimumApplyCommandV1,
): Promise<LearningTrackPriorityMinimumApplyResultV1> {
  if (
    !validTrackPriorityMinimumPreview(command) ||
    !SHA_256_HEX.test(command.previewDigest) ||
    !validIdempotencyKey(command.idempotencyKey)
  ) {
    throw new PlanInputError();
  }
  try {
    return decodeLearningTrackPriorityMinimumApplyResultV1(
      await rpc(client, APPLY_LEARNING_TRACK_PRIORITY_MINIMUM_RPC_V1, {
        p_track_key: command.trackKey,
        p_priority: command.priority,
        p_protected_minimum_minutes: command.protectedMinimumMinutes,
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

/** Loads the session-resolved, capability-bounded selector for the first Growth Plan. */
export async function loadGrowthPlanSetupSourceV1(
  client: PandoSupabaseClient,
): Promise<GrowthPlanSetupSourceV1> {
  try {
    return decodeGrowthPlanSetupSourceV1(await rpc(client, GET_GROWTH_PLAN_SETUP_SOURCE_RPC_V1));
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

/** Previews the exact first Plan and Track that Planning will create. */
export async function previewGrowthPlanInitializationV1(
  client: PandoSupabaseClient,
  command: GrowthPlanInitializationPreviewCommandV1,
): Promise<GrowthPlanInitializationPreviewV1> {
  if (!validInitializationPreview(command)) throw new PlanInputError();
  try {
    return decodeGrowthPlanInitializationPreviewV1(
      await rpc(client, PREVIEW_GROWTH_PLAN_INITIALIZATION_RPC_V1, {
        p_readiness_goal_key: command.readinessGoalKey,
        p_expected_readiness_goal_version: command.expectedReadinessGoalVersion,
        p_weekly_capacity_minutes: command.weeklyCapacityMinutes,
        p_default_session_minutes: command.defaultSessionMinutes,
        p_track_priority: command.trackPriority,
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

/** Applies only the first-Plan creation that matches the confirmed preview digest. */
export async function applyGrowthPlanInitializationV1(
  client: PandoSupabaseClient,
  command: GrowthPlanInitializationApplyCommandV1,
): Promise<GrowthPlanInitializationApplyResultV1> {
  if (!validInitializationPreview(command) || !SHA_256_HEX.test(command.previewDigest)) {
    throw new PlanInputError();
  }
  try {
    return decodeGrowthPlanInitializationApplyResultV1(
      await rpc(client, APPLY_GROWTH_PLAN_INITIALIZATION_RPC_V1, {
        p_readiness_goal_key: command.readinessGoalKey,
        p_expected_readiness_goal_version: command.expectedReadinessGoalVersion,
        p_weekly_capacity_minutes: command.weeklyCapacityMinutes,
        p_default_session_minutes: command.defaultSessionMinutes,
        p_track_priority: command.trackPriority,
        p_reason: command.reason,
        p_idempotency_key: command.idempotencyKey,
        p_preview_digest: command.previewDigest,
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

/** Loads the session-resolved source for creating one additional current Learning Track. */
export async function loadLearningTrackCreationSourceV1(
  client: PandoSupabaseClient,
): Promise<LearningTrackCreationSourceV1> {
  try {
    return decodeLearningTrackCreationSourceV1(
      await rpc(client, GET_LEARNING_TRACK_CREATION_SOURCE_RPC_V1),
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

/** Previews the exact additional Track that Planning will create. */
export async function previewLearningTrackCreationV1(
  client: PandoSupabaseClient,
  command: LearningTrackCreationPreviewCommandV1,
): Promise<LearningTrackCreationPreviewV1> {
  if (!validLearningTrackCreationPreview(command)) throw new PlanInputError();
  try {
    return decodeLearningTrackCreationPreviewV1(
      await rpc(client, PREVIEW_LEARNING_TRACK_CREATION_RPC_V1, {
        p_readiness_goal_key: command.readinessGoalKey,
        p_expected_readiness_goal_version: command.expectedReadinessGoalVersion,
        p_title: command.title,
        p_priority: command.priority,
        p_default_session_minutes: command.defaultSessionMinutes,
        p_expected_growth_plan_version: command.expectedGrowthPlanVersion,
        p_reason: command.reason,
        p_request_id: command.requestId,
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

/** Applies only the confirmed additional-Track creation preview. */
export async function applyLearningTrackCreationV1(
  client: PandoSupabaseClient,
  command: LearningTrackCreationApplyCommandV1,
): Promise<LearningTrackCreationApplyResultV1> {
  if (!validLearningTrackCreationPreview(command) || !SHA_256_HEX.test(command.previewDigest)) {
    throw new PlanInputError();
  }
  try {
    return decodeLearningTrackCreationApplyResultV1(
      await rpc(client, APPLY_LEARNING_TRACK_CREATION_RPC_V1, {
        p_readiness_goal_key: command.readinessGoalKey,
        p_expected_readiness_goal_version: command.expectedReadinessGoalVersion,
        p_title: command.title,
        p_priority: command.priority,
        p_default_session_minutes: command.defaultSessionMinutes,
        p_expected_growth_plan_version: command.expectedGrowthPlanVersion,
        p_reason: command.reason,
        p_request_id: command.requestId,
        p_preview_digest: command.previewDigest,
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

/** Loads the bounded, actor-scoped personal activity choices for the initial Track. */
export async function loadLearningTrackActivityAdmissionSourceV1(
  client: PandoSupabaseClient,
): Promise<LearningTrackActivityAdmissionSourceV1> {
  try {
    return decodeLearningTrackActivityAdmissionSourceV1(
      await rpc(client, GET_LEARNING_TRACK_ACTIVITY_ADMISSION_SOURCE_RPC_V1),
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

/** Loads the bounded, actor-scoped personal activity choices for one selected current Track. */
export async function loadLearningTrackActivityAdmissionSourceV2(
  client: PandoSupabaseClient,
  trackKey: string,
): Promise<LearningTrackActivityAdmissionSourceV2> {
  if (!TRACK_KEY.test(trackKey)) throw new PlanInputError();
  try {
    return decodeLearningTrackActivityAdmissionSourceV2(
      await rpc(client, GET_LEARNING_TRACK_ACTIVITY_ADMISSION_SOURCE_RPC_V2, {
        p_track_key: trackKey,
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

/** Builds the exact, side-effect-free manual activity admission preview. */
export async function previewLearningTrackActivityAdmissionV1(
  client: PandoSupabaseClient,
  command: LearningTrackActivityAdmissionPreviewCommandV1,
): Promise<LearningTrackActivityAdmissionPreviewV1> {
  if (!validActivityAdmissionPreview(command)) throw new PlanInputError();
  try {
    return decodeLearningTrackActivityAdmissionPreviewV1(
      await rpc(client, PREVIEW_LEARNING_TRACK_ACTIVITY_ADMISSION_RPC_V1, {
        p_activity_key: command.activityKey,
        p_estimated_minutes: command.estimatedMinutes,
        p_energy: command.energy,
        p_expected_growth_plan_version: command.expectedGrowthPlanVersion,
        p_expected_learning_track_version: command.expectedLearningTrackVersion,
        p_reason: command.reason,
        p_request_id: command.requestId,
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

/** Builds the exact, side-effect-free destination-aware manual activity admission preview. */
export async function previewLearningTrackActivityAdmissionV2(
  client: PandoSupabaseClient,
  command: LearningTrackActivityAdmissionPreviewCommandV2,
): Promise<LearningTrackActivityAdmissionPreviewV2> {
  if (!validActivityAdmissionPreviewV2(command)) throw new PlanInputError();
  try {
    return decodeLearningTrackActivityAdmissionPreviewV2(
      await rpc(client, PREVIEW_LEARNING_TRACK_ACTIVITY_ADMISSION_RPC_V2, {
        p_track_key: command.trackKey,
        p_activity_key: command.activityKey,
        p_estimated_minutes: command.estimatedMinutes,
        p_energy: command.energy,
        p_expected_growth_plan_version: command.expectedGrowthPlanVersion,
        p_expected_learning_track_version: command.expectedLearningTrackVersion,
        p_reason: command.reason,
        p_request_id: command.requestId,
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

/** Applies only the exact manual activity admission preview the user confirmed. */
export async function applyLearningTrackActivityAdmissionV1(
  client: PandoSupabaseClient,
  command: LearningTrackActivityAdmissionApplyCommandV1,
): Promise<LearningTrackActivityAdmissionApplyResultV1> {
  if (!validActivityAdmissionPreview(command) || !SHA_256_HEX.test(command.previewDigest)) {
    throw new PlanInputError();
  }
  try {
    return decodeLearningTrackActivityAdmissionApplyResultV1(
      await rpc(client, APPLY_LEARNING_TRACK_ACTIVITY_ADMISSION_RPC_V1, {
        p_activity_key: command.activityKey,
        p_estimated_minutes: command.estimatedMinutes,
        p_energy: command.energy,
        p_expected_growth_plan_version: command.expectedGrowthPlanVersion,
        p_expected_learning_track_version: command.expectedLearningTrackVersion,
        p_reason: command.reason,
        p_request_id: command.requestId,
        p_preview_digest: command.previewDigest,
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

/** Applies only the exact destination-aware activity admission preview the user confirmed. */
export async function applyLearningTrackActivityAdmissionV2(
  client: PandoSupabaseClient,
  command: LearningTrackActivityAdmissionApplyCommandV2,
): Promise<LearningTrackActivityAdmissionApplyResultV2> {
  if (!validActivityAdmissionPreviewV2(command) || !SHA_256_HEX.test(command.previewDigest)) {
    throw new PlanInputError();
  }
  try {
    return decodeLearningTrackActivityAdmissionApplyResultV2(
      await rpc(client, APPLY_LEARNING_TRACK_ACTIVITY_ADMISSION_RPC_V2, {
        p_track_key: command.trackKey,
        p_activity_key: command.activityKey,
        p_estimated_minutes: command.estimatedMinutes,
        p_energy: command.energy,
        p_expected_growth_plan_version: command.expectedGrowthPlanVersion,
        p_expected_learning_track_version: command.expectedLearningTrackVersion,
        p_reason: command.reason,
        p_request_id: command.requestId,
        p_preview_digest: command.previewDigest,
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
