// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  validateAgentChangeSet,
  validateAgentChangeSetSemantics,
  validateAgentControlContext,
  validateAgentControlContextSemantics,
} from "../../src/shared/contracts/agent-control";
import type { JsonObject } from "../../src/shared/contracts/json";
import { applyPatch, readJson } from "./support";

function codes(result: ReturnType<typeof validateAgentChangeSet>): string[] {
  return result.valid ? [] : result.violations.map((item) => item.code);
}

describe("Agent Control runtime contracts", () => {
  it("accepts the compact control context within the 12 KiB budget", () => {
    const context = readJson("agent-control/v1/valid/control-context.minimal.json");
    expect(validateAgentControlContext(context, { expectedWorkspaceId: "ws:personal" })).toEqual({
      valid: true,
      violations: [],
    });
  });

  it("rejects an authorized-workspace mismatch", () => {
    const context = readJson("agent-control/v1/valid/control-context.minimal.json");
    const result = validateAgentControlContext(context, {
      expectedWorkspaceId: "ws:other",
    });
    expect(codes(result)).toContain("AGENT_CONTEXT_WORKSPACE_MISMATCH");
  });

  it("enforces the serialized root budget independently of schema limits", () => {
    const context = readJson("agent-control/v1/valid/control-context.minimal.json");
    const result = validateAgentControlContextSemantics(context, {
      maximumSerializedBytes: 100,
    });
    expect(codes(result)).toContain("AGENT_CONTEXT_SIZE_LIMIT");
  });

  it("rejects unresolved detail refs and inconsistent campaign goal linkage", () => {
    const context = readJson("agent-control/v1/valid/control-context.minimal.json");
    const changed = applyPatch(context, [
      { op: "replace", path: "/blockers/0/detail_ref", value: "detail:missing" },
      { op: "replace", path: "/active_campaign/readiness_goal_id", value: "goal:missing" },
    ]);
    const result = validateAgentControlContext(changed);
    expect(codes(result)).toEqual(
      expect.arrayContaining([
        "AGENT_CONTEXT_DETAIL_REF_MISSING",
        "AGENT_CONTEXT_READINESS_GOAL_MISSING",
      ]),
    );
  });

  it("accepts the cancelled-campaign preview at an explicit pre-expiry clock", () => {
    const changeSet = readJson("agent-control/v1/valid/change-set.cancel-campaign.previewed.json");
    expect(
      validateAgentChangeSet(changeSet, {
        aggregateVersions: { "campaign:interview": 3 },
        now: new Date("2026-08-25T18:05:00Z"),
      }),
    ).toEqual({ valid: true, violations: [] });
  });

  it("rejects operation/argument mismatch and stale aggregate version", () => {
    const changeSet = readJson("agent-control/v1/valid/change-set.cancel-campaign.previewed.json");
    const changed = applyPatch(changeSet, [
      { op: "remove", path: "/operations/0/arguments/lifecycle_reason" },
      { op: "add", path: "/operations/0/arguments/deadline", value: "2026-09-30" },
    ]);
    const result = validateAgentChangeSet(changed, {
      aggregateVersions: { "campaign:interview": 4 },
    });
    expect(codes(result)).toEqual(
      expect.arrayContaining([
        "AGENT_CHANGE_SET_ARGUMENT_REQUIRED",
        "AGENT_CHANGE_SET_ARGUMENT_FORBIDDEN",
        "AGENT_CHANGE_SET_STALE_AGGREGATE_VERSION",
      ]),
    );
  });

  it("binds applied confirmation to the preview and requires watermark advance", () => {
    const changeSet = readJson("agent-control/v1/valid/change-set.cancel-campaign.previewed.json");
    const applied = applyPatch(changeSet, [
      { op: "replace", path: "/status", value: "applied" },
      {
        op: "replace",
        path: "/confirmation",
        value: {
          preview_digest: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          confirmed_at: "2026-08-25T18:06:00Z",
        },
      },
      {
        op: "replace",
        path: "/result",
        value: {
          plan_revision_id: "revision:cancel-interview",
          resulting_projection_watermark: 42,
          applied_at: "2026-08-25T18:06:01Z",
        },
      },
    ]);
    const result = validateAgentChangeSet(applied);
    expect(codes(result)).toEqual(
      expect.arrayContaining([
        "AGENT_CHANGE_SET_CONFIRMATION_DIGEST_MISMATCH",
        "AGENT_CHANGE_SET_RESULT_WATERMARK_INVALID",
      ]),
    );
  });

  it("rejects creation operations that claim an existing aggregate", () => {
    const changeSet = readJson("agent-control/v1/valid/change-set.cancel-campaign.previewed.json");
    const operation = (changeSet.operations as JsonObject[])[0]!;
    operation.operation_type = "create_goal";
    operation.arguments = { title: "New direction", goal_kind: "growth" };
    const result = validateAgentChangeSetSemantics(changeSet);
    expect(codes(result)).toContain("AGENT_CHANGE_SET_CREATE_AGGREGATE_VERSION");
  });
});
