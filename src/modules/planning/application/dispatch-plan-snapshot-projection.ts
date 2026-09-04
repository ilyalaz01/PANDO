import "server-only";

import { asJsonObject, asNumber, asString } from "../../../shared/contracts/json";
import type { Json, PandoSupabaseClient } from "../../../shared/supabase/database";
import { SupabaseInternalConfigurationError } from "../../../shared/supabase/internal-config";
import { createPandoInternalProjectionClient } from "../../../shared/supabase/internal-server";
import { calculatePlan, calculatePlanV2, calculatePlanV3 } from "./calculate-plan";
import {
  assemblePlanSnapshotInput,
  assemblePlanSnapshotInputV2,
  assemblePlanSnapshotInputV3,
  PlanningProjectionSourceError,
} from "./assemble-plan-snapshot-input";
import { PLANNING_POLICY_V0_1 } from "../domain/planning-policy-v0.1";
import { PLANNING_POLICY_V0_2 } from "../domain/planning-policy-v0.2";
import { PLANNING_POLICY_V0_3 } from "../domain/planning-policy-v0.3";
import {
  PlanningInputError,
  type CalculatePlanInput,
  type CalculatePlanInputV2,
  type CalculatePlanInputV3,
  type PlanSnapshot,
  type PlanSnapshotV2,
  type PlanSnapshotV3,
} from "../domain/planning-types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAX_CLAIMS = 5;
const PLANNING_CALCULATION_V1 = "planning-calculation/1";
const PLANNING_CALCULATION_V2 = "planning-calculation/2";
/**
 * D3b2-rollout's dispatcher "expand" half (ADR-0010 §8/§9's expand-then-activate sequence): the
 * dispatcher recognizes and correctly executes this contract, but no delivery can carry it yet —
 * `planning.plan_snapshot_attempts.calculation_contract_version`'s database CHECK constraint still
 * admits only `.../1` and `.../2` (added by `20260903000100_phase4b_planning_cadence_dual_contract.sql`).
 * Widening that constraint and stamping new deliveries with this contract is the "activate" half,
 * gated behind a SQL migration this session cannot make. See the D3b2-rollout status report.
 */
const PLANNING_CALCULATION_V3 = "planning-calculation/3";
type PlanningCalculationContract =
  typeof PLANNING_CALCULATION_V1 | typeof PLANNING_CALCULATION_V2 | typeof PLANNING_CALCULATION_V3;
export const PLAN_SNAPSHOT_HANDLER_TIMEOUT_MS = 20_000;
export const PLAN_SNAPSHOT_COMPLETION_MAX_UTF8_BYTES = 768 * 1_024;

class PlanSnapshotProjectionRpcError extends Error {
  constructor(readonly rpcCode: string | undefined) {
    super("Planning snapshot projection RPC failed.");
    this.name = "PlanSnapshotProjectionRpcError";
  }
}

class PlanSnapshotHandlerTimeoutError extends Error {
  constructor() {
    super("Planning snapshot projection handler exceeded its execution deadline.");
    this.name = "PlanSnapshotHandlerTimeoutError";
  }
}

export class PlanSnapshotCompletionCapacityError extends TypeError {
  readonly code = "PLAN_SNAPSHOT_RESULT_CAPACITY_EXCEEDED";

  constructor() {
    super("Planning snapshot completion payload exceeds its transport safety budget.");
    this.name = "PlanSnapshotCompletionCapacityError";
  }
}

interface PlanSnapshotClaim {
  readonly deliveryId: string;
  readonly workspaceId: string;
  readonly leaseToken: string;
  readonly attemptId: string;
  readonly eventPosition: number;
}

export interface PlanSnapshotDispatchSummary {
  readonly configured: boolean;
  readonly claimed: number;
  readonly completed: number;
  readonly retried: number;
  readonly deadLettered: number;
  readonly superseded: number;
}

function uuid(value: unknown, label: string): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new TypeError(`${label} is invalid`);
  return value;
}

function calculationContract(value: unknown): PlanningCalculationContract {
  if (
    value === PLANNING_CALCULATION_V1 ||
    value === PLANNING_CALCULATION_V2 ||
    value === PLANNING_CALCULATION_V3
  ) {
    return value;
  }
  throw new TypeError("Planning calculation contract is invalid");
}

function assertCompletionPayloadWithinBudget(value: unknown): void {
  const serialized = JSON.stringify(value);
  if (
    serialized === undefined ||
    new TextEncoder().encode(serialized).byteLength > PLAN_SNAPSHOT_COMPLETION_MAX_UTF8_BYTES
  ) {
    throw new PlanSnapshotCompletionCapacityError();
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

type PlanningProjectionRpc =
  | "claim_plan_snapshot_projection_v1"
  | "load_plan_snapshot_projection_v1"
  | "record_plan_snapshot_input_v1"
  | "complete_plan_snapshot_projection_v1"
  | "fail_plan_snapshot_projection_v1";

async function checkedRpc(
  client: PandoSupabaseClient,
  name: PlanningProjectionRpc,
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
    const error = asJsonObject(result.error, "Planning projection RPC error");
    throw new PlanSnapshotProjectionRpcError(asString(error.code));
  }
  return result.data;
}

function decodeClaim(value: unknown, index: number): PlanSnapshotClaim {
  const claim = asJsonObject(value, `claims[${index}]`);
  const eventPosition = asNumber(claim.event_position);
  if (eventPosition === undefined || !Number.isSafeInteger(eventPosition) || eventPosition < 1) {
    throw new TypeError("Planning claim position is invalid");
  }
  return {
    deliveryId: uuid(claim.delivery_id, "delivery ID"),
    workspaceId: uuid(claim.workspace_id, "workspace ID"),
    leaseToken: uuid(claim.lease_token, "lease token"),
    attemptId: uuid(claim.attempt_id, "attempt ID"),
    eventPosition,
  };
}

function classifyFailure(error: unknown): Readonly<{
  failureClass: "TRANSIENT" | "INVALID_CONTRACT";
  errorCode: string;
}> {
  if (error instanceof PlanSnapshotHandlerTimeoutError) {
    return { failureClass: "TRANSIENT", errorCode: "HANDLER_TIMEOUT" };
  }
  if (error instanceof PlanSnapshotCompletionCapacityError) {
    return { failureClass: "INVALID_CONTRACT", errorCode: error.code };
  }
  if (error instanceof PlanningProjectionSourceError) {
    return { failureClass: "INVALID_CONTRACT", errorCode: error.code };
  }
  if (error instanceof PlanningInputError || error instanceof TypeError) {
    return { failureClass: "INVALID_CONTRACT", errorCode: "INVALID_PLANNING_PROJECTION" };
  }
  if (
    error instanceof PlanSnapshotProjectionRpcError &&
    error.rpcCode !== undefined &&
    (/^22/u.test(error.rpcCode) ||
      error.rpcCode === "23514" ||
      error.rpcCode === "54000" ||
      error.rpcCode === "PGRST102")
  ) {
    return { failureClass: "INVALID_CONTRACT", errorCode: "PROJECTION_CONTRACT_REJECTED" };
  }
  return { failureClass: "TRANSIENT", errorCode: "DISPATCH_FAILED" };
}

async function failClaim(
  client: PandoSupabaseClient,
  claim: PlanSnapshotClaim,
  failureClass: "TRANSIENT" | "INVALID_CONTRACT",
  errorCode: string,
  signal?: AbortSignal,
): Promise<"retried" | "deadLettered"> {
  const outcome = await checkedRpc(
    client,
    "fail_plan_snapshot_projection_v1",
    {
      p_delivery_id: claim.deliveryId,
      p_lease_token: claim.leaseToken,
      p_attempt_id: claim.attemptId,
      p_failure_class: failureClass,
      p_error_code: errorCode,
    },
    signal,
  );
  return outcome === "dead_letter" ? "deadLettered" : "retried";
}

async function processClaim(
  client: PandoSupabaseClient,
  originalClaim: PlanSnapshotClaim,
): Promise<"completed" | "retried" | "deadLettered" | "superseded"> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new PlanSnapshotHandlerTimeoutError()),
    PLAN_SNAPSHOT_HANDLER_TIMEOUT_MS,
  );
  let claim = originalClaim;
  try {
    const loaded = asJsonObject(
      await checkedRpc(
        client,
        "load_plan_snapshot_projection_v1",
        {
          p_delivery_id: claim.deliveryId,
          p_lease_token: claim.leaseToken,
          p_attempt_id: claim.attemptId,
        },
        controller.signal,
      ),
      "Planning loaded projection",
    );
    claim = { ...claim, attemptId: uuid(loaded.attemptId, "loaded attempt ID") };
    const contract = calculationContract(loaded.calculationContractVersion);
    let input: CalculatePlanInput | CalculatePlanInputV2 | CalculatePlanInputV3;
    if (loaded.storedInput === null) {
      input =
        contract === PLANNING_CALCULATION_V1
          ? assemblePlanSnapshotInput(loaded.sourceBundle)
          : contract === PLANNING_CALCULATION_V2
            ? assemblePlanSnapshotInputV2(loaded.sourceBundle)
            : assemblePlanSnapshotInputV3(loaded.sourceBundle);
      const recorded = await checkedRpc(
        client,
        "record_plan_snapshot_input_v1",
        {
          p_delivery_id: claim.deliveryId,
          p_lease_token: claim.leaseToken,
          p_attempt_id: claim.attemptId,
          p_source_fence: asString(loaded.sourceFence) ?? "",
          p_input: input as unknown as Json,
        },
        controller.signal,
      );
      if (recorded !== true) throw new TypeError("Planning input was not recorded");
    } else {
      input = loaded.storedInput as unknown as
        CalculatePlanInput | CalculatePlanInputV2 | CalculatePlanInputV3;
    }
    const result: PlanSnapshot | PlanSnapshotV2 | PlanSnapshotV3 =
      contract === PLANNING_CALCULATION_V1
        ? calculatePlan(input as CalculatePlanInput, PLANNING_POLICY_V0_1)
        : contract === PLANNING_CALCULATION_V2
          ? calculatePlanV2(input as CalculatePlanInputV2, PLANNING_POLICY_V0_2)
          : calculatePlanV3(input as CalculatePlanInputV3, PLANNING_POLICY_V0_3);
    assertCompletionPayloadWithinBudget(result);
    const outcome = await checkedRpc(
      client,
      "complete_plan_snapshot_projection_v1",
      {
        p_delivery_id: claim.deliveryId,
        p_lease_token: claim.leaseToken,
        p_attempt_id: claim.attemptId,
        p_result: result as unknown as Json,
      },
      controller.signal,
    );
    if (outcome === "APPLIED" || outcome === "COVERED") return "completed";
    if (outcome === "SUPERSEDED") return "superseded";
    if (outcome === "RETRY") return "retried";
    if (outcome === "DEAD_LETTER") return "deadLettered";
    throw new TypeError("Planning completion outcome is invalid");
  } catch (error) {
    const failure = classifyFailure(error);
    try {
      return await failClaim(
        client,
        claim,
        failure.failureClass,
        failure.errorCode,
        controller.signal.aborted ? AbortSignal.timeout(2_000) : controller.signal,
      );
    } catch {
      // The durable lease is reclaimed after expiry; never bypass the command boundary.
    }
    return "retried";
  } finally {
    clearTimeout(timeout);
  }
}

export async function dispatchPlanSnapshotProjection(
  client: PandoSupabaseClient,
): Promise<PlanSnapshotDispatchSummary> {
  const rawClaims = await checkedRpc(client, "claim_plan_snapshot_projection_v1");
  if (!Array.isArray(rawClaims)) throw new TypeError("Planning claim response must be an array");
  if (rawClaims.length > MAX_CLAIMS) throw new TypeError("Planning claim batch is unbounded");
  const claims = rawClaims.map(decodeClaim);
  if (
    new Set(claims.map(({ deliveryId }) => deliveryId)).size !== claims.length ||
    new Set(claims.map(({ workspaceId }) => workspaceId)).size !== claims.length
  ) {
    throw new TypeError("Planning claims are duplicated or overlap a workspace");
  }
  const outcomes = await Promise.all(claims.map((claim) => processClaim(client, claim)));
  return {
    configured: true,
    claimed: claims.length,
    completed: outcomes.filter((outcome) => outcome === "completed").length,
    retried: outcomes.filter((outcome) => outcome === "retried").length,
    deadLettered: outcomes.filter((outcome) => outcome === "deadLettered").length,
    superseded: outcomes.filter((outcome) => outcome === "superseded").length,
  };
}

export async function dispatchPlanSnapshotProjectionIfConfigured(): Promise<PlanSnapshotDispatchSummary> {
  try {
    return await dispatchPlanSnapshotProjection(createPandoInternalProjectionClient());
  } catch (error) {
    if (error instanceof SupabaseInternalConfigurationError) {
      return {
        configured: false,
        claimed: 0,
        completed: 0,
        retried: 0,
        deadLettered: 0,
        superseded: 0,
      };
    }
    return {
      configured: true,
      claimed: 0,
      completed: 0,
      retried: 1,
      deadLettered: 0,
      superseded: 0,
    };
  }
}
