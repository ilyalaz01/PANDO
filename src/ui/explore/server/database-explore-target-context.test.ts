// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  EXPLORE_TARGET_CONTEXT_RPC_V1,
  ExploreTargetContextAccessError,
  type ExploreTargetContextRpcClient,
  loadDatabaseExploreTargetContextV1,
} from "./database-explore-target-context";
import { ExploreTargetContextContractError } from "./explore-target-context-v1";

function validContext(): Record<string, unknown> {
  return JSON.parse(
    readFileSync(
      resolve(
        process.cwd(),
        "tests/fixtures/explore-target-context/v1/valid/explore-target-context-v1.canonical.json",
      ),
      "utf8",
    ),
  ) as Record<string, unknown>;
}

function clientWith(result: { data: unknown; error: unknown | null }): {
  readonly client: ExploreTargetContextRpcClient;
  readonly rpc: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn().mockResolvedValue(result);
  return { client: { rpc }, rpc };
}

describe("database Explore target-context adapter", () => {
  it("sends only the authorized goal selector to the zero-workspace RPC", async () => {
    const { client, rpc } = clientWith({ data: validContext(), error: null });

    const context = await loadDatabaseExploreTargetContextV1(client, {
      readinessGoalKey: "goal:canonical-main",
    });

    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith(EXPLORE_TARGET_CONTEXT_RPC_V1, {
      p_readiness_goal_key: "goal:canonical-main",
    });
    expect(rpc.mock.calls[0]?.[1]).not.toHaveProperty("p_workspace_id");
    expect(context.scope.requiredCanonicalNodeRefs).toEqual(["competency:beta"]);
  });

  it("collapses database and authorization details into one safe access error", async () => {
    const privateError = {
      code: "42501",
      message: "readiness goal is not accessible",
      details: "Private note sentinel: rain-forest-42",
    };
    const { client } = clientWith({ data: null, error: privateError });

    const promise = loadDatabaseExploreTargetContextV1(client, {
      readinessGoalKey: "goal:canonical-main",
    });
    await expect(promise).rejects.toEqual(new ExploreTargetContextAccessError());
    await expect(promise).rejects.not.toThrow(/42501|rain-forest-42|not accessible/u);
  });

  it("collapses a rejected RPC without retaining private details", async () => {
    const rpc = vi.fn().mockRejectedValue(new Error("JWT sentinel: rain-forest-42"));
    const client: ExploreTargetContextRpcClient = { rpc };
    const promise = loadDatabaseExploreTargetContextV1(client, {
      readinessGoalKey: "goal:canonical-main",
    });

    await expect(promise).rejects.toBeInstanceOf(ExploreTargetContextAccessError);
    await expect(promise).rejects.not.toThrow(/JWT sentinel|rain-forest-42/u);
  });

  it("binds the decoded goal to the requested selector", async () => {
    const response = validContext();
    (response.readinessGoal as Record<string, unknown>).readinessGoalKey = "goal:other-main";
    const { client } = clientWith({ data: response, error: null });

    try {
      await loadDatabaseExploreTargetContextV1(client, {
        readinessGoalKey: "goal:canonical-main",
      });
      expect.unreachable("A mismatched target context must fail closed");
    } catch (error) {
      expect(error).toBeInstanceOf(ExploreTargetContextContractError);
      expect((error as ExploreTargetContextContractError).violations).toContainEqual(
        expect.objectContaining({ code: "EXPLORE_TARGET_QUERY_GOAL_MISMATCH" }),
      );
    }
  });

  it("rejects malformed success data instead of using a fixture fallback", async () => {
    const { client } = clientWith({ data: { requirementRules: [] }, error: null });
    await expect(
      loadDatabaseExploreTargetContextV1(client, {
        readinessGoalKey: "goal:canonical-main",
      }),
    ).rejects.toBeInstanceOf(ExploreTargetContextContractError);
  });

  it.each(["goal:UPPERCASE", "target:not-a-goal", `goal:${"a".repeat(102)}`])(
    "rejects an invalid goal before database access: %s",
    async (readinessGoalKey) => {
      const { client, rpc } = clientWith({ data: validContext(), error: null });
      await expect(
        loadDatabaseExploreTargetContextV1(client, { readinessGoalKey }),
      ).rejects.toThrow("readinessGoalKey");
      expect(rpc).not.toHaveBeenCalled();
    },
  );

  it.each([["goal:canonical-main"], { toString: () => "goal:canonical-main" }])(
    "rejects a coercible non-string goal before database access",
    async (readinessGoalKey) => {
      const { client, rpc } = clientWith({ data: validContext(), error: null });
      await expect(
        loadDatabaseExploreTargetContextV1(client, {
          readinessGoalKey: readinessGoalKey as unknown as string,
        }),
      ).rejects.toThrow("readinessGoalKey");
      expect(rpc).not.toHaveBeenCalled();
    },
  );
});
