// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  EXPLORE_SOURCE_RPC_V1,
  ExploreSourceAccessError,
  loadDatabaseExploreSourceV1,
  type AuthenticatedUserScopedRpcClient,
} from "./database-explore-source";
import { ExploreSourceContractError } from "./explore-source-v1";

const WORKSPACE_ID = "10000000-0000-4000-8000-000000000001";

function validSource(selectedActivityKey?: string): Record<string, unknown> {
  const source = JSON.parse(
    readFileSync(
      resolve(
        process.cwd(),
        "tests/fixtures/explore-source/v1/valid/explore-source-v1.personal.json",
      ),
      "utf8",
    ),
  ) as Record<string, unknown>;
  if (selectedActivityKey !== undefined) {
    const nodes = source.nodes as Record<string, unknown>[];
    const edges = source.edges as Record<string, unknown>[];
    nodes.unshift({
      nodeRef: selectedActivityKey,
      nodeType: "ACTIVITY",
      title: "Linux log triage lab",
      domainRef: null,
      origin: "WORKSPACE_OVERLAY",
      workspaceId: WORKSPACE_ID,
      activityType: "MANUAL_CODING",
      targetCompetencyRef: "competency:linux-log-triage",
    });
    edges.unshift({
      edgeKey: "edge:activity-evidences:linux-log-triage-lab:linux-log-triage",
      edgeType: "ACTIVITY_EVIDENCES",
      sourceRef: selectedActivityKey,
      targetRef: "competency:linux-log-triage",
      blocking: false,
      origin: "WORKSPACE_OVERLAY",
      workspaceId: WORKSPACE_ID,
    });
    source.nodeCount = nodes.length;
    source.edgeCount = edges.length;
  }
  return source;
}

function clientWith(result: { data: unknown; error: unknown | null }): {
  readonly client: AuthenticatedUserScopedRpcClient;
  readonly rpc: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn().mockResolvedValue(result);
  return { client: { rpc }, rpc };
}

describe("database Explore source adapter", () => {
  it("calls only the versioned purpose-specific RPC with exact user-scope arguments", async () => {
    const selectedActivityKey = "activity:linux-log-triage-lab";
    const { client, rpc } = clientWith({
      data: validSource(selectedActivityKey),
      error: null,
    });

    const source = await loadDatabaseExploreSourceV1(client, {
      workspaceId: WORKSPACE_ID,
      readinessGoalKey: "goal:personal-main",
      selectedActivityKey,
    });

    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith(EXPLORE_SOURCE_RPC_V1, {
      p_workspace_id: WORKSPACE_ID,
      p_readiness_goal_key: "goal:personal-main",
      p_selected_activity_key: "activity:linux-log-triage-lab",
    });
    expect(source.contract).toEqual({ name: "ExploreSourceV1", version: "1.0.0" });
  });

  it("sends null for an unselected activity", async () => {
    const { client, rpc } = clientWith({ data: validSource(), error: null });
    await loadDatabaseExploreSourceV1(client, {
      workspaceId: WORKSPACE_ID,
      readinessGoalKey: "goal:personal-main",
    });
    expect(rpc).toHaveBeenCalledWith(
      EXPLORE_SOURCE_RPC_V1,
      expect.objectContaining({ p_selected_activity_key: null }),
    );
  });

  it("collapses authorization and database details into one safe error", async () => {
    const privateDatabaseError = {
      code: "42501",
      message: "workspace is not accessible",
      details: "Private note sentinel: rain-forest-42",
    };
    const { client } = clientWith({ data: null, error: privateDatabaseError });

    await expect(
      loadDatabaseExploreSourceV1(client, {
        workspaceId: WORKSPACE_ID,
        readinessGoalKey: "goal:personal-main",
      }),
    ).rejects.toEqual(new ExploreSourceAccessError());
    await expect(
      loadDatabaseExploreSourceV1(client, {
        workspaceId: WORKSPACE_ID,
        readinessGoalKey: "goal:personal-main",
      }),
    ).rejects.not.toThrow(/42501|rain-forest-42|workspace is not accessible/u);
  });

  it("collapses a rejected RPC promise without retaining its private details", async () => {
    const rpc = vi.fn().mockRejectedValue(new Error("JWT sentinel: rain-forest-42"));
    const client: AuthenticatedUserScopedRpcClient = { rpc };
    const promise = loadDatabaseExploreSourceV1(client, {
      workspaceId: WORKSPACE_ID,
      readinessGoalKey: "goal:personal-main",
    });

    await expect(promise).rejects.toBeInstanceOf(ExploreSourceAccessError);
    await expect(promise).rejects.not.toThrow(/JWT sentinel|rain-forest-42/u);
  });

  it.each([
    ["workspace", "EXPLORE_SOURCE_QUERY_WORKSPACE_MISMATCH"],
    ["goal", "EXPLORE_SOURCE_QUERY_GOAL_MISMATCH"],
  ] as const)("binds the decoded %s identity to the authorized query", async (field, code) => {
    const response = validSource();
    if (field === "workspace") {
      response.workspaceId = "20000000-0000-4000-8000-000000000002";
      ((response.nodes as Record<string, unknown>[])[0] as Record<string, unknown>).workspaceId =
        response.workspaceId;
      ((response.edges as Record<string, unknown>[])[0] as Record<string, unknown>).workspaceId =
        response.workspaceId;
      (
        (response.positions as Record<string, unknown>[])[0] as Record<string, unknown>
      ).workspaceId = response.workspaceId;
    } else {
      response.readinessGoalKey = "goal:other-main";
    }
    const { client } = clientWith({ data: response, error: null });

    try {
      await loadDatabaseExploreSourceV1(client, {
        workspaceId: WORKSPACE_ID,
        readinessGoalKey: "goal:personal-main",
      });
      expect.unreachable("A mismatched response must fail closed");
    } catch (error) {
      expect(error).toBeInstanceOf(ExploreSourceContractError);
      expect((error as ExploreSourceContractError).violations).toContainEqual(
        expect.objectContaining({ code }),
      );
    }
  });

  it("requires exactly the activity selected by the authorized query", async () => {
    const { client } = clientWith({ data: validSource(), error: null });
    await expect(
      loadDatabaseExploreSourceV1(client, {
        workspaceId: WORKSPACE_ID,
        readinessGoalKey: "goal:personal-main",
        selectedActivityKey: "activity:linux-log-triage-lab",
      }),
    ).rejects.toBeInstanceOf(ExploreSourceContractError);

    const unexpected = clientWith({
      data: validSource("activity:linux-log-triage-lab"),
      error: null,
    });
    await expect(
      loadDatabaseExploreSourceV1(unexpected.client, {
        workspaceId: WORKSPACE_ID,
        readinessGoalKey: "goal:personal-main",
      }),
    ).rejects.toBeInstanceOf(ExploreSourceContractError);
  });

  it("rejects a malformed successful response instead of falling back to demo data", async () => {
    const { client } = clientWith({ data: { nodeCount: 25 }, error: null });
    await expect(
      loadDatabaseExploreSourceV1(client, {
        workspaceId: WORKSPACE_ID,
        readinessGoalKey: "goal:personal-main",
      }),
    ).rejects.toBeInstanceOf(ExploreSourceContractError);
  });

  it.each([
    [{ workspaceId: "not-a-uuid", readinessGoalKey: "goal:personal-main" }, "workspaceId"],
    [{ workspaceId: WORKSPACE_ID, readinessGoalKey: "goal:UPPERCASE" }, "readinessGoalKey"],
    [
      {
        workspaceId: WORKSPACE_ID,
        readinessGoalKey: "goal:personal-main",
        selectedActivityKey: "competency:not-an-activity",
      },
      "selectedActivityKey",
    ],
  ] as const)("rejects invalid RPC input before access: %s", async (query, field) => {
    const { client, rpc } = clientWith({ data: validSource(), error: null });
    await expect(loadDatabaseExploreSourceV1(client, query)).rejects.toThrow(field);
    expect(rpc).not.toHaveBeenCalled();
  });
});
