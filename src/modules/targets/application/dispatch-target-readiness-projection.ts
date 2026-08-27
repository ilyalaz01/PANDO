import "server-only";

import { asJsonObject, asNumber, asString } from "../../../shared/contracts/json";
import type { Json, PandoSupabaseClient } from "../../../shared/supabase/database";
import { SupabaseInternalConfigurationError } from "../../../shared/supabase/internal-config";
import { createPandoInternalProjectionClient } from "../../../shared/supabase/internal-server";
import { MasteryReadinessSynchronizationError } from "../../mastery/application/synchronize-readiness-inputs";
import { ReadinessInputError } from "../domain/readiness-types";
import {
  decodeTargetReadinessProjectionInputV1,
  prepareTargetReadinessProjectionResults,
  TargetReadinessProjectionContractError,
  UnsupportedDomainRequirementError,
} from "./target-readiness-projection";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MAX_CLAIMS = 5;
export const TARGET_READINESS_HANDLER_TIMEOUT_MS = 20_000;
export const TARGET_READINESS_COMPLETION_MAX_UTF8_BYTES = 768 * 1_024;

const CONTRACT_ERROR_CODES = new Map<string, string>([
  ["readiness delivery event contract is invalid", "EVENT_CONTRACT_REJECTED"],
  ["readiness event contract is invalid", "EVENT_CONTRACT_REJECTED"],
  ["readiness projection results are invalid", "RESULT_BATCH_REJECTED"],
  ["readiness projection has an unsupported requirement", "UNSUPPORTED_DOMAIN_REQUIREMENT"],
  ["readiness projection omitted or added an authoritative goal", "GOAL_SET_REJECTED"],
  ["readiness goal result is invalid", "GOAL_RESULT_REJECTED"],
  ["readiness projection input manifest is not authoritative", "INPUT_MANIFEST_REJECTED"],
  ["readiness validity is invalid", "VALIDITY_REJECTED"],
  ["readiness engine result is invalid", "ENGINE_RESULT_REJECTED"],
  ["readiness result contradicts authoritative profile rules", "PROFILE_RULES_REJECTED"],
  ["readiness fingerprint conflicts with stored snapshot provenance", "FINGERPRINT_CONFLICT"],
  ["readiness leaf input is invalid", "LEAF_INPUT_REJECTED"],
  ["readiness evidence references are not authoritative", "EVIDENCE_REFERENCE_REJECTED"],
  ["readiness fingerprint conflicts with stored input provenance", "INPUT_PROVENANCE_CONFLICT"],
  [
    "Mastery readiness source exceeds the supported evidence envelope",
    "READINESS_SOURCE_CAPACITY_EXCEEDED",
  ],
]);

class TargetReadinessProjectionRpcError extends Error {
  constructor(
    readonly rpcCode: string | undefined,
    readonly contractErrorCode: string | undefined,
  ) {
    super("Target readiness projection RPC failed.");
    this.name = "TargetReadinessProjectionRpcError";
  }
}

class TargetReadinessHandlerTimeoutError extends Error {
  constructor() {
    super("Target readiness projection handler exceeded its execution deadline.");
    this.name = "TargetReadinessHandlerTimeoutError";
  }
}

export class TargetReadinessCompletionCapacityError extends TypeError {
  readonly code = "READINESS_RESULT_CAPACITY_EXCEEDED";

  constructor() {
    super("Target readiness completion payload exceeds its transport safety budget.");
    this.name = "TargetReadinessCompletionCapacityError";
  }
}

interface TargetReadinessClaim {
  readonly deliveryId: string;
  readonly workspaceId: string;
  readonly leaseToken: string;
  readonly eventPosition: number;
}

export interface TargetReadinessDispatchSummary {
  readonly configured: boolean;
  readonly claimed: number;
  readonly completed: number;
  readonly retried: number;
}

function matching(value: unknown, pattern: RegExp, label: string): string {
  if (typeof value !== "string" || !pattern.test(value)) throw new TypeError(`${label} is invalid`);
  return value;
}

export function assertTargetReadinessCompletionPayloadWithinBudget(value: unknown): void {
  const serialized = JSON.stringify(value);
  if (
    serialized === undefined ||
    new TextEncoder().encode(serialized).byteLength > TARGET_READINESS_COMPLETION_MAX_UTF8_BYTES
  ) {
    throw new TargetReadinessCompletionCapacityError();
  }
}

async function awaitWithAbort<T>(operation: PromiseLike<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return await operation;
  if (signal.aborted) throw signal.reason;
  let rejectOnAbort: ((reason?: unknown) => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectOnAbort = reject;
  });
  const onAbort = () => rejectOnAbort?.(signal.reason);
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    return await Promise.race([operation, aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

async function checkedRpc(
  client: PandoSupabaseClient,
  name:
    | "claim_target_readiness_projection_v1"
    | "load_target_readiness_projection_v1"
    | "complete_target_readiness_projection_v1"
    | "fail_target_readiness_projection_v1",
  parameters: Record<string, Json> = {},
  signal?: AbortSignal,
): Promise<unknown> {
  const request = client.rpc(name as never, parameters as never) as unknown as
    | PromiseLike<{ data: unknown; error: unknown | null }>
    | {
        abortSignal?: (
          requestSignal: AbortSignal,
        ) => PromiseLike<{ data: unknown; error: unknown | null }>;
      };
  const operation =
    signal !== undefined && "abortSignal" in request && typeof request.abortSignal === "function"
      ? request.abortSignal(signal)
      : (request as PromiseLike<{ data: unknown; error: unknown | null }>);
  const result = await awaitWithAbort(operation, signal);
  if (result.error !== null) {
    const error = asJsonObject(result.error, "Target readiness projection RPC error");
    const message = asString(error.message);
    throw new TargetReadinessProjectionRpcError(
      asString(error.code),
      message === undefined ? undefined : CONTRACT_ERROR_CODES.get(message),
    );
  }
  return result.data;
}

function decodeClaim(value: unknown, index: number): TargetReadinessClaim {
  const item = asJsonObject(value, `claims[${index}]`);
  const eventPosition = asNumber(item.event_position);
  if (eventPosition === undefined || !Number.isSafeInteger(eventPosition) || eventPosition < 1) {
    throw new TypeError("Target readiness claim position is invalid");
  }
  return {
    deliveryId: matching(item.delivery_id, UUID, "delivery ID"),
    workspaceId: matching(item.workspace_id, UUID, "workspace ID"),
    leaseToken: matching(item.lease_token, UUID, "lease token"),
    eventPosition,
  };
}

function classifyFailure(error: unknown): Readonly<{
  failureClass: "TRANSIENT" | "INVALID_CONTRACT";
  errorCode: string;
}> {
  if (error instanceof TargetReadinessHandlerTimeoutError) {
    return { failureClass: "TRANSIENT", errorCode: "HANDLER_TIMEOUT" };
  }
  if (error instanceof TargetReadinessCompletionCapacityError) {
    return { failureClass: "INVALID_CONTRACT", errorCode: error.code };
  }
  if (error instanceof UnsupportedDomainRequirementError) {
    return { failureClass: "INVALID_CONTRACT", errorCode: error.code };
  }
  if (error instanceof TargetReadinessProjectionContractError) {
    return { failureClass: "INVALID_CONTRACT", errorCode: "INVALID_PROJECTION_INPUT" };
  }
  if (error instanceof MasteryReadinessSynchronizationError) {
    return { failureClass: "INVALID_CONTRACT", errorCode: "INVALID_MASTERY_INPUT" };
  }
  if (error instanceof ReadinessInputError) {
    return { failureClass: "INVALID_CONTRACT", errorCode: "INVALID_READINESS_INPUT" };
  }
  if (error instanceof TypeError) {
    return { failureClass: "INVALID_CONTRACT", errorCode: "INVALID_PROJECTION_RESULT" };
  }
  if (
    error instanceof TargetReadinessProjectionRpcError &&
    error.rpcCode !== undefined &&
    (/^22/u.test(error.rpcCode) ||
      error.rpcCode === "23514" ||
      (error.rpcCode === "54000" &&
        error.contractErrorCode === "READINESS_SOURCE_CAPACITY_EXCEEDED") ||
      error.rpcCode === "PGRST102")
  ) {
    return {
      failureClass: "INVALID_CONTRACT",
      errorCode: error.contractErrorCode ?? "PROJECTION_CONTRACT_REJECTED",
    };
  }
  return { failureClass: "TRANSIENT", errorCode: "DISPATCH_FAILED" };
}

async function failDelivery(
  client: PandoSupabaseClient,
  claim: TargetReadinessClaim,
  failureClass: "TRANSIENT" | "STALE_INPUT" | "INVALID_CONTRACT",
  errorCode: string,
  signal?: AbortSignal,
): Promise<void> {
  await checkedRpc(
    client,
    "fail_target_readiness_projection_v1",
    {
      p_delivery_id: claim.deliveryId,
      p_lease_token: claim.leaseToken,
      p_failure_class: failureClass,
      p_error_code: errorCode,
    },
    signal,
  );
}

async function processClaim(
  client: PandoSupabaseClient,
  claim: TargetReadinessClaim,
): Promise<"completed" | "retried"> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new TargetReadinessHandlerTimeoutError()),
    TARGET_READINESS_HANDLER_TIMEOUT_MS,
  );
  try {
    const input = decodeTargetReadinessProjectionInputV1(
      await checkedRpc(
        client,
        "load_target_readiness_projection_v1",
        { p_delivery_id: claim.deliveryId, p_lease_token: claim.leaseToken },
        controller.signal,
      ),
    );
    if (
      input.deliveryId !== claim.deliveryId ||
      Number(input.eventPosition) !== claim.eventPosition
    ) {
      throw new TargetReadinessProjectionContractError("Claim and loaded input identity differ");
    }
    const results = prepareTargetReadinessProjectionResults(input);
    assertTargetReadinessCompletionPayloadWithinBudget(results);
    const applied = await checkedRpc(
      client,
      "complete_target_readiness_projection_v1",
      {
        p_delivery_id: claim.deliveryId,
        p_lease_token: claim.leaseToken,
        p_expected_event_position: claim.eventPosition,
        p_results: results as unknown as Json,
      },
      controller.signal,
    );
    if (applied !== true) {
      await failDelivery(client, claim, "STALE_INPUT", "STALE_READINESS_INPUT", controller.signal);
      return "retried";
    }
    return "completed";
  } catch (error) {
    const failure = classifyFailure(error);
    try {
      await failDelivery(
        client,
        claim,
        failure.failureClass,
        failure.errorCode,
        controller.signal.aborted ? AbortSignal.timeout(2_000) : controller.signal,
      );
    } catch {
      // The durable lease is reclaimed after expiry; never bypass the worker boundary.
    }
    return "retried";
  } finally {
    clearTimeout(timeout);
  }
}

export async function dispatchTargetReadinessProjection(
  client: PandoSupabaseClient,
): Promise<TargetReadinessDispatchSummary> {
  const rawClaims = await checkedRpc(client, "claim_target_readiness_projection_v1");
  if (!Array.isArray(rawClaims))
    throw new TypeError("Target readiness claim response must be an array");
  if (rawClaims.length > MAX_CLAIMS)
    throw new TypeError("Target readiness claim batch is unbounded");
  const claims = rawClaims.map(decodeClaim);
  if (
    new Set(claims.map(({ deliveryId }) => deliveryId)).size !== claims.length ||
    new Set(claims.map(({ workspaceId }) => workspaceId)).size !== claims.length
  ) {
    throw new TypeError("Target readiness claims are duplicated or overlap a workspace");
  }
  const outcomes = await Promise.all(claims.map((claim) => processClaim(client, claim)));
  const completed = outcomes.filter((outcome) => outcome === "completed").length;
  return {
    configured: true,
    claimed: claims.length,
    completed,
    retried: outcomes.length - completed,
  };
}

export async function dispatchTargetReadinessProjectionIfConfigured(): Promise<TargetReadinessDispatchSummary> {
  try {
    return await dispatchTargetReadinessProjection(createPandoInternalProjectionClient());
  } catch (error) {
    if (error instanceof SupabaseInternalConfigurationError) {
      return { configured: false, claimed: 0, completed: 0, retried: 0 };
    }
    return { configured: true, claimed: 0, completed: 0, retried: 1 };
  }
}
