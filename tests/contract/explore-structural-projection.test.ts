// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  computeExploreStructuralFingerprint,
  validateExploreStructuralProjection,
  validateExploreStructuralProjectionSemantics,
} from "../../src/shared/contracts/explore-structural-projection";
import { type JsonObject, type JsonValue } from "../../src/shared/contracts/json";
import { schemaId, validateSchema } from "../../src/shared/contracts/schema-registry";
import { applyPatch, cloneJson, readJson } from "./support";

interface MutationCase {
  readonly caseId: string;
  readonly patch: Parameters<typeof applyPatch>[1];
  readonly expectedSchemaValid: boolean;
  readonly expectedViolations: readonly string[];
}

interface FixtureManifest {
  readonly base: string;
  readonly validCases: readonly { readonly caseId: string; readonly path: string }[];
  readonly descriptors: readonly string[];
}

function codes(value: unknown): string[] {
  const result = validateExploreStructuralProjection(value);
  return result.valid ? [] : result.violations.map(({ code }) => code).sort();
}

function forbiddenCalculationKeys(value: JsonValue, path = ""): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => forbiddenCalculationKeys(item, `${path}/${index}`));
  }
  if (typeof value !== "object" || value === null) return [];
  const forbidden = new Set([
    "achievementLevel",
    "attainment",
    "blocker",
    "confidence",
    "coverage",
    "estimate",
    "floorStatus",
    "mastery",
    "readiness",
    "score",
    "state",
  ]);
  return Object.entries(value).flatMap(([key, child]) => [
    ...(forbidden.has(key) ? [`${path}/${key}`] : []),
    ...forbiddenCalculationKeys(child, `${path}/${key}`),
  ]);
}

describe("ExploreStructuralProjectionV1 runtime contract", () => {
  const root = "explore-structural-projection/v1";
  const manifest = readJson(`${root}/fixture-manifest.json`) as unknown as FixtureManifest;

  for (const testCase of manifest.validCases) {
    it(`accepts valid fixture ${testCase.caseId}`, () => {
      const projection = readJson(`${root}/${testCase.path}`);
      expect(validateSchema("explore-structural-projection", projection)).toEqual({
        valid: true,
        violations: [],
      });
      expect(validateExploreStructuralProjectionSemantics(projection)).toEqual({
        valid: true,
        violations: [],
      });
      expect(validateExploreStructuralProjection(projection)).toEqual({
        valid: true,
        violations: [],
      });
      expect(forbiddenCalculationKeys(projection)).toEqual([]);
    });
  }

  for (const descriptorPath of manifest.descriptors) {
    const descriptor = readJson(`${root}/${descriptorPath}`);
    for (const testCase of descriptor.cases as unknown as MutationCase[]) {
      it(`rejects fixture mutation ${testCase.caseId}`, () => {
        const value = applyPatch(readJson(`${root}/${manifest.base}`), testCase.patch);
        const structural = validateSchema("explore-structural-projection", value);
        expect(structural.valid).toBe(testCase.expectedSchemaValid);
        expect(codes(value)).toEqual([...testCase.expectedViolations].sort());
      });
    }
  }

  it("registers the independent strict schema ID", () => {
    expect(schemaId("explore-structural-projection")).toBe(
      "https://schemas.pando.dev/explore-structural-projection/v1/explore-structural-projection.schema.json",
    );
  });

  it("names owner stable keys as keys and rejects UUID-style ID aliases", () => {
    const projection = readJson(`${root}/${manifest.base}`);
    expect(projection.selectedVersions).toEqual({
      catalogVersionKey: "catalog:seed-v1",
      roadmapVersionKey: "roadmap:seed-v1",
      targetProfileVersionKey: "target:seed-v1",
    });
    expect((projection.requirements as JsonObject).targetProfileVersionKey).toBe("target:seed-v1");

    const aliased = cloneJson(projection);
    const selected = aliased.selectedVersions as JsonObject;
    selected.catalogVersionId = selected.catalogVersionKey!;
    delete selected.catalogVersionKey;
    expect(validateSchema("explore-structural-projection", aliased).valid).toBe(false);
  });

  it("rejects unstable collection and ID-only-list ordering", () => {
    const projection = cloneJson(readJson(`${root}/${manifest.base}`));
    (projection.nodes as JsonObject[]).reverse();
    ((projection.visibilityHints as JsonObject).defaultVisibleNodeIds as JsonValue[]).reverse();

    expect(codes(projection)).toEqual([
      "STRUCTURAL_NODES_NOT_SORTED",
      "STRUCTURAL_VISIBILITY_IDS_NOT_SORTED",
    ]);
  });

  it("detects a prerequisite cycle independently of other visual edge types", () => {
    const projection = cloneJson(readJson(`${root}/${manifest.base}`));
    const edges = projection.edges as JsonObject[];
    edges.splice(2, 0, {
      edgeId: "edge:prerequisite:beta:alpha",
      edgeType: "PREREQUISITE_OF",
      sourceNodeId: "node:competency:beta",
      targetNodeId: "node:competency:alpha",
      origin: { kind: "CANONICAL", sourceVersionId: "catalog:seed-v1" },
      blocking: true,
      rationale: "Invalid reverse prerequisite used by the contract fixture.",
      accessibilityLabel: "Beta application is a prerequisite of alpha foundations.",
      visibilityHint: { defaultVisible: true, reasonCode: "ACTIVE_PREREQUISITE" },
    });
    const visibility = projection.visibilityHints as JsonObject;
    (visibility.defaultVisibleEdgeIds as JsonValue[]).splice(2, 0, "edge:prerequisite:beta:alpha");
    visibility.totalEdgeCount = 4;
    (projection.layout as JsonObject).structuralFingerprint =
      computeExploreStructuralFingerprint(projection);

    expect(codes(projection)).toEqual(["STRUCTURAL_PREREQUISITE_CYCLE"]);
  });

  it("keeps the fingerprint independent of definitions, state-free text, and position overrides", () => {
    const base = readJson(`${root}/${manifest.base}`);
    const changed = cloneJson(base);
    (changed.nodes as JsonObject[])[2]!.title = "Renamed beta";
    ((changed.requirements as JsonObject).rules as JsonObject[])[0]!.explanation =
      "Updated requirement-definition explanation.";
    const position = ((changed.layout as JsonObject).positions as JsonObject[])[3]!;
    (position.effective as JsonObject).x = 1200;

    expect(computeExploreStructuralFingerprint(changed)).toBe(
      computeExploreStructuralFingerprint(base),
    );
  });

  it("changes the fingerprint for topology and layout recipe changes", () => {
    const base = readJson(`${root}/${manifest.base}`);
    const topology = cloneJson(base);
    (topology.edges as JsonObject[])[0]!.targetNodeId = "node:competency:alpha";
    const recipe = cloneJson(base);
    ((recipe.layout as JsonObject).spacing as JsonObject).rank = 89;

    expect(computeExploreStructuralFingerprint(topology)).not.toBe(
      computeExploreStructuralFingerprint(base),
    );
    expect(computeExploreStructuralFingerprint(recipe)).not.toBe(
      computeExploreStructuralFingerprint(base),
    );
  });
});
