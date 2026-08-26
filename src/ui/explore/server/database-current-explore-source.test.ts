// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  CURRENT_EXPLORE_SOURCE_RPC_V1,
  CurrentExploreSourceAccessError,
  type CurrentExploreSourceRpcClient,
  loadCurrentDatabaseExploreSourceV1,
} from "./database-current-explore-source";
import { ExploreSourceContractError } from "./explore-source-v1";

function validSource(selectedActivityKey: string | null = null): Record<string, unknown> {
  const source = JSON.parse(
    readFileSync(
      resolve(
        process.cwd(),
        "tests/fixtures/explore-source/v1/valid/explore-source-v1.personal.json",
      ),
      "utf8",
    ),
  ) as Record<string, unknown>;
  if (selectedActivityKey === null) return source;

  (source.nodes as Record<string, unknown>[]).unshift({
    nodeRef: selectedActivityKey,
    nodeType: "ACTIVITY",
    title: "Selected activity",
    domainRef: null,
    origin: "WORKSPACE_OVERLAY",
    workspaceId: source.workspaceId,
    activityType: "MANUAL_CODING",
    targetCompetencyRef: "competency:linux-log-triage",
  });
  (source.edges as Record<string, unknown>[]).unshift({
    edgeKey: "edge:activity-evidences:linux-log-triage-lab:linux-log-triage",
    edgeType: "ACTIVITY_EVIDENCES",
    sourceRef: selectedActivityKey,
    targetRef: "competency:linux-log-triage",
    blocking: false,
    origin: "WORKSPACE_OVERLAY",
    workspaceId: source.workspaceId,
  });
  source.nodeCount = (source.nodes as unknown[]).length;
  source.edgeCount = (source.edges as unknown[]).length;
  return source;
}

function clientWith(result: { data: unknown; error: unknown | null }): {
  readonly client: CurrentExploreSourceRpcClient;
  readonly rpc: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn().mockResolvedValue(result);
  return { client: { rpc }, rpc };
}

describe("database current Explore source adapter", () => {
  it("sends no workspace input to the current-personal RPC", async () => {
    const { client, rpc } = clientWith({ data: validSource(), error: null });

    await loadCurrentDatabaseExploreSourceV1(client, {
      readinessGoalKey: "goal:personal-main",
    });

    expect(rpc).toHaveBeenCalledWith(CURRENT_EXPLORE_SOURCE_RPC_V1, {
      p_readiness_goal_key: "goal:personal-main",
    });
    expect(rpc.mock.calls[0]?.[1]).not.toHaveProperty("p_workspace_id");
  });

  it("passes the optional selected activity without adding a workspace selector", async () => {
    const selectedActivityKey = "activity:linux-log-triage-lab";
    const { client, rpc } = clientWith({ data: validSource(selectedActivityKey), error: null });

    await loadCurrentDatabaseExploreSourceV1(client, {
      readinessGoalKey: "goal:personal-main",
      selectedActivityKey,
    });

    expect(rpc).toHaveBeenCalledWith(CURRENT_EXPLORE_SOURCE_RPC_V1, {
      p_readiness_goal_key: "goal:personal-main",
      p_selected_activity_key: selectedActivityKey,
    });
  });

  it("collapses database details into one safe access error", async () => {
    const { client } = clientWith({
      data: null,
      error: { code: "42501", details: "Private note sentinel: rain-forest-42" },
    });
    const promise = loadCurrentDatabaseExploreSourceV1(client, {
      readinessGoalKey: "goal:personal-main",
    });

    await expect(promise).rejects.toEqual(new CurrentExploreSourceAccessError());
    await expect(promise).rejects.not.toThrow(/42501|rain-forest-42/u);
  });

  it("fails closed when the response goal does not match the requested selector", async () => {
    const source = validSource();
    source.readinessGoalKey = "goal:other-main";
    const { client } = clientWith({ data: source, error: null });

    await expect(
      loadCurrentDatabaseExploreSourceV1(client, { readinessGoalKey: "goal:personal-main" }),
    ).rejects.toEqual(
      expect.objectContaining({
        violations: expect.arrayContaining([
          expect.objectContaining({ code: "CURRENT_EXPLORE_SOURCE_QUERY_GOAL_MISMATCH" }),
        ]),
      }),
    );
  });

  it.each([
    [{ readinessGoalKey: "goal:UPPERCASE" }, "readinessGoalKey"],
    [
      {
        readinessGoalKey: "goal:personal-main",
        selectedActivityKey: "competency:not-activity",
      },
      "selectedActivityKey",
    ],
  ] as const)("rejects invalid input before access: %s", async (query, field) => {
    const { client, rpc } = clientWith({ data: validSource(), error: null });

    await expect(loadCurrentDatabaseExploreSourceV1(client, query)).rejects.toThrow(field);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("keeps the existing source decoder error type for malformed responses", async () => {
    const { client } = clientWith({ data: { nodeCount: 25 }, error: null });
    await expect(
      loadCurrentDatabaseExploreSourceV1(client, { readinessGoalKey: "goal:personal-main" }),
    ).rejects.toBeInstanceOf(ExploreSourceContractError);
  });
});
