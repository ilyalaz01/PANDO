// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  archiveLimitInput,
  validateArchiveEntries,
  validateArchiveLimits,
  validateRetentionQuota,
} from "../../src/shared/contracts/preparation-archive";
import {
  computePreparationPackContentFingerprint,
  type PreparationCatalogState,
  type PreparationPackInput,
  validatePreparationPack,
  validatePreparationPackSemantics,
} from "../../src/shared/contracts/preparation-pack";
import { validateSchema } from "../../src/shared/contracts/schema-registry";
import type { JsonObject, JsonValue } from "../../src/shared/contracts/json";
import {
  applyPatch,
  cloneJson,
  loadPreparationPack,
  readJson,
  replacePackDocument,
} from "./support";

interface SemanticCase {
  readonly case_id: string;
  readonly base?: string;
  readonly fixture?: string;
  readonly patch?: Parameters<typeof applyPatch>[1];
  readonly catalog_state?: {
    readonly catalog_version: string;
    readonly competency_ids: readonly string[];
    readonly prerequisite_edges: readonly { readonly from: string; readonly to: string }[];
  };
  readonly expected: {
    readonly structural: string;
    readonly semantic: string;
    readonly code: string;
  };
}

function expectedCodes(result: ReturnType<typeof validatePreparationPack>): string[] {
  return result.valid ? [] : result.violations.map((item) => item.code);
}

function semanticCases(path: string): SemanticCase[] {
  return readJson(path).cases as unknown as SemanticCase[];
}

function materializeSemanticCase(testCase: SemanticCase): PreparationPackInput {
  let pack = loadPreparationPack("minimal");
  if (testCase.fixture !== undefined) {
    return replacePackDocument(
      pack,
      "target-profile.json",
      readJson(`preparation-pack/${testCase.fixture}`),
    );
  }
  if (testCase.base === undefined || testCase.patch === undefined) {
    throw new Error(`Case ${testCase.case_id} has no materialization recipe`);
  }
  const fileName = testCase.base.split("/").at(-1)!;
  const current =
    fileName === "manifest.json"
      ? (pack.manifest as JsonObject)
      : fileName === "preparation-plan.json"
        ? (pack.preparationPlan as JsonObject)
        : (pack.targetProfile as JsonObject);
  const changed = applyPatch(current, testCase.patch);
  if (fileName === "manifest.json") return { ...pack, manifest: changed };
  pack = replacePackDocument(
    pack,
    fileName as "preparation-plan.json" | "target-profile.json",
    changed,
  );
  return pack;
}

function catalogState(
  pack: PreparationPackInput,
  descriptor?: SemanticCase["catalog_state"],
): PreparationCatalogState | undefined {
  if (descriptor === undefined) return undefined;
  const context = pack.preparationContext as JsonObject;
  const catalog = context.catalog as JsonObject;
  const supported = catalog.supported_competencies as JsonObject[];
  return {
    catalogVersion: descriptor.catalog_version,
    competencyIds: new Set([
      ...supported.map((item) => String(item.competency_id)),
      ...descriptor.competency_ids,
    ]),
    prerequisiteEdges: descriptor.prerequisite_edges,
  };
}

function generatedCollection(
  base: JsonObject,
  arrayField: string,
  idField: string,
  prefix: string,
  count: number,
): JsonObject {
  const result = cloneJson(base);
  const seed = cloneJson((result[arrayField] as JsonObject[])[0]!);
  result[arrayField] = Array.from({ length: count }, (_, index) => ({
    ...cloneJson(seed),
    [idField]: index === 0 ? seed[idField] : `${prefix}${String(index).padStart(3, "0")}`,
  })) as unknown as JsonValue;
  return result;
}

describe("Preparation Pack runtime validation", () => {
  it.each([
    ["minimal", "781c88421dfdbd2d0a6d9b72a44eb807b7357a5ebc9d290593575707678cb294"],
    ["growth-plan-minimal", "d184a84aa5a7e5714d3ccd98cf0449816f8fc365966883d4349e11112aad4b0b"],
  ] as const)("accepts valid %s pack and reproduces content fingerprint", (variant, digest) => {
    const pack = loadPreparationPack(variant);
    expect(validatePreparationPack(pack)).toEqual({ valid: true, violations: [] });
    expect(computePreparationPackContentFingerprint(pack.files)).toBe(digest);
  });

  for (const testCase of semanticCases(
    "preparation-pack/invalid/semantic/semantic-mutations.descriptor.json",
  )) {
    it(`rejects materialized semantic case ${testCase.case_id}`, () => {
      const pack = materializeSemanticCase(testCase);
      const state = catalogState(pack, testCase.catalog_state);
      const result = validatePreparationPack(
        state === undefined ? pack : { ...pack, catalogState: state },
      );
      expect(result.valid).toBe(false);
      expect(expectedCodes(result)).toContain(testCase.expected.code);
    });
  }

  for (const testCase of semanticCases(
    "preparation-pack/invalid/semantic/cycle-cases.descriptor.json",
  )) {
    it(`rejects materialized prerequisite case ${testCase.case_id}`, () => {
      const pack = loadPreparationPack("minimal");
      const changed = applyPatch(pack.targetProfile as JsonObject, testCase.patch ?? []);
      const materialized = replacePackDocument(pack, "target-profile.json", changed);
      const state = catalogState(materialized, testCase.catalog_state);
      const result = validatePreparationPack(
        state === undefined ? materialized : { ...materialized, catalogState: state },
      );
      expect(result.valid).toBe(false);
      expect(expectedCodes(result)).toContain(testCase.expected.code);
    });
  }

  const archiveDescriptor = readJson("preparation-pack/malicious/archive-paths.descriptor.json");
  for (const testCase of archiveDescriptor.cases as unknown as Array<{
    case_id: string;
    precondition_patch?: Parameters<typeof applyPatch>[1];
    patch: Parameters<typeof applyPatch>[1];
    expected: { primary_code: string };
  }>) {
    it(`rejects archive metadata case ${testCase.case_id}`, () => {
      const conditioned = applyPatch(
        archiveDescriptor.base as JsonObject,
        testCase.precondition_patch ?? [],
      );
      const result = validateArchiveEntries(applyPatch(conditioned, testCase.patch));
      expect(result.valid).toBe(false);
      expect(result.valid ? undefined : result.violations[0]?.code).toBe(
        testCase.expected.primary_code,
      );
    });
  }

  const quotaDescriptor = readJson("preparation-pack/boundary/quota-cases.descriptor.json");
  for (const testCase of quotaDescriptor.cases as unknown as Array<{
    case_id: string;
    input?: JsonObject;
    construction?: JsonObject;
    expected: { stage: string; result: string; code?: string };
  }>) {
    if (testCase.input !== undefined) {
      it(`executes quota predicate ${testCase.case_id}`, () => {
        const input = testCase.input!;
        const result =
          testCase.expected.stage === "retention"
            ? validateRetentionQuota({
                accepted_pack_count: Number(input.accepted_pack_count),
                attempted_new_packs: Number(input.attempted_new_packs),
                ...(input.retained_bytes === undefined
                  ? {}
                  : { retained_bytes: Number(input.retained_bytes) }),
                ...(input.attempted_pack_bytes === undefined
                  ? {}
                  : { attempted_pack_bytes: Number(input.attempted_pack_bytes) }),
              })
            : validateArchiveLimits(archiveLimitInput(input));
        expect(result.valid).toBe(
          testCase.expected.result === "accept" || testCase.expected.result === "continue",
        );
        if (!result.valid && testCase.expected.code !== undefined) {
          expect(result.violations.map((item) => item.code)).toContain(testCase.expected.code);
        }
      });
    }
  }

  it.each([
    [200, true],
    [201, false],
  ])("materializes target requirement boundary %i", (count, expected) => {
    const profile = generatedCollection(
      readJson("preparation-pack/valid/minimal/target-profile.json"),
      "requirements",
      "requirement_id",
      "requirement:generated-",
      count,
    );
    expect(validateSchema("target-profile", profile).valid).toBe(expected);
  });

  it.each([
    [250, 250, true],
    [250, 251, false],
  ])("materializes combined proposal boundary %i + %i", (competencies, activities, expected) => {
    const pack = loadPreparationPack("minimal");
    const profile = generatedCollection(
      pack.targetProfile as JsonObject,
      "proposed_competencies",
      "proposed_competency_id",
      "personal-competency:generated-",
      competencies,
    );
    const plan = generatedCollection(
      pack.preparationPlan as JsonObject,
      "proposed_activities",
      "activity_id",
      "personal-activity:generated-",
      activities,
    );
    const withProfile = replacePackDocument(pack, "target-profile.json", profile);
    const materialized = replacePackDocument(withProfile, "preparation-plan.json", plan);
    const result = validatePreparationPackSemantics(materialized);
    expect(result.valid).toBe(expected);
    if (!result.valid) {
      expect(result.violations.map((item) => item.code)).toContain("SEMANTIC_PROPOSAL_LIMIT");
    }
  });
});
