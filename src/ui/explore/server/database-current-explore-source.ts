import "server-only";

import {
  decodeExploreSourceV1,
  ExploreSourceContractError,
  type ExploreSourceV1,
} from "./explore-source-v1";

export const CURRENT_EXPLORE_SOURCE_RPC_V1 = "get_current_explore_source_v1" as const;

export interface CurrentExploreSourceQueryV1 {
  readonly readinessGoalKey: string;
  readonly selectedActivityKey?: string | null;
}

export interface CurrentExploreSourceRpcResult {
  readonly data: unknown;
  readonly error: unknown | null;
}

/** Must be a verified request-scoped user client. A service-role client is never valid here. */
export interface CurrentExploreSourceRpcClient {
  rpc(
    functionName: typeof CURRENT_EXPLORE_SOURCE_RPC_V1,
    parameters: Readonly<{
      p_readiness_goal_key: string;
      p_selected_activity_key?: string;
    }>,
  ): PromiseLike<CurrentExploreSourceRpcResult>;
}

export class CurrentExploreSourceAccessError extends Error {
  constructor() {
    super("Explore source is unavailable for the current session.");
    this.name = "CurrentExploreSourceAccessError";
  }
}

const GOAL_KEY = /^goal:[a-z0-9][a-z0-9-]{1,100}$/u;
const ACTIVITY_KEY = /^activity:[a-z0-9][a-z0-9-]{1,100}$/u;

/**
 * Loads an Explore source scoped only by the authenticated user's current personal workspace.
 * The caller can select a goal/activity but can never supply a workspace identifier.
 */
export async function loadCurrentDatabaseExploreSourceV1(
  client: CurrentExploreSourceRpcClient,
  query: CurrentExploreSourceQueryV1,
): Promise<ExploreSourceV1> {
  if (typeof query.readinessGoalKey !== "string" || !GOAL_KEY.test(query.readinessGoalKey))
    throw new TypeError("readinessGoalKey is invalid.");
  if (
    query.selectedActivityKey !== undefined &&
    query.selectedActivityKey !== null &&
    (typeof query.selectedActivityKey !== "string" || !ACTIVITY_KEY.test(query.selectedActivityKey))
  ) {
    throw new TypeError("selectedActivityKey is invalid.");
  }

  let result: CurrentExploreSourceRpcResult;
  try {
    result = await client.rpc(CURRENT_EXPLORE_SOURCE_RPC_V1, {
      p_readiness_goal_key: query.readinessGoalKey,
      ...(query.selectedActivityKey === undefined || query.selectedActivityKey === null
        ? {}
        : { p_selected_activity_key: query.selectedActivityKey }),
    });
  } catch {
    throw new CurrentExploreSourceAccessError();
  }
  if (result.error !== null) throw new CurrentExploreSourceAccessError();

  const source = decodeExploreSourceV1(result.data);
  const selectedActivityKey = query.selectedActivityKey ?? null;
  const activityRefs = source.nodes
    .filter(({ nodeType }) => nodeType === "ACTIVITY")
    .map(({ nodeRef }) => nodeRef);
  const violations = [
    ...(source.readinessGoalKey === query.readinessGoalKey
      ? []
      : [
          {
            code: "CURRENT_EXPLORE_SOURCE_QUERY_GOAL_MISMATCH",
            path: "/readinessGoalKey",
            message: "Response readiness goal must match the authorized selector.",
          },
        ]),
    ...(selectedActivityKey === null
      ? activityRefs.length === 0
        ? []
        : [
            {
              code: "CURRENT_EXPLORE_SOURCE_UNSELECTED_ACTIVITY_PRESENT",
              path: "/nodes",
              message: "An unselected query cannot return activity nodes.",
            },
          ]
      : activityRefs.length === 1 && activityRefs[0] === selectedActivityKey
        ? []
        : [
            {
              code: "CURRENT_EXPLORE_SOURCE_SELECTED_ACTIVITY_MISMATCH",
              path: "/nodes",
              message: "The response must contain exactly the selected activity.",
            },
          ]),
  ];
  if (violations.length > 0) throw new ExploreSourceContractError(violations);
  return source;
}
