// @vitest-environment node

import { describe, expect, it } from "vitest";

import { validateSchema, type SchemaName } from "../../src/shared/contracts/schema-registry";
import { applyPatch, readJson } from "./support";

const preparationSchemaByFile: Readonly<Record<string, SchemaName>> = {
  "manifest.schema.json": "preparation-manifest",
  "preparation-context.schema.json": "preparation-context",
  "preparation-plan.schema.json": "preparation-plan",
  "target-profile.schema.json": "target-profile",
};

interface DescriptorCase {
  readonly case_id: string;
  readonly base: string;
  readonly schema?: string;
  readonly patch: Parameters<typeof applyPatch>[1];
  readonly expected: {
    readonly structural?: string;
    readonly result?: string;
    readonly code?: string;
  };
}

function cases(path: string): DescriptorCase[] {
  const descriptor = readJson(path);
  return (descriptor.cases as unknown as DescriptorCase[]).map((testCase) => ({
    ...testCase,
    base: testCase.base ?? String(descriptor.base),
  }));
}

describe("strict Draft 2020-12 schema registry", () => {
  it.each([
    ["preparation-context", "preparation-pack/valid/minimal/preparation-context.json"],
    ["preparation-manifest", "preparation-pack/valid/minimal/manifest.json"],
    ["preparation-plan", "preparation-pack/valid/minimal/preparation-plan.json"],
    ["target-profile", "preparation-pack/valid/minimal/target-profile.json"],
    ["preparation-context", "preparation-pack/valid/growth-plan-minimal/preparation-context.json"],
    ["preparation-manifest", "preparation-pack/valid/growth-plan-minimal/manifest.json"],
    ["preparation-plan", "preparation-pack/valid/growth-plan-minimal/preparation-plan.json"],
    ["agent-control-context", "agent-control/v1/valid/control-context.minimal.json"],
    ["agent-change-set", "agent-control/v1/valid/change-set.cancel-campaign.previewed.json"],
    ["explore-source", "explore-source/v1/valid/explore-source-v1.personal.json"],
    [
      "explore-target-context",
      "explore-target-context/v1/valid/explore-target-context-v1.canonical.json",
    ],
    ["target-selection-source", "target-selection/v1/valid/target-selection-source-v1.seeded.json"],
    ["readiness-event-v1", "../contract/fixtures/events/v1/readiness.valid.json"],
    ["readiness-event-v1", "../contract/fixtures/events/v1/readiness.boundary.json"],
    ["planning-event-v1", "../contract/fixtures/events/v1/planning.valid.json"],
    ["planning-event-v1", "../contract/fixtures/events/v1/planning.boundary.json"],
    ["planning-event-v1", "../contract/fixtures/events/v1/planning-track-lifecycle.valid.json"],
    [
      "growth-plan-capacity-control-v1",
      "../contract/fixtures/planning/v1/growth-plan-capacity-control.valid.json",
    ],
    [
      "learning-track-lifecycle-control-v1",
      "../contract/fixtures/planning/v1/learning-track-lifecycle-control.valid.json",
    ],
    ["target-readiness-v1", "../contract/fixtures/target-readiness/v1/target-readiness.valid.json"],
    [
      "target-readiness-v1",
      "../contract/fixtures/target-readiness/v1/target-readiness.boundary.json",
    ],
    [
      "planning-readiness-input-v1",
      "../contract/fixtures/target-readiness/v1/planning-readiness.valid.json",
    ],
    [
      "planning-readiness-input-v1",
      "../contract/fixtures/target-readiness/v1/planning-readiness.boundary.json",
    ],
    ["graph-projection", "graph/v1/valid/graph-projection-v1.boundary-minimal.json"],
    ["graph-projection", "graph/v1/valid/graph-projection-v1.representative.json"],
    ["graph-projection", "graph/v1/valid/graph-projection-v1.typed-variants.json"],
  ] as const)("accepts %s fixture %s", (schema, fixture) => {
    expect(validateSchema(schema, readJson(fixture))).toEqual({
      valid: true,
      violations: [],
    });
  });

  const structuralDescriptors = [
    "preparation-pack/invalid/structural/schema-mutations.descriptor.json",
    "preparation-pack/invalid/structural/cross-variant-mutations.descriptor.json",
    "preparation-pack/malicious/personal-competency-authority.descriptor.json",
  ];
  for (const descriptorPath of structuralDescriptors) {
    for (const testCase of cases(descriptorPath)) {
      it(`rejects materialized structural case ${testCase.case_id}`, () => {
        const schemaFile =
          testCase.schema ??
          (testCase.base.endsWith("target-profile.json")
            ? "target-profile.schema.json"
            : undefined);
        if (schemaFile === undefined) throw new Error("Descriptor omitted schema");
        const base = readJson(`preparation-pack/${testCase.base}`);
        const value = applyPatch(base, testCase.patch);
        const result = validateSchema(preparationSchemaByFile[schemaFile]!, value);
        expect(result.valid).toBe(false);
        if (!result.valid && testCase.expected.code !== undefined) {
          expect(result.violations.map((item) => item.code)).toContain(testCase.expected.code);
        }
      });
    }
  }

  for (const testCase of cases("preparation-pack/boundary/calendar-cases.descriptor.json")) {
    it(`executes calendar boundary ${testCase.case_id}`, () => {
      const value = applyPatch(readJson(`preparation-pack/${testCase.base}`), testCase.patch);
      const result = validateSchema(preparationSchemaByFile[testCase.schema!]!, value);
      expect(result.valid).toBe(testCase.expected.structural === "accept");
      if (!result.valid && testCase.expected.code !== undefined) {
        expect(result.violations.map((item) => item.code)).toContain(testCase.expected.code);
      }
    });
  }

  it("rejects an Agent Control unknown field without mutating input", () => {
    const input = readJson("agent-control/v1/valid/control-context.minimal.json");
    const changed = applyPatch(input, [{ op: "add", path: "/raw_evidence", value: [] }]);
    expect(validateSchema("agent-control-context", changed).valid).toBe(false);
    expect(input.raw_evidence).toBeUndefined();
  });
});
