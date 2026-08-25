// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  computeGraphStructuralFingerprint,
  validateGraphProjectionSemantics,
} from "../../src/shared/contracts/graph-projection";
import {
  canonicalize,
  sha256,
  type JsonObject,
  type JsonValue,
} from "../../src/shared/contracts/json";
import { validateSchema } from "../../src/shared/contracts/schema-registry";
import { materializeGraphStressProjection } from "./graph-stress-materializer";
import { cloneJson, readJson } from "./support";

interface GraphCase {
  readonly caseId: string;
  readonly path: string;
  readonly expectedSchemaValid: boolean | string;
  readonly expectedSemanticValid: boolean;
  readonly expectedViolations: readonly string[];
}

function violationCodes(result: ReturnType<typeof validateGraphProjectionSemantics>): string[] {
  return result.valid ? [] : result.violations.map((item) => item.code).sort();
}

function itemById(items: JsonObject[], idField: string, id: string): JsonObject {
  const item = items.find((candidate) => candidate[idField] === id);
  if (item === undefined) throw new Error(`No ${idField} ${id}`);
  return item;
}

interface OracleOperation {
  readonly path: string;
  readonly kind: "ADD_NUMBER" | "ADD_STRUCTURAL_EDGE" | "REPLACE";
  readonly value: JsonValue;
}

function applyOracleOperation(projection: JsonObject, operation: OracleOperation): void {
  if (operation.kind === "ADD_STRUCTURAL_EDGE") {
    (projection.edges as JsonObject[]).push(operation.value as JsonObject);
    return;
  }
  const nodeMatch = /^nodes\[([^\]]+)]\.(.+)$/.exec(operation.path);
  const positionMatch = /^layout\.positions\[([^\]]+)]\.(.+)$/.exec(operation.path);
  let target: JsonObject = projection;
  let path = operation.path;
  if (nodeMatch !== null) {
    target = itemById(projection.nodes as JsonObject[], "nodeId", nodeMatch[1]!);
    path = nodeMatch[2]!;
  } else if (positionMatch !== null) {
    const layout = projection.layout as JsonObject;
    target = itemById(layout.positions as JsonObject[], "nodeId", positionMatch[1]!);
    path = positionMatch[2]!;
  }
  const parts = path.split(".");
  const field = parts.pop()!;
  for (const part of parts) target = target[part] as JsonObject;
  target[field] =
    operation.kind === "ADD_NUMBER"
      ? Number(target[field]) + Number(operation.value)
      : operation.value;
}

describe("GraphProjectionV1 runtime contract", () => {
  const manifest = readJson("graph/v1/fixture-manifest.json");
  for (const testCase of manifest.cases as unknown as GraphCase[]) {
    if (typeof testCase.expectedSchemaValid !== "boolean") continue;
    it(`executes graph fixture ${testCase.caseId}`, () => {
      const projection = readJson(`graph/v1/${testCase.path}`);
      const structural = validateSchema("graph-projection", projection);
      expect(structural.valid).toBe(testCase.expectedSchemaValid);
      if (!structural.valid) {
        expect(testCase.expectedSemanticValid).toBe(false);
        return;
      }
      const semantic = validateGraphProjectionSemantics(projection);
      expect(semantic.valid).toBe(testCase.expectedSemanticValid);
      expect(violationCodes(semantic)).toEqual([...testCase.expectedViolations].sort());
    });
  }

  it("reproduces every structural fingerprint oracle", () => {
    const descriptor = readJson("graph/v1/graph-projection-v1.fingerprint-oracles.json");
    const base = readJson(`graph/v1/${String(descriptor.baseFixturePath)}`);
    expect(computeGraphStructuralFingerprint(base)).toBe(descriptor.baseFingerprint);
    for (const testCase of descriptor.cases as unknown as Array<{
      caseId: string;
      operation: OracleOperation;
      companionOperation?: OracleOperation;
      expectedFingerprint: string;
    }>) {
      const projection = cloneJson(base);
      applyOracleOperation(projection, testCase.operation);
      if (testCase.companionOperation !== undefined) {
        applyOracleOperation(projection, testCase.companionOperation);
      }
      expect(computeGraphStructuralFingerprint(projection), testCase.caseId).toBe(
        testCase.expectedFingerprint,
      );
    }
  });

  it("materializes and validates the complete deterministic 500-node stress descriptor", () => {
    const descriptor = readJson("graph/v1/graph-projection-v1.stress-profile.json");
    const materialization = cloneJson(descriptor.materialization as JsonObject);
    const declaredRecipeFingerprint = String(materialization.recipeFingerprint);
    delete materialization.recipeFingerprint;
    expect(sha256(canonicalize(materialization))).toBe(declaredRecipeFingerprint);

    const projection = materializeGraphStressProjection();
    const expanded = Buffer.from(`${JSON.stringify(projection, null, 2)}\n`, "utf8");
    const expandedOracle = (descriptor.structuralOracle as JsonObject)
      .expandedArtifactHashAndByteMetrics as JsonObject;
    expect(expanded.byteLength).toBe(expandedOracle.byteLength);
    expect(sha256(expanded)).toBe(expandedOracle.sha256);
    const oracle = descriptor.structuralOracle as JsonObject;
    expect((projection.nodes as JsonObject[]).length).toBe(oracle.nodeCount);
    expect((projection.edges as JsonObject[]).length).toBe(oracle.edgeCount);
    expect(((projection.requirements as JsonObject).rules as JsonObject[]).length).toBe(
      oracle.ruleCount,
    );
    expect(((projection.outline as JsonObject).items as JsonObject[]).length).toBe(
      oracle.outlineItemCount,
    );
    expect((projection.layout as JsonObject).structuralFingerprint).toBe(
      oracle.structuralFingerprint,
    );
    expect(validateSchema("graph-projection", projection)).toEqual({
      valid: true,
      violations: [],
    });
    expect(validateGraphProjectionSemantics(projection)).toEqual({
      valid: true,
      violations: [],
    });
  });
});
