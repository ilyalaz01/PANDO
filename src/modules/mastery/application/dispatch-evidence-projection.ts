import "server-only";

import { asArray, asJsonObject, asNumber, asString } from "../../../shared/contracts/json";
import type { Json, PandoSupabaseClient } from "../../../shared/supabase/database";
import { createPandoInternalProjectionClient } from "../../../shared/supabase/internal-server";
import { SupabaseInternalConfigurationError } from "../../../shared/supabase/internal-config";
import { calculateCompetencyState } from "../domain/calculate-competency-state";
import { MASTERY_POLICY_V0_1 } from "../domain/policy-v0.1";
import {
  MASTERY_ENGINE_VERSION,
  MasteryInputError,
  type CalculateCompetencyStateInput,
  type MasteryEvidenceInput,
} from "../domain/types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const COMPETENCY_REF = /^competency:[a-z0-9][a-z0-9-]{1,100}$/u;
export const MASTERY_HANDLER_TIMEOUT_MS = 20_000;

class MasteryProjectionRpcError extends Error {
  constructor(readonly rpcCode: string | undefined) {
    super("Mastery projection RPC failed.");
    this.name = "MasteryProjectionRpcError";
  }
}

class MasteryHandlerTimeoutError extends Error {
  constructor() {
    super("Mastery projection handler exceeded its execution deadline.");
    this.name = "MasteryHandlerTimeoutError";
  }
}

class MasteryProjectionInputContractError extends TypeError {
  constructor() {
    super("Mastery projection input did not match its transport contract.");
    this.name = "MasteryProjectionInputContractError";
  }
}

export interface MasteryDispatchSummary {
  readonly configured: boolean;
  readonly claimed: number;
  readonly completed: number;
  readonly retried: number;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string") throw new TypeError(`${label} must be a string`);
  return value;
}

function requiredBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new TypeError(`${label} must be a boolean`);
  return value;
}

function requiredNumber(value: unknown, label: string): number {
  if (typeof value !== "number") throw new TypeError(`${label} must be a number`);
  return value;
}

function evidenceInput(value: unknown, index: number): MasteryEvidenceInput {
  const item = asJsonObject(value, `evidence[${index}]`);
  return {
    evidenceId: requiredString(item.evidenceId, "evidenceId"),
    attemptId: requiredString(item.attemptId, "attemptId"),
    sourceId: requiredString(item.sourceId, "sourceId"),
    occurredAt: requiredString(item.occurredAt, "occurredAt"),
    dimension: requiredString(item.dimension, "dimension") as MasteryEvidenceInput["dimension"],
    outcome: requiredString(item.outcome, "outcome") as MasteryEvidenceInput["outcome"],
    engagement: requiredString(item.engagement, "engagement") as MasteryEvidenceInput["engagement"],
    normalized: requiredBoolean(item.normalized, "normalized"),
    invalidated: requiredBoolean(item.invalidated, "invalidated"),
    observedResult: requiredBoolean(item.observedResult, "observedResult"),
    mappingConfidence: requiredNumber(item.mappingConfidence, "mappingConfidence"),
    sourceReliability: requiredNumber(item.sourceReliability, "sourceReliability"),
    targetRelevant: requiredBoolean(item.targetRelevant, "targetRelevant"),
  };
}

function decodeProjectionInput(value: unknown): CalculateCompetencyStateInput {
  const input = asJsonObject(value, "Mastery projection input");
  const competencyId = asString(input.competencyId);
  const inputWatermark = asString(input.inputWatermark);
  if (
    competencyId === undefined ||
    !COMPETENCY_REF.test(competencyId) ||
    inputWatermark === undefined ||
    !/^[1-9][0-9]{0,18}$/u.test(inputWatermark)
  ) {
    throw new TypeError("Mastery projection identity is invalid");
  }
  const numericInputWatermark = Number(inputWatermark);
  if (!Number.isSafeInteger(numericInputWatermark)) {
    throw new TypeError("Mastery projection watermark exceeds the safe transport range");
  }
  return {
    competencyId,
    inputWatermark,
    evidence: asArray(input.evidence).map(evidenceInput),
  };
}

async function checkedRpc(
  client: PandoSupabaseClient,
  name:
    | "claim_mastery_evidence_projection_v1"
    | "load_mastery_evidence_projection_v1"
    | "complete_mastery_evidence_projection_v1"
    | "fail_mastery_evidence_projection_v1",
  parameters: Record<string, Json> = {},
  signal?: AbortSignal,
): Promise<unknown> {
  const request = client.rpc(name, parameters as never) as unknown as
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
    const error = asJsonObject(result.error, "Mastery projection RPC error");
    throw new MasteryProjectionRpcError(asString(error.code));
  }
  return result.data;
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

function classifyFailure(error: unknown): Readonly<{
  failureClass: "TRANSIENT" | "INVALID_CONTRACT";
  errorCode: string;
}> {
  if (error instanceof MasteryHandlerTimeoutError) {
    return { failureClass: "TRANSIENT", errorCode: "HANDLER_TIMEOUT" };
  }
  if (error instanceof MasteryProjectionInputContractError) {
    return { failureClass: "INVALID_CONTRACT", errorCode: "INVALID_PROJECTION_INPUT" };
  }
  if (error instanceof MasteryInputError) {
    return { failureClass: "INVALID_CONTRACT", errorCode: "INVALID_MASTERY_INPUT" };
  }
  if (error instanceof TypeError) {
    return { failureClass: "INVALID_CONTRACT", errorCode: "INVALID_PROJECTION_RESULT" };
  }
  if (
    error instanceof MasteryProjectionRpcError &&
    error.rpcCode !== undefined &&
    (/^22/u.test(error.rpcCode) || error.rpcCode === "23514" || error.rpcCode === "PGRST102")
  ) {
    return { failureClass: "INVALID_CONTRACT", errorCode: "PROJECTION_CONTRACT_REJECTED" };
  }
  return { failureClass: "TRANSIENT", errorCode: "DISPATCH_FAILED" };
}

async function failDelivery(
  client: PandoSupabaseClient,
  claim: Readonly<{ deliveryId: string; leaseToken: string }>,
  failureClass: "TRANSIENT" | "STALE_INPUT" | "INVALID_CONTRACT",
  errorCode: string,
  signal?: AbortSignal,
): Promise<void> {
  await checkedRpc(
    client,
    "fail_mastery_evidence_projection_v1",
    {
      p_delivery_id: claim.deliveryId,
      p_lease_token: claim.leaseToken,
      p_failure_class: failureClass,
      p_error_code: errorCode,
    },
    signal,
  );
}

interface MasteryClaim {
  readonly deliveryId: string;
  readonly leaseToken: string;
  readonly eventPosition: number;
}

function decodeClaim(rawClaim: unknown, index: number): MasteryClaim {
  const item = asJsonObject(rawClaim, `claims[${index}]`);
  const deliveryId = asString(item.delivery_id);
  const leaseToken = asString(item.lease_token);
  const eventPosition = asNumber(item.event_position);
  if (
    deliveryId === undefined ||
    leaseToken === undefined ||
    !UUID.test(deliveryId) ||
    !UUID.test(leaseToken) ||
    eventPosition === undefined ||
    !Number.isSafeInteger(eventPosition) ||
    eventPosition < 1
  ) {
    throw new TypeError("Mastery claim row is invalid");
  }
  return { deliveryId, leaseToken, eventPosition };
}

async function processClaim(
  client: PandoSupabaseClient,
  claim: MasteryClaim,
  now: () => Date,
): Promise<"completed" | "retried"> {
  const handlerController = new AbortController();
  const handlerTimeout = setTimeout(
    () => handlerController.abort(new MasteryHandlerTimeoutError()),
    MASTERY_HANDLER_TIMEOUT_MS,
  );
  try {
    const rawInput = await checkedRpc(
      client,
      "load_mastery_evidence_projection_v1",
      {
        p_delivery_id: claim.deliveryId,
        p_lease_token: claim.leaseToken,
      },
      handlerController.signal,
    );
    let input: CalculateCompetencyStateInput;
    try {
      input = decodeProjectionInput(rawInput);
    } catch {
      throw new MasteryProjectionInputContractError();
    }
    const state = calculateCompetencyState(input, MASTERY_POLICY_V0_1, {
      asOf: now().toISOString(),
    });
    if (state.engineVersion !== MASTERY_ENGINE_VERSION) {
      throw new TypeError("Mastery engine version drifted");
    }
    const applied = await checkedRpc(
      client,
      "complete_mastery_evidence_projection_v1",
      {
        p_delivery_id: claim.deliveryId,
        p_lease_token: claim.leaseToken,
        p_expected_event_position: claim.eventPosition,
        p_expected_input_watermark: Number(input.inputWatermark),
        p_state: state as unknown as Json,
      },
      handlerController.signal,
    );
    if (applied !== true) {
      await failDelivery(
        client,
        claim,
        "STALE_INPUT",
        "STALE_LEDGER_WATERMARK",
        handlerController.signal,
      );
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
        handlerController.signal.aborted ? AbortSignal.timeout(2_000) : handlerController.signal,
      );
    } catch {
      // The lease remains durable and will be reclaimed after expiry. Never hide the original
      // error by throwing a second failure that could encourage an unsafe direct state write.
    }
    return "retried";
  } finally {
    clearTimeout(handlerTimeout);
  }
}

export async function dispatchMasteryEvidenceProjection(
  client: PandoSupabaseClient,
  now: () => Date = () => new Date(),
): Promise<MasteryDispatchSummary> {
  const rawClaims = await checkedRpc(client, "claim_mastery_evidence_projection_v1");
  if (!Array.isArray(rawClaims)) throw new TypeError("Mastery claim response must be an array");
  const claims = rawClaims.map(decodeClaim);
  const outcomes = await Promise.all(claims.map((claim) => processClaim(client, claim, now)));
  const completed = outcomes.filter((outcome) => outcome === "completed").length;
  return {
    configured: true,
    claimed: claims.length,
    completed,
    retried: outcomes.length - completed,
  };
}

export async function dispatchMasteryEvidenceProjectionIfConfigured(): Promise<MasteryDispatchSummary> {
  try {
    return await dispatchMasteryEvidenceProjection(createPandoInternalProjectionClient());
  } catch (error) {
    if (error instanceof SupabaseInternalConfigurationError) {
      return { configured: false, claimed: 0, completed: 0, retried: 0 };
    }
    return { configured: true, claimed: 0, completed: 0, retried: 1 };
  }
}
