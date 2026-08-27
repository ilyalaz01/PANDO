import "server-only";

import { validateSchema } from "../../../shared/contracts/schema-registry";
import { targetReadinessSemanticViolations } from "../../../shared/contracts/target-readiness-semantics";

export const TARGET_READINESS_RPC_V1 = "get_target_readiness_v1" as const;

const GOAL_KEY = /^goal:[a-z0-9][a-z0-9-]{1,100}$/u;

export interface TargetReadinessRpcClient {
  rpc(
    functionName: typeof TARGET_READINESS_RPC_V1,
    parameters: Readonly<{ p_readiness_goal_key: string }>,
  ): PromiseLike<{ data: unknown; error: unknown | null }>;
}

export class TargetReadinessAccessError extends Error {
  constructor() {
    super("Target readiness is unavailable for the current session.");
    this.name = "TargetReadinessAccessError";
  }
}

export class TargetReadinessContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TargetReadinessContractError";
  }
}

/** Validates a Targets-owned zero-workspace DTO before Explore composes its read-only view. */
export function decodeTargetReadinessV1(
  value: unknown,
  readinessGoalKey: string,
): Record<string, unknown> {
  const structural = validateSchema("target-readiness-v1", value);
  if (!structural.valid)
    throw new TargetReadinessContractError("Target readiness response is invalid.");
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TargetReadinessContractError("Target readiness response is invalid.");
  }
  const result = value as Record<string, unknown>;
  if (result.readinessGoalKey !== readinessGoalKey) {
    throw new TargetReadinessContractError(
      "Target readiness goal does not match the requested goal.",
    );
  }
  if (targetReadinessSemanticViolations(result).length > 0) {
    throw new TargetReadinessContractError("Target readiness response is semantically invalid.");
  }
  return result;
}

export async function loadDatabaseTargetReadinessV1(
  client: TargetReadinessRpcClient,
  query: Readonly<{ readinessGoalKey: string }>,
): Promise<Record<string, unknown>> {
  if (!GOAL_KEY.test(query.readinessGoalKey)) throw new TypeError("readinessGoalKey is invalid.");
  let result: { data: unknown; error: unknown | null };
  try {
    result = await client.rpc(TARGET_READINESS_RPC_V1, {
      p_readiness_goal_key: query.readinessGoalKey,
    });
  } catch {
    throw new TargetReadinessAccessError();
  }
  if (result.error !== null) throw new TargetReadinessAccessError();
  return decodeTargetReadinessV1(result.data, query.readinessGoalKey);
}
