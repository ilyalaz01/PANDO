import "server-only";

import {
  decodeExploreTargetContextV1,
  ExploreTargetContextContractError,
  type ExploreTargetContextV1,
} from "./explore-target-context-v1";

export const EXPLORE_TARGET_CONTEXT_RPC_V1 = "get_explore_target_context_v1" as const;

export interface ExploreTargetContextQueryV1 {
  readonly readinessGoalKey: string;
}

export interface ExploreTargetContextRpcResult {
  readonly data: unknown;
  readonly error: unknown | null;
}

/** Must be a verified request-scoped user client. A service-role client is never valid here. */
export interface ExploreTargetContextRpcClient {
  rpc(
    functionName: typeof EXPLORE_TARGET_CONTEXT_RPC_V1,
    parameters: Readonly<{ p_readiness_goal_key: string }>,
  ): PromiseLike<ExploreTargetContextRpcResult>;
}

export class ExploreTargetContextAccessError extends Error {
  constructor() {
    super("Explore target context is unavailable for the current session.");
    this.name = "ExploreTargetContextAccessError";
  }
}

const GOAL_KEY = /^goal:[a-z0-9][a-z0-9-]{1,100}$/u;

/** Loads one authorized immutable target context; workspace scope is always derived in Postgres. */
export async function loadDatabaseExploreTargetContextV1(
  client: ExploreTargetContextRpcClient,
  query: ExploreTargetContextQueryV1,
): Promise<ExploreTargetContextV1> {
  if (typeof query.readinessGoalKey !== "string" || !GOAL_KEY.test(query.readinessGoalKey))
    throw new TypeError("readinessGoalKey is invalid.");

  let result: ExploreTargetContextRpcResult;
  try {
    result = await client.rpc(EXPLORE_TARGET_CONTEXT_RPC_V1, {
      p_readiness_goal_key: query.readinessGoalKey,
    });
  } catch {
    throw new ExploreTargetContextAccessError();
  }
  if (result.error !== null) throw new ExploreTargetContextAccessError();

  const context = decodeExploreTargetContextV1(result.data);
  if (context.readinessGoal.readinessGoalKey !== query.readinessGoalKey) {
    throw new ExploreTargetContextContractError([
      {
        code: "EXPLORE_TARGET_QUERY_GOAL_MISMATCH",
        path: "/readinessGoal/readinessGoalKey",
        message: "Response readiness goal must match the authorized selector.",
      },
    ]);
  }
  return context;
}
