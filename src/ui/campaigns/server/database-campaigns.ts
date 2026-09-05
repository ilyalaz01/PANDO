import "server-only";

import type { Json, PandoSupabaseClient } from "../../../shared/supabase/database";
import {
  CampaignAllocationOverrideContractError,
  decodeCampaignAllocationOverrideChangeApplyResultV1,
  decodeCampaignAllocationOverrideChangePreviewV1,
  type CampaignAllocationOverrideChangeApplyResultV1,
  type CampaignAllocationOverrideChangePreviewV1,
  type CampaignAllocationOverrideOperationV1,
} from "../../../shared/contracts/campaign-allocation-override-control";
import {
  CampaignAllocationOverridesContractError,
  decodeCampaignAllocationOverridesV1,
  type CampaignAllocationOverridesV1,
} from "../../../shared/contracts/campaign-allocation-overrides";
import {
  CampaignLifecycleCoordinationContractError,
  decodeCampaignLifecycleCoordinationApplyResultV1,
  decodeCampaignLifecycleCoordinationPreviewV1,
  type CampaignLifecycleCoordinationApplyResultV1,
  type CampaignLifecycleCoordinationOperationV1,
  type CampaignLifecycleCoordinationPreviewV1,
} from "../../../shared/contracts/campaign-lifecycle-coordination-control";
import {
  InterviewCampaignCreationContractError,
  decodeInterviewCampaignCreationApplyResultV1,
  decodeInterviewCampaignCreationPreviewV1,
  type InterviewCampaignCreationApplyResultV1,
  type InterviewCampaignCreationPreviewV1,
} from "../../../shared/contracts/interview-campaign-creation-control";
import {
  InterviewCampaignDeadlineContractError,
  decodeInterviewCampaignDeadlineChangeApplyResultV1,
  decodeInterviewCampaignDeadlineChangePreviewV1,
  type InterviewCampaignDeadlineChangeApplyResultV1,
  type InterviewCampaignDeadlineChangePreviewV1,
} from "../../../shared/contracts/interview-campaign-deadline-control";
import {
  InterviewCampaignRetargetContractError,
  decodeInterviewCampaignRetargetApplyResultV1,
  decodeInterviewCampaignRetargetPreviewV1,
  type InterviewCampaignRetargetApplyResultV1,
  type InterviewCampaignRetargetPreviewV1,
} from "../../../shared/contracts/interview-campaign-retarget-control";
import {
  InterviewCampaignLifecycleContractError,
  decodeInterviewCampaignLifecycleApplyResultV1,
  decodeInterviewCampaignLifecyclePreviewV1,
  type InterviewCampaignLifecycleApplyResultV1,
  type InterviewCampaignLifecycleOperationV1,
  type InterviewCampaignLifecyclePreviewV1,
} from "../../../shared/contracts/interview-campaign-lifecycle-control";
import {
  InterviewCampaignsContractError,
  decodeInterviewCampaignsV1,
  type InterviewCampaignsV1,
} from "../../../shared/contracts/interview-campaigns";

export const GET_INTERVIEW_CAMPAIGNS_RPC_V1 = "get_interview_campaigns_v1" as const;
export const PREVIEW_INTERVIEW_CAMPAIGN_CREATION_RPC_V1 =
  "preview_interview_campaign_creation_v1" as const;
export const APPLY_INTERVIEW_CAMPAIGN_CREATION_RPC_V1 =
  "apply_interview_campaign_creation_v1" as const;
export const PREVIEW_INTERVIEW_CAMPAIGN_DEADLINE_CHANGE_RPC_V1 =
  "preview_interview_campaign_deadline_change_v1" as const;
export const APPLY_INTERVIEW_CAMPAIGN_DEADLINE_CHANGE_RPC_V1 =
  "apply_interview_campaign_deadline_change_v1" as const;
export const PREVIEW_INTERVIEW_CAMPAIGN_RETARGET_RPC_V1 =
  "preview_interview_campaign_retarget_v1" as const;
export const APPLY_INTERVIEW_CAMPAIGN_RETARGET_RPC_V1 =
  "apply_interview_campaign_retarget_v1" as const;
export const PREVIEW_INTERVIEW_CAMPAIGN_LIFECYCLE_RPC_V1 =
  "preview_interview_campaign_lifecycle_v1" as const;
export const APPLY_INTERVIEW_CAMPAIGN_LIFECYCLE_RPC_V1 =
  "apply_interview_campaign_lifecycle_v1" as const;
export const GET_CAMPAIGN_ALLOCATION_OVERRIDES_RPC_V1 =
  "get_campaign_allocation_overrides_v1" as const;
export const PREVIEW_CAMPAIGN_ALLOCATION_OVERRIDE_RPC_V1 =
  "preview_campaign_allocation_override_v1" as const;
export const APPLY_CAMPAIGN_ALLOCATION_OVERRIDE_RPC_V1 =
  "apply_campaign_allocation_override_v1" as const;
export const PREVIEW_CAMPAIGN_LIFECYCLE_COORDINATION_RPC_V1 =
  "preview_campaign_lifecycle_coordination_v1" as const;
export const APPLY_CAMPAIGN_LIFECYCLE_COORDINATION_RPC_V1 =
  "apply_campaign_lifecycle_coordination_v1" as const;

const POSITIVE_BIGINT = /^(?:[1-9][0-9]{0,18})$/u;
const SHA_256_HEX = /^[a-f0-9]{64}$/u;
const CONTROL_CHARACTER = /[\p{Cc}]/u;
const MAX_POSTGRES_BIGINT = BigInt("9223372036854775807");
const GOAL_KEY = /^goal:[a-z0-9][a-z0-9-]{1,100}$/u;
const CAMPAIGN_KEY =
  /^campaign:[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const LOWERCASE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const LOCAL_DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u;
const TITLE_MAX_LENGTH = 200;
const REASON_MAX_LENGTH = 500;
const OVERRIDE_KEY =
  /^override:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const TRACK_KEY = /^track:[a-z0-9][a-z0-9-]{1,100}$/u;
const MAXIMUM_COORDINATION_OVERRIDES = 20;

export class CampaignInputError extends Error {
  constructor() {
    super("The Interview Campaign request is invalid.");
    this.name = "CampaignInputError";
  }
}

export class CampaignConflictError extends Error {
  constructor() {
    super("Interview Campaign changed before this request completed.");
    this.name = "CampaignConflictError";
  }
}

export class CampaignUnavailableError extends Error {
  constructor() {
    super("Interview Campaigns are unavailable for the current session.");
    this.name = "CampaignUnavailableError";
  }
}

export interface InterviewCampaignCreationCommandV1 {
  readonly readinessGoalKey: string;
  readonly expectedReadinessGoalVersion: string;
  readonly title: string;
  readonly deadlineLocalDate: string;
  readonly reason: string;
  readonly idempotencyKey: string;
}

export interface InterviewCampaignCreationApplyCommandV1 extends InterviewCampaignCreationCommandV1 {
  readonly previewDigest: string;
}

export interface InterviewCampaignDeadlineChangeCommandV1 {
  readonly campaignKey: string;
  readonly expectedCampaignVersion: string;
  readonly deadlineLocalDate: string;
  readonly reason: string;
}

export interface InterviewCampaignDeadlineChangeApplyCommandV1 extends InterviewCampaignDeadlineChangeCommandV1 {
  readonly previewDigest: string;
  readonly idempotencyKey: string;
}

export interface InterviewCampaignRetargetCommandV1 {
  readonly campaignKey: string;
  readonly expectedCampaignVersion: string;
  readonly readinessGoalKey: string;
  readonly expectedReadinessGoalVersion: string;
  readonly reason: string;
}

export interface InterviewCampaignRetargetApplyCommandV1 extends InterviewCampaignRetargetCommandV1 {
  readonly previewDigest: string;
  readonly idempotencyKey: string;
}

export interface InterviewCampaignLifecycleCommandV1 {
  readonly campaignKey: string;
  readonly operation: InterviewCampaignLifecycleOperationV1;
  readonly expectedCampaignVersion: string;
  readonly reason: string;
}

export interface InterviewCampaignLifecycleApplyCommandV1 extends InterviewCampaignLifecycleCommandV1 {
  readonly previewDigest: string;
  readonly idempotencyKey: string;
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

function collapseRpcError(error: unknown): never {
  const code = errorCode(error);
  if (code === "40001" || code === "23505") throw new CampaignConflictError();
  if (code === "22023" || code === "22003" || code === "22P02") throw new CampaignInputError();
  throw new CampaignUnavailableError();
}

function collapseContractError(error: unknown): never {
  if (
    error instanceof InterviewCampaignCreationContractError ||
    error instanceof InterviewCampaignDeadlineContractError ||
    error instanceof InterviewCampaignRetargetContractError ||
    error instanceof InterviewCampaignLifecycleContractError ||
    error instanceof InterviewCampaignsContractError ||
    error instanceof CampaignAllocationOverrideContractError ||
    error instanceof CampaignAllocationOverridesContractError ||
    error instanceof CampaignLifecycleCoordinationContractError
  ) {
    throw new CampaignUnavailableError();
  }
  throw error;
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
    Array.from(value).length <= REASON_MAX_LENGTH &&
    value.trim() === value &&
    !CONTROL_CHARACTER.test(value)
  );
}

function validTitle(value: string): boolean {
  return (
    Array.from(value).length >= 1 &&
    Array.from(value).length <= TITLE_MAX_LENGTH &&
    value.trim() === value &&
    !CONTROL_CHARACTER.test(value)
  );
}

function validIdempotencyKey(value: string): boolean {
  return LOWERCASE_UUID.test(value);
}

function validCreationCommand(command: InterviewCampaignCreationCommandV1): boolean {
  return (
    GOAL_KEY.test(command.readinessGoalKey) &&
    validVersion(command.expectedReadinessGoalVersion) &&
    validTitle(command.title) &&
    LOCAL_DATE.test(command.deadlineLocalDate) &&
    validReason(command.reason) &&
    validIdempotencyKey(command.idempotencyKey)
  );
}

function validDeadlineCommand(command: InterviewCampaignDeadlineChangeCommandV1): boolean {
  return (
    CAMPAIGN_KEY.test(command.campaignKey) &&
    validVersion(command.expectedCampaignVersion) &&
    LOCAL_DATE.test(command.deadlineLocalDate) &&
    validReason(command.reason)
  );
}

function validRetargetCommand(command: InterviewCampaignRetargetCommandV1): boolean {
  return (
    CAMPAIGN_KEY.test(command.campaignKey) &&
    validVersion(command.expectedCampaignVersion) &&
    GOAL_KEY.test(command.readinessGoalKey) &&
    validVersion(command.expectedReadinessGoalVersion) &&
    validReason(command.reason)
  );
}

function validLifecycleOperation(value: string): value is InterviewCampaignLifecycleOperationV1 {
  return value === "start_campaign" || value === "end_campaign" || value === "cancel_campaign";
}

function validLifecycleCommand(command: InterviewCampaignLifecycleCommandV1): boolean {
  return (
    CAMPAIGN_KEY.test(command.campaignKey) &&
    validLifecycleOperation(command.operation) &&
    validVersion(command.expectedCampaignVersion) &&
    validReason(command.reason)
  );
}

export interface CampaignAllocationOverrideChangeCommandV1 {
  readonly overrideKey: string;
  readonly operation: CampaignAllocationOverrideOperationV1;
  readonly expectedOverrideVersion: string;
  readonly priorityOverride: number | null;
  readonly protectedMinimumMinutesOverride: number | null;
  readonly cadencePerWeekOverride: number | null;
  readonly reason: string;
}

export interface CampaignAllocationOverrideChangeApplyCommandV1 extends CampaignAllocationOverrideChangeCommandV1 {
  readonly previewDigest: string;
  readonly idempotencyKey: string;
}

export interface CampaignLifecycleCoordinationOverrideIntentV1 {
  readonly trackKey: string;
  readonly expectedTrackVersion: string;
  readonly priorityOverride: number | null;
  readonly protectedMinimumMinutesOverride: number | null;
  readonly cadencePerWeekOverride: number | null;
}

export interface CampaignLifecycleCoordinationCommandV1 {
  readonly campaignKey: string;
  readonly operation: CampaignLifecycleCoordinationOperationV1;
  readonly expectedCampaignVersion: string;
  readonly reason: string;
  readonly idempotencyKey: string;
  readonly overrides: readonly CampaignLifecycleCoordinationOverrideIntentV1[];
}

export interface CampaignLifecycleCoordinationApplyCommandV1 extends CampaignLifecycleCoordinationCommandV1 {
  readonly previewDigest: string;
}

function validNullableInteger(value: number | null, minimum: number, maximum: number): boolean {
  return value === null || (Number.isInteger(value) && value >= minimum && value <= maximum);
}

function validOverrideChangeCommand(command: CampaignAllocationOverrideChangeCommandV1): boolean {
  return (
    OVERRIDE_KEY.test(command.overrideKey) &&
    (command.operation === "change_campaign_allocation_override" ||
      command.operation === "remove_campaign_allocation_override") &&
    validVersion(command.expectedOverrideVersion) &&
    validNullableInteger(command.priorityOverride, 0, 100) &&
    validNullableInteger(command.protectedMinimumMinutesOverride, 0, 10_080) &&
    validNullableInteger(command.cadencePerWeekOverride, 0, 100) &&
    validReason(command.reason)
  );
}

function validOverrideIntent(intent: CampaignLifecycleCoordinationOverrideIntentV1): boolean {
  return (
    TRACK_KEY.test(intent.trackKey) &&
    validVersion(intent.expectedTrackVersion) &&
    validNullableInteger(intent.priorityOverride, 0, 100) &&
    validNullableInteger(intent.protectedMinimumMinutesOverride, 0, 10_080) &&
    validNullableInteger(intent.cadencePerWeekOverride, 0, 100) &&
    (intent.priorityOverride !== null ||
      intent.protectedMinimumMinutesOverride !== null ||
      intent.cadencePerWeekOverride !== null)
  );
}

function validCoordinationOperation(
  value: string,
): value is CampaignLifecycleCoordinationOperationV1 {
  return value === "start_campaign" || value === "end_campaign" || value === "cancel_campaign";
}

function validCoordinationCommand(command: CampaignLifecycleCoordinationCommandV1): boolean {
  return (
    CAMPAIGN_KEY.test(command.campaignKey) &&
    validCoordinationOperation(command.operation) &&
    validVersion(command.expectedCampaignVersion) &&
    validReason(command.reason) &&
    validIdempotencyKey(command.idempotencyKey) &&
    command.overrides.length <= MAXIMUM_COORDINATION_OVERRIDES &&
    (command.operation === "start_campaign" || command.overrides.length === 0) &&
    new Set(command.overrides.map(({ trackKey }) => trackKey)).size === command.overrides.length &&
    command.overrides.every(validOverrideIntent)
  );
}

function overrideIntentPayload(intent: CampaignLifecycleCoordinationOverrideIntentV1): Json {
  return {
    trackKey: intent.trackKey,
    expectedTrackVersion: intent.expectedTrackVersion,
    priorityOverride: intent.priorityOverride,
    protectedMinimumMinutesOverride: intent.protectedMinimumMinutesOverride,
    cadencePerWeekOverride: intent.cadencePerWeekOverride,
  };
}

async function rpc(
  client: PandoSupabaseClient,
  name:
    | typeof GET_INTERVIEW_CAMPAIGNS_RPC_V1
    | typeof PREVIEW_INTERVIEW_CAMPAIGN_CREATION_RPC_V1
    | typeof APPLY_INTERVIEW_CAMPAIGN_CREATION_RPC_V1
    | typeof PREVIEW_INTERVIEW_CAMPAIGN_DEADLINE_CHANGE_RPC_V1
    | typeof APPLY_INTERVIEW_CAMPAIGN_DEADLINE_CHANGE_RPC_V1
    | typeof PREVIEW_INTERVIEW_CAMPAIGN_RETARGET_RPC_V1
    | typeof APPLY_INTERVIEW_CAMPAIGN_RETARGET_RPC_V1
    | typeof PREVIEW_INTERVIEW_CAMPAIGN_LIFECYCLE_RPC_V1
    | typeof APPLY_INTERVIEW_CAMPAIGN_LIFECYCLE_RPC_V1
    | typeof GET_CAMPAIGN_ALLOCATION_OVERRIDES_RPC_V1
    | typeof PREVIEW_CAMPAIGN_ALLOCATION_OVERRIDE_RPC_V1
    | typeof APPLY_CAMPAIGN_ALLOCATION_OVERRIDE_RPC_V1
    | typeof PREVIEW_CAMPAIGN_LIFECYCLE_COORDINATION_RPC_V1
    | typeof APPLY_CAMPAIGN_LIFECYCLE_COORDINATION_RPC_V1,
  parameters?: Record<string, Json>,
): Promise<unknown> {
  let result: { data: unknown; error: unknown | null };
  try {
    result = (
      parameters === undefined
        ? await client.rpc(name as never)
        : await client.rpc(name as never, parameters as never)
    ) as { data: unknown; error: unknown | null };
  } catch {
    throw new CampaignUnavailableError();
  }
  if (result.error !== null) collapseRpcError(result.error);
  return result.data;
}

/** Loads the session-resolved workspace's full lifetime Interview Campaign list. */
export async function loadInterviewCampaignsV1(
  client: PandoSupabaseClient,
): Promise<InterviewCampaignsV1> {
  try {
    return decodeInterviewCampaignsV1(await rpc(client, GET_INTERVIEW_CAMPAIGNS_RPC_V1));
  } catch (error) {
    if (
      error instanceof CampaignInputError ||
      error instanceof CampaignConflictError ||
      error instanceof CampaignUnavailableError
    ) {
      throw error;
    }
    collapseContractError(error);
  }
}

/** Previews the exact new draft Interview Campaign a create would produce. */
export async function previewInterviewCampaignCreationV1(
  client: PandoSupabaseClient,
  command: InterviewCampaignCreationCommandV1,
): Promise<InterviewCampaignCreationPreviewV1> {
  if (!validCreationCommand(command)) throw new CampaignInputError();
  try {
    return decodeInterviewCampaignCreationPreviewV1(
      await rpc(client, PREVIEW_INTERVIEW_CAMPAIGN_CREATION_RPC_V1, {
        p_readiness_goal_key: command.readinessGoalKey,
        p_expected_readiness_goal_version: command.expectedReadinessGoalVersion,
        p_title: command.title,
        p_deadline_local_date: command.deadlineLocalDate,
        p_reason: command.reason,
        p_idempotency_key: command.idempotencyKey,
      }),
    );
  } catch (error) {
    if (
      error instanceof CampaignInputError ||
      error instanceof CampaignConflictError ||
      error instanceof CampaignUnavailableError
    ) {
      throw error;
    }
    collapseContractError(error);
  }
}

/** Applies only the confirmed creation preview, matched by its exact digest. */
export async function applyInterviewCampaignCreationV1(
  client: PandoSupabaseClient,
  command: InterviewCampaignCreationApplyCommandV1,
): Promise<InterviewCampaignCreationApplyResultV1> {
  if (!validCreationCommand(command) || !SHA_256_HEX.test(command.previewDigest)) {
    throw new CampaignInputError();
  }
  try {
    return decodeInterviewCampaignCreationApplyResultV1(
      await rpc(client, APPLY_INTERVIEW_CAMPAIGN_CREATION_RPC_V1, {
        p_readiness_goal_key: command.readinessGoalKey,
        p_expected_readiness_goal_version: command.expectedReadinessGoalVersion,
        p_title: command.title,
        p_deadline_local_date: command.deadlineLocalDate,
        p_reason: command.reason,
        p_idempotency_key: command.idempotencyKey,
        p_preview_digest: command.previewDigest,
      }),
    );
  } catch (error) {
    if (
      error instanceof CampaignInputError ||
      error instanceof CampaignConflictError ||
      error instanceof CampaignUnavailableError
    ) {
      throw error;
    }
    collapseContractError(error);
  }
}

/** Previews the exact deadline change effect for one existing campaign. */
export async function previewInterviewCampaignDeadlineChangeV1(
  client: PandoSupabaseClient,
  command: InterviewCampaignDeadlineChangeCommandV1,
): Promise<InterviewCampaignDeadlineChangePreviewV1> {
  if (!validDeadlineCommand(command)) throw new CampaignInputError();
  try {
    return decodeInterviewCampaignDeadlineChangePreviewV1(
      await rpc(client, PREVIEW_INTERVIEW_CAMPAIGN_DEADLINE_CHANGE_RPC_V1, {
        p_campaign_key: command.campaignKey,
        p_expected_campaign_version: command.expectedCampaignVersion,
        p_deadline_local_date: command.deadlineLocalDate,
        p_reason: command.reason,
      }),
    );
  } catch (error) {
    if (
      error instanceof CampaignInputError ||
      error instanceof CampaignConflictError ||
      error instanceof CampaignUnavailableError
    ) {
      throw error;
    }
    collapseContractError(error);
  }
}

/** Applies only the confirmed deadline change preview, matched by its exact digest. */
export async function applyInterviewCampaignDeadlineChangeV1(
  client: PandoSupabaseClient,
  command: InterviewCampaignDeadlineChangeApplyCommandV1,
): Promise<InterviewCampaignDeadlineChangeApplyResultV1> {
  if (
    !validDeadlineCommand(command) ||
    !SHA_256_HEX.test(command.previewDigest) ||
    !validIdempotencyKey(command.idempotencyKey)
  ) {
    throw new CampaignInputError();
  }
  try {
    return decodeInterviewCampaignDeadlineChangeApplyResultV1(
      await rpc(client, APPLY_INTERVIEW_CAMPAIGN_DEADLINE_CHANGE_RPC_V1, {
        p_campaign_key: command.campaignKey,
        p_expected_campaign_version: command.expectedCampaignVersion,
        p_deadline_local_date: command.deadlineLocalDate,
        p_preview_digest: command.previewDigest,
        p_reason: command.reason,
        p_idempotency_key: command.idempotencyKey,
      }),
    );
  } catch (error) {
    if (
      error instanceof CampaignInputError ||
      error instanceof CampaignConflictError ||
      error instanceof CampaignUnavailableError
    ) {
      throw error;
    }
    collapseContractError(error);
  }
}

/** Previews retargeting one existing campaign to a different active Readiness Goal. */
export async function previewInterviewCampaignRetargetV1(
  client: PandoSupabaseClient,
  command: InterviewCampaignRetargetCommandV1,
): Promise<InterviewCampaignRetargetPreviewV1> {
  if (!validRetargetCommand(command)) throw new CampaignInputError();
  try {
    return decodeInterviewCampaignRetargetPreviewV1(
      await rpc(client, PREVIEW_INTERVIEW_CAMPAIGN_RETARGET_RPC_V1, {
        p_campaign_key: command.campaignKey,
        p_expected_campaign_version: command.expectedCampaignVersion,
        p_readiness_goal_key: command.readinessGoalKey,
        p_expected_readiness_goal_version: command.expectedReadinessGoalVersion,
        p_reason: command.reason,
      }),
    );
  } catch (error) {
    if (
      error instanceof CampaignInputError ||
      error instanceof CampaignConflictError ||
      error instanceof CampaignUnavailableError
    ) {
      throw error;
    }
    collapseContractError(error);
  }
}

/** Applies only the confirmed retarget preview, matched by its exact digest. */
export async function applyInterviewCampaignRetargetV1(
  client: PandoSupabaseClient,
  command: InterviewCampaignRetargetApplyCommandV1,
): Promise<InterviewCampaignRetargetApplyResultV1> {
  if (
    !validRetargetCommand(command) ||
    !SHA_256_HEX.test(command.previewDigest) ||
    !validIdempotencyKey(command.idempotencyKey)
  ) {
    throw new CampaignInputError();
  }
  try {
    return decodeInterviewCampaignRetargetApplyResultV1(
      await rpc(client, APPLY_INTERVIEW_CAMPAIGN_RETARGET_RPC_V1, {
        p_campaign_key: command.campaignKey,
        p_expected_campaign_version: command.expectedCampaignVersion,
        p_readiness_goal_key: command.readinessGoalKey,
        p_expected_readiness_goal_version: command.expectedReadinessGoalVersion,
        p_preview_digest: command.previewDigest,
        p_reason: command.reason,
        p_idempotency_key: command.idempotencyKey,
      }),
    );
  } catch (error) {
    if (
      error instanceof CampaignInputError ||
      error instanceof CampaignConflictError ||
      error instanceof CampaignUnavailableError
    ) {
      throw error;
    }
    collapseContractError(error);
  }
}

/** Previews a start, end, or cancel lifecycle transition for one existing campaign. */
export async function previewInterviewCampaignLifecycleV1(
  client: PandoSupabaseClient,
  command: InterviewCampaignLifecycleCommandV1,
): Promise<InterviewCampaignLifecyclePreviewV1> {
  if (!validLifecycleCommand(command)) throw new CampaignInputError();
  try {
    return decodeInterviewCampaignLifecyclePreviewV1(
      await rpc(client, PREVIEW_INTERVIEW_CAMPAIGN_LIFECYCLE_RPC_V1, {
        p_campaign_key: command.campaignKey,
        p_operation: command.operation,
        p_expected_campaign_version: command.expectedCampaignVersion,
        p_reason: command.reason,
      }),
    );
  } catch (error) {
    if (
      error instanceof CampaignInputError ||
      error instanceof CampaignConflictError ||
      error instanceof CampaignUnavailableError
    ) {
      throw error;
    }
    collapseContractError(error);
  }
}

/** Applies only the confirmed lifecycle preview, matched by its exact digest. */
export async function applyInterviewCampaignLifecycleV1(
  client: PandoSupabaseClient,
  command: InterviewCampaignLifecycleApplyCommandV1,
): Promise<InterviewCampaignLifecycleApplyResultV1> {
  if (
    !validLifecycleCommand(command) ||
    !SHA_256_HEX.test(command.previewDigest) ||
    !validIdempotencyKey(command.idempotencyKey)
  ) {
    throw new CampaignInputError();
  }
  try {
    return decodeInterviewCampaignLifecycleApplyResultV1(
      await rpc(client, APPLY_INTERVIEW_CAMPAIGN_LIFECYCLE_RPC_V1, {
        p_campaign_key: command.campaignKey,
        p_operation: command.operation,
        p_expected_campaign_version: command.expectedCampaignVersion,
        p_preview_digest: command.previewDigest,
        p_reason: command.reason,
        p_idempotency_key: command.idempotencyKey,
      }),
    );
  } catch (error) {
    if (
      error instanceof CampaignInputError ||
      error instanceof CampaignConflictError ||
      error instanceof CampaignUnavailableError
    ) {
      throw error;
    }
    collapseContractError(error);
  }
}

/** Loads a workspace's full campaign allocation override history (ADR-0010 §5). */
export async function loadCampaignAllocationOverridesV1(
  client: PandoSupabaseClient,
): Promise<CampaignAllocationOverridesV1> {
  try {
    return decodeCampaignAllocationOverridesV1(
      await rpc(client, GET_CAMPAIGN_ALLOCATION_OVERRIDES_RPC_V1),
    );
  } catch (error) {
    if (
      error instanceof CampaignInputError ||
      error instanceof CampaignConflictError ||
      error instanceof CampaignUnavailableError
    ) {
      throw error;
    }
    collapseContractError(error);
  }
}

/** Previews editing or removing one already-installed allocation override. */
export async function previewCampaignAllocationOverrideV1(
  client: PandoSupabaseClient,
  command: CampaignAllocationOverrideChangeCommandV1,
): Promise<CampaignAllocationOverrideChangePreviewV1> {
  if (!validOverrideChangeCommand(command)) throw new CampaignInputError();
  try {
    return decodeCampaignAllocationOverrideChangePreviewV1(
      await rpc(client, PREVIEW_CAMPAIGN_ALLOCATION_OVERRIDE_RPC_V1, {
        p_override_key: command.overrideKey,
        p_operation: command.operation,
        p_expected_override_version: command.expectedOverrideVersion,
        p_priority_override: command.priorityOverride,
        p_protected_minimum_minutes_override: command.protectedMinimumMinutesOverride,
        p_cadence_per_week_override: command.cadencePerWeekOverride,
        p_reason: command.reason,
      }),
    );
  } catch (error) {
    if (
      error instanceof CampaignInputError ||
      error instanceof CampaignConflictError ||
      error instanceof CampaignUnavailableError
    ) {
      throw error;
    }
    collapseContractError(error);
  }
}

/** Applies only the confirmed override change/remove preview, matched by its exact digest. */
export async function applyCampaignAllocationOverrideV1(
  client: PandoSupabaseClient,
  command: CampaignAllocationOverrideChangeApplyCommandV1,
): Promise<CampaignAllocationOverrideChangeApplyResultV1> {
  if (
    !validOverrideChangeCommand(command) ||
    !SHA_256_HEX.test(command.previewDigest) ||
    !validIdempotencyKey(command.idempotencyKey)
  ) {
    throw new CampaignInputError();
  }
  try {
    return decodeCampaignAllocationOverrideChangeApplyResultV1(
      await rpc(client, APPLY_CAMPAIGN_ALLOCATION_OVERRIDE_RPC_V1, {
        p_override_key: command.overrideKey,
        p_operation: command.operation,
        p_expected_override_version: command.expectedOverrideVersion,
        p_priority_override: command.priorityOverride,
        p_protected_minimum_minutes_override: command.protectedMinimumMinutesOverride,
        p_cadence_per_week_override: command.cadencePerWeekOverride,
        p_preview_digest: command.previewDigest,
        p_reason: command.reason,
        p_idempotency_key: command.idempotencyKey,
      }),
    );
  } catch (error) {
    if (
      error instanceof CampaignInputError ||
      error instanceof CampaignConflictError ||
      error instanceof CampaignUnavailableError
    ) {
      throw error;
    }
    collapseContractError(error);
  }
}

/**
 * Previews a start/end/cancel campaign lifecycle coordination (ADR-0010 §7). `start_campaign` may
 * carry 0-20 override intents, installed atomically with the transition; `end_campaign` and
 * `cancel_campaign` never carry any and close every active override themselves.
 */
export async function previewCampaignLifecycleCoordinationV1(
  client: PandoSupabaseClient,
  command: CampaignLifecycleCoordinationCommandV1,
): Promise<CampaignLifecycleCoordinationPreviewV1> {
  if (!validCoordinationCommand(command)) throw new CampaignInputError();
  try {
    return decodeCampaignLifecycleCoordinationPreviewV1(
      await rpc(client, PREVIEW_CAMPAIGN_LIFECYCLE_COORDINATION_RPC_V1, {
        p_campaign_key: command.campaignKey,
        p_operation: command.operation,
        p_expected_campaign_version: command.expectedCampaignVersion,
        p_reason: command.reason,
        p_overrides: command.overrides.map(overrideIntentPayload),
        p_idempotency_key: command.idempotencyKey,
      }),
    );
  } catch (error) {
    if (
      error instanceof CampaignInputError ||
      error instanceof CampaignConflictError ||
      error instanceof CampaignUnavailableError
    ) {
      throw error;
    }
    collapseContractError(error);
  }
}

/** Applies only the confirmed coordination preview, matched by its exact digest. */
export async function applyCampaignLifecycleCoordinationV1(
  client: PandoSupabaseClient,
  command: CampaignLifecycleCoordinationApplyCommandV1,
): Promise<CampaignLifecycleCoordinationApplyResultV1> {
  if (!validCoordinationCommand(command) || !SHA_256_HEX.test(command.previewDigest)) {
    throw new CampaignInputError();
  }
  try {
    return decodeCampaignLifecycleCoordinationApplyResultV1(
      await rpc(client, APPLY_CAMPAIGN_LIFECYCLE_COORDINATION_RPC_V1, {
        p_campaign_key: command.campaignKey,
        p_operation: command.operation,
        p_expected_campaign_version: command.expectedCampaignVersion,
        p_reason: command.reason,
        p_overrides: command.overrides.map(overrideIntentPayload),
        p_preview_digest: command.previewDigest,
        p_idempotency_key: command.idempotencyKey,
      }),
    );
  } catch (error) {
    if (
      error instanceof CampaignInputError ||
      error instanceof CampaignConflictError ||
      error instanceof CampaignUnavailableError
    ) {
      throw error;
    }
    collapseContractError(error);
  }
}
