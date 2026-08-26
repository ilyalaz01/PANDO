import "server-only";

import {
  decodeExploreSourceV1,
  ExploreSourceContractError,
  type ExploreSourceV1,
} from "./explore-source-v1";

export const EXPLORE_SOURCE_RPC_V1 = "get_explore_source_v1" as const;

export interface ExploreSourceQueryV1 {
  readonly workspaceId: string;
  readonly readinessGoalKey: string;
  readonly selectedActivityKey?: string | null;
}

export interface UserScopedRpcResult {
  readonly data: unknown;
  readonly error: unknown | null;
}

/**
 * The implementation must be created from a validated authenticated user session. Ordinary Explore
 * reads must never provide a service-role client here because that would bypass workspace RLS.
 */
export interface AuthenticatedUserScopedRpcClient {
  rpc(
    functionName: typeof EXPLORE_SOURCE_RPC_V1,
    parameters: Readonly<{
      p_workspace_id: string;
      p_readiness_goal_key: string;
      p_selected_activity_key: string | null;
    }>,
  ): PromiseLike<UserScopedRpcResult>;
}

export class ExploreSourceAccessError extends Error {
  constructor() {
    super("Explore source is unavailable for the current session.");
    this.name = "ExploreSourceAccessError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const GOAL_KEY = /^goal:[a-z0-9][a-z0-9-]{1,100}$/u;
const ACTIVITY_KEY = /^activity:[a-z0-9][a-z0-9-]{1,100}$/u;

function validateQuery(query: ExploreSourceQueryV1): void {
  if (!UUID.test(query.workspaceId)) throw new TypeError("workspaceId is invalid.");
  if (!GOAL_KEY.test(query.readinessGoalKey)) throw new TypeError("readinessGoalKey is invalid.");
  if (
    query.selectedActivityKey !== undefined &&
    query.selectedActivityKey !== null &&
    !ACTIVITY_KEY.test(query.selectedActivityKey)
  ) {
    throw new TypeError("selectedActivityKey is invalid.");
  }
}

/**
 * Calls the single purpose-specific read RPC and validates its complete response before any
 * projection materializer can observe it. Authorization/not-found details intentionally collapse
 * into one safe external error.
 */
export async function loadDatabaseExploreSourceV1(
  client: AuthenticatedUserScopedRpcClient,
  query: ExploreSourceQueryV1,
): Promise<ExploreSourceV1> {
  validateQuery(query);
  let result: UserScopedRpcResult;
  try {
    result = await client.rpc(EXPLORE_SOURCE_RPC_V1, {
      p_workspace_id: query.workspaceId,
      p_readiness_goal_key: query.readinessGoalKey,
      p_selected_activity_key: query.selectedActivityKey ?? null,
    });
  } catch {
    throw new ExploreSourceAccessError();
  }
  if (result.error !== null) throw new ExploreSourceAccessError();
  const source = decodeExploreSourceV1(result.data);
  const selectedActivityKey = query.selectedActivityKey ?? null;
  const activityRefs = source.nodes
    .filter(({ nodeType }) => nodeType === "ACTIVITY")
    .map(({ nodeRef }) => nodeRef);
  const violations = [
    ...(source.workspaceId === query.workspaceId
      ? []
      : [
          {
            code: "EXPLORE_SOURCE_QUERY_WORKSPACE_MISMATCH",
            path: "/workspaceId",
            message: "Response workspace must match the authorized query.",
          },
        ]),
    ...(source.readinessGoalKey === query.readinessGoalKey
      ? []
      : [
          {
            code: "EXPLORE_SOURCE_QUERY_GOAL_MISMATCH",
            path: "/readinessGoalKey",
            message: "Response readiness goal must match the authorized query.",
          },
        ]),
    ...(selectedActivityKey === null
      ? activityRefs.length === 0
        ? []
        : [
            {
              code: "EXPLORE_SOURCE_UNSELECTED_ACTIVITY_PRESENT",
              path: "/nodes",
              message: "An unselected query cannot return activity nodes.",
            },
          ]
      : activityRefs.length === 1 && activityRefs[0] === selectedActivityKey
        ? []
        : [
            {
              code: "EXPLORE_SOURCE_SELECTED_ACTIVITY_MISMATCH",
              path: "/nodes",
              message: "The response must contain exactly the selected activity.",
            },
          ]),
  ];
  if (violations.length > 0) throw new ExploreSourceContractError(violations);
  return source;
}
